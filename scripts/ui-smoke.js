#!/usr/bin/env node
/* UI smoke test: solves every level through the real DOM (Playwright + Chromium).
 *   CI:    npx playwright install --with-deps chromium
 *   Run:   node scripts/ui-smoke.js   (or: npm run smoke)
 */
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const PAGE_URL = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const failures = [];
const fail = (msg) => { failures.push(msg); console.error('FAIL: ' + msg); };
const check = (cond, msg) => { if (!cond) fail(msg); return !!cond; };

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));

  await page.goto(PAGE_URL);
  await page.waitForFunction(() => window.__axiom && window.__axiom.state);

  const S = (fn, arg) => page.evaluate(fn, arg);
  const levelCount = await S(() => window.AXIOM_LEVELS.length);
  check(levelCount > 0, 'no levels found');

  async function openLevel(li) {
    await page.click('#levels button[data-go="' + li + '"]');
    const cur = await S(() => window.__axiom.state.li);
    check(cur === li, 'nav click did not open level index ' + li);
  }

  async function place(piece, cell) {
    const sel = await S(() => window.__axiom.state.selected);
    if (sel !== piece) await page.click('#tray .chip[data-p="' + piece + '"]');
    await page.click('#board .cell[data-i="' + cell + '"]');
  }

  for (let li = 0; li < levelCount; li++) {
    const label = 'level ' + (li + 1);
    await openLevel(li);
    const info = await S(() => {
      const s = window.__axiom.state;
      return { solution: s.lv.solution, board: s.board.slice(), fixed: s.fixed.slice() };
    });
    const N = info.solution.length;
    const missing = [];
    for (let i = 0; i < N; i++) if (info.solution[i] && !info.fixed[i]) missing.push(i);
    check(missing.length > 0, label + ': nothing to place');

    // clicking a fixed cell does nothing
    const fixedIdx = info.fixed.indexOf(true);
    if (fixedIdx >= 0) {
      await page.click('#board .cell[data-i="' + fixedIdx + '"]');
      const after = await S(() => ({ b: window.__axiom.state.board.slice(), solved: window.__axiom.state.solved }));
      check(JSON.stringify(after.b) === JSON.stringify(info.board) && !after.solved, label + ': clicking a fixed cell changed the board');
    }

    // wrong placement: first piece goes to an empty non-solution cell, the rest correctly
    const c0 = missing[0], p0 = info.solution[c0];
    let wrong = -1;
    for (let i = 0; i < N; i++) if (!info.board[i] && !info.solution[i]) { wrong = i; break; }
    if (wrong >= 0) {
      await place(p0, wrong);
      for (const c of missing.slice(1)) await place(info.solution[c], c);
      const early = await S(() => window.__axiom.state.solved);
      check(!early, label + ': level marked solved with a misplaced piece');
      await page.click('#board .cell[data-i="' + wrong + '"]'); // pick it back up (re-selects it)
      await place(p0, c0);
    } else {
      for (const c of missing) await place(info.solution[c], c);
    }

    const solved = await S(() => window.__axiom.state.solved);
    if (!check(solved === true, label + ': not solved after placing the solution')) continue;
    await page.waitForSelector('#modal:not([hidden])', { timeout: 5000 }).catch(() => fail(label + ': win modal never appeared'));
    await page.keyboard.press('Escape');
    const hidden = await S(() => document.getElementById('modal').hidden);
    check(hidden, label + ': Escape did not dismiss the win modal');
    console.log('ok   ' + label + ' (' + missing.length + ' pieces' + (wrong >= 0 ? ', wrong-then-fix' : '') + ')');
  }

  // no horizontal overflow at phone width, on every level
  await page.setViewportSize({ width: 390, height: 844 });
  for (let li = 0; li < levelCount; li++) {
    await openLevel(li);
    const o = await S(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: window.innerWidth }));
    const w = Math.max(o.sw, o.bw);
    check(w <= o.iw, 'level ' + (li + 1) + ': horizontal overflow at 390px (' + w + ' > ' + o.iw + ')');
  }
  console.log('ok   no horizontal overflow at 390px');

  errors.forEach((e) => fail(e));
  await browser.close();
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nUI smoke passed: ' + levelCount + ' levels');
})().catch((e) => { console.error(e); process.exit(1); });
