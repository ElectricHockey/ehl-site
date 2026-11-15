const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('editor displays TOI in minutes and saves seconds without losing precision', () => {
  const source = fs.readFileSync(require.resolve('../public/game-stats-editor.js'), 'utf8')
    .replace('// Expose functions globally', 'window.testHelpers = { gsDbToRow, gsBuildTable, gseCollectPlayers };\n  // Expose functions globally');
  let inputs = [];
  const context = vm.createContext({
    window: {},
    document: { querySelectorAll: () => [{ querySelectorAll: () => inputs }] },
  });
  vm.runInContext(source, context);
  const { gsDbToRow, gsBuildTable, gseCollectPlayers } = context.window.testHelpers;
  const ratingsHtml = gsBuildTable('home', [{ player_name: 'Skater', position: 'C', overall_rating: 99, offensive_rating: 88 }]);
  assert.doesNotMatch(ratingsHtml, /<th[^>]*>OVR<\/th>/);
  assert.match(ratingsHtml, /type="hidden" data-key="overallRating" value="99"/);
  assert.match(ratingsHtml, /type="hidden" data-key="offensiveRating" value="88"/);
  for (const seconds of [0, 60, 3599, 3600, 3960]) {
    const row = gsDbToRow({ player_name: 'Goalie', position: 'G', toi: seconds });
    const html = gsBuildTable('home', [{ player_name: 'Goalie', position: 'G', toi: seconds }]);
    assert.match(html, /TOI \(min\)/);
    inputs = [
      { dataset: { key: 'name' }, value: 'Goalie' },
      { dataset: { key: 'toi' }, type: 'number', value: String(row.toi) },
    ];
    assert.equal(gseCollectPlayers('home')[0].toi, seconds);
  }
  inputs[1].value = '60';
  assert.equal(gseCollectPlayers('home')[0].toi, 3600);
});
