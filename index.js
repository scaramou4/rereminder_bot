require('dotenv').config();
const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const logger = require('./src/logger');
const bot = require('./src/botInstance');
const { parseReminderText, extractRepeatPattern } = require('./src/dateParser');
require('./src/reminderScheduler');

mongoose.connect('mongodb://127.0.0.1:27017/reminderBot');

const reminderSchema = new mongoose.Schema({
  userId: String,
  description: String,
  datetime: Date,
  repeat: String,
  lastNotified: Date,
});
const Reminder = mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema);

// Глобальные состояния для управления режимами
const userState = {};             // для команды /list (пагинация, навигация)
const postponeCustomState = {};   // для произвольного переноса ("...")
const clearListState = {};        // для команды /clearlist

function formatTime(date) {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatFullDate(date) {
  const d = new Date(date);
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} (${formatTime(date)})`;
}
function formatDate(date) {
  return formatFullDate(date);
}

function getRepeatDisplay(text) {
  if (/каждый(?:\s+\d+)?\s+час/i.test(text)) return 'каждый час';
  if (/каждый день/i.test(text)) return 'каждый день';
  if (/каждую неделю/i.test(text)) return 'каждую неделю';
  if (/каждый месяц/i.test(text)) return 'каждый месяц';
  if (/каждый год/i.test(text)) return 'каждый год';
  return 'нет';
}

function sendRemindersPage(chatId, userId) {
  const state = userState[userId];
  if (!state) return;
  
  state.reminders.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  const reminders = state.reminders;
  const page = state.page;
  const pageSize = 10;
  const start = page * pageSize;
  const pageReminders = reminders.slice(start, start + pageSize);
  if (pageReminders.length === 0) {
    bot.sendMessage(chatId, 'Нет активных напоминаний.');
    delete userState[userId];
    logger.info(`User ${userId}: No active reminders.`);
    return;
  }
  
  let message = '📝 <b>Ваши активные напоминания:</b>\n\n';
  pageReminders.forEach((reminder, index) => {
    const num = start + index + 1; // глобальный номер
    const formattedTime = formatFullDate(reminder.datetime);
    const repeatText = reminder.repeat ? `♾ <i>${reminder.repeat}</i>\n` : '';
    message += `${num}) ⌚️ ${formattedTime}\n${repeatText}〰️ ${reminder.description}\n\n`;
  });
  
  const totalPages = Math.ceil(reminders.length / pageSize);
  const navButtons = [];
  if (page > 0) navButtons.push({ text: '◀ Назад', callback_data: 'prev_page' });
  if (page < totalPages - 1) navButtons.push({ text: 'Вперёд ▶', callback_data: 'next_page' });
  const extraButtons = [
    { text: '⏪ В начало', callback_data: 'first_page' },
    { text: '⏩ В конец', callback_data: 'last_page' },
    { text: '🗑 Удалить', callback_data: 'delete_reminder' }
  ];
  const keyboard = { inline_keyboard: [navButtons, extraButtons] };
  
  if (!state.messageId) {
    bot.sendMessage(chatId, message, { parse_mode: "HTML", reply_markup: keyboard })
      .then(sentMessage => {
        state.messageId = sentMessage.message_id;
        logger.info(`Sent reminders list to user ${userId}, message ID: ${sentMessage.message_id}`);
      })
      .catch(err => logger.error(`Error sending reminders list to user ${userId}: ${err.message}`));
  } else {
    bot.editMessageText(message, { chat_id: chatId, message_id: state.messageId, parse_mode: "HTML", reply_markup: keyboard })
      .catch(err => {
        if (err.response?.body?.description?.toLowerCase().includes('message is not modified')) {
          // Игнорируем
        } else {
          logger.error(`Error editing reminders list for user ${userId}: ${err.message}`);
        }
      });
  }
}

function showDeleteButtons(chatId, userId) {
  const state = userState[userId];
  if (!state) return;
  const pageSize = 10;
  const start = state.page * pageSize;
  const pageReminders = state.reminders.slice(start, start + pageSize);
  if (pageReminders.length === 0) {
    return bot.sendMessage(chatId, 'На этой странице нет напоминаний для удаления.');
  }
  const buttons = [];
  let row = [];
  pageReminders.forEach((_, idx) => {
    const globalNumber = start + idx + 1; // глобальный номер
    row.push({ text: String(globalNumber), callback_data: `del_${globalNumber}` });
    if (row.length === 5) {
      buttons.push(row);
      row = [];
    }
  });
  if (row.length > 0) buttons.push(row);
  buttons.push([{ text: '❌ Отмена', callback_data: 'cancel_delete' }]);
  
  bot.editMessageReplyMarkup({ inline_keyboard: buttons }, { chat_id: chatId, message_id: state.messageId })
    .catch(err => logger.error(`Error showing delete keyboard for user ${userId}: ${err.message}`));
}

bot.onText(/\/clearlist/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  clearListState[userId] = true;
  await bot.sendMessage(chatId, "Все ваши напоминания будут удалены, вы уверены? (напишите ДА)");
  logger.info(`User ${userId} initiated clearlist.`);
});

bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const reminders = await Reminder.find({ userId: chatId, datetime: { $gte: new Date() } });
  if (!reminders.length) {
    await bot.sendMessage(chatId, 'Нет активных напоминаний.');
    logger.info(`User ${userId} requested list but has no active reminders.`);
    return;
  }
  userState[userId] = { reminders, page: 0, messageId: null };
  sendRemindersPage(chatId, userId);
  logger.info(`User ${userId} requested list; ${reminders.length} reminders loaded.`);
});

bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  const messageId = callbackQuery.message.message_id;
  
  // Обработка кнопок отложения и "Готово"
  if (data.startsWith('postpone_') || data.startsWith('done_')) {
    if (data.startsWith('postpone_')) {
      const parts = data.split('_');
      const type = parts[1];
      const reminderId = parts.slice(2).join('_');
      try {
        const reminder = await Reminder.findById(reminderId);
        if (!reminder) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: 'Напоминание не найдено.' });
          logger.info(`User ${userId} tried to postpone non-existent reminder ${reminderId}.`);
          return;
        }
        if (type === '1') {
          reminder.datetime = new Date(reminder.datetime.getTime() + 60 * 60 * 1000);
        } else if (type === '3') {
          reminder.datetime = new Date(reminder.datetime.getTime() + 3 * 60 * 60 * 1000);
        } else if (type === 'custom') {
          const instructionMsg = await bot.sendMessage(chatId, 'Пожалуйста, введите новое время для переноса (например, "30" для 30 минут или "14:30").');
          postponeCustomState[userId] = { reminderId, instructionMessageId: instructionMsg.message_id };
          await bot.answerCallbackQuery(callbackQuery.id);
          logger.info(`User ${userId} requested custom postponement for reminder ${reminderId}.`);
          return;
        }
        await reminder.save();
        const newTime = formatTime(reminder.datetime);
        const updatedText = `🔔 Напоминание отложено: ${reminder.description}\nВремя: ${newTime}`;
        try {
          await bot.editMessageText(updatedText, { chat_id: chatId, message_id: messageId });
        } catch (err) {
          if (!err.response?.body?.description?.toLowerCase().includes('message is not modified')) throw err;
        }
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Напоминание отложено.' });
        logger.info(`User ${userId} postponed reminder ${reminderId} to ${newTime}.`);
      } catch (err) {
        logger.error(`Error postponing reminder for user ${userId}: ${err.message}`);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Ошибка при обработке.' });
      }
    } else if (data.startsWith('done_')) {
      const reminderId = data.split('_')[1];
      try {
        const reminder = await Reminder.findById(reminderId);
        if (!reminder) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: 'Напоминание не найдено.' });
          logger.info(`User ${userId} pressed Done for non-existent reminder ${reminderId}.`);
          return;
        }
        const updatedText = `✔️ ${reminder.description}`;
        try {
          await bot.editMessageText(updatedText, { chat_id: chatId, message_id: messageId });
        } catch (err) {
          if (!err.response?.body?.description?.toLowerCase().includes('message is not modified')) throw err;
        }
        await Reminder.deleteOne({ _id: reminderId });
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Напоминание отмечено как выполненное.' });
        logger.info(`User ${userId} marked reminder ${reminderId} as done.`);
      } catch (err) {
        logger.error(`Error marking reminder done for user ${userId}: ${err.message}`);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Ошибка при обработке.' });
      }
    }
    return;
  }
  
  // Режим списка (/list)
  if (userState[userId]) {
    if (data === 'first_page') {
      userState[userId].page = 0;
    } else if (data === 'prev_page') {
      userState[userId].page = Math.max(0, userState[userId].page - 1);
    } else if (data === 'next_page') {
      const totalPages = Math.ceil(userState[userId].reminders.length / 10);
      userState[userId].page = Math.min(totalPages - 1, userState[userId].page + 1);
    } else if (data === 'last_page') {
      userState[userId].page = Math.ceil(userState[userId].reminders.length / 10) - 1;
    } else if (data === 'delete_reminder') {
      showDeleteButtons(chatId, userId);
      await bot.answerCallbackQuery(callbackQuery.id);
      logger.info(`User ${userId} requested deletion mode.`);
      return;
    } else if (data.startsWith('del_')) {
      const globalNumber = parseInt(data.split('_')[1], 10);
      const globalIndex = globalNumber - 1;
      if (globalIndex < 0 || globalIndex >= userState[userId].reminders.length) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Некорректный номер.' });
        return;
      }
      const reminder = userState[userId].reminders[globalIndex];
      try {
        await Reminder.deleteOne({ _id: reminder._id });
        userState[userId].reminders.splice(globalIndex, 1);
        await bot.sendMessage(chatId, `✅ Напоминание "${reminder.description}" удалено.`);
        sendRemindersPage(chatId, userId);
        logger.info(`User ${userId} deleted reminder ${reminder._id} (global number: ${globalNumber}).`);
      } catch (err) {
        logger.error(`Error deleting reminder for user ${userId}: ${err.message}`);
        await bot.sendMessage(chatId, 'Ошибка при удалении напоминания.');
      }
      await bot.answerCallbackQuery(callbackQuery.id);
      return;
    } else if (data === 'cancel_delete') {
      sendRemindersPage(chatId, userId);
      await bot.answerCallbackQuery(callbackQuery.id);
      logger.info(`User ${userId} canceled deletion mode.`);
      return;
    }
    sendRemindersPage(chatId, userId);
    await bot.answerCallbackQuery(callbackQuery.id);
    return;
  }
  
  await bot.answerCallbackQuery(callbackQuery.id);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();
  
  if (text.startsWith('/')) {
    if (postponeCustomState[userId]) delete postponeCustomState[userId];
    return;
  }
  
  // Обработка произвольного переноса
  if (postponeCustomState[userId]) {
    const { reminderId, instructionMessageId } = postponeCustomState[userId];
    delete postponeCustomState[userId];
    try {
      const reminder = await Reminder.findById(reminderId);
      if (!reminder) {
        return bot.sendMessage(chatId, 'Напоминание не найдено для отложения.');
      }
      const { date: newDatetime } = parseReminderText(text);
      if (!newDatetime || newDatetime < new Date()) {
        return bot.sendMessage(chatId, 'Неверное или прошедшее время. Попробуйте ещё раз.');
      }
      reminder.datetime = newDatetime;
      await reminder.save();
      const newTime = formatTime(reminder.datetime);
      const updatedText = `🔔 Напоминание отложено: ${reminder.description}\nВремя: ${newTime}`;
      try {
        await bot.deleteMessage(chatId, instructionMessageId.toString());
      } catch (err) {
        logger.error(`Error deleting instruction message for user ${userId}: ${err.message}`);
      }
      try {
        await bot.deleteMessage(chatId, reminder.lastMessageId.toString());
      } catch (err) {
        logger.error(`Error deleting original reminder message for user ${userId}: ${err.message}`);
      }
      const sent = await bot.sendMessage(chatId, updatedText);
      reminder.lastMessageId = sent.message_id;
      await reminder.save();
      logger.info(`User ${userId} postponed reminder ${reminder._id} to ${newTime} (instruction and original messages deleted).`);
    } catch (err) {
      logger.error(`Error during custom postponement for user ${userId}: ${err.message}`);
      return bot.sendMessage(chatId, 'Ошибка при отложении напоминания.');
    }
    return;
  }
  
  if (/^\/clearlist$/i.test(text)) {
    clearListState[userId] = true;
    await bot.sendMessage(chatId, "Все ваши напоминания будут удалены, вы уверены? (напишите ДА)");
    logger.info(`User ${userId} initiated clearlist.`);
    return;
  }
  
  if (clearListState[userId]) {
    if (text.toLowerCase() === 'да') {
      await Reminder.deleteMany({ userId: chatId });
      await bot.sendMessage(chatId, 'Все ваши напоминания удалены.');
      if (userState[userId]) delete userState[userId];
      logger.info(`User ${userId} confirmed clearlist. All reminders deleted.`);
    } else {
      await bot.sendMessage(chatId, 'Операция очистки отменена.');
      logger.info(`User ${userId} canceled clearlist.`);
    }
    delete clearListState[userId];
    return;
  }
  
  const { date: parsedDate, text: description } = parseReminderText(text);
  const repeatPattern = extractRepeatPattern(text);
  const nowUTC3 = DateTime.local().setZone('UTC+3').toJSDate();
  if (parsedDate < nowUTC3) {
    await bot.sendMessage(chatId, '⏳ Событие в прошлом. Введите корректную дату и время.');
    logger.info(`User ${userId} tried to create a reminder in the past.`);
    return;
  }
  const reminder = new Reminder({
    userId: chatId,
    description: description || 'Без описания',
    datetime: parsedDate,
    repeat: repeatPattern,
  });
  await reminder.save();
  const formattedDate = formatDate(parsedDate);
  const repeatText = repeatPattern ? `🔁 Повтор: ${getRepeatDisplay(text)}` : '🔁 Повтор: нет';
  bot.sendMessage(chatId, `✅ Напоминание сохранено:\n\n📌 <b>${description}</b>\n🕒 ${formattedDate}\n${repeatText}`, { parse_mode: "HTML" });
  logger.info(`User ${userId} created reminder "${description}" for ${formattedDate} with ID ${reminder._id}.`);
});