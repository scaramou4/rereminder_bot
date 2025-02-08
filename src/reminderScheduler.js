const schedule = require('node-schedule');
const mongoose = require('mongoose');
const bot = require('./botInstance');

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
    setTimeout(async () => {
      const existingReminder = await Reminder.findById(reminder._id);
      if (existingReminder) {
        try {
          await bot.editMessageReplyMarkup(null, { chat_id: chatId, message_id: sentMessage.message_id });
        } catch (err) {
          console.error('Ошибка при удалении клавиатуры:', err);
        }
        const newMessage = await bot.sendMessage(chatId, messageText, { reply_markup: inlineKeyboard });
        existingReminder.lastNotified = new Date();
        existingReminder.lastMessageId = newMessage.message_id;
        await existingReminder.save();
      }
    }, 9 * 60 * 1000);
  } catch (err) {
    console.error(`Ошибка при отправке напоминания ${reminder._id}:`, err);
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
  console.log(`📋 Найдено ${reminders.length} напоминаний для отправки.`);
  for (const reminder of reminders) {
    await sendReminder(reminder);
  }
}

schedule.scheduleJob('* * * * *', checkReminders);

module.exports = {
  checkReminders,
};