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
let _standingsData = null;   // { teams, playoff_cutoff, conf_cutoffs, div_cutoffs }
let _sortCol = 'pts';
let _sortDir = 'desc';
let _viewMode = null;        // null | 'league' | 'conference' | 'division'

const SORT_DEFAULTS = { name: 'asc' };

function sortTeams(teams, col, dir) {
  return [...teams].sort((a, b) => {
    let va, vb;
    if (col === 'diff') {
      va = a.gf - a.ga; vb = b.gf - b.ga;
    } else if (col === 'rw') {
      va = (a.w || 0) - (a.otw || 0); vb = (b.w || 0) - (b.otw || 0);
    } else if (col === 'pct') {
      va = a.gp > 0 ? a.pts / (a.gp * 2) : 0; vb = b.gp > 0 ? b.pts / (b.gp * 2) : 0;
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

// Column order: #, Team, GP, W, L, OTL, PTS, P%, GF, GA, DIFF, STK, RW, L10, HOME, AWAY
function buildThead() {
  return `<thead><tr>
    ${thSortable('rank', '#', 'Rank')}
    ${thSortable('name', 'Team')}
    ${thSortable('gp', 'GP', 'Games Played')}
    ${thSortable('w', 'W', 'Wins')}
    ${thSortable('l', 'L', 'Losses')}
    ${thSortable('otl', 'OTL', 'Overtime Losses')}
    ${thSortable('pts', 'PTS', 'Points')}
    ${thSortable('pct', 'P%', 'Point Percentage (PTS / (GP × 2))')}
    ${thSortable('gf', 'GF', 'Goals For')}
    ${thSortable('ga', 'GA', 'Goals Against')}
    ${thSortable('diff', 'DIFF', 'Goal Differential')}
    ${thSortable('streak', 'STK', 'Current Streak')}
    ${thSortable('rw', 'RW', 'Regulation Wins')}
    ${thSortable('l10', 'L10', 'Last 10 Games Record (W-L-OTL)')}
    ${thSortable('home_record', 'HOME', 'Home Record')}
    ${thSortable('away_record', 'AWAY', 'Away Record')}
  </tr></thead>`;
}

function makeRow(t, rank) {
  const diff = t.gf - t.ga;
  const rw = (t.w || 0) - (t.otw || 0);
  const pct = t.gp > 0 ? ((t.pts / (t.gp * 2)) * 100).toFixed(1) + '%' : '—';
  return `<tr${teamRowAttrs(t)}>
    <td style="color:#8b949e;font-size:0.82rem;font-weight:600;min-width:24px;">${rank}</td>
    <td>${logoHtml(t)}<a href="team.html?id=${t.id}" class="team-link">${t.name}</a>${clinchBadge(t)}</td>
    <td>${t.gp}</td>
    <td>${t.w}</td>
    <td>${t.l}</td>
    <td>${t.otl || 0}</td>
    <td><strong>${t.pts}</strong></td>
    <td style="color:#8b949e;font-size:0.82rem;">${pct}</td>
    <td>${t.gf}</td><td>${t.ga}</td>
    <td>${diff >= 0 ? '+' : ''}${diff}</td>
    <td style="${streakStyle(t.streak)}">${t.streak || '—'}</td>
    <td style="color:#8b949e;">${rw}</td>
    <td style="color:#8b949e;font-size:0.82rem;">${t.l10 || '0-0-0'}</td>
    <td style="color:#8b949e;font-size:0.82rem;">${t.home_record || '0-0-0'}</td>
    <td style="color:#8b949e;font-size:0.82rem;">${t.away_record || '0-0-0'}</td>
  </tr>`;
}

// A horizontal separator row spanning all columns (playoff cutoff line, no label)
const PLAYOFF_LINE_ROW = `<tr class="playoff-cutoff-row"><td colspan="16" style="padding:0;height:2px;border-top:2px solid #58a6ff;"></td></tr>`;

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

// ── View selector (League / Conference / Division) ────────────────────────

function updateViewSelector(hasConf, hasDiv) {
  const container = document.getElementById('standings-view-container');
  if (!container) return;

  if (!hasConf && !hasDiv) {
    container.innerHTML = '';
    _viewMode = 'league';
    return;
  }

  // Set default or correct an invalid view mode for this data
  if (!_viewMode || (_viewMode === 'conference' && !hasConf) || (_viewMode === 'division' && !hasDiv)) {
    _viewMode = hasConf ? 'conference' : 'division';
  }

  const options = [
    { value: 'league', label: 'League' },
    ...(hasConf ? [{ value: 'conference', label: 'Conference' }] : []),
    ...(hasDiv  ? [{ value: 'division',   label: 'Division'   }] : []),
  ];

  const selectStyle = 'background:#161b22;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:0.3rem 0.6rem;font-size:0.88rem;';
  container.innerHTML = `
    <label for="standings-view-select" style="color:#8b949e;font-size:0.85rem;white-space:nowrap;">View:</label>
    <select id="standings-view-select" style="${selectStyle}">
      ${options.map(o => `<option value="${o.value}"${_viewMode === o.value ? ' selected' : ''}>${o.label}</option>`).join('')}
    </select>`;

  document.getElementById('standings-view-select').addEventListener('change', e => {
    _viewMode = e.target.value;
    if (_standingsData) {
      document.getElementById('standings-root').innerHTML = buildStandingsHtml(_standingsData);
    }
  });
}

// ── Shared helper: insert playoff line based on rank map ──────────────────

function renderGroupRows(group, rankMap, cutoffN) {
  let rows = '';
  let inserted = false;
  group.forEach((t, i) => {
    if (cutoffN != null && !inserted) {
      const prevIn = i > 0 && rankMap[group[i - 1].id] <= cutoffN;
      const currOut = rankMap[t.id] > cutoffN;
      if ((i === 0 && currOut) || (prevIn && currOut)) {
        rows += PLAYOFF_LINE_ROW;
        inserted = true;
      }
    }
    rows += makeRow(t, rankMap[t.id]);
  });
  return rows;
}

function buildStandingsHtml(data) {
  if (!data) return '<p style="color:#8b949e">Select a season above to view standings.</p>';
  const teams = data.teams || data;   // handle both {teams,playoff_cutoff} and bare array
  const cutoff = data.playoff_cutoff ?? null;
  const confCutoffs = data.conf_cutoffs || {};
  const divCutoffs = data.div_cutoffs || {};

  if (!teams || teams.length === 0) return '<p style="color:#8b949e">No standings data for this season yet.</p>';

  const hasConf = teams.some(t => t.conference);
  const hasDiv  = teams.some(t => t.division);
  const thead = buildThead();

  // Update (or hide) the view selector
  updateViewSelector(hasConf, hasDiv);

  // Build a global pts-sort order to know each team's true league rank
  const globalOrder = sortTeams(teams, 'pts', 'desc');
  const globalRank = {};
  globalOrder.forEach((t, i) => { globalRank[t.id] = i + 1; });

  const effectiveView = (hasConf || hasDiv) ? (_viewMode || 'league') : 'league';

  // ── League view (flat list) ──────────────────────────────────────────────
  if (effectiveView === 'league') {
    const sorted = _sortCol === 'rank'
      ? [...globalOrder]
      : sortTeams(teams, _sortCol, _sortDir);
    const rows = renderGroupRows(sorted, globalRank, cutoff);
    return `<div style="overflow-x:auto;"><table>${thead}<tbody>${rows}</tbody></table></div>${clinchLegend(teams)}`;
  }

  // ── Conference view ──────────────────────────────────────────────────────
  if (effectiveView === 'conference') {
    const confMap = {};
    for (const t of teams) {
      const key = t.conference || 'Unassigned';
      if (!confMap[key]) confMap[key] = [];
      confMap[key].push(t);
    }
    let html = '';
    for (const conf of Object.keys(confMap).sort()) {
      html += `<div class="conference-block"><h3>${conf}${conf !== 'Unassigned' ? ' Conference' : ''}</h3>`;

      // Rank teams within this conference by pts
      const confOrder = sortTeams(confMap[conf], 'pts', 'desc');
      const confRank = {};
      confOrder.forEach((t, i) => { confRank[t.id] = i + 1; });

      const group = _sortCol === 'rank'
        ? confOrder
        : sortTeams(confMap[conf], _sortCol, _sortDir);

      // Use only the per-conference cutoff; never fall back to the league-wide cutoff
      // (conference standings qualify teams purely by conference placement, not league points)
      const effectiveCut = conf !== 'Unassigned' ? (confCutoffs[conf] ?? null) : null;

      html += `<div style="overflow-x:auto;"><table>${thead}<tbody>`;
      html += renderGroupRows(group, confRank, effectiveCut);
      html += '</tbody></table></div></div>';
    }
    html += clinchLegend(teams);
    return html;
  }

  // ── Division view ────────────────────────────────────────────────────────
  if (effectiveView === 'division') {
    const divMap = {};
    for (const t of teams) {
      const key = t.division || 'Unassigned';
      if (!divMap[key]) divMap[key] = [];
      divMap[key].push(t);
    }
    let html = '';
    for (const div of Object.keys(divMap).sort()) {
      html += `<div class="division-block"><h3>${div}${div !== 'Unassigned' ? ' Division' : ''}</h3>`;

      // Rank teams within this division by pts
      const divOrder = sortTeams(divMap[div], 'pts', 'desc');
      const divRank = {};
      divOrder.forEach((t, i) => { divRank[t.id] = i + 1; });

      const group = _sortCol === 'rank'
        ? divOrder
        : sortTeams(divMap[div], _sortCol, _sortDir);

      // Use only the per-division cutoff; never fall back to the league-wide cutoff
      const effectiveCut = div !== 'Unassigned' ? (divCutoffs[div] ?? null) : null;

      html += `<div style="overflow-x:auto;"><table>${thead}<tbody>`;
      html += renderGroupRows(group, divRank, effectiveCut);
      html += '</tbody></table></div></div>';
    }
    html += clinchLegend(teams);
    return html;
  }

  return '<p style="color:#8b949e">Unknown view mode.</p>';
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
    const vc = document.getElementById('standings-view-container');
    if (vc) vc.innerHTML = '';
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
