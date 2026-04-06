// nav.js – toggle .open on nav dropdowns for keyboard/touch users
document.querySelectorAll('.nav-dropdown > a').forEach(trigger => {
  trigger.addEventListener('click', e => {
    const wrap = trigger.parentElement;
    // If the link's href is meaningful and menu is already open, follow the link
    if (wrap.classList.contains('open')) return; // let the default navigation happen
    // Otherwise toggle the menu open and prevent navigation
    e.preventDefault();
    document.querySelectorAll('.nav-dropdown').forEach(d => { if (d !== wrap) d.classList.remove('open'); });
    wrap.classList.toggle('open');
  });
});

document.addEventListener('click', e => {
  if (!e.target.closest('.nav-dropdown')) {
    document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
  }
});

// ── Admin nav link visibility ──────────────────────────────────────────────
// The Admin link is hidden by default. Show it only when the visitor has an
// active admin session (owner Discord ID 363915181765427200 or promoted admin).
(function () {
  const link = document.getElementById('nav-admin-link');
  if (!link) return;

  function showAdminLink() { link.style.display = ''; }
  function hideAdminLink() { link.style.display = 'none'; }

  async function refreshAdminAccess() {
    // 1. Validate any cached admin token
    const adminToken = localStorage.getItem('ehl_admin_token');
    if (adminToken) {
      try {
        const res = await fetch('/api/auth/status', { headers: { 'X-Admin-Token': adminToken } });
        const data = await res.json();
        if (data.loggedIn) { showAdminLink(); return; }
      } catch (e) {
        // Network error – fall through to player-token refresh
        console.debug('[nav] admin token validation failed:', e);
      }
      // Token is stale – clear it
      localStorage.removeItem('ehl_admin_token');
      localStorage.removeItem('ehl_admin_role');
      localStorage.removeItem('ehl_admin_username');
    }

    // 2. Try to obtain a fresh admin token from the player session
    const playerToken = localStorage.getItem('ehl_player_token');
    if (playerToken) {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'X-Player-Token': playerToken },
        });
        if (res.ok) {
          const data = await res.json();
          localStorage.setItem('ehl_admin_token', data.token);
          localStorage.setItem('ehl_admin_role', data.role);
          localStorage.setItem('ehl_admin_username', data.username);
          showAdminLink();
          return;
        }
      } catch (e) {
        // Network error – not an admin, hide the link
        console.debug('[nav] admin login via player token failed:', e);
      }
    }

    hideAdminLink();
  }

  // Show immediately from the cached token for a flicker-free experience, then
  // validate async. Both checks use the same key so behaviour is consistent.
  if (localStorage.getItem('ehl_admin_token')) {
    showAdminLink();
  }
  refreshAdminAccess();
}());

// ── JS-driven stat-column tooltips ──────────────────────────────────────────
// Uses position:fixed so tooltips are NEVER clipped by overflow:auto containers.

(function () {
  // Create a single shared tooltip element once
  let tooltip = document.getElementById('gs-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'gs-tooltip';
    document.body.appendChild(tooltip);
  }

  function showTooltip(target) {
    const text = target.getAttribute('data-tip');
    if (!text) return;
    tooltip.textContent = text;
    tooltip.style.display = 'block';
    positionTooltip(target);
  }

  function hideTooltip() {
    tooltip.style.display = 'none';
  }

  function positionTooltip(target) {
    const r = target.getBoundingClientRect();
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    // Centre above the target; clamp to viewport edges
    let left = r.left + r.width / 2 - tw / 2;
    let top  = r.top - th - 6;
    // Clamp horizontally
    if (left < 6) left = 6;
    if (left + tw > window.innerWidth - 6) left = window.innerWidth - tw - 6;
    // If above viewport, flip below
    if (top < 6) top = r.bottom + 6;
    tooltip.style.left = left + 'px';
    tooltip.style.top  = top  + 'px';
  }

  // Hover on desktop
  document.addEventListener('mouseover', e => {
    const tip = e.target.closest('[data-tip]');
    if (tip) showTooltip(tip);
  });
  document.addEventListener('mouseout', e => {
    const tip = e.target.closest('[data-tip]');
    if (tip) hideTooltip();
  });

  // Click/tap for mobile
  document.addEventListener('click', e => {
    const tip = e.target.closest('[data-tip]');
    if (tip) {
      if (tooltip.style.display === 'block' && tooltip.textContent === tip.getAttribute('data-tip')) {
        hideTooltip();
      } else {
        showTooltip(tip);
      }
    } else {
      hideTooltip();
    }
  });
}());

