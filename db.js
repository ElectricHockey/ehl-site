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

// Accept either the app's own DATABASE_URL or the Vercel/Supabase integration
// names (POSTGRES_URL, POSTGRES_URL_NON_POOLING) so no manual env var setup is
// needed after linking the Supabase project in Vercel.
const DATABASE_URL = process.env.DATABASE_URL
  || process.env.POSTGRES_URL
  || process.env.POSTGRES_URL_NON_POOLING
  || '';

// Detect serverless environment to tune pool settings.
const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Supabase requires SSL; rejectUnauthorized must be false for their pooler
  // certificates. For self-hosted PostgreSQL over localhost, SSL is disabled.
  ssl: DATABASE_URL && !DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
  // Serverless functions need a small, short-lived pool to avoid connection leaks.
  ...(IS_SERVERLESS ? { max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 } : {}),
});

// Critical: handle idle connection errors so they don't crash the process.
// Without this, Vercel functions get FUNCTION_INVOCATION_FAILED on stale connections.
pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
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
 * Create all tables / indexes if they don't already exist.
 * Inlined so it works on Vercel serverless (no filesystem dependency).
 * The canonical copy lives in supabase/schema.sql for reference.
 *
 * Each statement is executed individually so that:
 *   1. A failure in one statement doesn't roll back the rest (critical on
 *      Supabase's Supavisor pooler which runs multi-statement strings
 *      inside a single implicit transaction).
 *   2. The citext extension can fail gracefully without blocking tables.
 */
async function initSchema() {
  // ── 1. Enable citext (case-insensitive text) if possible ─────────────
  //    On Supabase this may already be enabled (via Dashboard) in the
  //    `extensions` schema, or the role may lack CREATE privileges.
  let hasCitext = false;

  // Try the most common creation variants
  for (const sql of [
    'CREATE EXTENSION IF NOT EXISTS citext',
    'CREATE EXTENSION IF NOT EXISTS citext SCHEMA public',
    'CREATE EXTENSION IF NOT EXISTS citext SCHEMA extensions',
  ]) {
    try { await pool.query(sql); hasCitext = true; break; } catch (_) { /* try next */ }
  }

  // Extension may already exist (enabled via Supabase Dashboard)
  if (!hasCitext) {
    try {
      await pool.query("SELECT 'x'::citext");
      hasCitext = true;
    } catch (_) {
      // Try with extensions schema in search_path (session-level so it
      // persists for subsequent queries on this connection from the pool).
      try {
        await pool.query("SET search_path TO public, extensions");
        await pool.query("SELECT 'x'::citext");
        hasCitext = true;
      } catch (_2) { /* truly unavailable */ }
    }
  }

  const usernameType = hasCitext ? 'CITEXT' : 'TEXT';
  if (!hasCitext) {
    console.warn('[db] citext extension unavailable — usernames will be case-sensitive.');
  }

  // ── 2. Create tables (one statement at a time) ───────────────────────
  const tables = [
    `CREATE TABLE IF NOT EXISTS seasons (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      is_active   INTEGER DEFAULT 0,
      league_type TEXT DEFAULT '',
      is_playoff  INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS teams (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      conference  TEXT NOT NULL DEFAULT '',
      division    TEXT NOT NULL DEFAULT '',
      ea_club_id  INTEGER,
      logo_url    TEXT,
      color1      TEXT DEFAULT '',
      color2      TEXT DEFAULT '',
      league_type TEXT DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      ${usernameType} NOT NULL UNIQUE,
      platform      TEXT NOT NULL DEFAULT 'xbox',
      password_hash TEXT,
      email         TEXT,
      position      TEXT,
      ip_hash       TEXT,
      discord       TEXT,
      discord_id    TEXT,
      role          TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS signing_offers (
      id          SERIAL PRIMARY KEY,
      team_id     INTEGER NOT NULL REFERENCES teams(id),
      user_id     INTEGER NOT NULL REFERENCES users(id),
      offered_by  INTEGER NOT NULL REFERENCES users(id),
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS team_staff (
      id      SERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      role    TEXT NOT NULL DEFAULT 'owner',
      UNIQUE(team_id, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS players (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      team_id     INTEGER REFERENCES teams(id),
      position    TEXT,
      number      INTEGER,
      user_id     INTEGER,
      is_rostered INTEGER DEFAULT 1,
      discord     TEXT,
      discord_id  TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS games (
      id                SERIAL PRIMARY KEY,
      home_team_id      INTEGER NOT NULL REFERENCES teams(id),
      away_team_id      INTEGER NOT NULL REFERENCES teams(id),
      home_score        INTEGER NOT NULL DEFAULT 0,
      away_score        INTEGER NOT NULL DEFAULT 0,
      date              TEXT NOT NULL,
      ea_match_id       TEXT,
      status            TEXT DEFAULT 'scheduled',
      season_id         INTEGER,
      is_overtime       INTEGER DEFAULT 0,
      playoff_series_id INTEGER,
      is_forfeit        INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS playoffs (
      id                  SERIAL PRIMARY KEY,
      season_id           INTEGER NOT NULL UNIQUE REFERENCES seasons(id) ON DELETE CASCADE,
      teams_qualify       INTEGER NOT NULL DEFAULT 8,
      min_games_played    INTEGER NOT NULL DEFAULT 0,
      series_length       INTEGER NOT NULL DEFAULT 7,
      playoff_season_id   INTEGER,
      created_at          TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS playoff_teams (
      id          SERIAL PRIMARY KEY,
      playoff_id  INTEGER NOT NULL REFERENCES playoffs(id) ON DELETE CASCADE,
      team_id     INTEGER NOT NULL REFERENCES teams(id),
      seed        INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS playoff_series (
      id              SERIAL PRIMARY KEY,
      playoff_id      INTEGER NOT NULL REFERENCES playoffs(id) ON DELETE CASCADE,
      round_number    INTEGER NOT NULL,
      series_number   INTEGER NOT NULL,
      high_seed_id    INTEGER REFERENCES teams(id),
      low_seed_id     INTEGER REFERENCES teams(id),
      high_seed_num   INTEGER,
      low_seed_num    INTEGER,
      high_seed_wins  INTEGER NOT NULL DEFAULT 0,
      low_seed_wins   INTEGER NOT NULL DEFAULT 0,
      winner_id       INTEGER REFERENCES teams(id)
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS game_player_stats (
      id                    SERIAL PRIMARY KEY,
      game_id               INTEGER NOT NULL REFERENCES games(id),
      team_id               INTEGER NOT NULL REFERENCES teams(id),
      player_name           TEXT NOT NULL,
      position              TEXT,
      overall_rating        INTEGER DEFAULT 0,
      offensive_rating      INTEGER DEFAULT 0,
      defensive_rating      INTEGER DEFAULT 0,
      team_play_rating      INTEGER DEFAULT 0,
      goals                 INTEGER DEFAULT 0,
      assists               INTEGER DEFAULT 0,
      shots                 INTEGER DEFAULT 0,
      shot_attempts         INTEGER DEFAULT 0,
      hits                  INTEGER DEFAULT 0,
      plus_minus            INTEGER DEFAULT 0,
      pim                   INTEGER DEFAULT 0,
      blocked_shots         INTEGER DEFAULT 0,
      takeaways             INTEGER DEFAULT 0,
      giveaways             INTEGER DEFAULT 0,
      possession_secs       INTEGER DEFAULT 0,
      pass_attempts         INTEGER DEFAULT 0,
      pass_completions      INTEGER DEFAULT 0,
      pass_pct              REAL,
      faceoff_wins          INTEGER DEFAULT 0,
      faceoff_losses        INTEGER DEFAULT 0,
      pp_goals              INTEGER DEFAULT 0,
      sh_goals              INTEGER DEFAULT 0,
      gwg                   INTEGER DEFAULT 0,
      penalties_drawn       INTEGER DEFAULT 0,
      deflections           INTEGER DEFAULT 0,
      interceptions         INTEGER DEFAULT 0,
      hat_tricks            INTEGER DEFAULT 0,
      toi                   INTEGER DEFAULT 0,
      saves                 INTEGER DEFAULT 0,
      save_pct              REAL,
      goals_against         INTEGER DEFAULT 0,
      shots_against         INTEGER DEFAULT 0,
      goalie_wins           INTEGER DEFAULT 0,
      goalie_losses         INTEGER DEFAULT 0,
      goalie_otw            INTEGER DEFAULT 0,
      goalie_otl            INTEGER DEFAULT 0,
      shutouts              INTEGER DEFAULT 0,
      penalty_shot_attempts INTEGER DEFAULT 0,
      penalty_shot_ga       INTEGER DEFAULT 0,
      breakaway_shots       INTEGER DEFAULT 0,
      breakaway_saves       INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS season_player_stats (
      id              SERIAL PRIMARY KEY,
      season_id       INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      team_id         INTEGER REFERENCES teams(id),
      player_name     TEXT NOT NULL,
      position        TEXT DEFAULT '',
      games_played    INTEGER DEFAULT 0,
      goals           INTEGER DEFAULT 0,
      assists         INTEGER DEFAULT 0,
      plus_minus      INTEGER DEFAULT 0,
      pim             INTEGER DEFAULT 0,
      shots           INTEGER DEFAULT 0,
      pp_goals        INTEGER DEFAULT 0,
      sh_goals        INTEGER DEFAULT 0,
      gwg             INTEGER DEFAULT 0,
      saves           INTEGER DEFAULT 0,
      save_pct        REAL,
      goals_against   INTEGER DEFAULT 0,
      goalie_wins     INTEGER DEFAULT 0,
      goalie_losses   INTEGER DEFAULT 0,
      shutouts        INTEGER DEFAULT 0,
      gaa             REAL,
      source          TEXT DEFAULT 'import'
    )`,
  ];

  for (const sql of tables) {
    try {
      await pool.query(sql);
    } catch (err) {
      // Log which table failed and re-throw
      const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
      const name = match ? match[1] : '(unknown)';
      console.error(`[db] Failed to create table "${name}":`, err.message);
      throw err;
    }
  }

  // ── 3. Create indexes ────────────────────────────────────────────────
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_games_season        ON games(season_id)',
    'CREATE INDEX IF NOT EXISTS idx_games_status         ON games(status)',
    'CREATE INDEX IF NOT EXISTS idx_games_home           ON games(home_team_id)',
    'CREATE INDEX IF NOT EXISTS idx_games_away           ON games(away_team_id)',
    'CREATE INDEX IF NOT EXISTS idx_games_playoff_series ON games(playoff_series_id)',
    'CREATE INDEX IF NOT EXISTS idx_gps_game             ON game_player_stats(game_id)',
    'CREATE INDEX IF NOT EXISTS idx_gps_team             ON game_player_stats(team_id)',
    'CREATE INDEX IF NOT EXISTS idx_gps_player           ON game_player_stats(player_name)',
    'CREATE INDEX IF NOT EXISTS idx_players_team          ON players(team_id)',
    'CREATE INDEX IF NOT EXISTS idx_players_user          ON players(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_sps_season            ON season_player_stats(season_id)',
    'CREATE INDEX IF NOT EXISTS idx_sps_player            ON season_player_stats(player_name)',
  ];

  for (const sql of indexes) {
    try { await pool.query(sql); } catch (err) {
      console.warn('[db] Index warning:', err.message);
    }
  }

  // ── 4. Migrations ───────────────────────────────────────────────────
  // Make password_hash nullable (Discord-only auth, no password needed)
  try {
    await pool.query('ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL');
  } catch (err) {
    // Ignore if already nullable or column doesn't exist
    if (err.message && !err.message.includes('does not exist')) {
      console.warn('[db] Migration warning (password_hash nullable):', err.message);
    }
  }

  console.log('[db] Schema initialised.');
}

db.initSchema = initSchema;
db.seedTeams = seedTeams;
db.pool = pool;

module.exports = db;
