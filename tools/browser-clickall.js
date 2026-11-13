#!/usr/bin/env node
/* ============================================================================
 * browser-clickall.js —— 真实浏览器全按钮点击：逐页载入示例、运行检查，再点击页面内全部按钮，
 * 断言 pageerror / console.error / HTTP 4xx 为零。jsdom 取不到 canvas 2D 上下文，视口绘制只能在这里覆盖。
 * 依赖：playwright（不入库）。用法：node tools/browser-clickall.js [端口]
 * 跳过：清空 / 重置 / 删除 / 清除类按钮在第一轮不点；带 href 的链接不点；dialog 一律取消。
 * ========================================================================== */
'use strict';

const path = require('path');
const { spawn } = require('child_process');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('未安装 playwright：npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const PORT = Number(process.argv[2] || 8138);
const PAGES = ['index', 'copper', 'dfm', 'fanout', 'pour', 'unified'];
const SELECTOR = 'button, [onclick], a.btn';
const PRIMARY = /示例|样本|加载|载入|检查|运行|联检|执行/;
const DESTRUCTIVE = /清空|重置|删除|清除/;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function clickRound(pg, primaryRound, stats, errors) {
  const n = await pg.evaluate(sel => document.querySelectorAll(sel).length, SELECTOR);
  stats.buttons = Math.max(stats.buttons, n);
  for (let i = 0; i < n; i++) {
    const meta = await pg.evaluate(([sel, i]) => {
      const el = document.querySelectorAll(sel)[i];
      return el ? { t: (el.textContent || '').trim(), href: el.getAttribute('href') } : null;
    }, [SELECTOR, i]);
    if (!meta || meta.href) continue;
    if (PRIMARY.test(meta.t) !== primaryRound) continue;
    if (primaryRound && DESTRUCTIVE.test(meta.t)) continue;
    try {
      await pg.evaluate(([sel, i]) => { const el = document.querySelectorAll(sel)[i]; if (el) el.click(); }, [SELECTOR, i]);
      stats.clicked++;
    } catch (e) { errors.push('点击失败「' + meta.t + '」' + e.message.slice(0, 80)); }
    await sleep(primaryRound ? 250 : 15);
  }
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'serve.js'), String(PORT)], { stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch();
  let failed = 0;
  try {
    for (const page of PAGES) {
      const pg = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors = [];
      pg.on('pageerror', e => errors.push('pageerror: ' + e.message.split('\n')[0]));
      pg.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });
      pg.on('response', r => { if (r.status() >= 400) errors.push('http ' + r.status() + ' ' + r.url()); });
      pg.on('dialog', d => d.dismiss().catch(() => {}));
      await pg.goto(`http://localhost:${PORT}/${page}.html`, { waitUntil: 'load' });
      await sleep(300);
      const stats = { buttons: 0, clicked: 0 };
      await clickRound(pg, true, stats, errors);
      await clickRound(pg, false, stats, errors);
      await sleep(400);
      const uniq = [...new Set(errors)];
      console.log(`${uniq.length ? 'FAIL' : 'PASS'}  ${page.padEnd(8)} 按钮 ${String(stats.buttons).padStart(3)}  已点 ${String(stats.clicked).padStart(3)}  报错 ${uniq.length}`);
      uniq.forEach(e => console.log('      ' + e));
      if (uniq.length) failed++;
      await pg.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failed ? `\n${failed} 个页面有报错` : '\n全部页面零报错');
  process.exit(failed ? 1 : 0);
})();
