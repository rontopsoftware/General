/*
 * Axiom engine — rules, validation, solver and mystery-rule examples.
 * Works both in the browser (window.Axiom) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Axiom = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Pieces
   *   L  הבודד     ●  no orthogonal neighbour is ●
   *   T  התאום     ▲  exactly one orthogonal neighbour is ▲
   *   S  השבט      ■  all ■ on the board form one connected group
   *   M  המראה     ◆  the point-symmetric cell holds ◆ too
   *   Cn המונה     ⬡n exactly n of its 8 neighbours are occupied
   *   Q  המסתורי   ◈  hidden rule (see HYP)
   * A piece is a string: 'L', 'T', 'S', 'M', 'C3', 'Q'.
   * ------------------------------------------------------------------ */
  const PIECES = {
    L: { sym: '●', name: 'הבודד', rule: 'אף שכן צמוד אליו (למעלה, למטה, ימין, שמאל) אינו ●.' },
    T: { sym: '▲', name: 'התאום', rule: 'בדיוק שכן צמוד אחד שלו הוא ▲.' },
    S: { sym: '■', name: 'השבט', rule: 'כל ה-■ שעל הלוח מחוברים לקבוצה אחת (צמידות ישרה, בלי אלכסון).' },
    M: { sym: '◆', name: 'המראה', rule: 'בתא הסימטרי לו דרך מרכז הלוח (הסימן +) עומד גם ◆.' },
    C: { sym: '⬡', name: 'המונה', rule: 'המספר שבתוכו הוא מספר הכלים שבשמונת התאים סביבו, כולל האלכסונים.' },
    Q: { sym: '◈', name: 'המסתורי', rule: 'החוק שלו נסתר. הסק אותו מהדוגמאות.' }
  };

  const typeOf = (p) => p[0];
  const numOf = (p) => parseInt(p.slice(1), 10);

  /* ------------------------------------------------------------------ *
   * Geometry (cached per board size)
   * ------------------------------------------------------------------ */
  const geomCache = {};
  function geom(w, h) {
    const key = w + 'x' + h;
    if (geomCache[key]) return geomCache[key];
    const n4 = [], n8 = [], mir = [];
    for (let i = 0; i < w * h; i++) {
      const x = i % w, y = (i / w) | 0;
      const a = [], b = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          b.push(ny * w + nx);
          if (!dx || !dy) a.push(ny * w + nx);
        }
      }
      n4.push(a); n8.push(b); mir.push((h - 1 - y) * w + (w - 1 - x));
    }
    return (geomCache[key] = { n4, n8, mir });
  }

  /* ------------------------------------------------------------------ *
   * Mystery-rule library. Every hypothesis looks only at occupancy, so
   * examples can be drawn with neutral dots and never leak piece types.
   * ctx = { w, h, occ[], x, y, i }
   * ------------------------------------------------------------------ */
  const rowCount = (c) => { let k = 0; for (let x = 0; x < c.w; x++) if (c.occ[c.y * c.w + x]) k++; return k; };
  const colCount = (c) => { let k = 0; for (let y = 0; y < c.h; y++) if (c.occ[y * c.w + c.x]) k++; return k; };
  const orthCount = (c) => { let k = 0; const g = geom(c.w, c.h); for (const n of g.n4[c.i]) if (c.occ[n]) k++; return k; };
  const octCount = (c) => { let k = 0; const g = geom(c.w, c.h); for (const n of g.n8[c.i]) if (c.occ[n]) k++; return k; };
  const diagCount = (c) => octCount(c) - orthCount(c);
  function sideCounts(c, horizontal) {
    let a = 0, b = 0;
    if (horizontal) {
      for (let x = 0; x < c.w; x++) if (c.occ[c.y * c.w + x]) { if (x < c.x) a++; else if (x > c.x) b++; }
    } else {
      for (let y = 0; y < c.h; y++) if (c.occ[y * c.w + c.x]) { if (y < c.y) a++; else if (y > c.y) b++; }
    }
    return [a, b];
  }

  const HYP = {
    edge:         { fn: (c) => c.x === 0 || c.y === 0 || c.x === c.w - 1 || c.y === c.h - 1, text: '◈ חייב לעמוד על שפת הלוח.' },
    corner:       { fn: (c) => (c.x === 0 || c.x === c.w - 1) && (c.y === 0 || c.y === c.h - 1), text: '◈ חייב לעמוד בפינה.' },
    alone_in_row: { fn: (c) => rowCount(c) === 1, text: '◈ הוא הכלי היחיד בשורה שלו.' },
    alone_in_col: { fn: (c) => colCount(c) === 1, text: '◈ הוא הכלי היחיד בעמודה שלו.' },
    row_balance:  { fn: (c) => { const s = sideCounts(c, true); return s[0] === s[1]; }, text: 'בשורה של ◈ יש אותה כמות כלים מימינו ומשמאלו.' },
    col_balance:  { fn: (c) => { const s = sideCounts(c, false); return s[0] === s[1]; }, text: 'בעמודה של ◈ יש אותה כמות כלים מעליו ומתחתיו.' },
    orth_none:    { fn: (c) => orthCount(c) === 0, text: '◈ מבודד: אף תא צמוד אליו (למעלה, למטה, ימין, שמאל) אינו תפוס.' },
    orth_even:    { fn: (c) => orthCount(c) % 2 === 0, text: 'מספר התאים התפוסים הצמודים ל-◈ הוא זוגי.' },
    orth_odd:     { fn: (c) => orthCount(c) % 2 === 1, text: 'מספר התאים התפוסים הצמודים ל-◈ הוא אי-זוגי.' },
    n8_even:      { fn: (c) => octCount(c) % 2 === 0, text: 'מספר הכלים בשמונת התאים סביב ◈ הוא זוגי.' },
    n8_odd:       { fn: (c) => octCount(c) % 2 === 1, text: 'מספר הכלים בשמונת התאים סביב ◈ הוא אי-זוגי.' },
    has_diag:     { fn: (c) => diagCount(c) > 0, text: 'ל-◈ יש כלי באחד התאים האלכסוניים שלו.' },
    top_half:     { fn: (c) => c.y < c.h / 2, text: '◈ חייב לעמוד בחצי העליון של הלוח.' },
    left_half:    { fn: (c) => c.x < c.w / 2, text: '◈ חייב לעמוד בחצי השמאלי של הלוח.' },
    checker:      { fn: (c) => (c.x + c.y) % 2 === 0, text: '◈ עומד על תא "בהיר" של לוח שחמט.' },
    row_even:     { fn: (c) => rowCount(c) % 2 === 0, text: 'מספר הכלים בשורה של ◈ הוא זוגי.' }
  };

  /* ------------------------------------------------------------------ *
   * Analysis of a board.
   *   board     : array of piece-string | null
   *   hidden    : key into HYP (or null)
   *   remaining : { piece: count } still in the tray. Used only to tell
   *               "pending" (can still be fixed) from "bad" (cannot).
   * Returns an array parallel to board with null | { s, msg, hidden }.
   * s is 'ok' | 'pending' | 'bad'.
   * ------------------------------------------------------------------ */
  function analyze(board, w, h, hidden, remaining) {
    remaining = remaining || {};
    const g = geom(w, h);
    const N = w * h;
    const res = new Array(N).fill(null);

    let remTotal = 0;
    const remType = {};
    for (const k in remaining) {
      remTotal += remaining[k];
      const t = typeOf(k);
      remType[t] = (remType[t] || 0) + remaining[k];
    }

    // connected components of S
    const comp = new Array(N).fill(-1);
    const compSize = [];
    for (let i = 0; i < N; i++) {
      if (board[i] !== 'S' || comp[i] !== -1) continue;
      const id = compSize.length;
      let size = 0;
      const stack = [i];
      comp[i] = id;
      while (stack.length) {
        const j = stack.pop();
        size++;
        for (const n of g.n4[j]) if (board[n] === 'S' && comp[n] === -1) { comp[n] = id; stack.push(n); }
      }
      compSize.push(size);
    }
    const bigSize = compSize.length ? Math.max.apply(null, compSize) : 0;
    const bigCount = compSize.filter((s) => s === bigSize).length;

    let occ = null; // lazily built for hidden rule
    for (let i = 0; i < N; i++) {
      const p = board[i];
      if (!p) continue;
      const t = typeOf(p);
      let s = 'ok', msg = '';
      if (t === 'L') {
        for (const n of g.n4[i]) if (board[n] === 'L') { s = 'bad'; msg = '● לא יכול לגעת ב-● אחר.'; break; }
      } else if (t === 'T') {
        let cnt = 0, empt = 0;
        for (const n of g.n4[i]) { if (board[n] === 'T') cnt++; else if (board[n] === null) empt++; }
        if (cnt > 1) { s = 'bad'; msg = 'ל-▲ יש יותר מדי שכני ▲ — צריך בדיוק אחד.'; }
        else if (cnt === 0) {
          if ((remType.T || 0) > 0 && empt > 0) { s = 'pending'; msg = 'ל-▲ עדיין אין שכן ▲.'; }
          else { s = 'bad'; msg = 'ל-▲ חייב להיות שכן ▲ אחד בדיוק.'; }
        }
      } else if (t === 'C') {
        const n = numOf(p);
        let o = 0, empt = 0;
        for (const j of g.n8[i]) { if (board[j] !== null) o++; else empt++; }
        if (o > n) { s = 'bad'; msg = 'סביב המונה יש ' + o + ' כלים, והוא דורש בדיוק ' + n + '.'; }
        else if (o < n) {
          const need = n - o;
          if (empt >= need && remTotal >= need) { s = 'pending'; msg = 'סביב המונה יש ' + o + ' כלים, והוא דורש ' + n + '.'; }
          else { s = 'bad'; msg = 'סביב המונה יש רק ' + o + ' כלים, והוא דורש ' + n + '.'; }
        }
      } else if (t === 'M') {
        const m = g.mir[i];
        if (m !== i && board[m] !== 'M') {
          if (board[m] === null && (remType.M || 0) > 0) { s = 'pending'; msg = 'בתא הסימטרי ל-◆ עדיין אין ◆.'; }
          else { s = 'bad'; msg = 'בתא הסימטרי ל-◆ (דרך המרכז) חייב לעמוד ◆.'; }
        }
      } else if (t === 'S') {
        if (compSize.length > 1 && !(compSize[comp[i]] === bigSize && bigCount === 1)) {
          if ((remType.S || 0) > 0) { s = 'pending'; msg = 'ה-■ עדיין לא מחוברים לקבוצה אחת.'; }
          else { s = 'bad'; msg = 'ה-■ חייבים להיות מחוברים לקבוצה אחת.'; }
        }
      } else if (t === 'Q') {
        if (hidden && HYP[hidden]) {
          if (!occ) occ = board.map((v) => v !== null);
          const ok = HYP[hidden].fn({ w, h, occ, x: i % w, y: (i / w) | 0, i });
          if (!ok) { s = remTotal > 0 ? 'pending' : 'bad'; msg = 'משהו ב-◈ לא מסתדר.'; }
        }
      }
      res[i] = { s, msg, hidden: t === 'Q' };
    }
    return res;
  }

  // Strict check of a full board (nothing left in the tray).
  function violations(board, w, h, hidden) {
    const a = analyze(board, w, h, hidden, {});
    const out = [];
    for (let i = 0; i < a.length; i++) if (a[i] && a[i].s !== 'ok') out.push({ i, msg: a[i].msg, hidden: a[i].hidden });
    return out;
  }

  // Cells worth highlighting when looking at piece p standing in cell i.
  function related(board, w, h, i) {
    const p = board[i];
    if (!p) return [];
    const g = geom(w, h);
    const t = typeOf(p);
    if (t === 'L' || t === 'T') return g.n4[i].slice();
    if (t === 'C') return g.n8[i].slice();
    if (t === 'M') return g.mir[i] !== i ? [g.mir[i]] : [];
    if (t === 'S') { const r = []; for (let k = 0; k < board.length; k++) if (board[k] === 'S' && k !== i) r.push(k); return r; }
    return [];
  }

  /* ------------------------------------------------------------------ *
   * Solver — fills free cells in row-major order with pruning, counts
   * solutions (up to `limit`).
   *   opts: { w, h, givens:[[i,p],...], inventory:{p:count}, hidden,
   *           limit, rng, maxNodes }
   * Returns { solutions:[board...], aborted, nodes }.
   * ------------------------------------------------------------------ */
  function search(o) {
    const w = o.w, h = o.h, N = w * h;
    const g = geom(w, h);
    const board = new Array(N).fill(null);
    const decided = new Uint8Array(N);
    for (const gv of (o.givens || [])) { board[gv[0]] = gv[1]; decided[gv[0]] = 1; }
    const rem = Object.assign({}, o.inventory);
    let remCount = 0;
    for (const k in rem) remCount += rem[k];
    const kinds = Object.keys(rem);
    const free = [];
    for (let i = 0; i < N; i++) if (!decided[i]) free.push(i);
    const limit = o.limit || 2;
    const maxNodes = o.maxNodes || Infinity;
    const rng = o.rng || null;
    const sols = [];
    let nodes = 0, aborted = false;

    // Partial rule check: never rejects a cell that could still be satisfied.
    function cellOK(j) {
      const p = board[j];
      const t = p[0];
      if (t === 'L') {
        for (const n of g.n4[j]) if (decided[n] && board[n] === 'L') return false;
        return true;
      }
      if (t === 'T') {
        let cnt = 0, unk = 0;
        for (const n of g.n4[j]) { if (!decided[n]) unk++; else if (board[n] === 'T') cnt++; }
        return cnt <= 1 && cnt + unk >= 1;
      }
      if (t === 'C') {
        const n = parseInt(p.slice(1), 10);
        let occ = 0, unk = 0;
        for (const k of g.n8[j]) { if (!decided[k]) unk++; else if (board[k] !== null) occ++; }
        return occ <= n && occ + unk >= n;
      }
      if (t === 'M') {
        const m = g.mir[j];
        return m === j || !decided[m] || board[m] === 'M';
      }
      return true; // S and Q are checked on complete boards only
    }
    function localOK(i) {
      if (board[i] !== null && !cellOK(i)) return false;
      for (const n of g.n8[i]) if (board[n] !== null && !cellOK(n)) return false;
      const m = g.mir[i];
      if (m !== i && board[m] !== null && !cellOK(m)) return false;
      return true;
    }

    for (let i = 0; i < N; i++) if (decided[i] && board[i] !== null && !cellOK(i)) return { solutions: [], aborted: false, nodes: 0 };

    function rec(k) {
      if (sols.length >= limit || aborted) return;
      if (++nodes > maxNodes) { aborted = true; return; }
      if (free.length - k < remCount) return;
      if (k === free.length) {
        if (remCount === 0 && analyze(board, w, h, o.hidden, {}).every((c) => !c || c.s === 'ok')) sols.push(board.slice());
        return;
      }
      const i = free[k];
      const opts = [null];
      for (const kd of kinds) if (rem[kd] > 0) opts.push(kd);
      if (rng) for (let a = opts.length - 1; a > 0; a--) { const b = (rng() * (a + 1)) | 0; const tmp = opts[a]; opts[a] = opts[b]; opts[b] = tmp; }
      decided[i] = 1;
      for (const opt of opts) {
        board[i] = opt;
        if (opt !== null) { rem[opt]--; remCount--; }
        if (localOK(i)) rec(k + 1);
        if (opt !== null) { rem[opt]++; remCount++; }
        if (sols.length >= limit || aborted) break;
      }
      board[i] = null;
      decided[i] = 0;
    }
    rec(0);
    return { solutions: sols, aborted, nodes };
  }

  // Convenience: run the solver on a level object (see src/levels.js).
  function solveLevel(level, extra) {
    return search(Object.assign({
      w: level.w, h: level.h, givens: level.givens, inventory: level.inventory, hidden: level.hidden || null, limit: 2
    }, extra || {}));
  }

  /* ------------------------------------------------------------------ *
   * Seeded RNG + examples for the mystery piece.
   * Examples are chosen greedily so that no other rule in HYP agrees with
   * all of them — the player can always, in principle, pin the rule down.
   * ------------------------------------------------------------------ */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeExamples(key, w, h, seed) {
    const rng = mulberry32(seed | 0);
    const target = HYP[key].fn;
    const alive = new Set(Object.keys(HYP).filter((k) => k !== key));
    const ex = [];
    let nOk = 0, nBad = 0;
    for (let step = 0; step < 40 && (alive.size > 0 || nOk < 2 || nBad < 2); step++) {
      let best = null, bestScore = -1;
      for (let k = 0; k < 120; k++) {
        const dens = 0.1 + rng() * 0.35;
        const occ = [];
        for (let i = 0; i < w * h; i++) occ.push(rng() < dens);
        const q = (rng() * w * h) | 0;
        occ[q] = true;
        const c = { w, h, occ, x: q % w, y: (q / w) | 0, i: q };
        const t = target(c);
        let killed = 0;
        alive.forEach((hk) => { if (HYP[hk].fn(c) !== t) killed++; });
        const mix = (t && nOk < 2) || (!t && nBad < 2) ? 1 : 0;
        const score = killed * 10 + mix * 3 - occ.filter(Boolean).length * 0.05;
        if (score > bestScore && (killed > 0 || mix)) { bestScore = score; best = { occ, q, ok: t, c }; }
      }
      if (!best) break;
      alive.forEach((hk) => { if (HYP[hk].fn(best.c) !== best.ok) alive.delete(hk); });
      ex.push({ occ: best.occ, q: best.q, ok: best.ok });
      if (best.ok) nOk++; else nBad++;
    }
    ex.sort((a, b) => (b.ok ? 1 : 0) - (a.ok ? 1 : 0));
    return { examples: ex, undecided: Array.from(alive) };
  }

  return { PIECES, HYP, typeOf, numOf, geom, analyze, violations, related, search, solveLevel, mulberry32, makeExamples };
});
