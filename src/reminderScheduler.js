const schedule = require('node-schedule');
const mongoose = require('mongoose');
const bot = require('./botInstance');
const { extractDate } = require('./dateParser');

const reminderSchema = new mongoose.Schema({
  userId: String,
  description: String,
  datetime: Date,
  repeat: String,
  lastNotified: Date,
  lastMessageId: Number,
});

const Reminder = mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema);
const userState = {};

function showDeleteButtons(chatId, userId) {
  const state = userState[userId];
  if (!state) return;

  const start = state.page * 10;
  const end = start + 10;
  const pageReminders = state.reminders.slice(start, end);

  if (pageReminders.length === 0) {
    return bot.sendMessage(chatId, '❌ На этой странице нет напоминаний.');
  }

  const buttons = [];
  for (let i = 0; i < pageReminders.length; i += 5) {
    buttons.push(
      pageReminders.slice(i, i + 5).map((_, idx) => ({
        text: `${start + i + idx + 1}`,
        callback_data: `del_${start + i + idx}`,
      }))
    );
  }

  buttons.push([{ text: '❌ Отмена', callback_data: 'cancel_delete' }]);

  bot.sendMessage(chatId, 'Выберите номер напоминания для удаления:', {
    reply_markup: { inline_keyboard: buttons },
  });
}

async function checkReminders() {
  const now = new Date();
  console.log(`⏳ Запуск проверки напоминаний (${now.toISOString()})`);

  const reminders = await Reminder.find({ datetime: { $lte: now } });
  console.log(`📋 Найдено ${reminders.length} напоминаний для отправки.`);
}

bot.on('callback_query', async (callbackQuery) => {
  console.log(`🔘 Получен callback: ${callbackQuery.data}`);

  if (callbackQuery.data === 'delete_reminder') {
    showDeleteButtons(callbackQuery.message.chat.id, callbackQuery.from.id);
    return bot.answerCallbackQuery(callbackQuery.id).catch(err => {
      console.error("❌ Ошибка при ответе на callbackQuery:", err.message);
    });
  }
});

module.exports = {
  checkReminders,
  showDeleteButtons,
};
