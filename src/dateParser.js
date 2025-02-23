/**
 * dateParser.js
 *
 * Модуль для нормализации временных выражений и парсинга дат с использованием Luxon.
 * Поддерживаются:
 *  1. Повторяющиеся уведомления: "каждый/каждая/каждое/каждые [<число>] <период> [в <час>(:<минут>)] <текст>"
 *  2. Разовые уведомления: "через [<число>] <единица> [в <час>(:<минут>)] <текст>"
 *  3. Относительные даты: "завтра ..." и "послезавтра ..." (также "полсезавтра")
 *  4. Форматы вида "в 10:15 тест", "в1015 тест", "в 17 ужин"
 *  5. Абсолютные даты: "25 февраля в 10 тест" – если время не указано, подставляем текущее время
 *  6. Абсолютное событие по дню недели: допускаются варианты с префиксом ("в(о) вторник в 10 тест")
 *     и без него ("вторник 15 тест") – в последнем случае число сразу после дня недели интерпретируется как час.
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
  'полсезавтра': 'послезавтра',
  'неделы': 'неделя'
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
  let multiplier = 1;
  let unit = russianRepeat.trim();
  const parts = russianRepeat.trim().split(" ");
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
    'минута': 'minute',
    'час': 'hour',
    'день': 'day',
    'неделя': 'week',
    'месяц': 'month',
    'год': 'year'
  };
  const englishUnit = mapping[unit] || unit;
  return multiplier > 1 ? `${multiplier} ${englishUnit}s` : `${multiplier} ${englishUnit}`;
}

//////////////////////
// Новые ветки для абсолютных дат и абсолютных дней недели
//////////////////////

// Абсолютная дата: "25 февраля в 10 тест"
// Если время не указано, подставляем текущее время, но если указан час, минуты по умолчанию равны 0.
const absoluteDateRegex = /^(\d{1,2})\s+([а-яё]+)(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/i;
const monthNames = {
  'января': 1,
  'февраля': 2,
  'марта': 3,
  'апреля': 4,
  'мая': 5,
  'июня': 6,
  'июля': 7,
  'августа': 8,
  'сентября': 9,
  'октября': 10,
  'ноября': 11,
  'декабря': 12
};

// Абсолютное событие по дню недели с префиксом "в" или "во": "в(о)? вторник в 10 тест"
// Абсолютное событие по дню недели без префикса: "вторник 15 тест"
// Объединяем оба варианта в один регекс:
const absoluteWeekdayRegex = /^(?:в(?:о)?\s+)?(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)(?:\s+(?:в\s*)?(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/i;

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
 * Для дней недели, месяцев и годов прибавляется полный период.
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
    if (match[1]) multiplier = parseInt(match[1], 10);
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
 * Приоритет:
 *   1. Абсолютная дата (например, "25 февраля в 10 тест")
 *   2. Абсолютное событие по дню недели (например, "вторник 15 тест")
 *   3. Повторяющиеся уведомления
 *   4. Разовые уведомления "через ..."
 *   5. Относительные: "завтра", "послезавтра", "полсезавтра"
 *   6. Форматы, начинающиеся с "в"
 */
function parseReminder(text) {
  const normalizedText = normalizeTimeExpressions(text);
  const now = DateTime.now().setZone(MOSCOW_ZONE, { keepLocalTime: true });
  
  // 0. Абсолютная дата: "25 февраля в 10 тест"
  let match = normalizedText.match(absoluteDateRegex);
  if (match) {
    const day = parseInt(match[1], 10);
    const monthName = match[2].toLowerCase();
    const month = monthNames[monthName];
    if (!month) {
      console.warn(`parseReminder: Не удалось распознать месяц: "${match[2]}"`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null };
    }
    // Если время не указано, используем текущие часы и минуты
    const hour = match[3] ? parseInt(match[3], 10) : now.hour;
    const minute = match[3] ? (match[4] ? parseInt(match[4], 10) : 0) : now.minute;
    let dt = DateTime.fromObject({ year: now.year, month, day, hour, minute, second: 0, millisecond: 0 }, { zone: MOSCOW_ZONE });
    if (!dt.isValid) {
      console.warn(`parseReminder: Введена недопустимая дата: "${match[1]} ${match[2]}"`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null };
    }
    if (dt < now) {
      dt = dt.plus({ years: 1 });
    }
    return {
      datetime: dt.toJSDate(),
      reminderText: match[5].trim(),
      timeSpec: `${day} ${match[2]} в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }
  
  // 1. Абсолютное событие по дню недели (с или без префикса): "вторник 15 тест" или "в(о) вторник в 10 тест"
  match = normalizedText.match(absoluteWeekdayRegex);
  if (match) {
    const weekday = match[1].toLowerCase();
    const target = dayNameToWeekday[weekday];
    // Если число после дня недели отсутствует, используем текущее время; иначе, если оно присутствует, трактуем как час.
    const hour = match[2] ? parseInt(match[2], 10) : now.hour;
    const minute = match[3] ? parseInt(match[3], 10) : 0;
    const reminderText = match[4].trim();
    let dt = now;
    while (dt.weekday !== target) {
      dt = dt.plus({ days: 1 });
    }
    dt = dt.set({ hour, minute, second: 0, millisecond: 0 });
    if (dt <= now) {
      dt = dt.plus({ weeks: 1 });
    }
    return {
      datetime: dt.toJSDate(),
      reminderText,
      timeSpec: `${weekday} в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }
  
  // 2. Повторяющееся уведомление: "каждый/каждая/каждое/каждые [N] <период> [в <час>(:<минут>)] <текст>"
  const repeatRegex = /^кажд(?:ый|ая|ую|ое|ые)(?:\s+(\d+))?\s+([А-Яа-яёЁ]+)(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/iu;
  match = normalizedText.match(repeatRegex);
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
        if (diff <= 0) diff += 7;
        // Для повторов с указанием дня недели без времени, устанавливаем первую дату как now.plus({weeks: multiplier})
        dt = now.plus({ weeks: multiplier });
      } else {
        // Для остальных, первая дата – текущее время плюс период
        const periodMap = {
          'минута': { unit: 'minutes' },
          'час': { unit: 'hours' },
          'день': { unit: 'days' },
          'неделя': { unit: 'weeks' },
          'месяц': { unit: 'months' },
          'год': { unit: 'years' }
        };
        if (periodMap[periodUnit]) {
          dt = now.plus({ [periodMap[periodUnit].unit]: multiplier });
        } else {
          dt = now;
        }
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
      if (hour < 0 || hour > 23) {
        console.warn(`parseReminder: Недопустимое значение часа: ${hour}`);
        return { datetime: null, reminderText: null, timeSpec: null, repeat: null };
      }
      if (periodUnit in dayNameToWeekday) {
        const target = dayNameToWeekday[periodUnit];
        let diff = target - now.weekday;
        if (diff <= 0) diff += 7;
        dt = now.plus({ days: diff }).set({ hour, minute, second: 0, millisecond: 0 });
      } else if (["неделя", "месяц", "год"].includes(periodUnit)) {
        dt = now.set({ hour, minute, second: 0, millisecond: 0 });
        if (dt <= now) {
          if (periodUnit === "неделя") dt = dt.plus({ weeks: multiplier });
          else if (periodUnit === "месяц") dt = dt.plus({ months: multiplier });
          else if (periodUnit === "год") dt = dt.plus({ years: multiplier });
        }
      } else {
        dt = now.set({ hour, minute, second: 0, millisecond: 0 });
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
  
  // 3. Разовое уведомление "через ..." – обновленный регекс с опциональным временем
  const throughRegex = /^через\s+(?:(\d+(?:\.\d+)?)\s+)?([A-Za-zА-Яа-яёЁ]+)(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/i;
  match = normalizedText.match(throughRegex);
  if (match) {
    const number = match[1] ? parseFloat(match[1]) : 1;
    let unit = fuzzyCorrectUnit(match[2].toLowerCase());
    const reminderText = match[5].trim();
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
    // Если время указано в этой ветке, переустанавливаем часы и минуты
    if (match[3]) {
      const hour = parseInt(match[3], 10);
      const minute = match[4] ? parseInt(match[4], 10) : 0;
      dt = dt.set({ hour, minute, second: 0, millisecond: 0 });
    }
    return {
      datetime: dt.toJSDate(),
      reminderText,
      timeSpec: `через ${number} ${unit}${match[3] ? ` в ${match[3]}:${match[4] ? match[4].padStart(2, '0') : '00'}` : ''}`,
      repeat: null
    };
  }
  
  // 4. "завтра ..." 
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
  
  // 5. "послезавтра ..." (также "полсезавтра")
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
  
  // 6. Форматы, начинающиеся с "в":
  // 6.1 Формат с разделителем: "в 10:15 тест" или "в 10.15 тест"
  const timeWithSeparatorRegex = /^в\s*(\d{1,2})\s*[:.,]\s*(\d{1,2})\s+(.+)/i;
  match = normalizedText.match(timeWithSeparatorRegex);
  if (match) {
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    if (hour < 0 || hour > 23) {
      console.warn(`parseReminder: Недопустимое значение часа: ${hour}`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null };
    }
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
  
  // 6.2 Формат числовой без разделителя: "в1015 тест"
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
    if (hour < 0 || hour > 23) {
      console.warn(`parseReminder: Недопустимое значение часа: ${hour}`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null };
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
  
  // 6.3 Фолбэк вариант для "в <час> <текст>": например, "в 17 ужин"
  const timeOnlyRegex = /^в\s+(\d{1,2})\s+(.+)/i;
  match = normalizedText.match(timeOnlyRegex);
  if (match) {
    const hour = parseInt(match[1], 10);
    if (hour < 0 || hour > 23) {
      console.warn(`parseReminder: Недопустимое значение часа: ${hour}`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null };
    }
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