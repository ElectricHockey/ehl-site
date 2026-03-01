const API = '/api';

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
    isAdmin = data.isAdmin;
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

function statusBadge(s) {
  if (s === 'complete') return '<span class="status-badge status-complete">✓ Final</span>';
  return '<span class="status-badge status-scheduled">Scheduled</span>';
}

function formatToi(seconds) {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Full player stats table (skaters + goalies) ────────────────────────────

function renderFullStats(players, teamName) {
  if (!players || players.length === 0) {
    return `<p style="color:#8b949e;font-size:0.85rem;padding:0.3rem 0;">No player data for ${teamName}.</p>`;
  }
  const posOrder = { G: 0, C: 1, LW: 2, RW: 3, LD: 4, RD: 5 };
  const sorted = [...players].sort((a, b) => (posOrder[a.position] ?? 9) - (posOrder[b.position] ?? 9));
  const skaters = sorted.filter(p => p.position !== 'G');
  const goalies  = sorted.filter(p => p.position === 'G');

  const v = (p, snake, camel) => p[snake] !== undefined ? p[snake] : (p[camel] !== undefined ? p[camel] : 0);
  const pm = p => { const val = v(p,'plus_minus','plusMinus'); return `${val >= 0 ? '+' : ''}${val}`; };
  const toi = p => formatToi(v(p,'toi','toi'));
  const fmt1 = n => n !== null && n !== undefined ? Number(n).toFixed(1) : '–';
  const svpct = p => {
    const sp = p.save_pct !== undefined ? p.save_pct : p.savesPct;
    return sp !== null && sp !== undefined ? (sp < 1 ? (sp * 100).toFixed(1) + '%' : sp.toFixed(1) + '%') : '–';
  };
  const foWpct = p => {
    const fw = v(p,'faceoff_wins','faceoffWins'), fl = v(p,'faceoff_losses','faceoffLosses');
    return fw + fl > 0 ? fmt1(fw * 100.0 / (fw + fl)) + '%' : '–';
  };
  const sPct = p => {
    const g = v(p,'goals','goals'), sh = v(p,'shots','shots');
    return sh > 0 ? fmt1(g * 100.0 / sh) + '%' : '–';
  };
  const pcPct = p => {
    const pa = v(p,'pass_attempts','passAttempts'), pc = v(p,'pass_completions','passCompletions');
    const stored = p.pass_pct !== undefined ? p.pass_pct : p.passPct;
    if (stored !== null && stored !== undefined) return fmt1(stored * 100) + '%';
    return pa > 0 ? fmt1(pc * 100.0 / pa) + '%' : '–';
  };

  let html = '';
  if (skaters.length > 0) {
    html += `<div style="overflow-x:auto;"><table class="stats-table">
      <thead><tr>
        <th>Pos</th><th>Player</th>
        <th>G</th><th>A</th><th>PTS</th><th>+/-</th>
        <th>SOG</th><th>HITS</th><th>BS</th><th>TKA</th><th>GVA</th>
        <th>PPG</th><th>SHG</th><th>GWG</th><th>PIM</th><th>PD</th>
        <th>FOW</th><th>FOT</th><th>FOW%</th><th>S%</th>
        <th>DLF</th><th>INT</th><th>PA</th><th>PC%</th><th>HT</th>
        <th>PT</th><th>TOI</th><th>OR</th><th>DR</th><th>TPR</th>
      </tr></thead>
      <tbody>${skaters.map(p => `<tr>
        <td>${p.position||'–'}</td>
        <td>${p.player_name || p.name}</td>
        <td>${v(p,'goals','goals')}</td><td>${v(p,'assists','assists')}</td>
        <td><strong>${v(p,'goals','goals') + v(p,'assists','assists')}</strong></td>
        <td>${pm(p)}</td>
        <td>${v(p,'shots','shots')}</td>
        <td>${v(p,'hits','hits')}</td>
        <td>${v(p,'blocked_shots','blockedShots')}</td>
        <td>${v(p,'takeaways','takeaways')}</td>
        <td>${v(p,'giveaways','giveaways')}</td>
        <td>${v(p,'pp_goals','ppGoals')}</td>
        <td>${v(p,'sh_goals','shGoals')}</td>
        <td>${v(p,'gwg','gwg')}</td>
        <td>${v(p,'pim','pim')}</td>
        <td>${v(p,'penalties_drawn','penaltiesDrawn')}</td>
        <td>${v(p,'faceoff_wins','faceoffWins')}</td>
        <td>${v(p,'faceoff_wins','faceoffWins') + v(p,'faceoff_losses','faceoffLosses')}</td>
        <td>${foWpct(p)}</td><td>${sPct(p)}</td>
        <td>${v(p,'deflections','deflections')}</td>
        <td>${v(p,'interceptions','interceptions')}</td>
        <td>${v(p,'pass_attempts','passAttempts')}</td>
        <td>${pcPct(p)}</td>
        <td>${v(p,'hat_tricks','hatTricks')}</td>
        <td>${formatToi(v(p,'possession_secs','possessionSecs'))}</td>
        <td>${toi(p)}</td>
        <td>${v(p,'overall_rating','overallRating')||'–'}</td>
        <td>${v(p,'defensive_rating','defensiveRating')||'–'}</td>
        <td>${v(p,'team_play_rating','teamPlayRating')||'–'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }
  if (goalies.length > 0) {
    html += `<div style="overflow-x:auto;"><table class="stats-table" style="margin-top:0.4rem;">
      <thead><tr>
        <th>Player</th><th>G</th><th>A</th>
        <th>SA</th><th>GA</th><th>SV%</th><th>TOI</th>
        <th>SO</th><th>PSA</th><th>PSGA</th><th>BKSA</th><th>BKSV</th>
        <th>W</th><th>L</th><th>OTW</th><th>OTL</th>
      </tr></thead>
      <tbody>${goalies.map(p => `<tr>
        <td>${p.player_name || p.name}</td>
        <td>${v(p,'goals','goals')}</td><td>${v(p,'assists','assists')}</td>
        <td>${v(p,'shots_against','shotsAgainst')}</td>
        <td>${v(p,'goals_against','goalsAgainst')}</td>
        <td>${svpct(p)}</td><td>${toi(p)}</td>
        <td>${v(p,'shutouts','shutouts')}</td>
        <td>${v(p,'penalty_shot_attempts','penaltyShotAttempts')}</td>
        <td>${v(p,'penalty_shot_ga','penaltyShotGa')}</td>
        <td>${v(p,'breakaway_shots','breakawayShots')}</td>
        <td>${v(p,'breakaway_saves','breakawaySaves')}</td>
        <td>${v(p,'goalie_wins','goalieWins')}</td>
        <td>${v(p,'goalie_losses','goalieLosses')}</td>
        <td>${v(p,'goalie_otw','goalieOtw')}</td>
        <td>${v(p,'goalie_otl','goalieOtl')}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }
  return html;
}

// Compact version for inside the EA picker
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
      <td>${p.savesPct !== null && p.savesPct !== undefined ? (p.savesPct < 1 ? (p.savesPct * 100).toFixed(1) : p.savesPct.toFixed(1)) + '%' : '–'}</td>
    </tr>`).join('')}</tbody></table>`;
  }
  return html;
}

// ── Schedule table ─────────────────────────────────────────────────────────

async function loadSchedule() {
  const root = document.getElementById('schedule-root');
  try {
    const sid = SeasonSelector.getSelectedSeasonId();
    const url = sid ? `${API}/games?season_id=${sid}` : `${API}/games`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Server error');
    allGames = await res.json();

    if (allGames.length === 0) {
      root.innerHTML = '<p style="color:#8b949e">No games scheduled yet. Add games in the <a href="admin.html">Admin Panel</a>.</p>';
      return;
    }

    const sorted = [...allGames].sort((a, b) => a.date.localeCompare(b.date));

    // Build columns: always show Date, Teams, Score, Status; admin also sees EA and actions
    root.innerHTML = `
      <table id="schedule-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Home Team</th>
            <th>Score</th>
            <th>Away Team</th>
            <th>Status</th>
            ${isAdmin ? '<th>EA Match</th><th>Actions</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${sorted.map(g => `
            <tr class="game-row" id="game-row-${g.id}" data-game-id="${g.id}"
              onclick="toggleGameDetail(${g.id}, event)">
              <td>${g.date}</td>
              <td>${g.home_logo ? `<img src="${g.home_logo}" style="width:22px;height:22px;object-fit:contain;vertical-align:middle;margin-right:0.3rem;border-radius:3px;" />` : ''}${g.home_team_name}</td>
              <td>${g.status === 'complete' ? `${g.home_score} – ${g.away_score}` : '–'}</td>
              <td>${g.away_logo ? `<img src="${g.away_logo}" style="width:22px;height:22px;object-fit:contain;vertical-align:middle;margin-right:0.3rem;border-radius:3px;" />` : ''}${g.away_team_name}</td>
              <td id="status-cell-${g.id}">${statusBadge(g.status)}</td>
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
            </tr>`).join('')}
        </tbody>
      </table>`;

    // Check for ?g= URL param to auto-open a game
    const params = new URLSearchParams(window.location.search);
    const gParam = params.get('g');
    if (gParam) {
      const gId = parseInt(gParam, 10);
      if (allGames.find(g => g.id === gId)) {
        await openGameDetail(gId);
      }
    }
  } catch (err) {
    root.innerHTML = `<p class="error">Failed to load schedule: ${err.message}. Is the server running?</p>`;
  }
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
  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Admin buttons
  const pickBtn = document.getElementById('detail-pick-btn');
  const completeBtn = document.getElementById('detail-complete-btn');
  if (pickBtn) pickBtn.style.display = isAdmin ? '' : 'none';
  if (completeBtn) completeBtn.style.display = (isAdmin && game && game.status !== 'complete') ? '' : 'none';
  if (pickBtn) pickBtn.dataset.gameId = gameId;
  if (completeBtn) completeBtn.dataset.gameId = gameId;

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

  const scoreHtml = `
    <div class="detail-scoreboard">
      <span class="detail-team-name">${game.home_team.name}</span>
      <span class="detail-score-num">${game.status === 'complete' ? game.home_score : '–'}</span>
      <span class="detail-vs">vs</span>
      <span class="detail-score-num">${game.status === 'complete' ? game.away_score : '–'}</span>
      <span class="detail-team-name">${game.away_team.name}</span>
    </div>
    <p style="text-align:center;color:#8b949e;font-size:0.85rem;padding:0.25rem 0 0.5rem;">${game.date} · ${statusBadge(game.status)}</p>`;

  if (!has_stats) {
    body.innerHTML = scoreHtml + `<div class="picker-empty">
      <p>No player stats saved yet${isAdmin ? ' — assign an EA match above to import stats.' : '.'}</p>
    </div>`;
    return;
  }

  body.innerHTML = scoreHtml + `
    <div class="team-stats-block">
      <h3>${game.home_team.name}</h3>
      ${renderFullStats(home_players, game.home_team.name)}
    </div>
    <div class="team-stats-block">
      <h3>${game.away_team.name}</h3>
      ${renderFullStats(away_players, game.away_team.name)}
    </div>`;
}

// Detail panel button delegation
document.getElementById('game-detail').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const gameId = parseInt(btn.dataset.gameId, 10);
  if (btn.dataset.action === 'open-picker') { openPicker(gameId); }
  else if (btn.dataset.action === 'mark-complete') { markComplete(gameId); }
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
    await openPicker(gameId);
    // Refresh detail panel if it's showing this game
    if (activeGameId === gameId) await openGameDetail(gameId);
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
    const url = sid ? `${API}/games?season_id=${sid}` : `${API}/games`;
    const res = await fetch(url);
    if (!res.ok) return;
    const games = await res.json();
    allGames = games;
    const g = games.find(x => x.id === gameId);
    if (!g) return;
    const row = document.getElementById(`game-row-${gameId}`);
    if (row) {
      row.cells[2].textContent = g.status === 'complete' ? `${g.home_score} – ${g.away_score}` : '–';
      document.getElementById(`status-cell-${gameId}`).innerHTML = statusBadge(g.status);
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
