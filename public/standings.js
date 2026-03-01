const API = '/api';

async function loadStandings() {
  const root = document.getElementById('standings-root');
  try {
    const res = await fetch(`${API}/standings`);
    if (!res.ok) throw new Error('Server error');
    const teams = await res.json();

    if (teams.length === 0) {
      root.innerHTML = '<p style="color:#8b949e">No standings data yet. Add teams and games in the Admin panel.</p>';
      return;
    }

    // Group by conference → division
    const conferences = {};
    for (const t of teams) {
      if (!conferences[t.conference]) conferences[t.conference] = {};
      if (!conferences[t.conference][t.division]) conferences[t.conference][t.division] = [];
      conferences[t.conference][t.division].push(t);
    }

    let html = '';
    for (const conf of Object.keys(conferences).sort()) {
      html += `<div class="conference-block"><h2>${conf} Conference</h2>`;
      for (const div of Object.keys(conferences[conf]).sort()) {
        html += `<div class="division-block"><h3>${div} Division</h3>`;
        html += `<table>
          <thead>
            <tr><th>Team</th><th>GP</th><th>W</th><th>L</th><th>PTS</th><th>GF</th><th>GA</th><th>DIFF</th></tr>
          </thead>
          <tbody>`;
        for (const t of conferences[conf][div].sort((a, b) => b.pts - a.pts || b.w - a.w)) {
          const diff = t.gf - t.ga;
          html += `<tr>
            <td><a href="team.html?id=${t.id}">${t.name}</a></td>
            <td>${t.gp}</td>
            <td>${t.w}</td>
            <td>${t.l}</td>
            <td><strong>${t.pts}</strong></td>
            <td>${t.gf}</td>
            <td>${t.ga}</td>
            <td>${diff >= 0 ? '+' : ''}${diff}</td>
          </tr>`;
        }
        html += '</tbody></table></div>';
      }
      html += '</div>';
    }
    root.innerHTML = html;
  } catch (err) {
    root.innerHTML = `<p class="error">Failed to load standings. Is the server running?</p>`;
  }
}

loadStandings();
