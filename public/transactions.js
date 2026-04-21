const API = '/api';
const TRANSACTIONS_DISPLAY_LIMIT = 50;

async function loadTransactions() {
  const root = document.getElementById('transactions-root');
  try {
    const res = await fetch(`${API}/transactions?limit=${TRANSACTIONS_DISPLAY_LIMIT}`);
    if (!res.ok) { root.innerHTML = '<p class="error">Failed to load transactions.</p>'; return; }
    const rows = await res.json();
    if (!rows.length) {
      root.innerHTML = '<p style="color:#8b949e;">No transactions recorded yet.</p>';
      return;
    }

    root.innerHTML = `<div style="display:flex;flex-direction:column;gap:0.5rem;">
      ${rows.map(tx => {
        const logo = tx.team_logo
          ? `<img src="${tx.team_logo}" style="width:24px;height:24px;object-fit:contain;vertical-align:middle;border-radius:4px;background:#21262d;padding:2px;margin-right:0.5rem;" />`
          : '';
        const date = tx.created_at ? new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        const isSigning = tx.type === 'signing';
        const icon = isSigning ? '✍️' : '🔄';
        const verb = isSigning ? 'signed with' : 'released from';
        return `<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:0.65rem 1rem;display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
          <span style="font-size:1.1rem;">${icon}</span>
          <span style="flex:1;min-width:0;">
            <a href="player.html?name=${encodeURIComponent(tx.player_name)}" style="color:#e6edf3;font-weight:600;text-decoration:none;">${tx.player_name}</a>
            <span style="color:#8b949e;"> ${verb} </span>
            <a href="team.html?id=${tx.team_id}" style="color:#3fb950;text-decoration:none;font-weight:600;">${logo}${tx.team_name}</a>
          </span>
          <span style="color:#484f58;font-size:0.82rem;white-space:nowrap;">${date}</span>
        </div>`;
      }).join('')}
    </div>`;
  } catch {
    root.innerHTML = '<p class="error">Could not load transactions. Is the server running?</p>';
  }
}

loadTransactions();
