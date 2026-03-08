// game-stats.js – Shared player-stats rendering used by game.html, schedule.html, and any
// other page that displays per-game box scores.  Defines globals on window so plain-script
// pages can call them after loading this file.

(function (global) {
  'use strict';

  // ── Tiny formatters ─────────────────────────────────────────────────────

  function formatToi(s) {
    if (!s) return '0:00';
    const m = Math.floor(Number(s) / 60);
    const sec = Number(s) % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function fmt1(v) {
    return v !== null && v !== undefined ? Number(v).toFixed(1) : '–';
  }

  function pct3(v) {
    if (v === null || v === undefined) return '–';
    const frac = v > 1 ? v / 100 : v;
    return frac.toFixed(3).replace(/^0(?=\.)/, '');
  }

  // ── Rating colour helpers ───────────────────────────────────────────────

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

  // ── Normalise a raw game_player_stats row ───────────────────────────────
  // Handles both snake_case keys (from the server) and camelCase keys (from EA import).

  function normalizePlayer(p) {
    // Helper that reads snake_case with camelCase fallback
    const v = (snake, camel) =>
      p[snake] !== undefined ? p[snake] : (p[camel] !== undefined ? p[camel] : 0);

    const fow  = v('faceoff_wins',    'faceoffWins');
    const fol  = v('faceoff_losses',  'faceoffLosses');
    const fot  = fow + fol;

    const goals   = v('goals', 'goals');
    const shots   = v('shots', 'shots');
    const shotPct = shots > 0 ? Math.round(goals * 100.0 / shots * 10) / 10 : null;

    const pa = v('pass_attempts',    'passAttempts');
    const pc = v('pass_completions', 'passCompletions');
    const storedPp = p.pass_pct !== undefined ? p.pass_pct : p.passPct;
    const passPct  = (storedPp !== null && storedPp !== undefined)
      ? (storedPp < 1 ? storedPp * 100 : storedPp)   // normalise 0-1 fractions
      : (pa > 0 ? Math.round(pc * 100.0 / pa * 10) / 10 : null);

    const toi = v('toi', 'toi');
    const ga  = v('goals_against', 'goalsAgainst');
    const gaa = toi > 0 ? Math.round(ga * 3600.0 / toi * 100) / 100 : null;

    const savesVal        = v('saves',         'saves');
    const shotsAgainstVal = v('shots_against',  'shotsAgainst');
    const rawSavePct = p.save_pct !== undefined ? p.save_pct : p.savesPct;
    const computedSavePct = (rawSavePct !== null && rawSavePct !== undefined)
      ? rawSavePct
      : (shotsAgainstVal > 0 ? savesVal / shotsAgainstVal : null);

    return {
      name:     p.player_name || p.name,
      position: p.position,
      overall_rating:   v('overall_rating',   'overallRating'),
      defensive_rating: v('defensive_rating',  'defensiveRating'),
      team_play_rating: v('team_play_rating',  'teamPlayRating'),
      // skater
      goals,
      assists:        v('assists',         'assists'),
      points:         goals + v('assists', 'assists'),
      plus_minus:     v('plus_minus',      'plusMinus'),
      shots,
      hits:           v('hits',            'hits'),
      blocked_shots:  v('blocked_shots',   'blockedShots'),
      takeaways:      v('takeaways',       'takeaways'),
      giveaways:      v('giveaways',       'giveaways'),
      pp_goals:       v('pp_goals',        'ppGoals'),
      sh_goals:       v('sh_goals',        'shGoals'),
      gwg:            v('gwg',             'gwg'),
      pim:            v('pim',             'pim'),
      penalties_drawn:v('penalties_drawn', 'penaltiesDrawn'),
      faceoff_wins:   fow,
      faceoff_total:  fot,
      fow_pct:        fot > 0 ? Math.round(fow * 100.0 / fot * 10) / 10 : null,
      shot_pct:       shotPct,
      deflections:    v('deflections',     'deflections'),
      interceptions:  v('interceptions',   'interceptions'),
      pass_attempts:  pa,
      pass_pct_calc:  passPct,
      hat_tricks:     v('hat_tricks',      'hatTricks'),
      possession_secs:v('possession_secs', 'possessionSecs'),
      toi,
      // goalie
      shots_against:          shotsAgainstVal,
      goals_against:          ga,
      saves:                  savesVal,
      save_pct:               computedSavePct,
      gaa,
      shutouts:               v('shutouts',               'shutouts'),
      penalty_shot_attempts:  v('penalty_shot_attempts',  'penaltyShotAttempts'),
      penalty_shot_ga:        v('penalty_shot_ga',        'penaltyShotGa'),
      breakaway_shots:        v('breakaway_shots',        'breakawayShots'),
      breakaway_saves:        v('breakaway_saves',        'breakawaySaves'),
      goalie_wins:            v('goalie_wins',             'goalieWins'),
      goalie_losses:          v('goalie_losses',           'goalieLosses'),
      goalie_otw:             v('goalie_otw',              'goalieOtw'),
      goalie_otl:             v('goalie_otl',              'goalieOtl'),
    };
  }

  // ── Skater table ────────────────────────────────────────────────────────

  function renderSkaterTable(players) {
    if (!players.length) return '<p class="no-stats">No skater stats recorded.</p>';
    return `<div class="stats-scroll-wrap"><table class="game-stats-table">
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
        <th data-tip="Puck Possession Time">POSS</th>
        <th data-tip="Time on Ice">TOI</th>
      </tr></thead>
      <tbody>${players.map(p => {
        const ovr = computeOvr(p);
        return `<tr>
          <td>${p.position || '–'}</td>
          <td><a href="player.html?name=${encodeURIComponent(p.name)}" class="player-link">${p.name}</a></td>
          <td class="gs-rating" style="${ovrStyle(ovr)}">${ovr ?? '–'}</td>
          <td class="gs-rating" style="${ratingStyle(p.overall_rating)}">${p.overall_rating || '–'}</td>
          <td class="gs-rating" style="${ratingStyle(p.defensive_rating)}">${p.defensive_rating || '–'}</td>
          <td class="gs-rating" style="${ratingStyle(p.team_play_rating)}">${p.team_play_rating || '–'}</td>
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
          <td>${formatToi(p.possession_secs)}</td>
          <td>${formatToi(p.toi)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  // ── Goalie table ────────────────────────────────────────────────────────

  function renderGoalieTable(players) {
    if (!players.length) return '';
    return `<div class="stats-scroll-wrap"><table class="game-stats-table">
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
          <td><a href="player.html?name=${encodeURIComponent(p.name)}" class="player-link">${p.name}</a></td>
          <td class="gs-rating" style="${ovrStyle(ovr)}">${ovr ?? '–'}</td>
          <td class="gs-rating" style="${ratingStyle(p.overall_rating)}">${p.overall_rating || '–'}</td>
          <td class="gs-rating" style="${ratingStyle(p.defensive_rating)}">${p.defensive_rating || '–'}</td>
          <td class="gs-rating" style="${ratingStyle(p.team_play_rating)}">${p.team_play_rating || '–'}</td>
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

  // ── Team panel (logo + name header + skater + goalie tables) ───────────

  function renderTeamPanel(teamInfo, rawPlayers) {
    const normalized = rawPlayers.map(normalizePlayer);
    const skaters = normalized.filter(p => (p.position || '').toUpperCase() !== 'G');
    const goalies  = normalized.filter(p => (p.position || '').toUpperCase() === 'G');

    const logoHtml = teamInfo && teamInfo.logo_url
      ? `<img src="${teamInfo.logo_url}" class="team-panel-logo" alt="${teamInfo.name || ''}" />`
      : '';

    const nameHtml = teamInfo && teamInfo.id
      ? `<a href="team.html?id=${teamInfo.id}" class="team-panel-name">${teamInfo.name || ''}</a>`
      : `<span class="team-panel-name">${teamInfo ? (teamInfo.name || '') : ''}</span>`;

    return `<div class="team-panel">
      <div class="team-panel-header">
        ${logoHtml}
        ${nameHtml}
      </div>
      ${skaters.length ? `<p class="stats-section-label">⛸️ Skaters</p>${renderSkaterTable(skaters)}` : ''}
      ${goalies.length  ? `<p class="stats-section-label">🥅 Goalies</p>${renderGoalieTable(goalies)}`   : ''}
      ${!skaters.length && !goalies.length
          ? '<p class="no-stats">No player stats recorded for this team.</p>' : ''}
    </div>`;
  }

  // ── Exports ─────────────────────────────────────────────────────────────

  global.GameStats = {
    normalizePlayer,
    renderSkaterTable,
    renderGoalieTable,
    renderTeamPanel,
    formatToi,
  };

}(window));
