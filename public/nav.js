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

