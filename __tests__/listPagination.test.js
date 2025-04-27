/* --- МОКИ --- */
jest.mock('../src/botInstance', () => ({
    editMessageText: jest.fn(() => Promise.resolve()),
    sendMessage    : jest.fn(() => Promise.resolve({ message_id: 1 }))
  }));
  jest.mock('../src/agendaScheduler', () => ({
    agenda: { start: jest.fn() },
    scheduleReminder: jest.fn(),
    cancelReminderJobs: jest.fn(),
    defineSendReminderJob: jest.fn()
  }));
  
  const mockReminders = [];
  jest.mock('../src/models/reminder', () => ({
    aggregate: () => Promise.resolve(mockReminders)
  }));
  jest.mock('../src/models/userSettings', () => {
    const { MOSCOW_ZONE } = require('../src/constants');
    return { findOne: () => Promise.resolve({ timezone: MOSCOW_ZONE }) };
  });
  
  /* --- Тестируемый модуль — подключаем ПОСЛЕ моков --- */
  const listManager = require('../src/listManager');
  const bot = require('../src/botInstance');
  const { DateTime } = require('luxon');
  
  describe('Пагинация', () => {
    beforeAll(() => {
      for (let i = 0; i < 23; i++) {
        mockReminders.push({
          _id: String(i),
          description: `rem ${i}`,
          nextEvent: DateTime.now().plus({ hours: i }).toJSDate()
        });
      }
    });
  
    test('рендер первой страницы', async () => {
      await listManager.sendPaginatedList(555, 0, false);
      expect(bot.sendMessage).toHaveBeenCalledWith(
        555,
        expect.stringContaining('Ваши'),
        expect.any(Object)
      );
    });
  });