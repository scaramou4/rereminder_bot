const { DateTime } = require('luxon');

function parseTimeSpec(text) {
  const now = DateTime.local().setZone('Europe/Moscow');
  const timeUnits = {
    'мин': 'minutes', 'минут': 'minutes', 'минуты': 'minutes',
    'час': 'hours', 'часа': 'hours', 'часов': 'hours',
    'день': 'days', 'дня': 'days', 'дней': 'days',
    'неделя': 'weeks', 'недели': 'weeks', 'недель': 'weeks'
  };

  // Поддержка всех вариантов из postponeOptions
  const postponeOptionsMap = {
    '5 мин': 5 * 60 * 1000, // 5 минут в миллисекундах
    '10 мин': 10 * 60 * 1000, // 10 минут
    '15 мин': 15 * 60 * 1000, // 15 минут
    '30 мин': 30 * 60 * 1000, // 30 минут
    '1 час': 1 * 60 * 60 * 1000, // 1 час
    '2 часа': 2 * 60 * 60 * 1000, // 2 часа
    '3 часа': 3 * 60 * 60 * 1000, // 3 часа
    '4 часа': 4 * 60 * 60 * 1000, // 4 часа
    '1 день': 1 * 24 * 60 * 60 * 1000, // 1 день
    '2 дня': 2 * 24 * 60 * 60 * 1000, // 2 дня
    '3 дня': 3 * 24 * 60 * 60 * 1000, // 3 дня
    '7 дней': 7 * 24 * 60 * 60 * 1000, // 7 дней
    'утро': null, // Установим позже как 9:00 следующего дня
    'вечером': null, // Установим позже как 18:00 текущего дня
    '…': null // Кастомный ввод, пропускаем (будет обработан через pendingPostpone)
  };

  // Проверка на точное совпадение с postponeOptions
  const normalizedText = text.toLowerCase().trim();
  if (postponeOptionsMap[normalizedText]) {
    if (normalizedText === 'утро') {
      return { datetime: now.plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toJSDate() };
    } else if (normalizedText === 'вечером') {
      return { datetime: now.set({ hour: 18, minute: 0, second: 0, millisecond: 0 }).plus({ days: now.hour >= 18 ? 1 : 0 }).toJSDate() };
    } else if (normalizedText === '…') {
      return { datetime: null }; // Для кастомного ввода
    } else {
      const milliseconds = postponeOptionsMap[normalizedText];
      return { datetime: now.plus({ milliseconds }).toJSDate() };
    }
  }

  // Общий регекс для парсинга числовых длительностей (например, "10 минут", "1.5 часа")
  const timeRegex = /^(\d+(?:\.\d+)?)\s+([а-яё]+)$/i;
  const match = normalizedText.match(timeRegex);
  if (match) {
    const number = parseFloat(match[1]);
    const unit = match[2];
    const englishUnit = timeUnits[unit] || 'minutes';
    if (number <= 0) {
      return { datetime: null };
    }
    return { datetime: now.plus({ [englishUnit]: number }).toJSDate() };
  }

  // Проверка формата времени "HH:MM" или "HH"
  const timeFormatRegex = /^(\d{1,2})(?::(\d{2}))?$/;
  const timeMatch = normalizedText.match(timeFormatRegex);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { datetime: now.set({ hour, minute, second: 0, millisecond: 0 }).toJSDate() };
    }
  }

  return { datetime: null };
}

function formatDate(date) {
  return DateTime.fromJSDate(date).setZone('Europe/Moscow').setLocale('ru').toFormat('HH:mm, d MMMM yyyy');
}

module.exports = {
  parseTimeSpec,
  formatDate
};