const { createReminder } = require('../src/reminderScheduler');

/* --- МОКИ --- */
jest.mock('../src/botInstance', () => ({ sendMessage: jest.fn() }));
jest.mock('../src/agendaScheduler', () => ({
  agenda: { start: jest.fn() },
  scheduleReminder: jest.fn(),
  cancelReminderJobs: jest.fn(),
  defineSendReminderJob: jest.fn()
}));

const mockDB = new Map();
jest.mock('../src/models/reminder', () => {
  const R = function (d) { Object.assign(this, d); };
  R.findOne = jest.fn(({ description }) =>
    Promise.resolve([...mockDB.values()].find(r => r.description === description) || null)
  );
  R.prototype.save = function () {
    mockDB.set(this._id = Date.now(), this);
    return Promise.resolve(this);
  };
  return R;
});

jest.mock('../src/models/userSettings', () => {
  const { MOSCOW_ZONE } = require('../src/constants');
  return { findOne: () => Promise.resolve({ timezone: MOSCOW_ZONE }) };
});

/* --- ТЕСТ --- */
describe('Дубликаты', () => {
  const uid = 1, cid = 2;

  test('повторный текст не сохраняется', async () => {
    await createReminder(uid, 'через 5 минут кофе', cid);
    const res = await createReminder(uid, 'через 5 минут кофе', cid);

    expect(res).toBeNull();
    expect(mockDB.size).toBe(1);
  });
});