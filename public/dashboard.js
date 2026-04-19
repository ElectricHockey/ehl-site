const API = '/api';
function getToken() { return localStorage.getItem('ehl_player_token') || ''; }
function playerHeaders() { return { 'Content-Type': 'application/json', 'X-Player-Token': getToken() }; }

// ── Handle direct login redirect (?auth_token=...&auth_user=...) ──────────
// The Discord OAuth callback now redirects here directly with a signed session
// token, eliminating the fragile register.js → POST chain.
(function () {
  const params = new URLSearchParams(window.location.search);
  const authToken = params.get('auth_token');
  if (authToken) {
    localStorage.setItem('ehl_player_token', authToken);
    const authUser = params.get('auth_user');
    if (authUser) {
      try { localStorage.setItem('ehl_player_user', authUser); } catch { /* ignore */ }
    }
    // Clean URL immediately so the token isn't in browser history
    window.history.replaceState({}, '', window.location.pathname);
  }
})();

async function loadDashboard() {
  const root = document.getElementById('dash-root');
  const token = getToken();
  if (!token) { window.location.href = 'register.html'; return; }

  try {
    const res = await fetch(`${API}/players/me`, { headers: { 'X-Player-Token': token } });
    if (!res.ok) {
      // Only clear the token on 401 (invalid/expired token).
      // Do NOT clear on 500, 503, 429, etc. — those are transient server issues.
      if (res.status === 401) {
        localStorage.removeItem('ehl_player_token');
        localStorage.removeItem('ehl_player_user');
        window.location.href = 'register.html';
        return;
      }
      // Parse error safely — server might return HTML on 500
      let detail = '';
      try { const d = await res.json(); detail = d.detail || d.error || ''; } catch { /* ignore */ }
      root.innerHTML = `<div style="text-align:center;margin:3rem;">
        <p class="error">Server error (${res.status})${detail ? ': ' + detail : ''}</p>
        <p style="color:#8b949e;font-size:0.88rem;margin-top:0.75rem;">Your session is saved — this is a temporary server issue.</p>
        <button onclick="loadDashboard()" style="margin-top:1rem;padding:0.5rem 1.5rem;cursor:pointer;">🔄 Retry</button>
      </div>`;
      return;
    }
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
        <p><strong>Position:</strong> ${user.position || '—'}</p>
        ${user.discord_id
          ? `<p><strong>Discord:</strong> <span style="color:#a5b4fc;display:inline-flex;align-items:center;gap:0.3rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.013.043.03.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>${user.discord}</span>
               <button onclick="relinkDiscord()" class="btn-secondary" style="margin-left:0.5rem;font-size:0.78rem;padding:0.2rem 0.5rem;">Relink</button></p>`
          : `<p><strong>Discord:</strong>
               ${user.discord ? `<span style="color:#8b949e;">${user.discord} (not verified)</span>` : '<span style="color:#8b949e;">—</span>'}
               <button onclick="linkDiscord()" style="margin-left:0.5rem;display:inline-flex;align-items:center;gap:0.35rem;padding:0.3rem 0.75rem;background:#5865f2;border:none;border-radius:5px;color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.013.043.03.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
                 Link Discord
               </button></p>`}
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
          <h2>✍️ Offer Contract</h2>
          <p style="color:#8b949e;font-size:0.83rem;margin-top:-0.3rem;">The player will receive a notification to accept or decline.</p>
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
    root.innerHTML = `<div style="text-align:center;margin:3rem;">
      <p class="error">Failed to load dashboard: ${err.message}</p>
      <p style="color:#8b949e;font-size:0.88rem;margin-top:0.75rem;">Your session is saved — this may be a temporary issue.</p>
      <button onclick="loadDashboard()" style="margin-top:1rem;padding:0.5rem 1.5rem;cursor:pointer;">🔄 Retry</button>
    </div>`;
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
        <span>${u.username}${u.position ? ` <small style="color:#58a6ff;">${u.position}</small>` : ''} <small style="color:#8b949e;">${u.platform}</small></span>
        <button class="btn-secondary" style="font-size:0.8rem;padding:0.2rem 0.5rem;"
          data-action="offer" data-team="${teamId}" data-user="${u.id}"
          data-name="${u.username.replace(/"/g,'&quot;')}">Offer</button>
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
        <span>${u.username}${u.position ? ` <small style="color:#58a6ff;">${u.position}</small>` : ''} <small style="color:#8b949e;">${u.platform}</small></span>
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
  if (action === 'offer')   offerPlayer(Number(team), Number(user), name);
  if (action === 'addgm')  addGM(Number(team), Number(user), name);
});

async function offerPlayer(teamId, userId, username) {
  if (!confirm(`Send a signing offer to ${username}?`)) return;
  _faCache = null;
  const res = await fetch(`${API}/teams/${teamId}/roster/offer`, {
    method: 'POST', headers: playerHeaders(), body: JSON.stringify({ user_id: userId }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Failed to send offer'); return; }
  alert(`Offer sent to ${username}! They will see a notification to accept or decline.`);
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

// ── Discord link/relink ───────────────────────────────────────────────────

function linkDiscord() {
  window.location.href = `${API}/discord/connect?token=${encodeURIComponent(getToken())}`;
}
function relinkDiscord() { linkDiscord(); }

// ── Handle ?discord_linked=1 redirect from OAuth callback ─────────────────

(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get('discord_linked') === '1') {
    window.history.replaceState({}, '', window.location.pathname);
    // Show brief success toast after dashboard loads
    const toast = document.createElement('div');
    toast.textContent = '✓ Discord account linked successfully!';
    toast.style.cssText = 'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#1f4b2f;color:#3fb950;border:1px solid #3fb950;border-radius:8px;padding:0.65rem 1.25rem;font-size:0.9rem;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }
  if (params.get('discord_error')) {
    window.history.replaceState({}, '', window.location.pathname);
    const toast = document.createElement('div');
    toast.textContent = `Discord link failed: ${params.get('discord_error')}`;
    toast.style.cssText = 'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#4b1f1f;color:#f85149;border:1px solid #f85149;border-radius:8px;padding:0.65rem 1.25rem;font-size:0.9rem;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }
})();

loadDashboard();
