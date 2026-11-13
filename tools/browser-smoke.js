#!/usr/bin/env node
/* ============================================================================
 * browser-smoke.js —— 真实浏览器冒烟：逐页逐工序点击，载入示例并联检，断言控制台零报错
 * 依赖：playwright（不入库，按需 npm i -D playwright 并 npx playwright install chromium）
 * 用法：node tools/browser-smoke.js
 * ========================================================================== */
'use strict';

const path = require('path');
const { spawn } = require('child_process');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('未安装 playwright：npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const PORT = 8137;
const BASE = 'http://localhost:' + PORT + '/';
const PAGES = ['portal', 'index', 'copper', 'dfm', 'fanout', 'pour', 'unified'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function openWatched(browser, page) {
  const pg = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  pg.on('pageerror', e => errors.push('pageerror: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  pg.on('response', r => { if (r.status() >= 400) errors.push('http ' + r.status() + ' ' + r.url()); });
  const t0 = Date.now();
  await pg.goto(BASE + page + '.html', { waitUntil: 'load' });
  return { pg, errors, loadMs: Date.now() - t0 };
}

async function clickAllTabs(pg) {
  const n = await pg.locator('nav#tabs button[data-tab]').count();
  for (let i = 0; i < n; i++) await pg.locator('nav#tabs button[data-tab]').nth(i).click();
  return n;
}

const SCENARIOS = {
  async unified(pg) {
    const r = await pg.evaluate(() => { loadUnifiedSampleData(); runMasterInspection(); return document.body.innerText; });
    await sleep(300);
    const m = await pg.evaluate(() => (typeof window.getUnifiedSummary === 'function') ? window.getUnifiedSummary() : null);
    return r.length > 0 ? 'unified 联检完成' + (m ? ' ' + JSON.stringify(m) : '') : 'unified 无输出';
  },
  async dfm(pg) {
    await pg.click('nav#tabs button[data-tab]:nth-child(1)');
    await pg.evaluate(() => document.getElementById('btnAddLayerRule') && document.getElementById('btnAddLayerRule').click());
    const rows = await pg.locator('#layerRuleBody tr[data-row]').count();
    if (rows !== 1) throw new Error('加一条分层规则后行数应为 1，实际 ' + rows);
    return 'dfm 分层规则新增正常';
  }
};

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'serve.js'), String(PORT)], { stdio: 'ignore' });
  await sleep(600);
  const browser = await chromium.launch();
  let failed = 0;
  try {
    for (const page of PAGES) {
      const { pg, errors, loadMs } = await openWatched(browser, page);
      let note = '';
      try {
        const tabs = await clickAllTabs(pg);
        if (SCENARIOS[page]) note = await SCENARIOS[page](pg);
        await sleep(100);
        console.log(`${errors.length ? 'FAIL' : 'PASS'}  ${page.padEnd(8)} 加载 ${String(loadMs).padStart(4)} ms  工序 ${tabs}  ${note}`);
      } catch (e) { errors.push(e.message); console.log(`FAIL  ${page}  ${e.message}`); }
      errors.forEach(e => console.log('      ' + e));
      if (errors.length) failed++;
      await pg.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failed ? `\n${failed} 个页面失败` : '\n全部页面通过');
  process.exit(failed ? 1 : 0);
})();
