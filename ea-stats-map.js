// ══════════════════════════════════════════════════════════════════════════
// EA PRO CLUBS API → EHL STATS FIELD MAPPING
// ══════════════════════════════════════════════════════════════════════════
//
// Each line maps one EA API field name (left) to an EHL database column (right).
//
// HOW TO CHECK / UPDATE A FIELD:
//   1. Open the EA API URL in your browser:
//      https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=common-gen5&clubIds=6021
//   2. In the JSON, look under: [0].players.<playerName>
//      The property names shown there are the EA field names used on the LEFT below.
//   3. Find the line you want to change and update the EA field name on the left,
//      or the EHL column name on the right.
//
// MULTIPLE EA FIELDS FOR THE SAME STAT:
//   EA sometimes renames fields between game versions. When two lines share the
//   same EHL column name, the first one found in the API response is used —
//   the others act as fallbacks.
//   Example: both 'skdefrating' and 'skdefensiverating' map to 'defensiveRating'.
//
// TO DISABLE A STAT:
//   Comment out its line(s) with //
//
// ══════════════════════════════════════════════════════════════════════════
//
//  EA API field name          EHL column name
//  ─────────────────────────  ────────────────────────────────────────────

module.exports = {

  // ── Player identity ────────────────────────────────────────────────────────
  playername:             'playerName',   // display name (primary field)
  name:                   'playerName',   // fallback if 'playername' is absent
  position:               'position',     // string: goalie|center|leftWing|rightWing|defenseMen
  // posSorted: "1"=RD, "2"=LD for defenseMen — read directly in mapEAPlayer, not via eaField

  // ── Ratings ───────────────────────────────────────────────────────────────
  skrating:               'overallRating',
  ratingOffense:          'offensiveRating',  // offense rating (primary EA field name)
  // Fallbacks: eaField() tries each mapped key in insertion order and uses the first
  // one that is present in the EA API response, so these only apply when ratingOffense
  // is absent (e.g. if EA renames the field in a future game version).
  skoffrating:            'offensiveRating',  // fallback: alternate field name
  skoffensiverating:      'offensiveRating',  // fallback: alternate field name
  ratingDefense:          'defensiveRating',
  ratingTeamplay:         'teamPlayRating',

  // ── Skater: Scoring ───────────────────────────────────────────────────────
  skgoals:                'goals',
  skassists:              'assists',
  // points is auto-calculated as goals + assists — no EA field needed

  // ── Skater: Shooting ──────────────────────────────────────────────────────
  skshots:                'shots',
  skshotattempts:         'shotAttempts',   // shot attempts (corsi)

  // ── Skater: Physical ──────────────────────────────────────────────────────
  skhits:                 'hits',
  skplusmin:              'plusMinus',
  skpim:                  'pim',            // penalty minutes
  skbs:                   'blockedShots',
  sktakeaways:            'takeaways',
  skgiveaways:            'giveaways',

  // ── Skater: Time / Possession ─────────────────────────────────────────────
  toiseconds:             'toi',            // time on ice in seconds (primary)
  skToi:                  'toi',            // fallback alternate field name
  skpossession:           'possessionSecs', // puck possession in seconds

  // ── Skater: Passing ───────────────────────────────────────────────────────
  skpassattempts:         'passAttempts',
  skpasspct:              'passPct',        // pass completion %; used to derive passCompletions

  // ── Skater: Faceoffs ──────────────────────────────────────────────────────
  skfow:                  'faceoffWins',
  skfol:                  'faceoffLosses',

  // ── Skater: Special Teams ─────────────────────────────────────────────────
  skppg:                  'ppGoals',        // power play goals
  skshg:                  'shGoals',        // short-handed goals
  skgwg:                  'gwg',            // game-winning goals

  // ── Skater: Discipline ────────────────────────────────────────────────────
  skpenaltiesdrawn:       'penaltiesDrawn', // penalties drawn (primary)
  skpd:                   'penaltiesDrawn', // fallback alternate field name

  // ── Skater: Advanced ──────────────────────────────────────────────────────
  skdeflections:          'deflections',    // (primary)
  skdfl:                  'deflections',    // fallback alternate field name
  skinterceptions:        'interceptions',  // (primary)
  skint:                  'interceptions',  // fallback alternate field name
  skhattricks:            'hatTricks',      // (primary)
  skht:                   'hatTricks',      // fallback alternate field name

  // ── Goalie: Core ──────────────────────────────────────────────────────────
  glsaves:                'saves',
  glsavePct:              'savesPct',       // raw SV%; server recalculates from saves/shotsAgainst
  glga:                   'goalsAgainst',
  glshots:                'shotsAgainst',

  // ── Goalie: Win/Loss ──────────────────────────────────────────────────────
  // NOTE: goalieWins, goalieLosses, goalieOtw, goalieOtl, and shutouts are
  // calculated server-side from the game outcome — NOT imported from EA.

  // ── Goalie: Penalty Shots ─────────────────────────────────────────────────
  glpenshots:             'penaltyShotAttempts', // penalty shot attempts against
  glpensaves:             'penaltyShotGa',       // penalty shot goals against (EA field is named glpensaves)

  // ── Goalie: Breakaways ────────────────────────────────────────────────────
  glbrkshots:             'breakawayShots', // breakaway shots against
  glbrksaves:             'breakawaySaves', // breakaway saves

  // ── Skater: Saucer Passes ─────────────────────────────────────────────────
  sksaucerpasses:         'saucerPasses',   // saucer passes

  // ── Skater: PK Clears ────────────────────────────────────────────────────
  skpkclearzone:          'pkClears',       // penalty kill clears

  // ── Goalie: Desperation Saves ─────────────────────────────────────────────
  gldsaves:               'desperationSaves', // desperation saves

  // ── Goalie: Poke Check Saves ──────────────────────────────────────────────
  glpokechecks:           'pokeCheckSaves',   // poke check saves
};
