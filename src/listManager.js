const bot = require('./botInstance');
const { listReminders, deleteReminder } = require('./reminderScheduler');
const logger = require('./logger');
const { DateTime } = require('luxon');
const throttle = require('lodash/throttle'); // Убедитесь, что установлен через npm install lodash

async function renderList(chatId, page, deleteMode) {
  try {
    const reminders = await listReminders(chatId);
    const itemsPerPage = 10;
    const total = reminders.length;
    const totalPages = Math.ceil(total / itemsPerPage);
    if (total === 0) {
      return { text: "У вас нет предстоящих уведомлений.", keyboard: { inline_keyboard: [] } };
    }
    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;
    const startIndex = page * itemsPerPage;
    const pageReminders = reminders.slice(startIndex, startIndex + itemsPerPage);
    
    let text = `Ваши предстоящие уведомления:\n\n`;
    pageReminders.forEach((reminder, idx) => {
      const num = startIndex + idx + 1;
      let formattedTime;
      try {
        formattedTime = DateTime.fromJSDate(reminder.nextEvent)
          .setZone('Europe/Moscow')
          .setLocale('ru')
          .toFormat("HH:mm, d MMMM yyyy");
      } catch (e) {
        logger.warn(`Некорректное значение nextEvent для reminder ${reminder._id}: ${e.message}`);
        formattedTime = 'Не определено';
      }
      text += `<b>${num}. Напоминание: ${reminder.description}</b>\n`;
      text += `Следующее событие: ${formattedTime}\n`;
      text += `Повтор: ${reminder.repeat ? reminder.repeat : 'нет'}\n\n`;
    });
    text += `Страница ${page + 1} из ${totalPages}`;
    
    let keyboard;
    if (!deleteMode) {
      keyboard = [
        [
          { text: "⏮️", callback_data: `list_first|${page}` },
          { text: "◀️", callback_data: `list_prev|${page}` },
          { text: "🗑️", callback_data: `list_toggle|${page}` },
          { text: "▶️", callback_data: `list_next|${page}` },
          { text: "⏭️", callback_data: `list_last|${page}` }
        ]
      ];
    } else {
      let rows = [];
      let row = [];
      pageReminders.forEach((reminder, idx) => {
        row.push({ text: `${startIndex + idx + 1}`, callback_data: `list_delete|${reminder._id}|${page}` });
        if (row.length === 5) {
          rows.push(row);
          row = [];
        }
      });
      if (row.length > 0) rows.push(row);
      rows.push([{ text: "Отмена", callback_data: `list_cancel|${page}` }]);
      keyboard = rows;
    }
    return { text, keyboard: { inline_keyboard: keyboard } };
  } catch (error) {
    logger.error(`Ошибка формирования списка уведомлений: ${error.message}`);
    return { text: "Ошибка формирования списка уведомлений.", keyboard: { inline_keyboard: [] } };
  }
}

async function sendPaginatedList(chatId, page, deleteMode, messageId = null) {
  try {
    const { text, keyboard } = await renderList(chatId, page, deleteMode);
    if (messageId) {
      try {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: keyboard, parse_mode: "HTML" });
      } catch (error) {
        if (error.message && error.message.includes("message is not modified")) {
          logger.info("Сообщение не изменилось, обновление не требуется.");
        } else {
          throw error;
        }
      }
    } else {
      await bot.sendMessage(chatId, text, { reply_markup: keyboard, parse_mode: "HTML" });
    }
  } catch (error) {
    logger.error(`Ошибка отправки/обновления списка уведомлений: ${error.message}`);
  }
}

async function handleListCallback(query) {
  const throttledCallback = throttle(async (query) => {
    try {
      const data = query.data;
      const chatId = query.message.chat.id;
      const messageId = query.message.message_id;
      const parts = data.split("|");
      let action = parts[0];
      let currentPage = parts[1] ? parseInt(parts[1], 10) : 0;
      let newPage = currentPage;
      let deleteMode = false;
      
      if (action === "list_first") {
        newPage = 0;
      } else if (action === "list_prev") {
        newPage = currentPage - 1;
        if (newPage < 0) newPage = 0;
      } else if (action === "list_next") {
        const reminders = await listReminders(chatId);
        const totalPages = Math.ceil(reminders.length / 10);
        newPage = currentPage + 1;
        if (newPage >= totalPages) newPage = totalPages - 1;
      } else if (action === "list_last") {
        const reminders = await listReminders(chatId);
        const totalPages = Math.ceil(reminders.length / 10);
        newPage = totalPages - 1;
      } else if (action === "list_toggle") {
        deleteMode = true;
        newPage = currentPage;
      } else if (action === "list_cancel") {
        deleteMode = false;
        newPage = currentPage;
      } else if (action === "list_delete") {
        const reminderId = parts[1];
        newPage = parts[2] ? parseInt(parts[2], 10) : currentPage;
        const deletedReminder = await deleteReminder(reminderId);
        if (deletedReminder) {
          await bot.sendMessage(chatId, `Напоминание "${deletedReminder.description}" удалено`);
          logger.info(`handleListCallback: Удалено напоминание ${reminderId}`);
        } else {
          await bot.sendMessage(chatId, "Ошибка удаления уведомления");
        }
        deleteMode = false;
      }
      
      await sendPaginatedList(chatId, newPage, deleteMode, messageId);
      await bot.answerCallbackQuery(query.id);
    } catch (error) {
      logger.error(`Ошибка обработки callback запроса списка: ${error.message}`);
      try {
        await bot.answerCallbackQuery(query.id, { text: 'Ошибка обработки запроса', show_alert: true });
      } catch (err) {
        logger.error(`Ошибка отправки callback ответа: ${err.message}`);
      }
    }
  }, 500);

  await throttledCallback(query);
}

module.exports = {
  renderList,
  sendPaginatedList,
  handleListCallback
};