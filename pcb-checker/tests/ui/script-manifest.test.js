/* ============================================================================
 * script-manifest.test.js —— 页面脚本/样式清单审计（AGENTS.md 第 3.3 / 6.5 节）
 * 1. 每页 <script src> 顺序固定：shared 基础 → geometry → engines → pages
 *    → eda-tooltip → eda-shell → ui-prefs（经典脚本共享全局作用域，顺序即依赖）
 * 2. 页面为薄壳：HTML 中无内联 <script> 代码块、无 <style> 块
 * 3. pages/<目录>/ 归属：页面只能引自己的页面包目录，防止跨页误挂 / 漏挂
 * 4. 页面包末尾必须保留 window.* 测试导出块（AGENTS.md 第 6.6 节）
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..');
const PAGES = {
  'portal.html': null,
  'index.html': 'trace',
  'copper.html': 'copper',
  'dfm.html': 'dfm',
  'fanout.html': 'fanout',
  'pour.html': 'pour',
  'unified.html': 'unified'
};

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (err) { console.error(`  FAIL  ${name} -> ${err.message}`); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function scriptsOf(page) {
  return [...fs.readFileSync(path.join(DIR, page), 'utf8')
    .matchAll(/<script src="([^"?]+)(?:\?v=\d+)?"/g)].map(m => m[1]);
}

// §6.5 固定顺序的层级；0 = 未识别（不允许出现）
function rankOf(src) {
  if (/^packages\/shared\/eda-tooltip\.js$/.test(src)) return 5;
  if (/^packages\/shared\/eda-shell\.js$/.test(src)) return 6;
  if (/^packages\/shared\/ui-prefs\.js$/.test(src)) return 7;
  if (/^packages\/shared\//.test(src)) return 1;
  if (/^packages\/geometry\//.test(src)) return 2;
  if (/^packages\/engines\//.test(src)) return 3;
  if (/^packages\/pages\//.test(src)) return 4;
  return 0;
}

console.log('== 页面脚本/样式清单审计（薄壳 + 固定加载顺序） ==');

test('七页 <script src> 均按 shared→geometry→engines→pages→tooltip→shell→ui-prefs 顺序', () => {
  for (const page of Object.keys(PAGES)) {
    const srcs = scriptsOf(page);
    assert(srcs.length >= 2, `${page} 脚本数异常少（${srcs.length}）`);
    let prev = 0;
    for (const s of srcs) {
      const r = rankOf(s);
      assert(r > 0, `${page} 引用了清单外脚本：${s}（新包须先归入 shared/geometry/engines/pages 四层）`);
      assert(r >= prev, `${page} 脚本顺序违规：${s}（层级 ${r}）排在层级 ${prev} 之后`);
      prev = r;
    }
    const tail = srcs.slice(-(srcs.includes('packages/shared/ui-prefs.js') ? 3 : 2));
    assert(tail[0] === 'packages/shared/eda-tooltip.js' && tail[1] === 'packages/shared/eda-shell.js',
      `${page} 尾部必须以 eda-tooltip → eda-shell 收尾，实际：${tail.join(', ')}`);
  }
});

test('六个检查页均以 ui-prefs.js 收尾（界面参数记忆兜底）', () => {
  for (const [page, folder] of Object.entries(PAGES)) {
    if (!folder) continue;
    const srcs = scriptsOf(page);
    assert(srcs[srcs.length - 1] === 'packages/shared/ui-prefs.js', `${page} 末尾缺少 ui-prefs.js`);
  }
});

test('页面薄壳：HTML 无内联 <script> 代码与 <style> 块', () => {
  for (const page of Object.keys(PAGES)) {
    const raw = fs.readFileSync(path.join(DIR, page), 'utf8');
    const inlineScripts = [...raw.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
      .map(m => m[1].trim()).filter(t => t.length > 0);
    assert(inlineScripts.length === 0, `${page} 含 ${inlineScripts.length} 段内联脚本：页面逻辑必须进 packages/pages/<页面>/`);
    assert(!/<style[\s>]/i.test(raw), `${page} 含 <style> 块：页面样式必须进 assets/styles/`);
  }
});

test('页面包归属：页面只能引 packages/pages/<自己目录>/，跨页共享须下沉 shared/engines', () => {
  for (const [page, folder] of Object.entries(PAGES)) {
    if (!folder) continue;
    for (const s of scriptsOf(page)) {
      const m = s.match(/^packages\/pages\/([^/]+)\//);
      if (m) assert(m[1] === folder, `${page} 引用了 ${s}（属于 pages/${m[1]}）：跨页复用应下沉到 shared 或 engines`);
    }
  }
});

test('每页至少一处 window 测试导出块（第 6.6 节约定，root 别名或 window 直挂均可）', () => {
  for (const [page, folder] of Object.entries(PAGES)) {
    if (!folder) continue;
    const mounted = scriptsOf(page).filter(s => /^packages\/pages\//.test(s))
      .filter(s => /\b(?:root|window)\.[A-Za-z_$][\w$]*\s*=/.test(fs.readFileSync(path.join(DIR, s), 'utf8')));
    assert(mounted.length >= 1, `${page} 没有任何页面包向 window 挂载测试接口（root.X = / window.X =）`);
  }
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
