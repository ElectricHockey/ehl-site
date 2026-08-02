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
  const MOBILE_BREAKPOINT = 900;

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
    el.id === 'notif-bell-wrap' ||
    el.classList.contains('nav-portal');

  [...nav.children].forEach(el => {
    if (!keepInTopBar(el)) el.style.display = 'none';
  });

  nav.classList.add('league-nav-mode');

  const switcher = document.createElement('div');
  switcher.className = 'league-nav-dropdown';
  switcher.innerHTML = `
    <button class="league-nav-trigger" type="button" aria-haspopup="true" aria-expanded="false">
      <img class="league-nav-logo" src="/api/site-logo?type=threes" alt="" width="20" height="20" decoding="async" />
      <span class="league-nav-label">3's</span>
      <span class="league-nav-chevron">▾</span>
    </button>
    <div class="league-nav-menu">
      <button class="league-nav-menu-item" data-league="sixes" type="button">
        <img src="/api/site-logo?type=sixes" alt="" width="18" height="18" decoding="async" />
        <span>6's</span>
      </button>
      <button class="league-nav-menu-item" data-league="threes" type="button">
        <img src="/api/site-logo?type=threes" alt="" width="18" height="18" decoding="async" />
        <span>3's</span>
      </button>
    </div>
  `;

  // Insert right after the brand logo
  const portalLink = nav.querySelector('.nav-portal');
  const brand = nav.querySelector('.brand');
  if (brand && brand.nextSibling) nav.insertBefore(switcher, brand.nextSibling);
  else if (portalLink) nav.insertBefore(switcher, portalLink);
  else nav.appendChild(switcher);

  // Nav carousel – center strip between league dropdown and portal
  const navCarousel = document.createElement('div');
  navCarousel.className = 'nav-carousel-wrap';
  navCarousel.innerHTML = `
    <button class="nav-carousel-arrow nav-carousel-prev" aria-label="Previous">&#8249;</button>
    <div class="nav-carousel-track" id="nav-carousel-track"></div>
    <button class="nav-carousel-arrow nav-carousel-next" aria-label="Next">&#8250;</button>
  `;
  if (portalLink) nav.insertBefore(navCarousel, portalLink);
  else nav.appendChild(navCarousel);

  // Load games into nav carousel
  (async () => {
    try {
      const league = (() => {
        const qp = new URLSearchParams(window.location.search).get('league');
        if (qp === 'threes' || qp === 'sixes') return qp;
        const s = localStorage.getItem('ehl_league_type');
        return (s === 'threes' || s === 'sixes') ? s : 'threes';
      })();
      const sRes = await fetch(`/api/seasons?type=${league}`);
      if (!sRes.ok) return;
      const seasons = await sRes.json();
      const active = seasons.find(s => s.is_active) || seasons[0];
      if (!active) return;

      const [rRes, uRes] = await Promise.all([
        fetch(`/api/games?status=complete&season_id=${active.id}&limit=8&order=desc`),
        fetch(`/api/games?status=scheduled&season_id=${active.id}&limit=5&order=asc`),
      ]);
      const completed = rRes.ok ? await rRes.json() : [];
      const scheduled = uRes.ok ? await uRes.json() : [];
      const all = [...completed, ...scheduled];
      if (!all.length) { navCarousel.style.display = 'none'; return; }

      const track = navCarousel.querySelector('.nav-carousel-track');
      track.innerHTML = all.map(g => {
        const isFinal = g.status === 'complete';
        const hl = g.home_logo ? `<img src="${g.home_logo}" class="nc-logo" alt="" decoding="async" />` : '<span class="nc-logo-ph"></span>';
        const al = g.away_logo ? `<img src="${g.away_logo}" class="nc-logo" alt="" decoding="async" />` : '<span class="nc-logo-ph"></span>';
        const ot = g.is_overtime ? '<sup class="nc-ot">OT</sup>' : '';
        return `<a href="game.html?id=${g.id}" class="nc-card${isFinal ? '' : ' nc-card-upcoming'}">
          <span class="nc-badge">${isFinal ? 'FINAL' : 'UPCOMING'}</span>
          <div class="nc-row">
            ${hl}<span class="nc-name">${g.home_team_name}</span>
            <span class="nc-score">${isFinal ? `${g.home_score}${ot} – ${g.away_score}` : 'vs'}</span>
            <span class="nc-name nc-name-r">${g.away_team_name}</span>${al}
          </div>
        </a>`;
      }).join('');

      // Arrow nav
      let ci = 0;
      const cards = () => track.querySelectorAll('.nc-card');
      const scrollTo = i => {
        const c = cards();
        ci = ((i % c.length) + c.length) % c.length;
        c[ci].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      };
      navCarousel.querySelector('.nav-carousel-prev').onclick = () => scrollTo(ci - 1);
      navCarousel.querySelector('.nav-carousel-next').onclick = () => scrollTo(ci + 1);
      setInterval(() => scrollTo(ci + 1), 4500);
    } catch { navCarousel.style.display = 'none'; }
  })();
  const currentPath = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const links = [
    { href: 'index.html', label: 'Home' },
    {
      href: 'schedule.html', label: 'Schedule',
      children: [
        { href: 'recent-scores.html', label: '🏒 Recent Scores' },
      ],
    },
    {
      href: 'standings.html', label: 'Standings',
      children: [
        { href: 'standings.html', label: '🏒 Standings' },
        { href: 'playoffs.html', label: '🏆 Playoffs' },
      ],
    },
    { href: 'stats.html', label: 'Stats' },
    {
      href: 'awards.html', label: 'Awards',
      children: [
        { href: 'awards.html', label: '🏆 Awards' },
        { href: 'records.html', label: '📚 Records' },
      ],
    },
    { href: 'players.html', label: 'Players' },
  ];

  function buildSubnavItem(l) {
    const isActive = currentPath === l.href || (l.children && l.children.some(c => c.href === currentPath));
    if (l.children && l.children.length) {
      const childLinks = l.children.map(c =>
        `<a class="league-subnav-link league-subnav-child-link${currentPath === c.href ? ' active' : ''}" data-base-href="${c.href}" href="${c.href}">${c.label}</a>`
      ).join('');
      return `<div class="league-subnav-dropdown">` +
        `<a class="league-subnav-link${isActive ? ' active' : ''}" data-base-href="${l.href}" href="${l.href}">${l.label} ▾</a>` +
        `<div class="league-subnav-dropdown-menu">${childLinks}</div>` +
        `</div>`;
    }
    return `<a class="league-subnav-link${isActive ? ' active' : ''}" data-base-href="${l.href}" href="${l.href}">${l.label}</a>`;
  }

  const subnav = document.createElement('div');
  subnav.className = 'league-subnav';
  subnav.innerHTML = links.map(buildSubnavItem).join('');
  nav.insertAdjacentElement('afterend', subnav);

  const mobileBackdrop = document.createElement('div');
  mobileBackdrop.className = 'nav-mobile-backdrop';
  document.body.appendChild(mobileBackdrop);

  const mobileToggle = document.createElement('button');
  mobileToggle.className = 'nav-mobile-toggle';
  mobileToggle.type = 'button';
  mobileToggle.setAttribute('aria-label', 'Toggle navigation menu');
  mobileToggle.setAttribute('aria-expanded', 'false');
  mobileToggle.innerHTML = '☰';
  nav.insertBefore(mobileToggle, portalLink || switcher);
  function setMobileMenuOpen(open) {
    document.body.classList.toggle('nav-mobile-open', open);
    mobileToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    mobileToggle.innerHTML = open ? '✕' : '☰';
  }

  function closeMobileMenu() {
    setMobileMenuOpen(false);
  }

  function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function renderLeagueNav() {
    const active = getActiveLeague();
    // Update trigger button to show active league
    const trigger = switcher.querySelector('.league-nav-trigger');
    const triggerImg = switcher.querySelector('.league-nav-trigger .league-nav-logo');
    const triggerLabel = switcher.querySelector('.league-nav-label');
    if (triggerImg) triggerImg.src = `/api/site-logo?type=${active}`;
    if (triggerImg) triggerImg.alt = active === 'threes' ? "3's" : "6's";
    if (triggerLabel) triggerLabel.textContent = active === 'threes' ? "3's" : "6's";
    // Mark active item in menu
    switcher.querySelectorAll('.league-nav-menu-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.league === active);
    });
    subnav.querySelectorAll('.league-subnav-link, .league-subnav-child-link').forEach(a => {
      const baseHref = a.dataset.baseHref || 'index.html';
      const u = new URL(baseHref, window.location.origin);
      u.searchParams.set('league', active);
      a.href = `${u.pathname}${u.search}`;
    });
  }

  // Toggle dropdown on trigger click
  const trigger = switcher.querySelector('.league-nav-trigger');
  trigger.addEventListener('click', e => {
    e.stopPropagation();
    const open = switcher.classList.toggle('open');
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.league-nav-dropdown')) {
      switcher.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });

  switcher.querySelectorAll('.league-nav-menu-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.league;
      switcher.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      if (!VALID_TYPES.includes(next)) return;
      if (next !== getActiveLeague()) {
        localStorage.setItem(STORAGE_TYPE, next);
        const u = new URL(window.location.href);
        u.searchParams.set('league', next);
        window.location.href = u.href;
        return;
      }
      renderLeagueNav();
    });
  });

  mobileToggle.addEventListener('click', () => {
    if (!isMobile()) return;
    setMobileMenuOpen(!document.body.classList.contains('nav-mobile-open'));
  });

  mobileBackdrop.addEventListener('click', closeMobileMenu);

  subnav.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', closeMobileMenu);
  });

  nav.addEventListener('click', e => {
    if (!isMobile()) return;
    const targetLink = e.target.closest('a');
    if (targetLink && (targetLink.classList.contains('nav-portal') || targetLink.id === 'nav-admin-link')) {
      closeMobileMenu();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMobileMenu();
  });

  window.addEventListener('resize', () => {
    if (!isMobile()) closeMobileMenu();
  });

  renderLeagueNav();
}());

// ── Admin nav link visibility ──────────────────────────────────────────────
// The Admin link is hidden by default. Show it only when the visitor has an
// active admin session (owner Discord ID 363915181765427200 or promoted admin).
(function () {
  const link = document.getElementById('nav-admin-link');
  if (!link) return;
  const validationKey = 'ehl_admin_validated_at';

  function showAdminLink() { link.style.display = ''; }
  function hideAdminLink() { link.style.display = 'none'; }

  async function refreshAdminAccess() {
    // 1. Validate any cached admin token
    const adminToken = localStorage.getItem('ehl_admin_token');
    if (adminToken) {
      const validatedAt = Number(sessionStorage.getItem(validationKey)) || 0;
      if (Date.now() - validatedAt < 60 * 1000) {
        showAdminLink();
        return;
      }
      try {
        const res = await fetch('/api/auth/status', { headers: { 'X-Admin-Token': adminToken } });
        const data = await res.json();
        if (data.loggedIn) {
          sessionStorage.setItem(validationKey, String(Date.now()));
          showAdminLink();
          return;
        }
      } catch (e) {
        // Network error – fall through to player-token refresh
        console.debug('[nav] admin token validation failed:', e);
      }
      // Token is stale – clear it
      localStorage.removeItem('ehl_admin_token');
      localStorage.removeItem('ehl_admin_role');
      localStorage.removeItem('ehl_admin_username');
      sessionStorage.removeItem(validationKey);
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
          sessionStorage.setItem(validationKey, String(Date.now()));
          showAdminLink();
          return;
        }
      } catch (e) {
        // Network error – not an admin, hide the link
        console.debug('[nav] admin login via player token failed:', e);
      }
    }

    // 3. Local dev auto-login: server returns a token for localhost with no credentials
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      if (data.loggedIn && data.token) {
        localStorage.setItem('ehl_admin_token', data.token);
        localStorage.setItem('ehl_admin_role', data.role);
        localStorage.setItem('ehl_admin_username', data.username);
        sessionStorage.setItem(validationKey, String(Date.now()));
        showAdminLink();
        return;
      }
    } catch (e) {
      console.debug('[nav] local dev auto-login failed:', e);
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

// ── Shared page shell and media defaults ────────────────────────────────────
(function () {
  function optimiseImage(img) {
    if (!(img instanceof HTMLImageElement)) return;
    if (!img.hasAttribute('decoding')) img.decoding = 'async';
    const isAboveFold = !!img.closest('nav, .hero, .page-header, .team-banner, .phl-hero');
    if (!isAboveFold && !img.hasAttribute('loading')) img.loading = 'lazy';
  }

  document.querySelectorAll('img').forEach(optimiseImage);
  const imageObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('img')) optimiseImage(node);
        node.querySelectorAll('img').forEach(optimiseImage);
      }
    }
  });
  imageObserver.observe(document.body, { childList: true, subtree: true });

  function appendFooter() {
    if (document.querySelector('.site-footer')) return;
    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML = `<div class="site-footer-content">&copy; ${new Date().getFullYear()} Electric Hockey League. All rights reserved.</div>`;
    document.body.appendChild(footer);
  }

  if (document.readyState === 'complete') appendFooter();
  else document.addEventListener('DOMContentLoaded', appendFooter, { once: true });
}());
