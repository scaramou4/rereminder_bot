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

// В agendaScheduler.js
async function scheduleReminder(reminder) {
  if (!reminder || !reminder.datetime) {
    logger.warn(`scheduleReminder: Напоминание или дата отсутствуют, пропускаем. Reminder: ${reminder ? reminder._id : 'null'}`);
    return;
  }

  const when = reminder.datetime;
  const job = agenda.create('send reminder', { reminderId: reminder._id.toString() });
  await job.schedule(when).save();
  logger.info(`scheduleReminder: Напоминание ${reminder._id} запланировано на ${when}`);
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