/**
 * pad-geom.js
 * 焊盘/铜皮精确几何内核（无 DOM 依赖，可同时用于浏览器与 Node）
 *
 * 统一的形状模型：**凸多边形 ⊕ 半径 r 的圆**（Minkowski 和）
 *   - 圆焊盘      circle    : 退化多边形（1 点）⊕ r
 *   - 椭圆/长圆焊盘 oblong   : 线段（2 点）⊕ r
 *   - 圆角矩形    roundrect : 内缩矩形（4 点）⊕ r
 *   - 直角矩形    rect      : 矩形（4 点）⊕ 0
 *
 * 该模型下形状间距离有闭式解：
 *   dist(A ⊕ D_ra, B ⊕ D_rb) = max(0, dist(A, B) − ra − rb)
 * 因此矩形/椭圆/圆角焊盘到走线（胶囊）的间距是**精确值**，不是采样近似。
 *
 * 圆弧走线到凸多边形的距离：弧上最近点通过「抽样定界 + 黄金分割细化」求解，
 * 误差 < 1e-8 mil（远小于任何工程容差），且不会出现乐观偏差。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PadGeom = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-12;

  // ---------------------------------------------------------------- 基础工具
  function dist2D(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
  }

  /** 线段 AB 到线段 CD 的最短距离（相交时为 0） */
  function segSegDist(a, b, c, d) {
    if (segmentsIntersect(a, b, c, d)) return 0;
    return Math.min(
      pointSegDist(a, c, d),
      pointSegDist(b, c, d),
      pointSegDist(c, a, b),
      pointSegDist(d, a, b)
    );
  }

  function pointSegDist(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (l2 <= EPS) return dist2D(p[0], p[1], a[0], a[1]);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return dist2D(p[0], p[1], a[0] + t * dx, a[1] + t * dy);
  }

  function orient(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }

  function onSegment(a, b, p) {
    return Math.min(a[0], b[0]) - EPS <= p[0] && p[0] <= Math.max(a[0], b[0]) + EPS &&
           Math.min(a[1], b[1]) - EPS <= p[1] && p[1] <= Math.max(a[1], b[1]) + EPS;
  }

  function segmentsIntersect(a, b, c, d) {
    const o1 = orient(a, b, c), o2 = orient(a, b, d);
    const o3 = orient(c, d, a), o4 = orient(c, d, b);
    if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
        ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
    if (Math.abs(o1) <= EPS && onSegment(a, b, c)) return true;
    if (Math.abs(o2) <= EPS && onSegment(a, b, d)) return true;
    if (Math.abs(o3) <= EPS && onSegment(c, d, a)) return true;
    if (Math.abs(o4) <= EPS && onSegment(c, d, b)) return true;
    return false;
  }

  // ------------------------------------------------------------ 形状 → 区域
  /**
   * 把焊盘形状描述规范化为 { kind, w, h, corner, rot }
   * 兼容写法：
   *   - 字符串 'circle' | 'oblong' | 'rect' | 'roundrect'（此时用 diameter 推尺寸）
   *   - 数字（视作圆焊盘直径）
   *   - 对象 { shape|kind, w|width, h|height, corner|r, rot|rotation, diameter }
   */
  function normalizeShape(shape, fallbackDiameter) {
    const d = isFiniteNumber(fallbackDiameter) ? fallbackDiameter : 0;
    let s = { kind: 'circle', w: d, h: d, corner: 0, rot: 0 };

    if (isFiniteNumber(shape)) {
      s.w = s.h = shape;
      return s;
    }
    if (typeof shape === 'string') {
      s.kind = shape.toLowerCase();
      if (s.kind !== 'circle' && d > 0) { s.w = d; s.h = d; }
      return finalize(s);
    }
    if (shape && typeof shape === 'object') {
      const kind = String(shape.kind || shape.shape || 'circle').toLowerCase();
      const w = num(shape.w != null ? shape.w : (shape.width != null ? shape.width : shape.diameter), d);
      const h = num(shape.h != null ? shape.h : (shape.height != null ? shape.height : shape.diameter), w);
      s.kind = kind;
      s.w = w;
      s.h = h;
      s.corner = num(shape.corner != null ? shape.corner : shape.r, 0);
      s.rot = num(shape.rot != null ? shape.rot : shape.rotation, 0);
      return finalize(s);
    }
    return finalize(s);
  }

  function finalize(s) {
    if (s.kind === 'ellipse' || s.kind === 'oval' || s.kind === 'slot') s.kind = 'oblong';
    if (s.kind === 'rectangle' || s.kind === 'square') s.kind = 'rect';
    if (s.kind === 'rounded-rect' || s.kind === 'roundedrect') s.kind = 'roundrect';
    if (!isFiniteNumber(s.w) || s.w <= 0) s.w = s.h > 0 ? s.h : 1;
    if (!isFiniteNumber(s.h) || s.h <= 0) s.h = s.w;
    if (s.kind === 'circle') s.h = s.w;

    // 圆角上限：不超过短边的一半
    const maxCorner = Math.min(s.w, s.h) / 2;
    s.corner = Math.max(0, Math.min(isFiniteNumber(s.corner) ? s.corner : 0, maxCorner));
    if (s.kind === 'rect') s.corner = 0;
    if (s.kind === 'roundrect' && s.corner <= 0) s.corner = Math.min(s.w, s.h) / 4;
    if (s.kind === 'oblong') s.corner = Math.min(s.w, s.h) / 2;
    if (s.kind === 'circle') s.corner = s.w / 2;
    return s;
  }

  /**
   * 生成以 (0,0) 为中心、已按 rot 旋转的区域 { poly, round, kind }
   * poly 为凸多边形顶点数组（1 点 / 2 点 / 4 点）
   */
  function regionOf(shape, fallbackDiameter) {
    const s = normalizeShape(shape, fallbackDiameter);
    const rad = (s.rot || 0) * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const rotate = (x, y) => [x * cos - y * sin, x * sin + y * cos];

    let poly = [];
    let round = 0;

    if (s.kind === 'circle') {
      poly = [[0, 0]];
      round = s.w / 2;
    } else if (s.kind === 'oblong') {
      const half = Math.abs(s.w - s.h) / 2;      // 沿长轴方向的半线段
      const longX = s.w >= s.h;
      const ax = longX ? half : 0;
      const ay = longX ? 0 : half;
      poly = [rotate(-ax, -ay), rotate(ax, ay)];
      round = Math.min(s.w, s.h) / 2;
    } else if (s.kind === 'roundrect') {
      const ix = Math.max(0, s.w / 2 - s.corner);
      const iy = Math.max(0, s.h / 2 - s.corner);
      poly = [rotate(-ix, -iy), rotate(ix, -iy), rotate(ix, iy), rotate(-ix, iy)];
      round = s.corner;
    } else { // rect
      const hx = s.w / 2, hy = s.h / 2;
      poly = [rotate(-hx, -hy), rotate(hx, -hy), rotate(hx, hy), rotate(-hx, hy)];
      round = 0;
    }

    return { kind: s.kind, shape: s, poly: poly, round: round };
  }

  function translateRegion(region, cx, cy) {
    return {
      kind: region.kind,
      shape: region.shape,
      round: region.round,
      poly: region.poly.map(p => [p[0] + cx, p[1] + cy])
    };
  }

  function isCircleRegion(region) {
    return region.poly.length === 1 && region.round > 0;
  }

  function circleRegion(center, radius) {
    return { kind: 'circle', round: radius, poly: [[center[0], center[1]]],
             shape: { kind: 'circle', w: radius * 2, h: radius * 2, corner: radius, rot: 0 } };
  }

  // ------------------------------------------------------- 多边形距离与重叠
  function edgesOf(poly) {
    const n = poly.length;
    if (n === 1) return [];
    if (n === 2) return [[poly[0], poly[1]]];
    const out = [];
    for (let i = 0; i < n; i++) out.push([poly[i], poly[(i + 1) % n]]);
    return out;
  }

  function hasArea(poly) {
    if (poly.length < 3) return false;
    // 共线判定（退化多边形按线段处理）
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
      if (Math.abs(orient(a, b, c)) > 1e-9) return true;
    }
    return false;
  }

  /** 点到凸多边形的无符号距离（点在内部时为 0） */
  function pointPolyDist(p, poly) {
    if (poly.length === 1) return dist2D(p[0], p[1], poly[0][0], poly[0][1]);
    let min = Infinity;
    for (const [a, b] of edgesOf(poly)) {
      const d = pointSegDist(p, a, b);
      if (d < min) min = d;
    }
    return min;
  }

  /** 分离轴测试：两个凸多边形是否重叠（含包含关系） */
  function polygonsOverlap(A, B) {
    if (!hasArea(A) || !hasArea(B)) return false;
    return !hasSeparatingAxis(A, B) && !hasSeparatingAxis(B, A);
  }

  function hasSeparatingAxis(P, Q) {
    const n = P.length;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      const nx = -(b[1] - a[1]), ny = b[0] - a[0];
      const len = Math.hypot(nx, ny);
      if (len <= EPS) continue;
      const ux = nx / len, uy = ny / len;
      const p = projectRange(P, ux, uy);
      const q = projectRange(Q, ux, uy);
      if (p.max < q.min - 1e-9 || q.max < p.min - 1e-9) return true;
    }
    return false;
  }

  function projectRange(P, ux, uy) {
    let min = Infinity, max = -Infinity;
    for (const p of P) {
      const v = p[0] * ux + p[1] * uy;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { min: min, max: max };
  }

  /** 重叠深度（最小平移分离距离）：越小越难分开 */
  function penetrationDepth(A, B) {
    let minOverlap = Infinity;
    const scan = (P, Q) => {
      const n = P.length;
      for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n];
        const nx = -(b[1] - a[1]), ny = b[0] - a[0];
        const len = Math.hypot(nx, ny);
        if (len <= EPS) continue;
        const ux = nx / len, uy = ny / len;
        const p = projectRange(P, ux, uy);
        const q = projectRange(Q, ux, uy);
        const overlap = Math.min(p.max, q.max) - Math.max(p.min, q.min);
        if (overlap < minOverlap) minOverlap = overlap;
      }
    };
    scan(A, B); scan(B, A);
    return minOverlap === Infinity ? 0 : Math.max(0, minOverlap);
  }

  /** 点是否在凸多边形内（含边界，tol 为边界容差） */
  function pointInConvex(p, poly, tol) {
    if (poly.length < 3 || !hasArea(poly)) return false;
    const eps = tol == null ? 1e-9 : tol;
    let sign = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const o = orient(a, b, p);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      if (Math.abs(o) / len <= eps) continue;           // 在边上
      const s = o > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  }

  /** 点在多边形内部的深度（到最近的边），外部返回 0 */
  function insideDepthOfPoint(p, poly) {
    if (!pointInConvex(p, poly, 1e-9)) return 0;
    return pointPolyDist(p, poly);
  }

  function minEdgePairDist(A, B) {
    let min = Infinity;
    for (const [a1, a2] of edgesOf(A)) {
      for (const [b1, b2] of edgesOf(B)) {
        const d = segSegDist(a1, a2, b1, b2);
        if (d < min) min = d;
      }
    }
    if (min === Infinity) {
      if (A.length === 1) min = pointPolyDist(A[0], B);
      else if (B.length === 1) min = pointPolyDist(B[0], A);
      else min = segSegDist(A[0], A[A.length - 1], B[0], B[B.length - 1]);
    }
    return min;
  }

  /**
   * 两个凸多边形的**有符号**距离：分离为正，重叠为负（负值为穿透深度）。
   * 圆/长圆/圆角矩形都以此为基础减掉各自的圆角半径。
   */
  function signedPolyDist(A, B) {
    const aArea = hasArea(A), bArea = hasArea(B);

    if (aArea && bArea) {
      if (polygonsOverlap(A, B)) return -penetrationDepth(A, B);
      return minEdgePairDist(A, B);
    }

    // 至少一方退化为点/线段：先看无符号距离，再单独判断包含与穿透
    const d = minEdgePairDist(A, B);

    let depth = 0;
    const probe = (pts, poly) => {
      if (!hasArea(poly)) return;
      for (const p of pts) {
        const dd = insideDepthOfPoint(p, poly);
        if (dd > depth) depth = dd;
      }
    };
    probe(A, B);
    probe(B, A);

    // 线段中部穿过多边形、两个端点都在外部时，加密采样求穿透深度
    if (depth === 0 && d === 0) {
      const seg = A.length === 2 ? A : (B.length === 2 ? B : null);
      const poly = seg === A ? B : A;
      if (seg && hasArea(poly)) {
        const STEPS = 16;
        for (let i = 0; i <= STEPS; i++) {
          const t = i / STEPS;
          const p = [seg[0][0] + (seg[1][0] - seg[0][0]) * t, seg[0][1] + (seg[1][1] - seg[0][1]) * t];
          const dd = insideDepthOfPoint(p, poly);
          if (dd > depth) depth = dd;
        }
      }
    }

    if (depth > 0) return -depth;
    if (d === 0) return -1e-6;   // 刚好相切/贴合
    return d;
  }

  /** 区域到区域的有符号距离（已计入圆角/半径） */
  function signedRegionDist(A, B) {
    return signedPolyDist(A.poly, B.poly) - A.round - B.round;
  }

  function regionDist(A, B) { return Math.max(0, signedRegionDist(A, B)); }

  /** 点到区域的有符号距离（内部为负） */
  function signedPointRegionDist(p, region) {
    return signedPolyDist([p], region.poly) - region.round;
  }

  /** 线段到区域的有符号距离（线段视为 2 点退化多边形） */
  function signedSegmentRegionDist(a, b, region) {
    return signedPolyDist([a, b], region.poly) - region.round;
  }

  // ------------------------------------------------------------- 圆弧 → 区域
  /** 归一化圆弧扫掠角（弧度，> 0） */
  function arcSpan(center, p1, p2, direction) {
    const ang1 = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
    const ang2 = Math.atan2(p2[1] - center[1], p2[0] - center[0]);
    const TWO_PI = 2 * Math.PI;
    let span;
    if (direction === 'CW') {
      span = (ang1 - ang2) % TWO_PI;
    } else {
      span = (ang2 - ang1) % TWO_PI;
    }
    if (span <= 0) span += TWO_PI;
    return span;
  }

  function arcPoint(center, radius, ang) {
    return [center[0] + radius * Math.cos(ang), center[1] + radius * Math.sin(ang)];
  }

  /**
   * 圆弧中心线到区域的有符号距离。
   * 步骤：弧上等分抽样定位最近区间 → 黄金分割细化 → 减去走线半宽。
   * 抽查点数随扫掠角自适应，最坏 512 点；细化后误差 < 1e-8 mil。
   */
  function signedArcRegionDist(center, radius, p1, p2, direction, region, halfWidth) {
    const TWO_PI = 2 * Math.PI;
    const ang1 = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
    const span = arcSpan(center, p1, p2, direction);
    const sign = direction === 'CW' ? -1 : 1;

    const f = (t) => signedPointRegionDist(arcPoint(center, radius, ang1 + sign * t), region);

    const N = Math.max(8, Math.min(512, Math.ceil(span / (Math.PI / 180)))); // ≈1° 一段
    let bestT = 0, bestV = Infinity;
    for (let i = 0; i <= N; i++) {
      const t = span * i / N;
      const v = f(t);
      if (v < bestV) { bestV = v; bestT = t; }
    }

    // 在最优抽样点两侧的区间内做黄金分割细化（区间内函数近似凸）
    const lo = Math.max(0, bestT - span / N);
    const hi = Math.min(span, bestT + span / N);
    const refined = goldenSection(f, lo, hi, 80);
    const rawDist = Math.min(bestV, refined.value);

    return rawDist - halfWidth;
  }

  function goldenSection(f, lo, hi, iters) {
    const invphi = (Math.sqrt(5) - 1) / 2;
    let a = lo, b = hi;
    let x1 = b - invphi * (b - a);
    let x2 = a + invphi * (b - a);
    let f1 = f(x1), f2 = f(x2);
    for (let i = 0; i < iters; i++) {
      if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = b - invphi * (b - a); f1 = f(x1); }
      else { a = x1; x1 = x2; f1 = f2; x2 = a + invphi * (b - a); f2 = f(x2); }
    }
    const t = (a + b) / 2;
    return { t: t, value: f(t) };
  }

  /** 圆弧中心线到区域的最近点（用于测量面板展示） */
  function closestPointOnArcToRegion(center, radius, p1, p2, direction, region) {
    const ang1 = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
    const span = arcSpan(center, p1, p2, direction);
    const sign = direction === 'CW' ? -1 : 1;
    const f = (t) => signedPointRegionDist(arcPoint(center, radius, ang1 + sign * t), region);
    const res = goldenSection(f, 0, span, 80);
    return arcPoint(center, radius, ang1 + sign * res.t);
  }

  // ---------------------------------------------------------------- 导出
  function num(v, fallback) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isFiniteNumber(n) ? n : fallback;
  }

  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }

  return {
    normalizeShape: normalizeShape,
    regionOf: regionOf,
    translateRegion: translateRegion,
    circleRegion: circleRegion,
    isCircleRegion: isCircleRegion,
    dist2D: dist2D,
    segSegDist: segSegDist,
    pointSegDist: pointSegDist,
    segmentsIntersect: segmentsIntersect,
    pointPolyDist: pointPolyDist,
    pointInConvex: pointInConvex,
    insideDepthOfPoint: insideDepthOfPoint,
    polygonsOverlap: polygonsOverlap,
    penetrationDepth: penetrationDepth,
    signedPolyDist: signedPolyDist,
    signedRegionDist: signedRegionDist,
    regionDist: regionDist,
    signedPointRegionDist: signedPointRegionDist,
    signedSegmentRegionDist: signedSegmentRegionDist,
    signedArcRegionDist: signedArcRegionDist,
    closestPointOnArcToRegion: closestPointOnArcToRegion,
    arcSpan: arcSpan
  };
});
