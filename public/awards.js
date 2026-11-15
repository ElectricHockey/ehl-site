const API = '/api';

let _awardDefs = [];
let _awardModalData = {};

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function playerLink(name) {
  const safe = esc(name || 'Unknown Player');
  return `<a class="award-player" href="player.html?name=${encodeURIComponent(name || '')}">${safe}</a>`;
}

function teamLink(teamId, teamName) {
  const safe = esc(teamName || 'Unknown Team');
  if (!teamId) return safe;
  return `<a class="award-player" href="team.html?id=${encodeURIComponent(teamId)}">${safe}</a>`;
}

function renderAwards(defs, winners, teamAwards, seasonName) {
  const root = document.getElementById('awards-root');
  const title = document.getElementById('awards-page-title');
  if (!root) return;
  if (title && seasonName) title.textContent = `Awards — ${seasonName}`;

  const byKey = {};
  _awardModalData = {};
  for (const w of winners || []) {
    if (!byKey[w.award_key]) byKey[w.award_key] = [];
    byKey[w.award_key].push(w);
  }
  const teamByKey = {};
  for (const t of teamAwards || []) teamByKey[t.award_key] = t;

  const cards = (defs || []).map(def => {
    const playerWinners = byKey[def.key] || [];
    const teamWinner = teamByKey[def.key];
    const lines = [];
    if (teamWinner) {
      lines.push(`<div class="award-line">🏆 ${teamLink(teamWinner.team_id, teamWinner.team_name)}</div>`);
    }
    for (const w of playerWinners) {
      lines.push(`<div class="award-line">${playerLink(w.player_name)}${w.notes ? ` <span style="color:#8b949e;">(${esc(w.notes)})</span>` : ''}</div>`);
    }
    let rows;
    let clickable = false;
    if (!lines.length) {
      rows = '<div class="award-empty">No winner selected yet.</div>';
    } else if (lines.length === 1) {
      rows = lines[0];
    } else {
      clickable = true;
      _awardModalData[def.key] = { title: def.name || def.key, html: lines.join('') };
      const lead = teamWinner
        ? `<div class="award-line">🏆 ${teamLink(teamWinner.team_id, teamWinner.team_name)}</div>`
        : '';
      const count = playerWinners.length;
      rows = lead + (count ? `<div class="award-more">${count} player${count === 1 ? '' : 's'} — click to view</div>` : '');
    }

    return `
      <article class="award-card${clickable ? ' award-card-click' : ''}" ${clickable ? `data-award="${esc(def.key)}" tabindex="0"` : ''}>
        <div class="award-head">
          ${def.image_url ? `<img class="award-image" src="${esc(def.image_url)}" alt="${esc(def.name)}">` : '<div class="award-image"></div>'}
          <div>
            <div class="award-title">${esc(def.name || def.key)}</div>
            ${def.description ? `<div class="award-desc">${esc(def.description)}</div>` : ''}
          </div>
        </div>
        <div class="award-list">${rows}</div>
      </article>`;
  }).join('');

  root.innerHTML = cards ? `<div class="awards-grid">${cards}</div>` : '<p class="loading">No awards configured.</p>';
}

function openAwardModal(key) {
  const d = _awardModalData[key];
  if (!d) return;
  closeAwardModal();
  const ov = document.createElement('div');
  ov.id = 'award-modal';
  ov.className = 'award-modal-overlay';
  ov.innerHTML = `<div class="award-modal"><button type="button" class="award-modal-close" aria-label="Close">✕</button>
    <h3>${esc(d.title)}</h3><div class="award-list">${d.html}</div></div>`;
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.award-modal-close')) closeAwardModal(); });
  document.body.appendChild(ov);
}
function closeAwardModal() {
  const m = document.getElementById('award-modal');
  if (m) m.remove();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAwardModal(); });
document.addEventListener('click', e => {
  const card = e.target.closest('.award-card-click');
  if (card && !e.target.closest('a')) openAwardModal(card.dataset.award);
});

async function loadAwardsForSelectedSeason() {
  const root = document.getElementById('awards-root');
  const seasonSelect = document.getElementById('season-select');
  if (!root || !seasonSelect) return;

  const seasonId = typeof SeasonSelector !== 'undefined' ? SeasonSelector.getSelectedSeasonId() : null;
  const seasonName = seasonSelect.options[seasonSelect.selectedIndex]?.textContent || '';
  if (!seasonId) {
    root.innerHTML = '<p class="loading">Choose a season to view awards.</p>';
    return;
  }

  root.innerHTML = '<p class="loading">Loading awards…</p>';
  try {
    const [winnersRes, teamRes] = await Promise.all([
      fetch(`${API}/awards/season/${seasonId}`),
      fetch(`${API}/awards/season/${seasonId}/team-awards`)
    ]);
    if (!winnersRes.ok || !teamRes.ok) throw new Error('Failed to load season awards');
    const [winners, teamAwards] = await Promise.all([winnersRes.json(), teamRes.json()]);
    renderAwards(_awardDefs, winners, teamAwards, seasonName);
  } catch (_err) {
    root.innerHTML = '<p style="color:#f85149;">Failed to load awards for this season.</p>';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('awards-root');
  if (!root) return;

  try {
    const defsRes = await fetch(`${API}/awards`);
    if (!defsRes.ok) throw new Error('Failed to load awards definitions');
    _awardDefs = await defsRes.json();

    if (typeof SeasonSelector !== 'undefined') {
      await SeasonSelector.init('season-selector-container', { noAllTime: true, seasonFilter: 'regular' });
      SeasonSelector.onSeasonChange(() => loadAwardsForSelectedSeason());
    }

    await loadAwardsForSelectedSeason();
  } catch (_err) {
    root.innerHTML = '<p style="color:#f85149;">Failed to load awards page.</p>';
  }
});
