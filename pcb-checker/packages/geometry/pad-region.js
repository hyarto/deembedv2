/* ============================================================================
 * pad-region.js —— 焊盘/铜皮区域建模（凸多边形 ⊕ 圆角半径）与圆弧黄金分割精确求距
 * 依赖：pad-primitives.js
 * ========================================================================== */
(function (root, factory) {
  var prim = (typeof module === 'object' && module.exports)
    ? require('./pad-primitives.js')
    : root.PadGeom;
  var api = factory(prim);
  if (typeof module === 'object' && module.exports) {
    module.exports = Object.assign({}, prim, api);
  }
  root.PadGeom = Object.assign(root.PadGeom || {}, prim, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (prim) {
  'use strict';

  var signedPolyDist = prim.signedPolyDist;

  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function num(v, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFiniteNumber(n) ? n : fallback;
  }

  function finalize(s) {
    if (s.kind === 'ellipse' || s.kind === 'oval' || s.kind === 'slot') s.kind = 'oblong';
    if (s.kind === 'rectangle' || s.kind === 'square') s.kind = 'rect';
    if (s.kind === 'rounded-rect' || s.kind === 'roundedrect') s.kind = 'roundrect';
    if (!isFiniteNumber(s.w) || s.w <= 0) s.w = s.h > 0 ? s.h : 1;
    if (!isFiniteNumber(s.h) || s.h <= 0) s.h = s.w;
    if (s.kind === 'circle') s.h = s.w;

    var maxCorner = Math.min(s.w, s.h) / 2;
    s.corner = Math.max(0, Math.min(isFiniteNumber(s.corner) ? s.corner : 0, maxCorner));
    if (s.kind === 'rect') s.corner = 0;
    if (s.kind === 'roundrect' && s.corner <= 0) s.corner = Math.min(s.w, s.h) / 4;
    if (s.kind === 'oblong') s.corner = Math.min(s.w, s.h) / 2;
    if (s.kind === 'circle') s.corner = s.w / 2;
    return s;
  }

  function normalizeShape(shape, fallbackDiameter) {
    var d = isFiniteNumber(fallbackDiameter) ? fallbackDiameter : 0;
    var s = { kind: 'circle', w: d, h: d, corner: 0, rot: 0 };

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
      var kind = String(shape.kind || shape.shape || 'circle').toLowerCase();
      var w = num(shape.w != null ? shape.w : (shape.width != null ? shape.width : shape.diameter), d);
      var h = num(shape.h != null ? shape.h : (shape.height != null ? shape.height : shape.diameter), w);
      s.kind = kind;
      s.w = w;
      s.h = h;
      s.corner = num(shape.corner != null ? shape.corner : shape.r, 0);
      s.rot = num(shape.rot != null ? shape.rot : shape.rotation, 0);
      return finalize(s);
    }
    return finalize(s);
  }

  function regionOf(shape, fallbackDiameter) {
    var s = normalizeShape(shape, fallbackDiameter);
    var rad = (s.rot || 0) * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var rotate = function (x, y) { return [x * cos - y * sin, x * sin + y * cos]; };

    var poly = [];
    var round = 0;

    if (s.kind === 'circle') {
      poly = [[0, 0]];
      round = s.w / 2;
    } else if (s.kind === 'oblong') {
      var half = Math.abs(s.w - s.h) / 2;
      var longX = s.w >= s.h;
      var ax = longX ? half : 0;
      var ay = longX ? 0 : half;
      poly = [rotate(-ax, -ay), rotate(ax, ay)];
      round = Math.min(s.w, s.h) / 2;
    } else if (s.kind === 'roundrect') {
      var ix = Math.max(0, s.w / 2 - s.corner);
      var iy = Math.max(0, s.h / 2 - s.corner);
      poly = [rotate(-ix, -iy), rotate(ix, -iy), rotate(ix, iy), rotate(-ix, iy)];
      round = s.corner;
    } else {
      var hx = s.w / 2, hy = s.h / 2;
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
      poly: region.poly.map(function (p) { return [p[0] + cx, p[1] + cy]; })
    };
  }

  function isCircleRegion(region) {
    return region.poly.length === 1 && region.round > 0;
  }

  function circleRegion(center, radius) {
    return {
      kind: 'circle',
      round: radius,
      poly: [[center[0], center[1]]],
      shape: { kind: 'circle', w: radius * 2, h: radius * 2, corner: radius, rot: 0 }
    };
  }

  function signedRegionDist(A, B) {
    return signedPolyDist(A.poly, B.poly) - A.round - B.round;
  }

  function regionDist(A, B) {
    return Math.max(0, signedRegionDist(A, B));
  }

  function signedPointRegionDist(p, region) {
    return signedPolyDist([p], region.poly) - region.round;
  }

  function signedSegmentRegionDist(a, b, region) {
    return signedPolyDist([a, b], region.poly) - region.round;
  }

  function arcSpan(center, p1, p2, direction) {
    var ang1 = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
    var ang2 = Math.atan2(p2[1] - center[1], p2[0] - center[0]);
    var TWO_PI = 2 * Math.PI;
    var span = direction === 'CW' ? ((ang1 - ang2) % TWO_PI) : ((ang2 - ang1) % TWO_PI);
    if (span <= 0) span += TWO_PI;
    return span;
  }

  function arcPoint(center, radius, ang) {
    return [center[0] + radius * Math.cos(ang), center[1] + radius * Math.sin(ang)];
  }

  function goldenSection(f, lo, hi, iters) {
    var invphi = (Math.sqrt(5) - 1) / 2;
    var a = lo, b = hi;
    var x1 = b - invphi * (b - a);
    var x2 = a + invphi * (b - a);
    var f1 = f(x1), f2 = f(x2);
    for (var i = 0; i < iters; i++) {
      if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = b - invphi * (b - a); f1 = f(x1); }
      else { a = x1; x1 = x2; f1 = f2; x2 = a + invphi * (b - a); f2 = f(x2); }
    }
    var t = (a + b) / 2;
    return { t: t, value: f(t) };
  }

  function signedArcRegionDist(center, radius, p1, p2, direction, region, halfWidth) {
    var ang1 = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
    var span = arcSpan(center, p1, p2, direction);
    var sign = direction === 'CW' ? -1 : 1;

    var f = function (t) {
      return signedPointRegionDist(arcPoint(center, radius, ang1 + sign * t), region);
    };

    var N = Math.max(8, Math.min(512, Math.ceil(span / (Math.PI / 180))));
    var bestT = 0, bestV = Infinity;
    for (var i = 0; i <= N; i++) {
      var t = span * i / N;
      var v = f(t);
      if (v < bestV) { bestV = v; bestT = t; }
    }

    var lo = Math.max(0, bestT - span / N);
    var hi = Math.min(span, bestT + span / N);
    var refined = goldenSection(f, lo, hi, 80);
    var rawDist = Math.min(bestV, refined.value);

    return rawDist - halfWidth;
  }

  function closestPointOnArcToRegion(center, radius, p1, p2, direction, region) {
    var ang1 = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
    var span = arcSpan(center, p1, p2, direction);
    var sign = direction === 'CW' ? -1 : 1;
    var f = function (t) {
      return signedPointRegionDist(arcPoint(center, radius, ang1 + sign * t), region);
    };
    var res = goldenSection(f, 0, span, 80);
    return arcPoint(center, radius, ang1 + sign * res.t);
  }

  return {
    normalizeShape: normalizeShape,
    regionOf: regionOf,
    translateRegion: translateRegion,
    circleRegion: circleRegion,
    isCircleRegion: isCircleRegion,
    signedRegionDist: signedRegionDist,
    regionDist: regionDist,
    signedPointRegionDist: signedPointRegionDist,
    signedSegmentRegionDist: signedSegmentRegionDist,
    signedArcRegionDist: signedArcRegionDist,
    closestPointOnArcToRegion: closestPointOnArcToRegion,
    arcSpan: arcSpan
  };
});
