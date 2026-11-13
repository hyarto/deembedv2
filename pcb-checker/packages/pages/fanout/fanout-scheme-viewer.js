/* ============================================================================
 * fanout-scheme-viewer.js —— 扇出方案检查模块：快捷关键词命名器与方案放大查看/孔心距测量
 * ========================================================================== */
(function (root) {
  "use strict";

  var FC = root.FanoutChecker;
  var State = root.State;
  var escapeHtml = root.escHtml || function (s) { return String(s == null ? "" : s); };
  var safeRAF = root.safeRAF || function (fn) { setTimeout(fn, 0); };
  var SchemeNameBuilder = root.SchemeNameBuilder;
  var ViewSchemeState = root.ViewSchemeState;
  var KW_STORAGE_KEY = "fanout_custom_scheme_keywords_v1";

  var renderSchemeCards = function () { if (root.renderSchemeCards) root.renderSchemeCards(); };
  var openSchemeModal = function (s) { if (root.openSchemeModal) root.openSchemeModal(s); };

  /* ---------- 快捷关键词命名器 ---------- */
  function loadCustomSchemeKeywords() {
    if (SchemeNameBuilder.loaded) return;
    SchemeNameBuilder.loaded = true;
    try {
      var raw = localStorage.getItem(KW_STORAGE_KEY);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          SchemeNameBuilder.customKeywords = arr.map(function (s) { return String(s).trim(); })
            .filter(function (s) { return s && SchemeNameBuilder.presetKeywords.indexOf(s) < 0; });
        }
      }
    } catch (e) {}
  }

  function saveCustomSchemeKeywords() {
    try { localStorage.setItem(KW_STORAGE_KEY, JSON.stringify(SchemeNameBuilder.customKeywords)); } catch (e) {}
  }

  function getAllSchemeKeywords() {
    loadCustomSchemeKeywords();
    return SchemeNameBuilder.presetKeywords.concat(SchemeNameBuilder.customKeywords);
  }

  function getSchemeNameTargetInput(ctx) {
    return document.getElementById(ctx === 'quick' ? 'inpQuickRenameName' : 'modalInpName');
  }

  function renderSchemeKeywordUI(ctx) {
    loadCustomSchemeKeywords();
    var seqBar = document.getElementById(ctx === 'quick' ? 'quickKwSeqBar' : 'modalKwSeqBar');
    var chipsWrap = document.getElementById(ctx === 'quick' ? 'quickKwChips' : 'modalKwChips');
    if (!seqBar || !chipsWrap) return;

    var seq = SchemeNameBuilder.seq[ctx] || [];
    var counts = {};
    seq.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });

    if (!seq.length) {
      seqBar.innerHTML = '<span style="color:var(--sub);font-size:12px">点击下方关键词按顺序以 <code>_</code> 拼接</span>';
    } else {
      seqBar.innerHTML = seq.map(function (tok, idx) {
        return '<span onclick="removeSchemeKeywordAt(\'' + ctx + '\', ' + idx + ')" data-tip="点击移除该词块" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;background:#f1f5f9;color:var(--pri-d);border:1px solid #cbd5e1;border-radius:5px;padding:2px 7px;font-family:var(--mono);font-size:12px;font-weight:700">' +
          '<span style="font-size:11px;color:var(--pri)">' + (idx + 1) + '.</span>' + escapeHtml(tok) + '<span style="margin-left:2px">×</span></span>';
      }).join('<span style="color:#9ca3af;font-family:var(--mono);font-weight:700">_</span>');
    }

    chipsWrap.innerHTML = getAllSchemeKeywords().map(function (kw) {
      var cnt = counts[kw] || 0;
      var isCustom = SchemeNameBuilder.customKeywords.indexOf(kw) >= 0;
      var activeStyle = cnt > 0
        ? 'background:var(--pri);color:#ffffff;border:1px solid var(--pri-d)'
        : 'background:#ffffff;color:var(--txt);border:1px solid #cbd5e1';
      var kwEsc = escapeHtml(kw).replace(/'/g, "\\'");
      return '<button type="button" onclick="clickSchemeKeyword(\'' + ctx + '\', \'' + kwEsc + '\')" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:4px 9px;border-radius:6px;font-family:var(--mono);font-size:12px;font-weight:600;' + activeStyle + '">' +
        '<span>' + escapeHtml(kw) + '</span>' +
        (cnt > 0 ? ('<span style="background:rgba(255,255,255,0.25);color:#fff;border-radius:9px;padding:0 5px;font-size:11px;font-weight:700">×' + cnt + '</span>') : '') +
        (isCustom ? ('<span onclick="deleteCustomSchemeKeyword(\'' + kwEsc + '\', event)" style="margin-left:2px;font-size:11px">×</span>') : '') +
        '</button>';
    }).join('');
  }

  function syncSchemeNameFromSeq(ctx) {
    var tokens = SchemeNameBuilder.seq[ctx] || [];
    var inp = getSchemeNameTargetInput(ctx);
    if (inp && tokens.length > 0) inp.value = FC.buildSchemeNameFromKeywords(tokens);
    else if (inp && tokens.length === 0 && ctx === 'quick') inp.value = '';
    renderSchemeKeywordUI(ctx);
  }

  function clickSchemeKeyword(ctx, kw) {
    var clean = String(kw || '').trim();
    if (!clean) return;
    if (!SchemeNameBuilder.seq[ctx]) SchemeNameBuilder.seq[ctx] = [];
    SchemeNameBuilder.seq[ctx].push(clean);
    syncSchemeNameFromSeq(ctx);
  }

  function removeSchemeKeywordAt(ctx, index) {
    var arr = SchemeNameBuilder.seq[ctx] || [];
    if (index >= 0 && index < arr.length) { arr.splice(index, 1); syncSchemeNameFromSeq(ctx); }
  }

  function undoSchemeKeyword(ctx) {
    var arr = SchemeNameBuilder.seq[ctx] || [];
    if (arr.length > 0) { arr.pop(); syncSchemeNameFromSeq(ctx); }
  }

  function clearSchemeKeywords(ctx) {
    SchemeNameBuilder.seq[ctx] = [];
    var inp = getSchemeNameTargetInput(ctx);
    if (inp) inp.value = '';
    renderSchemeKeywordUI(ctx);
  }

  function addCustomSchemeKeyword(ctx) {
    loadCustomSchemeKeywords();
    var inp = document.getElementById(ctx === 'quick' ? 'inpAddKwQuick' : 'inpAddKwModal');
    if (!inp) return;
    var val = inp.value.trim().replace(/\s+/g, '');
    if (!val) return;
    if (getAllSchemeKeywords().indexOf(val) < 0) {
      SchemeNameBuilder.customKeywords.push(val);
      saveCustomSchemeKeywords();
    }
    inp.value = '';
    renderSchemeKeywordUI('quick');
    renderSchemeKeywordUI('modal');
  }

  function deleteCustomSchemeKeyword(kw, ev) {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    loadCustomSchemeKeywords();
    SchemeNameBuilder.customKeywords = SchemeNameBuilder.customKeywords.filter(function (k) { return k !== kw; });
    saveCustomSchemeKeywords();
    renderSchemeKeywordUI('quick');
    renderSchemeKeywordUI('modal');
  }

  function openQuickRenameModal(schemeId) {
    var sc = State.library.getScheme(schemeId);
    if (!sc) return;
    SchemeNameBuilder.quickTargetSchemeId = sc.id;
    SchemeNameBuilder.seq.quick = sc.name.indexOf('_') >= 0 ? sc.name.split('_').filter(Boolean) : [];
    var schemes = State.library.schemes;
    var idx = schemes.findIndex(function (s) { return s.id === sc.id; });
    if (document.getElementById('lblQuickRenameOld')) document.getElementById('lblQuickRenameOld').textContent = sc.name;
    if (document.getElementById('lblQuickRenameIdx')) document.getElementById('lblQuickRenameIdx').textContent = schemes.length > 0 ? ('方案 ' + (idx + 1) + ' / ' + schemes.length) : '';
    if (document.getElementById('inpQuickRenameName')) document.getElementById('inpQuickRenameName').value = sc.name;
    renderSchemeKeywordUI('quick');
    var modal = document.getElementById('modalQuickRename');
    if (modal) modal.classList.add('open');
  }

  function closeQuickRenameModal() {
    var modal = document.getElementById('modalQuickRename');
    if (modal) modal.classList.remove('open');
    SchemeNameBuilder.quickTargetSchemeId = null;
  }

  function saveQuickRename(goNext) {
    var id = SchemeNameBuilder.quickTargetSchemeId;
    if (!id) return;
    var inp = document.getElementById('inpQuickRenameName');
    var newName = inp ? inp.value.trim() : '';
    if (!newName) { alert('方案名称不能为空'); return; }
    var updated = State.library.renameScheme(id, newName);
    if (!updated) return;
    renderSchemeCards();
    if (ViewSchemeState.schemeId === id && document.getElementById('viewSchemeTitle')) {
      document.getElementById('viewSchemeTitle').textContent = updated.name;
    }
    if (State.clusters && State.clusters.length > 0) {
      State.clusters.forEach(function (c) {
        if (c.matchResult && c.matchResult.bestScheme && c.matchResult.bestScheme.id === id) {
          c.matchResult.bestScheme.name = updated.name;
          c.matchResult.schemeName = updated.name;
        }
      });
      if (root.renderResultsTable) root.renderResultsTable();
    }
    if (goNext && State.library.schemes.length > 1) {
      var curIdx = State.library.schemes.findIndex(function (s) { return s.id === id; });
      openQuickRenameModal(State.library.schemes[(curIdx + 1) % State.library.schemes.length].id);
    } else {
      closeQuickRenameModal();
    }
  }

  /* ---------- 星座图放大预览与孔心距标尺 ---------- */
  function hitTestViewedSchemeVia(layout, mx, my) {
    if (!layout || !layout.vias) return -1;
    var bestIdx = -1, bestDist = Infinity;
    for (var i = 0; i < layout.vias.length; i++) {
      var v = layout.vias[i];
      var d = Math.hypot(mx - v.sx, my - v.sy);
      if (d <= layout.padR + 9 && d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx < 0 && layout.callouts) {
      for (var j = 0; j < layout.callouts.length; j++) {
        var c = layout.callouts[j];
        if (mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h) return c.index;
      }
    }
    return bestIdx;
  }

  function renderViewedSchemeCanvas() {
    var scheme = State.library.getScheme(ViewSchemeState.schemeId);
    var canvas = document.getElementById('viewSchemeCanvas');
    var wrap = document.getElementById('viewSchemeCanvasWrap');
    if (!scheme || !canvas) return;
    var w = (wrap && wrap.clientWidth > 100) ? wrap.clientWidth : 760;
    var h = (wrap && wrap.clientHeight > 100) ? wrap.clientHeight : 520;
    ViewSchemeState.lastLayout = FC.renderSchemeEnlargedCanvas(canvas, scheme, {
      width: w,
      height: h,
      zoom: ViewSchemeState.zoom,
      panX: ViewSchemeState.panX,
      panY: ViewSchemeState.panY,
      showPadstack: document.getElementById('chkViewPadstack') ? document.getElementById('chkViewPadstack').checked : true,
      showCoords: document.getElementById('chkViewCoords') ? document.getElementById('chkViewCoords').checked : false,
      showDistances: document.getElementById('chkViewDistances') ? document.getElementById('chkViewDistances').checked : false,
      librarySchemes: State.library.schemes,
      hoveredIndex: ViewSchemeState.hoveredIndex,
      measureMode: ViewSchemeState.measureMode,
      measureStartIndex: ViewSchemeState.measureStartIndex,
      measuredPairs: ViewSchemeState.measuredPairs,
      cursorPos: ViewSchemeState.cursorPos
    });
  }

  function renderViewSchemeMeasureUI() {
    var btn = document.getElementById('btnViewSchemeMeasure');
    var clearBtn = document.getElementById('btnViewSchemeClearMeasure');
    var panel = document.getElementById('viewSchemeMeasurePanel');
    if (btn) {
      btn.className = ViewSchemeState.measureMode ? 'btn pri small' : 'btn sec small';
      btn.textContent = ViewSchemeState.measureMode ? '测孔中心距 · 开启' : '测孔中心距';
    }
    var hasAny = ViewSchemeState.measuredPairs.length > 0 || ViewSchemeState.measureStartIndex >= 0;
    if (clearBtn) clearBtn.style.display = hasAny ? 'inline-flex' : 'none';
    if (!panel) return;
    if (!ViewSchemeState.measureMode && ViewSchemeState.measuredPairs.length === 0) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';
    var scheme = State.library.getScheme(ViewSchemeState.schemeId);
    var layout = ViewSchemeState.lastLayout || (scheme ? FC.computeSchemeViewLayout(scheme, 760, 520, { showPadstack: true }) : null);
    var vias = layout ? layout.vias : [];

    var statusHtml = '';
    if (ViewSchemeState.measureMode) {
      if (ViewSchemeState.measureStartIndex < 0) {
        statusHtml = '<div style="color:var(--pri-d);font-weight:700">● 请点击第 1 个孔作为测量起点</div>';
      } else {
        var sv = vias[ViewSchemeState.measureStartIndex];
        statusHtml = '<div style="color:var(--pri);font-weight:700">● 已选起点 <b>#' + (sv ? sv.labelNum : ViewSchemeState.measureStartIndex + 1) + '</b>，请点击第 2 个孔</div>';
      }
    }

    var pairRows = ViewSchemeState.measuredPairs.map(function (mp, idx) {
      var v1 = vias[mp.i1], v2 = vias[mp.i2];
      if (!v1 || !v2) return '';
      var m = FC.calcSchemeViaPairDistance(v1, v2);
      return '<div style="margin-top:6px;padding:6px 8px;background:#ffffff;border:1px solid #bfdbfe;border-radius:6px;font-family:var(--mono);font-size:11px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<span style="font-weight:700;color:#111827">#' + m.v1Label + ' - #' + m.v2Label + ' 孔中心距</span>' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<span style="font-weight:800;font-size:12px;color:var(--pri)">' + m.distMil.toFixed(2) + ' mil</span>' +
            '<span style="color:var(--sub)">' + m.distMm.toFixed(3) + ' mm</span>' +
            '<span onclick="removeViewSchemeMeasuredPair(' + idx + ')" style="cursor:pointer;color:var(--bad);font-weight:700;padding:0 3px">×</span>' +
          '</div></div>' +
        '<div style="color:var(--sub);font-size:11px;margin-top:2px">|ΔX| = ' + m.absDx.toFixed(2) + ' mil · |ΔY| = ' + m.absDy.toFixed(2) + ' mil</div></div>';
    }).join('');

    panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
      '<span style="font-weight:700;color:var(--heading)">孔到孔中心距测量</span>' +
      (hasAny ? '<span onclick="clearViewSchemeMeasurements()" style="cursor:pointer;font-size:11px;color:var(--bad);font-weight:600">清空全部</span>' : '') +
      '</div>' + statusHtml + pairRows;
  }

  function handleViewSchemeViaClick(viaIndex) {
    if (viaIndex == null || viaIndex < 0) return;
    var scheme = State.library.getScheme(ViewSchemeState.schemeId);
    if (!scheme || !scheme.vias[viaIndex] || !ViewSchemeState.measureMode) return;

    if (ViewSchemeState.measureStartIndex < 0) {
      ViewSchemeState.measureStartIndex = viaIndex;
    } else if (ViewSchemeState.measureStartIndex === viaIndex) {
      ViewSchemeState.measureStartIndex = -1;
    } else {
      var i1 = ViewSchemeState.measureStartIndex, i2 = viaIndex;
      var exists = ViewSchemeState.measuredPairs.some(function (p) { return (p.i1 === i1 && p.i2 === i2) || (p.i1 === i2 && p.i2 === i1); });
      if (!exists) ViewSchemeState.measuredPairs.push({ i1: i1, i2: i2 });
      ViewSchemeState.measureStartIndex = -1;
    }
    renderViewSchemeMeasureUI();
    renderViewedSchemeCanvas();
  }

  function toggleViewSchemeMeasureMode(forceVal) {
    ViewSchemeState.measureMode = (typeof forceVal === 'boolean') ? forceVal : !ViewSchemeState.measureMode;
    if (!ViewSchemeState.measureMode) {
      ViewSchemeState.measureStartIndex = -1;
      ViewSchemeState.cursorPos = null;
    }
    var canvas = document.getElementById('viewSchemeCanvas');
    if (canvas) canvas.style.cursor = ViewSchemeState.measureMode ? 'crosshair' : 'grab';
    renderViewSchemeMeasureUI();
    renderViewedSchemeCanvas();
  }

  function clearViewSchemeMeasurements() {
    ViewSchemeState.measureStartIndex = -1;
    ViewSchemeState.measuredPairs = [];
    ViewSchemeState.cursorPos = null;
    renderViewSchemeMeasureUI();
    renderViewedSchemeCanvas();
  }

  function removeViewSchemeMeasuredPair(pairIdx) {
    if (pairIdx >= 0 && pairIdx < ViewSchemeState.measuredPairs.length) {
      ViewSchemeState.measuredPairs.splice(pairIdx, 1);
      renderViewSchemeMeasureUI();
      renderViewedSchemeCanvas();
    }
  }

  function setViewSchemeHoveredVia(idx) {
    ViewSchemeState.hoveredIndex = idx;
    renderViewedSchemeCanvas();
    document.querySelectorAll('#viewSchemeViaTableBody tr').forEach(function (tr, rIdx) {
      tr.style.background = (rIdx === idx) ? '#fef9c3' : '';
    });
  }

  function bindViewSchemeCanvasEvents() {
    if (ViewSchemeState.eventsBound) return;
    var canvas = document.getElementById('viewSchemeCanvas');
    if (!canvas) return;
    ViewSchemeState.eventsBound = true;

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoomViewScheme(e.deltaY < 0 ? 1.15 : (1 / 1.15));
    }, { passive: false });

    canvas.addEventListener('mousedown', function (e) {
      ViewSchemeState.downClientX = e.clientX;
      ViewSchemeState.downClientY = e.clientY;
      var rect = canvas.getBoundingClientRect();
      var hit = hitTestViewedSchemeVia(ViewSchemeState.lastLayout, e.clientX - rect.left, e.clientY - rect.top);
      if (ViewSchemeState.measureMode && hit >= 0) return;
      ViewSchemeState.isDragging = true;
      ViewSchemeState.dragStartX = e.clientX - ViewSchemeState.panX;
      ViewSchemeState.dragStartY = e.clientY - ViewSchemeState.panY;
    });

    root.addEventListener('mouseup', function (e) {
      var moved = Math.hypot((e.clientX || 0) - ViewSchemeState.downClientX, (e.clientY || 0) - ViewSchemeState.downClientY);
      ViewSchemeState.isDragging = false;
      if (ViewSchemeState.measureMode && moved < 6) {
        var c = document.getElementById('viewSchemeCanvas');
        var modal = document.getElementById('modalViewScheme');
        if (c && modal && modal.classList.contains('open') && e.target === c) {
          var rect = c.getBoundingClientRect();
          var hit = hitTestViewedSchemeVia(ViewSchemeState.lastLayout, e.clientX - rect.left, e.clientY - rect.top);
          if (hit >= 0) handleViewSchemeViaClick(hit);
        }
      }
    });

    canvas.addEventListener('mousemove', function (e) {
      if (ViewSchemeState.isDragging) {
        ViewSchemeState.panX = e.clientX - ViewSchemeState.dragStartX;
        ViewSchemeState.panY = e.clientY - ViewSchemeState.dragStartY;
        renderViewedSchemeCanvas();
        return;
      }
      var layout = ViewSchemeState.lastLayout;
      if (!layout) return;
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      ViewSchemeState.cursorPos = { x: mx, y: my };
      var hit = hitTestViewedSchemeVia(layout, mx, my);
      if (hit !== ViewSchemeState.hoveredIndex) setViewSchemeHoveredVia(hit);
      else if (ViewSchemeState.measureMode && ViewSchemeState.measureStartIndex >= 0) renderViewedSchemeCanvas();
    });
  }

  function populateViewedSchemeDetails(scheme) {
    var schemes = State.library.schemes;
    var idx = schemes.findIndex(function (s) { return s.id === scheme.id; });
    if (document.getElementById('viewSchemeTitle')) document.getElementById('viewSchemeTitle').textContent = scheme.name;
    if (document.getElementById('viewSchemeCat')) document.getElementById('viewSchemeCat').textContent = scheme.category || '扇出方案';
    if (document.getElementById('viewSchemeIndexBadge')) document.getElementById('viewSchemeIndexBadge').textContent = schemes.length > 0 ? ((idx + 1) + ' / ' + schemes.length) : '';
    if (document.getElementById('viewSchemeDesc')) document.getElementById('viewSchemeDesc').textContent = scheme.description || '';

    var layout = FC.computeSchemeViewLayout(scheme, 760, 520, { showPadstack: true, librarySchemes: State.library.schemes });
    var summary = layout.summary, vias = layout.vias, padColorList = layout.padstackColors || [];
    var pitchRange = summary.viaCount >= 2 ? (summary.minDist.toFixed(1) + ' ~ ' + summary.maxDist.toFixed(1) + ' mil') : '单孔';

    var legendEl = document.getElementById('viewSchemePadLegend');
    if (legendEl) {
      legendEl.innerHTML = padColorList.map(function (pc) {
        return '<span style="display:inline-flex;align-items:center;gap:4px;font-family:var(--mono)" data-tip="Padstack: ' + escapeHtml(pc.padstack) + '"><span style="width:10px;height:10px;border-radius:50%;background:' + pc.fill + ';border:1.5px solid #0f172a;display:inline-block"></span><span>' + escapeHtml(pc.padstack) + '</span></span>';
      }).join('');
    }

    var summaryEl = document.getElementById('viewSchemeSummaryBox');
    if (summaryEl) {
      summaryEl.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px">' +
        '<div>过孔总数: <b>' + summary.viaCount + ' 孔</b></div>' +
        '<div>信号 / 地孔: <b style="color:var(--pri)">' + summary.sigCount + '</b> / <b style="color:var(--ok)">' + summary.gndCount + '</b></div>' +
        '<div style="grid-column:1/-1">孔心距范围: <b style="font-family:var(--mono)">' + pitchRange + '</b></div></div>';
    }

    var tbodyEl = document.getElementById('viewSchemeViaTableBody');
    if (tbodyEl) {
      tbodyEl.innerHTML = vias.map(function (v, i) {
        return '<tr onmouseenter="setViewSchemeHoveredVia(' + i + ')" onmouseleave="setViewSchemeHoveredVia(-1)" onclick="if(!ViewSchemeState.measureMode) toggleViewSchemeMeasureMode(true); handleViewSchemeViaClick(' + i + ');" style="cursor:pointer">' +
          '<td style="padding:6px 8px;font-family:var(--mono);font-weight:700"><span style="display:inline-flex;align-items:center;gap:5px"><span style="width:9px;height:9px;border-radius:50%;background:' + v.padColor + ';border:1px solid #0f172a;display:inline-block"></span>#' + v.labelNum + '</span></td>' +
          '<td style="padding:6px 8px"><span class="badge-tag">' + (v.isSig ? '信号' : 'GND') + '</span></td>' +
          '<td style="padding:6px 8px"><div style="font-family:var(--mono);font-weight:700;font-size:12px">' + escapeHtml(v.padstack) + '</div>' +
          '<div style="font-size:11px;color:var(--sub);font-family:var(--mono)">[' + v.x.toFixed(1) + ', ' + v.y.toFixed(1) + '] mil</div></td></tr>';
      }).join('');
    }
  }

  function viewScheme(id) {
    var scheme = State.library.getScheme(id);
    if (!scheme) return;
    ViewSchemeState.schemeId = scheme.id;
    ViewSchemeState.zoom = 1.0;
    ViewSchemeState.panX = 0;
    ViewSchemeState.panY = 0;
    ViewSchemeState.hoveredIndex = -1;
    ViewSchemeState.measureStartIndex = -1;
    ViewSchemeState.measuredPairs = [];
    ViewSchemeState.cursorPos = null;
    bindViewSchemeCanvasEvents();
    var modal = document.getElementById('modalViewScheme');
    if (modal) modal.classList.add('open');
    populateViewedSchemeDetails(scheme);
    renderViewSchemeMeasureUI();
    renderViewedSchemeCanvas();
  }

  function closeViewSchemeModal() {
    var modal = document.getElementById('modalViewScheme');
    if (modal) modal.classList.remove('open');
  }

  function stepViewScheme(delta) {
    var schemes = State.library.schemes;
    if (!schemes.length) return;
    var curIdx = schemes.findIndex(function (s) { return s.id === ViewSchemeState.schemeId; });
    viewScheme(schemes[((curIdx < 0 ? 0 : curIdx) + delta + schemes.length) % schemes.length].id);
  }

  function editCurrentViewedScheme() {
    var id = ViewSchemeState.schemeId;
    closeViewSchemeModal();
    if (id) editScheme(id);
  }

  function zoomViewScheme(factor) {
    ViewSchemeState.zoom = Math.max(0.4, Math.min(5.0, ViewSchemeState.zoom * factor));
    renderViewedSchemeCanvas();
  }

  function resetViewSchemeTransform() {
    ViewSchemeState.zoom = 1.0;
    ViewSchemeState.panX = 0;
    ViewSchemeState.panY = 0;
    renderViewedSchemeCanvas();
  }

  function onViewSchemeOptionChange() { renderViewedSchemeCanvas(); }

  function exportViewedSchemePng() {
    var scheme = State.library.getScheme(ViewSchemeState.schemeId);
    var canvas = document.getElementById('viewSchemeCanvas');
    if (!scheme || !canvas || !canvas.toDataURL) return;
    var a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = (scheme.name || '扇出方案') + '_效果图.png';
    a.click();
  }

  root.getAllSchemeKeywords = getAllSchemeKeywords;
  root.renderSchemeKeywordUI = renderSchemeKeywordUI;
  root.clickSchemeKeyword = clickSchemeKeyword;
  root.removeSchemeKeywordAt = removeSchemeKeywordAt;
  root.undoSchemeKeyword = undoSchemeKeyword;
  root.clearSchemeKeywords = clearSchemeKeywords;
  root.addCustomSchemeKeyword = addCustomSchemeKeyword;
  root.deleteCustomSchemeKeyword = deleteCustomSchemeKeyword;
  root.openQuickRenameModal = openQuickRenameModal;
  root.closeQuickRenameModal = closeQuickRenameModal;
  root.saveQuickRename = saveQuickRename;
  root.viewScheme = viewScheme;
  root.closeViewSchemeModal = closeViewSchemeModal;
  root.stepViewScheme = stepViewScheme;
  root.editCurrentViewedScheme = editCurrentViewedScheme;
  root.zoomViewScheme = zoomViewScheme;
  root.resetViewSchemeTransform = resetViewSchemeTransform;
  root.onViewSchemeOptionChange = onViewSchemeOptionChange;
  root.exportViewedSchemePng = exportViewedSchemePng;
  root.renderViewedSchemeCanvas = renderViewedSchemeCanvas;
  root.toggleViewSchemeMeasureMode = toggleViewSchemeMeasureMode;
  root.clearViewSchemeMeasurements = clearViewSchemeMeasurements;
  root.removeViewSchemeMeasuredPair = removeViewSchemeMeasuredPair;
  root.handleViewSchemeViaClick = handleViewSchemeViaClick;
  root.setViewSchemeHoveredVia = setViewSchemeHoveredVia;
})(typeof window !== "undefined" ? window : globalThis);
