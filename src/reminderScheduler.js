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

async function removeButtonsFromMessage(chatId, messageId) {
  try {
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      { chat_id: chatId, message_id: messageId }
    );
    console.log(`✅ Кнопки удалены из сообщения ${messageId} в чате ${chatId}`);
  } catch (err) {
    console.error(`❌ Ошибка при удалении кнопок из сообщения ${messageId}:`, err);
  }
}

async function sendReminderNotification(reminder) {
  console.log(`🔔 Отправка напоминания: ${reminder.description} для пользователя ${reminder.userId} (ID: ${reminder._id})`);
  const keyboard = {
    inline_keyboard: [
      [
        { text: '1 час', callback_data: `snooze_1h_${reminder._id}` },
        { text: '3 часа', callback_data: `snooze_3h_${reminder._id}` },
        { text: '...', callback_data: `custom_snooze_${reminder._id}` },
      ],
      [
        { text: 'Готово', callback_data: `done_${reminder._id}` },
      ]
    ]
  };

  const message = await bot.sendMessage(reminder.userId, `🔔 ${reminder.description}`, { 
    reply_markup: keyboard 
  });

  await Reminder.updateOne(
    { _id: reminder._id },
    { lastNotified: new Date() }
  );

  return message.message_id;
}

async function checkReminders() {
  const now = new Date();
  console.log(`⏳ Запуск проверки напоминаний (${now.toISOString()})`);

  const reminders = await Reminder.find({
    datetime: { $lte: now },
  });

  console.log(`📋 Найдено ${reminders.length} напоминаний для отправки.`);

  for (const reminder of reminders) {
    console.log(`🔹 Обработка напоминания: ID ${reminder._id}, время: ${reminder.datetime}`);

    if (!reminder.lastNotified || (now - reminder.lastNotified) > 540000) {
      if (reminder.lastMessageId) {
        await removeButtonsFromMessage(reminder.userId, reminder.lastMessageId);
      }

      const messageId = await sendReminderNotification(reminder);

      const newTime = new Date(Date.now() + 9 * 60000);
      console.log(`🔄 Обновляем время напоминания ID: ${reminder._id} -> ${newTime}`);
      await Reminder.updateOne(
        { _id: reminder._id },
        { datetime: newTime, lastMessageId: messageId }
      );
    }
  }
}

schedule.scheduleJob('* * * * *', checkReminders);

bot.on('callback_query', async (callbackQuery) => {
  console.log(`🔘 Получен callback: ${callbackQuery.data}`);
  const navigationActions = ['first_page', 'prev_page', 'next_page', 'last_page'];

  if (navigationActions.includes(callbackQuery.data)) {
    return bot.answerCallbackQuery(callbackQuery.id);
  }

  const parts = callbackQuery.data.split('_');
  const reminderId = parts.pop();
  const action = parts.join('_');

  console.log(`🔍 Разобранный callback -> Действие: ${action}, ID напоминания: ${reminderId}`);

  if (!mongoose.Types.ObjectId.isValid(reminderId)) {
    console.log(`❌ Некорректный ID напоминания: ${reminderId}`);
    return bot.answerCallbackQuery(callbackQuery.id, { text: "Ошибка обработки ID напоминания." });
  }

  const reminder = await Reminder.findById(reminderId);
  if (!reminder) {
    console.log(`❌ Напоминание ID: ${reminderId} не найдено.`);
    return bot.answerCallbackQuery(callbackQuery.id, { text: "Напоминание не найдено." });
  }

  switch (action) {
    case 'snooze_1h':
    case 'snooze_3h':
      const hours = parseInt(action.replace('snooze_', '').replace('h', ''), 10);
      const newDate = new Date(Date.now() + hours * 3600000);
      await Reminder.updateOne(
        { _id: reminderId },
        { datetime: newDate }
      );
      bot.sendMessage(callbackQuery.message.chat.id, `✅ Напоминание перенесено на ${newDate.toLocaleString()}`);
      break;

    case 'custom_snooze':
      bot.sendMessage(callbackQuery.message.chat.id, 'Введите время для переноса (например, "через 2 часа")');
      break;

    case 'done':
      await Reminder.deleteOne({ _id: reminderId });
      bot.deleteMessage(callbackQuery.message.chat.id, callbackQuery.message.message_id).catch(() => {});
      bot.sendMessage(callbackQuery.message.chat.id, '✅ Напоминание выполнено и удалено.');
      break;
  }

  bot.answerCallbackQuery(callbackQuery.id);
});

module.exports = {
  checkReminders,
  removeButtonsFromMessage,
};