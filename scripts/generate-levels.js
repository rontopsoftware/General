#!/usr/bin/env node
/*
 * Builds src/levels.js.
 *
 * For each spec: find a random valid board, then hide pieces one at a time
 * (moving them to the tray) as long as the puzzle keeps exactly one solution.
 * Levels are baked, so the browser never needs the solver.
 *
 *   node scripts/generate-levels.js            # every level (slow)
 *   node scripts/generate-levels.js 3 4 11     # only these ids
 *
 * Levels are independent, so several processes can build different ids in
 * parallel: every save re-reads src/levels.js under a lock and replaces only
 * the level it built.
 *
 * Spec fields
 *   pieces     piece counts on the full board (L T S M Q), counters excluded
 *   counters   number of ⬡ counters (numbers are read off the final board)
 *   hide       target tray size; the build stops early once reached
 *   hidden     key into HYP for the mystery piece (Q must then be in `pieces`)
 *   seeds      how many random boards to try (default 400)
 *   orders     how many hide orders to try per board (default 3)
 *   budgetMs   time budget for the whole level (default 240s)
 *   maxNodes   solver node cap per uniqueness check (default 1.5M)
 *   counterEarly  allow hiding counters before ordinary pieces
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
    id: 2, title: 'התאומים', w: 4, h: 4, pieces: { L: 3, T: 8 }, counters: 0, hide: 8,
    intro: 'כל ▲ צריך בדיוק שכן ▲ אחד. זוגות, לא שלישיות. כלים מסוגים שונים רשאים לגעת זה בזה.'
  },
  {
    id: 3, title: 'השבט', w: 5, h: 5, pieces: { S: 6, L: 5, T: 4 }, counters: 0, hide: 9, seedMs: 15000, budgetMs: 300000,
    intro: 'כל ה-■ חייבים להיות מחוברים לקבוצה אחת. החוק הזה חל על כל הלוח, לא רק על שכנים.'
  },
  {
    id: 4, title: 'המראה', w: 5, h: 5, pieces: { M: 6, L: 4, T: 6 }, counters: 0, hide: 10,
    intro: 'מול כל ◆ דרך מרכז הלוח (הסימן +) עומד ◆ נוסף. שים לב איך שני הכלים תלויים זה בזה.'
  },
  {
    id: 5, title: 'המונה', w: 5, h: 5, pieces: { L: 5, T: 4 }, counters: 4, hide: 11,
    intro: 'המספר בתוך ⬡ הוא מספר הכלים שבשמונת התאים סביבו, כולל אלכסונים. גם ⬡ אחרים נספרים כשהם שכנים שלו. עכשיו אפשר להסיק מתוך מספרים.'
  },
  {
    id: 6, title: 'הכול ביחד', w: 5, h: 5, pieces: { L: 3, T: 4, S: 4, M: 4 }, counters: 3, hide: 13, seedMs: 15000, budgetMs: 300000,
    intro: 'כל החוקים שלמדת, על לוח אחד. כל כלי בודק את עצמו, והלוח כולו חייב להסכים.'
  },
  {
    id: 7, title: 'האורח המסתורי', w: 6, h: 6, pieces: { Q: 2, L: 4, T: 2, S: 4, M: 2 }, counters: 4, hide: 16, hidden: 'alone_in_row', qOrder: 'any', maxNodes: 4000000, seedMs: 15000, budgetMs: 300000,
    intro: 'הגיע כלי חדש: ◈. אף אחד לא סיפר לך מה החוק שלו. הסתכל בדוגמאות, הסק את החוק, ואז פתור.'
  },
  {
    id: 8, title: 'חמישה חוקים', w: 6, h: 6, pieces: { L: 5, T: 6, S: 5, M: 6 }, counters: 4, hide: 18, seedMs: 20000, budgetMs: 400000,
    intro: 'לוח גדול יותר, יותר כלים, וכל החוקים שלמדת עד עכשיו.'
  },
  {
    id: 9, title: 'אורח שני', w: 6, h: 6, pieces: { Q: 4, L: 4, T: 2, S: 5, M: 4 }, counters: 3, hide: 19, hidden: 'row_balance', qOrder: 'any', maxNodes: 4000000, seedMs: 15000, budgetMs: 300000,
    intro: 'שוב ◈, אבל חוק אחר לגמרי. אל תניח שהוא מתנהג כמו האורח הקודם.'
  },
  {
    id: 10, title: 'אקסיומה', w: 6, h: 6, pieces: { Q: 3, L: 4, T: 4, S: 5, M: 4 }, counters: 4, hide: 19, hidden: 'orth_none', seedMs: 20000, budgetMs: 400000,
    intro: 'כל הכלים, חוק נסתר אחד, ופחות כלים מונחים מראש על הלוח. בהצלחה.'
  },
  {
    id: 11, title: 'אורח שלישי', w: 6, h: 6, pieces: { Q: 3, L: 4, T: 4, S: 4, M: 4 }, counters: 4, hide: 20, hidden: 'col_balance', seedMs: 20000, budgetMs: 400000,
    intro: 'האורח חזר, והחוק שלו חדש שוב. אף רמז לא יגיע מהמילים, רק מהדוגמאות.'
  },
  {
    id: 12, title: 'שבע על שבע', w: 7, h: 7, pieces: { L: 6, T: 6, S: 6, M: 6 }, counters: 5, hide: 24, seedMs: 30000, budgetMs: 500000, maxNodes: 3000000,
    intro: 'שבע שורות ושבע עמודות, ורק החוקים שאתה כבר מכיר. יותר מקום, אז כל הנחה צריכה הוכחה.'
  },
  {
    id: 13, title: 'אורח רביעי', w: 6, h: 6, pieces: { Q: 3, L: 4, T: 4, S: 5, M: 4 }, counters: 4, hide: 21, hidden: 'has_diag', seedMs: 20000, budgetMs: 400000,
    intro: 'ארבעה אורחים, ארבעה חוקים שונים. אל תסמוך על מה שלמדת, רק על מה שאתה רואה.'
  },
  {
    id: 14, title: 'בלי רשת ביטחון', w: 7, h: 7, pieces: { L: 7, T: 8, S: 7, M: 6 }, counters: 6, hide: 28, seedMs: 30000, budgetMs: 500000, maxNodes: 3000000,
    intro: 'לוח גדול, מעט רמזים, ואף חוק נסתר. כאן כבר צריך סבלנות ושיטה.'
  },
  {
    id: 15, title: 'אורח חמישי', w: 7, h: 7, pieces: { Q: 3, L: 5, T: 6, S: 6, M: 4 }, counters: 5, hide: 26, hidden: 'orth_even', seedMs: 30000, budgetMs: 500000, maxNodes: 3000000,
    intro: 'לוח של שבע על שבע וחוק נסתר חדש. התחל מהדוגמאות, ואל תמהר להניח.'
  },
  {
    id: 16, title: 'האקסיומה האחרונה', w: 7, h: 7, pieces: { Q: 3, L: 6, T: 6, S: 7, M: 6 }, counters: 6, hide: 30, hidden: 'n8_odd', seedMs: 30000, budgetMs: 500000, maxNodes: 3000000,
    intro: 'כל הכלים, לוח מלא, חוק נסתר אחרון. אם הגעת עד כאן, אתה יודע מה לעשות.'
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
    // ■ needs one connected group, which the solver only checks on complete
    // boards. Grow a random connected blob first and let the search fill the rest.
    const givens = [];
    const inventory = Object.assign({}, spec.pieces);
    if (inventory.S) {
      const g0 = A.geom(spec.w, spec.h);
      const blob = new Set([(rng() * N) | 0]);
      while (blob.size < inventory.S) {
        const edge = [];
        blob.forEach((c) => g0.n4[c].forEach((n) => { if (!blob.has(n)) edge.push(n); }));
        blob.add(edge[(rng() * edge.length) | 0]);
      }
      blob.forEach((c) => givens.push([c, 'S']));
      delete inventory.S;
    }
    // The mystery rule only looks at occupancy and is checked on complete boards,
    // so the search would flounder with ◈ in it. Build the board without ◈ and
    // drop the ◈ pieces in afterwards, one at a time, on cells where the rule holds.
    const nQ = inventory.Q || 0;
    delete inventory.Q;
    const r = A.search({
      w: spec.w, h: spec.h, givens, inventory,
      hidden: null, limit: 1, rng, maxNodes: 300000
    });
    if (!r.solutions.length) continue;
    for (let t = 0; t < (nQ ? 60 : 1); t++) {
      const board = decorate(spec, r.solutions[0], nQ, rng);
      if (board && A.violations(board, spec.w, spec.h, spec.hidden || null).length === 0) return board;
    }
  }
  return null;
}

// Adds the counters (numbers read off the final board) and the ◈ pieces to a board.
function decorate(spec, base, nQ, rng) {
  const N = spec.w * spec.h;
  const board = base.slice();
  const empties = () => shuffle(board.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0), rng);
  const e = empties();
  if (e.length < spec.counters + nQ) return null;
  for (let k = 0; k < spec.counters; k++) board[e[k]] = 'C0';
  if (nQ) {
    const rule = A.HYP[spec.hidden].fn;
    for (let k = 0; k < nQ; k++) {
      const cands = empties().filter((i) => {
        board[i] = 'Q';
        const ok = rule({ w: spec.w, h: spec.h, occ: board.map((v) => v !== null), x: i % spec.w, y: (i / spec.w) | 0, i });
        board[i] = null;
        return ok;
      });
      if (!cands.length) return null;
      board[cands[0]] = 'Q';
    }
  }
  const g = A.geom(spec.w, spec.h);
  for (let i = 0; i < N; i++) {
    if (board[i] && board[i][0] === 'C') board[i] = 'C' + g.n8[i].filter((j) => board[j] !== null).length;
  }
  return board;
}

// One greedy pass: try to move pieces to the tray in the given order, keeping
// the solution unique. Returns the set of hidden cell indices.
function hidePass(spec, solution, order, init) {
  const hiddenSet = new Set(init || []);
  for (const i of order) {
    if (hiddenSet.size >= spec.hide || Date.now() > deadline) break;
    const trial = new Set(hiddenSet); trial.add(i);
    const givens = [], tray = [];
    for (let k = 0; k < solution.length; k++) {
      if (!solution[k]) continue;
      if (trial.has(k)) tray.push(solution[k]); else givens.push([k, solution[k]]);
    }
    const r = A.search({
      w: spec.w, h: spec.h, givens, inventory: countsOf(tray),
      hidden: spec.hidden || null, limit: 2, maxNodes: spec.maxNodes || 1500000
    });
    if (!r.aborted && r.solutions.length === 1) hiddenSet.add(i);
  }
  return hiddenSet;
}

// Bigger tray first, then more distinct piece kinds in it.
function score(solution, hiddenSet) {
  const kinds = new Set();
  hiddenSet.forEach((i) => kinds.add(solution[i][0]));
  return hiddenSet.size * 10 + kinds.size;
}

let deadline = Infinity; // per-board time cap, set in tryBuild

function tryBuild(spec, seed) {
  deadline = Date.now() + (spec.seedMs || 25000);
  const rng = A.mulberry32(seed);
  const solution = randomSolution(spec, rng);
  if (!solution) return null;
  const occupied = solution.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  // Mystery pieces first (the player must place them); counters are the strongest
  // clues, so they are hidden last unless the spec says otherwise.
  const qRank = spec.qOrder === 'last' ? 3 : spec.qOrder === 'any' ? 1 : 0;
  const rank = (i) => (solution[i][0] === 'Q' ? qRank : solution[i][0] === 'C' ? (spec.counterEarly ? 1 : 2) : 1);
  let best = null;
  for (let o = 0; o < (spec.orders || 3); o++) {
    const order = shuffle(occupied, rng).sort((a, b) => rank(a) - rank(b));
    const hiddenSet = hidePass(spec, solution, order);
    if (spec.hidden && ![...hiddenSet].some((i) => solution[i][0] === 'Q')) continue; // discovery needs the mystery piece in the tray
    if (!best || score(solution, hiddenSet) > score(solution, best.hiddenSet)) best = { solution, hiddenSet };
    if (hiddenSet.size >= spec.hide) break;
  }
  if (!best) return null;

  // Local search: put one or two pieces back on the board, then try to hide
  // others in a fresh random order. Equal-size moves are accepted so the
  // search can drift across plateaus.
  const hasQ = (set) => !spec.hidden || [...set].some((i) => solution[i][0] === 'Q');
  const iters = spec.climb === undefined ? 25 : spec.climb;
  for (let it = 0; it < iters && best.hiddenSet.size < spec.hide && Date.now() < deadline; it++) {
    const base = new Set(best.hiddenSet);
    const hid = shuffle([...base], rng);
    const drop = 1 + (rng() < 0.4 ? 1 : 0);
    for (let k = 0; k < drop && hid.length; k++) base.delete(hid[k]);
    const order = shuffle(occupied, rng).filter((i) => !base.has(i));
    const cand = hidePass(spec, solution, order, base);
    if (hasQ(cand) && score(solution, cand) >= score(solution, best.hiddenSet)) best = { solution, hiddenSet: cand };
  }
  return best;
}

function build(spec) {
  let best = null;
  const started = Date.now();
  const budget = spec.budgetMs || 240000;
  const seeds = spec.seeds || 400;
  for (let seed = spec.id * 1000; seed < spec.id * 1000 + seeds; seed++) {
    if (Date.now() - started > (best ? budget : budget * 3)) break;
    const t0 = Date.now();
    const r = tryBuild(spec, seed);
    if (!r) continue;
    const ms = Date.now() - t0;
    const better = !best || score(r.solution, r.hiddenSet) > score(best.solution, best.hiddenSet);
    if (better) best = Object.assign(r, { seed });
    process.stdout.write('  seed ' + seed + ': tray ' + r.hiddenSet.size + '/' + spec.hide + ' (' + ms + 'ms)' + (better ? ' *' : '') + '\n');
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

/* ---- output ----------------------------------------------------------- */
const OUT = path.join(__dirname, '..', 'src', 'levels.js');
const LOCK = OUT + '.lock';

function readLevels() {
  try { delete require.cache[require.resolve(OUT)]; return require(OUT); } catch (e) { return []; }
}

function render(levels) {
  return '/* Generated by scripts/generate-levels.js — do not edit by hand. */\n' +
    '(function (root, factory) {\n' +
    "  if (typeof module === 'object' && module.exports) module.exports = factory();\n" +
    '  else root.AXIOM_LEVELS = factory();\n' +
    "})(typeof self !== 'undefined' ? self : this, function () {\n" +
    '  return ' + JSON.stringify(levels, null, 1).replace(/\n\s*/g, ' ').replace(/\{ "id"/g, '\n{ "id"') + ';\n' +
    '});\n';
}

function trayOf(l) { return Object.values(l.inventory).reduce((a, b) => a + b, 0); }

function save(level) {
  for (let t = 0; ; t++) {
    try { fs.mkdirSync(LOCK); break; } catch (e) {
      if (e.code !== 'EEXIST' || t > 600) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  try {
    const old = readLevels();
    const prev = old.find((l) => l.id === level.id);
    // Rebuilding must never regress: keep the old level when it has a bigger tray.
    if (prev && prev.w === level.w && prev.h === level.h && prev.hidden === level.hidden && trayOf(prev) > trayOf(level)) {
      console.log('  kept existing level ' + level.id + ' (tray ' + trayOf(prev) + ' > ' + trayOf(level) + ')');
      return;
    }
    const levels = old.filter((l) => l.id !== level.id).concat([level]).sort((a, b) => a.id - b.id);
    fs.writeFileSync(OUT, render(levels));
  } finally { fs.rmdirSync(LOCK); }
}

// Titles and intros live in SPECS; copy them into already-built levels so text
// edits never need a re-solve. (`node scripts/generate-levels.js text`)
function syncText() {
  for (let t = 0; ; t++) {
    try { fs.mkdirSync(LOCK); break; } catch (e) {
      if (e.code !== 'EEXIST' || t > 600) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  try {
    const levels = readLevels();
    let changed = 0;
    for (const l of levels) {
      const spec = SPECS.find((s) => s.id === l.id);
      if (spec && (spec.title !== l.title || spec.intro !== l.intro)) { l.title = spec.title; l.intro = spec.intro; changed++; }
    }
    if (changed) fs.writeFileSync(OUT, render(levels));
    console.log('synced text of ' + changed + ' level(s)');
  } finally { fs.rmdirSync(LOCK); }
}

// Dev aid: AXIOM_SPEC='{"id":4,"pieces":{...}}' overrides fields of that id's spec
// and AXIOM_DRY=1 prints the result instead of saving it.
const override = process.env.AXIOM_SPEC ? JSON.parse(process.env.AXIOM_SPEC) : null;
const dry = !!process.env.AXIOM_DRY;
const textOnly = process.argv[2] === 'text';
const only = textOnly ? [] : process.argv.slice(2).map(Number);
if (textOnly) { syncText(); process.exit(0); }
for (let spec of SPECS) {
  if (only.length && !only.includes(spec.id)) continue;
  if (override && override.id === spec.id) spec = Object.assign({}, spec, override);
  console.log('level ' + spec.id + ' — ' + spec.title);
  const level = build(spec);
  if (!dry) save(level);
  console.log('  built level ' + spec.id + ': ' + level.givens.length + ' given, ' + trayOf(level) + ' in tray' + (dry ? ' (dry run)' : ''));
}
