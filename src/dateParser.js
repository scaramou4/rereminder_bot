// src/dateParser.js
const { DateTime }   = require('luxon');
const logger         = require('./logger');
const UserSettings   = require('./models/userSettings');
const {
  MOSCOW_ZONE,
  monthNames,
  regexps,
  errorMessages,
  timeUnitMap,
  dayOfWeekMap,
  fuzzyCorrections,
  unitDeclensions,
  validRepeatUnits,
  dayNameToWeekday
} = require('./constants');

/* ─────────────── helpers ─────────────── */
const fuzzyCorrectUnit = w => fuzzyCorrections[w.toLowerCase()] || w;

function normalizeWord(word) {
  const w = word.toLowerCase();
  if (timeUnitMap[w])  return timeUnitMap[w];
  if (dayOfWeekMap[w]) return dayOfWeekMap[w];
  const alt = {
    'среду':'среда','пятницу':'пятница','понедельника':'понедельник',
    'вторника':'вторник','четверга':'четверг','субботы':'суббота',
    'воскресенья':'воскресенье','утром':'утро','вечером':'вечер'
  };
  return alt[w] || fuzzyCorrectUnit(word);
}

function getDeclension(unit, n) {
  const f = unitDeclensions[unit];
  if (!f) return unit;
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11)               return f.one;
  if ([2,3,4].includes(mod10) && ![12,13,14].includes(mod100)) return f.few;
  return f.many;
}

function parseTimeString(s) {
  if (!s) return { hour:0, minute:0 };
  if (/^\d{3,4}$/.test(s)) {
    return s.length === 3
      ? { hour:+s[0], minute:+s.slice(1) }
      : { hour:+s.slice(0,2), minute:+s.slice(2) };
  }
  if (/[.:]/.test(s)) {
    const [h,m] = s.split(/[.:]/).map(Number);
    return { hour:h||0, minute:m||0 };
  }
  return { hour:+s||0, minute:0 };
}

const defaultTime = now => ({ hour: now.hour, minute: now.minute });

function nextWeekday(start, target) {
  let dt = start;
  while (dt.weekday !== target || dt <= start) dt = dt.plus({ days: 1 });
  return dt;
}

function computeNextTimeFromScheduled(date, repeat, zone) {
  const dt = DateTime.fromJSDate(date, { zone: MOSCOW_ZONE });
  if (repeat?.includes('час'))  return dt.plus({hours:1}).setZone(zone).toJSDate();
  if (/(утро|вечер)/.test(repeat||'')) return dt.plus({days:1}).setZone(zone).toJSDate();
  return dt.plus({days:1}).setZone(zone).toJSDate();
}

/* ─────── Agenda helper ─────── */
function transformRepeatToAgenda(russianRepeat = '') {
  if (!russianRepeat) return null;
  let str = russianRepeat.replace(/кажд(ый|ая|ую|ое|ые)\s*/, '');
  let mult = 1; let unit = str.trim();
  const parts = str.trim().split(' ');
  if (parts.length === 2) { mult = parseInt(parts[0], 10); unit = parts[1]; }
  unit = unit.toLowerCase();

  if (unit === 'утро' || unit === 'вечер') return '1 day';

  const dows = ['понедельник','вторник','среда','четверг','пятница','суббота','воскресенье'];
  if (dows.includes(unit)) return mult > 1 ? `${mult} weeks` : '1 week';

  const map = { минута:'minutes', час:'hours', день:'days', неделя:'weeks',
                месяц:'months', год:'years' };
  const en  = map[unit] || unit;
  return mult > 1 ? `${mult} ${en}s` : `1 ${en}`;
}

/* ── дополнительный RegExp для «каждый 17 апреля …» ── */
const yearlyNoWord = /^каждый\s+(\d{1,2})\s+([а-яё]+)\s+(.+)$/iu;
const yearlyFull   = /^каждый\s+год\s+(\d{1,2})\s+([а-яё]+)(?:\s+в\s+(\d{1,2}(?::\d{1,2})?))?\s+(.+)$/iu;

/* ────────────────── P A R S E R ────────────────── */
async function parseReminder(text, chatId) {
  logger.info(`parseReminder: Входной текст: "${text}"`);
  let src = text.replace(/ё/g,'е').trim();
  logger.info(`normalizeTimeExpressions: "${src}"`);
  const now = DateTime.now().setZone(MOSCOW_ZONE,{keepLocalTime:true});

  const settings = await UserSettings.findOne({ userId:String(chatId) }) || {
    timezone:'Europe/Moscow', morningTime:'8:00', eveningTime:'18:00'
  };

  /* ── 1. «каждый 17 апреля …» → дописываем «год» ── */
  let m = src.match(yearlyNoWord);
  if (m) src = `каждый год ${m[1]} ${m[2]} ${m[3]}`;

  /* ── 2. «каждый год 17 апреля …» ── */
  m = src.match(yearlyFull);
  if (m) {
    const [ , dayStr, monStr, timeStr, textTail ] = m;
    const month = monthNames[monStr.toLowerCase()];
    if (!month) return { error:errorMessages.invalidMonth };

    const {hour,minute} = timeStr ? parseTimeString(timeStr) : defaultTime(now);
    if (hour>23||minute>59) return { error:errorMessages.invalidTime };

    let dt = DateTime.fromObject(
      { year:now.year, month, day:+dayStr, hour, minute, second:0, millisecond:0 },
      { zone:MOSCOW_ZONE }
    );
    if (dt <= now) dt = dt.plus({ years:1 });

    return {
      error:null,
      datetime:dt.toJSDate(),
      reminderText:textTail.trim(),
      timeSpec:`${dayStr} ${monStr} в ${hour.toString().padStart(2,'0')}:${minute.toString().padStart(2,'0')}`,
      repeat:'каждый год'
    };
  }

  /* ── 3. Простая абсолютная дата ── */
  const absSimple = /^(\d{1,2})\s+([а-яё]+)(?:\s+в\s+(\d{1,2}(?::\d{1,2})?))?\s+(.+)$/iu;
  m = src.match(absSimple);
  if (m) {
    const [ , dayStr, monStr, timeStr, tail ] = m;
    const month = monthNames[monStr.toLowerCase()];
    if (!month) return { error:errorMessages.invalidMonth };

    const {hour,minute} = timeStr ? parseTimeString(timeStr) : defaultTime(now);
    if (hour>23||minute>59) return { error:errorMessages.invalidTime };

    /* --- отделяем повтор / текст --- */
    const repRe = /^кажд(?:ый|ая|ую|ое|ые)(?:\s+(\d+))?\s+([А-Яа-яёЁ]+)\s+(.+)$/iu;
    const rm   = tail.match(repRe);
    let repeatStr = null, reminderTxt;

    if (rm) {
      const mult = rm[1] ? +rm[1] : 1;
      let unit   = normalizeWord(fuzzyCorrectUnit(rm[2]));
      if (!validRepeatUnits.includes(unit))
        return { error:errorMessages.invalidRepeatUnit };
      repeatStr = mult === 1 ? `каждый ${unit}`
                             : `каждые ${mult} ${getDeclension(unit,mult)}`;
      reminderTxt = rm[3].trim();
    } else {
      reminderTxt = tail.trim();
    }
    if (!reminderTxt) return { error:errorMessages.missingText };

    let dt = DateTime.fromObject(
      { year:now.year, month, day:+dayStr, hour, minute, second:0, millisecond:0 },
      { zone:MOSCOW_ZONE }
    );
    if (!dt.isValid) return { error:errorMessages.invalidDate };

    /* --- перенос вперёд, если дата уже в прошлом --- */
    if (dt < now) {
      if (repeatStr && repeatStr.includes('год')) {
        dt = dt.plus({ years:1 });
      } else if (repeatStr) {
        dt = dt.plus({ days:1 });
      } else {
        dt = dt.plus({ years:1 });
      }
    }

    return {
      error:null,
      datetime:dt.toJSDate(),
      reminderText:reminderTxt,
      timeSpec:`${dayStr} ${monStr}${timeStr ? ' в '+hour+':'+minute.toString().padStart(2,'0') : ''}`,
      repeat:repeatStr
    };
  }

  /* ── 4. «каждый месяц 15 числа …» ── */
  m = src.match(regexps.monthlyDayRegex);
  if (m) {
    const [ , dayStr, timeStr, textTail ] = m;
    const day = +dayStr;
    if (day<1||day>31) return { error:errorMessages.invalidDate };

    let dt = now.set({ day, second:0, millisecond:0 });
    if (timeStr) {
      const {hour,minute} = parseTimeString(timeStr);
      dt = dt.set({ hour, minute });
    }
    if (dt<=now) dt = dt.plus({ months:1 });

    return {
      error:null,
      datetime:dt.toJSDate(),
      reminderText:textTail.trim(),
      timeSpec:`каждый месяц ${day} числа${timeStr?' в '+dt.toFormat('HH:mm'):''}`,
      repeat:'каждый месяц'
    };
  }

  /* ── 5. «каждый / каждые …» ── */
  m = src.match(regexps.repeatRegex);
  if (m) {
    const mult = m[1] ? +m[1] : 1;
    let unit   = normalizeWord(fuzzyCorrectUnit(m[2]));
    if (!validRepeatUnits.includes(unit))
      return { error:errorMessages.invalidRepeatUnit };

    const weekdayNum = dayNameToWeekday[unit];
    const isWeekday  = Boolean(weekdayNum);
    const repeatStr  = mult === 1 ? `каждый ${unit}`
                                  : `каждые ${mult} ${getDeclension(unit,mult)}`;

    let dt;
    if (isWeekday) {
      const base = m[3] ? parseTimeString(m[3])
                : m[4] ? (m[4]==='утром'?settings.morningTime:settings.eveningTime)
                         .split(':').map(Number)
                : defaultTime(now);
      dt = now.set({ hour: base.hour||base[0], minute: base.minute||base[1],
                     second:0, millisecond:0 });
      dt = nextWeekday(dt, weekdayNum);
    } else if (unit === 'минута') {
      dt = now.plus({ minutes: mult });
    } else if (unit === 'час') {
      dt = now.plus({ hours: mult });
    } else {
      const base = m[3] ? parseTimeString(m[3])
                : m[4] ? (m[4]==='утром'?settings.morningTime:settings.eveningTime)
                         .split(':').map(Number)
                : defaultTime(now);
      dt = now.set({ hour: base.hour||base[0], minute: base.minute||base[1],
                     second:0, millisecond:0 });
      if (dt<=now) {
        const map = { день:'days', неделя:'weeks', месяц:'months', год:'years',
                      утро:'days', вечер:'days' };
        dt = dt.plus({ [map[unit]]: mult });
      }
    }

    const txt = m[5]?.trim();
    if (!txt) return { error:errorMessages.missingText };

    return {
      error:null,
      datetime:dt.toJSDate(),
      reminderText:txt,
      timeSpec:`${repeatStr} в ${dt.toFormat('HH:mm')}`,
      repeat:repeatStr
    };
  }

  /* ── 6. «через N …» ── */
  m = src.match(regexps.throughRegex);
  if (m) {
    if (m[3])      return { error:errorMessages.complexTime };
    const number = m[1] ? parseFloat(m[1]) : 1;
    if (number<=0) return { error:errorMessages.nonPositiveDuration };

    let unit = normalizeWord(fuzzyCorrectUnit(m[2]));
    const txt = m[4]?.trim();
    if (!txt) return { error:errorMessages.missingText };

    const map = {
      'минута':'minutes','минуты':'minutes','минут':'minutes','минуту':'minutes',
      'час':'hours','часа':'hours','часов':'hours',
      'день':'days','дня':'days','дней':'days',
      'неделя':'weeks','недели':'weeks','недель':'weeks',
      'месяц':'months','месяца':'months','месяцев':'months',
      'год':'years','года':'years','лет':'years'
    };
    const key = map[unit] || 'minutes';
    const dt  = now.plus({ [key]: number });

    return {
      error:null,
      datetime:dt.toJSDate(),
      reminderText:txt,
      timeSpec:`через ${number} ${unit}`,
      repeat:null
    };
  }

  /* ── 7. Короткие форматы (время, сегодня/завтра…) ── */
  for (const [reName, fn] of [
    ['dayMorningEveningRegex', h=>{
      const day=h[1].toLowerCase(), tod=h[2].toLowerCase(), txt=h[3]?.trim();
      if (!txt) return { error:errorMessages.missingText };
      const [hHour,hMin] = (tod==='утром'?settings.morningTime:settings.eveningTime)
                             .split(':').map(Number);
      let dt = now.setZone(settings.timezone)
                  .set({ hour:hHour, minute:hMin, second:0, millisecond:0 })
                  .plus({ days:{сегодня:0,завтра:1,послезавтра:2}[day] });
      if (dt<=now) return { error:errorMessages.timePassed };
      return { error:null, datetime:dt.toJSDate(), reminderText:txt,
               timeSpec:`${day} ${tod} в ${hHour}:${hMin.toString().padStart(2,'0')}`,
               repeat:null };
    }],
    ['todayTomorrowRegex', h=>{
      const off={'сегодня':0,'завтра':1,'послезавтра':2}[h[1].toLowerCase()];
      const {hour,minute}=parseTimeString(h[2]);
      if (hour>23||minute>59) return { error:errorMessages.invalidTime };
      const txt=h[3]?.trim(); if(!txt) return { error:errorMessages.missingText };
      let dt=now.plus({days:off}).set({hour,minute,second:0,millisecond:0});
      if (dt<=now) return { error:errorMessages.timePassed };
      return { error:null, datetime:dt.toJSDate(), reminderText:txt,
               timeSpec:`${h[1]} в ${hour}:${minute.toString().padStart(2,'0')}`, repeat:null };
    }],
    ['timeWithDotRegex', h=>{
      const hour=+h[1], minute=+h[2];
      if (hour>23||minute>59) return { error:errorMessages.invalidTime };
      const txt=h[3]?.trim(); if(!txt) return { error:errorMessages.missingText };
      let dt=now.set({hour,minute,second:0,millisecond:0}); if(dt<=now)dt=dt.plus({days:1});
      return { error:null, datetime:dt.toJSDate(), reminderText:txt,
               timeSpec:`в ${hour}:${minute.toString().padStart(2,'0')}`, repeat:null };
    }],
    ['timeNumericRegex', h=>{
      const {hour,minute}=parseTimeString(h[1]);
      if (hour>23||minute>59) return { error:errorMessages.invalidTime };
      const txt=h[2]?.trim(); if(!txt) return { error:errorMessages.missingText };
      let dt=now.set({hour,minute,second:0,millisecond:0}); if(dt<=now)dt=dt.plus({days:1});
      return { error:null, datetime:dt.toJSDate(), reminderText:txt,
               timeSpec:`в ${hour}:${minute.toString().padStart(2,'0')}`, repeat:null };
    }],
    ['simpleTimeRegex', h=>{
      const hour=+h[1]; if(hour>23) return { error:errorMessages.invalidTime };
      const txt=h[2]?.trim(); if(!txt) return { error:errorMessages.missingText };
      let dt=now.set({hour,minute:0,second:0,millisecond:0}); if(dt<=now)dt=dt.plus({days:1});
      return { error:null, datetime:dt.toJSDate(), reminderText:txt,
               timeSpec:`в ${hour}:00`, repeat:null };
    }]
  ]) {
    m = src.match(regexps[reName]);
    if (m) return fn(m);
  }

  return { error:errorMessages.unknownFormat };
}

/* ─────── parseDate для тестов ─────── */
const parseDate = (str, fmt='d MMMM yyyy') =>
  DateTime.fromFormat(str, fmt, { locale:'ru', zone:MOSCOW_ZONE });

/* ─────────────── export ────────────── */
module.exports = {
  parseReminder,
  parseTimeString,
  parseDate,
  normalizeWord,
  computeNextTimeFromScheduled,
  getDeclension,
  transformRepeatToAgenda            // ← восстановили экспорт
};