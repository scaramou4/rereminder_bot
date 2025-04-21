// __tests__/dateParser.test.js
const { DateTime } = require('luxon');
const { parseReminder, parseTimeString, parseDate } = require('../src/dateParser');
const { MOSCOW_ZONE } = require('../src/constants');
const UserSettings = require('../src/models/userSettings');

// Фиксируем "текущее" время для тестов: 7 марта 2025, 11:00 по московскому времени.
const fixedNow = DateTime.fromISO('2025-03-07T11:00:00.000+03:00');

// Мокаем DateTime.now() для предсказуемости расчётов.
jest.spyOn(DateTime, 'now').mockReturnValue(fixedNow);

// Мокаем UserSettings.findOne() чтобы тесты не зависали из-за отсутствия БД.
jest.spyOn(UserSettings, 'findOne').mockImplementation(async (query) => {
  // Возвращаем настройки для любого userId.
  return { 
    userId: query.userId, 
    timezone: 'Europe/Moscow', 
    morningTime: '8:00', 
    eveningTime: '18:00' 
  };
});

const dummyChatId = 'testChatId';

describe('Функция parseTimeString', () => {
  test('Парсинг формата "10:15"', () => {
    expect(parseTimeString('10:15')).toEqual({ hour: 10, minute: 15 });
  });
  test('Парсинг числового формата "1015"', () => {
    expect(parseTimeString('1015')).toEqual({ hour: 10, minute: 15 });
  });
});

describe('Функция parseDate', () => {
  test('Парсинг даты "17 апреля 2025" с форматом "d MMMM yyyy"', () => {
    const dt = parseDate('17 апреля 2025', 'd MMMM yyyy');
    expect(dt.isValid).toBeTruthy();
    expect(dt.year).toBe(2025);
    expect(dt.month).toBe(4);
    expect(dt.day).toBe(17);
  });
});

describe('Функция parseReminder – однократные уведомления', () => {
  test('Ввод "в 1015 завтрак" (числовой формат)', async () => {
    const result = await parseReminder('в 1015 завтрак', dummyChatId);
    expect(result.error).toBeNull();
    expect(result.reminderText).toBe('завтрак');
    expect(result.timeSpec).toMatch(/в 10:15/);
    expect(result.repeat).toBeNull();
    const dt = DateTime.fromJSDate(result.datetime).setZone(MOSCOW_ZONE);
    expect(dt.toISO()).toBe('2025-03-08T10:15:00.000+03:00');
  });

  test('Ввод "в 10:15 уборка" – формат с разделителем ":"', async () => {
    const result = await parseReminder('в 10:15 уборка', dummyChatId);
    expect(result.error).toBeNull();
    expect(result.reminderText).toBe('уборка');
    expect(result.timeSpec).toMatch(/в 10:15/);
    expect(result.repeat).toBeNull();
    const dt = DateTime.fromJSDate(result.datetime).setZone(MOSCOW_ZONE);
    expect(dt.toISO()).toBe('2025-03-08T10:15:00.000+03:00');
  });

  test('Ввод "сегодня в 15 встреча"', async () => {
    const result = await parseReminder('сегодня в 15 встреча', dummyChatId);
    expect(result.error).toBeNull();
    expect(result.reminderText).toBe('встреча');
    expect(result.timeSpec).toMatch(/сегодня в 15/);
    expect(result.repeat).toBeNull();
    const dt = DateTime.fromJSDate(result.datetime).setZone(MOSCOW_ZONE);
    expect(dt.toISO()).toBe('2025-03-07T15:00:00.000+03:00');
  });

  test('Ввод "сегодня в 14 встреча" – время уже прошло', async () => {
    const nowMock = DateTime.fromISO('2025-03-07T15:05:00.000+03:00');
    jest.spyOn(DateTime, 'now').mockReturnValue(nowMock);
    const result = await parseReminder('сегодня в 14 встреча', dummyChatId);
    expect(result.error).toMatch(/Указанное время уже прошло/);
    jest.spyOn(DateTime, 'now').mockReturnValue(fixedNow);
  });

  test('Ввод "завтра в 9 завтрак"', async () => {
    const result = await parseReminder('завтра в 9 завтрак', dummyChatId);
    expect(result.error).toBeNull();
    expect(result.reminderText).toBe('завтрак');
    expect(result.timeSpec).toMatch(/завтра.*9/);
    expect(result.repeat).toBeNull();
    const dt = DateTime.fromJSDate(result.datetime).setZone(MOSCOW_ZONE);
    expect(dt.toISO()).toBe('2025-03-08T09:00:00.000+03:00');
  });

  test('Ввод "завтрав в 25 тест" – неверный формат', async () => {
    const result = await parseReminder('завтрав в 25 тест', dummyChatId);
    expect(result.error).toMatch(/Не удалось распознать формат напоминания/);
  });

  test('Ввод "через 2 часа в 19 тест" – сложная конструкция', async () => {
    const result = await parseReminder('через 2 часа в 19 тест', dummyChatId);
    expect(result.error).toMatch(/Сложная временная конструкция, упростите/);
  });

  test('Ввод "Сегодня утром зарядка"', async () => {
    const result = await parseReminder('сегодня утром зарядка', dummyChatId);
    expect(result.error).toMatch(/Указанное время уже прошло/);
  });

  test('Ввод "Завтра вечером встреча с другом"', async () => {
    const result = await parseReminder('завтра вечером встреча с другом', dummyChatId);
    expect(result.error).toBeNull();
    expect(result.reminderText).toBe('встреча с другом');
    expect(result.timeSpec).toMatch(/завтра вечером в/);
    expect(result.repeat).toBeNull();
  });

  test('Ввод "В 9 обед"', async () => {
    const result = await parseReminder('в 9 обед', dummyChatId);
    expect(result.error).toBeNull();
    expect(result.reminderText).toBe('обед');
    expect(result.timeSpec).toMatch(/в 9:00/);
    expect(result.repeat).toBeNull();
  });
});

describe('Функция parseReminder – повторяющиеся уведомления', () => {
  test('Ввод "каждые 30 минут проверка"', async () => {
    const result = await parseReminder('каждые 30 минут проверка', dummyChatId);
    expect(result.error).toBeNull();
    expect(result.reminderText).toBe('проверка');
    expect(result.repeat).toMatch(/каждые 30 минут/);
    const dt = DateTime.fromJSDate(result.datetime).setZone(MOSCOW_ZONE);
    expect(dt.toISO()).toBe('2025-03-07T11:30:00.000+03:00');
  });

  test('Ввод "каждый месяц 15 числа зарплата"', async () => {
    const result = await parseReminder('каждый месяц 15 числа зарплата', dummyChatId);
    expect(result.error).toBeNull();
    expect(result.reminderText).toBe('зарплата');
    expect(result.repeat).toBe('каждый месяц');
    expect(result.timeSpec).toMatch(/каждый месяц 15 числа/);
    const dt = DateTime.fromJSDate(result.datetime).setZone(MOSCOW_ZONE);
    expect(dt.day).toBe(15);
  });

  test('Ввод "каждый год 17 апреля днюха"', async () => {
    const result = await parseReminder('каждый год 17 апреля днюха', dummyChatId);
    expect(result.error).toBeNull();
    expect(result.reminderText).toBe('днюха');
    expect(result.repeat).toMatch(/каждый год/);
    expect(result.timeSpec).toMatch(/17 апреля/);
    const dt = DateTime.fromJSDate(result.datetime).setZone(MOSCOW_ZONE);
    expect(dt.year).toBe(2025);
    expect(dt.month).toBe(4);
    expect(dt.day).toBe(17);
    expect(dt.hour).toBe(11); // Если время не задано явно, берём fixedNow.hour
  });

  test('Ввод "каждый понедельник тренирова" – недопустимая единица повторения', async () => {
    const result = await parseReminder('каждый понедельник тренирова', dummyChatId);
    expect(result.error).toMatch(/Недопустимая единица повторения/);
  });

  test('Ввод "Каждые 15 минут проверить почту"', async () => {
    const result = await parseReminder('каждые 15 минут проверить почту', dummyChatId);
    expect(result.error).toBeNull();
    expect(result.reminderText).toBe('проверить почту');
    expect(result.repeat).toMatch(/каждые 15 минут/);
    const dt = DateTime.fromJSDate(result.datetime).setZone(MOSCOW_ZONE);
    expect(dt.toISO()).toBe('2025-03-07T11:15:00.000+03:00');
  });

  test('Ввод "Каждый месяц 1 числа оплата"', async () => {
    const result = await parseReminder('каждый месяц 1 числа оплата', dummyChatId);
    expect(result.error).toBeNull();
    expect(result.reminderText).toBe('оплата');
    expect(result.repeat).toBe('каждый месяц');
    expect(result.timeSpec).toMatch(/каждый месяц 1 числа/);
    const dt = DateTime.fromJSDate(result.datetime).setZone(MOSCOW_ZONE);
    expect(dt.day).toBe(1);
  });

  test('Ввод "Каждый год 25 декабря Рождество"', async () => {
    const result = await parseReminder('каждый год 25 декабря Рождество', dummyChatId);
    expect(result.error).toBeNull();
    expect(result.reminderText).toBe('Рождество');
    expect(result.repeat).toMatch(/каждый год/);
    expect(result.timeSpec).toMatch(/25 декабря/);
    const dt = DateTime.fromJSDate(result.datetime).setZone(MOSCOW_ZONE);
    expect(dt.month).toBe(12);
    expect(dt.day).toBe(25);
  });
});