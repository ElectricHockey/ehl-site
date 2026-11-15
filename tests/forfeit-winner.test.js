const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const winnerFunctions = source.slice(source.indexOf('function gameWinnerSide('), source.indexOf('/** Validate and normalise a game_time'));
const game = { home_team_id: 1, away_team_id: 2, home_score: 9, away_score: 2, status: 'forfeit', is_forfeit: 1, forfeit_winner: 'away' };

test('adding a forfeit saves its chosen winner and uncapped score', async () => {
  let handler, written;
  const ctx = vm.createContext({
    app: { post(_path, _auth, fn) { handler = fn; } },
    requireAdmin() {},
    parseGameTime: () => null,
    db: { prepare() { return { async run(...args) { written = args; return { lastInsertRowid: 42 }; } }; } },
  });
  vm.runInContext(winnerFunctions + source.slice(source.indexOf("app.post('/api/games'"), source.indexOf("app.delete('/api/games/:id'")), ctx);
  const call = async body => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ body }, res);
    return res;
  };
  const body = { ...game, date: '2026-10-08' };
  const result = await call(body);
  assert.equal(result.code, 201);
  assert.equal(result.body.home_score, 9);
  assert.equal(result.body.away_score, 2);
  assert.equal(result.body.forfeit_winner, 'away');
  assert.equal(written[11], 'away');
  assert.equal((await call({ ...body, forfeit_winner: 'invalid' })).code, 400);
  assert.equal((await call({ ...body, status: 'complete', is_forfeit: 0 })).code, 400);
  assert.equal((await call({ ...body, forfeit_winner: null })).code, 201);
});

test('winner selection is consistent with legacy scores and ignores stale winners', () => {
  for (const code of [winnerFunctions, fs.readFileSync(require.resolve('../public/game-outcome.js'), 'utf8')]) {
    const ctx = vm.createContext({});
    vm.runInContext(code, ctx);
    assert.equal(ctx.gameWinnerSide(game), 'away');
    assert.equal(ctx.gameWinnerSide({ ...game, forfeit_winner: null }), 'home');
    assert.equal(ctx.gameWinnerSide({ ...game, status: 'complete', is_forfeit: 0 }), 'home');
    assert.equal(ctx.gameWinnerSide({ ...game, home_score: 2, away_score: 2, forfeit_winner: null }), null);
    assert.equal(ctx.gameWinnerSide({ ...game, home_score: 2, away_score: 2 }), 'away');
  }
});

test('standings count the selected forfeit winner while retaining the score', async () => {
  const teams = [{ id: 1, name: 'Home' }, { id: 2, name: 'Away' }];
  const db = { prepare(sql) { return { async all() {
    if (sql.includes('FROM games')) return [game];
    if (sql.includes('FROM teams')) return teams;
    return [];
  } }; } };
  const ctx = vm.createContext({ db });
  vm.runInContext(winnerFunctions + source.slice(source.indexOf('async function calcStandings('), source.indexOf('// ── Standings ──')), ctx);
  const rows = await ctx.calcStandings(null);
  const home = rows.find(t => t.id === 1), away = rows.find(t => t.id === 2);
  assert.equal(away.w, 1);
  assert.equal(home.l, 1);
  assert.equal(home.gf, 9);
  assert.equal(away.gf, 2);
});

test('playoff series records the selected winner instead of the score winner', async () => {
  let update;
  const db = { prepare(sql) { return {
    async get() {
      if (sql.includes('playoff_series')) return { playoff_id: 5, high_seed_id: 1, low_seed_id: 2 };
      return { series_length: 1 };
    },
    async all() { return [game]; },
    async run(...args) { if (sql.startsWith('UPDATE')) update = args; },
  }; } };
  const ctx = vm.createContext({ db });
  vm.runInContext(winnerFunctions + source.slice(source.indexOf('async function recomputeSeriesWins('), source.indexOf('// GET /api/playoff-series/:id/games')), ctx);
  await ctx.recomputeSeriesWins(10);
  assert.deepEqual(update, [0, 1, 2, 10]);
});

test('editor preserves scores and does not replace unchanged player stats for a forfeit', async () => {
  const elements = {
    'gse-status': { value: 'complete', addEventListener() {} },
    'gse-forfeit-winner': { value: 'away' },
    'gse-home-score': { value: '9' },
    'gse-away-score': { value: '2' },
    'gse-date': { value: '2026-10-08' },
    'gse-time': { value: '' },
    'gse-season': { value: '1' },
    'gse-overtime': { checked: false },
    'gse-error': { style: {} },
  };
  const overlay = { style: {}, addEventListener() {}, remove() {} };
  let saved;
  const ctx = vm.createContext({
    window: {},
    GameTime: require('../public/game-time'),
    document: {
      createElement: () => overlay,
      getElementById: id => elements[id] || null,
      querySelectorAll: () => [],
      body: { appendChild() {} },
    },
    fetch: async (_url, options) => {
      if (options.method === 'PATCH') { saved = JSON.parse(options.body); return { ok: true }; }
      return { ok: true, json: async () => ({
        game: { ...game, date: '2026-10-08', status: 'complete', is_forfeit: 0, raw_home_score: 9, raw_away_score: 2,
          home_team: { name: 'Home' }, away_team: { name: 'Away' } },
        home_players: [], away_players: [],
      }) };
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../public/game-stats-editor.js'), 'utf8'), ctx);
  await ctx.window.editGameStats(1);
  elements['gse-status'].value = 'forfeit';
  await ctx.window.saveGameStatsEdits();
  assert.equal(saved.home_score, 9);
  assert.equal(saved.away_score, 2);
  assert.equal(saved.forfeit_winner, 'away');
  assert.equal('player_stats' in saved, false);
});
