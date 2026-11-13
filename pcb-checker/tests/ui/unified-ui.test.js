/* ============================================================================
 * unified-ui.test.js —— 综合一体化检查全流程 UI 回归测试（三栏渐进式 EDA 工作台）
 * ========================================================================== */
'use strict';

const { openPage, tick } = require('../helpers/open-page');

const ctx = openPage('unified.html', { syncCheck: true });
const { w, d } = ctx;
const $ = id => d.getElementById(id);

let pass = 0, fail = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (err) {
    console.error(`  FAIL  ${name} -> ${err.message}`);
    fail++;
  }
}

(async () => {
  await tick(150);
  w.alert = () => {};
  console.log('== 综合一体化检查：三栏壳层、六工序、五引擎联检与缺陷清单测试 ==');

  await test('三栏壳层完整，导航在左、工具与遥测在右，静态标题无括号解释', () => {
    if (!d.title.includes('综合一体化')) throw new Error('标题异常：' + d.title);
    if (!d.body.classList.contains('eda-workbench')) throw new Error('缺少 body.eda-workbench');
    if (!d.querySelector('aside.eda-left-rail nav#tabs')) throw new Error('工序条不在左列导轨');
    if (!d.querySelector('aside.eda-left-rail .navlinks a.active[href="unified.html"]')) throw new Error('模块导航未高亮当前页');
    if (!d.querySelector('aside.eda-right-dock #kpiDefectCount')) throw new Error('遥测不在右工具栏');
    if (!d.querySelector('aside.eda-right-dock .global-display-ctrl')) throw new Error('显示控制区不在右工具栏');
    if (d.querySelector('header .navlinks') && !d.querySelector('aside.eda-left-rail header .navlinks, aside.eda-left-rail .navlinks')) {
      throw new Error('顶栏残留横向导航');
    }
    [...d.querySelectorAll('h1, h2, h3, h4, .card-title, nav#tabs button, th')].forEach(el => {
      if (el.id) return;
      if (/[（(].+[)）]/.test(el.textContent)) throw new Error('静态文案仍含括号解释：' + el.textContent.trim());
    });
    const tipCarrier = d.querySelector('[data-tip]');
    w.EdaTooltip.show(tipCarrier);
    if ($('edaFloatingTooltip').style.display !== 'block') throw new Error('悬浮气泡未显示');
    w.EdaTooltip.hide();
  });

  await test('六个工序页签互相切换，规则配置独立成工序且含五个引擎手风琴', () => {
    const tabs = [...d.querySelectorAll('nav#tabs button[data-tab]')];
    if (tabs.length !== 6) throw new Error('页签数量应为 6，实际 ' + tabs.length);
    for (const b of tabs) {
      b.click();
      const pane = $(b.dataset.tab);
      if (!pane || !pane.classList.contains('active')) throw new Error('未激活面板 ' + b.dataset.tab);
      if (d.querySelectorAll('.tab-pane.active').length !== 1) throw new Error('同时激活多个面板');
      if (!b.classList.contains('active')) throw new Error('页签按钮未高亮 ' + b.dataset.tab);
    }
    tabs[0].click();
    if ($('edaActiveStageLabel').textContent.trim() !== '① 数据导入') throw new Error('面包屑未同步：' + $('edaActiveStageLabel').textContent);
    if (d.querySelectorAll('#tabRules .rule-acc').length !== 5) throw new Error('规则配置应含 5 个引擎手风琴');
    if (d.querySelectorAll('#tabData .data-cat-box').length !== 4) throw new Error('数据导入应含 4 个数据框');
  });

  await test('无数据时运行检查被拦截，不产生缺陷', () => {
    let alerted = 0;
    w.alert = () => { alerted++; };
    w.clearUnifiedData();
    w.runMasterInspection();
    if (!alerted) throw new Error('未提示导入数据');
    if (w.State.allChecks.length) throw new Error('无数据却产生了检查项');
    w.alert = () => {};
  });

  await test('载入示例并联检：五类引擎全部出结果，数量与基线一致', () => {
    w.loadUnifiedSampleData();
    w.runMasterInspection();
    const S = w.State;
    const byCat = {};
    S.allChecks.forEach(c => { byCat[c.category] = (byCat[c.category] || 0) + 1; });
    const want = { trace: 16, copper: 45, dfm: 11, fanout: 1, pour: 15 };
    for (const k of Object.keys(want)) {
      if (byCat[k] !== want[k]) throw new Error(`${k} 检查项应为 ${want[k]}，实际 ${byCat[k]}`);
    }
    const fails = S.allChecks.filter(c => !c.pass).length;
    if (fails !== 69) throw new Error('不符合项应为 69，实际 ' + fails);
    if ($('kpiTotalChecks').textContent !== '88') throw new Error('遥测总检查项异常：' + $('kpiTotalChecks').textContent);
    if ($('kpiDefectCount').textContent !== '69') throw new Error('遥测缺陷数异常：' + $('kpiDefectCount').textContent);
    ['trace', 'copper', 'dfm', 'fanout', 'pour'].forEach(k => {
      if (!S.results[k] || !S.results[k].hasData) throw new Error('引擎无数据：' + k);
    });
  });

  await test('引擎调度已按阶段拆分，且各阶段函数可独立调用', () => {
    ['buildInspectionContext', 'runTraceEngine', 'runCopperEngine', 'runDfmEngine', 'runFanoutEngine', 'runPourEngine']
      .forEach(fn => { if (typeof w[fn] !== 'function') throw new Error('缺少 ' + fn); });
    const c = w.buildInspectionContext();
    if (!c || !c.tTrace) throw new Error('上下文构建失败');
    const n = w.runTraceEngine(c).length;
    if (n !== 16) throw new Error('走线阶段应产出 16 项，实际 ' + n);
  });

  await test('缺陷清单：筛选、复核与 XSS 转义', () => {
    w.switchTab('tabDefects');
    const rows = d.querySelectorAll('#tabDefects tbody tr').length;
    if (rows < 1) throw new Error('缺陷清单为空');
    w.State.allChecks.push({
      id: 'xss_1', category: 'trace', categoryName: '走线检查', target: '<img src=x onerror=alert(1)>',
      targetType: '走线网络', layer: '<b>L1</b>', item: '出线层线宽组合顺序', actual: '1', rule: '2',
      pass: false, deviation: '组合不符', reason: '<script>alert(1)</script>', objId: 'x'
    });
    w.renderMasterDefectsTable();
    if (d.querySelector('#tabDefects tbody img')) throw new Error('目标名未转义，注入了 img 节点');
    if (d.querySelector('#tabDefects tbody script')) throw new Error('原因未转义，注入了 script 节点');
    w.State.allChecks.pop();
    w.filterDefects('trace');
    w.renderMasterDefectsTable();
    w.toggleReview(w.State.allChecks.find(c => !c.pass).id, true);
    w.batchReviewAll();
    w.clearAllReviews();
  });

  await test('仪表盘、2D 视口与规律分析工序可渲染且无异常', () => {
    w.switchTab('tabDashboard');
    if (!$('tabDashboard').classList.contains('active')) throw new Error('仪表盘未激活');
    w.switchTab('tabCanvas');
    w.switchTab('tabAnalysis');
    if (!d.querySelector('#tabAnalysis tbody tr')) throw new Error('规律分析表无内容');
  });

  await test('规则配置：扇出方案库与分层 DFM 规则可增删', () => {
    const n0 = w.State.rules.fanoutSchemes.length;
    if (n0 < 1) throw new Error('默认扇出方案库为空');
    w.State.rules.fanoutSchemes.push({ name: '临时', tag: 't', vias: [] });
    const n1 = w.State.rules.fanoutSchemes.length;
    if (n1 !== n0 + 1) throw new Error('方案新增失败');
    w.State.rules.fanoutSchemes.pop();
    const rows0 = w.eval('UnifiedDfmLayerRules.rows.length');
    w.eval('UnifiedDfmLayerRules.add()');
    const rows1 = w.eval('UnifiedDfmLayerRules.rows.length');
    if (rows1 !== rows0 + 1) throw new Error('分层规则新增失败');
  });

  await test('页面运行期零脚本错误', () => {
    if (ctx.errors.length) throw new Error(ctx.errors.join(' | '));
  });

  ctx.close();
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) process.exit(1);
})();
