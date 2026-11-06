#!/usr/bin/env node
/*
 * Builds src/levels.js.
 *
 * For each spec: find a random valid board, then hide pieces one at a time
 * (moving them to the tray) as long as the puzzle keeps exactly one solution.
 * Levels are baked, so the browser never needs the solver.
 *
 *   node scripts/generate-levels.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('../src/engine.js');

const SPECS = [
  {
    id: 1, title: 'הבודד', w: 3, h: 3, pieces: { L: 5 }, counters: 0, hide: 4,
    intro: 'ה-● לא סובל שכנים: אף ● לא יכול לגעת ב-● אחר. הנח את כל הכלים שבמגש.'
  },
  {
    id: 2, title: 'התאומים', w: 4, h: 4, pieces: { L: 2, T: 6 }, counters: 0, hide: 5,
    intro: 'כל ▲ צריך בדיוק שכן ▲ אחד. זוגות, לא שלישיות. והבודדים עדיין בודדים.'
  },
  {
    id: 3, title: 'השבט', w: 5, h: 5, pieces: { S: 5, L: 3 }, counters: 0, hide: 6,
    intro: 'כל ה-■ חייבים להיות מחוברים לקבוצה אחת. החוק הזה חל על כל הלוח, לא רק על שכנים.'
  },
  {
    id: 4, title: 'המראה', w: 5, h: 5, pieces: { M: 4, L: 3, T: 2 }, counters: 0, hide: 7,
    intro: 'מול כל ◆ דרך מרכז הלוח (הסימן +) עומד ◆ נוסף. שים לב איך שני הכלים תלויים זה בזה.'
  },
  {
    id: 5, title: 'המונה', w: 5, h: 5, pieces: { L: 4, T: 2 }, counters: 3, hide: 8,
    intro: 'המספר בתוך ⬡ הוא מספר הכלים שבשמונת התאים סביבו, כולל אלכסונים. עכשיו אפשר להסיק מתוך מספרים.'
  },
  {
    id: 6, title: 'הכול ביחד', w: 5, h: 5, pieces: { L: 3, T: 2, S: 3, M: 2 }, counters: 2, hide: 9,
    intro: 'ארבעה חוקים על לוח אחד. כל כלי בודק את עצמו, והלוח כולו חייב להסכים.'
  },
  {
    id: 7, title: 'האורח המסתורי', w: 5, h: 5, pieces: { Q: 2, L: 2, T: 2, S: 3 }, counters: 3, hide: 7, hidden: 'alone_in_row',
    intro: 'הגיע כלי חדש: ◈. אף אחד לא סיפר לך מה החוק שלו. הסתכל בדוגמאות, הסק את החוק, ואז פתור.'
  },
  {
    id: 8, title: 'חמישה חוקים', w: 6, h: 6, pieces: { L: 4, T: 4, S: 4, M: 4 }, counters: 3, hide: 12,
    intro: 'לוח גדול יותר, יותר כלים, וכל החוקים שלמדת עד עכשיו.'
  },
  {
    id: 9, title: 'אורח שני', w: 5, h: 5, pieces: { Q: 3, L: 2, S: 3, M: 2 }, counters: 0, hide: 9, hidden: 'row_balance',
    intro: 'שוב ◈, אבל חוק אחר לגמרי. אל תניח שהוא מתנהג כמו האורח הקודם.'
  },
  {
    id: 10, title: 'אקסיומה', w: 6, h: 6, pieces: { Q: 2, L: 3, T: 4, S: 4, M: 2 }, counters: 3, hide: 12, hidden: 'orth_none',
    intro: 'כל הכלים, חוק נסתר אחד, וקצת פחות רמזים. בהצלחה.'
  }
];

function countsOf(pieces) {
  const o = {};
  for (const p of pieces) o[p] = (o[p] || 0) + 1;
  return o;
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Random valid full board for a spec, or null.
function randomSolution(spec, rng) {
  const N = spec.w * spec.h;
  for (let attempt = 0; attempt < 60; attempt++) {
    const r = A.search({
      w: spec.w, h: spec.h, givens: [], inventory: spec.pieces,
      hidden: spec.hidden || null, limit: 1, rng, maxNodes: 300000
    });
    if (!r.solutions.length) continue;
    const board = r.solutions[0].slice();
    // Counters go into empty cells; their numbers are read off the final board.
    const empties = shuffle(board.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0), rng);
    if (empties.length < spec.counters) continue;
    for (let k = 0; k < spec.counters; k++) board[empties[k]] = 'C0';
    const g = A.geom(spec.w, spec.h);
    for (let i = 0; i < N; i++) {
      if (board[i] && board[i][0] === 'C') board[i] = 'C' + g.n8[i].filter((j) => board[j] !== null).length;
    }
    if (A.violations(board, spec.w, spec.h, spec.hidden || null).length === 0) return board;
  }
  return null;
}

function tryBuild(spec, seed) {
  const rng = A.mulberry32(seed);
  const solution = randomSolution(spec, rng);
  if (!solution) return null;
  // Hide mystery pieces first (the player must place them), counters last
  // (they are the strongest clues).
  const rank = (i) => (solution[i][0] === 'Q' ? 0 : solution[i][0] === 'C' ? 2 : 1);
  const occupied = shuffle(solution.map((v, i) => (v ? i : -1)).filter((i) => i >= 0), rng)
    .sort((a, b) => rank(a) - rank(b));
  const hiddenSet = new Set();
  for (const i of occupied) {
    if (hiddenSet.size >= spec.hide) break;
    const trial = new Set(hiddenSet); trial.add(i);
    const givens = [], tray = [];
    for (let k = 0; k < solution.length; k++) {
      if (!solution[k]) continue;
      if (trial.has(k)) tray.push(solution[k]); else givens.push([k, solution[k]]);
    }
    const r = A.search({
      w: spec.w, h: spec.h, givens, inventory: countsOf(tray),
      hidden: spec.hidden || null, limit: 2, maxNodes: 1500000
    });
    if (!r.aborted && r.solutions.length === 1) hiddenSet.add(i);
  }
  if (spec.hidden && ![...hiddenSet].some((i) => solution[i][0] === 'Q')) return null; // discovery needs ◈ in the tray
  return { solution, hiddenSet };
}

function build(spec) {
  let best = null;
  const started = Date.now();
  const budget = spec.budgetMs || 90000;
  for (let seed = spec.id * 1000; seed < spec.id * 1000 + 80; seed++) {
    if (best && Date.now() - started > budget) break;
    const t0 = Date.now();
    const r = tryBuild(spec, seed);
    if (!r) continue;
    const ms = Date.now() - t0;
    if (!best || r.hiddenSet.size > best.hiddenSet.size) best = Object.assign(r, { seed });
    process.stdout.write('  seed ' + seed + ': hidden ' + r.hiddenSet.size + '/' + spec.hide + ' (' + ms + 'ms)\n');
    if (r.hiddenSet.size >= spec.hide) break;
  }
  if (!best) throw new Error('could not build level ' + spec.id);

  const givens = [], tray = [];
  best.solution.forEach((p, i) => {
    if (!p) return;
    if (best.hiddenSet.has(i)) tray.push(p); else givens.push([i, p]);
  });
  const kinds = [];
  for (const p of best.solution) if (p && kinds.indexOf(p[0]) < 0) kinds.push(p[0]);
  const order = 'LTSMCQ';
  kinds.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const level = {
    id: spec.id, title: spec.title, intro: spec.intro, w: spec.w, h: spec.h,
    kinds, givens, inventory: countsOf(tray), solution: best.solution
  };
  if (spec.hidden) { level.hidden = spec.hidden; level.exampleSeed = spec.id * 7919; }
  return level;
}

const only = process.argv.slice(2).map(Number);
let existing = [];
if (only.length) { try { existing = require('../src/levels.js'); } catch (e) { existing = []; } }
const levels = [];
for (const spec of SPECS) {
  const old = existing.find((l) => l.id === spec.id);
  if (only.length && !only.includes(spec.id) && old) { levels.push(old); continue; }
  console.log('level ' + spec.id + ' — ' + spec.title);
  levels.push(build(spec));
}

const out =
  '/* Generated by scripts/generate-levels.js — do not edit by hand. */\n' +
  '(function (root, factory) {\n' +
  "  if (typeof module === 'object' && module.exports) module.exports = factory();\n" +
  '  else root.AXIOM_LEVELS = factory();\n' +
  "})(typeof self !== 'undefined' ? self : this, function () {\n" +
  '  return ' + JSON.stringify(levels, null, 1).replace(/\n\s*/g, (m, off, s) => ' ').replace(/\{ "id"/g, '\n{ "id"') + ';\n' +
  '});\n';
fs.writeFileSync(path.join(__dirname, '..', 'src', 'levels.js'), out);
console.log('\nwrote src/levels.js (' + levels.length + ' levels)');
