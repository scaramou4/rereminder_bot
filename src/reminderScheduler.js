const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const bot = require('./botInstance');
const logger = require('./logger');
const pendingRequests = require('./pendingRequests');

// Подключение к MongoDB (без deprecated‑опций)
mongoose
  .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/reminders')
  .then(() => logger.info('Подключение к MongoDB установлено'))
  .catch((error) => logger.error('Ошибка подключения к MongoDB: ' + error.message));

// Определение схемы напоминания
const reminderSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  description: { type: String, required: true },
  datetime: { type: Date, required: true },
  repeat: { type: String, default: null },
  lastNotified: { type: Date, default: null },
  messageIds: { type: [Number], default: [] },
  completed: { type: Boolean, default: false }
});

const Reminder = mongoose.model('Reminder', reminderSchema);

/**
 * Создание нового напоминания и сохранение в базе.
 */
async function createReminder(userId, description, datetime, repeat) {
  try {
    const reminder = new Reminder({
      userId,
      description,
      datetime,
      repeat: repeat || null,
      lastNotified: null,
      messageIds: []
    });
    await reminder.save();
    logger.info(`Создано напоминание для user ${userId} на ${datetime}`);
    return reminder;
  } catch (error) {
    logger.error(`Ошибка при создании напоминания: ${error.message}`);
  }
}

/**
 * Функция возвращает список предстоящих уведомлений (datetime >= текущей даты) для указанного userId,
 * отсортированных по возрастанию времени.
 */
async function listReminders(userId) {
  try {
    return await Reminder.find({
      userId: userId.toString(),
      completed: false,
      datetime: { $gte: new Date() }
    }).sort({ datetime: 1 });
  } catch (error) {
    logger.error(`Ошибка получения списка напоминаний для ${userId}: ${error.message}`);
    return [];
  }
}

/**
 * Удаляет все уведомления для указанного userId.
 */
async function deleteAllReminders(userId) {
  try {
    await Reminder.deleteMany({ userId: userId.toString() });
    logger.info(`Удалены все напоминания для пользователя ${userId}`);
  } catch (error) {
    logger.error(`Ошибка удаления напоминаний для ${userId}: ${error.message}`);
  }
}

/**
 * Удаляет конкретное уведомление по его ID.
 */
async function deleteReminder(reminderId) {
  try {
    const deleted = await Reminder.findByIdAndDelete(reminderId);
    if (deleted) {
      logger.info(`Удалено напоминание ${reminderId}`);
      return deleted;
    } else {
      logger.error(`Напоминание ${reminderId} не найдено для удаления`);
      return null;
    }
  } catch (error) {
    logger.error(`Ошибка удаления напоминания ${reminderId}: ${error.message}`);
    return null;
  }
}

/**
 * Отправка уведомления с inline‑клавиатурой.
 */
async function sendReminder(reminder) {
  try {
    const formattedTime = DateTime.fromJSDate(reminder.datetime).toFormat('HH:mm');
    let messageText = `🔔 Напоминание: ${reminder.description}\n🕒 ${formattedTime}`;
    if (reminder.repeat) {
      messageText += `\n🔁 Повтор: ${reminder.repeat}`;
    }
    const inlineKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '1 час', callback_data: `postpone|1|${reminder._id}` },
            { text: '3 часа', callback_data: `postpone|3|${reminder._id}` }
          ],
          [
            { text: '…', callback_data: `postpone|custom|${reminder._id}` },
            { text: 'Готово', callback_data: `done|${reminder._id}` }
          ]
        ]
      }
    };
    const sentMessage = await bot.sendMessage(reminder.userId, messageText, inlineKeyboard);
    reminder.messageIds.push(sentMessage.message_id);
    reminder.lastNotified = new Date();
    await reminder.save();
    logger.info(`Отправлено напоминание пользователю ${reminder.userId}, message_id: ${sentMessage.message_id}`);
  } catch (error) {
    logger.error(`Ошибка при отправке напоминания: ${error.message}`);
  }
}

/**
 * Обновление уведомлений для данного напоминания.
 * Редактирует предыдущие сообщения (удаляя inline‑клавиатуру) и отправляет новое уведомление.
 */
async function updateReminderNotifications(reminder) {
  try {
    for (let messageId of reminder.messageIds) {
      try {
        const newText = `🔔 Напоминание: ${reminder.description}`;
        await bot.editMessageText(newText, { 
          chat_id: reminder.userId, 
          message_id: messageId,
          reply_markup: { inline_keyboard: [] }
        });
        logger.info(`Обновлено сообщение ${messageId} для напоминания ${reminder._id}`);
      } catch (err) {
        logger.error(`Ошибка обновления сообщения ${messageId}: ${err.message}`);
      }
    }
    reminder.messageIds = [];
    await reminder.save();
    await sendReminder(reminder);
  } catch (error) {
    logger.error(`Ошибка обновления уведомлений: ${error.message}`);
  }
}

/**
 * Планировщик, который каждую минуту проверяет напоминания,
 * время которых наступило, и, если пользователь не реагирует,
 * обновляет ранее отправленные уведомления и отправляет новое.
 */
function startScheduler() {
  setInterval(async () => {
    try {
      const now = new Date();
      const reminders = await Reminder.find({ datetime: { $lte: now }, completed: false });
      for (let reminder of reminders) {
        const lastNotified = reminder.lastNotified ? new Date(reminder.lastNotified) : null;
        const threshold = 2 * 60 * 1000;
        if (!lastNotified || (now - lastNotified >= threshold)) {
          if (reminder.messageIds.length > 0) {
            await updateReminderNotifications(reminder);
          } else {
            await sendReminder(reminder);
          }
          if (reminder.repeat) {
            if (reminder.repeat.toLowerCase().includes('день')) {
              reminder.datetime = DateTime.fromJSDate(reminder.datetime).plus({ days: 1 }).toJSDate();
            } else if (reminder.repeat.toLowerCase().includes('вторник')) {
              reminder.datetime = DateTime.fromJSDate(reminder.datetime).plus({ days: 7 }).toJSDate();
            }
            reminder.messageIds = [];
            await reminder.save();
          }
        }
      }
    } catch (error) {
      logger.error(`Ошибка планировщика: ${error.message}`);
    }
  }, 60 * 1000);
}

/**
 * Обработка callback‑запросов для postpone и done.
 * При postpone:
 *  - Если выбрано "1" или "3", новое время рассчитывается от текущего времени.
 *    Исходное сообщение редактируется: текст меняется на "Отложено: <текст уведомления без времени>",
 *    удаляются кнопки, и выводится отдельное сообщение с подтверждением:
 *      "🔔 Повтор: <текст уведомления>"
 *      "🕒 Новое время: <новое время>"
 *  - Если выбрано "custom", устанавливается pendingPostpone с передачей reminderId и messageId,
 *    и отправляется запрос на ввод времени.
 * При done:
 *  - Сообщение редактируется на "✅ <текст уведомления>", кнопки удаляются, и напоминание удаляется из базы.
 */
async function handleCallback(query) {
  try {
    const data = query.data;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const parts = data.split('|');
    if (parts[0] === 'postpone') {
      const postponeValue = parts[1]; // '1', '3' или 'custom'
      const reminderId = parts[2];
      const reminder = await Reminder.findById(reminderId);
      if (!reminder) {
        await bot.answerCallbackQuery(query.id, { text: 'Напоминание не найдено' });
        return;
      }
      if (postponeValue === 'custom') {
        // Сохраняем pending запрос с reminderId и messageId
        pendingRequests.pendingPostpone[chatId] = { reminderId, messageId };
        await bot.sendMessage(chatId, 'Введите время отсрочки (например, "30 минут"):');
        await bot.answerCallbackQuery(query.id, { text: 'Введите время отсрочки' });
        return;
      } else {
        const hours = parseInt(postponeValue, 10);
        const newDateTime = DateTime.local().plus({ hours }).toJSDate();
        reminder.datetime = newDateTime;
        reminder.messageIds = [];
        await reminder.save();
        const formattedNewTime = DateTime.fromJSDate(newDateTime).toFormat('HH:mm');
        const editedText = `Отложено: ${reminder.description}`;
        await bot.editMessageText(editedText, { 
          chat_id: chatId, 
          message_id: messageId, 
          reply_markup: { inline_keyboard: [] } 
        });
        await bot.sendMessage(chatId, `🔔 Повтор: ${reminder.description}\n🕒 Новое время: ${formattedNewTime}`);
        await bot.answerCallbackQuery(query.id, { text: 'Напоминание отсрочено' });
      }
    } else if (parts[0] === 'done') {
      const reminderId = parts[1];
      const reminder = await Reminder.findById(reminderId);
      if (!reminder) {
        await bot.answerCallbackQuery(query.id, { text: 'Напоминание не найдено' });
        return;
      }
      const newText = `✅ ${reminder.description}`;
      await bot.editMessageText(newText, { 
        chat_id: chatId, 
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      });
      await Reminder.findByIdAndDelete(reminderId);
      await bot.answerCallbackQuery(query.id, { text: 'Напоминание выполнено' });
    }
  } catch (error) {
    logger.error(`Ошибка обработки callback: ${error.message}`);
  }
}

module.exports = {
  createReminder,
  listReminders,
  deleteAllReminders,
  deleteReminder,
  sendReminder,
  updateReminderNotifications,
  startScheduler,
  handleCallback,
  Reminder // Экспорт модели для дальнейшего использования
};