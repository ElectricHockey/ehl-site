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
  position:               'position',     // raw code: 0=G 1=C 2=LW 3=RW 4=LD 5=RD

  // ── Ratings ───────────────────────────────────────────────────────────────
  skrating:               'overallRating',
  skdefrating:            'defensiveRating',
  skdefensiverating:      'defensiveRating',   // fallback alternate field name
  sktprrating:            'teamPlayRating',
  sktpr:                  'teamPlayRating',     // fallback alternate field name

  // ── Skater: Scoring ───────────────────────────────────────────────────────
  skgoals:                'goals',
  skassists:              'assists',
  // points is auto-calculated as goals + assists — no EA field needed

  // ── Skater: Shooting ──────────────────────────────────────────────────────
  skshots:                'shots',

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
  skfaceoffwins:          'faceoffWins',
  skfaceoffloss:          'faceoffLosses',

  // ── Skater: Special Teams ─────────────────────────────────────────────────
  skpowerplaygoals:       'ppGoals',        // power play goals (primary)
  skppg:                  'ppGoals',        // fallback alternate field name
  skshorthandedgoals:     'shGoals',        // short-handed goals (primary)
  skshg:                  'shGoals',        // fallback alternate field name
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
  glwins:                 'goalieWins',
  gllosses:               'goalieLosses',
  glotw:                  'goalieOtw',      // overtime wins (primary)
  glotwin:                'goalieOtw',      // fallback alternate field name
  glotlosses:             'goalieOtl',      // overtime losses (primary)
  glotl:                  'goalieOtl',      // fallback alternate field name
  glsoperiod:             'shutouts',       // shutouts (primary)
  glshuts:                'shutouts',       // fallback alternate field name
  glso:                   'shutouts',       // fallback alternate field name

  // ── Goalie: Penalty Shots ─────────────────────────────────────────────────
  glpenshotatt:           'penaltyShotAttempts', // penalty shot attempts against (primary)
  glpenshot:              'penaltyShotAttempts', // fallback alternate field name
  glpengoalsa:            'penaltyShotGa',       // penalty shot goals against (primary)
  glpenshotga:            'penaltyShotGa',       // fallback alternate field name

  // ── Goalie: Breakaways ────────────────────────────────────────────────────
  glbkshotatt:            'breakawayShots', // breakaway shots against (primary)
  glbkshotsag:            'breakawayShots', // fallback alternate field name
  glbksaves:              'breakawaySaves', // breakaway saves (primary)
  glbksvs:                'breakawaySaves', // fallback alternate field name
};
