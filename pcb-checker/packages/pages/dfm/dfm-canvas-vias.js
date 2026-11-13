/* ============================================================================
 * dfm-canvas-vias.js —— DFM 2D 视口：过孔绘制
 * 全板总览时（焊盘屏幕半径 < 4.5 px）用 2 px 方点代替多层圆弧，避免数万次 path 操作；
 * 从孔到孔明细定位过来的 GND / 信号孔对用黄色粗圈与「孔到孔 Via N」标注。
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var App = root.DfmApp;
  var LOD_PAD_RADIUS_PX = 4.5;
  var LOCATE_COLOR = '#facc15';

  function viaColors(v, isSelected) {
    var span = v.viaSpanType;
    return {
      dash: isSelected ? '#38bdf8' : (span === 'buried' ? 'rgba(192,132,252,0.85)' : (span === 'blind' ? 'rgba(56,189,248,0.85)' : (v.isGnd ? 'rgba(148,163,184,0.45)' : 'rgba(239,68,68,0.7)'))),
      edge: isSelected ? '#38bdf8' : (v.isGnd ? '#64748b' : '#f87171'),
      fill: v.isGnd ? '#334155' : '#ef4444'
    };
  }

  function isLocatedVia(pair, v) {
    return !!(pair && (v.id === pair.gndViaId || v.id === pair.sigViaId));
  }

  /** 定位孔对高亮圈与标注；ringR 为圈半径，dx / dy 为文字相对圆心偏移。 */
  function drawLocateMark(ctx, p, ringR, labelDx, labelDy, id) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = LOCATE_COLOR; ctx.lineWidth = 3; ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(p[0], p[1], ringR, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillStyle = LOCATE_COLOR; ctx.font = 'bold 12px ui-monospace, sans-serif';
    ctx.fillText('孔到孔 Via ' + id, p[0] + labelDx, p[1] + labelDy);
  }

  function drawOverviewDot(ctx, v, p, st) {
    ctx.globalAlpha = st.spansActiveLayer ? 1 : 0.22;
    ctx.fillStyle = st.isSelected ? '#38bdf8' : (v.isGnd ? '#64748b' : '#ef4444');
    ctx.fillRect(p[0] - 1, p[1] - 1, 2, 2);
    if (st.located) drawLocateMark(ctx, p, 8, 10, -8, v.id);
    ctx.globalAlpha = 1;
  }

  function drawFullVia(ctx, v, p, st, o) {
    var vp = o.vp;
    var isBlindOrBuried = v.viaSpanType === 'blind' || v.viaSpanType === 'buried';
    var colors = viaColors(v, st.isSelected);
    var finishDrillR = Math.max(1.5, (v.drill / 2.0) * vp.zoom);
    var firstDrillR = Math.max(2.0, v.firstDrillRadius * vp.zoom);
    ctx.save();
    if (!st.spansActiveLayer) ctx.globalAlpha = 0.22;

    ctx.strokeStyle = colors.dash;
    ctx.lineWidth = st.isSelected ? 2 : (isBlindOrBuried ? 1.4 : 1);
    ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.arc(p[0], p[1], st.padR, 0, 2 * Math.PI); ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p[0], p[1], firstDrillR, 0, 2 * Math.PI); ctx.stroke();

    ctx.fillStyle = colors.fill;
    ctx.beginPath(); ctx.arc(p[0], p[1], finishDrillR, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = colors.edge;
    ctx.stroke();

    if (o.showLabels && vp.zoom > 1.2) {
      ctx.fillStyle = isBlindOrBuried ? '#e9d5ff' : '#cbd5e1';
      ctx.font = '10px ui-monospace, sans-serif';
      ctx.fillText('V' + v.id + (isBlindOrBuried && v.spanShort ? '[' + v.spanShort + ']' : ''), p[0] + st.padR + 2, p[1] - 2);
    }
    if (st.located) drawLocateMark(ctx, p, st.padR + 7, st.padR + 10, -6, v.id);
    ctx.restore();
  }

  /**
   * o: { vias, vp, bounds:{minX,maxX,minY,maxY}, worldToScreen, showLabels,
   *      activeLayerFocus, measureSelection, locatedPair }
   */
  function draw(ctx, o) {
    var b = o.bounds, vp = o.vp;
    o.vias.forEach(function (v) {
      var vx = v.origin[0], vy = v.origin[1];
      if (vx + v.padRadius < b.minX || vx - v.padRadius > b.maxX || vy + v.padRadius < b.minY || vy - v.padRadius > b.maxY) return;
      var p = o.worldToScreen(vx, vy);
      var st = {
        padR: Math.max(2.8, v.padRadius * vp.zoom),
        spansActiveLayer: !o.activeLayerFocus || root.DfmCheck.doesViaSpanLayer(v, o.activeLayerFocus),
        isSelected: o.measureSelection.some(function (s) { return s.type === 'via' && s.item.id === v.id; }),
        located: isLocatedVia(o.locatedPair, v)
      };
      if (st.padR < LOD_PAD_RADIUS_PX) drawOverviewDot(ctx, v, p, st);
      else drawFullVia(ctx, v, p, st, o);
    });
  }

  App.CanvasVias = { draw: draw, LOD_PAD_RADIUS_PX: LOD_PAD_RADIUS_PX };
  root.DfmCanvasVias = App.CanvasVias;
})(typeof window !== 'undefined' ? window : globalThis);
