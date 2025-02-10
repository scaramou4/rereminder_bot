const { DateTime, Duration } = require('luxon');

/**
 * Функция parseReminder принимает входящее сообщение пользователя и возвращает:
 *  - timeSpec: текст, описывающий время (например, "через 10 минут" или "в 14:30")
 *  - reminderText: описание напоминания (оставшаяся часть сообщения)
 *  - repeat: строка повторения (например, "каждый вторник"), если присутствует
 *  - datetime: вычисленная дата и время срабатывания (объект Date)
 */
function parseReminder(message) {
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

    // Обработка относительных интервалов: "через 10 минут", "через 1 час и 30 минут" и т.д.
    const throughMatch = message.match(/через\s+([\d\s\w]+)(?=$|\s)/i);
    if (throughMatch) {
        timeSpec = throughMatch[0];
        let relativePart = throughMatch[1]; // например, "1 час и 30 минут"
        let parts = relativePart.split(/\s+и\s+/i);
        let totalDuration = Duration.fromObject({});
        parts.forEach(part => {
            let match = part.match(/(\d+)\s*(минут[ы]?|час[аов]?|дней?|месяцев?|лет)/i);
            if (match) {
                let value = parseInt(match[1]);
                let unit = match[2].toLowerCase();
                if (unit.startsWith('минут')) {
                    totalDuration = totalDuration.plus({ minutes: value });
                } else if (unit.startsWith('час')) {
                    totalDuration = totalDuration.plus({ hours: value });
                } else if (unit.startsWith('день')) {
                    totalDuration = totalDuration.plus({ days: value });
                } else if (unit.startsWith('месяц')) {
                    totalDuration = totalDuration.plus({ months: value });
                } else if (unit.startsWith('лет')) {
                    totalDuration = totalDuration.plus({ years: value });
                }
            }
        });
        datetime = DateTime.local().plus(totalDuration);
        reminderText = reminderText.replace(timeSpec, '').trim();
    }

    // Обработка абсолютного времени: "в 14:30" или "в 9"
    const absoluteMatch = message.match(/в\s+(\d{1,2}:\d{2}|\d{1,2})(?=$|\s)/i);
    if (absoluteMatch) {
        const timeStr = absoluteMatch[1];
        timeSpec = absoluteMatch[0];
        let [hour, minute] = timeStr.split(':').map(Number);
        if (isNaN(minute)) minute = 0;
        let candidate = DateTime.local().set({ hour, minute, second: 0, millisecond: 0 });
        // Если указанное время уже прошло, устанавливаем на следующий день
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

    return {
        timeSpec,
        reminderText,
        repeat,
        datetime: datetime.toJSDate()
    };
}

module.exports = { parseReminder };