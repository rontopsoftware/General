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
  // a corrupt or hand-edited save must never break boot
  if (!save.solved || typeof save.solved !== 'object' || Array.isArray(save.solved)) save.solved = {};
  save.level = Number.isInteger(save.level) ? Math.max(0, Math.min(LEVELS.length - 1, save.level)) : 0;
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const total = (r) => Object.keys(r).reduce((a, k) => a + r[k], 0);
  const kindRank = (p) => KIND_ORDER.indexOf(p[0]) * 100 + (p.length > 1 ? A.numOf(p) : 0);
  const nameOf = (p) => A.PIECES[p[0]] ? A.PIECES[p[0]].name : 'כלי';
  const symOf = (p) => (p[0] === 'C' ? '⬡' + A.numOf(p) : A.PIECES[p[0]].sym);
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const posText = (i) => 'שורה ' + (((i / st.lv.w) | 0) + 1) + ', עמודה ' + ((i % st.lv.w) + 1);

  // Screen-reader announcements (status line itself is not a live region: it changes on every hover).
  let srTimer = 0;
  function announce(msg) {
    const el = $('sr');
    el.textContent = '';
    clearTimeout(srTimer);
    srTimer = setTimeout(() => { el.textContent = msg; }, 30);
  }

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

  let winTimer = 0;
  const hintLog = {}; // hints used per level until it is solved, so resetting does not restore the star rating
  function startLevel(li) {
    clearTimeout(winTimer); // a pending win modal belongs to the level being left
    li =Math.max(0, Math.min(LEVELS.length - 1, li));
    const lv = LEVELS[li];
    const N = lv.w * lv.h;
    st = {
      li, lv, board: new Array(N).fill(null), fixed: new Array(N).fill(false),
      selected: null, solved: false, hints: hintLog[li] || 0, hintCell: -1, hintMsg: '', hover: -1, an: null,
      history: [], focusI: 0, inspect: -1
    };
    lv.givens.forEach((g) => { st.board[g[0]] = g[1]; st.fixed[g[0]] = true; });
    save.level = li; persist();
    const modalWasOpen = !$('modal').hidden;
    setModal(false);
    autoSelect();
    renderAll();
    if (modalWasOpen) { const c = $('board').querySelector('[tabindex="0"]'); if (c) c.focus(); }
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
      '" title="' + esc(l.title) + '" aria-label="רמה ' + l.id + ': ' + esc(l.title) + (save.solved[l.id] ? ' (נפתרה)' : '') + (l.hidden ? ' (חוק נסתר)' : '') + '"' +
      (i === st.li ? ' aria-current="step"' : '') + '>' + l.id + '</button>').join('');
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
      let cells = '', others = 0;
      for (let i = 0; i < lv.w * lv.h; i++) {
        if (i !== ex.q && ex.occ[i]) others++;
        cells += '<i' + (i === ex.q ? ' class="q"' : '') + '>' + (i === ex.q ? pieceSVG('Q') : ex.occ[i] ? pieceSVG('X') : '') + '</i>';
      }
      const desc = (ex.ok ? 'דוגמה חוקית' : 'דוגמה לא חוקית') + ': ◈ ב' + 'שורה ' + (((ex.q / lv.w) | 0) + 1) + ', עמודה ' + ((ex.q % lv.w) + 1) + ', ועוד ' + others + ' כלים אחרים';
      return '<div class="ex ' + (ex.ok ? 'ok' : 'no') + '" role="group" aria-label="' + esc(desc) + '"><div class="lab"><span class="mk" aria-hidden="true">' + (ex.ok ? '✓' : '✗') + '</span> ' +
        (ex.ok ? 'חוקי' : 'לא חוקי') + '</div><div class="mini" aria-hidden="true" style="--w:' + lv.w + '">' + cells + '</div></div>';
    }).join('');
    el.innerHTML = '<h2>◈ מעבדת הגילוי</h2><p class="ex-note">בכל לוח כאן רק ◈ חשוב; הנקודות הן כלים אחרים, מכל סוג. ' +
      'ב-✓ החוק של ◈ מתקיים, וב-✗ לא. מה משותף לכל ה-✓?</p><div class="ex-grid">' + boxes + '</div>';
    el.hidden = false;
  }

  function cellLabel(i) {
    const lv = st.lv;
    const p = st.board[i];
    let t = posText(i) + ': ' + (p ? nameOf(p) + (st.fixed[i] ? ' (קבוע)' : '') : 'ריק');
    const a = st.an && st.an[i];
    if (p && a && !a.hidden) {
      if (a.s === 'bad') t += ', הכלי מפר את החוק שלו. ' + a.msg;
      else if (a.s === 'pending') t += ', עדיין לא מתקיים, אפשר להשלים. ' + (a.msg || '');
    }
    if (st.hintCell === i) t += ', מסומן ברמז';
    return t;
  }

  function renderBoard() {
    const lv = st.lv;
    const rem = remaining();
    st.an = A.analyze(st.board, lv.w, lv.h, lv.hidden || null, rem);
    let html = '';
    if (st.focusI >= lv.w * lv.h) st.focusI = 0;
    for (let i = 0; i < lv.w * lv.h; i++) {
      if (i % lv.w === 0) html += '<div class="row" role="row">';
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
      html += '<button type="button" class="' + cls + '" data-i="' + i + '" role="gridcell" tabindex="' + (i === st.focusI ? 0 : -1) +
        '" title="' + esc(title) + '" aria-label="' + esc(cellLabel(i)) + '">' + (p ? pieceSVG(p) : '') + '</button>';
      if (i % lv.w === lv.w - 1) html += '</div>';
    }
    const usesMirror = lv.kinds.indexOf('M') >= 0;
    const board = $('board');
    board.style.setProperty('--w', lv.w);
    board.className = st.solved ? 'solved-board' : '';
    board.setAttribute('aria-label', 'לוח ' + lv.w + ' על ' + lv.h);
    board.innerHTML = html + (usesMirror ? '<div class="center-mark" aria-hidden="true" title="מרכז הלוח"></div>' : '');
    paintHover(true);
  }

  function renderTray() {
    const rem = remaining();
    const ae = document.activeElement;
    const keep = ae && $('tray').contains(ae) && ae.dataset ? ae.dataset.p : null;
    const kinds = Object.keys(st.lv.inventory).sort((a, b) => kindRank(a) - kindRank(b));
    if (!kinds.length) { $('tray').innerHTML = '<span class="empty-tray">אין כלים להנחה</span>'; return; }
    $('tray').innerHTML = kinds.map((k, n) =>
      '<button type="button" class="chip' + (st.selected === k ? ' sel' : '') + '" data-p="' + k + '"' + (rem[k] > 0 ? '' : ' disabled') +
      ' aria-label="' + esc(nameOf(k)) + ', נשארו ' + rem[k] + '" aria-pressed="' + (st.selected === k) + '" aria-keyshortcuts="' + (n + 1) + '">' +
      '<kbd aria-hidden="true">' + (n + 1) + '</kbd>' + pieceSVG(k) + '<b aria-hidden="true">' + rem[k] + '</b></button>').join('');
    if (keep) { const b = $('tray').querySelector('[data-p="' + keep + '"]'); if (b && !b.disabled) b.focus(); }
  }

  function renderActions() {
    const u = $('undo');
    const off = !st.history.length || st.solved;
    if (off && document.activeElement === u) {
      const c = $('board').querySelector('[tabindex="0"]');
      u.disabled = true;
      if (c) c.focus();
    }
    u.disabled = off;
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
      const again = st.inspect === st.hover && !st.fixed[st.hover] ? '<br><span class="subtle">הקש שוב על הכלי כדי להסיר אותו.</span>' : '';
      return { cls: bad && a.s === 'bad' ? 'bad' : '', html: '<b>' + symOf(hp) + ' ' + esc(meta.name) + ':</b> ' + esc(meta.rule) +
        (bad ? '<br>' + (a.s === 'bad' ? '<span class="ico" aria-hidden="true">✕</span> ' : '<span class="ico" aria-hidden="true">…</span> ') + esc(a.msg) : '') + again };
    }
    if (hp && hp[0] === 'Q') return { cls: '', html: '<b>◈ המסתורי:</b> החוק שלו נסתר. בדוק את הדוגמאות בצד.' };
    const bads = [];
    st.an.forEach((a, i) => { if (a && a.s === 'bad' && !a.hidden) bads.push({ i, a }); });
    if (bads.length) return { cls: 'bad', html: '<span class="ico" aria-hidden="true">✕</span> ' + esc(bads[0].a.msg) };
    if (total(rem) === 0) return { cls: 'bad', html: 'כל הכלים על הלוח, אבל משהו עוד לא מסתדר' + (lv.hidden ? ' — אולי החוק של ◈?' : '') + '.' };
    return { cls: '', html: 'נשארו להנחה <b>' + total(rem) + '</b> כלים. בחר כלי מהמגש (או גרור) והנח בתא ריק. הקשה/ריחוף על כלי שעל הלוח מראים את החוק שלו.' };
  }

  function renderStatus() {
    const s = statusInfo();
    const el = $('status');
    // don't touch the DOM when nothing changed: replacing a button between mousedown and mouseup would swallow the click
    const key = s.cls + '|' + s.html;
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.className = 'status ' + s.cls;
    el.innerHTML = s.html;
  }

  function renderAll() {
    renderNav(); renderIntro(); renderRules(); renderExamples();
    renderBoard(); renderTray(); renderStatus(); renderActions();
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
  const HIST_MAX = 300;
  function pushHist(i) {
    st.history.push({ board: st.board.slice(), selected: st.selected, i });
    if (st.history.length > HIST_MAX) st.history.shift();
  }

  function focusCell(i) {
    const c = $('board').querySelector('[data-i="' + i + '"]');
    if (c) c.focus();
  }

  function update(focusI) {
    st.hintMsg = '';
    st.hintCell = -1;
    autoSelect();
    const rem = remaining();
    const lv = st.lv;
    if (total(rem) === 0 && A.violations(st.board, lv.w, lv.h, lv.hidden || null).length === 0) {
      st.solved = true;
      delete hintLog[st.li];
      save.solved[lv.id] = true; persist();
    }
    renderNav(); renderBoard(); renderTray(); renderStatus(); renderActions();
    if (focusI != null) focusCell(focusI);
    if (st.solved) {
      announce('פתרת את הרמה!');
      const s = st;
      clearTimeout(winTimer);
      winTimer = setTimeout(() => { if (st === s && st.solved) showWin(); }, reducedMotion() ? 0 : 650);
    }
  }

  // touch=true: a first tap on a piece only inspects it (shows its rule); a second tap removes it.
  function onCell(i, touch) {
    if (st.solved) return;
    const cell = $('board').querySelector('[data-i="' + i + '"]');
    st.focusI = i;
    if (st.fixed[i]) {
      cell.classList.remove('shake'); void cell.offsetWidth; cell.classList.add('shake');
      if (touch) { st.inspect = i; st.hover = i; st.hintMsg = ''; paintHover(); }
      announce(nameOf(st.board[i]) + ' קבוע ולא ניתן להזזה');
      return;
    }
    if (touch && st.board[i] && st.inspect !== i) {
      st.inspect = i; st.hover = i; st.hintMsg = ''; paintHover();
      return;
    }
    st.inspect = -1;
    const rem = remaining();
    let said;
    if (st.board[i]) {
      pushHist(i);
      said = 'הוסר ' + nameOf(st.board[i]) + ' מ' + posText(i);
      st.selected = st.board[i];
      st.board[i] = null;
    } else if (st.selected && rem[st.selected] > 0) {
      pushHist(i);
      st.board[i] = st.selected;
      said = 'הונח ' + nameOf(st.selected) + ' ב' + posText(i);
    } else {
      const chips = $('tray').querySelectorAll('.chip');
      chips.forEach((c) => { c.classList.remove('nudge'); void c.offsetWidth; c.classList.add('nudge'); });
      announce('בחר קודם כלי מהמגש');
      return;
    }
    update(i);
    const a = st.an && st.an[i];
    if (st.board[i] && a && a.s === 'bad' && !a.hidden) said += '. ' + a.msg;
    if (!st.solved) announce(said);
  }

  function onChip(p) {
    // Always selects (a piece is auto-selected after each move, so toggling would surprise a "click chip, click cell" flow); Esc clears.
    st.selected = p;
    st.inspect = -1;
    renderTray(); paintHover();
    announce('נבחר ' + nameOf(p) + ', נשארו ' + remaining()[p]);
  }

  function undo() {
    if (st.solved || !st.history.length) return;
    const h = st.history.pop();
    const ae = document.activeElement;
    const inBoard = !ae || ae === document.body || $('board').contains(ae);
    st.board = h.board;
    st.selected = h.selected;
    st.inspect = -1;
    st.focusI = h.i;
    update(inBoard ? h.i : null);
    announce('הפעולה האחרונה בוטלה' + (st.history.length ? '' : '. אין עוד מה לבטל'));
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
    hintLog[st.li] = st.hints;
    st.hintCell = target;
    st.hintMsg = msg;
    renderBoard(); renderStatus();
    announce(msg.replace('המסומן', 'ב' + posText(target)));
  }

  /* ---------------- win modal ---------------- */
  function setModal(open) {
    ['.top', '.layout', '.foot'].forEach((sel) => {
      const el = document.querySelector(sel);
      if (el) { if (open) el.setAttribute('inert', ''); else el.removeAttribute('inert'); }
    });
    $('modal').hidden = !open;
  }

  function showWin() {
    if (!st || !st.solved) return;
    const lv = st.lv;
    const last = st.li >= LEVELS.length - 1;
    const stars = st.hints === 0 ? '★★★' : st.hints <= 2 ? '★★☆' : '★☆☆';
    const starsTxt = st.hints === 0 ? 'שלושה כוכבים' : st.hints <= 2 ? 'שני כוכבים' : 'כוכב אחד';
    let reveal = '';
    if (lv.hidden) reveal = '<div class="reveal"><b>החוק של ◈ היה:</b><br>' + esc(A.HYP[lv.hidden].text) + '</div>';
    $('modal').innerHTML = '<div class="box" role="dialog" aria-modal="true" aria-labelledby="win-title"><h2 id="win-title">' + (last ? 'סיימת את אקסיומה!' : 'פתרת!') + '</h2>' +
      '<div class="stars" role="img" aria-label="דירוג: ' + starsTxt + '">' + stars + '</div>' +
      '<p>' + (st.hints === 0 ? 'בלי רמזים בכלל.' : 'השתמשת ב-' + st.hints + ' רמזים.') + '</p>' + reveal +
      (last ? '<p>זה היה אב-טיפוס של 10 רמות. הרבה יותר כלים וחוקים עוד מחכים.</p>' : '') +
      '<div class="btns">' + (last ? '' : '<button type="button" class="btn primary" data-next="1">לרמה הבאה ←</button>') +
      '<button type="button" class="btn" data-replay="1">שחק שוב</button><button type="button" class="btn ghostbtn" data-close="1">סגור</button></div></div>';
    setModal(true);
    const b = $('modal').querySelector('.btn');
    if (b) b.focus();
  }

  function closeModal() {
    setModal(false);
    if (st.solved) focusCell(st.focusI);
  }

  /* ---------------- events ---------------- */
  const cellOf = (t) => (t.closest ? t.closest('.cell') : null);

  // Remember what kind of pointer produced the next click: on touch there is no hover, so a tap inspects first.
  let lastPtr = 'mouse';
  $('board').addEventListener('pointerdown', (e) => { lastPtr = e.pointerType || 'mouse'; });

  $('board').addEventListener('click', (e) => {
    const c = cellOf(e.target);
    if (!c) return;
    const touch = e.detail !== 0 && lastPtr !== 'mouse';
    onCell(+c.dataset.i, touch);
  });
  $('board').addEventListener('mouseover', (e) => {
    const c = cellOf(e.target);
    const i = c ? +c.dataset.i : -1;
    if (i !== st.hover) { st.hover = i; paintHover(); }
  });
  $('board').addEventListener('mouseleave', () => { st.hover = -1; paintHover(); });
  $('board').addEventListener('focusin', (e) => {
    const c = cellOf(e.target);
    if (!c) return;
    const i = +c.dataset.i;
    if (i !== st.focusI) {
      const old = $('board').querySelector('[data-i="' + st.focusI + '"]');
      if (old) old.tabIndex = -1;
      st.focusI = i;
      c.tabIndex = 0;
    }
    if (i !== st.hover) { st.hover = i; paintHover(); }
  });
  $('board').addEventListener('focusout', (e) => {
    if (!e.relatedTarget || !$('board').contains(e.relatedTarget)) { st.hover = -1; paintHover(); }
  });
  $('board').addEventListener('keydown', (e) => {
    const c = cellOf(e.target);
    if (!c || e.ctrlKey || e.metaKey || e.altKey) return;
    const lv = st.lv;
    const i = +c.dataset.i;
    // Enter / Space: act ourselves (once, no auto-repeat) so a re-render can never double-fire the native click.
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (!e.repeat) onCell(i, false);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && st.board[i] && !st.fixed[i]) {
      e.preventDefault();
      if (!e.repeat) onCell(i, false);
      return;
    }
    const x = i % lv.w, y = (i / lv.w) | 0;
    let nx = x, ny = y;
    if (e.key === 'ArrowLeft') nx--; else if (e.key === 'ArrowRight') nx++;
    else if (e.key === 'ArrowUp') ny--; else if (e.key === 'ArrowDown') ny++;
    else if (e.key === 'Home') nx = 0; else if (e.key === 'End') nx = lv.w - 1;
    else if (e.key === 'PageUp') ny = 0; else if (e.key === 'PageDown') ny = lv.h - 1;
    else return;
    e.preventDefault();
    if (nx < 0 || ny < 0 || nx >= lv.w || ny >= lv.h) return;
    focusCell(ny * lv.w + nx);
  });
  $('board').addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Spacebar') e.preventDefault(); });

  /* drag a piece from the tray onto a cell (pointer events; the click flow still works) */
  let drag = null, dragSuppress = false;
  function dragTarget(e) {
    const dy = drag.type === 'touch' ? -44 : 0; // keep the finger from hiding the piece
    const el = document.elementFromPoint(e.clientX, e.clientY + dy);
    const c = el && el.closest ? el.closest('.cell') : null;
    return { c, dy };
  }
  function endDrag() {
    if (!drag) return;
    if (drag.el) drag.el.remove();
    $('board').querySelectorAll('.drop-ok, .drop-no').forEach((x) => x.classList.remove('drop-ok', 'drop-no'));
    document.body.classList.remove('dragging');
    drag = null;
  }
  $('tray').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.chip');
    if (!b || b.disabled || st.solved || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { p: b.dataset.p, id: e.pointerId, x: e.clientX, y: e.clientY, active: false, el: null, type: e.pointerType || 'mouse' };
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
      drag.active = true;
      drag.el = document.createElement('div');
      drag.el.className = 'drag-ghost';
      drag.el.innerHTML = pieceSVG(drag.p);
      document.body.appendChild(drag.el);
      document.body.classList.add('dragging');
    }
    const t = dragTarget(e);
    drag.el.style.transform = 'translate(' + e.clientX + 'px,' + (e.clientY + t.dy) + 'px) translate(-50%,-50%)';
    $('board').querySelectorAll('.drop-ok, .drop-no').forEach((x) => x.classList.remove('drop-ok', 'drop-no'));
    if (t.c) t.c.classList.add(st.board[+t.c.dataset.i] ? 'drop-no' : 'drop-ok');
  });
  document.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const was = drag;
    if (was.active) {
      dragSuppress = true;
      setTimeout(() => { dragSuppress = false; }, 60);
      const t = dragTarget(e);
      endDrag();
      if (t.c && !st.solved) {
        const i = +t.c.dataset.i;
        if (!st.board[i] && (remaining()[was.p] || 0) > 0) { st.selected = was.p; onCell(i, false); }
        else { t.c.classList.remove('shake'); void t.c.offsetWidth; t.c.classList.add('shake'); }
      }
    } else endDrag();
  });
  document.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) endDrag(); });
  $('tray').addEventListener('click', (e) => {
    if (dragSuppress) { e.stopPropagation(); return; }
    const b = e.target.closest('.chip');
    if (b && !b.disabled) onChip(b.dataset.p);
  });
  $('tray').addEventListener('contextmenu', (e) => { if (drag && drag.active) e.preventDefault(); });

  $('levels').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) startLevel(+b.dataset.go); });
  $('hint').addEventListener('click', hint);
  $('undo').addEventListener('click', undo);
  $('reset').addEventListener('click', () => startLevel(st.li));
  $('status').addEventListener('click', (e) => { if (e.target.closest('[data-next]')) startLevel(st.li + 1); });
  $('modal').addEventListener('click', (e) => {
    if (e.target.closest('[data-next]')) startLevel(st.li + 1);
    else if (e.target.closest('[data-replay]')) startLevel(st.li);
    else if (e.target.closest('[data-close]') || e.target === $('modal')) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (drag) endDrag();
      else if (!$('modal').hidden) closeModal();
      else { st.selected = null; st.inspect = -1; renderTray(); paintHover(); }
      return;
    }
    // keep keyboard focus inside the win dialog
    if (e.key === 'Tab' && !$('modal').hidden) {
      const f = Array.prototype.slice.call($('modal').querySelectorAll('button:not([disabled])'));
      if (!f.length) return;
      const first = f[0], lastB = f[f.length - 1];
      if (!$('modal').contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastB.focus(); }
      else if (!e.shiftKey && document.activeElement === lastB) { e.preventDefault(); first.focus(); }
      return;
    }
    // undo: Ctrl/Cmd+Z (by physical key, so it also works on a Hebrew layout)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z')) {
      if ($('modal').hidden) { e.preventDefault(); undo(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || st.solved || !$('modal').hidden) return;
    if (/^[1-9]$/.test(e.key)) {
      const kinds = Object.keys(st.lv.inventory).sort((a, b) => kindRank(a) - kindRank(b));
      const k = kinds[+e.key - 1];
      if (k && remaining()[k] > 0) onChip(k);
    }
  });

  // expose a tiny hook for automated tests
  window.__axiom = { get state() { return st; }, startLevel, undo };

  /* ---------------- boot ---------------- */
  let first = Math.min(save.level | 0, LEVELS.length - 1);
  startLevel(first);
})();
