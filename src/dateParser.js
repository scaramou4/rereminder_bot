/**
 * dateParser.js
 *
 * Модуль для нормализации временных выражений и парсинга дат с использованием Luxon.
 * Поддерживаются варианты:
 *   1. "каждый/каждая/каждое/каждые [<число>] <период> [в <час>(:<минут>)] <текст>"
 *   2. "через [<число>] <единица> <текст>"
 *   3. "завтра [в <час>(:<минут>)] <текст>"
 *   4. "послезавтра [в <час>(:<минут>)] <текст>"
 *   5. Форматы вида "в 10:15 тест", "в1015 тест", "в 10.15 тест", а также "в 17 ужин"
 *
 * Все вычисления проводятся с учетом московской зоны.
 */

const { DateTime } = require('luxon');

const MOSCOW_ZONE = 'Europe/Moscow';

//////////////////////
// Нормализация единиц и дней недели
//////////////////////

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

//////////////////////
// Фуззи-коррекция и склонение
//////////////////////

const fuzzyCorrections = {
  'миут': 'минута',
  'миют': 'минута',
  'миу': 'минута',
  'полсезавтра': 'послезавтра'
};

function fuzzyCorrectUnit(word) {
  const lower = word.toLowerCase();
  return fuzzyCorrections[lower] || word;
}

const unitDeclensions = {
  'минута': { one: 'минута', few: 'минуты', many: 'минут' },
  'час': { one: 'час', few: 'часа', many: 'часов' },
  'день': { one: 'день', few: 'дня', many: 'дней' },
  'неделя': { one: 'неделя', few: 'недели', many: 'недель' },
  'месяц': { one: 'месяц', few: 'месяца', many: 'месяцев' },
  'год': { one: 'год', few: 'года', many: 'лет' }
};

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

//////////////////////
// Преобразование повторяющегося интервала для Agenda
//////////////////////

function transformRepeatToAgenda(russianRepeat) {
  // Предполагаем, что russianRepeat имеет вид: "2 недели", "год", "день" и т.д.
  let multiplier = 1;
  let unit = russianRepeat;
  const parts = russianRepeat.split(" ");
  if (parts.length === 2) {
    multiplier = parseInt(parts[0], 10);
    unit = parts[1];
  }
  // Маппинг для перевода единиц с русского на английский (в единственном числе)
  const mapping = {
    'минута': 'minute',
    'час': 'hour',
    'день': 'day',
    'неделя': 'week',
    'месяц': 'month',
    'год': 'year'
  };
  // Приводим unit к нормальной форме, если возможно
  unit = unit.toLowerCase();
  const englishUnit = mapping[unit] || unit;
  if (multiplier > 1) {
    return `${multiplier} ${englishUnit}s`;
  }
  return `${multiplier} ${englishUnit}`;
}

//////////////////////
// Основные функции парсинга
//////////////////////

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
 * Вычисляет следующее время повторения в московской зоне.
 * Для повторов по дням недели, месяцам и годам всегда прибавляется полный период.
 */
function computeNextTimeFromScheduled(scheduledTime, repeat) {
  const dt = DateTime.fromJSDate(scheduledTime, { zone: MOSCOW_ZONE });
  if (repeat in dayNameToWeekday) {
    return dt.plus({ weeks: 1 }).toJSDate();
  }
  const match = repeat.match(/^(\d+)?\s*(минут(?:а|ы|у)|час(?:а|ов|у)?|день(?:я|ей)?|недель(?:я|и|ю|)?|месяц(?:а|ев)?|год(?:а|ов)?)/i);
  let multiplier = 1;
  let unit = repeat;
  if (match) {
    if (match[1]) {
      multiplier = parseInt(match[1], 10);
    }
    unit = fuzzyCorrectUnit(match[2]).toLowerCase();
    unit = normalizeWord(unit);
  }
  
  if (unit.match(/^минут/)) {
    return dt.plus({ minutes: multiplier }).toJSDate();
  } else if (unit.match(/^час/)) {
    return dt.plus({ hours: multiplier }).toJSDate();
  } else if (unit.match(/^день/)) {
    return dt.plus({ days: multiplier }).toJSDate();
  } else if (unit.match(/^неделя/)) {
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
 * Текущее время берётся в московской зоне с сохранением локального времени.
 * Для повторяющихся напоминаний с указанным временем, если время уже прошло,
 * для единиц "неделя", "месяц", "год" прибавляется соответствующий период.
 */
function parseReminder(text) {
  const normalizedText = normalizeTimeExpressions(text);
  const now = DateTime.now().setZone(MOSCOW_ZONE, { keepLocalTime: true });
  
  // 1. Повторяющееся уведомление: "каждый/каждая/каждое/каждые [N] <период> [в <час>(:<минут>)] <текст>"
  const repeatRegex = /^кажд(?:ый|ая|ую|ое|ые)(?:\s+(\d+))?\s+([А-Яа-яёЁ]+)(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/iu;
  let match = normalizedText.match(repeatRegex);
  if (match) {
    const multiplier = match[1] ? parseInt(match[1], 10) : 1;
    let periodUnitRaw = match[2];
    let periodUnit = fuzzyCorrectUnit(periodUnitRaw);
    periodUnit = normalizeWord(periodUnit);
    const correctUnit = multiplier === 1 ? periodUnit : getDeclension(periodUnit, multiplier);
    const reminderText = match[5].trim();
    const repeatValue = multiplier === 1 ? periodUnit : `${multiplier} ${correctUnit}`;
    let dt;
    if (!match[3]) {
      if (periodUnit in dayNameToWeekday) {
        const target = dayNameToWeekday[periodUnit];
        let diff = target - now.weekday;
        // Если день совпадает, всегда +7 дней (начало цикла)
        if (diff <= 0) diff += 7;
        dt = now.plus({ days: diff });
      } else {
        dt = now;
      }
      const formattedTime = dt.toFormat('HH:mm');
      return {
        datetime: dt.toJSDate(),
        reminderText,
        timeSpec: `каждый ${repeatValue} начиная с ${formattedTime}`,
        repeat: repeatValue
      };
    } else {
      const hour = parseInt(match[3], 10);
      const minute = match[4] ? parseInt(match[4], 10) : 0;
      dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      // Для повторов "неделя", "месяц", "год" прибавляем период, если время уже прошло
      if (["неделя", "месяц", "год"].includes(periodUnit)) {
        if (dt <= now) {
          if (periodUnit === "неделя") dt = dt.plus({ weeks: 1 });
          else if (periodUnit === "месяц") dt = dt.plus({ months: 1 });
          else if (periodUnit === "год") dt = dt.plus({ years: 1 });
        }
      } else {
        if (dt <= now) {
          dt = dt.plus({ days: 1 });
        }
      }
      return {
        datetime: dt.toJSDate(),
        reminderText,
        timeSpec: `каждый ${repeatValue} в ${hour}:${minute < 10 ? '0' + minute : minute}`,
        repeat: repeatValue
      };
    }
  }
  
  // 2. Разовое уведомление "через ..."
  const throughRegex = /^через\s+(?:(\d+(?:\.\d+)?)\s+)?([A-Za-zА-Яа-яёЁ]+)\s+(.+)/i;
  match = normalizedText.match(throughRegex);
  if (match) {
    const number = match[1] ? parseFloat(match[1]) : 1;
    let unit = fuzzyCorrectUnit(match[2].toLowerCase());
    const reminderText = match[3].trim();
    const unitMap = {
      'минута': 'minutes', 'минуты': 'minutes', 'минут': 'minutes', 'минуту': 'minutes',
      'час': 'hours', 'часа': 'hours', 'часов': 'hours', 'часу': 'hours',
      'день': 'days', 'дня': 'days', 'дней': 'days', 'дню': 'days',
      'неделя': 'weeks', 'недели': 'weeks', 'недель': 'weeks', 'неделю': 'weeks',
      'месяц': 'months', 'месяца': 'months', 'месяцев': 'months',
      'год': 'years', 'года': 'years', 'лет': 'years'
    };
    const durationKey = unitMap[unit] || 'minutes';
    const parsedDate = now.plus({ [durationKey]: number }).toJSDate();
    return {
      datetime: parsedDate,
      reminderText,
      timeSpec: `${number} ${unit}`,
      repeat: null
    };
  }
  
  // 3. "завтра ..." 
  const tomorrowRegex = /^завтра(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/i;
  match = normalizedText.match(tomorrowRegex);
  if (match) {
    const hour = match[1] ? parseInt(match[1], 10) : now.hour;
    const minute = match[2] ? parseInt(match[2], 10) : now.minute;
    const reminderText = match[3].trim();
    const dt = now.plus({ days: 1 }).set({ hour, minute, second: 0, millisecond: 0 });
    return {
      datetime: dt.toJSDate(),
      reminderText,
      timeSpec: `завтра в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }
  
  // 4. "послезавтра ..." (также поддержка "полсезавтра")
  const dayAfterTomorrowRegex = /^(послезавтра|полсезавтра)(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/i;
  match = normalizedText.match(dayAfterTomorrowRegex);
  if (match) {
    const hour = match[2] ? parseInt(match[2], 10) : now.hour;
    const minute = match[3] ? parseInt(match[3], 10) : now.minute;
    const reminderText = match[4].trim();
    const dt = now.plus({ days: 2 }).set({ hour, minute, second: 0, millisecond: 0 });
    return {
      datetime: dt.toJSDate(),
      reminderText,
      timeSpec: `послезавтра в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }
  
  // 5. Форматы, начинающиеся с "в":
  // 5.1 Формат с разделителем, например, "в 10:15 тест" или "в 10.15 тест"
  const timeWithSeparatorRegex = /^в\s*(\d{1,2})\s*[:.,]\s*(\d{1,2})\s+(.+)/i;
  match = normalizedText.match(timeWithSeparatorRegex);
  if (match) {
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const reminderText = match[3].trim();
    let dt = now.set({ hour, minute, second: 0, millisecond: 0 });
    if (dt <= now) dt = dt.plus({ days: 1 });
    return {
      datetime: dt.toJSDate(),
      reminderText,
      timeSpec: `в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }
  
  // 5.2 Формат числовой без разделителя, например, "в1015 тест"
  const timeNumericRegex = /^в\s*(\d{3,4})\s+(.+)/i;
  match = normalizedText.match(timeNumericRegex);
  if (match) {
    const timeNum = match[1];
    let hour, minute;
    if (timeNum.length === 3) {
      hour = parseInt(timeNum.slice(0, 1), 10);
      minute = parseInt(timeNum.slice(1), 10);
    } else {
      hour = parseInt(timeNum.slice(0, 2), 10);
      minute = parseInt(timeNum.slice(2), 10);
    }
    const reminderText = match[2].trim();
    let dt = now.set({ hour, minute, second: 0, millisecond: 0 });
    if (dt <= now) dt = dt.plus({ days: 1 });
    return {
      datetime: dt.toJSDate(),
      reminderText,
      timeSpec: `в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }
  
  // 5.3 Фолбэк вариант для формата "в <час> <текст>" (например, "в 17 ужин")
  const timeOnlyRegex = /^в\s+(\d{1,2})\s+(.+)/i;
  match = normalizedText.match(timeOnlyRegex);
  if (match) {
    const hour = parseInt(match[1], 10);
    const reminderText = match[2].trim();
    let dt = now.set({ hour, minute: 0, second: 0, millisecond: 0 });
    if (dt <= now) dt = dt.plus({ days: 1 });
    return {
      datetime: dt.toJSDate(),
      reminderText,
      timeSpec: `в ${hour}:00`,
      repeat: null
    };
  }
  
  console.warn(`parseReminder: Не удалось распознать входной текст: "${text}"`);
  return { datetime: null, reminderText: null, timeSpec: null, repeat: null };
}

module.exports = {
  normalizeWord,
  normalizeTimeExpressions,
  parseDate,
  parseReminder,
  computeNextTimeFromScheduled,
  transformRepeatToAgenda
};