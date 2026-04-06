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

const thead = `<thead><tr>
  <th>Team</th><th>GP</th><th>W</th><th title="Overtime wins (included in W)">OTW</th>
  <th>L</th><th title="Overtime losses">OTL</th><th>PTS</th>
  <th>GF</th><th>GA</th><th>DIFF</th><th>STK</th><th>HOME</th><th>AWAY</th>
</tr></thead>`;

const logoHtml = t => t.logo_url
  ? `<img src="${t.logo_url}" style="width:24px;height:24px;object-fit:contain;vertical-align:middle;margin-right:0.4rem;border-radius:3px;" />`
  : '';

const streakStyle = s => s && s.startsWith('W')
  ? 'font-weight:600;color:#3fb950;'
  : s && s.startsWith('L') ? 'font-weight:600;color:#f85149;' : '';

function makeRow(t) {
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
}

function buildStandingsHtml(teams) {
  if (!teams) return '<p style="color:#8b949e">Select a season above to view standings.</p>';
  if (teams.length === 0) return '<p style="color:#8b949e">No standings data for this season yet.</p>';

  const hasGroups = teams.some(t => t.conference || t.division);
  if (!hasGroups) {
    const rows = [...teams].sort((a, b) => b.pts - a.pts || b.w - a.w).map(makeRow).join('');
    return `<div style="overflow-x:auto;"><table>${thead}<tbody>${rows}</tbody></table></div>`;
  }

  // Grouped by conference → division
  const conferences = {};
  for (const t of teams) {
    const conf = t.conference || 'Unassigned';
    const div  = t.division  || '';
    if (!conferences[conf]) conferences[conf] = {};
    if (!conferences[conf][div]) conferences[conf][div] = [];
    conferences[conf][div].push(t);
  }
  let html = '';
  for (const conf of Object.keys(conferences).sort()) {
    html += `<div class="conference-block"><h3>${conf}${conf !== 'Unassigned' ? ' Conference' : ''}</h3>`;
    for (const div of Object.keys(conferences[conf]).sort()) {
      if (div) html += `<div class="division-block"><h4 style="font-size:1rem;color:#8b949e;margin-top:1rem;">${div} Division</h4>`;
      html += `<div style="overflow-x:auto;"><table>${thead}<tbody>`;
      for (const t of conferences[conf][div].sort((a, b) => b.pts - a.pts || b.w - a.w)) {
        html += makeRow(t);
      }
      html += '</tbody></table></div>';
      if (div) html += '</div>';
    }
    html += '</div>';
  }
  return html;
}

async function fetchStandings(seasonId) {
  if (!seasonId) return null;
  try {
    const res = await fetch(`${API}/standings?season_id=${seasonId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function loadStandings() {
  const root = document.getElementById('standings-root');
  root.innerHTML = '<p class="loading">Loading standings…</p>';
  try {
    const sid = typeof SeasonSelector !== 'undefined' ? SeasonSelector.getSelectedSeasonId() : null;

    if (!sid) {
      root.innerHTML = '<p style="color:#8b949e">Select a league and season above to view standings.</p>';
      return;
    }

    const teams = await fetchStandings(sid);
    root.innerHTML = buildStandingsHtml(teams);
  } catch {
    root.innerHTML = `<p class="error">Failed to load standings. Is the server running?</p>`;
  }
}

// ── Show standings or bracket depending on selected season ─────────────────

function showForSelectedSeason() {
  const standingsRoot = document.getElementById('standings-root');
  const playoffRoot   = document.getElementById('playoff-root');
  const sd            = document.getElementById('series-detail');

  const isPlayoff = typeof SeasonSelector !== 'undefined'
    ? SeasonSelector.getSelectedSeasonIsPlayoff()
    : false;

  if (isPlayoff) {
    if (standingsRoot) standingsRoot.style.display = 'none';
    if (playoffRoot)   playoffRoot.style.display   = '';
    if (sd)            sd.style.display            = 'none';
    if (typeof loadPlayoff === 'function') loadPlayoff();
  } else {
    if (standingsRoot) standingsRoot.style.display = '';
    if (playoffRoot)   playoffRoot.style.display   = 'none';
    if (sd)            sd.style.display            = 'none';
    loadStandings();
  }
}

(async () => {
  if (typeof SeasonSelector !== 'undefined') {
    await SeasonSelector.init('season-selector-container');
    SeasonSelector.onSeasonChange(() => showForSelectedSeason());
  }
  showForSelectedSeason();
})();
