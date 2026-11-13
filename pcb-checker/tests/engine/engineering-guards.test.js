/* ============================================================================
 * engineering-guards.test.js —— AGENTS.md 第 3 节工程化硬约束的自动化守卫
 * 1. packages/ 下单个 JS 文件 ≤ 600 行（超标必须拆分）
 * 2. >80 行函数数量棘轮：只降不升（当前基线 55）
 * 3. 已知超标 HTML/CSS 清单行数封顶：只能降不能涨
 * 4. 引擎与几何包不得直接访问 document / window（UMD 守卫分支除外）
 * 5. 经典脚本共享全局作用域：同页加载的包之间不得有同名顶层 function
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const PKG_DIR = path.join(__dirname, '..', '..', 'packages');
const PAGES_DIR = path.join(__dirname, '..', '..');
const HTML_PAGES = ['portal.html', 'index.html', 'copper.html', 'dfm.html', 'fanout.html', 'pour.html', 'unified.html'];

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (err) { console.error(`  FAIL  ${name} -> ${err.message}`); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function walk(dir, out) {
  out = out || [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

// 定位 function 声明行及其行数：
// - collectAll=true：UMD 闭包内的嵌套函数也计入（AGENTS.md 第 3 节口径，
//   首个匹配到的函数开始计行直到闭合，期间不再嵌套匹配）——用于超长函数棘轮；
// - collectAll=false：只统计全局作用域（深度 0）的顶层声明——用于同名函数冲突检测。
function functionSpans(code, collectAll) {
  const lines = code.split('\n');
  const spans = [];
  let depth = 0;
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (m && (collectAll ? !cur : depth === 0)) {
      cur = { name: m[1], start: i, rel: 0, opened: false };
    }
    if (cur) {
      for (const ch of line) { if (ch === '{') { cur.rel++; cur.opened = true; } else if (ch === '}') cur.rel--; }
      if (cur.opened && cur.rel === 0) { spans.push({ name: cur.name, start: cur.start, len: i - cur.start + 1 }); cur = null; }
    } else {
      for (const ch of line) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    }
  }
  return spans;
}

console.log('== 工程化硬约束守卫（AGENTS.md 第 3 / 6 / 9 节） ==');

test('packages/ 下单个 JS 文件均 ≤ 600 行', () => {
  const files = walk(PKG_DIR);
  assert(files.length > 50, 'packages 下脚本数异常少（' + files.length + '），目录结构可能被破坏');
  const over = files
    .map(f => ({ f: path.relative(PKG_DIR, f), n: fs.readFileSync(f, 'utf8').split('\n').length - (fs.readFileSync(f, 'utf8').endsWith('\n') ? 1 : 0) }))
    .filter(o => o.n > 600)
    .sort((a, b) => b.n - a.n);
  assert(over.length === 0, '超标文件必须拆分：' + over.map(o => `${o.f}=${o.n}`).join(', '));
});

test('超长函数（>80 行）棘轮：数量只降不升，基线 55', () => {
  const over = [];
  for (const f of walk(PKG_DIR)) {
    const rel = path.relative(PKG_DIR, f);
    for (const s of functionSpans(fs.readFileSync(f, 'utf8'), true)) {
      if (s.len > 80) over.push({ f: rel, name: s.name, len: s.len });
    }
  }
  over.sort((a, b) => b.len - a.len);
  console.log('        当前 >80 行函数 ' + over.length + ' 个，最大三个：' +
    over.slice(0, 3).map(o => `${o.name}(${o.len})`).join(', '));
  assert(over.length <= 55, `超长函数增至 ${over.length} 个（基线 55），新增代码不得继续堆大函数，顺手拆分：${over.slice(0, 6).map(o => o.name).join(', ')}`);
});

test('已知超标 HTML / CSS 清单行数封顶（拆分清单只降不升）', () => {
  const CAPS = {
    'unified.html': 1339,
    'fanout.html': 664,
    'dfm.html': 636
  };
  for (const [rel, cap] of Object.entries(CAPS)) {
    const abs = path.join(PAGES_DIR, rel);
    assert(fs.existsSync(abs), rel + ' 不存在（拆分后用例上限需同步更新）');
    const n = fs.readFileSync(abs, 'utf8').split('\n').length - (fs.readFileSync(abs, 'utf8').endsWith('\n') ? 1 : 0);
    assert(n <= cap, `${rel} 行数 ${n} 超过上限 ${cap}：超标文件只能降不能涨，动它时请拆分而不是往上堆`);
  }
});

test('引擎与几何包零 DOM 依赖：document./window. 只允许出现在 typeof 守卫分支', () => {
  const dirs = [path.join(PKG_DIR, 'engines'), path.join(PKG_DIR, 'geometry')];
  const bad = [];
  for (const dir of dirs) {
    for (const f of walk(dir)) {
      const rel = path.relative(PKG_DIR, f);
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!/\b(?:window|document)\s*\./.test(l)) continue;
        if (/typeof\s+(?:window|document|globalThis)/.test(l)) continue;
        // 允许完全位于 `if (typeof window !== "undefined") { ... }` 守卫内的挂载行
        const windowGuarded = lines.slice(Math.max(0, i - 2), i)
          .some(prev => /if\s*\(\s*typeof\s+window\s*!==\s*["']undefined["']\s*\)\s*\{?\s*$/.test(prev));
        if (windowGuarded) continue;
        bad.push(`${rel}:${i + 1} ${l.trim().slice(0, 80)}`);
      }
    }
  }
  assert(bad.length === 0, '引擎/几何不得访问 DOM，计算请留在引擎、DOM 操作放页面包：\n  ' + bad.join('\n  '));
});

test('经典脚本全局作用域：同一页面加载的包之间无同名顶层 function', () => {
  const collisions = [];
  for (const page of HTML_PAGES) {
    const html = fs.readFileSync(path.join(PAGES_DIR, page), 'utf8');
    const srcs = [...html.matchAll(/<script src="([^"?]+)(?:\?v=\d+)?"/g)].map(m => m[1]);
    const seen = new Map();
    for (const rel of srcs) {
      const abs = path.join(PAGES_DIR, rel);
      if (!fs.existsSync(abs)) throw new Error(`${page} 引用的 ${rel} 不存在`);
      for (const s of functionSpans(fs.readFileSync(abs, 'utf8'), false)) {
        if (seen.has(s.name)) {
          collisions.push(`${page}: ${s.name} 同时定义于 ${seen.get(s.name)} 与 ${rel}（后者覆盖前者，重名必须改名）`);
        } else {
          seen.set(s.name, rel);
        }
      }
    }
  }
  assert(collisions.length === 0, '同名顶层 function 冲突：\n  ' + collisions.join('\n  '));
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
