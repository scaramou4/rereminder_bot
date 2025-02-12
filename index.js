require('dotenv').config(); // Загрузка переменных из .env

const bot = require('./src/botInstance');
const { parseReminder } = require('./src/dateParser');
const { createReminder, startScheduler, handleCallback, deleteAllReminders } = require('./src/reminderScheduler');
const listManager = require('./src/listManager'); // модуль управления списком уведомлений
const logger = require('./src/logger');

const pendingReminders = {};

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

// Обработка входящих сообщений (создание напоминаний)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Если ранее запрошен ввод текста напоминания, используем текущее сообщение
  if (pendingReminders[chatId]) {
    const pending = pendingReminders[chatId];
    const description = msg.text;
    delete pendingReminders[chatId];
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

  // Игнорируем сообщения-команды
  if (msg.text.startsWith('/')) return;

  const text = msg.text;
  logger.info(`Получено сообщение от user ${chatId}: "${text}"`);

  const { datetime: parsedDate, reminderText: description, timeSpec, repeat } = parseReminder(text);
  logger.info(`Результат парсинга для user ${chatId}: ${JSON.stringify({ timeSpec, reminderText: description, repeat, datetime: parsedDate })}`);

  // Если время распознано, но текст отсутствует – запрашиваем ввод
  if (parsedDate && !description) {
    pendingReminders[chatId] = { datetime: parsedDate, repeat };
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