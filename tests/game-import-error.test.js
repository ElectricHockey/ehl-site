const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('import explains when a stale server returns HTML instead of JSON', async () => {
  const source = fs.readFileSync(require.resolve('../public/game.js'), 'utf8').replace(/\bloadGame\(\);\s*$/, '');
  const message = { textContent: '' };
  const button = { disabled: false };
  const input = { value: 'https://www.mystatsonline.com/', parentElement: { querySelector: () => button } };
  const context = vm.createContext({
    document: { getElementById: id => id === 'mso-game-url' ? input : id === 'mso-schedule-url' ? { value: '' } : message },
    localStorage: { getItem: () => '' },
    fetch: async () => ({ status: 404, headers: { get: () => 'text/html' } }),
  });
  vm.runInContext(source, context);
  await vm.runInContext("importMsoGame('1')", context);
  assert.match(message.textContent, /Restart the local server/);
  assert.equal(button.disabled, false);
});

test('non-final import warns before marking the game complete and keeps missing goalies', async () => {
    const source = fs.readFileSync(require.resolve('../public/game.js'), 'utf8').replace(/\bloadGame\(\);\s*$/, '');
    const message = { textContent: '' }, button = { disabled: false };
    const input = { value: 'https://www.mystatsonline.com/game', parentElement: { querySelector: () => button } };
    let prompt, requests = 0;
    const context = vm.createContext({
      document: { getElementById: id => id === 'mso-game-url' ? input : id === 'mso-schedule-url' ? { value: '' } : message },
      localStorage: { getItem: () => '' },
      window: { confirm: text => { prompt = text; return false; } },
      fetch: async () => {
        requests++;
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({
          preview: { source: { home: { name: 'Home', score: 2 }, away: { name: 'Away', score: 1 }, date: '', status: 'Pending', isFinal: false },
            homePlayers: [{ position: 'C' }], awayPlayers: [{ position: 'G' }], home_score: 2, away_score: 1 }, digest: 'digest',
        }) };
      },
    });
    vm.runInContext(source, context);
    await vm.runInContext("importMsoGame('1')", context);
    assert.match(prompt, /does not mark this game as final.*Pending/);
    assert.match(prompt, /mark it complete here/);
    assert.match(prompt, /goalie is missing/);
    assert.equal(requests, 1);
    assert.match(message.textContent, /cancelled/);
});
