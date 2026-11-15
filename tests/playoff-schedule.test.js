const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSeriesGameSlots, normalizeSlots } = require('../playoff-schedule');

test('default 3s slots: Monday games 1-3, Thursday games 4-7', () => {
  const g = buildSeriesGameSlots('2026-11-16', 7, null);
  assert.deepEqual(g.map(x => `${x.date} ${x.time}`), [
    '2026-11-16 21:00', '2026-11-16 21:35', '2026-11-16 22:10', '2026-11-19 21:00',
    '2026-11-19 21:35', '2026-11-19 22:10', '2026-11-19 22:45',
  ]);
});

test('default 6s slots: Tuesday games 1-3, Wednesday games 4-7', () => {
  const g = buildSeriesGameSlots('2026-11-16', 7, normalizeSlots(null, 'sixes'));
  assert.deepEqual(g.map(x => x.date), ['2026-11-17', '2026-11-17', '2026-11-17', '2026-11-18', '2026-11-18', '2026-11-18', '2026-11-18']);
});

test('first game moves to the next matching weekday on/after the start date', () => {
  const g = buildSeriesGameSlots('2026-11-17', 3, null);
  assert.equal(g[0].date, '2026-11-23');
});

test('custom slots are honored', () => {
  const g = buildSeriesGameSlots('2026-11-16', 2, [{ weekday: 2, time: '20:00' }, { weekday: 3, time: '20:30' }]);
  assert.deepEqual(g, [{ date: '2026-11-17', time: '20:00' }, { date: '2026-11-18', time: '20:30' }]);
});
