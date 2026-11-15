const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Client } = require('pg');
const GameRating = require('../public/game-rating');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;

test('season and all-time leaders combine name variants without multiplying roster or user joins', { skip: !connectionString }, async () => {
  const client = new Client({ connectionString, ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false } });
  await client.connect();
  const db = {
    prepare(sql) {
      let n = 0;
      const query = sql.replace(/\?/g, () => `$${++n}`);
      return {
        async get(...args) { return (await client.query(query, args)).rows[0]; },
        async all(...args) { return (await client.query(query, args)).rows; },
      };
    },
  };
  try {
    await client.query('BEGIN');
    for (const table of ['game_player_stats', 'games', 'teams', 'players', 'users', 'season_rosters', 'seasons', 'settings', 'season_player_stats']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS) ON COMMIT DROP`);
    }
    await client.query(`
      INSERT INTO seasons (id,name,league_type) VALUES (1,'Season','sixes');
      INSERT INTO teams (id,name) VALUES (1,'Team'),(2,'Opponent');
      INSERT INTO games (id,season_id,home_team_id,away_team_id,status,home_score,away_score,date) VALUES
        (1,1,1,2,'complete',5,1,'2026-01-01'),(2,1,1,2,'complete',3,2,'2026-01-02');
      INSERT INTO players (id,name,team_id,position,is_rostered,user_id) VALUES
        (1,'Example',1,'C',1,NULL),(2,' example ',1,'C',1,NULL),
        (3,'Keeper',1,'G',1,NULL),(4,' keeper ',1,'G',1,NULL);
      INSERT INTO season_rosters (season_id,team_id,player_id) VALUES (1,1,1),(1,1,2),(1,1,3),(1,1,4);
      INSERT INTO users (id,username,position) VALUES (1,'example','C'),(2,' EXAMPLE ','C');
      INSERT INTO game_player_stats (game_id,team_id,player_name,position,goals,assists,shots,toi,shots_against,goals_against,saves) VALUES
        (1,1,'Example','C',1,2,4,3600,0,0,0),(2,1,' EXAMPLE ','LW',2,1,5,3600,0,0,0),
        (1,1,'Keeper','G',0,0,0,3600,10,1,9),(2,1,'KEEPER','G',0,0,0,3600,12,2,10);
      UPDATE game_player_stats SET overall_rating = 99, offensive_rating = 99, defensive_rating = 99, team_play_rating = 99;
    `);
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf("app.get('/api/stats/leaders'");
    const end = source.indexOf("app.get('/api/admin/unrostered-stats'", start);
    let handler;
    const ratingAggregate = isGoalie => {
      const rating = GameRating.sqlExpression('gps', isGoalie);
      return `ROUND(AVG(${rating}), 0) AS overall_rating, SUM(${rating}) AS overall_rating_sum, COUNT(${rating}) AS overall_rating_count`;
    };
    const context = vm.createContext({ db, ratingAggregate, app: { get(_path, fn) { handler = fn; } } });
    vm.runInContext(source.slice(source.indexOf('function gameWinnerSql('), source.indexOf('function capScoreDifferential(')), context);
    vm.runInContext(source.slice(start, end), context);
    for (const query of [{ season_id: '1' }, { league_type: 'sixes', is_playoff: '0' }]) {
      let result;
      await handler({ query }, { json(body) { result = body; } });
      assert.equal(result.skaters.length, 1);
      assert.deepEqual([result.skaters[0].gp, result.skaters[0].goals, result.skaters[0].assists, result.skaters[0].points].map(Number), [2, 3, 3, 6]);
      assert.equal(result.skaters[0].team_id, 1);
      assert.equal(Number(result.skaters[0].overall_rating), Math.round((GameRating.calculate({ position: 'C', goals: 1, assists: 2, shots: 4 }) + GameRating.calculate({ position: 'LW', goals: 2, assists: 1, shots: 5 })) / 2));
      assert.equal(Number(result.skaters[0].overall_rating_count), 2);
      assert.equal(result.goalies.length, 1);
      assert.deepEqual([result.goalies[0].gp, result.goalies[0].shots_against, result.goalies[0].goals_against, result.goalies[0].saves].map(Number), [2, 22, 3, 19]);
      assert.equal(Number(result.goalies[0].overall_rating), Math.round((GameRating.calculate({ position: 'G', shots_against: 10, goals_against: 1, saves: 9 }) + GameRating.calculate({ position: 'G', shots_against: 12, goals_against: 2, saves: 10 })) / 2));
    }
    await client.query(`
      INSERT INTO seasons (id,name,league_type) VALUES (2,'Earlier','sixes');
      INSERT INTO games (id,season_id,home_team_id,away_team_id,status,home_score,away_score,date)
        SELECT n,2,1,2,'complete',1,0,'2025-01-01' FROM generate_series(3,8) n;
      INSERT INTO game_player_stats (game_id,team_id,player_name,position)
        SELECT n,1,CASE WHEN n < 6 THEN 'example' ELSE ' EXAMPLE ' END,'C' FROM generate_series(3,8) n;
    `);
    const rookieStart = source.indexOf("app.get('/api/stats/rookies'");
    const rookieEnd = source.indexOf('// ── League stats leaders', rookieStart);
    vm.runInContext(source.slice(rookieStart, rookieEnd), context);
    let rookies;
    await handler({ query: { season_id: '1' } }, { json(body) { rookies = body.names; } });
    assert.equal(rookies.includes('example'), false);
    assert.equal(rookies.includes('keeper'), true);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
