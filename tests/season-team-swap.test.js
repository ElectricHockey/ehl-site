const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { swapSeasonTeam } = require('../season-team-swap');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;

test('season team replacement preserves scores and stats and leaves other seasons untouched', { skip: !connectionString }, async () => {
  const client = new Client({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  const tx = {
    prepare(sql) {
      let n = 0;
      const query = sql.replace(/\?/g, () => `$${++n}`);
      return {
        async get(...args) { return (await client.query(query, args)).rows[0]; },
        async all(...args) { return (await client.query(query, args)).rows; },
        async run(...args) { return client.query(query, args); },
      };
    },
  };
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE seasons (id int, league_type text, is_playoff int, parent_season_id int) ON COMMIT DROP;
      CREATE TEMP TABLE teams (id int, name text, league_type text, conference text, division text) ON COMMIT DROP;
      CREATE TEMP TABLE playoffs (id int, season_id int, playoff_season_id int) ON COMMIT DROP;
      CREATE TEMP TABLE playoff_series (id int, playoff_id int, high_seed_id int, low_seed_id int, winner_id int) ON COMMIT DROP;
      CREATE TEMP TABLE playoff_teams (playoff_id int, team_id int) ON COMMIT DROP;
      CREATE TEMP TABLE games (id int, season_id int, playoff_series_id int, home_team_id int, away_team_id int, home_score int, away_score int) ON COMMIT DROP;
      CREATE TEMP TABLE game_player_stats (game_id int, team_id int, player_name text, goals int) ON COMMIT DROP;
      CREATE TEMP TABLE season_player_stats (season_id int, team_id int, goals int) ON COMMIT DROP;
      CREATE TEMP TABLE season_rosters (season_id int, team_id int, player_id int) ON COMMIT DROP;
      CREATE TEMP TABLE season_award_teams (season_id int, team_id int) ON COMMIT DROP;
      CREATE TEMP TABLE season_team_conf (id int, season_id int, team_id int, conference text, division text) ON COMMIT DROP;
      INSERT INTO seasons VALUES (1,'threes',0,NULL), (2,'threes',1,1), (3,'threes',0,NULL);
      INSERT INTO teams VALUES (10,'Old','threes','East','A'), (20,'New','threes','',''), (30,'Opponent','threes','',''), (40,'Wrong league','sixes','','');
      INSERT INTO playoffs VALUES (5,1,2);
      INSERT INTO playoff_series VALUES (6,5,10,30,10);
      INSERT INTO playoff_teams VALUES (5,10),(5,30);
      INSERT INTO games VALUES (100,1,NULL,10,30,5,2), (101,2,6,30,10,1,3), (102,3,NULL,10,30,8,2);
      INSERT INTO game_player_stats VALUES (100,10,'Player',3),(101,10,'Player',2),(102,10,'Player',4);
      INSERT INTO season_player_stats VALUES (1,10,7),(3,10,4);
      INSERT INTO season_rosters VALUES (1,10,9),(3,10,9);
      INSERT INTO season_award_teams VALUES (1,10),(3,10);
      INSERT INTO season_team_conf VALUES (1,1,10,'East','A'),(2,1,20,'',''),(3,3,10,'West','B');
    `);
    await assert.rejects(swapSeasonTeam(tx, 1, 10, 30), /already has games/);
    await assert.rejects(swapSeasonTeam(tx, 2, 10, 20), /regular season/);
    await client.query("UPDATE teams SET league_type = 'sixes' WHERE id = 20");
    await swapSeasonTeam(tx, 1, 10, 20);
    assert.deepEqual((await client.query('SELECT id, home_team_id, away_team_id, home_score, away_score FROM games ORDER BY id')).rows, [
      { id: 100, home_team_id: 20, away_team_id: 30, home_score: 5, away_score: 2 },
      { id: 101, home_team_id: 30, away_team_id: 20, home_score: 1, away_score: 3 },
      { id: 102, home_team_id: 10, away_team_id: 30, home_score: 8, away_score: 2 },
    ]);
    assert.deepEqual((await client.query('SELECT team_id, goals FROM game_player_stats ORDER BY game_id')).rows, [
      { team_id: 20, goals: 3 }, { team_id: 20, goals: 2 }, { team_id: 10, goals: 4 },
    ]);
    for (const table of ['season_player_stats', 'season_rosters', 'season_award_teams']) {
      assert.deepEqual((await client.query(`SELECT team_id FROM ${table} ORDER BY season_id`)).rows, [{ team_id: 20 }, { team_id: 10 }]);
    }
    assert.deepEqual((await client.query('SELECT high_seed_id, low_seed_id, winner_id FROM playoff_series')).rows, [
      { high_seed_id: 20, low_seed_id: 30, winner_id: 20 },
    ]);
    assert.deepEqual((await client.query('SELECT team_id, conference, division FROM season_team_conf WHERE season_id = 1')).rows, [
      { team_id: 20, conference: 'East', division: 'A' },
    ]);
    assert.deepEqual((await client.query('SELECT team_id FROM playoff_teams ORDER BY team_id')).rows, [{ team_id: 20 }, { team_id: 30 }]);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
