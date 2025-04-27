// agendaScheduler.js
require('dotenv').config();
const Agenda = require('agenda');
const logger = require('./logger');
const { DateTime } = require('luxon');

const mongoConnectionString = process.env.MONGODB_URI || 'mongodb://localhost:27017/reminders';

const agenda = new Agenda({
  db: {
    address: mongoConnectionString,
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      connectTimeoutMS: 30000
    }
  },
  defaultConcurrency: 5, // Ограничиваем количество одновременно выполняемых задач
  maxConcurrency: 20,   // Максимальное количество задач
  lockLimit: 10,        // Количество блокировок, которые Agenda может установить
  processEvery: '1 minute' // Частота проверки новых задач
});

// Обработка ошибок Agenda
agenda.on('fail', async (err, job) => {
  logger.error(`Ошибка выполнения задачи Agenda для напоминания ${job.attrs.data.reminderId}: ${err.message}`);
  
  try {
    // Попытка перепланировать задачу через 5 минут
    await job.schedule(new Date(Date.now() + 5 * 60 * 1000)).save();
    logger.info(`Задача ${job.attrs.name} перепланирована через 5 минут`);
  } catch (rescheduleError) {
    logger.error(`Ошибка перепланирования задачи: ${rescheduleError.message}`);
  }
});

agenda.on('ready', () => {
  logger.info('Agenda подключена к MongoDB и готова к работе');
});

agenda.on('error', (err) => {
  logger.error(`Ошибка Agenda: ${err.message}`);
});

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown() {
  logger.info('Получен сигнал завершения работы. Останавливаем Agenda...');
  try {
    await agenda.stop();
    logger.info('Agenda успешно остановлена');
    process.exit(0);
  } catch (err) {
    logger.error(`Ошибка при остановке Agenda: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Определяет задачу для отправки напоминаний
 * @param {Function} sendReminder - Функция обработки напоминания
 */
function defineSendReminderJob(sendReminder) {
  agenda.define('sendReminder', { 
    priority: 'high', 
    concurrency: 5 
  }, async (job) => {
    const { reminderId } = job.attrs.data;
    logger.info(`Задача sendReminder запущена для reminder ${reminderId}`);
    
    try {
      await sendReminder(reminderId);
      logger.info(`Задача sendReminder успешно выполнена для reminder ${reminderId}`);
    } catch (error) {
      logger.error(`Ошибка выполнения задачи sendReminder для reminder ${reminderId}: ${error.message}`);
      throw error; // Agenda перехватит это и вызовет событие 'fail'
    }
  });
}

/**
 * Планирует напоминание в Agenda
 * @param {Object} reminder - Объект напоминания
 * @returns {Promise<void>}
 */
async function scheduleReminder(reminder) {
  if (!reminder || !reminder.datetime) {
    logger.warn('scheduleReminder: Напоминание или дата отсутствуют, пропускаем');
    return;
  }

  try {
    // Отменяем старые задачи для этого напоминания
    await agenda.cancel({ 
      'data.reminderId': reminder._id.toString() 
    });

    // Создаем новую задачу
    const job = agenda.create('sendReminder', { 
      reminderId: reminder._id.toString() 
    });

    // Устанавливаем время выполнения с учетом часового пояса
    const scheduledDate = DateTime.fromJSDate(reminder.datetime)
      .setZone('UTC')
      .toJSDate();

    await job.schedule(scheduledDate).save();
    
    logger.info(`Напоминание ${reminder._id} запланировано на ${reminder.datetime}`);
  } catch (error) {
    logger.error(`Ошибка планирования напоминания ${reminder._id}: ${error.message}`);
    throw error;
  }
}

/**
 * Отменяет все задачи для указанного напоминания
 * @param {String} reminderId - ID напоминания
 * @returns {Promise<Number>} Количество отмененных задач
 */
async function cancelReminderJobs(reminderId) {
  try {
    const numRemoved = await agenda.cancel({ 
      'data.reminderId': reminderId.toString() 
    });
    
    logger.info(`Отменено ${numRemoved} задач Agenda для reminder ${reminderId}`);
    return numRemoved;
  } catch (error) {
    logger.error(`Ошибка отмены задач для reminder ${reminderId}: ${error.message}`);
    throw error;
  }
}

// Запускаем Agenda при подключении к MongoDB
(async function() {
  try {
    await agenda.start();
    logger.info('Agenda успешно запущена');
    
    // Очищаем зависшие задачи при старте
    const numJobs = await agenda.purge();
    if (numJobs > 0) {
      logger.warn(`Очищено ${numJobs} зависших задач Agenda`);
    }
  } catch (error) {
    logger.error(`Ошибка запуска Agenda: ${error.message}`);
    process.exit(1);
  }
})();

module.exports = {
  agenda,
  defineSendReminderJob,
  scheduleReminder,
  cancelReminderJobs
};