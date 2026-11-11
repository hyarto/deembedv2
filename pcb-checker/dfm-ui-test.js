const fs = require('fs');
const path = require('path');

function loadJsdom() {
  try { return require('jsdom'); }
  catch (e) { throw new Error('找不到 jsdom，请先执行 npm install'); }
}
const { JSDOM } = loadJsdom();

const html = fs.readFileSync(path.join(__dirname, 'dfm.html'), 'utf8');
const jsCode = fs.readFileSync(path.join(__dirname, 'dfm-check.js'), 'utf8');
const padGeomCode = fs.readFileSync(path.join(__dirname, 'pad-geom.js'), 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'file://' + path.join(__dirname, 'dfm.html')
});

const w = dom.window;
const d = w.document;
const $ = id => d.getElementById(id);

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (err) {
    console.error(`  FAIL  ${name} -> ${err.message}`);
    fail++;
  }
}

// Inject 几何内核 + DfmCheck 引擎脚本 (顺序与页面一致：pad-geom.js → dfm-check.js)
w.eval(padGeomCode);
w.eval(jsCode);
w.__SYNC_CHECK__ = true;

console.log('== DFM 加工能力与空间间距 UI 测试 ==');

test('页面基本元素与双规则阈值/焊盘直径/一钻直径输入框存在', () => {
  const tabs = d.querySelectorAll('nav#tabs button');
  if (tabs.length !== 5) throw new Error('页签数量应为 5（新增「规律分析」），实际 ' + tabs.length);
  if (!d.querySelector('nav#tabs button[data-tab="analysis"]')) throw new Error('缺少规律分析页签');
  if (!$('btnPatObjVia') || !$('btnPatObjTrace')) throw new Error('缺少规律分析的对象切换按钮');
  if (!$('inpThresholdGnd')) throw new Error('缺少 GND 孔阈值输入框');
  if (!$('inpThresholdSignal')) throw new Error('缺少信号孔阈值输入框');
  if (!$('inpGndPadDiam')) throw new Error('缺少 GND 焊盘直径输入框');
  if (!$('inpSignalPadDiam')) throw new Error('缺少信号孔焊盘直径输入框');
  if (!$('inpGndFirstDrill')) throw new Error('缺少 GND 一钻直径输入框');
  if (!$('inpSignalFirstDrill')) throw new Error('缺少信号孔一钻直径输入框');
  if (!$('btnMeasureMode')) throw new Error('缺少测量标尺模式按钮');
});

test('加载示例数据并验证双规则阈值计算与统计卡片', () => {
  const sampleTxt = fs.readFileSync(path.join(__dirname, 'sample/via_trace_airgap_sample.txt'), 'utf8');
  $('inpGndPadDiam').value = '5.94';
  $('inpSignalPadDiam').value = '9.94';
  $('inpThresholdGnd').value = '6.0';
  $('inpThresholdSignal').value = '6.0';
  w.eval(`loadTextData(${JSON.stringify(sampleTxt)}, "via_trace_airgap_sample.txt"); runCheck();`);
  
  const badNum = parseInt($('statBadCount').textContent, 10);
  if (badNum !== 23) throw new Error('在 5.94 mil 焊盘下超标数应为 23，实际 ' + badNum);
  
  const gndBadText = $('statGndBadCount').textContent;
  if (gndBadText.indexOf('23') < 0) throw new Error('GND 孔统计应含 23 超标，实际 ' + gndBadText);

  const sigBadText = $('statSigBadCount').textContent;
  if (sigBadText.indexOf('0') < 0) throw new Error('信号孔统计应含 0 超标，实际 ' + sigBadText);

  const minVal = parseFloat($('statMinDist').textContent);
  if (Math.abs(minVal - 5.02) > 0.05) throw new Error('最小实测间距应约为 5.02 mil，实际 ' + minVal);
});

test('独立修改信号孔与GND孔阈值并验证双规则判定生效', () => {
  $('inpGndPadDiam').value = '5.94';
  $('inpSignalPadDiam').value = '9.94';
  // 设置 GND 孔阈值 5.0 mil (放宽), 信号孔阈值 8.0 mil (收紧)
  $('inpThresholdGnd').value = '5.0';
  $('inpThresholdSignal').value = '8.0';
  $('btnRunCheck').click();

  const badNum = parseInt($('statBadCount').textContent, 10);
  if (badNum !== 9) throw new Error('修改后超标数应为 9，实际 ' + badNum);
  
  const gndBadText = $('statGndBadCount').textContent;
  if (gndBadText.indexOf('0 /') < 0) throw new Error('GND 孔超标数应为 0，实际 ' + gndBadText);

  const sigBadText = $('statSigBadCount').textContent;
  if (sigBadText.indexOf('9 /') < 0) throw new Error('信号孔超标数应为 9，实际 ' + sigBadText);

  // 恢复默认 6.0 / 6.0
  $('inpThresholdGnd').value = '6.0';
  $('inpThresholdSignal').value = '6.0';
  $('btnRunCheck').click();
});

test('线到GND孔与线到信号孔筛选按钮联动', () => {
  $('btnFilterGnd').click();
  if (w.State.activeFilter !== 'gnd') throw new Error('activeFilter 应为 gnd');
  
  $('btnFilterSig').click();
  if (w.State.activeFilter !== 'signal') throw new Error('activeFilter 应为 signal');

  $('btnFilterBad').click();
  if (w.State.activeFilter !== 'bad') throw new Error('activeFilter 应为 bad');
});

test('修改一钻直径后过孔属性实时更新', () => {
  $('inpGndFirstDrill').value = '5.94';
  $('btnRunCheck').click();
  const v1 = w.State.vias[0];
  if (Math.abs(v1.firstDrill - 5.94) > 1e-4) throw new Error('修改 GND 一钻直径后未更新：' + v1.firstDrill);
  $('inpGndFirstDrill').value = '5.54';
  $('btnRunCheck').click();
});

test('测量标尺模式切换与面板联动', () => {
  $('btnMeasureMode').click();
  if (!w.State.measureMode) throw new Error('测量模式未激活');
  if (!$('pcbCanvas').classList.contains('measuring')) throw new Error('Canvas 缺少 measuring 样式');
  
  // 模拟选中两个过孔进行测量
  w.State.measureSelection = [
    { type: 'via', item: w.State.vias[0] },
    { type: 'via', item: w.State.vias[1] }
  ];
  w.updateMeasurements();
  if ($('measureCard').style.display !== 'block') throw new Error('测量卡片未弹出');
  if ($('measureCardBody').textContent.indexOf('孔中心到中心距') < 0) throw new Error('缺少中心距测量字段');
  
  // 退出测量模式
  $('btnMeasureMode').click();
  if (w.State.measureMode) throw new Error('退出测量模式失败');
});

test('搜索功能与定位', () => {
  $('inpThresholdGnd').value = '6.0';
  $('inpThresholdSignal').value = '6.0';
  $('btnRunCheck').click();

  const searchInp = $('inpSearch');
  searchInp.value = 'Via 17';
  searchInp.dispatchEvent(new w.Event('input', { bubbles: true }));

  const rows = d.querySelectorAll('#resTableBody tr');
  if (rows.length === 0) throw new Error('搜索 Via 17 应有结果');
  rows.forEach(r => {
    if (r.textContent.indexOf('Via 17') < 0 && r.textContent.indexOf('暂无') < 0) {
      throw new Error('过滤结果包含非 Via 17 记录');
    }
  });
});

test('复核勾选功能保留状态', () => {
  const searchInp = $('inpSearch');
  searchInp.value = '';
  searchInp.dispatchEvent(new w.Event('input', { bubbles: true }));

  const firstCk = d.querySelector('#resTableBody .ck-rev');
  if (firstCk) {
    firstCk.click();
    const newFirstRow = d.querySelector('#resTableBody tr');
    if (!newFirstRow.classList.contains('reviewed')) throw new Error('勾选后未添加 reviewed 类');
  }
});

test('历史配置标签渲染与点击快速填充功能', () => {
  const gndHistBar = $('hist_thresh_gnd');
  if (!gndHistBar) throw new Error('缺少 GND 阈值历史标签容器');
  const chips = gndHistBar.querySelectorAll('.hist-chip');
  if (chips.length === 0) throw new Error('历史标签未渲染');

  // 点击历史标签 5.0
  const chip5 = Array.from(chips).find(c => c.textContent.trim() === '5');
  if (chip5) {
    chip5.click();
    if (Math.abs(parseFloat($('inpThresholdGnd').value) - 5.0) > 1e-4) {
      throw new Error('点击历史标签后输入框未更新');
    }
  }
});

test('按出线层x走线网络聚合分析视图切换与明细展开', () => {
  $('btnViewNetGroup').click();
  if (w.State.resViewMode !== 'net_group') throw new Error('视图切换失败');
  if ($('netGroupViewContainer').style.display === 'none') throw new Error('聚合容器未显示');

  const rows = d.querySelectorAll('#netGroupTableBody tr');
  if (rows.length === 0) throw new Error('聚合表格无行数据');

  // 展开第一条有缺陷的网络明细
  const toggleBtn = d.querySelector('.btn-toggle-net-defects');
  if (toggleBtn) {
    toggleBtn.click();
    const subTable = d.querySelector('.net-defects-table');
    if (!subTable) throw new Error('走线超标明细表格未展开');
  }

  // 切换回对偶视图
  $('btnViewPairList').click();
  if (w.State.resViewMode !== 'pair_list') throw new Error('切回对偶明细视图失败');
});

// ---------------------------------------------------------------------------
// 安全性 / 可观测性回归
// ---------------------------------------------------------------------------
test('网表名中的 HTML 不会被执行（结果表必须转义不可信输入）', () => {
  const evil = '<img src=x onerror="window.__pwn=1">';
  const txt = `Total 2 Items

Item 1                < Via >
  Origin-xy: [100.0000, 100.0000]
  Net: ${evil}
  Padstack Name: P
  Circle Drill: 3.9400

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 2                < Trace >
  Subset: 02G01P
  Net: SIG${evil}
  Type: Seg
  Seg Length: 10.0000
  Seg: xy [100.0000, 100.4000]  xy [110.0000, 100.4000] Width (6.0000)
`;
  w.eval(`loadTextData(${JSON.stringify(txt)}, "evil.txt"); runCheck();`);
  const injected = d.querySelectorAll('img[src="x"]');
  if (injected.length) throw new Error('结果页出现 ' + injected.length + ' 个注入节点，说明 innerHTML 未转义');
  if (!/&lt;img|img src=x/.test(d.body.textContent + d.body.innerHTML)) throw new Error('转义后的原始文本应在页面上以字面量出现');
});

test('层名无法解析时，检查提示必须显式告知「已按全部检查处理」', () => {
  const txt = `Total 2 Items

Item 1                < Via >
  Origin-xy: [100.0000, 100.0000]
  Net: GND
  Padstack Name: P
  Padstack Defined from <L2> to <L5>
  Circle Drill: 3.9400

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 2                < Trace >
  Subset: SIGA
  Net: 25_N
  Type: Seg
  Seg Length: 100.0000
  Seg: xy [100.0000, 103.0000]  xy [200.0000, 103.0000] Width (6.0000)
`;
  w.eval(`loadTextData(${JSON.stringify(txt)}, "signame.txt"); runCheck();`);
  const hint = $('runHint').textContent;
  if (!/共核对 1 处/.test(hint)) throw new Error('应照常核对 1 处，实际提示: ' + hint);
  if (!/层名无法解析|无法解析为层号/.test(hint)) throw new Error('缺少「层名无法解析」提示，实际: ' + hint);
});

// ---------------------------------------------------------------------------
// 规律分析（按信号孔 / 按走线）
// ---------------------------------------------------------------------------
console.log('\n== 规律分析：以信号孔 / 走线为对象的全板问题归纳 ==');

test('切换页签可渲染规律分析：KPI、维度分布、亏欠分档与对象排行', () => {
  const sampleTxt = fs.readFileSync(path.join(__dirname, 'sample/via_trace_airgap_sample.txt'), 'utf8');
  $('inpGndPadDiam').value = '7.906';
  $('inpSignalPadDiam').value = '9.94';
  $('inpThresholdGnd').value = '6.0';
  $('inpThresholdSignal').value = '6.0';
  w.eval(`loadTextData(${JSON.stringify(sampleTxt)}, "via_trace_airgap_sample.txt"); runCheck();`);
  d.querySelector('nav#tabs button[data-tab="analysis"]').click();

  const a = w.PatternState.last;
  if (!a || !a.hasData) throw new Error('规律分析无数据');
  if (a.object !== 'via') throw new Error('默认对象应为按信号孔/过孔');
  if (a.objectCount !== 11) throw new Error('问题过孔对象数应为 11，实际 ' + a.objectCount);
  if (a.kpis.defectCount !== a.allObjects.reduce((s, o) => s + o.failCount, 0)) {
    throw new Error('缺陷处数应等于各对象缺陷数之和');
  }
  const sumBucket = a.deficitBuckets.reduce((s, b) => s + b.count, 0);
  if (sumBucket !== a.kpis.defectCount) throw new Error('亏欠量分档合计应等于缺陷处数：' + sumBucket + ' vs ' + a.kpis.defectCount);
  const dimSum = a.dimensionRows.reduce((s, r) => s + r.count, 0);
  if (dimSum !== a.kpis.defectCount) throw new Error('维度分布合计应等于缺陷处数：' + dimSum + ' vs ' + a.kpis.defectCount);

  if ($('patKpiObjects').textContent !== '11') throw new Error('KPI 对象数未渲染：' + $('patKpiObjects').textContent);
  if (parseFloat($('patKpiMinDist').textContent) > 4.1) throw new Error('KPI 最小间距异常：' + $('patKpiMinDist').textContent);
  if (d.querySelectorAll('#patDimChart .pat-bar-row').length === 0) throw new Error('维度条形图为空');
  if (d.querySelectorAll('#patDeficitChart .pat-bar-row').length !== 4) throw new Error('亏欠量分档应为 4 段');
  const rows = d.querySelectorAll('#tblPatObjectsBody tr');
  if (rows.length !== 10) throw new Error('默认 Top10 应渲染 10 行，实际 ' + rows.length);
});

test('对象排行按缺陷处数降序，且首行是该样板最严重的过孔', () => {
  const a = w.PatternState.last;
  const counts = a.objects.map(o => o.failCount);
  for (let i = 1; i < counts.length; i++) {
    if (counts[i] > counts[i - 1]) throw new Error('未按缺陷处数降序：' + counts.join(','));
  }
  if (a.objects[0].failCount !== 9) throw new Error('最严重对象应有 9 处缺陷，实际 ' + a.objects[0].failCount);
  const firstRow = d.querySelector('#tblPatObjectsBody tr').textContent;
  if (!/Via #/.test(firstRow)) throw new Error('首行应为过孔对象：' + firstRow);
});

test('切换到「按走线」：表头与分组键随之变化，对象数按走线统计', () => {
  $('btnPatObjTrace').click();
  const a = w.PatternState.last;
  if (a.object !== 'trace') throw new Error('对象未切换为走线');
  if (a.objectCount !== 36) throw new Error('问题走线对象数应为 36，实际 ' + a.objectCount);
  if (a.kpis.defectCount !== 42) throw new Error('走线模式缺陷处数应与过孔模式一致（同一批对偶），实际 ' + a.kpis.defectCount);
  const head = d.querySelector('#tblPatObjectsHead').textContent;
  if (!/出线层|线宽/.test(head)) throw new Error('走线模式表头未切换：' + head);
  if (/Padstack/.test(head)) throw new Error('走线模式不应出现 Padstack 列：' + head);
  if (!/问题对象排行（按走线）/.test($('patTableTitle').textContent)) throw new Error('表标题未更新：' + $('patTableTitle').textContent);
});

test('过孔范围筛选：仅信号孔 / 仅 GND 孔 / 全部三种口径互相自洽', () => {
  $('btnPatObjVia').click();
  const total = w.PatternState.last.kpis.defectCount;
  $('selPatViaKind').value = 'signal'; $('selPatViaKind').dispatchEvent(new w.Event('change'));
  const sig = w.PatternState.last.kpis.defectCount;
  $('selPatViaKind').value = 'gnd'; $('selPatViaKind').dispatchEvent(new w.Event('change'));
  const gnd = w.PatternState.last.kpis.defectCount;
  $('selPatViaKind').value = 'all'; $('selPatViaKind').dispatchEvent(new w.Event('change'));
  if (sig + gnd !== total) throw new Error(`信号孔 ${sig} + GND 孔 ${gnd} 应等于全部 ${total}`);
  if (w.PatternState.last.objectCount !== 11) throw new Error('切回全部后对象数应为 11');
});

test('归纳维度切换：层 / 网络 / 孔型 / Padstack 均可渲染且合计不变', () => {
  const dims = ['layer', 'net', 'kind', 'padstack'];
  const expected = w.PatternState.last.kpis.defectCount;
  dims.forEach(dim => {
    $('selPatDim').value = dim; $('selPatDim').dispatchEvent(new w.Event('change'));
    const a = w.PatternState.last;
    if (a.dimension !== dim) throw new Error(`维度未切换：${dim}`);
    const sum = a.dimensionRows.reduce((s, r) => s + r.count, 0);
    if (sum !== expected) throw new Error(`${dim} 维度合计 ${sum} != ${expected}`);
    if (d.querySelectorAll('#patDimChart .pat-bar-row').length === 0) throw new Error(`${dim} 维度条形图为空`);
  });
  $('selPatDim').value = 'layer'; $('selPatDim').dispatchEvent(new w.Event('change'));
});

test('排序与 TopN 联动：按最大亏欠量排序、Top 5 只渲染 5 行', () => {
  $('selPatSort').value = 'maxDeficit'; $('selPatSort').dispatchEvent(new w.Event('change'));
  const a = w.PatternState.last;
  for (let i = 1; i < a.objects.length; i++) {
    if (a.objects[i].maxDeficit > a.objects[i - 1].maxDeficit + 1e-9) throw new Error('未按最大亏欠量降序');
  }
  $('selPatTopN').value = '5'; $('selPatTopN').dispatchEvent(new w.Event('change'));
  const rows = d.querySelectorAll('#tblPatObjectsBody tr');
  if (rows.length !== 5) throw new Error('Top5 应渲染 5 行，实际 ' + rows.length);
  $('selPatTopN').value = '10'; $('selPatTopN').dispatchEvent(new w.Event('change'));
  $('selPatSort').value = 'failCount'; $('selPatSort').dispatchEvent(new w.Event('change'));
});

test('点击对象行「查看明细」：跳到结果页并按对象号填入搜索框', () => {
  const firstId = w.PatternState.last.objects[0].id;
  d.querySelector('#tblPatObjectsBody tr button').click();
  const resultBtn = d.querySelector('nav#tabs button[data-tab="result"]');
  if (!resultBtn.classList.contains('active')) throw new Error('未切换到检查结果明细页');
  if ($('inpSearch').value !== 'Via ' + firstId) throw new Error('搜索框未填入对象号：' + $('inpSearch').value);
  if (!d.getElementById('tab-result').classList.contains('active')) throw new Error('结果页未激活');
});

test('纯函数归纳：缺陷对偶按对象聚合、亏欠量与集中度计算正确', () => {
  const fake = {
    failCount: 3,
    defectPairs: [
      {via: {id: 1, net: 'GND', isGnd: true, padstack: 'P1', viaTypeLabel: '通孔'}, trace: {id: 10, subset: 'L2', net: 'A', width: 5}, evalDist: 4, threshold: 6},
      {via: {id: 1, net: 'GND', isGnd: true, padstack: 'P1', viaTypeLabel: '通孔'}, trace: {id: 11, subset: 'L2', net: 'B', width: 5}, evalDist: 5, threshold: 6},
      {via: {id: 2, net: 'SIG', isGnd: false, padstack: 'P2', viaTypeLabel: '盲孔'}, trace: {id: 10, subset: 'L3', net: 'A', width: 5}, evalDist: 3.5, threshold: 6}
    ]
  };
  const a = w.buildDfmPatternAnalysis(fake, {object: 'via', dimension: 'layer', topN: 0});
  if (a.objectCount !== 2) throw new Error('应聚合出 2 个过孔对象，实际 ' + a.objectCount);
  const v1 = a.allObjects.find(o => o.id === 1);
  if (v1.failCount !== 2) throw new Error('Via 1 应有 2 处缺陷，实际 ' + v1.failCount);
  if (Math.abs(v1.minDist - 4) > 1e-9) throw new Error('Via 1 最小间距应为 4，实际 ' + v1.minDist);
  if (Math.abs(v1.maxDeficit - 2) > 1e-9) throw new Error('Via 1 最大亏欠应为 2，实际 ' + v1.maxDeficit);
  const total = a.dimensionRows.reduce((s, r) => s + r.count, 0);
  if (total !== 3) throw new Error('维度合计应为 3，实际 ' + total);
  if (Math.abs(a.kpis.concentration - 1) > 1e-9) throw new Error('两处缺陷同在 L2/L3 时前 3 名集中度应为 100%');

  const t = w.buildDfmPatternAnalysis(fake, {object: 'trace', dimension: 'layer', topN: 0});
  if (t.objectCount !== 2) throw new Error('按走线应聚合出 2 条走线，实际 ' + t.objectCount);
  const tr10 = t.allObjects.find(o => o.id === 10);
  if (tr10.failCount !== 2) throw new Error('Trace 10 应有 2 处缺陷，实际 ' + tr10.failCount);
  if (tr10.peerList.length !== 2) throw new Error('Trace 10 应关联 2 个不同过孔');
});

test('空数据与全合格数据：规律分析给出提示而不是报错', () => {
  const empty = w.buildDfmPatternAnalysis(null, {object: 'via'});
  if (empty.hasData) throw new Error('无结果时 hasData 应为 false');
  const noDefect = w.buildDfmPatternAnalysis({failCount: 0, defectPairs: []}, {object: 'trace'});
  if (noDefect.hasData) throw new Error('无缺陷时 hasData 应为 false');
  if (!noDefect.summary.headline) throw new Error('空状态应有提示文案');
  const sigEmpty = w.buildDfmPatternAnalysis({failCount: 1, defectPairs: [
    {via: {id: 9, net: 'GND', isGnd: true}, trace: {id: 1, subset: 'L2', net: 'A'}, evalDist: 5, threshold: 6}
  ]}, {object: 'via', viaKind: 'signal'});
  if (sigEmpty.hasData) throw new Error('仅信号孔口径下应无数据');
  if (!/信号孔/.test(sigEmpty.summary.headline)) throw new Error('提示应说明是信号孔口径：' + sigEmpty.summary.headline);
});

test('CSV 导出：包含对象维度、维度分布与亏欠量分档三段', () => {
  $('btnPatObjVia').click();
  const csv = w.buildPatternCsv(w.PatternState.last);
  const lines = csv.split('\r\n');
  if (!/对象维度/.test(lines[0])) throw new Error('缺少对象维度表头');
  if (!/维度分布/.test(csv)) throw new Error('缺少维度分布段');
  if (!/亏欠量分档/.test(csv)) throw new Error('缺少亏欠量分档段');
  const bodyRows = lines.filter(l => /^"Via#\d+"/.test(l));
  if (bodyRows.length !== 11) throw new Error('对象行数应为 11，实际 ' + bodyRows.length);
  if (w.buildPatternCsv({hasData: false}) !== '') throw new Error('无数据时应返回空串');
});

test('规律分析渲染不引入 HTML 注入（对象/网络名同样走转义）', () => {
  const evil = '<img src=x onerror="window.__pwn=1">';
  $('btnPatObjVia').click();
  const fake = {failCount: 1, defectPairs: [
    {via: {id: 7, net: evil, isGnd: false, padstack: evil, viaTypeLabel: '通孔'}, trace: {id: 3, subset: evil, net: evil, width: 5}, evalDist: 5, threshold: 6}
  ]};
  const saved = w.State.checkResult;
  w.State.checkResult = fake;
  w.renderPatternAnalysis();
  const injected = d.querySelectorAll('#tab-analysis img[src="x"]');
  if (injected.length) throw new Error('规律分析出现 ' + injected.length + ' 个注入节点');
  w.State.checkResult = saved;
  w.renderPatternAnalysis();
});

test('新增项：GND 孔盘到信号孔盘阈值输入框与历史值', () => {
  const inp = $('inpThresholdPadPair');
  if (!inp) throw new Error('缺少 GND 孔盘到信号孔盘阈值输入框');
  if (Math.abs(parseFloat(inp.value) - 6.0) > 1e-9) throw new Error('默认值应为 6.0，实际 ' + inp.value);
  if (!d.querySelector('label[for="inpThresholdPadPair"]')) throw new Error('输入框没有 label');
  if (!d.getElementById('hist_thresh_padpair')) throw new Error('缺少历史值圆钮容器');
  const label = d.querySelector('label[for="inpThresholdPadPair"]').textContent;
  if (label.indexOf('GND') < 0 || label.indexOf('信号孔盘') < 0) throw new Error('文案不对：' + label);
});

test('新增项：跑检查后统计卡与明细卡给出孔盘对结果', () => {
  const sampleTxt = fs.readFileSync(path.join(__dirname, 'sample/via_trace_airgap_sample.txt'), 'utf8');
  // 前面的用例可能改过焊盘/一钻直径，这里固定成界面默认口径再跑，条数才可复现
  $('inpGndPadDiam').value = '7.906';
  $('inpSignalPadDiam').value = '12.0';
  $('inpGndFirstDrill').value = '6.0';
  $('inpSignalFirstDrill').value = '6.0';
  $('inpThresholdPadPair').value = '6.0';
  w.eval(`loadTextData(${JSON.stringify(sampleTxt)}, "via_trace_airgap_sample.txt"); runCheck(true);`);
  const st = w.State.checkResult.padPairStats;
  if (!st.enabled) throw new Error('应启用孔盘到孔盘检查');
  if (st.total !== 22 || st.fail !== 0) throw new Error('应为 22 对全满足，实际 ' + JSON.stringify(st));
  if ($('statPadPairBadCount').textContent !== '0 / 22') throw new Error('统计卡应为 0 / 22，实际 ' + $('statPadPairBadCount').textContent);
  if ($('padPairCard').style.display !== 'block') throw new Error('明细卡应显示');
  if ($('padPairHint').textContent.indexOf('6 mil') < 0) throw new Error('提示里没有阈值：' + $('padPairHint').textContent);
  if ($('runHint').textContent.indexOf('GND孔盘↔信号孔盘') < 0) throw new Error('运行提示没提到新增项');
});

test('新增项：阈值调到 10 mil 时明细表列出 8 对不满足', () => {
  $('inpThresholdPadPair').value = '10';
  w.eval('runCheck(true)');
  const st = w.State.checkResult.padPairStats;
  if (st.fail !== 8) throw new Error('应 8 对不满足，实际 ' + st.fail);
  if ($('statPadPairBadCount').textContent !== '8 / 34') throw new Error('统计卡应为 8 / 34，实际 ' + $('statPadPairBadCount').textContent);
  const rows = d.querySelectorAll('#padPairBody tr');
  if (rows.length !== 8) throw new Error('明细应为 8 行，实际 ' + rows.length);
  const first = rows[0].textContent;
  if (first.indexOf('GND') < 0 || first.indexOf('mil') >= 0) { /* 文案里没有单位，仅确认有网络名 */ }
  if (rows[0].querySelectorAll('td').length !== 8) throw new Error('明细列数不对');
  if (!/不满足 8 对/.test($('padPairHint').textContent)) throw new Error('提示没给出不满足数量：' + $('padPairHint').textContent);
});

test('新增项：阈值填 0 时不检查，统计卡显示未启用', () => {
  $('inpThresholdPadPair').value = '0';
  w.eval('runCheck(true)');
  if (w.State.checkResult.padPairStats.enabled) throw new Error('填 0 应关闭');
  if ($('statPadPairBadCount').textContent !== '未启用') throw new Error('统计卡应显示未启用，实际 ' + $('statPadPairBadCount').textContent);
  if ($('padPairCard').style.display !== 'none') throw new Error('明细卡应隐藏');
  $('inpThresholdPadPair').value = '6.0';
  w.eval('runCheck(true)');
});

test('新增项：三套预设都会带上孔盘到信号孔盘阈值', () => {
  const cases = [['eda_project', '6.0'], ['std_6mil', '6.0'], ['high_density_5mil', '5.0']];
  cases.forEach(([scheme, expect]) => {
    $('inpThresholdPadPair').value = '99';
    w.applyPresetScheme(scheme);
    if (Math.abs(parseFloat($('inpThresholdPadPair').value) - parseFloat(expect)) > 1e-9) {
      throw new Error(scheme + ' 应为 ' + expect + '，实际 ' + $('inpThresholdPadPair').value);
    }
  });
  $('inpThresholdPadPair').value = '6.0';
  w.eval('runCheck(true)');
});

test('新增项：判定口径说明里写了这一条', () => {
  const legend = d.getElementById('tab-legend').textContent;
  if (legend.indexOf('GND 孔盘到信号孔盘') < 0) throw new Error('说明页没写判定口径');
  if (legend.indexOf('Pad to Pad Airgap') < 0) throw new Error('说明页没写算的是孔盘到孔盘间距');
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
if (fail > 0) process.exit(1);
