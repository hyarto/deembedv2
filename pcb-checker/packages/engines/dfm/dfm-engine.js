/* ============================================================================
 * dfm-engine.js —— DFM 空间哈希网格间隙判定与孔-孔 / 线-孔精确几何测量内核
 * ========================================================================== */
(function (root, factory) {
var PG = (typeof module === "object" && module.exports) ? require("../../geometry") : root.PadGeom, layers = (typeof module === "object" && module.exports) ? require("./dfm-layers.js") : root.DfmCheck;
  var api = factory(PG, layers);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DfmCheck = Object.assign(root.DfmCheck || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (PG, layers) {
  "use strict";
  var BOTTOM_LAYER_INDEX = layers.BOTTOM_LAYER_INDEX, parseLayerIndex = layers.parseLayerIndex;
  var parseLayerSpec = layers.parseLayerSpec, layerSpecMatches = layers.layerSpecMatches;
  var layerSpecLabel = layers.layerSpecLabel, evaluateViaSpan = layers.evaluateViaSpan;
  var doesViaSpanLayer = layers.doesViaSpanLayer;
  function ptToSegDist(p, a, b) {
    const px = p[0], py = p[1];
    const ax = a[0], ay = a[1];
    const bx = b[0], by = b[1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) {
      return {
        dist: Math.hypot(px - ax, py - ay),
        proj: [ax, ay],
        t: 0
      };
    }
    const t = Math.max(0.0, Math.min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    return {
      dist: Math.hypot(px - qx, py - qy),
      proj: [qx, qy],
      t: t
    };
  }
  function ptToArcDist(p, center, radius, p1, p2, direction) {
    const cx = center[0], cy = center[1];
    const px = p[0], py = p[1];
    const TWO_PI = 2 * Math.PI;
    const ang1 = Math.atan2(p1[1] - cy, p1[0] - cx);
    const ang2 = Math.atan2(p2[1] - cy, p2[0] - cx);
    let span;
    if (direction === 'CCW') {
      span = (ang2 - ang1) % TWO_PI;
      if (span < 0) span += TWO_PI;
    } else {
      span = (ang1 - ang2) % TWO_PI;
      if (span < 0) span += TWO_PI;
    }
    if (span === 0) span = TWO_PI;
    const dCenter = Math.hypot(px - cx, py - cy);
    if (dCenter < 0.05) {
      const midAng = (direction === 'CCW') ? (ang1 + span / 2) : (ang1 - span / 2);
      return {
        dist: radius,
        proj: [cx + radius * Math.cos(midAng), cy + radius * Math.sin(midAng)],
        inSpan: true
      };
    }
    const angP = Math.atan2(py - cy, px - cx);
    let cur;
    if (direction === 'CCW') {
      cur = (angP - ang1) % TWO_PI;
      if (cur < 0) cur += TWO_PI;
    } else {
      cur = (ang1 - angP) % TWO_PI;
      if (cur < 0) cur += TWO_PI;
    }
    if (cur <= span + 1e-5) {
      const qx = cx + radius * Math.cos(angP);
      const qy = cy + radius * Math.sin(angP);
      return {
        dist: Math.abs(dCenter - radius),
        proj: [qx, qy],
        inSpan: true
      };
    } else {
      const d1 = Math.hypot(px - p1[0], py - p1[1]);
      const d2 = Math.hypot(px - p2[0], py - p2[1]);
      if (d1 <= d2) { return { dist: d1, proj: [p1[0], p1[1]], inSpan: false }; } else {
        return { dist: d2, proj: [p2[0], p2[1]], inSpan: false }; }
  }
  }
  function sampleArcPoints(center, radius, p1, p2, direction, steps) {
    steps = steps || 24;
    const cx = center[0], cy = center[1];
    const ang1 = Math.atan2(p1[1] - cy, p1[0] - cx);
    const ang2 = Math.atan2(p2[1] - cy, p2[0] - cx);
    const TWO_PI = 2 * Math.PI;
    let span;
    if (direction === 'CCW') {
      span = (ang2 - ang1) % TWO_PI;
      if (span < 0) span += TWO_PI;
    } else {
      span = (ang1 - ang2) % TWO_PI;
      if (span < 0) span += TWO_PI;
    }
    if (span === 0) span = TWO_PI;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const frac = i / steps;
      const curAng = (direction === 'CCW') ? (ang1 + frac * span) : (ang1 - frac * span);
      pts.push([cx + radius * Math.cos(curAng), cy + radius * Math.sin(curAng)]);
    }
    return pts;
  }
  function padRegionOf(via, fallbackDiameter) {
    if (via.padRegion) return via.padRegion;
    if (!PG) return null;
    const shape = via.padShape && via.padShape.kind
      ? via.padShape
      : { kind: 'circle', w: via.padDiameter || fallbackDiameter || (via.padRadius ? via.padRadius * 2 : 1) };
    const local = PG.regionOf(shape);
    via.padRegion = PG.translateRegion(local, via.origin[0], via.origin[1]);
    return via.padRegion;
  }
  function traceToPadSigned(region, trace) {
    if (!region || !PG) return NaN;
    if (PG.isCircleRegion(region)) {
      const c = region.poly[0];
      const d = trace.kind === 'line'
        ? ptToSegDist(c, trace.p1, trace.p2).dist
        : ptToArcDist(c, trace.center, trace.radius, trace.p1, trace.p2, trace.dir).dist;
      return d - region.round;
    }
    if (trace.kind === 'line') { return PG.signedSegmentRegionDist(trace.p1, trace.p2, region); }
    return PG.signedArcRegionDist(trace.center, trace.radius, trace.p1, trace.p2, trace.dir, region, 0);
  }
  function runDfmCheck(vias, traces, opts) {
    opts = opts || {};
    const fallbackThresh = typeof opts.minClearance === 'number' ? opts.minClearance : 6.0;
    const minClearanceGnd = typeof opts.minClearanceGnd === 'number' ? opts.minClearanceGnd : fallbackThresh;
    const minClearanceSignal = typeof opts.minClearanceSignal === 'number' ? opts.minClearanceSignal : fallbackThresh;
    const mode = opts.mode || 'pad_to_trace'; // 'pad_to_trace' | 'drill_to_trace' | 'center_to_center' | 'center_to_trace'
    const diffNetOnly = opts.diffNetOnly !== undefined ? opts.diffNetOnly : true;
    const layerFilter = opts.layerFilter || '';
    
    const defaultGndPadDiam = typeof opts.gndPadDiameter === 'number' ? opts.gndPadDiameter :
      (typeof opts.gndPadRing === 'number' ? (3.94 + 2 * opts.gndPadRing) : 7.906);
    const defaultSignalPadDiam = typeof opts.signalPadDiameter === 'number' ? opts.signalPadDiameter :
      (typeof opts.signalPadRing === 'number' ? (3.94 + 2 * opts.signalPadRing) : 9.94);
    
    const defaultGndFirstDrill = typeof opts.gndFirstDrill === 'number' ? opts.gndFirstDrill :
      (typeof opts.firstDrill === 'number' ? opts.firstDrill :
      (typeof opts.platingThick === 'number' ? (3.94 + 2 * opts.platingThick) : 5.54));
    const defaultSignalFirstDrill = typeof opts.signalFirstDrill === 'number' ? opts.signalFirstDrill :
      (typeof opts.firstDrill === 'number' ? opts.firstDrill :
      (typeof opts.platingThick === 'number' ? (3.94 + 2 * opts.platingThick) : 5.54));
    const maxPassingToKeep = typeof opts.maxPassingToKeep === 'number' ? opts.maxPassingToKeep : 3000;
    const layerRules = (Array.isArray(opts.layerRules) ? opts.layerRules : []).map((r, i) => {
      if (!r) return null;
      const spec = r.layers != null ? r.layers : r.spec;
      const ranges = parseLayerSpec(spec);
      if (!ranges.length) return null;
      return {
        name: r.name || ('规则' + (i + 1)),
        raw: String(spec), ranges: ranges,
        gnd: typeof r.minClearanceGnd === 'number' ? r.minClearanceGnd : null,
        sig: typeof r.minClearanceSignal === 'number' ? r.minClearanceSignal : null,
        padPair: typeof r.minClearancePadPair === 'number' ? r.minClearancePadPair : null,
        checked: 0,
        fail: 0,
        padPairChecked: 0,
        padPairFail: 0
      };
    }).filter(Boolean);
    const ruleForLayer = (idx) => {
      for (let i = 0; i < layerRules.length; i++) {
        if (layerSpecMatches(layerRules[i].ranges, idx)) return layerRules[i];
      }
      return null;
    };
    const minClearancePadPair = typeof opts.minClearancePadPair === 'number' ? opts.minClearancePadPair : 0;
    const activeTraces = layerFilter ? traces.filter(t => t.subset === layerFilter) : traces;
    const subsetLayerNumMap = new Map();
    activeTraces.forEach(t => {
      if (!subsetLayerNumMap.has(t.subset)) {
        subsetLayerNumMap.set(t.subset, parseLayerIndex(t.subset)); }
  });
    const subsetStatsMap = new Map();
    activeTraces.forEach(t => {
      let st = subsetStatsMap.get(t.subset);
      if (!st) {
        st = { total: 0, byNet: new Map(), layerNum: subsetLayerNumMap.get(t.subset) };
        subsetStatsMap.set(t.subset, st);
      }
      st.total++;
      st.byNet.set(t.net, (st.byNet.get(t.net) || 0) + 1);
    });
    let totalChecked = 0;
    let gndTotal = 0;
    let sigTotal = 0;
    let skippedNonSpanningPairs = 0;
    let undeterminedSpanPairs = 0;
    const viaTypeCounts = { thru: 0, blind: 0, buried: 0 };
    vias.forEach(v => {
      const vType = v.viaSpanType || 'thru';
      if (viaTypeCounts[vType] !== undefined) viaTypeCounts[vType]++;
      else viaTypeCounts.thru++;
      let count = 0;
      subsetStatsMap.forEach((st, subsetName) => {
        const candidateCnt = diffNetOnly ? (st.total - (st.byNet.get(v.net) || 0)) : st.total;
        if (candidateCnt <= 0) return;
        const spanInfo = evaluateViaSpan(v, subsetName, st.layerNum);
        if (spanInfo.spans) {
          count += candidateCnt;
          if (!spanInfo.determined) undeterminedSpanPairs += candidateCnt;
        } else {
          skippedNonSpanningPairs += candidateCnt; }
  });
      totalChecked += count;
      if (v.isGnd) gndTotal += count;
      else sigTotal += count;
    });
    const CELL_SIZE = 100.0; // 100 mil grid cell
    const layerGrids = new Map();
    activeTraces.forEach(t => {
      let lGrid = layerGrids.get(t.subset);
      if (!lGrid) {
        lGrid = new Map();
        layerGrids.set(t.subset, lGrid);
      }
      let minX, maxX, minY, maxY;
      if (t.kind === 'line') {
        minX = Math.min(t.p1[0], t.p2[0]) - t.width / 2.0;
        maxX = Math.max(t.p1[0], t.p2[0]) + t.width / 2.0;
        minY = Math.min(t.p1[1], t.p2[1]) - t.width / 2.0;
        maxY = Math.max(t.p1[1], t.p2[1]) + t.width / 2.0;
      } else {
        minX = t.center[0] - t.radius - t.width / 2.0;
        maxX = t.center[0] + t.radius + t.width / 2.0;
        minY = t.center[1] - t.radius - t.width / 2.0;
        maxY = t.center[1] + t.radius + t.width / 2.0;
      }
      const gx0 = Math.floor(minX / CELL_SIZE);
      const gx1 = Math.floor(maxX / CELL_SIZE);
      const gy0 = Math.floor(minY / CELL_SIZE);
      const gy1 = Math.floor(maxY / CELL_SIZE);
      const tObj = { trace: t, minX, maxX, minY, maxY };
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const key = `${gx}_${gy}`;
          let cell = lGrid.get(key);
          if (!cell) { cell = []; lGrid.set(key, cell); }
          cell.push(tObj); }
  }
    });
    const maxThresh = Math.max(minClearanceGnd, minClearanceSignal);
    const maxPadR = Math.max(defaultGndPadDiam, defaultSignalPadDiam) / 2.0 + 10.0;
    const SEARCH_RADIUS = Math.max(80.0, maxThresh + maxPadR + 30.0);
    const defectPairs = [];
    const closePassingPairs = [];
    let failCount = 0;
    let gndFail = 0, sigFail = 0;
    let minObservedDist = Infinity;
    vias.forEach(via => {
      const vPadRadius = via.padRadius || (via.isGnd ? defaultGndPadDiam / 2.0 : defaultSignalPadDiam / 2.0);
      const vFirstDrillR = via.firstDrillRadius || (via.isGnd ? defaultGndFirstDrill / 2.0 : defaultSignalFirstDrill / 2.0);
      const vx = via.origin[0], vy = via.origin[1];
      const vRegion = PG ? padRegionOf(via, vPadRadius * 2.0) : null;
      const vIsCircle = !vRegion || PG.isCircleRegion(vRegion);
      const vSearchR = SEARCH_RADIUS + Math.max(0, vPadRadius - maxPadR);
      const targetType = via.isGnd ? '线到GND孔' : '线到信号孔';
      layerGrids.forEach((lGrid, traceLayerName) => {
        const cachedTraceLayerNum = subsetLayerNumMap.get(traceLayerName);
        if (!doesViaSpanLayer(via, traceLayerName, cachedTraceLayerNum)) {
          return;
        }
        const layerRule = ruleForLayer(cachedTraceLayerNum);
        const targetThreshold = (layerRule && (via.isGnd ? layerRule.gnd : layerRule.sig) != null)
          ? (via.isGnd ? layerRule.gnd : layerRule.sig)
          : (via.isGnd ? minClearanceGnd : minClearanceSignal);
        const gx0 = Math.floor((vx - vSearchR) / CELL_SIZE);
        const gx1 = Math.floor((vx + vSearchR) / CELL_SIZE);
        const gy0 = Math.floor((vy - vSearchR) / CELL_SIZE);
        const gy1 = Math.floor((vy + vSearchR) / CELL_SIZE);
        const checkedTraceIds = new Set();
        for (let gx = gx0; gx <= gx1; gx++) {
          for (let gy = gy0; gy <= gy1; gy++) {
            const cell = lGrid.get(`${gx}_${gy}`);
            if (!cell) continue;
            for (let i = 0; i < cell.length; i++) {
              const item = cell[i];
              const trace = item.trace;
              if (checkedTraceIds.has(trace.id)) continue;
              checkedTraceIds.add(trace.id);
              if (diffNetOnly && via.net === trace.net) continue;
              if (vx < item.minX - vSearchR || vx > item.maxX + vSearchR ||
                  vy < item.minY - vSearchR || vy > item.maxY + vSearchR) {
                continue;
              }
              let geomRes;
              if (trace.kind === 'line') { geomRes = ptToSegDist(via.origin, trace.p1, trace.p2); } else {
                geomRes = ptToArcDist(via.origin, trace.center, trace.radius, trace.p1, trace.p2, trace.dir);
              }
              const centerDist = geomRes.dist;
              const traceHalfW = trace.width / 2.0;
              const traceEdgeDist = centerDist - traceHalfW;
              const drillEdgeDist = traceEdgeDist - vFirstDrillR;
              const padToCenterline = vIsCircle ? (centerDist - vPadRadius) : traceToPadSigned(vRegion, trace);
              const padEdgeDist = padToCenterline - traceHalfW;
              let evalDist;
              if (mode === 'pad_to_trace') evalDist = padEdgeDist;
              else if (mode === 'drill_to_trace') evalDist = drillEdgeDist;
              else if (mode === 'center_to_trace') evalDist = traceEdgeDist;
              else evalDist = centerDist;
              if (evalDist < minObservedDist) minObservedDist = evalDist;
              const isFail = evalDist < targetThreshold - 1e-4;
              const pairObj = { via: via, trace: trace,
                sameNet: via.net === trace.net, targetType: targetType,
                isGndVia: via.isGnd,
                proj: geomRes.proj, centerDist: centerDist, traceEdgeDist: traceEdgeDist, drillEdgeDist: drillEdgeDist, padEdgeDist: padEdgeDist,
                firstDrill: via.firstDrill || vFirstDrillR * 2.0,
                firstDrillRadius: vFirstDrillR,
                padDiameter: via.padDiameter || vPadRadius * 2.0,
                padRadius: vPadRadius,
                padShapeKind: via.padShape ? via.padShape.kind : 'circle', padToCenterline: padToCenterline, evalDist: evalDist,
                threshold: targetThreshold,
                ruleName: layerRule ? layerRule.name : '默认',
                ruleLayers: layerRule ? layerRule.raw : '全部层',
                status: isFail ? '不满足' : '满足',
                diff: evalDist - targetThreshold,
                mode: mode
              };
              if (layerRule) {
                layerRule.checked++;
                if (isFail) layerRule.fail++;
              }
              if (isFail) {
                failCount++;
                if (via.isGnd) gndFail++; else sigFail++;
                defectPairs.push(pairObj);
              } else if (evalDist < SEARCH_RADIUS) { closePassingPairs.push(pairObj); } }
  } }
  });
    });
    const padPairDefects = [];
    let padPairTotal = 0;
    let padPairFail = 0;
    let padPairMin = Infinity;
    if (minClearancePadPair > 0 && vias.length > 1) {
      const cell = Math.max(20.0, minClearancePadPair + maxPadR);
      const grid = new Map();
      const keyOf = (x, y) => `${Math.floor(x / cell)}_${Math.floor(y / cell)}`;
      vias.forEach(v => {
        const k = keyOf(v.origin[0], v.origin[1]);
        let bucket = grid.get(k);
        if (!bucket) { bucket = []; grid.set(k, bucket); }
        bucket.push(v);
      });
      const spanOverlap = (a, b) => {
        if (!a.hasDefinedSpan || !b.hasDefinedSpan) return true;   // 层名解析不出来时照常检查
        const a1 = a.minLayerNum, a2 = a.maxLayerNum, b1 = b.minLayerNum, b2 = b.maxLayerNum;
        if (!(a1 > 0 && a2 > 0 && b1 > 0 && b2 > 0)) return true;
        return Math.min(a2, b2) >= Math.max(a1, b1);
      };
      vias.forEach((v1, i1) => {
        const cx = Math.floor(v1.origin[0] / cell), cy = Math.floor(v1.origin[1] / cell);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const bucket = grid.get(`${cx + dx}_${cy + dy}`);
            if (!bucket) continue;
            for (let bi = 0; bi < bucket.length; bi++) {
              const v2 = bucket[bi];
              if (v2 === v1 || v2.id <= v1.id) continue;           // 每对只算一次
              if (!!v1.isGnd === !!v2.isGnd) continue;             // 只查 GND孔 ↔ 信号孔
              if (diffNetOnly && v1.net === v2.net) continue;
              if (!spanOverlap(v1, v2)) continue;
              let lo = -Infinity, hi = Infinity;
              if (v1.hasDefinedSpan && v2.hasDefinedSpan && v1.minLayerNum > 0 && v2.minLayerNum > 0) {
                lo = Math.max(v1.minLayerNum, v2.minLayerNum);
                hi = Math.min(v1.maxLayerNum, v2.maxLayerNum);
              }
              let padRule = null;
              layerRules.forEach(r => {
                if (r.padPair == null) return;
                const hit = r.ranges.some(pair => pair[0] <= hi && pair[1] >= lo);
                if (hit && (!padRule || r.padPair > padRule.padPair)) padRule = r;
              });
              const padThreshold = padRule ? padRule.padPair : minClearancePadPair;
              const m = calcViaToViaMetrics(v1, v2);
              const gap = m.padAirgap;
              padPairTotal++;
              if (gap < padPairMin) padPairMin = gap;
              if (padRule) padRule.padPairChecked++;
              const isFail = gap < padThreshold - 1e-4;
              if (!isFail) continue;
              padPairFail++;
              if (padRule) padRule.padPairFail++;
              const gndVia = v1.isGnd ? v1 : v2;
              const sigVia = v1.isGnd ? v2 : v1;
              padPairDefects.push({
                type: 'via_pad_to_via_pad', gndVia: gndVia, sigVia: sigVia, v1: v1, v2: v2,
                centerDist: m.centerDist,
                padAirgap: gap,
                evalDist: gap,
                gndPadDiameter: gndVia.padDiameter || (gndVia.padRadius || defaultGndPadDiam / 2) * 2,
                sigPadDiameter: sigVia.padDiameter || (sigVia.padRadius || defaultSignalPadDiam / 2) * 2,
                spanGnd: gndVia.spanShort || gndVia.viaTypeLabel || '',
                spanSig: sigVia.spanShort || sigVia.viaTypeLabel || '',
                threshold: padThreshold,
                diff: gap - padThreshold,
                ruleName: padRule ? padRule.name : '默认',
                ruleLayers: padRule ? padRule.raw : '全部层',
                status: '不满足',
                targetType: 'GND孔盘到信号孔盘'
              }); }
  } }
  });
      padPairDefects.sort((a, b) => a.padAirgap - b.padAirgap);
    }
    defectPairs.sort((a, b) => a.evalDist - b.evalDist);
    closePassingPairs.sort((a, b) => a.evalDist - b.evalDist);
    const keptPassing = closePassingPairs.slice(0, maxPassingToKeep);
    const allPairs = defectPairs.concat(keptPassing);
    const passCount = totalChecked - failCount;
    const gndPass = gndTotal - gndFail;
    const sigPass = sigTotal - sigFail;
    const netLayerMap = new Map();
    activeTraces.forEach(t => {
      const key = `${t.subset}__${t.net}`;
      let entry = netLayerMap.get(key);
      if (!entry) {
        entry = {
          layer: t.subset,
          net: t.net,
          traceSegments: 0,
          totalLength: 0,
          failCount: 0,
          gndFailCount: 0,
          signalFailCount: 0,
          minDist: Infinity,
          maxDeviation: 0,
          uniqueVias: new Set(),
          defects: [],
          allPairs: []
        };
        netLayerMap.set(key, entry);
      }
      entry.traceSegments++;
      entry.totalLength += (t.len || 0);
    });
    defectPairs.forEach(p => {
      const key = `${p.trace.subset}__${p.trace.net}`;
      let entry = netLayerMap.get(key);
      if (!entry) {
        entry = {
          layer: p.trace.subset,
          net: p.trace.net,
          traceSegments: 1,
          totalLength: p.trace.len || 0,
          failCount: 0,
          gndFailCount: 0,
          signalFailCount: 0,
          minDist: Infinity,
          maxDeviation: 0,
          uniqueVias: new Set(),
          defects: [],
          allPairs: []
        };
        netLayerMap.set(key, entry);
      }
      entry.failCount++;
      if (p.isGndVia) entry.gndFailCount++; else entry.signalFailCount++;
      if (p.evalDist < entry.minDist) entry.minDist = p.evalDist;
      const dev = Math.abs(p.diff);
      if (dev > entry.maxDeviation) entry.maxDeviation = dev;
      entry.uniqueVias.add(p.via.id);
      entry.defects.push(p);
      entry.allPairs.push(p);
    });
    closePassingPairs.forEach(p => {
      const key = `${p.trace.subset}__${p.trace.net}`;
      const entry = netLayerMap.get(key);
      if (entry) {
        if (p.evalDist < entry.minDist) entry.minDist = p.evalDist;
        entry.allPairs.push(p); }
  });
    const netLayerAnalysis = Array.from(netLayerMap.values()).map(e => {
      return {
        layer: e.layer,
        net: e.net,
        traceSegments: e.traceSegments,
        totalLength: e.totalLength,
        failCount: e.failCount,
        gndFailCount: e.gndFailCount,
        signalFailCount: e.signalFailCount,
        uniqueViaCount: e.uniqueVias.size,
        uniqueViaIds: Array.from(e.uniqueVias),
        minDist: e.minDist === Infinity ? 0 : e.minDist,
        maxDeviation: e.maxDeviation,
        status: e.failCount > 0 ? '不满足' : '满足',
        defects: e.defects,
        allPairs: e.allPairs
      };
    });
    netLayerAnalysis.sort((a, b) => {
      if (b.failCount !== a.failCount) return b.failCount - a.failCount;
      if (a.layer !== b.layer) return a.layer.localeCompare(b.layer);
      return a.net.localeCompare(b.net);
    });
    return {
      pairs: allPairs, defectPairs: defectPairs,
      closePassingPairs: keptPassing, failCount: failCount, passCount: passCount, totalChecked: totalChecked, skippedNonSpanningPairs: skippedNonSpanningPairs, undeterminedSpanPairs: undeterminedSpanPairs, viaTypeCounts: viaTypeCounts,
      minObservedDist: minObservedDist === Infinity ? 0 : minObservedDist, minClearanceGnd: minClearanceGnd, minClearanceSignal: minClearanceSignal,
      threshold: minClearanceGnd, netLayerAnalysis: netLayerAnalysis,
      gndStats: { total: gndTotal, fail: gndFail, pass: gndPass, minDist: minObservedDist === Infinity ? 0 : minObservedDist, threshold: minClearanceGnd },
      signalStats: { total: sigTotal, fail: sigFail, pass: sigPass, minDist: minObservedDist === Infinity ? 0 : minObservedDist, threshold: minClearanceSignal }, mode: mode, diffNetOnly: diffNetOnly, layerFilter: layerFilter,
      padPairStats: {
        enabled: minClearancePadPair > 0,
        total: padPairTotal,
        fail: padPairFail,
        pass: padPairTotal - padPairFail,
        minDist: padPairMin === Infinity ? 0 : padPairMin,
        threshold: minClearancePadPair
      }, padPairDefects: padPairDefects,
      layerRules: layerRules.map(r => ({ name: r.name, layers: r.raw, gnd: r.gnd, sig: r.sig, padPair: r.padPair })),
      layerRuleStats: layerRules.map(r => ({
        name: r.name, layers: r.raw,
        checked: r.checked, fail: r.fail,
        padPairChecked: r.padPairChecked, padPairFail: r.padPairFail
      }))
    };
  }
  function calcViaToViaMetrics(v1, v2) {
    const dCenter = Math.hypot(v1.origin[0] - v2.origin[0], v1.origin[1] - v2.origin[1]);
    const r1 = PG ? padRegionOf(v1) : null;
    const r2 = PG ? padRegionOf(v2) : null;
    const padAirgap = (r1 && r2) ? PG.signedRegionDist(r1, r2)
                                 : dCenter - v1.padRadius - v2.padRadius;
    const drillAirgap = dCenter - v1.firstDrillRadius - v2.firstDrillRadius;
    const padToDrill1 = dCenter - v1.padRadius - v2.firstDrillRadius;
    const padToDrill2 = dCenter - v2.padRadius - v1.firstDrillRadius;
    return {
      type: 'via_to_via', v1: v1, v2: v2,
      centerDist: dCenter, padAirgap: padAirgap, drillAirgap: drillAirgap,
      padToDrillAirgap: Math.min(padToDrill1, padToDrill2)
    };
  }
  function calcTraceToViaMetrics(via, trace) {
    let geomRes;
    if (trace.kind === 'line') { geomRes = ptToSegDist(via.origin, trace.p1, trace.p2); } else {
      geomRes = ptToArcDist(via.origin, trace.center, trace.radius, trace.p1, trace.p2, trace.dir);
    }
    const dCenter = geomRes.dist;
    const traceHalfW = trace.width / 2.0;
    const traceEdgeDist = dCenter - traceHalfW;
    const padRegion = PG ? padRegionOf(via) : null;
    const padAirgap = (padRegion && PG.isCircleRegion(padRegion))
      ? traceEdgeDist - via.padRadius
      : (padRegion ? traceToPadSigned(padRegion, trace) - traceHalfW
                   : traceEdgeDist - via.padRadius);
    const drillAirgap = traceEdgeDist - via.firstDrillRadius;
    const spansTraceLayer = trace && trace.subset ? doesViaSpanLayer(via, trace.subset) : true;
    return {
      type: 'via_to_trace', via: via, trace: trace,
      proj: geomRes.proj,
      centerDist: dCenter, traceEdgeDist: traceEdgeDist, padAirgap: padAirgap, drillAirgap: drillAirgap,
      spansTraceLayer: spansTraceLayer
    };
  }
  return { ptToSegDist: ptToSegDist, ptToArcDist: ptToArcDist, sampleArcPoints: sampleArcPoints, padRegionOf: padRegionOf, traceToPadSigned: traceToPadSigned, runDfmCheck: runDfmCheck, calcViaToViaMetrics: calcViaToViaMetrics, calcTraceToViaMetrics: calcTraceToViaMetrics,
    PadGeom: PG
  };
});
