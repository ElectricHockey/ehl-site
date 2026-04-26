// season-selector.js – League type + season selector
// Renders tab buttons for 3's / 6's (with the site logo) and a "Season"
// dropdown that updates to show only seasons for the active league.
// Exposes:
//   SeasonSelector.init(containerId)
//   SeasonSelector.getSelectedSeasonId()        – season id for active league
//   SeasonSelector.getSelectedLeagueType()      – 'threes' | 'sixes'
//   SeasonSelector.getSelectedSeasonIsPlayoff() – true if selected season is a playoff season
//   SeasonSelector.onSeasonChange(callback)

const SeasonSelector = (() => {
  const STORAGE_TYPE   = 'ehl_league_type';
  const STORAGE_SEASON = { threes: 'ehl_season_threes', sixes: 'ehl_season_sixes' };
  let _onChange = null;
  let _seasonsCache = { threes: [], sixes: [] };
  let _noAllTime = false;

  const selectStyle = 'background:#161b22;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:0.3rem 0.6rem;font-size:0.88rem;';

  function getSelectedLeagueType() {
    const active = document.querySelector('.league-tab-btn.active');
    return active ? active.dataset.league : 'threes';
  }

  function getSelectedSeasonId() {
    const el = document.getElementById('season-select');
    if (!el || !el.value || el.value.startsWith('alltime_')) return null;
    return Number(el.value);
  }

  function getSelectedSeasonValue() {
    const el = document.getElementById('season-select');
    return el ? el.value : null;
  }

  function getSelectedSeasonIsPlayoff() {
    const el = document.getElementById('season-select');
    if (!el) return false;
    const opt = el.options[el.selectedIndex];
    return opt ? opt.dataset.isPlayoff === '1' : false;
  }

  function onSeasonChange(cb) { _onChange = cb; }

  // Sort seasons to match admin panel order: each playoff season appears BEFORE
  // (above) its parent regular season.  Matches by parent_season_id first, then
  // falls back to the name-suffix convention used by the bracket creator.
  function _sortWithPlayoffs(seasons) {
    const regular = seasons.filter(s => !s.is_playoff);
    const playoff  = seasons.filter(s =>  s.is_playoff);
    const used = new Set();
    const result = [];
    for (const s of regular) {
      const pl = playoff.find(p =>
        (p.parent_season_id != null && p.parent_season_id === s.id) ||
        p.name === `${s.name} Playoffs`
      );
      if (pl) { result.push(pl); used.add(pl); }  // playoff BEFORE regular (matches admin panel)
      result.push(s);
    }
    // Any unmatched playoff seasons (edge case)
    for (const p of playoff) {
      if (!used.has(p)) result.push(p);
    }
    return result;
  }

  // Seasons come from the API sorted by sort_order ASC, id ASC.
  // Apply _sortWithPlayoffs so each playoff season appears directly after its parent.
  function _populateSeasonSelect(type) {
    const el = document.getElementById('season-select');
    if (!el) return;
    const seasons = _sortWithPlayoffs(_seasonsCache[type] || []);
    const key     = STORAGE_SEASON[type];
    if (seasons.length === 0) {
      el.innerHTML = '<option value="">No seasons</option>';
      el.disabled  = true;
      return;
    }
    el.disabled  = false;
    const saved   = localStorage.getItem(key);
    // Default to the first active regular season, or first season overall
    const regularSeasons    = seasons.filter(s => !s.is_playoff);
    const activeRegularSeason = regularSeasons.find(s => s.is_active);
    let defaultId = saved ? Number(saved) : (activeRegularSeason ? activeRegularSeason.id : seasons[0].id);
    if (!seasons.find(s => s.id === defaultId)) defaultId = activeRegularSeason ? activeRegularSeason.id : seasons[0].id;
    // All-time options always at the top; real seasons follow (skip when noAllTime is set)
    const alltimeOpts = _noAllTime ? '' :
      `<option value="alltime_regular">★ All Time – Regular Season</option>` +
      `<option value="alltime_playoff">★ All Time – Playoffs</option>`;
    el.innerHTML = alltimeOpts + seasons.map(s =>
      `<option value="${s.id}" data-is-playoff="${s.is_playoff ? '1' : '0'}" ${s.id === defaultId ? 'selected' : ''}>${s.name}${s.is_active ? ' ★' : ''}</option>`
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

  async function init(containerId, options) {
    _noAllTime = !!(options && options.noAllTime);
    const container = document.getElementById(containerId || 'season-selector-container');
    if (!container) return;
    try {
      const [r3, r6] = await Promise.all([
        fetch('/api/seasons?type=threes'),
        fetch('/api/seasons?type=sixes'),
      ]);
      _seasonsCache.threes = r3.ok ? await r3.json() : [];
      _seasonsCache.sixes  = r6.ok ? await r6.json() : [];

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
        // Don't persist all-time sentinel values; only persist real season IDs
        if (!e.target.value.startsWith('alltime_')) {
          localStorage.setItem(STORAGE_SEASON[type], e.target.value);
        }
        if (_onChange) _onChange();
      });
    } catch (err) {
      console.warn('[SeasonSelector] init failed:', err);
      container.innerHTML = '<p style="color:#f85149;font-size:0.85rem;padding:0.5rem;">Failed to load seasons. Please refresh the page.</p>';
    }
  }

  return { init, getSelectedSeasonId, getSelectedSeasonValue, getSelectedLeagueType, getSelectedSeasonIsPlayoff, onSeasonChange };
})();
