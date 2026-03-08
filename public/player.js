const API = '/api';

// League type keys — must match values stored in the seasons.league_type column
const LT_SIXES  = 'sixes';
const LT_THREES = 'threes';
const LT_TABS   = [
  { key: LT_SIXES,  label: "6's" },
  { key: LT_THREES, label: "3's" },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function formatToi(s) {
  if (!s) return '0:00';
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function fmt1(v) { return v !== null && v !== undefined ? Number(v).toFixed(1) : '–'; }
function pct3(v) {
  if (v === null || v === undefined) return '–';
  const frac = v > 1 ? v / 100 : v;
  return frac.toFixed(3).replace(/^0(?=\.)/, '');
}
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
function ovrStyle(v) { return ratingStyle(v) + 'outline:1px solid currentColor;border-radius:3px;'; }
function logoImg(url, name, cls = 'team-logo-xs') {
  return url ? `<img src="${url}" class="${cls}" alt="${name}" />` : '';
}

// ── Career totals aggregation ──────────────────────────────────────────────

function sumSkaterRows(rows) {
  const tot = {
    name: 'Career Total', team_name: '', team_logo: null,
    gp: 0, goals: 0, assists: 0, points: 0, plus_minus: 0,
    shots: 0, hits: 0, blocked_shots: 0, takeaways: 0, giveaways: 0,
    pp_goals: 0, sh_goals: 0, gwg: 0, pim: 0, penalties_drawn: 0,
    faceoff_wins: 0, faceoff_total: 0, deflections: 0, interceptions: 0,
    pass_attempts: 0, pass_completions: 0, hat_tricks: 0, toi: 0,
    _apt_sum: 0, _apt_gp: 0,
    _or_sum: 0, _dr_sum: 0, _tpr_sum: 0, _r_count: 0,
  };
  for (const r of rows) {
    tot.gp += r.gp || 0;
    tot.goals += r.goals || 0;
    tot.assists += r.assists || 0;
    tot.points += r.points || 0;
    tot.plus_minus += r.plus_minus || 0;
    tot.shots += r.shots || 0;
    tot.hits += r.hits || 0;
    tot.blocked_shots += r.blocked_shots || 0;
    tot.takeaways += r.takeaways || 0;
    tot.giveaways += r.giveaways || 0;
    tot.pp_goals += r.pp_goals || 0;
    tot.sh_goals += r.sh_goals || 0;
    tot.gwg += r.gwg || 0;
    tot.pim += r.pim || 0;
    tot.penalties_drawn += r.penalties_drawn || 0;
    tot.faceoff_wins += r.faceoff_wins || 0;
    tot.faceoff_total += r.faceoff_total || 0;
    tot.deflections += r.deflections || 0;
    tot.interceptions += r.interceptions || 0;
    tot.pass_attempts += r.pass_attempts || 0;
    tot.pass_completions += r.pass_completions || 0;
    tot.hat_tricks += r.hat_tricks || 0;
    if (r.apt) { tot._apt_sum += r.apt * (r.gp || 1); tot._apt_gp += r.gp || 1; }
    tot.toi += r.toi || 0;
    if (r.overall_rating > 0) { tot._or_sum += r.overall_rating; tot._r_count++; }
    if (r.defensive_rating > 0) tot._dr_sum += r.defensive_rating;
    if (r.team_play_rating > 0) tot._tpr_sum += r.team_play_rating;
  }
  const n = tot._r_count || 1;
  tot.overall_rating = tot._r_count ? Math.round(tot._or_sum / n) : 0;
  tot.defensive_rating = tot._r_count ? Math.round(tot._dr_sum / n) : 0;
  tot.team_play_rating = tot._r_count ? Math.round(tot._tpr_sum / n) : 0;
  tot.fow_pct = tot.faceoff_total > 0 ? Math.round(tot.faceoff_wins * 100 / tot.faceoff_total * 10) / 10 : null;
  tot.shot_pct = tot.shots > 0 ? Math.round(tot.goals * 100 / tot.shots * 10) / 10 : null;
  tot.pass_pct_calc = tot.pass_attempts > 0 ? Math.round(tot.pass_completions * 100 / tot.pass_attempts * 10) / 10 : null;
  tot.apt = tot._apt_gp > 0 ? Math.round(tot._apt_sum / tot._apt_gp) : 0;
  return tot;
}

function sumGoalieRows(rows) {
  const tot = {
    name: 'Career Total', team_name: '', team_logo: null,
    gp: 0, goals: 0, assists: 0,
    saves: 0, goals_against: 0, shots_against: 0, toi: 0,
    shutouts: 0, penalty_shot_attempts: 0, penalty_shot_ga: 0,
    breakaway_shots: 0, breakaway_saves: 0,
    goalie_wins: 0, goalie_losses: 0, goalie_otw: 0, goalie_otl: 0,
    _or_sum: 0, _dr_sum: 0, _tpr_sum: 0, _r_count: 0,
  };
  for (const r of rows) {
    tot.gp += r.gp || 0;
    tot.goals += r.goals || 0;
    tot.assists += r.assists || 0;
    tot.saves += r.saves || 0;
    tot.goals_against += r.goals_against || 0;
    tot.shots_against += r.shots_against || 0;
    tot.toi += r.toi || 0;
    tot.shutouts += r.shutouts || 0;
    tot.penalty_shot_attempts += r.penalty_shot_attempts || 0;
    tot.penalty_shot_ga += r.penalty_shot_ga || 0;
    tot.breakaway_shots += r.breakaway_shots || 0;
    tot.breakaway_saves += r.breakaway_saves || 0;
    tot.goalie_wins += r.goalie_wins || 0;
    tot.goalie_losses += r.goalie_losses || 0;
    tot.goalie_otw += r.goalie_otw || 0;
    tot.goalie_otl += r.goalie_otl || 0;
    if (r.overall_rating > 0) { tot._or_sum += r.overall_rating; tot._r_count++; }
    if (r.defensive_rating > 0) tot._dr_sum += r.defensive_rating;
    if (r.team_play_rating > 0) tot._tpr_sum += r.team_play_rating;
  }
  const n = tot._r_count || 1;
  tot.overall_rating = tot._r_count ? Math.round(tot._or_sum / n) : 0;
  tot.defensive_rating = tot._r_count ? Math.round(tot._dr_sum / n) : 0;
  tot.team_play_rating = tot._r_count ? Math.round(tot._tpr_sum / n) : 0;
  tot.save_pct = tot.shots_against > 0 ? tot.saves / tot.shots_against : null;
  tot.gaa = tot.toi > 0 ? Math.round(tot.goals_against * 3600 / tot.toi * 100) / 100 : null;
  return tot;
}

// ── Skater stats row ───────────────────────────────────────────────────────

function skaterRow(p, trClass = '') {
  const ovr = computeOvr(p);
  return `<tr class="${trClass}">
    <td>${logoImg(p.team_logo, p.team_name)}${p.team_name || '—'}</td>
    <td style="text-align:center;${ovrStyle(ovr)}">${ovr ?? '–'}</td>
    <td style="text-align:center;${ratingStyle(p.overall_rating)}">${p.overall_rating || '–'}</td>
    <td style="text-align:center;${ratingStyle(p.defensive_rating)}">${p.defensive_rating || '–'}</td>
    <td style="text-align:center;${ratingStyle(p.team_play_rating)}">${p.team_play_rating || '–'}</td>
    <td>${p.gp}</td>
    <td>${p.goals}</td><td>${p.assists}</td>
    <td><strong>${p.points}</strong></td>
    <td>${(p.plus_minus || 0) >= 0 ? '+' : ''}${p.plus_minus || 0}</td>
    <td>${p.shots || 0}</td><td>${p.hits || 0}</td><td>${p.blocked_shots || 0}</td>
    <td>${p.takeaways || 0}</td><td>${p.giveaways || 0}</td>
    <td>${p.pp_goals || 0}</td><td>${p.sh_goals || 0}</td><td>${p.gwg || 0}</td>
    <td>${p.pim || 0}</td><td>${p.penalties_drawn || 0}</td>
    <td>${p.faceoff_wins || 0}</td><td>${p.faceoff_total || 0}</td>
    <td>${p.fow_pct !== null && p.fow_pct !== undefined ? fmt1(p.fow_pct) + '%' : '–'}</td>
    <td>${p.shot_pct !== null && p.shot_pct !== undefined ? fmt1(p.shot_pct) + '%' : '–'}</td>
    <td>${p.deflections || 0}</td><td>${p.interceptions || 0}</td>
    <td>${p.pass_attempts || 0}</td>
    <td>${p.pass_pct_calc !== null && p.pass_pct_calc !== undefined ? fmt1(p.pass_pct_calc) + '%' : '–'}</td>
    <td>${p.hat_tricks || 0}</td>
    <td>${formatToi(p.apt)}</td><td>${formatToi(p.toi)}</td>
  </tr>`;
}

function goalieRow(p, trClass = '') {
  const ovr = computeOvr(p);
  return `<tr class="${trClass}">
    <td>${logoImg(p.team_logo, p.team_name)}${p.team_name || '—'}</td>
    <td style="text-align:center;${ovrStyle(ovr)}">${ovr ?? '–'}</td>
    <td style="text-align:center;${ratingStyle(p.overall_rating)}">${p.overall_rating || '–'}</td>
    <td style="text-align:center;${ratingStyle(p.defensive_rating)}">${p.defensive_rating || '–'}</td>
    <td style="text-align:center;${ratingStyle(p.team_play_rating)}">${p.team_play_rating || '–'}</td>
    <td>${p.gp}</td>
    <td>${p.shots_against || 0}</td><td>${p.goals_against || 0}</td>
    <td><strong>${pct3(p.save_pct)}</strong></td>
    <td>${p.gaa !== null && p.gaa !== undefined ? Number(p.gaa).toFixed(2) : '–'}</td>
    <td>${formatToi(p.toi)}</td>
    <td>${p.shutouts || 0}</td>
    <td>${p.penalty_shot_attempts || 0}</td><td>${p.penalty_shot_ga || 0}</td>
    <td>${p.breakaway_shots || 0}</td><td>${p.breakaway_saves || 0}</td>
    <td>${p.goalie_wins || 0}</td><td>${p.goalie_losses || 0}</td>
    <td>${p.goalie_otw || 0}</td><td>${p.goalie_otl || 0}</td>
  </tr>`;
}

// ── Career stats table ─────────────────────────────────────────────────────

function skaterThead() {
  return `<thead><tr>
    <th>Team</th>
    <th data-tip="Overall Rating (avg. of OR + DR + TPR)">OVR</th>
    <th data-tip="Offense Rating">OR</th>
    <th data-tip="Defense Rating">DR</th>
    <th data-tip="Team Play Rating">TPR</th>
    <th data-tip="Games Played">GP</th>
    <th data-tip="Goals">G</th><th data-tip="Assists">A</th><th data-tip="Points">PTS</th>
    <th data-tip="Plus / Minus">+/-</th>
    <th data-tip="Shots on Goal">SOG</th><th data-tip="Hits">HITS</th><th data-tip="Blocked Shots">BS</th>
    <th data-tip="Takeaways">TKA</th><th data-tip="Giveaways">GVA</th>
    <th data-tip="Power Play Goals">PPG</th><th data-tip="Short-Hand Goals">SHG</th><th data-tip="Game-Winning Goals">GWG</th>
    <th data-tip="Penalty Minutes">PIM</th><th data-tip="Penalties Drawn">PD</th>
    <th data-tip="Faceoff Wins">FOW</th><th data-tip="Faceoff Total">FOT</th>
    <th data-tip="Faceoff Win %">FOW%</th><th data-tip="Shooting %">S%</th>
    <th data-tip="Deflections">DLF</th><th data-tip="Interceptions">INT</th>
    <th data-tip="Pass Attempts">PA</th><th data-tip="Pass Completion %">PC%</th><th data-tip="Hat Tricks">HT</th>
    <th data-tip="Avg. Puck Possession (sec/game)">APT</th><th data-tip="Time on Ice">TOI</th>
  </tr></thead>`;
}

function goalieThead() {
  return `<thead><tr>
    <th>Team</th>
    <th data-tip="Overall Rating (avg. of OR + DR + TPR)">OVR</th>
    <th data-tip="Offense Rating">OR</th>
    <th data-tip="Defense Rating">DR</th>
    <th data-tip="Team Play Rating">TPR</th>
    <th data-tip="Games Played">GP</th>
    <th data-tip="Shots Against">SA</th><th data-tip="Goals Against">GA</th>
    <th data-tip="Save Percentage">SV%</th><th data-tip="Goals Against Average">GAA</th>
    <th data-tip="Time on Ice">TOI</th><th data-tip="Shutouts">SO</th>
    <th data-tip="Penalty Shot Attempts Against">PSA</th><th data-tip="Penalty Shot Goals Against">PSGA</th>
    <th data-tip="Breakaway Shots Against">BKSA</th><th data-tip="Breakaway Saves">BKSV</th>
    <th data-tip="Wins">W</th><th data-tip="Losses">L</th>
    <th data-tip="Overtime Wins">OTW</th><th data-tip="Overtime Losses">OTL</th>
  </tr></thead>`;
}

function renderCareerTable(seasonTeamStats, isGoalie) {
  if (!seasonTeamStats.length) return '<p style="color:#8b949e;">No stats recorded yet.</p>';

  // Group rows by (season_id, is_playoff) — each combination becomes one visual block
  const blocks = [];
  const blockMap = {};
  for (const r of seasonTeamStats) {
    const ip = r.is_playoff ? 1 : 0;
    const key = `${r.season_id ?? 'none'}_${ip}`;
    if (!blockMap[key]) {
      blockMap[key] = { season_id: r.season_id, season_name: r.season_name, is_playoff: ip, rows: [] };
      blocks.push(blockMap[key]);
    }
    blockMap[key].rows.push(r);
  }

  const regularRows = seasonTeamStats.filter(r => !r.is_playoff);
  const playoffRows = seasonTeamStats.filter(r => r.is_playoff);
  const hasPlayoffs = playoffRows.length > 0;

  const thead = isGoalie ? goalieThead() : skaterThead();
  const rowFn = isGoalie ? goalieRow : skaterRow;

  let html = `<div style="overflow-x:auto;"><table class="season-stats-table">
    ${thead}<tbody>`;

  for (const block of blocks) {
    const { season_name, is_playoff, rows } = block;

    if (is_playoff) {
      html += `<tr><td colspan="99" style="background:#0d1117;color:#f0883e;font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;padding:0.35rem 0.5rem;">🏆 ${season_name} – Playoffs</td></tr>`;
    } else {
      html += `<tr><td colspan="99" style="background:#0d1117;color:#8b949e;font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;padding:0.35rem 0.5rem;">📅 ${season_name}</td></tr>`;
    }

    for (const r of rows) html += rowFn(r);

    // Block total (only if player was on multiple teams within this block)
    if (rows.length > 1) {
      const blockTot = isGoalie ? sumGoalieRows(rows) : sumSkaterRows(rows);
      blockTot.team_name = is_playoff ? 'Playoff Total' : 'Season Total';
      blockTot.team_logo = null;
      html += rowFn(blockTot, 'season-total-row');
    }
  }

  // Career totals — split regular vs playoff when both exist
  if (hasPlayoffs && regularRows.length > 0) {
    const regTotal = isGoalie ? sumGoalieRows(regularRows) : sumSkaterRows(regularRows);
    regTotal.team_name = 'Regular Season Career';
    regTotal.team_logo = null;
    html += rowFn(regTotal, 'career-total-row');

    const plTotal = isGoalie ? sumGoalieRows(playoffRows) : sumSkaterRows(playoffRows);
    plTotal.team_name = 'Playoffs Career';
    plTotal.team_logo = null;
    html += rowFn(plTotal, 'career-total-row');
  } else {
    const careerTotal = isGoalie ? sumGoalieRows(seasonTeamStats) : sumSkaterRows(seasonTeamStats);
    careerTotal.team_name = 'Career Total';
    careerTotal.team_logo = null;
    html += rowFn(careerTotal, 'career-total-row');
  }

  html += '</tbody></table></div>';
  return html;
}

// ── Last 5 games ───────────────────────────────────────────────────────────

function renderLastGames(lastGames, name, isGoalie) {
  if (!lastGames.length) return '<p style="color:#8b949e;">No recent games.</p>';

  const rows = lastGames.map(g => {
    const onHomeTeam = g.player_team_id === g.home_team_id;
    const opponent = onHomeTeam
      ? `<a href="team.html?id=${g.away_team_id}" class="player-link">${logoImg(g.away_logo, g.away_team_name)}${g.away_team_name}</a>`
      : `<a href="team.html?id=${g.home_team_id}" class="player-link">${logoImg(g.home_logo, g.home_team_name)}${g.home_team_name}</a>`;
    const myScore = onHomeTeam ? g.home_score : g.away_score;
    const oppScore = onHomeTeam ? g.away_score : g.home_score;
    const won = myScore > oppScore;
    const result = won ? `<span class="result-w">W</span>` : `<span class="result-l">L</span>`;
    const score = `${myScore}–${oppScore}${g.is_overtime ? ' OT' : ''}`;
    const date = g.date ? new Date(g.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    const ovr = computeOvr(g);
    const ovrCell = `<td style="text-align:center;${ovrStyle(ovr)}">${ovr ?? '–'}</td>`;
    const gameLink = `<a href="game.html?id=${g.game_id}" class="player-link">${score}</a>`;

    if (isGoalie) {
      const svp = g.shots_against > 0 ? (g.saves / g.shots_against).toFixed(3).replace(/^0(?=\.)/, '') : '–';
      return `<tr>
        <td>${date}</td><td>${result}</td><td>${gameLink}</td><td>${opponent}</td>
        ${ovrCell}
        <td>${g.shots_against || 0}</td><td>${g.goals_against || 0}</td>
        <td><strong>${svp}</strong></td>
        <td>${formatToi(g.toi)}</td>
      </tr>`;
    } else {
      return `<tr>
        <td>${date}</td><td>${result}</td><td>${gameLink}</td><td>${opponent}</td>
        ${ovrCell}
        <td>${g.goals || 0}</td><td>${g.assists || 0}</td>
        <td><strong>${(g.goals || 0) + (g.assists || 0)}</strong></td>
        <td>${(g.plus_minus || 0) >= 0 ? '+' : ''}${g.plus_minus || 0}</td>
        <td>${g.shots || 0}</td><td>${g.hits || 0}</td>
        <td>${formatToi(g.toi)}</td>
      </tr>`;
    }
  }).join('');

  const skaterHead = `<th data-tip="Goals">G</th><th data-tip="Assists">A</th><th data-tip="Points">PTS</th>
    <th data-tip="Plus / Minus">+/-</th><th data-tip="Shots on Goal">SOG</th>
    <th data-tip="Hits">HITS</th><th data-tip="Time on Ice">TOI</th>`;
  const goalieHead = `<th data-tip="Shots Against">SA</th><th data-tip="Goals Against">GA</th>
    <th data-tip="Save Percentage">SV%</th><th data-tip="Time on Ice">TOI</th>`;

  return `<div style="overflow-x:auto;"><table class="last-games-table">
    <thead><tr>
      <th>Date</th><th></th><th>Score</th><th>Opponent</th>
      <th data-tip="Overall Rating (avg. of OR + DR + TPR)">OVR</th>
      ${isGoalie ? goalieHead : skaterHead}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// ── League-type tab rendering ──────────────────────────────────────────────

function renderLeagueSections(seasonTeamStats, lastGames, isGoalie) {
  const ltSet = new Set(seasonTeamStats.map(r => r.league_type || ''));
  lastGames.forEach(g => ltSet.add(g.league_type || ''));

  const has6 = ltSet.has(LT_SIXES);
  const has3 = ltSet.has(LT_THREES);

  // If only one type (or no type info), render flat — no tabs needed
  if (!has6 || !has3) {
    return `
      <h2 class="section-heading">🕐 Last 5 Games</h2>
      ${renderLastGames(lastGames, '', isGoalie)}
      <h2 class="section-heading">📊 Career Stats</h2>
      ${renderCareerTable(seasonTeamStats, isGoalie)}`;
  }

  // Both types exist — build tabs
  const tabButtons = LT_TABS.map((t, i) =>
    `<button class="lt-tab${i === 0 ? ' lt-tab-active' : ''}" data-lt="${t.key}">${t.label}</button>`
  ).join('');

  const tabPanels = LT_TABS.map((t, i) => {
    const filteredStats = seasonTeamStats.filter(r => (r.league_type || '') === t.key);
    const filteredGames = lastGames.filter(g => (g.league_type || '') === t.key);
    return `<div class="lt-panel" id="lt-panel-${t.key}" style="${i > 0 ? 'display:none;' : ''}">
      <h2 class="section-heading" style="margin-top:0.75rem;">🕐 Last 5 Games</h2>
      ${renderLastGames(filteredGames, '', isGoalie)}
      <h2 class="section-heading">📊 Career Stats</h2>
      ${renderCareerTable(filteredStats, isGoalie)}
    </div>`;
  }).join('');

  return `<div class="lt-tabs">${tabButtons}</div>${tabPanels}`;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function loadPlayer() {
  const root = document.getElementById('player-root');
  const params = new URLSearchParams(window.location.search);
  const name = params.get('name');
  if (!name) {
    root.innerHTML = '<p class="error">No player name specified.</p>';
    return;
  }

  try {
    const res = await fetch(`${API}/players/profile/${encodeURIComponent(name)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      root.innerHTML = `<p class="error">${err.error || 'Player not found.'}</p>`;
      return;
    }
    const { player, isGoalie, seasonTeamStats, lastGames } = await res.json();

    document.title = `${name} – EHL`;

    // Position label
    const pos = isGoalie ? 'G' :
      (player ? (player.user_position || player.player_position || '–') : (seasonTeamStats[0]?.position || '–'));
    const platformLabel = player?.platform
      ? `<span class="player-badge-platform">${player.platform === 'psn' ? '🎮 PSN' : '🎮 Xbox'}</span>`
      : '';
    const discordLabel = player?.discord
      ? `<span class="player-badge-platform" style="color:#5865f2;border-color:#5865f2;background:rgba(88,101,242,0.12);">⊟ ${player.discord}</span>`
      : '';

    // Team badge
    let teamBadge = '<span class="player-badge-fa">Free Agent</span>';
    if (player?.team_id && player?.is_rostered) {
      teamBadge = `<a href="team.html?id=${player.team_id}" class="player-badge-team">
        ${player.team_logo ? `<img src="${player.team_logo}" alt="${player.team_name}" class="team-logo-xs" />` : ''}
        ${player.team_name}
      </a>`;
    }

    let html = `
      <div class="player-header">
        <div class="player-avatar">🏒</div>
        <div class="player-info">
          <h1 class="player-name">${name}</h1>
          <div class="player-meta">
            <span class="player-badge-pos">${isGoalie ? '🥅 Goalie' : `⛸️ ${pos}`}</span>
            ${teamBadge}
            ${platformLabel}
            ${discordLabel}
          </div>
        </div>
      </div>
      ${renderLeagueSections(seasonTeamStats, lastGames, isGoalie)}
    `;

    root.innerHTML = html;

    // Wire up league-type tab buttons
    root.querySelectorAll('.lt-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const lt = btn.dataset.lt;
        // Only act on known league-type keys to avoid selector injection
        if (!LT_TABS.some(t => t.key === lt)) return;
        root.querySelectorAll('.lt-tab').forEach(b => b.classList.remove('lt-tab-active'));
        btn.classList.add('lt-tab-active');
        root.querySelectorAll('.lt-panel').forEach(p => { p.style.display = 'none'; });
        const panel = root.querySelector(`#lt-panel-${lt}`);
        if (panel) panel.style.display = '';
      });
    });
  } catch (err) {
    root.innerHTML = `<p class="error">Failed to load player: ${err.message}</p>`;
  }
}

loadPlayer();
