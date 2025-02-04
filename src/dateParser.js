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
 * Функция для разделения исходного текста по ключевому слову "напомни".
 * Если слово найдено, то:
 *  - timeSpec – часть до "напомни", используемая для вычисления даты.
 *  - reminderText – всё, что после "напомни", оставляем без изменений.
 * Если "напомни" не найдено, возвращаем исходный текст в обе части.
 */
function parseReminder(input) {
  const keywordRegex = /напомни/i;
  if (keywordRegex.test(input)) {
    const parts = input.split(keywordRegex);
    const timeSpec = parts[0].trim();
    const reminderText = parts.slice(1).join(' напомни ').trim();
    return { timeSpec, reminderText };
  } else {
    return { timeSpec: input, reminderText: input };
  }
}

function preprocessText(text) {
  let processed = text
    // Обрабатываем конструкции "через 3 дня", "через неделю и 2 часа"
    .replace(/через\s+(\d+)?\s*([а-я]+)\s*(и\s+(\d+)\s*([а-я]+))?/gi, (_, num1, unit1, __, num2, unit2) => {
      const enUnit1 = unitsMap[unit1.toLowerCase()] || unit1;
      const enUnit2 = unitsMap[unit2?.toLowerCase()] || unit2;
      let result = `in ${num1 || '1'} ${enUnit1}`;
      if (num2 && enUnit2) {
        result += ` and ${num2} ${enUnit2}`;
      }
      return result;
    })
    // Обрабатываем конструкции "в 11" или "в 11:30", "в 11.30", "в 11,30", "в 11-30"
    .replace(/в\s+(\d{1,2})(?:(?:[:.,-])(\d{1,2}))?/gi, (_, hour, minute) => {
      return minute ? `at ${hour}:${minute.padStart(2, '0')}` : `at ${hour}:00`;
    })
    // Обрабатываем конструкции "и 2 часа", "и 3 дня"
    .replace(/и\s+(\d+)\s*([а-я]+)/gi, (_, num, unit) => {
      const enUnit = unitsMap[unit.toLowerCase()] || unit;
      return `and ${num} ${enUnit}`;
    });

  console.log('Processed Text:', processed);
  return processed;
}

/**
 * Функция вычисления даты на основе текстовой части с временной информацией.
 * Использует только переданную строку timeSpec.
 */
function extractDateFromSpec(timeSpec) {
  const processedText = preprocessText(timeSpec);
  let now = DateTime.local().setZone('UTC+3').set({ second: 0, millisecond: 0 });
  let parsedDate = now;

  // Если явно указано "завтра" или "послезавтра", смещаем базовую дату
  if (/завтра/gi.test(timeSpec)) {
    parsedDate = parsedDate.plus({ days: 1 });
  } else if (/послезавтра/gi.test(timeSpec)) {
    parsedDate = parsedDate.plus({ days: 2 });
  }

  // Проверяем наличие конкретного времени, ожидая формат "at HH:MM"
  const timeMatch = processedText.match(/at (\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    parsedDate = parsedDate.set({ hour: hours, minute: minutes });

    // Если указанное время уже прошло относительно базовой даты, переносим на следующий день
    if (parsedDate < now) {
      parsedDate = parsedDate.plus({ days: 1 });
    }
  }

  // Обрабатываем длительности, заданные конструкциями "in ..." и "and ..."
  const durationMatches = [...processedText.matchAll(/in (\d+) (minutes|hours|days|weeks|months|years)/g)];
  for (const match of durationMatches) {
    const amount = parseInt(match[1], 10);
    const unit = match[2];
    parsedDate = parsedDate.plus({ [unit]: amount });
  }

  const extraDurationMatches = [...processedText.matchAll(/and (\d+) (minutes|hours|days|weeks|months|years)/g)];
  for (const match of extraDurationMatches) {
    const amount = parseInt(match[1], 10);
    const unit = match[2];
    parsedDate = parsedDate.plus({ [unit]: amount });
  }

  console.log('⏳ Итоговая дата:', parsedDate.toISO());
  return parsedDate.toJSDate();
}

/**
 * Функция извлечения шаблона повторения (если есть).
 */
function extractRepeatPattern(text) {
  if (/каждый день/gi.test(text)) return "daily";
  if (/каждую неделю/gi.test(text)) return "weekly";
  if (/каждый месяц/gi.test(text)) return "monthly";
  return null; // Если нет повторения
}

/**
 * Функция извлечения текста напоминания.
 * Если в исходном сообщении присутствует слово "напомни", 
 * то всё, что после него, считается текстом напоминания и возвращается без изменений.
 * Если его нет – применяется базовая логика очистки.
 */
function extractReminderText(originalText) {
  const { reminderText } = parseReminder(originalText);
  if (reminderText) return reminderText;
  return originalText
    .replace(/(каждый день|каждую неделю|каждый месяц|каждый год)/gi, '')
    .replace(/(завтра|послезавтра)/gi, '')
    .replace(/через\s+\d*\s*[а-я]+/gi, '')
    .replace(/и\s+\d+\s*[а-я]+/gi, '')
    .replace(/в\s+\d{1,2}(?:(?:[:.,-])\d{1,2})?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

module.exports = {
  /**
   * parseReminderText принимает исходный текст, разделяет его по ключевому слову "напомни"
   * и возвращает объект { date, text }:
   * - date вычисляется из timeSpec (левая часть)
   * - text – правая часть, которая сохраняется без изменений.
   */
  parseReminderText(input) {
    const { timeSpec, reminderText } = parseReminder(input);
    const date = extractDateFromSpec(timeSpec);
    return { date, text: reminderText };
  },
  extractRepeatPattern,
  extractReminderText
};