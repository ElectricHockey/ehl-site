const API = '/api';

let skatersData = [];
let goaliesData = [];
let skaterSort = { key: 'points', dir: 'desc' };
let goalieSort  = { key: 'save_pct', dir: 'desc' };

function formatToi(seconds) {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function switchTab(tab) {
  document.querySelectorAll('.tab-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.querySelector(`.tab-btn[onclick="switchTab('${tab}')"]`).classList.add('active');
}

// ── Sort helpers ──────────────────────────────────────────────────────────

function sortData(data, key, dir) {
  return [...data].sort((a, b) => {
    const av = a[key] ?? -Infinity;
    const bv = b[key] ?? -Infinity;
    return dir === 'asc' ? av - bv : bv - av;
  });
}

function thClass(key, currentSort) {
  if (currentSort.key !== key) return 'sortable-th';
  return `sortable-th ${currentSort.dir === 'asc' ? 'sort-asc' : 'sort-desc'}`;
}

// ── Skaters ───────────────────────────────────────────────────────────────

function renderSkaters() {
  const root = document.getElementById('skaters-root');
  if (skatersData.length === 0) {
    root.innerHTML = '<p style="color:#8b949e">No skater stats yet. Complete games will appear here.</p>';
    return;
  }

  const sorted = sortData(skatersData, skaterSort.key, skaterSort.dir);
  const s = key => thClass(key, skaterSort);

  root.innerHTML = `
    <table id="skaters-table">
      <thead><tr>
        <th>Player</th>
        <th>Team</th>
        <th>Pos</th>
        <th class="${s('gp')}"   onclick="sortSkaters('gp')">GP</th>
        <th class="${s('goals')}" onclick="sortSkaters('goals')">G</th>
        <th class="${s('assists')}" onclick="sortSkaters('assists')">A</th>
        <th class="${s('points')}" onclick="sortSkaters('points')">PTS</th>
        <th class="${s('plus_minus')}" onclick="sortSkaters('plus_minus')">+/-</th>
        <th class="${s('shots')}" onclick="sortSkaters('shots')">SOG</th>
        <th class="${s('hits')}" onclick="sortSkaters('hits')">HIT</th>
        <th class="${s('blocked_shots')}" onclick="sortSkaters('blocked_shots')">BS</th>
        <th class="${s('takeaways')}" onclick="sortSkaters('takeaways')">TKW</th>
        <th class="${s('giveaways')}" onclick="sortSkaters('giveaways')">GVW</th>
        <th class="${s('pp_goals')}" onclick="sortSkaters('pp_goals')">PPG</th>
        <th class="${s('sh_goals')}" onclick="sortSkaters('sh_goals')">SHG</th>
        <th class="${s('pim')}" onclick="sortSkaters('pim')">PIM</th>
        <th class="${s('toi')}" onclick="sortSkaters('toi')">TOI</th>
      </tr></thead>
      <tbody>
        ${sorted.map(p => `<tr>
          <td>${p.name}</td>
          <td>${p.team_name}</td>
          <td>${p.position || '–'}</td>
          <td>${p.gp}</td>
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
          <td>${p.pim}</td>
          <td>${formatToi(p.toi)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function sortSkaters(key) {
  if (skaterSort.key === key) {
    skaterSort.dir = skaterSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    skaterSort = { key, dir: 'desc' };
  }
  renderSkaters();
}

// ── Goalies ───────────────────────────────────────────────────────────────

function renderGoalies() {
  const root = document.getElementById('goalies-root');
  if (goaliesData.length === 0) {
    root.innerHTML = '<p style="color:#8b949e">No goalie stats yet. Complete games will appear here.</p>';
    return;
  }

  const sorted = sortData(goaliesData, goalieSort.key, goalieSort.dir);
  const s = key => thClass(key, goalieSort);

  root.innerHTML = `
    <table id="goalies-table">
      <thead><tr>
        <th>Player</th>
        <th>Team</th>
        <th class="${s('gp')}" onclick="sortGoalies('gp')">GP</th>
        <th class="${s('saves')}" onclick="sortGoalies('saves')">SV</th>
        <th class="${s('goals_against')}" onclick="sortGoalies('goals_against')">GA</th>
        <th class="${s('shots_against')}" onclick="sortGoalies('shots_against')">SA</th>
        <th class="${s('save_pct')}" onclick="sortGoalies('save_pct')">SV%</th>
      </tr></thead>
      <tbody>
        ${sorted.map(p => {
          const svp = p.save_pct !== null && p.save_pct !== undefined
            ? (p.save_pct < 1 ? (p.save_pct * 100).toFixed(1) : p.save_pct.toFixed(1)) + '%'
            : '–';
          return `<tr>
            <td>${p.name}</td>
            <td>${p.team_name}</td>
            <td>${p.gp}</td>
            <td>${p.saves}</td>
            <td>${p.goals_against}</td>
            <td>${p.shots_against}</td>
            <td><strong>${svp}</strong></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function sortGoalies(key) {
  if (goalieSort.key === key) {
    goalieSort.dir = goalieSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    goalieSort = { key, dir: 'desc' };
  }
  renderGoalies();
}

// ── Init ───────────────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const res = await fetch(`${API}/stats/leaders`);
    if (!res.ok) throw new Error('Server error');
    const data = await res.json();
    skatersData = data.skaters || [];
    goaliesData = data.goalies || [];
    renderSkaters();
    renderGoalies();
  } catch (err) {
    document.getElementById('skaters-root').innerHTML = `<p class="error">Failed to load stats: ${err.message}</p>`;
    document.getElementById('goalies-root').innerHTML = '';
  }
}

loadStats();
