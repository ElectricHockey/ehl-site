(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlayoffSeeding = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function pairWinners(teams) {
    if (!teams.length || teams.length % 2 !== 0 ||
        teams.some(t => !t || t.team_id == null || t.seed == null || !Number.isFinite(Number(t.seed)))) {
      throw new Error('An even number of winners with valid playoff seeds is required');
    }
    if (new Set(teams.map(t => String(t.team_id))).size !== teams.length) {
      throw new Error('A team cannot advance more than once in the same round');
    }
    const sorted = teams.slice().sort((a, b) => Number(a.seed) - Number(b.seed) || Number(a.team_id) - Number(b.team_id));
    return Array.from({ length: sorted.length / 2 }, (_, i) => [sorted[i], sorted[sorted.length - 1 - i]]);
  }

  return { pairWinners };
});
