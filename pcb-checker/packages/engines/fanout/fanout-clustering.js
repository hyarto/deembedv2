/* ============================================================================
 * fanout-clustering.js —— 空间连通分量孔群分割与刚体旋转/镜像/子集比对算法
 * ========================================================================== */
(function (root, factory) {
var parser = (typeof module === "object" && module.exports) ? require("./fanout-parser.js") : root.FanoutChecker;
  var api = factory(parser);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FanoutChecker = Object.assign(root.FanoutChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (parser) {
  "use strict";
  var MM_PER_MIL = parser.MM_PER_MIL;
  var MIL_PER_MM = parser.MIL_PER_MM;
  var dist2D = parser.dist2D;
  var roundN = parser.roundN;
  var candidateRotations = parser.candidateRotations;
  function clusterVias(vias, thresholdDist = 78.740157) {
    if (!vias || vias.length === 0) return [];
    const n = vias.length;
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
    const cellSize = Math.max(thresholdDist, 1.0);
    const grid = new Map();
    for (let i = 0; i < n; i++) {
      const v = vias[i];
      const gx = Math.floor(v.x / cellSize);
      const gy = Math.floor(v.y / cellSize);
      const key = `${gx},${gy}`;
      let list = grid.get(key);
      if (!list) {
        list = [];
        grid.set(key, list);
      }
      list.push(i);
    }
    const threshSq = thresholdDist * thresholdDist;
    for (let i = 0; i < n; i++) {
      const v = vias[i];
      const gx = Math.floor(v.x / cellSize);
      const gy = Math.floor(v.y / cellSize);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${gx + dx},${gy + dy}`;
          const list = grid.get(key);
          if (!list) continue;
          for (let k = 0; k < list.length; k++) {
            const j = list[k];
            if (j <= i) continue;
            const other = vias[j];
            const distSq = (v.x - other.x) * (v.x - other.x) + (v.y - other.y) * (v.y - other.y);
            if (distSq <= threshSq) union(i, j); }
  } }
  }
    const groupMap = new Map();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      let group = groupMap.get(root);
      if (!group) {
        group = [];
        groupMap.set(root, group);
      }
      group.push(vias[i]);
    }
    const clusters = [];
    let clusterIdx = 1;
    for (const members of groupMap.values()) {
      let sumX = 0, sumY = 0;
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        sumX += m.x; sumY += m.y;
        if (m.x < minX) minX = m.x;
        if (m.x > maxX) maxX = m.x;
        if (m.y < minY) minY = m.y;
        if (m.y > maxY) maxY = m.y;
      }
      const count = members.length;
      const centroidX = sumX / count;
      const centroidY = sumY / count;
      const spanX = maxX - minX;
      const spanY = maxY - minY;
      const maxSpan = Math.hypot(spanX, spanY);
      const pairwiseDistances = [];
      if (count <= 100) {
        for (let i = 0; i < count; i++) {
          for (let j = i + 1; j < count; j++) {
            const d = Math.hypot(members[i].x - members[j].x, members[i].y - members[j].y);
            pairwiseDistances.push({ v1: members[i].id, v2: members[j].id, dist: d, distMm: d * MM_PER_MIL }); }
  }
      }
      const padstackCounts = {};
      for (let i = 0; i < count; i++) {
        const p = members[i].padstack || 'UNKNOWN';
        padstackCounts[p] = (padstackCounts[p] || 0) + 1;
      }
      clusters.push({
        id: `cluster_${clusterIdx++}`,
        viaCount: count,
        vias: members,
        centroid: { x: centroidX, y: centroidY },
        bbox: { minX, maxX, minY, maxY, spanX, spanY, maxSpan },
        pairwiseDistances,
        padstackCounts
      });
    }
    return clusters;
  }
  function matchClusterSubsetsIterative(cluster, library, options = {}) {
    const distTol = options.distanceTolerance != null ? options.distanceTolerance : 2.0;
    const allowRotation = options.allowRotation !== false;
    const allowMirror = options.allowMirror !== false;
    const redundantPolicy = options.redundantViaPolicy || 'ANY_GND_REDUNDANT';
    const K = cluster.vias.length;
    const candidateSchemes = library.schemes
      .filter(s => s.vias && s.vias.length > 0 && s.vias.length <= K)
      .sort((a, b) => b.vias.length - a.vias.length);
    if (candidateSchemes.length === 0) return null;
    const cellSize = Math.max(10, distTol * 3);
    const grid = new Map();
    for (let i = 0; i < K; i++) {
      const v = cluster.vias[i];
      const gx = Math.floor(v.x / cellSize);
      const gy = Math.floor(v.y / cellSize);
      const key = (gx << 16) ^ gy;
      let list = grid.get(key);
      if (!list) {
        list = [];
        grid.set(key, list);
      }
      list.push(i);
    }
    function findClosestViaInGrid(expectedX, expectedY, usedSet) {
      const gx = Math.floor(expectedX / cellSize);
      const gy = Math.floor(expectedY / cellSize);
      let bestIdx = -1;
      let minDist = distTol;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = ((gx + dx) << 16) ^ (gy + dy);
          const list = grid.get(key);
          if (!list) continue;
          for (let idx of list) {
            if (usedSet.has(idx)) continue;
            const cv = cluster.vias[idx];
            const d = Math.hypot(cv.x - expectedX, cv.y - expectedY);
            if (d <= minDist) {
              minDist = d;
              bestIdx = idx; }
  } }
  }
      return { idx: bestIdx, dist: minDist };
    }
    const rawCandidates = [];
    const matchedSubSchemes = [];
    const claimedSignalViaIds = new Set();
    const allMatchedViaIds = new Set();
    for (const scheme of candidateSchemes) {
      const M = scheme.vias.length;
      let anchorSchemeIdx = scheme.vias.findIndex(v => v.net && !v.net.toUpperCase().includes('GND'));
      if (anchorSchemeIdx < 0) anchorSchemeIdx = 0;
      const s0 = scheme.vias[anchorSchemeIdx];
      const isSignalAnchor = s0.net && !s0.net.toUpperCase().includes('GND');
      let candidateIndices = [];
      for (let i = 0; i < K; i++) {
        const cv = cluster.vias[i];
        if (isSignalAnchor) {
          if (cv.net && !cv.net.toUpperCase().includes('GND') && !claimedSignalViaIds.has(cv.id)) {
            candidateIndices.push(i); }
  } else {
          candidateIndices.push(i); }
  }
      if (candidateIndices.length === 0) continue;
      const angles = allowRotation ? [0, 90, 180, 270] : [0];
      const mirrors = allowMirror ? [false, true] : [false];
      for (const mirror of mirrors) {
        for (const deg of angles) {
          const rad = (deg * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const relScheme = scheme.vias.map((sv, idx) => {
            let dx = sv.x - s0.x;
            let dy = sv.y - s0.y;
            if (mirror) dx = -dx;
            const rx = dx * cos - dy * sin;
            const ry = dx * sin + dy * cos;
            return { ...sv, relX: rx, relY: ry, origIdx: idx };
          });
          for (let ciIdx of candidateIndices) {
            const ci = cluster.vias[ciIdx];
            if (isSignalAnchor && claimedSignalViaIds.has(ci.id)) continue;
            const usedIndices = new Set();
            let maxDev = 0;
            let totalDev = 0;
            let padMismatchCount = 0;
            let allFound = true;
            const audit = [];
            for (let j = 0; j < M; j++) {
              const sv = relScheme[j];
              const expX = ci.x + sv.relX;
              const expY = ci.y + sv.relY;
              const match = findClosestViaInGrid(expX, expY, usedIndices);
              if (match.idx !== -1) {
                usedIndices.add(match.idx);
                const cv = cluster.vias[match.idx];
                if (match.dist > maxDev) maxDev = match.dist;
                totalDev += match.dist;
                const isPadMatch = (cv.padstack || '').trim().toLowerCase() === (sv.padstack || '').trim().toLowerCase();
                if (!isPadMatch) padMismatchCount++;
                audit.push({
                  viaIndex: j + 1,
                  viaId: cv.id,
                  net: cv.net,
                  x: cv.x,
                  y: cv.y,
                  actualPadstack: cv.padstack,
                  expectedPadstack: sv.padstack,
                  schemeViaId: sv.id,
                  schemeRole: sv.role || (`孔${sv.id}`),
                  isMatch: isPadMatch,
                  deviation: match.dist
                });
              } else {
                allFound = false;
                break; }
  }
            if (allFound) {
              const matchedIds = Array.from(usedIndices).map(idx => cluster.vias[idx].id);
              rawCandidates.push({
                schemeName: scheme.name,
                schemeId: scheme.id,
                schemeCategory: scheme.category,
                viaCount: M,
                angle: deg,
                mirror,
                maxDeviation: maxDev,
                avgDeviation: totalDev / M,
                padMismatchCount,
                matchedViaIds: matchedIds,
                signalViaIds: matchedIds.filter(id => {
                  const v = cluster.vias.find(x => x.id === id);
                  return v && v.net && !v.net.toUpperCase().includes('GND');
                }),
                audit
              }); }
  } }
  }
    }
    rawCandidates.sort((a, b) => {
      if (a.padMismatchCount !== b.padMismatchCount) return a.padMismatchCount - b.padMismatchCount;
      if (b.viaCount !== a.viaCount) return b.viaCount - a.viaCount;
      return a.maxDeviation - b.maxDeviation;
    });
    for (const cand of rawCandidates) {
      const hasConflict = cand.signalViaIds.some(id => claimedSignalViaIds.has(id));
      if (hasConflict) continue;
      cand.signalViaIds.forEach(id => claimedSignalViaIds.add(id));
      cand.matchedViaIds.forEach(id => allMatchedViaIds.add(id));
      matchedSubSchemes.push(cand);
    }
    if (matchedSubSchemes.length === 0) return null;
    const redundantVias = cluster.vias.filter(v => !allMatchedViaIds.has(v.id));
    const redundantViaIds = redundantVias.map(v => v.id);
    const redundantGndVias = redundantVias.filter(v => !v.net || v.net.toUpperCase().includes('GND'));
    const redundantSignalVias = redundantVias.filter(v => v.net && !v.net.toUpperCase().includes('GND'));
    const totalPadMismatches = matchedSubSchemes.reduce((sum, m) => sum + m.padMismatchCount, 0);
    const pass = totalPadMismatches === 0;
    let status = pass ? 'SUBSET_MATCH_PASS' : 'SUBSET_PADSTACK_MISMATCH';
    let statusText = pass 
      ? (redundantVias.length > 0 ? `匹配通过 (含${redundantVias.length}个冗余孔)` : '完全匹配通过')
      : '子集Padstack不符';
    const schemeCounts = {};
    matchedSubSchemes.forEach(m => {
      schemeCounts[m.schemeName] = (schemeCounts[m.schemeName] || 0) + 1;
    });
    const schemeSummary = Object.entries(schemeCounts)
      .map(([name, count]) => count > 1 ? `【${name}】×${count}` : `【${name}】`)
      .join(' + ');
    const redundancyStr = redundantVias.length > 0 
      ? `，包含 ${redundantVias.length} 个冗余孔 (${redundantGndVias.length} 伴随地孔${redundantSignalVias.length > 0 ? `, ${redundantSignalVias.length} 信号孔` : ''})`
      : ' (无冗余孔)';
    const maxDev = Math.max(...matchedSubSchemes.map(m => m.maxDeviation));
    let message = pass
      ? `✅ 匹配扇出方案 ${schemeSummary}${redundancyStr}，中心距最大偏差 ${roundN(maxDev, 2)} mil，方案过孔 Padstack 完全符合`
      : `子集拓扑匹配 ${schemeSummary}${redundancyStr}，但其中 ${totalPadMismatches} 个过孔的 Padstack 与方案不一致`;
    const primaryMatch = matchedSubSchemes[0];
    const fullViaAudit = [];
    matchedSubSchemes.forEach(sm => fullViaAudit.push(...sm.audit));
    redundantVias.forEach(rv => {
      fullViaAudit.push({
        viaIndex: fullViaAudit.length + 1,
        viaId: rv.id,
        net: rv.net || 'GND',
        x: rv.x,
        y: rv.y,
        actualPadstack: rv.padstack,
        expectedPadstack: '(外围冗余孔)',
        schemeViaId: null,
        schemeRole: '伴随屏蔽/冗余地孔',
        isMatch: true,
        isRedundant: true,
        deviation: 0
      });
    });
    return {
      status,
      statusText,
      pass,
      isSubsetMatch: true,
      schemeName: schemeSummary,
      schemeId: primaryMatch.schemeId,
      schemeCategory: primaryMatch.schemeCategory,
      subMatches: matchedSubSchemes,
      rotationAngle: primaryMatch.angle,
      isMirrored: primaryMatch.mirror,
      maxDeviation: maxDev,
      maxDeviationMm: maxDev * MM_PER_MIL,
      matchedViaCount: allMatchedViaIds.size,
      redundantViaCount: redundantVias.length,
      redundantViaIds,
      redundantGndCount: redundantGndVias.length,
      redundantSignalCount: redundantSignalVias.length,
      padMismatchCount: totalPadMismatches,
      matchScore: pass ? 0.95 : 0.6,
      geometrySimilarity: 1.0,
      message,
      viaAudit: fullViaAudit
    };
  }
  function matchClusterToLibrary(cluster, library, options = {}) {
    const distTol = options.distanceTolerance != null ? options.distanceTolerance : 2.0; // mil
    const allowRotation = options.allowRotation !== false;
    const allowMirror = options.allowMirror !== false;
    const allowSubsetMatch = options.allowSubsetMatch !== false; // 默认开启子集/冗余孔容差规则
    const allowArbitraryRotation = options.allowArbitraryRotation === true; // 任意角度姿态（默认关闭）
    const redundantPolicy = options.redundantViaPolicy || 'ANY_GND_REDUNDANT';
    const K = cluster.viaCount;
    if (K <= 0) {
      return {
        status: 'EMPTY',
        statusText: '空孔群',
        pass: false,
        matchedScheme: null,
        message: '该孔群无过孔数据'
      };
    }
    if (K === 1) {
      return {
        status: 'ISOLATED_VIA',
        statusText: '孤立单孔',
        pass: false,
        matchedScheme: null,
        message: `孤立单孔 (孔 #${cluster.vias[0].id}，周围 ${roundN(options.clusterThreshold || 78.74, 1)} mil 范围内无相邻过孔)`,
        viaAudit: [
          {
            viaId: cluster.vias[0].id,
            x: cluster.vias[0].x,
            y: cluster.vias[0].y,
            actualPadstack: cluster.vias[0].padstack,
            expectedPadstack: '-',
            status: 'ISOLATED'
          }
        ]
      };
    }
    let bestResult = null;
    let closestCandidate = null;
    for (const scheme of library.schemes) {
      if (!scheme.vias || scheme.vias.length === 0) continue;
      const res = compareClusterWithScheme(cluster, scheme, { distTol, allowRotation, allowMirror, allowArbitraryRotation });
      if (res.pass) { return res; }
      if (!bestResult || res.matchScore > (bestResult.matchScore || 0)) {
        bestResult = res;
      }
      if (!closestCandidate || res.geometrySimilarity > (closestCandidate.geometrySimilarity || 0)) {
        closestCandidate = res; }
  }
    if (bestResult && bestResult.status === 'PADSTACK_MISMATCH') { return bestResult; }
    if (allowSubsetMatch && library.schemes.length > 0) {
      const subsetRes = matchClusterSubsetsIterative(cluster, library, {
        distanceTolerance: distTol,
        allowRotation,
        allowMirror,
        redundantViaPolicy: redundantPolicy
      });
      if (subsetRes) { return subsetRes; }
    }
    if (!bestResult || bestResult.matchScore < 0.2) {
      const topScheme = library.schemes.find(s => s.viaCount === K) || library.schemes[0];
      return {
        status: 'NO_MATCH_TOPOLOGY',
        statusText: '未匹配任何方案库拓扑',
        pass: false,
        matchedScheme: null,
        closestSchemeName: topScheme ? topScheme.name : '无',
        matchScore: 0,
        message: `包含 ${K} 个过孔，未在扇出方案库中找到中心距与拓扑匹配的方案${topScheme ? ` (最接近方案: 【${topScheme.name}】)` : ''}`,
        clusterVias: cluster.vias,
        pairwiseDistances: cluster.pairwiseDistances
      };
    }
    return bestResult;
  }
  function compareClusterWithScheme(cluster, scheme, { distTol = 2.0, allowRotation = true, allowMirror = true, allowArbitraryRotation = false }) {
    const K = cluster.viaCount;
    const M = scheme.viaCount;
    if (K !== M) {
      return {
        status: 'VIA_COUNT_MISMATCH',
        statusText: '过孔数量不匹配',
        pass: false,
        schemeName: scheme.name,
        schemeId: scheme.id,
        matchScore: 0.1,
        geometrySimilarity: 0,
        message: `孔群包含 ${K} 个孔，而方案【${scheme.name}】定义为 ${M} 个孔 (相差 ${Math.abs(K - M)} 个孔)`
      };
    }
    const cDists = cluster.pairwiseDistances.map(p => p.dist).sort((a, b) => a - b);
    const sDists = scheme.pairwiseDistances.map(p => p.dist).sort((a, b) => a - b);
    let maxDistDiff = 0;
    let distDiffSum = 0;
    for (let i = 0; i < cDists.length; i++) {
      const diff = Math.abs(cDists[i] - sDists[i]);
      distDiffSum += diff;
      if (diff > maxDistDiff) maxDistDiff = diff;
    }
    const avgDistDiff = distDiffSum / (cDists.length || 1);
    const geometryPass = maxDistDiff <= distTol;
    const angles = candidateRotations(cluster.vias, scheme.vias, distTol, allowRotation, allowArbitraryRotation);
    const mirrors = allowMirror ? [false, true] : [false];
    const clusterNormVias = cluster.vias.map(v => ({
      ...v,
      nx: v.x - cluster.centroid.x,
      ny: v.y - cluster.centroid.y
    }));
    let bestAlignment = null;
    for (const mirror of mirrors) {
      for (const deg of angles) {
        const rad = (deg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const transformedSchemeVias = scheme.normalizedVias.map(sv => {
          let tx = sv.nx;
          let ty = sv.ny;
          if (mirror) tx = -tx; // 镜像 X
          const rx = tx * cos - ty * sin;
          const ry = tx * sin + ty * cos;
          return {
            ...sv,
            tx: rx,
            ty: ry
          };
        });
        const assignment = new Int32Array(K).fill(-1);
        const usedScheme = new Uint8Array(K).fill(0);
        let maxPointDev = 0;
        let totalDev = 0;
        let validMatch = true;
        for (let i = 0; i < K; i++) {
          const cv = clusterNormVias[i];
          let bestSchemeIdx = -1;
          let minPointDist = Infinity;
          for (let j = 0; j < K; j++) {
            if (usedScheme[j]) continue;
            const sv = transformedSchemeVias[j];
            const pDist = dist2D(cv.nx, cv.ny, sv.tx, sv.ty);
            if (pDist < minPointDist) {
              minPointDist = pDist;
              bestSchemeIdx = j; }
  }
          if (bestSchemeIdx === -1 || minPointDist > distTol * 2.5) {
            validMatch = false;
            break;
          }
          assignment[i] = bestSchemeIdx;
          usedScheme[bestSchemeIdx] = 1;
          totalDev += minPointDist;
          if (minPointDist > maxPointDev) maxPointDev = minPointDist;
        }
        if (validMatch) {
          if (!bestAlignment || maxPointDev < bestAlignment.maxPointDev) {
            bestAlignment = {
              angle: deg,
              mirror,
              assignment: Array.from(assignment),
              maxPointDev,
              avgPointDev: totalDev / K,
              transformedSchemeVias
            }; }
  } }
  }
    if (!bestAlignment || !geometryPass) {
      return {
        status: 'DISTANCE_MISMATCH',
        statusText: '孔中心距超差',
        pass: false,
        schemeName: scheme.name,
        schemeId: scheme.id,
        matchScore: Math.max(0, 1 - avgDistDiff / 20),
        geometrySimilarity: Math.max(0, 1 - avgDistDiff / 10),
        maxDeviation: maxDistDiff,
        maxDeviationMm: maxDistDiff * MM_PER_MIL,
        message: `孔与方案【${scheme.name}】中心距不匹配：最大中心距偏差 ${roundN(maxDistDiff, 3)} mil (${roundN(maxDistDiff * MM_PER_MIL, 3)} mm)，超出允许容差 ${distTol} mil`
      };
    }
    const viaAudit = [];
    const padstackMismatches = [];
    for (let i = 0; i < K; i++) {
      const cv = cluster.vias[i];
      const schemeViaIdx = bestAlignment.assignment[i];
      const sv = scheme.vias[schemeViaIdx];
      const actualPad = (cv.padstack || '').trim();
      const expectedPad = (sv.padstack || '').trim();
      const isPadMatch = actualPad.toLowerCase() === expectedPad.toLowerCase();
      const auditItem = {
        viaIndex: i + 1,
        viaId: cv.id,
        net: cv.net,
        x: cv.x,
        y: cv.y,
        actualPadstack: actualPad,
        expectedPadstack: expectedPad,
        schemeViaId: sv.id,
        schemeRole: sv.role || `孔${sv.id}`,
        isMatch: isPadMatch
      };
      viaAudit.push(auditItem);
      if (!isPadMatch) { padstackMismatches.push(auditItem); }
    }
    if (padstackMismatches.length === 0) {
      return {
        status: 'MATCH_PASS',
        statusText: '完全匹配通过',
        pass: true,
        schemeName: scheme.name,
        schemeId: scheme.id,
        schemeCategory: scheme.category,
        rotationAngle: bestAlignment.angle,
        isMirrored: bestAlignment.mirror,
        maxDeviation: maxDistDiff,
        maxDeviationMm: maxDistDiff * MM_PER_MIL,
        matchScore: 1.0,
        geometrySimilarity: 1.0,
        message: `✅ 完全匹配扇出方案【${scheme.name}】(中心距最大偏差 ${roundN(maxDistDiff, 3)} mil，所有 ${K} 个孔 Padstack 完全符合)`,
        viaAudit,
        alignment: bestAlignment
      };
    } else {
      const failDescs = padstackMismatches.map(m => 
        `孔 #${m.viaId} 实测 Padstack 为「${m.actualPadstack}」，方案要求为「${m.expectedPadstack}」(${m.schemeRole})`
      );
      return {
        status: 'PADSTACK_MISMATCH',
        statusText: 'Padstack 不符合方案定义',
        pass: false,
        schemeName: scheme.name,
        schemeId: scheme.id,
        schemeCategory: scheme.category,
        rotationAngle: bestAlignment.angle,
        isMirrored: bestAlignment.mirror,
        maxDeviation: maxDistDiff,
        maxDeviationMm: maxDistDiff * MM_PER_MIL,
        matchScore: 0.8 - (padstackMismatches.length / K) * 0.4,
        geometrySimilarity: 1.0,
        padstackMismatches,
        message: `❌ 几何中心距匹配【${scheme.name}】，但存在 ${padstackMismatches.length} 处 Padstack 不符：${failDescs.join('；')}`,
        viaAudit,
        alignment: bestAlignment
      }; }
  }
  return { clusterVias: clusterVias, matchClusterSubsetsIterative: matchClusterSubsetsIterative, matchClusterToLibrary: matchClusterToLibrary, compareClusterWithScheme: compareClusterWithScheme };
});
