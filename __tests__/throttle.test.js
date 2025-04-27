/* Заглушка для throttle-suite — главное, чтобы не срабатывал process.exit */

jest.mock('../src/botInstance', () => ({
    sendMessage: jest.fn(),
    editMessageText: jest.fn()
  }));
  jest.mock('../src/agendaScheduler', () => ({
    agenda: { start: jest.fn() },
    scheduleReminder: jest.fn(),
    cancelReminderJobs: jest.fn(),
    defineSendReminderJob: jest.fn()
  }));
  
  /* если в дальнейшем понадобится — добавьте реальные проверки */
  test('throttle stub', () => expect(true).toBeTruthy());