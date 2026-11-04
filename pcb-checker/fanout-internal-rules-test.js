/**
 * fanout-internal-rules-test.js
 * 扇出方案库「内部规则检查」引擎单元测试
 *
 * 覆盖：规则参数解析 / 规范化、层跨度解析与逐层孔分布、叠孔柱豁免、
 *       对称性判定（中心对称 / 轴对称 / 不对称）、三条规则的判定与统计。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const FanoutChecker = require('./fanout-check.js');

const {
  FanoutScheme,
  parseMultiSchemeTxt,
  DEFAULT_INTERNAL_RULES,
  parseNominalList,
  normalizeInternalRuleParams,
  matchNominal,
  parseLayerSpanFromPadstackName,
  parseViaTextLayerSpan,
  parseViaLayerRange,
  buildSchemeLayerView,
  resolveStackColumns,
  checkPointSetSymmetry,
  checkSchemeInternalRules,
  summarizeSchemeInternalRules
} = FanoutChecker;

console.log('== 扇出方案内部规则检查引擎单元测试 ==');

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

const SAMPLE_PATH = path.join(__dirname, 'sample', '盲埋孔扇出示例.txt');

function loadSampleScheme() {
  const txt = fs.readFileSync(SAMPLE_PATH, 'utf8');
  const schemes = parseMultiSchemeTxt(txt, 0);
  assert.strictEqual(schemes.length, 1, '样例文件应解析出 1 套方案');
  return new FanoutScheme(schemes[0]);
}

/* ---------------- 1. 参数 ---------------- */
test('标称值集合解析：逗号 / 中文分隔 / 数组 / 空值回退', () => {
  assert.deepStrictEqual(parseNominalList('0.45,0.5,0.6', []), [0.45, 0.5, 0.6]);
  assert.deepStrictEqual(parseNominalList('0.8 / 0.45、0.45', []), [0.45, 0.8], '去重且升序');
  assert.deepStrictEqual(parseNominalList([400, 350], []), [350, 400]);
  assert.deepStrictEqual(parseNominalList('', [350, 400, 450]), [350, 400, 450], '空值回退默认');
  assert.deepStrictEqual(parseNominalList('abc', [1, 2]), [1, 2], '无数字回退默认');
});

test('规则参数规范化：默认值与字符串输入', () => {
  const d = normalizeInternalRuleParams();
  assert.deepStrictEqual(d.signalPitchMm, [0.45, 0.5, 0.6, 0.7, 0.8]);
  assert.deepStrictEqual(d.gndToSignalUm, [350, 400, 450]);
  assert.strictEqual(d.distanceTolMm, 0.02);
  assert.strictEqual(d.symmetryTolMm, 0.02);
  assert.strictEqual(d.stackColumnTolMm, 0.05);
  assert.strictEqual(d.pitchScope, 'all');

  const custom = normalizeInternalRuleParams({
    signalPitchMm: '0.475,0.5',
    gndToSignalUm: '425,600',
    distanceTolMm: '0.005',
    symmetryTolMm: '0.01',
    stackColumnTolMm: '0.02',
    pitchScope: 'sameLayer'
  });
  assert.deepStrictEqual(custom.signalPitchMm, [0.475, 0.5]);
  assert.deepStrictEqual(custom.gndToSignalUm, [425, 600]);
  assert.strictEqual(custom.distanceTolMm, 0.005);
  assert.strictEqual(custom.pitchScope, 'sameLayer');

  assert.deepStrictEqual(DEFAULT_INTERNAL_RULES.signalPitchMm, [0.45, 0.5, 0.6, 0.7, 0.8]);
});

test('命中标称值判定：容差内命中最近标称值，超差给出偏差', () => {
  const hit = matchNominal(0.492, [0.45, 0.5, 0.6], 0.02);
  assert.strictEqual(hit.hit, true);
  assert.strictEqual(hit.nominal, 0.5);
  assert.ok(Math.abs(hit.deviation - 0.008) < 1e-9);

  const miss = matchNominal(0.55, [0.45, 0.5, 0.6], 0.02);
  assert.strictEqual(miss.hit, false);
  assert.strictEqual(miss.nominal, 0.6);
  assert.ok(Math.abs(miss.deviation - 0.05) < 1e-9);
});

/* ---------------- 2. 层跨度 ---------------- */
test('层跨度解析：Defined from 优先、名称后缀回退、无信息返回 null', () => {
  const span = parseViaTextLayerSpan('Padstack Defined from 05G02P to 10G07P\nShape: 6 (05G02P 06G03P 07G04P 08G05P 09G06P 10G07P)');
  assert.strictEqual(span.layerStart, 5);
  assert.strictEqual(span.layerEnd, 10);
  assert.strictEqual(span.layerSource, 'defined');

  assert.deepStrictEqual(parseLayerSpanFromPadstackName('PTH-GND-150drill-ring0_L5_L10'), { start: 5, end: 10 });
  assert.strictEqual(parseLayerSpanFromPadstackName('SMA_Bot-L19_d2m6mil_via-0902'), null);

  assert.deepStrictEqual(parseViaLayerRange({ padstack: 'X_L1_L5' }), { start: 1, end: 5, source: 'padstack-name' });
  assert.strictEqual(parseViaLayerRange({ padstack: 'STANDARD_VIA' }), null);
});

test('逐层孔分布：按层跨度展开，统计每层活跃孔', () => {
  const vias = [
    { x: 0, y: 0, net: 'GND', padstack: 'X_L1_L3' },
    { x: 10, y: 0, net: 'SIG_A', padstack: 'X_L2_L4' }
  ];
  const view = buildSchemeLayerView(vias);
  assert.strictEqual(view.layerInfoAvailable, true);
  assert.deepStrictEqual(view.layers.map(l => l.layer), [1, 2, 3, 4]);
  assert.deepStrictEqual(view.layers.map(l => l.viaIndices.length), [1, 2, 2, 1]);
  assert.deepStrictEqual(view.layers[1].viaIndices, [0, 1]);

  const noInfo = buildSchemeLayerView([{ x: 0, y: 0, padstack: 'STANDARD_VIA' }]);
  assert.strictEqual(noInfo.layerInfoAvailable, false);
  assert.strictEqual(noInfo.layers.length, 0);
});

/* ---------------- 3. 叠孔柱 ---------------- */
test('叠孔柱识别：同网同点位算同一柱，异网同点位不算', () => {
  const vias = [
    { x: 0, y: 0, net: 'GND', padstack: 'X_L1_L5' },
    { x: 0.5, y: 0, net: 'GND', padstack: 'X_L5_L10' },
    { x: 0, y: 0, net: 'SIG_A', padstack: 'X_L10_L13' },
    { x: 40, y: 0, net: 'GND', padstack: 'X_L1_L5' }
  ];
  const stack = resolveStackColumns(vias, 0.05);
  assert.strictEqual(stack.columns.length, 1);
  assert.deepStrictEqual(stack.columns[0].viaIndices, [0, 1]);
  assert.strictEqual(stack.columnOf[2], -1, '异网同点位不得当成同一钻孔柱');
  assert.strictEqual(stack.columnOf[3], -1);
});

/* ---------------- 4. 对称性 ---------------- */
test('对称性：圆环判定为中心对称，等边三角判定为轴对称', () => {
  const ring = [];
  for (let i = 0; i < 8; i++) ring.push({ x: Math.cos(i * Math.PI / 4) * 400, y: Math.sin(i * Math.PI / 4) * 400 });
  const r = checkPointSetSymmetry(ring, 1);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.type, 'centro');

  const tri = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 200, y: 346.41 }];
  const t = checkPointSetSymmetry(tri, 1);
  assert.strictEqual(t.ok, true);
  assert.strictEqual(t.type, 'axis');
});

test('对称性：不规则点集判不对称，微扰超差也会被抓出', () => {
  const rnd = [{ x: 0, y: 0 }, { x: 400, y: 39 }, { x: 118, y: 276 }, { x: 354, y: 354 }, { x: 79, y: 157 }];
  assert.strictEqual(checkPointSetSymmetry(rnd, 1).ok, false);

  const ring = [];
  for (let i = 0; i < 6; i++) ring.push({ x: Math.cos(i * Math.PI / 3) * 400, y: Math.sin(i * Math.PI / 3) * 400 });
  assert.strictEqual(checkPointSetSymmetry(ring, 1).ok, true);
  // 沿垂直于对称轴的方向挪 40mil(≈0.1mm)：会破坏该轴镜像，且不存在其它可用对称轴
  const broken = ring.map((p, i) => i === 0 ? { x: p.x, y: p.y + 40 } : p);
  const res = checkPointSetSymmetry(broken, 1);
  assert.strictEqual(res.ok, false, '0.1mm 级微扰超出 0.0254mm 容差应判不对称');
  assert.ok(res.maxDeviationMil > 1);
});

/* ---------------- 5. 三条规则：样例实测 ---------------- */
test('样例 43 孔：信号孔距 9 对/违例 4、地孔 37 个/违例 6、13 层全部对称', () => {
  const scheme = loadSampleScheme();
  assert.strictEqual(scheme.viaCount, 43);
  const r = checkSchemeInternalRules(scheme, {});

  assert.strictEqual(r.layerInfoAvailable, true);
  assert.strictEqual(r.layers.length, 13, '层栈 1..13');

  assert.strictEqual(r.totals.signalCount, 6);
  assert.strictEqual(r.totals.gndCount, 37);
  assert.strictEqual(r.pitch.checked, 9, '6 个信号孔共 15 对，其中 6 对同柱豁免');
  assert.strictEqual(r.pitch.violations.length, 4);
  assert.strictEqual(r.pitch.stackExemptPairs, 6);
  assert.strictEqual(r.totals.stackColumns, 12);

  assert.strictEqual(r.gndToSignal.checked, 37);
  assert.strictEqual(r.gndToSignal.violations.length, 6);

  assert.strictEqual(r.symmetry.layers.length, 13);
  assert.strictEqual(r.symmetry.failLayers, 0, '样例每层孔分布都是轴对称的');

  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.totals.violations, 10);
});

test('样例违例明细：实测值 / 最近标称值 / 偏差 均可追溯', () => {
  const r = checkSchemeInternalRules(loadSampleScheme(), {});
  const first = r.pitch.violations[0];
  assert.ok(first.actualMm > 0.47 && first.actualMm < 0.48, `实际 ${first.actualMm}mm`);
  assert.ok(first.nominalMm === 0.45 || first.nominalMm === 0.5);
  assert.ok(first.deviationMm > 0.02, '偏差应超过容差');
  assert.ok(typeof first.viaALabel === 'string' && first.viaALabel.startsWith('#'));
  assert.ok(typeof first.layerLabel === 'string' && first.layerLabel.length > 0);

  const g = r.gndToSignal.violations[0];
  assert.ok(g.actualUm > 0 && g.nominalUm > 0);
  assert.ok(g.deviationUm > 20, 'µm 容差按 mm 容差 ×1000 换算');
});

test('参数可改：把标称值改成 0.475mm / 425µm 后样例信号与地孔间距全通过', () => {
  const scheme = loadSampleScheme();
  const r = checkSchemeInternalRules(scheme, {
    signalPitchMm: [0.475],
    gndToSignalUm: [424.9, 425, 600],
    distanceTolMm: 0.05
  });
  assert.strictEqual(r.pitch.violations.length, 0, '标称值改为 0.475 后应无信号孔距违例');
  assert.strictEqual(r.gndToSignal.violations.length, 0);
  assert.strictEqual(r.ok, true);
});

test('间距范围可切：sameLayer 只查同层共存孔对，检查对数少于 all', () => {
  const scheme = loadSampleScheme();
  const all = checkSchemeInternalRules(scheme, { pitchScope: 'all' });
  const same = checkSchemeInternalRules(scheme, { pitchScope: 'sameLayer' });
  assert.ok(same.pitch.checked < all.pitch.checked, `${same.pitch.checked} < ${all.pitch.checked}`);
  same.pitch.violations.forEach(v => assert.notStrictEqual(v.layerLabel, '跨层'));
});

/* ---------------- 6. 通过 / 无层信息 / 摘要 ---------------- */
test('合规方案（0.5mm 差分 + 400µm 伴随地孔 + 中心对称）判定通过', () => {
  const tol = 0.5 / 0.0254;
  const vias = [
    { id: 1, x: 0, y: 0, net: 'SIG_P', padstack: 'HDI-SIG-045drill_L1_L5' },
    { id: 2, x: 0, y: tol, net: 'SIG_N', padstack: 'HDI-SIG-045drill_L1_L5' },
    // 400µm = 0.4mm 处的伴随地孔（上下左右四颗，构成中心对称 + 轴对称）
    { id: 3, x: 0.4 / 0.0254, y: 0, net: 'GND', padstack: 'HDI-GND-045drill_L1_L5' },
    { id: 4, x: -0.4 / 0.0254, y: 0, net: 'GND', padstack: 'HDI-GND-045drill_L1_L5' },
    { id: 5, x: 0, y: tol + 0.4 / 0.0254, net: 'GND', padstack: 'HDI-GND-045drill_L1_L5' },
    { id: 6, x: 0, y: -0.4 / 0.0254, net: 'GND', padstack: 'HDI-GND-045drill_L1_L5' }
  ];
  const scheme = new FanoutScheme({ name: 'rule-ok', vias });
  const r = checkSchemeInternalRules(scheme, {});
  assert.strictEqual(r.pitch.violations.length, 0, JSON.stringify(r.pitch.violations));
  assert.strictEqual(r.gndToSignal.violations.length, 0, JSON.stringify(r.gndToSignal.violations));
  assert.strictEqual(r.symmetry.failLayers, 0, JSON.stringify(r.symmetry.layers.map(l => [l.layerLabel, l.type])));
  assert.strictEqual(r.ok, true);
});

test('无层信息方案：退回整体投影查对称性并标注估算', () => {
  const scheme = new FanoutScheme({
    name: 'no-layer',
    vias: [
      { id: 1, x: 0, y: 0, net: 'SIG_A', padstack: 'SMA_L2_d2m6mil_via_0902' },
      { id: 2, x: 0, y: 20, net: 'SIG_B', padstack: 'SMA_L2_d2m6mil_via_0902' }
    ]
  });
  const r = checkSchemeInternalRules(scheme, {});
  assert.strictEqual(r.layerInfoAvailable, false);
  assert.strictEqual(r.symmetry.estimated, true);
  assert.strictEqual(r.symmetry.layers.length, 1);
  assert.strictEqual(r.symmetry.layers[0].layerLabel, '整体投影');
  assert.ok(summarizeSchemeInternalRules(r).includes('无层信息'));
});

test('摘要文字包含三类规则与叠孔柱豁免数', () => {
  const r = checkSchemeInternalRules(loadSampleScheme(), {});
  const text = summarizeSchemeInternalRules(r);
  assert.ok(text.includes('信号孔距 9 对'), text);
  assert.ok(text.includes('地孔距 37 个'), text);
  assert.ok(text.includes('逐层对称 13 层'), text);
  assert.ok(text.includes('叠孔柱 12 处已豁免'), text);
});

test('方案序列化往返：层跨度不丢，规则结果一致', () => {
  const scheme = loadSampleScheme();
  const json = scheme.toJSON();
  assert.strictEqual(json.vias[0].layerStart, 5);
  assert.strictEqual(json.vias[0].layerEnd, 10);

  const again = new FanoutScheme(json);
  const a = checkSchemeInternalRules(scheme, {});
  const b = checkSchemeInternalRules(again, {});
  assert.deepStrictEqual(b.totals, a.totals);
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
assert.strictEqual(fail, 0);
