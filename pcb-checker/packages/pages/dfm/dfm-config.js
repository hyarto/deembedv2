/* ============================================================================
 * dfm-config.js —— DFM 加工能力检查：状态管理、历史预设、分层规则、文件导入与引擎调度
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var $ = function (id) { return document.getElementById(id); };
  var escHtml = root.escHtml || function (v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  root.escHtml = escHtml;

  var NET_COLORS = {
    'GND': '#475569',
    '25_N': '#c084fc',
    '25_P': '#84cc16',
    '26_N': '#22c55e',
    '26_P': '#06b6d4'
  };

  var State = {
    rawText: '',
    vias: [],
    traces: [],
    layers: [],
    checkResult: null,
    activeFilter: 'bad',
    searchQuery: '',
    reviewedKeys: {},
    currentPage: 1,
    pageSize: 50,
    measureMode: false,
    measureSelection: [],
    measurements: [],
    resViewMode: 'net_group',
    expandedNetKeys: {},
    highlightNetRoute: null,
    activeLocatedPair: null,
    viewport: {
      zoom: 1.0,
      panX: 0,
      panY: 0,
      isDragging: false,
      dragStartX: 0,
      dragStartY: 0,
      minX: 0, maxX: 100, minY: 0, maxY: 100
    }
  };

  var HistoryManager = {
    keys: {
      thresh_gnd: 'dfm_hist_thresh_gnd',
      thresh_sig: 'dfm_hist_thresh_sig',
      pad_gnd: 'dfm_hist_pad_gnd',
      pad_sig: 'dfm_hist_pad_sig',
      drill_gnd: 'dfm_hist_drill_gnd',
      drill_sig: 'dfm_hist_drill_sig',
      thresh_padpair: 'dfm_hist_thresh_padpair'
    },
    defaults: {
      thresh_gnd: [4.01575, 5.0, 6.0, 8.0],
      thresh_sig: [5.04725, 5.0, 6.0, 8.0, 10.0],
      pad_gnd: [7.906, 5.94, 8.0],
      pad_sig: [12.0, 9.94, 7.906, 10.0],
      drill_gnd: [6.0, 5.54],
      drill_sig: [6.0, 5.54],
      thresh_padpair: [6.0, 5.0, 8.0, 10.0]
    },
    get: function (metric) {
      try {
        if (typeof localStorage !== 'undefined') {
          var stored = localStorage.getItem(this.keys[metric]);
          if (stored) {
            var arr = JSON.parse(stored);
            if (Array.isArray(arr) && arr.length > 0) return arr;
          }
        }
      } catch (e) {}
      return this.defaults[metric] || [];
    },
    add: function (metric, value) {
      if (typeof value !== 'number' || isNaN(value) || value <= 0) return;
      var cur = this.get(metric);
      var valClean = parseFloat(value.toFixed(5));
      var next = [valClean].concat(cur.filter(function (x) { return Math.abs(x - valClean) > 1e-4; })).slice(0, 6);
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(this.keys[metric], JSON.stringify(next));
        }
      } catch (e) {}
      this.renderBar(metric);
    },
    renderBar: function (metric) {
      var barEl = $('hist_' + metric);
      if (!barEl) return;
      var inputEl = this.getInputEl(metric);
      var curVal = inputEl ? parseFloat(inputEl.value) : null;
      var list = this.get(metric);
      barEl.innerHTML = list.map(function (val) {
        var isAct = curVal !== null && Math.abs(curVal - val) < 1e-4;
        return '<button type="button" class="hist-chip ' + (isAct ? 'active' : '') + '" data-metric="' + metric + '" data-val="' + val + '">' + val + '</button>';
      }).join('');

      barEl.querySelectorAll('.hist-chip').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var m = btn.dataset.metric;
          var v = btn.dataset.val;
          var inp = HistoryManager.getInputEl(m);
          if (inp) {
            inp.value = v;
            HistoryManager.renderBar(m);
            if (State.vias.length && State.traces.length) runCheck();
          }
        });
      });
    },
    renderAll: function () {
      var self = this;
      Object.keys(this.keys).forEach(function (k) { self.renderBar(k); });
    },
    getInputEl: function (metric) {
      switch (metric) {
        case 'thresh_gnd': return $('inpThresholdGnd');
        case 'thresh_sig': return $('inpThresholdSignal');
        case 'pad_gnd': return $('inpGndPadDiam');
        case 'pad_sig': return $('inpSignalPadDiam');
        case 'drill_gnd': return $('inpGndFirstDrill');
        case 'drill_sig': return $('inpSignalFirstDrill');
        case 'thresh_padpair': return $('inpThresholdPadPair');
        default: return null;
      }
    }
  };

  function applyPresetScheme(schemeName) {
    if (schemeName === 'eda_project') {
      if ($('inpThresholdGnd')) $('inpThresholdGnd').value = '4.01575';
      if ($('inpThresholdSignal')) $('inpThresholdSignal').value = '5.04725';
      if ($('inpGndPadDiam')) $('inpGndPadDiam').value = '7.906';
      if ($('inpSignalPadDiam')) $('inpSignalPadDiam').value = '12.0';
      if ($('inpGndFirstDrill')) $('inpGndFirstDrill').value = '6.0';
      if ($('inpSignalFirstDrill')) $('inpSignalFirstDrill').value = '6.0';
      if ($('inpThresholdPadPair')) $('inpThresholdPadPair').value = '6.0';
      if ($('selMode')) $('selMode').value = 'pad_to_trace';
    } else if (schemeName === 'std_6mil') {
      if ($('inpThresholdGnd')) $('inpThresholdGnd').value = '6.0';
      if ($('inpThresholdSignal')) $('inpThresholdSignal').value = '6.0';
      if ($('inpGndPadDiam')) $('inpGndPadDiam').value = '7.906';
      if ($('inpSignalPadDiam')) $('inpSignalPadDiam').value = '9.94';
      if ($('inpGndFirstDrill')) $('inpGndFirstDrill').value = '5.54';
      if ($('inpSignalFirstDrill')) $('inpSignalFirstDrill').value = '5.54';
      if ($('inpThresholdPadPair')) $('inpThresholdPadPair').value = '6.0';
      if ($('selMode')) $('selMode').value = 'pad_to_trace';
    } else if (schemeName === 'high_density_5mil') {
      if ($('inpThresholdGnd')) $('inpThresholdGnd').value = '5.0';
      if ($('inpThresholdSignal')) $('inpThresholdSignal').value = '5.0';
      if ($('inpGndPadDiam')) $('inpGndPadDiam').value = '7.0';
      if ($('inpSignalPadDiam')) $('inpSignalPadDiam').value = '9.0';
      if ($('inpGndFirstDrill')) $('inpGndFirstDrill').value = '5.0';
      if ($('inpSignalFirstDrill')) $('inpSignalFirstDrill').value = '5.0';
      if ($('inpThresholdPadPair')) $('inpThresholdPadPair').value = '5.0';
      if ($('selMode')) $('selMode').value = 'pad_to_trace';
    }
    HistoryManager.renderAll();
    if (State.vias.length && State.traces.length) runCheck();
  }


  var LayerRules = {
    get rows() { return root.LayerRules ? root.LayerRules.rows : []; },
    set rows(v) { if (root.LayerRules) root.LayerRules.rows = v; },
    defaults: function () { return root.LayerRules.defaults(); },
    load: function () { return root.LayerRules.load(); },
    save: function () { return root.LayerRules.save(); },
    read: function () { return root.LayerRules.read(); },
    getActive: function () { return root.LayerRules.getActive(); },
    render: function (r) { return root.LayerRules.render(r); },
    renderStats: function (c) { return root.LayerRules.renderStats(c); },
    updateHitCounts: function (c) { return root.LayerRules.updateHitCounts(c); },
    init: function () { return root.LayerRules.init(); }
  };
  var DfmRuleConfig = {
    bindEvents: function () { return root.DfmRuleConfig.bindEvents(); }
  };

  function readPadShapes() {
    var kind = ($('selPadShape') && $('selPadShape').value) || 'circle';
    var gndD = parseFloat($('inpGndPadDiam') ? $('inpGndPadDiam').value : 7.906) || 7.906;
    var sigD = parseFloat($('inpSignalPadDiam') ? $('inpSignalPadDiam').value : 9.94) || 9.94;
    if (kind === 'circle') {
      return { gndPad: { kind: 'circle', w: gndD }, signalPad: { kind: 'circle', w: sigD } };
    }
    var corner = parseFloat($('inpPadCorner') ? $('inpPadCorner').value : 0) || 0;
    var rot = parseFloat($('inpPadRot') ? $('inpPadRot').value : 0) || 0;
    var gndW = parseFloat($('inpGndPadW') ? $('inpGndPadW').value : gndD) || gndD;
    var gndH = parseFloat($('inpGndPadH') ? $('inpGndPadH').value : gndD) || gndD;
    var sigW = parseFloat($('inpSigPadW') ? $('inpSigPadW').value : sigD) || sigD;
    var sigH = parseFloat($('inpSigPadH') ? $('inpSigPadH').value : sigD) || sigD;
    return {
      gndPad: { kind: kind, w: gndW, h: gndH, corner: corner, rot: rot },
      signalPad: { kind: kind, w: sigW, h: sigH, corner: corner, rot: rot }
    };
  }

  function computeBoundingBox() {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    State.vias.forEach(function (v) {
      minX = Math.min(minX, v.origin[0]); maxX = Math.max(maxX, v.origin[0]);
      minY = Math.min(minY, v.origin[1]); maxY = Math.max(maxY, v.origin[1]);
    });
    State.traces.forEach(function (t) {
      minX = Math.min(minX, t.p1[0], t.p2[0]); maxX = Math.max(maxX, t.p1[0], t.p2[0]);
      minY = Math.min(minY, t.p1[1], t.p2[1]); maxY = Math.max(maxY, t.p1[1], t.p2[1]);
    });
    if (minX === Infinity) {
      minX = 0; maxX = 1000; minY = 0; maxY = 1000;
    } else {
      var pad = Math.max(50, (maxX - minX) * 0.1);
      minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    }
    State.viewport.minX = minX;
    State.viewport.maxX = maxX;
    State.viewport.minY = minY;
    State.viewport.maxY = maxY;
    if (root.fitCanvasView) root.fitCanvasView();
  }

  function loadTextData(text, sourceName) {
    State.rawText = text;
    var gndPadDiam = parseFloat($('inpGndPadDiam') ? $('inpGndPadDiam').value : 7.906) || 7.906;
    var sigPadDiam = parseFloat($('inpSignalPadDiam') ? $('inpSignalPadDiam').value : 9.94) || 9.94;
    var gndFirstDrill = parseFloat($('inpGndFirstDrill') ? $('inpGndFirstDrill').value : 5.54) || 5.54;
    var sigFirstDrill = parseFloat($('inpSignalFirstDrill') ? $('inpSignalFirstDrill').value : 5.54) || 5.54;

    var parsed = root.DfmCheck.parseDfmItems(text, Object.assign({
      gndPadDiameter: gndPadDiam,
      signalPadDiameter: sigPadDiam,
      gndFirstDrill: gndFirstDrill,
      signalFirstDrill: sigFirstDrill
    }, readPadShapes()));
    State.vias = parsed.vias;
    State.traces = parsed.traces;

    var layerSet = new Set();
    State.traces.forEach(function (t) { layerSet.add(t.subset); });
    State.layers = Array.from(layerSet).sort();

    var selLayer = $('selLayerFilter');
    if (selLayer) {
      selLayer.innerHTML = '<option value="">全部层</option>' +
        State.layers.map(function (l) { return '<option value="' + escHtml(l) + '">' + escHtml(l) + '</option>'; }).join('');
    }

    if ($('fileStatus')) {
      $('fileStatus').textContent = '已加载: ' + sourceName + ' · ' + State.vias.length + ' 个过孔 / ' + State.traces.length + ' 段走线';
    }

    var thruCount = State.vias.filter(function (v) { return (v.viaSpanType || 'thru') === 'thru'; }).length;
    var blindCount = State.vias.filter(function (v) { return v.viaSpanType === 'blind'; }).length;
    var buriedCount = State.vias.filter(function (v) { return v.viaSpanType === 'buried'; }).length;
    var uniqueSpans = Array.from(new Set(State.vias.map(function (v) { return v.spanLabel || '通孔'; })));

    var summaryCard = $('dataSummaryCard');
    if (summaryCard) summaryCard.style.display = 'block';
    if ($('dataSummaryContent')) {
      $('dataSummaryContent').innerHTML =
        '<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px;align-items:center">' +
          '<div><b>过孔：</b><span class="tag-badge ok">' + State.vias.length + ' · GND ' + State.vias.filter(function (v) { return v.isGnd; }).length + ' / 信号 ' + State.vias.filter(function (v) { return !v.isGnd; }).length + '</span></div>' +
          '<div><b>孔型：</b><span class="tag-badge info">通孔 ' + thruCount + ' | 盲孔 ' + blindCount + ' | 埋孔 ' + buriedCount + '</span></div>' +
          '<div><b>走线段：</b><span class="tag-badge ok">' + State.traces.length + ' 段</span></div>' +
          '<div><b>层数：</b><span class="tag-badge ok">' + State.layers.length + ' 层</span></div>' +
        '</div>' +
        '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--line);font-size:12px;color:var(--sub)">' +
          '<b>跨层定义：</b>' + uniqueSpans.map(function (s) { return '<code>' + escHtml(s) + '</code>'; }).join(' ') +
        '</div>';
    }

    computeBoundingBox();
  }

  function runCheck(sync) {
    if (!State.vias.length && !State.traces.length) {
      alert('请先导入或加载 PCB 坐标数据！');
      return;
    }

    var btn = $('btnRunCheck');
    var origBtnText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '计算中...';
    }
    if ($('runHint')) $('runHint').textContent = '正在执行空间网格索引与几何求距...';

    var doCheck = function () {
      var threshGnd = parseFloat($('inpThresholdGnd') ? $('inpThresholdGnd').value : 6.0) || 6.0;
      var threshSig = parseFloat($('inpThresholdSignal') ? $('inpThresholdSignal').value : 6.0) || 6.0;
      var mode = $('selMode').value;
      var gndPadDiam = parseFloat($('inpGndPadDiam') ? $('inpGndPadDiam').value : 7.906) || 7.906;
      var sigPadDiam = parseFloat($('inpSignalPadDiam') ? $('inpSignalPadDiam').value : 9.94) || 9.94;
      var gndFirstDrill = parseFloat($('inpGndFirstDrill') ? $('inpGndFirstDrill').value : 5.54) || 5.54;
      var sigFirstDrill = parseFloat($('inpSignalFirstDrill') ? $('inpSignalFirstDrill').value : 5.54) || 5.54;
      var threshPadPair = parseFloat($('inpThresholdPadPair') ? $('inpThresholdPadPair').value : 0);
      var diffNetOnly = $('selNetFilter').value === 'diff_only';
      var layerFilter = $('selLayerFilter') ? $('selLayerFilter').value : '';

      if (State.rawText) {
        var parsed = root.DfmCheck.parseDfmItems(State.rawText, Object.assign({
          gndPadDiameter: gndPadDiam,
          signalPadDiameter: sigPadDiam,
          gndFirstDrill: gndFirstDrill,
          signalFirstDrill: sigFirstDrill
        }, readPadShapes()));
        State.vias = parsed.vias;
        State.traces = parsed.traces;
      }

      HistoryManager.add('thresh_gnd', threshGnd);
      HistoryManager.add('thresh_sig', threshSig);
      HistoryManager.add('pad_gnd', gndPadDiam);
      HistoryManager.add('pad_sig', sigPadDiam);
      HistoryManager.add('drill_gnd', gndFirstDrill);
      HistoryManager.add('drill_sig', sigFirstDrill);
      if (!isNaN(threshPadPair)) HistoryManager.add('thresh_padpair', threshPadPair);
      HistoryManager.renderAll();

      var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      var result = root.DfmCheck.runDfmCheck(State.vias, State.traces, {
        minClearanceGnd: threshGnd,
        minClearanceSignal: threshSig,
        minClearance: threshGnd,
        mode: mode,
        diffNetOnly: diffNetOnly,
        layerFilter: layerFilter,
        gndPadDiameter: gndPadDiam,
        signalPadDiameter: sigPadDiam,
        gndFirstDrill: gndFirstDrill,
        signalFirstDrill: sigFirstDrill,
        minClearancePadPair: isNaN(threshPadPair) ? 0 : threshPadPair,
        layerRules: LayerRules.read().map(function (r) {
          return {
            layers: r.layers,
            minClearanceGnd: isFinite(r.gnd) ? r.gnd : undefined,
            minClearanceSignal: isFinite(r.sig) ? r.sig : undefined,
            minClearancePadPair: isFinite(r.pad) ? r.pad : undefined
          };
        })
      });
      var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      var duration = (t1 - t0).toFixed(0);

      State.checkResult = result;
      State.currentPage = 1;

      var skipNote = result.skippedNonSpanningPairs > 0
        ? (' · 已排除未穿层对偶 ' + result.skippedNonSpanningPairs.toLocaleString() + ' 处')
        : '';
      var unknownNote = result.undeterminedSpanPairs > 0
        ? (' · 另有 ' + result.undeterminedSpanPairs.toLocaleString() + ' 处对偶层名无法解析为层号，已按全部检查处理')
        : '';
      LayerRules.renderStats(result);
      var lrNote = (result.layerRuleStats && result.layerRuleStats.length)
        ? (' 分层规则 ' + result.layerRuleStats.length + ' 条：' + result.layerRuleStats.map(function (r) { return r.layers + ' 命中 ' + (r.checked + r.padPairChecked) + ' 处/超标 ' + (r.fail + r.padPairFail); }).join('，') + '。')
        : ' 未设分层规则，使用默认阈值。';
      var pp = result.padPairStats || { enabled: false, total: 0, fail: 0 };
      var ppNote = pp.enabled
        ? (' GND孔盘↔信号孔盘另查 ' + pp.total.toLocaleString() + ' 对，超标 ' + pp.fail + ' 对，阈值 ' + pp.threshold + ' mil。')
        : ' 孔盘到孔盘阈值填 0 未启用。';
      if ($('runHint')) {
        $('runHint').textContent = '检查完成 ' + duration + ' ms：共核对 ' + result.totalChecked.toLocaleString() + ' 处对偶' + skipNote +
          '，检出 ' + result.failCount + ' 处超标，' + result.passCount.toLocaleString() + ' 处合格。' + ppNote + lrNote + unknownNote;
      }

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origBtnText;
      }

      if (root.renderResults) root.renderResults();
      if (root.renderCanvas) root.renderCanvas();
      try { if (root.renderPatternAnalysis) root.renderPatternAnalysis(); } catch (e) {}
      if (root.EdaShell && typeof root.EdaShell.syncTelemetry === 'function') {
        root.EdaShell.syncTelemetry();
      }
    };

    if (sync || root.__SYNC_CHECK__) doCheck();
    else setTimeout(doCheck, 10);
  }

  function setGndThreshold(val) {
    if ($('inpThresholdGnd')) $('inpThresholdGnd').value = val;
    HistoryManager.renderBar('thresh_gnd');
    if (State.checkResult) runCheck();
  }

  function setSignalThreshold(val) {
    if ($('inpThresholdSignal')) $('inpThresholdSignal').value = val;
    HistoryManager.renderBar('thresh_sig');
    if (State.checkResult) runCheck();
  }

  function setThreshold(val) {
    if ($('inpThresholdGnd')) $('inpThresholdGnd').value = val;
    if ($('inpThresholdSignal')) $('inpThresholdSignal').value = val;
    HistoryManager.renderAll();
    if (State.checkResult) runCheck();
  }

  function bindConfigEvents() {
    ['inpThresholdGnd', 'inpThresholdSignal', 'inpThresholdPadPair', 'inpGndPadDiam', 'inpSignalPadDiam', 'inpGndFirstDrill', 'inpSignalFirstDrill'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', function () { HistoryManager.renderAll(); });
    });

    var savedRules = LayerRules.load();
    LayerRules.render(savedRules || []);
    var lrBody = $('layerRuleBody');
    if (lrBody) {
      lrBody.addEventListener('input', function (e) {
        var tr = e.target.closest('tr[data-row]');
        if (tr && e.target.classList.contains('lrLayers')) {
          var p = tr.querySelector('.lrPreview');
          if (p) p.textContent = LayerRules.previewOf(e.target.value);
        }
        LayerRules.syncHint();
        LayerRules.save();
      });
      lrBody.addEventListener('click', function (e) {
        if (!e.target.classList.contains('lrDel')) return;
        var tr = e.target.closest('tr[data-row]');
        var list = LayerRules.read();
        var idx = Array.prototype.slice.call(lrBody.querySelectorAll('tr[data-row]')).indexOf(tr);
        if (idx >= 0) list.splice(idx, 1);
        LayerRules.render(list);
        LayerRules.save();
        if (State.checkResult) runCheck(true);
      });
    }
    if ($('btnAddLayerRule')) $('btnAddLayerRule').addEventListener('click', function () { LayerRules.add(); });
    if ($('btnLayerRuleTemplate')) {
      $('btnLayerRuleTemplate').addEventListener('click', function () {
        LayerRules.render(LayerRules.defaults());
        LayerRules.save();
        if (State.checkResult) runCheck(true);
      });
    }

    if ($('btnSaveDfmRules')) $('btnSaveDfmRules').addEventListener('click', function () { DfmRuleConfig.saveToFile(); });
    if ($('btnLoadDfmRules')) $('btnLoadDfmRules').addEventListener('click', function () { $('fileDfmRules').click(); });
    if ($('fileDfmRules')) {
      $('fileDfmRules').addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try { DfmRuleConfig.loadFromObject(JSON.parse(String(reader.result || ''))); }
          catch (err) { alert('读取加工能力规则失败：' + err.message); }
          e.target.value = '';
        };
        reader.readAsText(file, 'utf-8');
      });
    }

    document.querySelectorAll('nav#tabs button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('nav#tabs button').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('main .tab').forEach(function (t) { t.classList.remove('active'); });
        btn.classList.add('active');
        var tabEl = $('tab-' + btn.dataset.tab);
        if (tabEl) tabEl.classList.add('active');
        if (btn.dataset.tab === 'canvas') setTimeout(function () { if (root.renderCanvas) root.renderCanvas(); }, 30);
        else if (btn.dataset.tab === 'analysis' && root.renderPatternAnalysis) root.renderPatternAnalysis();
        if (root.EdaShell && typeof root.EdaShell.syncStageBar === 'function') {
          root.EdaShell.syncStageBar();
          root.EdaShell.syncTelemetry();
        }
      });
    });

    var loadSampleNow = function (silent) {
      if (typeof root.fetch !== 'function') return;
      root.fetch('sample/via_trace_airgap_sample.txt')
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.text();
        })
        .then(function (txt) {
          loadTextData(txt, 'via_trace_airgap_sample.txt');
          runCheck();
        })
        .catch(function (err) {
          if (!silent) alert('加载示例文件失败：' + err.message);
        });
    };

    if ($('btnLoadSample')) {
      $('btnLoadSample').addEventListener('click', function () { loadSampleNow(false); });
    }

    if ($('btnClearData')) {
      $('btnClearData').addEventListener('click', function () {
        State.rawText = '';
        State.vias = [];
        State.traces = [];
        State.checkResult = null;
        State.measureSelection = [];
        State.measurements = [];
        if ($('fileStatus')) $('fileStatus').textContent = '已清空数据';
        if ($('dataSummaryCard')) $('dataSummaryCard').style.display = 'none';
        if ($('measureCard')) $('measureCard').style.display = 'none';
        if (root.renderResults) root.renderResults();
        if (root.renderCanvas) root.renderCanvas();
      });
    }

    var dropArea = $('dropArea');
    if (dropArea) {
      dropArea.addEventListener('click', function () { $('fileInput').click(); });
      dropArea.addEventListener('dragover', function (e) { e.preventDefault(); dropArea.classList.add('dragover'); });
      dropArea.addEventListener('dragleave', function () { dropArea.classList.remove('dragover'); });
      dropArea.addEventListener('drop', function (e) {
        e.preventDefault();
        dropArea.classList.remove('dragover');
        var file = e.dataTransfer && e.dataTransfer.files[0];
        if (file) readFile(file);
      });
    }
    if ($('fileInput')) {
      $('fileInput').addEventListener('change', function (e) {
        if (e.target.files && e.target.files[0]) readFile(e.target.files[0]);
      });
    }
    function readFile(file) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        loadTextData(ev.target.result, file.name);
        runCheck();
      };
      reader.readAsText(file);
    }

    if ($('btnRunCheck')) $('btnRunCheck').addEventListener('click', function () { runCheck(); });
    if ($('dockDfmRun')) $('dockDfmRun').addEventListener('click', function () { runCheck(); });
    if ($('dockDfmSample')) $('dockDfmSample').addEventListener('click', function () { loadSampleNow(false); });
    if ($('dockDfmCanvas')) {
      $('dockDfmCanvas').addEventListener('click', function () {
        var b = document.querySelector('nav#tabs button[data-tab="canvas"]');
        if (b) b.click();
      });
    }

    HistoryManager.renderAll();

    root.addEventListener('DOMContentLoaded', function () {
      if (!State.rawText) loadSampleNow(true);
    });
  }

  root.State = State;
  root.NET_COLORS = NET_COLORS;
  root.HistoryManager = HistoryManager;
  root.applyPresetScheme = applyPresetScheme;
  root.loadTextData = loadTextData;
  root.runCheck = runCheck;
  root.setGndThreshold = setGndThreshold;
  root.setSignalThreshold = setSignalThreshold;
  root.setThreshold = setThreshold;
  root.bindDfmConfigEvents = bindConfigEvents;
  root.DfmApp = {
    $: $,
    escHtml: escHtml,
    State: State,
    NET_COLORS: NET_COLORS,
    HistoryManager: HistoryManager,
    readPadShapes: readPadShapes,
    loadTextData: loadTextData,
    runCheck: runCheck
  };
})(typeof window !== "undefined" ? window : globalThis);
