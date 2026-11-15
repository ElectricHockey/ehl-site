const API = '/api';
const LEAGUE_TYPE_STORAGE = 'ehl_league_type';

// League type keys — must match values stored in the seasons.league_type column
const LT_SIXES  = 'sixes';
const LT_THREES = 'threes';
const LT_TABS   = [
  { key: LT_SIXES,  label: "6's" },
  { key: LT_THREES, label: "3's" },
];
// Extra (non-league) tabs on the player profile
const LT_EXTRA_TABS = ['records', 'awards'];

function getPreferredLeagueType() {
  const qp = new URLSearchParams(window.location.search).get('league');
  if (qp === LT_THREES || qp === LT_SIXES) {
    localStorage.setItem(LEAGUE_TYPE_STORAGE, qp);
    return qp;
  }
  const saved = localStorage.getItem(LEAGUE_TYPE_STORAGE);
  return (saved === LT_THREES || saved === LT_SIXES) ? saved : LT_THREES;
}

function setupPlayerLeagueSwitch(preferredLt) {
  const switcher = document.getElementById('player-league-switch');
  if (!switcher) return;
  switcher.querySelectorAll('[data-player-league]').forEach(link => {
    const url = new URL(window.location.href);
    const league = link.dataset.playerLeague;
    url.searchParams.set('league', league);
    if (league !== preferredLt) url.searchParams.delete('season_id');
    link.href = url.href;
    if (league === preferredLt) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatClock(s) {
  if (!s) { return '0:00'; }
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}
function formatToi(s) {
  if (!s) return '0:00';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}
function fmt1(v) { return v !== null && v !== undefined ? Number(v).toFixed(1) : '–'; }
function pct3(v) {
  if (v === null || v === undefined) return '–';
  const num = Number(v);
  const frac = num > 1 ? num / 100 : num;
  return frac.toFixed(3).replace(/^0(?=\.)/, '');
}
function computeOvr(p) {
  return p.overall_rating !== null && p.overall_rating !== undefined && Number(p.overall_rating_count) > 0
    ? Number(p.overall_rating) : null;
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
    saucer_passes: 0, pk_clears: 0, player_wins: 0, player_losses: 0, player_otl: 0,
    goal_support: 0, _gs_sum: 0,
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
    tot.saucer_passes += Number(r.saucer_passes) || 0;
    tot.pk_clears += Number(r.pk_clears) || 0;
    tot.player_wins += Number(r.player_wins) || 0;
    tot.player_losses += Number(r.player_losses) || 0;
    tot.player_otl += Number(r.player_otl) || 0;
    tot._gs_sum += (Number(r.goal_support) || 0) * (Number(r.gp) || 0);
    if (r.apt) { tot._apt_sum += Number(r.apt) * (Number(r.gp) || 1); tot._apt_gp += Number(r.gp) || 1; }
    tot.toi += Number(r.toi) || 0;
    if (Number(r.overall_rating_count) > 0) { tot._or_sum += Number(r.overall_rating_sum); tot._r_count += Number(r.overall_rating_count); }
    if (Number(r.offensive_rating) > 0)    tot._offr_sum += Number(r.offensive_rating);
    if (Number(r.defensive_rating) > 0)    tot._dr_sum   += Number(r.defensive_rating);
    if (Number(r.team_play_rating) > 0)    tot._tpr_sum  += Number(r.team_play_rating);
  }
  const n = tot._r_count || 1;
  tot.overall_rating    = tot._r_count ? Math.round(tot._or_sum   / n) : 0;
  tot.overall_rating_count = tot._r_count;
  tot.offensive_rating  = tot._r_count ? Math.round(tot._offr_sum / n) : 0;
  tot.defensive_rating  = tot._r_count ? Math.round(tot._dr_sum   / n) : 0;
  tot.team_play_rating  = tot._r_count ? Math.round(tot._tpr_sum  / n) : 0;
  tot.fow_pct = tot.faceoff_total > 0 ? Math.round(tot.faceoff_wins * 100 / tot.faceoff_total * 10) / 10 : null;
  tot.shot_pct = tot.shots > 0 ? Math.round(tot.goals * 100 / tot.shots * 10) / 10 : null;
  tot.pass_pct_calc = tot.pass_attempts > 0 ? Math.round(tot.pass_completions * 100 / tot.pass_attempts * 10) / 10 : null;
  tot.apt = tot._apt_gp > 0 ? Math.round(tot._apt_sum / tot._apt_gp) : 0;
  tot.goal_support = tot.gp > 0 ? Math.round(tot._gs_sum / tot.gp * 100) / 100 : 0;
  return tot;
}

function sumGoalieRows(rows) {
  const tot = {
    name: 'Career Total', team_name: '', team_logo: null,
    gp: 0, goals: 0, assists: 0,
    saves: 0, goals_against: 0, shots_against: 0, toi: 0,
    shutouts: 0, penalty_shot_attempts: 0, penalty_shot_ga: 0,
    breakaway_shots: 0, breakaway_saves: 0,
    desperation_saves: 0, poke_check_saves: 0,
    goalie_wins: 0, goalie_losses: 0, goalie_otw: 0, goalie_otl: 0,
    goal_support: 0, _gs_sum: 0,
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
    tot.desperation_saves += Number(r.desperation_saves) || 0;
    tot.poke_check_saves += Number(r.poke_check_saves) || 0;
    tot.goalie_wins += Number(r.goalie_wins) || 0;
    tot.goalie_losses += Number(r.goalie_losses) || 0;
    tot.goalie_otw += Number(r.goalie_otw) || 0;
    tot.goalie_otl += Number(r.goalie_otl) || 0;
    tot._gs_sum += (Number(r.goal_support) || 0) * (Number(r.gp) || 0);
    if (Number(r.overall_rating_count) > 0) { tot._or_sum += Number(r.overall_rating_sum); tot._r_count += Number(r.overall_rating_count); }
    if (Number(r.offensive_rating) > 0)  tot._offr_sum += Number(r.offensive_rating);
    if (Number(r.defensive_rating) > 0)  tot._dr_sum   += Number(r.defensive_rating);
    if (Number(r.team_play_rating) > 0)  tot._tpr_sum  += Number(r.team_play_rating);
  }
  const n = tot._r_count || 1;
  tot.overall_rating    = tot._r_count ? Math.round(tot._or_sum   / n) : 0;
  tot.overall_rating_count = tot._r_count;
  tot.offensive_rating  = tot._r_count ? Math.round(tot._offr_sum / n) : 0;
  tot.defensive_rating  = tot._r_count ? Math.round(tot._dr_sum   / n) : 0;
  tot.team_play_rating  = tot._r_count ? Math.round(tot._tpr_sum  / n) : 0;
  tot.save_pct = tot.shots_against > 0 ? tot.saves / tot.shots_against : null;
  tot.gaa = tot.toi > 0 ? Math.round(tot.goals_against * 3600 / tot.toi * 100) / 100 : null;
  tot.shots_per_game = tot.gp > 0 ? Math.round((tot.shots_against / tot.gp) * 10) / 10 : null;
  tot.goal_support = tot.gp > 0 ? Math.round(tot._gs_sum / tot.gp * 100) / 100 : 0;
  return tot;
}

function playerHeroBoxes(rows, isGoalie, league) {
  const leagueRows = rows.filter(r => r.league_type === league);
  const career = isGoalie ? sumGoalieRows(leagueRows) : sumSkaterRows(leagueRows);
  const boxes = [
    { label: 'GP', value: career.gp },
    { label: 'Overall', value: computeOvr(career), title: 'Career average of rated games, including playoffs' },
  ];
  if (isGoalie) {
    const sv = career.shots_against > 0 ? (career.saves / career.shots_against).toFixed(3).replace(/^0(?=\.)/, '') : '–';
    boxes.push({ label: 'W', value: career.goalie_wins }, { label: 'SV%', value: sv });
  } else {
    const pm = career.plus_minus;
    boxes.push({ label: 'PTS', value: career.points }, { label: '+/–', value: pm >= 0 ? `+${pm}` : String(pm) });
  }
  return boxes;
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

function cleanSeasonName(name) {
  if (!name) return 'No Season';
  return name.replace(/\s*playoffs?$/i, '').trim() || name;
}

function getSeasonSortVal(seasonName, sortOrder, seasonId) {
  const match = (seasonName || '').match(/\d+/);
  if (match) return parseInt(match[0], 10);
  if (sortOrder != null && sortOrder !== 0) return -sortOrder * 100;
  return seasonId || 0;
}

function renderCareerTable(seasonTeamStats, isGoalie) {
  if (!seasonTeamStats.length) return '<p style="color:#8b949e;">No stats recorded yet.</p>';

  // Group rows by canonical season name so regular season and playoffs stay together under one season banner
  const seasonGroups = [];
  const seasonMap = {};

  for (const r of seasonTeamStats) {
    const sName = cleanSeasonName(r.season_name);
    const key = (r.season_id ? `s_${r.season_id}` : sName.toLowerCase());
    const isPl = !!(r.is_playoff || (r.season_name && /playoffs?$/i.test(r.season_name)));

    let grp = seasonMap[key] || seasonMap[sName.toLowerCase()];
    if (!grp) {
      grp = {
        season_id: r.season_id,
        season_name: sName,
        _sort_val: getSeasonSortVal(sName, r._sort_order, r.season_id),
        regularRows: [],
        playoffRows: [],
      };
      seasonMap[key] = grp;
      seasonMap[sName.toLowerCase()] = grp;
      seasonGroups.push(grp);
    }

    if (isPl) {
      grp.playoffRows.push(r);
    } else {
      grp.regularRows.push(r);
    }
  }

  // Sort seasons oldest first (ascending season number / sort order)
  seasonGroups.sort((a, b) => a._sort_val - b._sort_val);

  const regularRows = seasonTeamStats.filter(r => !r.is_playoff && !/playoffs?$/i.test(r.season_name || ''));
  const playoffRows = seasonTeamStats.filter(r => r.is_playoff || /playoffs?$/i.test(r.season_name || ''));
  const hasPlayoffs = playoffRows.length > 0;

  const thead = isGoalie ? goalieThead() : skaterThead();
  const rowFn = isGoalie ? goalieRow : skaterRow;

  let html = `<div style="overflow-x:auto;max-width:100%;"><table class="season-stats-table">
    ${thead}<tbody>`;

  for (const group of seasonGroups) {
    const { season_name, regularRows: rRows, playoffRows: pRows } = group;

    // Main season header (clean season name, e.g. "📅 Season 6")
    html += `<tr class="season-header-row"><td colspan="99" style="background:linear-gradient(90deg,#1b2432 0%,#161b22 100%);color:#f0f6fc;font-size:0.88rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;padding:0.55rem 0.75rem;border-left:4px solid #58a6ff;border-top:1px solid #30363d;border-bottom:1px solid #30363d;">📅 ${season_name}</td></tr>`;

    // Regular season rows
    for (const r of rRows) html += rowFn(r);
    if (rRows.length > 1) {
      const regTot = isGoalie ? sumGoalieRows(rRows) : sumSkaterRows(rRows);
      regTot.team_name = 'Season Total';
      regTot.team_logo = null;
      html += rowFn(regTot, 'season-total-row');
    }

    // Playoff rows (placed directly below regular season stats under compact playoffs sub-header)
    if (pRows.length > 0) {
      html += `<tr class="playoffs-header-row"><td colspan="99" style="background:#181512;color:#f0883e;font-size:0.78rem;font-weight:700;letter-spacing:0.06em;padding:0.35rem 0.75rem;border-left:3px solid #f0883e;border-top:1px solid #28211b;border-bottom:1px solid #28211b;">🏆 Playoffs</td></tr>`;
      for (const r of pRows) html += rowFn(r);
      if (pRows.length > 1) {
        const plTot = isGoalie ? sumGoalieRows(pRows) : sumSkaterRows(pRows);
        plTot.team_name = 'Playoff Total';
        plTot.team_logo = null;
        html += rowFn(plTot, 'season-total-row');
      }
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

// ── Game log ───────────────────────────────────────────────────────────────

function gameLogSeasonKey(game) {
  return game.season_id == null ? '' : String(game.season_id);
}

function gameLogSeasons(games) {
  const seasons = new Map();
  for (const game of games) {
    const key = gameLogSeasonKey(game);
    if (!seasons.has(key)) {
      seasons.set(key, { key, name: game.season_name || 'No Season', active: false, latest: '' });
    }
    const season = seasons.get(key);
    season.active ||= Number(game.season_is_active) === 1;
    if ((game.date || '') > season.latest) season.latest = game.date;
  }
  return [...seasons.values()].sort((a, b) => b.latest.localeCompare(a.latest));
}

function escapePlayerHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderSeasonGameLog(games, isGoalie) {
  if (!games.length) return renderLastGames([], '', isGoalie);
  const seasons = gameLogSeasons(games);
  const selected = seasons.find(s => s.active) || seasons[0];
  return `<div class="player-game-log">
    <label>Season: <select class="game-log-season" aria-label="Game log season">
      ${seasons.map(s => `<option value="${escapePlayerHtml(s.key)}"${s.key === selected.key ? ' selected' : ''}>${escapePlayerHtml(s.name)}</option>`).join('')}
    </select></label>
    <div class="game-log-content">${renderLastGames(games.filter(g => gameLogSeasonKey(g) === selected.key), '', isGoalie)}</div>
  </div>`;
}

function renderLastGames(lastGames, name, isGoalie) {
  if (!lastGames.length) return '<p style="color:#8b949e;">No recent games.</p>';

  const renderGame = g => {
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
    const ovr = GameRating.calculate(g);
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
        <td>${g.poke_check_saves || 0}</td><td>${g.desperation_saves || 0}</td>
        <td>${Math.max(0, (g.penalty_shot_attempts || 0) - (g.penalty_shot_ga || 0))}</td><td>${g.penalty_shot_ga || 0}</td>
        <td>${g.breakaway_shots || 0}</td><td>${g.breakaway_saves || 0}</td>
        <td>${bksvp}</td>
        <td>${formatToi(g.toi)}</td>
        <td>${g.goal_support ?? 0}</td>
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
        <td>${g.shots || 0}/${g.shot_attempts || 0}</td><td>${shot_pct}</td>
        <td>${g.hits || 0}</td><td>${g.blocked_shots || 0}</td>
        <td>${g.takeaways || 0}</td><td>${g.giveaways || 0}</td>
        <td>${g.pim || 0}</td><td>${g.penalties_drawn || 0}</td><td>${g.pk_clears || 0}</td>
        <td>${g.pp_goals || 0}</td><td>${g.sh_goals || 0}</td><td>${g.gwg || 0}</td>
        <td>${g.faceoff_wins || 0}</td><td>${g.faceoff_losses || 0}</td><td>${fow_pct}</td>
        <td>${g.deflections || 0}</td><td>${g.interceptions || 0}</td>
        <td>${g.pass_attempts || 0}</td><td>${g.pass_completions || 0}</td><td>${pass_pct}</td>
        <td>${g.saucer_passes || 0}</td>
        <td>${g.hat_tricks || 0}</td>
        <td>${formatClock(g.possession_secs)}</td>
        <td>${formatToi(g.toi)}</td>
        <td>${g.goal_support ?? 0}</td>
      </tr>`;
    }
  };

  const skaterHead = `
    <th data-tip="Goals">G</th><th data-tip="Assists">A</th><th data-tip="Points">PTS</th>
    <th data-tip="Plus / Minus">+/-</th>
    <th data-tip="Shots on Goal / Shot Attempts">SOG</th><th data-tip="Shooting %">S%</th>
    <th data-tip="Hits">HIT</th><th data-tip="Blocked Shots">BS</th>
    <th data-tip="Takeaways">TKA</th><th data-tip="Giveaways">GVA</th>
    <th data-tip="Penalty Minutes">PIM</th><th data-tip="Penalties Drawn">PD</th><th data-tip="PK Clears">PKC</th>
    <th data-tip="Power Play Goals">PPG</th><th data-tip="Short-Hand Goals">SHG</th><th data-tip="Game-Winning Goals">GWG</th>
    <th data-tip="Faceoff Wins">FOW</th><th data-tip="Faceoff Losses">FOL</th><th data-tip="Faceoff Win %">FOW%</th>
    <th data-tip="Deflections">DLF</th><th data-tip="Interceptions">INT</th>
    <th data-tip="Pass Attempts">PA</th><th data-tip="Pass Completions">PC</th><th data-tip="Pass Completion %">PC%</th>
    <th data-tip="Saucer Passes">SP</th>
    <th data-tip="Hat Tricks">HT</th>
    <th data-tip="Avg Puck Possession">POSS</th>
    <th data-tip="Time on Ice">TOI</th>
    <th data-tip="Goal Support – team goals scored while playing">GS</th>`;

  const goalieHead = `
    <th data-tip="Goals">G</th><th data-tip="Assists">A</th>
    <th data-tip="Shots Against">SA</th><th data-tip="Goals Against">GA</th>
    <th data-tip="Save Percentage">SV%</th><th data-tip="Shutouts">SO</th>
    <th data-tip="Poke Check Saves">PCHK</th><th data-tip="Desperation Saves">DSV</th>
    <th data-tip="Penalty Shot Saves">PSS</th><th data-tip="Penalty Shot Goals Against">PSGA</th>
    <th data-tip="Breakaway Shots Against">BKSA</th><th data-tip="Breakaway Saves">BKSV</th>
    <th data-tip="Breakaway Save %">BKS%</th>
    <th data-tip="Time on Ice">TOI</th>
    <th data-tip="Goal Support – team goals scored while playing">GS</th>`;

  const playoffGames = lastGames.filter(g => Number(g.is_playoff) === 1);
  const regularGames = lastGames.filter(g => Number(g.is_playoff) !== 1);
  const divider = label => `<tr class="game-log-divider"><td colspan="${isGoalie ? 21 : 35}"><div class="game-log-divider-label">${label}</div></td></tr>`;
  const rows = (playoffGames.length ? divider('Playoffs') + playoffGames.map(renderGame).join('') : '') +
    (playoffGames.length && regularGames.length ? divider('Regular Season') : '') + regularGames.map(renderGame).join('');

  return `<div class="game-log-scroll" role="region" aria-label="Player game log" tabindex="0"><table class="last-games-table">
    <thead><tr>
      <th>Date</th><th></th><th>Score</th><th>Opponent</th>
      <th data-tip="Position played">POS</th>
      <th data-tip="Overall Rating">OVR</th>
      ${isGoalie ? goalieHead : skaterHead}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function sizeGameLogs(root) {
  root.querySelectorAll('.game-log-scroll').forEach(container => {
    const table = container.querySelector('table');
    const rows = table.querySelectorAll('tbody tr:not(.game-log-divider)');
    if (rows.length <= 5 || !table.getBoundingClientRect().height) return;
    const scrollbarHeight = container.offsetHeight - container.clientHeight;
    const height = rows[4].getBoundingClientRect().bottom - container.getBoundingClientRect().top + container.scrollTop;
    container.style.maxHeight = `${Math.ceil(height + scrollbarHeight)}px`;
  });
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
        <td style="padding:0.4rem 0.5rem;font-size:0.8rem;color:#58a6ff;">${scope}${lt ? ' · ' + lt : ''}${r.season_type === 'playoffs' ? ' · <span style="color:#e3b341;">Playoffs</span>' : r.season_type === 'regular' ? ' · Regular' : ''}</td>
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

  function groupRows(arr) {
    const alltime    = arr.filter(h => h.category === 'alltime');
    const seasonal   = arr.filter(h => h.category === 'seasonal');
    const singlegame = arr.filter(h => h.category === 'singlegame');
    return { alltime, seasonal, singlegame };
  }

  const grouped = groupRows(holdings);
  const html =
    buildSection('All-Time Records', grouped.alltime) +
    buildSection('Single-Season Records', grouped.seasonal) +
    buildSection('Single-Game Records', grouped.singlegame);

  return html || '<p style="color:#8b949e;padding:1.5rem 0;">This player does not currently hold any records.</p>';
}

// ── League-type tab rendering ──────────────────────────────────────────────

function renderLeagueSections(seasonTeamStats, lastGames, isGoalie, holdings, preferredLt, playerAwards) {
  const selectedLt = LT_TABS.some(t => t.key === preferredLt) ? preferredLt : LT_THREES;
  const filteredStats = seasonTeamStats.filter(r => (r.league_type || '') === selectedLt);
  const filteredGames = lastGames.filter(g => (g.league_type || '') === selectedLt && ((g.position === 'G') === !!isGoalie));
  const statsContent = filteredStats.length || filteredGames.length
    ? `
      <h2 class="section-heading" style="margin-top:0.75rem;">🕐 Game Log</h2>
      ${renderSeasonGameLog(filteredGames, isGoalie)}
      <h2 class="section-heading">📊 Career Stats</h2>
      ${renderCareerTable(filteredStats, isGoalie)}
    `
    : '<p style="color:#8b949e;padding:1.5rem 0;">No stats on file for the selected league.</p>';

  const tabButtons = [
    '<button class="lt-tab lt-tab-active" data-lt="stats">Stats</button>',
    '<span style="flex:1;"></span>',
    `<button class="lt-tab" data-lt="records">Records</button>`,
    `<button class="lt-tab" data-lt="awards">Awards</button>`,
  ].join('');

  const awardsContent = playerAwards === null
    ? '<p style="color:#8b949e;padding:1.5rem 0;">Loading awards…</p>'
    : renderPlayerAwards(playerAwards || []);

  return `<div class="lt-tabs">${tabButtons}</div>
    <div class="lt-panel" id="lt-panel-stats">
      ${statsContent}
    </div>
    <div class="lt-panel" id="lt-panel-records" style="display:none;">
      ${holdings === null ? '<p style="color:#8b949e;padding:1.5rem 0;">Loading records…</p>' : renderPlayerRecords(holdings || [])}
    </div>
    <div class="lt-panel" id="lt-panel-awards" style="display:none;">
      ${awardsContent}
    </div>`;
}

function renderPlayerAwards(awards) {
  if (!awards || awards.length === 0) return '<p style="color:#8b949e;padding:1.5rem 0;">No awards on file.</p>';

  // Group by season
  const bySeason = {};
  for (const a of awards) {
    const key = a.season_id;
    if (!bySeason[key]) bySeason[key] = { season_name: a.season_name, league_type: a.league_type, awards: [] };
    bySeason[key].awards.push(a);
  }

  return Object.values(bySeason).map(s => `
    <h3 style="font-size:0.88rem;text-transform:uppercase;letter-spacing:0.08em;color:#8b949e;margin:1.25rem 0 0.6rem;">${s.season_name}${s.league_type === LT_THREES ? " · 3's" : s.league_type === LT_SIXES ? " · 6's" : ''}</h3>
    <div style="display:flex;flex-wrap:wrap;gap:0.75rem;">
      ${s.awards.map(a => `
        <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:0.6rem 0.8rem;display:flex;align-items:center;gap:0.6rem;min-width:160px;max-width:220px;">
          ${a.award_image_url
            ? `<img src="${a.award_image_url}" style="width:36px;height:36px;object-fit:contain;border-radius:4px;background:#21262d;flex-shrink:0;" alt="" />`
            : `<div style="width:36px;height:36px;flex-shrink:0;background:#21262d;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🏆</div>`}
          <div>
            <div style="font-weight:700;font-size:0.85rem;color:#e6edf3;line-height:1.2;">${a.award_name}</div>
            ${a.notes ? `<div style="font-size:0.74rem;color:#8b949e;">${a.notes}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// ── Skater / Goalie tab switcher ───────────────────────────────────────────

function renderPlayerModeTabs(skaterStats, goalieStats, lastGames, defaultIsGoalie, holdings, preferredLt, playerAwards) {
  const hasGoalie = goalieStats.length > 0;

  const skaterActive = !defaultIsGoalie || !hasGoalie;
  const goalieActive = !skaterActive;

  const skaterBtnClass = `sg-tab${skaterActive ? ' sg-tab-active' : ''}`;
  const goalieBtnClass = `sg-tab${goalieActive ? ' sg-tab-active' : ''}`;

  const skaterContent = renderLeagueSections(skaterStats, lastGames, false, holdings, preferredLt, playerAwards);
  const goalieContent = renderLeagueSections(goalieStats, lastGames, true, holdings, preferredLt, playerAwards);

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
  const preferredLt = getPreferredLeagueType();
  setupPlayerLeagueSwitch(preferredLt);
  if (!name) {
    root.innerHTML = '<p class="error">No player name specified.</p>';
    return;
  }

  try {
    const encodedName = encodeURIComponent(name);
    const selectedSeasonId = params.get('season_id');
    const profileQs = new URLSearchParams();
    if (selectedSeasonId) profileQs.set('season_id', selectedSeasonId);
    if (preferredLt) profileQs.set('league_type', preferredLt);
    const profileUrl = `${API}/players/profile/${encodedName}${profileQs.toString() ? `?${profileQs.toString()}` : ''}`;
    const fetchExtra = async url => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { data: await response.json() };
      } catch (error) {
        return { error };
      }
    };
    const recordsPromise = fetchExtra(`${API}/players/records/${encodedName}`);
    const awardsPromise = fetchExtra(`${API}/players/awards/${encodedName}`);
    const res = await fetch(profileUrl);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      root.innerHTML = `<p class="error">${err.error || 'Player not found.'}</p>`;
      return;
    }
    const { player, activeProfileTeam, isGoalie: defaultIsGoalie, skaterStats, goalieStats, lastGames } = await res.json();
    const hasLeagueSkater = skaterStats.some(r => r.league_type === preferredLt);
    const hasLeagueGoalie = goalieStats.some(r => r.league_type === preferredLt);
    const isGoalie = hasLeagueGoalie && !hasLeagueSkater ? true
      : hasLeagueSkater && !hasLeagueGoalie ? false : defaultIsGoalie;
    const seasonTeamStats = isGoalie ? goalieStats : skaterStats;

    document.title = `${name} – EHL`;

    // Position label
    const pos = isGoalie ? 'G' :
      (player ? (player.user_position || player.player_position || '–') : (seasonTeamStats[0]?.position || '–'));

    // Career aggregate for hero stat boxes – scoped to the selected league
    const ltSeasonStats = seasonTeamStats.filter(r => (r.league_type || '') === preferredLt);
    const career = ltSeasonStats.length
      ? (isGoalie ? sumGoalieRows(ltSeasonStats) : sumSkaterRows(ltSeasonStats))
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

    const heroBoxes = {
      skater: playerHeroBoxes(skaterStats, false, preferredLt),
      goalie: playerHeroBoxes(goalieStats, true, preferredLt),
    };
    const heroBoxesHtml = goalie => heroBoxes[goalie ? 'goalie' : 'skater']
      .map(s => `<div class="phl-stat-box"${s.title ? ` title="${s.title}"` : ''}><div class="phl-stat-label">${s.label}</div><div class="phl-stat-val">${s.value ?? '–'}</div></div>`).join('');
    const heroGoalieDefault = isGoalie && (goalieStats || []).length > 0;

    // Hero colors from team
    const c1 = activeProfileTeam?.color1 || '#1c2128';
    const c2 = activeProfileTeam?.color2 || '#0d1117';

    const displayTeam = (activeProfileTeam && activeProfileTeam.team_id)
      ? {
          team_id: activeProfileTeam.team_id,
          team_name: activeProfileTeam.team_name,
          team_logo: activeProfileTeam.team_logo,
          is_rostered: 1,
          season_id: activeProfileTeam.season_id,
        }
      : null;

    // Hero team logo or placeholder
    const heroLogo = (displayTeam?.team_logo)
      ? `<img src="${displayTeam.team_logo}" class="phl-hero-logo" alt="${displayTeam.team_name || ''}">`
      : `<div class="phl-hero-logo-ph">🏒</div>`;

    // Sidebar: team badge link or FA
    const sideTeam = (displayTeam?.team_id && displayTeam?.is_rostered)
      ? `<a href="team.html?id=${displayTeam.team_id}${displayTeam.season_id ? `&season_id=${displayTeam.season_id}` : ''}" class="phl-team-link">
           ${displayTeam.team_logo ? `<img src="${displayTeam.team_logo}" alt="${displayTeam.team_name}">` : ''}
           ${displayTeam.team_name}
         </a>`
      : `<p class="phl-fa">Free Agent</p>`;

    // Sidebar career info rows
    const regularLeagueStats = [...skaterStats, ...goalieStats]
      .filter(r => r.league_type === preferredLt && !r.is_playoff && !/playoffs?$/i.test(r.season_name || ''));
    const uniqueSeasons = new Set(regularLeagueStats.map(r => r.season_id != null ? `id:${r.season_id}` : `name:${cleanSeasonName(r.season_name).toLowerCase()}`)).size;
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
    const html = `
      <div class="phl-hero" style="--c1:${c1};--c2:${c2};">
        ${heroLogo}
        <div class="phl-hero-info">
          <div class="phl-hero-pos">${isGoalie ? 'G' : pos}</div>
          <h1 class="phl-hero-name">${name}</h1>
          <div class="phl-hero-team">${displayTeam?.team_name || 'Free Agent'}</div>
        </div>
        <div class="phl-hero-stats">
          ${heroBoxesHtml(heroGoalieDefault)}
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
            <div data-player-extra-summary="records"></div>
            <div data-player-extra-summary="awards"></div>
          </div>
        </aside>
        <div class="phl-main">
          ${renderPlayerModeTabs(skaterStats || [], goalieStats || [], lastGames, isGoalie, null, preferredLt, null)}
        </div>
      </div>
    `;

    root.innerHTML = html;
    sizeGameLogs(root);
    window.addEventListener('resize', () => sizeGameLogs(root));

    root.querySelectorAll('.game-log-season').forEach(select => {
      select.addEventListener('change', () => {
        const isGoalieLog = !!select.closest('#sg-panel-goalie');
        const games = lastGames.filter(g => g.league_type === preferredLt &&
          (g.position === 'G') === isGoalieLog && gameLogSeasonKey(g) === select.value);
        select.closest('.player-game-log').querySelector('.game-log-content').innerHTML = renderLastGames(games, '', isGoalieLog);
        sizeGameLogs(root);
      });
    });

    recordsPromise.then(({ data, error }) => {
      const holdings = data?.holdings || [];
      root.querySelectorAll('[id="lt-panel-records"]').forEach(panel => {
        panel.innerHTML = error ? '<p class="error">Could not load player records.</p>' : renderPlayerRecords(holdings);
      });
      const summary = root.querySelector('[data-player-extra-summary="records"]');
      if (summary) summary.innerHTML = error ? '<div class="phl-info-row">Records unavailable</div>'
        : holdings.length ? `<div class="phl-info-row"><span class="phl-info-label">Records</span><span class="phl-info-value" style="color:#e3b341;">🏆 ${holdings.length} held</span></div>` : '';
      if (error) console.error('[player] records failed:', error);
    });
    awardsPromise.then(({ data, error }) => {
      const awards = data || [];
      root.querySelectorAll('[id="lt-panel-awards"]').forEach(panel => {
        panel.innerHTML = error ? '<p class="error">Could not load player awards.</p>'
          : renderPlayerAwards(awards);
      });
      const summary = root.querySelector('[data-player-extra-summary="awards"]');
      if (summary) summary.innerHTML = error ? '<div class="phl-info-row">Awards unavailable</div>'
        : awards.length ? `<div class="phl-info-row"><span class="phl-info-label">Awards</span><span class="phl-info-value" style="color:#e3b341;">🥇 ${awards.length} won</span></div>` : '';
      if (error) console.error('[player] awards failed:', error);
    });

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
        sizeGameLogs(root);
        const heroEl = root.querySelector('.phl-hero-stats');
        if (heroEl) heroEl.innerHTML = heroBoxesHtml(sg === 'goalie');
      });
    });

    // Wire up stats/records/awards tab buttons scoped to their parent sg-panel
    root.querySelectorAll('[id^="sg-panel-"]').forEach(sgPanel => {
      sgPanel.querySelectorAll('.lt-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          const lt = btn.dataset.lt;
          if (lt !== 'stats' && !LT_EXTRA_TABS.includes(lt)) return;
          sgPanel.querySelectorAll('.lt-tab').forEach(b => b.classList.remove('lt-tab-active'));
          btn.classList.add('lt-tab-active');
          sgPanel.querySelectorAll('.lt-panel').forEach(p => { p.style.display = 'none'; });
          const panel = sgPanel.querySelector(`#lt-panel-${lt}`);
          if (panel) panel.style.display = '';
          sizeGameLogs(root);
        });
      });
    });
  } catch (err) {
    root.innerHTML = `<p class="error">Failed to load player: ${err.message}</p>`;
  }
}

loadPlayer();
