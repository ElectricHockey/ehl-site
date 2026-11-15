const test = require('node:test');
const assert = require('node:assert/strict');
const penaltyShots = require('../public/ea-penalty-shot');
const fs = require('node:fs');
const vm = require('node:vm');

test('EA saves are not goals against', () => {
  assert.deepEqual(penaltyShots({ glpenshots: '2', glpensaves: '2' }), { attempts: 2, goalsAgainst: 0 });
  assert.deepEqual(penaltyShots({ glpenshots: '3', glpensaves: '1' }), { attempts: 3, goalsAgainst: 2 });
  assert.deepEqual(penaltyShots({ glpenshots: '0', glpensaves: '0' }), { attempts: 0, goalsAgainst: 0 });
  assert.deepEqual(penaltyShots({}), { attempts: 0, goalsAgainst: 0 });
});

test('already mapped values remain goals against', () => {
  assert.deepEqual(penaltyShots({ penaltyShotAttempts: 3, penaltyShotGa: 1 }), { attempts: 3, goalsAgainst: 1 });
});

test('incomplete or inconsistent EA data fails explicitly', () => {
  assert.throws(() => penaltyShots({ glpenshots: 1, glpensaves: 2 }));
  assert.throws(() => penaltyShots({ glpenshots: 1 }));
});

test('server and browser EA mappers use the same penalty-shot conversion', () => {
  const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
  const browser = fs.readFileSync(require.resolve('../public/schedule.js'), 'utf8');
  const sources = [
    [server, 'function readEAField(obj, candidates)', '// Helper: build the structured game object', 'mapEAPlayer'],
    [browser, 'function readEAField(player, keys)', 'function buildPickerGameData', 'mapEAPlayerFromRaw'],
  ];
  for (const [source, start, end, mapper] of sources) {
    const section = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
    const context = vm.createContext({ eaPenaltyShotStats: penaltyShots });
    vm.runInContext(section, context);
    const mapped = context[mapper]({ playername: 'Goalie', position: 'goalie', glpenshots: '2', glpensaves: '2', glga: '0' });
    assert.equal(mapped.penaltyShotAttempts, 2);
    assert.equal(mapped.penaltyShotGa, 0);
    const conceded = context[mapper]({ position: 'goalie', glpenshots: '3', glpensaves: '1' });
    assert.equal(conceded.penaltyShotGa, 2);
  }
});
