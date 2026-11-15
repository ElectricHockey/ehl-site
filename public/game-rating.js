(function (root, factory) {
  const rating = factory();
  if (typeof module === 'object' && module.exports) module.exports = rating;
  else root.GameRating = rating;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const js = {
    add: (...v) => v.reduce((a, b) => a + b, 0),
    sub: (a, b) => a - b,
    mul: (a, b) => a * b,
    div: (a, b) => a / b,
    min: (a, b) => Math.min(a, b),
    max: (a, b) => Math.max(a, b),
    shutout: (ga, sa) => ga === 0 && sa >= 10 ? 4 : 0,
  };
  const sql = {
    add: (...v) => `(${v.join(' + ')})`,
    sub: (a, b) => `(${a} - ${b})`,
    mul: (a, b) => `(${a} * ${b})`,
    div: (a, b) => `(${a} / ${b})`,
    min: (a, b) => `LEAST(${a}, ${b})`,
    max: (a, b) => `GREATEST(${a}, ${b})`,
    shutout: (ga, sa) => `(CASE WHEN ${ga} = 0 AND ${sa} >= 10 THEN 4 ELSE 0 END)`,
  };

  function skater(f, op) {
    const { add, sub, mul, min, max } = op;
    return sub(add(56,
      min(mul(f.goals, 4.5), 18),
      min(mul(f.assists, 3), 12),
      max(-6, min(mul(f.plus_minus, 1.2), 6)),
      min(mul(f.shots, 0.35), 3),
      min(mul(f.hits, 0.25), 3),
      min(mul(f.blocked_shots, 0.8), 4),
      min(mul(f.takeaways, 0.6), 3)
    ), add(min(mul(f.giveaways, 0.35), 5), min(mul(f.pim, 0.35), 4)));
  }

  function goalie(f, op) {
    const { add, sub, mul, div, min, max, shutout } = op;
    const percentage = min(1, div(f.saves, max(1, f.shots_against)));
    return sub(add(70, min(mul(f.saves, 0.5), 12),
      max(-10, min(mul(sub(percentage, 0.7), 55), 15)),
      shutout(f.goals_against, f.shots_against)), min(mul(f.goals_against, 1.2), 8));
  }

  const fields = ['goals', 'assists', 'plus_minus', 'shots', 'hits', 'blocked_shots',
    'takeaways', 'giveaways', 'pim', 'saves', 'shots_against', 'goals_against'];

  function calculate(player) {
    const data = {};
    for (const field of fields) {
      const camel = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const value = Number(player[field] ?? player[camel]);
      data[field] = Number.isFinite(value) ? value : 0;
    }
    const isGoalie = /^(g|goalie)$/i.test(player.position || '');
    if (isGoalie && data.shots_against <= 0) return null;
    const value = isGoalie ? goalie(data, js) : skater(data, js);
    return Math.round(Math.round(Math.max(0, Math.min(99, value)) * 1000000) / 1000000);
  }

  function sqlExpression(alias, isGoalie) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid SQL alias');
    const data = Object.fromEntries(fields.map(field => [field, `COALESCE(${alias}.${field}, 0)::numeric`]));
    const value = isGoalie ? goalie(data, sql) : skater(data, sql);
    const rounded = `ROUND(ROUND(GREATEST(0, LEAST(99, ${value})), 6))`;
    return isGoalie ? `(CASE WHEN ${data.shots_against} > 0 THEN ${rounded} ELSE NULL END)` : rounded;
  }

  return { calculate, sqlExpression };
});
