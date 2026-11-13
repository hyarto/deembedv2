/* ============================================================================
 * engines-scale.bench.js —— 大盘数据下各引擎的解析 / 检查耗时与规模回归
 * 数据：把示例 TXT 平移复制 N 份（tests/helpers/synth-data.js），结果数量随份数线性放大，
 * 同时断言耗时上限，防止重构引入平方级退化。用法：node engines-scale.bench.js [份数，默认 60]
 * 基线（60 份，Node 20）：DFM 解析 ~25 ms / 检查 ~150 ms，铜皮解析 ~10 ms / 检查 ~15 ms，扇出 ~2.5 s
 * ========================================================================== */
'use strict';

const assert = require('assert');
const { readSample, replicate } = require('../helpers/synth-data');
const Dfm = require('../../packages/engines/dfm');
const Fanout = require('../../packages/engines/fanout');
const Copper = require('../../packages/engines/copper');
const Pour = require('../../packages/engines/pour');

const N = Number(process.argv[2] || 60);
const BUDGET_MS = { dfmParse: 500, dfmRun: 2000, copperParse: 500, pourParse: 1000, pourRun: 2000, fanout: 30000 };

function timed(label, budget, fn) {
  const t0 = process.hrtime.bigint();
  const result = fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ${label.padEnd(16)} ${ms.toFixed(0).padStart(7)} ms  (上限 ${budget} ms)`);
  assert.ok(ms <= budget, `${label} 耗时 ${ms.toFixed(0)} ms 超过上限 ${budget} ms`);
  return result;
}

const air = replicate(readSample('via_trace_airgap_sample.txt'), N);
const pour = replicate(readSample('铜皮数据示例.txt'), N * 5);
console.log(`合成数据：份数 ${N}，走线/过孔 ${(air.length / 1e6).toFixed(2)} MB，铜皮 ${(pour.length / 1e6).toFixed(2)} MB`);

const parsed = timed('DFM 解析', BUDGET_MS.dfmParse, () => Dfm.parseDfmItems(air, { gndPadDiameter: 7.906, signalPadDiameter: 9.94 }));
assert.strictEqual(parsed.vias.length, 26 * N, '过孔数应为样例的 N 倍');
assert.strictEqual(parsed.traces.length, 71 * N, '走线数应为样例的 N 倍');
const run = timed('DFM 检查', BUDGET_MS.dfmRun, () => Dfm.runDfmCheck(parsed.vias, parsed.traces, { minClearanceGnd: 6, minClearanceSignal: 6, gndPadDiameter: 7.906, signalPadDiameter: 9.94 }));
assert.strictEqual(run.failCount, 42 * N, '缺陷数应为样例 42 处的 N 倍');

timed('约束解析', BUDGET_MS.copperParse, () => Copper.parseBoardItems(air));

const elems = timed('铜皮解析', BUDGET_MS.pourParse, () => Pour.parsePcbElements(pour));
assert.ok(elems.shapes.length === 3 * N * 5, '铜皮数量应随份数放大');
timed('铜皮检查', BUDGET_MS.pourRun, () => Pour.runAllCopperChecks(pour, {}));

const lib = new Fanout.FanoutLibrary();
Fanout.getStandardPresetSchemes().forEach(s => lib.addScheme(s));
const fan = timed('扇出检查', BUDGET_MS.fanout, () => Fanout.runFanoutInspection(air, lib));
assert.strictEqual(fan.vias.length, 26 * N);

console.log('规模基准通过');
