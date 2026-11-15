const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/bracket-download.js'), 'utf8');

test('export snapshots the full scrolled bracket and reserves space for branding', () => {
  const ctx = vm.createContext({});
  vm.runInContext(source, ctx);
  const box = (left, top, width, height) => ({ getBoundingClientRect: () => ({ left, top, width, height }) });
  const title = { ...box(30, 20, 180, 32), textContent: 'Final' };
  const champion = {
    ...box(238, 62, 180, 88),
    style: { getPropertyValue: () => '' },
    querySelector: () => ({ textContent: 'TBD' }),
  };
  const grid = {
    ...box(-100, 10, 852, 180),
    querySelector(selector) { return selector === '.b-champ-box' ? champion : null; },
    querySelectorAll(selector) {
      if (selector === '.b-round-title') return [title];
      return [];
    },
  };
  const result = ctx.bracketExportSnapshot(grid, "6's", 'Season 4 Playoffs');
  assert.equal(result.width, 852);
  assert.equal(result.height, 330);
  assert.equal(result.titles[0].x, 130);
  assert.equal(result.champion.x, 338);
  assert.equal(result.league, "6's");
  assert.equal(result.season, 'Season 4 Playoffs');
});

test('download reports inaccessible logos and re-enables the button', async () => {
  const button = { disabled: false };
  const status = { textContent: '' };
  const selected = { selectedOptions: [{ textContent: 'Season 4 Playoffs ★' }] };
  const ctx = vm.createContext({
    document: { getElementById(id) { return {
      'bracket-download': button, 'bracket-download-status': status,
      'bracket-grid': {}, 'season-select': selected,
    }[id]; } },
    SeasonSelector: { getSelectedLeagueType: () => 'sixes' },
    drawBracketLines() {}, console: { error() {} },
  });
  vm.runInContext(source, ctx);
  ctx.bracketExportSnapshot = (_grid, league, season) => ({ league, season });
  ctx.bracketExportPng = async snapshot => {
    assert.equal(snapshot.league, "6's");
    assert.equal(snapshot.season, 'Season 4');
    throw new Error('Logo unavailable');
  };
  await ctx.downloadBracket();
  assert.match(status.textContent, /Could not download/);
  assert.equal(button.disabled, false);
});
