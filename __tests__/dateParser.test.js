// __tests__/dateParser.test.js
const { DateTime } = require('luxon');
const { parseReminder, parseTimeString, parseDate } = require('../src/dateParser');
const { MOSCOW_ZONE } = require('../src/constants');
const UserSettings = require('../src/models/userSettings');

/* ─────────────── фиктивное «сейчас» ─────────────── */
const fixedNow = DateTime.fromISO('2025-03-07T11:00:00.000+03:00');
jest.spyOn(DateTime, 'now').mockReturnValue(fixedNow);

/* ───────── мок настроек пользователя (без БД) ───── */
jest.spyOn(UserSettings, 'findOne').mockImplementation(async (q) => ({
  userId      : q.userId,
  timezone    : 'Europe/Moscow',
  morningTime : '8:00',
  eveningTime : '18:00'
}));

const dummyChatId = 'testChatId';

/* ─────────────────── parseTimeString ─────────────────── */
describe('Функция parseTimeString', () => {
  test('Парсинг "10:15"', () => {
    expect(parseTimeString('10:15')).toEqual({ hour: 10, minute: 15 });
  });
  test('Парсинг "1015"', () => {
    expect(parseTimeString('1015')).toEqual({ hour: 10, minute: 15 });
  });
});

/* ─────────────────────── parseDate ────────────────────── */
describe('Функция parseDate', () => {
  test('Парсинг "17 апреля 2025"', () => {
    const dt = parseDate('17 апреля 2025', 'd MMMM yyyy');
    expect(dt.isValid).toBeTruthy();
    expect(dt.year).toBe(2025);
    expect(dt.month).toBe(4);
    expect(dt.day).toBe(17);
  });
});

/* ───────────── parseReminder – однократные ────────────── */
describe('Функция parseReminder – однократные уведомления', () => {
  test('«в 1015 завтрак»', async () => {
    const r = await parseReminder('в 1015 завтрак', dummyChatId);
    expect(r.error).toBeNull();
    const dt = DateTime.fromJSDate(r.datetime).setZone(MOSCOW_ZONE);
    expect(dt.toISO()).toBe('2025-03-08T10:15:00.000+03:00');
  });

  test('«в 10:15 уборка»', async () => {
    const r = await parseReminder('в 10:15 уборка', dummyChatId);
    expect(r.error).toBeNull();
    const dt = DateTime.fromJSDate(r.datetime).setZone(MOSCOW_ZONE);
    expect(dt.toISO()).toBe('2025-03-08T10:15:00.000+03:00');
  });

  test('«сегодня в 15 встреча»', async () => {
    const r = await parseReminder('сегодня в 15 встреча', dummyChatId);
    expect(r.error).toBeNull();
    const dt = DateTime.fromJSDate(r.datetime).setZone(MOSCOW_ZONE);
    expect(dt.toISO()).toBe('2025-03-07T15:00:00.000+03:00');
  });

  test('«сегодня в 14 встреча» – время прошло', async () => {
    const lateNow = DateTime.fromISO('2025-03-07T15:05:00.000+03:00');
    jest.spyOn(DateTime, 'now').mockReturnValue(lateNow);
    const r = await parseReminder('сегодня в 14 встреча', dummyChatId);
    expect(r.error).toMatch(/Указанное время уже прошло/);
    jest.spyOn(DateTime, 'now').mockReturnValue(fixedNow);
  });

  test('«завтра в 9 завтрак»', async () => {
    const r = await parseReminder('завтра в 9 завтрак', dummyChatId);
    expect(r.error).toBeNull();
    const dt = DateTime.fromJSDate(r.datetime).setZone(MOSCOW_ZONE);
    expect(dt.toISO()).toBe('2025-03-08T09:00:00.000+03:00');
  });

  test('«1 февраля в 8 поздравить маму» – дата уже прошла, перенос на следующий год', async () => {
    // 1 февраля 2025-го уже позади (fixedNow = 7 марта 2025)
    const r = await parseReminder('1 февраля в 8 поздравить маму', dummyChatId);

    // ошибок быть не должно
    expect(r.error).toBeNull();
    expect(r.reminderText).toBe('поздравить маму');

    // должна получиться дата 1 февраля 2026 г. 08:00 (Москва)
    const dt = DateTime.fromJSDate(r.datetime).setZone(MOSCOW_ZONE);
    expect(dt.toISO()).toBe('2026-02-01T08:00:00.000+03:00');
  });

  /* ---- добавленные абсолютные даты ---- */
  test('«28 апреля в 10 тесты»', async () => {
    const r = await parseReminder('28 апреля в 10 тесты', dummyChatId);
    expect(r.error).toBeNull();
    expect(r.reminderText).toBe('тесты');
    const dt = DateTime.fromJSDate(r.datetime).setZone(MOSCOW_ZONE);
    expect(dt.toISO()).toBe('2025-04-28T10:00:00.000+03:00');
  });

  test('«5 мая днюха Антона» (без времени)', async () => {
    const r = await parseReminder('5 мая днюха Антона', dummyChatId);
    expect(r.error).toBeNull();
    expect(r.reminderText).toBe('днюха Антона');
    const dt = DateTime.fromJSDate(r.datetime).setZone(MOSCOW_ZONE);
    expect(dt.toISO()).toBe('2025-05-05T11:00:00.000+03:00'); // текущее fixedNow.hour
  });

  test('«завтрав в 25 тест» – неверный формат', async () => {
    const r = await parseReminder('завтрав в 25 тест', dummyChatId);
    expect(r.error).toMatch(/Не удалось распознать формат/);
  });

  test('«через 2 часа в 19 тест» – сложная конструкция', async () => {
    const r = await parseReminder('через 2 часа в 19 тест', dummyChatId);
    expect(r.error).toMatch(/Сложная временная конструкция/);
  });

  test('«сегодня утром зарядка» – время прошло', async () => {
    const r = await parseReminder('сегодня утром зарядка', dummyChatId);
    expect(r.error).toMatch(/Указанное время уже прошло/);
  });

  test('«завтра вечером встреча с другом»', async () => {
    const r = await parseReminder('завтра вечером встреча с другом', dummyChatId);
    expect(r.error).toBeNull();
    expect(r.reminderText).toBe('встреча с другом');
  });

  test('«в 9 обед»', async () => {
    const r = await parseReminder('в 9 обед', dummyChatId);
    expect(r.error).toBeNull();
    expect(r.timeSpec).toMatch(/в 9:00/);
  });
});

/* ──────────── parseReminder – повторения ───────────── */
describe('Функция parseReminder – повторяющиеся уведомления', () => {
  test('«каждые 30 минут проверка»', async () => {
    const r = await parseReminder('каждые 30 минут проверка', dummyChatId);
    expect(r.error).toBeNull();
    const dt = DateTime.fromJSDate(r.datetime).setZone(MOSCOW_ZONE);
    expect(dt.toISO()).toBe('2025-03-07T11:30:00.000+03:00');
  });

  test('«каждый месяц 15 числа зарплата»', async () => {
    const r = await parseReminder('каждый месяц 15 числа зарплата', dummyChatId);
    expect(r.error).toBeNull();
    const dt = DateTime.fromJSDate(r.datetime).setZone(MOSCOW_ZONE);
    expect(dt.day).toBe(15);
  });

  test('«каждый год 17 апреля днюха»', async () => {
    const r = await parseReminder('каждый год 17 апреля днюха', dummyChatId);
    expect(r.error).toBeNull();
    const dt = DateTime.fromJSDate(r.datetime).setZone(MOSCOW_ZONE);
    expect(dt.month).toBe(4);
    expect(dt.day).toBe(17);
  });

  test('«каждый понедельник тренирова»', async () => {
    const r = await parseReminder('каждый понедельник тренирова', dummyChatId);
    expect(r.error).toBeNull();
    const dt = DateTime.fromJSDate(r.datetime).setZone(MOSCOW_ZONE);
    expect(dt.weekday).toBe(1);
  });

  test('«каждые 15 минут проверить почту»', async () => {
    const r = await parseReminder('каждые 15 минут проверить почту', dummyChatId);
    expect(r.error).toBeNull();
    const dt = DateTime.fromJSDate(r.datetime).setZone(MOSCOW_ZONE);
    expect(dt.toISO()).toBe('2025-03-07T11:15:00.000+03:00');
  });

  test('«каждый четверг вопросы»', async () => {
    const r = await parseReminder('каждый четверг вопросы', dummyChatId);
    expect(r.error).toBeNull();
    const dt = DateTime.fromJSDate(r.datetime).setZone(MOSCOW_ZONE);
    expect(dt.weekday).toBe(4);
  });

  test('«каждый 17 апреля днюха»', async () => {
    const r = await parseReminder('каждый 17 апреля днюха', dummyChatId);
    expect(r.error).toBeNull();
    const dt = DateTime.fromJSDate(r.datetime).setZone(MOSCOW_ZONE);
    expect(dt.month).toBe(4);
    expect(dt.day).toBe(17);
  });
});