/**
 * pour-test.js
 * 铜皮五大检查项单元测试
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PourChecker = require('./pour-check.js');

const {
  parsePcbElements,
  checkViaLayerCoverage,
  checkSpecialShapedCopper,
  checkTraceReferenceMargin,
  checkIsolatedSmallCopper,
  checkCopperArcRadius,
  runAllCopperChecks
} = PourChecker;

console.log('== 铜皮五项检查引擎单元测试 ==');

// 1. 数据解析测试 (Shape / Via / Trace)
{
  const sampleTxt = fs.readFileSync(path.join(__dirname, 'sample/铜皮数据示例.txt'), 'utf8');
  const parsed = parsePcbElements(sampleTxt);

  assert.strictEqual(parsed.shapes.length, 3, '应解析出 3 个 Shape');
  assert.strictEqual(parsed.vias.length, 1, '应解析出 1 个 Via');
  assert.strictEqual(parsed.shapes[0].layer, 'Top');
  assert.strictEqual(parsed.shapes[0].area, 907.92028);
  assert.strictEqual(parsed.shapes[0].arcs.length, 1);
  assert.strictEqual(parsed.shapes[0].arcs[0].radius, 17.0);

  // 走线数据文件解析测试
  const traceTxt = fs.readFileSync(path.join(__dirname, 'sample/走线示例.txt'), 'utf8');
  const parsedTrace = parsePcbElements(traceTxt);
  assert.strictEqual(parsedTrace.traces.length, 10, '应解析出 10 条走线 Trace');
  assert.strictEqual(parsedTrace.traces[0].net, '105_P');
  assert.strictEqual(parsedTrace.traces[0].segments.length, 3, 'Item 1 包含 2 条直线段 + 1 条圆弧段');
  assert.strictEqual(parsedTrace.traces[0].segments[1].type, 'arc');
  assert.strictEqual(parsedTrace.traces[0].segments[1].radius, 52.38);
  console.log('  PASS  EDA TXT Shape、Via 与 Trace 走线 (直线+圆弧) 全量元素解析');
}

// 2. 第一项：孔经过层铺铜覆盖检查 (Via Layer Coverage Check)
{
  const vias = [
    { id: 1, x: 1000, y: 1000, padstack: 'HDI_045drill_ring3_1_4', net: 'GND' },
    { id: 2, x: 2000, y: 2000, padstack: 'HDI_045drill_ring3_1_4', net: 'GND' }
  ];

  const shapes = [
    // Via 1 附近 20 mil 有铜皮 (满足 <= 50mil)
    {
      id: 101, layer: 'L1', bbox: { minX: 980, minY: 980, maxX: 1050, maxY: 1050 },
      boundary: [{ type: 'line', x1: 980, y1: 980, x2: 1050, y2: 1050 }],
      arcs: [], centroid: { x: 1015, y: 1015 }
    },
    // Via 2 附近无铜皮 (最近铜皮在 500mil 外)
    {
      id: 102, layer: 'L1', bbox: { minX: 2500, minY: 2500, maxX: 2600, maxY: 2600 },
      boundary: [{ type: 'line', x1: 2500, y1: 2500, x2: 2600, y2: 2600 }],
      arcs: [], centroid: { x: 2550, y: 2550 }
    }
  ];

  const rules = [
    { id: 'r1', padstack: 'HDI_045drill', layers: ['L1', 'L2'], coverageRadius: 50.0 }
  ];

  const res = checkViaLayerCoverage(vias, shapes, rules);
  assert.strictEqual(res.length, 4, '2个孔 × 2个层 = 4条检查记录');

  const via1L1 = res.find(r => r.viaId === 1 && r.layer === 'L1');
  assert.strictEqual(via1L1.pass, true, 'Via 1 在 L1 距离铜皮 <= 50mil 应判定为通过');

  const via2L1 = res.find(r => r.viaId === 2 && r.layer === 'L1');
  assert.strictEqual(via2L1.pass, false, 'Via 2 在 L1 距离铜皮 > 50mil 应判定为不通过');

  const via1L2 = res.find(r => r.viaId === 1 && r.layer === 'L2');
  assert.strictEqual(via1L2.pass, false, 'Via 1 在 L2 无铜皮应判定为不通过');
  console.log('  PASS  第一项：孔经过层铺铜覆盖检查 (50mil 阈值与多层校验)');
}

// 3. 第二项：特定异型铜皮比对检查 (Special Shaped Copper Check)
{
  const vias = [
    { id: 10, x: 23286.13, y: 27990.27, padstack: 'BGA_3510_L19_ring3mil_L2pad_0907', net: '63_N' }
  ];

  const shapes = [
    {
      id: 201, layer: '02G01P', area: 452.38934,
      centroid: { x: 23286.13, y: 27990.27 },
      bbox: { minX: 23274, minY: 27978, maxX: 23298, maxY: 28002 },
      arcs: [{ cx: 23286.13, cy: 27990.27, radius: 12.0 }]
    }
  ];

  const templates = [
    {
      id: 'tmpl_1', name: 'L2特定异型铜皮',
      padstack: 'BGA_3510', layer: '02G01P',
      expectedArea: 452.38, areaTolerance: 10.0
    }
  ];

  const res = checkSpecialShapedCopper(vias, shapes, templates);
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].pass, true, '面积与位置符合模板应判定为通过');
  console.log('  PASS  第二项：特定类型孔在指定层的异型铜皮比对检查');
}

// 4. 第三项：走线上/下参考层铺铜覆盖与单侧超宽检查 (Trace Reference Layer Margin)
{
  const traces = [
    {
      id: 301, layer: 'L4', net: 'PCIE_TX_P',
      segments: [
        { type: 'line', x1: 1000, y1: 1000, x2: 1200, y2: 1000, width: 6.0, len: 200 }
      ]
    }
  ];

  const shapes = [
    // L3 上参考层：单侧超宽 60mil > 50mil (通过)
    {
      id: 401, layer: 'L3', area: 50000,
      bbox: { minX: 900, minY: 937, maxX: 1300, maxY: 1063 } // Y方向 1000 ± 63 mil -> 单侧外延 60mil
    },
    // L5 下参考层：单侧超宽仅 20mil < 50mil (超差报错)
    {
      id: 402, layer: 'L5', area: 20000,
      bbox: { minX: 950, minY: 977, maxX: 1250, maxY: 1023 } // Y方向 1000 ± 23 mil -> 单侧外延 20mil
    }
  ];

  const rules = [
    { id: 'm1', traceLayer: 'L4', upperRefLayer: 'L3', lowerRefLayer: 'L5', minMargin: 50.0 }
  ];

  const res = checkTraceReferenceMargin(traces, shapes, rules);
  assert.strictEqual(res.length, 2, '包含上参考层 L3 与下参考层 L5');

  const l3Res = res.find(r => r.refLayer === 'L3');
  assert.strictEqual(l3Res.pass, true, 'L3 单侧外延 60mil >= 50mil 应通过');

  const l5Res = res.find(r => r.refLayer === 'L5');
  assert.strictEqual(l5Res.pass, false, 'L5 单侧外延 20mil < 50mil 应报错');
  console.log('  PASS  第三项：走线上/下参考层铺铜覆盖与单侧 50mil 超宽检查');
}

// 5. 第四项：孤立小铜皮检查 (Isolated Small Copper)
{
  const shapes = [
    { id: 501, layer: 'Top', area: 1200.0, areaMm2: 0.774, centroid: { x: 100, y: 100 } },
    { id: 502, layer: '02G01P', area: 150.0, areaMm2: 0.096, centroid: { x: 500, y: 500 } } // 面积 150 < 500
  ];
  const vias = [];

  const res = checkIsolatedSmallCopper(shapes, vias, 500.0);
  assert.strictEqual(res.length, 1, '应检出 1 个面积小于 500 的孤立小铜皮');
  assert.strictEqual(res[0].shapeId, 502);
  console.log('  PASS  第四项：孤立小铜皮 / 碎铜死铜检查 (500 sq mil 阈值)');
}

// 6. 第五项：铜皮最小圆弧半径检查 (Copper Arc Minimum Radius)
{
  const shapes = [
    {
      id: 601, layer: 'Top',
      arcs: [
        { cx: 100, cy: 100, radius: 17.0 }, // >= 10.0 通过
        { cx: 200, cy: 200, radius: 6.0 }   // < 10.0 报错
      ]
    }
  ];

  const res = checkCopperArcRadius(shapes, 10.0);
  assert.strictEqual(res.length, 1, '应检出 1 处半径 < 10.0 的圆弧');
  assert.strictEqual(res[0].actualRadius, 6.0);
  console.log('  PASS  第五项：铜皮最小圆弧半径检查 (10 mil 阈值)');
}

// 7. 全量集成运行器测试 (runAllCopperChecks)
{
  const sampleTxt = fs.readFileSync(path.join(__dirname, 'sample/铜皮数据示例.txt'), 'utf8');
  const fullRes = runAllCopperChecks(sampleTxt, {
    smallCopperAreaThreshold: 500.0,
    minArcRadius: 10.0
  });

  assert.strictEqual(fullRes.success, true);
  assert.ok(fullRes.summary.totalChecks > 0);
  console.log(`  PASS  全量 5 项铜皮检查集成运行器 (总检查项 ${fullRes.summary.totalChecks}，检出缺陷 ${fullRes.summary.totalDefects})`);
}

// 8. 走线圆弧高精度参数化插值采样与 image-1.png 全量走线解析对齐测试
{
  const { sampleArcPoints } = PourChecker;
  // Test CCW arc
  const p1 = [21186.10, 35481.67];
  const p2 = [21201.69, 35490.67];
  const center = [21186.1015, 35499.6701];
  const radius = 18.0001;
  const ptsCCW = sampleArcPoints(center, radius, p1, p2, 'CCW', 24);
  assert.strictEqual(ptsCCW.length, 25);
  assert.ok(Math.hypot(ptsCCW[0][0] - p1[0], ptsCCW[0][1] - p1[1]) < 1e-2, '起点应与 p1 一致');
  assert.ok(Math.hypot(ptsCCW[24][0] - p2[0], ptsCCW[24][1] - p2[1]) < 1e-2, '终点应与 p2 一致');

  // Test EDA coordinate report with < Trace Seg > items (image-1.png layout dataset)
  const airgapTxt = fs.readFileSync(path.join(__dirname, 'sample/via_trace_airgap_sample.txt'), 'utf8');
  const parsedAirgap = parsePcbElements(airgapTxt);
  assert.strictEqual(parsedAirgap.vias.length, 26, '应解析出 26 个过孔 (包含 BGA 阵列与 GND 孔)');
  assert.strictEqual(parsedAirgap.traces.length, 71, '应解析出 71 条走线段');

  const netSet = new Set(parsedAirgap.traces.map(t => t.net));
  assert.ok(netSet.has('25_N'), '应包含 25_N 网络 (对应 P2 端口)');
  assert.ok(netSet.has('25_P'), '应包含 25_P 网络 (对应 P3 端口)');
  assert.ok(netSet.has('26_N'), '应包含 26_N 网络 (对应 P1 端口)');
  assert.ok(netSet.has('26_P'), '应包含 26_P 网络 (对应 P4 端口)');
  console.log('  PASS  圆弧高精度参数化插值采样与 image-1.png 走线/过孔全量元素解析对齐');
}


// 9. 圆弧扫掠角：点位于弧的「缺口」方向时，最近点必须是弧端点
{
  const shape = {
    id: 900, layer: 'Top', bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100, spanX: 100, spanY: 100 },
    boundary: [
      { type: 'line', x1: 100, y1: 0, x2: 100, y2: 0, width: 0 },
      { type: 'arc', x1: 100, y1: 0, x2: 0, y2: 100, cx: 0, cy: 0, radius: 100, ccw: true }
    ],
    arcs: [{ cx: 0, cy: 0, radius: 100 }]
  };
  const px = -110, py = -110;                       // 225° 方向，落在弧的缺口里
  const got = PourChecker.pointToShapeDistance(px, py, shape);
  const toEndpoint = Math.min(Math.hypot(px - 100, py), Math.hypot(px, py - 100));
  const wrong = Math.abs(Math.hypot(px, py) - 100); // 旧算法：|d - r|
  assert.ok(Math.abs(got - toEndpoint) < 1e-6, `应取弧端点距离 ${toEndpoint.toFixed(3)}，实得 ${got.toFixed(3)}`);
  assert.ok(got > wrong + 50, '仍在使用 |d-r| 的错误近似');
  console.log('  PASS  圆弧扫掠角：缺口方向的点按弧端点取距（不再用 |d−r| 逼近）');
}

// 10. 点在形内判定：L 形铜皮的包围盒中心不在铜皮上
{
  const L = [[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100]];
  const boundary = L.map((p, i) => ({
    type: 'line', x1: p[0], y1: p[1], x2: L[(i + 1) % L.length][0], y2: L[(i + 1) % L.length][1], width: 0
  }));
  const shape = {
    id: 901, layer: '02G01P', boundary, arcs: [],
    bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100, spanX: 100, spanY: 100 }
  };
  const inside = PourChecker.pointToShapeDistance(10, 10, shape);
  const outsideButInBBox = PourChecker.pointToShapeDistance(50, 50, shape);
  assert.strictEqual(inside, 0, 'L 形铜皮内部点应为 0');
  assert.ok(Math.abs(outsideButInBBox - 30) < 1e-6,
    `包围盒内但铜皮外的点应返回真实边界距离 30，实得 ${outsideButInBBox}`);
  console.log('  PASS  点在形内判定：L 形/带缺口铜皮的包围盒中心不再被误判为「在上面」');
}

// 11. 孤立小铜皮判定：过孔是否真的落在铜皮轮廓内（同层）
{
  const L = [[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100]];
  const boundary = L.map((p, i) => ({
    type: 'line', x1: p[0], y1: p[1], x2: L[(i + 1) % L.length][0], y2: L[(i + 1) % L.length][1], width: 0
  }));
  const shape = {
    id: 902, layer: '02G01P', area: 120, areaMm2: 0.077, boundary, arcs: [],
    centroid: { x: 20, y: 20 },
    bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100, spanX: 100, spanY: 100 }
  };
  // 质心附近(20,20)有过孔，但包围盒中心(50,50)在铜皮外
  const insideVia = [{ id: 1, x: 10, y: 10 }, ];
  const outsideVia = [{ id: 2, x: 50, y: 50 }];

  const a = checkIsolatedSmallCopper([shape], insideVia, 500);
  const b = checkIsolatedSmallCopper([shape], outsideVia, 500);
  assert.strictEqual(a[0].containsVia, true, '孔在铜皮轮廓内应判为已连接');
  assert.strictEqual(a[0].viaInsideId, 1);
  assert.strictEqual(b[0].containsVia, false, '孔不在轮廓内（即使靠近质心）不应判为已连接');
  assert.strictEqual(a[0].containsViaBy, 'outline');
  console.log('  PASS  孤立小铜皮：按轮廓点内判定 + 同层过滤（不再用「质心 30 mil 内」近似）');
}

console.log('\n结果: 全部 11 项铜皮检查单元测试通过！');
