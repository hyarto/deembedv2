/* ============================================================================
 * pour-rules-ui.js —— 铜皮检查模块：规则 1/2/3 表格渲染、弹窗编辑、异型铜皮预览与 JSON 快照读写
 * ========================================================================== */
(function (root) {
  "use strict";

  var esc = root.escHtml || function (str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };
  var State = root.State;
  var safeRAF = root.PourSafeRAF || function (fn) { setTimeout(fn, 0); };
  var recordHistory = function (k, v) { if (root.recordHistory) root.recordHistory(k, v); };
  var renderHistoryChips = function () { if (root.renderHistoryChips) root.renderHistoryChips(); };
  var switchTab = function (id) { if (root.switchTab) root.switchTab(id); };
  var showExportBox = function (f, t, h, m) { if (root.showExportBox) root.showExportBox(f, t, h, m); };

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
  root.loadSavedRules = loadSavedRules;
  root.resetToDefaultRules = resetToDefaultRules;
  root.saveRulesAndJump = saveRulesAndJump;
})(typeof window !== "undefined" ? window : globalThis);
