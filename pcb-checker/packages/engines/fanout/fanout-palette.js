/* ============================================================================
 * fanout-palette.js —— 全局统一 Padstack 专属色板注册表与孔心距指标计算
 * ========================================================================== */
(function (root, factory) {
  var parser = (typeof module === "object" && module.exports) ? require("./fanout-parser.js") : root.FanoutChecker;
  var api = factory(parser);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FanoutChecker = Object.assign(root.FanoutChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (parser) {
  "use strict";
  var MM_PER_MIL = parser.MM_PER_MIL;
  var isSignalVia = parser.isSignalVia;
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
  return {
    PADSTACK_PALETTE: PADSTACK_PALETTE,
    resetPadstackColorRegistry: resetPadstackColorRegistry,
    getPadstackColorEntry: getPadstackColorEntry,
    syncLibraryPadstackColors: syncLibraryPadstackColors,
    getLibraryPadstackColorLegend: getLibraryPadstackColorLegend,
    buildPadstackColorMap: buildPadstackColorMap,
    calcSchemeViaPairDistance: calcSchemeViaPairDistance
  };
});
