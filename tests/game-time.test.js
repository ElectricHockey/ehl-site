const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const modulePath = require.resolve('../public/game-time');

function runInZone(zone, code) {
  return JSON.parse(execFileSync(process.execPath, ['-e', `const t = require(${JSON.stringify(modulePath)}); ${code}`], {
    env: { ...process.env, TZ: zone }, encoding: 'utf8',
  }));
}

test('local entry round-trips through Eastern storage in multiple seasons and zones', () => {
  for (const zone of ['America/Regina', 'America/New_York', 'America/Los_Angeles']) {
    for (const date of ['2026-01-12', '2026-07-12', '2026-11-12']) {
      const result = runInZone(zone, `const e = t.toEastern('${date}', '19:30'); console.log(JSON.stringify({e, local:t.toLocal(e.date,e.time)}));`);
      assert.deepEqual(result.local, { date, time: '19:30' });
      if (zone === 'America/Regina' && date === '2026-11-12') assert.equal(result.e.time, '20:30');
    }
  }
});

test('local and Eastern dates stay aligned when a game crosses midnight', () => {
  const result = runInZone('America/Los_Angeles', "const e=t.toEastern('2026-11-12','23:30'); console.log(JSON.stringify({e, local:t.toLocal(e.date,e.time)}));");
  assert.deepEqual(result.e, { date: '2026-11-13', time: '02:30' });
  assert.deepEqual(result.local, { date: '2026-11-12', time: '23:30' });
});

test('rejects nonexistent and ambiguous times rather than saving a different instant', () => {
  const result = runInZone('America/Los_Angeles', `const out=[]; for(const [d,h] of [['2026-03-08','02:30'],['2026-11-01','01:30']]) { try { t.toEastern(d,h); out.push('accepted'); } catch(e) { out.push(e.message); } } console.log(JSON.stringify(out));`);
  assert.match(result[0], /does not exist/);
  assert.match(result[1], /ambiguous/);
});
