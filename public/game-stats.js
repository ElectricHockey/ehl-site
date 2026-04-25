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
    const num = Number(v);
    const frac = num > 1 ? num / 100 : num;
    return frac.toFixed(3).replace(/^0(?=\.)/, '');
  }

  // ── Rating colour helpers ───────────────────────────────────────────────

  // Returns the overall rating for a player.  Uses the EA-stored overall_rating when
  // available (most accurate), falling back to an average of the component ratings,
  // then falling back to a stat-based score when no ratings are present.
  function computeOvr(p) {
    if (p.overall_rating && p.overall_rating > 0) return p.overall_rating;
    const vals = [p.offensive_rating, p.defensive_rating, p.team_play_rating]
      .map(Number).filter(v => v > 0);
    if (vals.length) return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    // Stat-based fallback so top-3 stars can still be selected
    const isG = (p.position || '').toUpperCase() === 'G';
    if (isG) {
      const sv = Number(p.saves) || 0;
      const sa = Number(p.shots_against) || 0;
      const svp = sa > 0 ? sv / sa : 0;
      return Math.round(svp * 60 + sv * 0.5 + (Number(p.shutouts) || 0) * 10);
    }
    return Math.round(Math.max(0, Math.min(99,
      60 +
      Math.min((Number(p.goals)         || 0) * 7,   21) +
      Math.min((Number(p.assists)        || 0) * 4,   14) +
      Math.max(Math.min((Number(p.plus_minus) || 0) * 3, 12), -12) +
      Math.min((Number(p.shots)          || 0) * 0.5,  5) +
      Math.min((Number(p.hits)           || 0) * 0.5,  5) +
      Math.min((Number(p.blocked_shots)  || 0) * 1.5,  6) +
      Math.min((Number(p.takeaways)      || 0) * 1.5,  6) -
      Math.min((Number(p.giveaways)      || 0) * 2,    8) -
      Math.min((Number(p.pim)            || 0) * 0.5,  5)
    )));
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

  function ovrStyle(v) {
    return ratingStyle(v) + 'outline:1px solid currentColor;border-radius:3px;';
  }

  // OVR badge solid colour (used for the badge pill in the new table design)
  function ovrBadgeStyle(v) {
    if (!v || v <= 0) return 'background:#21262d;color:#484f58;';
    if (v >= 90) return 'background:#2ea043;color:#fff;';
    if (v >= 80) return 'background:#3fb950;color:#000;';
    if (v >= 70) return 'background:#56d364;color:#000;';
    if (v >= 60) return 'background:#e3b341;color:#000;';
    if (v >= 50) return 'background:#f0883e;color:#000;';
    return 'background:#f85149;color:#fff;';
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

    const bksa  = v('breakaway_shots', 'breakawayShots');
    const bksv  = v('breakaway_saves', 'breakawaySaves');
    const bkPct = bksa > 0 ? Math.round(bksv * 100.0 / bksa * 10) / 10 : null;
    const psa   = v('penalty_shot_attempts', 'penaltyShotAttempts');
    const psga  = v('penalty_shot_ga',       'penaltyShotGa');
    const psPct = psa > 0 ? Math.round((psa - psga) * 100.0 / psa * 10) / 10 : null;

    return {
      name:     p.player_name || p.name,
      position: p.position,
      overall_rating:    v('overall_rating',    'overallRating'),
      offensive_rating:  v('offensive_rating',  'offensiveRating'),
      defensive_rating:  v('defensive_rating',  'defensiveRating'),
      team_play_rating:  v('team_play_rating',  'teamPlayRating'),
      // skater
      goals,
      assists:          v('assists',         'assists'),
      points:           goals + v('assists', 'assists'),
      plus_minus:       v('plus_minus',      'plusMinus'),
      shots,
      shot_attempts:    v('shot_attempts',   'shotAttempts'),
      hits:             v('hits',            'hits'),
      blocked_shots:    v('blocked_shots',   'blockedShots'),
      takeaways:        v('takeaways',       'takeaways'),
      giveaways:        v('giveaways',       'giveaways'),
      pp_goals:         v('pp_goals',        'ppGoals'),
      sh_goals:         v('sh_goals',        'shGoals'),
      gwg:              v('gwg',             'gwg'),
      pim:              v('pim',             'pim'),
      penalties_drawn:  v('penalties_drawn', 'penaltiesDrawn'),
      faceoff_wins:     fow,
      faceoff_total:    fot,
      fow_pct:          fot > 0 ? Math.round(fow * 100.0 / fot * 10) / 10 : null,
      shot_pct:         shotPct,
      deflections:      v('deflections',     'deflections'),
      interceptions:    v('interceptions',   'interceptions'),
      pass_attempts:    pa,
      pass_completions: pc,
      pass_pct_calc:    passPct,
      hat_tricks:       v('hat_tricks',      'hatTricks'),
      possession_secs:  v('possession_secs', 'possessionSecs'),
      saucer_passes:    v('saucer_passes',   'saucerPasses'),
      pk_clears:        v('pk_clears',       'pkClears'),
      toi,
      // goalie
      shots_against:         shotsAgainstVal,
      goals_against:         ga,
      saves:                 savesVal,
      save_pct:              computedSavePct,
      gaa,
      shutouts:              v('shutouts',              'shutouts'),
      penalty_shot_attempts: psa,
      penalty_shot_ga:       psga,
      penalty_shot_pct:      psPct,
      breakaway_shots:       bksa,
      breakaway_saves:       bksv,
      breakaway_pct:         bkPct,
      desperation_saves:     v('desperation_saves',  'desperationSaves'),
      poke_check_saves:      v('poke_check_saves',   'pokeCheckSaves'),
      goalie_wins:           v('goalie_wins',   'goalieWins'),
      goalie_losses:         v('goalie_losses', 'goalieLosses'),
      goalie_otw:            v('goalie_otw',    'goalieOtw'),
      goalie_otl:            v('goalie_otl',    'goalieOtl'),
    };
  }

  // ── Team aggregate totals ───────────────────────────────────────────────

  function computeTeamTotals(normalized) {
    const t = {
      goals: 0, shots: 0, hits: 0, possession_secs: 0,
      pass_attempts: 0, pass_completions: 0,
      faceoff_wins: 0, faceoff_losses: 0,
      pim: 0, pp_goals: 0, sh_goals: 0, blocked_shots: 0,
    };
    normalized.forEach(p => {
      t.goals           += p.goals;
      t.shots           += p.shots;
      t.hits            += p.hits;
      t.possession_secs += p.possession_secs;
      t.pass_attempts   += p.pass_attempts;
      t.pass_completions += p.pass_completions;
      t.faceoff_wins    += p.faceoff_wins;
      t.faceoff_losses  += (p.faceoff_total - p.faceoff_wins);
      t.pim             += p.pim;
      t.pp_goals        += p.pp_goals;
      t.sh_goals        += p.sh_goals;
      t.blocked_shots   += p.blocked_shots;
    });
    t.faceoff_total = t.faceoff_wins + t.faceoff_losses;
    t.pass_pct = t.pass_attempts > 0
      ? Math.round(t.pass_completions * 100.0 / t.pass_attempts * 10) / 10
      : null;
    return t;
  }

  // ── Donut chart (CSS conic-gradient) ────────────────────────────────────

  function renderDonutChart(homeVal, awayVal, label, homeColor, awayColor) {
    const hc = homeColor || '#c9162b';
    const ac = awayColor || '#d1d5db';
    const total = homeVal + awayVal;
    if (!total) {
      return `<div class="gs-donut-wrap">
        <div class="gs-donut" style="background:#30363d;">
          <div class="gs-donut-inner"><span class="gs-donut-dash">–</span></div>
        </div>
        <div class="gs-donut-label">${label}</div>
      </div>`;
    }
    const homePct = Math.round(homeVal / total * 100);
    const awayPct = 100 - homePct;
    return `<div class="gs-donut-wrap">
      <div class="gs-donut" style="background: conic-gradient(${hc} 0% ${homePct}%, ${ac} ${homePct}% 100%);">
        <div class="gs-donut-inner">
          <span class="gs-donut-home" style="color:${hc};">${homePct}%</span>
          <span class="gs-donut-away" style="color:${ac};">${awayPct}%</span>
        </div>
      </div>
      <div class="gs-donut-label">${label}</div>
    </div>`;
  }

  // ── Possession pie chart (CSS conic-gradient, by position) ──────────────

  function renderPossessionPie(normalized, title, teamColor) {
    // Shade each position segment relative to the team's primary color so
    // the pie clearly belongs to that team while still distinguishing positions.
    const baseColor = teamColor || '#58a6ff';
    const posOrder  = ['LW', 'C', 'RW', 'LD', 'RD'];
    // Generate shades: lightest for first position, darkest for last
    const shades = posOrder.map((_, i) => {
      const ratio = posOrder.length <= 1 ? 0.5 : i / (posOrder.length - 1);
      return blendColor(baseColor, ratio);
    });
    const posColors = {};
    posOrder.forEach((pos, i) => { posColors[pos] = shades[i]; });

    const totals = {};
    let total = 0;
    normalized.forEach(p => {
      const pos  = (p.position || '').toUpperCase();
      const poss = Number(p.possession_secs) || 0;
      totals[pos] = (totals[pos] || 0) + poss;
      total += poss;
    });

    if (!total) {
      return `<div class="gs-pie-wrap">
        <div class="gs-pie" style="background:#30363d;"></div>
        <div class="gs-pie-title">${title}</div>
        <div class="gs-pie-legend"></div>
      </div>`;
    }

    let gradParts = [];
    let prev = 0;
    posOrder.forEach(pos => {
      if (totals[pos] > 0) {
        const pct = totals[pos] / total * 100;
        gradParts.push(`${posColors[pos] || '#484f58'} ${prev.toFixed(1)}% ${(prev + pct).toFixed(1)}%`);
        prev += pct;
      }
    });

    const legend = posOrder
      .filter(pos => totals[pos] > 0)
      .map(pos =>
        `<span class="gs-pie-item"><span class="gs-pie-dot" style="background:${posColors[pos]};"></span>${pos}</span>`
      ).join('');

    return `<div class="gs-pie-wrap">
      <div class="gs-pie" style="background: conic-gradient(${gradParts.join(', ')});"></div>
      <div class="gs-pie-title">${title}</div>
      <div class="gs-pie-legend">${legend}</div>
    </div>`;
  }

  // Blend a hex color towards white (ratio=0) or black (ratio=1)
  function blendColor(hex, ratio) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    // Blend between a lightened version (ratio=0) and a darkened version (ratio=1)
    const light = 0.55, dark = 0.35;
    const t = light + (dark - light) * ratio;
    const mix = (c, bg) => Math.round(c * t + bg * (1 - t));
    const bg = ratio < 0.5 ? 255 : 0;
    const nr = mix(r, bg); const ng = mix(g, bg); const nb = mix(b, bg);
    return `#${nr.toString(16).padStart(2,'0')}${ng.toString(16).padStart(2,'0')}${nb.toString(16).padStart(2,'0')}`;
  }

  // ── Team comparison panel (left column) ─────────────────────────────────

  function renderTeamComparisonPanel(game, homeNorm, awayNorm) {
    const h = computeTeamTotals(homeNorm);
    const a = computeTeamTotals(awayNorm);

    const hc = (game.home_team && game.home_team.color1) || '#c9162b';
    const ac = (game.away_team && game.away_team.color1) || '#d1d5db';

    const donuts = `<div class="gs-donuts-row">
      ${renderDonutChart(h.shots,           a.shots,           'Shots',    hc, ac)}
      ${renderDonutChart(h.possession_secs, a.possession_secs, 'TOA',      hc, ac)}
      ${renderDonutChart(h.faceoff_wins,    a.faceoff_wins,    'Faceoffs', hc, ac)}
    </div>`;

    function statRow(hVal, label, aVal) {
      const hBar = hVal > aVal ? `<span class="gs-lead-bar gs-lead-bar-home" style="background:${hc};"></span>` : '';
      const aBar = aVal > hVal ? `<span class="gs-lead-bar gs-lead-bar-away" style="background:${ac};"></span>` : '';
      return `<tr class="gs-stat-row">
        <td class="gs-stat-val">${hVal}${hBar}</td>
        <td class="gs-stat-name">${label}</td>
        <td class="gs-stat-val">${aBar}${aVal}</td>
      </tr>`;
    }

    function formatPim(pim) {
      return `${Math.floor(Number(pim) || 0)}:00`;
    }

    function fmtStatRow(hVal, label, aVal, hFmt, aFmt) {
      const hDisplay = hFmt ? hFmt(hVal) : hVal;
      const aDisplay = aFmt ? aFmt(aVal) : aVal;
      const hNum = hVal !== null ? hVal : -Infinity;
      const aNum = aVal !== null ? aVal : -Infinity;
      const hBar = hNum > aNum ? `<span class="gs-lead-bar gs-lead-bar-home" style="background:${hc};"></span>` : '';
      const aBar = aNum > hNum ? `<span class="gs-lead-bar gs-lead-bar-away" style="background:${ac};"></span>` : '';
      return `<tr class="gs-stat-row">
        <td class="gs-stat-val">${hDisplay}${hBar}</td>
        <td class="gs-stat-name">${label}</td>
        <td class="gs-stat-val">${aBar}${aDisplay}</td>
      </tr>`;
    }

    const stats = `<table class="gs-comparison-table">
      ${statRow(game.home_score, 'Goals',         game.away_score)}
      ${statRow(h.shots,         'Total Shots',   a.shots)}
      ${statRow(h.hits,          'Hits',          a.hits)}
      ${fmtStatRow(h.possession_secs, 'Time on Attack', a.possession_secs, formatToi, formatToi)}
      ${fmtStatRow(h.pass_pct, 'Passing%', a.pass_pct,
          v => v !== null ? v + '%' : '–', v => v !== null ? v + '%' : '–')}
      ${statRow(h.faceoff_wins,  'Face offs won',     a.faceoff_wins)}
      ${/* PIM: higher = more penalties (bad), so highlight in red rather than with a team bar */''}
      <tr class="gs-stat-row">
        <td class="gs-stat-val${h.pim > a.pim ? ' gs-pim-hi' : ''}">${formatPim(h.pim)}</td>
        <td class="gs-stat-name">Penalty Minutes</td>
        <td class="gs-stat-val${a.pim > h.pim ? ' gs-pim-hi' : ''}">${formatPim(a.pim)}</td>
      </tr>
      ${statRow(h.pp_goals,      'Power Play Goals',  a.pp_goals)}
      ${statRow(h.blocked_shots, 'Blocks',            a.blocked_shots)}
      ${statRow(h.sh_goals,      'Shorthanded Goals', a.sh_goals)}
    </table>`;

    const pies = `<div class="gs-pies-row">
      ${renderPossessionPie(homeNorm, 'Puck Possession', hc)}
      ${renderPossessionPie(awayNorm, 'Puck Possession', ac)}
    </div>`;

    return `<div class="gs-comparison-panel">
      ${donuts}
      ${stats}
      ${pies}
    </div>`;
  }

  // ── Rating bars (offensive / defensive) ─────────────────────────────────

  function renderRatingBars(p) {
    const off = Math.min(100, Math.max(0, Number(p.offensive_rating) || 0));
    const def = Math.min(100, Math.max(0, Number(p.defensive_rating) || 0));
    if (!off && !def) return '<div class="gs-rating-bars"></div>';
    return `<div class="gs-rating-bars">
      <div class="gs-rbar"><div class="gs-rbar-fill gs-rbar-off" style="width:${off}%;"></div></div>
      <div class="gs-rbar"><div class="gs-rbar-fill gs-rbar-def" style="width:${def}%;"></div></div>
    </div>`;
  }

  // ── Top player cards ─────────────────────────────────────────────────────

  function renderPlayerCards(game, homeNorm, awayNorm) {
    const allPlayers = [...homeNorm, ...awayNorm];
    const candidates = allPlayers
      .sort((a, b) => (computeOvr(b) || 0) - (computeOvr(a) || 0))
      .slice(0, 3);

    if (!candidates.length) return '';

    function makeCard(p) {
      const ovr   = computeOvr(p);
      const isG   = (p.position || '').toUpperCase() === 'G';
      const stats = isG
        ? `<span>Sv% <strong>${pct3(p.save_pct)}</strong></span>
           <span>GAA <strong>${p.gaa !== null ? Number(p.gaa).toFixed(2) : '–'}</strong></span>
           <span>Sv <strong>${p.saves || 0}</strong></span>`
        : `<span>G <strong>${p.goals}</strong></span>
           <span>A <strong>${p.assists}</strong></span>
           <span>P <strong>${p.points}</strong></span>
           <span>+/- <strong>${p.plus_minus >= 0 ? '+' : ''}${p.plus_minus}</strong></span>`;
      return `<div class="gs-player-card">
        <div class="gs-card-badge" style="${ovrBadgeStyle(ovr)}">${ovr || '–'}</div>
        <div class="gs-card-info">
          <div class="gs-card-name">${p.name}</div>
          <div class="gs-card-pos">${p.position || ''}</div>
        </div>
        <div class="gs-card-stats">${stats}</div>
      </div>`;
    }

    return `<div class="gs-player-cards">${candidates.map(makeCard).join('')}</div>`;
  }

  // ── Combined skater + goalie tables (both teams in one table each) ───────

  function renderCombinedTables(game, homeNorm, awayNorm) {
    const SKATER_COLS = 20;
    const GOALIE_COLS = 11;

    const hLogo = game.home_team.logo_url
      ? `<img src="${game.home_team.logo_url}" class="gs-row-logo" alt="" />`
      : '';
    const aLogo = game.away_team.logo_url
      ? `<img src="${game.away_team.logo_url}" class="gs-row-logo" alt="" />`
      : '';

    function playerCell(p, logoHtml) {
      const ovr = computeOvr(p);
      return `<div class="gs-player-cell">
        <div class="gs-ovr-badge" style="${ovrBadgeStyle(ovr)}">${ovr || '–'}</div>
        ${renderRatingBars(p)}
        ${logoHtml}
        <div class="gs-player-name-wrap">
          <a href="player.html?name=${encodeURIComponent(p.name)}" class="player-link gs-pname">${p.name}</a>
          <span class="gs-pos-tag">${p.position || ''}</span>
        </div>
      </div>`;
    }

    function skaterRow(p, logoHtml) {
      const pm = p.plus_minus;
      const shotsDisplay = `${p.shots}/${p.shot_attempts}`;
      return `<tr class="gs-table-row">
        <td class="gs-col-player">${playerCell(p, logoHtml)}</td>
        <td class="gs-num">${p.goals}</td>
        <td class="gs-num">${p.assists}</td>
        <td class="gs-num"><strong>${p.points}</strong></td>
        <td class="gs-num">${pm >= 0 ? '+' : ''}${pm}</td>
        <td class="gs-num">${formatToi(p.toi)}</td>
        <td class="gs-num">${formatToi(p.possession_secs)}</td>
        <td class="gs-num">${shotsDisplay}</td>
        <td class="gs-num">${p.deflections}</td>
        <td class="gs-num">${p.pass_pct_calc !== null && p.pass_pct_calc !== undefined ? fmt1(p.pass_pct_calc) + '%' : '–'}</td>
        <td class="gs-num">${p.saucer_passes}</td>
        <td class="gs-num">${p.hits}</td>
        <td class="gs-num">${p.takeaways}</td>
        <td class="gs-num">${p.giveaways}</td>
        <td class="gs-num">${p.blocked_shots}</td>
        <td class="gs-num">${p.interceptions}</td>
        <td class="gs-num">${p.pim}</td>
        <td class="gs-num">${p.penalties_drawn}</td>
        <td class="gs-num">${p.pk_clears}</td>
      </tr>`;
    }

    function goalieRow(p, logoHtml) {
      return `<tr class="gs-table-row">
        <td class="gs-col-player">${playerCell(p, logoHtml)}</td>
        <td class="gs-num">${p.shots_against}</td>
        <td class="gs-num"><strong>${pct3(p.save_pct)}</strong></td>
        <td class="gs-num">${p.goals_against}</td>
        <td class="gs-num">${p.saves || 0}</td>
        <td class="gs-num">${p.gaa !== null ? Number(p.gaa).toFixed(2) : '–'}</td>
        <td class="gs-num">${p.poke_check_saves}</td>
        <td class="gs-num">${p.desperation_saves}</td>
        <td class="gs-num">${p.breakaway_saves}</td>
        <td class="gs-num">${p.breakaway_pct !== null ? fmt1(p.breakaway_pct) + '%' : '–'}</td>
        <td class="gs-num">${p.penalty_shot_pct !== null ? fmt1(p.penalty_shot_pct) + '%' : '–'}</td>
      </tr>`;
    }

    function teamHeaderRow(cols, teamName) {
      return `<tr class="gs-team-header-row">
        <td colspan="${cols}"><span class="gs-team-header-name">${teamName}</span></td>
      </tr>`;
    }

    const hSkaters = homeNorm.filter(p => (p.position || '').toUpperCase() !== 'G');
    const aSkaters = awayNorm.filter(p => (p.position || '').toUpperCase() !== 'G');
    const hGoalies = homeNorm.filter(p => (p.position || '').toUpperCase() === 'G');
    const aGoalies = awayNorm.filter(p => (p.position || '').toUpperCase() === 'G');

    const skaterTable = (hSkaters.length || aSkaters.length) ? `
      <div class="gs-section-label">Player Stats</div>
      <div class="stats-scroll-wrap"><table class="game-stats-table gs-combined-table">
        <thead>
          <tr class="gs-group-header-row">
            <th class="gs-col-player-head"></th>
            <th colspan="10" class="gs-group-head">Offense</th>
            <th colspan="5" class="gs-group-head">Defense</th>
            <th colspan="3" class="gs-group-head">Penalties</th>
          </tr>
          <tr>
            <th class="gs-col-player-head">Players</th>
            <th data-tip="Goals">G</th>
            <th data-tip="Assists">A</th>
            <th data-tip="Points">P</th>
            <th data-tip="Plus / Minus">+/-</th>
            <th data-tip="Time on Ice">TOI</th>
            <th data-tip="Time with Puck">TwP</th>
            <th data-tip="Shots on Goal / Shot Attempts">SOG</th>
            <th data-tip="Deflections">D</th>
            <th data-tip="Pass Completion %">PAS%</th>
            <th data-tip="Saucer Passes">SP</th>
            <th data-tip="Hits">H</th>
            <th data-tip="Takeaways">TA</th>
            <th data-tip="Giveaways">GVA</th>
            <th data-tip="Blocked Shots">BK</th>
            <th data-tip="Interceptions">INT</th>
            <th data-tip="Penalty Minutes">PIM</th>
            <th data-tip="Penalties Drawn">PD</th>
            <th data-tip="PK Clears">PKC</th>
          </tr>
        </thead>
        <tbody>
          ${teamHeaderRow(SKATER_COLS, game.home_team.name)}
          ${hSkaters.map(p => skaterRow(p, hLogo)).join('')}
          ${teamHeaderRow(SKATER_COLS, game.away_team.name)}
          ${aSkaters.map(p => skaterRow(p, aLogo)).join('')}
        </tbody>
      </table></div>` : '';

    const goalieTable = (hGoalies.length || aGoalies.length) ? `
      <div class="gs-section-label gs-section-label-mt">Goalie Stats</div>
      <div class="stats-scroll-wrap"><table class="game-stats-table gs-combined-table">
        <thead>
          <tr>
            <th class="gs-col-player-head">Player</th>
            <th data-tip="Shots Against">S</th>
            <th data-tip="Save Percentage">Sv%</th>
            <th data-tip="Goals Against">GA</th>
            <th data-tip="Saves">Sv</th>
            <th data-tip="Goals Against Average">GAA</th>
            <th data-tip="Poke Check Saves">PCHK</th>
            <th data-tip="Desperation Saves">DSV</th>
            <th data-tip="Breakaway Saves">BRKS</th>
            <th data-tip="Breakaway Save %">BA%</th>
            <th data-tip="Penalty Shot Save %">PS%</th>
          </tr>
        </thead>
        <tbody>
          ${teamHeaderRow(GOALIE_COLS, game.home_team.name)}
          ${hGoalies.map(p => goalieRow(p, hLogo)).join('')}
          ${teamHeaderRow(GOALIE_COLS, game.away_team.name)}
          ${aGoalies.map(p => goalieRow(p, aLogo)).join('')}
        </tbody>
      </table></div>` : '';

    return skaterTable + goalieTable;
  }

  // ── Full game view (two-column layout, for game.html) ────────────────────

  function renderFullGameView(game, rawHomePlayers, rawAwayPlayers) {
    const homeNorm = (rawHomePlayers || []).map(normalizePlayer);
    const awayNorm = (rawAwayPlayers || []).map(normalizePlayer);

    const leftPanel = renderTeamComparisonPanel(game, homeNorm, awayNorm);
    const cards     = renderPlayerCards(game, homeNorm, awayNorm);
    const tables    = renderCombinedTables(game, homeNorm, awayNorm);

    return `<div class="gs-game-layout">
      <div class="gs-left-col">${leftPanel}</div>
      <div class="gs-right-col">${cards}${tables}</div>
    </div>`;
  }

  // ── Legacy skater table (used by schedule.html inline panel) ────────────

  function renderSkaterTable(players) {
    if (!players.length) return '<p class="no-stats">No skater stats recorded.</p>';
    return `<div class="stats-scroll-wrap"><table class="game-stats-table">
      <thead><tr>
        <th>Pos</th><th>Player</th>
        <th data-tip="Overall Rating">OVR</th>
        <th data-tip="Goals">G</th>
        <th data-tip="Assists">A</th>
        <th data-tip="Points">PTS</th>
        <th data-tip="Plus / Minus">+/-</th>
        <th data-tip="Shots on Goal">SOG</th>
        <th data-tip="Time on Ice">TOI</th>
        <th data-tip="Time with Puck">TwP</th>
        <th data-tip="Hits">HITS</th>
        <th data-tip="Blocked Shots">BS</th>
        <th data-tip="Takeaways">TKA</th>
        <th data-tip="Giveaways">GVA</th>
        <th data-tip="Power Play Goals">PPG</th>
        <th data-tip="Short-Hand Goals">SHG</th>
        <th data-tip="Penalty Minutes">PIM</th>
        <th data-tip="Faceoff Win %">FOW%</th>
        <th data-tip="Shooting %">S%</th>
        <th data-tip="Pass Completion %">PC%</th>
      </tr></thead>
      <tbody>${players.map(p => {
        const ovr = computeOvr(p);
        const pm  = p.plus_minus;
        return `<tr>
          <td>${p.position || '–'}</td>
          <td><a href="player.html?name=${encodeURIComponent(p.name)}" class="player-link">${p.name}</a></td>
          <td class="gs-rating" style="${ovrStyle(ovr)}">${ovr ?? '–'}</td>
          <td>${p.goals}</td>
          <td>${p.assists}</td>
          <td><strong>${p.points}</strong></td>
          <td>${pm >= 0 ? '+' : ''}${pm}</td>
          <td>${p.shots}</td>
          <td>${formatToi(p.toi)}</td>
          <td>${formatToi(p.possession_secs)}</td>
          <td>${p.hits}</td>
          <td>${p.blocked_shots}</td>
          <td>${p.takeaways}</td>
          <td>${p.giveaways}</td>
          <td>${p.pp_goals}</td>
          <td>${p.sh_goals}</td>
          <td>${p.pim}</td>
          <td>${p.fow_pct !== null ? fmt1(p.fow_pct) + '%' : '–'}</td>
          <td>${p.shot_pct !== null ? fmt1(p.shot_pct) + '%' : '–'}</td>
          <td>${p.pass_pct_calc !== null && p.pass_pct_calc !== undefined ? fmt1(p.pass_pct_calc) + '%' : '–'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  // ── Legacy goalie table (used by schedule.html inline panel) ────────────

  function renderGoalieTable(players) {
    if (!players.length) return '';
    return `<div class="stats-scroll-wrap"><table class="game-stats-table">
      <thead><tr>
        <th>Player</th>
        <th data-tip="Overall Rating">OVR</th>
        <th data-tip="Shots Against">SA</th>
        <th data-tip="Goals Against">GA</th>
        <th data-tip="Save Percentage">Sv%</th>
        <th data-tip="Goals Against Average">GAA</th>
        <th data-tip="Time on Ice">TOI</th>
        <th data-tip="Penalty Shot Attempts">PSA</th>
        <th data-tip="Penalty Shot Goals Against">PSGA</th>
        <th data-tip="Breakaway Shots Against">BKSA</th>
        <th data-tip="Breakaway Saves">BKSV</th>
      </tr></thead>
      <tbody>${players.map(p => {
        const ovr = computeOvr(p);
        return `<tr>
          <td><a href="player.html?name=${encodeURIComponent(p.name)}" class="player-link">${p.name}</a></td>
          <td class="gs-rating" style="${ovrStyle(ovr)}">${ovr ?? '–'}</td>
          <td>${p.shots_against}</td>
          <td>${p.goals_against}</td>
          <td><strong>${pct3(p.save_pct)}</strong></td>
          <td>${p.gaa !== null ? Number(p.gaa).toFixed(2) : '–'}</td>
          <td>${formatToi(p.toi)}</td>
          <td>${p.penalty_shot_attempts}</td>
          <td>${p.penalty_shot_ga}</td>
          <td>${p.breakaway_shots}</td>
          <td>${p.breakaway_saves}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  // ── Team panel (used by schedule.html inline panel) ──────────────────────

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
      ${skaters.length ? `<p class="stats-section-label">Skaters</p>${renderSkaterTable(skaters)}` : ''}
      ${goalies.length  ? `<p class="stats-section-label">Goalies</p>${renderGoalieTable(goalies)}`   : ''}
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
    renderFullGameView,
    formatToi,
  };

}(window));
