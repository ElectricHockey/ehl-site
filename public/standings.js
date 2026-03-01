const API = '/api';

// Convert a hex colour (#rrggbb or #rgb) to "r,g,b" for use in rgba(var(--c), alpha)
function hexToRgbStr(hex) {
  if (!hex || hex.length < 4) return null;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  h = h.padEnd(6, '0');
  return `${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`;
}

function teamRowAttrs(t) {
  const c1 = hexToRgbStr(t.color1);
  if (!c1) return '';
  const c2 = hexToRgbStr(t.color2) || c1;
  return ` class="team-row" style="--c1:${c1};--c2:${c2};"`;
}

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

    const streakStyle = s => s && s.startsWith('W')
      ? 'font-weight:600;color:#3fb950;'
      : s && s.startsWith('L') ? 'font-weight:600;color:#f85149;' : '';

    const makeRow = t => {
      const diff = t.gf - t.ga;
      return `<tr${teamRowAttrs(t)}>
        <td>${logoHtml(t)}<a href="team.html?id=${t.id}">${t.name}</a></td>
        <td>${t.gp}</td>
        <td>${t.w}</td>
        <td style="color:#8b949e;">${t.otw || 0}</td>
        <td>${t.l}</td>
        <td style="color:#8b949e;">${t.otl || 0}</td>
        <td><strong>${t.pts}</strong></td>
        <td>${t.gf}</td><td>${t.ga}</td>
        <td>${diff >= 0 ? '+' : ''}${diff}</td>
        <td style="${streakStyle(t.streak)}">${t.streak || '—'}</td>
        <td style="color:#8b949e;font-size:0.82rem;">${t.home_record || '0-0-0'}</td>
        <td style="color:#8b949e;font-size:0.82rem;">${t.away_record || '0-0-0'}</td>
      </tr>`;
    };

    const thead = `<thead><tr>
      <th>Team</th><th>GP</th><th>W</th><th title="Overtime wins (included in W)">OTW</th>
      <th>L</th><th title="Overtime losses">OTL</th><th>PTS</th>
      <th>GF</th><th>GA</th><th>DIFF</th><th>STK</th><th>HOME</th><th>AWAY</th>
    </tr></thead>`;

    // Check if any team has conference/division
    const hasGroups = teams.some(t => t.conference || t.division);

    if (!hasGroups) {
      const rows = [...teams].sort((a, b) => b.pts - a.pts || b.w - a.w).map(makeRow).join('');
      root.innerHTML = `<div style="overflow-x:auto;"><table>${thead}<tbody>${rows}</tbody></table></div>`;
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
        html += `<div style="overflow-x:auto;"><table>${thead}<tbody>`;
        for (const t of conferences[conf][div].sort((a, b) => b.pts - a.pts || b.w - a.w)) {
          html += makeRow(t);
        }
        html += '</tbody></table></div>';
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
