/**
 * dateParser.js
 *
 * Модуль для нормализации временных выражений и парсинга дат с использованием Luxon.
 * Поддерживаются варианты:
 *   1. "кажд(?:ый|ую|дые) [<число>] <период> [в <час>(:<минут>)] <текст>" – повторяющееся уведомление.
 *      Примеры: "каждую минуту тест", "каждую 1 минуту тест", "каждую 2 минуты тест"
 *   2. "через [<число>] <единица> <текст>" – разовое уведомление.
 *   3. "завтра [в <час>(:<минут>)] <текст>"
 *   4. "послезавтра [в <час>(:<минут>)] <текст>"
 *   5. "в <час> [час(ов)] [<минут> минут] <текст>" и числовой формат ("в 1015" или "в 10 15 тест")
 *
 * Если время не указано для повторяющихся уведомлений, вычисляется время первого срабатывания как текущее время (в московской зоне).
 */

const { DateTime } = require('luxon');

const MOSCOW_ZONE = 'Europe/Moscow';

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
 * Вычисляет следующее время повторения, учитывая множитель (если задан) и единицу.
 * Например, для "минуту" или "2 минуты" прибавляет 1 или 2 минуты соответственно.
 * Все вычисления проводятся в часовом поясе "Europe/Moscow".
 */
function computeNextTimeFromScheduled(scheduledTime, repeat) {
  const dt = DateTime.fromJSDate(scheduledTime, { zone: MOSCOW_ZONE });
  const match = repeat.match(/^(\d+)?\s*(минут(?:а|ы|у)|час(?:а|ов|у)?|день(?:я|ей)?|недел(?:я|и|ю)?|месяц(?:а|ев)?|год(?:а|ов)?)$/i);
  let multiplier = 1;
  let unit = repeat;
  if (match) {
    if (match[1]) {
      multiplier = parseInt(match[1], 10);
    }
    unit = match[2].toLowerCase();
  }
  
  if (unit.match(/^минут/)) {
    return dt.plus({ minutes: multiplier }).toJSDate();
  } else if (unit.match(/^час/)) {
    return dt.plus({ hours: multiplier }).toJSDate();
  } else if (unit.match(/^день/)) {
    return dt.plus({ days: multiplier }).toJSDate();
  } else if (unit.match(/^недел/)) {
    return dt.plus({ weeks: multiplier }).toJSDate();
  } else if (unit.match(/^месяц/)) {
    return dt.plus({ months: multiplier }).toJSDate();
  } else if (unit.match(/^год/)) {
    return dt.plus({ years: multiplier }).toJSDate();
  } else {
    return dt.plus({ days: 1 }).toJSDate();
  }
}

/**
 * Парсит строку напоминания.
 */
function parseReminder(text) {
  const normalizedText = normalizeTimeExpressions(text);
  // Используем текущую дату в московской зоне
  const now = DateTime.local().setZone(MOSCOW_ZONE);

  // 1. Обработка повторяющегося уведомления.
  const repeatRegex = /^кажд(?:ый|ую|дые)(?:\s+(\d+))?\s+([А-Яа-яёЁ]+)(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/iu;
  let match = normalizedText.match(repeatRegex);
  if (match) {
    const multiplier = match[1] ? parseInt(match[1], 10) : 1;
    const periodUnit = match[2].toLowerCase();
    const reminderText = match[5].trim();
    const repeatValue = multiplier === 1 ? periodUnit : `${multiplier} ${periodUnit}`;
    let dt;
    if (!match[3]) {
      // Если время не указано, первое событие происходит в текущий момент
      dt = now;
      const formattedTime = dt.toFormat('HH:mm');
      return {
        datetime: dt.toJSDate(),
        reminderText: reminderText,
        timeSpec: `каждый ${repeatValue} начиная с ${formattedTime}`,
        repeat: repeatValue
      };
    } else {
      const hour = parseInt(match[3], 10);
      const minute = match[4] ? parseInt(match[4], 10) : 0;
      dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (dt <= now) {
        dt = dt.plus({ days: 1 });
      }
      return {
        datetime: dt.toJSDate(),
        reminderText: reminderText,
        timeSpec: `каждый ${repeatValue} в ${hour}:${minute < 10 ? '0' + minute : minute}`,
        repeat: repeatValue
      };
    }
  }
  
  // 2. Обработка разового уведомления "через ..."
  const throughRegex = /^через\s+(?:(\d+(?:\.\d+)?)\s+)?([A-Za-zА-Яа-яёЁ]+)\s+(.+)/i;
  match = normalizedText.match(throughRegex);
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
      'дню': 'days',
      'неделя': 'weeks',
      'недели': 'weeks',
      'недель': 'weeks',
      'неделю': 'weeks',
      'месяц': 'months',
      'месяца': 'months',
      'месяцев': 'months',
      'год': 'years',
      'года': 'years',
      'лет': 'years'
    };
    const durationKey = unitMap[unit] || 'minutes';
    const parsedDate = now.plus({ [durationKey]: number }).toJSDate();
    return {
      datetime: parsedDate,
      reminderText: reminderText,
      timeSpec: `${number} ${unit}`,
      repeat: null
    };
  }
  
  // 3. Обработка "завтра [в <час>(:<минут>)] <текст>"
  const tomorrowRegex = /^завтра(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/i;
  match = normalizedText.match(tomorrowRegex);
  if (match) {
    const hour = match[1] ? parseInt(match[1], 10) : now.hour;
    const minute = match[2] ? parseInt(match[2], 10) : 0;
    const reminderText = match[3].trim();
    const dt = now.plus({ days: 1 }).set({ hour, minute, second: 0, millisecond: 0 });
    return {
      datetime: dt.toJSDate(),
      reminderText: reminderText,
      timeSpec: `завтра в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }
  
  // 4. Обработка "послезавтра [в <час>(:<минут>)] <текст>"
  const dayAfterTomorrowRegex = /^послезавтра(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/i;
  match = normalizedText.match(dayAfterTomorrowRegex);
  if (match) {
    const hour = match[1] ? parseInt(match[1], 10) : now.hour;
    const minute = match[2] ? parseInt(match[2], 10) : 0;
    const reminderText = match[3].trim();
    const dt = now.plus({ days: 2 }).set({ hour, minute, second: 0, millisecond: 0 });
    return {
      datetime: dt.toJSDate(),
      reminderText: reminderText,
      timeSpec: `послезавтра в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }
  
  // 5. Обработка формата "в <час> [час(ов)] [<минут> минут] <текст>" и числовой формат ("в 1015" или "в 10 15 тест")
  const timeOnlyRegex = /^в\s+(\d{1,2})(?:(?:\s*(?:час(?:ов|а)?))\s*(\d{1,2})\s*(?:минут(?:ы|))?)?\s+(.+)/i;
  match = normalizedText.match(timeOnlyRegex);
  if (match) {
    const hour = parseInt(match[1], 10);
    const minute = match[2] ? parseInt(match[2], 10) : 0;
    const reminderText = match[3].trim();
    if (!reminderText) {
      return {
        datetime: now.set({ hour, minute, second: 0, millisecond: 0 }).toJSDate(),
        reminderText: null,
        timeSpec: `в ${hour}:${minute < 10 ? '0' + minute : minute}`,
        repeat: null
      };
    }
    let dt = now.set({ hour, minute, second: 0, millisecond: 0 });
    if (dt <= now) dt = dt.plus({ days: 1 });
    return {
      datetime: dt.toJSDate(),
      reminderText: reminderText,
      timeSpec: `в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }
  
  return { datetime: null, reminderText: null, timeSpec: null, repeat: null };
}

module.exports = {
  normalizeWord,
  normalizeTimeExpressions,
  parseDate,
  parseReminder,
  computeNextTimeFromScheduled
};