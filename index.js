// index.js
require('dotenv').config();

const bot = require('./src/botInstance');
const { createReminder, sendReminder, deleteAllReminders, Reminder, handleCallback } = require('./src/reminderScheduler');
const listManager = require('./src/listManager');
const timeSpecParser = require('./src/timeSpecParser');
const pendingRequests = require('./src/pendingRequests');
const logger = require('./src/logger');
const { DateTime } = require('luxon');
const { agenda } = require('./src/agendaScheduler'); // Убрал scheduleReminder из импорта
const settings = require('./src/settings');

// Запуск Agenda
(async function() {
  await agenda.start();
  logger.info('Agenda запущен');
})();

function formatRepeatPhrase(repeat) {
  if (!repeat) return 'нет';
  if (repeat.match(/^кажд(ый|ая|ую|ое|ые)\s+/)) {
    return repeat;
  }
  const parts = repeat.trim().split(' ');
  let multiplier = parseInt(parts[0], 10);
  let unit = isNaN(multiplier) ? parts[0] : parts[1];
  const feminineAccusativeMap = { 'минута': 'минуту', 'неделя': 'неделю', 'среда': 'среду', 'пятница': 'пятницу', 'суббота': 'субботу' };
  const neutral = ['воскресенье'];
  const masculine = ['понедельник', 'вторник', 'четверг', 'час', 'день', 'месяц', 'год'];
  return multiplier === 1 ? (feminineAccusativeMap[unit] ? `каждую ${feminineAccusativeMap[unit]}` : neutral.includes(unit) ? `каждое ${unit}` : masculine.includes(unit) ? `каждый ${unit}` : `каждый ${unit}`) : `каждые ${multiplier} ${unit}`;
}

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `Привет! Я бот-напоминалка.\nТы можешь создавать напоминания, просто отправляя сообщение в формате:\n"через 10 минут купить молоко"\n\nДоступные команды:\n/start - информация\n/list - список уведомлений\n/deleteall - удалить все уведомления\n/settings - настройки бота`);
});

bot.onText(/\/settings/, (msg) => {
  const chatId = msg.chat.id;
  settings.showSettingsMenu(chatId);
});

bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await listManager.sendPaginatedList(chatId, 0, false);
  } catch (error) {
    logger.error(`Ошибка при выполнении /list для user ${chatId}: ${error.message}`);
    bot.sendMessage(chatId, 'Ошибка при получении списка уведомлений.');
  }
});

bot.onText(/\/deleteall/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await deleteAllReminders(chatId);
    bot.sendMessage(chatId, 'Все уведомления и связанные задачи удалены.');
    logger.info(`/deleteall: Удалены все напоминания для user ${chatId}`);
  } catch (error) {
    logger.error(`Ошибка удаления уведомлений: ${error.message}`);
    bot.sendMessage(chatId, 'Ошибка при удалении уведомлений.');
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (msg.text && !msg.text.startsWith('/')) {
    try {
      const textNormalized = msg.text.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
      logger.info(`Получено сообщение от user ${chatId}: "${textNormalized}"`);
      const reminder = await createReminder(userId, textNormalized, chatId);
      if (reminder) {
        const eventDate = reminder.repeat ? (reminder.nextReminder || reminder.datetime) : reminder.datetime;
        const userSettings = await require('./src/models/userSettings').findOne({ userId: chatId.toString() }) || { timezone: 'Europe/Moscow' };
        const formattedDate = DateTime.fromJSDate(eventDate).setZone(userSettings.timezone).setLocale('ru').toFormat('HH:mm, d MMMM yyyy');
        bot.sendMessage(chatId, `Напоминание сохранено:\n📌 ${reminder.description}\n🕒 ${formattedDate}\n🔁 Повтор: ${formatRepeatPhrase(reminder.repeat)}`);
      } else {
        logger.warn(`Создание напоминания для user ${userId} не удалось. Текст: "${textNormalized}"`);
        // Не отправляем сообщение, так как оно уже отправлено в createReminder
      }
    } catch (error) {
      logger.error(`Ошибка обработки сообщения от user ${userId}: ${error.message}. Текст: "${msg.text}"`);
      bot.sendMessage(chatId, '❌ Произошла ошибка при обработке вашего запроса. Попробуйте ещё раз.');
    }
  } else if (msg.text) {
    logger.info(`Получена команда от user ${chatId}: ${msg.text}`);
  } else {
    logger.info(`Получено не текстовое сообщение от user ${chatId}: ${JSON.stringify(msg)}`);
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
  } catch (error) {
    logger.error(`Ошибка обработки callback от user ${query.from.id}: ${error.message}`);
    bot.answerCallbackQuery(query.id, { text: 'Ошибка при обработке запроса.', show_alert: true });
  }
});

bot.on('location', (msg) => {
  settings.handleLocation(msg);
});

logger.info('Бот запущен');