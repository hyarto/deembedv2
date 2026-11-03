/**
 * DFM & Airgap Spatial Geometric Check Engine
 * Calculates exact spatial geometric clearance between Vias and Traces (Line segs & Arc segs).
 */
(function(exports) {
  'use strict';

  // --- Regexes for parsing PCB coordinate reports ---
  const RE_ITEM = /Item\s+(\d+)\s+<\s*([^>]+)\s*>/i;
  const RE_VIA_ORIGIN = /Origin-xy:\s*\[([-\d.]+),\s*([-\d.]+)\]/i;
  const RE_VIA_NET = /Net:\s*([^\n\r]+)/i;
  const RE_VIA_PAD = /Padstack Name:\s*([^\n\r]+)/i;
  const RE_VIA_DRILL = /Circle Drill:\s*([-\d.]+)/i;
  const RE_VIA_CONN_TRACE = /Connections:[\s\S]*?Trace:\s*\d+\s*\(([^)]+)\)/i;

  const RE_TRACE_SUBSET = /Subset:\s*([^\n\r]+)/i;
  const RE_TRACE_NET = /Net:\s*([^\n\r]+)/i;
  const RE_TRACE_TYPE = /Type:\s*([^\n\r]+)/i;
  const RE_TRACE_LEN = /Seg Length:\s*([-\d.]+)/i;
  const RE_TRACE_SEG = /(?:^|\n)\s*(?:Seg:\s*)?xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*Width\s*\(([-\d.]+)\)/i;
  const RE_TRACE_ARC = /(?:^|\n)\s*(?:Arc\s*seg:\s*)?xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*Width\s*\(([-\d.]+)\)/i;
  const RE_TRACE_CENTER = /Center-xy:\s*\[([-\d.]+),\s*([-\d.]+)\]\s*Radius\s*\(([-\d.]+)\)\s*(CCW|CW)?/i;

  /**
   * Parse PCB Text content containing Vias and Trace Segments.
   * Options:
   *   - gndPadDiameter: default pad diameter for GND vias (default 5.94 mil)
   *   - signalPadDiameter: default pad diameter for non-GND vias (default 9.94 mil)
   *   - gndFirstDrill: default 1st drill diameter for GND vias (default 5.54 mil)
   *   - signalFirstDrill: default 1st drill diameter for non-GND vias (default 5.54 mil)
   * Note: Circle Drill in TXT is strictly the finished hole diameter for display/reference, NOT used for clearance calculation.
   */
  function parseDfmItems(text, opts) {
    opts = opts || {};
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

    if (!text || typeof text !== 'string') return { vias: [], traces: [], rawCount: 0 };
    const sections = text.split(/~{5,}/);
    const vias = [];
    const traces = [];

    sections.forEach(function(sec) {
      const itMatch = sec.match(RE_ITEM);
      if (!itMatch) return;
      const itemId = parseInt(itMatch[1], 10);
      const itemKind = itMatch[2].trim().toLowerCase();

      if (itemKind === 'via') {
        const mXy = sec.match(RE_VIA_ORIGIN);
        const mNet = sec.match(RE_VIA_NET);
        const mPad = sec.match(RE_VIA_PAD);
        const mDrill = sec.match(RE_VIA_DRILL);
        const mConn = sec.match(RE_VIA_CONN_TRACE);

        if (mXy) {
          const finishDrill = mDrill ? parseFloat(mDrill[1]) : 3.94; // Circle Drill = 完成孔径 (仅展示记录，不作运算)
          const netName = mNet ? mNet[1].trim() : '无网络';
          const isGnd = (netName.toUpperCase() === 'GND');
          const padName = mPad ? mPad[1].trim() : '';

          const padDiameter = isGnd ? defaultGndPadDiam : defaultSignalPadDiam;
          const firstDrill = isGnd ? defaultGndFirstDrill : defaultSignalFirstDrill;

          const padRadius = padDiameter / 2.0;
          const firstDrillRadius = firstDrill / 2.0;

          vias.push({
            id: itemId,
            type: 'via',
            origin: [parseFloat(mXy[1]), parseFloat(mXy[2])],
            net: netName,
            isGnd: isGnd,
            padstack: padName,
            drill: finishDrill,             // 完成孔径 Finished Hole Diameter (仅作展示记录)
            finishDrill: finishDrill,
            firstDrill: firstDrill,         // 一钻直径 First Drill Diameter (直接参与计算)
            firstDrillRadius: firstDrillRadius,
            padDiameter: padDiameter,       // 焊盘直径 Pad Diameter (直接参与计算)
            padRadius: padRadius,           // 焊盘半径
            padRing: (padDiameter - finishDrill) / 2.0, // 环宽 (仅供展示参考)
            traceLayers: mConn ? mConn[1].trim().split(/\s+/) : [],
            raw: sec.trim()
          });
        }
      } else if (itemKind === 'trace seg' || itemKind === 'trace' || itemKind === 'seg') {
        const mSub = sec.match(RE_TRACE_SUBSET);
        const mNet = sec.match(RE_TRACE_NET);
        const mType = sec.match(RE_TRACE_TYPE);
        const mLen = sec.match(RE_TRACE_LEN);
        const mSeg = sec.match(RE_TRACE_SEG);
        const mArc = sec.match(RE_TRACE_ARC);
        const mCenter = sec.match(RE_TRACE_CENTER);

        const subset = mSub ? mSub[1].trim() : '未知层';
        const net = mNet ? mNet[1].trim() : '无网络';
        const segLen = mLen ? parseFloat(mLen[1]) : 0;

        if (mArc && mCenter) {
          const dir = mCenter[4] ? mCenter[4].toUpperCase() : (sec.indexOf('CW') >= 0 ? 'CW' : 'CCW');
          traces.push({
            id: itemId,
            type: 'trace',
            kind: 'arc',
            subset: subset,
            net: net,
            p1: [parseFloat(mArc[1]), parseFloat(mArc[2])],
            p2: [parseFloat(mArc[3]), parseFloat(mArc[4])],
            width: parseFloat(mArc[5]),
            center: [parseFloat(mCenter[1]), parseFloat(mCenter[2])],
            radius: parseFloat(mCenter[3]),
            dir: dir,
            len: segLen,
            raw: sec.trim()
          });
        } else if (mSeg) {
          traces.push({
            id: itemId,
            type: 'trace',
            kind: 'line',
            subset: subset,
            net: net,
            p1: [parseFloat(mSeg[1]), parseFloat(mSeg[2])],
            p2: [parseFloat(mSeg[3]), parseFloat(mSeg[4])],
            width: parseFloat(mSeg[5]),
            len: segLen,
            raw: sec.trim()
          });
        }
      }
    });

    return {
      vias: vias,
      traces: traces,
      rawCount: vias.length + traces.length
    };
  }

  // --- Spatial Geometry Calculations ---

  /**
   * Distance from point P to line segment AB.
   * Returns { dist: number, proj: [x, y], t: number }
   */
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

  /**
   * Distance from point P to Circular Arc segment.
   * Returns { dist: number, proj: [x, y], inSpan: boolean }
   */
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
      // Concentric via / arc (distance from center to any point on arc is radius)
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
      if (d1 <= d2) {
        return { dist: d1, proj: [p1[0], p1[1]], inSpan: false };
      } else {
        return { dist: d2, proj: [p2[0], p2[1]], inSpan: false };
      }
    }
  }

  /**
   * Sample discrete points along an arc segment for smooth rendering.
   */
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

  /**
   * Run high-performance spatial clearance check using 2D Grid Partitioning.
   * - Broad Phase: 2D Spatial Hash Grid with bounding box pruning.
   * - Narrow Phase: Exact Euclidean point-to-segment / point-to-arc projection.
   * - Memory Optimization: Stores all defects + top close passing candidates, avoiding multi-million object allocations.
   * - Geometry: Clearance is calculated directly from Pad Diameter and 1st Drill Diameter (Circle Drill is for reference only).
   */
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

    const activeTraces = layerFilter ? traces.filter(t => t.subset === layerFilter) : traces;

    // Calculate theoretical cross-combinations
    let totalChecked = 0;
    let gndTotal = 0;
    let sigTotal = 0;

    vias.forEach(v => {
      let count = 0;
      activeTraces.forEach(t => {
        if (!diffNetOnly || v.net !== t.net) {
          count++;
        }
      });
      totalChecked += count;
      if (v.isGnd) gndTotal += count;
      else sigTotal += count;
    });

    // 1. Build Layer-Aware 2D Spatial Hash Grid for Traces (Broad Phase Index)
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
          cell.push(tObj);
        }
      }
    });

    // Determine safe search radius: maximum threshold + maximum pad radius + padding
    const maxThresh = Math.max(minClearanceGnd, minClearanceSignal);
    const maxPadR = Math.max(defaultGndPadDiam, defaultSignalPadDiam) / 2.0 + 10.0;
    const SEARCH_RADIUS = Math.max(80.0, maxThresh + maxPadR + 30.0);

    const defectPairs = [];
    const closePassingPairs = [];
    let failCount = 0;
    let gndFail = 0, sigFail = 0;
    let minObservedDist = Infinity;

    // 2. Spatial Query for Each Via (Narrow Phase Evaluation)
    vias.forEach(via => {
      const vPadRadius = via.padRadius || (via.isGnd ? defaultGndPadDiam / 2.0 : defaultSignalPadDiam / 2.0);
      const vFirstDrillR = via.firstDrillRadius || (via.isGnd ? defaultGndFirstDrill / 2.0 : defaultSignalFirstDrill / 2.0);
      const vx = via.origin[0], vy = via.origin[1];

      const targetThreshold = via.isGnd ? minClearanceGnd : minClearanceSignal;
      const targetType = via.isGnd ? '线到GND孔' : '线到信号孔';

      layerGrids.forEach(lGrid => {
        const gx0 = Math.floor((vx - SEARCH_RADIUS) / CELL_SIZE);
        const gx1 = Math.floor((vx + SEARCH_RADIUS) / CELL_SIZE);
        const gy0 = Math.floor((vy - SEARCH_RADIUS) / CELL_SIZE);
        const gy1 = Math.floor((vy + SEARCH_RADIUS) / CELL_SIZE);

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

              // Fast AABB rejection
              if (vx < item.minX - SEARCH_RADIUS || vx > item.maxX + SEARCH_RADIUS ||
                  vy < item.minY - SEARCH_RADIUS || vy > item.maxY + SEARCH_RADIUS) {
                continue;
              }

              let geomRes;
              if (trace.kind === 'line') {
                geomRes = ptToSegDist(via.origin, trace.p1, trace.p2);
              } else {
                geomRes = ptToArcDist(via.origin, trace.center, trace.radius, trace.p1, trace.p2, trace.dir);
              }

              const centerDist = geomRes.dist;
              const traceHalfW = trace.width / 2.0;
              const traceEdgeDist = centerDist - traceHalfW;
              const drillEdgeDist = traceEdgeDist - vFirstDrillR;
              const padEdgeDist = traceEdgeDist - vPadRadius;

              let evalDist;
              if (mode === 'pad_to_trace') evalDist = padEdgeDist;
              else if (mode === 'drill_to_trace') evalDist = drillEdgeDist;
              else if (mode === 'center_to_trace') evalDist = traceEdgeDist;
              else evalDist = centerDist;

              if (evalDist < minObservedDist) minObservedDist = evalDist;

              const isFail = evalDist < targetThreshold - 1e-4;
              const pairObj = {
                via: via,
                trace: trace,
                sameNet: via.net === trace.net,
                targetType: targetType,
                isGndVia: via.isGnd,
                proj: geomRes.proj,
                centerDist: centerDist,
                traceEdgeDist: traceEdgeDist,
                drillEdgeDist: drillEdgeDist,
                padEdgeDist: padEdgeDist,
                firstDrill: via.firstDrill || vFirstDrillR * 2.0,
                firstDrillRadius: vFirstDrillR,
                padDiameter: via.padDiameter || vPadRadius * 2.0,
                padRadius: vPadRadius,
                evalDist: evalDist,
                threshold: targetThreshold,
                status: isFail ? '不满足' : '满足',
                diff: evalDist - targetThreshold,
                mode: mode
              };

              if (isFail) {
                failCount++;
                if (via.isGnd) gndFail++; else sigFail++;
                defectPairs.push(pairObj);
              } else if (evalDist < SEARCH_RADIUS) {
                closePassingPairs.push(pairObj);
              }
            }
          }
        }
      });
    });

    defectPairs.sort((a, b) => a.evalDist - b.evalDist);
    closePassingPairs.sort((a, b) => a.evalDist - b.evalDist);

    const keptPassing = closePassingPairs.slice(0, maxPassingToKeep);
    const allPairs = defectPairs.concat(keptPassing);

    const passCount = totalChecked - failCount;
    const gndPass = gndTotal - gndFail;
    const sigPass = sigTotal - sigFail;

    // 3. Build Layer & Trace-Net Centric Analysis (以不同出线层的网络为目标，分析走线上存在多少间距不满足)
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
        entry.allPairs.push(p);
      }
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
      pairs: allPairs,
      defectPairs: defectPairs,
      closePassingPairs: keptPassing,
      failCount: failCount,
      passCount: passCount,
      totalChecked: totalChecked,
      minObservedDist: minObservedDist === Infinity ? 0 : minObservedDist,
      minClearanceGnd: minClearanceGnd,
      minClearanceSignal: minClearanceSignal,
      threshold: minClearanceGnd,
      netLayerAnalysis: netLayerAnalysis,
      gndStats: {
        total: gndTotal,
        fail: gndFail,
        pass: gndPass,
        minDist: minObservedDist === Infinity ? 0 : minObservedDist,
        threshold: minClearanceGnd
      },
      signalStats: {
        total: sigTotal,
        fail: sigFail,
        pass: sigPass,
        minDist: minObservedDist === Infinity ? 0 : minObservedDist,
        threshold: minClearanceSignal
      },
      mode: mode,
      diffNetOnly: diffNetOnly,
      layerFilter: layerFilter
    };
  }

  // --- Multi-Element Measurement Calculator ---

  /**
   * Calculate all clearance metrics between two Vias.
   */
  function calcViaToViaMetrics(v1, v2) {
    const dCenter = Math.hypot(v1.origin[0] - v2.origin[0], v1.origin[1] - v2.origin[1]);
    const padAirgap = dCenter - v1.padRadius - v2.padRadius;
    const drillAirgap = dCenter - v1.firstDrillRadius - v2.firstDrillRadius;
    const padToDrill1 = dCenter - v1.padRadius - v2.firstDrillRadius;
    const padToDrill2 = dCenter - v2.padRadius - v1.firstDrillRadius;

    return {
      type: 'via_to_via',
      v1: v1,
      v2: v2,
      centerDist: dCenter,
      padAirgap: padAirgap,
      drillAirgap: drillAirgap,
      padToDrillAirgap: Math.min(padToDrill1, padToDrill2)
    };
  }

  /**
   * Calculate all clearance metrics between a Via and a Trace.
   */
  function calcTraceToViaMetrics(via, trace) {
    let geomRes;
    if (trace.kind === 'line') {
      geomRes = ptToSegDist(via.origin, trace.p1, trace.p2);
    } else {
      geomRes = ptToArcDist(via.origin, trace.center, trace.radius, trace.p1, trace.p2, trace.dir);
    }

    const dCenter = geomRes.dist;
    const traceHalfW = trace.width / 2.0;
    const traceEdgeDist = dCenter - traceHalfW;
    const padAirgap = traceEdgeDist - via.padRadius;
    const drillAirgap = traceEdgeDist - via.firstDrillRadius;

    return {
      type: 'via_to_trace',
      via: via,
      trace: trace,
      proj: geomRes.proj,
      centerDist: dCenter,
      traceEdgeDist: traceEdgeDist,
      padAirgap: padAirgap,
      drillAirgap: drillAirgap
    };
  }

  // Export functions
  exports.parseDfmItems = parseDfmItems;
  exports.ptToSegDist = ptToSegDist;
  exports.ptToArcDist = ptToArcDist;
  exports.sampleArcPoints = sampleArcPoints;
  exports.runDfmCheck = runDfmCheck;
  exports.calcViaToViaMetrics = calcViaToViaMetrics;
  exports.calcTraceToViaMetrics = calcTraceToViaMetrics;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.DfmCheck = {}));
