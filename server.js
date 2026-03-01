const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
const PORT = 3000;

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(cors());
app.use(express.json());
app.use('/api', apiLimiter);
app.use(express.static(path.join(__dirname, 'public')));

// ── Teams ──────────────────────────────────────────────────────────────────

app.get('/api/teams', (req, res) => {
  const teams = db.prepare('SELECT * FROM teams ORDER BY conference, division, name').all();
  res.json(teams);
});

app.post('/api/teams', (req, res) => {
  const { name, conference, division } = req.body;
  if (!name || !conference || !division) {
    return res.status(400).json({ error: 'name, conference, and division are required' });
  }
  const result = db.prepare('INSERT INTO teams (name, conference, division) VALUES (?, ?, ?)').run(name, conference, division);
  res.status(201).json({ id: result.lastInsertRowid, name, conference, division });
});

app.delete('/api/teams/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM players WHERE team_id = ?').run(id);
  db.prepare('DELETE FROM games WHERE home_team_id = ? OR away_team_id = ?').run(id, id);
  const result = db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Team not found' });
  res.json({ deleted: true });
});

// ── Players ────────────────────────────────────────────────────────────────

app.get('/api/players', (req, res) => {
  const players = db.prepare(`
    SELECT p.*, t.name AS team_name
    FROM players p
    LEFT JOIN teams t ON p.team_id = t.id
    ORDER BY t.name, p.name
  `).all();
  res.json(players);
});

app.post('/api/players', (req, res) => {
  const { name, team_id, position, number } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const result = db.prepare('INSERT INTO players (name, team_id, position, number) VALUES (?, ?, ?, ?)').run(name, team_id || null, position || null, number || null);
  res.status(201).json({ id: result.lastInsertRowid, name, team_id, position, number });
});

app.delete('/api/players/:id', (req, res) => {
  const result = db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Player not found' });
  res.json({ deleted: true });
});

// ── Games ──────────────────────────────────────────────────────────────────

app.get('/api/games', (req, res) => {
  const games = db.prepare(`
    SELECT g.*, ht.name AS home_team_name, at.name AS away_team_name
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.id
    JOIN teams at ON g.away_team_id = at.id
    ORDER BY g.date DESC
  `).all();
  res.json(games);
});

app.post('/api/games', (req, res) => {
  const { home_team_id, away_team_id, home_score, away_score, date } = req.body;
  if (!home_team_id || !away_team_id || !date) {
    return res.status(400).json({ error: 'home_team_id, away_team_id, and date are required' });
  }
  const result = db.prepare('INSERT INTO games (home_team_id, away_team_id, home_score, away_score, date) VALUES (?, ?, ?, ?, ?)').run(home_team_id, away_team_id, home_score || 0, away_score || 0, date);
  res.status(201).json({ id: result.lastInsertRowid, home_team_id, away_team_id, home_score: home_score || 0, away_score: away_score || 0, date });
});

app.delete('/api/games/:id', (req, res) => {
  const result = db.prepare('DELETE FROM games WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Game not found' });
  res.json({ deleted: true });
});

// ── Standings ──────────────────────────────────────────────────────────────

app.get('/api/standings', (req, res) => {
  const teams = db.prepare('SELECT * FROM teams').all();
  const games = db.prepare('SELECT * FROM games').all();

  const stats = {};
  for (const team of teams) {
    stats[team.id] = { id: team.id, name: team.name, conference: team.conference, division: team.division, gp: 0, w: 0, l: 0, pts: 0, gf: 0, ga: 0 };
  }

  for (const game of games) {
    const home = stats[game.home_team_id];
    const away = stats[game.away_team_id];
    if (!home || !away) continue;
    home.gp++; away.gp++;
    home.gf += game.home_score; home.ga += game.away_score;
    away.gf += game.away_score; away.ga += game.home_score;
    if (game.home_score > game.away_score) {
      home.w++; home.pts += 2; away.l++;
    } else if (game.away_score > game.home_score) {
      away.w++; away.pts += 2; home.l++;
    } else {
      home.pts++; away.pts++;
    }
  }

  res.json(Object.values(stats).sort((a, b) => b.pts - a.pts || b.w - a.w));
});

// ── EA Matches ─────────────────────────────────────────────────────────────

const eaMatchesMock = [
  { id: 1, club: 'EHL Falcons', opponent: 'EHL Ravens', result: 'W', score: '5-2', date: '2026-02-15', assigned: false },
  { id: 2, club: 'EHL Falcons', opponent: 'EHL Wolves', result: 'L', score: '1-3', date: '2026-02-18', assigned: false },
  { id: 3, club: 'EHL Ravens', opponent: 'EHL Wolves', result: 'W', score: '4-1', date: '2026-02-20', assigned: false },
  { id: 4, club: 'EHL Wolves', opponent: 'EHL Falcons', result: 'W', score: '3-2', date: '2026-02-22', assigned: false },
  { id: 5, club: 'EHL Ravens', opponent: 'EHL Falcons', result: 'L', score: '2-4', date: '2026-02-25', assigned: false },
];

app.get('/api/ea-matches', (req, res) => {
  const { club } = req.query;
  if (club) {
    return res.json(eaMatchesMock.filter(m => m.club.toLowerCase() === club.toLowerCase()));
  }
  res.json(eaMatchesMock);
});

app.post('/api/ea-matches/assign', (req, res) => {
  const { ea_match_id, game_id } = req.body;
  if (!ea_match_id || !game_id) {
    return res.status(400).json({ error: 'ea_match_id and game_id are required' });
  }
  const match = eaMatchesMock.find(m => m.id === Number(ea_match_id));
  if (!match) return res.status(404).json({ error: 'EA match not found' });
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(game_id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  match.assigned = true;
  match.game_id = game_id;
  res.json({ success: true, ea_match: match, game });
});

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`EHL server running at http://localhost:${PORT}`);
});
