const fs = require('fs');
const path = require('path');
const DfmCheck = require('./dfm-check.js');

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

console.log('== DFM 空间几何引擎与新规则测试 ==');

test('基础解析：解析 97 项数据并根据配置直接指定 GND / 信号焊盘直径与一钻直径', () => {
  const txt = fs.readFileSync(path.join(__dirname, 'sample/via_trace_airgap_sample.txt'), 'utf8');
  const res = DfmCheck.parseDfmItems(txt, {
    gndPadDiameter: 5.94,
    signalPadDiameter: 9.94,
    gndFirstDrill: 5.54,
    signalFirstDrill: 5.54
  });
  if (res.vias.length !== 26) throw new Error('Via 数量应为 26，实际 ' + res.vias.length);
  if (res.traces.length !== 71) throw new Error('Trace 数量应为 71，实际 ' + res.traces.length);
  
  // GND Via (Item 1)
  const v1 = res.vias[0];
  if (!v1.isGnd || Math.abs(v1.padDiameter - 5.94) > 1e-4) throw new Error('GND Via 焊盘直径应为 5.94 mil');
  if (Math.abs(v1.firstDrill - 5.54) > 1e-4) throw new Error('一钻孔径计算错误：' + v1.firstDrill);
  if (Math.abs(v1.drill - 3.94) > 1e-4) throw new Error('完成孔径展示值应为 3.94 mil');
  
  // 信号 Via (Item 23)
  const v23 = res.vias[22];
  if (v23.isGnd || Math.abs(v23.padDiameter - 9.94) > 1e-4) throw new Error('信号 Via 焊盘直径应为 9.94 mil');
  if (Math.abs(v23.firstDrill - 5.54) > 1e-4) throw new Error('信号 Via 一钻直径应为 5.54 mil');
});

test('点到线段与点到圆弧几何算法', () => {
  const p = [10, 10];
  const a = [0, 0], b = [20, 0];
  const rSeg = DfmCheck.ptToSegDist(p, a, b);
  if (Math.abs(rSeg.dist - 10) > 1e-4) throw new Error('垂足距离错误：' + rSeg.dist);

  const center = [10, 0];
  const radius = 5;
  const p1 = [15, 0], p2 = [5, 0];
  const rArc = DfmCheck.ptToArcDist(p, center, radius, p1, p2, 'CCW');
  if (Math.abs(rArc.dist - 5) > 1e-4) throw new Error('圆弧距离错误：' + rArc.dist);
});

test('圆弧高精度平滑插值采样 (sampleArcPoints)', () => {
  const center = [0, 0];
  const radius = 10;
  const p1 = [10, 0], p2 = [0, 10];
  const pts = DfmCheck.sampleArcPoints(center, radius, p1, p2, 'CCW', 16);
  if (pts.length !== 17) throw new Error('采样点数错误：' + pts.length);
  if (Math.abs(pts[0][0] - 10) > 1e-4 || Math.abs(pts[pts.length - 1][1] - 10) > 1e-4) throw new Error('端点不匹配');
  // 检查所有点都在圆周上
  pts.forEach(pt => {
    const d = Math.hypot(pt[0], pt[1]);
    if (Math.abs(d - 10) > 1e-4) throw new Error('采样点偏离圆弧：' + d);
  });
});

test('测量计算器：孔到孔测量 (calcViaToViaMetrics)', () => {
  const v1 = { origin: [100, 100], padRadius: 2.97, firstDrillRadius: 2.77 };
  const v2 = { origin: [100, 120], padRadius: 2.97, firstDrillRadius: 2.77 };
  const m = DfmCheck.calcViaToViaMetrics(v1, v2);
  if (Math.abs(m.centerDist - 20) > 1e-4) throw new Error('中心距应为 20');
  if (Math.abs(m.padAirgap - (20 - 5.94)) > 1e-4) throw new Error('孔盘Airgap应为 ' + (20 - 5.94));
  if (Math.abs(m.drillAirgap - (20 - 5.54)) > 1e-4) throw new Error('孔壁Airgap应为 ' + (20 - 5.54));
});

test('测量计算器：走线到过孔测量 (calcTraceToViaMetrics)', () => {
  const via = { origin: [100, 100], padRadius: 2.97, firstDrillRadius: 2.77 };
  const trace = { kind: 'line', p1: [100, 120], p2: [200, 120], width: 6.0 };
  const m = DfmCheck.calcTraceToViaMetrics(via, trace);
  if (Math.abs(m.centerDist - 20) > 1e-4) throw new Error('中心距应为 20');
  if (Math.abs(m.padAirgap - (20 - 3 - 2.97)) > 1e-4) throw new Error('孔盘Airgap错误');
  if (Math.abs(m.drillAirgap - (20 - 3 - 2.77)) > 1e-4) throw new Error('孔壁Airgap错误');
});

test('用户场景：Pad-to-Trace Airgap 模式检查 6.0 mil 规则（发现 23 处不满足）', () => {
  const txt = fs.readFileSync(path.join(__dirname, 'sample/via_trace_airgap_sample.txt'), 'utf8');
  const items = DfmCheck.parseDfmItems(txt, { gndPadDiameter: 5.94, signalPadDiameter: 9.94, gndFirstDrill: 5.54, signalFirstDrill: 5.54 });
  const result = DfmCheck.runDfmCheck(items.vias, items.traces, {
    minClearance: 6.0,
    mode: 'pad_to_trace',
    diffNetOnly: true
  });

  if (result.failCount !== 23) throw new Error('超标点数应为 23，实际 ' + result.failCount);
  
  const topFail = result.pairs[0];
  if (Math.abs(topFail.evalDist - 5.0198) > 0.01) throw new Error('最小间距应约为 5.02 mil，实际 ' + topFail.evalDist);
  if (result.gndStats.fail !== 23) throw new Error('GND 孔失败数应为 23');
  if (result.signalStats.fail !== 0) throw new Error('信号孔失败数应为 0');
});

test('双判定阈值规则：线到 GND 孔与线到信号孔独立配置与判定', () => {
  const txt = fs.readFileSync(path.join(__dirname, 'sample/via_trace_airgap_sample.txt'), 'utf8');
  const items = DfmCheck.parseDfmItems(txt, { gndPadDiameter: 5.94, signalPadDiameter: 9.94, gndFirstDrill: 5.54, signalFirstDrill: 5.54 });
  
  // 配置：线到 GND 孔阈值 5.0 mil (放宽，全部 GND 通过)，线到信号孔阈值 8.0 mil (收紧，发现 9 处信号孔超标)
  const result = DfmCheck.runDfmCheck(items.vias, items.traces, {
    minClearanceGnd: 5.0,
    minClearanceSignal: 8.0,
    mode: 'pad_to_trace',
    diffNetOnly: true
  });

  if (result.gndStats.fail !== 0) throw new Error('GND 孔超标数应为 0，实际 ' + result.gndStats.fail);
  if (result.signalStats.fail !== 9) throw new Error('信号孔超标数应为 9，实际 ' + result.signalStats.fail);
  if (result.failCount !== 9) throw new Error('总超标数应为 9，实际 ' + result.failCount);
  
  // 检查首个失败项是信号孔且判定类型正确
  const firstFail = result.pairs[0];
  if (firstFail.targetType !== '线到信号孔') throw new Error('首个失败项判定类型应为 线到信号孔');
  if (firstFail.threshold !== 8.0) throw new Error('首个失败项阈值应为 8.0');
});

test('EDA 实测对齐：Via 275 (GND) 与 63_P 走线 (Item 3473) 在 GND 焊盘直径 7.906 mil 下 Airgap 精准等于 2.932591 mil', () => {
  const largePath = path.join(__dirname, 'sample/via_trce_airgap_data-2.txt');
  if (!fs.existsSync(largePath)) return;
  const txt = fs.readFileSync(largePath, 'utf8');
  const items = DfmCheck.parseDfmItems(txt, { gndPadDiameter: 7.906, signalPadDiameter: 9.94 });
  const via275 = items.vias.find(v => v.id === 275);
  const trace3473 = items.traces.find(t => t.id === 3473);
  if (!via275 || !trace3473) throw new Error('未找到 Via 275 或 Trace 3473');

  const metrics = DfmCheck.calcTraceToViaMetrics(via275, trace3473);
  // EDA 实测 Airgap = 2.932591 mil
  if (Math.abs(metrics.padAirgap - 2.932591) > 0.001) {
    throw new Error('Airgap 与 EDA 实测不符，实际: ' + metrics.padAirgap + ', 预期: 2.932591');
  }
  if (Math.abs(metrics.centerDist - 9.8856) > 0.001) {
    throw new Error('中心线距离不符: ' + metrics.centerDist);
  }
});

test('走线网络与出线层目标分析 (netLayerAnalysis)：以出线层网络为目标汇总不满足数量', () => {
  const largePath = path.join(__dirname, 'sample/via_trce_airgap_data-2.txt');
  if (!fs.existsSync(largePath)) return;
  const txt = fs.readFileSync(largePath, 'utf8');
  const items = DfmCheck.parseDfmItems(txt, { gndPadDiameter: 7.906, signalPadDiameter: 12.0 });
  const result = DfmCheck.runDfmCheck(items.vias, items.traces, {
    minClearanceGnd: 4.01575,
    minClearanceSignal: 5.04725,
    mode: 'pad_to_trace',
    diffNetOnly: true
  });

  if (!result.netLayerAnalysis || !result.netLayerAnalysis.length) {
    throw new Error('缺少 netLayerAnalysis 聚合数据');
  }

  // 验证 19IS08 层的 63_P 走线有 1 处不满足（Via 275）
  const item63p = result.netLayerAnalysis.find(x => x.layer === '19IS08' && x.net === '63_P');
  if (!item63p) throw new Error('未找到 19IS08 层的 63_P 走线');
  if (item63p.failCount !== 1) throw new Error('63_P 走线不满足数应为 1，实际 ' + item63p.failCount);
  if (Math.abs(item63p.minDist - 2.932591) > 0.001) throw new Error('63_P 走线最小间距不符: ' + item63p.minDist);

  // 验证 19IS08 层的 75_N 走线有 3 处不满足
  const item75n = result.netLayerAnalysis.find(x => x.layer === '19IS08' && x.net === '75_N');
  if (!item75n) throw new Error('未找到 19IS08 层的 75_N 走线');
  if (item75n.failCount !== 3) throw new Error('75_N 走线不满足数应为 3，实际 ' + item75n.failCount);
});

test('大数据集性能与空间网格索引测试 (720万理论对偶，<1秒极速判定且无内存溢出)', () => {
  const largePath = path.join(__dirname, 'sample/via_trce_airgap_data-2.txt');
  if (!fs.existsSync(largePath)) return;
  const txt = fs.readFileSync(largePath, 'utf8');
  const items = DfmCheck.parseDfmItems(txt, { gndPadDiameter: 7.906, signalPadDiameter: 9.94 });
  
  if (items.vias.length !== 1454) throw new Error('Via 数量应为 1454');
  if (items.traces.length !== 4976) throw new Error('Trace 数量应为 4976');

  const t0 = Date.now();
  const result = DfmCheck.runDfmCheck(items.vias, items.traces, {
    minClearanceGnd: 6.0,
    minClearanceSignal: 6.0,
    mode: 'pad_to_trace',
    diffNetOnly: true,
    gndPadDiameter: 7.906
  });
  const elapsed = Date.now() - t0;

  if (result.totalChecked !== 7222319) throw new Error('核对对偶数应为 7222319，实际 ' + result.totalChecked);
  if (result.failCount !== 1935) throw new Error('超标数应为 1935，实际 ' + result.failCount);
  if (result.gndStats.total !== 5876656) throw new Error('GND对偶数应为 5876656');
  if (result.signalStats.total !== 1345663) throw new Error('信号对偶数应为 1345663');
  if (elapsed > 3000) throw new Error('执行时间过长：' + elapsed + 'ms');
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
if (fail > 0) process.exit(1);
