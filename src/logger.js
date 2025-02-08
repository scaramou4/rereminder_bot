const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
  ),
  transports: [
    // Логирование в файл
    new winston.transports.File({ filename: 'bot.log' }),
    // И вывод в консоль (можно удалить, если не нужен)
    new winston.transports.Console()
  ]
});

module.exports = logger;