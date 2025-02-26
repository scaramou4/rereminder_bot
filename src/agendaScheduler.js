// src/agendaScheduler.js

require('dotenv').config();
const Agenda = require('agenda');
const logger = require('./logger');

const mongoConnectionString = process.env.MONGODB_URI || 'mongodb://localhost:27017/reminders';

const agenda = new Agenda({
  db: {
    address: mongoConnectionString,
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      connectTimeoutMS: 30000
    }
  }
});

function defineSendReminderJob(sendReminder) {
  agenda.define('sendReminder', async (job) => {
    const { reminderId } = job.attrs.data;
    logger.info(`sendReminder: Job started. Data: ${JSON.stringify(job.attrs.data)}`);
    try {
      await sendReminder(reminderId);
      logger.info(`sendReminder: Job для reminder ${reminderId} завершён успешно.`);
    } catch (err) {
      logger.error(`sendReminder: Ошибка при обработке reminder ${reminderId}: ${err.message}`);
      throw err;
    }
  });
}

async function scheduleReminder(reminder) {
  const jobName = 'sendReminder';
  const when = reminder.datetime;
  logger.info(`scheduleReminder: Запланировано напоминание ${reminder._id} (${jobName}) на ${when}.`);
  await agenda.schedule(when, jobName, { reminderId: reminder._id });
}

async function cancelReminderJobs(reminderId) {
  try {
    const numRemoved = await agenda.cancel({ 'data.reminderId': reminderId });
    logger.info(`cancelReminderJobs: Отменено ${numRemoved} задач для reminder ${reminderId}`);
  } catch (err) {
    logger.error(`cancelReminderJobs: Ошибка при отмене задач для reminder ${reminderId}: ${err.message}`);
  }
}

module.exports = {
  agenda,
  defineSendReminderJob,
  scheduleReminder,
  cancelReminderJobs
};