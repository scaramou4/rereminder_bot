/**
 * dateParser.js
 *
 * Модуль для нормализации временных выражений и парсинга напоминаний с использованием Luxon.
 * Поддерживаются варианты:
 *   1. "через [<число>] <единица> <текст>"
 *      (поддерживаются десятичные числа)
 *   2. "завтра [в <час>(:<минута>)] <текст>"
 *   2.5. "в <час>(:<минута>) <текст>" – если не указан день
 *   3. "в[о] <день недели> [в <час>(:<минута>)] <текст>"
 *   4. "кажд(?:ый|ую) <период> [в <час>(:<минута>)] <текст>"
 *
 * Если время не указано, используется текущее время (текущие часы и минуты).
 */

const { DateTime } = require('luxon');

const timeUnitNormalization = {
  'месяц': ['месяц', 'месяца', 'месяцев'],
  'неделя': ['неделя', 'недели', 'недель', 'неделю'],
  'год': ['год', 'года', 'лет']
};
const timeUnitMap = {};
Object.entries(timeUnitNormalization).forEach(([nominative, forms]) => {
  forms.forEach(form => {
    timeUnitMap[form.toLowerCase()] = nominative;
  });
});

const dayOfWeekNormalization = {
  'понедельник': ['понедельник', 'понедельника', 'понедельнику', 'понедельником', 'понедельнике'],
  'вторник': ['вторник', 'вторника', 'вторнику', 'вторником', 'вторнике'],
  'среда': ['среда', 'среды', 'среду', 'средой', 'среде'],
  'четверг': ['четверг', 'четверга', 'четвергу', 'четвергом', 'четверге'],
  'пятница': ['пятница', 'пятницы', 'пятницу', 'пятницей', 'пятнице'],
  'суббота': ['суббота', 'субботы', 'субботу', 'субботой', 'субботе'],
  'воскресенье': ['воскресенье', 'воскресенья', 'воскресенью', 'воскресеньем']
};
const dayOfWeekMap = {};
Object.entries(dayOfWeekNormalization).forEach(([nominative, forms]) => {
  forms.forEach(form => {
    dayOfWeekMap[form.toLowerCase()] = nominative;
  });
});

const dayNameToWeekday = {
  'понедельник': 1,
  'вторник': 2,
  'среда': 3,
  'четверг': 4,
  'пятница': 5,
  'суббота': 6,
  'воскресенье': 7
};

function normalizeWord(word) {
  const lowerWord = word.toLowerCase();
  if (timeUnitMap[lowerWord]) return timeUnitMap[lowerWord];
  if (dayOfWeekMap[lowerWord]) return dayOfWeekMap[lowerWord];
  return word;
}

function normalizeTimeExpressions(text) {
  const regex = new RegExp(`\\b(${Object.keys(timeUnitMap).concat(Object.keys(dayOfWeekMap)).join('|')})\\b`, 'gi');
  return text.replace(regex, (match) => normalizeWord(match));
}

function parseDate(text, format) {
  const normalizedText = normalizeTimeExpressions(text);
  return DateTime.fromFormat(normalizedText, format, { locale: 'ru' });
}

/**
 * Парсит строку напоминания.
 */
function parseReminder(text) {
  const normalizedText = normalizeTimeExpressions(text);
  const now = DateTime.local();

  // 1. "через [<число>] <единица> <текст>"
  const throughRegex = /^через\s+(?:(\d+(?:\.\d+)?)\s+)?([A-Za-zА-Яа-яёЁ]+)\s+(.+)/i;
  let match = normalizedText.match(throughRegex);
  if (match) {
    const number = match[1] ? parseFloat(match[1]) : 1;
    const unit = match[2].toLowerCase();
    const reminderText = match[3].trim();
    const unitMap = {
      'минута': 'minutes',
      'минуты': 'minutes',
      'минут': 'minutes',
      'минуту': 'minutes',
      'час': 'hours',
      'часа': 'hours',
      'часов': 'hours',
      'часу': 'hours',
      'день': 'days',
      'дня': 'days',
      'дней': 'days',
      'дню': 'days'
    };
    const durationKey = unitMap[unit] || 'minutes';
    const parsedDate = DateTime.local().plus({ [durationKey]: number }).toJSDate();
    let repeat = null;
    const repeatMatch = normalizedText.match(/каждый\s+(\w+)/i);
    if (repeatMatch) repeat = repeatMatch[1].toLowerCase();
    return {
      datetime: parsedDate,
      reminderText: reminderText,
      timeSpec: `${number} ${unit}`,
      repeat: repeat
    };
  }

  // 2. "завтра [в <час>(:<минута>)] <текст>"
  const tomorrowRegex = /^завтра(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/i;
  match = normalizedText.match(tomorrowRegex);
  if (match) {
    const hour = match[1] ? parseInt(match[1], 10) : now.hour;
    const minute = match[2] ? parseInt(match[2], 10) : now.minute;
    const reminderText = match[3].trim();
    const dt = now.plus({ days: 1 }).set({ hour, minute, second: 0, millisecond: 0 });
    return {
      datetime: dt.toJSDate(),
      reminderText: reminderText,
      timeSpec: `завтра в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }
  
  // 2.5. "в <час>(:<минута>) <текст>" – если не указан день недели
  const timeOnlyRegex = /^в\s+(\d{1,2})(?::(\d{1,2}))?\s+(.+)/i;
  match = normalizedText.match(timeOnlyRegex);
  if (match) {
    const hour = parseInt(match[1], 10);
    const minute = match[2] ? parseInt(match[2], 10) : 0;
    const reminderText = match[3].trim();
    let dt = now.set({ hour, minute, second: 0, millisecond: 0 });
    if (dt <= now) dt = dt.plus({ days: 1 });
    return {
      datetime: dt.toJSDate(),
      reminderText: reminderText,
      timeSpec: `в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }

  // 3. "в[о] <день недели> [в <час>(:<минута>)] <текст>"
  const dayOfWeekRegex = /^в(?:о)?\s+([A-Za-zА-Яа-яёЁ]+)(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/i;
  match = normalizedText.match(dayOfWeekRegex);
  if (match) {
    const dayStr = match[1].toLowerCase();
    if (dayNameToWeekday[dayStr] || dayNameToWeekday[normalizeWord(dayStr)]) {
      const hour = match[2] ? parseInt(match[2], 10) : now.hour;
      const minute = match[2] ? (match[3] ? parseInt(match[3], 10) : 0) : now.minute;
      const reminderText = match[4].trim();
      const normDay = dayNameToWeekday[dayStr] ? dayStr : normalizeWord(dayStr);
      let diff = (dayNameToWeekday[normDay] - now.weekday + 7) % 7;
      if (diff === 0) diff = 7;
      const dt = now.plus({ days: diff }).set({ hour, minute, second: 0, millisecond: 0 });
      return {
        datetime: dt.toJSDate(),
        reminderText: reminderText,
        timeSpec: `в ${normDay} в ${hour}:${minute < 10 ? '0' + minute : minute}`,
        repeat: null
      };
    }
  }
  
  // 4. "кажд(?:ый|ую) <период> [в <час>(:<минута>)] <текст>"
  const everyRegex = /^кажд(?:ый|ую)\s+([A-Za-zА-Яа-яёЁ]+)(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s*(.*)/i;
  match = normalizedText.match(everyRegex);
  if (match) {
    const periodRaw = match[1].toLowerCase();
    const normPeriod = normalizeWord(periodRaw);
    const hour = match[2] ? parseInt(match[2], 10) : now.hour;
    const minute = match[2] ? (match[3] ? parseInt(match[3], 10) : 0) : now.minute;
    let reminderText = match[4] ? match[4].trim() : '';
    if (reminderText === '') reminderText = null;
    let dt;
    let repeat;
    if (normPeriod === 'день') {
      dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ days: 1 });
      repeat = 'день';
    } else if (normPeriod === 'неделя') {
      dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ weeks: 1 });
      repeat = 'неделя';
    } else if (normPeriod === 'месяц') {
      dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ months: 1 });
      repeat = 'месяц';
    } else if (normPeriod === 'год') {
      dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ years: 1 });
      repeat = 'год';
    } else if (dayNameToWeekday[normPeriod]) {
      let diff = (dayNameToWeekday[normPeriod] - now.weekday + 7) % 7;
      if (diff === 0) diff = 7;
      dt = now.plus({ days: diff }).set({ hour, minute, second: 0, millisecond: 0 });
      repeat = normPeriod;
    } else {
      dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ days: 1 });
      repeat = normPeriod;
    }
    return {
      datetime: dt.toJSDate(),
      reminderText: reminderText,
      timeSpec: `каждый ${normPeriod} в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: repeat
    };
  }
  
  // 5. Вариант "число единица" – относительная длительность (для custom postpone)
  const durationOnlyRegex = /^(\d+(?:\.\d+)?)\s+([A-Za-zА-Яа-яёЁ]+)$/i;
  match = normalizedText.match(durationOnlyRegex);
  if (match) {
    const number = parseFloat(match[1]);
    const unitRaw = match[2].toLowerCase();
    const unitMap = {
      'минута': 'minutes',
      'минуты': 'minutes',
      'минут': 'minutes',
      'минуту': 'minutes',
      'час': 'hours',
      'часа': 'hours',
      'часов': 'hours',
      'часу': 'hours',
      'день': 'days',
      'дня': 'days',
      'дней': 'days',
      'дню': 'days'
    };
    const unit = unitMap[unitRaw] || null;
    if (!unit) return { datetime: null };
    const parsedDate = DateTime.local().plus({ [unit]: number }).toJSDate();
    return {
      datetime: parsedDate,
      reminderText: null,
      timeSpec: `${number} ${unitRaw}`,
      repeat: null
    };
  }
  
  return { datetime: null, reminderText: null, timeSpec: null, repeat: null };
}

module.exports = {
  normalizeWord,
  normalizeTimeExpressions,
  parseDate,
  parseReminder
};