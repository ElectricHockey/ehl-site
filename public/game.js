const API = '/api';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatToi(s) {
  if (!s) return '0:00';
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function fmt1(v) { return v !== null && v !== undefined ? Number(v).toFixed(1) : '–'; }
function pct3(v) {
  if (v === null || v === undefined) return '–';
  return (v < 1 ? (v * 100).toFixed(1) : Number(v).toFixed(1)) + '%';
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

// ── Normalize raw game_player_stats row for rendering ──────────────────────

function normalizePlayer(p) {
  const fot = (p.faceoff_wins || 0) + (p.faceoff_losses || 0);
  const shotPct = (p.shots || 0) > 0
    ? Math.round((p.goals || 0) * 100.0 / p.shots * 10) / 10 : null;
  const passPct = p.pass_pct !== null && p.pass_pct !== undefined
    ? p.pass_pct
    : ((p.pass_attempts || 0) > 0
        ? Math.round((p.pass_completions || 0) * 100.0 / p.pass_attempts * 10) / 10
        : null);
  const gaa = (p.toi || 0) > 0
    ? Math.round((p.goals_against || 0) * 3600.0 / p.toi * 100) / 100 : null;

  return {
    name: p.player_name,
    position: p.position,
    overall_rating: p.overall_rating || 0,
    defensive_rating: p.defensive_rating || 0,
    team_play_rating: p.team_play_rating || 0,
    // skater
    gp: 1,
    goals: p.goals || 0,
    assists: p.assists || 0,
    points: (p.goals || 0) + (p.assists || 0),
    plus_minus: p.plus_minus || 0,
    shots: p.shots || 0,
    hits: p.hits || 0,
    blocked_shots: p.blocked_shots || 0,
    takeaways: p.takeaways || 0,
    giveaways: p.giveaways || 0,
    pp_goals: p.pp_goals || 0,
    sh_goals: p.sh_goals || 0,
    gwg: p.gwg || 0,
    pim: p.pim || 0,
    penalties_drawn: p.penalties_drawn || 0,
    faceoff_wins: p.faceoff_wins || 0,
    faceoff_total: fot,
    fow_pct: fot > 0 ? Math.round((p.faceoff_wins || 0) * 100.0 / fot * 10) / 10 : null,
    shot_pct: shotPct,
    deflections: p.deflections || 0,
    interceptions: p.interceptions || 0,
    pass_attempts: p.pass_attempts || 0,
    pass_pct_calc: passPct,
    hat_tricks: p.hat_tricks || 0,
    apt: p.possession_secs || 0,
    toi: p.toi || 0,
    // goalie
    shots_against: p.shots_against || 0,
    goals_against: p.goals_against || 0,
    saves: p.saves || 0,
    save_pct: p.save_pct,
    gaa,
    shutouts: p.shutouts || 0,
    penalty_shot_attempts: p.penalty_shot_attempts || 0,
    penalty_shot_ga: p.penalty_shot_ga || 0,
    breakaway_shots: p.breakaway_shots || 0,
    breakaway_saves: p.breakaway_saves || 0,
    goalie_wins: p.goalie_wins || 0,
    goalie_losses: p.goalie_losses || 0,
    goalie_otw: p.goalie_otw || 0,
    goalie_otl: p.goalie_otl || 0,
  };
}

// ── Render tables ──────────────────────────────────────────────────────────

function renderSkaterTable(players) {
  if (!players.length) return '<p class="no-stats">No skater stats recorded.</p>';
  return `<div style="overflow-x:auto;"><table class="season-stats-table">
    <thead><tr>
      <th>Pos</th><th>Player</th>
      <th data-tip="Overall Rating (avg. of OR + DR + TPR)">OVR</th>
      <th data-tip="Offense Rating">OR</th>
      <th data-tip="Defense Rating">DR</th>
      <th data-tip="Team Play Rating">TPR</th>
      <th data-tip="Goals">G</th>
      <th data-tip="Assists">A</th>
      <th data-tip="Points">PTS</th>
      <th data-tip="Plus / Minus">+/-</th>
      <th data-tip="Shots on Goal">SOG</th>
      <th data-tip="Hits">HITS</th>
      <th data-tip="Blocked Shots">BS</th>
      <th data-tip="Takeaways">TKA</th>
      <th data-tip="Giveaways">GVA</th>
      <th data-tip="Power Play Goals">PPG</th>
      <th data-tip="Short-Hand Goals">SHG</th>
      <th data-tip="Game-Winning Goals">GWG</th>
      <th data-tip="Penalty Minutes">PIM</th>
      <th data-tip="Penalties Drawn">PD</th>
      <th data-tip="Faceoff Wins">FOW</th>
      <th data-tip="Faceoff Total">FOT</th>
      <th data-tip="Faceoff Win %">FOW%</th>
      <th data-tip="Shooting %">S%</th>
      <th data-tip="Deflections">DLF</th>
      <th data-tip="Interceptions">INT</th>
      <th data-tip="Pass Attempts">PA</th>
      <th data-tip="Pass Completion %">PC%</th>
      <th data-tip="Hat Tricks">HT</th>
      <th data-tip="Puck Possession (seconds)">POSS</th>
      <th data-tip="Time on Ice">TOI</th>
    </tr></thead>
    <tbody>${players.map(p => {
      const ovr = computeOvr(p);
      return `<tr>
        <td>${p.position || '–'}</td>
        <td>${p.name}</td>
        <td style="text-align:center;${ovrStyle(ovr)}">${ovr ?? '–'}</td>
        <td style="text-align:center;${ratingStyle(p.overall_rating)}">${p.overall_rating || '–'}</td>
        <td style="text-align:center;${ratingStyle(p.defensive_rating)}">${p.defensive_rating || '–'}</td>
        <td style="text-align:center;${ratingStyle(p.team_play_rating)}">${p.team_play_rating || '–'}</td>
        <td>${p.goals}</td>
        <td>${p.assists}</td>
        <td><strong>${p.points}</strong></td>
        <td>${p.plus_minus >= 0 ? '+' : ''}${p.plus_minus}</td>
        <td>${p.shots}</td>
        <td>${p.hits}</td>
        <td>${p.blocked_shots}</td>
        <td>${p.takeaways}</td>
        <td>${p.giveaways}</td>
        <td>${p.pp_goals}</td>
        <td>${p.sh_goals}</td>
        <td>${p.gwg}</td>
        <td>${p.pim}</td>
        <td>${p.penalties_drawn}</td>
        <td>${p.faceoff_wins}</td>
        <td>${p.faceoff_total}</td>
        <td>${p.fow_pct !== null ? fmt1(p.fow_pct) + '%' : '–'}</td>
        <td>${p.shot_pct !== null ? fmt1(p.shot_pct) + '%' : '–'}</td>
        <td>${p.deflections}</td>
        <td>${p.interceptions}</td>
        <td>${p.pass_attempts}</td>
        <td>${p.pass_pct_calc !== null && p.pass_pct_calc !== undefined ? fmt1(p.pass_pct_calc) + '%' : '–'}</td>
        <td>${p.hat_tricks}</td>
        <td>${p.apt}</td>
        <td>${formatToi(p.toi)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function renderGoalieTable(players) {
  if (!players.length) return '';
  return `<div style="overflow-x:auto;"><table class="season-stats-table">
    <thead><tr>
      <th>Player</th>
      <th data-tip="Overall Rating (avg. of OR + DR + TPR)">OVR</th>
      <th data-tip="Offense Rating">OR</th>
      <th data-tip="Defense Rating">DR</th>
      <th data-tip="Team Play Rating">TPR</th>
      <th data-tip="Shots Against">SA</th>
      <th data-tip="Goals Against">GA</th>
      <th data-tip="Save Percentage">SV%</th>
      <th data-tip="Goals Against Average">GAA</th>
      <th data-tip="Time on Ice">TOI</th>
      <th data-tip="Shutouts">SO</th>
      <th data-tip="Penalty Shot Attempts Against">PSA</th>
      <th data-tip="Penalty Shot Goals Against">PSGA</th>
      <th data-tip="Breakaway Shots Against">BKSA</th>
      <th data-tip="Breakaway Saves">BKSV</th>
      <th data-tip="Wins">W</th>
      <th data-tip="Losses">L</th>
      <th data-tip="Overtime Wins">OTW</th>
      <th data-tip="Overtime Losses">OTL</th>
    </tr></thead>
    <tbody>${players.map(p => {
      const ovr = computeOvr(p);
      return `<tr>
        <td>${p.name}</td>
        <td style="text-align:center;${ovrStyle(ovr)}">${ovr ?? '–'}</td>
        <td style="text-align:center;${ratingStyle(p.overall_rating)}">${p.overall_rating || '–'}</td>
        <td style="text-align:center;${ratingStyle(p.defensive_rating)}">${p.defensive_rating || '–'}</td>
        <td style="text-align:center;${ratingStyle(p.team_play_rating)}">${p.team_play_rating || '–'}</td>
        <td>${p.shots_against}</td>
        <td>${p.goals_against}</td>
        <td><strong>${pct3(p.save_pct)}</strong></td>
        <td>${p.gaa !== null ? p.gaa.toFixed(2) : '–'}</td>
        <td>${formatToi(p.toi)}</td>
        <td>${p.shutouts}</td>
        <td>${p.penalty_shot_attempts}</td>
        <td>${p.penalty_shot_ga}</td>
        <td>${p.breakaway_shots}</td>
        <td>${p.breakaway_saves}</td>
        <td>${p.goalie_wins}</td>
        <td>${p.goalie_losses}</td>
        <td>${p.goalie_otw}</td>
        <td>${p.goalie_otl}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

// ── Render one team panel ──────────────────────────────────────────────────

function renderTeamPanel(teamInfo, players) {
  const skaters = players.filter(p => (p.position || '').toUpperCase() !== 'G');
  const goalies = players.filter(p => (p.position || '').toUpperCase() === 'G');
  const logoHtml = teamInfo.logo_url
    ? `<img src="${teamInfo.logo_url}" class="team-panel-logo" alt="${teamInfo.name}" />`
    : '';

  return `<div class="team-panel">
    <div class="team-panel-header">
      ${logoHtml}
      <a href="team.html?id=${teamInfo.id}" class="team-panel-name">${teamInfo.name}</a>
    </div>
    ${skaters.length ? `<p class="stats-section-label">⛸️ Skaters</p>${renderSkaterTable(skaters)}` : ''}
    ${goalies.length ? `<p class="stats-section-label">🥅 Goalies</p>${renderGoalieTable(goalies)}` : ''}
    ${!skaters.length && !goalies.length ? '<p class="no-stats">No player stats recorded for this team.</p>' : ''}
  </div>`;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function loadGame() {
  const root = document.getElementById('game-root');
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) {
    root.innerHTML = '<p class="error">No game ID. <a href="recent-scores.html">Back to Recent Scores</a></p>';
    return;
  }

  try {
    const res = await fetch(`${API}/games/${id}/stats`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      root.innerHTML = `<p class="error">${err.error || 'Game not found.'} <a href="recent-scores.html">Back</a></p>`;
      return;
    }
    const { game, home_players, away_players, has_stats } = await res.json();

    document.title = `${game.home_team.name} vs ${game.away_team.name} – EHL`;

    const date = game.date
      ? new Date(game.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : '';
    const homeWin = game.home_score > game.away_score;
    const awayWin = game.away_score > game.home_score;
    const otBadge = game.is_overtime ? '<span class="ot-badge">OT</span>' : '';

    const logoImg = (team) => team.logo_url
      ? `<img src="${team.logo_url}" class="game-team-logo" alt="${team.name}" />`
      : `<div class="game-team-logo" style="border-radius:8px;border:1px solid #30363d;"></div>`;

    const homeNorm = (home_players || []).map(normalizePlayer);
    const awayNorm = (away_players || []).map(normalizePlayer);

    let html = `
      <div class="game-header">
        <div class="game-team-block">
          ${logoImg(game.home_team)}
          <a href="team.html?id=${game.home_team.id}" class="game-team-name">${game.home_team.name}</a>
        </div>
        <div class="game-score-block">
          <span class="game-score${homeWin ? ' winner' : ''}">${game.home_score}</span>
          <span class="game-score-sep">–</span>
          <span class="game-score${awayWin ? ' winner' : ''}">${game.away_score}</span>
        </div>
        <div class="game-team-block">
          ${logoImg(game.away_team)}
          <a href="team.html?id=${game.away_team.id}" class="game-team-name">${game.away_team.name}</a>
        </div>
      </div>
      <p class="game-meta">${date}${otBadge}</p>`;

    if (!has_stats) {
      html += '<p style="color:#8b949e;text-align:center;">No player stats were recorded for this game.</p>';
    } else {
      html += renderTeamPanel(game.home_team, homeNorm);
      html += renderTeamPanel(game.away_team, awayNorm);
    }

    root.innerHTML = html;
  } catch (err) {
    root.innerHTML = `<p class="error">Failed to load game: ${err.message}</p>`;
  }
}

loadGame();
