// src/reminderScheduler.js
const { DateTime } = require('luxon');
const bot = require('./botInstance');
const logger = require('./logger');
const pendingRequests = require('./pendingRequests');
const timeSpecParser = require('./timeSpecParser');
const Reminder = require('./models/reminder');
const UserSettings = require('./models/userSettings');
const {
  agenda,
  defineSendReminderJob,
  scheduleReminder,
  cancelReminderJobs
} = require('./agendaScheduler');
const { computeNextTimeFromScheduled, parseReminder } = require('./dateParser');
const {
  buildUserPostponeKeyboard,
  handleSettingsCallback
} = require('./settings');

// Перевод даты в часовую зону пользователя
function toUserZone(date, tz) {
  return DateTime.fromJSDate(date).setZone(tz);
}

//
// Создание напоминания
//
async function createReminder(userId, description, chatId) {
  try {
    const parsed = await parseReminder(description, chatId);
    if (parsed.error) {
      await bot.sendMessage(chatId, `❌ Ошибка: ${parsed.error}`);
      return null;
    }

    const settings = await UserSettings.findOne({ userId: chatId.toString() }) || {
      timezone: 'Europe/Moscow',
      morningTime: '9:00',
      eveningTime: '18:00'
    };

    const exists = await Reminder.findOne({
      userId,
      description: parsed.reminderText,
      datetime: parsed.datetime
    });
    if (exists) {
      await bot.sendMessage(chatId, '⚠ Такое напоминание уже существует.');
      return null;
    }

    const rem = new Reminder({
      userId,
      description: parsed.reminderText,
      datetime: parsed.datetime,
      repeat: parsed.repeat || null,
      nextReminder: parsed.repeat ? parsed.datetime : null
    });
    await rem.save();
    logger.info(`createReminder: создано ${rem._id}`);

    await scheduleReminder(rem);
    return rem;
  } catch (err) {
    logger.error(`createReminder: Ошибка: ${err.message}`);
    await bot.sendMessage(chatId, '❌ Не удалось создать напоминание.');
    return null;
  }
}

//
// Чтение списка напоминаний
//
async function listReminders(userId) {
  try {
    const now = new Date();
    return Reminder.aggregate([
      { $match: { userId: userId.toString(), completed: false } },
      {
        $addFields: {
          nextEvent: {
            $cond: [
              { $ne: ['$repeat', null] },
              { $ifNull: ['$nextReminder', '$datetime'] },
              { $ifNull: ['$postponedReminder', '$datetime'] }
            ]
          }
        }
      },
      { $match: { nextEvent: { $gte: now } } },
      { $sort: { nextEvent: 1 } }
    ]);
  } catch (err) {
    logger.error(`listReminders: Ошибка: ${err.message}`);
    return [];
  }
}

//
// Удаление всех напоминаний пользователя
//
async function deleteAllReminders(userId) {
  const rems = await Reminder.find({ userId: userId.toString(), completed: false });
  for (const r of rems) {
    await cancelReminderJobs(r._id);
    logger.info(`deleteAllReminders: отменена задача ${r._id}`);
  }
  await Reminder.deleteMany({ userId: userId.toString() });
}

//
// Удаление одного напоминания
//
async function deleteReminder(reminderId) {
  const rem = await Reminder.findById(reminderId);
  if (!rem) return null;
  await cancelReminderJobs(reminderId);
  return Reminder.findByIdAndDelete(reminderId);
}

//
// Отправка однократного напоминания
//
async function sendOneOffReminder(rem) {
  try {
    rem.postponedCount = 0;  // сброс ручных отложений

    const settings = await UserSettings.findOne({ userId: rem.userId.toString() }) || {
      timezone: 'Europe/Moscow',
      autoPostponeDelay: 15
    };
    const tz = settings.timezone;
    const delay = settings.autoPostponeDelay;

    const display = toUserZone(rem.datetime, tz).toFormat('HH:mm');
    const text = `🔔 ${rem.description}\n🕒 ${display}`;
    const keyboard = await buildUserPostponeKeyboard(rem.userId, rem._id, true);
    const msg = await bot.sendMessage(rem.userId, text, keyboard);

    rem.messageId = msg.message_id;
    rem.lastNotified = new Date();
    rem.datetime = toUserZone(rem.lastNotified, tz)
      .plus({ minutes: delay })
      .toJSDate();

    await rem.save();
    await scheduleReminder(rem);
  } catch (err) {
    logger.error(`sendOneOffReminder: Ошибка: ${err.message}`);
    if (!err.message.includes('No document found')) throw err;
  }
}

//
// Отправка повторного напоминания с расписанием
//
async function sendPlannedReminderRepeated(rem, when) {
  try {
    rem.postponedCount = 0;  // сброс ручных отложений

    const settings = await UserSettings.findOne({ userId: rem.userId.toString() }) || {
      timezone: 'Europe/Moscow'
    };
    const tz = settings.timezone;

    const dt = toUserZone(when, tz);
    const displayTime = dt.toFormat('HH:mm');
    const displayDate = dt.toFormat('d MMMM yyyy');
    const text = `📌 ${rem.description}\n🕒 ${displayTime}, ${displayDate}`;

    const keyboard = await buildUserPostponeKeyboard(rem.userId, rem._id, true);
    const msg = await bot.sendMessage(rem.userId, text, keyboard);

    rem.cycles.push({
      plannedTime: dt.toJSDate(),
      postponedReminder: dt.toJSDate(),
      messageId: msg.message_id
    });

    rem.lastNotified = new Date();
    if (rem.repeat) {
      rem.nextReminder = computeNextTimeFromScheduled(when, rem.repeat, tz);
    }

    await rem.save();
    await scheduleReminder(rem);
  } catch (err) {
    logger.error(`sendPlannedReminderRepeated: Ошибка: ${err.message}`);
    throw err;
  }
}

//
// Основная функция планировщика Agenda
//
async function sendReminder(reminderId) {
  try {
    const rem = await Reminder.findById(reminderId);
    if (!rem || rem.completed) return;

    const settings = await UserSettings.findOne({ userId: rem.userId.toString() }) || {
      timezone: 'Europe/Moscow'
    };
    const tz = settings.timezone;
    const now = DateTime.now().setZone(tz).toJSDate();

    if (rem.repeat) {
      if (!rem.nextReminder || now >= rem.nextReminder) {
        await sendPlannedReminderRepeated(rem, rem.nextReminder || rem.datetime);
      }
    } else {
      // первый раз или после отложенного отправляем однократно
      if (!rem.lastNotified || now >= rem.datetime) {
        await sendOneOffReminder(rem);
      }
    }
  } catch (err) {
    logger.error(`sendReminder: Ошибка: ${err.message}`);
    throw err;
  }
}

//
// Обработка inline-колбэков от кнопок
//
async function handleCallback(query) {
  const data = query.data;
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;

  // настройки
  if (data.startsWith('settings_')) {
    return handleSettingsCallback(query);
  }

  // выполнено
  if (data.startsWith('done|')) {
    const id = data.split('|')[1];
    try {
      const rem = await Reminder.findById(id);
      if (!rem) return;
      await cancelReminderJobs(id);
      rem.completed = true;
      await rem.save();

      // убрать клавиатуру
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: msgId
      });
      return bot.answerCallbackQuery(query.id, { text: 'Отмечено как выполненное.' });
    } catch (err) {
      logger.error(`handleCallback done: ${err.message}`);
      return bot.answerCallbackQuery(query.id, { text: 'Ошибка.', show_alert: true });
    }
  }

  // отложить
  if (data.startsWith('postpone|')) {
    const [, opt, id] = data.split('|');
    const rem = await Reminder.findById(id);
    if (!rem) {
      return bot.answerCallbackQuery(query.id, { text: 'Напоминание не найдено.' });
    }

    const settings = await UserSettings.findOne({ userId: chatId.toString() }) || {
      timezone: 'Europe/Moscow',
      morningTime: '9:00',
      eveningTime: '18:00'
    };
    const tz = settings.timezone;
    let newDate, label;

    if (opt === 'am') {
      const [h, m] = settings.morningTime.split(':').map(Number);
      newDate = DateTime.now().setZone(tz).plus({ days: 1 }).set({ hour: h, minute: m, second: 0 }).toJSDate();
      label = 'утро';
    } else if (opt === 'pm') {
      const [h, m] = settings.eveningTime.split(':').map(Number);
      let dt = DateTime.now().setZone(tz).set({ hour: h, minute: m, second: 0 });
      if (dt <= DateTime.now().setZone(tz)) dt = dt.plus({ days: 1 });
      newDate = dt.toJSDate();
      label = 'вечер';
    } else if (opt === 'custom') {
      pendingRequests.pendingPostpone[chatId] = { reminderId: id };
      await bot.sendMessage(chatId, 'Введите, на сколько отложить:');
      return bot.answerCallbackQuery(query.id);
    } else {
      const map = {
        '5m':'5 мин','10m':'10 мин','15m':'15 мин','30m':'30 мин',
        '1h':'1 час','2h':'2 часа','3h':'3 часа','4h':'4 часа',
        '1d':'1 день','2d':'2 дня','3d':'3 дня','7d':'7 дней'
      };
      if (map[opt]) {
        label = map[opt];
        newDate = timeSpecParser.parseTimeSpec(label).datetime;
      } else {
        label = opt;
        newDate = timeSpecParser.parseTimeSpec(opt).datetime;
      }
    }

    rem.datetime = newDate;
    rem.postponedCount = (rem.postponedCount || 0) + 1;
    await rem.save();
    await cancelReminderJobs(id);
    await scheduleReminder(rem);

    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: chatId,
      message_id: msgId
    });
    return bot.answerCallbackQuery(query.id, { text: `Отложено на ${label}` });
  }
}

defineSendReminderJob(sendReminder);

module.exports = {
  createReminder,
  listReminders,
  deleteAllReminders,
  deleteReminder,
  /* экспортируем, чтобы тестировать auto-postpone */
  sendOneOffReminder,
  sendReminder,
  handleCallback,
  Reminder
};