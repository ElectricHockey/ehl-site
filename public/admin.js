const API = '/api';

// ── Shared helpers ──────────────────────────────────────────────────────────
const typeLabel = lt => lt === 'threes' ? "3's" : lt === 'sixes' ? "6's" : lt || '?';

// ── Admin league filter (3's or 6's) ───────────────────────────────────────
let adminLeagueFilter = localStorage.getItem('ehl_admin_league') || 'threes';

function _syncLeagueFormDefaults(league) {
  // Auto-set the season form league type selector
  const seasonType = document.getElementById('season-type');
  if (seasonType) seasonType.value = league;
  // Auto-set the team form league type selector
  const teamLt = document.getElementById('team-league-type');
  if (teamLt) teamLt.value = league;
}

function setAdminLeague(league) {
  adminLeagueFilter = league;
  localStorage.setItem('ehl_admin_league', league);
  document.querySelectorAll('.admin-league-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.league === league);
  });
  // Sync form defaults to the new league
  _syncLeagueFormDefaults(league);
  // Reload data for the active sections
  loadSeasons();
  loadTeams();
  loadGames();
}

function getPlayerToken() { return localStorage.getItem('ehl_player_token') || ''; }
function getAdminToken() { return localStorage.getItem('ehl_admin_token') || ''; }
function getAdminRole() { return localStorage.getItem('ehl_admin_role') || ''; }
function adminHeaders() { return { 'X-Admin-Token': getAdminToken() }; }
function adminJsonHeaders() { return { 'Content-Type': 'application/json', 'X-Admin-Token': getAdminToken() }; }

/** Escape a value for safe use inside an HTML attribute (e.g. data-foo="..."). */
function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showStatus(msg, isError = false) {
  const el = document.getElementById('status-msg');
  if (!el) return;
  el.textContent = msg;
  el.className = isError ? 'error' : 'success';
}

function previewLogo(input, previewId) {
  const img = document.getElementById(previewId);
  if (!img) return;
  if (input.files && input.files[0]) {
    if (img._objectUrl) URL.revokeObjectURL(img._objectUrl);
    img._objectUrl = URL.createObjectURL(input.files[0]);
    img.src = img._objectUrl;
    img.style.display = 'block';
  } else {
    if (img._objectUrl) { URL.revokeObjectURL(img._objectUrl); img._objectUrl = null; }
    img.style.display = 'none';
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────

// Try the cached admin token first; if stale, exchange the player session for
// an admin token. If the player has no admin access, show the denied message.
async function checkAuth() {
  // 1. Validate existing admin token
  const adminToken = getAdminToken();
  if (adminToken) {
    try {
      const res = await fetch(`${API}/auth/status`, { headers: { 'X-Admin-Token': adminToken } });
      const data = await res.json();
      if (data.loggedIn) {
        localStorage.setItem('ehl_admin_role', data.role);
        localStorage.setItem('ehl_admin_username', data.username);
        showAdminPanel(data.role, data.username);
        return;
      }
    } catch { /* fall through */ }
    // Token is invalid – clear it and try player session below
    localStorage.removeItem('ehl_admin_token');
    localStorage.removeItem('ehl_admin_role');
    localStorage.removeItem('ehl_admin_username');
  }

  // 2. Try to obtain an admin token from the player session
  const playerToken = getPlayerToken();
  if (playerToken) {
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'X-Player-Token': playerToken },
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('ehl_admin_token', data.token);
        localStorage.setItem('ehl_admin_role', data.role);
        localStorage.setItem('ehl_admin_username', data.username);
        showAdminPanel(data.role, data.username);
        return;
      }
    } catch { /* fall through */ }
  }

  // 3. No valid session found – show access-denied message
  showLoginForm();
}

function showLoginForm() {
  document.getElementById('login-section').style.display = '';
  document.getElementById('admin-panel').style.display = 'none';
  const checking = document.getElementById('access-checking');
  const denied   = document.getElementById('access-denied');
  if (checking) checking.style.display = 'none';
  if (denied)   denied.style.display   = '';
}

function showAdminPanel(role, username) {
  role = role || getAdminRole() || '';
  username = username || localStorage.getItem('ehl_admin_username') || '';
  if (!role) { showLoginForm(); return; } // no role = not an admin
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('admin-panel').style.display = '';

  // Reveal the admin nav link now that access is confirmed
  const navLink = document.getElementById('nav-admin-link');
  if (navLink) navLink.style.display = '';

  // Update logged-in bar
  const roleLabel = role === 'owner' ? '👑 Owner' : '🎮 Game Admin';
  document.getElementById('logged-in-name').textContent = `${roleLabel}: ${username}`;

  // Set correct active state on league switcher buttons
  document.querySelectorAll('.admin-league-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.league === adminLeagueFilter);
  });

  // Sync form dropdowns to the stored league
  _syncLeagueFormDefaults(adminLeagueFilter);

  // Show/hide owner-only tabs
  document.querySelectorAll('.admin-tab-btn[data-owner-only]').forEach(btn => {
    btn.style.display = role === 'owner' ? '' : 'none';
  });

  // Load data and navigate to the appropriate starting tab
  loadTeams();
  loadSeasons();
  loadGames();

  if (role === 'owner') {
    loadPlayers();
    loadRegPlayers();
    loadAdminPlayoffs();
    loadGameAdmins();
    loadNameChangeRequests();
    showAdminTab('seasons');
  } else {
    // game_admin: land directly on Games
    showAdminTab('games');
  }
}

function showAdminTab(name) {
  document.querySelectorAll('.admin-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.admin-tab-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tab === name)
  );
  const sec = document.getElementById(`admin-tab-${name}`);
  if (sec) sec.classList.add('active');
  if (name === 'records-settings') loadRecordsSettings();
}

async function adminLogout() {
  await fetch(`${API}/auth/logout`, { method: 'POST', headers: adminHeaders() }).catch(() => {});
  localStorage.removeItem('ehl_admin_token');
  localStorage.removeItem('ehl_admin_role');
  localStorage.removeItem('ehl_admin_username');
  // Hide the admin nav link immediately so it disappears without a page reload
  const navLink = document.getElementById('nav-admin-link');
  if (navLink) navLink.style.display = 'none';
  showLoginForm();
}

// ── Game Admin Management ─────────────────────────────────────────────────

async function loadGameAdmins() {
  const container = document.getElementById('game-admins-list');
  if (!container) return;
  try {
    const res = await fetch(`${API}/admin/game-admins`, { headers: adminHeaders() });
    const admins = await res.json();
    if (!admins.length) {
      container.innerHTML = '<p style="color:#8b949e;font-size:0.88rem;">No game admins yet. Search for a user above to add one.</p>';
      return;
    }
    container.innerHTML = `<table style="width:100%;max-width:500px;border-collapse:collapse;">
      <thead><tr style="color:#8b949e;font-size:0.82rem;">
        <th style="text-align:left;padding:0.35rem 0.5rem;">Gamertag</th>
        <th style="text-align:left;padding:0.35rem 0.5rem;">Discord</th>
        <th style="padding:0.35rem 0.5rem;"></th>
      </tr></thead>
      <tbody>${admins.map(a => `
        <tr style="border-top:1px solid #21262d;">
          <td style="padding:0.4rem 0.5rem;">${escAttr(a.username)}</td>
          <td style="padding:0.4rem 0.5rem;color:#8b949e;">${escAttr(a.discord || '—')}</td>
          <td style="padding:0.4rem 0.5rem;text-align:right;">
            <button onclick="demoteGameAdmin(${a.id},'${escAttr(a.username)}')"
              style="background:#4b1f1f;color:#f85149;border:1px solid #f85149;border-radius:4px;padding:0.2rem 0.6rem;font-size:0.8rem;cursor:pointer;">
              Remove
            </button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  } catch { container.innerHTML = '<p style="color:#f85149;font-size:0.88rem;">Failed to load game admins.</p>'; }
}

let _searchTimeout = null;
async function searchUsersForAdmin() {
  clearTimeout(_searchTimeout);
  _searchTimeout = setTimeout(async () => {
    const q = document.getElementById('game-admin-search').value.trim();
    const resultsEl = document.getElementById('game-admin-search-results');
    if (!q) { resultsEl.innerHTML = ''; return; }
    try {
      const res = await fetch(`${API}/admin/users/search?q=${encodeURIComponent(q)}`, { headers: adminHeaders() });
      const users = await res.json();
      if (!users.length) { resultsEl.innerHTML = '<p style="color:#8b949e;font-size:0.85rem;">No users found.</p>'; return; }
      resultsEl.innerHTML = users.map(u => {
        const isAdmin = u.role === 'game_admin';
        const btnLabel = isAdmin ? 'Already admin' : 'Add as game admin';
        const btnStyle = isAdmin
          ? 'background:#21262d;color:#8b949e;border:1px solid #30363d;cursor:default;'
          : 'background:#1f4b2f;color:#3fb950;border:1px solid #3fb950;cursor:pointer;';
        return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0;border-bottom:1px solid #21262d;">
          <span style="flex:1;font-size:0.9rem;">${escAttr(u.username)}</span>
          <span style="color:#8b949e;font-size:0.82rem;">${escAttr(u.discord || '')}</span>
          <button style="${btnStyle}border-radius:4px;padding:0.2rem 0.6rem;font-size:0.8rem;"
            ${isAdmin ? 'disabled' : `onclick="promoteGameAdmin(${u.id},'${escAttr(u.username)}')"`}>
            ${btnLabel}
          </button>
        </div>`;
      }).join('');
    } catch { resultsEl.innerHTML = '<p style="color:#f85149;font-size:0.85rem;">Search failed.</p>'; }
  }, 300);
}

async function promoteGameAdmin(userId, username) {
  if (!confirm(`Make "${username}" a game admin? They will be able to log in and enter game results.`)) return;
  const res = await fetch(`${API}/admin/game-admins/${userId}`, { method: 'POST', headers: adminHeaders() });
  if (res.ok) {
    document.getElementById('game-admin-search').value = '';
    document.getElementById('game-admin-search-results').innerHTML = '';
    await loadGameAdmins();
  } else {
    const err = await res.json().catch(() => ({}));
    alert(err.error || 'Failed to promote user');
  }
}

async function demoteGameAdmin(userId, username) {
  if (!confirm(`Remove "${username}" as game admin?`)) return;
  const res = await fetch(`${API}/admin/game-admins/${userId}`, { method: 'DELETE', headers: adminHeaders() });
  if (res.ok) { await loadGameAdmins(); }
  else { const err = await res.json().catch(() => ({})); alert(err.error || 'Failed to remove game admin'); }
}

// ── Seasons ───────────────────────────────────────────────────────────────

let allSeasons = [];

async function loadSeasons() {
  const res = await fetch(`${API}/seasons`);
  allSeasons = await res.json();
  _wireGseAdmin(); // keep GSE season list in sync

  // Filter for display list by selected league
  const filtered = allSeasons.filter(s => !s.league_type || s.league_type === adminLeagueFilter);
  // Group playoff seasons directly above their parent regular season
  const nonPlayoff = filtered.filter(s => !s.is_playoff);
  const playoffSeasons = filtered.filter(s => s.is_playoff);
  const parentMap = new Map();
  for (const ps of playoffSeasons) {
    if (ps.parent_season_id) parentMap.set(ps.parent_season_id, ps);
  }
  const filteredSeasons = [];
  for (const s of nonPlayoff) {
    const ps = parentMap.get(s.id);
    if (ps) { filteredSeasons.push(ps); parentMap.delete(s.id); }
    filteredSeasons.push(s);
  }
  // Append any orphan playoff seasons not matched to a parent
  for (const ps of parentMap.values()) filteredSeasons.push(ps);
  const list = document.getElementById('seasons-list');

  if (filteredSeasons.length === 0) {
    list.innerHTML = `<p style="color:#8b949e;font-size:0.85rem;">No ${adminLeagueFilter === 'threes' ? "3's" : "6's"} seasons yet. Create one above.</p>`;
  } else {
    // Pre-compute the positions of non-playoff seasons so we can correctly
    // disable ▲ / ▼ at the boundaries without counting playoff-only rows.
    const regularIdxs = filteredSeasons.reduce((acc, s, i) => { if (!s.is_playoff) acc.push(i); return acc; }, []);
    list.innerHTML = filteredSeasons.map((s, idx) => {
      const riPos      = regularIdxs.indexOf(idx);
      const upDisabled = (!s.is_playoff && riPos <= 0) ? ' disabled' : '';
      const downDisabled = (!s.is_playoff && riPos >= regularIdxs.length - 1) ? ' disabled' : '';
      return `
      <div class="season-item">
        ${s.is_active ? '<span class="season-active-badge">★ Active</span>' : ''}
        ${s.is_playoff ? '<span style="background:#2d1b00;color:#e3b341;border:1px solid #9e6a03;border-radius:10px;padding:0.1rem 0.45rem;font-size:0.72rem;margin-right:0.25rem;">🏆 Playoffs</span>' : ''}
        <strong style="flex:1;">${s.name}</strong>
        <span style="color:#8b949e;font-size:0.8rem;">${typeLabel(s.league_type)}</span>
        ${!s.is_playoff ? `
        <button style="font-size:0.75rem;padding:0.15rem 0.4rem;background:#21262d;border:1px solid #30363d;color:#8b949e;border-radius:4px;cursor:pointer;" onclick="moveSeasonUp(${s.id})"${upDisabled} title="Move up">▲</button>
        <button style="font-size:0.75rem;padding:0.15rem 0.4rem;background:#21262d;border:1px solid #30363d;color:#8b949e;border-radius:4px;cursor:pointer;" onclick="moveSeasonDown(${s.id})"${downDisabled} title="Move down">▼</button>
        ` : ''}
        ${!s.is_active && !s.is_playoff ? `<button class="btn-secondary" style="font-size:0.8rem;padding:0.25rem 0.6rem;" onclick="setActiveSeason(${s.id})">Set Active</button>` : ''}
        <button class="btn-danger" style="font-size:0.8rem;padding:0.25rem 0.6rem;" onclick="deleteSeason(${s.id}, ${s.is_playoff ? 'true' : 'false'})">Delete</button>
      </div>`;
    }).join('');
  }

  // Populate season dropdowns in game form – filtered by current league, exclude auto-created playoff seasons
  const regularSeasons = allSeasons.filter(s => !s.is_playoff && (!s.league_type || s.league_type === adminLeagueFilter));
  const seasonOpts = '<option value="">— No Season —</option>' +
    regularSeasons.map(s => `<option value="${s.id}"${s.is_active ? ' selected' : ''}>${s.name} (${typeLabel(s.league_type)})</option>`).join('');
  document.getElementById('game-season').innerHTML = seasonOpts;

  // Populate MSO import season dropdown (all regular seasons, not filtered by league)
  const msoSeasonSelect = document.getElementById('mso-season-select');
  if (msoSeasonSelect) {
    const allRegular = allSeasons.filter(s => !s.is_playoff);
    msoSeasonSelect.innerHTML = '<option value="">– Create new season –</option>' +
      allRegular.map(s => `<option value="${s.id}">${s.name} (${typeLabel(s.league_type)})${s.is_active ? ' ★' : ''}</option>`).join('');
  }
}

document.getElementById('season-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('season-name').value.trim();
  const make_active = document.getElementById('season-active').checked;
  const league_type = document.getElementById('season-type').value;
  const res = await fetch(`${API}/seasons`, {
    method: 'POST', headers: adminJsonHeaders(),
    body: JSON.stringify({ name, make_active, league_type }),
  });
  if (res.ok) { e.target.reset(); await loadSeasons(); await loadGames(); }
});

async function setActiveSeason(id) {
  await fetch(`${API}/seasons/${id}`, { method: 'PATCH', headers: adminJsonHeaders(), body: JSON.stringify({ is_active: true }) });
  await loadSeasons();
}

async function deleteSeason(id, isPlayoff) {
  const msg = isPlayoff
    ? 'Delete this playoff season? All games, stats, playoff brackets, and series will be permanently deleted.'
    : 'Delete this season? All games and stats from this season will be permanently deleted.';
  if (!confirm(msg)) return;
  await fetch(`${API}/seasons/${id}`, { method: 'DELETE', headers: adminHeaders() });
  await loadSeasons(); await loadGames();
}

async function moveSeasonUp(id) {
  await fetch(`${API}/seasons/${id}/reorder`, {
    method: 'POST', headers: adminJsonHeaders(),
    body: JSON.stringify({ direction: 'up' }),
  });
  await loadSeasons();
}

async function moveSeasonDown(id) {
  await fetch(`${API}/seasons/${id}/reorder`, {
    method: 'POST', headers: adminJsonHeaders(),
    body: JSON.stringify({ direction: 'down' }),
  });
  await loadSeasons();
}

// ── Teams ─────────────────────────────────────────────────────────────────

function colorSwatch(hex) {
  if (!hex) return '—';
  return `<span style="display:inline-block;width:18px;height:18px;border-radius:3px;background:${hex};border:1px solid #30363d;vertical-align:middle;" title="${hex}"></span>`;
}

async function loadTeams() {
  const res = await fetch(`${API}/teams`);
  const allTeams = await res.json();
  // Filter teams table display by selected league
  const teams = allTeams.filter(t => !t.league_type || t.league_type === adminLeagueFilter);
  const tbody = document.querySelector('#teams-table tbody');
  const ltLabel = lt => lt === 'threes' ? '3v3' : lt === 'sixes' ? '6v6' : '—';
  tbody.innerHTML = teams.length === 0
    ? '<tr><td colspan="9" style="color:#8b949e">No teams yet.</td></tr>'
    : teams.map(t => `
      <tr>
        <td>${t.logo_url ? `<img src="${t.logo_url}" class="team-logo-sm" alt="${t.name}" />` : '—'}</td>
        <td style="white-space:nowrap;">
          ${colorSwatch(t.color1)} ${colorSwatch(t.color2)}
          <button class="btn-secondary" style="margin-left:0.4rem;padding:0.2rem 0.5rem;font-size:0.8rem;" onclick="editColors(${t.id},'${t.color1||''}','${t.color2||''}')">Colors</button>
        </td>
        <td>${t.name}</td>
        <td>${ltLabel(t.league_type)}</td>
        <td>${t.conference || '—'}</td>
        <td>${t.division || '—'}</td>
        <td>
          <span id="ea-id-${t.id}" data-value="${t.ea_club_id ?? ''}">${t.ea_club_id ?? '—'}</span>
          <button class="btn-secondary" style="margin-left:0.4rem;padding:0.2rem 0.5rem;font-size:0.8rem;" onclick="setEaId(${t.id})">Edit</button>
          <button class="btn-secondary" style="margin-left:0.3rem;padding:0.2rem 0.5rem;font-size:0.8rem;" onclick="changeLogo(${t.id})">Logo</button>
        </td>
        <td id="owner-cell-${t.id}" style="font-size:0.82rem;color:#8b949e;">—</td>
        <td><button class="btn-danger" onclick="deleteTeam(${t.id})">Delete</button></td>
      </tr>`).join('');

  // Dropdowns always show ALL teams (for player team assignment)
  const tOpts = '<option value="">— No Team —</option>' + allTeams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  document.getElementById('player-team').innerHTML = tOpts;
  // Game home/away dropdowns: filter by current league
  const leagueTeams = allTeams.filter(t => !t.league_type || t.league_type === adminLeagueFilter);
  const gOpts = '<option value="">Select team</option>' + leagueTeams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  document.getElementById('game-home').innerHTML = gOpts;
  document.getElementById('game-away').innerHTML = gOpts;
  // Roster tab team selector: filter by current league
  const rSel = document.getElementById('roster-team-select');
  const rPrev = rSel.value;
  rSel.innerHTML = '<option value="">— Select a team —</option>' + leagueTeams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  if (rPrev && leagueTeams.find(t => String(t.id) === rPrev)) rSel.value = rPrev;

  // Merge teams dropdowns: show ALL teams
  const mergeOpts = '<option value="">— Select team —</option>' + allTeams.map(t => `<option value="${t.id}">${t.name}${t.league_type ? ' (' + ltLabel(t.league_type) + ')' : ''}</option>`).join('');
  const mSrc = document.getElementById('merge-team-source');
  const mTgt = document.getElementById('merge-team-target');
  if (mSrc) mSrc.innerHTML = mergeOpts;
  if (mTgt) mTgt.innerHTML = mergeOpts;
}

// ── Roster Management ─────────────────────────────────────────────────────

async function loadRoster() {
  const teamId = document.getElementById('roster-team-select').value;
  const body = document.getElementById('roster-body');
  if (!teamId) { body.innerHTML = '<p style="color:#8b949e;">Select a team above to manage its roster.</p>'; return; }

  const res = await fetch(`${API}/players`);
  const allPlayers = await res.json();

  const rostered  = allPlayers.filter(p => String(p.team_id) === String(teamId) && p.is_rostered);
  const available = allPlayers.filter(p => !p.is_rostered || String(p.team_id) !== String(teamId));

  const rosterRows = rostered.length === 0
    ? '<tr><td colspan="4" style="color:#8b949e;">No rostered players.</td></tr>'
    : rostered.map(p => `<tr>
        <td>${p.number ?? '–'}</td>
        <td>${p.name}</td>
        <td>${p.position ?? '–'}</td>
        <td><button class="btn-danger" onclick="rosterRemove(${p.id})">Remove</button></td>
      </tr>`).join('');

  const addOpts = available.length === 0
    ? '<option value="">No available players</option>'
    : '<option value="">— Pick a player —</option>' + available.map(p => {
        const teamInfo = p.team_name ? `, ${p.team_name}` : '';
        const rosterInfo = p.is_rostered ? ' (rostered)' : ' (FA)';
        return `<option value="${p.id}">${p.name}${teamInfo}${rosterInfo}</option>`;
      }).join('');

  body.innerHTML = `
    <h3 style="margin-top:0;">Current Roster <span style="font-size:0.8rem;color:#8b949e;font-weight:400;">(${rostered.length} players)</span></h3>
    <table style="margin-bottom:1.5rem;">
      <thead><tr><th>#</th><th>Name</th><th>Pos</th><th>Action</th></tr></thead>
      <tbody>${rosterRows}</tbody>
    </table>
    <h3>Add Player to Roster</h3>
    <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
      <select id="roster-add-select" style="background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:0.35rem 0.6rem;min-width:220px;">${addOpts}</select>
      <button class="btn-primary" onclick="rosterAdd()">Add to Roster</button>
    </div>`;
}

async function rosterAdd() {
  const teamId   = document.getElementById('roster-team-select').value;
  const playerId = document.getElementById('roster-add-select').value;
  if (!teamId || !playerId) { alert('Select a player to add.'); return; }
  const res = await fetch(`${API}/players/${playerId}`, {
    method: 'PATCH',
    headers: adminJsonHeaders(),
    body: JSON.stringify({ team_id: Number(teamId), is_rostered: 1 }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Failed to add player'); return; }
  await loadRoster();
}

async function rosterRemove(playerId) {
  if (!confirm('Remove this player from the roster?')) return;
  const res = await fetch(`${API}/players/${playerId}`, {
    method: 'PATCH',
    headers: adminJsonHeaders(),
    body: JSON.stringify({ is_rostered: 0 }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Failed to remove player'); return; }
  await loadRoster();
}

// ── Teams ─────────────────────────────────────────────────────────────────

document.getElementById('team-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData();
  fd.append('name', document.getElementById('team-name').value.trim());
  fd.append('conference', document.getElementById('team-conference').value.trim());
  fd.append('division', document.getElementById('team-division').value.trim());
  const eaId = document.getElementById('team-ea-id').value;
  if (eaId) fd.append('ea_club_id', eaId);
  fd.append('league_type', document.getElementById('team-league-type').value);
  fd.append('color1', document.getElementById('team-color1').value);
  fd.append('color2', document.getElementById('team-color2').value);
  const logoFile = document.getElementById('team-logo').files[0];
  if (logoFile) fd.append('logo', logoFile);

  const res = await fetch(`${API}/teams`, {
    method: 'POST',
    headers: adminHeaders(),
    body: fd,
  });
  if (res.ok) { e.target.reset(); document.getElementById('logo-preview-new').style.display = 'none'; await loadTeams(); await loadGames(); }
  else { const err = await res.json(); alert(err.error || 'Failed to add team'); }
});

async function deleteTeam(id) {
  if (!confirm('Delete this team? Related players and games will also be removed.')) return;
  await fetch(`${API}/teams/${id}`, { method: 'DELETE', headers: adminHeaders() });
  await loadTeams(); await loadPlayers(); await loadGames(); await loadRegPlayers();
}

async function mergeTeams() {
  const sourceId = document.getElementById('merge-team-source').value;
  const targetId = document.getElementById('merge-team-target').value;
  if (!sourceId || !targetId) { alert('Select both a source and target team.'); return; }
  if (sourceId === targetId) { alert('Source and target must be different teams.'); return; }
  const srcName = document.getElementById('merge-team-source').selectedOptions[0]?.textContent || 'source';
  const tgtName = document.getElementById('merge-team-target').selectedOptions[0]?.textContent || 'target';
  if (!confirm(`Merge "${srcName}" → "${tgtName}"?\n\nAll games, stats, and roster from "${srcName}" will be moved to "${tgtName}". "${srcName}" will be deleted.\n\nThis cannot be undone.`)) return;
  try {
    const res = await fetch(`${API}/admin/merge-teams`, {
      method: 'POST',
      headers: adminJsonHeaders(),
      body: JSON.stringify({ source_id: Number(sourceId), target_id: Number(targetId) }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Failed to merge teams'); return; }
    alert(`Successfully merged "${srcName}" into "${tgtName}".`);
    await loadTeams(); await loadPlayers(); await loadGames();
  } catch (err) { alert('Error merging teams: ' + err.message); }
}

async function setEaId(id) {
  const current = document.getElementById(`ea-id-${id}`).dataset.value || '';
  const val = prompt('Enter EA Club ID for this team (leave blank to clear):', current);
  if (val === null) return;
  const fd = new FormData();
  fd.append('ea_club_id', val);
  await fetch(`${API}/teams/${id}`, { method: 'PATCH', headers: adminHeaders(), body: fd });
  await loadTeams();
}

async function changeLogo(id) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = async () => {
    if (!input.files[0]) return;
    const fd = new FormData();
    fd.append('logo', input.files[0]);
    await fetch(`${API}/teams/${id}`, { method: 'PATCH', headers: adminHeaders(), body: fd });
    await loadTeams();
  };
  input.click();
}

function editColors(id, currentColor1, currentColor2) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:999;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:#161b22;border:1px solid #30363d;border-radius:10px;padding:1.5rem 2rem;min-width:280px;">
      <h3 style="margin-bottom:1rem;color:#e6edf3;">Team Colors</h3>
      <div style="margin-bottom:1rem;">
        <label style="display:block;color:#8b949e;font-size:0.85rem;margin-bottom:0.4rem;">Primary Color (gradient start)</label>
        <input type="color" id="_ec1" value="${currentColor1 || '#1e3a5f'}" style="width:100%;height:36px;border:1px solid #30363d;border-radius:6px;cursor:pointer;" />
      </div>
      <div style="margin-bottom:1.2rem;">
        <label style="display:block;color:#8b949e;font-size:0.85rem;margin-bottom:0.4rem;">Secondary Color (gradient end)</label>
        <input type="color" id="_ec2" value="${currentColor2 || '#0d1117'}" style="width:100%;height:36px;border:1px solid #30363d;border-radius:6px;cursor:pointer;" />
      </div>
      <div style="display:flex;gap:0.5rem;">
        <button id="_ec-save" style="flex:1;padding:0.5rem;background:#238636;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:0.9rem;">Save</button>
        <button id="_ec-cancel" style="flex:1;padding:0.5rem;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;cursor:pointer;font-size:0.9rem;">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('_ec-save').addEventListener('click', async () => {
    const c1 = document.getElementById('_ec1').value;
    const c2 = document.getElementById('_ec2').value;
    document.body.removeChild(overlay);
    const fd = new FormData();
    fd.append('color1', c1);
    fd.append('color2', c2);
    await fetch(`${API}/teams/${id}`, { method: 'PATCH', headers: adminHeaders(), body: fd });
    await loadTeams();
  });
  document.getElementById('_ec-cancel').addEventListener('click', () => document.body.removeChild(overlay));
  overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
}

// ── Players ───────────────────────────────────────────────────────────────

async function loadPlayers() {
  const res = await fetch(`${API}/players`);
  const players = await res.json();
  const tbody = document.querySelector('#players-table tbody');
  tbody.innerHTML = players.length === 0
    ? '<tr><td colspan="7" style="color:#8b949e">No players yet.</td></tr>'
    : players.map(p => `<tr>
        <td>${p.id}</td><td>${p.number ?? '–'}</td><td>${escAttr(p.name)}</td>
        <td>${p.position ?? '–'}</td><td>${p.team_name ?? '–'}</td>
        <td>${p.discord ? `<span style="color:#5865f2;">⊟ ${escAttr(p.discord)}</span>` : '–'}</td>
        <td style="white-space:nowrap;">
          <button class="btn-secondary" style="font-size:0.78rem;padding:0.2rem 0.4rem;"
            data-action="edit-custom-player"
            data-pid="${p.id}"
            data-name="${escAttr(p.name)}"
            data-position="${escAttr(p.position)}"
            data-number="${escAttr(p.number)}"
            data-discord="${escAttr(p.discord)}"
            data-discordid="${escAttr(p.discord_id)}"
            data-userid="${escAttr(p.user_id)}"
          >Edit</button>
          <button class="btn-danger" style="font-size:0.78rem;padding:0.2rem 0.4rem;" onclick="deletePlayer(${p.id})">Delete</button>
        </td>
      </tr>`).join('');

  // Populate merge player dropdowns with unique player names
  const uniqueNames = [...new Set(players.map(p => p.name))].sort();
  const mergePlayerOpts = '<option value="">— Select player —</option>' + uniqueNames.map(n => `<option value="${escAttr(n)}">${escAttr(n)}</option>`).join('');
  const mpSrc = document.getElementById('merge-player-source');
  const mpTgt = document.getElementById('merge-player-target');
  if (mpSrc) mpSrc.innerHTML = mergePlayerOpts;
  if (mpTgt) mpTgt.innerHTML = mergePlayerOpts;
}

document.getElementById('player-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('player-name').value.trim();
  const team_id = document.getElementById('player-team').value || null;
  const position = document.getElementById('player-position').value.trim() || null;
  const number = document.getElementById('player-number').value || null;
  const discord = document.getElementById('player-discord').value.trim() || null;
  const discord_id = document.getElementById('player-discord-id').value.trim() || null;
  await fetch(`${API}/players`, { method: 'POST', headers: adminJsonHeaders(), body: JSON.stringify({ name, team_id, position, number, discord, discord_id }) });
  e.target.reset(); await loadTeams(); await loadPlayers();
});

async function deletePlayer(id) {
  if (!confirm('Delete this player?')) return;
  await fetch(`${API}/players/${id}`, { method: 'DELETE', headers: adminHeaders() });
  await loadPlayers();
}

async function mergePlayers() {
  const sourceName = document.getElementById('merge-player-source').value;
  const targetName = document.getElementById('merge-player-target').value;
  if (!sourceName || !targetName) { alert('Select both a source and target player.'); return; }
  if (sourceName === targetName) { alert('Source and target must be different players.'); return; }
  if (!confirm(`Merge "${sourceName}" → "${targetName}"?\n\nAll game stats and historical stats from "${sourceName}" will be combined with "${targetName}". The "${sourceName}" player record will be removed.\n\nThis cannot be undone.`)) return;
  try {
    const res = await fetch(`${API}/admin/merge-players`, {
      method: 'POST',
      headers: adminJsonHeaders(),
      body: JSON.stringify({ source_name: sourceName, target_name: targetName }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Failed to merge players'); return; }
    alert(`Successfully merged "${sourceName}" into "${targetName}".`);
    await loadTeams(); await loadPlayers();
  } catch (err) { alert('Error merging players: ' + err.message); }
}

// ── Games ─────────────────────────────────────────────────────────────────

async function loadGames() {
  const res = await fetch(`${API}/games`);
  const allGames = await res.json();
  // Filter games by current league using the season's league_type
  const seasonLeagueMap = Object.fromEntries(allSeasons.map(s => [s.id, s.league_type]));
  const games = allGames.filter(g => {
    if (!g.season_id) return true; // unassigned games: show in both
    const lt = seasonLeagueMap[g.season_id];
    return !lt || lt === adminLeagueFilter;
  });
  const seasonMap = Object.fromEntries(allSeasons.map(s => [s.id, s.name]));
  const tbody = document.querySelector('#games-table tbody');
  tbody.innerHTML = games.length === 0
    ? '<tr><td colspan="9" style="color:#8b949e">No games yet.</td></tr>'
    : games.map(g => `
      <tr>
        <td>${g.id}</td><td>${g.date}</td>
        <td>${g.home_team_name}</td>
        <td>${g.status === 'complete' ? `${g.home_score} – ${g.away_score}${g.is_overtime ? ' <span title="Overtime" style="color:#e3b341;font-size:0.8rem;">OT</span>' : ''}` : '–'}</td>
        <td>${g.away_team_name}</td>
        <td>${g.season_id ? (seasonMap[g.season_id] || `#${g.season_id}`) : '—'}</td>
        <td>${g.status === 'complete'
          ? '<span class="badge badge-win" style="background:#1f4b2f;color:#3fb950;">Final</span>'
          : '<span class="badge badge-tie">Scheduled</span>'}</td>
        <td>
          <button class="btn-secondary" style="font-size:0.8rem;padding:0.2rem 0.5rem;" onclick="editGameStats(${g.id})">✏️ Edit Stats</button>
          <button class="btn-danger" style="margin-left:0.25rem;" onclick="deleteGame(${g.id})">Delete</button>
        </td>
      </tr>`).join('');
}

document.getElementById('game-form').addEventListener('submit', async e => {
  e.preventDefault();
  const date = document.getElementById('game-date').value;
  const home_team_id = document.getElementById('game-home').value;
  const away_team_id = document.getElementById('game-away').value;
  const home_score = parseInt(document.getElementById('game-home-score').value) || 0;
  const away_score = parseInt(document.getElementById('game-away-score').value) || 0;
  const season_id = document.getElementById('game-season').value || null;
  const status = document.getElementById('game-status-select').value;
  const is_overtime = document.getElementById('game-overtime').checked ? 1 : 0;
  const game_time = document.getElementById('game-time') ? document.getElementById('game-time').value || null : null;
  if (home_team_id === away_team_id) { alert('Home and away teams must differ.'); return; }
  await fetch(`${API}/games`, { method: 'POST', headers: adminJsonHeaders(), body: JSON.stringify({ date, home_team_id, away_team_id, home_score, away_score, season_id, status, is_overtime, game_time }) });
  e.target.reset(); await loadGames();
});

async function deleteGame(id) {
  if (!confirm('Delete this game?')) return;
  await fetch(`${API}/games/${id}`, { method: 'DELETE', headers: adminHeaders() });
  await loadGames();
}

// ── Game Stats Editor (shared via game-stats-editor.js) ──────────────────────
// Wire up the context-specific callback so that after saving, the admin game
// list is refreshed and a status message is shown.
window._gseAllSeasons = [];
function _wireGseAdmin() {
  window._gseAllSeasons = allSeasons;
  window._gseOnSave = async () => { await loadGames(); showStatus('Game stats saved!'); };
}


// ── Registered Players & Unrostered Warning ───────────────────────────────

async function loadRegPlayers() {
  const [usersRes, unrRes] = await Promise.all([
    fetch(`${API}/users`, { headers: adminHeaders() }),
    fetch(`${API}/admin/unrostered-stats`, { headers: adminHeaders() }),
  ]);
  if (!usersRes.ok) return;
  const users = await usersRes.json();
  const unrostered = unrRes.ok ? await unrRes.json() : [];

  // Unrostered warning
  const badge = document.getElementById('unrostered-badge');
  const warning = document.getElementById('unrostered-warning');
  if (unrostered.length > 0) {
    badge.textContent = `⚠ ${unrostered.length} unrostered`;
    badge.style.display = '';
    warning.style.display = '';
    warning.innerHTML = `<strong>⚠ Stats recorded for unrostered players:</strong><br>` +
      unrostered.map(r => `<span style="margin-right:0.75rem;">${r.player_name} (${r.team_name}, ${r.game_count} game${r.game_count !== 1 ? 's' : ''})</span>`).join('');
  } else {
    badge.style.display = 'none';
    warning.style.display = 'none';
  }

  // Load teams for the owner assignment selector
  const teamsRes = await fetch(`${API}/teams`);
  const teams = teamsRes.ok ? await teamsRes.json() : [];
  const teamOpts = '<option value="">— Select team —</option>' + teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

  const tbody = document.querySelector('#reg-players-table tbody');
  tbody.innerHTML = users.length === 0
    ? '<tr><td colspan="8" style="color:#8b949e">No registered players yet.</td></tr>'
    : users.map(u => `<tr>
        <td><strong>${u.username}</strong></td>
        <td>${u.position || '—'}</td>
        <td>${u.platform === 'psn' ? 'PlayStation' : 'Xbox'}</td>
        <td>${u.discord ? `<span style="color:#5865f2;">⊟ ${u.discord}</span>` : '<span style="color:#8b949e;">—</span>'}</td>
        <td>${u.team_name || '—'}</td>
        <td>${u.is_rostered ? '<span style="color:#3fb950;">✓ Rostered</span>' : '<span style="color:#8b949e;">Free Agent</span>'}</td>
        <td style="white-space:nowrap;">
          <select id="owner-team-${u.id}" style="font-size:0.8rem;padding:0.2rem 0.4rem;background:#21262d;border:1px solid #30363d;color:#c9d1d9;border-radius:4px;">${teamOpts}</select>
          <button class="btn-secondary" style="margin-left:0.3rem;font-size:0.78rem;padding:0.2rem 0.4rem;" onclick="assignOwner(${u.id})">Set Owner</button>
        </td>
        <td>
          <button class="btn-secondary" style="font-size:0.78rem;padding:0.2rem 0.4rem;"
            data-action="edit-player"
            data-uid="${u.id}"
            data-username="${u.username.replace(/"/g,'&quot;')}"
            data-platform="${u.platform}"
            data-position="${u.position||''}"
            data-email="${(u.email||'').replace(/"/g,'&quot;')}"
            data-discord="${(u.discord||'').replace(/"/g,'&quot;')}">Edit</button>
        </td>
      </tr>`).join('');

  // Populate owner cells in teams table
  for (const t of teams) {
    const cell = document.getElementById(`owner-cell-${t.id}`);
    if (!cell) continue;
    const sr = await fetch(`${API}/teams/${t.id}/stats`).catch(() => null);
    if (!sr || !sr.ok) continue;
    const sd = await sr.json().catch(() => null);
    if (!sd) continue;
    const owner = sd.staff && sd.staff.find(s => s.role === 'owner');
    cell.textContent = owner ? `👑 ${owner.username}` : '—';
  }
}

async function assignOwner(userId) {
  const sel = document.getElementById(`owner-team-${userId}`);
  const teamId = sel.value;
  if (!teamId) { alert('Please select a team first.'); return; }
  const res = await fetch(`${API}/teams/${teamId}/owner`, {
    method: 'POST', headers: adminJsonHeaders(), body: JSON.stringify({ user_id: userId }),
  });
  if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed'); return; }
  await loadRegPlayers();
}

// Delegated handler for edit-player buttons in the registered players table
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action="edit-player"]');
  if (!btn) return;
  const { uid, username, platform, position, email, discord } = btn.dataset;
  openEditModal({ type: 'user', id: Number(uid), username, platform, position, email, discord: discord || '' });
});

// Delegated handler for edit buttons in the custom players table
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action="edit-custom-player"]');
  if (!btn) return;
  const { pid, name, position, number, discord, discordid, userid } = btn.dataset;
  openEditModal({ type: 'player', id: Number(pid), name, position, number, discord: discord || '', discordId: discordid || '', userId: userid ? Number(userid) : null });
});

// ── Edit player modal ─────────────────────────────────────────────────────

// Cache of registered users for the "Link User" dropdown
let _regUsersCache = null;
async function _loadRegUsersForDropdown() {
  if (_regUsersCache) return _regUsersCache;
  try {
    const res = await fetch(`${API}/admin/users`, { headers: adminHeaders() });
    _regUsersCache = res.ok ? await res.json() : [];
  } catch { _regUsersCache = []; }
  return _regUsersCache;
}

async function openEditModal({ type = 'user', id, username, name, platform, position, email, discord, discordId, number, userId }) {
  const isCustom = type === 'player';
  document.getElementById('ep-id').value = id;
  document.getElementById('ep-type').value = type;
  document.getElementById('ep-title').textContent = isCustom ? 'Edit Player' : 'Edit Player Profile';

  // Toggle rows
  document.getElementById('ep-row-name').style.display      = isCustom ? '' : 'none';
  document.getElementById('ep-row-username').style.display  = isCustom ? 'none' : '';
  document.getElementById('ep-row-platform').style.display  = isCustom ? 'none' : '';
  document.getElementById('ep-row-email').style.display     = isCustom ? 'none' : '';
  document.getElementById('ep-row-number').style.display    = isCustom ? '' : 'none';
  document.getElementById('ep-row-discordid').style.display = isCustom ? '' : 'none';
  document.getElementById('ep-row-linkuser').style.display  = isCustom ? '' : 'none';

  // Populate fields
  if (isCustom) {
    document.getElementById('ep-name').value       = name || '';
    document.getElementById('ep-number').value     = number || '';
    document.getElementById('ep-discord-id').value = discordId || '';
    // Populate the registered-user link dropdown
    const users = await _loadRegUsersForDropdown();
    const sel = document.getElementById('ep-linked-user');
    sel.innerHTML = '<option value="">— Not linked —</option>' +
      users.map(u => `<option value="${u.id}">${escAttr(u.username)}${u.discord ? ' (' + escAttr(u.discord) + ')' : ''}</option>`).join('');
    sel.value = userId ? String(userId) : '';
  } else {
    document.getElementById('ep-username').value = username || '';
    document.getElementById('ep-platform').value = platform || 'xbox';
    document.getElementById('ep-email').value    = email || '';
  }
  document.getElementById('ep-position').value = position || '';
  document.getElementById('ep-discord').value  = discord || '';
  document.getElementById('ep-error').style.display = 'none';
  document.getElementById('edit-player-overlay').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('edit-player-overlay').style.display = 'none';
}

async function savePlayerEdit() {
  const id      = document.getElementById('ep-id').value;
  const type    = document.getElementById('ep-type').value;
  const isCustom = type === 'player';
  const position = document.getElementById('ep-position').value;
  const discord  = document.getElementById('ep-discord').value.trim();
  const errEl    = document.getElementById('ep-error');
  errEl.style.display = 'none';

  if (isCustom) {
    const name      = document.getElementById('ep-name').value.trim();
    const number    = document.getElementById('ep-number').value || null;
    const discordId = document.getElementById('ep-discord-id').value.trim() || null;
    const linkedUser = document.getElementById('ep-linked-user').value;
    const user_id = linkedUser ? Number(linkedUser) : null;
    if (!name) { errEl.textContent = 'Name cannot be empty'; errEl.style.display = ''; return; }
    const res = await fetch(`${API}/players/${id}`, {
      method: 'PATCH', headers: adminJsonHeaders(),
      body: JSON.stringify({ name, position: position || null, number: number ? Number(number) : null, discord: discord || null, discord_id: discordId, user_id }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      errEl.textContent = e.error || 'Failed to save';
      errEl.style.display = '';
      return;
    }
    closeEditModal();
    await loadPlayers();
  } else {
    const username = document.getElementById('ep-username').value.trim();
    const platform = document.getElementById('ep-platform').value;
    const email    = document.getElementById('ep-email').value.trim();
    if (!username) { errEl.textContent = 'Gamertag cannot be empty'; errEl.style.display = ''; return; }
    const res = await fetch(`${API}/users/${id}`, {
      method: 'PATCH', headers: adminJsonHeaders(),
      body: JSON.stringify({ username, platform, position: position || null, email: email || null, discord: discord || null }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      errEl.textContent = e.error || 'Failed to save';
      errEl.style.display = '';
      return;
    }
    closeEditModal();
    _regUsersCache = null; // Invalidate cache so dropdown refreshes on next open
    await loadRegPlayers();
    await loadPlayers();
  }
}

// Close modal on overlay click
document.getElementById('edit-player-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('edit-player-overlay')) closeEditModal();
});

// ── Playoffs ──────────────────────────────────────────────────────────────

async function loadAdminPlayoffs() {
  // Populate season dropdown for create form – only regular (non-playoff) seasons
  const res = await fetch(`${API}/seasons`);
  const seasons = res.ok ? await res.json() : [];
  const regularSeasons = seasons.filter(s => !s.is_playoff);
  const sel = document.getElementById('po-season');
  if (sel) {
    sel.innerHTML = '<option value="">— Select Season —</option>' +
      regularSeasons.map(s => `<option value="${s.id}">${s.name} (${typeLabel(s.league_type)})</option>`).join('');
  }

  // For each regular season, try to load its playoff
  const list = document.getElementById('playoffs-list');
  if (!list) return;
  if (regularSeasons.length === 0) {
    list.innerHTML = '<p style="color:#8b949e;font-size:0.85rem;">No seasons yet. Create a season first.</p>';
    return;
  }

  list.innerHTML = '<p style="color:#8b949e;font-size:0.85rem;">Loading…</p>';
  const rows = [];
  for (const s of regularSeasons) {
    try {
      const pr = await fetch(`${API}/playoffs/by-season/${s.id}`);
      if (pr.ok) {
        const data = await pr.json();
        rows.push(renderAdminPlayoffCard(s, data));
      }
    } catch { /* season has no playoff */ }
  }
  list.innerHTML = rows.length > 0
    ? rows.join('')
    : '<p style="color:#8b949e;font-size:0.85rem;">No playoff brackets created yet. Use the form above to generate one.</p>';
}

function abbrevAdmin(name) {
  if (!name) return '???';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return name.slice(0, 3).toUpperCase();
  return words.map(w => w[0]).join('').toUpperCase().slice(0, 3);
}

function renderAdminPlayoffCard(season, data) {
  const pl = data.playoff;
  const playoffSeason = data.playoff_season;
  const numRounds = Object.keys(data.rounds).length;
  const lastRound = data.rounds[numRounds];
  const finalSeries = lastRound && lastRound.length === 1 ? lastRound[0] : null;
  const isComplete = finalSeries && finalSeries.winner_id;
  const champion   = isComplete ? data.teams.find(t => t.team_id === finalSeries.winner_id) : null;

  const teamPills = data.teams.map(t =>
    `<span style="background:#21262d;border-radius:4px;padding:0.15rem 0.4rem;font-size:0.75rem;white-space:nowrap;">${t.seed}. ${t.name}</span>`
  ).join(' ');

  // Build series summary for each round
  let roundHtml = '';
  for (let r = 1; r <= numRounds; r++) {
    const series = (data.rounds[r] || []).sort((a,b) => a.series_number - b.series_number);
    const rName = r === numRounds ? 'Final' : r === numRounds - 1 ? 'Semis' : `R${r}`;
    roundHtml += `<div style="margin-bottom:0.75rem;">
      <div style="font-size:0.78rem;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.4rem;">${rName}</div>
      <div style="display:flex;flex-direction:column;gap:0.4rem;">
        ${series.map(s => renderAdminSeriesRow(s, pl)).join('')}
      </div>
    </div>`;
  }

  // Check if current round is complete to offer advance button
  const curRound = numRounds > 0 ? Math.max(...Object.keys(data.rounds).map(Number)) : 0;
  const curSeries = data.rounds[curRound] || [];
  const curRoundDone = curSeries.length > 0 && curSeries.every(s => s.winner_id);
  const canAdvance  = curRoundDone && curSeries.length > 1;

  const playoffSeasonBadge = playoffSeason
    ? `<span style="background:#2d1b00;color:#e3b341;border:1px solid #9e6a03;border-radius:10px;padding:0.1rem 0.5rem;font-size:0.75rem;">🏆 ${escAttr(playoffSeason.name)}</span>`
    : '';

  return `<div style="background:#161b22;border:1px solid #30363d;border-radius:10px;padding:1.25rem;margin-bottom:1.25rem;">
    <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:0.75rem;">
      <strong style="font-size:1rem;">${season.name}</strong>
      ${playoffSeasonBadge}
      <span style="color:#8b949e;font-size:0.82rem;">${typeLabel(season.league_type)}</span>
      <span style="color:#8b949e;font-size:0.82rem;">Best of ${pl.series_length} · ${pl.teams_qualify} teams · Min ${pl.min_games_played} GP</span>
      ${champion ? `<span style="background:#1a3a2a;color:#3fb950;border-radius:10px;padding:0.1rem 0.6rem;font-size:0.78rem;font-weight:700;">🏆 ${champion.name}</span>` : ''}
      <div style="margin-left:auto;display:flex;gap:0.4rem;flex-wrap:wrap;">
        ${canAdvance ? `<button class="btn-secondary" style="font-size:0.8rem;padding:0.25rem 0.6rem;" onclick="advancePlayoffRound(${pl.id})">⏭ Advance to Round ${curRound + 1}</button>` : ''}
        <a href="playoffs.html" class="btn-secondary" style="font-size:0.8rem;padding:0.25rem 0.6rem;text-decoration:none;">👁 View Bracket</a>
        <button class="btn-danger" style="font-size:0.8rem;padding:0.25rem 0.6rem;" onclick="deletePlayoff(${pl.id})">Delete</button>
      </div>
    </div>
    <div style="display:flex;gap:0.3rem;flex-wrap:wrap;margin-bottom:0.75rem;">${teamPills}</div>
    ${roundHtml}
  </div>`;
}

function renderAdminSeriesRow(s, pl) {
  const winsToWin = Math.ceil((pl.series_length || 7) / 2);
  const done = s.winner_id != null;
  const hi   = s.high_seed_name || 'TBD';
  const lo   = s.low_seed_name  || 'TBD';

  return `<div style="display:flex;align-items:center;gap:0.5rem;background:#0d1117;border-radius:6px;padding:0.35rem 0.65rem;">
    <input type="number" min="1" value="${s.high_seed_num || ''}" id="high-seed-num-${s.id}"
      title="Edit high-seed number"
      style="width:34px;text-align:center;background:#161b22;border:1px solid #30363d;color:#8b949e;border-radius:4px;padding:0.1rem;font-size:0.78rem;"
      onblur="updateSeriesSeeds(${s.id})" onkeydown="if(event.key==='Enter')this.blur()" />
    <span style="font-size:0.82rem;font-weight:600;flex:1;${s.winner_id === s.high_seed_id ? 'color:#3fb950;' : ''}">${abbrevAdmin(hi)}</span>
    <input type="number" min="0" max="${winsToWin}" value="${s.high_seed_wins}" id="high-wins-${s.id}"
      style="width:38px;text-align:center;background:#161b22;border:1px solid #30363d;color:#e6edf3;border-radius:4px;padding:0.1rem;"
      onchange="updateSeriesWins(${s.id}, this.value, document.getElementById('low-wins-${s.id}').value)" />
    <span style="color:#8b949e;">–</span>
    <input type="number" min="0" max="${winsToWin}" value="${s.low_seed_wins}" id="low-wins-${s.id}"
      style="width:38px;text-align:center;background:#161b22;border:1px solid #30363d;color:#e6edf3;border-radius:4px;padding:0.1rem;"
      onchange="updateSeriesWins(${s.id}, document.getElementById('high-wins-${s.id}').value, this.value)" />
    <span style="font-size:0.82rem;font-weight:600;flex:1;text-align:right;${s.winner_id === s.low_seed_id ? 'color:#3fb950;' : ''}">${abbrevAdmin(lo)}</span>
    <input type="number" min="1" value="${s.low_seed_num || ''}" id="low-seed-num-${s.id}"
      title="Edit low-seed number"
      style="width:34px;text-align:center;background:#161b22;border:1px solid #30363d;color:#8b949e;border-radius:4px;padding:0.1rem;font-size:0.78rem;"
      onblur="updateSeriesSeeds(${s.id})" onkeydown="if(event.key==='Enter')this.blur()" />
    ${done ? `<span style="font-size:0.75rem;color:#3fb950;margin-left:0.2rem;" title="Series complete">✓</span>` : ''}
  </div>`;
}

async function updateSeriesSeeds(seriesId) {
  const hnEl = document.getElementById(`high-seed-num-${seriesId}`);
  const lnEl = document.getElementById(`low-seed-num-${seriesId}`);
  if (!hnEl && !lnEl) return;
  const body = {};
  if (hnEl && hnEl.value !== '') body.high_seed_num = Number(hnEl.value);
  if (lnEl && lnEl.value !== '') body.low_seed_num  = Number(lnEl.value);
  if (Object.keys(body).length === 0) return;
  await fetch(`${API}/playoff-series/${seriesId}`, {
    method: 'PATCH',
    headers: adminJsonHeaders(),
    body: JSON.stringify(body),
  });
  await loadAdminPlayoffs();
}

async function updateSeriesWins(seriesId, highWins, lowWins) {
  await fetch(`${API}/playoff-series/${seriesId}`, {
    method: 'PATCH',
    headers: adminJsonHeaders(),
    body: JSON.stringify({ high_seed_wins: Number(highWins), low_seed_wins: Number(lowWins) }),
  });
  await loadAdminPlayoffs();
}

async function advancePlayoffRound(playoffId) {
  const res = await fetch(`${API}/playoffs/${playoffId}/advance-round`, {
    method: 'POST',
    headers: adminJsonHeaders(),
  });
  if (!res.ok) {
    const err = await res.json();
    alert(err.error || 'Could not advance round');
    return;
  }
  showStatus('Next round matchups created!');
  await loadAdminPlayoffs();
}

async function deletePlayoff(playoffId) {
  if (!confirm('Delete this playoff bracket? This cannot be undone.')) return;
  const res = await fetch(`${API}/playoffs/${playoffId}`, { method: 'DELETE', headers: adminHeaders() });
  if (res.ok) { showStatus('Playoff deleted.'); await loadAdminPlayoffs(); }
  else { const e = await res.json(); alert(e.error || 'Failed to delete'); }
}

document.getElementById('playoff-form').addEventListener('submit', async e => {
  e.preventDefault();
  const season_id    = document.getElementById('po-season').value;
  const teams_qualify = Number(document.getElementById('po-qualify').value);
  const min_games_played = Number(document.getElementById('po-min-gp').value);
  const series_length = Number(document.getElementById('po-series-length').value);
  const series_start_date = document.getElementById('po-start-date').value;

  if (!season_id) { alert('Please select a season.'); return; }
  if (!series_start_date) { alert('Please select a Round 1 start date.'); return; }

  const res = await fetch(`${API}/playoffs`, {
    method: 'POST',
    headers: adminJsonHeaders(),
    body: JSON.stringify({ season_id: Number(season_id), teams_qualify, min_games_played, series_length, series_start_date }),
  });
  if (res.ok) {
    e.target.reset();
    showStatus('Playoff bracket created!');
    await loadAdminPlayoffs();
  } else {
    const err = await res.json();
    alert(err.error || 'Failed to create playoff');
  }
});

// ── Init ──────────────────────────────────────────────────────────────────

checkAuth();

// ── Site Logo ─────────────────────────────────────────────────────────────

function previewSiteLogo(input) {
  const img = document.getElementById('site-logo-preview-new');
  if (img._objectUrl) { URL.revokeObjectURL(img._objectUrl); img._objectUrl = null; }
  if (input.files && input.files[0]) {
    img._objectUrl = URL.createObjectURL(input.files[0]);
    img.src = img._objectUrl;
    img.style.display = 'block';
  } else {
    img.style.display = 'none';
  }
}

// Preview helper for league-specific logo forms
function previewLeagueLogo(input, previewId) {
  const img = document.getElementById(previewId);
  if (!img) return;
  if (img._objectUrl) { URL.revokeObjectURL(img._objectUrl); img._objectUrl = null; }
  if (input.files && input.files[0]) {
    img._objectUrl = URL.createObjectURL(input.files[0]);
    img.src = img._objectUrl;
    img.style.display = 'block';
  } else {
    img.style.display = 'none';
  }
}

// Upload handler for league-specific logo forms (threes / sixes)
async function uploadLeagueLogo(leagueType, fileInputId, previewId, currentId, msgId) {
  const file = document.getElementById(fileInputId).files[0];
  const msg  = document.getElementById(msgId);
  if (!file) return;
  msg.style.color = '#8b949e';
  msg.textContent = 'Uploading…';
  const fd = new FormData();
  fd.append('logo', file);
  fd.append('league_type', leagueType);
  try {
    const res = await fetch(`${API}/admin/site-logo`, {
      method: 'POST',
      headers: { 'X-Admin-Token': getAdminToken() },
      body: fd,
    });
    if (res.ok) {
      msg.style.color = '#3fb950';
      msg.textContent = 'Logo updated!';
      const bust = `?v=${Date.now()}`;
      document.getElementById(currentId).src = `/api/site-logo?type=${leagueType}${bust}`;
      // Refresh league tab buttons that use this logo
      document.querySelectorAll(`.league-tab-btn[data-league="${leagueType}"] img`).forEach(i => {
        i.src = `/api/site-logo?type=${leagueType}${bust}`;
      });
      document.getElementById(fileInputId).value = '';
      const prev = document.getElementById(previewId);
      if (prev) { prev.style.display = 'none'; }
    } else {
      const data = await res.json().catch(() => ({}));
      msg.style.color = '#f85149';
      msg.textContent = data.error || `Upload failed (${res.status})`;
    }
  } catch {
    msg.style.color = '#f85149';
    msg.textContent = 'Network error – could not reach the server';
  }
}

// Wire up league logo forms
['threes', 'sixes'].forEach(lt => {
  const form = document.getElementById(`logo-form-${lt}`);
  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      await uploadLeagueLogo(lt, `logo-file-${lt}`, `logo-preview-${lt}`, `current-logo-${lt}`, `logo-msg-${lt}`);
    });
  }
});

document.getElementById('site-logo-form').addEventListener('submit', async e => {
  e.preventDefault();
  const file = document.getElementById('site-logo-file').files[0];
  const msg  = document.getElementById('site-logo-msg');
  if (!file) return;
  msg.style.color = '#8b949e';
  msg.textContent = 'Uploading…';
  const fd = new FormData();
  fd.append('logo', file);
  try {
    const res = await fetch(`${API}/admin/site-logo`, {
      method: 'POST',
      headers: { 'X-Admin-Token': getAdminToken() },
      body: fd,
    });
    if (res.ok) {
      msg.style.color = '#3fb950';
      msg.textContent = 'Logo updated!';
      // Refresh previews with cache-bust so the new image shows immediately
      const bust = `?v=${Date.now()}`;
      document.getElementById('current-site-logo-preview').src = `/api/site-logo${bust}`;
      // Refresh the nav logo on this page too
      const navLogo = document.querySelector('nav .brand-logo');
      if (navLogo) navLogo.src = `/api/site-logo${bust}`;
      document.getElementById('site-logo-file').value = '';
      document.getElementById('site-logo-preview-new').style.display = 'none';
    } else {
      const data = await res.json().catch(() => ({}));
      msg.style.color = '#f85149';
      msg.textContent = data.error || `Upload failed (${res.status})`;
    }
  } catch {
    msg.style.color = '#f85149';
    msg.textContent = 'Network error – could not reach the server';
  }
});

// ── Import tab ────────────────────────────────────────────────────────────

function showImportStatus(msg, ok) {
  const el = document.getElementById('import-status');
  if (!el) return;
  el.style.display = 'block';
  el.style.background = ok ? 'rgba(63,185,80,0.12)' : 'rgba(248,81,73,0.12)';
  el.style.border = ok ? '1px solid rgba(63,185,80,0.4)' : '1px solid rgba(248,81,73,0.4)';
  el.style.color = ok ? '#3fb950' : '#f85149';
  el.innerHTML = msg;
}

async function sendImport(data) {
  // Auto-detect MSO scraper format: a JSON array of game objects with MSO-specific fields.
  // The generic import format is always an object ({ seasons: [...] }), never an array.
  if (Array.isArray(data) && data.length > 0 && data[0] && (data[0].home_team || data[0].away_team || data[0].game_type)) {
    // Route to MSO import; show status in the generic import area too
    const msoSeasonSelect = document.getElementById('mso-season-select');
    const msoSeasonName = document.getElementById('mso-season-name');
    const hasSeasonInfo = (msoSeasonSelect && msoSeasonSelect.value) || (msoSeasonName && msoSeasonName.value && msoSeasonName.value.trim());
    if (!hasSeasonInfo) {
      showImportStatus(
        '🔄 This file is in MSO scraper format.<br>' +
        'Please scroll down to the <b>Import MSO Scraper JSON</b> section, ' +
        'select a season (or enter a new season name), and import the file there.',
        false
      );
      return;
    }
    showImportStatus('🔄 Detected MSO scraper format — importing…', true);
    await sendMsoImport(data);
    return;
  }
  try {
    const res = await fetch('/api/admin/import', {
      method: 'POST',
      headers: adminJsonHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ok) {
      const s = json.summary || {};
      showImportStatus(
        `✅ Import complete!<br>` +
        `Seasons created: <b>${s.seasons_created}</b> &nbsp;|&nbsp; ` +
        `Existing: <b>${s.seasons_existing}</b><br>` +
        `Teams created: <b>${s.teams_created}</b><br>` +
        `Games created: <b>${s.games_created}</b> &nbsp;|&nbsp; ` +
        `Skipped (duplicate): <b>${s.games_skipped}</b><br>` +
        `Player stat rows: <b>${s.stats_rows}</b>`,
        true
      );
    } else {
      showImportStatus(`❌ Import failed: ${json.error || res.status}`, false);
    }
  } catch (e) {
    showImportStatus(`❌ Network error: ${e.message}`, false);
  }
}

async function runImport() {
  const fileInput = document.getElementById('import-file');
  if (!fileInput || !fileInput.files.length) {
    showImportStatus('❌ Please select a JSON file first.', false);
    return;
  }
  const file = fileInput.files[0];
  if (file.size > 10 * 1024 * 1024) {
    showImportStatus('❌ File too large (max 10 MB).', false);
    return;
  }
  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch {
    showImportStatus('❌ Invalid JSON – could not parse the file.', false);
    return;
  }
  showImportStatus('⏳ Importing…', true);
  await sendImport(data);
}

async function runImportText() {
  const textarea = document.getElementById('import-json-text');
  if (!textarea || !textarea.value.trim()) {
    showImportStatus('❌ Please paste JSON data first.', false);
    return;
  }
  let data;
  try {
    data = JSON.parse(textarea.value.trim());
  } catch {
    showImportStatus('❌ Invalid JSON – check your pasted text.', false);
    return;
  }
  showImportStatus('⏳ Importing…', true);
  await sendImport(data);
}

// ── MSO Scraper JSON import ───────────────────────────────────────────────

function toggleMsoNewSeasonFields() {
  const sel = document.getElementById('mso-season-select');
  const fields = document.getElementById('mso-new-season-fields');
  if (sel && fields) {
    fields.style.display = sel.value ? 'none' : '';
  }
}
// Wire up the toggle when the select changes
document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('mso-season-select');
  if (sel) sel.addEventListener('change', toggleMsoNewSeasonFields);
});

function showMsoImportStatus(msg, ok) {
  const el = document.getElementById('mso-import-status');
  if (!el) return;
  el.style.display = 'block';
  el.style.background = ok ? 'rgba(63,185,80,0.12)' : 'rgba(248,81,73,0.12)';
  el.style.border = ok ? '1px solid rgba(63,185,80,0.4)' : '1px solid rgba(248,81,73,0.4)';
  el.style.color = ok ? '#3fb950' : '#f85149';
  el.textContent = msg;
}

async function sendMsoImport(gamesArray) {
  const seasonSelect = document.getElementById('mso-season-select');
  const existingSeasonId = seasonSelect ? seasonSelect.value : '';
  const seasonName = (document.getElementById('mso-season-name') || {}).value || '';
  const leagueType = (document.getElementById('mso-league-type') || {}).value || '';

  if (!existingSeasonId && !seasonName.trim()) {
    showMsoImportStatus('❌ Please select an existing season or enter a new season name.', false);
    return;
  }

  const body = { games: gamesArray };
  if (existingSeasonId) {
    body.season_id = Number(existingSeasonId);
  } else {
    body.season_name = seasonName.trim();
    body.league_type = leagueType;
  }

  showMsoImportStatus('⏳ Importing… this may take a moment for large files.', true);
  try {
    const res = await fetch('/api/admin/import-mso-json', {
      method: 'POST',
      headers: adminJsonHeaders(),
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ok) {
      const s = json.summary || {};
      const MAX_DISPLAYED_ERRORS = 10;
      let msg = `✅ MSO import complete!\n` +
        `Season: ${s.season || seasonName}\n` +
        `Teams created: ${s.teams_created}\n` +
        `Games created: ${s.games_created}  |  Skipped (duplicate): ${s.games_skipped}\n` +
        `Games with stats: ${s.stats_imported}\n` +
        `Playoff series created: ${s.playoff_series_created}`;
      if (s.errors && s.errors.length) {
        msg += `\n\nErrors (${s.errors.length}):\n` + s.errors.slice(0, MAX_DISPLAYED_ERRORS).join('\n');
        if (s.errors.length > MAX_DISPLAYED_ERRORS) msg += `\n…and ${s.errors.length - MAX_DISPLAYED_ERRORS} more`;
      }
      showMsoImportStatus(msg, true);
      // Refresh seasons list to show any newly created seasons
      if (typeof loadSeasons === 'function') loadSeasons();
    } else {
      showMsoImportStatus(`❌ Import failed: ${json.error || res.status}`, false);
    }
  } catch (e) {
    showMsoImportStatus(`❌ Network error: ${e.message}`, false);
  }
}

async function runMsoImport() {
  const fileInput = document.getElementById('mso-import-file');
  if (!fileInput || !fileInput.files.length) {
    showMsoImportStatus('❌ Please select a JSON file first.', false);
    return;
  }
  const file = fileInput.files[0];
  if (file.size > 50 * 1024 * 1024) {
    showMsoImportStatus('❌ File too large (max 50 MB).', false);
    return;
  }
  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch {
    showMsoImportStatus('❌ Invalid JSON – could not parse the file.', false);
    return;
  }
  if (!Array.isArray(data)) {
    showMsoImportStatus('❌ Expected a JSON array of game objects.', false);
    return;
  }
  await sendMsoImport(data);
}

async function runMsoImportText() {
  const textarea = document.getElementById('mso-import-text');
  if (!textarea || !textarea.value.trim()) {
    showMsoImportStatus('❌ Please paste JSON data first.', false);
    return;
  }
  let data;
  try {
    data = JSON.parse(textarea.value.trim());
  } catch {
    showMsoImportStatus('❌ Invalid JSON – check your pasted text.', false);
    return;
  }
  if (!Array.isArray(data)) {
    showMsoImportStatus('❌ Expected a JSON array of game objects.', false);
    return;
  }
  await sendMsoImport(data);
}

// ── Excel schedule import ─────────────────────────────────────────────────

function showXlImportStatus(msg, ok) {
  const el = document.getElementById('xl-import-status');
  if (!el) return;
  el.style.display = 'block';
  el.style.background = ok ? 'rgba(63,185,80,0.12)' : 'rgba(248,81,73,0.12)';
  el.style.border = ok ? '1px solid rgba(63,185,80,0.4)' : '1px solid rgba(248,81,73,0.4)';
  el.style.color = ok ? '#3fb950' : '#f85149';
  el.textContent = msg;
}

async function runExcelImport() {
  const fileInput   = document.getElementById('xl-import-file');
  const seasonName  = (document.getElementById('xl-season-name')  || {}).value || '';
  const leagueType  = (document.getElementById('xl-league-type')  || {}).value || '';
  const leagueId    = (document.getElementById('xl-league-id')    || {}).value || '';

  if (!fileInput || !fileInput.files.length) {
    showXlImportStatus('❌ Please select an Excel file first.', false);
    return;
  }
  if (!seasonName.trim()) {
    showXlImportStatus('❌ Please enter a Season name.', false);
    return;
  }
  const file = fileInput.files[0];
  if (file.size > 20 * 1024 * 1024) {
    showXlImportStatus('❌ File too large (max 20 MB).', false);
    return;
  }

  showXlImportStatus('⏳ Uploading and processing… this may take a minute while player stats are fetched from mystatsonline.', true);

  const fd = new FormData();
  fd.append('file', file);
  fd.append('season_name', seasonName.trim());
  fd.append('league_type', leagueType);
  fd.append('league_id',   leagueId.trim());

  try {
    const token = getAdminToken();
    const res = await fetch('/api/admin/import-excel', {
      method: 'POST',
      headers: { 'X-Admin-Token': token },
      body: fd,
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ok) {
      const s = json.summary || {};
      const MAX_DISPLAYED_ERRORS = 10;
      let msg = `✅ Excel import complete!\n` +
        `Season: ${s.season || seasonName}\n` +
        `Teams created: ${s.teams_created}\n` +
        `Games created: ${s.games_created}  |  Skipped (duplicate): ${s.games_skipped}\n` +
        `Games with stats fetched: ${s.stats_fetched}  |  Stats skipped/failed: ${s.stats_skipped}`;
      if (s.errors && s.errors.length) {
        msg += `\n\nErrors (${s.errors.length}):\n` + s.errors.slice(0, MAX_DISPLAYED_ERRORS).join('\n');
        if (s.errors.length > MAX_DISPLAYED_ERRORS) msg += `\n…and ${s.errors.length - MAX_DISPLAYED_ERRORS} more`;
      }
      showXlImportStatus(msg, true);
    } else {
      showXlImportStatus(`❌ Import failed: ${json.error || res.status}`, false);
    }
  } catch (e) {
    showXlImportStatus(`❌ Network error: ${e.message}`, false);
  }
}


// ── Records Settings ──────────────────────────────────────────────────────

async function loadRecordsSettings() {
  try {
    const res = await fetch(`${API}/admin/records-settings`, { headers: adminHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const inp = document.getElementById('rec-goalie-min-gp');
    if (inp) inp.value = data.goalie_season_min_gp ?? 16;
    const inp2 = document.getElementById('goalie-stats-min-gp');
    if (inp2) inp2.value = data.goalie_stats_min_gp ?? 5;
  } catch (e) { /* silently ignore */ }
}

async function saveRecordsSettings() {
  const inp = document.getElementById('rec-goalie-min-gp');
  const inp2 = document.getElementById('goalie-stats-min-gp');
  const msg = document.getElementById('rec-settings-msg');
  if (!inp) return;
  const val = parseInt(inp.value, 10);
  const val2 = inp2 ? parseInt(inp2.value, 10) : null;
  if (isNaN(val) || val < 1) {
    msg.textContent = '⚠ Enter a valid number ≥ 1';
    msg.style.color = '#f85149';
    return;
  }
  if (val2 !== null && (isNaN(val2) || val2 < 1)) {
    msg.textContent = '⚠ Enter a valid number ≥ 1 for stats min GP';
    msg.style.color = '#f85149';
    return;
  }
  const body = { goalie_season_min_gp: val };
  if (val2 !== null) body.goalie_stats_min_gp = val2;
  try {
    const res = await fetch(`${API}/admin/records-settings`, {
      method: 'POST',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      msg.textContent = '✅ Saved';
      msg.style.color = '#3fb950';
    } else {
      msg.textContent = '❌ Error saving';
      msg.style.color = '#f85149';
    }
  } catch (e) {
    msg.textContent = '❌ Network error';
    msg.style.color = '#f85149';
  }
  setTimeout(() => { if (msg) msg.textContent = ''; }, 3000);
}

async function loadNameChangeRequests() {
  const container = document.getElementById('name-change-list');
  if (!container) return;
  try {
    const res = await fetch(`${API}/admin/name-change-requests`, { headers: adminHeaders() });
    if (!res.ok) { container.innerHTML = '<p style="color:#f85149;">Failed to load requests.</p>'; return; }
    const requests = await res.json();
    if (!requests.length) {
      container.innerHTML = '<p style="color:#8b949e;font-size:0.88rem;">No pending name change requests.</p>';
      return;
    }
    container.innerHTML = `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="color:#8b949e;font-size:0.82rem;">
        <th style="text-align:left;padding:0.35rem 0.5rem;">User</th>
        <th style="text-align:left;padding:0.35rem 0.5rem;">Old Name</th>
        <th style="text-align:left;padding:0.35rem 0.5rem;">New Name</th>
        <th style="text-align:left;padding:0.35rem 0.5rem;">Date</th>
        <th style="padding:0.35rem 0.5rem;"></th>
      </tr></thead>
      <tbody>${requests.map(r => `
        <tr style="border-top:1px solid #21262d;">
          <td style="padding:0.4rem 0.5rem;">${escAttr(r.current_username)}${r.discord ? ` <span style="color:#5865f2;font-size:0.8rem;">(${escAttr(r.discord)})</span>` : ''}</td>
          <td style="padding:0.4rem 0.5rem;color:#8b949e;">${escAttr(r.old_name)}</td>
          <td style="padding:0.4rem 0.5rem;font-weight:600;">${escAttr(r.new_name)}</td>
          <td style="padding:0.4rem 0.5rem;color:#8b949e;font-size:0.8rem;">${new Date(r.created_at).toLocaleDateString()}</td>
          <td style="padding:0.4rem 0.5rem;white-space:nowrap;">
            <button onclick="approveNameChange(${r.id})" style="background:#1f4b2f;color:#3fb950;border:1px solid #3fb950;border-radius:4px;padding:0.2rem 0.6rem;font-size:0.8rem;cursor:pointer;margin-right:0.3rem;">Approve</button>
            <button onclick="declineNameChange(${r.id})" style="background:#4b1f1f;color:#f85149;border:1px solid #f85149;border-radius:4px;padding:0.2rem 0.6rem;font-size:0.8rem;cursor:pointer;">Decline</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  } catch { container.innerHTML = '<p style="color:#f85149;font-size:0.88rem;">Failed to load name change requests.</p>'; }
}

async function approveNameChange(id) {
  if (!confirm('Approve this name change? This will update all stats records.')) return;
  const res = await fetch(`${API}/admin/name-change-requests/${id}/approve`, { method: 'POST', headers: adminHeaders() });
  if (res.ok) { showStatus('Name change approved!'); await loadNameChangeRequests(); }
  else { const e = await res.json().catch(() => ({})); alert(e.error || 'Failed to approve'); }
}

async function declineNameChange(id) {
  if (!confirm('Decline this name change request?')) return;
  const res = await fetch(`${API}/admin/name-change-requests/${id}/decline`, { method: 'POST', headers: adminHeaders() });
  if (res.ok) { showStatus('Name change declined.'); await loadNameChangeRequests(); }
  else { const e = await res.json().catch(() => ({})); alert(e.error || 'Failed to decline'); }
}
