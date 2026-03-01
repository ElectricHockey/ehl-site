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

  CREATE TABLE IF NOT EXISTS game_player_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    player_name TEXT NOT NULL,
    position TEXT,
    overall_rating INTEGER DEFAULT 0,
    defensive_rating INTEGER DEFAULT 0,
    team_play_rating INTEGER DEFAULT 0,
    goals INTEGER DEFAULT 0,
    assists INTEGER DEFAULT 0,
    shots INTEGER DEFAULT 0,
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
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN defensive_rating INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN team_play_rating INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN gwg INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN penalties_drawn INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN deflections INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN interceptions INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN hat_tricks INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE game_player_stats ADD COLUMN pass_completions INTEGER DEFAULT 0'); } catch (_) {}
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

module.exports = db;
