/* ============================================================================
 * eda-shell-unify.test.js —— 六个检查页的三栏 EDA 壳层一致性测试
 * 左：模块导航 + 工序流程；中：阶段条 + 主视口；右：功能与检视工具栏
 * ========================================================================== */
'use strict';

const { openPage, tick, readPageCss } = require('../helpers/open-page');

const PAGES = {
  'index.html': 5,
  'copper.html': 5,
  'dfm.html': 5,
  'fanout.html': 5,
  'pour.html': 5,
  'unified.html': 6
};
const SHELL_CSS = ['tokens.css', 'eda-shell.css', 'components.css'];
const SHELL_JS = ['eda-tooltip.js', 'eda-shell.js', 'ui-prefs.js'];

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (err) { console.error(`  FAIL  ${name} -> ${err.message}`); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

(async () => {
  console.log('== 三栏 EDA 壳层一致性（左导航 / 中视口 / 右工具） ==');

  for (const [page, tabCount] of Object.entries(PAGES)) {
    await test(`${page}：左导轨含模块导航与 ${tabCount} 个工序，右侧为工具区，顶部无横向导航`, async () => {
      const raw = readPageCss(page).full;
      SHELL_CSS.forEach(f => assert(raw.includes('assets/styles/' + f), '缺少共享样式 ' + f));
      SHELL_JS.forEach(f => assert(raw.includes('packages/shared/' + f), '缺少共享脚本 ' + f));

      const ctx = openPage(page, { syncCheck: true });
      await tick(120);
      const { d, w } = ctx;
      assert(d.body.classList.contains('eda-workbench'), '缺少 body.eda-workbench');

      const rail = d.querySelector('aside.eda-left-rail');
      assert(rail, '缺少左导轨');
      const links = [...rail.querySelectorAll('.navlinks a')].map(a => a.getAttribute('href'));
      assert(links.length === 6 && Object.keys(PAGES).every(p => links.includes(p)), '左导轨应含六个模块链接：' + links.join(','));
      const active = rail.querySelectorAll('.navlinks a.active');
      assert(active.length === 1 && active[0].getAttribute('href') === page, '当前模块高亮错误');
      rail.querySelectorAll('.navlinks a').forEach(a => assert(a.getAttribute('data-tip'), '模块链接缺少悬浮提示：' + a.textContent));

      const tabs = [...rail.querySelectorAll('nav#tabs button[data-tab]')];
      assert(tabs.length === tabCount, `工序数应为 ${tabCount}，实际 ${tabs.length}`);
      tabs.forEach(b => assert(d.getElementById(b.dataset.tab) || d.getElementById('tab-' + b.dataset.tab), '工序目标面板不存在：' + b.dataset.tab));
      tabs.forEach(b => assert(b.getAttribute('data-tip'), '工序缺少悬浮提示：' + b.textContent.trim()));

      assert(d.querySelector('.eda-center-col .eda-stage-bar #btnEdaNextStage'), '缺少阶段条与下一工序按钮');
      assert(d.querySelector('.eda-center-col main'), '缺少主视口 main');
      const dock = d.querySelector('aside.eda-right-dock');
      assert(dock && dock.querySelectorAll('.eda-dock-panel').length >= 2, '右侧工具栏面板不足');
      assert(!d.querySelector('body > header'), '顶部仍有横向 header');
      assert(!d.querySelector('body > nav#tabs'), '页签条仍在顶部');

      /* 侧栏折叠与工序推进 */
      d.getElementById('btnToggleLeftRail').click();
      assert(d.documentElement.classList.contains('eda-rail-collapsed'), '左导轨未折叠');
      d.getElementById('btnToggleLeftRail').click();
      d.getElementById('btnToggleRightDock').click();
      assert(d.documentElement.classList.contains('eda-dock-collapsed'), '右工具栏未折叠');
      d.getElementById('btnToggleRightDock').click();

      /* 逐个点击工序：恰有一个页签与一个面板处于 active */
      for (const b of tabs) {
        b.click();
        await tick(10);
        assert(b.classList.contains('active'), '点击后页签未激活：' + b.textContent.trim());
        assert(d.querySelectorAll('nav#tabs button.active').length === 1, '同时激活多个页签');
        const panel = d.querySelector('section.tab#' + b.dataset.tab + ', section.tab#tab-' + b.dataset.tab + ', .tab-pane#' + b.dataset.tab);
        assert(panel && panel.classList.contains('active'), '工序面板未显示：' + b.dataset.tab);
        assert(d.querySelectorAll('section.tab.active, .tab-pane.active').length === 1, '同时显示多个工序面板');
      }
      tabs[0].click();
      await tick(10);

      d.getElementById('btnEdaNextStage').click();
      await tick(30);
      assert(tabs[1].classList.contains('active'), '下一工序未推进到第 2 个页签');
      assert(tabs[0].classList.contains('step-done'), '已完成工序未标记 step-done');
      assert(d.getElementById('edaActiveStageLabel').textContent.trim() === tabs[1].childNodes[0].textContent.trim(), '面包屑未同步');
      assert(!ctx.errors.length, '页面脚本报错：' + ctx.errors[0]);
      ctx.close();
    });
  }

  await test('各页面引用独立的页面样式文件', () => {
    const own = {};
    for (const page of Object.keys(PAGES)) {
      own[page] = readPageCss(page).full.match(/href="assets\/styles\/pages\/[a-z-]+\.css/g) || [];
      assert(own[page].length === 1, `${page} 应恰好引用 1 个页面样式文件`);
    }
    const set = new Set(Object.values(own).map(a => a[0]));
    assert(set.size === 6, '页面样式文件应各不相同');
  });

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) process.exit(1);
})();
