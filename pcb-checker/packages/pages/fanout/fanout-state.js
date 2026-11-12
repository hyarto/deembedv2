/* ============================================================================
 * fanout-state.js —— 扇出方案检查模块：全局状态、工序切换、导出弹窗与容错 JSON 解析
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var FC = root.FanoutChecker;

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var TRACE_LAYER_PALETTE = ['#f59e0b', '#a855f7', '#22d3ee', '#fb7185', '#4ade80', '#60a5fa', '#f97316', '#e879f9'];
  var traceLayerColorCache = new Map();

  function getTraceLayerColor(layerName) {
    var key = (layerName || 'UNKNOWN_LAYER').trim();
    if (traceLayerColorCache.has(key)) return traceLayerColorCache.get(key);
    var hash = 0;
    for (var i = 0; i < key.length; i++) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
    var idx = traceLayerColorCache.size < TRACE_LAYER_PALETTE.length
      ? traceLayerColorCache.size
      : Math.abs(hash) % TRACE_LAYER_PALETTE.length;
    var col = TRACE_LAYER_PALETTE[idx];
    traceLayerColorCache.set(key, col);
    return col;
  }

  var State = {
    library: new FC.FanoutLibrary(),
    rawText: '',
    vias: [],
    traces: [],
    previewTraces: [],
    traceSummary: null,
    clusters: [],
    filteredClusters: [],
    summary: null,
    clusterDist: 2.0,
    clusterDistUnit: 'mm',
    distTolerance: 2.0,
    allowRotation: true,
    allowMirror: true,
    activeTab: 'tabLibrary',
    filter: 'all',
    schemeFilter: '',
    searchQuery: '',
    page: 1,
    pageSize: 20,
    reviewedClusters: new Set(),
    selectedClusterId: null,
    selectedTraceId: null,
    analysisFilter: 'all',
    analysisSearch: '',
    analysisPage: 1,
    analysisPageSize: 15,
    canvas: {
      zoom: 1.0,
      panX: 0,
      panY: 0,
      isDragging: false,
      dragStartX: 0,
      dragStartY: 0,
      hoveredCluster: null,
      showTraces: true,
      traceLayerFilter: '',
      showHulls: true,
      showLabels: true,
      showDims: true,
      showBadges: true,
      measureMode: false,
      measurePoints: [],
      hasInitialFit: false
    },
    modalVias: []
  };

  function switchTab(tabId) {
    var tabs = ['tabLibrary', 'tabImport', 'tabResults', 'tabCanvas', 'tabAnalysis'];
    document.querySelectorAll('nav#tabs button').forEach(function (btn, idx) {
      var target = btn.dataset.tab || tabs[idx];
      btn.classList.toggle('active', target === tabId);
    });
    document.querySelectorAll('main > section.tab').forEach(function (sec) {
      sec.classList.toggle('active', sec.id === tabId);
    });
    State.activeTab = tabId;

    if (tabId === 'tabCanvas') {
      var run = function () {
        if (root.resizeCanvas) root.resizeCanvas();
        if (!State.canvas.hasInitialFit && (State.clusters.length > 0 || (State.traces && State.traces.length > 0))) {
          if (root.fitCanvasToLayout) root.fitCanvasToLayout();
          State.canvas.hasInitialFit = true;
        } else if (root.renderCanvas) {
          root.renderCanvas();
        }
      };
      if (root.requestAnimationFrame) root.requestAnimationFrame(run);
      else setTimeout(run, 16);
    } else if (tabId === 'tabAnalysis' && root.renderAnalysisTab) {
      root.renderAnalysisTab();
    }

    if (root.EdaShell && typeof root.EdaShell.syncStageBar === 'function') {
      root.EdaShell.syncStageBar();
      root.EdaShell.syncTelemetry();
    }
  }

  function showExportBox(filename, text, hint, mimeType) {
    mimeType = mimeType || 'application/json';
    var modal = document.getElementById('modalExport');
    var title = document.getElementById('exportModalTitle');
    var hintEl = document.getElementById('exportModalHint');
    var txtArea = document.getElementById('exportModalText');
    var dlBtn = document.getElementById('exportDownloadBtn');
    var tip = document.getElementById('copySuccessTip');

    if (title) title.textContent = '导出: ' + filename;
    if (hintEl) hintEl.textContent = hint || ('已生成 ' + filename);
    if (txtArea) txtArea.value = text;
    if (tip) tip.style.display = 'none';

    var url = '';
    try { url = URL.createObjectURL(new Blob([text], { type: mimeType })); }
    catch (e) { url = 'data:' + mimeType + ';charset=utf-8,' + encodeURIComponent(text); }

    if (dlBtn) {
      dlBtn.href = url;
      dlBtn.download = filename;
    }
    if (modal) modal.classList.add('open');

    try {
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 100);
    } catch (err) {}
  }

  function closeExportBox() {
    var modal = document.getElementById('modalExport');
    if (modal) modal.classList.remove('open');
  }

  function copyExportContent() {
    var txtArea = document.getElementById('exportModalText');
    var tip = document.getElementById('copySuccessTip');
    if (!txtArea) return;
    txtArea.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txtArea.value).then(function () {
        if (tip) { tip.style.display = 'inline-flex'; setTimeout(function () { tip.style.display = 'none'; }, 2000); }
      }).catch(function () { document.execCommand('copy'); });
    } else {
      document.execCommand('copy');
    }
  }

  function parseAndRepairFanoutJson(input) {
    if (!input) return { success: false, error: '输入内容为空' };
    var text = (typeof input === 'string' ? input : (input.text || String(input))).replace(/^\uFEFF/, '').trim();
    if (!text) return { success: false, error: '输入内容为空' };

    try {
      var parsed = JSON.parse(text);
      var schemes = [];
      if (Array.isArray(parsed)) schemes = parsed;
      else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.schemes)) schemes = parsed.schemes;
        else if (Array.isArray(parsed.fanoutSchemes)) schemes = parsed.fanoutSchemes;
        else if (Array.isArray(parsed.data)) schemes = parsed.data;
        else if (Array.isArray(parsed.vias)) schemes = [parsed];
      }
      if (schemes.length > 0) return { success: true, schemes: schemes, recovered: false };
    } catch (err) {}

    var endIdx = text.length;
    while (endIdx > 0) {
      var lastObjClose = text.lastIndexOf('}', endIdx - 1);
      if (lastObjClose === -1) break;
      var cand = text.slice(0, lastObjClose + 1).replace(/,\s*$/, '') + '\n]';
      try {
        var p3 = JSON.parse(cand);
        if (Array.isArray(p3) && p3.length > 0) {
          return { success: true, schemes: p3, recovered: true, message: '检测到末尾截断，已自动修复提取 ' + p3.length + ' 套方案。' };
        }
      } catch (e3) { endIdx = lastObjClose; }
    }
    return { success: false, error: '未能识别有效的扇出方案 JSON 数据' };
  }

  function updateTopKPIs() {
    var s = State.summary;
    var elTotalVias = document.getElementById('statTotalVias');
    var elTotalTraces = document.getElementById('statTotalTraces');
    var elTraceMeta = document.getElementById('statTraceMeta');
    var elTotalClusters = document.getElementById('statTotalClusters');
    var elPassClusters = document.getElementById('statPassClusters');
    var elPassRate = document.getElementById('statPassRate');
    var elFailClusters = document.getElementById('statFailClusters');
    var elBadgeClusterCount = document.getElementById('badgeClusterCount');

    if (!s) {
      if (elTotalVias) elTotalVias.textContent = '0';
      if (elTotalTraces) elTotalTraces.textContent = '0';
      if (elTraceMeta) elTraceMeta.textContent = '段 · 0层/0网络';
      if (elTotalClusters) elTotalClusters.textContent = '0';
      if (elPassClusters) elPassClusters.textContent = '0';
      if (elPassRate) elPassRate.textContent = '0%';
      if (elFailClusters) elFailClusters.textContent = '0';
      if (elBadgeClusterCount) elBadgeClusterCount.textContent = '0';
      return;
    }

    var segCount = s.totalTraceSegments != null ? s.totalTraceSegments : (State.traces ? State.traces.length : 0);
    var lyrCnt = Array.isArray(s.traceLayers) ? s.traceLayers.length : 0;
    var netCnt = Array.isArray(s.traceNets) ? s.traceNets.length : 0;

    if (elTotalVias) elTotalVias.textContent = s.totalVias.toLocaleString();
    if (elTotalTraces) elTotalTraces.textContent = segCount.toLocaleString();
    if (elTraceMeta) elTraceMeta.textContent = '段 (' + lyrCnt + '层/' + netCnt + '网络)';
    if (elTotalClusters) elTotalClusters.textContent = String(s.totalClusters);
    if (elPassClusters) elPassClusters.textContent = String(s.passCount);
    if (elPassRate) elPassRate.textContent = s.passRate + '%';
    if (elFailClusters) elFailClusters.textContent = String(s.failCount);
    if (elBadgeClusterCount) elBadgeClusterCount.textContent = String(s.totalClusters);

    var mapCnt = {
      cntFilterAll: s.totalClusters,
      cntFilterPass: s.passCount,
      cntFilterSubset: s.subsetPassCount || 0,
      cntFilterFail: s.failCount,
      cntFilterPadstack: s.padstackFailCount,
      cntFilterDist: s.distFailCount,
      cntFilterIsolated: s.isolatedCount || s.noMatchCount || 0
    };
    Object.keys(mapCnt).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = String(mapCnt[id]);
    });

    if (root.EdaShell && typeof root.EdaShell.syncTelemetry === 'function') {
      root.EdaShell.syncTelemetry();
    }
  }

  root.State = State;
  root.escapeHtml = escapeHtml;
  root.getTraceLayerColor = getTraceLayerColor;
  root.switchTab = switchTab;
  root.showExportBox = showExportBox;
  root.closeExportBox = closeExportBox;
  root.copyExportContent = copyExportContent;
  root.parseAndRepairFanoutJson = parseAndRepairFanoutJson;
  root.updateTopKPIs = updateTopKPIs;
  root.FanoutApp = {
    State: State,
    escapeHtml: escapeHtml,
    getTraceLayerColor: getTraceLayerColor,
    switchTab: switchTab,
    showExportBox: showExportBox,
    updateTopKPIs: updateTopKPIs
  };
})(typeof window !== 'undefined' ? window : globalThis);
