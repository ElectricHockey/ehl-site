const API = '/api';

// ── Rating helpers ─────────────────────────────────────────────────────────

// Compute a single OVR from the three EA sub-ratings (ignores zeros/nulls)
function computeOvr(p) {
  const vals = [p.overall_rating, p.defensive_rating, p.team_play_rating]
    .map(Number).filter(v => v > 0);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

// Returns an inline style string that colour-codes a rating value 0-100
function ratingStyle(v) {
  if (!v || v <= 0) return 'color:#484f58;';
  if (v >= 90) return 'background:rgba(255,215,0,0.22);color:#ffd700;font-weight:700;';
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
  const sorted = sortData(data, leagueSort[league].skater.key, leagueSort[league].skater.dir);
  const s = k => thClass(k, leagueSort[league].skater);
  const L = JSON.stringify(league); // safe string for onclick
  root.innerHTML = `<div style="overflow-x:auto;"><table id="skaters-table">
    <thead><tr>
      <th>Player</th><th>Team</th><th>Pos</th>
      <th data-tip="Overall Rating (avg. of OR + DR + TPR)" class="${s('_ovr')}" onclick="sortSkaters('_ovr',${L})">OVR</th>
      <th data-tip="Offense Rating" class="${s('overall_rating')}" onclick="sortSkaters('overall_rating',${L})">OR</th>
      <th data-tip="Defense Rating" class="${s('defensive_rating')}" onclick="sortSkaters('defensive_rating',${L})">DR</th>
      <th data-tip="Team Play Rating" class="${s('team_play_rating')}" onclick="sortSkaters('team_play_rating',${L})">TPR</th>
      <th data-tip="Games Played" class="${s('gp')}" onclick="sortSkaters('gp',${L})">GP</th>
      <th data-tip="Goals" class="${s('goals')}" onclick="sortSkaters('goals',${L})">G</th>
      <th data-tip="Assists" class="${s('assists')}" onclick="sortSkaters('assists',${L})">A</th>
      <th data-tip="Points" class="${s('points')}" onclick="sortSkaters('points',${L})">PTS</th>
      <th data-tip="Plus / Minus" class="${s('plus_minus')}" onclick="sortSkaters('plus_minus',${L})">+/-</th>
      <th data-tip="Shots on Goal" class="${s('shots')}" onclick="sortSkaters('shots',${L})">SOG</th>
      <th data-tip="Hits" class="${s('hits')}" onclick="sortSkaters('hits',${L})">HITS</th>
      <th data-tip="Blocked Shots" class="${s('blocked_shots')}" onclick="sortSkaters('blocked_shots',${L})">BS</th>
      <th data-tip="Takeaways" class="${s('takeaways')}" onclick="sortSkaters('takeaways',${L})">TKA</th>
      <th data-tip="Giveaways" class="${s('giveaways')}" onclick="sortSkaters('giveaways',${L})">GVA</th>
      <th data-tip="Power Play Goals" class="${s('pp_goals')}" onclick="sortSkaters('pp_goals',${L})">PPG</th>
      <th data-tip="Short-Hand Goals" class="${s('sh_goals')}" onclick="sortSkaters('sh_goals',${L})">SHG</th>
      <th data-tip="Game-Winning Goals" class="${s('gwg')}" onclick="sortSkaters('gwg',${L})">GWG</th>
      <th data-tip="Penalty Minutes" class="${s('pim')}" onclick="sortSkaters('pim',${L})">PIM</th>
      <th data-tip="Penalties Drawn" class="${s('penalties_drawn')}" onclick="sortSkaters('penalties_drawn',${L})">PD</th>
      <th data-tip="Faceoff Wins" class="${s('faceoff_wins')}" onclick="sortSkaters('faceoff_wins',${L})">FOW</th>
      <th data-tip="Faceoff Total" class="${s('faceoff_total')}" onclick="sortSkaters('faceoff_total',${L})">FOT</th>
      <th data-tip="Faceoff Win %" class="${s('fow_pct')}" onclick="sortSkaters('fow_pct',${L})">FOW%</th>
      <th data-tip="Shooting %" class="${s('shot_pct')}" onclick="sortSkaters('shot_pct',${L})">S%</th>
      <th data-tip="Deflections" class="${s('deflections')}" onclick="sortSkaters('deflections',${L})">DLF</th>
      <th data-tip="Interceptions" class="${s('interceptions')}" onclick="sortSkaters('interceptions',${L})">INT</th>
      <th data-tip="Pass Attempts" class="${s('pass_attempts')}" onclick="sortSkaters('pass_attempts',${L})">PA</th>
      <th data-tip="Pass Completion %" class="${s('pass_pct_calc')}" onclick="sortSkaters('pass_pct_calc',${L})">PC%</th>
      <th data-tip="Hat Tricks" class="${s('hat_tricks')}" onclick="sortSkaters('hat_tricks',${L})">HT</th>
      <th data-tip="Avg. Puck Possession (sec/game)" class="${s('apt')}" onclick="sortSkaters('apt',${L})">APT</th>
      <th data-tip="Time on Ice" class="${s('toi')}" onclick="sortSkaters('toi',${L})">TOI</th>
    </tr></thead>
    <tbody>${sorted.map(p => {
      const ovr = p._ovr;
      return `<tr${playerRowAttrs(p)}>
      <td><a href="player.html?name=${encodeURIComponent(p.name)}" class="player-link">${p.name}</a></td>
      <td>${p.team_logo ? `<img src="${p.team_logo}" style="width:18px;height:18px;object-fit:contain;vertical-align:middle;margin-right:0.25rem;border-radius:2px;" />` : ''}${p.team_name}</td>
      <td>${p.position||'–'}</td>
      <td style="text-align:center;${ovrStyle(ovr)}">${ovr ?? '–'}</td>
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
      <td>${fmt1(p.fow_pct)}%</td><td>${fmt1(p.shot_pct)}%</td>
      <td>${p.deflections||0}</td><td>${p.interceptions||0}</td>
      <td>${p.pass_attempts||0}</td>
      <td>${p.pass_pct_calc !== null && p.pass_pct_calc !== undefined ? fmt1(p.pass_pct_calc)+'%' : '–'}</td>
      <td>${p.hat_tricks||0}</td>
      <td>${formatToi(p.apt)}</td><td>${formatToi(p.toi)}</td>
    </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function renderGoalies(league) {
  const root = document.getElementById('goalies-root');
  if (!root) return;
  const data = leagueData[league].goalies;
  if (data.length === 0) { root.innerHTML = '<p style="color:#8b949e">No goalie stats yet for this season.</p>'; return; }
  data.forEach(p => { p._ovr = computeOvr(p); });
  const sorted = sortData(data, leagueSort[league].goalie.key, leagueSort[league].goalie.dir);
  const s = k => thClass(k, leagueSort[league].goalie);
  const L = JSON.stringify(league);
  root.innerHTML = `<div style="overflow-x:auto;"><table id="goalies-table">
    <thead><tr>
      <th>Player</th><th>Team</th>
      <th data-tip="Overall Rating (avg. of OR + DR + TPR)" class="${s('_ovr')}" onclick="sortGoalies('_ovr',${L})">OVR</th>
      <th data-tip="Offense Rating" class="${s('overall_rating')}" onclick="sortGoalies('overall_rating',${L})">OR</th>
      <th data-tip="Defense Rating" class="${s('defensive_rating')}" onclick="sortGoalies('defensive_rating',${L})">DR</th>
      <th data-tip="Team Play Rating" class="${s('team_play_rating')}" onclick="sortGoalies('team_play_rating',${L})">TPR</th>
      <th data-tip="Games Played" class="${s('gp')}" onclick="sortGoalies('gp',${L})">GP</th>
      <th data-tip="Goals" class="${s('goals')}" onclick="sortGoalies('goals',${L})">G</th>
      <th data-tip="Assists" class="${s('assists')}" onclick="sortGoalies('assists',${L})">A</th>
      <th data-tip="Shots Against" class="${s('shots_against')}" onclick="sortGoalies('shots_against',${L})">SA</th>
      <th data-tip="Goals Against" class="${s('goals_against')}" onclick="sortGoalies('goals_against',${L})">GA</th>
      <th data-tip="Save Percentage" class="${s('save_pct')}" onclick="sortGoalies('save_pct',${L})">SV%</th>
      <th data-tip="Goals Against Average" class="${s('gaa')}" onclick="sortGoalies('gaa',${L})">GAA</th>
      <th data-tip="Time on Ice" class="${s('toi')}" onclick="sortGoalies('toi',${L})">TOI</th>
      <th data-tip="Shutouts" class="${s('shutouts')}" onclick="sortGoalies('shutouts',${L})">SO</th>
      <th data-tip="Penalty Shot Attempts Against" class="${s('penalty_shot_attempts')}" onclick="sortGoalies('penalty_shot_attempts',${L})">PSA</th>
      <th data-tip="Penalty Shot Goals Against" class="${s('penalty_shot_ga')}" onclick="sortGoalies('penalty_shot_ga',${L})">PSGA</th>
      <th data-tip="Breakaway Shots Against" class="${s('breakaway_shots')}" onclick="sortGoalies('breakaway_shots',${L})">BKSA</th>
      <th data-tip="Breakaway Saves" class="${s('breakaway_saves')}" onclick="sortGoalies('breakaway_saves',${L})">BKSV</th>
      <th data-tip="Wins" class="${s('goalie_wins')}" onclick="sortGoalies('goalie_wins',${L})">W</th>
      <th data-tip="Losses" class="${s('goalie_losses')}" onclick="sortGoalies('goalie_losses',${L})">L</th>
      <th data-tip="Overtime Wins" class="${s('goalie_otw')}" onclick="sortGoalies('goalie_otw',${L})">OTW</th>
      <th data-tip="Overtime Losses" class="${s('goalie_otl')}" onclick="sortGoalies('goalie_otl',${L})">OTL</th>
    </tr></thead>
    <tbody>${sorted.map(p => {
      const svp = p.save_pct !== null && p.save_pct !== undefined
        ? (p.save_pct < 1 ? (p.save_pct * 100).toFixed(1) : Number(p.save_pct).toFixed(1)) + '%' : '–';
      const ovr = p._ovr;
      return `<tr${playerRowAttrs(p)}>
        <td><a href="player.html?name=${encodeURIComponent(p.name)}" class="player-link">${p.name}</a></td>
        <td>${p.team_logo ? `<img src="${p.team_logo}" style="width:18px;height:18px;object-fit:contain;vertical-align:middle;margin-right:0.25rem;border-radius:2px;" />` : ''}${p.team_name}</td>
        <td style="text-align:center;${ovrStyle(ovr)}">${ovr ?? '–'}</td>
        <td style="text-align:center;${ratingStyle(p.overall_rating)}">${p.overall_rating||'–'}</td>
        <td style="text-align:center;${ratingStyle(p.defensive_rating)}">${p.defensive_rating||'–'}</td>
        <td style="text-align:center;${ratingStyle(p.team_play_rating)}">${p.team_play_rating||'–'}</td>
        <td>${p.gp}</td><td>${p.goals||0}</td><td>${p.assists||0}</td>
        <td>${p.shots_against}</td><td>${p.goals_against}</td>
        <td><strong>${svp}</strong></td>
        <td>${p.gaa !== null && p.gaa !== undefined ? Number(p.gaa).toFixed(2) : '–'}</td>
        <td>${formatToi(p.toi)}</td>
        <td>${p.shutouts||0}</td>
        <td>${p.penalty_shot_attempts||0}</td><td>${p.penalty_shot_ga||0}</td>
        <td>${p.breakaway_shots||0}</td><td>${p.breakaway_saves||0}</td>
        <td>${p.goalie_wins||0}</td><td>${p.goalie_losses||0}</td>
        <td>${p.goalie_otw||0}</td><td>${p.goalie_otl||0}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
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
