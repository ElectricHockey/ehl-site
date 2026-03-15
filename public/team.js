const API = '/api';

// ── Module-level sort state ────────────────────────────────────────────────
let _teamSkaterData = [];
let _teamGoalieData = [];
let _teamColors = null;
const teamSort = {
  skater: { key: 'points', dir: 'desc' },
  goalie: { key: 'save_pct', dir: 'desc' },
};

// ── Sort helpers ───────────────────────────────────────────────────────────
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

// ── Global sort callbacks (called from onclick in rendered HTML) ───────────
// Keys are derived from stats-config.js so they stay in sync automatically.
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

function formatToi(s) {
  if (!s) return '0:00';
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function fmt1(v) { return v !== null && v !== undefined ? Number(v).toFixed(1) : '–'; }
function fmtPct(v) { return v !== null && v !== undefined ? Number(v).toFixed(1) + '%' : '–'; }
function pct3(v) {
  if (v === null || v === undefined) return '–';
  const frac = v > 1 ? v / 100 : v;
  return frac.toFixed(3).replace(/^0(?=\.)/, '');
}
function resultBadge(r) {
  if (r === 'W') return '<span class="badge badge-win">W</span>';
  if (r === 'L') return '<span class="badge badge-loss">L</span>';
  return `<span class="badge badge-tie">${r}</span>`;
}

// ── Rating helpers ─────────────────────────────────────────────────────────
function computeOvr(p) {
  const vals = [p.overall_rating, p.defensive_rating, p.team_play_rating]
    .map(Number).filter(v => v > 0);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}
function ratingStyle(v) {
  if (!v || v <= 0) return 'color:#484f58;';
  if (v >= 90) return 'background:rgba(255,215,0,0.22);color:#ffd700;font-weight:700;';
  if (v >= 80) return 'background:rgba(35,134,54,0.28);color:#3fb950;font-weight:700;';
  if (v >= 70) return 'background:rgba(46,160,67,0.18);color:#56d364;font-weight:600;';
  if (v >= 60) return 'background:rgba(158,106,3,0.22);color:#e3b341;font-weight:600;';
  if (v >= 50) return 'background:rgba(188,76,0,0.22);color:#f0883e;';
  return 'background:rgba(248,81,73,0.18);color:#f85149;';
}
function ovrStyle(v) {
  return ratingStyle(v) + 'outline:1px solid currentColor;border-radius:3px;';
}

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
      <td><a href="player.html?name=${encodeURIComponent(p.name)}" class="player-link">${p.name}</a></td>
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
      <td><a href="player.html?name=${encodeURIComponent(p.name)}" class="player-link">${p.name}</a></td>
      ${GOALIE_COLS.map(c => `<td style="${c.style ? c.style(p) : ''}">${c.fmt(p)}</td>`).join('')}
    </tr>`).join('')}</tbody>
  </table></div>`;
}

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

async function loadTeamPage() {
  const root = document.getElementById('team-root');
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) { root.innerHTML = '<p class="error">No team ID. <a href="standings.html">Back to Standings</a></p>'; return; }

  try {
    const sid = typeof SeasonSelector !== 'undefined' ? SeasonSelector.getSelectedSeasonId() : null;
    const url = sid ? `${API}/teams/${id}/stats?season_id=${sid}` : `${API}/teams/${id}/stats`;
    const res = await fetch(url);
    if (!res.ok) { root.innerHTML = `<p class="error">${(await res.json().catch(()=>({}))).error || 'Team not found.'}</p>`; return; }

    const { team, roster, skaterStats, goalieStats, recentGames, staff } = await res.json();
    document.title = `${team.name} – EHL`;

    const owner = staff.find(s => s.role === 'owner');
    const gms   = staff.filter(s => s.role === 'gm');
    const logoHtml = team.logo_url
      ? `<img src="${team.logo_url}" style="width:64px;height:64px;object-fit:contain;border-radius:8px;background:#21262d;padding:4px;margin-right:1rem;vertical-align:middle;" />`
      : '';
    const c1 = hexToRgbStr(team.color1), c2 = hexToRgbStr(team.color2) || c1;
    const headerStyle = c1
      ? `background:linear-gradient(90deg,rgba(${c1},0.25) 0%,rgba(${c2||c1},0.10) 50%,transparent 100%);border-radius:8px;padding:0.75rem 1rem;`
      : '';

    let html = `
      <a href="standings.html" style="font-size:0.9rem;color:#8b949e;">← Back to Standings</a>
      <div style="${headerStyle}display:flex;align-items:center;margin-top:0.75rem;flex-wrap:wrap;gap:0.5rem;">
        ${logoHtml}
        <div>
          <h1 style="margin:0;">${team.name}</h1>
          ${[team.conference,team.division].filter(Boolean).join(' · ')
            ? `<p style="color:#8b949e;margin:0.1rem 0 0;">${[team.conference,team.division].filter(Boolean).join(' · ')}</p>` : ''}
          ${team.league_type ? `<span style="font-size:0.78rem;background:#21262d;color:#8b949e;border-radius:10px;padding:0.15rem 0.5rem;">${team.league_type === 'threes' ? '3v3' : team.league_type === 'sixes' ? '6v6' : team.league_type}</span>` : ''}
        </div>
      </div>`;

    // Staff block
    if (owner || gms.length > 0) {
      html += `<div style="margin:0.75rem 0;display:flex;gap:0.75rem;flex-wrap:wrap;align-items:center;">`;
      if (owner) html += `<span style="font-size:0.85rem;background:#1c2a3a;color:#58a6ff;border-radius:6px;padding:0.25rem 0.6rem;">👑 Owner: ${owner.username}</span>`;
      for (const gm of gms) html += `<span style="font-size:0.85rem;background:#21262d;color:#8b949e;border-radius:6px;padding:0.25rem 0.6rem;">📋 GM: ${gm.username}</span>`;
      html += `</div>`;
    }

    // Season selector
    html += `<div style="margin:0.75rem 0 0.5rem;" id="season-selector-container"></div>`;

    // Roster
    const rosterLimit = team.league_type === 'threes' ? 12 : team.league_type === 'sixes' ? 20 : null;
    html += `<h2>Roster${rosterLimit ? ` <span style="font-size:0.8rem;color:#8b949e;font-weight:400;">(${roster.length}/${rosterLimit})</span>` : ` <span style="font-size:0.8rem;color:#8b949e;font-weight:400;">(${roster.length})</span>`}</h2>`;
    if (roster.length === 0) {
      html += '<p class="no-stats">No rostered players.</p>';
    } else {
      // Sort roster: Forwards first (C, LW, RW), then Defence (LD, RD), then Goalies (G)
      const posOrder = { C: 0, LW: 1, RW: 2, LD: 3, RD: 4, G: 5 };
      const sorted = [...roster].sort((a, b) => {
        const pa = posOrder[a.position] ?? 6;
        const pb = posOrder[b.position] ?? 6;
        return pa !== pb ? pa - pb : (a.name || '').localeCompare(b.name || '');
      });
      html += `<div style="overflow-x:auto;margin-bottom:1rem;">
        <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
          <thead><tr style="font-size:0.75rem;color:#8b949e;border-bottom:2px solid #30363d;">
            <th style="padding:0.3rem 0.5rem;text-align:left;">#</th>
            <th style="padding:0.3rem 0.5rem;text-align:left;">Player</th>
            <th style="padding:0.3rem 0.5rem;text-align:left;">Position</th>
            <th style="padding:0.3rem 0.5rem;text-align:left;">Platform</th>
          </tr></thead>
          <tbody>
            ${sorted.map(p => `<tr style="border-bottom:1px solid #21262d;">
              <td style="padding:0.35rem 0.5rem;color:#8b949e;">${p.number != null && p.number !== '' ? '#' + p.number : '—'}</td>
              <td style="padding:0.35rem 0.5rem;"><a href="player.html?name=${encodeURIComponent(p.name)}" class="player-link">${p.name}</a></td>
              <td style="padding:0.35rem 0.5rem;">${p.position ? `<span style="font-size:0.75rem;background:#1f2d3d;color:#58a6ff;border-radius:4px;padding:0.1rem 0.4rem;border:1px solid #388bfd44;">${p.position}</span>` : '<span style="color:#484f58;">—</span>'}</td>
              <td style="padding:0.35rem 0.5rem;color:#8b949e;font-size:0.8rem;">${p.platform || '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    }

    // Stats
    _teamColors = team;
    _teamSkaterData = skaterStats.map(p => ({ ...p, _ovr: computeOvr(p) }));
    _teamGoalieData = goalieStats.map(p => ({ ...p, _ovr: computeOvr(p) }));
    html += `<h2>Season Stats – Skaters</h2><div id="team-skaters-root"></div>`;
    html += `<h2>Season Stats – Goalies</h2><div id="team-goalies-root"></div>`;

    // Recent results
    html += `<h2>Recent Results</h2>`;
    if (recentGames.length === 0) {
      html += '<p class="no-stats">No completed games yet.</p>';
    } else {
      html += '<div>';
      for (const g of recentGames) {
        const isHome = g.home_team_id === team.id;
        const opp = isHome ? g.away_team_name : g.home_team_name;
        const oppLogo = isHome ? g.away_logo : g.home_logo;
        const my = isHome ? g.home_score : g.away_score;
        const their = isHome ? g.away_score : g.home_score;
        const r = my > their ? 'W' : my < their ? 'L' : 'T';
        html += `<div class="recent-game">
          ${resultBadge(r)}
          <span class="rg-score">${my} – ${their}${g.is_overtime ? ' <small style="color:#e3b341;">OT</small>' : ''}</span>
          <span class="rg-opponent">
            ${oppLogo ? `<img src="${oppLogo}" style="width:20px;height:20px;object-fit:contain;vertical-align:middle;border-radius:3px;margin-right:0.3rem;" />` : ''}
            vs ${opp}
          </span>
          <span class="rg-date">${g.date}</span>
          <a href="schedule.html?g=${g.id}" style="font-size:0.82rem;">View Stats</a>
        </div>`;
      }
      html += '</div>';
    }

    root.innerHTML = html;

    document.getElementById('team-skaters-root').innerHTML = renderSkaterTable(_teamSkaterData);
    document.getElementById('team-goalies-root').innerHTML = renderGoalieTable(_teamGoalieData);

    if (typeof SeasonSelector !== 'undefined') {
      await SeasonSelector.init('season-selector-container');
      SeasonSelector.onSeasonChange(() => loadTeamPage());
    }
  } catch (err) {
    root.innerHTML = '<p class="error">Failed to load team data. Is the server running?</p>';
  }
}

loadTeamPage();
