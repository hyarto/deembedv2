/* ============================================================================
 * unified-fanout-viewer.js —— 扇出方案放大查看：画布、测距、逐孔明细
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
const UnifiedViewFanoutState = {
  idx: -1,
  zoom: 1.0,
  panX: 0,
  panY: 0,
  hoveredIndex: -1,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  downClientX: 0,
  downClientY: 0,
  measureMode: false,
  measureStartIndex: -1,
  measuredPairs: [],
  cursorPos: null,
  lastLayout: null,
  eventsBound: false
};
if (typeof window !== 'undefined') {
  window.UnifiedViewFanoutState = UnifiedViewFanoutState;
  window.UnifiedNameBuilder = UnifiedNameBuilder;
}

function hitTestUnifiedViewedVia(layout, mx, my) {
  if (!layout || !layout.vias) return -1;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < layout.vias.length; i++) {
    const v = layout.vias[i];
    const d = Math.hypot(mx - v.sx, my - v.sy);
    if (d <= layout.padR + 9 && d < bestD) { bestD = d; best = i; }
  }
  if (best < 0 && layout.callouts) {
    for (let i = 0; i < layout.callouts.length; i++) {
      const c = layout.callouts[i];
      if (mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h) return c.index;
    }
  }
  return best;
}

function toggleUnifiedViewMeasureMode(forceVal) {
  UnifiedViewFanoutState.measureMode = (typeof forceVal === 'boolean') ? forceVal : !UnifiedViewFanoutState.measureMode;
  if (!UnifiedViewFanoutState.measureMode) {
    UnifiedViewFanoutState.measureStartIndex = -1;
    UnifiedViewFanoutState.cursorPos = null;
  }
  const c = $('uViewFanoutCanvas');
  if (c && c.style) c.style.cursor = UnifiedViewFanoutState.measureMode ? 'crosshair' : 'grab';
  renderUnifiedViewMeasureUI();
  renderUnifiedViewedFanoutCanvas();
}

function clearUnifiedViewMeasurements() {
  UnifiedViewFanoutState.measureStartIndex = -1;
  UnifiedViewFanoutState.measuredPairs = [];
  UnifiedViewFanoutState.cursorPos = null;
  renderUnifiedViewMeasureUI();
  renderUnifiedViewedFanoutCanvas();
}

function removeUnifiedViewMeasuredPair(pIdx) {
  if (pIdx >= 0 && pIdx < UnifiedViewFanoutState.measuredPairs.length) {
    UnifiedViewFanoutState.measuredPairs.splice(pIdx, 1);
    renderUnifiedViewMeasureUI();
    renderUnifiedViewedFanoutCanvas();
  }
}

function handleUnifiedViewViaClick(viaIdx) {
  if (viaIdx == null || viaIdx < 0 || !UnifiedViewFanoutState.measureMode) return;
  if (UnifiedViewFanoutState.measureStartIndex < 0) {
    UnifiedViewFanoutState.measureStartIndex = viaIdx;
  } else if (UnifiedViewFanoutState.measureStartIndex === viaIdx) {
    UnifiedViewFanoutState.measureStartIndex = -1;
  } else {
    const i1 = UnifiedViewFanoutState.measureStartIndex, i2 = viaIdx;
    const exists = UnifiedViewFanoutState.measuredPairs.some(p => (p.i1 === i1 && p.i2 === i2) || (p.i1 === i2 && p.i2 === i1));
    if (!exists) UnifiedViewFanoutState.measuredPairs.push({ i1, i2 });
    UnifiedViewFanoutState.measureStartIndex = -1;
  }
  renderUnifiedViewMeasureUI();
  renderUnifiedViewedFanoutCanvas();
}

function renderUnifiedViewMeasureUI() {
  const btn = $('btnUViewMeasure');
  const clearBtn = $('btnUViewClearMeasure');
  const panel = $('uViewFanoutMeasurePanel');
  if (btn) {
    btn.className = UnifiedViewFanoutState.measureMode ? 'btn primary small' : 'btn sec small';
    btn.textContent = UnifiedViewFanoutState.measureMode ? '测孔中心距：开启' : '测孔中心距';
  }
  const hasAny = UnifiedViewFanoutState.measuredPairs.length > 0 || UnifiedViewFanoutState.measureStartIndex >= 0;
  if (clearBtn) clearBtn.style.display = hasAny ? 'inline-flex' : 'none';
  if (!panel) return;
  if (!UnifiedViewFanoutState.measureMode && UnifiedViewFanoutState.measuredPairs.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  const list = State.rules.fanoutSchemes || [];
  const sc = list[UnifiedViewFanoutState.idx];
  const layout = UnifiedViewFanoutState.lastLayout || (sc && typeof FanoutChecker !== 'undefined' ? FanoutChecker.computeSchemeViewLayout(sc, 760, 520, { showPadstack: true }) : null);
  const vias = layout ? layout.vias : [];

  let statusHtml = '';
  if (UnifiedViewFanoutState.measureMode) {
    if (UnifiedViewFanoutState.measureStartIndex < 0) {
      statusHtml = `<div style="color:#1d4ed8;font-weight:700">● 请点击效果图或下方列表中的【第 1 个孔】</div>`;
    } else {
      const sv = vias[UnifiedViewFanoutState.measureStartIndex];
      statusHtml = `<div style="color:#2563eb;font-weight:700">● 已选起点 <b>#${sv ? sv.labelNum : UnifiedViewFanoutState.measureStartIndex + 1}</b>，请点击【第 2 个孔】得出中心距</div>`;
    }
  }

  const pairRows = UnifiedViewFanoutState.measuredPairs.map((mp, idx) => {
    const v1 = vias[mp.i1], v2 = vias[mp.i2];
    if (!v1 || !v2 || typeof FanoutChecker === 'undefined') return '';
    const m = FanoutChecker.calcSchemeViaPairDistance(v1, v2);
    return `
      <div style="margin-top:6px;padding:6px 8px;background:#fff;border:1px solid #bfdbfe;border-radius:6px;font-family:var(--mono);font-size:11px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:700;color:#111827">#${m.v1Label} - #${m.v2Label} 孔中心距</span>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-weight:800;font-size:12px;color:#2563eb">${m.distMil.toFixed(2)} mil</span>
            <span style="color:#6b7280">(${m.distMm.toFixed(3)} mm)</span>
            <span onclick="removeUnifiedViewMeasuredPair(${idx})" style="cursor:pointer;color:#ef4444;font-weight:700">×</span>
          </div>
        </div>
        <div style="color:#6b7280;font-size:11px;margin-top:2px">|ΔX| = ${m.absDx.toFixed(2)} mil · |ΔY| = ${m.absDy.toFixed(2)} mil</div>
      </div>
    `;
  }).join('');

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <span style="font-weight:700;color:#1e3a8a">孔到孔中心距测量</span>
      ${hasAny ? `<span onclick="clearUnifiedViewMeasurements()" style="cursor:pointer;font-size:11px;color:#dc2626;font-weight:600">清空全部</span>` : ''}
    </div>
    ${statusHtml}
    ${pairRows}
  `;
}

function bindUnifiedViewFanoutCanvasEvents() {
  if (UnifiedViewFanoutState.eventsBound) return;
  const canvas = $('uViewFanoutCanvas');
  if (!canvas || !canvas.addEventListener) return;
  UnifiedViewFanoutState.eventsBound = true;

  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    zoomUnifiedViewFanout(e.deltaY < 0 ? 1.15 : (1 / 1.15));
  }, { passive: false });

  canvas.addEventListener('mousedown', function(e) {
    UnifiedViewFanoutState.downClientX = e.clientX;
    UnifiedViewFanoutState.downClientY = e.clientY;
    if (canvas.getBoundingClientRect) {
      const rect = canvas.getBoundingClientRect();
      const hit = hitTestUnifiedViewedVia(UnifiedViewFanoutState.lastLayout, e.clientX - rect.left, e.clientY - rect.top);
      if (UnifiedViewFanoutState.measureMode && hit >= 0) return;
    }
    UnifiedViewFanoutState.isDragging = true;
    UnifiedViewFanoutState.dragStartX = e.clientX - UnifiedViewFanoutState.panX;
    UnifiedViewFanoutState.dragStartY = e.clientY - UnifiedViewFanoutState.panY;
    if (!UnifiedViewFanoutState.measureMode) canvas.style.cursor = 'grabbing';
  });

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('mouseup', function(e) {
      const moved = Math.hypot((e.clientX || 0) - UnifiedViewFanoutState.downClientX, (e.clientY || 0) - UnifiedViewFanoutState.downClientY);
      if (UnifiedViewFanoutState.isDragging) {
        UnifiedViewFanoutState.isDragging = false;
        const c = $('uViewFanoutCanvas');
        if (c) c.style.cursor = UnifiedViewFanoutState.measureMode ? 'crosshair' : 'grab';
      }
      if (UnifiedViewFanoutState.measureMode && moved < 6) {
        const c = $('uViewFanoutCanvas');
        const modal = $('modalViewFanoutScheme');
        if (c && modal && modal.style.display === 'flex' && e.target === c && c.getBoundingClientRect) {
          const rect = c.getBoundingClientRect();
          const hit = hitTestUnifiedViewedVia(UnifiedViewFanoutState.lastLayout, e.clientX - rect.left, e.clientY - rect.top);
          if (hit >= 0) handleUnifiedViewViaClick(hit);
        }
      }
    });
  }

  canvas.addEventListener('mousemove', function(e) {
    if (UnifiedViewFanoutState.isDragging) {
      UnifiedViewFanoutState.panX = e.clientX - UnifiedViewFanoutState.dragStartX;
      UnifiedViewFanoutState.panY = e.clientY - UnifiedViewFanoutState.dragStartY;
      renderUnifiedViewedFanoutCanvas();
      return;
    }
    const layout = UnifiedViewFanoutState.lastLayout;
    if (!layout || !canvas.getBoundingClientRect) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    UnifiedViewFanoutState.cursorPos = { x: mx, y: my };

    const hit = hitTestUnifiedViewedVia(layout, mx, my);
    if (hit !== UnifiedViewFanoutState.hoveredIndex) {
      setUnifiedViewFanoutHoveredVia(hit);
    } else if (UnifiedViewFanoutState.measureMode && UnifiedViewFanoutState.measureStartIndex >= 0) {
      renderUnifiedViewedFanoutCanvas();
    }
  });

  canvas.addEventListener('mouseleave', function() {
    UnifiedViewFanoutState.cursorPos = null;
    if (!UnifiedViewFanoutState.isDragging && UnifiedViewFanoutState.hoveredIndex !== -1) {
      setUnifiedViewFanoutHoveredVia(-1);
    } else if (UnifiedViewFanoutState.measureMode && UnifiedViewFanoutState.measureStartIndex >= 0) {
      renderUnifiedViewedFanoutCanvas();
    }
  });
}

function setUnifiedViewFanoutHoveredVia(vIdx) {
  UnifiedViewFanoutState.hoveredIndex = vIdx;
  renderUnifiedViewedFanoutCanvas();
  if (typeof document !== 'undefined' && document.querySelectorAll) {
    const rows = document.querySelectorAll('#uViewFanoutViaTableBody tr');
    rows.forEach((tr, rIdx) => {
      tr.style.background = (rIdx === vIdx) ? '#fef9c3' : '';
      tr.style.outline = (rIdx === vIdx) ? '1.5px solid #eab308' : '';
    });
  }
}

function viewFanoutScheme(idx) {
  const list = State.rules.fanoutSchemes || [];
  if (!list[idx]) return;

  UnifiedViewFanoutState.idx = idx;
  UnifiedViewFanoutState.zoom = 1.0;
  UnifiedViewFanoutState.panX = 0;
  UnifiedViewFanoutState.panY = 0;
  UnifiedViewFanoutState.hoveredIndex = -1;
  UnifiedViewFanoutState.measureStartIndex = -1;
  UnifiedViewFanoutState.measuredPairs = [];
  UnifiedViewFanoutState.cursorPos = null;

  bindUnifiedViewFanoutCanvasEvents();
  const modal = $('modalViewFanoutScheme');
  if (modal) modal.style.display = 'flex';

  populateUnifiedViewedFanoutDetails(idx);
  renderUnifiedViewMeasureUI();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => renderUnifiedViewedFanoutCanvas());
  } else {
    renderUnifiedViewedFanoutCanvas();
  }
}

function closeViewFanoutSchemeModal() {
  const modal = $('modalViewFanoutScheme');
  if (modal) modal.style.display = 'none';
}

function stepUnifiedViewFanoutScheme(delta) {
  const list = State.rules.fanoutSchemes || [];
  if (!list.length) return;
  const nextIdx = ((UnifiedViewFanoutState.idx < 0 ? 0 : UnifiedViewFanoutState.idx) + delta + list.length) % list.length;
  viewFanoutScheme(nextIdx);
}

function editCurrentUnifiedViewedFanout() {
  const idx = UnifiedViewFanoutState.idx;
  closeViewFanoutSchemeModal();
  if (idx >= 0) editFanoutScheme(idx);
}

function zoomUnifiedViewFanout(factor) {
  UnifiedViewFanoutState.zoom = Math.max(0.4, Math.min(5.0, UnifiedViewFanoutState.zoom * factor));
  renderUnifiedViewedFanoutCanvas();
}

function resetUnifiedViewFanoutTransform() {
  UnifiedViewFanoutState.zoom = 1.0;
  UnifiedViewFanoutState.panX = 0;
  UnifiedViewFanoutState.panY = 0;
  renderUnifiedViewedFanoutCanvas();
}

function populateUnifiedViewedFanoutDetails(idx) {
  const list = State.rules.fanoutSchemes || [];
  const sc = list[idx];
  if (!sc || typeof FanoutChecker === 'undefined') return;

  if ($('uViewFanoutTitle')) $('uViewFanoutTitle').textContent = sc.name || `扇出方案_${idx + 1}`;
  if ($('uViewFanoutTag')) $('uViewFanoutTag').textContent = sc.tag || sc.category || '扇出方案';
  if ($('uViewFanoutIndexBadge')) $('uViewFanoutIndexBadge').textContent = `(${idx + 1} / ${list.length})`;
  if ($('uViewFanoutDesc')) $('uViewFanoutDesc').textContent = sc.desc || sc.description || '标准扇出几何拓扑与焊盘定义';

  const layout = FanoutChecker.computeSchemeViewLayout(sc, 760, 520, { showPadstack: true, librarySchemes: list });
  const { summary, vias } = layout;
  const padColorList = layout.padstackColors || [];
  const pitchRange = summary.viaCount >= 2 ? `${summary.minDist.toFixed(1)} ~ ${summary.maxDist.toFixed(1)} mil` : '单孔';

  if ($('uViewFanoutPadLegend')) {
    $('uViewFanoutPadLegend').innerHTML = padColorList.map(pc =>
      `<span style="display:inline-flex;align-items:center;gap:4px;font-family:var(--mono)" title="Padstack: ${pc.padstack}"><span style="width:10px;height:10px;border-radius:50%;background:${pc.fill};border:1.5px solid #0f172a;display:inline-block"></span><span style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${pc.padstack}</span></span>`
    ).join('');
  }

  const padTags = padColorList.map(pc =>
    `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 8px;background:#fff;border:1px solid #e3e8ef;border-left:4px solid ${pc.fill};border-radius:5px;margin-top:4px;font-family:var(--mono);font-size:11px"><span style="display:inline-flex;align-items:center;gap:6px;word-break:break-all;color:#111827;font-weight:600"><span style="width:9px;height:9px;border-radius:50%;background:${pc.fill};flex-shrink:0"></span>${pc.padstack}</span><span style="color:${pc.badgeText};background:${pc.badgeBg};padding:0 6px;border-radius:4px;font-weight:700;white-space:nowrap">×${pc.count}</span></div>`
  ).join('');

  if ($('uViewFanoutSummaryBox')) {
    $('uViewFanoutSummaryBox').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px">
        <div>过孔总数: <b style="color:#111827">${summary.viaCount} 个孔</b></div>
        <div>信号 / 地孔: <b style="color:#2563eb">${summary.sigCount}</b> / <b style="color:#059669">${summary.gndCount}</b></div>
        <div style="grid-column:1/-1">孔心距范围: <b style="color:#111827;font-family:var(--mono)">${pitchRange}</b></div>
      </div>
      <div style="margin-top:8px;padding-top:6px;border-top:1px dashed #cbd5e1">
        <div style="font-weight:700;color:#374151;font-size:12px">焊盘 (Padstack) 专属颜色汇总：</div>
        ${padTags || '<div style="color:#94a3b8">无焊盘定义</div>'}
      </div>
    `;
  }

  if ($('uViewFanoutViaTableBody')) {
    $('uViewFanoutViaTableBody').innerHTML = vias.map((v, i) => `
      <tr onmouseenter="setUnifiedViewFanoutHoveredVia(${i})" onmouseleave="setUnifiedViewFanoutHoveredVia(-1)" onclick="if(!UnifiedViewFanoutState.measureMode) toggleUnifiedViewMeasureMode(true); handleUnifiedViewViaClick(${i});" title="点击可选取该孔测量中心距" style="cursor:pointer;transition:background .12s">
        <td style="padding:6px 8px;font-family:var(--mono);font-weight:700;color:#111827">
          <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:9px;height:9px;border-radius:50%;background:${v.padColor};border:1px solid #0f172a;display:inline-block"></span>#${v.labelNum}</span>
        </td>
        <td style="padding:6px 8px">
          <span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:700;background:${v.padBadgeBg || (v.isSig ? '#f1f5f9' : '#dcfce7')};color:${v.padBadgeText || (v.isSig ? '#1d4ed8' : '#15803d')}">
            ${v.isSig ? '信号' : 'GND'}
          </span>
        </td>
        <td style="padding:6px 8px">
          <div style="font-family:var(--mono);font-weight:700;color:#111827;word-break:break-all;font-size:12px">${v.padstack}</div>
          <div style="font-size:11px;color:#6b7280;font-family:var(--mono)">[${v.x.toFixed(1)}, ${v.y.toFixed(1)}] mil · ${v.role}</div>
        </td>
      </tr>
    `).join('');
  }
}

function renderUnifiedViewedFanoutCanvas() {
  const list = State.rules.fanoutSchemes || [];
  const sc = list[UnifiedViewFanoutState.idx];
  const canvas = $('uViewFanoutCanvas');
  const wrap = $('uViewFanoutCanvasWrap');
  if (!sc || !canvas || typeof FanoutChecker === 'undefined') return;

  const w = (wrap && wrap.clientWidth > 100) ? wrap.clientWidth : 760;
  const h = (wrap && wrap.clientHeight > 100) ? wrap.clientHeight : 520;
  const showPadstack = $('chkUViewPadstack') ? $('chkUViewPadstack').checked : true;
  const showCoords = $('chkUViewCoords') ? $('chkUViewCoords').checked : false;
  const showDistances = $('chkUViewDistances') ? $('chkUViewDistances').checked : false;

  UnifiedViewFanoutState.lastLayout = FanoutChecker.renderSchemeEnlargedCanvas(canvas, sc, {
    width: w,
    height: h,
    zoom: UnifiedViewFanoutState.zoom,
    panX: UnifiedViewFanoutState.panX,
    panY: UnifiedViewFanoutState.panY,
    showPadstack,
    showCoords,
    showDistances,
    librarySchemes: list,
    hoveredIndex: UnifiedViewFanoutState.hoveredIndex,
    measureMode: UnifiedViewFanoutState.measureMode,
    measureStartIndex: UnifiedViewFanoutState.measureStartIndex,
    measuredPairs: UnifiedViewFanoutState.measuredPairs,
    cursorPos: UnifiedViewFanoutState.cursorPos
  });
}

function exportUnifiedViewedFanoutPng() {
  const list = State.rules.fanoutSchemes || [];
  const sc = list[UnifiedViewFanoutState.idx];
  const canvas = $('uViewFanoutCanvas');
  if (!sc || !canvas || !canvas.toDataURL) return;
  try {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${sc.name || '扇出方案'}_Padstack效果图.png`;
    a.click();
  } catch (e) {
    showToast('导出图片失败: ' + e.message, false);
  }
}

