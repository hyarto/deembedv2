/* ============================================================================
 * pad-primitives.js —— 基础 2D 几何与凸多边形分离轴/穿透有符号求距原语
 * 无 DOM 依赖，同时支持浏览器全局挂载与 Node CommonJS
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.PadGeom = Object.assign(root.PadGeom || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EPS = 1e-12;

  function dist2D(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
  }

  function orient(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }

  function onSegment(a, b, p) {
    return Math.min(a[0], b[0]) - EPS <= p[0] && p[0] <= Math.max(a[0], b[0]) + EPS &&
           Math.min(a[1], b[1]) - EPS <= p[1] && p[1] <= Math.max(a[1], b[1]) + EPS;
  }

  function segmentsIntersect(a, b, c, d) {
    var o1 = orient(a, b, c), o2 = orient(a, b, d);
    var o3 = orient(c, d, a), o4 = orient(c, d, b);
    if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
        ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
    if (Math.abs(o1) <= EPS && onSegment(a, b, c)) return true;
    if (Math.abs(o2) <= EPS && onSegment(a, b, d)) return true;
    if (Math.abs(o3) <= EPS && onSegment(c, d, a)) return true;
    if (Math.abs(o4) <= EPS && onSegment(c, d, b)) return true;
    return false;
  }

  function pointSegDist(p, a, b) {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var l2 = dx * dx + dy * dy;
    if (l2 <= EPS) return dist2D(p[0], p[1], a[0], a[1]);
    var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return dist2D(p[0], p[1], a[0] + t * dx, a[1] + t * dy);
  }

  function segSegDist(a, b, c, d) {
    if (segmentsIntersect(a, b, c, d)) return 0;
    return Math.min(
      pointSegDist(a, c, d),
      pointSegDist(b, c, d),
      pointSegDist(c, a, b),
      pointSegDist(d, a, b)
    );
  }

  function edgesOf(poly) {
    var n = poly.length;
    if (n === 1) return [];
    if (n === 2) return [[poly[0], poly[1]]];
    var out = [];
    for (var i = 0; i < n; i++) out.push([poly[i], poly[(i + 1) % n]]);
    return out;
  }

  function hasArea(poly) {
    if (poly.length < 3) return false;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
      if (Math.abs(orient(a, b, c)) > 1e-9) return true;
    }
    return false;
  }

  function pointPolyDist(p, poly) {
    if (poly.length === 1) return dist2D(p[0], p[1], poly[0][0], poly[0][1]);
    var min = Infinity;
    var edges = edgesOf(poly);
    for (var i = 0; i < edges.length; i++) {
      var d = pointSegDist(p, edges[i][0], edges[i][1]);
      if (d < min) min = d;
    }
    return min;
  }

  function projectRange(P, ux, uy) {
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < P.length; i++) {
      var v = P[i][0] * ux + P[i][1] * uy;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { min: min, max: max };
  }

  function hasSeparatingAxis(P, Q) {
    var n = P.length;
    for (var i = 0; i < n; i++) {
      var a = P[i], b = P[(i + 1) % n];
      var nx = -(b[1] - a[1]), ny = b[0] - a[0];
      var len = Math.hypot(nx, ny);
      if (len <= EPS) continue;
      var ux = nx / len, uy = ny / len;
      var p = projectRange(P, ux, uy);
      var q = projectRange(Q, ux, uy);
      if (p.max < q.min - 1e-9 || q.max < p.min - 1e-9) return true;
    }
    return false;
  }

  function polygonsOverlap(A, B) {
    if (!hasArea(A) || !hasArea(B)) return false;
    return !hasSeparatingAxis(A, B) && !hasSeparatingAxis(B, A);
  }

  function penetrationDepth(A, B) {
    var minOverlap = Infinity;
    function scan(P, Q) {
      var n = P.length;
      for (var i = 0; i < n; i++) {
        var a = P[i], b = P[(i + 1) % n];
        var nx = -(b[1] - a[1]), ny = b[0] - a[0];
        var len = Math.hypot(nx, ny);
        if (len <= EPS) continue;
        var ux = nx / len, uy = ny / len;
        var p = projectRange(P, ux, uy);
        var q = projectRange(Q, ux, uy);
        var overlap = Math.min(p.max, q.max) - Math.max(p.min, q.min);
        if (overlap < minOverlap) minOverlap = overlap;
      }
    }
    scan(A, B);
    scan(B, A);
    return minOverlap === Infinity ? 0 : Math.max(0, minOverlap);
  }

  function pointInConvex(p, poly, tol) {
    if (poly.length < 3 || !hasArea(poly)) return false;
    var eps = tol == null ? 1e-9 : tol;
    var sign = 0;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      var o = orient(a, b, p);
      var len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      if (Math.abs(o) / len <= eps) continue;
      var s = o > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  }

  function insideDepthOfPoint(p, poly) {
    if (!pointInConvex(p, poly, 1e-9)) return 0;
    return pointPolyDist(p, poly);
  }

  function minEdgePairDist(A, B) {
    var min = Infinity;
    var eA = edgesOf(A), eB = edgesOf(B);
    for (var i = 0; i < eA.length; i++) {
      for (var j = 0; j < eB.length; j++) {
        var d = segSegDist(eA[i][0], eA[i][1], eB[j][0], eB[j][1]);
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

  function signedPolyDist(A, B) {
    var aArea = hasArea(A), bArea = hasArea(B);
    if (aArea && bArea) {
      if (polygonsOverlap(A, B)) return -penetrationDepth(A, B);
      return minEdgePairDist(A, B);
    }

    var d = minEdgePairDist(A, B);
    var depth = 0;
    function probe(pts, poly) {
      if (!hasArea(poly)) return;
      for (var i = 0; i < pts.length; i++) {
        var dd = insideDepthOfPoint(pts[i], poly);
        if (dd > depth) depth = dd;
      }
    }
    probe(A, B);
    probe(B, A);

    if (depth === 0 && d === 0) {
      var seg = A.length === 2 ? A : (B.length === 2 ? B : null);
      var poly = seg === A ? B : A;
      if (seg && hasArea(poly)) {
        var STEPS = 16;
        for (var k = 0; k <= STEPS; k++) {
          var t = k / STEPS;
          var p = [seg[0][0] + (seg[1][0] - seg[0][0]) * t, seg[0][1] + (seg[1][1] - seg[0][1]) * t];
          var dd = insideDepthOfPoint(p, poly);
          if (dd > depth) depth = dd;
        }
      }
    }

    if (depth > 0) return -depth;
    if (d === 0) return -1e-6;
    return d;
  }

  return {
    dist2D: dist2D,
    segSegDist: segSegDist,
    pointSegDist: pointSegDist,
    segmentsIntersect: segmentsIntersect,
    pointPolyDist: pointPolyDist,
    pointInConvex: pointInConvex,
    insideDepthOfPoint: insideDepthOfPoint,
    polygonsOverlap: polygonsOverlap,
    penetrationDepth: penetrationDepth,
    signedPolyDist: signedPolyDist
  };
});
