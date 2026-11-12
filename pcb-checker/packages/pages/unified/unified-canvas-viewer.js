/* ============================================================================
 * unified-canvas-viewer.js —— 全局 2D 空间视口：渲染、缩放、测距与缺陷定位
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
function initCanvas() {
  const canvas = $('mainCanvas');
  if (!canvas) return;

  canvas.addEventListener('mousedown', e => {
    State.canvas.isDragging = true;
    State.canvas.dragStartX = e.clientX - State.canvas.panX;
    State.canvas.dragStartY = e.clientY - State.canvas.panY;
  });

  window.addEventListener('mousemove', e => {
    if (State.canvas.isDragging) {
      State.canvas.panX = e.clientX - State.canvas.dragStartX;
      State.canvas.panY = e.clientY - State.canvas.dragStartY;
      renderCanvas();
    }
  });

  window.addEventListener('mouseup', () => {
    State.canvas.isDragging = false;
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.85;
    zoomCanvas(factor);
  }, { passive: false });
}

function resizeCanvas() {
  const canvas = $('mainCanvas');
  const container = $('canvasContainer');
  if (!canvas || !container) return;
  canvas.width = container.clientWidth || 900;
  canvas.height = container.clientHeight || 650;
}

function worldToScreen(wx, wy) {
  return {
    x: wx * State.canvas.scale + State.canvas.panX,
    y: wy * State.canvas.scale + State.canvas.panY
  };
}

function screenToWorld(sx, sy) {
  return {
    x: (sx - State.canvas.panX) / State.canvas.scale,
    y: (sy - State.canvas.panY) / State.canvas.scale
  };
}

function getNetColor(netName) {
  const map = {
    '26_N': '#22c55e',
    '26_P': '#06b6d4',
    '25_N': '#c084fc',
    '25_P': '#84cc16',
    '105_P': '#38bdf8',
    '105_N': '#f59e0b',
    '106_P': '#ec4899',
    '106_N': '#eab308',
    '19IS08_25_N': '#c084fc',
    '19IS08_25_P': '#84cc16',
    '08IS03_26_N': '#22c55e',
    '08IS03_26_P': '#06b6d4',
    'GND': '#64748b'
  };
  if (netName && map[netName]) return map[netName];
  if (!netName) return '#38bdf8';
  
  let hash = 0;
  for (let i = 0; i < netName.length; i++) {
    hash = netName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
  return '#' + '00000'.substring(0, 6 - c.length) + c;
}

function fitCanvasToLayout() {
  const canvas = $('mainCanvas');
  if (!canvas) return;
  const { vias, traces, shapes } = State.elements;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  // 1. Include Vias
  vias.forEach(v => {
    const vx = v.x != null ? v.x : (v.origin ? v.origin[0] : 0);
    const vy = v.y != null ? v.y : (v.origin ? v.origin[1] : 0);
    if (vx || vy) {
      minX = Math.min(minX, vx - 25); maxX = Math.max(maxX, vx + 25);
      minY = Math.min(minY, vy - 25); maxY = Math.max(maxY, vy + 25);
    }
  });

  // 2. Include Traces
  traces.forEach(t => {
    const segs = (t.segments && t.segments.length > 0) ? t.segments : [t];
    segs.forEach(s => {
      const x1 = s.x1 != null ? s.x1 : (s.start ? s.start[0] : (s.p1 ? s.p1[0] : 0));
      const y1 = s.y1 != null ? s.y1 : (s.start ? s.start[1] : (s.p1 ? s.p1[1] : 0));
      const x2 = s.x2 != null ? s.x2 : (s.end ? s.end[0] : (s.p2 ? s.p2[0] : 0));
      const y2 = s.y2 != null ? s.y2 : (s.end ? s.end[1] : (s.p2 ? s.p2[1] : 0));

      if (x1 || y1 || x2 || y2) {
        minX = Math.min(minX, x1, x2); maxX = Math.max(maxX, x1, x2);
        minY = Math.min(minY, y1, y2); maxY = Math.max(maxY, y1, y2);
      }
      if (s.cx != null && s.radius != null) {
        minX = Math.min(minX, s.cx - s.radius); maxX = Math.max(maxX, s.cx + s.radius);
        minY = Math.min(minY, s.cy - s.radius); maxY = Math.max(maxY, s.cy + s.radius);
      }
    });
  });

  // 3. Include Copper Shapes
  shapes.forEach(sh => {
    const pts = sh.polygon || sh.points || [];
    pts.forEach(pt => {
      minX = Math.min(minX, pt[0]); maxX = Math.max(maxX, pt[0]);
      minY = Math.min(minY, pt[1]); maxY = Math.max(maxY, pt[1]);
    });
  });

  if (minX === Infinity || minX === maxX || minY === maxY) {
    minX = 20900; maxX = 22700; minY = 35400; maxY = 35700;
  }

  const padding = 50;
  const cw = Math.max(100, (canvas.width || 900) - padding * 2);
  const ch = Math.max(100, (canvas.height || 650) - padding * 2);
  const ww = Math.max(maxX - minX, 20);
  const wh = Math.max(maxY - minY, 20);

  const scale = Math.min(cw / ww, ch / wh) * 0.95;
  State.canvas.scale = Math.max(0.0001, scale);
  State.canvas.panX = padding + (cw - ww * scale) / 2 - minX * scale;
  State.canvas.panY = padding + (ch - wh * scale) / 2 - minY * scale;

  renderCanvas();
}

function resetCanvasView() {
  fitCanvasToLayout();
}

function zoomCanvas(factor) {
  const canvas = $('mainCanvas');
  const cx = (canvas?.width || 900) / 2;
  const cy = (canvas?.height || 650) / 2;

  const newScale = Math.max(0.0001, Math.min(200, State.canvas.scale * factor));
  State.canvas.panX = cx - (cx - State.canvas.panX) * (newScale / State.canvas.scale);
  State.canvas.panY = cy - (cy - State.canvas.panY) * (newScale / State.canvas.scale);
  State.canvas.scale = newScale;
  requestCanvasRender();
}

function toggleLayer(layerKey) {
  if (layerKey === 'shapes') {
    State.canvas.showShapes = !State.canvas.showShapes;
    $('btnTogShapes')?.classList.toggle('active', State.canvas.showShapes);
  } else if (layerKey === 'vias') {
    State.canvas.showVias = !State.canvas.showVias;
    $('btnTogVias')?.classList.toggle('active', State.canvas.showVias);
  } else if (layerKey === 'traces') {
    State.canvas.showTraces = !State.canvas.showTraces;
    $('btnTogTraces')?.classList.toggle('active', State.canvas.showTraces);
  } else if (layerKey === 'ports') {
    State.canvas.showPorts = !State.canvas.showPorts;
    $('btnTogPorts')?.classList.toggle('active', State.canvas.showPorts);
  } else if (layerKey === 'defects') {
    State.canvas.showDefects = !State.canvas.showDefects;
    $('btnTogDefects')?.classList.toggle('active', State.canvas.showDefects);
  }
  renderCanvas();
}

function toggleMeasure() {
  State.canvas.measuring = !State.canvas.measuring;
  State.canvas.measurePoints = [];
  $('btnMeasure')?.classList.toggle('active', State.canvas.measuring);
  if (State.canvas.measuring) showToast('在画布上依次点击两点测量距离');
  renderCanvas();
}

function renderCanvas() {
  const canvas = $('mainCanvas');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Grid Background
  ctx.save();
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 0.5;
  const gridSize = 50 * State.canvas.scale;
  if (gridSize > 8) {
    const startX = ((State.canvas.panX % gridSize) + gridSize) % gridSize;
    const startY = ((State.canvas.panY % gridSize) + gridSize) % gridSize;
    for (let x = startX; x < canvas.width; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = startY; y < canvas.height; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
  }
  ctx.restore();

  const { vias, traces, shapes } = State.elements;

  // 2. Render Copper Shapes
  if (State.canvas.showShapes && shapes.length) {
    shapes.forEach(sh => {
      const pts = sh.polygon || sh.points || [];
      if (pts.length < 3) return;
      ctx.save();
      ctx.beginPath();
      const p0 = worldToScreen(pts[0][0], pts[0][1]);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < pts.length; i++) {
        const pt = worldToScreen(pts[i][0], pts[i][1]);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  }

  // 3. Render Traces (Full Line + Arc Segments Color-coded by Net)
  if (State.canvas.showTraces && traces.length) {
    traces.forEach(t => {
      const col = getNetColor(t.net);
      ctx.save();
      ctx.strokeStyle = col;
      const w = t.width || 6;
      ctx.lineWidth = Math.max(2, w * State.canvas.scale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const segs = (t.segments && t.segments.length > 0) ? t.segments : [t];

      segs.forEach(s => {
        const isArc = s.type === 'arc' || s.isArc || s.kind === 'arc';
        if (isArc) {
          const cx = s.cx != null ? s.cx : (s.center ? s.center[0] : 0);
          const cy = s.cy != null ? s.cy : (s.center ? s.center[1] : 0);
          const r = s.radius || 18.0;
          const x1 = s.x1 != null ? s.x1 : (s.start ? s.start[0] : (s.p1 ? s.p1[0] : 0));
          const y1 = s.y1 != null ? s.y1 : (s.start ? s.start[1] : (s.p1 ? s.p1[1] : 0));
          const x2 = s.x2 != null ? s.x2 : (s.end ? s.end[0] : (s.p2 ? s.p2[0] : 0));
          const y2 = s.y2 != null ? s.y2 : (s.end ? s.end[1] : (s.p2 ? s.p2[1] : 0));

          const scCenter = worldToScreen(cx, cy);
          const scRad = r * State.canvas.scale;
          const a1 = Math.atan2(y1 - cy, x1 - cx);
          const a2 = Math.atan2(y2 - cy, x2 - cx);
          const isCCW = (s.dir === 'CCW' || s.isClockwise === false);

          ctx.beginPath();
          ctx.arc(scCenter.x, scCenter.y, Math.max(1, scRad), a1, a2, !isCCW);
          ctx.stroke();
        } else {
          // Line segment
          const x1 = s.x1 != null ? s.x1 : (s.start ? s.start[0] : (s.p1 ? s.p1[0] : 0));
          const y1 = s.y1 != null ? s.y1 : (s.start ? s.start[1] : (s.p1 ? s.p1[1] : 0));
          const x2 = s.x2 != null ? s.x2 : (s.end ? s.end[0] : (s.p2 ? s.p2[0] : 0));
          const y2 = s.y2 != null ? s.y2 : (s.end ? s.end[1] : (s.p2 ? s.p2[1] : 0));

          if (x1 || y1 || x2 || y2) {
            const p1 = worldToScreen(x1, y1);
            const p2 = worldToScreen(x2, y2);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      });
      ctx.restore();
    });
  }

  // 4. Render Vias (Batched & Frustum Culled for 60FPS Performance)
  if (State.canvas.showVias && vias.length) {
    const wTopLeft = screenToWorld(0, 0);
    const wBotRight = screenToWorld(canvas.width, canvas.height);
    const viewMinX = Math.min(wTopLeft.x, wBotRight.x) - 30;
    const viewMaxX = Math.max(wTopLeft.x, wBotRight.x) + 30;
    const viewMinY = Math.min(wTopLeft.y, wBotRight.y) - 30;
    const viewMaxY = Math.max(wTopLeft.y, wBotRight.y) + 30;

    const gndPath = new Path2D();
    const sigPath = new Path2D();
    const drillPath = new Path2D();
    const labels = [];
    const showLabels = State.canvas.scale > 0.15;

    for (let i = 0; i < vias.length; i++) {
      const v = vias[i];
      const vx = v.x != null ? v.x : (v.origin ? v.origin[0] : 0);
      const vy = v.y != null ? v.y : (v.origin ? v.origin[1] : 0);

      // Frustum culling
      if (vx < viewMinX || vx > viewMaxX || vy < viewMinY || vy > viewMaxY) continue;

      const sp = worldToScreen(vx, vy);
      const isGnd = /GND/i.test(v.net) || /GND/i.test(v.padstack);
      const padDiam = isGnd ? 7.906 : 9.94;
      const padRadScreen = Math.max(3, (padDiam / 2) * State.canvas.scale);
      const drillRadScreen = Math.max(1.5, (5.54 / 2) * State.canvas.scale);

      if (isGnd) {
        gndPath.moveTo(sp.x + padRadScreen, sp.y);
        gndPath.arc(sp.x, sp.y, padRadScreen, 0, Math.PI * 2);
      } else {
        sigPath.moveTo(sp.x + padRadScreen, sp.y);
        sigPath.arc(sp.x, sp.y, padRadScreen, 0, Math.PI * 2);
      }

      drillPath.moveTo(sp.x + drillRadScreen, sp.y);
      drillPath.arc(sp.x, sp.y, drillRadScreen, 0, Math.PI * 2);

      if (showLabels) {
        labels.push({ text: v.net || v.name || `#${v.id}`, x: sp.x, y: sp.y - padRadScreen - 3, color: isGnd ? '#94a3b8' : '#38bdf8' });
      }
    }

    // Draw GND in 1 batch
    ctx.fillStyle = '#475569';
    ctx.fill(gndPath);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.2;
    ctx.stroke(gndPath);

    // Draw Signal in 1 batch
    ctx.fillStyle = '#6366f1';
    ctx.fill(sigPath);
    ctx.strokeStyle = '#a5b4fc';
    ctx.lineWidth = 1.5;
    ctx.stroke(sigPath);

    // Draw Padstack Error Vias in RED
    if (typeof State !== 'undefined' && State.results && State.results.fanout && State.results.fanout.checks) {
      const padErrPath = new Path2D();
      State.results.fanout.checks.forEach(chk => {
        if (!chk.pass && chk.padMismatchList) {
          chk.padMismatchList.forEach(pm => {
            const v = vias.find(x => x.id == pm.viaId);
            if (v) {
              const vx = v.x != null ? v.x : (v.origin ? v.origin[0] : 0);
              const vy = v.y != null ? v.y : (v.origin ? v.origin[1] : 0);
              const sp = worldToScreen(vx, vy);
              const padRadScreen = Math.max(3.5, 4.0 * State.canvas.scale);
              padErrPath.moveTo(sp.x + padRadScreen, sp.y);
              padErrPath.arc(sp.x, sp.y, padRadScreen, 0, Math.PI * 2);
            }
          });
        }
      });
      ctx.fillStyle = '#ef4444';
      ctx.fill(padErrPath);
      ctx.strokeStyle = '#fee2e2';
      ctx.lineWidth = 2;
      ctx.stroke(padErrPath);
    }

    // Draw Drills in 1 batch
    ctx.fillStyle = '#0f172a';
    ctx.fill(drillPath);

    // Draw labels
    if (labels.length > 0 && labels.length < 400) {
      ctx.font = '10px var(--mono)';
      ctx.textAlign = 'center';
      for (let i = 0; i < labels.length; i++) {
        ctx.fillStyle = labels[i].color;
        ctx.fillText(labels[i].text, labels[i].x, labels[i].y);
      }
    }
  }

  // 5. Render Defect Markers
  if (State.canvas.showDefects && State.allChecks.length) {
    const fails = State.allChecks.filter(c => !c.pass);
    fails.forEach(f => {
      let pt = null;
      if (f.viaCoord) {
        pt = worldToScreen(f.viaCoord[0], f.viaCoord[1]);
      } else if (f.objId) {
        const v = vias.find(x => x.id == f.objId);
        if (v) {
          const vx = v.x != null ? v.x : (v.origin ? v.origin[0] : 0);
          const vy = v.y != null ? v.y : (v.origin ? v.origin[1] : 0);
          pt = worldToScreen(vx, vy);
        } else {
          const t = traces.find(x => x.id == f.objId);
          if (t) {
            const segs = (t.segments && t.segments.length > 0) ? t.segments : [t];
            const s = segs[0];
            const x1 = s.x1 != null ? s.x1 : (s.start ? s.start[0] : (s.p1 ? s.p1[0] : 0));
            const y1 = s.y1 != null ? s.y1 : (s.start ? s.start[1] : (s.p1 ? s.p1[1] : 0));
            pt = worldToScreen(x1, y1);
          }
        }
      }

      if (pt) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
        ctx.restore();
      }
    });
  }

  // 6. Interactive Measure Line
  if (State.canvas.measuring && State.canvas.measurePoints.length) {
    ctx.save();
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    const p1 = State.canvas.measurePoints[0];
    ctx.moveTo(p1.x, p1.y);
    if (State.canvas.measurePoints[1]) {
      const p2 = State.canvas.measurePoints[1];
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      const w1 = screenToWorld(p1.x, p1.y);
      const w2 = screenToWorld(p2.x, p2.y);
      const dist = Math.sqrt((w1.x - w2.x) ** 2 + (w1.y - w2.y) ** 2);
      ctx.fillStyle = '#facc15';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(`${dist.toFixed(2)} mil (${(dist * 0.0254).toFixed(3)} mm)`, (p1.x + p2.x) / 2 + 8, (p1.y + p2.y) / 2 - 8);
    }
    ctx.restore();
  }

  // 7. Render Highlight Target Focus Reticle & Zoom Banner (When located from checklist)
  if (State.canvas.highlightTarget) {
    const ht = State.canvas.highlightTarget;
    const sp = worldToScreen(ht.x, ht.y);

    ctx.save();
    // Glowing pulse rings
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 46, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
    ctx.lineWidth = 8;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 30, 0, Math.PI * 2);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 4]);
    ctx.stroke();

    // Crosshairs
    ctx.setLineDash([]);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sp.x - 42, sp.y); ctx.lineTo(sp.x - 14, sp.y);
    ctx.moveTo(sp.x + 14, sp.y); ctx.lineTo(sp.x + 42, sp.y);
    ctx.moveTo(sp.x, sp.y - 42); ctx.lineTo(sp.x, sp.y - 14);
    ctx.moveTo(sp.x, sp.y + 14); ctx.lineTo(sp.x, sp.y + 42);
    ctx.stroke();

    // Center focal point
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Callout Box
    const labelTxt = `【缺陷定位焦点】 ${ht.label || ''}`;
    ctx.font = 'bold 13.5px sans-serif';
    const txtWidth = ctx.measureText(labelTxt).width;
    const boxW = txtWidth + 24;
    const boxH = 30;
    const boxX = sp.x - boxW / 2;
    const boxY = sp.y - 68;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.fillStyle = '#fef08a';
    ctx.textAlign = 'center';
    ctx.fillText(labelTxt, sp.x, boxY + 20);
    ctx.restore();
  }
}

function closeUnifiedCanvasReviewBox() {
  const box = $('unifiedCanvasReviewBox');
  if (box) box.style.display = 'none';
  State.canvas.activeReviewCheckId = null;
}

function renderUnifiedCanvasReviewBox(checkId) {
  const box = $('unifiedCanvasReviewBox');
  const titleEl = $('unifiedCanvasRevTitle');
  const bodyEl = $('unifiedCanvasRevBody');
  if (!box || !bodyEl) return;

  const chk = State.allChecks.find(c => c.id == checkId || c.objId == checkId);
  if (!chk) {
    box.style.display = 'none';
    return;
  }

  State.canvas.activeReviewCheckId = chk.id;
  const isReviewed = State.reviewedSet.has(chk.id);
  if (titleEl) {
    titleEl.textContent = `[${chk.categoryName || '检查项'}] ${chk.target || chk.id}`;
  }

  const barBg = isReviewed
    ? 'background:rgba(16,185,129,.18);border:1px solid rgba(52,211,153,.55);'
    : 'background:rgba(245,158,11,.15);border:1px solid rgba(251,191,36,.45);';

  bodyEl.innerHTML = `
    ${!chk.pass ? `
      <div style="${barBg}border-radius:6px;padding:8px 10px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:8px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:700;color:${isReviewed ? '#6ee7b7' : '#fde68a'};margin:0">
          <input type="checkbox" id="chkUnifiedSpatialReview" ${isReviewed ? 'checked' : ''} onchange="toggleReview('${chk.id}', this.checked)" style="width:15px;height:15px;cursor:pointer;accent-color:#10b981">
          <span>${isReviewed ? '已复核，清单已同步' : '勾选复核此异常'}</span>
        </label>
        <button class="btn small" onclick="toggleReview('${chk.id}', ${!isReviewed})" style="padding:3px 9px;font-size:11px;border:none;background:${isReviewed ? 'rgba(51,65,85,.9)' : '#10b981'};color:#fff">
          ${isReviewed ? '取消复核' : ' 确认复核'}
        </button>
      </div>
    ` : ''}
    <div style="font-size:12px;color:#cbd5e1;line-height:1.55;margin-bottom:8px">
      <div>物理层: <strong style="color:#cbd5e1">${escHtml(chk.layer || '-')}</strong> | 检查项: <strong>${escHtml(chk.item || '-')}</strong></div>
      <div>实测 vs 规则: <strong style="font-family:var(--mono);color:#fef08a">${chk.actual || '-'}</strong> / <span style="font-family:var(--mono)">${chk.rule || '-'}</span></div>
      <div style="margin-top:4px;color:#94a3b8">${escHtml(chk.reason || '')}</div>
    </div>
    <div style="display:flex;justify-content:flex-end">
      <button class="btn sec small" onclick="switchTab('tabDefects')" style="padding:4px 10px;font-size:12px">返回检查结果清单</button>
    </div>
  `;
  box.style.display = 'block';
}

function locateDefectInCanvas(category, id) {
  // 1. Find target defect item or object in State.allChecks or elements
  const fails = State.allChecks.filter(c => !c.pass);
  const target = fails.find(f => f.id == id) || State.allChecks.find(f => f.id == id) || fails.find(f => f.objId == id) || State.allChecks.find(f => f.objId == id);
  const searchId = (target && target.objId != null) ? target.objId : id;

  let targetX = null, targetY = null;
  let targetLabel = '';

  if (target && target.viaCoord) {
    targetX = target.viaCoord[0];
    targetY = target.viaCoord[1];
    targetLabel = `${target.target || '过孔'} · ${target.item || '缺陷'}`;
  } else if (searchId != null) {
    const v = State.elements.vias.find(x => x.id == searchId || x.id == id);
    if (v) {
      targetX = v.x != null ? v.x : (v.origin ? v.origin[0] : 0);
      targetY = v.y != null ? v.y : (v.origin ? v.origin[1] : 0);
      targetLabel = `Via #${v.id} · ${v.net || '过孔'}`;
    } else {
      let t = State.elements.traces.find(x => x.id == searchId || x.id == id);
      if (!t && target) {
        const matchingNet = target.target || target.objId;
        t = State.elements.traces.find(x => x.net === matchingNet || (matchingNet && (matchingNet.includes(x.net) || x.net.includes(matchingNet))));
      }
      if (t) {
        const segs = (t.segments && t.segments.length > 0) ? t.segments : [t];
        const s = segs[0];
        const x1 = s.x1 != null ? s.x1 : (s.start ? s.start[0] : (s.p1 ? s.p1[0] : 0));
        const y1 = s.y1 != null ? s.y1 : (s.start ? s.start[1] : (s.p1 ? s.p1[1] : 0));
        const x2 = s.x2 != null ? s.x2 : (s.end ? s.end[0] : (s.p2 ? s.p2[0] : x1));
        const y2 = s.y2 != null ? s.y2 : (s.end ? s.end[1] : (s.p2 ? s.p2[1] : y1));
        targetX = (x1 + x2) / 2;
        targetY = (y1 + y2) / 2;
        targetLabel = `${t.net || '走线'} (ID: ${t.id})`;
      }
    }
  }

  // 2. Switch tab without autoFit resetting the view
  switchTab('tabCanvas', false);
  resizeCanvas();

  if (targetX != null && targetY != null) {
    const canvas = $('mainCanvas');
    const cx = (canvas?.width || 900) / 2;
    const cy = (canvas?.height || 650) / 2;

    // Magnify onto the defect location (scale = 5.0 for close-up inspection)
    const targetScale = 5.0;
    State.canvas.scale = targetScale;
    State.canvas.panX = cx - targetX * targetScale;
    State.canvas.panY = cy - targetY * targetScale;

    // Set highlighted target marker
    State.canvas.highlightTarget = {
      x: targetX,
      y: targetY,
      label: targetLabel || `缺陷点 X ${targetX.toFixed(1)} · Y ${targetY.toFixed(1)}`,
      time: Date.now()
    };

    renderCanvas();
    if (target) renderUnifiedCanvasReviewBox(target.id);
    showToast(`已定位缺陷 X ${targetX.toFixed(1)} · Y ${targetY.toFixed(1)}`);
  } else {
    fitCanvasToLayout();
    if (target) renderUnifiedCanvasReviewBox(target.id);
  }
}

/**
 * 通用弹窗与导出系统
 */
