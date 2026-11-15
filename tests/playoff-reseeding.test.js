const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { pairWinners } = require('../public/playoff-seeding');

test('reseeding pairs top remaining seeds with bottom seeds deterministically', () => {
  const teams = [4, 1, 10, 2, 9, 3, 6, 5].map(seed => ({ seed, team_id: seed }));
  assert.deepEqual(pairWinners(teams).map(pair => pair.map(t => t.seed)), [[1, 10], [2, 9], [3, 6], [4, 5]]);
  assert.deepEqual(pairWinners([{ seed: 1, team_id: 3 }, { seed: 1, team_id: 1 }]).map(p => p.map(t => t.team_id)), [[1, 3]]);
  assert.throws(() => pairWinners(teams.slice(0, 3)), /even number/);
  assert.throws(() => pairWinners([{ team_id: 1, seed: null }, teams[0]]), /valid playoff seeds/);
  assert.throws(() => pairWinners([teams[0], teams[0]]), /more than once/);
});

test('advance-round creates and schedules reseeded matchups', async () => {
  const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
  const start = source.indexOf("app.post('/api/playoffs/:id/advance-round'");
  const end = source.indexOf('// PATCH /api/playoff-series/:id', start);
  let handler;
  const inserts = [], scheduled = [];
  const winners = [1, 4, 3, 2].map((id, i) => ({ series_number: i + 1, winner_id: id }));
  const db = { prepare(sql) {
    return {
      async get() {
        if (sql.includes('SELECT * FROM playoffs')) return { id: 1, season_id: 1, series_length: 7 };
        if (sql.includes('MAX(round_number)')) return { round: 1 };
        if (sql.includes('MAX(g.date)')) return { d: null };
        throw new Error(`Unexpected get: ${sql}`);
      },
      async all() {
        if (sql.includes('FROM playoff_series')) return winners;
        if (sql.includes('FROM playoff_teams')) return winners.map(s => ({ team_id: s.winner_id, seed: s.winner_id }));
        throw new Error(`Unexpected all: ${sql}`);
      },
      async run(...args) { inserts.push(args); return { lastInsertRowid: inserts.length }; },
    };
  } };
  const ctx = vm.createContext({
    app: { post(_path, _auth, fn) { handler = fn; } }, requireOwner() {},
    db, pairWinners, createSeriesSchedule: async (...args) => { scheduled.push(args); },
    getPlayoffBracket: async () => ({ ok: true }),
  });
  vm.runInContext(source.slice(start, end), ctx);
  const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ params: { id: 1 }, body: { series_start_date: '2026-11-16' } }, res);
  assert.deepEqual(inserts.map(args => args.slice(3, 7)), [[1, 4, 1, 4], [2, 3, 2, 3]]);
  assert.deepEqual(scheduled.map(args => args.slice(1, 3)), [[1, 4], [2, 3]]);
  assert.equal(res.body.ok, true);
});
