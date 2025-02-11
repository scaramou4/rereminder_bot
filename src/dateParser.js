/**
 * dateParser.js
 *
 * Модуль для нормализации временных выражений в тексте и последующего парсинга дат с использованием Luxon.
 * Функции модуля:
 *   - normalizeWord(word): Нормализует отдельное слово (приводит склонения единиц времени и дней недели к именительному падежу).
 *   - normalizeTimeExpressions(text): Заменяет во входном тексте все склонённые формы единиц времени и дней недели на их именительный падеж.
 *   - parseDate(text, format): Нормализует входной текст и парсит дату по указанному формату с учётом русской локали.
 *   - parseReminder(text): Парсит строку напоминания, поддерживая несколько вариантов:
 *       1. Относительное время: "через [<число>] <единица> <текст>" (например, "через 10 минут купить молоко" или "через минуту тест")
 *       2. Завтрашнее время: "завтра [в <час>(:<минута>)] <текст>" (например, "завтра в 12 тест")
 *       3. Определённый день недели: "в <день недели> в <час>(:<минута>) <текст>" (например, "в четверг в 12 тест")
 *       4. Повторяющееся напоминание: "каждый <период> [в <час>(:<минута>)] <текст>" 
 *          (например, "каждый день в 12 вопрос", "каждый понедельник в 9 собрание", "каждый неделю", "каждый месяц", "каждый год")
 *     Функция возвращает объект с вычисленной датой, текстом напоминания (если не указан – null), исходной временной спецификацией и информацией о повторе.
 */

const { DateTime } = require('luxon');

//
// Вспомогательные функции и словари нормализации
//

// Таблица нормализации единиц времени для месяцев, недель и лет
const timeUnitNormalization = {
  'месяц': ['месяц', 'месяца', 'месяцев'],
  'неделя': ['неделя', 'недели', 'недель', 'неделю'],
  'год': ['год', 'года', 'лет']
};

const timeUnitMap = {};
Object.entries(timeUnitNormalization).forEach(([nominative, forms]) => {
  forms.forEach(form => {
    timeUnitMap[form.toLowerCase()] = nominative;
  });
});

// Таблица нормализации для дней недели
const dayOfWeekNormalization = {
  'понедельник': ['понедельник', 'понедельника', 'понедельнику', 'понедельником', 'понедельнике'],
  'вторник': ['вторник', 'вторника', 'вторнику', 'вторником', 'вторнике'],
  'среда': ['среда', 'среды', 'среду', 'средой', 'среде'],
  'четверг': ['четверг', 'четверга', 'четвергу', 'четвергом', 'четверге'],
  'пятница': ['пятница', 'пятницы', 'пятницу', 'пятницей', 'пятнице'],
  'суббота': ['суббота', 'субботы', 'субботу', 'субботой', 'субботе'],
  'воскресенье': ['воскресенье', 'воскресенья', 'воскресенью', 'воскресеньем']
};

const dayOfWeekMap = {};
Object.entries(dayOfWeekNormalization).forEach(([nominative, forms]) => {
  forms.forEach(form => {
    dayOfWeekMap[form.toLowerCase()] = nominative;
  });
});

// Словарь для сопоставления дней недели с их числовым значением (ISO: понедельник = 1, воскресенье = 7)
const dayNameToWeekday = {
  'понедельник': 1,
  'вторник': 2,
  'среда': 3,
  'четверг': 4,
  'пятница': 5,
  'суббота': 6,
  'воскресенье': 7
};

// Формируем список ключевых слов для регулярного выражения нормализации единиц времени
const allTimeWords = [
  ...Object.keys(timeUnitMap),
  ...Object.keys(dayOfWeekMap)
];
const timeWordsRegex = new RegExp(`\\b(${allTimeWords.join('|')})\\b`, 'gi');

/**
 * Нормализует отдельное слово, приводя его к именительному падежу, если оно содержится в таблицах.
 * @param {string} word - слово для нормализации.
 * @returns {string} нормализованное слово или исходное, если нормализация не требуется.
 */
function normalizeWord(word) {
  const lowerWord = word.toLowerCase();
  if (timeUnitMap[lowerWord]) {
    return timeUnitMap[lowerWord];
  }
  if (dayOfWeekMap[lowerWord]) {
    return dayOfWeekMap[lowerWord];
  }
  return word;
}

/**
 * Нормализует временные выражения в тексте, заменяя найденные склонения единиц времени и дней недели
 * на их именительный падеж.
 * @param {string} text - исходный текст.
 * @returns {string} текст с нормализованными временными выражениями.
 */
function normalizeTimeExpressions(text) {
  return text.replace(timeWordsRegex, (match) => normalizeWord(match));
}

/**
 * Парсит дату из текста с использованием Luxon.
 * Перед парсингом текст нормализуется — все склонения единиц времени и дней недели приводятся к именительному падежу.
 * @param {string} text - исходный текст (например, "3 июля 2021" или "встреча в понедельник").
 * @param {string} format - формат для парсинга (например, 'd MMMM yyyy' или 'cccc' для дня недели).
 * @returns {DateTime} объект Luxon DateTime.
 */
function parseDate(text, format) {
  const normalizedText = normalizeTimeExpressions(text);
  return DateTime.fromFormat(normalizedText, format, { locale: 'ru' });
}

/**
 * Парсит строку напоминания, поддерживая несколько вариантов:
 *
 * 1. "через [<число>] <единица> <текст>" – относительное время
 *    Примеры:
 *      "через 10 минут купить молоко"
 *      "через минуту тест"
 *
 * 2. "завтра [в <час>(:<минута>)] <текст>"
 *    Пример:
 *      "завтра в 12 тест"
 *
 * 3. "в <день недели> в <час>(:<минута>) <текст>"
 *    Пример:
 *      "в четверг в 12 тест"
 *
 * 4. "каждый <период> [в <час>(:<минута>)] <текст>" – повторяющееся напоминание
 *    Примеры:
 *      "каждый день в 12 вопрос"
 *      "каждый понедельник в 9 собрание"
 *      "каждую неделю в 10 встреча"
 *      "каждый месяц в 15 отчет"
 *      "каждый год в 8 праздник"
 *
 * @param {string} text - исходный текст напоминания.
 * @returns {object} объект с полями:
 *   - datetime: рассчитанная дата (Date),
 *   - reminderText: текст напоминания (если отсутствует, возвращается null),
 *   - timeSpec: исходная временная спецификация,
 *   - repeat: информация о повторении (например, "день", "неделя", "месяц", "год"), либо null.
 */
function parseReminder(text) {
  const normalizedText = normalizeTimeExpressions(text);

  // 1. Вариант "через [<число>] <единица> <текст>"
  const throughRegex = /^через\s+(?:(\d+)\s+)?([A-Za-zА-Яа-яёЁ]+)\s+(.+)/i;
  let match = normalizedText.match(throughRegex);
  if (match) {
    const number = match[1] ? parseInt(match[1], 10) : 1;
    const unit = match[2].toLowerCase();
    const reminderText = match[3].trim();
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
      'месяц': 'months',
      'месяца': 'months',
      'месяцев': 'months',
      'год': 'years',
      'года': 'years',
      'лет': 'years'
    };
    const durationKey = unitMap[unit] || 'minutes';
    const parsedDate = DateTime.local().plus({ [durationKey]: number }).toJSDate();
    let repeat = null;
    const repeatMatch = normalizedText.match(/каждый\s+(\w+)/i);
    if (repeatMatch) {
      repeat = repeatMatch[1].toLowerCase();
    }
    return {
      datetime: parsedDate,
      reminderText: reminderText,
      timeSpec: `${number} ${unit}`,
      repeat: repeat
    };
  }

  // 2. Вариант "завтра [в <час>(:<минута>)] <текст>"
  const tomorrowRegex = /^завтра(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s+(.+)/i;
  match = normalizedText.match(tomorrowRegex);
  if (match) {
    const hour = match[1] ? parseInt(match[1], 10) : 9;
    const minute = match[2] ? parseInt(match[2], 10) : 0;
    const reminderText = match[3].trim();
    const dt = DateTime.local().plus({ days: 1 }).set({ hour, minute, second: 0, millisecond: 0 });
    return {
      datetime: dt.toJSDate(),
      reminderText: reminderText,
      timeSpec: `завтра в ${hour}:${minute}`,
      repeat: null
    };
  }

  // 3. Вариант "в <день недели> в <час>(:<минута>) <текст>"
  const dayOfWeekRegex = /^в\s+([A-Za-zА-Яа-яёЁ]+)\s+в\s+(\d{1,2})(?::(\d{1,2}))?\s+(.+)/i;
  match = normalizedText.match(dayOfWeekRegex);
  if (match) {
    const dayStr = match[1].toLowerCase();
    if (dayNameToWeekday[dayStr]) {
      const hour = parseInt(match[2], 10);
      const minute = match[3] ? parseInt(match[3], 10) : 0;
      const reminderText = match[4].trim();
      const now = DateTime.local();
      let diff = (dayNameToWeekday[dayStr] - now.weekday + 7) % 7;
      if (diff === 0) diff = 7;
      const dt = now.plus({ days: diff }).set({ hour, minute, second: 0, millisecond: 0 });
      return {
        datetime: dt.toJSDate(),
        reminderText: reminderText,
        timeSpec: `в ${dayStr} в ${hour}:${minute}`,
        repeat: null
      };
    }
  }

  // 4. Вариант "каждый <период> [в <час>(:<минута>)] <текст>" для повторяющихся напоминаний
  const everyRegex = /^каждый\s+([A-Za-zА-Яа-яёЁ]+)(?:\s+в\s+(\d{1,2})(?::(\d{1,2}))?)?\s*(.*)/i;
  match = normalizedText.match(everyRegex);
  if (match) {
    const period = match[1].toLowerCase();
    const hour = match[2] ? parseInt(match[2], 10) : 9;
    const minute = match[3] ? parseInt(match[3], 10) : 0;
    let reminderText = match[4] ? match[4].trim() : '';
    if (reminderText === '') reminderText = null;
    const now = DateTime.local();
    let dt;
    let repeat;
    if (period === 'день' || period === 'дня' || period === 'днев') {
      dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ days: 1 });
      repeat = 'день';
    } else if (period === 'неделя' || period === 'недели' || period === 'недель') {
      dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ weeks: 1 });
      repeat = 'неделя';
    } else if (period === 'месяц' || period === 'месяца' || period === 'месяцев') {
      // "каждый месяц" начинается с текущего дня; если время уже прошло – прибавляем месяц.
      dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ months: 1 });
      repeat = 'месяц';
    } else if (period === 'год' || period === 'года' || period === 'лет') {
      dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ years: 1 });
      repeat = 'год';
    } else if (dayNameToWeekday[period]) {
      let diff = (dayNameToWeekday[period] - now.weekday + 7) % 7;
      if (diff === 0) diff = 7;
      dt = now.plus({ days: diff }).set({ hour, minute, second: 0, millisecond: 0 });
      repeat = period;
    } else {
      dt = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ days: 1 });
      repeat = period;
    }
    return {
      datetime: dt.toJSDate(),
      reminderText: reminderText,
      timeSpec: `каждый ${period} в ${hour}:${minute}`,
      repeat: repeat
    };
  }

  return { datetime: null, reminderText: null, timeSpec: null, repeat: null };
}

module.exports = {
  normalizeWord,
  normalizeTimeExpressions,
  parseDate,
  parseReminder
};