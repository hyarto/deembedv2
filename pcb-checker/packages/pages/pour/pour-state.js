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

  /* ---------- 规则 1 / 2 / 3 列表与缩略图 ---------- */
  function renderAllRuleTables() {
    renderRule1Table();
    renderRule2Table();
    renderRule3Table();
  }

  function renderRule1Table() {
    var tbody = document.getElementById('tblRule1Body');
    var countEl = document.getElementById('lblR1Count');
    if (countEl) countEl.textContent = State.viaCoverageRules.length + ' 条规则';
    if (!tbody) return;

    tbody.innerHTML = State.viaCoverageRules.map(function (r, idx) {
      return '<tr>' +
        '<td><strong>#' + (idx + 1) + '</strong></td>' +
        '<td><span class="badge-tag copper">' + esc(r.padstack || '全部过孔') + '</span></td>' +
        '<td><span class="badge-tag gray">' + esc(String(r.layers)) + '</span></td>' +
        '<td><strong>' + esc(r.coverageRadius) + ' mil</strong></td>' +
        '<td><div class="row" style="gap:4px">' +
          '<button type="button" class="btn sec small" onclick="openEditRule1Modal(' + idx + ')">编辑</button>' +
          '<button type="button" class="btn bad small" onclick="deleteRule1(' + idx + ')">删除</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  function drawShapeThumb(canvasId) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var w = canvas.width;
    var h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(180, 83, 9, 0.4)';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function renderRule2Table() {
    var tbody = document.getElementById('tblRule2Body');
    var countEl = document.getElementById('lblR2Count');
    if (countEl) countEl.textContent = State.specialShapeTemplates.length + ' 条规则';
    if (!tbody) return;

    var PC = root.PourChecker;
    tbody.innerHTML = State.specialShapeTemplates.map(function (t, idx) {
      var areaNum = PC && PC.roundN ? PC.roundN(t.expectedArea, 1) : Number(t.expectedArea || 0).toFixed(1);
      return '<tr>' +
        '<td><strong>#' + (idx + 1) + '</strong></td>' +
        '<td><div style="width:48px;height:48px;background:#0b1220;border-radius:4px;overflow:hidden">' +
          '<canvas id="r2Thumb_' + idx + '" width="48" height="48"></canvas>' +
        '</div></td>' +
        '<td><strong>' + esc(t.name) + '</strong></td>' +
        '<td><span class="badge-tag copper">' + esc(t.padstack) + '</span></td>' +
        '<td><span class="badge-tag gray">' + esc(t.layer) + '</span></td>' +
        '<td><strong>' + esc(areaNum) + ' sq mil</strong> ±' + esc(t.areaTolerance) + '</td>' +
        '<td><div class="row" style="gap:4px">' +
          '<button type="button" class="btn sec small" onclick="openEditRule2Modal(' + idx + ')">编辑</button>' +
          '<button type="button" class="btn bad small" onclick="deleteRule2(' + idx + ')">删除</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');

    safeRAF(function () {
      State.specialShapeTemplates.forEach(function (_, idx) {
        drawShapeThumb('r2Thumb_' + idx);
      });
    });
  }

  function renderRule3Table() {
    var tbody = document.getElementById('tblRule3Body');
    var countEl = document.getElementById('lblR3Count');
    if (countEl) countEl.textContent = State.traceMarginRules.length + ' 条规则';
    if (!tbody) return;

    tbody.innerHTML = State.traceMarginRules.map(function (r, idx) {
      return '<tr>' +
        '<td><strong>#' + (idx + 1) + '</strong></td>' +
        '<td><span class="badge-tag copper">' + esc(r.traceLayer) + '</span></td>' +
        '<td><span class="badge-tag gray">' + esc(r.upperRefLayer || '-') + '</span></td>' +
        '<td><span class="badge-tag gray">' + esc(r.lowerRefLayer || '-') + '</span></td>' +
        '<td><strong>' + esc(r.minMargin) + ' mil</strong></td>' +
        '<td><div class="row" style="gap:4px">' +
          '<button type="button" class="btn sec small" onclick="openEditRule3Modal(' + idx + ')">编辑</button>' +
          '<button type="button" class="btn bad small" onclick="deleteRule3(' + idx + ')">删除</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  /* ---------- 规则弹窗 CRUD ---------- */
  function openModal(id) {
    var m = document.getElementById(id);
    if (m) m.classList.add('open');
  }

  function closeModal(id) {
    var m = document.getElementById(id);
    if (m) m.classList.remove('open');
  }

  function openAddRule1Modal() {
    State.editingIndex = -1;
    document.getElementById('modalR1Title').textContent = '新增孔铺铜覆盖规则';
    document.getElementById('modalR1InpPadstack').value = 'HDI_045drill_ring3_1_4';
    document.getElementById('modalR1InpLayers').value = 'L1-L5';
    document.getElementById('modalR1InpDist').value = '50.0';
    renderHistoryChips();
    openModal('modalRule1');
  }

  function openEditRule1Modal(idx) {
    State.editingIndex = idx;
    var r = State.viaCoverageRules[idx];
    if (!r) return;
    document.getElementById('modalR1Title').textContent = '编辑孔铺铜覆盖规则 #' + (idx + 1);
    document.getElementById('modalR1InpPadstack').value = r.padstack;
    document.getElementById('modalR1InpLayers').value = String(r.layers);
    document.getElementById('modalR1InpDist').value = r.coverageRadius;
    renderHistoryChips();
    openModal('modalRule1');
  }

  function saveRule1FromModal() {
    var pad = document.getElementById('modalR1InpPadstack').value.trim();
    var layers = document.getElementById('modalR1InpLayers').value.trim();
    var dist = parseFloat(document.getElementById('modalR1InpDist').value) || 50.0;

    recordHistory('r1_padstack', pad);
    recordHistory('r1_layers', layers);
    recordHistory('r1_dist', String(dist));

    var newRule = { id: 'cov_' + Date.now(), padstack: pad, layers: layers, coverageRadius: dist };
    if (State.editingIndex >= 0) {
      State.viaCoverageRules[State.editingIndex] = newRule;
    } else {
      State.viaCoverageRules.push(newRule);
    }
    renderRule1Table();
    closeModal('modalRule1');
  }

  function deleteRule1(idx) {
    State.viaCoverageRules.splice(idx, 1);
    renderRule1Table();
  }

  function setRule2InputsLocked(locked) {
    ['modalR2InpPadstack', 'modalR2InpLayer', 'modalR2TxtShape'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.disabled = !!locked;
      el.style.background = locked ? '#f8fafc' : '#ffffff';
    });
  }

  function openAddRule2Modal() {
    State.editingIndex = -1;
    document.getElementById('modalR2Title').textContent = '新增特定异型铜皮模板';
    setRule2InputsLocked(false);
    document.getElementById('modalR2InpName').value = 'L2特定异型铜皮_' + (State.specialShapeTemplates.length + 1);
    document.getElementById('modalR2InpPadstack').value = 'BGA_3510';
    document.getElementById('modalR2InpLayer').value = '02G01P';
    document.getElementById('modalR2InpTol').value = '30.0';
    document.getElementById('modalR2TxtShape').value =
      'Item 2  < Shape >\n  Subset: 02G01P\n  Area: 452.38934  (sq mil)\nExterior Boundary:\n  Arc seg: xy [23274.13, 27990.27]  xy [23274.13, 27990.27]\n    Center-xy: [23286.13, 27990.27] Radius (12.0000) CCW';
    previewModalShape();
    renderHistoryChips();
    openModal('modalRule2');
  }

  function openEditRule2Modal(idx) {
    State.editingIndex = idx;
    var t = State.specialShapeTemplates[idx];
    if (!t) return;
    document.getElementById('modalR2Title').textContent = '编辑特定异型铜皮模板';
    setRule2InputsLocked(true);
    document.getElementById('modalR2InpName').value = t.name;
    document.getElementById('modalR2InpPadstack').value = t.padstack;
    document.getElementById('modalR2InpLayer').value = t.layer;
    document.getElementById('modalR2InpTol').value = t.areaTolerance;
    document.getElementById('modalR2TxtShape').value = t.rawShapeText || ('Item 1  < Shape >\n  Subset: ' + t.layer + '\n  Area: ' + t.expectedArea + ' (sq mil)');
    previewModalShape();
    renderHistoryChips();
    openModal('modalRule2');
  }

  function drawModalShapeCanvas(shape) {
    var canvas = document.getElementById('modalR2Canvas');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var w = canvas.width;
    var h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, w, h);

    var span = Math.max(shape.bbox.spanX, shape.bbox.spanY, 10);
    var scale = (w * 0.75) / span;
    var cx = w / 2;
    var cy = h / 2;

    ctx.fillStyle = 'rgba(180, 83, 9, 0.35)';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    shape.boundary.forEach(function (seg) {
      if (seg.type === 'line') {
        ctx.moveTo(cx + (seg.x1 - shape.centroid.x) * scale, cy - (seg.y1 - shape.centroid.y) * scale);
        ctx.lineTo(cx + (seg.x2 - shape.centroid.x) * scale, cy - (seg.y2 - shape.centroid.y) * scale);
      } else if (seg.type === 'arc') {
        ctx.arc(cx + (seg.cx - shape.centroid.x) * scale, cy - (seg.cy - shape.centroid.y) * scale, seg.radius * scale, 0, Math.PI * 2);
      }
    });
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function previewModalShape() {
    var PC = root.PourChecker;
    if (!PC || !PC.parsePcbElements) return;
    var txt = document.getElementById('modalR2TxtShape').value;
    var parsed = PC.parsePcbElements(txt);
    var title = document.getElementById('modalR2PreviewTitle');
    var desc = document.getElementById('modalR2PreviewDesc');

    if (parsed.shapes.length > 0) {
      var s = parsed.shapes[0];
      State.modalShapeParsed = s;
      var lineCnt = s.boundary.filter(function (b) { return b.type === 'line'; }).length;
      title.textContent = '已解析 Shape 几何 · 层 ' + s.layer;
      desc.innerHTML =
        '<div>实测面积: <strong>' + PC.roundN(s.area, 2) + ' sq mil</strong> · ' + PC.roundN(s.areaMm2, 4) + ' mm²</div>' +
        '<div>边界段数: ' + s.boundary.length + ' 段 · 直线 ' + lineCnt + ' / 圆弧 ' + s.arcs.length + '</div>';
      drawModalShapeCanvas(s);
    } else {
      State.modalShapeParsed = null;
      title.textContent = '未识别到有效 Shape 块';
      desc.textContent = '请粘贴包含 < Shape > 与 Area 字段的 EDA 报告片段。';
    }
  }

  function saveRule2FromModal() {
    var name = document.getElementById('modalR2InpName').value.trim();
    var pad = document.getElementById('modalR2InpPadstack').value.trim();
    var layer = document.getElementById('modalR2InpLayer').value.trim();
    var tol = parseFloat(document.getElementById('modalR2InpTol').value) || 30.0;
    var rawTxt = document.getElementById('modalR2TxtShape').value;

    recordHistory('r2_name', name);
    recordHistory('r2_padstack', pad);
    recordHistory('r2_layer', layer);
    recordHistory('r2_tol', String(tol));

    var expectedArea = 452.38;
    if (State.modalShapeParsed && State.modalShapeParsed.area > 0) {
      expectedArea = State.modalShapeParsed.area;
    }

    var newTmpl = {
      id: 'tmpl_' + Date.now(),
      name: name,
      padstack: pad,
      layer: layer,
      expectedArea: expectedArea,
      areaTolerance: tol,
      rawShapeText: rawTxt,
      shape: State.modalShapeParsed
    };

    if (State.editingIndex >= 0) {
      State.specialShapeTemplates[State.editingIndex] = newTmpl;
    } else {
      State.specialShapeTemplates.push(newTmpl);
    }

    renderRule2Table();
    closeModal('modalRule2');
  }

  function deleteRule2(idx) {
    State.specialShapeTemplates.splice(idx, 1);
    renderRule2Table();
  }

  function openAddRule3Modal() {
    State.editingIndex = -1;
    document.getElementById('modalR3Title').textContent = '新增走线参考层超宽规则';
    document.getElementById('modalR3InpTraceLayer').value = '19IS08';
    document.getElementById('modalR3InpUpperRef').value = '08IS03';
    document.getElementById('modalR3InpLowerRef').value = 'Bottom';
    document.getElementById('modalR3InpMargin').value = '50.0';
    renderHistoryChips();
    openModal('modalRule3');
  }

  function openEditRule3Modal(idx) {
    State.editingIndex = idx;
    var r = State.traceMarginRules[idx];
    if (!r) return;
    document.getElementById('modalR3Title').textContent = '编辑走线参考层规则 #' + (idx + 1);
    document.getElementById('modalR3InpTraceLayer').value = r.traceLayer;
    document.getElementById('modalR3InpUpperRef').value = r.upperRefLayer || '';
    document.getElementById('modalR3InpLowerRef').value = r.lowerRefLayer || '';
    document.getElementById('modalR3InpMargin').value = r.minMargin;
    renderHistoryChips();
    openModal('modalRule3');
  }

  function saveRule3FromModal() {
    var traceL = document.getElementById('modalR3InpTraceLayer').value.trim();
    var upper = document.getElementById('modalR3InpUpperRef').value.trim();
    var lower = document.getElementById('modalR3InpLowerRef').value.trim();
    var margin = parseFloat(document.getElementById('modalR3InpMargin').value) || 50.0;

    recordHistory('r3_tracelayer', traceL);
    recordHistory('r3_upperref', upper);
    recordHistory('r3_lowerref', lower);
    recordHistory('r3_margin', String(margin));

    var newRule = {
      id: 'margin_' + Date.now(),
      traceLayer: traceL,
      upperRefLayer: upper,
      lowerRefLayer: lower,
      minMargin: margin
    };

    if (State.editingIndex >= 0) {
      State.traceMarginRules[State.editingIndex] = newRule;
    } else {
      State.traceMarginRules.push(newRule);
    }

    renderRule3Table();
    closeModal('modalRule3');
  }

  function deleteRule3(idx) {
    State.traceMarginRules.splice(idx, 1);
    renderRule3Table();
  }

  /* ---------- 本地 JSON 规则快照读写 ---------- */
  function getRulesSnapshot() {
    var inp4 = document.getElementById('rule4InpArea');
    var inp5 = document.getElementById('rule5InpRadius');
    State.smallCopperAreaThreshold = inp4 ? (parseFloat(inp4.value) || 500.0) : 500.0;
    State.minArcRadius = inp5 ? (parseFloat(inp5.value) || 10.0) : 10.0;

    return {
      version: '1.0',
      tool: 'pcb_pour_checker',
      exportTime: new Date().toLocaleString(),
      viaCoverageRules: JSON.parse(JSON.stringify(State.viaCoverageRules)),
      specialShapeTemplates: JSON.parse(JSON.stringify(State.specialShapeTemplates)),
      traceMarginRules: JSON.parse(JSON.stringify(State.traceMarginRules)),
      smallCopperAreaThreshold: State.smallCopperAreaThreshold,
      minArcRadius: State.minArcRadius,
      history: JSON.parse(JSON.stringify(State.history))
    };
  }

  function exportRulesToLocalFile() {
    var snapshot = getRulesSnapshot();
    var jsonText = JSON.stringify(snapshot, null, 2);
    try {
      localStorage.setItem('pcb_pour_saved_rules', JSON.stringify(snapshot));
    } catch (e) {}

    var counts = snapshot.viaCoverageRules.length + ' 条孔铺铜规则、' +
      snapshot.specialShapeTemplates.length + ' 条异型模板、' +
      snapshot.traceMarginRules.length + ' 条走线参考层规则';

    var statusEl = document.getElementById('lblRuleFileStatus');
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.textContent = '已生成规则快照：' + counts + '。';
    }

    root.showExportBox('铜皮检查规则约束.json', jsonText, '包含 ' + counts + '。', 'application/json');
  }

  function applyRuleSnapshot(data, saveToStorage) {
    if (!data || typeof data !== 'object') return;
    if (saveToStorage === undefined) saveToStorage = true;

    if (Array.isArray(data.viaCoverageRules)) {
      State.viaCoverageRules = data.viaCoverageRules;
    }
    if (Array.isArray(data.specialShapeTemplates)) {
      State.specialShapeTemplates = data.specialShapeTemplates;
      State.specialShapeTemplates.forEach(function (t) {
        if (t.rawShapeText && !t.shape && root.PourChecker && root.PourChecker.parsePcbElements) {
          try {
            var parsed = root.PourChecker.parsePcbElements(t.rawShapeText);
            if (parsed.shapes.length > 0) t.shape = parsed.shapes[0];
          } catch (e) {}
        }
      });
    }
    if (Array.isArray(data.traceMarginRules)) {
      State.traceMarginRules = data.traceMarginRules;
    }
    if (typeof data.smallCopperAreaThreshold === 'number') {
      State.smallCopperAreaThreshold = data.smallCopperAreaThreshold;
      var inp4 = document.getElementById('rule4InpArea');
      if (inp4) inp4.value = String(State.smallCopperAreaThreshold);
    }
    if (typeof data.minArcRadius === 'number') {
      State.minArcRadius = data.minArcRadius;
      var inp5 = document.getElementById('rule5InpRadius');
      if (inp5) inp5.value = String(State.minArcRadius);
    }
    if (data.history && typeof data.history === 'object') {
      State.history = Object.assign(State.history, data.history);
    }

    renderAllRuleTables();
    renderHistoryChips();

    if (saveToStorage) {
      try {
        localStorage.setItem('pcb_pour_saved_rules', JSON.stringify(data));
        localStorage.setItem('pcb_pour_unified_history', JSON.stringify(State.history));
      } catch (e) {}
    }
  }

  function importRulesFromLocalFile(event) {
    var file = event && event.target && event.target.files && event.target.files[0];
    if (!file) return;

    var reader = new root.FileReader();
    reader.onload = function (e) {
      try {
        var raw = String(e.target.result || '').replace(/^\uFEFF/, '').trim();
        var data = JSON.parse(raw);
        applyRuleSnapshot(data, true);
        var statusEl = document.getElementById('lblRuleFileStatus');
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.textContent = '已从「' + file.name + '」载入 ' +
            State.viaCoverageRules.length + ' 条孔铺铜规则、' +
            State.specialShapeTemplates.length + ' 条异型模板、' +
            State.traceMarginRules.length + ' 条走线超宽规则。';
        }
        event.target.value = '';
      } catch (err) {
        root.alert('规则 JSON 解析失败：' + (err && err.message ? err.message : '格式错误'));
      }
    };
    reader.onerror = function () {
      root.alert('无法读取选中的本地文件');
    };
    reader.readAsText(file, 'utf-8');
  }

  function loadSavedRules() {
    try {
      var raw = localStorage.getItem('pcb_pour_saved_rules');
      if (raw) {
        applyRuleSnapshot(JSON.parse(raw), false);
      }
    } catch (e) {}
  }

  function resetToDefaultRules() {
    var ok = true;
    try { ok = root.confirm('恢复内置默认规则配置？当前修改将被覆盖。'); } catch (e) { ok = true; }
    if (!ok) return;

    State.viaCoverageRules = [
      { id: 'cov_1', padstack: 'HDI_045drill_ring3_1_4', layers: 'L1-L5', coverageRadius: 50.0 },
      { id: 'cov_2', padstack: 'BGA_GND_pad1mil_0902', layers: '02G01P, 19IS08', coverageRadius: 30.0 }
    ];
    State.specialShapeTemplates = [
      { id: 'tmpl_1', name: 'L2特定异型泪滴铜皮', padstack: 'BGA_3510', layer: '02G01P', expectedArea: 452.38, areaTolerance: 30.0, rawShapeText: '' },
      { id: 'tmpl_2', name: 'L19特定异型铜皮', padstack: 'BGA_3510', layer: '19IS08', expectedArea: 113.10, areaTolerance: 20.0, rawShapeText: '' }
    ];
    State.traceMarginRules = [
      { id: 'margin_1', traceLayer: '19IS08', upperRefLayer: '08IS03', lowerRefLayer: 'Bottom', minMargin: 50.0 },
      { id: 'margin_2', traceLayer: '08IS03', upperRefLayer: '02G01P', lowerRefLayer: '19IS08', minMargin: 40.0 }
    ];
    State.smallCopperAreaThreshold = 500.0;
    State.minArcRadius = 10.0;

    var inp4 = document.getElementById('rule4InpArea');
    var inp5 = document.getElementById('rule5InpRadius');
    if (inp4) inp4.value = '500.0';
    if (inp5) inp5.value = '10.0';

    try { localStorage.removeItem('pcb_pour_saved_rules'); } catch (e) {}

    renderAllRuleTables();
    renderHistoryChips();

    var statusEl = document.getElementById('lblRuleFileStatus');
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.textContent = '已恢复默认规则配置。';
    }
  }

  function saveRulesAndJump() {
    State.smallCopperAreaThreshold = parseFloat(document.getElementById('rule4InpArea').value) || 500.0;
    State.minArcRadius = parseFloat(document.getElementById('rule5InpRadius').value) || 10.0;
    recordHistory('r4_area', String(State.smallCopperAreaThreshold));
    recordHistory('r5_radius', String(State.minArcRadius));
    switchTab('tabImport');
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
  root.renderHistoryChips = renderHistoryChips;
  root.fillInputAndRecord = fillInputAndRecord;
  root.renderAllRuleTables = renderAllRuleTables;
  root.renderRule1Table = renderRule1Table;
  root.renderRule2Table = renderRule2Table;
  root.renderRule3Table = renderRule3Table;
  root.openModal = openModal;
  root.closeModal = closeModal;
  root.openAddRule1Modal = openAddRule1Modal;
  root.openEditRule1Modal = openEditRule1Modal;
  root.saveRule1FromModal = saveRule1FromModal;
  root.deleteRule1 = deleteRule1;
  root.openAddRule2Modal = openAddRule2Modal;
  root.openEditRule2Modal = openEditRule2Modal;
  root.previewModalShape = previewModalShape;
  root.saveRule2FromModal = saveRule2FromModal;
  root.deleteRule2 = deleteRule2;
  root.openAddRule3Modal = openAddRule3Modal;
  root.openEditRule3Modal = openEditRule3Modal;
  root.saveRule3FromModal = saveRule3FromModal;
  root.deleteRule3 = deleteRule3;
  root.getRulesSnapshot = getRulesSnapshot;
  root.exportRulesToLocalFile = exportRulesToLocalFile;
  root.importRulesFromLocalFile = importRulesFromLocalFile;
  root.applyRuleSnapshot = applyRuleSnapshot;
  root.resetToDefaultRules = resetToDefaultRules;
  root.saveRulesAndJump = saveRulesAndJump;
  root.handleFileUpload = handleFileUpload;
  root.loadSampleShapes = loadSampleShapes;
  root.executeCopperChecks = executeCopperChecks;
  root.showExportBox = showExportBox;
  root.copyExportContent = copyExportContent;
})(typeof window !== 'undefined' ? window : globalThis);
