const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const start = source.indexOf('function _mso_stripTags(');
const end = source.indexOf('// Preview and import one MyStatsOnline game', start);
const parser = vm.createContext({ URL });
vm.runInContext(source.slice(start, end), parser);

const url = 'https://www.mystatsonline.com/hockey/visitor/league/schedule_scores/game_score_hockey.aspx?IDLeague=73879&IDGame=1960083';
const table = (id, headers, rows) => `<table id="${id}"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><td>TOTAL</td></tr></tfoot></table>`;
const html = `
  <i class="fa fa-calendar"></i> Tuesday October 6, 2026 - 9:00 PM
  <!-- LOGO / TEAM / TOTAL GOALS -->
  <span id="maincontent_labTeamSideLeft">Home</span><span class="mso-big mso-bold">Mustangs</span>
  <span class="mso-xbig">Final</span>
  <div id="maincontent_pnlLeftTotal"><strong>4</strong></div>
  <div id="maincontent_pnlRightTotal"><strong>7</strong></div>
  <span id="maincontent_labTeamSideRight">Away</span><span class="mso-big mso-bold">Blood Sweat &amp; Beers</span>
  <!-- STATS HEADER -->
  <div id="maincontent_divShots"><strong>21</strong><strong>SHOTS</strong><strong>23</strong></div><div id="maincontent_divPP">
  ${table('maincontent_gvSkatersVisitor_gvPlayers', ['PLAYERS', 'POS', 'G', 'A', 'TOI', 'PA', 'PC', 'PC%'], [['Player', 'C', '1', '3', '60', '21', '15', '71.4%']])}
  ${table('maincontent_gvGoaliesVisitor_gvPlayers', ['GOALIES', 'SA', 'GA', 'SV', 'SV%', 'TOI', 'W'], [['Goalie', '23', '4', '19', '.826', '60', 'X']])}
`;
const incompleteHtml = html.replace('>Final</span>', '>Pending</span>')
  .replace(table('maincontent_gvGoaliesVisitor_gvPlayers', ['GOALIES', 'SA', 'GA', 'SV', 'SV%', 'TOI', 'W'], [['Goalie', '23', '4', '19', '.826', '60', 'X']]), '');

test('parses the source teams, player sides, goalie result and minute TOI', () => {
  const header = parser._mso_parseGameHeader(html);
  assert.equal(header.home.name, 'Mustangs');
  assert.equal(header.away.name, 'Blood Sweat & Beers');
  assert.equal(header.home.shots, 21);
  assert.equal(header.away.score, 7);
  assert.equal(header.isFinal, true);
  const players = parser._mso_parseGameDetailHtml(html);
  assert.equal(players.homePlayers.length, 0);
  assert.equal(players.awayPlayers.length, 2);
  assert.equal(players.awayPlayers[0].toi, 3600);
  assert.equal(players.awayPlayers[0].pass_pct, 71.4);
  assert.equal(players.awayPlayers[1].goalie_wins, 1);
  assert.equal(players.awayPlayers[1].goals_against, 4);
  assert.equal(parser._mso_toiSeconds('60:30'), 3630);
  assert.equal('hits' in players.awayPlayers[0], false);
});

test('parses a scored non-final game without a goalie and rejects missing scores', () => {
  const header = parser._mso_parseGameHeader(incompleteHtml);
  assert.equal(header.isFinal, false);
  assert.equal(header.status, 'Pending');
  assert.equal(parser._mso_parseGameDetailHtml(incompleteHtml).awayPlayers.length, 1);
  assert.throws(() => parser._mso_parseGameHeader(incompleteHtml.replace('<strong>4</strong>', '<strong>-</strong>')), /no recorded score/);
});

test('accepts only canonical MyStatsOnline game URLs', () => {
  assert.equal(parser._mso_gameUrl(url), url);
  for (const bad of ['http://www.mystatsonline.com/', 'https://www.mystatsonline.com.evil.test/', url + '&IDGame=1', url.replace('1960083', 'x')]) {
    assert.throws(() => parser._mso_gameUrl(bad));
  }
});

test('preview and import reverse sides safely and preserve unmatched players', async () => {
  const writes = [];
  const game = { id: 1, home_team_id: 19, away_team_id: 71, home_name: 'Blood Sweat & Beers', away_name: 'Mustangs' };
  const tx = { prepare(sql) { return {
    async get() {
      if (sql.includes('FOR UPDATE')) return game;
      if (sql.includes('FROM players')) return { id: 1 };
      return null;
    },
    async all() { return [{ id: 42 }]; },
    async run(...args) { writes.push({ sql, args }); },
  }; } };
  const db = {
    prepare() { return { async get() { return game; } }; },
    async transaction(fn) { await fn(tx); },
  };
  let handler;
  const context = vm.createContext({
    URL, crypto, db, console,
    requireAdmin() {},
    app: { post(_path, _auth, fn) { handler = fn; } },
    _mso_fetchUrl: async () => ({ status: 200, body: html }),
    capScoreDifferential: (h, a) => ({ home_score: h, away_score: a }),
  });
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext(source.slice(end, source.indexOf('function _parseScheduleDate', end)), context);
  const call = async body => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ params: { id: '1' }, body }, res);
    return res;
  };
  const preview = await call({ url });
  assert.equal(preview.code, 200);
  assert.equal(preview.body.preview.homePlayers.length, 2);
  assert.equal(preview.body.preview.awayPlayers.length, 0);
  assert.equal(writes.length, 0);
  assert.equal((await call({ url, confirm: true, digest: 'wrong' })).code, 409);
  const result = await call({ url, confirm: true, digest: preview.body.digest });
  assert.equal(result.code, 200);
  assert.deepEqual(writes[0].args.slice(0, 4), [7, 4, 23, 21]);
  assert.equal(writes.filter(w => w.sql.startsWith('UPDATE game_player_stats')).length, 2);
  assert.equal(writes.some(w => /DELETE/.test(w.sql)), false);
  assert.equal(writes.some(w => /overall_rating/.test(w.sql)), false);
});

test('individual forfeit uses the schedule winner and reverses the side when needed', async () => {
  const writes = [];
  const game = { id: 1, home_team_id: 19, away_team_id: 71, home_name: 'Blood Sweat & Beers', away_name: 'Mustangs' };
  const tx = { prepare(sql) { return {
    async get() { return game; }, async all() { return []; },
    async run(...args) { writes.push({ sql, args }); },
  }; } };
  const db = { prepare: tx.prepare, async transaction(fn) { await fn(tx); } };
  let handler;
  const c = vm.createContext({
    URL, crypto, db, console, requireAdmin() {},
    app: { post(_path, _auth, fn) { handler = fn; } },
    _mso_fetchUrl: async () => ({ status: 200, body: html.replace('>Final</span>', '>Forfeit</span>') }),
    _mso_scheduleUrl: value => value,
    _mso_schedule: async () => ({ games: [{ id: '1960083', home: 'Mustangs', away: 'Blood Sweat & Beers',
      home_score: 4, away_score: 7, is_forfeit: true, forfeit_winner: 'home' }] }),
    _mso_updateGoalieResults: async (_tx, _id, _home, _away, winner) => { assert.equal(winner, 'away'); },
    capScoreDifferential: (h, a) => ({ home_score: h, away_score: a }),
  });
  vm.runInContext(source.slice(start, end), c);
  vm.runInContext(source.slice(end, source.indexOf('function _parseScheduleDate', end)), c);
  const call = async body => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ params: { id: '1' }, body }, res);
    return res;
  };
  assert.equal((await call({ url })).code, 422);
  const schedule_url = 'https://www.mystatsonline.com/hockey/visitor/league/schedule_scores/schedule.aspx?IDLeague=73879&IDSeason=108797';
  const preview = await call({ url, schedule_url });
  assert.equal(preview.body.preview.forfeit_winner, 'away');
  assert.equal((await call({ url, schedule_url, confirm: true, digest: preview.body.digest })).code, 200);
  const update = writes.find(w => w.sql.startsWith('UPDATE games'));
  assert.deepEqual(update.args.slice(0, 2), [7, 4]);
  assert.equal(update.args[4], 'forfeit');
  assert.equal(update.args[6], 'away');
});

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
test('import writes correct players and preserves missing team stats in a database transaction', { skip: !connectionString }, async () => {
  const { Client } = require('pg');
  const client = new Client({ connectionString, ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false } });
  await client.connect();
  const tx = {
    prepare(sql) {
      let n = 0;
      const query = sql.replace(/\?/g, () => `$${++n}`);
      return {
        async get(...args) { return (await client.query(query, args)).rows[0]; },
        async all(...args) { return (await client.query(query, args)).rows; },
        async run(...args) { return client.query(query, args); },
      };
    },
  };
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE teams (id int, name text) ON COMMIT DROP;
      CREATE TEMP TABLE games (id int, home_team_id int, away_team_id int, home_score int, away_score int, home_shots int, away_shots int, status text, is_forfeit int, is_overtime int, playoff_series_id int, forfeit_winner text) ON COMMIT DROP;
      CREATE TEMP TABLE game_player_stats (id serial, game_id int, team_id int, player_name text, position text, overall_rating int DEFAULT 0, goals int DEFAULT 0, assists int DEFAULT 0, toi int DEFAULT 0, pass_attempts int DEFAULT 0, pass_completions int DEFAULT 0, pass_pct real, shots_against int DEFAULT 0, goals_against int DEFAULT 0, saves int DEFAULT 0, save_pct real, goalie_wins int DEFAULT 0) ON COMMIT DROP;
      CREATE TEMP TABLE players (id serial, name text, team_id int, position text, user_id int, is_rostered int) ON COMMIT DROP;
      CREATE TEMP TABLE users (id int, username text) ON COMMIT DROP;
      INSERT INTO teams VALUES (19,'Blood Sweat & Beers'),(71,'Mustangs');
      INSERT INTO games VALUES (1,19,71,0,0,NULL,NULL,'scheduled',0,0,NULL,NULL);
      INSERT INTO game_player_stats (game_id,team_id,player_name,position,overall_rating,goals,toi,saves,shots_against,goals_against) VALUES
        (1,19,'Player','C',92,9,10,0,0,0),(1,71,'Existing opponent','C',77,2,3600,0,0,0),
        (1,19,'Existing goalie','G',88,0,3600,19,23,4);
    `);
    const db = { prepare: tx.prepare, async transaction(fn) { await fn(tx); } };
    let handler;
    const context = vm.createContext({ URL, crypto, db, console, requireAdmin() {},
      app: { post(_path, _auth, fn) { handler = fn; } },
      _mso_fetchUrl: async () => ({ status: 200, body: incompleteHtml }),
      capScoreDifferential: (h, a) => ({ home_score: h, away_score: a }),
    });
    vm.runInContext(source.slice(start, end), context);
    vm.runInContext(source.slice(end, source.indexOf('function _parseScheduleDate', end)), context);
    const call = async body => {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
      await handler({ params: { id: '1' }, body }, res);
      return res;
    };
    const preview = await call({ url });
    assert.equal(preview.body.preview.source.isFinal, false);
    assert.equal(preview.body.preview.homePlayers.length, 1);
    const result = await call({ url, confirm: true, digest: preview.body.digest });
    assert.equal(result.code, 200, JSON.stringify(result.body));
    const rows = (await client.query('SELECT player_name, team_id, goals, toi, overall_rating FROM game_player_stats ORDER BY player_name')).rows;
    assert.deepEqual(rows, [
      { player_name: 'Existing goalie', team_id: 19, goals: 0, toi: 3600, overall_rating: 88 },
      { player_name: 'Existing opponent', team_id: 71, goals: 2, toi: 3600, overall_rating: 77 },
      { player_name: 'Player', team_id: 19, goals: 1, toi: 3600, overall_rating: 92 },
    ]);
    assert.deepEqual((await client.query("SELECT saves,shots_against,goals_against FROM game_player_stats WHERE player_name='Existing goalie'")).rows[0],
      { saves: 19, shots_against: 23, goals_against: 4 });
    assert.deepEqual((await client.query('SELECT home_score, away_score, home_shots, away_shots FROM games')).rows[0],
      { home_score: 7, away_score: 4, home_shots: 23, away_shots: 21 });
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
