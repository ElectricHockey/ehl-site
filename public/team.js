const API = '/api';

function formatToi(seconds) {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function resultBadge(r) {
  if (r === 'W') return '<span class="badge badge-win">W</span>';
  if (r === 'L') return '<span class="badge badge-loss">L</span>';
  return `<span class="badge badge-tie">${r}</span>`;
}

function renderSkaterTable(players) {
  if (!players || players.length === 0) return '<p class="no-stats">No skater stats yet.</p>';
  return `<table class="season-stats-table">
    <thead><tr>
      <th>Pos</th><th>Player</th><th>GP</th><th>G</th><th>A</th><th>PTS</th>
      <th>+/-</th><th>SOG</th><th>HIT</th><th>BS</th><th>TKW</th><th>PPG</th><th>PIM</th><th>TOI</th>
    </tr></thead>
    <tbody>${players.map(p => `<tr>
      <td>${p.position || '–'}</td><td>${p.name}</td><td>${p.gp}</td>
      <td>${p.goals}</td><td>${p.assists}</td><td><strong>${p.points}</strong></td>
      <td>${p.plus_minus >= 0 ? '+' : ''}${p.plus_minus}</td>
      <td>${p.shots}</td><td>${p.hits}</td><td>${p.blocked_shots}</td>
      <td>${p.takeaways}</td><td>${p.pp_goals}</td><td>${p.pim}</td><td>${formatToi(p.toi)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function renderGoalieTable(players) {
  if (!players || players.length === 0) return '<p class="no-stats">No goalie stats yet.</p>';
  return `<table class="season-stats-table">
    <thead><tr><th>Player</th><th>GP</th><th>SV</th><th>GA</th><th>SA</th><th>SV%</th></tr></thead>
    <tbody>${players.map(p => {
      const svp = p.save_pct !== null && p.save_pct !== undefined
        ? (p.save_pct < 1 ? (p.save_pct * 100).toFixed(1) : p.save_pct.toFixed(1)) + '%' : '–';
      return `<tr><td>${p.name}</td><td>${p.gp}</td><td>${p.saves}</td><td>${p.goals_against}</td><td>${p.shots_against}</td><td>${svp}</td></tr>`;
    }).join('')}</tbody>
  </table>`;
}

async function loadTeamPage() {
  const root = document.getElementById('team-root');
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) {
    root.innerHTML = '<p class="error">No team ID provided. Go back to <a href="standings.html">Standings</a>.</p>';
    return;
  }

  try {
    const sid = typeof SeasonSelector !== 'undefined' ? SeasonSelector.getSelectedSeasonId() : null;
    const url = sid ? `${API}/teams/${id}/stats?season_id=${sid}` : `${API}/teams/${id}/stats`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      root.innerHTML = `<p class="error">${err.error || 'Team not found.'}</p>`;
      return;
    }

    const { team, skaterStats, goalieStats, recentGames } = await res.json();
    document.title = `${team.name} – EHL`;

    const logoHtml = team.logo_url
      ? `<img src="${team.logo_url}" style="width:64px;height:64px;object-fit:contain;border-radius:8px;background:#21262d;padding:4px;margin-right:1rem;vertical-align:middle;" />`
      : '';

    const meta = [team.conference, team.division].filter(Boolean).join(' · ');

    let html = `
      <a href="standings.html" style="font-size:0.9rem;color:#8b949e;">← Back to Standings</a>
      <div style="display:flex;align-items:center;margin-top:0.75rem;flex-wrap:wrap;gap:0.5rem;">
        ${logoHtml}
        <div>
          <h1 style="margin:0;">${team.name}</h1>
          ${meta ? `<p style="color:#8b949e;margin:0.1rem 0 0;">${meta}</p>` : ''}
        </div>
      </div>`;

    // Season selector placeholder
    html += `<div style="margin:1rem 0 0.5rem;" id="season-selector-container"></div>`;

    const noStats = skaterStats.length === 0 && goalieStats.length === 0;
    html += `
      <h2>Season Stats – Skaters</h2>
      ${noStats ? '<p class="no-stats">No stats recorded yet. Games must be linked to EA matches and marked complete.</p>' : renderSkaterTable(skaterStats)}
      <h2>Season Stats – Goalies</h2>
      ${goalieStats.length === 0 ? '<p class="no-stats">No goalie stats yet.</p>' : renderGoalieTable(goalieStats)}
      <h2>Recent Results</h2>`;

    if (recentGames.length === 0) {
      html += '<p class="no-stats">No completed games recorded yet.</p>';
    } else {
      html += '<div>';
      for (const g of recentGames) {
        const isHome = g.home_team_id === team.id;
        const opponent = isHome ? g.away_team_name : g.home_team_name;
        const oppLogo = isHome ? g.away_logo : g.home_logo;
        const myScore = isHome ? g.home_score : g.away_score;
        const oppScore = isHome ? g.away_score : g.home_score;
        const result = myScore > oppScore ? 'W' : myScore < oppScore ? 'L' : 'T';
        html += `
          <div class="recent-game">
            ${resultBadge(result)}
            <span class="rg-score">${myScore} – ${oppScore}</span>
            <span class="rg-opponent">
              ${oppLogo ? `<img src="${oppLogo}" style="width:20px;height:20px;object-fit:contain;vertical-align:middle;border-radius:3px;margin-right:0.3rem;" />` : ''}
              vs ${opponent}
            </span>
            <span class="rg-date">${g.date}</span>
            <a href="schedule.html?g=${g.id}" style="font-size:0.82rem;">View Stats</a>
          </div>`;
      }
      html += '</div>';
    }

    root.innerHTML = html;

    // Init season selector inside the page (after content is in DOM)
    if (typeof SeasonSelector !== 'undefined') {
      await SeasonSelector.init('season-selector-container');
      SeasonSelector.onSeasonChange(() => loadTeamPage());
    }
  } catch (err) {
    root.innerHTML = '<p class="error">Failed to load team data. Is the server running?</p>';
  }
}

loadTeamPage();
