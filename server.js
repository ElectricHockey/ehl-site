const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const multer = require('multer');
const db = require('./db');

const app = express();
const PORT = 3000;

// ── Uploads directory ──────────────────────────────────────────────────────

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = crypto.randomBytes(8).toString('hex');
    cb(null, `logo-${Date.now()}-${unique}${ext}`);
  },
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  },
});

// ── Rate limiting ──────────────────────────────────────────────────────────

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(cors());
app.use(express.json());
app.use('/api', apiLimiter);
app.use(express.static(path.join(__dirname, 'public')));

// ── Admin Auth ─────────────────────────────────────────────────────────────

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ehl-admin';
const adminSessions = new Set();

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ error: 'Admin access required' });
  }
  next();
}

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  adminSessions.add(token);
  res.json({ token });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) adminSessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/auth/status', (req, res) => {
  const token = req.headers['x-admin-token'];
  res.json({ isAdmin: !!(token && adminSessions.has(token)) });
});

// ── Seasons ────────────────────────────────────────────────────────────────

app.get('/api/seasons', (_req, res) => {
  const seasons = db.prepare('SELECT * FROM seasons ORDER BY id DESC').all();
  res.json(seasons);
});

app.post('/api/seasons', requireAdmin, (req, res) => {
  const { name, make_active } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Season name is required' });
  }
  if (make_active) {
    db.prepare('UPDATE seasons SET is_active = 0').run();
  }
  const result = db.prepare('INSERT INTO seasons (name, is_active) VALUES (?, ?)').run(
    name.trim(), make_active ? 1 : 0
  );
  res.status(201).json({ id: result.lastInsertRowid, name: name.trim(), is_active: make_active ? 1 : 0 });
});

app.patch('/api/seasons/:id', requireAdmin, (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const name = req.body.name !== undefined ? req.body.name.trim() : season.name;
  if (req.body.is_active) {
    db.prepare('UPDATE seasons SET is_active = 0').run();
  }
  const is_active = req.body.is_active ? 1 : (req.body.is_active === false ? 0 : season.is_active);
  db.prepare('UPDATE seasons SET name = ?, is_active = ? WHERE id = ?').run(name, is_active, req.params.id);
  res.json({ updated: true });
});

app.delete('/api/seasons/:id', requireAdmin, (req, res) => {
  // Games in this season are NOT deleted; they lose their season_id
  db.prepare('UPDATE games SET season_id = NULL WHERE season_id = ?').run(req.params.id);
  const result = db.prepare('DELETE FROM seasons WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Season not found' });
  res.json({ deleted: true });
});

// ── Teams ──────────────────────────────────────────────────────────────────

app.get('/api/teams', (_req, res) => {
  const teams = db.prepare('SELECT * FROM teams ORDER BY name').all();
  res.json(teams);
});

// Create team – accepts multipart/form-data (with optional logo) OR JSON
app.post('/api/teams', requireAdmin, logoUpload.single('logo'), (req, res) => {
  const body = req.body;
  const name = (body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const conference = (body.conference || '').trim();
  const division = (body.division || '').trim();
  const ea_club_id = body.ea_club_id ? Number(body.ea_club_id) : null;
  const logo_url = req.file ? `/uploads/${req.file.filename}` : (body.logo_url || null);

  const result = db.prepare(
    'INSERT INTO teams (name, conference, division, ea_club_id, logo_url) VALUES (?, ?, ?, ?, ?)'
  ).run(name, conference, division, ea_club_id, logo_url);
  res.status(201).json({ id: result.lastInsertRowid, name, conference, division, ea_club_id, logo_url });
});

// Update team – accepts multipart/form-data (with optional logo) OR JSON
app.patch('/api/teams/:id', requireAdmin, logoUpload.single('logo'), (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const body = req.body;
  const name = body.name !== undefined ? (body.name || '').trim() : team.name;
  const conference = body.conference !== undefined ? (body.conference || '').trim() : team.conference;
  const division = body.division !== undefined ? (body.division || '').trim() : team.division;
  const ea_club_id = body.ea_club_id !== undefined
    ? (body.ea_club_id ? Number(body.ea_club_id) : null)
    : team.ea_club_id;

  let logo_url = team.logo_url;
  if (req.file) {
    logo_url = `/uploads/${req.file.filename}`;
    // Delete old logo file if it exists
    if (team.logo_url) {
      const old = path.join(__dirname, 'public', team.logo_url);
      fs.unlink(old, err => { if (err && err.code !== 'ENOENT') console.warn('logo unlink:', err.message); });
    }
  } else if (body.logo_url !== undefined) {
    logo_url = body.logo_url || null;
  }

  db.prepare('UPDATE teams SET name=?, conference=?, division=?, ea_club_id=?, logo_url=? WHERE id=?')
    .run(name, conference, division, ea_club_id, logo_url, req.params.id);
  res.json({ updated: true });
});

app.delete('/api/teams/:id', requireAdmin, (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  // Delete logo file
  if (team.logo_url) {
    const logoPath = path.join(__dirname, 'public', team.logo_url);
    fs.unlink(logoPath, err => { if (err && err.code !== 'ENOENT') console.warn('logo unlink:', err.message); });
  }
  db.prepare('DELETE FROM game_player_stats WHERE team_id = ?').run(req.params.id);
  db.prepare('DELETE FROM players WHERE team_id = ?').run(req.params.id);
  db.prepare('DELETE FROM games WHERE home_team_id = ? OR away_team_id = ?').run(req.params.id, req.params.id);
  db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// ── EA Helpers ─────────────────────────────────────────────────────────────

const EA_POSITIONS = { '0': 'G', '1': 'C', '2': 'LW', '3': 'RW', '4': 'LD', '5': 'RD' };

function mapResult(r) {
  if (r === '1' || r === 1) return 'W';
  if (r === '2' || r === 2) return 'L';
  return '?';
}

function mapEAPlayer(p) {
  const goals = Number(p.skgoals) || 0;
  const assists = Number(p.skassists) || 0;
  return {
    name: p.playername || p.name || 'Unknown',
    position: EA_POSITIONS[String(p.position)] || String(p.position || ''),
    goals, assists, points: goals + assists,
    shots: Number(p.skshots) || 0,
    hits: Number(p.skhits) || 0,
    plusMinus: Number(p.skplusmin) || 0,
    pim: Number(p.skpim) || 0,
    blockedShots: Number(p.skbs) || 0,
    takeaways: Number(p.sktakeaways) || 0,
    giveaways: Number(p.skgiveaways) || 0,
    possessionSecs: Number(p.skpossession) || 0,
    passAttempts: Number(p.skpassattempts) || 0,
    passPct: p.skpasspct ? parseFloat(p.skpasspct) : null,
    faceoffWins: Number(p.skfaceoffwins) || 0,
    faceoffLosses: Number(p.skfaceoffloss) || 0,
    ppGoals: Number(p.skpowerplaygoals || p.skppg) || 0,
    shGoals: Number(p.skshorthandedgoals || p.skshg) || 0,
    toi: Number(p.toiseconds || p.skToi) || 0,
    saves: Number(p.glsaves) || 0,
    savesPct: p.glsavePct ? parseFloat(p.glsavePct) : null,
    goalsAgainst: Number(p.glga) || 0,
    shotsAgainst: Number(p.glshots) || 0,
  };
}

async function fetchEA(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json',
      Referer: 'https://www.ea.com/',
      Origin: 'https://www.ea.com',
    },
  });
  if (!res.ok) throw new Error(`EA API responded with ${res.status}`);
  return res.json();
}

// ── Team season stats (DB) ─────────────────────────────────────────────────

app.get('/api/teams/:id/stats', (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
  const seasonFilter = seasonId
    ? 'AND g.season_id = ?'
    : '';
  const params = seasonId ? [req.params.id, seasonId] : [req.params.id];
  const recentParams = seasonId ? [req.params.id, req.params.id, seasonId] : [req.params.id, req.params.id];

  const skaterStats = db.prepare(`
    SELECT gps.player_name AS name, gps.position,
      COUNT(DISTINCT gps.game_id) AS gp,
      SUM(gps.goals) AS goals, SUM(gps.assists) AS assists,
      SUM(gps.goals + gps.assists) AS points,
      SUM(gps.shots) AS shots, SUM(gps.hits) AS hits,
      SUM(gps.plus_minus) AS plus_minus, SUM(gps.pim) AS pim,
      SUM(gps.blocked_shots) AS blocked_shots, SUM(gps.takeaways) AS takeaways,
      SUM(gps.giveaways) AS giveaways, SUM(gps.pp_goals) AS pp_goals,
      SUM(gps.sh_goals) AS sh_goals, SUM(gps.toi) AS toi
    FROM game_player_stats gps
    JOIN games g ON gps.game_id = g.id
    WHERE gps.team_id = ? AND gps.position != 'G' AND g.status = 'complete' ${seasonFilter}
    GROUP BY gps.player_name
    ORDER BY points DESC, goals DESC
  `).all(...params);

  const goalieStats = db.prepare(`
    SELECT gps.player_name AS name,
      COUNT(DISTINCT gps.game_id) AS gp,
      SUM(gps.saves) AS saves, SUM(gps.goals_against) AS goals_against,
      SUM(gps.shots_against) AS shots_against,
      CASE WHEN SUM(gps.shots_against) > 0
        THEN ROUND(CAST(SUM(gps.saves) AS REAL) / SUM(gps.shots_against), 3)
        ELSE NULL END AS save_pct
    FROM game_player_stats gps
    JOIN games g ON gps.game_id = g.id
    WHERE gps.team_id = ? AND gps.position = 'G' AND g.status = 'complete' ${seasonFilter}
    GROUP BY gps.player_name
    ORDER BY save_pct DESC
  `).all(...params);

  const recentSeasonFilter = seasonId ? 'AND g.season_id = ?' : '';
  const recentGames = db.prepare(`
    SELECT g.id, g.date, g.home_score, g.away_score, g.status, g.season_id,
      ht.id AS home_team_id, ht.name AS home_team_name, ht.logo_url AS home_logo,
      at.id AS away_team_id, at.name AS away_team_name, at.logo_url AS away_logo
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.id
    JOIN teams at ON g.away_team_id = at.id
    WHERE (g.home_team_id = ? OR g.away_team_id = ?) AND g.status = 'complete' ${recentSeasonFilter}
    ORDER BY g.date DESC
    LIMIT 10
  `).all(...recentParams);

  res.json({ team, skaterStats, goalieStats, recentGames });
});

// ── Players ────────────────────────────────────────────────────────────────

app.get('/api/players', (_req, res) => {
  const players = db.prepare(`
    SELECT p.*, t.name AS team_name FROM players p
    LEFT JOIN teams t ON p.team_id = t.id ORDER BY t.name, p.name
  `).all();
  res.json(players);
});

app.post('/api/players', requireAdmin, (req, res) => {
  const { name, team_id, position, number } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const result = db.prepare('INSERT INTO players (name, team_id, position, number) VALUES (?, ?, ?, ?)')
    .run(name, team_id || null, position || null, number || null);
  res.status(201).json({ id: result.lastInsertRowid, name, team_id, position, number });
});

app.delete('/api/players/:id', requireAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Player not found' });
  res.json({ deleted: true });
});

// ── Games ──────────────────────────────────────────────────────────────────

app.get('/api/games', (req, res) => {
  const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
  const filter = seasonId ? 'WHERE g.season_id = ?' : '';
  const params = seasonId ? [seasonId] : [];
  const games = db.prepare(`
    SELECT g.*, ht.name AS home_team_name, ht.logo_url AS home_logo,
      at.name AS away_team_name, at.logo_url AS away_logo
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.id
    JOIN teams at ON g.away_team_id = at.id
    ${filter}
    ORDER BY g.date DESC
  `).all(...params);
  res.json(games);
});

app.post('/api/games', requireAdmin, (req, res) => {
  const { home_team_id, away_team_id, home_score, away_score, date, season_id } = req.body;
  if (!home_team_id || !away_team_id || !date) {
    return res.status(400).json({ error: 'home_team_id, away_team_id, and date are required' });
  }
  const result = db.prepare(
    'INSERT INTO games (home_team_id, away_team_id, home_score, away_score, date, status, season_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(home_team_id, away_team_id, home_score || 0, away_score || 0, date, 'scheduled', season_id || null);
  res.status(201).json({
    id: result.lastInsertRowid, home_team_id, away_team_id,
    home_score: home_score || 0, away_score: away_score || 0, date,
    status: 'scheduled', season_id: season_id || null,
  });
});

app.delete('/api/games/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM game_player_stats WHERE game_id = ?').run(req.params.id);
  const result = db.prepare('DELETE FROM games WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Game not found' });
  res.json({ deleted: true });
});

app.patch('/api/games/:id', requireAdmin, (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  let home_score = game.home_score;
  let away_score = game.away_score;
  const ea_match_id = req.body.ea_match_id !== undefined ? req.body.ea_match_id : game.ea_match_id;
  const status = req.body.status !== undefined ? req.body.status : game.status;
  const season_id = req.body.season_id !== undefined ? req.body.season_id : game.season_id;

  if (req.body.home_score !== undefined) {
    home_score = parseInt(req.body.home_score, 10);
    if (isNaN(home_score) || home_score < 0 || home_score > 99)
      return res.status(400).json({ error: 'home_score must be a non-negative integer (0–99)' });
  }
  if (req.body.away_score !== undefined) {
    away_score = parseInt(req.body.away_score, 10);
    if (isNaN(away_score) || away_score < 0 || away_score > 99)
      return res.status(400).json({ error: 'away_score must be a non-negative integer (0–99)' });
  }

  db.prepare('UPDATE games SET home_score=?, away_score=?, ea_match_id=?, status=?, season_id=? WHERE id=?')
    .run(home_score, away_score, ea_match_id, status, season_id, req.params.id);

  if (req.body.player_stats) {
    const { home_players, away_players } = req.body.player_stats;
    db.prepare('DELETE FROM game_player_stats WHERE game_id = ?').run(req.params.id);
    const ins = db.prepare(`
      INSERT INTO game_player_stats
        (game_id,team_id,player_name,position,goals,assists,shots,hits,
         plus_minus,pim,blocked_shots,takeaways,giveaways,possession_secs,
         pass_attempts,pass_pct,faceoff_wins,faceoff_losses,pp_goals,sh_goals,
         toi,saves,save_pct,goals_against,shots_against)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const saveList = (players, teamId) => {
      for (const p of (players || [])) {
        ins.run(req.params.id, teamId, p.name, p.position,
          p.goals||0, p.assists||0, p.shots||0, p.hits||0,
          p.plusMinus||0, p.pim||0, p.blockedShots||0,
          p.takeaways||0, p.giveaways||0, p.possessionSecs||0,
          p.passAttempts||0, p.passPct||null,
          p.faceoffWins||0, p.faceoffLosses||0,
          p.ppGoals||0, p.shGoals||0, p.toi||0,
          p.saves||0, p.savesPct||null,
          p.goalsAgainst||0, p.shotsAgainst||0);
      }
    };
    saveList(home_players, game.home_team_id);
    saveList(away_players, game.away_team_id);
  }

  if (req.body.ea_match_id === null && !req.body.player_stats) {
    db.prepare('DELETE FROM game_player_stats WHERE game_id = ?').run(req.params.id);
  }

  res.json({ updated: true });
});

// ── Saved game stats ───────────────────────────────────────────────────────

app.get('/api/games/:id/stats', (req, res) => {
  const game = db.prepare(`
    SELECT g.*, ht.name AS home_team_name, ht.logo_url AS home_logo,
      at.name AS away_team_name, at.logo_url AS away_logo
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.id
    JOIN teams at ON g.away_team_id = at.id
    WHERE g.id = ?
  `).get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const stats = db.prepare(
    'SELECT * FROM game_player_stats WHERE game_id = ? ORDER BY position, goals DESC'
  ).all(req.params.id);
  res.json({
    game: {
      id: game.id, date: game.date, status: game.status, season_id: game.season_id,
      home_team: { id: game.home_team_id, name: game.home_team_name, logo_url: game.home_logo },
      away_team: { id: game.away_team_id, name: game.away_team_name, logo_url: game.away_logo },
      home_score: game.home_score, away_score: game.away_score,
      ea_match_id: game.ea_match_id,
    },
    home_players: stats.filter(s => s.team_id === game.home_team_id),
    away_players: stats.filter(s => s.team_id === game.away_team_id),
    has_stats: stats.length > 0,
  });
});

// ── League stats leaders ───────────────────────────────────────────────────

app.get('/api/stats/leaders', (req, res) => {
  const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
  const sf = seasonId ? 'AND g.season_id = ?' : '';
  const p = seasonId ? [seasonId] : [];

  const skaters = db.prepare(`
    SELECT gps.player_name AS name, t.name AS team_name, t.logo_url AS team_logo, gps.position,
      COUNT(DISTINCT gps.game_id) AS gp,
      SUM(gps.goals) AS goals, SUM(gps.assists) AS assists,
      SUM(gps.goals + gps.assists) AS points,
      SUM(gps.shots) AS shots, SUM(gps.hits) AS hits,
      SUM(gps.plus_minus) AS plus_minus, SUM(gps.pim) AS pim,
      SUM(gps.blocked_shots) AS blocked_shots, SUM(gps.takeaways) AS takeaways,
      SUM(gps.giveaways) AS giveaways, SUM(gps.pp_goals) AS pp_goals,
      SUM(gps.sh_goals) AS sh_goals, SUM(gps.toi) AS toi
    FROM game_player_stats gps
    JOIN teams t ON gps.team_id = t.id
    JOIN games g ON gps.game_id = g.id
    WHERE gps.position != 'G' AND g.status = 'complete' ${sf}
    GROUP BY gps.player_name, gps.team_id
    ORDER BY points DESC, goals DESC
  `).all(...p);

  const goalies = db.prepare(`
    SELECT gps.player_name AS name, t.name AS team_name, t.logo_url AS team_logo,
      COUNT(DISTINCT gps.game_id) AS gp,
      SUM(gps.saves) AS saves, SUM(gps.goals_against) AS goals_against,
      SUM(gps.shots_against) AS shots_against,
      CASE WHEN SUM(gps.shots_against) > 0
        THEN ROUND(CAST(SUM(gps.saves) AS REAL) / SUM(gps.shots_against), 3)
        ELSE NULL END AS save_pct
    FROM game_player_stats gps
    JOIN teams t ON gps.team_id = t.id
    JOIN games g ON gps.game_id = g.id
    WHERE gps.position = 'G' AND g.status = 'complete' ${sf}
    GROUP BY gps.player_name, gps.team_id
    ORDER BY save_pct DESC
  `).all(...p);

  res.json({ skaters, goalies });
});

// ── EA Matches for game picker ─────────────────────────────────────────────

app.get('/api/games/:id/ea-matches', async (req, res) => {
  const game = db.prepare(`
    SELECT g.*, ht.name AS home_team_name, ht.ea_club_id AS home_ea_club_id,
      at.name AS away_team_name, at.ea_club_id AS away_ea_club_id
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.id
    JOIN teams at ON g.away_team_id = at.id
    WHERE g.id = ?
  `).get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (!game.home_ea_club_id) return res.status(400).json({ error: 'Home team has no EA club ID configured' });

  try {
    const raw = await fetchEA(
      `https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=common-gen5&clubIds=${game.home_ea_club_id}`
    );
    const matchArray = Array.isArray(raw) ? raw : (raw.raw || []);

    const matches = matchArray.map(m => {
      const myClub = m.clubs && m.clubs[String(game.home_ea_club_id)];
      if (!myClub) return null;
      const oppId = String(myClub.opponentClubId);
      const oppClub = m.clubs && m.clubs[oppId];
      const oppName = (oppClub && oppClub.details && oppClub.details.name) || `Club ${oppId}`;
      const isScheduledOpponent = !!game.away_ea_club_id && String(game.away_ea_club_id) === oppId;
      const players = Object.values((m.players && m.players[String(game.home_ea_club_id)]) || {}).map(mapEAPlayer);
      const awayPlayers = Object.values((m.players && m.players[oppId]) || {}).map(mapEAPlayer);
      return {
        matchId: m.matchId,
        timestamp: m.timestamp || 0,
        date: m.timestamp ? new Date(m.timestamp * 1000).toISOString().split('T')[0] : null,
        result: mapResult(myClub.result),
        homeScore: Number(myClub.score) || 0,
        awayScore: Number(myClub.opponentScore) || 0,
        opponentClubId: oppId, opponentClubName: oppName,
        isScheduledOpponent, players, awayPlayers,
      };
    }).filter(Boolean);

    res.json({
      game: {
        id: game.id, date: game.date, status: game.status,
        home_team: { id: game.home_team_id, name: game.home_team_name, ea_club_id: game.home_ea_club_id },
        away_team: { id: game.away_team_id, name: game.away_team_name, ea_club_id: game.away_ea_club_id },
        home_score: game.home_score, away_score: game.away_score,
        ea_match_id: game.ea_match_id || null,
      },
      matches,
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch EA data', details: err.message });
  }
});

// ── Standings (complete games, filtered by season) ─────────────────────────

app.get('/api/standings', (req, res) => {
  const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
  const teams = db.prepare('SELECT * FROM teams').all();
  const filter = seasonId
    ? "SELECT * FROM games WHERE status = 'complete' AND season_id = ?"
    : "SELECT * FROM games WHERE status = 'complete'";
  const games = seasonId
    ? db.prepare(filter).all(seasonId)
    : db.prepare(filter).all();

  const stats = {};
  for (const t of teams) {
    stats[t.id] = { id: t.id, name: t.name, logo_url: t.logo_url || null,
      conference: t.conference, division: t.division, gp: 0, w: 0, l: 0, pts: 0, gf: 0, ga: 0 };
  }
  for (const g of games) {
    const home = stats[g.home_team_id];
    const away = stats[g.away_team_id];
    if (!home || !away) continue;
    home.gp++; away.gp++;
    home.gf += g.home_score; home.ga += g.away_score;
    away.gf += g.away_score; away.ga += g.home_score;
    if (g.home_score > g.away_score) { home.w++; home.pts += 2; away.l++; }
    else if (g.away_score > g.home_score) { away.w++; away.pts += 2; home.l++; }
    else { home.pts++; away.pts++; }
  }
  res.json(Object.values(stats).sort((a, b) => b.pts - a.pts || b.w - a.w));
});

// ── EA Matches mock (legacy) ───────────────────────────────────────────────

const eaMatchesMock = [
  { id: 1, club: 'EHL Falcons', opponent: 'EHL Ravens', result: 'W', score: '5-2', date: '2026-02-15', assigned: false },
  { id: 2, club: 'EHL Falcons', opponent: 'EHL Wolves', result: 'L', score: '1-3', date: '2026-02-18', assigned: false },
  { id: 3, club: 'EHL Ravens', opponent: 'EHL Wolves', result: 'W', score: '4-1', date: '2026-02-20', assigned: false },
];

app.get('/api/ea-matches', (req, res) => {
  const { club } = req.query;
  if (club) return res.json(eaMatchesMock.filter(m => m.club.toLowerCase() === club.toLowerCase()));
  res.json(eaMatchesMock);
});

app.post('/api/ea-matches/assign', requireAdmin, (req, res) => {
  const { ea_match_id, game_id } = req.body;
  if (!ea_match_id || !game_id) return res.status(400).json({ error: 'ea_match_id and game_id are required' });
  const match = eaMatchesMock.find(m => m.id === Number(ea_match_id));
  if (!match) return res.status(404).json({ error: 'EA match not found' });
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(game_id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  match.assigned = true; match.game_id = game_id;
  res.json({ success: true, ea_match: match, game });
});

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`EHL server running at http://localhost:${PORT}`);
  console.log(`Admin password: ${ADMIN_PASSWORD}`);
});
