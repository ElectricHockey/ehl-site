// ── Shared Game Stats Editor ─────────────────────────────────────────────
// Provides an in-page overlay for editing a game's score, status, and
// per-player stats.  Loaded by both admin.html and schedule.html.
//
// Requires:
//   - API constant (window.API or '/api')
//   - adminHeaders() / adminJsonHeaders() helpers in scope
//   - optional: window._gseOnSave callback (called with gameId after save)
//   - optional: window._gseAllSeasons array for the season dropdown

(function () {
  'use strict';

  const _API = () => (typeof API !== 'undefined' ? API : '/api');

  // ── Column definitions ─────────────────────────────────────────────────
  const GS_COLS = [
    { l:'OFFR', k:'offensiveRating',      w:42 },
    { l:'DR',   k:'defensiveRating',      w:42 },
    { l:'TPR',  k:'teamPlayRating',       w:42 },
    { l:'G',    k:'goals',                w:38 },
    { l:'A',    k:'assists',              w:38 },
    { l:'+/-',  k:'plusMinus',            w:42, mn:-99 },
    { l:'SOG',  k:'shots',                w:40 },
    { l:'SA',   k:'shotAttempts',         w:40 },
    { l:'HIT',  k:'hits',                 w:40 },
    { l:'PIM',  k:'pim',                  w:40 },
    { l:'BS',   k:'blockedShots',         w:38 },
    { l:'TKA',  k:'takeaways',            w:38 },
    { l:'GVA',  k:'giveaways',            w:38 },
    { l:'PPG',  k:'ppGoals',              w:38 },
    { l:'SHG',  k:'shGoals',              w:38 },
    { l:'GWG',  k:'gwg',                  w:38 },
    { l:'PD',   k:'penaltiesDrawn',       w:38 },
    { l:'FOW',  k:'faceoffWins',          w:38 },
    { l:'FOL',  k:'faceoffLosses',        w:38 },
    { l:'DEF',  k:'deflections',          w:38 },
    { l:'INT',  k:'interceptions',        w:38 },
    { l:'PA',   k:'passAttempts',         w:45 },
    { l:'PC',   k:'passCompletions',      w:45 },
    { l:'HT',   k:'hatTricks',            w:35 },
    { l:'POSS', k:'possessionSecs',       w:52 },
    { l:'TOI',  k:'toi',                  w:52 },
    { l:'SV',   k:'saves',                w:38 },
    { l:'GA',   k:'goalsAgainst',         w:38 },
    { l:'ShAg', k:'shotsAgainst',         w:42 },
    { l:'PSA',  k:'penaltyShotAttempts',  w:38 },
    { l:'PSGA', k:'penaltyShotGa',        w:42 },
    { l:'BKSA', k:'breakawayShots',       w:40 },
    { l:'BKSV', k:'breakawaySaves',       w:40 },
  ];

  let _editorGameId = null;
  let _gsRowIdx = 0;

  // Convert DB snake_case row → camelCase object for the editor form
  function gsDbToRow(p) {
    return {
      name:                p.player_name             || '',
      position:            p.position                || '',
      offensiveRating:     p.offensive_rating        || 0,
      defensiveRating:     p.defensive_rating        || 0,
      teamPlayRating:      p.team_play_rating        || 0,
      goals:               p.goals                   || 0,
      assists:             p.assists                 || 0,
      plusMinus:           p.plus_minus              || 0,
      shots:               p.shots                   || 0,
      shotAttempts:        p.shot_attempts           || 0,
      hits:                p.hits                    || 0,
      pim:                 p.pim                     || 0,
      blockedShots:        p.blocked_shots           || 0,
      takeaways:           p.takeaways               || 0,
      giveaways:           p.giveaways               || 0,
      ppGoals:             p.pp_goals                || 0,
      shGoals:             p.sh_goals                || 0,
      gwg:                 p.gwg                     || 0,
      penaltiesDrawn:      p.penalties_drawn         || 0,
      faceoffWins:         p.faceoff_wins            || 0,
      faceoffLosses:       p.faceoff_losses          || 0,
      deflections:         p.deflections             || 0,
      interceptions:       p.interceptions           || 0,
      passAttempts:        p.pass_attempts           || 0,
      passCompletions:     p.pass_completions        || 0,
      hatTricks:           p.hat_tricks              || 0,
      possessionSecs:      p.possession_secs         || 0,
      toi:                 p.toi                     || 0,
      saves:               p.saves                   || 0,
      goalsAgainst:        p.goals_against           || 0,
      shotsAgainst:        p.shots_against           || 0,
      penaltyShotAttempts: p.penalty_shot_attempts   || 0,
      penaltyShotGa:       p.penalty_shot_ga         || 0,
      breakawayShots:      p.breakaway_shots         || 0,
      breakawaySaves:      p.breakaway_saves         || 0,
    };
  }

  // Build one editable player row
  function gsBuildRow(side, p) {
    p = p || {};
    const rowId = `gsr-${side}-${_gsRowIdx++}`;
    const IS = 'background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:3px;padding:0.1rem 0;font-size:0.75rem;text-align:center;';
    const numInp = (key, val, w, mn) => {
      const minA = mn !== undefined ? `min="${mn}"` : 'min="0"';
      return `<input type="number" data-key="${key}" value="${val !== undefined ? val : 0}" ${minA} style="${IS}width:${w || 45}px;" />`;
    };
    const cells = GS_COLS.map(c => `<td style="padding:0.08rem 0.1rem;">${numInp(c.k, p[c.k], c.w, c.mn)}</td>`).join('');
    const posOpts = ['C','LW','RW','LD','RD','G'].map(pos => `<option${pos === (p.position || '') ? ' selected' : ''}>${pos}</option>`).join('');
    const safeName = (p.name || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    return `<tr id="${rowId}">
      <td style="padding:0.08rem 0.1rem;"><button onclick="gseRemoveRow('${rowId}')" title="Remove player" style="background:#da3633;border:none;border-radius:3px;color:#fff;cursor:pointer;padding:0.1rem 0.35rem;font-size:0.75rem;">✕</button></td>
      <td style="padding:0.08rem 0.1rem;"><input type="text" data-key="name" value="${safeName}" placeholder="Player name" style="background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:3px;padding:0.1rem 0.25rem;width:110px;font-size:0.75rem;" /></td>
      <td style="padding:0.08rem 0.1rem;"><select data-key="position" style="background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:3px;padding:0.1rem;font-size:0.75rem;">${posOpts}</select></td>
      ${cells}
    </tr>`;
  }

  // Build the scrollable player table for one team side
  function gsBuildTable(side, players) {
    const hdr = GS_COLS.map(c => `<th title="${c.l}" style="padding:0.15rem 0.06rem;font-size:0.68rem;white-space:nowrap;">${c.l}</th>`).join('');
    const rows = (players || []).map(p => gsBuildRow(side, gsDbToRow(p))).join('');
    return `<table id="gse-tbl-${side}" style="border-collapse:collapse;">
      <thead><tr style="background:#0d1117;">
        <th style="padding:0.15rem;"></th>
        <th style="padding:0.15rem 0.3rem;font-size:0.68rem;min-width:110px;">Name</th>
        <th style="padding:0.15rem;font-size:0.68rem;">Pos</th>
        ${hdr}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  // ── Public: open the editor overlay ─────────────────────────────────────
  async function editGameStats(gameId) {
    const token = typeof getAdminToken === 'function' ? getAdminToken() : '';
    const headers = { 'X-Admin-Token': token };
    const res = await fetch(`${_API()}/games/${gameId}/stats`, { headers });
    if (!res.ok) { alert('Failed to load game stats'); return; }
    const data = await res.json();
    _editorGameId = gameId;
    _gsRowIdx = 0; // reset row index for fresh IDs

    const existing = document.getElementById('game-stats-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'game-stats-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;overflow-y:auto;padding:1.5rem 0.5rem;';

    const g = data.game;
    const IS = 'background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:5px;padding:0.3rem 0.5rem;';

    // Season dropdown (optional – uses window._gseAllSeasons if available)
    const seasons = window._gseAllSeasons || [];
    const seasonOpts = '<option value="">— No Season —</option>' +
      seasons.map(s => `<option value="${s.id}"${s.id === g.season_id ? ' selected' : ''}>${s.name}</option>`).join('');
    const seasonRow = seasons.length > 0
      ? `<div>
           <label style="display:block;color:#8b949e;font-size:0.75rem;margin-bottom:0.25rem;">Season</label>
           <select id="gse-season" style="${IS}">${seasonOpts}</select>
         </div>`
      : `<input type="hidden" id="gse-season" value="${g.season_id || ''}" />`;

    overlay.innerHTML = `<div style="background:#161b22;border:1px solid #30363d;border-radius:10px;max-width:1400px;margin:0 auto;padding:1.5rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <h3 style="margin:0;">✏️ Edit Game #${g.id} – ${g.home_team.name} vs ${g.away_team.name}</h3>
        <button onclick="closeGameStatsEditor()" style="background:none;border:none;color:#8b949e;font-size:1.3rem;cursor:pointer;line-height:1;">✕</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:1rem;margin-bottom:1.25rem;padding:1rem;background:#0d1117;border-radius:8px;align-items:flex-end;">
        <div>
          <label style="display:block;color:#8b949e;font-size:0.75rem;margin-bottom:0.25rem;">Date</label>
          <input type="date" id="gse-date" value="${g.date || ''}" style="${IS}" />
        </div>
        <div>
          <label style="display:block;color:#8b949e;font-size:0.75rem;margin-bottom:0.25rem;">${g.home_team.name} Score</label>
          <input type="number" id="gse-home-score" value="${g.home_score}" min="0" style="${IS}width:60px;" />
        </div>
        <div>
          <label style="display:block;color:#8b949e;font-size:0.75rem;margin-bottom:0.25rem;">${g.away_team.name} Score</label>
          <input type="number" id="gse-away-score" value="${g.away_score}" min="0" style="${IS}width:60px;" />
        </div>
        <div>
          <label style="display:block;color:#8b949e;font-size:0.75rem;margin-bottom:0.25rem;">Status</label>
          <select id="gse-status" style="${IS}">
            <option value="scheduled"${g.status === 'scheduled' ? ' selected' : ''}>Scheduled</option>
            <option value="complete"${g.status === 'complete' ? ' selected' : ''}>Complete</option>
          </select>
        </div>
        ${seasonRow}
        <label style="display:flex;align-items:center;gap:0.35rem;cursor:pointer;font-size:0.85rem;">
          <input type="checkbox" id="gse-overtime" ${g.is_overtime ? 'checked' : ''} /> Overtime
        </label>
      </div>
      <div style="display:flex;gap:0.4rem;margin-bottom:1rem;border-bottom:1px solid #30363d;padding-bottom:0.5rem;">
        <button class="gse-tab gse-tab-active" data-side="home" onclick="gseShowTab('home')" style="padding:0.3rem 1rem;border-radius:20px;border:1px solid #58a6ff;background:#1c2a3a;color:#58a6ff;cursor:pointer;font-size:0.85rem;">🏠 ${g.home_team.name}</button>
        <button class="gse-tab" data-side="away" onclick="gseShowTab('away')" style="padding:0.3rem 1rem;border-radius:20px;border:1px solid #30363d;background:#21262d;color:#8b949e;cursor:pointer;font-size:0.85rem;">✈️ ${g.away_team.name}</button>
      </div>
      <div id="gse-panel-home">
        <div style="overflow-x:auto;">${gsBuildTable('home', data.home_players)}</div>
        <button onclick="gseAddPlayer('home')" style="margin-top:0.5rem;padding:0.3rem 0.8rem;background:#238636;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:0.83rem;">+ Add Player</button>
      </div>
      <div id="gse-panel-away" style="display:none;">
        <div style="overflow-x:auto;">${gsBuildTable('away', data.away_players)}</div>
        <button onclick="gseAddPlayer('away')" style="margin-top:0.5rem;padding:0.3rem 0.8rem;background:#238636;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:0.83rem;">+ Add Player</button>
      </div>
      <div id="gse-error" style="color:#f85149;font-size:0.84rem;margin-top:0.75rem;display:none;"></div>
      <div style="display:flex;gap:0.5rem;margin-top:1.25rem;">
        <button onclick="saveGameStatsEdits()" style="padding:0.45rem 1.2rem;background:#238636;border:none;border-radius:6px;color:#fff;cursor:pointer;font-weight:600;font-size:0.9rem;">💾 Save Changes</button>
        <button onclick="closeGameStatsEditor()" style="padding:0.45rem 1.2rem;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;cursor:pointer;font-size:0.9rem;">Cancel</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeGameStatsEditor(); });
  }

  // ── Public: switch home/away tab ─────────────────────────────────────────
  function gseShowTab(side) {
    document.querySelectorAll('.gse-tab').forEach(btn => {
      const active = btn.dataset.side === side;
      btn.style.background = active ? '#1c2a3a' : '#21262d';
      btn.style.borderColor = active ? '#58a6ff' : '#30363d';
      btn.style.color = active ? '#58a6ff' : '#8b949e';
    });
    document.getElementById('gse-panel-home').style.display = side === 'home' ? '' : 'none';
    document.getElementById('gse-panel-away').style.display = side === 'away' ? '' : 'none';
  }

  // ── Public: add / remove player rows ─────────────────────────────────────
  function gseAddPlayer(side) {
    const tbody = document.querySelector(`#gse-tbl-${side} tbody`);
    if (tbody) tbody.insertAdjacentHTML('beforeend', gsBuildRow(side, {}));
  }

  function gseRemoveRow(rowId) {
    const row = document.getElementById(rowId);
    if (row) row.remove();
  }

  function gseCollectPlayers(side) {
    const players = [];
    document.querySelectorAll(`#gse-tbl-${side} tbody tr`).forEach(row => {
      const p = {};
      row.querySelectorAll('[data-key]').forEach(el => {
        const key = el.dataset.key;
        if (el.tagName === 'SELECT') p[key] = el.value;
        else if (el.type === 'number') p[key] = Number(el.value) || 0;
        else p[key] = el.value.trim();
      });
      if (p.name) players.push(p);
    });
    return players;
  }

  // ── Public: save ─────────────────────────────────────────────────────────
  async function saveGameStatsEdits() {
    const errEl = document.getElementById('gse-error');
    errEl.style.display = 'none';

    const seasonEl = document.getElementById('gse-season');
    const body = {
      date:        document.getElementById('gse-date').value,
      home_score:  parseInt(document.getElementById('gse-home-score').value) || 0,
      away_score:  parseInt(document.getElementById('gse-away-score').value) || 0,
      status:      document.getElementById('gse-status').value,
      season_id:   seasonEl && seasonEl.value ? Number(seasonEl.value) : null,
      is_overtime: document.getElementById('gse-overtime').checked ? 1 : 0,
      player_stats: {
        home_players: gseCollectPlayers('home'),
        away_players: gseCollectPlayers('away'),
      },
    };

    const token = typeof getAdminToken === 'function' ? getAdminToken() : '';
    const res = await fetch(`${_API()}/games/${_editorGameId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      errEl.textContent = e.error || 'Failed to save';
      errEl.style.display = '';
      return;
    }

    closeGameStatsEditor();

    // Invoke context-specific post-save callback if registered
    if (typeof window._gseOnSave === 'function') {
      await window._gseOnSave(_editorGameId);
    }
  }

  // ── Public: close overlay ─────────────────────────────────────────────────
  function closeGameStatsEditor() {
    const el = document.getElementById('game-stats-overlay');
    if (el) el.remove();
  }

  // Expose functions globally
  window.editGameStats      = editGameStats;
  window.gseShowTab         = gseShowTab;
  window.gseAddPlayer       = gseAddPlayer;
  window.gseRemoveRow       = gseRemoveRow;
  window.saveGameStatsEdits = saveGameStatsEdits;
  window.closeGameStatsEditor = closeGameStatsEditor;
})();
