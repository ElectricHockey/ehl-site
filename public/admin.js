const API = '/api';

// ── Utility ──────────────────────────────────────────────────────────────

function showStatus(msg, isError = false) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className = isError ? 'error' : 'success';
}

// ── Teams ─────────────────────────────────────────────────────────────────

async function loadTeams() {
  const res = await fetch(`${API}/teams`);
  const teams = await res.json();
  const tbody = document.querySelector('#teams-table tbody');
  tbody.innerHTML = teams.length === 0
    ? '<tr><td colspan="6" style="color:#8b949e">No teams yet.</td></tr>'
    : teams.map(t => `
      <tr>
        <td>${t.id}</td>
        <td>${t.name}</td>
        <td>${t.conference}</td>
        <td>${t.division}</td>
        <td>
          <span id="ea-id-${t.id}" data-value="${t.ea_club_id ?? ''}">${t.ea_club_id ?? '—'}</span>
          <button class="btn-secondary" style="margin-left:0.4rem;padding:0.2rem 0.5rem;font-size:0.8rem;" onclick="setEaId(${t.id})">Edit</button>
        </td>
        <td><button class="btn-danger" onclick="deleteTeam(${t.id})">Delete</button></td>
      </tr>`).join('');

  // Populate team dropdowns
  const opts = '<option value="">— No Team —</option>' + teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  document.getElementById('player-team').innerHTML = opts;

  const gameOpt = '<option value="">Select team</option>' + teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  document.getElementById('game-home').innerHTML = gameOpt;
  document.getElementById('game-away').innerHTML = gameOpt;
}

document.getElementById('team-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('team-name').value.trim();
  const conference = document.getElementById('team-conference').value.trim();
  const division = document.getElementById('team-division').value.trim();
  const ea_club_id = document.getElementById('team-ea-id').value ? Number(document.getElementById('team-ea-id').value) : null;
  await fetch(`${API}/teams`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, conference, division, ea_club_id }) });
  e.target.reset();
  await loadTeams();
  await loadGames();
});

async function deleteTeam(id) {
  if (!confirm('Delete this team? Related players and games will also be removed.')) return;
  await fetch(`${API}/teams/${id}`, { method: 'DELETE' });
  await loadTeams();
  await loadPlayers();
  await loadGames();
}

async function setEaId(id) {
  const current = document.getElementById(`ea-id-${id}`).dataset.value || '';
  const val = prompt('Enter EA Club ID for this team (leave blank to clear):', current);
  if (val === null) return; // cancelled
  await fetch(`${API}/teams/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ea_club_id: val ? Number(val) : null }),
  });
  await loadTeams();
}

// ── Players ───────────────────────────────────────────────────────────────

async function loadPlayers() {
  const res = await fetch(`${API}/players`);
  const players = await res.json();
  const tbody = document.querySelector('#players-table tbody');
  tbody.innerHTML = players.length === 0
    ? '<tr><td colspan="6" style="color:#8b949e">No players yet.</td></tr>'
    : players.map(p => `
      <tr>
        <td>${p.id}</td>
        <td>${p.number ?? '–'}</td>
        <td>${p.name}</td>
        <td>${p.position ?? '–'}</td>
        <td>${p.team_name ?? '–'}</td>
        <td><button class="btn-danger" onclick="deletePlayer(${p.id})">Delete</button></td>
      </tr>`).join('');
}

document.getElementById('player-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('player-name').value.trim();
  const team_id = document.getElementById('player-team').value || null;
  const position = document.getElementById('player-position').value.trim() || null;
  const number = document.getElementById('player-number').value || null;
  await fetch(`${API}/players`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, team_id, position, number }) });
  e.target.reset();
  await loadTeams(); // refresh dropdowns
  await loadPlayers();
});

async function deletePlayer(id) {
  if (!confirm('Delete this player?')) return;
  await fetch(`${API}/players/${id}`, { method: 'DELETE' });
  await loadPlayers();
}

// ── Games ─────────────────────────────────────────────────────────────────

async function loadGames() {
  const res = await fetch(`${API}/games`);
  const games = await res.json();
  const tbody = document.querySelector('#games-table tbody');
  tbody.innerHTML = games.length === 0
    ? '<tr><td colspan="6" style="color:#8b949e">No games yet.</td></tr>'
    : games.map(g => `
      <tr>
        <td>${g.id}</td>
        <td>${g.date}</td>
        <td>${g.home_team_name}</td>
        <td>${g.home_score} – ${g.away_score}</td>
        <td>${g.away_team_name}</td>
        <td><button class="btn-danger" onclick="deleteGame(${g.id})">Delete</button></td>
      </tr>`).join('');
}

document.getElementById('game-form').addEventListener('submit', async e => {
  e.preventDefault();
  const date = document.getElementById('game-date').value;
  const home_team_id = document.getElementById('game-home').value;
  const away_team_id = document.getElementById('game-away').value;
  const home_score = parseInt(document.getElementById('game-home-score').value) || 0;
  const away_score = parseInt(document.getElementById('game-away-score').value) || 0;
  if (home_team_id === away_team_id) { alert('Home and away teams must differ.'); return; }
  await fetch(`${API}/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, home_team_id, away_team_id, home_score, away_score }) });
  e.target.reset();
  await loadGames();
});

async function deleteGame(id) {
  if (!confirm('Delete this game?')) return;
  await fetch(`${API}/games/${id}`, { method: 'DELETE' });
  await loadGames();
}

// ── EA Match Assignment ───────────────────────────────────────────────────

document.getElementById('assign-form').addEventListener('submit', async e => {
  e.preventDefault();
  const ea_match_id = document.getElementById('assign-ea').value;
  const game_id = document.getElementById('assign-game').value;
  const res = await fetch(`${API}/ea-matches/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ea_match_id: Number(ea_match_id), game_id: Number(game_id) })
  });
  if (res.ok) {
    showStatus('EA match assigned successfully!');
    e.target.reset();
  } else {
    const err = await res.json();
    showStatus(err.error || 'Assignment failed.', true);
  }
});

// ── Init ──────────────────────────────────────────────────────────────────

(async () => {
  await loadTeams();
  await loadPlayers();
  await loadGames();
})();
