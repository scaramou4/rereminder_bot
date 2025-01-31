const { DateTime } = require('luxon');

const unitsMap = {
  'минут': 'minutes', 'минуту': 'minutes', 'минуты': 'minutes',
  'час': 'hours', 'часа': 'hours', 'часов': 'hours',
  'день': 'days', 'дня': 'days', 'дней': 'days',
  'неделю': 'weeks', 'недели': 'weeks', 'недель': 'weeks',
  'месяц': 'months', 'месяца': 'months', 'месяцев': 'months',
  'год': 'years', 'года': 'years', 'лет': 'years'
};

function preprocessText(text) {
  let processed = text
    // Обрабатываем "через 3 дня", "через неделю и 2 часа"
    .replace(/через\s+(\d+)?\s*([а-я]+)/gi, (_, num, unit) => {
      const enUnit = unitsMap[unit.toLowerCase()] || unit;
      return `in ${num || '1'} ${enUnit}`;
    })
    // Обрабатываем "в 11" или "в 11:30"
    .replace(/в\s+(\d{1,2})(?::(\d{2}))?/gi, 'at $1:$2')
    // Обрабатываем "и 2 часа", "и 3 дня"
    .replace(/и\s+(\d+)\s*([а-я]+)/gi, (_, num, unit) => {
      const enUnit = unitsMap[unit.toLowerCase()] || unit;
      return `and ${num} ${enUnit}`;
    });

  console.log('Processed Text:', processed);
  return processed;
}

function extractDate(text) {
  const processedText = preprocessText(text);

  let now = DateTime.local().setZone('UTC+3').set({ second: 0, millisecond: 0 });
  let parsedDate = now;

  // Проверяем "завтра", "послезавтра"
  if (/завтра/.test(text)) parsedDate = now.plus({ days: 1 });
  if (/послезавтра/.test(text)) parsedDate = now.plus({ days: 2 });

  // Проверяем основной временной интервал (например, "через 3 дня")
  const match = processedText.match(/in (\d+) (minutes|hours|days|weeks|months|years)/);
  if (match) {
    const amount = parseInt(match[1], 10);
    const unit = match[2];

    parsedDate = parsedDate.plus({ [unit]: amount });
  }

  // 🔹 Добавляем дополнительные интервалы ("и 2 часа", "и 3 дня")
  const extraMatches = [...processedText.matchAll(/and\s+(\d+)\s+(minutes|hours|days|weeks|months|years)/gi)];

  extraMatches.forEach(match => {
    const amount = parseInt(match[1], 10);
    const unit = match[2].replace(/s$/, ''); // Убираем множественное число

    console.log(`➕ Добавляем ${amount} ${unit} к дате`);
    parsedDate = parsedDate.plus({ [unit]: amount });
  });

  // Проверяем указание времени ("в 11", "в 15:30")
  const timeMatch = processedText.match(/at (\d{1,2})(?::(\d{2}))?/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    parsedDate = parsedDate.set({ hour: hours, minute: minutes });
  }

  console.log('Base Date:', parsedDate.toISO());
  return parsedDate.toJSDate();
}

function extractRepeatPattern(text) {
  if (/каждый день/gi.test(text)) return "daily";
  if (/каждую неделю/gi.test(text)) return "weekly";
  if (/каждый месяц/gi.test(text)) return "monthly";
  return null; // Если нет повторения
}

function extractReminderText(originalText) {
  return originalText
    .replace(/(завтра|послезавтра)/gi, '') // Убираем "завтра", "послезавтра"
    .replace(/через\s+\d*\s*[а-я]+/gi, '') // Убираем "через 3 дня", "через месяц"
    .replace(/и\s+\d+\s*[а-я]+/gi, '') // Убираем "и 2 дня"
    .replace(/в\s+\d{1,2}(:\d{2})?/gi, '') // Убираем "в 11", "в 18:30"
    .replace(/\s{2,}/g, ' ') // Убираем лишние пробелы
    .trim();
}

module.exports = {
  extractDate,
  extractRepeatPattern,
  extractReminderText
};