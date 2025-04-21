// dateParser.js
const { DateTime } = require('luxon');
const logger = require('./logger');
const UserSettings = require('./models/userSettings');
const {
  MOSCOW_ZONE,
  monthNames,
  regexps,
  errorMessages,
  timeUnitMap,
  dayOfWeekMap,
  fuzzyCorrections,
  unitDeclensions
} = require('./constants');

/**
 * Корректирует «неточные» значения (опечатки).
 */
function fuzzyCorrectUnit(word) {
  const lower = word.toLowerCase();
  return fuzzyCorrections[lower] || word;
}

/**
 * Нормализует слово (например, "среду" → "среда").
 */
function normalizeWord(word) {
  const lowerWord = word.toLowerCase();
  logger.info(`normalizeWord: Нормализация слова: "${lowerWord}"`);
  if (timeUnitMap[lowerWord]) return timeUnitMap[lowerWord];
  if (dayOfWeekMap[lowerWord]) return dayOfWeekMap[lowerWord];
  const errorForms = {
    'среду': 'среда',
    'пятницу': 'пятница',
    'понедельника': 'понедельник',
    'вторника': 'вторник',
    'четверга': 'четверг',
    'субботы': 'суббота',
    'воскресенья': 'воскресенье'
  };
  const normalized = errorForms[lowerWord] || fuzzyCorrectUnit(word);
  logger.info(`normalizeWord: Нормализованное слово: "${normalized}"`);
  return normalized;
}

/**
 * Склоняет единицу времени по числу.
 */
function getDeclension(unit, number) {
  const forms = unitDeclensions[unit];
  if (!forms) return unit;
  number = Number(number);
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return forms.one;
  } else if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) {
    return forms.few;
  } else {
    return forms.many;
  }
}

/**
 * Преобразует повторение в строку для расписания (не используется напрямую).
 */
function transformRepeatToAgenda(russianRepeat) {
  let repeatStr = russianRepeat.replace(/кажд(ый|ая|ую|ое|ые)\s*/, '');
  let multiplier = 1;
  let unit = repeatStr.trim();
  const parts = repeatStr.trim().split(" ");
  if (parts.length === 2) {
    multiplier = parseInt(parts[0], 10);
    unit = parts[1];
  }
  unit = unit.toLowerCase();
  const daysOfWeek = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
  if (daysOfWeek.includes(unit)) {
    return multiplier > 1 ? `${multiplier} weeks` : "1 week";
  }
  const mapping = {
    'минута': 'minutes',
    'час': 'hours',
    'день': 'days',
    'неделя': 'weeks',
    'месяц': 'months',
    'год': 'years'
  };
  const englishUnit = mapping[unit] || unit;
  return multiplier > 1 ? `${multiplier} ${englishUnit}s` : `${multiplier} ${englishUnit}`;
}

/**
 * Парсит строку времени (например, "10:15" или "1015") и возвращает объект { hour, minute }.
 */
function parseTimeString(timeStr) {
  let hour, minute;
  if (!timeStr) return { hour: 0, minute: 0 };
  if (timeStr.length === 3 || timeStr.length === 4) {
    hour = parseInt(timeStr.slice(0, timeStr.length === 3 ? 1 : 2), 10) || 0;
    minute = parseInt(timeStr.slice(timeStr.length === 3 ? 1 : 2), 10) || 0;
  } else if (timeStr.includes(':') || timeStr.includes('.')) {
    const [h, m] = timeStr.split(/[:.]/);
    hour = parseInt(h, 10) || 0;
    minute = parseInt(m, 10) || 0;
  } else {
    hour = parseInt(timeStr, 10) || 0;
    minute = 0;
  }
  return { hour, minute };
}

/**
 * Временно просто возвращает исходный текст.
 */
function normalizeTimeExpressions(text) {
  return text;
}

/**
 * Парсит дату по заданному формату.
 */
function parseDate(text, format) {
  const normalizedText = normalizeTimeExpressions(text);
  logger.info(`parseDate: Парсинг текста: "${normalizedText}" с форматом: "${format}"`);
  return DateTime.fromFormat(normalizedText, format, { locale: 'ru' });
}

/**
 * Вычисляет следующее время для запланированного события.
 */
function computeNextTimeFromScheduled(scheduledTime, repeat, userZone) {
  const dt = DateTime.fromJSDate(scheduledTime, { zone: MOSCOW_ZONE });
  if (repeat && repeat.includes('час')) {
    return dt.plus({ hours: 1 }).setZone(userZone).toJSDate();
  }
  return dt.plus({ days: 1 }).setZone(userZone).toJSDate();
}

/**
 * Основная функция парсинга напоминания.
 * Возвращает объект: { error, datetime, reminderText, timeSpec, repeat }.
 */
async function parseReminder(text, chatId) {
  logger.info(`parseReminder: Входной текст: "${text}"`);
  const normalizedText = normalizeTimeExpressions(text);
  logger.info(`normalizeTimeExpressions: Нормализованный текст: "${normalizedText}"`);
  const now = DateTime.now().setZone(MOSCOW_ZONE, { keepLocalTime: true });
  const {
    absoluteDateRegex,
    monthlyDayRegex,
    repeatRegex,
    throughRegex,
    todayTomorrowRegex,
    timeWithDotRegex,
    timeNumericRegex,
    timeWithSpaceRegex,
    simpleTimeRegex,
    dayMorningEveningRegex,
    morningEveningRegex
  } = regexps;

  try {
    // 0. Формат "сегодня/завтра/послезавтра + утром/вечером"
    let match = normalizedText.match(dayMorningEveningRegex);
    if (match) {
      logger.info(`parseReminder: Совпадение с форматом день+утро/вечером: ${match}`);
      const daySpec = match[1].toLowerCase();
      const timeOfDay = match[2].toLowerCase();
      const reminderText = match[3] ? match[3].trim() : null;
      if (!reminderText) {
        logger.warn(`parseReminder: ${errorMessages.missingText}: "${normalizedText}"`);
        return { error: errorMessages.missingText, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      const settings = await UserSettings.findOne({ userId: chatId.toString() }) ||
        { timezone: 'Europe/Moscow', morningTime: '8:00', eveningTime: '18:00' };
      const userZone = settings.timezone;
      const [morningHour, morningMinute] = settings.morningTime.split(':').map(Number);
      const [eveningHour, eveningMinute] = settings.eveningTime.split(':').map(Number);
      let hour, minute;
      if (timeOfDay === 'утром') {
        hour = morningHour;
        minute = morningMinute;
      } else {
        hour = eveningHour;
        minute = eveningMinute;
      }
      let dt = now.setZone(userZone).set({ hour, minute, second: 0, millisecond: 0 });
      const dayOffset = { 'сегодня': 0, 'завтра': 1, 'послезавтра': 2 }[daySpec];
      dt = dt.plus({ days: dayOffset });
      if (dt <= now) {
        logger.warn(`parseReminder: ${errorMessages.timePassed}: ${dt.toISO()}`);
        return { error: errorMessages.timePassed, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      logger.info(`parseReminder: Получена дата: ${dt.toISO()}`);
      return {
        error: null,
        datetime: dt.toJSDate(),
        reminderText,
        timeSpec: `${daySpec} ${timeOfDay} в ${hour}:${minute < 10 ? '0' + minute : minute}`,
        repeat: null
      };
    }
    
    // 1. Формат "утром/вечером" без указания дня (по умолчанию "завтра")
    match = normalizedText.match(morningEveningRegex);
    if (match) {
      logger.info(`parseReminder: Совпадение с форматом утро/вечер: ${match}`);
      const timeOfDay = match[1].toLowerCase();
      const daySpec = match[2] ? match[2].toLowerCase() : 'завтра';
      const reminderText = match[3] ? match[3].trim() : null;
      if (!reminderText) {
        logger.warn(`parseReminder: ${errorMessages.missingText}: "${normalizedText}"`);
        return { error: errorMessages.missingText, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      const settings = await UserSettings.findOne({ userId: chatId.toString() }) ||
        { timezone: 'Europe/Moscow', morningTime: '8:00', eveningTime: '18:00' };
      const userZone = settings.timezone;
      const [morningHour, morningMinute] = settings.morningTime.split(':').map(Number);
      const [eveningHour, eveningMinute] = settings.eveningTime.split(':').map(Number);
      let hour, minute;
      if (timeOfDay === 'утром') {
        hour = morningHour;
        minute = morningMinute;
      } else {
        hour = eveningHour;
        minute = eveningMinute;
      }
      let dt = now.setZone(userZone).set({ hour, minute, second: 0, millisecond: 0 });
      const dayOffset = { 'сегодня': 0, 'завтра': 1, 'послезавтра': 2 }[daySpec];
      dt = dt.plus({ days: dayOffset });
      if (dt <= now) {
        logger.warn(`parseReminder: ${errorMessages.timePassed}: ${dt.toISO()}`);
        return { error: errorMessages.timePassed, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      logger.info(`parseReminder: Получена дата: ${dt.toISO()}`);
      return {
        error: null,
        datetime: dt.toJSDate(),
        reminderText,
        timeSpec: `${timeOfDay} ${daySpec} в ${hour}:${minute < 10 ? '0' + minute : minute}`,
        repeat: null
      };
    }
    
    // 2. Абсолютная дата с повторением, например "17 апреля каждый год днюха"
    match = normalizedText.match(absoluteDateRegex);
    if (match) {
      logger.info(`parseReminder: Совпадение с абсолютной датой: ${match}`);
      const day = parseInt(match[1], 10);
      const rawMonthName = match[2].toLowerCase();
      const month = monthNames[rawMonthName];
      if (!month) {
        logger.warn(`parseReminder: ${errorMessages.invalidMonth}: "${rawMonthName}"`);
        return { error: errorMessages.invalidMonth, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      let hour = now.hour;
      let minute = now.minute;
      if (match[3]) {
        const parsed = parseTimeString(match[3]);
        hour = parsed.hour;
        minute = parsed.minute;
      }
      if (isNaN(hour) || isNaN(minute) || hour > 23 || minute > 59) {
        logger.warn(`parseReminder: ${errorMessages.invalidTime}: ${hour}:${minute}`);
        return { error: errorMessages.invalidTime, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      let dt = DateTime.fromObject({ year: now.year, month, day, hour, minute, second: 0, millisecond: 0 }, { zone: MOSCOW_ZONE });
      if (!dt.isValid) {
        logger.warn(`parseReminder: ${errorMessages.invalidDate}: "${match[1]} ${match[2]}"`);
        return { error: errorMessages.invalidDate, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      let repeat = null;
      let reminderText = match[6] ? match[6].trim() : null;
      if (match[4] || match[5]) {
        const multiplier = match[4] ? parseInt(match[4], 10) : 1;
        let periodUnit = fuzzyCorrectUnit(match[5] || '').toLowerCase();
        periodUnit = normalizeWord(periodUnit);
        const validRepeatUnits = ['минута', 'час', 'день', 'неделя', 'месяц', 'год'];
        if (validRepeatUnits.includes(periodUnit)) {
          const correctUnit = multiplier === 1 ? periodUnit : getDeclension(periodUnit, multiplier);
          repeat = multiplier === 1 ? `каждый ${correctUnit}` : `каждые ${multiplier} ${correctUnit}`;
        }
      }
      if (dt < now) {
        dt = repeat && repeat.includes('год') ? dt.plus({ years: 1 }) : dt.plus({ days: 1 });
      }
      if (!reminderText) {
        logger.warn(`parseReminder: ${errorMessages.missingText}: "${normalizedText}"`);
        return { error: errorMessages.missingText, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      logger.info(`parseReminder: Абсолютная дата распознана: ${dt.toISO()} с повторением: ${repeat}`);
      return {
        error: null,
        datetime: dt.toJSDate(),
        reminderText,
        timeSpec: `${day} ${rawMonthName} в ${hour}:${minute < 10 ? '0' + minute : minute}`,
        repeat
      };
    }
    
    // 3. Ежемесячное событие: "каждый месяц 15 числа зарплата"
    match = normalizedText.match(monthlyDayRegex);
    if (match) {
      logger.info(`parseReminder: Совпадение с ежемесячным событием: ${match}`);
      const dayOfMonth = parseInt(match[1], 10);
      if (dayOfMonth < 1 || dayOfMonth > 31) {
        logger.warn(`parseReminder: Некорректное число месяца: "${dayOfMonth}" в тексте: "${normalizedText}"`);
        return { error: errorMessages.invalidDate, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      const timeString = match[3];
      const reminderText = match[4] ? match[4].trim() : null;
      if (!reminderText) {
        logger.warn(`parseReminder: ${errorMessages.missingText} в ежемесячном формате: "${normalizedText}"`);
        return { error: errorMessages.missingText, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      let dt = now.set({ day: dayOfMonth, second: 0, millisecond: 0 });
      if (timeString) {
        const parsed = parseTimeString(timeString);
        dt = dt.set({ hour: parsed.hour, minute: parsed.minute });
      }
      if (dt <= now) dt = dt.plus({ months: 1 });
      logger.info(`parseReminder: Ежемесячное уведомление распознано: ${dt.toISO()}`);
      return {
        error: null,
        datetime: dt.toJSDate(),
        reminderText,
        timeSpec: `каждый месяц ${dayOfMonth} числа${timeString ? ' в ' + dt.toFormat('HH:mm') : ''}`,
        repeat: 'каждый месяц'
      };
    }
    
    // 4. Повторяющееся уведомление (общий случай), например "каждые 30 минут проверка" или "каждый год 17 апреля днюха"
    match = normalizedText.match(repeatRegex);
    if (match) {
      logger.info(`parseReminder: Совпадение с повторяющимся уведомлением: ${match}`);
      const multiplier = match[1] ? parseInt(match[1], 10) : 1;
      let periodUnitRaw = match[2];
      let periodUnit = fuzzyCorrectUnit(periodUnitRaw).toLowerCase();
      periodUnit = normalizeWord(periodUnit);
      const validRepeatUnits = ['минута', 'час', 'день', 'неделя', 'месяц', 'год'];
      if (!validRepeatUnits.includes(periodUnit)) {
        logger.warn(`parseReminder: ${errorMessages.invalidRepeatUnit}: ${periodUnit}`);
        return { error: errorMessages.invalidRepeatUnit, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      const correctUnit = multiplier === 1 ? periodUnit : getDeclension(periodUnit, multiplier);
      const repeatValue = multiplier === 1 ? `каждый ${correctUnit}` : `каждые ${multiplier} ${correctUnit}`;
      let hour = now.hour;
      let minute = now.minute;
      let day = now.day;
      let month = now.month;
      if (match[3] && match[4]) {
        day = parseInt(match[3], 10);
        const rawMonthName = match[4].toLowerCase();
        month = monthNames[rawMonthName];
        if (!month) {
          logger.warn(`parseReminder: ${errorMessages.invalidMonth}: "${rawMonthName}"`);
          return { error: errorMessages.invalidMonth, datetime: null, reminderText: null, timeSpec: null, repeat: null };
        }
      }
      if (match[5]) {
        const parsed = parseTimeString(match[5]);
        hour = parsed.hour;
        minute = parsed.minute;
      }
      if (isNaN(hour) || isNaN(minute) || hour > 23 || minute > 59) {
        logger.warn(`parseReminder: ${errorMessages.invalidTime}: ${hour}:${minute}`);
        return { error: errorMessages.invalidTime, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      let dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (day && month) {
        dt = dt.set({ day, month });
        if (dt.year < now.year) dt = dt.plus({ years: 1 });
      }
      if (dt <= now) {
        if (periodUnit === 'минута') {
          dt = now.plus({ minutes: multiplier });
        } else if (periodUnit === 'час') {
          dt = now.plus({ hours: multiplier });
        } else {
          const periodMap = {
            'день': 'days',
            'неделя': 'weeks',
            'месяц': 'months',
            'год': 'years'
          };
          dt = dt.plus({ [periodMap[periodUnit]]: multiplier });
        }
      }
      const rText = match[6] ? match[6].trim() : null;
      if (!rText) {
        logger.warn(`parseReminder: ${errorMessages.missingText} для повторяющегося события: "${normalizedText}"`);
        return { error: errorMessages.missingText, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      logger.info(`parseReminder: Повторяющееся уведомление: ${dt.toFormat('HH:mm d MMMM yyyy')}`);
      // Если день и месяц заданы, используем rawMonthName для вывода
      let timeSpec;
      if (match[3] && match[4]) {
        timeSpec = `${repeatValue} ${parseInt(match[3], 10)} ${match[4].toLowerCase()} в ${hour}:${minute < 10 ? '0' + minute : minute}`;
      } else {
        timeSpec = `${repeatValue} в ${hour}:${minute < 10 ? '0' + minute : minute}`;
      }
      return {
        error: null,
        datetime: dt.toJSDate(),
        reminderText: rText,
        timeSpec,
        repeat: repeatValue
      };
    }
    
    // 5. Формат разового уведомления "через ..." – если обнаружено абсолютное время, выдаём ошибку
    match = normalizedText.match(throughRegex);
    if (match) {
      logger.info(`parseReminder: Совпадение с форматом "через ...": ${match}`);
      if (match[3]) {
        logger.warn(`parseReminder: ${errorMessages.complexTime}: "${normalizedText}"`);
        return { error: errorMessages.complexTime, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      const number = match[1] ? parseFloat(match[1]) : 1;
      if (number <= 0) {
        logger.warn(`parseReminder: ${errorMessages.nonPositiveDuration}: "${normalizedText}"`);
        return { error: errorMessages.nonPositiveDuration, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      let unit = fuzzyCorrectUnit(match[2].toLowerCase());
      const rText = match[4] ? match[4].trim() : null;
      const unitMap = {
        'минута': 'minutes', 'минуты': 'minutes', 'минут': 'minutes', 'минуту': 'minutes',
        'час': 'hours', 'часа': 'hours', 'часов': 'hours', 'часу': 'hours',
        'день': 'days', 'дня': 'days', 'дней': 'days', 'дню': 'days',
        'неделя': 'weeks', 'недели': 'weeks', 'недель': 'weeks', 'неделю': 'weeks',
        'месяц': 'months', 'месяца': 'months', 'месяцев': 'months',
        'год': 'years', 'года': 'years', 'лет': 'years'
      };
      const durationKey = unitMap[unit] || 'minutes';
      let dt = now.plus({ [durationKey]: number });
      if (!rText) {
        logger.info(`parseReminder: Разовое уведомление без текста: ${dt.toISO()}`);
        return {
          error: null,
          datetime: dt.toJSDate(),
          reminderText: null,
          timeSpec: `через ${number} ${unit}`,
          repeat: null
        };
      }
      logger.info(`parseReminder: Разовое уведомление: ${dt.toISO()}`);
      return {
        error: null,
        datetime: dt.toJSDate(),
        reminderText: rText,
        timeSpec: `через ${number} ${unit}`,
        repeat: null
      };
    }
    
    // 6. Формат "сегодня/завтра/послезавтра" с необязательным временем
    match = normalizedText.match(todayTomorrowRegex);
    if (match) {
      logger.info(`parseReminder: Совпадение с форматом сегодня/завтра/послезавтра: ${match}`);
      const dayOffset = { 'сегодня': 0, 'завтра': 1, 'послезавтра': 2 }[match[1].toLowerCase()];
      let hour = now.hour;
      let minute = now.minute;
      if (match[2]) {
        const parsed = parseTimeString(match[2]);
        hour = parsed.hour;
        minute = parsed.minute;
      }
      if (isNaN(hour) || isNaN(minute) || hour > 23 || minute > 59) {
        logger.warn(`parseReminder: ${errorMessages.invalidTime}: ${hour}:${minute}`);
        return { error: errorMessages.invalidTime, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      const rText = match[3] ? match[3].trim() : null;
      if (!rText) {
        logger.warn(`parseReminder: ${errorMessages.missingText}: "${normalizedText}"`);
        return { error: errorMessages.missingText, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      let dt = now.plus({ days: dayOffset }).set({ hour, minute, second: 0, millisecond: 0 });
      if (dt <= now) {
        logger.warn(`parseReminder: ${errorMessages.timePassed}: ${dt.toISO()}`);
        return { error: errorMessages.timePassed, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      logger.info(`parseReminder: Получена дата: ${dt.toISO()}`);
      return {
        error: null,
        datetime: dt.toJSDate(),
        reminderText: rText,
        timeSpec: `${match[1]} в ${hour}:${minute < 10 ? '0' + minute : minute}`,
        repeat: null
      };
    }
    
    // 7. Форматы с разделителем: "в 10:15 обед"
    let timeWithSeparatorRegex = regexps.timeWithDotRegex;
    match = normalizedText.match(timeWithSeparatorRegex);
    if (match) {
      logger.info(`parseReminder: Совпадение с форматом с разделителем: ${match}`);
      const hour = parseInt(match[1], 10) || 0;
      const minute = parseInt(match[2], 10) || 0;
      if (isNaN(hour) || isNaN(minute) || hour > 23 || minute > 59) {
        logger.warn(`parseReminder: ${errorMessages.invalidTime}: ${hour}:${minute}`);
        return { error: errorMessages.invalidTime, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      const rText = match[3] ? match[3].trim() : null;
      if (!rText) {
        logger.warn(`parseReminder: ${errorMessages.missingText}: "${normalizedText}"`);
        return { error: errorMessages.missingText, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      let dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ days: 1 });
      logger.info(`parseReminder: Получена дата: ${dt.toISO()}`);
      return {
        error: null,
        datetime: dt.toJSDate(),
        reminderText: rText,
        timeSpec: `в ${hour}:${minute < 10 ? '0' + minute : minute}`,
        repeat: null
      };
    }
    
    // 8. Формат числовой без разделителя: "в1015 уборка"
    match = normalizedText.match(regexps.timeNumericRegex);
    if (match) {
      logger.info(`parseReminder: Совпадение с числовым форматом: ${match}`);
      let timeNum = match[1];
      let hour, minute;
      if (timeNum.length === 3) {
        hour = parseInt(timeNum.slice(0, 1), 10) || 0;
        minute = parseInt(timeNum.slice(1), 10) || 0;
      } else {
        hour = parseInt(timeNum.slice(0, 2), 10) || 0;
        minute = parseInt(timeNum.slice(2), 10) || 0;
      }
      if (isNaN(hour) || isNaN(minute) || hour > 23 || minute > 59) {
        logger.warn(`parseReminder: ${errorMessages.invalidTime}: ${hour}:${minute}`);
        return { error: errorMessages.invalidTime, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      const remainingText = match[2].trim();
      let rText = remainingText;
      let repeat = null;
      const repeatMatch = remainingText.match(regexps.repeatRegex);
      if (repeatMatch) {
        logger.info(`parseReminder: Обнаружено повторение после числового формата: ${repeatMatch}`);
        const multiplier = repeatMatch[1] ? parseInt(repeatMatch[1], 10) : 1;
        let periodUnit = fuzzyCorrectUnit(repeatMatch[2]).toLowerCase();
        periodUnit = normalizeWord(periodUnit);
        const validRepeatUnits = ['минута', 'час', 'день', 'неделя', 'месяц', 'год'];
        if (!validRepeatUnits.includes(periodUnit)) {
          logger.warn(`parseReminder: ${errorMessages.invalidRepeatUnit}: ${periodUnit}`);
          return { error: errorMessages.invalidRepeatUnit, datetime: null, reminderText: null, timeSpec: null, repeat: null };
        }
        const correctUnit = multiplier === 1 ? periodUnit : getDeclension(periodUnit, multiplier);
        rText = (repeatMatch[3] && repeatMatch[3].trim()) || null;
        if (!rText) {
          logger.warn(`parseReminder: ${errorMessages.missingText} для повторения: "${normalizedText}"`);
          return { error: errorMessages.missingText, datetime: null, reminderText: null, timeSpec: null, repeat: null };
        }
        repeat = multiplier === 1 ? `каждый ${correctUnit}` : `каждые ${multiplier} ${correctUnit}`;
        let dt = now.set({ hour, minute, second: 0, millisecond: 0 });
        if (dt <= now) {
          if (periodUnit === 'минута') {
            dt = now.plus({ minutes: multiplier });
          } else if (periodUnit === 'час') {
            dt = now.plus({ hours: multiplier });
          } else {
            const periodMap = {
              'день': 'days',
              'неделя': 'weeks',
              'месяц': 'months',
              'год': 'years'
            };
            dt = dt.plus({ [periodMap[periodUnit]]: multiplier });
          }
        }
        logger.info(`parseReminder: Повторяющееся уведомление (числовой формат): ${dt.toFormat('HH:mm')}`);
        return {
          error: null,
          datetime: dt.toJSDate(),
          reminderText: rText,
          timeSpec: `в ${hour}:${minute < 10 ? '0' + minute : minute} ${repeat}`,
          repeat
        };
      }
      if (!rText) {
        logger.warn(`parseReminder: ${errorMessages.missingText}: "${normalizedText}"`);
        return { error: errorMessages.missingText, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      let dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ days: 1 });
      logger.info(`parseReminder: Числовой формат (разовое уведомление): ${dt.toISO()}`);
      return {
        error: null,
        datetime: dt.toJSDate(),
        reminderText: rText,
        timeSpec: `в ${hour}:${minute < 10 ? '0' + minute : minute}`,
        repeat: null
      };
    }
    
    // 9. Формат с пробелом: "в 10 15 ужин"
    match = normalizedText.match(regexps.timeWithSpaceRegex);
    if (match) {
      logger.info(`parseReminder: Совпадение с форматом с пробелом: ${match}`);
      const hour = parseInt(match[1], 10) || 0;
      const minute = parseInt(match[2], 10) || 0;
      if (isNaN(hour) || isNaN(minute) || hour > 23 || minute > 59) {
        logger.warn(`parseReminder: ${errorMessages.invalidTime}: ${hour}:${minute}`);
        return { error: errorMessages.invalidTime, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      const rText = (match[3] && match[3].trim()) || null;
      if (!rText) {
        logger.warn(`parseReminder: ${errorMessages.missingText}: "${normalizedText}"`);
        return { error: errorMessages.missingText, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      let dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ days: 1 });
      logger.info(`parseReminder: Формат с пробелом распознан: ${dt.toISO()}`);
      return {
        error: null,
        datetime: dt.toJSDate(),
        reminderText: rText,
        timeSpec: `в ${hour}:${minute < 10 ? '0' + minute : minute}`,
        repeat: null
      };
    }
    
    // 10. Fallback: формат "в 17 ужин"
    match = normalizedText.match(regexps.simpleTimeRegex);
    if (match) {
      logger.info(`parseReminder: Совпадение с простым форматом: ${match}`);
      const hour = parseInt(match[1], 10) || 0;
      if (isNaN(hour) || hour > 23) {
        logger.warn(`parseReminder: ${errorMessages.invalidTime}: ${hour}:00`);
        return { error: errorMessages.invalidTime, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      const rText = (match[2] && match[2].trim()) || null;
      if (!rText) {
        logger.warn(`parseReminder: ${errorMessages.missingText}: "${normalizedText}"`);
        return { error: errorMessages.missingText, datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      let dt = now.set({ hour, minute: 0, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ days: 1 });
      logger.info(`parseReminder: Простой формат распознан: ${dt.toISO()}`);
      return {
        error: null,
        datetime: dt.toJSDate(),
        reminderText: rText,
        timeSpec: `в ${hour}:00`,
        repeat: null
      };
    }
    
    logger.warn(`parseReminder: ${errorMessages.unknownFormat}: "${normalizedText}"`);
    return { error: errorMessages.unknownFormat, datetime: null, reminderText: null, timeSpec: null, repeat: null };
    
  } catch (error) {
    logger.error(`parseReminder: Ошибка обработки текста "${text}": ${error.message}`);
    return { error: `Произошла ошибка: ${error.message}`, datetime: null, reminderText: null, timeSpec: null, repeat: null };
  }
}

module.exports = {
  normalizeWord,
  parseTimeString,
  normalizeTimeExpressions,
  parseDate,
  parseReminder,
  computeNextTimeFromScheduled,
  transformRepeatToAgenda,
  getDeclension
};