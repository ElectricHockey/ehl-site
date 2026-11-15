// API is declared in standings.js when loaded together; define only if standalone.
if (typeof API === 'undefined') { window.API = '/api'; }
const SLOT_H = 104;

function abbrev(name, stored) {
  if (stored) return stored.toUpperCase();
  if (!name) return '???';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return name.slice(0, 3).toUpperCase();
  return words.map(w => w[0]).join('').toUpperCase().slice(0, 3);
}

function escapeBracketText(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function roundName(r, totalRounds) {
  if (r === totalRounds) return 'Final';
  if (r === totalRounds - 1) return 'Semifinals';
  if (r === totalRounds - 2) return 'Quarterfinals';
  return `Round ${r}`;
}

// Matchups cannot be determined until every winner in the preceding round is known.
function buildBracketRounds(rounds, teams) {
  const first = (rounds[1] || []).slice().sort((a, b) => a.series_number - b.series_number);
  if (!first.length) return [];
  const total = Math.max(Math.ceil(Math.log2(first.length)) + 1, ...Object.keys(rounds).map(Number));
  const result = [first];
  for (let r = 2; r <= total; r++) {
    const previous = result[r - 2];
    const saved = (rounds[r] || []).slice().sort((a, b) => a.series_number - b.series_number);
    const count = Math.max(Math.ceil(previous.length / 2), saved.length);
    const winners = previous.map(series => series.winner_id
      ? teams.find(t => t.team_id === series.winner_id) : null);
    const pairs = winners.every(Boolean) && winners.length % 2 === 0
      ? PlayoffSeeding.pairWinners(winners) : [];
    const current = [];
    for (let i = 0; i < count; i++) {
      const existing = saved.find(s => Number(s.series_number) === i + 1);
      if (existing) {
        current.push(existing);
        continue;
      }
      const projected = { round_number: r, series_number: i + 1, projected: true };
      ['high', 'low'].forEach((side, index) => {
        const team = pairs[i] && pairs[i][index];
        if (!team) return;
        projected[`${side}_seed_id`] = team.team_id;
        projected[`${side}_seed_name`] = team.name;
        projected[`${side}_seed_abbrev`] = team.abbreviation;
        projected[`${side}_seed_num`] = team.seed;
        projected[`${side}_seed_color1`] = team.color1;
        projected[`${side}_seed_color2`] = team.color2;
      });
      current.push(projected);
    }
    result.push(current);
  }
  return result;
}

function teamGradient(color1, color2) {
  const valid = color => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color || '');
  if (!valid(color1)) return '';
  const second = valid(color2) ? color2 : color1;
  return `--team-color-1:${color1};--team-color-2:${second};`;
}

function seriesCard(s, teams, roundIndex, index) {
  const complete = s.winner_id != null;
  const rows = ['high', 'low'].map(side => {
    const id = s[`${side}_seed_id`];
    if (!id) {
      const label = side === 'low' && complete && s.high_seed_id ? 'BYE' : 'TBD';
      return `<div class="b-team b-team-empty"><span class="b-seed">—</span><span class="b-tbd">${label}</span></div>`;
    }
    const team = teams.find(t => t.team_id === id);
    const name = s[`${side}_seed_name`] || (team && team.name) || 'TBD';
    const seed = s[`${side}_seed_num`] ?? (team && team.seed) ?? '—';
    const won = complete && s.winner_id === id;
    const classes = won ? ' b-winner' : complete ? ' b-loser' : '';
    const gradient = teamGradient(s[`${side}_seed_color1`] || (team && team.color1), s[`${side}_seed_color2`] || (team && team.color2));
    const logo = s[`${side}_seed_logo`] || (team && team.logo_url);
    const wins = s.projected ? '—' : (s[`${side}_seed_wins`] ?? 0);
    return `<div class="b-team${classes}${gradient ? ' b-team-colored' : ''}" style="${gradient}" title="${escapeBracketText(name)}">
      <span class="b-seed">${escapeBracketText(seed)}</span>
      ${logo ? `<img class="b-logo" src="${escapeBracketText(logo)}" alt="" loading="lazy" decoding="async">` : '<span class="b-logo-placeholder" aria-hidden="true"></span>'}
      <span class="b-team-name">${escapeBracketText(abbrev(name, s[`${side}_seed_abbrev`] || (team && team.abbreviation)))}</span>
      <span class="b-wins">${escapeBracketText(wins)}</span>
    </div>`;
  }).join('');
  const attrs = s.projected ? 'aria-label="Upcoming matchup"' :
    `data-series-id="${Number(s.id)}" onclick="openSeriesDetail(${Number(s.id)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openSeriesDetail(${Number(s.id)})}" role="button" tabindex="0" aria-label="View series details"`;
  return `<div class="b-series${complete ? ' b-series-complete' : ''}${s.projected ? ' b-series-projected' : ''}" data-round="${roundIndex}" data-match="${index}" data-winner="${s.winner_id || ''}" data-high="${s.high_seed_id || ''}" data-low="${s.low_seed_id || ''}" ${attrs}>${rows}</div>`;
}

function renderBracket(playoff, teams, rounds) {
  const bracket = buildBracketRounds(rounds, teams);
  if (!bracket.length) return '<p style="color:#8b949e">No rounds in bracket yet.</p>';
  const final = bracket[bracket.length - 1];
  const champion = final.length === 1 && final[0].winner_id
    ? teams.find(t => t.team_id === final[0].winner_id) : null;
  const activeRound = bracket.findLastIndex(round => round.some(s => !s.projected));
  const active = bracket[activeRound];
  const advanced = active && active.length > 1 && active.some(s => !s.winner_id)
    ? active.filter(s => s.winner_id).map(s => teams.find(t => t.team_id === s.winner_id)).filter(Boolean)
      .sort((a, b) => Number(a.seed) - Number(b.seed) || Number(a.team_id) - Number(b.team_id))
    : [];
  let html = '<div class="bracket-toolbar"><span id="bracket-download-status" role="status" aria-live="polite"></span><button type="button" class="bracket-download" id="bracket-download" onclick="downloadBracket()">↓ Download bracket</button></div>';
  html += advanced.length
    ? `<div class="bracket-advanced">Advanced: ${advanced.map(t => escapeBracketText(abbrev(t.name, t.abbreviation))).join(' · ')} <span>— Matchups are reseeded when the round is complete.</span></div>`
    : '';
  html += '<div class="bracket-outer"><div class="bracket-grid" id="bracket-grid"><svg class="bracket-svg" id="bracket-svg" aria-hidden="true"></svg>';
  bracket.forEach((series, index) => {
    const span = Math.pow(2, index);
    const initial = (span - 1) * SLOT_H / 2;
    const gap = span * SLOT_H - 88;
    html += `<div class="b-round"><div class="b-round-title">${roundName(index + 1, bracket.length)}</div><div class="b-round-matches" style="padding-top:${initial}px;gap:${gap}px">`;
    series.forEach((s, i) => { html += seriesCard(s, teams, index, i); });
    html += '</div></div>';
  });
  const championStyle = champion ? teamGradient(champion.color1, champion.color2) : '';
  html += `<div class="b-champion-col"><div class="b-round-title">Champion</div>
    <div class="b-champion-wrap" style="padding-top:${(Math.pow(2, bracket.length - 1) - 1) * SLOT_H / 2}px">
      <div class="b-champ-box${championStyle ? ' b-team-colored' : ''}" style="${championStyle}"><span class="b-champ-label">🏆 Champion</span><span class="b-champ-name">${champion ? escapeBracketText(champion.name) : 'TBD'}</span></div>
    </div></div></div></div>`;
  return html;
}

function drawBracketLines() {
  const svg = document.getElementById('bracket-svg');
  const grid = document.getElementById('bracket-grid');
  if (!svg || !grid) return;
  const box = grid.getBoundingClientRect();
  const width = grid.scrollWidth;
  const height = grid.scrollHeight;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  const cards = [...grid.querySelectorAll('.b-series')];
  const paths = [];
  for (const card of cards) {
    const round = Number(card.dataset.round);
    const winner = card.dataset.winner;
    if (!winner) continue;
    const target = cards.find(c => Number(c.dataset.round) === round + 1 && (c.dataset.high === winner || c.dataset.low === winner));
    if (!target) continue;
    const a = card.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const x1 = a.right - box.left, y1 = (a.top + a.bottom) / 2 - box.top;
    const x2 = b.left - box.left, y2 = (b.top + b.bottom) / 2 - box.top;
    const mid = (x1 + x2) / 2;
    paths.push(`<path d="M ${x1} ${y1} H ${mid} V ${y2} H ${x2}" />`);
  }
  const lastRound = Math.max(...cards.map(card => Number(card.dataset.round)));
  const finalists = cards.filter(card => Number(card.dataset.round) === lastRound);
  const champion = grid.querySelector('.b-champ-box');
  if (finalists.length === 1 && champion) {
    const a = finalists[0].getBoundingClientRect();
    const b = champion.getBoundingClientRect();
    const x1 = a.right - box.left, y1 = (a.top + a.bottom) / 2 - box.top;
    const x2 = b.left - box.left, y2 = (b.top + b.bottom) / 2 - box.top;
    paths.push(`<path d="M ${x1} ${y1} H ${(x1 + x2) / 2} V ${y2} H ${x2}" />`);
  }
  svg.innerHTML = paths.join('');
}

let _bracketData = null;

async function openSeriesDetail(seriesId) {
  const panel = document.getElementById('series-detail');
  const title = document.getElementById('sp-title');
  const meta = document.getElementById('sp-meta');
  const matchup = document.getElementById('sp-matchup');
  const gamesDiv = document.getElementById('sp-games');
  if (!panel || !_bracketData) return;
  const series = Object.values(_bracketData.rounds).flat().find(s => s.id === seriesId);
  if (!series) return;
  const numRounds = buildBracketRounds(_bracketData.rounds, _bracketData.teams).length;
  const pl = _bracketData.playoff;
  const winsNeeded = Math.ceil((pl.series_length || 7) / 2);
  title.textContent = `${roundName(series.round_number, numRounds)}: ${series.high_seed_name || 'TBD'} vs ${series.low_seed_name || 'TBD'}`;
  meta.textContent = `Best of ${pl.series_length} · Need ${winsNeeded} wins`;
  const hiWin = series.winner_id === series.high_seed_id;
  const loWin = series.winner_id === series.low_seed_id;
  matchup.innerHTML = `
    <div class="sp-team">
      ${series.high_seed_logo ? `<img src="${escapeBracketText(series.high_seed_logo)}" alt="${escapeBracketText(series.high_seed_name)}" />` : ''}
      <span style="${hiWin ? 'color:#3fb950;font-weight:700' : ''}">${escapeBracketText(series.high_seed_name || 'TBD')}</span>
    </div>
    <div class="sp-score">${escapeBracketText(series.high_seed_wins)} – ${escapeBracketText(series.low_seed_wins)}</div>
    <div class="sp-team">
      ${series.low_seed_logo ? `<img src="${escapeBracketText(series.low_seed_logo)}" alt="${escapeBracketText(series.low_seed_name)}" />` : ''}
      <span style="${loWin ? 'color:#3fb950;font-weight:700' : ''}">${escapeBracketText(series.low_seed_name || 'TBD')}</span>
    </div>`;
  panel.style.display = '';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  gamesDiv.innerHTML = '<p class="loading" style="font-size:0.85rem;">Loading games…</p>';
  try {
    const res = await fetch(`${API}/playoff-series/${seriesId}/games`);
    if (!res.ok) throw new Error('Failed to load games');
    const games = await res.json();
    if (games.length === 0) {
      gamesDiv.innerHTML = '<p style="color:#8b949e;font-size:0.85rem;">No games recorded for this series yet.</p>';
    } else {
      gamesDiv.innerHTML = `<table class="series-games-table">
        <thead><tr><th>Date</th><th>Home</th><th>Score</th><th>Away</th><th>Status</th></tr></thead>
        <tbody>${games.map(g => {
          const isDone = g.status === 'complete' || g.status === 'forfeit';
          const score = isDone ? `${escapeBracketText(g.home_score)} – ${escapeBracketText(g.away_score)}` : '—';
          const ot = g.is_overtime ? ' <span style="color:#e3b341;font-size:0.75rem;font-weight:700;">OT</span>' : '';
          const statusLabel = (g.status === 'forfeit' || g.is_forfeit) ? '🏳 Forfeit' : (g.status === 'complete' ? '✅ Final' : '🕐 Scheduled');
          return `<tr onclick="window.location.href='game.html?id=${Number(g.id)}'" title="View game stats">
            <td>${escapeBracketText(g.date)}</td><td>${escapeBracketText(g.home_team_name)}</td><td><strong>${score}</strong>${ot}</td>
            <td>${escapeBracketText(g.away_team_name)}</td><td>${statusLabel}</td></tr>`;
        }).join('')}</tbody></table>`;
    }
  } catch {
    gamesDiv.innerHTML = '<p class="error" style="font-size:0.85rem;">Failed to load games.</p>';
  }
}

function closeSeriesDetail() {
  const panel = document.getElementById('series-detail');
  if (panel) panel.style.display = 'none';
}

async function loadPlayoff() {
  const root = document.getElementById('playoff-root');
  const sid = typeof SeasonSelector !== 'undefined' ? SeasonSelector.getSelectedSeasonId() : null;
  const isPlayoffSeason = typeof SeasonSelector !== 'undefined' ? SeasonSelector.getSelectedSeasonIsPlayoff() : false;
  if (!sid) {
    root.innerHTML = '<div class="bracket-empty"><p>Select a league and season above to view the playoff bracket.</p></div>';
    return;
  }
  root.innerHTML = '<p class="loading">Loading playoff bracket…</p>';
  closeSeriesDetail();
  try {
    const endpoint = isPlayoffSeason ? `${API}/playoffs/by-playoff-season/${sid}` : `${API}/playoffs/by-season/${sid}`;
    const res = await fetch(endpoint);
    if (res.status === 404) {
      root.innerHTML = '<div class="bracket-empty"><p>No playoff bracket has been created for this season yet.</p><p style="font-size:0.85rem;margin-top:0.5rem;">An admin can create one in the <a href="admin.html" style="color:#58a6ff;">Admin Panel → Playoffs</a> tab.</p></div>';
      return;
    }
    if (!res.ok) throw new Error('Failed to load playoff');
    const data = await res.json();
    _bracketData = data;
    root.innerHTML = renderBracket(data.playoff, data.teams, data.rounds);
    requestAnimationFrame(() => requestAnimationFrame(drawBracketLines));
  } catch (err) {
    root.innerHTML = '<p class="error">Failed to load playoff bracket. Is the server running?</p>';
  }
}

window.addEventListener('resize', () => {
  if (_bracketData && _bracketData.rounds) drawBracketLines();
});

(async () => {
  if (document.title.includes('Playoffs') && !document.getElementById('standings-root')) {
    try {
      if (typeof SeasonSelector !== 'undefined') {
        await SeasonSelector.init('season-selector-container', { noAllTime: true, seasonFilter: 'playoff' });
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
