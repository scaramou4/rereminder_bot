require('dotenv').config();
const mongoose = require('mongoose');
const bot = require('./src/botInstance');
const { extractDate, extractRepeatPattern, extractReminderText } = require('./src/dateParser');
require('./src/reminderScheduler');

mongoose.connect('mongodb://127.0.0.1:27017/reminderBot');

const reminderSchema = new mongoose.Schema({
  userId: String,
  description: String,
  datetime: Date,
  repeat: String,
});

const Reminder = mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema);

// Храним состояние пользователей (текущая страница и список напоминаний)
const userState = {};

// Команда /list (отображает активные напоминания)
bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Загружаем активные напоминания
  const reminders = await Reminder.find({ userId: chatId, datetime: { $gte: new Date() } });

  if (reminders.length === 0) {
    return bot.sendMessage(chatId, 'Нет активных напоминаний.');
  }

  userState[userId] = {
    reminders,
    page: 0,
  };

  sendRemindersPage(chatId, userId);
});

// Функция обновления страницы с напоминаниями
function sendRemindersPage(chatId, userId) {
  const state = userState[userId];
  if (!state) return;

  const reminders = state.reminders;
  const page = state.page;

  const start = page * 10;
  const end = start + 10;
  const pageReminders = reminders.slice(start, end);

  if (pageReminders.length === 0) {
    bot.sendMessage(chatId, 'Нет активных напоминаний.');
    delete userState[userId];
    return;
  }

  let message = '📝 Ваши активные напоминания:\n\n';
  pageReminders.forEach((reminder, index) => {
    message += `${start + index + 1}. ${reminder.description} — ${formatDate(reminder.datetime)}\n`;
  });

  // Кнопки навигации
  const totalPages = Math.ceil(reminders.length / 10);
  const buttons = [];

  if (page > 0) {
    buttons.push({ text: '⏪', callback_data: 'first_page' });
    buttons.push({ text: '◀', callback_data: 'prev_page' });
  }
  if (page < totalPages - 1) {
    buttons.push({ text: '▶', callback_data: 'next_page' });
    buttons.push({ text: '⏩', callback_data: 'last_page' });
  }

  buttons.push({ text: '❌ Удалить по номеру', callback_data: 'delete_reminder' });

  const keyboard = { inline_keyboard: [buttons] };

  bot.editMessageText(message, {
    chat_id: chatId,
    message_id: state.messageId,
    reply_markup: keyboard,
  }).catch(() => {
    bot.sendMessage(chatId, message, { reply_markup: keyboard }).then((sentMessage) => {
      userState[userId].messageId = sentMessage.message_id;
    });
  });
}

// Функция показа кнопок удаления (скрывает кнопки навигации)
function showDeleteButtons(chatId, userId) {
  const state = userState[userId];
  if (!state) return;

  const start = state.page * 10;
  const end = start + 10;
  const pageReminders = state.reminders.slice(start, end);

  if (pageReminders.length === 0) {
    return bot.sendMessage(chatId, '❌ На этой странице нет напоминаний.');
  }

  const buttons = [];
  for (let i = 0; i < pageReminders.length; i += 5) {
    buttons.push(
      pageReminders.slice(i, i + 5).map((_, idx) => ({
        text: `${start + i + idx + 1}`,
        callback_data: `del_${start + i + idx}`,
      }))
    );
  }

  buttons.push([{ text: '❌ Отмена', callback_data: 'cancel_delete' }]);

  bot.editMessageReplyMarkup(
    { inline_keyboard: buttons },
    { chat_id: chatId, message_id: state.messageId }
  ).then(() => {
    state.deleteMessageId = state.messageId;
  }).catch(() => {
    bot.sendMessage(chatId, 'Выберите номер напоминания для удаления:', {
      reply_markup: { inline_keyboard: buttons },
    }).then((sentMessage) => {
      state.deleteMessageId = sentMessage.message_id;
    });
  });
}

// Функция отмены удаления (скрывает кнопки удаления и возвращает навигацию)
function cancelDeleteButtons(chatId, userId) {
  const state = userState[userId];
  if (!state || !state.deleteMessageId) return;

  sendRemindersPage(chatId, userId);
}

// Обработчик кнопок
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;

  if (data.startsWith('del_')) {
    const state = userState[userId];
    if (!state) return;

    const index = parseInt(data.split('_')[1], 10);
    if (index < 0 || index >= state.reminders.length) {
      return bot.sendMessage(chatId, '❌ Некорректный номер.');
    }

    const reminderToDelete = state.reminders[index];
    await Reminder.deleteOne({ _id: reminderToDelete._id });

    state.reminders = state.reminders.filter((_, i) => i !== index);

    bot.sendMessage(chatId, `✅ Напоминание "${reminderToDelete.description}" на ${formatDate(reminderToDelete.datetime)} удалено.`);

    if (state.reminders.length === 0) {
      bot.sendMessage(chatId, 'Нет активных напоминаний.');
      delete userState[userId];
    } else {
      sendRemindersPage(chatId, userId);
    }

    return;
  }

  switch (data) {
    case 'first_page':
      userState[userId].page = 0;
      break;
    case 'prev_page':
      userState[userId].page = Math.max(0, userState[userId].page - 1);
      break;
    case 'next_page':
      userState[userId].page = Math.min(
        Math.ceil(userState[userId].reminders.length / 10) - 1,
        userState[userId].page + 1
      );
      break;
    case 'last_page':
      userState[userId].page = Math.ceil(userState[userId].reminders.length / 10) - 1;
      break;
    case 'delete_reminder':
      return showDeleteButtons(chatId, userId);
    case 'cancel_delete':
      return cancelDeleteButtons(chatId, userId);
  }

  sendRemindersPage(chatId, userId);
  bot.answerCallbackQuery(callbackQuery.id);
});

// Запись новых напоминаний
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (text.startsWith('/')) return;

  let parsedDate = extractDate(text);
  let repeatPattern = extractRepeatPattern(text);
  let description = extractReminderText(text);

  if (!parsedDate && !repeatPattern) {
    return bot.sendMessage(chatId, '⛔ Не удалось понять дату или время. Попробуй снова.');
  }

  if (parsedDate < new Date()) {
    return bot.sendMessage(chatId, '⏳ Событие в прошлом. Введите корректную дату и время.');
  }

  const reminder = new Reminder({
    userId: chatId,
    description: description || 'Без описания',
    datetime: parsedDate,
    repeat: repeatPattern,
  });

  await reminder.save();

  bot.sendMessage(chatId, `✅ Напоминание сохранено:\n\n📌 ${description}\n🕒 ${formatDate(parsedDate)}`, { parse_mode: "HTML" });
});

function formatDate(date) {
  return `${date.getDate()} ${['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'][date.getMonth()]} ${date.getFullYear()} (${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')})`;
}