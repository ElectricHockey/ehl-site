class TeamSwapError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function swapSeasonTeam(tx, seasonId, sourceId, targetId) {
  const season = await tx.prepare('SELECT id, league_type, is_playoff FROM seasons WHERE id = ? FOR UPDATE').get(seasonId);
  if (!season) throw new TeamSwapError(404, 'Season not found');
  if (season.is_playoff) throw new TeamSwapError(400, 'Select the regular season to include its playoffs.');

  const teams = await tx.prepare('SELECT id, name, league_type, conference, division FROM teams WHERE id IN (?, ?) ORDER BY id FOR UPDATE').all(sourceId, targetId);
  const source = teams.find(t => t.id === sourceId);
  const target = teams.find(t => t.id === targetId);
  if (!source || !target) throw new TeamSwapError(404, 'Team not found');
  const scope = `SELECT id FROM seasons WHERE id = ? OR parent_season_id = ?
    UNION SELECT playoff_season_id FROM playoffs WHERE season_id = ? AND playoff_season_id IS NOT NULL`;
  const brackets = 'SELECT id FROM playoffs WHERE season_id = ?';
  const occupied = await tx.prepare(`
    SELECT EXISTS (
      SELECT 1 FROM games WHERE (season_id IN (${scope}) OR playoff_series_id IN
        (SELECT id FROM playoff_series WHERE playoff_id IN (${brackets})))
        AND (home_team_id = ? OR away_team_id = ?)
      UNION ALL SELECT 1 FROM game_player_stats WHERE team_id = ? AND game_id IN
        (SELECT id FROM games WHERE season_id IN (${scope}) OR playoff_series_id IN
          (SELECT id FROM playoff_series WHERE playoff_id IN (${brackets})))
      UNION ALL SELECT 1 FROM season_player_stats WHERE season_id IN (${scope}) AND team_id = ?
      UNION ALL SELECT 1 FROM season_rosters WHERE season_id IN (${scope}) AND team_id = ?
      UNION ALL SELECT 1 FROM season_award_teams WHERE season_id IN (${scope}) AND team_id = ?
      UNION ALL SELECT 1 FROM playoff_teams WHERE playoff_id IN (${brackets}) AND team_id = ?
      UNION ALL SELECT 1 FROM playoff_series WHERE playoff_id IN (${brackets})
        AND (high_seed_id = ? OR low_seed_id = ? OR winner_id = ?)
    ) AS present
  `);
  const occupancy = id => occupied.get(
    seasonId, seasonId, seasonId, seasonId, id, id,
    id, seasonId, seasonId, seasonId, seasonId,
    seasonId, seasonId, seasonId, id,
    seasonId, seasonId, seasonId, id,
    seasonId, seasonId, seasonId, id,
    seasonId, id, seasonId, id, id, id
  );
  const sourcePresent = await occupancy(sourceId);
  const sourceAssignment = await tx.prepare('SELECT id FROM season_team_conf WHERE season_id = ? AND team_id = ?').get(seasonId, sourceId);
  if (!sourcePresent.present && !sourceAssignment) throw new TeamSwapError(400, 'The source team is not in this season.');
  if ((await occupancy(targetId)).present) {
    throw new TeamSwapError(409, 'The replacement team already has games, stats, a roster, or playoff entries in this season.');
  }

  const ids = await tx.prepare(`${scope}`).all(seasonId, seasonId, seasonId);
  const seasonIds = ids.map(row => row.id);
  const playoffIds = (await tx.prepare(`SELECT id FROM playoffs WHERE season_id = ?`).all(seasonId)).map(row => row.id);
  const gameScope = 'SELECT id FROM games WHERE season_id = ANY(?) OR playoff_series_id IN (SELECT id FROM playoff_series WHERE playoff_id = ANY(?))';
  await tx.prepare(`UPDATE game_player_stats SET team_id = ? WHERE team_id = ? AND game_id IN (${gameScope})`).run(targetId, sourceId, seasonIds, playoffIds);
  await tx.prepare(`UPDATE games SET home_team_id = ? WHERE home_team_id = ? AND id IN (${gameScope})`).run(targetId, sourceId, seasonIds, playoffIds);
  await tx.prepare(`UPDATE games SET away_team_id = ? WHERE away_team_id = ? AND id IN (${gameScope})`).run(targetId, sourceId, seasonIds, playoffIds);
  for (const table of ['season_player_stats', 'season_rosters', 'season_award_teams']) {
    await tx.prepare(`UPDATE ${table} SET team_id = ? WHERE team_id = ? AND season_id = ANY(?)`).run(targetId, sourceId, seasonIds);
  }
  await tx.prepare('DELETE FROM season_team_conf WHERE team_id = ? AND season_id = ANY(?)').run(targetId, seasonIds);
  await tx.prepare('UPDATE season_team_conf SET team_id = ? WHERE team_id = ? AND season_id = ANY(?)').run(targetId, sourceId, seasonIds);
  if (!sourceAssignment) {
    await tx.prepare('INSERT INTO season_team_conf (season_id, team_id, conference, division) VALUES (?, ?, ?, ?)').run(seasonId, targetId, source.conference || '', source.division || '');
  }
  await tx.prepare('UPDATE playoff_teams SET team_id = ? WHERE team_id = ? AND playoff_id = ANY(?)').run(targetId, sourceId, playoffIds);
  for (const column of ['high_seed_id', 'low_seed_id', 'winner_id']) {
    await tx.prepare(`UPDATE playoff_series SET ${column} = ? WHERE ${column} = ? AND playoff_id = ANY(?)`).run(targetId, sourceId, playoffIds);
  }
}

module.exports = { swapSeasonTeam, TeamSwapError };
