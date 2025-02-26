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
    'пятница': 'пятницу',
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
      const description = msg.text;
      delete pendingRequests.pendingReminders[chatId];
      const reminder = await createReminder(chatId, description, pending.datetime, pending.repeat);
      await scheduleReminder(reminder);
      const eventDate = reminder.repeat ? (reminder.nextReminder || reminder.datetime) : reminder.datetime;
      const formattedDate = new Date(eventDate).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
      const confirmationText = `✅ Напоминание сохранено:
  
📌 ${description}
🕒 ${formattedDate}
🔁 Повтор: ${formatRepeatPhrase(pending.repeat)}`;
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
    const { datetime: parsedDate, reminderText: description, timeSpec, repeat } = parseReminder(textNormalized);
    logger.info(`Результат парсинга: ${JSON.stringify({ timeSpec, reminderText: description, repeat, datetime: parsedDate })}`);
    if (!parsedDate) {
      await bot.sendMessage(chatId, "Сорри, не смог распознать. Попробуйте в формате, например, 'в 17 ужин', 'в 1015 уборка', 'сегодня в 17 тест', 'завтра в 17 ужин' или 'через 10 минут тест'.");
      return;
    }
    
    if (parsedDate && !description) {
      pendingRequests.pendingReminders[chatId] = { datetime: parsedDate, repeat };
      await bot.sendMessage(chatId, 'Пожалуйста, введите текст напоминания:');
      return;
    }
    
    const reminder = await createReminder(chatId, description, parsedDate, repeat);
    await scheduleReminder(reminder);
    const eventDate = reminder.repeat ? (reminder.nextReminder || reminder.datetime) : reminder.datetime;
    const formattedDate = new Date(eventDate).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
    const confirmationText = `✅ Напоминание сохранено:
  
📌 ${description}
🕒 ${formattedDate}
🔁 Повтор: ${formatRepeatPhrase(repeat)}`;
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

logger.info('Бот запущен');