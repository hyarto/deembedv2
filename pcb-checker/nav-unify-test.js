/* ============================================================================
 * nav-unify-test.js —— 六个检查页「顶栏 + 页签条」统一性回归测试
 *
 * 约定（见 AGENTS.md）：六个页面共用同一份「全站统一顶栏 + 页签条」样式块
 *   - 顶栏：深色 #0f172a 单行，左起 标题（可带 .tag 徽标）→ 灰色副标题 →
 *           右对齐 .navlinks（6 个站内链接，当前页 = 蓝色实心 pill）→ 显示控件
 *   - 页签条：nav#tabs 白底 + 蓝色下划线，5 个页签，文案统一 ①②③④⑤ 起头
 *
 * 本测试逐页断言结构与文案，并校验六页的统一样式块完全一致（防止只改了其中几页）。
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

function loadJsdom() {
  try { return require('jsdom'); }
  catch (e) { throw new Error('找不到 jsdom，请先执行 npm install'); }
}
const { JSDOM, VirtualConsole } = loadJsdom();

const DIR = __dirname;
const PAGES = ['index.html', 'copper.html', 'dfm.html', 'fanout.html', 'pour.html', 'unified.html'];
const NAV_ORDER = [
  ['index.html', '走线检查'],
  ['copper.html', '约束检查'],
  ['dfm.html', '加工能力检查'],
  ['fanout.html', '扇出方案检查'],
  ['pour.html', '铜皮检查'],
  ['unified.html', '综合一体化检查']
];

// 页面里的 <script src="xxx.js"> 在没有服务器时不会被 jsdom 加载，按依赖手动注入
const ENGINE_FILES = {
  'index.html': [],
  'unified.html': ['pad-geom.js', 'copper-check.js', 'dfm-check.js', 'fanout-check.js', 'pour-check.js'],
  'dfm.html': ['pad-geom.js', 'dfm-check.js'],
  'fanout.html': ['fanout-check.js'],
  'copper.html': ['copper-check.js'],
  'pour.html': ['pour-check.js']
};
function engineCode(page) {
  return (ENGINE_FILES[page] || []).map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n;\n');
}

function openPage(page) {
  const html = fs.readFileSync(path.join(DIR, page), 'utf8');
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => {
    const m = String(e && e.message || e);
    if (/Not implemented/.test(m)) return;
    errors.push(m);
  });
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: 'http://localhost/' + page,
    beforeParse(w) {
      const code = engineCode(page);
      if (code) { try { w.eval(code); } catch (e) { errors.push('引擎注入失败: ' + e.message); } }
    }
  });
  return { w: dom.window, d: dom.window.document, errors, close: () => dom.window.close() };
}

const ready = (w, ms = 80) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' -> ' + (e && e.message)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// 提取页面里那块「全站统一顶栏 + 页签条」样式，用于跨页一致性比对
function canonicalBlock(page) {
  const s = fs.readFileSync(path.join(DIR, page), 'utf8');
  const m = s.match(/[ \t]*\/\* ===== 全站统一顶栏 \+ 页签条[\s\S]*?(?=\n[ \t]*<\/style>)/);
  return m ? m[0].trim() : null;
}

(async () => {
  console.log('\n===== 六页顶栏 / 页签条统一性 =====');

  for (const page of PAGES) {
    await test(`${page}：顶栏结构（标题 + 副标题 + 6 个导航 + 显示控件）`, async () => {
      const ctx = openPage(page);
      await ready(ctx.w);
      const d = ctx.d;
      const header = d.querySelector('header');
      assert(header, '缺少 <header>');
      const h1 = header.querySelector('h1');
      assert(h1 && h1.textContent.trim(), '缺少标题');
      const sub = header.querySelector('.sub');
      assert(sub && sub.textContent.trim(), '缺少副标题 .sub');

      const links = [...header.querySelectorAll('.navlinks a')];
      assert(links.length === 6, '导航链接应为 6 个，实际 ' + links.length);
      NAV_ORDER.forEach(([href, label], i) => {
        assert(links[i].getAttribute('href') === href, '第 ' + (i + 1) + ' 个导航 href 应为 ' + href);
        assert(links[i].textContent.trim() === label, '第 ' + (i + 1) + ' 个导航文案应为 ' + label);
      });
      const actives = links.filter(a => a.classList.contains('active'));
      assert(actives.length === 1, '当前页高亮应唯一，实际 ' + actives.length);
      assert(actives[0].getAttribute('href') === page, '当前页高亮错误：' + actives[0].getAttribute('href'));

      const ctrl = header.querySelector('.global-display-ctrl');
      assert(ctrl, '顶栏缺少 .global-display-ctrl');
      assert(ctrl.querySelector('#btnGlobalWide'), '缺少「铺满宽屏」按钮');
      assert(ctx.errors.length === 0, '页面脚本报错：' + ctx.errors[0]);
      ctx.close();
    });
  }

  for (const page of PAGES) {
    await test(`${page}：页签条 5 个页签、统一文案、可切换`, async () => {
      const ctx = openPage(page);
      await ready(ctx.w);
      const d = ctx.d;
      const nav = d.querySelector('nav#tabs');
      assert(nav, '缺少 nav#tabs');
      const btns = [...nav.querySelectorAll('button')];
      assert(btns.length === 5, '页签应为 5 个，实际 ' + btns.length);
      assert(btns.some(b => b.classList.contains('active')), '没有默认选中的页签');

      // 文案统一 ①②③④⑤ 起头，且不再带 emoji
      const CIRCLED = ['①', '②', '③', '④', '⑤'];
      btns.forEach((b, i) => {
        const label = b.textContent.trim();
        assert(label.startsWith(CIRCLED[i]), `第 ${i + 1} 个页签应以 ${CIRCLED[i]} 起头，实际「${label}」`);
        assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(label), `第 ${i + 1} 个页签仍带 emoji：「${label}」`);
      });

      // 点击最后一个页签：应恰好有一个内容区块被激活
      btns[btns.length - 1].click();
      const panes = [...d.querySelectorAll('main > section.tab, .tab-pane')];
      const shown = panes.filter(s => s.classList.contains('active'));
      assert(shown.length === 1, '切换后应恰好有 1 个内容区激活，实际 ' + shown.length);
      assert(btns[btns.length - 1].classList.contains('active'), '切换后页签未高亮');
      ctx.close();
    });
  }

  await test('六页的「统一顶栏 + 页签条」样式块完全一致', async () => {
    const blocks = PAGES.map(p => ({ p, b: canonicalBlock(p) }));
    blocks.forEach(x => assert(x.b, x.p + ' 缺少统一顶栏样式块'));
    const first = blocks[0];
    blocks.forEach(x => assert(x.b === first.b,
      x.p + ' 的统一顶栏样式块与 ' + first.p + ' 不一致（只改了部分页面）'));
    // 关键规则必须存在
    ['header{flex:none;background:#0f172a', 'header .navlinks a.active{background:#0284c7',
      'nav#tabs{flex:none;display:flex', 'nav#tabs button.active{color:#2563eb'].forEach(k => {
      assert(first.b.includes(k), '统一块缺少关键规则：' + k);
    });
  });

  await test('六页均已清除旧的顶栏 / 页签样式（深色页签、sticky 工具条、unified 双行头部）', async () => {
    PAGES.forEach(p => {
      const s = fs.readFileSync(path.join(DIR, p), 'utf8');
      [
        ['nav#tabs{background:#1e293b', '深色页签条'],
        ['nav.bar', '旧 sticky 页签类'],
        ['.tab-nav', 'unified 旧页签类'],
        ['.header-desc', 'unified 旧双行头部'],
        ['.header-title', 'unified 旧双行头部']
      ].forEach(([needle, what]) => {
        assert(!s.includes(needle), p + ' 仍残留' + what + '（' + needle + '）');
      });
    });
  });

  console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
  if (fail) process.exit(1);
})();
