/* ============================================================================
 * trace-ui.test.js —— 走线检查模块全流程 UI 回归测试（基于三栏渐进式 EDA 工作台）
 * ========================================================================== */
'use strict';

const { openPage } = require('../helpers/open-page');

const ctx = openPage('index.html');
const { dom, w, d } = ctx;

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '  -> ' + e.message); }
}
function click(id) {
  const el = d.getElementById(id);
  if (!el) throw new Error('找不到 #' + id);
  el.click();
}
function clickTab(tabKey) {
  const btn = d.querySelector('#tabs button[data-tab="' + tabKey + '"]');
  if (!btn) throw new Error('找不到 tab: ' + tabKey);
  btn.click();
}
function activeTab() {
  const s = d.querySelector('section.tab.active');
  return s ? s.id : '(none)';
}

console.log('== 走线检查模块 UI 流程与三栏 EDA 壳层测试 ==');

t('三栏 EDA 壳层结构完整（左导轨 + 中视口渐进工序条 + 右遥测与工具栏）与悬浮 Tips 可用', () => {
  if (!d.body.classList.contains('eda-workbench')) throw new Error('缺少 body.eda-workbench');
  if (!d.querySelector('aside.eda-left-rail nav#tabs')) throw new Error('工序条 nav#tabs 应位于左列导轨');
  if (!d.querySelector('aside.eda-right-dock .global-display-ctrl')) throw new Error('工作区控制区应位于右列工具栏');
  if (!d.getElementById('edaActiveStageLabel') || !d.getElementById('btnEdaNextStage')) throw new Error('缺少渐进工序状态条');
  const tipCarrier = d.querySelector('[data-tip]');
  if (!tipCarrier) throw new Error('页面缺少 data-tip 悬浮提示载体');
  w.EdaTooltip.show(tipCarrier);
  const tipBox = d.getElementById('edaFloatingTooltip');
  if (!tipBox || tipBox.style.display !== 'block') throw new Error('悬浮气泡未能弹出');
  w.EdaTooltip.hide();
});

click('btnSample');
t('导入/加载数据后直接自动应用并统计，直接切换到概览页', () => {
  if (activeTab() !== 'tab-overview') throw new Error('当前页=' + activeTab());
  if (!/文件声明 10 个 Item/.test(d.getElementById('fmtLabel').textContent)) throw new Error(d.getElementById('fmtLabel').textContent);
});
t('概览卡含 TXT 声明 Item 总数=10 与记录数10', () => {
  const s = d.getElementById('ovCards').textContent;
  if (!s.includes('10TXT 声明 Item 总数')) throw new Error(s);
  if (!s.includes('10走线记录数')) throw new Error(s);
});
t('标题栏 hdrMeta 显示声明/解析/网络数', () => {
  const s = d.getElementById('hdrMeta').textContent;
  if (!/声明 10 个 Item \/ 解析 10 条记录 \/ 8 个网络/.test(s)) throw new Error(s);
});

click('btnRunCheck');
t('运行检查后到结果页, 未检查横幅出现(403无规则)', () => {
  if (activeTab() !== 'tab-result') throw new Error(activeTab());
  if (!/未检查/.test(d.getElementById('resBanner').textContent)) throw new Error('横幅: ' + d.getElementById('resBanner').textContent);
});
t('结果卡: 8网络/通过3/不符合4/未检查1', () => {
  const s = d.getElementById('resCards').textContent;
  ['8网络总数', '3符合网络', '4不符合网络', '1未设规则网络'].forEach(x => { if (!s.includes(x)) throw new Error('缺 ' + x + ' in ' + s); });
});

click('btnQuickGen');
t('横幅一键生成 -> 规则页且3个层规则行', () => {
  if (activeTab() !== 'tab-rules') throw new Error(activeTab());
  const n = d.querySelectorAll('#ruleRows .rulegrid').length;
  if (n !== 3) throw new Error('rows=' + n);
});
const rows = [...d.querySelectorAll('#ruleRows .rulegrid')];
const r1 = rows.find(r => r.querySelector('.rN').value === '02G01P');
r1.querySelector('[data-act="fill"]').click();
t('按层数据填充按钮: 提取 02G01P 实际线宽组合 (5.6, 5.6-6) 填入, 线长方式=list', () => {
  const val = r1.querySelector('.rW').value;
  if (val !== '5.6, 5.6-6' && val !== '5.6,5.6-6') throw new Error('实际填充=' + val);
  if (r1.querySelector('.rM').value !== 'list') throw new Error(r1.querySelector('.rM').value);
});

r1.querySelector('.rW').value = '5.6';
r1.querySelector('.rM').value = 'range';
r1.querySelector('.rL').value = '1000,2500';
click('btnRunCheck');
t('重跑: 不符合网络=4, 未检查=1', () => {
  const s = d.getElementById('resCards').textContent;
  if (!s.includes('4不符合网络')) throw new Error(s);
  if (!s.includes('1未设规则网络')) throw new Error(s);
});
t('结果按出线层分表, 表头包含「线宽组合变化顺序」', () => {
  const cards = [...d.querySelectorAll('#resLayers .layer-res')];
  const titles = cards.map(c => c.querySelector('h2').textContent);
  if (!titles.some(t => t.includes('02G01P'))) throw new Error(titles.join(' | '));
  if (!titles.some(t => t.includes('02G03P'))) throw new Error(titles.join(' | '));
  const ths = [...d.querySelectorAll('#resLayers th')].map(th => th.textContent);
  if (!ths.some(txt => txt.includes('线宽组合变化顺序'))) throw new Error('缺少「线宽组合变化顺序」表头: ' + ths.join(', '));
  if (ths.some(txt => txt.includes('不符合原因'))) throw new Error('旧原因列还在');
  if (d.getElementById('netSumTbl')) throw new Error('旧汇总表还在');
});
t('02G01P 表中 106_P 整行标红, 线宽组合「5.6 → 6」标红高亮并给出原因提示', () => {
  const card = [...d.querySelectorAll('#resLayers .layer-res')].find(c => c.querySelector('h2').textContent.includes('02G01P'));
  if (card.textContent.includes('02G03P')) throw new Error('混层');
  const tr = [...card.querySelectorAll('tr')].find(x => x.textContent.includes('106_P'));
  if (!tr) throw new Error('no row');
  if (!tr.className.includes('fail')) throw new Error('not red');
  const bad = tr.querySelector('.badval');
  if (!bad || !bad.textContent.includes('5.6 → 6')) throw new Error(tr.innerHTML);
  if (!tr.querySelector('td.badcell')) throw new Error('badcell missing');
  if (!bad.getAttribute('data-tip').includes('线宽组合不符合')) throw new Error('缺少 data-tip 原因提示: ' + bad.getAttribute('data-tip'));
});

t('走线检查结果不符合行带复验勾选框，勾选后该行变灰', () => {
  const failTr = d.querySelector('#resLayers tr.fail');
  if (!failTr) throw new Error('没有不符合行');
  const chk = failTr.querySelector('.chk-trace-rev');
  if (!chk) throw new Error('缺少复验勾选框');
  if (failTr.classList.contains('reviewed')) throw new Error('初始不应为 reviewed');

  chk.checked = true;
  chk.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  if (!failTr.classList.contains('reviewed')) throw new Error('勾选后整行应增加 .reviewed 样式变灰');

  chk.checked = false;
  chk.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  if (failTr.classList.contains('reviewed')) throw new Error('取消勾选后应恢复原状');
});

t('规则行带线宽组合/总线长/指定线宽线长/弧半径各自的检查输入与勾选', () => {
  if (!r1.querySelector('.rCW') || !r1.querySelector('.rCL') || !r1.querySelector('.rCWL') || !r1.querySelector('.rCR')) throw new Error('缺检查勾选');
  if (!r1.querySelector('.rW') || !r1.querySelector('.rWL')) throw new Error('缺输入框');
  if (!r1.querySelector('.rW').getAttribute('placeholder').includes('6.9-6-3.94')) throw new Error('placeholder未更新');
});

t('检查总开关与分层检查开关联动测试', () => {
  const chkRad = d.getElementById('chkRad');
  const defRad = d.getElementById('defCheckRad');
  chkRad.checked = true;
  chkRad.dispatchEvent(new dom.window.Event('change'));
  if (!defRad.checked) throw new Error('默认规则弧半径检查应被勾选');
  const allRCR = [...d.querySelectorAll('.rCR')];
  if (allRCR.length === 0) throw new Error('应有层规则行');
  if (!allRCR.every(el => el.checked === true)) throw new Error('所有层规则弧半径检查应全部被勾选');

  chkRad.checked = false;
  chkRad.dispatchEvent(new dom.window.Event('change'));
  if (defRad.checked) throw new Error('默认规则弧半径检查应被取消');
  if (!allRCR.every(el => el.checked === false)) throw new Error('所有层规则弧半径检查应全部被取消');

  const chkW = d.getElementById('chkWidth');
  const defW = d.getElementById('defCheckWidth');
  chkW.checked = false;
  chkW.dispatchEvent(new dom.window.Event('change'));
  if (defW.checked) throw new Error('defW checked');
  const allRCW = [...d.querySelectorAll('.rCW')];
  if (!allRCW.every(el => el.checked === false)) throw new Error('所有层规则线宽检查应全部被取消');

  chkW.checked = true;
  chkW.dispatchEvent(new dom.window.Event('change'));
  if (!allRCW.every(el => el.checked === true)) throw new Error('所有层规则线宽检查应全部被勾选');

  allRCR[0].checked = true;
  allRCR[0].dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  if (!chkRad.checked) throw new Error('部分勾选时总开关应为 checked');
  if (!chkRad.indeterminate) throw new Error('部分勾选时总开关应为 indeterminate 半选');
});

click('btnExpAll');
t('导出全部 CSV 弹出可见窗口且含表头「线宽组合顺序」和 105_P', () => {
  const mask = d.getElementById('expMask');
  if (!mask || mask.style.display === 'none') throw new Error('导出窗口没出现');
  const text = d.getElementById('expText').value;
  if (!text.includes('线宽组合顺序') || !text.includes('105_P')) throw new Error(text.slice(0, 180));
  if (!d.getElementById('expLink').getAttribute('download')) throw new Error('缺下载链接');
});

click('btnSaveRules');
t('保存规则到本地：弹出窗口且 JSON 含 02G01P', () => {
  const mask = d.getElementById('expMask');
  if (!mask || mask.style.display === 'none') throw new Error('保存窗口没出现');
  const text = d.getElementById('expText').value;
  const data = JSON.parse(text);
  if (data.kind !== 'pcb-trace-rules') throw new Error(data.kind);
  if (!data.rules.some(r => r.layer === '02G01P' && r.widthsText === '5.6')) throw new Error(JSON.stringify(data.rules));
  if (!d.getElementById('expLink').getAttribute('download').endsWith('.json')) throw new Error('不是 json');
});
const saved = JSON.parse(d.getElementById('expText').value);
saved.rules = [{ layer: 'L9', widthsText: '6.9-6-3.94, 6.9-5.7-6.9', lenMode: 'off', lenText: '', enabled: true, checkWidth: true, checkLen: false, checkRad: false, radMode: 'off', radText: '' }];
const file = new dom.window.File([JSON.stringify(saved)], '走线检查规则.json', { type: 'application/json' });
const input = d.getElementById('ruleFile');
input.onchange({ target: { files: [file], value: '' } });

click('btnDiffRun');
t('差分分析: 3对, 301 超差, 逐层 2/4, 包含所有层总线长差检查', () => {
  const cards = d.getElementById('diffCards').textContent;
  if (!cards.includes('3差分对数')) throw new Error(cards);
  if (!cards.includes('1超差对数')) throw new Error(cards);
  if (!cards.includes('总长超差对数')) throw new Error('缺总长超差对数卡片');
  const tbl = d.getElementById('diffTbl').textContent;
  if (!tbl.includes('301')) throw new Error('no 301');
  if (!tbl.includes('总线长差 (所有层合计)')) throw new Error('缺总线长差合计行');
  const totalRows = d.querySelectorAll('#diffTbl tr.totalrow');
  if (totalRows.length !== 3) throw new Error('总长行数应为 3，实际：' + totalRows.length);
  const failTotal = d.querySelector('#diffTbl tr.totalrow.fail');
  if (!failTotal) throw new Error('301 总长超差未标红');
  if (!failTotal.textContent.includes('总长超差')) throw new Error('总长判定文本不对');
});

t('差分分析报错结果前带复验勾选框，勾选后该行变灰', () => {
  const diffFailRow = d.querySelector('#diffTbl tr.fail');
  if (!diffFailRow) throw new Error('缺少差分超差行');
  const chk = diffFailRow.querySelector('.chk-diff-rev');
  if (!chk) throw new Error('缺少差分复验勾选框');
  if (diffFailRow.classList.contains('reviewed')) throw new Error('初始不应为 reviewed');

  chk.checked = true;
  chk.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  if (!diffFailRow.classList.contains('reviewed')) throw new Error('勾选后超差行应增加 .reviewed 变灰');

  click('btnDiffRun');
  const reRow = d.querySelector('#diffTbl tr.reviewed');
  if (!reRow) throw new Error('重新运行或筛选后复验状态应保留');

  click('btnClearDiffRev');
  if (d.querySelectorAll('#diffTbl tr.reviewed').length !== 0) throw new Error('清空复验标记后不应有 reviewed 行');
});

t('差分分析独立开关与允许值联动测试', () => {
  d.getElementById('inpDiffTol').value = '5.0';
  d.getElementById('inpTotalDiffTol').value = '1.0';
  click('btnDiffRun');
  const failLayers = d.querySelectorAll('#diffTbl tr.pairhead.fail, #diffTbl tr.fail:not(.totalrow)');
  if (failLayers.length !== 0) throw new Error('逐层应全部通过：' + failLayers.length);
  const totalFail = d.querySelectorAll('#diffTbl tr.totalrow.fail');
  if (totalFail.length !== 1) throw new Error('总长应有1对超差：' + totalFail.length);

  click('btnExpDiff');
  const mask = d.getElementById('expMask');
  if (!mask || mask.style.display === 'none') throw new Error('差分导出窗口未弹出');
  const csvText = d.getElementById('expText').value;
  if (!csvText.includes('总线长差(所有层合计)')) throw new Error('差分 CSV 缺少总线长差行');
  if (!csvText.includes('301')) throw new Error('差分 CSV 缺少 301 网络');
  d.getElementById('expMask').style.display = 'none';

  d.getElementById('inpDiffTol').value = '1';
  d.getElementById('inpTotalDiffTol').value = '1';
  click('btnDiffRun');
});

t('第④页「输出检查汇总报告」：导出包含第④和⑤页汇总「问题网络 (网络名+所在层)、问题原因、如何修改」', () => {
  clickTab('result');
  click('btnExpReport');
  const mask = d.getElementById('expMask');
  if (!mask || mask.style.display === 'none') throw new Error('走线检查报告导出窗口未弹出');
  const title = d.getElementById('expTitle').textContent;
  if (!title.includes('PCB走线检查汇总报告_问题网络与修改建议.xlsx')) throw new Error('报告文件名错误: ' + title);
  const link = d.getElementById('expLink');
  if (!link || !link.href) throw new Error('缺少 Excel 下载链接');
  const text = d.getElementById('expText').value;
  if (!text.includes('问题网络 (网络名+所在层)') || !text.includes('问题原因') || !text.includes('如何修改')) {
    throw new Error('报告缺少核心列: ' + text.slice(0, 100));
  }
  if (!text.includes('106_P (02G01P)') || !text.includes('301_P / 301_N')) {
    throw new Error('汇总报告应同时包含走线 106_P 与差分 301_P/301_N');
  }
  d.getElementById('expMask').style.display = 'none';
});

t('第⑤页「输出检查汇总报告」：点击同样导出④+⑤完整汇总报告', () => {
  clickTab('diff');
  click('btnExpDiffReport');
  const mask = d.getElementById('expMask');
  if (!mask || mask.style.display === 'none') throw new Error('差分检查报告导出窗口未弹出');
  const title = d.getElementById('expTitle').textContent;
  if (!title.includes('PCB走线检查汇总报告_问题网络与修改建议.xlsx')) throw new Error('报告文件名错误: ' + title);
  const text = d.getElementById('expText').value;
  if (!text.includes('301_P / 301_N') || !text.includes('106_P (02G01P)')) {
    throw new Error('差分页触发的汇总报告应包含完整走线与差分问题');
  }
  d.getElementById('expMask').style.display = 'none';
});

setTimeout(() => {
  t('从本地文件读取：载入后层规则被替换且包含组合「6.9-6-3.94, 6.9-5.7-6.9」', () => {
    const layers = [...d.querySelectorAll('#ruleRows .rN')].map(el => el.value);
    if (layers.join(',') !== 'L9') throw new Error('layers=' + layers.join(',') + ' label=' + d.getElementById('ruleFileLabel').textContent);
    const row = d.querySelector('#ruleRows .rulegrid');
    if (!row || row.querySelector('.rW').value !== '6.9-6-3.94, 6.9-5.7-6.9') throw new Error(row ? row.querySelector('.rW').value : 'no row');
    if (!d.getElementById('ruleFileLabel').textContent.includes('走线检查规则.json')) throw new Error(d.getElementById('ruleFileLabel').textContent);
  });
  t('页面运行期零脚本错误', () => {
    if (ctx.errors.length) throw new Error(ctx.errors.join(' | '));
  });
  ctx.close();
  console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
  process.exit(failed ? 1 : 0);
}, 80);
