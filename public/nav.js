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

// Stat-tip click/tap toggle (for mobile and for clicking stat headers)
document.addEventListener('click', e => {
  const tip = e.target.closest('[data-tip]');
  if (tip) {
    const wasOpen = tip.classList.contains('tip-open');
    document.querySelectorAll('[data-tip].tip-open').forEach(el => el.classList.remove('tip-open'));
    if (!wasOpen) tip.classList.add('tip-open');
  } else {
    document.querySelectorAll('[data-tip].tip-open').forEach(el => el.classList.remove('tip-open'));
  }
});
