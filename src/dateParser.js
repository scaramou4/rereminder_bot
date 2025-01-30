const chrono = require('chrono-node');

// Функция предобработки текста (улучшенное распознавание времени)
function preprocessText(text) {
    const unitsMap = {
        'минут': 'minutes', 'минуту': 'minutes', 'минуты': 'minutes',
        'час': 'hours', 'часа': 'hours', 'часов': 'hours',
        'день': 'days', 'дня': 'days', 'дней': 'days',
        'неделю': 'weeks', 'недели': 'weeks', 'недель': 'weeks',
        'месяц': 'months', 'месяца': 'months', 'месяцев': 'months',
        'год': 'years', 'года': 'years', 'лет': 'years'
    };

    let processed = text
        .replace(/и\s+(\d+)\s*([а-я]+)/gi, (_, num, unit) => {
            const enUnit = unitsMap[unit.toLowerCase()] || unit;
            return ` and ${num} ${enUnit}`;
        })
        .replace(/(через|в)\s+(\d+)\s*([а-я]+)/gi, (_, prefix, num, unit) => {
            const enUnit = unitsMap[unit.toLowerCase()] || unit;
            return `${prefix === 'через' ? 'in' : 'at'} ${num} ${enUnit}`;
        })
        .replace(/в\s+(\d{1,2}):(\d{2})/gi, 'at $1:$2')
        .replace(/в\s+(\d{1,2})\s+(утра|дня|вечера|ночи)/gi, 'at $1');

    console.log('Processed Text:', processed);
    return processed;
}

// Функция выделения даты и времени
function extractDate(text) {
    const processedText = preprocessText(text)
      .replace(/in (\d+) weeks?/gi, (_, num) => `in ${num * 7} days`);

    console.log('Chrono Input:', processedText);
    let parsedDate = chrono.parseDate(processedText);
    console.log('Base Date:', parsedDate);

    if (!parsedDate) return null;

    let newDate = new Date(parsedDate); // Копируем распознанную дату

    // 🔹 Ищем дополнительные интервалы ("и 2 часа", "и 3 дня")
    const extraTimeMatches = [...processedText.matchAll(/and\s+(\d+)\s+(minutes?|hours?|days?|months?|years?)/gi)];

    extraTimeMatches.forEach(match => {
        const value = parseInt(match[1], 10);
        const unit = match[2].replace(/s$/, '');

        // ✅ **Исправленная проверка**: если разница < 5 минут/часов/дней — не добавляем повторно
        let alreadyAdjusted = false;
        switch(unit) {
          case 'minute': alreadyAdjusted = Math.abs(parsedDate.getMinutes() - newDate.getMinutes()) < 5; break;
          case 'hour': alreadyAdjusted = Math.abs(parsedDate.getHours() - newDate.getHours()) < 1; break;
          case 'day': alreadyAdjusted = Math.abs(parsedDate.getDate() - newDate.getDate()) < 1; break;
          case 'month': alreadyAdjusted = Math.abs(parsedDate.getMonth() - newDate.getMonth()) < 1; break;
          case 'year': alreadyAdjusted = Math.abs(parsedDate.getFullYear() - newDate.getFullYear()) < 1; break;
        }

        if (alreadyAdjusted) {
            console.log(`⏳ Chrono уже учёл ${value} ${unit}, пропускаем`);
            return;
        }

        console.log(`➕ Добавляем ${value} ${unit} к дате`);

        switch(unit) {
          case 'minute': newDate.setMinutes(newDate.getMinutes() + value); break;
          case 'hour': newDate.setHours(newDate.getHours() + value); break;
          case 'day': newDate.setDate(newDate.getDate() + value); break;
          case 'month': newDate.setMonth(newDate.getMonth() + value); break;
          case 'year': newDate.setFullYear(newDate.getFullYear() + value); break;
        }
    });

    return newDate;
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
        .replace(/(через|in)\s+\d+\s*[а-я]+\s*(и|and)?\s*(\d+\s*[а-я]+)?/gi, '')
        .replace(/(и|and)\s+\d+\s*[а-я]+/gi, '')
        .trim();
}

// Экспортируем функции
module.exports = {
    extractDate,
    extractRepeatPattern,
    extractReminderText
};