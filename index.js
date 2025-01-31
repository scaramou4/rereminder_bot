require('dotenv').config();
const mongoose = require('mongoose');
const bot = require('./src/botInstance');
const { extractDate, extractRepeatPattern, extractReminderText } = require('./src/dateParser');
require('./src/reminderScheduler');

mongoose.connect('mongodb://127.0.0.1:27017/reminderBot');

const reminderSchema = new mongoose.Schema({
  userId: String,
  description: String,
  datetime: Date,
  repeat: String,
});

const Reminder = mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema);

function formatDate(date) {
  if (!date) return "Без даты";
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} (${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')})`;
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `Привет! Я напомню тебе о делах.`);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  let text = msg.text.toLowerCase().trim();

  if (text.startsWith('/')) return;

  let now = new Date();
  now.setSeconds(0);

  let parsedDate = extractDate(text);
  let repeatPattern = extractRepeatPattern(text);
  let description = extractReminderText(text);

  console.log("📩 Исходный текст:", text);
  console.log("📅 Распознанная дата:", parsedDate);
  console.log("🔁 Повтор:", repeatPattern);
  console.log("✏️ Описание:", description);

  if (!parsedDate && !repeatPattern) {
    return bot.sendMessage(chatId, '⛔ Не удалось понять дату или время. Попробуй снова.');
  }

  if (parsedDate < now) {
    return bot.sendMessage(chatId, '⏳ Событие в прошлом. Введите корректную дату и время.');
  }

  const reminder = new Reminder({
    userId: chatId,
    description: description || 'Без описания',
    datetime: parsedDate,
    repeat: repeatPattern,
  });

  await reminder.save();

  bot.sendMessage(chatId, `✅ Напоминание сохранено:\n\n📌 <b>Напомнить:</b> ${description}\n🕒 <b>Когда:</b> ${formatDate(parsedDate)}`, { parse_mode: "HTML" });
});