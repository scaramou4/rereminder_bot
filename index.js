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

function formatDate(date) {
  if (!date) return "Без даты";
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}, ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `Привет! Я напомню тебе о делах.`);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  let text = msg.text.toLowerCase().trim();

  if (text.startsWith('/')) return;

  let parsedDate = extractDate(text);
  let repeatPattern = extractRepeatPattern(text);
  let description = extractReminderText(text);

  if (!parsedDate && !repeatPattern) {
    return bot.sendMessage(chatId, '⛔ Не удалось понять дату или время. Попробуй снова.');
  }

  parsedDate?.setSeconds(0);

  const reminder = new Reminder({
    userId: chatId,
    description: description || 'Без описания',
    datetime: repeatPattern ? new Date() : parsedDate, 
    repeat: repeatPattern,
  });

  await reminder.save();

  let timePart = formatDate(reminder.datetime).split(', ')[1];
  let repeatMessage = repeatPattern
    ? `каждый ${repeatPattern === 'daily' ? 'день' : repeatPattern === 'weekly' ? 'неделю' : 'месяц'} в ${timePart}`
    : formatDate(parsedDate);

  bot.sendMessage(chatId, `✅ Напоминание сохранено: "${description}" ${repeatMessage}`);
});