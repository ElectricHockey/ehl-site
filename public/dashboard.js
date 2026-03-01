const API = '/api';
function getToken() { return localStorage.getItem('ehl_player_token') || ''; }
function playerHeaders() { return { 'Content-Type': 'application/json', 'X-Player-Token': getToken() }; }

async function loadDashboard() {
  const root = document.getElementById('dash-root');
  const token = getToken();
  if (!token) { window.location.href = 'register.html'; return; }

  try {
    const res = await fetch(`${API}/players/me`, { headers: { 'X-Player-Token': token } });
    if (!res.ok) { localStorage.removeItem('ehl_player_token'); window.location.href = 'register.html'; return; }
    const { user, player, staff } = await res.json();

    const ownerRole = staff.find(s => s.role === 'owner');
    const gmRole    = staff.find(s => s.role === 'gm');
    const myTeam    = ownerRole || gmRole;

    // Build tabs
    const tabs = ['Profile'];
    if (myTeam) tabs.push('My Team');
    if (ownerRole) tabs.push('Manage GMs');
    if (ownerRole || gmRole) tabs.push('Sign/Release');

    let html = `
      <h1 style="margin-bottom:0.5rem;">Player Dashboard</h1>
      <div class="dash-card" style="margin-bottom:1rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
        <span class="player-badge">🎮 ${user.username}</span>
        <span style="color:#8b949e;font-size:0.85rem;">${user.platform === 'psn' ? 'PlayStation' : 'Xbox'}</span>
        ${player && player.team_id
          ? `<span class="roster-tag">On Roster</span>`
          : `<span class="roster-tag free">Free Agent</span>`}
        ${myTeam ? `<span class="role-badge">${ownerRole ? '👑 Owner' : '📋 GM'} – ${myTeam.team_name}</span>` : ''}
        <button onclick="logout()" class="btn-secondary" style="margin-left:auto;font-size:0.82rem;padding:0.3rem 0.7rem;">Logout</button>
      </div>
      <div class="tab-bar" id="tab-bar">
        ${tabs.map((t, i) => `<button class="tab-pill${i===0?' active':''}" onclick="showDashTab('${t}')">${t}</button>`).join('')}
      </div>`;

    // Profile section
    html += `<div id="ds-Profile" class="dash-section active">
      <div class="dash-card">
        <h2>👤 Profile</h2>
        <p><strong>Gamertag:</strong> ${user.username}</p>
        <p><strong>Platform:</strong> ${user.platform === 'psn' ? 'PlayStation Network' : 'Xbox'}</p>
        ${user.email ? `<p><strong>Email:</strong> ${user.email}</p>` : ''}
        <p><strong>Registered:</strong> ${new Date(user.created_at).toLocaleDateString()}</p>
        ${player
          ? `<p><strong>Current Team:</strong> ${player.team_id ? `<a href="team.html?id=${player.team_id}">${player.team_id}</a>` : 'Free Agent'}</p>`
          : '<p style="color:#8b949e">No player profile yet.</p>'}
      </div>
    </div>`;

    // My Team section
    if (myTeam) {
      const teamId = myTeam.team_id;
      const teamRes = await fetch(`${API}/teams/${teamId}/stats`);
      const teamData = teamRes.ok ? await teamRes.json() : null;
      html += `<div id="ds-My Team" class="dash-section">
        <div class="dash-card">
          <h2>🏒 <a href="team.html?id=${teamId}">${myTeam.team_name}</a></h2>
          ${teamData ? `<p style="color:#8b949e;font-size:0.85rem;">Roster: ${teamData.roster.length} players</p>
          <div>${teamData.roster.map(p => `
            <div class="roster-row">
              <span>${p.name}</span>
              ${p.position ? `<span style="color:#8b949e;font-size:0.8rem;">${p.position}</span>` : ''}
              ${p.platform ? `<span style="color:#8b949e;font-size:0.75rem;">${p.platform}</span>` : ''}
            </div>`).join('')}</div>` : '<p class="error">Could not load team data.</p>'}
        </div>
      </div>`;
    }

    // Manage GMs section (owner only)
    if (ownerRole) {
      const teamId = ownerRole.team_id;
      const staffRes = await fetch(`${API}/teams/${teamId}/stats`);
      const staffData = staffRes.ok ? await staffRes.json() : null;
      const gms = staffData ? staffData.staff.filter(s => s.role === 'gm') : [];
      html += `<div id="ds-Manage GMs" class="dash-section">
        <div class="dash-card">
          <h2>📋 General Managers (${gms.length}/2)</h2>
          ${gms.length > 0
            ? gms.map(g => `<div class="roster-row">
                <span>${g.username} <small style="color:#8b949e;">(${g.platform})</small></span>
                <button class="btn-danger" style="font-size:0.8rem;padding:0.2rem 0.5rem;" onclick="removeGM(${teamId},${g.user_id})">Remove</button>
              </div>`).join('')
            : '<p style="color:#8b949e;font-size:0.85rem;">No GMs assigned yet.</p>'}
          ${gms.length < 2 ? `
            <h3 style="margin-top:1rem;font-size:0.9rem;">Add a GM</h3>
            <input type="text" class="search-input" id="gm-search" placeholder="Search by gamertag…" oninput="searchUsers('gm-results','gm-search',${teamId},'gm')" />
            <div id="gm-results"></div>` : '<p style="color:#8b949e;font-size:0.82rem;margin-top:0.5rem;">Maximum 2 GMs reached.</p>'}
        </div>
      </div>`;
    }

    // Sign/Release section (owner or GM)
    if (ownerRole || gmRole) {
      const teamId = (ownerRole || gmRole).team_id;
      const teamRes = await fetch(`${API}/teams/${teamId}/stats`);
      const teamData = teamRes.ok ? await teamRes.json() : null;
      const roster = teamData ? teamData.roster : [];
      html += `<div id="ds-Sign/Release" class="dash-section">
        <div class="dash-card">
          <h2>✍️ Sign a Player</h2>
          <input type="text" class="search-input" id="sign-search" placeholder="Search free agents by gamertag…" oninput="searchFreeAgents('sign-results','sign-search',${teamId})" />
          <div id="sign-results"></div>
        </div>
        <div class="dash-card">
          <h2>🔄 Release a Player</h2>
          ${roster.length === 0
            ? '<p style="color:#8b949e;">No players on roster.</p>'
            : roster.map(p => `<div class="roster-row">
                <span>${p.name}${p.position ? ` <small style="color:#8b949e;">${p.position}</small>` : ''}</span>
                <button class="btn-danger" style="font-size:0.8rem;padding:0.2rem 0.5rem;"
                  data-action="release" data-team="${teamId}" data-player="${p.id}"
                  data-name="${p.name.replace(/"/g,'&quot;')}">Release</button>
              </div>`).join('')}
        </div>
      </div>`;
    }

    root.innerHTML = html;
  } catch (err) {
    root.innerHTML = `<p class="error">Failed to load dashboard: ${err.message}</p>`;
  }
}

function showDashTab(name) {
  document.querySelectorAll('.dash-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-pill').forEach(el => el.classList.toggle('active', el.textContent === name));
  const sec = document.getElementById(`ds-${name}`);
  if (sec) sec.classList.add('active');
}

let _faCache = null;
async function getFreeAgents() {
  if (_faCache) return _faCache;
  const res = await fetch(`${API}/users/free-agents`, { headers: { 'X-Player-Token': getToken() } });
  _faCache = res.ok ? await res.json() : [];
  return _faCache;
}

async function searchFreeAgents(resultsId, inputId, teamId) {
  const q = document.getElementById(inputId).value.trim().toLowerCase();
  const el = document.getElementById(resultsId);
  if (!q) { el.innerHTML = ''; return; }
  const fa = await getFreeAgents();
  const filtered = fa.filter(u => u.username.toLowerCase().includes(q)).slice(0, 8);
  el.innerHTML = filtered.length === 0
    ? '<p style="color:#8b949e;font-size:0.83rem;padding:0.3rem 0;">No free agents found.</p>'
    : `<div class="user-list">${filtered.map(u => `
      <div class="user-item">
        <span>${u.username} <small style="color:#8b949e;">${u.platform}</small></span>
        <button class="btn-secondary" style="font-size:0.8rem;padding:0.2rem 0.5rem;"
          data-action="sign" data-team="${teamId}" data-user="${u.id}"
          data-name="${u.username.replace(/"/g,'&quot;')}">Sign</button>
      </div>`).join('')}</div>`;
}

async function searchUsers(resultsId, inputId, teamId, action) {
  const q = document.getElementById(inputId).value.trim().toLowerCase();
  const el = document.getElementById(resultsId);
  if (!q) { el.innerHTML = ''; return; }
  const fa = await getFreeAgents();
  const filtered = fa.filter(u => u.username.toLowerCase().includes(q)).slice(0, 8);
  el.innerHTML = filtered.length === 0
    ? '<p style="color:#8b949e;font-size:0.83rem;padding:0.3rem 0;">No users found.</p>'
    : `<div class="user-list">${filtered.map(u => `
      <div class="user-item">
        <span>${u.username} <small style="color:#8b949e;">${u.platform}</small></span>
        <button class="btn-secondary" style="font-size:0.8rem;padding:0.2rem 0.5rem;"
          data-action="addgm" data-team="${teamId}" data-user="${u.id}"
          data-name="${u.username.replace(/"/g,'&quot;')}">Add as GM</button>
      </div>`).join('')}</div>`;
}

// Delegated click handler for data-action buttons
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, team, player, user, name } = btn.dataset;
  if (action === 'release') releasePlayer(Number(team), Number(player), name);
  if (action === 'sign')    signPlayer(Number(team), Number(user), name);
  if (action === 'addgm')  addGM(Number(team), Number(user), name);
});

async function signPlayer(teamId, userId, username) {
  if (!confirm(`Sign ${username} to the roster?`)) return;
  _faCache = null;
  const res = await fetch(`${API}/teams/${teamId}/roster/sign`, {
    method: 'POST', headers: playerHeaders(), body: JSON.stringify({ user_id: userId }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Failed to sign player'); return; }
  alert(`${username} has been signed!`);
  loadDashboard();
}

async function releasePlayer(teamId, playerId, name) {
  if (!confirm(`Release ${name} from the roster?`)) return;
  _faCache = null;
  const res = await fetch(`${API}/teams/${teamId}/roster/${playerId}`, {
    method: 'DELETE', headers: playerHeaders(),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Failed to release player'); return; }
  alert(`${name} has been released.`);
  loadDashboard();
}

async function addGM(teamId, userId, username) {
  if (!confirm(`Add ${username} as a GM?`)) return;
  _faCache = null;
  const res = await fetch(`${API}/teams/${teamId}/gms`, {
    method: 'POST', headers: playerHeaders(), body: JSON.stringify({ user_id: userId }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Failed to add GM'); return; }
  alert(`${username} is now a GM!`);
  loadDashboard();
}

async function removeGM(teamId, userId) {
  if (!confirm('Remove this GM?')) return;
  _faCache = null;
  const res = await fetch(`${API}/teams/${teamId}/gms/${userId}`, {
    method: 'DELETE', headers: playerHeaders(),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Failed to remove GM'); return; }
  loadDashboard();
}

function logout() {
  fetch(`${API}/players/logout`, { method: 'POST', headers: { 'X-Player-Token': getToken() } }).catch(() => {});
  localStorage.removeItem('ehl_player_token');
  localStorage.removeItem('ehl_player_user');
  window.location.href = 'register.html';
}

loadDashboard();
