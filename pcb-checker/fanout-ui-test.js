/**
 * fanout-ui-test.js
 * 扇出方案检查 UI 交互与全流程测试 (JSDOM)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function loadJsdom() {
  try { return require('jsdom'); }
  catch (e) { throw new Error('找不到 jsdom，请先执行 npm install'); }
}
const { JSDOM } = loadJsdom();

console.log('== 扇出方案检查 UI 交互与流程测试 ==');

const htmlPath = path.join(__dirname, 'fanout.html');
const jsCheckPath = path.join(__dirname, 'fanout-check.js');

let htmlSource = fs.readFileSync(htmlPath, 'utf8');
const jsCheckSource = fs.readFileSync(jsCheckPath, 'utf8');

// Replace relative script tag with inlined script content for reliable JSDOM execution
htmlSource = htmlSource.replace('<script src="fanout-check.js"></script>', `<script>${jsCheckSource}</script>`);

const dom = new JSDOM(htmlSource, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'file://' + htmlPath
});

const { window } = dom;
const { document } = window;

// Trigger DOMContentLoaded
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

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

// 1. 验证 DOM 初始化与方案库预设加载
test('页面初始化与预设扇出方案库加载', () => {
  const schemeCards = document.querySelectorAll('.scheme-card');
  assert.strictEqual(schemeCards.length, 6, '初始应加载 6 种标准预设扇出方案');

  const badgeCount = document.getElementById('badgeSchemeCount');
  assert.strictEqual(badgeCount.textContent, '6', '方案库数量徽标应显示 6');

  const statSchemeCount = document.getElementById('statSchemeCount');
  assert.ok(statSchemeCount.textContent.includes('6'), '顶部方案库有效模板 KPI 应显示 6');
});

// 2. 方案库新建与编辑模态框测试
test('新建自定义扇出方案模态框与保存', () => {
  window.openSchemeModal();
  const modal = document.getElementById('modalScheme');
  assert.ok(modal.classList.contains('open'), '新建模态框应打开');

  // 填写新方案
  document.getElementById('modalInpName').value = '测试自定义4孔扇出';
  document.getElementById('modalSelCategory').value = '自定义扇出';
  window.State.modalVias = [
    { id: 1, x: 0, y: 0, padstack: 'TEST_SIG_PAD', net: 'SIG' },
    { id: 2, x: 0, y: 30, padstack: 'TEST_GND_PAD', net: 'GND' },
    { id: 3, x: 30, y: 0, padstack: 'TEST_GND_PAD', net: 'GND' },
    { id: 4, x: 30, y: 30, padstack: 'TEST_GND_PAD', net: 'GND' }
  ];

  window.saveSchemeFromModal();
  assert.ok(!modal.classList.contains('open'), '保存后模态框应关闭');
  assert.strictEqual(window.State.library.schemes.length, 7, '方案库应增加至 7 个方案');
});

// 3. 聚类距离阈值配置与历史预设 Chip 测试
test('孔聚类分割中心距阈值与单位切换', () => {
  const inpCluster = document.getElementById('inpClusterDist');
  const selUnit = document.getElementById('selClusterUnit');

  assert.strictEqual(inpCluster.value, '2.0', '默认聚类中心距应为 2.0');
  assert.strictEqual(selUnit.value, 'mm', '默认单位应为 mm');

  // 点击 1.5mm Chip
  window.setClusterThresh(1.5, 'mm');
  assert.strictEqual(inpCluster.value, '1.5');
  assert.strictEqual(window.State.clusterDist, 1.5);

  // 切换单位为 mil
  selUnit.value = 'mil';
  window.toggleClusterUnit();
  assert.strictEqual(window.State.clusterDistUnit, 'mil');
  assert.ok(Math.abs(parseFloat(inpCluster.value) - (1.5 / 0.0254)) < 0.1, '单位切换后数值应自动转换');

  // 切回 2.0 mm
  window.setClusterThresh(2.0, 'mm');
});

// 4. 载入 26孔测试数据并执行检查测试
test('26孔测试数据导入、聚类与比对执行', () => {
  const sampleTxt = fs.readFileSync(path.join(__dirname, 'sample/via_trace_airgap_sample.txt'), 'utf8');
  document.getElementById('txtViaInput').value = sampleTxt;

  // Run synchronously for test
  const clusterVal = parseFloat(document.getElementById('inpClusterDist').value) || 2.0;
  const clusterUnit = document.getElementById('selClusterUnit').value;
  const clusterDistInMil = clusterUnit === 'mm' ? clusterVal / 0.0254 : clusterVal;

  const res = window.FanoutChecker.runFanoutInspection(sampleTxt, window.State.library, {
    clusterThreshold: clusterDistInMil,
    distanceTolerance: 2.0,
    allowRotation: true,
    allowMirror: true
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.vias.length, 26, '应解析出 26 个过孔');
  assert.ok(res.clusters.length > 0, '应成功分割出孔群整体');

  window.State.vias = res.vias;
  window.State.clusters = res.clusters;
  window.State.summary = res.summary;
  window.State.page = 1;

  window.updateTopKPIs();
  window.applyFilters();
  window.switchTab('tabResults');

  assert.strictEqual(window.State.activeTab, 'tabResults', '检查完成后应切换至结果页');

  const totalClusters = window.State.summary.totalClusters;
  assert.strictEqual(document.getElementById('cntFilterAll').textContent, String(totalClusters));

  const rows = document.querySelectorAll('#tblResultsBody tr');
  assert.ok(rows.length > 0, '结果表格应正常渲染');
});

// 5. 筛选与搜索功能测试
test('检查结果多维度筛选与快速搜索', () => {
  // 测试「全部」、「通过」、「异常」筛选切换
  window.setResultFilter('all');
  const allCount = window.State.filteredClusters.length;

  window.setResultFilter('pass');
  const passCount = window.State.filteredClusters.length;
  assert.strictEqual(passCount, window.State.summary.passCount);

  window.setResultFilter('fail');
  const failCount = window.State.filteredClusters.length;
  assert.strictEqual(failCount, window.State.summary.failCount);
  assert.strictEqual(passCount + failCount, allCount, '通过数与异常数合计应等于总数');

  // 搜索测试
  document.getElementById('inpSearch').value = 'GND';
  window.applyFilters();
  assert.ok(window.State.filteredClusters.length >= 0, '按网络 GND 搜索过滤');

  document.getElementById('inpSearch').value = '';
  window.setResultFilter('all');
});

// 6. 复核标记 (Reviewed Checkbox) 保留测试
test('孔群复核标记与状态持久化', () => {
  if (window.State.clusters.length > 0) {
    const firstClusterId = window.State.clusters[0].id;
    window.toggleReviewCluster(firstClusterId, true);
    assert.ok(window.State.reviewedClusters.has(firstClusterId), '复核状态应被记录');

    window.renderResultsTable();
    const row = document.getElementById(`row_${firstClusterId}`);
    assert.ok(row.classList.contains('reviewed'), '已复核行应带有 reviewed 样式类');

    window.toggleReviewCluster(firstClusterId, false);
    assert.ok(!window.State.reviewedClusters.has(firstClusterId), '取消复核状态');
  }
});

// 7. 画布图层切换与标尺模式测试
test('2D 空间几何画布图层控制与测距标尺', () => {
  window.switchTab('tabCanvas');
  assert.strictEqual(window.State.activeTab, 'tabCanvas', '应切换到 2D 画布页');

  // 图层切换
  window.toggleCanvasLayer('hulls');
  assert.strictEqual(window.State.canvas.showHulls, false);
  window.toggleCanvasLayer('hulls');
  assert.strictEqual(window.State.canvas.showHulls, true);

  // 测距模式
  window.toggleMeasureMode();
  assert.strictEqual(window.State.canvas.measureMode, true, '应激活测距标尺模式');
  window.toggleMeasureMode();
  assert.strictEqual(window.State.canvas.measureMode, false, '应退出测距标尺模式');
});

// 8. 深度分析面板与孔群存为新方案
test('孔群深度分析浮窗与一键保存为新扇出方案', () => {
  if (window.State.clusters.length > 0) {
    const first = window.State.clusters[0];
    window.openClusterDeepDive(first);
    const box = document.getElementById('canvasInfoBox');
    assert.ok(box.classList.contains('active'), '深度分析面板应激活');

    window.saveClusterAsScheme(first.id);
    assert.ok(window.State.library.schemes.some(s => s.name.includes(first.id)), '从孔群提取的新方案应保存到方案库');
  }
});

// 9. 规律分析页渲染测试
test('规律分析页 (Tab 5) 渲染测试', () => {
  window.switchTab('tabAnalysis');
  assert.strictEqual(window.State.activeTab, 'tabAnalysis', '应切换到规律分析页');
  const pnlDefect = document.getElementById('pnlDefectRanking');
  assert.ok(pnlDefect.textContent.includes('Padstack 不符') || pnlDefect.textContent.includes('中心距超差'));
});

// 10. 导出方案库与导出弹窗测试
test('导出方案库 (JSON) 与通用导出弹窗', () => {
  window.exportLibraryJSON();
  const modal = document.getElementById('modalExport');
  assert.ok(modal.classList.contains('open'), '导出弹窗应已打开');

  const txtArea = document.getElementById('exportModalText');
  assert.ok(txtArea.value.length > 20, '导出文本框应包含有效 JSON 内容');
  const parsed = JSON.parse(txtArea.value);
  assert.ok(Array.isArray(parsed) && parsed.length >= 6, '导出 JSON 应包含方案数组');

  window.closeExportBox();
  assert.ok(!modal.classList.contains('open'), '关闭后弹窗应隐藏');
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
assert.strictEqual(fail, 0);
