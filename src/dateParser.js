const { DateTime } = require('luxon');
const logger = require('./logger');

const MOSCOW_ZONE = 'Europe/Moscow';

const timeUnitNormalization = {
  'месяц': ['месяц', 'месяца', 'месяцев'],
  'неделя': ['неделя', 'недели', 'недель', 'неделю'],
  'год': ['год', 'года', 'лет'],
  'час': ['час', 'часа', 'часов', 'часу'],
  'день': ['день', 'дня', 'дней', 'дню']
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
  'воскресенье': ['воскресенье', 'воскресенья', 'воскресенью', 'воскресеньем', 'воскресенье']
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

const fuzzyCorrections = {
  'миут': 'минута',
  'миют': 'минута',
  'миу': 'минута',
  'полсезавтра': 'послезавтра',
  'неделы': 'неделя',
  'кажый': 'каждый'
};

const monthNames = {
  'январь': 1, 'января': 1, 'январе': 1,
  'февраль': 2, 'февраля': 2, 'феврале': 2,
  'март': 3, 'марта': 3, 'марте': 3,
  'апрель': 4, 'апреля': 4, 'апреле': 4,
  'май': 5, 'мая': 5, 'мае': 5,
  'июнь': 6, 'июня': 6, 'июне': 6,
  'июль': 7, 'июля': 7, 'июле': 7,
  'август': 8, 'августа': 8, 'августе': 8,
  'сентябрь': 9, 'сентября': 9, 'сентябре': 9,
  'октябрь': 10, 'октября': 10, 'октябре': 10,
  'ноябрь': 11, 'ноября': 11, 'ноябре': 11,
  'декабрь': 12, 'декабря': 12, 'декабре': 12
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

// Регулярные выражения

// Абсолютная дата, например: "25 февраля в 10 тест"
const absoluteDateRegex = /^(\d{1,2})\s+([а-яё]+)(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/i;

// День недели, например: "понедельник в 10 встреча"
const absoluteWeekdayRegex = /^(?:в(?:о)?\s+)?(понедельник[ауи]?|вторник[ауи]?|сред[ауы]|четверг[ауи]?|пятниц[ауы]|суббот[ауы]|воскресень[еи])(?:\s+(?:в\s*)?(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/i;

// Повторяющееся уведомление, например: "каждый 3 часа тест"
const repeatRegex = /^кажд(?:ый|ая|ую|ое|ые)(?:\s+(\d+))?\s+([А-Яа-яёЁ]+)(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/iu;

// Разовое уведомление через, например: "через 10 минут купить молоко"
const throughRegex = /^через\s+(?:(\d+(?:\.\d+)?)\s+)?([A-Za-zА-Яа-яёЁ]+)(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s*(.+)?$/i;

// Сегодня, завтра, послезавтра
const todayTomorrowRegex = /^(сегодня|завтра|послезавтра)(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/i;

// Новый шаблон для формата с точкой, например: "в 10.15 обед"
const timeWithDotRegex = /^в\s*(\d{1,2})[.](\d{1,2})\s+(.+)/i;

// Обновлённый числовой формат без разделителя: "в1015 уборка"
const timeNumericRegex = /^в\s*(\d{3,4})(?:\s+(.+))?$/i;

// Новый шаблон для формата с пробелом между часами и минутами, например: "в 10 15 ужин"
const timeWithSpaceRegex = /^в\s*(\d{1,2})\s+(\d{1,2})\s+(.+)/i;

// Новый fallback-шаблон: "в 17 ужин" (без указания минут)
const simpleTimeRegex = /^в\s*(\d{1,2})\s+(.+)/i;

function normalizeWord(word) {
  const lowerWord = word.toLowerCase();
  logger.info(`normalizeWord: Нормализация слова: ${lowerWord}`);
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
  const normalized = errorForms[lowerWord] || word;
  logger.info(`normalizeWord: Нормализованное слово: ${normalized}`);
  return normalized;
}

function normalizeTimeExpressions(text) {
  const regex = new RegExp(`\\b(${Object.keys(timeUnitMap).concat(Object.keys(dayOfWeekMap)).join('|')})\\b`, 'gi');
  logger.info(`normalizeTimeExpressions: Исходный текст: ${text}`);
  const normalized = text.replace(regex, (match) => normalizeWord(match));
  logger.info(`normalizeTimeExpressions: Нормализованный текст: ${normalized}`);
  return normalized;
}

function parseDate(text, format) {
  const normalizedText = normalizeTimeExpressions(text);
  logger.info(`parseDate: Парсинг текста: ${normalizedText}, формат: ${format}`);
  return DateTime.fromFormat(normalizedText, format, { locale: 'ru' });
}

function computeNextTimeFromScheduled(scheduledTime, repeat) {
  const dt = DateTime.fromJSDate(scheduledTime, { zone: MOSCOW_ZONE });
  if (repeat in dayNameToWeekday) {
    return dt.plus({ weeks: 1 }).toJSDate();
  }
  const match = repeat.match(/^(\d+)?\s*(минут(?:а|ы|у)|час(?:а|ов|у)?|день(?:я|ей)?|неделя(?:я|и|ю)?|месяц(?:а|ев)?|год(?:а|ов)?)/i);
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

function parseReminder(text) {
  logger.info(`parseReminder: Входной текст: ${text}`);
  const normalizedText = normalizeTimeExpressions(text);
  const now = DateTime.now().setZone(MOSCOW_ZONE, { keepLocalTime: true });
  
  // 0. Абсолютная дата: "25 февраля в 10 тест"
  let match = normalizedText.match(absoluteDateRegex);
  if (match) {
    logger.info(`parseReminder: Совпадение с абсолютной датой: ${match}`);
    const day = parseInt(match[1], 10);
    const monthName = match[2].toLowerCase();
    const month = monthNames[monthName]; // Используем маппинг месяцев
    if (!month) {
      logger.warn(`parseReminder: Не удалось распознать месяц: "${monthName}"`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null, error: 'Некорректный месяц' };
    }
    const hour = match[3] ? parseInt(match[3], 10) : now.hour;
    const minute = match[3] ? (match[4] ? parseInt(match[4], 10) : 0) : now.minute;
    if (hour > 23 || minute > 59) {
      logger.warn(`parseReminder: Недопустимое время: ${hour}:${minute}`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null, error: 'Недопустимое время (часы должны быть 0–23, минуты 0–59)' };
    }
    let dt = DateTime.fromObject({ year: now.year, month, day, hour, minute, second: 0, millisecond: 0 }, { zone: MOSCOW_ZONE });
    if (!dt.isValid) {
      logger.warn(`parseReminder: Введена недопустимая дата: "${match[1]} ${match[2]}"`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null, error: 'Недопустимая дата' };
    }
    if (dt < now) {
      dt = dt.plus({ years: 1 });
    }
    logger.info(`parseReminder: Абсолютная дата распознана: ${dt.toISO()}`);
    return {
      datetime: dt.toJSDate(),
      reminderText: match[5].trim(),
      timeSpec: `${day} ${match[2]} в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }
  
  // 1. Абсолютное событие по дню недели: "понедельник в 10 встреча"
  match = normalizedText.match(absoluteWeekdayRegex);
  if (match) {
    logger.info(`parseReminder: Совпадение с днем недели: ${match}`);
    const weekday = match[1].toLowerCase();
    const normalizedWeekday = normalizeWord(weekday);
    const target = dayNameToWeekday[normalizedWeekday];
    if (!target) {
      logger.warn(`parseReminder: Недопустимый день недели: ${weekday}`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null, error: 'Недопустимый день недели' };
    }
    const hour = match[2] ? parseInt(match[2], 10) : now.hour;
    const minute = match[3] ? parseInt(match[3], 10) : 0; // Установлено всегда 0, если минуты не указаны
    if (hour > 23 || minute > 59) {
      logger.warn(`parseReminder: Недопустимое время: ${hour}:${minute}`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null, error: 'Недопустимое время (часы должны быть 0–23, минуты 0–59)' };
    }
    let dt = now;
    let iterations = 0;
    const maxIterations = 7;
    while (dt.weekday !== target && iterations < maxIterations) {
      dt = dt.plus({ days: 1 });
      iterations++;
    }
    if (iterations >= maxIterations) {
      logger.error(`parseReminder: Бесконечный цикл при поиске дня недели: ${normalizedWeekday}`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null, error: 'Ошибка при определении дня недели' };
    }
    dt = dt.set({ hour, minute, second: 0, millisecond: 0 });
    if (dt <= now) {
      dt = dt.plus({ weeks: 1 });
    }
    logger.info(`parseReminder: День недели распознан: ${dt.toISO()}`);
    return {
      datetime: dt.toJSDate(),
      reminderText: match[4].trim(),
      timeSpec: `${normalizedWeekday} в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }
  
  // 2. Повторяющееся уведомление: "каждый 3 часа тест"
  const repeatRegex = /^кажд(?:ый|ая|ую|ое|ые)(?:\s+(\d+))?\s+([А-Яа-яёЁ]+)(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/iu;
  match = normalizedText.match(repeatRegex);
  if (match) {
    logger.info(`parseReminder: Совпадение с повторяющимся уведомлением: ${match}`);
    const multiplier = match[1] ? parseInt(match[1], 10) : 1;
    let periodUnitRaw = match[2];
    let periodUnit = fuzzyCorrectUnit(periodUnitRaw);
    periodUnit = normalizeWord(periodUnit);
    const validRepeatUnits = ['минута', 'час', 'день', 'неделя', 'месяц', 'год'];
    if (!validRepeatUnits.includes(periodUnit)) {
      logger.warn(`parseReminder: Недопустимая единица повторения: ${periodUnit}`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null, error: 'Недопустимая единица повторения' };
    }
    const correctUnit = multiplier === 1 ? periodUnit : getDeclension(periodUnit, multiplier);
    const reminderText = match[5].trim();
    const repeatValue = multiplier === 1 ? periodUnit : `${multiplier} ${correctUnit}`;
    let dt;
    if (!match[3]) {
      dt = now;
      const periodMap = {
        'минута': 'minutes',
        'час': 'hours',
        'день': 'days',
        'неделя': 'weeks',
        'месяц': 'months',
        'год': 'years'
      };
      if (periodMap[periodUnit]) {
        dt = now.plus({ [periodMap[periodUnit]]: multiplier });
      }
      const formattedTime = dt.toFormat('HH:mm');
      logger.info(`parseReminder: Повторяющееся уведомление без времени: ${formattedTime}`);
      return {
        datetime: dt.toJSDate(),
        reminderText,
        timeSpec: `каждый ${repeatValue} начиная с ${formattedTime}`,
        repeat: repeatValue
      };
    } else {
      const hour = parseInt(match[3], 10);
      const minute = match[4] ? parseInt(match[4], 10) : 0;
      if (hour > 23 || minute > 59) {
        logger.warn(`parseReminder: Недопустимое время: ${hour}:${minute}`);
        return { datetime: null, reminderText: null, timeSpec: null, repeat: null, error: 'Недопустимое время (часы должны быть 0–23, минуты 0–59)' };
      }
      dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (dt <= now) {
        const periodMap = {
          'минута': 'minutes',
          'час': 'hours',
          'день': 'days',
          'неделя': 'weeks',
          'месяц': 'months',
          'год': 'years'
        };
        if (periodMap[periodUnit]) {
          dt = dt.plus({ [periodMap[periodUnit]]: multiplier });
        } else {
          dt = dt.plus({ days: 1 });
        }
      }
      logger.info(`parseReminder: Повторяющееся уведомление с временем: ${dt.toFormat('HH:mm')}`);
      return {
        datetime: dt.toJSDate(),
        reminderText,
        timeSpec: `каждый ${repeatValue} в ${hour}:${minute < 10 ? '0' + minute : minute}`,
        repeat: repeatValue
      };
    }
  }
  
  // 3. Разовое уведомление "через ..." 
  const throughRegex = /^через\s+(?:(\d+(?:\.\d+)?)\s+)?([A-Za-zА-Яа-яёЁ]+)(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s*(.+)?$/i;
  match = normalizedText.match(throughRegex);
  if (match) {
    logger.info(`parseReminder: Совпадение с разовым уведомлением: ${match}`);
    const number = match[1] ? parseFloat(match[1]) : 1;
    if (number <= 0) {
      logger.warn(`parseReminder: Длительность должна быть положительной: "${normalizedText}"`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null, error: 'Длительность должна быть положительной' };
    }
    let unit = fuzzyCorrectUnit(match[2].toLowerCase());
    const reminderText = match[5] ? match[5].trim() : null;
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
    if (match[3]) {
      const hour = parseInt(match[3], 10);
      const minute = match[4] ? parseInt(match[4], 10) : 0;
      if (hour > 23 || minute > 59) {
        logger.warn(`parseReminder: Недопустимое время: ${hour}:${minute}`);
        return { datetime: null, reminderText: null, timeSpec: null, repeat: null, error: 'Недопустимое время (часы должны быть 0–23, минуты 0–59)' };
      }
      dt = dt.set({ hour, minute, second: 0, millisecond: 0 });
    }
    if (!reminderText) {
      logger.info(`parseReminder: Разовое уведомление без текста: ${dt.toISO()}`);
      return {
        datetime: dt.toJSDate(),
        reminderText: null,
        timeSpec: `через ${number} ${unit}${match[3] ? ` в ${match[3]}:${match[4] ? match[4].padStart(2, '0') : '00'}` : ''}`,
        repeat: null
      };
    }
    logger.info(`parseReminder: Разовое уведомление: ${dt.toISO()}`);
    return {
      datetime: dt.toJSDate(),
      reminderText,
      timeSpec: `через ${number} ${unit}${match[3] ? ` в ${match[3]}:${match[4] ? match[4].padStart(2, '0') : '00'}` : ''}`,
      repeat: null
    };
  }
  
  // 4. "сегодня/завтра/послезавтра ..." 
  const todayTomorrowRegex = /^(сегодня|завтра|послезавтра)(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/i;
  match = normalizedText.match(todayTomorrowRegex);
  if (match) {
    logger.info(`parseReminder: Совпадение с ${match[1]}: ${match}`);
    const dayOffset = { 'сегодня': 0, 'завтра': 1, 'послезавтра': 2 }[match[1].toLowerCase()];
    const hour = match[2] ? parseInt(match[2], 10) : now.hour;
    const minute = match[3] ? parseInt(match[3], 10) : 0; // Установлено всегда 0, если минуты не указаны
    if (hour > 23 || minute > 59) {
      logger.warn(`parseReminder: Недопустимое время: ${hour}:${minute}`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null, error: 'Недопустимое время (часы должны быть 0–23, минуты 0–59)' };
    }
    const reminderText = match[4].trim();
    let dt = now.plus({ days: dayOffset }).set({ hour, minute, second: 0, millisecond: 0 });
    if (dt <= now) {
      dt = dt.plus({ days: 1 });
    }
    logger.info(`${match[1]}шняя дата: ${dt.toISO()}`);
    return {
      datetime: dt.toJSDate(),
      reminderText,
      timeSpec: `${match[1]} в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }
  
  // 5. Формат с разделителем: "в 10:15 обед" (включая варианты с точкой)
  let timeWithSeparatorRegex = /^в\s*(\d{1,2})\s*[:.,;\/]\s*(\d{1,2})\s+(.+)/i;
  match = normalizedText.match(timeWithSeparatorRegex);
  if (match) {
    logger.info(`parseReminder: Совпадение с временем с разделителем: ${match}`);
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    if (hour > 23 || minute > 59) {
      logger.warn(`parseReminder: Недопустимое время: ${hour}:${minute}`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null, error: 'Недопустимое время (часы должны быть 0–23, минуты 0–59)' };
    }
    const reminderText = match[3].trim();
    let dt = now.set({ hour, minute, second: 0, millisecond: 0 });
    if (dt <= now) dt = dt.plus({ days: 1 });
    logger.info(`parseReminder: Время с разделителем: ${dt.toISO()}`);
    return {
      datetime: dt.toJSDate(),
      reminderText,
      timeSpec: `в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }
  
  // 6. Формат числовой без разделителя: "в1015 уборка"
  const timeNumericRegex = /^в\s*(\d{3,4})(?:\s+(.+))?$/i;
  match = normalizedText.match(timeNumericRegex);
  if (match) {
    logger.info(`parseReminder: Совпадение с числовым временем: ${match}`);
    let timeNum = match[1];
    let hour, minute;
    if (timeNum.length === 3) {
      hour = parseInt(timeNum.slice(0, 1), 10);
      minute = parseInt(timeNum.slice(1), 10);
    } else {
      hour = parseInt(timeNum.slice(0, 2), 10);
      minute = parseInt(timeNum.slice(2), 10);
    }
    if (hour > 23 || minute > 59) {
      logger.warn(`parseReminder: Недопустимое числовое время: ${hour}:${minute}`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null, error: 'Недопустимое время (часы должны быть 0–23, минуты 0–59)' };
    }
    const reminderText = (match[2] || "").trim();
    let dt = now.set({ hour, minute, second: 0, millisecond: 0 });
    if (dt <= now) dt = dt.plus({ days: 1 });
    logger.info(`parseReminder: Числовое время: ${dt.toISO()}`);
    return {
      datetime: dt.toJSDate(),
      reminderText,
      timeSpec: `в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }
  
  // 7. Новый формат с пробелом между часами и минутами: "в 10 15 ужин"
  match = normalizedText.match(timeWithSpaceRegex);
  if (match) {
    logger.info(`parseReminder: Совпадение с временем с пробелом: ${match}`);
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    if (hour > 23 || minute > 59) {
      logger.warn(`parseReminder: Недопустимое время: ${hour}:${minute}`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null, error: 'Недопустимое время (часы должны быть 0–23, минуты 0–59)' };
    }
    const reminderText = match[3].trim();
    let dt = now.set({ hour, minute, second: 0, millisecond: 0 });
    if (dt <= now) dt = dt.plus({ days: 1 });
    logger.info(`parseReminder: Время с пробелом: ${dt.toISO()}`);
    return {
      datetime: dt.toJSDate(),
      reminderText,
      timeSpec: `в ${hour}:${minute < 10 ? '0' + minute : minute}`,
      repeat: null
    };
  }
  
  // 8. Новый fallback: "в 17 ужин" – без указания минут
  const simpleTimeRegex = /^в\s*(\d{1,2})\s+(.+)/i;
  match = normalizedText.match(simpleTimeRegex);
  if (match) {
    logger.info(`parseReminder: Совпадение с простым временем: ${match}`);
    const hour = parseInt(match[1], 10);
    if (hour > 23) {
      logger.warn(`parseReminder: Недопустимое время: ${hour}:00`);
      return { datetime: null, reminderText: null, timeSpec: null, repeat: null, error: 'Недопустимое время (часы должны быть 0–23)' };
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
  
  logger.warn(`parseReminder: Не удалось распознать входной текст: "${normalizedText}"`);
  return { datetime: null, reminderText: null, timeSpec: null, repeat: null, error: 'Не удалось распознать формат напоминания' };
}

module.exports = {
  normalizeWord,
  normalizeTimeExpressions,
  parseDate,
  parseReminder,
  computeNextTimeFromScheduled,
  transformRepeatToAgenda,
  getDeclension
};