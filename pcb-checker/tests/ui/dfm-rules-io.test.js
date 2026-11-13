/* ============================================================================
 * dfm-rules-io.test.js —— DFM 分层规则与规则快照的读写回归
 * 背景：dfm-config.js 曾手写 LayerRules 转发对象，漏了 add / previewOf / syncHint，
 * 并把 DfmRuleConfig 转发成只有 bindEvents，导致「加一条分层规则」「保存 / 载入规则」点击即报错。
 * ========================================================================== */
'use strict';

const assert = require('assert');
const { openPage, tick } = require('../helpers/open-page');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '  -> ' + e.message); }
}

(async () => {
  const ctx = openPage('dfm.html', { syncCheck: true });
  const { w, d } = ctx;
  const $ = id => d.getElementById(id);
  await tick(250);
  const rows = () => d.querySelectorAll('#layerRuleBody tr[data-row]').length;

  console.log('== DFM 分层规则与规则快照 ==');

  test('点击「加一条分层规则」新增一行且无脚本错误', () => {
    assert.strictEqual(rows(), 0);
    $('btnAddLayerRule').click();
    assert.strictEqual(rows(), 1);
    assert.strictEqual(ctx.errors.length, 0, ctx.errors.join(' | '));
  });

  test('输入适用层后预览与提示同步，且写入 localStorage', () => {
    const inp = d.querySelector('#layerRuleBody .lrLayers');
    inp.value = 'L2-L5';
    inp.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.ok(/L2/.test(d.querySelector('.lrPreview').textContent), d.querySelector('.lrPreview').textContent);
    assert.ok($('layerRuleHint').textContent.includes('已设 1 条'));
    assert.ok(w.localStorage.getItem('pcb.dfm.layerRules.v1').includes('L2-L5'));
  });

  test('「载入推荐分层规则」后为 2 行，逐行删除后回到空表', () => {
    $('btnLayerRuleTemplate').click();
    assert.strictEqual(rows(), 2);
    while (d.querySelector('#layerRuleBody .lrDel')) d.querySelector('#layerRuleBody .lrDel').click();
    assert.strictEqual(rows(), 0);
  });

  test('规则快照：阈值与分层规则往返一致', () => {
    $('inpThresholdGnd').value = '6.5';
    $('btnLayerRuleTemplate').click();
    const snap = w.DfmRuleConfig.snapshot();
    assert.strictEqual(snap.kind, 'pcb-dfm-rule-config');
    assert.strictEqual(snap.fields.inpThresholdGnd, '6.5');
    assert.strictEqual(snap.layerRules.length, 2);
    $('inpThresholdGnd').value = '1';
    while (d.querySelector('#layerRuleBody .lrDel')) d.querySelector('#layerRuleBody .lrDel').click();
    w.DfmRuleConfig.loadFromObject(JSON.parse(JSON.stringify(snap)));
    assert.strictEqual($('inpThresholdGnd').value, '6.5');
    assert.strictEqual(rows(), 2);
  });

  test('非法快照文件被拒绝，且不改动现有规则', () => {
    assert.throws(() => w.DfmRuleConfig.loadFromObject({ kind: 'other' }), /文件格式不正确/);
    assert.strictEqual(rows(), 2);
  });

  test('点击「保存规则到本地」生成 JSON 下载', () => {
    let blobs = 0;
    w.URL.createObjectURL = () => { blobs++; return 'blob:test'; };
    w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function () {};
    $('btnSaveDfmRules').click();
    assert.strictEqual(blobs, 1);
    assert.strictEqual(ctx.errors.length, 0, ctx.errors.join(' | '));
  });

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
