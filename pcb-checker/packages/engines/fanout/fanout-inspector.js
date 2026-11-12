/* ============================================================================
 * fanout-inspector.js —— 信号单元配对、伴随地孔索引与全板扇出方案联检调度
 * ========================================================================== */
(function (root, factory) {
  var parser = (typeof module === "object" && module.exports) ? require("./fanout-parser.js") : root.FanoutChecker;
  var schemeMod = (typeof module === "object" && module.exports) ? require("./fanout-scheme.js") : root.FanoutChecker;
  var clusterMod = (typeof module === "object" && module.exports) ? require("./fanout-clustering.js") : root.FanoutChecker;
  var api = factory(parser, schemeMod, clusterMod);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FanoutChecker = Object.assign(root.FanoutChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (parser, schemeMod, clusterMod) {
  "use strict";
  var MM_PER_MIL = parser.MM_PER_MIL;
  var MIL_PER_MM = parser.MIL_PER_MM;
  var dist2D = parser.dist2D;
  var roundN = parser.roundN;
  var candidateRotations = parser.candidateRotations;
  var parseViaData = parser.parseViaData;
  var parseTraceData = parser.parseTraceData;
  var isSignalVia = parser.isSignalVia;
  var parseFanoutInputData = parser.parseFanoutInputData;
  var summarizeTraceData = parser.summarizeTraceData;
  var associateTracesWithClusters = parser.associateTracesWithClusters;
  var FanoutLibrary = schemeMod.FanoutLibrary;
  var clusterVias = clusterMod.clusterVias;
  var matchClusterToLibrary = clusterMod.matchClusterToLibrary;
  var matchClusterSubsetsIterative = clusterMod.matchClusterSubsetsIterative;
  var compareClusterWithScheme = clusterMod.compareClusterWithScheme;
  function buildGndSpatialIndex(gndVias, cellSize = 35) {
    const grid = new Map();
    for (let i = 0; i < gndVias.length; i++) {
      const v = gndVias[i];
      const gx = Math.floor(v.x / cellSize);
      const gy = Math.floor(v.y / cellSize);
      const key = (gx << 16) ^ gy;
      let list = grid.get(key);
      if (!list) {
        list = [];
        grid.set(key, list);
      }
      list.push(v);
    }

    function findGndNear(x, y, maxDist) {
      const gx = Math.floor(x / cellSize);
      const gy = Math.floor(y / cellSize);
      const radCells = Math.ceil(maxDist / cellSize);
      const results = [];

      for (let dx = -radCells; dx <= radCells; dx++) {
        for (let dy = -radCells; dy <= radCells; dy++) {
          const key = ((gx + dx) << 16) ^ (gy + dy);
          const list = grid.get(key);
          if (!list) continue;
          for (const v of list) {
            const d = Math.hypot(v.x - x, v.y - y);
            if (d <= maxDist) {
              results.push({ via: v, dist: d });
            }
          }
        }
      }
      return results;
    }

    return { findGndNear };
  }

  /**
   * 信号孔单元构建 (支持叠孔/微孔聚合与差分对精准配对)
   * 
   * 核心逻辑：
   * 1. 优先聚合在同一信号网络上垂直层叠 (Stacked Microvias, 距离 <= 3.0 mil) 的过孔为单个信号柱 (Signal Column)
   * 2. 对差分网络 (_P / _N)，精确将同一基础网络名称的 P 柱与 N 柱配对为差分对单元 (DIFF_PAIR)
   * 3. 计算真实的差分中心距 (P-N Pitch)，避免错误拆分叠孔导致误匹配
   */
  function groupSignalUnits(activeSignalVias, maxDiffDistMil = 35.0) {
    // 1. 分离差分信号与单端信号
    const diffGroups = new Map();
    const singleVias = [];

    for (let i = 0; i < activeSignalVias.length; i++) {
      const v = activeSignalVias[i];
      const isDiff = /_[PN]$/i.test(v.net);
      if (isDiff) {
        const baseNet = v.net.replace(/_[PN]$/i, '');
        let list = diffGroups.get(baseNet);
        if (!list) {
          list = [];
          diffGroups.set(baseNet, list);
        }
        list.push(v);
      } else {
        singleVias.push(v);
      }
    }

    const units = [];

    // 2. 差分对按基准网络与空间邻域距离 (<= 35 mil) 连通分量聚类
    // 从而完整囊括该差分对的所有信号孔 (例如微孔 + 通孔共 4 个信号孔的复合扇出方案)
    for (const [baseNet, vlist] of diffGroups.entries()) {
      const n = vlist.length;
      const parent = new Int32Array(n);
      for (let i = 0; i < n; i++) parent[i] = i;

      function find(i) {
        let root = i;
        while (root !== parent[root]) root = parent[root];
        let curr = i;
        while (curr !== root) {
          let nxt = parent[curr];
          parent[curr] = root;
          curr = nxt;
        }
        return root;
      }

      function union(i, j) {
        const rootI = find(i);
        const rootJ = find(j);
        if (rootI !== rootJ) parent[rootI] = rootJ;
      }

      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const d = Math.hypot(vlist[i].x - vlist[j].x, vlist[i].y - vlist[j].y);
          if (d <= maxDiffDistMil) {
            union(i, j);
          }
        }
      }

      const compMap = new Map();
      for (let i = 0; i < n; i++) {
        const root = find(i);
        let list = compMap.get(root);
        if (!list) {
          list = [];
          compMap.set(root, list);
        }
        list.push(vlist[i]);
      }

      for (const compVias of compMap.values()) {
        const pVias = compVias.filter(v => /_P$/i.test(v.net));
        const nVias = compVias.filter(v => /_N$/i.test(v.net));
        const sumX = compVias.reduce((s, v) => s + v.x, 0);
        const sumY = compVias.reduce((s, v) => s + v.y, 0);
        const count = compVias.length;

        units.push({
          id: `sig_unit_${units.length + 1}`,
          type: 'DIFF_PAIR',
          baseNet,
          net: `${baseNet}_P/${baseNet}_N`,
          signalVias: compVias,
          pCount: pVias.length,
          nCount: nVias.length,
          centroid: { x: sumX / count, y: sumY / count }
        });
      }
    }

    // 3. 单端信号过孔划分
    for (let i = 0; i < singleVias.length; i++) {
      const v = singleVias[i];
      units.push({
        id: `sig_unit_${units.length + 1}`,
        type: 'SINGLE_SIGNAL',
        baseNet: v.net,
        net: v.net,
        signalVias: [v],
        pCount: 0,
        nCount: 0,
        centroid: { x: v.x, y: v.y }
      });
    }

    return units;
  }

  /**
   * 扇出方案核心检查运行器 (遵循两阶段严格匹配哲学)：
   * 
   * 第一阶段 (信号孔锚定与方案锁定)：
   * - 首先只匹配孔群中的信号孔 (Padstack 与相对位置关系/中心距)。
   * - 若没有任何方案能在信号孔上匹配，直接判定为【未匹配方案的孔群 / 不匹配孔群】，不作地孔分析，不强行给出修改建议。
   * - 若信号孔成功匹配方案，则锁定该方案作为该孔群的唯一基准方案。
   * 
   * 第二阶段 (伴随地孔对照分析)：
   * - 在锁定的基准方案下，逐个对照方案库中的伴随地孔坐标与 Padstack：
   *   1. Padstack 不一致的地孔：标红并统计 Padstack 错误。
   *   2. 缺失的地孔：标为缺失 (CAD 绘制黄色虚线圆)。
   *   3. 方案外多余的地孔：识别为冗余地孔 (不判错，只要方案要求的地孔均满足即判定通过)。
   */
  /**
   * 扇出方案核心检查运行器 (遵循两阶段严格匹配哲学，支持刚体旋转 0/90/180/270度与上下/左右镜像翻转)：
   * 
   * 第一阶段 (信号孔锚定与方案空间旋转/镜像对齐)：
   * - 针对信号孔 Padstack 与相对位置完全符合的所有方案及旋转/镜像变换姿态，遍历评估对应伴随地孔的匹配度。
   * - 若没有任何方案能在信号孔上匹配，直接判定为【未匹配方案的孔群 / 不匹配孔群】，不作地孔虚假分析，不强行给出修改建议。
   * 
   * 第二阶段 (伴随地孔对照分析与最佳刚体姿态判定)：
   * - 对所有符合信号孔的刚体姿态进行地孔比对：
   *   1. 只要存在一种旋转/镜像姿态使得伴随地孔完全符合（0 缺失、0 Padstack 错误），即判定为【完全匹配通过】！
   *   2. 若某姿态地孔存在缺陷，则锁定最匹配姿态，精准报告地孔 Padstack 错误或缺失孔坐标。
   */
  function runFanoutInspection(inputData, library, options = {}) {
    const startTime = Date.now();
    const allowArbitraryRotation = options.allowArbitraryRotation === true; // 任意角度姿态（默认关闭）

    // 1. 同时解析过孔 (Via) 与走线 (Trace) 数据
    let vias = [];
    let traces = [];
    if (typeof inputData === 'string') {
      vias = parseViaData(inputData);
      traces = parseTraceData(inputData);
    } else if (Array.isArray(inputData)) {
      vias = inputData;
      traces = Array.isArray(options.traces) ? options.traces : [];
    } else if (inputData && typeof inputData === 'object') {
      vias = Array.isArray(inputData.vias) ? inputData.vias : [];
      traces = Array.isArray(inputData.traces) ? inputData.traces : [];
    }

    const traceSummary = summarizeTraceData(traces);

    if (vias.length === 0 && traces.length === 0) {
      return {
        success: false,
        error: '未解析到任何过孔或走线数据，请检查输入格式。',
        vias: [],
        traces: [],
        clusters: [],
        summary: null
      };
    }

    // 纯走线文件支持：当仅包含 < Trace > / < Trace Seg > 而无过孔时，仍返回已解析走线供浏览与 2D 可视化
    if (vias.length === 0 && traces.length > 0) {
      const elapsedMs = Date.now() - startTime;
      return {
        success: true,
        pureTraceMode: true,
        vias: [],
        traces,
        traceSummary,
        clusters: [],
        summary: {
          totalVias: 0,
          totalSignalVias: 0,
          totalTraces: traceSummary.totalTraces,
          totalTraceSegments: traceSummary.totalTraceSegments,
          traceLineCount: traceSummary.traceLineCount,
          traceArcCount: traceSummary.traceArcCount,
          totalTraceLength: traceSummary.totalTraceLength,
          traceLayers: traceSummary.layers.map(l => l.layer),
          traceNets: traceSummary.nets.map(n => n.net),
          totalClusters: 0,
          passCount: 0,
          exactPassCount: 0,
          subsetPassCount: 0,
          failCount: 0,
          passRate: 0,
          padstackFailCount: 0,
          distFailCount: 0,
          noMatchCount: 0,
          schemeCoverage: {},
          elapsedMs,
          clusterThreshold: 80.0,
          clusterThresholdMm: 80.0 * MM_PER_MIL
        }
      };
    }

    const distTol = options.distanceTolerance != null ? options.distanceTolerance : 2.0;
    const allowRotation = options.allowRotation !== false;
    const allowMirror = options.allowMirror !== false;

    // 2. 筛选信号孔 (优先筛选有 Connections 信息的信号孔，兜底全量信号孔)
    const gndVias = vias.filter(v => v.net && v.net.toUpperCase().includes('GND'));
    const allSignalVias = vias.filter(v => !v.net || !v.net.toUpperCase().includes('GND'));
    let activeSignalVias = allSignalVias.filter(v => v.hasConnections);

    if (activeSignalVias.length === 0) {
      activeSignalVias = allSignalVias;
    }

    // 3. 构建伴随地孔空间网格索引
    const gndIndex = buildGndSpatialIndex(gndVias, 35);

    // 4. 构建信号孔扇出单元 (差分对/单端信号孔，已自动聚合垂直层叠叠孔)
    const signalUnits = groupSignalUnits(activeSignalVias, 35.0);

    let passCount = 0;
    let exactPassCount = 0;
    let subsetPassCount = 0;
    let padstackFailCount = 0;
    let topologyFailCount = 0;
    let noMatchCount = 0;
    const schemeCoverage = {};
    const clusterUnits = [];

    // 5. 逐个信号单元执行多姿态两阶段严格检查
    for (let uIdx = 0; uIdx < signalUnits.length; uIdx++) {
      const unit = signalUnits[uIdx];
      const unitSigVias = unit.signalVias;

      // 获取周围 80 mil 范围内的伴随地孔
      const nearbyGndItems = gndIndex.findGndNear(unit.centroid.x, unit.centroid.y, 80.0);
      const nearbyGnd = nearbyGndItems.map(item => item.via);
      const candidateVias = [...unit.signalVias, ...nearbyGnd];

      // 计算孔群包围盒
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      candidateVias.forEach(v => {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      });
      const spanX = maxX - minX;
      const spanY = maxY - minY;
      const maxSpan = Math.hypot(spanX, spanY);

      // 第一阶段与第二阶段综合评估：搜索所有在【信号孔 Padstack 与相对位置】上匹配的方案及旋转/镜像姿态
      const candidateEvaluations = [];

      for (const scheme of library.schemes) {
        if (!scheme.vias || scheme.vias.length === 0) continue;

        const schemeSigVias = scheme.vias.filter(v => v.net && !v.net.toUpperCase().includes('GND'));
        const schemeGndVias = scheme.vias.filter(v => !v.net || v.net.toUpperCase().includes('GND') || (v.padstack && v.padstack.toUpperCase().includes('GND')));

        // 信号孔数量必须一致
        if (schemeSigVias.length !== unitSigVias.length) continue;

        const angles = candidateRotations(unitSigVias, schemeSigVias, distTol, allowRotation, allowArbitraryRotation);
        const mirrors = allowMirror ? [false, true] : [false];
        const s0 = schemeSigVias[0];

        for (const mirror of mirrors) {
          for (const deg of angles) {
            const rad = (deg * Math.PI) / 180;
            const cosA = Math.cos(rad);
            const sinA = Math.sin(rad);

            // 变换方案信号孔相对坐标
            const relSig = schemeSigVias.map(sv => {
              let dx = sv.x - s0.x;
              let dy = sv.y - s0.y;
              if (mirror) dx = -dx;
              const rx = dx * cosA - dy * sinA;
              const ry = dx * sinA + dy * cosA;
              return { sv, relX: rx, relY: ry };
            });

            // 尝试锚定到单元内的每个候选信号孔 u0
            for (const u0 of unitSigVias) {
              if ((u0.padstack || '').trim().toLowerCase() !== (s0.padstack || '').trim().toLowerCase()) {
                continue;
              }

              const usedSigIdx = new Set();
              let allSigMatched = true;

              for (const item of relSig) {
                const expX = u0.x + item.relX;
                const expY = u0.y + item.relY;

                let foundIdx = -1;
                for (let k = 0; k < unitSigVias.length; k++) {
                  if (usedSigIdx.has(k)) continue;
                  const uv = unitSigVias[k];
                  if (Math.hypot(uv.x - expX, uv.y - expY) <= distTol) {
                    if ((uv.padstack || '').trim().toLowerCase() === (item.sv.padstack || '').trim().toLowerCase()) {
                      foundIdx = k;
                      break;
                    }
                  }
                }

                if (foundIdx !== -1) {
                  usedSigIdx.add(foundIdx);
                } else {
                  allSigMatched = false;
                  break;
                }
              }

              if (allSigMatched && usedSigIdx.size === unitSigVias.length) {
                // 信号孔完全匹配！立即对当前刚体姿态进行地孔比对
                const usedGndIndices = new Set();
                const padMismatchList = [];
                const missingVias = [];
                let matchedGndCount = 0;
                const audit = [];

                for (let j = 0; j < schemeGndVias.length; j++) {
                  const sv = schemeGndVias[j];
                  let dx = sv.x - s0.x;
                  let dy = sv.y - s0.y;
                  if (mirror) dx = -dx;
                  const rx = dx * cosA - dy * sinA;
                  const ry = dx * sinA + dy * cosA;
                  const expX = u0.x + rx;
                  const expY = u0.y + ry;

                  let bestGndIdx = -1;
                  let minDist = distTol;

                  for (let k = 0; k < nearbyGnd.length; k++) {
                    if (usedGndIndices.has(k)) continue;
                    const gv = nearbyGnd[k];
                    const d = Math.hypot(gv.x - expX, gv.y - expY);
                    if (d <= minDist) {
                      if ((gv.padstack || '').trim().toLowerCase() === (sv.padstack || '').trim().toLowerCase()) {
                        minDist = d;
                        bestGndIdx = k;
                        break;
                      } else if (bestGndIdx === -1 || d < minDist) {
                        minDist = d;
                        bestGndIdx = k;
                      }
                    }
                  }

                  if (bestGndIdx !== -1) {
                    usedGndIndices.add(bestGndIdx);
                    const gv = nearbyGnd[bestGndIdx];
                    matchedGndCount++;

                    const isPadMatch = (gv.padstack || '').trim().toLowerCase() === (sv.padstack || '').trim().toLowerCase();
                    if (!isPadMatch) {
                      padMismatchList.push({
                        viaId: gv.id,
                        net: gv.net,
                        actualPadstack: gv.padstack,
                        expectedPadstack: sv.padstack,
                        role: sv.role || (`伴随地孔${sv.id}`)
                      });
                    }

                    audit.push({
                      viaIndex: j + 1,
                      viaId: gv.id,
                      net: gv.net,
                      x: gv.x,
                      y: gv.y,
                      actualPadstack: gv.padstack,
                      expectedPadstack: sv.padstack,
                      role: sv.role || (`伴随地孔${sv.id}`),
                      isMatch: isPadMatch,
                      deviation: minDist
                    });
                  } else {
                    missingVias.push({
                      expectedX: expX,
                      expectedY: expY,
                      expectedPadstack: sv.padstack,
                      role: sv.role || (`伴随地孔${sv.id}`),
                      net: sv.net || 'GND'
                    });
                  }
                }

                const isPass = (padMismatchList.length === 0 && missingVias.length === 0);
                const redundantGndCount = nearbyGnd.length - matchedGndCount;

                candidateEvaluations.push({
                  scheme,
                  schemeName: scheme.name,
                  schemeId: scheme.id,
                  angle: deg,
                  mirror,
                  pass: isPass,
                  matchedGndCount,
                  schemeGndCount: schemeGndVias.length,
                  redundantGndCount,
                  padMismatchList,
                  missingVias,
                  audit
                });

                if (isPass) break; // 当前方案该姿态完全匹配通过
              }
            }
          }
        }
      }

      // 情况 A: 没有任何方案在信号孔上通过比对 -> 判定为【不匹配孔群】，不作地孔虚假分析
      if (candidateEvaluations.length === 0) {
        noMatchCount++;
        const matchRes = {
          status: 'NO_MATCH_TOPOLOGY',
          statusText: '不匹配孔群 (未匹配方案)',
          pass: false,
          isSubsetMatch: false,
          schemeName: '未匹配方案',
          schemeId: null,
          maxDeviation: 0,
          maxDeviationMm: 0,
          rotationAngle: 0,
          isMirrored: false,
          message: `该孔群中信号孔 Padstack 或相对中心距未能与方案库中任何方案匹配`,
          advice: '信号孔未匹配方案库模板，无需进行伴随地孔分析。',
          padMismatchList: [],
          missingVias: [],
          viaAudit: []
        };

        clusterUnits.push({
          id: `sig_unit_${uIdx + 1}`,
          vias: candidateVias,
          viaCount: candidateVias.length,
          signalVias: unit.signalVias,
          signalNet: unit.net,
          centroid: unit.centroid,
          bbox: { minX, maxX, minY, maxY, spanX, spanY, maxSpan },
          matchResult: matchRes
        });
        continue;
      }

      // 情况 B: 优先寻找是否存在完全匹配通过 (0 Padstack 错误、0 缺失孔) 的旋转/镜像姿态
      let bestEval = candidateEvaluations.find(e => e.pass);

      if (!bestEval) {
        // 若没有完全通过，按地孔匹配数最高、缺陷数最少排序选择最佳姿态
        candidateEvaluations.sort((a, b) => {
          if (b.matchedGndCount !== a.matchedGndCount) return b.matchedGndCount - a.matchedGndCount;
          const defectsA = a.padMismatchList.length + a.missingVias.length;
          const defectsB = b.padMismatchList.length + b.missingVias.length;
          return defectsA - defectsB;
        });
        bestEval = candidateEvaluations[0];
      }

      const s = bestEval.scheme;
      const isPass = bestEval.pass;

      if (isPass) {
        passCount++;
        if (bestEval.redundantGndCount > 0) subsetPassCount++;
        else exactPassCount++;
        schemeCoverage[s.name] = (schemeCoverage[s.name] || 0) + 1;

        const redundantStr = bestEval.redundantGndCount > 0 ? ` (含 ${bestEval.redundantGndCount} 个冗余地孔)` : '';
        const rotStr = bestEval.angle !== 0 ? ` [旋转 ${bestEval.angle}°]` : '';
        const mirStr = bestEval.mirror ? ` [镜像翻转]` : '';

        const matchRes = {
          status: 'MATCH_PASS',
          statusText: bestEval.redundantGndCount > 0 ? `匹配通过 (含${bestEval.redundantGndCount}冗余孔)` : '完全匹配通过',
          pass: true,
          isSubsetMatch: bestEval.redundantGndCount > 0,
          schemeName: s.name,
          schemeId: s.id,
          matchedViaCount: unitSigVias.length + bestEval.matchedGndCount,
          redundantViaCount: bestEval.redundantGndCount,
          maxDeviation: 0,
          maxDeviationMm: 0,
          rotationAngle: bestEval.angle,
          isMirrored: bestEval.mirror,
          message: `✅ 对照方案【${s.name}】匹配通过${rotStr}${mirStr} (信号网络: ${unit.net}${redundantStr}，Padstack 与地孔完全符合)`,
          advice: '信号孔与伴随地孔完全符合方案规范，无需调整。',
          padMismatchList: [],
          missingVias: [],
          viaAudit: bestEval.audit
        };

        clusterUnits.push({
          id: `sig_unit_${uIdx + 1}`,
          vias: candidateVias,
          viaCount: candidateVias.length,
          signalVias: unit.signalVias,
          signalNet: unit.net,
          centroid: unit.centroid,
          bbox: { minX, maxX, minY, maxY, spanX, spanY, maxSpan },
          matchResult: matchRes
        });
      } else {
        let adviceText = '';
        let reasonText = '';
        let status = 'DISTANCE_MISMATCH';
        let statusText = '伴随地孔存在异常';

        const padMismatchList = bestEval.padMismatchList;
        const missingVias = bestEval.missingVias;

        if (padMismatchList.length > 0 && missingVias.length === 0) {
          padstackFailCount++;
          status = 'PADSTACK_MISMATCH';
          statusText = '地孔Padstack不符';
          const padAdv = padMismatchList.map(p => `将地孔 #${p.viaId} Padstack 由「${p.actualPadstack}」调整为「${p.expectedPadstack}」`).join('；');
          reasonText = `信号孔已锁定方案【${s.name}】，但存在 ${padMismatchList.length} 处伴随地孔 Padstack 不符`;
          adviceText = `【地孔Padstack调整建议】: ${padAdv}。`;
        } else if (missingVias.length > 0) {
          topologyFailCount++;
          status = 'DISTANCE_MISMATCH';
          statusText = '伴随地孔缺失/位置偏差';
          const missAdv = missingVias.slice(0, 3).map(m => `在坐标 [${m.expectedX.toFixed(1)}, ${m.expectedY.toFixed(1)}] 补齐 1 个伴随地孔 (${m.expectedPadstack})`).join('；');
          const padAdv = padMismatchList.length > 0 ? `；同时修正地孔 #${padMismatchList[0].viaId} Padstack 为「${padMismatchList[0].expectedPadstack}」` : '';
          reasonText = `信号孔已锁定方案【${s.name}】，但缺少 ${missingVias.length} 个伴随地孔`;
          adviceText = `【补地孔建议】: ${missAdv}${padAdv}。`;
        }

        const matchRes = {
          status,
          statusText,
          pass: false,
          isSubsetMatch: false,
          schemeName: s.name,
          schemeId: s.id,
          maxDeviation: 0,
          maxDeviationMm: 0,
          rotationAngle: bestEval.angle,
          isMirrored: bestEval.mirror,
          message: reasonText,
          advice: adviceText,
          padMismatchList,
          missingVias,
          viaAudit: bestEval.audit
        };

        clusterUnits.push({
          id: `sig_unit_${uIdx + 1}`,
          vias: candidateVias,
          viaCount: candidateVias.length,
          signalVias: unit.signalVias,
          signalNet: unit.net,
          centroid: unit.centroid,
          bbox: { minX, maxX, minY, maxY, spanX, spanY, maxSpan },
          matchResult: matchRes
        });
      }
    }

    // 6. 将导入的走线 (Trace) 与各扇出孔群及信号过孔关联
    associateTracesWithClusters(vias, clusterUnits, traces, 18.0);

    const elapsedMs = Date.now() - startTime;
    const failCount = padstackFailCount + topologyFailCount + noMatchCount;
    const passRate = signalUnits.length > 0 ? (passCount / signalUnits.length) * 100 : 0;

    const summary = {
      totalVias: vias.length,
      totalSignalVias: activeSignalVias.length,
      totalTraces: traceSummary.totalTraces,
      totalTraceSegments: traceSummary.totalTraceSegments,
      traceLineCount: traceSummary.traceLineCount,
      traceArcCount: traceSummary.traceArcCount,
      totalTraceLength: traceSummary.totalTraceLength,
      traceLayers: traceSummary.layers.map(l => l.layer),
      traceNets: traceSummary.nets.map(n => n.net),
      totalClusters: signalUnits.length,
      passCount,
      exactPassCount,
      subsetPassCount,
      failCount,
      passRate: roundN(passRate, 1),
      padstackFailCount,
      distFailCount: topologyFailCount,
      noMatchCount,
      schemeCoverage,
      elapsedMs,
      clusterThreshold: 80.0,
      clusterThresholdMm: 80.0 * MM_PER_MIL
    };

    return {
      success: true,
      vias,
      traces,
      traceSummary,
      clusters: clusterUnits,
      summary
    };
  }
  return {
    buildGndSpatialIndex: buildGndSpatialIndex,
    groupSignalUnits: groupSignalUnits,
    runFanoutInspection: runFanoutInspection
  };
});
