/* ============================================================================
 * trace-diff-ui.js —— 走线检查模块：⑤ 差分线长差分析、CSV/XLSX 汇总报告导出与事件绑定
 * ========================================================================== */
(function (root) {
  "use strict";

  var App = root.TraceApp;
  var S = App.S;
  var $ = App.$;
  var TE = root.TraceEngine;
  var esc = TE.esc;
  var fmt = TE.fmt;

  var checkOpts = function () { return App.checkOpts(); };
  var recStatus = function (r) { return App.recStatus(r); };
  var currentFiltered = function () { return App.currentFiltered(); };
  var runCheck = function () { return App.runCheck(); };
  var updateTraceRevHint = function () { return App.updateTraceRevHint(); };
  var updateDiffRevHint = function () { return App.updateDiffRevHint(); };
  var renderResults = function () { return App.renderResults(); };


  function currentSuffixPairs() {
    var list = [];
    document.querySelectorAll('.sfx').forEach(function (c) {
      if (c.checked) list.push({ pos: c.dataset.pos, neg: c.dataset.neg });
    });
    $('inpSfx').value.split(/[;；]/).forEach(function (part) {
      var p = part.split(/[,，]/);
      if (p.length === 2 && p[0].trim() && p[1].trim()) list.push({ pos: p[0].trim(), neg: p[1].trim() });
    });
    return list;
  }

  function manualPairList() {
    var out = [];
    $('manualPairs').value.split(/\r?\n/).forEach(function (line) {
      var p = line.split(/[,，\t]/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (p.length >= 2) out.push({ base: p[0] + ' / ' + p[1], pos: p[0], neg: p[1], manual: true });
    });
    return out;
  }

  function diffComputed() {
    return S.diffPairs.map(function (p) {
      var d = TE.computePairDiff(p, S.netLens, {
        layerTol: S.diffTol,
        totalTol: S.totalDiffTol,
        checkLayer: S.checkLayerDiff !== false,
        checkTotal: S.checkTotalDiff !== false
      });
      return { pair: p, d: d, exceed: d.exceed, maxLayerDiff: d.maxLayerDiff, totalDiff: d.totalDiff };
    });
  }

  function runDiff() {
    if (!S.records.length) {
      alert('请先导入数据');
      App.switchTab('import');
      return;
    }
    S.diffTol = parseFloat($('inpDiffTol').value);
    if (isNaN(S.diffTol)) S.diffTol = 1;
    var totVal = $('inpTotalDiffTol') ? parseFloat($('inpTotalDiffTol').value) : NaN;
    S.totalDiffTol = isNaN(totVal) ? S.diffTol : totVal;
    S.checkLayerDiff = $('chkCheckLayerDiff') ? $('chkCheckLayerDiff').checked : true;
    S.checkTotalDiff = $('chkCheckTotalDiff') ? $('chkCheckTotalDiff').checked : true;
    var manual = manualPairList();
    var used = new Set();
    manual.forEach(function (p) { used.add(p.pos); used.add(p.neg); });
    var nets = Array.from(S.netLens.keys()).filter(function (n) { return !used.has(n); });
    var auto = TE.detectPairs(nets, currentSuffixPairs());
    S.diffInfo = auto;
    S.diffPairs = manual.concat(auto.pairs);
    S.diffDone = true;
    renderDiff();
  }

  function renderDiff() {
    if (!S.diffDone) return;
    var all = diffComputed();
    var fail = all.filter(function (x) { return x.exceed; });
    var failLayer = all.filter(function (x) { return x.d.layerExceed; });
    var failTotal = all.filter(function (x) { return x.d.totalExceed; });
    var mism = all.filter(function (x) { return x.d.setMismatch; });

    $('diffCards').innerHTML =
      '<div class="stat"><div class="v">' + all.length + '</div><div class="t">差分对数</div></div>' +
      '<div class="stat bad"><div class="v">' + fail.length + '</div><div class="t">超差对数</div></div>' +
      '<div class="stat bad" data-tip="判定阈值 > ' + fmt(S.diffTol) + ' ' + esc(S.unit) + '"><div class="v">' + failLayer.length + '</div><div class="t">逐层超差对数</div></div>' +
      '<div class="stat bad" data-tip="判定阈值 > ' + fmt(S.totalDiffTol) + ' ' + esc(S.unit) + '"><div class="v">' + failTotal.length + '</div><div class="t">总长超差对数</div></div>' +
      '<div class="stat warn"><div class="v">' + mism.length + '</div><div class="t">P/N 层分布不一致</div></div>';

    var onlyFail = $('chkDiffOnlyFail').checked;
    var h =
      '<thead><tr>' +
      '<th>差分对</th><th>P 网络</th><th>N 网络</th><th>层 / 检查项目</th>' +
      '<th>P 线长</th><th>N 线长</th><th>差值 · ' + esc(S.unit) + '</th><th>允许值 · ' + esc(S.unit) + '</th><th>判定</th>' +
      '</tr></thead><tbody>';

    var shown = 0;
    all.forEach(function (x) {
      if (onlyFail && !x.exceed) return;
      shown++;
      var rs = x.d.rows.length + 1;
      var badges = [];
      if (x.pair.manual) badges.push('<span class="badge na">手动</span>');
      if (x.d.setMismatch) badges.push('<span class="badge warn">层不一致</span>');
      if (x.d.layerExceed && S.checkLayerDiff) badges.push('<span class="badge bad">逐层超差</span>');
      if (x.d.totalExceed && S.checkTotalDiff) badges.push('<span class="badge bad">总长超差</span>');
      var bHtml = badges.length ? ('<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px">' + badges.join('') + '</div>') : '';
      var head =
        '<td rowspan="' + rs + '"><b>' + esc(x.pair.base) + '</b>' + bHtml + '</td>' +
        '<td rowspan="' + rs + '" class="mono">' + esc(x.pair.pos) + '</td>' +
        '<td rowspan="' + rs + '" class="mono">' + esc(x.pair.neg) + '</td>';

      x.d.rows.forEach(function (r, i) {
        var bad = r.exceed;
        var rowKey = x.pair.base + '__' + x.pair.pos + '__' + x.pair.neg + '__' + r.layer;
        var isRev = bad && S.diffReviewed && S.diffReviewed.has(rowKey);
        var statusBadge = S.checkLayerDiff
          ? (bad ? '<span class="badge bad">逐层超差</span>' : '<span class="badge ok">OK</span>')
          : '<span class="badge na">未检查</span>';
        var chkBoxHtml = bad
          ? '<label class="rev-chk-wrap" data-tip="勾选复验后该行置灰"><input type="checkbox" class="chk-diff-rev" data-k="' + esc(rowKey) + '"' + (isRev ? ' checked' : '') + '> 复验</label>'
          : '';
        h +=
          '<tr class="' + (i === 0 ? 'pairhead ' : '') + (bad ? 'fail ' : '') + (isRev ? 'reviewed ' : '') + '">' +
          (i === 0 ? head : '') +
          '<td>' + esc(r.layer) + '</td>' +
          '<td class="mono">' + fmt(r.lenP) + '</td>' +
          '<td class="mono">' + fmt(r.lenN) + '</td>' +
          '<td class="mono ' + (bad ? 'badcell' : '') + '">' + fmt(r.diff) + '</td>' +
          '<td class="mono hint">≤ ' + fmt(r.tol) + '</td>' +
          '<td>' + chkBoxHtml + statusBadge + (r.note ? ' <span class="badge warn">' + esc(r.note) + '</span>' : '') + '</td>' +
          '</tr>';
      });

      var tb = x.d.total.exceed;
      var totalKey = x.pair.base + '__' + x.pair.pos + '__' + x.pair.neg + '__total';
      var isTotalRev = tb && S.diffReviewed && S.diffReviewed.has(totalKey);
      var totalStatusBadge = S.checkTotalDiff
        ? (tb ? '<span class="badge bad">总长超差</span>' : '<span class="badge ok">总长 OK</span>')
        : '<span class="badge na">未检查</span>';
      var totalChkBoxHtml = tb
        ? '<label class="rev-chk-wrap" data-tip="勾选复验后该行置灰"><input type="checkbox" class="chk-diff-rev" data-k="' + esc(totalKey) + '"' + (isTotalRev ? ' checked' : '') + '> 复验</label>'
        : '';
      h +=
        '<tr class="totalrow' + (tb ? ' fail' : '') + (isTotalRev ? ' reviewed' : '') + '">' +
        '<td><b data-tip="跨所有走线层的总长差值">总线长差 · 所有层合计</b></td>' +
        '<td class="mono" style="font-weight:700">' + fmt(x.d.total.lenP) + '</td>' +
        '<td class="mono" style="font-weight:700">' + fmt(x.d.total.lenN) + '</td>' +
        '<td class="mono ' + (tb ? 'badcell' : '') + '" style="font-weight:700">' + fmt(x.d.total.diff) + '</td>' +
        '<td class="mono hint">≤ ' + fmt(x.d.total.tol) + '</td>' +
        '<td>' + totalChkBoxHtml + totalStatusBadge + '</td>' +
        '</tr>';
    });
    if (!shown) h += '<tr><td colspan="9" class="kv">无符合条件的差分对</td></tr>';
    $('diffTbl').innerHTML = h + '</tbody>';
    updateDiffRevHint();
  }

  function exportUnifiedReportExcel() {
    if (!S.records.length) { alert('请先导入并应用数据'); App.switchTab('import'); return; }
    if (!S.checkRes) { alert('请先运行检查'); return; }

    var diffItems = [];
    try {
      if (S.diffDone) {
        diffItems = diffComputed();
      } else {
        var manual = manualPairList();
        var used = new Set();
        manual.forEach(function (p) { used.add(p.pos); used.add(p.neg); });
        var nets = Array.from(S.netLens.keys()).filter(function (n) { return !used.has(n); });
        var auto = TE.detectPairs(nets, currentSuffixPairs());
        var allPairs = manual.concat(auto.pairs);
        var diffTol = parseFloat($('inpDiffTol') ? $('inpDiffTol').value : '1') || 1;
        var totTol = parseFloat($('inpTotalDiffTol') ? $('inpTotalDiffTol').value : '1') || diffTol;
        var chkL = $('chkCheckLayerDiff') ? $('chkCheckLayerDiff').checked : true;
        var chkT = $('chkCheckTotalDiff') ? $('chkCheckTotalDiff').checked : true;
        diffItems = allPairs.map(function (p) {
          return {
            pair: p,
            d: TE.computePairDiff(p, S.netLens, { layerTol: diffTol, totalTol: totTol, checkLayer: chkL, checkTotal: chkT })
          };
        });
      }
    } catch (e) {}

    var rep = TE.generateUnifiedReportData(
      S.records,
      S.checkRes,
      S.rules,
      S.defaultRule,
      { tol: S.tol, checkWidth: S.checkWidth, checkLen: S.checkLen, checkWidthLen: S.checkWidthLen, checkRad: S.checkRad },
      S.traceReviewed,
      diffItems,
      S.netLens,
      { layerTol: S.diffTol || 1, totalTol: S.totalDiffTol || 1, checkLayer: S.checkLayerDiff !== false, checkTotal: S.checkTotalDiff !== false },
      S.diffReviewed
    );

    var xlsxBuf = TE.generateXLSX([{
      name: '走线检查汇总报告',
      headers: rep.headers,
      cols: rep.cols,
      rows: rep.rows
    }]);

    var filename = 'PCB走线检查汇总报告_问题网络与修改建议.xlsx';
    var hint = rep.problemCount > 0
      ? ('已生成 ' + rep.problemCount + ' 项问题网络与修改建议汇总报告。')
      : '全板走线及差分核对全部通过，已生成合格汇总报告。';
    App.showExportBox(filename, xlsxBuf, hint, rep.tsvText);
  }

  function exportTraceReportExcel() { exportUnifiedReportExcel(); }
  function exportDiffReportExcel() { exportUnifiedReportExcel(); }

  function exportAll() {
    if (!S.records.length) { alert('请先导入并应用数据'); App.switchTab('import'); return; }
    var rows = currentFiltered().map(function (x) {
      var wlStr = x.r.widthLens
        ? Array.from(x.r.widthLens.entries()).sort(function (a, b) { return a[0] - b[0]; }).map(function (kv) { return fmt(kv[0]) + ':' + fmt(kv[1]); }).join('; ')
        : '';
      var seqStr = TE.extractWidthSeq(x.r).map(fmt).join('->');
      return [
        x.r.item || x.r.line || '',
        x.r.net,
        x.r.layer,
        fmt(x.r.length),
        seqStr,
        wlStr,
        (x.r.radiiArr || []).map(fmt).join('/'),
        (x.r.segCount || 0) + '/' + (x.r.arcCount || 0),
        x.v.st === 'fail' ? '不符合' : x.v.st === 'pass' ? '通过' : '未检查',
        (x.v.reasons || []).join('；')
      ];
    });
    if (!rows.length) { alert('当前筛选下没有可导出的记录'); return; }
    App.download('走线检查_全部.csv', TE.toCSV(['Item', '网络', '层', '总线长', '线宽组合顺序', '指定线宽线长', '弧半径', '直/弧段', '判定', '原因'], rows));
  }

  function exportFail() {
    if (!S.checkRes) { alert('请先运行检查'); return; }
    var rows = [];
    S.records.forEach(function (r) {
      var v = S.checkRes.recViol.get(r.idx);
      if (!v) return;
      var reasons = Array.isArray(v) ? v : (v.reasons || []);
      var wlStr = r.widthLens
        ? Array.from(r.widthLens.entries()).sort(function (a, b) { return a[0] - b[0]; }).map(function (kv) { return fmt(kv[0]) + ':' + fmt(kv[1]); }).join('; ')
        : '';
      var seqStr = TE.extractWidthSeq(r).map(fmt).join('->');
      rows.push([
        r.item || r.line || '',
        r.net,
        r.layer,
        fmt(r.length),
        seqStr,
        wlStr,
        (r.radiiArr || []).map(fmt).join('/'),
        reasons.join('；')
      ]);
    });
    App.download('走线检查_不符合项.csv', TE.toCSV(['Item', '网络', '层', '总线长', '线宽组合顺序', '指定线宽线长', '弧半径', '不符合原因'], rows));
  }

  function exportDiff() {
    if (!S.diffDone) { alert('请先分析差分'); return; }
    var rows = [];
    diffComputed().forEach(function (x) {
      x.d.rows.forEach(function (r) {
        rows.push([
          x.pair.base, x.pair.pos, x.pair.neg, r.layer, fmt(r.lenP), fmt(r.lenN), fmt(r.diff), fmt(r.tol),
          S.checkLayerDiff ? (r.exceed ? '逐层超差' : 'OK') : '未检查',
          x.d.setMismatch ? '层不一致' : '', r.note
        ]);
      });
      rows.push([
        x.pair.base, x.pair.pos, x.pair.neg, '总线长差(所有层合计)', fmt(x.d.total.lenP), fmt(x.d.total.lenN), fmt(x.d.total.diff), fmt(x.d.total.tol),
        S.checkTotalDiff ? (x.d.total.exceed ? '总长超差' : 'OK') : '未检查',
        x.d.setMismatch ? '层不一致' : '', ''
      ]);
    });
    App.download('差分线长差分析.csv', TE.toCSV(['差分对', 'P网络', 'N网络', '层/检查项', 'P线长', 'N线长', '差值', '允许值', '判定', '层分布', '备注'], rows));
  }

  function guardClick(fn) {
    return function () {
      try { fn(); } catch (e) { alert('操作失败：' + (e && e.message ? e.message : e)); }
    };
  }

  function initTraceApp() {
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.onclick = function () { App.switchTab(b.dataset.tab); };
    });
    var dz = $('dropzone');
    dz.onclick = function () { $('fileInput').click(); };
    $('fileInput').onchange = function (e) { if (e.target.files[0]) App.loadFile(e.target.files[0]); };
    ['dragover', 'dragenter'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); });
    });
    dz.addEventListener('drop', function (e) {
      var f = e.dataTransfer.files[0];
      if (f) App.loadFile(f);
    });

    $('btnSample').onclick = function () {
      S.rawText = TE.SAMPLE_TEXT;
      S.fileName = '示例数据.txt';
      $('fileNameLabel').textContent = '已载入：内置示例数据';
      $('selUnit').value = 'mil';
      App.handleText();
      App.applyData();
      $('ruleRows').innerHTML = '';
      App.addRuleRow('02G01P', '5.6', 'range', '1000,2500', true);
      App.addRuleRow('02G03P', '4.0', 'off', '', true);
      $('defEnabled').checked = false;
      $('defCheckWidth').checked = true; $('defWidths').value = '';
      $('defCheckLen').checked = false; $('defLenMode').value = 'off'; $('defLengths').value = '';
      $('defCheckRad').checked = false; $('defRadMode').value = 'off'; $('defRadii').value = '';
      $('chkWidth').checked = true; $('chkLen').checked = true; $('chkRad').checked = true;
      $('inpTol').value = '0.001';
      $('inpDiffTol').value = '1';
    };

    $('btnParsePaste').onclick = function () {
      S.rawText = $('pasteBox').value;
      S.fileName = '粘贴文本';
      $('fileNameLabel').textContent = '来源：粘贴文本';
      App.handleText();
    };
    if ($('btnReparse')) $('btnReparse').onclick = function () { App.reparseTable(true); };

    $('chkWidth').onchange = function () {
      var val = this.checked;
      this.indeterminate = false;
      S.checkWidth = val;
      if ($('defCheckWidth')) $('defCheckWidth').checked = val;
      document.querySelectorAll('.rCW').forEach(function (el) { el.checked = val; });
    };
    $('chkLen').onchange = function () {
      var val = this.checked;
      this.indeterminate = false;
      S.checkLen = val;
      if ($('defCheckLen')) $('defCheckLen').checked = val;
      document.querySelectorAll('.rCL').forEach(function (el) { el.checked = val; });
    };
    if ($('chkWidthLen')) {
      $('chkWidthLen').onchange = function () {
        var val = this.checked;
        this.indeterminate = false;
        S.checkWidthLen = val;
        if ($('defCheckWidthLen')) $('defCheckWidthLen').checked = val;
        document.querySelectorAll('.rCWL').forEach(function (el) { el.checked = val; });
      };
    }
    $('chkRad').onchange = function () {
      var val = this.checked;
      this.indeterminate = false;
      S.checkRad = val;
      if ($('defCheckRad')) $('defCheckRad').checked = val;
      document.querySelectorAll('.rCR').forEach(function (el) { el.checked = val; });
    };

    $('btnAddRule').onclick = function () { App.addRuleRow('', '', 'off', '', true); App.syncMasterSwitches(); };
    $('btnFillLayers').onclick = function () { App.genLayerRules(); App.syncMasterSwitches(); };
    $('ruleRows').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var el = btn.closest('.rulegrid');
      if (btn.dataset.act === 'del') {
        el.remove();
        App.syncMasterSwitches();
      } else if (btn.dataset.act === 'fill') {
        App.fillFromData(btn);
      }
    });
    $('ruleRows').addEventListener('change', function (e) {
      if (e.target.matches('.rCW, .rCL, .rCWL, .rCR')) App.syncMasterSwitches();
    });
    ['defCheckWidth', 'defCheckLen', 'defCheckWidthLen', 'defCheckRad'].forEach(function (id) {
      var el = $(id);
      if (el) el.onchange = App.syncMasterSwitches;
    });

    $('btnSaveRules').onclick = guardClick(App.saveRulesFile);
    $('btnLoadRules').onclick = function () { $('ruleFile').click(); };
    $('ruleFile').onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) App.loadRulesFile(f);
    };
    $('btnRunCheck').onclick = runCheck;
    if ($('btnRunCheckBottom')) $('btnRunCheckBottom').onclick = runCheck;
    ['fltQ', 'fltLayer', 'fltStatus'].forEach(function (id) {
      var el = $(id);
      el.oninput = function () { S.page = 0; renderResults(); };
      el.onchange = el.oninput;
    });

    if ($('btnExpReport')) $('btnExpReport').onclick = guardClick(exportTraceReportExcel);
    $('btnExpAll').onclick = guardClick(exportAll);
    $('btnExpFail').onclick = guardClick(exportFail);
    $('btnDiffRun').onclick = runDiff;

    $('diffTbl').addEventListener('change', function (e) {
      var cb = e.target.closest('.chk-diff-rev');
      if (!cb) return;
      var k = cb.dataset.k;
      if (!S.diffReviewed) S.diffReviewed = new Set();
      if (cb.checked) S.diffReviewed.add(k); else S.diffReviewed.delete(k);
      var tr = cb.closest('tr');
      if (tr) tr.classList.toggle('reviewed', cb.checked);
      updateDiffRevHint();
    });

    $('tab-result').addEventListener('change', function (e) {
      var cb = e.target.closest('.chk-trace-rev');
      if (!cb) return;
      var k = cb.dataset.k;
      if (!S.traceReviewed) S.traceReviewed = new Set();
      if (cb.checked) S.traceReviewed.add(k); else S.traceReviewed.delete(k);
      var tr = cb.closest('tr');
      if (tr) tr.classList.toggle('reviewed', cb.checked);
      updateTraceRevHint();
    });

    if ($('btnClearDiffRev')) {
      $('btnClearDiffRev').onclick = function () {
        if (S.diffReviewed) S.diffReviewed.clear();
        renderDiff();
        updateDiffRevHint();
      };
    }
    if ($('btnClearTraceRev')) {
      $('btnClearTraceRev').onclick = function () {
        if (S.traceReviewed) S.traceReviewed.clear();
        renderResults();
        updateTraceRevHint();
      };
    }
    $('chkDiffOnlyFail').onchange = function () { renderDiff(); updateDiffRevHint(); };
    if ($('chkCheckLayerDiff')) {
      $('chkCheckLayerDiff').onchange = function () { S.checkLayerDiff = $('chkCheckLayerDiff').checked; renderDiff(); updateDiffRevHint(); };
    }
    if ($('chkCheckTotalDiff')) {
      $('chkCheckTotalDiff').onchange = function () { S.checkTotalDiff = $('chkCheckTotalDiff').checked; renderDiff(); updateDiffRevHint(); };
    }
    if ($('btnExpDiffReport')) $('btnExpDiffReport').onclick = guardClick(exportDiffReportExcel);
    $('btnExpDiff').onclick = guardClick(exportDiff);

    $('tab-result').addEventListener('click', function (e) {
      var th = e.target.closest('th[data-k]');
      if (th && e.target.closest('#resLayers')) {
        var k = th.dataset.k;
        if (S.sort.col === k) S.sort.dir *= -1;
        else { S.sort.col = k; S.sort.dir = 1; }
        renderResults();
        return;
      }
      var fb = e.target.closest('[data-filter]');
      if (fb) {
        var layer = fb.dataset.layer || '';
        var stEl = $('fltStatus'), lyEl = $('fltLayer');
        if (layer) {
          if (stEl.value === 'fail' && lyEl.value === layer) { stEl.value = ''; lyEl.value = ''; }
          else { stEl.value = 'fail'; lyEl.value = layer; }
        } else if (stEl.value === 'fail' && !lyEl.value) {
          stEl.value = '';
        } else {
          stEl.value = 'fail'; lyEl.value = '';
        }
        renderResults();
        return;
      }
      var jb = e.target.closest('[data-jump]');
      if (jb) {
        var target = document.getElementById('resLayer' + jb.dataset.jump);
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    // 右侧工具栏快捷按钮联动
    var bindDockClick = function (dockId, targetId) {
      var b = $(dockId);
      if (b) b.onclick = function () { var t = $(targetId); if (t) t.click(); };
    };
    bindDockClick('dockTraceSample', 'btnSample');
    bindDockClick('dockTraceRun', 'btnRunCheck');
    bindDockClick('dockTraceDiff', 'btnDiffRun');
    bindDockClick('dockTraceExport', 'btnExpReport');
  }

  root.runDiff = runDiff;
  root.exportUnifiedReportExcel = exportUnifiedReportExcel;
  root.exportTraceReportExcel = exportTraceReportExcel;
  root.exportDiffReportExcel = exportDiffReportExcel;

  Object.assign(App, {
    runDiff: runDiff,
    renderDiff: renderDiff,
    exportUnifiedReportExcel: exportUnifiedReportExcel,
    exportTraceReportExcel: exportTraceReportExcel,
    exportDiffReportExcel: exportDiffReportExcel,
    exportAll: exportAll,
    exportFail: exportFail,
    exportDiff: exportDiff
  });

  initTraceApp();
})(typeof window !== "undefined" ? window : globalThis);
