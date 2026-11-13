/* ============================================================================
 * dfm-parser.js —— DFM 过孔与走线段（直线 / 圆弧）报告文本解析器
 * ========================================================================== */
(function (root, factory) {
  var PG = (typeof module === "object" && module.exports) ? require("../../geometry") : root.PadGeom;
  var layers = (typeof module === "object" && module.exports) ? require("./dfm-layers.js") : root.DfmCheck;
  var api = factory(PG, layers);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DfmCheck = Object.assign(root.DfmCheck || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (PG, layers) {
  "use strict";
  var parseViaLayerSpan = layers.parseViaLayerSpan;
  var RE_ITEM = layers._RE.RE_ITEM;
  var RE_VIA_ORIGIN = layers._RE.RE_VIA_ORIGIN;
  var RE_VIA_NET = layers._RE.RE_VIA_NET;
  var RE_VIA_PAD = layers._RE.RE_VIA_PAD;
  var RE_VIA_DRILL = layers._RE.RE_VIA_DRILL;
  var RE_VIA_USAGE = layers._RE.RE_VIA_USAGE;
  var RE_VIA_CONN_TRACE = layers._RE.RE_VIA_CONN_TRACE;
  const RE_TRACE_SUBSET = /Subset:\s*([^\n\r]+)/i;
  const RE_TRACE_NET = /Net:\s*([^\n\r]+)/i;
  const RE_TRACE_TYPE = /Type:\s*([^\n\r]+)/i;
  const RE_TRACE_LEN = /(?:Seg\s+)?Length:\s*([-\d.]+)/i;
  const RE_TRACE_SEG = /(?:^|\n)\s*(?:Seg(?:ment)?:\s*)?xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*Width\s*(?:\(\s*([-\d.]+)\s*\)|([-\d.]+))/i;
  const RE_TRACE_MULTI_SEG = /Segment:\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*(?:arc\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*radius\s*([-\d.]+)\s*(CCW|CW)?\s*)?width\s*(?:\(\s*([-\d.]+)\s*\)|([-\d.]+))/gi;
  const RE_TRACE_ARC = /(?:^|\n)\s*(?:Arc\s*seg:\s*)?xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*Width\s*(?:\(\s*([-\d.]+)\s*\)|([-\d.]+))/i;
  const RE_TRACE_CENTER = /Center-xy:\s*\[([-\d.]+),\s*([-\d.]+)\]\s*Radius\s*\(([-\d.]+)\)\s*(CCW|CW)?/i;

  /** 规则值须为正数才生效，否则返回 null。 */
  function positiveOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /**
   * 按 Padstack 覆盖焊盘直径与一钻直径。
   * rule: { padDiameter, firstDrill }，缺项或非正数时回退 base。
   * 覆盖焊盘直径时，形状按外接尺寸等比缩放，保持原有形状类型与长宽比。
   */
  function resolvePadstackSizing(rule, base) {
    const padOverride = rule ? positiveOrNull(rule.padDiameter) : null;
    const drillOverride = rule ? positiveOrNull(rule.firstDrill) : null;
    let shape = base.shape;
    if (shape && padOverride) {
      const w = Number(shape.w) || 0, h = Number(shape.h) || 0;
      const baseMax = Math.max(w, h);
      const scale = baseMax > 0 ? padOverride / baseMax : 1;
      shape = Object.assign({}, shape, { w: (w || padOverride) * scale, h: (h || padOverride) * scale });
    }
    return {
      shape: shape,
      padDiameter: padOverride || (shape ? Math.max(shape.w, shape.h) : base.padDiameter),
      firstDrill: drillOverride || base.firstDrill
    };
  }

  /**
   * Parse PCB Text content containing Vias and Trace Segments.
   * Options:
   *   - gndPadDiameter: default pad diameter for GND vias (default 5.94 mil)
   *   - signalPadDiameter: default pad diameter for non-GND vias (default 9.94 mil)
   *   - gndFirstDrill: default 1st drill diameter for GND vias (default 5.54 mil)
   *   - signalFirstDrill: default 1st drill diameter for non-GND vias (default 5.54 mil)
   *   - padstackRules: { [Padstack Name]: { padDiameter, firstDrill } } 按 Padstack 覆盖上述默认值
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

          const sizing = resolvePadstackSizing(opts.padstackRules && opts.padstackRules[padName], {
            shape: isGnd ? gndPadShape : signalPadShape,
            padDiameter: isGnd ? defaultGndPadDiam : defaultSignalPadDiam,
            firstDrill: isGnd ? defaultGndFirstDrill : defaultSignalFirstDrill
          });
          const shape = sizing.shape;
          const padDiameter = sizing.padDiameter;
          const firstDrill = sizing.firstDrill;

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

  return {
    parseDfmItems: parseDfmItems,
    resolvePadstackSizing: resolvePadstackSizing
  };
});
