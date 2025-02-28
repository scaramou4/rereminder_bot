const bot = require('./botInstance');
const logger = require('./logger');
const UserSettings = require('./models/userSettings');
const { DateTime } = require('luxon');
const moment = require('moment-timezone');
const geoTz = require('geo-tz');

// Опции времени откладывания по умолчанию
const postponeOptions = ["1 час", "3 часа", "утро", "вечер", "5 мин", "10 мин", "15 мин", "30 мин", "1 день", "2 дня", "3 дня", "7 дней", "1 неделя", "…"];

// Объект для хранения message_id сообщений с клавиатурами (можно хранить в pendingRequests или UserSettings)
const timezoneMessages = {}; // Ключ — chatId, значение — массив message_id

function showSettingsMenu(chatId) {
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Часовой пояс", callback_data: "settings_timezone" }],
        [{ text: "Время откладывания", callback_data: "settings_postpone" }],
        [{ text: "Автооткладывание", callback_data: "settings_auto" }]
      ]
    }
  };
  bot.sendMessage(chatId, "Выберите параметр для настройки:", keyboard);
}

async function showPostponeSettingsMenu(chatId, messageId = null) {
  let settings = await UserSettings.findOne({ userId: chatId.toString() });
  if (!settings) {
    settings = new UserSettings({
      userId: chatId.toString(),
      postponeSettings: [...postponeOptions],
      selectedPostponeSettings: [...postponeOptions.filter(opt => ["1 час", "3 часа", "утро", "вечер"].includes(opt))]
    });
  }
  // Обеспечиваем наличие всех стандартных опций
  const defaultOptions = [...postponeOptions];
  defaultOptions.forEach(opt => {
    if (!settings.postponeSettings.includes(opt)) {
      settings.postponeSettings.push(opt);
    }
  });
  await settings.save();

  // Формируем кнопки: если опция выбрана, добавляем "✅"
  const buttons = settings.postponeSettings.map(opt => ({
    text: (settings.selectedPostponeSettings.includes(opt) ? "✅ " : "") + opt,
    callback_data: `settings_postpone_option_${opt}`
  }));

  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  // Добавляем кнопки подтверждения и отмены
  rows.push([{ text: "ОК", callback_data: "settings_postpone_ok" }]);
  rows.push([{ text: "Отмена", callback_data: "settings_postpone_cancel" }]);

  const keyboard = { reply_markup: { inline_keyboard: rows } };

  if (messageId) {
    await bot.editMessageText("Выберите варианты времени откладывания (множественный выбор):", { chat_id: chatId, message_id: messageId, ...keyboard });
  } else {
    await bot.sendMessage(chatId, "Выберите варианты времени откладывания (множественный выбор):", keyboard);
  }
}

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

  // Сохраняем message_id обоих сообщений в timezoneMessages
  if (!timezoneMessages[chatId]) {
    timezoneMessages[chatId] = [];
  }
  timezoneMessages[chatId].push(locationMsg.message_id, inlineMsg.message_id);
  logger.info(`showTimezoneSelection: Сохранены message_id ${locationMsg.message_id} и ${inlineMsg.message_id} для user ${chatId}`);
}

async function setUserTimezone(chatId, timezone) {
  let ianaTimezone = timezone;
  if (timezone.startsWith('UTC')) {
    const offset = parseInt(timezone.split('UTC')[1].replace(':', ''));
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

function getUserTimezone(chatId) {
  // Для упрощения возвращаем дефолтный, можно доработать на асинхронное получение
  return 'Europe/Moscow';
}

async function buildUserPostponeKeyboard(userId, reminderId) {
  let settings = await UserSettings.findOne({ userId: userId.toString() });
  if (!settings) {
    settings = new UserSettings({
      userId: userId.toString(),
      postponeSettings: [...postponeOptions],
      selectedPostponeSettings: [...postponeOptions.filter(opt => ["1 час", "3 часа", "утро", "вечер"].includes(opt))]
    });
  }
  const optionMap = {
    "5 мин": "5m", "10 мин": "10m", "15 мин": "15m", "30 мин": "30m",
    "1 час": "1h", "2 часа": "2h", "3 часа": "3h", "4 часа": "4h",
    "1 день": "1d", "2 дня": "2d", "3 дня": "3d", "7 дней": "7d",
    "утро": "am", "вечером": "pm", "1 неделя": "1w", "…": "custom"
  };
  const buttons = settings.postponeSettings.map(opt => ({
    text: opt,
    callback_data: `postpone|${optionMap[opt] || opt}|${reminderId}`
  }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  // Здесь в уведомлениях мы не добавляем кнопки "ОК" и "Отмена"
  return { reply_markup: { inline_keyboard: rows } };
}

async function handleSettingsCallback(query) {
  const chatId = query.message.chat.id;
  const data = query.data;
  const messageId = query.message.message_id;
  logger.info(`settings: Обработка callback: ${data}`);
  
  if (data === "settings_cancel" || data === "settings_postpone_cancel") {
    await bot.editMessageText("Настройка отменена.", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
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
    await bot.answerCallbackQuery(query.id, { text: "Пока не реализовано" });
    return;
  }
  
  if (data === "settings_postpone") {
    await showPostponeSettingsMenu(chatId, messageId);
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
    logger.info(`settings: Для пользователя ${chatId} обновлены выбранные варианты времени откладывания: ${JSON.stringify(settings.selectedPostponeSettings)}`);
    await bot.answerCallbackQuery(query.id);
    return;
  }
  
  if (data === "settings_postpone_ok") {
    // При нажатии "ОК" сохраняем настройки и возвращаемся в главное меню
    await bot.editMessageText("Настройка 'Время откладывания' сохранена.", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
    await showSettingsMenu(chatId);
    await bot.answerCallbackQuery(query.id);
    return;
  }
  
  if (data.startsWith("settings_timezone_utc_")) {
    const offset = parseInt(data.split('_')[3]);
    const timezone = `UTC${offset >= 0 ? '+' : ''}${offset}:00`;
    await setUserTimezone(chatId, timezone);
    await bot.editMessageText(`Установлен часовой пояс ${timezone}`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
      parse_mode: "HTML"
    });
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
      reply_markup: { remove_keyboard: true } // Убираем клавиатуру при ошибке
    });
    return;
  }

  try {
    // Удаляем все сохраненные сообщения с клавиатурами для этого чата
    if (timezoneMessages[chatId]) {
      for (const messageId of timezoneMessages[chatId]) {
        try {
          await bot.deleteMessage(chatId, messageId);
          logger.info(`handleLocation: Удалено сообщение с клавиатурой ${messageId} для user ${chatId}`);
        } catch (deleteErr) {
          logger.error(`handleLocation: Ошибка удаления сообщения ${messageId} для user ${chatId}: ${deleteErr.message}`);
        }
      }
      delete timezoneMessages[chatId]; // Очищаем массив после удаления
    }

    // Используем geo-tz для определения часового пояса по координатам
    const timezones = geoTz.find(location.latitude, location.longitude);
    if (!timezones || timezones.length === 0) {
      await bot.sendMessage(chatId, "Не удалось определить часовой пояс по вашей геопозиции. Используется дефолтный часовой пояс (Europe/Moscow).", {
        reply_markup: { remove_keyboard: true } // Убираем клавиатуру при ошибке
      });
      return;
    }

    const ianaTimezone = timezones[0]; // Берем первый подходящий часовой пояс
    await setUserTimezone(chatId, ianaTimezone);
    await bot.sendMessage(chatId, `Установлен часовой пояс ${ianaTimezone} на основе вашей геопозиции.`, {
      reply_markup: { remove_keyboard: true } // Убираем все клавиатуры после успешной установки
    });
  } catch (err) {
    logger.error(`handleLocation: Ошибка обработки геопозиции для user ${chatId}: ${err.message}`);
    await bot.sendMessage(chatId, "Произошла ошибка при определении часового пояса. Используется дефолтный часовой пояс (Europe/Moscow).", {
      reply_markup: { remove_keyboard: true } // Убираем клавиатуру при ошибке
    });
  }
}

module.exports = {
  showSettingsMenu,
  showPostponeSettingsMenu,
  showTimezoneSelection,
  setUserTimezone,
  getUserTimezone,
  handleSettingsCallback,
  buildUserPostponeKeyboard,
  handleLocation // Экспорт функции
};