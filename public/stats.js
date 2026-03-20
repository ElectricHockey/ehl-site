const API = '/api';

// ── Rating helpers ─────────────────────────────────────────────────────────

// Save percentage: display as hockey-standard decimal, e.g. .922
function pct3(v) {
  if (v === null || v === undefined) return '–';
  const frac = v > 1 ? v / 100 : v;
  return frac.toFixed(3).replace(/^0(?=\.)/, '');
}
// Stat percentage (fow%, shot%, pass%) with null guard, e.g. 47.3%
function fmtPct(v) { return v !== null && v !== undefined ? Number(v).toFixed(1) + '%' : '–'; }

// Compute a single OVR from the three EA sub-ratings (ignores zeros/nulls)
function computeOvr(p) {
  const vals = [p.offensive_rating, p.defensive_rating, p.team_play_rating]
    .map(Number).filter(v => v > 0);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

// Returns an inline style string that colour-codes a rating value 0-100
function ratingStyle(v) {
  if (!v || v <= 0) return 'color:#484f58;';
  if (v >= 90) return 'background:rgba(35,134,54,0.35);color:#2ea043;font-weight:700;';
  if (v >= 80) return 'background:rgba(35,134,54,0.28);color:#3fb950;font-weight:700;';
  if (v >= 70) return 'background:rgba(46,160,67,0.18);color:#56d364;font-weight:600;';
  if (v >= 60) return 'background:rgba(158,106,3,0.22);color:#e3b341;font-weight:600;';
  if (v >= 50) return 'background:rgba(188,76,0,0.22);color:#f0883e;';
  return 'background:rgba(248,81,73,0.18);color:#f85149;';
}
// OVR gets a slightly thicker border to stand out
function ovrStyle(v) {
  const base = ratingStyle(v);
  return base + 'outline:1px solid currentColor;border-radius:3px;';
}

function formatToi(s) {
  if (!s) return '0:00';
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

function hexToRgbStr(hex) {
  if (!hex || hex.length < 4) return null;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  h = h.padEnd(6, '0');
  return `${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`;
}
function playerRowAttrs(p) {
  const c1 = hexToRgbStr(p.team_color1);
  if (!c1) return '';
  const c2 = hexToRgbStr(p.team_color2) || c1;
  return ` class="team-row" style="--c1:${c1};--c2:${c2};"`;
}

function sortData(data, key, dir) {
  return [...data].sort((a, b) => {
    const av = a[key] ?? -Infinity, bv = b[key] ?? -Infinity;
    return dir === 'asc' ? av - bv : bv - av;
  });
}
function thClass(key, cur) {
  if (cur.key !== key) return 'sortable-th';
  return `sortable-th ${cur.dir === 'asc' ? 'sort-asc' : 'sort-desc'}`;
}
function fmt1(v) { return v !== null && v !== undefined ? Number(v).toFixed(1) : '–'; }

// ── Per-league data and sort state ─────────────────────────────────────────

const leagueData = {
  threes: { skaters: [], goalies: [] },
  sixes:  { skaters: [], goalies: [] },
};
const leagueSort = {
  threes: { skater: { key: 'points', dir: 'desc' }, goalie: { key: 'save_pct', dir: 'desc' } },
  sixes:  { skater: { key: 'points', dir: 'desc' }, goalie: { key: 'save_pct', dir: 'desc' } },
};

let statsSearchFilter = '';

function onStatsSearch(val) {
  statsSearchFilter = val.toLowerCase().trim();
  const league = (typeof SeasonSelector !== 'undefined' ? SeasonSelector.getSelectedLeagueType() : null) || 'threes';
  renderSkaters(league);
  renderGoalies(league);
}

function switchStatsTab(tab) {
  ['skaters', 'goalies'].forEach(t => {
    const sec = document.getElementById(`tab-${t}`);
    if (sec) sec.classList.toggle('active', t === tab);
  });
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tab === tab)
  );
}

function sortSkaters(key, league) {
  const cur = leagueSort[league].skater;
  leagueSort[league].skater = cur.key === key ? { key, dir: cur.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' };
  renderSkaters(league);
}

function sortGoalies(key, league) {
  const cur = leagueSort[league].goalie;
  leagueSort[league].goalie = cur.key === key ? { key, dir: cur.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' };
  renderGoalies(league);
}

function renderSkaters(league) {
  const root = document.getElementById('skaters-root');
  if (!root) return;
  const data = leagueData[league].skaters;
  if (data.length === 0) { root.innerHTML = '<p style="color:#8b949e">No skater stats yet for this season.</p>'; return; }
  data.forEach(p => { p._ovr = computeOvr(p); });
  const filtered = statsSearchFilter
    ? data.filter(p => (p.name || '').toLowerCase().includes(statsSearchFilter))
    : data;
  const sorted = sortData(filtered, leagueSort[league].skater.key, leagueSort[league].skater.dir);
  const s = k => thClass(k, leagueSort[league].skater);
  const prevScroll = root.firstElementChild?.scrollLeft || 0;
  root.innerHTML = `<div style="overflow-x:auto;"><table id="skaters-table">
    <thead><tr>
      <th>Player</th><th>Team</th><th>Pos</th>
      ${SKATER_COLS.map(c => `<th data-tip="${c.tip}" class="${s(c.key)}" onclick="sortSkaters('${c.key}','${league}')">${c.label}</th>`).join('')}
    </tr></thead>
    <tbody>${sorted.map(p => `<tr${playerRowAttrs(p)}>
      <td><a href="player.html?name=${encodeURIComponent(p.name)}" class="player-link">${p.name}</a></td>
      <td style="text-align:center;">${p.team_logo ? `<img src="${p.team_logo}" style="width:20px;height:20px;object-fit:contain;vertical-align:middle;border-radius:2px;" title="${p.team_name}" />` : '–'}</td>
      <td>${p.position || '–'}</td>.map(c => `<td style="${c.style ? c.style(p) : ''}">${c.fmt(p)}</td>`).join('')}
    </tr>`).join('')}</tbody>
  </table></div>`;
  if (root.firstElementChild && prevScroll) root.firstElementChild.scrollLeft = prevScroll;
}

function renderGoalies(league) {
  const root = document.getElementById('goalies-root');
  if (!root) return;
  const data = leagueData[league].goalies;
  if (data.length === 0) { root.innerHTML = '<p style="color:#8b949e">No goalie stats yet for this season.</p>'; return; }
  data.forEach(p => { p._ovr = computeOvr(p); });
  const filtered = statsSearchFilter
    ? data.filter(p => (p.name || '').toLowerCase().includes(statsSearchFilter))
    : data;
  const sorted = sortData(filtered, leagueSort[league].goalie.key, leagueSort[league].goalie.dir);
  const s = k => thClass(k, leagueSort[league].goalie);
  const prevScroll = root.firstElementChild?.scrollLeft || 0;
  root.innerHTML = `<div style="overflow-x:auto;"><table id="goalies-table">
    <thead><tr>
      <th>Player</th><th>Team</th>
      ${GOALIE_COLS.map(c => `<th data-tip="${c.tip}" class="${s(c.key)}" onclick="sortGoalies('${c.key}','${league}')">${c.label}</th>`).join('')}
    </tr></thead>
    <tbody>${sorted.map(p => `<tr${playerRowAttrs(p)}>
      <td><a href="player.html?name=${encodeURIComponent(p.name)}" class="player-link">${p.name}</a></td>
      <td style="text-align:center;">${p.team_logo ? `<img src="${p.team_logo}" style="width:20px;height:20px;object-fit:contain;vertical-align:middle;border-radius:2px;" title="${p.team_name}" />` : '–'}</td>
      ${GOALIE_COLS.map(c => `<td style="${c.style ? c.style(p) : ''}">${c.fmt(p)}</td>`).join('')}
    </tr>`).join('')}</tbody>
  </table></div>`;
  if (root.firstElementChild && prevScroll) root.firstElementChild.scrollLeft = prevScroll;
}

async function fetchLeagueStats(seasonId) {
  if (!seasonId) return { skaters: [], goalies: [] };
  try {
    const res = await fetch(`${API}/stats/leaders?season_id=${seasonId}`);
    if (!res.ok) return { skaters: [], goalies: [] };
    return await res.json();
  } catch { return { skaters: [], goalies: [] }; }
}

async function loadStats() {
  const sid    = typeof SeasonSelector !== 'undefined' ? SeasonSelector.getSelectedSeasonId()    : null;
  const league = (typeof SeasonSelector !== 'undefined' ? SeasonSelector.getSelectedLeagueType() : null) || 'threes';

  if (!sid) {
    document.getElementById('skaters-root').innerHTML = '<p style="color:#8b949e">Select a league and season above.</p>';
    document.getElementById('goalies-root').innerHTML = '';
    return;
  }

  const data = await fetchLeagueStats(sid);
  leagueData[league].skaters = data.skaters || [];
  leagueData[league].goalies = data.goalies || [];

  renderSkaters(league);
  renderGoalies(league);
}

if (typeof SeasonSelector !== 'undefined') {
  (async () => {
    await SeasonSelector.init('season-selector-container');
    SeasonSelector.onSeasonChange(() => loadStats());
    loadStats();
  })();
} else {
  loadStats();
}
