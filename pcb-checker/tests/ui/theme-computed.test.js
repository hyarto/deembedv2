/* ============================================================================
 * theme-computed.test.js —— 视觉规范的计算样式断言（jsdom 级联后取值）
 * 迁自 main 的 theme-unify-test.js（重构时被删）：
 * 正文 14px；卡片标题 15 / 小节标题 13；统计卡不整块填色、标签 12px、数值 22px；
 * 表格正文 13px；不再使用旧 slate 文字色；卡片无投影、10px 圆角；字体栈。
 * theme-unify.test.js 管静态样式表，本文件管级联后的实际取值，二者互补。
 * ========================================================================== */
'use strict';

const { openPage, readPageCss } = require('../helpers/open-page');

const PAGES = ['index.html', 'copper.html', 'dfm.html', 'fanout.html', 'pour.html', 'unified.html', 'portal.html'];
const SLATE = ['#0f172a', '#64748b', '#475569'];

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (err) { console.error(`  FAIL  ${name} -> ${err.message}`); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const open = {};
for (const p of PAGES) open[p] = openPage(p, { runScripts: false });
const each = fn => PAGES.forEach(p => fn(p, open[p].w, open[p].w.document));

console.log('== 视觉规范：计算样式 ==');

test('正文基准字号 14px', () => each((p, w, d) => {
  const s = w.getComputedStyle(d.body).fontSize;
  assert(s === '14px', `${p} 正文 ${s}`);
}));

test('正文字体栈含 Segoe UI 与 Microsoft YaHei', () => each((p) => {
  assert(/Segoe UI/.test(readPageCss(p).css) && /Microsoft YaHei/.test(readPageCss(p).css), `${p} 字体栈缺失`);
}));

test('卡片标题 15px，卡片内小节标题 13px', () => each((p, w, d) => {
  d.querySelectorAll('.card h2, .card .card-title').forEach(el => {
    const s = w.getComputedStyle(el).fontSize;
    assert(s === '15px', `${p} 卡片标题「${el.textContent.trim().slice(0, 16)}」${s}`);
  });
  d.querySelectorAll('.card h3').forEach(el => {
    const s = w.getComputedStyle(el).fontSize;
    assert(s === '13px', `${p} 小节标题「${el.textContent.trim().slice(0, 16)}」${s}`);
  });
}));

test('卡片：10px 圆角、无投影（边框宽度由 theme-unify 静态断言覆盖，jsdom 不解析 var()）', () => each((p, w, d) => {
  const card = d.querySelector('.card');
  if (!card) return;
  const cs = w.getComputedStyle(card);
  assert(!cs.boxShadow || cs.boxShadow === 'none', `${p} 卡片投影 ${cs.boxShadow}`);
  assert(cs.borderRadius === '10px', `${p} 圆角 ${cs.borderRadius}`);
}));

test('统计卡不整块填色', () => each((p, w, d) => {
  d.querySelectorAll('.stat-box, .stat').forEach(el => {
    const bg = w.getComputedStyle(el).backgroundColor;
    assert(!bg || bg === 'rgb(255, 255, 255)' || bg === 'rgba(0, 0, 0, 0)', `${p} 统计卡底色 ${bg}`);
  });
}));

test('统计卡标签 12px 且不染蓝，数值 22px', () => each((p, w, d) => {
  d.querySelectorAll('.stat-box .lbl, .stat .t').forEach(el => {
    const cs = w.getComputedStyle(el);
    assert(cs.fontSize === '12px', `${p} 统计卡标签 ${cs.fontSize}`);
    assert(cs.color !== 'rgb(29, 78, 216)' && cs.color !== 'rgb(37, 99, 235)', `${p} 统计卡标签染蓝 ${cs.color}`);
  });
  d.querySelectorAll('.stat-box .val, .stat-box .num, .stat .v').forEach(el => {
    const s = w.getComputedStyle(el).fontSize;
    assert(s === '22px', `${p} 统计卡数值 ${s}`);
  });
}));

test('表格正文 13px，且不使用旧 slate 文字色', () => each((p, w, d) => {
  const table = d.querySelector('.card table');
  if (table) {
    const s = w.getComputedStyle(table).fontSize;
    assert(s === '13px', `${p} 表格字号 ${s}`);
  }
  const { css } = readPageCss(p);
  SLATE.forEach(bad => assert(!new RegExp('color:\\s*' + bad, 'i').test(css), `${p} 仍有旧文字色 ${bad}`));
}));

PAGES.forEach(p => open[p].close());
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail) process.exit(1);
