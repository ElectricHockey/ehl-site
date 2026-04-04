/* records.js – League Records page */
const API = '/api';

let _leagueType = 'threes';
let _category   = 'alltime';
let _data       = {};   // cache: { threes: {...}, sixes: {...} }

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

function gameRef(r) {
  if (!r) return '';
  const d = r.date ? new Date(r.date).toLocaleDateString() : '';
  const label = `${r.home_team || ''} vs ${r.away_team || ''} ${d}`.trim();
  if (r.game_id) {
    return `<a class="rec-game-link player-link" href="game.html?id=${r.game_id}">${label}</a>`;
  }
  return `<span class="rec-meta">${label}</span>`;
}

// ── Render helpers ─────────────────────────────────────────────────────────
// rec may be a single object or an array (tied record holders)
function buildRow(label, rec, fmtType, extraFn) {
  const recs = Array.isArray(rec) ? rec : (rec ? [rec] : []);
  if (recs.length === 0 || recs[0] === null || recs[0].value === null || recs[0].value === undefined) {
    return `<tr><td class="rec-meta">${label}</td><td colspan="3" class="rec-meta">–</td></tr>`;
  }
  if (recs.length === 1) {
    const r = recs[0];
    const extra = extraFn ? extraFn(r) : '';
    return `<tr>
      <td class="rec-meta">${label}</td>
      <td>${playerLink(r.name)}</td>
      <td class="rec-val">${fmt(r.value, fmtType)}</td>
      <td>${extra}</td>
    </tr>`;
  }
  // Multiple tied holders – one row per player, label shows "tied" after first
  return recs.map((r, i) => {
    const extra = extraFn ? extraFn(r) : '';
    return `<tr>
      <td class="rec-meta">${i === 0 ? label : '<span style="color:#8b949e;font-style:italic;font-size:0.82em;">↳ tied</span>'}</td>
      <td>${playerLink(r.name)}</td>
      <td class="rec-val">${fmt(r.value, fmtType)}</td>
      <td>${extra}</td>
    </tr>`;
  }).join('');
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
  function gpMeta(r) {
    return r ? `<span class="rec-meta">GP ${r.gp || '–'}</span>` : '';
  }
  const isThrees = _leagueType === 'threes';
  const skaterRows = [
    buildRow('GP',               career.gp,               null,  gpMeta),
    buildRow('Points',           career.pts,               null,  gpMeta),
    buildRow('Goals',            career.goals,             null,  gpMeta),
    buildRow('Assists',          career.assists,           null,  gpMeta),
    buildRow('+/-',              career.plus_minus,        'pm',  gpMeta),
    buildRow('Hits',             career.hits,              null,  gpMeta),
    buildRow('Shots',            career.shots,             null,  gpMeta),
    buildRow('Shot Attempts',    career.shot_attempts,     null,  gpMeta),
    buildRow('Blocked Shots',    career.blocked_shots,     null,  gpMeta),
    buildRow('PIM',              career.pim,               null,  gpMeta),
    ...(!isThrees ? [
      buildRow('PP Goals',       career.pp_goals,          null,  gpMeta),
      buildRow('SH Goals',       career.sh_goals,          null,  gpMeta),
    ] : []),
    buildRow('GWG',              career.gwg,               null,  gpMeta),
    buildRow('Hat Tricks',       career.hat_tricks,        null,  gpMeta),
    buildRow('Faceoff Wins',     career.faceoff_wins,      null,  gpMeta),
    buildRow('Deflections',      career.deflections,       null,  gpMeta),
    buildRow('Interceptions',    career.interceptions,     null,  gpMeta),
    buildRow('Takeaways',        career.takeaways,         null,  gpMeta),
    buildRow('Giveaways',        career.giveaways,         null,  gpMeta),
    buildRow('Pass Completions', career.pass_completions,  null,  gpMeta),
    buildRow('Penalties Drawn',  career.penalties_drawn,   null,  gpMeta),
  ];
  const goalieRows = [
    buildRow('GP',               career.goalie_gp,         null,  () => ''),
    buildRow('Wins',             career.goalie_wins,       null,  gpMeta),
    buildRow('Saves',            career.saves,             null,  gpMeta),
    buildRow('Shutouts',         career.shutouts,          null,  gpMeta),
    buildRow('PSA',              career.psa,               null,  gpMeta),
    buildRow('BKSV',             career.bksv,              null,  gpMeta),
    buildRow('Goals Against',    career.goals_against,     null,  gpMeta),
  ];
  return section('Skater Records') + table(skaterRows) +
         section('Goalie Records')  + table(goalieRows);
}

// ── Render seasonal ────────────────────────────────────────────────────────
function renderSeasonal(seasonal, goalieSeasonMinGP) {
  function meta(r) {
    if (!r) return '';
    const s = r.season_name ? `Season: ${r.season_name}` : '';
    const g = r.gp ? `GP ${r.gp}` : '';
    return `<span class="rec-meta">${[s, g].filter(Boolean).join(' | ')}</span>`;
  }
  const isThrees = _leagueType === 'threes';
  const skaterRows = [
    buildRow('Points',           seasonal.pts,              null,  meta),
    buildRow('Goals',            seasonal.goals,            null,  meta),
    buildRow('Assists',          seasonal.assists,          null,  meta),
    buildRow('+/-',              seasonal.plus_minus,       'pm',  meta),
    buildRow('Hits',             seasonal.hits,             null,  meta),
    buildRow('Shots',            seasonal.shots,            null,  meta),
    buildRow('Shot Attempts',    seasonal.shot_attempts,    null,  meta),
    buildRow('Blocked Shots',    seasonal.blocked_shots,    null,  meta),
    buildRow('PIM',              seasonal.pim,              null,  meta),
    ...(!isThrees ? [
      buildRow('PP Goals',       seasonal.pp_goals,         null,  meta),
      buildRow('SH Goals',       seasonal.sh_goals,         null,  meta),
    ] : []),
    buildRow('GWG',              seasonal.gwg,              null,  meta),
    buildRow('Hat Tricks',       seasonal.hat_tricks,       null,  meta),
    buildRow('Faceoff Wins',     seasonal.faceoff_wins,     null,  meta),
    buildRow('Deflections',      seasonal.deflections,      null,  meta),
    buildRow('Interceptions',    seasonal.interceptions,    null,  meta),
    buildRow('Takeaways',        seasonal.takeaways,        null,  meta),
    buildRow('Giveaways',        seasonal.giveaways,        null,  meta),
    buildRow('Pass Completions', seasonal.pass_completions, null,  meta),
    buildRow('Penalties Drawn',  seasonal.penalties_drawn,  null,  meta),
  ];
  const minLabel = goalieSeasonMinGP ? ` (min ${goalieSeasonMinGP} GP)` : '';
  const goalieRows = [
    buildRow('Wins',             seasonal.goalie_wins,      null,  meta),
    buildRow('Saves',            seasonal.saves,            null,  meta),
    buildRow('Shutouts',         seasonal.shutouts,         null,  meta),
    buildRow('PSA',              seasonal.psa,              null,  meta),
    buildRow('BKSV',             seasonal.bksv,             null,  meta),
    buildRow('Goals Against',    seasonal.goals_against,    null,  meta),
    buildRow('Save%' + minLabel, seasonal.save_pct,         'pct3',meta),
  ];
  return section('Skater Records') + table(skaterRows) +
         section('Goalie Records')  + table(goalieRows);
}

// ── Render single game ─────────────────────────────────────────────────────
function renderSingleGame(sg) {
  const isThrees = _leagueType === 'threes';
  const skaterRows = [
    buildRow('Points',           sg.pts,              null, gameRef),
    buildRow('Goals',            sg.goals,            null, gameRef),
    buildRow('Assists',          sg.assists,          null, gameRef),
    buildRow('+/-',              sg.plus_minus,       'pm', gameRef),
    buildRow('Hits',             sg.hits,             null, gameRef),
    buildRow('Shots',            sg.shots,            null, gameRef),
    buildRow('Shot Attempts',    sg.shot_attempts,    null, gameRef),
    buildRow('Blocked Shots',    sg.blocked_shots,    null, gameRef),
    buildRow('PIM',              sg.pim,              null, gameRef),
    ...(!isThrees ? [
      buildRow('PP Goals',       sg.pp_goals,         null, gameRef),
      buildRow('SH Goals',       sg.sh_goals,         null, gameRef),
    ] : []),
    buildRow('GWG',              sg.gwg,              null, gameRef),
    buildRow('Hat Tricks',       sg.hat_tricks,       null, gameRef),
    buildRow('Faceoff Wins',     sg.faceoff_wins,     null, gameRef),
    buildRow('Deflections',      sg.deflections,      null, gameRef),
    buildRow('Interceptions',    sg.interceptions,    null, gameRef),
    buildRow('Takeaways',        sg.takeaways,        null, gameRef),
    buildRow('Giveaways',        sg.giveaways,        null, gameRef),
    buildRow('Pass Completions', sg.pass_completions, null, gameRef),
    buildRow('Penalties Drawn',  sg.penalties_drawn,  null, gameRef),
  ];
  const goalieRows = [
    buildRow('Saves',            sg.saves,            null, gameRef),
    buildRow('Shutouts',         sg.shutouts,         null, gameRef),
    buildRow('PSA',              sg.psa,              null, gameRef),
    buildRow('BKSV',             sg.bksv,             null, gameRef),
    buildRow('Goals Against',    sg.goals_against,    null, gameRef),
  ];
  return section('Skater Records') + table(skaterRows) +
         section('Goalie Records')  + table(goalieRows);
}

// ── Main render ────────────────────────────────────────────────────────────
function render() {
  const root = document.getElementById('records-root');
  const d = _data[_leagueType];
  if (!d) { root.innerHTML = '<p class="loading">Loading…</p>'; return; }
  const minGP = d.goalieSeasonMinGP || 16;
  if (_category === 'alltime')    root.innerHTML = renderAllTime(d.career);
  if (_category === 'seasonal')   root.innerHTML = renderSeasonal(d.seasonal, minGP);
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
