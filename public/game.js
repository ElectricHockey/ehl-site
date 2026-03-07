const API = '/api';

// game-stats.js (loaded before this file) provides GameStats.renderTeamPanel and GameStats.normalizePlayer

// ── Main ───────────────────────────────────────────────────────────────────

async function loadGame() {
  const root = document.getElementById('game-root');
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) {
    root.innerHTML = '<p class="error">No game ID. <a href="recent-scores.html">Back to Recent Scores</a></p>';
    return;
  }

  try {
    const res = await fetch(`${API}/games/${id}/stats`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      root.innerHTML = `<p class="error">${err.error || 'Game not found.'} <a href="recent-scores.html">Back</a></p>`;
      return;
    }
    const { game, home_players, away_players, has_stats } = await res.json();

    document.title = `${game.home_team.name} vs ${game.away_team.name} – EHL`;

    const date = game.date
      ? new Date(game.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : '';
    const homeWin = game.home_score > game.away_score;
    const awayWin = game.away_score > game.home_score;
    const otBadge = game.is_overtime ? '<span class="ot-badge">OT</span>' : '';

    const logoImg = (team) => team.logo_url
      ? `<img src="${team.logo_url}" class="game-team-logo" alt="${team.name}" />`
      : `<div class="game-team-logo" style="border-radius:8px;border:1px solid #30363d;"></div>`;

    let html = `
      <div class="game-header">
        <div class="game-team-block">
          ${logoImg(game.home_team)}
          <a href="team.html?id=${game.home_team.id}" class="game-team-name">${game.home_team.name}</a>
        </div>
        <div class="game-score-block">
          <span class="game-score${homeWin ? ' winner' : ''}">${game.home_score}</span>
          <span class="game-score-sep">–</span>
          <span class="game-score${awayWin ? ' winner' : ''}">${game.away_score}</span>
        </div>
        <div class="game-team-block">
          ${logoImg(game.away_team)}
          <a href="team.html?id=${game.away_team.id}" class="game-team-name">${game.away_team.name}</a>
        </div>
      </div>
      <p class="game-meta">${date}${otBadge}</p>`;

    if (!has_stats) {
      html += '<p style="color:#8b949e;text-align:center;">No player stats were recorded for this game.</p>';
    } else {
      html += GameStats.renderTeamPanel(game.home_team, home_players || []);
      html += GameStats.renderTeamPanel(game.away_team, away_players || []);
    }

    root.innerHTML = html;
  } catch (err) {
    root.innerHTML = `<p class="error">Failed to load game: ${err.message}</p>`;
  }
}

loadGame();
