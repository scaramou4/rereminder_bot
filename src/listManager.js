// src/listManager.js
const bot = require('./botInstance');
const { listReminders, deleteReminder } = require('./reminderScheduler');
const UserSettings = require('./models/userSettings');
const logger = require('./logger');
const { DateTime } = require('luxon');
const throttle = require('lodash/throttle');

const ITEMS_PER_PAGE = 10;

async function renderList(chatId, page, deleteMode = false) {
  try {
    const reminders = await listReminders(chatId);
    const total = reminders.length;
    const totalPages = Math.max(Math.ceil(total / ITEMS_PER_PAGE), 1);
    page = Math.max(0, Math.min(page, totalPages - 1));

    if (total === 0) {
      return { text: 'У вас нет предстоящих уведомлений.', keyboard: { inline_keyboard: [] } };
    }

    // Получаем часовой пояс пользователя
    const us = await UserSettings.findOne({ userId: chatId.toString() });
    const tz = us ? us.timezone : 'Europe/Moscow';

    const start = page * ITEMS_PER_PAGE;
    const pageRem = reminders.slice(start, start + ITEMS_PER_PAGE);

    let text = `📋 Ваши напоминания (${total}):\n\n`;
    pageRem.forEach((r, idx) => {
      const num = start + idx + 1;
      let when;
      try {
        when = DateTime
          .fromJSDate(r.nextEvent)
          .setZone(tz)
          .setLocale('ru')
          .toFormat('HH:mm, d MMMM yyyy');
      } catch {
        when = 'Не определено';
      }
      text += `<b>${num}. ${r.description}</b>\n`;
      text += `⏰ ${when}\n`;
      text += `🔁 ${r.repeat || 'Без повтора'}\n\n`;
    });
    text += `📄 Страница ${page + 1} из ${totalPages}`;

    const keyboard = deleteMode
      ? buildDeleteKeyboard(pageRem, page)
      : [
          [
            { text: '⏮️ Первая', callback_data: `list_first|${page}` },
            { text: '◀️ Назад', callback_data: `list_prev|${page}` },
            { text: '🗑️ Удалить', callback_data: `list_toggle|${page}` }
          ],
          [
            { text: '▶️ Вперед', callback_data: `list_next|${page}` },
            { text: '⏭️ Последняя', callback_data: `list_last|${page}` }
          ]
        ];

    return { text, keyboard: { inline_keyboard: keyboard } };
  } catch (err) {
    logger.error(`renderList error: ${err.message}`);
    return { text: 'Ошибка при загрузке списка.', keyboard: { inline_keyboard: [] } };
  }
}

function buildDeleteKeyboard(pageRem, page) {
  const rows = [];
  let row = [];
  pageRem.forEach((r, idx) => {
    row.push({
      text: `${page * ITEMS_PER_PAGE + idx + 1}`,
      callback_data: `list_delete|${r._id}|${page}`
    });
    if (row.length === 5) {
      rows.push(row);
      row = [];
    }
  });
  if (row.length) rows.push(row);
  rows.push([{ text: '❌ Отмена', callback_data: `list_cancel|${page}` }]);
  return rows;
}

async function sendPaginatedList(chatId, page, deleteMode, messageId = null) {
  const { text, keyboard } = await renderList(chatId, page, deleteMode);
  const opts = { chat_id: chatId, reply_markup: keyboard, parse_mode: 'HTML' };
  if (messageId) {
    try {
      await bot.editMessageText(text, { ...opts, message_id: messageId });
    } catch (err) {
      if (!err.message.includes('not modified')) throw err;
    }
  } else {
    await bot.sendMessage(chatId, text, opts);
  }
}

async function handleListCallback(query) {
  return throttle(async (q) => {
    const [action, id, pageStr] = q.data.split('|');
    const total = (await listReminders(q.message.chat.id)).length;
    const totalPages = Math.max(Math.ceil(total / ITEMS_PER_PAGE), 1);
    let page = parseInt(pageStr, 10);

    switch (action) {
      case 'list_first': page = 0; break;
      case 'list_prev':  page = Math.max(0, page - 1); break;
      case 'list_next':  page = Math.min(totalPages - 1, page + 1); break;
      case 'list_last':  page = totalPages - 1; break;
      case 'list_toggle':
        await sendPaginatedList(q.message.chat.id, page, true, q.message.message_id);
        return;
      case 'list_cancel':
        await sendPaginatedList(q.message.chat.id, page, false, q.message.message_id);
        return;
      case 'list_delete':
        await deleteReminder(id);
        await sendPaginatedList(q.message.chat.id, page, true, q.message.message_id);
        await bot.answerCallbackQuery(q.id, { text: 'Напоминание удалено.' });
        return;
    }
    await sendPaginatedList(q.message.chat.id, page, false, q.message.message_id);
  }, 500)(query);
}

module.exports = {
  renderList,
  sendPaginatedList,
  handleListCallback
};