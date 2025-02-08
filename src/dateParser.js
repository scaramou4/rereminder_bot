const { DateTime } = require('luxon');

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
 * Для повторяющихся напоминаний (начинающихся с "каждый час", "каждый день", "каждую неделю",
 * "каждый месяц" или "каждый год") применяется специальное регулярное выражение, которое отделяет
 * часть, отвечающую за время, от остатка (который будет использоваться как описание).
 */
function parseReminder(input) {
  input = input.trim();
  // Если введено только число, интерпретируем как минуты
  if (/^\d+$/.test(input)) {
    return { timeSpec: `через ${input} минут`, reminderText: "" };
  }
  
  // Если ввод начинается с "через", пытаемся захватить всю конструкцию
  if (/^через\s+/i.test(input)) {
    const match = input.match(/^(через(?:\s+\d+(?:[.,]\d+)?\s+[а-я]+)+)\s*(.*)$/i);
    if (match) {
      return { timeSpec: match[1].trim(), reminderText: match[2].trim() };
    }
  }
  
  // Для повторяющихся напоминаний (включая "каждый час", "каждый день", "каждую неделю", "каждый месяц", "каждый год")
  const repeatingRegex = /^(?<time>(?:каждый(?:\s+\d+)?\s+час|каждый день|каждую неделю|каждый месяц|каждый год)(?:\s+в\s+\d{1,2}(?:(?:[:.,-])\d{1,2})?)?)(?<rest>\s+.*)?$/i;
  const repMatch = input.match(repeatingRegex);
  if (repMatch && repMatch.groups) {
    const timeSpec = repMatch.groups.time.trim();
    const reminderText = repMatch.groups.rest ? repMatch.groups.rest.trim() : "";
    return { timeSpec, reminderText };
  }
  
  // Если встречается ключевое слово "напомни(ть)", разделяем по нему
  const keywordRegex = /напомни(?:ть)?/i;
  if (keywordRegex.test(input)) {
    const parts = input.split(keywordRegex);
    const timeSpec = parts[0].trim();
    const reminderText = parts.slice(1).join(' напомни ').trim();
    return { timeSpec, reminderText };
  }
  
  // Фоллбэк: пытаемся выделить timeSpec через регулярное выражение для абсолютных конструкций
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
  console.log('Processed Text:', processed);
  return processed;
}

function extractDateFromSpec(timeSpec) {
  const processedText = preprocessText(timeSpec);
  let now = DateTime.local().setZone('UTC+3').set({ second: 0, millisecond: 0 });
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
  
  // Если timeSpec содержит слово "через", это относительное время – не добавляем дополнительный день
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
  
  console.log('⏳ Итоговая дата:', parsedDate.toISO());
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
    console.log("User input:", input);
    let { timeSpec, reminderText } = parseReminder(input);
    console.log("Extracted timeSpec:", timeSpec);
    const date = extractDateFromSpec(timeSpec);
    // Если reminderText совпадает с timeSpec, оставляем его пустым; иначе оставляем остаток.
    let finalText = (reminderText && reminderText !== timeSpec) ? reminderText : "";
    finalText = finalText.trim();
    // Если полученное reminderText является одним из стандартных модификаторов, очищаем его.
    const timeModifiers = ["утром", "вечером", "днем", "ночи", "полдник", "рота"];
    if (timeModifiers.includes(finalText.toLowerCase())) {
      finalText = "";
    }
    console.log("Extracted reminder text:", finalText);
    const repeat = extractRepeatPattern(input);
    console.log("Repeat:", repeat ? repeat : "нет");
    return { date, text: finalText };
  },
  extractRepeatPattern,
  preprocessText,
};