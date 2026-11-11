/**
 * fanout-test.js
 * 扇出方案聚类与比对引擎单元测试
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const FanoutChecker = require('./fanout-check.js');

const {
  FanoutScheme,
  FanoutLibrary,
  parseViaData,
  clusterVias,
  matchClusterToLibrary,
  runFanoutInspection,
  getStandardPresetSchemes,
  candidateRotations,
  dist2D
} = FanoutChecker;

console.log('== 扇出方案检查引擎单元测试 ==');

// 批量 EDA TXT 无方案标题时，根据孔群特征自动命名且名称保持唯一。
{
  const batch = `Total 2 Items\nItem 1 < Via >\nOrigin-xy: [1000, 2000]\nPadstack Name: BGA-HDI-GND-045drill-ring3_L1_L5\nNet: GND\nCircle Drill: 4.5 Plated\nItem 2 < Via >\nOrigin-xy: [1000, 2010]\nPadstack Name: BGA-HDI-SIG-045drill-ring3_L1_L5\nNet: SIG_P\nCircle Drill: 4.5 Plated\n~~~~~~~~~~~~\nTotal 2 Items\nItem 1 < Via >\nOrigin-xy: [2000, 3000]\nPadstack Name: SMA-HDI-GND-045drill-ring3_L10_L14\nNet: GND\nCircle Drill: 4.5 Plated\nItem 2 < Via >\nOrigin-xy: [2000, 3010]\nPadstack Name: SMA-HDI-SIG-045drill-ring3_L10_L14\nNet: SIG_P\nCircle Drill: 4.5 Plated`;
  const autoNamed = FanoutChecker.parseMultiSchemeTxt(batch, 0);
  assert.strictEqual(autoNamed.length, 2, '应按 EDA 的 Item 1 重启切成两组');
  assert.ok(autoNamed[0].name.includes('BGA') && autoNamed[0].name.includes('L1-L5') && autoNamed[0].name.includes('2孔'), 'BGA 孔群名应包含类别、层跨和孔数');
  assert.ok(autoNamed[1].name.includes('SMA') && autoNamed[1].name.includes('L10-L14'), 'SMA 孔群名应反映 Padstack 层跨');
  assert.strictEqual(new Set(autoNamed.map(s => s.name)).size, 2, '自动名称应唯一');
  console.log('  PASS  批量 EDA TXT 按 Item 重启识别孔群并按 Padstack/层跨/孔数自动命名');
}

// 1. 数据解析测试
{
  const sampleTxt = `Total 3 Items
Item 1                < Via >
  Origin-xy:          [100.0, 200.0]
  Padstack Name:      SMA_Bot-L19_d2m6mil_via-0902
  Net:                SIG_P
  Circle Drill:       3.9400 Plated
Item 2                < Via >
  Origin-xy:          [100.0, 220.0]
  Padstack Name:      BGA_GND_pad1mil_0902
  Net:                GND
  Circle Drill:       3.9400 Plated
Item 3                < Via >
  Origin-xy:          [100.0, 180.0]
  Padstack Name:      BGA_GND_pad1mil_0902
  Net:                GND
  Circle Drill:       3.9400 Plated
`;

  const vias = parseViaData(sampleTxt);
  assert.strictEqual(vias.length, 3, '应解析出 3 个过孔');
  assert.strictEqual(vias[0].padstack, 'SMA_Bot-L19_d2m6mil_via-0902');
  assert.strictEqual(vias[0].net, 'SIG_P');
  assert.strictEqual(vias[0].x, 100.0);
  assert.strictEqual(vias[0].y, 200.0);
  console.log('  PASS  EDA TXT 过孔数据解析');
}

// 2. 空间聚类测试 (2mm / 78.74 mil 阈值)
{
  const vias = [
    // 组 1: 三孔聚类 (中心距 20 mil <= 78.74 mil)
    { id: 1, x: 100, y: 100, padstack: 'PAD_A', net: 'GND' },
    { id: 2, x: 100, y: 120, padstack: 'PAD_A', net: 'GND' },
    { id: 3, x: 100, y: 140, padstack: 'PAD_A', net: 'GND' },
    // 组 2: 远端双孔 (距离组1 500mil，两孔相距 30mil)
    { id: 4, x: 600, y: 600, padstack: 'PAD_B', net: 'SIG' },
    { id: 5, x: 600, y: 630, padstack: 'PAD_B', net: 'SIG' },
    // 孤立孔 (距离其他孔 > 1000mil)
    { id: 6, x: 2000, y: 2000, padstack: 'PAD_C', net: 'GND' }
  ];

  const clusters = clusterVias(vias, 78.740157); // 2mm
  assert.strictEqual(clusters.length, 3, '应分割出 3 个孔整体 (Clusters)');
  assert.strictEqual(clusters[0].viaCount, 3, '第一个孔整体包含 3 个孔');
  assert.strictEqual(clusters[1].viaCount, 2, '第二个孔整体包含 2 个孔');
  assert.strictEqual(clusters[2].viaCount, 1, '第三个孔整体为孤立单孔');
  console.log('  PASS  空间距离连通聚类算法 (2mm 连通分量)');
}

// 3. 扇出方案定义与旋转匹配测试
{
  const library = new FanoutLibrary();
  
  // 定义一个 L形 3孔方案: 信号孔在原点，两个地孔分别在 (0, 20) 和 (20, 0)
  const lScheme = new FanoutScheme({
    id: 'scheme_L_3via',
    name: 'L型3孔扇出方案',
    vias: [
      { id: 1, x: 0, y: 0, padstack: 'SIG_PAD', net: 'SIG', role: '信号孔' },
      { id: 2, x: 0, y: 20, padstack: 'GND_PAD', net: 'GND', role: '地孔1' },
      { id: 3, x: 20, y: 0, padstack: 'GND_PAD', net: 'GND', role: '地孔2' }
    ]
  });
  library.addScheme(lScheme);

  // 测试用例 A: 平移后的相同方案 (中心坐标平移到 1000, 2000)
  const clusterA = {
    viaCount: 3,
    vias: [
      { id: 101, x: 1000, y: 2000, padstack: 'SIG_PAD', net: 'SIG' },
      { id: 102, x: 1000, y: 2020, padstack: 'GND_PAD', net: 'GND' },
      { id: 103, x: 1020, y: 2000, padstack: 'GND_PAD', net: 'GND' }
    ],
    centroid: { x: 1006.6667, y: 2006.6667 },
    pairwiseDistances: [
      { dist: 20.0 },
      { dist: 20.0 },
      { dist: Math.hypot(20, 20) }
    ]
  };

  const resA = matchClusterToLibrary(clusterA, library, { distanceTolerance: 1.0 });
  assert.strictEqual(resA.pass, true, '平移后的标准结构应完全匹配');
  assert.strictEqual(resA.schemeName, 'L型3孔扇出方案');

  // 测试用例 B: 旋转 90度 后的方案 (0,0)->(1000,2000), (0,20)->(980,2000), (20,0)->(1000,2020)
  const clusterB = {
    viaCount: 3,
    vias: [
      { id: 201, x: 1000, y: 2000, padstack: 'SIG_PAD', net: 'SIG' },
      { id: 202, x: 980, y: 2000, padstack: 'GND_PAD', net: 'GND' },
      { id: 203, x: 1000, y: 2020, padstack: 'GND_PAD', net: 'GND' }
    ],
    centroid: { x: 993.3333, y: 2006.6667 },
    pairwiseDistances: [
      { dist: 20.0 },
      { dist: 20.0 },
      { dist: Math.hypot(20, 20) }
    ]
  };

  const resB = matchClusterToLibrary(clusterB, library, { distanceTolerance: 1.0 });
  assert.strictEqual(resB.pass, true, '旋转 90度后应通过刚体不变性匹配');
  console.log('  PASS  刚体平移与旋转不变性匹配算法');
}

// 4. Padstack 不一致报错与精准定位测试
{
  const library = new FanoutLibrary();
  library.addScheme(new FanoutScheme({
    id: 'scheme_sma_5via',
    name: 'SMA-Bot-L19-5孔方案',
    vias: [
      { id: 1, x: 0, y: 0, padstack: 'SMA_Bot-L19_d2m6mil_via-0902', net: 'SIG', role: '中心信号孔' },
      { id: 2, x: 0, y: 20, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '屏蔽地孔1' },
      { id: 3, x: 0, y: -20, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '屏蔽地孔2' },
      { id: 4, x: -20, y: 0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '屏蔽地孔3' },
      { id: 5, x: 20, y: 0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '屏蔽地孔4' }
    ]
  }));

  // 构造一个几何中心距完全一致，但中心信号孔被误用为普通地孔的异常孔群
  const defectCluster = {
    viaCount: 5,
    vias: [
      { id: 501, x: 500, y: 500, padstack: 'BGA_GND_pad1mil_0902', net: 'WRONG_NET' }, // 错误：中心孔应为 SMA_Bot-L19
      { id: 502, x: 500, y: 520, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
      { id: 503, x: 500, y: 480, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
      { id: 504, x: 480, y: 500, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
      { id: 505, x: 520, y: 500, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' }
    ],
    centroid: { x: 500, y: 500 },
    pairwiseDistances: [
      { dist: 20.0 }, { dist: 20.0 }, { dist: 20.0 }, { dist: 20.0 },
      { dist: 28.2843 }, { dist: 28.2843 }, { dist: 28.2843 }, { dist: 28.2843 },
      { dist: 40.0 }, { dist: 40.0 }
    ]
  };

  const res = matchClusterToLibrary(defectCluster, library, { distanceTolerance: 1.0 });
  assert.strictEqual(res.pass, false, 'Padstack 不符时应判定为不通过');
  assert.strictEqual(res.status, 'PADSTACK_MISMATCH', '状态应为 PADSTACK_MISMATCH');
  assert.strictEqual(res.padstackMismatches.length, 1, '应精确定位出 1 处 Padstack 不一致');
  assert.strictEqual(res.padstackMismatches[0].viaId, 501, '应指出孔 #501 Padstack 错误');
  assert.strictEqual(res.padstackMismatches[0].actualPadstack, 'BGA_GND_pad1mil_0902');
  assert.strictEqual(res.padstackMismatches[0].expectedPadstack, 'SMA_Bot-L19_d2m6mil_via-0902');
  console.log('  PASS  Padstack 不符时精准报错与定位孔位');
}

// 5. 孔心距超差报错测试
{
  const library = new FanoutLibrary();
  library.addScheme(new FanoutScheme({
    id: 'scheme_diff_2via',
    name: '差分对20mil标准间距',
    vias: [
      { id: 1, x: 0, y: 0, padstack: 'DIFF_VIA', net: 'P' },
      { id: 2, x: 0, y: 20, padstack: 'DIFF_VIA', net: 'N' }
    ]
  }));

  // 实测中心距为 30mil (超差 10mil > 2mil 容差)
  const distDefectCluster = {
    viaCount: 2,
    vias: [
      { id: 801, x: 0, y: 0, padstack: 'DIFF_VIA', net: 'P' },
      { id: 802, x: 0, y: 30, padstack: 'DIFF_VIA', net: 'N' }
    ],
    centroid: { x: 0, y: 15 },
    pairwiseDistances: [
      { dist: 30.0 }
    ]
  };

  const res = matchClusterToLibrary(distDefectCluster, library, { distanceTolerance: 2.0 });
  assert.strictEqual(res.pass, false, '中心距超差时应判定为不通过');
  assert.strictEqual(res.status, 'DISTANCE_MISMATCH', '状态应为 DISTANCE_MISMATCH');
  console.log('  PASS  孔中心距超差报错判定');
}

// 6. 完整运行器测试 (runFanoutInspection 与 1454 孔数据集)
{
  const largeFilePath = path.join(__dirname, 'sample/via_trce_airgap_data-2.txt');
  if (fs.existsSync(largeFilePath)) {
    const text = fs.readFileSync(largeFilePath, 'utf8');
    const library = new FanoutLibrary();
    library.loadStandardPresets();

    const t0 = Date.now();
    const result = runFanoutInspection(text, library, {
      clusterThreshold: 78.740157, // 2mm
      distanceTolerance: 2.0
    });
    const t1 = Date.now();

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.vias.length, 1454, '应解析 1454 个过孔');
    assert.ok(result.clusters.length > 0, '应成功分割孔整体');
    assert.ok(result.summary.passCount >= 0);
    console.log(`  PASS  全量 1454 过孔大数据集聚类与方案库比对 (耗时 ${t1 - t0} ms, 分割出 ${result.clusters.length} 个孔群, 通过 ${result.summary.passCount} 组)`);
  }
}


// -------------------------------------------------------------
// Test 8: 任意角度姿态（allowArbitraryRotation）
// -------------------------------------------------------------
{
  const library = new FanoutLibrary();
  library.addScheme(new FanoutScheme({
    id: 'scheme_rot37',
    name: 'L型3孔方案(任意角测试)',
    vias: [
      { id: 1, x: 0, y: 0, padstack: 'SIG_PAD', net: 'SIG', role: '信号孔' },
      { id: 2, x: 0, y: 20, padstack: 'GND_PAD', net: 'GND', role: '地孔1' },
      { id: 3, x: 20, y: 0, padstack: 'GND_PAD', net: 'GND', role: '地孔2' }
    ]
  }));

  const deg = 37;
  const rad = deg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const place = ([x, y]) => [x * cos - y * sin + 500, x * sin + y * cos + 700];
  const p0 = place([0, 0]), p1 = place([0, 20]), p2 = place([20, 0]);

  const vias = [
    { id: 101, x: p0[0], y: p0[1], padstack: 'SIG_PAD', net: 'SIG' },
    { id: 102, x: p1[0], y: p1[1], padstack: 'GND_PAD', net: 'GND' },
    { id: 103, x: p2[0], y: p2[1], padstack: 'GND_PAD', net: 'GND' }
  ];
  const centroid = {
    x: (p0[0] + p1[0] + p2[0]) / 3,
    y: (p0[1] + p1[1] + p2[1]) / 3
  };
  const pairwiseDistances = [
    { dist: dist2D(vias[0].x, vias[0].y, vias[1].x, vias[1].y) },
    { dist: dist2D(vias[0].x, vias[0].y, vias[2].x, vias[2].y) },
    { dist: dist2D(vias[1].x, vias[1].y, vias[2].x, vias[2].y) }
  ];
  const cluster = { viaCount: 3, vias, centroid, pairwiseDistances };

  // 默认（只试 0/90/180/270）：37° 姿态应判不出匹配
  const strict = matchClusterToLibrary(cluster, library, { distanceTolerance: 2.0 });
  assert.strictEqual(strict.pass, false, '默认正交口径不应把 37° 姿态判为通过');

  // 打开任意角度：应能识别并给出 37° 的姿态角
  const free = matchClusterToLibrary(cluster, library, { distanceTolerance: 2.0, allowArbitraryRotation: true });
  assert.strictEqual(free.pass, true, '开启任意角后应匹配成功，实际: ' + free.status);
  const angle = ((free.rotationAngle % 360) + 360) % 360;
  assert.ok(Math.abs(angle - 37) < 0.2, '识别出的旋转角应约 37°，实际 ' + angle);
  if (!free.alignment || free.alignment.maxPointDev > 1e-6) {
    throw new Error('识别姿态的点位偏差应为 0，实际 ' + (free.alignment && free.alignment.maxPointDev));
  }

  // 用识别出的姿态反算，应该精确复原原始孔位
  const rr = angle * Math.PI / 180;
  const cc = Math.cos(rr), ss = Math.sin(rr);
  const schemePts = [[0, 0], [0, 20], [20, 0]];
  const centroidScheme = { x: 20 / 3, y: 20 / 3 };
  let maxErr = 0;
  schemePts.forEach(([x, y]) => {
    let dx = x - centroidScheme.x, dy = y - centroidScheme.y;
    if (free.isMirrored) dx = -dx;
    const rx = dx * cc - dy * ss + cluster.centroid.x;
    const ry = dx * ss + dy * cc + cluster.centroid.y;
    const nearest = Math.min(...vias.map(v => Math.hypot(v.x - rx, v.y - ry)));
    if (nearest > maxErr) maxErr = nearest;
  });
  assert.ok(maxErr < 1e-6, '按识别姿态复原孔位应精确吻合，实际偏差 ' + maxErr.toExponential(2));

  // 候选角生成器：几何完全一致时 45°/135° 组合也应被推导出来
  const cands = candidateRotations(
    [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    [{ x: 0, y: 0 }, { x: 0, y: Math.hypot(10, 10) }],
    2.0, true, true
  );
  assert.ok(cands.some(a => Math.abs(a - 45) < 0.2 || Math.abs(a + 45) < 0.2),
    '应推导出 45° 候选角: ' + cands.join(','));
  console.log('  PASS  任意角度姿态：默认正交口径不变，开启后支持 37° 等非正交扇出');
}

console.log('\n结果: 全部 7 项单元测试通过！');

// -------------------------------------------------------------
// Test 7: 孔阵列子集/局部匹配与冗余地孔容差分析 (针对 image-7.png 复杂孔群)
// -------------------------------------------------------------
{
  // 构造一个包含 5 孔 SMA 十字方案 + 外围 4 个冗余 GND 地孔的 9 孔组合阵列
  const clusterVias = [
    // 方案主体: 5 孔标准十字
    { id: 101, x: 1000.0, y: 1000.0, padstack: 'SMA_L2_d2m6mil_via_0902', net: 'SIG' },
    { id: 102, x: 1000.0, y: 1020.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
    { id: 103, x: 1000.0, y: 980.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
    { id: 104, x: 980.0, y: 1000.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
    { id: 105, x: 1020.0, y: 1000.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
    // 外围冗余伴随地孔
    { id: 106, x: 960.0, y: 960.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
    { id: 107, x: 1040.0, y: 960.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
    { id: 108, x: 960.0, y: 1040.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
    { id: 109, x: 1040.0, y: 1040.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' }
  ];

  const library = new FanoutChecker.FanoutLibrary();
  library.loadStandardPresets();

  const cluster = {
    id: 'test_cluster_subset',
    vias: clusterVias,
    viaCount: clusterVias.length,
    centroid: { x: 1000.0, y: 1000.0 },
    bbox: { minX: 960, maxX: 1040, minY: 960, maxY: 1040, spanX: 80, spanY: 80, maxSpan: 113.13 }
  };

  const matchRes = FanoutChecker.matchClusterToLibrary(cluster, library, {
    distanceTolerance: 2.0,
    allowRotation: true,
    allowMirror: true,
    allowSubsetMatch: true,
    redundantViaPolicy: 'ANY_GND_REDUNDANT'
  });

  assert.strictEqual(matchRes.pass, true, '子集匹配应成功通过');
  assert.strictEqual(matchRes.isSubsetMatch, true, '应标记为子集匹配');
  assert.strictEqual(matchRes.status, 'SUBSET_MATCH_PASS', '状态应为 SUBSET_MATCH_PASS');
  assert.strictEqual(matchRes.matchedViaCount, 5, '应准确匹配 5 个方案过孔');
  assert.strictEqual(matchRes.redundantViaCount, 4, '应准确识别出 4 个冗余地孔');
  assert.deepStrictEqual(matchRes.redundantViaIds.sort(), [106, 107, 108, 109], '冗余孔 ID 清单应完全准确');

  console.log('  PASS  子集/局部匹配与冗余伴随地孔智能识别与容差分析');
}

// -------------------------------------------------------------
// Test 8: 信号孔定位 (Connections 筛选) 与伴随地孔适配调整建议
// -------------------------------------------------------------
{
  const txtSample = `
Item 1 < Via >
  Origin-xy: [1000.0, 1000.0]
  Net: DIFF_P
  Padstack Name: BGA-HDI-SIG-045drill-ring3_L1_L4
  Connections:
    Trace: 1 (Top)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 2 < Via >
  Origin-xy: [1020.0, 1000.0]
  Net: DIFF_N
  Padstack Name: BGA-HDI-SIG-045drill-ring3_L1_L4
  Connections:
    Trace: 1 (Top)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 3 < Via >
  Origin-xy: [1000.0, 1020.0]
  Net: GND
  Padstack Name: BGA-HDI-GND-045drill-ring3_L1_L4
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 4 < Via >
  Origin-xy: [1020.0, 1020.0]
  Net: GND
  Padstack Name: BGA-HDI-GND-045drill-ring3_L1_L4
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
`;

  const library = new FanoutChecker.FanoutLibrary();
  library.addScheme(new FanoutChecker.FanoutScheme({
    id: 'test_diff_scheme',
    name: 'TEST-DIFF-4VIA',
    vias: [
      { id: 1, x: 1000.0, y: 1000.0, net: 'DIFF_P', padstack: 'BGA-HDI-SIG-045drill-ring3_L1_L4' },
      { id: 2, x: 1020.0, y: 1000.0, net: 'DIFF_N', padstack: 'BGA-HDI-SIG-045drill-ring3_L1_L4' },
      { id: 3, x: 1000.0, y: 1020.0, net: 'GND', padstack: 'BGA-HDI-GND-045drill-ring3_L1_L4' },
      { id: 4, x: 1020.0, y: 1020.0, net: 'GND', padstack: 'BGA-HDI-GND-045drill-ring3_L1_L4' }
    ]
  }));

  const res = FanoutChecker.runFanoutInspection(txtSample, library);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.clusters.length, 1);
  assert.strictEqual(res.clusters[0].matchResult.pass, true);
  assert.strictEqual(res.clusters[0].matchResult.schemeName, 'TEST-DIFF-4VIA');

  console.log('  PASS  信号孔定位与伴随地孔方案精准匹配');
}

// 9. 导入 Trace (走线) 数据解析与孔群关联测试
{
  const fs = require('fs');
  const path = require('path');

  // 9a. 混合过孔 + 单段走线 (< Via > + < Trace Seg >，含直线 Seg 与 CW/CCW 圆弧 Arc seg)
  const sampleMixed = fs.readFileSync(path.join(__dirname, 'sample/via_trace_airgap_sample.txt'), 'utf8');
  const lib = new FanoutChecker.FanoutLibrary();
  lib.loadStandardPresets();
  const resMixed = FanoutChecker.runFanoutInspection(sampleMixed, lib);

  assert.strictEqual(resMixed.success, true);
  assert.strictEqual(resMixed.vias.length, 26, '应读取 26 个过孔');
  assert.strictEqual(resMixed.traces.length, 71, '应同时读取 71 个 < Trace Seg > 走线块');
  assert.strictEqual(resMixed.summary.totalTraceSegments, 71, '总走线段数应为 71');
  assert.strictEqual(resMixed.summary.traceArcCount, 33, '应精确识别 33 段圆弧走线');
  assert.strictEqual(resMixed.summary.traceLineCount, 38, '应精确识别 38 段直线走线');
  assert.deepStrictEqual(
    [...resMixed.summary.traceLayers].sort(),
    ['02G01P', '04IS01', '08IS03', '19IS08'],
    '应提取全部 4 个走线层 Subset'
  );
  assert.ok(
    resMixed.clusters.every(c => c.traceSummary && c.traceSummary.segmentCount > 0 && c.traceSummary.layers.length >= 2),
    '每个差分扇出孔群均应成功关联其扇出走线与出线层'
  );

  // 9b. 纯多段走线 (< Trace > 块内含多条 Seg 与 Arc seg，无过孔)
  const samplePureTrace = fs.readFileSync(path.join(__dirname, 'sample/走线示例.txt'), 'utf8');
  const resPure = FanoutChecker.runFanoutInspection(samplePureTrace, lib);
  assert.strictEqual(resPure.success, true, '纯走线文件也应成功读取而不报错');
  assert.strictEqual(resPure.pureTraceMode, true, '应标记为 pureTraceMode');
  assert.strictEqual(resPure.vias.length, 0);
  assert.strictEqual(resPure.traces.length, 10, '应解析 10 条 < Trace > 多段走线');
  assert.strictEqual(resPure.summary.totalTraceSegments, 16, '10 条走线合计应包含 16 个几何分段');
  assert.strictEqual(resPure.summary.traceArcCount, 2, '应包含 2 段圆弧');

  console.log('  PASS  导入 Trace / Trace Seg (直线+圆弧) 解析、纯走线模式与扇出孔群关联');
}

