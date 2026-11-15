'use strict';

// Default slots (Eastern). 3's: Mon games 1-3, Thu games 4-7. 6's: Tue games 1-3, Wed games 4-7.
// weekday: 0 = Sunday … 6 = Saturday
const TIMES = ['21:00', '21:35', '22:10', '21:00', '21:35', '22:10', '22:45'];
const slotsFor = days => TIMES.map((time, i) => ({ weekday: days[i], time }));
const DEFAULT_SERIES_SLOTS = slotsFor([1, 1, 1, 4, 4, 4, 4]);
const DEFAULT_SIXES_SLOTS = slotsFor([2, 2, 2, 3, 3, 3, 3]);

function normalizeSlots(slots, league) {
  const clean = (Array.isArray(slots) ? slots : [])
    .map(s => ({ weekday: Number(s && s.weekday), time: String((s && s.time) || '') }))
    .filter(s => Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6 && /^\d{2}:\d{2}$/.test(s.time));
  if (clean.length) return clean;
  return league === 'sixes' ? DEFAULT_SIXES_SLOTS : DEFAULT_SERIES_SLOTS;
}

/**
 * Returns [{ date: 'YYYY-MM-DD', time: 'HH:MM' }] for each game of a series.
 * Game i uses slot i; when the slots run out the weekly cycle repeats one week later.
 * Each game lands on the first matching weekday on/after the previous game's date
 * (the first game on/after startDate).
 */
function buildSeriesGameSlots(startDate, seriesLength, slots) {
  const list = normalizeSlots(slots);
  const out = [];
  let cursor = new Date(startDate + 'T00:00:00Z');
  for (let i = 0; i < seriesLength; i++) {
    const slot = list[i % list.length];
    if (i > 0 && i % list.length === 0) cursor.setUTCDate(cursor.getUTCDate() + 1);
    const diff = (slot.weekday - cursor.getUTCDay() + 7) % 7;
    cursor = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + diff);
    out.push({ date: cursor.toISOString().slice(0, 10), time: slot.time });
  }
  return out;
}

module.exports = { DEFAULT_SERIES_SLOTS, normalizeSlots, buildSeriesGameSlots };
