const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const PlayoffSeeding = require('../public/playoff-seeding');

const context = {
  PlayoffSeeding,
  window: { addEventListener() {} },
  document: { title: '', getElementById() { return null; } },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../public/playoffs.js'), 'utf8'), context);

const teams = Array.from({ length: 10 }, (_, i) => ({
  team_id: i + 1, seed: i + 1, name: `Team ${i + 1}`,
  abbreviation: `T${i + 1}`, color1: '#123456', color2: '#abcdef',
}));
const first = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1, round_number: 1, series_number: i + 1,
  high_seed_id: i + 1, high_seed_name: `Team ${i + 1}`,
  winner_id: i < 6 ? i + 1 : null,
}));

test('projects every round and only carries confirmed winners', () => {
  const bracket = context.buildBracketRounds({ 1: first }, teams);
  assert.deepEqual(Array.from(bracket, r => r.length), [8, 4, 2, 1]);
  assert.equal(bracket[1][0].high_seed_id, undefined);
  assert.equal(bracket[1][0].low_seed_id, undefined);
  assert.equal(bracket[1][3].high_seed_id, undefined);
  assert.equal(bracket[2][0].high_seed_id, undefined);
  const html = context.renderBracket({}, teams, { 1: first });
  assert.match(html, /Quarterfinals/);
  assert.match(html, /Semifinals/);
  assert.match(html, /Final/);
  assert.match(html, /--team-color-1:#123456;--team-color-2:#abcdef/);
  assert.equal((html.match(/data-series-id=/g) || []).length, 8);
  assert.match(html, /Advanced: T1 · T2 · T3 · T4 · T5 · T6/);
});

test('completed round projects highest remaining seed against lowest', () => {
  const completed = first.map((s, i) => ({ ...s, winner_id: [1, 2, 3, 4, 5, 6, 10, 9][i] }));
  const bracket = context.buildBracketRounds({ 1: completed }, teams);
  assert.deepEqual(Array.from(bracket[1], s => [s.high_seed_id, s.low_seed_id]), [
    [1, 10], [2, 9], [3, 6], [4, 5],
  ]);
});

test('persisted rounds override projections and a real final decides the champion', () => {
  const rounds = {
    1: first.slice(0, 2),
    2: [{ id: 20, series_number: 1, round_number: 2, high_seed_id: 2,
      low_seed_id: 1, high_seed_name: 'Team 2', low_seed_name: 'Team 1',
      high_seed_wins: 4, low_seed_wins: 2, winner_id: 2 }],
  };
  const bracket = context.buildBracketRounds(rounds, teams);
  assert.equal(bracket[1][0].id, 20);
  assert.match(context.renderBracket({}, teams, rounds), /b-champ-name">Team 2/);
});

test('rejects invalid colors and escapes team names', () => {
  assert.equal(context.teamGradient('red;bad', '#fff'), '');
  const html = context.renderBracket({}, [{ team_id: 1, seed: 1, name: '<img>', color1: '#fff' }], {
    1: [{ id: 1, series_number: 1, high_seed_id: 1, high_seed_name: '<img>', winner_id: 1 }],
  });
  assert.match(html, /&lt;img&gt;/);
  assert.doesNotMatch(html, /<img>/);
});

test('team logos appear in existing and projected matchups', () => {
  const withLogos = teams.map(t => ({ ...t, logo_url: `/logo-${t.team_id}.png` }));
  const completed = first.map((s, i) => ({ ...s, winner_id: [1, 2, 3, 4, 5, 6, 10, 9][i] }));
  const html = context.renderBracket({}, withLogos, { 1: completed });
  assert.equal((html.match(/src="\/logo-1\.png"/g) || []).length, 2);
  assert.match(html, /class="b-logo" src="\/logo-1\.png" alt=""/);
  const noLogo = context.seriesCard(first[0], teams, 0, 0);
  assert.match(noLogo, /b-logo-placeholder/);
});
