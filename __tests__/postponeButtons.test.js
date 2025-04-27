/* eslint-disable import/first */

/* ────────────────  M O C K S  ──────────────── */

/** Хранилище «документов» Reminder только для теста  */
const mockReminderStore = new Map();

/* ─── Telegram bot ─── */
jest.mock('../src/botInstance', () => ({
  sendMessage:            jest.fn().mockResolvedValue({ message_id: 321 }),
  editMessageReplyMarkup: jest.fn().mockResolvedValue(),
  answerCallbackQuery:    jest.fn().mockResolvedValue()
}));

/* ─── timeSpecParser (для ‘5m’, ‘10m’ …) ─── */
jest.mock('../src/timeSpecParser', () => ({
  parseTimeSpec: jest.fn(() => ({
    datetime: new Date(Date.now() + 5 * 60 * 1000)  // +5 минут
  }))
}));

/* ─── agendaScheduler ─── */
jest.mock('../src/agendaScheduler', () => ({
  scheduleReminder:     jest.fn().mockResolvedValue(),
  cancelReminderJobs:   jest.fn().mockResolvedValue(),
  defineSendReminderJob: jest.fn(),
  agenda: {}
}));

/* ─── Reminder model ───
   NB: имя переменной начинается с “mock”, поэтому Jest разрешает
   использовать её внутри фабрики mock-модуля.                       */
jest.mock('../src/models/reminder', () => ({
  findById: jest.fn(id =>
    Promise.resolve(mockReminderStore.get(String(id))))
}));

/* ─── UserSettings (чтобы не обращаться к Mongo) ─── */
jest.mock('../src/models/userSettings', () => ({
  findOne: jest.fn(async () => ({
    timezone: 'Europe/Moscow',
    morningTime: '09:00',
    eveningTime: '18:00',
    autoPostponeDelay: 15
  }))
}));

/* ─────────────── helpers ─────────────── */

function makeReminder(doc) {
  const obj = {
    ...doc,
    save: jest.fn().mockResolvedValue()
  };
  mockReminderStore.set(String(obj._id), obj);
  return obj;
}

/* ───────────── Т Е С Т Ы ───────────── */

const { DateTime }       = require('luxon');
const botMock            = require('../src/botInstance');
const {
  scheduleReminder,
  cancelReminderJobs
}                         = require('../src/agendaScheduler');
const { handleCallback }  = require('../src/reminderScheduler');

describe('Inline-кнопки postpone / done', () => {
  const REM_ID = 'abc123';

  beforeEach(() => {
    mockReminderStore.clear();
    makeReminder({
      _id:        REM_ID,
      userId:     999,
      description:'Тестовая задача',
      datetime:   DateTime.fromISO('2025-03-07T11:00:00+03').toJSDate(),
      repeat:     null,
      completed:  false,
      postponedCount: 0
    });
    jest.clearAllMocks();
  });

  test('«Отложить на 5 минут»', async () => {
    const query = {
      id: 'cb-postpone',
      data: `postpone|5m|${REM_ID}`,
      message: { chat: { id: 999 }, message_id: 10 }
    };

    await handleCallback(query);

    const updated = mockReminderStore.get(REM_ID);
    expect(updated.datetime.getTime())
      .toBeGreaterThan(DateTime.fromISO('2025-03-07T11:00:00+03').toMillis());

    expect(cancelReminderJobs).toHaveBeenCalledWith(REM_ID);
    expect(scheduleReminder).toHaveBeenCalledWith(updated);
    expect(botMock.editMessageReplyMarkup).toHaveBeenCalled();
    expect(botMock.answerCallbackQuery).toHaveBeenCalledWith(
      'cb-postpone',
      expect.objectContaining({ text: expect.stringContaining('Отложено') })
    );
  });

  test('«Готово»', async () => {
    const query = {
      id: 'cb-done',
      data: `done|${REM_ID}`,
      message: { chat: { id: 999 }, message_id: 11 }
    };

    await handleCallback(query);

    const doc = mockReminderStore.get(REM_ID);
    expect(doc.completed).toBe(true);
    expect(cancelReminderJobs).toHaveBeenCalledWith(REM_ID);
    expect(botMock.editMessageReplyMarkup).toHaveBeenCalled();
    expect(botMock.answerCallbackQuery).toHaveBeenCalledWith(
      'cb-done',
      expect.objectContaining({ text: 'Отмечено как выполненное.' })
    );
  });
});