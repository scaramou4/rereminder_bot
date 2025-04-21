const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const bot = require('./botInstance');
const logger = require('./logger');
const pendingRequests = require('./pendingRequests');
const { computeNextTimeFromScheduled, parseReminder } = require('./dateParser');
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

function toUserZone(date, userTimezone) {
  return DateTime.fromJSDate(date).setZone(userTimezone);
}

async function createReminder(userId, description, chatId) {
  try {
    const parsed = await parseReminder(description, chatId);
    if (parsed.error) {
      logger.warn(`createReminder: Ошибка парсинга напоминания для user ${userId}: ${parsed.error}. Входной текст: "${description}"`);
      await bot.sendMessage(chatId, `❌ Ошибка: ${parsed.error}. Пожалуйста, укажите текст напоминания (например, "утром завтрак").`);
      return null;
    }

    const settings = await UserSettings.findOne({ userId: chatId.toString() }) || { timezone: 'Europe/Moscow' };
    const userZone = settings.timezone;

    const reminder = new Reminder({
      userId,
      description: parsed.reminderText,
      datetime: parsed.datetime,
      repeat: parsed.repeat || null,
      nextReminder: parsed.repeat ? parsed.datetime : null,
      lastNotified: null,
      cycles: [],
      messageId: null,
      postponedReminder: null,
      completed: false,
      inertiaMessageId: null,
      initialMessageEdited: false
    });
    await reminder.save();
    logger.info(`createReminder: Напоминание создано для user ${userId} на ${toUserZone(parsed.datetime, userZone).toISO()} с текстом "${parsed.reminderText}"`);
    await scheduleReminder(reminder);
    return reminder;
  } catch (error) {
    logger.error(`createReminder: Необработанная ошибка создания напоминания для user ${userId}: ${error.message}. Входной текст: "${description}"`);
    await bot.sendMessage(chatId, `❌ Произошла непредвиденная ошибка при создании напоминания. Попробуйте ещё раз или свяжитесь с поддержкой.`);
    return null;
  }
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
      "5m": "5 мин", "10m": "10 мин", "15m": "15 мин", "30m": "30 мин",
      "1h": "1 час", "2h": "2 часа", "3h": "3 часа", "4h": "4 часа",
      "1d": "1 день", "2d": "2 дня", "3d": "3 дня", "7d": "7 дней",
      "1w": "1 неделя", "am": "утро", "pm": "вечер", "custom": "…"
    };
    let fullOption;
    try {
      const reminder = await Reminder.findById(reminderId);
      if (!reminder) {
        await bot.sendMessage(chatId, 'Напоминание не найдено.');
        return;
      }
      const userSettings = await UserSettings.findOne({ userId: chatId.toString() }) || { timezone: 'Europe/Moscow' };
      const userZone = userSettings.timezone;
      let newDateTime;
      if (option === "custom" || option === "…") {
        pendingRequests.pendingPostpone[chatId] = { reminderId, messageId };
        await bot.sendMessage(chatId, 'Введите время откладывания (например, "10 минут", "5 мин", "завтра в 10:00"):');
        await bot.answerCallbackQuery(query.id);
        return;
      } else if (option === "am") {
        const morningTime = userSettings.morningTime || "9:00";
        const [hour, minute] = morningTime.split(':').map(Number);
        newDateTime = DateTime.local().setZone(userZone)
          .plus({ days: 1 })
          .set({ hour, minute, second: 0, millisecond: 0 })
          .toJSDate();
        fullOption = "утро";
      } else if (option === "pm") {
        const eveningTime = userSettings.eveningTime || "18:00";
        const [hour, minute] = eveningTime.split(':').map(Number);
        let dt = DateTime.local().setZone(userZone).set({ hour, minute, second: 0, millisecond: 0 });
        if (dt < DateTime.local().setZone(userZone)) {
          dt = dt.plus({ days: 1 });
        }
        newDateTime = dt.toJSDate();
        fullOption = "вечер";
      } else {
        fullOption = postponeOptionMap[option] || option;
        const settings = await UserSettings.findOne({ userId: chatId.toString() });
        const userPostponeSettings = (settings?.selectedPostponeSettings && settings.selectedPostponeSettings.length)
          ? settings.selectedPostponeSettings
          : ["30 мин", "1 час", "3 часа", "утро", "вечер", "…"];
        if (!userPostponeSettings.includes(fullOption)) {
          await bot.answerCallbackQuery(query.id, { text: 'Этот вариант времени откладывания не настроен.', show_alert: true });
          return;
        }
        const parsed = await parseReminder(`через ${fullOption}`, chatId);
        if (!parsed.datetime) {
          await bot.answerCallbackQuery(query.id, { text: `Не удалось распознать время откладывания "${fullOption}".`, show_alert: true });
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
      await bot.editMessageText(`🕒 ${reminder.description}\nНовое время: ${toUserZone(newDateTime, userZone).setLocale('ru').toFormat('HH:mm, d MMMM yyyy')}`, {
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
      "5m": "5 мин", "10m": "10 мин", "15m": "15 мин", "30m": "30 мин",
      "1h": "1 час", "2h": "2 часа", "3h": "3 часа", "4h": "4 часа",
      "1d": "1 день", "2d": "2 дня", "3d": "3 дня", "7d": "7 дней",
      "1w": "1 неделя", "am": "утро", "pm": "вечер", "custom": "…"
    };
    let fullOption;
    try {
      const reminder = await Reminder.findById(reminderId);
      if (!reminder) {
        await bot.sendMessage(chatId, 'Напоминание не найдено.');
        return;
      }
      const userSettings = await UserSettings.findOne({ userId: chatId.toString() }) || { timezone: 'Europe/Moscow' };
      const userZone = userSettings.timezone;
      let newDateTime;
      if (option === "am") {
        const morningTime = userSettings.morningTime || "9:00";
        const [hour, minute] = morningTime.split(':').map(Number);
        newDateTime = DateTime.local().setZone(userZone)
          .plus({ days: 1 })
          .set({ hour, minute, second: 0, millisecond: 0 })
          .toJSDate();
        fullOption = "утро";
      } else if (option === "pm") {
        const eveningTime = userSettings.eveningTime || "18:00";
        const [hour, minute] = eveningTime.split(':').map(Number);
        let dt = DateTime.local().setZone(userZone).set({ hour, minute, second: 0, millisecond: 0 });
        if (dt < DateTime.local().setZone(userZone)) {
          dt = dt.plus({ days: 1 });
        }
        newDateTime = dt.toJSDate();
        fullOption = "вечер";
      } else {
        fullOption = postponeOptionMap[option] || option;
        const parsed = await parseReminder(`через ${fullOption}`, chatId);
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
      await bot.editMessageText(`🕒 ${reminder.description}\nНовое время: ${toUserZone(newDateTime, userZone).setLocale('ru').toFormat('HH:mm, d MMMM yyyy')}`, {
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
  const settings = await UserSettings.findOne({ userId: reminder.userId.toString() }) || { timezone: 'Europe/Moscow', autoPostponeDelay: 15 };
  const userZone = settings.timezone;
  const delay = settings.autoPostponeDelay || 15;
  const displayTime = toUserZone(reminder.datetime, userZone).toFormat('HH:mm');
  const reminderText = `🔔 ${reminder.description}\n🕒 ${displayTime}`;
  const inlineKeyboard = await buildUserPostponeKeyboard(reminder.userId, reminder._id, true);
  try {
    const sentMessage = await bot.sendMessage(reminder.userId, reminderText, inlineKeyboard);
    reminder.messageId = sentMessage.message_id;
    reminder.lastNotified = new Date();
    reminder.datetime = toUserZone(reminder.lastNotified, userZone).plus({ minutes: delay }).toJSDate();
    await reminder.save();
    await scheduleReminder(reminder);
    logger.info(`sendOneOffReminder: Отправлено уведомление для reminder ${reminder._id} с автооткладыванием ${delay} мин`);
  } catch (err) {
    logger.error(`sendOneOffReminder: Ошибка отправки reminder ${reminder._id}: ${err.message}`);
    if (err.message.includes('No document found')) return;
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
    const settings = await UserSettings.findOne({ userId: reminder.userId.toString() }) || { timezone: 'Europe/Moscow' };
    const userZone = settings.timezone;
    const now = DateTime.now().setZone(userZone);
    const nowInUserZone = now.toJSDate();
    
    if (reminder.lastProcessed && (new Date() - reminder.lastProcessed) < 1000) {
      logger.warn(`sendReminder: Дублирующийся вызов для reminder ${reminderId}, пропускаем.`);
      return;
    }

    if (reminder.completed) {
      logger.info(`sendReminder: Reminder ${reminderId} завершено, пропускаем.`);
      return;
    }

    if (reminder.repeat) {
      if (!reminder.nextReminder || nowInUserZone >= reminder.nextReminder) {
        await sendPlannedReminderRepeated(reminder, reminder.nextReminder || reminder.datetime);
      }
    } else if (!reminder.lastNotified && !reminder.completed && (!reminder.datetime || nowInUserZone >= reminder.datetime)) {
      await sendOneOffReminder(reminder);
    } else if (reminder.datetime && !reminder.completed && nowInUserZone >= reminder.datetime) {
      await processPostponed(reminder);
    } else {
      logger.info(`sendReminder: Нет действий для reminder ${reminderId} на данный момент`);
    }
    
    reminder.lastProcessed = new Date();
    await reminder.save();
  } catch (err) {
    logger.error(`sendReminder: Ошибка для reminderId=${reminderId}: ${err.message}`);
    if (err.message.includes('No document found')) return;
    throw err;
  }
}

async function sendPlannedReminderRepeated(reminder, displayTimeOverride) {
  const settings = await UserSettings.findOne({ userId: reminder.userId.toString() }) || { timezone: 'Europe/Moscow' };
  const userZone = settings.timezone;
  const dt = toUserZone(displayTimeOverride, userZone);
  const displayTime = dt.toFormat('HH:mm');
  const displayDate = dt.toFormat('d MMMM yyyy');
  const text = `📌 ${reminder.description}\n🕒 ${displayTime}, ${displayDate}\n${reminder.repeat ? `🔁 Повтор: ${reminder.repeat}` : ''}`;
  logger.info(`sendPlannedReminderRepeated: Отправка повторного уведомления для reminder ${reminder._id}`);
  const inlineKeyboard = await buildUserPostponeKeyboard(reminder.userId, reminder._id, true);
  try {
    const sentMessage = await bot.sendMessage(reminder.userId, text, inlineKeyboard);
    const plannedTime = toUserZone(displayTimeOverride, userZone);
    const cycle = {
      plannedTime: plannedTime.toJSDate(),
      messageId: sentMessage.message_id
    };
    reminder.cycles.push(cycle);
    reminder.lastNotified = new Date();
    if (reminder.repeat) {
      const nextOccur = computeNextTimeFromScheduled(displayTimeOverride, reminder.repeat, userZone);
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
  const settings = await UserSettings.findOne({ userId: reminder.userId.toString() }) || { timezone: 'Europe/Moscow', autoPostponeDelay: 15 };
  const userZone = settings.timezone;
  const delay = settings.autoPostponeDelay || 15;
  const displayTime = options.cycle
    ? toUserZone(options.cycle.plannedTime, userZone).toFormat('HH:mm')
    : toUserZone(reminder.datetime, userZone).toFormat('HH:mm');
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
    const newPostponed = toUserZone(new Date(), userZone).plus({ minutes: delay }).toJSDate();
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
  } catch (err) {
    logger.error(`processPostponed: Ошибка отправки нового сообщения для reminder ${reminder._id}: ${err.message}`);
    throw err;
  }
}

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