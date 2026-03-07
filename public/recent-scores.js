const API = '/api';

function buildScoreCards(games) {
  const completed = games.filter(g => g.status === 'complete');
  if (completed.length === 0) return '<p style="color:#8b949e;">No completed games yet for this season.</p>';

  const logoHtml = (url, alt) => url ? `<img src="${url}" class="team-logo-sm" alt="${alt}" />` : '';

  return completed.map(g => {
    const homeWin = g.home_score > g.away_score;
    const awayWin = g.away_score > g.home_score;
    const homeCls = homeWin ? 'score-winner' : '';
    const awayCls = awayWin ? 'score-winner' : '';
    const date = g.date ? new Date(g.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const ot = g.is_overtime ? '<span style="font-size:0.72rem;color:#8b949e;margin-left:0.3rem;">OT</span>' : '';
    return `<a class="score-card score-card-link" href="game.html?id=${g.id}">
      <div class="score-teams">
        ${logoHtml(g.home_logo, g.home_team_name)}
        <span class="score-team-name ${homeCls}">${g.home_team_name}</span>
        <span class="score-num ${homeCls}">${g.home_score}</span>
        <span class="score-vs">–</span>
        <span class="score-num ${awayCls}">${g.away_score}</span>
        <span class="score-team-name ${awayCls}">${g.away_team_name}</span>
        ${logoHtml(g.away_logo, g.away_team_name)}
        ${ot}
      </div>
      <span class="score-date">${date}</span>
      <span class="score-view-stats">View Stats →</span>
    </a>`;
  }).join('');
}

async function loadRecentScores() {
  const root = document.getElementById('scores-root');
  try {
    const threesSid = typeof SeasonSelector !== 'undefined' ? SeasonSelector.getSelectedSeasonId('threes') : null;
    const sixesSid  = typeof SeasonSelector !== 'undefined' ? SeasonSelector.getSelectedSeasonId('sixes')  : null;

    const fetchGames = async sid => {
      if (!sid) return [];
      const res = await fetch(`${API}/games?season_id=${sid}`);
      return res.ok ? await res.json() : [];
    };

    const [gamesThrees, gamesSixes] = await Promise.all([
      fetchGames(threesSid),
      fetchGames(sixesSid),
    ]);

    root.innerHTML = `
      <div style="margin-bottom:2.5rem;">
        <h2 class="league-section-heading">⛸️ 3's Recent Scores</h2>
        ${buildScoreCards(gamesThrees)}
      </div>
      <div>
        <h2 class="league-section-heading">🏒 6's Recent Scores</h2>
        ${buildScoreCards(gamesSixes)}
      </div>`;
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
