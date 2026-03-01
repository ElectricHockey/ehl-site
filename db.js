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
    pass_pct REAL,
    faceoff_wins INTEGER DEFAULT 0,
    faceoff_losses INTEGER DEFAULT 0,
    pp_goals INTEGER DEFAULT 0,
    sh_goals INTEGER DEFAULT 0,
    toi INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    save_pct REAL,
    goals_against INTEGER DEFAULT 0,
    shots_against INTEGER DEFAULT 0,
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

module.exports = db;
