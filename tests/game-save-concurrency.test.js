const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function makeHandler() {
  const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
  const start = source.indexOf("app.patch('/api/games/:id'");
  const end = source.indexOf('// ── Saved game stats', start);
  let handler, lock = Promise.resolve();
  let game = { id: 1, home_team_id: 1, away_team_id: 2, home_score: 0, away_score: 0, status: 'scheduled' };
  let records = [], failInsert = false;
  const db = {
    async transaction(fn) {
      let release;
      const previous = lock;
      lock = new Promise(resolve => { release = resolve; });
      await previous;
      const before = { game: { ...game }, records: [...records] };
      const tx = { prepare(sql) {
        return {
          async get() {
            assert.match(sql, /FOR UPDATE/);
            return { ...game };
          },
          async all() { return []; },
          async run(...args) {
            await new Promise(resolve => setTimeout(resolve, 1));
            if (sql.startsWith('UPDATE games')) {
              game = { ...game, home_score: args[0], away_score: args[1], status: args[3], is_forfeit: args[6], forfeit_winner: args[11] };
            } else if (sql.startsWith('DELETE FROM game_player_stats')) {
              records = [];
            } else if (sql.startsWith('INSERT INTO game_player_stats')) {
              if (failInsert) throw new Error('insertion failed');
              records.push({ team: args[1], name: args[2], goals: args[8] });
            }
          },
        };
      } };
      try { await fn(tx); }
      catch (err) { game = before.game; records = before.records; throw err; }
      finally { release(); }
    },
  };
  const context = vm.createContext({
    db, console: { error() {} },
    app: { patch(_path, _auth, fn) { handler = fn; } },
    requireAdmin() {}, ensurePlayerRecord: async () => {},
    capScoreDifferential: (h, a) => ({ home_score: h, away_score: a }),
    recomputeSeriesWins: async () => {},
  });
  vm.runInContext(source.slice(start, end), context);
  const call = async body => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ params: { id: '1' }, body }, res);
    return res;
  };
  return { call, state: () => ({ game, records }), fail: () => { failInsert = true; } };
}

test('concurrent game saves serialize and leave only one set of player stats', async () => {
  const { call, state } = makeHandler();
  const body = { status: 'complete', ea_match_id: 'a', player_stats: {
    home_players: [{ name: 'Home', position: 'C', goals: 2 }],
    away_players: [{ name: 'Away', position: 'G' }],
  } };
  const responses = await Promise.all([call(body), call(body)]);
  assert.deepEqual(responses.map(r => r.code), [200, 200]);
  assert.deepEqual(state().records.map(r => r.name), ['Home', 'Away']);
  assert.equal(state().game.home_score, 2);
});

test('duplicate player submissions are rejected and failed inserts roll back', async () => {
  const { call, state, fail } = makeHandler();
  const initial = { status: 'complete', ea_match_id: 'a', player_stats: {
    home_players: [{ name: 'One', position: 'C', goals: 2 }], away_players: [],
  } };
  assert.equal((await call(initial)).code, 200);
  const before = JSON.stringify(state());
  const duplicate = { ...initial, player_stats: { home_players: [{ name: 'One', position: 'C' }, { name: ' one ', position: 'LW' }] } };
  assert.equal((await call(duplicate)).code, 400);
  assert.equal(JSON.stringify(state()), before);
  fail();
  assert.equal((await call({ ...initial, home_score: 8 })).code, 500);
  assert.equal(JSON.stringify(state()), before);
});

test('forfeit winner can differ from the score without changing scores or player stats', async () => {
  const { call, state } = makeHandler();
  assert.equal((await call({ status: 'complete', home_score: 9, away_score: 2,
    player_stats: { home_players: [{ name: 'Home', goals: 9 }], away_players: [] } })).code, 200);
  const records = JSON.stringify(state().records);
  assert.equal((await call({ status: 'forfeit', is_forfeit: 1, forfeit_winner: 'away' })).code, 200);
  assert.equal(state().game.home_score, 9);
  assert.equal(state().game.away_score, 2);
  assert.equal(state().game.forfeit_winner, 'away');
  assert.equal(JSON.stringify(state().records), records);
  assert.equal((await call({ forfeit_winner: 'invalid' })).code, 400);
  assert.equal(state().game.forfeit_winner, 'away');
  assert.equal((await call({ status: 'complete' })).code, 200);
  assert.equal(state().game.forfeit_winner, null);
});

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
test('game save works with PostgreSQL and rolls back an insertion error', { skip: !connectionString }, async () => {
  const { Client } = require('pg');
  const client = new Client({ connectionString, ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE games (LIKE public.games INCLUDING DEFAULTS) ON COMMIT DROP;
      ALTER TABLE games ADD COLUMN IF NOT EXISTS forfeit_winner TEXT;
      CREATE TEMP TABLE game_player_stats (LIKE public.game_player_stats INCLUDING DEFAULTS) ON COMMIT DROP;
      INSERT INTO games (id, home_team_id, away_team_id, status, home_score, away_score, date)
        VALUES (1, 1, 2, 'scheduled', 0, 0, '2026-10-08');
    `);
    let fail = false, handler;
    const tx = { prepare(sql) {
      let n = 0;
      const statement = sql.replace(/\?/g, () => `$${++n}`);
      return {
        async get(...args) { return (await client.query(statement, args)).rows[0]; },
        async all(...args) { return (await client.query(statement, args)).rows; },
        async run(...args) {
          if (fail && sql.startsWith('INSERT INTO game_player_stats')) throw new Error('insertion failed');
          return client.query(statement, args);
        },
      };
    } };
    const db = { async transaction(fn) {
      await client.query('SAVEPOINT game_save');
      try { await fn(tx); await client.query('RELEASE SAVEPOINT game_save'); }
      catch (err) { await client.query('ROLLBACK TO SAVEPOINT game_save'); throw err; }
    } };
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf("app.patch('/api/games/:id'");
    const end = source.indexOf('// ── Saved game stats', start);
    vm.runInContext(source.slice(start, end), vm.createContext({
      db, console: { error() {} }, app: { patch(_path, _auth, fn) { handler = fn; } },
      requireAdmin() {}, ensurePlayerRecord: async () => {}, recomputeSeriesWins: async () => {},
      capScoreDifferential: (h, a) => ({ home_score: h, away_score: a }),
    }));
    const call = async body => {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
      await handler({ params: { id: '1' }, body }, res);
      return res;
    };
    const body = { status: 'complete', ea_match_id: 'a', player_stats: {
      home_players: [{ name: 'Home', position: 'C', goals: 2 }],
      away_players: [{ name: 'Away', position: 'G' }],
    } };
    assert.equal((await call(body)).code, 200);
    const read = async () => ({
      game: (await client.query('SELECT home_score,away_score,status FROM games')).rows,
      players: (await client.query('SELECT player_name,team_id,goals FROM game_player_stats ORDER BY player_name')).rows,
    });
    const before = await read();
    assert.equal(before.players.length, 2);
    assert.equal((await call({ status: 'forfeit', is_forfeit: 1, forfeit_winner: 'away' })).code, 200);
    const forfeited = await read();
    assert.equal(forfeited.game[0].home_score, before.game[0].home_score);
    assert.equal(forfeited.game[0].away_score, before.game[0].away_score);
    assert.deepEqual(forfeited.players, before.players);
    const winner = await client.query('SELECT forfeit_winner FROM games');
    assert.equal(winner.rows[0].forfeit_winner, 'away');
    const goalie = await client.query("SELECT goalie_wins, goalie_losses FROM game_player_stats WHERE player_name = 'Away'");
    assert.deepEqual(goalie.rows[0], { goalie_wins: 1, goalie_losses: 0 });
    fail = true;
    assert.equal((await call({ ...body, player_stats: { home_players: [{ name: 'Other', goals: 5 }] } })).code, 500);
    assert.deepEqual(await read(), forfeited);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
