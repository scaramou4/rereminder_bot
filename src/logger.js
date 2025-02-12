const { createLogger, format, transports } = require('winston');

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

// Пример обёртки для логирования ошибок (чтобы выводилась только краткая информация):
logger.errorShort = (errMsgOrError) => {
  const message = (typeof errMsgOrError === 'string') ? errMsgOrError : (errMsgOrError.message || 'Неизвестная ошибка');
  logger.error(message);
};

module.exports = logger;