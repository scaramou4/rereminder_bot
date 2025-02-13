const { DateTime } = require('luxon');

/**
 * Парсит входной текст как относительную длительность.
 * Поддерживаются варианты: "30 минут", "через 1.5 часа", "через 1 день", "через 2 недели", "через 3 года" и т.п.
 * Если удаётся распознать длительность, возвращается объект { datetime },
 * где datetime – новое время, вычисленное от текущего момента.
 * Если парсинг не удался, возвращается { datetime: null }.
 */
function parseTimeSpec(text) {
  const regex = /^(?:через\s+)?(\d+(?:\.\d+)?)\s+([\p{L}]+)/iu;
  const match = text.trim().match(regex);
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
    // Если единица — часы, интерпретируем дробную часть как минуты (например, "1.56" => 1 час 56 минут)
    if (unit === 'hours') {
      const whole = Math.floor(number);
      const fraction = number - whole;
      const minutes = Math.round(fraction * 100); // 0.56 -> 56 минут
      const newDateTime = DateTime.local().plus({ hours: whole, minutes: minutes }).toJSDate();
      return { datetime: newDateTime };
    } else {
      const newDateTime = DateTime.local().plus({ [unit]: number }).toJSDate();
      return { datetime: newDateTime };
    }
  }
  return { datetime: null };
}

module.exports = {
  parseTimeSpec
};