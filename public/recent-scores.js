const API = '/api';

async function loadRecentScores() {
  const root = document.getElementById('scores-root');
  try {
    const sid = typeof SeasonSelector !== 'undefined' ? SeasonSelector.getSelectedSeasonId() : null;
    const url = sid ? `${API}/games?season_id=${sid}` : `${API}/games`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Server error');
    const games = await res.json();

    const completed = games.filter(g => g.status === 'complete');

    if (completed.length === 0) {
      root.innerHTML = '<p style="color:#8b949e">No completed games yet.</p>';
      return;
    }

    const logoHtml = (url, alt) => url
      ? `<img src="${url}" class="team-logo-sm" alt="${alt}" />`
      : '';

    const cards = completed.map(g => {
      const homeWin = g.home_score > g.away_score;
      const awayWin = g.away_score > g.home_score;
      const homeCls = homeWin ? 'score-winner' : '';
      const awayCls = awayWin ? 'score-winner' : '';
      const date = g.date ? new Date(g.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      return `<div class="score-card">
        <div class="score-teams">
          ${logoHtml(g.home_logo, g.home_team_name)}
          <span class="score-team-name ${homeCls}">${g.home_team_name}</span>
          <span class="score-num ${homeCls}">${g.home_score}</span>
          <span class="score-vs">–</span>
          <span class="score-num ${awayCls}">${g.away_score}</span>
          <span class="score-team-name ${awayCls}">${g.away_team_name}</span>
          ${logoHtml(g.away_logo, g.away_team_name)}
        </div>
        <span class="score-date">${date}</span>
      </div>`;
    }).join('');

    root.innerHTML = cards;
  } catch {
    root.innerHTML = '<p class="error">Failed to load scores. Is the server running?</p>';
  }
}

(async () => {
  if (typeof SeasonSelector !== 'undefined') {
    await SeasonSelector.init('season-selector-container');
    SeasonSelector.onSeasonChange(() => loadRecentScores());
  }
  loadRecentScores();
})();
