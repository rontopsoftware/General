#!/usr/bin/env node
/*
 * Verifies every baked level:
 *   - the stored solution obeys every rule
 *   - givens + tray reproduce the solution exactly
 *   - the solver finds exactly ONE solution, and it is the stored one
 *   - mystery levels have the piece in the tray and examples that pin the rule down
 */
'use strict';
const A = require('../src/engine.js');
const LEVELS = require('../src/levels.js');

let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };

for (const lv of LEVELS) {
  const t0 = Date.now();
  const label = 'level ' + lv.id + ' (' + lv.title + ', ' + lv.w + 'x' + lv.h + ')';
  const problems = [];

  const v = A.violations(lv.solution, lv.w, lv.h, lv.hidden || null);
  if (v.length) problems.push('stored solution breaks rules at ' + v.map((x) => x.i).join(','));

  // givens + tray == solution
  const solCounts = {};
  lv.solution.forEach((p) => { if (p) solCounts[p] = (solCounts[p] || 0) + 1; });
  const rebuilt = Object.assign({}, lv.inventory);
  lv.givens.forEach(([i, p]) => {
    if (lv.solution[i] !== p) problems.push('given at ' + i + ' differs from solution');
    rebuilt[p] = (rebuilt[p] || 0) + 1;
  });
  for (const k of new Set(Object.keys(solCounts).concat(Object.keys(rebuilt)))) {
    if ((solCounts[k] || 0) !== (rebuilt[k] || 0)) problems.push('piece count mismatch for ' + k);
  }

  const r = A.solveLevel(lv, { limit: 2, maxNodes: 20000000 });
  if (r.aborted) problems.push('solver aborted (too hard to verify)');
  else if (r.solutions.length !== 1) problems.push('expected 1 solution, found ' + r.solutions.length);
  else if (r.solutions[0].join('|') !== lv.solution.join('|')) problems.push('unique solution differs from stored one');

  if (lv.hidden) {
    if (!lv.inventory.Q) problems.push('mystery piece is not in the tray');
    const ex = A.makeExamples(lv.hidden, lv.w, lv.h, lv.exampleSeed);
    if (ex.undecided.length) problems.push('examples leave rules open: ' + ex.undecided.join(','));
  }

  const tray = Object.keys(lv.inventory).reduce((a, k) => a + lv.inventory[k], 0);
  if (problems.length) { fail(label); problems.forEach((p) => console.log('       - ' + p)); }
  else console.log('  ok   ' + label + ' — ' + lv.givens.length + ' given, ' + tray + ' in tray, unique solution (' + (Date.now() - t0) + 'ms)');
}

console.log(failures ? '\n' + failures + ' level(s) FAILED' : '\nall ' + LEVELS.length + ' levels verified');
process.exit(failures ? 1 : 0);
