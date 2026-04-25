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

const logoHtml = t => t.logo_url
  ? `<img src="${t.logo_url}" style="width:24px;height:24px;object-fit:contain;vertical-align:middle;margin-right:0.4rem;border-radius:3px;" />`
  : '';

const streakStyle = s => s && s.startsWith('W')
  ? 'font-weight:600;color:#3fb950;'
  : s && s.startsWith('L') ? 'font-weight:600;color:#f85149;' : '';

// ── Clinch indicators (NHL-style) ─────────────────────────────────────────
const CLINCH_INFO = {
  p: { label: '– p', title: 'Clinched Presidents\' Trophy (best record)', legend: 'p – Presidents\' Trophy (best record)',         color: '#e3b341' },
  z: { label: '– z', title: 'Clinched conference',                        legend: 'z – Clinched conference',                       color: '#58a6ff' },
  y: { label: '– y', title: 'Clinched division',                          legend: 'y – Clinched division',                         color: '#3fb950' },
  x: { label: '– x', title: 'Clinched playoff spot',                      legend: 'x – Clinched playoff spot',                     color: '#3fb950' },
  e: { label: '– e', title: 'Eliminated from playoff contention',         legend: 'e – Eliminated from playoff contention',        color: '#f85149' },
};

function clinchBadge(t) {
  const c = CLINCH_INFO[t.clinch];
  if (!c) return '';
  return ` <span class="clinch-badge" style="color:${c.color};" title="${c.title}">${c.label}</span>`;
}

// ── Sort state ────────────────────────────────────────────────────────────
let _standingsData = null;
let _sortCol = 'pts';
let _sortDir = 'desc';

const SORT_DEFAULTS = { name: 'asc', streak: 'asc', home_record: 'asc', away_record: 'asc' };

function sortTeams(teams, col, dir) {
  return [...teams].sort((a, b) => {
    let va, vb;
    if (col === 'diff') {
      va = a.gf - a.ga; vb = b.gf - b.ga;
    } else if (col === 'name') {
      va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase();
      return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    } else {
      va = a[col] ?? 0; vb = b[col] ?? 0;
    }
    return dir === 'asc' ? va - vb : vb - va;
  });
}

function thSortable(col, label, title) {
  const active = _sortCol === col;
  const arrow = active ? (_sortDir === 'desc' ? ' ▼' : ' ▲') : '';
  const titleAttr = title ? ` title="${title}"` : '';
  return `<th style="cursor:pointer;user-select:none;white-space:nowrap;${active ? 'color:#58a6ff;' : ''}"${titleAttr} onclick="handleSortClick('${col}')">${label}${arrow}</th>`;
}

function buildThead() {
  return `<thead><tr>
    ${thSortable('rank', '#', 'Rank')}
    ${thSortable('name', 'Team')}
    ${thSortable('gp', 'GP', 'Games Played')}
    ${thSortable('w', 'W', 'Wins')}
    ${thSortable('otw', 'OTW', 'Overtime wins (included in W)')}
    ${thSortable('l', 'L', 'Losses')}
    ${thSortable('otl', 'OTL', 'Overtime Losses')}
    ${thSortable('pts', 'PTS', 'Points')}
    ${thSortable('gf', 'GF', 'Goals For')}
    ${thSortable('ga', 'GA', 'Goals Against')}
    ${thSortable('diff', 'DIFF', 'Goal Differential')}
    ${thSortable('streak', 'STK', 'Current Streak')}
    ${thSortable('home_record', 'HOME', 'Home Record')}
    ${thSortable('away_record', 'AWAY', 'Away Record')}
  </tr></thead>`;
}

function makeRow(t, rank) {
  const diff = t.gf - t.ga;
  return `<tr${teamRowAttrs(t)}>
    <td style="color:#8b949e;font-size:0.82rem;font-weight:600;min-width:24px;">${rank}</td>
    <td>${logoHtml(t)}<a href="team.html?id=${t.id}">${t.name}</a>${clinchBadge(t)}</td>
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

function clinchLegend(teams) {
  const present = new Set(teams.map(t => t.clinch).filter(Boolean));
  if (present.size === 0) return '';
  const items = ['p', 'z', 'y', 'x', 'e']
    .filter(k => present.has(k))
    .map(k => {
      const c = CLINCH_INFO[k];
      return `<span style="color:${c.color};font-size:0.78rem;">${c.legend}</span>`;
    }).join(' &nbsp;|&nbsp; ');
  return `<div style="margin-top:0.5rem;padding:0.4rem 0.6rem;background:#161b22;border:1px solid #30363d;border-radius:6px;font-size:0.78rem;color:#8b949e;">
    ${items}
  </div>`;
}

function buildStandingsHtml(teams) {
  if (!teams) return '<p style="color:#8b949e">Select a season above to view standings.</p>';
  if (teams.length === 0) return '<p style="color:#8b949e">No standings data for this season yet.</p>';

  const hasGroups = teams.some(t => t.conference || t.division);
  const thead = buildThead();

  if (!hasGroups) {
    const sorted = _sortCol === 'rank'
      ? sortTeams(teams, 'pts', 'desc')         // rank col = default pts sort
      : sortTeams(teams, _sortCol, _sortDir);
    const rows = sorted.map((t, i) => makeRow(t, i + 1)).join('');
    return `<div style="overflow-x:auto;"><table>${thead}<tbody>${rows}</tbody></table></div>${clinchLegend(teams)}`;
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
      const group = _sortCol === 'rank'
        ? sortTeams(conferences[conf][div], 'pts', 'desc')
        : sortTeams(conferences[conf][div], _sortCol, _sortDir);
      html += `<div style="overflow-x:auto;"><table>${thead}<tbody>`;
      group.forEach((t, i) => { html += makeRow(t, i + 1); });
      html += '</tbody></table></div>';
      if (div) html += '</div>';
    }
    html += '</div>';
  }
  html += clinchLegend(teams);
  return html;
}

function handleSortClick(col) {
  if (_sortCol === col) {
    _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
  } else {
    _sortCol = col;
    _sortDir = SORT_DEFAULTS[col] || 'desc';
  }
  if (_standingsData) {
    document.getElementById('standings-root').innerHTML = buildStandingsHtml(_standingsData);
  }
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

    _standingsData = await fetchStandings(sid);
    root.innerHTML = buildStandingsHtml(_standingsData);
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
  try {
    if (typeof SeasonSelector !== 'undefined') {
      await SeasonSelector.init('season-selector-container');
      SeasonSelector.onSeasonChange(() => showForSelectedSeason());
    }
    showForSelectedSeason();
  } catch (err) {
    console.error('[standings] init error:', err);
    const root = document.getElementById('standings-root');
    if (root) root.innerHTML = '<p style="color:#f85149;">Failed to load standings. Please refresh the page.</p>';
  }
})();
