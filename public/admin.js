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
  showAdminTab('seasons');
  loadSeasons();
  loadTeams();
  loadPlayers();
  loadGames();
  loadRegPlayers();
  loadAdminPlayoffs();
}

function showAdminTab(name) {
  document.querySelectorAll('.admin-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.admin-tab-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tab === name)
  );
  const sec = document.getElementById(`admin-tab-${name}`);
  if (sec) sec.classList.add('active');
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

  const typeLabel = lt => lt === 'threes' ? "3's" : lt === 'sixes' ? "6's" : lt || '?';

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
    allSeasons.map(s => `<option value="${s.id}"${s.is_active ? ' selected' : ''}>${s.name} (${typeLabel(s.league_type)})</option>`).join('');
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
  // Roster tab team selector
  const rSel = document.getElementById('roster-team-select');
  const rPrev = rSel.value;
  rSel.innerHTML = '<option value="">— Select a team —</option>' + teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  if (rPrev) rSel.value = rPrev;
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
  if (home_team_id === away_team_id) { alert('Home and away teams must differ.'); return; }
  await fetch(`${API}/games`, { method: 'POST', headers: adminJsonHeaders(), body: JSON.stringify({ date, home_team_id, away_team_id, home_score, away_score, season_id, status, is_overtime }) });
  e.target.reset(); await loadGames();
});

async function deleteGame(id) {
  if (!confirm('Delete this game?')) return;
  await fetch(`${API}/games/${id}`, { method: 'DELETE', headers: adminHeaders() });
  await loadGames();
}

// ── Game Stats Editor ─────────────────────────────────────────────────────

// Column definitions for the per-player stat editor table
const GS_COLS = [
  { l:'OFFR', k:'offensiveRating',      w:42 },
  { l:'DR',   k:'defensiveRating',      w:42 },
  { l:'TPR',  k:'teamPlayRating',       w:42 },
  { l:'G',    k:'goals',                w:38 },
  { l:'A',    k:'assists',              w:38 },
  { l:'+/-',  k:'plusMinus',            w:42, mn:-99 },
  { l:'SOG',  k:'shots',                w:40 },
  { l:'SA',   k:'shotAttempts',         w:40 },
  { l:'HIT',  k:'hits',                 w:40 },
  { l:'PIM',  k:'pim',                  w:40 },
  { l:'BS',   k:'blockedShots',         w:38 },
  { l:'TKA',  k:'takeaways',            w:38 },
  { l:'GVA',  k:'giveaways',            w:38 },
  { l:'PPG',  k:'ppGoals',              w:38 },
  { l:'SHG',  k:'shGoals',              w:38 },
  { l:'GWG',  k:'gwg',                  w:38 },
  { l:'PD',   k:'penaltiesDrawn',       w:38 },
  { l:'FOW',  k:'faceoffWins',          w:38 },
  { l:'FOL',  k:'faceoffLosses',        w:38 },
  { l:'DEF',  k:'deflections',          w:38 },
  { l:'INT',  k:'interceptions',        w:38 },
  { l:'PA',   k:'passAttempts',         w:45 },
  { l:'PC',   k:'passCompletions',      w:45 },
  { l:'HT',   k:'hatTricks',            w:35 },
  { l:'POSS', k:'possessionSecs',       w:52 },
  { l:'TOI',  k:'toi',                  w:52 },
  { l:'SV',   k:'saves',                w:38 },
  { l:'GA',   k:'goalsAgainst',         w:38 },
  { l:'ShAg', k:'shotsAgainst',         w:42 },
  { l:'PSA',  k:'penaltyShotAttempts',  w:38 },
  { l:'PSGA', k:'penaltyShotGa',        w:42 },
  { l:'BKSA', k:'breakawayShots',       w:40 },
  { l:'BKSV', k:'breakawaySaves',       w:40 },
];

let _gsEditorGameId = null;
let _gsRowIdx = 0;

// Convert a snake_case DB row → camelCase object for the form
function gsDbToRow(p) {
  return {
    name:                p.player_name             || '',
    position:            p.position                || '',
    offensiveRating:     p.offensive_rating        || 0,
    defensiveRating:     p.defensive_rating        || 0,
    teamPlayRating:      p.team_play_rating        || 0,
    goals:               p.goals                   || 0,
    assists:             p.assists                 || 0,
    plusMinus:           p.plus_minus              || 0,
    shots:               p.shots                   || 0,
    shotAttempts:        p.shot_attempts           || 0,
    hits:                p.hits                    || 0,
    pim:                 p.pim                     || 0,
    blockedShots:        p.blocked_shots           || 0,
    takeaways:           p.takeaways               || 0,
    giveaways:           p.giveaways               || 0,
    ppGoals:             p.pp_goals                || 0,
    shGoals:             p.sh_goals                || 0,
    gwg:                 p.gwg                     || 0,
    penaltiesDrawn:      p.penalties_drawn         || 0,
    faceoffWins:         p.faceoff_wins            || 0,
    faceoffLosses:       p.faceoff_losses          || 0,
    deflections:         p.deflections             || 0,
    interceptions:       p.interceptions           || 0,
    passAttempts:        p.pass_attempts           || 0,
    passCompletions:     p.pass_completions        || 0,
    hatTricks:           p.hat_tricks              || 0,
    possessionSecs:      p.possession_secs         || 0,
    toi:                 p.toi                     || 0,
    saves:               p.saves                   || 0,
    goalsAgainst:        p.goals_against           || 0,
    shotsAgainst:        p.shots_against           || 0,
    penaltyShotAttempts: p.penalty_shot_attempts   || 0,
    penaltyShotGa:       p.penalty_shot_ga         || 0,
    breakawayShots:      p.breakaway_shots         || 0,
    breakawaySaves:      p.breakaway_saves         || 0,
  };
}

// Build one editable player row
function gsBuildRow(side, p) {
  p = p || {};
  const rowId = `gsr-${side}-${_gsRowIdx++}`;
  const IS = 'background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:3px;padding:0.1rem 0;font-size:0.75rem;text-align:center;';
  const numInp = (key, val, w, mn) => {
    const minA = mn !== undefined ? `min="${mn}"` : 'min="0"';
    return `<input type="number" data-key="${key}" value="${val !== undefined ? val : 0}" ${minA} style="${IS}width:${w || 45}px;" />`;
  };
  const cells = GS_COLS.map(c => `<td style="padding:0.08rem 0.1rem;">${numInp(c.k, p[c.k], c.w, c.mn)}</td>`).join('');
  const posOpts = ['C','LW','RW','LD','RD','G'].map(pos => `<option${pos === (p.position || '') ? ' selected' : ''}>${pos}</option>`).join('');
  const safeName = (p.name || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  return `<tr id="${rowId}">
    <td style="padding:0.08rem 0.1rem;"><button onclick="gseRemoveRow('${rowId}')" title="Remove player" style="background:#da3633;border:none;border-radius:3px;color:#fff;cursor:pointer;padding:0.1rem 0.35rem;font-size:0.75rem;">✕</button></td>
    <td style="padding:0.08rem 0.1rem;"><input type="text" data-key="name" value="${safeName}" placeholder="Player name" style="background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:3px;padding:0.1rem 0.25rem;width:110px;font-size:0.75rem;" /></td>
    <td style="padding:0.08rem 0.1rem;"><select data-key="position" style="background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:3px;padding:0.1rem;font-size:0.75rem;">${posOpts}</select></td>
    ${cells}
  </tr>`;
}

// Build the scrollable player table for one team side
function gsBuildTable(side, players) {
  const hdr = GS_COLS.map(c => `<th title="${c.l}" style="padding:0.15rem 0.06rem;font-size:0.68rem;white-space:nowrap;">${c.l}</th>`).join('');
  const rows = (players || []).map(p => gsBuildRow(side, gsDbToRow(p))).join('');
  return `<table id="gse-tbl-${side}" style="border-collapse:collapse;">
    <thead><tr style="background:#0d1117;">
      <th style="padding:0.15rem;"></th>
      <th style="padding:0.15rem 0.3rem;font-size:0.68rem;min-width:110px;">Name</th>
      <th style="padding:0.15rem;font-size:0.68rem;">Pos</th>
      ${hdr}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function editGameStats(gameId) {
  const res = await fetch(`${API}/games/${gameId}/stats`, { headers: adminHeaders() });
  if (!res.ok) { alert('Failed to load game stats'); return; }
  const data = await res.json();
  _gsEditorGameId = gameId;

  const existing = document.getElementById('game-stats-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'game-stats-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;overflow-y:auto;padding:1.5rem 0.5rem;';

  const g = data.game;
  const IS = 'background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:5px;padding:0.3rem 0.5rem;';
  const seasonOpts = '<option value="">— No Season —</option>' +
    allSeasons.map(s => `<option value="${s.id}"${s.id === g.season_id ? ' selected' : ''}>${s.name}</option>`).join('');

  const modalHtml = `<div style="background:#161b22;border:1px solid #30363d;border-radius:10px;max-width:1400px;margin:0 auto;padding:1.5rem;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
      <h3 style="margin:0;">✏️ Edit Game #${g.id} – ${g.home_team.name} vs ${g.away_team.name}</h3>
      <button onclick="closeGameStatsEditor()" style="background:none;border:none;color:#8b949e;font-size:1.3rem;cursor:pointer;line-height:1;">✕</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:1rem;margin-bottom:1.25rem;padding:1rem;background:#0d1117;border-radius:8px;align-items:flex-end;">
      <div>
        <label style="display:block;color:#8b949e;font-size:0.75rem;margin-bottom:0.25rem;">Date</label>
        <input type="date" id="gse-date" value="${g.date || ''}" style="${IS}" />
      </div>
      <div>
        <label style="display:block;color:#8b949e;font-size:0.75rem;margin-bottom:0.25rem;">${g.home_team.name} Score</label>
        <input type="number" id="gse-home-score" value="${g.home_score}" min="0" style="${IS}width:60px;" />
      </div>
      <div>
        <label style="display:block;color:#8b949e;font-size:0.75rem;margin-bottom:0.25rem;">${g.away_team.name} Score</label>
        <input type="number" id="gse-away-score" value="${g.away_score}" min="0" style="${IS}width:60px;" />
      </div>
      <div>
        <label style="display:block;color:#8b949e;font-size:0.75rem;margin-bottom:0.25rem;">Status</label>
        <select id="gse-status" style="${IS}">
          <option value="scheduled"${g.status === 'scheduled' ? ' selected' : ''}>Scheduled</option>
          <option value="complete"${g.status === 'complete' ? ' selected' : ''}>Complete</option>
        </select>
      </div>
      <div>
        <label style="display:block;color:#8b949e;font-size:0.75rem;margin-bottom:0.25rem;">Season</label>
        <select id="gse-season" style="${IS}">${seasonOpts}</select>
      </div>
      <label style="display:flex;align-items:center;gap:0.35rem;cursor:pointer;font-size:0.85rem;">
        <input type="checkbox" id="gse-overtime" ${g.is_overtime ? 'checked' : ''} /> Overtime
      </label>
    </div>
    <div style="display:flex;gap:0.4rem;margin-bottom:1rem;border-bottom:1px solid #30363d;padding-bottom:0.5rem;">
      <button class="gse-tab gse-tab-active" data-side="home" onclick="gseShowTab('home')" style="padding:0.3rem 1rem;border-radius:20px;border:1px solid #58a6ff;background:#1c2a3a;color:#58a6ff;cursor:pointer;font-size:0.85rem;">🏠 ${g.home_team.name}</button>
      <button class="gse-tab" data-side="away" onclick="gseShowTab('away')" style="padding:0.3rem 1rem;border-radius:20px;border:1px solid #30363d;background:#21262d;color:#8b949e;cursor:pointer;font-size:0.85rem;">✈️ ${g.away_team.name}</button>
    </div>
    <div id="gse-panel-home">
      <div style="overflow-x:auto;">${gsBuildTable('home', data.home_players)}</div>
      <button onclick="gseAddPlayer('home')" style="margin-top:0.5rem;padding:0.3rem 0.8rem;background:#238636;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:0.83rem;">+ Add Player</button>
    </div>
    <div id="gse-panel-away" style="display:none;">
      <div style="overflow-x:auto;">${gsBuildTable('away', data.away_players)}</div>
      <button onclick="gseAddPlayer('away')" style="margin-top:0.5rem;padding:0.3rem 0.8rem;background:#238636;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:0.83rem;">+ Add Player</button>
    </div>
    <div id="gse-error" style="color:#f85149;font-size:0.84rem;margin-top:0.75rem;display:none;"></div>
    <div style="display:flex;gap:0.5rem;margin-top:1.25rem;">
      <button onclick="saveGameStatsEdits()" style="padding:0.45rem 1.2rem;background:#238636;border:none;border-radius:6px;color:#fff;cursor:pointer;font-weight:600;font-size:0.9rem;">💾 Save Changes</button>
      <button onclick="closeGameStatsEditor()" style="padding:0.45rem 1.2rem;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;cursor:pointer;font-size:0.9rem;">Cancel</button>
    </div>
  </div>`;

  overlay.innerHTML = modalHtml;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeGameStatsEditor(); });
}

function gseShowTab(side) {
  document.querySelectorAll('.gse-tab').forEach(btn => {
    const active = btn.dataset.side === side;
    btn.style.background = active ? '#1c2a3a' : '#21262d';
    btn.style.borderColor = active ? '#58a6ff' : '#30363d';
    btn.style.color = active ? '#58a6ff' : '#8b949e';
  });
  document.getElementById('gse-panel-home').style.display = side === 'home' ? '' : 'none';
  document.getElementById('gse-panel-away').style.display = side === 'away' ? '' : 'none';
}

function gseAddPlayer(side) {
  const tbody = document.querySelector(`#gse-tbl-${side} tbody`);
  if (tbody) tbody.insertAdjacentHTML('beforeend', gsBuildRow(side, {}));
}

function gseRemoveRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) row.remove();
}

function gseCollectPlayers(side) {
  const players = [];
  document.querySelectorAll(`#gse-tbl-${side} tbody tr`).forEach(row => {
    const p = {};
    row.querySelectorAll('[data-key]').forEach(el => {
      const key = el.dataset.key;
      if (el.tagName === 'SELECT') p[key] = el.value;
      else if (el.type === 'number') p[key] = Number(el.value) || 0;
      else p[key] = el.value.trim();
    });
    if (p.name) players.push(p);
  });
  return players;
}

async function saveGameStatsEdits() {
  const errEl = document.getElementById('gse-error');
  errEl.style.display = 'none';
  const body = {
    date:        document.getElementById('gse-date').value,
    home_score:  parseInt(document.getElementById('gse-home-score').value) || 0,
    away_score:  parseInt(document.getElementById('gse-away-score').value) || 0,
    status:      document.getElementById('gse-status').value,
    season_id:   document.getElementById('gse-season').value ? Number(document.getElementById('gse-season').value) : null,
    is_overtime: document.getElementById('gse-overtime').checked ? 1 : 0,
    player_stats: {
      home_players: gseCollectPlayers('home'),
      away_players: gseCollectPlayers('away'),
    },
  };
  const res = await fetch(`${API}/games/${_gsEditorGameId}`, {
    method: 'PATCH', headers: adminJsonHeaders(), body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    errEl.textContent = e.error || 'Failed to save';
    errEl.style.display = '';
    return;
  }
  closeGameStatsEditor();
  await loadGames();
  showStatus('Game stats saved!');
}

function closeGameStatsEditor() {
  const el = document.getElementById('game-stats-overlay');
  if (el) el.remove();
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
  openEditModal({ id: Number(uid), username, platform, position, email, discord: discord || '' });
});

// ── Edit player modal ─────────────────────────────────────────────────────

function openEditModal({ id, username, platform, position, email, discord }) {
  document.getElementById('ep-id').value = id;
  document.getElementById('ep-username').value = username;
  document.getElementById('ep-platform').value = platform;
  document.getElementById('ep-position').value = position;
  document.getElementById('ep-email').value = email;
  document.getElementById('ep-discord').value = discord || '';
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
  const discord  = document.getElementById('ep-discord').value.trim();
  const errEl    = document.getElementById('ep-error');
  errEl.style.display = 'none';
  if (!username) { errEl.textContent = 'Gamertag cannot be empty'; errEl.style.display = ''; return; }
  const res = await fetch(`${API}/users/${id}`, {
    method: 'PATCH', headers: adminJsonHeaders(),
    body: JSON.stringify({ username, platform, position: position || null, email: email || null, discord: discord || null }),
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

// ── Playoffs ──────────────────────────────────────────────────────────────

const typeLabel = lt => lt === 'threes' ? "3's" : lt === 'sixes' ? "6's" : lt || '?';

async function loadAdminPlayoffs() {
  // Populate season dropdown for create form
  const res = await fetch(`${API}/seasons`);
  const seasons = res.ok ? await res.json() : [];
  const sel = document.getElementById('po-season');
  if (sel) {
    sel.innerHTML = '<option value="">— Select Season —</option>' +
      seasons.map(s => `<option value="${s.id}">${s.name} (${typeLabel(s.league_type)})</option>`).join('');
  }

  // For each season, try to load its playoff
  const list = document.getElementById('playoffs-list');
  if (!list) return;
  if (seasons.length === 0) {
    list.innerHTML = '<p style="color:#8b949e;font-size:0.85rem;">No seasons yet. Create a season first.</p>';
    return;
  }

  list.innerHTML = '<p style="color:#8b949e;font-size:0.85rem;">Loading…</p>';
  const rows = [];
  for (const s of seasons) {
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

  return `<div style="background:#161b22;border:1px solid #30363d;border-radius:10px;padding:1.25rem;margin-bottom:1.25rem;">
    <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:0.75rem;">
      <strong style="font-size:1rem;">${season.name}</strong>
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
    <span style="font-size:0.78rem;color:#8b949e;min-width:22px;">${s.high_seed_num || '?'}</span>
    <span style="font-size:0.82rem;font-weight:600;flex:1;${s.winner_id === s.high_seed_id ? 'color:#3fb950;' : ''}">${abbrevAdmin(hi)}</span>
    <input type="number" min="0" max="${winsToWin}" value="${s.high_seed_wins}" id="high-wins-${s.id}"
      style="width:38px;text-align:center;background:#161b22;border:1px solid #30363d;color:#e6edf3;border-radius:4px;padding:0.1rem;"
      onchange="updateSeriesWins(${s.id}, this.value, document.getElementById('low-wins-${s.id}').value)" />
    <span style="color:#8b949e;">–</span>
    <input type="number" min="0" max="${winsToWin}" value="${s.low_seed_wins}" id="low-wins-${s.id}"
      style="width:38px;text-align:center;background:#161b22;border:1px solid #30363d;color:#e6edf3;border-radius:4px;padding:0.1rem;"
      onchange="updateSeriesWins(${s.id}, document.getElementById('high-wins-${s.id}').value, this.value)" />
    <span style="font-size:0.82rem;font-weight:600;flex:1;text-align:right;${s.winner_id === s.low_seed_id ? 'color:#3fb950;' : ''}">${abbrevAdmin(lo)}</span>
    <span style="font-size:0.78rem;color:#8b949e;min-width:22px;text-align:right;">${s.low_seed_num || '?'}</span>
    ${done ? `<span style="font-size:0.75rem;color:#3fb950;margin-left:0.2rem;" title="Series complete">✓</span>` : ''}
  </div>`;
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

  if (!season_id) { alert('Please select a season.'); return; }

  const res = await fetch(`${API}/playoffs`, {
    method: 'POST',
    headers: adminJsonHeaders(),
    body: JSON.stringify({ season_id: Number(season_id), teams_qualify, min_games_played, series_length }),
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
