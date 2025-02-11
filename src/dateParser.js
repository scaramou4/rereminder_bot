const { DateTime, Duration } = require('luxon');
const logger = require('./logger');

/**
 * Функция parseReminder принимает входящее сообщение и возвращает:
 *  - timeSpec: строка, описывающая временной интервал (например, "через 10 минут" или "через минуту")
 *  - reminderText: оставшаяся часть сообщения (описание напоминания)
 *  - repeat: строка повторения (например, "каждый вторник"), если присутствует
 *  - datetime: вычисленная дата и время срабатывания (объект Date)
 */
function parseReminder(message) {
  const originalMessage = message; // сохраняем оригинал для логирования
  // Убираем ключевое слово "напомни( мне)"
  message = message.replace(/напомни( мне)?/i, '').trim();

  let timeSpec = null;
  let reminderText = message;
  let repeat = null;
  let datetime = null;

  // Обработка повторяющихся конструкций "каждый ..."
  const repeatMatch = message.match(/каждый\s+(\S+)/i);
  if (repeatMatch) {
    repeat = `каждый ${repeatMatch[1]}`;
    reminderText = reminderText.replace(repeatMatch[0], '').trim();
  }

  // Обработка относительных интервалов.
  // Поддерживаются конструкции вида: "через 10 минут", "через минуту", "через 1 час и 30 минут" и т.д.
  const relativeRegex = /через\s+((?:\d+\s*)?(?:минута|минуты|минут|час(?:а|ов)?|день|дня|дней|месяц|месяца|месяцев|год|года|лет)(?:\s+и\s+(?:\d+\s*)?(?:минута|минуты|минут|час(?:а|ов)?|день|дня|дней|месяц|месяца|месяцев|год|года|лет))*)/i;
  const throughMatch = message.match(relativeRegex);
  if (throughMatch) {
    timeSpec = throughMatch[0]; // Например, "через 3 дня" или "через минуту"
    let relativePart = throughMatch[1]; // Например, "3 дня" или "минуту"
    let parts = relativePart.split(/\s+и\s+/i);
    let totalDuration = Duration.fromObject({});
    const partRegex = /(?:(\d+)\s*)?(минута|минуты|минут|час(?:а|ов)?|день|дня|дней|месяц|месяца|месяцев|год|года|лет)/i;
    parts.forEach(part => {
      let match = part.match(partRegex);
      if (match) {
        let value = match[1] ? parseInt(match[1]) : 1; // Если число не указано – по умолчанию 1
        let unit = match[2].toLowerCase();
        if (/^минут(а|ы)?$/.test(unit)) {
          totalDuration = totalDuration.plus({ minutes: value });
        } else if (/^час(а|ов)?$/.test(unit)) {
          totalDuration = totalDuration.plus({ hours: value });
        } else if (/^(день|дня|дней)$/.test(unit)) {
          totalDuration = totalDuration.plus({ days: value });
        } else if (/^(месяц|месяца|месяцев)$/.test(unit)) {
          totalDuration = totalDuration.plus({ months: value });
        } else if (/^(год|года|лет)$/.test(unit)) {
          totalDuration = totalDuration.plus({ years: value });
        }
      }
    });
    datetime = DateTime.local().plus(totalDuration);
    reminderText = reminderText.replace(timeSpec, '').trim();
  }

  // Обработка абсолютного времени: "в 14:30" или "в 9"
  const absoluteMatch = message.match(/в\s+(\d{1,2}(?::\d{2})?)(?=$|\s)/i);
  if (absoluteMatch) {
    const timeStr = absoluteMatch[1];
    timeSpec = absoluteMatch[0];
    let [hour, minute] = timeStr.split(':').map(Number);
    if (isNaN(minute)) minute = 0;
    let candidate = DateTime.local().set({ hour, minute, second: 0, millisecond: 0 });
    // Если указанное время уже прошло – ставим на следующий день
    if (candidate < DateTime.local()) {
      candidate = candidate.plus({ days: 1 });
    }
    datetime = candidate;
    reminderText = reminderText.replace(absoluteMatch[0], '').trim();
  }

  // Если ни один вариант не сработал – используем текущее время
  if (!datetime) {
    datetime = DateTime.local();
  }

  const result = {
    timeSpec,
    reminderText,
    repeat,
    datetime: datetime.toJSDate()
  };

  logger.info(
    `Парсинг запроса: "${originalMessage}" -> timeSpec: "${timeSpec}", reminderText: "${reminderText}", repeat: "${repeat}", datetime: "${datetime.toJSDate()}"`
  );

  return result;
}

module.exports = { parseReminder };