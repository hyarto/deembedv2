/* ============================================================================
 * fanout-results-ui.js —— 扇出检查执行、走线解析概览、结果表筛选复核与差分异常分析
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var FC = root.FanoutChecker;
  var State = root.State;
  var escapeHtml = root.escapeHtml;
  var getTraceLayerColor = root.getTraceLayerColor;

  function setClusterThresh(val, unit) {
    unit = unit || 'mm';
    document.getElementById('inpClusterDist').value = val;
    document.getElementById('selClusterUnit').value = unit;
    State.clusterDist = val;
    State.clusterDistUnit = unit;
  }

  function toggleClusterUnit() {
    var selUnit = document.getElementById('selClusterUnit').value;
    var inp = document.getElementById('inpClusterDist');
    var currentVal = parseFloat(inp.value) || 2.0;
    if (selUnit === 'mil' && State.clusterDistUnit === 'mm') inp.value = (currentVal / 0.0254).toFixed(2);
    else if (selUnit === 'mm' && State.clusterDistUnit === 'mil') inp.value = (currentVal * 0.0254).toFixed(2);
    State.clusterDistUnit = selUnit;
    State.clusterDist = parseFloat(inp.value) || 2.0;
  }

  function syncClusterDistUnit() {
    State.clusterDist = parseFloat(document.getElementById('inpClusterDist').value) || 2.0;
  }

  function setDistTol(val) {
    document.getElementById('inpDistTol').value = val;
    State.distTolerance = val;
  }

  function handleViaFileUpload(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var raw = e.target.result;
      State.rawText = raw;
      var ta = document.getElementById('txtViaInput');
      if (raw.length > 100000) {
        ta.value = '[ 已加载大型文件: ' + file.name + ' ]\n' + raw.split(/\r?\n/).slice(0, 15).join('\n');
      } else {
        ta.value = raw;
      }
      setTimeout(executeFanoutCheck, 30);
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function loadSample26Vias() {
    if (typeof root.fetch !== 'function') return;
    root.fetch('sample/via_trace_airgap_sample.txt')
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        State.rawText = '';
        document.getElementById('txtViaInput').value = txt;
        executeFanoutCheck();
      })
      .catch(function () { alert('无法载入示例文件'); });
  }

  function loadSampleTraceOnly() {
    if (typeof root.fetch !== 'function') return;
    root.fetch('sample/走线示例.txt')
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        State.rawText = '';
        document.getElementById('txtViaInput').value = txt;
        executeFanoutCheck();
      })
      .catch(function () { alert('无法载入走线示例文件'); });
  }

  var importPreviewTimer = null;
  function scheduleImportPreviewUpdate() {
    if (importPreviewTimer) clearTimeout(importPreviewTimer);
    importPreviewTimer = setTimeout(function () {
      var rawInMemory = State.rawText || '';
      var ta = document.getElementById('txtViaInput');
      var taVal = ta ? ta.value.trim() : '';
      var txt = (rawInMemory && taVal.indexOf('[ 已加载大型文件:') === 0) ? rawInMemory : taVal;
      if (!txt) {
        var card = document.getElementById('cardImportedTraceOverview');
        if (card) card.style.display = 'none';
        return;
      }
      if (txt.length <= 350000 && FC.parseFanoutInputData) {
        var parsed = FC.parseFanoutInputData(txt);
        State.previewTraces = parsed.traces;
        renderImportedTraceOverview(parsed.vias, parsed.traces, parsed.traceSummary);
      }
    }, 150);
  }

  function syncTraceLayerSelectors(traceSummary) {
    var layers = (traceSummary && Array.isArray(traceSummary.layers)) ? traceSummary.layers : [];
    var selImport = document.getElementById('selImportTraceLayer');
    if (selImport) {
      var prev = selImport.value;
      selImport.innerHTML = '<option value="">全部走线层 · ' + layers.length + '</option>' +
        layers.map(function (l) { return '<option value="' + escapeHtml(l.layer) + '">' + escapeHtml(l.layer) + ' · ' + l.segmentCount + '段</option>'; }).join('');
      if (layers.some(function (l) { return l.layer === prev; })) selImport.value = prev;
    }

    var selCanvas = document.getElementById('selCanvasTraceLayer');
    if (selCanvas) {
      var prevC = selCanvas.value;
      selCanvas.innerHTML = '<option value="">全部走线层' + (layers.length ? ' · ' + layers.length : '') + '</option>' +
        layers.map(function (l) { return '<option value="' + escapeHtml(l.layer) + '">' + escapeHtml(l.layer) + ' · ' + l.segmentCount + '段</option>'; }).join('');
      if (layers.some(function (l) { return l.layer === prevC; })) {
        selCanvas.value = prevC;
        State.canvas.traceLayerFilter = prevC;
      } else {
        selCanvas.value = '';
        State.canvas.traceLayerFilter = '';
      }
    }
  }

  function filterImportTraceByLayer(layerName) {
    var sel = document.getElementById('selImportTraceLayer');
    if (!sel) return;
    sel.value = sel.value === layerName ? '' : layerName;
    renderImportedTraceTable();
  }

  function renderImportedTraceTable() {
    var tbody = document.getElementById('tblImportedTracesBody');
    if (!tbody) return;
    var source = (State.traces && State.traces.length > 0) ? State.traces : (State.previewTraces || []);
    var layerFilter = (document.getElementById('selImportTraceLayer') || {}).value || '';
    var q = ((document.getElementById('inpImportTraceSearch') || {}).value || '').trim().toLowerCase();

    var filtered = source.filter(function (t) {
      if (layerFilter && t.layer !== layerFilter) return false;
      if (q) {
        return String(t.id).indexOf(q) >= 0 || (t.net || '').toLowerCase().indexOf(q) >= 0 ||
          (t.layer || '').toLowerCase().indexOf(q) >= 0 || (t.type || '').toLowerCase().indexOf(q) >= 0;
      }
      return true;
    });

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:18px;color:var(--sub)">无匹配的走线记录</td></tr>';
      return;
    }

    var displaySlice = filtered.slice(0, 300);
    tbody.innerHTML = displaySlice.map(function (t) {
      var col = getTraceLayerColor(t.layer);
      var widthsStr = (t.widths && t.widths.length) ? t.widths.join(' / ') : String(t.width || '-');
      var segDesc = t.arcCount > 0 && t.lineCount > 0
        ? (t.segmentCount + '段 · 直' + t.lineCount + '+弧' + t.arcCount)
        : (t.arcCount > 0 ? (t.arcCount + '段圆弧') : (t.lineCount + '段直线'));
      var pStart = t.start ? ('[' + t.start[0].toFixed(1) + ', ' + t.start[1].toFixed(1) + ']') : '-';
      var pEnd = t.end ? ('[' + t.end[0].toFixed(1) + ', ' + t.end[1].toFixed(1) + ']') : '-';
      return '<tr>' +
        '<td style="font-family:var(--mono);font-weight:700">#' + t.id + '</td>' +
        '<td><span class="badge-tag">&lt;' + escapeHtml(t.tag) + '&gt;</span></td>' +
        '<td><span style="display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-weight:600"><span style="width:8px;height:8px;border-radius:50%;background:' + col + ';display:inline-block"></span>' + escapeHtml(t.layer) + '</span></td>' +
        '<td style="font-family:var(--mono);font-weight:700;color:var(--pri-d)">' + escapeHtml(t.net) + '</td>' +
        '<td style="font-size:12px">' + segDesc + '</td>' +
        '<td style="font-family:var(--mono)">' + escapeHtml(widthsStr) + '</td>' +
        '<td style="font-family:var(--mono)">' + t.length.toFixed(2) + '</td>' +
        '<td style="font-family:var(--mono);font-size:11px;color:var(--sub)">' + pStart + ' → ' + pEnd + '</td>' +
        '<td><button type="button" class="btn small sec" onclick="locateTraceInCanvas(' + t.id + ')">定位</button></td></tr>';
    }).join('') + (filtered.length > 300 ? ('<tr><td colspan="9" style="text-align:center;color:var(--sub);font-size:11px">仅展示前 300 条，共 ' + filtered.length + ' 条</td></tr>') : '');
  }

  function renderImportedTraceOverview(vias, traces, traceSummary) {
    var card = document.getElementById('cardImportedTraceOverview');
    if (!card) return;
    var vList = Array.isArray(vias) ? vias : [];
    var tList = Array.isArray(traces) ? traces : [];
    var ts = traceSummary || (FC.summarizeTraceData ? FC.summarizeTraceData(tList) : null);
    if (!vList.length && !tList.length) { card.style.display = 'none'; return; }

    card.style.display = 'block';
    State.previewTraces = tList;
    syncTraceLayerSelectors(ts);

    var sigViaCnt = vList.filter(function (v) { return !v.net || v.net.toUpperCase().indexOf('GND') < 0; }).length;
    var gndViaCnt = vList.length - sigViaCnt;
    var hint = document.getElementById('lblImportParseHint');
    if (hint) {
      hint.textContent = tList.length > 0
        ? ('共读取 ' + vList.length + ' 个过孔 · 信号孔 ' + sigViaCnt + ' / 地孔 ' + gndViaCnt + ' 与 ' + ts.totalTraces + ' 条走线 / ' + ts.totalTraceSegments + ' 段。')
        : ('共读取 ' + vList.length + ' 个过孔 · 信号孔 ' + sigViaCnt + ' / 地孔 ' + gndViaCnt + '，未含走线块。');
    }

    var metricsEl = document.getElementById('pnlImportTraceMetrics');
    if (metricsEl && ts) {
      metricsEl.innerHTML =
        '<div class="stat-box"><div class="lbl">过孔</div><div class="val">' + vList.length + '</div></div>' +
        '<div class="stat-box"><div class="lbl">走线对象</div><div class="val">' + ts.totalTraces + '</div></div>' +
        '<div class="stat-box"><div class="lbl">几何线段</div><div class="val">' + ts.totalTraceSegments + '</div></div>' +
        '<div class="stat-box"><div class="lbl">走线层数</div><div class="val">' + ts.layers.length + '</div></div>';
    }

    var layersEl = document.getElementById('pnlImportTraceLayers');
    if (layersEl && ts) {
      layersEl.innerHTML = ts.layers.map(function (l) {
        var col = getTraceLayerColor(l.layer);
        return '<span class="chip" onclick="filterImportTraceByLayer(\'' + escapeHtml(l.layer) + '\')">' +
          '<span style="width:8px;height:8px;border-radius:50%;background:' + col + ';display:inline-block"></span>' +
          '<strong>' + escapeHtml(l.layer) + '</strong>: ' + l.segmentCount + '段</span>';
      }).join('');
    }

    var wrapTbl = document.getElementById('wrapImportTraceTable');
    if (wrapTbl) wrapTbl.style.display = tList.length > 0 ? 'block' : 'none';
    renderImportedTraceTable();
  }

  function executeFanoutCheck() {
    var rawInMemory = State.rawText || '';
    var taVal = document.getElementById('txtViaInput').value.trim();
    var txt = (rawInMemory && taVal.indexOf('[ 已加载大型文件:') === 0) ? rawInMemory : taVal;
    if (!txt) { alert('请先上传或粘贴 PCB 过孔 / 走线数据 TXT'); return; }

    var clusterVal = parseFloat(document.getElementById('inpClusterDist').value) || 2.0;
    var clusterUnit = document.getElementById('selClusterUnit').value;
    var clusterDistInMil = clusterUnit === 'mm' ? clusterVal / 0.0254 : clusterVal;
    var distTol = parseFloat(document.getElementById('inpDistTol').value) || 2.0;
    var allowRot = document.getElementById('chkAllowRotation').checked;
    var allowMir = document.getElementById('chkAllowMirror').checked;
    var allowArb = document.getElementById('chkAllowArbitraryRotation') ? document.getElementById('chkAllowArbitraryRotation').checked : false;
    var allowSubset = document.getElementById('chkAllowSubsetMatch') ? document.getElementById('chkAllowSubsetMatch').checked : true;
    var redundantPolicy = document.getElementById('selRedundantPolicy') ? document.getElementById('selRedundantPolicy').value : 'ANY_GND_REDUNDANT';

    var res = FC.runFanoutInspection(txt, State.library, {
      clusterThreshold: clusterDistInMil,
      distanceTolerance: distTol,
      allowRotation: allowRot,
      allowMirror: allowMir,
      allowArbitraryRotation: allowArb,
      allowSubsetMatch: allowSubset,
      redundantViaPolicy: redundantPolicy
    });

    if (!res.success) { alert(res.error || '检查失败'); return; }

    State.vias = res.vias;
    State.traces = res.traces || [];
    State.traceSummary = res.traceSummary || null;
    State.clusters = res.clusters;
    State.summary = res.summary;
    State.selectedTraceId = null;
    if (root.buildCanvasSpatialGrid) root.buildCanvasSpatialGrid();
    State.page = 1;
    State.canvas.hasInitialFit = false;

    renderImportedTraceOverview(State.vias, State.traces, State.traceSummary);
    root.updateTopKPIs();
    applyFilters();
    root.switchTab(res.pureTraceMode ? 'tabCanvas' : 'tabResults');
  }

  function setResultFilter(filterKey) {
    if (filterKey === 'unmatched') filterKey = 'isolated';
    State.filter = filterKey;
    var filterBtns = {
      all: 'btnFilterAll',
      pass: 'btnFilterPass',
      subset: 'btnFilterSubset',
      fail: 'btnFilterFail',
      padstack: 'btnFilterPadstack',
      dist: 'btnFilterDist',
      isolated: 'btnFilterIsolated'
    };
    Object.keys(filterBtns).forEach(function (k) {
      var btn = document.getElementById(filterBtns[k]);
      if (btn) btn.className = 'btn small ' + (k === filterKey ? 'pri' : 'sec');
    });
    applyFilters();
  }

  function applyFilters() {
    var query = (document.getElementById('inpSearch').value || '').trim().toLowerCase();
    var schemeFilter = document.getElementById('selSchemeFilter').value;

    State.filteredClusters = State.clusters.filter(function (c) {
      var res = c.matchResult;
      if (!res) return true;
      if (State.filter === 'pass' && !res.pass) return false;
      if (State.filter === 'subset' && (!res.pass || !res.isSubsetMatch)) return false;
      if (State.filter === 'fail' && res.pass) return false;
      if (State.filter === 'padstack' && res.status !== 'PADSTACK_MISMATCH' && res.status !== 'SUBSET_PADSTACK_MISMATCH') return false;
      if (State.filter === 'dist' && res.status !== 'DISTANCE_MISMATCH') return false;
      if (State.filter === 'isolated' && res.status !== 'ISOLATED_VIA' && res.status !== 'NO_MATCH_TOPOLOGY') return false;
      if (schemeFilter && res.schemeName !== schemeFilter) return false;

      if (query) {
        var matchId = c.id.toLowerCase().indexOf(query) >= 0;
        var matchVia = c.vias.some(function (v) {
          return String(v.id).indexOf(query) >= 0 ||
            (v.net && v.net.toLowerCase().indexOf(query) >= 0) ||
            (v.padstack && v.padstack.toLowerCase().indexOf(query) >= 0);
        });
        var matchScheme = !!(res.schemeName && res.schemeName.toLowerCase().indexOf(query) >= 0);
        var matchMsg = !!(res.message && res.message.toLowerCase().indexOf(query) >= 0);
        var matchTraceLayer = !!(c.traceSummary && Array.isArray(c.traceSummary.layers) &&
          c.traceSummary.layers.some(function (l) { return l.toLowerCase().indexOf(query) >= 0; }));
        if (!matchId && !matchVia && !matchScheme && !matchMsg && !matchTraceLayer) return false;
      }
      return true;
    });

    State.page = 1;
    renderResultsTable();
  }

  function syncResultsReviewHeader() {
    var list = State.filteredClusters || [];
    var badge = document.getElementById('badgeResultsReviewProgress');
    if (badge) {
      var failList = State.clusters.filter(function (c) { return !(c.matchResult && c.matchResult.pass); });
      var targetTotal = failList.length > 0 ? failList.length : State.clusters.length;
      var reviewedFailCnt = failList.length > 0
        ? failList.filter(function (c) { return State.reviewedClusters.has(c.id); }).length
        : State.reviewedClusters.size;
      badge.textContent = failList.length > 0
        ? ('异常已复核: ' + reviewedFailCnt + ' / ' + targetTotal)
        : ('已复核: ' + State.reviewedClusters.size + ' / ' + targetTotal);
    }

    var masterChk = document.getElementById('chkSelectAll');
    if (masterChk) {
      if (!list.length) {
        masterChk.checked = false;
        masterChk.indeterminate = false;
      } else {
        var checkedCount = list.filter(function (c) { return State.reviewedClusters.has(c.id); }).length;
        masterChk.checked = checkedCount === list.length;
        masterChk.indeterminate = checkedCount > 0 && checkedCount < list.length;
      }
    }
  }

  function renderResultsTable() {
    var tbody = document.getElementById('tblResultsBody');
    if (!tbody) return;
    var list = State.filteredClusters || [];
    var total = list.length;
    if (document.getElementById('lblTotalCount')) document.getElementById('lblTotalCount').textContent = String(total);

    if (total === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:28px;color:var(--sub)">' +
        (State.clusters.length === 0 ? '请先在 ② 检查数据导入 载入过孔数据并运行检查' : '无符合当前筛选条件的孔群') +
        '</td></tr>';
      document.getElementById('lblPageStart').textContent = '0';
      document.getElementById('lblPageEnd').textContent = '0';
      document.getElementById('lblCurrentPage').textContent = '1 / 1';
      syncResultsReviewHeader();
      return;
    }

    var pageSize = State.pageSize;
    var totalPages = Math.ceil(total / pageSize);
    if (State.page > totalPages) State.page = totalPages;
    if (State.page < 1) State.page = 1;
    var startIdx = (State.page - 1) * pageSize;
    var endIdx = Math.min(startIdx + pageSize, total);
    var slice = list.slice(startIdx, endIdx);

    document.getElementById('lblPageStart').textContent = String(startIdx + 1);
    document.getElementById('lblPageEnd').textContent = String(endIdx);
    document.getElementById('lblCurrentPage').textContent = State.page + ' / ' + totalPages;

    tbody.innerHTML = slice.map(function (c) {
      var res = c.matchResult || {};
      var isReviewed = State.reviewedClusters.has(c.id);
      var rowClass = isReviewed ? 'reviewed' : (res.pass ? 'row-pass' : 'row-fail');

      var badgeHtml = res.pass
        ? ('<span class="badge-tag ok">匹配通过 · ' + escapeHtml(res.schemeName) + '</span>')
        : (res.status === 'PADSTACK_MISMATCH'
          ? ('<span class="badge-tag warn">Padstack 不符 · ' + escapeHtml(res.schemeName) + '</span>')
          : (res.status === 'DISTANCE_MISMATCH'
            ? ('<span class="badge-tag warn">孔距/伴随孔偏差 · ' + escapeHtml(res.schemeName) + '</span>')
            : '<span class="badge-tag bad">未匹配预设方案</span>'));

      var sigVias = c.signalVias || c.vias.filter(function (v) { return v.net && v.net.toUpperCase().indexOf('GND') < 0; });
      var sigStr = sigVias.map(function (v) { return '#' + v.id + ' ' + escapeHtml(v.net); }).join(', ');
      var gndCount = c.vias.length - sigVias.length;
      var ts = c.traceSummary || null;
      var traceInfoHtml = (ts && (ts.segmentCount > 0 || (ts.layers && ts.layers.length > 0)))
        ? ('<div style="margin-top:3px;padding:2px 6px;background:#f8fafc;border:1px solid var(--line);border-radius:4px;color:var(--pri-d);font-size:11px">' +
           '出线层: <strong style="font-family:var(--mono)">' + escapeHtml(ts.layers.join(', ') || '-') + '</strong>' +
           (ts.segmentCount > 0 ? ('<br>走线: ' + ts.segmentCount + '段 | 宽 ' + escapeHtml(ts.widths.join('/')) + ' mil') : '') + '</div>')
        : '';

      var maxSpan = (c.bbox && c.bbox.maxSpan != null) ? c.bbox.maxSpan : Math.hypot((c.bbox && c.bbox.spanX) || 0, (c.bbox && c.bbox.spanY) || 0);

      return '<tr class="' + rowClass + '" id="row_' + c.id + '">' +
        '<td><input type="checkbox" data-no-persist ' + (isReviewed ? 'checked' : '') + ' onchange="toggleReviewCluster(\'' + c.id + '\', this.checked)"></td>' +
        '<td><strong style="color:var(--pri);cursor:pointer" onclick="locateClusterInCanvas(\'' + c.id + '\')">' + escapeHtml(c.id) + '</strong></td>' +
        '<td><span class="badge-tag purple">' + c.viaCount + '孔 · 信' + sigVias.length + '/地' + gndCount + '</span></td>' +
        '<td><div style="font-family:var(--mono);font-size:11px">[' + c.centroid.x.toFixed(1) + ', ' + c.centroid.y.toFixed(1) + ']</div>' +
          '<div style="font-size:11px;color:var(--sub)">跨度: ' + (maxSpan * 0.0254).toFixed(2) + ' mm</div></td>' +
        '<td style="max-width:210px;font-size:11px">' +
          '<div style="font-weight:700;color:var(--pri-d)">' + (c.signalNet ? escapeHtml(c.signalNet) : sigStr) + '</div>' +
          '<div style="color:var(--sub);font-size:11px">信号孔: ' + sigStr + ' · 地孔: ' + gndCount + '</div>' + traceInfoHtml + '</td>' +
        '<td>' + badgeHtml + '</td>' +
        '<td style="font-size:11px;line-height:1.5">' +
          '<div style="font-weight:600;color:' + (res.pass ? 'var(--ok)' : 'var(--heading)') + '">' + escapeHtml(res.message || '-') + '</div>' +
          (res.advice ? ('<div style="margin-top:4px;padding:4px 8px;background:var(--surface-subtle);border:1px solid var(--line);border-radius:4px">' + escapeHtml(res.advice) + '</div>') : '') +
        '</td>' +
        '<td><label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer">' +
          '<input type="checkbox" data-no-persist ' + (isReviewed ? 'checked' : '') + ' onchange="toggleReviewCluster(\'' + c.id + '\', this.checked)">' +
          '<span>' + (isReviewed ? '已复核' : '待复核') + '</span></label></td>' +
        '<td><div style="display:flex;gap:4px">' +
          '<button type="button" class="btn small sec" onclick="locateClusterInCanvas(\'' + c.id + '\')">定位</button>' +
          '<button type="button" class="btn small sec" onclick="saveClusterAsScheme(\'' + c.id + '\')">存方案</button></div></td></tr>';
    }).join('');

    syncResultsReviewHeader();
  }

  function changePage(delta) { State.page += delta; renderResultsTable(); }

  function toggleReviewCluster(clusterId, reviewed) {
    var nextVal = reviewed !== undefined ? Boolean(reviewed) : !State.reviewedClusters.has(clusterId);
    if (nextVal) State.reviewedClusters.add(clusterId);
    else State.reviewedClusters.delete(clusterId);
    renderResultsTable();
    renderAnalysisTab();
    if (State.selectedClusterId === clusterId && root.openClusterDeepDive) {
      var activeCluster = State.clusters.find(function (c) { return c.id === clusterId; });
      if (activeCluster) root.openClusterDeepDive(activeCluster);
    } else if (root.requestCanvasRender) {
      root.requestCanvasRender();
    }
  }

  function toggleSelectAll(masterChk) {
    (State.filteredClusters || []).forEach(function (c) {
      if (masterChk.checked) State.reviewedClusters.add(c.id);
      else State.reviewedClusters.delete(c.id);
    });
    renderResultsTable();
    renderAnalysisTab();
  }

  function saveClusterAsScheme(clusterId) {
    var cluster = State.clusters.find(function (c) { return c.id === clusterId; });
    if (!cluster) return;
    var scheme = FC.FanoutScheme.fromVias('扇出方案_' + cluster.id + '_' + cluster.viaCount + '孔', cluster.vias, {
      category: '提取方案',
      description: '自 ' + cluster.id + ' 提取'
    });
    State.library.addScheme(scheme);
    root.renderSchemeCards();
  }

  function exportResultsCSV() {
    if (!State.clusters.length) { alert('暂无检查结果可导出'); return; }
    var csv = '\uFEFF孔群编号,过孔数量,质心X,质心Y,最大跨度(mil),判定结果,匹配方案名,旋转角度,镜像状态,比对说明,复核状态\n';
    State.clusters.forEach(function (c) {
      var res = c.matchResult || {};
      var maxSpan = (c.bbox && c.bbox.maxSpan != null) ? c.bbox.maxSpan : Math.hypot((c.bbox && c.bbox.spanX) || 0, (c.bbox && c.bbox.spanY) || 0);
      csv += [
        '"' + c.id + '"', c.viaCount, c.centroid.x.toFixed(2), c.centroid.y.toFixed(2), maxSpan.toFixed(2),
        '"' + (res.statusText || '-') + '"', '"' + (res.schemeName || '-') + '"',
        res.rotationAngle != null ? res.rotationAngle : '-', res.isMirrored ? '是' : '否',
        '"' + String(res.message || '').replace(/"/g, '""') + '"',
        '"' + (State.reviewedClusters.has(c.id) ? '已复核' : '待复核') + '"'
      ].join(',') + '\n';
    });
    root.showExportBox('fanout_inspection_results_' + Date.now() + '.csv', csv, '共 ' + State.clusters.length + ' 组孔群记录。', 'text/csv');
  }


  function renderAnalysisTab() {
    if (typeof root.renderAnalysisTab === "function") root.renderAnalysisTab();
  }

  root.setClusterThresh = setClusterThresh;
  root.toggleClusterUnit = toggleClusterUnit;
  root.syncClusterDistUnit = syncClusterDistUnit;
  root.setDistTol = setDistTol;
  root.handleViaFileUpload = handleViaFileUpload;
  root.loadSample26Vias = loadSample26Vias;
  root.loadSampleTraceOnly = loadSampleTraceOnly;
  root.scheduleImportPreviewUpdate = scheduleImportPreviewUpdate;
  root.filterImportTraceByLayer = filterImportTraceByLayer;
  root.renderImportedTraceOverview = renderImportedTraceOverview;
  root.renderImportedTraceTable = renderImportedTraceTable;
  root.executeFanoutCheck = executeFanoutCheck;
  root.setResultFilter = setResultFilter;
  root.applyFilters = applyFilters;
  root.renderResultsTable = renderResultsTable;
  root.changePage = changePage;
  root.toggleReviewCluster = toggleReviewCluster;
  root.toggleSelectAll = toggleSelectAll;
  root.saveClusterAsScheme = saveClusterAsScheme;
  root.exportResultsCSV = exportResultsCSV;
})(typeof window !== "undefined" ? window : globalThis);
