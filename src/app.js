/* Axiom — browser UI. Needs src/engine.js and src/levels.js loaded first. */
(function () {
  'use strict';
  const A = window.Axiom;
  const LEVELS = window.AXIOM_LEVELS;
  const KIND_ORDER = 'LTSMCQ';
  const SAVE_KEY = 'axiom.v1';
  const $ = (id) => document.getElementById(id);

  /* ---------------- persistence (never required for the game to work) ---------------- */
  let save = { solved: {}, level: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (raw && typeof raw === 'object') save = Object.assign(save, raw);
  } catch (e) { /* private mode etc. */ }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const total = (r) => Object.keys(r).reduce((a, k) => a + r[k], 0);
  const kindRank = (p) => KIND_ORDER.indexOf(p[0]) * 100 + (p.length > 1 ? A.numOf(p) : 0);
  const nameOf = (p) => A.PIECES[p[0]] ? A.PIECES[p[0]].name : 'כלי';
  const symOf = (p) => (p[0] === 'C' ? '⬡' + A.numOf(p) : A.PIECES[p[0]].sym);

  function pieceSVG(p) {
    const t = p[0];
    let inner = '';
    if (t === 'L') inner = '<circle cx="50" cy="50" r="28" fill="currentColor"/>';
    else if (t === 'T') inner = '<polygon points="50,16 86,80 14,80" fill="currentColor" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>';
    else if (t === 'S') inner = '<rect x="20" y="20" width="60" height="60" rx="9" fill="currentColor"/>';
    else if (t === 'M') inner = '<polygon points="50,12 88,50 50,88 12,50" fill="currentColor" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>';
    else if (t === 'C') inner = '<polygon points="50,10 84,30 84,70 50,90 16,70 16,30" fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="round"/>' +
      '<text x="50" y="53" text-anchor="middle" dominant-baseline="central" font-size="42" font-weight="800" font-family="system-ui,sans-serif" fill="currentColor">' + (p.length > 1 ? A.numOf(p) : '') + '</text>';
    else if (t === 'Q') inner = '<polygon points="50,12 88,50 50,88 12,50" fill="none" stroke="currentColor" stroke-width="6" stroke-dasharray="10 7" stroke-linejoin="round"/>' +
      '<text x="50" y="54" text-anchor="middle" dominant-baseline="central" font-size="40" font-weight="800" font-family="system-ui,sans-serif" fill="currentColor">?</text>';
    else if (t === 'X') inner = '<circle cx="50" cy="50" r="17" fill="currentColor"/>';
    return '<svg class="pc pc-' + t + '" viewBox="0 0 100 100" aria-hidden="true">' + inner + '</svg>';
  }

  /* ---------------- state ---------------- */
  let st = null;

  function startLevel(li) {
    li = Math.max(0, Math.min(LEVELS.length - 1, li));
    const lv = LEVELS[li];
    const N = lv.w * lv.h;
    st = {
      li, lv, board: new Array(N).fill(null), fixed: new Array(N).fill(false),
      selected: null, solved: false, hints: 0, hintCell: -1, hintMsg: '', hover: -1, an: null
    };
    lv.givens.forEach((g) => { st.board[g[0]] = g[1]; st.fixed[g[0]] = true; });
    save.level = li; persist();
    $('modal').hidden = true;
    autoSelect();
    renderAll();
  }

  function remaining() {
    const r = Object.assign({}, st.lv.inventory);
    st.board.forEach((p, i) => { if (p && !st.fixed[i]) r[p] = (r[p] || 0) - 1; });
    return r;
  }

  function autoSelect() {
    const rem = remaining();
    if (st.selected && rem[st.selected] > 0) return;
    const kinds = Object.keys(rem).filter((k) => rem[k] > 0).sort((a, b) => kindRank(a) - kindRank(b));
    st.selected = kinds.length ? kinds[0] : null;
  }

  /* ---------------- rendering ---------------- */
  function firstLevelWith(kind) {
    for (let i = 0; i < LEVELS.length; i++) if (LEVELS[i].kinds.indexOf(kind) >= 0) return i;
    return -1;
  }

  function renderNav() {
    $('levels').innerHTML = LEVELS.map((l, i) =>
      '<button data-go="' + i + '" class="' + (i === st.li ? 'cur ' : '') + (save.solved[l.id] ? 'done ' : '') + (l.hidden ? 'q' : '') +
      '" title="' + esc(l.title) + '" aria-label="רמה ' + l.id + ': ' + esc(l.title) + '">' + l.id + '</button>').join('');
  }

  function renderIntro() {
    const lv = st.lv;
    $('intro').innerHTML = '<div class="lvl">רמה ' + lv.id + ' מתוך ' + LEVELS.length + '</div><h2>' + esc(lv.title) + '</h2><p>' + esc(lv.intro) + '</p>';
  }

  function renderRules() {
    const lv = st.lv;
    const items = lv.kinds.map((k) => {
      const meta = A.PIECES[k];
      const isNew = firstLevelWith(k) === st.li;
      const sample = k === 'C' ? 'C2' : k;
      return '<li><span class="ic">' + pieceSVG(sample) + '</span><div><strong>' + esc(meta.name) + '</strong>' +
        (isNew ? '<span class="tag">חדש</span>' : '') + '<p>' + esc(meta.rule) + '</p></div></li>';
    }).join('');
    $('rules').innerHTML = '<h2>חוקי הכלים</h2><div class="legend"><ul>' + items + '</ul></div>';
  }

  function renderExamples() {
    const el = $('examples');
    const lv = st.lv;
    if (!lv.hidden) { el.hidden = true; el.innerHTML = ''; return; }
    const r = A.makeExamples(lv.hidden, lv.w, lv.h, lv.exampleSeed);
    const boxes = r.examples.map((ex) => {
      let cells = '';
      for (let i = 0; i < lv.w * lv.h; i++) {
        cells += '<i>' + (i === ex.q ? pieceSVG('Q') : ex.occ[i] ? pieceSVG('X') : '') + '</i>';
      }
      return '<div class="ex ' + (ex.ok ? 'ok' : 'no') + '"><div class="lab">' + (ex.ok ? '✓ חוקי' : '✗ לא חוקי') +
        '</div><div class="mini" style="--w:' + lv.w + '">' + cells + '</div></div>';
    }).join('');
    el.innerHTML = '<h2>◈ מעבדת הגילוי</h2><p class="ex-note">בכל לוח כאן רק ◈ חשוב; הנקודות הן כלים אחרים, מכל סוג. ' +
      'ב-✓ החוק של ◈ מתקיים, וב-✗ לא. מה משותף לכל ה-✓?</p><div class="ex-grid">' + boxes + '</div>';
    el.hidden = false;
  }

  function cellLabel(i) {
    const lv = st.lv;
    const p = st.board[i];
    return 'שורה ' + (((i / lv.w) | 0) + 1) + ', עמודה ' + ((i % lv.w) + 1) + ': ' + (p ? nameOf(p) + (st.fixed[i] ? ' (קבוע)' : '') : 'ריק');
  }

  function renderBoard() {
    const lv = st.lv;
    const rem = remaining();
    st.an = A.analyze(st.board, lv.w, lv.h, lv.hidden || null, rem);
    let html = '';
    for (let i = 0; i < lv.w * lv.h; i++) {
      const p = st.board[i];
      const a = st.an[i];
      let cls = 'cell ' + (p ? (st.fixed[i] ? 'given' : 'placed') : 'empty');
      let title = '';
      if (a && !a.hidden) {
        if (a.s === 'bad') cls += ' bad';
        else if (a.s === 'pending') cls += ' pending';
        title = a.msg;
      }
      if (st.hintCell === i) cls += ' hint';
      html += '<button class="' + cls + '" data-i="' + i + '" role="gridcell" title="' + esc(title) + '" aria-label="' + esc(cellLabel(i)) + '">' +
        (p ? pieceSVG(p) : '') + '</button>';
    }
    const usesMirror = lv.kinds.indexOf('M') >= 0;
    const board = $('board');
    board.style.setProperty('--w', lv.w);
    board.className = st.solved ? 'solved-board' : '';
    board.innerHTML = html + (usesMirror ? '<div class="center-mark" title="מרכז הלוח"></div>' : '');
    paintHover(true);
  }

  function renderTray() {
    const rem = remaining();
    const kinds = Object.keys(st.lv.inventory).sort((a, b) => kindRank(a) - kindRank(b));
    if (!kinds.length) { $('tray').innerHTML = '<span class="empty-tray">אין כלים להנחה</span>'; return; }
    $('tray').innerHTML = kinds.map((k, n) =>
      '<button class="chip' + (st.selected === k ? ' sel' : '') + '" data-p="' + k + '"' + (rem[k] > 0 ? '' : ' disabled') +
      ' aria-label="' + esc(nameOf(k)) + ', נשארו ' + rem[k] + '" aria-pressed="' + (st.selected === k) + '">' +
      '<kbd>' + (n + 1) + '</kbd>' + pieceSVG(k) + '<b>' + rem[k] + '</b></button>').join('');
  }

  function statusInfo() {
    const lv = st.lv;
    const rem = remaining();
    if (st.solved) return { cls: 'good', html: '✓ פתרת את הרמה!' + (st.li < LEVELS.length - 1 ? ' <button class="btn primary nextbtn" data-next="1">לרמה הבאה ←</button>' : ' סיימת את כל הרמות 🎉') };
    if (st.hintMsg) return { cls: 'hint', html: '💡 ' + esc(st.hintMsg) };
    // hovered piece: show its rule (and what is wrong with it)
    const hp = st.hover >= 0 ? st.board[st.hover] : null;
    if (hp && hp[0] !== 'Q') {
      const a = st.an && st.an[st.hover];
      const meta = A.PIECES[hp[0]];
      const bad = a && a.s !== 'ok' && a.msg;
      return { cls: bad && a.s === 'bad' ? 'bad' : '', html: '<b>' + symOf(hp) + ' ' + esc(meta.name) + ':</b> ' + esc(meta.rule) + (bad ? '<br>' + esc(a.msg) : '') };
    }
    if (hp && hp[0] === 'Q') return { cls: '', html: '<b>◈ המסתורי:</b> החוק שלו נסתר. בדוק את הדוגמאות בצד.' };
    const bads = [];
    st.an.forEach((a, i) => { if (a && a.s === 'bad' && !a.hidden) bads.push({ i, a }); });
    if (bads.length) return { cls: 'bad', html: '⚠ ' + esc(bads[0].a.msg) };
    if (total(rem) === 0) return { cls: 'bad', html: 'כל הכלים על הלוח, אבל משהו עוד לא מסתדר' + (lv.hidden ? ' — אולי החוק של ◈?' : '') + '.' };
    return { cls: '', html: 'נשארו להנחה <b>' + total(rem) + '</b> כלים. בחר כלי מהמגש ולחץ על תא ריק. מעבר עם העכבר על כלי מראה את החוק שלו.' };
  }

  function renderStatus() {
    const s = statusInfo();
    const el = $('status');
    el.className = 'status ' + s.cls;
    el.innerHTML = s.html;
  }

  function renderAll() {
    renderNav(); renderIntro(); renderRules(); renderExamples();
    renderBoard(); renderTray(); renderStatus();
  }

  // Hover/focus preview: highlight the cells that the piece "looks at".
  function paintHover(keepStatus) {
    const lv = st.lv;
    const cells = $('board').querySelectorAll('.cell');
    cells.forEach((c) => {
      c.classList.remove('rel', 'focus-cell');
      const g = c.querySelector('.ghost');
      if (g) g.remove();
    });
    const i = st.hover;
    if (i >= 0 && cells[i]) {
      let rel = [];
      if (st.board[i]) rel = A.related(st.board, lv.w, lv.h, i);
      else if (st.selected && !st.solved && (remaining()[st.selected] || 0) > 0) {
        const tmp = st.board.slice();
        tmp[i] = st.selected;
        rel = A.related(tmp, lv.w, lv.h, i);
        cells[i].insertAdjacentHTML('beforeend', '<span class="ghost">' + pieceSVG(st.selected) + '</span>');
      }
      rel.forEach((j) => cells[j].classList.add('rel'));
      cells[i].classList.add('focus-cell');
    }
    if (!keepStatus) renderStatus();
  }

  /* ---------------- actions ---------------- */
  function update(focusI) {
    st.hintMsg = '';
    st.hintCell = -1;
    autoSelect();
    const rem = remaining();
    const lv = st.lv;
    if (total(rem) === 0 && A.violations(st.board, lv.w, lv.h, lv.hidden || null).length === 0) {
      st.solved = true;
      save.solved[lv.id] = true; persist();
    }
    renderNav(); renderBoard(); renderTray(); renderStatus();
    if (focusI != null) {
      const c = $('board').querySelector('[data-i="' + focusI + '"]');
      if (c) c.focus();
    }
    if (st.solved) setTimeout(showWin, 650);
  }

  function onCell(i) {
    if (st.solved) return;
    const cell = $('board').querySelector('[data-i="' + i + '"]');
    if (st.fixed[i]) {
      cell.classList.remove('shake'); void cell.offsetWidth; cell.classList.add('shake');
      return;
    }
    const rem = remaining();
    if (st.board[i]) {
      st.selected = st.board[i];
      st.board[i] = null;
    } else if (st.selected && rem[st.selected] > 0) {
      st.board[i] = st.selected;
    } else {
      const chips = $('tray').querySelectorAll('.chip');
      chips.forEach((c) => { c.classList.remove('nudge'); void c.offsetWidth; c.classList.add('nudge'); });
      return;
    }
    update(i);
  }

  function onChip(p) {
    st.selected = st.selected === p ? null : p;
    renderTray(); paintHover();
  }

  function hint() {
    if (st.solved) return;
    const sol = st.lv.solution;
    let target = -1, msg = '';
    for (let i = 0; i < st.board.length; i++) {
      if (!st.fixed[i] && st.board[i] && st.board[i] !== sol[i]) { target = i; msg = 'הכלי המסומן לא במקום הנכון.'; break; }
    }
    if (target < 0) {
      for (let i = 0; i < st.board.length; i++) {
        if (sol[i] && !st.board[i]) { target = i; msg = 'במקום המסומן צריך לעמוד ' + symOf(sol[i]) + ' (' + nameOf(sol[i]) + ').'; break; }
      }
    }
    if (target < 0) return;
    st.hints++;
    st.hintCell = target;
    st.hintMsg = msg;
    renderBoard(); renderStatus();
  }

  function showWin() {
    const lv = st.lv;
    const last = st.li >= LEVELS.length - 1;
    const stars = st.hints === 0 ? '★★★' : st.hints <= 2 ? '★★☆' : '★☆☆';
    let reveal = '';
    if (lv.hidden) reveal = '<div class="reveal"><b>החוק של ◈ היה:</b><br>' + esc(A.HYP[lv.hidden].text) + '</div>';
    $('modal').innerHTML = '<div class="box" role="dialog" aria-modal="true" aria-label="רמה נפתרה"><h2>' + (last ? 'סיימת את אקסיומה!' : 'פתרת!') + '</h2>' +
      '<div class="stars" aria-label="דירוג">' + stars + '</div>' +
      '<p>' + (st.hints === 0 ? 'בלי רמזים בכלל.' : 'השתמשת ב-' + st.hints + ' רמזים.') + '</p>' + reveal +
      (last ? '<p>זה היה אב-טיפוס של 10 רמות. הרבה יותר כלים וחוקים עוד מחכים.</p>' : '') +
      '<div class="btns">' + (last ? '' : '<button class="btn primary" data-next="1">לרמה הבאה ←</button>') +
      '<button class="btn" data-replay="1">שחק שוב</button><button class="btn ghostbtn" data-close="1">סגור</button></div></div>';
    $('modal').hidden = false;
    const b = $('modal').querySelector('.btn');
    if (b) b.focus();
  }

  /* ---------------- events ---------------- */
  const cellOf = (t) => (t.closest ? t.closest('.cell') : null);

  $('board').addEventListener('click', (e) => { const c = cellOf(e.target); if (c) onCell(+c.dataset.i); });
  $('board').addEventListener('mouseover', (e) => {
    const c = cellOf(e.target);
    const i = c ? +c.dataset.i : -1;
    if (i !== st.hover) { st.hover = i; paintHover(); }
  });
  $('board').addEventListener('mouseleave', () => { st.hover = -1; paintHover(); });
  $('board').addEventListener('focusin', (e) => {
    const c = cellOf(e.target);
    if (c && +c.dataset.i !== st.hover) { st.hover = +c.dataset.i; paintHover(); }
  });
  $('board').addEventListener('keydown', (e) => {
    const c = cellOf(e.target);
    if (!c) return;
    const lv = st.lv;
    const i = +c.dataset.i;
    const x = i % lv.w, y = (i / lv.w) | 0;
    let nx = x, ny = y;
    if (e.key === 'ArrowLeft') nx--; else if (e.key === 'ArrowRight') nx++;
    else if (e.key === 'ArrowUp') ny--; else if (e.key === 'ArrowDown') ny++;
    else return;
    e.preventDefault();
    if (nx < 0 || ny < 0 || nx >= lv.w || ny >= lv.h) return;
    const t = $('board').querySelector('[data-i="' + (ny * lv.w + nx) + '"]');
    if (t) t.focus();
  });

  $('tray').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b && !b.disabled) onChip(b.dataset.p); });
  $('levels').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) startLevel(+b.dataset.go); });
  $('hint').addEventListener('click', hint);
  $('reset').addEventListener('click', () => startLevel(st.li));
  $('status').addEventListener('click', (e) => { if (e.target.closest('[data-next]')) startLevel(st.li + 1); });
  $('modal').addEventListener('click', (e) => {
    if (e.target.closest('[data-next]')) startLevel(st.li + 1);
    else if (e.target.closest('[data-replay]')) startLevel(st.li);
    else if (e.target.closest('[data-close]') || e.target === $('modal')) $('modal').hidden = true;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('modal').hidden) $('modal').hidden = true;
      else { st.selected = null; renderTray(); paintHover(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || st.solved) return;
    if (/^[1-9]$/.test(e.key)) {
      const kinds = Object.keys(st.lv.inventory).sort((a, b) => kindRank(a) - kindRank(b));
      const k = kinds[+e.key - 1];
      if (k && remaining()[k] > 0) onChip(k);
    }
  });

  // expose a tiny hook for automated tests
  window.__axiom = { get state() { return st; }, startLevel };

  /* ---------------- boot ---------------- */
  let first = Math.min(save.level | 0, LEVELS.length - 1);
  startLevel(first);
})();
