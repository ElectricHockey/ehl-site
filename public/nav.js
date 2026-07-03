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

// ── League-first navigation (3's / 6's) ─────────────────────────────────────
(function () {
  const STORAGE_TYPE = 'ehl_league_type';
  const VALID_TYPES = ['threes', 'sixes'];

  const queryLeague = new URLSearchParams(window.location.search).get('league');
  if (VALID_TYPES.includes(queryLeague)) {
    localStorage.setItem(STORAGE_TYPE, queryLeague);
  }

  const nav = document.querySelector('nav');
  if (!nav) return;

  const getActiveLeague = () => {
    const saved = localStorage.getItem(STORAGE_TYPE);
    return VALID_TYPES.includes(saved) ? saved : 'threes';
  };

  const keepInTopBar = el =>
    el.classList.contains('brand') ||
    el.id === 'nav-admin-link' ||
    el.classList.contains('nav-portal');

  [...nav.children].forEach(el => {
    if (!keepInTopBar(el)) el.style.display = 'none';
  });

  nav.classList.add('league-nav-mode');

  const switcher = document.createElement('div');
  switcher.className = 'league-nav-switch';
  switcher.innerHTML = `
    <button class="league-nav-btn" data-league="sixes">
      <img src="/api/site-logo?type=sixes" alt="6's" class="league-nav-logo" />
      <span>6's</span>
    </button>
    <button class="league-nav-btn" data-league="threes">
      <img src="/api/site-logo?type=threes" alt="3's" class="league-nav-logo" />
      <span>3's</span>
    </button>
  `;

  const portalLink = nav.querySelector('.nav-portal');
  if (portalLink) nav.insertBefore(switcher, portalLink);
  else nav.appendChild(switcher);

  const currentPath = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const links = [
    { href: 'index.html', label: 'Home' },
    { href: 'schedule.html', label: 'Schedule' },
    { href: 'standings.html', label: 'Standings' },
    { href: 'recent-scores.html', label: 'Recent Scores' },
    { href: 'stats.html', label: 'Stats' },
    { href: 'records.html', label: 'Records' },
    { href: 'players.html', label: 'Players' },
  ];

  const subnav = document.createElement('div');
  subnav.className = 'league-subnav';
  subnav.innerHTML = links.map(l =>
    `<a class="league-subnav-link${currentPath === l.href ? ' active' : ''}" data-base-href="${l.href}" href="${l.href}">${l.label}</a>`
  ).join('');
  nav.insertAdjacentElement('afterend', subnav);

  function renderLeagueNav() {
    const active = getActiveLeague();
    switcher.querySelectorAll('.league-nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.league === active);
    });
    subnav.querySelectorAll('.league-subnav-link').forEach(a => {
      const baseHref = a.dataset.baseHref || 'index.html';
      const u = new URL(baseHref, window.location.origin);
      u.searchParams.set('league', active);
      a.href = `${u.pathname}${u.search}`;
    });
  }

  switcher.querySelectorAll('.league-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.league;
      if (!VALID_TYPES.includes(next)) return;
      if (next !== getActiveLeague()) {
        localStorage.setItem(STORAGE_TYPE, next);
        window.location.reload();
        return;
      }
      renderLeagueNav();
    });
  });

  renderLeagueNav();
}());

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

// ── Instant page navigation ─────────────────────────────────────────────────
// This is a multi-page site: every nav link triggers a full page load, so each
// screen feels slow because the browser only starts fetching the HTML, scripts
// and data *after* the click. To make navigation feel instant we speculatively
// load the destination page as soon as the user shows intent (hover / focus /
// touch), so it is ready the moment they actually click.
//
//   • Modern browsers (Chrome/Edge): use the Speculation Rules API to *prerender*
//     the page in the background – scripts run and data is fetched ahead of time,
//     giving a truly instant transition.
//   • Other browsers (Safari/Firefox): fall back to <link rel="prefetch"> (or a
//     low-priority fetch) to warm the HTTP cache so the next load skips the
//     network round-trips.
(function () {
  // Respect the user's data preferences and avoid wasting bandwidth on slow
  // connections.
  const conn = navigator.connection;
  if (conn) {
    if (conn.saveData) return;
    if (/(^|-)2g$/.test(conn.effectiveType || '')) return;
  }

  const scriptSupportsType = t =>
    typeof HTMLScriptElement !== 'undefined' &&
    HTMLScriptElement.supports &&
    HTMLScriptElement.supports(t);

  // ── Path A: Speculation Rules (prerender) ─────────────────────────────────
  if (scriptSupportsType('speculationrules')) {
    const rules = {
      prerender: [{
        source: 'document',
        // Same-origin navigations only; never speculate API calls or downloads.
        where: {
          and: [
            { href_matches: '/*' },
            { not: { href_matches: '/api/*' } },
            { not: { selector_matches: '[download]' } },
            { not: { selector_matches: '[target="_blank"]' } },
          ],
        },
        // "moderate" speculates on hover / pointer-down, keeping resource use low.
        eagerness: 'moderate',
      }],
    };
    const tag = document.createElement('script');
    tag.type = 'speculationrules';
    tag.textContent = JSON.stringify(rules);
    document.head.appendChild(tag);
    return; // Speculation Rules cover everything below – no fallback needed.
  }

  // ── Path B: prefetch fallback (Safari / Firefox) ──────────────────────────
  const prefetched = new Set();
  const supportsPrefetch = (() => {
    const link = document.createElement('link');
    return !!(link.relList && link.relList.supports && link.relList.supports('prefetch'));
  })();

  function shouldPrefetch(a) {
    if (!a || !a.href) return false;
    let url;
    try { url = new URL(a.href, location.href); } catch { return false; }
    if (url.origin !== location.origin) return false;                       // same-origin only
    if (url.pathname.startsWith('/api/')) return false;                     // never the API
    if (url.pathname === location.pathname && url.search === location.search) return false; // not current page
    if (a.hasAttribute('download')) return false;
    if (a.target && a.target !== '_self') return false;
    // Only prefetch page navigations (html pages or extension-less paths).
    if (/\.[a-z0-9]+$/i.test(url.pathname) && !/\.html?$/i.test(url.pathname)) return false;
    return true;
  }

  function prefetch(url) {
    if (prefetched.has(url)) return;
    prefetched.add(url);
    if (supportsPrefetch) {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'document';
      link.href = url;
      document.head.appendChild(link);
    } else {
      // Safari has no <link rel="prefetch">; warm the cache with a GET instead.
      fetch(url, { credentials: 'same-origin' }).catch(() => {});
    }
  }

  function onIntent(e) {
    const a = e.target.closest && e.target.closest('a');
    if (!shouldPrefetch(a)) return;
    const url = new URL(a.href, location.href).href;
    const run = () => prefetch(url);
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 250 });
    else run();
  }

  const opts = { passive: true, capture: true };
  document.addEventListener('mouseover', onIntent, opts);
  document.addEventListener('focusin', onIntent, opts);
  document.addEventListener('touchstart', onIntent, opts);
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
