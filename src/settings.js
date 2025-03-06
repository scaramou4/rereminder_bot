// src/settings.js

const bot = require('./botInstance');
const logger = require('./logger');
const UserSettings = require('./models/userSettings');
const { DateTime } = require('luxon');
const moment = require('moment-timezone');
const geoTz = require('geo-tz');

// Опции времени откладывания по умолчанию (для обычного откладывания)
// Последовательность: 5 мин, 10 мин, 15 мин, 20 мин, 30 мин, 1 час, 2 часа, 3 часа, 1 день, 3 дня, утро, вечер, …
const postponeOptions = [
  "5 мин", "10 мин", "15 мин", "20 мин", "30 мин",
  "1 час", "2 часа", "3 часа",
  "1 день", "3 дня",
  "утро", "вечер",
  "…"
];

// Опции автооткладывания (в минутах)
const autoPostponeOptions = ["5 мин", "10 мин", "15 мин", "20 мин", "30 мин", "45 мин", "60 мин"];

const timezoneMessages = {}; // Ключ – chatId, значение – массив message_id

// ──────────────────────────────────────────────
// Главное меню настроек
// ──────────────────────────────────────────────
function showSettingsMenu(chatId) {
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Часовой пояс", callback_data: "settings_timezone" }],
        [{ text: "Время откладывания", callback_data: "settings_postpone" }],
        [{ text: "Автооткладывание", callback_data: "settings_auto" }],
        [
          { text: "Утро", callback_data: "settings_morning" },
          { text: "Вечер", callback_data: "settings_evening" }
        ]
      ]
    }
  };
  bot.sendMessage(chatId, "Выберите параметр для настройки:", keyboard);
}

// ──────────────────────────────────────────────
// Настройка списка опций откладывания
// ──────────────────────────────────────────────
async function showPostponeSettingsMenu(chatId, messageId = null) {
  let settings = await UserSettings.findOne({ userId: chatId.toString() });
  if (!settings) {
    settings = new UserSettings({
      userId: chatId.toString(),
      postponeSettings: [...postponeOptions],
      selectedPostponeSettings: [...postponeOptions.filter(opt => ["1 час", "3 часа", "утро", "вечер", "…"].includes(opt))]
    });
  }
  postponeOptions.forEach(opt => {
    if (!settings.postponeSettings.includes(opt)) {
      settings.postponeSettings.push(opt);
    }
  });
  await settings.save();

  const buttons = settings.postponeSettings.map(opt => ({
    text: (settings.selectedPostponeSettings.includes(opt) ? "✅ " : "") + opt,
    callback_data: `settings_postpone_option_${opt}`
  }));

  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  rows.push([{ text: "ОК", callback_data: "settings_postpone_ok" }]);
  rows.push([{ text: "Отмена", callback_data: "settings_postpone_cancel" }]);

  const keyboard = { reply_markup: { inline_keyboard: rows } };
  const textMsg = "Выберите варианты времени откладывания (множественный выбор):";
  if (messageId) {
    await bot.editMessageText(textMsg, { chat_id: chatId, message_id: messageId, ...keyboard });
  } else {
    await bot.sendMessage(chatId, textMsg, keyboard);
  }
}

// ──────────────────────────────────────────────
// Настройка автооткладывания (в минутах)
// ──────────────────────────────────────────────
async function showAutoPostponeSettings(chatId, messageId = null) {
  let settings = await UserSettings.findOne({ userId: chatId.toString() });
  if (!settings) {
    settings = new UserSettings({ userId: chatId.toString(), autoPostponeDelay: 15 });
    await settings.save();
  }
  const currentDelay = settings.autoPostponeDelay;
  const buttons = autoPostponeOptions.map(opt => {
    const num = parseInt(opt, 10);
    return {
      text: (num === currentDelay ? "✅ " : "") + opt,
      callback_data: `settings_auto_option_${num}`
    };
  });
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  rows.push([{ text: "Отмена", callback_data: "settings_auto_cancel" }]);
  const keyboard = { reply_markup: { inline_keyboard: rows } };
  const textMsg = "Выберите время автооткладывания (в минутах):";
  if (messageId) {
    await bot.editMessageText(textMsg, { chat_id: chatId, message_id: messageId, ...keyboard });
  } else {
    await bot.sendMessage(chatId, textMsg, keyboard);
  }
}

// ──────────────────────────────────────────────
// Настройка утреннего времени
// ──────────────────────────────────────────────
async function showMorningSettings(chatId, messageId = null) {
  let settings = await UserSettings.findOne({ userId: chatId.toString() });
  if (!settings) {
    settings = new UserSettings({ userId: chatId.toString(), morningTime: "9:00" });
    await settings.save();
  }
  const morningOptions = ["6:00", "7:00", "8:00", "9:00", "10:00", "11:00"];
  const buttons = morningOptions.map(opt => {
    const isSelected = settings.morningTime === opt;
    return {
      text: (isSelected ? "✅ " : "") + opt,
      callback_data: `settings_morning_option_${opt}`
    };
  });
  const rows = [];
  rows.push(buttons.slice(0, 3));
  rows.push(buttons.slice(3, 6));
  rows.push([{ text: "ОК", callback_data: "settings_morning_ok" }, { text: "Отмена", callback_data: "settings_morning_cancel" }]);
  const keyboard = { reply_markup: { inline_keyboard: rows } };
  const textMsg = "Выберите время для утреннего напоминания:";
  if (messageId) {
    await bot.editMessageText(textMsg, { chat_id: chatId, message_id: messageId, ...keyboard });
  } else {
    await bot.sendMessage(chatId, textMsg, keyboard);
  }
}

// ──────────────────────────────────────────────
// Настройка вечернего времени
// ──────────────────────────────────────────────
async function showEveningSettings(chatId, messageId = null) {
  let settings = await UserSettings.findOne({ userId: chatId.toString() });
  if (!settings) {
    settings = new UserSettings({ userId: chatId.toString(), eveningTime: "18:00" });
    await settings.save();
  }
  const eveningOptions = ["17:00", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00"];
  const buttons = eveningOptions.map(opt => {
    const isSelected = settings.eveningTime === opt;
    return {
      text: (isSelected ? "✅ " : "") + opt,
      callback_data: `settings_evening_option_${opt}`
    };
  });
  const rows = [];
  rows.push(buttons.slice(0, 4));
  rows.push(buttons.slice(4));
  rows.push([{ text: "ОК", callback_data: "settings_evening_ok" }, { text: "Отмена", callback_data: "settings_evening_cancel" }]);
  const keyboard = { reply_markup: { inline_keyboard: rows } };
  const textMsg = "Выберите время для вечернего напоминания:";
  if (messageId) {
    await bot.editMessageText(textMsg, { chat_id: chatId, message_id: messageId, ...keyboard });
  } else {
    await bot.sendMessage(chatId, textMsg, keyboard);
  }
}

// ──────────────────────────────────────────────
// Настройка часового пояса и отправка геопозиции
// ──────────────────────────────────────────────
async function showTimezoneSelection(chatId) {
  const locationMsg = await bot.sendMessage(chatId, "Укажите разницу во времени относительно UTC (Москва — UTC+3) или отправьте геопозицию:", {
    reply_markup: {
      keyboard: [
        [{ text: "Отправить геопозицию", request_location: true }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });

  const timezoneOffsets = Array.from({ length: 27 }, (_, i) => i - 12);
  const buttons = timezoneOffsets.map(offset => ({
    text: `UTC${offset >= 0 ? '+' : ''}${offset}:00`,
    callback_data: `settings_timezone_utc_${offset}`
  }));
  
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  rows.push([{ text: "Отмена", callback_data: "settings_cancel" }]);
  
  const inlineKeyboard = { reply_markup: { inline_keyboard: rows } };
  
  const inlineMsg = await bot.sendMessage(chatId, "Выберите разницу:", inlineKeyboard);

  if (!timezoneMessages[chatId]) {
    timezoneMessages[chatId] = [];
  }
  // Сохраняем оба идентификатора: locationMsg и inlineMsg
  timezoneMessages[chatId].push(locationMsg.message_id, inlineMsg.message_id);
  logger.info(`showTimezoneSelection: Сохранены message_id ${locationMsg.message_id} и ${inlineMsg.message_id} для user ${chatId}`);
}

// ──────────────────────────────────────────────
// Установка часового пояса
// ──────────────────────────────────────────────
async function setUserTimezone(chatId, timezone) {
  let ianaTimezone = timezone;
  if (timezone.startsWith('UTC')) {
    const offset = parseInt(timezone.split('UTC')[1].replace(':', ''), 10);
    ianaTimezone = moment.tz.guess({ offset: offset * 60 });
  }
  let settings = await UserSettings.findOne({ userId: chatId.toString() });
  if (!settings) {
    settings = new UserSettings({ userId: chatId.toString() });
  }
  settings.timezone = ianaTimezone;
  await settings.save();
  logger.info(`setUserTimezone: Установлен часовой пояс ${ianaTimezone} для user ${chatId}`);
}

// ──────────────────────────────────────────────
// Получение часового пояса (по умолчанию)
// ──────────────────────────────────────────────
function getUserTimezone(chatId) {
  return 'Europe/Moscow';
}

// ──────────────────────────────────────────────
// Построение клавиатуры для откладывания (с выбранными опциями в заданном порядке)
// ──────────────────────────────────────────────
async function buildUserPostponeKeyboard(userId, reminderId, forNotification = false) {
  let settings = await UserSettings.findOne({ userId: userId.toString() });
  if (!settings) {
    settings = new UserSettings({
      userId: userId.toString(),
      postponeSettings: [...postponeOptions],
      selectedPostponeSettings: [...postponeOptions.filter(opt => ["5 мин", "10 мин", "15 мин", "20 мин", "30 мин", "1 час", "3 часа", "утро", "вечер", "…"].includes(opt))]
    });
  }
  const activeOptions = postponeOptions.filter(opt => settings.selectedPostponeSettings.includes(opt));
  const optionMap = {
    "5 мин": "5m",
    "10 мин": "10m",
    "15 мин": "15m",
    "20 мин": "20m",
    "30 мин": "30m",
    "1 час": "1h",
    "2 часа": "2h",
    "3 часа": "3h",
    "1 день": "1d",
    "3 дня": "3d",
    "утро": "am",
    "вечер": "pm",
    "…": "custom"
  };
  const buttons = activeOptions.map(opt => ({
    text: opt,
    callback_data: `postpone|${optionMap[opt] || opt}|${reminderId}`
  }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  if (forNotification) {
    rows.push([{ text: "Готово", callback_data: `done|${reminderId}` }]);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

// ──────────────────────────────────────────────
// Обработка callback настроек
// ──────────────────────────────────────────────
async function handleSettingsCallback(query) {
  const chatId = query.message.chat.id;
  const data = query.data;
  const messageId = query.message.message_id;
  logger.info(`settings: Обработка callback: ${data}`);

  if (
    data === "settings_cancel" ||
    data === "settings_postpone_cancel" ||
    data === "settings_auto_cancel" ||
    data === "settings_morning_cancel" ||
    data === "settings_evening_cancel"
  ) {
    try {
      // Редактируем сообщение, устанавливая текст "Отмена настройки" и удаляем клавиатуру
      await bot.editMessageText("Отмена настройки", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      });
    } catch (e) {
      logger.warn(`Ошибка редактирования сообщения при отмене настройки: ${e.message}`);
    }
    // При наличии сообщений в timezoneMessages удаляем только те, которые не совпадают с messageId
    if (timezoneMessages[chatId]) {
      for (const msgId of timezoneMessages[chatId]) {
        if (msgId === messageId) continue;
        try {
          await bot.deleteMessage(chatId, msgId);
        } catch (e) {
          logger.warn(`Ошибка удаления сообщения с клавиатурой: ${e.message}`);
        }
      }
      delete timezoneMessages[chatId];
    }
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "settings_timezone") {
    await bot.deleteMessage(chatId, messageId);
    await showTimezoneSelection(chatId);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "settings_auto") {
    await showAutoPostponeSettings(chatId, messageId);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "settings_postpone") {
    await showPostponeSettingsMenu(chatId, messageId);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "settings_morning") {
    await showMorningSettings(chatId, messageId);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "settings_evening") {
    await showEveningSettings(chatId, messageId);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data.startsWith("settings_postpone_option_")) {
    const option = data.replace("settings_postpone_option_", "");
    let settings = await UserSettings.findOne({ userId: chatId.toString() });
    if (!settings) {
      settings = new UserSettings({ userId: chatId.toString(), postponeSettings: [...postponeOptions], selectedPostponeSettings: [] });
    }
    if (!settings.selectedPostponeSettings) settings.selectedPostponeSettings = [];
    if (settings.selectedPostponeSettings.includes(option)) {
      settings.selectedPostponeSettings = settings.selectedPostponeSettings.filter(opt => opt !== option);
    } else {
      settings.selectedPostponeSettings.push(option);
    }
    await settings.save();
    await showPostponeSettingsMenu(chatId, messageId);
    logger.info(`settings: Для пользователя ${chatId} обновлены варианты времени откладывания: ${JSON.stringify(settings.selectedPostponeSettings)}`);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data.startsWith("settings_auto_option_")) {
    const valueStr = data.replace("settings_auto_option_", "");
    const delay = parseInt(valueStr, 10);
    if (isNaN(delay)) {
      await bot.answerCallbackQuery(query.id, { text: "Некорректное значение", show_alert: true });
      return;
    }
    let settings = await UserSettings.findOne({ userId: chatId.toString() });
    if (!settings) {
      settings = new UserSettings({ userId: chatId.toString() });
    }
    settings.autoPostponeDelay = delay;
    await settings.save();
    await bot.editMessageText(`Автооткладывание установлено на ${delay} минут.`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data.startsWith("settings_morning_option_")) {
    const option = data.replace("settings_morning_option_", "");
    let settings = await UserSettings.findOne({ userId: chatId.toString() });
    if (!settings) {
      settings = new UserSettings({ userId: chatId.toString(), morningTime: "9:00" });
    }
    settings.morningTime = option;
    await settings.save();
    await showMorningSettings(chatId, messageId);
    logger.info(`settings: Для пользователя ${chatId} установлено утреннее время: ${option}`);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data.startsWith("settings_evening_option_")) {
    const option = data.replace("settings_evening_option_", "");
    let settings = await UserSettings.findOne({ userId: chatId.toString() });
    if (!settings) {
      settings = new UserSettings({ userId: chatId.toString(), eveningTime: "18:00" });
    }
    settings.eveningTime = option;
    await settings.save();
    await showEveningSettings(chatId, messageId);
    logger.info(`settings: Для пользователя ${chatId} установлено вечернее время: ${option}`);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "settings_morning_ok") {
    await bot.editMessageText("Утреннее время сохранено.", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
    await showSettingsMenu(chatId);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "settings_evening_ok") {
    await bot.editMessageText("Вечернее время сохранено.", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
    await showSettingsMenu(chatId);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "settings_postpone_ok") {
    await bot.editMessageText("Настройка 'Время откладывания' сохранена.", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
    await showSettingsMenu(chatId);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data.startsWith("settings_timezone_utc_")) {
    const offset = parseInt(data.split('_')[3], 10);
    const timezone = `UTC${offset >= 0 ? '+' : ''}${offset}:00`;
    await setUserTimezone(chatId, timezone);
    await bot.editMessageText(`Установлен часовой пояс ${timezone}`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
      parse_mode: "HTML"
    });
    try {
      await bot.sendMessage(chatId, ".", { reply_markup: { remove_keyboard: true } });
    } catch (e) {
      logger.warn(`Ошибка удаления клавиатуры: ${e.message}`);
    }
    await bot.answerCallbackQuery(query.id);
    return;
  }

  await bot.answerCallbackQuery(query.id, { text: "Этот пункт пока не реализован." });
}

async function handleLocation(msg) {
  const chatId = msg.chat.id;
  const location = msg.location;
  if (!location || !location.latitude || !location.longitude) {
    await bot.sendMessage(chatId, "Не удалось обработать геопозицию. Пожалуйста, отправьте корректные координаты.", {
      reply_markup: { remove_keyboard: true }
    });
    return;
  }
  try {
    if (timezoneMessages[chatId]) {
      for (const msgId of timezoneMessages[chatId]) {
        try {
          await bot.deleteMessage(chatId, msgId);
        } catch (e) {
          logger.warn(`Ошибка удаления сообщения с клавиатурой: ${e.message}`);
        }
      }
      delete timezoneMessages[chatId];
    }
    const timezones = geoTz.find(location.latitude, location.longitude);
    if (!timezones || timezones.length === 0) {
      await bot.sendMessage(chatId, "Не удалось определить часовой пояс по вашей геопозиции. Используется дефолтный (Europe/Moscow).", {
        reply_markup: { remove_keyboard: true }
      });
      return;
    }
    const ianaTimezone = timezones[0];
    await setUserTimezone(chatId, ianaTimezone);
    await bot.sendMessage(chatId, `Установлен часовой пояс ${ianaTimezone} на основе вашей геопозиции.`, {
      reply_markup: { remove_keyboard: true }
    });
  } catch (err) {
    logger.error(`handleLocation: Ошибка обработки геопозиции для user ${chatId}: ${err.message}`);
    await bot.sendMessage(chatId, "Произошла ошибка при определении часового пояса. Используется дефолтный (Europe/Moscow).", {
      reply_markup: { remove_keyboard: true }
    });
  }
}

module.exports = {
  showSettingsMenu,
  showPostponeSettingsMenu,
  showTimezoneSelection,
  setUserTimezone,
  getUserTimezone,
  buildUserPostponeKeyboard,
  showAutoPostponeSettings,
  showMorningSettings,
  showEveningSettings,
  handleSettingsCallback,
  handleLocation
};