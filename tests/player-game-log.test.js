const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Client } = require('pg');

test('hero overall averages rated career games in the selected league and updates with position', async () => {
  const source = fs.readFileSync(require.resolve('../public/player.js'), 'utf8').replace(/\bloadPlayer\(\);\s*$/, '');
  const buttons = ['skater', 'goalie'].map(sg => ({
    dataset: { sg }, classList: { add() {}, remove() {} },
    addEventListener(event, callback) { this.click = callback; },
  }));
  const hero = { innerHTML: '' };
  const root = {
    innerHTML: '',
    querySelectorAll: selector => selector === '.sg-tab' ? buttons : [],
    querySelector: selector => selector === '.phl-hero-stats' ? hero : null,
  };
  const profile = {
    player: null, seasonProfileTeam: null, isGoalie: false, lastGames: [],
    skaterStats: [
      { league_type: 'sixes', gp: 2, overall_rating_sum: 140, overall_rating_count: 2 },
      { league_type: 'sixes', gp: 1, is_playoff: 1, overall_rating_sum: 99, overall_rating_count: 1 },
      { league_type: 'sixes', gp: 30, is_historical: 1 },
      { league_type: 'threes', gp: 1, overall_rating_sum: 99, overall_rating_count: 1 },
    ],
    goalieStats: [{ league_type: 'sixes', gp: 1, overall_rating_sum: 91, overall_rating_count: 1 }],
  };
  const context = vm.createContext({
    URL, URLSearchParams, console,
    window: { location: { href: 'http://localhost/player.html?name=Player&league=sixes&season_id=1', search: '?name=Player&league=sixes&season_id=1' }, addEventListener() {} },
    document: { getElementById: id => id === 'player-root' ? root : null },
    localStorage: { setItem() {}, getItem() { return null; } },
    fetch: async url => ({ ok: true, json: async () => url.includes('/profile/') ? profile : url.includes('/records/') ? { holdings: [] } : [] }),
  });
  vm.runInContext(source, context);
  vm.runInContext('sizeGameLogs = () => {}; renderPlayerModeTabs = () => "";', context);
  await context.loadPlayer();
  assert.match(root.innerHTML, /phl-stat-label">Overall<\/div><div class="phl-stat-val">80<\/div>/);
  buttons[1].click();
  assert.match(hero.innerHTML, /phl-stat-label">Overall<\/div><div class="phl-stat-val">91<\/div>/);
  buttons[0].click();
  assert.match(hero.innerHTML, /phl-stat-label">Overall<\/div><div class="phl-stat-val">80<\/div>/);
  const unrated = context.playerHeroBoxes([{ league_type: 'sixes', gp: 10, is_historical: 1 }], false, 'sixes');
  assert.equal(unrated.find(box => box.label === 'Overall').value, null);
});

test('player league switch preserves the player and drops the previous league season', () => {
  const source = fs.readFileSync(require.resolve('../public/player.js'), 'utf8').replace(/\bloadPlayer\(\);\s*$/, '');
  const links = ['threes', 'sixes'].map(league => ({
    dataset: { playerLeague: league },
    attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
  }));
  const context = vm.createContext({
    URL,
    window: { location: { href: 'http://localhost:3000/player.html?name=xBigClick&league=threes&season_id=3' } },
    document: { getElementById: () => ({ querySelectorAll: () => links }) },
  });
  vm.runInContext(source, context);
  vm.runInContext("setupPlayerLeagueSwitch('threes')", context);
  assert.equal(links[0].attributes['aria-current'], 'page');
  assert.equal(links[1].attributes['aria-current'], undefined);
  const destination = new URL(links[1].href);
  assert.equal(destination.searchParams.get('name'), 'xBigClick');
  assert.equal(destination.searchParams.get('league'), 'sixes');
  assert.equal(destination.searchParams.has('season_id'), false);
  assert.equal(new URL(links[0].href).searchParams.get('season_id'), '3');
  vm.runInContext("setupPlayerLeagueSwitch('sixes')", context);
  assert.equal(links[1].attributes['aria-current'], 'page');
  assert.equal(links[0].attributes['aria-current'], undefined);
});

test('profile uses the selected league for team and includes both leagues in achievement totals', async () => {
  const source = fs.readFileSync(require.resolve('../public/player.js'), 'utf8').replace(/\bloadPlayer\(\);\s*$/, '');
  const summaries = { records: { innerHTML: '' }, awards: { innerHTML: '' } };
  const root = {
    innerHTML: '', querySelectorAll: () => [],
    querySelector: selector => selector.includes('"records"') ? summaries.records : summaries.awards,
  };
  const profile = {
    player: { team_id: 1, team_name: 'Other league', team_league_type: 'threes', is_rostered: 1, color1: '#ff0000' },
    seasonProfileTeam: null, isGoalie: false,
    skaterStats: [], goalieStats: [{ league_type: 'sixes', season_id: 1, gp: 1 }],
    lastGames: [],
  };
  const context = vm.createContext({
    URL, URLSearchParams, console,
    window: { location: { href: 'http://localhost/player.html?name=Player&league=sixes', search: '?name=Player&league=sixes' }, addEventListener() {} },
    document: { getElementById: id => id === 'player-root' ? root : null },
    localStorage: { setItem() {}, getItem() { return null; } },
    fetch: async url => ({ ok: true, json: async () => url.includes('/profile/') ? profile
      : url.includes('/records/') ? { holdings: [{ league_type: 'threes' }] }
      : [{ league_type: 'sixes', season_id: 1 }, { league_type: 'threes', season_id: 2 }] }),
  });
  vm.runInContext(source, context);
  vm.runInContext('sizeGameLogs = () => {}; renderPlayerModeTabs = () => "";', context);
  await context.loadPlayer();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(root.innerHTML, /Free Agent/);
  assert.doesNotMatch(root.innerHTML, /Other league|#ff0000|Records<\/span>/);
  assert.match(summaries.awards.innerHTML, /2 won/);
  assert.match(summaries.records.innerHTML, /1 held/);
  assert.match(root.innerHTML, />Goalie</);
});

test('profile team, logo and colors come only from the active season roster', async () => {
  const source = fs.readFileSync(require.resolve('../public/player.js'), 'utf8').replace(/\bloadPlayer\(\);\s*$/, '');
  const root = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
  const profile = {
    player: { team_id: 9, team_name: 'Old Team', team_league_type: 'sixes', is_rostered: 1, color1: '#ff0000' },
    seasonProfileTeam: { team_id: 9, team_name: 'Old Team', season_id: 2, color1: '#ff0000' },
    activeProfileTeam: null, isGoalie: false, skaterStats: [], goalieStats: [], lastGames: [],
  };
  const context = vm.createContext({
    URL, URLSearchParams, console,
    window: { location: { href: 'http://localhost/player.html?name=Player&league=sixes&season_id=2', search: '?name=Player&league=sixes&season_id=2' }, addEventListener() {} },
    document: { getElementById: id => id === 'player-root' ? root : null },
    localStorage: { setItem() {}, getItem() { return null; } },
    fetch: async url => ({ ok: true, json: async () => url.includes('/profile/') ? profile : url.includes('/records/') ? { holdings: [] } : [] }),
  });
  vm.runInContext(source, context);
  vm.runInContext('sizeGameLogs = () => {}; renderPlayerModeTabs = () => "";', context);
  await context.loadPlayer();
  assert.match(root.innerHTML, /phl-hero-team">Free Agent/);
  assert.doesNotMatch(root.innerHTML, /Old Team|#ff0000/);
  profile.activeProfileTeam = { team_id: 4, team_name: 'Current Team', season_id: 3, team_logo: 'current.png', color1: '#123456' };
  await context.loadPlayer();
  assert.match(root.innerHTML, /phl-hero-team">Current Team/);
  assert.match(root.innerHTML, /team\.html\?id=4&season_id=3/);
  assert.match(root.innerHTML, /current\.png/);
  assert.match(root.innerHTML, /#123456/);
  assert.doesNotMatch(root.innerHTML, /Old Team|#ff0000/);
});

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
test('active profile team query uses the selected league and active regular-season roster', { skip: !connectionString }, async () => {
  const client = new Client({ connectionString, ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE players (id int, name text);
      CREATE TEMP TABLE seasons (id int, name text, league_type text, is_active int, is_playoff int);
      CREATE TEMP TABLE teams (id int, name text, logo_url text, color1 text, color2 text);
      CREATE TEMP TABLE season_rosters (player_id int, season_id int, team_id int);
      INSERT INTO players VALUES (1, 'Player'), (2, 'Other');
      INSERT INTO seasons VALUES (1, 'Old', 'sixes', 0, 0), (2, 'Active', 'sixes', 1, 0),
        (3, 'Active', 'threes', 1, 0), (4, 'Playoffs', 'sixes', 1, 1);
      INSERT INTO teams VALUES (1, 'Old', NULL, NULL, NULL), (2, 'Sixes', NULL, NULL, NULL), (3, 'Threes', NULL, NULL, NULL);
      INSERT INTO season_rosters VALUES (1,1,1), (1,3,3), (1,4,1), (2,2,2);
    `);
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('const activeProfileTeamPromise =');
    const open = source.indexOf('`', start);
    const close = source.indexOf('`', open + 1);
    let n = 0;
    const sql = source.slice(open + 1, close).replace(/\?/g, () => `$${++n}`);
    assert.equal((await client.query(sql, [' player ', 'sixes'])).rowCount, 0);
    assert.equal((await client.query(sql, ['player', 'threes'])).rows[0].team_name, 'Threes');
    await client.query('INSERT INTO season_rosters VALUES (1,2,2)');
    assert.equal((await client.query(sql, ['PLAYER', 'sixes'])).rows[0].team_name, 'Sixes');
    await client.query('UPDATE seasons SET is_active = 0 WHERE id = 2');
    assert.equal((await client.query(sql, ['Player', 'sixes'])).rowCount, 0);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});

test('both league views and positions show all awards and records', () => {
  const source = fs.readFileSync(require.resolve('../public/player.js'), 'utf8').replace(/\bloadPlayer\(\);\s*$/, '');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  context.holdings = [
    { league_type: 'threes', category: 'alltime', label: 'Three record', value: 10, scope: 'league' },
    { league_type: 'sixes', category: 'alltime', label: 'Six record', value: 20, scope: 'league' },
  ];
  context.awards = [
    { league_type: 'threes', season_id: 1, season_name: 'Season 1', award_name: 'Three award' },
    { league_type: 'sixes', season_id: 2, season_name: 'Season 1', award_name: 'Six award' },
  ];
  for (const league of ['threes', 'sixes']) {
    context.league = league;
    const html = vm.runInContext('renderPlayerModeTabs([], [], [], false, holdings, league, awards)', context);
    for (const text of ['Three record', 'Six record', 'Three award', 'Six award']) {
      assert.equal(html.split(text).length - 1, 2, `${text} in both skater and goalie panels for ${league}`);
    }
    assert.match(html, /Season 1 · 3's/);
    assert.match(html, /Season 1 · 6's/);
    assert.match(html, /No stats on file for the selected league/);
  }
});

test('player profile renders before slow records and updates the records panel when ready', async () => {
  const source = fs.readFileSync(require.resolve('../public/player.js'), 'utf8').replace(/\bloadPlayer\(\);\s*$/, '');
  const recordsPanel = { innerHTML: '' }, summary = { innerHTML: '' };
  const root = {
    innerHTML: '',
    querySelectorAll: selector => selector === '[id="lt-panel-records"]' ? [recordsPanel] : [],
    querySelector: () => summary,
  };
  let resolveRecords;
  const records = new Promise(resolve => { resolveRecords = resolve; });
  const context = vm.createContext({
    URL, URLSearchParams, console,
    window: { location: { href: 'http://localhost/player.html?name=Player&league=threes', search: '?name=Player&league=threes' }, addEventListener() {} },
    document: { getElementById: id => id === 'player-root' ? root : null },
    localStorage: { setItem() {}, getItem() { return null; } },
    fetch: async url => url.includes('/records/') ? records : {
      ok: true, json: async () => url.includes('/profile/')
        ? { player: null, seasonProfileTeam: null, isGoalie: false, skaterStats: [], goalieStats: [], lastGames: [] }
        : [],
    },
  });
  vm.runInContext(source, context);
  vm.runInContext('sizeGameLogs = () => {}; renderPlayerModeTabs = () => "";', context);
  await context.loadPlayer();
  assert.match(root.innerHTML, /phl-hero/);
  assert.equal(recordsPanel.innerHTML, '');
  resolveRecords({ ok: true, json: async () => ({ holdings: [] }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(recordsPanel.innerHTML, /does not currently hold any records/);
});

test('record fetch errors do not hide the profile or report an empty record list', async () => {
  const source = fs.readFileSync(require.resolve('../public/player.js'), 'utf8').replace(/\bloadPlayer\(\);\s*$/, '');
  const recordsPanel = { innerHTML: '' }, summary = { innerHTML: '' };
  const root = {
    innerHTML: '',
    querySelectorAll: selector => selector === '[id="lt-panel-records"]' ? [recordsPanel] : [],
    querySelector: () => summary,
  };
  const context = vm.createContext({
    URL, URLSearchParams, console: { error() {} },
    window: { location: { href: 'http://localhost/player.html?name=Player&league=threes', search: '?name=Player&league=threes' }, addEventListener() {} },
    document: { getElementById: id => id === 'player-root' ? root : null },
    localStorage: { setItem() {}, getItem() { return null; } },
    fetch: async url => url.includes('/records/') ? { ok: false, status: 500 } : {
      ok: true, json: async () => url.includes('/profile/')
        ? { player: null, seasonProfileTeam: null, isGoalie: false, skaterStats: [], goalieStats: [], lastGames: [] }
        : [],
    },
  });
  vm.runInContext(source, context);
  vm.runInContext('sizeGameLogs = () => {}; renderPlayerModeTabs = () => "";', context);
  await context.loadPlayer();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(root.innerHTML, /phl-hero/);
  assert.match(recordsPanel.innerHTML, /Could not load player records/);
});

test('game log filters league and position before rendering every matching game', () => {
  const source = fs.readFileSync(require.resolve('../public/player.js'), 'utf8').replace(/\bloadPlayer\(\);\s*$/, '');
  const context = vm.createContext({ GameRating: require('../public/game-rating') });
  vm.runInContext(source, context);
  const games = Array.from({ length: 8 }, (_, i) => ({
    game_id: i + 1, league_type: 'sixes', position: 'C', home_team_id: 1, away_team_id: 2,
    player_team_id: 1, home_team_name: 'Home', away_team_name: 'Away', home_score: 1, away_score: 0,
  }));
  games.push({ ...games[0], game_id: 50, position: 'G' }, { ...games[0], game_id: 51, league_type: 'threes' });
  context.games = games;
  const html = vm.runInContext("renderLeagueSections([], games, false, [], 'sixes', [])", context);
  assert.equal((html.match(/game\.html\?id=/g) || []).length, 8);
  assert.doesNotMatch(html, /game\.html\?id=(50|51)/);
  assert.match(html, /class="game-log-scroll"/);
  const goalie = vm.runInContext("renderLeagueSections([], games, true, [], 'sixes', [])", context);
  assert.match(goalie, /game\.html\?id=50/);
  assert.doesNotMatch(goalie, /game\.html\?id=1"/);
});

test('playoff games are grouped and labeled separately from regular-season games', () => {
  const source = fs.readFileSync(require.resolve('../public/player.js'), 'utf8').replace(/\bloadPlayer\(\);\s*$/, '');
  const context = vm.createContext({ GameRating: require('../public/game-rating') });
  vm.runInContext(source, context);
  context.games = [
    { game_id: 1, position: 'C', is_playoff: 0, home_team_id: 1, away_team_id: 2, player_team_id: 1 },
    { game_id: 2, position: 'C', is_playoff: 1, home_team_id: 1, away_team_id: 2, player_team_id: 1 },
    { game_id: 3, position: 'C', is_playoff: 1, home_team_id: 1, away_team_id: 2, player_team_id: 1 },
  ];
  for (const isGoalie of [false, true]) {
    context.isGoalie = isGoalie;
    const html = vm.runInContext("renderLastGames(games, '', isGoalie)", context);
    assert.match(html, new RegExp(`colspan="${isGoalie ? 21 : 35}"`));
    assert.ok(html.indexOf('>Playoffs</div>') < html.indexOf('game.html?id=2'));
    assert.ok(html.indexOf('game.html?id=3') < html.indexOf('>Regular Season</div>'));
    assert.ok(html.indexOf('>Regular Season</div>') < html.indexOf('game.html?id=1'));
  }
  context.games = [context.games[0]];
  assert.doesNotMatch(vm.runInContext("renderLastGames(games, '', false)", context), /game-log-divider/);
});

test('game log defaults to an active played season, or the latest played season', () => {
  const source = fs.readFileSync(require.resolve('../public/player.js'), 'utf8').replace(/\bloadPlayer\(\);\s*$/, '');
  const context = vm.createContext({ GameRating: require('../public/game-rating') });
  vm.runInContext(source, context);
  context.games = [
    { game_id: 1, season_id: 1, season_name: 'Season 1', date: '2025-01-01', position: 'C', home_team_id: 1, away_team_id: 2, player_team_id: 1 },
    { game_id: 2, season_id: 2, season_name: 'Season 2', season_is_active: 1, date: '2026-01-01', position: 'C', home_team_id: 1, away_team_id: 2, player_team_id: 1 },
    { game_id: 3, season_id: 2, season_name: 'Season 2', season_is_active: 1, is_playoff: 1, date: '2026-02-01', position: 'C', home_team_id: 1, away_team_id: 2, player_team_id: 1 },
    { game_id: 4, season_id: 3, season_name: 'Season 3', date: '2026-03-01', position: 'C', home_team_id: 1, away_team_id: 2, player_team_id: 1 },
  ];
  let html = vm.runInContext('renderSeasonGameLog(games, false)', context);
  assert.match(html, /value="2" selected/);
  assert.match(html, /game\.html\?id=2"/);
  assert.match(html, /game\.html\?id=3"/);
  assert.doesNotMatch(html, /game\.html\?id=(1|4)"/);
  assert.equal((html.match(/<option /g) || []).length, 3);
  context.games[1].season_is_active = 0;
  context.games[2].season_is_active = 0;
  html = vm.runInContext('renderSeasonGameLog(games, false)', context);
  assert.match(html, /value="3" selected/);
  assert.match(html, /game\.html\?id=4"/);
  assert.doesNotMatch(html, /game\.html\?id=2"/);
});

test('changing game log season updates the visible games for the current position', async () => {
  const source = fs.readFileSync(require.resolve('../public/player.js'), 'utf8').replace(/\bloadPlayer\(\);\s*$/, '');
  const content = { innerHTML: '' };
  const select = {
    value: '1',
    addEventListener(_event, fn) { this.change = fn; },
    closest(selector) { return selector === '#sg-panel-goalie' ? null : { querySelector: () => content }; },
  };
  const root = { innerHTML: '', querySelectorAll: selector => selector === '.game-log-season' ? [select] : [], querySelector: () => null };
  const base = { league_type: 'sixes', home_team_id: 1, away_team_id: 2, player_team_id: 1 };
  const profile = {
    player: null, seasonProfileTeam: null, isGoalie: false, skaterStats: [], goalieStats: [],
    lastGames: [
      { ...base, game_id: 1, season_id: 1, position: 'C' },
      { ...base, game_id: 2, season_id: 2, position: 'C' },
      { ...base, game_id: 3, season_id: 2, position: 'G' },
      { ...base, game_id: 4, season_id: 2, position: 'C', league_type: 'threes' },
    ],
  };
  const context = vm.createContext({
    URL, URLSearchParams, console, GameRating: require('../public/game-rating'),
    window: { location: { href: 'http://localhost/player.html?name=Player&league=sixes', search: '?name=Player&league=sixes' }, addEventListener() {} },
    document: { getElementById: id => id === 'player-root' ? root : null },
    localStorage: { setItem() {}, getItem() { return null; } },
    fetch: async url => ({ ok: true, json: async () => url.includes('/profile/') ? profile : url.includes('/records/') ? { holdings: [] } : [] }),
  });
  vm.runInContext(source, context);
  vm.runInContext('sizeGameLogs = () => {}; renderPlayerModeTabs = () => "";', context);
  await context.loadPlayer();
  select.value = '2';
  select.change();
  assert.match(content.innerHTML, /game\.html\?id=2"/);
  assert.doesNotMatch(content.innerHTML, /game\.html\?id=(1|3|4)"/);
});

test('season count excludes playoff-only rows and includes both positions', async () => {
  const source = fs.readFileSync(require.resolve('../public/player.js'), 'utf8').replace(/\bloadPlayer\(\);\s*$/, '');
  const root = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
  const profile = {
    player: null, seasonProfileTeam: null, isGoalie: false, lastGames: [],
    skaterStats: [
      { league_type: 'sixes', season_id: 1, season_name: 'Season 1', gp: 1 },
      { league_type: 'sixes', season_id: 5, season_name: 'Season 1 Playoffs', is_playoff: 1, gp: 1 },
      { league_type: 'threes', season_id: 3, season_name: 'Season 3', gp: 1 },
    ],
    goalieStats: [
      { league_type: 'sixes', season_id: 1, season_name: 'Season 1', gp: 1 },
      { league_type: 'sixes', season_id: 2, season_name: 'Season 2', gp: 1 },
    ],
  };
  const context = vm.createContext({
    URL, URLSearchParams, console,
    window: { location: { href: 'http://localhost/player.html?name=Player&league=sixes', search: '?name=Player&league=sixes' }, addEventListener() {} },
    document: { getElementById: id => id === 'player-root' ? root : null },
    localStorage: { setItem() {}, getItem() { return null; } },
    fetch: async url => ({ ok: true, json: async () => url.includes('/profile/') ? profile : url.includes('/records/') ? { holdings: [] } : [] }),
  });
  vm.runInContext(source, context);
  vm.runInContext('sizeGameLogs = () => {}; renderPlayerModeTabs = () => "";', context);
  await context.loadPlayer();
  assert.match(root.innerHTML, /phl-info-label">Seasons<\/span><span class="phl-info-value">2<\/span>/);
});

test('game log height includes five rows, top spacing, and scrollbar', () => {
  const source = fs.readFileSync(require.resolve('../public/player.js'), 'utf8').replace(/\bloadPlayer\(\);\s*$/, '');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const row = { getBoundingClientRect: () => ({ bottom: 340 }) };
  const table = { getBoundingClientRect: () => ({ height: 800 }), querySelectorAll: selector => {
    assert.equal(selector, 'tbody tr:not(.game-log-divider)');
    return Array(8).fill(row);
  } };
  const container = { offsetHeight: 700, clientHeight: 685, scrollTop: 0, style: {}, querySelector: () => table, getBoundingClientRect: () => ({ top: 100 }) };
  context.root = { querySelectorAll: () => [container] };
  vm.runInContext('sizeGameLogs(root)', context);
  assert.equal(container.style.maxHeight, '255px');
});
