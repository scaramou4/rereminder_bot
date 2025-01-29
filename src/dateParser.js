const chrono = require('chrono-node');

// Функция предобработки текста (улучшенное распознавание времени)
function preprocessText(text) {
  return text
    .replace(/завтра/gi, 'tomorrow')
    .replace(/послезавтра/gi, 'in 2 days')
    .replace(/через (\d+) (минут(у|ы|))/gi, 'in $1 minutes')
    .replace(/через (\d+) (час(а|ов|))/gi, 'in $1 hours')
    .replace(/через (\d+) (день|дня|дней)/gi, 'in $1 days')
    .replace(/через (\d+) (недел(ю|и|ь))/gi, 'in $1 weeks')
    .replace(/через (\d+) (месяц(а|ев|))/gi, 'in $1 months')
    .replace(/через (\d+) (год|года|лет)/gi, (_, num) => `in ${num * 12} months`) // Преобразуем годы в месяцы
    .replace(/в (\d{1,2}):(\d{2})/gi, 'at $1:$2')
    .replace(/в (\d{1,2}) (утра|дня|вечера|ночи)/gi, 'at $1');
}

// Функция выделения даты и времени
function extractDate(text) {
  const processedText = preprocessText(text);
  return chrono.parseDate(processedText);
}

// Функция удаления даты из текста (оставляем только напоминание)
function extractReminderText(originalText) {
  return originalText.replace(/через \d+ (минут(у|ы|)|час(а|ов|)|день|дня|дней|недел(ю|и|ь)|месяц(а|ев|)|год(а|ов|)|лет)\s*/i, '').trim();
}

// Экспортируем функции для использования в `bot.js`
module.exports = {
  extractDate,
  extractReminderText
};