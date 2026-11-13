/* ============================================================================
 * dfm-ui.test.js —— 加工能力检查模块全流程 UI 回归测试（基于三栏渐进式 EDA 工作台）
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
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (err) {
    console.error(`  FAIL  ${name} -> ${err.message}`);
    fail++;
  }
}

console.log('== DFM 加工能力检查：三栏 EDA 壳层与全流程测试 ==');

test('三栏 EDA 壳层完整、悬浮 Tips 正常、静态标题/标签无括号解释', () => {
  if (!d.body.classList.contains('eda-workbench')) throw new Error('缺少 body.eda-workbench');
  if (!d.querySelector('aside.eda-left-rail nav#tabs')) throw new Error('工序条不在左列导轨');
  if (!d.querySelector('aside.eda-right-dock .global-display-ctrl')) throw new Error('显示控制区不在右工具栏');
  const tabs = d.querySelectorAll('nav#tabs button');
  if (tabs.length !== 5) throw new Error('页签数量应为 5，实际 ' + tabs.length);
  [...d.querySelectorAll('h1, h2, nav#tabs button, .form-item label')].forEach(el => {
    if (/[（(].+[)）]/.test(el.textContent)) {
      throw new Error('静态文案仍含括号解释：' + el.textContent.trim());
    }
  });
  const tipCarrier = d.querySelector('[data-tip]');
  w.EdaTooltip.show(tipCarrier);
  if ($('edaFloatingTooltip').style.display !== 'block') throw new Error('悬浮气泡未显示');
  w.EdaTooltip.hide();
});

test('加载 97 项坐标样本并验证双阈值计算（5.94 / 9.94 焊盘下 23 处超标）', () => {
  const sampleTxt = fs.readFileSync(path.join(CHECKER_DIR, 'sample/via_trace_airgap_sample.txt'), 'utf8');
  $('inpGndPadDiam').value = '5.94';
  $('inpSignalPadDiam').value = '9.94';
  $('inpThresholdGnd').value = '6.0';
  $('inpThresholdSignal').value = '6.0';
  w.loadTextData(sampleTxt, 'via_trace_airgap_sample.txt');
  w.runCheck(true);

  const badNum = parseInt($('statBadCount').textContent, 10);
  if (badNum !== 23) throw new Error('超标数应为 23，实际 ' + badNum);
  if (!$('statGndBadCount').textContent.includes('23')) throw new Error('GND 孔统计不匹配');
  const minVal = parseFloat($('statMinDist').textContent);
  if (Math.abs(minVal - 5.02) > 0.05) throw new Error('最小实测间距应约为 5.02 mil，实际 ' + minVal);
});

test('独立修改信号孔与 GND 孔阈值并验证筛选、一钻更新、标尺测量与复核', () => {
  $('inpThresholdGnd').value = '5.0';
  $('inpThresholdSignal').value = '8.0';
  $('btnRunCheck').click();
  if (parseInt($('statBadCount').textContent, 10) !== 9) throw new Error('收紧信号阈值后超标数应为 9');

  $('btnFilterGnd').click();
  if (w.State.activeFilter !== 'gnd') throw new Error('GND 筛选未生效');
  $('btnFilterBad').click();

  $('inpGndFirstDrill').value = '5.94';
  $('btnRunCheck').click();
  if (Math.abs(w.State.vias[0].firstDrill - 5.94) > 1e-4) throw new Error('一钻直径未更新');
  $('inpGndFirstDrill').value = '5.54';

  $('btnMeasureMode').click();
  if (!w.State.measureMode || !$('pcbCanvas').classList.contains('measuring')) throw new Error('测量模式未激活');
  w.State.measureSelection = [{ type: 'via', item: w.State.vias[0] }, { type: 'via', item: w.State.vias[1] }];
  w.updateMeasurements();
  if ($('measureCard').style.display !== 'block' || !$('measureCardBody').textContent.includes('孔中心到中心距')) {
    throw new Error('孔到孔测量卡片异常');
  }
  $('btnMeasureMode').click();

  $('inpThresholdGnd').value = '6.0';
  $('inpThresholdSignal').value = '6.0';
  $('btnRunCheck').click();

  const firstCk = d.querySelector('#resTableBody .ck-rev');
  if (firstCk) {
    firstCk.click();
    if (!d.querySelector('#resTableBody tr').classList.contains('reviewed')) throw new Error('复核勾选后未置灰');
  }
});

test('出线层×网络聚合视图展开、XSS 防护与不可解析层名保守告警', () => {
  $('btnViewNetGroup').click();
  const toggleBtn = d.querySelector('.btn-toggle-net-defects');
  if (!toggleBtn) throw new Error('缺少展开明细按钮');
  toggleBtn.click();
  if (!d.querySelector('.net-defects-table')) throw new Error('子表未展开');
  $('btnViewPairList').click();

  const evil = '<img src=x onerror="window.__pwn=1">';
  const txt = `Total 2 Items\n\nItem 1 < Via >\n  Origin-xy: [100, 100]\n  Net: ${evil}\n  Padstack Name: P\n  Padstack Defined from <L2> to <L5>\n  Circle Drill: 3.94\n~~~~~~~~~~~~\nItem 2 < Trace >\n  Subset: SIGA\n  Net: SIG${evil}\n  Type: Seg\n  Seg Length: 100\n  Seg: xy [100, 103] xy [200, 103] Width (6.0)\n`;
  w.loadTextData(txt, 'evil.txt');
  w.runCheck(true);
  if (d.querySelectorAll('img[src="x"]').length) throw new Error('检测到未转义 HTML 注入');
  if (!/层名无法解析/.test($('runHint').textContent)) throw new Error('缺少未知层名保守检查提示：' + $('runHint').textContent);
});

test('规律分析：按信号孔/按走线切换、维度分布、排序 TopN、明细联动与 CSV 生成', () => {
  const sampleTxt = fs.readFileSync(path.join(CHECKER_DIR, 'sample/via_trace_airgap_sample.txt'), 'utf8');
  $('inpGndPadDiam').value = '7.906';
  $('inpSignalPadDiam').value = '9.94';
  $('inpThresholdGnd').value = '6.0';
  $('inpThresholdSignal').value = '6.0';
  w.loadTextData(sampleTxt, 'via_trace_airgap_sample.txt');
  w.runCheck(true);
  d.querySelector('nav#tabs button[data-tab="analysis"]').click();

  if (w.PatternState.last.objectCount !== 11) throw new Error('问题过孔对象数应为 11');
  if (w.PatternState.last.objects[0].failCount !== 9) throw new Error('首行过孔应有 9 处缺陷');

  $('btnPatObjTrace').click();
  if (w.PatternState.last.objectCount !== 36 || w.PatternState.last.kpis.defectCount !== 42) {
    throw new Error('按走线归纳统计不匹配');
  }

  $('btnPatObjVia').click();
  const csv = w.buildPatternCsv(w.PatternState.last);
  if (!csv.includes('对象维度') || !csv.includes('维度分布') || !csv.includes('亏欠量分档')) {
    throw new Error('规律分析 CSV 段落不完整');
  }

  const firstId = w.PatternState.last.objects[0].id;
  d.querySelector('#tblPatObjectsBody tr button').click();
  if ($('inpSearch').value !== 'Via ' + firstId) throw new Error('未联动跳转并填充搜索框');
  $('inpSearch').value = '';
  $('inpSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
});

test('GND 孔盘到信号孔盘间距、分层规则覆盖与规则 JSON 快照读写', () => {
  const sampleTxt = fs.readFileSync(path.join(CHECKER_DIR, 'sample/via_trace_airgap_sample.txt'), 'utf8');
  $('inpGndPadDiam').value = '7.906';
  $('inpSignalPadDiam').value = '12.0';
  $('inpGndFirstDrill').value = '6.0';
  $('inpSignalFirstDrill').value = '6.0';
  $('inpThresholdPadPair').value = '10';
  w.loadTextData(sampleTxt, 'via_trace_airgap_sample.txt');
  w.runCheck(true);
  if (w.State.checkResult.padPairStats.fail !== 8) throw new Error('阈值 10 mil 时应有 8 对孔盘不满足');

  $('inpThresholdPadPair').value = '0';
  w.runCheck(true);
  if ($('statPadPairBadCount').textContent !== '未启用') throw new Error('填 0 时应显示未启用');

  $('btnLayerRuleTemplate').click();
  const rows = [...$('layerRuleBody').querySelectorAll('tr[data-row]')];
  if (rows.length !== 2) throw new Error('模板应生成 2 条分层规则');
  rows[1].querySelector('.lrGnd').value = '2';
  rows[1].querySelector('.lrSig').value = '2';
  w.runCheck(true);
  if (w.State.checkResult.failCount !== 0) throw new Error('内层放宽至 2 mil 后应为 0 超标');

  w.DfmRuleConfig.loadFromObject({
    kind: 'pcb-dfm-rule-config',
    version: 1,
    fields: { selMode: 'pad_to_trace', inpGndPadDiam: '7.906', selPadShape: 'circle', inpThresholdPadPair: '6.25' },
    layerRules: [{ layers: 'Top、Bot', gnd: 4.5, sig: 5.5, pad: 6.5 }]
  });
  if ($('inpThresholdPadPair').value !== '6.25' || $('layerRuleBody').querySelectorAll('tr[data-row]').length !== 1) {
    throw new Error('JSON 规则快照恢复失败');
  }
});

test('页面运行期零脚本错误', () => {
  if (ctx.errors.length) throw new Error(ctx.errors.join(' | '));
});

ctx.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
