const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Client } = require('pg');
const rating = require('../public/game-rating');

test('game ratings reward exceptional performances without using EA ratings', () => {
  const ordinary = { position: 'C', goals: 1, assists: 1, shots: 4, plus_minus: 1 };
  assert.equal(rating.calculate(ordinary), rating.calculate({ ...ordinary, overall_rating: 99, offensive_rating: 99, defensive_rating: 99, team_play_rating: 99 }));
  assert.ok(rating.calculate(ordinary) < 80);
  assert.ok(rating.calculate({ position: 'C', plus_minus: -5, giveaways: 8, pim: 4 }) < rating.calculate(ordinary));
  assert.equal(rating.calculate({ position: 'C', goals: 4, assists: 4, plus_minus: 5, shots: 9, hits: 8, blocked_shots: 5, takeaways: 5 }), 99);
  assert.equal(rating.calculate({ position: 'G', shots_against: 20, saves: 20, goals_against: 0 }), 99);
  assert.ok(rating.calculate({ position: 'G', shots_against: 10, saves: 4, goals_against: 6 }) < 70);
  assert.equal(rating.calculate({ position: 'G', shots_against: 0 }), null);
});

test('career averages use individual rated games, not equally weighted seasons or historical totals', () => {
  const source = fs.readFileSync(require.resolve('../public/player.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.slice(0, source.indexOf('// ── Skater stats row')), context);
  const rows = [
    { gp: 2, overall_rating: 70, overall_rating_sum: 140, overall_rating_count: 2 },
    { gp: 1, overall_rating: 99, overall_rating_sum: 99, overall_rating_count: 1 },
    { gp: 20, goals: 100, is_historical: 1 },
  ];
  for (const name of ['sumSkaterRows', 'sumGoalieRows']) {
    const total = context[name](rows);
    assert.equal(total.overall_rating, 80);
    assert.equal(total.overall_rating_count, 3);
    assert.equal(context.computeOvr(total), 80);
    assert.equal(context.computeOvr({ gp: 20, goals: 100, overall_rating: 0 }), null);
  }
});

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
test('SQL and browser calculate identical per-game ratings', { skip: !connectionString }, async () => {
  const client = new Client({ connectionString, ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    const fields = ['goals', 'assists', 'plus_minus', 'shots', 'hits', 'blocked_shots', 'takeaways', 'giveaways', 'pim', 'saves', 'shots_against', 'goals_against'];
    const cases = [
      { position: 'C', goals: 5, plus_minus: -2, shots: 19, hits: 4, blocked_shots: 1, takeaways: 3, giveaways: 15, pim: 2 },
      { position: 'C', goals: 4, assists: 4, plus_minus: 5, shots: 9, hits: 8, blocked_shots: 5, takeaways: 5 },
      { position: 'G', shots_against: 22, saves: 17, goals_against: 5 },
      { position: 'G', shots_against: 20, saves: 20, goals_against: 0 },
      { position: 'G', shots_against: 0 },
    ];
    for (const player of cases) {
      const projection = fields.map((f, i) => `$${i + 1}::numeric AS ${f}`).join(', ');
      const expression = rating.sqlExpression('gps', player.position === 'G');
      const result = await client.query(`SELECT ${expression} AS value FROM (SELECT ${projection}) gps`, fields.map(f => player[f] || 0));
      const value = result.rows[0].value;
      assert.equal(value === null ? null : Number(value), rating.calculate(player));
    }
  } finally {
    await client.end();
  }
});
