// settings.js
const bot = require('./botInstance');
const logger = require('./logger');
const UserSettings = require('./models/userSettings');
const { DateTime } = require('luxon');
const geoTz = require('geo-tz');
const { throttle } = require('lodash');

// Опции времени откладывания
const POSTPONE_OPTIONS = [
  "5 мин", "10 мин", "15 мин", "20 мин", "30 мин",
  "1 час", "2 часа", "3 часа", "4 часа",
  "1 день", "2 дня", "3 дня", "7 дней",
  "утро", "вечер", "…"
];

// Опции автооткладывания
const AUTO_POSTPONE_OPTIONS = ["5 мин", "10 мин", "15 мин", "20 мин", "30 мин", "45 мин", "60 мин"];

// Временные зоны для выбора
const TIMEZONE_OFFSETS = Array.from({ length: 25 }, (_, i) => i - 12);

// Кэш сообщений с настройками
const settingsMessagesCache = new Map();

/**
 * Показывает главное меню настроек
 * @param {Number} chatId - ID чата
 */
async function showSettingsMenu(chatId) {
  try {
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "⏰ Часовой пояс", callback_data: "settings_timezone" }],
          [{ text: "⏳ Время откладывания", callback_data: "settings_postpone" }],
          [{ text: "🔄 Автооткладывание", callback_data: "settings_auto" }],
          [
            { text: "🌅 Утро", callback_data: "settings_morning" },
            { text: "🌇 Вечер", callback_data: "settings_evening" }
          ]
        ]
      }
    };

    const message = await bot.sendMessage(
      chatId, 
      "⚙️ Выберите параметр для настройки:",
      keyboard
    );

    // Сохраняем ID сообщения для возможного обновления
    settingsMessagesCache.set(chatId, message.message_id);
  } catch (error) {
    logger.error(`Ошибка отображения меню настроек: ${error.message}`);
    throw error;
  }
}

/**
 * Показывает настройки времени откладывания
 * @param {Number} chatId - ID чата
 * @param {Number} [messageId] - ID сообщения для редактирования
 */
async function showPostponeSettingsMenu(chatId, messageId = null) {
  try {
    let settings = await UserSettings.findOne({ userId: chatId.toString() });
    
    if (!settings) {
      settings = new UserSettings({
        userId: chatId.toString(),
        postponeSettings: [...POSTPONE_OPTIONS],
        selectedPostponeSettings: ["30 мин", "1 час", "3 часа", "утро", "вечер", "…"]
      });
      await settings.save();
    }

    // Обновляем список всех возможных опций
    const allOptions = [...new Set([...POSTPONE_OPTIONS, ...settings.postponeSettings])];
    settings.postponeSettings = allOptions;
    await settings.save();

    // Создаем кнопки для всех опций
    const buttons = allOptions.map(opt => ({
      text: `${settings.selectedPostponeSettings.includes(opt) ? '✅ ' : ''}${opt}`,
      callback_data: `settings_postpone_option_${opt}`
    }));

    // Группируем кнопки по 3 в ряд
    const rows = [];
    for (let i = 0; i < buttons.length; i += 3) {
      rows.push(buttons.slice(i, i + 3));
    }

    // Добавляем кнопки подтверждения
    rows.push([
      { text: "✔️ Сохранить", callback_data: "settings_postpone_ok" },
      { text: "❌ Отмена", callback_data: "settings_postpone_cancel" }
    ]);

    const keyboard = { reply_markup: { inline_keyboard: rows } };
    const text = "Выберите варианты времени откладывания (отмеченные ✅ будут показаны):";

    if (messageId) {
      await bot.editMessageText(text, { 
        chat_id: chatId, 
        message_id: messageId, 
        ...keyboard 
      });
    } else {
      const message = await bot.sendMessage(chatId, text, keyboard);
      settingsMessagesCache.set(chatId, message.message_id);
    }
  } catch (error) {
    logger.error(`Ошибка отображения настроек откладывания: ${error.message}`);
    throw error;
  }
}

/**
 * Показывает настройки автооткладывания
 * @param {Number} chatId - ID чата
 * @param {Number} [messageId] - ID сообщения для редактирования
 */
async function showAutoPostponeSettings(chatId, messageId = null) {
  try {
    let settings = await UserSettings.findOne({ userId: chatId.toString() });
    
    if (!settings) {
      settings = new UserSettings({ userId: chatId.toString(), autoPostponeDelay: 15 });
      await settings.save();
    }

    const currentDelay = settings.autoPostponeDelay;
    const buttons = AUTO_POSTPONE_OPTIONS.map(opt => {
      const minutes = parseInt(opt);
      return {
        text: `${minutes === currentDelay ? '✅ ' : ''}${opt}`,
        callback_data: `settings_auto_option_${minutes}`
      };
    });

    // Группируем кнопки по 3 в ряд
    const rows = [];
    for (let i = 0; i < buttons.length; i += 3) {
      rows.push(buttons.slice(i, i + 3));
    }

    // Добавляем кнопку отмены
    rows.push([{ text: "❌ Отмена", callback_data: "settings_auto_cancel" }]);

    const keyboard = { reply_markup: { inline_keyboard: rows } };
    const text = "⏳ Выберите время автооткладывания (в минутах):";

    if (messageId) {
      await bot.editMessageText(text, { 
        chat_id: chatId, 
        message_id: messageId, 
        ...keyboard 
      });
    } else {
      const message = await bot.sendMessage(chatId, text, keyboard);
      settingsMessagesCache.set(chatId, message.message_id);
    }
  } catch (error) {
    logger.error(`Ошибка отображения настроек автооткладывания: ${error.message}`);
    throw error;
  }
}

/**
 * Показывает настройки утреннего времени
 * @param {Number} chatId - ID чата
 * @param {Number} [messageId] - ID сообщения для редактирования
 */
async function showMorningSettings(chatId, messageId = null) {
  try {
    let settings = await UserSettings.findOne({ userId: chatId.toString() });
    
    if (!settings) {
      settings = new UserSettings({ userId: chatId.toString(), morningTime: "9:00" });
      await settings.save();
    }

    const morningOptions = ["6:00", "7:00", "8:00", "9:00", "10:00", "11:00"];
    const buttons = morningOptions.map(opt => ({
      text: `${settings.morningTime === opt ? '✅ ' : ''}${opt}`,
      callback_data: `settings_morning_option_${opt}`
    }));

    const rows = [
      buttons.slice(0, 3),
      buttons.slice(3, 6),
      [
        { text: "✔️ Сохранить", callback_data: "settings_morning_ok" },
        { text: "❌ Отмена", callback_data: "settings_morning_cancel" }
      ]
    ];

    const keyboard = { reply_markup: { inline_keyboard: rows } };
    const text = "🌅 Выберите время для утренних напоминаний:";

    if (messageId) {
      await bot.editMessageText(text, { 
        chat_id: chatId, 
        message_id: messageId, 
        ...keyboard 
      });
    } else {
      const message = await bot.sendMessage(chatId, text, keyboard);
      settingsMessagesCache.set(chatId, message.message_id);
    }
  } catch (error) {
    logger.error(`Ошибка отображения утренних настроек: ${error.message}`);
    throw error;
  }
}

/**
 * Показывает настройки вечернего времени
 * @param {Number} chatId - ID чата
 * @param {Number} [messageId] - ID сообщения для редактирования
 */
async function showEveningSettings(chatId, messageId = null) {
  try {
    let settings = await UserSettings.findOne({ userId: chatId.toString() });
    
    if (!settings) {
      settings = new UserSettings({ userId: chatId.toString(), eveningTime: "18:00" });
      await settings.save();
    }

    const eveningOptions = ["17:00", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00"];
    const buttons = eveningOptions.map(opt => ({
      text: `${settings.eveningTime === opt ? '✅ ' : ''}${opt}`,
      callback_data: `settings_evening_option_${opt}`
    }));

    const rows = [
      buttons.slice(0, 4),
      buttons.slice(4),
      [
        { text: "✔️ Сохранить", callback_data: "settings_evening_ok" },
        { text: "❌ Отмена", callback_data: "settings_evening_cancel" }
      ]
    ];

    const keyboard = { reply_markup: { inline_keyboard: rows } };
    const text = "🌇 Выберите время для вечерних напоминаний:";

    if (messageId) {
      await bot.editMessageText(text, { 
        chat_id: chatId, 
        message_id: messageId, 
        ...keyboard 
      });
    } else {
      const message = await bot.sendMessage(chatId, text, keyboard);
      settingsMessagesCache.set(chatId, message.message_id);
    }
  } catch (error) {
    logger.error(`Ошибка отображения вечерних настроек: ${error.message}`);
    throw error;
  }
}

/**
 * Показывает выбор часового пояса
 * @param {Number} chatId - ID чата
 */
async function showTimezoneSelection(chatId) {
  try {
    // Отправляем запрос на геолокацию
    const locationMsg = await bot.sendMessage(
      chatId,
      "📍 Для автоматического определения часового пояса отправьте свою геопозицию (кнопка ниже) " +
      "или выберите часовой пояс вручную:",
      {
        reply_markup: {
          keyboard: [[{ text: "📍 Отправить геопозицию", request_location: true }]],
          resize_keyboard: true,
          one_time_keyboard: true
        }
      }
    );

    // Создаем кнопки для выбора часового пояса вручную
    const buttons = TIMEZONE_OFFSETS.map(offset => ({
      text: `UTC${offset >= 0 ? '+' : ''}${offset}`,
      callback_data: `settings_timezone_utc_${offset}`
    }));

    // Группируем кнопки по 4 в ряд
    const rows = [];
    for (let i = 0; i < buttons.length; i += 4) {
      rows.push(buttons.slice(i, i + 4));
    }

    // Добавляем кнопку отмены
    rows.push([{ text: "❌ Отмена", callback_data: "settings_cancel" }]);

    const inlineKeyboard = { reply_markup: { inline_keyboard: rows } };
    const inlineMsg = await bot.sendMessage(
      chatId, 
      "⏰ Выберите ваш часовой пояс (UTC):",
      inlineKeyboard
    );

    // Сохраняем ID сообщений для последующего удаления
    if (!settingsMessagesCache.has(chatId)) {
      settingsMessagesCache.set(chatId, []);
    }
    
    settingsMessagesCache.get(chatId).push(
      locationMsg.message_id,
      inlineMsg.message_id
    );
  } catch (error) {
    logger.error(`Ошибка отображения выбора часового пояса: ${error.message}`);
    throw error;
  }
}

/**
 * Устанавливает часовой пояс пользователя
 * @param {Number} chatId - ID чата
 * @param {String} timezone - Название часового пояса
 */
async function setUserTimezone(chatId, timezone) {
  try {
    let ianaTimezone = timezone;
    
    // Если передан UTC offset, преобразуем в IANA timezone
    if (timezone.startsWith('UTC')) {
      const offset = parseInt(timezone.replace('UTC', ''));
      const possibleTimezones = geoTz.find(0, offset * 15); // Примерные координаты для offset
      ianaTimezone = possibleTimezones[0] || 'Europe/Moscow';
    }

    let settings = await UserSettings.findOne({ userId: chatId.toString() });
    
    if (!settings) {
      settings = new UserSettings({ userId: chatId.toString() });
    }
    
    settings.timezone = ianaTimezone;
    await settings.save();
    
    logger.info(`Установлен часовой пояс ${ianaTimezone} для user ${chatId}`);
    
    // Отправляем подтверждение
    await bot.sendMessage(
      chatId,
      `⏰ Часовой пояс установлен: ${ianaTimezone}`,
      { reply_markup: { remove_keyboard: true } }
    );
  } catch (error) {
    logger.error(`Ошибка установки часового пояса: ${error.message}`);
    throw error;
  }
}

/**
 * Получает часовой пояс пользователя
 * @param {Number} chatId - ID чата
 * @returns {String} Название часового пояса
 */
async function getUserTimezone(chatId) {
  try {
    const settings = await UserSettings.findOne({ userId: chatId.toString() });
    return settings?.timezone || 'Europe/Moscow';
  } catch (error) {
    logger.error(`Ошибка получения часового пояса: ${error.message}`);
    return 'Europe/Moscow';
  }
}

/**
 * Строит клавиатуру для откладывания напоминаний
 * @param {String} userId - ID пользователя
 * @param {String} reminderId - ID напоминания
 * @param {Boolean} forNotification - Для уведомления
 * @returns {Object} Объект клавиатуры
 */
async function buildUserPostponeKeyboard(userId, reminderId, forNotification = false) {
  try {
    let settings = await UserSettings.findOne({ userId: userId.toString() });
    
    if (!settings) {
      settings = new UserSettings({
        userId: userId.toString(),
        postponeSettings: [...POSTPONE_OPTIONS],
        selectedPostponeSettings: ["5 мин", "10 мин", "15 мин", "30 мин", "1 час", "3 часа", "утро", "вечер", "…"]
      });
    }

    const activeOptions = POSTPONE_OPTIONS.filter(opt => 
      settings.selectedPostponeSettings.includes(opt)
    );

    const optionMap = {
      "5 мин": "5m", "10 мин": "10m", "15 мин": "15m", "20 мин": "20m", "30 мин": "30m",
      "1 час": "1h", "2 часа": "2h", "3 часа": "3h", "4 часа": "4h",
      "1 день": "1d", "2 дня": "2d", "3 дня": "3d", "7 дней": "7d",
      "утро": "am", "вечер": "pm", "…": "custom"
    };

    const buttons = activeOptions.map(opt => ({
      text: opt,
      callback_data: `postpone|${optionMap[opt] || opt}|${reminderId}`
    }));

    // Группируем кнопки по 3 в ряд
    const rows = [];
    for (let i = 0; i < buttons.length; i += 3) {
      rows.push(buttons.slice(i, i + 3));
    }

    // Добавляем кнопку "Готово" для уведомлений
    if (forNotification) {
      rows.push([{ text: "✅ Готово", callback_data: `done|${reminderId}` }]);
    }

    return { reply_markup: { inline_keyboard: rows } };
  } catch (error) {
    logger.error(`Ошибка создания клавиатуры откладывания: ${error.message}`);
    return { reply_markup: { inline_keyboard: [] } };
  }
}

/**
 * Обрабатывает callback-запросы настроек
 * @param {Object} query - Объект callback-запроса
 */
const handleSettingsCallback = throttle(async (query) => {
  try {
    const chatId = query.message.chat.id;
    const data = query.data;
    const messageId = query.message.message_id;

    logger.info(`Обработка callback настроек: ${data}`);

    // Обработка отмены
    if (data.endsWith("_cancel")) {
      try {
        await bot.editMessageText("❌ Настройка отменена", {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [] }
        });
      } catch (error) {
        logger.warn(`Ошибка при отмене настройки: ${error.message}`);
      }

      // Удаляем дополнительные сообщения (например, запрос геолокации)
      if (settingsMessagesCache.has(chatId)) {
        const messages = settingsMessagesCache.get(chatId);
        
        if (Array.isArray(messages)) {
          for (const msgId of messages) {
            try {
              if (msgId !== messageId) {
                await bot.deleteMessage(chatId, msgId);
              }
            } catch (error) {
              logger.warn(`Ошибка удаления сообщения: ${error.message}`);
            }
          }
        }
        
        settingsMessagesCache.delete(chatId);
      }

      await bot.answerCallbackQuery(query.id);
      return;
    }

    // Обработка выбора часового пояса
    if (data.startsWith("settings_timezone_utc_")) {
      const offset = parseInt(data.split('_')[3], 10);
      const timezone = `UTC${offset >= 0 ? '+' : ''}${offset}`;
      
      await setUserTimezone(chatId, timezone);
      
      await bot.editMessageText(`⏰ Установлен часовой пояс ${timezone}`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      });

      // Удаляем сообщение с запросом геолокации
      if (settingsMessagesCache.has(chatId)) {
        const messages = settingsMessagesCache.get(chatId);
        
        if (Array.isArray(messages)) {
          for (const msgId of messages) {
            try {
              if (msgId !== messageId) {
                await bot.deleteMessage(chatId, msgId);
              }
            } catch (error) {
              logger.warn(`Ошибка удаления сообщения: ${error.message}`);
            }
          }
        }
        
        settingsMessagesCache.delete(chatId);
      }

      await bot.answerCallbackQuery(query.id);
      return;
    }

    // Обработка выбора времени откладывания
    if (data.startsWith("settings_postpone_option_")) {
      const option = data.replace("settings_postpone_option_", "");
      let settings = await UserSettings.findOne({ userId: chatId.toString() });
      
      if (!settings) {
        settings = new UserSettings({ userId: chatId.toString() });
      }

      if (!settings.selectedPostponeSettings) {
        settings.selectedPostponeSettings = [];
      }

      // Переключаем состояние опции
      if (settings.selectedPostponeSettings.includes(option)) {
        settings.selectedPostponeSettings = settings.selectedPostponeSettings.filter(
          opt => opt !== option
        );
      } else {
        settings.selectedPostponeSettings.push(option);
      }

      await settings.save();
      await showPostponeSettingsMenu(chatId, messageId);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    // Обработка выбора автооткладывания
    if (data.startsWith("settings_auto_option_")) {
      const minutes = parseInt(data.replace("settings_auto_option_", ""), 10);
      
      if (isNaN(minutes)) {
        await bot.answerCallbackQuery(query.id, {
          text: "Некорректное значение",
          show_alert: true
        });
        return;
      }

      let settings = await UserSettings.findOne({ userId: chatId.toString() });
      
      if (!settings) {
        settings = new UserSettings({ userId: chatId.toString() });
      }

      settings.autoPostponeDelay = minutes;
      await settings.save();
      
      await bot.editMessageText(`🔄 Автооткладывание установлено на ${minutes} минут`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      });
      
      await bot.answerCallbackQuery(query.id);
      return;
    }

    // Обработка выбора утреннего времени
    if (data.startsWith("settings_morning_option_")) {
      const time = data.replace("settings_morning_option_", "");
      let settings = await UserSettings.findOne({ userId: chatId.toString() });
      
      if (!settings) {
        settings = new UserSettings({ userId: chatId.toString() });
      }

      settings.morningTime = time;
      await settings.save();
      await showMorningSettings(chatId, messageId);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    // Обработка выбора вечернего времени
    if (data.startsWith("settings_evening_option_")) {
      const time = data.replace("settings_evening_option_", "");
      let settings = await UserSettings.findOne({ userId: chatId.toString() });
      
      if (!settings) {
        settings = new UserSettings({ userId: chatId.toString() });
      }

      settings.eveningTime = time;
      await settings.save();
      await showEveningSettings(chatId, messageId);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    // Обработка сохранения настроек
    if (data.endsWith("_ok")) {
      let message;
      
      if (data.startsWith("settings_postpone")) {
        message = "⏳ Настройки времени откладывания сохранены";
      } else if (data.startsWith("settings_morning")) {
        message = "🌅 Утреннее время сохранено";
      } else if (data.startsWith("settings_evening")) {
        message = "🌇 Вечернее время сохранено";
      } else {
        message = "Настройки сохранены";
      }

      await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      });
      
      await showSettingsMenu(chatId);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    // Обработка основных действий
    switch (data) {
      case "settings_timezone":
        await bot.deleteMessage(chatId, messageId);
        await showTimezoneSelection(chatId);
        break;
        
      case "settings_postpone":
        await showPostponeSettingsMenu(chatId, messageId);
        break;
        
      case "settings_auto":
        await showAutoPostponeSettings(chatId, messageId);
        break;
        
      case "settings_morning":
        await showMorningSettings(chatId, messageId);
        break;
        
      case "settings_evening":
        await showEveningSettings(chatId, messageId);
        break;
        
      default:
        await bot.answerCallbackQuery(query.id, {
          text: "Этот пункт пока не реализован"
        });
        return;
    }

    await bot.answerCallbackQuery(query.id);
  } catch (error) {
    logger.error(`Ошибка обработки callback настроек: ${error.message}`);
    
    try {
      await bot.answerCallbackQuery(query.id, {
        text: "Произошла ошибка при обработке запроса",
        show_alert: true
      });
    } catch (err) {
      logger.error(`Ошибка отправки ответа callback: ${err.message}`);
    }
  }
}, 500);

/**
 * Обрабатывает получение геолокации
 * @param {Object} msg - Объект сообщения с геолокацией
 */
async function handleLocation(msg) {
  const chatId = msg.chat.id;
  
  try {
    if (!msg.location || !msg.location.latitude || !msg.location.longitude) {
      await bot.sendMessage(
        chatId, 
        "❌ Не удалось обработать геопозицию. Пожалуйста, отправьте корректные координаты.",
        { reply_markup: { remove_keyboard: true } }
      );
      return;
    }

    // Удаляем предыдущие сообщения с настройками
    if (settingsMessagesCache.has(chatId)) {
      const messages = settingsMessagesCache.get(chatId);
      
      if (Array.isArray(messages)) {
        for (const msgId of messages) {
          try {
            await bot.deleteMessage(chatId, msgId);
          } catch (error) {
            logger.warn(`Ошибка удаления сообщения: ${error.message}`);
          }
        }
      }
      
      settingsMessagesCache.delete(chatId);
    }

    // Определяем часовой пояс по координатам
    const timezones = geoTz.find(msg.location.latitude, msg.location.longitude);
    
    if (!timezones || timezones.length === 0) {
      await bot.sendMessage(
        chatId,
        "❌ Не удалось определить часовой пояс по вашей геопозиции. Используется Europe/Moscow.",
        { reply_markup: { remove_keyboard: true } }
      );
      return;
    }

    const ianaTimezone = timezones[0];
    await setUserTimezone(chatId, ianaTimezone);
  } catch (error) {
    logger.error(`Ошибка обработки геолокации: ${error.message}`);
    
    await bot.sendMessage(
      chatId,
      "❌ Произошла ошибка при определении часового пояса. Используется Europe/Moscow.",
      { reply_markup: { remove_keyboard: true } }
    );
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