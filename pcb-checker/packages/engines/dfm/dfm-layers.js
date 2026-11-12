/* ============================================================================
 * dfm-layers.js —— PCB 叠层序号解析、分层规则匹配与盲埋孔穿层判定（Fail-Closed）
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DfmCheck = Object.assign(root.DfmCheck || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
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

  // ===== 分层规则：把「Top、Bot / 内层 / L2-L5 / L2、L3」这类写法解析成层号区间 =====
  const INNER_FIRST_INDEX = 2;
  const INNER_LAST_INDEX = BOTTOM_LAYER_INDEX - 1;

  function parseLayerSpec(spec) {
    const raw = String(spec == null ? '' : spec).trim();
    if (!raw) return [];
    const out = [];
    raw.replace(/[，,、;；/|\s]+/g, ' ').split(' ').filter(Boolean).forEach(tok => {
      const t = tok.toLowerCase();
      if (t === 'top' || t === '表层' || t === '顶层') { out.push([1, 1]); return; }
      if (t === 'bot' || t === 'bottom' || t === '底层' || t === '背面') { out.push([BOTTOM_LAYER_INDEX, BOTTOM_LAYER_INDEX]); return; }
      if (t === '内层' || t === 'inner') { out.push([INNER_FIRST_INDEX, INNER_LAST_INDEX]); return; }
      if (t === '全部' || t === 'all' || t === '*') { out.push([1, BOTTOM_LAYER_INDEX]); return; }
      const range = tok.match(/^L?\s*(\d{1,3})\s*(?:-|~|到|至)\s*L?\s*(\d{1,3})$/i);
      if (range) {
        const a = parseInt(range[1], 10), b = parseInt(range[2], 10);
        if (a > 0 && b > 0) out.push([Math.min(a, b), Math.max(a, b)]);
        return;
      }
      const one = tok.match(/^L?\s*(\d{1,3})$/i);
      if (one) {
        const n = parseInt(one[1], 10);
        if (n > 0) out.push([n, n]);
      }
    });
    return out;
  }

  function layerSpecMatches(ranges, idx) {
    if (!ranges || !ranges.length || idx == null || isNaN(idx)) return false;
    for (let i = 0; i < ranges.length; i++) {
      if (idx >= ranges[i][0] && idx <= ranges[i][1]) return true;
    }
    return false;
  }

  function layerSpecLabel(ranges) {
    if (!ranges || !ranges.length) return '';
    return ranges.map(r => {
      if (r[0] === 1 && r[1] === 1) return 'L1（Top）';
      if (r[0] === BOTTOM_LAYER_INDEX && r[1] === BOTTOM_LAYER_INDEX) return 'Bottom';
      if (r[0] === INNER_FIRST_INDEX && r[1] === INNER_LAST_INDEX) return '内层（L2 起）';
      if (r[0] === 1 && r[1] === BOTTOM_LAYER_INDEX) return '全部层';
      if (r[0] === r[1]) return 'L' + r[0];
      return 'L' + r[0] + '–L' + r[1];
    }).join('、');
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
   * - 过孔 Padstack Defined from 10G07P to 13G09P (层范围 10..13)，走线在 L12 (12) -> 穿过，需检查线孔间距
   * - 过孔 Padstack Defined from L1 to L3 / Top to 03G02P (层范围 1..3)，走线在 L12 (12) -> 不穿过 L12，无需分析
   *
   * 返回值 { spans, determined }：
   * - spans: 是否按穿越该层处理（false = 明确不穿越，整对跳过）
   * - determined: 该结论是否由层号/层名精确判定得出。为 false 表示层信息无法解析，
   *   按「宁可多检、不可漏检」的 DRC 原则一律照常检查（旧版本此处返回 false，会造成静默漏检）。
   */
  function evaluateViaSpan(via, traceLayer, precomputedTraceLayerNum) {
    if (!via) return { spans: false, determined: true };

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

    const tStr = String(traceLayer || '').trim().toLowerCase();
    const nameMatches = () => {
      if (!tStr) return false;
      if (via.startLayer && via.startLayer.trim().toLowerCase() === tStr) return true;
      if (via.endLayer && via.endLayer.trim().toLowerCase() === tStr) return true;
      if (Array.isArray(via.traceLayers) && via.traceLayers.some(l => String(l).trim().toLowerCase() === tStr)) return true;
      return false;
    };

    // 过孔层跨度未知：默认按通孔兼容处理（照常检查，不静默跳过）
    if (minL == null || maxL == null) {
      if (!via.startLayer && !via.endLayer) return { spans: true, determined: false };
      if (nameMatches()) return { spans: true, determined: true };
      // 层名对不上且无法按层号比较 —— 不能证明「不穿过」，按检查处理
      return { spans: true, determined: false };
    }

    // 通孔快速通道
    if (minL === 1 && maxL === BOTTOM_LAYER_INDEX) return { spans: true, determined: true };

    const tNum = precomputedTraceLayerNum !== undefined ? precomputedTraceLayerNum : parseLayerIndex(traceLayer);
    if (tNum != null) {
      return { spans: tNum >= minL && tNum <= maxL, determined: true };
    }

    // 走线层名无法解析为层号：回退精确匹配起止层或连接层
    if (!tStr) return { spans: true, determined: false };
    if (nameMatches()) return { spans: true, determined: true };
    // 无法比较 → 照常检查（不做静默跳过）
    return { spans: true, determined: false };
  }

  function doesViaSpanLayer(via, traceLayer, precomputedTraceLayerNum) {
    return evaluateViaSpan(via, traceLayer, precomputedTraceLayerNum).spans;
  }

  const RE_TRACE_SUBSET = /Subset:\s*([^\n\r]+)/i;
  const RE_TRACE_NET = /Net:\s*([^\n\r]+)/i;
  const RE_TRACE_TYPE = /Type:\s*([^\n\r]+)/i;
  const RE_TRACE_LEN = /(?:Seg\s+)?Length:\s*([-\d.]+)/i;
  const RE_TRACE_SEG = /(?:^|\n)\s*(?:Seg(?:ment)?:\s*)?xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*Width\s*(?:\(\s*([-\d.]+)\s*\)|([-\d.]+))/i;
  const RE_TRACE_MULTI_SEG = /Segment:\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*(?:arc\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*radius\s*([-\d.]+)\s*(CCW|CW)?\s*)?width\s*(?:\(\s*([-\d.]+)\s*\)|([-\d.]+))/gi;
  const RE_TRACE_ARC = /(?:^|\n)\s*(?:Arc\s*seg:\s*)?xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*xy\s*\[([-\d.]+),\s*([-\d.]+)\]\s*Width\s*(?:\(\s*([-\d.]+)\s*\)|([-\d.]+))/i;
  return {
    BOTTOM_LAYER_INDEX: BOTTOM_LAYER_INDEX,
    parseLayerIndex: parseLayerIndex,
    parseLayerSpec: parseLayerSpec,
    layerSpecMatches: layerSpecMatches,
    layerSpecLabel: layerSpecLabel,
    formatLayerNumTag: formatLayerNumTag,
    parseViaLayerSpan: parseViaLayerSpan,
    evaluateViaSpan: evaluateViaSpan,
    doesViaSpanLayer: doesViaSpanLayer,
    _RE: {
      RE_ITEM: RE_ITEM,
      RE_VIA_ORIGIN: RE_VIA_ORIGIN,
      RE_VIA_NET: RE_VIA_NET,
      RE_VIA_PAD: RE_VIA_PAD,
      RE_VIA_DRILL: RE_VIA_DRILL,
      RE_VIA_USAGE: RE_VIA_USAGE,
      RE_VIA_CONN_TRACE: RE_VIA_CONN_TRACE
    }
  };
});
