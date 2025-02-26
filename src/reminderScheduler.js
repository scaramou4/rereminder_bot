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
const { showPostponeSettingsMenu, handleSettingsCallback, getUserTimezone } = require('./settings');

// Запуск подключения к MongoDB
mongoose
  .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/reminders')
  .then(() => logger.info('Подключение к MongoDB установлено'))
  .catch((error) => logger.error('Ошибка подключения к MongoDB: ' + error.message));

// Определяем задачу "sendReminder"
defineSendReminderJob(sendReminder);

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
    lastProcessed: null,
    postponedCount: 0
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
      { $match: { nextEvent: { $gte: now } } },
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
    await cancelReminderJobs({ 'data.userId': userId.toString() });
    logger.info(`deleteAllReminders: Все напоминания для user ${userId} удалены.`);
  } catch (error) {
    logger.error(`deleteAllReminders: Ошибка удаления напоминаний для ${userId}: ${error.message}`);
  }
}

async function deleteReminder(reminderId) {
  try {
    const deleted = await Reminder.findByIdAndDelete(reminderId);
    if (deleted) {
      await cancelReminderJobs(reminderId);
      logger.info(`deleteReminder: Напоминание ${reminderId} удалено.`);
      return deleted;
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
      reminder.postponedReminder = null;
      reminder.messageId = null;
      await reminder.save();
      await bot.editMessageText(`✅ Готово: ${reminder.description}`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      });
      await bot.answerCallbackQuery(query.id, { text: 'Напоминание отмечено как выполненное.' });
    } catch (err) {
      logger.error(`handleCallback: Ошибка обработки "Готово" для reminder ${reminderId}: ${err.message}`);
      await bot.answerCallbackQuery(query.id, { text: 'Ошибка при завершении напоминания.', show_alert: true });
    }
    return;
  } else if (data.startsWith('postpone|')) {
    const [ , option, reminderId ] = data.split('|');
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
        newDateTime = DateTime.local().setZone(getUserTimezone(chatId))
          .plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toJSDate();
      } else if (option === "pm") {
        newDateTime = DateTime.local().setZone(getUserTimezone(chatId))
          .set({ hour: 18, minute: 0, second: 0, millisecond: 0 })
          .plus({ days: (DateTime.local().setZone(getUserTimezone(chatId)).hour >= 18 ? 1 : 0) }).toJSDate();
      } else {
        // Определяем optionMap локально
        const optionMap = {
          "5m": "5 мин", "10m": "10 мин", "15m": "15 мин", "30m": "30 мин",
          "1h": "1 час", "2h": "2 часа", "3h": "3 часа", "4h": "4 часа",
          "1d": "1 день", "2d": "2 дня", "3d": "3 дня", "7d": "7 дней",
          "1w": "1 неделя"
        };
        const fullOption = optionMap[option] || option;
        const settings = await UserSettings.findOne({ userId: chatId.toString() });
        const userPostponeSettings = (settings?.selectedPostponeSettings && settings.selectedPostponeSettings.length
          ? settings.selectedPostponeSettings
          : ["30 мин", "1 час", "3 часа", "утро", "вечер"]);
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
              [{ text: "Да", callback_data: `postpone_confirm|${option}|${reminderId}` }],
              [{ text: "Нет", callback_data: `postpone_cancel|${reminderId}` }]
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
      await bot.editMessageText(`🕒 Отложено: ${reminder.description}\nНовое время: ${toMoscow(newDateTime, getUserTimezone(chatId)).setLocale('ru').toFormat('HH:mm, d MMMM yyyy')}`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
        parse_mode: "HTML"
      });
      await bot.answerCallbackQuery(query.id, { text: `Напоминание отложено на ${option}` });
    } catch (err) {
      logger.error(`handleCallback: Ошибка обработки postpone для reminder ${reminderId}: ${err.message}`);
      await bot.answerCallbackQuery(query.id, { text: 'Ошибка при откладывании напоминания.', show_alert: true });
    }
    return;
  }
  
  if (data.startsWith("postpone_confirm|")) {
    const [ , option, reminderId ] = data.split('|');
    try {
      const reminder = await Reminder.findById(reminderId);
      if (!reminder) {
        await bot.sendMessage(chatId, 'Напоминание не найдено.');
        return;
      }
      let newDateTime;
      if (option === "am") {
        newDateTime = DateTime.local().setZone(getUserTimezone(chatId))
          .plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toJSDate();
      } else if (option === "pm") {
        newDateTime = DateTime.local().setZone(getUserTimezone(chatId))
          .set({ hour: 18, minute: 0, second: 0, millisecond: 0 })
          .plus({ days: (DateTime.local().setZone(getUserTimezone(chatId)).hour >= 18 ? 1 : 0) }).toJSDate();
      } else {
        const optionMap = {
          "5m": "5 мин", "10m": "10 мин", "15m": "15 мин", "30m": "30 мин",
          "1h": "1 час", "2h": "2 часа", "3h": "3 часа", "4h": "4 часа",
          "1d": "1 день", "2d": "2 дня", "3d": "3 дня", "7d": "7 дней",
          "1w": "1 неделя"
        };
        const fullOption = optionMap[option] || option;
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
      await bot.editMessageText(`🕒 Отложено: ${reminder.description}\nНовое время: ${toMoscow(newDateTime, getUserTimezone(chatId)).setLocale('ru').toFormat('HH:mm, d MMMM yyyy')}`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
        parse_mode: "HTML"
      });
      await bot.answerCallbackQuery(query.id, { text: `Напоминание отложено на ${option}` });
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

// Обновлённая функция toMoscow (принимает параметр userTimezone)
function toMoscow(date, userTimezone = getUserTimezone()) {
  return DateTime.fromJSDate(date).setZone(userTimezone);
}

async function buildUserPostponeKeyboard(userId, reminderId, forNotification = false) {
  let settings = await UserSettings.findOne({ userId: userId.toString() });
  if (!settings) {
    settings = new UserSettings({
      userId: userId.toString(),
      postponeSettings: [...postponeOptions],
      selectedPostponeSettings: ["30 мин", "1 час", "3 часа", "утро", "вечер"]
    });
    await settings.save();
  }
  const options = (settings.selectedPostponeSettings && settings.selectedPostponeSettings.length)
    ? settings.selectedPostponeSettings
    : ["30 мин", "1 час", "3 часа", "утро", "вечер"];
  const optionMap = {
    "5 мин": "5m", "10 мин": "10m", "15 мин": "15m", "30 мин": "30m",
    "1 час": "1h", "2 часа": "2h", "3 часа": "3h", "4 часа": "4h",
    "1 день": "1d", "2 дня": "2d", "3 дня": "3d", "7 дней": "7d",
    "1 неделя": "1w",
    "утро": "am", "вечер": "pm", "…": "…"
  };
  const buttons = options.map(opt => ({
    text: opt,
    callback_data: `postpone|${optionMap[opt] || opt}|${reminderId}`
  }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  // Если это уведомление, добавляем строку с кнопкой "Готово"
  if (forNotification) {
    rows.push([{ text: "Готово", callback_data: `done|${reminderId}` }]);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

async function sendOneOffReminder(reminder) {
  const userTimezone = getUserTimezone(reminder.userId);
  const displayTime = toMoscow(reminder.datetime, userTimezone).toFormat('HH:mm');
  const reminderText = `🔔 Напоминание: ${reminder.description}\n🕒 ${displayTime}`;
  const inlineKeyboard = await buildUserPostponeKeyboard(reminder.userId, reminder._id, true);
  try {
    const sentMessage = await bot.sendMessage(reminder.userId, reminderText, inlineKeyboard);
    reminder.messageId = sentMessage.message_id;
    reminder.lastNotified = new Date();
    reminder.postponedReminder = toMoscow(reminder.lastNotified, userTimezone).plus({ minutes: 3 }).toJSDate();
    await reminder.save();
    await scheduleReminder({ ...reminder.toObject(), datetime: reminder.postponedReminder });
    logger.info(`sendOneOffReminder: Отправлено одноразовое уведомление для reminder ${reminder._id}, messageId: ${sentMessage.message_id}, инерционное запланировано на ${reminder.postponedReminder}`);
  } catch (err) {
    logger.error(`sendOneOffReminder: Ошибка отправки напоминания ${reminder._id}: ${err.message}`);
    if (err.message.includes('No document found')) {
      logger.warn(`sendOneOffReminder: Напоминание ${reminder._id} не найдено в базе, пропускаем.`);
      return;
    }
    throw err;
  }
}

async function sendReminder(reminderId) {
  try {
    const reminder = await Reminder.findById(reminderId);
    if (!reminder) {
      logger.error(`sendReminder: Reminder ${reminderId} не найден`);
      return;
    }
    const now = new Date();
    const userTimezone = getUserTimezone(reminder.userId);
    const nowInUserTimezone = toMoscow(now, userTimezone);
    logger.info(`sendReminder: Проверка reminder ${reminderId}: datetime=${reminder.datetime}, postponedReminder=${reminder.postponedReminder}, lastNotified=${reminder.lastNotified}, now=${nowInUserTimezone.toISO()}`);
    
    if (reminder.lastProcessed && (new Date() - reminder.lastProcessed) < 1000) {
      logger.warn(`sendReminder: Дублирующийся вызов для reminder ${reminderId}, пропускаем.`);
      return;
    }

    if (reminder.repeat) {
      if (!reminder.nextReminder || nowInUserTimezone.toJSDate() >= reminder.nextReminder) {
        logger.info(`sendReminder: Повторяющееся напоминание, вызываем sendPlannedReminderRepeated`);
        await sendPlannedReminderRepeated(reminder, reminder.nextReminder || reminder.datetime);
      }
    } else if (reminder.postponedReminder && !reminder.completed && nowInUserTimezone.toJSDate() >= reminder.postponedReminder) {
      logger.info(`sendReminder: Инерционное напоминание, вызываем processPostponed`);
      await processPostponed(reminder);
    } else if (!reminder.lastNotified && !reminder.completed && (!reminder.datetime || nowInUserTimezone.toJSDate() >= reminder.datetime)) {
      logger.info(`sendReminder: Первое одноразовое напоминание, вызываем sendOneOffReminder`);
      await sendOneOffReminder(reminder);
    } else {
      logger.info(`sendReminder: Нет действий для reminder ${reminderId} на данный момент`);
    }
    
    reminder.lastProcessed = new Date();
    await reminder.save();
  } catch (err) {
    logger.error(`sendReminder: Ошибка для reminderId=${reminderId}: ${err.message}`);
    if (err.message.includes('No document found')) {
      logger.warn(`sendReminder: Напоминание ${reminderId} не найдено в базе, пропускаем.`);
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
      postponedReminder: plannedTime.plus({ minutes: 3 }).toJSDate(),
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
      logger.info(`processPostponed: Кнопки удалены у сообщения reminder ${reminder._id}, messageId: ${previousMessageId}`);
    } else {
      logger.warn(`processPostponed: Нет previousMessageId для reminder ${reminder._id}, пропускаем удаление кнопок`);
    }
  } catch (err) {
    logger.error(`processPostponed: Ошибка редактирования reminder ${reminder._id}, messageId: ${previousMessageId}: ${err.message}`);
  }
  // Для уведомления добавляем клавиатуру с кнопками выбранных опций + кнопку "Готово"
  const inlineKeyboard = await buildUserPostponeKeyboard(reminder.userId, reminder._id, true);
  const messageText = options.cycle
    ? `Отложенный повтор: ${reminder.description}\n🕒 ${displayTime}`
    : `🔔 Напоминание: ${reminder.description}\n🕒 ${displayTime}`;
  try {
    const sent = await bot.sendMessage(reminder.userId, messageText, inlineKeyboard);
    logger.info(`processPostponed: Отправлено новое сообщение reminder ${reminder._id}, msgId=${sent.message_id}`);
    const newPostponed = toMoscow(new Date(), userTimezone).plus({ minutes: 3 }).toJSDate();
    if (options.cycle) {
      options.cycle.messageId = sent.message_id;
      options.cycle.postponedReminder = newPostponed;
    } else {
      reminder.messageId = sent.message_id;
      reminder.postponedReminder = newPostponed;
      reminder.lastNotified = new Date();
    }
    await reminder.save();
    await scheduleReminder({ ...reminder.toObject(), datetime: reminder.postponedReminder });
    logger.info(`processPostponed: Инерционное напоминание для ${reminder._id} запланировано на ${reminder.postponedReminder}`);
  } catch (err) {
    logger.error(`processPostponed: Ошибка отправки нового сообщения для reminder ${reminder._id}: ${err.message}`);
    throw err;
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
  sendReminder,
  sendPlannedReminderRepeated,
  processPostponed,
  buildUserPostponeKeyboard
};