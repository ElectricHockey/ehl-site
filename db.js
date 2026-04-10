// ═══════════════════════════════════════════════════════════════════════════
// db.js — PostgreSQL adapter for Supabase
//
// Provides a thin wrapper around `pg.Pool` that mimics the calling
// conventions of the original better-sqlite3 usage so that server.js
// changes are minimal.
//
// Key points:
//   • `db.prepare(sql)` returns a PreparedStatement with async get/all/run
//   • SQL `?` placeholders are auto-converted to PostgreSQL $1, $2, …
//   • Named params `@name` are auto-converted to $N
//   • `run()` auto-appends `RETURNING *` to INSERT statements
//   • `db.transaction(fn)` runs fn(txDb) inside BEGIN…COMMIT
// ═══════════════════════════════════════════════════════════════════════════

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase requires SSL; rejectUnauthorized must be false for their pooler
  // certificates. For self-hosted PostgreSQL over localhost, SSL is disabled.
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
});

// ── Placeholder conversion ─────────────────────────────────────────────────

/** Convert SQLite `?` placeholders to PostgreSQL $1, $2, … */
function convertPositional(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

/** Convert SQLite named params (@name) to $N; returns { sql, values }. */
function convertNamed(sql, obj) {
  const values = [];
  let idx = 0;
  const converted = sql.replace(/@(\w+)/g, (_, name) => {
    idx++;
    values.push(obj[name]);
    return `$${idx}`;
  });
  return { sql: converted, values };
}

/**
 * Normalise arguments to (pgSql, values[]) regardless of whether the
 * caller passed positional args or a single named-params object.
 */
function normalise(sql, args) {
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0]) && /@\w+/.test(sql)) {
    return convertNamed(sql, args[0]);
  }
  return { sql: convertPositional(sql), values: args };
}

// ── PreparedStatement (mimics better-sqlite3 prepared statement) ─────────

function createPrepared(executor, rawSql) {
  return {
    /** Return first row or undefined */
    async get(...args) {
      const { sql, values } = normalise(rawSql, args);
      const result = await executor(sql, values);
      return result.rows[0] || undefined;
    },
    /** Return all rows as an array */
    async all(...args) {
      const { sql, values } = normalise(rawSql, args);
      const result = await executor(sql, values);
      return result.rows;
    },
    /** Execute a mutation; returns { changes, lastInsertRowid } */
    async run(...args) {
      const { sql, values } = normalise(rawSql, args);
      let finalSql = sql;
      // Auto-append RETURNING * to bare INSERTs so we can read lastInsertRowid
      if (/^\s*INSERT/i.test(finalSql) && !/RETURNING/i.test(finalSql)) {
        finalSql += ' RETURNING *';
      }
      const result = await executor(finalSql, values);
      return {
        changes: result.rowCount,
        lastInsertRowid: result.rows && result.rows[0] ? result.rows[0].id : null,
      };
    },
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

const db = {
  /** Returns a PreparedStatement-like object with async get/all/run. */
  prepare(sql) {
    return createPrepared((s, v) => pool.query(s, v), sql);
  },

  /** Execute raw SQL (DDL, multi-statement). */
  async exec(sql) {
    await pool.query(sql);
  },

  /**
   * Run `fn(txDb)` inside a database transaction.
   * txDb has the same `.prepare()` interface but uses the transaction client.
   */
  async transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const txDb = {
        prepare(sql) {
          return createPrepared((s, v) => client.query(s, v), sql);
        },
      };
      await fn(txDb);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },
};

// ── Seed teams ──────────────────────────────────────────────────────────────

const SEED_TEAMS = [
  { name: '1K Knights',                league_type: 'threes', ea_club_id: 40577,  color1: '#ff1740', color2: '#aeaeb0' },
  { name: 'Hope Skate Park',           league_type: 'threes', ea_club_id: 18810,  color1: '#6e2d71', color2: '#3a6e8c' },
  { name: 'Montrescotia Buffalos',     league_type: 'threes', ea_club_id: 6021,   color1: '#db0228', color2: '#ffffff' },
  { name: 'Cape Cod Rangers',          league_type: 'threes', ea_club_id: 5364,   color1: '#264d20', color2: '#ebd6a9' },
  { name: 'Canadian Frostbytes',       league_type: 'threes', ea_club_id: 7176,   color1: '#032974', color2: '#31eff5' },
  { name: 'Blood Sweat & Beers',       league_type: 'threes', ea_club_id: 18206,  color1: '#d5520b', color2: '#072a48' },
  { name: 'Number 5 Orange',           league_type: 'threes', ea_club_id: 6021,   color1: '#fe8e01', color2: '#050404' },
  { name: 'Cooper Gang HC',            league_type: 'threes', ea_club_id: 40779,  color1: '#023c7f', color2: '#ffffff' },
  { name: 'Arizona Beauts',            league_type: 'threes', ea_club_id: 1055,   color1: '#7772a8', color2: '#1a1a1a' },
  { name: 'Why So Sweaty',             league_type: 'threes', ea_club_id: 4793,   color1: '#d60c1f', color2: '#010103' },
  { name: 'Reading Rizzzzzzzz',        league_type: 'threes', ea_club_id: 7126,   color1: '#274194', color2: '#c0be7d' },
  { name: 'The Fresh Bake',            league_type: 'threes', ea_club_id: 19600,  color1: '#420c62', color2: '#efd310' },
  { name: 'F around and Find Out',     league_type: 'threes', ea_club_id: 1273,   color1: '#d15701', color2: '#091c33' },
  { name: 'NCHL PITTSBURGH PENGUINS',  league_type: 'threes', ea_club_id: 144152, color1: '#ffb81c', color2: '#000000' },
  { name: 'Reverse HC',                league_type: 'threes', ea_club_id: 133450, color1: '#ceb164', color2: '#0d0d0c' },
  { name: 'Blackout Bandits',          league_type: 'threes', ea_club_id: 14261,  color1: '#ff8121', color2: '#202020' },
];

/** Run seed upserts — called once at startup from server.js. */
async function seedTeams() {
  for (const t of SEED_TEAMS) {
    // Use PostgreSQL INSERT … ON CONFLICT to upsert
    await pool.query(
      `INSERT INTO teams (name, conference, division, league_type, ea_club_id, color1, color2)
       VALUES ($1, '', '', $2, $3, $4, $5)
       ON CONFLICT (name) DO UPDATE SET
         league_type = EXCLUDED.league_type,
         ea_club_id  = EXCLUDED.ea_club_id,
         color1      = EXCLUDED.color1,
         color2      = EXCLUDED.color2`,
      [t.name, t.league_type || '', t.ea_club_id || null, t.color1 || '', t.color2 || '']
    );
  }
  console.log(`[db] Upserted ${SEED_TEAMS.length} seeded team(s).`);
}

/**
 * Read and execute supabase/schema.sql to ensure all tables exist.
 * Uses CREATE … IF NOT EXISTS so it is safe to run on every startup.
 */
async function initSchema() {
  const schemaPath = path.join(__dirname, 'supabase', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  console.log('[db] Schema initialised from supabase/schema.sql');
}

db.initSchema = initSchema;
db.seedTeams = seedTeams;
db.pool = pool;

module.exports = db;
