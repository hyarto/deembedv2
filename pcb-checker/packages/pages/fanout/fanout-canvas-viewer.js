/* ============================================================================
 * fanout-canvas-viewer.js —— 扇出检查 2D 空间几何视口、孔群/走线深度检视与同步复核
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var State = root.State;
  var escapeHtml = root.escapeHtml;
  var getTraceLayerColor = root.getTraceLayerColor;

  var canvasRenderQueued = false;
  var canvasSpatialGrid = null;
  var GRID_CELL_SIZE = 120.0;

  function requestCanvasRender() {
    if (!canvasRenderQueued) {
      canvasRenderQueued = true;
      var run = function () { canvasRenderQueued = false; renderCanvas(); };
      if (root.requestAnimationFrame) root.requestAnimationFrame(run);
      else setTimeout(run, 16);
    }
  }

  function buildCanvasSpatialGrid() {
    if (!State.vias || !State.vias.length) { canvasSpatialGrid = null; return; }
    var grid = new Map();
    for (var i = 0; i < State.vias.length; i++) {
      var v = State.vias[i];
      var gx = Math.floor(v.x / GRID_CELL_SIZE), gy = Math.floor(v.y / GRID_CELL_SIZE);
      var key = (gx << 16) ^ gy;
      var list = grid.get(key);
      if (!list) { list = []; grid.set(key, list); }
      list.push(v);
    }
    canvasSpatialGrid = grid;
  }

  function resizeCanvas() {
    var canvas = document.getElementById('mainCanvas');
    var container = document.getElementById('canvasContainer');
    if (!canvas || !container) return;
    canvas.width = container.clientWidth || 900;
    canvas.height = container.clientHeight || 600;
  }

  function worldToScreen(wx, wy) {
    return {
      x: State.canvas.panX + wx * State.canvas.zoom,
      y: State.canvas.panY - wy * State.canvas.zoom
    };
  }

  function screenToWorld(sx, sy) {
    return {
      x: (sx - State.canvas.panX) / State.canvas.zoom,
      y: -(sy - State.canvas.panY) / State.canvas.zoom
    };
  }

  function fitCanvasToLayout() {
    var hasVias = State.vias && State.vias.length > 0;
    var hasTraces = State.traces && State.traces.length > 0;
    if (!hasVias && !hasTraces) return;
    var canvas = document.getElementById('mainCanvas');
    if (!canvas) return;
    var w = canvas.width || 900, h = canvas.height || 600;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    State.vias.forEach(function (v) {
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
    });
    if (hasTraces && State.canvas.showTraces) {
      var lyrFilter = State.canvas.traceLayerFilter || '';
      State.traces.forEach(function (t) {
        if (lyrFilter && t.layer !== lyrFilter) return;
        if (t.bbox) {
          if (t.bbox.minX < minX) minX = t.bbox.minX; if (t.bbox.maxX > maxX) maxX = t.bbox.maxX;
          if (t.bbox.minY < minY) minY = t.bbox.minY; if (t.bbox.maxY > maxY) maxY = t.bbox.maxY;
        }
      });
    }
    if (!isFinite(minX) || !isFinite(maxX)) return;
    var spanX = Math.max(maxX - minX, 80), spanY = Math.max(maxY - minY, 80);
    State.canvas.zoom = Math.min((w * 0.85) / spanX, (h * 0.85) / spanY);
    State.canvas.panX = w / 2 - ((minX + maxX) / 2) * State.canvas.zoom;
    State.canvas.panY = h / 2 + ((minY + maxY) / 2) * State.canvas.zoom;
    requestCanvasRender();
  }

  function resetCanvasView() { State.selectedTraceId = null; fitCanvasToLayout(); }

  function zoomCanvas(factor) {
    var canvas = document.getElementById('mainCanvas');
    if (!canvas) return;
    var cx = (canvas.width || 900) / 2, cy = (canvas.height || 600) / 2;
    var newZoom = Math.max(0.01, Math.min(600, State.canvas.zoom * factor));
    State.canvas.panX = cx - (cx - State.canvas.panX) * (newZoom / State.canvas.zoom);
    State.canvas.panY = cy - (cy - State.canvas.panY) * (newZoom / State.canvas.zoom);
    State.canvas.zoom = newZoom;
    requestCanvasRender();
  }

  function toggleCanvasLayer(layerKey) {
    if (layerKey === 'traces') State.canvas.showTraces = !State.canvas.showTraces;
    if (layerKey === 'hulls') State.canvas.showHulls = !State.canvas.showHulls;
    if (layerKey === 'labels') State.canvas.showLabels = !State.canvas.showLabels;
    if (layerKey === 'dims') State.canvas.showDims = !State.canvas.showDims;
    if (layerKey === 'badges') State.canvas.showBadges = !State.canvas.showBadges;

    var mapBtn = {
      btnToggleTraces: State.canvas.showTraces,
      btnToggleHulls: State.canvas.showHulls,
      btnToggleLabels: State.canvas.showLabels,
      btnToggleDims: State.canvas.showDims,
      btnToggleBadges: State.canvas.showBadges
    };
    Object.keys(mapBtn).forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.className = mapBtn[id] ? 'active' : '';
    });
    requestCanvasRender();
  }

  function onCanvasTraceLayerChange() {
    var sel = document.getElementById('selCanvasTraceLayer');
    State.canvas.traceLayerFilter = sel ? sel.value : '';
    requestCanvasRender();
  }

  function toggleMeasureMode() {
    State.canvas.measureMode = !State.canvas.measureMode;
    State.canvas.measurePoints = [];
    var btn = document.getElementById('btnMeasureMode');
    if (btn) {
      btn.className = State.canvas.measureMode ? 'active' : '';
      btn.textContent = State.canvas.measureMode ? '测距中' : '测距标尺';
    }
    requestCanvasRender();
  }

  function findClusterAtWorldPos(wx, wy) {
    var hitTol = 40.0;
    for (var i = 0; i < State.clusters.length; i++) {
      var c = State.clusters[i];
      if (!c.bbox) continue;
      if (wx >= c.bbox.minX - hitTol && wx <= c.bbox.maxX + hitTol &&
          wy >= c.bbox.minY - hitTol && wy <= c.bbox.maxY + hitTol) {
        return c;
      }
    }
    return null;
  }

  function pointToSegDist2D(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    if (len2 <= 1e-9) return Math.hypot(px - x1, py - y1);
    var t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function findTraceAtWorldPos(wx, wy) {
    if (!State.canvas.showTraces || !State.traces || !State.traces.length) return null;
    var lyrFilter = State.canvas.traceLayerFilter || '';
    var hitTol = Math.max(8.0, 10.0 / Math.max(0.05, State.canvas.zoom));
    var best = null, bestDist = hitTol;
    State.traces.forEach(function (t) {
      if (lyrFilter && t.layer !== lyrFilter) return;
      if (t.bbox && (wx < t.bbox.minX - hitTol || wx > t.bbox.maxX + hitTol || wy < t.bbox.minY - hitTol || wy > t.bbox.maxY + hitTol)) return;
      (t.segments || []).forEach(function (seg) {
        var pts = seg.points;
        if (!pts || pts.length < 2) return;
        for (var i = 0; i < pts.length - 1; i++) {
          var d = pointToSegDist2D(wx, wy, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
          var effDist = Math.max(0, d - (seg.width || 5.0) * 0.5);
          if (effDist <= bestDist) { bestDist = effDist; best = t; }
        }
      });
    });
    return best;
  }

  function openTraceDeepDive(trace) {
    var box = document.getElementById('canvasInfoBox');
    var title = document.getElementById('infoBoxTitle');
    var content = document.getElementById('infoBoxContent');
    if (!box || !title || !content) return;

    var col = getTraceLayerColor(trace.layer);
    title.innerHTML = '走线 Item #' + trace.id + ' <span class="badge-tag">' + escapeHtml(trace.layer) + '</span>';
    var segRows = (trace.segments || []).map(function (s, idx) {
      var kind = s.type === 'arc' ? ('圆弧 ' + (s.dir || 'CCW') + ' R=' + (s.radius || 0).toFixed(2)) : '直线段';
      return '<tr><td>#' + (idx + 1) + '</td><td>' + escapeHtml(kind) + '</td><td style="font-family:var(--mono)">' + (s.width || 0).toFixed(2) + '</td><td style="font-family:var(--mono)">' + (s.length || 0).toFixed(2) + '</td></tr>';
    }).join('');

    content.innerHTML = '<div style="font-size:12px;color:#e3e8ef;line-height:1.65;margin-bottom:8px">' +
      '<div>网络: <strong style="color:#38bdf8;font-family:var(--mono)">' + escapeHtml(trace.net) + '</strong></div>' +
      '<div>走线层: <span style="display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-weight:700"><span style="width:8px;height:8px;border-radius:50%;background:' + col + ';display:inline-block"></span>' + escapeHtml(trace.layer) + '</span></div>' +
      '<div>总长: <strong style="font-family:var(--mono)">' + trace.length.toFixed(3) + ' mil</strong></div>' +
      '</div><div style="max-height:150px;overflow-y:auto;border:1px solid rgba(255,255,255,.15);border-radius:4px">' +
      '<table><thead><tr><th>段号</th><th>类型</th><th>线宽</th><th>长度</th></tr></thead><tbody>' + segRows + '</tbody></table></div>';
    box.classList.add('active');
  }

  function openClusterDeepDive(cluster) {
    State.selectedClusterId = cluster.id;
    State.selectedTraceId = null;
    var box = document.getElementById('canvasInfoBox');
    var title = document.getElementById('infoBoxTitle');
    var content = document.getElementById('infoBoxContent');
    if (!box || !title || !content) return;

    var res = cluster.matchResult || {};
    var isReviewed = State.reviewedClusters.has(cluster.id);
    var failClusters = State.clusters.filter(function (c) { return !(c.matchResult && c.matchResult.pass); });
    var failIdx = failClusters.findIndex(function (c) { return c.id === cluster.id; });

    title.innerHTML = escapeHtml(cluster.id) + ' 检视 <span class="badge-tag purple">' + cluster.viaCount + ' 孔</span>';
    var statusBadge = res.pass
      ? ('<span class="badge-tag ok">匹配通过 · ' + escapeHtml(res.schemeName) + '</span>')
      : ('<span class="badge-tag bad">' + escapeHtml(res.statusText || '不匹配') + '</span>');
    if (isReviewed) statusBadge += ' <span class="badge-tag ok">已复核</span>';

    var auditRows = (res.viaAudit || []).map(function (a) {
      return '<tr style="' + (a.isMatch === false ? 'background:rgba(239,68,68,.18);color:#fca5a5' : '') + '">' +
        '<td>#' + a.viaId + '</td><td>' + escapeHtml(a.net || 'GND') + '</td>' +
        '<td style="font-family:var(--mono)">' + escapeHtml(a.actualPadstack) + '</td>' +
        '<td style="font-family:var(--mono)">' + escapeHtml(a.expectedPadstack) + '</td>' +
        '<td>' + (a.isMatch !== false ? 'OK' : '不符') + '</td></tr>';
    }).join('');

    var reviewBarStyle = isReviewed
      ? 'background:rgba(16,185,129,.18);border:1px solid rgba(52,211,33,.55);'
      : 'background:rgba(245,158,11,.14);border:1px solid rgba(251,191,36,.42);';
    var navFailHtml = failClusters.length > 1
      ? ('<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;font-size:11px;color:#9ca3af">' +
         '<button type="button" class="btn small sec" style="padding:2px 7px;font-size:11px;background:#1e293b;color:#e3e8ef" onclick="stepCanvasAbnormalCluster(-1)">◀ 上一异常</button>' +
         '<span>' + (failIdx !== -1 ? ('异常 ' + (failIdx + 1) + ' / ' + failClusters.length) : ('共 ' + failClusters.length + ' 处异常')) + '</span>' +
         '<button type="button" class="btn small sec" style="padding:2px 7px;font-size:11px;background:#1e293b;color:#e3e8ef" onclick="stepCanvasAbnormalCluster(1)">下一异常 ▶</button></div>')
      : '';

    content.innerHTML = navFailHtml +
      '<div id="boxCanvasClusterReview" style="' + reviewBarStyle + 'border-radius:6px;padding:8px 10px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px">' +
        '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:12px;font-weight:700;color:' + (isReviewed ? '#6ee7b7' : '#fde68a') + ';margin:0">' +
          '<input type="checkbox" id="chkCanvasClusterReview" data-no-persist ' + (isReviewed ? 'checked' : '') + ' onchange="toggleReviewCluster(\'' + cluster.id + '\', this.checked)" style="width:15px;height:15px;cursor:pointer">' +
          '<span>' + (isReviewed ? '已复核 · 明细已同步勾选' : '勾选复核此孔群') + '</span></label>' +
        '<button type="button" class="btn small" id="btnCanvasToggleReview" onclick="toggleReviewCluster(\'' + cluster.id + '\', ' + (!isReviewed) + ')" style="padding:3px 9px;font-size:11px;background:' + (isReviewed ? '#334155' : '#10b981') + ';color:#fff">' +
          (isReviewed ? '取消复核' : '确认复核') + '</button></div>' +
      '<div style="margin-bottom:8px;display:flex;gap:4px;flex-wrap:wrap">' + statusBadge + '</div>' +
      '<div style="font-size:11px;color:#cbd5e1;margin-bottom:10px">' + escapeHtml(res.message || '') + '</div>' +
      '<div style="max-height:150px;overflow-y:auto;border:1px solid rgba(255,255,255,.15);border-radius:4px;margin-bottom:10px">' +
        '<table><thead><tr><th>孔号</th><th>网络</th><th>实测 Padstack</th><th>方案要求</th><th>结果</th></tr></thead>' +
        '<tbody>' + (auditRows || '<tr><td colspan="5" style="text-align:center">无比对记录</td></tr>') + '</tbody></table></div>' +
      '<div style="display:flex;gap:6px"><button type="button" class="btn small pri" onclick="saveClusterAsScheme(\'' + cluster.id + '\')" style="flex:1">存为新方案</button>' +
      '<button type="button" class="btn small sec" onclick="switchTab(\'tabResults\')" style="flex:1">结果明细</button></div>';

    box.classList.add('active');
    renderCanvas();
  }

  function closeInfoBox() {
    var box = document.getElementById('canvasInfoBox');
    if (box) box.classList.remove('active');
    State.selectedClusterId = null;
    State.selectedTraceId = null;
    renderCanvas();
  }

  function stepCanvasAbnormalCluster(delta) {
    var failList = State.clusters.filter(function (c) { return !(c.matchResult && c.matchResult.pass); });
    var pool = failList.length > 0 ? failList : State.clusters;
    if (!pool.length) return;
    var curIdx = pool.findIndex(function (c) { return c.id === State.selectedClusterId; });
    var nextIdx = curIdx === -1 ? 0 : (curIdx + delta + pool.length) % pool.length;
    locateClusterInCanvas(pool[nextIdx].id);
  }

  function locateClusterInCanvas(clusterId) {
    var cluster = State.clusters.find(function (c) { return c.id === clusterId; });
    if (!cluster) return;
    root.switchTab('tabCanvas');
    var run = function () {
      resizeCanvas();
      var canvas = document.getElementById('mainCanvas');
      var w = (canvas && canvas.width) || 900, h = (canvas && canvas.height) || 600;
      State.canvas.zoom = 8.0;
      State.canvas.panX = w / 2 - cluster.centroid.x * State.canvas.zoom;
      State.canvas.panY = h / 2 + cluster.centroid.y * State.canvas.zoom;
      openClusterDeepDive(cluster);
      requestCanvasRender();
    };
    if (root.requestAnimationFrame) root.requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function locateTraceInCanvas(traceId) {
    var source = (State.traces && State.traces.length > 0) ? State.traces : (State.previewTraces || []);
    var trace = source.find(function (t) { return t.id === traceId; });
    if (!trace) return;
    if ((!State.traces || !State.traces.length) && State.previewTraces && State.previewTraces.length) {
      State.traces = State.previewTraces;
    }
    State.selectedTraceId = trace.id;
    State.selectedClusterId = null;
    State.canvas.showTraces = true;
    root.switchTab('tabCanvas');
    var run = function () {
      resizeCanvas();
      var canvas = document.getElementById('mainCanvas');
      var w = (canvas && canvas.width) || 900, h = (canvas && canvas.height) || 600;
      var bb = trace.bbox || { minX: 0, maxX: 100, minY: 0, maxY: 100 };
      State.canvas.zoom = Math.min(18.0, Math.max(1.5, Math.min((w * 0.55) / Math.max(bb.maxX - bb.minX, 60), (h * 0.55) / Math.max(bb.maxY - bb.minY, 60))));
      State.canvas.panX = w / 2 - ((bb.minX + bb.maxX) / 2) * State.canvas.zoom;
      State.canvas.panY = h / 2 + ((bb.minY + bb.maxY) / 2) * State.canvas.zoom;
      openTraceDeepDive(trace);
      requestCanvasRender();
    };
    if (root.requestAnimationFrame) root.requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function renderCanvas() {
    var readout = document.getElementById('canvasRulerReadout');
    if (readout) {
      readout.textContent = '比例: ' + State.canvas.zoom.toFixed(2) + 'x | 视口: [' +
        (-State.canvas.panX / State.canvas.zoom).toFixed(0) + ', ' + (State.canvas.panY / State.canvas.zoom).toFixed(0) + ']';
    }

    var canvas = document.getElementById('mainCanvas');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var w = canvas.width || 900, h = canvas.height || 600;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    var gridSize = 100 * State.canvas.zoom;
    if (gridSize >= 15) {
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var gx = State.canvas.panX % gridSize; gx < w; gx += gridSize) { ctx.moveTo(gx, 0); ctx.lineTo(gx, h); }
      for (var gy = State.canvas.panY % gridSize; gy < h; gy += gridSize) { ctx.moveTo(0, gy); ctx.lineTo(w, gy); }
      ctx.stroke();
    }

    if (!State.clusters.length && !State.vias.length && (!State.traces || !State.traces.length)) return;

    var wTopLeft = screenToWorld(0, 0), wBotRight = screenToWorld(w, h);
    var viewMinX = Math.min(wTopLeft.x, wBotRight.x) - 40, viewMaxX = Math.max(wTopLeft.x, wBotRight.x) + 40;
    var viewMinY = Math.min(wTopLeft.y, wBotRight.y) - 40, viewMaxY = Math.max(wTopLeft.y, wBotRight.y) + 40;

    var visibleClusters = State.clusters.filter(function (c) {
      if (!c.bbox) return true;
      return !(c.bbox.maxX < viewMinX || c.bbox.minX > viewMaxX || c.bbox.maxY < viewMinY || c.bbox.minY > viewMaxY);
    });

    if (State.canvas.showHulls) {
      visibleClusters.forEach(function (c) {
        if (c.viaCount < 2) return;
        var res = c.matchResult || {};
        var isReviewed = State.reviewedClusters.has(c.id);
        var pts = c.vias.map(function (v) { return worldToScreen(v.x, v.y); });
        var cx = pts.reduce(function (s, p) { return s + p.x; }, 0) / pts.length;
        var cy = pts.reduce(function (s, p) { return s + p.y; }, 0) / pts.length;
        var sorted = pts.slice().sort(function (a, b) { return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx); });
        ctx.save();
        ctx.fillStyle = isReviewed ? 'rgba(20,184,166,0.16)' : (res.pass ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.16)');
        ctx.strokeStyle = isReviewed ? '#14b8a6' : (res.pass ? '#10b981' : '#ef4444');
        ctx.lineWidth = (State.selectedClusterId === c.id) ? 2.4 : 1.2;
        ctx.beginPath();
        ctx.moveTo(sorted[0].x, sorted[0].y);
        for (var k = 1; k < sorted.length; k++) ctx.lineTo(sorted[k].x, sorted[k].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
    }

    if (State.canvas.showTraces && State.traces && State.traces.length) {
      var lyrFilter = State.canvas.traceLayerFilter || '';
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      State.traces.forEach(function (t) {
        if (lyrFilter && t.layer !== lyrFilter) return;
        if (t.bbox && (t.bbox.maxX < viewMinX || t.bbox.minX > viewMaxX || t.bbox.maxY < viewMinY || t.bbox.minY > viewMaxY)) return;
        var col = getTraceLayerColor(t.layer);
        (t.segments || []).forEach(function (seg) {
          var pts = seg.points;
          if (!pts || pts.length < 2) return;
          ctx.beginPath();
          var p0 = worldToScreen(pts[0][0], pts[0][1]);
          ctx.moveTo(p0.x, p0.y);
          for (var k = 1; k < pts.length; k++) {
            var pk = worldToScreen(pts[k][0], pts[k][1]);
            ctx.lineTo(pk.x, pk.y);
          }
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(1.8, (seg.width || t.width || 5.0) * State.canvas.zoom);
          ctx.stroke();
        });
      });
      ctx.restore();
    }

    var padRad = Math.max(3.5, 4.0 * State.canvas.zoom);
    var drillRad = Math.max(1.5, 1.8 * State.canvas.zoom);
    State.vias.forEach(function (v) {
      if (v.x < viewMinX || v.x > viewMaxX || v.y < viewMinY || v.y > viewMaxY) return;
      var sp = worldToScreen(v.x, v.y);
      var isSig = (v.net && v.net.toUpperCase().indexOf('GND') < 0) || (v.padstack && v.padstack.toUpperCase().indexOf('SMA') >= 0);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, padRad, 0, Math.PI * 2);
      ctx.fillStyle = isSig ? '#38bdf8' : '#10b981';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, drillRad, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
    });

    if (State.canvas.measurePoints.length === 2) {
      var ptsM = State.canvas.measurePoints.map(function (p) { return worldToScreen(p.x, p.y); });
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ptsM[0].x, ptsM[0].y);
      ctx.lineTo(ptsM[1].x, ptsM[1].y);
      ctx.stroke();
      ctx.restore();
    }
  }

  function initCanvas() {
    var canvas = document.getElementById('mainCanvas');
    if (!canvas) return;

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var zoomFactor = e.deltaY < 0 ? 1.18 : 0.82;
      var newZoom = Math.max(0.01, Math.min(600, State.canvas.zoom * zoomFactor));
      State.canvas.panX = mx - (mx - State.canvas.panX) * (newZoom / State.canvas.zoom);
      State.canvas.panY = my - (my - State.canvas.panY) * (newZoom / State.canvas.zoom);
      State.canvas.zoom = newZoom;
      requestCanvasRender();
    }, { passive: false });

    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      State.canvas.isDragging = true;
      State.canvas.dragStartX = e.clientX - State.canvas.panX;
      State.canvas.dragStartY = e.clientY - State.canvas.panY;
    });

    root.addEventListener('mousemove', function (e) {
      if (!State.canvas.isDragging) return;
      State.canvas.panX = e.clientX - State.canvas.dragStartX;
      State.canvas.panY = e.clientY - State.canvas.dragStartY;
      requestCanvasRender();
    });
    root.addEventListener('mouseup', function () { State.canvas.isDragging = false; });

    canvas.addEventListener('click', function (e) {
      var rect = canvas.getBoundingClientRect();
      var worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      if (State.canvas.measureMode) {
        State.canvas.measurePoints.push(worldPos);
        if (State.canvas.measurePoints.length > 2) State.canvas.measurePoints = [worldPos];
        requestCanvasRender();
        return;
      }
      var clicked = findClusterAtWorldPos(worldPos.x, worldPos.y);
      if (clicked) openClusterDeepDive(clicked);
      else {
        var hitTrace = findTraceAtWorldPos(worldPos.x, worldPos.y);
        if (hitTrace) {
          State.selectedTraceId = hitTrace.id;
          State.selectedClusterId = null;
          openTraceDeepDive(hitTrace);
          requestCanvasRender();
        } else {
          closeInfoBox();
        }
      }
    });

    root.addEventListener('resize', function () {
      if (State.activeTab === 'tabCanvas') { resizeCanvas(); requestCanvasRender(); }
    });
  }

  function initApp() {
    if (initApp._done) return;
    initApp._done = true;
    State.library.loadStandardPresets();
    root.renderSchemeCards();
    initCanvas();
    root.updateTopKPIs();

    document.querySelectorAll('nav#tabs button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.tab) root.switchTab(btn.dataset.tab);
      });
    });

    var dropVia = document.getElementById('dropzoneVia');
    if (dropVia) {
      dropVia.addEventListener('dragover', function (e) { e.preventDefault(); dropVia.classList.add('dragover'); });
      dropVia.addEventListener('dragleave', function () { dropVia.classList.remove('dragover'); });
      dropVia.addEventListener('drop', function (e) {
        e.preventDefault();
        dropVia.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          root.handleViaFileUpload({ target: { files: e.dataTransfer.files, value: '' } });
        }
      });
    }
  }

  root.requestCanvasRender = requestCanvasRender;
  root.buildCanvasSpatialGrid = buildCanvasSpatialGrid;
  root.resizeCanvas = resizeCanvas;
  root.fitCanvasToLayout = fitCanvasToLayout;
  root.resetCanvasView = resetCanvasView;
  root.zoomCanvas = zoomCanvas;
  root.toggleCanvasLayer = toggleCanvasLayer;
  root.onCanvasTraceLayerChange = onCanvasTraceLayerChange;
  root.toggleMeasureMode = toggleMeasureMode;
  root.openTraceDeepDive = openTraceDeepDive;
  root.openClusterDeepDive = openClusterDeepDive;
  root.closeInfoBox = closeInfoBox;
  root.stepCanvasAbnormalCluster = stepCanvasAbnormalCluster;
  root.locateClusterInCanvas = locateClusterInCanvas;
  root.locateTraceInCanvas = locateTraceInCanvas;
  root.renderCanvas = renderCanvas;
  root.initApp = initApp;

  initApp();
})(typeof window !== 'undefined' ? window : globalThis);
