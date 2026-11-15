function gameWinnerSide(game) {
  if ((game.status === 'forfeit' || game.is_forfeit) && ['home', 'away'].includes(game.forfeit_winner)) {
    return game.forfeit_winner;
  }
  return game.home_score > game.away_score ? 'home' : game.away_score > game.home_score ? 'away' : null;
}
