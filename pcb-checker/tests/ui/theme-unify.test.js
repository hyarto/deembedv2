/* ============================================================================
 * theme-unify.test.js —— 全站视觉规范一致性测试（令牌、字号阶梯、卡片、文案规范）
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { CHECKER_DIR, readPageCss } = require('../helpers/open-page');

const PAGES = ['index.html', 'copper.html', 'dfm.html', 'fanout.html', 'pour.html', 'unified.html', 'portal.html'];
const STYLES = path.join(CHECKER_DIR, 'assets/styles');
const LADDER = new Set([0, 11, 12, 13, 14, 15, 16, 18, 22]);
/* 工程师读不到有用信息的套话，页面静态文案里不允许出现 */
const FLUFF = ['极佳', '完整保留', '一键', '极致', '智能化', '赋能', '欢迎使用', '为您', '强大的', '全方位', '一站式', '傻瓜式'];

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (err) { console.error(`  FAIL  ${name} -> ${err.message}`); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const read = rel => fs.readFileSync(path.join(STYLES, rel), 'utf8');
const stripScripts = html => html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
const visibleText = html => stripScripts(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');

console.log('== 全站视觉规范与文案规范 ==');

test('设计令牌：主色板与字体栈', () => {
  const t = read('tokens.css').replace(/\s+/g, '').toLowerCase();
  ['--bg:#f4f6f9', '--line:#e3e8ef', '--txt:#1f2937', '--sub:#6b7280', '--pri:#2563eb', '--pri-hover:#1d4ed8'].forEach(k => {
    assert(t.includes(k), '令牌缺失：' + k);
  });
  assert(/Segoe UI/.test(read('tokens.css')) && /Microsoft YaHei/.test(read('tokens.css')), '字体栈缺少 Segoe UI / 微软雅黑');
});

test('卡片：白底 + 1px 边框 + 10px 圆角 + 无投影，页面样式不得覆盖成带投影', () => {
  const c = read('components.css');
  const m = c.match(/\n\.card\s*\{([^}]*)\}/);
  assert(m, 'components.css 缺少 .card');
  const body = m[1].replace(/\s+/g, '');
  assert(body.includes('border:1pxsolidvar(--line)'), '.card 边框不是 1px solid var(--line)');
  assert(body.includes('border-radius:10px'), '.card 圆角不是 10px');
  assert(body.includes('box-shadow:none'), '.card 必须无投影');
  for (const page of PAGES) {
    const { own } = readPageCss(page);
    const blocks = [...own.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    blocks.forEach(([, sel, decl]) => {
      if (/(^|[\s,.])(card|stat-box|dash-card|stat)(\b|[.:\s,{])/.test(sel.trim()) && /box-shadow:\s*(?!none)[^;]*\d/.test(decl)) {
        throw new Error(`${page} 的 ${sel.trim()} 带投影`);
      }
    });
  }
});

test('字号只用统一阶梯 11 / 12 / 13 / 14 / 15 / 16 / 18 / 22px', () => {
  for (const page of PAGES) {
    const { css } = readPageCss(page);
    for (const m of css.matchAll(/font-size:\s*([0-9.]+)(px|em|rem|%)?/g)) {
      const v = Number(m[1]);
      assert(m[2] === 'px' || v === 0, `${page} 使用了非 px 字号 ${m[0]}`);
      assert(LADDER.has(v), `${page} 使用了阶梯外字号 ${m[0]}`);
    }
  }
});

test('不再使用旧天蓝 #0284c7，标题字号不靠行内 style 特例', () => {
  for (const page of PAGES) {
    const { css, full } = readPageCss(page);
    assert(!/#0284c7/i.test(css), `${page} 样式仍含 #0284c7`);
    assert(!/<h[1-4][^>]*style="[^"]*font-size/i.test(full), `${page} 的标题含行内 font-size`);
  }
});

test('标题与表头不放 emoji / 图标字符', () => {
  const pict = /\p{Extended_Pictographic}/u;
  for (const page of PAGES) {
    const html = stripScripts(fs.readFileSync(path.join(CHECKER_DIR, page), 'utf8'));
    for (const m of html.matchAll(/<(h[1-4]|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const t = m[2].replace(/<[^>]+>/g, '');
      assert(!pict.test(t), `${page} 标题含图标字符：${t.trim()}`);
    }
  }
});

test('静态标题、标签、表头、工序按钮不含括号解释（统一改为悬浮 data-tip）', () => {
  for (const page of PAGES) {
    const html = stripScripts(fs.readFileSync(path.join(CHECKER_DIR, page), 'utf8'));
    for (const m of html.matchAll(/<(h[1-4]|th|label|button|summary)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      if (/\sid="/.test(m[2])) continue;
      const t = m[3].replace(/<[^>]+>/g, '').trim();
      if (/[（(][^）)]*[\u4e00-\u9fff][^）)]*[）)]/.test(t)) throw new Error(`${page} 含括号解释：${t.slice(0, 60)}`);
    }
  }
});

test('静态文案不含无信息量的套话', () => {
  for (const page of PAGES) {
    const text = visibleText(fs.readFileSync(path.join(CHECKER_DIR, page), 'utf8'));
    FLUFF.forEach(w => assert(!text.includes(w), `${page} 含套话「${w}」`));
  }
});

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? jsFiles(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
}

test('全部页面包与引擎的提示文案不含「成功」「！」「一键」', () => {
  for (const f of jsFiles(path.join(CHECKER_DIR, 'packages'))) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      const code = l.replace(/\/\/.*$/, '');
      if (/alert\(|showToast\(|message:|textContent\s*=|<button|<span|<div/.test(code) && /成功|！|一键/.test(code)) {
        throw new Error(`${path.relative(CHECKER_DIR, f)}:${i + 1} ${l.trim().slice(0, 90)}`);
      }
    });
  }
});

test('HTML 不使用原生 title 属性，补充说明统一用 data-tip', () => {
  for (const page of PAGES) {
    const html = stripScripts(fs.readFileSync(path.join(CHECKER_DIR, page), 'utf8'));
    const m = html.match(/<[a-z][^>]*\stitle="[^"]*"/i);
    assert(!m, `${page} 使用了原生 title：${m && m[0].slice(0, 80)}`);
  }
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
