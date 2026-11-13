/* ============================================================================
 * engine-determinism.test.js —— 五引擎确定性（同输入连跑两次输出逐字节一致）
 * 重构常见暗伤：依赖 Map/Set 插入顺序、对象键序、就地变异输入缓存，
 * 导致同一输入两次运行输出不同。本文件对五个引擎各跑一次「双跑对拍」，
 * 并额外断言引擎不会就地变异解析产物（复跑使用同一解析结果仍然一致）。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const SAMPLE = path.join(__dirname, '..', '..', 'sample');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (err) { console.error(`  FAIL  ${name} -> ${err.message}`); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// Map/Set/NaN 友好的稳定序列化（对象键排序，消除键序差异之外的任何抖动）。
// elapsedMs / duration 类耗时遥测键不参与对拍：它们是运行开销，不是判定结果。
const TELEMETRY_KEY = /elapsed|duration|tookMs/i;
function stable(v) {
  if (v instanceof Map) {
    return { __map: [...v.entries()].map(([k, val]) => [String(k), stable(val)]).sort((a, b) => a[0] < b[0] ? -1 : 1) };
  }
  if (v instanceof Set) return { __set: [...v].map(x => JSON.stringify(stable(x))).sort() };
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).filter(k => !TELEMETRY_KEY.test(k)).sort()) o[k] = stable(v[k]);
    return o;
  }
  if (typeof v === 'number' && !isFinite(v)) return String(v);
  return v;
}
const snap = v => JSON.stringify(stable(v));

function readSample(name) { return fs.readFileSync(path.join(SAMPLE, name), 'utf8'); }

console.log('== 五引擎确定性双跑对拍 ==');

test('走线引擎：SAMPLE_TEXT 两次解析 + runChecks 输出一致', () => {
  const Trace = require('../../packages/engines/trace');
  const rules = [
    { enabled: true, layer: '02G01P', widthsText: '5.6', widthCombos: Trace.parseWidthCombos('5.6'), lenMode: 'range', lengths: [], lenMin: 1000, lenMax: 2500 },
    { enabled: true, layer: '02G03P', widthsText: '4.0', widthCombos: Trace.parseWidthCombos('4.0'), lenMode: 'off', lengths: [], lenMin: NaN, lenMax: NaN }
  ];
  const def = { enabled: false };
  const run = () => {
    const recs = Trace.parseBlockText(Trace.SAMPLE_TEXT);
    return Trace.runChecks(recs, rules, def, { tol: 0.001, checkWidth: true, checkLen: true });
  };
  const a = run(), b = run();
  assert(snap(a) === snap(b), '两次 runChecks 结果不一致');
  // 同一解析结果复跑也不得变化（防御就地变异）
  const recs = Trace.parseBlockText(Trace.SAMPLE_TEXT);
  const r1 = snap(Trace.runChecks(recs, rules, def, { tol: 0.001, checkWidth: true, checkLen: true }));
  const r2 = snap(Trace.runChecks(recs, rules, def, { tol: 0.001, checkWidth: true, checkLen: true }));
  assert(r1 === r2, '同一解析结果复跑不一致（引擎疑似就地变异输入）');
});

test('DFM 引擎：97 项夹具两次检查输出一致（42 缺陷口径）', () => {
  const DfmCheck = require('../../packages/engines/dfm');
  const txt = readSample('via_trace_airgap_sample.txt');
  const opts = { gndPadDiameter: 7.906, signalPadDiameter: 9.94, gndFirstDrill: 5.54, signalFirstDrill: 5.54 };
  const run = () => {
    const items = DfmCheck.parseDfmItems(txt, opts);
    return DfmCheck.runDfmCheck(items.vias, items.traces, {
      gndThreshold: 6, signalThreshold: 6, gndPadDiameter: 7.906, signalPadDiameter: 9.94, schematicLayers: 18, boardLayers: 18
    });
  };
  const a = run(), b = run();
  assert(snap(a) === snap(b), '两次 runDfmCheck 结果不一致');
});

test('铜皮约束引擎：解析 + runCopperCheck 双跑一致', () => {
  const CopperCheck = require('../../packages/engines/copper/copper-engine.js');
  const txt = readSample('铜皮数据示例.txt');
  const run = () => {
    const items = CopperCheck.parseBoardItems(txt);
    return CopperCheck.runCopperCheck(items, [], { layerCount: 18 });
  };
  const a = run(), b = run();
  assert(snap(a) === snap(b), '两次 runCopperCheck 结果不一致');
});

test('扇出引擎：26 孔夹具 + 标准方案库两次检查输出一致', () => {
  const FanoutChecker = require('../../packages/engines/fanout');
  const txt = readSample('via_trace_airgap_sample.txt');
  const run = () => {
    const lib = new FanoutChecker.FanoutLibrary();
    lib.loadStandardPresets();
    return FanoutChecker.runFanoutInspection(txt, lib, { clusterThreshold: 78.740157, distanceTolerance: 2.0 });
  };
  const a = run(), b = run();
  assert(a.success && b.success, '扇出检查未成功：' + (a.errorMessage || b.errorMessage || ''));
  assert(snap(a) === snap(b), '两次 runFanoutInspection 结果不一致');
});

test('铜皮五项引擎：runAllCopperChecks 双跑一致', () => {
  const Pour = require('../../packages/engines/pour');
  const txt = readSample('铜皮数据示例.txt');
  const run = () => Pour.runAllCopperChecks(txt, { smallCopperAreaThreshold: 500.0, minArcRadius: 10.0 });
  const a = run(), b = run();
  assert(a.success && b.success, '铜皮检查未成功');
  assert(snap(a) === snap(b), '两次 runAllCopperChecks 结果不一致');
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
