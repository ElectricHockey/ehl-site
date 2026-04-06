// notifications.js – injected on every page
// Shows a bell icon in the top-right of the nav when the player has pending signing offers.
// Requires nav.js to already have set up the <nav> element.

(function () {
  const API = '/api';
  const TOKEN_KEY = 'ehl_player_token';

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }

  // Inject the bell widget into the nav
  function injectBell() {
    const nav = document.querySelector('nav');
    if (!nav || document.getElementById('notif-bell-wrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'notif-bell-wrap';
    wrap.innerHTML = `
      <button id="notif-bell-btn" aria-label="Notifications" title="Signing offers">
        🔔<span id="notif-badge" style="display:none;"></span>
      </button>
      <div id="notif-dropdown" role="menu" aria-label="Signing offers"></div>`;
    nav.appendChild(wrap);

    document.getElementById('notif-bell-btn').addEventListener('click', e => {
      e.stopPropagation();
      const dd = document.getElementById('notif-dropdown');
      dd.classList.toggle('open');
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#notif-bell-wrap')) {
        const dd = document.getElementById('notif-dropdown');
        if (dd) dd.classList.remove('open');
      }
    });
  }

  async function loadOffers() {
    const token = getToken();
    if (!token) return;
    injectBell();
    try {
      const res = await fetch(`${API}/players/offers`, { headers: { 'X-Player-Token': token } });
      if (!res.ok) return;
      const offers = await res.json();
      renderOffers(offers);
    } catch { /* silent – server may not be running */ }
  }

  function renderOffers(offers) {
    const badge = document.getElementById('notif-badge');
    const dd    = document.getElementById('notif-dropdown');
    if (!badge || !dd) return;

    if (offers.length === 0) {
      badge.style.display = 'none';
      dd.innerHTML = '<p class="notif-empty">No pending offers.</p>';
      return;
    }

    badge.textContent = offers.length;
    badge.style.display = '';
    dd.innerHTML = offers.map(o => `
      <div class="notif-offer" data-id="${o.id}">
        <div class="notif-offer-title">
          ${o.team_logo ? `<img src="${o.team_logo}" class="notif-team-logo" alt="" />` : '🏒'}
          <strong>${o.team_name}</strong>
        </div>
        <div class="notif-offer-meta">
          Offered by <em>${o.offered_by_name}</em>
          ${o.league_type ? `· <span class="notif-lt">${o.league_type === 'threes' ? '3v3' : o.league_type === 'sixes' ? '6v6' : o.league_type}</span>` : ''}
        </div>
        <div class="notif-offer-actions">
          <button class="notif-accept" data-offer="${o.id}">✓ Accept</button>
          <button class="notif-decline" data-offer="${o.id}">✗ Decline</button>
        </div>
      </div>`).join('');

    dd.querySelectorAll('.notif-accept').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const id = btn.dataset.offer;
        const res = await fetch(`${API}/players/offers/${id}/accept`, {
          method: 'POST', headers: { 'X-Player-Token': getToken() },
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Could not accept offer'); return; }
        await loadOffers();
        // Reload the page so team info updates
        window.location.reload();
      });
    });

    dd.querySelectorAll('.notif-decline').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const id = btn.dataset.offer;
        await fetch(`${API}/players/offers/${id}/decline`, {
          method: 'POST', headers: { 'X-Player-Token': getToken() },
        });
        await loadOffers();
      });
    });
  }

  // Poll every 30 s while page is open
  loadOffers();
  setInterval(loadOffers, 30000);
})();
