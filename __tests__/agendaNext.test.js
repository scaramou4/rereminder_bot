/**
 * computeNextTimeFromScheduled для разных repeat
 */
const { DateTime } = require('luxon');
const { computeNextTimeFromScheduled } = require('../src/dateParser');
const { MOSCOW_ZONE } = require('../src/constants');

describe('Agenda - следующий запуск', () => {
  const base  = DateTime.fromISO('2025-03-07T11:00:00', { zone:MOSCOW_ZONE });

  test.each([
    ['каждый час',           'час',    { hours:1 }],
    ['каждое утро',          'утро',   { days:1 }],
    ['каждый вечер',         'вечер',  { days:1 }],
    ['каждый день',          'день',   { days:1 }]
  ])('%s', (_label, repeatUnit, delta) => {
    const next = computeNextTimeFromScheduled(base.toJSDate(), `каждый ${repeatUnit}`, MOSCOW_ZONE);
    const expected = base.plus(delta).toISO();
    expect(DateTime.fromJSDate(next).setZone(MOSCOW_ZONE).toISO()).toBe(expected);
  });
});