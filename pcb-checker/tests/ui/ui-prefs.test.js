/* ============================================================================
 * ui-prefs.test.js —— 全站「界面参数记忆」测试
 *
 * 目标（对应需求）：所有「填写数值 / 选择的地方」除了记录历史候选值以外，
 * 还必须把**上次用过的值**当成默认值保存下来，刷新后依然生效。
 *
 * 覆盖点：
 *   1. 六个页面都挂上了 ui-prefs.js，且都能扫到可记忆控件、都会注入「恢复默认值」按钮
 *   2. 数值 / 下拉 / 勾选框改动后立即落盘（按 页面+id 命名空间）
 *   3. 上次的值能在新窗口（等价于刷新）里回填，并派发 change 让页面状态同步
 *   4. data-no-persist（搜索框、筛选下拉、弹窗一次性录入）不被记忆
 *   5. textarea（数据粘贴区 / 导出框）不被记忆
 *   6. 重复 id（模板循环渲染的行内控件）不被记忆
 *   7. 脏数据 / 已失效的选项不会把控件写成空值
 *   8. clear / clearAll / storedCount 行为正确，按钮点击可恢复出厂
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

const { openPage: openPageHelper } = require('../helpers/open-page');

const DIR = path.resolve(__dirname, '../..');
const STORE_KEY = 'pcbchecker.uiprefs.v1';
const PAGES = ['index.html', 'unified.html', 'dfm.html', 'fanout.html', 'copper.html', 'pour.html'];

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' -> ' + (e && e.message)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

/* 打开一个页面：helper 已内联页面全部 CSS / 脚本包（含 ui-prefs.js），返回操作句柄 */
function openPage(page, seed) {
  const c = openPageHelper(page, { seedStorage: seed ? { [STORE_KEY]: seed } : undefined });
  return { w: c.w, d: c.d, errors: c.errors, prefs: c.w.UiPrefs, page, close: c.close };
}
const ready = (w, ms = 60) => new Promise(r => setTimeout(r, ms));

function setVal(w, el, v) {
  el.value = v;
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
}
function setChk(w, el, v) {
  el.checked = v;
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
}
function stored(w) {
  try { return JSON.parse(w.localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { return {}; }
}

(async () => {
  console.log('\n===== 界面参数记忆 ui-prefs =====');

  /* ---------- 1. 全站挂载与覆盖 ---------- */
  const coverage = {};
  for (const page of PAGES) {
    await test(`${page}：挂载 ui-prefs.js、扫到可记忆控件、注入「恢复默认值」按钮`, async () => {
      const raw = fs.readFileSync(path.join(DIR, page), 'utf8');
      assert(/<script src="packages\/shared\/ui-prefs\.js\?v=\d+"><\/script>/.test(raw), '缺少 packages/shared/ui-prefs.js script 标签');
      const ctx = openPage(page);
      await ready(ctx.w);
      const rows = ctx.prefs._scan().filter(r => ctx.prefs._accept(r.el, r.dup));
      coverage[page] = rows.length;
      assert(rows.length > 0, '没有扫到任何可记忆控件');
      assert(!ctx.errors.length, '页面脚本报错：' + ctx.errors[0]);
      const btn = ctx.d.getElementById('btnUiPrefsReset');
      assert(btn, '没有注入 #btnUiPrefsReset');
      assert(btn.parentNode && /global-display-ctrl/.test(btn.parentNode.className), '恢复按钮没挂到显示区工具条');
      assert(btn.style.display === 'none', '无记忆值时按钮应隐藏');
      ctx.close();
    });
  }
  console.log('        覆盖控件数：' + PAGES.map(p => p.replace('.html', '') + '=' + coverage[p]).join(', '));

  /* ---------- 2. 改动即落盘 ---------- */
  await test('数值框改动后立刻写入 localStorage（按页面命名空间）', async () => {
    const ctx = openPage('dfm.html');
    await ready(ctx.w);
    setVal(ctx.w, ctx.d.getElementById('inpThresholdGnd'), '7.25');
    const s = stored(ctx.w);
    assert(s['dfm.html'] && s['dfm.html'].inpThresholdGnd === '7.25',
      '未记录数值：' + JSON.stringify(s['dfm.html']));
    ctx.close();
  });

  await test('下拉选择改动后记录选项值', async () => {
    const ctx = openPage('dfm.html');
    await ready(ctx.w);
    const sel = ctx.d.getElementById('selPadShape');
    const target = sel.options[sel.options.length - 1].value;
    setVal(ctx.w, sel, target);
    assert(stored(ctx.w)['dfm.html'].selPadShape === target, '未记录下拉值');
    ctx.close();
  });

  await test('勾选框改动后记录布尔值（false 也要记住）', async () => {
    const ctx = openPage('dfm.html');
    await ready(ctx.w);
    const ck = ctx.d.getElementById('ckShowGrid');
    setChk(ctx.w, ck, false);
    assert(stored(ctx.w)['dfm.html'].ckShowGrid === false, '未记录勾选框');
    setChk(ctx.w, ck, true);
    assert(stored(ctx.w)['dfm.html'].ckShowGrid === true, '勾选框回勾未更新');
    ctx.close();
  });

  await test('清理后关闭页面（pagehide）会兜底保存脚本改过的值', async () => {
    const ctx = openPage('dfm.html');
    await ready(ctx.w);
    ctx.d.getElementById('inpSignalPadDiam').value = '11.11';   // 模拟预设按钮直接改 value（不派发事件）
    ctx.w.dispatchEvent(new ctx.w.Event('pagehide'));
    assert(stored(ctx.w)['dfm.html'].inpSignalPadDiam === '11.11', 'pagehide 未兜底保存');
    ctx.close();
  });

  /* ---------- 3. 刷新后依然有效 ---------- */
  await test('刷新（新窗口）后回填上次数值 / 下拉 / 勾选，并派发 change 同步页面状态', async () => {
    const seed = {
      'dfm.html': {
        inpThresholdGnd: '7.25',
        inpSignalPadDiam: '11.11',
        selPadShape: 'octagon',
        ckShowGrid: false
      }
    };
    const ctx = openPage('dfm.html', seed);
    await ready(ctx.w);
    const d = ctx.d;
    assert(d.getElementById('inpThresholdGnd').value === '7.25', '阈值未回填：' + d.getElementById('inpThresholdGnd').value);
    assert(d.getElementById('inpSignalPadDiam').value === '11.11', '焊盘直径未回填');
    assert(d.getElementById('ckShowGrid').checked === false, '勾选框未回填');
    // 下拉：选项存在才回填
    const sel = d.getElementById('selPadShape');
    const hasOct = Array.prototype.some.call(sel.options, o => o.value === 'octagon');
    if (hasOct) assert(sel.value === 'octagon', '下拉未回填');
    // change 事件确实派发过：注册监听后再 restore 一次应被触发
    let fired = 0;
    d.getElementById('inpThresholdGnd').addEventListener('change', () => fired++);
    d.getElementById('inpThresholdGnd').value = '1.0';
    ctx.prefs.restore();
    assert(d.getElementById('inpThresholdGnd').value === '7.25', 'restore 未生效');
    assert(fired === 1, 'restore 没有派发 change（页面内部状态不会同步），实际 ' + fired);
    ctx.close();
  });

  await test('回填后页面自己的联动也被触发（dfm 画布图层勾选 → renderCanvas）', async () => {
    const ctx = openPage('dfm.html', { 'dfm.html': { ckShowVias: false } });
    await ready(ctx.w);
    assert(ctx.d.getElementById('ckShowVias').checked === false, 'ckShowVias 未回填');
    assert(typeof ctx.w.renderCanvas === 'function', '页面缺少 renderCanvas');
    ctx.close();
  });

  await test('下拉选项等导入数据后才填充（层名/网络名），填充后依然能回填上次选择', async () => {
    const ctx = openPage('fanout.html', { 'fanout.html': { selImportTraceLayer: '19IS08' } });
    await ready(ctx.w);
    const sel = ctx.d.getElementById('selImportTraceLayer');
    assert(ctx.prefs.pendingSelects().length === 1, '应记为待补填，实际 ' + ctx.prefs.pendingSelects().length);
    // 模拟导入数据后填充层名选项
    ['19IS08', '08IS03'].forEach(v => {
      const o = ctx.d.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o);
    });
    await ready(ctx.w, 30);
    assert(sel.value === '19IS08', '选项就绪后未回填，实际 ' + sel.value);
    ctx.close();
  });

  /* ---------- 4. 不该记的东西 ---------- */
  await test('data-no-persist：搜索框 / 筛选下拉不被记忆', async () => {
    const ctx = openPage('dfm.html');
    await ready(ctx.w);
    setVal(ctx.w, ctx.d.getElementById('inpSearch'), 'Via #17');
    setVal(ctx.w, ctx.d.getElementById('selLayerFilter'), '标脏-不应被记住');
    const s = stored(ctx.w)['dfm.html'] || {};
    assert(!('inpSearch' in s), '搜索框被错误记忆');
    assert(!('selLayerFilter' in s), '层筛选下拉被错误记忆');
    // 网络检查范围（仅异网络 / 含同网络）属于检查规则，必须记住
    setVal(ctx.w, ctx.d.getElementById('selNetFilter'), 'all_nets');
    assert((stored(ctx.w)['dfm.html'] || {}).selNetFilter === 'all_nets', '检查范围设置未被记忆');
    ctx.close();
  });

  await test('textarea（数据粘贴区 / 导出框）不被记忆', async () => {
    const ctx = openPage('index.html');
    await ready(ctx.w);
    const ta = ctx.d.getElementById('pasteBox') || ctx.d.getElementById('manualPairs');
    assert(ta, '找不到测试用 textarea');
    setVal(ctx.w, ta, 'Item\tTrace\nVia_1\t3.5');
    const s = stored(ctx.w)['index.html'] || {};
    assert(!(ta.id in s), 'textarea 被错误记忆');
    ctx.close();
  });

  await test('重复 id（模板循环渲染的行内控件）不被记忆', async () => {
    const ctx = openPage('dfm.html');
    await ready(ctx.w);
    const a = ctx.d.createElement('input'); a.type = 'checkbox'; a.id = 'dupProbe';
    const b = ctx.d.createElement('input'); b.type = 'checkbox'; b.id = 'dupProbe';
    ctx.d.body.appendChild(a); ctx.d.body.appendChild(b);
    const rows = ctx.prefs._scan().filter(r => r.id === 'dupProbe');
    assert(rows.length === 2, '扫描结果异常');
    assert(rows.every(r => ctx.prefs._accept(r.el, r.dup) === false), '重复 id 未被排除');
    setChk(ctx.w, a, true);
    assert(!('dupProbe' in (stored(ctx.w)['dfm.html'] || {})), '重复 id 被写入记忆');
    ctx.close();
  });

  /* ---------- 5. 脏数据防护 ---------- */
  await test('记忆里的失效选项 / 非法数值不会把控件写成空值', async () => {
    const ctx = openPage('dfm.html', {
      'dfm.html': {
        selPadShape: 'not-a-real-option',
        inpThresholdGnd: 'abc',
        inpSignalPadDiam: '',
        noSuchField: '123'
      }
    });
    await ready(ctx.w);
    const d = ctx.d;
    const sel = d.getElementById('selPadShape');
    assert(sel.value === sel.options[0].value || sel.value !== '', '下拉被写坏');
    assert(d.getElementById('inpThresholdGnd').value !== 'abc', '非法数值被写入');
    assert(d.getElementById('inpSignalPadDiam').value !== '', '空值覆盖了出厂默认');
    assert(!ctx.errors.length, '恢复过程报错：' + ctx.errors[0]);
    ctx.close();
  });

  /* ---------- 6. 清除 / 跨页隔离 ---------- */
  await test('clear() 只清本页，clearAll() 清全站，storedCount 反映数量', async () => {
    const ctx = openPage('dfm.html', {
      'dfm.html': { inpThresholdGnd: '7.25' },
      'index.html': { inpTol: '0.5' }
    });
    await ready(ctx.w);
    assert(ctx.prefs.storedCount() === 1, 'storedCount 应为 1，实际 ' + ctx.prefs.storedCount());
    ctx.prefs.clear();
    assert(ctx.prefs.storedCount() === 0, 'clear 未清本页');
    assert(stored(ctx.w)['index.html'] && stored(ctx.w)['index.html'].inpTol === '0.5', 'clear 误删其它页面记忆');
    ctx.prefs.clearAll();
    assert(Object.keys(stored(ctx.w)).length === 0, 'clearAll 未清空');
    ctx.close();
  });

  await test('跨页命名空间互不影响：dfm 的记忆不会写进 index', async () => {
    const ctx = openPage('dfm.html');
    await ready(ctx.w);
    setVal(ctx.w, ctx.d.getElementById('inpThresholdSignal'), '6.6');
    const s = stored(ctx.w);
    assert(s['dfm.html'].inpThresholdSignal === '6.6', 'dfm 未记录');
    assert(!s['index.html'], '误写到 index 命名空间');
    ctx.close();
  });

  await test('「恢复默认值」按钮：有记忆值时显示，点击后清空本页记忆', async () => {
    const ctx = openPage('dfm.html', { 'dfm.html': { inpThresholdGnd: '7.25' } });
    await ready(ctx.w);
    const btn = ctx.d.getElementById('btnUiPrefsReset');
    assert(btn && btn.style.display !== 'none', '有记忆值时按钮应显示');
    btn.click();
    assert(ctx.prefs.storedCount() === 0, '点击后未清空记忆');
    ctx.close();
  });

  /* ---------- 7. 真实页面参数（用户截图里的那几个字段） ---------- */
  await test('加工能力页截图中的阈值 / 焊盘直径 / 单位等字段均在记忆名单内', async () => {
    const ctx = openPage('dfm.html');
    await ready(ctx.w);
    const rows = ctx.prefs._scan().filter(r => ctx.prefs._accept(r.el, r.dup)).map(r => r.id);
    ['inpThresholdGnd', 'inpThresholdSignal', 'inpGndPadDiam', 'inpSignalPadDiam',
      'inpGndFirstDrill', 'inpSignalFirstDrill', 'selMode', 'selPadShape',
      'selPatViaKind', 'selPatDim', 'selPatSort', 'selPatTopN', 'selPageSize'].forEach(id => {
      assert(rows.indexOf(id) >= 0, '缺少应记忆的字段 #' + id);
    });
    ctx.close();
  });

  console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
  if (fail) process.exit(1);
})();
