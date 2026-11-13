const fs = require('fs');
const path = require('path');
const DfmCheck = require("../../packages/engines/dfm");

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
  const txt = fs.readFileSync(path.join(__dirname, '../../sample/via_trace_airgap_sample.txt'), 'utf8');
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
  const txt = fs.readFileSync(path.join(__dirname, '../../sample/via_trace_airgap_sample.txt'), 'utf8');
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
  const txt = fs.readFileSync(path.join(__dirname, '../../sample/via_trace_airgap_sample.txt'), 'utf8');
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
  const largePath = path.join(__dirname, '../../sample/via_trce_airgap_data-2.txt');
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
  const largePath = path.join(__dirname, '../../sample/via_trce_airgap_data-2.txt');
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
  const largePath = path.join(__dirname, '../../sample/via_trce_airgap_data-2.txt');
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


// ---------------------------------------------------------------------------
// 非圆形焊盘：矩形 / 长圆 / 圆角矩形（精确几何，不再一律当外接圆）
// ---------------------------------------------------------------------------
const TINY_TXT = `Total 2 Items

Item 1                < Via >
  Origin-xy: [0.0000, 0.0000]
  Padstack Name: GND_TEST
  Net: GND
  Circle Drill: 3.9400

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 2                < Trace >
  Subset: 01G01P
  Net: SIG_A
  Type: Seg
  Seg Length: 100.0000
  xy [0.0000, 20.0000] xy [100.0000, 20.0000] Width (4.0000)
`;

function runTiny(padOpts, extraOpts) {
  const parsed = DfmCheck.parseDfmItems(TINY_TXT, Object.assign({
    gndPadDiameter: 20, signalPadDiameter: 20,
    gndFirstDrill: 3.94, signalFirstDrill: 3.94
  }, padOpts));
  return DfmCheck.runDfmCheck(parsed.vias, parsed.traces, Object.assign({
    minClearanceGnd: 0.1, minClearanceSignal: 0.1,
    mode: 'pad_to_trace', diffNetOnly: true
  }, extraOpts));
}

test('矩形焊盘 20×8：airgap=14 mil（按真实长宽，而非外接圆 r=10 的 8 mil）', () => {
  const rect = runTiny({ gndPad: { kind: 'rect', w: 20, h: 8 } });
  const circle = runTiny({ gndPad: { kind: 'circle', w: 20 } });
  const p1 = rect.pairs[0], p2 = circle.pairs[0];
  if (Math.abs(p1.evalDist - 14) > 1e-6) throw new Error('矩形焊盘应得 14，实得 ' + p1.evalDist);
  if (Math.abs(p2.evalDist - 8) > 1e-6) throw new Error('圆形对照应得 8，实得 ' + p2.evalDist);
  if (p1.padShapeKind !== 'rect') throw new Error('padShapeKind 未标记: ' + p1.padShapeKind);
});

test('矩形焊盘旋转 90°：由 20×8 变为 8×20，airgap=8 mil', () => {
  const res = runTiny({ gndPad: { kind: 'rect', w: 20, h: 8, rot: 90 } });
  const p = res.pairs[0];
  if (Math.abs(p.evalDist - 8) > 1e-6) throw new Error('旋转 90° 应得 8，实得 ' + p.evalDist);
});

test('长圆焊盘 20×8：与矩形同尺寸但 14 mil 与 6 mil 分别为长轴/短轴方向', () => {
  const res = runTiny({ gndPad: { kind: 'oblong', w: 20, h: 8 } });
  const p = res.pairs[0];
  // 长圆在高 8 的方向上半径 4 → 20-4-2=14（与矩形一致，因为此方向是长轴侧边）
  if (Math.abs(p.evalDist - 14) > 1e-6) throw new Error('长圆应得 14，实得 ' + p.evalDist);
});

test('非圆焊盘不会因阈值不同而漏判：rect 14 mil 在阈值 12 下通过、在阈值 18 下超标', () => {
  const pass = runTiny({ gndPad: { kind: 'rect', w: 20, h: 8 } }, { minClearanceGnd: 12 });
  const fail = runTiny({ gndPad: { kind: 'rect', w: 20, h: 8 } }, { minClearanceGnd: 18 });
  if (pass.pairs[0].status !== '满足') throw new Error('阈值 12 应满足');
  if (fail.pairs[0].status !== '不满足') throw new Error('阈值 18 应不满足');
});

test('非圆焊盘测量接口（calcTraceToViaMetrics）与检查结果一致', () => {
  const parsed = DfmCheck.parseDfmItems(TINY_TXT, {
    gndPadDiameter: 20, signalPadDiameter: 20,
    gndPad: { kind: 'rect', w: 20, h: 8 }, signalPad: { kind: 'rect', w: 20, h: 8 }
  });
  const via = parsed.vias[0], trace = parsed.traces[0];
  const m = DfmCheck.calcTraceToViaMetrics(via, trace);
  if (Math.abs(m.padAirgap - 14) > 1e-6) throw new Error('测量面板应得 14，实得 ' + m.padAirgap);
  if (Math.abs(m.centerDist - 20) > 1e-9) throw new Error('中心距应为 20');
});

test('非圆焊盘性能：2300 组对偶的矩形焊盘检查 < 2s', () => {
  const vias = [];
  for (let i = 0; i < 46; i++) {
    vias.push({ id: i + 1, type: 'via', origin: [i * 50, 0], net: i % 2 ? 'GND' : 'SIG_' + i,
                isGnd: i % 2 === 0, padShape: { kind: 'roundrect', w: 14, h: 8, corner: 2 },
                padDiameter: 14, padRadius: 7, firstDrillRadius: 1.97, firstDrill: 3.94 });
  }
  const traces = [];
  for (let i = 0; i < 50; i++) {
    traces.push({ id: 1000 + i, type: 'trace', kind: 'line', subset: '01G01P', net: 'NET_' + i,
                  p1: [-200, 30 + i * 2], p2: [2400, 30 + i * 2], width: 4, len: 2600 });
  }
  const t0 = Date.now();
  const res = DfmCheck.runDfmCheck(vias, traces, { minClearanceGnd: 6, minClearanceSignal: 6,
    mode: 'pad_to_trace', diffNetOnly: true });
  const ms = Date.now() - t0;
  if (!res.totalChecked) throw new Error('未产生对偶');
  if (ms > 2000) throw new Error('非圆焊盘路径过慢: ' + ms + ' ms');
  console.log(`        ${res.totalChecked.toLocaleString()} 对偶 / ${ms} ms`);
});

test('叠层编号与 Padstack Defined 解析：精准识别通孔 / 顶底盲孔 / 内层埋孔', () => {
  if (DfmCheck.parseLayerIndex('Top') !== 1) throw new Error('Top 层号应为 1');
  if (DfmCheck.parseLayerIndex('Bottom') !== DfmCheck.BOTTOM_LAYER_INDEX) throw new Error('Bottom 层号应为 BOTTOM_LAYER_INDEX');
  if (DfmCheck.parseLayerIndex('10G07P') !== 10) throw new Error('10G07P 层号应为 10');
  if (DfmCheck.parseLayerIndex('13G09P') !== 13) throw new Error('13G09P 层号应为 13');
  if (DfmCheck.parseLayerIndex('L12') !== 12) throw new Error('L12 层号应为 12');
  if (DfmCheck.parseLayerIndex('12IS05') !== 12) throw new Error('12IS05 层号应为 12');

  const buried = DfmCheck.parseViaLayerSpan('  Padstack Defined from 10G07P to 13G09P\n');
  if (buried.viaSpanType !== 'buried' || buried.minLayerNum !== 10 || buried.maxLayerNum !== 13) {
    throw new Error('10G07P to 13G09P 应识别为 L10-L13 埋孔');
  }

  const topBlind1 = DfmCheck.parseViaLayerSpan('  Padstack Defined from Top to 03G02P\n');
  if (topBlind1.viaSpanType !== 'blind' || topBlind1.minLayerNum !== 1 || topBlind1.maxLayerNum !== 3) {
    throw new Error('Top to 03G02P 应识别为 L1-L3 盲孔');
  }

  const topBlind2 = DfmCheck.parseViaLayerSpan('  Padstack Defined from L1-3\n');
  if (topBlind2.viaSpanType !== 'blind' || topBlind2.minLayerNum !== 1 || topBlind2.maxLayerNum !== 3) {
    throw new Error('L1-3 应识别为 L1-L3 盲孔');
  }

  const botBlind = DfmCheck.parseViaLayerSpan('  Padstack Defined from 18IS08 to Bottom\n');
  if (botBlind.viaSpanType !== 'blind' || botBlind.minLayerNum !== 18 || botBlind.maxLayerNum !== DfmCheck.BOTTOM_LAYER_INDEX) {
    throw new Error('18IS08 to Bottom 应识别为底层盲孔');
  }
});

test('盲埋孔穿层判定核心场景：L12 走线对 10G07P~13G09P 埋孔执行检查，对 L1~3 盲孔与 L18~Bottom 盲孔自动跳过不误报', () => {
  const sampleTxt = `
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 101   < Via >

  Origin-xy:          [100.0000, 100.0000]
  Net:                GND
  Padstack Name:      VIA_BURIED_10_13
  Circle Drill:       3.9400
  Usage:              BBVia
  Padstack Defined from 10G07P to 13G09P
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 102   < Via >

  Origin-xy:          [120.0000, 100.0000]
  Net:                GND
  Padstack Name:      VIA_BLIND_1_3_A
  Circle Drill:       3.9400
  Usage:              BBVia
  Padstack Defined from Top to 03G02P
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 103   < Via >

  Origin-xy:          [140.0000, 100.0000]
  Net:                GND
  Padstack Name:      VIA_BLIND_L1_L3
  Circle Drill:       3.9400
  Usage:              BBVia
  Padstack Defined from L1 to L3
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 104   < Via >

  Origin-xy:          [160.0000, 100.0000]
  Net:                GND
  Padstack Name:      VIA_BLIND_18_BOT
  Circle Drill:       3.9400
  Usage:              BBVia
  Padstack Defined from 18IS08 to Bottom
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 105   < Via >

  Origin-xy:          [180.0000, 100.0000]
  Net:                GND
  Padstack Name:      VIA_THRU_ALL
  Circle Drill:       3.9400
  Usage:              Thru Via
  Padstack Defined from Top to Bottom
  Backdrill:
    Start Layer: Top
    End Layer:   03G02P
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 201   < Trace seg >

  Subset:             L12
  Net:                PCI_TX_P
  Segment:xy [80.0000, 108.0000] xy [200.0000, 108.0000] width 4.0000
  Length:             120.0000 mil
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
`;

  // 所有 5 个孔距离 L12 走线中心均为 8.0 mil -> 走线半宽 2.0 + GND焊盘半径 3.0 = 5.0 -> Airgap = 3.0 mil (< 6.0 mil 阈值)
  const parsed = DfmCheck.parseDfmItems(sampleTxt, {
    gndPadDiameter: 6.0,
    signalPadDiameter: 10.0,
    gndFirstDrill: 5.5,
    signalFirstDrill: 5.5
  });

  if (parsed.vias.length !== 5 || parsed.traces.length !== 1) {
    throw new Error('解析数量不符');
  }

  const res = DfmCheck.runDfmCheck(parsed.vias, parsed.traces, {
    minClearanceGnd: 6.0,
    minClearanceSignal: 6.0,
    mode: 'pad_to_trace',
    diffNetOnly: true
  });

  // 仅 Via 101 (10G07P~13G09P 埋孔穿过 L12) 和 Via 105 (Top~Bottom 通孔穿过 L12) 参与核对并检出超标
  // Via 102 (Top~03G02P)、Via 103 (L1~L3)、Via 104 (18IS08~Bottom) 均未穿过 L12，必须跳过！
  if (res.totalChecked !== 2) {
    throw new Error('有效同穿层核对数应为 2 (仅 Via 101 与 Via 105)，实际 ' + res.totalChecked);
  }
  if (res.skippedNonSpanningPairs !== 3) {
    throw new Error('应跳过 3 个未穿过 L12 的盲孔对偶，实际 ' + res.skippedNonSpanningPairs);
  }
  if (res.failCount !== 2) {
    throw new Error('超标数应精准为 2（绝不误报 L1-3 / L18-Bot 盲孔下穿走线），实际 ' + res.failCount);
  }

  const defectViaIds = res.defectPairs.map(p => p.via.id).sort((a, b) => a - b);
  if (defectViaIds.join(',') !== '101,105') {
    throw new Error('检出超标的过孔应仅为 101 和 105，实际: ' + defectViaIds.join(','));
  }

  // 验证交互式测量计算器的 spansTraceLayer 标记
  const m101 = DfmCheck.calcTraceToViaMetrics(parsed.vias.find(v => v.id === 101), parsed.traces[0]);
  const m102 = DfmCheck.calcTraceToViaMetrics(parsed.vias.find(v => v.id === 102), parsed.traces[0]);
  if (m101.spansTraceLayer !== true) throw new Error('Via 101 (10G07P~13G09P) 应标记为穿过 L12');
  if (m102.spansTraceLayer !== false) throw new Error('Via 102 (Top~03G02P) 应标记为未穿过 L12');
});

// ---------------------------------------------------------------------------
// 盲埋孔层过滤的安全性：宁可多检，不可漏检（层名解析不出层号时不得静默跳过）
// ---------------------------------------------------------------------------
function spanCase(viaSpan, traceLayer) {
  const txt = `Total 2 Items

Item 1                < Via >
  Origin-xy: [100.0000, 100.0000]
  Net: GND
  Padstack Name: TEST_SPAN
  Padstack Defined from ${viaSpan[0]} to ${viaSpan[1]}
  Circle Drill: 3.9400

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 2                < Trace >
  Subset: ${traceLayer}
  Net: 25_N
  Type: Seg
  Seg Length: 100.0000
  Seg: xy [100.0000, 103.0000]  xy [200.0000, 103.0000] Width (6.0000)
`;
  const parsed = DfmCheck.parseDfmItems(txt, {gndPadDiameter: 10, signalPadDiameter: 10, gndFirstDrill: 3.94, signalFirstDrill: 3.94});
  return DfmCheck.runDfmCheck(parsed.vias, parsed.traces, {minClearanceGnd: 6, minClearanceSignal: 6, mode: 'pad_to_trace', diffNetOnly: true});
}

test('走线层名无法解析为层号时不得静默跳过（漏检防护）：仍应检出 1 处超标', () => {
  const r = spanCase(['<L2>', '<L5>'], 'SIGA');
  if (r.totalChecked !== 1) throw new Error('应照常核对 1 处（宁可多检），实际 ' + r.totalChecked);
  if (r.failCount !== 1) throw new Error('该 3 mil 间距应判超标，实际 failCount=' + r.failCount);
  if (r.undeterminedSpanPairs !== 1) throw new Error('应记录 1 处「层信息无法判定」统计，实际 ' + r.undeterminedSpanPairs);
});

test('层名可解析且确不穿越时仍正常跳过（不过度检查）', () => {
  const r = spanCase(['<L2>', '<L5>'], '19IS08');
  if (r.totalChecked !== 0) throw new Error('L2–L5 盲孔不应检查 L19 走线，实际核对 ' + r.totalChecked);
  if (r.skippedNonSpanningPairs !== 1) throw new Error('应计入 1 处非穿层排除，实际 ' + r.skippedNonSpanningPairs);
  if (r.undeterminedSpanPairs !== 0) throw new Error('层号明确时不应计入「无法判定」，实际 ' + r.undeterminedSpanPairs);
});

test('真穿越与不穿越的边界：L2–L5 盲孔对 L4 走线要检查、对 L12 走线不检查', () => {
  const inSpan = spanCase(['<L2>', '<L5>'], '04IS01');
  const outSpan = spanCase(['<L2>', '<L5>'], '12IS01');
  if (inSpan.totalChecked !== 1 || inSpan.failCount !== 1) throw new Error('L4 在跨度内，应检出超标');
  if (outSpan.totalChecked !== 0) throw new Error('L12 在跨度外，应跳过');
});

test('evaluateViaSpan 返回值语义：spans 表示是否检查、determined 表示是否精确判定', () => {
  const viaKnown = {minLayerNum: 2, maxLayerNum: 5, startLayer: '<L2>', endLayer: '<L5>'};
  const a = DfmCheck.evaluateViaSpan(viaKnown, '19IS08', 19);
  const b = DfmCheck.evaluateViaSpan(viaKnown, 'SIGA', null);
  if (a.spans !== false || a.determined !== true) throw new Error('明确不穿越应返回 {false,true}，实际 ' + JSON.stringify(a));
  if (b.spans !== true || b.determined !== false) throw new Error('无法判定应返回 {true,false}，实际 ' + JSON.stringify(b));
});

console.log('== GND 孔盘到信号孔盘最小间距（新增项）==');

function mkVia(id, isGnd, x, y, minL, maxL, padDiam) {
  const padRadius = (padDiam || 8) / 2;
  return {
    id, type: 'via', origin: [x, y], net: isGnd ? 'GND' : 'SIG' + id, isGnd,
    padstack: isGnd ? 'BGA_GND' : 'BGA_SIG', usage: 'BBVia',
    hasDefinedSpan: true, minLayerNum: minL, maxLayerNum: maxL,
    startLayerNum: minL, endLayerNum: maxL, viaSpanType: 'buried', viaTypeLabel: '埋孔',
    spanShort: `L${minL}-L${maxL}`,
    padDiameter: padDiam || 8, padRadius, padShape: null,
    firstDrill: 5, firstDrillRadius: 2.5
  };
}

test('孔盘到孔盘：阈值填 0 表示不检查这一项', () => {
  const txt = fs.readFileSync(path.join(__dirname, '../../sample/via_trace_airgap_sample.txt'), 'utf8');
  const res = DfmCheck.parseDfmItems(txt, {});
  const r = DfmCheck.runDfmCheck(res.vias, res.traces, { minClearanceGnd: 4.01575, minClearanceSignal: 5.04725, minClearancePadPair: 0 });
  if (r.padPairStats.enabled !== false) throw new Error('阈值 0 应标记未启用');
  if (r.padPairStats.total !== 0 || r.padPairDefects.length !== 0) throw new Error('阈值 0 不应产出对偶');
});

test('孔盘到孔盘：97 项样本阈值 6 mil 时 22 对全部满足', () => {
  const txt = fs.readFileSync(path.join(__dirname, '../../sample/via_trace_airgap_sample.txt'), 'utf8');
  const res = DfmCheck.parseDfmItems(txt, { gndPadDiameter: 7.906, signalPadDiameter: 12.0, gndFirstDrill: 6.0, signalFirstDrill: 6.0 });
  const r = DfmCheck.runDfmCheck(res.vias, res.traces, { minClearanceGnd: 4.01575, minClearanceSignal: 5.04725, minClearancePadPair: 6, gndPadDiameter: 7.906, signalPadDiameter: 12.0 });
  if (!r.padPairStats.enabled) throw new Error('没启用');
  if (r.padPairStats.total !== 22) throw new Error('应核对 22 对，实际 ' + r.padPairStats.total);
  if (r.padPairStats.fail !== 0) throw new Error('不应有超标，实际 ' + r.padPairStats.fail);
  if (Math.abs(r.padPairStats.minDist - 7.7558) > 0.001) throw new Error('最小间距应为 7.756，实际 ' + r.padPairStats.minDist);
});

test('孔盘到孔盘：阈值调到 10 mil 时 8 对不满足，且按间距从小到大', () => {
  const txt = fs.readFileSync(path.join(__dirname, '../../sample/via_trace_airgap_sample.txt'), 'utf8');
  const res = DfmCheck.parseDfmItems(txt, { gndPadDiameter: 7.906, signalPadDiameter: 12.0, gndFirstDrill: 6.0, signalFirstDrill: 6.0 });
  const r = DfmCheck.runDfmCheck(res.vias, res.traces, { minClearanceGnd: 4.01575, minClearanceSignal: 5.04725, minClearancePadPair: 10, gndPadDiameter: 7.906, signalPadDiameter: 12.0 });
  if (r.padPairStats.fail !== 8) throw new Error('应 8 对不满足，实际 ' + r.padPairStats.fail);
  if (r.padPairDefects.length !== 8) throw new Error('明细条数不对：' + r.padPairDefects.length);
  for (let i = 1; i < r.padPairDefects.length; i++) {
    if (r.padPairDefects[i].padAirgap < r.padPairDefects[i - 1].padAirgap - 1e-9) throw new Error('没有按间距排序');
  }
  const d0 = r.padPairDefects[0];
  if (Math.abs(d0.threshold - 10) > 1e-9) throw new Error('阈值没带进明细');
  if (Math.abs(d0.diff - (d0.padAirgap - 10)) > 1e-6) throw new Error('亏欠算错：' + d0.diff);
});

test('孔盘到孔盘：只比对 GND 孔 × 信号孔，GND×GND / 信号×信号不算', () => {
  const text = fs.readFileSync(path.join(__dirname, '../../sample/via_trace_airgap_sample.txt'), 'utf8');
  const res = DfmCheck.parseDfmItems(text, {});
  const r = DfmCheck.runDfmCheck(res.vias, res.traces, { minClearancePadPair: 30 });
  if (!r.padPairDefects.length) throw new Error('没产生对偶，测不到组合');
  r.padPairDefects.forEach(d => {
    if (!!d.gndVia.isGnd === !!d.sigVia.isGnd) throw new Error('出现了同类型孔对偶 #' + d.gndVia.id + ' / #' + d.sigVia.id);
    if (!d.gndVia.isGnd) throw new Error('gndVia 不是 GND');
    if (d.sigVia.isGnd) throw new Error('sigVia 是 GND');
  });
  const seen = new Set();
  r.padPairDefects.forEach(d => {
    const k = Math.min(d.gndVia.id, d.sigVia.id) + '-' + Math.max(d.gndVia.id, d.sigVia.id);
    if (seen.has(k)) throw new Error('同一对算了两次：' + k);
    seen.add(k);
  });
});

test('孔盘到孔盘：层范围不重叠的盲埋孔不算一对', () => {
  const v1 = mkVia(1, true, 0, 0, 1, 2);
  const v2 = mkVia(2, false, 20, 0, 5, 6);   // 孔盘间距 20-4-4=12，但层不重叠
  const r1 = DfmCheck.runDfmCheck([v1, v2], [], { minClearancePadPair: 20 });
  if (r1.padPairStats.total !== 0) throw new Error('层不重叠不应算一对，实际 ' + r1.padPairStats.total);
  const v3 = mkVia(3, false, 20, 0, 2, 6);   // 改成重叠
  const r2 = DfmCheck.runDfmCheck([v1, v3], [], { minClearancePadPair: 20 });
  if (r2.padPairStats.total !== 1) throw new Error('层重叠应算 1 对，实际 ' + r2.padPairStats.total);
  if (r2.padPairStats.fail !== 1) throw new Error('12 mil < 20 mil 应判不满足');
  if (Math.abs(r2.padPairDefects[0].padAirgap - 12) > 1e-6) throw new Error('孔盘间距应为 12，实际 ' + r2.padPairDefects[0].padAirgap);
});

test('孔盘到孔盘：同网络对偶在「仅检查异网络」下跳过', () => {
  const v1 = mkVia(1, true, 0, 0, 1, 6);
  const v2 = mkVia(2, false, 20, 0, 1, 6);
  v2.net = 'GND';
  const skip = DfmCheck.runDfmCheck([v1, v2], [], { minClearancePadPair: 20, diffNetOnly: true });
  if (skip.padPairStats.total !== 0) throw new Error('同网络应跳过');
  const keep = DfmCheck.runDfmCheck([v1, v2], [], { minClearancePadPair: 20, diffNetOnly: false });
  if (keep.padPairStats.total !== 1) throw new Error('包含同网络时应算 1 对');
});

console.log('== 分层规则（按层覆盖阈值）==');

function mkTrace(id, subset, net, width, x, y1, y2) {
  return { id, type: 'trace', kind: 'line', subset, net, width, p1: [x, y1], p2: [x, y2], len: Math.abs(y2 - y1) };
}

test('层表达式解析：Top / Bot / 内层 / L2-L5 / 顿号分隔', () => {
  const D = DfmCheck;
  if (JSON.stringify(D.parseLayerSpec('Top、Bot')) !== JSON.stringify([[1, 1], [9999, 9999]])) throw new Error('Top、Bot 解析错');
  if (JSON.stringify(D.parseLayerSpec('内层')) !== JSON.stringify([[2, 9998]])) throw new Error('内层解析错');
  if (JSON.stringify(D.parseLayerSpec('L2-L5')) !== JSON.stringify([[2, 5]])) throw new Error('L2-L5 解析错');
  if (JSON.stringify(D.parseLayerSpec('3-7')) !== JSON.stringify([[3, 7]])) throw new Error('3-7 解析错');
  if (JSON.stringify(D.parseLayerSpec('L2、L3、Top')) !== JSON.stringify([[2, 2], [3, 3], [1, 1]])) throw new Error('列表解析错');
  if (D.parseLayerSpec('').length !== 0 || D.parseLayerSpec('乱写').length !== 0) throw new Error('非法写法应为空');
  if (D.layerSpecLabel(D.parseLayerSpec('内层')).indexOf('内层') < 0) throw new Error('标签错：' + D.layerSpecLabel(D.parseLayerSpec('内层')));
  if (D.layerSpecLabel(D.parseLayerSpec('Top、Bot')) !== 'L1（Top）、Bottom') throw new Error('标签错：' + D.layerSpecLabel(D.parseLayerSpec('Top、Bot')));
});

test('分层规则：走线按自身所在层取阈值（Top 规则不影响内层走线）', () => {
  const via = mkVia(1, true, 0, 0, 1, 6, 8);            // GND 通孔，焊盘半径 4
  const trace = mkTrace(2, 'L2', 'SIG', 2, 10, -10, 10); // L2 走线，距孔心 10 → 焊盘边到线边 5 mil
  const base = { minClearanceGnd: 4, minClearanceSignal: 4 };
  const noRule = DfmCheck.runDfmCheck([via], [trace], base);
  if (noRule.failCount !== 0) throw new Error('默认阈值 4 应通过，实际超标 ' + noRule.failCount);
  const topRule = DfmCheck.runDfmCheck([via], [trace], Object.assign({}, base, {
    layerRules: [{ layers: 'Top', minClearanceGnd: 8 }]
  }));
  if (topRule.failCount !== 0) throw new Error('Top 规则不该管 L2 走线');
  if (topRule.layerRuleStats[0].checked !== 0) throw new Error('Top 规则不该命中：' + topRule.layerRuleStats[0].checked);
  const l2Rule = DfmCheck.runDfmCheck([via], [trace], Object.assign({}, base, {
    layerRules: [{ layers: 'L2', minClearanceGnd: 6 }]
  }));
  if (l2Rule.failCount !== 1) throw new Error('L2 规则 6 mil 应判 1 处超标，实际 ' + l2Rule.failCount);
  if (l2Rule.defectPairs[0].threshold !== 6) throw new Error('阈值没用规则里的：' + l2Rule.defectPairs[0].threshold);
  if (l2Rule.layerRuleStats[0].checked !== 1 || l2Rule.layerRuleStats[0].fail !== 1) throw new Error('命中统计不对');
});

test('分层规则：同一层命中多条时用靠上的一条', () => {
  const via = mkVia(1, true, 0, 0, 1, 6, 8);
  const trace = mkTrace(2, 'L3', 'SIG', 2, 10, -10, 10);
  const r = DfmCheck.runDfmCheck([via], [trace], {
    minClearanceGnd: 4,
    layerRules: [
      { layers: '内层', minClearanceGnd: 9 },
      { layers: 'L3', minClearanceGnd: 2 }
    ]
  });
  const hit = r.defectPairs.length ? r.defectPairs[0] : r.pairs[0];
  if (hit.threshold !== 9) throw new Error('应先用靠上的「内层」规则 9，实际 ' + hit.threshold);
  if (hit.ruleLayers !== '内层') throw new Error('没记录命中的规则：' + hit.ruleLayers);
});

test('分层规则：信号孔 / GND 孔各用各的阈值', () => {
  const gnd = mkVia(1, true, 0, 0, 1, 6, 8);
  const sig = mkVia(2, false, 40, 0, 1, 6, 8);
  const tG = mkTrace(3, 'L2', 'X1', 2, 10, -10, 10);
  const tS = mkTrace(4, 'L2', 'X2', 2, 50, -10, 10);
  const r = DfmCheck.runDfmCheck([gnd, sig], [tG, tS], {
    minClearanceGnd: 4, minClearanceSignal: 4,
    layerRules: [{ layers: 'Top、内层', minClearanceGnd: 8, minClearanceSignal: 2 }]
  });
  const g = r.defectPairs.find(p => p.via.isGnd);
  const s = r.defectPairs.find(p => !p.via.isGnd);
  if (!g || g.threshold !== 8) throw new Error('GND 孔阈值应为规则里的 8');
  if (s) throw new Error('信号孔阈值 2 不该超标');
});

test('分层规则：孔盘到孔盘取重叠层里最严的一条', () => {
  const g = mkVia(1, true, 0, 0, 1, 6);
  const s = mkVia(2, false, 20, 0, 1, 6);
  const base = { minClearancePadPair: 6 };
  const loose = DfmCheck.runDfmCheck([g, s], [], Object.assign({}, base, {
    layerRules: [{ layers: '内层', minClearancePadPair: 5 }]
  }));
  if (loose.padPairStats.fail !== 0) throw new Error('规则 5 mil 时 12 mil 间距应通过');
  const strict = DfmCheck.runDfmCheck([g, s], [], Object.assign({}, base, {
    layerRules: [
      { layers: 'Top', minClearancePadPair: 10 },
      { layers: '内层', minClearancePadPair: 14 }
    ]
  }));
  if (strict.padPairStats.fail !== 1) throw new Error('应取最严的 14 mil 判超标');
  if (strict.padPairDefects[0].threshold !== 14) throw new Error('阈值应为 14，实际 ' + strict.padPairDefects[0].threshold);
  if (strict.padPairDefects[0].ruleLayers !== '内层') throw new Error('没记录规则：' + strict.padPairDefects[0].ruleLayers);
});

test('分层规则：表达式写错的行直接忽略，不影响默认阈值', () => {
  const via = mkVia(1, true, 0, 0, 1, 6, 8);
  const trace = mkTrace(2, 'L2', 'SIG', 2, 10, -10, 10);
  const r = DfmCheck.runDfmCheck([via], [trace], {
    minClearanceGnd: 4,
    layerRules: [{ layers: '乱写的层', minClearanceGnd: 99 }, { layers: '', minClearanceGnd: 99 }]
  });
  if (r.layerRuleStats.length !== 0) throw new Error('非法规则不该进结果');
  if (r.failCount !== 0) throw new Error('不该被非法规则影响');
  if (r.defectPairs.length || r.pairs.some(p => p.threshold !== 4)) throw new Error('阈值应仍是默认 4');
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
if (fail > 0) process.exit(1);
