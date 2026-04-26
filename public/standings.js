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

// ── Clinch indicators (NHL-style, capital letters) ────────────────────────
const CLINCH_INFO = {
  P: { label: '– P', title: 'Clinched Presidents\' Trophy (best record)', legend: 'P – Presidents\' Trophy (best record)',         color: '#e3b341' },
  Z: { label: '– Z', title: 'Clinched conference',                        legend: 'Z – Clinched conference',                       color: '#58a6ff' },
  Y: { label: '– Y', title: 'Clinched division',                          legend: 'Y – Clinched division',                         color: '#3fb950' },
  X: { label: '– X', title: 'Clinched playoff spot',                      legend: 'X – Clinched playoff spot',                     color: '#3fb950' },
  E: { label: '– E', title: 'Eliminated from playoff contention',         legend: 'E – Eliminated from playoff contention',        color: '#f85149' },
};

function clinchBadge(t) {
  const c = CLINCH_INFO[t.clinch];
  if (!c) return '';
  return ` <span class="clinch-badge" style="color:${c.color};" title="${c.title}">${c.label}</span>`;
}

// ── Sort helpers ──────────────────────────────────────────────────────────

// Convert streak string "W5" / "L3" / "—" to a sortable number
function streakValue(s) {
  if (!s || s === '—') return 0;
  const m = s.match(/^([WL])(\d+)$/);
  if (!m) return 0;
  return m[1] === 'W' ? parseInt(m[2], 10) : -parseInt(m[2], 10);
}

// Convert record string "W-L-OTL" to pts (W×2 + OTL×1)
function recordPts(r) {
  if (!r) return 0;
  const p = (r + '').split('-').map(Number);
  return (p[0] || 0) * 2 + (p[2] || 0);
}

// ── Sort state ────────────────────────────────────────────────────────────
let _standingsData = null;   // { teams, playoff_cutoff }
let _sortCol = 'pts';
let _sortDir = 'desc';

const SORT_DEFAULTS = { name: 'asc' };

function sortTeams(teams, col, dir) {
  return [...teams].sort((a, b) => {
    let va, vb;
    if (col === 'diff') {
      va = a.gf - a.ga; vb = b.gf - b.ga;
    } else if (col === 'name') {
      va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase();
      return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    } else if (col === 'streak') {
      va = streakValue(a.streak); vb = streakValue(b.streak);
    } else if (col === 'home_record') {
      va = recordPts(a.home_record); vb = recordPts(b.home_record);
    } else if (col === 'away_record') {
      va = recordPts(a.away_record); vb = recordPts(b.away_record);
    } else if (col === 'l10') {
      va = recordPts(a.l10); vb = recordPts(b.l10);
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

// Column order: #, Team, GP, W, L, OTL, OTW, PTS, GF, GA, DIFF, STK, L10, HOME, AWAY
function buildThead() {
  return `<thead><tr>
    ${thSortable('rank', '#', 'Rank')}
    ${thSortable('name', 'Team')}
    ${thSortable('gp', 'GP', 'Games Played')}
    ${thSortable('w', 'W', 'Wins')}
    ${thSortable('l', 'L', 'Losses')}
    ${thSortable('otl', 'OTL', 'Overtime Losses')}
    ${thSortable('otw', 'OTW', 'Overtime wins (included in W)')}
    ${thSortable('pts', 'PTS', 'Points')}
    ${thSortable('gf', 'GF', 'Goals For')}
    ${thSortable('ga', 'GA', 'Goals Against')}
    ${thSortable('diff', 'DIFF', 'Goal Differential')}
    ${thSortable('streak', 'STK', 'Current Streak')}
    ${thSortable('l10', 'L10', 'Last 10 Games Record (W-L-OTL)')}
    ${thSortable('home_record', 'HOME', 'Home Record')}
    ${thSortable('away_record', 'AWAY', 'Away Record')}
  </tr></thead>`;
}

function makeRow(t, rank) {
  const diff = t.gf - t.ga;
  return `<tr${teamRowAttrs(t)}>
    <td style="color:#8b949e;font-size:0.82rem;font-weight:600;min-width:24px;">${rank}</td>
    <td>${logoHtml(t)}<a href="team.html?id=${t.id}" class="team-link">${t.name}</a>${clinchBadge(t)}</td>
    <td>${t.gp}</td>
    <td>${t.w}</td>
    <td>${t.l}</td>
    <td style="color:#8b949e;">${t.otl || 0}</td>
    <td style="color:#8b949e;">${t.otw || 0}</td>
    <td><strong>${t.pts}</strong></td>
    <td>${t.gf}</td><td>${t.ga}</td>
    <td>${diff >= 0 ? '+' : ''}${diff}</td>
    <td style="${streakStyle(t.streak)}">${t.streak || '—'}</td>
    <td style="color:#8b949e;font-size:0.82rem;">${t.l10 || '0-0-0'}</td>
    <td style="color:#8b949e;font-size:0.82rem;">${t.home_record || '0-0-0'}</td>
    <td style="color:#8b949e;font-size:0.82rem;">${t.away_record || '0-0-0'}</td>
  </tr>`;
}

// A horizontal separator row spanning all columns (playoff cutoff line, no label)
const PLAYOFF_LINE_ROW = `<tr class="playoff-cutoff-row"><td colspan="15" style="padding:0;height:2px;border-top:2px solid #58a6ff;"></td></tr>`;

function clinchLegend(teams) {
  const present = new Set(teams.map(t => t.clinch).filter(Boolean));
  if (present.size === 0) return '';
  const items = ['P', 'Z', 'Y', 'X', 'E']
    .filter(k => present.has(k))
    .map(k => {
      const c = CLINCH_INFO[k];
      return `<span style="color:${c.color};font-size:0.78rem;">${c.legend}</span>`;
    }).join(' &nbsp;|&nbsp; ');
  return `<div style="margin-top:0.5rem;padding:0.4rem 0.6rem;background:#161b22;border:1px solid #30363d;border-radius:6px;font-size:0.78rem;color:#8b949e;">
    ${items}
  </div>`;
}

function buildStandingsHtml(data) {
  if (!data) return '<p style="color:#8b949e">Select a season above to view standings.</p>';
  const teams = data.teams || data;   // handle both {teams,playoff_cutoff} and bare array
  const cutoff = data.playoff_cutoff ?? null;

  if (!teams || teams.length === 0) return '<p style="color:#8b949e">No standings data for this season yet.</p>';

  const hasGroups = teams.some(t => t.conference || t.division);
  const thead = buildThead();

  // Build a global pts-sort order to know each team's true league rank
  const globalOrder = sortTeams(teams, 'pts', 'desc');
  const globalRank = {};
  globalOrder.forEach((t, i) => { globalRank[t.id] = i + 1; });

  if (!hasGroups) {
    const sorted = _sortCol === 'rank'
      ? [...globalOrder]
      : sortTeams(teams, _sortCol, _sortDir);
    let rows = '';
    sorted.forEach((t, i) => {
      // Insert playoff line AFTER the last in-playoff team (between rank N and N+1)
      if (cutoff && i === cutoff) rows += PLAYOFF_LINE_ROW;
      rows += makeRow(t, globalRank[t.id]);
    });
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
      let cutoffInserted = false;
      group.forEach((t, i) => {
        // Insert playoff line between the last in-playoff team and the first out-of-playoff team
        // Use overall global rank to determine the cutoff position within this group
        if (cutoff && !cutoffInserted) {
          const prevIn = i > 0 && globalRank[group[i - 1].id] <= cutoff;
          const currOut = globalRank[t.id] > cutoff;
          if ((i === 0 && currOut) || (prevIn && currOut)) {
            html += PLAYOFF_LINE_ROW;
            cutoffInserted = true;
          }
        }
        html += makeRow(t, globalRank[t.id]);
      });
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
    return await res.json();   // { teams: [...], playoff_cutoff: N|null }
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
      await SeasonSelector.init('season-selector-container', { noAllTime: true });
      SeasonSelector.onSeasonChange(() => showForSelectedSeason());
    }
    showForSelectedSeason();
  } catch (err) {
    console.error('[standings] init error:', err);
    const root = document.getElementById('standings-root');
    if (root) root.innerHTML = '<p style="color:#f85149;">Failed to load standings. Please refresh the page.</p>';
  }
})();
