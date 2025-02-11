require('dotenv').config(); // Загрузка переменных из .env

const bot = require('./src/botInstance');
const { parseReminder } = require('./src/dateParser');
const { createReminder, startScheduler, handleCallback, listReminders, deleteAllReminders } = require('./src/reminderScheduler');
const logger = require('./src/logger');

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

// Обработка команды /list – вывод списка активных уведомлений
bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const reminders = await listReminders(chatId);
    if (!reminders || reminders.length === 0) {
      bot.sendMessage(chatId, 'У вас нет активных уведомлений.');
      return;
    }
    let messageText = 'Ваши активные уведомления:';
    reminders.forEach((reminder, index) => {
      const formattedTime = new Date(reminder.datetime).toLocaleString('ru-RU', {
        dateStyle: 'long',
        timeStyle: 'short'
      });
      messageText += `\n${index + 1}. ${reminder.description} — ${formattedTime}${reminder.repeat ? ' (повтор: ' + reminder.repeat + ')' : ''}`;
    });
    bot.sendMessage(chatId, messageText);
  } catch (error) {
    logger.error(`Ошибка получения списка уведомлений: ${error.message}`);
    bot.sendMessage(chatId, 'Ошибка при получении списка уведомлений.');
  }
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

// Обработка входящих сообщений (игнорируются команды, начинающиеся со слеша)
bot.on('message', async (msg) => {
  if (msg.text.startsWith('/')) {
    return;
  }
  const chatId = msg.chat.id;
  const text = msg.text;
  logger.info(`Получено сообщение от user ${chatId}: "${text}"`);
  
  // Используем функцию parseReminder из dateParser.js
  const { datetime: parsedDate, reminderText: description, timeSpec, repeat } = parseReminder(text);
  logger.info(`Результат парсинга для user ${chatId}: ${JSON.stringify({ timeSpec, reminderText: description, repeat, datetime: parsedDate })}`);
  
  if (!description) {
    return;
  }
  
  const reminder = await createReminder(chatId, description, parsedDate, repeat);
  
  const formattedDate = new Date(parsedDate).toLocaleString('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short'
  });
  const confirmationText = `✅ Напоминание сохранено:
  
📌 ${description}
🕒 ${formattedDate}
🔁 Повтор: ${repeat ? repeat : 'нет'}`;
  
  await bot.sendMessage(chatId, confirmationText);
});

// Обработка callback‑запросов (нажатий на inline‑клавиатуру)
bot.on('callback_query', async (query) => {
  await handleCallback(query);
});