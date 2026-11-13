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

  test('点击「保存规则到本地」先弹出 JSON 窗口，点「下载 JSON」才生成文件', () => {
    let blobs = 0;
    w.URL.createObjectURL = () => { blobs++; return 'blob:test'; };
    w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function () {};
    $('btnSaveDfmRules').click();
    assert.strictEqual(blobs, 0, '弹窗前不应直接下载');
    const dlg = $('dfmRuleExportDialog');
    assert.ok(dlg && $('dfmRuleExportJson'), '应显示 JSON 导出窗口');
    const json = JSON.parse($('dfmRuleExportJson').value);
    assert.strictEqual(json.kind, w.DfmRuleConfig.kind);
    assert.ok(json.fields && Array.isArray(json.layerRules) && json.padstackRules, '导出内容缺少 fields / layerRules / padstackRules');
    const buttons = [...dlg.querySelectorAll('button')];
    assert.deepStrictEqual(buttons.map(b => b.textContent), ['复制 JSON', '下载 JSON', '关闭']);
    buttons[1].click();
    assert.strictEqual(blobs, 1);
    assert.ok(/下载/.test(dlg.querySelector('[role=status]').textContent), '下载后应有状态提示');
    buttons[2].click();
    assert.strictEqual($('dfmRuleExportDialog'), null, '关闭按钮应移除窗口');
    assert.strictEqual(ctx.errors.length, 0, ctx.errors.join(' | '));
  });

  test('导出窗口：重复点击只保留一个，Esc 与点击遮罩可关闭', () => {
    $('btnSaveDfmRules').click();
    $('btnSaveDfmRules').click();
    assert.strictEqual(d.querySelectorAll('#dfmRuleExportDialog').length, 1);
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.strictEqual($('dfmRuleExportDialog'), null, 'Esc 应关闭');
    $('btnSaveDfmRules').click();
    $('dfmRuleExportDialog').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    assert.strictEqual($('dfmRuleExportDialog'), null, '点击遮罩应关闭');
  });

  test('导出窗口内容经 textarea.value 输出，名称含 HTML 字符时不被解析', () => {
    w.DfmRuleConfig.loadFromObject({
      kind: 'pcb-dfm-rule-config', version: 1, fields: {},
      layerRules: [{ layers: '<img src=x onerror=alert(1)>', gnd: 1, sig: 1, pad: 1 }]
    });
    $('btnSaveDfmRules').click();
    assert.ok($('dfmRuleExportJson').value.includes('<img src=x'), 'JSON 原文应保留');
    assert.strictEqual(d.querySelectorAll('#dfmRuleExportDialog img').length, 0, '不得产生 img 节点');
    $('dfmRuleExportDialog').querySelector('button:last-child').click();
  });

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
