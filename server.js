const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const multer = require('multer');
const { promisify } = require('util');
const ExcelJS = require('exceljs');
const { createClient } = require('@supabase/supabase-js');
const db = require('./db');
const EA_STATS_MAP = require('./ea-stats-map');

const app = express();
const PORT = process.env.PORT || 3000;
const scrypt = promisify(crypto.scrypt);

// ── Supabase Storage client (for logo / file uploads) ────────────────────
// Accept both the app's own names and the Vercel/Supabase integration names.
const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.NEXT_PUBLIC_SUPABASE_URL
  || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || '';
// Guard: createClient throws if SUPABASE_URL is not a valid HTTP(S) URL
// (e.g. when it's a postgres:// connection string from Vercel integration).
function _isHttpUrl(s) {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}
let supabase = null;
if (_isHttpUrl(SUPABASE_URL) && SUPABASE_SERVICE_KEY) {
  try { supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY); } catch (e) {
    console.warn('[supabase] createClient failed:', e.message);
  }
}
const STORAGE_BUCKET = 'uploads';

/**
 * Upload a file buffer to Supabase Storage and return its public URL.
 * Falls back to local disk if Supabase is not configured.
 */
async function uploadToStorage(buffer, filename, contentType) {
  if (supabase) {
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filename, buffer, { contentType, upsert: true });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filename);
    return data.publicUrl;
  }
  // Fallback: save to local public/uploads
  const uploadsDir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, filename), buffer);
  return `/uploads/${filename}`;
}

/**
 * Delete a file from storage by its URL (or path).
 */
async function deleteFromStorage(urlOrPath) {
  if (!urlOrPath) return;
  if (supabase && urlOrPath.includes(SUPABASE_URL)) {
    // Extract the path after /object/public/uploads/
    const match = urlOrPath.match(/\/object\/public\/uploads\/(.+)$/);
    if (match) {
      await supabase.storage.from(STORAGE_BUCKET).remove([match[1]]);
    }
  } else if (urlOrPath.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, 'public', urlOrPath);
    try { fs.unlinkSync(filePath); } catch (err) { if (err.code !== 'ENOENT') console.warn('unlink:', err.message); }
  }
}

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

// ── Uploads (memory storage — files go to Supabase Storage) ──────────────

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  },
});

// Memory-storage uploader for Excel schedule imports (no files saved to disk)
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname) ||
               file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
               file.mimetype === 'application/vnd.ms-excel';
    cb(ok ? null : new Error('Only Excel files (.xlsx / .xls) are allowed'), ok);
  },
});

// ── Async error handling (Express 4 doesn't catch async errors by default) ──
// Replace Express Router's handle_request so rejected Promises from async route
// handlers are forwarded to the global error handler instead of hanging forever.
{
  const Layer = require('express/lib/router/layer');
  Layer.prototype.handle_request = function handleRequest(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) {
      // not a standard request handler
      return next();
    }
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') {
        result.catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

// ── Rate limiting ──────────────────────────────────────────────────────────

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, validate: { ip: false } });

app.set('trust proxy', 1); // trust first proxy so req.ip reflects real client IP
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/api', apiLimiter);
if (!process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, 'public')));
}

// ── Run async initialisation (schema + seed teams) ───────────────────────
// Store the promise so we can gate incoming requests until it resolves.
// If init fails, every request gets 503 so the error is visible.
// Retry once on failure to handle transient Vercel cold-start connection issues.
let initError = null;
const dbReady = (async () => {
  try {
    await db.initSchema();
    await db.seedTeams();
    console.log('[db] init: schema + seed OK');
  } catch (firstErr) {
    console.warn('[db] init attempt 1 failed, retrying in 500ms:', firstErr.message);
    await new Promise(r => setTimeout(r, 500));
    try {
      await db.initSchema();
      await db.seedTeams();
      console.log('[db] init: schema + seed OK (retry)');
    } catch (retryErr) {
      console.error('[db] init permanently failed:', retryErr.message);
      throw retryErr;
    }
  }
})().catch(err => {
  initError = err;
});

// Block every request until schema + seed have finished (matters on Vercel
// cold starts where the first request can arrive before init completes).
// If init failed, respond with 503 so the problem is immediately visible.
app.use((_req, res, next) => {
  dbReady.then(() => {
    if (initError) {
      return res.status(503).json({
        error: 'Database initialisation failed',
        detail: initError.message,
      });
    }
    next();
  }, next);
});

// ── Health check ────────────────────────────────────────────────────────────
// Quick endpoint to verify the API is up and the DB is connected.
app.get('/api/health', async (_req, res) => {
  try {
    await db.prepare('SELECT 1 AS ok').get();
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: err.message });
  }
});

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

/** Returns true if the given user record is the league owner. */
function isOwnerUser(user) {
  return user && user.discord_id === OWNER_DISCORD_ID;
}

// ── Discord OAuth2 ─────────────────────────────────────────────────────────
const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID     || '1379545091927965767';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'hP2korc5GbEuCkbLPEfxyWLxNk8ql-Y6';
// Leave blank to auto-detect from the incoming request (required for Vercel).
const DISCORD_REDIRECT_URI  = process.env.DISCORD_REDIRECT_URI  || '';

// ── Stateless signed-token helpers for Discord OAuth ──────────────────────
// On Vercel serverless each invocation may run in a different instance, so
// in-memory Maps are unreliable.  Instead we HMAC-sign the payload into the
// OAuth `state` parameter (and into the pending-link token) so no server-side
// storage is needed.
const DISCORD_STATE_SECRET = process.env.DISCORD_STATE_SECRET
  || process.env.ADMIN_PASSWORD
  || 'ehl-discord-state-default';

function _signPayload(payload) {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', DISCORD_STATE_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function _verifyPayload(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [b64, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', DISCORD_STATE_SECRET).update(b64).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;      // expired
    return payload;
  } catch { return null; }
}

// ── Stateless session tokens ──────────────────────────────────────────────
// On Vercel serverless each invocation may run in a different instance, so
// in-memory Maps are unreliable.  Instead we HMAC-sign session data into the
// token itself (similar to a JWT) so no server-side storage is needed.

function _signPlayerToken(userId) {
  return _signPayload({ sub: userId, purpose: 'player', exp: Date.now() + 30 * 24 * 60 * 60 * 1000 });
}

function _verifyPlayerToken(token) {
  const p = _verifyPayload(token);
  return (p && p.purpose === 'player') ? p.sub : null;
}

function _signAdminToken(userId, username, role) {
  return _signPayload({ sub: userId, u: username, r: role, purpose: 'admin', exp: Date.now() + 24 * 60 * 60 * 1000 });
}

function _verifyAdminToken(token) {
  const p = _verifyPayload(token);
  if (!p || p.purpose !== 'admin') return null;
  return { userId: p.sub, username: p.u, role: p.r };
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  const session = token && _verifyAdminToken(token);
  if (!session) return res.status(401).json({ error: 'Admin access required' });
  req.adminSession = session;
  next();
}

function requireOwner(req, res, next) {
  const token = req.headers['x-admin-token'];
  const session = token && _verifyAdminToken(token);
  if (!session || session.role !== 'owner')
    return res.status(403).json({ error: 'Owner access required' });
  req.adminSession = session;
  next();
}

function requirePlayer(req, res, next) {
  const token = req.headers['x-player-token'];
  const userId = _verifyPlayerToken(token);
  if (!userId) return res.status(401).json({ error: 'Player login required' });
  req.userId = userId;
  next();
}

function requireTeamRole(roles) {
  return async (req, res, next) => {
    const token = req.headers['x-player-token'];
    const userId = _verifyPlayerToken(token);
    if (!userId) return res.status(401).json({ error: 'Player login required' });
    req.userId = userId;
    const teamId = req.params.id || req.params.teamId;
    const staff = await db.prepare('SELECT role FROM team_staff WHERE team_id = ? AND user_id = ?').get(teamId, req.userId);
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
app.post('/api/auth/login', async (req, res) => {
  const playerToken = req.headers['x-player-token'];
  const userId = _verifyPlayerToken(playerToken);
  if (!userId) return res.status(401).json({ error: 'Player login required' });
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const isOwner = isOwnerUser(user);
  const role = isOwner ? 'owner' : (user.role === 'game_admin' ? 'game_admin' : null);
  if (!role) return res.status(403).json({ error: 'Access denied' });
  const token = _signAdminToken(user.id, user.username, role);
  res.json({ token, role, username: user.username });
});

app.post('/api/auth/logout', async (req, res) => {
  // Stateless tokens: nothing to invalidate server-side; client clears localStorage.
  res.json({ ok: true });
});

app.get('/api/auth/status', async (req, res) => {
  const token = req.headers['x-admin-token'];
  const session = token && _verifyAdminToken(token);
  if (!session) return res.json({ loggedIn: false });
  // Re-check database to handle demotion since last token issue
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId);
  if (!user) return res.json({ loggedIn: false });
  const currentRole = isOwnerUser(user) ? 'owner' : (user.role === 'game_admin' ? 'game_admin' : null);
  if (!currentRole) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, role: currentRole, username: user.username });
});

// ── Player registration & login ────────────────────────────────────────────

app.post('/api/players/register', async (req, res) => {
  const { username, platform, email, position, discord, discord_id } = req.body;
  console.log('[auth] register attempt:', { username, discord, discord_id: discord_id ? discord_id.slice(0, 6) + '…' : null });
  if (!username || !username.trim()) return res.status(400).json({ error: 'Username (gamertag) is required' });
  if (!discord || !discord.trim()) return res.status(400).json({ error: 'Discord account is required. Please connect with Discord.' });
  if (!discord_id) return res.status(400).json({ error: 'Discord account must be verified via OAuth. Please connect with Discord.' });
  const plat = (platform === 'psn' ? 'psn' : 'xbox');
  const pos = position ? position.trim() : null;
  const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) return res.status(409).json({ error: 'That gamertag is already registered' });
  const existingDiscord = await db.prepare('SELECT id FROM users WHERE discord_id = ?').get(discord_id);
  if (existingDiscord) return res.status(409).json({ error: 'That Discord account is already linked to another user. Please sign in instead.' });
  const r = await db.prepare('INSERT INTO users (username, platform, email, position, discord, discord_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(username.trim(), plat, email ? email.trim() : null, pos, discord.trim(), discord_id);

  // Try to merge with an existing custom-added player whose discord_id matches.
  // This links their user account to the existing roster spot instead of creating a fresh record.
  let playerId;
  let merged = false;
  if (discord_id) {
    const candidate = await db.prepare(
      'SELECT id FROM players WHERE discord_id = ? AND user_id IS NULL LIMIT 1'
    ).get(discord_id);
    if (candidate) {
      await db.prepare('UPDATE players SET user_id=?, name=?, position=COALESCE(?,position), discord=COALESCE(?,discord) WHERE id=?')
        .run(r.lastInsertRowid, username.trim(), pos || null, (discord && discord.trim()) ? discord.trim() : null, candidate.id);
      playerId = candidate.id;
      merged = true;
    }
  }
  if (!merged) {
    const pr = await db.prepare('INSERT INTO players (name, user_id, is_rostered, position) VALUES (?, ?, 0, ?)')
      .run(username.trim(), r.lastInsertRowid, pos);
    playerId = pr.lastInsertRowid;
  }

  const token = _signPlayerToken(r.lastInsertRowid);
  console.log('[auth] register success: user_id=', r.lastInsertRowid, 'merged=', merged);
  res.status(201).json({ token, id: r.lastInsertRowid, username: username.trim(), platform: plat, position: pos, player_id: playerId, merged });
});

// Discord-based login: exchange a signed discord login token for a session.
// The token is created by /api/discord/callback when mode=login.
app.post('/api/players/login', async (req, res) => {
  const { discord_login_token } = req.body;
  if (!discord_login_token) return res.status(400).json({ error: 'Discord login token is required' });
  const payload = _verifyPayload(discord_login_token);
  if (!payload || payload.purpose !== 'discord_login') {
    console.warn('[auth] login: invalid/expired discord_login_token');
    return res.status(401).json({ error: 'Invalid or expired login token. Please try signing in with Discord again.' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE discord_id = ?').get(payload.discord_id);
  if (!user) {
    console.warn('[auth] login: no user for discord_id', payload.discord_id);
    return res.status(404).json({ error: 'No account found for this Discord account. Please register first.' });
  }
  const token = _signPlayerToken(user.id);
  console.log('[auth] login success: user_id=', user.id, 'username=', user.username);
  res.json({ token, id: user.id, username: user.username, platform: user.platform, position: user.position });
});

app.post('/api/players/logout', async (req, res) => {
  // Stateless tokens: nothing to invalidate server-side; client clears localStorage.
  res.json({ ok: true });
});

app.get('/api/players/me', requirePlayer, async (req, res) => {
  const user = await db.prepare('SELECT id, username, platform, email, position, secondary_position, discord, discord_id, created_at FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const player = await db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.userId);
  const staff = await db.prepare(`
    SELECT ts.role, t.id AS team_id, t.name AS team_name, t.logo_url, t.color1, t.color2
    FROM team_staff ts JOIN teams t ON ts.team_id = t.id WHERE ts.user_id = ?
  `).all(req.userId);
  res.json({ user, player, staff });
});

app.patch('/api/players/me', requirePlayer, async (req, res) => {
  const { position, secondary_position } = req.body;
  const VALID_POS = ['G','C','LW','RW','LD','RD','D','F','W'];
  const pos = position && VALID_POS.includes(position) ? position : null;
  const sec = secondary_position && VALID_POS.includes(secondary_position) ? secondary_position : null;
  await db.prepare('UPDATE users SET position = ?, secondary_position = ? WHERE id = ?').run(pos, sec, req.userId);
  const player = await db.prepare('SELECT id FROM players WHERE user_id = ?').get(req.userId);
  if (player) await db.prepare('UPDATE players SET position = ?, secondary_position = ? WHERE id = ?').run(pos, sec, player.id);
  res.json({ ok: true });
});

app.post('/api/players/me/name-change', requirePlayer, async (req, res) => {
  const { new_name } = req.body;
  if (!new_name || !new_name.trim()) return res.status(400).json({ error: 'new_name is required' });
  const trimmed = new_name.trim();
  const user = await db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.username.toLowerCase() === trimmed.toLowerCase()) return res.status(400).json({ error: 'New name is the same as current name' });
  const clash = await db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(trimmed, req.userId);
  if (clash) return res.status(409).json({ error: 'That gamertag is already taken' });
  const pending = await db.prepare("SELECT id FROM name_change_requests WHERE user_id = ? AND status = 'pending'").get(req.userId);
  if (pending) return res.status(409).json({ error: 'You already have a pending name change request' });
  const result = await db.prepare("INSERT INTO name_change_requests (user_id, old_name, new_name) VALUES (?, ?, ?)").run(req.userId, user.username, trimmed);
  res.status(201).json({ id: result.lastInsertRowid, old_name: user.username, new_name: trimmed, status: 'pending' });
});

app.get('/api/admin/name-change-requests', requireOwner, async (req, res) => {
  const requests = await db.prepare(`
    SELECT ncr.*, u.username AS current_username, u.discord
    FROM name_change_requests ncr
    JOIN users u ON ncr.user_id = u.id
    WHERE ncr.status = 'pending'
    ORDER BY ncr.created_at ASC
  `).all();
  res.json(requests);
});

app.post('/api/admin/name-change-requests/:id/approve', requireOwner, async (req, res) => {
  const ncr = await db.prepare("SELECT * FROM name_change_requests WHERE id = ? AND status = 'pending'").get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'Request not found or already processed' });
  const clash = await db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(ncr.new_name, ncr.user_id);
  if (clash) {
    await db.prepare("UPDATE name_change_requests SET status = 'declined' WHERE id = ?").run(ncr.id);
    return res.status(409).json({ error: 'That gamertag is now taken; request declined' });
  }
  await db.transaction(async (tx) => {
    await tx.prepare('UPDATE users SET username = ? WHERE id = ?').run(ncr.new_name, ncr.user_id);
    await tx.prepare('UPDATE players SET name = ? WHERE name = ? AND user_id = ?').run(ncr.new_name, ncr.old_name, ncr.user_id);
    await tx.prepare('UPDATE game_player_stats SET player_name = ? WHERE player_name = ?').run(ncr.new_name, ncr.old_name);
    await tx.prepare('UPDATE season_player_stats SET player_name = ? WHERE player_name = ?').run(ncr.new_name, ncr.old_name);
    await tx.prepare("UPDATE name_change_requests SET status = 'approved' WHERE id = ?").run(ncr.id);
  });
  res.json({ ok: true });
});

app.post('/api/admin/name-change-requests/:id/decline', requireOwner, async (req, res) => {
  const ncr = await db.prepare("SELECT id FROM name_change_requests WHERE id = ? AND status = 'pending'").get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'Request not found or already processed' });
  await db.prepare("UPDATE name_change_requests SET status = 'declined' WHERE id = ?").run(ncr.id);
  res.json({ ok: true });
});

// Admin edits a registered user's profile
app.patch('/api/users/:id', requireOwner, async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const username = req.body.username !== undefined ? req.body.username.trim() : user.username;
  const platform = req.body.platform !== undefined ? (req.body.platform === 'psn' ? 'psn' : 'xbox') : user.platform;
  const email    = req.body.email    !== undefined ? (req.body.email ? req.body.email.trim() : null) : user.email;
  const position = req.body.position !== undefined ? (req.body.position ? req.body.position.trim() : null) : user.position;
  const discord  = req.body.discord  !== undefined ? (req.body.discord ? req.body.discord.trim() : null) : user.discord;
  if (username !== user.username) {
    const clash = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, user.id);
    if (clash) return res.status(409).json({ error: 'That gamertag is already taken' });
  }
  await db.prepare('UPDATE users SET username = ?, platform = ?, email = ?, position = ?, discord = ? WHERE id = ?')
    .run(username, platform, email, position, discord, user.id);
  // Keep the active player record in sync (one record per user by design)
  const activePlayer = await db.prepare('SELECT id FROM players WHERE user_id = ? ORDER BY id LIMIT 1').get(user.id);
  if (activePlayer) {
    await db.prepare('UPDATE players SET name = ?, position = ? WHERE id = ?').run(username, position, activePlayer.id);
  }
  res.json({ ok: true });
});

// ── Seasons ────────────────────────────────────────────────────────────────

app.get('/api/seasons', async (req, res) => {
  const { type } = req.query;
  const seasons = type
    ? await db.prepare('SELECT s.*, p.season_id AS parent_season_id FROM seasons s LEFT JOIN playoffs p ON s.id = p.playoff_season_id WHERE s.league_type = ? ORDER BY s.sort_order ASC, s.id ASC').all(type)
    : await db.prepare('SELECT s.*, p.season_id AS parent_season_id FROM seasons s LEFT JOIN playoffs p ON s.id = p.playoff_season_id ORDER BY s.sort_order ASC, s.id ASC').all();
  res.json(seasons);
});

app.post('/api/seasons', requireOwner, async (req, res) => {
  const { name, make_active, league_type } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Season name is required' });
  if (make_active) await db.prepare('UPDATE seasons SET is_active = 0').run();
  const lt = league_type || '';
  // Place new seasons at the end of the list
  const maxOrder = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM seasons').get();
  const nextOrder = maxOrder.m + 1;
  const result = await db.prepare('INSERT INTO seasons (name, is_active, league_type, sort_order) VALUES (?, ?, ?, ?)').run(name.trim(), make_active ? 1 : 0, lt, nextOrder);
  res.status(201).json({ id: result.lastInsertRowid, name: name.trim(), is_active: make_active ? 1 : 0, league_type: lt, sort_order: nextOrder });
});

app.patch('/api/seasons/:id', requireOwner, async (req, res) => {
  const season = await db.prepare('SELECT * FROM seasons WHERE id = ?').get(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const name = req.body.name !== undefined ? req.body.name.trim() : season.name;
  const league_type = req.body.league_type !== undefined ? req.body.league_type : (season.league_type || '');
  if (req.body.is_active) await db.prepare('UPDATE seasons SET is_active = 0').run();
  const is_active = req.body.is_active ? 1 : (req.body.is_active === false ? 0 : season.is_active);
  await db.prepare('UPDATE seasons SET name = ?, is_active = ?, league_type = ? WHERE id = ?').run(name, is_active, league_type, req.params.id);
  res.json({ updated: true });
});

app.delete('/api/seasons/:id', requireOwner, async (req, res) => {
  const season = await db.prepare('SELECT * FROM seasons WHERE id = ?').get(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season not found' });

  await db.transaction(async (tx) => {
    // Helper: fully delete one playoff bracket (series games, series, teams, bracket row)
    async function deletePlayoffBracket(playoffId) {
      const series = await tx.prepare('SELECT id FROM playoff_series WHERE playoff_id = ?').all(playoffId);
      for (const s of series) {
        const seriesGames = await tx.prepare('SELECT id FROM games WHERE playoff_series_id = ?').all(s.id);
        for (const sg of seriesGames) {
          await tx.prepare('DELETE FROM game_player_stats WHERE game_id = ?').run(sg.id);
        }
        await tx.prepare('DELETE FROM games WHERE playoff_series_id = ?').run(s.id);
      }
      await tx.prepare('DELETE FROM playoff_series WHERE playoff_id = ?').run(playoffId);
      await tx.prepare('DELETE FROM playoff_teams WHERE playoff_id = ?').run(playoffId);
      await tx.prepare('DELETE FROM playoffs WHERE id = ?').run(playoffId);
    }

    // Helper: fully delete a season row and its associated games/stats
    async function deleteSeasonData(seasonId) {
      await tx.prepare('DELETE FROM game_player_stats WHERE game_id IN (SELECT id FROM games WHERE season_id = ?)').run(seasonId);
      await tx.prepare('DELETE FROM games WHERE season_id = ?').run(seasonId);
      await tx.prepare('DELETE FROM season_player_stats WHERE season_id = ?').run(seasonId);
      await tx.prepare('DELETE FROM season_team_conf WHERE season_id = ?').run(seasonId);
      await tx.prepare('DELETE FROM seasons WHERE id = ?').run(seasonId);
    }

    // If it's a playoff season, clean up associated playoff bracket data first
    if (season.is_playoff) {
      const playoffs = await tx.prepare('SELECT id FROM playoffs WHERE playoff_season_id = ?').all(req.params.id);
      for (const p of playoffs) {
        await deletePlayoffBracket(p.id);
      }
    }

    // If it's a regular season, also delete the linked playoff bracket (and its season)
    if (!season.is_playoff) {
      const linkedPlayoff = await tx.prepare('SELECT * FROM playoffs WHERE season_id = ?').get(req.params.id);
      if (linkedPlayoff) {
        await deletePlayoffBracket(linkedPlayoff.id);
        if (linkedPlayoff.playoff_season_id) {
          await deleteSeasonData(linkedPlayoff.playoff_season_id);
        }
      }
    }

    // Delete all game stats and games from this season
    await tx.prepare('DELETE FROM game_player_stats WHERE game_id IN (SELECT id FROM games WHERE season_id = ?)').run(req.params.id);
    await tx.prepare('DELETE FROM games WHERE season_id = ?').run(req.params.id);
    await tx.prepare('DELETE FROM season_player_stats WHERE season_id = ?').run(req.params.id);
    await tx.prepare('DELETE FROM season_team_conf WHERE season_id = ?').run(req.params.id);
    await tx.prepare('DELETE FROM seasons WHERE id = ?').run(req.params.id);
  });

  res.json({ deleted: true });
});

// POST /api/seasons/:id/reorder – move season up or down in the list
app.post('/api/seasons/:id/reorder', requireOwner, async (req, res) => {
  const { direction } = req.body;
  if (direction !== 'up' && direction !== 'down') {
    return res.status(400).json({ error: 'direction must be "up" or "down"' });
  }
  const season = await db.prepare('SELECT * FROM seasons WHERE id = ?').get(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season not found' });

  // Playoff seasons are display-only children of their parent regular season;
  // they always appear directly above their parent in the list and cannot be
  // reordered independently (doing so corrupts the regular-season sort_order).
  if (season.is_playoff) {
    return res.status(400).json({ error: 'Playoff seasons cannot be reordered directly. Move the parent regular season instead.' });
  }

  // Get only seasons of the same league_type so arrows move within the filtered view
  const lt = season.league_type || '';
  const all = lt
    ? await db.prepare('SELECT id, sort_order FROM seasons WHERE league_type = ? ORDER BY sort_order ASC, id ASC').all(lt)
    : await db.prepare('SELECT id, sort_order FROM seasons ORDER BY sort_order ASC, id ASC').all();
  const idx = all.findIndex(s => s.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ error: 'Season not found in list' });

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= all.length) return res.json({ ok: true }); // already at boundary

  // Swap sort_order values between the two seasons.
  // If legacy data has identical sort_order values, assign distinct values so the swap
  // produces a visible change: the moved season gets the neighbor's position,
  // and the neighbor shifts to make room.
  const myOrder = all[idx].sort_order;
  const theirOrder = all[swapIdx].sort_order;
  if (myOrder !== theirOrder) {
    // Normal case: just swap the two sort_order values
    await db.prepare('UPDATE seasons SET sort_order = ? WHERE id = ?').run(theirOrder, all[idx].id);
    await db.prepare('UPDATE seasons SET sort_order = ? WHERE id = ?').run(myOrder, all[swapIdx].id);
  } else {
    // Legacy data: both have the same sort_order, so assign idx-based values
    // Moving "up" means this item gets a lower sort_order
    const baseOrder = myOrder;
    await db.prepare('UPDATE seasons SET sort_order = ? WHERE id = ?').run(direction === 'up' ? baseOrder - 1 : baseOrder + 1, all[idx].id);
  }
  res.json({ ok: true });
});

// ── Site Logo ──────────────────────────────────────────────────────────────

// GET /api/site-logo  – redirect to the current site logo file
// Optional query param: ?type=threes|sixes to get the league-specific logo
// Falls back to the main site logo if no league-specific one is set.
app.get('/api/site-logo', async (req, res) => {
  const lt = req.query.type; // 'threes', 'sixes', or undefined
  if (lt === 'threes' || lt === 'sixes') {
    const key = `site_logo_url_${lt}`;
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row && row.value) return res.redirect(302, row.value);
    // Fall through to main logo below
  }
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'site_logo_url'").get();
  const url = (row && row.value) ? row.value : '/logo.svg';
  res.redirect(302, url);
});

// POST /api/admin/site-logo  – upload a new site logo (owner only)
// Optional body field `league_type` = 'threes' | 'sixes' for per-league logos.
app.post('/api/admin/site-logo', requireOwner, logoUpload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  const unique = crypto.randomBytes(8).toString('hex');
  const filename = `logo-${Date.now()}-${unique}${ext}`;
  const newUrl = await uploadToStorage(req.file.buffer, filename, req.file.mimetype);
  const lt = (req.body.league_type || '').trim();
  const key = (lt === 'threes' || lt === 'sixes') ? `site_logo_url_${lt}` : 'site_logo_url';
  // Delete old custom logo synchronously before updating DB, so we don't
  // leave orphaned files if the DB write fails (and vice-versa).
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row && row.value) {
    await deleteFromStorage(row.value);
  }
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, newUrl);
  res.json({ url: newUrl });
});

// ── Teams ──────────────────────────────────────────────────────────────────

app.get('/api/teams', async (_req, res) => {
  res.json(await db.prepare('SELECT * FROM teams ORDER BY name').all());
});

app.post('/api/teams', requireOwner, logoUpload.single('logo'), async (req, res) => {
  const body = req.body;
  const name = (body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const conference = (body.conference || '').trim();
  const division = (body.division || '').trim();
  const ea_club_id = body.ea_club_id ? Number(body.ea_club_id) : null;
  let logo_url = body.logo_url || null;
  if (req.file) {
    const ext = path.extname(req.file.originalname).toLowerCase();
    const unique = crypto.randomBytes(8).toString('hex');
    const fname = `logo-${Date.now()}-${unique}${ext}`;
    logo_url = await uploadToStorage(req.file.buffer, fname, req.file.mimetype);
  }
  const color1 = (body.color1 || '').trim();
  const color2 = (body.color2 || '').trim();
  const league_type = (body.league_type || '').trim();
  const abbreviation = (body.abbreviation || '').trim().slice(0, 5);
  const result = await db.prepare(
    'INSERT INTO teams (name, conference, division, ea_club_id, logo_url, color1, color2, league_type, abbreviation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, conference, division, ea_club_id, logo_url, color1, color2, league_type, abbreviation);
  res.status(201).json({ id: result.lastInsertRowid, name, conference, division, ea_club_id, logo_url, color1, color2, league_type, abbreviation });
});

app.patch('/api/teams/:id', requireOwner, logoUpload.single('logo'), async (req, res) => {
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const body = req.body;
  const name = body.name !== undefined ? (body.name || '').trim() : team.name;
  const conference = body.conference !== undefined ? (body.conference || '').trim() : team.conference;
  const division = body.division !== undefined ? (body.division || '').trim() : team.division;
  const ea_club_id = body.ea_club_id !== undefined ? (body.ea_club_id ? Number(body.ea_club_id) : null) : team.ea_club_id;
  const color1 = body.color1 !== undefined ? (body.color1 || '').trim() : (team.color1 || '');
  const color2 = body.color2 !== undefined ? (body.color2 || '').trim() : (team.color2 || '');
  const league_type = body.league_type !== undefined ? (body.league_type || '').trim() : (team.league_type || '');
  const abbreviation = body.abbreviation !== undefined ? (body.abbreviation || '').trim().slice(0, 5) : (team.abbreviation || '');
  let logo_url = team.logo_url;
  if (req.file) {
    const ext = path.extname(req.file.originalname).toLowerCase();
    const unique = crypto.randomBytes(8).toString('hex');
    const fname = `logo-${Date.now()}-${unique}${ext}`;
    logo_url = await uploadToStorage(req.file.buffer, fname, req.file.mimetype);
    if (team.logo_url) await deleteFromStorage(team.logo_url);
  } else if (body.logo_url !== undefined) {
    logo_url = body.logo_url || null;
  }
  await db.prepare('UPDATE teams SET name=?, conference=?, division=?, ea_club_id=?, logo_url=?, color1=?, color2=?, league_type=?, abbreviation=? WHERE id=?')
    .run(name, conference, division, ea_club_id, logo_url, color1, color2, league_type, abbreviation, req.params.id);
  res.json({ updated: true });
});

app.delete('/api/teams/:id', requireOwner, async (req, res) => {
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (team.logo_url) await deleteFromStorage(team.logo_url);
  await db.prepare('DELETE FROM team_staff WHERE team_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM game_player_stats WHERE team_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM players WHERE team_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM games WHERE home_team_id = ? OR away_team_id = ?').run(req.params.id, req.params.id);
  await db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// POST /api/admin/merge-teams – merge source team into target team
// All references to the source team are updated to point to the target team.
// The source team is then deleted.
app.post('/api/admin/merge-teams', requireOwner, async (req, res) => {
  const { source_id, target_id } = req.body;
  if (!source_id || !target_id) return res.status(400).json({ error: 'source_id and target_id are required' });
  if (Number(source_id) === Number(target_id)) return res.status(400).json({ error: 'Source and target must be different teams' });

  const source = await db.prepare('SELECT * FROM teams WHERE id = ?').get(source_id);
  const target = await db.prepare('SELECT * FROM teams WHERE id = ?').get(target_id);
  if (!source) return res.status(404).json({ error: 'Source team not found' });
  if (!target) return res.status(404).json({ error: 'Target team not found' });

  await db.transaction(async (tx) => {
    // Update all game_player_stats from source to target
    await tx.prepare('UPDATE game_player_stats SET team_id = ? WHERE team_id = ?').run(target_id, source_id);

    // Update all season_player_stats from source to target
    await tx.prepare('UPDATE season_player_stats SET team_id = ? WHERE team_id = ?').run(target_id, source_id);

    // Update games: home_team_id and away_team_id
    await tx.prepare('UPDATE games SET home_team_id = ? WHERE home_team_id = ?').run(target_id, source_id);
    await tx.prepare('UPDATE games SET away_team_id = ? WHERE away_team_id = ?').run(target_id, source_id);

    // Update players: move roster entries (avoid duplicates – if player already exists on target, remove the source one)
    const sourcePlayers = await tx.prepare('SELECT * FROM players WHERE team_id = ?').all(source_id);
    const targetPlayers = await tx.prepare('SELECT id, name FROM players WHERE team_id = ?').all(target_id);
    const targetPlayerNames = new Set(targetPlayers.map(p => p.name));
    for (const sp of sourcePlayers) {
      if (targetPlayerNames.has(sp.name)) {
        // Player already on target team – remove the source player record
        await tx.prepare('DELETE FROM players WHERE id = ?').run(sp.id);
      } else {
        await tx.prepare('UPDATE players SET team_id = ? WHERE id = ?').run(target_id, sp.id);
      }
    }

    // Update playoff_teams
    await tx.prepare('UPDATE playoff_teams SET team_id = ? WHERE team_id = ?').run(target_id, source_id);

    // Update playoff_series
    await tx.prepare('UPDATE playoff_series SET high_seed_id = ? WHERE high_seed_id = ?').run(target_id, source_id);
    await tx.prepare('UPDATE playoff_series SET low_seed_id = ? WHERE low_seed_id = ?').run(target_id, source_id);
    await tx.prepare('UPDATE playoff_series SET winner_id = ? WHERE winner_id = ?').run(target_id, source_id);

    // Update signing_offers
    await tx.prepare('UPDATE signing_offers SET team_id = ? WHERE team_id = ?').run(target_id, source_id);

    // Update transactions
    await tx.prepare('UPDATE transactions SET team_id = ?, team_name = ? WHERE team_id = ?').run(target_id, target.name, source_id);

    // Move team_staff (skip duplicates)
    await tx.prepare('DELETE FROM team_staff WHERE team_id = ? AND user_id IN (SELECT user_id FROM team_staff WHERE team_id = ?)').run(source_id, target_id);
    await tx.prepare('UPDATE team_staff SET team_id = ? WHERE team_id = ?').run(target_id, source_id);

    // Delete the source team
    await tx.prepare('DELETE FROM teams WHERE id = ?').run(source_id);
  });

  if (source.logo_url) await deleteFromStorage(source.logo_url);
  res.json({ ok: true, merged: { source: source.name, target: target.name } });
});

// POST /api/admin/merge-players – merge source player name into target player name
// All game stats and historical stats referencing the source name are updated to the target name.
app.post('/api/admin/merge-players', requireOwner, async (req, res) => {
  const { source_name, target_name } = req.body;
  if (!source_name || !target_name) return res.status(400).json({ error: 'source_name and target_name are required' });
  if (source_name.trim().toLowerCase() === target_name.trim().toLowerCase()) {
    return res.status(400).json({ error: 'Source and target must be different players' });
  }

  const srcName = source_name.trim();
  const tgtName = target_name.trim();

  // Update all game_player_stats from source name to target name
  await db.prepare('UPDATE game_player_stats SET player_name = ? WHERE player_name = ?').run(tgtName, srcName);

  // Update all season_player_stats from source name to target name
  await db.prepare('UPDATE season_player_stats SET player_name = ? WHERE player_name = ?').run(tgtName, srcName);

  // Update player records: if target player already exists on same team, just remove the source
  const sourcePlayers = await db.prepare('SELECT * FROM players WHERE name = ?').all(srcName);
  const targetPlayers = await db.prepare('SELECT id, team_id, user_id FROM players WHERE name = ?').all(tgtName);
  const targetByTeam = new Map(targetPlayers.map(p => [p.team_id, p]));
  for (const sp of sourcePlayers) {
    const existingTarget = targetByTeam.get(sp.team_id);
    if (existingTarget) {
      // If source had user_id but target doesn't, transfer it
      if (sp.user_id && !existingTarget.user_id) {
        await db.prepare('UPDATE players SET user_id = ? WHERE id = ?').run(sp.user_id, existingTarget.id);
      }
      await db.prepare('DELETE FROM players WHERE id = ?').run(sp.id);
    } else {
      await db.prepare('UPDATE players SET name = ? WHERE id = ?').run(tgtName, sp.id);
    }
  }

  // Update username in users table if the source has a matching user account
  const sourceUser = await db.prepare('SELECT id FROM users WHERE username = ?').get(srcName);
  if (sourceUser) {
    const targetUser = await db.prepare('SELECT id FROM users WHERE username = ?').get(tgtName);
    if (!targetUser) {
      // Rename the user account
      await db.prepare('UPDATE users SET username = ? WHERE id = ?').run(tgtName, sourceUser.id);
    }
    // If both exist, the source user account remains (admin can clean up separately)
  }

  res.json({ ok: true, merged: { source: srcName, target: tgtName } });
});

// ── Team owner / GM management ─────────────────────────────────────────────

// Admin assigns team owner
app.post('/api/teams/:id/owner', requireOwner, async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  // Remove any existing owner for this team
  await db.prepare("DELETE FROM team_staff WHERE team_id = ? AND role = 'owner'").run(req.params.id);
  await db.prepare("INSERT INTO team_staff (team_id, user_id, role) VALUES (?, ?, 'owner') ON CONFLICT (team_id, user_id) DO UPDATE SET role = 'owner'").run(req.params.id, user_id);
  const existingPlayer = await db.prepare('SELECT id, team_id FROM players WHERE user_id = ?').get(user_id);
  if (existingPlayer) {
    if (String(existingPlayer.team_id) !== String(req.params.id)) {
      await db.prepare('UPDATE players SET team_id = ?, is_rostered = 1 WHERE id = ?').run(req.params.id, existingPlayer.id);
    }
  } else {
    await db.prepare('INSERT INTO players (name, user_id, team_id, is_rostered, position) VALUES (?, ?, ?, 1, ?)').run(user.username, user_id, req.params.id, user.position || null);
  }
  res.json({ ok: true });
});

// Admin removes team owner
app.delete('/api/teams/:id/owner', requireOwner, async (req, res) => {
  await db.prepare("DELETE FROM team_staff WHERE team_id = ? AND role = 'owner'").run(req.params.id);
  res.json({ ok: true });
});

// Owner adds a GM (max 2)
app.post('/api/teams/:id/gms', requireTeamRole(['owner']), async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const gmCount = await db.prepare("SELECT COUNT(*) AS cnt FROM team_staff WHERE team_id = ? AND role = 'gm'").get(req.params.id).cnt;
  if (gmCount >= 2) return res.status(400).json({ error: 'Maximum 2 GMs allowed per team' });
  const already = await db.prepare('SELECT * FROM team_staff WHERE team_id = ? AND user_id = ?').get(req.params.id, user_id);
  if (already) return res.status(409).json({ error: 'User already has a role on this team' });
  await db.prepare("INSERT INTO team_staff (team_id, user_id, role) VALUES (?, ?, 'gm')").run(req.params.id, user_id);
  res.json({ ok: true });
});

// Owner removes a GM
app.delete('/api/teams/:id/gms/:userId', requireTeamRole(['owner']), async (req, res) => {
  await db.prepare("DELETE FROM team_staff WHERE team_id = ? AND user_id = ? AND role = 'gm'").run(req.params.id, req.params.userId);
  res.json({ ok: true });
});

// ── Team roster management ─────────────────────────────────────────────────

async function rosterMaxForTeam(teamId) {
  const team = await db.prepare('SELECT league_type FROM teams WHERE id = ?').get(teamId);
  if (!team) return 20;
  if (team.league_type === 'threes') return 12;
  if (team.league_type === 'sixes') return 20;
  return 999; // no limit for untyped teams
}

// GM or owner sends a signing offer (player must accept)
app.post('/api/teams/:id/roster/offer', requireTeamRole(['owner', 'gm']), async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  // Already on a roster?
  const onRoster = await db.prepare('SELECT * FROM players WHERE user_id = ? AND team_id IS NOT NULL AND is_rostered = 1').get(user_id);
  if (onRoster) return res.status(409).json({ error: 'Player is already on a roster' });
  // Already a pending offer from this team?
  const dupOffer = await db.prepare("SELECT id FROM signing_offers WHERE team_id = ? AND user_id = ? AND status = 'pending'").get(req.params.id, user_id);
  if (dupOffer) return res.status(409).json({ error: 'A pending offer already exists for this player' });
  // Roster limit check (based on current + pending)
  const count = await db.prepare('SELECT COUNT(*) AS cnt FROM players WHERE team_id = ? AND is_rostered = 1').get(req.params.id).cnt;
  const max = await rosterMaxForTeam(req.params.id);
  if (count >= max) return res.status(400).json({ error: `Roster is full (max ${max})` });
  await db.prepare("INSERT INTO signing_offers (team_id, user_id, offered_by, status) VALUES (?, ?, ?, 'pending')")
    .run(req.params.id, user_id, req.userId);
  res.status(201).json({ ok: true });
});

// Player fetches their pending offers
app.get('/api/players/offers', requirePlayer, async (req, res) => {
  const offers = await db.prepare(`
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
app.post('/api/players/offers/:id/accept', requirePlayer, async (req, res) => {
  const offer = await db.prepare("SELECT * FROM signing_offers WHERE id = ? AND user_id = ? AND status = 'pending'").get(req.params.id, req.userId);
  if (!offer) return res.status(404).json({ error: 'Offer not found' });
  // Re-check roster limit
  const count = await db.prepare('SELECT COUNT(*) AS cnt FROM players WHERE team_id = ? AND is_rostered = 1').get(offer.team_id).cnt;
  const max = await rosterMaxForTeam(offer.team_id);
  if (count >= max) {
    await db.prepare("UPDATE signing_offers SET status = 'declined' WHERE id = ?").run(offer.id);
    return res.status(400).json({ error: 'Roster is now full; offer cancelled' });
  }
  await db.prepare("UPDATE signing_offers SET status = 'accepted' WHERE id = ?").run(offer.id);
  // Decline all other pending offers for this player
  await db.prepare("UPDATE signing_offers SET status = 'declined' WHERE user_id = ? AND status = 'pending' AND id != ?").run(req.userId, offer.id);
  // Sign the player
  let player = await db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.userId);
  if (player) {
    await db.prepare('UPDATE players SET team_id = ?, is_rostered = 1 WHERE id = ?').run(offer.team_id, player.id);
  } else {
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    await db.prepare('INSERT INTO players (name, user_id, team_id, is_rostered, position) VALUES (?, ?, ?, 1, ?)').run(user.username, req.userId, offer.team_id, user.position);
  }
  const signingTeam = await db.prepare('SELECT name FROM teams WHERE id = ?').get(offer.team_id);
  const signingUser = await db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId);
  if (signingTeam && signingUser) {
    await db.prepare("INSERT INTO transactions (type, player_name, team_id, team_name) VALUES ('signing', ?, ?, ?)").run(signingUser.username, offer.team_id, signingTeam.name);
  }
  res.json({ ok: true });
});

// Player declines a signing offer
app.post('/api/players/offers/:id/decline', requirePlayer, async (req, res) => {
  const offer = await db.prepare("SELECT * FROM signing_offers WHERE id = ? AND user_id = ? AND status = 'pending'").get(req.params.id, req.userId);
  if (!offer) return res.status(404).json({ error: 'Offer not found' });
  await db.prepare("UPDATE signing_offers SET status = 'declined' WHERE id = ?").run(offer.id);
  res.json({ ok: true });
});

// GM or owner releases a player from the roster
app.delete('/api/teams/:id/roster/:playerId', requireTeamRole(['owner', 'gm']), async (req, res) => {
  const player = await db.prepare('SELECT * FROM players WHERE id = ? AND team_id = ?').get(req.params.playerId, req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found on this team' });
  await db.prepare('UPDATE players SET team_id = NULL, is_rostered = 0 WHERE id = ?').run(req.params.playerId);
  const releaseTeam = await db.prepare('SELECT name FROM teams WHERE id = ?').get(req.params.id);
  if (releaseTeam) {
    await db.prepare("INSERT INTO transactions (type, player_name, team_id, team_name) VALUES ('release', ?, ?, ?)").run(player.name, Number(req.params.id), releaseTeam.name);
  }
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
    saucerPasses:     Number(eaField(p, 'saucerPasses'))   || 0,
    pkClears:         Number(eaField(p, 'pkClears'))        || 0,
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
    desperationSaves:    Number(eaField(p, 'desperationSaves'))    || 0,
    pokeCheckSaves:      Number(eaField(p, 'pokeCheckSaves'))      || 0,
  };
}

async function fetchEA(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      Origin: 'https://proclubs.ea.com',
      Referer: 'https://proclubs.ea.com/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Ch-Ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });
  if (!res.ok) throw new Error(`EA API responded with ${res.status}`);
  return res.json();
}

// ── Shared stat SQL fragments ──────────────────────────────────────────────

const SKATER_SELECT = `
  MAX(gps.player_name) AS name, MAX(gps.team_id) AS team_id, MAX(t.name) AS team_name, MAX(t.logo_url) AS team_logo,
  MAX(t.color1) AS team_color1, MAX(t.color2) AS team_color2, MAX(gps.position) AS position,
  COUNT(DISTINCT gps.game_id) AS gp,
  ROUND(AVG(CASE WHEN gps.overall_rating > 0 THEN CAST(gps.overall_rating AS NUMERIC)
               WHEN GREATEST(gps.offensive_rating, gps.defensive_rating, gps.team_play_rating) > 0
                 THEN GREATEST(0.0, LEAST(99.0,
                   CASE WHEN gps.position ILIKE '%defense%'
                     THEN (CAST(gps.offensive_rating AS NUMERIC)
                           + CAST(gps.defensive_rating AS NUMERIC) * 2.0
                           + CAST(gps.team_play_rating AS NUMERIC) * 1.5) / 4.5
                     ELSE (CAST(gps.offensive_rating AS NUMERIC) * 2.0
                           + CAST(gps.defensive_rating AS NUMERIC)
                           + CAST(gps.team_play_rating AS NUMERIC) * 1.5) / 4.5
                   END
                 ))
               ELSE GREATEST(0.0, LEAST(99.0,
                 60.0
                 + LEAST(CAST(gps.goals AS NUMERIC) * 7.0, 21.0)
                 + LEAST(CAST(gps.assists AS NUMERIC) * 4.0, 14.0)
                 + GREATEST(LEAST(CAST(gps.plus_minus AS NUMERIC) * 3.0, 12.0), -12.0)
                 + LEAST(CAST(gps.shots AS NUMERIC) * 0.5, 5.0)
                 + LEAST(CAST(gps.hits AS NUMERIC) * 0.5, 5.0)
                 + LEAST(CAST(gps.blocked_shots AS NUMERIC) * 1.5, 6.0)
                 + LEAST(CAST(gps.takeaways AS NUMERIC) * 1.5, 6.0)
                 - LEAST(CAST(gps.giveaways AS NUMERIC) * 2.0, 8.0)
                 - LEAST(CAST(gps.pim AS NUMERIC) * 0.5, 5.0)
               ))
          END), 0) AS overall_rating,
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
    THEN ROUND(CAST(SUM(gps.possession_secs) AS NUMERIC)/COUNT(DISTINCT gps.game_id),0)
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
  SUM(gps.hat_tricks) AS hat_tricks,
  SUM(gps.saucer_passes) AS saucer_passes,
  SUM(gps.pk_clears) AS pk_clears,
  SUM(CASE WHEN (gps.team_id = g.home_team_id AND g.home_score > g.away_score)
             OR (gps.team_id = g.away_team_id AND g.away_score > g.home_score) THEN 1 ELSE 0 END) AS player_wins,
  SUM(CASE WHEN ((gps.team_id = g.home_team_id AND g.home_score < g.away_score)
              OR (gps.team_id = g.away_team_id AND g.away_score < g.home_score))
           AND (g.is_overtime IS NULL OR g.is_overtime = 0) THEN 1 ELSE 0 END) AS player_losses,
  SUM(CASE WHEN ((gps.team_id = g.home_team_id AND g.home_score < g.away_score)
              OR (gps.team_id = g.away_team_id AND g.away_score < g.home_score))
           AND g.is_overtime = 1 THEN 1 ELSE 0 END) AS player_otl,
  SUM(CASE WHEN gps.team_id = g.home_team_id THEN g.home_score ELSE g.away_score END) AS goal_support`;

const GOALIE_SELECT = `
  MAX(gps.player_name) AS name, MAX(gps.team_id) AS team_id, MAX(t.name) AS team_name, MAX(t.logo_url) AS team_logo,
  MAX(t.color1) AS team_color1, MAX(t.color2) AS team_color2,
  COUNT(DISTINCT gps.game_id) AS gp,
  SUM(gps.goals) AS goals, SUM(gps.assists) AS assists,
  SUM(gps.shots_against) AS shots_against,
  SUM(gps.goals_against) AS goals_against,
  SUM(gps.saves) AS saves,
  CASE WHEN SUM(gps.shots_against) > 0
    THEN ROUND(CAST(SUM(gps.saves) AS NUMERIC)/SUM(gps.shots_against),3)
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
  SUM(gps.desperation_saves) AS desperation_saves,
  SUM(gps.poke_check_saves) AS poke_check_saves,
  SUM(gps.goalie_wins) AS goalie_wins,
  SUM(gps.goalie_losses) AS goalie_losses,
  SUM(gps.goalie_otw) AS goalie_otw,
  SUM(gps.goalie_otl) AS goalie_otl,
  CASE WHEN COUNT(DISTINCT gps.game_id) > 0
    THEN ROUND(CAST(SUM(gps.shots_against) AS NUMERIC)/COUNT(DISTINCT gps.game_id),1)
    ELSE NULL END AS shots_per_game,
  ROUND(AVG(CASE WHEN gps.overall_rating > 0 THEN CAST(gps.overall_rating AS NUMERIC)
               WHEN GREATEST(gps.defensive_rating, gps.offensive_rating, gps.team_play_rating) > 0
                 THEN GREATEST(0.0, LEAST(99.0,
                   (CAST(gps.defensive_rating AS NUMERIC) * 2.0
                    + CAST(gps.offensive_rating AS NUMERIC)
                    + CAST(gps.team_play_rating AS NUMERIC) * 1.5) / 4.5
                 ))
               WHEN gps.shots_against > 0 THEN GREATEST(0.0, LEAST(99.0,
                 60.0
                 + (CAST(gps.shots_against - gps.goals_against AS NUMERIC) / CAST(gps.shots_against AS NUMERIC) * 100.0 - 88.0) * 3.0
                 + CASE WHEN gps.goals_against = 0 THEN 8.0 ELSE 0.0 END
               ))
               ELSE 60.0
          END), 0) AS overall_rating,
  ROUND(AVG(NULLIF(gps.offensive_rating,0)),0)  AS offensive_rating,
  ROUND(AVG(NULLIF(gps.defensive_rating,0)),0)  AS defensive_rating,
  ROUND(AVG(NULLIF(gps.team_play_rating,0)),0)  AS team_play_rating,
  SUM(CASE WHEN gps.team_id = g.home_team_id THEN g.home_score ELSE g.away_score END) AS goal_support`;

app.get('/api/teams/:id/stats', async (req, res) => {
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
  const sf = seasonId ? 'AND g.season_id = ?' : '';
  const params = seasonId ? [req.params.id, seasonId] : [req.params.id];
  const rp = seasonId ? [req.params.id, req.params.id, seasonId] : [req.params.id, req.params.id];

  // Fetch rostered players – when a specific season is selected, derive from game stats
  // so historical rosters reflect who actually played that season
  const roster = seasonId
    ? await db.prepare(`
        SELECT DISTINCT ON (gps.player_name)
          gps.player_name AS name, gps.position,
          p.id, p.number, p.user_id, u.platform
        FROM game_player_stats gps
        JOIN games g ON gps.game_id = g.id
        LEFT JOIN players p ON p.name = gps.player_name AND p.team_id = gps.team_id
        LEFT JOIN users u ON p.user_id = u.id
        WHERE gps.team_id = ? AND g.season_id = ? AND g.status IN ('complete','forfeit')
        ORDER BY gps.player_name
      `).all(req.params.id, seasonId)
    : await db.prepare(`
        SELECT p.id, p.name, p.position, p.number, p.user_id, u.platform
        FROM players p LEFT JOIN users u ON p.user_id = u.id
        WHERE p.team_id = ? AND p.is_rostered = 1 ORDER BY p.name
      `).all(req.params.id);

  const skaterStats = await db.prepare(`
    SELECT ${SKATER_SELECT}
    FROM game_player_stats gps JOIN teams t ON gps.team_id = t.id JOIN games g ON gps.game_id = g.id
    WHERE gps.team_id = ? AND gps.position != 'G' AND g.status IN ('complete','forfeit') ${sf}
    GROUP BY gps.player_name ORDER BY points DESC, goals DESC
  `).all(...params);

  const goalieStats = await db.prepare(`
    SELECT ${GOALIE_SELECT}
    FROM game_player_stats gps JOIN teams t ON gps.team_id = t.id JOIN games g ON gps.game_id = g.id
    WHERE gps.team_id = ? AND gps.position = 'G' AND g.status IN ('complete','forfeit') ${sf}
    GROUP BY gps.player_name ORDER BY save_pct DESC
  `).all(...params);

  const recentGames = await db.prepare(`
    SELECT g.id, g.date, g.home_score, g.away_score, g.status, g.is_overtime, g.season_id,
      ht.id AS home_team_id, ht.name AS home_team_name, ht.logo_url AS home_logo,
      at.id AS away_team_id, at.name AS away_team_name, at.logo_url AS away_logo
    FROM games g JOIN teams ht ON g.home_team_id = ht.id JOIN teams at ON g.away_team_id = at.id
    WHERE (g.home_team_id = ? OR g.away_team_id = ?) AND g.status IN ('complete','forfeit') ${seasonId ? 'AND g.season_id = ?' : ''}
    ORDER BY g.date DESC LIMIT 10
  `).all(...rp);

  // Staff
  const staff = await db.prepare(`
    SELECT ts.role, u.id AS user_id, u.username, u.platform
    FROM team_staff ts JOIN users u ON ts.user_id = u.id
    WHERE ts.team_id = ? ORDER BY ts.role
  `).all(req.params.id);

  // W-L-OT record for selected season (or all-time)
  const record = await db.prepare(`
    SELECT
      SUM(CASE WHEN (home_team_id=@id AND home_score>away_score) OR (away_team_id=@id AND away_score>home_score) THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN (home_team_id=@id AND home_score<away_score AND is_overtime=0) OR (away_team_id=@id AND away_score<home_score AND is_overtime=0) THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN (home_team_id=@id AND home_score<away_score AND is_overtime=1) OR (away_team_id=@id AND away_score<home_score AND is_overtime=1) THEN 1 ELSE 0 END) AS otl
    FROM games
    WHERE (home_team_id=@id OR away_team_id=@id) AND status IN ('complete','forfeit')
    ${seasonId ? 'AND season_id=@sid' : ''}
  `).get(seasonId ? { id: req.params.id, sid: seasonId } : { id: req.params.id });

  // Latest 5 transactions for this team
  const transactions = await db.prepare(`
    SELECT so.id, so.created_at, u.username AS player_name,
      ft.id AS from_team_id, ft.name AS from_team_name, ft.logo_url AS from_team_logo,
      t.id AS to_team_id, t.name AS to_team_name, t.logo_url AS to_team_logo
    FROM signing_offers so
    JOIN users u ON so.user_id = u.id
    JOIN teams t ON so.team_id = t.id
    LEFT JOIN players p ON p.user_id = so.user_id AND p.is_rostered = 1 AND p.team_id != so.team_id
    LEFT JOIN teams ft ON ft.id = p.team_id
    WHERE so.team_id = ? AND so.status = 'accepted'
    ORDER BY so.created_at DESC LIMIT 10
  `).all(req.params.id);

  // Upcoming games (scheduled, not yet played)
  const upcoming = await db.prepare(`
    SELECT g.id, g.date,
      ht.id AS home_team_id, ht.name AS home_team_name, ht.logo_url AS home_logo,
      at.id AS away_team_id, at.name AS away_team_name, at.logo_url AS away_logo
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.id
    JOIN teams at ON g.away_team_id = at.id
    WHERE (g.home_team_id = ? OR g.away_team_id = ?) AND g.status = 'scheduled'
    ORDER BY g.date ASC LIMIT 5
  `).all(req.params.id, req.params.id);

  res.json({ team, roster, skaterStats, goalieStats, recentGames, staff, record, transactions, upcoming });
});

// GET /api/teams/:id/seasons – all seasons a team has played at least one game in
app.get('/api/teams/:id/seasons', async (req, res) => {
  const team = await db.prepare('SELECT id FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const seasons = await db.prepare(`
    SELECT DISTINCT s.id, s.name, s.is_active, s.is_playoff
    FROM games g
    JOIN seasons s ON g.season_id = s.id
    WHERE g.home_team_id = ? OR g.away_team_id = ?
    ORDER BY s.sort_order ASC, s.id ASC
  `).all(req.params.id, req.params.id);
  res.json(seasons);
});

// ── Team records ────────────────────────────────────────────────────────────

app.get('/api/teams/:id/records', async (req, res) => {
  const id = req.params.id;
  const team = await db.prepare('SELECT id FROM teams WHERE id = ?').get(id);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const minGPRow = await db.prepare("SELECT value FROM settings WHERE key = 'goalie_season_min_gp'").get();
  const goalieSeasonMinGP = minGPRow ? (parseInt(minGPRow.value, 10) || 16) : 16;

  async function careerRecord(col, agg, pos, orderDir) {
    const where = pos === 'G' ? "gps.position = 'G'" : "gps.position != 'G'";
    return await db.prepare(`
      SELECT gps.player_name AS name,
        ${agg} AS value,
        COUNT(DISTINCT gps.game_id) AS gp
      FROM game_player_stats gps
      JOIN games g ON gps.game_id = g.id
      WHERE gps.team_id = ? AND ${where} AND g.status IN ('complete','forfeit')
      GROUP BY gps.player_name
      ORDER BY value ${orderDir}, gp DESC LIMIT 1
    `).get(id);
  }

  async function singleSeasonRecord(col, agg, pos, orderDir, minGP) {
    const where = pos === 'G' ? "gps.position = 'G'" : "gps.position != 'G'";
    const having = minGP ? 'HAVING COUNT(DISTINCT gps.game_id) >= ?' : '';
    const params = minGP ? [id, parseInt(minGP, 10)] : [id];
    return await db.prepare(`
      SELECT gps.player_name AS name,
        g.season_id, MAX(COALESCE(s.name, 'No Season')) AS season_name,
        ${agg} AS value,
        COUNT(DISTINCT gps.game_id) AS gp
      FROM game_player_stats gps
      JOIN games g ON gps.game_id = g.id
      LEFT JOIN seasons s ON g.season_id = s.id
      WHERE gps.team_id = ? AND ${where} AND g.status IN ('complete','forfeit')
      GROUP BY gps.player_name, g.season_id ${having}
      ORDER BY value ${orderDir}, gp DESC LIMIT 1
    `).get(...params);
  }

  const career = {
    pts:         await careerRecord('points',      "SUM(gps.goals + gps.assists)", 'S', 'DESC'),
    goals:       await careerRecord('goals',       "SUM(gps.goals)",               'S', 'DESC'),
    plus_minus:  await careerRecord('plus_minus',  "SUM(gps.plus_minus)",          'S', 'DESC'),
    save_pct:    await careerRecord('save_pct',    "CASE WHEN SUM(gps.shots_against)>0 THEN ROUND(CAST(SUM(gps.saves) AS NUMERIC)/SUM(gps.shots_against),3) ELSE NULL END", 'G', 'DESC'),
    gaa:         await careerRecord('gaa',         "CASE WHEN SUM(gps.toi)>0 THEN ROUND(SUM(gps.goals_against)*3600.0/SUM(gps.toi),2) ELSE NULL END",                    'G', 'ASC'),
    goalie_wins: await careerRecord('goalie_wins', "SUM(gps.goalie_wins)",          'G', 'DESC'),
  };

  const single = {
    pts:         await singleSeasonRecord('points',      "SUM(gps.goals + gps.assists)", 'S', 'DESC'),
    goals:       await singleSeasonRecord('goals',       "SUM(gps.goals)",               'S', 'DESC'),
    plus_minus:  await singleSeasonRecord('plus_minus',  "SUM(gps.plus_minus)",          'S', 'DESC'),
    save_pct:    await singleSeasonRecord('save_pct',    "CASE WHEN SUM(gps.shots_against)>0 THEN ROUND(CAST(SUM(gps.saves) AS NUMERIC)/SUM(gps.shots_against),3) ELSE NULL END", 'G', 'DESC', goalieSeasonMinGP),
    gaa:         await singleSeasonRecord('gaa',         "CASE WHEN SUM(gps.toi)>0 THEN ROUND(SUM(gps.goals_against)*3600.0/SUM(gps.toi),2) ELSE NULL END",                    'G', 'ASC',  goalieSeasonMinGP),
    goalie_wins: await singleSeasonRecord('goalie_wins', "SUM(gps.goalie_wins)",          'G', 'DESC'),
  };

  res.json({ career, single });
});

// ── League-wide records ────────────────────────────────────────────────────

app.get('/api/records', async (req, res) => {
  const lt = req.query.league_type || null; // 'threes' | 'sixes' | null for both
  const st = req.query.season_type || null; // 'regular' | 'playoffs' | null for both
  const ltFilter = lt ? 'AND COALESCE(s.league_type,\'\') = ?' : '';
  const stFilter = st === 'playoffs' ? 'AND g.playoff_series_id IS NOT NULL'
                 : st === 'regular'  ? 'AND g.playoff_series_id IS NULL'
                 : '';
  const p1 = lt ? [lt] : [];

  const minGPRow = await db.prepare("SELECT value FROM settings WHERE key = 'goalie_season_min_gp'").get();
  const goalieSeasonMinGP = minGPRow ? (parseInt(minGPRow.value, 10) || 16) : 16;

  // Returns array of all players tied for the top value (handles ties)
  async function leagueCareerRecord(agg, pos, orderDir) {
    const where = pos === 'G' ? "gps.position = 'G'" : "gps.position != 'G'";
    return await db.prepare(`
      WITH agg_vals AS (
        SELECT gps.player_name AS name, MAX(t.name) AS team_name,
          ${agg} AS value,
          COUNT(DISTINCT gps.game_id) AS gp
        FROM game_player_stats gps
        JOIN games g ON gps.game_id = g.id
        JOIN teams t ON gps.team_id = t.id
        LEFT JOIN seasons s ON g.season_id = s.id
        WHERE ${where} AND g.status IN ('complete','forfeit') ${ltFilter} ${stFilter}
        GROUP BY gps.player_name
      ),
      top_val AS (SELECT value FROM agg_vals ORDER BY value ${orderDir} LIMIT 1)
      SELECT av.* FROM agg_vals av WHERE av.value = (SELECT value FROM top_val)
      ORDER BY av.gp DESC
    `).all(...p1);
  }

  async function leagueSeasonRecord(agg, pos, orderDir, minGP) {
    const where = pos === 'G' ? "gps.position = 'G'" : "gps.position != 'G'";
    const having = minGP ? 'HAVING COUNT(DISTINCT gps.game_id) >= ?' : '';
    const params = minGP ? [...p1, minGP] : p1;
    return await db.prepare(`
      WITH agg_vals AS (
        SELECT gps.player_name AS name, MAX(t.name) AS team_name,
          g.season_id, MAX(COALESCE(s.name,'No Season')) AS season_name,
          ${agg} AS value,
          COUNT(DISTINCT gps.game_id) AS gp
        FROM game_player_stats gps
        JOIN games g ON gps.game_id = g.id
        JOIN teams t ON gps.team_id = t.id
        LEFT JOIN seasons s ON g.season_id = s.id
        WHERE ${where} AND g.status IN ('complete','forfeit') ${ltFilter} ${stFilter}
        GROUP BY gps.player_name, g.season_id
        ${having}
      ),
      top_val AS (SELECT value FROM agg_vals ORDER BY value ${orderDir} LIMIT 1)
      SELECT av.* FROM agg_vals av WHERE av.value = (SELECT value FROM top_val)
      ORDER BY av.gp DESC
    `).all(...params);
  }

  async function leagueSingleGameRecord(col, pos, orderDir) {
    const where = pos === 'G' ? "gps.position = 'G'" : "gps.position != 'G'";
    return await db.prepare(`
      WITH game_vals AS (
        SELECT gps.player_name AS name, t.name AS team_name,
          g.id AS game_id, g.date,
          ht.name AS home_team, at2.name AS away_team,
          gps.${col} AS value
        FROM game_player_stats gps
        JOIN games g ON gps.game_id = g.id
        JOIN teams t ON gps.team_id = t.id
        JOIN teams ht ON g.home_team_id = ht.id
        JOIN teams at2 ON g.away_team_id = at2.id
        LEFT JOIN seasons s ON g.season_id = s.id
        WHERE ${where} AND g.status IN ('complete','forfeit') ${ltFilter} ${stFilter}
      ),
      top_val AS (SELECT value FROM game_vals ORDER BY value ${orderDir} LIMIT 1)
      SELECT gv.* FROM game_vals gv WHERE gv.value = (SELECT value FROM top_val)
      ORDER BY gv.date DESC
    `).all(...p1);
  }

  // All-time skater records (GP included)
  const career = {
    gp:               await leagueCareerRecord("COUNT(DISTINCT gps.game_id)", 'S', 'DESC'),
    pts:              await leagueCareerRecord("SUM(gps.goals+gps.assists)",  'S', 'DESC'),
    goals:            await leagueCareerRecord("SUM(gps.goals)",              'S', 'DESC'),
    assists:          await leagueCareerRecord("SUM(gps.assists)",            'S', 'DESC'),
    plus_minus:       await leagueCareerRecord("SUM(gps.plus_minus)",         'S', 'DESC'),
    hits:             await leagueCareerRecord("SUM(gps.hits)",               'S', 'DESC'),
    shots:            await leagueCareerRecord("SUM(gps.shots)",              'S', 'DESC'),
    shot_attempts:    await leagueCareerRecord("SUM(gps.shot_attempts)",      'S', 'DESC'),
    blocked_shots:    await leagueCareerRecord("SUM(gps.blocked_shots)",      'S', 'DESC'),
    pim:              await leagueCareerRecord("SUM(gps.pim)",                'S', 'DESC'),
    pp_goals:         await leagueCareerRecord("SUM(gps.pp_goals)",           'S', 'DESC'),
    sh_goals:         await leagueCareerRecord("SUM(gps.sh_goals)",           'S', 'DESC'),
    gwg:              await leagueCareerRecord("SUM(gps.gwg)",                'S', 'DESC'),
    hat_tricks:       await leagueCareerRecord("SUM(gps.hat_tricks)",         'S', 'DESC'),
    faceoff_wins:     await leagueCareerRecord("SUM(gps.faceoff_wins)",       'S', 'DESC'),
    deflections:      await leagueCareerRecord("SUM(gps.deflections)",        'S', 'DESC'),
    interceptions:    await leagueCareerRecord("SUM(gps.interceptions)",      'S', 'DESC'),
    takeaways:        await leagueCareerRecord("SUM(gps.takeaways)",          'S', 'DESC'),
    giveaways:        await leagueCareerRecord("SUM(gps.giveaways)",          'S', 'DESC'),
    pass_completions: await leagueCareerRecord("SUM(gps.pass_completions)",   'S', 'DESC'),
    penalties_drawn:  await leagueCareerRecord("SUM(gps.penalties_drawn)",    'S', 'DESC'),
    pk_clears:        await leagueCareerRecord("SUM(gps.pk_clears)",           'S', 'DESC'),
    // Goalie all-time (GP included)
    goalie_gp:        await leagueCareerRecord("COUNT(DISTINCT gps.game_id)", 'G', 'DESC'),
    goalie_wins:      await leagueCareerRecord("SUM(gps.goalie_wins)",        'G', 'DESC'),
    saves:            await leagueCareerRecord("SUM(gps.saves)",              'G', 'DESC'),
    shutouts:         await leagueCareerRecord("SUM(gps.shutouts)",           'G', 'DESC'),
    psa:              await leagueCareerRecord("SUM(gps.penalty_shot_attempts) - SUM(gps.penalty_shot_ga)", 'G', 'DESC'),
    bksv:             await leagueCareerRecord("SUM(gps.breakaway_saves)",    'G', 'DESC'),
    desperation_saves: await leagueCareerRecord("SUM(gps.desperation_saves)", 'G', 'DESC'),
    poke_check_saves:  await leagueCareerRecord("SUM(gps.poke_check_saves)",  'G', 'DESC'),
    goals_against:    await leagueCareerRecord("SUM(gps.goals_against)",      'G', 'DESC'),
  };

  // Seasonal skater records (no GP)
  const seasonal = {
    pts:              await leagueSeasonRecord("SUM(gps.goals+gps.assists)",  'S', 'DESC'),
    goals:            await leagueSeasonRecord("SUM(gps.goals)",              'S', 'DESC'),
    assists:          await leagueSeasonRecord("SUM(gps.assists)",            'S', 'DESC'),
    plus_minus:       await leagueSeasonRecord("SUM(gps.plus_minus)",         'S', 'DESC'),
    hits:             await leagueSeasonRecord("SUM(gps.hits)",               'S', 'DESC'),
    shots:            await leagueSeasonRecord("SUM(gps.shots)",              'S', 'DESC'),
    shot_attempts:    await leagueSeasonRecord("SUM(gps.shot_attempts)",      'S', 'DESC'),
    blocked_shots:    await leagueSeasonRecord("SUM(gps.blocked_shots)",      'S', 'DESC'),
    pim:              await leagueSeasonRecord("SUM(gps.pim)",                'S', 'DESC'),
    pp_goals:         await leagueSeasonRecord("SUM(gps.pp_goals)",           'S', 'DESC'),
    sh_goals:         await leagueSeasonRecord("SUM(gps.sh_goals)",           'S', 'DESC'),
    gwg:              await leagueSeasonRecord("SUM(gps.gwg)",                'S', 'DESC'),
    hat_tricks:       await leagueSeasonRecord("SUM(gps.hat_tricks)",         'S', 'DESC'),
    faceoff_wins:     await leagueSeasonRecord("SUM(gps.faceoff_wins)",       'S', 'DESC'),
    deflections:      await leagueSeasonRecord("SUM(gps.deflections)",        'S', 'DESC'),
    interceptions:    await leagueSeasonRecord("SUM(gps.interceptions)",      'S', 'DESC'),
    takeaways:        await leagueSeasonRecord("SUM(gps.takeaways)",          'S', 'DESC'),
    giveaways:        await leagueSeasonRecord("SUM(gps.giveaways)",          'S', 'DESC'),
    pass_completions: await leagueSeasonRecord("SUM(gps.pass_completions)",   'S', 'DESC'),
    penalties_drawn:  await leagueSeasonRecord("SUM(gps.penalties_drawn)",    'S', 'DESC'),
    pk_clears:        await leagueSeasonRecord("SUM(gps.pk_clears)",           'S', 'DESC'),
    // Goalie seasonal (no GP; Save% with min-GP filter)
    goalie_wins:      await leagueSeasonRecord("SUM(gps.goalie_wins)",        'G', 'DESC'),
    saves:            await leagueSeasonRecord("SUM(gps.saves)",              'G', 'DESC'),
    shutouts:         await leagueSeasonRecord("SUM(gps.shutouts)",           'G', 'DESC'),
    psa:              await leagueSeasonRecord("SUM(gps.penalty_shot_attempts) - SUM(gps.penalty_shot_ga)", 'G', 'DESC'),
    bksv:             await leagueSeasonRecord("SUM(gps.breakaway_saves)",    'G', 'DESC'),
    desperation_saves: await leagueSeasonRecord("SUM(gps.desperation_saves)", 'G', 'DESC'),
    poke_check_saves:  await leagueSeasonRecord("SUM(gps.poke_check_saves)",  'G', 'DESC'),
    goals_against:    await leagueSeasonRecord("SUM(gps.goals_against)",      'G', 'DESC'),
    save_pct:         await leagueSeasonRecord(
      "CASE WHEN SUM(gps.shots_against)>0 THEN ROUND(CAST(SUM(gps.saves) AS NUMERIC)/SUM(gps.shots_against),3) ELSE NULL END",
      'G', 'DESC', goalieSeasonMinGP
    ),
  };

  // Single-game skater records (no GP)
  const singleGame = {
    pts:              null, // computed below
    goals:            await leagueSingleGameRecord('goals',              'S', 'DESC'),
    assists:          await leagueSingleGameRecord('assists',            'S', 'DESC'),
    plus_minus:       await leagueSingleGameRecord('plus_minus',         'S', 'DESC'),
    hits:             await leagueSingleGameRecord('hits',               'S', 'DESC'),
    shots:            await leagueSingleGameRecord('shots',              'S', 'DESC'),
    shot_attempts:    await leagueSingleGameRecord('shot_attempts',      'S', 'DESC'),
    blocked_shots:    await leagueSingleGameRecord('blocked_shots',      'S', 'DESC'),
    pim:              await leagueSingleGameRecord('pim',                'S', 'DESC'),
    pp_goals:         await leagueSingleGameRecord('pp_goals',           'S', 'DESC'),
    sh_goals:         await leagueSingleGameRecord('sh_goals',           'S', 'DESC'),
    faceoff_wins:     await leagueSingleGameRecord('faceoff_wins',       'S', 'DESC'),
    deflections:      await leagueSingleGameRecord('deflections',        'S', 'DESC'),
    interceptions:    await leagueSingleGameRecord('interceptions',      'S', 'DESC'),
    takeaways:        await leagueSingleGameRecord('takeaways',          'S', 'DESC'),
    giveaways:        await leagueSingleGameRecord('giveaways',          'S', 'DESC'),
    pass_completions: await leagueSingleGameRecord('pass_completions',   'S', 'DESC'),
    penalties_drawn:  await leagueSingleGameRecord('penalties_drawn',    'S', 'DESC'),
    pk_clears:        await leagueSingleGameRecord('pk_clears',          'S', 'DESC'),
    // Goalie single game
    saves:            await leagueSingleGameRecord('saves',              'G', 'DESC'),
    psa:              await leagueSingleGameRecord('penalty_shot_attempts - gps.penalty_shot_ga', 'G', 'DESC'),
    bksv:             await leagueSingleGameRecord('breakaway_saves',    'G', 'DESC'),
    desperation_saves: await leagueSingleGameRecord('desperation_saves', 'G', 'DESC'),
    poke_check_saves:  await leagueSingleGameRecord('poke_check_saves',  'G', 'DESC'),
    goals_against:    await leagueSingleGameRecord('goals_against',      'G', 'DESC'),
  };

  // Single-game pts (goals+assists in one game) – requires custom query
  const ltFilterSg = lt ? 'AND COALESCE(s.league_type,\'\') = ?' : '';
  singleGame.pts = await db.prepare(`
    WITH game_vals AS (
      SELECT gps.player_name AS name, t.name AS team_name,
        g.id AS game_id, g.date,
        ht.name AS home_team, at2.name AS away_team,
        (gps.goals + gps.assists) AS value
      FROM game_player_stats gps
      JOIN games g ON gps.game_id = g.id
      JOIN teams t ON gps.team_id = t.id
      JOIN teams ht ON g.home_team_id = ht.id
      JOIN teams at2 ON g.away_team_id = at2.id
      LEFT JOIN seasons s ON g.season_id = s.id
      WHERE gps.position != 'G' AND g.status IN ('complete','forfeit') ${ltFilterSg} ${stFilter}
    ),
    top_val AS (SELECT value FROM game_vals ORDER BY value DESC LIMIT 1)
    SELECT gv.* FROM game_vals gv WHERE gv.value = (SELECT value FROM top_val)
    ORDER BY gv.date DESC
  `).all(...p1);

  // Remove PP Goals / SH Goals from 3's league (not tracked in that format)
  if (lt === 'threes') {
    career.pp_goals = null;
    career.sh_goals = null;
    seasonal.pp_goals = null;
    seasonal.sh_goals = null;
    singleGame.pp_goals = null;
    singleGame.sh_goals = null;
  }

  res.json({ career, seasonal, singleGame, goalieSeasonMinGP });
});

// ── Records settings (admin) ────────────────────────────────────────────────

app.get('/api/admin/records-settings', requireOwner, async (_req, res) => {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'goalie_season_min_gp'").get();
  const row2 = await db.prepare("SELECT value FROM settings WHERE key = 'goalie_stats_min_gp'").get();
  res.json({
    goalie_season_min_gp: row ? (parseInt(row.value, 10) || 16) : 16,
    goalie_stats_min_gp: row2 ? (parseInt(row2.value, 10) || 5) : 5,
  });
});

app.post('/api/admin/records-settings', requireOwner, async (req, res) => {
  const val = parseInt(req.body.goalie_season_min_gp, 10);
  if (isNaN(val) || val < 1) return res.status(400).json({ error: 'Invalid value' });
  await db.prepare("INSERT INTO settings (key, value) VALUES ('goalie_season_min_gp', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(val));

  // Save goalie stats min GP if provided
  if (req.body.goalie_stats_min_gp !== undefined) {
    const val2 = parseInt(req.body.goalie_stats_min_gp, 10);
    if (isNaN(val2) || val2 < 1) return res.status(400).json({ error: 'Invalid goalie_stats_min_gp value' });
    await db.prepare("INSERT INTO settings (key, value) VALUES ('goalie_stats_min_gp', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(val2));
  }

  const row2 = await db.prepare("SELECT value FROM settings WHERE key = 'goalie_stats_min_gp'").get();
  res.json({
    goalie_season_min_gp: val,
    goalie_stats_min_gp: row2 ? (parseInt(row2.value, 10) || 5) : 5,
  });
});

// ── Player record holdings (which records does this player hold) ────────────

app.get('/api/players/records/:name', async (req, res) => {
  const name = req.params.name;
  const holdings = [];

  const minGPRow = await db.prepare("SELECT value FROM settings WHERE key = 'goalie_season_min_gp'").get();
  const goalieSeasonMinGP = minGPRow ? (parseInt(minGPRow.value, 10) || 16) : 16;

  // Helper: check if player holds a career (all-time) league record (handles ties)
  async function checkLeagueRecord(label, agg, pos, orderDir, leagueType, category, stFilter, seasonType) {
    const where = pos === 'G' ? "gps.position = 'G'" : "gps.position != 'G'";
    const ltFilter = leagueType ? "AND COALESCE(s.league_type,'') = ?" : '';
    const p = leagueType ? [leagueType] : [];
    const rows = await db.prepare(`
      WITH agg_vals AS (
        SELECT gps.player_name AS name, ${agg} AS value, COUNT(DISTINCT gps.game_id) AS gp
        FROM game_player_stats gps
        JOIN games g ON gps.game_id = g.id
        LEFT JOIN seasons s ON g.season_id = s.id
        WHERE ${where} AND g.status IN ('complete','forfeit') ${ltFilter} ${stFilter}
        GROUP BY gps.player_name
      ),
      top_val AS (SELECT value FROM agg_vals ORDER BY value ${orderDir} LIMIT 1)
      SELECT * FROM agg_vals WHERE value = (SELECT value FROM top_val)
      ORDER BY gp DESC
    `).all(...p);
    if (rows.some(r => r.name === name)) {
      const myRow = rows.find(r => r.name === name);
      if (myRow.value === 0 || myRow.value === null) return;
      const co_holders = rows.filter(r => r.name !== name).map(r => r.name);
      holdings.push({ category, label, value: myRow.value, league_type: leagueType || 'all', season_type: seasonType, scope: 'league', co_holders });
    }
  }

  async function checkSeasonRecord(label, agg, pos, orderDir, leagueType, category, minGP, stFilter, seasonType) {
    const where = pos === 'G' ? "gps.position = 'G'" : "gps.position != 'G'";
    const ltFilter = leagueType ? "AND COALESCE(s.league_type,'') = ?" : '';
    const p = leagueType ? [leagueType] : [];
    const having = minGP ? 'HAVING COUNT(DISTINCT gps.game_id) >= ?' : '';
    const params = minGP ? [...p, minGP] : p;
    const rows = await db.prepare(`
      WITH agg_vals AS (
        SELECT gps.player_name AS name, g.season_id, MAX(COALESCE(s.name,'No Season')) AS season_name,
          ${agg} AS value, COUNT(DISTINCT gps.game_id) AS gp
        FROM game_player_stats gps
        JOIN games g ON gps.game_id = g.id
        LEFT JOIN seasons s ON g.season_id = s.id
        WHERE ${where} AND g.status IN ('complete','forfeit') ${ltFilter} ${stFilter}
        GROUP BY gps.player_name, g.season_id ${having}
      ),
      top_val AS (SELECT value FROM agg_vals ORDER BY value ${orderDir} LIMIT 1)
      SELECT * FROM agg_vals WHERE value = (SELECT value FROM top_val)
      ORDER BY gp DESC
    `).all(...params);
    if (rows.some(r => r.name === name)) {
      const myRow = rows.find(r => r.name === name);
      if (myRow.value === 0 || myRow.value === null) return;
      const co_holders = rows.filter(r => r.name !== name).map(r => r.name);
      holdings.push({ category, label, value: myRow.value, season_name: myRow.season_name, league_type: leagueType || 'all', season_type: seasonType, scope: 'league', co_holders });
    }
  }

  async function checkSingleGameRecord(label, col, pos, orderDir, leagueType, category, stFilter, seasonType) {
    const where = pos === 'G' ? "gps.position = 'G'" : "gps.position != 'G'";
    const ltFilter = leagueType ? "AND COALESCE(s.league_type,'') = ?" : '';
    const p = leagueType ? [leagueType] : [];
    const rows = await db.prepare(`
      WITH game_vals AS (
        SELECT gps.player_name AS name, gps.${col} AS value,
          g.id AS game_id, g.date,
          ht.name AS home_team, at2.name AS away_team
        FROM game_player_stats gps
        JOIN games g ON gps.game_id = g.id
        JOIN teams ht ON g.home_team_id = ht.id
        JOIN teams at2 ON g.away_team_id = at2.id
        LEFT JOIN seasons s ON g.season_id = s.id
        WHERE ${where} AND g.status IN ('complete','forfeit') ${ltFilter} ${stFilter}
      ),
      top_val AS (SELECT value FROM game_vals ORDER BY value ${orderDir} LIMIT 1)
      SELECT * FROM game_vals WHERE value = (SELECT value FROM top_val)
      ORDER BY date DESC
    `).all(...p);
    if (rows.some(r => r.name === name)) {
      const myRow = rows.find(r => r.name === name);
      if (myRow.value === 0 || myRow.value === null) return;
      const co_holders = rows.filter(r => r.name !== name).map(r => r.name);
      holdings.push({ category, label, value: myRow.value, game_id: myRow.game_id, home_team: myRow.home_team, away_team: myRow.away_team, date: myRow.date, league_type: leagueType || 'all', season_type: seasonType, scope: 'league', co_holders });
    }
  }

  // League records per league_type × season_type
  const SEASON_TYPES = [
    { st: 'regular',  stFilter: 'AND g.playoff_series_id IS NULL' },
    { st: 'playoffs', stFilter: 'AND g.playoff_series_id IS NOT NULL' },
  ];
  for (const lt of ['threes', 'sixes']) {
    for (const { st, stFilter } of SEASON_TYPES) {
      // All-time skater records
      await checkLeagueRecord('Career GP',              "COUNT(DISTINCT gps.game_id)",     'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Pts',             "SUM(gps.goals+gps.assists)",      'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Goals',           "SUM(gps.goals)",                  'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Assists',         "SUM(gps.assists)",                'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career +/-',             "SUM(gps.plus_minus)",             'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Hits',            "SUM(gps.hits)",                   'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Shots',           "SUM(gps.shots)",                  'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Shot Attempts',   "SUM(gps.shot_attempts)",          'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Blocked Shots',   "SUM(gps.blocked_shots)",          'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career PIM',             "SUM(gps.pim)",                    'S', 'DESC', lt, 'alltime', stFilter, st);
      if (lt !== 'threes') {
        await checkLeagueRecord('Career PP Goals',      "SUM(gps.pp_goals)",               'S', 'DESC', lt, 'alltime', stFilter, st);
        await checkLeagueRecord('Career SH Goals',      "SUM(gps.sh_goals)",               'S', 'DESC', lt, 'alltime', stFilter, st);
      }
      await checkLeagueRecord('Career GWG',             "SUM(gps.gwg)",                    'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Hat Tricks',      "SUM(gps.hat_tricks)",             'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Faceoff Wins',    "SUM(gps.faceoff_wins)",           'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Deflections',     "SUM(gps.deflections)",            'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Interceptions',   "SUM(gps.interceptions)",          'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Takeaways',       "SUM(gps.takeaways)",              'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Giveaways',       "SUM(gps.giveaways)",              'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Pass Completions',"SUM(gps.pass_completions)",       'S', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Penalties Drawn', "SUM(gps.penalties_drawn)",        'S', 'DESC', lt, 'alltime', stFilter, st);
      if (lt !== 'threes') {
        await checkLeagueRecord('Career PK Clears',     "SUM(gps.pk_clears)",              'S', 'DESC', lt, 'alltime', stFilter, st);
      }
      // All-time goalie records
      await checkLeagueRecord('Career GP',              "COUNT(DISTINCT gps.game_id)",     'G', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Wins',            "SUM(gps.goalie_wins)",            'G', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Saves',           "SUM(gps.saves)",                  'G', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Shutouts',        "SUM(gps.shutouts)",               'G', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career PSS',             "SUM(gps.penalty_shot_attempts) - SUM(gps.penalty_shot_ga)",  'G', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career BKSV',            "SUM(gps.breakaway_saves)",        'G', 'DESC', lt, 'alltime', stFilter, st);
      await checkLeagueRecord('Career Goals Against',   "SUM(gps.goals_against)",          'G', 'DESC', lt, 'alltime', stFilter, st);
      // Seasonal skater records
      await checkSeasonRecord('Season Pts',             "SUM(gps.goals+gps.assists)",      'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Goals',           "SUM(gps.goals)",                  'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Assists',         "SUM(gps.assists)",                'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season +/-',             "SUM(gps.plus_minus)",             'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Hits',            "SUM(gps.hits)",                   'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Shots',           "SUM(gps.shots)",                  'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Shot Attempts',   "SUM(gps.shot_attempts)",          'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Blocked Shots',   "SUM(gps.blocked_shots)",          'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season PIM',             "SUM(gps.pim)",                    'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      if (lt !== 'threes') {
        await checkSeasonRecord('Season PP Goals',      "SUM(gps.pp_goals)",               'S', 'DESC', lt, 'seasonal', null, stFilter, st);
        await checkSeasonRecord('Season SH Goals',      "SUM(gps.sh_goals)",               'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      }
      await checkSeasonRecord('Season GWG',             "SUM(gps.gwg)",                    'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Hat Tricks',      "SUM(gps.hat_tricks)",             'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Faceoff Wins',    "SUM(gps.faceoff_wins)",           'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Deflections',     "SUM(gps.deflections)",            'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Interceptions',   "SUM(gps.interceptions)",          'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Takeaways',       "SUM(gps.takeaways)",              'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Giveaways',       "SUM(gps.giveaways)",              'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Pass Completions',"SUM(gps.pass_completions)",       'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Penalties Drawn', "SUM(gps.penalties_drawn)",        'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      if (lt !== 'threes') {
        await checkSeasonRecord('Season PK Clears',     "SUM(gps.pk_clears)",              'S', 'DESC', lt, 'seasonal', null, stFilter, st);
      }
      // Seasonal goalie records
      await checkSeasonRecord('Season Wins',            "SUM(gps.goalie_wins)",            'G', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Saves',           "SUM(gps.saves)",                  'G', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Shutouts',        "SUM(gps.shutouts)",               'G', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season PSS',             "SUM(gps.penalty_shot_attempts) - SUM(gps.penalty_shot_ga)",  'G', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season BKSV',            "SUM(gps.breakaway_saves)",        'G', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Goals Against',   "SUM(gps.goals_against)",          'G', 'DESC', lt, 'seasonal', null, stFilter, st);
      await checkSeasonRecord('Season Save%',           "CASE WHEN SUM(gps.shots_against)>0 THEN ROUND(CAST(SUM(gps.saves) AS NUMERIC)/SUM(gps.shots_against),3) ELSE NULL END", 'G', 'DESC', lt, 'seasonal', goalieSeasonMinGP, stFilter, st);
      // Single-game skater records
      await checkSingleGameRecord('Single Game Goals',            'goals',              'S', 'DESC', lt, 'singlegame', stFilter, st);
      await checkSingleGameRecord('Single Game Assists',          'assists',            'S', 'DESC', lt, 'singlegame', stFilter, st);
      await checkSingleGameRecord('Single Game +/-',              'plus_minus',         'S', 'DESC', lt, 'singlegame', stFilter, st);
      await checkSingleGameRecord('Single Game Hits',             'hits',               'S', 'DESC', lt, 'singlegame', stFilter, st);
      await checkSingleGameRecord('Single Game Shots',            'shots',              'S', 'DESC', lt, 'singlegame', stFilter, st);
      await checkSingleGameRecord('Single Game Shot Attempts',    'shot_attempts',      'S', 'DESC', lt, 'singlegame', stFilter, st);
      await checkSingleGameRecord('Single Game Blocked Shots',    'blocked_shots',      'S', 'DESC', lt, 'singlegame', stFilter, st);
      await checkSingleGameRecord('Single Game PIM',              'pim',                'S', 'DESC', lt, 'singlegame', stFilter, st);
      if (lt !== 'threes') {
        await checkSingleGameRecord('Single Game PP Goals',       'pp_goals',           'S', 'DESC', lt, 'singlegame', stFilter, st);
        await checkSingleGameRecord('Single Game SH Goals',       'sh_goals',           'S', 'DESC', lt, 'singlegame', stFilter, st);
      }
      await checkSingleGameRecord('Single Game Faceoff Wins',     'faceoff_wins',       'S', 'DESC', lt, 'singlegame', stFilter, st);
      await checkSingleGameRecord('Single Game Deflections',      'deflections',        'S', 'DESC', lt, 'singlegame', stFilter, st);
      await checkSingleGameRecord('Single Game Interceptions',    'interceptions',      'S', 'DESC', lt, 'singlegame', stFilter, st);
      await checkSingleGameRecord('Single Game Takeaways',        'takeaways',          'S', 'DESC', lt, 'singlegame', stFilter, st);
      await checkSingleGameRecord('Single Game Giveaways',        'giveaways',          'S', 'DESC', lt, 'singlegame', stFilter, st);
      await checkSingleGameRecord('Single Game Pass Completions', 'pass_completions',   'S', 'DESC', lt, 'singlegame', stFilter, st);
      await checkSingleGameRecord('Single Game Penalties Drawn',  'penalties_drawn',    'S', 'DESC', lt, 'singlegame', stFilter, st);
      if (lt !== 'threes') {
        await checkSingleGameRecord('Single Game PK Clears',      'pk_clears',          'S', 'DESC', lt, 'singlegame', stFilter, st);
      }
      // Single-game goalie records
      await checkSingleGameRecord('Single Game Saves',        'saves',                                    'G', 'DESC', lt, 'singlegame', stFilter, st);
      await checkSingleGameRecord('Single Game PSS',          'penalty_shot_attempts - gps.penalty_shot_ga', 'G', 'DESC', lt, 'singlegame', stFilter, st);
      await checkSingleGameRecord('Single Game BKSV',         'breakaway_saves',                          'G', 'DESC', lt, 'singlegame', stFilter, st);
      await checkSingleGameRecord('Single Game Goals Against','goals_against',                             'G', 'DESC', lt, 'singlegame', stFilter, st);

      // Single-game pts (goals+assists) – computed expression
      const ltFilterPts = 'AND COALESCE(s.league_type,\'\') = ?';
      const ptsRows = await db.prepare(`
        WITH game_vals AS (
          SELECT gps.player_name AS name, (gps.goals+gps.assists) AS value,
            g.id AS game_id, g.date,
            ht.name AS home_team, at2.name AS away_team
          FROM game_player_stats gps
          JOIN games g ON gps.game_id = g.id
          JOIN teams ht ON g.home_team_id = ht.id
          JOIN teams at2 ON g.away_team_id = at2.id
          LEFT JOIN seasons s ON g.season_id = s.id
          WHERE gps.position != 'G' AND g.status IN ('complete','forfeit') ${ltFilterPts} ${stFilter}
        ),
        top_val AS (SELECT value FROM game_vals ORDER BY value DESC LIMIT 1)
        SELECT * FROM game_vals WHERE value = (SELECT value FROM top_val)
        ORDER BY date DESC
      `).all(lt);
      if (ptsRows.some(r => r.name === name)) {
        const myRow = ptsRows.find(r => r.name === name);
        if (myRow.value !== 0) {
          const co_holders = ptsRows.filter(r => r.name !== name).map(r => r.name);
          holdings.push({ category: 'singlegame', label: 'Single Game Pts', value: myRow.value, game_id: myRow.game_id, home_team: myRow.home_team, away_team: myRow.away_team, date: myRow.date, league_type: lt, season_type: st, scope: 'league', co_holders });
        }
      }
    }
  }

  res.json({ holdings });
});

// ── Players ────────────────────────────────────────────────────────────────

app.get('/api/players', async (_req, res) => {
  const players = await db.prepare(`
    SELECT p.*, t.name AS team_name, u.username, u.platform
    FROM players p LEFT JOIN teams t ON p.team_id = t.id LEFT JOIN users u ON p.user_id = u.id
    ORDER BY t.name, p.name
  `).all();
  res.json(players);
});

// ── Player public profile (career stats by name) ───────────────────────────

app.get('/api/players/profile/:name', async (req, res) => {
  const name = req.params.name;

  // Current roster info + user account if linked
  const player = await db.prepare(`
    SELECT p.id, p.name, p.position AS player_position, p.is_rostered, p.number,
      t.id AS team_id, t.name AS team_name, t.logo_url AS team_logo, t.color1, t.color2,
      u.platform, u.position AS user_position, u.discord
    FROM players p
    LEFT JOIN teams t ON p.team_id = t.id
    LEFT JOIN users u ON p.user_id = u.id
    WHERE p.name = ? ORDER BY p.is_rostered DESC LIMIT 1
  `).get(name);

  // Detect position from stats (majority position recorded in game logs)
  const posRow = await db.prepare(`
    SELECT position, COUNT(*) AS cnt
    FROM game_player_stats WHERE player_name = ?
    GROUP BY position ORDER BY cnt DESC LIMIT 1
  `).get(name);
  const isGoalie = posRow && posRow.position === 'G';

  // Per-season per-team splits – always fetch both modes
  const rawGoalieStats = await db.prepare(`
      SELECT g.season_id, MAX(COALESCE(s.name,'No Season')) AS season_name,
        MAX(COALESCE(s.league_type,'')) AS league_type,
        MAX(COALESCE(s.sort_order, g.season_id)) AS _sort_order,
        CASE WHEN g.playoff_series_id IS NOT NULL THEN 1 ELSE 0 END AS is_playoff,
        ${GOALIE_SELECT}
      FROM game_player_stats gps
      JOIN teams t ON gps.team_id = t.id
      JOIN games g ON gps.game_id = g.id
      LEFT JOIN seasons s ON g.season_id = s.id
      WHERE gps.player_name = ? AND gps.position = 'G' AND g.status IN ('complete','forfeit')
      GROUP BY g.season_id, gps.team_id, CASE WHEN g.playoff_series_id IS NOT NULL THEN 1 ELSE 0 END
      ORDER BY MAX(COALESCE(s.sort_order, g.season_id)) DESC, CASE WHEN g.playoff_series_id IS NOT NULL THEN 1 ELSE 0 END
    `).all(name);

  const rawSkaterStats = await db.prepare(`
      SELECT g.season_id, MAX(COALESCE(s.name,'No Season')) AS season_name,
        MAX(COALESCE(s.league_type,'')) AS league_type,
        MAX(COALESCE(s.sort_order, g.season_id)) AS _sort_order,
        CASE WHEN g.playoff_series_id IS NOT NULL THEN 1 ELSE 0 END AS is_playoff,
        ${SKATER_SELECT}
      FROM game_player_stats gps
      JOIN teams t ON gps.team_id = t.id
      JOIN games g ON gps.game_id = g.id
      LEFT JOIN seasons s ON g.season_id = s.id
      WHERE gps.player_name = ? AND gps.position != 'G' AND g.status IN ('complete','forfeit')
      GROUP BY g.season_id, gps.team_id, CASE WHEN g.playoff_series_id IS NOT NULL THEN 1 ELSE 0 END
      ORDER BY MAX(COALESCE(s.sort_order, g.season_id)) DESC, CASE WHEN g.playoff_series_id IS NOT NULL THEN 1 ELSE 0 END
    `).all(name);

  // Last 5 games
  const lastGames = await db.prepare(`
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
      gps.overall_rating,
      CASE WHEN gps.team_id = g.home_team_id THEN g.home_score ELSE g.away_score END AS goal_support,
      COALESCE(s.league_type,'') AS league_type,
      CASE WHEN g.playoff_series_id IS NOT NULL THEN 1 ELSE 0 END AS is_playoff
    FROM game_player_stats gps
    JOIN games g ON gps.game_id = g.id
    JOIN teams ht ON g.home_team_id = ht.id
    JOIN teams at ON g.away_team_id = at.id
    LEFT JOIN seasons s ON g.season_id = s.id
    WHERE gps.player_name = ? AND g.status IN ('complete','forfeit')
    ORDER BY g.date DESC, g.id DESC LIMIT 5
  `).all(name);

  // Historical season stats (from season_player_stats, for imported seasons)
  const historicalStats = await db.prepare(`
    SELECT sps.season_id, COALESCE(s.name,'No Season') AS season_name,
      COALESCE(s.league_type,'') AS league_type,
      COALESCE(s.sort_order, sps.season_id) AS _sort_order,
      t.id AS team_id, COALESCE(t.name,'FA') AS team_name,
      t.logo_url AS team_logo, t.color1 AS team_color1, t.color2 AS team_color2,
      sps.position, sps.games_played AS gp,
      sps.goals, sps.assists, (sps.goals + sps.assists) AS points,
      sps.plus_minus, sps.pim, sps.shots, sps.pp_goals, sps.sh_goals, sps.gwg,
      sps.saves, sps.save_pct, sps.goals_against,
      sps.goalie_wins, sps.goalie_losses, sps.shutouts, sps.gaa,
      0 AS is_playoff, 1 AS is_historical
    FROM season_player_stats sps
    LEFT JOIN seasons s ON s.id = sps.season_id
    LEFT JOIN teams t ON t.id = sps.team_id
    WHERE sps.player_name = ?
    ORDER BY COALESCE(s.sort_order, sps.season_id) DESC
  `).all(name);

  // Merge historical rows for seasons not already covered by game stats
  async function mergeWithHistorical(gameStats, histFilter) {
    const covered = new Set(gameStats.map(r => r.season_id));
    const merged = [
      ...gameStats.map(r => ({ ...r, is_historical: 0 })),
      ...historicalStats.filter(r => histFilter(r) && !covered.has(r.season_id)),
    ];
    merged.sort((a, b) => (b._sort_order || b.season_id || 0) - (a._sort_order || a.season_id || 0));
    return merged;
  }

  const goalieStats  = await mergeWithHistorical(rawGoalieStats,  r => r.position === 'G');
  const skaterStats  = await mergeWithHistorical(rawSkaterStats,  r => r.position !== 'G');
  // Keep seasonTeamStats for backward compat (used for 404 check + hero stats)
  const seasonTeamStats = isGoalie ? goalieStats : skaterStats;

  if (!player && skaterStats.length === 0 && goalieStats.length === 0) {
    return res.status(404).json({ error: 'Player not found' });
  }

  res.json({ player: player || null, isGoalie, skaterStats, goalieStats, seasonTeamStats, lastGames });
});

// List all registered users (for admin to pick an owner / for GMs to sign players)
app.get('/api/users', requireOwner, async (_req, res) => {
  const users = await db.prepare(`
    SELECT u.id, u.username, u.platform, u.email, u.position, u.discord, u.created_at,
      p.team_id, t.name AS team_name, p.is_rostered
    FROM users u LEFT JOIN players p ON p.user_id = u.id LEFT JOIN teams t ON p.team_id = t.id
    ORDER BY u.username
  `).all();
  res.json(users);
});

// Players endpoint for GM use (free agents = no current roster)
app.get('/api/users/free-agents', requirePlayer, async (_req, res) => {
  const fa = await db.prepare(`
    SELECT u.id, u.username, u.platform, u.position
    FROM users u
    LEFT JOIN players p ON p.user_id = u.id AND p.is_rostered = 1
    WHERE p.id IS NULL
    ORDER BY u.username
  `).all();
  res.json(fa);
});

app.post('/api/players', requireOwner, async (req, res) => {
  const { name, team_id, position, number, discord, discord_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const result = await db.prepare('INSERT INTO players (name, team_id, position, number, is_rostered, discord, discord_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, team_id || null, position || null, number || null, team_id ? 1 : 0, discord || null, discord_id || null);
  res.status(201).json({ id: result.lastInsertRowid, name, team_id, position, number, discord, discord_id });
});

app.delete('/api/players/:id', requireOwner, async (req, res) => {
  const result = await db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Player not found' });
  res.json({ deleted: true });
});

app.patch('/api/players/:id', requireOwner, async (req, res) => {
  const player = await db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  const name       = req.body.name       !== undefined ? (req.body.name || player.name)        : player.name;
  const team_id    = req.body.team_id    !== undefined ? (req.body.team_id || null)             : player.team_id;
  const is_rostered = req.body.is_rostered !== undefined ? Number(req.body.is_rostered)         : player.is_rostered;
  const position   = req.body.position   !== undefined ? (req.body.position || null)            : player.position;
  const number     = req.body.number     !== undefined ? (req.body.number || null)              : player.number;
  const discord    = req.body.discord    !== undefined ? (req.body.discord || null)             : player.discord;
  const discord_id = req.body.discord_id !== undefined ? (req.body.discord_id || null)          : player.discord_id;
  // user_id: allow explicit null to unlink, or a valid user id to link
  let user_id = player.user_id;
  if (req.body.user_id !== undefined) {
    if (req.body.user_id === null || req.body.user_id === '' || req.body.user_id === 0) {
      user_id = null;
    } else {
      const uid = Number(req.body.user_id);
      if (!isNaN(uid) && uid > 0) {
        const userExists = await db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
        if (!userExists) return res.status(400).json({ error: 'User not found' });
        user_id = uid;
      }
    }
  }
  await db.prepare('UPDATE players SET name=?, team_id=?, is_rostered=?, position=?, number=?, discord=?, discord_id=?, user_id=? WHERE id=?')
    .run(name, team_id, is_rostered, position, number, discord, discord_id, user_id, req.params.id);
  res.json({ ok: true });
});

// ── Games ──────────────────────────────────────────────────────────────────

/** Validate and normalise a game_time string (HH:MM UTC) or return null. */
function parseGameTime(t) {
  return t && /^\d{2}:\d{2}$/.test(t) ? t : null;
}

app.get('/api/games', async (req, res) => {
  const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
  const status   = req.query.status   || null;
  const limit    = req.query.limit    ? Math.min(Number(req.query.limit), 100) : null;
  const conditions = [];
  const params = [];
  if (seasonId) { conditions.push('g.season_id = ?'); params.push(seasonId); }
  if (status)   { conditions.push('g.status = ?');    params.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = limit ? `LIMIT ${limit}` : '';
  const games = await db.prepare(`
    SELECT g.*, ht.name AS home_team_name, ht.logo_url AS home_logo,
      at.name AS away_team_name, at.logo_url AS away_logo,
      ps.round_number AS playoff_round_number
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.id
    JOIN teams at ON g.away_team_id = at.id
    LEFT JOIN playoff_series ps ON g.playoff_series_id = ps.id
    ${where} ORDER BY g.date ASC ${limitClause}
  `).all(...params);
  res.json(games);
});

app.post('/api/games', requireAdmin, async (req, res) => {
  const { home_team_id, away_team_id, home_score, away_score, date, season_id, status, is_overtime, playoff_series_id, game_time } = req.body;
  if (!home_team_id || !away_team_id || !date) return res.status(400).json({ error: 'home_team_id, away_team_id, and date are required' });
  const gameStatus = status === 'complete' ? 'complete' : 'scheduled';
  const ot = is_overtime ? 1 : 0;
  const psi = playoff_series_id ? Number(playoff_series_id) : null;
  const gt = parseGameTime(game_time);
  const result = await db.prepare(
    'INSERT INTO games (home_team_id, away_team_id, home_score, away_score, date, status, season_id, is_overtime, playoff_series_id, game_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(home_team_id, away_team_id, home_score || 0, away_score || 0, date, gameStatus, season_id || null, ot, psi, gt);
  res.status(201).json({ id: result.lastInsertRowid, home_team_id, away_team_id, home_score: home_score || 0, away_score: away_score || 0, date, status: gameStatus, season_id: season_id || null, is_overtime: ot, playoff_series_id: psi, game_time: gt });
});

app.delete('/api/games/:id', requireAdmin, async (req, res) => {
  await db.prepare('DELETE FROM game_player_stats WHERE game_id = ?').run(req.params.id);
  const result = await db.prepare('DELETE FROM games WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Game not found' });
  res.json({ deleted: true });
});

app.patch('/api/games/:id', requireAdmin, async (req, res) => {
  const game = await db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  let home_score = game.home_score, away_score = game.away_score;
  const ea_match_id = req.body.ea_match_id !== undefined ? req.body.ea_match_id : game.ea_match_id;
  const status = req.body.status !== undefined ? req.body.status : game.status;
  const season_id = req.body.season_id !== undefined ? req.body.season_id : game.season_id;
  const is_overtime = req.body.is_overtime !== undefined ? (req.body.is_overtime ? 1 : 0) : (game.is_overtime || 0);
  const is_forfeit  = req.body.is_forfeit  !== undefined ? (req.body.is_forfeit  ? 1 : 0) : (game.is_forfeit  || 0);
  const date = req.body.date !== undefined ? req.body.date : game.date;
  const game_time = req.body.game_time !== undefined ? parseGameTime(req.body.game_time) : game.game_time;
  if (req.body.home_score !== undefined) {
    home_score = parseInt(req.body.home_score, 10);
    if (isNaN(home_score) || home_score < 0 || home_score > 99) return res.status(400).json({ error: 'home_score must be 0–99' });
  }
  if (req.body.away_score !== undefined) {
    away_score = parseInt(req.body.away_score, 10);
    if (isNaN(away_score) || away_score < 0 || away_score > 99) return res.status(400).json({ error: 'away_score must be 0–99' });
  }
  await db.prepare('UPDATE games SET home_score=?, away_score=?, ea_match_id=?, status=?, season_id=?, is_overtime=?, is_forfeit=?, date=?, game_time=? WHERE id=?')
    .run(home_score, away_score, ea_match_id, status, season_id, is_overtime, is_forfeit, date, game_time, req.params.id);

  // Auto-update the playoff series bracket whenever a playoff game is completed or updated
  const effectiveSeries = req.body.playoff_series_id !== undefined
    ? (req.body.playoff_series_id ? Number(req.body.playoff_series_id) : null)
    : game.playoff_series_id;
  if (effectiveSeries && (status === 'complete' || status === 'forfeit')) {
    await recomputeSeriesWins(effectiveSeries);
  }

  if (req.body.player_stats) {
    const { home_players, away_players } = req.body.player_stats;
    await db.prepare('DELETE FROM game_player_stats WHERE game_id = ?').run(req.params.id);
    const ins = await db.prepare(`INSERT INTO game_player_stats
      (game_id,team_id,player_name,position,
       overall_rating,offensive_rating,defensive_rating,team_play_rating,
       goals,assists,shots,shot_attempts,hits,plus_minus,pim,blocked_shots,takeaways,giveaways,
       possession_secs,pass_attempts,pass_completions,pass_pct,
       faceoff_wins,faceoff_losses,pp_goals,sh_goals,gwg,penalties_drawn,
       deflections,interceptions,hat_tricks,toi,
       saves,save_pct,goals_against,shots_against,
       goalie_wins,goalie_losses,goalie_otw,goalie_otl,
       shutouts,penalty_shot_attempts,penalty_shot_ga,breakaway_shots,breakaway_saves,
       saucer_passes,pk_clears,desperation_saves,poke_check_saves)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
          p.breakawayShots||0, p.breakawaySaves||0,
          p.saucerPasses||0, p.pkClears||0, p.desperationSaves||0, p.pokeCheckSaves||0
        );
      }
    };
    saveList(home_players, game.home_team_id, homeWon);
    saveList(away_players, game.away_team_id, awayWon);
  }
  if (req.body.ea_match_id === null && !req.body.player_stats) {
    await db.prepare('DELETE FROM game_player_stats WHERE game_id = ?').run(req.params.id);
  }
  res.json({ updated: true });
});

// ── Saved game stats ───────────────────────────────────────────────────────

app.get('/api/games/:id/stats', async (req, res) => {
  const game = await db.prepare(`
    SELECT g.*, ht.name AS home_team_name, ht.logo_url AS home_logo,
      ht.color1 AS home_color1, ht.color2 AS home_color2,
      at.name AS away_team_name, at.logo_url AS away_logo,
      at.color1 AS away_color1, at.color2 AS away_color2
    FROM games g JOIN teams ht ON g.home_team_id = ht.id JOIN teams at ON g.away_team_id = at.id
    WHERE g.id = ?
  `).get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const stats = await db.prepare('SELECT * FROM game_player_stats WHERE game_id = ? ORDER BY position, goals DESC').all(req.params.id);
  res.json({
    game: {
      id: game.id, date: game.date, status: game.status, season_id: game.season_id, is_overtime: game.is_overtime,
      home_team: { id: game.home_team_id, name: game.home_team_name, logo_url: game.home_logo, color1: game.home_color1 || null, color2: game.home_color2 || null },
      away_team: { id: game.away_team_id, name: game.away_team_name, logo_url: game.away_logo, color1: game.away_color1 || null, color2: game.away_color2 || null },
      home_score: game.home_score, away_score: game.away_score, ea_match_id: game.ea_match_id,
    },
    home_players: stats.filter(s => s.team_id === game.home_team_id),
    away_players: stats.filter(s => s.team_id === game.away_team_id),
    has_stats: stats.length > 0,
  });
});

// ── League stats leaders ───────────────────────────────────────────────────

app.get('/api/stats/leaders', async (req, res) => {
  const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
  const leagueType = req.query.league_type || null;
  const isPlayoff = req.query.is_playoff; // '0' = regular only, '1' = playoff only

  let sf = '';
  let extraJoin = '';
  const p = [];

  if (seasonId) {
    sf = 'AND g.season_id = ?';
    p.push(seasonId);
  } else if (leagueType) {
    // All-time query filtered by league type and optionally regular/playoff
    extraJoin = 'LEFT JOIN seasons s ON g.season_id = s.id';
    sf = 'AND s.league_type = ?';
    p.push(leagueType);
    if (isPlayoff === '1') {
      sf += ' AND g.playoff_series_id IS NOT NULL';
    } else if (isPlayoff === '0') {
      sf += ' AND g.playoff_series_id IS NULL';
    }
  }

  // Goalie stats min GP setting
  const minGPRow = await db.prepare("SELECT value FROM settings WHERE key = 'goalie_stats_min_gp'").get();
  const goalieStatsMinGP = minGPRow ? (parseInt(minGPRow.value, 10) || 5) : 5;

  // Current-team subquery: pick the rostered player record per name (prefer user-linked row, then highest id)
  const rosterSub = `(
    SELECT DISTINCT ON (name) name, team_id FROM players
    WHERE is_rostered = 1
    ORDER BY name, (user_id IS NOT NULL) DESC, id DESC
  ) rp`;

  const skaters = await db.prepare(`
    SELECT
      gps.player_name AS name,
      MAX(rp.team_id) AS team_id,
      MAX(COALESCE(t.name, 'FA')) AS team_name,
      MAX(t.logo_url) AS team_logo,
      MAX(t.color1) AS team_color1,
      MAX(t.color2) AS team_color2,
      COALESCE(MAX(u.position), MAX(gps.position)) AS position,
      COUNT(DISTINCT gps.game_id) AS gp,
      ROUND(AVG(CASE WHEN gps.overall_rating > 0 THEN CAST(gps.overall_rating AS NUMERIC)
                     WHEN GREATEST(gps.offensive_rating, gps.defensive_rating, gps.team_play_rating) > 0
                       THEN GREATEST(0.0, LEAST(99.0,
                         CASE WHEN gps.position ILIKE '%defense%'
                           THEN (CAST(gps.offensive_rating AS NUMERIC)
                                 + CAST(gps.defensive_rating AS NUMERIC) * 2.0
                                 + CAST(gps.team_play_rating AS NUMERIC) * 1.5) / 4.5
                           ELSE (CAST(gps.offensive_rating AS NUMERIC) * 2.0
                                 + CAST(gps.defensive_rating AS NUMERIC)
                                 + CAST(gps.team_play_rating AS NUMERIC) * 1.5) / 4.5
                         END
                       ))
                     ELSE GREATEST(0.0, LEAST(99.0,
                       60.0
                       + LEAST(CAST(gps.goals AS NUMERIC) * 7.0, 21.0)
                       + LEAST(CAST(gps.assists AS NUMERIC) * 4.0, 14.0)
                       + GREATEST(LEAST(CAST(gps.plus_minus AS NUMERIC) * 3.0, 12.0), -12.0)
                       + LEAST(CAST(gps.shots AS NUMERIC) * 0.5, 5.0)
                       + LEAST(CAST(gps.hits AS NUMERIC) * 0.5, 5.0)
                       + LEAST(CAST(gps.blocked_shots AS NUMERIC) * 1.5, 6.0)
                       + LEAST(CAST(gps.takeaways AS NUMERIC) * 1.5, 6.0)
                       - LEAST(CAST(gps.giveaways AS NUMERIC) * 2.0, 8.0)
                       - LEAST(CAST(gps.pim AS NUMERIC) * 0.5, 5.0)
                     ))
                END), 0) AS overall_rating,
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
        THEN ROUND(CAST(SUM(gps.possession_secs) AS NUMERIC)/COUNT(DISTINCT gps.game_id),0)
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
      SUM(gps.hat_tricks) AS hat_tricks,
      SUM(gps.saucer_passes) AS saucer_passes,
      SUM(gps.pk_clears) AS pk_clears,
      SUM(CASE WHEN (gps.team_id = g.home_team_id AND g.home_score > g.away_score)
                 OR (gps.team_id = g.away_team_id AND g.away_score > g.home_score) THEN 1 ELSE 0 END) AS player_wins,
      SUM(CASE WHEN ((gps.team_id = g.home_team_id AND g.home_score < g.away_score)
                  OR (gps.team_id = g.away_team_id AND g.away_score < g.home_score))
               AND (g.is_overtime IS NULL OR g.is_overtime = 0) THEN 1 ELSE 0 END) AS player_losses,
      SUM(CASE WHEN ((gps.team_id = g.home_team_id AND g.home_score < g.away_score)
                  OR (gps.team_id = g.away_team_id AND g.away_score < g.home_score))
               AND g.is_overtime = 1 THEN 1 ELSE 0 END) AS player_otl,
      SUM(CASE WHEN gps.team_id = g.home_team_id THEN g.home_score ELSE g.away_score END) AS goal_support
    FROM game_player_stats gps
    JOIN games g ON gps.game_id = g.id
    ${extraJoin}
    LEFT JOIN ${rosterSub} ON rp.name = gps.player_name
    LEFT JOIN teams t ON t.id = rp.team_id
    LEFT JOIN users u ON u.username = gps.player_name
    WHERE gps.position != 'G' AND g.status IN ('complete','forfeit') ${sf}
    GROUP BY gps.player_name ORDER BY points DESC, goals DESC
  `).all(...p);

  const goalies = await db.prepare(`
    SELECT
      gps.player_name AS name,
      MAX(rp.team_id) AS team_id,
      MAX(COALESCE(t.name, 'FA')) AS team_name,
      MAX(t.logo_url) AS team_logo,
      MAX(t.color1) AS team_color1,
      MAX(t.color2) AS team_color2,
      COUNT(DISTINCT gps.game_id) AS gp,
      SUM(gps.goals) AS goals, SUM(gps.assists) AS assists,
      SUM(gps.shots_against) AS shots_against,
      SUM(gps.goals_against) AS goals_against,
      SUM(gps.saves) AS saves,
      CASE WHEN SUM(gps.shots_against) > 0
        THEN ROUND(CAST(SUM(gps.saves) AS NUMERIC)/SUM(gps.shots_against),3)
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
      SUM(gps.desperation_saves) AS desperation_saves,
      SUM(gps.poke_check_saves) AS poke_check_saves,
      SUM(gps.goalie_wins) AS goalie_wins,
      SUM(gps.goalie_losses) AS goalie_losses,
      SUM(gps.goalie_otw) AS goalie_otw,
      SUM(gps.goalie_otl) AS goalie_otl,
      ROUND(AVG(CASE WHEN gps.overall_rating > 0 THEN CAST(gps.overall_rating AS NUMERIC)
                     WHEN GREATEST(gps.defensive_rating, gps.offensive_rating, gps.team_play_rating) > 0
                       THEN GREATEST(0.0, LEAST(99.0,
                         (CAST(gps.defensive_rating AS NUMERIC) * 2.0
                          + CAST(gps.offensive_rating AS NUMERIC)
                          + CAST(gps.team_play_rating AS NUMERIC) * 1.5) / 4.5
                       ))
                     WHEN gps.shots_against > 0 THEN GREATEST(0.0, LEAST(99.0,
                       60.0
                       + (CAST(gps.shots_against - gps.goals_against AS NUMERIC) / CAST(gps.shots_against AS NUMERIC) * 100.0 - 88.0) * 3.0
                       + CASE WHEN gps.goals_against = 0 THEN 8.0 ELSE 0.0 END
                     ))
                     ELSE 60.0
                END), 0) AS overall_rating,
      ROUND(AVG(NULLIF(gps.offensive_rating,0)),0)  AS offensive_rating,
      ROUND(AVG(NULLIF(gps.defensive_rating,0)),0)  AS defensive_rating,
      ROUND(AVG(NULLIF(gps.team_play_rating,0)),0)  AS team_play_rating,
      SUM(CASE WHEN gps.team_id = g.home_team_id THEN g.home_score ELSE g.away_score END) AS goal_support
    FROM game_player_stats gps
    JOIN games g ON gps.game_id = g.id
    ${extraJoin}
    LEFT JOIN ${rosterSub} ON rp.name = gps.player_name
    LEFT JOIN teams t ON t.id = rp.team_id
    WHERE gps.position = 'G' AND g.status IN ('complete','forfeit') ${sf}
    GROUP BY gps.player_name ORDER BY save_pct DESC
  `).all(...p);

  // Compute S/G (shots against per game) for goalies
  for (const g of goalies) {
    g.shots_per_game = g.gp > 0 ? Math.round((g.shots_against / g.gp) * 10) / 10 : null;
  }

  // If a specific season was requested and it has no game_player_stats,
  // fall back to season_player_stats (imported historical data).
  if (seasonId && skaters.length === 0 && goalies.length === 0) {
    const histSkaters = await db.prepare(`
      SELECT sps.player_name AS name,
        sps.team_id, COALESCE(t.name,'FA') AS team_name,
        t.logo_url AS team_logo, t.color1 AS team_color1, t.color2 AS team_color2,
        sps.position, sps.games_played AS gp,
        sps.goals, sps.assists, (sps.goals+sps.assists) AS points,
        sps.plus_minus, sps.shots, 0 AS hits, sps.pim,
        sps.pp_goals, sps.sh_goals, sps.gwg, 0 AS toi, 0 AS apt,
        0 AS penalties_drawn, 0 AS faceoff_wins, 0 AS faceoff_total,
        0 AS blocked_shots, NULL AS fow_pct, NULL AS shot_pct, NULL AS pass_pct_calc,
        0 AS deflections, 0 AS interceptions, 0 AS giveaways, 0 AS takeaways,
        0 AS pass_attempts, 0 AS pass_completions, 0 AS hat_tricks,
        0 AS overall_rating, 0 AS offensive_rating, 0 AS defensive_rating, 0 AS team_play_rating,
        0 AS shot_attempts, 0 AS saucer_passes, 0 AS pk_clears,
        0 AS player_wins, 0 AS player_losses, 0 AS player_otl,
        0 AS goal_support
      FROM season_player_stats sps
      LEFT JOIN teams t ON t.id = sps.team_id
      WHERE sps.season_id = ? AND (sps.position IS NULL OR sps.position != 'G')
      ORDER BY points DESC, goals DESC
    `).all(seasonId);
    const histGoalies = await db.prepare(`
      SELECT sps.player_name AS name,
        sps.team_id, COALESCE(t.name,'FA') AS team_name,
        t.logo_url AS team_logo, t.color1 AS team_color1, t.color2 AS team_color2,
        sps.games_played AS gp, sps.goals, sps.assists,
        sps.saves, sps.save_pct, sps.goals_against,
        0 AS shots_against, sps.gaa, 0 AS toi, sps.shutouts,
        sps.goalie_wins, sps.goalie_losses, 0 AS goalie_otw, 0 AS goalie_otl,
        0 AS penalty_shot_attempts, 0 AS penalty_shot_ga,
        0 AS breakaway_shots, 0 AS breakaway_saves,
        0 AS desperation_saves, 0 AS poke_check_saves,
        0 AS overall_rating, 0 AS offensive_rating, 0 AS defensive_rating, 0 AS team_play_rating,
        NULL AS shots_per_game, 0 AS goal_support
      FROM season_player_stats sps
      LEFT JOIN teams t ON t.id = sps.team_id
      WHERE sps.season_id = ? AND sps.position = 'G'
      ORDER BY sps.save_pct DESC
    `).all(seasonId);
    return res.json({ skaters: histSkaters, goalies: histGoalies });
  }

  res.json({ skaters, goalies });
});

app.get('/api/admin/unrostered-stats', requireOwner, async (req, res) => {
  const rows = await db.prepare(`
    SELECT gps.player_name, MAX(t.name) AS team_name, MAX(t.id) AS team_id,
      COUNT(DISTINCT gps.game_id) AS game_count
    FROM game_player_stats gps
    JOIN teams t ON gps.team_id = t.id
    JOIN games g ON gps.game_id = g.id
    LEFT JOIN players p ON p.name = gps.player_name AND p.team_id = gps.team_id AND p.is_rostered = 1
    WHERE g.status IN ('complete','forfeit') AND p.id IS NULL
    GROUP BY gps.player_name, gps.team_id
    ORDER BY MAX(t.name), gps.player_name
  `).all();
  res.json(rows);
});

// ── Standings helper ───────────────────────────────────────────────────────

async function calcStandings(seasonId) {
  const filter = seasonId
    ? "SELECT * FROM games WHERE status IN ('complete','forfeit') AND season_id = ? ORDER BY date ASC, id ASC"
    : "SELECT * FROM games WHERE status IN ('complete','forfeit') ORDER BY date ASC, id ASC";
  const games = seasonId ? await db.prepare(filter).all(seasonId) : await db.prepare(filter).all();

  // Count remaining (scheduled) games per team — needed for clinch math
  const scheduledGames = seasonId
    ? await db.prepare("SELECT home_team_id, away_team_id FROM games WHERE season_id = ? AND status = 'scheduled'").all(seasonId)
    : [];
  const remainingMap = {};
  for (const g of scheduledGames) {
    remainingMap[g.home_team_id] = (remainingMap[g.home_team_id] || 0) + 1;
    remainingMap[g.away_team_id] = (remainingMap[g.away_team_id] || 0) + 1;
  }

  // Per-season conference/division overrides
  const confOverrides = seasonId
    ? await db.prepare('SELECT team_id, conference, division FROM season_team_conf WHERE season_id = ?').all(seasonId)
    : [];
  const confMap = {};
  for (const r of confOverrides) confMap[r.team_id] = r;

  const teamIds = new Set();
  for (const g of games) { teamIds.add(g.home_team_id); teamIds.add(g.away_team_id); }
  const allTeams = await db.prepare('SELECT * FROM teams').all();
  const teams = seasonId ? allTeams.filter(t => teamIds.has(t.id)) : allTeams;
  const stats = {};
  for (const t of teams) {
    const co = confMap[t.id];
    stats[t.id] = {
      id: t.id, name: t.name, logo_url: t.logo_url || null,
      conference: co ? co.conference : (t.conference || ''),
      division:   co ? co.division   : (t.division   || ''),
      color1: t.color1 || null, color2: t.color2 || null,
      gp: 0, w: 0, otw: 0, l: 0, otl: 0, pts: 0, gf: 0, ga: 0,
      home_w: 0, home_l: 0, home_otl: 0,
      away_w: 0, away_l: 0, away_otl: 0,
      _results: [],
      remaining: remainingMap[t.id] || 0,
      pim_for: 0,
    };
  }

  // Head-to-head win map: h2h[teamA][teamB] = regulation/OT wins by A against B
  const h2h = {};
  const ensureH2h = id => { if (!h2h[id]) h2h[id] = {}; };

  for (const g of games) {
    const home = stats[g.home_team_id], away = stats[g.away_team_id];
    if (!home || !away) continue;
    home.gp++; away.gp++;
    home.gf += g.home_score; home.ga += g.away_score;
    away.gf += g.away_score; away.ga += g.home_score;
    const ot = !!g.is_overtime;
    ensureH2h(g.home_team_id); ensureH2h(g.away_team_id);
    if (g.home_score > g.away_score) {
      if (ot) { home.w++; home.otw++; home.pts += 2; home.home_w++; away.otl++; away.pts++; away.away_otl++; home._results.push('W'); away._results.push('OTL'); }
      else    { home.w++; home.pts += 2; home.home_w++; away.l++; away.away_l++; home._results.push('W'); away._results.push('L'); }
      h2h[g.home_team_id][g.away_team_id] = (h2h[g.home_team_id][g.away_team_id] || 0) + 1;
    } else if (g.away_score > g.home_score) {
      if (ot) { away.w++; away.otw++; away.pts += 2; away.away_w++; home.otl++; home.pts++; home.home_otl++; away._results.push('W'); home._results.push('OTL'); }
      else    { away.w++; away.pts += 2; away.away_w++; home.l++; home.home_l++; away._results.push('W'); home._results.push('L'); }
      h2h[g.away_team_id][g.home_team_id] = (h2h[g.away_team_id][g.home_team_id] || 0) + 1;
    } else { home.pts++; away.pts++; home._results.push('T'); away._results.push('T'); }
  }

  // Load penalty minutes per team for the season (tiebreaker #7)
  if (seasonId && teamIds.size > 0) {
    const pimRows = await db.prepare(
      `SELECT gps.team_id, SUM(gps.pim) AS pim_total
       FROM game_player_stats gps
       JOIN games g ON gps.game_id = g.id
       WHERE g.season_id = ? AND g.status IN ('complete','forfeit')
       GROUP BY gps.team_id`
    ).all(seasonId);
    for (const row of pimRows) {
      if (stats[row.team_id]) stats[row.team_id].pim_for = row.pim_total || 0;
    }
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

  // ── Full tiebreaker comparator ─────────────────────────────────────────
  // 1. Points  2. Regulation Wins  3. H2H Wins  4. Goal Diff
  // 5. Total Wins  6. Goals For  7. Least Goals Against  8. Least PIM Against
  function cmpTeams(a, b) {
    if (b.pts !== a.pts) return b.pts - a.pts;
    // 1. Regulation wins (wins not in OT)
    const rw_a = a.w - a.otw, rw_b = b.w - b.otw;
    if (rw_b !== rw_a) return rw_b - rw_a;
    // 2. Head-to-head wins (a's wins vs b vs b's wins vs a)
    const h2h_a = (h2h[a.id] && h2h[a.id][b.id]) || 0;
    const h2h_b = (h2h[b.id] && h2h[b.id][a.id]) || 0;
    if (h2h_a !== h2h_b) return h2h_b - h2h_a;
    // 3. Goal differential
    const diff_a = a.gf - a.ga, diff_b = b.gf - b.ga;
    if (diff_b !== diff_a) return diff_b - diff_a;
    // 4. Total wins
    if (b.w !== a.w) return b.w - a.w;
    // 5. Greater goals for
    if (b.gf !== a.gf) return b.gf - a.gf;
    // 6. Least goals against (lower is better)
    if (a.ga !== b.ga) return a.ga - b.ga;
    // 7. Least penalty minutes (lower is better)
    return (a.pim_for || 0) - (b.pim_for || 0);
  }

  const sorted = Object.values(stats).sort(cmpTeams);

  // ── NHL-style clinch indicators ────────────────────────────────────────
  // Only compute if a playoff bracket is configured for this season
  if (seasonId && sorted.length > 0) {
    const pc = await db.prepare('SELECT teams_qualify FROM playoffs WHERE season_id = ?').get(seasonId);
    if (pc) {
      const N = Math.min(pc.teams_qualify, sorted.length);

      // Helper: can opponent 'o' surpass team 't' given remaining games?
      // Uses the full tiebreaker chain. Returns true if there is any possible
      // outcome where o would rank above t.
      function canSurpass(o, t) {
        const maxPts = o.pts + 2 * o.remaining;
        if (maxPts < t.pts) return false;
        if (maxPts > t.pts) return true;
        // Equal pts scenario — worst case: o wins all remaining games in regulation (max reg wins)
        const rw_t = t.w - t.otw;
        const maxRegW_o = (o.w - o.otw) + o.remaining;
        if (maxRegW_o < rw_t) return false;
        if (maxRegW_o > rw_t) return true;
        // Reg wins tied — H2H can still change; if o has remaining games assume possible
        if (o.remaining > 0) return true;
        // All games done — use actual tiebreakers
        return cmpTeams(o, t) < 0; // o sorts above t (cmpTeams < 0 means o before t)
      }

      // Helper: is team t currently ranked first among the given peer list using tiebreakers?
      function isLeader(t, peers) {
        return peers.length > 0 && peers.every(o => cmpTeams(t, o) < 0);
      }

      for (let i = 0; i < sorted.length; i++) {
        const t = sorted[i];
        const rank = i + 1;
        t.clinch = null;

        if (rank <= N) {
          // P – clinched Presidents' Trophy (best overall record, tiebreaker-aware)
          if (rank === 1) {
            const anyCanPass = sorted.slice(1).some(o => canSurpass(o, t));
            if (!anyCanPass) { t.clinch = 'P'; continue; }
          }

          // Z – clinched conference title (first in conf, no conf peer can catch)
          if (t.conference) {
            const confPeers = sorted.filter(o => o.id !== t.id && o.conference === t.conference);
            if (isLeader(t, confPeers) && !confPeers.some(o => canSurpass(o, t))) {
              t.clinch = 'Z'; continue;
            }
          }

          // Y – clinched division title (first in div, no div peer can catch)
          if (t.division && t.conference) {
            const divPeers = sorted.filter(o => o.id !== t.id && o.division === t.division && o.conference === t.conference);
            if (isLeader(t, divPeers) && !divPeers.some(o => canSurpass(o, t))) {
              t.clinch = 'Y'; continue;
            }
          }

          // X – clinched a playoff spot (no team outside top N can reach this team)
          const outside = sorted.slice(N);
          if (!outside.some(o => o.pts + 2 * o.remaining >= t.pts)) {
            t.clinch = 'X';
          }
        } else {
          // E – mathematically eliminated (max possible pts < pts of last playoff team)
          if (t.pts + 2 * t.remaining < sorted[N - 1].pts) {
            t.clinch = 'E';
          }
        }
      }
    }
  }

  return sorted;
}

// ── Standings ──────────────────────────────────────────────────────────────

app.get('/api/standings', async (req, res) => {
  const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
  const teams = await calcStandings(seasonId);
  let playoff_cutoff = null;
  if (seasonId) {
    const pc = await db.prepare('SELECT teams_qualify FROM playoffs WHERE season_id = ?').get(seasonId);
    if (pc) playoff_cutoff = Math.min(pc.teams_qualify, teams.length);
  }
  res.json({ teams, playoff_cutoff });
});

// GET /api/seasons/:id/teams – return teams that have at least one game in this season
app.get('/api/seasons/:id/teams', requireAdmin, async (req, res) => {
  const season = await db.prepare('SELECT id FROM seasons WHERE id = ?').get(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const teams = await db.prepare(`
    SELECT DISTINCT t.id, t.name, t.logo_url, t.league_type, t.abbreviation
    FROM teams t
    WHERE t.id IN (
      SELECT home_team_id FROM games WHERE season_id = ?
      UNION
      SELECT away_team_id FROM games WHERE season_id = ?
    )
    ORDER BY t.name
  `).all(req.params.id, req.params.id);
  res.json(teams);
});

// GET /api/seasons/:id/team-conf – return all teams for this season's league type
// with their current season-specific conference/division (falls back to team default)
app.get('/api/seasons/:id/team-conf', requireAdmin, async (req, res) => {
  const season = await db.prepare('SELECT * FROM seasons WHERE id = ?').get(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const teamRows = season.league_type
    ? await db.prepare('SELECT id, name, conference, division, logo_url FROM teams WHERE league_type = ? ORDER BY name').all(season.league_type)
    : await db.prepare('SELECT id, name, conference, division, logo_url FROM teams ORDER BY name').all();
  const overrides = await db.prepare('SELECT team_id, conference, division FROM season_team_conf WHERE season_id = ?').all(req.params.id);
  const overMap = {};
  for (const o of overrides) overMap[o.team_id] = o;
  res.json(teamRows.map(t => ({
    team_id: t.id,
    name: t.name,
    logo_url: t.logo_url,
    conference: overMap[t.id] ? overMap[t.id].conference : (t.conference || ''),
    division:   overMap[t.id] ? overMap[t.id].division   : (t.division   || ''),
    has_override: !!overMap[t.id],
  })));
});

// POST /api/seasons/:id/team-conf – bulk upsert season-specific conf/div assignments
app.post('/api/seasons/:id/team-conf', requireOwner, async (req, res) => {
  const assignments = req.body;
  if (!Array.isArray(assignments)) return res.status(400).json({ error: 'Expected array of assignments' });
  const season = await db.prepare('SELECT id FROM seasons WHERE id = ?').get(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  await db.prepare('DELETE FROM season_team_conf WHERE season_id = ?').run(req.params.id);
  for (const a of assignments) {
    if (!a.team_id) continue;
    await db.prepare('INSERT INTO season_team_conf (season_id, team_id, conference, division) VALUES (?, ?, ?, ?)')
      .run(req.params.id, Number(a.team_id), a.conference || '', a.division || '');
  }
  res.json({ ok: true });
});

app.get('/api/transactions', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const rows = await db.prepare(`
    SELECT tx.id, tx.type, tx.player_name, tx.team_id, tx.team_name, tx.created_at,
           t.logo_url AS team_logo
      FROM transactions tx
      LEFT JOIN teams t ON tx.team_id = t.id
     ORDER BY tx.created_at DESC
     LIMIT ?
  `).all(limit);
  res.json(rows);
});

// ── Playoffs ────────────────────────────────────────────────────────────────

async function getPlayoffBracket(playoffId) {
  const playoff = await db.prepare('SELECT * FROM playoffs WHERE id = ?').get(playoffId);
  if (!playoff) return null;
  const teams = await db.prepare(`
    SELECT pt.seed, t.id AS team_id, t.name, t.abbreviation, t.logo_url, t.color1, t.color2
    FROM playoff_teams pt JOIN teams t ON pt.team_id = t.id
    WHERE pt.playoff_id = ? ORDER BY pt.seed
  `).all(playoffId);
  const allSeries = await db.prepare(`
    SELECT ps.*,
      ht.name AS high_seed_name, ht.abbreviation AS high_seed_abbrev, ht.logo_url AS high_seed_logo,
      ht.color1 AS high_seed_color1, ht.color2 AS high_seed_color2,
      lt.name AS low_seed_name, lt.abbreviation AS low_seed_abbrev, lt.logo_url AS low_seed_logo,
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
    ? await db.prepare('SELECT id, name FROM seasons WHERE id = ?').get(playoff.playoff_season_id)
    : null;
  return { playoff, teams, rounds, playoff_season: playoffSeason };
}

// GET /api/playoffs/by-season/:seasonId
app.get('/api/playoffs/by-season/:seasonId', async (req, res) => {
  const playoff = await db.prepare('SELECT * FROM playoffs WHERE season_id = ?').get(req.params.seasonId);
  if (!playoff) return res.status(404).json({ error: 'No playoff found for this season' });
  const bracket = await getPlayoffBracket(playoff.id);
  if (!bracket) return res.status(404).json({ error: 'Playoff data not found' });
  res.json(bracket);
});

// GET /api/playoffs/by-playoff-season/:playoffSeasonId
// Used when the user selects a "Season X Playoffs" entry in the season dropdown.
app.get('/api/playoffs/by-playoff-season/:playoffSeasonId', async (req, res) => {
  const playoff = await db.prepare('SELECT * FROM playoffs WHERE playoff_season_id = ?').get(req.params.playoffSeasonId);
  if (!playoff) return res.status(404).json({ error: 'No playoff found for this playoff season' });
  const bracket = await getPlayoffBracket(playoff.id);
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
async function createSeriesSchedule(seriesId, highSeedTeamId, lowSeedTeamId, seasonId, seriesLength, startDate) {
  const base = startDate ? new Date(startDate + 'T00:00:00Z') : new Date();
  const insertGame = await db.prepare(
    'INSERT INTO games (home_team_id, away_team_id, home_score, away_score, date, status, season_id, is_overtime, playoff_series_id) VALUES (?, ?, 0, 0, ?, ?, ?, 0, ?)'
  );
  for (let i = 0; i < seriesLength; i++) {
    const highSeedHosts = SERIES_HOME_PATTERN[i];
    const home = highSeedHosts ? highSeedTeamId : lowSeedTeamId;
    const away = highSeedHosts ? lowSeedTeamId  : highSeedTeamId;
    const gameDate = new Date(base);
    gameDate.setUTCDate(gameDate.getUTCDate() + i * 2);
    await insertGame.run(home, away, gameDate.toISOString().slice(0, 10), 'scheduled', seasonId, seriesId);
  }
}

// POST /api/playoffs – create bracket from season standings
app.post('/api/playoffs', requireOwner, async (req, res) => {
  const { season_id, teams_qualify, min_games_played, series_length, series_start_date } = req.body;
  if (!season_id || !teams_qualify || teams_qualify < 2) {
    return res.status(400).json({ error: 'season_id and teams_qualify (min 2) are required' });
  }
  if (!series_start_date) {
    return res.status(400).json({ error: 'series_start_date (YYYY-MM-DD) is required' });
  }
  const season = await db.prepare('SELECT * FROM seasons WHERE id = ?').get(season_id);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  if (season.is_playoff) return res.status(400).json({ error: 'Cannot create a playoff bracket from a playoff season' });
  const n = Number(teams_qualify);
  if (n < 2 || n > 64) {
    return res.status(400).json({ error: 'teams_qualify must be between 2 and 64' });
  }
  const existing = await db.prepare('SELECT id FROM playoffs WHERE season_id = ?').get(season_id);
  if (existing) return res.status(409).json({ error: 'A playoff already exists for this season. Delete it first.' });

  // Build standings and filter by min games played
  const standings = await calcStandings(Number(season_id));
  const minGP = Number(min_games_played) || 0;
  const qualified = standings.filter(t => t.gp >= minGP).slice(0, n);
  if (qualified.length < 2) {
    return res.status(400).json({ error: `Only ${qualified.length} team(s) qualify. Need at least 2.` });
  }
  const effectiveN = qualified.length;
  const playoffSeasonName = `${season.name} Playoffs`;
  const psResult = await db.prepare('INSERT INTO seasons (name, is_active, league_type, is_playoff) VALUES (?, 0, ?, 1)')
    .run(playoffSeasonName, season.league_type || '');
  const playoffSeasonId = psResult.lastInsertRowid;

  const pl = await db.prepare(
    'INSERT INTO playoffs (season_id, teams_qualify, min_games_played, series_length, playoff_season_id) VALUES (?, ?, ?, ?, ?)'
  ).run(Number(season_id), effectiveN, minGP, Number(series_length) || 7, playoffSeasonId);
  const playoffId = pl.lastInsertRowid;

  // Insert seeded teams
  for (let i = 0; i < qualified.length; i++) {
    const t = qualified[i];
    await db.prepare('INSERT INTO playoff_teams (playoff_id, team_id, seed) VALUES (?, ?, ?)').run(playoffId, t.id, i + 1);
  }

  // Compute byes for non-power-of-2 field sizes.
  // nextPow2 = smallest power of 2 >= effectiveN.
  // numByes teams (seeds 1..numByes) get pre-won "bye" series in round 1.
  // Remaining teams (seeds numByes+1..effectiveN) play real round-1 series.
  const nextPow2 = Math.pow(2, Math.ceil(Math.log2(effectiveN)));
  const numByes  = nextPow2 - effectiveN;

  let seriesNum = 1;
  const seriesLen = Number(series_length) || 7;

  // Insert bye series (pre-completed, no games needed)
  for (let i = 0; i < numByes; i++) {
    const byeTeam = qualified[i];
    await db.prepare(
      'INSERT INTO playoff_series (playoff_id, round_number, series_number, high_seed_id, low_seed_id, high_seed_num, low_seed_num, winner_id) VALUES (?, 1, ?, ?, NULL, ?, NULL, ?)'
    ).run(playoffId, seriesNum++, byeTeam.id, i + 1, byeTeam.id);
  }

  // Insert real round-1 series (the remaining teams, paired 1st vs last, 2nd vs 2nd-last, etc.)
  const roundTeams = qualified.slice(numByes); // seeds numByes+1 .. effectiveN
  const m = Math.floor(roundTeams.length / 2);
  for (let i = 0; i < m; i++) {
    const hi = roundTeams[i];
    const lo = roundTeams[roundTeams.length - 1 - i];
    const sr = await db.prepare(
      'INSERT INTO playoff_series (playoff_id, round_number, series_number, high_seed_id, low_seed_id, high_seed_num, low_seed_num) VALUES (?, 1, ?, ?, ?, ?, ?)'
    ).run(playoffId, seriesNum++, hi.id, lo.id, numByes + i + 1, effectiveN - i);
    await createSeriesSchedule(sr.lastInsertRowid, hi.id, lo.id, playoffSeasonId, seriesLen, series_start_date);
  }

  res.status(201).json(await getPlayoffBracket(playoffId));
});

// POST /api/playoffs/:id/advance-round – create next-round matchups from current-round winners
app.post('/api/playoffs/:id/advance-round', requireOwner, async (req, res) => {
  const playoff = await db.prepare('SELECT * FROM playoffs WHERE id = ?').get(req.params.id);
  if (!playoff) return res.status(404).json({ error: 'Playoff not found' });

  const curRound = await db.prepare(
    'SELECT MAX(round_number) AS round FROM playoff_series WHERE playoff_id = ?'
  ).get(req.params.id).round;

  const series = await db.prepare(
    'SELECT * FROM playoff_series WHERE playoff_id = ? AND round_number = ? ORDER BY series_number'
  ).all(req.params.id, curRound);

  if (series.some(s => !s.winner_id)) {
    return res.status(400).json({ error: 'Not all series in the current round are complete' });
  }
  if (series.length === 1) {
    return res.json({ message: 'Playoff complete', champion_id: series[0].winner_id });
  }

  // Sort winners by original seed (ascending = best seed first)
  const winners = [];
  for (const s of series) {
    const pt = await db.prepare('SELECT seed FROM playoff_teams WHERE playoff_id = ? AND team_id = ?').get(req.params.id, s.winner_id);
    winners.push({ team_id: s.winner_id, seed: pt ? pt.seed : 9999 });
  }
  winners.sort((a, b) => a.seed - b.seed);

  const nextRound = curRound + 1;
  const m = Math.floor(winners.length / 2);
  for (let i = 0; i < m; i++) {
    const hi = winners[i];
    const lo = winners[winners.length - 1 - i];
    const sr = await db.prepare(
      'INSERT INTO playoff_series (playoff_id, round_number, series_number, high_seed_id, low_seed_id, high_seed_num, low_seed_num) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.params.id, nextRound, i + 1, hi.team_id, lo.team_id, hi.seed, lo.seed);
    await createSeriesSchedule(sr.lastInsertRowid, hi.team_id, lo.team_id, playoff.playoff_season_id || playoff.season_id, playoff.series_length || 7);
  }

  res.json(await getPlayoffBracket(req.params.id));
});

// PATCH /api/playoff-series/:id – update series wins and/or seed numbers (auto-sets winner)
app.patch('/api/playoff-series/:id', requireAdmin, async (req, res) => {
  const s = await db.prepare('SELECT * FROM playoff_series WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Series not found' });
  const pl = await db.prepare('SELECT series_length FROM playoffs WHERE id = ?').get(s.playoff_id);
  const winsToWin = Math.ceil((pl ? pl.series_length : 7) / 2);

  const hw  = req.body.high_seed_wins !== undefined ? Number(req.body.high_seed_wins) : s.high_seed_wins;
  const lw  = req.body.low_seed_wins  !== undefined ? Number(req.body.low_seed_wins)  : s.low_seed_wins;
  const hsn = req.body.high_seed_num  !== undefined ? Number(req.body.high_seed_num)  : s.high_seed_num;
  const lsn = req.body.low_seed_num   !== undefined ? Number(req.body.low_seed_num)   : s.low_seed_num;
  let winner_id = null;
  if (hw >= winsToWin) winner_id = s.high_seed_id;
  else if (lw >= winsToWin) winner_id = s.low_seed_id;

  await db.prepare('UPDATE playoff_series SET high_seed_wins = ?, low_seed_wins = ?, winner_id = ?, high_seed_num = ?, low_seed_num = ? WHERE id = ?')
    .run(hw, lw, winner_id, hsn, lsn, req.params.id);
  res.json({ ok: true, winner_id });
});

/**
 * Recount series wins by tallying all completed games in the series.
 * Called automatically whenever a playoff game's status changes to 'complete'
 * so the bracket stays in sync without any manual input.
 */
async function recomputeSeriesWins(seriesId) {
  const s = await db.prepare('SELECT * FROM playoff_series WHERE id = ?').get(seriesId);
  if (!s) return;
  const pl = await db.prepare('SELECT series_length FROM playoffs WHERE id = ?').get(s.playoff_id);
  const winsToWin = Math.ceil((pl ? pl.series_length : 7) / 2);

  // Count how many complete games each team has won in this series
  const games = await db.prepare(
    "SELECT home_team_id, away_team_id, home_score, away_score FROM games WHERE playoff_series_id = ? AND status IN ('complete','forfeit')"
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

  await db.prepare('UPDATE playoff_series SET high_seed_wins = ?, low_seed_wins = ?, winner_id = ? WHERE id = ?')
    .run(hw, lw, winner_id, seriesId);

  // When a winner is determined, delete any remaining scheduled games in this series
  if (winner_id !== null) {
    await db.prepare("DELETE FROM games WHERE playoff_series_id = ? AND status = 'scheduled'").run(seriesId);
  }
}

// GET /api/playoff-series/:id/games – games linked to a series
app.get('/api/playoff-series/:id/games', async (req, res) => {
  const games = await db.prepare(`
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

// PATCH /api/playoffs/:playoffId/teams/:teamId – update a playoff team's seed
app.patch('/api/playoffs/:playoffId/teams/:teamId', requireOwner, async (req, res) => {
  const { seed } = req.body;
  if (seed === undefined || seed === null || isNaN(Number(seed))) {
    return res.status(400).json({ error: 'seed must be a number' });
  }
  const row = await db.prepare(
    'SELECT id FROM playoff_teams WHERE playoff_id = ? AND team_id = ?'
  ).get(req.params.playoffId, req.params.teamId);
  if (!row) return res.status(404).json({ error: 'Team not in this playoff' });
  await db.prepare('UPDATE playoff_teams SET seed = ? WHERE playoff_id = ? AND team_id = ?')
    .run(Number(seed), req.params.playoffId, req.params.teamId);
  res.json({ ok: true });
});

// DELETE /api/playoffs/:id
app.delete('/api/playoffs/:id', requireOwner, async (req, res) => {
  const playoff = await db.prepare('SELECT * FROM playoffs WHERE id = ?').get(req.params.id);
  if (!playoff) return res.status(404).json({ error: 'Playoff not found' });
  // Delete auto-generated scheduled games for this playoff; unlink any manually-completed ones
  await db.prepare('DELETE FROM games WHERE status = ? AND playoff_series_id IN (SELECT id FROM playoff_series WHERE playoff_id = ?)').run('scheduled', req.params.id);
  await db.prepare('UPDATE games SET playoff_series_id = NULL WHERE playoff_series_id IN (SELECT id FROM playoff_series WHERE playoff_id = ?)').run(req.params.id);
  await db.prepare('DELETE FROM playoff_series WHERE playoff_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM playoff_teams WHERE playoff_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM playoffs WHERE id = ?').run(req.params.id);
  // Delete the auto-created playoff season (and any remaining games assigned to it)
  if (playoff.playoff_season_id) {
    await db.prepare('UPDATE games SET season_id = NULL WHERE season_id = ?').run(playoff.playoff_season_id);
    await db.prepare('DELETE FROM seasons WHERE id = ? AND is_playoff = 1').run(playoff.playoff_season_id);
  }
  res.json({ ok: true });
});

// ── EA Matches ─────────────────────────────────────────────────────────────

app.get('/api/games/:id/ea-matches', async (req, res) => {
  const game = await db.prepare(`
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
    res.status(502).json({ error: 'Failed to fetch EA match data.', details: err.message });
  }
});

// ── Discord OAuth2 routes ──────────────────────────────────────────────────

// Step 1 – redirect the browser to Discord's authorization page.
// ?token=<player_token>  → link an existing account (from dashboard)
// (no token)             → called during registration
app.get('/api/discord/connect', async (req, res) => {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) return res.status(501).json({ error: 'Discord OAuth is not configured on this server. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET environment variables.' });
  const redirectUri = DISCORD_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/discord/callback`;
  const playerToken = req.query.token || '';
  const explicitMode = req.query.mode || '';
  let mode;
  if (explicitMode === 'login') {
    mode = 'login';
  } else if (playerToken && _verifyPlayerToken(playerToken)) {
    mode = 'player';
  } else {
    mode = 'register';
  }
  const userId = mode === 'player' ? _verifyPlayerToken(playerToken) : null;
  // Encode state as an HMAC-signed token so it survives serverless cold starts
  const state  = _signPayload({ mode, userId, redirectUri, exp: Date.now() + 10 * 60 * 1000 });
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
  const stateData = _verifyPayload(state);
  if (!stateData) return res.redirect('/register.html?discord_error=expired');
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
    console.log('[auth] discord callback: mode=', stateData.mode, 'discord_id=', discord_id, 'discord=', discord);

    // Auto-link an unlinked players record whose discord_id matches the authenticated Discord account.
    async function autoLinkPlayerByDiscord(userId, discordId, discordName) {
      const unlinked = await db.prepare('SELECT id FROM players WHERE discord_id = ? AND user_id IS NULL LIMIT 1').get(discordId);
      if (unlinked) {
        await db.prepare('UPDATE players SET user_id = ?, discord = ? WHERE id = ?').run(userId, discordName, unlinked.id);
      }
    }

    if (stateData.mode === 'player') {
      // Update existing logged-in player
      await db.prepare('UPDATE users SET discord_id = ?, discord = ? WHERE id = ?').run(discord_id, discord, stateData.userId);
      await autoLinkPlayerByDiscord(stateData.userId, discord_id, discord);
      return res.redirect('/dashboard.html?discord_linked=1');
    } else if (stateData.mode === 'login') {
      // Discord login: check if a user with this discord_id exists
      const existingUser = await db.prepare('SELECT id, username, platform FROM users WHERE discord_id = ?').get(discord_id);
      if (existingUser) {
        await autoLinkPlayerByDiscord(existingUser.id, discord_id, discord);
        // Create a player session token and redirect straight to dashboard.
        // This avoids the fragile register.js → POST /api/players/login chain.
        const authToken = _signPlayerToken(existingUser.id);
        const userJson = encodeURIComponent(JSON.stringify({ id: existingUser.id, username: existingUser.username, platform: existingUser.platform }));
        console.log('[auth] discord login: existing user found, redirecting to dashboard. user_id=', existingUser.id);
        return res.redirect(`/dashboard.html?auth_token=${encodeURIComponent(authToken)}&auth_user=${userJson}`);
      } else {
        // No account found — redirect to registration with Discord info pre-filled
        const linkToken = _signPayload({ discord_id, discord, exp: Date.now() + 10 * 60 * 1000 });
        return res.redirect(`/register.html?discord_token=${encodeURIComponent(linkToken)}&discord_username=${encodeURIComponent(discord)}&discord_new=1`);
      }
    } else {
      // Create a signed token for the registration page to pick up
      const linkToken = _signPayload({ discord_id, discord, exp: Date.now() + 10 * 60 * 1000 });
      return res.redirect(`/register.html?discord_token=${encodeURIComponent(linkToken)}&discord_username=${encodeURIComponent(discord)}`);
    }
  } catch (err) {
    const dest = stateData.mode === 'player' ? '/dashboard.html' : '/register.html';
    return res.redirect(`${dest}?discord_error=${encodeURIComponent(err.message)}`);
  }
});

// Step 3 – Registration page verifies the pending discord link token before submitting.
app.get('/api/discord/pending', async (req, res) => {
  const { token } = req.query;
  const pending = _verifyPayload(token);
  if (!pending) return res.status(404).json({ error: 'Invalid or expired Discord link token' });
  res.json({ discord_id: pending.discord_id, discord: pending.discord });
});

// ── Game admin management (owner only) ────────────────────────────────────

// List users who are game admins
app.get('/api/admin/game-admins', requireOwner, async (_req, res) => {
  const admins = await db.prepare(
    "SELECT id, username, discord FROM users WHERE role = 'game_admin' ORDER BY username "
  ).all();
  res.json(admins);
});

// Search registered users by username prefix (owner only, used when adding game admins)
app.get('/api/admin/users/search', requireOwner, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const users = await db.prepare(
    "SELECT id, username, discord, role FROM users WHERE username ILIKE ? ORDER BY username LIMIT 20"
  ).all(`${q}%`);
  res.json(users);
});

// List all registered users (for admin link-player dropdown)
app.get('/api/admin/users', requireOwner, async (_req, res) => {
  const users = await db.prepare(
    'SELECT id, username, discord FROM users ORDER BY username'
  ).all();
  res.json(users);
});

// Promote a user to game admin
app.post('/api/admin/game-admins/:userId', requireOwner, async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (isOwnerUser(user))
    return res.status(400).json({ error: "Cannot change the owner's role" });
  await db.prepare("UPDATE users SET role = 'game_admin' WHERE id = ?").run(user.id);
  res.json({ ok: true });
});

// Demote a game admin back to regular user
app.delete('/api/admin/game-admins/:userId', requireOwner, async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  await db.prepare('UPDATE users SET role = NULL WHERE id = ?').run(user.id);
  // With stateless tokens the old admin token will fail on next /api/auth/status
  // check because the DB role is re-verified.
  res.json({ ok: true });
});

// ── Easy admin setup (no login required) ──────────────────────────────────
// POST /api/admin/setup/promote  — promote a user to game_admin or owner.
// Protected by ADMIN_SECRET env var.  This lets the site owner promote admins
// with a simple curl command instead of navigating the full admin panel:
//   curl -X POST https://yoursite.com/api/admin/setup/promote \
//     -H 'Content-Type: application/json' \
//     -d '{"username":"SomeUser","secret":"your-admin-secret"}'
// To set a new site owner by Discord ID, also pass "role":"owner".
app.post('/api/admin/setup/promote', async (req, res) => {
  const setupKey = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD;
  if (!setupKey) return res.status(501).json({ error: 'ADMIN_SECRET environment variable is not configured. Set it on your server to use this endpoint.' });
  const { username, discord_id, secret, role } = req.body;
  if (!secret || secret !== setupKey) return res.status(403).json({ error: 'Invalid secret' });
  if (!username && !discord_id) return res.status(400).json({ error: 'Provide "username" or "discord_id" to identify the user' });
  const user = username
    ? await db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim())
    : await db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discord_id);
  if (!user) return res.status(404).json({ error: 'User not found. They must register first.' });
  if (role === 'owner') {
    // Set this user as the site owner by updating their discord_id to match OWNER_DISCORD_ID
    // (or inform them to set OWNER_DISCORD_ID env var to this user's discord_id)
    if (!user.discord_id) return res.status(400).json({ error: 'User must have a linked Discord account to be set as owner. Set OWNER_DISCORD_ID env var to their Discord ID.' });
    return res.json({ ok: true, message: `To make "${user.username}" the site owner, set the OWNER_DISCORD_ID environment variable to "${user.discord_id}" and redeploy.`, discord_id: user.discord_id });
  }
  await db.prepare("UPDATE users SET role = 'game_admin' WHERE id = ?").run(user.id);
  res.json({ ok: true, message: `"${user.username}" has been promoted to game admin.` });
});

// ── Historical data import ─────────────────────────────────────────────────
// POST /api/admin/import  — owner-only bulk import endpoint.
// Accepts JSON produced by scripts/scrape-mystatsonline.js (or hand-crafted):
// {
//   "seasons": [
//     {
//       "name": "Season 1",
//       "league_type": "threes",          // optional: "threes" | "sixes" | ""
//       "games": [                         // optional array of game results
//         {
//           "date": "2022-01-15",
//           "home_team": "Team A",
//           "away_team": "Team B",
//           "home_score": 5,
//           "away_score": 3,
//           "is_overtime": false           // optional
//         }
//       ],
//       "player_stats": [                  // optional season-level aggregate stats
//         {
//           "team": "Team A",
//           "player_name": "PlayerX",
//           "position": "C",               // "G" for goalies
//           "games_played": 10,
//           "goals": 5, "assists": 8,
//           "plus_minus": 3, "pim": 4,
//           "shots": 30, "pp_goals": 1, "sh_goals": 0, "gwg": 1,
//           // Goalie-only fields:
//           "saves": 0, "save_pct": null, "goals_against": 0,
//           "goalie_wins": 0, "goalie_losses": 0, "shutouts": 0, "gaa": null
//         }
//       ]
//     }
//   ]
// }
app.post('/api/admin/import', requireAdmin, async (req, res) => {
  const { seasons } = req.body || {};
  if (!Array.isArray(seasons) || seasons.length === 0) {
    return res.status(400).json({ error: 'Request body must contain a non-empty "seasons" array.' });
  }

  const summary = { seasons_created: 0, seasons_existing: 0, teams_created: 0, games_created: 0, games_skipped: 0, stats_rows: 0 };
  const teamCache = new Map();

  try {
    await db.transaction(async (tx) => {
      const findTeam    = tx.prepare('SELECT id FROM teams WHERE name = ?');
      const insertTeam  = tx.prepare('INSERT INTO teams (name, conference, division, league_type, color1, color2) VALUES (?, \'\', \'\', ?, \'\', \'\')');
      const findSeason  = tx.prepare('SELECT id FROM seasons WHERE name = ?');
      const insertSeason = tx.prepare('INSERT INTO seasons (name, is_active, league_type) VALUES (?, 0, ?)');
      const findGame    = tx.prepare('SELECT id FROM games WHERE home_team_id=? AND away_team_id=? AND date=?');
      const insertGame  = tx.prepare(`
        INSERT INTO games (home_team_id, away_team_id, home_score, away_score, date, status, season_id, is_overtime)
        VALUES (?, ?, ?, ?, ?, 'complete', ?, ?)
      `);
      const deleteSPS   = tx.prepare('DELETE FROM season_player_stats WHERE season_id = ? AND player_name = ?');
      const insertSPS   = tx.prepare(`
        INSERT INTO season_player_stats
          (season_id, team_id, player_name, position, games_played,
           goals, assists, plus_minus, pim, shots, pp_goals, sh_goals, gwg,
           saves, save_pct, goals_against, goalie_wins, goalie_losses, shutouts, gaa, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mystatsonline')
      `);

      async function getOrCreateTeam(name, leagueType) {
        if (!name) return null;
        if (teamCache.has(name)) return teamCache.get(name);
        let row = await findTeam.get(name);
        if (!row) {
          const result = await insertTeam.run(name, leagueType || '');
          teamCache.set(name, result.lastInsertRowid);
          summary.teams_created++;
          return result.lastInsertRowid;
        }
        teamCache.set(name, row.id);
        return row.id;
      }

      for (const s of seasons) {
        const sName       = String(s.name || '').trim();
        const leagueType  = String(s.league_type || '').trim();
        if (!sName) continue;

        let seasonId;
        const existingSeason = await findSeason.get(sName);
        if (existingSeason) {
          seasonId = existingSeason.id;
          summary.seasons_existing++;
        } else {
          const r = await insertSeason.run(sName, leagueType);
          seasonId = r.lastInsertRowid;
          summary.seasons_created++;
        }

        for (const g of (s.games || [])) {
          const homeId = await getOrCreateTeam(g.home_team, leagueType);
          const awayId = await getOrCreateTeam(g.away_team, leagueType);
          if (!homeId || !awayId) continue;
          const date = String(g.date || '').trim();
          if (!date) continue;
          const existing = await findGame.get(homeId, awayId, date);
          if (existing) { summary.games_skipped++; continue; }
          await insertGame.run(homeId, awayId, g.home_score || 0, g.away_score || 0, date, seasonId, g.is_overtime ? 1 : 0);
          summary.games_created++;
        }

        for (const ps of (s.player_stats || [])) {
          const pName = String(ps.player_name || '').trim();
          if (!pName) continue;
          const teamId = ps.team ? await getOrCreateTeam(ps.team, leagueType) : null;
          await deleteSPS.run(seasonId, pName);
          await insertSPS.run(
            seasonId, teamId, pName,
            ps.position || '',
            ps.games_played || 0,
            ps.goals || 0, ps.assists || 0,
            ps.plus_minus || 0, ps.pim || 0,
            ps.shots || 0, ps.pp_goals || 0, ps.sh_goals || 0, ps.gwg || 0,
            ps.saves || 0,
            ps.save_pct != null ? ps.save_pct : null,
            ps.goals_against || 0,
            ps.goalie_wins || 0, ps.goalie_losses || 0, ps.shutouts || 0,
            ps.gaa != null ? ps.gaa : null
          );
          summary.stats_rows++;
        }
      }
    });
    res.json({ ok: true, summary });
  } catch (err) {
    console.error('[import] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Historical stats: season_player_stats reader ──────────────────────────
// GET /api/stats/historical?season_id=X
// Returns season_player_stats rows for seasons that have no game_player_stats.
app.get('/api/stats/historical', async (req, res) => {
  const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
  const sf = seasonId ? 'AND sps.season_id = ?' : '';
  const params = seasonId ? [seasonId] : [];

  const skaters = await db.prepare(`
    SELECT sps.player_name AS name, sps.season_id,
      COALESCE(s.name,'') AS season_name, COALESCE(s.league_type,'') AS league_type,
      t.id AS team_id, COALESCE(t.name,'FA') AS team_name,
      t.logo_url AS team_logo, t.color1 AS team_color1, t.color2 AS team_color2,
      sps.position, sps.games_played AS gp,
      sps.goals, sps.assists, (sps.goals + sps.assists) AS points,
      sps.plus_minus, sps.pim, sps.shots,
      sps.pp_goals, sps.sh_goals, sps.gwg,
      0 AS overall_rating, 0 AS offensive_rating, 0 AS defensive_rating, 0 AS team_play_rating,
      CASE WHEN sps.shots > 0 THEN ROUND(sps.goals*100.0/sps.shots,1) ELSE NULL END AS shot_pct,
      NULL AS fow_pct, NULL AS pass_pct_calc,
      0 AS hits, 0 AS toi, 0 AS apt, 0 AS blocked_shots,
      0 AS faceoff_wins, 0 AS faceoff_total,
      0 AS deflections, 0 AS interceptions, 0 AS giveaways, 0 AS takeaways,
      0 AS pass_attempts, 0 AS pass_completions, 0 AS hat_tricks, 0 AS penalties_drawn,
      0 AS shot_attempts, 0 AS saucer_passes, 0 AS pk_clears,
      0 AS player_wins, 0 AS player_losses, 0 AS player_otl,
      0 AS goal_support
    FROM season_player_stats sps
    LEFT JOIN teams t ON t.id = sps.team_id
    LEFT JOIN seasons s ON s.id = sps.season_id
    WHERE (sps.position IS NULL OR sps.position = '' OR sps.position != 'G') ${sf}
    ORDER BY points DESC, goals DESC
  `).all(...params);

  const goalies = await db.prepare(`
    SELECT sps.player_name AS name, sps.season_id,
      COALESCE(s.name,'') AS season_name, COALESCE(s.league_type,'') AS league_type,
      t.id AS team_id, COALESCE(t.name,'FA') AS team_name,
      t.logo_url AS team_logo, t.color1 AS team_color1, t.color2 AS team_color2,
      sps.games_played AS gp, sps.goals, sps.assists,
      sps.saves, sps.save_pct, sps.goals_against,
      sps.goalie_wins, sps.goalie_losses, sps.shutouts, sps.gaa,
      0 AS overall_rating, 0 AS shots_against, 0 AS toi,
      0 AS penalty_shot_attempts, 0 AS penalty_shot_ga,
      0 AS breakaway_shots, 0 AS breakaway_saves,
      0 AS desperation_saves, 0 AS poke_check_saves,
      0 AS goalie_otw, 0 AS goalie_otl, NULL AS shots_per_game, 0 AS goal_support
    FROM season_player_stats sps
    LEFT JOIN teams t ON t.id = sps.team_id
    LEFT JOIN seasons s ON s.id = sps.season_id
    WHERE sps.position = 'G' ${sf}
    ORDER BY sps.save_pct DESC
  `).all(...params);

  res.json({ skaters, goalies });
});

// ── MSO Scraper JSON import ────────────────────────────────────────────────
// POST /api/admin/import-mso-json
// Accepts the JSON output from scripts/mso_scraper directly.
// Body: { season_name, league_type, games: [ ... ] }
// Each game object has: id, date, time, home_team, away_team, home_score,
// away_score, game_type ("regular"|"playoff"), playoff_round,
// mso_source_url, stats { skaters, goalies } or forfeit.
// Playoff games are placed into a "<season_name> Playoffs" season with full
// bracket structures (playoffs, playoff_series, playoff_teams tables).

app.post('/api/admin/import-mso-json', requireOwner, async (req, res) => {
  const { season_name, season_id, league_type, games } = req.body || {};
  if (!season_name && !season_id) {
    return res.status(400).json({ error: '"season_name" or "season_id" is required.' });
  }
  if (!Array.isArray(games) || games.length === 0) {
    return res.status(400).json({ error: '"games" must be a non-empty array.' });
  }
  const sName = (season_name || '').trim();
  const lt = String(league_type || '').trim();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function decodeEntities(s) {
    if (!s) return '';
    // Decode &amp; last to avoid double-unescaping (e.g. &amp;lt; → &lt; → <)
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
            .replace(/\u00a0/g, ' ').replace(/&amp;/g, '&').trim();
  }

  function parseDate(dateStr) {
    if (!dateStr) return '';
    const stripped = dateStr.replace(/^[A-Za-z]+\s+/, '');
    const d = new Date(stripped);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    const d2 = new Date(dateStr);
    if (!isNaN(d2.getTime()) && d2.getFullYear() > 2000) {
      return `${d2.getFullYear()}-${String(d2.getMonth()+1).padStart(2,'0')}-${String(d2.getDate()).padStart(2,'0')}`;
    }
    return dateStr;
  }

  function parseRoundNumber(roundStr) {
    if (!roundStr) return 1;
    const m = roundStr.match(/ROUND\s+(\d+)/i);
    return m ? parseInt(m[1], 10) : 1;
  }

  function num(v) {
    if (v === undefined || v === null || v === '' || v === '-') return 0;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  /** "X" → 1, "" → 0, numeric string → number */
  function flag(v) {
    if (v === 'X' || v === 'x') return 1;
    if (!v || v === '' || v === '-') return 0;
    const n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  }

  // ── Parse scraper stats into game_player_stats-compatible objects ───────

  /** Round to integer (defence-in-depth for INTEGER columns). */
  const iNum = v => Math.round(num(v));

  function parseSkaterStats(skatersObj, side) {
    const players = [];
    if (!skatersObj || !skatersObj[side]) return players;
    const fields = skatersObj._fields || [];
    const fi = {};
    fields.forEach((f, i) => { fi[f.toUpperCase()] = i; });
    const posIdx = fi['POS'];
    const VALID_POS = new Set(['C','D','LW','RW','F','G','LD','RD','W']);
    for (const [key, vals] of Object.entries(skatersObj[side])) {
      if (key === '_fields' || !Array.isArray(vals)) continue;
      // Fix misalignment: if POS is in the header but missing from the values
      // array (vals is shorter by 1), the values are shifted left. Detect this
      // by checking whether the value at the POS index looks like a valid
      // position string.  If not, insert a placeholder so the remaining
      // indices line up with the _fields header again.
      let v = vals;
      if (posIdx !== undefined && v.length === fields.length - 1) {
        const candidate = String(v[posIdx] || '').trim().toUpperCase();
        if (!VALID_POS.has(candidate)) {
          v = [...vals.slice(0, posIdx), '', ...vals.slice(posIdx)];
        }
      }
      // Read actual position from POS field (e.g. C, LW, LD)
      let pos = 'F';
      if (posIdx !== undefined) {
        const raw = String(v[posIdx] || '').replace(/\u00a0/g, '').trim().toUpperCase();
        if (raw && VALID_POS.has(raw) && raw !== 'G') pos = raw;
      }
      const foW = iNum(v[fi['FOW']]);
      const foTotal = iNum(v[fi['FO']]);
      players.push({
        player_name: decodeEntities(v[0] || key),
        position:    pos,
        goals:       iNum(v[fi['G']]),
        assists:     iNum(v[fi['A']]),
        shots:       iNum(v[fi['S']]),
        pim:         iNum(v[fi['PIM']]),
        plus_minus:  iNum(v[fi['+/-']]),
        pp_goals:    iNum(v[fi['PPG']]),
        sh_goals:    iNum(v[fi['SHG']]),
        gwg:         iNum(v[fi['WG']]),
        hits:        iNum(v[fi['HITS']]),
        toi:         Math.round(num(v[fi['TOI']]) * 60), // MSO stores TOI in minutes; convert to seconds
        blocked_shots: iNum(v[fi['BS']]),
        faceoff_wins:  foW,
        faceoff_losses: foTotal > foW ? foTotal - foW : 0,
        interceptions:  iNum(v[fi['INT']]),
        giveaways:      iNum(v[fi['GVA']]),
        takeaways:      iNum(v[fi['TKA']]),
        pass_attempts:     iNum(v[fi['PA']]),
        pass_completions:  iNum(v[fi['PC']]),
        hat_tricks:        iNum(v[fi['HT']]),
        penalties_drawn:   iNum(v[fi['PS']]),
      });
    }
    return players;
  }

  function parseGoalieStats(goaliesObj, side) {
    const players = [];
    if (!goaliesObj || !goaliesObj[side]) return players;
    const fields = goaliesObj._fields || [];
    const fi = {};
    fields.forEach((f, i) => { fi[f.toUpperCase()] = i; });
    for (const [key, vals] of Object.entries(goaliesObj[side])) {
      if (key === '_fields' || !Array.isArray(vals)) continue;
      const svpRaw = fi['SV%'] !== undefined ? vals[fi['SV%']] : '';
      let svp = null;
      if (svpRaw && svpRaw !== '-') {
        svp = parseFloat(svpRaw);
        if (!isNaN(svp)) svp = Math.round(svp * 1000) / 1000;
        else svp = null;
      }
      players.push({
        player_name:   decodeEntities(vals[0] || key),
        position:      'G',
        goals:         iNum(vals[fi['G']]),
        assists:       iNum(vals[fi['A']]),
        shots_against: iNum(vals[fi['SA']]),
        goals_against: iNum(vals[fi['GA']]),
        saves:         iNum(vals[fi['SV']]),
        save_pct:      svp,
        gaa:           fi['GAA'] !== undefined && vals[fi['GAA']] ? parseFloat(vals[fi['GAA']]) || null : null,
        toi:           Math.round(num(vals[fi['TOI']]) * 60), // MSO stores TOI in minutes; convert to seconds
        shutouts:      flag(vals[fi['SO']]),
        goalie_wins:   flag(vals[fi['W']]),
        goalie_losses: flag(vals[fi['L']]),
        goalie_otw:    flag(vals[fi['OTW']]),
        goalie_otl:    flag(vals[fi['OTL']]),
        penalty_shot_attempts: iNum(vals[fi['PSA']]),
        penalty_shot_ga:       iNum(vals[fi['PSGA']]),
      });
    }
    return players;
  }

  // ── Main import logic ──────────────────────────────────────────────────

  const summary = {
    season: sName || `Season #${season_id}`,
    teams_created: 0,
    games_created: 0,
    games_skipped: 0,
    stats_imported: 0,
    playoff_series_created: 0,
    errors: [],
  };

  const teamCache = new Map();
  async function getOrCreateTeam(name) {
    const decoded = decodeEntities(name);
    if (!decoded) return null;
    if (teamCache.has(decoded)) return teamCache.get(decoded);
    let row = await db.prepare('SELECT id FROM teams WHERE name = ?').get(decoded);
    if (!row) {
      const r = await db.prepare("INSERT INTO teams (name, conference, division, league_type, color1, color2) VALUES (?, '', '', ?, '', '')").run(decoded, lt);
      teamCache.set(decoded, r.lastInsertRowid);
      summary.teams_created++;
      return r.lastInsertRowid;
    }
    teamCache.set(decoded, row.id);
    return row.id;
  }

  async function insertGameWithStats(g, gameSeasonId, playoffSeriesId) {
    const homeId = await getOrCreateTeam(g.home_team);
    const awayId = await getOrCreateTeam(g.away_team);
    if (!homeId || !awayId) { summary.games_skipped++; return; }
    const date = parseDate(g.date);
    if (!date) { summary.games_skipped++; return; }
    const msoGameId = g.id ? `mso:${g.id}` : null;

    // Dedup by MSO game ID
    if (msoGameId) {
      const existing = await db.prepare('SELECT id FROM games WHERE ea_match_id = ?').get(msoGameId);
      if (existing) { summary.games_skipped++; return; }
    }

    const homeScore = parseInt(g.home_score, 10) || 0;
    const awayScore = parseInt(g.away_score, 10) || 0;
    const isOT = g.ot ? 1 : 0;
    const isForfeit = g.forfeit ? 1 : 0;
    // The scraper sets g.draw=true for cancelled/in-progress MSO games (not actual ties)
    const status = g.forfeit ? 'forfeit' : (g.draw ? 'cancelled' : 'complete');

    const r = await db.prepare(`
      INSERT INTO games (home_team_id, away_team_id, home_score, away_score, date, status, season_id, is_overtime, playoff_series_id, ea_match_id, is_forfeit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(homeId, awayId, homeScore, awayScore, date, status, gameSeasonId, isOT, playoffSeriesId, msoGameId, isForfeit);
    const gameId = r.lastInsertRowid;
    summary.games_created++;

    // Parse and insert embedded stats
    if (g.stats && g.stats.skaters && g.stats.goalies) {
      try {
        // NOTE: In MSO JSON the stats 'home'/'away' labels are inverted relative
        // to the game's home_team/away_team.  The MSO scraper puts the first
        // (visitor) section under 'home' and the second (home) under 'away'.
        const homeSkaters = parseSkaterStats(g.stats.skaters, 'away');
        const awaySkaters = parseSkaterStats(g.stats.skaters, 'home');
        const homeGoalies = parseGoalieStats(g.stats.goalies, 'away');
        const awayGoalies = parseGoalieStats(g.stats.goalies, 'home');
        const homeWon = homeScore > awayScore;

        const insertPlayers = async (players, teamId, teamWon) => {
          for (const p of players) {
            const isGoalie = p.position === 'G';
            let gw = 0, gl = 0, otw = 0, otl = 0, so = 0;
            if (isGoalie) {
              so = p.shutouts || 0;
              if (isOT) {
                otw = p.goalie_wins || 0;
                otl = p.goalie_losses || 0;
              } else {
                gw = p.goalie_wins || 0;
                gl = p.goalie_losses || 0;
              }
            }
            await db.prepare(`
              INSERT INTO game_player_stats
                (game_id, team_id, player_name, position,
                 goals, assists, shots, pim, plus_minus, blocked_shots,
                 faceoff_wins, faceoff_losses, giveaways, takeaways, pp_goals, sh_goals, gwg, hits, toi,
                 saves, save_pct, goals_against, shots_against,
                 goalie_wins, goalie_losses, goalie_otw, goalie_otl, shutouts,
                 penalty_shot_attempts, penalty_shot_ga,
                 pass_attempts, pass_completions, interceptions, hat_tricks, penalties_drawn)
              VALUES (?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?,?,?)
            `).run(
              gameId, teamId, p.player_name, p.position,
              Math.round(p.goals || 0), Math.round(p.assists || 0), Math.round(p.shots || 0), Math.round(p.pim || 0),
              Math.round(p.plus_minus || 0), Math.round(p.blocked_shots || 0),
              Math.round(p.faceoff_wins || 0), Math.round(p.faceoff_losses || 0),
              Math.round(p.giveaways || 0), Math.round(p.takeaways || 0),
              Math.round(p.pp_goals || 0), Math.round(p.sh_goals || 0), Math.round(p.gwg || 0), Math.round(p.hits || 0), Math.round(p.toi || 0),
              isGoalie ? Math.round(p.saves || 0) : 0,
              isGoalie ? p.save_pct : null,
              isGoalie ? Math.round(p.goals_against || 0) : 0,
              isGoalie ? Math.round(p.shots_against || 0) : 0,
              gw, gl, otw, otl, so,
              isGoalie ? Math.round(p.penalty_shot_attempts || 0) : 0,
              isGoalie ? Math.round(p.penalty_shot_ga || 0) : 0,
              Math.round(p.pass_attempts || 0), Math.round(p.pass_completions || 0),
              Math.round(p.interceptions || 0), Math.round(p.hat_tricks || 0),
              Math.round(p.penalties_drawn || 0)
            );
          }
        };
        await insertPlayers([...homeSkaters, ...homeGoalies], homeId, homeWon);
        await insertPlayers([...awaySkaters, ...awayGoalies], awayId, !homeWon);
        summary.stats_imported++;
      } catch (e) {
        summary.errors.push(`Game ${g.id}: stats error: ${e.message}`);
      }
    }
  }

  try {
    // Separate games by type
    const regularGames = [];
    const playoffGames = [];
    for (const g of games) {
      if (g.game_type === 'playoff') playoffGames.push(g);
      else regularGames.push(g);
    }

    // Create / find the regular season
    let seasonId;
    let resolvedSeasonName = sName;
    let resolvedLt = lt;
    if (season_id) {
      // Use the provided existing season
      const existing = await db.prepare('SELECT id, name, league_type FROM seasons WHERE id = ?').get(season_id);
      if (!existing) {
        return res.status(400).json({ error: `Season with id ${season_id} not found.` });
      }
      seasonId = existing.id;
      resolvedSeasonName = existing.name;
      resolvedLt = existing.league_type || lt;
    } else {
      const existingSeason = await db.prepare('SELECT id FROM seasons WHERE name = ?').get(sName);
      if (existingSeason) {
        seasonId = existingSeason.id;
      } else {
        const r = await db.prepare('INSERT INTO seasons (name, is_active, league_type) VALUES (?, 0, ?)').run(sName, lt);
        seasonId = r.lastInsertRowid;
      }
    }
    summary.season = resolvedSeasonName;

    // Import regular-season games
    for (const g of regularGames) {
      await insertGameWithStats(g, seasonId, null);
    }

    // Import playoff games
    if (playoffGames.length > 0) {
      // Create / find the playoff season
      const playoffSeasonName = `${resolvedSeasonName} Playoffs`;
      let playoffSeasonId;
      const existingPS = await db.prepare('SELECT id FROM seasons WHERE name = ?').get(playoffSeasonName);
      if (existingPS) {
        playoffSeasonId = existingPS.id;
      } else {
        const r = await db.prepare('INSERT INTO seasons (name, is_active, league_type, is_playoff) VALUES (?, 0, ?, 1)').run(playoffSeasonName, resolvedLt);
        playoffSeasonId = r.lastInsertRowid;
      }

      // Create / find the playoff bracket
      let playoffId;
      const existingPlayoff = await db.prepare('SELECT id FROM playoffs WHERE season_id = ?').get(seasonId);
      if (existingPlayoff) {
        playoffId = existingPlayoff.id;
      } else {
        const playoffTeamNames = new Set();
        for (const g of playoffGames) {
          playoffTeamNames.add(decodeEntities(g.home_team));
          playoffTeamNames.add(decodeEntities(g.away_team));
        }
        const r = await db.prepare(
          'INSERT INTO playoffs (season_id, teams_qualify, min_games_played, series_length, playoff_season_id) VALUES (?, ?, 0, 7, ?)'
        ).run(seasonId, playoffTeamNames.size, playoffSeasonId);
        playoffId = r.lastInsertRowid;
        let seed = 1;
        for (const teamName of playoffTeamNames) {
          const teamId = await getOrCreateTeam(teamName);
          if (teamId) {
            await db.prepare('INSERT INTO playoff_teams (playoff_id, team_id, seed) VALUES (?, ?, ?)').run(playoffId, teamId, seed++);
          }
        }
      }

      // Group games by round then by matchup
      const roundMap = new Map();
      for (const g of playoffGames) {
        const rn = parseRoundNumber(g.playoff_round);
        if (!roundMap.has(rn)) roundMap.set(rn, new Map());
        const matchups = roundMap.get(rn);
        const t1 = decodeEntities(g.home_team);
        const t2 = decodeEntities(g.away_team);
        const matchupKey = [t1, t2].sort().join('\0');
        if (!matchups.has(matchupKey)) matchups.set(matchupKey, []);
        matchups.get(matchupKey).push(g);
      }

      // Create series and insert games
      for (const [roundNumber, matchups] of roundMap) {
        let seriesNum = 1;
        for (const [, seriesGames] of matchups) {
          const t1Name = decodeEntities(seriesGames[0].home_team);
          const t2Name = decodeEntities(seriesGames[0].away_team);
          const t1Id = await getOrCreateTeam(t1Name);
          const t2Id = await getOrCreateTeam(t2Name);

          // Check if series already exists
          let seriesId;
          const existingSeries = await db.prepare(
            'SELECT id FROM playoff_series WHERE playoff_id = ? AND round_number = ? AND ((high_seed_id = ? AND low_seed_id = ?) OR (high_seed_id = ? AND low_seed_id = ?))'
          ).get(playoffId, roundNumber, t1Id, t2Id, t2Id, t1Id);

          if (existingSeries) {
            seriesId = existingSeries.id;
          } else {
            // Determine seeds
            const s1 = await db.prepare('SELECT seed FROM playoff_teams WHERE playoff_id = ? AND team_id = ?').get(playoffId, t1Id);
            const s2 = await db.prepare('SELECT seed FROM playoff_teams WHERE playoff_id = ? AND team_id = ?').get(playoffId, t2Id);
            const seed1 = s1 ? s1.seed : 99;
            const seed2 = s2 ? s2.seed : 99;
            const highSeedId = seed1 <= seed2 ? t1Id : t2Id;
            const lowSeedId  = seed1 <= seed2 ? t2Id : t1Id;
            const highSeedNum = Math.min(seed1, seed2);
            const lowSeedNum  = Math.max(seed1, seed2);

            // Tally wins
            let highWins = 0, lowWins = 0;
            for (const sg of seriesGames) {
              const hScore = parseInt(sg.home_score, 10) || 0;
              const aScore = parseInt(sg.away_score, 10) || 0;
              const sgHomeId = await getOrCreateTeam(decodeEntities(sg.home_team));
              const winnerId = hScore > aScore ? sgHomeId : await getOrCreateTeam(decodeEntities(sg.away_team));
              if (winnerId === highSeedId) highWins++;
              else lowWins++;
            }
            const winnerId = highWins > lowWins ? highSeedId : (lowWins > highWins ? lowSeedId : null);

            const sr = await db.prepare(
              'INSERT INTO playoff_series (playoff_id, round_number, series_number, high_seed_id, low_seed_id, high_seed_num, low_seed_num, high_seed_wins, low_seed_wins, winner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(playoffId, roundNumber, seriesNum, highSeedId, lowSeedId, highSeedNum, lowSeedNum, highWins, lowWins, winnerId);
            seriesId = sr.lastInsertRowid;
            summary.playoff_series_created++;
          }

          for (const g of seriesGames) {
            await insertGameWithStats(g, playoffSeasonId, seriesId);
          }
          seriesNum++;
        }
      }
    }

    res.json({ ok: true, summary });
  } catch (err) {
    console.error('[import-mso-json] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Excel schedule import ──────────────────────────────────────────────────
// POST /api/admin/import-excel
// Accepts a multipart/form-data request with:
//   file        — .xlsx / .xls Excel file (schedule exported from mystatsonline)
//   season_name — string, name for this season
//   league_type — "threes" | "sixes" | ""
//   league_id   — numeric mystatsonline league ID (e.g. 73879)
//                 used to build the game-detail URL for fetching player stats.
//
// Excel column layout (flexible — detected from header row):
//   Date / Time  |  Home team  |  Home score  |  OT  |  Away score  |  Away team  |  Location  |  Status  |  IDGame
//
// For each game row that has an IDGame value the server fetches:
//   https://www.mystatsonline.com/hockey/visitor/league/schedule_scores/game_score_hockey.aspx?IDLeague=<id>&IDGame=<id>
// and parses the skater / goalie stats tables, storing them in game_player_stats.

// ── shared HTML / HTTP helpers (used by the Excel import only) ────────────

function _mso_fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(url); } catch (e) { return reject(e); }
    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EHL-Importer/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    };
    const req = lib.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        return resolve(_mso_fetchUrl(next, redirectCount + 1));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('Request timed out')); });
    req.end();
  });
}

function _mso_stripTags(str) {
  let t = str.replace(/<[^>]*>/g, ' ');
  t = t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
       .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  t = t.replace(/&#\d+;/g, ' ').replace(/&#x[\da-fA-F]+;/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function _mso_parseTableHtml(tableHtml) {
  const rows = [];
  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  let rowM;
  while ((rowM = rowRe.exec(tableHtml)) !== null) {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellM;
    while ((cellM = cellRe.exec(rowM[0])) !== null) cells.push(_mso_stripTags(cellM[1]));
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function _mso_colIdx(headers, ...names) {
  for (const name of names) {
    const idx = headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
    if (idx >= 0) return idx;
  }
  for (const name of names) {
    if (name.length <= 2) continue;
    const idx = headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

function _mso_num(val) {
  if (val === undefined || val === null || val === '' || val === '-') return 0;
  const n = parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function _mso_parseGameDetailHtml(html) {
  const homePlayers = [];
  const awayPlayers = [];
  // Extract only leaf tables (innermost tables that contain no nested <table>).
  // The MSO game-score page wraps stats tables inside layout tables; the old
  // lazy regex stopped at the FIRST </table> and handed us a mangled outer-table
  // chunk instead of the actual data table.  A stack-based scan fixes this.
  const rawTables = [];
  {
    const lc = html.toLowerCase();
    let pos = 0;
    while (pos < lc.length) {
      const tStart = lc.indexOf('<table', pos);
      if (tStart === -1) break;
      const tOpenEnd = lc.indexOf('>', tStart);
      if (tOpenEnd === -1) break;
      let depth = 1, scanPos = tOpenEnd + 1, tEnd = -1;
      while (scanPos < lc.length) {
        const nextOpen  = lc.indexOf('<table', scanPos);
        const nextClose = lc.indexOf('</table', scanPos);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) { depth++; scanPos = nextOpen + 1; }
        else { depth--; if (depth === 0) { tEnd = nextClose + 8; break; } scanPos = nextClose + 1; }
      }
      if (tEnd === -1) { pos++; continue; }
      const tableHtml = html.slice(tStart, tEnd);
      // Only keep leaf tables (no nested <table> inside the opening tag's content)
      if (!/<table/i.test(tableHtml.slice(tableHtml.indexOf('>') + 1))) {
        rawTables.push({ tableHtml, start: tStart });
      }
      pos = tStart + 1; // advance by 1 so we also descend into any nested tables
    }
    rawTables.sort((a, b) => a.start - b.start);
  }

  // Walk leaf tables in document order.  The HTML between consecutive leaf
  // tables contains the section headings ("Visitor"/"Home") that tell us which
  // team each table belongs to.  MSO lists the visiting team first, so we
  // default sectionIsAway = true.
  let sectionIsAway = true;
  let hasDetectedSection = false;
  let prevEnd = 0;
  const skaterTables = []; // { rows, isAway }
  const goalieTables = [];

  for (const { tableHtml, start } of rawTables) {
    const interText = html.slice(prevEnd, start).toLowerCase();
    if (/\b(visitor|visitors|visiting|away)\b/.test(interText)) {
      sectionIsAway = true;
      hasDetectedSection = true;
    } else if (/\bhome\b/.test(interText) && !/\b(away|visitor)\b/.test(interText)) {
      sectionIsAway = false;
      hasDetectedSection = true;
    }
    prevEnd = start + tableHtml.length;

    const rows = _mso_parseTableHtml(tableHtml);
    if (rows.length < 2) continue;
    const headers = rows[0].map(h => h.toLowerCase());

    const hasGoalieNameCol = headers.some(h => h === 'goalies' || h === 'goalie');
    const hasShotsAgainst  = headers.some(h => h === 'sa' || h.includes('shots against') || h.includes('shots a'));
    const hasSaves         = headers.some(h => h === 'sv' || h === 'saves' || h === 'svs');
    const isGoalie = (hasGoalieNameCol || hasShotsAgainst) && hasSaves;

    const hasPlayerCol  = headers.some(h => h === 'players' || h === 'player' || h === 'name' || h === 'skater');
    const hasGoalsCol   = headers.some(h => h === 'g' || h === 'goals');
    const hasAssistsCol = headers.some(h => h === 'a' || h === 'assists');
    // Position column is not always present (e.g. 3-on-3 formats) — don't require it
    const isSkater = hasPlayerCol && hasGoalsCol && hasAssistsCol;

    if (isGoalie)      goalieTables.push({ rows, isAway: sectionIsAway });
    else if (isSkater) skaterTables.push({ rows, isAway: sectionIsAway });
  }

  // No section headings found → fall back to positional assumption:
  // first stats block = away/visitor (index 0), second = home (index 1)
  if (!hasDetectedSection) {
    skaterTables.forEach((t, i) => { t.isAway = (i === 0); });
    goalieTables.forEach((t, i) => { t.isAway = (i === 0); });
  }

  const _parseSkaters = (rows, target) => {
    const h = rows[0].map(v => v.toLowerCase());
    const playerIdx= _mso_colIdx(h, 'players','player','name');
    const posIdx   = _mso_colIdx(h, 'pos','position');
    const gIdx     = _mso_colIdx(h, 'g','goals');
    const aIdx     = _mso_colIdx(h, 'a','assists');
    const sIdx     = _mso_colIdx(h, 's','shots');
    const pimIdx   = _mso_colIdx(h, 'pim');
    const pmIdx    = _mso_colIdx(h, '+/-','plus/minus','plusminus');
    const ppgIdx   = _mso_colIdx(h, 'ppg','pp');
    const shgIdx   = _mso_colIdx(h, 'shg','sh');
    const gwgIdx   = _mso_colIdx(h, 'wg','gwg','game winning');
    const hitsIdx  = _mso_colIdx(h, 'hits');
    const bsIdx    = _mso_colIdx(h, 'bs','blocked');
    const fowIdx   = _mso_colIdx(h, 'fow','fo wins','faceoff wins');
    const foIdx    = _mso_colIdx(h, 'fo','faceoffs');
    const gvaIdx   = _mso_colIdx(h, 'gva','giveaways');
    const tkaIdx   = _mso_colIdx(h, 'tka','takeaways');
    const toiIdx   = _mso_colIdx(h, 'toi','time on ice');

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const name = playerIdx >= 0 ? row[playerIdx] : '';
      if (!name || /^totals?$/i.test(name)) continue;
      const pos = posIdx >= 0 ? row[posIdx].toUpperCase() : 'F';
      if (pos === 'G') continue;
      const foW   = fowIdx >= 0 ? _mso_num(row[fowIdx]) : 0;
      const foTot = foIdx >= 0 && foIdx !== fowIdx ? _mso_num(row[foIdx]) : 0;
      target.push({
        player_name:    name.trim(),
        position:       pos || 'F',
        goals:          gIdx   >= 0 ? _mso_num(row[gIdx])   : 0,
        assists:        aIdx   >= 0 ? _mso_num(row[aIdx])   : 0,
        shots:          sIdx   >= 0 ? _mso_num(row[sIdx])   : 0,
        pim:            pimIdx >= 0 ? _mso_num(row[pimIdx]) : 0,
        plus_minus:     pmIdx  >= 0 ? _mso_num(row[pmIdx])  : 0,
        pp_goals:       ppgIdx >= 0 ? _mso_num(row[ppgIdx]) : 0,
        sh_goals:       shgIdx >= 0 ? _mso_num(row[shgIdx]) : 0,
        gwg:            gwgIdx >= 0 ? _mso_num(row[gwgIdx]) : 0,
        hits:           hitsIdx>= 0 ? _mso_num(row[hitsIdx]): 0,
        blocked_shots:  bsIdx  >= 0 ? _mso_num(row[bsIdx])  : 0,
        faceoff_wins:   foW,
        faceoff_losses: foTot > foW ? foTot - foW : 0,
        giveaways:      gvaIdx >= 0 ? _mso_num(row[gvaIdx]) : 0,
        takeaways:      tkaIdx >= 0 ? _mso_num(row[tkaIdx]) : 0,
        toi:            toiIdx >= 0 ? _mso_num(row[toiIdx]) * 60 : 0, // MSO TOI is minutes; convert to seconds
      });
    }
  };

  const _parseGoalies = (rows, target) => {
    const h = rows[0].map(v => v.toLowerCase());
    const playerIdx= _mso_colIdx(h, 'goalies','goalie','players','player','name');
    const saIdx    = _mso_colIdx(h, 'sa','shots against','shots a');
    const gaIdx    = _mso_colIdx(h, 'ga','goals against');
    const svIdx    = _mso_colIdx(h, 'sv','saves');
    const gaaIdx   = _mso_colIdx(h, 'gaa');
    const svpIdx   = _mso_colIdx(h, 'sv%','save%','save pct');
    const soIdx    = _mso_colIdx(h, 'so','shutouts');
    const wIdx     = _mso_colIdx(h, 'w','wins');
    const lIdx     = _mso_colIdx(h, 'l','losses');
    const toiIdx   = _mso_colIdx(h, 'toi','time on ice');
    const psaIdx   = _mso_colIdx(h, 'psa','penalty shot attempts');
    const psgaIdx  = _mso_colIdx(h, 'psga','penalty shot goals');
    const otwIdx   = _mso_colIdx(h, 'otw','ot win');
    const otlIdx   = _mso_colIdx(h, 'otl','ot loss');

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const name = playerIdx >= 0 ? row[playerIdx] : '';
      if (!name || /^totals?$/i.test(name)) continue;
      const svpRaw = svpIdx >= 0 ? row[svpIdx] : '';
      const svp = svpRaw
        ? parseFloat(svpRaw.replace('%','').trim()) / (svpRaw.includes('%') ? 100 : 1)
        : null;
      target.push({
        player_name:   name.trim(),
        position:      'G',
        goals: 0, assists: 0,
        shots_against: saIdx  >= 0 ? _mso_num(row[saIdx])  : 0,
        goals_against: gaIdx  >= 0 ? _mso_num(row[gaIdx])  : 0,
        saves:         svIdx  >= 0 ? _mso_num(row[svIdx])  : 0,
        save_pct:      (svp != null && !isNaN(svp)) ? Math.round(svp * 1000) / 1000 : null,
        gaa:           gaaIdx >= 0 && row[gaaIdx] ? parseFloat(row[gaaIdx]) || null : null,
        shutouts:      soIdx  >= 0 ? _mso_num(row[soIdx])  : 0,
        goalie_wins:   wIdx   >= 0 ? _mso_num(row[wIdx])   : 0,
        goalie_losses: lIdx   >= 0 ? _mso_num(row[lIdx])   : 0,
        goalie_otw:    otwIdx >= 0 ? _mso_num(row[otwIdx]) : 0,
        goalie_otl:    otlIdx >= 0 ? _mso_num(row[otlIdx]) : 0,
        toi:           toiIdx >= 0 ? _mso_num(row[toiIdx]) * 60 : 0, // MSO TOI is minutes; convert to seconds
        penalty_shot_attempts: psaIdx  >= 0 ? _mso_num(row[psaIdx])  : 0,
        penalty_shot_ga:       psgaIdx >= 0 ? _mso_num(row[psgaIdx]) : 0,
      });
    }
  };

  for (const t of skaterTables) _parseSkaters(t.rows, t.isAway ? awayPlayers : homePlayers);
  for (const t of goalieTables) _parseGoalies(t.rows, t.isAway ? awayPlayers : homePlayers);

  return { homePlayers, awayPlayers };
}

// ── Excel schedule import endpoint ────────────────────────────────────────

app.post('/api/admin/import-excel', requireOwner, excelUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No Excel file uploaded.' });

  const seasonName  = String(req.body.season_name  || '').trim();
  const leagueType  = String(req.body.league_type  || '').trim();
  const leagueId    = String(req.body.league_id    || '').trim();

  if (!seasonName) return res.status(400).json({ error: '"season_name" is required.' });

  // ── Parse the workbook ─────────────────────────────────────────────────
  let workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ error: `Could not parse Excel file: ${e.message}` });
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) return res.status(400).json({ error: 'The workbook contains no worksheets.' });

  // ── Find the header row ────────────────────────────────────────────────
  // Scan rows top→bottom for the first row containing "home team" (case-insensitive).
  let headerRowNum = -1;
  let colHomeTeam = -1, colHomeScore = -1, colOT = -1, colAwayScore = -1;
  let colAwayTeam = -1, colStatus = -1, colIdGame = -1, colDateTime = -1;

  sheet.eachRow((row, rowNum) => {
    if (headerRowNum >= 0) return; // already found
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      vals[colNum - 1] = String(cell.value ?? '').trim().toLowerCase();
    });
    if (vals.some(v => v.includes('home team') || v === 'home')) {
      headerRowNum = rowNum;
      vals.forEach((v, i) => {
        if (v.includes('date') || v.includes('time')) colDateTime   = i;
        if (v.includes('home team') || v === 'home')  colHomeTeam   = i;
        if (v.includes('away team') || v === 'away' || v.includes('visitor') || v === 'vis') colAwayTeam = i;
        if (v.includes('status'))                     colStatus     = i;
        if (v.includes('idgame') || v.includes('id game') || v === 'id') colIdGame = i;
      });
      // Home score: first blank/numeric column after home team, before away team
      if (colHomeTeam >= 0 && colAwayTeam > colHomeTeam) {
        for (let c = colHomeTeam + 1; c < colAwayTeam; c++) {
          if (vals[c] === '') {
            if (colHomeScore < 0) { colHomeScore = c; continue; }
            if (colOT < 0)        { colOT = c;        continue; }
            if (colAwayScore < 0) { colAwayScore = c; break; }
          }
        }
        // fallback: just use colHomeTeam+1 and colHomeTeam+2
        if (colHomeScore < 0) colHomeScore = colHomeTeam + 1;
        if (colOT < 0)        colOT        = colHomeTeam + 2;
        if (colAwayScore < 0 && colOT >= 0) colAwayScore = colOT + 1;
      }
      // Outer fallback when the away-team column was not found by header name
      // (e.g. the export labels it "Visitor" and the inner block didn't run)
      if (colHomeTeam >= 0) {
        if (colHomeScore < 0) colHomeScore = colHomeTeam + 1;
        if (colOT < 0)        colOT        = colHomeScore + 1;
        if (colAwayScore < 0) colAwayScore = colOT + 1;
        if (colAwayTeam < 0)  colAwayTeam  = colAwayScore + 1;
      }
    }
  });

  // If no header row with "home team" was found, try a positional fallback
  if (headerRowNum < 0) {
    // Assume standard layout: A=datetime, B=home, C=homeScore, D=OT, E=awayScore, F=away, G=loc, H=status, I=IDGame
    headerRowNum = 0; // will skip 0 rows before data
    colDateTime  = 0; colHomeTeam  = 1; colHomeScore = 2;
    colOT        = 3; colAwayScore = 4; colAwayTeam  = 5;
    colStatus    = 7; colIdGame    = 8;
  }

  // ── Collect game rows ──────────────────────────────────────────────────
  const games = [];
  let currentDate = '';

  sheet.eachRow((row, rowNum) => {
    if (rowNum <= headerRowNum) return; // skip header and anything above

    const cells = [];
    // Read all cells including empty (1-indexed in exceljs; we convert to 0-indexed)
    const maxCol = Math.max(colIdGame, colAwayTeam, colStatus, colAwayScore, colOT, colHomeScore, colHomeTeam) + 2;
    for (let c = 1; c <= maxCol + 1; c++) {
      const cell = row.getCell(c);
      let val = cell.value;
      if (val instanceof Date) val = val.toISOString();
      else if (val && typeof val === 'object' && val.result !== undefined) val = val.result; // formula
      cells[c - 1] = String(val ?? '').trim();
    }

    const dateTimeVal = cells[colDateTime] || '';
    const homeTeamVal = cells[colHomeTeam] || '';

    // Detect date-header rows (e.g. "Saturday September 7, 2024")
    // They typically have no home team value and the first cell looks like a date
    if (!homeTeamVal && dateTimeVal) {
      // Try to parse as a date string
      const d = new Date(dateTimeVal);
      if (!isNaN(d.getTime())) {
        currentDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      } else {
        // Could be "Saturday September 7, 2024" — strip day-of-week and try
        const stripped = dateTimeVal.replace(/^[a-zA-Z]+\s*/,'');
        const d2 = new Date(stripped);
        if (!isNaN(d2.getTime())) {
          currentDate = `${d2.getFullYear()}-${String(d2.getMonth()+1).padStart(2,'0')}-${String(d2.getDate()).padStart(2,'0')}`;
        } else {
          // ISO date embedded somewhere?
          const iso = dateTimeVal.match(/(\d{4}-\d{2}-\d{2})/);
          if (iso) currentDate = iso[1];
        }
      }
      return; // not a game row
    }

    if (!homeTeamVal) return; // blank row

    // It's a game row — try to use the date portion of column A as a date if it looks like one
    // (some exports put the full date+time in col A for every row)
    let gameDate = currentDate;
    if (dateTimeVal) {
      const d = new Date(dateTimeVal);
      if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
        gameDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      } else {
        const iso = dateTimeVal.match(/(\d{4}-\d{2}-\d{2})/);
        if (iso) gameDate = iso[1];
      }
    }

    const awayTeamVal  = colAwayTeam  >= 0 ? (cells[colAwayTeam]  || '') : '';
    const homeScoreVal = colHomeScore >= 0 ? (cells[colHomeScore] || '') : '';
    const awayScoreVal = colAwayScore >= 0 ? (cells[colAwayScore] || '') : '';
    const otVal        = colOT        >= 0 ? (cells[colOT]        || '') : '';
    const statusVal    = colStatus    >= 0 ? (cells[colStatus]    || '') : '';
    const idGameVal    = colIdGame    >= 0 ? (cells[colIdGame]    || '') : '';

    const homeScore = parseInt(homeScoreVal, 10);
    const awayScore = parseInt(awayScoreVal, 10);
    const isOT      = /^OT$/i.test(otVal.trim());
    const idGame    = idGameVal.trim();

    if (!awayTeamVal) return; // must have away team

    games.push({
      date:       gameDate,
      home_team:  homeTeamVal.trim(),
      away_team:  awayTeamVal.trim(),
      home_score: isNaN(homeScore) ? 0 : homeScore,
      away_score: isNaN(awayScore) ? 0 : awayScore,
      is_overtime: isOT ? 1 : 0,
      status:     statusVal.trim(),
      idGame,
    });
  });

  if (games.length === 0) {
    return res.status(400).json({ error: 'No game rows found in the uploaded file. Check that the file has the expected column layout (Home team, Away team, IDGame).' });
  }

  // ── DB helpers ────────────────────────────────────────────────────────
  const teamCache = new Map();

  async function getOrCreateTeam(name) {
    if (!name) return null;
    if (teamCache.has(name)) return teamCache.get(name);
    let row = await db.prepare('SELECT id FROM teams WHERE name = ?').get(name);
    if (!row) {
      const r = await db.prepare('INSERT INTO teams (name, conference, division, league_type, color1, color2) VALUES (?, \'\', \'\', ?, \'\', \'\')').run(name, leagueType || '');
      teamCache.set(name, r.lastInsertRowid);
      summary.teams_created++;
      return r.lastInsertRowid;
    }
    teamCache.set(name, row.id);
    return row.id;
  }

  const summary = {
    season: seasonName,
    teams_created: 0,
    games_created: 0,
    games_skipped: 0,
    stats_fetched: 0,
    stats_skipped: 0,
    errors: [],
  };

  // ── Create / find the season ──────────────────────────────────────────
  let seasonId;
  const existingSeason = await db.prepare('SELECT id FROM seasons WHERE name = ?').get(seasonName);
  if (existingSeason) {
    seasonId = existingSeason.id;
  } else {
    const r = await db.prepare('INSERT INTO seasons (name, is_active, league_type) VALUES (?, 0, ?)').run(seasonName, leagueType || '');
    seasonId = r.lastInsertRowid;
  }

  // ── Insert games ──────────────────────────────────────────────────────
  const gameIds = []; // { dbId, game } pairs for games that need stat fetching
  for (const g of games) {
    if (!g.date) { summary.games_skipped++; continue; }
    const homeId = await getOrCreateTeam(g.home_team);
    const awayId = await getOrCreateTeam(g.away_team);
    if (!homeId || !awayId) { summary.games_skipped++; continue; }

    let existing = await db.prepare('SELECT id FROM games WHERE home_team_id=? AND away_team_id=? AND date=?').get(homeId, awayId, g.date);
    let dbId;
    if (existing) {
      dbId = existing.id;
      summary.games_skipped++;
    } else {
      const statusRaw = (g.status || '').toLowerCase();
      const status = /forfeit/i.test(statusRaw) ? 'forfeit'
                   : /complete/i.test(statusRaw) ? 'complete'
                   : (g.status || 'complete');
      const r = await db.prepare(`
        INSERT INTO games (home_team_id, away_team_id, home_score, away_score, date, status, season_id, is_overtime)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(homeId, awayId, g.home_score, g.away_score, g.date, status, seasonId, g.is_overtime);
      dbId = r.lastInsertRowid;
      summary.games_created++;
    }
    gameIds.push({ dbId, homeId, awayId, game: g });
  }

  // ── Fetch player stats from mystatsonline (async, per-game) ───────────
  if (leagueId) {
    for (const { dbId, homeId, awayId, game } of gameIds) {
      if (!game.idGame || /forfeit/i.test(game.status || '')) continue;
      const url = `https://www.mystatsonline.com/hockey/visitor/league/schedule_scores/game_score_hockey.aspx?IDLeague=${leagueId}&IDGame=${game.idGame}`;
      try {
        const { status, body } = await _mso_fetchUrl(url);
        if (status !== 200) {
          summary.errors.push(`IDGame ${game.idGame}: HTTP ${status}`);
          summary.stats_skipped++;
          continue;
        }
        const { homePlayers, awayPlayers } = _mso_parseGameDetailHtml(body);
        if (homePlayers.length === 0 && awayPlayers.length === 0) {
          summary.stats_skipped++;
          continue;
        }

        const homeWon = game.home_score > game.away_score;
        const awayWon = game.away_score > game.home_score;
        const isOT    = game.is_overtime === 1;

        // Delete any existing stats for this game, then insert all players
        await db.prepare('DELETE FROM game_player_stats WHERE game_id = ?').run(dbId);
        const insertPlayers = async (players, teamId, teamWon) => {
          for (const p of players) {
            const isGoalie = p.position === 'G';
            let gw = 0, gl = 0, otw = 0, otl = 0, so = 0;
            if (isGoalie) {
              so = (p.goals_against || 0) === 0 ? 1 : 0;
              if (teamWon) { if (isOT) otw = 1; else gw = 1; }
              else         { if (isOT) otl = 1; else gl = 1; }
            }
            await db.prepare(`
              INSERT INTO game_player_stats
                (game_id, team_id, player_name, position,
                 goals, assists, shots, pim, plus_minus, blocked_shots,
                 faceoff_wins, faceoff_losses, giveaways, takeaways, pp_goals, sh_goals, gwg, hits, toi,
                 saves, save_pct, goals_against, shots_against,
                 goalie_wins, goalie_losses, goalie_otw, goalie_otl, shutouts,
                 penalty_shot_attempts, penalty_shot_ga)
              VALUES (?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?)
            `).run(
              dbId, teamId, p.player_name, p.position,
              p.goals || 0, p.assists || 0, p.shots || 0, p.pim || 0,
              p.plus_minus || 0, p.blocked_shots || 0,
              p.faceoff_wins || 0, p.faceoff_losses || 0,
              p.giveaways || 0, p.takeaways || 0,
              p.pp_goals || 0, p.sh_goals || 0, p.gwg || 0, p.hits || 0, p.toi || 0,
              p.saves || 0, p.save_pct != null ? p.save_pct : null,
              p.goals_against || 0, p.shots_against || 0,
              gw, gl, otw, otl, so,
              p.penalty_shot_attempts || 0, p.penalty_shot_ga || 0
            );
          }
        };
        await insertPlayers(homePlayers, homeId, homeWon);
        await insertPlayers(awayPlayers, awayId, awayWon);
        summary.stats_fetched++;
      } catch (e) {
        summary.errors.push(`IDGame ${game.idGame}: ${e.message}`);
        summary.stats_skipped++;
      }
      // Polite delay between requests
      await new Promise(r => setTimeout(r, 250));
    }
  }

  res.json({ ok: true, summary });
});

// ── Global error handler ───────────────────────────────────────────────────
// Catches multer errors (file too large, wrong type) and returns JSON so the
// browser never sees a connection-reset "network error".
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum allowed size is 20 MB.' });
  }
  if (err && (err.message === 'Only image files are allowed' ||
              err.message === 'Only Excel files (.xlsx / .xls) are allowed')) {
    return res.status(400).json({ error: err.message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──────────────────────────────────────────────────────────────────

if (!process.env.VERCEL) {
app.listen(PORT, () => {
  console.log(`EHL server running at http://localhost:${PORT}`);
  console.log(`Owner Discord ID: ${OWNER_DISCORD_ID}`);
});
}

module.exports = app;
