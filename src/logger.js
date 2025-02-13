const fs = require('fs');
const { createLogger, format, transports } = require('winston');

// Очищаем файл логов при запуске
fs.writeFileSync('bot.log', '');

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ level, message, timestamp }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
  ),
  transports: [
    new transports.File({ filename: 'bot.log' }),
    new transports.Console()
  ]
});

module.exports = logger;