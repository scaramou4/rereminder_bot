const chrono = require('chrono-node');

// Функция предобработки текста (улучшенное распознавание времени)
function preprocessText(text) {
  return text
    .replace(/завтра/gi, 'tomorrow')
    .replace(/послезавтра/gi, 'in 2 days')
    .replace(/каждый день/gi, 'every day')
    .replace(/каждую неделю/gi, 'every week')
    .replace(/каждый месяц/gi, 'every month')
    .replace(/через (\d+) (минут(у|ы|))/gi, 'in $1 minutes')
    .replace(/через (\d+) (час(а|ов|))/gi, 'in $1 hours')
    .replace(/через (\d+) (день|дня|дней)/gi, 'in $1 days')
    .replace(/через (\d+) (недел(ю|и|ь))/gi, 'in $1 weeks')
    .replace(/через (\d+) (месяц(а|ев|))/gi, 'in $1 months')
    .replace(/через (\d+) (год|года|лет)/gi, (_, num) => `in ${num * 12} months`)
    .replace(/в (\d{1,2}):(\d{2})/gi, 'at $1:$2')
    .replace(/в (\d{1,2}) (утра|дня|вечера|ночи)/gi, 'at $1');
}

// Функция выделения даты и времени
function extractDate(text) {
  const processedText = preprocessText(text);
  return chrono.parseDate(processedText);
}

// Функция определения повторяемости
function extractRepeatPattern(text) {
  if (/каждый день/gi.test(text)) return "daily";
  if (/каждую неделю/gi.test(text)) return "weekly";
  if (/каждый месяц/gi.test(text)) return "monthly";
  return null; // Если нет повторения
}

// Функция удаления даты из текста (оставляем только напоминание)
function extractReminderText(originalText) {
    return originalText
      .replace(/каждый день|каждую неделю|каждый месяц/gi, '') // Убираем повторяемость
      .replace(/через \d+ (минут(у|ы|)|час(а|ов|)|день|дня|дней|недел(ю|и|ь)|месяц(а|ев|)|год(а|ов|)|лет)\s*/i, '') // Убираем интервалы
      .replace(/в \d{1,2}(:\d{2})?/gi, '') // Убираем "в 9", "в 18:30"
      .trim();
  }

// Экспортируем функции
module.exports = {
  extractDate,
  extractRepeatPattern,
  extractReminderText
};