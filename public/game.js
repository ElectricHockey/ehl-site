const API = '/api';

// game-stats.js (loaded before this file) provides GameStats.renderTeamPanel and GameStats.normalizePlayer

// ── Admin helpers ───────────────────────────────────────────────────────────

function getAdminToken() { return localStorage.getItem('ehl_admin_token') || ''; }

function hexToRgbStr(hex) {
  if (!hex || typeof hex !== 'string') return null;
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  return `${r},${g},${b}`;
}

/** Returns true when the browser has an active admin session (owner or game_admin). */
async function hasAdminSession() {
  try {
    const res = await fetch(`${API}/auth/status`, { headers: { 'X-Admin-Token': getAdminToken() } });
    const data = await res.json();
    // loggedIn is only true for admin sessions; role is 'owner' or 'game_admin'
    return data.loggedIn && !!data.role;
  } catch { return false; }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function loadGame() {
  const root = document.getElementById('game-root');
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) {
    root.innerHTML = '<p class="error">No game ID. <a href="javascript:history.back()">Back</a></p>';
    return;
  }

  try {
    const [statsRes, adminFlag] = await Promise.all([
      fetch(`${API}/games/${id}/stats?_t=${Date.now()}`, { cache: 'no-store' }),
      hasAdminSession(),
    ]);
    if (!statsRes.ok) {
      const err = await statsRes.json().catch(() => ({}));
      root.innerHTML = `<p class="error">${err.error || 'Game not found.'} <a href="recent-scores.html">Back</a></p>`;
      return;
    }
    const { game, home_players, away_players, has_stats } = await statsRes.json();

    document.title = `${game.home_team.name} vs ${game.away_team.name} – EHL`;

    const date = game.date
      ? new Date(game.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : '';
    const homeWin = gameWinnerSide(game) === 'home';
    const awayWin = gameWinnerSide(game) === 'away';
    const finalLabel = `<div style="text-align:center;font-size:0.78rem;font-weight:700;letter-spacing:0.1em;color:#8b949e;text-transform:uppercase;margin-top:0.3rem;">${game.is_forfeit || game.status === 'forfeit' ? 'FORFEIT' : 'FINAL'}${game.is_overtime ? ' – OT' : ''}</div>`;
    const homeRgb = hexToRgbStr(game.home_team && game.home_team.color1) || '88,100,116';
    const awayRgb = hexToRgbStr(game.away_team && game.away_team.color1) || '88,100,116';
    const gameHeaderStyle = `background-image:linear-gradient(90deg, rgba(${homeRgb},0.30) 0%, rgba(${homeRgb},0.30) 42%, rgba(${homeRgb},0.24) 48%, rgba(${awayRgb},0.24) 52%, rgba(${awayRgb},0.30) 58%, rgba(${awayRgb},0.30) 100%);`;

    const logoImg = (team) => team.logo_url
      ? `<img src="${team.logo_url}" class="game-team-logo" alt="${team.name}" />`
      : `<div class="game-team-logo" style="border-radius:8px;border:1px solid #30363d;"></div>`;

    const adminBtn = adminFlag
      ? `<div class="game-import-panel">
           <label for="mso-game-url">Import game from MyStatsOnline</label>
           <div class="game-import-controls">
             <input id="mso-game-url" type="url" placeholder="Paste a MyStatsOnline game link" />
             <button type="button" onclick="importMsoGame('${id}')">Preview import</button>
           </div>
           <label for="mso-schedule-url">Season schedule URL (required for forfeits)</label>
           <input id="mso-schedule-url" type="url" placeholder="Paste the MyStatsOnline season schedule link" />
           <p id="mso-game-message" role="status"></p>
         </div><p style="text-align:center;margin-bottom:0.75rem;">
           <button onclick="editGameStats('${id}')" style="display:inline-block;padding:0.35rem 0.9rem;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#58a6ff;font-size:0.82rem;cursor:pointer;">
             ✏️ Edit Stats / Score
           </button>
         </p>`
      : '';

    let html = `${adminBtn}
      <div class="game-header" style="${gameHeaderStyle}">
        <div class="game-team-block">
          ${logoImg(game.home_team)}
          <a href="team.html?id=${game.home_team.id}" class="game-team-name">${game.home_team.name}</a>
        </div>
        <div class="game-score-block">
          <div class="game-score-row">
            <span class="game-score${homeWin ? ' winner' : ''}">${game.home_score}</span>
            <span class="game-score-sep">–</span>
            <span class="game-score${awayWin ? ' winner' : ''}">${game.away_score}</span>
          </div>
          ${finalLabel}
          ${game.series ? `<div style="text-align:center;margin-top:0.4rem;"><div style="font-weight:700;color:#e6edf3;">Game ${game.series.game_number}</div><div style="font-size:0.85rem;color:#8b949e;">${game.series.text}</div></div>` : ''}
        </div>
        <div class="game-team-block">
          ${logoImg(game.away_team)}
          <a href="team.html?id=${game.away_team.id}" class="game-team-name">${game.away_team.name}</a>
        </div>
      </div>
      <p class="game-meta">${date}</p>`;

    if (!has_stats) {
      html += '<p style="color:#8b949e;text-align:center;">No player stats were recorded for this game.</p>';
    } else {
      html += GameStats.renderFullGameView(game, home_players || [], away_players || []);
    }

    root.innerHTML = html;

    // Reload the game view after the stats editor saves changes
    window._gseOnSave = () => loadGame();
  } catch (err) {
    root.innerHTML = `<p class="error">Failed to load game: ${err.message}</p>`;
  }
}

async function importMsoGame(id) {
  const input = document.getElementById('mso-game-url');
  const message = document.getElementById('mso-game-message');
  const button = input.parentElement.querySelector('button');
  const url = input.value.trim();
  const schedule_url = document.getElementById('mso-schedule-url').value.trim();
  if (!url) { message.textContent = 'Paste a MyStatsOnline game link first.'; return; }
  button.disabled = true;
  message.textContent = 'Loading game from MyStatsOnline…';
  const request = async body => {
    const response = await fetch(`${API}/games/${encodeURIComponent(id)}/import-mso`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': getAdminToken() },
      body: JSON.stringify(body),
    });
    const type = response.headers.get('content-type') || '';
    if (!type.toLowerCase().includes('application/json')) {
      if (response.status === 404) throw new Error('The import endpoint is unavailable. Restart the local server and try again.');
      throw new Error(`The server returned an unexpected response (HTTP ${response.status}). Check the server logs and try again.`);
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Import failed');
    return result;
  };
  try {
    const { preview, digest } = await request({ url, schedule_url });
    const { source, homePlayers, awayPlayers } = preview;
    const cappedNotice = !preview.forfeit_winner && (source.home.score - source.away.score > 7 || source.away.score - source.home.score > 7)
      ? `\nThe league's 7-goal differential cap will be applied: ${preview.home_score}–${preview.away_score}.` : '';
    const statusNotice = preview.forfeit_winner
      ? `\nForfeit winner: ${preview.forfeit_winner === 'home' ? preview.home_name : preview.away_name}.`
      : !source.isFinal
      ? `\nWarning: MyStatsOnline does not mark this game as final${source.status ? ` (status: ${source.status})` : ''}. Confirming will mark it complete here.` : '';
    const missingGoalieNotice = !homePlayers.some(p => p.position === 'G') || !awayPlayers.some(p => p.position === 'G')
      ? '\nA goalie is missing from the source. Existing players not listed in the source will be kept.' : '';
    const confirmation = `MyStatsOnline: ${source.home.name} ${source.home.score}–${source.away.score} ${source.away.name}\n${source.date}\n\n` +
      `Import ${homePlayers.length} home and ${awayPlayers.length} away player records. ` +
      `Existing matching player stats and the game score will be updated; players not listed in the source will be kept.${cappedNotice}${statusNotice}${missingGoalieNotice}\n\n` +
      'Is this the correct game?';
    if (!window.confirm(confirmation)) { message.textContent = 'Import cancelled; nothing was changed.'; return; }
    message.textContent = 'Importing game…';
    await request({ url, schedule_url, confirm: true, digest });
    await loadGame();
    document.getElementById('mso-game-message').textContent = 'MyStatsOnline game imported.';
  } catch (err) {
    message.textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

loadGame();
