require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const { extractDate, extractReminderText } = require('./src/dateParser'); // Подключаем модуль

// Загрузка токена из .env
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Подключение к MongoDB
mongoose.connect('mongodb://127.0.0.1:27017/reminderBot');

const reminderSchema = new mongoose.Schema({
  userId: String,
  description: String,
  datetime: Date,
});

const Reminder = mongoose.model('Reminder', reminderSchema);

// Функция форматирования даты
function formatDate(date) {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];

  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `Привет! Я помогу напомнить тебе о важных делах. Просто напиши:  
    - "завтра в 12 покормить кошку"  
    - "через 10 минут позвонить другу"  
    - "через 3 года на пенсию"  
    - "через 3 месяца ура"  
    - "через 2 недели встреча"  
    - "в пятницу в 18:00 сходить в кино"`
  );
});

// Обработка сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  let text = msg.text.toLowerCase().trim();

  // Игнорируем команды (например, /start)
  if (text.startsWith('/')) return;

  // Извлекаем дату
  let parsedDate = extractDate(text);

  // Если дата не найдена, отправляем ошибку
  if (!parsedDate) {
    return bot.sendMessage(chatId, '⛔ Не удалось понять дату или время. Попробуй снова.');
  }

  // Обрезаем секунды (ставим 0 секунд)
  parsedDate.setSeconds(0);

  // Извлекаем текст напоминания
  const description = extractReminderText(text);

  // Сохраняем в базу данных
  const reminder = new Reminder({
    userId: chatId,
    description: description || 'Без описания',
    datetime: parsedDate,
  });

  await reminder.save();

  // Отправляем сообщение с новой датой в правильном формате
  bot.sendMessage(chatId, `✅ Напоминание сохранено: "${description}" на ${formatDate(parsedDate)}`);
});