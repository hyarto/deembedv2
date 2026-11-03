/**
 * DFM & Airgap Spatial Geometric Check Engine
 * Calculates exact spatial geometric clearance between Vias and Traces (Line segs & Arc segs).
 */
(function(exports) {
  'use strict';

  // 精确几何内核（Node 下 require，浏览器下取全局 PadGeom）
  const PG = (typeof module === 'object' && module.exports)
    ? require('./pad-geom.js')
    : (typeof PadGeom !== 'undefined' ? PadGeom : null);

  // --- Regexes for parsing PCB coordinate reports ---
  const RE_ITEM = /Item\s+(\d+)\s+<\s*([^>]+)\s*>/i;
  const RE_VIA_ORIGIN = /Origin-xy:\s*\[([-\d.]+),\s*([-\d.]+)\]/i;
  const RE_VIA_NET = /Net:\s*([^\n\r]+)/i;
  const RE_VIA_PAD = /Padstack Name:\s*([^\n\r]+)/i;
  const RE_VIA_DRILL = /Circle Drill:\s*([-\d.]+)/i;
  const RE_VIA_USAGE = /Usage:\s*([^\n\r]+)/i;
  const RE_VIA_PADSTACK_DEF = /Padstack\s+Defined\s*(?:from|:)?\s*([^\s\r\n\-~]+?)\s*(?:\s+to\s+|\s*[\-~]\s*)\s*([^\s\r\n]+)/i;
  const RE_VIA_CONN_TRACE = /Connections:[\s\S]*?Trace:\s*\d+\s*\(([^)]+)\)/i;

  const BOTTOM_LAYER_INDEX = 9999;

  /**
   * 将 PCB 叠层名解析为单调递增的物理层序号:
   * - Top / 表层 / L1 -> 1
   * - 02G01P / 10G07P / 13G09P / 19IS08 -> 前导层号 2 / 10 / 13 / 19
   * - L12 / Layer_12 / Inner12 / 12 -> 12
   * - Bottom / BOT / 底层 -> 9999 (BOTTOM_LAYER_INDEX)
   */
  function parseLayerIndex(layerName) {
    if (layerName == null) return null;
    if (typeof layerName === 'number' && !isNaN(layerName)) return layerName;
    const s = String(layerName).trim();
    if (!s) return null;

    if (/^(?:top|表层|top_layer)$/i.test(s)) return 1;
    if (/^(?:bottom|bot|底层|bottom_layer)$/i.test(s)) return BOTTOM_LAYER_INDEX;

    // Allegro 标准叠层命名: 02G01P -> 2, 10G07P -> 10, 13G09P -> 13, 19IS08 -> 19, 或纯数字 "12" -> 12
    const mLead = s.match(/^0*(\d{1,3})(?:$|[^0-9])/);
    if (mLead) {
      const n = parseInt(mLead[1], 10);
      if (n > 0) return n;
    }

    // L12 / L03 / Layer12 / Inner_12 / SIG12 等命名
    const mPref = s.match(/^(?:L|LAYER|INNER|SIGNAL|SIG|GND|PLN|S)[_\-\s]*0*(\d{1,3})(?:$|[^0-9])/i)
      || s.match(/\bL0*(\d{1,3})(?:$|[^0-9])/i);
    if (mPref) {
      const n = parseInt(mPref[1], 10);
      if (n > 0) return n;
    }

    return null;
  }

  function formatLayerNumTag(num) {
    if (num === 1) return 'L1(Top)';
    if (num === BOTTOM_LAYER_INDEX) return 'Bottom';
    return `L${num}`;
  }

  /**
   * 解析过孔文本块中的连接起止层信息 (Padstack Defined from <Start> to <End>)
   */
  function parseViaLayerSpan(secText) {
    const mDef = secText ? secText.match(RE_VIA_PADSTACK_DEF) : null;
    if (!mDef) {
      return {
        hasDefinedSpan: false,
        definedRaw: 'Top to Bottom',
        startLayer: 'Top',
        endLayer: 'Bottom',
        startLayerNum: 1,
        endLayerNum: BOTTOM_LAYER_INDEX,
        minLayerNum: 1,
        maxLayerNum: BOTTOM_LAYER_INDEX,
        viaSpanType: 'thru',
        viaTypeLabel: '通孔',
        spanShort: 'Top~Bottom',
        spanLabel: '通孔 (Top~Bottom)'
      };
    }

    const startLayer = mDef[1].trim();
    const endLayer = mDef[2].trim();
    const n1 = parseLayerIndex(startLayer);
    const n2 = parseLayerIndex(endLayer);

    if (n1 != null && n2 != null) {
      const minLayerNum = Math.min(n1, n2);
      const maxLayerNum = Math.max(n1, n2);
      let viaSpanType = 'buried';
      let viaTypeLabel = '埋孔';
      if (minLayerNum === 1 && maxLayerNum === BOTTOM_LAYER_INDEX) {
        viaSpanType = 'thru';
        viaTypeLabel = '通孔';
      } else if (minLayerNum === 1 || maxLayerNum === BOTTOM_LAYER_INDEX) {
        viaSpanType = 'blind';
        viaTypeLabel = '盲孔';
      }

      const rangeTag = (minLayerNum === 1 && maxLayerNum === BOTTOM_LAYER_INDEX)
        ? 'Top~Bottom'
        : `${minLayerNum === 1 ? 'L1' : 'L' + minLayerNum}-${maxLayerNum === BOTTOM_LAYER_INDEX ? 'Bot' : 'L' + maxLayerNum}`;
      const rawPair = `${startLayer}~${endLayer}`;
      const spanLabel = viaSpanType === 'thru'
        ? `通孔 (${rawPair})`
        : `${viaTypeLabel} ${rangeTag}` + (rawPair.toUpperCase() !== rangeTag.toUpperCase() ? ` (${rawPair})` : '');

      return {
        hasDefinedSpan: true,
        definedRaw: `${startLayer} to ${endLayer}`,
        startLayer,
        endLayer,
        startLayerNum: n1,
        endLayerNum: n2,
        minLayerNum,
        maxLayerNum,
        viaSpanType,
        viaTypeLabel,
        spanShort: rangeTag,
        spanLabel
      };
    }

    // 非编号自定义层名的回退处理
    const isThruCustom = /^top$/i.test(startLayer) && /^bottom$/i.test(endLayer);
    return {
      hasDefinedSpan: true,
      definedRaw: `${startLayer} to ${endLayer}`,
      startLayer,
      endLayer,
      startLayerNum: n1,
      endLayerNum: n2,
      minLayerNum: isThruCustom ? 1 : null,
      maxLayerNum: isThruCustom ? BOTTOM_LAYER_INDEX : null,
      viaSpanType: isThruCustom ? 'thru' : 'buried',
      viaTypeLabel: isThruCustom ? '通孔' : '盲埋孔',
      spanShort: `${startLayer}~${endLayer}`,
      spanLabel: `${isThruCustom ? '通孔' : '盲埋孔'} (${startLayer}~${endLayer})`
    };
  }

  /**
   * 核心层间穿越判定：判断过孔 (via) 是否物理穿过/连接走线所在层 (traceLayer)
   * 例：
   * - 过孔 Padstack Defined from 10G07P to 13G09P (层范围 10..13)，走线在 L12 (12) -> 返回 true (穿过 L12，需检查线孔间距)
   * - 过孔 Padstack Defined from L1 to L3 / Top to 03G02P (层范围 1..3)，走线在 L12 (12) -> 返回 false (不穿过 L12，无需分析)
   */
  function doesViaSpanLayer(via, traceLayer, precomputedTraceLayerNum) {
    if (!via) return false;

    let minL = via.minLayerNum;
    let maxL = via.maxLayerNum;

    if ((minL == null || maxL == null) && (via.startLayer || via.endLayer)) {
      const sNum = parseLayerIndex(via.startLayer);
      const eNum = parseLayerIndex(via.endLayer);
      if (sNum != null && eNum != null) {
        minL = Math.min(sNum, eNum);
        maxL = Math.max(sNum, eNum);
      }
    }

    // 未携带层定义的老旧/简化对象默认按通孔兼容处理
    if (minL == null || maxL == null) {
      if (!via.startLayer && !via.endLayer) return true;
      const tLow = String(traceLayer || '').trim().toLowerCase();
      if (!tLow) return true;
      if (via.startLayer && via.startLayer.trim().toLowerCase() === tLow) return true;
      if (via.endLayer && via.endLayer.trim().toLowerCase() === tLow) return true;
      if (Array.isArray(via.traceLayers) && via.traceLayers.some(l => String(l).trim().toLowerCase() === tLow)) return true;
      return false;
    }

    // 通孔快速通道
    if (minL === 1 && maxL === BOTTOM_LAYER_INDEX) return true;

    const tNum = precomputedTraceLayerNum !== undefined ? precomputedTraceLayerNum : parseLayerIndex(traceLayer);
    if (tNum != null) {
      return tNum >= minL && tNum <= maxL;
    }

    // 若走线层名无法解析为层号，回退精确匹配起止层或连接层
    const tStr = String(traceLayer || '').trim().toLowerCase();
    if (!tStr) return true;
    if (via.startLayer && via.startLayer.trim().toLowerCase() === tStr) return true;
    if (via.endLayer && via.endLayer.trim().toLowerCase() === tStr) return true;
    if (Array.isArray(via.traceLayers) && via.traceLayers.some(l => String(l).trim().toLowerCase() === tStr)) return true;
    return false;
  }

  const RE_TRACE_SUBSET = /Subset:\s*([^\n\r]+)/i;
  const RE_TRACE_NET = /Net:\s*([^\n\r]+)/i;
  const RE_TRACE_TYPE = /Type:\s*([^\n\r]+)/i;
  const RE_TRACE_LEN = /(?:Seg\s+)?Length:\s*([-\d.]+)/i;
  const RE_TRACE_SEG = /(?:^|\n)\s*(?:Seg(?:ment)?:\s*)?xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*Width\s*(?:\(\s*([-\d.]+)\s*\)|([-\d.]+))/i;
  const RE_TRACE_MULTI_SEG = /Segment:\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*(?:arc\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*radius\s*([-\d.]+)\s*(CCW|CW)?\s*)?width\s*(?:\(\s*([-\d.]+)\s*\)|([-\d.]+))/gi;
  const RE_TRACE_ARC = /(?:^|\n)\s*(?:Arc\s*seg:\s*)?xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*Width\s*(?:\(\s*([-\d.]+)\s*\)|([-\d.]+))/i;
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
    // 焊盘形状（可选）：circle / oblong / roundrect / rect，默认圆形
    const gndPadShape = PG ? PG.normalizeShape(opts.gndPad || opts.gndPadShape,
      typeof opts.gndPadDiameter === 'number' ? opts.gndPadDiameter : 7.906) : null;
    const signalPadShape = PG ? PG.normalizeShape(opts.signalPad || opts.signalPadShape,
      typeof opts.signalPadDiameter === 'number' ? opts.signalPadDiameter : 9.94) : null;
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
        const mUsage = sec.match(RE_VIA_USAGE);
        const mConn = sec.match(RE_VIA_CONN_TRACE);

        if (mXy) {
          const finishDrill = mDrill ? parseFloat(mDrill[1]) : 3.94; // Circle Drill = 完成孔径 (仅展示记录，不作运算)
          const netName = mNet ? mNet[1].trim() : '无网络';
          const isGnd = (netName.toUpperCase() === 'GND');
          const padName = mPad ? mPad[1].trim() : '';
          const usage = mUsage ? mUsage[1].trim() : '';
          const spanInfo = parseViaLayerSpan(sec);

          const shape = isGnd ? gndPadShape : signalPadShape;
          const padDiameter = shape ? Math.max(shape.w, shape.h) : (isGnd ? defaultGndPadDiam : defaultSignalPadDiam);
          const firstDrill = isGnd ? defaultGndFirstDrill : defaultSignalFirstDrill;

          const padRadius = padDiameter / 2.0;   // 外接圆半径（展示用；精确几何见 padRegion）
          const firstDrillRadius = firstDrill / 2.0;

          vias.push({
            id: itemId,
            type: 'via',
            origin: [parseFloat(mXy[1]), parseFloat(mXy[2])],
            net: netName,
            isGnd: isGnd,
            padstack: padName,
            usage: usage,
            hasDefinedSpan: spanInfo.hasDefinedSpan,
            definedRaw: spanInfo.definedRaw,
            startLayer: spanInfo.startLayer,
            endLayer: spanInfo.endLayer,
            startLayerNum: spanInfo.startLayerNum,
            endLayerNum: spanInfo.endLayerNum,
            minLayerNum: spanInfo.minLayerNum,
            maxLayerNum: spanInfo.maxLayerNum,
            viaSpanType: spanInfo.viaSpanType,       // 'thru' | 'blind' | 'buried'
            viaTypeLabel: spanInfo.viaTypeLabel,     // '通孔' | '盲孔' | '埋孔'
            spanShort: spanInfo.spanShort,           // e.g. 'L10-L13' / 'Top~Bottom'
            spanLabel: spanInfo.spanLabel,           // e.g. '埋孔 L10-L13 (10G07P~13G09P)'
            drill: finishDrill,             // 完成孔径 Finished Hole Diameter (仅作展示记录)
            finishDrill: finishDrill,
            firstDrill: firstDrill,         // 一钻直径 First Drill Diameter (直接参与计算)
            firstDrillRadius: firstDrillRadius,
            padDiameter: padDiameter,       // 焊盘外接直径 (展示用)
            padRadius: padRadius,           // 外接圆半径 (圆形焊盘时即真实半径)
            padShape: shape,                // 焊盘形状 {kind,w,h,corner,rot}
            padRing: (padDiameter - finishDrill) / 2.0, // 环宽 (仅供展示参考)
            needsCadGeometry: !!(shape && shape.kind !== 'circle'),
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
          const arcW = parseFloat(mArc[5] || mArc[6]);
          traces.push({
            id: itemId,
            type: 'trace',
            kind: 'arc',
            subset: subset,
            net: net,
            p1: [parseFloat(mArc[1]), parseFloat(mArc[2])],
            p2: [parseFloat(mArc[3]), parseFloat(mArc[4])],
            width: arcW,
            center: [parseFloat(mCenter[1]), parseFloat(mCenter[2])],
            radius: parseFloat(mCenter[3]),
            dir: dir,
            len: segLen,
            raw: sec.trim()
          });
        } else if (itemKind === 'trace' && /Segment:/i.test(sec)) {
          // 支持完整 < Trace > 块中多条 Segment:xy [...] xy [...] width ... 展开
          RE_TRACE_MULTI_SEG.lastIndex = 0;
          let sm, subIdx = 0;
          while ((sm = RE_TRACE_MULTI_SEG.exec(sec)) !== null) {
            subIdx++;
            const p1 = [parseFloat(sm[1]), parseFloat(sm[2])];
            const p2 = [parseFloat(sm[3]), parseFloat(sm[4])];
            const w = parseFloat(sm[9] || sm[10]);
            const segId = subIdx === 1 ? itemId : (itemId * 1000 + subIdx);
            if (sm[5] != null && sm[7] != null) {
              traces.push({
                id: segId,
                parentTraceId: itemId,
                type: 'trace',
                kind: 'arc',
                subset: subset,
                net: net,
                p1: p1,
                p2: p2,
                width: w,
                center: [parseFloat(sm[5]), parseFloat(sm[6])],
                radius: parseFloat(sm[7]),
                dir: sm[8] ? sm[8].toUpperCase() : 'CCW',
                len: Math.hypot(p2[0] - p1[0], p2[1] - p1[1]),
                raw: sec.trim()
              });
            } else {
              traces.push({
                id: segId,
                parentTraceId: itemId,
                type: 'trace',
                kind: 'line',
                subset: subset,
                net: net,
                p1: p1,
                p2: p2,
                width: w,
                len: Math.hypot(p2[0] - p1[0], p2[1] - p1[1]),
                raw: sec.trim()
              });
            }
          }
        } else if (mSeg) {
          const segW = parseFloat(mSeg[5] || mSeg[6]);
          traces.push({
            id: itemId,
            type: 'trace',
            kind: 'line',
            subset: subset,
            net: net,
            p1: [parseFloat(mSeg[1]), parseFloat(mSeg[2])],
            p2: [parseFloat(mSeg[3]), parseFloat(mSeg[4])],
            width: segW,
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

  // --- 精确焊盘几何（圆形 / 椭圆 / 圆角矩形 / 矩形） ---

  /**
   * 取过孔的焊盘区域（绝对坐标，首次调用时构建并缓存）。
   * 区域 = 凸多边形 ⊕ 圆角半径，1 点表示圆、2 点表示长圆（椭圆/槽）、4 点表示矩形。
   */
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

  /**
   * 走线中心线 → 焊盘边界的**有符号**距离（正=间隙，负=重叠）。
   * 圆形焊盘走解析式（与旧版完全一致）；非圆焊盘走精确的多边形/圆弧几何。
   */
  function traceToPadSigned(region, trace) {
    if (!region || !PG) return NaN;
    if (PG.isCircleRegion(region)) {
      const c = region.poly[0];
      const d = trace.kind === 'line'
        ? ptToSegDist(c, trace.p1, trace.p2).dist
        : ptToArcDist(c, trace.center, trace.radius, trace.p1, trace.p2, trace.dir).dist;
      return d - region.round;
    }
    if (trace.kind === 'line') {
      return PG.signedSegmentRegionDist(trace.p1, trace.p2, region);
    }
    return PG.signedArcRegionDist(trace.center, trace.radius, trace.p1, trace.p2, trace.dir, region, 0);
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

    // Pre-cache parsed physical layer numbers for each unique trace Subset (O(1) lookup)
    const subsetLayerNumMap = new Map();
    activeTraces.forEach(t => {
      if (!subsetLayerNumMap.has(t.subset)) {
        subsetLayerNumMap.set(t.subset, parseLayerIndex(t.subset));
      }
    });

    // Aggregate trace counts per (subset, net) for ultra-fast layer-aware theoretical pair counting
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

    // Calculate layer-aware cross-combinations (仅统计过孔实际穿过的走线层，自动跳过盲埋孔不穿过的层)
    let totalChecked = 0;
    let gndTotal = 0;
    let sigTotal = 0;
    let skippedNonSpanningPairs = 0;
    const viaTypeCounts = { thru: 0, blind: 0, buried: 0 };

    vias.forEach(v => {
      const vType = v.viaSpanType || 'thru';
      if (viaTypeCounts[vType] !== undefined) viaTypeCounts[vType]++;
      else viaTypeCounts.thru++;

      let count = 0;
      subsetStatsMap.forEach((st, subsetName) => {
        const candidateCnt = diffNetOnly ? (st.total - (st.byNet.get(v.net) || 0)) : st.total;
        if (candidateCnt <= 0) return;

        if (doesViaSpanLayer(v, subsetName, st.layerNum)) {
          count += candidateCnt;
        } else {
          skippedNonSpanningPairs += candidateCnt;
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

    // 2. Spatial Query for Each Via (Narrow Phase Evaluation with Layer-Span Filtering)
    vias.forEach(via => {
      const vPadRadius = via.padRadius || (via.isGnd ? defaultGndPadDiam / 2.0 : defaultSignalPadDiam / 2.0);
      const vFirstDrillR = via.firstDrillRadius || (via.isGnd ? defaultGndFirstDrill / 2.0 : defaultSignalFirstDrill / 2.0);
      const vx = via.origin[0], vy = via.origin[1];
      // 精确焊盘区域（非圆形焊盘时按真实形状判定）
      const vRegion = PG ? padRegionOf(via, vPadRadius * 2.0) : null;
      const vIsCircle = !vRegion || PG.isCircleRegion(vRegion);
      // 焊盘大于默认值时同步放大搜索半径，避免漏检
      const vSearchR = SEARCH_RADIUS + Math.max(0, vPadRadius - maxPadR);

      const targetThreshold = via.isGnd ? minClearanceGnd : minClearanceSignal;
      const targetType = via.isGnd ? '线到GND孔' : '线到信号孔';

      layerGrids.forEach((lGrid, traceLayerName) => {
        // 核心盲埋孔层间过滤：若过孔连接的起止层不穿过当前走线所在层，直接跳过，避免盲埋孔下穿走线误判！
        const cachedTraceLayerNum = subsetLayerNumMap.get(traceLayerName);
        if (!doesViaSpanLayer(via, traceLayerName, cachedTraceLayerNum)) {
          return;
        }

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

              // Fast AABB rejection
              if (vx < item.minX - vSearchR || vx > item.maxX + vSearchR ||
                  vy < item.minY - vSearchR || vy > item.maxY + vSearchR) {
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
              // 中心线到焊盘边界的距离：圆形=中心距-半径（解析）；非圆=精确几何
              const padToCenterline = vIsCircle ? (centerDist - vPadRadius) : traceToPadSigned(vRegion, trace);
              const padEdgeDist = padToCenterline - traceHalfW;

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
                padShapeKind: via.padShape ? via.padShape.kind : 'circle',
                padToCenterline: padToCenterline,
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
      skippedNonSpanningPairs: skippedNonSpanningPairs,
      viaTypeCounts: viaTypeCounts,
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
    const r1 = PG ? padRegionOf(v1) : null;
    const r2 = PG ? padRegionOf(v2) : null;
    const padAirgap = (r1 && r2) ? PG.signedRegionDist(r1, r2)
                                 : dCenter - v1.padRadius - v2.padRadius;
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
    const padRegion = PG ? padRegionOf(via) : null;
    const padAirgap = (padRegion && PG.isCircleRegion(padRegion))
      ? traceEdgeDist - via.padRadius
      : (padRegion ? traceToPadSigned(padRegion, trace) - traceHalfW
                   : traceEdgeDist - via.padRadius);
    const drillAirgap = traceEdgeDist - via.firstDrillRadius;
    const spansTraceLayer = trace && trace.subset ? doesViaSpanLayer(via, trace.subset) : true;

    return {
      type: 'via_to_trace',
      via: via,
      trace: trace,
      proj: geomRes.proj,
      centerDist: dCenter,
      traceEdgeDist: traceEdgeDist,
      padAirgap: padAirgap,
      drillAirgap: drillAirgap,
      spansTraceLayer: spansTraceLayer
    };
  }

  // Export functions
  exports.BOTTOM_LAYER_INDEX = BOTTOM_LAYER_INDEX;
  exports.parseLayerIndex = parseLayerIndex;
  exports.parseViaLayerSpan = parseViaLayerSpan;
  exports.doesViaSpanLayer = doesViaSpanLayer;
  exports.parseDfmItems = parseDfmItems;
  exports.ptToSegDist = ptToSegDist;
  exports.ptToArcDist = ptToArcDist;
  exports.sampleArcPoints = sampleArcPoints;
  exports.runDfmCheck = runDfmCheck;
  exports.calcViaToViaMetrics = calcViaToViaMetrics;
  exports.calcTraceToViaMetrics = calcTraceToViaMetrics;
  exports.padRegionOf = padRegionOf;
  exports.traceToPadSigned = traceToPadSigned;
  exports.PadGeom = PG;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.DfmCheck = {}));
