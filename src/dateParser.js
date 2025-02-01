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
  
    // Проверяем повторяемые напоминания без времени
    if (/каждую минуту/gi.test(text)) {
      parsedDate = now.plus({ minutes: 1 });
    } else if (/каждый час/gi.test(text)) {
      parsedDate = now.plus({ hours: 1 });
    } else if (/каждый день/gi.test(text)) {
      parsedDate = now.plus({ days: 1 });
    } else if (/каждую неделю/gi.test(text)) {
      parsedDate = now.plus({ weeks: 1 });
    } else if (/каждый месяц/gi.test(text)) {
      parsedDate = now.plus({ months: 1 });
    }
  
    // Проверяем наличие конкретного времени
    const timeMatch = processedText.match(/at (\d{1,2})(?::(\d{2}))?/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      parsedDate = parsedDate.set({ hour: hours, minute: minutes });
  
      // Если время уже прошло сегодня, переносим на завтра
      if (parsedDate < now) {
        parsedDate = parsedDate.plus({ days: 1 });
      }
    }
  
    // Проверяем "через X минут/часов/дней"
    const durationMatch = processedText.match(/in (\d+) (minutes|hours|days)/);
    if (durationMatch) {
      const amount = parseInt(durationMatch[1], 10);
      const unit = durationMatch[2];
      parsedDate = now.plus({ [unit]: amount });
    }
  
    console.log('⏳ Итоговая дата:', parsedDate.toISO());
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
      .replace(/(каждый день|каждую неделю|каждый месяц|каждый год)/gi, '') // Убираем повторяемость
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