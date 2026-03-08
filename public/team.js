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
const SKATER_SORT_KEYS = new Set([
  '_ovr','overall_rating','defensive_rating','team_play_rating',
  'gp','goals','assists','points','plus_minus','shots','hits','blocked_shots',
  'takeaways','giveaways','pp_goals','sh_goals','gwg','pim','penalties_drawn',
  'faceoff_wins','faceoff_total','fow_pct','shot_pct','deflections','interceptions',
  'pass_attempts','pass_pct_calc','hat_tricks','apt','toi',
]);
const GOALIE_SORT_KEYS = new Set([
  '_ovr','overall_rating','defensive_rating','team_play_rating',
  'gp','goals','assists','shots_against','goals_against','save_pct','gaa','toi',
  'shutouts','penalty_shot_attempts','penalty_shot_ga','breakaway_shots','breakaway_saves',
  'goalie_wins','goalie_losses','goalie_otw','goalie_otl',
]);

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
      <th data-tip="Overall Rating (avg. of OR + DR + TPR)" class="${s('_ovr')}" onclick="sortTeamSkaters('_ovr')">OVR</th>
      <th data-tip="Offense Rating" class="${s('overall_rating')}" onclick="sortTeamSkaters('overall_rating')">OR</th>
      <th data-tip="Defense Rating" class="${s('defensive_rating')}" onclick="sortTeamSkaters('defensive_rating')">DR</th>
      <th data-tip="Team Play Rating" class="${s('team_play_rating')}" onclick="sortTeamSkaters('team_play_rating')">TPR</th>
      <th data-tip="Games Played" class="${s('gp')}" onclick="sortTeamSkaters('gp')">GP</th>
      <th data-tip="Goals" class="${s('goals')}" onclick="sortTeamSkaters('goals')">G</th>
      <th data-tip="Assists" class="${s('assists')}" onclick="sortTeamSkaters('assists')">A</th>
      <th data-tip="Points" class="${s('points')}" onclick="sortTeamSkaters('points')">PTS</th>
      <th data-tip="Plus / Minus" class="${s('plus_minus')}" onclick="sortTeamSkaters('plus_minus')">+/-</th>
      <th data-tip="Shots on Goal" class="${s('shots')}" onclick="sortTeamSkaters('shots')">SOG</th>
      <th data-tip="Hits" class="${s('hits')}" onclick="sortTeamSkaters('hits')">HITS</th>
      <th data-tip="Blocked Shots" class="${s('blocked_shots')}" onclick="sortTeamSkaters('blocked_shots')">BS</th>
      <th data-tip="Takeaways" class="${s('takeaways')}" onclick="sortTeamSkaters('takeaways')">TKA</th>
      <th data-tip="Giveaways" class="${s('giveaways')}" onclick="sortTeamSkaters('giveaways')">GVA</th>
      <th data-tip="Power Play Goals" class="${s('pp_goals')}" onclick="sortTeamSkaters('pp_goals')">PPG</th>
      <th data-tip="Short-Hand Goals" class="${s('sh_goals')}" onclick="sortTeamSkaters('sh_goals')">SHG</th>
      <th data-tip="Game-Winning Goals" class="${s('gwg')}" onclick="sortTeamSkaters('gwg')">GWG</th>
      <th data-tip="Penalty Minutes" class="${s('pim')}" onclick="sortTeamSkaters('pim')">PIM</th>
      <th data-tip="Penalties Drawn" class="${s('penalties_drawn')}" onclick="sortTeamSkaters('penalties_drawn')">PD</th>
      <th data-tip="Faceoff Wins" class="${s('faceoff_wins')}" onclick="sortTeamSkaters('faceoff_wins')">FOW</th>
      <th data-tip="Faceoff Total" class="${s('faceoff_total')}" onclick="sortTeamSkaters('faceoff_total')">FOT</th>
      <th data-tip="Faceoff Win %" class="${s('fow_pct')}" onclick="sortTeamSkaters('fow_pct')">FOW%</th>
      <th data-tip="Shooting %" class="${s('shot_pct')}" onclick="sortTeamSkaters('shot_pct')">S%</th>
      <th data-tip="Deflections" class="${s('deflections')}" onclick="sortTeamSkaters('deflections')">DLF</th>
      <th data-tip="Interceptions" class="${s('interceptions')}" onclick="sortTeamSkaters('interceptions')">INT</th>
      <th data-tip="Pass Attempts" class="${s('pass_attempts')}" onclick="sortTeamSkaters('pass_attempts')">PA</th>
      <th data-tip="Pass Completion %" class="${s('pass_pct_calc')}" onclick="sortTeamSkaters('pass_pct_calc')">PC%</th>
      <th data-tip="Hat Tricks" class="${s('hat_tricks')}" onclick="sortTeamSkaters('hat_tricks')">HT</th>
      <th data-tip="Avg. Puck Possession (sec/game)" class="${s('apt')}" onclick="sortTeamSkaters('apt')">APT</th>
      <th data-tip="Time on Ice" class="${s('toi')}" onclick="sortTeamSkaters('toi')">TOI</th>
    </tr></thead>
    <tbody>${sorted.map(p => {
      return `<tr${attrs}>
      <td>${p.position||'–'}</td>
      <td><a href="player.html?name=${encodeURIComponent(p.name)}" class="player-link">${p.name}</a></td>
      <td style="text-align:center;${ovrStyle(p._ovr)}">${p._ovr ?? '–'}</td>
      <td style="text-align:center;${ratingStyle(p.overall_rating)}">${p.overall_rating||'–'}</td>
      <td style="text-align:center;${ratingStyle(p.defensive_rating)}">${p.defensive_rating||'–'}</td>
      <td style="text-align:center;${ratingStyle(p.team_play_rating)}">${p.team_play_rating||'–'}</td>
      <td>${p.gp}</td><td>${p.goals}</td><td>${p.assists}</td>
      <td><strong>${p.points}</strong></td>
      <td>${p.plus_minus >= 0 ? '+' : ''}${p.plus_minus}</td>
      <td>${p.shots}</td><td>${p.hits}</td><td>${p.blocked_shots}</td>
      <td>${p.takeaways}</td><td>${p.giveaways}</td>
      <td>${p.pp_goals}</td><td>${p.sh_goals}</td><td>${p.gwg||0}</td>
      <td>${p.pim}</td><td>${p.penalties_drawn||0}</td>
      <td>${p.faceoff_wins||0}</td><td>${p.faceoff_total||0}</td>
      <td>${fmtPct(p.fow_pct)}</td><td>${fmtPct(p.shot_pct)}</td>
      <td>${p.deflections||0}</td><td>${p.interceptions||0}</td>
      <td>${p.pass_attempts||0}</td><td>${p.pass_pct_calc !== null && p.pass_pct_calc !== undefined ? fmt1(p.pass_pct_calc)+'%' : '–'}</td>
      <td>${p.hat_tricks||0}</td>
      <td>${formatToi(p.apt)}</td><td>${formatToi(p.toi)}</td>
    </tr>`;
    }).join('')}</tbody>
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
      <th data-tip="Overall Rating (avg. of OR + DR + TPR)" class="${s('_ovr')}" onclick="sortTeamGoalies('_ovr')">OVR</th>
      <th data-tip="Offense Rating" class="${s('overall_rating')}" onclick="sortTeamGoalies('overall_rating')">OR</th>
      <th data-tip="Defense Rating" class="${s('defensive_rating')}" onclick="sortTeamGoalies('defensive_rating')">DR</th>
      <th data-tip="Team Play Rating" class="${s('team_play_rating')}" onclick="sortTeamGoalies('team_play_rating')">TPR</th>
      <th data-tip="Games Played" class="${s('gp')}" onclick="sortTeamGoalies('gp')">GP</th>
      <th data-tip="Goals" class="${s('goals')}" onclick="sortTeamGoalies('goals')">G</th>
      <th data-tip="Assists" class="${s('assists')}" onclick="sortTeamGoalies('assists')">A</th>
      <th data-tip="Shots Against" class="${s('shots_against')}" onclick="sortTeamGoalies('shots_against')">SA</th>
      <th data-tip="Goals Against" class="${s('goals_against')}" onclick="sortTeamGoalies('goals_against')">GA</th>
      <th data-tip="Save Percentage" class="${s('save_pct')}" onclick="sortTeamGoalies('save_pct')">SV%</th>
      <th data-tip="Goals Against Average" class="${s('gaa')}" onclick="sortTeamGoalies('gaa')">GAA</th>
      <th data-tip="Time on Ice" class="${s('toi')}" onclick="sortTeamGoalies('toi')">TOI</th>
      <th data-tip="Shutouts" class="${s('shutouts')}" onclick="sortTeamGoalies('shutouts')">SO</th>
      <th data-tip="Penalty Shot Attempts Against" class="${s('penalty_shot_attempts')}" onclick="sortTeamGoalies('penalty_shot_attempts')">PSA</th>
      <th data-tip="Penalty Shot Goals Against" class="${s('penalty_shot_ga')}" onclick="sortTeamGoalies('penalty_shot_ga')">PSGA</th>
      <th data-tip="Breakaway Shots Against" class="${s('breakaway_shots')}" onclick="sortTeamGoalies('breakaway_shots')">BKSA</th>
      <th data-tip="Breakaway Saves" class="${s('breakaway_saves')}" onclick="sortTeamGoalies('breakaway_saves')">BKSV</th>
      <th data-tip="Wins" class="${s('goalie_wins')}" onclick="sortTeamGoalies('goalie_wins')">W</th>
      <th data-tip="Losses" class="${s('goalie_losses')}" onclick="sortTeamGoalies('goalie_losses')">L</th>
      <th data-tip="Overtime Wins" class="${s('goalie_otw')}" onclick="sortTeamGoalies('goalie_otw')">OTW</th>
      <th data-tip="Overtime Losses" class="${s('goalie_otl')}" onclick="sortTeamGoalies('goalie_otl')">OTL</th>
    </tr></thead>
    <tbody>${sorted.map(p => {
      return `<tr${attrs}>
      <td><a href="player.html?name=${encodeURIComponent(p.name)}" class="player-link">${p.name}</a></td>
      <td style="text-align:center;${ovrStyle(p._ovr)}">${p._ovr ?? '–'}</td>
      <td style="text-align:center;${ratingStyle(p.overall_rating)}">${p.overall_rating||'–'}</td>
      <td style="text-align:center;${ratingStyle(p.defensive_rating)}">${p.defensive_rating||'–'}</td>
      <td style="text-align:center;${ratingStyle(p.team_play_rating)}">${p.team_play_rating||'–'}</td>
      <td>${p.gp}</td><td>${p.goals||0}</td><td>${p.assists||0}</td>
      <td>${p.shots_against}</td><td>${p.goals_against}</td>
      <td><strong>${pct3(p.save_pct)}</strong></td>
      <td>${p.gaa !== null && p.gaa !== undefined ? Number(p.gaa).toFixed(2) : '–'}</td>
      <td>${formatToi(p.toi)}</td>
      <td>${p.shutouts||0}</td>
      <td>${p.penalty_shot_attempts||0}</td>
      <td>${p.penalty_shot_ga||0}</td>
      <td>${p.breakaway_shots||0}</td>
      <td>${p.breakaway_saves||0}</td>
      <td>${p.goalie_wins||0}</td><td>${p.goalie_losses||0}</td>
      <td>${p.goalie_otw||0}</td><td>${p.goalie_otl||0}</td>
    </tr>`;
    }).join('')}</tbody>
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
      html += `<div style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.75rem;">
        ${roster.map(p => `<span style="font-size:0.82rem;background:#21262d;border-radius:6px;padding:0.2rem 0.55rem;color:#c9d1d9;">
          ${p.name}${p.position ? ` <small style="color:#8b949e;">${p.position}</small>` : ''}
          ${p.platform ? ` <small style="color:#58a6ff;">${p.platform}</small>` : ''}
        </span>`).join('')}</div>`;
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
