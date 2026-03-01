// Shared season selector – included by schedule, standings, stats, team pages
// Renders a <select> into the element with id="season-selector-container"
// Exposes: getSelectedSeasonId(), onSeasonChange(callback)

const SeasonSelector = (() => {
  const STORAGE_KEY = 'ehl_selected_season';
  let _onChange = null;

  function getSelectedSeasonId() {
    const el = document.getElementById('season-select');
    if (!el) return null;
    return el.value ? Number(el.value) : null;
  }

  function onSeasonChange(cb) { _onChange = cb; }

  async function init(containerId) {
    const container = document.getElementById(containerId || 'season-selector-container');
    if (!container) return;
    try {
      const res = await fetch('/api/seasons');
      const seasons = await res.json();
      if (seasons.length === 0) {
        container.innerHTML = '<span style="color:#8b949e;font-size:0.85rem;">No seasons created yet</span>';
        return;
      }

      // Determine default: saved in localStorage, else active season, else first
      const saved = localStorage.getItem(STORAGE_KEY);
      const active = seasons.find(s => s.is_active);
      let defaultId = saved ? Number(saved) : (active ? active.id : seasons[0].id);
      // Make sure the saved id still exists
      if (!seasons.find(s => s.id === defaultId)) defaultId = active ? active.id : seasons[0].id;

      const opts = seasons.map(s =>
        `<option value="${s.id}" ${s.id === defaultId ? 'selected' : ''}>${s.name}${s.is_active ? ' ★' : ''}</option>`
      ).join('');

      container.innerHTML = `
        <label for="season-select" style="color:#8b949e;font-size:0.85rem;margin-right:0.4rem;">Season:</label>
        <select id="season-select" style="background:#161b22;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:0.3rem 0.6rem;font-size:0.88rem;">
          ${opts}
        </select>`;

      document.getElementById('season-select').addEventListener('change', e => {
        localStorage.setItem(STORAGE_KEY, e.target.value);
        if (_onChange) _onChange(e.target.value ? Number(e.target.value) : null);
      });
    } catch {
      container.innerHTML = '';
    }
  }

  return { init, getSelectedSeasonId, onSeasonChange };
})();
