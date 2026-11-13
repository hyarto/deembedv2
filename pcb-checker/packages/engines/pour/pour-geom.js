/* ============================================================================
 * pour-geom.js —— 铜皮轮廓自适应离散、鞋带面积/质心、点在形内与边界距离计算
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PourChecker = Object.assign(root.PourChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MM_PER_MIL = 0.0254;
  const MIL_PER_MM = 1 / 0.0254;

  function dist2D(x1, y1, x2, y2) {
    return Math.hypot(x1 - x2, y1 - y2);
  }

  function roundN(val, n = 3) {
    if (typeof val !== 'number' || isNaN(val)) return 0;
    const factor = Math.pow(10, n);
    return Math.round(val * factor) / factor;
  }

  /**
   * 圆弧高精度参数化插值采样 (与 EDA/CAD 引擎完全一致，消除 Canvas 角度反转与 270 度环绕 Bug)
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
   * 点到圆弧段的**精确**最短距离（判断投影角是否落在扫掠范围内，不再一律用 |d-r|）
   */
  function pointToArcDistance(px, py, seg) {
    const cx = seg.cx, cy = seg.cy, radius = seg.radius;
    const TWO_PI = 2 * Math.PI;
    const ang1 = Math.atan2(seg.y1 - cy, seg.x1 - cx);
    const ang2 = Math.atan2(seg.y2 - cy, seg.x2 - cx);
    const ccw = seg.ccw !== false;

    let span;
    if (ccw) {
      span = (ang2 - ang1) % TWO_PI;
      if (span < 0) span += TWO_PI;
    } else {
      span = (ang1 - ang2) % TWO_PI;
      if (span < 0) span += TWO_PI;
    }
    if (span === 0) span = TWO_PI;

    const angP = Math.atan2(py - cy, px - cx);
    let cur;
    if (ccw) {
      cur = (angP - ang1) % TWO_PI;
      if (cur < 0) cur += TWO_PI;
    } else {
      cur = (ang1 - angP) % TWO_PI;
      if (cur < 0) cur += TWO_PI;
    }

    const dCenter = dist2D(px, py, cx, cy);
    if (cur <= span + 1e-9) {
      return Math.abs(dCenter - radius);       // 垂足落在弧段内
    }
    // 否则最近点必在弧的两个端点上
    return Math.min(dist2D(px, py, seg.x1, seg.y1), dist2D(px, py, seg.x2, seg.y2));
  }

  /**
   * 把铜皮轮廓（直线 + 圆弧）离散成闭合多边形环。
   * 圆弧按弦高误差 tol(mil) 自适应分段，默认 0.05 mil。
   */
  function flattenBoundary(shape, tol) {
    if (!shape || !shape.boundary || !shape.boundary.length) return [];
    const maxErr = tol || 0.05;
    const ring = [];
    for (const seg of shape.boundary) {
      if (seg.type === 'line') {
        ring.push([seg.x1, seg.y1]);
      } else {
        let steps = 8;
        if (seg.radius > maxErr) {
          steps = Math.ceil(Math.abs(arcSpanOf(seg)) / (2 * Math.acos(Math.max(-1, 1 - maxErr / seg.radius))));
        }
        steps = Math.max(4, Math.min(720, steps));
        const pts = sampleArcPoints([seg.cx, seg.cy], seg.radius, [seg.x1, seg.y1], [seg.x2, seg.y2],
          seg.ccw === false ? 'CW' : 'CCW', steps);
        for (let i = 0; i < pts.length - 1; i++) ring.push(pts[i]);
      }
    }
    return ring;
  }

  function arcSpanOf(seg) {
    const TWO_PI = 2 * Math.PI;
    const ang1 = Math.atan2(seg.y1 - seg.cy, seg.x1 - seg.cx);
    const ang2 = Math.atan2(seg.y2 - seg.cy, seg.x2 - seg.cx);
    let span = seg.ccw === false ? (ang1 - ang2) % TWO_PI : (ang2 - ang1) % TWO_PI;
    if (span < 0) span += TWO_PI;
    if (span === 0) span = TWO_PI;
    return span;
  }

  /** 多边形面积（鞋带公式，绝对值） */
  function polygonArea(ring) {
    if (!ring || ring.length < 3) return 0;
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
  }

  /** 多边形质心（面积加权）；退化时退回顶点平均值 */
  function polygonCentroid(ring) {
    if (!ring || !ring.length) return { x: 0, y: 0 };
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const cross = p[0] * q[1] - q[0] * p[1];
      a += cross;
      cx += (p[0] + q[0]) * cross;
      cy += (p[1] + q[1]) * cross;
    }
    if (Math.abs(a) < 1e-12) {
      const sx = ring.reduce((t, p) => t + p[0], 0) / ring.length;
      const sy = ring.reduce((t, p) => t + p[1], 0) / ring.length;
      return { x: sx, y: sy };
    }
    a *= 0.5;
    return { x: cx / (6 * a), y: cy / (6 * a) };
  }

  /** 射线法：点是否在多边形内（含边界近似） */
  function pointInPolygon(px, py, ring) {
    if (!ring || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if ((yi > py) !== (yj > py)) {
        const xCross = xi + (py - yi) * (xj - xi) / (yj - yi);
        if (px < xCross) inside = !inside;
      }
    }
    return inside;
  }

  /** 铜皮多边形环（带缓存），没有几何数据时返回空 */
  function shapeRing(shape) {
    if (!shape) return [];
    if (shape._ring) return shape._ring;
    if (!shape.boundary || !shape.boundary.length) return [];
    shape._ring = flattenBoundary(shape);
    return shape._ring;
  }

  /**
   * 辅助函数：层范围解析与展开 (如 "L1-L5" -> ["L1", "L2", "L3", "L4", "L5"])
   * @param {string|Array<string>} layerInput 
   * @param {Array<string>} availableLayers 
   * @returns {Array<string>} 展开后的层列表
   */

  function pointToShapeDistance(px, py, shape) {
    const b = shape.bbox;
    const hasGeom = !!(shape.boundary && shape.boundary.length);

    if (!hasGeom) {
      // 无几何数据（仅 bbox/面积）时的退化路径
      const dxBox = Math.max(0, b.minX - px, px - b.maxX);
      const dyBox = Math.max(0, b.minY - py, py - b.maxY);
      const boxDist = Math.hypot(dxBox, dyBox);
      return isPointInsideBBox(px, py, b) ? 0 : boxDist;
    }

    // 圆形铜皮快捷计算：仅当确实是「整圆」时才走这条路径
    // （单段圆弧 + 一段弦（D 形铜皮）不是圆，必须按真实轮廓算）
    if (shape.arcs && shape.arcs.length === 1 && shape.boundary.length <= 2 &&
        Math.abs(arcSpanOf(shape.arcs[0]) - 2 * Math.PI) < 1e-6) {
      const arc = shape.arcs[0];
      const dCenter = dist2D(px, py, arc.cx, arc.cy);
      return dCenter <= arc.radius ? 0 : dCenter - arc.radius;
    }

    // 真实的内外判定：在多边形环内部才是 0（环形/带孔铜皮的中心不再误判为贴合）
    const ring = shapeRing(shape);
    if (ring.length >= 3 && pointInPolygon(px, py, ring)) return 0;

    // 细算点到所有边界段的最短距离（圆弧按扫掠角取精确最近点）
    let minD = Infinity;
    for (const seg of shape.boundary) {
      const d = seg.type === 'line'
        ? pointToSegmentDist(px, py, seg.x1, seg.y1, seg.x2, seg.y2)
        : pointToArcDistance(px, py, seg);
      if (d < minD) minD = d;
    }

    if (minD === Infinity) {
      const dxBox = Math.max(0, b.minX - px, px - b.maxX);
      const dyBox = Math.max(0, b.minY - py, py - b.maxY);
      return Math.hypot(dxBox, dyBox);
    }
    return minD;
  }

  function isPointInsideBBox(px, py, bbox) {
    return px >= bbox.minX && px <= bbox.maxX && py >= bbox.minY && py <= bbox.maxY;
  }

  function pointToSegmentDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return dist2D(px, py, x1, y1);

    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return dist2D(px, py, projX, projY);
  }
  return {
    MM_PER_MIL: MM_PER_MIL,
    MIL_PER_MM: MIL_PER_MM,
    dist2D: dist2D,
    roundN: roundN,
    sampleArcPoints: sampleArcPoints,
    pointToArcDistance: pointToArcDistance,
    flattenBoundary: flattenBoundary,
    arcSpanOf: arcSpanOf,
    polygonArea: polygonArea,
    polygonCentroid: polygonCentroid,
    pointInPolygon: pointInPolygon,
    shapeRing: shapeRing,
    pointToShapeDistance: pointToShapeDistance,
    isPointInsideBBox: isPointInsideBBox,
    pointToSegmentDist: pointToSegmentDist
  };
});
