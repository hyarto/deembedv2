/**
 * fanout-check.js
 * 扇出方案空间几何聚类与模式匹配检查引擎
 * 
 * 功能：
 * 1. EDA 过孔数据解析 (Item N < Via > 格式)
 * 2. 空间距离连通聚类算法 (Spatial Hash Grid 2D 连通分量，支持自定义距离阈值如 2mm)
 * 3. 扇出方案库管理 (定义孔间中心距、每个孔的 Padstack Name、方案命名与预设库)
 * 4. 刚体变换不变性几何比对 (支持平移、旋转 0/90/180/270度与镜像匹配)
 * 5. 精确缺陷归因 (明确指出 Padstack 不符孔位、中心距超差对偶、孔数缺失或未知拓扑)
 */

(function (global) {
  'use strict';

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
  function clusterVias(vias, thresholdDist = 78.740157) {
    if (!vias || vias.length === 0) return [];
    const n = vias.length;

    // Disjoint Set Union (并查集)
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

    // 空间网格索引加速，避免 O(N^2)
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
            if (distSq <= threshSq) union(i, j);
          }
        }
      }
    }

    // 按连通分量汇总孔整体
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

    // 格式化每个 Cluster 对象
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

      // 仅对典型扇出规模 (<= 100 孔) 计算全量两两孔心距；超大孔群按需计算，极大节省内存
      const pairwiseDistances = [];
      if (count <= 100) {
        for (let i = 0; i < count; i++) {
          for (let j = i + 1; j < count; j++) {
            const d = Math.hypot(members[i].x - members[j].x, members[i].y - members[j].y);
            pairwiseDistances.push({
              v1: members[i].id,
              v2: members[j].id,
              dist: d,
              distMm: d * MM_PER_MIL
            });
          }
        }
      }

      // Padstack 统计
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

  /**
   * 3. 扇出方案定义与库管理 (Fanout Scheme Template & Library)
   */
  class FanoutScheme {
    /**
     * @param {Object} options
     * @param {string} options.id 方案唯一标识
     * @param {string} options.name 方案名称 (如 "SMA-Bot-L19-5Via")
     * @param {string} options.category 方案类别 (如 "SMA出线", "BGA差分")
     * @param {string} options.description 描述说明
     * @param {Array<Object>} options.vias 方案内各过孔定义 [{id, x, y, padstack, net, role}]
     * @param {string} options.unit 方案坐标单位 'mil' 或 'mm' (默认 'mil')
     */
    constructor(options = {}) {
      this.id = options.id || `scheme_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      this.name = options.name || '未命名扇出方案';
      this.category = options.category || '通用扇出';
      this.description = options.description || '';
      this.unit = options.unit || 'mil';

      // 规范化孔位信息 (统一存储为 mil)
      const rawVias = options.vias || [];
      const unitScale = this.unit === 'mm' ? MIL_PER_MM : 1.0;

      this.vias = rawVias.map((v, idx) => ({
        id: v.id != null ? v.id : idx + 1,
        x: (v.x || 0) * unitScale,
        y: (v.y || 0) * unitScale,
        padstack: (v.padstack || 'STANDARD_VIA').trim(),
        net: (v.net || '').trim(),
        role: (v.role || '').trim(),
        drill: v.drill || 0
      }));

      this.viaCount = this.vias.length;
      this._computeGeometry();
    }

    /**
     * 计算方案内部几何特征（质心归一化、孔间距矩阵、特征距离谱）
     */
    _computeGeometry() {
      if (this.viaCount === 0) {
        this.centroid = { x: 0, y: 0 };
        this.pairwiseDistances = [];
        this.distMatrix = [];
        this.normalizedVias = [];
        return;
      }

      let sumX = 0, sumY = 0;
      for (const v of this.vias) {
        sumX += v.x;
        sumY += v.y;
      }
      this.centroid = { x: sumX / this.viaCount, y: sumY / this.viaCount };

      // 质心归一化坐标 (Centered Coords)
      this.normalizedVias = this.vias.map(v => ({
        ...v,
        nx: v.x - this.centroid.x,
        ny: v.y - this.centroid.y
      }));

      // 两两孔心距
      this.pairwiseDistances = [];
      this.distMatrix = [];
      for (let i = 0; i < this.viaCount; i++) {
        this.distMatrix[i] = new Float64Array(this.viaCount);
      }

      for (let i = 0; i < this.viaCount; i++) {
        for (let j = i + 1; j < this.viaCount; j++) {
          const d = dist2D(this.vias[i].x, this.vias[i].y, this.vias[j].x, this.vias[j].y);
          this.distMatrix[i][j] = d;
          this.distMatrix[j][i] = d;
          this.pairwiseDistances.push({
            viaAIndex: i,
            viaBIndex: j,
            dist: d,
            distMm: d * MM_PER_MIL
          });
        }
      }

      this.pairwiseDistances.sort((a, b) => a.dist - b.dist);

      // 提取 Padstack 频次分布
      this.padstackCounts = {};
      for (const v of this.vias) {
        const p = v.padstack;
        this.padstackCounts[p] = (this.padstackCounts[p] || 0) + 1;
      }
    }

    /**
     * 导出为纯 JSON 配置对象
     */
    toJSON() {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        description: this.description,
        unit: 'mil',
        vias: this.vias.map(v => ({
          id: v.id,
          x: roundN(v.x, 4),
          y: roundN(v.y, 4),
          padstack: v.padstack,
          net: v.net,
          role: v.role,
          drill: v.drill
        }))
      };
    }

    /**
     * 从文本片段或过孔集合创建扇出方案
     */
    static fromVias(name, vias, options = {}) {
      return new FanoutScheme({
        name,
        category: options.category || '导入方案',
        description: options.description || '',
        unit: options.unit || 'mil',
        vias
      });
    }

    /**
     * 从 EDA 文本片段创建方案
     */
    static fromText(name, text, options = {}) {
      const parsed = parseViaData(text);
      return FanoutScheme.fromVias(name, parsed, options);
    }
  }

  /**
   * 扇出方案库管理器
   */
  class FanoutLibrary {
    constructor() {
      this.schemes = [];
    }

    addScheme(scheme) {
      if (!(scheme instanceof FanoutScheme)) {
        scheme = new FanoutScheme(scheme);
      }
      // 检查重名或重复 ID
      const existingIdx = this.schemes.findIndex(s => s.id === scheme.id || s.name === scheme.name);
      if (existingIdx >= 0) {
        this.schemes[existingIdx] = scheme;
      } else {
        this.schemes.push(scheme);
      }
      syncLibraryPadstackColors(this.schemes);
      return scheme;
    }

    removeScheme(schemeId) {
      const idx = this.schemes.findIndex(s => s.id === schemeId);
      if (idx >= 0) {
        this.schemes.splice(idx, 1);
        return true;
      }
      return false;
    }

    renameScheme(schemeId, newName) {
      const cleanName = String(newName || '').trim();
      if (!cleanName) return null;
      const sc = this.getScheme(schemeId);
      if (!sc) return null;
      sc.name = cleanName;
      return sc;
    }

    getScheme(schemeId) {
      return this.schemes.find(s => s.id === schemeId || s.name === schemeId) || null;
    }

    clear() {
      this.schemes = [];
      resetPadstackColorRegistry();
    }

    toJSON() {
      return this.schemes.map(s => s.toJSON());
    }

    loadFromJSON(jsonInput) {
      let array = jsonInput;
      if (typeof jsonInput === 'string') {
        const res = parseAndRepairFanoutJson(jsonInput);
        if (res.success && Array.isArray(res.schemes)) array = res.schemes;
      }
      if (!Array.isArray(array)) return;
      this.clear();
      for (const item of array) {
        this.addScheme(new FanoutScheme(item));
      }
    }

    /**
     * 加载内置标准方案预设库
     */
    loadStandardPresets() {
      const presets = getStandardPresetSchemes();
      for (const p of presets) {
        this.addScheme(p);
      }
    }
  }

  /**
   * 内置典型扇出方案预设
   */
  function getStandardPresetSchemes() {
    return [
      // 方案 1: SMA Bot-L19 5孔十字扇出 (1信号孔 + 4地孔)
      new FanoutScheme({
        id: 'preset_sma_bot_l19_5via',
        name: 'SMA-Bot-L19-5孔标准十字扇出',
        category: 'SMA接插件扇出',
        description: '底面L19层出线 SMA 1信号孔 + 4个伴随GND屏蔽地孔，孔心距 20mil/28.28mil',
        vias: [
          { id: 1, x: 0.0, y: 0.0, padstack: 'SMA_Bot-L19_d2m6mil_via-0902', net: 'SIG', role: '中心信号孔' },
          { id: 2, x: 0.0, y: 20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随屏蔽地孔(上)' },
          { id: 3, x: 0.0, y: -20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随屏蔽地孔(下)' },
          { id: 4, x: -20.0, y: 0.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随屏蔽地孔(左)' },
          { id: 5, x: 20.0, y: 0.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随屏蔽地孔(右)' }
        ]
      }),

      // 方案 2: SMA L2 表层 5孔十字扇出
      new FanoutScheme({
        id: 'preset_sma_l2_5via',
        name: 'SMA-L2-5孔表层十字扇出',
        category: 'SMA接插件扇出',
        description: 'L2层出线 SMA 1信号孔 + 4个伴随GND屏蔽地孔',
        vias: [
          { id: 1, x: 0.0, y: 0.0, padstack: 'SMA_L2_d2m6mil_via_0902', net: 'SIG', role: '中心信号孔' },
          { id: 2, x: 0.0, y: 20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随屏蔽地孔(上)' },
          { id: 3, x: 0.0, y: -20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随屏蔽地孔(下)' },
          { id: 4, x: -20.0, y: 0.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随屏蔽地孔(左)' },
          { id: 5, x: 20.0, y: 0.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随屏蔽地孔(右)' }
        ]
      }),

      // 方案 3: BGA 差分孔对 + 4伴随地孔 (6孔对称方案)
      new FanoutScheme({
        id: 'preset_bga_diff_6via',
        name: 'BGA-差分对+4伴随地孔(6孔方案)',
        category: 'BGA差分扇出',
        description: 'BGA区域差分对信号孔(P/N) + 四角包围伴随地孔',
        vias: [
          { id: 1, x: -10.0, y: 0.0, padstack: 'test_BGA_3510_L19_L2_ring3mil', net: 'DIFF_P', role: '差分信号孔P' },
          { id: 2, x: 10.0, y: 0.0, padstack: 'test_BGA_3510_L19_L2_ring3mil', net: 'DIFF_N', role: '差分信号孔N' },
          { id: 3, x: -30.0, y: 20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随地孔1' },
          { id: 4, x: 30.0, y: 20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随地孔2' },
          { id: 5, x: -30.0, y: -20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随地孔3' },
          { id: 6, x: 30.0, y: -20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随地孔4' }
        ]
      }),

      // 方案 4: BGA 2×2 地孔阵列 (4孔方案)
      new FanoutScheme({
        id: 'preset_bga_2x2_gnd_4via',
        name: 'BGA-2×2地孔阵列(4孔方案)',
        category: 'BGA地孔阵列',
        description: 'BGA 2×2 矩形地孔阵列，间距 20mil × 20mil',
        vias: [
          { id: 1, x: -10.0, y: 10.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '地孔(左上)' },
          { id: 2, x: 10.0, y: 10.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '地孔(右上)' },
          { id: 3, x: -10.0, y: -10.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '地孔(左下)' },
          { id: 4, x: 10.0, y: -10.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '地孔(右下)' }
        ]
      }),

      // 方案 5: 1×3 直线地孔排 (3孔方案)
      new FanoutScheme({
        id: 'preset_bga_1x3_gnd_3via',
        name: 'BGA-1×3直线地孔排(3孔方案)',
        category: 'BGA地孔阵列',
        description: 'BGA 直线排列 3个地孔，间距 20mil',
        vias: [
          { id: 1, x: 0.0, y: -20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '地孔1' },
          { id: 2, x: 0.0, y: 0.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '地孔2' },
          { id: 3, x: 0.0, y: 20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '地孔3' }
        ]
      }),

      // 方案 6: 高速差分双孔扇出 (2孔方案)
      new FanoutScheme({
        id: 'preset_diff_pair_2via',
        name: '高速差分对双孔扇出(2孔方案)',
        category: '高速差分扇出',
        description: '高速差分对双过孔，中心距 20mil',
        vias: [
          { id: 1, x: 0.0, y: -10.0, padstack: 'test_BGA_3510_L19_L2_ring3mil', net: 'DIFF_P', role: '差分P孔' },
          { id: 2, x: 0.0, y: 10.0, padstack: 'test_BGA_3510_L19_L2_ring3mil', net: 'DIFF_N', role: '差分N孔' }
        ]
      })
    ];
  }

  /**
   * 4. 几何与 Padstack 比对核心算法 (Pattern Matcher)
   * 
   * 判据：
   * 1. 孔与孔中心距是否一致 (在允许容差范围内，支持平移、旋转 0/90/180/270度及镜像变换)
   * 2. 每个对应孔的 Padstack Name 是否一致
   * 
   * @param {Object} cluster 分割出的一个孔整体
   * @param {FanoutLibrary} library 扇出方案库
   * @param {Object} options 匹配参数
   * @param {number} options.distanceTolerance 孔间距匹配容差 (mil, 默认 2.0mil ≈ 0.05mm)
   * @param {boolean} options.allowRotation 是否允许旋转 (默认 true)
   * @param {boolean} options.allowMirror 是否允许镜像 (默认 true)
   * @returns {Object} 匹配结果详情
   */

  /**
   * 子集/局部拓扑匹配算法 (Subset Pattern Matcher & Redundancy Inspector)
   * 
   * 针对连通聚类后形成的复杂/组合孔群 (如 30-34 孔大区域)：
   * 分析该孔阵列中是否包含方案库定义的 1 个或多个扇出拓扑子集，
   * 并识别出外围的伴随屏蔽地孔/冗余孔 (Redundant Vias)。
   */
  function matchClusterSubsetsIterative(cluster, library, options = {}) {
    const distTol = options.distanceTolerance != null ? options.distanceTolerance : 2.0;
    const allowRotation = options.allowRotation !== false;
    const allowMirror = options.allowMirror !== false;
    const redundantPolicy = options.redundantViaPolicy || 'ANY_GND_REDUNDANT';
    const K = cluster.vias.length;

    // 候选方案按孔数从大到小排序，优先匹配大拓扑
    const candidateSchemes = library.schemes
      .filter(s => s.vias && s.vias.length > 0 && s.vias.length <= K)
      .sort((a, b) => b.vias.length - a.vias.length);

    if (candidateSchemes.length === 0) return null;

    // 建立空间哈希网格加速邻近孔查找
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
              bestIdx = idx;
            }
          }
        }
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

      // 仅在未被占用的锚点孔中寻找匹配
      let candidateIndices = [];
      for (let i = 0; i < K; i++) {
        const cv = cluster.vias[i];
        if (isSignalAnchor) {
          if (cv.net && !cv.net.toUpperCase().includes('GND') && !claimedSignalViaIds.has(cv.id)) {
            candidateIndices.push(i);
          }
        } else {
          candidateIndices.push(i);
        }
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
                break;
              }
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
              });
            }
          }
        }
      }
    }

    // 候选子集匹配排序选择: 优先 Padstack 100% 吻合 (padMismatchCount 最小)，其次孔数最多，再次几何偏差最小
    rawCandidates.sort((a, b) => {
      if (a.padMismatchCount !== b.padMismatchCount) return a.padMismatchCount - b.padMismatchCount;
      if (b.viaCount !== a.viaCount) return b.viaCount - a.viaCount;
      return a.maxDeviation - b.maxDeviation;
    });

    // 贪心配对：非重叠认领信号孔
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
    // 不管存不存在冗余孔，只要孔群内有与扇出方案库一致的孔，就认定为匹配通过
    const pass = totalPadMismatches === 0;

    let status = pass ? 'SUBSET_MATCH_PASS' : 'SUBSET_PADSTACK_MISMATCH';
    let statusText = pass 
      ? (redundantVias.length > 0 ? `匹配通过 (含${redundantVias.length}个冗余孔)` : '完全匹配通过')
      : '子集Padstack不符';

    // 方案名称聚合去重计数
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

    // 构造全量过孔审计明细 (包含匹配孔和冗余孔)
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

    // 1. 优先进行全量 1:1 精确匹配
    let bestResult = null;
    let closestCandidate = null;

    for (const scheme of library.schemes) {
      if (!scheme.vias || scheme.vias.length === 0) continue;
      const res = compareClusterWithScheme(cluster, scheme, { distTol, allowRotation, allowMirror, allowArbitraryRotation });

      // 如果完全匹配通过，直接返回
      if (res.pass) {
        return res;
      }

      if (!bestResult || res.matchScore > (bestResult.matchScore || 0)) {
        bestResult = res;
      }

      if (!closestCandidate || res.geometrySimilarity > (closestCandidate.geometrySimilarity || 0)) {
        closestCandidate = res;
      }
    }

    // 若 1:1 全量匹配几何完全符合仅 Padstack 不符，直接返回 1:1 明确结论
    if (bestResult && bestResult.status === 'PADSTACK_MISMATCH') {
      return bestResult;
    }

    // 2. 如果全量匹配未通过，且开启了子集/冗余孔容差分析，执行子集拓扑与冗余孔分析
    if (allowSubsetMatch && library.schemes.length > 0) {
      const subsetRes = matchClusterSubsetsIterative(cluster, library, {
        distanceTolerance: distTol,
        allowRotation,
        allowMirror,
        redundantViaPolicy: redundantPolicy
      });

      if (subsetRes) {
        return subsetRes;
      }
    }

    // 3. 如果没有方案库或没有找到任何匹配
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

  /**
   * 将一个孔整体与指定方案进行深入比对
   */
  function compareClusterWithScheme(cluster, scheme, { distTol = 2.0, allowRotation = true, allowMirror = true, allowArbitraryRotation = false }) {
    const K = cluster.viaCount;
    const M = scheme.viaCount;

    // 孔数不匹配
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

    // 1. 检验孔间距谱 (Distance Spectrum)
    // 两个同构点集的两两距离排序列表必须在容差范围内一一接近
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

    // 2. 质心归一化点云刚体匹配 (寻找最佳旋转与点对点双射映射 Mapping)
    // 质心平移后测试标准旋转角度：0°, 90°, 180°, 270° 以及是否镜像
    const angles = candidateRotations(cluster.vias, scheme.vias, distTol, allowRotation, allowArbitraryRotation);
    const mirrors = allowMirror ? [false, true] : [false];

    // 聚类归一化坐标
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

        // 对方案模版点进行旋转与镜像变换
        const transformedSchemeVias = scheme.normalizedVias.map(sv => {
          let tx = sv.nx;
          let ty = sv.ny;
          if (mirror) tx = -tx; // 镜像 X
          // 旋转
          const rx = tx * cos - ty * sin;
          const ry = tx * sin + ty * cos;
          return {
            ...sv,
            tx: rx,
            ty: ry
          };
        });

        // 寻找每个 cluster 节点最近的 scheme 节点 (1-to-1 匹配)
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
              bestSchemeIdx = j;
            }
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
            };
          }
        }
      }
    }

    // 几何不符合的情况
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

    // 3. 几何匹配成功，进一步检验每个对应过孔的 Padstack Name (每个孔的 padstack name 是否一致)
    const viaAudit = [];
    const padstackMismatches = [];

    for (let i = 0; i < K; i++) {
      const cv = cluster.vias[i];
      const schemeViaIdx = bestAlignment.assignment[i];
      const sv = scheme.vias[schemeViaIdx];

      const actualPad = (cv.padstack || '').trim();
      const expectedPad = (sv.padstack || '').trim();

      // Padstack 比较 (不区分大小写，规范化后严格比对)
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

      if (!isPadMatch) {
        padstackMismatches.push(auditItem);
      }
    }

    // 4. 汇总判定结论
    if (padstackMismatches.length === 0) {
      // ✅ 完全匹配通过 (中心距一致 + 所有 Padstack 一致)
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
      // ❌ 几何匹配但 Padstack 不符
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
      };
    }
  }

  /**
   * 5. 完整扇出方案检查运行器 (Full Inspection Runner)
   * 
   * @param {string|Array<Object>} inputData TXT 文本或已解析过孔数组
   * @param {FanoutLibrary} library 方案库
   * @param {Object} options 配置选项
   * @param {number} options.clusterThreshold 聚类距离阈值 (mil, 默认 78.7402 mil = 2mm)
   * @param {number} options.distanceTolerance 孔心距几何匹配容差 (mil, 默认 2.0 mil)
   * @param {boolean} options.allowRotation 允许旋转
   * @param {boolean} options.allowMirror 允许镜像
   * @returns {Object} 检查结果汇总
   */
  
  /**
   * 空间网格索引构建 (用于毫秒级高速查找周围伴随地孔)
   */
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

  function parseAndRepairFanoutJson(input) {
    if (!input) return { success: false, error: '输入内容为空' };
    
    const text = (typeof input === 'string' ? input : (input.text || String(input))).replace(/^\uFEFF/, '').trim();
    if (!text) return { success: false, error: '输入内容为空' };

    // 1. First attempt: standard JSON.parse
    try {
      const parsed = JSON.parse(text);
      let schemes = [];
      let meta = {};
      if (Array.isArray(parsed)) {
        schemes = parsed;
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.schemes)) schemes = parsed.schemes;
        else if (Array.isArray(parsed.fanoutSchemes)) schemes = parsed.fanoutSchemes;
        else if (Array.isArray(parsed.data)) schemes = parsed.data;
        else if (parsed.vias && Array.isArray(parsed.vias)) schemes = [parsed];
        meta = parsed;
      }
      if (schemes.length > 0) {
        return { success: true, schemes, meta, recovered: false, message: `成功解析 ${schemes.length} 套扇出方案` };
      }
    } catch (err) {}

    // 2. Auto-repair for truncated / interrupted JSON
    let trimmed = text;

    // Repair strategy 1: Incomplete via properties at tail -> strip incomplete via and close
    const candidate1 = trimmed.replace(/,\s*\{[^{}]*"id":\s*\d+[^{}]*$/, '') + '\n    ]\n  }\n]';
    try {
      const p1 = JSON.parse(candidate1);
      const s1 = Array.isArray(p1) ? p1 : (p1.schemes || p1.fanoutSchemes);
      if (Array.isArray(s1) && s1.length > 0) {
        return {
          success: true,
          schemes: s1,
          recovered: true,
          message: `检测到 JSON 文件末尾截断，已自动容错修复并成功提取 ${s1.length} 套扇出方案！`
        };
      }
    } catch (e1) {}

    // Repair strategy 2: Try completing the last via if it only needs closing fields
    const candidate2 = trimmed.replace(/"role"\s*:\s*"[^"]*$/, '"role": "伴随地孔",\n        "drill": 0\n      }\n    ]\n  }\n]');
    try {
      const p2 = JSON.parse(candidate2);
      const s2 = Array.isArray(p2) ? p2 : (p2.schemes || p2.fanoutSchemes);
      if (Array.isArray(s2) && s2.length > 0) {
        return {
          success: true,
          schemes: s2,
          recovered: true,
          message: `检测到 JSON 文件末尾截断，已自动补全闭合并成功提取全部 ${s2.length} 套扇出方案！`
        };
      }
    } catch (e2) {}

    // Repair strategy 3: Rollback to the last completely closed scheme object '}'
    let endIdx = trimmed.length;
    while (endIdx > 0) {
      const lastObjClose = trimmed.lastIndexOf('}', endIdx - 1);
      if (lastObjClose === -1) break;

      const candidate3 = trimmed.slice(0, lastObjClose + 1).replace(/,\s*$/, '') + '\n]';
      try {
        const p3 = JSON.parse(candidate3);
        if (Array.isArray(p3) && p3.length > 0) {
          return {
            success: true,
            schemes: p3,
            recovered: true,
            message: `检测到 JSON 文件末尾截断，已自动截取前 ${p3.length} 套完整扇出方案！`
          };
        }
      } catch (e3) {
        endIdx = lastObjClose;
      }
    }

    // Repair strategy 4: Regex-based object extraction
    const schemeMatches = [];
    const schemeRegex = /\{\s*"id"\s*:\s*"scheme_[^"]+"[\s\S]*?"vias"\s*:\s*\[[\s\S]*?\]\s*\}/g;
    let m;
    while ((m = schemeRegex.exec(text)) !== null) {
      try {
        const singleScheme = JSON.parse(m[0]);
        if (singleScheme && singleScheme.id && Array.isArray(singleScheme.vias)) {
          schemeMatches.push(singleScheme);
        }
      } catch (e) {}
    }
    if (schemeMatches.length > 0) {
      return {
        success: true,
        schemes: schemeMatches,
        recovered: true,
        message: `检测到复杂格式异常，已通过模式扫描成功提取 ${schemeMatches.length} 套扇出方案！`
      };
    }

    return { success: false, error: '未能从文件中识别出有效的扇出方案 JSON 数据' };
  }

  /**
   * 解析包含多个扇出方案的多块 TXT 文本（每个方案之间使用 ~~~end~~~ 或 ~End~ 分界）
   * @param {string} text 
   * @param {number} existingCount 已有方案计数，用于命名序号
   * @returns {Array<Object>} parsed schemes
   */
  function parseMultiSchemeTxt(text, existingCount = 0) {
    if (!text || typeof text !== 'string') return [];

    const clean = String(text).replace(/^\uFEFF/, '').trim();
    if (!clean) return [];

    // 分界符规则：必须包含 end（如 ~~~end~~~, ~End~, ~~~ End ~~~, ===end===, ---end--- 等，不匹配纯 ~~~）
    const DELIM_REGEX = /(?:^|\r?\n)\s*[~=-]*\s*end\s*[~=-]*\s*(?:\r?\n|$)/i;

    let rawBlocks = clean.split(DELIM_REGEX).map(b => b.trim()).filter(Boolean);

    // 如果未找到 ~~~end~~~ 分界符，检查是否包含多个方案标题或 Item 1 块
    if (rawBlocks.length <= 1) {
      const schemeHeaderSplit = clean.split(/(?:^|\r?\n)(?=(?:[#=~-]*\s*(?:方案|Scheme|扇出方案)\s*[\d\w_]+|Item\s+1\b\s*<(?:\s*Via\s*)>))/i).map(b => b.trim()).filter(Boolean);
      if (schemeHeaderSplit.length > 1) {
        rawBlocks = schemeHeaderSplit;
      }
    }

    const results = [];

    rawBlocks.forEach((block, blockIdx) => {
      const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) return;

      let schemeName = '';
      let category = '通用扇出';

      // 提取标题：检查前 1~5 行非 Item/Origin/Delimiter 的描述文本
      for (let i = 0; i < Math.min(5, lines.length); i++) {
        const line = lines[i];
        if (/^(?:Item\s+\d+|Origin|Padstack|Net|Circle|Seg|Arc)/i.test(line)) break;
        if (/^(?:[~=-]{2,}|\s*end\s*|[~=-]*\s*(?:end|End|END)\s*[~=-]*)$/i.test(line)) continue;

        const cleanLine = line.replace(/^[#=~*\-—_0-9.、\s]+/, '').replace(/[#=~*\-—_]+$/, '').trim();
        if (cleanLine.length >= 2 && cleanLine.length <= 50 && !/^(?:end|End|END)$/i.test(cleanLine)) {
          schemeName = cleanLine;
          break;
        }
      }

      if (!schemeName) {
        schemeName = `扇出方案_${existingCount + results.length + 1}`;
      }

      // 解析过孔
      const vias = [];
      const itemBlocks = block.split(/(?=Item\s+\d+)/i).filter(s => s.trim());

      if (itemBlocks.length > 0 && /Item\s+\d+/i.test(block)) {
        itemBlocks.forEach((ib, vIdx) => {
          const mOrigin = ib.match(/(?:Origin-xy|Location|xy):\s*\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]/i);
          const mPad = ib.match(/Padstack\s+Name:\s*([^\r\n]+)/i);
          const mNet = ib.match(/Net:\s*([^\r\n]+)/i);
          const mDrill = ib.match(/Circle\s+Drill:\s*([\d\.\-]+)/i);

          if (mOrigin) {
            const rawX = parseFloat(mOrigin[1]) || 0;
            const rawY = parseFloat(mOrigin[2]) || 0;
            const padstack = mPad ? mPad[1].trim() : 'UNKNOWN_PADSTACK';
            const net = mNet ? mNet[1].trim() : '';
            const drill = mDrill ? parseFloat(mDrill[1]) : 0;

            const isGnd = net.toUpperCase().includes('GND') || padstack.toUpperCase().includes('GND');
            const role = isGnd ? '伴随地孔' : '信号孔';
            const type = isGnd ? 'gnd' : 'signal';

            vias.push({
              id: vIdx + 1,
              rawX,
              rawY,
              x: rawX,
              y: rawY,
              padstack,
              net: net || (isGnd ? 'GND' : 'SIGNAL'),
              role,
              type,
              drill
            });
          }
        });
      } else {
        // 兼容坐标表格行：X, Y, Padstack, Net
        lines.forEach((line, vIdx) => {
          if (/^(?:[~=-]{2,}|\s*end\s*|[~=-]*\s*(?:end|End|END)\s*[~=-]*)$/i.test(line)) return;
          const parts = line.split(/[,\t;\s]+/).map(s => s.trim()).filter(Boolean);
          if (parts.length >= 2) {
            const x = parseFloat(parts[0]);
            const y = parseFloat(parts[1]);
            if (!isNaN(x) && !isNaN(y)) {
              const padstack = parts[2] || 'VIA_PADSTACK';
              const net = parts[3] || 'GND';
              const isGnd = net.toUpperCase().includes('GND') || padstack.toUpperCase().includes('GND');
              vias.push({
                id: vIdx + 1,
                rawX: x,
                rawY: y,
                x,
                y,
                padstack,
                net,
                role: isGnd ? '伴随地孔' : '信号孔',
                type: isGnd ? 'gnd' : 'signal',
                drill: 0
              });
            }
          }
        });
      }

      if (vias.length >= 1) {
        // 归一化相对坐标（以第一个信号孔或基准孔为原点 [0, 0]）
        const maxCoord = Math.max(...vias.map(v => Math.max(Math.abs(v.rawX), Math.abs(v.rawY))));
        if (maxCoord > 200) {
          const base = vias.find(v => v.type === 'signal') || vias[0];
          const bx = base.rawX;
          const by = base.rawY;
          vias.forEach(v => {
            v.x = Math.round((v.rawX - bx) * 1000) / 1000;
            v.y = Math.round((v.rawY - by) * 1000) / 1000;
          });
        }

        results.push({
          id: `scheme_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${results.length + 1}`,
          name: schemeName,
          category: category,
          tag: category,
          description: `从批量文本导入，包含 ${vias.length} 个过孔`,
          unit: 'mil',
          vias: vias
        });
      }
    });

    return results;
  }

  /**
   * 判定过孔是否为信号孔 (兼容 FanoutScheme 与 unified 工作台数据结构)
   */
  function isSignalVia(v) {
    if (!v) return false;
    const type = String(v.type || '').toLowerCase();
    if (type === 'gnd') return false;
    if (type === 'signal' || type === 'sig') return true;

    const net = String(v.net || '').toUpperCase();
    const pad = String(v.padstack || '').toUpperCase();
    const role = String(v.role || '');
    const roleUp = role.toUpperCase();

    if (net.includes('GND') || pad.includes('GND') || roleUp.includes('GND') || role.includes('地孔')) {
      return false;
    }
    if (
      (net && net !== 'GND') ||
      roleUp.includes('SIG') ||
      role.includes('信号') ||
      role.includes('差分') ||
      pad.includes('SMA') ||
      pad.includes('SIG') ||
      pad.includes('DIFF') ||
      pad.includes('3510')
    ) {
      return true;
    }
    return false;
  }

  function estimateTextPx(str, fontPx, isMono) {
    const s = String(str || '');
    let w = 0;
    const asciiFactor = isMono ? 0.61 : 0.56;
    for (let i = 0; i < s.length; i++) {
      w += s.charCodeAt(i) > 127 ? fontPx * 1.02 : fontPx * asciiFactor;
    }
    return w;
  }

  /**
   * 扇出方案快捷命名默认关键词列表
   */
  const DEFAULT_SCHEME_NAME_KEYWORDS = [
    'BGA', 'SMA', 'TZ',
    'top', 'bottom',
    'L2', 'L3', 'L4', 'L11', 'L12', 'L13',
    'diff', 'single',
    '05pitch', '06pitch', '07pitch', '08pitch'
  ];

  function buildSchemeNameFromKeywords(tokens) {
    if (!Array.isArray(tokens)) return '';
    return tokens.map(t => String(t == null ? '' : t).trim()).filter(Boolean).join('_');
  }

  /**
   * 整个扇出方案库全局统一的 Padstack 专属色板与注册表：
   * 保证整个方案库内，只要是同一种 Padstack，在所有方案的缩略图、放大效果图、图例与明细表中均使用完全相同的颜色；
   * 不同 Padstack 严格分配互不冲突的颜色。
   */
  const PADSTACK_PALETTE = [
    { fill: '#38bdf8', light: '#7dd3fc', border: 'rgba(56, 189, 248, 0.88)', badgeBg: '#e0f2fe', badgeText: '#0369a1' }, // 0 天蓝
    { fill: '#10b981', light: '#6ee7b7', border: 'rgba(16, 185, 129, 0.88)', badgeBg: '#dcfce7', badgeText: '#15803d' }, // 1 翠绿
    { fill: '#f97316', light: '#fdba74', border: 'rgba(249, 115, 22, 0.88)', badgeBg: '#ffedd5', badgeText: '#c2410c' }, // 2 活力橙
    { fill: '#a855f7', light: '#d8b4fe', border: 'rgba(168, 85, 247, 0.88)', badgeBg: '#f3e8ff', badgeText: '#7e22ce' }, // 3 亮紫
    { fill: '#f43f5e', light: '#fda4af', border: 'rgba(244, 63, 94, 0.88)',  badgeBg: '#ffe4e6', badgeText: '#be123c' }, // 4 珊瑚红
    { fill: '#eab308', light: '#fde047', border: 'rgba(234, 179, 8, 0.88)',  badgeBg: '#fef9c3', badgeText: '#a16207' }, // 5 琥珀金
    { fill: '#14b8a6', light: '#5eead4', border: 'rgba(20, 184, 166, 0.88)', badgeBg: '#ccfbf1', badgeText: '#0f766e' }, // 6 青碧
    { fill: '#ec4899', light: '#f9a8d4', border: 'rgba(236, 72, 153, 0.88)', badgeBg: '#fce7f3', badgeText: '#be185d' }, // 7 品红
    { fill: '#84cc16', light: '#bef264', border: 'rgba(132, 204, 22, 0.88)', badgeBg: '#ecfccb', badgeText: '#4d7c0f' }, // 8 青柠绿
    { fill: '#6366f1', light: '#a5b4fc', border: 'rgba(99, 102, 241, 0.88)', badgeBg: '#e0e7ff', badgeText: '#4338ca' }, // 9 靛蓝
    { fill: '#06b6d4', light: '#67e8f9', border: 'rgba(6, 182, 212, 0.88)',  badgeBg: '#cffafe', badgeText: '#0e7490' }, // 10 冰青
    { fill: '#f59e0b', light: '#fcd34d', border: 'rgba(245, 158, 11, 0.88)', badgeBg: '#fef3c7', badgeText: '#b45309' }, // 11 暖金
    { fill: '#22c55e', light: '#86efac', border: 'rgba(34, 197, 94, 0.88)',  badgeBg: '#dcfce7', badgeText: '#166534' }, // 12 鲜绿
    { fill: '#e879f9', light: '#f5d0fe', border: 'rgba(232, 121, 249, 0.88)',badgeBg: '#fae8ff', badgeText: '#86198f' }, // 13 兰紫
    { fill: '#fb7185', light: '#fecdd3', border: 'rgba(251, 113, 133, 0.88)',badgeBg: '#ffe4e6', badgeText: '#9f1239' }, // 14 玫粉
    { fill: '#2dd4bf', light: '#99f6e4', border: 'rgba(45, 212, 191, 0.88)', badgeBg: '#ccfbf1', badgeText: '#115e59' }  // 15 薄荷青
  ];

  const globalPadstackColorRegistry = new Map();

  function normalizePadstackKey(padstack) {
    const clean = String(padstack == null ? '' : padstack).trim();
    return (clean || 'VIA_PAD').toLowerCase();
  }

  function hslToHex(h, s, l) {
    const sNorm = s / 100;
    const lNorm = l / 100;
    const k = n => (n + h / 30) % 12;
    const a = sNorm * Math.min(lNorm, 1 - lNorm);
    const f = n => lNorm - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
  }

  function getPaletteSlot(idx) {
    if (idx < PADSTACK_PALETTE.length) return PADSTACK_PALETTE[idx];
    // 超出16种 Padstack 时按黄金角自动生成互不重复的高辨识度色彩
    const hue = Math.round((idx * 137.508 + 19) % 360);
    return {
      fill: hslToHex(hue, 82, 58),
      light: hslToHex(hue, 88, 76),
      border: `hsla(${hue}, 82%, 58%, 0.88)`,
      badgeBg: hslToHex(hue, 85, 93),
      badgeText: hslToHex(hue, 78, 28)
    };
  }

  function resetPadstackColorRegistry() {
    globalPadstackColorRegistry.clear();
  }

  function getPadstackColorEntry(padstack) {
    const rawName = String(padstack == null ? '' : padstack).trim() || 'VIA_PAD';
    const normKey = normalizePadstackKey(rawName);
    if (globalPadstackColorRegistry.has(normKey)) {
      return globalPadstackColorRegistry.get(normKey);
    }
    const colorIndex = globalPadstackColorRegistry.size;
    const pal = getPaletteSlot(colorIndex);
    const entry = {
      padstack: rawName,
      normKey,
      colorIndex,
      fill: pal.fill,
      light: pal.light,
      border: pal.border,
      badgeBg: pal.badgeBg,
      badgeText: pal.badgeText
    };
    globalPadstackColorRegistry.set(normKey, entry);
    return entry;
  }

  /**
   * 扫描整个扇出方案库，将所有方案的 Padstack 注册到全局统一颜色表中：
   * 同一种 Padstack 在库内任意方案中永远获得同一种颜色。
   */
  function syncLibraryPadstackColors(schemesInput, options = {}) {
    if (options && options.reset) {
      resetPadstackColorRegistry();
    }
    const schemes = Array.isArray(schemesInput)
      ? schemesInput
      : (schemesInput && Array.isArray(schemesInput.schemes) ? schemesInput.schemes : []);

    schemes.forEach(sc => {
      const vias = (sc && Array.isArray(sc.vias)) ? sc.vias : [];
      // 方案内先注册信号孔 Padstack，再注册地孔 Padstack，使主信号孔优先获得前序醒目色
      vias.forEach(v => {
        if (isSignalVia(v)) getPadstackColorEntry(v.padstack);
      });
      vias.forEach(v => {
        getPadstackColorEntry(v.padstack);
      });
    });
    return globalPadstackColorRegistry;
  }

  /**
   * 汇总整个扇出方案库的全局 Padstack 色卡与统计信息
   */
  function getLibraryPadstackColorLegend(schemesInput) {
    const schemes = Array.isArray(schemesInput)
      ? schemesInput
      : (schemesInput && Array.isArray(schemesInput.schemes) ? schemesInput.schemes : []);
    syncLibraryPadstackColors(schemes);

    const statsMap = new Map();
    schemes.forEach(sc => {
      const vias = (sc && Array.isArray(sc.vias)) ? sc.vias : [];
      const seenInScheme = new Set();
      vias.forEach(v => {
        const entry = getPadstackColorEntry(v.padstack);
        if (!statsMap.has(entry.normKey)) {
          statsMap.set(entry.normKey, {
            padstack: String(v.padstack || 'VIA_PAD').trim() || 'VIA_PAD',
            normKey: entry.normKey,
            colorIndex: entry.colorIndex,
            fill: entry.fill,
            light: entry.light,
            border: entry.border,
            badgeBg: entry.badgeBg,
            badgeText: entry.badgeText,
            totalVias: 0,
            schemeCount: 0
          });
        }
        const st = statsMap.get(entry.normKey);
        st.totalVias++;
        if (!seenInScheme.has(entry.normKey)) {
          seenInScheme.add(entry.normKey);
          st.schemeCount++;
        }
      });
    });

    return Array.from(statsMap.values()).sort((a, b) => a.colorIndex - b.colorIndex);
  }

  function buildPadstackColorMap(rawVias, librarySchemes) {
    if (librarySchemes) {
      syncLibraryPadstackColors(librarySchemes);
    }
    const map = {};
    const list = [];
    if (!Array.isArray(rawVias) || rawVias.length === 0) return { map, list };

    // 确保当前方案自身的信号孔与其余孔也已纳入全局颜色注册表
    const orderedUnique = [];
    const seenNorm = new Set();
    rawVias.forEach(v => {
      if (isSignalVia(v)) {
        const p = String(v.padstack || 'VIA_PAD').trim() || 'VIA_PAD';
        const nk = normalizePadstackKey(p);
        getPadstackColorEntry(p);
        if (!seenNorm.has(nk)) { seenNorm.add(nk); orderedUnique.push(p); }
      }
    });
    rawVias.forEach(v => {
      const p = String(v.padstack || 'VIA_PAD').trim() || 'VIA_PAD';
      const nk = normalizePadstackKey(p);
      getPadstackColorEntry(p);
      if (!seenNorm.has(nk)) { seenNorm.add(nk); orderedUnique.push(p); }
    });

    const countsByNorm = {};
    rawVias.forEach(v => {
      const p = String(v.padstack || 'VIA_PAD').trim() || 'VIA_PAD';
      const nk = normalizePadstackKey(p);
      countsByNorm[nk] = (countsByNorm[nk] || 0) + 1;
    });

    orderedUnique.forEach(p => {
      const base = getPadstackColorEntry(p);
      const entry = {
        padstack: p,
        normKey: base.normKey,
        count: countsByNorm[base.normKey] || 0,
        colorIndex: base.colorIndex,
        fill: base.fill,
        light: base.light,
        border: base.border,
        badgeBg: base.badgeBg,
        badgeText: base.badgeText
      };
      map[p] = entry;
      map[base.normKey] = entry;
      list.push(entry);
    });

    // 同时兼容原始未 trim 的键名查找
    rawVias.forEach(v => {
      const rawKey = String(v.padstack || 'VIA_PAD');
      const nk = normalizePadstackKey(rawKey);
      if (!map[rawKey] && map[nk]) {
        map[rawKey] = map[nk];
      }
    });

    return { map, list };
  }

  /**
   * 计算方案中任意两个孔的中心距指标 (mil / mm / ΔX / ΔY / 角度)
   */
  function calcSchemeViaPairDistance(v1, v2) {
    if (!v1 || !v2) return null;
    const x1 = parseFloat(v1.x) || 0;
    const y1 = parseFloat(v1.y) || 0;
    const x2 = parseFloat(v2.x) || 0;
    const y2 = parseFloat(v2.y) || 0;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distMil = Math.hypot(dx, dy);
    const distMm = distMil * MM_PER_MIL;
    const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
    return {
      v1Index: v1.index != null ? v1.index : 0,
      v2Index: v2.index != null ? v2.index : 0,
      v1Label: v1.labelNum != null ? v1.labelNum : (v1.id != null ? v1.id : 1),
      v2Label: v2.labelNum != null ? v2.labelNum : (v2.id != null ? v2.id : 2),
      v1Padstack: String(v1.padstack || 'VIA_PAD'),
      v2Padstack: String(v2.padstack || 'VIA_PAD'),
      x1, y1, x2, y2,
      dx, dy,
      absDx: Math.abs(dx),
      absDy: Math.abs(dy),
      distMil,
      distMm,
      absDxMm: Math.abs(dx) * MM_PER_MIL,
      absDyMm: Math.abs(dy) * MM_PER_MIL,
      angleDeg
    };
  }

  /**
   * 计算扇出方案放大效果图与 Padstack 标注几何布局 (无重叠自动避让)
   */
  function computeSchemeViewLayout(scheme, width, height, options = {}) {
    const W = Math.max(320, Number(width) || 760);
    const H = Math.max(260, Number(height) || 520);
    const zoom = Math.max(0.35, Math.min(6.0, Number(options.zoom) || 1.0));
    const panX = Number(options.panX) || 0;
    const panY = Number(options.panY) || 0;
    const showPadstack = options.showPadstack !== false;
    const showCoords = !!options.showCoords;
    const showDistances = !!options.showDistances;
    const hoveredIndex = options.hoveredIndex != null ? Number(options.hoveredIndex) : -1;
    const measureText = typeof options.measureText === 'function' ? options.measureText : null;

    const rawVias = (scheme && Array.isArray(scheme.vias)) ? scheme.vias : [];
    const N = rawVias.length;

    if (N === 0) {
      return {
        width: W,
        height: H,
        cx: W / 2,
        cy: H / 2,
        scale: 1,
        padR: 14,
        drillR: 5.5,
        vias: [],
        connectors: [],
        callouts: [],
        padstackColors: [],
        padstackColorMap: {},
        summary: { viaCount: 0, sigCount: 0, gndCount: 0, minDist: 0, maxDist: 0, padstackCounts: {}, padstackColors: [] }
      };
    }

    const padColorInfo = buildPadstackColorMap(rawVias, options.librarySchemes);

    const xs = rawVias.map(v => parseFloat(v.x) || 0);
    const ys = rawVias.map(v => parseFloat(v.y) || 0);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const halfSpanX = Math.max((maxX - minX) / 2, 10);
    const halfSpanY = Math.max((maxY - minY) / 2, 10);

    const compactMode = N > 10;
    const padFontPx = compactMode ? 11 : 12;
    const metaFontPx = compactMode ? 10 : 10.5;

    let maxBoxW = 170;
    rawVias.forEach((v, i) => {
      const padStr = String(v.padstack || 'VIA_PAD');
      const roleTxt = (v.role && v.role !== 'Signal' && v.role !== 'GND') ? v.role : (isSignalVia(v) ? '信号孔' : 'GND地孔');
      const coordTxt = showCoords ? ` [${(parseFloat(v.x) || 0).toFixed(1)}, ${(parseFloat(v.y) || 0).toFixed(1)}]` : '';
      if (compactMode) {
        const line = `#${i + 1} ${padStr}${coordTxt}`;
        const tw = measureText ? measureText(line, padFontPx, true) : estimateTextPx(line, padFontPx, true);
        maxBoxW = Math.max(maxBoxW, tw + 24);
      } else {
        const l1 = `#${i + 1} · ${roleTxt}${coordTxt}`;
        const l2 = padStr;
        const w1 = measureText ? measureText(l1, metaFontPx, false) : estimateTextPx(l1, metaFontPx, false);
        const w2 = measureText ? measureText(l2, padFontPx, true) : estimateTextPx(l2, padFontPx, true);
        maxBoxW = Math.max(maxBoxW, Math.max(w1, w2) + 26);
      }
    });
    maxBoxW = Math.min(maxBoxW, Math.floor(W * 0.42));

    const sideReserve = showPadstack ? Math.min(Math.floor(W * 0.37), maxBoxW + 34) : 64;
    const topBotReserve = showPadstack ? (compactMode ? 58 : 118) : 56;
    const availHalfW = Math.max(62, (W / 2) - sideReserve);
    const availHalfH = Math.max(58, (H / 2) - topBotReserve);

    const baseScale = N === 1 ? 4.5 : Math.min(availHalfW / halfSpanX, availHalfH / halfSpanY);
    const scale = baseScale * zoom;
    const cx = W / 2 + panX;
    const cy = H / 2 + panY;

    const basePadR = N <= 6 ? 15 : (N <= 12 ? 12 : (N <= 22 ? 9.5 : 8));
    const padR = Math.max(6.5, Math.min(22, basePadR * Math.pow(zoom, 0.32)));
    const drillR = Math.max(2.6, padR * 0.39);

    const padstackCounts = {};
    let sigCount = 0, gndCount = 0;

    const vias = rawVias.map((v, idx) => {
      const x = parseFloat(v.x) || 0;
      const y = parseFloat(v.y) || 0;
      const isSig = isSignalVia(v);
      if (isSig) sigCount++; else gndCount++;
      const padstack = String(v.padstack || 'VIA_PAD');
      padstackCounts[padstack] = (padstackCounts[padstack] || 0) + 1;
      const roleText = (v.role && v.role !== 'Signal' && v.role !== 'GND')
        ? String(v.role)
        : (isSig ? '信号孔' : '伴随地孔');
      const pCol = padColorInfo.map[padstack] || PADSTACK_PALETTE[0];

      return {
        index: idx,
        labelNum: idx + 1,
        id: v.id != null ? v.id : idx + 1,
        x,
        y,
        nx: x - midX,
        ny: y - midY,
        sx: cx + (x - midX) * scale,
        sy: cy - (y - midY) * scale,
        padstack,
        net: v.net || (isSig ? 'SIG' : 'GND'),
        role: roleText,
        isSig,
        padColor: pCol.fill,
        padLightColor: pCol.light,
        padBorderColor: pCol.border,
        padBadgeBg: pCol.badgeBg,
        padBadgeText: pCol.badgeText,
        padColorIndex: pCol.colorIndex,
        isHovered: idx === hoveredIndex
      };
    });

    // 计算两两距离与拓扑连线
    const allPairs = [];
    const minDistPerVia = new Array(N).fill(Infinity);
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const d = dist2D(vias[i].x, vias[i].y, vias[j].x, vias[j].y);
        if (d > 1e-6) {
          allPairs.push({ i, j, dist: d });
          if (d < minDistPerVia[i]) minDistPerVia[i] = d;
          if (d < minDistPerVia[j]) minDistPerVia[j] = d;
        }
      }
    }
    allPairs.sort((a, b) => a.dist - b.dist);
    const minDist = allPairs.length > 0 ? allPairs[0].dist : 0;
    const maxDist = allPairs.length > 0 ? allPairs[allPairs.length - 1].dist : 0;

    let connectors = [];
    if (N <= 10) {
      connectors = allPairs.map(p => ({
        ...p,
        x1: vias[p.i].sx,
        y1: vias[p.i].sy,
        x2: vias[p.j].sx,
        y2: vias[p.j].sy,
        isPrimaryPitch: p.dist <= Math.max(minDist * 1.48, Math.min(minDistPerVia[p.i], minDistPerVia[p.j]) * 1.15)
      }));
    } else {
      const picked = new Set();
      for (let i = 0; i < N; i++) {
        const neighbors = [];
        for (let j = 0; j < N; j++) {
          if (i === j) continue;
          const d = dist2D(vias[i].x, vias[i].y, vias[j].x, vias[j].y);
          neighbors.push({ j, dist: d });
        }
        neighbors.sort((a, b) => a.dist - b.dist);
        const cutoff = neighbors.length > 0 ? neighbors[0].dist * 2.15 : Infinity;
        neighbors.slice(0, 4).forEach(nb => {
          if (nb.dist <= cutoff) {
            const a = Math.min(i, nb.j), b = Math.max(i, nb.j);
            const key = `${a}_${b}`;
            if (!picked.has(key)) {
              picked.add(key);
              connectors.push({
                i: a,
                j: b,
                dist: nb.dist,
                x1: vias[a].sx,
                y1: vias[a].sy,
                x2: vias[b].sx,
                y2: vias[b].sy,
                isPrimaryPitch: nb.dist <= minDist * 1.25
              });
            }
          }
        });
      }
    }

    // 计算每个孔的 Padstack 标注框位置
    const callouts = [];
    if (showPadstack) {
      const scx = vias.reduce((s, v) => s + v.sx, 0) / N;
      const scy = vias.reduce((s, v) => s + v.sy, 0) / N;
      const minSx = Math.min(...vias.map(v => v.sx));
      const maxSx = Math.max(...vias.map(v => v.sx));
      const maxScreenR = Math.max(20, ...vias.map(v => Math.hypot(v.sx - scx, v.sy - scy)));

      // 先构建每个孔的标注文本与宽高
      const specs = vias.map(v => {
        const coordPart = showCoords ? ` (${v.x.toFixed(1)}, ${v.y.toFixed(1)})` : '';
        if (compactMode) {
          const line1 = `#${v.labelNum} ${v.padstack}${coordPart}`;
          const tw = measureText ? measureText(line1, padFontPx, true) : estimateTextPx(line1, padFontPx, true);
          return {
            via: v,
            compact: true,
            headerText: `#${v.labelNum}`,
            padstackText: v.padstack,
            coordText: coordPart.trim(),
            fullLine: line1,
            w: Math.ceil(tw + 22),
            h: 22
          };
        } else {
          const headerText = `#${v.labelNum} · ${v.role}${coordPart}`;
          const padstackText = v.padstack;
          const w1 = measureText ? measureText(headerText, metaFontPx, false) : estimateTextPx(headerText, metaFontPx, false);
          const w2 = measureText ? measureText(padstackText, padFontPx, true) : estimateTextPx(padstackText, padFontPx, true);
          return {
            via: v,
            compact: false,
            headerText,
            padstackText,
            coordText: coordPart.trim(),
            w: Math.ceil(Math.max(w1, w2) + 24),
            h: 40
          };
        }
      });

      const margin = 10;

      if (!compactMode) {
        // 标准/中小型方案 (<=10孔): 径向扇出引线 + 空隙角度寻优 + 碰撞松弛避让
        specs.forEach((sp, i) => {
          const v = sp.via;
          let dx = v.sx - scx;
          let dy = v.sy - scy;
          const r = Math.hypot(dx, dy);

          // 检查外向射线是否被更外围的孔阻挡，或该孔位于中心
          let blocked = false;
          if (r > 8) {
            const ux0 = dx / r, uy0 = dy / r;
            for (let j = 0; j < N; j++) {
              if (i === j) continue;
              const vxj = vias[j].sx - scx, vyj = vias[j].sy - scy;
              const rj = Math.hypot(vxj, vyj);
              if (rj > r + padR * 1.4) {
                const cosA = (ux0 * vxj + uy0 * vyj) / (rj || 1);
                if (cosA > 0.94) {
                  blocked = true;
                  break;
                }
              }
            }
          }

          let angle = 0;
          let isInterior = false;
          if (N === 1) {
            angle = -Math.PI / 4;
          } else if (r <= 8 || blocked) {
            isInterior = true;
            // 在周围所有孔相对当前孔的方位角中寻找最大空隙扇区
            const neighborAngles = [];
            for (let j = 0; j < N; j++) {
              if (i === j) continue;
              neighborAngles.push(Math.atan2(vias[j].sy - v.sy, vias[j].sx - v.sx));
            }
            neighborAngles.sort((a, b) => a - b);
            let bestGap = -1;
            const candidates = [];
            for (let k = 0; k < neighborAngles.length; k++) {
              const a1 = neighborAngles[k];
              const a2 = k + 1 < neighborAngles.length ? neighborAngles[k + 1] : neighborAngles[0] + Math.PI * 2;
              const gap = a2 - a1;
              let mid = a1 + gap / 2;
              while (mid > Math.PI) mid -= Math.PI * 2;
              while (mid <= -Math.PI) mid += Math.PI * 2;
              candidates.push({ gap, mid });
              if (gap > bestGap) bestGap = gap;
            }
            // 在接近最大空隙的候选中优先选择右上方 (-45°) 方向，符合工程制图习惯
            const pref = -Math.PI / 4;
            let chosen = candidates[0] ? candidates[0].mid : pref;
            let bestPrefDist = Infinity;
            candidates.forEach(c => {
              if (c.gap >= bestGap * 0.92) {
                let dAng = Math.abs(c.mid - pref);
                if (dAng > Math.PI) dAng = Math.PI * 2 - dAng;
                if (dAng < bestPrefDist) {
                  bestPrefDist = dAng;
                  chosen = c.mid;
                }
              }
            });
            angle = chosen;
          } else {
            angle = Math.atan2(dy, dx);
          }

          const ux = Math.cos(angle);
          const uy = Math.sin(angle);

          // 计算引线终点锚点 (确保越过孔群外包络)
          let leadLen = padR + 28;
          if (isInterior) {
            leadLen = Math.max(leadLen, maxScreenR * 0.92 + 30);
          } else if (Math.abs(uy) < 0.35 && Math.abs(ux) > 0.85) {
            // 左右水平引出时越过最外侧孔列，保持整齐对齐
            const targetEdgeX = ux < 0 ? (minSx - 32) : (maxSx + 32);
            leadLen = Math.max(leadLen, Math.abs(targetEdgeX - v.sx));
          }

          const ax = v.sx + ux * leadLen;
          const ay = v.sy + uy * leadLen;

          let bx, by, alignSide;
          if (Math.abs(uy) > 0.82 && Math.abs(ux) < 0.38) {
            // 正上 / 正下居中放置
            bx = ax - sp.w / 2;
            by = uy < 0 ? (ay - sp.h - 4) : (ay + 4);
            alignSide = uy < 0 ? 'top' : 'bottom';
          } else if (ux < 0) {
            bx = ax - sp.w - 8;
            by = ay - sp.h / 2;
            alignSide = 'left';
          } else {
            bx = ax + 8;
            by = ay - sp.h / 2;
            alignSide = 'right';
          }

          bx = Math.max(margin, Math.min(W - margin - sp.w, bx));
          by = Math.max(margin, Math.min(H - margin - sp.h, by));

          callouts.push({
            ...sp,
            index: i,
            x: bx,
            y: by,
            targetX: bx,
            targetY: by,
            alignSide,
            ux,
            uy
          });
        });

        // 迭代式碰撞松弛求解：消除标注框之间重叠 + 消除标注框遮挡任何过孔圆盘
        const viaKeepoutPad = padR + 8;
        for (let iter = 0; iter < 120; iter++) {
          let moved = false;

          // 1) 避让所有过孔圆盘
          for (let i = 0; i < callouts.length; i++) {
            const b = callouts[i];
            const bcx = b.x + b.w / 2;
            const bcy = b.y + b.h / 2;
            for (let j = 0; j < vias.length; j++) {
              const v = vias[j];
              const nearX = Math.max(b.x, Math.min(v.sx, b.x + b.w));
              const nearY = Math.max(b.y, Math.min(v.sy, b.y + b.h));
              const dx = nearX - v.sx;
              const dy = nearY - v.sy;
              const dist = Math.hypot(dx, dy);
              if (dist < viaKeepoutPad) {
                let px = bcx - v.sx;
                let py = bcy - v.sy;
                const plen = Math.hypot(px, py) || 1;
                px /= plen;
                py /= plen;
                const push = (viaKeepoutPad - dist) + 2;
                b.x += px * push;
                b.y += py * push;
                moved = true;
              }
            }
          }

          // 2) 消除任意两个标注框之间的矩形重叠
          const gap = 6;
          for (let i = 0; i < callouts.length; i++) {
            for (let j = i + 1; j < callouts.length; j++) {
              const a = callouts[i];
              const b = callouts[j];
              const overlapX = Math.min(a.x + a.w + gap, b.x + b.w + gap) - Math.max(a.x, b.x);
              const overlapY = Math.min(a.y + a.h + gap, b.y + b.h + gap) - Math.max(a.y, b.y);
              if (overlapX > 0 && overlapY > 0) {
                if (overlapY <= overlapX * 1.35) {
                  const dir = (a.y + a.h / 2) <= (b.y + b.h / 2) ? -1 : 1;
                  const shift = overlapY / 2 + 0.5;
                  a.y += dir * shift;
                  b.y -= dir * shift;
                } else {
                  const dir = (a.x + a.w / 2) <= (b.x + b.w / 2) ? -1 : 1;
                  const shift = overlapX / 2 + 0.5;
                  a.x += dir * shift;
                  b.x -= dir * shift;
                }
                moved = true;
              }
            }
          }

          // 3) 边界约束
          for (let i = 0; i < callouts.length; i++) {
            const b = callouts[i];
            b.x = Math.max(margin, Math.min(W - margin - b.w, b.x));
            b.y = Math.max(margin, Math.min(H - margin - b.h, b.y));
          }

          if (!moved) break;
        }
      } else {
        // 多孔阵列方案 (>10孔): 左右双栏纵向等距排布 + 折线引线，确保高密孔群也清晰无重叠
        const sortedByX = specs.slice().sort((a, b) => (a.via.sx - b.via.sx) || (a.via.sy - b.via.sy));
        const halfIdx = Math.ceil(sortedByX.length / 2);
        const leftGroup = sortedByX.slice(0, halfIdx).sort((a, b) => (a.via.sy - b.via.sy) || (a.via.sx - b.via.sx));
        const rightGroup = sortedByX.slice(halfIdx).sort((a, b) => (a.via.sy - b.via.sy) || (b.via.sx - a.via.sx));

        function layoutColumn(group, side) {
          const count = group.length;
          if (!count) return;
          const availH = H - margin * 2;
          const step = Math.max(16, Math.min(28, availH / count));
          const boxH = Math.max(15, Math.min(22, Math.floor(step - 3)));
          const totalH = step * (count - 1) + boxH;
          const startY = Math.max(margin, (H - totalH) / 2);

          group.forEach((sp, k) => {
            const w = Math.min(sp.w, Math.floor(W * 0.34));
            const bx = side === 'left'
              ? Math.max(margin, Math.min(minSx - padR - 26 - w, margin + 4))
              : Math.min(W - margin - w, Math.max(maxSx + padR + 26, W - margin - w - 4));
            const by = startY + k * step;
            callouts.push({
              ...sp,
              w,
              h: boxH,
              index: sp.via.index,
              x: bx,
              y: by,
              alignSide: side
            });
          });
        }

        layoutColumn(leftGroup, 'left');
        layoutColumn(rightGroup, 'right');
        callouts.sort((a, b) => a.index - b.index);
      }

      // 计算每条标注的引线几何折点 (孔外缘起点 -> 折点 -> 标注框连接点)
      callouts.forEach(c => {
        const v = c.via;
        const bcx = c.x + c.w / 2;
        const bcy = c.y + c.h / 2;
        let attachX, attachY, elbowX, elbowY;

        if (bcy + c.h / 2 < v.sy - padR - 8 && Math.abs(bcx - v.sx) < c.w * 0.65) {
          attachX = Math.max(c.x + 12, Math.min(c.x + c.w - 12, v.sx));
          attachY = c.y + c.h;
          elbowX = attachX;
          elbowY = attachY + 6;
        } else if (bcy - c.h / 2 > v.sy + padR + 8 && Math.abs(bcx - v.sx) < c.w * 0.65) {
          attachX = Math.max(c.x + 12, Math.min(c.x + c.w - 12, v.sx));
          attachY = c.y;
          elbowX = attachX;
          elbowY = attachY - 6;
        } else if (bcx < v.sx) {
          attachX = c.x + c.w;
          attachY = bcy;
          elbowX = attachX + 10;
          elbowY = attachY;
        } else {
          attachX = c.x;
          attachY = bcy;
          elbowX = attachX - 10;
          elbowY = attachY;
        }

        const dirX = elbowX - v.sx;
        const dirY = elbowY - v.sy;
        const dLen = Math.hypot(dirX, dirY) || 1;
        c.startX = v.sx + (dirX / dLen) * (padR + 2);
        c.startY = v.sy + (dirY / dLen) * (padR + 2);
        c.elbowX = elbowX;
        c.elbowY = elbowY;
        c.attachX = attachX;
        c.attachY = attachY;
      });
    }

    return {
      width: W,
      height: H,
      cx,
      cy,
      scale,
      padR,
      drillR,
      vias,
      connectors,
      callouts,
      padstackColors: padColorInfo.list,
      padstackColorMap: padColorInfo.map,
      summary: {
        viaCount: N,
        sigCount,
        gndCount,
        minDist,
        maxDist,
        padstackCounts,
        padstackColors: padColorInfo.list
      }
    };
  }

  function drawRoundedRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /**
   * 在高清 Canvas 上渲染放大版扇出方案效果图与逐孔 Padstack 标注 (风格对齐缩略星座图)
   */
  function renderSchemeEnlargedCanvas(canvas, scheme, options = {}) {
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const cssW = Math.max(320, Number(options.width) || canvas.clientWidth || Number(canvas.getAttribute('width')) || 760);
    const cssH = Math.max(260, Number(options.height) || canvas.clientHeight || Number(canvas.getAttribute('height')) || 520);
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? Math.min(3, Math.max(1, window.devicePixelRatio)) : 2;

    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    const monoStack = '"JetBrains Mono", Consolas, Monaco, "Courier New", monospace';
    const sansStack = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

    const layout = computeSchemeViewLayout(scheme, cssW, cssH, {
      ...options,
      measureText: (str, px, isMono) => {
        ctx.font = `600 ${px}px ${isMono ? monoStack : sansStack}`;
        return ctx.measureText(str).width;
      }
    });

    // 1. 深色圆角卡片背景 (#0f172a，复刻并放大附件效果图质感)
    ctx.clearRect(0, 0, cssW, cssH);
    drawRoundedRectPath(ctx, 0, 0, cssW, cssH, 14);
    ctx.fillStyle = '#0f172a';
    ctx.fill();

    // 微弱十字基准中心线
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(layout.cx, 16);
    ctx.lineTo(layout.cx, cssH - 16);
    ctx.moveTo(16, layout.cy);
    ctx.lineTo(cssW - 16, layout.cy);
    ctx.stroke();
    ctx.restore();

    if (layout.vias.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = `600 14px ${sansStack}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('当前扇出方案暂无过孔数据', cssW / 2, cssH / 2);
      ctx.restore();
      return layout;
    }

    // 2. 虚线拓扑连接网格 (精确复刻缩略效果图青蓝色虚线)
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.30)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 4]);
    layout.connectors.forEach(c => {
      ctx.beginPath();
      ctx.moveTo(c.x1, c.y1);
      ctx.lineTo(c.x2, c.y2);
      ctx.stroke();
    });
    ctx.restore();

    // 可选：孔心距标注 (mil)
    if (options.showDistances) {
      ctx.save();
      ctx.font = `600 10.5px ${monoStack}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      layout.connectors.filter(c => c.isPrimaryPitch).forEach(c => {
        const mx = (c.x1 + c.x2) / 2;
        const my = (c.y1 + c.y2) / 2;
        const txt = `${c.dist.toFixed(1)} mil`;
        const tw = ctx.measureText(txt).width + 10;
        drawRoundedRectPath(ctx, mx - tw / 2, my - 9, tw, 18, 4);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(txt, mx, my);
      });
      ctx.restore();
    }

    // 3. Padstack 引出指示线 (置于孔与标注框下层，整洁不遮挡，按不同 Padstack 配色)
    if (options.showPadstack !== false && layout.callouts.length > 0) {
      layout.callouts.forEach(c => {
        const v = c.via;
        const hovered = v.isHovered;
        const baseColor = hovered
          ? '#facc15'
          : (v.padBorderColor || (v.isSig ? 'rgba(56, 189, 248, 0.82)' : 'rgba(16, 185, 129, 0.78)'));

        ctx.save();
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = hovered ? 2.2 : 1.45;
        ctx.beginPath();
        ctx.moveTo(c.startX, c.startY);
        ctx.lineTo(c.elbowX, c.elbowY);
        ctx.lineTo(c.attachX, c.attachY);
        ctx.stroke();

        // 孔外缘引线锚点小圆点
        ctx.beginPath();
        ctx.arc(c.startX, c.startY, hovered ? 3.2 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = hovered ? '#facc15' : (v.padColor || baseColor);
        ctx.fill();
        ctx.restore();
      });
    }

    // 4. 放大版同心焊盘环与钻孔 (不同 Padstack 自动以不同高对比色显示 + 白边 + 深色中心钻孔)
    const { padR, drillR } = layout;
    const measureStartIdx = (options.measureStartIndex != null && options.measureStartIndex >= 0)
      ? Number(options.measureStartIndex)
      : -1;
    const measuredPairs = Array.isArray(options.measuredPairs) ? options.measuredPairs : [];

    layout.vias.forEach(v => {
      ctx.save();
      const isMeasureStart = (v.index === measureStartIdx);
      const isInMeasuredPair = measuredPairs.some(mp => mp.i1 === v.index || mp.i2 === v.index);

      if (v.isHovered || isMeasureStart || isInMeasuredPair) {
        ctx.beginPath();
        ctx.arc(v.sx, v.sy, padR + (isMeasureStart ? 7 : 5.5), 0, Math.PI * 2);
        ctx.fillStyle = isMeasureStart
          ? 'rgba(34, 211, 238, 0.25)'
          : (v.isHovered ? 'rgba(250, 204, 21, 0.25)' : 'rgba(251, 191, 36, 0.16)');
        ctx.fill();
        ctx.strokeStyle = isMeasureStart ? '#22d3ee' : '#facc15';
        ctx.lineWidth = isMeasureStart ? 2.4 : 2;
        if (isMeasureStart) ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 外层焊盘环 (按不同 Padstack 专属颜色着色)
      ctx.beginPath();
      ctx.arc(v.sx, v.sy, padR, 0, Math.PI * 2);
      ctx.fillStyle = v.padColor || (v.isSig ? '#38bdf8' : '#10b981');
      ctx.fill();
      ctx.strokeStyle = v.isHovered ? '#fef08a' : '#ffffff';
      ctx.lineWidth = Math.max(1.8, padR * 0.17);
      ctx.stroke();

      // 中心钻孔
      ctx.beginPath();
      ctx.arc(v.sx, v.sy, drillR, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();

      // 若孔较大，在钻孔旁或圆心显示微缩孔号便于测距识别
      if (options.measureMode) {
        ctx.font = `700 ${Math.max(9, Math.round(padR * 0.62))}px ${monoStack}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(String(v.labelNum), v.sx, v.sy);
      }
      ctx.restore();
    });

    // 5. 逐孔 Padstack 清晰标注卡片 (边框与左侧色条同步对应 Padstack 专属颜色)
    if (options.showPadstack !== false && layout.callouts.length > 0) {
      // 将悬停项放到最后绘制以置顶显示
      const ordered = layout.callouts.slice().sort((a, b) => (a.via.isHovered ? 1 : 0) - (b.via.isHovered ? 1 : 0));
      ordered.forEach(c => {
        const v = c.via;
        const hovered = v.isHovered;
        const accent = hovered ? '#facc15' : (v.padColor || (v.isSig ? '#38bdf8' : '#10b981'));
        const borderCol = hovered ? '#facc15' : (v.padBorderColor || accent);
        const headerCol = hovered ? '#fde047' : (v.padLightColor || accent);

        ctx.save();
        ctx.shadowColor = 'rgba(2, 6, 23, 0.55)';
        ctx.shadowBlur = hovered ? 14 : 8;
        ctx.shadowOffsetY = 2;

        drawRoundedRectPath(ctx, c.x, c.y, c.w, c.h, 6);
        ctx.fillStyle = hovered ? 'rgba(30, 41, 59, 0.98)' : 'rgba(15, 23, 42, 0.93)';
        ctx.fill();

        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = borderCol;
        ctx.lineWidth = hovered ? 2.0 : 1.35;
        ctx.stroke();

        // 左侧 Padstack 专属色条
        drawRoundedRectPath(ctx, c.x + 1, c.y + 3, 4, c.h - 6, 2);
        ctx.fillStyle = accent;
        ctx.fill();

        if (c.compact) {
          ctx.font = `700 11px ${monoStack}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = headerCol;
          const numTxt = `#${v.labelNum} `;
          ctx.fillText(numTxt, c.x + 9, c.y + c.h / 2);
          const numW = ctx.measureText(numTxt).width;
          ctx.fillStyle = '#f8fafc';
          ctx.fillText(c.padstackText + (c.coordText ? ` ${c.coordText}` : ''), c.x + 9 + numW, c.y + c.h / 2);
        } else {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.font = `600 10.5px ${sansStack}`;
          ctx.fillStyle = headerCol;
          ctx.fillText(c.headerText, c.x + 10, c.y + 12.5);

          ctx.font = `700 12px ${monoStack}`;
          ctx.fillStyle = '#ffffff';
          ctx.fillText(c.padstackText, c.x + 10, c.y + 28.5);
        }
        ctx.restore();
      });
    }

    // 6. 孔到孔中心距交互测量图层 (置于最上层确保清晰可读)
    const drawDimensionLine = (v1, v2, isPreview, slotOffsetIdx) => {
      const m = calcSchemeViaPairDistance(v1, v2);
      if (!m) return;
      ctx.save();
      const lineColor = isPreview ? '#22d3ee' : '#facc15';

      // 连接孔心的测量线
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = isPreview ? 2.0 : 2.4;
      ctx.setLineDash(isPreview ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(v1.sx, v1.sy);
      ctx.lineTo(v2.sx, v2.sy);
      ctx.stroke();
      ctx.setLineDash([]);

      // 两端孔心十字靶心点
      [v1, v2].forEach(vp => {
        ctx.beginPath();
        ctx.arc(vp.sx, vp.sy, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = lineColor;
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // 中点距离胶囊标签
      const mx = (v1.sx + v2.sx) / 2;
      const my = (v1.sy + v2.sy) / 2 + (slotOffsetIdx ? slotOffsetIdx * 24 : 0);
      const labelTxt = `${isPreview ? '预览 ' : ''}#${m.v1Label} - #${m.v2Label}: ${m.distMil.toFixed(2)} mil (${m.distMm.toFixed(3)} mm)`;
      ctx.font = `700 11.5px ${monoStack}`;
      const tw = ctx.measureText(labelTxt).width + 16;
      const th = 22;
      const bx = Math.max(8, Math.min(cssW - tw - 8, mx - tw / 2));
      const by = Math.max(8, Math.min(cssH - th - 8, my - th / 2));

      ctx.shadowColor = 'rgba(2, 6, 23, 0.75)';
      ctx.shadowBlur = 10;
      drawRoundedRectPath(ctx, bx, by, tw, th, 6);
      ctx.fillStyle = isPreview ? 'rgba(8, 51, 68, 0.95)' : 'rgba(30, 27, 75, 0.96)';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.fillStyle = isPreview ? '#67e8f9' : '#fef08a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelTxt, bx + tw / 2, by + th / 2);
      ctx.restore();
    };

    // 绘制已锁定的孔心距测量对
    measuredPairs.forEach((mp, idx) => {
      const v1 = layout.vias[mp.i1];
      const v2 = layout.vias[mp.i2];
      if (v1 && v2 && mp.i1 !== mp.i2) {
        drawDimensionLine(v1, v2, false, 0);
      }
    });

    // 绘制正在选择第二个孔时的实时橡皮筋预览
    if (measureStartIdx >= 0 && layout.vias[measureStartIdx]) {
      const vStart = layout.vias[measureStartIdx];
      const hovIdx = options.hoveredIndex != null ? Number(options.hoveredIndex) : -1;
      if (hovIdx >= 0 && hovIdx !== measureStartIdx && layout.vias[hovIdx]) {
        drawDimensionLine(vStart, layout.vias[hovIdx], true, 0);
      } else if (options.cursorPos && typeof options.cursorPos.x === 'number') {
        ctx.save();
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.75)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(vStart.sx, vStart.sy);
        ctx.lineTo(options.cursorPos.x, options.cursorPos.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 7. 左上角紧凑型不同 Padstack 颜色图例条 (当有多种 Padstack 时一目了然，导出效果图时自带图例)
    if (layout.padstackColors && layout.padstackColors.length > 0) {
      ctx.save();
      let curX = 12, curY = 12;
      ctx.font = `600 10.5px ${monoStack}`;
      layout.padstackColors.forEach(pc => {
        const shortName = pc.padstack.length > 28 ? (pc.padstack.slice(0, 26) + '…') : pc.padstack;
        const txt = `${shortName} (×${pc.count})`;
        const chipW = ctx.measureText(txt).width + 24;
        if (curX + chipW > cssW - 12 && curX > 12) {
          curX = 12;
          curY += 22;
        }
        drawRoundedRectPath(ctx, curX, curY, chipW, 19, 5);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
        ctx.fill();
        ctx.strokeStyle = pc.border;
        ctx.lineWidth = 1.1;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(curX + 9, curY + 9.5, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = pc.fill;
        ctx.fill();

        ctx.fillStyle = '#e2e8f0';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, curX + 17, curY + 9.5);
        curX += chipW + 6;
      });
      ctx.restore();
    }

    ctx.restore();
    return layout;
  }

  // 暴露命名空间与模块导出
  const FanoutChecker = {
    DEFAULT_SCHEME_NAME_KEYWORDS,
    buildSchemeNameFromKeywords,
    PADSTACK_PALETTE,
    resetPadstackColorRegistry,
    getPadstackColorEntry,
    syncLibraryPadstackColors,
    getLibraryPadstackColorLegend,
    buildPadstackColorMap,
    calcSchemeViaPairDistance,
    parseMultiSchemeTxt,
    parseAndRepairFanoutJson,
    isSignalVia,
    computeSchemeViewLayout,
    renderSchemeEnlargedCanvas,
    MM_PER_MIL,
    MIL_PER_MM,
    dist2D,
    roundN,
    parseViaData,
    sampleArcWorldPoints,
    parseTraceData,
    summarizeTraceData,
    parseFanoutInputData,
    associateTracesWithClusters,
    clusterVias,
    FanoutScheme,
    FanoutLibrary,
    getStandardPresetSchemes,
    matchClusterToLibrary,
    matchClusterSubsetsIterative,
    buildGndSpatialIndex,
    groupSignalUnits,
    compareClusterWithScheme,
    candidateRotations,
    runFanoutInspection
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FanoutChecker;
  } else {
    global.FanoutChecker = FanoutChecker;
  }

})(typeof window !== 'undefined' ? window : this);
