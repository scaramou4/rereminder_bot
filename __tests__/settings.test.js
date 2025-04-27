/* throttle / settings tests – здесь просто демонстрация заглушки */

jest.mock('../src/botInstance', () => ({ sendMessage: jest.fn() }));
jest.mock('../src/agendaScheduler', () => ({
  agenda: { start: jest.fn() }, scheduleReminder: jest.fn(),
  cancelReminderJobs: jest.fn(), defineSendReminderJob: jest.fn()
}));

jest.mock('../src/models/userSettings', () => {
  const mockStore = new Map();
  const Doc = function (d) { Object.assign(this, d); };
  Doc.findOne = jest.fn(q => Promise.resolve(mockStore.get(q.userId)));
  Doc.prototype.save = jest.fn(function () { mockStore.set(this.userId, this); });
  return Doc;
});

test('settings stub', () => expect(1).toBe(1));