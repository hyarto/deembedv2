/* ============================================================================
 * fanout-parser.js —— 扇出过孔与走线（直线/圆弧）数据解析及孔群空间关联
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FanoutChecker = Object.assign(root.FanoutChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // 单位转换常量
  const MM_PER_MIL = 0.0254;
  const MIL_PER_MM = 1 / 0.0254; // 39.37007874...

  /**
   * 几何辅助函数
   */
  function dist2D(x1, y1, x2, y2) {
    return Math.hypot(x1 - x2, y1 - y2);
  }

  /**
   * 生成候选旋转角（度）。
   * 默认只试正交 0/90/180/270（保持既有判定口径，避免把错的姿态判成通过）；
   * 打开 allowArbitraryRotation 后，用「两孔间距一致的孔对」反推真实旋转角，
   * 从而支持 30°/45°/37.5° 这类任意角度的扇出姿态。
   */
  function candidateRotations(clusterPts, schemePts, distTol, allowRotation, allowArbitrary) {
    const base = allowRotation ? [0, 90, 180, 270] : [0];
    if (!allowArbitrary || !allowRotation || !clusterPts || !schemePts) return base;

    const out = [];
    const seen = new Set();
    const push = (deg) => {
      let d = ((deg % 360) + 360) % 360;
      if (d > 180) d -= 360;
      const key = Math.round(d * 10) / 10;          // 0.1° 粒度去重
      if (seen.has(key)) return;
      seen.add(key);
      out.push(key);
    };
    base.forEach(push);

    const tol = distTol != null ? distTol : 2.0;
    for (let i = 0; i < clusterPts.length; i++) {
      for (let j = i + 1; j < clusterPts.length; j++) {
        const dc = dist2D(clusterPts[i].x, clusterPts[i].y, clusterPts[j].x, clusterPts[j].y);
        for (let a = 0; a < schemePts.length; a++) {
          for (let b = a + 1; b < schemePts.length; b++) {
            const ds = dist2D(schemePts[a].x, schemePts[a].y, schemePts[b].x, schemePts[b].y);
            if (Math.abs(dc - ds) > tol) continue;   // 间距谱不一致，该孔对不可能对应
            // 把「方案 → 孔群」需要的旋转角正反两个方向都作为候选
            const d1 = angleDiffDeg(clusterPts[i], clusterPts[j], schemePts[a], schemePts[b]);
            push(d1);
            push(-d1);
            if (out.length > 64) return out;
          }
        }
      }
    }
    return out;
  }

  /** 两条有向线段的夹角差（度，−180~180） */
  function angleDiffDeg(c1, c2, s1, s2) {
    const ac = Math.atan2(c2.y - c1.y, c2.x - c1.x);
    const as = Math.atan2(s2.y - s1.y, s2.x - s1.x);
    let d = (as - ac) * 180 / Math.PI;
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    return d;
  }

  function roundN(val, n = 4) {
    if (typeof val !== 'number' || isNaN(val)) return 0;
    const factor = Math.pow(10, n);
    return Math.round(val * factor) / factor;
  }

  /**
   * 1. 解析 EDA TXT 中的过孔数据 (Via)
   * @param {string} text 
   * @returns {Array<Object>} vias
   */
  function parseViaData(text) {
    if (!text || typeof text !== 'string') return [];
    
    const RE_ITEM_BLOCK = /Item\s+(\d+)[\s\S]*?(?=Item\s+\d+|\s*$)/g;
    const RE_ORIGIN = /Origin-xy:\s*\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]/i;
    const RE_PADSTACK = /Padstack\s+Name:\s*([^\r\n]+)/i;
    const RE_NET = /Net:\s*([^\r\n]+)/i;
    const RE_DRILL = /Circle\s+Drill:\s*([\d\.\-]+)/i;
    const RE_ROTATION = /Rotation:\s*([\d\.\-]+)/i;
    const RE_MIRROR = /Mirror\s+Status:\s*([^\r\n]+)/i;

    const vias = [];
    let match;

    while ((match = RE_ITEM_BLOCK.exec(text)) !== null) {
      const itemNum = parseInt(match[1], 10);
      const block = match[0];

      if (!block.includes('< Via >') && !block.includes('<Via>')) {
        continue;
      }

      const origM = block.match(RE_ORIGIN);
      if (!origM) continue;

      const x = parseFloat(origM[1]);
      const y = parseFloat(origM[2]);
      const padM = block.match(RE_PADSTACK);
      const padstack = padM ? padM[1].trim() : 'UNKNOWN_PADSTACK';
      const netM = block.match(RE_NET);
      const net = netM ? netM[1].trim() : 'UNNAMED_NET';
      const drillM = block.match(RE_DRILL);
      const drill = drillM ? parseFloat(drillM[1]) : 0;
      const rotM = block.match(RE_ROTATION);
      const rotation = rotM ? parseFloat(rotM[1]) : 0;
      const mirM = block.match(RE_MIRROR);
      const mirror = mirM ? mirM[1].trim() : 'N';

      const hasConnections = /Connections:\s*\r?\n\s*\w+/i.test(block);
      const traceConnM = block.match(/Connections:[\s\S]*?Trace:\s*\d+\s*\(([^)]+)\)/i);
      const connectedTraceLayers = traceConnM
        ? traceConnM[1].trim().split(/[\s,]+/).filter(Boolean)
        : [];
      const isSignal = !net.toUpperCase().includes('GND');

      vias.push({
        id: itemNum,
        rawId: itemNum,
        x,
        y,
        padstack,
        net,
        drill,
        rotation,
        mirror,
        hasConnections,
        connectedTraceLayers,
        isSignal
      });
    }

    // 如果没有匹配到任何 Item 块，尝试通用 CSV / 制表符坐标解析
    if (vias.length === 0 && !/Item\s+\d+\s*</i.test(text)) {
      const lines = text.split(/\r?\n/);
      let autoId = 1;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
        // 尝试匹配 "X, Y, Padstack, Net" 或 "X Y Padstack"
        const parts = trimmed.split(/[\t,;]+/).map(s => s.trim()).filter(Boolean);
        if (parts.length >= 2) {
          const px = parseFloat(parts[0]);
          const py = parseFloat(parts[1]);
          if (!isNaN(px) && !isNaN(py)) {
            const padstack = parts[2] || 'STANDARD_VIA';
            const net = parts[3] || 'GND';
            vias.push({
              id: autoId++,
              rawId: autoId - 1,
              x: px,
              y: py,
              padstack,
              net,
              drill: 0,
              rotation: 0,
              mirror: 'N'
            });
          }
        }
      }
    }

    return vias;
  }

  /**
   * 1b. 世界坐标系圆弧参数化采样 (消除 Canvas Y 轴翻转导致的 CW/CCW 方向反转或 270° 环绕问题)
   */
  function sampleArcWorldPoints(center, radius, p1, p2, direction, steps = 20) {
    if (!center || !(radius > 0) || !p1 || !p2) {
      return [p1 || [0, 0], p2 || [0, 0]];
    }
    const cx = center[0], cy = center[1];
    const ang1 = Math.atan2(p1[1] - cy, p1[0] - cx);
    const ang2 = Math.atan2(p2[1] - cy, p2[0] - cx);
    const TWO_PI = Math.PI * 2;
    const isCCW = String(direction || 'CCW').toUpperCase() === 'CCW';

    let span;
    if (isCCW) {
      span = (ang2 - ang1) % TWO_PI;
      if (span < 0) span += TWO_PI;
    } else {
      span = (ang1 - ang2) % TWO_PI;
      if (span < 0) span += TWO_PI;
    }
    if (Math.abs(span) < 1e-7) {
      const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      span = chord < 1e-4 ? TWO_PI : 0;
    }

    const pts = [];
    const n = Math.max(6, steps);
    for (let i = 0; i <= n; i++) {
      const frac = i / n;
      const curAng = isCCW ? (ang1 + frac * span) : (ang1 - frac * span);
      pts.push([
        roundN(cx + radius * Math.cos(curAng), 4),
        roundN(cy + radius * Math.sin(curAng), 4)
      ]);
    }
    return { points: pts, spanAngle: span, arcLength: radius * span };
  }

  /**
   * 1c. 解析导入的 PCB 走线数据 (Allegro / Valor / EDA Trace & Trace Seg TXT)
   * 支持格式:
   * - Item N < Trace > (单块多段 Seg / Arc seg，如走线示例.txt)
   * - Item N < Trace Seg > (单块单段直线或圆弧，如 via_trace_airgap_sample.txt)
   * - Item N < Line > / < Line Seg > / < Seg > / < Segment > / < Arc > / < Cline > / < Cline Seg >
   *
   * @param {string} text
   * @returns {Array<Object>} traces
   */
  function parseTraceData(text) {
    if (!text || typeof text !== 'string') return [];

    const RE_ITEM_BLOCK = /Item\s+(\d+)\s*<\s*([^>]+?)\s*>([\s\S]*?)(?=Item\s+\d+\s*<|\s*$)/gi;
    const RE_TRACE_TAG = /^(?:Trace(?:\s+Seg)?|Line(?:\s+Seg)?|Seg|Segment|Arc|Cline(?:\s+Seg)?)$/i;
    const RE_SUBSET = /(?:Subset|Layer)\s*:\s*([^\r\n]+)/i;
    const RE_SET = /^\s*Set\s*:\s*([^\r\n]+)/im;
    const RE_TYPE = /^\s*Type\s*:\s*([^\r\n]+)/im;
    const RE_NET = /^\s*Net\s*:\s*([^\r\n]+)/im;
    const RE_LEN = /(?:Seg\s+Length|Length)\s*:\s*([\d\.\-+eE]+)/i;

    const traces = [];
    let match;

    while ((match = RE_ITEM_BLOCK.exec(text)) !== null) {
      const itemNum = parseInt(match[1], 10);
      const rawTag = match[2].trim();
      const body = match[3];

      if (!RE_TRACE_TAG.test(rawTag)) continue;

      const subM = body.match(RE_SUBSET);
      const layer = subM ? subM[1].trim() : 'UNKNOWN_LAYER';
      const setM = body.match(RE_SET);
      const setClass = setM ? setM[1].trim() : 'Trace';
      const typeM = body.match(RE_TYPE);
      const segTypeLabel = typeM ? typeM[1].trim() : rawTag;
      const netM = body.match(RE_NET);
      const net = netM ? netM[1].trim() : 'UNNAMED_NET';
      const lenM = body.match(RE_LEN);
      const declaredLength = lenM ? parseFloat(lenM[1]) : NaN;

      const segments = [];
      const lines = body.split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i].trim();
        if (!ln) continue;

        // 匹配圆弧段: Arc seg: xy [x1, y1] xy [x2, y2] Width (w)
        const arcM = ln.match(/^Arc\s*seg\s*:\s*(?:xy\s*)?\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]\s*(?:to\s*|xy\s*)?\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\](?:.*?Width\s*\(\s*([\d\.\-]+)\s*\))?/i);
        if (arcM) {
          const x1 = parseFloat(arcM[1]);
          const y1 = parseFloat(arcM[2]);
          const x2 = parseFloat(arcM[3]);
          const y2 = parseFloat(arcM[4]);
          const width = arcM[5] != null ? parseFloat(arcM[5]) : 5.0;

          // 在当前行或后续 1~2 行查找 Center-xy 与 Radius 与 CW/CCW
          let cx = (x1 + x2) / 2;
          let cy = (y1 + y2) / 2;
          let radius = Math.hypot(x2 - x1, y2 - y1) / 2;
          let dir = 'CCW';
          let hasCenter = false;

          for (let k = i; k <= Math.min(lines.length - 1, i + 2); k++) {
            const look = lines[k];
            if (k > i && /^(?:Arc\s*seg|Line\s*seg|Seg|Segment)\s*:/i.test(look.trim())) break;
            const cM = look.match(/Center-xy\s*:\s*\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]/i);
            if (cM) {
              cx = parseFloat(cM[1]);
              cy = parseFloat(cM[2]);
              hasCenter = true;
            }
            const rM = look.match(/Radius\s*\(\s*([\d\.\-]+)\s*\)/i);
            if (rM) {
              radius = parseFloat(rM[1]);
            }
            if (/\bCCW\b/i.test(look)) dir = 'CCW';
            else if (/\bCW\b/i.test(look)) dir = 'CW';
          }

          const sampled = sampleArcWorldPoints([cx, cy], radius, [x1, y1], [x2, y2], dir, 20);
          const segLen = (segments.length === 0 && !isNaN(declaredLength) && lines.filter(l => /seg\s*:/i.test(l)).length === 1)
            ? declaredLength
            : (sampled.arcLength || Math.hypot(x2 - x1, y2 - y1));

          segments.push({
            type: 'arc',
            x1, y1, x2, y2,
            cx, cy, radius, dir,
            hasCenter,
            width,
            length: roundN(segLen, 4),
            points: sampled.points
          });
          continue;
        }

        // 匹配直线段: Seg: / Line seg: / Segment: xy [x1, y1] xy [x2, y2] Width (w)
        const lineM = ln.match(/^(?:(?:Line\s*seg|Seg|Segment)\s*:\s*)?(?:xy\s*)?\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]\s*(?:to\s*|xy\s*)\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\](?:.*?Width\s*\(\s*([\d\.\-]+)\s*\))?/i);
        if (lineM && !/^Center-xy/i.test(ln) && !/^Origin-xy/i.test(ln)) {
          const x1 = parseFloat(lineM[1]);
          const y1 = parseFloat(lineM[2]);
          const x2 = parseFloat(lineM[3]);
          const y2 = parseFloat(lineM[4]);
          const width = lineM[5] != null ? parseFloat(lineM[5]) : 5.0;
          const angM = ln.match(/Angle\s*\(\s*([\d\.\-]+)\s*\)/i);
          const angle = angM ? parseFloat(angM[1]) : null;
          const calcLen = Math.hypot(x2 - x1, y2 - y1);

          segments.push({
            type: 'line',
            x1, y1, x2, y2,
            width,
            angle,
            length: roundN(calcLen, 4),
            points: [[x1, y1], [x2, y2]]
          });
        }
      }

      if (segments.length === 0) continue;

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let sumSegLen = 0;
      let lineCount = 0;
      let arcCount = 0;
      const widthSet = new Set();

      for (const seg of segments) {
        sumSegLen += seg.length || 0;
        if (seg.type === 'arc') arcCount++;
        else lineCount++;
        if (seg.width > 0) widthSet.add(roundN(seg.width, 4));
        const pts = seg.points || [[seg.x1, seg.y1], [seg.x2, seg.y2]];
        for (const p of pts) {
          if (p[0] < minX) minX = p[0];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1];
          if (p[1] > maxY) maxY = p[1];
        }
      }

      const widths = Array.from(widthSet).sort((a, b) => a - b);
      const totalLength = !isNaN(declaredLength) && declaredLength > 0
        ? roundN(declaredLength, 4)
        : roundN(sumSegLen, 4);

      const firstSeg = segments[0];
      const lastSeg = segments[segments.length - 1];

      traces.push({
        id: itemNum,
        rawId: itemNum,
        tag: rawTag,
        set: setClass,
        layer,
        subset: layer,
        type: segTypeLabel,
        net,
        width: widths.length > 0 ? widths[0] : 5.0,
        widths,
        length: totalLength,
        lineCount,
        arcCount,
        segmentCount: segments.length,
        segments,
        start: [firstSeg.x1, firstSeg.y1],
        end: [lastSeg.x2, lastSeg.y2],
        bbox: { minX, maxX, minY, maxY }
      });
    }

    return traces;
  }

  /**
   * 1d. 统计已解析的走线 (Trace) 汇总指标
   */
  function summarizeTraceData(traces) {
    const list = Array.isArray(traces) ? traces : [];
    const layerStats = {};
    const netStats = {};
    const widthSet = new Set();
    let totalSegments = 0;
    let lineSegCount = 0;
    let arcSegCount = 0;
    let totalLength = 0;

    for (const t of list) {
      totalSegments += t.segmentCount || (t.segments ? t.segments.length : 0);
      lineSegCount += t.lineCount || 0;
      arcSegCount += t.arcCount || 0;
      totalLength += t.length || 0;

      const lyr = t.layer || 'UNKNOWN_LAYER';
      if (!layerStats[lyr]) {
        layerStats[lyr] = { layer: lyr, traceCount: 0, segmentCount: 0, lineCount: 0, arcCount: 0, totalLength: 0, nets: new Set(), widths: new Set() };
      }
      layerStats[lyr].traceCount++;
      layerStats[lyr].segmentCount += t.segmentCount || 0;
      layerStats[lyr].lineCount += t.lineCount || 0;
      layerStats[lyr].arcCount += t.arcCount || 0;
      layerStats[lyr].totalLength = roundN(layerStats[lyr].totalLength + (t.length || 0), 3);
      if (t.net) layerStats[lyr].nets.add(t.net);
      (t.widths || []).forEach(w => { layerStats[lyr].widths.add(w); widthSet.add(w); });

      const net = t.net || 'UNNAMED_NET';
      if (!netStats[net]) {
        netStats[net] = { net, traceCount: 0, segmentCount: 0, arcCount: 0, totalLength: 0, layers: new Set(), widths: new Set() };
      }
      netStats[net].traceCount++;
      netStats[net].segmentCount += t.segmentCount || 0;
      netStats[net].arcCount += t.arcCount || 0;
      netStats[net].totalLength = roundN(netStats[net].totalLength + (t.length || 0), 3);
      netStats[net].layers.add(lyr);
      (t.widths || []).forEach(w => netStats[net].widths.add(w));
    }

    const layers = Object.values(layerStats).map(item => ({
      layer: item.layer,
      traceCount: item.traceCount,
      segmentCount: item.segmentCount,
      lineCount: item.lineCount,
      arcCount: item.arcCount,
      totalLength: item.totalLength,
      nets: Array.from(item.nets),
      widths: Array.from(item.widths).sort((a, b) => a - b)
    }));

    const nets = Object.values(netStats).map(item => ({
      net: item.net,
      traceCount: item.traceCount,
      segmentCount: item.segmentCount,
      arcCount: item.arcCount,
      totalLength: item.totalLength,
      layers: Array.from(item.layers),
      widths: Array.from(item.widths).sort((a, b) => a - b)
    }));

    return {
      totalTraces: list.length,
      totalTraceSegments: totalSegments,
      traceLineCount: lineSegCount,
      traceArcCount: arcSegCount,
      totalTraceLength: roundN(totalLength, 3),
      widths: Array.from(widthSet).sort((a, b) => a - b),
      layers,
      nets
    };
  }

  /**
   * 1e. 统一解析扇出检查输入文本 (同时读取 Via 与 Trace 数据)
   */
  function parseFanoutInputData(text) {
    const vias = parseViaData(text);
    const traces = parseTraceData(text);
    const traceSummary = summarizeTraceData(traces);
    return { vias, traces, traceSummary };
  }

  /**
   * 1f. 将已导入的走线 (Trace) 关联到对应的信号过孔与扇出孔群单元
   */
  function associateTracesWithClusters(vias, clusterUnits, traces, connectTol = 18.0) {
    if (!Array.isArray(traces) || traces.length === 0) {
      (clusterUnits || []).forEach(c => {
        c.connectedTraces = [];
        c.traceSummary = { traceCount: 0, segmentCount: 0, arcCount: 0, layers: [], widths: [], totalLength: 0 };
      });
      return;
    }

    // 1. 为每个过孔标记直接物理相连的走线端点 (端点距孔中心 <= connectTol)
    if (Array.isArray(vias)) {
      for (const v of vias) {
        const directIds = [];
        const lyrSet = new Set(v.connectedTraceLayers || []);
        for (const t of traces) {
          for (const seg of (t.segments || [])) {
            const d1 = Math.hypot(seg.x1 - v.x, seg.y1 - v.y);
            const d2 = Math.hypot(seg.x2 - v.x, seg.y2 - v.y);
            if (d1 <= connectTol || d2 <= connectTol) {
              directIds.push(t.id);
              if (t.layer) lyrSet.add(t.layer);
              break;
            }
          }
        }
        v.connectedTraceIds = directIds;
        v.resolvedTraceLayers = Array.from(lyrSet);
      }
    }

    // 2. 为每个扇出孔群单元聚合关联走线 (物理端点相连 或 同信号网络走线)
    for (const cluster of (clusterUnits || [])) {
      const sigVias = cluster.signalVias || [];
      const sigNets = new Set(
        sigVias
          .map(sv => (sv.net || '').trim())
          .filter(n => n && !n.toUpperCase().includes('GND') && n !== 'UNNAMED_NET')
      );

      const matched = [];
      const seenIds = new Set();

      for (const t of traces) {
        let isLinked = false;
        // 规则 A: 走线任一段端点直接落在信号孔焊盘附近
        for (const sv of sigVias) {
          for (const seg of (t.segments || [])) {
            if (Math.hypot(seg.x1 - sv.x, seg.y1 - sv.y) <= connectTol ||
                Math.hypot(seg.x2 - sv.x, seg.y2 - sv.y) <= connectTol) {
              isLinked = true;
              break;
            }
          }
          if (isLinked) break;
        }

        // 规则 B: 走线网络与该扇出孔群信号网络一致 (如 26_P / 26_N)
        if (!isLinked && t.net && sigNets.has(t.net.trim())) {
          // 若同一网络存在多个相距很远的扇出单元，优先关联距本孔群 600 mil 内的同网络走线；若单孔群则全关联
          const cx = cluster.centroid ? cluster.centroid.x : 0;
          const cy = cluster.centroid ? cluster.centroid.y : 0;
          const tb = t.bbox || { minX: cx, maxX: cx, minY: cy, maxY: cy };
          const dx = cx < tb.minX ? tb.minX - cx : (cx > tb.maxX ? cx - tb.maxX : 0);
          const dy = cy < tb.minY ? tb.minY - cy : (cy > tb.maxY ? cy - tb.maxY : 0);
          if (Math.hypot(dx, dy) <= 800) {
            isLinked = true;
          }
        }

        if (isLinked && !seenIds.has(t.id)) {
          seenIds.add(t.id);
          matched.push(t);
        }
      }

      const layerSet = new Set();
      const widthSet = new Set();
      let segCount = 0;
      let arcCount = 0;
      let totalLen = 0;

      // 同时合并信号孔 Connections 字段声明的走线层
      sigVias.forEach(sv => {
        (sv.connectedTraceLayers || []).forEach(l => layerSet.add(l));
      });

      matched.forEach(t => {
        if (t.layer && t.layer !== 'UNKNOWN_LAYER') layerSet.add(t.layer);
        (t.widths || []).forEach(w => widthSet.add(w));
        segCount += t.segmentCount || 0;
        arcCount += t.arcCount || 0;
        totalLen += t.length || 0;
      });

      cluster.connectedTraces = matched;
      cluster.traceSummary = {
        traceCount: matched.length,
        segmentCount: segCount,
        arcCount,
        layers: Array.from(layerSet),
        widths: Array.from(widthSet).sort((a, b) => a - b),
        totalLength: roundN(totalLen, 2)
      };
    }
  }

  /**
   * 2. 空间距离图连通分量聚类 (Spatial Hash Grid Clustering)
   * 依据：两孔中心距 <= threshold (默认 2mm = 78.7402 mil) 认为同属于一个扇出方案整体
   * 
   * @param {Array<Object>} vias 
   * @param {number} thresholdDist 中心距阈值 (单位与坐标一致，通常为 mil)
   * @returns {Array<Object>} clusters 分割后的孔整体集合
   */
  function isSignalVia(v) {
    if (!v) return false;
    var net = String(v.net || '').trim().toUpperCase();
    var role = String(v.role || '').trim();
    var pad = String(v.padstack || '').trim().toUpperCase();
    if (net === 'GND' || net.startsWith('GND_') || net.endsWith('_GND') || /GND|GROUND|地孔|屏蔽/.test(role) || pad.includes('GND')) {
      return false;
    }
    if (net && net !== 'N/A' && net !== 'DUMMY') return true;
    if (role.includes('信号') || role.includes('差分') || pad.includes('SMA') || pad.includes('SIG') || pad.includes('DIFF') || pad.includes('3510')) {
      return true;
    }
    return false;
  }

  return {
    MM_PER_MIL: MM_PER_MIL,
    MIL_PER_MM: MIL_PER_MM,
    isSignalVia: isSignalVia,
    dist2D: dist2D,
    candidateRotations: candidateRotations,
    angleDiffDeg: angleDiffDeg,
    roundN: roundN,
    parseViaData: parseViaData,
    sampleArcWorldPoints: sampleArcWorldPoints,
    parseTraceData: parseTraceData,
    summarizeTraceData: summarizeTraceData,
    parseFanoutInputData: parseFanoutInputData,
    associateTracesWithClusters: associateTracesWithClusters
  };
});
