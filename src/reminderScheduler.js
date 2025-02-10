const schedule = require('node-schedule');
const mongoose = require('mongoose');
const bot = require('./botInstance');
const logger = require('./logger');

// Изменённая схема: теперь для хранения идентификаторов сообщений используется массив messageIds.
const reminderSchema = new mongoose.Schema({
  userId: String,
  description: String,
  datetime: Date,
  repeat: String,
  lastNotified: Date, // время последнего уведомления
  messageIds: [Number]  // массив идентификаторов сообщений для этого напоминания
});
const Reminder = mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema);

// Функция форматирования времени в виде "HH:MM"
function formatTime(date) {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Отправляет исходное уведомление с текстом и клавиатурой.
 * При повторном срабатывании (через 2 минуты) обновляет все предыдущие уведомления,
 * редактируя их (удаляя строку со временем и клавиатуру) и отправляет новое уведомление,
 * используя обновлённый текст (без времени).
 */
async function sendReminder(reminder) {
  const chatId = reminder.userId;
  // Исходный текст уведомления с временем
  const originalText = `🔔 Напоминание: ${reminder.description}\n🕒 ${formatTime(reminder.datetime)}`;
  // Текст, который мы хотим видеть в обновлённых уведомлениях (без времени)
  const updatedText = `🔔 Напоминание: ${reminder.description}`;
  
  // Пример inline‑клавиатуры (настройте по необходимости)
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

  try {
    // Отправляем исходное уведомление (первый раз – с оригинальным текстом)
    const sentMsg = await bot.sendMessage(chatId, originalText, { reply_markup: inlineKeyboard });
    // Если messageIds ещё нет, инициализируем
    if (!reminder.messageIds) {
      reminder.messageIds = [];
    }
    reminder.messageIds.push(sentMsg.message_id);
    reminder.lastNotified = new Date();
    await reminder.save();
    logger.info(`Scheduler: Sent reminder ${reminder._id} to user ${chatId} with message ID ${sentMsg.message_id}.`);

    // Через 2 минуты (для тестирования) проверяем, если пользователь не отреагировал
    setTimeout(async () => {
      const currentReminder = await Reminder.findById(reminder._id);
      if (!currentReminder) return;
      
      // Копируем текущий массив messageIds
      const messagesToUpdate = currentReminder.messageIds ? [...currentReminder.messageIds] : [];
      
      // Проходим по каждому старому сообщению и пытаемся его обновить
      for (const msgId of messagesToUpdate) {
        try {
          await bot.editMessageText(updatedText, {
            chat_id: chatId,
            message_id: msgId,
            reply_markup: { inline_keyboard: [] }
          });
          logger.info(`Scheduler: Updated message ${msgId} for reminder ${reminder._id} (removed time and buttons).`);
          // Если обновление прошло, удаляем этот id из массива
          const index = currentReminder.messageIds.indexOf(msgId);
          if (index > -1) {
            currentReminder.messageIds.splice(index, 1);
          }
        } catch (editErr) {
          if (editErr.message && editErr.message.includes("message is not modified")) {
            logger.info(`Scheduler: Message ${msgId} already updated.`);
            const index = currentReminder.messageIds.indexOf(msgId);
            if (index > -1) {
              currentReminder.messageIds.splice(index, 1);
            }
          } else {
            logger.warn(`Scheduler: Failed to update message ${msgId} for reminder ${reminder._id}: ${editErr.message}`);
          }
        }
      }
      await currentReminder.save();

      // Отправляем новое уведомление – теперь с обновлённым текстом (без времени) и рабочей клавиатурой
      try {
        const newMsg = await bot.sendMessage(chatId, updatedText, { reply_markup: inlineKeyboard });
        currentReminder.lastNotified = new Date();
        currentReminder.messageIds.push(newMsg.message_id);
        await currentReminder.save();
        logger.info(`Scheduler: Resent reminder ${reminder._id} to user ${chatId} with new message ID ${newMsg.message_id}.`);
      } catch (sendErr) {
        logger.error(`Scheduler: Error resending reminder ${reminder._id}: ${sendErr.message}`);
      }
      
    }, 2 * 60 * 1000); // 2 минуты для тестирования

  } catch (err) {
    logger.error(`Scheduler: Error sending reminder ${reminder._id}: ${err.message}`);
  }
}

/**
 * Функция проверки напоминаний.
 * Каждую минуту ищутся напоминания, время которых наступило и либо не было уведомлено,
 * либо прошло не менее 2 минут с последнего уведомления.
 */
async function checkReminders() {
  const now = new Date();
  const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
  const reminders = await Reminder.find({
    datetime: { $lte: now },
    $or: [
      { lastNotified: null },
      { lastNotified: { $lte: twoMinutesAgo } }
    ]
  });
  logger.info(`Scheduler: Found ${reminders.length} reminders to send.`);
  for (const reminder of reminders) {
    await sendReminder(reminder);
  }
}

// Планируем проверку каждую минуту
schedule.scheduleJob('* * * * *', checkReminders);

module.exports = { checkReminders };