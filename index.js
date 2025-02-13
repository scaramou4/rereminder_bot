require('dotenv').config(); // Загрузка переменных из .env

const bot = require('./src/botInstance');
const { parseReminder } = require('./src/dateParser');
const { createReminder, startScheduler, handleCallback, deleteAllReminders, Reminder } = require('./src/reminderScheduler');
const listManager = require('./src/listManager'); // модуль управления списком уведомлений
const timeSpecParser = require('./src/timeSpecParser'); // модуль для извлечения времени из текста
const pendingRequests = require('./src/pendingRequests'); // объект для pending запросов
const logger = require('./src/logger');
const { DateTime } = require('luxon');

// Запуск планировщика напоминаний
startScheduler();

// Обработка команды /start
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

// Обработка команды /list – вывод списка предстоящих уведомлений постранично
bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  await listManager.sendPaginatedList(chatId, 0, false);
});

// Обработка команды /deleteall – удаление всех уведомлений пользователя
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

// Обработка входящих сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  
  // Если ожидается ввод текста для создания напоминания
  if (pendingRequests.pendingReminders[chatId]) {
    const pending = pendingRequests.pendingReminders[chatId];
    const description = msg.text;
    delete pendingRequests.pendingReminders[chatId];
    const reminder = await createReminder(chatId, description, pending.datetime, pending.repeat);
    const formattedDate = new Date(pending.datetime).toLocaleString('ru-RU', {
      dateStyle: 'long',
      timeStyle: 'short'
    });
    const confirmationText = `✅ Напоминание сохранено:
  
📌 ${description}
🕒 ${formattedDate}
🔁 Повтор: ${pending.repeat ? `каждый ${pending.repeat}` : 'нет'}`;
    await bot.sendMessage(chatId, confirmationText);
    return;
  }
  
  // Если ожидается ввод времени для custom postpone
  if (pendingRequests.pendingPostpone[chatId]) {
    const { reminderId, messageId } = pendingRequests.pendingPostpone[chatId];
    delete pendingRequests.pendingPostpone[chatId];
    // Используем модуль timeSpecParser для извлечения времени
    const parsed = timeSpecParser.parseTimeSpec(msg.text);
    if (!parsed.datetime) {
      await bot.sendMessage(chatId, 'Не удалось распознать время. Попробуйте еще раз (снова нажмите кнопку переноса и введите новое время).');
      return;
    }
    const newDateTime = parsed.datetime;
    const reminder = await Reminder.findById(reminderId);
    if (!reminder) {
      await bot.sendMessage(chatId, 'Напоминание не найдено.');
      return;
    }
    // Обновляем время напоминания, оставляя исходное описание
    reminder.datetime = newDateTime;
    reminder.messageIds = [];
    await reminder.save();
    const formattedNewTime = DateTime.fromJSDate(newDateTime).toFormat('HH:mm');
    const editedText = `Отложено: ${reminder.description}`;
    await bot.editMessageText(editedText, { 
      chat_id: chatId, 
      message_id: messageId, 
      reply_markup: { inline_keyboard: [] }, 
      parse_mode: "HTML" 
    });
    await bot.sendMessage(chatId, `🔔 Повтор: ${reminder.description}\n🕒 Новое время: ${formattedNewTime}`);
    return;
  }
  
  // Игнорируем сообщения-команды
  if (msg.text.startsWith('/')) return;
  
  const text = msg.text;
  logger.info(`Получено сообщение от user ${chatId}: "${text}"`);
  
  const { datetime: parsedDate, reminderText: description, timeSpec, repeat } = parseReminder(text);
  logger.info(`Результат парсинга для user ${chatId}: ${JSON.stringify({ timeSpec, reminderText: description, repeat, datetime: parsedDate })}`);
  
  // Если время распознано, но текст отсутствует – запрашиваем ввод
  if (parsedDate && !description) {
    pendingRequests.pendingReminders[chatId] = { datetime: parsedDate, repeat };
    await bot.sendMessage(chatId, 'Пожалуйста, введите текст напоминания:');
    return;
  }
  if (!description) return;
  
  const reminder = await createReminder(chatId, description, parsedDate, repeat);
  const formattedDate = new Date(parsedDate).toLocaleString('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short'
  });
  const confirmationText = `✅ Напоминание сохранено:
  
📌 ${description}
🕒 ${formattedDate}
🔁 Повтор: ${repeat ? `каждый ${repeat}` : 'нет'}`;
  await bot.sendMessage(chatId, confirmationText);
});

// Обработка callback‑запросов
bot.on('callback_query', async (query) => {
  if (query.data.startsWith("list_")) {
    await listManager.handleListCallback(query);
  } else {
    await handleCallback(query);
  }
});