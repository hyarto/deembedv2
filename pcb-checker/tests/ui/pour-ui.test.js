/* ============================================================================
 * pour-ui.test.js —— 铜皮检查模块全流程 UI 回归测试（基于三栏渐进式 EDA 工作台）
 * ========================================================================== */
'use strict';

const { openPage } = require('../helpers/open-page');

const ctx = openPage('pour.html', { syncCheck: true });
const { w, d } = ctx;
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

console.log('== 铜皮检查：三栏 EDA 壳层、五项规则、对象汇总与规律分析测试 ==');

test('三栏 EDA 壳层完整、悬浮 Tips 正常、静态标题/标签无括号解释', () => {
  if (!d.title.includes('铜皮检查')) throw new Error('标题不包含铜皮检查');
  if (!d.body.classList.contains('eda-workbench')) throw new Error('缺少 body.eda-workbench');
  if (!d.querySelector('aside.eda-left-rail nav#tabs')) throw new Error('工序条不在左列导轨');
  if (!d.querySelector('aside.eda-right-dock .global-display-ctrl')) throw new Error('显示控制区不在右工具栏');
  const tabs = d.querySelectorAll('nav#tabs button');
  if (tabs.length !== 5) throw new Error('页签数量应为 5，实际 ' + tabs.length);

  [...d.querySelectorAll('h1, h2, h3, nav#tabs button, .form-item label, th')].forEach(el => {
    if (/[（(].+[)）]/.test(el.textContent)) {
      throw new Error('静态文案仍含括号解释：' + el.textContent.trim());
    }
  });

  const tipCarrier = d.querySelector('[data-tip]');
  w.EdaTooltip.show(tipCarrier);
  if ($('edaFloatingTooltip').style.display !== 'block') throw new Error('悬浮气泡未显示');
  w.EdaTooltip.hide();
});

test('规则 1/2/3 多规则配置表格与历史快捷标签初始化正常', () => {
  if (!$('tblRule1Body') || !$('tblRule2Body') || !$('tblRule3Body')) throw new Error('缺少规则表格体');
  if (w.State.viaCoverageRules.length < 2) throw new Error('Rule 1 初始规则应至少有 2 条');
  if (w.State.specialShapeTemplates.length < 2) throw new Error('Rule 2 初始模板应至少有 2 条');
  if (w.State.traceMarginRules.length < 2) throw new Error('Rule 3 初始规则应至少有 2 条');

  const chipBars = [
    'chipsModalR1Padstack', 'chipsModalR1Layers', 'chipsModalR1Dist',
    'chipsModalR2Name', 'chipsModalR2Padstack', 'chipsModalR2Layer', 'chipsModalR2Tol',
    'chipsModalR3TraceLayer', 'chipsModalR3UpperRef', 'chipsModalR3LowerRef', 'chipsModalR3Margin',
    'chipsRule4Area', 'chipsRule5Radius'
  ];
  chipBars.forEach(id => {
    const el = $(id);
    if (!el || !el.querySelector('.chip')) throw new Error(`历史选项栏异常: ${id}`);
  });

  const chip = d.querySelector('#chipsRule4Area .chip');
  const chipText = chip.textContent.replace(' sq mil', '').trim();
  chip.click();
  if ($('rule4InpArea').value !== chipText) {
    throw new Error(`回填失败: 预期 ${chipText}, 实际 ${$('rule4InpArea').value}`);
  }
});

test('弹窗新增规则 1/2/3 与异型铜皮 Shape TXT 几何解析保存', () => {
  w.openAddRule1Modal();
  if (!$('modalRule1').classList.contains('open')) throw new Error('Modal 1 未打开');
  $('modalR1InpPadstack').value = 'BGA_GND_pad1mil_0902';
  $('modalR1InpLayers').value = '02G01P, 19IS08';
  $('modalR1InpDist').value = '45.0';
  w.saveRule1FromModal();
  if ($('modalRule1').classList.contains('open')) throw new Error('Modal 1 未关闭');
  if (!w.State.viaCoverageRules.some(r => r.padstack === 'BGA_GND_pad1mil_0902' && r.coverageRadius === 45.0)) {
    throw new Error('规则 1 未保存');
  }

  w.openAddRule2Modal();
  if (!$('modalRule2').classList.contains('open')) throw new Error('Modal 2 未打开');
  $('modalR2InpPadstack').value = 'BGA_GND_pad1mil_0902';
  $('modalR2InpLayer').value = '02G01P';
  $('modalR2TxtShape').value = `Item 1  < Shape >\n  Subset: 02G01P\n  Area: 907.92028 (sq mil)\nExterior Boundary:\n  Arc seg: xy [21208.94, 35522.46]  xy [21208.94, 35522.46]\n    Center-xy: [21220.94, 35522.46] Radius (12.0000) CCW`;
  w.previewModalShape();
  if (!w.State.modalShapeParsed || Math.abs(w.State.modalShapeParsed.area - 907.92028) > 0.001) {
    throw new Error('异型 Shape 面积解析异常');
  }
  w.saveRule2FromModal();
  if ($('modalRule2').classList.contains('open')) throw new Error('Modal 2 未关闭');
  if (!w.State.specialShapeTemplates.some(t => Math.abs(t.expectedArea - 907.92028) < 0.1)) {
    throw new Error('规则 2 模板未保存');
  }

  w.openAddRule3Modal();
  if (!$('modalRule3').classList.contains('open')) throw new Error('Modal 3 未打开');
  $('modalR3InpTraceLayer').value = '19IS08';
  $('modalR3InpUpperRef').value = '02G01P';
  $('modalR3InpLowerRef').value = 'Bottom';
  $('modalR3InpMargin').value = '42.0';
  w.saveRule3FromModal();
  if ($('modalRule3').classList.contains('open')) throw new Error('Modal 3 未关闭');
  if (!w.State.traceMarginRules.some(r => r.traceLayer === '19IS08' && r.minMargin === 42.0)) {
    throw new Error('规则 3 未保存');
  }
});

test('规则 JSON 快照导出、本地恢复与导出复制兜底验证', () => {
  const origExport = w.showExportBox;
  let exportCaptured = null;
  w.showExportBox = function (filename, text, hint) {
    exportCaptured = { filename, text, hint };
  };

  w.exportRulesToLocalFile();
  if (!exportCaptured || !exportCaptured.filename.includes('.json')) throw new Error('未导出 JSON 规则文件');
  const json = JSON.parse(exportCaptured.text);
  if (!json.viaCoverageRules.length || !json.specialShapeTemplates.length || !json.traceMarginRules.length) {
    throw new Error('导出 JSON 内容不完整');
  }
  if ($('lblRuleFileStatus').style.display === 'none') throw new Error('状态提示未显示');

  w.applyRuleSnapshot({
    version: '1.0',
    tool: 'pcb_pour_checker',
    viaCoverageRules: [{ id: 'custom_cov_1', padstack: 'TEST_CUSTOM_VIA_STACK', layers: 'L1-L12', coverageRadius: 60.0 }],
    specialShapeTemplates: [{ id: 'custom_tmpl_1', name: '测试专用异型铜皮模板', padstack: 'TEST_CUSTOM_VIA_STACK', layer: '19IS08', expectedArea: 320.0, areaTolerance: 15.0, rawShapeText: '' }],
    traceMarginRules: [{ id: 'custom_margin_1', traceLayer: '08IS03', upperRefLayer: 'Top', lowerRefLayer: 'Bottom', minMargin: 55.0 }],
    smallCopperAreaThreshold: 350.0,
    minArcRadius: 8.5,
    history: { r1_padstack: ['TEST_CUSTOM_VIA_STACK'] }
  }, true);

  if (w.State.viaCoverageRules[0].padstack !== 'TEST_CUSTOM_VIA_STACK') throw new Error('规则 1 恢复失败');
  if (w.State.specialShapeTemplates[0].name !== '测试专用异型铜皮模板') throw new Error('规则 2 恢复失败');
  if (w.State.traceMarginRules[0].minMargin !== 55.0) throw new Error('规则 3 恢复失败');
  if ($('rule4InpArea').value !== '350' || $('rule5InpRadius').value !== '8.5') throw new Error('阈值输入框未同步');

  $('exportModalText').value = 'TEST_EXPORT_CONTENT_CLIPBOARD';
  w.copyExportContent();
  if ($('copySuccessTip').style.display !== 'inline-flex') throw new Error('复制成功提示未显示');
  w.showExportBox = origExport;
});

test('同一目标对象多层问题自动汇总聚合、子行展开与 XSS 防护', () => {
  w.State.viaCoverageRules = [
    { id: 'cov_hdi', padstack: 'HDI_045drill', layers: 'L1-L4', coverageRadius: 50.0 }
  ];
  const evil = '<img src=x onerror="window.__pwn=1">';
  const sampleMultiLayerTxt = `
Total 3 Items
Item 53  < Via >
  Padstack Name: HDI_045drill_ring3_1_4
  Layer: 02G01P
  Net: 21_N${evil}
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

  if (w.State.rawResults.length !== 12) throw new Error(`逐层原始记录应为 12 条，实际 ${w.State.rawResults.length}`);
  if (w.State.groupedResults.length !== 3) throw new Error(`汇总后应为 3 个孔对象，实际 ${w.State.groupedResults.length}`);
  if (d.querySelectorAll('img[src="x"]').length) throw new Error('检测到未转义 HTML 注入');

  const via53Group = w.State.groupedResults.find(g => String(g.viaId) === '53');
  if (!via53Group || via53Group.failCount !== 4) throw new Error('孔 #53 应汇总 4 层超标');

  w.setViewMode('grouped');
  if (d.querySelectorAll('#tblResultsBody tr').length !== 3) throw new Error('汇总视图行数应为 3');
  w.toggleRowExpand(via53Group.groupKey);
  if (d.querySelectorAll('#tblResultsBody tr.subrow').length !== 1) throw new Error('展开后应出现 1 个子表行');
});

test('走线导入、参考层超宽判定、2D 画布视口定位复核、规律分析与 CSV 导出', () => {
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

  if (w.State.traces.length !== 1 || w.State.traces[0].segments.length !== 3) {
    throw new Error('走线直线+圆弧段解析数量异常');
  }
  const marginResults = w.State.rawResults.filter(r => r.checkCategory === 'trace_ref_margin');
  const upperRes = marginResults.find(r => r.refLayer.toUpperCase() === '02G01P');
  const lowerRes = marginResults.find(r => r.refLayer.toUpperCase() === 'BOTTOM');
  if (!upperRes || !upperRes.pass || !lowerRes || lowerRes.pass) {
    throw new Error('走线上下参考层超宽判定结果异常');
  }

  w.switchTab('tabCanvas');
  w.renderCanvas();

  w.switchTab('tabAnalysis');
  const text = $('pnlAnalysisContainer').textContent;
  [
    '① 孔经过层铺铜覆盖检查 — 缺陷规律与工程分析',
    '② 特定异型铜皮比对检查 — 缺陷规律与工程分析',
    '③ 走线参考层铺铜覆盖与单侧超宽 — 缺陷规律与工程分析',
    '④ 孤立小铜皮检查 — 缺陷规律与工程分析',
    '⑤ 铜皮最小圆弧半径检查 — 缺陷规律与工程分析'
  ].forEach(heading => {
    if (!text.includes(heading)) throw new Error('分析页缺少段落：' + heading);
  });

  let reportCaptured = null;
  let csvCaptured = null;
  w.showExportBox = function (filename, content) {
    if (filename.includes('分析报告')) reportCaptured = { filename, content };
    if (filename.includes('copper_pour')) csvCaptured = { filename, content };
  };
  w.exportAnalysisReport();
  if (!reportCaptured) throw new Error('未能导出分析报告');

  w.setCategoryFilter('via_coverage');
  if (w.State.filteredResults.some(r => r.checkCategory !== 'via_coverage')) throw new Error('分类筛选异常');
  w.setCategoryFilter('all');

  w.toggleReviewItem('via_coverage_3_1', true);
  if (!w.State.reviewedItems.has('via_coverage_3_1')) throw new Error('复核勾选未记录');
  w.toggleReviewItem('via_coverage_3_1', false);

  w.exportResultsCSV();
  if (!csvCaptured || !csvCaptured.content.includes('检查分类')) throw new Error('CSV 导出内容异常');
});

test('页面运行期零脚本错误', () => {
  if (ctx.errors.length) throw new Error(ctx.errors.join(' | '));
});

ctx.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
