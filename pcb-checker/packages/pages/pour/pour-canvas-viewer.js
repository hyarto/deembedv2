/* ============================================================================
 * pour-canvas-viewer.js —— 铜皮检查模块：2D 空间几何视口、标尺测量与定位复核浮窗
 * ========================================================================== */
(function (root) {
'use strict';
  if (typeof document === 'undefined') return;
  var esc = root.escHtml || function (str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };
  var cleanMsg = root.PourCleanMsg || function (s) {
    return String(s == null ? '' : s).replace(/^[\s✅❌⚠️]+/u, '').trim();
  };
  var safeRAF = root.PourSafeRAF || function (fn) {
    if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(fn);
    else setTimeout(fn, 0);
  };
  var NET_COLORS = {
    GND: '#475569',
    '25_N': '#c084fc',
    '25_P': '#84cc16',
    '26_N': '#22c55e',
    '26_P': '#06b6d4',
    '105_P': '#38bdf8',
    '105_N': '#818cf8',
    '106_P': '#f472b6',
    '106_N': '#fb7185'
  };
  var DYNAMIC_NET_PALETTE = ['#38bdf8', '#c084fc', '#84cc16', '#22c55e', '#06b6d4', '#f43f5e', '#eab308', '#ec4899', '#a855f7', '#14b8a6'];
  function getNetColor(netName) {
    if (!netName) return '#94a3b8';
    if (NET_COLORS[netName]) return NET_COLORS[netName];
    var h = 0;
    for (var i = 0; i < netName.length; i++) h = (h * 31 + netName.charCodeAt(i)) >>> 0;
    return DYNAMIC_NET_PALETTE[h % DYNAMIC_NET_PALETTE.length];
  }
  function resizeCanvas() {
    var canvas = document.getElementById('mainCanvas');
    var container = document.getElementById('canvasContainer');
    if (!canvas || !container) return;
    canvas.width = container.clientWidth || 920;
    canvas.height = container.clientHeight || 640;
  }
  function worldToScreen(wx, wy) {
    var c = root.State.canvas;
    return {
      x: c.panX + wx * c.zoom,
      y: c.panY - wy * c.zoom
    };
  }
  function screenToWorld(sx, sy) {
    var c = root.State.canvas;
    return {
      x: (sx - c.panX) / c.zoom,
      y: -(sy - c.panY) / c.zoom
    };
  }
  function fitCanvasToLayout() {
    var State = root.State;
    var canvas = document.getElementById('mainCanvas');
    if (!canvas) return;
    var w = canvas.width || 920;
    var h = canvas.height || 640;
    var minX = Infinity, maxX = -Infinity;
    var minY = Infinity, maxY = -Infinity;
    (State.shapes || []).forEach(function (s) {
      if (!s.bbox) return;
      if (s.bbox.minX < minX) minX = s.bbox.minX;
      if (s.bbox.maxX > maxX) maxX = s.bbox.maxX;
      if (s.bbox.minY < minY) minY = s.bbox.minY;
      if (s.bbox.maxY > maxY) maxY = s.bbox.maxY;
    });
    (State.vias || []).forEach(function (v) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    });
    (State.traces || []).forEach(function (t) {
      if (!t.bbox) return;
      if (t.bbox.minX < minX) minX = t.bbox.minX;
      if (t.bbox.maxX > maxX) maxX = t.bbox.maxX;
      if (t.bbox.minY < minY) minY = t.bbox.minY;
      if (t.bbox.maxY > maxY) maxY = t.bbox.maxY;
    });
    if (minX === Infinity) return;
    var spanX = Math.max(maxX - minX, 100);
    var spanY = Math.max(maxY - minY, 100);
    var zoomX = (w * 0.85) / spanX;
    var zoomY = (h * 0.85) / spanY;
    State.canvas.zoom = Math.min(zoomX, zoomY);
    var midX = (minX + maxX) / 2;
    var midY = (minY + maxY) / 2;
    State.canvas.panX = w / 2 - midX * State.canvas.zoom;
    State.canvas.panY = h / 2 + midY * State.canvas.zoom;
    renderCanvas();
  }
  function resetCanvasView() {
    fitCanvasToLayout();
  }
  function zoomCanvas(factor) {
    var State = root.State;
    var canvas = document.getElementById('mainCanvas');
    if (!canvas) return;
    var cx = (canvas.width || 920) / 2;
    var cy = (canvas.height || 640) / 2;
    var newZoom = Math.max(0.01, Math.min(500, State.canvas.zoom * factor));
    State.canvas.panX = cx - (cx - State.canvas.panX) * (newZoom / State.canvas.zoom);
    State.canvas.panY = cy - (cy - State.canvas.panY) * (newZoom / State.canvas.zoom);
    State.canvas.zoom = newZoom;
    renderCanvas();
  }
  function toggleCanvasLayer(layerKey) {
    var c = root.State.canvas;
    if (layerKey === 'shapes') c.showShapes = !c.showShapes;
    if (layerKey === 'vias') c.showVias = !c.showVias;
    if (layerKey === 'traces') c.showTraces = !c.showTraces;
    if (layerKey === 'ports') c.showPorts = !c.showPorts;
    if (layerKey === 'defects') c.showDefects = !c.showDefects;
    var map = {
      btnToggleShapes: c.showShapes,
      btnToggleVias: c.showVias,
      btnToggleTraces: c.showTraces,
      btnTogglePorts: c.showPorts,
      btnToggleDefects: c.showDefects
    };
    Object.keys(map).forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.className = map[id] ? 'active' : '';
    });
    renderCanvas();
  }
  function toggleMeasureMode() {
    var c = root.State.canvas;
    c.measureMode = !c.measureMode;
    c.measurePoints = [];
    var btn = document.getElementById('btnMeasureMode');
    if (btn) {
      btn.className = c.measureMode ? 'active' : '';
      btn.textContent = c.measureMode ? '测距中 · 点击两点' : '测距标尺';
    }
    renderCanvas();
  }
  function renderCanvas() {
    var State = root.State;
    var canvas = document.getElementById('mainCanvas');
    if (!canvas || !canvas.getContext) return;
    var readout = document.getElementById('canvasRulerReadout');
    if (readout) {
      readout.textContent = '比例: ' + State.canvas.zoom.toFixed(2) + 'x | 视口中心: [' +
        (-State.canvas.panX / State.canvas.zoom).toFixed(0) + ', ' +
        (State.canvas.panY / State.canvas.zoom).toFixed(0) + ']';
    }
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var w = canvas.width;
    var h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#050811';
    ctx.fillRect(0, 0, w, h);
    var PC = root.PourChecker;
    /* 1. 铜皮轮廓 */
    if (State.canvas.showShapes && State.shapes) {
      State.shapes.forEach(function (shape) {
        ctx.save();
        ctx.fillStyle = 'rgba(180, 83, 9, 0.22)';
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = Math.max(1.0, 1.2 * State.canvas.zoom);
        ctx.beginPath();
        shape.boundary.forEach(function (seg) {
          if (seg.type === 'line') {
            var p1 = worldToScreen(seg.x1, seg.y1);
            var p2 = worldToScreen(seg.x2, seg.y2);
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
          } else if (seg.type === 'arc') {
            if (Math.abs(seg.x1 - seg.x2) < 1e-4 && Math.abs(seg.y1 - seg.y2) < 1e-4) {
              var cp = worldToScreen(seg.cx, seg.cy);
              ctx.arc(cp.x, cp.y, seg.radius * State.canvas.zoom, 0, Math.PI * 2);
            } else if (PC && PC.sampleArcPoints) {
              var pts = PC.sampleArcPoints([seg.cx, seg.cy], seg.radius, [seg.x1, seg.y1], [seg.x2, seg.y2], seg.dir || (seg.ccw ? 'CCW' : 'CW'), 24);
              pts.forEach(function (pt, i) {
                var sp = worldToScreen(pt[0], pt[1]);
                if (i === 0) ctx.moveTo(sp.x, sp.y);
                else ctx.lineTo(sp.x, sp.y);
              });
            }
          }
        });
        ctx.fill();
        ctx.stroke();
        if (State.canvas.zoom > 1.5 && shape.centroid) {
          var cent = worldToScreen(shape.centroid.x, shape.centroid.y);
          ctx.fillStyle = '#fde68a';
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('Shape #' + shape.id + ' · ' + shape.layer, cent.x, cent.y);
        }
        ctx.restore();
      });
    }
    /* 2. 过孔 */
    if (State.canvas.showVias && State.vias) {
      State.vias.forEach(function (v) {
        var sp = worldToScreen(v.x, v.y);
        var isGnd = v.net && v.net.toUpperCase() === 'GND';
        if (isGnd) {
          var padR = Math.max(6.0, 4.0 * State.canvas.zoom);
          var drillR = Math.max(2.0, 1.8 * State.canvas.zoom);
          ctx.save();
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, padR, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(71, 85, 105, 0.75)';
          ctx.fill();
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, drillR, 0, Math.PI * 2);
          ctx.fillStyle = '#020617';
          ctx.fill();
          ctx.strokeStyle = '#cbd5e1';
          ctx.stroke();
          ctx.fillStyle = '#f8fafc';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('GND', sp.x, sp.y);
          ctx.restore();
        } else {
          var rad = Math.max(3.5, 4.0 * State.canvas.zoom);
          var dR = Math.max(1.8, 2.0 * State.canvas.zoom);
          ctx.save();
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, rad, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(250, 204, 21, 0.18)';
          ctx.fill();
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, dR, 0, Math.PI * 2);
          ctx.strokeStyle = '#fef08a';
          ctx.lineWidth = 0.8;
          ctx.stroke();
          if (State.canvas.zoom > 2.2) {
            ctx.fillStyle = '#fde047';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('#' + v.id, sp.x, sp.y - rad - 2);
          }
          ctx.restore();
        }
      });
    }
    /* 3. 走线（直线与圆弧参数化采样） */
    if (State.canvas.showTraces && State.traces) {
      State.traces.forEach(function (trace) {
        ctx.save();
        var col = getNetColor(trace.net);
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        var traceWidth = Math.max(1.8, (trace.width || 6.0) * State.canvas.zoom);
        ctx.lineWidth = traceWidth;
        trace.segments.forEach(function (seg) {
          if (seg.type === 'line') {
            var p1 = worldToScreen(seg.x1, seg.y1);
            var p2 = worldToScreen(seg.x2, seg.y2);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          } else if (seg.type === 'arc' && PC && PC.sampleArcPoints) {
            var pts = PC.sampleArcPoints([seg.cx, seg.cy], seg.radius, [seg.x1, seg.y1], [seg.x2, seg.y2], seg.dir || 'CCW', 32);
            ctx.beginPath();
            pts.forEach(function (pt, i) {
              var sp = worldToScreen(pt[0], pt[1]);
              if (i === 0) ctx.moveTo(sp.x, sp.y);
              else ctx.lineTo(sp.x, sp.y);
            });
            ctx.stroke();
          }
        });
        if (State.canvas.zoom > 1.2 && trace.segments.length > 0) {
          var firstSeg = trace.segments[0];
          var midX = (firstSeg.x1 + (firstSeg.x2 || firstSeg.x1)) / 2;
          var midY = (firstSeg.y1 + (firstSeg.y2 || firstSeg.y1)) / 2;
          var spm = worldToScreen(midX, midY);
          ctx.font = 'bold 10px monospace';
          ctx.fillStyle = col;
          ctx.textAlign = 'center';
          ctx.fillText(trace.net + ' · ' + trace.layer, spm.x, spm.y - traceWidth / 2 - 3);
        }
        ctx.restore();
      });
    }
    /* 4. 端口 P1~P4 标注 */
    if (State.canvas.showPorts && State.traces && State.traces.length > 0) {
      var allMinX = Infinity, allMaxX = -Infinity, allMinY = Infinity, allMaxY = -Infinity;
      State.traces.forEach(function (t) {
        if (!t.bbox) return;
        allMinX = Math.min(allMinX, t.bbox.minX);
        allMaxX = Math.max(allMaxX, t.bbox.maxX);
        allMinY = Math.min(allMinY, t.bbox.minY);
        allMaxY = Math.max(allMaxY, t.bbox.maxY);
      });
      var centerX = (allMinX + allMaxX) / 2;
      var centerY = (allMinY + allMaxY) / 2;
      var netEndpoints = {};
      State.traces.forEach(function (t) {
        if (!netEndpoints[t.net]) netEndpoints[t.net] = [];
        t.segments.forEach(function (s) {
          netEndpoints[t.net].push({ x: s.x1, y: s.y1 });
          netEndpoints[t.net].push({ x: s.x2, y: s.y2 });
        });
      });
      Object.keys(netEndpoints).forEach(function (net) {
        if (net === 'GND' || net === 'UNKNOWN') return;
        var pts = netEndpoints[net];
        if (!pts || !pts.length) return;
        var maxDist = -1, outerPt = null;
        pts.forEach(function (p) {
          var d = Math.hypot(p.x - centerX, p.y - centerY);
          if (d > maxDist) { maxDist = d; outerPt = p; }
        });
        if (!outerPt) return;
        var portName = '';
        if (net === '26_N' || (outerPt.y > centerY && outerPt.x > centerX)) portName = 'P1';
        else if (net === '25_N' || (outerPt.y < centerY && outerPt.x < centerX)) portName = 'P2';
        else if (net === '25_P' || (outerPt.y > centerY && outerPt.x < centerX)) portName = 'P3';
        else if (net === '26_P' || (outerPt.y < centerY && outerPt.x > centerX)) portName = 'P4';
        if (portName) {
          var sp = worldToScreen(outerPt.x, outerPt.y);
          ctx.save();
          ctx.font = 'bold 20px monospace';
          ctx.fillStyle = '#fde047';
          ctx.textAlign = outerPt.x >= centerX ? 'left' : 'right';
          var offsetX = outerPt.x >= centerX ? 14 : -14;
          var offsetY = outerPt.y >= centerY ? -10 : 18;
          ctx.fillText(portName, sp.x + offsetX, sp.y + offsetY);
          ctx.restore();
        }
      });
    }
    /* 5. 缺陷信标 */
    if (State.canvas.showDefects && State.summary) {
      (State.rawResults || []).filter(function (r) { return !r.pass; }).forEach(function (d) {
        var dx = 0, dy = 0;
        if (d.viaCoord) { dx = d.viaCoord[0]; dy = d.viaCoord[1]; }
        else if (d.centroid) { dx = d.centroid.x; dy = d.centroid.y; }
        else if (d.centerCoord) { dx = d.centerCoord[0]; dy = d.centerCoord[1]; }
        if (dx !== 0 || dy !== 0) {
          var sp = worldToScreen(dx, dy);
          ctx.save();
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 2]);
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, Math.max(12, 15 * State.canvas.zoom), 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
    /* 6. 两点测距标尺 */
    if (State.canvas.measurePoints.length > 0) {
      var pts = State.canvas.measurePoints.map(function (p) { return worldToScreen(p.x, p.y); });
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      pts.forEach(function (p) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
      });
      if (pts.length === 2) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.stroke();
        var w1 = State.canvas.measurePoints[0];
        var w2 = State.canvas.measurePoints[1];
        var dMil = Math.hypot(w1.x - w2.x, w1.y - w2.y);
        var txt = '实测距离: ' + (dMil * 0.0254).toFixed(3) + ' mm / ' + dMil.toFixed(2) + ' mil';
        var mx = (pts[0].x + pts[1].x) / 2;
        var my = (pts[0].y + pts[1].y) / 2;
        ctx.font = 'bold 12px monospace';
        ctx.fillStyle = '#0f172a';
        var tw = ctx.measureText(txt).width;
        ctx.fillRect(mx - tw / 2 - 4, my - 16, tw + 8, 18);
        ctx.fillStyle = '#fde68a';
        ctx.textAlign = 'center';
        ctx.fillText(txt, mx, my - 3);
      }
      ctx.restore();
    }
  }
  function renderPourCanvasReviewBox(itemKey) {
    var State = root.State;
    var box = document.getElementById('pourCanvasReviewBox');
    var titleEl = document.getElementById('pourCanvasRevTitle');
    var bodyEl = document.getElementById('pourCanvasRevBody');
    if (!box || !bodyEl) return;
    State.activeReviewKey = itemKey;
    var findMatch = function (arr) {
      return (arr || []).find(function (x, idx) {
        var k = x.groupKey || (x.checkCategory + '_' + (x.viaId || x.traceId || x.shapeId) + '_' + x.layer + '_' + idx);
        return k === itemKey;
      });
    };
    var r = findMatch(State.filteredResults) || findMatch(State.groupedResults) || findMatch(State.rawResults);
    var isReviewed = State.reviewedItems.has(itemKey);
    if (titleEl && r) {
      titleEl.textContent = (r.checkCategoryName || '铜皮检查') + ' · ' + (r.targetLabel || itemKey);
    }
    var barStyle = isReviewed
      ? 'background:rgba(16,185,129,0.18);border:1px solid rgba(52,211,153,0.55);'
      : 'background:rgba(245,158,11,0.15);border:1px solid rgba(251,191,36,0.45);';
    var safeKey = esc(itemKey);
    bodyEl.innerHTML =
      '<div style="' + barStyle + 'border-radius:6px;padding:8px 10px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:8px">' +
        '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:700;color:' + (isReviewed ? '#6ee7b7' : '#fde68a') + ';margin:0">' +
          '<input type="checkbox" id="chkPourSpatialReview" data-no-persist ' + (isReviewed ? 'checked' : '') + ' onchange="toggleReviewItem(\'' + safeKey + '\', this.checked)" style="width:15px;height:15px;cursor:pointer;accent-color:#10b981">' +
          '<span>' + (isReviewed ? '已复核 · 明细已同步' : '勾选复核此项') + '</span>' +
        '</label>' +
        '<button type="button" class="btn small" onclick="toggleReviewItem(\'' + safeKey + '\', ' + (!isReviewed) + ')" style="padding:3px 9px;font-size:11px;border:none;background:' + (isReviewed ? '#334155' : '#10b981') + ';color:#ffffff">' +
          (isReviewed ? '取消复核' : '确认复核') +
        '</button>' +
      '</div>' +
      (r ? '<div style="font-size:11px;color:#cbd5e1;line-height:1.5;margin-bottom:8px">' + esc(cleanMsg(r.message)) + '</div>' : '') +
      '<div style="display:flex;justify-content:flex-end">' +
        '<button type="button" class="btn sec small" onclick="switchTab(\'tabResults\')">返回结果明细</button>' +
      '</div>';
    box.style.display = 'block';
  }
  function closePourReviewBox() {
    var box = document.getElementById('pourCanvasReviewBox');
    if (box) box.style.display = 'none';
    root.State.activeReviewKey = null;
  }
  function locateElementInCanvas(checkCategory, targetId, itemKey) {
    root.switchTab('tabCanvas');
    safeRAF(function () {
      resizeCanvas();
      var canvas = document.getElementById('mainCanvas');
      var w = canvas ? (canvas.width || 900) : 900;
      var h = canvas ? (canvas.height || 600) : 600;
      var tx = null, ty = null;
      var via = (root.State.vias || []).find(function (v) { return String(v.id) === String(targetId); });
      if (via) {
        tx = via.x;
        ty = via.y;
      } else {
        var tr = (root.State.traces || []).find(function (t) { return String(t.id) === String(targetId); });
        if (tr && tr.bbox) {
          tx = (tr.bbox.minX + tr.bbox.maxX) / 2;
          ty = (tr.bbox.minY + tr.bbox.maxY) / 2;
        } else {
          var sh = (root.State.shapes || []).find(function (s) { return String(s.id) === String(targetId); });
          if (sh && sh.bbox) {
            tx = (sh.bbox.minX + sh.bbox.maxX) / 2;
            ty = (sh.bbox.minY + sh.bbox.maxY) / 2;
          }
        }
      }
      if (tx != null && ty != null) {
        root.State.canvas.zoom = 5.5;
        root.State.canvas.panX = w / 2 - tx * root.State.canvas.zoom;
        root.State.canvas.panY = h / 2 + ty * root.State.canvas.zoom;
      }
      if (itemKey) renderPourCanvasReviewBox(itemKey);
      renderCanvas();
    });
  }
  function initCanvas() {
    var canvas = document.getElementById('mainCanvas');
    if (!canvas || canvas.__pourBound) return;
    canvas.__pourBound = true;
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = canvas.getBoundingClientRect();
      var mouseX = e.clientX - rect.left;
      var mouseY = e.clientY - rect.top;
      var zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      var newZoom = Math.max(0.01, Math.min(500, root.State.canvas.zoom * zoomFactor));
      root.State.canvas.panX = mouseX - (mouseX - root.State.canvas.panX) * (newZoom / root.State.canvas.zoom);
      root.State.canvas.panY = mouseY - (mouseY - root.State.canvas.panY) * (newZoom / root.State.canvas.zoom);
      root.State.canvas.zoom = newZoom;
      renderCanvas();
    });
    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      root.State.canvas.isDragging = true;
      root.State.canvas.dragStartX = e.clientX - root.State.canvas.panX;
      root.State.canvas.dragStartY = e.clientY - root.State.canvas.panY;
    });
    root.addEventListener('mousemove', function (e) {
      if (root.State.canvas.isDragging) {
        root.State.canvas.panX = e.clientX - root.State.canvas.dragStartX;
        root.State.canvas.panY = e.clientY - root.State.canvas.dragStartY;
        renderCanvas();
      }
    });
    root.addEventListener('mouseup', function () {
      root.State.canvas.isDragging = false;
    });
    canvas.addEventListener('click', function (e) {
      if (!root.State.canvas.measureMode) return;
      var rect = canvas.getBoundingClientRect();
      var worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      root.State.canvas.measurePoints.push(worldPos);
      if (root.State.canvas.measurePoints.length > 2) {
        root.State.canvas.measurePoints = [worldPos];
      }
      renderCanvas();
    });
    root.addEventListener('resize', function () {
      if (root.State.activeTab === 'tabCanvas') {
        resizeCanvas();
        renderCanvas();
      }
    });
  }
  root.initCanvas = initCanvas;
  root.resizeCanvas = resizeCanvas;
  root.fitCanvasToLayout = fitCanvasToLayout;
  root.resetCanvasView = resetCanvasView;
  root.zoomCanvas = zoomCanvas;
  root.toggleCanvasLayer = toggleCanvasLayer;
  root.toggleMeasureMode = toggleMeasureMode;
  root.renderCanvas = renderCanvas;
  root.renderPourCanvasReviewBox = renderPourCanvasReviewBox;
  root.closePourReviewBox = closePourReviewBox;
  root.locateElementInCanvas = locateElementInCanvas;
  if (typeof root.initApp === 'function') {
    root.initApp();
  }
})(typeof window !== 'undefined' ? window : globalThis);
