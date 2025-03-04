require('dotenv').config();

const bot = require('./src/botInstance');
const { parseReminder } = require('./src/dateParser');
const { createReminder, sendReminder, deleteAllReminders, Reminder, handleCallback } = require('./src/reminderScheduler');
const listManager = require('./src/listManager');
const timeSpecParser = require('./src/timeSpecParser');
const pendingRequests = require('./src/pendingRequests');
const logger = require('./src/logger');
const { DateTime } = require('luxon');
const { agenda, scheduleReminder } = require('./src/agendaScheduler');
const settings = require('./src/settings');

// Запуск Agenda
(async function() {
  await agenda.start();
  logger.info('Agenda запущен');
})();

function formatRepeatPhrase(repeat) {
  if (!repeat) return 'нет';
  const feminineAccusativeMap = {
    'минута': 'минуту',
    'неделя': 'неделю',
    'среда': 'среду',
    'пятница': 'пятница',
    'суббота': 'субботу'
  };
  const neutral = ['воскресенье'];
  const parts = repeat.split(' ');
  if (parts.length === 1) {
    let unit = parts[0];
    if (feminineAccusativeMap[unit]) {
      return `каждую ${feminineAccusativeMap[unit]}`;
    } else if (neutral.includes(unit)) {
      return `каждое ${unit}`;
    } else {
      return `каждый ${unit}`;
    }
  } else {
    const multiplier = parts[0];
    const unit = parts.slice(1).join(' ');
    return `каждые ${multiplier} ${unit}`;
  }
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `Привет! Я бот-напоминалка.
  
Ты можешь создавать напоминания, просто отправляя сообщение в формате:
"через 10 минут купить молоко"

Доступные команды:
/start - информация
/list - список уведомлений
/deleteall - удалить все уведомления
/settings - настройки бота`;
  bot.sendMessage(chatId, welcomeMessage);
});

bot.onText(/\/settings/, (msg) => {
  const chatId = msg.chat.id;
  settings.showSettingsMenu(chatId);
});

bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  await listManager.sendPaginatedList(chatId, 0, false);
});

bot.onText(/\/deleteall/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await deleteAllReminders(chatId);
    bot.sendMessage(chatId, 'Все уведомления удалены.');
  } catch (error) {
    logger.error(`Ошибка удаления уведомлений: ${error.message}`);
    bot.sendMessage(chatId, 'Ошибка при удалении уведомлений.');
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Проверяем, является ли сообщение текстовым
  if (msg.text) {
    if (msg.text.startsWith('/')) return;

    if (pendingRequests.pendingReminders[chatId]) {
      const pending = pendingRequests.pendingReminders[chatId];
      const description = msg.text.trim();
      if (!description) {
        await bot.sendMessage(chatId, 'Пожалуйста, введите текст напоминания (не может быть пустым):');
        return;
      }
      delete pendingRequests.pendingReminders[chatId];
      const reminder = await createReminder(chatId, description, pending.datetime, pending.repeat);
      await scheduleReminder(reminder);
      const eventDate = reminder.repeat ? (reminder.nextReminder || reminder.datetime) : reminder.datetime;
      const formattedDate = DateTime.fromJSDate(eventDate).setZone('Europe/Moscow').setLocale('ru').toFormat('HH:mm, d MMMM yyyy');
      const confirmationText = `✅ Напоминание сохранено:\n\n📌 ${description}\n🕒 ${formattedDate}\n🔁 Повтор: ${formatRepeatPhrase(pending.repeat)}`;
      await bot.sendMessage(chatId, confirmationText);
      return;
    }
    
    if (pendingRequests.pendingPostpone[chatId]) {
      const { reminderId, messageId } = pendingRequests.pendingPostpone[chatId];
      delete pendingRequests.pendingPostpone[chatId];
      const parsed = timeSpecParser.parseTimeSpec(msg.text);
      if (!parsed.datetime) {
        await bot.sendMessage(chatId, "Сорри, не смог распознать. Попробуйте в формате, например, '10 минут', '5 мин', 'завтра в 10' или 'сегодня в 17'.");
        return;
      }
      const newDateTime = parsed.datetime;
      const reminder = await Reminder.findById(reminderId);
      if (!reminder) {
        await bot.sendMessage(chatId, 'Напоминание не найдено.');
        return;
      }
      reminder.datetime = newDateTime;
      reminder.messageIds = [];
      await reminder.save();
      const formattedNewTime = DateTime.fromJSDate(newDateTime).toFormat('HH:mm');
      await bot.editMessageText(`🔔 Отложено: ${reminder.description}`, { 
        chat_id: chatId, 
        message_id: messageId, 
        reply_markup: { inline_keyboard: [] }, 
        parse_mode: "HTML" 
      });
      await bot.sendMessage(chatId, `🔔 Повторно: ${reminder.description}\n🕒 Новое время: ${formattedNewTime}`, { parse_mode: "HTML" });
      await scheduleReminder(reminder);
      return;
    }

    const textNormalized = msg.text.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
    logger.info(`Получено сообщение от user ${chatId}: "${textNormalized}"`);
    const parseResult = parseReminder(textNormalized);
    logger.info(`Результат парсинга: ${JSON.stringify(parseResult)}`);
    if (parseResult.error) {
      let errorMessage = "Сорри, не смог распознать. Попробуйте в формате, например, 'в 17 ужин', 'в 1015 уборка', 'сегодня в 17 тест', 'завтра в 17 ужин' или 'через 10 минут тест'.";
      if (parseResult.error === 'Некорректный месяц') {
        errorMessage = "Сорри, не смог распознать месяц. Используйте, например, 'января', 'февраля', 'марта' и т.д.";
      } else if (parseResult.error === 'Недопустимое время (часы должны быть 0–23, минуты 0–59)') {
        errorMessage = "Сорри, время должно быть в формате 0–23 часов и 0–59 минут. Исправьте, пожалуйста.";
      } else if (parseResult.error === 'Длительность должна быть положительной') {
        errorMessage = "Сорри, длительность должна быть положительным числом. Исправьте, пожалуйста.";
      } else if (parseResult.error === 'Недопустимая единица повторения') {
        errorMessage = "Сорри, недопустимая единица повторения. Используйте 'минута', 'час', 'день', 'неделя', 'месяц' или 'год'.";
      } else if (parseResult.error === 'Недопустимый день недели') {
        errorMessage = "Сорри, недопустимый день недели. Используйте 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота' или 'воскресенье'.";
      }
      await bot.sendMessage(chatId, errorMessage);
      return;
    }
    
    if (!parseResult.datetime) {
      if (parseResult.timeSpec && !parseResult.reminderText) {
        // Обработка неполных запросов, таких как "через 5 минут" или "10 минут"
        pendingRequests.pendingReminders[chatId] = { datetime: null, repeat: parseResult.repeat, timeSpec: parseResult.timeSpec };
        await bot.sendMessage(chatId, 'Пожалуйста, введите текст напоминания:');
        return;
      }
      await bot.sendMessage(chatId, "Сорри, не смог распознать. Попробуйте в формате, например, 'в 17 ужин', 'в 1015 уборка', 'сегодня в 17 тест', 'завтра в 17 ужин' или 'через 10 минут тест'.");
      return;
    }
    
    if (parseResult.datetime && !parseResult.reminderText) {
      pendingRequests.pendingReminders[chatId] = { datetime: parseResult.datetime, repeat: parseResult.repeat };
      await bot.sendMessage(chatId, 'Пожалуйста, введите текст напоминания:');
      return;
    }
    
    const reminder = await createReminder(chatId, parseResult.reminderText, parseResult.datetime, parseResult.repeat);
    await scheduleReminder(reminder);
    const eventDate = reminder.repeat ? (reminder.nextReminder || reminder.datetime) : reminder.datetime;
    const formattedDate = DateTime.fromJSDate(eventDate).setZone('Europe/Moscow').setLocale('ru').toFormat('HH:mm, d MMMM yyyy');
    const confirmationText = `✅ Напоминание сохранено:\n\n📌 ${parseResult.reminderText}\n🕒 ${formattedDate}\n🔁 Повтор: ${formatRepeatPhrase(parseResult.repeat)}`;
    await bot.sendMessage(chatId, confirmationText);
  } else {
    logger.info(`index: Получено не текстовое сообщение от user ${chatId}: ${JSON.stringify(msg)}`);
  }
});

bot.on('callback_query', async (query) => {
  if (query.data.startsWith("list_")) {
    await listManager.handleListCallback(query);
  } else if (query.data.startsWith("settings_")) {
    await settings.handleSettingsCallback(query);
  } else {
    await handleCallback(query);
  }
});

bot.on('location', (msg) => {
  settings.handleLocation(msg);
});

bot.onText(/\/myid/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `Ваш user ID: ${chatId}`);
});

logger.info('Бот запущен');