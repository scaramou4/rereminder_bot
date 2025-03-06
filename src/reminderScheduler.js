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
const { 
  showPostponeSettingsMenu, 
  handleSettingsCallback, 
  getUserTimezone, 
  showSettingsMenu, 
  buildUserPostponeKeyboard 
} = require('./settings');

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
      await bot.editMessageText(`✅ ${reminder.description}`, {
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

  if (data.startsWith('postpone|')) {
    const parts = data.split('|');
    const option = parts[1];
    const reminderId = parts[2];
    const postponeOptionMap = {
      "5m": "5 мин",
      "10m": "10 мин",
      "15m": "15 мин",
      "30m": "30 мин",
      "1h": "1 час",
      "2h": "2 часа",
      "3h": "3 часа",
      "4h": "4 часа",
      "1d": "1 день",
      "2d": "2 дня",
      "3d": "3 дня",
      "7d": "7 дней",
      "1w": "1 неделя",
      // Обрабатываем утро и вечер отдельно
      "am": "утро",
      "pm": "вечер",
      "custom": "…"
    };
    let fullOption;
    try {
      const reminder = await Reminder.findById(reminderId);
      if (!reminder) {
        await bot.sendMessage(chatId, 'Напоминание не найдено.');
        return;
      }
      let newDateTime;
      if (option === "custom" || option === "…") {
        pendingRequests.pendingPostpone[chatId] = { reminderId, messageId };
        await bot.sendMessage(chatId, 'Введите время откладывания (например, "10 минут", "5 мин", "завтра в 10:00"):');
        await bot.answerCallbackQuery(query.id);
        return;
      } else if (option === "am") {
        // Получаем время "утро" из настроек; если не задано – по умолчанию 9:00
        const userSettings = await UserSettings.findOne({ userId: chatId.toString() });
        const morningTime = (userSettings && userSettings.morningTime) || "9:00";
        const [hour, minute] = morningTime.split(':').map(Number);
        newDateTime = DateTime.local().setZone(getUserTimezone(chatId))
          .plus({ days: 1 })
          .set({ hour, minute, second: 0, millisecond: 0 })
          .toJSDate();
        fullOption = "утро";
      } else if (option === "pm") {
        // Получаем время "вечер" из настроек; если не задано – по умолчанию 18:00
        const userSettings = await UserSettings.findOne({ userId: chatId.toString() });
        const eveningTime = (userSettings && userSettings.eveningTime) || "18:00";
        const [hour, minute] = eveningTime.split(':').map(Number);
        let dt = DateTime.local().setZone(getUserTimezone(chatId)).set({ hour, minute, second: 0, millisecond: 0 });
        if (dt < DateTime.local().setZone(getUserTimezone(chatId))) {
          dt = dt.plus({ days: 1 });
        }
        newDateTime = dt.toJSDate();
        fullOption = "вечер";
      } else {
        fullOption = postponeOptionMap[option] || option;
        const settings = await UserSettings.findOne({ userId: chatId.toString() });
        const userPostponeSettings = (settings?.selectedPostponeSettings && settings.selectedPostponeSettings.length)
          ? settings.selectedPostponeSettings
          : ["30 мин", "1 час", "3 часа", "утро", "вечер"];
        if (!userPostponeSettings.includes(fullOption)) {
          await bot.answerCallbackQuery(query.id, { text: 'Этот вариант времени откладывания не настроен. Перейдите в настройки.', show_alert: true });
          return;
        }
        const parsed = parseTimeSpec(fullOption);
        logger.info(`handleCallback: Парсинг времени откладывания "${fullOption}": ${JSON.stringify(parsed)}`);
        if (!parsed.datetime) {
          await bot.answerCallbackQuery(query.id, { text: `Не удалось распознать время откладывания "${fullOption}". Проверьте настройки или используйте другой формат.`, show_alert: true });
          return;
        }
        newDateTime = parsed.datetime;
      }
      if (!reminder.postponedCount) reminder.postponedCount = 0;
      if (reminder.postponedCount > 0) {
        await bot.sendMessage(chatId, `Вы уже отложили это напоминание ${reminder.postponedCount} раз. Уверены, что хотите отложить ещё?`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Да", callback_data: `postpone_confirm|${option}|${reminderId}` }]
            ]
          }
        });
        await bot.answerCallbackQuery(query.id, { text: 'Подтвердите отложение.' });
        return;
      }
      reminder.postponedCount += 1;
      await cancelReminderJobs(reminderId);
      reminder.datetime = newDateTime;
      reminder.postponedReminder = null;
      reminder.messageId = null;
      await reminder.save();
      await scheduleReminder(reminder);
      await bot.editMessageText(`🕒 ${reminder.description}\nНовое время: ${toMoscow(newDateTime, getUserTimezone(chatId)).setLocale('ru').toFormat('HH:mm, d MMMM yyyy')}`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
        parse_mode: "HTML"
      });
      await bot.answerCallbackQuery(query.id, { text: `Напоминание отложено на ${fullOption}.` });
    } catch (err) {
      logger.error(`handleCallback: Ошибка обработки postpone для reminder ${reminderId}: ${err.message}`);
      await bot.answerCallbackQuery(query.id, { text: 'Ошибка при откладывании напоминания.', show_alert: true });
    }
    return;
  }

  if (data.startsWith("postpone_confirm|")) {
    const parts = data.split('|');
    const option = parts[1];
    const reminderId = parts[2];
    const postponeOptionMap = {
      "5m": "5 мин",
      "10m": "10 мин",
      "15m": "15 мин",
      "30m": "30 мин",
      "1h": "1 час",
      "2h": "2 часа",
      "3h": "3 часа",
      "4h": "4 часа",
      "1d": "1 день",
      "2d": "2 дня",
      "3d": "3 дня",
      "7d": "7 дней",
      "1w": "1 неделя",
      "am": "утро",
      "pm": "вечер",
      "custom": "…"
    };
    let fullOption;
    try {
      const reminder = await Reminder.findById(reminderId);
      if (!reminder) {
        await bot.sendMessage(chatId, 'Напоминание не найдено.');
        return;
      }
      let newDateTime;
      if (option === "am") {
        const userSettings = await UserSettings.findOne({ userId: chatId.toString() });
        const morningTime = (userSettings && userSettings.morningTime) || "9:00";
        const [hour, minute] = morningTime.split(':').map(Number);
        newDateTime = DateTime.local().setZone(getUserTimezone(chatId))
          .plus({ days: 1 })
          .set({ hour, minute, second: 0, millisecond: 0 })
          .toJSDate();
        fullOption = "утро";
      } else if (option === "pm") {
        const userSettings = await UserSettings.findOne({ userId: chatId.toString() });
        const eveningTime = (userSettings && userSettings.eveningTime) || "18:00";
        const [hour, minute] = eveningTime.split(':').map(Number);
        let dt = DateTime.local().setZone(getUserTimezone(chatId)).set({ hour, minute, second: 0, millisecond: 0 });
        if (dt < DateTime.local().setZone(getUserTimezone(chatId))) {
          dt = dt.plus({ days: 1 });
        }
        newDateTime = dt.toJSDate();
        fullOption = "вечер";
      } else {
        fullOption = postponeOptionMap[option] || option;
        const parsed = parseTimeSpec(fullOption);
        logger.info(`handleCallback: Парсинг подтверждения времени откладывания "${fullOption}": ${JSON.stringify(parsed)}`);
        if (!parsed.datetime) {
          await bot.answerCallbackQuery(query.id, { text: `Не удалось распознать время откладывания "${fullOption}".`, show_alert: true });
          return;
        }
        newDateTime = parsed.datetime;
      }
      reminder.postponedCount += 1;
      await cancelReminderJobs(reminderId);
      reminder.datetime = newDateTime;
      reminder.postponedReminder = null;
      reminder.messageId = null;
      await reminder.save();
      await scheduleReminder(reminder);
      await bot.editMessageText(`🕒 ${reminder.description}\nНовое время: ${toMoscow(newDateTime, getUserTimezone(chatId)).setLocale('ru').toFormat('HH:mm, d MMMM yyyy')}`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
        parse_mode: "HTML"
      });
      await bot.answerCallbackQuery(query.id, { text: `Напоминание отложено на ${fullOption}.` });
    } catch (err) {
      logger.error(`handleCallback: Ошибка обработки подтверждения postpone для reminder ${reminderId}: ${err.message}`);
      await bot.answerCallbackQuery(query.id, { text: 'Ошибка при откладывании напоминания.', show_alert: true });
    }
    return;
  }

  if (data.startsWith("postpone_cancel|")) {
    await bot.answerCallbackQuery(query.id, { text: 'Отложение отменено.' });
    return;
  } else {
    await bot.answerCallbackQuery(query.id, { text: 'Неизвестная команда.' });
  }
}

async function sendOneOffReminder(reminder) {
  const userTimezone = getUserTimezone(reminder.userId);
  const settings = await UserSettings.findOne({ userId: reminder.userId.toString() });
  const delay = settings?.autoPostponeDelay || 15; // Дефолт 15 минут
  const displayTime = toMoscow(reminder.datetime, userTimezone).toFormat('HH:mm');
  const reminderText = `🔔 ${reminder.description}\n🕒 ${displayTime}`;
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
  const editText = `Повтор в: ${reminder.description}\n🕒 ${displayTime}`;
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
    : `🔔 ${reminder.description}\n🕒 ${displayTime}`;
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