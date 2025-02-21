const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const bot = require('./botInstance');
const logger = require('./logger');
const pendingRequests = require('./pendingRequests');
const { computeNextTimeFromScheduled } = require('./dateParser');
const { scheduleReminder, cancelReminderJobs } = require('./agendaScheduler');
const Reminder = require('./models/reminder');

mongoose
  .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/reminders')
  .then(() => logger.info('Подключение к MongoDB установлено'))
  .catch((error) => logger.error('Ошибка подключения к MongoDB: ' + error.message));

async function createReminder(userId, description, datetime, repeat) {
  try {
    let nextReminder = null;
    const now = DateTime.now().setZone('Europe/Moscow', { keepLocalTime: true });
    const dt = DateTime.fromJSDate(datetime, { zone: 'Europe/Moscow' });
    if (repeat) {
      if (dt > now) {
        nextReminder = datetime;
      } else {
        nextReminder = computeNextTimeFromScheduled(datetime, repeat);
      }
      logger.info(`createReminder: Для повторяющегося напоминания вычислено nextReminder: ${nextReminder}`);
    }
    const reminder = new Reminder({
      userId,
      description,
      datetime,
      repeat: repeat || null,
      nextReminder,
      lastNotified: null,
      cycles: [],
      messageId: null,
      postponedReminder: null,
      inertiaMessageId: null,
      initialMessageEdited: false
    });
    await reminder.save();
    logger.info(`createReminder: Напоминание создано для user ${userId} на ${datetime}`);
    await scheduleReminder(reminder);
    return reminder;
  } catch (error) {
    logger.error(`createReminder: Ошибка при создании напоминания: ${error.message}`);
  }
}

async function listReminders(userId) {
  try {
    const now = new Date();
    const reminders = await Reminder.aggregate([
      {
        $match: {
          userId: userId.toString(),
          completed: false,
          $or: [
            { repeat: { $ne: null } },
            { datetime: { $gte: now } },
            { postponedReminder: { $gte: now } }
          ]
        }
      },
      {
        $addFields: {
          nextEvent: {
            $cond: [
              { $eq: ["$repeat", null] },
              { $ifNull: ["$postponedReminder", "$datetime"] },
              { $cond: [{ $gt: ["$nextReminder", "$datetime"] }, "$nextReminder", "$datetime"] }
            ]
          }
        }
      },
      { $sort: { nextEvent: 1 } }
    ]);
    logger.info(`listReminders: Найдено ${reminders.length} напоминаний для user ${userId}`);
    return reminders;
  } catch (error) {
    logger.error(`listReminders: Ошибка получения списка напоминаний для ${userId}: ${error.message}`);
    return [];
  }
}

async function deleteAllReminders(userId) {
  try {
    await Reminder.deleteMany({ userId: userId.toString() });
    logger.info(`deleteAllReminders: Все напоминания для user ${userId} удалены`);
  } catch (error) {
    logger.error(`deleteAllReminders: Ошибка удаления напоминаний для ${userId}: ${error.message}`);
  }
}

async function deleteReminder(reminderId) {
  try {
    await cancelReminderJobs(reminderId);
    const deleted = await Reminder.findByIdAndDelete(reminderId);
    if (deleted) {
      logger.info(`deleteReminder: Напоминание ${reminderId} удалено`);
      return deleted;
    } else {
      logger.error(`deleteReminder: Напоминание ${reminderId} не найдено для удаления`);
      return null;
    }
  } catch (error) {
    logger.error(`deleteReminder: Ошибка удаления напоминания ${reminderId}: ${error.message}`);
    return null;
  }
}

function toMoscow(dt) {
  return DateTime.fromJSDate(dt, { zone: 'Europe/Moscow' });
}

async function processPostponed(reminder, options = {}) {
  const displayTime = options.cycle 
    ? toMoscow(options.cycle.plannedTime).toFormat('HH:mm')
    : toMoscow(reminder.datetime).toFormat('HH:mm');
  const editText = `Отложено: ${reminder.description}\n🕒 ${displayTime}`;
  try {
    if (options.cycle) {
      await bot.editMessageText(editText, { 
        chat_id: reminder.userId, 
        message_id: options.cycle.messageId,
        reply_markup: { inline_keyboard: [] },
        parse_mode: "HTML" 
      });
      logger.info(`processPostponed: Отредактировано инерционное сообщение reminder ${reminder._id} (удалены кнопки), cycle: ${JSON.stringify(options.cycle)}`);
    } else {
      await bot.editMessageText(editText, {
        chat_id: reminder.userId,
        message_id: reminder.messageId,
        reply_markup: { inline_keyboard: [] },
        parse_mode: "HTML"
      });
      logger.info(`processPostponed: Отредактировано исходное сообщение reminder ${reminder._id} (удалены кнопки)`);
    }
  } catch (err) {
    logger.error(`processPostponed: Ошибка редактирования сообщения для reminder ${reminder._id}: ${err.message}`);
  }
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
  const messageText = options.cycle 
    ? `Отложенный повтор: ${reminder.description}\n🕒 ${displayTime}`
    : `🔔 Напоминание: ${reminder.description}\n🕒 ${displayTime}`;
  try {
    const newMsg = await bot.sendMessage(reminder.userId, messageText, inlineKeyboard);
    logger.info(`processPostponed: Отправлено новое сообщение для reminder ${reminder._id}, messageId: ${newMsg.message_id}`);
    const newPostponed = DateTime.local().setZone('Europe/Moscow').plus({ minutes: 3 }).toJSDate();
    if (options.cycle) {
      options.cycle.messageId = newMsg.message_id;
      options.cycle.postponedReminder = newPostponed;
    } else {
      reminder.messageId = newMsg.message_id;
      reminder.postponedReminder = newPostponed;
      reminder.lastNotified = new Date();
    }
    await reminder.save();
  } catch (err) {
    logger.error(`processPostponed: Ошибка отправки нового сообщения для reminder ${reminder._id}: ${err.message}`);
  }
}

async function processPlannedRepeat(reminder) {
  const currentCycleTime = toMoscow(reminder.nextReminder);
  await sendPlannedReminderRepeated(reminder, currentCycleTime.toJSDate());
  const nextOccurrence = computeNextTimeFromScheduled(currentCycleTime.toJSDate(), reminder.repeat);
  reminder.datetime = currentCycleTime.toJSDate();
  reminder.nextReminder = nextOccurrence;
  reminder.lastNotified = new Date();
  if (reminder.cycles && reminder.cycles.length > 0) {
    reminder.cycles = [reminder.cycles[reminder.cycles.length - 1]];
  }
  await reminder.save();
  logger.info(`processPlannedRepeat: Обновлено напоминание ${reminder._id}, nextReminder: ${nextOccurrence}`);
}

async function sendPlannedReminderRepeated(reminder, displayTimeOverride) {
  const displayTime = toMoscow(displayTimeOverride).toFormat('HH:mm');
  const messageText = `Повтор по плану: ${reminder.description}\n🕒 ${displayTime}`;
  logger.info(`sendPlannedReminderRepeated: Отправка планового сообщения для reminder ${reminder._id}. Текст: "${messageText}"`);
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
  const sentMessage = await bot.sendMessage(reminder.userId, messageText, inlineKeyboard);
  logger.info(`sendPlannedReminderRepeated: Плановое сообщение отправлено для reminder ${reminder._id}, messageId: ${sentMessage.message_id}`);
  const plannedTime = toMoscow(displayTimeOverride);
  const cycle = {
    plannedTime: plannedTime.toJSDate(),
    postponedReminder: plannedTime.plus({ minutes: 3 }).toJSDate(),
    messageId: sentMessage.message_id
  };
  reminder.cycles.push(cycle);
  reminder.lastNotified = new Date();
  await reminder.save();
  logger.info(`sendPlannedReminderRepeated: Цикл повтора обновлен для reminder ${reminder._id}: ${JSON.stringify(cycle)}`);
}

async function sendOneOffReminder(reminder) {
  const displayTime = toMoscow(reminder.datetime).toFormat('HH:mm');
  const messageText = `🔔 Напоминание: ${reminder.description}\n🕒 ${displayTime}`;
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
  const sentMessage = await bot.sendMessage(reminder.userId, messageText, inlineKeyboard);
  logger.info(`sendOneOffReminder: Отправлено одноразовое уведомление для reminder ${reminder._id}, messageId: ${sentMessage.message_id}`);
  reminder.messageId = sentMessage.message_id;
  reminder.lastNotified = new Date();
  reminder.postponedReminder = DateTime.local().setZone('Europe/Moscow').plus({ minutes: 3 }).toJSDate();
  await reminder.save();
}

async function processPostponedOneOff(reminder) {
  await processPostponed(reminder, {});
}

async function processPostponedCycles(reminder) {
  if (reminder.cycles && reminder.cycles.length > 0) {
    const cycle = reminder.cycles[reminder.cycles.length - 1];
    const postponedTime = DateTime.fromJSDate(cycle.postponedReminder, { zone: 'Europe/Moscow' });
    const now = DateTime.local().setZone('Europe/Moscow');
    if (now >= postponedTime) {
      logger.info(`processPostponedCycles: Время повторного уведомления для reminder ${reminder._id} пришло`);
      await processPostponed(reminder, { cycle });
    }
  }
}

async function handleCallback(query) {
  try {
    const data = query.data;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const parts = data.split('|');
    if (parts[0] === 'postpone') {
      const postponeValue = parts[1];
      const reminderId = parts[2];
      const reminder = await Reminder.findById(reminderId);
      if (!reminder) {
        await bot.answerCallbackQuery(query.id, { text: 'Напоминание не найдено' });
        return;
      }
      if (postponeValue === 'custom') {
        pendingRequests.pendingPostpone[chatId] = { reminderId, messageId };
        await bot.sendMessage(chatId, 'Введите время отсрочки (например, "30 минут" или "через 1.5 часа"):');
        await bot.answerCallbackQuery(query.id, { text: 'Введите время отсрочки' });
        return;
      } else {
        let newDateTime;
        if (postponeValue === 'утро') {
          const nowLuxon = DateTime.local().setZone('Europe/Moscow');
          newDateTime = nowLuxon.hour < 8
            ? nowLuxon.set({ hour: 8, minute: 0, second: 0, millisecond: 0 })
            : nowLuxon.plus({ days: 1 }).set({ hour: 8, minute: 0, second: 0, millisecond: 0 });
          newDateTime = newDateTime.toJSDate();
        } else if (postponeValue === 'вечер') {
          const nowLuxon = DateTime.local().setZone('Europe/Moscow');
          newDateTime = nowLuxon.hour < 19
            ? nowLuxon.set({ hour: 19, minute: 0, second: 0, millisecond: 0 })
            : nowLuxon.plus({ days: 1 }).set({ hour: 19, minute: 0, second: 0, millisecond: 0 });
          newDateTime = newDateTime.toJSDate();
        } else {
          const hours = parseFloat(postponeValue);
          newDateTime = DateTime.local().plus({ hours }).toJSDate();
        }
        await cancelReminderJobs(reminderId);
        reminder.datetime = newDateTime;
        reminder.nextReminder = null;
        reminder.cycles = [];
        reminder.messageId = null;
        reminder.postponedReminder = null;
        await reminder.save();
        const formattedNewTime = DateTime.fromJSDate(newDateTime).setZone('Europe/Moscow').toFormat('HH:mm');
        logger.info(`handleCallback (postpone): Для reminder ${reminder._id} установлено новое время ${newDateTime}`);
        try {
          await bot.editMessageText(`🔔 Отложено: ${reminder.description}`, { 
            chat_id: chatId, 
            message_id: messageId, 
            reply_markup: { inline_keyboard: [] }, 
            parse_mode: "HTML" 
          });
        } catch (e) {
          logger.error(`handleCallback (postpone): Ошибка редактирования сообщения для reminder ${reminder._id}: ${e.message}`);
        }
        await bot.sendMessage(chatId, `Отложенный повтор: ${reminder.description}\n🕒 ${formattedNewTime}`, { parse_mode: "HTML" });
        await scheduleReminder(reminder);
        await bot.answerCallbackQuery(query.id, { text: 'Напоминание отсрочено' });
      }
    } else if (parts[0] === 'done') {
      const reminderId = parts[1];
      const reminder = await Reminder.findById(reminderId);
      if (!reminder) {
        await bot.answerCallbackQuery(query.id, { text: 'Напоминание не найдено' });
        return;
      }
      await cancelReminderJobs(reminderId);
      if (reminder.repeat) {
        const cycleIndex = reminder.cycles.findIndex(c => c.messageId === messageId);
        if (cycleIndex !== -1) {
          reminder.cycles.splice(cycleIndex, 1);
          await reminder.save();
          try {
            await bot.editMessageText(`✅ ${reminder.description}`, { 
              chat_id: chatId, 
              message_id: messageId, 
              reply_markup: { inline_keyboard: [] }
            });
          } catch (e) {
            logger.error(`handleCallback (done): Ошибка редактирования сообщения для reminder ${reminder._id}: ${e.message}`);
          }
          await bot.answerCallbackQuery(query.id, { text: 'Цикл выполнен' });
        } else {
          await bot.answerCallbackQuery(query.id, { text: 'Цикл не найден' });
        }
      } else {
        await Reminder.findByIdAndDelete(reminderId);
        try {
          await bot.editMessageText(`✅ ${reminder.description}`, { 
            chat_id: chatId, 
            message_id: messageId, 
            reply_markup: { inline_keyboard: [] }
          });
        } catch (e) {
          logger.error(`handleCallback (done): Ошибка редактирования сообщения для одноразового reminder ${reminder._id}: ${e.message}`);
        }
        await bot.answerCallbackQuery(query.id, { text: 'Напоминание выполнено' });
      }
    }
  } catch (error) {
    logger.error(`handleCallback: Ошибка обработки callback: ${error.message}`);
  }
}

module.exports = {
  createReminder,
  listReminders,
  deleteAllReminders,
  deleteReminder,
  handleCallback,
  Reminder,
  sendOneOffReminder,
  processPlannedRepeat,
  sendPlannedReminderRepeated,
  processPostponedOneOff,
  processPostponedCycles,
};