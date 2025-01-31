const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

// Создаём бота
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Задаём команды бота
bot.setMyCommands([
  { command: '/start', description: 'Запуск бота' },
  { command: '/list', description: 'Показать активные напоминания' },
]).then(() => {
    console.log("✅ Команды бота обновлены.");
  }).catch((err) => {
    console.error("❌ Ошибка обновления команд:", err);
  });

module.exports = bot;