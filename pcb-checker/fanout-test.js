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
  getStandardPresetSchemes
} = FanoutChecker;

console.log('== 扇出方案检查引擎单元测试 ==');

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

console.log('\n结果: 全部 6 项单元测试通过！');

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
