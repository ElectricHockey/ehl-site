/* records.js – League Records page */
const API = '/api';

let _leagueType = '3s';
let _category   = 'alltime';
let _data       = {};   // cache: { '3s': {...}, '6s': {...} }

// ── Format helpers ─────────────────────────────────────────────────────────
function fmt(v, type) {
  if (v === null || v === undefined) return '–';
  if (type === 'pct3') return Number(v).toFixed(3);
  if (type === 'dec2') return Number(v).toFixed(2);
  if (type === 'pm')   return v > 0 ? '+' + v : String(v);
  return String(v);
}

function playerLink(name) {
  if (!name) return '–';
  return `<a class="player-link" href="player.html?name=${encodeURIComponent(name)}">${name}</a>`;
}

function gameRef(rec) {
  if (!rec) return '';
  const d = rec.date ? new Date(rec.date).toLocaleDateString() : '';
  return `<span class="rec-meta">${rec.home_team || ''} vs ${rec.away_team || ''} ${d}</span>`;
}

// ── Render helpers ─────────────────────────────────────────────────────────
function buildRow(label, rec, fmtType, extra) {
  if (!rec || rec.value === null || rec.value === undefined) {
    return `<tr><td class="rec-meta">${label}</td><td colspan="3" class="rec-meta">–</td></tr>`;
  }
  return `<tr>
    <td class="rec-meta">${label}</td>
    <td>${playerLink(rec.name)}</td>
    <td class="rec-val">${fmt(rec.value, fmtType)}</td>
    <td>${extra || ''}</td>
  </tr>`;
}

function table(rows) {
  return `<div style="overflow-x:auto;"><table class="rec-table">
    <thead><tr>
      <th>Record</th><th>Player</th><th>Value</th><th></th>
    </tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table></div>`;
}

function section(title) {
  return `<p class="rec-section-title">${title}</p>`;
}

// ── Render all-time ────────────────────────────────────────────────────────
function renderAllTime(career) {
  const skaterRows = [
    buildRow('Points',    career.pts,        null,  `<span class="rec-meta">GP ${career.pts?.gp || '–'}</span>`),
    buildRow('Goals',     career.goals,      null,  `<span class="rec-meta">GP ${career.goals?.gp || '–'}</span>`),
    buildRow('Assists',   career.assists,    null,  `<span class="rec-meta">GP ${career.assists?.gp || '–'}</span>`),
    buildRow('+/-',       career.plus_minus, 'pm',  `<span class="rec-meta">GP ${career.plus_minus?.gp || '–'}</span>`),
    buildRow('Hits',      career.hits,       null,  `<span class="rec-meta">GP ${career.hits?.gp || '–'}</span>`),
    buildRow('Shots',     career.shots,      null,  `<span class="rec-meta">GP ${career.shots?.gp || '–'}</span>`),
    buildRow('PIM',       career.pim,        null,  `<span class="rec-meta">GP ${career.pim?.gp || '–'}</span>`),
  ];
  const goalieRows = [
    buildRow('Save%',     career.save_pct,   'pct3', `<span class="rec-meta">GP ${career.save_pct?.gp || '–'}</span>`),
    buildRow('GAA',       career.gaa,        'dec2', `<span class="rec-meta">GP ${career.gaa?.gp || '–'}</span>`),
    buildRow('Wins',      career.goalie_wins, null,  `<span class="rec-meta">GP ${career.goalie_wins?.gp || '–'}</span>`),
    buildRow('Shutouts',  career.shutouts,   null,  `<span class="rec-meta">GP ${career.shutouts?.gp || '–'}</span>`),
  ];
  return section('Skater Records') + table(skaterRows) +
         section('Goalie Records')  + table(goalieRows);
}

// ── Render seasonal ────────────────────────────────────────────────────────
function renderSeasonal(seasonal) {
  function meta(rec) {
    if (!rec) return '';
    const s = rec.season_name ? `Season: ${rec.season_name}` : '';
    const g = rec.gp ? `GP ${rec.gp}` : '';
    return `<span class="rec-meta">${[s, g].filter(Boolean).join(' | ')}</span>`;
  }
  const skaterRows = [
    buildRow('Points',    seasonal.pts,        null,  meta(seasonal.pts)),
    buildRow('Goals',     seasonal.goals,      null,  meta(seasonal.goals)),
    buildRow('Assists',   seasonal.assists,    null,  meta(seasonal.assists)),
    buildRow('+/-',       seasonal.plus_minus, 'pm',  meta(seasonal.plus_minus)),
    buildRow('Hits',      seasonal.hits,       null,  meta(seasonal.hits)),
    buildRow('Shots',     seasonal.shots,      null,  meta(seasonal.shots)),
    buildRow('PIM',       seasonal.pim,        null,  meta(seasonal.pim)),
  ];
  const goalieRows = [
    buildRow('Save%',     seasonal.save_pct,    'pct3', meta(seasonal.save_pct)),
    buildRow('GAA',       seasonal.gaa,         'dec2', meta(seasonal.gaa)),
    buildRow('Wins',      seasonal.goalie_wins, null,   meta(seasonal.goalie_wins)),
    buildRow('Shutouts',  seasonal.shutouts,    null,   meta(seasonal.shutouts)),
  ];
  return section('Skater Records') + table(skaterRows) +
         section('Goalie Records')  + table(goalieRows);
}

// ── Render single game ─────────────────────────────────────────────────────
function renderSingleGame(sg) {
  const skaterRows = [
    buildRow('Points',    sg.pts,        null, gameRef(sg.pts)),
    buildRow('Goals',     sg.goals,      null, gameRef(sg.goals)),
    buildRow('Assists',   sg.assists,    null, gameRef(sg.assists)),
    buildRow('+/-',       sg.plus_minus, 'pm', gameRef(sg.plus_minus)),
    buildRow('Hits',      sg.hits,       null, gameRef(sg.hits)),
    buildRow('Shots',     sg.shots,      null, gameRef(sg.shots)),
    buildRow('PIM',       sg.pim,        null, gameRef(sg.pim)),
  ];
  const goalieRows = [
    buildRow('Saves',         sg.saves,         null, gameRef(sg.saves)),
    buildRow('Goals Against', sg.goals_against,  null, gameRef(sg.goals_against)),
  ];
  return section('Skater Records') + table(skaterRows) +
         section('Goalie Records')  + table(goalieRows);
}

// ── Main render ────────────────────────────────────────────────────────────
function render() {
  const root = document.getElementById('records-root');
  const d = _data[_leagueType];
  if (!d) { root.innerHTML = '<p class="loading">Loading…</p>'; return; }
  if (_category === 'alltime')    root.innerHTML = renderAllTime(d.career);
  if (_category === 'seasonal')   root.innerHTML = renderSeasonal(d.seasonal);
  if (_category === 'singlegame') root.innerHTML = renderSingleGame(d.singleGame);
}

// ── Fetch ──────────────────────────────────────────────────────────────────
async function loadRecords(lt) {
  if (_data[lt]) { render(); return; }
  document.getElementById('records-root').innerHTML = '<p class="loading">Loading…</p>';
  try {
    const res = await fetch(`${API}/records?league_type=${lt}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _data[lt] = await res.json();
  } catch (e) {
    _data[lt] = null;
    document.getElementById('records-root').innerHTML = `<p style="color:#f85149;">Failed to load records.</p>`;
    return;
  }
  render();
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.league-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.league-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _leagueType = btn.dataset.lt;
      loadRecords(_leagueType);
    });
  });

  document.querySelectorAll('.rec-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rec-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _category = btn.dataset.cat;
      render();
    });
  });

  loadRecords(_leagueType);
});
