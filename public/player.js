const API = '/api';

// League type keys — must match values stored in the seasons.league_type column
const LT_SIXES  = 'sixes';
const LT_THREES = 'threes';
const LT_TABS   = [
  { key: LT_SIXES,  label: "6's" },
  { key: LT_THREES, label: "3's" },
];
// Extra (non-league) tabs on the player profile
const LT_EXTRA_TABS = ['records', 'awards'];

// ── Helpers ────────────────────────────────────────────────────────────────

function formatToi(s) {
  if (!s) return '0:00';
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function fmt1(v) { return v !== null && v !== undefined ? Number(v).toFixed(1) : '–'; }
function pct3(v) {
  if (v === null || v === undefined) return '–';
  const num = Number(v);
  const frac = num > 1 ? num / 100 : num;
  return frac.toFixed(3).replace(/^0(?=\.)/, '');
}
function computeOvr(p) {
  const vals = [p.offensive_rating, p.defensive_rating, p.team_play_rating]
    .map(Number).filter(v => v > 0);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}
function ratingStyle(v) {
  if (!v || v <= 0) return 'color:#484f58;';
  if (v >= 90) return 'background:rgba(35,134,54,0.35);color:#2ea043;font-weight:700;';
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
    shots: 0, shot_attempts: 0, hits: 0, blocked_shots: 0, takeaways: 0, giveaways: 0,
    pp_goals: 0, sh_goals: 0, gwg: 0, pim: 0, penalties_drawn: 0,
    faceoff_wins: 0, faceoff_total: 0, deflections: 0, interceptions: 0,
    pass_attempts: 0, pass_completions: 0, hat_tricks: 0, toi: 0,
    _apt_sum: 0, _apt_gp: 0,
    _or_sum: 0, _offr_sum: 0, _dr_sum: 0, _tpr_sum: 0, _r_count: 0,
  };
  for (const r of rows) {
    tot.gp += Number(r.gp) || 0;
    tot.goals += Number(r.goals) || 0;
    tot.assists += Number(r.assists) || 0;
    tot.points += Number(r.points) || 0;
    tot.plus_minus += Number(r.plus_minus) || 0;
    tot.shots += Number(r.shots) || 0;
    tot.shot_attempts += Number(r.shot_attempts) || 0;
    tot.hits += Number(r.hits) || 0;
    tot.blocked_shots += Number(r.blocked_shots) || 0;
    tot.takeaways += Number(r.takeaways) || 0;
    tot.giveaways += Number(r.giveaways) || 0;
    tot.pp_goals += Number(r.pp_goals) || 0;
    tot.sh_goals += Number(r.sh_goals) || 0;
    tot.gwg += Number(r.gwg) || 0;
    tot.pim += Number(r.pim) || 0;
    tot.penalties_drawn += Number(r.penalties_drawn) || 0;
    tot.faceoff_wins += Number(r.faceoff_wins) || 0;
    tot.faceoff_total += Number(r.faceoff_total) || 0;
    tot.deflections += Number(r.deflections) || 0;
    tot.interceptions += Number(r.interceptions) || 0;
    tot.pass_attempts += Number(r.pass_attempts) || 0;
    tot.pass_completions += Number(r.pass_completions) || 0;
    tot.hat_tricks += Number(r.hat_tricks) || 0;
    if (r.apt) { tot._apt_sum += Number(r.apt) * (Number(r.gp) || 1); tot._apt_gp += Number(r.gp) || 1; }
    tot.toi += Number(r.toi) || 0;
    if (Number(r.overall_rating) > 0)    { tot._or_sum   += Number(r.overall_rating);   tot._r_count++; }
    if (Number(r.offensive_rating) > 0)    tot._offr_sum += Number(r.offensive_rating);
    if (Number(r.defensive_rating) > 0)    tot._dr_sum   += Number(r.defensive_rating);
    if (Number(r.team_play_rating) > 0)    tot._tpr_sum  += Number(r.team_play_rating);
  }
  const n = tot._r_count || 1;
  tot.overall_rating    = tot._r_count ? Math.round(tot._or_sum   / n) : 0;
  tot.offensive_rating  = tot._r_count ? Math.round(tot._offr_sum / n) : 0;
  tot.defensive_rating  = tot._r_count ? Math.round(tot._dr_sum   / n) : 0;
  tot.team_play_rating  = tot._r_count ? Math.round(tot._tpr_sum  / n) : 0;
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
    _or_sum: 0, _offr_sum: 0, _dr_sum: 0, _tpr_sum: 0, _r_count: 0,
  };
  for (const r of rows) {
    tot.gp += Number(r.gp) || 0;
    tot.goals += Number(r.goals) || 0;
    tot.assists += Number(r.assists) || 0;
    tot.saves += Number(r.saves) || 0;
    tot.goals_against += Number(r.goals_against) || 0;
    tot.shots_against += Number(r.shots_against) || 0;
    tot.toi += Number(r.toi) || 0;
    tot.shutouts += Number(r.shutouts) || 0;
    tot.penalty_shot_attempts += Number(r.penalty_shot_attempts) || 0;
    tot.penalty_shot_ga += Number(r.penalty_shot_ga) || 0;
    tot.breakaway_shots += Number(r.breakaway_shots) || 0;
    tot.breakaway_saves += Number(r.breakaway_saves) || 0;
    tot.goalie_wins += Number(r.goalie_wins) || 0;
    tot.goalie_losses += Number(r.goalie_losses) || 0;
    tot.goalie_otw += Number(r.goalie_otw) || 0;
    tot.goalie_otl += Number(r.goalie_otl) || 0;
    if (Number(r.overall_rating) > 0)  { tot._or_sum   += Number(r.overall_rating);   tot._r_count++; }
    if (Number(r.offensive_rating) > 0)  tot._offr_sum += Number(r.offensive_rating);
    if (Number(r.defensive_rating) > 0)  tot._dr_sum   += Number(r.defensive_rating);
    if (Number(r.team_play_rating) > 0)  tot._tpr_sum  += Number(r.team_play_rating);
  }
  const n = tot._r_count || 1;
  tot.overall_rating    = tot._r_count ? Math.round(tot._or_sum   / n) : 0;
  tot.offensive_rating  = tot._r_count ? Math.round(tot._offr_sum / n) : 0;
  tot.defensive_rating  = tot._r_count ? Math.round(tot._dr_sum   / n) : 0;
  tot.team_play_rating  = tot._r_count ? Math.round(tot._tpr_sum  / n) : 0;
  tot.save_pct = tot.shots_against > 0 ? tot.saves / tot.shots_against : null;
  tot.gaa = tot.toi > 0 ? Math.round(tot.goals_against * 3600 / tot.toi * 100) / 100 : null;
  return tot;
}

// ── Skater stats row ───────────────────────────────────────────────────────

function teamLogoCell(p) {
  // For total/career rows, show the label text instead of a logo
  if (!p.team_logo && p.team_name) return p.team_name;
  if (!p.team_logo) return '—';
  const img = `<img src="${p.team_logo}" class="team-logo-xs" alt="${p.team_name || ''}" title="${p.team_name || ''}" />`;
  if (p.team_id && p.season_id) return `<a href="team.html?id=${p.team_id}&season_id=${p.season_id}">${img}</a>`;
  if (p.team_id) return `<a href="team.html?id=${p.team_id}">${img}</a>`;
  return img;
}

function skaterRow(p, trClass = '') {
  const ovr = computeOvr(p);
  p._ovr = ovr;
  return `<tr class="${trClass}">
    <td style="text-align:center;">${teamLogoCell(p)}</td>
    ${SKATER_COLS.map(c => `<td style="${c.style ? c.style(p) : ''}">${c.fmt(p)}</td>`).join('')}
  </tr>`;
}

function goalieRow(p, trClass = '') {
  const ovr = computeOvr(p);
  p._ovr = ovr;
  return `<tr class="${trClass}">
    <td style="text-align:center;">${teamLogoCell(p)}</td>
    ${GOALIE_COLS.map(c => `<td style="${c.style ? c.style(p) : ''}">${c.fmt(p)}</td>`).join('')}
  </tr>`;
}

// ── Career stats table ─────────────────────────────────────────────────────

function skaterThead() {
  return `<thead><tr>
    <th>Team</th>
    ${SKATER_COLS.map(c => `<th data-tip="${c.tip}">${c.label}</th>`).join('')}
  </tr></thead>`;
}

function goalieThead() {
  return `<thead><tr>
    <th>Team</th>
    ${GOALIE_COLS.map(c => `<th data-tip="${c.tip}">${c.label}</th>`).join('')}
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

  let html = `<div style="overflow-x:auto;max-width:100%;"><table class="season-stats-table">
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
    const posCell = `<td style="text-align:center;font-size:0.8rem;color:#8b949e;">${g.position || '–'}</td>`;
    const score = `${myScore}–${oppScore}${g.is_overtime ? ' OT' : ''}`;
    const date = g.date ? new Date(g.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    const ovr = computeOvr(g);
    const ovrCell = `<td style="text-align:center;${ovrStyle(ovr)}">${ovr ?? '–'}</td>`;
    const gameLink = `<a href="game.html?id=${g.game_id}" class="player-link">${score}</a>`;

    if (isGoalie) {
      const svp = g.shots_against > 0 ? (g.saves / g.shots_against).toFixed(3).replace(/^0(?=\.)/, '') : '–';
      const bksvp = g.breakaway_shots > 0 ? (g.breakaway_saves / g.breakaway_shots).toFixed(3).replace(/^0(?=\.)/, '') : '–';
      return `<tr>
        <td>${date}</td><td>${result}</td><td>${gameLink}</td><td>${opponent}</td>
        ${posCell}${ovrCell}
        <td>${g.goals || 0}</td><td>${g.assists || 0}</td>
        <td>${g.shots_against || 0}</td><td>${g.goals_against || 0}</td>
        <td><strong>${svp}</strong></td>
        <td>${g.shutouts || 0}</td>
        <td>${g.penalty_shot_attempts || 0}</td><td>${g.penalty_shot_ga || 0}</td>
        <td>${g.breakaway_shots || 0}</td><td>${g.breakaway_saves || 0}</td>
        <td>${bksvp}</td>
        <td>${formatToi(g.toi)}</td>
      </tr>`;
    } else {
      const fow_pct = g.faceoff_wins !== null && (g.faceoff_wins + (g.faceoff_losses || 0)) > 0
        ? ((g.faceoff_wins / (g.faceoff_wins + g.faceoff_losses)) * 100).toFixed(1) + '%' : '–';
      const pass_pct = g.pass_attempts > 0
        ? ((g.pass_completions / g.pass_attempts) * 100).toFixed(1) + '%' : '–';
      const shot_pct = g.shots > 0
        ? ((g.goals / g.shots) * 100).toFixed(1) + '%' : '–';
      return `<tr>
        <td>${date}</td><td>${result}</td><td>${gameLink}</td><td>${opponent}</td>
        ${posCell}${ovrCell}
        <td>${g.goals || 0}</td><td>${g.assists || 0}</td>
        <td><strong>${(g.goals || 0) + (g.assists || 0)}</strong></td>
        <td>${(g.plus_minus || 0) >= 0 ? '+' : ''}${g.plus_minus || 0}</td>
        <td>${g.shots || 0}</td><td>${g.shot_attempts || 0}</td><td>${shot_pct}</td>
        <td>${g.hits || 0}</td><td>${g.blocked_shots || 0}</td>
        <td>${g.takeaways || 0}</td><td>${g.giveaways || 0}</td>
        <td>${g.pim || 0}</td><td>${g.penalties_drawn || 0}</td>
        <td>${g.pp_goals || 0}</td><td>${g.sh_goals || 0}</td><td>${g.gwg || 0}</td>
        <td>${g.faceoff_wins || 0}</td><td>${g.faceoff_losses || 0}</td><td>${fow_pct}</td>
        <td>${g.deflections || 0}</td><td>${g.interceptions || 0}</td>
        <td>${g.pass_attempts || 0}</td><td>${g.pass_completions || 0}</td><td>${pass_pct}</td>
        <td>${g.hat_tricks || 0}</td>
        <td>${formatToi(g.possession_secs)}</td>
        <td>${formatToi(g.toi)}</td>
      </tr>`;
    }
  }).join('');

  const skaterHead = `
    <th data-tip="Goals">G</th><th data-tip="Assists">A</th><th data-tip="Points">PTS</th>
    <th data-tip="Plus / Minus">+/-</th>
    <th data-tip="Shots on Goal">SOG</th><th data-tip="Shot Attempts">SAT</th><th data-tip="Shooting %">S%</th>
    <th data-tip="Hits">HIT</th><th data-tip="Blocked Shots">BS</th>
    <th data-tip="Takeaways">TKA</th><th data-tip="Giveaways">GVA</th>
    <th data-tip="Penalty Minutes">PIM</th><th data-tip="Penalties Drawn">PD</th>
    <th data-tip="Power Play Goals">PPG</th><th data-tip="Short-Hand Goals">SHG</th><th data-tip="Game-Winning Goals">GWG</th>
    <th data-tip="Faceoff Wins">FOW</th><th data-tip="Faceoff Losses">FOL</th><th data-tip="Faceoff Win %">FOW%</th>
    <th data-tip="Deflections">DLF</th><th data-tip="Interceptions">INT</th>
    <th data-tip="Pass Attempts">PA</th><th data-tip="Pass Completions">PC</th><th data-tip="Pass Completion %">PC%</th>
    <th data-tip="Hat Tricks">HT</th>
    <th data-tip="Avg Puck Possession">POSS</th>
    <th data-tip="Time on Ice">TOI</th>`;

  const goalieHead = `
    <th data-tip="Goals">G</th><th data-tip="Assists">A</th>
    <th data-tip="Shots Against">SA</th><th data-tip="Goals Against">GA</th>
    <th data-tip="Save Percentage">SV%</th><th data-tip="Shutouts">SO</th>
    <th data-tip="Penalty Shot Attempts">PSA</th><th data-tip="Penalty Shot Goals Against">PSGA</th>
    <th data-tip="Breakaway Shots Against">BKSA</th><th data-tip="Breakaway Saves">BKSV</th>
    <th data-tip="Breakaway Save %">BKS%</th>
    <th data-tip="Time on Ice">TOI</th>`;

  return `<div style="overflow-x:auto;max-width:100%;"><table class="last-games-table">
    <thead><tr>
      <th>Date</th><th></th><th>Score</th><th>Opponent</th>
      <th data-tip="Position played">POS</th>
      <th data-tip="Overall Rating">OVR</th>
      ${isGoalie ? goalieHead : skaterHead}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// ── Player record holdings renderer ───────────────────────────────────────

function renderPlayerRecords(holdings) {
  if (!holdings || holdings.length === 0) {
    return '<p style="color:#8b949e;padding:1.5rem 0;">This player does not currently hold any records.</p>';
  }

  function fmtVal(label, value) {
    if (value === null || value === undefined) return '–';
    if (label.includes('Save%') || label.includes('save_pct')) return Number(value).toFixed(3);
    if (label.includes('GAA')) return Number(value).toFixed(2);
    if (label.includes('+/-')) return value > 0 ? '+' + value : String(value);
    return String(value);
  }

  function buildSection(title, rows) {
    if (rows.length === 0) return '';
    const trs = rows.map(r => {
      const scope = r.scope === 'league' ? '🏆 League' : `🏒 ${r.team_name || 'Team'}`;
      const lt = r.league_type === 'threes' ? "3's" : r.league_type === 'sixes' ? "6's" : '';
      let extra = r.season_name ? `<span style="color:#8b949e;font-size:0.78rem;">Season: ${r.season_name}</span>` : '';
      // Single-game records: show clickable game link
      if (r.category === 'singlegame' && r.game_id) {
        const d = r.date ? new Date(r.date).toLocaleDateString() : '';
        const gameLabel = `${r.home_team || ''} vs ${r.away_team || ''} ${d}`.trim();
        extra = `<a href="game.html?id=${r.game_id}" class="player-link" style="font-size:0.78rem;">${gameLabel}</a>`;
      }
      // Co-holders (tied record)
      const tiedWith = r.co_holders && r.co_holders.length > 0
        ? `<span style="color:#8b949e;font-size:0.76rem;display:block;">Tied w/ ${r.co_holders.map(n => `<a href="player.html?name=${encodeURIComponent(n)}" class="player-link">${n}</a>`).join(', ')}</span>`
        : '';
      return `<tr>
        <td style="color:#8b949e;padding:0.4rem 0.5rem;">${r.label}</td>
        <td style="padding:0.4rem 0.5rem;font-weight:700;color:#e3b341;">${fmtVal(r.label, r.value)}</td>
        <td style="padding:0.4rem 0.5rem;font-size:0.8rem;color:#58a6ff;">${scope}${lt ? ' · ' + lt : ''}</td>
        <td style="padding:0.4rem 0.5rem;">${extra}${tiedWith}</td>
      </tr>`;
    }).join('');
    return `<p style="color:#8b949e;font-size:0.75rem;text-transform:uppercase;letter-spacing:.05em;margin:1.25rem 0 0.4rem;">${title}</p>
    <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
      <thead><tr style="font-size:0.75rem;color:#8b949e;border-bottom:2px solid #30363d;">
        <th style="padding:0.3rem 0.5rem;text-align:left;">Record</th>
        <th style="padding:0.3rem 0.5rem;text-align:left;">Value</th>
        <th style="padding:0.3rem 0.5rem;text-align:left;">Scope</th>
        <th style="padding:0.3rem 0.5rem;text-align:left;"></th>
      </tr></thead>
      <tbody>${trs}</tbody>
    </table></div>`;
  }

  const threes = holdings.filter(h => h.league_type === 'threes' || (h.scope === 'team' && h.league_type !== 'sixes'));
  const sixes  = holdings.filter(h => h.league_type === 'sixes');

  // Group by category within each section
  function groupRows(arr) {
    const alltime    = arr.filter(h => h.category === 'alltime' || h.category === 'team-career');
    const seasonal   = arr.filter(h => h.category === 'seasonal');
    const singlegame = arr.filter(h => h.category === 'singlegame');
    return { alltime, seasonal, singlegame };
  }

  let html = '';
  const g3 = groupRows(threes);
  if (g3.alltime.length || g3.seasonal.length || g3.singlegame.length) {
    html += `<h3 style="color:#58a6ff;margin-top:0.5rem;margin-bottom:0.25rem;">3's</h3>`;
    html += buildSection('All-Time Records', g3.alltime);
    html += buildSection('Single-Season Records', g3.seasonal);
    html += buildSection('Single-Game Records', g3.singlegame);
  }
  const g6 = groupRows(sixes);
  if (g6.alltime.length || g6.seasonal.length || g6.singlegame.length) {
    html += `<h3 style="color:#58a6ff;margin-top:1rem;margin-bottom:0.25rem;">6's</h3>`;
    html += buildSection('All-Time Records', g6.alltime);
    html += buildSection('Single-Season Records', g6.seasonal);
    html += buildSection('Single-Game Records', g6.singlegame);
  }
  // Team records (scope === 'team', any league type)
  const teamHoldings = holdings.filter(h => h.scope === 'team');
  if (teamHoldings.length) {
    const { alltime: ta } = groupRows(teamHoldings);
    html += `<h3 style="color:#58a6ff;margin-top:1rem;margin-bottom:0.25rem;">Team Records</h3>`;
    html += buildSection('Career Records', ta);
  }

  return html || '<p style="color:#8b949e;padding:1.5rem 0;">This player does not currently hold any records.</p>';
}

// ── League-type tab rendering ──────────────────────────────────────────────

function renderLeagueSections(seasonTeamStats, lastGames, isGoalie, holdings) {
  const ltSet = new Set(seasonTeamStats.map(r => r.league_type || ''));
  lastGames.forEach(g => ltSet.add(g.league_type || ''));

  // Default to first league that has data, fallback to first tab
  const defaultLt = (LT_TABS.find(t => ltSet.has(t.key)) || LT_TABS[0]).key;

  // League tabs + spacer + Records + Awards
  const tabButtons = [
    ...LT_TABS.map(t =>
      `<button class="lt-tab${t.key === defaultLt ? ' lt-tab-active' : ''}" data-lt="${t.key}">${t.label}</button>`
    ),
    '<span style="flex:1;"></span>',
    `<button class="lt-tab" data-lt="records">Records</button>`,
    `<button class="lt-tab" data-lt="awards">Awards</button>`,
  ].join('');

  const leaguePanels = LT_TABS.map(t => {
    const filteredStats = seasonTeamStats.filter(r => (r.league_type || '') === t.key);
    const filteredGames = lastGames.filter(g => (g.league_type || '') === t.key);
    return `<div class="lt-panel" id="lt-panel-${t.key}" style="${t.key !== defaultLt ? 'display:none;' : ''}">
      <h2 class="section-heading" style="margin-top:0.75rem;">🕐 Last 5 Games</h2>
      ${renderLastGames(filteredGames, '', isGoalie)}
      <h2 class="section-heading">📊 Career Stats</h2>
      ${renderCareerTable(filteredStats, isGoalie)}
    </div>`;
  }).join('');

  return `<div class="lt-tabs">${tabButtons}</div>${leaguePanels}
    <div class="lt-panel" id="lt-panel-records" style="display:none;">
      ${renderPlayerRecords(holdings || [])}
    </div>
    <div class="lt-panel" id="lt-panel-awards" style="display:none;">
      <p style="color:#8b949e;padding:1.5rem 0;">No awards on file.</p>
    </div>`;
}

// ── Skater / Goalie tab switcher ───────────────────────────────────────────

function renderPlayerModeTabs(skaterStats, goalieStats, lastGames, defaultIsGoalie, holdings) {
  const hasSkater = skaterStats.length > 0;
  const hasGoalie = goalieStats.length > 0;

  const skaterActive = !defaultIsGoalie || !hasGoalie;
  const goalieActive = !skaterActive;

  const skaterBtnClass = `sg-tab${skaterActive ? ' sg-tab-active' : ''}`;
  const goalieBtnClass = `sg-tab${goalieActive ? ' sg-tab-active' : ''}`;

  const skaterContent = hasSkater
    ? renderLeagueSections(skaterStats, lastGames, false, holdings)
    : '<p style="color:#8b949e;padding:1rem 0;">No skater stats on file.</p>';

  const goalieContent = hasGoalie
    ? renderLeagueSections(goalieStats, lastGames, true, holdings)
    : '<p style="color:#8b949e;padding:1rem 0;">No goalie stats on file.</p>';

  return `
    <div class="sg-tabs">
      <button class="${skaterBtnClass}" data-sg="skater">⛸ Skater</button>
      <button class="${goalieBtnClass}" data-sg="goalie">🥅 Goalie</button>
    </div>
    <div id="sg-panel-skater" style="${goalieActive ? 'display:none;' : ''}">${skaterContent}</div>
    <div id="sg-panel-goalie" style="${skaterActive ? 'display:none;' : ''}">${goalieContent}</div>
  `;
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
    const { player, isGoalie, skaterStats, goalieStats, seasonTeamStats, lastGames } = await res.json();

    // Also fetch record holdings (non-blocking)
    const recordsRes = await fetch(`${API}/players/records/${encodeURIComponent(name)}`).catch(() => null);
    const recordsData = recordsRes && recordsRes.ok ? await recordsRes.json().catch(() => null) : null;
    const holdings = recordsData ? recordsData.holdings : [];

    document.title = `${name} – EHL`;

    // Position label
    const pos = isGoalie ? 'G' :
      (player ? (player.user_position || player.player_position || '–') : (seasonTeamStats[0]?.position || '–'));

    // Career aggregate for hero stat boxes
    const career = seasonTeamStats.length
      ? (isGoalie ? sumGoalieRows(seasonTeamStats) : sumSkaterRows(seasonTeamStats))
      : null;
    const totalGP  = career?.gp ?? 0;
    const totalPts = isGoalie ? null : (career?.points ?? 0);
    const totalPM  = isGoalie ? null : (career?.plus_minus ?? 0);
    const totalWins = isGoalie ? (career?.goalie_wins ?? 0) : null;
    const totalLoss = isGoalie ? (career?.goalie_losses ?? 0) : null;
    const careerSvp = (isGoalie && career?.shots_against > 0)
      ? (career.saves / career.shots_against).toFixed(3).replace(/^0(?=\.)/, '')
      : null;
    const pmStr = totalPM === null ? null : (totalPM >= 0 ? `+${totalPM}` : String(totalPM));

    const statBoxes = isGoalie
      ? [
          { label: 'GP',  value: totalGP },
          { label: 'W',   value: totalWins },
          { label: 'SV%', value: careerSvp ?? '–' },
        ]
      : [
          { label: 'GP',  value: totalGP },
          { label: 'PTS', value: totalPts },
          { label: '+/–', value: pmStr },
        ];

    // Hero colors from team
    const c1 = player?.color1 || '#1c2128';
    const c2 = player?.color2 || '#0d1117';

    // Hero team logo or placeholder
    const heroLogo = (player?.team_logo)
      ? `<img src="${player.team_logo}" class="phl-hero-logo" alt="${player.team_name || ''}">`
      : `<div class="phl-hero-logo-ph">🏒</div>`;

    // Sidebar: team badge link or FA
    const sideTeam = (player?.team_id && player?.is_rostered)
      ? `<a href="team.html?id=${player.team_id}" class="phl-team-link">
           ${player.team_logo ? `<img src="${player.team_logo}" alt="${player.team_name}">` : ''}
           ${player.team_name}
         </a>`
      : `<p class="phl-fa">Free Agent</p>`;

    // Sidebar career info rows
    const uniqueSeasons = new Set(seasonTeamStats.map(r => r.season_id)).size;
    const infoRows = [];
    infoRows.push({ label: 'Seasons', value: uniqueSeasons || 0 });
    infoRows.push({ label: 'Position', value: isGoalie ? 'Goalie' : (pos !== '–' ? pos : '–') });
    if (player?.number) infoRows.push({ label: 'Number', value: `#${player.number}` });
    if (player?.platform) infoRows.push({ label: 'Platform', value: player.platform === 'psn' ? '🎮 PSN' : '🎮 Xbox' });
    if (player?.discord)  infoRows.push({ label: 'Discord', value: player.discord });

    const infoHtml = infoRows
      .map(r => `<div class="phl-info-row"><span class="phl-info-label">${r.label}</span><span class="phl-info-value">${r.value}</span></div>`)
      .join('');

    // Sidebar record holdings summary (for Career Info card)
    const recordsInfoHtml = holdings.length > 0
      ? `<div class="phl-info-row"><span class="phl-info-label">Records</span><span class="phl-info-value" style="color:#e3b341;">🏆 ${holdings.length} held</span></div>`
      : '';

    const html = `
      <div class="phl-hero" style="--c1:${c1};--c2:${c2};">
        ${heroLogo}
        <div class="phl-hero-info">
          <div class="phl-hero-pos">${isGoalie ? 'G' : pos}</div>
          <h1 class="phl-hero-name">${name}</h1>
          <div class="phl-hero-team">${player?.team_name || 'Free Agent'}</div>
        </div>
        <div class="phl-hero-stats">
          ${statBoxes.map(s => `<div class="phl-stat-box"><div class="phl-stat-label">${s.label}</div><div class="phl-stat-val">${s.value ?? '–'}</div></div>`).join('')}
        </div>
      </div>

      <div class="phl-body">
        <aside class="phl-sidebar">
          <div class="phl-card">
            <div class="phl-avatar">🏒</div>
            ${sideTeam}
          </div>
          <div class="phl-card">
            <h3 class="phl-card-heading">Career Info</h3>
            ${infoHtml}
            ${recordsInfoHtml}
          </div>
        </aside>
        <div class="phl-main">
          ${renderPlayerModeTabs(skaterStats || [], goalieStats || [], lastGames, isGoalie, holdings)}
        </div>
      </div>
    `;

    root.innerHTML = html;

    // Wire up Skater / Goalie top-level tabs
    root.querySelectorAll('.sg-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const sg = btn.dataset.sg;
        if (sg !== 'skater' && sg !== 'goalie') return;
        root.querySelectorAll('.sg-tab').forEach(b => b.classList.remove('sg-tab-active'));
        btn.classList.add('sg-tab-active');
        root.querySelectorAll('[id^="sg-panel-"]').forEach(p => { p.style.display = 'none'; });
        const panel = root.querySelector(`#sg-panel-${sg}`);
        if (panel) panel.style.display = '';
      });
    });

    // Wire up league-type tab buttons scoped to their parent sg-panel
    root.querySelectorAll('[id^="sg-panel-"]').forEach(sgPanel => {
      sgPanel.querySelectorAll('.lt-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          const lt = btn.dataset.lt;
          if (!LT_TABS.some(t => t.key === lt) && !LT_EXTRA_TABS.includes(lt)) return;
          sgPanel.querySelectorAll('.lt-tab').forEach(b => b.classList.remove('lt-tab-active'));
          btn.classList.add('lt-tab-active');
          sgPanel.querySelectorAll('.lt-panel').forEach(p => { p.style.display = 'none'; });
          const panel = sgPanel.querySelector(`#lt-panel-${lt}`);
          if (panel) panel.style.display = '';
        });
      });
    });
  } catch (err) {
    root.innerHTML = `<p class="error">Failed to load player: ${err.message}</p>`;
  }
}

loadPlayer();
