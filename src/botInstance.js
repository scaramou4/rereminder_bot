const TelegramBot = require('node-telegram-bot-api');
const logger = require('./logger');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  logger.error('Не задан TELEGRAM_BOT_TOKEN в .env!');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

bot.setMyCommands([
  { command: '/start', description: 'Запуск бота и получение информации' },
  { command: '/list', description: 'Список активных уведомлений' },
  { command: '/settings', description: 'Настройка различных параметров' }

])
  .then(() => {
    logger.info('Команды бота успешно зарегистрированы');
  })
  .catch((error) => {
    logger.error(`Ошибка при регистрации команд: ${error.message}`);
  });

module.exports = bot;