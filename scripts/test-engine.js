#!/usr/bin/env node
/* Cross-checks the pruning solver against brute force on tiny boards. */
'use strict';
const A = require('../src/engine.js');

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

// Brute force: try every assignment of the inventory to free cells.
function brute(w, h, givens, inventory, hidden) {
  const N = w * h;
  const board = new Array(N).fill(null);
  const fixed = new Array(N).fill(false);
  for (const [i, p] of givens) { board[i] = p; fixed[i] = true; }
  const rem = Object.assign({}, inventory);
  const kinds = Object.keys(rem);
  let found = 0;
  (function rec(i) {
    if (i === N) {
      if (kinds.every((k) => rem[k] === 0) && A.violations(board, w, h, hidden).length === 0) found++;
      return;
    }
    if (fixed[i]) return rec(i + 1);
    rec(i + 1);
    for (const k of kinds) {
      if (rem[k] > 0) { rem[k]--; board[i] = k; rec(i + 1); board[i] = null; rem[k]++; }
    }
  })(0);
  return found;
}

const cases = [
  { name: '3x3 five loners', w: 3, h: 3, givens: [], inv: { L: 5 } },
  { name: '3x3 loners + twins', w: 3, h: 3, givens: [], inv: { L: 2, T: 2 } },
  { name: '3x3 tribe + loner', w: 3, h: 3, givens: [], inv: { S: 3, L: 2 } },
  { name: '3x3 mirrors', w: 3, h: 3, givens: [], inv: { M: 4, L: 1 } },
  { name: '4x3 mirrors + twins', w: 4, h: 3, givens: [], inv: { M: 2, T: 2 } },
  { name: '3x3 counters', w: 3, h: 3, givens: [], inv: { C2: 2, L: 2 } },
  { name: '3x3 counters+given', w: 3, h: 3, givens: [[4, 'C2']], inv: { C1: 1, L: 1 } },
  { name: '4x3 mixed', w: 4, h: 3, givens: [[0, 'L']], inv: { T: 2, S: 2, M: 2 } },
  { name: '3x3 mystery alone_in_row', w: 3, h: 3, givens: [], inv: { Q: 1, L: 2, S: 1 }, hidden: 'alone_in_row' },
  { name: '3x3 mystery row_balance', w: 3, h: 3, givens: [], inv: { Q: 2, L: 1, M: 2 }, hidden: 'row_balance' }
];

for (const c of cases) {
  const b = brute(c.w, c.h, c.givens, c.inv, c.hidden || null);
  const s = A.search({ w: c.w, h: c.h, givens: c.givens, inventory: c.inv, hidden: c.hidden || null, limit: 1e9 });
  check(c.name + ' (' + b + ' solutions)', !s.aborted && s.solutions.length === b, 'brute=' + b + ' solver=' + s.solutions.length);
}

// Strict violations == analyze with an empty tray
{
  const board = ['L', null, 'L', null, null, null, null, null, null];
  const v = A.violations(board, 3, 3, null);
  check('violations: separated loners are fine', v.length === 0);
  const board2 = ['L', 'L', null, null, null, null, null, null, null];
  check('violations: adjacent loners are bad', A.violations(board2, 3, 3, null).length === 2);
}

// Examples for every hidden rule we use must pin the rule down.
for (const key of Object.keys(A.HYP)) {
  const r = A.makeExamples(key, 5, 5, 1234);
  check('examples for ' + key + ' (' + r.examples.length + ')', r.undecided.length === 0, 'still ambiguous with: ' + r.undecided.join(','));
}

console.log(failures ? '\n' + failures + ' FAILED' : '\nall engine checks passed');
process.exit(failures ? 1 : 0);
