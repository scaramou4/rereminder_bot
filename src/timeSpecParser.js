const { DateTime } = require('luxon');

/**
 * Парсит входной текст как относительную длительность.
 * Допускаются варианты вида "30 минут", "через 1 час", "через 1 день", "через 1 неделя", "через 2 года", "через месяц" и т.п.
 * Если удаётся распознать длительность, возвращается объект { datetime },
 * где datetime – новое время, вычисленное от текущего момента.
 * Если парсинг не удался, возвращается { datetime: null }.
 */
function parseTimeSpec(text) {
  // Регулярное выражение допускает опциональное "через", затем опциональное число и последовательность букв (с флагом u для Unicode)
  const regex = /^(?:через\s+)?(?:(\d+)\s+)?([\p{L}]+)/iu;
  const match = text.trim().match(regex);
  if (match) {
    // Если число не указано, по умолчанию берем 1
    const number = match[1] ? parseInt(match[1], 10) : 1;
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
      'месяц': 'months',
      'месяца': 'months',
      'месяцев': 'months',
      'месяцу': 'months',
      'год': 'years',
      'года': 'years',
      'лет': 'years'
    };
    const unit = unitMap[unitRaw] || null;
    if (!unit) {
      return { datetime: null };
    }
    const newDateTime = DateTime.local().plus({ [unit]: number }).toJSDate();
    return { datetime: newDateTime };
  }
  return { datetime: null };
}

module.exports = {
  parseTimeSpec
};