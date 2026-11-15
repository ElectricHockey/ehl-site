const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const parserStart = source.indexOf('function _mso_stripTags(');
const parserEnd = source.indexOf('// Preview and import one MyStatsOnline game', parserStart);
const scheduleStart = source.indexOf('function _parseScheduleDate(');
const scheduleEnd = source.indexOf('// ── Excel / CSV schedule import endpoint', scheduleStart);
const url = 'https://www.mystatsonline.com/hockey/visitor/league/schedule_scores/schedule.aspx?IDLeague=73879&IDSeason=108797';
const gameUrl = 'https://www.mystatsonline.com/hockey/visitor/league/schedule_scores/game_score_hockey.aspx?IDLeague=73879&IDGame=123';
const row = (id, cls = 'game-completed', time = '9:00 PM') => `<tr class="detail ${cls}">
  <td><a href="game_score_hockey.aspx?IDLeague=73879&amp;IDGame=${id}">${time}</a></td>
  <td>Home</td><td>9</td><td>OT</td><td>${cls === 'game-forfeit' ? '<strong>1</strong>' : '1'}</td><td>${cls === 'game-forfeit' ? '<strong>Away</strong>' : 'Away'}</td><td></td><td></td></tr>`;
const schedule = `<a href="${gameUrl.replace('123', '999')}">carousel</a>
  <table id="maincontent_gvGameList"><tr class="day-row"><td>Tuesday October 6, 2026</td></tr>
  ${row('123')}${row('124', 'game-forfeit', '10:00 PM')}${row('125', '', '11:00 PM').replace('<td>9</td><td>OT</td><td>1</td>', '<td>-</td><td></td><td>-</td>')}</table>`;
const detail = `<!-- LOGO / TEAM / TOTAL GOALS -->
  <span id="maincontent_labTeamSideLeft">Home</span><span class="mso-big mso-bold">Home</span>
  <span class="mso-xbig">Final</span>
  <div id="maincontent_pnlLeftTotal"><strong>9</strong></div><div id="maincontent_pnlRightTotal"><strong>1</strong></div>
  <span id="maincontent_labTeamSideRight">Away</span><span class="mso-big mso-bold">Away</span>
  <!-- STATS HEADER -->
  <table id="maincontent_gvSkatersHome_gvPlayers"><tr><th>PLAYERS</th><th>POS</th><th>G</th><th>A</th></tr>
  <tr><td>Player</td><td>C</td><td>2</td><td>1</td></tr></table>`;
const controls = month => `
  <select id="breadendcontent_ddlSeason"><option selected="selected" value="108797">Season</option></select>
  <select id="maincontent_ddlMonth"><option selected="selected" value="${month}">Month</option></select>
  <select id="maincontent_ddlStatus"><option selected="selected" value="-1">Status</option></select>
  <select id="maincontent_ddlLocation"><option selected="selected" value="0">Location</option></select>
  <select id="maincontent_ddlTeam"><option selected="selected" value="">Team</option></select>`;
const initialSchedule = `${controls('-1')}<input type="hidden" name="__VIEWSTATE" value="state+value">
  <input type="hidden" name="__EVENTVALIDATION" value="validation">
  <div id="maincontent_pnlNoGameFound">No game found</div>`;

function context(extra = {}) {
  const c = vm.createContext({ URL, URLSearchParams, Buffer, crypto, console, DISCORD_STATE_SECRET: 'test-secret', ...extra });
  vm.runInContext(source.slice(source.indexOf('function _signPayload('), source.indexOf('// ── Stateless session tokens')), c);
  vm.runInContext(source.slice(parserStart, parserEnd), c);
  vm.runInContext(source.slice(scheduleStart, scheduleEnd), c);
  return c;
}

test('validates schedule links and only parses the schedule table', () => {
  const c = context({ app: { post() {} }, requireOwner() {} });
  assert.equal(c._mso_scheduleUrl(url), url);
  for (const bad of [url.replace('https:', 'http:'), url.replace('www.mystatsonline.com', 'www.mystatsonline.com.evil.test'), url + '&IDSeason=1', url.replace('108797', 'abc')]) {
    assert.throws(() => c._mso_scheduleUrl(bad));
  }
  const games = c._mso_parseSchedule(schedule, url);
  assert.equal(games.length, 3);
  assert.equal(games[0].id, '123');
  assert.equal(games[0].date, '2026-10-06');
  const playoff = schedule.replace('<tr class="day-row">', '<tr class="round-row"><td>ROUND 2 - Semifinals</td></tr><tr class="day-row">');
  assert.equal(c._mso_parseSchedule(playoff, url)[0].round, 2);
  assert.equal(games[0].time, '21:00');
  const numbered = schedule.replace('>9:00 PM</a>', '>001 - 9:00 PM</a>');
  assert.equal(c._mso_parseSchedule(numbered, url)[0].time, '21:00');
  const withEvent = schedule.replace('</table>', '<tr class="detail event-row"><td>10:00 PM</td><td colspan="5">Deadline</td><td></td><td></td></tr></table>');
  assert.equal(c._mso_parseSchedule(withEvent, url).length, 3);
  assert.equal(games[0].is_overtime, true);
  assert.equal(games[1].status, 'forfeit');
  assert.equal(games[1].forfeit_winner, 'away');
  const missingWinner = schedule.replace('<strong>1</strong>', '1').replace('<strong>Away</strong>', 'Away');
  assert.equal(c._mso_parseSchedule(missingWinner, url)[1].forfeit_winner, null);
  const conflicting = schedule.replace('<td>Home</td><td>9</td><td>OT</td><td><strong>1</strong>', '<td><strong>Home</strong></td><td>9</td><td>OT</td><td><strong>1</strong>');
  assert.equal(c._mso_parseSchedule(conflicting, url)[1].forfeit_winner, null);
  assert.equal(games[2].status, 'scheduled');
  assert.equal(c._mso_parseSchedule(schedule.replace('class="detail game-completed"', 'class="detail"'), url)[0].non_final_score, true);
  assert.throws(() => c._mso_parseSchedule(schedule.replace('<td>9</td><td>OT</td><td>1</td>', '<td>9</td><td>OT</td><td>-</td>'), url), /invalid teams or scores/);
  assert.equal(c._mso_parseSchedule('<div id="maincontent_pnlNoGameFound">No game found</div>', url).length, 0);
  assert.throws(() => c._mso_parseSchedule('<html>unexpected page</html>', url), /table was not found/);
  assert.throws(() => c._mso_parseSchedule(schedule.replace(row('124', 'game-forfeit', '10:00 PM'), row('123')), url), /Duplicate game/);
});

test('requests all months before discovering season game IDs', async () => {
  const requests = [];
  const c = context({
    app: { post() {} }, requireOwner() {},
    _mso_fetchUrl: async (input, _redirects, options) => {
      requests.push({ input, options });
      if (!options) return { status: 200, body: initialSchedule, cookies: ['ASP.NET_SessionId=abc123; path=/; HttpOnly'] };
      return { status: 200, body: controls('0') + schedule };
    },
  });
  const result = await c._mso_schedule(url);
  assert.equal(result.games.length, 3);
  assert.equal(result.games[0].id, '123');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.cookie, 'ASP.NET_SessionId=abc123');
  const fields = new URLSearchParams(requests[1].options.body);
  assert.equal(fields.get('__VIEWSTATE'), 'state+value');
  assert.equal(fields.get('ctl00$maincontent$ddlMonth'), '0');
  assert.equal(fields.get('ctl00$breadendcontent$ddlSeason'), '108797');

  c._mso_fetchUrl = async (_input, _redirects, options) => options
    ? { status: 200, body: controls('-1') + schedule }
    : { status: 200, body: initialSchedule };
  await assert.rejects(() => c._mso_schedule(url), /did not apply/);
});

test('reads an unfiltered playoff schedule without a month selector or POST', async () => {
  let requests = 0;
  const playoffControls = controls('0')
    .replace('>Season</option>', '>Season 10 Playoffs</option>')
    .replace(/<select id="maincontent_ddlMonth">[\s\S]*?<\/select>/, '');
  const c = context({
    app: { post() {} }, requireOwner() {},
    _mso_fetchUrl: async () => { requests++; return { status: 200, body: playoffControls + schedule }; },
  });
  const result = await c._mso_schedule(url);
  assert.equal(result.is_playoff, true);
  assert.equal(result.source_season, 'Season 10 Playoffs');
  assert.equal(result.games.length, 3);
  assert.equal(requests, 1);
  c._mso_fetchUrl = async () => ({ status: 200, body: playoffControls.replace('value="-1"', 'value="1"') + schedule });
  await assert.rejects(() => c._mso_schedule(url), /did not select all playoff games/);
});

test('only skips safely matched games, including older games without times', () => {
  const c = context({ app: { post() {} }, requireOwner() {} });
  const games = c._mso_parseSchedule(schedule, url);
  const game = games[0];
  const existing = { id: 8, date: game.date, game_time: '21:00', home_name: 'Home', away_name: 'Away', ea_match_id: 'ea:1' };
  assert.equal(c._mso_matchingExistingGame(game, games, [existing]).id, 8);
  assert.equal(c._mso_matchingExistingGame(game, games, [{ ...existing, game_time: null }]), null);
  assert.equal(c._mso_matchingExistingGame(game, [game], [{ ...existing, game_time: null }]).id, 8);
  assert.equal(c._mso_matchingExistingGame(game, [game], [existing, { ...existing, id: 9, game_time: null }]), null);
  assert.equal(c._mso_matchingExistingGame(game, [game], [{ ...existing, ea_match_id: 'mso:other' }]), null);
  assert.equal(c._mso_matchingExistingGame(game, [game], [{ ...existing, ea_match_id: 'mso:123' }]).id, 8);
  assert.equal(c._mso_matchingExistingGame(game, [game], [{ ...existing, ea_match_id: 'mso:123' }, { ...existing, id: 9, ea_match_id: 'mso:123' }]), null);
});

test('browser skips previewed games and reports server-side skips', async () => {
  const js = fs.readFileSync(require.resolve('../public/admin.js'), 'utf8');
  const start = js.indexOf('let msoSchedulePreview = null;');
  const end = js.indexOf('function showXlImportStatus', start);
  const elements = {
    'mso-schedule-status': {}, 'mso-schedule-preview-btn': {}, 'mso-schedule-import-btn': {},
    'mso-schedule-url': { value: url }, 'mso-schedule-season': { value: '1' }, 'mso-bracket-options': {},
  };
  const games = [
    { id: '1', home: 'A', away: 'B', date: '2026-01-01', status: 'complete', skipped: true },
    { id: '2', home: 'C', away: 'D', date: '2026-01-02', status: 'complete', skipped: false, token: 'token' },
  ];
  const requests = [];
  const c = vm.createContext({
    document: { getElementById: id => elements[id] }, API: '/api', adminHeaders: () => ({}),
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      return { ok: true, json: async () => body.game_id ? { skipped: true } : { season: 'Season', games } };
    },
  });
  vm.runInContext(js.slice(start, end), c);
  await c.previewMsoSchedule();
  assert.match(elements['mso-schedule-status'].textContent, /1 already exist/);
  await c.importMsoSchedule();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].game_id, '2');
  assert.match(elements['mso-schedule-status'].textContent, /0 imported, 2 skipped, 0 failed/);
});

test('browser can build a bracket when every game was already imported', async () => {
  const js = fs.readFileSync(require.resolve('../public/admin.js'), 'utf8');
  const elements = {
    'mso-schedule-status': {}, 'mso-schedule-preview-btn': {}, 'mso-schedule-import-btn': {},
    'mso-schedule-url': { value: url }, 'mso-schedule-season': { value: '1' },
    'mso-bracket-options': {}, 'mso-bracket-length': { value: '7' },
  };
  const requests = [];
  const c = vm.createContext({
    document: { getElementById: id => elements[id] }, API: '/api', adminHeaders: () => ({}),
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      return { ok: true, json: async () => body.build_bracket ? { bracket_id: 1 } : {
        season: 'Season Playoffs', bracket_token: 'bracket-token',
        games: [{ id: '1', home: 'A', away: 'B', date: '2026-01-01', status: 'complete', skipped: true }],
      } };
    },
  });
  vm.runInContext(js.slice(js.indexOf('let msoSchedulePreview = null;'), js.indexOf('function showXlImportStatus')), c);
  await c.previewMsoSchedule();
  assert.equal(elements['mso-schedule-import-btn'].hidden, false);
  assert.equal(elements['mso-bracket-options'].hidden, false);
  await c.importMsoSchedule();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].build_bracket, true);
  assert.equal(requests[1].series_length, 7);
  assert.match(elements['mso-schedule-status'].textContent, /Playoff bracket created/);
});

test('builds ordered bracket from complete results including a lower-scoring forfeit winner', () => {
  const c = context({ app: { post() {} }, requireOwner() {} });
  vm.runInContext(source.slice(source.indexOf('function gameWinnerSide('), source.indexOf('/** Validate and normalise a game_time')), c);
  const standings = [1, 2, 3, 4].map(id => ({ id }));
  const mk = (id, round, home, away, hs, as, forfeit = false) => ({
    id: String(id), date: `2026-01-0${round}`, round, home: `Team ${home}`, away: `Team ${away}`,
    home_score: hs, away_score: as, status: forfeit ? 'forfeit' : 'complete',
    is_forfeit: forfeit, forfeit_winner: forfeit ? 'away' : null,
  });
  const games = [mk(1, 1, 1, 4, 8, 1, true), mk(2, 1, 2, 3, 3, 2), mk(3, 2, 2, 4, 4, 2)];
  const existing = games.map(g => ({
    id: Number(g.id), ea_match_id: `mso:${g.id}`, home_name: g.home, away_name: g.away,
    home_team_id: Number(g.home.slice(-1)), away_team_id: Number(g.away.slice(-1)),
    home_score: g.home_score, away_score: g.away_score, status: g.status,
    is_forfeit: g.is_forfeit, forfeit_winner: g.forfeit_winner,
  }));
  const plan = c._mso_bracketSeries(games, existing, standings, 1);
  assert.equal(plan.rounds.get(1)[1].winner, 4);
  assert.equal(plan.rounds.get(2)[0].winner, 2);
  const withBye = c._mso_bracketSeries([games[0], games[2]], [existing[0], existing[2]], standings, 1);
  assert.equal(withBye.rounds.get(1)[0].high, 2);
  assert.equal(withBye.rounds.get(1)[0].low, null);
  assert.equal(withBye.rounds.get(1)[0].winner, 2);
  assert.equal(withBye.rounds.get(1)[1].winner, 4);
  assert.throws(() => c._mso_bracketSeries(games, existing, standings, 3), /incomplete/);
  assert.throws(() => c._mso_bracketSeries(games, existing.map(g => g.id === 1 ? { ...g, forfeit_winner: 'home' } : g), standings, 1), /different result/);
  assert.throws(() => c._mso_bracketSeries(games, existing.slice(1), standings, 1), /uniquely matched/);
  assert.throws(() => c._mso_bracketSeries(games, existing.map(g => g.id === 1 ? { ...g, playoff_series_id: 8 } : g), standings, 1), /another series/);
  const inconsistent = [{ ...games[0], forfeit_winner: 'home' }, games[2]];
  assert.throws(() => c._mso_bracketSeries(inconsistent, [{ ...existing[0], forfeit_winner: 'home' }, existing[2]], standings, 1), /winners do not match/);
});

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
test('creates a bracket transactionally without altering imported games or stats', { skip: !connectionString }, async () => {
  const { Client } = require('pg');
  const client = new Client({ connectionString, ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false } });
  await client.connect();
  const tx = { prepare(sql) {
    let n = 0;
    const query = sql.replace(/\?/g, () => `$${++n}`);
    return {
      async get(...args) { return (await client.query(query, args)).rows[0]; },
      async all(...args) { return (await client.query(query, args)).rows; },
      async run(...args) {
        const result = await client.query(/^\s*INSERT/i.test(query) ? `${query} RETURNING *` : query, args);
        return { lastInsertRowid: result.rows[0]?.id };
      },
    };
  } };
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE seasons (id serial PRIMARY KEY, name text, league_type text, is_playoff int, parent_season_id int) ON COMMIT DROP;
      CREATE TEMP TABLE playoffs (id serial PRIMARY KEY, season_id int, playoff_season_id int, teams_qualify int, min_games_played int, series_length int, seeding_format text) ON COMMIT DROP;
      CREATE TEMP TABLE playoff_teams (id serial PRIMARY KEY, playoff_id int, team_id int, seed int) ON COMMIT DROP;
      CREATE TEMP TABLE playoff_series (id serial PRIMARY KEY, playoff_id int, round_number int, series_number int, high_seed_id int, low_seed_id int, high_seed_wins int, low_seed_wins int, winner_id int) ON COMMIT DROP;
      CREATE TEMP TABLE teams (id int PRIMARY KEY, name text) ON COMMIT DROP;
      CREATE TEMP TABLE games (id int PRIMARY KEY, home_team_id int, away_team_id int, home_score int, away_score int, status text, is_forfeit int, forfeit_winner text, playoff_series_id int, ea_match_id text, date text, game_time text, season_id int) ON COMMIT DROP;
      CREATE TEMP TABLE game_player_stats (game_id int, player_name text, goals int) ON COMMIT DROP;
      INSERT INTO seasons VALUES (1,'Season','threes',0,NULL),(2,'Season Playoffs','threes',1,1);
      INSERT INTO teams VALUES (1,'Team 1'),(2,'Team 2'),(3,'Team 3'),(4,'Team 4');
      INSERT INTO games VALUES
        (1,1,4,8,1,'forfeit',1,'away',NULL,'mso:1','2026-01-01',NULL,2),
        (3,2,4,4,2,'complete',0,NULL,NULL,'mso:3','2026-01-02',NULL,2);
      INSERT INTO game_player_stats VALUES (1,'Player',3);
    `);
    let handler;
    const db = { prepare: tx.prepare, async transaction(fn) {
      await client.query('SAVEPOINT bracket_test');
      try { await fn(tx); await client.query('RELEASE SAVEPOINT bracket_test'); }
      catch (err) { await client.query('ROLLBACK TO SAVEPOINT bracket_test'); await client.query('RELEASE SAVEPOINT bracket_test'); throw err; }
    } };
    const standings = [1, 2, 3, 4].map(id => ({ id }));
    const c = context({ db, app: { post(_path, _auth, fn) { handler = fn; } }, requireOwner() {}, calcStandings: async () => standings });
    vm.runInContext(source.slice(source.indexOf('function gameWinnerSide('), source.indexOf('/** Validate and normalise a game_time')), c);
    const mk = (id, round, home, away, hs, as, forfeit = false) => ({
      id: String(id), date: `2026-01-0${round}`, round, home: `Team ${home}`, away: `Team ${away}`,
      home_score: hs, away_score: as, status: forfeit ? 'forfeit' : 'complete',
      is_forfeit: forfeit, forfeit_winner: forfeit ? 'away' : null,
    });
    const games = [mk(1, 1, 1, 4, 8, 1, true), mk(3, 2, 2, 4, 4, 2)];
    const token = c._signPayload({ purpose: 'mso-schedule-bracket', url, season_id: 1, games, exp: Date.now() + 60000 });
    async function call(series_length) {
      const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
      await handler({ body: { url, season_id: 1, build_bracket: true, token, series_length } }, res);
      return res;
    }
    const before = (await client.query('SELECT id, home_score, away_score, forfeit_winner FROM games ORDER BY id')).rows;
    assert.equal((await call(3)).statusCode, 422);
    assert.equal(Number((await client.query('SELECT count(*) FROM playoffs')).rows[0].count), 0);
    assert.equal((await call(1)).statusCode, 200);
    assert.equal(Number((await client.query('SELECT count(*) FROM playoff_series')).rows[0].count), 3);
    assert.equal(Number((await client.query('SELECT count(*) FROM games WHERE playoff_series_id IS NOT NULL')).rows[0].count), 2);
    assert.deepEqual((await client.query('SELECT high_seed_id, low_seed_id, winner_id FROM playoff_series WHERE round_number = 1 AND low_seed_id IS NULL')).rows, [{ high_seed_id: 2, low_seed_id: null, winner_id: 2 }]);
    assert.deepEqual((await client.query('SELECT id, home_score, away_score, forfeit_winner FROM games ORDER BY id')).rows, before);
    assert.deepEqual((await client.query('SELECT * FROM game_player_stats')).rows, [{ game_id: 1, player_name: 'Player', goals: 3 }]);
    assert.equal((await call(1)).statusCode, 422);
    assert.equal(Number((await client.query('SELECT count(*) FROM playoffs')).rows[0].count), 1);
  } finally { await client.query('ROLLBACK'); await client.end(); }
});

test('skips existing games and resumes imports without refetching the schedule', { skip: !connectionString }, async () => {
  const { Client } = require('pg');
  const client = new Client({ connectionString, ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false } });
  await client.connect();
  const tx = { prepare(sql) {
    let n = 0;
    const query = sql.replace(/\?/g, () => `$${++n}`);
    return {
      async get(...args) { return (await client.query(query, args)).rows[0]; },
      async all(...args) { return (await client.query(query, args)).rows; },
      async run(...args) {
        const q = /^\s*INSERT/i.test(query) ? `${query} RETURNING *` : query;
        const result = await client.query(q, args);
        return { lastInsertRowid: result.rows[0]?.id };
      },
    };
  } };
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE seasons (id serial PRIMARY KEY, name text, league_type text, is_playoff int DEFAULT 0, parent_season_id int, is_active int DEFAULT 0, sort_order int DEFAULT 0) ON COMMIT DROP;
      CREATE TEMP TABLE playoffs (id serial PRIMARY KEY, season_id int, playoff_season_id int) ON COMMIT DROP;
      CREATE TEMP TABLE teams (id serial PRIMARY KEY, name text, conference text, division text, league_type text, color1 text, color2 text) ON COMMIT DROP;
      CREATE TEMP TABLE games (id serial PRIMARY KEY, home_team_id int, away_team_id int, home_score int, away_score int, date text, status text, season_id int, is_overtime int, is_forfeit int, game_time text, ea_match_id text, home_shots int, away_shots int, playoff_series_id int, forfeit_winner text) ON COMMIT DROP;
      CREATE TEMP TABLE game_player_stats (id serial PRIMARY KEY, game_id int, team_id int, player_name text, position text, goals int, assists int, hits int, goalie_wins int, goalie_losses int, goalie_otw int, goalie_otl int) ON COMMIT DROP;
      CREATE TEMP TABLE players (id serial PRIMARY KEY, name text, team_id int, position text, user_id int, is_rostered int) ON COMMIT DROP;
      CREATE TEMP TABLE users (id int, username text) ON COMMIT DROP;
      INSERT INTO seasons (id, name, league_type) VALUES (1, 'Season', 'threes');
      SELECT setval(pg_get_serial_sequence('seasons', 'id'), 1);
      INSERT INTO teams (name, league_type) VALUES ('Home','sixes'),('Away','threes');
      INSERT INTO games (home_team_id, away_team_id, date, game_time, status, season_id, ea_match_id) VALUES (1,2,'2026-10-06','21:00','scheduled',1,'ea:123');
      INSERT INTO game_player_stats (game_id, team_id, player_name, position, goals, assists, hits) VALUES (1,1,'Player','C',0,0,42),(1,2,'Missing goalie','G',0,0,0);
    `);
    let handler;
    const db = { prepare: tx.prepare, async transaction(fn) { await fn(tx); } };
    let scheduleHtml = schedule.replace('</table>', `<tr class="day-row"><td>Wednesday October 7, 2026</td></tr>${row('126')}</table>`);
    let scheduleRequests = 0, detailRequests = 0, playoffSource = false;
    const c = context({
      db, requireOwner() {}, app: { post(_path, _auth, fn) { handler = fn; } },
      _mso_fetchUrl: async (input, _redirects, options) => {
        if (input === url) scheduleRequests++; else detailRequests++;
        let body = input === url ? (options ? controls('0') + scheduleHtml : initialSchedule) : input.includes('IDGame=124') ? detail.replace('>Final</span>', '>Forfeit</span>') : detail;
        if (input === url && playoffSource) body = body.replace('>Season</option>', '>Season Playoffs</option>');
        return { status: 200, body };
      },
      capScoreDifferential: (h, a) => ({ home_score: Math.min(h, a + 7), away_score: Math.min(a, h + 7) }),
    });
    const call = async body => {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
      await handler({ body }, res);
      return res;
    };
    const preview = await call({ url, season_id: 1 });
    assert.equal(preview.code, 200);
    assert.equal(preview.body.games.find(g => g.id === '123').skipped, true);
    assert.equal(preview.body.games.find(g => g.id === '123').token, null);
    const newGame = preview.body.games.find(g => g.id === '126');
    const input = { url, season_id: 1, game_id: '126', token: newGame.token };
    assert.equal((await call({ ...input, token: 'bad' })).code, 409);
    assert.equal((await call({ ...input, game_id: '999' })).code, 409);
    const imported = await call(input);
    assert.equal(imported.code, 200);
    assert.equal(imported.body.created, true);
    const retry = await call(input);
    assert.equal(retry.body.skipped, true);
    assert.equal(scheduleRequests, 2);
    assert.equal(detailRequests, 1);
    const games = (await client.query('SELECT * FROM games ORDER BY id')).rows;
    assert.equal(games.length, 2);
    assert.equal(games[0].status, 'scheduled');
    assert.equal(games[0].ea_match_id, 'ea:123');
    assert.equal(games[1].home_score, 8);
    const players = (await client.query('SELECT * FROM game_player_stats ORDER BY id')).rows;
    assert.equal(players.length, 3);
    assert.equal(players[0].goals, 0);
    assert.equal(players[0].hits, 42);
    assert.equal(players[1].player_name, 'Missing goalie');
    assert.equal(players[2].goals, 2);
    const scheduled = { ...input, game_id: '125', token: preview.body.games.find(g => g.id === '125').token };
    assert.equal((await call(scheduled)).code, 200);
    assert.equal((await call(scheduled)).body.skipped, true);
    const forfeit = { ...input, game_id: '124', token: preview.body.games.find(g => g.id === '124').token };
    assert.equal((await call(forfeit)).code, 200);
    assert.equal((await call(forfeit)).body.skipped, true);
    const allGames = (await client.query('SELECT status, ea_match_id FROM games ORDER BY id')).rows;
    assert.equal(allGames.length, 4);
    assert.equal(allGames[2].status, 'scheduled');
    assert.equal(allGames[3].status, 'forfeit');
    let importedForfeit = (await client.query("SELECT * FROM games WHERE ea_match_id = 'mso:124'")).rows[0];
    assert.equal(importedForfeit.forfeit_winner, 'away');
    assert.equal(importedForfeit.home_score, 9);
    await client.query("INSERT INTO game_player_stats (game_id, team_id, player_name, position, goalie_wins, goalie_losses, goalie_otw, goalie_otl) VALUES ($1, 2, 'Forfeit goalie', 'G', 0, 0, 0, 1)", [importedForfeit.id]);
    await client.query("UPDATE games SET forfeit_winner = NULL WHERE id = $1", [importedForfeit.id]);
    const fixPreview = await call({ url, season_id: 1 });
    const fix = fixPreview.body.games.find(g => g.id === '124');
    assert.equal(fix.winner_update, true);
    const fixed = await call({ url, season_id: 1, game_id: '124', token: fix.token });
    assert.equal(fixed.body.winner_updated, true);
    importedForfeit = (await client.query("SELECT * FROM games WHERE ea_match_id = 'mso:124'")).rows[0];
    assert.equal(importedForfeit.forfeit_winner, 'away');
    assert.equal(importedForfeit.home_score, 9);
    const goalie = (await client.query("SELECT goalie_otw, goalie_otl FROM game_player_stats WHERE player_name = 'Forfeit goalie'")).rows[0];
    assert.deepEqual(goalie, { goalie_otw: 1, goalie_otl: 0 });
    const resumed = await call({ url, season_id: 1 });
    assert.equal(resumed.body.games.filter(g => g.skipped).length, 4);
    scheduleHtml = schedule.replace('</table>', `<tr class="day-row"><td>Wednesday October 7, 2026</td></tr>${row('127')}
      <tr class="day-row"><td>Thursday October 8, 2026</td></tr>${row('128')}</table>`);
    await client.query(`INSERT INTO games (home_team_id, away_team_id, date, game_time, status, season_id) VALUES
      (1,2,'2026-10-07','20:00','scheduled',1),(2,1,'2026-10-08','21:00','scheduled',1)`);
    const updatedPreview = await call({ url, season_id: 1 });
    const conflicting = { url, season_id: 1 };
    const timeConflict = await call({ ...conflicting, game_id: '127', token: updatedPreview.body.games.find(g => g.id === '127').token });
    assert.equal(timeConflict.code, 422);
    assert.match(timeConflict.body.error, /conflicting times/);
    const reversedConflict = await call({ ...conflicting, game_id: '128', token: updatedPreview.body.games.find(g => g.id === '128').token });
    assert.equal(reversedConflict.code, 422);
    assert.match(reversedConflict.body.error, /reversed/);
    assert.equal(Number((await client.query('SELECT COUNT(*) AS count FROM games')).rows[0].count), 6);
    playoffSource = true;
    scheduleHtml = `<table id="maincontent_gvGameList"><tr class="day-row"><td>Wednesday October 7, 2026</td></tr>${row('129')}</table>`;
    const playoffPreview = await call({ url, season_id: 1 });
    assert.equal(playoffPreview.body.season, 'Season Playoffs');
    assert.equal(playoffPreview.body.playoff_season_will_be_created, true);
    assert.equal(Number((await client.query('SELECT COUNT(*) AS count FROM seasons')).rows[0].count), 1);
    const playoffGame = playoffPreview.body.games[0];
    assert.equal((await call({ url, season_id: 1, game_id: playoffGame.id, token: playoffGame.token })).code, 200);
    const playoff = (await client.query("SELECT * FROM seasons WHERE is_playoff = 1")).rows[0];
    assert.equal(playoff.parent_season_id, 1);
    assert.equal(playoff.league_type, 'threes');
    const savedGame = (await client.query("SELECT season_id FROM games WHERE ea_match_id = 'mso:129'")).rows[0];
    assert.equal(savedGame.season_id, playoff.id);
    const secondPreview = await call({ url, season_id: 1 });
    assert.equal(secondPreview.body.playoff_season_will_be_created, false);
    assert.equal(secondPreview.body.games[0].skipped, true);
    let reused;
    await db.transaction(async transaction => { reused = await c._ensureLinkedPlayoffSeason(transaction, 1); });
    assert.equal(reused.id, playoff.id);
    assert.equal(Number((await client.query('SELECT COUNT(*) AS count FROM seasons WHERE is_playoff = 1')).rows[0].count), 1);
    await client.query('UPDATE seasons SET parent_season_id = NULL WHERE id = $1', [playoff.id]);
    await client.query('INSERT INTO playoffs (season_id, playoff_season_id) VALUES ($1, $2)', [1, playoff.id]);
    await db.transaction(async transaction => { reused = await c._ensureLinkedPlayoffSeason(transaction, 1); });
    assert.equal(reused.id, playoff.id);
    assert.equal((await client.query('SELECT parent_season_id FROM seasons WHERE id = $1', [playoff.id])).rows[0].parent_season_id, 1);
    const directPreview = await call({ url, season_id: playoff.id });
    assert.equal(directPreview.body.season, 'Season Playoffs');
    assert.equal(directPreview.body.games[0].skipped, true);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
