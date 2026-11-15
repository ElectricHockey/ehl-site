const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('team league selector and awards show only the selected league', () => {
  const source = fs.readFileSync(require.resolve('../public/team.js'), 'utf8').replace(/\binitTeamPage\(\);\s*$/, '');
  const elements = {
    'season-selector-container': { innerHTML: '' },
    'team-season-select': { addEventListener() {} },
  };
  const context = vm.createContext({
    URL, URLSearchParams,
    document: { getElementById: id => elements[id] },
    window: { location: { href: 'http://localhost/team.html?id=31&league=threes&season_id=23' } },
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    _teamSeasons = [
      {id: 23, name: 'Three Season', league_type: 'threes', is_active: 1},
      {id: 24, name: 'Six Season', league_type: 'sixes', is_active: 1}
    ];
    _teamLeagueType = 'sixes';
    _teamColors = { color1: '#abcdef' };
    selectDefaultTeamSeason();
    _teamAwards = {
      teamAwards: [{season_id: 23, season_name: 'Three Season', league_type: 'threes', award_name: 'Three Trophy'},
                   {season_id: 24, season_name: 'Six Season', league_type: 'sixes', award_name: 'Six Trophy'}]
    };
    renderTeamSeasonSelector();
  `, context);
  assert.match(elements['season-selector-container'].innerHTML, /Six Season/);
  assert.doesNotMatch(elements['season-selector-container'].innerHTML, /Three Season/);
  assert.match(elements['season-selector-container'].innerHTML, /3's/);
  assert.match(elements['season-selector-container'].innerHTML, /6's/);
  assert.match(elements['season-selector-container'].innerHTML, /--team-tab-rgb:171,205,239/);
  assert.match(elements['season-selector-container'].innerHTML, /team-view-tab lt-tab-active" aria-pressed="true"[^>]*>Stats/);
  assert.match(elements['season-selector-container'].innerHTML, /team-view-tab" aria-pressed="false"[^>]*>🏆 Awards/);
  const awards = vm.runInContext('renderTeamAwards()', context);
  assert.match(awards, /Six Trophy/);
  assert.doesNotMatch(awards, /Three Trophy/);
  assert.equal(vm.runInContext("teamPlayerHref('Player')", context), 'player.html?name=Player&league=sixes&season_id=24');
  vm.runInContext("switchTeamLeague('threes')", context);
  assert.equal(context.window.location.href, 'http://localhost/team.html?id=31&league=threes');
});

test('season stats tabs update their active state and displayed table', () => {
  const source = fs.readFileSync(require.resolve('../public/team.js'), 'utf8').replace(/\binitTeamPage\(\);\s*$/, '');
  const buttons = [0, 1].map(() => ({
    classList: { toggle(_name, active) { this.active = active; } },
    setAttribute(_name, value) { this.pressed = value; },
  }));
  const roots = {
    'team-skaters-root': { style: {} },
    'team-goalies-root': { style: {} },
  };
  const context = vm.createContext({
    document: {
      getElementById: id => roots[id],
      querySelectorAll: () => buttons,
    },
  });
  vm.runInContext(source, context);
  vm.runInContext("switchStatsTab('goalies')", context);
  assert.deepEqual(buttons.map(b => [b.classList.active, b.pressed]), [[false, 'false'], [true, 'true']]);
  assert.equal(roots['team-skaters-root'].style.display, 'none');
  assert.equal(roots['team-goalies-root'].style.display, '');
  vm.runInContext("switchStatsTab('skaters')", context);
  assert.deepEqual(buttons.map(b => [b.classList.active, b.pressed]), [[true, 'true'], [false, 'false']]);
  assert.equal(roots['team-skaters-root'].style.display, '');
  assert.equal(roots['team-goalies-root'].style.display, 'none');
});
