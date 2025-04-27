jest.setTimeout(10_000);

const { createReminder, deleteAllReminders } =
  require('../src/reminderScheduler');

/* ---------- МОКИ ---------- */
jest.mock('../src/botInstance', () => ({
  sendMessage: jest.fn(() => Promise.resolve({ message_id: 1 }))
}));
jest.mock('../src/agendaScheduler', () => ({
  agenda: { start: jest.fn() },
  scheduleReminder: jest.fn(),
  cancelReminderJobs: jest.fn(),
  defineSendReminderJob: jest.fn()
}));

const mockStore = new Map();
jest.mock('../src/models/reminder', () => {
  const R = function (doc) { Object.assign(this, doc); };
  R.prototype.save = function () {
    mockStore.set(String(this._id ?? Date.now()), this);
    return Promise.resolve(this);
  };
  /* —--- ДОБАВИЛИ! —--- */
  R.findOne = jest.fn(() => Promise.resolve(null));
  R.find = () => Promise.resolve([...mockStore.values()]);
  R.deleteMany = () => { mockStore.clear(); return Promise.resolve(); };
  return R;
});

jest.mock('../src/models/userSettings', () => {
  const { MOSCOW_ZONE } = require('../src/constants');
  return {
    findOne: () => Promise.resolve({
      timezone: MOSCOW_ZONE, morningTime: '08:00', eveningTime: '18:00'
    })
  };
});

/* ---------- ТЕСТ ---------- */
describe('Life-cycle create → deleteAll', () => {
  const uid = 77, cid = 88;

  test('напоминание создаётся и удаляется', async () => {
    await createReminder(uid, 'через 1 минуту тест', cid);
    expect(mockStore.size).toBe(1);

    await deleteAllReminders(uid);
    expect(mockStore.size).toBe(0);
  });
});