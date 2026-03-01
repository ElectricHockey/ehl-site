const API = '/api';

let activeGameId = null;
let allGames = [];
let currentPickerMatches = []; // used by event delegation instead of inline onclick

// ── Badge helpers ──────────────────────────────────────────────────────────

function resultBadge(r) {
  if (r === 'W') return '<span class="badge badge-win">W</span>';
  if (r === 'L') return '<span class="badge badge-loss">L</span>';
  return `<span class="badge badge-tie">${r}</span>`;
}

function formatToi(seconds) {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Player stats table ─────────────────────────────────────────────────────

function renderPlayerStats(players) {
  if (!players || players.length === 0) return '<p style="color:#8b949e;font-size:0.8rem;">No player data.</p>';

  const posOrder = { G: 0, C: 1, LW: 2, RW: 3, LD: 4, RD: 5 };
  const sorted = [...players].sort((a, b) => (posOrder[a.position] ?? 9) - (posOrder[b.position] ?? 9));
  const skaters = sorted.filter(p => p.position !== 'G');
  const goalies = sorted.filter(p => p.position === 'G');

  let html = '';
  if (skaters.length > 0) {
    html += `<table>
      <thead><tr>
        <th>Pos</th><th>Player</th><th>G</th><th>A</th><th>PTS</th>
        <th>+/-</th><th>SOG</th><th>HIT</th><th>BS</th><th>PIM</th><th>TOI</th>
      </tr></thead>
      <tbody>${skaters.map(p => `<tr>
        <td>${p.position || '–'}</td>
        <td>${p.name}</td>
        <td>${p.goals}</td><td>${p.assists}</td>
        <td><strong>${p.points}</strong></td>
        <td>${p.plusMinus >= 0 ? '+' : ''}${p.plusMinus}</td>
        <td>${p.shots}</td><td>${p.hits}</td>
        <td>${p.blockedShots}</td><td>${p.pim}</td>
        <td>${formatToi(p.toi)}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }
  if (goalies.length > 0) {
    html += `<table style="margin-top:0.4rem;">
      <thead><tr><th>Pos</th><th>Player</th><th>SV</th><th>GA</th><th>SV%</th></tr></thead>
      <tbody>${goalies.map(p => `<tr>
        <td>G</td><td>${p.name}</td>
        <td>${p.saves}</td><td>${p.goalsAgainst}</td>
        <td>${p.savesPct !== null ? (p.savesPct * 100).toFixed(1) + '%' : '–'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }
  return html;
}

// ── Schedule table ─────────────────────────────────────────────────────────

async function loadSchedule() {
  const root = document.getElementById('schedule-root');
  try {
    const res = await fetch(`${API}/games`);
    if (!res.ok) throw new Error('Server error');
    allGames = await res.json();

    if (allGames.length === 0) {
      root.innerHTML = '<p style="color:#8b949e">No games scheduled yet. Add games in the <a href="admin.html">Admin Panel</a>.</p>';
      return;
    }

    // Sort ascending by date (schedule order)
    const sorted = [...allGames].sort((a, b) => a.date.localeCompare(b.date));

    root.innerHTML = `
      <table id="schedule-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Home Team</th>
            <th>Score</th>
            <th>Away Team</th>
            <th>EA Match</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(g => `
            <tr class="game-row" id="game-row-${g.id}" data-game-id="${g.id}">
              <td>${g.date}</td>
              <td>${g.home_team_name}</td>
              <td>${g.home_score} – ${g.away_score}</td>
              <td>${g.away_team_name}</td>
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
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    root.innerHTML = `<p class="error">Failed to load schedule: ${err.message}. Is the server running?</p>`;
  }
}

// ── EA Match Picker ────────────────────────────────────────────────────────

async function togglePicker(gameId, event) {
  event.stopPropagation();
  if (activeGameId === gameId) {
    closePicker();
    return;
  }
  await openPicker(gameId);
}

function closePicker() {
  document.getElementById('ea-picker').classList.add('hidden');
  if (activeGameId) {
    const row = document.getElementById(`game-row-${activeGameId}`);
    if (row) row.classList.remove('selected');
  }
  activeGameId = null;
  currentPickerMatches = [];
}

async function openPicker(gameId) {
  if (activeGameId) {
    const prev = document.getElementById(`game-row-${activeGameId}`);
    if (prev) prev.classList.remove('selected');
  }
  activeGameId = gameId;

  const row = document.getElementById(`game-row-${gameId}`);
  if (row) row.classList.add('selected');

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
    const res = await fetch(`${API}/games/${gameId}/ea-matches`);
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

  // Store matches for event delegation (avoids embedding matchId in inline handlers)
  currentPickerMatches = matches;

  if (matches.length === 0) {
    body.innerHTML = `<p class="picker-empty">No recent EA private matches found for <strong>${game.home_team.name}</strong>.
      Make sure the team's EA Club ID is correct in the <a href="admin.html">Admin Panel</a>.</p>`;
    return;
  }

  const hint = game.away_team.ea_club_id
    ? `<p style="color:#8b949e;font-size:0.82rem;padding:0.5rem 1rem 0;">
        ⭐ Highlighted matches are against ${game.away_team.name} (the scheduled opponent).
      </p>`
    : `<p style="color:#8b949e;font-size:0.82rem;padding:0.5rem 1rem 0;">
        Tip: set ${game.away_team.name}'s EA Club ID to auto-highlight the right match.
      </p>`;

  const items = matches.map((m, idx) => {
    const isAssigned = currentEaMatchId && String(currentEaMatchId) === String(m.matchId);
    const classes = [
      'ea-match-item',
      m.isScheduledOpponent ? 'highlight' : '',
      isAssigned ? 'assigned' : '',
    ].filter(Boolean).join(' ');

    const statsId = `stats-${gameId}-${idx}`;
    return `
      <div class="${classes}">
        <div class="ea-match-info">
          <div class="ea-match-score">
            ${resultBadge(m.result)}
            <span style="margin-left:0.4rem;">${m.homeScore} – ${m.awayScore}</span>
          </div>
          <div class="ea-match-opponent">
            vs ${m.opponentClubName}
            ${m.isScheduledOpponent ? '<span class="scheduled-tag">⭐ scheduled opponent</span>' : ''}
          </div>
          <div class="ea-match-meta">
            ${m.date || 'Unknown date'}
            ${isAssigned ? ' · <strong style="color:#58a6ff;">Currently assigned</strong>' : ''}
          </div>
          ${m.players && m.players.length > 0 ? `
            <button class="ea-match-stats-toggle"
              data-action="toggle-stats" data-stats-id="${statsId}">
              View player stats (${m.players.length})
            </button>
            <div id="${statsId}" class="ea-player-stats hidden">
              ${renderPlayerStats(m.players)}
            </div>` : ''}
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
    btn.textContent = el.classList.contains('hidden')
      ? `View player stats (${count})`
      : `Hide player stats (${count})`;
  }
}

// ── Event delegation for picker buttons ───────────────────────────────────

document.getElementById('ea-picker').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'assign') {
    const idx = parseInt(btn.dataset.matchIdx, 10);
    const gameId = parseInt(btn.dataset.gameId, 10);
    const m = currentPickerMatches[idx];
    if (m) assignMatch(gameId, m.matchId, m.homeScore, m.awayScore);
  } else if (action === 'clear') {
    const gameId = parseInt(btn.dataset.gameId, 10);
    clearAssignment(gameId);
  } else if (action === 'toggle-stats') {
    toggleStats(btn.dataset.statsId, btn);
  }
});

// ── Assign / Clear ─────────────────────────────────────────────────────────

async function assignMatch(gameId, matchId, homeScore, awayScore) {
  try {
    const res = await fetch(`${API}/games/${gameId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ea_match_id: matchId, home_score: homeScore, away_score: awayScore }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await refreshGame(gameId);
    await openPicker(gameId);
  } catch (err) {
    alert(`Failed to assign EA match: ${err.message}`);
  }
}

async function clearAssignment(gameId) {
  try {
    const res = await fetch(`${API}/games/${gameId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ea_match_id: null }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await refreshGame(gameId);
    await openPicker(gameId);
  } catch (err) {
    alert(`Failed to clear assignment: ${err.message}`);
  }
}

async function refreshGame(gameId) {
  try {
    const res = await fetch(`${API}/games`);
    if (!res.ok) return;
    const games = await res.json();
    allGames = games;
    const g = games.find(x => x.id === gameId);
    if (!g) return;
    const row = document.getElementById(`game-row-${gameId}`);
    if (row) {
      row.cells[2].textContent = `${g.home_score} – ${g.away_score}`;
      document.getElementById(`ea-status-${gameId}`).innerHTML = g.ea_match_id
        ? `<span class="ea-badge ea-badge-linked">🔗 Linked</span>`
        : `<span class="ea-badge ea-badge-unlinked">Not linked</span>`;
    }
  } catch { /* ignore refresh errors */ }
}

// ── Init ───────────────────────────────────────────────────────────────────

loadSchedule();
