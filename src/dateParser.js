const { DateTime } = require('luxon');
const logger = require('./logger'); // Файл logger.js лежит в папке src

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
 * Если ввод состоит только из числа (например, "30"), то интерпретируется как "через 30 минут".
 *
 * Новый блок для обработки дней недели использует регулярное выражение, которое позволяет
 * отделить часть, соответствующую времени, от остатка, который станет описанием.
 */
function parseReminder(input) {
  input = input.trim();
  
  // Если введено только число, интерпретируем как минуты
  if (/^\d+$/.test(input)) {
    return { timeSpec: `через ${input} минут`, reminderText: "" };
  }
  
  // Если ввод начинается со слова "в" или "во" или "каждый/каждую" и содержит день недели,
  // используем специальное регулярное выражение.
  const weekdayRegex = /^(?<time>(?:(?:в(?:о)?|каждый|каждую)\s+(?:понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)(?:\s+в\s+\d{1,2}(?:(?:[:.,-])\d{1,2})?)?))\b(?<rest>.*)$/i;
  const weekdayMatch = input.match(weekdayRegex);
  if (weekdayMatch && weekdayMatch.groups) {
    return {
      timeSpec: weekdayMatch.groups.time.trim(),
      reminderText: weekdayMatch.groups.rest.trim()
    };
  }
  
  // Если ввод начинается со слова "через", пытаемся захватить всю конструкцию
  if (/^через\s+/i.test(input)) {
    const match = input.match(/^(через(?:\s+\d+(?:[.,]\d+)?\s+[а-я]+)+)\s*(.*)$/i);
    if (match) {
      return { timeSpec: match[1].trim(), reminderText: match[2].trim() };
    }
  }
  
  // Если встречается ключевое слово "напомни(ть)", разделяем по нему
  const keywordRegex = /напомни(?:ть)?/i;
  if (keywordRegex.test(input)) {
    const parts = input.split(keywordRegex);
    const timeSpec = parts[0].trim();
    const reminderText = parts.slice(1).join(' напомни ').trim();
    return { timeSpec, reminderText };
  }
  
  // Фолбэк: общее регулярное выражение для абсолютных конструкций
  const timeSpecRegex = /^(?:(?:завтра|послезавтра)(?:\s+в\s+\d{1,2}(?:(?:[:.,-])\d{1,2})?)?|через\s*(?:\d+(?:[.,]\d+)?\s*)?[а-я]+(?:\s+и\s+\d+\s*[а-я]+)*(?:\s+в\s+\d{1,2}(?:(?:[:.,-])\d{1,2})?)?)(?=\s|$)/i;
  const match = input.match(timeSpecRegex);
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
    .replace(/в\s+(\d{1,2})(?:(?:[:.,-])(\d{1,2}))?/gi, (_, hour, minute) => {
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
 * Функция extractDateFromSpec сначала проверяет, содержит ли timeSpec указание дня недели.
 * Если да, вычисляется ближайшая дата для указанного дня недели с указанным временем.
 * Иначе используется стандартная логика (завтра, послезавтра, через ...).
 */
function extractDateFromSpec(timeSpec) {
  let now = DateTime.local().setZone('UTC+3').set({ second: 0, millisecond: 0 });

  // Обработка дней недели
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
    // Извлекаем время после дня недели (например, "в 10" или "в 10:00")
    const timeMatch = timeSpec.match(/в\s+(\d{1,2})(?::(\d{2}))?/i);
    let hour = 0, minute = 0;
    if (timeMatch) {
      hour = parseInt(timeMatch[1], 10);
      if (timeMatch[2]) {
        minute = parseInt(timeMatch[2], 10);
      }
    }
    const currentWeekday = now.weekday; // Monday=1, ..., Sunday=7
    let daysToAdd = targetWeekday - currentWeekday;
    if (daysToAdd < 0 || (daysToAdd === 0 && (now.hour > hour || (now.hour === hour && now.minute >= minute)))) {
      daysToAdd += 7;
    }
    logger.info(`Weekday detected in timeSpec "${timeSpec}". Next ${dayMatch[1]} will be in ${daysToAdd} day(s) at ${hour}:${minute}`);
    return now.plus({ days: daysToAdd }).set({ hour, minute }).toJSDate();
  }
  
  // Стандартная обработка
  const processedText = preprocessText(timeSpec);
  let parsedDate = now;
  
  if (/послезавтра/i.test(timeSpec)) {
    parsedDate = parsedDate.plus({ days: 2 });
  } else if (/завтра/i.test(timeSpec)) {
    parsedDate = parsedDate.plus({ days: 1 });
  }
  
  const timeMatch = processedText.match(/at (\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    parsedDate = parsedDate.set({ hour: hours, minute: minutes });
  }
  
  if (!/через/i.test(timeSpec)) {
    if (/каждый/i.test(timeSpec)) {
      if (parsedDate <= now) {
        parsedDate = parsedDate.plus({ days: 1 });
      }
    } else {
      if (parsedDate < now) {
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
    const date = extractDateFromSpec(timeSpec);
    let finalText = (reminderText && reminderText !== timeSpec) ? reminderText : "";
    finalText = finalText.trim();
    const timeModifiers = ["утром", "вечером", "днем", "ночи", "полдник", "рота"];
    if (timeModifiers.includes(finalText.toLowerCase())) {
      finalText = "";
    }
    logger.info(`Extracted reminder text: ${finalText}`);
    const repeat = extractRepeatPattern(input);
    logger.info(`Repeat: ${repeat ? repeat : "нет"}`);
    return { date, text: finalText };
  },
  extractRepeatPattern,
  preprocessText,
};