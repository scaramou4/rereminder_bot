const { DateTime } = require('luxon');

const unitsMap = {
  'минут': 'minutes', 'минуту': 'minutes', 'минуты': 'minutes',
  'час': 'hours', 'часа': 'hours', 'часов': 'hours',
  'день': 'days', 'дня': 'days', 'дней': 'days',
  'неделю': 'weeks', 'недели': 'weeks', 'недель': 'weeks',
  'месяц': 'months', 'месяца': 'months', 'месяцев': 'months',
  'год': 'years', 'года': 'years', 'лет': 'years'
};

/**
 * Разбивает исходный текст напоминания на две части:
 * - timeSpec – часть, отвечающая за вычисление даты/повтора.
 * - reminderText – итоговый текст, который будет показан в уведомлении.
 *
 * Если в исходном сообщении содержится ключевое слово "напомни", разделение производится по нему.
 * Если же ключевого слова нет, то с помощью регулярного выражения выделяется временная спецификация,
 * которая поддерживает:
 *   - повторяющиеся фразы: "каждый день", "каждую неделю", "каждый месяц" с опциональным указанием времени;
 *   - "завтра" или "послезавтра" с опциональным временем;
 *   - конструкции "через <число> <период>( и <число> <период>)*" с опциональным временем.
 * Если совпадение найдено – оно используется как timeSpec, а остаток – как reminderText.
 * Иначе возвращаются обе части равными исходному тексту.
 */
function parseReminder(input) {
  const keywordRegex = /напомни/i;
  if (keywordRegex.test(input)) {
    const parts = input.split(keywordRegex);
    const timeSpec = parts[0].trim();
    const reminderText = parts.slice(1).join(' напомни ').trim();
    return { timeSpec, reminderText };
  } else {
    // Новое регулярное выражение для выделения временной спецификации.
    const timeSpecRegex = /^(?:(?:каждый день|каждую неделю|каждый месяц)(?:\s+в\s+\d{1,2}(?:(?:[:.,-])\d{1,2})?)?|завтра(?:\s+в\s+\d{1,2}(?:(?:[:.,-])\d{1,2})?)?|послезавтра(?:\s+в\s+\d{1,2}(?:(?:[:.,-])\d{1,2})?)?|через\s+\d+\s*[а-я]+(?:\s+и\s+\d+\s*[а-я]+)*(?:\s+в\s+\d{1,2}(?:(?:[:.,-])\d{1,2})?)?)/i;
    const match = input.match(timeSpecRegex);
    if (match) {
      const timeSpec = match[0].trim();
      const reminderText = input.slice(match[0].length).trim();
      return { timeSpec, reminderText };
    }
    return { timeSpec: input, reminderText: input };
  }
}

function preprocessText(text) {
  let processed = text
    // Обрабатываем конструкции "через 3 дня", "через неделю и 2 часа"
    .replace(/через\s+(\d+)\s*([а-я]+)(\s+и\s+(\d+)\s*([а-я]+))?/gi, (_, num1, unit1, group, num2, unit2) => {
      const enUnit1 = unitsMap[unit1.toLowerCase()] || unit1;
      let result = `in ${num1} ${enUnit1} `;
      if (group && num2 && unit2) {
        const enUnit2 = unitsMap[unit2.toLowerCase()] || unit2;
        result += `and ${num2} ${enUnit2}`;
      }
      return result;
    })
    // Обрабатываем конструкции "в 11" или "в 11:30", "в 11.30", "в 11,30", "в 11-30"
    .replace(/в\s+(\d{1,2})(?:(?:[:.,-])(\d{1,2}))?/gi, (_, hour, minute) => {
      return minute ? `at ${hour}:${minute.padStart(2, '0')}` : `at ${hour}:00`;
    })
    // Обрабатываем конструкции "и 2 часа", "и 3 дня" (если не попали в предыдущую замену)
    .replace(/и\s+(\d+)\s*([а-я]+)/gi, (_, num, unit) => {
      const enUnit = unitsMap[unit.toLowerCase()] || unit;
      return `and ${num} ${enUnit}`;
    });

  console.log('Processed Text:', processed);
  return processed;
}

/**
 * Вычисляет дату на основе текстовой части, отвечающей за время (timeSpec).
 */
function extractDateFromSpec(timeSpec) {
  const processedText = preprocessText(timeSpec);
  let now = DateTime.local().setZone('UTC+3').set({ second: 0, millisecond: 0 });
  let parsedDate = now;

  // Сначала проверяем "послезавтра", чтобы не сработало условие для "завтра"
  if (/послезавтра/i.test(timeSpec)) {
    parsedDate = parsedDate.plus({ days: 2 });
  } else if (/завтра/i.test(timeSpec)) {
    parsedDate = parsedDate.plus({ days: 1 });
  }

  // Проверяем наличие конкретного времени (например, "at 10:00")
  const timeMatch = processedText.match(/at (\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    parsedDate = parsedDate.set({ hour: hours, minute: minutes });
  }

  // Если в timeSpec присутствует повторяющийся шаблон ("каждый")
  // и вычисленная дата меньше или равна текущему времени, переносим на следующий день.
  if (/каждый/i.test(timeSpec)) {
    if (parsedDate <= now) {
      parsedDate = parsedDate.plus({ days: 1 });
    }
  } else {
    // Для одноразовых напоминаний, если вычисленная дата меньше текущего времени, тоже переносим.
    if (parsedDate < now) {
      parsedDate = parsedDate.plus({ days: 1 });
    }
  }

  // Обработка длительностей, заданных конструкциями "in ..." и "and ..."
  const durationMatches = [...processedText.matchAll(/in (\d+) (minutes|hours|days|weeks|months|years)/g)];
  for (const match of durationMatches) {
    const amount = parseInt(match[1], 10);
    const unit = match[2];
    parsedDate = parsedDate.plus({ [unit]: amount });
  }

  const extraDurationMatches = [...processedText.matchAll(/and (\d+) (minutes|hours|days|weeks|months|years)/g)];
  for (const match of extraDurationMatches) {
    const amount = parseInt(match[1], 10);
    const unit = match[2];
    parsedDate = parsedDate.plus({ [unit]: amount });
  }

  console.log('⏳ Итоговая дата:', parsedDate.toISO());
  return parsedDate.toJSDate();
}

/**
 * Функция извлечения шаблона повторения (если есть).
 */
function extractRepeatPattern(text) {
  if (/каждый день/gi.test(text)) return "daily";
  if (/каждую неделю/gi.test(text)) return "weekly";
  if (/каждый месяц/gi.test(text)) return "monthly";
  return null;
}

/**
 * Функция извлечения итогового текста напоминания.
 * Если входной текст был разделён на timeSpec и reminderText, возвращается reminderText.
 * Иначе применяется базовая логика очистки.
 */
function extractReminderText(originalText) {
  const { reminderText } = parseReminder(originalText);
  if (reminderText && reminderText !== originalText) {
    return reminderText;
  }
  return originalText
    .replace(/(каждый день|каждую неделю|каждый месяц|каждый год)/gi, '')
    .replace(/(завтра|послезавтра)/gi, '')
    .replace(/через\s+\d+\s*[а-я]+(?:\s+и\s+\d+\s*[а-я]+)*/gi, '')
    .replace(/в\s+\d{1,2}(?:(?:[:.,-])\d{1,2})?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Объединяет разбиение исходного текста и вычисление даты.
 * Возвращает объект { date, text }:
 *  - date вычисляется из timeSpec,
 *  - text – итоговый текст напоминания (без временной спецификации).
 * Добавлено логирование:
 *   - Исходный ввод пользователя,
 *   - Выделенная временная спецификация,
 *   - Итоговый текст напоминания,
 *   - Информация о повторении (если есть).
 */
function parseReminderText(input) {
  console.log("User input:", input);
  const { timeSpec, reminderText } = parseReminder(input);
  console.log("Extracted timeSpec:", timeSpec);
  const date = extractDateFromSpec(timeSpec);
  const finalText = (reminderText && reminderText !== timeSpec)
                    ? reminderText
                    : extractReminderText(input);
  const repeat = extractRepeatPattern(input);
  console.log("Extracted reminder text:", finalText);
  console.log("Repeat:", repeat ? repeat : "нет");
  return { date, text: finalText };
}

module.exports = {
  parseReminderText,
  extractRepeatPattern,
  extractReminderText
};