const schedule = require('node-schedule');
const mongoose = require('mongoose');
const bot = require('./botInstance');
const logger = require('./logger');

const reminderSchema = new mongoose.Schema({
  userId: String,
  description: String,
  datetime: Date,
  repeat: String,
  lastNotified: Date,
  lastMessageId: Number,
});
const Reminder = mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema);

function formatTime(date) {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function sendReminder(reminder) {
  const chatId = reminder.userId;
  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '1 час', callback_data: `postpone_1_${reminder._id}` },
        { text: '3 часа', callback_data: `postpone_3_${reminder._id}` }
      ],
      [
        { text: '...', callback_data: `postpone_custom_${reminder._id}` },
        { text: 'Готово', callback_data: `done_${reminder._id}` }
      ]
    ]
  };

  const messageText = `🔔 Напоминание: ${reminder.description}\n🕒 ${formatTime(reminder.datetime)}`;
  try {
    const sentMessage = await bot.sendMessage(chatId, messageText, { reply_markup: inlineKeyboard });
    reminder.lastNotified = new Date();
    reminder.lastMessageId = sentMessage.message_id;
    await reminder.save();
    logger.info(`Scheduler: Sent reminder ${reminder._id} to user ${chatId} with message ID ${sentMessage.message_id}.`);

    setTimeout(async () => {
      const existingReminder = await Reminder.findById(reminder._id);
      if (existingReminder) {
        try {
          // Проверяем, существует ли сообщение перед удалением клавиатуры
          await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: sentMessage.message_id });
          logger.info(`Scheduler: Removed inline keyboard for reminder ${reminder._id} from message ID ${sentMessage.message_id}.`);
        } catch (err) {
          if (err.response?.body?.description?.toLowerCase().includes('message to edit not found')) {
            logger.info(`Scheduler: Message ID ${sentMessage.message_id} for reminder ${reminder._id} was already deleted or modified.`);
          } else {
            logger.error(`Scheduler: Error removing inline keyboard for reminder ${reminder._id}: ${err.message}`);
          }
        }

        const newMessage = await bot.sendMessage(chatId, messageText, { reply_markup: inlineKeyboard });
        existingReminder.lastNotified = new Date();
        existingReminder.lastMessageId = newMessage.message_id;
        await existingReminder.save();
        logger.info(`Scheduler: Resent reminder ${reminder._id} to user ${chatId} with new message ID ${newMessage.message_id}.`);
      }
    }, 9 * 60 * 1000);
  } catch (err) {
    logger.error(`Scheduler: Error sending reminder ${reminder._id}: ${err.message}`);
  }
}

async function checkReminders() {
  const now = new Date();
  const nineMinutesAgo = new Date(now.getTime() - 9 * 60 * 1000);
  const reminders = await Reminder.find({
    datetime: { $lte: now },
    $or: [
      { lastNotified: null },
      { lastNotified: { $lte: nineMinutesAgo } }
    ]
  });
  logger.info(`Scheduler: Found ${reminders.length} reminders to send.`);
  for (const reminder of reminders) {
    await sendReminder(reminder);
  }
}

schedule.scheduleJob('* * * * *', checkReminders);

module.exports = {
  checkReminders,
};