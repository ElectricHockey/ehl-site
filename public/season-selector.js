// season-selector.js – League type + season selector
// Renders tab buttons for 3's / 6's (with the site logo) and a "Season"
// dropdown that updates to show only seasons for the active league.
// Exposes:
//   SeasonSelector.init(containerId)
//   SeasonSelector.getSelectedSeasonId()   – season id for active league
//   SeasonSelector.getSelectedLeagueType() – 'threes' | 'sixes'
//   SeasonSelector.onSeasonChange(callback)

const SeasonSelector = (() => {
  const STORAGE_TYPE   = 'ehl_league_type';
  const STORAGE_SEASON = { threes: 'ehl_season_threes', sixes: 'ehl_season_sixes' };
  let _onChange = null;
  let _seasonsCache = { threes: [], sixes: [] };

  const selectStyle = 'background:#161b22;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:0.3rem 0.6rem;font-size:0.88rem;';

  function getSelectedLeagueType() {
    const active = document.querySelector('.league-tab-btn.active');
    return active ? active.dataset.league : 'threes';
  }

  function getSelectedSeasonId() {
    const el = document.getElementById('season-select');
    return el && el.value ? Number(el.value) : null;
  }

  function onSeasonChange(cb) { _onChange = cb; }

  function _populateSeasonSelect(type) {
    const el = document.getElementById('season-select');
    if (!el) return;
    const seasons = _seasonsCache[type] || [];
    const key     = STORAGE_SEASON[type];
    if (seasons.length === 0) {
      el.innerHTML = '<option value="">No seasons</option>';
      el.disabled  = true;
      return;
    }
    el.disabled  = false;
    const saved   = localStorage.getItem(key);
    const active  = seasons.find(s => s.is_active);
    let defaultId = saved ? Number(saved) : (active ? active.id : seasons[0].id);
    if (!seasons.find(s => s.id === defaultId)) defaultId = active ? active.id : seasons[0].id;
    el.innerHTML = seasons.map(s =>
      `<option value="${s.id}" ${s.id === defaultId ? 'selected' : ''}>${s.name}${s.is_active ? ' ★' : ''}</option>`
    ).join('');
  }

  function _switchLeague(type) {
    localStorage.setItem(STORAGE_TYPE, type);
    // Update tab active states
    document.querySelectorAll('.league-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.league === type);
    });
    _populateSeasonSelect(type);
    if (_onChange) _onChange();
  }

  async function init(containerId) {
    const container = document.getElementById(containerId || 'season-selector-container');
    if (!container) return;
    try {
      const [r3, r6] = await Promise.all([
        fetch('/api/seasons?type=threes'),
        fetch('/api/seasons?type=sixes'),
      ]);
      _seasonsCache.threes = await r3.json();
      _seasonsCache.sixes  = await r6.json();

      const savedType = localStorage.getItem(STORAGE_TYPE) || 'threes';

      container.innerHTML = `
        <div class="league-tabs-row">
          <button class="league-tab-btn${savedType === 'threes' ? ' active' : ''}" data-league="threes">
            <img src="/api/site-logo?type=threes" alt="EHL" class="league-tab-logo" />
            <span>3's</span>
          </button>
          <button class="league-tab-btn${savedType === 'sixes' ? ' active' : ''}" data-league="sixes">
            <img src="/api/site-logo?type=sixes" alt="EHL" class="league-tab-logo" />
            <span>6's</span>
          </button>
          <div class="league-tab-season">
            <label for="season-select" style="color:#8b949e;font-size:0.85rem;white-space:nowrap;">Season:</label>
            <select id="season-select" style="${selectStyle}"></select>
          </div>
        </div>`;

      _populateSeasonSelect(savedType);

      container.querySelectorAll('.league-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => _switchLeague(btn.dataset.league));
      });

      document.getElementById('season-select').addEventListener('change', e => {
        const type = getSelectedLeagueType();
        localStorage.setItem(STORAGE_SEASON[type], e.target.value);
        if (_onChange) _onChange();
      });
    } catch { container.innerHTML = ''; }
  }

  return { init, getSelectedSeasonId, getSelectedLeagueType, onSeasonChange };
})();
