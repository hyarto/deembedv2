/* 由旧版 pour.html 单体 UI 测试迁移：加载方式改为 openPage，断言保持原口径，按新三栏结构修正选择器 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { openPage, tick, CHECKER_DIR } = require('../helpers/open-page');
const __dir = CHECKER_DIR;
const ctx = openPage('pour.html', { syncCheck: true });
const w = ctx.w, d = w.document, window = w, document = d;
const $ = id => d.getElementById(id);
let domErr = 0;
const PourChecker = require('../../packages/engines/pour/index.js');
(async () => {
await tick(250);
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


console.log('== 铜皮检查 (Copper Pour Inspection) UI、多规则、对象汇总与规律分析测试 ==');

test('页面基本元素与 5 个页签存在', () => {
  if (!d.title.includes('铜皮检查')) throw new Error('标题不包含铜皮检查');
  const tabs = d.querySelectorAll('nav#tabs button');
  if (tabs.length !== 5) throw new Error('页签数量应为 5，实际 ' + tabs.length);
});

test('规则 1、规则 2、规则 3 多规则配置表格与卡片存在', () => {
  if (!$('tblRule1Body')) throw new Error('缺少 Rule 1 表格体');
  if (!$('tblRule2Body')) throw new Error('缺少 Rule 2 表格体');
  if (!$('tblRule3Body')) throw new Error('缺少 Rule 3 表格体');
  if (w.State.viaCoverageRules.length < 2) throw new Error('Rule 1 初始规则应至少有 2 条');
  if (w.State.specialShapeTemplates.length < 2) throw new Error('Rule 2 初始模板应至少有 2 条');
  if (w.State.traceMarginRules.length < 2) throw new Error('Rule 3 初始规则应至少有 2 条');
});

test('每个输入框下方均存在历史快捷选项栏 (History Chips)', () => {
  const chipBars = [
    'chipsModalR1Padstack', 'chipsModalR1Layers', 'chipsModalR1Dist',
    'chipsModalR2Name', 'chipsModalR2Padstack', 'chipsModalR2Layer', 'chipsModalR2Tol',
    'chipsModalR3TraceLayer', 'chipsModalR3UpperRef', 'chipsModalR3LowerRef', 'chipsModalR3Margin',
    'chipsRule4Area', 'chipsRule5Radius'
  ];

  chipBars.forEach(id => {
    const el = $(id);
    if (!el) throw new Error(`缺少历史选项栏: ${id}`);
    if (!el.innerHTML.includes('chip') && !el.innerHTML.includes('快捷选项')) {
      throw new Error(`历史选项栏 ${id} 未正确渲染历史标签`);
    }
  });
});

test('历史快捷标签点击即可回填输入框', () => {
  const chip = d.querySelector('#chipsRule4Area .chip');
  if (!chip) throw new Error('未找到 Rule 4 快捷标签');
  const chipText = chip.textContent.replace(' sq mil', '').trim();
  chip.click();
  if ($('rule4InpArea').value !== chipText) {
    throw new Error(`回填失败: 预期 ${chipText}, 实际 ${$('rule4InpArea').value}`);
  }
});

test('弹窗新增规则 1 (孔铺铜覆盖规则) 并保存', () => {
  w.openAddRule1Modal();
  if (!$('modalRule1').classList.contains('open')) throw new Error('Modal 1 未打开');
  $('modalR1InpPadstack').value = 'BGA_GND_pad1mil_0902';
  $('modalR1InpLayers').value = '02G01P, 19IS08';
  $('modalR1InpDist').value = '45.0';
  w.saveRule1FromModal();
  if ($('modalRule1').classList.contains('open')) throw new Error('Modal 1 未在保存后关闭');
  const found = w.State.viaCoverageRules.some(r => r.padstack === 'BGA_GND_pad1mil_0902');
  if (!found) throw new Error('新增的规则 1 未存入 State');
});

test('弹窗导入 Shape TXT 并解析异型铜皮几何与面积 (规则 2)', () => {
  w.openAddRule2Modal();
  if (!$('modalRule2').classList.contains('open')) throw new Error('Modal 2 未打开');
  $('modalR2InpPadstack').value = 'BGA_GND_pad1mil_0902';
  $('modalR2InpLayer').value = '02G01P';
  $('modalR2TxtShape').value = `Item 1  < Shape >\n  Subset: 02G01P\n  Area: 907.92028 (sq mil)\nExterior Boundary:\n  Arc seg: xy [21208.94, 35522.46]  xy [21208.94, 35522.46]\n    Center-xy: [21220.94, 35522.46] Radius (12.0000) CCW`;
  w.previewModalShape();
  if (!w.State.modalShapeParsed) throw new Error('未解析出 Shape 对象');
  if (Math.abs(w.State.modalShapeParsed.area - 907.92028) > 0.001) throw new Error('解析的面积不符合预期');
  w.saveRule2FromModal();
  if ($('modalRule2').classList.contains('open')) throw new Error('Modal 2 未在保存后关闭');
  const found = w.State.specialShapeTemplates.some(t => Math.abs(t.expectedArea - 907.92028) < 0.1);
  if (!found) throw new Error('新增的规则 2 模板未存入 State');
});

test('弹窗新增规则 3 (走线参考层超宽规则) 并保存', () => {
  w.openAddRule3Modal();
  if (!$('modalRule3').classList.contains('open')) throw new Error('Modal 3 未打开');
  $('modalR3InpTraceLayer').value = '19IS08';
  $('modalR3InpUpperRef').value = '02G01P';
  $('modalR3InpLowerRef').value = 'Bottom';
  $('modalR3InpMargin').value = '42.0';
  w.saveRule3FromModal();
  if ($('modalRule3').classList.contains('open')) throw new Error('Modal 3 未在保存后关闭');
  const found = w.State.traceMarginRules.some(r => r.traceLayer === '19IS08' && r.minMargin === 42.0);
  if (!found) throw new Error('新增的规则 3 未存入 State');
});

test('【保存规则到本地 (JSON)】整页规则导出功能验证', () => {
  let exportCaptured = null;
  w.showExportBox = function(filename, text, hint) {
    exportCaptured = { filename, text, hint };
  };

  w.exportRulesToLocalFile();
  if (!exportCaptured) throw new Error('未调用 showExportBox 导出规则');
  if (!exportCaptured.filename.includes('.json')) throw new Error('导出文件名应为 json');

  const json = JSON.parse(exportCaptured.text);
  if (!json.viaCoverageRules || json.viaCoverageRules.length === 0) throw new Error('导出 JSON 缺少 viaCoverageRules');
  if (!json.specialShapeTemplates || json.specialShapeTemplates.length === 0) throw new Error('导出 JSON 缺少 specialShapeTemplates');
  if (!json.traceMarginRules || json.traceMarginRules.length === 0) throw new Error('导出 JSON 缺少 traceMarginRules');
  if (typeof json.smallCopperAreaThreshold !== 'number') throw new Error('导出 JSON 缺少 smallCopperAreaThreshold');
  if (typeof json.minArcRadius !== 'number') throw new Error('导出 JSON 缺少 minArcRadius');
  if (!json.history) throw new Error('导出 JSON 缺少 history 记录');

  const status = $('lblRuleFileStatus');
  if (!status || status.style.display === 'none') throw new Error('未显示导出成功状态横幅');
});

test('【从本地文件读取约束 (JSON)】规则导入与一键恢复验证', () => {
  const customRulePack = {
    version: '1.0',
    tool: 'pcb_pour_checker',
    viaCoverageRules: [
      { id: 'custom_cov_1', padstack: 'TEST_CUSTOM_VIA_STACK', layers: 'L1-L12', coverageRadius: 60.0 }
    ],
    specialShapeTemplates: [
      { id: 'custom_tmpl_1', name: '测试专用异型铜皮模板', padstack: 'TEST_CUSTOM_VIA_STACK', layer: '19IS08', expectedArea: 320.0, areaTolerance: 15.0, rawShapeText: '' }
    ],
    traceMarginRules: [
      { id: 'custom_margin_1', traceLayer: '08IS03', upperRefLayer: 'Top', lowerRefLayer: 'Bottom', minMargin: 55.0 }
    ],
    smallCopperAreaThreshold: 350.0,
    minArcRadius: 8.5,
    history: {
      r1_padstack: ['TEST_CUSTOM_VIA_STACK']
    }
  };

  w.applyRuleSnapshot(customRulePack, true);

  if (w.State.viaCoverageRules.length !== 1 || w.State.viaCoverageRules[0].padstack !== 'TEST_CUSTOM_VIA_STACK') {
    throw new Error('规则 1 未正确恢复');
  }
  if (w.State.specialShapeTemplates.length !== 1 || w.State.specialShapeTemplates[0].name !== '测试专用异型铜皮模板') {
    throw new Error('规则 2 模板未正确恢复');
  }
  if (w.State.traceMarginRules.length !== 1 || w.State.traceMarginRules[0].minMargin !== 55.0) {
    throw new Error('规则 3 未正确恢复');
  }
  if ($('rule4InpArea').value !== '350') {
    throw new Error('规则 4 输入框值未更新为 350');
  }
  if ($('rule5InpRadius').value !== '8.5') {
    throw new Error('规则 5 输入框值未更新为 8.5');
  }
});

test('【一键复制全部内容】导出浮窗复制功能 Fail-Safe 验证', () => {
  $('exportModalText').value = 'TEST_EXPORT_CONTENT_CLIPBOARD';
  w.copyExportContent();
  const tip = $('copySuccessTip');
  if (!tip || tip.style.display !== 'inline-flex') {
    throw new Error('复制成功提示未显示');
  }
});

test('【目标对象汇总展示】同一目标对象的多层问题自动汇总聚合', () => {
  w.State.viaCoverageRules = [
    { id: 'cov_hdi', padstack: 'HDI_045drill', layers: 'L1-L4', coverageRadius: 50.0 }
  ];

  const sampleMultiLayerTxt = `
Total 3 Items
Item 53  < Via >
  Padstack Name: HDI_045drill_ring3_1_4
  Layer: 02G01P
  Net: 21_N
  Location: [21220.94, 35522.46]

Item 54  < Via >
  Padstack Name: HDI_045drill_ring3_1_4
  Layer: 02G01P
  Net: 21_N
  Location: [21250.94, 35522.46]

Item 55  < Via >
  Padstack Name: HDI_045drill_ring3_1_4
  Layer: 02G01P
  Net: 21_P
  Location: [21280.94, 35522.46]
`;

  $('txtDataInput').value = sampleMultiLayerTxt;
  w.executeCopperChecks();

  if (w.State.rawResults.length !== 12) {
    throw new Error(`逐层原始记录应为 3孔 × 4层 = 12条，实际为 ${w.State.rawResults.length}`);
  }

  if (w.State.groupedResults.length !== 3) {
    throw new Error(`按目标对象汇总后应聚合为 3 个孔对象，实际为 ${w.State.groupedResults.length}`);
  }

  const via53Group = w.State.groupedResults.find(g => String(g.viaId) === '53');
  if (!via53Group) throw new Error('未找到孔 #53 汇总对象');
  if (via53Group.failCount !== 4) throw new Error('孔 #53 应汇总 4 层超标');
  if (!via53Group.layerListStr.includes('L1, L2, L3, L4')) throw new Error('孔 #53 涉及层别应列出 L1, L2, L3, L4');

  // Verify UI rendering in grouped mode
  w.setViewMode('grouped');
  const rows = d.querySelectorAll('#tblResultsBody tr');
  if (rows.length !== 3) {
    throw new Error(`汇总视图下表格应只渲染 3 行，实际为 ${rows.length} 行`);
  }

  // Test expanding sub-rows
  w.toggleRowExpand(via53Group.groupKey);
  const subRows = d.querySelectorAll('#tblResultsBody tr.subrow');
  if (subRows.length !== 1) throw new Error('展开后应出现 1 个嵌套明细子表行');
});

test('【走线导入与空间可视化】走线解析、2D 画布渲染与参考层超宽检查验证', () => {
  const mixedDataTxt = `
Total 3 Items
Item 1  < Shape >
  Set: ETCH
  Subset: 02G01P
  Area: 50000.0 (sq mil)
  Exterior Boundary:
    Line seg: xy [24000, 23000]  xy [26000, 23000]
    Line seg: xy [26000, 23000]  xy [26000, 24000]
    Line seg: xy [26000, 24000]  xy [24000, 24000]
    Line seg: xy [24000, 24000]  xy [24000, 23000]

Item 2  < Trace >
  Set: Trace
  Subset: 19IS08
  Net: 105_P
  Length: 2000.068301
  Seg: xy [25018.9300, 23592.4500]  xy [24669.2400, 23592.4500] Width (5.6000) Angle (0.000)
  Arc seg: xy [24669.2400, 23592.4500]  xy [24616.8500, 23940.0700] Width (5.6000)
    Center-xy: [24669.2300, 23640.0700]  Radius (52.3800) CCW
  Seg: xy [24616.8500, 23540.0700]  xy [24916.8500, 23456.2000] Width (5.6000) Angle (90.000)

Item 3  < Via >
  Padstack Name: BGA_GND_pad1mil_0902
  Layer: 02G01P
  Origin-xy: [24669.23, 23640.07]
`;

  w.State.traceMarginRules = [
    { id: 'margin_rule_test', traceLayer: '19IS08', upperRefLayer: '02G01P', lowerRefLayer: 'Bottom', minMargin: 50.0 }
  ];

  $('txtDataInput').value = mixedDataTxt;
  w.executeCopperChecks();

  if (w.State.traces.length !== 1) {
    throw new Error(`应解析出 1 条走线，实际为 ${w.State.traces.length}`);
  }
  if (w.State.traces[0].segments.length !== 3) {
    throw new Error(`走线应包含 3 段（直线+圆弧），实际为 ${w.State.traces[0].segments.length}`);
  }

  // Verify Trace Margin check
  const marginResults = w.State.rawResults.filter(r => r.checkCategory === 'trace_ref_margin');
  if (marginResults.length !== 2) {
    throw new Error(`走线参考层检查应生成 2 条记录（上参考 02G01P 与下参考 Bottom），实际为 ${marginResults.length}`);
  }

  const upperRes = marginResults.find(r => r.refLayer.toUpperCase() === '02G01P');
  if (!upperRes || !upperRes.pass) {
    throw new Error('走线在 02G01P 铜皮内部且单侧外延 > 50mil 应判定为符合');
  }

  const lowerRes = marginResults.find(r => r.refLayer.toUpperCase() === 'BOTTOM');
  if (!lowerRes || lowerRes.pass) {
    throw new Error('走线在无铜皮的 Bottom 层应判定为不符合');
  }

  // Switch to Canvas Tab and test rendering
  w.switchTab('tabCanvas');
  w.renderCanvas();
});

test('【⑤ 缺陷规律与工程分析】五大分类深度归纳总结与导出', () => {
  w.switchTab('tabAnalysis');
  const container = $('pnlAnalysisContainer');
  if (!container || container.innerHTML.includes('尚无检查数据')) {
    throw new Error('分析页未渲染归纳总结卡片');
  }

  const text = container.textContent;
  if (!text.includes('① 孔经过层铺铜覆盖检查 — 缺陷规律与工程分析')) throw new Error('缺少分类 1 规律分析');
  if (!text.includes('② 特定异型铜皮比对检查 — 缺陷规律与工程分析')) throw new Error('缺少分类 2 规律分析');
  if (!text.includes('③ 走线参考层铺铜覆盖与单侧超宽 — 缺陷规律与工程分析')) throw new Error('缺少分类 3 规律分析');
  if (!text.includes('④ 孤立小铜皮检查 — 缺陷规律与工程分析')) throw new Error('缺少分类 4 规律分析');
  if (!text.includes('⑤ 铜皮最小圆弧半径检查 — 缺陷规律与工程分析')) throw new Error('缺少分类 5 规律分析');

  // Export report test
  let reportCaptured = null;
  w.showExportBox = function(filename, content) {
    reportCaptured = { filename, content };
  };
  w.exportAnalysisReport();
  if (!reportCaptured || !reportCaptured.filename.includes('分析报告')) {
    throw new Error('未能成功导出分析报告');
  }
});

test('分类筛选与缺陷过滤工作正常', () => {
  w.setCategoryFilter('via_coverage');
  if (w.State.categoryFilter !== 'via_coverage') throw new Error('分类筛选未切换至 via_coverage');
  if (w.State.filteredResults.some(r => r.checkCategory !== 'via_coverage')) {
    throw new Error('过滤结果包含非 via_coverage 项');
  }

  w.setCategoryFilter('all');
  if (w.State.categoryFilter !== 'all') throw new Error('分类筛选未重置为 all');
});

test('复核状态勾选与记忆更新', () => {
  const itemKey = 'via_coverage_53_1';
  w.toggleReviewItem(itemKey, true);
  if (!w.State.reviewedItems.has(itemKey)) throw new Error('复核集合中未记录 itemKey');
  w.toggleReviewItem(itemKey, false);
  if (w.State.reviewedItems.has(itemKey)) throw new Error('复核集合未能正确取消');
});

test('CSV 导出弹窗正常生成', () => {
  let opened = false;
  w.showExportBox = function(filename, text) {
    opened = true;
    if (!filename.includes('copper_pour')) throw new Error('文件名不符合规范');
    if (!text.includes('检查分类')) throw new Error('CSV 缺少表头');
  };
  w.exportResultsCSV();
  if (!opened) throw new Error('未调用 showExportBox');
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);

})();
