// src/agendaScheduler.js
const Agenda = require('agenda');
const logger = require('./logger');
const bot = require('./botInstance');
const { DateTime } = require('luxon');
const Reminder = require('./models/reminder');

const mongoConnectionString = process.env.MONGODB_URI || 'mongodb://localhost:27017/reminders';
const agenda = new Agenda({ db: { address: mongoConnectionString, collection: 'agendaJobs' } });

// Логирование событий Agenda
agenda.on('start', job => {
  logger.info(`Job "${job.attrs.name}" запущен. Данные: ${JSON.stringify(job.attrs.data)}`);
});
agenda.on('success', job => {
  logger.info(`Job "${job.attrs.name}" успешно выполнен. Данные: ${JSON.stringify(job.attrs.data)}`);
});
agenda.on('fail', (err, job) => {
  logger.error(`Job "${job.attrs.name}" завершился с ошибкой: ${err.message}. Данные: ${JSON.stringify(job.attrs.data)}`);
});

// Основная задача для отправки напоминания
agenda.define('sendReminder', async (job, done) => {
  const { reminderId } = job.attrs.data;
  try {
    const reminder = await Reminder.findById(reminderId);
    if (!reminder || reminder.completed) {
      await agenda.cancel({ 'data.reminderId': reminderId, name: 'inertiaReminder' });
      logger.info(`sendReminder: Напоминание ${reminderId} не найдено или выполнено. Job отменён.`);
      return done();
    }
    const reminderScheduler = require('./reminderScheduler');
    if (reminder.repeat) {
      logger.info(`sendReminder: Отправляем повторяющееся уведомление для reminder ${reminderId}`);
      await reminderScheduler.sendPlannedReminderRepeated(reminder, reminder.datetime);
    } else {
      logger.info(`sendReminder: Отправляем одноразовое уведомление для reminder ${reminderId}`);
      await reminderScheduler.sendOneOffReminder(reminder);
    }
    const instanceId = Date.now().toString();
    job.attrs.data.instance = instanceId;
    await agenda.every('3 minutes', 'inertiaReminder', { reminderId, instance: instanceId }, { skipImmediate: true, unique: { 'data.reminderId': reminderId, 'data.instance': instanceId } });
    done();
  } catch (error) {
    logger.error(`sendReminder: Ошибка для reminder ${reminderId}: ${error.message}`);
    done(error);
  }
});

// Задача инерционного цикла
agenda.define('inertiaReminder', async (job, done) => {
  const { reminderId, instance } = job.attrs.data;
  try {
    const reminder = await Reminder.findById(reminderId);
    if (!reminder || reminder.completed) {
      await agenda.cancel({ 'data.reminderId': reminderId, name: 'inertiaReminder', 'data.instance': instance });
      logger.info(`inertiaReminder: Напоминание ${reminderId} не найдено или выполнено. Job отменён.`);
      return done();
    }
    // Редактируем исходное сообщение: заменяем текст на "Отложено: <текст напоминания>" и удаляем кнопки
    if (reminder.messageId) {
      try {
        await bot.editMessageText(`Отложено: ${reminder.description}`, { 
          chat_id: reminder.userId, 
          message_id: reminder.messageId, 
          reply_markup: { inline_keyboard: [] },
          parse_mode: "HTML" 
        });
        logger.info(`inertiaReminder: Основное сообщение reminder ${reminderId} отредактировано (кнопки удалены, текст изменён).`);
      } catch (editErr) {
        logger.error(`inertiaReminder: Ошибка редактирования основного сообщения для reminder ${reminderId}: ${editErr.message}`);
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
    logger.info(`inertiaReminder: Отправляем инерционное уведомление для reminder ${reminderId}. Текст: "${messageText}" с клавиатурой: ${JSON.stringify(inlineKeyboard)}`);
    await bot.sendMessage(reminder.userId, messageText, inlineKeyboard);
    done();
  } catch (error) {
    logger.error(`inertiaReminder: Ошибка для reminder ${reminderId}: ${error.message}`);
    done(error);
  }
});

async function scheduleReminder(reminder) {
  try {
    if (reminder.repeat) {
      await agenda.every(reminder.repeat, 'sendReminder', { reminderId: reminder._id.toString() }, { timezone: 'Europe/Moscow', unique: { 'data.reminderId': reminder._id.toString() } });
      logger.info(`scheduleReminder: Запланировано повторяющееся напоминание для reminder ${reminder._id} с интервалом "${reminder.repeat}"`);
    } else {
      await agenda.schedule(reminder.datetime, 'sendReminder', { reminderId: reminder._id.toString() });
      logger.info(`scheduleReminder: Запланировано одноразовое напоминание для reminder ${reminder._id} на ${reminder.datetime}`);
    }
  } catch (error) {
    logger.error(`scheduleReminder: Ошибка планирования для reminder ${reminder._id}: ${error.message}`);
  }
}

async function cancelReminderJobs(reminderId) {
  try {
    await agenda.cancel({ 'data.reminderId': reminderId });
    logger.info(`cancelReminderJobs: Отменены все Agenda задачи для reminder ${reminderId}`);
  } catch (error) {
    logger.error(`cancelReminderJobs: Ошибка отмены задач для reminder ${reminderId}: ${error.message}`);
  }
}

module.exports = {
  agenda,
  scheduleReminder,
  cancelReminderJobs,
};