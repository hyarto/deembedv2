/* ============================================================================
 * fanout-library-ui.js —— 扇出方案库管理、快捷关键词改名、批量导入与星座图放大预览
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var FC = root.FanoutChecker;
  var State = root.State;
  var escapeHtml = root.escapeHtml;

  var KW_STORAGE_KEY = 'pcb_fanout_name_keywords_v1';
  var SchemeNameBuilder = {
    presetKeywords: (FC.DEFAULT_SCHEME_NAME_KEYWORDS || [
      'BGA', 'SMA', 'TZ', 'top', 'bottom', 'L2', 'L3', 'L4', 'L11', 'L12', 'L13', 'diff', 'single', '05pitch', '06pitch', '07pitch', '08pitch'
    ]).slice(),
    customKeywords: [],
    seq: { quick: [], modal: [] },
    quickTargetSchemeId: null,
    loaded: false
  };

  var ViewSchemeState = {
    schemeId: null,
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

  var editingSchemeId = null;
  var g_parsedBatchSchemes = [];

  function drawSchemeThumbnail(canvasId, scheme) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    if (scheme.viaCount === 0) return;

    var maxSpan = 10;
    scheme.normalizedVias.forEach(function (v) {
      maxSpan = Math.max(maxSpan, Math.abs(v.nx), Math.abs(v.ny));
    });
    var scale = (w * 0.38) / Math.max(maxSpan, 10);
    var cx = w / 2, cy = h / 2;

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    for (var i = 0; i < scheme.viaCount; i++) {
      for (var j = i + 1; j < scheme.viaCount; j++) {
        var v1 = scheme.normalizedVias[i], v2 = scheme.normalizedVias[j];
        ctx.beginPath();
        ctx.moveTo(cx + v1.nx * scale, cy - v1.ny * scale);
        ctx.lineTo(cx + v2.nx * scale, cy - v2.ny * scale);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    if (FC.syncLibraryPadstackColors) FC.syncLibraryPadstackColors(State.library.schemes);
    var padColorMap = FC.buildPadstackColorMap ? FC.buildPadstackColorMap(scheme.vias, State.library.schemes).map : {};
    scheme.normalizedVias.forEach(function (v) {
      var vx = cx + v.nx * scale, vy = cy - v.ny * scale;
      var isSig = FC.isSignalVia(v);
      var pCol = padColorMap[String(v.padstack || 'VIA_PAD')] || (FC.getPadstackColorEntry ? FC.getPadstackColorEntry(v.padstack) : null);
      ctx.beginPath();
      ctx.arc(vx, vy, 6, 0, Math.PI * 2);
      ctx.fillStyle = pCol ? pCol.fill : (isSig ? '#38bdf8' : '#10b981');
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(vx, vy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
    });
  }

  function renderSchemeCards() {
    var container = document.getElementById('schemeContainer');
    var countBadge = document.getElementById('badgeSchemeCount');
    var statSchemeCount = document.getElementById('statSchemeCount');
    var selFilter = document.getElementById('selSchemeFilter');
    var schemes = State.library.schemes;

    if (FC.syncLibraryPadstackColors) FC.syncLibraryPadstackColors(schemes);
    if (countBadge) countBadge.textContent = String(schemes.length);
    if (statSchemeCount) statSchemeCount.textContent = String(schemes.length);

    var globalLegendEl = document.getElementById('libraryPadstackLegendBar');
    if (globalLegendEl) {
      var legendItems = (FC.getLibraryPadstackColorLegend && schemes.length > 0)
        ? FC.getLibraryPadstackColorLegend(schemes)
        : [];
      if (!legendItems.length) {
        globalLegendEl.innerHTML = '';
      } else {
        globalLegendEl.innerHTML =
          '<div style="background:#f8fafc;border:1px solid #e3e8ef;border-radius:8px;padding:8px 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<span style="font-size:12px;font-weight:700;color:#374151;white-space:nowrap">● 方案库 Padstack 全局色卡 · ' + legendItems.length + ' 种:</span>' +
            legendItems.map(function (item) {
              return '<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;background:#ffffff;border:1px solid #cbd5e1;font-family:var(--mono);font-size:11px;color:#111827" data-tip="用于 ' + item.schemeCount + ' 套方案 / ' + item.totalVias + ' 个孔">' +
                '<span style="width:9px;height:9px;border-radius:50%;background:' + item.fill + ';border:1px solid #0f172a;display:inline-block"></span>' +
                '<span style="font-weight:600">' + escapeHtml(item.padstack) + '</span>' +
                '<span style="font-size:11px;color:#6b7280">' + item.schemeCount + '套/' + item.totalVias + '孔</span></span>';
            }).join('') +
          '</div>';
      }
    }

    if (selFilter) {
      selFilter.innerHTML = '<option value="">所有匹配方案</option>' + schemes.map(function (s) {
        return '<option value="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + ' · ' + s.viaCount + '孔</option>';
      }).join('');
    }

    if (!container) return;
    if (!schemes.length) {
      container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:36px;background:#fff;border:1px dashed var(--line);border-radius:8px;color:var(--sub)">方案库为空，请新建或载入预设方案。</div>';
      return;
    }

    container.innerHTML = schemes.map(function (s) {
      var pEntries = Object.entries(s.padstackCounts || {});
      var pCountsPlain = pEntries.map(function (e) { return e[0] + ' ×' + e[1]; }).join(', ');
      var pCountsRich = pEntries.map(function (e) {
        var pc = FC.getPadstackColorEntry ? FC.getPadstackColorEntry(e[0]) : { fill: '#38bdf8' };
        return '<span style="display:inline-flex;align-items:center;gap:3px;margin-right:6px"><span style="width:8px;height:8px;border-radius:50%;background:' + pc.fill + ';border:1px solid #0f172a;display:inline-block"></span><span>' + escapeHtml(e[0]) + ' ×' + e[1] + '</span></span>';
      }).join('');
      var minD = s.pairwiseDistances.length > 0 ? s.pairwiseDistances[0].dist.toFixed(1) : '-';
      var maxD = s.pairwiseDistances.length > 0 ? s.pairwiseDistances[s.pairwiseDistances.length - 1].dist.toFixed(1) : '-';

      return '<div class="scheme-card" id="card_' + s.id + '">' +
        '<div class="scheme-header">' +
          '<div style="min-width:0;flex:1">' +
            '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
              '<div class="scheme-title" onclick="openQuickRenameModal(\'' + s.id + '\')" style="cursor:pointer" data-tip="点击快捷组合改名">' + escapeHtml(s.name) + '</div>' +
              '<span onclick="openQuickRenameModal(\'' + s.id + '\')" style="cursor:pointer;font-size:11px;font-weight:600;color:var(--pri-d);background:#f8fafc;border:1px solid var(--line);border-radius:4px;padding:1px 6px">改名</span>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--sub);margin-top:2px">' + escapeHtml(s.description || '标准扇出拓扑') + '</div>' +
          '</div>' +
          '<span class="scheme-cat">' + escapeHtml(s.category) + '</span>' +
        '</div>' +
        '<div class="scheme-body">' +
          '<div class="scheme-canvas-wrap" onclick="viewScheme(\'' + s.id + '\')" style="cursor:zoom-in" data-tip="点击打开星座图放大预览与孔心距测量">' +
            '<canvas id="thumb_' + s.id + '" width="110" height="110"></canvas>' +
          '</div>' +
          '<div class="scheme-info">' +
            '<div>过孔总数: <span class="metric">' + s.viaCount + ' 孔</span></div>' +
            '<div>孔中心距: <span class="metric">' + minD + ' ~ ' + maxD + ' mil</span></div>' +
            '<div style="font-size:11px;color:var(--sub);margin-top:2px" data-tip="' + escapeHtml(pCountsPlain) + '">焊盘: ' + pCountsRich + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="scheme-actions">' +
          '<button type="button" class="btn sec small" onclick="editScheme(\'' + s.id + '\')">编辑</button>' +
          '<button type="button" class="btn bad small" onclick="deleteScheme(\'' + s.id + '\')">删除</button>' +
          '<button type="button" class="btn pri small" onclick="viewScheme(\'' + s.id + '\')">查看</button>' +
        '</div></div>';
    }).join('');

    var drawThumbs = function () {
      schemes.forEach(function (s) { drawSchemeThumbnail('thumb_' + s.id, s); });
    };
    if (root.requestAnimationFrame) root.requestAnimationFrame(drawThumbs);
    else setTimeout(drawThumbs, 16);
  }

  function loadPresets() {
    State.library.loadStandardPresets();
    renderSchemeCards();
  }

  function clearLibrary() {
    if (root.confirm('确定清空扇出方案库？')) {
      State.library.clear();
      renderSchemeCards();
    }
  }

  function exportLibraryJSON() {
    var schemes = State.library.toJSON();
    if (!schemes || !schemes.length) { alert('方案库当前为空'); return; }
    root.showExportBox('fanout_schemes_' + Date.now() + '.json', JSON.stringify(schemes, null, 2), '共 ' + schemes.length + ' 套扇出方案模板。', 'application/json');
  }

  function importLibraryJSON(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var res = root.parseAndRepairFanoutJson(e.target.result);
      if (res.success && res.schemes && res.schemes.length > 0) {
        State.library.loadFromJSON(res.schemes);
        renderSchemeCards();
      } else {
        alert('导入失败：' + (res.error || '格式无效'));
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function deleteScheme(id) {
    if (root.confirm('确定删除此扇出方案？')) {
      State.library.removeScheme(id);
      renderSchemeCards();
    }
  }

  function editScheme(id) {
    var scheme = State.library.getScheme(id);
    if (scheme) openSchemeModal(scheme);
  }

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

  /* ---------- 新建/编辑与批量导入方案弹窗 ---------- */
  function updateModalPreview() {
    var tempScheme = new FC.FanoutScheme({ name: 'Preview', vias: State.modalVias });
    var previewTitle = document.getElementById('modalPreviewTitle');
    var previewMetrics = document.getElementById('modalPreviewMetrics');
    if (previewTitle) previewTitle.textContent = '方案几何拓扑 · ' + tempScheme.viaCount + ' 孔';
    if (previewMetrics) {
      if (tempScheme.viaCount > 0) {
        var minD = tempScheme.pairwiseDistances.length > 0 ? tempScheme.pairwiseDistances[0].dist.toFixed(2) : '-';
        var maxD = tempScheme.pairwiseDistances.length > 0 ? tempScheme.pairwiseDistances[tempScheme.pairwiseDistances.length - 1].dist.toFixed(2) : '-';
        previewMetrics.innerHTML = '<div>孔中心距: <strong>' + minD + ' ~ ' + maxD + ' mil</strong></div>' +
          '<div>Padstack: <span style="font-family:var(--mono);color:var(--pri)">' + escapeHtml(Object.keys(tempScheme.padstackCounts).join(', ')) + '</span></div>';
      } else {
        previewMetrics.textContent = '暂无孔位数据';
      }
    }
    drawSchemeThumbnail('modalPreviewCanvas', tempScheme);
  }

  function renderModalTable() {
    var tbody = document.getElementById('modalTblBody');
    if (!tbody) return;
    tbody.innerHTML = State.modalVias.map(function (v, idx) {
      return '<tr><td style="font-weight:700">#' + (v.id || (idx + 1)) + '</td>' +
        '<td><input type="number" data-no-persist step="0.1" value="' + v.x + '" style="width:70px;padding:2px 4px;font-size:11px" onchange="updateModalVia(' + idx + ', \'x\', this.value)"></td>' +
        '<td><input type="number" data-no-persist step="0.1" value="' + v.y + '" style="width:70px;padding:2px 4px;font-size:11px" onchange="updateModalVia(' + idx + ', \'y\', this.value)"></td>' +
        '<td><input type="text" data-no-persist value="' + escapeHtml(v.padstack) + '" style="width:160px;padding:2px 4px;font-size:11px" onchange="updateModalVia(' + idx + ', \'padstack\', this.value)"></td>' +
        '<td><input type="text" data-no-persist value="' + escapeHtml(v.net || '') + '" style="width:70px;padding:2px 4px;font-size:11px" onchange="updateModalVia(' + idx + ', \'net\', this.value)"></td>' +
        '<td><input type="text" data-no-persist value="' + escapeHtml(v.role || '') + '" style="width:90px;padding:2px 4px;font-size:11px" onchange="updateModalVia(' + idx + ', \'role\', this.value)"></td>' +
        '<td><button type="button" class="btn bad small" onclick="removeModalVia(' + idx + ')">删除</button></td></tr>';
    }).join('');
    updateModalPreview();
  }

  function switchModalInputMode(mode) {
    var isSnippet = mode === 'snippet';
    document.getElementById('btnModeSnippet').className = 'btn small ' + (isSnippet ? 'pri' : 'sec');
    document.getElementById('btnModeTable').className = 'btn small ' + (isSnippet ? 'sec' : 'pri');
    document.getElementById('modalWrapSnippet').style.display = isSnippet ? 'block' : 'none';
    document.getElementById('modalWrapTable').style.display = isSnippet ? 'none' : 'block';
  }

  function openSchemeModal(schemeToEdit) {
    var modal = document.getElementById('modalScheme');
    var title = document.getElementById('modalSchemeTitle');
    editingSchemeId = schemeToEdit ? schemeToEdit.id : null;
    if (schemeToEdit) {
      title.textContent = '编辑扇出方案: ' + schemeToEdit.name;
      document.getElementById('modalInpName').value = schemeToEdit.name;
      document.getElementById('modalSelCategory').value = schemeToEdit.category;
      document.getElementById('modalInpDesc').value = schemeToEdit.description;
      State.modalVias = schemeToEdit.vias.map(function (v) { return Object.assign({}, v); });
      SchemeNameBuilder.seq.modal = schemeToEdit.name.indexOf('_') >= 0 ? schemeToEdit.name.split('_').filter(Boolean) : [];
    } else {
      title.textContent = '新建扇出方案模板';
      document.getElementById('modalInpName').value = '新扇出方案_' + (State.library.schemes.length + 1);
      document.getElementById('modalSelCategory').value = '自定义扇出';
      document.getElementById('modalInpDesc').value = '';
      SchemeNameBuilder.seq.modal = [];
      State.modalVias = [
        { id: 1, x: 0, y: 0, padstack: 'SMA_Bot-L19_d2m6mil_via-0902', net: 'SIG', role: '中心信号孔' },
        { id: 2, x: 0, y: 20, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随地孔1' },
        { id: 3, x: 0, y: -20, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随地孔2' },
        { id: 4, x: -20, y: 0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随地孔3' },
        { id: 5, x: 20, y: 0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随地孔4' }
      ];
    }
    renderSchemeKeywordUI('modal');
    switchModalInputMode('table');
    renderModalTable();
    modal.classList.add('open');
  }

  function closeSchemeModal() {
    document.getElementById('modalScheme').classList.remove('open');
    editingSchemeId = null;
  }

  function addModalTableRow() {
    var newId = State.modalVias.length + 1;
    State.modalVias.push({ id: newId, x: 0, y: 0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '地孔' + newId });
    renderModalTable();
  }

  function removeModalVia(idx) { State.modalVias.splice(idx, 1); renderModalTable(); }

  function updateModalVia(idx, field, val) {
    if (field === 'x' || field === 'y') State.modalVias[idx][field] = parseFloat(val) || 0;
    else State.modalVias[idx][field] = val.trim();
    updateModalPreview();
  }

  function previewModalFromSnippet() {
    var txt = document.getElementById('modalTxtSnippet').value;
    var parsed = FC.parseViaData(txt);
    if (parsed.length > 0) {
      State.modalVias = parsed.map(function (p, idx) {
        return { id: idx + 1, x: p.x, y: p.y, padstack: p.padstack, net: p.net, role: p.net === 'GND' ? '伴随地孔' : '信号孔' };
      });
      updateModalPreview();
    }
  }

  function saveSchemeFromModal() {
    var name = document.getElementById('modalInpName').value.trim();
    if (!name) { alert('请输入方案名称'); return; }
    if (State.modalVias.length < 2) { alert('扇出方案至少包含 2 个过孔'); return; }
    var scheme = new FC.FanoutScheme({
      id: editingSchemeId || undefined,
      name: name,
      category: document.getElementById('modalSelCategory').value,
      description: document.getElementById('modalInpDesc').value.trim(),
      vias: State.modalVias
    });
    State.library.addScheme(scheme);
    renderSchemeCards();
    closeSchemeModal();
  }

  /* ---------- 批量多方案导入 ---------- */
  function openBatchFanoutModal() {
    var modal = document.getElementById('modalBatchFanout');
    if (modal) { modal.classList.add('open'); parseBatchFanoutInput(); }
  }

  function closeBatchFanoutModal() {
    var modal = document.getElementById('modalBatchFanout');
    if (modal) modal.classList.remove('open');
  }

  function loadBatchFanoutSample() {
    var sampleTxt = '方案一：SMA-L2高速差分扇出\nItem 1 < Via >\nOrigin-xy: [ 17890.3000, 36461.6800 ]\nPadstack Name: SMA-HDI-GND-045drill-ring3_L1_L5\nNet: GND\nCircle Drill: 3.94\n\nItem 2 < Via >\nOrigin-xy: [ 17867.6300, 36486.9300 ]\nPadstack Name: SMA-HDI-SIG-045drill-ring3_L1_L4\nNet: 25_P\nCircle Drill: 3.94\n\nItem 3 < Via >\nOrigin-xy: [ 17863.0100, 36494.0600 ]\nPadstack Name: SMA-HDI-SIG-045drill-ring3_L1_L4\nNet: 25_N\nCircle Drill: 3.94\n\n~~~end~~~\n\n方案二：BGA-05PITCH-L4差分扇出\nItem 1 < Via >\nOrigin-xy: [ 21025.1600, 33312.8417 ]\nPadstack Name: BGA-HDI-GND-045drill-ring3_L2_L5\nNet: GND\n\nItem 2 < Via >\nOrigin-xy: [ 21020.9001, 33299.7355 ]\nPadstack Name: BGA-HDI-SIG-045drill-ring3_L1_L4\nNet: 25_N\n\n~~~end~~~';
    document.getElementById('txtBatchFanoutInput').value = sampleTxt;
    parseBatchFanoutInput();
  }

  function handleBatchFanoutTxtFile(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      document.getElementById('txtBatchFanoutInput').value = ev.target.result;
      parseBatchFanoutInput();
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function parseBatchFanoutInput() {
    var txt = document.getElementById('txtBatchFanoutInput') ? document.getElementById('txtBatchFanoutInput').value : '';
    var existingCount = State.library && State.library.schemes ? State.library.schemes.length : 0;
    g_parsedBatchSchemes = FC.parseMultiSchemeTxt(txt, existingCount);
    root.g_parsedBatchSchemes = g_parsedBatchSchemes;
    var container = document.getElementById('pnlBatchFanoutPreview');
    var countEl = document.getElementById('lblBatchFanoutCount');
    var btnConfirm = document.getElementById('btnConfirmBatchFanout');
    if (!container) return;
    var totalVias = g_parsedBatchSchemes.reduce(function (sum, s) { return sum + (s.vias ? s.vias.length : 0); }, 0);
    if (countEl) countEl.textContent = '解析结果：' + g_parsedBatchSchemes.length + ' 套方案 / ' + totalVias + ' 孔';
    if (btnConfirm) {
      btnConfirm.disabled = g_parsedBatchSchemes.length === 0;
      btnConfirm.textContent = '确认批量导入 · ' + g_parsedBatchSchemes.length + ' 套';
    }
    if (!g_parsedBatchSchemes.length) {
      container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--sub)">暂无解析方案，多方案间以 ~~~end~~~ 分隔</div>';
      return;
    }
    container.innerHTML = g_parsedBatchSchemes.map(function (s, idx) {
      var sigCount = (s.vias || []).filter(function (v) { return v.role === '信号孔' || v.type === 'signal'; }).length;
      var gndCount = (s.vias || []).length - sigCount;
      return '<div style="background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px">' +
          '<input type="text" data-no-persist value="' + escapeHtml(s.name) + '" oninput="g_parsedBatchSchemes[' + idx + '].name=this.value" style="font-size:12px;font-weight:700;width:100%;padding:2px 4px">' +
          '<span class="badge-tag purple">' + s.vias.length + '孔</span></div>' +
        '<div style="font-size:11px;color:var(--sub)">' + sigCount + ' 信号孔 + ' + gndCount + ' 地孔</div></div>';
    }).join('');
  }

  function confirmBatchFanoutImport() {
    if (!g_parsedBatchSchemes.length) return;
    if (document.getElementById('radBatchOverwriteFanout') && document.getElementById('radBatchOverwriteFanout').checked) {
      State.library.clear();
    }
    g_parsedBatchSchemes.forEach(function (s) { State.library.addScheme(new FC.FanoutScheme(s)); });
    renderSchemeCards();
    closeBatchFanoutModal();
  }

  root.SchemeNameBuilder = SchemeNameBuilder;
  root.ViewSchemeState = ViewSchemeState;
  root.g_parsedBatchSchemes = g_parsedBatchSchemes;
  root.renderSchemeCards = renderSchemeCards;
  root.drawSchemeThumbnail = drawSchemeThumbnail;
  root.loadPresets = loadPresets;
  root.clearLibrary = clearLibrary;
  root.exportLibraryJSON = exportLibraryJSON;
  root.importLibraryJSON = importLibraryJSON;
  root.deleteScheme = deleteScheme;
  root.editScheme = editScheme;
  root.getAllSchemeKeywords = getAllSchemeKeywords;
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
  root.openSchemeModal = openSchemeModal;
  root.closeSchemeModal = closeSchemeModal;
  root.switchModalInputMode = switchModalInputMode;
  root.addModalTableRow = addModalTableRow;
  root.removeModalVia = removeModalVia;
  root.updateModalVia = updateModalVia;
  root.previewModalFromSnippet = previewModalFromSnippet;
  root.saveSchemeFromModal = saveSchemeFromModal;
  root.openBatchFanoutModal = openBatchFanoutModal;
  root.closeBatchFanoutModal = closeBatchFanoutModal;
  root.loadBatchFanoutSample = loadBatchFanoutSample;
  root.handleBatchFanoutTxtFile = handleBatchFanoutTxtFile;
  root.parseBatchFanoutInput = parseBatchFanoutInput;
  root.confirmBatchFanoutImport = confirmBatchFanoutImport;
})(typeof window !== 'undefined' ? window : globalThis);
