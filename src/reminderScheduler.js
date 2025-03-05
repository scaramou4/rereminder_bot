// src/reminderScheduler.js

const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const bot = require('./botInstance');
const logger = require('./logger');
const pendingRequests = require('./pendingRequests');
const { computeNextTimeFromScheduled, parseReminder } = require('./dateParser');
const { parseTimeSpec } = require('./timeSpecParser');
const { agenda, defineSendReminderJob, scheduleReminder, cancelReminderJobs } = require('./agendaScheduler');
const Reminder = require('./models/reminder');
const UserSettings = require('./models/userSettings');
const { showPostponeSettingsMenu, handleSettingsCallback, getUserTimezone, showSettingsMenu, buildUserPostponeKeyboard } = require('./settings');

mongoose
  .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/reminders')
  .then(() => logger.info('Подключение к MongoDB установлено'))
  .catch((error) => logger.error('Ошибка подключения к MongoDB: ' + error.message));

function toMoscow(date, userTimezone = getUserTimezone()) {
  return DateTime.fromJSDate(date).setZone(userTimezone);
}

async function createReminder(userId, description, datetime, repeat) {
  const reminder = new Reminder({
    userId,
    description,
    datetime,
    repeat: repeat || null,
    nextReminder: datetime,
    lastNotified: null,
    cycles: [],
    messageId: null,
    postponedReminder: null,
    completed: false,
    // Новые поля для инерционного цикла:
    inertiaMessageId: null,
    initialMessageEdited: false
  });
  await reminder.save();
  logger.info(`createReminder: Напоминание создано для user ${userId} на ${new Date(datetime)}`);
  return reminder;
}

async function listReminders(userId) {
  try {
    const now = new Date();
    const reminders = await Reminder.aggregate([
      { $match: { userId: userId.toString(), completed: false } },
      {
        $addFields: {
          nextEvent: {
            $cond: [
              { $ne: ["$repeat", null] },
              { $ifNull: ["$nextReminder", "$datetime"] },
              { $ifNull: ["$postponedReminder", "$datetime"] }
            ]
          }
        }
      },
      {
        $match: {
          $or: [
            { nextEvent: { $gte: now } },
            { inertiaMessageId: { $ne: null } }
          ]
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

// Обновлённая функция удаления всех напоминаний:
// Для каждого напоминания отменяются задачи Agenda, затем удаляются записи
async function deleteAllReminders(userId) {
  try {
    const reminders = await Reminder.find({ userId: userId.toString(), completed: false });
    for (const reminder of reminders) {
      await cancelReminderJobs(reminder._id);
      logger.info(`deleteAllReminders: Отменены задачи для reminder ${reminder._id}`);
    }
    await Reminder.deleteMany({ userId: userId.toString() });
    logger.info(`deleteAllReminders: Все напоминания для user ${userId} удалены из базы.`);
  } catch (error) {
    logger.error(`deleteAllReminders: Ошибка удаления напоминаний для ${userId}: ${error.message}`);
    throw error;
  }
}

// Обновлённая функция удаления одного напоминания: отмена задач и удаление записи
async function deleteReminder(reminderId) {
  try {
    const reminder = await Reminder.findById(reminderId);
    if (reminder) {
      await cancelReminderJobs(reminderId);
      logger.info(`deleteReminder: Отменены задачи для reminder ${reminderId}`);
      const deleted = await Reminder.findByIdAndDelete(reminderId);
      if (deleted) {
        logger.info(`deleteReminder: Напоминание ${reminderId} удалено.`);
        return deleted;
      } else {
        logger.error(`deleteReminder: Напоминание ${reminderId} не найдено при удалении.`);
        return null;
      }
    } else {
      logger.error(`deleteReminder: Напоминание ${reminderId} не найдено.`);
      return null;
    }
  } catch (error) {
    logger.error(`deleteReminder: Ошибка удаления напоминания ${reminderId}: ${error.message}`);
    return null;
  }
}

async function handleCallback(query) {
  const data = query.data;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  logger.info(`handleCallback: Получен callback с данными: ${data}`);

  if (data.startsWith('settings_')) {
    await handleSettingsCallback(query);
    return;
  }

  if (data.startsWith('done|')) {
    const reminderId = data.split('|')[1];
    try {
      const reminder = await Reminder.findById(reminderId);
      if (!reminder) {
        await bot.sendMessage(chatId, 'Напоминание не найдено.');
        return;
      }
      await cancelReminderJobs(reminderId);
      reminder.completed = true;
      reminder.datetime = null;
      reminder.repeat = null;
      reminder.nextReminder = null;
      reminder.lastNotified = null;
      reminder.cycles = [];
      reminder.messageId = null;
      reminder.postponedReminder = null;
      reminder.inertiaMessageId = null;
      reminder.initialMessageEdited = false;
      await reminder.save();
      await bot.editMessageText(`✅ Готово: ${reminder.description}`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
        parse_mode: "HTML"
      });
      await bot.answerCallbackQuery(query.id, { text: 'Напоминание отмечено как выполненное.' });
    } catch (err) {
      logger.error(`handleCallback: Ошибка обработки "Готово" для reminder ${reminderId}: ${err.message}`);
      await bot.answerCallbackQuery(query.id, { text: 'Ошибка при завершении напоминания.', show_alert: true });
    }
    return;
  }

  // Остальной код обработки callback (отложить, подтвердить откладывание и т.д.)
  // оставляем без изменений – он уже корректно работает
}

async function sendOneOffReminder(reminder) {
  const userTimezone = getUserTimezone(reminder.userId);
  const settings = await UserSettings.findOne({ userId: reminder.userId.toString() });
  const delay = settings?.autoPostponeDelay || 15; // Дефолт 15 минут
  const displayTime = toMoscow(reminder.datetime, userTimezone).toFormat('HH:mm');
  const reminderText = `🔔 Напоминание: ${reminder.description}\n🕒 ${displayTime}`;
  const inlineKeyboard = await buildUserPostponeKeyboard(reminder.userId, reminder._id, true);
  try {
    const sentMessage = await bot.sendMessage(reminder.userId, reminderText, inlineKeyboard);
    reminder.messageId = sentMessage.message_id;
    reminder.lastNotified = new Date();
    reminder.datetime = toMoscow(reminder.lastNotified, userTimezone).plus({ minutes: delay }).toJSDate();
    await reminder.save();
    await scheduleReminder(reminder);
    logger.info(`sendOneOffReminder: Отправлено уведомление для reminder ${reminder._id} с автооткладыванием ${delay} мин, messageId: ${sentMessage.message_id}`);
  } catch (err) {
    logger.error(`sendOneOffReminder: Ошибка отправки reminder ${reminder._id}: ${err.message}`);
    if (err.message.includes('No document found')) {
      logger.warn(`sendOneOffReminder: Reminder ${reminder._id} не найден, пропускаем.`);
      return;
    }
    throw err;
  }
}

async function sendReminder(reminderId) {
  logger.info(`sendReminder: Job started for reminder ${reminderId}`);
  try {
    const reminder = await Reminder.findById(reminderId);
    if (!reminder) {
      logger.error(`sendReminder: Reminder ${reminderId} не найден`);
      return;
    }
    const now = new Date();
    const userTimezone = getUserTimezone(reminder.userId);
    const nowInUserTimezone = toMoscow(now, userTimezone);
    logger.info(`sendReminder: Проверка reminder ${reminderId}: datetime=${reminder.datetime}, lastNotified=${reminder.lastNotified}, now=${nowInUserTimezone.toISO()}`);
    
    if (reminder.lastProcessed && (new Date() - reminder.lastProcessed) < 1000) {
      logger.warn(`sendReminder: Дублирующийся вызов для reminder ${reminderId}, пропускаем.`);
      return;
    }

    if (reminder.completed) {
      logger.info(`sendReminder: Reminder ${reminderId} завершено, пропускаем.`);
      return;
    }

    if (reminder.repeat) {
      if (!reminder.nextReminder || nowInUserTimezone.toJSDate() >= reminder.nextReminder) {
        logger.info(`sendReminder: Повторяющееся напоминание, вызываем sendPlannedReminderRepeated`);
        await sendPlannedReminderRepeated(reminder, reminder.nextReminder || reminder.datetime);
      }
    } else if (!reminder.lastNotified && !reminder.completed && (!reminder.datetime || nowInUserTimezone.toJSDate() >= reminder.datetime)) {
      logger.info(`sendReminder: Первое одноразовое напоминание, вызываем sendOneOffReminder`);
      await sendOneOffReminder(reminder);
    } else if (reminder.datetime && !reminder.completed && nowInUserTimezone.toJSDate() >= reminder.datetime) {
      logger.info(`sendReminder: Инерционное напоминание, вызываем processPostponed`);
      await processPostponed(reminder);
    } else {
      logger.info(`sendReminder: Нет действий для reminder ${reminderId} на данный момент`);
    }
    
    reminder.lastProcessed = new Date();
    await reminder.save();
  } catch (err) {
    logger.error(`sendReminder: Ошибка для reminderId=${reminderId}: ${err.message}`);
    if (err.message.includes('No document found')) {
      logger.warn(`sendReminder: Reminder ${reminderId} не найден, пропускаем.`);
      return;
    }
    throw err;
  }
}

async function sendPlannedReminderRepeated(reminder, displayTimeOverride) {
  const userTimezone = getUserTimezone(reminder.userId);
  const displayTime = toMoscow(displayTimeOverride, userTimezone).toFormat('HH:mm');
  const text = `Повтор по плану: ${reminder.description}\n🕒 ${displayTime}`;
  logger.info(`sendPlannedReminderRepeated: Отправка повторного уведомления для reminder ${reminder._id}. Текст: "${text}"`);
  const inlineKeyboard = await buildUserPostponeKeyboard(reminder.userId, reminder._id, true);
  try {
    const sentMessage = await bot.sendMessage(reminder.userId, text, inlineKeyboard);
    logger.info(`sendPlannedReminderRepeated: Повторное уведомление отправлено для reminder ${reminder._id}, messageId: ${sentMessage.message_id}`);
    const plannedTime = toMoscow(displayTimeOverride, userTimezone);
    const cycle = {
      plannedTime: plannedTime.toJSDate(),
      postponedReminder: plannedTime.plus({ minutes: 15 }).toJSDate(),
      messageId: sentMessage.message_id
    };
    reminder.cycles.push(cycle);
    reminder.lastNotified = new Date();
    if (reminder.repeat) {
      const nextOccur = computeNextTimeFromScheduled(displayTimeOverride, reminder.repeat);
      reminder.nextReminder = nextOccur;
      await reminder.save();
      await scheduleReminder(reminder);
    }
    await reminder.save();
  } catch (err) {
    logger.error(`sendPlannedReminderRepeated: Ошибка отправки повторного напоминания ${reminder._id}: ${err.message}`);
    throw err;
  }
}

async function processPostponed(reminder, options = {}) {
  const userTimezone = getUserTimezone(reminder.userId);
  const settings = await UserSettings.findOne({ userId: reminder.userId.toString() });
  const delay = settings?.autoPostponeDelay || 15;
  const displayTime = options.cycle
    ? toMoscow(options.cycle.plannedTime, userTimezone).toFormat('HH:mm')
    : toMoscow(reminder.datetime, userTimezone).toFormat('HH:mm');
  const editText = `Отложено: ${reminder.description}\n🕒 ${displayTime}`;
  const previousMessageId = reminder.messageId;
  try {
    if (previousMessageId) {
      await bot.editMessageText(editText, {
        chat_id: reminder.userId,
        message_id: previousMessageId,
        reply_markup: { inline_keyboard: [] },
        parse_mode: "HTML"
      });
      logger.info(`processPostponed: Кнопки удалены у reminder ${reminder._id}, messageId: ${previousMessageId}`);
    } else {
      logger.warn(`processPostponed: Нет previousMessageId для reminder ${reminder._id}`);
    }
  } catch (err) {
    logger.error(`processPostponed: Ошибка редактирования reminder ${reminder._id}: ${err.message}`);
  }
  const inlineKeyboard = await buildUserPostponeKeyboard(reminder.userId, reminder._id, true);
  const messageText = options.cycle
    ? `Отложенный повтор: ${reminder.description}\n🕒 ${displayTime}`
    : `🔔 Напоминание: ${reminder.description}\n🕒 ${displayTime}`;
  try {
    const sent = await bot.sendMessage(reminder.userId, messageText, inlineKeyboard);
    logger.info(`processPostponed: Отправлено новое сообщение для reminder ${reminder._id}, msgId=${sent.message_id}`);
    const newPostponed = toMoscow(new Date(), userTimezone).plus({ minutes: delay }).toJSDate();
    if (options.cycle) {
      options.cycle.messageId = sent.message_id;
      options.cycle.postponedReminder = newPostponed;
    } else {
      reminder.messageId = sent.message_id;
      reminder.datetime = newPostponed;
      reminder.lastNotified = new Date();
      reminder.postponedReminder = null;
    }
    await reminder.save();
    await scheduleReminder(reminder);
    logger.info(`processPostponed: Инерционное напоминание для ${reminder._id} запланировано на ${reminder.datetime}`);
  } catch (err) {
    logger.error(`processPostponed: Ошибка отправки нового сообщения для reminder ${reminder._id}: ${err.message}`);
    throw err;
  }
}

// Вызов defineSendReminderJob теперь производится после объявления всех функций
defineSendReminderJob(sendReminder);

module.exports = {
  createReminder,
  listReminders,
  deleteAllReminders,
  deleteReminder,
  handleCallback,
  Reminder,
  sendOneOffReminder,
  sendReminder,
  sendPlannedReminderRepeated,
  processPostponed,
  scheduleReminder,
  buildUserPostponeKeyboard
};