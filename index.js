// index.js
require('dotenv').config();

const mongoose = require('mongoose');
const logger = require('./src/logger');
const bot = require('./src/botInstance');
const { createReminder, deleteAllReminders, handleCallback } = require('./src/reminderScheduler');
const listManager = require('./src/listManager');
const { DateTime } = require('luxon');
const settings = require('./src/settings');

// Подключаемся к MongoDB для моделей Mongoose
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/reminders', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => logger.info('Mongoose подключен к MongoDB'))
  .catch(err => {
    logger.error(`Ошибка подключения Mongoose: ${err.message}`);
    process.exit(1);
  });

function formatRepeatPhrase(repeat) {
  if (!repeat) return 'нет';
  if (repeat.match(/^кажд(ый|ая|ую|ое|ые)\s+/)) {
    return repeat;
  }
  const parts = repeat.trim().split(' ');
  let multiplier = parseInt(parts[0], 10);
  let unit = isNaN(multiplier) ? parts[0] : parts[1];
  const feminineAccusativeMap = {
    'минута': 'минуту',
    'неделя': 'неделю',
    'среда': 'среду',
    'пятница': 'пятницу',
    'суббота': 'субботу'
  };
  const neutral = ['воскресенье'];
  const masculine = ['понедельник', 'вторник', 'четверг', 'час', 'день', 'месяц', 'год'];

  if (multiplier === 1) {
    if (feminineAccusativeMap[unit]) return `каждую ${feminineAccusativeMap[unit]}`;
    if (neutral.includes(unit))      return `каждое ${unit}`;
    if (masculine.includes(unit))    return `каждый ${unit}`;
    return `каждый ${unit}`;
  } else {
    return `каждые ${multiplier} ${unit}`;
  }
}

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    `Привет! Я бот-напоминалка.\n` +
    `Чтобы создать напоминание, просто напиши, например:\n` +
    `"через 10 минут купить молоко"\n\n` +
    `Доступные команды:\n` +
    `/start — информация\n` +
    `/list — список напоминаний\n` +
    `/deleteall — удалить все напоминания\n` +
    `/settings — настройки`
  );
});

bot.onText(/\/settings/, (msg) => {
  settings.showSettingsMenu(msg.chat.id);
});

bot.onText(/\/list/, async (msg) => {
  try {
    await listManager.sendPaginatedList(msg.chat.id, 0, false);
  } catch (err) {
    logger.error(`Ошибка /list для ${msg.chat.id}: ${err.message}`);
    bot.sendMessage(msg.chat.id, 'Ошибка при получении списка уведомлений.');
  }
});

bot.onText(/\/deleteall/, async (msg) => {
  try {
    await deleteAllReminders(msg.chat.id);
    bot.sendMessage(msg.chat.id, 'Все уведомления удалены.');
    logger.info(`/deleteall: удалены все напоминания для ${msg.chat.id}`);
  } catch (err) {
    logger.error(`Ошибка /deleteall для ${msg.chat.id}: ${err.message}`);
    bot.sendMessage(msg.chat.id, 'Ошибка при удалении уведомлений.');
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (msg.text && !msg.text.startsWith('/')) {
    const textNormalized = msg.text.replace(/ё/gi, 'е');
    logger.info(`Сообщение от ${chatId}: "${textNormalized}"`);
    try {
      const reminder = await createReminder(userId, textNormalized, chatId);
      if (reminder) {
        const eventDate = reminder.repeat
          ? (reminder.nextReminder || reminder.datetime)
          : reminder.datetime;
        const us = await require('./src/models/userSettings')
          .findOne({ userId: chatId.toString() });
        const tz = us ? us.timezone : 'Europe/Moscow';
        const formatted = DateTime
          .fromJSDate(eventDate)
          .setZone(tz)
          .setLocale('ru')
          .toFormat('HH:mm, d MMMM yyyy');
        bot.sendMessage(chatId,
          `Напоминание сохранено:\n` +
          `📌 ${reminder.description}\n` +
          `🕒 ${formatted}\n` +
          `🔁 Повтор: ${formatRepeatPhrase(reminder.repeat)}`
        );
      }
    } catch (err) {
      logger.error(`Ошибка обработки текста "${msg.text}" от ${userId}: ${err.message}`);
      bot.sendMessage(chatId, '❌ Ошибка при создании напоминания. Попробуйте ещё раз.');
    }
  }
});

bot.on('callback_query', async (query) => {
  try {
    if (query.data.startsWith('list_')) {
      await listManager.handleListCallback(query);
    } else if (query.data.startsWith('settings_')) {
      await settings.handleSettingsCallback(query);
    } else {
      await handleCallback(query);
    }
  } catch (err) {
    logger.error(`Callback error ${query.from.id}: ${err.message}`);
    bot.answerCallbackQuery(query.id, { text: 'Ошибка обработки.', show_alert: true });
  }
});

bot.on('location', (msg) => {
  settings.handleLocation(msg);
});

logger.info('Бот запущен');