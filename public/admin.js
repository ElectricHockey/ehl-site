const API = '/api';

function getAdminToken() { return localStorage.getItem('ehl_admin_token') || ''; }
function adminHeaders() { return { 'X-Admin-Token': getAdminToken() }; }
function adminJsonHeaders() { return { 'Content-Type': 'application/json', 'X-Admin-Token': getAdminToken() }; }

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

async function checkAuth() {
  const token = getAdminToken();
  if (!token) { showLoginForm(); return; }
  try {
    const res = await fetch(`${API}/auth/status`, { headers: { 'X-Admin-Token': token } });
    const data = await res.json();
    if (data.isAdmin) { showAdminPanel(); } else { localStorage.removeItem('ehl_admin_token'); showLoginForm(); }
  } catch { showLoginForm(); }
}

function showLoginForm() {
  document.getElementById('login-section').style.display = '';
  document.getElementById('admin-panel').style.display = 'none';
}

function showAdminPanel() {
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('admin-panel').style.display = '';
  loadSeasons();
  loadTeams();
  loadPlayers();
  loadGames();
  loadRegPlayers();
}

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const password = document.getElementById('admin-password').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  try {
    const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    if (!res.ok) { errEl.style.display = ''; return; }
    const data = await res.json();
    localStorage.setItem('ehl_admin_token', data.token);
    showAdminPanel();
  } catch { errEl.style.display = ''; }
});

async function adminLogout() {
  await fetch(`${API}/auth/logout`, { method: 'POST', headers: adminHeaders() }).catch(() => {});
  localStorage.removeItem('ehl_admin_token');
  showLoginForm();
}

// ── Seasons ───────────────────────────────────────────────────────────────

let allSeasons = [];

async function loadSeasons() {
  const res = await fetch(`${API}/seasons`);
  allSeasons = await res.json();
  const list = document.getElementById('seasons-list');

  const typeLabel = lt => lt === 'threes' ? "3's" : lt === 'sixes' ? "6's" : 'General';

  if (allSeasons.length === 0) {
    list.innerHTML = '<p style="color:#8b949e;font-size:0.85rem;">No seasons yet. Create one above.</p>';
  } else {
    list.innerHTML = allSeasons.map(s => `
      <div class="season-item">
        ${s.is_active ? '<span class="season-active-badge">★ Active</span>' : ''}
        <strong style="flex:1;">${s.name}</strong>
        <span style="color:#8b949e;font-size:0.8rem;">${typeLabel(s.league_type)}</span>
        ${!s.is_active ? `<button class="btn-secondary" style="font-size:0.8rem;padding:0.25rem 0.6rem;" onclick="setActiveSeason(${s.id})">Set Active</button>` : ''}
        <button class="btn-danger" style="font-size:0.8rem;padding:0.25rem 0.6rem;" onclick="deleteSeason(${s.id})">Delete</button>
      </div>`).join('');
  }

  // Populate season dropdowns in game form
  const seasonOpts = '<option value="">— No Season —</option>' +
    allSeasons.map(s => `<option value="${s.id}"${s.is_active ? ' selected' : ''}>${s.name}${s.league_type ? ' (' + typeLabel(s.league_type) + ')' : ''}</option>`).join('');
  document.getElementById('game-season').innerHTML = seasonOpts;
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

async function deleteSeason(id) {
  if (!confirm('Delete this season? Games in this season will become unassigned.')) return;
  await fetch(`${API}/seasons/${id}`, { method: 'DELETE', headers: adminHeaders() });
  await loadSeasons(); await loadGames();
}

// ── Teams ─────────────────────────────────────────────────────────────────

function colorSwatch(hex) {
  if (!hex) return '—';
  return `<span style="display:inline-block;width:18px;height:18px;border-radius:3px;background:${hex};border:1px solid #30363d;vertical-align:middle;" title="${hex}"></span>`;
}

async function loadTeams() {
  const res = await fetch(`${API}/teams`);
  const teams = await res.json();
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

  const tOpts = '<option value="">— No Team —</option>' + teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  document.getElementById('player-team').innerHTML = tOpts;
  const gOpts = '<option value="">Select team</option>' + teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  document.getElementById('game-home').innerHTML = gOpts;
  document.getElementById('game-away').innerHTML = gOpts;
}

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
    ? '<tr><td colspan="6" style="color:#8b949e">No players yet.</td></tr>'
    : players.map(p => `<tr>
        <td>${p.id}</td><td>${p.number ?? '–'}</td><td>${p.name}</td>
        <td>${p.position ?? '–'}</td><td>${p.team_name ?? '–'}</td>
        <td><button class="btn-danger" onclick="deletePlayer(${p.id})">Delete</button></td>
      </tr>`).join('');
}

document.getElementById('player-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('player-name').value.trim();
  const team_id = document.getElementById('player-team').value || null;
  const position = document.getElementById('player-position').value.trim() || null;
  const number = document.getElementById('player-number').value || null;
  await fetch(`${API}/players`, { method: 'POST', headers: adminJsonHeaders(), body: JSON.stringify({ name, team_id, position, number }) });
  e.target.reset(); await loadTeams(); await loadPlayers();
});

async function deletePlayer(id) {
  if (!confirm('Delete this player?')) return;
  await fetch(`${API}/players/${id}`, { method: 'DELETE', headers: adminHeaders() });
  await loadPlayers();
}

// ── Games ─────────────────────────────────────────────────────────────────

async function loadGames() {
  const res = await fetch(`${API}/games`);
  const games = await res.json();
  const seasonMap = Object.fromEntries(allSeasons.map(s => [s.id, s.name]));
  const tbody = document.querySelector('#games-table tbody');
  tbody.innerHTML = games.length === 0
    ? '<tr><td colspan="8" style="color:#8b949e">No games yet.</td></tr>'
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
        <td><button class="btn-danger" onclick="deleteGame(${g.id})">Delete</button></td>
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
  if (home_team_id === away_team_id) { alert('Home and away teams must differ.'); return; }
  await fetch(`${API}/games`, { method: 'POST', headers: adminJsonHeaders(), body: JSON.stringify({ date, home_team_id, away_team_id, home_score, away_score, season_id, status, is_overtime }) });
  e.target.reset(); await loadGames();
});

async function deleteGame(id) {
  if (!confirm('Delete this game?')) return;
  await fetch(`${API}/games/${id}`, { method: 'DELETE', headers: adminHeaders() });
  await loadGames();
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
    ? '<tr><td colspan="7" style="color:#8b949e">No registered players yet.</td></tr>'
    : users.map(u => `<tr>
        <td><strong>${u.username}</strong></td>
        <td>${u.position || '—'}</td>
        <td>${u.platform === 'psn' ? 'PlayStation' : 'Xbox'}</td>
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
            data-email="${(u.email||'').replace(/"/g,'&quot;')}">Edit</button>
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
  const { uid, username, platform, position, email } = btn.dataset;
  openEditModal(Number(uid), username, platform, position, email);
});

// ── Edit player modal ─────────────────────────────────────────────────────

function openEditModal(id, username, platform, position, email) {
  document.getElementById('ep-id').value = id;
  document.getElementById('ep-username').value = username;
  document.getElementById('ep-platform').value = platform;
  document.getElementById('ep-position').value = position;
  document.getElementById('ep-email').value = email;
  document.getElementById('ep-error').style.display = 'none';
  const overlay = document.getElementById('edit-player-overlay');
  overlay.style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('edit-player-overlay').style.display = 'none';
}

async function savePlayerEdit() {
  const id       = document.getElementById('ep-id').value;
  const username = document.getElementById('ep-username').value.trim();
  const platform = document.getElementById('ep-platform').value;
  const position = document.getElementById('ep-position').value;
  const email    = document.getElementById('ep-email').value.trim();
  const errEl    = document.getElementById('ep-error');
  errEl.style.display = 'none';
  if (!username) { errEl.textContent = 'Gamertag cannot be empty'; errEl.style.display = ''; return; }
  const res = await fetch(`${API}/users/${id}`, {
    method: 'PATCH', headers: adminJsonHeaders(),
    body: JSON.stringify({ username, platform, position: position || null, email: email || null }),
  });
  if (!res.ok) {
    const e = await res.json();
    errEl.textContent = e.error || 'Failed to save';
    errEl.style.display = '';
    return;
  }
  closeEditModal();
  await loadRegPlayers();
  await loadPlayers(); // refresh the legacy players table too
}

// Close modal on overlay click
document.getElementById('edit-player-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('edit-player-overlay')) closeEditModal();
});

// ── Init ──────────────────────────────────────────────────────────────────

checkAuth();
