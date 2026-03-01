const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const multer = require('multer');
const { promisify } = require('util');
const db = require('./db');

const app = express();
const PORT = 3000;
const scrypt = promisify(crypto.scrypt);

// ── Password helpers ───────────────────────────────────────────────────────

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const derived = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derived);
}

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
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  },
});

// ── Rate limiting ──────────────────────────────────────────────────────────

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });

app.use(cors());
app.use(express.json());
app.use('/api', apiLimiter);
app.use(express.static(path.join(__dirname, 'public')));

// ── Admin Auth ─────────────────────────────────────────────────────────────

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ehl-admin';
const adminSessions = new Set();
const playerSessions = new Map(); // token -> userId

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) return res.status(401).json({ error: 'Admin access required' });
  next();
}

function requirePlayer(req, res, next) {
  const token = req.headers['x-player-token'];
  if (!token || !playerSessions.has(token)) return res.status(401).json({ error: 'Player login required' });
  req.userId = playerSessions.get(token);
  next();
}

function requireTeamRole(roles) {
  return (req, res, next) => {
    const token = req.headers['x-player-token'];
    if (!token || !playerSessions.has(token)) return res.status(401).json({ error: 'Player login required' });
    req.userId = playerSessions.get(token);
    const teamId = req.params.id || req.params.teamId;
    const staff = db.prepare('SELECT role FROM team_staff WHERE team_id = ? AND user_id = ?').get(teamId, req.userId);
    if (!staff || !roles.includes(staff.role)) return res.status(403).json({ error: 'Insufficient team permissions' });
    req.staffRole = staff.role;
    next();
  };
}

// ── Admin login / logout ───────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid password' });
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

// ── Player registration & login ────────────────────────────────────────────

app.post('/api/players/register', async (req, res) => {
  const { username, platform, password, email, position } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: 'Username (gamertag) is required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const plat = (platform === 'psn' ? 'psn' : 'xbox');
  const pos = position ? position.trim() : null;
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) return res.status(409).json({ error: 'That gamertag is already registered' });
  const hash = await hashPassword(password);
  const r = db.prepare('INSERT INTO users (username, platform, password_hash, email, position) VALUES (?, ?, ?, ?, ?)')
    .run(username.trim(), plat, hash, email ? email.trim() : null, pos);
  // Also create a player record linked to this user
  const pr = db.prepare('INSERT INTO players (name, user_id, is_rostered, position) VALUES (?, ?, 0, ?)')
    .run(username.trim(), r.lastInsertRowid, pos);
  const token = crypto.randomBytes(24).toString('hex');
  playerSessions.set(token, r.lastInsertRowid);
  res.status(201).json({ token, id: r.lastInsertRowid, username: username.trim(), platform: plat, position: pos, player_id: pr.lastInsertRowid });
});

app.post('/api/players/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password' });
  const token = crypto.randomBytes(24).toString('hex');
  playerSessions.set(token, user.id);
  res.json({ token, id: user.id, username: user.username, platform: user.platform, position: user.position });
});

app.post('/api/players/logout', (req, res) => {
  playerSessions.delete(req.headers['x-player-token']);
  res.json({ ok: true });
});

app.get('/api/players/me', requirePlayer, (req, res) => {
  const user = db.prepare('SELECT id, username, platform, email, position, created_at FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.userId);
  const staff = db.prepare(`
    SELECT ts.role, t.id AS team_id, t.name AS team_name, t.logo_url, t.color1, t.color2
    FROM team_staff ts JOIN teams t ON ts.team_id = t.id WHERE ts.user_id = ?
  `).all(req.userId);
  res.json({ user, player, staff });
});

// Admin edits a registered user's profile
app.patch('/api/users/:id', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const username = req.body.username !== undefined ? req.body.username.trim() : user.username;
  const platform = req.body.platform !== undefined ? (req.body.platform === 'psn' ? 'psn' : 'xbox') : user.platform;
  const email    = req.body.email    !== undefined ? (req.body.email ? req.body.email.trim() : null) : user.email;
  const position = req.body.position !== undefined ? (req.body.position ? req.body.position.trim() : null) : user.position;
  if (username !== user.username) {
    const clash = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, user.id);
    if (clash) return res.status(409).json({ error: 'That gamertag is already taken' });
  }
  db.prepare('UPDATE users SET username = ?, platform = ?, email = ?, position = ? WHERE id = ?')
    .run(username, platform, email, position, user.id);
  // Keep the active player record in sync (one record per user by design)
  const activePlayer = db.prepare('SELECT id FROM players WHERE user_id = ? ORDER BY id LIMIT 1').get(user.id);
  if (activePlayer) {
    db.prepare('UPDATE players SET name = ?, position = ? WHERE id = ?').run(username, position, activePlayer.id);
  }
  res.json({ ok: true });
});

// ── Seasons ────────────────────────────────────────────────────────────────

app.get('/api/seasons', (req, res) => {
  const { type } = req.query;
  const seasons = type
    ? db.prepare('SELECT * FROM seasons WHERE league_type = ? ORDER BY id DESC').all(type)
    : db.prepare('SELECT * FROM seasons ORDER BY id DESC').all();
  res.json(seasons);
});

app.post('/api/seasons', requireAdmin, (req, res) => {
  const { name, make_active, league_type } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Season name is required' });
  if (make_active) db.prepare('UPDATE seasons SET is_active = 0').run();
  const lt = league_type || '';
  const result = db.prepare('INSERT INTO seasons (name, is_active, league_type) VALUES (?, ?, ?)').run(name.trim(), make_active ? 1 : 0, lt);
  res.status(201).json({ id: result.lastInsertRowid, name: name.trim(), is_active: make_active ? 1 : 0, league_type: lt });
});

app.patch('/api/seasons/:id', requireAdmin, (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const name = req.body.name !== undefined ? req.body.name.trim() : season.name;
  const league_type = req.body.league_type !== undefined ? req.body.league_type : (season.league_type || '');
  if (req.body.is_active) db.prepare('UPDATE seasons SET is_active = 0').run();
  const is_active = req.body.is_active ? 1 : (req.body.is_active === false ? 0 : season.is_active);
  db.prepare('UPDATE seasons SET name = ?, is_active = ?, league_type = ? WHERE id = ?').run(name, is_active, league_type, req.params.id);
  res.json({ updated: true });
});

app.delete('/api/seasons/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE games SET season_id = NULL WHERE season_id = ?').run(req.params.id);
  const result = db.prepare('DELETE FROM seasons WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Season not found' });
  res.json({ deleted: true });
});

// ── Teams ──────────────────────────────────────────────────────────────────

app.get('/api/teams', (_req, res) => {
  res.json(db.prepare('SELECT * FROM teams ORDER BY name').all());
});

app.post('/api/teams', requireAdmin, logoUpload.single('logo'), (req, res) => {
  const body = req.body;
  const name = (body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const conference = (body.conference || '').trim();
  const division = (body.division || '').trim();
  const ea_club_id = body.ea_club_id ? Number(body.ea_club_id) : null;
  const logo_url = req.file ? `/uploads/${req.file.filename}` : (body.logo_url || null);
  const color1 = (body.color1 || '').trim();
  const color2 = (body.color2 || '').trim();
  const league_type = (body.league_type || '').trim();
  const result = db.prepare(
    'INSERT INTO teams (name, conference, division, ea_club_id, logo_url, color1, color2, league_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, conference, division, ea_club_id, logo_url, color1, color2, league_type);
  res.status(201).json({ id: result.lastInsertRowid, name, conference, division, ea_club_id, logo_url, color1, color2, league_type });
});

app.patch('/api/teams/:id', requireAdmin, logoUpload.single('logo'), (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const body = req.body;
  const name = body.name !== undefined ? (body.name || '').trim() : team.name;
  const conference = body.conference !== undefined ? (body.conference || '').trim() : team.conference;
  const division = body.division !== undefined ? (body.division || '').trim() : team.division;
  const ea_club_id = body.ea_club_id !== undefined ? (body.ea_club_id ? Number(body.ea_club_id) : null) : team.ea_club_id;
  const color1 = body.color1 !== undefined ? (body.color1 || '').trim() : (team.color1 || '');
  const color2 = body.color2 !== undefined ? (body.color2 || '').trim() : (team.color2 || '');
  const league_type = body.league_type !== undefined ? (body.league_type || '').trim() : (team.league_type || '');
  let logo_url = team.logo_url;
  if (req.file) {
    logo_url = `/uploads/${req.file.filename}`;
    if (team.logo_url) {
      const old = path.join(__dirname, 'public', team.logo_url);
      fs.unlink(old, err => { if (err && err.code !== 'ENOENT') console.warn('logo unlink:', err.message); });
    }
  } else if (body.logo_url !== undefined) {
    logo_url = body.logo_url || null;
  }
  db.prepare('UPDATE teams SET name=?, conference=?, division=?, ea_club_id=?, logo_url=?, color1=?, color2=?, league_type=? WHERE id=?')
    .run(name, conference, division, ea_club_id, logo_url, color1, color2, league_type, req.params.id);
  res.json({ updated: true });
});

app.delete('/api/teams/:id', requireAdmin, (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (team.logo_url) {
    const logoPath = path.join(__dirname, 'public', team.logo_url);
    fs.unlink(logoPath, err => { if (err && err.code !== 'ENOENT') console.warn('logo unlink:', err.message); });
  }
  db.prepare('DELETE FROM team_staff WHERE team_id = ?').run(req.params.id);
  db.prepare('DELETE FROM game_player_stats WHERE team_id = ?').run(req.params.id);
  db.prepare('DELETE FROM players WHERE team_id = ?').run(req.params.id);
  db.prepare('DELETE FROM games WHERE home_team_id = ? OR away_team_id = ?').run(req.params.id, req.params.id);
  db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// ── Team owner / GM management ─────────────────────────────────────────────

// Admin assigns team owner
app.post('/api/teams/:id/owner', requireAdmin, (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  // Remove any existing owner for this team
  db.prepare("DELETE FROM team_staff WHERE team_id = ? AND role = 'owner'").run(req.params.id);
  db.prepare("INSERT OR REPLACE INTO team_staff (team_id, user_id, role) VALUES (?, ?, 'owner')").run(req.params.id, user_id);
  res.json({ ok: true });
});

// Admin removes team owner
app.delete('/api/teams/:id/owner', requireAdmin, (req, res) => {
  db.prepare("DELETE FROM team_staff WHERE team_id = ? AND role = 'owner'").run(req.params.id);
  res.json({ ok: true });
});

// Owner adds a GM (max 2)
app.post('/api/teams/:id/gms', requireTeamRole(['owner']), (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const gmCount = db.prepare("SELECT COUNT(*) AS cnt FROM team_staff WHERE team_id = ? AND role = 'gm'").get(req.params.id).cnt;
  if (gmCount >= 2) return res.status(400).json({ error: 'Maximum 2 GMs allowed per team' });
  const already = db.prepare('SELECT * FROM team_staff WHERE team_id = ? AND user_id = ?').get(req.params.id, user_id);
  if (already) return res.status(409).json({ error: 'User already has a role on this team' });
  db.prepare("INSERT INTO team_staff (team_id, user_id, role) VALUES (?, ?, 'gm')").run(req.params.id, user_id);
  res.json({ ok: true });
});

// Owner removes a GM
app.delete('/api/teams/:id/gms/:userId', requireTeamRole(['owner']), (req, res) => {
  db.prepare("DELETE FROM team_staff WHERE team_id = ? AND user_id = ? AND role = 'gm'").run(req.params.id, req.params.userId);
  res.json({ ok: true });
});

// ── Team roster management ─────────────────────────────────────────────────

function rosterMaxForTeam(teamId) {
  const team = db.prepare('SELECT league_type FROM teams WHERE id = ?').get(teamId);
  if (!team) return 20;
  if (team.league_type === 'threes') return 12;
  if (team.league_type === 'sixes') return 20;
  return 999; // no limit for untyped teams
}

// GM or owner sends a signing offer (player must accept)
app.post('/api/teams/:id/roster/offer', requireTeamRole(['owner', 'gm']), (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  // Already on a roster?
  const onRoster = db.prepare('SELECT * FROM players WHERE user_id = ? AND team_id IS NOT NULL AND is_rostered = 1').get(user_id);
  if (onRoster) return res.status(409).json({ error: 'Player is already on a roster' });
  // Already a pending offer from this team?
  const dupOffer = db.prepare("SELECT id FROM signing_offers WHERE team_id = ? AND user_id = ? AND status = 'pending'").get(req.params.id, user_id);
  if (dupOffer) return res.status(409).json({ error: 'A pending offer already exists for this player' });
  // Roster limit check (based on current + pending)
  const count = db.prepare('SELECT COUNT(*) AS cnt FROM players WHERE team_id = ? AND is_rostered = 1').get(req.params.id).cnt;
  const max = rosterMaxForTeam(req.params.id);
  if (count >= max) return res.status(400).json({ error: `Roster is full (max ${max})` });
  db.prepare("INSERT INTO signing_offers (team_id, user_id, offered_by, status) VALUES (?, ?, ?, 'pending')")
    .run(req.params.id, user_id, req.userId);
  res.status(201).json({ ok: true });
});

// Player fetches their pending offers
app.get('/api/players/offers', requirePlayer, (req, res) => {
  const offers = db.prepare(`
    SELECT so.id, so.status, so.created_at,
      t.id AS team_id, t.name AS team_name, t.logo_url AS team_logo,
      t.league_type, u.username AS offered_by_name
    FROM signing_offers so
    JOIN teams t ON so.team_id = t.id
    JOIN users u ON so.offered_by = u.id
    WHERE so.user_id = ? AND so.status = 'pending'
    ORDER BY so.created_at DESC
  `).all(req.userId);
  res.json(offers);
});

// Player accepts a signing offer
app.post('/api/players/offers/:id/accept', requirePlayer, (req, res) => {
  const offer = db.prepare("SELECT * FROM signing_offers WHERE id = ? AND user_id = ? AND status = 'pending'").get(req.params.id, req.userId);
  if (!offer) return res.status(404).json({ error: 'Offer not found' });
  // Re-check roster limit
  const count = db.prepare('SELECT COUNT(*) AS cnt FROM players WHERE team_id = ? AND is_rostered = 1').get(offer.team_id).cnt;
  const max = rosterMaxForTeam(offer.team_id);
  if (count >= max) {
    db.prepare("UPDATE signing_offers SET status = 'declined' WHERE id = ?").run(offer.id);
    return res.status(400).json({ error: 'Roster is now full; offer cancelled' });
  }
  db.prepare("UPDATE signing_offers SET status = 'accepted' WHERE id = ?").run(offer.id);
  // Decline all other pending offers for this player
  db.prepare("UPDATE signing_offers SET status = 'declined' WHERE user_id = ? AND status = 'pending' AND id != ?").run(req.userId, offer.id);
  // Sign the player
  let player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.userId);
  if (player) {
    db.prepare('UPDATE players SET team_id = ?, is_rostered = 1 WHERE id = ?').run(offer.team_id, player.id);
  } else {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    db.prepare('INSERT INTO players (name, user_id, team_id, is_rostered, position) VALUES (?, ?, ?, 1, ?)').run(user.username, req.userId, offer.team_id, user.position);
  }
  res.json({ ok: true });
});

// Player declines a signing offer
app.post('/api/players/offers/:id/decline', requirePlayer, (req, res) => {
  const offer = db.prepare("SELECT * FROM signing_offers WHERE id = ? AND user_id = ? AND status = 'pending'").get(req.params.id, req.userId);
  if (!offer) return res.status(404).json({ error: 'Offer not found' });
  db.prepare("UPDATE signing_offers SET status = 'declined' WHERE id = ?").run(offer.id);
  res.json({ ok: true });
});

// GM or owner releases a player from the roster
app.delete('/api/teams/:id/roster/:playerId', requireTeamRole(['owner', 'gm']), (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ? AND team_id = ?').get(req.params.playerId, req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found on this team' });
  db.prepare('UPDATE players SET team_id = NULL, is_rostered = 0 WHERE id = ?').run(req.params.playerId);
  res.json({ ok: true });
});

// ── EA Helpers ─────────────────────────────────────────────────────────────

const EA_POSITIONS = { '0': 'G', '1': 'C', '2': 'LW', '3': 'RW', '4': 'LD', '5': 'RD' };

function mapResult(r) {
  if (r === '1' || r === 1) return 'W';
  if (r === '2' || r === 2) return 'L';
  return '?';
}

function mapEAPlayer(p) {
  const goals   = Number(p.skgoals)   || 0;
  const assists = Number(p.skassists) || 0;
  const shots   = Number(p.skshots)   || 0;
  const passAtt = Number(p.skpassattempts) || 0;
  const passPct = p.skpasspct ? parseFloat(p.skpasspct) : null;
  const passComp = passPct !== null ? Math.round(passAtt * passPct / 100) : 0;
  return {
    name:             p.playername || p.name || 'Unknown',
    position:         EA_POSITIONS[String(p.position)] || String(p.position || ''),
    overallRating:    Number(p.skrating)    || 0,
    defensiveRating:  Number(p.skdefrating || p.skdefensiverating) || 0,
    teamPlayRating:   Number(p.sktprrating  || p.sktpr) || 0,
    goals, assists,   points: goals + assists,
    shots,
    hits:             Number(p.skhits)       || 0,
    plusMinus:        Number(p.skplusmin)    || 0,
    pim:              Number(p.skpim)        || 0,
    blockedShots:     Number(p.skbs)         || 0,
    takeaways:        Number(p.sktakeaways)  || 0,
    giveaways:        Number(p.skgiveaways)  || 0,
    possessionSecs:   Number(p.skpossession) || 0,
    passAttempts:     passAtt,
    passCompletions:  passComp,
    passPct,
    faceoffWins:      Number(p.skfaceoffwins) || 0,
    faceoffLosses:    Number(p.skfaceoffloss) || 0,
    ppGoals:          Number(p.skpowerplaygoals || p.skppg) || 0,
    shGoals:          Number(p.skshorthandedgoals || p.skshg) || 0,
    gwg:              Number(p.skgwg) || 0,
    penaltiesDrawn:   Number(p.skpenaltiesdrawn || p.skpd) || 0,
    deflections:      Number(p.skdeflections || p.skdfl) || 0,
    interceptions:    Number(p.skinterceptions || p.skint) || 0,
    hatTricks:        Number(p.skhattricks || p.skht) || 0,
    toi:              Number(p.toiseconds || p.skToi) || 0,
    // Goalie
    saves:            Number(p.glsaves)  || 0,
    savesPct:         p.glsavePct ? parseFloat(p.glsavePct) : null,
    goalsAgainst:     Number(p.glga)     || 0,
    shotsAgainst:     Number(p.glshots)  || 0,
    goalieWins:       Number(p.glwins)   || 0,
    goalieLosses:     Number(p.gllosses) || 0,
    goalieOtw:        Number(p.glotw || p.glotwin) || 0,
    goalieOtl:        Number(p.glotlosses || p.glotl) || 0,
    shutouts:         Number(p.glsoperiod || p.glshuts || p.glso) || 0,
    penaltyShotAttempts: Number(p.glpenshotatt || p.glpenshot) || 0,
    penaltyShotGa:    Number(p.glpengoalsa || p.glpenshotga) || 0,
    breakawayShots:   Number(p.glbkshotatt || p.glbkshotsag) || 0,
    breakawaySaves:   Number(p.glbksaves  || p.glbksvs) || 0,
  };
}

async function fetchEA(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json', Referer: 'https://www.ea.com/', Origin: 'https://www.ea.com',
    },
  });
  if (!res.ok) throw new Error(`EA API responded with ${res.status}`);
  return res.json();
}

// ── Shared stat SQL fragments ──────────────────────────────────────────────

const SKATER_SELECT = `
  gps.player_name AS name, t.name AS team_name, t.logo_url AS team_logo,
  t.color1 AS team_color1, t.color2 AS team_color2, gps.position,
  COUNT(DISTINCT gps.game_id) AS gp,
  ROUND(AVG(NULLIF(gps.overall_rating,0)),0)   AS overall_rating,
  ROUND(AVG(NULLIF(gps.defensive_rating,0)),0) AS defensive_rating,
  ROUND(AVG(NULLIF(gps.team_play_rating,0)),0) AS team_play_rating,
  SUM(gps.goals) AS goals, SUM(gps.assists) AS assists,
  SUM(gps.goals + gps.assists) AS points,
  SUM(gps.plus_minus) AS plus_minus,
  SUM(gps.shots) AS shots, SUM(gps.hits) AS hits,
  SUM(gps.pim) AS pim, SUM(gps.pp_goals) AS pp_goals,
  SUM(gps.sh_goals) AS sh_goals, SUM(gps.gwg) AS gwg,
  SUM(gps.toi) AS toi,
  CASE WHEN COUNT(DISTINCT gps.game_id) > 0
    THEN ROUND(CAST(SUM(gps.possession_secs) AS REAL)/COUNT(DISTINCT gps.game_id),0)
    ELSE 0 END AS apt,
  SUM(gps.penalties_drawn) AS penalties_drawn,
  SUM(gps.faceoff_wins) AS faceoff_wins,
  SUM(gps.faceoff_wins + gps.faceoff_losses) AS faceoff_total,
  SUM(gps.blocked_shots) AS blocked_shots,
  CASE WHEN SUM(gps.faceoff_wins + gps.faceoff_losses) > 0
    THEN ROUND(SUM(gps.faceoff_wins)*100.0/SUM(gps.faceoff_wins+gps.faceoff_losses),1)
    ELSE NULL END AS fow_pct,
  CASE WHEN SUM(gps.shots) > 0
    THEN ROUND(SUM(gps.goals)*100.0/SUM(gps.shots),1)
    ELSE NULL END AS shot_pct,
  SUM(gps.deflections) AS deflections,
  SUM(gps.interceptions) AS interceptions,
  SUM(gps.giveaways) AS giveaways,
  SUM(gps.takeaways) AS takeaways,
  SUM(gps.pass_attempts) AS pass_attempts,
  SUM(gps.pass_completions) AS pass_completions,
  CASE WHEN SUM(gps.pass_attempts) > 0
    THEN ROUND(SUM(gps.pass_completions)*100.0/SUM(gps.pass_attempts),1)
    ELSE NULL END AS pass_pct_calc,
  SUM(gps.hat_tricks) AS hat_tricks`;

const GOALIE_SELECT = `
  gps.player_name AS name, t.name AS team_name, t.logo_url AS team_logo,
  t.color1 AS team_color1, t.color2 AS team_color2,
  COUNT(DISTINCT gps.game_id) AS gp,
  SUM(gps.goals) AS goals, SUM(gps.assists) AS assists,
  SUM(gps.shots_against) AS shots_against,
  SUM(gps.goals_against) AS goals_against,
  SUM(gps.saves) AS saves,
  CASE WHEN SUM(gps.shots_against) > 0
    THEN ROUND(CAST(SUM(gps.saves) AS REAL)/SUM(gps.shots_against),3)
    ELSE NULL END AS save_pct,
  CASE WHEN SUM(gps.toi) > 0
    THEN ROUND(SUM(gps.goals_against)*3600.0/SUM(gps.toi),2)
    ELSE NULL END AS gaa,
  SUM(gps.toi) AS toi,
  SUM(gps.shutouts) AS shutouts,
  SUM(gps.penalty_shot_attempts) AS penalty_shot_attempts,
  SUM(gps.penalty_shot_ga) AS penalty_shot_ga,
  SUM(gps.breakaway_shots) AS breakaway_shots,
  SUM(gps.breakaway_saves) AS breakaway_saves,
  SUM(gps.goalie_wins) AS goalie_wins,
  SUM(gps.goalie_losses) AS goalie_losses,
  SUM(gps.goalie_otw) AS goalie_otw,
  SUM(gps.goalie_otl) AS goalie_otl`;

// ── Team season stats ──────────────────────────────────────────────────────

app.get('/api/teams/:id/stats', (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
  const sf = seasonId ? 'AND g.season_id = ?' : '';
  const params = seasonId ? [req.params.id, seasonId] : [req.params.id];
  const rp = seasonId ? [req.params.id, req.params.id, seasonId] : [req.params.id, req.params.id];

  // Fetch rostered players
  const roster = db.prepare(`
    SELECT p.id, p.name, p.position, p.number, p.user_id, u.platform
    FROM players p LEFT JOIN users u ON p.user_id = u.id
    WHERE p.team_id = ? AND p.is_rostered = 1 ORDER BY p.name
  `).all(req.params.id);

  const skaterStats = db.prepare(`
    SELECT ${SKATER_SELECT}
    FROM game_player_stats gps JOIN teams t ON gps.team_id = t.id JOIN games g ON gps.game_id = g.id
    WHERE gps.team_id = ? AND gps.position != 'G' AND g.status = 'complete' ${sf}
    GROUP BY gps.player_name ORDER BY points DESC, goals DESC
  `).all(...params);

  const goalieStats = db.prepare(`
    SELECT ${GOALIE_SELECT}
    FROM game_player_stats gps JOIN teams t ON gps.team_id = t.id JOIN games g ON gps.game_id = g.id
    WHERE gps.team_id = ? AND gps.position = 'G' AND g.status = 'complete' ${sf}
    GROUP BY gps.player_name ORDER BY save_pct DESC
  `).all(...params);

  const recentGames = db.prepare(`
    SELECT g.id, g.date, g.home_score, g.away_score, g.status, g.is_overtime, g.season_id,
      ht.id AS home_team_id, ht.name AS home_team_name, ht.logo_url AS home_logo,
      at.id AS away_team_id, at.name AS away_team_name, at.logo_url AS away_logo
    FROM games g JOIN teams ht ON g.home_team_id = ht.id JOIN teams at ON g.away_team_id = at.id
    WHERE (g.home_team_id = ? OR g.away_team_id = ?) AND g.status = 'complete' ${seasonId ? 'AND g.season_id = ?' : ''}
    ORDER BY g.date DESC LIMIT 10
  `).all(...rp);

  // Staff
  const staff = db.prepare(`
    SELECT ts.role, u.id AS user_id, u.username, u.platform
    FROM team_staff ts JOIN users u ON ts.user_id = u.id
    WHERE ts.team_id = ? ORDER BY ts.role
  `).all(req.params.id);

  res.json({ team, roster, skaterStats, goalieStats, recentGames, staff });
});

// ── Players ────────────────────────────────────────────────────────────────

app.get('/api/players', (_req, res) => {
  const players = db.prepare(`
    SELECT p.*, t.name AS team_name, u.username, u.platform
    FROM players p LEFT JOIN teams t ON p.team_id = t.id LEFT JOIN users u ON p.user_id = u.id
    ORDER BY t.name, p.name
  `).all();
  res.json(players);
});

// List all registered users (for admin to pick an owner / for GMs to sign players)
app.get('/api/users', requireAdmin, (_req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.platform, u.email, u.position, u.created_at,
      p.team_id, t.name AS team_name, p.is_rostered
    FROM users u LEFT JOIN players p ON p.user_id = u.id LEFT JOIN teams t ON p.team_id = t.id
    ORDER BY u.username
  `).all();
  res.json(users);
});

// Players endpoint for GM use (free agents = no current roster)
app.get('/api/users/free-agents', requirePlayer, (_req, res) => {
  const fa = db.prepare(`
    SELECT u.id, u.username, u.platform, u.position
    FROM users u
    LEFT JOIN players p ON p.user_id = u.id AND p.is_rostered = 1
    WHERE p.id IS NULL
    ORDER BY u.username
  `).all();
  res.json(fa);
});

app.post('/api/players', requireAdmin, (req, res) => {
  const { name, team_id, position, number } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const result = db.prepare('INSERT INTO players (name, team_id, position, number, is_rostered) VALUES (?, ?, ?, ?, ?)')
    .run(name, team_id || null, position || null, number || null, team_id ? 1 : 0);
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
  const games = db.prepare(`
    SELECT g.*, ht.name AS home_team_name, ht.logo_url AS home_logo,
      at.name AS away_team_name, at.logo_url AS away_logo
    FROM games g JOIN teams ht ON g.home_team_id = ht.id JOIN teams at ON g.away_team_id = at.id
    ${filter} ORDER BY g.date DESC
  `).all(...(seasonId ? [seasonId] : []));
  res.json(games);
});

app.post('/api/games', requireAdmin, (req, res) => {
  const { home_team_id, away_team_id, home_score, away_score, date, season_id, status, is_overtime } = req.body;
  if (!home_team_id || !away_team_id || !date) return res.status(400).json({ error: 'home_team_id, away_team_id, and date are required' });
  const gameStatus = status === 'complete' ? 'complete' : 'scheduled';
  const ot = is_overtime ? 1 : 0;
  const result = db.prepare(
    'INSERT INTO games (home_team_id, away_team_id, home_score, away_score, date, status, season_id, is_overtime) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(home_team_id, away_team_id, home_score || 0, away_score || 0, date, gameStatus, season_id || null, ot);
  res.status(201).json({ id: result.lastInsertRowid, home_team_id, away_team_id, home_score: home_score || 0, away_score: away_score || 0, date, status: gameStatus, season_id: season_id || null, is_overtime: ot });
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
  let home_score = game.home_score, away_score = game.away_score;
  const ea_match_id = req.body.ea_match_id !== undefined ? req.body.ea_match_id : game.ea_match_id;
  const status = req.body.status !== undefined ? req.body.status : game.status;
  const season_id = req.body.season_id !== undefined ? req.body.season_id : game.season_id;
  const is_overtime = req.body.is_overtime !== undefined ? (req.body.is_overtime ? 1 : 0) : (game.is_overtime || 0);
  if (req.body.home_score !== undefined) {
    home_score = parseInt(req.body.home_score, 10);
    if (isNaN(home_score) || home_score < 0 || home_score > 99) return res.status(400).json({ error: 'home_score must be 0–99' });
  }
  if (req.body.away_score !== undefined) {
    away_score = parseInt(req.body.away_score, 10);
    if (isNaN(away_score) || away_score < 0 || away_score > 99) return res.status(400).json({ error: 'away_score must be 0–99' });
  }
  db.prepare('UPDATE games SET home_score=?, away_score=?, ea_match_id=?, status=?, season_id=?, is_overtime=? WHERE id=?')
    .run(home_score, away_score, ea_match_id, status, season_id, is_overtime, req.params.id);

  if (req.body.player_stats) {
    const { home_players, away_players } = req.body.player_stats;
    db.prepare('DELETE FROM game_player_stats WHERE game_id = ?').run(req.params.id);
    const ins = db.prepare(`INSERT INTO game_player_stats
      (game_id,team_id,player_name,position,
       overall_rating,defensive_rating,team_play_rating,
       goals,assists,shots,hits,plus_minus,pim,blocked_shots,takeaways,giveaways,
       possession_secs,pass_attempts,pass_completions,pass_pct,
       faceoff_wins,faceoff_losses,pp_goals,sh_goals,gwg,penalties_drawn,
       deflections,interceptions,hat_tricks,toi,
       saves,save_pct,goals_against,shots_against,
       goalie_wins,goalie_losses,goalie_otw,goalie_otl,
       shutouts,penalty_shot_attempts,penalty_shot_ga,breakaway_shots,breakaway_saves)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const saveList = (players, teamId) => {
      for (const p of (players || [])) {
        ins.run(
          req.params.id, teamId, p.name, p.position,
          p.overallRating||0, p.defensiveRating||0, p.teamPlayRating||0,
          p.goals||0, p.assists||0, p.shots||0, p.hits||0, p.plusMinus||0, p.pim||0,
          p.blockedShots||0, p.takeaways||0, p.giveaways||0,
          p.possessionSecs||0, p.passAttempts||0, p.passCompletions||0, p.passPct||null,
          p.faceoffWins||0, p.faceoffLosses||0,
          p.ppGoals||0, p.shGoals||0, p.gwg||0, p.penaltiesDrawn||0,
          p.deflections||0, p.interceptions||0, p.hatTricks||0, p.toi||0,
          p.saves||0, p.savesPct||null, p.goalsAgainst||0, p.shotsAgainst||0,
          p.goalieWins||0, p.goalieLosses||0, p.goalieOtw||0, p.goalieOtl||0,
          p.shutouts||0, p.penaltyShotAttempts||0, p.penaltyShotGa||0,
          p.breakawayShots||0, p.breakawaySaves||0
        );
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
    FROM games g JOIN teams ht ON g.home_team_id = ht.id JOIN teams at ON g.away_team_id = at.id
    WHERE g.id = ?
  `).get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const stats = db.prepare('SELECT * FROM game_player_stats WHERE game_id = ? ORDER BY position, goals DESC').all(req.params.id);
  res.json({
    game: {
      id: game.id, date: game.date, status: game.status, season_id: game.season_id, is_overtime: game.is_overtime,
      home_team: { id: game.home_team_id, name: game.home_team_name, logo_url: game.home_logo },
      away_team: { id: game.away_team_id, name: game.away_team_name, logo_url: game.away_logo },
      home_score: game.home_score, away_score: game.away_score, ea_match_id: game.ea_match_id,
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
    SELECT ${SKATER_SELECT}
    FROM game_player_stats gps JOIN teams t ON gps.team_id = t.id JOIN games g ON gps.game_id = g.id
    WHERE gps.position != 'G' AND g.status = 'complete' ${sf}
    GROUP BY gps.player_name, gps.team_id ORDER BY points DESC, goals DESC
  `).all(...p);
  const goalies = db.prepare(`
    SELECT ${GOALIE_SELECT}
    FROM game_player_stats gps JOIN teams t ON gps.team_id = t.id JOIN games g ON gps.game_id = g.id
    WHERE gps.position = 'G' AND g.status = 'complete' ${sf}
    GROUP BY gps.player_name, gps.team_id ORDER BY save_pct DESC
  `).all(...p);
  res.json({ skaters, goalies });
});

// ── Admin: unrostered stats alert ──────────────────────────────────────────

app.get('/api/admin/unrostered-stats', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT gps.player_name, t.name AS team_name, t.id AS team_id,
      COUNT(DISTINCT gps.game_id) AS game_count
    FROM game_player_stats gps
    JOIN teams t ON gps.team_id = t.id
    JOIN games g ON gps.game_id = g.id
    LEFT JOIN players p ON p.name = gps.player_name AND p.team_id = gps.team_id AND p.is_rostered = 1
    WHERE g.status = 'complete' AND p.id IS NULL
    GROUP BY gps.player_name, gps.team_id
    ORDER BY t.name, gps.player_name
  `).all();
  res.json(rows);
});

// ── Standings ──────────────────────────────────────────────────────────────

app.get('/api/standings', (req, res) => {
  const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
  const filter = seasonId
    ? "SELECT * FROM games WHERE status = 'complete' AND season_id = ? ORDER BY date ASC, id ASC"
    : "SELECT * FROM games WHERE status = 'complete' ORDER BY date ASC, id ASC";
  const games = seasonId ? db.prepare(filter).all(seasonId) : db.prepare(filter).all();
  const teamIds = new Set();
  for (const g of games) { teamIds.add(g.home_team_id); teamIds.add(g.away_team_id); }
  const allTeams = db.prepare('SELECT * FROM teams').all();
  const teams = seasonId ? allTeams.filter(t => teamIds.has(t.id)) : allTeams;
  const stats = {};
  for (const t of teams) {
    stats[t.id] = {
      id: t.id, name: t.name, logo_url: t.logo_url || null,
      conference: t.conference, division: t.division,
      color1: t.color1 || null, color2: t.color2 || null,
      gp: 0, w: 0, otw: 0, l: 0, otl: 0, pts: 0, gf: 0, ga: 0,
      home_w: 0, home_l: 0, home_otl: 0,
      away_w: 0, away_l: 0, away_otl: 0,
      _results: [],
    };
  }
  for (const g of games) {
    const home = stats[g.home_team_id], away = stats[g.away_team_id];
    if (!home || !away) continue;
    home.gp++; away.gp++;
    home.gf += g.home_score; home.ga += g.away_score;
    away.gf += g.away_score; away.ga += g.home_score;
    const ot = !!g.is_overtime;
    if (g.home_score > g.away_score) {
      if (ot) { home.w++; home.otw++; home.pts += 2; home.home_w++; away.otl++; away.pts++; away.away_otl++; home._results.push('W'); away._results.push('OTL'); }
      else    { home.w++; home.pts += 2; home.home_w++; away.l++; away.away_l++; home._results.push('W'); away._results.push('L'); }
    } else if (g.away_score > g.home_score) {
      if (ot) { away.w++; away.otw++; away.pts += 2; away.away_w++; home.otl++; home.pts++; home.home_otl++; away._results.push('W'); home._results.push('OTL'); }
      else    { away.w++; away.pts += 2; away.away_w++; home.l++; home.home_l++; away._results.push('W'); home._results.push('L'); }
    } else { home.pts++; away.pts++; home._results.push('T'); away._results.push('T'); }
  }
  for (const t of Object.values(stats)) {
    if (t._results.length === 0) { t.streak = '—'; }
    else {
      const last = t._results[t._results.length - 1];
      const isWin = last === 'W';
      let count = 0;
      for (let i = t._results.length - 1; i >= 0; i--) {
        const r = t._results[i];
        if (isWin ? r === 'W' : (r === 'L' || r === 'OTL')) count++;
        else break;
      }
      t.streak = isWin ? `W${count}` : `L${count}`;
    }
    t.home_record = `${t.home_w}-${t.home_l}-${t.home_otl}`;
    t.away_record = `${t.away_w}-${t.away_l}-${t.away_otl}`;
    delete t._results;
  }
  res.json(Object.values(stats).sort((a, b) => b.pts - a.pts || b.w - a.w));
});

// ── EA Matches ─────────────────────────────────────────────────────────────

app.get('/api/games/:id/ea-matches', async (req, res) => {
  const game = db.prepare(`
    SELECT g.*, ht.name AS home_team_name, ht.ea_club_id AS home_ea_club_id,
      at.name AS away_team_name, at.ea_club_id AS away_ea_club_id
    FROM games g JOIN teams ht ON g.home_team_id = ht.id JOIN teams at ON g.away_team_id = at.id
    WHERE g.id = ?
  `).get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (!game.home_ea_club_id) return res.status(400).json({ error: 'Home team has no EA club ID configured' });
  try {
    const raw = await fetchEA(`https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=common-gen5&clubIds=${game.home_ea_club_id}`);
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
        matchId: m.matchId, timestamp: m.timestamp || 0,
        date: m.timestamp ? new Date(m.timestamp * 1000).toISOString().split('T')[0] : null,
        result: mapResult(myClub.result), homeScore: Number(myClub.score) || 0, awayScore: Number(myClub.opponentScore) || 0,
        opponentClubId: oppId, opponentClubName: oppName, isScheduledOpponent, players, awayPlayers,
      };
    }).filter(Boolean);
    res.json({
      game: { id: game.id, date: game.date, status: game.status, is_overtime: game.is_overtime,
        home_team: { id: game.home_team_id, name: game.home_team_name, ea_club_id: game.home_ea_club_id },
        away_team: { id: game.away_team_id, name: game.away_team_name, ea_club_id: game.away_ea_club_id },
        home_score: game.home_score, away_score: game.away_score, ea_match_id: game.ea_match_id || null,
      },
      matches,
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch EA data', details: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`EHL server running at http://localhost:${PORT}`);
  console.log(`Admin password: ${ADMIN_PASSWORD}`);
});
