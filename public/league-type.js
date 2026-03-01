// league-type.js – reads ?type= URL param, updates the page title, and injects
// leagueType into SeasonSelector so only seasons of that type are shown.
// Must be loaded AFTER season-selector.js but BEFORE the page-specific script.
(function () {
  const type = new URLSearchParams(location.search).get('type') || '';
  if (!type) return;

  const labels = { threes: "3's", sixes: "6's" };
  const prefix = labels[type];
  if (prefix) {
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = prefix + ' ' + titleEl.textContent;
  }

  if (typeof SeasonSelector !== 'undefined') {
    const orig = SeasonSelector.init.bind(SeasonSelector);
    SeasonSelector.init = (cid, opts) =>
      orig(cid, Object.assign({}, opts, { leagueType: type }));
  }
})();
