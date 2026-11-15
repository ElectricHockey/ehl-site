(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.eaPenaltyShotStats = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return function eaPenaltyShotStats(player) {
    const read = key => {
      const actual = Object.keys(player).find(k => k.toLowerCase() === key.toLowerCase());
      const value = actual === undefined ? undefined : player[actual];
      return value === null || value === '' ? undefined : value;
    };
    const explicitAttempts = read('penaltyShotAttempts');
    const explicitGoals = read('penaltyShotGa');
    const rawAttempts = read('glpenshots');
    const rawSaves = read('glpensaves');
    const attemptsValue = explicitAttempts === undefined ? rawAttempts : explicitAttempts;
    if (attemptsValue === undefined && explicitGoals === undefined && rawSaves === undefined) {
      return { attempts: 0, goalsAgainst: 0 };
    }
    const attempts = Number(attemptsValue);
    const saves = Number(rawSaves);
    const goalsAgainst = explicitGoals === undefined ? attempts - saves : Number(explicitGoals);
    if (attemptsValue === undefined || (explicitGoals === undefined && rawSaves === undefined) ||
        !Number.isInteger(attempts) || !Number.isInteger(goalsAgainst) ||
        attempts < 0 || goalsAgainst < 0 || goalsAgainst > attempts ||
        (explicitGoals === undefined && (!Number.isInteger(saves) || saves < 0))) {
      throw new Error('Invalid EA penalty-shot attempts or saves');
    }
    return { attempts, goalsAgainst };
  };
});
