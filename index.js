require('dotenv').config();

const bot = require('./src/botInstance');
const { parseReminder } = require('./src/dateParser');
const { createReminder, startScheduler, handleCallback, deleteAllReminders, Reminder } = require('./src/reminderScheduler');
const listManager = require('./src/listManager');
const timeSpecParser = require('./src/timeSpecParser');
const pendingRequests = require('./src/pendingRequests');
const logger = require('./src/logger');
const { DateTime } = require('luxon');

startScheduler();

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
  
  // Если ожидается ввод текста для создания нового уведомления
  if (pendingRequests.pendingReminders[chatId]) {
    const pending = pendingRequests.pendingReminders[chatId];
    const description = msg.text;
    delete pendingRequests.pendingReminders[chatId];
    const reminder = await createReminder(chatId, description, pending.datetime, pending.repeat);
    const formattedDate = new Date(pending.datetime).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
    const confirmationText = `✅ Напоминание сохранено:
  
📌 ${description}
🕒 ${formattedDate}
🔁 Повтор: ${pending.repeat ? (pending.repeat === 'неделя' ? 'каждую неделю' : `каждый ${pending.repeat}`) : 'нет'}`;
    await bot.sendMessage(chatId, confirmationText);
    return;
  }
  
  // Если ожидается ввод времени для custom postpone
  if (pendingRequests.pendingPostpone[chatId]) {
    const { reminderId, messageId } = pendingRequests.pendingPostpone[chatId];
    delete pendingRequests.pendingPostpone[chatId];
    const parsed = timeSpecParser.parseTimeSpec(msg.text);
    if (!parsed.datetime) {
      await bot.sendMessage(chatId, "Сорри, не смог распознать. Давайте еще раз. Напишите понятно: 'завтра в 10 купи молоко'. Нажмите три точки еще раз и попробуйте снова.");
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
    // Сначала редактируем исходное сообщение: меняем текст на "🔔 Отложено: ..."
    await bot.editMessageText(`🔔 Отложено: ${reminder.description}`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] }, parse_mode: "HTML" });
    // Затем отправляем новое уведомление с информацией о новом времени
    await bot.sendMessage(chatId, `🔔 Повторно: ${reminder.description}\n🕒 Новое время: ${formattedNewTime}`, { parse_mode: "HTML" });
    return;
  }
  
  if (msg.text.startsWith('/')) return;
  
  const text = msg.text;
  logger.info(`Получено сообщение от user ${chatId}: "${text}"`);
  
  const { datetime: parsedDate, reminderText: description, timeSpec, repeat } = parseReminder(text);
  logger.info(`Результат парсинга для user ${chatId}: ${JSON.stringify({ timeSpec, reminderText: description, repeat, datetime: parsedDate })}`);
  
  if (!parsedDate) {
    await bot.sendMessage(chatId, "Сорри, не смог распознать. Давайте еще раз. Напишите понятно: 'завтра в 10 купи молоко'.");
    return;
  }
  
  if (parsedDate && !description) {
    pendingRequests.pendingReminders[chatId] = { datetime: parsedDate, repeat };
    await bot.sendMessage(chatId, 'Пожалуйста, введите текст напоминания:');
    return;
  }
  if (!description) return;
  
  const reminder = await createReminder(chatId, description, parsedDate, repeat);
  const formattedDate = new Date(parsedDate).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
  const confirmationText = `✅ Напоминание сохранено:
  
📌 ${description}
🕒 ${formattedDate}
🔁 Повтор: ${repeat ? (repeat === 'неделя' ? 'каждую неделю' : `каждый ${repeat}`) : 'нет'}`;
  await bot.sendMessage(chatId, confirmationText);
});

bot.on('callback_query', async (query) => {
  if (query.data.startsWith("list_")) {
    await listManager.handleListCallback(query);
  } else {
    await handleCallback(query);
  }
});