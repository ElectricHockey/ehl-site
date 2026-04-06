const API = '/api';

let allPlayers = [];
let sortState = { key: 'name', dir: 'asc' };

async function loadPlayers() {
  try {
    const [playersRes, teamsRes] = await Promise.all([
      fetch(`${API}/players`),
      fetch(`${API}/teams`),
    ]);

    const players = playersRes.ok ? await playersRes.json() : [];
    const teams   = teamsRes.ok  ? await teamsRes.json()   : [];

    // Build team lookup
    const teamMap = {};
    for (const t of teams) teamMap[t.id] = t;

    // Enrich players with team info
    allPlayers = players.map(p => {
      const t = p.team_id ? teamMap[p.team_id] : null;
      return {
        ...p,
        team_name:  t ? t.name      : null,
        team_logo:  t ? t.logo_url  : null,
        team_color1: t ? t.color1   : null,
      };
    });

    // Populate team filter dropdown
    const teamFilter = document.getElementById('player-team-filter');
    if (teamFilter) {
      const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name));
      for (const t of sorted) {
        const opt = document.createElement('option');
        opt.value = String(t.id);
        opt.textContent = t.name;
        teamFilter.appendChild(opt);
      }
    }

    applyFilters();
  } catch {
    document.getElementById('players-tbody').innerHTML =
      '<tr><td colspan="5" style="color:#f85149;">Failed to load players. Is the server running?</td></tr>';
  }
}

function getFiltered() {
  const search = (document.getElementById('player-search')?.value || '').toLowerCase().trim();
  const teamId = document.getElementById('player-team-filter')?.value || '';
  const pos    = document.getElementById('player-pos-filter')?.value  || '';
  const status = document.getElementById('player-status-filter')?.value || '';

  return allPlayers.filter(p => {
    if (search && !(p.name || '').toLowerCase().includes(search)) return false;
    if (teamId && String(p.team_id) !== teamId) return false;
    if (pos && p.position !== pos) return false;
    if (status === 'rostered' && !p.is_rostered) return false;
    if (status === 'fa' && p.is_rostered) return false;
    return true;
  });
}

function sortData(arr) {
  const { key, dir } = sortState;
  return [...arr].sort((a, b) => {
    let av = a[key], bv = b[key];
    if (key === 'number') { av = Number(av) || 0; bv = Number(bv) || 0; }
    else { av = (av || '').toString().toLowerCase(); bv = (bv || '').toString().toLowerCase(); }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function applyFilters() {
  const filtered = sortData(getFiltered());
  const tbody = document.getElementById('players-tbody');
  const countEl = document.getElementById('player-count');

  if (countEl) countEl.textContent = `${filtered.length} player${filtered.length !== 1 ? 's' : ''}`;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:#8b949e;padding:1rem 0.6rem;">No players match your filters.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    const logo = p.team_logo
      ? `<img src="${p.team_logo}" style="width:16px;height:16px;object-fit:contain;vertical-align:middle;margin-right:0.3rem;border-radius:2px;" />`
      : '';
    const teamCell = p.team_name
      ? `${logo}<a href="team.html?id=${p.team_id}" style="color:#58a6ff;text-decoration:none;">${p.team_name}</a>`
      : '<span class="fa-badge">Free Agent</span>';
    const posBadge = p.position
      ? `<span class="pos-badge">${p.position}</span>`
      : '<span style="color:#484f58;">—</span>';
    const numCell = p.number !== null && p.number !== undefined && p.number !== ''
      ? `<span style="color:#8b949e;">#${p.number}</span>`
      : '<span style="color:#484f58;">—</span>';
    const platformBadge = p.platform
      ? `<span class="platform-badge">${p.platform}</span>`
      : '';
    return `<tr>
      <td>${numCell}</td>
      <td><a href="player.html?name=${encodeURIComponent(p.name)}" class="player-link">${p.name}</a></td>
      <td>${teamCell}</td>
      <td>${posBadge}</td>
      <td>${platformBadge}</td>
    </tr>`;
  }).join('');
}

function sortPlayers(key) {
  if (sortState.key === key) {
    sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
  } else {
    sortState = { key, dir: 'asc' };
  }
  // Update header classes
  document.querySelectorAll('.players-table thead th').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
  });
  const headers = document.querySelectorAll('.players-table thead th');
  const keyMap = { number: 0, name: 1, team_name: 2, position: 3 };
  const idx = keyMap[key];
  if (idx !== undefined && headers[idx]) {
    headers[idx].classList.add(sortState.dir === 'asc' ? 'sort-asc' : 'sort-desc');
  }
  applyFilters();
}

loadPlayers();
