/**
 * fanout-ui-test.js
 * 扇出方案检查 UI 交互与全流程测试 (JSDOM)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function loadJsdom() {
  const tries = ['/tmp/npmtest/node_modules/jsdom', '/home/user/node_modules/jsdom', '/tmp/node_modules/jsdom', 'jsdom'];
  for (const t of tries) { try { return require(t); } catch (e) {} }
  throw new Error('找不到 jsdom');
}
const { JSDOM } = loadJsdom();

console.log('== 扇出方案检查 UI 交互与流程测试 ==');

const htmlPath = path.join(__dirname, 'fanout.html');
const jsCheckPath = path.join(__dirname, 'fanout-check.js');

let htmlSource = fs.readFileSync(htmlPath, 'utf8');
const jsCheckSource = fs.readFileSync(jsCheckPath, 'utf8');

// Replace relative script tag with inlined script content for reliable JSDOM execution
// 容忍缓存版本号（<script src="fanout-check.js?v=5">），否则脚本没内联进页面会导致整页初始化失败
htmlSource = htmlSource.replace(/<script src="fanout-check\.js(\?[^"]*)?"><\/script>/, () => `<script>${jsCheckSource}</script>`);
if (!htmlSource.includes('exports') && !htmlSource.includes('fanout-check')) { /* noop */ }

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

// 11. 标准预设方案库「查看」按钮与放大效果图 Padstack 标注全量验证
test('标准预设方案库「查看」按钮位置与逐孔 Padstack 无重叠放大标注验证', () => {
  window.State.library.clear();
  window.loadPresets();
  const cards = document.querySelectorAll('.scheme-card');
  assert.strictEqual(cards.length, 6, '标准预设方案库应包含 6 套方案');

  cards.forEach((card, idx) => {
    const btns = card.querySelectorAll('.scheme-actions button');
    assert.strictEqual(btns.length, 3, `方案卡片 #${idx + 1} 应包含 编辑/删除/查看 三个按钮`);
    assert.ok(btns[1].textContent.includes('删除'), '第二个按钮应为「删除」');
    assert.ok(btns[2].textContent.includes('查看'), '「删除」按钮右边应为「查看」按钮');
  });

  // 逐一点击打开全部 6 套标准预设方案的「查看」弹窗并验证 Padstack 标注
  window.State.library.schemes.forEach(scheme => {
    window.viewScheme(scheme.id);
    const modal = document.getElementById('modalViewScheme');
    assert.ok(modal.classList.contains('open'), `方案【${scheme.name}】放大查看弹窗应打开`);

    const rows = document.querySelectorAll('#viewSchemeViaTableBody tr');
    assert.strictEqual(rows.length, scheme.viaCount, `方案【${scheme.name}】右侧明细表孔数应一致`);

    const layout = window.FanoutChecker.computeSchemeViewLayout(scheme, 760, 520, { showPadstack: true });
    assert.strictEqual(layout.callouts.length, scheme.viaCount, `方案【${scheme.name}】每个孔均应生成 Padstack 标注框`);

    scheme.vias.forEach((v, i) => {
      assert.strictEqual(layout.callouts[i].padstackText, v.padstack, `孔 #${i + 1} 标注 Padstack 必须精确一致`);
      assert.ok(rows[i].textContent.includes(v.padstack), `右侧明细第 ${i + 1} 行应包含 ${v.padstack}`);
    });

    // 验证所有标注框两两不重叠、且不遮挡任何过孔圆盘
    for (let a = 0; a < layout.callouts.length; a++) {
      const ca = layout.callouts[a];
      for (let b = a + 1; b < layout.callouts.length; b++) {
        const cb = layout.callouts[b];
        const ox = Math.min(ca.x + ca.w, cb.x + cb.w) - Math.max(ca.x, cb.x);
        const oy = Math.min(ca.y + ca.h, cb.y + cb.h) - Math.max(ca.y, cb.y);
        assert.ok(!(ox > 0.5 && oy > 0.5), `方案【${scheme.name}】标注框 #${a + 1} 与 #${b + 1} 不应重叠`);
      }
      layout.vias.forEach(vv => {
        const nx = Math.max(ca.x, Math.min(vv.sx, ca.x + ca.w));
        const ny = Math.max(ca.y, Math.min(vv.sy, ca.y + ca.h));
        assert.ok(Math.hypot(nx - vv.sx, ny - vv.sy) >= layout.padR, `方案【${scheme.name}】标注框不应遮挡过孔`);
      });
    }

    window.closeViewSchemeModal();
    assert.ok(!modal.classList.contains('open'), '关闭后放大查看弹窗应隐藏');
  });
});

// 12. 导入数据中 Trace (走线) 读取、概览展示、结果关联与 2D 画布走线控制测试
test('导入 Trace (走线) 数据读取、概览表与 2D 画布联动验证', () => {
  const sampleTxt = fs.readFileSync(path.join(__dirname, 'sample/via_trace_airgap_sample.txt'), 'utf8');
  const res = window.FanoutChecker.runFanoutInspection(sampleTxt, window.State.library);

  assert.strictEqual(res.traces.length, 71, '应从混合测试数据中读取 71 条走线');

  window.State.vias = res.vias;
  window.State.traces = res.traces;
  window.State.traceSummary = res.traceSummary;
  window.State.clusters = res.clusters;
  window.State.summary = res.summary;

  window.renderImportedTraceOverview(res.vias, res.traces, res.traceSummary);
  window.updateTopKPIs();
  window.applyFilters();

  // 顶部走线 KPI 验证
  assert.strictEqual(document.getElementById('statTotalTraces').textContent, '71', '顶部 KPI 应展示 71 段走线');
  assert.ok(document.getElementById('statTraceMeta').textContent.includes('4层/4网络'), '顶部 KPI 应展示 4层/4网络');

  // 导入页走线概览面板与明细表验证
  const overviewCard = document.getElementById('cardImportedTraceOverview');
  assert.strictEqual(overviewCard.style.display, 'block', '已读取走线概览面板应自动展开');
  const traceRows = document.querySelectorAll('#tblImportedTracesBody tr');
  assert.strictEqual(traceRows.length, 71, '走线明细表应渲染全部 71 条记录');

  // 按层别筛选验证
  const selLayer = document.getElementById('selImportTraceLayer');
  selLayer.value = '08IS03';
  window.renderImportedTraceTable();
  const filteredRows = document.querySelectorAll('#tblImportedTracesBody tr');
  assert.ok(filteredRows.length > 0 && filteredRows.length < 71, '按 08IS03 层筛选后行数应收敛');
  selLayer.value = '';
  window.renderImportedTraceTable();

  // 检查结果表关联走线层展示验证
  const resTableText = document.getElementById('tblResultsBody').textContent;
  assert.ok(resTableText.includes('出线层:'), '检查结果表应显示孔群关联的出线层');

  // 2D 画布走线图层开关与定位验证
  assert.strictEqual(window.State.canvas.showTraces, true, '2D 画布默认应开启扇出走线显示');
  window.toggleCanvasLayer('traces');
  assert.strictEqual(window.State.canvas.showTraces, false, '点击扇出走线按钮应可隐藏走线');
  window.toggleCanvasLayer('traces');
  assert.strictEqual(window.State.canvas.showTraces, true, '再次点击应恢复显示走线');

  window.openTraceDeepDive(res.traces[0]);
  assert.ok(document.getElementById('canvasInfoBox').classList.contains('active'), '点击走线应打开走线几何详情浮窗');
  assert.ok(document.getElementById('infoBoxContent').textContent.includes(res.traces[0].layer), '详情浮窗应显示走线层别');
  window.closeInfoBox();
});

// 13. 异常结果定位到空间视图后复核 -> 检查结果明细自动同步勾选验证
test('检查结果明细定位到空间几何视图后复核并自动同步勾选明细表', () => {
  window.State.reviewedClusters.clear();
  window.renderResultsTable();

  const abnormal = window.State.clusters.find(c => !(c.matchResult && c.matchResult.pass)) || window.State.clusters[0];
  assert.ok(abnormal, '应存在待复核的异常孔群');

  // 初始状态：检查结果明细中该行未勾选复核
  const rowBefore = document.getElementById(`row_${abnormal.id}`);
  const rowChecksBefore = rowBefore.querySelectorAll('input[type="checkbox"]');
  assert.strictEqual(rowChecksBefore[0].checked, false, '初始明细复选框应未勾选');
  assert.strictEqual(rowChecksBefore[1].checked, false, '初始复核列复选框应未勾选');

  // 模拟从检查结果明细定位到 2D 空间几何视图并打开详情浮窗
  window.switchTab('tabCanvas');
  window.openClusterDeepDive(abnormal);

  const canvasChk = document.getElementById('chkCanvasClusterReview');
  const canvasBtn = document.getElementById('btnCanvasToggleReview');
  assert.ok(canvasChk && canvasBtn, '空间几何视图详情面板中应包含复核勾选框与复核按钮');
  assert.strictEqual(canvasChk.checked, false, '空间视图初始复核状态应为未勾选');

  // 在空间几何视图点击「确认复核」
  canvasBtn.click();

  // 验证空间视图自身已变为「已复核」状态
  const canvasChkAfter = document.getElementById('chkCanvasClusterReview');
  assert.strictEqual(canvasChkAfter.checked, true, '空间视图复核后勾选框应变为已选中');
  assert.ok(document.getElementById('boxCanvasClusterReview').textContent.includes('已复核'), '空间视图应提示已复核');

  // 切回「检查结果明细」验证复核已自动同步勾选
  window.switchTab('tabResults');
  const rowAfter = document.getElementById(`row_${abnormal.id}`);
  assert.ok(rowAfter.classList.contains('reviewed'), '检查结果明细对应行应自动附带 reviewed 样式');
  const rowChecksAfter = rowAfter.querySelectorAll('input[type="checkbox"]');
  assert.strictEqual(rowChecksAfter[0].checked, true, '检查结果明细首列勾选框应自动同步勾选');
  assert.strictEqual(rowChecksAfter[1].checked, true, '检查结果明细「复核」列勾选框应自动同步勾选');
  assert.ok(rowAfter.textContent.includes('已复核'), '检查结果明细对应行文字应变为「已复核」');
  assert.ok(document.getElementById('badgeResultsReviewProgress').textContent.includes('1 /'), '顶部已复核进度计数应自动+1');

  // 清理恢复未复核状态并验证反向同步取消勾选
  window.toggleReviewCluster(abnormal.id, false);
  const rowReset = document.getElementById(`row_${abnormal.id}`);
  assert.strictEqual(rowReset.querySelectorAll('input[type="checkbox"]')[1].checked, false, '取消复核后明细表也应同步取消勾选');
});

// 14. 扇出方案库快捷改名：预设关键词完备性、按顺序下划线拼接、同一关键词点选两次及新增自定义关键词测试
test('扇出方案快捷改名：关键词点选顺序拼接、同一词点选两次与新增关键词', () => {
  const requiredKws = ['BGA', 'SMA', 'TZ', 'top', 'L2', 'L4', 'L3', 'L12', 'L11', 'L13', 'diff', 'single', '05pitch', '06pitch', '07pitch', '08pitch'];
  const allKws = window.getAllSchemeKeywords();
  requiredKws.forEach(kw => {
    assert.ok(allKws.includes(kw), `预设关键词池应包含 ${kw}`);
  });

  const targetScheme = window.State.library.schemes[0];
  const origName = targetScheme.name;
  window.openQuickRenameModal(targetScheme.id);
  assert.ok(document.getElementById('modalQuickRename').classList.contains('open'), '快捷改名弹窗应打开');

  // 清空并按顺序点选关键词，且同一关键词 BGA 点选两次
  window.clearSchemeKeywords('quick');
  window.clickSchemeKeyword('quick', 'BGA');
  window.clickSchemeKeyword('quick', 'top');
  window.clickSchemeKeyword('quick', 'L12');
  window.clickSchemeKeyword('quick', 'diff');
  window.clickSchemeKeyword('quick', '08pitch');
  window.clickSchemeKeyword('quick', 'BGA');

  const inp = document.getElementById('inpQuickRenameName');
  assert.strictEqual(inp.value, 'BGA_top_L12_diff_08pitch_BGA', '应按点选顺序用下划线连接并支持同一词点选两次');

  // 新增自定义关键词并再次点选两次
  document.getElementById('inpAddKwQuick').value = '10pitch';
  window.addCustomSchemeKeyword('quick');
  assert.ok(window.getAllSchemeKeywords().includes('10pitch'), '应成功添加自定义新关键词 10pitch');

  window.clickSchemeKeyword('quick', '10pitch');
  window.clickSchemeKeyword('quick', '10pitch');
  assert.strictEqual(inp.value, 'BGA_top_L12_diff_08pitch_BGA_10pitch_10pitch', '自定义关键词也应支持重复点选两次');

  // 撤销上一个后保存并检查卡片标题同步
  window.undoSchemeKeyword('quick');
  assert.strictEqual(inp.value, 'BGA_top_L12_diff_08pitch_BGA_10pitch', '撤销上一个词块应生效');

  window.saveQuickRename(false);
  assert.strictEqual(window.State.library.getScheme(targetScheme.id).name, 'BGA_top_L12_diff_08pitch_BGA_10pitch', '方案库中名称应更新');
  assert.ok(document.getElementById(`card_${targetScheme.id}`).textContent.includes('BGA_top_L12_diff_08pitch_BGA_10pitch'), '方案卡片显示名称应立即刷新');

  // 恢复原名清理现场
  window.State.library.renameScheme(targetScheme.id, origName);
  window.deleteCustomSchemeKeyword('10pitch');
  window.renderSchemeCards();
});

// 15. 放大查看扇出方案效果图：不同 Padstack 不同颜色显示与孔到孔中心距测量功能测试
test('放大查看扇出方案效果图：多 Padstack 不同颜色区分与孔到孔中心距测量', () => {
  const multiPadScheme = new window.FanoutChecker.FanoutScheme({
    id: 'test_multi_pad_measure',
    name: 'BGA_L12_diff_08pitch',
    category: 'BGA差分扇出',
    vias: [
      { id: 1, x: 0, y: 0, padstack: 'PAD_SIG_L1_L12', net: 'TX_P', role: '信号孔P' },
      { id: 2, x: 30, y: 40, padstack: 'PAD_GND_BLIND_L1_L3', net: 'GND', role: '盲孔地' },
      { id: 3, x: -20, y: 0, padstack: 'PAD_GND_THRU_ALL', net: 'GND', role: '通孔地' }
    ]
  });
  window.State.library.addScheme(multiPadScheme);
  window.viewScheme(multiPadScheme.id);

  const layout = window.FanoutChecker.computeSchemeViewLayout(multiPadScheme, 760, 520, { showPadstack: true });
  assert.strictEqual(layout.padstackColors.length, 3, '3 种不同 Padstack 应生成 3 项颜色映射');
  const uniqueColors = new Set(layout.vias.map(v => v.padColor));
  assert.strictEqual(uniqueColors.size, 3, '不同 Padstack 的孔必须分配不同颜色');

  const legendHtml = document.getElementById('viewSchemePadLegend').innerHTML;
  assert.ok(legendHtml.includes('PAD_SIG_L1_L12') && legendHtml.includes('PAD_GND_BLIND_L1_L3') && legendHtml.includes('PAD_GND_THRU_ALL'), '工具栏图例应展示各 Padstack 专属色标');

  // 开启测孔中心距功能，依次点选 #1 (0,0) 与 #2 (30,40)，中心距应精确为 50.00 mil (1.270 mm)
  window.toggleViewSchemeMeasureMode(true);
  assert.strictEqual(window.ViewSchemeState.measureMode, true, '测孔中心距模式应开启');

  window.handleViewSchemeViaClick(0);
  assert.strictEqual(window.ViewSchemeState.measureStartIndex, 0, '第一次点击应记录起点孔 #1');
  assert.ok(document.getElementById('viewSchemeMeasurePanel').textContent.includes('#1'), '测距面板应提示已选起点 #1');

  window.handleViewSchemeViaClick(1);
  assert.strictEqual(window.ViewSchemeState.measureStartIndex, -1, '完成两点选择后起点应归位');
  assert.strictEqual(window.ViewSchemeState.measuredPairs.length, 1, '应生成 1 条孔到孔中心距记录');

  const measurePanelText = document.getElementById('viewSchemeMeasurePanel').textContent;
  assert.ok(measurePanelText.includes('50.00 mil'), '中心距应精确显示 50.00 mil');
  assert.ok(measurePanelText.includes('1.270 mm'), '中心距应同时换算显示 1.270 mm');

  window.clearViewSchemeMeasurements();
  assert.strictEqual(window.ViewSchemeState.measuredPairs.length, 0, '清除测量后记录应清空');
  window.toggleViewSchemeMeasureMode(false);
  window.closeViewSchemeModal();
  window.State.library.removeScheme('test_multi_pad_measure');
  window.renderSchemeCards();
});

// 16. 整个扇出方案库跨方案统一 Padstack 配色一致性验证
test('整个方案库跨方案统一配色：同一种 Padstack 在所有方案的效果图与缩略图中显示相同颜色', () => {
  window.State.library.clear();
  window.State.library.loadStandardPresets();
  window.renderSchemeCards();

  const schemes = window.State.library.schemes;
  assert.strictEqual(schemes.length, 6, '标准预设应包含 6 套方案');

  // 收集 6 套预设方案中所有孔的 (padstack -> 实际渲染颜色集合)
  const colorsByPadstack = {};
  schemes.forEach(sc => {
    const layout = window.FanoutChecker.computeSchemeViewLayout(sc, 760, 520, {
      showPadstack: true,
      librarySchemes: schemes
    });
    layout.vias.forEach(v => {
      if (!colorsByPadstack[v.padstack]) colorsByPadstack[v.padstack] = new Set();
      colorsByPadstack[v.padstack].add(v.padColor);
    });
  });

  // 预设方案 1~5 均包含 BGA_GND_pad1mil_0902（其中方案 4、5 为纯地孔阵列无信号孔），颜色必须完全一致！
  assert.ok(colorsByPadstack['BGA_GND_pad1mil_0902'], '应包含 BGA_GND_pad1mil_0902');
  assert.strictEqual(colorsByPadstack['BGA_GND_pad1mil_0902'].size, 1, 'BGA_GND_pad1mil_0902 在全部 5 套含该焊盘的方案（含纯地孔方案）中必须使用同一种颜色');

  // 预设方案 3 与方案 6 均使用 test_BGA_3510_L19_L2_ring3mil，颜色必须完全一致！
  assert.ok(colorsByPadstack['test_BGA_3510_L19_L2_ring3mil'], '应包含 test_BGA_3510_L19_L2_ring3mil');
  assert.strictEqual(colorsByPadstack['test_BGA_3510_L19_L2_ring3mil'].size, 1, 'test_BGA_3510_L19_L2_ring3mil 在方案 3 与方案 6 中必须使用同一种颜色');

  // 不同 Padstack 之间颜色必须互不相同
  const padNames = Object.keys(colorsByPadstack);
  const distinctGlobalColors = new Set(padNames.map(p => Array.from(colorsByPadstack[p])[0]));
  assert.strictEqual(distinctGlobalColors.size, padNames.length, '方案库中不同 Padstack 必须分配互不相同的专属颜色');

  // 再新增两个自定义方案共享同一个新焊盘 SHARED_DIFF_VIA_08，搭配各自不同的其他焊盘，验证跨方案颜色完全一致
  const scA = new window.FanoutChecker.FanoutScheme({
    id: 'test_shared_a',
    name: 'BGA_top_L2_diff',
    vias: [
      { id: 1, x: 0, y: 0, padstack: 'ONLY_IN_SCHEME_A_PAD', net: 'GND', role: '地孔' },
      { id: 2, x: 20, y: 0, padstack: 'SHARED_DIFF_VIA_08', net: 'TX_P', role: '差分P' }
    ]
  });
  const scB = new window.FanoutChecker.FanoutScheme({
    id: 'test_shared_b',
    name: 'SMA_bottom_L12_diff',
    vias: [
      { id: 1, x: -10, y: 0, padstack: 'SHARED_DIFF_VIA_08', net: 'RX_P', role: '差分P' },
      { id: 2, x: 10, y: 0, padstack: 'ONLY_IN_SCHEME_B_PAD', net: 'RX_N', role: '其他孔' },
      { id: 3, x: 0, y: 20, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随地' }
    ]
  });
  window.State.library.addScheme(scA);
  window.State.library.addScheme(scB);
  window.renderSchemeCards();

  const layoutA = window.FanoutChecker.computeSchemeViewLayout(scA, 760, 520, { showPadstack: true, librarySchemes: window.State.library.schemes });
  const layoutB = window.FanoutChecker.computeSchemeViewLayout(scB, 760, 520, { showPadstack: true, librarySchemes: window.State.library.schemes });

  const sharedColorInA = layoutA.vias.find(v => v.padstack === 'SHARED_DIFF_VIA_08').padColor;
  const sharedColorInB = layoutB.vias.find(v => v.padstack === 'SHARED_DIFF_VIA_08').padColor;
  assert.strictEqual(sharedColorInA, sharedColorInB, 'SHARED_DIFF_VIA_08 在方案 A 与方案 B 放大效果图中必须显示完全相同的颜色');

  const gndColorInB = layoutB.vias.find(v => v.padstack === 'BGA_GND_pad1mil_0902').padColor;
  const gndColorPreset = Array.from(colorsByPadstack['BGA_GND_pad1mil_0902'])[0];
  assert.strictEqual(gndColorInB, gndColorPreset, '新方案中的 BGA_GND_pad1mil_0902 与原方案库中的同焊盘颜色必须完全一致');

  // 顶部方案库全局 Padstack 统一色卡栏也应渲染出新焊盘
  const globalLegendHtml = document.getElementById('libraryPadstackLegendBar').innerHTML;
  assert.ok(globalLegendHtml.includes('SHARED_DIFF_VIA_08') && globalLegendHtml.includes('BGA_GND_pad1mil_0902'), '方案库顶部全局色卡应汇总展示各 Padstack 统一颜色');

  window.State.library.removeScheme('test_shared_a');
  window.State.library.removeScheme('test_shared_b');
  window.renderSchemeCards();
});

// 17. 顶栏全局显示控制：100%铺满宽屏与全屏工作台切换验证
test('顶栏全局显示控制：铺满宽屏与全屏工作台按钮及状态持久化', () => {
  const btnWide = document.getElementById('btnGlobalWide');
  const btnFs = document.getElementById('btnGlobalFullscreen');
  assert.ok(btnWide && btnFs, '顶栏必须包含「铺满宽屏」与「全屏工作台」全局显示按钮');

  window.setGlobalWideMode(false, true);
  assert.strictEqual(document.documentElement.classList.contains('pcb-global-wide'), false, '初始关闭铺满宽屏');

  window.toggleGlobalWideMode();
  assert.strictEqual(document.documentElement.classList.contains('pcb-global-wide'), true, '点击后应激活 pcb-global-wide 全宽模式');
  try {
    assert.strictEqual(window.localStorage.getItem('pcb_workbench_wide_v1'), '1', '铺满宽屏状态应写入 localStorage 跨页面共享');
  } catch (e) {}
  assert.ok(document.getElementById('lblGlobalWide').textContent.includes('已铺满宽屏'), '按钮文字应同步更新');

  // 点击全屏工作台时即使 JSDOM 无原生 requestFullscreen，也应自动确保全宽模式开启且不抛错
  window.setGlobalWideMode(false, true);
  window.toggleGlobalFullscreen();
  assert.strictEqual(document.documentElement.classList.contains('pcb-global-wide'), true, '开启全屏工作台应自动激活 100% 铺满宽屏');

  window.setGlobalWideMode(false, true);
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
assert.strictEqual(fail, 0);
