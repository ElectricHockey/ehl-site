const API = '/api';

// ── Module-level state ────────────────────────────────────────────────────
let _teamSkaterData = [];
let _teamGoalieData = [];
let _teamColors = null;
let _teamAwards = null;
let _teamAwardsPromise = null;
let _teamActiveTab = 'stats';
let _teamId = null;
let _teamSeasons = null;          // seasons this team has played in (fetched once)
let _teamSelectedSeasonId = null; // currently selected season (null = all-time)
let _teamFilterType = null;       // null | 'regular' | 'playoff' (for all-time splits)
let _teamLeagueType = null;
let _teamLoadVersion = 0;
const teamSort = {
  skater: { key: 'points', dir: 'desc' },
  goalie: { key: 'save_pct', dir: 'desc' },
};

// ── Utility helpers ────────────────────────────────────────────────────────
function hexToRgbStr(hex) {
  if (!hex || hex.length < 4) return null;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  h = h.padEnd(6, '0');
  return `${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`;
}
function teamRowAttrs(t) {
  const c1 = hexToRgbStr(t && t.color1);
  if (!c1) return '';
  const c2 = hexToRgbStr(t && t.color2) || c1;
  return ` class="team-row" style="--c1:${c1};--c2:${c2};"`;
}
function formatToi(s) {
  if (!s) return '0:00';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
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
function resultBadge(r) {
  if (r === 'W') return '<span class="badge badge-win">W</span>';
  if (r === 'L') return '<span class="badge badge-loss">L</span>';
  return `<span class="badge badge-tie">${r}</span>`;
}
function computeOvr(p) {
  return p.overall_rating !== null && p.overall_rating !== undefined && Number(p.overall_rating_count) > 0
    ? Number(p.overall_rating) : null;
}
function ovrBadge(v) {
  if (!v || v <= 0) return '';
  const t = Math.max(0, Math.min(1, (v - 45) / (99 - 45)));
  const hue = Math.round(t * 120);
  const bgAlpha = (0.12 + t * 0.23).toFixed(2);
  const bgL = 22 + Math.round(t * 12);
  const textL = 58 + Math.round(t * 8);
  const bg = `hsla(${hue},90%,${bgL}%,${bgAlpha})`;
  const col = `hsl(${hue},90%,${textL}%)`;
  return `<span style="background:${bg};color:${col};font-weight:700;font-size:0.72rem;padding:0.1rem 0.4rem;border-radius:3px;outline:1px solid ${col};">${v}</span>`;
}
function pct3(v) {
  if (v === null || v === undefined) return '–';
  const num = Number(v);
  const frac = num > 1 ? num / 100 : num;
  return frac.toFixed(3).replace(/^0(?=\.)/, '');
}
function normalizeName(v) {
  return String(v || '').trim().toLowerCase();
}

// ── Sort callbacks ────────────────────────────────────────────────────────
const SKATER_SORT_KEYS = new Set(
  (typeof SKATER_COLS !== 'undefined' ? SKATER_COLS : []).map(c => c.key)
);
const GOALIE_SORT_KEYS = new Set(
  (typeof GOALIE_COLS !== 'undefined' ? GOALIE_COLS : []).map(c => c.key)
);

function sortTeamSkaters(key) {
  if (!SKATER_SORT_KEYS.has(key)) return;
  const cur = teamSort.skater;
  teamSort.skater = cur.key === key
    ? { key, dir: cur.dir === 'desc' ? 'asc' : 'desc' }
    : { key, dir: 'desc' };
  const el = document.getElementById('team-skaters-root');
  if (el) el.innerHTML = renderSkaterTable(_teamSkaterData);
}
function sortTeamGoalies(key) {
  if (!GOALIE_SORT_KEYS.has(key)) return;
  const cur = teamSort.goalie;
  teamSort.goalie = cur.key === key
    ? { key, dir: cur.dir === 'desc' ? 'asc' : 'desc' }
    : { key, dir: 'desc' };
  const el = document.getElementById('team-goalies-root');
  if (el) el.innerHTML = renderGoalieTable(_teamGoalieData);
}

// ── Stats tables ───────────────────────────────────────────────────────────
function renderSkaterTable(players) {
  if (!players || players.length === 0) return '<p class="no-stats">No skater stats yet.</p>';
  const cur = teamSort.skater;
  const s = k => thClass(k, cur);
  const attrs = teamRowAttrs(_teamColors);
  const sorted = sortData(players, cur.key, cur.dir);
  return `<div style="overflow-x:auto;"><table class="season-stats-table">
    <thead><tr>
      <th>Pos</th><th>Player</th>
      ${SKATER_COLS.map(c => `<th data-tip="${c.tip}" class="${s(c.key)}" onclick="sortTeamSkaters('${c.key}')">${c.label}</th>`).join('')}
    </tr></thead>
    <tbody>${sorted.map(p => `<tr${attrs}>
      <td>${p.position || '–'}</td>
      <td><a href="${teamPlayerHref(p.name)}" class="player-link">${p.name}</a></td>
      ${SKATER_COLS.map(c => `<td style="${c.style ? c.style(p) : ''}">${c.fmt(p)}</td>`).join('')}
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function renderGoalieTable(players) {
  if (!players || players.length === 0) return '<p class="no-stats">No goalie stats yet.</p>';
  const cur = teamSort.goalie;
  const s = k => thClass(k, cur);
  const attrs = teamRowAttrs(_teamColors);
  const sorted = sortData(players, cur.key, cur.dir);
  return `<div style="overflow-x:auto;"><table class="season-stats-table">
    <thead><tr>
      <th>Player</th>
      ${GOALIE_COLS.map(c => `<th data-tip="${c.tip}" class="${s(c.key)}" onclick="sortTeamGoalies('${c.key}')">${c.label}</th>`).join('')}
    </tr></thead>
    <tbody>${sorted.map(p => `<tr${attrs}>
      <td><a href="${teamPlayerHref(p.name)}" class="player-link">${p.name}</a></td>
      ${GOALIE_COLS.map(c => `<td style="${c.style ? c.style(p) : ''}">${c.fmt(p)}</td>`).join('')}
    </tr>`).join('')}</tbody>
  </table></div>`;
}

// ── Schedule widget ────────────────────────────────────────────────────────
function renderScheduleRow(g, team) {
  const isHome = g.home_team_id === team.id;
  const myScore  = isHome ? g.home_score : g.away_score;
  const oppScore = isHome ? g.away_score : g.home_score;
  const oppName  = isHome ? g.away_team_name : g.home_team_name;
  const oppLogo  = isHome ? g.away_logo : g.home_logo;
  const oppId    = isHome ? g.away_team_id : g.home_team_id;

  const isComplete = myScore !== null && myScore !== undefined && (g.status === 'complete' || g.status === 'forfeit');
  const winner = gameWinnerSide(g);
  const won  = isComplete && winner === (isHome ? 'home' : 'away');
  const lost = isComplete && winner === (isHome ? 'away' : 'home');

  const scoreColor = won ? '#3fb950' : lost ? '#f85149' : '#e6edf3';
  const resultBadge = won
    ? '<span class="badge badge-win">W</span>'
    : lost
      ? '<span class="badge badge-loss">L</span>'
      : '';

  const logoHtml = oppLogo
    ? `<img src="${oppLogo}" style="width:20px;height:20px;object-fit:contain;border-radius:3px;vertical-align:middle;margin-right:0.3rem;" />`
    : '';

  const haStr = isHome ? 'vs' : '@';

  const scoreHtml = isComplete
    ? `<span style="font-weight:700;color:${scoreColor};">${myScore}–${oppScore}</span>${g.is_overtime ? '<span style="font-size:0.65rem;color:#e3b341;margin-left:3px;">OT</span>' : ''}`
    : '<span style="color:#8b949e;">–</span>';

  const statusHtml = isComplete
    ? resultBadge
    : '<span class="status-badge status-scheduled" style="font-size:0.7rem;">Sched</span>';

  return `<tr onclick="window.location='game.html?id=${g.id}'" style="cursor:pointer;">
    <td style="color:#8b949e;white-space:nowrap;font-size:0.78rem;">${g.date || ''}</td>
    <td style="font-size:0.78rem;color:#8b949e;text-align:center;">${haStr}</td>
    <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
      <a href="team.html?id=${oppId}${_teamLeagueType ? `&league=${encodeURIComponent(_teamLeagueType)}` : ''}" style="display:flex;align-items:center;text-decoration:none;color:#c9d1d9;font-size:0.85rem;" onclick="event.stopPropagation()">
        ${logoHtml}${oppName}
      </a>
    </td>
    <td style="text-align:right;white-space:nowrap;">${scoreHtml}</td>
    <td style="text-align:right;">${statusHtml}</td>
  </tr>`;
}

// ── Team records table ─────────────────────────────────────────────────────
function renderRecordsTable(recs, mode) {
  const rows = [
    { label: 'Pts',          key: 'pts',         fmt: v => v !== null && v !== undefined ? v : '–' },
    { label: 'Goals',        key: 'goals',        fmt: v => v !== null && v !== undefined ? v : '–' },
    { label: 'Plus/Minus',   key: 'plus_minus',   fmt: v => v !== null && v !== undefined ? (v > 0 ? '+' + v : v) : '–' },
    { label: 'Save%',        key: 'save_pct',     fmt: v => pct3(v) },
    { label: 'GAA',          key: 'gaa',          fmt: v => v !== null && v !== undefined ? Number(v).toFixed(2) : '–' },
    { label: 'Goalie Wins',  key: 'goalie_wins',  fmt: v => v !== null && v !== undefined ? v : '–' },
  ];

  const tbody = rows.map(r => {
    const rec = recs[r.key];
    if (!rec || rec.value === null || rec.value === undefined) {
      return `<tr><td style="color:#8b949e;">${r.label}</td><td colspan="3" style="color:#484f58;">–</td></tr>`;
    }
    const gp = rec.gp ? `<span style="color:#8b949e;font-size:0.8rem;">GP ${rec.gp}</span>` : '';
    const season = mode === 'single' && rec.season_name
      ? `<span style="color:#8b949e;font-size:0.8rem;"> | Season: ${rec.season_name}</span>` : '';
    const nameLink = rec.name
      ? `<a href="${teamPlayerHref(rec.name)}" class="player-link">${rec.name}</a>`
      : '–';
    return `<tr>
      <td style="color:#8b949e;padding:0.4rem 0.5rem;">${r.label}</td>
      <td style="padding:0.4rem 0.5rem;">${nameLink}</td>
      <td style="padding:0.4rem 0.5rem;font-weight:700;color:#e3b341;">${r.fmt(rec.value)}</td>
      <td style="padding:0.4rem 0.5rem;">${gp}${season}</td>
    </tr>`;
  }).join('');

  return `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
    <thead><tr style="font-size:0.75rem;color:#8b949e;border-bottom:2px solid #30363d;">
      <th style="padding:0.3rem 0.5rem;text-align:left;">Record</th>
      <th style="padding:0.3rem 0.5rem;text-align:left;">Player</th>
      <th style="padding:0.3rem 0.5rem;text-align:left;">#</th>
      <th style="padding:0.3rem 0.5rem;text-align:left;"></th>
    </tr></thead>
    <tbody>${tbody}</tbody>
  </table></div>`;
}

// ── Records tab switcher (global callback) ─────────────────────────────────
let _recordsData = null;
let _recordsPromise = null;
function switchRecordsTab(mode) {
  if (!_recordsData) return;
  document.querySelectorAll('.rec-tab').forEach(b => {
    b.classList.toggle('rec-tab-active', b.dataset.mode === mode);
  });
  const panel = document.getElementById('records-panel');
  if (panel) panel.innerHTML = renderRecordsTable(_recordsData[mode === 'career' ? 'career' : 'single'], mode);
}

// ── Main ───────────────────────────────────────────────────────────────────
async function loadTeamPage() {
  const loadVersion = ++_teamLoadVersion;
  const root = document.getElementById('team-root');
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) { root.innerHTML = '<p class="error">No team ID. <a href="standings.html">Back to Standings</a></p>'; return; }
  _teamId = id;

  try {
    const sid = _teamSelectedSeasonId;
    let url;
    if (sid) {
      url = `${API}/teams/${id}/stats?season_id=${sid}`;
    } else if (_teamFilterType) {
      url = `${API}/teams/${id}/stats?filter_type=${_teamFilterType}`;
    } else {
      url = `${API}/teams/${id}/stats`;
    }
    if (_teamLeagueType) url += `${url.includes('?') ? '&' : '?'}league_type=${encodeURIComponent(_teamLeagueType)}`;
    if (!_recordsPromise) {
      const recordsLeague = _teamLeagueType ? `?league_type=${encodeURIComponent(_teamLeagueType)}` : '';
      _recordsPromise = fetch(`${API}/teams/${id}/records${recordsLeague}`)
        .then(response => {
          if (!response.ok) throw new Error(`Records request failed (${response.status})`);
          return response.json();
        })
        .catch(() => {
          _recordsPromise = null;
          return null;
        });
    }
    if (!_teamAwardsPromise) {
      _teamAwardsPromise = fetch(`${API}/teams/${id}/awards`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => { _teamAwardsPromise = null; return null; });
    }
    const [statsRes, recordsData, awardsData] = await Promise.all([
      fetch(url),
      _recordsPromise,
      _teamAwardsPromise,
    ]);
    if (loadVersion !== _teamLoadVersion) return;

    if (!statsRes.ok) {
      root.innerHTML = `<p class="error">${(await statsRes.json().catch(()=>({}))).error || 'Team not found.'}</p>`;
      return;
    }

    const { team, roster, skaterStats, goalieStats, recentGames, staff, record, transactions, upcoming } = await statsRes.json();
    if (loadVersion !== _teamLoadVersion) return;
    _recordsData = recordsData;
    document.title = `${team.name} – EHL`;

    _teamAwards = awardsData;
    _teamColors = team;
    _teamSkaterData = skaterStats.map(p => ({ ...p, _ovr: computeOvr(p) }));
    _teamGoalieData = goalieStats.map(p => ({ ...p, _ovr: computeOvr(p) }));

    const owner = staff.find(s => s.role === 'owner');
    const gms   = staff.filter(s => s.role === 'gm');
    const cpts  = staff.filter(s => s.role === 'captain');

    // ── BANNER HEADER ──
    const c1 = hexToRgbStr(team.color1), c2 = hexToRgbStr(team.color2) || c1;
    const bannerBg = c1
      ? `background: linear-gradient(135deg, rgba(${c1},0.55) 0%, rgba(${c2},0.30) 60%, rgba(13,17,23,0.0) 100%), #0d1117;`
      : 'background:#161b22;';
    const rec = record || { wins: 0, losses: 0, otl: 0 };
    const recStr = `${rec.wins || 0}-${rec.losses || 0}-${rec.otl || 0}`;
    const displayedLeague = _teamLeagueType || team.league_type;
    const leagueTag = displayedLeague === 'threes' ? '3v3' : displayedLeague === 'sixes' ? '6v6' : (displayedLeague || '');

    let html = `
      <div class="team-banner" style="${bannerBg}border-radius:10px;padding:1.25rem 1.5rem;margin-bottom:1.25rem;position:relative;overflow:hidden;">
        <div style="display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap;position:relative;z-index:1;">
          ${team.logo_url ? `<img src="${team.logo_url}" style="width:72px;height:72px;object-fit:contain;border-radius:10px;background:rgba(0,0,0,0.3);padding:6px;flex-shrink:0;" />` : ''}
          <div>
            <h1 style="margin:0;font-size:1.8rem;font-weight:800;">${team.name} <span style="font-size:1.1rem;font-weight:400;color:rgba(230,237,243,0.8);">(${recStr})</span></h1>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.4rem;align-items:center;">
              ${leagueTag ? `<span style="font-size:0.75rem;background:rgba(0,0,0,0.35);color:#8b949e;border-radius:10px;padding:0.15rem 0.55rem;border:1px solid #30363d;">${leagueTag}</span>` : ''}
              ${[team.conference, team.division].filter(Boolean).map(x => `<span style="font-size:0.75rem;color:#8b949e;">${x}</span>`).join('<span style="color:#484f58;">·</span>')}
              ${owner ? `<span style="font-size:0.75rem;background:rgba(56,139,253,0.15);color:#58a6ff;border-radius:6px;padding:0.15rem 0.5rem;border:1px solid rgba(56,139,253,0.25);">👑 ${owner.username}</span>` : ''}
              ${gms.map(g => `<span style="font-size:0.75rem;background:rgba(255,255,255,0.07);color:#8b949e;border-radius:6px;padding:0.15rem 0.5rem;border:1px solid #30363d;">📋 ${g.username}</span>`).join('')}
              ${cpts.map(g => `<span style="font-size:0.75rem;background:rgba(255,255,255,0.07);color:#8b949e;border-radius:6px;padding:0.15rem 0.5rem;border:1px solid #30363d;">© ${g.username}</span>`).join('')}
            </div>
          </div>
        </div>
        ${c1 ? `<div style="position:absolute;top:-30px;right:-20px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(${c1},0.18) 0%,transparent 70%);pointer-events:none;z-index:0;"></div>` : ''}
      </div>

      <div style="display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:1.25rem;align-items:start;" class="team-page-grid">
        <!-- LEFT: Roster + Stats -->
        <div style="min-width:0;overflow:hidden;">
          <div id="season-selector-container" style="margin-bottom:1rem;"></div>`;

    // ── ROSTER (grouped by position) ──
    const posOrder = { C: 0, LW: 1, RW: 2, LD: 3, RD: 4, G: 5 };
    const sorted = [...roster].sort((a, b) => {
      const pa = posOrder[a.position] ?? 6, pb = posOrder[b.position] ?? 6;
      return pa !== pb ? pa - pb : (a.name || '').localeCompare(b.name || '');
    });
    const rosterLimit = displayedLeague === 'threes' ? 12 : displayedLeague === 'sixes' ? 20 : null;

    // Build a map of player name → stats
    const statsMap = {};
    for (const p of skaterStats) statsMap[p.name] = p;
    for (const p of goalieStats) statsMap[p.name] = p;

    // Staff role map by name
    const staffRoles = {};
    for (const s of staff) {
      if (s.username) {
        if (!staffRoles[s.username]) staffRoles[s.username] = [];
        if (!staffRoles[s.username].includes(s.role)) staffRoles[s.username].push(s.role);
      }
    }
    for (const p of roster) {
      if (p.role && p.name) {
        if (!staffRoles[p.name]) staffRoles[p.name] = [];
        if (!staffRoles[p.name].includes(p.role)) staffRoles[p.name].push(p.role);
      }
    }

    function roleBadge(role) {
      if (role === 'owner') return `<span style="font-size:0.65rem;background:rgba(56,139,253,0.18);color:#58a6ff;border-radius:4px;padding:0.1rem 0.35rem;border:1px solid rgba(56,139,253,0.3);">Owner</span>`;
      if (role === 'gm')    return `<span style="font-size:0.65rem;background:rgba(35,134,54,0.18);color:#3fb950;border-radius:4px;padding:0.1rem 0.35rem;border:1px solid rgba(35,134,54,0.3);">GM</span>`;
      if (role === 'captain') return `<span style="font-size:0.65rem;background:rgba(188,76,0,0.18);color:#f0883e;border-radius:4px;padding:0.1rem 0.35rem;border:1px solid rgba(188,76,0,0.3);">CPT</span>`;
      return '';
    }

    const gm1 = gms[0] ? gms[0].username : 'N/A';
    const gm2 = gms[1] ? gms[1].username : 'N/A';
    const ownerName = owner ? owner.username : 'N/A';
    html += `
      <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:0.7rem 0.9rem;margin-bottom:0.85rem;">
        <div style="display:grid;grid-template-columns:1fr 1.2fr 1fr;gap:0.6rem;align-items:center;text-align:center;">
          <div>
            <div style="font-size:0.68rem;color:#8b949e;text-transform:uppercase;letter-spacing:0.06em;">GM</div>
            <div style="font-size:0.92rem;font-weight:700;color:#e6edf3;">${gm1}</div>
          </div>
          <div>
            <div style="font-size:0.68rem;color:#8b949e;text-transform:uppercase;letter-spacing:0.06em;">Owner</div>
            <div style="font-size:0.98rem;font-weight:800;color:#58a6ff;">${ownerName}</div>
          </div>
          <div>
            <div style="font-size:0.68rem;color:#8b949e;text-transform:uppercase;letter-spacing:0.06em;">GM</div>
            <div style="font-size:0.92rem;font-weight:700;color:#e6edf3;">${gm2}</div>
          </div>
        </div>
      </div>`;

    const rosterForDisplay = sorted;

    html += `<div id="team-stats-section">
      <h2 style="color:#58a6ff;margin-bottom:0.5rem;">Roster${rosterLimit ? ` <span style="font-size:0.8rem;color:#8b949e;font-weight:400;">(${rosterForDisplay.length}/${rosterLimit})</span>` : ''}</h2>`;

    if (rosterForDisplay.length === 0) {
      html += '<p class="no-stats" style="margin-bottom:1.25rem;">No rostered players.</p>';
    } else {
      html += `<div style="margin-bottom:1.25rem;">`;
      for (const p of rosterForDisplay) {
        const st = statsMap[p.name];
        const isGoalie = (p.position || '').toUpperCase() === 'G' || /goalie/i.test(p.position || '');
        const ovr = st ? computeOvr(st) : null;
        const roles = staffRoles[p.name] || (p.role ? [p.role] : []);
        const badges = roles.map(roleBadge).filter(Boolean).join(' ');
        let pRec = '';
        if (st) {
          const w = isGoalie ? ((st.goalie_wins || 0) + (st.goalie_otw || 0)) : (st.player_wins || 0);
          const l = isGoalie ? (st.goalie_losses || 0) : (st.player_losses || 0);
          const otl = isGoalie ? (st.goalie_otl || 0) : (st.player_otl || 0);
          pRec = `${w}-${l}-${otl}`;
        }

        html += `<div style="display:flex;align-items:center;gap:0.6rem;padding:0.35rem 0.5rem;border-radius:6px;border:1px solid #21262d;margin-bottom:4px;background:#0d1117;">
          <span style="font-size:0.72rem;color:#8b949e;min-width:22px;text-align:right;">${p.number != null && p.number !== '' ? '#' + p.number : ''}</span>
          <a href="${teamPlayerHref(p.name)}" class="player-link" style="font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.name}</a>
          ${p.position ? `<span style="font-size:0.68rem;background:#1f2d3d;color:#58a6ff;border-radius:4px;padding:0.1rem 0.35rem;border:1px solid rgba(56,139,253,0.2);">${p.position}</span>` : ''}
          ${badges}
          ${ovr ? ovrBadge(ovr) : ''}
          ${pRec ? `<span style="font-size:0.75rem;color:#8b949e;font-weight:600;margin-left:0.1rem;">${pRec}</span>` : ''}
        </div>`;
      }
      html += `</div>`;
    }

    // ── Season stats tabs ──
    html += `
      <div style="margin-top:1.25rem;">
        <h2 style="color:#58a6ff;margin-bottom:0.5rem;">Season Stats</h2>
        <div style="--team-tab-rgb:${teamTabColor()};display:flex;gap:0.5rem;margin-bottom:0.75rem;" id="stats-tab-btns">
          <button type="button" class="lt-tab lt-tab-active" aria-pressed="true" onclick="switchStatsTab('skaters')">Skaters</button>
          <button type="button" class="lt-tab" aria-pressed="false" onclick="switchStatsTab('goalies')">Goalies</button>
        </div>
        <div id="team-skaters-root"></div>
        <div id="team-goalies-root" style="display:none;"></div>
      </div>`;

    // ── Team Records ──
    if (_recordsData) {
      html += `
        <div style="margin-top:1.5rem;">
          <h2 style="color:#58a6ff;margin-bottom:0.5rem;">Team Records</h2>
          <div style="display:flex;gap:0;margin-bottom:0.75rem;border:1px solid #30363d;border-radius:6px;overflow:hidden;width:fit-content;">
            <button class="rec-tab rec-tab-active" data-mode="career" onclick="switchRecordsTab('career')" style="padding:0.35rem 0.9rem;font-size:0.85rem;background:#21262d;border:none;color:#e6edf3;cursor:pointer;">Career</button>
            <button class="rec-tab" data-mode="single" onclick="switchRecordsTab('single')" style="padding:0.35rem 0.9rem;font-size:0.85rem;background:transparent;border:none;color:#8b949e;cursor:pointer;">Single Season</button>
          </div>
          <div id="records-panel">${renderRecordsTable(_recordsData.career, 'career')}</div>
        </div>`;
    }

    html += `</div>`;

    // ── Awards Panel ──
    html += `
      <div id="team-awards-panel" style="display:${_teamActiveTab === 'awards' ? 'block' : 'none'};margin-top:1.5rem;">
        <h2 style="color:#58a6ff;margin-bottom:0.75rem;">Awards</h2>
        <div id="team-awards-root">${renderTeamAwards()}</div>
      </div>`;

    html += `</div><!-- end left -->

        <!-- RIGHT: Schedule + News -->
        <div style="min-width:0;">`;

    // ── Schedule widget ──
    const allGames = [...recentGames, ...(upcoming || [])].sort((a, b) => {
      if (!a.date) return 1; if (!b.date) return -1;
      return new Date(a.date) - new Date(b.date);
    });
    // Show last 4 completed + up to 4 upcoming
    const completed = recentGames.slice(0, 8);

    const scheduleRows = [
      ...completed.map(g => renderScheduleRow(g, team)),
      ...(upcoming || []).slice(0, 4).map(g => renderScheduleRow(g, team)),
    ].join('');

    html += `<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1rem;margin-bottom:1rem;">
      <h3 style="color:#58a6ff;margin:0 0 0.75rem;font-size:1rem;">Schedule</h3>
      <div style="overflow-x:auto;">
        <table style="width:100%;min-width:320px;border-collapse:collapse;margin-top:0;font-size:0.85rem;">
          <tbody>${scheduleRows}</tbody>
        </table>
      </div>
      <a href="schedule.html${_teamLeagueType ? `?league=${encodeURIComponent(_teamLeagueType)}` : ''}" style="display:block;margin-top:0.75rem;font-size:0.82rem;color:#8b949e;text-align:center;">Full Schedule</a>
    </div>`;

    // ── Latest News (transactions) ──
    html += `<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1rem;">
      <h3 style="color:#58a6ff;margin:0 0 0.75rem;font-size:1rem;">Latest News (all leagues)</h3>`;

    if (!transactions || transactions.length === 0) {
      html += '<p style="color:#8b949e;font-size:0.85rem;padding:0.5rem 0;">No transactions on record.</p>';
    } else {
      for (const tx of transactions) {
        const dt = tx.created_at
          ? new Date(tx.created_at).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })
          : '';
        html += `<div style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.5rem 0;border-bottom:1px solid #21262d;">
          ${team.logo_url ? `<img src="${team.logo_url}" style="width:22px;height:22px;object-fit:contain;border-radius:3px;flex-shrink:0;margin-top:1px;" />` : ''}
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.82rem;color:#c9d1d9;line-height:1.4;">
              The <img src="${team.logo_url || ''}" style="width:14px;height:14px;object-fit:contain;vertical-align:middle;border-radius:2px;" /> ${team.name} have signed
              <a href="${teamPlayerHref(tx.player_name)}" class="player-link" style="color:#3fb950;">${tx.player_name}</a>
            </div>
            <div style="font-size:0.72rem;color:#8b949e;margin-top:2px;">${dt}</div>
          </div>
        </div>`;
      }
    }

    html += `</div><!-- end news -->
        </div><!-- end right -->
      </div><!-- end grid -->`;

    root.innerHTML = html;

    document.getElementById('team-skaters-root').innerHTML = renderSkaterTable(_teamSkaterData);
    document.getElementById('team-goalies-root').innerHTML = renderGoalieTable(_teamGoalieData);

    renderTeamSeasonSelector();
  } catch (err) {
    if (loadVersion !== _teamLoadVersion) return;
    console.error(err);
    root.innerHTML = '<p class="error">Failed to load team data. Is the server running?</p>';
  }
}

function teamTabColor() {
  return _teamColors && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(_teamColors.color1 || '')
    ? hexToRgbStr(_teamColors.color1)
    : '88,166,255';
}

// ── Team season selector (styled to match standings dropdown) ─────────────
function renderTeamSeasonSelector() {
  const container = document.getElementById('season-selector-container');
  if (!container || !_teamSeasons) return;
  if (_teamSeasons.length === 0) { container.innerHTML = ''; return; }

  // Determine currently selected value
  let selectedVal;
  if (_teamSelectedSeasonId != null) {
    selectedVal = String(_teamSelectedSeasonId);
  } else if (_teamFilterType === 'playoff') {
    selectedVal = 'alltime_playoff';
  } else {
    selectedVal = 'alltime_regular';
  }

  const sel = v => v === selectedVal ? 'selected' : '';
  const allTimeOpts =
    `<option value="alltime_regular" ${sel('alltime_regular')}>★ All Time – Regular Season</option>` +
    `<option value="alltime_playoff" ${sel('alltime_playoff')}>★ All Time – Playoffs</option>`;
  const opts = _teamSeasons.filter(s => !_teamLeagueType || s.league_type === _teamLeagueType).map(s => {
    const v = String(s.id);
    return `<option value="${v}" ${sel(v)}>${s.name}${s.is_active ? ' ★' : ''}</option>`;
  }).join('');

  const leagues = ['threes', 'sixes'].filter(type => _teamSeasons.some(s => s.league_type === type));
  const leagueTabs = leagues.length > 1
    ? `<div style="display:flex;gap:0.5rem;">${leagues.map(type => `<button type="button" class="team-league-tab lt-tab${_teamLeagueType === type ? ' lt-tab-active' : ''}" aria-pressed="${_teamLeagueType === type}" onclick="switchTeamLeague('${type}')">${type === 'threes' ? "3's" : "6's"}</button>`).join('')}</div>`
    : '';
  const teamColor = teamTabColor();
  container.innerHTML = `<div class="league-tabs-row" style="--team-tab-rgb:${teamColor};display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">${leagueTabs}<div class="league-tab-season">
    <label for="team-season-select" style="color:#8b949e;font-size:0.85rem;white-space:nowrap;">Season:</label>
    <select id="team-season-select">${allTimeOpts}${opts}</select>
  </div><div style="display:flex;gap:0.5rem;align-items:center;"><button type="button" class="lt-tab team-view-tab${_teamActiveTab === 'stats' ? ' lt-tab-active' : ''}" aria-pressed="${_teamActiveTab === 'stats'}" onclick="switchTeamTab('stats')">Stats</button><button type="button" class="lt-tab team-view-tab${_teamActiveTab === 'awards' ? ' lt-tab-active' : ''}" aria-pressed="${_teamActiveTab === 'awards'}" onclick="switchTeamTab('awards')">🏆 Awards</button></div></div>`;

  document.getElementById('team-season-select').addEventListener('change', function() {
    const val = this.value;
    if (val === 'alltime_regular') {
      _teamSelectedSeasonId = null;
      _teamFilterType = 'regular';
    } else if (val === 'alltime_playoff') {
      _teamSelectedSeasonId = null;
      _teamFilterType = 'playoff';
    } else {
      _teamSelectedSeasonId = Number(val);
      _teamFilterType = null;
    }
    loadTeamPage();
  });
}

// ── Team awards renderer ───────────────────────────────────────────
function renderTeamAwards() {
  if (!_teamAwards) return '<p style="color:#8b949e;padding:1rem 0;">Loading awards…</p>';
  const playerAwards = (_teamAwards.playerAwards || []).filter(a => !_teamLeagueType || a.league_type === _teamLeagueType);
  const teamAwards = (_teamAwards.teamAwards || []).filter(a => !_teamLeagueType || a.league_type === _teamLeagueType);
  if (playerAwards.length === 0 && teamAwards.length === 0)
    return '<p style="color:#8b949e;padding:1.5rem 0;">No awards on file for this team.</p>';

  // Group all awards by season
  const bySeason = {};
  for (const a of teamAwards) {
    const k = a.season_id;
    if (!bySeason[k]) bySeason[k] = { season_name: a.season_name, sort_order: a.sort_order, items: [] };
    bySeason[k].items.push({ type: 'team', ...a });
  }
  for (const a of playerAwards) {
    const k = a.season_id;
    if (!bySeason[k]) bySeason[k] = { season_name: a.season_name, sort_order: a.sort_order, items: [] };
    bySeason[k].items.push({ type: 'player', ...a });
  }

  const seasons = Object.values(bySeason).sort((a, b) => a.sort_order - b.sort_order);

  return seasons.map(s => {
    const itemsHtml = s.items.map(a => {
      const img = a.award_image_url
        ? `<img src="${a.award_image_url}" style="width:36px;height:36px;object-fit:contain;border-radius:4px;background:#21262d;flex-shrink:0;" alt="" />`
        : `<div style="width:36px;height:36px;flex-shrink:0;background:#21262d;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">${a.type === 'team' ? '🏆' : '🥇'}</div>`;
      const playerLink = a.type === 'player' && a.player_name
        ? `<div style="font-size:0.74rem;"><a href="${teamPlayerHref(a.player_name, a.season_id)}" style="color:#58a6ff;text-decoration:none;">${a.player_name}</a></div>`
        : '';
      const notes = a.notes ? `<div style="font-size:0.74rem;color:#8b949e;">${a.notes}</div>` : '';
      return `<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:0.6rem 0.8rem;display:flex;align-items:center;gap:0.6rem;min-width:160px;max-width:240px;">
        ${img}
        <div>
          <div style="font-weight:700;font-size:0.85rem;color:#e6edf3;line-height:1.2;">${a.award_name}</div>
          ${playerLink}
          ${notes}
        </div>
      </div>`;
    }).join('');
    return `<h3 style="font-size:0.88rem;text-transform:uppercase;letter-spacing:0.08em;color:#8b949e;margin:1.25rem 0 0.6rem;">${s.season_name}</h3>
    <div style="display:flex;flex-wrap:wrap;gap:0.75rem;">${itemsHtml}</div>`;
  }).join('');
}

// ── Stats / Awards tab switcher ───────────────────────────────────────
function switchTeamTab(tab) {
  _teamActiveTab = tab;
  const awardsPanel = document.getElementById('team-awards-panel');
  const statsSection = document.getElementById('team-stats-section');
  const awardsRoot = document.getElementById('team-awards-root');
  if (awardsPanel) awardsPanel.style.display = tab === 'awards' ? 'block' : 'none';
  if (statsSection) statsSection.style.display = tab === 'stats' ? '' : 'none';
  // Update tab button active states
  document.querySelectorAll('#season-selector-container .team-view-tab').forEach(b => {
    const isStats = b.textContent.trim() === 'Stats';
    const isAwards = b.textContent.includes('Awards');
    const active = (tab === 'stats' && isStats) || (tab === 'awards' && isAwards);
    b.classList.toggle('lt-tab-active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  if (tab === 'awards' && awardsRoot) awardsRoot.innerHTML = renderTeamAwards();
}

// Stats tab switcher
function switchStatsTab(tab) {
  const skatersRoot = document.getElementById('team-skaters-root');
  const goaliesRoot = document.getElementById('team-goalies-root');
  document.querySelectorAll('#stats-tab-btns .lt-tab').forEach((b, i) => {
    const isActive = (tab === 'skaters' && i === 0) || (tab === 'goalies' && i === 1);
    b.classList.toggle('lt-tab-active', isActive);
    b.setAttribute('aria-pressed', String(isActive));
  });
  if (skatersRoot) skatersRoot.style.display = tab === 'skaters' ? '' : 'none';
  if (goaliesRoot) goaliesRoot.style.display = tab === 'goalies' ? '' : 'none';
}

// ── Entry point ───────────────────────────────────────────────────────────
async function initTeamPage() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('tab') === 'awards') _teamActiveTab = 'awards';
  const id = params.get('id');
  if (!id) return loadTeamPage(); // let loadTeamPage handle the error

  // Fetch the seasons this team has actually played in
  try {
    const res = await fetch(`${API}/teams/${id}/seasons`);
    _teamSeasons = res.ok ? await res.json() : [];
  } catch { _teamSeasons = []; }

  const requestedSeason = _teamSeasons.find(s => s.id === Number(params.get('season_id')));
  const requestedLeague = params.get('league');
  const leagues = _teamSeasons.map(s => s.league_type).filter(type => type === 'threes' || type === 'sixes');
  _teamLeagueType = requestedSeason?.league_type ||
    (leagues.includes(requestedLeague) ? requestedLeague : null) ||
    (leagues.includes(localStorage.getItem('ehl_league_type')) ? localStorage.getItem('ehl_league_type') : null) ||
    leagues[0] || null;
  selectDefaultTeamSeason(requestedSeason);
  loadTeamPage();
}

function selectDefaultTeamSeason(requestedSeason) {
  const seasons = _teamSeasons.filter(s => !_teamLeagueType || s.league_type === _teamLeagueType);
  const selected = requestedSeason || seasons.find(s => s.is_active && !s.is_playoff) || seasons[0];
  _teamSelectedSeasonId = selected ? selected.id : null;
  _teamFilterType = selected ? null : 'regular';
}

function switchTeamLeague(type) {
  if (type === _teamLeagueType || !_teamSeasons.some(s => s.league_type === type)) return;
  const url = new URL(window.location.href);
  url.searchParams.set('league', type);
  url.searchParams.delete('season_id');
  if (_teamActiveTab === 'awards') url.searchParams.set('tab', 'awards');
  else url.searchParams.delete('tab');
  window.location.href = url.href;
}

function teamPlayerHref(name, seasonId = _teamSelectedSeasonId) {
  const params = new URLSearchParams({ name });
  if (_teamLeagueType) params.set('league', _teamLeagueType);
  if (seasonId) params.set('season_id', seasonId);
  return `player.html?${params}`;
}

initTeamPage();
