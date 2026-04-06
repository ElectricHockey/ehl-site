const Database = require('better-sqlite3');

const db = new Database('league.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_active INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    conference TEXT NOT NULL DEFAULT '',
    division TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    platform TEXT NOT NULL DEFAULT 'xbox',
    password_hash TEXT NOT NULL,
    email TEXT,
    position TEXT,
    ip_hash TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS signing_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    offered_by INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (offered_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS team_staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(team_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    team_id INTEGER,
    position TEXT,
    number INTEGER,
    FOREIGN KEY (team_id) REFERENCES teams(id)
  );

  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    home_team_id INTEGER NOT NULL,
    away_team_id INTEGER NOT NULL,
    home_score INTEGER NOT NULL DEFAULT 0,
    away_score INTEGER NOT NULL DEFAULT 0,
    date TEXT NOT NULL,
    FOREIGN KEY (home_team_id) REFERENCES teams(id),
    FOREIGN KEY (away_team_id) REFERENCES teams(id)
  );

  CREATE TABLE IF NOT EXISTS playoffs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL UNIQUE,
    teams_qualify INTEGER NOT NULL DEFAULT 8,
    min_games_played INTEGER NOT NULL DEFAULT 0,
    series_length INTEGER NOT NULL DEFAULT 7,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS playoff_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playoff_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    seed INTEGER NOT NULL,
    FOREIGN KEY (playoff_id) REFERENCES playoffs(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id)
  );

  CREATE TABLE IF NOT EXISTS playoff_series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playoff_id INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    series_number INTEGER NOT NULL,
    high_seed_id INTEGER,
    low_seed_id INTEGER,
    high_seed_num INTEGER,
    low_seed_num INTEGER,
    high_seed_wins INTEGER NOT NULL DEFAULT 0,
    low_seed_wins INTEGER NOT NULL DEFAULT 0,
    winner_id INTEGER,
    FOREIGN KEY (playoff_id) REFERENCES playoffs(id) ON DELETE CASCADE,
    FOREIGN KEY (high_seed_id) REFERENCES teams(id),
    FOREIGN KEY (low_seed_id) REFERENCES teams(id),
    FOREIGN KEY (winner_id) REFERENCES teams(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS game_player_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    player_name TEXT NOT NULL,
    position TEXT,
    overall_rating INTEGER DEFAULT 0,
    offensive_rating INTEGER DEFAULT 0,
    defensive_rating INTEGER DEFAULT 0,
    team_play_rating INTEGER DEFAULT 0,
    goals INTEGER DEFAULT 0,
    assists INTEGER DEFAULT 0,
    shots INTEGER DEFAULT 0,
    shot_attempts INTEGER DEFAULT 0,
    hits INTEGER DEFAULT 0,
    plus_minus INTEGER DEFAULT 0,
    pim INTEGER DEFAULT 0,
    blocked_shots INTEGER DEFAULT 0,
    takeaways INTEGER DEFAULT 0,
    giveaways INTEGER DEFAULT 0,
    possession_secs INTEGER DEFAULT 0,
    pass_attempts INTEGER DEFAULT 0,
    pass_completions INTEGER DEFAULT 0,
    pass_pct REAL,
    faceoff_wins INTEGER DEFAULT 0,
    faceoff_losses INTEGER DEFAULT 0,
    pp_goals INTEGER DEFAULT 0,
    sh_goals INTEGER DEFAULT 0,
    gwg INTEGER DEFAULT 0,
    penalties_drawn INTEGER DEFAULT 0,
    deflections INTEGER DEFAULT 0,
    interceptions INTEGER DEFAULT 0,
    hat_tricks INTEGER DEFAULT 0,
    toi INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    save_pct REAL,
    goals_against INTEGER DEFAULT 0,
    shots_against INTEGER DEFAULT 0,
    goalie_wins INTEGER DEFAULT 0,
    goalie_losses INTEGER DEFAULT 0,
    goalie_otw INTEGER DEFAULT 0,
    goalie_otl INTEGER DEFAULT 0,
    shutouts INTEGER DEFAULT 0,
    penalty_shot_attempts INTEGER DEFAULT 0,
    penalty_shot_ga INTEGER DEFAULT 0,
    breakaway_shots INTEGER DEFAULT 0,
    breakaway_saves INTEGER DEFAULT 0,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (team_id) REFERENCES teams(id)
  );
`);

// Migrations – safe to re-run
try { db.exec('ALTER TABLE teams ADD COLUMN ea_club_id INTEGER'); } catch (_) {}
try { db.exec('ALTER TABLE teams ADD COLUMN logo_url TEXT'); } catch (_) {}
try { db.exec("ALTER TABLE teams ADD COLUMN conference TEXT NOT NULL DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE teams ADD COLUMN division TEXT NOT NULL DEFAULT ''"); } catch (_) {}
try { db.exec('ALTER TABLE games ADD COLUMN ea_match_id TEXT'); } catch (_) {}
try { db.exec("ALTER TABLE games ADD COLUMN status TEXT DEFAULT 'scheduled'"); } catch (_) {}
try { db.exec('ALTER TABLE games ADD COLUMN season_id INTEGER'); } catch (_) {}
try { db.exec("ALTER TABLE seasons ADD COLUMN league_type TEXT DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE teams ADD COLUMN color1 TEXT DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE teams ADD COLUMN color2 TEXT DEFAULT ''"); } catch (_) {}
try { db.exec('ALTER TABLE games ADD COLUMN is_overtime INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec("ALTER TABLE teams ADD COLUMN league_type TEXT DEFAULT ''"); } catch (_) {}
try { db.exec('ALTER TABLE players ADD COLUMN user_id INTEGER'); } catch (_) {}
try { db.exec('ALTER TABLE players ADD COLUMN is_rostered INTEGER DEFAULT 1'); } catch (_) {}
// New game_player_stats columns
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN overall_rating INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN offensive_rating INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN defensive_rating INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN team_play_rating INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN gwg INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN penalties_drawn INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN deflections INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN interceptions INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN hat_tricks INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN pass_completions INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN shot_attempts INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN goalie_wins INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN goalie_losses INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN goalie_otw INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN goalie_otl INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN shutouts INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN penalty_shot_attempts INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN penalty_shot_ga INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN breakaway_shots INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN breakaway_saves INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE users ADD COLUMN position TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE users ADD COLUMN ip_hash TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE users ADD COLUMN discord TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE users ADD COLUMN discord_id TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE games ADD COLUMN playoff_series_id INTEGER'); } catch (_) {}
try { db.exec('ALTER TABLE players ADD COLUMN discord TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE players ADD COLUMN discord_id TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE users ADD COLUMN role TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE seasons ADD COLUMN is_playoff INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE playoffs ADD COLUMN playoff_season_id INTEGER'); } catch (_) {}
try { db.exec('ALTER TABLE games ADD COLUMN is_forfeit INTEGER DEFAULT 0'); } catch (_) {}

// ── Historical import table ────────────────────────────────────────────────
// Stores season-level aggregate stats imported from external sources (e.g. mystatsonline).
// Used when individual game_player_stats are unavailable for older seasons.
db.exec(`
  CREATE TABLE IF NOT EXISTS season_player_stats (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id       INTEGER NOT NULL,
    team_id         INTEGER,
    player_name     TEXT    NOT NULL,
    position        TEXT    DEFAULT '',
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
    source          TEXT    DEFAULT 'import',
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id)   REFERENCES teams(id)
  );
`);

// ── Seed teams ──────────────────────────────────────────────────────────────
// Teams listed here are upserted by name on every startup (INSERT OR IGNORE),
// so they will be added to an existing DB without duplicating existing rows.
//
// Fields:
//   name        (required) – display name of the team
//   conference  – e.g. 'East', 'West'  (leave '' if unused)
//   division    – e.g. 'Atlantic', 'Pacific'  (leave '' if unused)
//   league_type – 'sixes' (6v6) | 'threes' (3v3) | '' (unset)
//   ea_club_id  – numeric EA Pro Clubs club ID
//   color1      – primary hex colour, e.g. '#1a73e8'
//   color2      – secondary hex colour

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

if (SEED_TEAMS.length > 0) {
  // Upsert each team: insert if name not present, update colors/ea_club_id if it is.
  const findByName = db.prepare('SELECT id FROM teams WHERE name = ?');
  const insertTeam = db.prepare(
    'INSERT INTO teams (name, conference, division, league_type, ea_club_id, color1, color2) VALUES (?, \'\', \'\', ?, ?, ?, ?)'
  );
  const updateTeam = db.prepare(
    'UPDATE teams SET league_type=?, ea_club_id=?, color1=?, color2=? WHERE id=?'
  );
  const seedAll = db.transaction(() => {
    for (const t of SEED_TEAMS) {
      const existing = findByName.get(t.name || '');
      if (existing) {
        updateTeam.run(t.league_type || '', t.ea_club_id || null, t.color1 || '', t.color2 || '', existing.id);
      } else {
        insertTeam.run(t.name || '', t.league_type || '', t.ea_club_id || null, t.color1 || '', t.color2 || '');
      }
    }
  });
  seedAll();
  console.log(`[db] Upserted ${SEED_TEAMS.length} seeded team(s).`);
}

module.exports = db;
