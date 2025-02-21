require('dotenv').config();

const bot = require('./src/botInstance');
const { parseReminder } = require('./src/dateParser');
const { createReminder, handleCallback, deleteAllReminders, Reminder } = require('./src/reminderScheduler');
const listManager = require('./src/listManager');
const timeSpecParser = require('./src/timeSpecParser');
const pendingRequests = require('./src/pendingRequests');
const logger = require('./src/logger');
const { DateTime } = require('luxon');
const { agenda } = require('./src/agendaScheduler');

(async function() {
  await agenda.start();
  logger.info('Agenda запущен');
})();

function formatRepeatPhrase(repeat) {
  if (!repeat) return 'нет';
  const feminineAccusativeMap = {
    'минута': 'минуту',
    'неделя': 'неделю',
    'среда': 'среду',
    'пятница': 'пятницу',
    'суббота': 'субботу'
  };
  const neutral = ['воскресенье'];
  const parts = repeat.split(' ');
  if (parts.length === 1) {
    let unit = parts[0];
    if (feminineAccusativeMap[unit]) {
      return `каждую ${feminineAccusativeMap[unit]}`;
    } else if (neutral.includes(unit)) {
      return `каждое ${unit}`;
    } else {
      return `каждый ${unit}`;
    }
  } else {
    const multiplier = parts[0];
    const unit = parts.slice(1).join(' ');
    return `каждые ${multiplier} ${unit}`;
  }
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `Привет! Я бот-напоминалка.
  
Ты можешь создавать напоминания, просто отправляя сообщение в формате:
"через 10 минут купить молоко"

Доступные команды:
/start - информация
/list - список уведомлений
/deleteall - удалить все уведомления`;
  bot.sendMessage(chatId, welcomeMessage);
});

bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  await listManager.sendPaginatedList(chatId, 0, false);
});

bot.onText(/\/deleteall/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await deleteAllReminders(chatId);
    bot.sendMessage(chatId, 'Все уведомления удалены.');
  } catch (error) {
    logger.error(`Ошибка удаления уведомлений: ${error.message}`);
    bot.sendMessage(chatId, 'Ошибка при удалении уведомлений.');
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  
  if (pendingRequests.pendingReminders[chatId]) {
    const pending = pendingRequests.pendingReminders[chatId];
    const description = msg.text;
    delete pendingRequests.pendingReminders[chatId];
    const reminder = await createReminder(chatId, description, pending.datetime, pending.repeat);
    const eventDate = pending.repeat ? (reminder.nextReminder || reminder.datetime) : pending.datetime;
    const formattedDate = new Date(eventDate).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
    const confirmationText = `✅ Напоминание сохранено:
  
📌 ${description}
🕒 ${formattedDate}
🔁 Повтор: ${formatRepeatPhrase(pending.repeat)}`;
    await bot.sendMessage(chatId, confirmationText);
    return;
  }
  
  if (pendingRequests.pendingPostpone[chatId]) {
    const { reminderId, messageId } = pendingRequests.pendingPostpone[chatId];
    delete pendingRequests.pendingPostpone[chatId];
    const parsed = timeSpecParser.parseTimeSpec(msg.text);
    if (!parsed.datetime) {
      await bot.sendMessage(chatId, "Сорри, не смог распознать. Попробуйте снова.");
      return;
    }
    const newDateTime = parsed.datetime;
    const reminder = await Reminder.findById(reminderId);
    if (!reminder) {
      await bot.sendMessage(chatId, 'Напоминание не найдено.');
      return;
    }
    reminder.datetime = newDateTime;
    reminder.messageIds = [];
    await reminder.save();
    const formattedNewTime = DateTime.fromJSDate(newDateTime).toFormat('HH:mm');
    await bot.editMessageText(`🔔 Отложено: ${reminder.description}`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] }, parse_mode: "HTML" });
    await bot.sendMessage(chatId, `🔔 Повторно: ${reminder.description}\n🕒 Новое время: ${formattedNewTime}`, { parse_mode: "HTML" });
    const { scheduleReminder } = require('./src/agendaScheduler');
    await scheduleReminder(reminder);
    return;
  }
  
  if (msg.text.startsWith('/')) return;
  
  const textNormalized = msg.text.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
  logger.info(`Получено сообщение от user ${chatId}: "${textNormalized}"`);
  const { datetime: parsedDate, reminderText: description, timeSpec, repeat } = require('./src/dateParser').parseReminder(textNormalized);
  logger.info(`Результат парсинга: ${JSON.stringify({ timeSpec, reminderText: description, repeat, datetime: parsedDate })}`);
  if (!parsedDate) {
    await bot.sendMessage(chatId, "Сорри, не смог распознать. Попробуйте снова.");
    return;
  }
  
  if (parsedDate && !description) {
    pendingRequests.pendingReminders[chatId] = { datetime: parsedDate, repeat };
    await bot.sendMessage(chatId, 'Пожалуйста, введите текст напоминания:');
    return;
  }
  
  const reminder = await createReminder(chatId, description, parsedDate, repeat);
  const eventDate = repeat ? (reminder.nextReminder || reminder.datetime) : parsedDate;
  const formattedDate = new Date(eventDate).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
  const confirmationText = `✅ Напоминание сохранено:
  
📌 ${description}
🕒 ${formattedDate}
🔁 Повтор: ${formatRepeatPhrase(repeat)}`;
  await bot.sendMessage(chatId, confirmationText);
});

bot.on('callback_query', async (query) => {
  if (query.data.startsWith("list_")) {
    await listManager.handleListCallback(query);
  } else {
    await handleCallback(query);
  }
});