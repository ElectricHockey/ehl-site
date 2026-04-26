const API = '/api';

const RECENT_GAMES_COUNT = 6;
const MIN_SHOTS_FOR_SAVE_PCT = 10;
const STATS_LEADERS_COUNT = 5;

function hexToRgbStr(hex) {
  if (!hex || hex.length < 4) return null;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  h = h.padEnd(6, '0');
  return `${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`;
}

function pct3(v) {
  if (v === null || v === undefined) return '–';
  const num = Number(v);
  const frac = num > 1 ? num / 100 : num;
  return frac.toFixed(3).replace(/^0(?=\.)/, '');
}

// ── Recent Scores ───────────────────────────────────────────────────────────

async function loadRecentScores(seasonId, rootId) {
  const root = document.getElementById(rootId);
  if (!root) return;
  if (!seasonId) { root.innerHTML = '<p style="color:#8b949e;font-size:0.88rem;">No active season.</p>'; return; }
  try {
    const res = await fetch(`${API}/games?status=complete&season_id=${seasonId}&limit=${RECENT_GAMES_COUNT}`);
    if (!res.ok) { root.innerHTML = '<p style="color:#8b949e;font-size:0.88rem;">No games yet.</p>'; return; }
    const games = await res.json();
    if (!games.length) { root.innerHTML = '<p style="color:#8b949e;font-size:0.88rem;">No completed games yet.</p>'; return; }
    root.innerHTML = games.map(g => {
      const homeLogo = g.home_logo ? `<img src="${g.home_logo}" class="home-score-logo" />` : '';
      const awayLogo = g.away_logo ? `<img src="${g.away_logo}" class="home-score-logo" />` : '';
      const ot = g.is_overtime ? '<span class="home-ot-badge">OT</span>' : '';
      return `<a href="game.html?id=${g.id}" class="home-score-row">
        <span class="home-score-team">${homeLogo}${g.home_team_name}</span>
        <span class="home-score-nums"><strong>${g.home_score}</strong> – <strong>${g.away_score}</strong>${ot}</span>
        <span class="home-score-team home-score-away">${g.away_team_name}${awayLogo}</span>
        <span class="home-score-date">${g.date || ''}</span>
      </a>`;
    }).join('');
  } catch {
    root.innerHTML = '<p style="color:#8b949e;font-size:0.88rem;">Could not load scores.</p>';
  }
}

// ── Mini Standings ──────────────────────────────────────────────────────────

async function loadMiniStandings(seasonId, rootId) {
  const root = document.getElementById(rootId);
  if (!root) return;
  if (!seasonId) { root.innerHTML = '<p style="color:#8b949e;font-size:0.88rem;">No active season.</p>'; return; }
  try {
    const res = await fetch(`${API}/standings?season_id=${seasonId}`);
    if (!res.ok) { root.innerHTML = '<p style="color:#8b949e;font-size:0.88rem;">No standings yet.</p>'; return; }
    const data = await res.json();
    const teams = data.teams || data;   // handle both {teams,...} and bare array
    if (!teams || !teams.length) { root.innerHTML = '<p style="color:#8b949e;font-size:0.88rem;">No standings data yet.</p>'; return; }
    const sorted = [...teams].sort((a, b) => b.pts - a.pts || b.w - a.w).slice(0, 8);
    root.innerHTML = `<div style="overflow-x:auto;"><table class="home-standings-table">
      <thead><tr><th>Team</th><th>GP</th><th>W</th><th>L</th><th>OTL</th><th>PTS</th></tr></thead>
      <tbody>${sorted.map((t, i) => {
        const c1 = hexToRgbStr(t.color1);
        const c2 = hexToRgbStr(t.color2) || c1;
        const rowStyle = c1 ? ` class="team-row" style="--c1:${c1};--c2:${c2};"` : '';
        const logo = t.logo_url ? `<img src="${t.logo_url}" style="width:16px;height:16px;object-fit:contain;vertical-align:middle;margin-right:0.3rem;border-radius:2px;" />` : '';
        return `<tr${rowStyle}>
          <td>${logo}<a href="team.html?id=${t.id}" style="color:#58a6ff;text-decoration:none;">${t.name}</a></td>
          <td>${t.gp}</td><td>${t.w}</td><td>${t.l}</td>
          <td style="color:#8b949e;">${t.otl}</td>
          <td><strong>${t.pts}</strong></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <div style="margin-top:0.6rem;text-align:right;"><a href="standings.html" style="font-size:0.82rem;color:#58a6ff;">Full Standings →</a></div>`;
  } catch {
    root.innerHTML = '<p style="color:#8b949e;font-size:0.88rem;">Could not load standings.</p>';
  }
}

// ── Stats Leaders ───────────────────────────────────────────────────────────

function leaderRow(p, stat, fmtFn) {
  const logo = p.team_logo ? `<img src="${p.team_logo}" style="width:14px;height:14px;object-fit:contain;vertical-align:middle;margin-right:0.25rem;border-radius:2px;" />` : '';
  const val = fmtFn ? fmtFn(p[stat]) : (p[stat] ?? 0);
  return `<div class="home-leader-row">
    <span class="home-leader-name"><a href="player.html?name=${encodeURIComponent(p.name)}" style="color:#e6edf3;text-decoration:none;">${p.name}</a></span>
    <span class="home-leader-team">${logo}</span>
    <span class="home-leader-val">${val}</span>
  </div>`;
}

async function loadStatsLeaders(seasonId, rootId) {
  const root = document.getElementById(rootId);
  if (!root) return;
  if (!seasonId) { root.innerHTML = '<p style="color:#8b949e;font-size:0.88rem;">No active season.</p>'; return; }
  try {
    const res = await fetch(`${API}/stats/leaders?season_id=${seasonId}`);
    if (!res.ok) { root.innerHTML = '<p style="color:#8b949e;font-size:0.88rem;">No stats yet.</p>'; return; }
    const data = await res.json();
    const skaters = data.skaters || [];
    const goalies = data.goalies || [];
    if (!skaters.length && !goalies.length) {
      root.innerHTML = '<p style="color:#8b949e;font-size:0.88rem;">No stats recorded yet.</p>';
      return;
    }

    function topBy(arr, key, n = STATS_LEADERS_COUNT) {
      return [...arr].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0)).slice(0, n);
    }

    const sections = [];

    if (skaters.length) {
      const pts = topBy(skaters, 'points');
      const goals = topBy(skaters, 'goals');
      const assists = topBy(skaters, 'assists');
      sections.push(`<div class="home-leader-section">
        <div class="home-leader-title">🏒 Points Leaders</div>
        ${pts.map(p => leaderRow(p, 'points')).join('')}
        <div style="text-align:right;margin-top:0.4rem;"><a href="stats.html" style="font-size:0.78rem;color:#58a6ff;">All Stats →</a></div>
      </div>`);
      sections.push(`<div class="home-leader-section">
        <div class="home-leader-title">Goals Leaders</div>
        ${goals.map(p => leaderRow(p, 'goals')).join('')}
      </div>`);
      sections.push(`<div class="home-leader-section">
        <div class="home-leader-title">🎯 Assists Leaders</div>
        ${assists.map(p => leaderRow(p, 'assists')).join('')}
      </div>`);
    }

    if (goalies.length) {
      const svp = [...goalies]
        .filter(g => (g.shots_against || 0) >= MIN_SHOTS_FOR_SAVE_PCT)
        .sort((a, b) => (b.save_pct ?? 0) - (a.save_pct ?? 0))
        .slice(0, 5);
      if (svp.length) {
        sections.push(`<div class="home-leader-section">
          <div class="home-leader-title">🧤 Save % Leaders</div>
          ${svp.map(p => leaderRow(p, 'save_pct', pct3)).join('')}
        </div>`);
      }
    }

    root.innerHTML = `<div class="home-leaders-grid">${sections.join('')}</div>
      <div style="margin-top:0.6rem;text-align:right;"><a href="stats.html" style="font-size:0.82rem;color:#58a6ff;">Full Stats →</a></div>`;
  } catch {
    root.innerHTML = '<p style="color:#8b949e;font-size:0.88rem;">Could not load stats.</p>';
  }
}

// ── Bootstrap ───────────────────────────────────────────────────────────────

async function initHome() {
  // Load active seasons for both league types in parallel
  let threesSeasonId = null;
  let sixesSeasonId  = null;

  try {
    const [r3, r6] = await Promise.all([
      fetch(`${API}/seasons?type=threes`),
      fetch(`${API}/seasons?type=sixes`),
    ]);
    if (r3.ok) {
      const seasons3 = await r3.json();
      const active3 = seasons3.find(s => s.is_active) || seasons3[0];
      if (active3) threesSeasonId = active3.id;
    }
    if (r6.ok) {
      const seasons6 = await r6.json();
      const active6 = seasons6.find(s => s.is_active) || seasons6[0];
      if (active6) sixesSeasonId = active6.id;
    }
  } catch {}

  // If no 3's data available, hide that section
  const threesHeader = document.getElementById('home-threes-header');
  const threesPanel  = document.getElementById('home-panels-threes');
  if (!threesSeasonId && threesHeader && threesPanel) {
    threesPanel.innerHTML = '<p style="color:#8b949e;font-size:0.88rem;padding:0.5rem 0;">No active 3\'s season.</p>';
  }

  // If no 6's data available, hide that section
  const sixesHeader = document.getElementById('home-sixes-header');
  const sixesPanel  = document.getElementById('home-panels-sixes');
  if (!sixesSeasonId && sixesHeader && sixesPanel) {
    sixesPanel.innerHTML = '<p style="color:#8b949e;font-size:0.88rem;padding:0.5rem 0;">No active 6\'s season.</p>';
  }

  await Promise.all([
    loadRecentScores(threesSeasonId, 'home-recent-scores-threes'),
    loadMiniStandings(threesSeasonId, 'home-standings-threes'),
    loadStatsLeaders(threesSeasonId,  'home-leaders-threes'),
    loadRecentScores(sixesSeasonId,   'home-recent-scores-sixes'),
    loadMiniStandings(sixesSeasonId,  'home-standings-sixes'),
    loadStatsLeaders(sixesSeasonId,   'home-leaders-sixes'),
  ]);
}

initHome();
