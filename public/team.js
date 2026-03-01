const API = '/api';

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

function renderPlayers(players) {
  if (!players || players.length === 0) return '<p style="color:#8b949e;padding:0.5rem 1rem;">No player data available.</p>';

  const posOrder = { G: 0, C: 1, LW: 2, RW: 3, LD: 4, RD: 5 };
  const sorted = [...players].sort((a, b) => (posOrder[a.position] ?? 9) - (posOrder[b.position] ?? 9));

  const goalies = sorted.filter(p => p.position === 'G');
  const skaters = sorted.filter(p => p.position !== 'G');

  let html = '';

  if (skaters.length > 0) {
    html += `<table class="player-stats">
      <thead>
        <tr>
          <th>Pos</th><th>Player</th><th>G</th><th>A</th><th>PTS</th>
          <th>+/-</th><th>SOG</th><th>HIT</th><th>BS</th><th>PIM</th><th>TOI</th>
        </tr>
      </thead>
      <tbody>
        ${skaters.map(p => `<tr>
          <td>${p.position || '–'}</td>
          <td>${p.name}</td>
          <td>${p.goals}</td>
          <td>${p.assists}</td>
          <td><strong>${p.points}</strong></td>
          <td>${p.plusMinus >= 0 ? '+' : ''}${p.plusMinus}</td>
          <td>${p.shots}</td>
          <td>${p.hits}</td>
          <td>${p.blockedShots}</td>
          <td>${p.pim}</td>
          <td>${formatToi(p.toi)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  if (goalies.length > 0) {
    html += `<table class="player-stats" style="margin-top:0.5rem;">
      <thead>
        <tr>
          <th>Pos</th><th>Player</th><th>SV</th><th>GA</th><th>SV%</th>
        </tr>
      </thead>
      <tbody>
        ${goalies.map(p => `<tr>
          <td>G</td>
          <td>${p.name}</td>
          <td>${p.saves}</td>
          <td>${p.goalsAgainst}</td>
          <td>${p.savesPct !== null ? (p.savesPct * 100).toFixed(1) + '%' : '–'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  return html;
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
    const [teamsRes, eaRes] = await Promise.all([
      fetch(`${API}/teams`),
      fetch(`${API}/teams/${id}/ea-matches`),
    ]);

    const teams = await teamsRes.json();
    const team = teams.find(t => String(t.id) === String(id));
    if (!team) {
      root.innerHTML = '<p class="error">Team not found.</p>';
      return;
    }

    document.title = `${team.name} – EHL`;

    if (!eaRes.ok) {
      const err = await eaRes.json().catch(() => ({}));
      const msg = err.error || 'Unable to load EA matches.';
      root.innerHTML = `
        <h1>${team.name}</h1>
        <p style="color:#8b949e;">${team.conference} Conference · ${team.division} Division</p>
        <div class="no-ea-id">
          <strong>⚠️ ${msg}</strong>
          ${!team.ea_club_id ? '<p style="margin-top:0.5rem;">Ask an admin to set this team\'s EA Club ID in the <a href="admin.html">Admin Panel</a>.</p>' : ''}
        </div>`;
      return;
    }

    const data = await eaRes.json();
    const matches = data.matches || [];

    let html = `
      <a href="standings.html" style="font-size:0.9rem;color:#8b949e;">← Back to Standings</a>
      <h1 style="margin-top:0.75rem;">${team.name}</h1>
      <p style="color:#8b949e;">${team.conference} Conference · ${team.division} Division
        ${team.ea_club_id ? `· EA Club ID: <strong style="color:#c9d1d9;">${team.ea_club_id}</strong>` : ''}
      </p>
      <h2>Recent League Matches</h2>`;

    if (matches.length === 0) {
      html += '<p style="color:#8b949e;margin-top:0.75rem;">No recent matches found against other EHL clubs. Make sure all league teams have their EA Club IDs set in the Admin Panel.</p>';
    } else {
      for (const m of matches) {
        const opponentName = m.opponent ? m.opponent.name : `Club (EA ID unknown)`;
        const opponentLink = m.opponent ? `<a href="team.html?id=${m.opponent.id}">${opponentName}</a>` : opponentName;
        html += `
          <div class="match-card">
            <div class="match-header">
              ${resultBadge(m.result)}
              <span class="match-score">${m.score} – ${m.opponentScore}</span>
              <span class="match-opponent">vs ${opponentLink}</span>
              ${m.date ? `<span class="match-date">${m.date}</span>` : ''}
            </div>
            ${renderPlayers(m.players)}
          </div>`;
      }
    }

    root.innerHTML = html;
  } catch (err) {
    root.innerHTML = '<p class="error">Failed to load team data. Is the server running?</p>';
  }
}

loadTeamPage();
