// ══════════════════════════════════════════════════════════════════════════
// EA PRO CLUBS API → EHL STATS FIELD MAPPING
// ══════════════════════════════════════════════════════════════════════════
//
// This file controls which EA API fields are used to fill each EHL stat.
// Edit it any time EA changes their API, or if you want to remap a stat
// to a different source field.
//
// HOW TO SEE WHAT FIELDS EA RETURNS FOR YOUR CLUB:
//   Open this URL in your browser (replace the clubId number):
//   https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=common-gen5&clubIds=6021
//
//   Inside the JSON, navigate to:
//     [0].players.<playerName>.*
//   Those keys are the available EA field names you can use here.
//
// HOW TO EDIT:
//   • Each entry is:  ehlStat: 'ea_field_name'
//   • For fallback fields (try first, fall back if missing/zero):
//     ehlStat: ['primary_ea_field', 'fallback_ea_field', ...]
//   • To stop tracking a stat, set its value to null:
//     gwg: null
//
// ══════════════════════════════════════════════════════════════════════════

module.exports = {

  // ── Player identity ────────────────────────────────────────────────────────
  playerName: ['playername', 'name'],      // Display name
  position:   'position',                  // Raw code; converted via EA_POSITIONS in server.js

  // ── Ratings ───────────────────────────────────────────────────────────────
  overallRating:   'skrating',
  defensiveRating: ['skdefrating', 'skdefensiverating'],
  teamPlayRating:  ['sktprrating', 'sktpr'],

  // ── Skater: Scoring ───────────────────────────────────────────────────────
  goals:   'skgoals',
  assists: 'skassists',
  // points is auto-calculated as goals + assists — no EA field needed

  // ── Skater: Shooting ──────────────────────────────────────────────────────
  shots: 'skshots',

  // ── Skater: Physical ──────────────────────────────────────────────────────
  hits:         'skhits',
  plusMinus:    'skplusmin',
  pim:          'skpim',          // Penalty minutes
  blockedShots: 'skbs',
  takeaways:    'sktakeaways',
  giveaways:    'skgiveaways',

  // ── Skater: Time / Possession ─────────────────────────────────────────────
  toi:            ['toiseconds', 'skToi'],   // Time on ice (seconds)
  possessionSecs: 'skpossession',            // Puck possession (seconds)

  // ── Skater: Passing ───────────────────────────────────────────────────────
  passAttempts: 'skpassattempts',
  // passPct is used to compute passCompletions = passAttempts * passPct / 100
  passPct:      'skpasspct',

  // ── Skater: Faceoffs ──────────────────────────────────────────────────────
  faceoffWins:   'skfaceoffwins',
  faceoffLosses: 'skfaceoffloss',

  // ── Skater: Special Teams ─────────────────────────────────────────────────
  ppGoals: ['skpowerplaygoals', 'skppg'],    // Power play goals
  shGoals: ['skshorthandedgoals', 'skshg'], // Short-handed goals
  gwg:     'skgwg',                          // Game-winning goals

  // ── Skater: Discipline ────────────────────────────────────────────────────
  penaltiesDrawn: ['skpenaltiesdrawn', 'skpd'],

  // ── Skater: Advanced ──────────────────────────────────────────────────────
  deflections:   ['skdeflections', 'skdfl'],
  interceptions: ['skinterceptions', 'skint'],
  hatTricks:     ['skhattricks', 'skht'],

  // ── Goalie: Core ──────────────────────────────────────────────────────────
  saves:        'glsaves',
  savesPct:     'glsavePct',     // Save percentage (used as fallback; SV% is recalculated from saves/shotsAgainst)
  goalsAgainst: 'glga',
  shotsAgainst: 'glshots',

  // ── Goalie: Win/Loss ──────────────────────────────────────────────────────
  goalieWins:   'glwins',
  goalieLosses: 'gllosses',
  goalieOtw:    ['glotw', 'glotwin'],
  goalieOtl:    ['glotlosses', 'glotl'],
  shutouts:     ['glsoperiod', 'glshuts', 'glso'],

  // ── Goalie: Penalty Shots ─────────────────────────────────────────────────
  penaltyShotAttempts: ['glpenshotatt', 'glpenshot'],
  penaltyShotGa:       ['glpengoalsa', 'glpenshotga'],

  // ── Goalie: Breakaways ────────────────────────────────────────────────────
  breakawayShots: ['glbkshotatt', 'glbkshotsag'],
  breakawaySaves: ['glbksaves', 'glbksvs'],
};
