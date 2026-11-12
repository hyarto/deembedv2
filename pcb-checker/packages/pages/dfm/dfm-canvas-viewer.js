/* ============================================================================
 * dfm-canvas-viewer.js —— DFM 2D 空间几何视口、交互式标尺测量、定位复核与 PNG/SVG 导出
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var App = root.DfmApp;
  var $ = App.$;
  var escHtml = App.escHtml;
  var State = App.State;
  var NET_COLORS = App.NET_COLORS;

  var canvas = $('pcbCanvas');
  var ctx = (canvas && canvas.getContext) ? canvas.getContext('2d') : null;

  function worldToScreen(wx, wy) {
    var vp = State.viewport;
    var ch = canvas ? canvas.height : 620;
    return [wx * vp.zoom + vp.panX, ch - (wy * vp.zoom + vp.panY)];
  }

  function screenToWorld(sx, sy) {
    var vp = State.viewport;
    var ch = canvas ? canvas.height : 620;
    return [(sx - vp.panX) / vp.zoom, (ch - sy - vp.panY) / vp.zoom];
  }

  function fitCanvasView() {
    if (!canvas) return;
    var vp = State.viewport;
    var w = canvas.width, h = canvas.height;
    var dataW = vp.maxX - vp.minX;
    var dataH = vp.maxY - vp.minY;
    if (dataW <= 0 || dataH <= 0) return;
    vp.zoom = Math.min((w - 120) / dataW, (h - 120) / dataH);
    vp.panX = (w - dataW * vp.zoom) / 2 - vp.minX * vp.zoom;
    vp.panY = (h - dataH * vp.zoom) / 2 - vp.minY * vp.zoom;
    renderCanvas();
  }

  function zoomToDefects() {
    if (!canvas) return;
    if (!State.checkResult) return fitCanvasView();
    var fails = State.checkResult.pairs.filter(function (p) { return p.status === '不满足'; });
    if (!fails.length) return fitCanvasView();

    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    fails.forEach(function (p) {
      minX = Math.min(minX, p.via.origin[0], p.proj[0]);
      maxX = Math.max(maxX, p.via.origin[0], p.proj[0]);
      minY = Math.min(minY, p.via.origin[1], p.proj[1]);
      maxY = Math.max(maxY, p.via.origin[1], p.proj[1]);
    });
    var pad = Math.max(40, (maxX - minX) * 0.35);
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    var w = canvas.width, h = canvas.height;
    var dataW = maxX - minX, dataH = maxY - minY;
    var vp = State.viewport;
    vp.zoom = Math.min((w - 80) / dataW, (h - 80) / dataH);
    vp.panX = (w - dataW * vp.zoom) / 2 - minX * vp.zoom;
    vp.panY = (h - dataH * vp.zoom) / 2 - minY * vp.zoom;
    renderCanvas();
  }

  function showMeasureCardViaToVia(m) {
    var card = $('measureCard');
    if (!card) return;
    card.style.display = 'block';
    $('measureCardBody').innerHTML =
      '<div style="font-size:12px;margin-bottom:6px"><b>测量对象：</b>Via ' + m.v1.id + ' · ' + escHtml(m.v1.net) + ' ↔ Via ' + m.v2.id + ' · ' + escHtml(m.v2.net) + '</div>' +
      '<div class="m-row"><span>孔中心到中心距：</span><b>' + m.centerDist.toFixed(3) + ' mil</b></div>' +
      '<div class="m-row"><span>孔盘到孔盘 Airgap：</span><b style="color:#38bdf8">' + m.padAirgap.toFixed(3) + ' mil</b></div>' +
      '<div class="m-row"><span>孔盘到一钻孔壁 Airgap：</span><b>' + m.padToDrillAirgap.toFixed(3) + ' mil</b></div>' +
      '<div class="m-row"><span>一钻孔壁到孔壁 Airgap：</span><b>' + m.drillAirgap.toFixed(3) + ' mil</b></div>';
  }

  function showMeasureCardTraceToVia(m) {
    var card = $('measureCard');
    if (!card) return;
    card.style.display = 'block';
    var spanNotice = m.spansTraceLayer === false
      ? ('<div style="background:rgba(14,165,233,0.18);border:1px solid rgba(56,189,248,0.45);border-radius:5px;padding:5px 7px;margin-bottom:6px;font-size:11px;color:#e3e8ef">' +
         '非同穿层：Via ' + m.via.id + ' 未穿过走线层 <b>' + escHtml(m.trace.subset) + '</b>，自动检查已跳过。</div>')
      : ('<div style="background:rgba(16,185,129,0.14);border:1px solid rgba(52,211,153,0.4);border-radius:5px;padding:4px 7px;margin-bottom:6px;font-size:11px;color:#6ee7b7">' +
         '穿层有效：' + escHtml(m.via.spanLabel || '通孔') + ' 穿过 <b>' + escHtml(m.trace.subset) + '</b></div>');
    $('measureCardBody').innerHTML =
      '<div style="font-size:12px;margin-bottom:6px"><b>测量对象：</b>Via ' + m.via.id + ' · ' + escHtml(m.via.net) + ' ↔ Trace ' + m.trace.id + ' · ' + escHtml(m.trace.subset) + '</div>' +
      spanNotice +
      '<div class="m-row"><span>孔中心到走线中心距：</span><b>' + m.centerDist.toFixed(3) + ' mil</b></div>' +
      '<div class="m-row"><span>孔盘到走线边缘 Airgap：</span><b style="color:#38bdf8">' + m.padAirgap.toFixed(3) + ' mil</b></div>' +
      '<div class="m-row"><span>一钻孔壁到走线边缘 Airgap：</span><b>' + m.drillAirgap.toFixed(3) + ' mil</b></div>' +
      '<div class="m-row"><span>走线最近点坐标：</span><b>[' + m.proj[0].toFixed(2) + ', ' + m.proj[1].toFixed(2) + ']</b></div>';
  }

  function updateMeasurements() {
    var sel = State.measureSelection;
    if (sel.length < 2) return;
    var s1 = sel[0], s2 = sel[1];
    if (s1.type === 'via' && s2.type === 'via') {
      showMeasureCardViaToVia(root.DfmCheck.calcViaToViaMetrics(s1.item, s2.item));
    } else if ((s1.type === 'via' && s2.type === 'trace') || (s1.type === 'trace' && s2.type === 'via')) {
      var via = s1.type === 'via' ? s1.item : s2.item;
      var trace = s1.type === 'trace' ? s1.item : s2.item;
      showMeasureCardTraceToVia(root.DfmCheck.calcTraceToViaMetrics(via, trace));
    }
  }

  function drawMeasurementOverlay() {
    var sel = State.measureSelection;
    if (sel.length < 2 || !ctx) return;
    updateMeasurements();
    var s1 = sel[0], s2 = sel[1];
    var pt1, pt2;
    if (s1.type === 'via' && s2.type === 'via') {
      pt1 = worldToScreen(s1.item.origin[0], s1.item.origin[1]);
      pt2 = worldToScreen(s2.item.origin[0], s2.item.origin[1]);
    } else if ((s1.type === 'via' && s2.type === 'trace') || (s1.type === 'trace' && s2.type === 'via')) {
      var via = s1.type === 'via' ? s1.item : s2.item;
      var trace = s1.type === 'trace' ? s1.item : s2.item;
      var metrics = root.DfmCheck.calcTraceToViaMetrics(via, trace);
      pt1 = worldToScreen(via.origin[0], via.origin[1]);
      pt2 = worldToScreen(metrics.proj[0], metrics.proj[1]);
    }
    if (pt1 && pt2) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 2]);
      ctx.beginPath();
      ctx.moveTo(pt1[0], pt1[1]);
      ctx.lineTo(pt2[0], pt2[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      [pt1, pt2].forEach(function (p) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 4, 0, 2 * Math.PI);
        ctx.stroke();
      });
    }
  }

  function renderCanvas() {
    if ($('canvasHud')) {
      $('canvasHud').textContent = '缩放: ' + (State.viewport.zoom * 100).toFixed(0) + '% | 过孔: ' +
        State.vias.length.toLocaleString() + ' | 走线: ' + State.traces.length.toLocaleString() +
        (State.measureMode ? ' | 标尺测量已开启' : '');
    }
    if (!canvas || !ctx) return;
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    var vp = State.viewport;
    var showVias = $('ckShowVias') ? $('ckShowVias').checked : true;
    var showTraces = $('ckShowTraces') ? $('ckShowTraces').checked : true;
    var showDefects = $('ckShowDefects') ? $('ckShowDefects').checked : true;
    var showLabels = $('ckShowLabels') ? $('ckShowLabels').checked : true;
    var showGrid = $('ckShowGrid') ? $('ckShowGrid').checked : true;

    var wA = screenToWorld(0, 0), wB = screenToWorld(w, h);
    var margin = 30 / vp.zoom;
    var vMinX = Math.min(wA[0], wB[0]) - margin, vMaxX = Math.max(wA[0], wB[0]) + margin;
    var vMinY = Math.min(wA[1], wB[1]) - margin, vMaxY = Math.max(wA[1], wB[1]) + margin;

    if (showGrid) {
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1;
      var gridStep = Math.pow(10, Math.floor(Math.log10(100 / vp.zoom)));
      var startW = screenToWorld(0, h), endW = screenToWorld(w, 0);
      ctx.beginPath();
      for (var gx = Math.floor(startW[0] / gridStep) * gridStep; gx <= endW[0]; gx += gridStep) {
        var sx = worldToScreen(gx, 0)[0];
        ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
      }
      for (var gy = Math.floor(startW[1] / gridStep) * gridStep; gy <= endW[1]; gy += gridStep) {
        var sy = worldToScreen(0, gy)[1];
        ctx.moveTo(0, sy); ctx.lineTo(w, sy);
      }
      ctx.stroke();
    }

    if (showTraces) {
      State.traces.forEach(function (t) {
        var tMinX = t.kind === 'line' ? Math.min(t.p1[0], t.p2[0]) : (t.center[0] - t.radius);
        var tMaxX = t.kind === 'line' ? Math.max(t.p1[0], t.p2[0]) : (t.center[0] + t.radius);
        var tMinY = t.kind === 'line' ? Math.min(t.p1[1], t.p2[1]) : (t.center[1] - t.radius);
        var tMaxY = t.kind === 'line' ? Math.max(t.p1[1], t.p2[1]) : (t.center[1] + t.radius);
        if (tMaxX < vMinX || tMinX > vMaxX || tMaxY < vMinY || tMinY > vMaxY) return;

        var col = NET_COLORS[t.net] || '#94a3b8';
        var isSelected = State.measureSelection.some(function (s) { return s.type === 'trace' && s.item.id === t.id; });
        var isRouteMatch = State.highlightNetRoute && (State.highlightNetRoute.layer === t.subset && State.highlightNetRoute.net === t.net);

        var drawSeg = function (strokeCol, lw) {
          ctx.strokeStyle = strokeCol;
          ctx.lineWidth = lw;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          if (t.kind === 'line') {
            var p1 = worldToScreen(t.p1[0], t.p1[1]);
            var p2 = worldToScreen(t.p2[0], t.p2[1]);
            ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
          } else {
            var steps = vp.zoom < 0.5 ? 12 : (vp.zoom < 2.0 ? 20 : 32);
            var pts = root.DfmCheck.sampleArcPoints(t.center, t.radius, t.p1, t.p2, t.dir, steps);
            ctx.beginPath();
            pts.forEach(function (pt, i) {
              var sPt = worldToScreen(pt[0], pt[1]);
              if (i === 0) ctx.moveTo(sPt[0], sPt[1]); else ctx.lineTo(sPt[0], sPt[1]);
            });
            ctx.stroke();
          }
        };

        if (isRouteMatch) drawSeg('#38bdf8', Math.max(4.0, t.width * vp.zoom + 6.0));
        drawSeg(isSelected ? '#38bdf8' : col, Math.max(1.8, t.width * vp.zoom));
      });
    }

    if (showVias) {
      var activeLayerFocus = (State.highlightNetRoute && State.highlightNetRoute.layer) || ($('selLayerFilter') ? $('selLayerFilter').value : '');
      State.vias.forEach(function (v) {
        var vx = v.origin[0], vy = v.origin[1];
        if (vx + v.padRadius < vMinX || vx - v.padRadius > vMaxX || vy + v.padRadius < vMinY || vy - v.padRadius > vMaxY) return;
        var spansActiveLayer = !activeLayerFocus || root.DfmCheck.doesViaSpanLayer(v, activeLayerFocus);
        var isBlindOrBuried = v.viaSpanType === 'blind' || v.viaSpanType === 'buried';
        ctx.save();
        if (!spansActiveLayer) ctx.globalAlpha = 0.22;
        var p = worldToScreen(vx, vy);
        var finishDrillR = Math.max(1.5, (v.drill / 2.0) * vp.zoom);
        var firstDrillR = Math.max(2.0, v.firstDrillRadius * vp.zoom);
        var padR = Math.max(2.8, v.padRadius * vp.zoom);
        var isSelected = State.measureSelection.some(function (s) { return s.type === 'via' && s.item.id === v.id; });

        ctx.strokeStyle = isSelected ? '#38bdf8' : (v.viaSpanType === 'buried' ? 'rgba(192,132,252,0.85)' : (v.viaSpanType === 'blind' ? 'rgba(56,189,248,0.85)' : (v.isGnd ? 'rgba(148,163,184,0.45)' : 'rgba(239,68,68,0.7)')));
        ctx.lineWidth = isSelected ? 2 : (isBlindOrBuried ? 1.4 : 1);
        ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.arc(p[0], p[1], padR, 0, 2 * Math.PI); ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p[0], p[1], firstDrillR, 0, 2 * Math.PI); ctx.stroke();

        ctx.fillStyle = v.isGnd ? '#334155' : '#ef4444';
        ctx.beginPath(); ctx.arc(p[0], p[1], finishDrillR, 0, 2 * Math.PI); ctx.fill();
        ctx.strokeStyle = isSelected ? '#38bdf8' : (v.isGnd ? '#64748b' : '#f87171');
        ctx.stroke();

        if (showLabels && vp.zoom > 1.2) {
          ctx.fillStyle = isBlindOrBuried ? '#e9d5ff' : '#cbd5e1';
          ctx.font = '10px ui-monospace, sans-serif';
          ctx.fillText('V' + v.id + (isBlindOrBuried && v.spanShort ? '[' + v.spanShort + ']' : ''), p[0] + padR + 2, p[1] - 2);
        }
        ctx.restore();
      });
    }

    if (showDefects && State.checkResult) {
      var fails = State.checkResult.defectPairs || State.checkResult.pairs.filter(function (p) { return p.status === '不满足'; });
      fails.forEach(function (p) {
        var vx = p.via.origin[0], vy = p.via.origin[1];
        if (vx + 50 < vMinX || vx - 50 > vMaxX || vy + 50 < vMinY || vy - 50 > vMaxY) return;
        var vPt = worldToScreen(vx, vy);
        var tPt = worldToScreen(p.proj[0], p.proj[1]);

        ctx.strokeStyle = 'rgba(239,68,68,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(vPt[0], vPt[1], (p.via.padRadius * vp.zoom) + 4, 0, 2 * Math.PI); ctx.stroke();

        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(vPt[0], vPt[1]); ctx.lineTo(tPt[0], tPt[1]); ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#ef4444';
        ctx.beginPath(); ctx.arc(tPt[0], tPt[1], 3, 0, 2 * Math.PI); ctx.fill();

        if (showLabels && vp.zoom > 0.8) {
          var midX = (vPt[0] + tPt[0]) / 2, midY = (vPt[1] + tPt[1]) / 2;
          var txt = ' ' + p.evalDist.toFixed(2) + ' mil';
          ctx.font = 'bold 10px ui-monospace, sans-serif';
          var txtW = ctx.measureText(txt).width;
          ctx.fillStyle = 'rgba(220,38,38,0.9)';
          ctx.fillRect(midX - txtW / 2 - 4, midY - 8, txtW + 8, 16);
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(txt, midX, midY);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
        }
      });
    }

    if (State.measureSelection.length >= 2) drawMeasurementOverlay();
  }

  function renderDfmSpatialReviewCard(viaId, traceId) {
    var card = $('dfmSpatialReviewCard');
    var titleEl = $('dfmSpatialRevTitle');
    var bodyEl = $('dfmSpatialRevBody');
    if (!card || !bodyEl) return;

    State.activeLocatedPair = { viaId: viaId, traceId: traceId };
    var pKey = viaId + '_' + traceId;
    var isRev = !!State.reviewedKeys[pKey];
    var pairs = (State.checkResult && State.checkResult.allPairs) ? State.checkResult.allPairs : [];
    var p = pairs.find(function (item) { return item.via.id === viaId && item.trace.id === traceId; });

    if (titleEl) titleEl.textContent = 'Via ' + viaId + ' ↔ Trace ' + traceId + ' 复核';
    var barStyle = isRev
      ? 'background:rgba(16,185,129,.18);border:1px solid rgba(52,211,153,.55);'
      : 'background:rgba(245,158,11,.15);border:1px solid rgba(251,191,36,.45);';

    bodyEl.innerHTML =
      '<div style="' + barStyle + 'border-radius:6px;padding:7px 9px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:8px">' +
        '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:700;color:' + (isRev ? '#6ee7b7' : '#fde68a') + ';margin:0">' +
          '<input type="checkbox" id="chkDfmSpatialReview" data-no-persist ' + (isRev ? 'checked' : '') + ' onchange="toggleDfmPairReview(\'' + pKey + '\', this.checked)" style="width:15px;height:15px;cursor:pointer">' +
          '<span>' + (isRev ? '已复核' : '勾选复核此项') + '</span></label>' +
        '<button type="button" class="btn small" onclick="toggleDfmPairReview(\'' + pKey + '\', ' + (!isRev) + ')" style="padding:3px 8px;font-size:11px;background:' + (isRev ? '#334155' : '#10b981') + ';color:#fff">' +
          (isRev ? '取消复核' : '确认复核') + '</button></div>' +
      (p ? ('<div style="font-size:11px;color:#cbd5e1;line-height:1.5;margin-bottom:8px">' +
        '<div>走线: <strong>' + escHtml(p.trace.net) + '</strong> · ' + escHtml(p.trace.subset) + ' | 过孔: <strong>Via ' + p.via.id + '</strong> · ' + escHtml(p.via.net) + '</div>' +
        '<div>实测: <strong style="color:' + (p.status === '不满足' ? '#f87171' : '#4ade80') + ';font-family:var(--mono)">' + p.evalDist.toFixed(2) + ' mil</strong> · 阈值 ≥ ' + p.threshold.toFixed(2) + ' mil</div></div>') : '') +
      '<div style="display:flex;justify-content:flex-end"><button type="button" class="btn sec small" onclick="document.querySelector(\'nav#tabs button[data-tab=result]\').click()">返回结果明细</button></div>';
    card.style.display = 'block';
  }

  function toggleDfmPairReview(pKey, checked) {
    State.reviewedKeys[pKey] = checked !== undefined ? Boolean(checked) : !State.reviewedKeys[pKey];
    if (root.renderResults) root.renderResults();
    if (root.renderNetGroupView) root.renderNetGroupView();
    if (State.activeLocatedPair) renderDfmSpatialReviewCard(State.activeLocatedPair.viaId, State.activeLocatedPair.traceId);
    renderCanvas();
  }

  function locateInCanvas(viaId, traceId) {
    State.highlightNetRoute = null;
    var tabBtn = document.querySelector('nav#tabs button[data-tab="canvas"]');
    if (tabBtn) tabBtn.click();
    var via = State.vias.find(function (v) { return v.id === viaId; });
    if (!via || !canvas) return;
    var vp = State.viewport;
    vp.zoom = 8.0;
    vp.panX = canvas.width / 2 - via.origin[0] * vp.zoom;
    vp.panY = canvas.height / 2 - via.origin[1] * vp.zoom;
    renderDfmSpatialReviewCard(viaId, traceId);
    renderCanvas();
  }

  function locateNetRoute(layer, net) {
    State.highlightNetRoute = { layer: layer, net: net };
    var traces = State.traces.filter(function (t) { return t.subset === layer && t.net === net; });
    if (!traces.length) return;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    traces.forEach(function (t) {
      minX = Math.min(minX, t.p1[0], t.p2[0]); maxX = Math.max(maxX, t.p1[0], t.p2[0]);
      minY = Math.min(minY, t.p1[1], t.p2[1]); maxY = Math.max(maxY, t.p1[1], t.p2[1]);
    });
    if (State.checkResult && State.checkResult.defectPairs) {
      State.checkResult.defectPairs.forEach(function (p) {
        if (p.trace.subset === layer && p.trace.net === net) {
          minX = Math.min(minX, p.via.origin[0]); maxX = Math.max(maxX, p.via.origin[0]);
          minY = Math.min(minY, p.via.origin[1]); maxY = Math.max(maxY, p.via.origin[1]);
        }
      });
    }
    var pad = Math.max(40, (maxX - minX) * 0.2);
    State.viewport.minX = minX - pad; State.viewport.maxX = maxX + pad;
    State.viewport.minY = minY - pad; State.viewport.maxY = maxY + pad;
    var tabBtn = document.querySelector('nav#tabs button[data-tab="canvas"]');
    if (tabBtn) tabBtn.click();
    fitCanvasView();
  }

  function bindCanvasEvents() {
    if ($('btnMeasureMode')) {
      $('btnMeasureMode').addEventListener('click', function () {
        State.measureMode = !State.measureMode;
        $('btnMeasureMode').classList.toggle('active', State.measureMode);
        if (canvas) canvas.classList.toggle('measuring', State.measureMode);
        if ($('btnClearMeasure')) $('btnClearMeasure').style.display = State.measureMode ? 'inline-flex' : 'none';
        if (!State.measureMode) {
          State.measureSelection = [];
          if ($('measureCard')) $('measureCard').style.display = 'none';
        }
        renderCanvas();
      });
    }
    if ($('btnClearMeasure')) {
      $('btnClearMeasure').addEventListener('click', function () {
        State.measureSelection = [];
        if ($('measureCard')) $('measureCard').style.display = 'none';
        renderCanvas();
      });
    }
    if ($('btnCloseMeasureCard')) {
      $('btnCloseMeasureCard').addEventListener('click', function () {
        if ($('measureCard')) $('measureCard').style.display = 'none';
      });
    }
    if ($('btnCloseSpatialRev')) {
      $('btnCloseSpatialRev').addEventListener('click', function () {
        if ($('dfmSpatialReviewCard')) $('dfmSpatialReviewCard').style.display = 'none';
      });
    }

    if (canvas) {
      canvas.addEventListener('wheel', function (e) {
        e.preventDefault();
        var rect = canvas.getBoundingClientRect();
        var mx = e.clientX - rect.left, my = e.clientY - rect.top;
        var zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
        var vp = State.viewport;
        var wBefore = screenToWorld(mx, my);
        vp.zoom = Math.max(0.1, Math.min(25, vp.zoom * zoomFactor));
        vp.panX = mx - wBefore[0] * vp.zoom;
        vp.panY = (canvas.height - my) - wBefore[1] * vp.zoom;
        renderCanvas();
      });

      canvas.addEventListener('mousedown', function (e) {
        if (State.measureMode) {
          var rect = canvas.getBoundingClientRect();
          var wp = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
          var wx = wp[0], wy = wp[1];
          var clickedVia = null, minVD = Infinity;
          State.vias.forEach(function (v) {
            var d = Math.hypot(v.origin[0] - wx, v.origin[1] - wy);
            if (d < (v.padRadius + 15 / State.viewport.zoom) && d < minVD) { minVD = d; clickedVia = v; }
          });
          if (clickedVia) {
            if (State.measureSelection.length >= 2) State.measureSelection = [];
            State.measureSelection.push({ type: 'via', item: clickedVia });
            renderCanvas();
            return;
          }
          var clickedTrace = null, minTD = Infinity;
          State.traces.forEach(function (t) {
            var d = t.kind === 'line'
              ? root.DfmCheck.ptToSegDist([wx, wy], t.p1, t.p2).dist
              : root.DfmCheck.ptToArcDist([wx, wy], t.center, t.radius, t.p1, t.p2, t.dir).dist;
            if (d < (t.width / 2 + 10 / State.viewport.zoom) && d < minTD) { minTD = d; clickedTrace = t; }
          });
          if (clickedTrace) {
            if (State.measureSelection.length >= 2) State.measureSelection = [];
            State.measureSelection.push({ type: 'trace', item: clickedTrace });
            renderCanvas();
            return;
          }
        }
        State.viewport.isDragging = true;
        State.viewport.dragStartX = e.clientX;
        State.viewport.dragStartY = e.clientY;
      });

      canvas.addEventListener('mousemove', function (e) {
        if (State.viewport.isDragging) return;
        var rect = canvas.getBoundingClientRect();
        var wp = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        var nearestVia = null, minDist = Infinity;
        State.vias.forEach(function (v) {
          var d = Math.hypot(v.origin[0] - wp[0], v.origin[1] - wp[1]);
          if (d < minDist && d < (v.padRadius + 15 / State.viewport.zoom)) { minDist = d; nearestVia = v; }
        });
        var tip = $('canvasTooltip');
        if (!tip) return;
        if (nearestVia) {
          tip.style.display = 'block';
          tip.style.left = (e.clientX + 14) + 'px';
          tip.style.top = (e.clientY + 14) + 'px';
          tip.innerHTML = '<b>Via ' + nearestVia.id + '</b> · ' + escHtml(nearestVia.net) + '<br>' +
            '跨层: ' + escHtml(nearestVia.spanLabel || '通孔') + '<br>' +
            '坐标: [' + nearestVia.origin[0].toFixed(2) + ', ' + nearestVia.origin[1].toFixed(2) + ']<br>' +
            '一钻: ' + nearestVia.firstDrill.toFixed(2) + ' mil | 焊盘: ' + nearestVia.padDiameter.toFixed(2) + ' mil';
        } else {
          tip.style.display = 'none';
        }
      });
    }

    root.addEventListener('mousemove', function (e) {
      if (State.viewport.isDragging) {
        var dx = e.clientX - State.viewport.dragStartX;
        var dy = e.clientY - State.viewport.dragStartY;
        State.viewport.dragStartX = e.clientX;
        State.viewport.dragStartY = e.clientY;
        State.viewport.panX += dx;
        State.viewport.panY -= dy;
        renderCanvas();
      }
    });
    root.addEventListener('mouseup', function () { State.viewport.isDragging = false; });

    if ($('btnFitView')) $('btnFitView').addEventListener('click', fitCanvasView);
    if ($('btnZoomDefects')) $('btnZoomDefects').addEventListener('click', zoomToDefects);
    if ($('btnZoomIn')) $('btnZoomIn').addEventListener('click', function () { State.viewport.zoom *= 1.25; renderCanvas(); });
    if ($('btnZoomOut')) $('btnZoomOut').addEventListener('click', function () { State.viewport.zoom *= 0.8; renderCanvas(); });
    if ($('btnResetView')) $('btnResetView').addEventListener('click', fitCanvasView);

    ['ckShowVias', 'ckShowTraces', 'ckShowDefects', 'ckShowLabels', 'ckShowGrid'].forEach(function (id) {
      if ($(id)) $(id).addEventListener('change', renderCanvas);
    });

    if ($('btnExportPng')) {
      $('btnExportPng').addEventListener('click', function () {
        if (!canvas || !canvas.toDataURL) return;
        var link = document.createElement('a');
        link.download = 'PCB_空间间距分析图_' + new Date().toISOString().slice(0, 10) + '.png';
        link.href = canvas.toDataURL('image/png', 1.0);
        link.click();
      });
    }

    if ($('btnExportSvg')) {
      $('btnExportSvg').addEventListener('click', function () {
        if (!canvas) return;
        var w = canvas.width, h = canvas.height;
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">\n';
        svg += '<rect width="' + w + '" height="' + h + '" fill="#000000"/>\n';
        State.traces.forEach(function (t) {
          var col = NET_COLORS[t.net] || '#94a3b8';
          var lw = Math.max(1.8, t.width * State.viewport.zoom);
          if (t.kind === 'line') {
            var p1 = worldToScreen(t.p1[0], t.p1[1]), p2 = worldToScreen(t.p2[0], t.p2[1]);
            svg += '<line x1="' + p1[0] + '" y1="' + p1[1] + '" x2="' + p2[0] + '" y2="' + p2[1] + '" stroke="' + col + '" stroke-width="' + lw + '" stroke-linecap="round"/>\n';
          } else {
            var pts = root.DfmCheck.sampleArcPoints(t.center, t.radius, t.p1, t.p2, t.dir, 32);
            var dStr = pts.map(function (p, i) {
              var s = worldToScreen(p[0], p[1]);
              return (i === 0 ? 'M' : 'L') + s[0].toFixed(1) + ',' + s[1].toFixed(1);
            }).join(' ');
            svg += '<path d="' + dStr + '" stroke="' + col + '" stroke-width="' + lw + '" fill="none" stroke-linecap="round"/>\n';
          }
        });
        State.vias.forEach(function (v) {
          var p = worldToScreen(v.origin[0], v.origin[1]);
          var r = (v.drill / 2.0) * State.viewport.zoom;
          svg += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + r + '" fill="' + (v.isGnd ? '#334155' : '#ef4444') + '" stroke="#ffffff" stroke-width="1"/>\n';
        });
        svg += '</svg>';
        var blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'PCB_空间间距矢量图_' + new Date().toISOString().slice(0, 10) + '.svg';
        a.click();
      });
    }
  }

  root.renderCanvas = renderCanvas;
  root.fitCanvasView = fitCanvasView;
  root.zoomToDefects = zoomToDefects;
  root.updateMeasurements = updateMeasurements;
  root.toggleDfmPairReview = toggleDfmPairReview;
  root.locateInCanvas = locateInCanvas;
  root.locateNetRoute = locateNetRoute;

  bindCanvasEvents();
})(typeof window !== 'undefined' ? window : globalThis);
