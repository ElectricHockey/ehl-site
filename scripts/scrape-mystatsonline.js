#!/usr/bin/env node
/**
 * scrape-mystatsonline.js
 *
 * Scrapes an entire league from mystatsonline.com and outputs a JSON file
 * that can be uploaded via the Admin → Import tab.
 *
 * Usage:
 *   node scripts/scrape-mystatsonline.js <IDLeague> [output-file]
 *
 * Example:
 *   node scripts/scrape-mystatsonline.js 73879
 *   node scripts/scrape-mystatsonline.js 73879 import-data.json
 *
 * The default output file is import-data.json in the current directory.
 */

'use strict';

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { URL } = require('url');

// ── CLI args ──────────────────────────────────────────────────────────────
const leagueId  = process.argv[2];
const outFile   = process.argv[3] || 'import-data.json';

if (!leagueId) {
  console.error('Usage: node scripts/scrape-mystatsonline.js <IDLeague> [output-file]');
  console.error('Example: node scripts/scrape-mystatsonline.js 73879');
  process.exit(1);
}

const BASE = 'https://www.mystatsonline.com/hockey/visitor/league';

// ── HTTP helper ───────────────────────────────────────────────────────────
function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) return reject(new Error('Too many redirects'));
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EHL-Importer/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    };
    const req = lib.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        return resolve(fetchUrl(next, redirectCount + 1));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('Request timed out')); });
    req.end();
  });
}

// ── HTML helpers ──────────────────────────────────────────────────────────
/** Extract all <option value="X">Label</option> from a <select> by its name/id. */
function parseSelectOptions(html, selectName) {
  const selectRe = new RegExp(
    `<select[^>]*(?:name|id)=["']${selectName}["'][^>]*>([\\s\\S]*?)</select>`,
    'i'
  );
  const selectMatch = html.match(selectRe);
  if (!selectMatch) return [];
  const inner = selectMatch[1];
  const opts = [];
  const optRe = /<option[^>]*value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi;
  let m;
  while ((m = optRe.exec(inner)) !== null) {
    opts.push({ value: m[1].trim(), label: stripTags(m[2]).trim() });
  }
  return opts;
}

/** Strip HTML tags and decode common HTML entities to plain text. */
function stripTags(str) {
  // First remove all HTML tags (including self-closing and multi-line)
  let text = str.replace(/<[^>]*>/g, ' ');
  // Decode common named entities
  text = text.replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"')
             .replace(/&apos;/g, "'")
             .replace(/&nbsp;/g, ' ')
             .replace(/&amp;/g, '&');
  // Remove any remaining numeric entities
  text = text.replace(/&#\d+;/g, ' ').replace(/&#x[\da-fA-F]+;/g, ' ');
  // Collapse whitespace
  return text.replace(/\s+/g, ' ').trim();
}

/** Extract all rows from a <table>; returns array of arrays of cell text. */
function parseTable(html, tableIndex = 0) {
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  const tables = [];
  let m;
  while ((m = tableRe.exec(html)) !== null) tables.push(m[0]);
  if (tableIndex >= tables.length) return [];
  const table = tables[tableIndex];
  const rows = [];
  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  let rowM;
  while ((rowM = rowRe.exec(table)) !== null) {
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells = [];
    let cellM;
    while ((cellM = cellRe.exec(rowM[0])) !== null) {
      cells.push(stripTags(cellM[1]));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/** Find a table whose header row contains all the given column names. */
function findTableByHeaders(html, ...requiredCols) {
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = tableRe.exec(html)) !== null) {
    const rows = parseTableHtml(m[0]);
    if (rows.length === 0) continue;
    const header = rows[0].map(c => c.toLowerCase());
    if (requiredCols.every(col => header.some(h => h.includes(col.toLowerCase())))) {
      return rows;
    }
  }
  return null;
}

function parseTableHtml(tableHtml) {
  const rows = [];
  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  let rowM;
  while ((rowM = rowRe.exec(tableHtml)) !== null) {
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells = [];
    let cellM;
    while ((cellM = cellRe.exec(rowM[0])) !== null) {
      cells.push(stripTags(cellM[1]));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

// ── Column index helper ───────────────────────────────────────────────────
function colIdx(headers, ...names) {
  for (const name of names) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

function num(val) {
  if (val === undefined || val === null || val === '' || val === '-') return 0;
  const n = parseFloat(val.replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ── Scraper ───────────────────────────────────────────────────────────────

async function getSeasons(html) {
  // Try common select names for season dropdown
  for (const name of ['IDSeason', 'ddlSeason', 'season', 'ddSeason']) {
    const opts = parseSelectOptions(html, name);
    if (opts.length > 0) return opts;
  }
  // Fallback: look for links with IDSeason in href
  const seasons = [];
  const re = /IDSeason=(\d+)/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      seasons.push({ value: m[1], label: `Season ${m[1]}` });
    }
  }
  return seasons;
}

async function scrapeSchedule(leagueId, seasonId) {
  const urls = [
    `${BASE}/schedule/schedule.aspx?IDLeague=${leagueId}&IDSeason=${seasonId}`,
    `${BASE}/schedule/results.aspx?IDLeague=${leagueId}&IDSeason=${seasonId}`,
    `${BASE}/home/home_hockey.aspx?IDLeague=${leagueId}&IDSeason=${seasonId}`,
  ];
  for (const url of urls) {
    try {
      const { status, body } = await fetchUrl(url);
      if (status !== 200) continue;
      const games = parseScheduleHtml(body);
      if (games.length > 0) return games;
    } catch (e) {
      // try next URL
    }
  }
  return [];
}

function parseScheduleHtml(html) {
  const games = [];
  // Look for a table with date/home/away/score columns
  const rows = findTableByHeaders(html, 'date') ||
               findTableByHeaders(html, 'home') ||
               parseTable(html, 0);
  if (!rows || rows.length < 2) return games;

  const headers = rows[0].map(h => h.toLowerCase());
  const dateIdx   = colIdx(headers, 'date', 'game date');
  const homeIdx   = colIdx(headers, 'home', 'home team');
  const awayIdx   = colIdx(headers, 'away', 'visitor', 'away team');
  const hScoreIdx = colIdx(headers, 'home score', 'h score', 'home g', 'hg');
  const aScoreIdx = colIdx(headers, 'away score', 'v score', 'visitor g', 'vg', 'ag');
  const otIdx     = colIdx(headers, 'ot', 'overtime');

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateStr = dateIdx >= 0 ? row[dateIdx] : '';
    const home    = homeIdx >= 0 ? row[homeIdx] : '';
    const away    = awayIdx >= 0 ? row[awayIdx] : '';
    if (!home || !away || !dateStr) continue;

    // Try to detect score columns if not found in headers
    let hScore = hScoreIdx >= 0 ? num(row[hScoreIdx]) : null;
    let aScore = aScoreIdx >= 0 ? num(row[aScoreIdx]) : null;

    // If scores missing, look for X-Y pattern in any cell
    if (hScore === null || aScore === null) {
      for (const cell of row) {
        const scoreMatch = cell.match(/^(\d+)\s*[-–]\s*(\d+)$/);
        if (scoreMatch) {
          hScore = parseInt(scoreMatch[1]);
          aScore = parseInt(scoreMatch[2]);
          break;
        }
      }
    }
    if (hScore === null || aScore === null) continue; // skip unplayed games

    // Normalize date to YYYY-MM-DD
    const date = normalizeDate(dateStr);
    if (!date) continue;

    const isOT = otIdx >= 0 && row[otIdx] && row[otIdx].trim() !== '' && row[otIdx] !== '0';
    games.push({ date, home_team: home.trim(), away_team: away.trim(), home_score: hScore, away_score: aScore, is_overtime: isOT });
  }
  return games;
}

function normalizeDate(str) {
  if (!str) return null;
  str = str.trim();
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // M/D/YYYY or MM/DD/YYYY
  const m1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[1].padStart(2,'0')}-${m1[2].padStart(2,'0')}`;
  // D-Mon-YYYY or Mon D, YYYY
  const months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  const m2 = str.match(/(\d{1,2})[- ]([a-zA-Z]{3})[- ](\d{4})/);
  if (m2) {
    const mo = months[m2[2].toLowerCase()];
    if (mo) return `${m2[3]}-${String(mo).padStart(2,'0')}-${m2[1].padStart(2,'0')}`;
  }
  // Mon D, YYYY
  const m3 = str.match(/([a-zA-Z]{3})\s+(\d{1,2}),?\s+(\d{4})/);
  if (m3) {
    const mo = months[m3[1].toLowerCase()];
    if (mo) return `${m3[3]}-${String(mo).padStart(2,'0')}-${m3[2].padStart(2,'0')}`;
  }
  return null;
}

async function scrapePlayerStats(leagueId, seasonId) {
  const skatUrls = [
    `${BASE}/stats/stats_hockey.aspx?IDLeague=${leagueId}&IDSeason=${seasonId}`,
    `${BASE}/stats/stats_hockey.aspx?IDLeague=${leagueId}&IDSeason=${seasonId}&type=skaters`,
    `${BASE}/stats/skater_stats.aspx?IDLeague=${leagueId}&IDSeason=${seasonId}`,
  ];
  const goalUrls = [
    `${BASE}/stats/stats_goalie.aspx?IDLeague=${leagueId}&IDSeason=${seasonId}`,
    `${BASE}/stats/goalie_stats.aspx?IDLeague=${leagueId}&IDSeason=${seasonId}`,
  ];

  const skaters = [];
  for (const url of skatUrls) {
    try {
      const { status, body } = await fetchUrl(url);
      if (status !== 200) continue;
      const rows = parseSkaterStatsHtml(body);
      if (rows.length > 0) { skaters.push(...rows); break; }
    } catch { /* try next */ }
  }

  const goalies = [];
  for (const url of goalUrls) {
    try {
      const { status, body } = await fetchUrl(url);
      if (status !== 200) continue;
      const rows = parseGoalieStatsHtml(body);
      if (rows.length > 0) { goalies.push(...rows); break; }
    } catch { /* try next */ }
  }

  return [...skaters, ...goalies];
}

function parseSkaterStatsHtml(html) {
  const stats = [];
  const rows = findTableByHeaders(html, 'player', 'g', 'a') ||
               findTableByHeaders(html, 'name', 'goals') ||
               findTableByHeaders(html, 'player', 'pts');
  if (!rows || rows.length < 2) return stats;

  const headers = rows[0].map(h => h.toLowerCase());
  const playerIdx  = colIdx(headers, 'player', 'name');
  const teamIdx    = colIdx(headers, 'team');
  const posIdx     = colIdx(headers, 'pos', 'position');
  const gpIdx      = colIdx(headers, 'gp', 'games');
  const gIdx       = colIdx(headers, 'g', 'goals');
  const aIdx       = colIdx(headers, 'a', 'assists');
  const pmIdx      = colIdx(headers, '+/-', 'plus/minus', 'plusminus');
  const pimIdx     = colIdx(headers, 'pim', 'penalties');
  const shotIdx    = colIdx(headers, 'sog', 'shots');
  const ppgIdx     = colIdx(headers, 'ppg', 'pp goals', 'pp g');
  const shgIdx     = colIdx(headers, 'shg', 'sh goals', 'sh g');
  const gwgIdx     = colIdx(headers, 'gwg', 'gw goals', 'game winning');

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const playerName = playerIdx >= 0 ? row[playerIdx] : '';
    if (!playerName || playerName.toLowerCase() === 'totals') continue;
    const pos = posIdx >= 0 ? row[posIdx].toUpperCase() : '';
    if (pos === 'G') continue; // handled separately
    stats.push({
      player_name: playerName.trim(),
      team: teamIdx >= 0 ? row[teamIdx].trim() : '',
      position: pos || 'F',
      games_played: gpIdx >= 0 ? num(row[gpIdx]) : 0,
      goals: gIdx >= 0 ? num(row[gIdx]) : 0,
      assists: aIdx >= 0 ? num(row[aIdx]) : 0,
      plus_minus: pmIdx >= 0 ? num(row[pmIdx]) : 0,
      pim: pimIdx >= 0 ? num(row[pimIdx]) : 0,
      shots: shotIdx >= 0 ? num(row[shotIdx]) : 0,
      pp_goals: ppgIdx >= 0 ? num(row[ppgIdx]) : 0,
      sh_goals: shgIdx >= 0 ? num(row[shgIdx]) : 0,
      gwg: gwgIdx >= 0 ? num(row[gwgIdx]) : 0,
    });
  }
  return stats;
}

function parseGoalieStatsHtml(html) {
  const stats = [];
  const rows = findTableByHeaders(html, 'player', 'gaa') ||
               findTableByHeaders(html, 'goalie', 'saves') ||
               findTableByHeaders(html, 'player', 'sv%');
  if (!rows || rows.length < 2) return stats;

  const headers = rows[0].map(h => h.toLowerCase());
  const playerIdx = colIdx(headers, 'player', 'name', 'goalie');
  const teamIdx   = colIdx(headers, 'team');
  const gpIdx     = colIdx(headers, 'gp', 'games');
  const wIdx      = colIdx(headers, 'w', 'wins');
  const lIdx      = colIdx(headers, 'l', 'losses');
  const gaIdx     = colIdx(headers, 'ga', 'goals against');
  const savesIdx  = colIdx(headers, 'saves', 'svs');
  const svpIdx    = colIdx(headers, 'sv%', 'save%', 'save pct');
  const gaaIdx    = colIdx(headers, 'gaa', 'goals against avg');
  const soIdx     = colIdx(headers, 'so', 'shutouts');

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const playerName = playerIdx >= 0 ? row[playerIdx] : '';
    if (!playerName || playerName.toLowerCase() === 'totals') continue;
    const svpRaw = svpIdx >= 0 ? row[svpIdx] : '';
    const svp = svpRaw ? parseFloat(svpRaw.replace('%','').trim()) / (svpRaw.includes('%') ? 100 : 1) : null;
    const gaaRaw = gaaIdx >= 0 ? row[gaaIdx] : '';
    stats.push({
      player_name: playerName.trim(),
      team: teamIdx >= 0 ? row[teamIdx].trim() : '',
      position: 'G',
      games_played: gpIdx >= 0 ? num(row[gpIdx]) : 0,
      goals: 0,
      assists: 0,
      goalie_wins: wIdx >= 0 ? num(row[wIdx]) : 0,
      goalie_losses: lIdx >= 0 ? num(row[lIdx]) : 0,
      goals_against: gaIdx >= 0 ? num(row[gaIdx]) : 0,
      saves: savesIdx >= 0 ? num(row[savesIdx]) : 0,
      save_pct: svp != null && !isNaN(svp) ? Math.round(svp * 1000) / 1000 : null,
      gaa: gaaRaw ? parseFloat(gaaRaw) || null : null,
      shutouts: soIdx >= 0 ? num(row[soIdx]) : 0,
    });
  }
  return stats;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🏒 Scraping mystatsonline.com — League ID: ${leagueId}`);
  console.log('─'.repeat(55));

  // Fetch league home page to get seasons list
  const homeUrl = `${BASE}/home/home_hockey.aspx?IDLeague=${leagueId}`;
  console.log(`Fetching league home page…`);
  let homeHtml;
  try {
    const { status, body } = await fetchUrl(homeUrl);
    if (status !== 200) throw new Error(`HTTP ${status}`);
    homeHtml = body;
  } catch (e) {
    console.error(`❌ Failed to fetch league home page: ${e.message}`);
    console.error('   Make sure the server has internet access and the league ID is correct.');
    process.exit(1);
  }

  const seasonOpts = await getSeasons(homeHtml);
  if (seasonOpts.length === 0) {
    console.error('❌ No seasons found on the league home page.');
    console.error('   The page structure may have changed. Try opening the URL manually:');
    console.error('   ' + homeUrl);
    process.exit(1);
  }

  console.log(`Found ${seasonOpts.length} season(s): ${seasonOpts.map(s => s.label).join(', ')}`);

  const output = { seasons: [] };

  for (const season of seasonOpts) {
    const seasonName = season.label.trim() || `Season ${season.value}`;
    console.log(`\n  📅 ${seasonName} (ID: ${season.value})`);

    // Games
    process.stdout.write('     → Schedule/results…');
    const games = await scrapeSchedule(leagueId, season.value);
    console.log(` ${games.length} game(s)`);

    // Player stats
    process.stdout.write('     → Player stats…');
    const playerStats = await scrapePlayerStats(leagueId, season.value);
    console.log(` ${playerStats.length} player row(s)`);

    output.seasons.push({
      name: seasonName,
      league_type: '',   // set manually in the JSON if needed ("threes" or "sixes")
      games,
      player_stats: playerStats,
    });
  }

  // Write output
  const outputPath = path.resolve(outFile);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n✅ Done! Output written to: ${outputPath}`);
  console.log(`   Total seasons: ${output.seasons.length}`);
  console.log(`   Total games:   ${output.seasons.reduce((n, s) => n + s.games.length, 0)}`);
  console.log(`   Total stat rows: ${output.seasons.reduce((n, s) => n + s.player_stats.length, 0)}`);
  console.log('\nNext steps:');
  console.log('  1. Open the JSON and set "league_type" on each season ("threes" or "sixes").');
  console.log('  2. Log in to Admin → Import tab and upload the file.');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
