-- ═══════════════════════════════════════════════════════════════════════
-- EHL — Supabase / PostgreSQL schema  (reference copy)
-- The canonical version is inlined in db.js initSchema() and runs
-- automatically on every server startup.  Keep this file in sync if
-- you add or change tables.
-- ═══════════════════════════════════════════════════════════════════════

-- Case-insensitive text for usernames
CREATE EXTENSION IF NOT EXISTS citext;

-- ── Core tables ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS seasons (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  is_active   INTEGER DEFAULT 0,
  league_type TEXT DEFAULT '',
  is_playoff  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS teams (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  conference  TEXT NOT NULL DEFAULT '',
  division    TEXT NOT NULL DEFAULT '',
  ea_club_id  INTEGER,
  logo_url    TEXT,
  color1      TEXT DEFAULT '',
  color2      TEXT DEFAULT '',
  league_type TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      CITEXT NOT NULL UNIQUE,
  platform      TEXT NOT NULL DEFAULT 'xbox',
  password_hash TEXT NOT NULL,
  email         TEXT,
  position      TEXT,
  ip_hash       TEXT,
  discord       TEXT,
  discord_id    TEXT,
  role          TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signing_offers (
  id          SERIAL PRIMARY KEY,
  team_id     INTEGER NOT NULL REFERENCES teams(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  offered_by  INTEGER NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_staff (
  id      SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role    TEXT NOT NULL DEFAULT 'owner',
  UNIQUE(team_id, user_id)
);

CREATE TABLE IF NOT EXISTS players (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  team_id     INTEGER REFERENCES teams(id),
  position    TEXT,
  number      INTEGER,
  user_id     INTEGER,
  is_rostered INTEGER DEFAULT 1,
  discord     TEXT,
  discord_id  TEXT
);

CREATE TABLE IF NOT EXISTS games (
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
);

CREATE TABLE IF NOT EXISTS playoffs (
  id                  SERIAL PRIMARY KEY,
  season_id           INTEGER NOT NULL UNIQUE REFERENCES seasons(id) ON DELETE CASCADE,
  teams_qualify       INTEGER NOT NULL DEFAULT 8,
  min_games_played    INTEGER NOT NULL DEFAULT 0,
  series_length       INTEGER NOT NULL DEFAULT 7,
  playoff_season_id   INTEGER,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playoff_teams (
  id          SERIAL PRIMARY KEY,
  playoff_id  INTEGER NOT NULL REFERENCES playoffs(id) ON DELETE CASCADE,
  team_id     INTEGER NOT NULL REFERENCES teams(id),
  seed        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playoff_series (
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
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS game_player_stats (
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
);

-- ── Historical import table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS season_player_stats (
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
);

-- ── Indexes for performance ──────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_games_season        ON games(season_id);
CREATE INDEX IF NOT EXISTS idx_games_status         ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_home           ON games(home_team_id);
CREATE INDEX IF NOT EXISTS idx_games_away           ON games(away_team_id);
CREATE INDEX IF NOT EXISTS idx_games_playoff_series ON games(playoff_series_id);
CREATE INDEX IF NOT EXISTS idx_gps_game             ON game_player_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_gps_team             ON game_player_stats(team_id);
CREATE INDEX IF NOT EXISTS idx_gps_player           ON game_player_stats(player_name);
CREATE INDEX IF NOT EXISTS idx_players_team          ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_players_user          ON players(user_id);
CREATE INDEX IF NOT EXISTS idx_sps_season            ON season_player_stats(season_id);
CREATE INDEX IF NOT EXISTS idx_sps_player            ON season_player_stats(player_name);
