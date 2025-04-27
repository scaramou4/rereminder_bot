const { DateTime } = require('luxon');
jest.useFakeTimers().setSystemTime(
  DateTime.fromISO('2025-03-07T11:00:00+03:00').toJSDate()
);

/* --- МОКИ --- */
jest.mock('../src/botInstance', () => ({
  sendMessage: jest.fn(() => Promise.resolve({ message_id: 42 }))
}));
jest.mock('../src/agendaScheduler', () => ({
  agenda: { start: jest.fn() },
  scheduleReminder: jest.fn(),
  cancelReminderJobs: jest.fn(),
  defineSendReminderJob: jest.fn()
}));
jest.mock('../src/settings', () => ({
  buildUserPostponeKeyboard: () =>
    Promise.resolve({ reply_markup: { inline_keyboard: [] } })
}));
jest.mock('../src/models/reminder', () => {
  const store = new Map();
  const R = function (d) { Object.assign(this, d); };
  R.prototype.save = function () { store.set(this._id, this); return Promise.resolve(this); };
  return R;
});
jest.mock('../src/models/userSettings', () => {
  const { MOSCOW_ZONE } = require('../src/constants');
  return { findOne: () => Promise.resolve({ timezone: MOSCOW_ZONE, autoPostponeDelay: 15 }) };
});

/* --- импорт после моков --- */
const { sendOneOffReminder } = require('../src/reminderScheduler');
const bot = require('../src/botInstance');

describe('autoPostpone', () => {
  test('время сдвигается на 15 минут', async () => {
    const rem = { _id: 'id1', userId: 7, description: 't',
                  datetime: new Date(), repeat: null, save: jest.fn() };

    await sendOneOffReminder(rem);
    expect(Math.round((rem.datetime - Date.now()) / 60000)).toBe(15);
    expect(bot.sendMessage).toHaveBeenCalled();
  });
});