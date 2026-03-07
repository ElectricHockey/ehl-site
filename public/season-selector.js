// season-selector.js – Dual league-type season selector
// Renders two side-by-side selectors ("3's Season" and "6's Season") into a container.
// Exposes:
//   SeasonSelector.init(containerId)
//   SeasonSelector.getSelectedSeasonId('threes'|'sixes')
//   SeasonSelector.onSeasonChange(callback)

const SeasonSelector = (() => {
  const STORAGE = { threes: 'ehl_season_threes', sixes: 'ehl_season_sixes' };
  let _onChange = null;

  function getSelectedSeasonId(type) {
    // Accept both the new (type) and old (no-arg) call styles.
    // Old callers that don't pass a type get null so they don't break.
    if (!type) return null;
    const el = document.getElementById(`season-select-${type}`);
    return el && el.value ? Number(el.value) : null;
  }

  function onSeasonChange(cb) { _onChange = cb; }

  function _buildSelect(type, seasons) {
    const label = type === 'threes' ? "3's" : "6's";
    const id    = `season-select-${type}`;
    const key   = STORAGE[type];
    if (!seasons || seasons.length === 0) {
      return `<span style="color:#8b949e;font-size:0.85rem;white-space:nowrap;">${label}: <em>No seasons</em></span>`;
    }
    const saved   = localStorage.getItem(key);
    const active  = seasons.find(s => s.is_active);
    let defaultId = saved ? Number(saved) : (active ? active.id : seasons[0].id);
    if (!seasons.find(s => s.id === defaultId)) defaultId = active ? active.id : seasons[0].id;
    const opts = seasons.map(s =>
      `<option value="${s.id}" ${s.id === defaultId ? 'selected' : ''}>${s.name}${s.is_active ? ' ★' : ''}</option>`
    ).join('');
    return `<div style="display:flex;align-items:center;gap:0.35rem;">
      <label for="${id}" style="color:#8b949e;font-size:0.85rem;white-space:nowrap;">${label}:</label>
      <select id="${id}" style="background:#161b22;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:0.3rem 0.6rem;font-size:0.88rem;">${opts}</select>
    </div>`;
  }

  async function init(containerId) {
    const container = document.getElementById(containerId || 'season-selector-container');
    if (!container) return;
    try {
      const [r3, r6] = await Promise.all([
        fetch('/api/seasons?type=threes'),
        fetch('/api/seasons?type=sixes'),
      ]);
      const [s3, s6] = await Promise.all([r3.json(), r6.json()]);
      container.innerHTML = `<div style="display:flex;align-items:center;gap:1.1rem;flex-wrap:wrap;">
        ${_buildSelect('threes', s3)}
        ${_buildSelect('sixes', s6)}
      </div>`;
      ['threes', 'sixes'].forEach(type => {
        const el = document.getElementById(`season-select-${type}`);
        if (!el) return;
        el.addEventListener('change', e => {
          localStorage.setItem(STORAGE[type], e.target.value);
          if (_onChange) _onChange();
        });
      });
    } catch { container.innerHTML = ''; }
  }

  return { init, getSelectedSeasonId, onSeasonChange };
})();
