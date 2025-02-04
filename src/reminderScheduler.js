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

/**
 * Форматирует дату в виде "HH:mm, D MMMM YYYY" (например, "13:20, 4 февраля 2025")
 */
function formatPostponedDate(date) {
  const d = new Date(date);
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const day = d.getDate();
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${hours}:${minutes}, ${day} ${month} ${year}`;
}

/**
 * Отправляет напоминание с inline-клавиатурой для управления.
 * Клавиатура содержит кнопки для отложения напоминания и для отметки выполнения.
 */
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

  const messageText = `🔔 Напоминание: ${reminder.description}`;

  try {
    const sentMessage = await bot.sendMessage(chatId, messageText, { reply_markup: inlineKeyboard });
    // Сохраняем ID сообщения и время уведомления для возможного редактирования
    reminder.lastMessageId = sentMessage.message_id;
    reminder.lastNotified = new Date();
    await reminder.save();
  } catch (err) {
    console.error(`Ошибка при отправке напоминания ${reminder._id}:`, err);
  }
}

/**
 * Функция поиска напоминаний, время которых наступило, и отправка уведомлений.
 */
async function checkReminders() {
  const now = new Date();
  console.log(`⏳ Запуск проверки напоминаний (${now.toISOString()})`);

  // Находим все напоминания, время которых наступило или прошло
  const reminders = await Reminder.find({ datetime: { $lte: now } });
  console.log(`📋 Найдено ${reminders.length} напоминаний для отправки.`);

  for (const reminder of reminders) {
    await sendReminder(reminder);
  }
}

// Планируем проверку напоминаний каждую минуту
schedule.scheduleJob('* * * * *', checkReminders);

// Обработка нажатий inline-кнопок
bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;

  if (data.startsWith('postpone_')) {
    const parts = data.split('_'); // Пример: ["postpone", "1", reminderId]
    const action = parts[1]; // "1", "3" или "custom"
    const reminderId = parts.slice(2).join('_');

    try {
      const reminder = await Reminder.findById(reminderId);
      if (!reminder) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Напоминание не найдено.' });
        return;
      }

      if (action === '1') {
        // Отложить на 1 час
        reminder.datetime = new Date(reminder.datetime.getTime() + 60 * 60 * 1000);
      } else if (action === '3') {
        // Отложить на 3 часа
        reminder.datetime = new Date(reminder.datetime.getTime() + 3 * 60 * 60 * 1000);
      } else if (action === 'custom') {
        // Обработка отложения на произвольное время (пока не реализовано)
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Функция "Отложить на другое время" в разработке.' });
        return;
      }
      await reminder.save();

      // Обновляем сообщение с новым временем напоминания в требуемом формате
      const updatedText = `🔔 Отложено: ${reminder.description}\n🕒 ${formatPostponedDate(reminder.datetime)}`;
      await bot.editMessageText(updatedText, { chat_id: chatId, message_id: messageId });
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Напоминание отложено.' });
    } catch (err) {
      console.error('Ошибка при обработке postpone:', err);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Ошибка при обработке.' });
    }
  } else if (data.startsWith('done_')) {
    const reminderId = data.split('_')[1];
    try {
      const reminder = await Reminder.findById(reminderId);
      if (!reminder) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Напоминание не найдено.' });
        return;
      }
      // Обновляем текст сообщения, добавляя галочку и текст напоминания
      const updatedText = `✔️ ${reminder.description}`;
      await bot.editMessageText(updatedText, { chat_id: chatId, message_id: messageId });
      // Удаляем напоминание из базы, чтобы оно не срабатывало повторно
      await Reminder.deleteOne({ _id: reminderId });
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Напоминание отмечено как выполненное.' });
    } catch (err) {
      console.error('Ошибка при обработке "Готово":', err);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Ошибка при обработке.' });
    }
  }
});

module.exports = {
  checkReminders,
};