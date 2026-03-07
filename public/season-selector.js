// season-selector.js – League type + season selector
// Renders a "League" dropdown (3's / 6's) and a "Season" dropdown that
// updates to show only seasons for the active league type.
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
    const el = document.getElementById('league-type-select');
    return el ? el.value : null;
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

      container.innerHTML = `<div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
        <label for="league-type-select" style="color:#8b949e;font-size:0.85rem;white-space:nowrap;">League:</label>
        <select id="league-type-select" style="${selectStyle}">
          <option value="threes" ${savedType === 'threes' ? 'selected' : ''}>3's</option>
          <option value="sixes"  ${savedType === 'sixes'  ? 'selected' : ''}>6's</option>
        </select>
        <label for="season-select" style="color:#8b949e;font-size:0.85rem;white-space:nowrap;">Season:</label>
        <select id="season-select" style="${selectStyle}"></select>
      </div>`;

      _populateSeasonSelect(savedType);

      document.getElementById('league-type-select').addEventListener('change', e => {
        const type = e.target.value;
        localStorage.setItem(STORAGE_TYPE, type);
        _populateSeasonSelect(type);
        if (_onChange) _onChange();
      });

      document.getElementById('season-select').addEventListener('change', e => {
        const type = document.getElementById('league-type-select').value;
        localStorage.setItem(STORAGE_SEASON[type], e.target.value);
        if (_onChange) _onChange();
      });
    } catch { container.innerHTML = ''; }
  }

  return { init, getSelectedSeasonId, getSelectedLeagueType, onSeasonChange };
})();
