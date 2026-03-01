const API = '/api';

async function loadStandings() {
  const root = document.getElementById('standings-root');
  try {
    const sid = typeof SeasonSelector !== 'undefined' ? SeasonSelector.getSelectedSeasonId() : null;
    const url = sid ? `${API}/standings?season_id=${sid}` : `${API}/standings`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Server error');
    const teams = await res.json();

    if (teams.length === 0) {
      root.innerHTML = '<p style="color:#8b949e">No standings data yet. Add teams and games in the Admin panel.</p>';
      return;
    }

    // Logo helper
    const logoHtml = t => t.logo_url
      ? `<img src="${t.logo_url}" style="width:24px;height:24px;object-fit:contain;vertical-align:middle;margin-right:0.4rem;border-radius:3px;" />`
      : '';

    // Check if any team has conference/division
    const hasGroups = teams.some(t => t.conference || t.division);

    if (!hasGroups) {
      // Simple flat table
      const rows = [...teams].sort((a, b) => b.pts - a.pts || b.w - a.w).map(t => {
        const diff = t.gf - t.ga;
        return `<tr>
          <td>${logoHtml(t)}<a href="team.html?id=${t.id}">${t.name}</a></td>
          <td>${t.gp}</td><td>${t.w}</td><td>${t.l}</td>
          <td><strong>${t.pts}</strong></td><td>${t.gf}</td><td>${t.ga}</td>
          <td>${diff >= 0 ? '+' : ''}${diff}</td>
        </tr>`;
      }).join('');
      root.innerHTML = `<table>
        <thead><tr><th>Team</th><th>GP</th><th>W</th><th>L</th><th>PTS</th><th>GF</th><th>GA</th><th>DIFF</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
      return;
    }

    // Grouped by conference → division
    const conferences = {};
    for (const t of teams) {
      const conf = t.conference || 'Unassigned';
      const div = t.division || '';
      if (!conferences[conf]) conferences[conf] = {};
      if (!conferences[conf][div]) conferences[conf][div] = [];
      conferences[conf][div].push(t);
    }

    let html = '';
    for (const conf of Object.keys(conferences).sort()) {
      html += `<div class="conference-block"><h2>${conf}${conf !== 'Unassigned' ? ' Conference' : ''}</h2>`;
      for (const div of Object.keys(conferences[conf]).sort()) {
        if (div) html += `<div class="division-block"><h3>${div} Division</h3>`;
        html += `<table>
          <thead><tr><th>Team</th><th>GP</th><th>W</th><th>L</th><th>PTS</th><th>GF</th><th>GA</th><th>DIFF</th></tr></thead>
          <tbody>`;
        for (const t of conferences[conf][div].sort((a, b) => b.pts - a.pts || b.w - a.w)) {
          const diff = t.gf - t.ga;
          html += `<tr>
            <td>${logoHtml(t)}<a href="team.html?id=${t.id}">${t.name}</a></td>
            <td>${t.gp}</td><td>${t.w}</td><td>${t.l}</td>
            <td><strong>${t.pts}</strong></td><td>${t.gf}</td><td>${t.ga}</td>
            <td>${diff >= 0 ? '+' : ''}${diff}</td>
          </tr>`;
        }
        html += '</tbody></table>';
        if (div) html += '</div>';
      }
      html += '</div>';
    }
    root.innerHTML = html;
  } catch (err) {
    root.innerHTML = `<p class="error">Failed to load standings. Is the server running?</p>`;
  }
}

(async () => {
  if (typeof SeasonSelector !== 'undefined') {
    await SeasonSelector.init('season-selector-container');
    SeasonSelector.onSeasonChange(() => loadStandings());
  }
  loadStandings();
})();
