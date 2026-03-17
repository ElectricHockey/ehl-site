const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const multer = require('multer');
const { promisify } = require('util');
const db = require('./db');
const EA_STATS_MAP = require('./ea-stats-map');

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
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  },
});

// ── Rate limiting ──────────────────────────────────────────────────────────

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });

app.set('trust proxy', 1); // trust first proxy so req.ip reflects real client IP
app.use(cors());
app.use(express.json());
app.use('/api', apiLimiter);
app.use(express.static(path.join(__dirname, 'public')));

// ── IP helpers ─────────────────────────────────────────────────────────────

// Hash the IP with a fixed HMAC secret so the raw address is never stored.
// The secret is derived from ADMIN_PASSWORD at startup (set below), so we
// define the helper after the constant is declared.
function hashIp(ip) {
  const secret = process.env.IP_HMAC_SECRET || 'ehl-ip-secret';
  return crypto.createHmac('sha256', secret).update(ip || '').digest('hex');
}

// ── Admin Auth ─────────────────────────────────────────────────────────────

// The league owner is identified by their Discord user ID.
// This can be overridden with the OWNER_DISCORD_ID environment variable.
const OWNER_DISCORD_ID = process.env.OWNER_DISCORD_ID || '363915181765427200';
const adminSessions = new Map(); // token → { userId, username, role }
const playerSessions = new Map(); // token -> userId

/** Returns true if the given user record is the league owner. */
function isOwnerUser(user) {
  return user && user.discord_id === OWNER_DISCORD_ID;
}

// ── Discord OAuth2 ─────────────────────────────────────────────────────────
const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID     || '1379545091927965767';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'hP2korc5GbEuCkbLPEfxyWLxNk8ql-Y6';
const DISCORD_REDIRECT_URI  = process.env.DISCORD_REDIRECT_URI  || 'http://localhost:3000/api/discord/callback';

// Short-lived in-memory state stores (cleaned on use / TTL)
const discordOAuthStates   = new Map(); // state  → { mode, userId, expires }
const pendingDiscordLinks  = new Map(); // token  → { discord_id, discord, expires }

// Periodically evict expired Discord OAuth state / pending-link entries
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of discordOAuthStates)  if (now > v.expires) discordOAuthStates.delete(k);
  for (const [k, v] of pendingDiscordLinks) if (now > v.expires) pendingDiscordLinks.delete(k);
}, 5 * 60 * 1000);

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  const session = token && adminSessions.get(token);
  if (!session) return res.status(401).json({ error: 'Admin access required' });
  req.adminSession = session;
  next();
}

function requireOwner(req, res, next) {
  const token = req.headers['x-admin-token'];
  const session = token && adminSessions.get(token);
  if (!session || session.role !== 'owner')
    return res.status(403).json({ error: 'Owner access required' });
  req.adminSession = session;
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

// Admin access is derived from the player's existing session.
// The player must be logged in (X-Player-Token header) and either:
//   • have Discord ID matching OWNER_DISCORD_ID  → role 'owner'
//   • have role = 'game_admin' in the users table → role 'game_admin'
// No separate admin password is required.
app.post('/api/auth/login', (req, res) => {
  const playerToken = req.headers['x-player-token'];
  const userId = playerToken && playerSessions.get(playerToken);
  if (!userId) return res.status(401).json({ error: 'Player login required' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const isOwner = isOwnerUser(user);
  const role = isOwner ? 'owner' : (user.role === 'game_admin' ? 'game_admin' : null);
  if (!role) return res.status(403).json({ error: 'Access denied' });
  const token = crypto.randomBytes(24).toString('hex');
  adminSessions.set(token, { userId: user.id, username: user.username, role });
  res.json({ token, role, username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) adminSessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/auth/status', (req, res) => {
  const token = req.headers['x-admin-token'];
  const session = token && adminSessions.get(token);
  if (!session) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, role: session.role, username: session.username });
});

// ── Player registration & login ────────────────────────────────────────────

app.post('/api/players/register', async (req, res) => {
  const { username, platform, password, email, position, discord, discord_id } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: 'Username (gamertag) is required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!discord || !discord.trim()) return res.status(400).json({ error: 'Discord account is required. Please connect with Discord.' });
  const plat = (platform === 'psn' ? 'psn' : 'xbox');
  const pos = position ? position.trim() : null;
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) return res.status(409).json({ error: 'That gamertag is already registered' });
  const hash = await hashPassword(password);
  const r = db.prepare('INSERT INTO users (username, platform, password_hash, email, position, discord, discord_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(username.trim(), plat, hash, email ? email.trim() : null, pos, discord.trim(), discord_id || null);

  // Try to merge with an existing custom-added player whose discord_id matches.
  // This links their user account to the existing roster spot instead of creating a fresh record.
  let playerId;
  let merged = false;
  if (discord_id) {
    const candidate = db.prepare(
      'SELECT id FROM players WHERE discord_id = ? AND user_id IS NULL LIMIT 1'
    ).get(discord_id);
    if (candidate) {
      db.prepare('UPDATE players SET user_id=?, name=?, position=COALESCE(?,position), discord=COALESCE(?,discord) WHERE id=?')
        .run(r.lastInsertRowid, username.trim(), pos || null, (discord && discord.trim()) ? discord.trim() : null, candidate.id);
      playerId = candidate.id;
      merged = true;
    }
  }
  if (!merged) {
    const pr = db.prepare('INSERT INTO players (name, user_id, is_rostered, position) VALUES (?, ?, 0, ?)')
      .run(username.trim(), r.lastInsertRowid, pos);
    playerId = pr.lastInsertRowid;
  }

  const token = crypto.randomBytes(24).toString('hex');
  playerSessions.set(token, r.lastInsertRowid);
  res.status(201).json({ token, id: r.lastInsertRowid, username: username.trim(), platform: plat, position: pos, player_id: playerId, merged });
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
  const user = db.prepare('SELECT id, username, platform, email, position, discord, discord_id, created_at FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.userId);
  const staff = db.prepare(`
    SELECT ts.role, t.id AS team_id, t.name AS team_name, t.logo_url, t.color1, t.color2
    FROM team_staff ts JOIN teams t ON ts.team_id = t.id WHERE ts.user_id = ?
  `).all(req.userId);
  res.json({ user, player, staff });
});

// Admin edits a registered user's profile
app.patch('/api/users/:id', requireOwner, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const username = req.body.username !== undefined ? req.body.username.trim() : user.username;
  const platform = req.body.platform !== undefined ? (req.body.platform === 'psn' ? 'psn' : 'xbox') : user.platform;
  const email    = req.body.email    !== undefined ? (req.body.email ? req.body.email.trim() : null) : user.email;
  const position = req.body.position !== undefined ? (req.body.position ? req.body.position.trim() : null) : user.position;
  const discord  = req.body.discord  !== undefined ? (req.body.discord ? req.body.discord.trim() : null) : user.discord;
  if (username !== user.username) {
    const clash = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, user.id);
    if (clash) return res.status(409).json({ error: 'That gamertag is already taken' });
  }
  db.prepare('UPDATE users SET username = ?, platform = ?, email = ?, position = ?, discord = ? WHERE id = ?')
    .run(username, platform, email, position, discord, user.id);
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

app.post('/api/seasons', requireOwner, (req, res) => {
  const { name, make_active, league_type } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Season name is required' });
  if (make_active) db.prepare('UPDATE seasons SET is_active = 0').run();
  const lt = league_type || '';
  const result = db.prepare('INSERT INTO seasons (name, is_active, league_type) VALUES (?, ?, ?)').run(name.trim(), make_active ? 1 : 0, lt);
  res.status(201).json({ id: result.lastInsertRowid, name: name.trim(), is_active: make_active ? 1 : 0, league_type: lt });
});

app.patch('/api/seasons/:id', requireOwner, (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const name = req.body.name !== undefined ? req.body.name.trim() : season.name;
  const league_type = req.body.league_type !== undefined ? req.body.league_type : (season.league_type || '');
  if (req.body.is_active) db.prepare('UPDATE seasons SET is_active = 0').run();
  const is_active = req.body.is_active ? 1 : (req.body.is_active === false ? 0 : season.is_active);
  db.prepare('UPDATE seasons SET name = ?, is_active = ?, league_type = ? WHERE id = ?').run(name, is_active, league_type, req.params.id);
  res.json({ updated: true });
});

app.delete('/api/seasons/:id', requireOwner, (req, res) => {
  db.prepare('UPDATE games SET season_id = NULL WHERE season_id = ?').run(req.params.id);
  const result = db.prepare('DELETE FROM seasons WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Season not found' });
  res.json({ deleted: true });
});

// ── Site Logo ──────────────────────────────────────────────────────────────

// GET /api/site-logo  – redirect to the current site logo file
app.get('/api/site-logo', (_req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'site_logo_url'").get();
  const url = (row && row.value) ? row.value : '/logo.svg';
  res.redirect(302, url);
});

// POST /api/admin/site-logo  – upload a new site logo (owner only)
app.post('/api/admin/site-logo', requireOwner, logoUpload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });
  const newUrl = `/uploads/${req.file.filename}`;
  // Delete old custom logo synchronously before updating DB, so we don't
  // leave orphaned files if the DB write fails (and vice-versa).
  const row = db.prepare("SELECT value FROM settings WHERE key = 'site_logo_url'").get();
  if (row && row.value && row.value.startsWith('/uploads/')) {
    const old = path.join(__dirname, 'public', row.value);
    try { fs.unlinkSync(old); } catch (err) { if (err.code !== 'ENOENT') console.warn('site-logo unlink:', err.message); }
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('site_logo_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(newUrl);
  res.json({ url: newUrl });
});

// ── Teams ──────────────────────────────────────────────────────────────────

app.get('/api/teams', (_req, res) => {
  res.json(db.prepare('SELECT * FROM teams ORDER BY name').all());
});

app.post('/api/teams', requireOwner, logoUpload.single('logo'), (req, res) => {
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

app.patch('/api/teams/:id', requireOwner, logoUpload.single('logo'), (req, res) => {
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

app.delete('/api/teams/:id', requireOwner, (req, res) => {
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
app.post('/api/teams/:id/owner', requireOwner, (req, res) => {
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
app.delete('/api/teams/:id/owner', requireOwner, (req, res) => {
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

// Maps EA string position names + numeric codes to EHL abbreviations.
// For "defenseMen", posSorted "1" = RD and "2" = LD.
const EA_POSITIONS = {
  // Numeric codes (legacy / fallback)
  '0': 'G', '1': 'C', '2': 'LW', '3': 'RW', '4': 'LD', '5': 'RD',
  // String names sent by current EA API
  'goalie':     'G',
  'center':     'C',
  'leftWing':   'LW',
  'rightWing':  'RW',
  // defenseMen is resolved using posSorted below — no entry here
};

function mapResult(r) {
  if (r === '1' || r === 1) return 'W';
  if (r === '2' || r === 2) return 'L';
  return '?';
}

// Build reverse lookup: ehlColumn → [eaField1, eaField2, ...] (priority = insertion order)
// This lets mapEAPlayer look up by EHL column name while ea-stats-map.js stays keyed by EA field name.
const EA_REVERSE_MAP = {};
for (const [eaKey, ehlCol] of Object.entries(EA_STATS_MAP)) {
  if (!EA_REVERSE_MAP[ehlCol]) EA_REVERSE_MAP[ehlCol] = [];
  EA_REVERSE_MAP[ehlCol].push(eaKey);
}

// Returns the value of the first EA field that is present on the player object
// for the given EHL column name. Returns undefined if none found.
function eaField(p, ehlCol) {
  const candidates = EA_REVERSE_MAP[ehlCol];
  if (!candidates) return undefined;
  for (const k of candidates) {
    if (p[k] !== undefined) return p[k];
  }
  return undefined;
}

function mapEAPlayer(p) {
  const nameRaw   = eaField(p, 'playerName');
  const goals     = Number(eaField(p, 'goals'))        || 0;
  const assists   = Number(eaField(p, 'assists'))       || 0;
  const shots     = Number(eaField(p, 'shots'))         || 0;
  const passAtt   = Number(eaField(p, 'passAttempts'))  || 0;
  const passPctRaw = eaField(p, 'passPct');
  const passPct   = passPctRaw != null ? parseFloat(passPctRaw) : null;
  const passComp  = passPct !== null ? Math.round(passAtt * passPct / 100) : 0;

  // Resolve position: defenseMen needs posSorted to distinguish LD (2) from RD (1)
  const posRaw    = eaField(p, 'position');
  const posSorted = p.posSorted !== undefined ? String(p.posSorted) : null;
  let position;
  if (String(posRaw) === 'defenseMen') {
    if (posSorted === '2')      position = 'LD';
    else if (posSorted === '1') position = 'RD';
    else                        position = 'D';   // posSorted absent — generic defenseman
  } else {
    position = EA_POSITIONS[String(posRaw)] || String(posRaw || '');
  }

  return {
    name:             typeof nameRaw === 'string' ? nameRaw : (nameRaw ?? 'Unknown'),
    position,
    overallRating:    Number(eaField(p, 'overallRating'))    || 0,
    offensiveRating:  Number(eaField(p, 'offensiveRating'))  || 0,
    defensiveRating:  Number(eaField(p, 'defensiveRating'))  || 0,
    teamPlayRating:   Number(eaField(p, 'teamPlayRating'))   || 0,
    goals, assists,   points: goals + assists,
    shots,
    shotAttempts:     Number(eaField(p, 'shotAttempts'))     || 0,
    hits:             Number(eaField(p, 'hits'))           || 0,
    plusMinus:        Number(eaField(p, 'plusMinus'))      || 0,
    pim:              Number(eaField(p, 'pim'))            || 0,
    blockedShots:     Number(eaField(p, 'blockedShots'))   || 0,
    takeaways:        Number(eaField(p, 'takeaways'))      || 0,
    giveaways:        Number(eaField(p, 'giveaways'))      || 0,
    possessionSecs:   Number(eaField(p, 'possessionSecs')) || 0,
    passAttempts:     passAtt,
    passCompletions:  passComp,
    passPct,
    faceoffWins:      Number(eaField(p, 'faceoffWins'))    || 0,
    faceoffLosses:    Number(eaField(p, 'faceoffLosses'))  || 0,
    ppGoals:          Number(eaField(p, 'ppGoals'))        || 0,
    shGoals:          Number(eaField(p, 'shGoals'))        || 0,
    gwg:              Number(eaField(p, 'gwg'))            || 0,
    penaltiesDrawn:   Number(eaField(p, 'penaltiesDrawn')) || 0,
    deflections:      Number(eaField(p, 'deflections'))    || 0,
    interceptions:    Number(eaField(p, 'interceptions'))  || 0,
    hatTricks:        Number(eaField(p, 'hatTricks'))      || 0,
    toi:              Number(eaField(p, 'toi'))            || 0,
    // Goalie — W/L/OTW/OTL/SO are calculated from game outcome in saveList, not from EA
    saves:               Number(eaField(p, 'saves'))               || 0,
    savesPct:            eaField(p, 'savesPct') != null ? parseFloat(eaField(p, 'savesPct')) : null,
    goalsAgainst:        Number(eaField(p, 'goalsAgainst'))        || 0,
    shotsAgainst:        Number(eaField(p, 'shotsAgainst'))        || 0,
    penaltyShotAttempts: Number(eaField(p, 'penaltyShotAttempts')) || 0,
    penaltyShotGa:       Number(eaField(p, 'penaltyShotGa'))       || 0,
    breakawayShots:      Number(eaField(p, 'breakawayShots'))      || 0,
    breakawaySaves:      Number(eaField(p, 'breakawaySaves'))      || 0,
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
  ROUND(AVG(NULLIF(gps.overall_rating,0)),0)    AS overall_rating,
  ROUND(AVG(NULLIF(gps.offensive_rating,0)),0)  AS offensive_rating,
  ROUND(AVG(NULLIF(gps.defensive_rating,0)),0)  AS defensive_rating,
  ROUND(AVG(NULLIF(gps.team_play_rating,0)),0)  AS team_play_rating,
  SUM(gps.goals) AS goals, SUM(gps.assists) AS assists,
  SUM(gps.goals + gps.assists) AS points,
  SUM(gps.plus_minus) AS plus_minus,
  SUM(gps.shots) AS shots, SUM(gps.shot_attempts) AS shot_attempts, SUM(gps.hits) AS hits,
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
  SUM(gps.goalie_otl) AS goalie_otl,
  ROUND(AVG(NULLIF(gps.overall_rating,0)),0)    AS overall_rating,
  ROUND(AVG(NULLIF(gps.offensive_rating,0)),0)  AS offensive_rating,
  ROUND(AVG(NULLIF(gps.defensive_rating,0)),0)  AS defensive_rating,
  ROUND(AVG(NULLIF(gps.team_play_rating,0)),0)  AS team_play_rating`;

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

// ── Player public profile (career stats by name) ───────────────────────────

app.get('/api/players/profile/:name', (req, res) => {
  const name = req.params.name;

  // Current roster info + user account if linked
  const player = db.prepare(`
    SELECT p.id, p.name, p.position AS player_position, p.is_rostered, p.number,
      t.id AS team_id, t.name AS team_name, t.logo_url AS team_logo, t.color1, t.color2,
      u.platform, u.position AS user_position, u.discord
    FROM players p
    LEFT JOIN teams t ON p.team_id = t.id
    LEFT JOIN users u ON p.user_id = u.id
    WHERE p.name = ? ORDER BY p.is_rostered DESC LIMIT 1
  `).get(name);

  // Detect position from stats (majority position recorded in game logs)
  const posRow = db.prepare(`
    SELECT position, COUNT(*) AS cnt
    FROM game_player_stats WHERE player_name = ?
    GROUP BY position ORDER BY cnt DESC LIMIT 1
  `).get(name);
  const isGoalie = posRow && posRow.position === 'G';

  // Per-season per-team splits
  const seasonTeamStats = isGoalie
    ? db.prepare(`
        SELECT g.season_id, COALESCE(s.name,'No Season') AS season_name,
          COALESCE(s.league_type,'') AS league_type,
          CASE WHEN g.playoff_series_id IS NOT NULL THEN 1 ELSE 0 END AS is_playoff,
          ${GOALIE_SELECT}
        FROM game_player_stats gps
        JOIN teams t ON gps.team_id = t.id
        JOIN games g ON gps.game_id = g.id
        LEFT JOIN seasons s ON g.season_id = s.id
        WHERE gps.player_name = ? AND gps.position = 'G' AND g.status = 'complete'
        GROUP BY g.season_id, gps.team_id, CASE WHEN g.playoff_series_id IS NOT NULL THEN 1 ELSE 0 END
        ORDER BY g.season_id DESC, is_playoff
      `).all(name)
    : db.prepare(`
        SELECT g.season_id, COALESCE(s.name,'No Season') AS season_name,
          COALESCE(s.league_type,'') AS league_type,
          CASE WHEN g.playoff_series_id IS NOT NULL THEN 1 ELSE 0 END AS is_playoff,
          ${SKATER_SELECT}
        FROM game_player_stats gps
        JOIN teams t ON gps.team_id = t.id
        JOIN games g ON gps.game_id = g.id
        LEFT JOIN seasons s ON g.season_id = s.id
        WHERE gps.player_name = ? AND gps.position != 'G' AND g.status = 'complete'
        GROUP BY g.season_id, gps.team_id, CASE WHEN g.playoff_series_id IS NOT NULL THEN 1 ELSE 0 END
        ORDER BY g.season_id DESC, is_playoff
      `).all(name);

  // Last 5 games
  const lastGames = db.prepare(`
    SELECT g.id AS game_id, g.date, g.home_score, g.away_score, g.is_overtime,
      ht.id AS home_team_id, ht.name AS home_team_name, ht.logo_url AS home_logo,
      at.id AS away_team_id, at.name AS away_team_name, at.logo_url AS away_logo,
      gps.team_id AS player_team_id, gps.position,
      gps.offensive_rating, gps.defensive_rating, gps.team_play_rating,
      gps.goals, gps.assists, gps.shots, gps.shot_attempts, gps.hits, gps.plus_minus,
      gps.pim, gps.blocked_shots, gps.takeaways, gps.giveaways,
      gps.pp_goals, gps.sh_goals, gps.gwg, gps.penalties_drawn,
      gps.faceoff_wins, gps.faceoff_losses,
      gps.deflections, gps.interceptions, gps.pass_attempts, gps.pass_completions,
      gps.hat_tricks, gps.possession_secs, gps.toi,
      gps.saves, gps.goals_against, gps.shots_against,
      gps.goalie_wins, gps.goalie_losses, gps.goalie_otw, gps.goalie_otl,
      gps.shutouts, gps.penalty_shot_attempts, gps.penalty_shot_ga,
      gps.breakaway_shots, gps.breakaway_saves,
      COALESCE(s.league_type,'') AS league_type,
      CASE WHEN g.playoff_series_id IS NOT NULL THEN 1 ELSE 0 END AS is_playoff
    FROM game_player_stats gps
    JOIN games g ON gps.game_id = g.id
    JOIN teams ht ON g.home_team_id = ht.id
    JOIN teams at ON g.away_team_id = at.id
    LEFT JOIN seasons s ON g.season_id = s.id
    WHERE gps.player_name = ? AND g.status = 'complete'
    ORDER BY g.date DESC, g.id DESC LIMIT 5
  `).all(name);

  if (!player && seasonTeamStats.length === 0) {
    return res.status(404).json({ error: 'Player not found' });
  }

  res.json({ player: player || null, isGoalie, seasonTeamStats, lastGames });
});

// List all registered users (for admin to pick an owner / for GMs to sign players)
app.get('/api/users', requireOwner, (_req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.platform, u.email, u.position, u.discord, u.created_at,
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

app.post('/api/players', requireOwner, (req, res) => {
  const { name, team_id, position, number, discord, discord_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const result = db.prepare('INSERT INTO players (name, team_id, position, number, is_rostered, discord, discord_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, team_id || null, position || null, number || null, team_id ? 1 : 0, discord || null, discord_id || null);
  res.status(201).json({ id: result.lastInsertRowid, name, team_id, position, number, discord, discord_id });
});

app.delete('/api/players/:id', requireOwner, (req, res) => {
  const result = db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Player not found' });
  res.json({ deleted: true });
});

app.patch('/api/players/:id', requireOwner, (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  const name       = req.body.name       !== undefined ? (req.body.name || player.name)        : player.name;
  const team_id    = req.body.team_id    !== undefined ? (req.body.team_id || null)             : player.team_id;
  const is_rostered = req.body.is_rostered !== undefined ? Number(req.body.is_rostered)         : player.is_rostered;
  const position   = req.body.position   !== undefined ? (req.body.position || null)            : player.position;
  const number     = req.body.number     !== undefined ? (req.body.number || null)              : player.number;
  const discord    = req.body.discord    !== undefined ? (req.body.discord || null)             : player.discord;
  const discord_id = req.body.discord_id !== undefined ? (req.body.discord_id || null)          : player.discord_id;
  db.prepare('UPDATE players SET name=?, team_id=?, is_rostered=?, position=?, number=?, discord=?, discord_id=? WHERE id=?')
    .run(name, team_id, is_rostered, position, number, discord, discord_id, req.params.id);
  res.json({ ok: true });
});

// ── Games ──────────────────────────────────────────────────────────────────

app.get('/api/games', (req, res) => {
  const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
  const status   = req.query.status   || null;
  const limit    = req.query.limit    ? Math.min(Number(req.query.limit), 100) : null;
  const conditions = [];
  const params = [];
  if (seasonId) { conditions.push('g.season_id = ?'); params.push(seasonId); }
  if (status)   { conditions.push('g.status = ?');    params.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = limit ? `LIMIT ${limit}` : '';
  const games = db.prepare(`
    SELECT g.*, ht.name AS home_team_name, ht.logo_url AS home_logo,
      at.name AS away_team_name, at.logo_url AS away_logo
    FROM games g JOIN teams ht ON g.home_team_id = ht.id JOIN teams at ON g.away_team_id = at.id
    ${where} ORDER BY g.date DESC ${limitClause}
  `).all(...params);
  res.json(games);
});

app.post('/api/games', requireAdmin, (req, res) => {
  const { home_team_id, away_team_id, home_score, away_score, date, season_id, status, is_overtime, playoff_series_id } = req.body;
  if (!home_team_id || !away_team_id || !date) return res.status(400).json({ error: 'home_team_id, away_team_id, and date are required' });
  const gameStatus = status === 'complete' ? 'complete' : 'scheduled';
  const ot = is_overtime ? 1 : 0;
  const psi = playoff_series_id ? Number(playoff_series_id) : null;
  const result = db.prepare(
    'INSERT INTO games (home_team_id, away_team_id, home_score, away_score, date, status, season_id, is_overtime, playoff_series_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(home_team_id, away_team_id, home_score || 0, away_score || 0, date, gameStatus, season_id || null, ot, psi);
  res.status(201).json({ id: result.lastInsertRowid, home_team_id, away_team_id, home_score: home_score || 0, away_score: away_score || 0, date, status: gameStatus, season_id: season_id || null, is_overtime: ot, playoff_series_id: psi });
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
  const date = req.body.date !== undefined ? req.body.date : game.date;
  if (req.body.home_score !== undefined) {
    home_score = parseInt(req.body.home_score, 10);
    if (isNaN(home_score) || home_score < 0 || home_score > 99) return res.status(400).json({ error: 'home_score must be 0–99' });
  }
  if (req.body.away_score !== undefined) {
    away_score = parseInt(req.body.away_score, 10);
    if (isNaN(away_score) || away_score < 0 || away_score > 99) return res.status(400).json({ error: 'away_score must be 0–99' });
  }
  db.prepare('UPDATE games SET home_score=?, away_score=?, ea_match_id=?, status=?, season_id=?, is_overtime=?, date=? WHERE id=?')
    .run(home_score, away_score, ea_match_id, status, season_id, is_overtime, date, req.params.id);

  // Auto-update the playoff series bracket whenever a playoff game is completed or updated
  const effectiveSeries = req.body.playoff_series_id !== undefined
    ? (req.body.playoff_series_id ? Number(req.body.playoff_series_id) : null)
    : game.playoff_series_id;
  if (effectiveSeries && status === 'complete') {
    recomputeSeriesWins(effectiveSeries);
  }

  if (req.body.player_stats) {
    const { home_players, away_players } = req.body.player_stats;
    db.prepare('DELETE FROM game_player_stats WHERE game_id = ?').run(req.params.id);
    const ins = db.prepare(`INSERT INTO game_player_stats
      (game_id,team_id,player_name,position,
       overall_rating,offensive_rating,defensive_rating,team_play_rating,
       goals,assists,shots,shot_attempts,hits,plus_minus,pim,blocked_shots,takeaways,giveaways,
       possession_secs,pass_attempts,pass_completions,pass_pct,
       faceoff_wins,faceoff_losses,pp_goals,sh_goals,gwg,penalties_drawn,
       deflections,interceptions,hat_tricks,toi,
       saves,save_pct,goals_against,shots_against,
       goalie_wins,goalie_losses,goalie_otw,goalie_otl,
       shutouts,penalty_shot_attempts,penalty_shot_ga,breakaway_shots,breakaway_saves)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    // Goalie W/L/OTW/OTL/SO are derived from the game outcome, not the EA API
    const homeWon = home_score > away_score;
    const awayWon = away_score > home_score;
    const saveList = (players, teamId, teamWon) => {
      for (const p of (players || [])) {
        const isGoalie = (p.position || '').toUpperCase() === 'G';
        let goalieWins = 0, goalieLosses = 0, goalieOtw = 0, goalieOtl = 0, shutouts = 0;
        if (isGoalie) {
          shutouts = (p.goalsAgainst || 0) === 0 ? 1 : 0;
          if (teamWon) {
            if (is_overtime) { goalieOtw = 1; } else { goalieWins = 1; }
          } else {
            if (is_overtime) { goalieOtl = 1; } else { goalieLosses = 1; }
          }
        }
        ins.run(
          req.params.id, teamId, p.name, p.position,
          p.overallRating||0, p.offensiveRating||0, p.defensiveRating||0, p.teamPlayRating||0,
          p.goals||0, p.assists||0, p.shots||0, p.shotAttempts||0, p.hits||0, p.plusMinus||0, p.pim||0,
          p.blockedShots||0, p.takeaways||0, p.giveaways||0,
          p.possessionSecs||0, p.passAttempts||0, p.passCompletions||0, p.passPct||null,
          p.faceoffWins||0, p.faceoffLosses||0,
          p.ppGoals||0, p.shGoals||0, p.gwg||0, p.penaltiesDrawn||0,
          p.deflections||0, p.interceptions||0, p.hatTricks||0, p.toi||0,
          p.saves||0, p.savesPct||null, p.goalsAgainst||0, p.shotsAgainst||0,
          goalieWins, goalieLosses, goalieOtw, goalieOtl,
          shutouts, p.penaltyShotAttempts||0, p.penaltyShotGa||0,
          p.breakawayShots||0, p.breakawaySaves||0
        );
      }
    };
    saveList(home_players, game.home_team_id, homeWon);
    saveList(away_players, game.away_team_id, awayWon);
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

  // Current-team subquery: pick the rostered player record per name (prefer user-linked row, then highest id)
  const rosterSub = `(
    SELECT name, team_id FROM players
    WHERE is_rostered = 1 AND id = (
      SELECT id FROM players p2
      WHERE p2.name = players.name AND p2.is_rostered = 1
      ORDER BY (p2.user_id IS NOT NULL) DESC, p2.id DESC
      LIMIT 1
    )
    GROUP BY name
  ) rp`;

  const skaters = db.prepare(`
    SELECT
      gps.player_name AS name,
      COALESCE(t.name, 'FA') AS team_name,
      t.logo_url AS team_logo,
      t.color1 AS team_color1,
      t.color2 AS team_color2,
      COALESCE(u.position, MAX(gps.position)) AS position,
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
      SUM(gps.hat_tricks) AS hat_tricks
    FROM game_player_stats gps
    JOIN games g ON gps.game_id = g.id
    LEFT JOIN ${rosterSub} ON rp.name = gps.player_name
    LEFT JOIN teams t ON t.id = rp.team_id
    LEFT JOIN users u ON u.username = gps.player_name
    WHERE gps.position != 'G' AND g.status = 'complete' ${sf}
    GROUP BY gps.player_name ORDER BY points DESC, goals DESC
  `).all(...p);

  const goalies = db.prepare(`
    SELECT
      gps.player_name AS name,
      COALESCE(t.name, 'FA') AS team_name,
      t.logo_url AS team_logo,
      t.color1 AS team_color1,
      t.color2 AS team_color2,
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
      SUM(gps.goalie_otl) AS goalie_otl,
      ROUND(AVG(NULLIF(gps.overall_rating,0)),0)    AS overall_rating,
      ROUND(AVG(NULLIF(gps.offensive_rating,0)),0)  AS offensive_rating,
      ROUND(AVG(NULLIF(gps.defensive_rating,0)),0)  AS defensive_rating,
      ROUND(AVG(NULLIF(gps.team_play_rating,0)),0)  AS team_play_rating
    FROM game_player_stats gps
    JOIN games g ON gps.game_id = g.id
    LEFT JOIN ${rosterSub} ON rp.name = gps.player_name
    LEFT JOIN teams t ON t.id = rp.team_id
    WHERE gps.position = 'G' AND g.status = 'complete' ${sf}
    GROUP BY gps.player_name ORDER BY save_pct DESC
  `).all(...p);

  res.json({ skaters, goalies });
});

// ── Admin: unrostered stats alert ──────────────────────────────────────────

app.get('/api/admin/unrostered-stats', requireOwner, (req, res) => {
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

// ── Standings helper ───────────────────────────────────────────────────────

function calcStandings(seasonId) {
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
  return Object.values(stats).sort((a, b) => b.pts - a.pts || b.w - a.w);
}

// ── Standings ──────────────────────────────────────────────────────────────

app.get('/api/standings', (req, res) => {
  const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
  res.json(calcStandings(seasonId));
});

// ── Transactions (recent accepted signings) ──────────────────────────────

app.get('/api/transactions', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const rows = db.prepare(`
    SELECT so.id, so.status, so.created_at,
           u.username  AS player_name,
           t.id        AS team_id,
           t.name      AS team_name,
           t.logo_url  AS team_logo
      FROM signing_offers so
      JOIN users u ON so.user_id = u.id
      JOIN teams t ON so.team_id = t.id
     WHERE so.status = 'accepted'
     ORDER BY so.created_at DESC
     LIMIT ?
  `).all(limit);
  res.json(rows);
});

// ── Playoffs ────────────────────────────────────────────────────────────────

function getPlayoffBracket(playoffId) {
  const playoff = db.prepare('SELECT * FROM playoffs WHERE id = ?').get(playoffId);
  if (!playoff) return null;
  const teams = db.prepare(`
    SELECT pt.seed, t.id AS team_id, t.name, t.logo_url, t.color1, t.color2
    FROM playoff_teams pt JOIN teams t ON pt.team_id = t.id
    WHERE pt.playoff_id = ? ORDER BY pt.seed
  `).all(playoffId);
  const allSeries = db.prepare(`
    SELECT ps.*,
      ht.name AS high_seed_name, ht.logo_url AS high_seed_logo,
      ht.color1 AS high_seed_color1, ht.color2 AS high_seed_color2,
      lt.name AS low_seed_name, lt.logo_url AS low_seed_logo,
      lt.color1 AS low_seed_color1, lt.color2 AS low_seed_color2,
      wt.name AS winner_name
    FROM playoff_series ps
    LEFT JOIN teams ht ON ps.high_seed_id = ht.id
    LEFT JOIN teams lt ON ps.low_seed_id = lt.id
    LEFT JOIN teams wt ON ps.winner_id = wt.id
    WHERE ps.playoff_id = ?
    ORDER BY ps.round_number, ps.series_number
  `).all(playoffId);
  const rounds = {};
  for (const s of allSeries) {
    if (!rounds[s.round_number]) rounds[s.round_number] = [];
    rounds[s.round_number].push(s);
  }
  // Include the playoff season name if one was auto-created
  const playoffSeason = playoff.playoff_season_id
    ? db.prepare('SELECT id, name FROM seasons WHERE id = ?').get(playoff.playoff_season_id)
    : null;
  return { playoff, teams, rounds, playoff_season: playoffSeason };
}

// GET /api/playoffs/by-season/:seasonId
app.get('/api/playoffs/by-season/:seasonId', (req, res) => {
  const playoff = db.prepare('SELECT * FROM playoffs WHERE season_id = ?').get(req.params.seasonId);
  if (!playoff) return res.status(404).json({ error: 'No playoff found for this season' });
  const bracket = getPlayoffBracket(playoff.id);
  if (!bracket) return res.status(404).json({ error: 'Playoff data not found' });
  res.json(bracket);
});

// ── Playoff schedule helpers ──────────────────────────────────────────────

/**
 * Home-ice pattern for a best-of-N series (2-2-1-1-1):
 *   games 1,2  → high seed hosts (true)
 *   games 3,4  → low  seed hosts (false)
 *   game  5    → high seed hosts (true)
 *   game  6    → low  seed hosts (false)
 *   game  7    → high seed hosts (true)
 */
const SERIES_HOME_PATTERN = [true, true, false, false, true, false, true];

/**
 * Insert `seriesLength` scheduled game stubs for a newly created playoff_series.
 * Games are created with status='scheduled', score 0-0, linked to the series.
 * startDate (YYYY-MM-DD) is the date of Game 1; subsequent games are spaced 2 days apart.
 * When startDate is omitted (e.g. advance-round), games are dated from today's date
 * and can be updated later via the stats editor.
 */
function createSeriesSchedule(seriesId, highSeedTeamId, lowSeedTeamId, seasonId, seriesLength, startDate) {
  const base = startDate ? new Date(startDate + 'T00:00:00Z') : new Date();
  const insertGame = db.prepare(
    'INSERT INTO games (home_team_id, away_team_id, home_score, away_score, date, status, season_id, is_overtime, playoff_series_id) VALUES (?, ?, 0, 0, ?, ?, ?, 0, ?)'
  );
  for (let i = 0; i < seriesLength; i++) {
    const highSeedHosts = SERIES_HOME_PATTERN[i];
    const home = highSeedHosts ? highSeedTeamId : lowSeedTeamId;
    const away = highSeedHosts ? lowSeedTeamId  : highSeedTeamId;
    const gameDate = new Date(base);
    gameDate.setUTCDate(gameDate.getUTCDate() + i * 2);
    insertGame.run(home, away, gameDate.toISOString().slice(0, 10), 'scheduled', seasonId, seriesId);
  }
}

// POST /api/playoffs – create bracket from season standings
app.post('/api/playoffs', requireOwner, (req, res) => {
  const { season_id, teams_qualify, min_games_played, series_length, series_start_date } = req.body;
  if (!season_id || !teams_qualify || teams_qualify < 2) {
    return res.status(400).json({ error: 'season_id and teams_qualify (min 2) are required' });
  }
  if (!series_start_date) {
    return res.status(400).json({ error: 'series_start_date (YYYY-MM-DD) is required' });
  }
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(season_id);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  if (season.is_playoff) return res.status(400).json({ error: 'Cannot create a playoff bracket from a playoff season' });
  const validTeamCounts = [2, 4, 8, 16];
  const n = Number(teams_qualify);
  if (!validTeamCounts.includes(n)) {
    return res.status(400).json({ error: 'teams_qualify must be 2, 4, 8, or 16' });
  }
  const existing = db.prepare('SELECT id FROM playoffs WHERE season_id = ?').get(season_id);
  if (existing) return res.status(409).json({ error: 'A playoff already exists for this season. Delete it first.' });

  // Build standings and filter by min games played
  const standings = calcStandings(Number(season_id));
  const minGP = Number(min_games_played) || 0;
  const qualified = standings.filter(t => t.gp >= minGP).slice(0, n);
  if (qualified.length < 2) {
    return res.status(400).json({ error: `Only ${qualified.length} team(s) qualify. Need at least 2.` });
  }
  // Pad with BYE slots if fewer teams qualified than requested
  const effectiveN = qualified.length;

  // Auto-create a dedicated playoff season so stats restart for the playoffs
  const playoffSeasonName = `${season.name} Playoffs`;
  const psResult = db.prepare('INSERT INTO seasons (name, is_active, league_type, is_playoff) VALUES (?, 0, ?, 1)')
    .run(playoffSeasonName, season.league_type || '');
  const playoffSeasonId = psResult.lastInsertRowid;

  const pl = db.prepare(
    'INSERT INTO playoffs (season_id, teams_qualify, min_games_played, series_length, playoff_season_id) VALUES (?, ?, ?, ?, ?)'
  ).run(Number(season_id), effectiveN, minGP, Number(series_length) || 7, playoffSeasonId);
  const playoffId = pl.lastInsertRowid;

  // Insert seeded teams
  qualified.forEach((t, i) => {
    db.prepare('INSERT INTO playoff_teams (playoff_id, team_id, seed) VALUES (?, ?, ?)').run(playoffId, t.id, i + 1);
  });

  // Generate round 1 matchups: 1 vs N, 2 vs N-1, …
  const m = Math.floor(effectiveN / 2);
  const seriesLen = Number(series_length) || 7;
  for (let i = 0; i < m; i++) {
    const hi = qualified[i];
    const lo = qualified[effectiveN - 1 - i];
    const sr = db.prepare(
      'INSERT INTO playoff_series (playoff_id, round_number, series_number, high_seed_id, low_seed_id, high_seed_num, low_seed_num) VALUES (?, 1, ?, ?, ?, ?, ?)'
    ).run(playoffId, i + 1, hi.id, lo.id, i + 1, effectiveN - i);
    createSeriesSchedule(sr.lastInsertRowid, hi.id, lo.id, playoffSeasonId, seriesLen, series_start_date);
  }

  res.status(201).json(getPlayoffBracket(playoffId));
});

// POST /api/playoffs/:id/advance-round – create next-round matchups from current-round winners
app.post('/api/playoffs/:id/advance-round', requireOwner, (req, res) => {
  const playoff = db.prepare('SELECT * FROM playoffs WHERE id = ?').get(req.params.id);
  if (!playoff) return res.status(404).json({ error: 'Playoff not found' });

  const curRound = db.prepare(
    'SELECT MAX(round_number) AS round FROM playoff_series WHERE playoff_id = ?'
  ).get(req.params.id).round;

  const series = db.prepare(
    'SELECT * FROM playoff_series WHERE playoff_id = ? AND round_number = ? ORDER BY series_number'
  ).all(req.params.id, curRound);

  if (series.some(s => !s.winner_id)) {
    return res.status(400).json({ error: 'Not all series in the current round are complete' });
  }
  if (series.length === 1) {
    return res.json({ message: 'Playoff complete', champion_id: series[0].winner_id });
  }

  // Sort winners by original seed (ascending = best seed first)
  const winners = series.map(s => {
    const pt = db.prepare('SELECT seed FROM playoff_teams WHERE playoff_id = ? AND team_id = ?').get(req.params.id, s.winner_id);
    return { team_id: s.winner_id, seed: pt ? pt.seed : 9999 };
  }).sort((a, b) => a.seed - b.seed);

  const nextRound = curRound + 1;
  const m = Math.floor(winners.length / 2);
  for (let i = 0; i < m; i++) {
    const hi = winners[i];
    const lo = winners[winners.length - 1 - i];
    const sr = db.prepare(
      'INSERT INTO playoff_series (playoff_id, round_number, series_number, high_seed_id, low_seed_id, high_seed_num, low_seed_num) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.params.id, nextRound, i + 1, hi.team_id, lo.team_id, hi.seed, lo.seed);
    createSeriesSchedule(sr.lastInsertRowid, hi.team_id, lo.team_id, playoff.playoff_season_id || playoff.season_id, playoff.series_length || 7);
  }

  res.json(getPlayoffBracket(req.params.id));
});

// PATCH /api/playoff-series/:id – update series wins (auto-sets winner)
app.patch('/api/playoff-series/:id', requireAdmin, (req, res) => {
  const s = db.prepare('SELECT * FROM playoff_series WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Series not found' });
  const pl = db.prepare('SELECT series_length FROM playoffs WHERE id = ?').get(s.playoff_id);
  const winsToWin = Math.ceil((pl ? pl.series_length : 7) / 2);

  const hw = req.body.high_seed_wins !== undefined ? Number(req.body.high_seed_wins) : s.high_seed_wins;
  const lw = req.body.low_seed_wins  !== undefined ? Number(req.body.low_seed_wins)  : s.low_seed_wins;
  let winner_id = null;
  if (hw >= winsToWin) winner_id = s.high_seed_id;
  else if (lw >= winsToWin) winner_id = s.low_seed_id;

  db.prepare('UPDATE playoff_series SET high_seed_wins = ?, low_seed_wins = ?, winner_id = ? WHERE id = ?')
    .run(hw, lw, winner_id, req.params.id);
  res.json({ ok: true, winner_id });
});

/**
 * Recount series wins by tallying all completed games in the series.
 * Called automatically whenever a playoff game's status changes to 'complete'
 * so the bracket stays in sync without any manual input.
 */
function recomputeSeriesWins(seriesId) {
  const s = db.prepare('SELECT * FROM playoff_series WHERE id = ?').get(seriesId);
  if (!s) return;
  const pl = db.prepare('SELECT series_length FROM playoffs WHERE id = ?').get(s.playoff_id);
  const winsToWin = Math.ceil((pl ? pl.series_length : 7) / 2);

  // Count how many complete games each team has won in this series
  const games = db.prepare(
    "SELECT home_team_id, away_team_id, home_score, away_score FROM games WHERE playoff_series_id = ? AND status = 'complete'"
  ).all(seriesId);

  let hw = 0, lw = 0;
  for (const g of games) {
    if (g.home_score === g.away_score) continue; // skip ties (shouldn't occur in hockey)
    const homeWon = g.home_score > g.away_score;
    const homeIsHigh = g.home_team_id === s.high_seed_id;
    if (homeWon) {
      if (homeIsHigh) hw++; else lw++;
    } else {
      if (homeIsHigh) lw++; else hw++;
    }
  }

  let winner_id = null;
  if (hw >= winsToWin) winner_id = s.high_seed_id;
  else if (lw >= winsToWin) winner_id = s.low_seed_id;

  db.prepare('UPDATE playoff_series SET high_seed_wins = ?, low_seed_wins = ?, winner_id = ? WHERE id = ?')
    .run(hw, lw, winner_id, seriesId);
}

// GET /api/playoff-series/:id/games – games linked to a series
app.get('/api/playoff-series/:id/games', (req, res) => {
  const games = db.prepare(`
    SELECT g.*,
      ht.name AS home_team_name, ht.logo_url AS home_logo,
      at.name AS away_team_name, at.logo_url AS away_logo
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.id
    JOIN teams at ON g.away_team_id = at.id
    WHERE g.playoff_series_id = ?
    ORDER BY g.date, g.id
  `).all(req.params.id);
  res.json(games);
});

// DELETE /api/playoffs/:id
app.delete('/api/playoffs/:id', requireOwner, (req, res) => {
  const playoff = db.prepare('SELECT * FROM playoffs WHERE id = ?').get(req.params.id);
  if (!playoff) return res.status(404).json({ error: 'Playoff not found' });
  // Delete auto-generated scheduled games for this playoff; unlink any manually-completed ones
  db.prepare('DELETE FROM games WHERE status = ? AND playoff_series_id IN (SELECT id FROM playoff_series WHERE playoff_id = ?)').run('scheduled', req.params.id);
  db.prepare('UPDATE games SET playoff_series_id = NULL WHERE playoff_series_id IN (SELECT id FROM playoff_series WHERE playoff_id = ?)').run(req.params.id);
  db.prepare('DELETE FROM playoff_series WHERE playoff_id = ?').run(req.params.id);
  db.prepare('DELETE FROM playoff_teams WHERE playoff_id = ?').run(req.params.id);
  db.prepare('DELETE FROM playoffs WHERE id = ?').run(req.params.id);
  // Delete the auto-created playoff season (and any remaining games assigned to it)
  if (playoff.playoff_season_id) {
    db.prepare('UPDATE games SET season_id = NULL WHERE season_id = ?').run(playoff.playoff_season_id);
    db.prepare('DELETE FROM seasons WHERE id = ? AND is_playoff = 1').run(playoff.playoff_season_id);
  }
  res.json({ ok: true });
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

// ── Discord OAuth2 routes ──────────────────────────────────────────────────

// Step 1 – redirect the browser to Discord's authorization page.
// ?token=<player_token>  → link an existing account (from dashboard)
// (no token)             → called during registration
app.get('/api/discord/connect', (req, res) => {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) return res.status(501).json({ error: 'Discord OAuth is not configured on this server. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET environment variables.' });
  const redirectUri = DISCORD_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/discord/callback`;
  const playerToken = req.query.token || '';
  const mode   = (playerToken && playerSessions.has(playerToken)) ? 'player' : 'register';
  const userId = mode === 'player' ? playerSessions.get(playerToken) : null;
  const state  = crypto.randomBytes(16).toString('hex');
  discordOAuthStates.set(state, { mode, userId, redirectUri, expires: Date.now() + 10 * 60 * 1000 });
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID, redirect_uri: redirectUri,
    response_type: 'code', scope: 'identify', state,
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

// Step 2 – Discord sends the browser back here with ?code=&state=
app.get('/api/discord/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`/register.html?discord_error=${encodeURIComponent(error)}`);
  const stateData = discordOAuthStates.get(state);
  discordOAuthStates.delete(state);
  if (!stateData || Date.now() > stateData.expires) return res.redirect('/register.html?discord_error=expired');
  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code', code, redirect_uri: stateData.redirectUri || `${req.protocol}://${req.get('host')}/api/discord/callback`,
      }),
    });
    if (!tokenRes.ok) throw new Error('token_exchange_failed');
    const tokenData = await tokenRes.json();
    // Fetch the Discord user's profile
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) throw new Error('user_fetch_failed');
    const du = await userRes.json();
    const discord_id = du.id;
    const discord    = du.username;

    if (stateData.mode === 'player') {
      // Update existing logged-in player
      db.prepare('UPDATE users SET discord_id = ?, discord = ? WHERE id = ?').run(discord_id, discord, stateData.userId);
      return res.redirect('/dashboard.html?discord_linked=1');
    } else {
      // Store for pickup by the registration page
      const linkToken = crypto.randomBytes(16).toString('hex');
      pendingDiscordLinks.set(linkToken, { discord_id, discord, expires: Date.now() + 10 * 60 * 1000 });
      return res.redirect(`/register.html?discord_token=${linkToken}&discord_username=${encodeURIComponent(discord)}`);
    }
  } catch (err) {
    const dest = stateData.mode === 'player' ? '/dashboard.html' : '/register.html';
    return res.redirect(`${dest}?discord_error=${encodeURIComponent(err.message)}`);
  }
});

// Step 3 – Registration page verifies the pending discord link token before submitting.
// Token is consumed on first use to prevent reuse.
app.get('/api/discord/pending', (req, res) => {
  const { token } = req.query;
  const pending = pendingDiscordLinks.get(token);
  if (!pending || Date.now() > pending.expires) return res.status(404).json({ error: 'Invalid or expired Discord link token' });
  pendingDiscordLinks.delete(token); // consume — one-time use
  res.json({ discord_id: pending.discord_id, discord: pending.discord });
});

// ── Game admin management (owner only) ────────────────────────────────────

// List users who are game admins
app.get('/api/admin/game-admins', requireOwner, (_req, res) => {
  const admins = db.prepare(
    "SELECT id, username, discord FROM users WHERE role = 'game_admin' ORDER BY username COLLATE NOCASE"
  ).all();
  res.json(admins);
});

// Search registered users by username prefix (owner only, used when adding game admins)
app.get('/api/admin/users/search', requireOwner, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const users = db.prepare(
    "SELECT id, username, discord, role FROM users WHERE username LIKE ? COLLATE NOCASE ORDER BY username LIMIT 20"
  ).all(`${q}%`);
  res.json(users);
});

// Promote a user to game admin
app.post('/api/admin/game-admins/:userId', requireOwner, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (isOwnerUser(user))
    return res.status(400).json({ error: "Cannot change the owner's role" });
  db.prepare("UPDATE users SET role = 'game_admin' WHERE id = ?").run(user.id);
  res.json({ ok: true });
});

// Demote a game admin back to regular user
app.delete('/api/admin/game-admins/:userId', requireOwner, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET role = NULL WHERE id = ?').run(user.id);
  // Invalidate any active admin session for this user
  for (const [token, session] of adminSessions) {
    if (session.userId === user.id) adminSessions.delete(token);
  }
  res.json({ ok: true });
});

// ── Global error handler ───────────────────────────────────────────────────
// Catches multer errors (file too large, wrong type) and returns JSON so the
// browser never sees a connection-reset "network error".
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum allowed size is 10 MB.' });
  }
  if (err && err.message === 'Only image files are allowed') {
    return res.status(400).json({ error: err.message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`EHL server running at http://localhost:${PORT}`);
  console.log(`Owner Discord ID: ${OWNER_DISCORD_ID}`);
});
