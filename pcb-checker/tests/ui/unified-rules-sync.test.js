/* ============================================================================
 * unified-rules-sync.test.js —— 综合一体化页与单项页的规则一致性
 * 迁自 main 的 nav-unify-test.js「综合一体化同步 DFM 分层规则与扇出预览特征」（重构时被误删）：
 * 分层间距规则表、孔盘到孔盘阈值、扇出间距分色图例、表格型约束 22 条分 5 组、命名说明位置、叠层数提示。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { openPage, tick, CHECKER_DIR } = require('../helpers/open-page');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (err) { console.error(`  FAIL  ${name} -> ${err.message}`); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

(async () => {
  const ctx = openPage('unified.html', { syncCheck: true });
  await tick(150);
  const { d, w } = ctx;
  w.alert = () => {};
  console.log('== 综合一体化：DFM 分层规则与扇出预览同步 ==');

  await test('DFM 分层间距规则表：默认阈值收在表内，无旧的单层筛选控件', () => {
    assert(d.getElementById('unifiedLayerRuleBox'), '缺少分层间距规则表');
    assert(d.getElementById('inpThresholdPadPair'), '默认行缺少孔盘到孔盘阈值');
    assert(d.getElementById('unifiedLayerRuleTable').contains(d.getElementById('inpThresholdGnd')), '默认阈值应收在规则表内');
    assert(!d.getElementById('selDfmLayerFilter'), '不应出现旧的单层筛选控件');
  });

  await test('扇出放大预览带按孔心距分色的图例', () => {
    const legend = d.getElementById('uViewFanoutDistanceLegend');
    assert(legend, '缺少图例');
    assert(/孔心距相同同色/.test(legend.textContent), '图例未说明同孔心距同色：' + legend.textContent);
  });

  await test('表格型约束 TXT 在综合页拆成 22 条并按 5 类分组渲染', () => {
    const txt = fs.readFileSync(path.join(CHECKER_DIR, 'sample/约束示例_表格型.txt'), 'utf8');
    const sets = w.parseConstraintText(txt, '表格示例.txt');
    assert(sets.length === 22, '应拆成 22 条，实际 ' + sets.length);
    assert(sets[0].title === 'SMA-Top-L2' && sets.some(s => s.title === 'BGA-L2-L4-0.5mm'), '表格解析命名与单项页不一致');
    w.State.rules.constraintSets = sets;
    w.renderJump();
    w.renderConstraintSets();
    const cards = d.querySelectorAll('#setsContainer .set').length;
    const groups = d.querySelectorAll('#setsContainer .unified-constraint-group').length;
    assert(cards === 22 && groups === 5, `应渲染 22 张约束卡 / 5 个分组，实际 ${cards} / ${groups}`);
  });

  await test('命名说明位于约束卡之后，页内有叠层数提示', () => {
    const note = d.querySelector('.unified-constraint-note');
    assert(note, '缺少约束命名与填法说明');
    assert(note.compareDocumentPosition(d.getElementById('setsContainer')) & w.Node.DOCUMENT_POSITION_PRECEDING, '命名说明应在约束卡之后');
    assert(d.getElementById('unifiedLayerCountHint'), '缺少叠层数提示');
  });

  await test('分层规则模板：Top/Bot + 内层生成 2 条规则', () => {
    w.eval('UnifiedDfmLayerRules.template()');
    const rows = d.querySelectorAll('#unifiedLayerRuleBody tr').length;
    assert(rows === 2, '应生成 2 行，实际 ' + rows);
  });

  await test('页面脚本零报错', () => {
    assert(ctx.errors.length === 0, ctx.errors.join('；'));
  });

  ctx.close();
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  if (fail) process.exit(1);
})();
