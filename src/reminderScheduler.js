const schedule = require('node-schedule');
const mongoose = require('mongoose');
const bot = require('./botInstance');
const { extractDate } = require('./dateParser');

const reminderSchema = new mongoose.Schema({
  userId: String,
  description: String,
  datetime: Date,
  repeat: String,
  lastNotified: Date, // Время последнего уведомления
});

const Reminder = mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema);

// Функция для отправки уведомления с кнопками
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

  // Обновляем время последнего уведомления
  await Reminder.updateOne(
    { _id: reminder._id },
    { lastNotified: new Date() }
  );
}

// Проверка и отправка напоминаний
async function checkReminders() {
  const now = new Date();
  console.log(`⏳ Запуск проверки напоминаний (${now.toISOString()})`);

  // Ищем напоминания, время которых наступило
  const reminders = await Reminder.find({
    datetime: { $lte: now },
  });

  console.log(`📋 Найдено ${reminders.length} напоминаний для отправки.`);

  for (const reminder of reminders) {
    console.log(`🔹 Обработка напоминания: ID ${reminder._id}, время: ${reminder.datetime}`);

    // Если уведомление не отправлялось или прошло больше 9 минут
    if (!reminder.lastNotified || (now - reminder.lastNotified) > 540000) {
      await sendReminderNotification(reminder);

      // Обновляем время напоминания на +9 минут
      const newTime = new Date(Date.now() + 9 * 60000);
      console.log(`🔄 Обновляем время напоминания ID: ${reminder._id} -> ${newTime}`);
      await Reminder.updateOne(
        { _id: reminder._id },
        { datetime: newTime }
      );
    }
  }
}

// Запускаем проверку каждую минуту
schedule.scheduleJob('* * * * *', checkReminders);

// Обработка кнопок
bot.on('callback_query', async (callbackQuery) => {
  console.log(`🔘 Получен callback: ${callbackQuery.data}`);
  const parts = callbackQuery.data.split('_');
  const action = parts[0];
  const reminderId = parts.slice(-1)[0];

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
    case 'snooze':
      const hours = parseInt(parts[1].replace('h', ''), 10);
      const newDate = new Date(Date.now() + hours * 3600000);
      console.log(`⏳ Перенос напоминания ID: ${reminderId} на ${newDate}`);
      await Reminder.updateOne(
        { _id: reminderId },
        { datetime: newDate }
      );
      bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: callbackQuery.message.chat.id, message_id: callbackQuery.message.message_id }
      ).catch(() => {});
      bot.sendMessage(callbackQuery.message.chat.id, `✅ Напоминание сохранено:\n\n📌 ${reminder.description}\n🔁 Повтор: ${reminder.repeat ? reminder.repeat : 'нет'}\n🕒 ${newDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })} (${newDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })})`);
      break;

    case 'custom':
      console.log(`📝 Запрос на ввод времени для ID: ${reminderId}`);
      bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: callbackQuery.message.chat.id, message_id: callbackQuery.message.message_id }
      );
      await bot.sendMessage(callbackQuery.message.chat.id, 'Введите время для повтора (например, "через 2 часа" или "завтра в 10:00"):');
      break;

    case 'done':
      console.log(`✅ Напоминание ID: ${reminderId} отмечено как выполненное и удалено.`);
      await Reminder.deleteOne({ _id: reminderId });
      bot.deleteMessage(callbackQuery.message.chat.id, callbackQuery.message.message_id).catch(() => {});
      bot.sendMessage(callbackQuery.message.chat.id, '✅ Напоминание выполнено и удалено.');
      break;
  }

  bot.answerCallbackQuery(callbackQuery.id);
});