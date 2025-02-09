const { DateTime } = require('luxon');
const logger = require('./logger'); // logger.js находится в папке src

const unitsMap = {
  'минут': 'minutes', 'минуту': 'minutes', 'минуты': 'minutes',
  'час': 'hours', 'часа': 'hours', 'часов': 'hours',
  'день': 'days', 'дня': 'days', 'дней': 'days',
  'неделю': 'weeks', 'недели': 'weeks', 'недель': 'weeks',
  'месяц': 'months', 'месяца': 'months', 'месяцев': 'months',
  'год': 'years', 'года': 'years', 'лет': 'years'
};

/**
 * Функция parseReminder разбивает входной текст на две части: timeSpec и reminderText.
 */
function parseReminder(input) {
  input = input.trim();

  // Если введено только число – интерпретируем как "через X минут"
  if (/^\d+$/.test(input)) {
    return { timeSpec: `через ${input} минут`, reminderText: "" };
  }

  // Если ввод начинается со слова "в" или "во" и содержит название дня недели
  const weekdayRegex = /^(?<time>(?:(?:в(?:о)?)\s+(?:понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)(?:\s+в\s+\d{1,2}(?:(?::|[.,-])\d{1,2})?)?))(?:\s+(?<rest>.*))?$/i;
  let match = input.match(weekdayRegex);
  if (match && match.groups) {
    return {
      timeSpec: match.groups.time.trim(),
      reminderText: (match.groups.rest || "").trim()
    };
  }

  // Для повторяющихся напоминаний (например, "каждый вторник в 12.30 вопросы")
  const repeatingRegex = /^(?<time>(?:(?:каждый(?:\s+\d+)?\s+(?:час|день)|каждую\s+неделю|каждый\s+месяц|каждый\s+год)(?:\s+в\s+\d{1,2}(?:(?::|[.,-])\d{1,2})?)?))(?:\s+(?<rest>.*))?$/i;
  match = input.match(repeatingRegex);
  if (match && match.groups) {
    return {
      timeSpec: match.groups.time.trim(),
      reminderText: (match.groups.rest || "").trim()
    };
  }

  // Блок для абсолютного времени без указания дня недели
  const absoluteTimeRegex = /^(?<time>в(?:о)?\s+\d{1,2}(?:(?::|[.,-])\d{1,2})?)(?:\s+(?<rest>.*))?$/i;
  match = input.match(absoluteTimeRegex);
  if (match && match.groups && !/(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)/i.test(input)) {
    return {
      timeSpec: match.groups.time.trim(),
      reminderText: (match.groups.rest || "").trim()
    };
  }

  // Если ввод начинается со слова "через"
  if (/^через\s+/i.test(input)) {
    match = input.match(/^(через(?:\s+\d+(?:[.,]\d+)?\s+[а-я]+)+)\s*(.*)$/i);
    if (match) {
      return { timeSpec: match[1].trim(), reminderText: match[2].trim() };
    }
  }

  // Если встречается ключевое слово "напомни(ть)"
  const keywordRegex = /напомни(?:ть)?/i;
  if (keywordRegex.test(input)) {
    const parts = input.split(keywordRegex);
    const timeSpec = parts[0].trim();
    const reminderText = parts.slice(1).join(' напомни ').trim();
    return { timeSpec, reminderText };
  }

  // Фолбэк
  const timeSpecRegex = /^(?:(?:завтра|послезавтра)(?:\s+в\s+\d{1,2}(?:(?::|[.,-])\d{1,2})?)?|через\s*(?:\d+(?:[.,]\d+)?\s*)?[а-я]+(?:\s+и\s+\d+\s*[а-я]+)*(?:\s+в\s+\d{1,2}(?:(?::|[.,-])\d{1,2})?)?)(?=\s|$)/i;
  match = input.match(timeSpecRegex);
  if (match) {
    const timeSpec = match[0].trim();
    const reminderText = input.slice(match[0].length).trim();
    return { timeSpec, reminderText };
  }
  return { timeSpec: input, reminderText: input };
}

function preprocessText(text) {
  let processed = text
    .replace(/через\s*(\d+(?:[.,]\d+)?)?\s*([а-я]+)(\s+и\s+(\d+)(?:[.,](\d+))?\s*([а-я]+))?/gi, (_, num1, unit1, group, num2, dec2, unit2) => {
      const count1 = num1 ? num1.replace(',', '.') : '1';
      const enUnit1 = unitsMap[unit1.toLowerCase()] || unit1;
      let result = `in ${count1} ${enUnit1} `;
      if (group && num2 && unit2) {
        const enUnit2 = unitsMap[unit2.toLowerCase()] || unit2;
        result += `and ${num2} ${enUnit2}`;
      }
      return result;
    })
    .replace(/в\s+(\d{1,2})(?:(?::|[.,-])(\d{1,2}))?/gi, (_, hour, minute) => {
      return minute ? `at ${hour}:${minute.padStart(2, '0')}` : `at ${hour}:00`;
    })
    .replace(/и\s+(\d+)\s*([а-я]+)/gi, (_, num, unit) => {
      const enUnit = unitsMap[unit.toLowerCase()] || unit;
      return `and ${num} ${enUnit}`;
    });
  logger.info(`Preprocessed text: ${processed}`);
  return processed;
}

/**
 * Функция extractDateFromSpec вычисляет дату на основе timeSpec.
 */
function extractDateFromSpec(timeSpec) {
  let now = DateTime.local().setZone('UTC+3').set({ second: 0, millisecond: 0 });

  // 1. Обработка дней недели (если указан конкретный день)
  const weekdayRegex = /(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)/i;
  if (weekdayRegex.test(timeSpec)) {
    const weekdaysMap = {
      'понедельник': 1,
      'вторник': 2,
      'среда': 3,
      'четверг': 4,
      'пятница': 5,
      'суббота': 6,
      'воскресенье': 7
    };
    const dayMatch = timeSpec.match(weekdayRegex);
    const targetWeekday = weekdaysMap[dayMatch[1].toLowerCase()];
    const timeMatch = timeSpec.match(/в\s+(\d{1,2})(?:(?::|[.,-])(\d{1,2}))?/i);
    let hour, minute;
    if (timeMatch && timeMatch[1]) {
      hour = parseInt(timeMatch[1], 10);
      minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    } else {
      // Если время не указано, используем текущее время
      hour = now.hour;
      minute = now.minute;
    }
    const currentWeekday = now.weekday;
    let daysToAdd = targetWeekday - currentWeekday;
    if (daysToAdd < 0 || (daysToAdd === 0 && (now.hour > hour || (now.hour === hour && now.minute >= minute)))) {
      daysToAdd += 7;
    }
    logger.info(`Weekday detected in timeSpec "${timeSpec}". Next ${dayMatch[1]} will be in ${daysToAdd} day(s) at ${hour}:${String(minute).padStart(2, '0')}`);
    return now.plus({ days: daysToAdd }).set({ hour, minute }).toJSDate();
  }

  // 2. Обработка общего повторения "каждую неделю" без указания дня недели
  if (/каждую неделю/i.test(timeSpec) && !/(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)/i.test(timeSpec)) {
    const timeMatch = timeSpec.match(/в\s+(\d{1,2})(?:(?::|[.,-])(\d{1,2}))?/i);
    let hour, minute;
    if (timeMatch) {
      hour = parseInt(timeMatch[1], 10);
      minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    } else {
      hour = now.hour;
      minute = now.minute;
    }
    let targetDate = now.set({ hour, minute });
    if (targetDate <= now) {
      targetDate = targetDate.plus({ days: 7 });
    }
    logger.info(`Generic weekly pattern detected in timeSpec "${timeSpec}". Scheduled for ${targetDate.toISO()}`);
    return targetDate.toJSDate();
  }

  // 3. Обработка повторения "каждый месяц"
  if (/каждый месяц/i.test(timeSpec)) {
    const timeMatch = timeSpec.match(/в\s+(\d{1,2})(?:(?::|[.,-])(\d{1,2}))?/i);
    let hour, minute;
    if (timeMatch) {
      hour = parseInt(timeMatch[1], 10);
      minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    } else {
      hour = now.hour;
      minute = now.minute;
    }
    let targetDate = now.set({ hour, minute });
    if (targetDate <= now) {
      targetDate = targetDate.plus({ months: 1 });
    }
    logger.info(`Monthly pattern detected in timeSpec "${timeSpec}". Scheduled for ${targetDate.toISO()}`);
    return targetDate.toJSDate();
  }

  // 4. Обработка повторения "каждый год"
  if (/каждый год/i.test(timeSpec)) {
    const timeMatch = timeSpec.match(/в\s+(\d{1,2})(?:(?::|[.,-])(\d{1,2}))?/i);
    let hour, minute;
    if (timeMatch) {
      hour = parseInt(timeMatch[1], 10);
      minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    } else {
      hour = now.hour;
      minute = now.minute;
    }
    let targetDate = now.set({ hour, minute });
    if (targetDate <= now) {
      targetDate = targetDate.plus({ years: 1 });
    }
    logger.info(`Yearly pattern detected in timeSpec "${timeSpec}". Scheduled for ${targetDate.toISO()}`);
    return targetDate.toJSDate();
  }

  // 5. Стандартная обработка для остальных конструкций (завтра, послезавтра, через ...)
  const processedText = preprocessText(timeSpec);
  let parsedDate = now;

  if (/послезавтра/i.test(timeSpec)) {
    parsedDate = parsedDate.plus({ days: 2 });
  } else if (/завтра/i.test(timeSpec)) {
    parsedDate = parsedDate.plus({ days: 1 });
  }

  const timeMatch2 = processedText.match(/at (\d{1,2}):(\d{1,2})/);
  if (timeMatch2) {
    const hours = parseInt(timeMatch2[1], 10);
    const minutes = parseInt(timeMatch2[2], 10);
    parsedDate = parsedDate.set({ hour: hours, minute: minutes });
  }

  if (!/через/i.test(timeSpec)) {
    if (/каждый/i.test(timeSpec)) {
      if (parsedDate.toMillis() < now.toMillis()) {
        parsedDate = parsedDate.plus({ days: 1 });
      }
    } else {
      if (parsedDate.toMillis() < now.toMillis()) {
        parsedDate = parsedDate.plus({ days: 1 });
      }
    }
  }

  const durationMatches = [...processedText.matchAll(/in (\d+(?:[.,]\d+)?) (minutes|hours|days|weeks|months|years)/gi)];
  for (const match of durationMatches) {
    let amountStr = match[1].replace(',', '.');
    const amount = parseFloat(amountStr);
    const unit = match[2];
    parsedDate = parsedDate.plus({ [unit]: amount });
  }

  const extraDurationMatches = [...processedText.matchAll(/and (\d+(?:[.,]\d+)?) (minutes|hours|days|weeks|months|years)/gi)];
  for (const match of extraDurationMatches) {
    let amountStr = match[1].replace(',', '.');
    const amount = parseFloat(amountStr);
    const unit = match[2];
    parsedDate = parsedDate.plus({ [unit]: amount });
  }

  logger.info(`Extracted date from spec "${timeSpec}": ${parsedDate.toISO()}`);
  return parsedDate.toJSDate();
}

function extractRepeatPattern(text) {
  let match;
  if (match = text.match(/^(каждый\s+(?:понедельник|вторник|среда|четверг|пятница|суббота|воскресенье))/i)) {
    return match[1].toLowerCase();
  }
  if (/каждый(?:\s+\d+)?\s+час/i.test(text)) return "каждый час";
  if (/каждый день/i.test(text)) return "каждый день";
  if (/каждую неделю/i.test(text)) return "каждую неделю";
  if (/каждый месяц/i.test(text)) return "каждый месяц";
  if (/каждый год/i.test(text)) return "каждый год";
  return null;
}

module.exports = {
  parseReminderText(input) {
    logger.info(`User input: ${input}`);
    let { timeSpec, reminderText } = parseReminder(input);
    logger.info(`Extracted timeSpec: ${timeSpec}`);
    
    // Если timeSpec заканчивается на модификатор (например, "утро"), удаляем его,
    // используя пробельное разделение, так как \b для кириллицы может не сработать.
    const timeModifiers = ["утро", "утром", "вечер", "вечером", "день", "днем", "ночи", "полдник", "рота"];
    let extractedModifier = "";
    for (const mod of timeModifiers) {
      const modRegex = new RegExp(`\\s+(${mod})$`, 'i');
      const modMatch = timeSpec.match(modRegex);
      if (modMatch) {
        extractedModifier = modMatch[1];
        timeSpec = timeSpec.replace(modRegex, '').trim();
        break;
      }
    }
    logger.info(`Modified timeSpec after removing time modifier (if any): ${timeSpec}`);
    
    const date = extractDateFromSpec(timeSpec);
    let finalText = (reminderText && reminderText !== timeSpec) ? reminderText : "";
    finalText = finalText.trim();
    // Если finalText пустое, можно сохранить извлечённый модификатор – но, как правило, для повторов модификатор не нужен.
    logger.info(`Extracted reminder text: ${finalText}`);
    const repeat = extractRepeatPattern(input);
    logger.info(`Repeat: ${repeat ? repeat : "нет"}`);
    return { date, text: finalText };
  },
  extractRepeatPattern,
  preprocessText,
};