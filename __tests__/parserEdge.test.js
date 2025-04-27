// __tests__/parserEdge.test.js
const { DateTime }   = require('luxon');
const { parseReminder } = require('../src/dateParser');
const UserSettings   = require('../src/models/userSettings');

const fixedNow = DateTime.fromISO('2025-03-07T11:00:00.000+03:00');
jest.spyOn(DateTime, 'now').mockReturnValue(fixedNow);

// подменяем загрузку настроек
jest.spyOn(UserSettings, 'findOne').mockResolvedValue({
  userId: 'dummy',
  timezone: 'Europe/Moscow',
  morningTime: '8:00',
  eveningTime: '18:00'
});

const dummyChat = 'edgeTests';

describe('Edge-cases parser', () => {

  /**             src                              ожидаемая ошибка RegExp */
  test.each([
    ['завтрав в 25 тест',            /Не удалось распознать формат/],
    ['31 февраля в 12 испытание',    /Некорректная дата/],
    ['в 25:61 ошибочное',            /Некорректное время/],
    ['через 0 минут ноль',           /Продолжительность должна быть положительной/]
  ])('%s', async (src, pattern) => {
    const r = await parseReminder(src, dummyChat);
    expect(r.error).toMatch(pattern);
  });

  /* --- новые случаи для простой абсолютной даты --- */
  test('корректная абсолютная дата: "30 апреля в 10 подарок"', async () => {
    const r = await parseReminder('30 апреля в 10 подарок', dummyChat);
    expect(r.error).toBeNull();
    expect(r.reminderText).toBe('подарок');
    expect(r.repeat).toBeNull();
  });

});