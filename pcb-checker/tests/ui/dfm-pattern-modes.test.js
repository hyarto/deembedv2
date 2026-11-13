/* ============================================================================
 * dfm-pattern-modes.test.js —— 规律分析：线到孔 / 孔到孔重复模式表与列筛选弹层
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { openPage, CHECKER_DIR } = require('../helpers/open-page');

const ctx = openPage('dfm.html', { syncCheck: true });
const { w, d } = ctx;
const $ = id => d.getElementById(id);

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (err) { console.error(`  FAIL  ${name} -> ${err.message}`); fail++; }
}
function assert(c, m) { if (!c) throw new Error(m); }

const sample = fs.readFileSync(path.join(CHECKER_DIR, 'sample/via_trace_airgap_sample.txt'), 'utf8');
const btn = (pop, text) => [...pop.querySelectorAll('button')].find(b => b.textContent === text);
const visibleRows = id => [...$(id).querySelectorAll('tr')].filter(r => r.style.display !== 'none');
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
function run() {
  $('inpThresholdGnd').value = '20'; $('inpThresholdSignal').value = '20'; $('inpThresholdPadPair').value = '10';
  w.eval(`loadTextData(${JSON.stringify(sample)}, 'pattern-modes.txt'); runCheck(true); renderPatternAnalysis();`);
}

console.log('== 规律分析：缺陷类型与重复模式 ==');

test('分析对象改为线到孔 / 孔到孔，旧四个下拉与旧图表收进隐藏容器且保留 id', () => {
  assert($('btnPatObjVia').textContent === '线到孔' && $('btnPatObjTrace').textContent === '孔到孔', '按钮文案');
  ['selPatViaKind', 'selPatDim', 'selPatSort', 'selPatTopN', 'patStatsGrid', 'patChartsRow', 'tblPatObjects'].forEach(id => {
    assert($(id) && $(id).closest('[hidden]'), id + ' 应保留并位于隐藏容器内');
  });
  assert(!$('patLineModeSection').hidden && $('patPadModeSection').hidden, '默认显示线到孔，隐藏孔到孔');
});

test('运行检查后两张模式表有行，6 列，表头带 6 个筛选按钮，提示给出归并数量', () => {
  run();
  const lineRows = [...$('patViaTraceModes').querySelectorAll('tr')];
  const padRows = [...$('patViaViaModes').querySelectorAll('tr')];
  assert(lineRows.length > 0 && lineRows.every(r => r.cells.length === 6), '线到孔表应为 6 列多行');
  assert(padRows.length > 0 && padRows.length <= 8 && padRows.every(r => r.cells.length === 6), '孔到孔表应为 6 列且不多于 8 组');
  assert($('tblPatViaTraceModes').querySelectorAll('.pat-filter-btn').length === 6, '线到孔表应有 6 个筛选按钮');
  assert($('tblPatViaViaModes').querySelectorAll('.pat-filter-btn').length === 6, '孔到孔表应有 6 个筛选按钮');
  const r = w.State.checkResult;
  assert($('patDefectModesHint').textContent.includes(`线到孔 ${r.defectPairs.length.toLocaleString()} 处`), '提示应含线到孔缺陷数：' + $('patDefectModesHint').textContent);
  assert($('patDefectModesHint').textContent.includes(`孔到孔 ${r.padPairDefects.length.toLocaleString()} 对`), '提示应含孔到孔缺陷数');
  const counted = lineRows.reduce((n, r) => n + Number(r.cells[4].textContent.replace(/,/g, '')), 0);
  assert(counted === r.defectPairs.length, `各组不满足数之和应等于缺陷总数 ${r.defectPairs.length}，实际 ${counted}`);
});

test('点击孔到孔切换：显示孔到孔表、隐藏线到孔表；再点线到孔恢复', () => {
  $('btnPatObjTrace').click();
  assert(w.PatternState.defectMode === 'pad' && $('patLineModeSection').hidden && !$('patPadModeSection').hidden, '切到孔到孔');
  assert($('btnPatObjTrace').classList.contains('active') && !$('btnPatObjVia').classList.contains('active'), '按钮高亮应跟随');
  $('btnPatObjVia').click();
  assert(w.PatternState.defectMode === 'line' && !$('patLineModeSection').hidden && $('patPadModeSection').hidden, '切回线到孔');
});

test('列筛选：取消可见项后确定则全部隐藏，表头按钮点亮；清除后恢复', () => {
  const b = $('tblPatViaTraceModes').querySelector('.pat-filter-btn');
  click(b);
  const pop = $('dfmPatternFilterPopover');
  assert(pop, '筛选弹层未打开');
  btn(pop, '取消可见项').click();
  btn(pop, '确定').click();
  assert(!$('dfmPatternFilterPopover'), '确定后弹层应关闭');
  assert(visibleRows('patViaTraceModes').length === 0, '取消全部后应无可见行');
  assert(b.classList.contains('active'), '有筛选时按钮应点亮');
  click(b);
  btn($('dfmPatternFilterPopover'), '清除筛选').click();
  assert(visibleRows('patViaTraceModes').length === $('patViaTraceModes').rows.length, '清除筛选应恢复全部行');
  assert(!b.classList.contains('active'), '清除后按钮应熄灭');
});

test('列筛选：只勾一个值只留匹配行；全选等同不筛选；筛选在重新归纳后保留', () => {
  const col = 1;
  const b = $('tblPatViaTraceModes').querySelectorAll('.pat-filter-btn')[col];
  const values = [...new Set([...$('patViaTraceModes').rows].map(r => r.cells[col].textContent.trim()))];
  click(b);
  let pop = $('dfmPatternFilterPopover');
  btn(pop, '取消可见项').click();
  const first = [...pop.querySelectorAll('label')].find(l => l.textContent === values[0]);
  first.querySelector('input').click();
  btn(pop, '确定').click();
  const shown = visibleRows('patViaTraceModes');
  assert(shown.length > 0 && shown.every(r => r.cells[col].textContent.trim() === values[0]), '应只剩 ' + values[0]);
  w.renderPatternAnalysis();
  assert(visibleRows('patViaTraceModes').every(r => r.cells[col].textContent.trim() === values[0]), '重新归纳后筛选应保留');
  click(b);
  pop = $('dfmPatternFilterPopover');
  btn(pop, '全选可见').click();
  btn(pop, '确定').click();
  assert(visibleRows('patViaTraceModes').length === $('patViaTraceModes').rows.length, '全选等同不筛选');
  assert(!b.classList.contains('active'), '全选后不应点亮');
});

test('弹层：搜索过滤选项、无匹配提示、全选可见只作用于可见项', () => {
  const b = $('tblPatViaTraceModes').querySelector('.pat-filter-btn');
  click(b);
  const pop = $('dfmPatternFilterPopover');
  const all = pop.querySelectorAll('label').length;
  const search = pop.querySelector('input[type=search]');
  search.value = '__无此值__'; search.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert(pop.querySelectorAll('label').length === 0 && /没有匹配项/.test(pop.textContent), '无匹配应给提示');
  search.value = ''; search.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert(pop.querySelectorAll('label').length === all, '清空搜索应恢复全部选项');
  w.DfmPatternFilterPopover.close();
});

test('弹层：再次点同一按钮关闭；Esc 关闭；点击弹层外关闭；一次只开一个', () => {
  const [b0, b1] = $('tblPatViaTraceModes').querySelectorAll('.pat-filter-btn');
  click(b0); assert($('dfmPatternFilterPopover'), '打开');
  click(b0); assert(!$('dfmPatternFilterPopover'), '同一按钮再点应关闭');
  click(b0); click(b1);
  assert(d.querySelectorAll('#dfmPatternFilterPopover').length === 1 && $('dfmPatternFilterPopover').dataset.col === '1', '切换列应只留一个弹层');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(!$('dfmPatternFilterPopover'), 'Esc 应关闭');
});

test('孔到孔表同样支持列筛选，互不影响线到孔表', () => {
  const b = $('tblPatViaViaModes').querySelector('.pat-filter-btn');
  click(b);
  const pop = $('dfmPatternFilterPopover');
  assert(pop.dataset.table === 'pad', '应属于孔到孔表');
  btn(pop, '取消可见项').click(); btn(pop, '确定').click();
  assert(visibleRows('patViaViaModes').length === 0, '孔到孔表应全部隐藏');
  assert(visibleRows('patViaTraceModes').length === $('patViaTraceModes').rows.length, '线到孔表不受影响');
  assert(Object.keys(w.PatternState.defectModeFilters.line).length === 0, '线到孔筛选状态应为空');
  click(b); btn($('dfmPatternFilterPopover'), '清除筛选').click();
});

test('归并函数暴露为 window.buildDfmDefectPatternAnalysis，页面渲染与它一致', () => {
  const v = id => ({ id, net: 'SIG' + id, isGnd: false, padstack: 'SIG_D4_R3', padDiameter: 10.5, firstDrill: 4.5 });
  const t = id => ({ id, net: 'NET' + id, subset: 'L2', width: 4.5 });
  const a = w.buildDfmDefectPatternAnalysis({
    defectPairs: [{ via: v(1), trace: t(1), mode: 'pad_to_trace', threshold: 3, evalDist: 2.05 }, { via: v(2), trace: t(2), mode: 'pad_to_trace', threshold: 3, evalDist: 2.05 }],
    padPairDefects: [{ gndVia: Object.assign(v(3), { isGnd: true, padstack: 'GND_D4_R3' }), sigVia: v(4), gndPadDiameter: 10.5, sigPadDiameter: 10.5, threshold: 3, padAirgap: 1.5, ruleLayers: 'L2-L5' }]
  });
  assert(a.lineDefectCount === 2 && a.lineGroupCount === 1 && a.padDefectCount === 1 && a.padGroupCount === 1, '归并计数不对');
});

test('名称含 HTML 字符时模式表经转义，不产生节点', () => {
  const r = w.State.checkResult;
  const evil = { id: 99, net: '<img src=x onerror=alert(1)>', isGnd: false, padstack: '<b>PS</b>', padDiameter: 10, firstDrill: 4 };
  const saved = { d: r.defectPairs, p: r.padPairDefects };
  r.defectPairs = [{ via: evil, trace: { id: 5, net: '<script>x</script>', subset: '<i>L2</i>', width: 4 }, mode: 'pad_to_trace', threshold: 3, evalDist: 1 }];
  r.padPairDefects = [{ gndVia: Object.assign({}, evil, { isGnd: true }), sigVia: evil, gndPadDiameter: 8, sigPadDiameter: 8, threshold: 3, padAirgap: 1, ruleLayers: '<u>x</u>' }];
  w.renderPatternAnalysis();
  const injected = $('tab-analysis').querySelectorAll('#patViaTraceModes img, #patViaTraceModes script, #patViaTraceModes i, #patViaViaModes u, #patViaViaModes img, #patViaViaModes script');
  assert(injected.length === 0, '不得产生注入节点，实际 ' + injected.length);
  // 每行只有「不满足数」一个合法加粗节点；注入的 <b>PS</b> 若被解析，会多出 b
  assert($('patViaTraceModes').querySelectorAll('b').length === $('patViaTraceModes').rows.length, '线到孔表出现多余 b 节点');
  assert($('patViaViaModes').querySelectorAll('b').length === $('patViaViaModes').rows.length, '孔到孔表出现多余 b 节点');
  assert($('patViaTraceModes').textContent.includes('<b>PS</b>'), '原文应按文本显示');
  r.defectPairs = saved.d; r.padPairDefects = saved.p;
  w.renderPatternAnalysis();
});

test('页面运行期零脚本错误', () => {
  assert(!ctx.errors.length, ctx.errors.join(' | '));
});

// 异步用例：弹层外点击关闭依赖 setTimeout 挂接，单独等待
(async () => {
  await new Promise(r => setTimeout(r, 30));
  const b = $('tblPatViaTraceModes').querySelector('.pat-filter-btn');
  click(b);
  await new Promise(r => setTimeout(r, 30));
  const pop = $('dfmPatternFilterPopover');
  click(pop.querySelector('h4'));
  const stillOpen = !!$('dfmPatternFilterPopover');
  click(d.body);
  const closed = !$('dfmPatternFilterPopover');
  if (stillOpen && closed) { console.log('  PASS  弹层：点击弹层内不关闭，点击弹层外关闭'); pass++; }
  else { console.error(`  FAIL  弹层外点击 -> 内部点击后仍开=${stillOpen}，外部点击后关闭=${closed}`); fail++; }
  ctx.close();
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
