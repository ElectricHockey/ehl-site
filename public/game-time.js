(function (root) {
  const eastern = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const pad = n => String(n).padStart(2, '0');
  function easternParts(date) {
    const parts = {};
    for (const p of eastern.formatToParts(date)) if (p.type !== 'literal') parts[p.type] = p.value;
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  }
  function localParts(date) {
    return {
      date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    };
  }
  function easternInstant(date, time) {
    const wall = Date.parse(`${date}T${time}:00Z`);
    if (!Number.isFinite(wall)) throw new Error('Invalid game date or time');
    let ts = wall;
    for (let i = 0; i < 3; i++) {
      const parts = easternParts(new Date(ts));
      ts += wall - Date.parse(`${parts.date}T${parts.time}:00Z`);
    }
    const check = easternParts(new Date(ts));
    if (check.date !== date || check.time !== time) throw new Error('Game time does not exist in Eastern time');
    return ts;
  }
  function toLocal(date, time) {
    if (!time) return { date, time: '' };
    return localParts(new Date(easternInstant(date, time)));
  }
  function toEastern(date, time) {
    if (!time) return { date, time: null };
    const local = new Date(`${date}T${time}:00`);
    if (!Number.isFinite(local.getTime())) throw new Error('Invalid game date or time');
    const check = localParts(local);
    if (check.date !== date || check.time !== time) throw new Error('That local time does not exist due to a daylight saving time change');
    for (const offset of [-7200000, -3600000, 3600000, 7200000]) {
      const other = localParts(new Date(local.getTime() + offset));
      if (other.date === date && other.time === time) throw new Error('That time is ambiguous due to a daylight saving time change');
    }
    const result = easternParts(local);
    if (easternInstant(result.date, result.time) !== local.getTime()) {
      throw new Error('That time is ambiguous due to a daylight saving time change');
    }
    return result;
  }
  const api = { toLocal, toEastern, localParts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GameTime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
