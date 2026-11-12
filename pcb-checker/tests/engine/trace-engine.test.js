/* 模块化走线检查引擎单元测试 */
const fs = require("fs");
const assert = require("assert");
const L = require("../../packages/engines/trace");

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '  -> ' + e.message); }
}

console.log('== 报告格式解析 ==');
t('识别为 Item 块格式', () => assert.strictEqual(L.isBlockFormat(L.SAMPLE_TEXT), true));
t('Meta: 文件声明 Total 10 Item，识别 10 个 Item 块', () => {
  const meta = L.parseBlockMeta(L.SAMPLE_TEXT);
  assert.strictEqual(meta.declared, 10);
  assert.strictEqual(meta.items, 10);
});
t('Meta: 声明数与块数不一致时能识别(声明5/实际10)', () => {
  const meta = L.parseBlockMeta('Total 5 Item\n' + L.SAMPLE_TEXT.split('\n').slice(2).join('\n'));
  assert.strictEqual(meta.declared, 5);
  assert.strictEqual(meta.items, 10);
});
const recs = L.parseBlockText(L.SAMPLE_TEXT);
t('解析出 10 条记录(网络×层)', () => assert.strictEqual(recs.length, 10));
const it1 = recs[0];
t('Item1: net=105_P layer=02G01P length=2000.068301', () => {
  assert.strictEqual(it1.net, '105_P');
  assert.strictEqual(it1.layer, '02G01P');
  assert.ok(Math.abs(it1.length - 2000.068301) < 1e-9);
});
t('Item1: 线段 直2+弧1, 线宽[5.6], 变化顺序[5.6], 最小弧半径52.38', () => {
  assert.strictEqual(it1.segCount, 2);
  assert.strictEqual(it1.arcCount, 1);
  assert.deepStrictEqual(it1.widthsArr, [5.6]);
  assert.deepStrictEqual(it1.widthSeq, [5.6]);
  assert.ok(Math.abs(it1.minRadius - 52.38) < 1e-9);
});
t('Item3: 含两种线宽 5.6/6.0，顺序为 [5.6, 6.0]', () => {
  assert.deepStrictEqual(recs[2].widthsArr, [5.6, 6.0]);
  assert.deepStrictEqual(recs[2].widthSeq, [5.6, 6.0]);
});
t('同网络多层 -> netLens: 301_P = {02G01P:800, 02G03P:400}', () => {
  const { netLens } = L.aggregateRecords(recs);
  const nl = netLens.get('301_P');
  assert.strictEqual(nl.get('02G01P'), 800);
  assert.strictEqual(nl.get('02G03P'), 400);
});
t('层统计: 02G01P 有 7 条记录、弧段 2，收集到线宽组合 [5.6, 5.6-6]', () => {
  const ls = L.layerStats(recs).find(e => e.layer === '02G01P');
  assert.strictEqual(ls.recs, 7);
  assert.strictEqual(ls.arcSegs, 2);
  assert.ok(ls.widthSeqs.has('5.6'));
  assert.ok(ls.widthSeqs.has('5.6-6'));
});

console.log('== 线宽组合解析与正序/倒序匹配算法 ==');
t('parseWidthCombos: 解析单个及多个组合 (支持连字符、箭头、分号、或、逗号)', () => {
  const c1 = L.parseWidthCombos('6.9-6-3.94, 6.9-5.7-6.9');
  assert.strictEqual(c1.length, 2);
  assert.deepStrictEqual(c1[0].seq, [6.9, 6, 3.94]);
  assert.deepStrictEqual(c1[1].seq, [6.9, 5.7, 6.9]);

  const c2 = L.parseWidthCombos('6.9->6->3.94; 6.9->5.7->6.9');
  assert.strictEqual(c2.length, 2);
  assert.deepStrictEqual(c2[0].seq, [6.9, 6, 3.94]);
  assert.deepStrictEqual(c2[1].seq, [6.9, 5.7, 6.9]);

  const c3 = L.parseWidthCombos('6.9-6-3.94 或 6.9-5.7-6.9');
  assert.strictEqual(c3.length, 2);
  assert.deepStrictEqual(c3[0].seq, [6.9, 6, 3.94]);
  assert.deepStrictEqual(c3[1].seq, [6.9, 5.7, 6.9]);

  const c4 = L.parseWidthCombos('5.6, 6.0');
  assert.strictEqual(c4.length, 2);
  assert.deepStrictEqual(c4[0].seq, [5.6]);
  assert.deepStrictEqual(c4[1].seq, [6.0]);
});

t('matchWidthCombo: 支持正序匹配与倒序匹配 (允许倒序)', () => {
  const combo = { raw: '6.9-6-3.94', seq: [6.9, 6.0, 3.94] };
  // 正序匹配 6.9 -> 6 -> 3.94
  assert.strictEqual(L.matchWidthCombo([6.9, 6.0, 3.94], combo), true);
  // 倒序匹配 3.94 -> 6 -> 6.9
  assert.strictEqual(L.matchWidthCombo([3.94, 6.0, 6.9], combo), true);
  // 不符合的序列 6.9 -> 5.6 -> 3.94
  assert.strictEqual(L.matchWidthCombo([6.9, 5.6, 3.94], combo), false);
  // 长度不一致 6.9 -> 6.0
  assert.strictEqual(L.matchWidthCombo([6.9, 6.0], combo), false);
});

t('checkWidthCombos: 多组合匹配与详细不符合原因生成', () => {
  const combos = L.parseWidthCombos('6.9-6-3.94, 6.9-5.7-6.9');
  // 正序匹配 combo 1
  const r1 = L.checkWidthCombos([6.9, 6.0, 3.94], combos);
  assert.strictEqual(r1.pass, true);
  // 倒序匹配 combo 1
  const r2 = L.checkWidthCombos([3.94, 6.0, 6.9], combos);
  assert.strictEqual(r2.pass, true);
  // 匹配 combo 2
  const r3 = L.checkWidthCombos([6.9, 5.7, 6.9], combos);
  assert.strictEqual(r3.pass, true);
  // 不匹配
  const r4 = L.checkWidthCombos([6.9, 5.6, 3.94], combos);
  assert.strictEqual(r4.pass, false);
  assert.strictEqual(r4.actualStr, '6.9 → 5.6 → 3.94');
  assert.strictEqual(r4.allowedStr, '6.9-6-3.94、6.9-5.7-6.9');
});

t('extractWidthSeq: 沿走线合并连续同线宽段，保留非连续变化', () => {
  // 连续同线宽: 6.9, 6.9, 6.0, 6.0, 3.94, 3.94 -> [6.9, 6.0, 3.94]
  const mockSegs1 = [
    { width: 6.9 }, { width: 6.9 }, { width: 6.0 }, { width: 6.0 }, { width: 3.94 }, { width: 3.94 }
  ];
  const seq1 = L.extractWidthSeq({ segs: mockSegs1 });
  assert.deepStrictEqual(seq1, [6.9, 6.0, 3.94]);

  // 非连续变化: 6.9 -> 5.7 -> 6.9 -> [6.9, 5.7, 6.9]
  const mockSegs2 = [
    { width: 6.9 }, { width: 5.7 }, { width: 6.9 }
  ];
  const seq2 = L.extractWidthSeq({ segs: mockSegs2 });
  assert.deepStrictEqual(seq2, [6.9, 5.7, 6.9]);
});

console.log('== 走线检查与线宽组合约束 ==');
const rules = [
  { enabled: true, layer: '02G01P', widthsText: '5.6', widthCombos: [{ raw: '5.6', seq: [5.6] }], lenMode: 'range', lengths: [], lenMin: 1000, lenMax: 2500 },
  { enabled: true, layer: '02G03P', widthsText: '4.0', widthCombos: [{ raw: '4.0', seq: [4.0] }], lenMode: 'off', lengths: [], lenMin: NaN, lenMax: NaN },
];
const def = { enabled: false };
const res = L.runChecks(recs, rules, def, { tol: 0.001, checkWidth: true, checkLen: true });
t('网络统计: 8 网络, 通过3 / 不符合4 / 未检查1', () => {
  assert.strictEqual(res.stats.nets, 8);
  assert.strictEqual(res.stats.pass, 3);
  assert.strictEqual(res.stats.fail, 4);
  assert.strictEqual(res.stats.none, 1);
});
t('106_P 不符合: 线宽组合实际顺序 5.6 → 6 不在允许组合 {5.6} 中', () => {
  const a = res.netAgg.get('106_P');
  assert.strictEqual(a.fail, true);
  assert.ok(a.issues.some(i => i.includes('线宽组合不符合') && i.includes('5.6 → 6') && i.includes('5.6')));
});
t('301_P/301_N/402 不符合: 线长低于下限 1000', () => {
  ['301_P', '301_N', '402'].forEach(n => {
    const a = res.netAgg.get(n);
    assert.strictEqual(a.fail, true, n + ' should fail');
    assert.ok(a.issues.some(i => i.includes('< 下限 1000')), n + ' reason');
  });
});
t('301_P 在 02G03P 层(400长/4.0宽)不受 02G01P 规则牵连, 问题只标 02G01P', () => {
  const a = res.netAgg.get('301_P');
  assert.ok(a.issues.every(i => i.startsWith('[02G01P]')));
});
t('105_P/105_N/106_N 通过; 403 未检查', () => {
  ['105_P', '105_N', '106_N'].forEach(n => {
    assert.strictEqual(res.netAgg.get(n).fail, false);
    assert.strictEqual(res.netAgg.get(n).checked, true);
  });
  assert.strictEqual(res.netAgg.get('403').checked, false);
});
t('仅检查线宽(关闭线长)时 402 通过', () => {
  const r2 = L.runChecks(recs, rules, def, { tol: 0.001, checkWidth: true, checkLen: false });
  assert.strictEqual(r2.netAgg.get('402').fail, false);
  assert.strictEqual(r2.netAgg.get('106_P').fail, true);
});
t('02G01P 规则配置组合 5.6-6 时，106_P (5.6->6) 通过线宽检查', () => {
  const rPass = L.runChecks(recs, [
    { enabled: true, layer: '02G01P', widthsText: '5.6-6', widthCombos: [{ raw: '5.6-6', seq: [5.6, 6] }], lenMode: 'range', lengths: [], lenMin: 1000, lenMax: 2500 }
  ], def, { tol: 0.001, checkWidth: true, checkLen: true });
  assert.strictEqual(rPass.netAgg.get('106_P').fail, false, '106_P 符合 5.6-6 组合与长度范围');
});

console.log('== 用户场景：08IS03层多种固定线宽组合约束 (6.9-6-3.94, 6.9-5.7-6.9 允许倒序) ==');
t('测试 08IS03 层固定线宽组合：正序通过、倒序通过、对称通过、错误组合报错', () => {
  const customTxt = [
    'Item 1 < Trace >',
    'Subset: 08IS03',
    'Net: NET_FWD',
    'Length: 100.0',
    'Seg: xy [0, 0] xy [50, 0] Width (6.9000)',
    'Seg: xy [50, 0] xy [80, 0] Width (6.0000)',
    'Seg: xy [80, 0] xy [100, 0] Width (3.9400)', // 6.9 -> 6.0 -> 3.94 (正序匹配)
    '',
    'Item 2 < Trace >',
    'Subset: 08IS03',
    'Net: NET_REV',
    'Length: 100.0',
    'Seg: xy [0, 0] xy [20, 0] Width (3.9400)',
    'Seg: xy [20, 0] xy [50, 0] Width (6.0000)',
    'Seg: xy [50, 0] xy [100, 0] Width (6.9000)', // 3.94 -> 6.0 -> 6.9 (倒序匹配)
    '',
    'Item 3 < Trace >',
    'Subset: 08IS03',
    'Net: NET_SYM',
    'Length: 100.0',
    'Seg: xy [0, 0] xy [40, 0] Width (6.9000)',
    'Seg: xy [40, 0] xy [70, 0] Width (5.7000)',
    'Seg: xy [70, 0] xy [100, 0] Width (6.9000)', // 6.9 -> 5.7 -> 6.9 (匹配第二种组合)
    '',
    'Item 4 < Trace >',
    'Subset: 08IS03',
    'Net: NET_MISMATCH',
    'Length: 100.0',
    'Seg: xy [0, 0] xy [40, 0] Width (6.9000)',
    'Seg: xy [40, 0] xy [70, 0] Width (5.6000)',
    'Seg: xy [70, 0] xy [100, 0] Width (3.9400)' // 6.9 -> 5.6 -> 3.94 (不符合)
  ].join('\n');

  const cRecs = L.parseBlockText(customTxt);
  const combosStr = '6.9-6-3.94, 6.9-5.7-6.9';
  const rule = [{
    enabled: true, layer: '08IS03', checkWidth: true,
    widthsText: combosStr, widthCombos: L.parseWidthCombos(combosStr),
    checkLen: false, lenMode: 'off', lengths: [], lenMin: NaN, lenMax: NaN
  }];

  const rRes = L.runChecks(cRecs, rule, { enabled: false }, { tol: 0.001, checkWidth: true });
  assert.strictEqual(rRes.netAgg.get('NET_FWD').fail, false, 'NET_FWD 正序匹配应通过');
  assert.strictEqual(rRes.netAgg.get('NET_REV').fail, false, 'NET_REV 倒序匹配应通过');
  assert.strictEqual(rRes.netAgg.get('NET_SYM').fail, false, 'NET_SYM 对称组合应通过');
  assert.strictEqual(rRes.netAgg.get('NET_MISMATCH').fail, true, 'NET_MISMATCH 错误线宽组合应报错不符合');

  const issues = rRes.netAgg.get('NET_MISMATCH').issues;
  assert.ok(issues.some(i => i.includes('线宽组合不符合') && i.includes('6.9 → 5.6 → 3.94') && i.includes('6.9-6-3.94、6.9-5.7-6.9')),
    '错误提示应指出实际顺序与期望组合：' + issues.join('; '));
});

console.log('== 特定线宽线长限制检查 (如 6.9mil 线宽对应 10mil 线长) ==');
t('parseWidthLengthRules 解析等号、冒号、范围、不等式与多规则', () => {
  const r1 = L.parseWidthLengthRules('6.9=10');
  assert.strictEqual(r1.length, 1);
  assert.strictEqual(r1[0].width, 6.9);
  assert.strictEqual(r1[0].mode, 'list');
  assert.deepStrictEqual([...r1[0].list], [10]);

  const r2 = L.parseWidthLengthRules('6.9mil : 10mil');
  assert.strictEqual(r2.length, 1);
  assert.strictEqual(r2[0].width, 6.9);
  assert.deepStrictEqual([...r2[0].list], [10]);

  const r3 = L.parseWidthLengthRules('6.9: 8~12; 6.0 <= 500');
  assert.strictEqual(r3.length, 2);
  assert.strictEqual(r3[0].width, 6.9);
  assert.strictEqual(r3[0].mode, 'range');
  assert.strictEqual(r3[0].min, 8);
  assert.strictEqual(r3[0].max, 12);
  assert.strictEqual(r3[1].width, 6.0);
  assert.strictEqual(r3[1].mode, 'max');
  assert.strictEqual(r3[1].max, 500);

  const r4 = L.parseWidthLengthRules('6.9=10, 5.6=800');
  assert.strictEqual(r4.length, 2);
  assert.strictEqual(r4[0].width, 6.9);
  assert.strictEqual(r4[1].width, 5.6);
  assert.deepStrictEqual([...r4[1].list], [800]);

  // 多线长支持：6.9=10或者20, 6.9=10/20, 6.9=10, 20
  const r5 = L.parseWidthLengthRules('6.9=10或者20');
  assert.strictEqual(r5.length, 1);
  assert.strictEqual(r5[0].width, 6.9);
  assert.deepStrictEqual([...r5[0].list], [10, 20]);

  const r6 = L.parseWidthLengthRules('6.9=10/20');
  assert.strictEqual(r6.length, 1);
  assert.deepStrictEqual([...r6[0].list], [10, 20]);

  const r7 = L.parseWidthLengthRules('6.9=10, 20');
  assert.strictEqual(r7.length, 1);
  assert.deepStrictEqual([...r7[0].list], [10, 20]);

  const r8 = L.parseWidthLengthRules('6.9=10, 6.9=20');
  assert.strictEqual(r8.length, 1);
  assert.deepStrictEqual([...r8[0].list], [10, 20]);
});

t('用户场景测试：6.9=10或者20，长度为10或20通过，长度为15报错不符合', () => {
  const customTxt = [
    'Item 1 < Trace >',
    'Subset: 02G01P',
    'Net: NET_10',
    'Length: 100.0',
    'Seg: xy [0, 0] xy [90, 0] Width (5.6000)',
    'Seg: xy [90, 0] xy [100, 0] Width (6.9000)', // 6.9mil 宽，长度 10.0
    '',
    'Item 2 < Trace >',
    'Subset: 02G01P',
    'Net: NET_20',
    'Length: 110.0',
    'Seg: xy [0, 0] xy [90, 0] Width (5.6000)',
    'Seg: xy [90, 0] xy [110, 0] Width (6.9000)', // 6.9mil 宽，长度 20.0
    '',
    'Item 3 < Trace >',
    'Subset: 02G01P',
    'Net: NET_15',
    'Length: 105.0',
    'Seg: xy [0, 0] xy [90, 0] Width (5.6000)',
    'Seg: xy [90, 0] xy [105, 0] Width (6.9000)' // 6.9mil 宽，长度 15.0
  ].join('\n');

  const cRecs = L.parseBlockText(customTxt);
  const ruleOr = [{
    enabled: true, layer: '02G01P', checkWidth: true, widthsText: '5.6-6.9', widthCombos: L.parseWidthCombos('5.6-6.9'),
    checkLen: false, lenMode: 'off', lengths: [], lenMin: NaN, lenMax: NaN,
    checkWidthLen: true, widthLensText: '6.9=10或者20', widthLenRules: L.parseWidthLengthRules('6.9=10或者20'),
    checkRad: false, radMode: 'off', radii: [], radMin: NaN, radMax: NaN
  }];

  const res = L.runChecks(cRecs, ruleOr, { enabled: false }, { tol: 0.001, checkWidth: true, checkWidthLen: true });
  assert.strictEqual(res.netAgg.get('NET_10').fail, false, 'NET_10 长度10在 [10, 20] 中，应通过');
  assert.strictEqual(res.netAgg.get('NET_20').fail, false, 'NET_20 长度20在 [10, 20] 中，应通过');
  assert.strictEqual(res.netAgg.get('NET_15').fail, true, 'NET_15 长度15不在 [10, 20] 中，应报错');
  assert.ok(res.netAgg.get('NET_15').issues.some(i => i.includes('指定线宽 6.9') && i.includes('实际长度 15') && i.includes('10, 20')));
});

t('特定线宽线长约束：Item3中6.0宽长度为700，要求6.0=700通过，要求6.0=650报错不符合', () => {
  const passRules = [{
    enabled: true, layer: '02G01P', checkWidth: true, widthsText: '5.6-6', widthCombos: L.parseWidthCombos('5.6-6'),
    checkLen: false, lenMode: 'off', lengths: [], lenMin: NaN, lenMax: NaN,
    checkWidthLen: true, widthLensText: '6.0=700', widthLenRules: L.parseWidthLengthRules('6.0=700'),
    checkRad: false, radMode: 'off', radii: [], radMin: NaN, radMax: NaN
  }];
  const rPass = L.runChecks(recs, passRules, { enabled: false }, { tol: 0.001, checkWidth: true, checkWidthLen: true });
  assert.strictEqual(rPass.netAgg.get('106_P').fail, false, '106_P 6.0宽线长为700，符合要求6.0=700');

  const failRules = [{
    enabled: true, layer: '02G01P', checkWidth: true, widthsText: '5.6-6', widthCombos: L.parseWidthCombos('5.6-6'),
    checkLen: false, lenMode: 'off', lengths: [], lenMin: NaN, lenMax: NaN,
    checkWidthLen: true, widthLensText: '6.0=650', widthLenRules: L.parseWidthLengthRules('6.0=650'),
    checkRad: false, radMode: 'off', radii: [], radMin: NaN, radMax: NaN
  }];
  const rFail = L.runChecks(recs, failRules, { enabled: false }, { tol: 0.001, checkWidth: true, checkWidthLen: true });
  const a106 = rFail.netAgg.get('106_P');
  assert.strictEqual(a106.fail, true, '106_P 6.0宽线长为700不等于650，应报错不符合');
  assert.ok(a106.issues.some(i => i.includes('指定线宽 6') && i.includes('实际长度 700') && i.includes('650')),
    '错误信息应包含指定线宽与实际长度：' + a106.issues.join('; '));
});

t('用户场景测试：6.9mil线宽对应10mil线长约束', () => {
  const customTxt = [
    'Item 1 < Trace >',
    'Subset: 02G01P',
    'Net: NET_PASS_69',
    'Length: 100.0',
    'Seg: xy [0, 0] xy [90, 0] Width (5.6000)',
    'Seg: xy [90, 0] xy [100, 0] Width (6.9000)', // 6.9mil 宽，长度 10.0
    '',
    'Item 2 < Trace >',
    'Subset: 02G01P',
    'Net: NET_FAIL_69',
    'Length: 102.0',
    'Seg: xy [0, 0] xy [90, 0] Width (5.6000)',
    'Seg: xy [90, 0] xy [102, 0] Width (6.9000)', // 6.9mil 宽，长度 12.0
    '',
    'Item 3 < Trace >',
    'Subset: 02G01P',
    'Net: NET_OTHER',
    'Length: 90.0',
    'Seg: xy [0, 0] xy [90, 0] Width (5.6000)' // 无 6.9mil 宽
  ].join('\n');

  const cRecs = L.parseBlockText(customTxt);
  const rule69 = [{
    enabled: true, layer: '02G01P', checkWidth: true, widthsText: '5.6-6.9, 5.6', widthCombos: L.parseWidthCombos('5.6-6.9, 5.6'),
    checkLen: false, lenMode: 'off', lengths: [], lenMin: NaN, lenMax: NaN,
    checkWidthLen: true, widthLensText: '6.9=10', widthLenRules: L.parseWidthLengthRules('6.9=10'),
    checkRad: false, radMode: 'off', radii: [], radMin: NaN, radMax: NaN
  }];

  const res = L.runChecks(cRecs, rule69, { enabled: false }, { tol: 0.001, checkWidth: true, checkWidthLen: true });
  assert.strictEqual(res.netAgg.get('NET_PASS_69').fail, false, 'NET_PASS_69 6.9mil宽长度刚好10，应通过');
  assert.strictEqual(res.netAgg.get('NET_FAIL_69').fail, true, 'NET_FAIL_69 6.9mil宽长度为12，应报错');
  assert.ok(res.netAgg.get('NET_FAIL_69').issues.some(i => i.includes('指定线宽 6.9') && i.includes('实际长度 12') && i.includes('10')));
  assert.strictEqual(res.netAgg.get('NET_OTHER').fail, false, 'NET_OTHER 不包含 6.9mil 走线，不受该线宽限制影响');
});

console.log('== 差分按层计算 ==');
const { netLens } = L.aggregateRecords(recs);
const dp = L.detectPairs([...netLens.keys()], [{ pos: '_P', neg: '_N' }, { pos: '+', neg: '-' }]);
t('配对 3 对: 105/106/301; 402/403 未配对', () => {
  assert.deepStrictEqual(dp.pairs.map(p => p.base), ['105', '106', '301']);
  assert.deepStrictEqual(dp.unmatched.sort(), ['402', '403']);
});
const d301 = L.computePairDiff(dp.pairs.find(p => p.base === '301'), netLens);
t('301 逐层差: 02G01P=2, 02G03P=4; 合计=2; 层分布一致', () => {
  const by = Object.fromEntries(d301.rows.map(r => [r.layer, r.diff]));
  assert.strictEqual(by['02G01P'], 2);
  assert.strictEqual(by['02G03P'], 4);
  assert.strictEqual(d301.total.diff, 2);
  assert.strictEqual(d301.setMismatch, false);
});
const d105 = L.computePairDiff(dp.pairs.find(p => p.base === '105'), netLens);
t('105 差值 = 0.332899 (2000.4012-2000.068301)', () => {
  assert.ok(Math.abs(d105.total.diff - 0.332899) < 1e-9);
});
t('差分网络总线长差检查：各层未超差但跨层总差值超差场景', () => {
  const customMap = new Map();
  customMap.set('DIFF_ACC_P', new Map([['L1', 100], ['L2', 200]]));
  customMap.set('DIFF_ACC_N', new Map([['L1', 100.6], ['L2', 200.6]]));
  const pairAcc = { base: 'DIFF_ACC', pos: 'DIFF_ACC_P', neg: 'DIFF_ACC_N' };
  const res = L.computePairDiff(pairAcc, customMap, { layerTol: 1.0, totalTol: 1.0 });
  assert.strictEqual(res.layerExceed, false, '逐层未超差');
  assert.strictEqual(res.totalExceed, true, '总线长差超差');
  assert.strictEqual(res.exceed, true, '整体判定为超差');
  assert.ok(Math.abs(res.totalDiff - 1.2) < 1e-6);
});
t('差分网络总线长差检查：总差值通过但单层超差场景', () => {
  const customMap = new Map();
  customMap.set('DIFF_BAL_P', new Map([['L1', 100], ['L2', 202]]));
  customMap.set('DIFF_BAL_N', new Map([['L1', 102], ['L2', 200]]));
  const pairBal = { base: 'DIFF_BAL', pos: 'DIFF_BAL_P', neg: 'DIFF_BAL_N' };
  const res = L.computePairDiff(pairBal, customMap, { layerTol: 1.0, totalTol: 1.0 });
  assert.strictEqual(res.layerExceed, true, '逐层超差');
  assert.strictEqual(res.totalExceed, false, '总线长差未超差');
  assert.strictEqual(res.exceed, true, '整体判定为超差');
  assert.strictEqual(res.totalDiff, 0);
});
t('差分网络总线长差支持独立设置逐层与总长允许值', () => {
  const customMap = new Map();
  customMap.set('DIFF_IND_P', new Map([['L1', 100], ['L2', 200]]));
  customMap.set('DIFF_IND_N', new Map([['L1', 100.6], ['L2', 200.6]]));
  const pairInd = { base: 'DIFF_IND', pos: 'DIFF_IND_P', neg: 'DIFF_IND_N' };
  const res = L.computePairDiff(pairInd, customMap, { layerTol: 2.0, totalTol: 0.5 });
  assert.strictEqual(res.layerExceed, false);
  assert.strictEqual(res.totalExceed, true);
  assert.strictEqual(res.exceed, true);
});

console.log('== 表格文本兼容 ==');
const tbl = '网络名\t层\t线宽\t线长\nNET_A\tL1\t5.6\t100\nNET_A\tL2\t4\t50\n';
t('非报告文本识别为表格并映射记录', () => {
  assert.strictEqual(L.isBlockFormat(tbl), false);
  const g = L.parseDelimited(tbl, '\t', true);
  const mp = L.autoMapColumns(g.headers);
  const r2 = L.recordsFromGrid(g, mp);
  assert.strictEqual(r2.length, 2);
  assert.strictEqual(r2[0].net, 'NET_A');
  assert.deepStrictEqual(r2[0].widthsArr, [5.6]);
  assert.deepStrictEqual(r2[0].widthSeq, [5.6]);
});

console.log('== CSV 导出 ==');
t('CSV 带 BOM 且引号转义', () => {
  const csv = L.toCSV(['a', 'b'], [[1, 'x,y"z']]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"x,y""z"'));
});

console.log('== 第④和⑤页 Excel 检查汇总报告 (问题网络 / 问题原因 / 如何修改) ==');
t('generateXLSX: 生成有效 OOXML 格式 Excel 二进制数据', () => {
  const xlsx = L.generateXLSX([{
    name: '检查汇总报告',
    headers: ['问题网络 (网络名+所在层)', '问题原因', '如何修改'],
    cols: [{ width: 25 }, { width: 40 }, { width: 50 }],
    rows: [['106_P (02G01P)', '线宽不对：实测顺序「5.6 → 6」，要求「5.6」', '将走线线宽修改为设计值5.6mil']]
  }]);
  assert.ok(xlsx instanceof Uint8Array, '返回 Uint8Array 二进制流');
  assert.ok(xlsx.length > 500, '文件大小符合要求');
  assert.strictEqual(xlsx[0], 0x50);
  assert.strictEqual(xlsx[1], 0x4b);
  assert.strictEqual(xlsx[2], 0x03);
  assert.strictEqual(xlsx[3], 0x04);
});

t('generateUnifiedReportData: 汇总第④页走线检查与第⑤页差分分析，包含「问题网络、问题原因、如何修改」', () => {
  const recs = L.parseBlockText(L.SAMPLE_TEXT);
  const rules = [
    { enabled: true, layer: '02G01P', checkWidth: true, widthsText: '5.6', checkLen: true, lenMode: 'range', lenMin: 1000, lenMax: 3000 }
  ];
  const defRule = { enabled: false };
  const opts = { checkWidth: true, checkLen: true, checkWidthLen: true, checkRad: true, tol: 0.001 };
  const checkRes = L.runChecks(recs, rules, defRule, opts);
  const agg = L.aggregateRecords(recs);
  const det = L.detectPairs(Array.from(agg.netLens.keys()), [{ pos: '_P', neg: '_N' }]);
  const traceRev = new Set([recs[2].idx]); // Item3: 106_P
  const diffRev = new Set(['301|02G01P']);

  const rep = L.generateUnifiedReportData(
    recs, checkRes, rules, defRule, opts, traceRev,
    det.pairs, agg.netLens, { layerTol: 1, totalTol: 1, checkLayer: true, checkTotal: true }, diffRev
  );

  assert.ok(rep.headers.includes('问题网络 (网络名+所在层)'), '含「问题网络 (网络名+所在层)」列');
  assert.ok(rep.headers.includes('问题原因'), '含「问题原因」列');
  assert.ok(rep.headers.includes('如何修改'), '含「如何修改」列');
  assert.ok(rep.headers.includes('复验状态'), '含「复验状态」列');
  assert.strictEqual(rep.problemCount, 7, '汇总 4个走线问题 + 3个差分问题 = 共7项');

  // 106_P width mismatch row
  const row106 = rep.rows.find(r => r[1] === '106_P (02G01P)');
  assert.ok(row106, '包含 106_P (02G01P) 问题网络行');
  assert.ok(row106[2].includes('线宽不对'), '问题原因归类为「线宽不对」');
  assert.ok(row106[3].includes('修改为设计值') && row106[3].includes('5.6'), '如何修改给出设计值建议');
  assert.strictEqual(row106[4], '已复验', '复验状态正确体现');

  // 301_P length mismatch row
  const row301 = rep.rows.find(r => r[1] === '301_P (02G01P)');
  assert.ok(row301, '包含 301_P (02G01P) 问题网络行');
  assert.ok(row301[2].includes('线长超标'), '问题原因归类为「线长超标」');
  assert.ok(row301[3].includes('蛇形绕线增加') && row301[3].includes('1000'), '如何修改给出蛇形绕线设计值');
  assert.strictEqual(row301[4], '未复验', '复验状态未勾选');

  // Diff 301 layer diff row
  const rowDiffL1 = rep.rows.find(r => r[1] === '301_P / 301_N (02G01P)');
  assert.ok(rowDiffL1, '包含 301_P / 301_N (02G01P) 差分行');
  assert.ok(rowDiffL1[2].includes('差分线对内长度差超标'), '问题原因归类为「差分线对内长度差超标」');
  assert.ok(rowDiffL1[3].includes('绕线补偿'), '如何修改包含绕线补偿举例');
  assert.strictEqual(rowDiffL1[4], '已复验', '差分复验状态正确体现');

  // Diff 301 total diff row
  const rowDiffTot = rep.rows.find(r => r[1] === '301_P / 301_N (跨层总长)');
  assert.ok(rowDiffTot, '包含 301_P / 301_N (跨层总长) 差分行');
  assert.ok(rowDiffTot[2].includes('差分总线长差超标'), '问题原因归类为「差分总线长差超标」');
  assert.ok(rowDiffTot[3].includes('总长微调绕线补偿'), '如何修改包含总长补偿举例');
});

t('全部通过场景生成合格汇总报告', () => {
  const rep = L.generateUnifiedReportData([], null, [], null, {}, new Set(), [], new Map(), {}, new Set());
  assert.strictEqual(rep.problemCount, 0);
  assert.ok(rep.rows[0][1].includes('全板走线及差分网络'));
  assert.ok(rep.rows[0][2].includes('全部通过'));
  assert.ok(rep.rows[0][3].includes('无需修改'));
});

console.log('== 单段 Item（Trace Seg / Arc Seg）与非走线 Item ==');
const TRACE_SEG_TXT = `Total 2 Items

Item 27                < Trace Seg >
  Set:                Trace
  Subset:             19IS08
  Net:                25_N
  Seg Length:         194.990000
  Seg: xy [20991.1100, 35481.6700]  xy [21186.1000, 35481.6700] Width (6.0000)

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 28                < Via >
  Origin-xy:          [22401.6900, 35517.7700]
  Net:                GND
  Padstack Name:      BGA_GND_pad1mil_0902
  Circle Drill:       3.9400
`;
t('< Trace Seg > 的 Seg Length 被识别：线长 194.99（旧版为 NaN，导致总线长判定整条失效）', () => {
  const recs = L.parseBlockText(TRACE_SEG_TXT);
  const r = recs.find(x => x.item === '27');
  if (!r) throw new Error('未解析到 Item 27');
  assert.ok(Math.abs(r.length - 194.99) < 1e-6, '线长应为 194.99，实际 ' + r.length);
});
t('< Via > 不计入走线记录（旧版会把过孔当成 0 长度走线）', () => {
  const recs = L.parseBlockText(TRACE_SEG_TXT);
  assert.strictEqual(recs.length, 1, '记录数应为 1，实际 ' + recs.length);
  assert.ok(!recs.some(r => r.item === '28'), 'Via 项不应出现在走线记录中');
});
t('无 Length / Seg Length 时按线段几何求和兜底', () => {
  const txt = `Item 5                < Trace >
  Subset:             02G01P
  Net:                105_P
  Seg: xy [0.0000, 0.0000]  xy [30.0000, 40.0000] Width (5.6000)
`;
  const r = L.parseBlockText(txt)[0];
  assert.ok(Math.abs(r.length - 50) < 1e-9, '3-4-5 三角形斜边应为 50，实际 ' + r.length);
});
t('多行 Seg Length 按段累加', () => {
  const txt = `Item 6                < Trace >
  Subset:             02G01P
  Net:                105_P
  Seg Length:         10.000000
  Seg: xy [0.0000, 0.0000]  xy [10.0000, 0.0000] Width (5.6000)
  Seg Length:         20.000000
  Seg: xy [10.0000, 0.0000]  xy [30.0000, 0.0000] Width (5.6000)
`;
  const r = L.parseBlockText(txt)[0];
  assert.ok(Math.abs(r.length - 30) < 1e-9, '累加应为 30，实际 ' + r.length);
});
t('总线长缺失不再把合规数据判成「不符合」：Trace Seg 文件配区间规则应通过', () => {
  const recs = L.parseBlockText(TRACE_SEG_TXT);
  const rule = { enabled: true, layer: '19IS08', widths: [6], widthsText: '6', lenMode: 'range', lenMin: 100, lenMax: 300, checkWidth: true, checkLen: true };
  const res = L.runChecks(recs, [rule], null, { checkWidth: true, checkLen: true, checkWidthLen: false, checkRadius: false, tol: 0.001 });
  const viol = res.recViol;
  assert.strictEqual(viol.size, 0, '不应有违规定，实际 ' + JSON.stringify([...viol.entries()]));
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
