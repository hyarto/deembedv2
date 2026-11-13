/* ============================================================================
 * pour-state.js —— 铜皮检查模块：全局状态、五项规则配置、弹窗 CRUD 与检查执行控制器
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

  function cleanMsg(msg) {
    return String(msg == null ? '' : msg).replace(/^[\s✅❌⚠️]+/u, '').trim();
  }

  function safeRAF(fn) {
    if (typeof root.requestAnimationFrame === 'function') {
      root.requestAnimationFrame(fn);
    } else {
      setTimeout(fn, 0);
    }
  }

  var State = {
    viaCoverageRules: [
      { id: 'cov_1', padstack: 'HDI_045drill_ring3_1_4', layers: 'L1-L5', coverageRadius: 50.0 },
      { id: 'cov_2', padstack: 'BGA_GND_pad1mil_0902', layers: '02G01P, 19IS08', coverageRadius: 30.0 }
    ],
    specialShapeTemplates: [
      { id: 'tmpl_1', name: 'L2特定异型泪滴铜皮', padstack: 'BGA_3510', layer: '02G01P', expectedArea: 452.38, areaTolerance: 30.0, rawShapeText: '' },
      { id: 'tmpl_2', name: 'L19特定异型铜皮', padstack: 'BGA_3510', layer: '19IS08', expectedArea: 113.10, areaTolerance: 20.0, rawShapeText: '' }
    ],
    traceMarginRules: [
      { id: 'margin_1', traceLayer: '19IS08', upperRefLayer: '08IS03', lowerRefLayer: 'Bottom', minMargin: 50.0 },
      { id: 'margin_2', traceLayer: '08IS03', upperRefLayer: '02G01P', lowerRefLayer: '19IS08', minMargin: 40.0 }
    ],
    smallCopperAreaThreshold: 500.0,
    minArcRadius: 10.0,

    shapes: [],
    vias: [],
    traces: [],
    layers: [],
    rawResults: [],
    groupedResults: [],
    results: [],
    filteredResults: [],
    summary: null,
    activeTab: 'tabRules',
    categoryFilter: 'all',
    viewMode: 'grouped',
    expandedRows: new Set(),
    page: 1,
    pageSize: 20,
    reviewedItems: new Set(),
    activeReviewKey: null,

    history: {
      r1_padstack: ['HDI_045drill_ring3_1_4', 'BGA_GND_pad1mil_0902', 'BGA_3510', 'SMA_via'],
      r1_layers: ['L1-L5', 'L1-L10', 'Top, 02G01P, 08IS03, 19IS08, Bottom', '02G01P-19IS08', '全部层'],
      r1_dist: ['50.0', '40.0', '30.0', '20.0', '15.0'],

      r2_name: ['L2特定异型泪滴铜皮', 'L19特定异型铜皮', 'SMA专用接地异型铜皮', 'BGA局部加宽铜皮'],
      r2_padstack: ['BGA_3510', 'HDI_045drill', 'SMA_Bot-L19', 'BGA_GND'],
      r2_layer: ['02G01P', '19IS08', 'L2', 'L4', 'L17'],
      r2_tol: ['30.0', '20.0', '10.0', '50.0'],

      r3_tracelayer: ['19IS08', '08IS03', '02G01P', 'L4', 'L6', 'L8'],
      r3_upperref: ['08IS03', '02G01P', 'Top', 'L3', 'L5'],
      r3_lowerref: ['Bottom', '19IS08', '08IS03', 'L5', 'L7'],
      r3_margin: ['50.0', '45.0', '40.0', '30.0', '20.0'],

      r4_area: ['500.0', '300.0', '200.0', '1000.0', '2000.0'],
      r5_radius: ['10.0', '8.0', '6.0', '5.0', '12.0']
    },

    canvas: {
      zoom: 1.0,
      panX: 0,
      panY: 0,
      isDragging: false,
      dragStartX: 0,
      dragStartY: 0,
      hasInitialFit: false,
      showShapes: true,
      showVias: true,
      showTraces: true,
      showPorts: true,
      showDefects: true,
      measureMode: false,
      measurePoints: []
    },

    editingIndex: -1,
    modalShapeParsed: null
  };

  var TAB_ORDER = ['tabRules', 'tabImport', 'tabResults', 'tabCanvas', 'tabAnalysis'];

  function switchTab(tabId) {
    document.querySelectorAll('nav#tabs button').forEach(function (btn, idx) {
      var target = btn.getAttribute('data-tab') || TAB_ORDER[idx];
      btn.classList.toggle('active', target === tabId);
    });
    document.querySelectorAll('main > section.tab').forEach(function (sec) {
      sec.classList.toggle('active', sec.id === tabId);
    });
    State.activeTab = tabId;

    if (tabId === 'tabCanvas') {
      safeRAF(function () {
        if (typeof root.resizeCanvas === 'function') root.resizeCanvas();
        if (!State.canvas.hasInitialFit && (State.shapes.length > 0 || State.vias.length > 0 || State.traces.length > 0)) {
          if (typeof root.fitCanvasToLayout === 'function') root.fitCanvasToLayout();
          State.canvas.hasInitialFit = true;
        } else if (typeof root.renderCanvas === 'function') {
          root.renderCanvas();
        }
      });
    } else if (tabId === 'tabAnalysis' && typeof root.renderAnalysisTab === 'function') {
      root.renderAnalysisTab();
    }

    if (root.EdaShell && typeof root.EdaShell.syncStageBar === 'function') {
      root.EdaShell.syncStageBar();
    }
  }

  /* ---------- 历史候选快捷标签 ---------- */
  function recordHistory(key, val) {
    if (!val || typeof val !== 'string') return;
    var str = val.trim();
    if (!str) return;
    if (!State.history[key]) State.history[key] = [];
    var list = State.history[key];
    var idx = list.indexOf(str);
    if (idx >= 0) list.splice(idx, 1);
    list.unshift(str);
    if (list.length > 6) list.pop();

    try {
      localStorage.setItem('pcb_pour_unified_history', JSON.stringify(State.history));
    } catch (e) {}

    renderHistoryChips();
  }

  function loadStoredHistory() {
    try {
      var raw = localStorage.getItem('pcb_pour_unified_history');
      if (raw) {
        State.history = Object.assign(State.history, JSON.parse(raw));
      }
    } catch (e) {}
  }

  function renderChipBar(containerId, inputId, list, unit) {
    var el = document.getElementById(containerId);
    if (!el || !list) return;
    var u = unit ? ' ' + unit : '';
    el.innerHTML = '<span class="hint" style="font-size:11px">快捷选项:</span>' + list.map(function (v) {
      return '<span class="chip" data-fill-target="' + esc(inputId) + '" data-fill-val="' + esc(v) + '">' + esc(v) + esc(u) + '</span>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('.chip[data-fill-target]'), function (chip) {
      chip.addEventListener('click', function () {
        fillInputAndRecord(chip.getAttribute('data-fill-target'), chip.getAttribute('data-fill-val'));
      });
    });
  }

  function fillInputAndRecord(inputId, val) {
    var inp = document.getElementById(inputId);
    if (inp) {
      inp.value = val;
      inp.dispatchEvent(new root.Event('change', { bubbles: true }));
    }
  }

  function renderHistoryChips() {
    renderChipBar('chipsModalR1Padstack', 'modalR1InpPadstack', State.history.r1_padstack);
    renderChipBar('chipsModalR1Layers', 'modalR1InpLayers', State.history.r1_layers);
    renderChipBar('chipsModalR1Dist', 'modalR1InpDist', State.history.r1_dist, 'mil');

    renderChipBar('chipsModalR2Name', 'modalR2InpName', State.history.r2_name);
    renderChipBar('chipsModalR2Padstack', 'modalR2InpPadstack', State.history.r2_padstack);
    renderChipBar('chipsModalR2Layer', 'modalR2InpLayer', State.history.r2_layer);
    renderChipBar('chipsModalR2Tol', 'modalR2InpTol', State.history.r2_tol, 'sq mil');

    renderChipBar('chipsModalR3TraceLayer', 'modalR3InpTraceLayer', State.history.r3_tracelayer);
    renderChipBar('chipsModalR3UpperRef', 'modalR3InpUpperRef', State.history.r3_upperref);
    renderChipBar('chipsModalR3LowerRef', 'modalR3InpLowerRef', State.history.r3_lowerref);
    renderChipBar('chipsModalR3Margin', 'modalR3InpMargin', State.history.r3_margin, 'mil');

    renderChipBar('chipsRule4Area', 'rule4InpArea', State.history.r4_area, 'sq mil');
    renderChipBar('chipsRule5Radius', 'rule5InpRadius', State.history.r5_radius, 'mil');
  }


  /* ---------- 数据导入与检查调度 ---------- */
  function handleFileUpload(event) {
    var file = event && event.target && event.target.files && event.target.files[0];
    if (!file) return;
    var reader = new root.FileReader();
    reader.onload = function (e) {
      var decoded = root.decodeTxt ? root.decodeTxt(e.target.result) : String(e.target.result || '');
      document.getElementById('txtDataInput').value = decoded;
      executeCopperChecks();
    };
    if (reader.readAsArrayBuffer && root.decodeTxt) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  }

  function loadSampleShapes() {
    root.fetch('sample/铜皮数据示例.txt')
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        document.getElementById('txtDataInput').value = txt;
        executeCopperChecks();
      })
      .catch(function () { root.alert('无法载入示例文件'); });
  }

  function executeCopperChecks() {
    var txtEl = document.getElementById('txtDataInput');
    var txt = txtEl ? txtEl.value.trim() : '';
    if (!txt) {
      switchTab('tabImport');
      root.alert('请先上传或粘贴包含 Shape / Via / Trace 的 TXT 数据。');
      return;
    }

    State.smallCopperAreaThreshold = parseFloat(document.getElementById('rule4InpArea').value) || 500.0;
    State.minArcRadius = parseFloat(document.getElementById('rule5InpRadius').value) || 10.0;

    var btn = document.getElementById('btnRunCheck');
    if (btn) {
      btn.textContent = '正在执行五项几何检查...';
      btn.disabled = true;
    }

    var doCheck = function () {
      var config = {
        viaCoverageRules: State.viaCoverageRules,
        specialShapeTemplates: State.specialShapeTemplates,
        traceMarginRules: State.traceMarginRules,
        smallCopperAreaThreshold: State.smallCopperAreaThreshold,
        minArcRadius: State.minArcRadius
      };

      var res = root.PourChecker.runAllCopperChecks(txt, config);
      if (btn) {
        btn.textContent = '▶ 运行铜皮五项检查';
        btn.disabled = false;
      }

      State.shapes = res.shapes;
      State.vias = res.vias;
      State.traces = res.traces;
      State.layers = res.layers;
      State.rawResults = res.results.all;
      State.groupedResults = res.results.grouped || root.PourChecker.groupResultsByTargetObject(res.results.all);
      State.results = State.groupedResults;
      State.summary = res.summary;
      State.page = 1;
      State.expandedRows.clear();
      State.canvas.hasInitialFit = false;

      if (typeof root.updateTopKPIs === 'function') root.updateTopKPIs();
      if (typeof root.applyFilters === 'function') root.applyFilters();
      switchTab('tabResults');
      if (root.EdaShell && typeof root.EdaShell.syncTelemetry === 'function') {
        root.EdaShell.syncTelemetry();
      }
    };

    if (root.__SYNC_CHECK__) {
      doCheck();
    } else {
      setTimeout(doCheck, 30);
    }
  }

  /* ---------- 导出文件与复制兜底 ---------- */
  function showExportBox(filename, text, hint, mimeType) {
    var mime = mimeType || 'text/csv';
    var modal = document.getElementById('modalExport');
    var title = document.getElementById('exportModalTitle');
    var hintEl = document.getElementById('exportModalHint');
    var txtArea = document.getElementById('exportModalText');
    var dlBtn = document.getElementById('exportDownloadBtn');
    var tip = document.getElementById('copySuccessTip');

    if (title) title.textContent = '导出: ' + filename;
    if (hintEl) hintEl.textContent = hint || ('已生成 ' + filename + '，可下载文件或复制文本内容：');
    if (txtArea) txtArea.value = text;
    if (tip) tip.style.display = 'none';

    var url = '';
    try {
      var blob = new root.Blob([text], { type: mime });
      url = root.URL.createObjectURL(blob);
    } catch (e) {
      url = 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(text);
    }

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
      setTimeout(function () { if (a.parentNode) document.body.removeChild(a); }, 100);
    } catch (err) {}
  }

  function copyExportContent() {
    var txtArea = document.getElementById('exportModalText');
    var tip = document.getElementById('copySuccessTip');
    if (!txtArea) return;

    txtArea.focus();
    txtArea.select();
    if (txtArea.setSelectionRange) txtArea.setSelectionRange(0, txtArea.value.length);

    var success = false;
    try { success = document.execCommand('copy'); } catch (err) { success = false; }

    function showTip() {
      if (tip) {
        tip.style.display = 'inline-flex';
        setTimeout(function () { if (tip) tip.style.display = 'none'; }, 2500);
      }
    }

    if (!success && root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      root.navigator.clipboard.writeText(txtArea.value).then(showTip).catch(showTip);
    } else {
      showTip();
    }
  }

  function bindShellEvents() {
    var nav = document.getElementById('tabs');
    if (nav && !nav.__pourBound) {
      nav.__pourBound = true;
      nav.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('button[data-tab]') : null;
        if (!btn) return;
        switchTab(btn.getAttribute('data-tab'));
      });
    }

    var dz = document.getElementById('dropzoneData');
    if (dz && !dz.__pourBound) {
      dz.__pourBound = true;
      dz.addEventListener('dragover', function (e) {
        e.preventDefault();
        dz.classList.add('dragover');
      });
      dz.addEventListener('dragleave', function () {
        dz.classList.remove('dragover');
      });
      dz.addEventListener('drop', function (e) {
        e.preventDefault();
        dz.classList.remove('dragover');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleFileUpload({ target: { files: [f] } });
      });
    }

    var dockRun = document.getElementById('dockPourRun');
    if (dockRun && !dockRun.__pourBound) {
      dockRun.__pourBound = true;
      dockRun.addEventListener('click', function () { executeCopperChecks(); });
    }
    var dockSample = document.getElementById('dockPourSample');
    if (dockSample && !dockSample.__pourBound) {
      dockSample.__pourBound = true;
      dockSample.addEventListener('click', function () { loadSampleShapes(); });
    }
    var dockCanvas = document.getElementById('dockPourCanvas');
    if (dockCanvas && !dockCanvas.__pourBound) {
      dockCanvas.__pourBound = true;
      dockCanvas.addEventListener('click', function () { switchTab('tabCanvas'); });
    }
    var dockExport = document.getElementById('dockPourExport');
    if (dockExport && !dockExport.__pourBound) {
      dockExport.__pourBound = true;
      dockExport.addEventListener('click', function () {
        if (typeof root.exportResultsCSV === 'function') root.exportResultsCSV();
      });
    }
  }

  function initApp() {
    loadStoredHistory();
    loadSavedRules();
    renderAllRuleTables();
    renderHistoryChips();
    bindShellEvents();
    if (typeof root.initCanvas === 'function') root.initCanvas();
    if (typeof root.updateTopKPIs === 'function') root.updateTopKPIs();
  }


  root.State = State;
  root.PourCleanMsg = cleanMsg;
  root.PourSafeRAF = safeRAF;
  root.initApp = initApp;
  root.switchTab = switchTab;
  root.recordHistory = recordHistory;
  root.loadStoredHistory = loadStoredHistory;
  root.renderHistoryChips = renderHistoryChips;
  root.fillInputAndRecord = fillInputAndRecord;
  root.handleFileUpload = handleFileUpload;
  root.loadSampleShapes = loadSampleShapes;
  root.executeCopperChecks = executeCopperChecks;
  root.showExportBox = showExportBox;
  root.copyExportContent = copyExportContent;
})(typeof window !== "undefined" ? window : globalThis);
