// API is declared in standings.js when loaded together; define only if standalone
if (typeof API === 'undefined') { window.API = '/api'; }
const SLOT_H = 90; // px – height of one series card slot

// ── Helpers ────────────────────────────────────────────────────────────────

function abbrev(name) {
  if (!name) return '???';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return name.slice(0, 3).toUpperCase();
  return words.map(w => w[0]).join('').toUpperCase().slice(0, 3);
}

function roundName(r, totalRounds) {
  if (r === totalRounds) return 'Final';
  if (r === totalRounds - 1) return 'Semifinals';
  if (r === totalRounds - 2) return 'Quarterfinals';
  return `Round ${r}`;
}

function logoImg(url, name, cls = 'b-logo') {
  if (url) return `<img src="${url}" alt="${name}" class="${cls}" />`;
  return `<div class="b-logo-placeholder"></div>`;
}

// ── Series card ─────────────────────────────────────────────────────────────

function seriesCard(s, seriesLength) {
  const winsToWin = Math.ceil((seriesLength || 7) / 2);
  const isComplete = s.winner_id != null;
  const cls = isComplete ? ' b-series-complete' : '';

  const highIsWinner = isComplete && s.winner_id === s.high_seed_id;
  const lowIsWinner  = isComplete && s.winner_id === s.low_seed_id;

  const highCls = isComplete ? (highIsWinner ? ' b-winner' : ' b-loser') : '';
  const lowCls  = isComplete ? (lowIsWinner  ? ' b-winner' : ' b-loser') : '';

  const highWinsCls = highIsWinner ? ' b-wins-champion' : '';
  const lowWinsCls  = lowIsWinner  ? ' b-wins-champion' : '';

  let html = `<div class="b-series${cls}" data-series-id="${s.id}" onclick="openSeriesDetail(${s.id})">`;

  if (s.high_seed_id) {
    html += `<div class="b-team${highCls}">
      <span class="b-seed">${s.high_seed_num}</span>
      ${logoImg(s.high_seed_logo, s.high_seed_name)}
      <span class="b-team-name">${abbrev(s.high_seed_name)}</span>
      <span class="b-wins${highWinsCls}">${s.high_seed_wins}</span>
    </div>`;
  } else {
    html += `<div class="b-team"><span class="b-seed">—</span><div class="b-logo-placeholder"></div><span class="b-tbd">TBD</span></div>`;
  }

  if (s.low_seed_id) {
    html += `<div class="b-team${lowCls}">
      <span class="b-seed">${s.low_seed_num}</span>
      ${logoImg(s.low_seed_logo, s.low_seed_name)}
      <span class="b-team-name">${abbrev(s.low_seed_name)}</span>
      <span class="b-wins${lowWinsCls}">${s.low_seed_wins}</span>
    </div>`;
  } else if (isComplete) {
    // Bye: the high seed advanced without playing
    html += `<div class="b-team" style="opacity:0.45;"><span class="b-seed">—</span><div class="b-logo-placeholder"></div><span class="b-tbd">BYE</span></div>`;
  } else {
    html += `<div class="b-team"><span class="b-seed">—</span><div class="b-logo-placeholder"></div><span class="b-tbd">TBD</span></div>`;
  }

  html += '</div>';
  return html;
}

// ── Bracket renderer ────────────────────────────────────────────────────────

function renderBracket(playoff, teams, rounds) {
  const numRounds = Object.keys(rounds).length;
  if (numRounds === 0) return '<p style="color:#8b949e">No rounds in bracket yet.</p>';

  const seriesLength = playoff.series_length || 7;

  // Determine champion
  const lastRound = rounds[numRounds];
  const finalSeries = lastRound && lastRound.length === 1 ? lastRound[0] : null;
  const champion = finalSeries && finalSeries.winner_id
    ? teams.find(t => t.team_id === finalSeries.winner_id) : null;

  let html = `<div class="bracket-outer"><svg class="bracket-svg" id="bracket-svg"></svg><div class="bracket-grid" id="bracket-grid">`;

  for (let r = 1; r <= numRounds; r++) {
    const slotsPerMatch = Math.pow(2, r - 1);
    const initGapSlots  = (slotsPerMatch - 1) / 2;
    const betweenGapSlots = slotsPerMatch - 1;

    const roundSeries = (rounds[r] || []).slice().sort((a, b) => a.series_number - b.series_number);
    const rName = roundName(r, numRounds);

    html += `<div class="b-round">`;
    html += `<div class="b-round-title">${rName}</div>`;

    if (initGapSlots > 0) {
      html += `<div class="b-spacer" style="height:${initGapSlots * SLOT_H}px"></div>`;
    }

    roundSeries.forEach((s, i) => {
      html += seriesCard(s, seriesLength);
      if (i < roundSeries.length - 1 && betweenGapSlots > 0) {
        html += `<div class="b-spacer" style="height:${betweenGapSlots * SLOT_H}px"></div>`;
      }
    });

    if (initGapSlots > 0) {
      html += `<div class="b-spacer" style="height:${initGapSlots * SLOT_H}px"></div>`;
    }

    html += `</div>`; // .b-round
  }

  // Champion column
  html += `<div class="b-champion-col">
    <div class="b-round-title" style="visibility:hidden">—</div>`;

  const champTopSlots = (Math.pow(2, numRounds - 1) - 1) / 2 + (Math.pow(2, numRounds - 1) / 2);
  html += `<div class="b-spacer" style="height:${(champTopSlots - 0.5) * SLOT_H}px"></div>`;

  if (champion) {
    html += `<div class="b-champ-box">
      <div class="b-champ-trophy">🏆</div>
      <div class="b-champ-label">Champion</div>
      ${champion.logo_url ? `<img src="${champion.logo_url}" alt="${champion.name}" class="b-champ-logo" />` : ''}
      <div class="b-champ-name">${champion.name}</div>
    </div>`;
  } else {
    html += `<div class="b-champ-tbd">🏆<br><br>Champion<br>TBD</div>`;
  }

  html += `</div>`; // .b-champion-col

  html += `</div></div>`; // .bracket-grid .bracket-outer
  return html;
}

// ── Draw SVG connector lines ────────────────────────────────────────────────

function drawBracketLines(rounds) {
  const svg   = document.getElementById('bracket-svg');
  const grid  = document.getElementById('bracket-grid');
  if (!svg || !grid) return;

  const numRounds = Object.keys(rounds).length;
  const gridRect  = grid.getBoundingClientRect();
  const svgW = grid.scrollWidth;
  const svgH = grid.scrollHeight;
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);

  const paths = [];

  for (let r = 1; r < numRounds; r++) {
    const curSeries  = (rounds[r]   || []).slice().sort((a,b) => a.series_number - b.series_number);
    const nextSeries = (rounds[r+1] || []).slice().sort((a,b) => a.series_number - b.series_number);

    for (let i = 0; i < nextSeries.length; i++) {
      const s1 = curSeries[i * 2];
      const s2 = curSeries[i * 2 + 1];
      const t  = nextSeries[i];
      if (!s1 || !s2 || !t) continue;

      const el1 = document.querySelector(`[data-series-id="${s1.id}"]`);
      const el2 = document.querySelector(`[data-series-id="${s2.id}"]`);
      const elT = document.querySelector(`[data-series-id="${t.id}"]`);
      if (!el1 || !el2 || !elT) continue;

      const r1 = el1.getBoundingClientRect();
      const r2 = el2.getBoundingClientRect();
      const rT = elT.getBoundingClientRect();
      const ox = gridRect.left;
      const oy = gridRect.top;

      const x1 = r1.right - ox + grid.scrollLeft;
      const y1 = (r1.top + r1.bottom) / 2 - oy + grid.scrollTop;
      const x2 = r2.right - ox + grid.scrollLeft;
      const y2 = (r2.top + r2.bottom) / 2 - oy + grid.scrollTop;
      const xT = rT.left  - ox + grid.scrollLeft;
      const yT = (rT.top + rT.bottom) / 2 - oy + grid.scrollTop;

      const midX = (x1 + xT) / 2;
      const midY = (y1 + y2) / 2;

      // s1 → right → down/up to midY
      paths.push(`M ${x1} ${y1} H ${midX} V ${midY}`);
      // s2 → right → up/down to midY
      paths.push(`M ${x2} ${y2} H ${midX} V ${midY}`);
      // midY → right to next series
      paths.push(`M ${midX} ${midY} H ${xT}`);
    }
  }

  svg.innerHTML = paths.map(d =>
    `<path d="${d}" stroke="#30363d" stroke-width="2" fill="none" stroke-linecap="round"/>`
  ).join('');
}

// ── Series detail panel ────────────────────────────────────────────────────

let _bracketData = null;

async function openSeriesDetail(seriesId) {
  const panel = document.getElementById('series-detail');
  const title = document.getElementById('sp-title');
  const meta  = document.getElementById('sp-meta');
  const matchup = document.getElementById('sp-matchup');
  const gamesDiv = document.getElementById('sp-games');

  if (!panel || !_bracketData) return;

  // Find series in bracket data
  let series = null;
  for (const arr of Object.values(_bracketData.rounds)) {
    series = arr.find(s => s.id === seriesId);
    if (series) break;
  }
  if (!series) return;

  const numRounds = Object.keys(_bracketData.rounds).length;
  const r = series.round_number;
  const rName = roundName(r, numRounds);
  const pl = _bracketData.playoff;
  const winsNeeded = Math.ceil((pl.series_length || 7) / 2);

  title.textContent = `${rName}: ${series.high_seed_name || 'TBD'} vs ${series.low_seed_name || 'TBD'}`;
  meta.textContent  = `Best of ${pl.series_length} · Need ${winsNeeded} wins`;

  // Matchup scores
  const hiWin = series.winner_id === series.high_seed_id;
  const loWin = series.winner_id === series.low_seed_id;
  matchup.innerHTML = `
    <div class="sp-team">
      ${series.high_seed_logo ? `<img src="${series.high_seed_logo}" alt="${series.high_seed_name}" />` : ''}
      <span style="${hiWin ? 'color:#3fb950;font-weight:700' : ''}">${series.high_seed_name || 'TBD'}</span>
    </div>
    <div class="sp-score">${series.high_seed_wins} – ${series.low_seed_wins}</div>
    <div class="sp-team">
      ${series.low_seed_logo ? `<img src="${series.low_seed_logo}" alt="${series.low_seed_name}" />` : ''}
      <span style="${loWin ? 'color:#3fb950;font-weight:700' : ''}">${series.low_seed_name || 'TBD'}</span>
    </div>`;

  panel.style.display = '';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Load games
  gamesDiv.innerHTML = '<p class="loading" style="font-size:0.85rem;">Loading games…</p>';
  try {
    const res = await fetch(`${API}/playoff-series/${seriesId}/games`);
    const games = res.ok ? await res.json() : [];
    if (games.length === 0) {
      gamesDiv.innerHTML = '<p style="color:#8b949e;font-size:0.85rem;">No games recorded for this series yet.</p>';
    } else {
      gamesDiv.innerHTML = `<table class="series-games-table">
        <thead><tr><th>Date</th><th>Home</th><th>Score</th><th>Away</th><th>Status</th></tr></thead>
        <tbody>
          ${games.map(g => {
            const score = g.status === 'complete' ? `${g.home_score} – ${g.away_score}` : '—';
            const ot    = g.is_overtime ? ' <span style="color:#8b949e;font-size:0.75rem;">OT</span>' : '';
            return `<tr onclick="window.location.href='game.html?id=${g.id}'" title="View game stats">
              <td>${g.date}</td>
              <td>${g.home_team_name}</td>
              <td><strong>${score}</strong>${ot}</td>
              <td>${g.away_team_name}</td>
              <td>${g.status === 'complete' ? '✅ Final' : '🕐 Scheduled'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
    }
  } catch {
    gamesDiv.innerHTML = '<p class="error" style="font-size:0.85rem;">Failed to load games.</p>';
  }
}

function closeSeriesDetail() {
  const panel = document.getElementById('series-detail');
  if (panel) panel.style.display = 'none';
}

// ── Load bracket ────────────────────────────────────────────────────────────

async function loadPlayoff() {
  const root = document.getElementById('playoff-root');
  const sid  = typeof SeasonSelector !== 'undefined' ? SeasonSelector.getSelectedSeasonId() : null;
  const isPlayoffSeason = typeof SeasonSelector !== 'undefined' ? SeasonSelector.getSelectedSeasonIsPlayoff() : false;

  if (!sid) {
    root.innerHTML = '<div class="bracket-empty"><p>Select a league and season above to view the playoff bracket.</p></div>';
    return;
  }

  root.innerHTML = '<p class="loading">Loading playoff bracket…</p>';
  closeSeriesDetail();

  try {
    // If the selected season is a dedicated playoff season, look up by playoff_season_id.
    // Otherwise fall back to looking up by the regular season id.
    const endpoint = isPlayoffSeason
      ? `${API}/playoffs/by-playoff-season/${sid}`
      : `${API}/playoffs/by-season/${sid}`;
    const res = await fetch(endpoint);
    if (res.status === 404) {
      root.innerHTML = '<div class="bracket-empty"><p>No playoff bracket has been created for this season yet.</p><p style="font-size:0.85rem;margin-top:0.5rem;">An admin can create one in the <a href="admin.html" style="color:#58a6ff;">Admin Panel → Playoffs</a> tab.</p></div>';
      return;
    }
    if (!res.ok) throw new Error('Failed to load playoff');

    const data = await res.json();
    _bracketData = data;

    root.innerHTML = renderBracket(data.playoff, data.teams, data.rounds);

    // Draw SVG connector lines after DOM is painted
    requestAnimationFrame(() => {
      requestAnimationFrame(() => drawBracketLines(data.rounds));
    });

  } catch (err) {
    root.innerHTML = `<p class="error">Failed to load playoff bracket. Is the server running?</p>`;
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

// When loaded standalone (playoffs.html), init SeasonSelector and load.
// When loaded from standings.html, standings.js handles init and will call
// loadPlayoff() directly – so we skip init here if already initialised.
(async () => {
  // Check if we're on the standalone playoffs page (not embedded in standings)
  if (document.title.includes('Playoffs') && !document.getElementById('standings-root')) {
    try {
      if (typeof SeasonSelector !== 'undefined') {
        await SeasonSelector.init('season-selector-container');
        SeasonSelector.onSeasonChange(() => loadPlayoff());
      }
      loadPlayoff();
    } catch (err) {
      console.error('[playoffs] init error:', err);
      const root = document.getElementById('playoff-root');
      if (root) root.innerHTML = '<p style="color:#f85149;">Failed to load playoffs. Please refresh the page.</p>';
    }
  }
})();
