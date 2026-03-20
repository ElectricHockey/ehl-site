const API = '/api';

// Save percentage: display as hockey-standard decimal, e.g. .922
function pct3(v) {
  if (v === null || v === undefined) return '–';
  const frac = v > 1 ? v / 100 : v;
  return frac.toFixed(3).replace(/^0(?=\.)/, '');
}

let isAdmin = false;
let activeGameId = null;       // game detail
let activePickerGameId = null; // picker
let allGames = [];
let currentPickerMatches = [];

// ── Admin helpers ──────────────────────────────────────────────────────────

function getAdminToken() {
  return localStorage.getItem('ehl_admin_token') || '';
}

function adminHeaders() {
  return { 'Content-Type': 'application/json', 'X-Admin-Token': getAdminToken() };
}

async function checkAdmin() {
  try {
    const res = await fetch(`${API}/auth/status`, {
      headers: { 'X-Admin-Token': getAdminToken() },
    });
    const data = await res.json();
    // data.loggedIn is only true for active admin sessions (owner / game_admin)
    isAdmin = (data.loggedIn && !!data.role) || false;
  } catch { isAdmin = false; }
  document.getElementById('admin-bar').style.display = isAdmin ? '' : 'none';
}

async function adminLogout() {
  await fetch(`${API}/auth/logout`, {
    method: 'POST',
    headers: { 'X-Admin-Token': getAdminToken() },
  }).catch(() => {});
  localStorage.removeItem('ehl_admin_token');
  window.location.reload();
}

// ── Badge helpers ──────────────────────────────────────────────────────────

function resultBadge(r) {
  if (r === 'W') return '<span class="badge badge-win">W</span>';
  if (r === 'L') return '<span class="badge badge-loss">L</span>';
  return `<span class="badge badge-tie">${r}</span>`;
}

function statusBadge(s, isForfeit) {
  if (s === 'complete' && isForfeit) return '<span class="status-badge status-forfeit">🏳 Forfeit</span>';
  if (s === 'complete') return '<span class="status-badge status-complete">✓ Final</span>';
  return '<span class="status-badge status-scheduled">Scheduled</span>';
}

function formatToi(seconds) {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// game-stats.js (loaded before this file) provides GameStats.renderTeamPanel

// Compact version for inside the EA picker (kept separate – small, no need for full shared module)
function renderPickerPlayerStats(players) {
  if (!players || players.length === 0) return '<p style="color:#8b949e;font-size:0.8rem;">No player data.</p>';
  const posOrder = { G: 0, C: 1, LW: 2, RW: 3, LD: 4, RD: 5 };
  const sorted = [...players].sort((a, b) => (posOrder[a.position] ?? 9) - (posOrder[b.position] ?? 9));
  const skaters = sorted.filter(p => p.position !== 'G');
  const goalies  = sorted.filter(p => p.position === 'G');
  let html = '';
  if (skaters.length > 0) {
    html += `<table><thead><tr>
      <th>Pos</th><th>Player</th><th>G</th><th>A</th><th>PTS</th>
      <th>+/-</th><th>SOG</th><th>HIT</th><th>BS</th><th>PIM</th><th>TOI</th>
    </tr></thead><tbody>${skaters.map(p => `<tr>
      <td>${p.position||'–'}</td><td>${p.name}</td>
      <td>${p.goals}</td><td>${p.assists}</td><td><strong>${p.points}</strong></td>
      <td>${p.plusMinus >= 0 ? '+' : ''}${p.plusMinus}</td>
      <td>${p.shots}</td><td>${p.hits}</td><td>${p.blockedShots}</td>
      <td>${p.pim}</td><td>${formatToi(p.toi)}</td>
    </tr>`).join('')}</tbody></table>`;
  }
  if (goalies.length > 0) {
    html += `<table style="margin-top:0.4rem;"><thead><tr>
      <th>Player</th><th>G</th><th>A</th><th>SA</th><th>GA</th><th>SV%</th>
    </tr></thead><tbody>${goalies.map(p => `<tr>
      <td>${p.name}</td><td>${p.goals||0}</td><td>${p.assists||0}</td>
      <td>${p.shotsAgainst}</td><td>${p.goalsAgainst}</td>
      <td>${p.savesPct !== null && p.savesPct !== undefined ? pct3(p.savesPct) : (p.shotsAgainst > 0 ? pct3(p.saves / p.shotsAgainst) : '–')}</td>
    </tr>`).join('')}</tbody></table>`;
  }
  return html;
}

// ── Schedule table ─────────────────────────────────────────────────────────

async function loadSchedule() {
  const sid = SeasonSelector.getSelectedSeasonId();

  const root = document.getElementById('schedule-root');
  if (!root) return;

  if (!sid) {
    root.innerHTML = '<p style="color:#8b949e">Select a league and season above to view the schedule.</p>';
    allGames = [];
    return;
  }

  try {
    const res = await fetch(`${API}/games?season_id=${sid}`);
    allGames = res.ok ? await res.json() : [];
  } catch { allGames = []; }

  renderScheduleSection('schedule-root', allGames);

  // Check for ?g= URL param to auto-open a game
  const params = new URLSearchParams(window.location.search);
  const gParam = params.get('g');
  if (gParam) {
    const gId = parseInt(gParam, 10);
    if (allGames.find(g => g.id === gId)) await openGameDetail(gId);
  }
}

// Format "YYYY-MM-DD" → "Monday, March 1"
function formatDateHeader(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

// Round label (mirrors the playoffs.js roundName helper)
function playoffRoundLabel(roundNum, totalRounds) {
  if (roundNum === totalRounds) return '🏆 Final';
  if (roundNum === totalRounds - 1) return 'Semifinals';
  if (roundNum === totalRounds - 2) return 'Quarterfinals';
  return `Round ${roundNum}`;
}

function buildGameRow(g) {
  return `
    <tr class="game-row" id="game-row-${g.id}" data-game-id="${g.id}"
      onclick="toggleGameDetail(${g.id}, event)">
      <td>${g.date}</td>
      <td>${g.home_logo ? `<img src="${g.home_logo}" style="width:22px;height:22px;object-fit:contain;vertical-align:middle;margin-right:0.3rem;border-radius:3px;" />` : ''}${g.home_team_name}</td>
      <td>${g.status === 'complete' ? `${g.home_score} – ${g.away_score}` : '–'}</td>
      <td>${g.away_logo ? `<img src="${g.away_logo}" style="width:22px;height:22px;object-fit:contain;vertical-align:middle;margin-right:0.3rem;border-radius:3px;" />` : ''}${g.away_team_name}</td>
      <td id="status-cell-${g.id}">${statusBadge(g.status, g.is_forfeit)}</td>
      ${isAdmin ? `
      <td id="ea-status-${g.id}">
        ${g.ea_match_id
          ? `<span class="ea-badge ea-badge-linked">🔗 Linked</span>`
          : `<span class="ea-badge ea-badge-unlinked">Not linked</span>`}
      </td>
      <td>
        <button class="btn-secondary" style="font-size:0.82rem;padding:0.3rem 0.7rem;"
          onclick="togglePicker(${g.id}, event)">
          Pick EA Match
        </button>
      </td>` : ''}
    </tr>`;
}

function buildGameTable(games) {
  if (!games || games.length === 0) return '';
  // Group by date (API already returns in ASC order, but sort locally as a safety guard)
  const byDate = {};
  for (const g of games) {
    if (!byDate[g.date]) byDate[g.date] = [];
    byDate[g.date].push(g);
  }
  const thead = `<thead><tr>
    <th>Date</th><th>Home Team</th><th>Score</th><th>Away Team</th><th>Status</th>
    ${isAdmin ? '<th>EA Match</th><th>Actions</th>' : ''}
  </tr></thead>`;
  let html = '';
  for (const date of Object.keys(byDate).sort()) {
    html += `<div class="schedule-date-header">${formatDateHeader(date)}</div>`;
    html += `<div style="overflow-x:auto;margin-bottom:0.25rem;"><table class="schedule-section-table">${thead}<tbody>`;
    html += byDate[date].map(buildGameRow).join('');
    html += '</tbody></table></div>';
  }
  return html;
}

function renderScheduleSection(containerId, games) {
  const root = document.getElementById(containerId);
  if (!root) return;
  if (!games || games.length === 0) {
    root.innerHTML = '<p style="color:#8b949e;">No games scheduled yet.</p>';
    return;
  }

  // Detect if any games belong to a numbered playoff round
  const hasPlayoffRounds = games.some(g => g.playoff_round_number != null && g.playoff_round_number > 0);

  if (!hasPlayoffRounds) {
    // Regular season: just group by date
    root.innerHTML = buildGameTable(games);
    return;
  }

  // Playoff season: group by round first, then by date within each round
  const byRound = {};
  for (const g of games) {
    const r = g.playoff_round_number ?? 0;
    if (!byRound[r]) byRound[r] = [];
    byRound[r].push(g);
  }
  const roundNumbers = Object.keys(byRound).map(Number).sort((a, b) => a - b);
  const playoffRounds = roundNumbers.filter(r => r > 0);
  const totalRounds = playoffRounds.length > 0 ? Math.max(...playoffRounds) : 1;

  let html = '';
  for (const r of roundNumbers) {
    const label = r === 0 ? 'Other Games' : playoffRoundLabel(r, totalRounds);
    html += `<div class="schedule-round-header">${label}</div>`;
    html += buildGameTable(byRound[r]);
  }
  root.innerHTML = html;
}

// ── Game Detail Panel ──────────────────────────────────────────────────────

async function toggleGameDetail(gameId, event) {
  if (event && event.target.closest('button')) return; // let buttons handle themselves
  if (activeGameId === gameId) {
    closeGameDetail();
    return;
  }
  await openGameDetail(gameId);
}

function closeGameDetail() {
  document.getElementById('game-detail').classList.add('hidden');
  if (activeGameId) {
    const row = document.getElementById(`game-row-${activeGameId}`);
    if (row) row.classList.remove('selected');
  }
  activeGameId = null;
}

async function openGameDetail(gameId) {
  closePicker();
  if (activeGameId) {
    const prev = document.getElementById(`game-row-${activeGameId}`);
    if (prev) prev.classList.remove('selected');
  }
  activeGameId = gameId;

  const row = document.getElementById(`game-row-${gameId}`);
  if (row) row.classList.add('selected');

  const game = allGames.find(g => g.id === gameId);
  const panel = document.getElementById('game-detail');
  const body = document.getElementById('detail-body');
  const title = document.getElementById('detail-title');
  const subtitle = document.getElementById('detail-subtitle');

  title.textContent = game ? `${game.home_team_name} vs ${game.away_team_name}` : 'Game Details';
  subtitle.textContent = game ? game.date : '';
  body.innerHTML = '<p class="picker-loading">Loading game stats…</p>';

  // Move the panel to appear right after the table-wrapper div of the clicked row
  if (row) {
    const tableWrapper = row.closest('div[style*="overflow"]') || row.closest('div');
    if (tableWrapper) tableWrapper.after(panel);
  }

  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Admin buttons
  const pickBtn = document.getElementById('detail-pick-btn');
  const completeBtn = document.getElementById('detail-complete-btn');
  const forfeitBtn = document.getElementById('detail-forfeit-btn');
  if (pickBtn) pickBtn.style.display = isAdmin ? '' : 'none';
  if (completeBtn) completeBtn.style.display = (isAdmin && game && game.status !== 'complete') ? '' : 'none';
  if (forfeitBtn) forfeitBtn.style.display = (isAdmin && game && game.status !== 'complete') ? '' : 'none';
  if (pickBtn) pickBtn.dataset.gameId = gameId;
  if (completeBtn) completeBtn.dataset.gameId = gameId;
  if (forfeitBtn) forfeitBtn.dataset.gameId = gameId;

  try {
    const res = await fetch(`${API}/games/${gameId}/stats`);
    if (!res.ok) { body.innerHTML = '<p class="picker-error">Failed to load game stats.</p>'; return; }
    const data = await res.json();
    renderGameDetail(data);
  } catch (err) {
    body.innerHTML = `<p class="picker-error">Error: ${err.message}</p>`;
  }
}

function renderGameDetail(data) {
  const body = document.getElementById('detail-body');
  const { game, home_players, away_players, has_stats } = data;

  const isComplete = game.status === 'complete';
  const finalLabel = isComplete
    ? `<div style="text-align:center;font-size:0.72rem;font-weight:700;letter-spacing:0.1em;color:#8b949e;text-transform:uppercase;padding-bottom:0.2rem;">${game.is_forfeit ? 'FORFEIT' : game.is_overtime ? 'FINAL · OT' : 'FINAL'}</div>`
    : '';

  const homeWin = isComplete && game.home_score > game.away_score;
  const awayWin = isComplete && game.away_score > game.home_score;

  const logoImg = (team) => team.logo_url
    ? `<img src="${team.logo_url}" style="width:36px;height:36px;object-fit:contain;border-radius:6px;background:#21262d;padding:3px;" alt="${team.name}" />`
    : '';

  // Power play summary from player stats (PP goals / PP opportunities)
  let ppHtml = '';
  if (isComplete && has_stats) {
    const sum = (arr, key) => (arr || []).reduce((t, p) => t + (p[key] || 0), 0);
    const homePPG  = sum(home_players, 'pp_goals');
    const homePPO  = sum(home_players, 'penalties_drawn');
    const awayPPG  = sum(away_players, 'pp_goals');
    const awayPPO  = sum(away_players, 'penalties_drawn');
    ppHtml = `<div style="text-align:center;font-size:0.82rem;color:#8b949e;padding:0.15rem 0 0.5rem;">
      <span style="color:#c9d1d9;font-weight:600;">PP:</span>
      ${game.home_team.name} <strong style="color:#e6edf3;">${homePPG}/${homePPO}</strong>
      &nbsp;·&nbsp;
      ${game.away_team.name} <strong style="color:#e6edf3;">${awayPPG}/${awayPPO}</strong>
    </div>`;
  }

  const editBtn = (isAdmin && isComplete)
    ? `<p style="text-align:center;margin:0.4rem 0 0.2rem;">
         <a href="admin.html#games" aria-label="Edit Stats or Score" style="display:inline-block;padding:0.3rem 0.85rem;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#58a6ff;font-size:0.82rem;text-decoration:none;">
           ✏️ Edit Stats / Score
         </a>
       </p>`
    : '';

  const scoreHtml = `
    ${finalLabel}
    <div class="detail-scoreboard">
      <div style="display:flex;flex-direction:column;align-items:center;gap:0.3rem;">
        ${logoImg(game.home_team)}
        <span class="detail-team-name">${game.home_team.name}</span>
      </div>
      <span class="detail-score-num${homeWin ? ' detail-score-winner' : ''}">${isComplete ? game.home_score : '–'}</span>
      <span class="detail-vs">–</span>
      <span class="detail-score-num${awayWin ? ' detail-score-winner' : ''}">${isComplete ? game.away_score : '–'}</span>
      <div style="display:flex;flex-direction:column;align-items:center;gap:0.3rem;">
        ${logoImg(game.away_team)}
        <span class="detail-team-name">${game.away_team.name}</span>
      </div>
    </div>
    ${ppHtml}
    <p style="text-align:center;color:#8b949e;font-size:0.85rem;padding:0.25rem 0 0.25rem;">${game.date} · ${statusBadge(game.status, game.is_forfeit)}</p>
    ${editBtn}`;

  if (!has_stats) {
    body.innerHTML = scoreHtml + `<div class="picker-empty">
      <p>No player stats saved yet${isAdmin ? ' — assign an EA match above to import stats.' : '.'}</p>
    </div>`;
    return;
  }

  body.innerHTML = scoreHtml + GameStats.renderTeamPanel(game.home_team, home_players || [])
                             + GameStats.renderTeamPanel(game.away_team, away_players || []);
}

// Detail panel button delegation
document.getElementById('game-detail').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const gameId = parseInt(btn.dataset.gameId, 10);
  if (btn.dataset.action === 'open-picker') { openPicker(gameId); }
  else if (btn.dataset.action === 'mark-complete') { markComplete(gameId); }
  else if (btn.dataset.action === 'mark-forfeit') { markForfeit(gameId); }
});

async function markComplete(gameId) {
  if (!confirm('Mark this game as complete? It will count in standings and stats.')) return;
  const isOT = confirm('Was this game decided in overtime?');
  try {
    const res = await fetch(`${API}/games/${gameId}`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ status: 'complete', is_overtime: isOT ? 1 : 0 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await refreshGame(gameId);
    await openGameDetail(gameId);
  } catch (err) {
    alert(`Failed to mark game complete: ${err.message}`);
  }
}

async function markForfeit(gameId) {
  const game = allGames.find(g => g.id === gameId);
  if (!game) return;
  const homeWins = confirm(
    `Forfeit: does ${game.home_team_name} win?\n\nOK = ${game.home_team_name} wins\nCancel = ${game.away_team_name} wins`
  );
  if (!confirm(`Confirm: mark this game as a forfeit win for ${homeWins ? game.home_team_name : game.away_team_name}?`)) return;
  const home_score = homeWins ? 1 : 0;
  const away_score = homeWins ? 0 : 1;
  try {
    const res = await fetch(`${API}/games/${gameId}`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ status: 'complete', is_overtime: 0, is_forfeit: 1, home_score, away_score }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await refreshGame(gameId);
    await openGameDetail(gameId);
  } catch (err) {
    alert(`Failed to record forfeit: ${err.message}`);
  }
}

// ── EA Match Picker ────────────────────────────────────────────────────────

async function togglePicker(gameId, event) {
  event.stopPropagation();
  if (activePickerGameId === gameId) { closePicker(); return; }
  await openPicker(gameId);
}

function closePicker() {
  document.getElementById('ea-picker').classList.add('hidden');
  activePickerGameId = null;
  currentPickerMatches = [];
}

async function openPicker(gameId) {
  activePickerGameId = gameId;
  const game = allGames.find(g => g.id === gameId);
  const picker = document.getElementById('ea-picker');
  const body = document.getElementById('picker-body');
  const title = document.getElementById('picker-title');
  const subtitle = document.getElementById('picker-subtitle');

  title.textContent = game ? `${game.home_team_name} vs ${game.away_team_name}` : 'EA Matches';
  subtitle.textContent = game ? `Scheduled: ${game.date} · Pick the EA match that corresponds to this game` : '';
  body.innerHTML = '<p class="picker-loading">Loading EA matches…</p>';

  // Place picker after the detail panel (if open) or right after the row's table wrapper
  const detail = document.getElementById('game-detail');
  if (!detail.classList.contains('hidden')) {
    detail.after(picker);
  } else {
    const row = document.getElementById(`game-row-${gameId}`);
    if (row) {
      const tableWrapper = row.closest('div[style*="overflow"]') || row.closest('div');
      if (tableWrapper) tableWrapper.after(picker);
    }
  }

  picker.classList.remove('hidden');
  picker.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    const res = await fetch(`${API}/games/${gameId}/ea-matches`, {
      headers: { 'X-Admin-Token': getAdminToken() },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      body.innerHTML = `<p class="picker-error">⚠️ ${err.error || 'Failed to load EA matches.'}</p>
        ${err.error && err.error.includes('EA club ID') ? `<p class="picker-empty">Set the home team's EA Club ID in the <a href="admin.html">Admin Panel</a>.</p>` : ''}`;
      return;
    }
    const data = await res.json();
    renderPickerMatches(data, gameId);
  } catch (err) {
    body.innerHTML = `<p class="picker-error">Failed to reach the server: ${err.message}</p>`;
  }
}

function renderPickerMatches(data, gameId) {
  const body = document.getElementById('picker-body');
  const { game, matches } = data;
  const currentEaMatchId = game.ea_match_id;
  currentPickerMatches = matches;

  if (matches.length === 0) {
    body.innerHTML = `<p class="picker-empty">No recent EA private matches found for <strong>${game.home_team.name}</strong>. Make sure the EA Club ID is correct.</p>`;
    return;
  }

  const hint = game.away_team.ea_club_id
    ? `<p style="color:#8b949e;font-size:0.82rem;padding:0.5rem 1rem 0;">⭐ Highlighted = against ${game.away_team.name} (scheduled opponent).</p>`
    : `<p style="color:#8b949e;font-size:0.82rem;padding:0.5rem 1rem 0;">Tip: set ${game.away_team.name}'s EA Club ID to auto-highlight.</p>`;

  const items = matches.map((m, idx) => {
    const isAssigned = currentEaMatchId && String(currentEaMatchId) === String(m.matchId);
    const cls = ['ea-match-item', m.isScheduledOpponent ? 'highlight' : '', isAssigned ? 'assigned' : ''].filter(Boolean).join(' ');
    const statsId = `stats-${gameId}-${idx}`;
    const awayStatsId = `away-stats-${gameId}-${idx}`;
    return `
      <div class="${cls}">
        <div class="ea-match-info">
          <div class="ea-match-score">
            ${resultBadge(m.result)}
            <span style="margin-left:0.4rem;">${m.homeScore} – ${m.awayScore}</span>
          </div>
          <div class="ea-match-opponent">vs ${m.opponentClubName}
            ${m.isScheduledOpponent ? '<span class="scheduled-tag">⭐ scheduled opponent</span>' : ''}
          </div>
          <div class="ea-match-meta">${m.date || 'Unknown date'}
            ${isAssigned ? ' · <strong style="color:#58a6ff;">Currently assigned</strong>' : ''}
          </div>
          ${m.players && m.players.length > 0 ? `
            <button class="ea-match-stats-toggle" data-action="toggle-stats" data-stats-id="${statsId}">
              View home stats (${m.players.length})
            </button>
            <div id="${statsId}" class="ea-player-stats hidden">${renderPickerPlayerStats(m.players)}</div>` : ''}
          ${m.awayPlayers && m.awayPlayers.length > 0 ? `
            <button class="ea-match-stats-toggle" data-action="toggle-stats" data-stats-id="${awayStatsId}" style="margin-left:0.5rem;">
              View away stats (${m.awayPlayers.length})
            </button>
            <div id="${awayStatsId}" class="ea-player-stats hidden">${renderPickerPlayerStats(m.awayPlayers)}</div>` : ''}
        </div>
        <div class="ea-match-actions">
          ${isAssigned
            ? `<button class="btn-clear" data-action="clear" data-game-id="${gameId}">Clear</button>`
            : `<button class="btn-assign" data-action="assign" data-match-idx="${idx}" data-game-id="${gameId}">Assign</button>`}
        </div>
      </div>`;
  }).join('');

  body.innerHTML = hint + `<div class="ea-match-list">${items}</div>`;
}

function toggleStats(statsId, btn) {
  const el = document.getElementById(statsId);
  if (!el) return;
  el.classList.toggle('hidden');
  if (btn) {
    const count = btn.textContent.match(/\d+/)?.[0] || '';
    const isHome = btn.textContent.includes('home');
    const which = isHome ? 'home' : 'away';
    btn.textContent = el.classList.contains('hidden')
      ? `View ${which} stats (${count})`
      : `Hide ${which} stats (${count})`;
  }
}

document.getElementById('ea-picker').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'assign') {
    const idx = parseInt(btn.dataset.matchIdx, 10);
    const gameId = parseInt(btn.dataset.gameId, 10);
    const m = currentPickerMatches[idx];
    if (m) assignMatch(gameId, m.matchId, m.homeScore, m.awayScore, m.players, m.awayPlayers);
  } else if (action === 'clear') {
    clearAssignment(parseInt(btn.dataset.gameId, 10));
  } else if (action === 'toggle-stats') {
    toggleStats(btn.dataset.statsId, btn);
  }
});

// ── Assign / Clear ─────────────────────────────────────────────────────────

async function assignMatch(gameId, matchId, homeScore, awayScore, homePlayers, awayPlayers) {
  try {
    const res = await fetch(`${API}/games/${gameId}`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({
        ea_match_id: matchId,
        home_score: homeScore,
        away_score: awayScore,
        player_stats: { home_players: homePlayers, away_players: awayPlayers },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await refreshGame(gameId);
    closePicker(); // close picker so detail is the focus
    await openGameDetail(gameId);
  } catch (err) {
    alert(`Failed to assign EA match: ${err.message}`);
  }
}

async function clearAssignment(gameId) {
  try {
    const res = await fetch(`${API}/games/${gameId}`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ ea_match_id: null }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await refreshGame(gameId);
    await openPicker(gameId);
    if (activeGameId === gameId) await openGameDetail(gameId);
  } catch (err) {
    alert(`Failed to clear assignment: ${err.message}`);
  }
}

async function refreshGame(gameId) {
  try {
    const sid = SeasonSelector.getSelectedSeasonId();
    if (!sid) return;
    const res = await fetch(`${API}/games?season_id=${sid}`);
    if (!res.ok) return;
    allGames = await res.json();
    const g = allGames.find(x => x.id === gameId);
    if (!g) return;
    const row = document.getElementById(`game-row-${gameId}`);
    if (row) {
      row.cells[2].textContent = g.status === 'complete' ? `${g.home_score} – ${g.away_score}` : '–';
      document.getElementById(`status-cell-${gameId}`).innerHTML = statusBadge(g.status, g.is_forfeit);
      const eaCell = document.getElementById(`ea-status-${gameId}`);
      if (eaCell) eaCell.innerHTML = g.ea_match_id
        ? `<span class="ea-badge ea-badge-linked">🔗 Linked</span>`
        : `<span class="ea-badge ea-badge-unlinked">Not linked</span>`;
    }
  } catch { /* ignore */ }
}

// ── Init ───────────────────────────────────────────────────────────────────

(async () => {
  await checkAdmin();
  await SeasonSelector.init('season-selector-container');
  SeasonSelector.onSeasonChange(() => {
    closePicker();
    closeGameDetail();
    loadSchedule();
  });
  await loadSchedule();
})();
