const API = '/api';

function resultBadge(result) {
  if (result === 'W') return '<span class="badge badge-win">W</span>';
  if (result === 'L') return '<span class="badge badge-loss">L</span>';
  return '<span class="badge badge-tie">T</span>';
}

async function loadEAMatches(club) {
  const container = document.getElementById('ea-results');
  container.innerHTML = '<p class="loading">Loading…</p>';
  try {
    const url = club ? `${API}/ea-matches?club=${encodeURIComponent(club)}` : `${API}/ea-matches`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Server error');
    const matches = await res.json();

    if (matches.length === 0) {
      container.innerHTML = '<p style="color:#8b949e;margin-top:1rem;">No EA matches found for this club.</p>';
      return;
    }

    container.innerHTML = `
      <h2 style="margin-top:1.5rem;">Results for: ${club || 'All Clubs'}</h2>
      <table>
        <thead>
          <tr><th>ID</th><th>Date</th><th>Club</th><th>Opponent</th><th>Result</th><th>Score</th><th>Assigned</th></tr>
        </thead>
        <tbody>
          ${matches.map(m => `
            <tr>
              <td>${m.id}</td>
              <td>${m.date}</td>
              <td>${m.club}</td>
              <td>${m.opponent}</td>
              <td>${resultBadge(m.result)}</td>
              <td>${m.score}</td>
              <td>${m.assigned ? '✅' : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    container.innerHTML = '<p class="error">Failed to load EA matches. Is the server running?</p>';
  }
}

document.getElementById('ea-search-form').addEventListener('submit', e => {
  e.preventDefault();
  const club = document.getElementById('ea-club').value.trim();
  loadEAMatches(club);
});
