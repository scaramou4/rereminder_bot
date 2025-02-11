const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const bot = require('./botInstance');
const logger = require('./logger');

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
 * Создание нового напоминания и сохранение в базе
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
 * Отправка уведомления с inline‑клавиатурой
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
 * Если пользователь не реагирует в течение 2 минут, для всех ранее отправленных сообщений:
 * - редактируется текст, удаляя строку со временем (останется только "🔔 Напоминание: описание")
 * - удаляются кнопки (inline‑клавиатура заменяется пустой)
 * После этого бот отправляет новое уведомление с исходным текстом, временем и рабочей клавиатурой.
 */
async function updateReminderNotifications(reminder) {
  try {
    // Редактируем все предыдущие сообщения одновременно, передавая новый текст и пустую клавиатуру.
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
    // Очистить список старых уведомлений
    reminder.messageIds = [];
    await reminder.save();
    // Отправить новое уведомление с исходным текстом, временем и рабочей клавиатурой
    await sendReminder(reminder);
  } catch (error) {
    logger.error(`Ошибка обновления уведомлений: ${error.message}`);
  }
}

/**
 * Планировщик, который каждую минуту проверяет напоминания,
 * время которых наступило, и если пользователь не реагирует,
 * обновляет ранее отправленные уведомления (редактирует их текст и удаляет кнопки)
 * и отправляет новое уведомление.
 * Логика повторного уведомления остаётся неизменной для повторяющихся напоминаний.
 */
function startScheduler() {
  setInterval(async () => {
    try {
      const now = new Date();
      const reminders = await Reminder.find({ datetime: { $lte: now }, completed: false });
      for (let reminder of reminders) {
        const lastNotified = reminder.lastNotified ? new Date(reminder.lastNotified) : null;
        // Порог повторного уведомления: 2 минуты (для тестирования; для продакшена можно увеличить)
        const threshold = 2 * 60 * 1000;
        if (!lastNotified || (now - lastNotified >= threshold)) {
          if (reminder.messageIds.length > 0) {
            await updateReminderNotifications(reminder);
          } else {
            await sendReminder(reminder);
          }
          // Если напоминание повторяется, вычисляем следующую дату
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
 * Обработка callback‑запросов:
 *  - postpone: отсрочка напоминания (1 час, 3 часа или пользовательский ввод)
 *  - done: отметка напоминания как выполненного и удаление уведомления
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
        await bot.sendMessage(chatId, 'Введите время отсрочки (например, "30 минут"):');
        await bot.answerCallbackQuery(query.id, { text: 'Введите время отсрочки' });
      } else {
        let hours = parseInt(postponeValue);
        reminder.datetime = DateTime.fromJSDate(reminder.datetime).plus({ hours }).toJSDate();
        reminder.messageIds = [];
        await reminder.save();
        await bot.sendMessage(
          chatId,
          `Напоминание отсрочено на ${hours} час(а/ов). Новое время: ${DateTime.fromJSDate(reminder.datetime).toFormat('HH:mm')}`
        );
        await bot.answerCallbackQuery(query.id, { text: 'Напоминание отсрочено' });
      }
    } else if (parts[0] === 'done') {
      const reminderId = parts[1];
      const reminder = await Reminder.findById(reminderId);
      if (!reminder) {
        await bot.answerCallbackQuery(query.id, { text: 'Напоминание не найдено' });
        return;
      }
      reminder.completed = true;
      reminder.messageIds = [];
      await reminder.save();
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
      await bot.sendMessage(chatId, 'Напоминание выполнено и удалено.');
      await bot.answerCallbackQuery(query.id, { text: 'Напоминание выполнено' });
    }
  } catch (error) {
    logger.error(`Ошибка обработки callback: ${error.message}`);
  }
}

/**
 * Возвращает список активных напоминаний для указанного userId
 */
async function listReminders(userId) {
  try {
    return await Reminder.find({ userId: userId.toString(), completed: false });
  } catch (error) {
    logger.error(`Ошибка получения списка напоминаний для ${userId}: ${error.message}`);
    return [];
  }
}

/**
 * Удаляет все напоминания для указанного userId
 */
async function deleteAllReminders(userId) {
  try {
    await Reminder.deleteMany({ userId: userId.toString() });
    logger.info(`Удалены все напоминания для пользователя ${userId}`);
  } catch (error) {
    logger.error(`Ошибка удаления напоминаний для ${userId}: ${error.message}`);
  }
}

module.exports = {
  createReminder,
  startScheduler,
  handleCallback,
  listReminders,
  deleteAllReminders,
  Reminder // Экспорт модели для дальнейшего использования
};