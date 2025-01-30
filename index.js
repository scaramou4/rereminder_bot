require('dotenv').config();
const mongoose = require('mongoose');
const bot = require('./src/botInstance'); // ✅ Подключаем бота
const { extractDate, extractRepeatPattern, extractReminderText } = require('./src/dateParser');
require('./src/reminderScheduler'); // Подключаем напоминания

mongoose.connect('mongodb://127.0.0.1:27017/reminderBot');

const reminderSchema = new mongoose.Schema({
  userId: String,
  description: String,
  datetime: Date,
  repeat: String, 
});

// ✅ Проверяем, есть ли модель уже загружена
const Reminder = mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema);

// Функция форматирования даты
function formatDate(date) {
  if (!date) return "Без даты";
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const daysOfWeek = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} (${daysOfWeek[date.getDay()]})`;
}

// Функция форматирования подтверждения разового напоминания
function formatConfirmationMessage(description, datetime) {
  return `✅ <b>Напоминание сохранено:</b>\n\n📌 <b>Напомнить:</b> ${description}\n🕒 <b>Когда:</b> ${formatDate(datetime)}, ${String(datetime.getHours()).padStart(2, '0')}:${String(datetime.getMinutes()).padStart(2, '0')}`;
}

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Привет! Я напомню тебе о делах.");
});

// Обработка текстовых сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  let text = msg.text.toLowerCase().trim();

  if (text.startsWith('/')) return;

  let now = new Date();
  now.setSeconds(0);

  // 🔹 Исправляем "через неделю" → "через 1 неделю" (и все интервалы)
  text = text.replace(/(^|\s)через\s+(минуту|минуты|минут|час|часа|часов|день|дня|дней|неделю|недели|недель|месяц|месяца|месяцев|год|года|лет)(\s|$)/gi, '$1через 1 $2$3');  

  // **Дополнительно: проверяем, что замена точно сработала**
  if (/\bчерез неделю\b/.test(text)) {
    text = text.replace(/\bчерез неделю\b/gi, 'через 1 неделю');
  }

  console.log("🛠 Текст после полной замены:", text); // ✅ Проверка

  let parsedDate = extractDate(text);
  let repeatPattern = extractRepeatPattern(text);
  let description = extractReminderText(text);

  console.log("📩 Исходный текст:", text);
  console.log("📅 Распознанная дата:", parsedDate);
  console.log("🔁 Повтор:", repeatPattern);
  console.log("✏️ Описание:", description);

  // ✅ Проверяем "сегодня"
  const hasToday = /сегодня/.test(text);
  const hasTime = /в\s(\d{1,2})(?::(\d{2}))?/i.test(text);

  if (hasToday && !parsedDate) {
    parsedDate = new Date();
    parsedDate.setSeconds(0);
    console.log("✅ Добавлена дата для 'сегодня':", parsedDate);
  }

  // ❌ Проверка: если parsedDate всё ещё null, просим указать дату
  if (!parsedDate && !repeatPattern) {
    return bot.sendMessage(chatId, '⛔ Не удалось понять дату или время. Попробуй снова.');
  }

  // ⏳ Если "сегодня" без времени → просим пользователя указать время
  if (hasToday && !hasTime) {
    return bot.sendMessage(chatId, '⚠️ Укажите время события (например, "сегодня в 10").');
  }

  let reminderTime = new Date();
  reminderTime.setSeconds(0);

  if (repeatPattern) {
    reminderTime.setHours(9, 0);

    const timeMatch = text.match(/в\s(\d{1,2})(?::(\d{2}))?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      let minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      reminderTime.setHours(hours, minutes);
      console.log("⏳ Установлено время для повторяемого:", reminderTime);
    } else {
      console.log("⏳ Время не указано, по умолчанию 09:00");
    }
  } else if (parsedDate) {
    parsedDate.setSeconds(0);

    const timeMatch = text.match(/в\s(\d{1,2})(?::(\d{2}))?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      let minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      parsedDate.setHours(hours, minutes);
      console.log("⏳ Исправлено время на:", parsedDate);
    } else if (parsedDate.getHours() === 0 && parsedDate.getMinutes() === 0) {
      parsedDate.setHours(now.getHours(), now.getMinutes());
      console.log("⏳ Время не указано, установлено текущее:", parsedDate);
    }

    // 🚨 Проверяем, не в прошлом ли дата
    if (parsedDate < now) {
      console.log("❌ Ошибка: время в прошлом!");
      return bot.sendMessage(chatId, '⏳ Событие в прошлом. Введите корректную дату и время.');
    }
  }

  const reminder = new Reminder({
    userId: chatId,
    description: description || 'Без описания',
    datetime: repeatPattern ? reminderTime : parsedDate, 
    repeat: repeatPattern,
  });

  await reminder.save();

  const confirmationMessage = formatConfirmationMessage(description, reminder.datetime);
  bot.sendMessage(chatId, confirmationMessage, { parse_mode: "HTML" });
});