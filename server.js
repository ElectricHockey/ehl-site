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
  const { name, conference, division, ea_club_id } = req.body;
  if (!name || !conference || !division) {
    return res.status(400).json({ error: 'name, conference, and division are required' });
  }
  const result = db.prepare('INSERT INTO teams (name, conference, division, ea_club_id) VALUES (?, ?, ?, ?)').run(name, conference, division, ea_club_id || null);
  res.status(201).json({ id: result.lastInsertRowid, name, conference, division, ea_club_id: ea_club_id || null });
});

app.delete('/api/teams/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM players WHERE team_id = ?').run(id);
  db.prepare('DELETE FROM games WHERE home_team_id = ? OR away_team_id = ?').run(id, id);
  const result = db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Team not found' });
  res.json({ deleted: true });
});

app.patch('/api/teams/:id', (req, res) => {
  const { ea_club_id } = req.body;
  const result = db.prepare('UPDATE teams SET ea_club_id = ? WHERE id = ?').run(ea_club_id || null, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Team not found' });
  res.json({ updated: true });
});

// ── EA Live Matches (proxied from EA Pro Clubs API) ────────────────────────

const EA_POSITIONS = { '0': 'G', '1': 'C', '2': 'LW', '3': 'RW', '4': 'LD', '5': 'RD' };

function mapResult(r) {
  if (r === '1' || r === 1) return 'W';
  if (r === '2' || r === 2) return 'L';
  return '?';
}

async function fetchEA(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://www.ea.com/',
      'Origin': 'https://www.ea.com',
    },
  });
  if (!res.ok) throw new Error(`EA API responded with ${res.status}`);
  return res.json();
}

app.get('/api/teams/:id/ea-matches', async (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!team.ea_club_id) return res.status(400).json({ error: 'This team has no EA club ID configured' });

  const leagueTeams = db.prepare('SELECT id, name, ea_club_id FROM teams WHERE ea_club_id IS NOT NULL').all();
  const leagueClubIds = new Set(leagueTeams.map(t => String(t.ea_club_id)));
  const clubIdToTeam = Object.fromEntries(leagueTeams.map(t => [String(t.ea_club_id), t]));

  try {
    const eaUrl = `https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=common-gen5&clubIds=${team.ea_club_id}`;
    const raw = await fetchEA(eaUrl);
    const matchArray = Array.isArray(raw) ? raw : (raw.raw || []);

    const leagueMatches = matchArray.filter(m => {
      const myClub = m.clubs && m.clubs[String(team.ea_club_id)];
      return myClub && leagueClubIds.has(String(myClub.opponentClubId));
    });

    const matches = leagueMatches.map(m => {
      const myClub = m.clubs[String(team.ea_club_id)];
      const opponentId = String(myClub.opponentClubId);
      const opponentTeam = clubIdToTeam[opponentId] || null;

      const rawPlayers = (m.players && m.players[String(team.ea_club_id)]) || {};
      const players = Object.values(rawPlayers).map(p => ({
        name: p.playername || p.name || 'Unknown',
        position: EA_POSITIONS[String(p.position)] || String(p.position || ''),
        goals: Number(p.skgoals) || 0,
        assists: Number(p.skassists) || 0,
        points: (Number(p.skgoals) || 0) + (Number(p.skassists) || 0),
        shots: Number(p.skshots) || 0,
        hits: Number(p.skhits) || 0,
        plusMinus: Number(p.skplusmin) || 0,
        pim: Number(p.skpim) || 0,
        blockedShots: Number(p.skbs) || 0,
        saves: Number(p.glsaves) || 0,
        savesPct: p.glsavePct ? parseFloat(p.glsavePct) : null,
        goalsAgainst: Number(p.glga) || 0,
        toi: Number(p.toiseconds || p.skToi) || 0,
      }));

      return {
        matchId: m.matchId,
        date: m.timestamp ? new Date(m.timestamp * 1000).toISOString().split('T')[0] : null,
        result: mapResult(myClub.result),
        score: Number(myClub.score) || 0,
        opponentScore: Number(myClub.opponentScore) || 0,
        opponent: opponentTeam,
        players,
      };
    });

    res.json({ team: { id: team.id, name: team.name, ea_club_id: team.ea_club_id }, matches });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch EA data', details: err.message });
  }
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
