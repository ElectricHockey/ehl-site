// ══════════════════════════════════════════════════════════════════════
// STATS COLUMN CONFIGURATION
// ══════════════════════════════════════════════════════════════════════
//
// This single file controls which stat columns appear in the Skaters
// and Goalies tables on EVERY page (Stats, Team, and Player pages).
//
// HOW TO EDIT:
//   Remove a column  →  Comment out its line with //
//   Add a column     →  Add a new entry (key must exist in the API)
//   Reorder columns  →  Move lines up or down in the array
//   Rename a column  →  Change the "label" or "tip" value
//
// COLUMN FIELDS:
//   key    – the data field name from the server API  (do not change)
//   label  – short text shown in the table header
//   tip    – full description shown when hovering the header
//   fmt    – function(player) → cell content string (HTML is allowed)
//   style  – (optional) function(player) → inline CSS string for the cell
//
// ══════════════════════════════════════════════════════════════════════

// ── Shared formatting helpers ──────────────────────────────────────────────
// These are used by the column definitions below.
// You can also call them in any custom fmt / style function you add.

function pct3(v) {
  if (v === null || v === undefined) return '–';
  const frac = v > 1 ? v / 100 : v;
  return frac.toFixed(3).replace(/^0(?=\.)/, '');
}

function fmtPct(v) {
  return v !== null && v !== undefined ? Number(v).toFixed(1) + '%' : '–';
}

function fmt1(v) {
  return v !== null && v !== undefined ? Number(v).toFixed(1) : '–';
}

function formatToi(s) {
  if (!s) return '0:00';
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function computeOvr(p) {
  const vals = [p.offensive_rating, p.defensive_rating, p.team_play_rating]
    .map(Number).filter(v => v > 0);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

function ratingStyle(v) {
  if (!v || v <= 0) return 'color:#484f58;';
  if (v >= 90) return 'background:rgba(35,134,54,0.35);color:#2ea043;font-weight:700;';
  if (v >= 80) return 'background:rgba(35,134,54,0.28);color:#3fb950;font-weight:700;';
  if (v >= 70) return 'background:rgba(46,160,67,0.18);color:#56d364;font-weight:600;';
  if (v >= 60) return 'background:rgba(158,106,3,0.22);color:#e3b341;font-weight:600;';
  if (v >= 50) return 'background:rgba(188,76,0,0.22);color:#f0883e;';
  return 'background:rgba(248,81,73,0.18);color:#f85149;';
}

function ovrStyle(v) {
  return ratingStyle(v) + 'outline:1px solid currentColor;border-radius:3px;';
}

// ── Skater column definitions ──────────────────────────────────────────────
// Edit this array to control which columns appear in skater stat tables.

const SKATER_COLS = [
  // ── Ratings ─────────────────────────────────────────────────────────────
  { key: '_ovr',             label: 'OVR',  tip: 'Overall Rating (avg. of OFFR + DR + TPR)', fmt: p => p._ovr ?? '–',                                                            style: p => 'text-align:center;' + ovrStyle(p._ovr) },
  { key: 'offensive_rating', label: 'OFFR', tip: 'Offense Rating',                           fmt: p => p.offensive_rating || '–',                                                style: p => 'text-align:center;' + ratingStyle(p.offensive_rating) },
  { key: 'defensive_rating', label: 'DR',   tip: 'Defense Rating',                           fmt: p => p.defensive_rating || '–',                                                style: p => 'text-align:center;' + ratingStyle(p.defensive_rating) },
  { key: 'team_play_rating', label: 'TPR',  tip: 'Team Play Rating',                         fmt: p => p.team_play_rating || '–',                                                style: p => 'text-align:center;' + ratingStyle(p.team_play_rating) },
  // ── Games ────────────────────────────────────────────────────────────────
  { key: 'gp',              label: 'GP',   tip: 'Games Played',                            fmt: p => p.gp },
  // ── Scoring ──────────────────────────────────────────────────────────────
  { key: 'goals',           label: 'G',    tip: 'Goals',                                   fmt: p => p.goals || 0 },
  { key: 'assists',         label: 'A',    tip: 'Assists',                                 fmt: p => p.assists || 0 },
  { key: 'points',          label: 'PTS',  tip: 'Points',                                  fmt: p => `<strong>${p.points || 0}</strong>` },
  { key: 'plus_minus',      label: '+/-',  tip: 'Plus / Minus',                            fmt: p => `${(p.plus_minus || 0) >= 0 ? '+' : ''}${p.plus_minus || 0}` },
  // ── Skating / Physical ───────────────────────────────────────────────────
  { key: 'shots',           label: 'SOG',  tip: 'Shots on Goal',                           fmt: p => p.shots || 0 },
  { key: 'shot_attempts',   label: 'SA',   tip: 'Shot Attempts',                           fmt: p => p.shot_attempts || 0 },
  { key: 'hits',            label: 'HITS', tip: 'Hits',                                   fmt: p => p.hits || 0 },
  { key: 'blocked_shots',   label: 'BS',   tip: 'Blocked Shots',                           fmt: p => p.blocked_shots || 0 },
  { key: 'takeaways',       label: 'TKA',  tip: 'Takeaways',                               fmt: p => p.takeaways || 0 },
  { key: 'giveaways',       label: 'GVA',  tip: 'Giveaways',                               fmt: p => p.giveaways || 0 },
  // ── Special Teams ────────────────────────────────────────────────────────
  { key: 'pp_goals',        label: 'PPG',  tip: 'Power Play Goals',                        fmt: p => p.pp_goals || 0 },
  { key: 'sh_goals',        label: 'SHG',  tip: 'Short-Hand Goals',                        fmt: p => p.sh_goals || 0 },
  { key: 'gwg',             label: 'GWG',  tip: 'Game-Winning Goals',                      fmt: p => p.gwg || 0 },
  // ── Discipline ───────────────────────────────────────────────────────────
  { key: 'pim',             label: 'PIM',  tip: 'Penalty Minutes',                         fmt: p => p.pim || 0 },
  { key: 'penalties_drawn', label: 'PD',   tip: 'Penalties Drawn',                         fmt: p => p.penalties_drawn || 0 },
  // ── Faceoffs ─────────────────────────────────────────────────────────────
  { key: 'faceoff_wins',    label: 'FOW',  tip: 'Faceoff Wins',                            fmt: p => p.faceoff_wins || 0 },
  { key: 'faceoff_total',   label: 'FOT',  tip: 'Faceoff Total',                           fmt: p => p.faceoff_total || 0 },
  { key: 'fow_pct',         label: 'FOW%', tip: 'Faceoff Win %',                           fmt: p => fmtPct(p.fow_pct) },
  // ── Shooting ─────────────────────────────────────────────────────────────
  { key: 'shot_pct',        label: 'S%',   tip: 'Shooting %',                              fmt: p => fmtPct(p.shot_pct) },
  // ── Advanced ─────────────────────────────────────────────────────────────
  { key: 'deflections',     label: 'DLF',  tip: 'Deflections',                             fmt: p => p.deflections || 0 },
  { key: 'interceptions',   label: 'INT',  tip: 'Interceptions',                           fmt: p => p.interceptions || 0 },
  { key: 'pass_attempts',   label: 'PA',   tip: 'Pass Attempts',                           fmt: p => p.pass_attempts || 0 },
  { key: 'pass_pct_calc',   label: 'PC%',  tip: 'Pass Completion %',                       fmt: p => p.pass_pct_calc != null ? fmt1(p.pass_pct_calc) + '%' : '–' },
  { key: 'hat_tricks',      label: 'HT',   tip: 'Hat Tricks',                              fmt: p => p.hat_tricks || 0 },
  { key: 'apt',             label: 'APT',  tip: 'Avg. Puck Possession (sec/game)',         fmt: p => formatToi(p.apt) },
  { key: 'toi',             label: 'TOI',  tip: 'Time on Ice',                             fmt: p => formatToi(p.toi) },
];

// ── Goalie column definitions ──────────────────────────────────────────────
// Edit this array to control which columns appear in goalie stat tables.

const GOALIE_COLS = [
  // ── Ratings ─────────────────────────────────────────────────────────────
  { key: '_ovr',                 label: 'OVR',  tip: 'Overall Rating (avg. of OFFR + DR + TPR)', fmt: p => p._ovr ?? '–',                                       style: p => 'text-align:center;' + ovrStyle(p._ovr) },
  { key: 'offensive_rating',     label: 'OFFR', tip: 'Offense Rating',                           fmt: p => p.offensive_rating || '–',                           style: p => 'text-align:center;' + ratingStyle(p.offensive_rating) },
  { key: 'defensive_rating',     label: 'DR',   tip: 'Defense Rating',                           fmt: p => p.defensive_rating || '–',                           style: p => 'text-align:center;' + ratingStyle(p.defensive_rating) },
  { key: 'team_play_rating',     label: 'TPR',  tip: 'Team Play Rating',                         fmt: p => p.team_play_rating || '–',                           style: p => 'text-align:center;' + ratingStyle(p.team_play_rating) },
  // ── Games ────────────────────────────────────────────────────────────────
  { key: 'gp',                   label: 'GP',   tip: 'Games Played',                            fmt: p => p.gp },
  // ── Scoring ──────────────────────────────────────────────────────────────
  { key: 'goals',                label: 'G',    tip: 'Goals',                                   fmt: p => p.goals || 0 },
  { key: 'assists',              label: 'A',    tip: 'Assists',                                 fmt: p => p.assists || 0 },
  // ── Goalie Core ──────────────────────────────────────────────────────────
  { key: 'shots_against',        label: 'SA',   tip: 'Shots Against',                           fmt: p => p.shots_against || 0 },
  { key: 'goals_against',        label: 'GA',   tip: 'Goals Against',                           fmt: p => p.goals_against || 0 },
  { key: 'save_pct',             label: 'SV%',  tip: 'Save Percentage',                         fmt: p => `<strong>${pct3(p.save_pct)}</strong>` },
  { key: 'gaa',                  label: 'GAA',  tip: 'Goals Against Average',                   fmt: p => p.gaa != null ? Number(p.gaa).toFixed(2) : '–' },
  { key: 'toi',                  label: 'TOI',  tip: 'Time on Ice',                             fmt: p => formatToi(p.toi) },
  { key: 'shutouts',             label: 'SO',   tip: 'Shutouts',                                fmt: p => p.shutouts || 0 },
  // ── Penalty Shots ────────────────────────────────────────────────────────
  { key: 'penalty_shot_attempts',label: 'PSA',  tip: 'Penalty Shot Attempts Against',           fmt: p => p.penalty_shot_attempts || 0 },
  { key: 'penalty_shot_ga',      label: 'PSGA', tip: 'Penalty Shot Goals Against',              fmt: p => p.penalty_shot_ga || 0 },
  // ── Breakaways ───────────────────────────────────────────────────────────
  { key: 'breakaway_shots',      label: 'BKSA', tip: 'Breakaway Shots Against',                 fmt: p => p.breakaway_shots || 0 },
  { key: 'breakaway_saves',      label: 'BKSV', tip: 'Breakaway Saves',                         fmt: p => p.breakaway_saves || 0 },
  // ── Win/Loss ─────────────────────────────────────────────────────────────
  { key: 'goalie_wins',          label: 'W',    tip: 'Wins',                                  fmt: p => p.goalie_wins || 0 },
  { key: 'goalie_losses',        label: 'L',    tip: 'Losses',                                  fmt: p => p.goalie_losses || 0 },
  { key: 'goalie_otw',           label: 'OTW',  tip: 'Overtime Wins',                           fmt: p => p.goalie_otw || 0 },
  { key: 'goalie_otl',           label: 'OTL',  tip: 'Overtime Losses',                         fmt: p => p.goalie_otl || 0 },
];
