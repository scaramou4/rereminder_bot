const Agenda = require('agenda');
const logger = require('./logger');
const bot = require('./botInstance');
const { DateTime } = require('luxon');
const Reminder = require('./models/reminder');
const { transformRepeatToAgenda } = require('./dateParser');

const mongoConnectionString = process.env.MONGODB_URI || 'mongodb://localhost:27017/reminders';
const agenda = new Agenda({ db: { address: mongoConnectionString, collection: 'agendaJobs' } });

// Логирование событий Agenda
agenda.on('start', job => {
  logger.info(`Job "${job.attrs.name}" started. Data: ${JSON.stringify(job.attrs.data)}`);
});
agenda.on('success', job => {
  logger.info(`Job "${job.attrs.name}" succeeded. Data: ${JSON.stringify(job.attrs.data)}`);
});
agenda.on('fail', (err, job) => {
  logger.error(`Job "${job.attrs.name}" failed: ${err.message}. Data: ${JSON.stringify(job.attrs.data)}`);
});

agenda.define('sendReminder', async (job, done) => {
  logger.info(`sendReminder: Job started. Data: ${JSON.stringify(job.attrs.data)}`);
  const { reminderId } = job.attrs.data;
  try {
    const reminder = await Reminder.findById(reminderId);
    if (!reminder || reminder.completed) {
      await agenda.cancel({ 'data.reminderId': reminderId, name: 'inertiaReminder' });
      logger.info(`sendReminder: Reminder ${reminderId} not found or completed. Cancelling job.`);
      return done();
    }
    const reminderScheduler = require('./reminderScheduler');
    if (reminder.repeat) {
      logger.info(`sendReminder: Sending recurring reminder for reminder ${reminderId}`);
      await reminderScheduler.sendPlannedReminderRepeated(reminder, reminder.datetime);
    } else {
      logger.info(`sendReminder: Sending one-off reminder for reminder ${reminderId}`);
      await reminderScheduler.sendOneOffReminder(reminder);
    }
    const instanceId = Date.now().toString();
    job.attrs.data.instance = instanceId;
    logger.info(`sendReminder: Scheduling inertiaReminder with instance ${instanceId}`);
    await agenda.every('3 minutes', 'inertiaReminder', { reminderId, instance: instanceId }, { skipImmediate: true, unique: { 'data.reminderId': reminderId, 'data.instance': instanceId } });
    done();
  } catch (error) {
    logger.error(`sendReminder: Error for reminder ${reminderId}: ${error.message}`);
    done(error);
  }
});

agenda.define('inertiaReminder', async (job, done) => {
  logger.info(`inertiaReminder: Job started. Data: ${JSON.stringify(job.attrs.data)}`);
  const { reminderId, instance } = job.attrs.data;
  try {
    const reminder = await Reminder.findById(reminderId);
    if (!reminder || reminder.completed) {
      await agenda.cancel({ 'data.reminderId': reminderId, name: 'inertiaReminder', 'data.instance': instance });
      logger.info(`inertiaReminder: Reminder ${reminderId} not found or completed. Cancelling job.`);
      return done();
    }
    if (!reminder.initialMessageEdited && reminder.messageId) {
      try {
        await bot.editMessageText(`Отложено: ${reminder.description}`, {
          chat_id: reminder.userId,
          message_id: reminder.messageId,
          reply_markup: { inline_keyboard: [] },
          parse_mode: 'HTML'
        });
        logger.info(`inertiaReminder: Edited initial message for reminder ${reminderId}, removed buttons.`);
        reminder.initialMessageEdited = true;
        await reminder.save();
      } catch (err) {
        logger.error(`inertiaReminder: Error editing initial message for reminder ${reminderId}: ${err.message}`);
      }
    } else if (reminder.inertiaMessageId) {
      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: reminder.userId, message_id: reminder.inertiaMessageId }
        );
        logger.info(`inertiaReminder: Cleared buttons from previous inertia message ${reminder.inertiaMessageId} for reminder ${reminderId}`);
      } catch (editErr) {
        logger.error(`inertiaReminder: Error clearing buttons from previous inertia message ${reminder.inertiaMessageId}: ${editErr.message}`);
      }
    }
    const displayTime = DateTime.fromJSDate(reminder.datetime).setZone('Europe/Moscow').toFormat('HH:mm');
    const messageText = `🔔 Напоминание (повтор): ${reminder.description}\n🕒 ${displayTime}`;
    const inlineKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '1 час', callback_data: `postpone|1|${reminder._id}` },
            { text: '3 часа', callback_data: `postpone|3|${reminder._id}` },
            { text: 'утро', callback_data: `postpone|утро|${reminder._id}` },
            { text: 'вечер', callback_data: `postpone|вечер|${reminder._id}` }
          ],
          [
            { text: '…', callback_data: `postpone|custom|${reminder._id}` },
            { text: 'Готово', callback_data: `done|${reminder._id}` }
          ]
        ]
      }
    };
    logger.info(`inertiaReminder: Sending new inertia message for reminder ${reminderId} with text: "${messageText}" and keyboard: ${JSON.stringify(inlineKeyboard)}`);
    const newMsg = await bot.sendMessage(reminder.userId, messageText, inlineKeyboard);
    logger.info(`inertiaReminder: New inertia message sent, messageId: ${newMsg.message_id}`);
    reminder.inertiaMessageId = newMsg.message_id;
    await reminder.save();
    done();
  } catch (error) {
    logger.error(`inertiaReminder: Error for reminder ${reminderId}: ${error.message}`);
    done(error);
  }
});

async function scheduleReminder(reminder) {
  try {
    if (reminder.repeat) {
      // Преобразуем русский формат повторения в формат, понятный Agenda
      const repeatInterval = transformRepeatToAgenda(reminder.repeat);
      const job = await agenda.every(repeatInterval, 'sendReminder', { reminderId: reminder._id.toString() }, { timezone: 'Europe/Moscow', unique: { 'data.reminderId': reminder._id.toString() } });
      logger.info(`scheduleReminder: Scheduled recurring reminder for reminder ${reminder._id} with interval "${repeatInterval}". Job: ${JSON.stringify(job.attrs)}`);
    } else {
      const job = await agenda.schedule(reminder.datetime, 'sendReminder', { reminderId: reminder._id.toString() });
      logger.info(`scheduleReminder: Scheduled one-off reminder for reminder ${reminder._id} at ${reminder.datetime}. Job: ${JSON.stringify(job.attrs)}`);
    }
  } catch (error) {
    logger.error(`scheduleReminder: Error scheduling for reminder ${reminder._id}: ${error.message}`);
  }
}

async function cancelReminderJobs(reminderId) {
  try {
    await agenda.cancel({ 'data.reminderId': reminderId });
    logger.info(`cancelReminderJobs: Cancelled all Agenda jobs for reminder ${reminderId}`);
  } catch (error) {
    logger.error(`cancelReminderJobs: Error cancelling jobs for reminder ${reminderId}: ${error.message}`);
  }
}

module.exports = {
  agenda,
  scheduleReminder,
  cancelReminderJobs,
};