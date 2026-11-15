const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const start = source.indexOf('// POST /api/seasons/:id/reorder');
const end = source.indexOf('// ── Site Logo', start);

function handlerFor(db) {
  let handler;
  const context = vm.createContext({ db, requireOwner() {}, console, app: { post(_path, _auth, fn) { handler = fn; } } });
  vm.runInContext(source.slice(start, end), context);
  return async (id, body) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ params: { id: String(id) }, body }, res);
    return res;
  };
}

function memoryDb(initial) {
  const rows = initial.map(row => ({ ...row }));
  return {
    rows,
    async transaction(fn) {
      const backup = rows.map(row => ({ ...row }));
      try {
        await fn({ prepare(sql) {
          return {
            async all() {
              return rows.slice().sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity) || a.id - b.id);
            },
            async run(order, id) {
              if (!sql.startsWith('UPDATE seasons')) throw new Error('Unexpected query');
              rows.find(row => row.id === id).sort_order = order;
            },
          };
        } });
      } catch (error) {
        rows.splice(0, rows.length, ...backup);
        throw error;
      }
    },
  };
}

function visible(rows, league) {
  return rows.filter(s => !s.is_playoff && (!s.league_type || s.league_type === league))
    .sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity) || a.id - b.id).map(s => s.id);
}

test('drag and arrow moves preserve the other league and skip playoffs', async () => {
  const db = memoryDb([
    { id: 1, league_type: 'threes', sort_order: 1 },
    { id: 11, league_type: 'threes', sort_order: 2, is_playoff: 1 },
    { id: 2, league_type: 'threes', sort_order: 3 },
    { id: 3, league_type: 'sixes', sort_order: 4 },
    { id: 4, league_type: '', sort_order: 5 },
    { id: 5, league_type: 'threes', sort_order: 6 },
  ]);
  const call = handlerFor(db);
  assert.equal((await call(5, { league_type: 'threes', target_id: 2, placement: 'before' })).code, 200);
  assert.deepEqual(visible(db.rows, 'threes'), [1, 5, 2, 4]);
  assert.equal(db.rows.find(s => s.id === 3).sort_order, 4);
  assert.equal(db.rows.find(s => s.id === 11).sort_order, 2);
  assert.equal((await call(1, { league_type: 'threes', direction: 'down' })).code, 200);
  assert.deepEqual(visible(db.rows, 'threes'), [5, 1, 2, 4]);
  assert.equal((await call(5, { league_type: 'threes', target_id: 4, placement: 'after' })).code, 200);
  assert.deepEqual(visible(db.rows, 'threes'), [1, 2, 4, 5]);
  assert.equal((await call(11, { league_type: 'threes', direction: 'up' })).code, 400);
  assert.equal((await call(1, { league_type: 'threes', target_id: 3, placement: 'after' })).code, 400);
  assert.equal((await call(999, { league_type: 'threes', direction: 'up' })).code, 404);
  assert.equal((await call(1, { direction: 'up', target_id: 2, placement: 'before' })).code, 400);
});

test('ties are normalized and remain reorderable', async () => {
  const db = memoryDb([
    { id: 1, league_type: 'threes', sort_order: 5 },
    { id: 2, league_type: 'threes', sort_order: 5 },
    { id: 3, league_type: 'sixes', sort_order: 5 },
    { id: 4, league_type: 'threes', sort_order: 9 },
  ]);
  const call = handlerFor(db);
  assert.equal((await call(4, { league_type: 'threes', target_id: 1, placement: 'before' })).code, 200);
  assert.deepEqual(visible(db.rows, 'threes'), [4, 1, 2]);
  assert.equal(db.rows.find(s => s.id === 3).sort_order, 3);
  assert.equal((await call(1, { league_type: 'threes', direction: 'down' })).code, 200);
  assert.deepEqual(visible(db.rows, 'threes'), [4, 2, 1]);
});

test('dragging a handle onto a playoff row moves before its parent', async () => {
  const js = fs.readFileSync(require.resolve('../public/admin.js'), 'utf8');
  const dragStart = js.indexOf('let seasonReorderBusy = false;');
  const dragEnd = js.indexOf('async function manageSeasonConf', dragStart);
  const listeners = {}, calls = [];
  const classes = () => ({ values: new Set(), add(value) { this.values.add(value); }, remove(...values) { values.forEach(v => this.values.delete(v)); } });
  const sourceRow = { classList: classes() };
  const targetRow = { classList: classes(), dataset: { dropSeasonId: '2', playoff: 'true' }, getBoundingClientRect: () => ({ top: 100, height: 30 }) };
  const handle = { dataset: { seasonId: '1' }, closest: () => sourceRow };
  const list = { addEventListener(type, fn) { listeners[type] = fn; } };
  const document = {
    getElementById() { return list; },
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type) { delete listeners[type]; },
    elementFromPoint() { return { closest: () => targetRow }; },
  };
  let refreshed = 0;
  const context = vm.createContext({
    document, API: '/api', adminLeagueFilter: 'threes',
    adminJsonHeaders: () => ({}), loadSeasons: async () => { refreshed++; },
    fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true }; },
    alert(message) { throw new Error(message); },
  });
  vm.runInContext(js.slice(dragStart, dragEnd), context);
  listeners.pointerdown({ target: { closest: () => handle }, pointerType: 'mouse', button: 0, pointerId: 7, clientX: 0, clientY: 0, preventDefault() {} });
  listeners.pointermove({ pointerId: 7, clientX: 5, clientY: 120 });
  assert.equal(targetRow.classList.values.has('season-drop-before'), true);
  listeners.pointerup({ type: 'pointerup', pointerId: 7 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/seasons/1/reorder');
  assert.deepEqual(calls[0].body, { target_id: 2, placement: 'before', league_type: 'threes' });
  assert.equal(refreshed, 1);
  assert.equal(targetRow.classList.values.size, 0);
});

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
test('reorder updates PostgreSQL transactionally', { skip: !connectionString }, async () => {
  const { Client } = require('pg');
  const client = new Client({ connectionString, ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE seasons (id int, sort_order int, league_type text, is_playoff int DEFAULT 0) ON COMMIT DROP;
      INSERT INTO seasons VALUES (1,1,'threes',0),(2,2,'threes',1),(3,3,'threes',0),(4,4,'sixes',0)`);
    const db = { async transaction(fn) {
      await fn({ prepare(sql) {
        let n = 0;
        const query = sql.replace(/\?/g, () => `$${++n}`);
        return {
          async all(...args) { return (await client.query(query, args)).rows; },
          async run(...args) { return client.query(query, args); },
        };
      } });
    } };
    const result = await handlerFor(db)(3, { league_type: 'threes', target_id: 1, placement: 'before' });
    assert.equal(result.code, 200);
    const rows = (await client.query('SELECT * FROM seasons ORDER BY sort_order, id')).rows;
    assert.deepEqual(rows.map(row => row.id), [3, 2, 1, 4]);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
