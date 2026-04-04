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
  function gpMeta(rec) {
    return rec ? `<span class="rec-meta">GP ${rec.gp || '–'}</span>` : '';
  }
  const skaterRows = [
    buildRow('GP',               career.gp,               null,  gpMeta(career.gp)),
    buildRow('Points',           career.pts,               null,  gpMeta(career.pts)),
    buildRow('Goals',            career.goals,             null,  gpMeta(career.goals)),
    buildRow('Assists',          career.assists,           null,  gpMeta(career.assists)),
    buildRow('+/-',              career.plus_minus,        'pm',  gpMeta(career.plus_minus)),
    buildRow('Hits',             career.hits,              null,  gpMeta(career.hits)),
    buildRow('Shots',            career.shots,             null,  gpMeta(career.shots)),
    buildRow('Shot Attempts',    career.shot_attempts,     null,  gpMeta(career.shot_attempts)),
    buildRow('Blocked Shots',    career.blocked_shots,     null,  gpMeta(career.blocked_shots)),
    buildRow('PIM',              career.pim,               null,  gpMeta(career.pim)),
    buildRow('PP Goals',         career.pp_goals,          null,  gpMeta(career.pp_goals)),
    buildRow('SH Goals',         career.sh_goals,          null,  gpMeta(career.sh_goals)),
    buildRow('GWG',              career.gwg,               null,  gpMeta(career.gwg)),
    buildRow('Hat Tricks',       career.hat_tricks,        null,  gpMeta(career.hat_tricks)),
    buildRow('Faceoff Wins',     career.faceoff_wins,      null,  gpMeta(career.faceoff_wins)),
    buildRow('Deflections',      career.deflections,       null,  gpMeta(career.deflections)),
    buildRow('Interceptions',    career.interceptions,     null,  gpMeta(career.interceptions)),
    buildRow('Takeaways',        career.takeaways,         null,  gpMeta(career.takeaways)),
    buildRow('Giveaways',        career.giveaways,         null,  gpMeta(career.giveaways)),
    buildRow('Pass Completions', career.pass_completions,  null,  gpMeta(career.pass_completions)),
    buildRow('Penalties Drawn',  career.penalties_drawn,   null,  gpMeta(career.penalties_drawn)),
  ];
  const goalieRows = [
    buildRow('GP',               career.goalie_gp,         null,  ''),
    buildRow('Wins',             career.goalie_wins,       null,  gpMeta(career.goalie_wins)),
    buildRow('Saves',            career.saves,             null,  gpMeta(career.saves)),
    buildRow('Shutouts',         career.shutouts,          null,  gpMeta(career.shutouts)),
    buildRow('PSA',              career.psa,               null,  gpMeta(career.psa)),
    buildRow('BKSV',             career.bksv,              null,  gpMeta(career.bksv)),
    buildRow('Goals Against',    career.goals_against,     null,  gpMeta(career.goals_against)),
  ];
  return section('Skater Records') + table(skaterRows) +
         section('Goalie Records')  + table(goalieRows);
}

// ── Render seasonal ────────────────────────────────────────────────────────
function renderSeasonal(seasonal, goalieSeasonMinGP) {
  function meta(rec) {
    if (!rec) return '';
    const s = rec.season_name ? `Season: ${rec.season_name}` : '';
    const g = rec.gp ? `GP ${rec.gp}` : '';
    return `<span class="rec-meta">${[s, g].filter(Boolean).join(' | ')}</span>`;
  }
  const skaterRows = [
    buildRow('Points',           seasonal.pts,              null,  meta(seasonal.pts)),
    buildRow('Goals',            seasonal.goals,            null,  meta(seasonal.goals)),
    buildRow('Assists',          seasonal.assists,          null,  meta(seasonal.assists)),
    buildRow('+/-',              seasonal.plus_minus,       'pm',  meta(seasonal.plus_minus)),
    buildRow('Hits',             seasonal.hits,             null,  meta(seasonal.hits)),
    buildRow('Shots',            seasonal.shots,            null,  meta(seasonal.shots)),
    buildRow('Shot Attempts',    seasonal.shot_attempts,    null,  meta(seasonal.shot_attempts)),
    buildRow('Blocked Shots',    seasonal.blocked_shots,    null,  meta(seasonal.blocked_shots)),
    buildRow('PIM',              seasonal.pim,              null,  meta(seasonal.pim)),
    buildRow('PP Goals',         seasonal.pp_goals,         null,  meta(seasonal.pp_goals)),
    buildRow('SH Goals',         seasonal.sh_goals,         null,  meta(seasonal.sh_goals)),
    buildRow('GWG',              seasonal.gwg,              null,  meta(seasonal.gwg)),
    buildRow('Hat Tricks',       seasonal.hat_tricks,       null,  meta(seasonal.hat_tricks)),
    buildRow('Faceoff Wins',     seasonal.faceoff_wins,     null,  meta(seasonal.faceoff_wins)),
    buildRow('Deflections',      seasonal.deflections,      null,  meta(seasonal.deflections)),
    buildRow('Interceptions',    seasonal.interceptions,    null,  meta(seasonal.interceptions)),
    buildRow('Takeaways',        seasonal.takeaways,        null,  meta(seasonal.takeaways)),
    buildRow('Giveaways',        seasonal.giveaways,        null,  meta(seasonal.giveaways)),
    buildRow('Pass Completions', seasonal.pass_completions, null,  meta(seasonal.pass_completions)),
    buildRow('Penalties Drawn',  seasonal.penalties_drawn,  null,  meta(seasonal.penalties_drawn)),
  ];
  const minLabel = goalieSeasonMinGP ? ` (min ${goalieSeasonMinGP} GP)` : '';
  const goalieRows = [
    buildRow('Wins',             seasonal.goalie_wins,      null,  meta(seasonal.goalie_wins)),
    buildRow('Saves',            seasonal.saves,            null,  meta(seasonal.saves)),
    buildRow('Shutouts',         seasonal.shutouts,         null,  meta(seasonal.shutouts)),
    buildRow('PSA',              seasonal.psa,              null,  meta(seasonal.psa)),
    buildRow('BKSV',             seasonal.bksv,             null,  meta(seasonal.bksv)),
    buildRow('Goals Against',    seasonal.goals_against,    null,  meta(seasonal.goals_against)),
    buildRow('Save%' + minLabel, seasonal.save_pct,         'pct3',meta(seasonal.save_pct)),
  ];
  return section('Skater Records') + table(skaterRows) +
         section('Goalie Records')  + table(goalieRows);
}

// ── Render single game ─────────────────────────────────────────────────────
function renderSingleGame(sg) {
  const skaterRows = [
    buildRow('Points',           sg.pts,              null, gameRef(sg.pts)),
    buildRow('Goals',            sg.goals,            null, gameRef(sg.goals)),
    buildRow('Assists',          sg.assists,          null, gameRef(sg.assists)),
    buildRow('+/-',              sg.plus_minus,       'pm', gameRef(sg.plus_minus)),
    buildRow('Hits',             sg.hits,             null, gameRef(sg.hits)),
    buildRow('Shots',            sg.shots,            null, gameRef(sg.shots)),
    buildRow('Shot Attempts',    sg.shot_attempts,    null, gameRef(sg.shot_attempts)),
    buildRow('Blocked Shots',    sg.blocked_shots,    null, gameRef(sg.blocked_shots)),
    buildRow('PIM',              sg.pim,              null, gameRef(sg.pim)),
    buildRow('PP Goals',         sg.pp_goals,         null, gameRef(sg.pp_goals)),
    buildRow('SH Goals',         sg.sh_goals,         null, gameRef(sg.sh_goals)),
    buildRow('GWG',              sg.gwg,              null, gameRef(sg.gwg)),
    buildRow('Hat Tricks',       sg.hat_tricks,       null, gameRef(sg.hat_tricks)),
    buildRow('Faceoff Wins',     sg.faceoff_wins,     null, gameRef(sg.faceoff_wins)),
    buildRow('Deflections',      sg.deflections,      null, gameRef(sg.deflections)),
    buildRow('Interceptions',    sg.interceptions,    null, gameRef(sg.interceptions)),
    buildRow('Takeaways',        sg.takeaways,        null, gameRef(sg.takeaways)),
    buildRow('Giveaways',        sg.giveaways,        null, gameRef(sg.giveaways)),
    buildRow('Pass Completions', sg.pass_completions, null, gameRef(sg.pass_completions)),
    buildRow('Penalties Drawn',  sg.penalties_drawn,  null, gameRef(sg.penalties_drawn)),
  ];
  const goalieRows = [
    buildRow('Saves',            sg.saves,            null, gameRef(sg.saves)),
    buildRow('Shutouts',         sg.shutouts,         null, gameRef(sg.shutouts)),
    buildRow('PSA',              sg.psa,              null, gameRef(sg.psa)),
    buildRow('BKSV',             sg.bksv,             null, gameRef(sg.bksv)),
    buildRow('Goals Against',    sg.goals_against,    null, gameRef(sg.goals_against)),
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
