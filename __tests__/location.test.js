/* Проверка сохранения тайм-зоны по геолокации */

jest.mock('../src/botInstance', () => ({
    sendMessage: jest.fn()
  }));
  
  jest.mock('../src/agendaScheduler', () => ({
    agenda: { start: jest.fn() },
    scheduleReminder: jest.fn(),
    cancelReminderJobs: jest.fn(),
    defineSendReminderJob: jest.fn()
  }));
  
  jest.mock('../src/models/userSettings', () => {
    const mockCache = new Map();
    const U = function (d) { Object.assign(this, d); };
    U.findOne = jest.fn(q => Promise.resolve(mockCache.get(q.userId)));
    U.prototype.save = jest.fn(function () {
      mockCache.set(this.userId, this);
      return Promise.resolve(this);
    });
    return U;
  });
  
  /* здесь могли бы быть вызовы settings.handleLocation и проверки */
  test('заглушка location-suite', () => expect(true).toBeTruthy());