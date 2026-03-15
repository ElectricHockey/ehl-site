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

// ── Seed teams ──────────────────────────────────────────────────────────────
// Edit this array to define your league's teams.
// Teams are only inserted when the `teams` table is empty, so you can freely
// add/remove entries here and then delete `league.db` to re-seed from scratch.
//
// Fields:
//   name        (required) – display name of the team
//   conference  – e.g. 'East', 'West'  (leave '' if unused)
//   division    – e.g. 'Atlantic', 'Pacific'  (leave '' if unused)
//   league_type – 'sixes' (6v6) | 'threes' (3v3) | '' (unset)
//   color1      – primary hex colour, e.g. '#1a73e8'
//   color2      – secondary hex colour, e.g. '#ffffff'
//
// To link each team to its EA Pro Clubs club, use the Admin panel after startup
// (or add an `ea_club_id` integer field here and include it in the INSERT below).

const SEED_TEAMS = [
  // ── Example teams – replace with your actual teams ──────────────────────
  // { name: 'Chicago Wolves',      conference: 'West', division: 'Central',  league_type: 'sixes',  color1: '#cc0000', color2: '#000000' },
  // { name: 'New York Rangers',    conference: 'East', division: 'Atlantic', league_type: 'sixes',  color1: '#0038a8', color2: '#ce1126' },
  // { name: 'Toronto Maple Leafs', conference: 'East', division: 'Atlantic', league_type: 'sixes',  color1: '#003e7e', color2: '#ffffff' },
  // { name: 'Vancouver Canucks',   conference: 'West', division: 'Pacific',  league_type: 'sixes',  color1: '#00843d', color2: '#00205b' },
];

if (SEED_TEAMS.length > 0) {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM teams').get().n;
  if (existing === 0) {
    const insert = db.prepare(
      'INSERT INTO teams (name, conference, division, league_type, color1, color2) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const seedAll = db.transaction(() => {
      for (const t of SEED_TEAMS) {
        insert.run(
          t.name        || '',
          t.conference  || '',
          t.division    || '',
          t.league_type || '',
          t.color1      || '',
          t.color2      || ''
        );
      }
    });
    seedAll();
    console.log(`[db] Seeded ${SEED_TEAMS.length} team(s).`);
  }
}

module.exports = db;
