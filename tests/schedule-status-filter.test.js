const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/schedule.js'), 'utf8');
const filterCode = source.slice(source.indexOf('function applyScheduleFilters('), source.indexOf('function populateTeamFilter('));
const games = [
  { id: 1, status: 'complete', is_forfeit: 0, home_team_id: 1, away_team_id: 2 },
  { id: 2, status: 'scheduled', home_team_id: 1, away_team_id: 3 },
  { id: 3, status: 'rescheduled', home_team_id: 2, away_team_id: 3 },
  { id: 4, status: 'forfeit', home_team_id: 1, away_team_id: 2 },
  { id: 5, status: 'complete', is_forfeit: 1, home_team_id: 2, away_team_id: 3 },
];

test('status filter separates forfeits from completed games and combines with team filter', () => {
  const ctx = vm.createContext({ games, scheduleTeamFilter: '', scheduleTimeFilter: 'all', scheduleStatusFilter: 'all' });
  vm.runInContext(filterCode, ctx);
  const ids = () => Array.from(ctx.applyScheduleFilters(games), g => g.id);
  assert.deepEqual(ids(), [1, 2, 3, 4, 5]);
  ctx.scheduleStatusFilter = 'complete';
  assert.deepEqual(ids(), [1]);
  ctx.scheduleStatusFilter = 'incomplete';
  assert.deepEqual(ids(), [2]);
  ctx.scheduleStatusFilter = 'rescheduled';
  assert.deepEqual(ids(), [3]);
  ctx.scheduleStatusFilter = 'forfeit';
  assert.deepEqual(ids(), [4, 5]);
  ctx.scheduleTeamFilter = '1';
  assert.deepEqual(ids(), [4]);
  ctx.scheduleTimeFilter = 'upcoming';
  assert.deepEqual(ids(), []);
});
