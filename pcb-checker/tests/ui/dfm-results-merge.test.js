/* ============================================================================
 * dfm-results-merge.test.js —— DFM 结果明细：孔到孔并入统一明细表、未复核筛选、
 * 总复核、大样本保护、定位往返与画布过孔绘制（旧主线 pcb-checker.7z 新增功能）
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
const rowsOf = sel => [...d.querySelectorAll('#resTableBody ' + sel)];
function setFilter(id) { $(id).click(); }
function fixedRun(padPairThreshold) {
  $('inpGndPadDiam').value = '7.906'; $('inpSignalPadDiam').value = '12.0';
  $('inpGndFirstDrill').value = '6.0'; $('inpSignalFirstDrill').value = '6.0';
  $('inpThresholdGnd').value = '20'; $('inpThresholdSignal').value = '20';   // 调高线到孔阈值以产生线到孔超标
  $('inpThresholdPadPair').value = String(padPairThreshold);
  $('inpSearch').value = ''; w.State.searchQuery = '';
  w.State.reviewedKeys = {}; w.State.pageSize = 50; w.State.currentPage = 1;
  w.eval(`loadTextData(${JSON.stringify(sample)}, 'merge.txt'); runCheck(true);`);
}

console.log('== DFM 结果明细：孔到孔并入统一表与复核流程 ==');

test('统一明细表 9 列，分页条在表格之前，旧独立孔盘卡片与 13 列表头已移除', () => {
  const heads = [...d.querySelectorAll('#resTable thead th')];
  assert(heads.length === 9, '表头应为 9 列，实际 ' + heads.length);
  assert(!$('padPairCard') && !$('padPairBody'), '独立孔盘对卡片应移除');
  const pager = $('paginationBar'), table = $('resTable');
  assert(pager.compareDocumentPosition(table) & w.Node.DOCUMENT_POSITION_FOLLOWING, '分页条应位于明细表之前');
  assert($('ckReviewVisible'), '缺少总复核复选框');
  [...d.querySelectorAll('#resTable th')].forEach(th => {
    assert(!/[（(].+[)）]/.test(th.textContent), '表头不应带括号解释：' + th.textContent.trim());
  });
});

test('孔到孔行序号接在线到孔记录之后并连续，不重复累加', () => {
  fixedRun(10);
  w.State.activeFilter = 'bad'; w.renderResults();
  const padRows = rowsOf('tr.pad-pair-row');
  assert(padRows.length === 8, '孔到孔行应为 8，实际 ' + padRows.length);
  const totalBad = w.State.checkResult.pairs.filter(p => p.status === '不满足').length;
  assert(totalBad > 50, '前置条件：线到孔超标应多于一页 50 条，实际 ' + totalBad);
  assert(rowsOf('tr[data-via]').length === 50, '线到孔每页应为 50 条');
  const nums = padRows.map(r => Number(r.cells[0].textContent));
  assert(nums[0] === totalBad + 1, `首个孔到孔序号应接在全部 ${totalBad} 条线到孔之后，实际 ${nums[0]}`);
  nums.forEach((n, i) => assert(n === nums[0] + i, '序号应连续：' + nums.join(',')));
});

test('孔到孔行内容：GND 孔 / 信号孔 / 孔盘间距 / 阈值 / 亏欠 / 定位孔对', () => {
  const row = rowsOf('tr.pad-pair-row')[0];
  const t = row.textContent;
  ['孔到孔', 'GND 孔盘', 'Airgap', '中心距', '≥ 10.00 mil'].forEach(k => assert(t.includes(k), '缺少 ' + k + '：' + t));
  assert(row.querySelector('.btn-locate-padpair'), '缺少定位孔对按钮');
  assert(row.querySelector('.ck-rev').dataset.key.startsWith('padpair_'), '孔对复核键应以 padpair_ 开头');
});

test('筛选：只看满足时孔到孔行为空；GND / 信号筛选下孔到孔行保留', () => {
  setFilter('btnFilterOk');
  assert(rowsOf('tr.pad-pair-row').length === 0, '只看满足不应出现孔到孔超标行');
  setFilter('btnFilterGnd');
  assert(rowsOf('tr.pad-pair-row').length === 8, 'GND 筛选应保留孔到孔行');
  setFilter('btnFilterSig');
  assert(rowsOf('tr.pad-pair-row').length === 8, '信号筛选应保留孔到孔行');
  setFilter('btnFilterBad');
});

test('搜索：可按孔到孔配对的信号孔号、孔盘到孔盘关键字检索', () => {
  const sig = w.State.checkResult.padPairDefects[0].sigVia.id;
  $('inpSearch').value = '孔盘到孔盘';
  $('inpSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert(rowsOf('tr.pad-pair-row').length === 8, '关键字应命中全部 8 条孔到孔');
  assert(rowsOf('tr[data-via]').length === 0, '线到孔行不含该关键字');
  $('inpSearch').value = 'via ' + sig;
  $('inpSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert(rowsOf('tr.pad-pair-row').some(r => r.textContent.includes('Via ' + sig)), '按孔号应命中');
  $('inpSearch').value = '';
  $('inpSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
});

test('未复核不满足：复核后该行消失，线到孔与孔到孔都生效', () => {
  assert($('btnFilterBadUnreviewed'), '缺少「未复核不满足」按钮');
  w.State.pageSize = 'all'; $('selPageSize').value = 'all';   // 一页显示全部，复核后行数才会直接减少
  setFilter('btnFilterBadUnreviewed');
  assert(w.State.activeFilter === 'bad_unreviewed', '筛选状态应为 bad_unreviewed');
  const beforePairs = rowsOf('tr[data-via]').length, beforePad = rowsOf('tr.pad-pair-row').length;
  assert(beforePairs > 0 && beforePad === 8, `前置条件：线到孔 ${beforePairs}，孔到孔 ${beforePad}`);
  rowsOf('tr[data-via] .ck-rev')[0].click();
  assert(rowsOf('tr[data-via]').length === beforePairs - 1, '复核一条线到孔后应少一行');
  rowsOf('tr.pad-pair-row .ck-rev')[0].click();
  assert(rowsOf('tr.pad-pair-row').length === beforePad - 1, '复核一条孔到孔后应少一行');
  setFilter('btnFilterBad');
  const rev = rowsOf('tr.reviewed');
  assert(rev.length === 2 && rev.every(r => r.querySelector('.hint') && /已复核/.test(r.textContent)), '全部不满足视图应保留并标注已复核行');
});

test('总复核：只作用于当前过滤与当前页渲染出的行，并反映半选状态', () => {
  const all = $('ckReviewVisible');
  assert(all.indeterminate === true, '部分复核时应为半选');
  all.checked = true; all.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert(rowsOf('.ck-rev').every(ck => ck.checked), '总复核后当前显示行应全部已复核');
  setFilter('btnFilterBadUnreviewed');
  assert(rowsOf('tr[data-via], tr.pad-pair-row').length === 0, '全部复核后「未复核不满足」应为空');
  assert(/未找到/.test($('resTableBody').textContent), '空结果应给出提示行');
  assert($('ckReviewVisible').disabled, '没有可见行时总复核应禁用');
  setFilter('btnFilterBad');
  $('ckReviewVisible').checked = false; $('ckReviewVisible').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert(rowsOf('.ck-rev').every(ck => !ck.checked), '取消总复核应清除当前显示行');
});

test('视图一按网络聚合：未复核筛选只保留仍有未复核缺陷的网络', () => {
  w.State.reviewedKeys = {};
  w.State.activeFilter = 'bad'; w.renderNetGroupView();
  const bad = d.querySelectorAll('#netGroupTableBody tr.fail-row').length;
  w.State.activeFilter = 'bad_unreviewed'; w.renderNetGroupView();
  assert(d.querySelectorAll('#netGroupTableBody tr.fail-row').length === bad, '尚无复核时与只看不满足一致');
  w.State.checkResult.netLayerAnalysis.filter(i => i.failCount > 0).forEach(i => i.defects.forEach(p => { w.State.reviewedKeys[p.via.id + '_' + p.trace.id] = true; }));
  w.renderNetGroupView();
  assert(d.querySelectorAll('#netGroupTableBody tr.fail-row').length === 0, '全部复核后不应再有网络');
  w.State.reviewedKeys = {}; w.State.activeFilter = 'bad';
});

test('大样本保护：孔盘对超过 1000 条时「全部显示」退回每页 200 条', () => {
  const base = w.State.checkResult;
  const mk = i => ({ gndVia: { id: 10000 + i, net: 'GND', padstack: 'G' }, sigVia: { id: 20000 + i, net: 'S' + i, padstack: 'S' },
    padAirgap: 1, threshold: 6, diff: -5, centerDist: 9, gndPadDiameter: 8, sigPadDiameter: 12 });
  w.State.checkResult = Object.assign({}, base, { padPairDefects: Array.from({ length: 1201 }, (_, i) => mk(i)) });
  w.State.pageSize = 'all'; w.State.currentPage = 1;
  w.renderPairListView();
  assert(w.State.pageSize === '200' && $('selPageSize').value === '200', '应退回 200，实际 ' + w.State.pageSize);
  assert(rowsOf('tr.pad-pair-row').length === 200, '首页孔到孔行应为 200，实际 ' + rowsOf('tr.pad-pair-row').length);
  assert(/第 1 \/ 7 页/.test($('pageCurrent').textContent), '页数应按 1201 / 200 = 7：' + $('pageCurrent').textContent);
  assert(/共 1,201 条/.test($('pageInfo').textContent), '统计应含孔盘对总数：' + $('pageInfo').textContent);
  w.State.checkResult = Object.assign({}, base, { padPairDefects: Array.from({ length: 900 }, (_, i) => mk(i)) });
  w.State.pageSize = 'all'; w.renderPairListView();
  assert(w.State.pageSize === 'all' && rowsOf('tr.pad-pair-row').length === 900, '900 条以内允许全部显示');
  w.State.checkResult = base; w.State.pageSize = 50; $('selPageSize').value = '50'; w.renderPairListView();
});

test('点击定位孔对：记录所在行、切到视口页、高亮孔对，返回按钮可见', () => {
  fixedRun(10);
  w.State.activeFilter = 'bad'; w.renderResults();
  const btn = rowsOf('tr.pad-pair-row .btn-locate-padpair')[0];
  const gid = Number(btn.dataset.gndVia), sid = Number(btn.dataset.sigVia);
  btn.click();
  assert(w.State.resultReturnPosition && w.State.resultReturnPosition.rowId, '未记录所在行');
  assert(d.getElementById(w.State.resultReturnPosition.rowId), '记录的行 id 应存在于文档');
  assert(w.State.activeLocatedViaPair && w.State.activeLocatedViaPair.gndViaId === gid && w.State.activeLocatedViaPair.sigViaId === sid, '孔对高亮状态不对');
  assert($('tab-canvas').classList.contains('active'), '应切到空间视口页签');
  assert($('btnReturnDfmResults').style.display !== 'none', '返回按钮应可见');
  const vp = w.State.viewport;
  const g = w.State.vias.find(v => v.id === gid), s = w.State.vias.find(v => v.id === sid);
  assert(vp.zoom >= 2 && vp.zoom <= 10, '缩放应在 2~10：' + vp.zoom);
  const canvas = $('pcbCanvas');
  const midScreenX = ((g.origin[0] + s.origin[0]) / 2) * vp.zoom + vp.panX;
  assert(Math.abs(midScreenX - canvas.width / 2) < 1e-6, '两孔中点应居中');
});

test('返回检查结果明细：切回结果页签；线到孔定位会清除孔对高亮', () => {
  $('btnReturnDfmResults').click();
  assert($('tab-result').classList.contains('active'), '应切回结果页签');
  const loc = rowsOf('tr[data-via] .btn-locate')[0];
  loc.click();
  assert(w.State.activeLocatedViaPair === null, '线到孔定位应清除孔对高亮');
  assert(w.State.resultReturnPosition.rowId, '线到孔定位同样记录位置');
  $('btnReturnDfmResults').click();
  assert($('tab-result').classList.contains('active'), '再次返回应切回结果页签');
});

test('视口复核卡的返回按钮走位置恢复入口', () => {
  const via = w.State.checkResult.defectPairs[0];
  w.renderDfmSpatialReviewCard ? w.renderDfmSpatialReviewCard(via.via.id, via.trace.id) : w.locateInCanvas(via.via.id, via.trace.id);
  const btn = [...$('dfmSpatialRevBody').querySelectorAll('button')].find(b => /返回/.test(b.textContent));
  assert(btn && btn.textContent === '返回检查结果明细', '复核卡应有「返回检查结果明细」');
  assert(/returnToDfmResults\(\)/.test(btn.getAttribute('onclick')), '应调用 returnToDfmResults');
});

test('rememberDfmResultPosition：记录行 id、位置与滚动；无行时不改状态', () => {
  w.State.resultReturnPosition = null;
  w.rememberDfmResultPosition(d.body);
  assert(w.State.resultReturnPosition === null, '不在表格行内时不应记录');
  const row = d.createElement('tr'); const cell = d.createElement('td'); const b = d.createElement('button');
  cell.appendChild(b); row.appendChild(cell); $('resTableBody').appendChild(row);
  w.rememberDfmResultPosition(b);
  const pos = w.State.resultReturnPosition;
  assert(pos && pos.rowId === row.id && /^dfmReturnRow_/.test(row.id), '应为无 id 的行补 id 并记录');
  assert(typeof pos.rowTop === 'number' && typeof pos.scrollX === 'number' && typeof pos.scrollY === 'number', '位置字段不全');
  row.remove();
});

test('画布过孔绘制：全板总览用 2px 方点，放大后画完整孔，孔对高亮带「孔到孔」标注', () => {
  const calls = [];
  const rec = new Proxy({}, { get: (_, k) => (...a) => { calls.push([k, ...a]); }, set: (_, k, v) => { calls.push(['set:' + k, v]); return true; } });
  const via = { id: 7, origin: [0, 0], padRadius: 5, drill: 4, firstDrillRadius: 3, isGnd: false, viaSpanType: 'thru', spanShort: '' };
  const base = (zoom, located) => ({
    vias: [via], vp: { zoom }, bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 }, worldToScreen: (x, y) => [x * zoom, y * zoom],
    showLabels: false, activeLayerFocus: '', measureSelection: [], locatedPair: located
  });
  const names = () => calls.map(c => c[0]);
  w.DfmCanvasVias.draw(rec, base(0.5, null));
  assert(names().includes('fillRect') && !names().includes('arc'), '总览应只用 fillRect：' + names().join(','));
  calls.length = 0;
  w.DfmCanvasVias.draw(rec, base(2, null));
  assert(names().filter(n => n === 'arc').length === 3 && !names().includes('fillRect'), '放大后应画 3 个圆');
  calls.length = 0;
  w.DfmCanvasVias.draw(rec, base(0.5, { gndViaId: 7, sigViaId: 8 }));
  assert(calls.some(c => c[0] === 'fillText' && c[1] === '孔到孔 Via 7') && names().includes('arc'), '总览下孔对仍应有高亮圈与标注');
  calls.length = 0;
  w.DfmCanvasVias.draw(rec, base(2, { gndViaId: 1, sigViaId: 7 }));
  assert(calls.some(c => c[0] === 'fillText' && c[1] === '孔到孔 Via 7'), '放大后孔对高亮应带标注');
  calls.length = 0;
  w.DfmCanvasVias.draw(rec, Object.assign(base(2, null), { bounds: { minX: 50, maxX: 60, minY: 50, maxY: 60 } }));
  assert(calls.length === 0, '视口外的过孔不应绘制');
});

test('页面运行期零脚本错误', () => {
  assert(!ctx.errors.length, ctx.errors.join(' | '));
});

ctx.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
