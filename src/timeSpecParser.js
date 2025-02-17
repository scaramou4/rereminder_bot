const { DateTime } = require('luxon');

/**
 * Парсит входной текст как относительную длительность.
 * Поддерживаются варианты: "30 минут", "через 1.5 часа", "через 1 день", "через 2 недели", "через 3 года" и т.п.
 * Если единица – "час", дробная часть интерпретируется как (fraction * 60) минут.
 * Также поддерживаются разделители для времени (например, "10:30", "10,30", "10.30", "10;30", "10/30").
 * Возвращается объект { datetime } – новое время, вычисленное от текущего момента.
 * Если парсинг не удался, возвращается { datetime: null }.
 */
function parseTimeSpec(text) {
  text = text.trim();
  // Если текст содержит разделитель между числовыми значениями, пытаемся распарсить как время.
  const timeSeparatorRegex = /^(\d{1,2})\s*(?:[:.,;/])\s*(\d{1,2})$/;
  let match = text.match(timeSeparatorRegex);
  if (match) {
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const newDateTime = DateTime.local().set({ hour, minute, second: 0, millisecond: 0 }).toJSDate();
    return { datetime: newDateTime };
  }
  
  // Основное регулярное выражение для относительной длительности
  const regex = /^(?:через\s+)?(\d+(?:\.\d+)?)\s+([\p{L}]+)/iu;
  match = text.match(regex);
  if (match) {
    let number = parseFloat(match[1]);
    const unitRaw = match[2].toLowerCase();
    const unitMap = {
      'минута': 'minutes',
      'минуты': 'minutes',
      'минут': 'minutes',
      'минуту': 'minutes',
      'час': 'hours',
      'часа': 'hours',
      'часов': 'hours',
      'часу': 'hours',
      'день': 'days',
      'дня': 'days',
      'дней': 'days',
      'дню': 'days',
      'неделя': 'weeks',
      'недели': 'weeks',
      'недель': 'weeks',
      'неделю': 'weeks',
      'год': 'years',
      'года': 'years',
      'лет': 'years'
    };
    const unit = unitMap[unitRaw] || null;
    if (!unit) return { datetime: null };
    if (unit === 'hours') {
      const whole = Math.floor(number);
      const fraction = number - whole;
      const minutes = Math.round(fraction * 60);
      const newDateTime = DateTime.local().plus({ hours: whole, minutes }).toJSDate();
      return { datetime: newDateTime };
    } else {
      const newDateTime = DateTime.local().plus({ [unit]: number }).toJSDate();
      return { datetime: newDateTime };
    }
  }
  return { datetime: null };
}

/**
 * Форматирует дату в виде "HH:mm, d MMMM yyyy", например: "14:16, 12 февраля 2025".
 * Использует локаль 'ru' для вывода месяца на русском языке.
 */
function formatDate(date) {
  return DateTime.fromJSDate(date).setLocale('ru').toFormat('HH:mm, d MMMM yyyy');
}

module.exports = {
  parseTimeSpec,
  formatDate
};