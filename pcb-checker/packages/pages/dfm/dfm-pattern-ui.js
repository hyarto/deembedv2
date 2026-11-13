/* ============================================================================
 * dfm-pattern-ui.js —— DFM 加工能力检查模块：⑤ 规律分析与归纳 CSV 导出
 * ========================================================================== */
(function (root) {
  "use strict";

  var App = root.DfmApp;
  var $ = App.$;
  var escHtml = App.escHtml;
  var State = App.State;
  var renderResults = function () { if (root.renderResults) root.renderResults(); };

  var PatternState = {
    object: 'via',
    viaKind: 'all',
    dimension: 'layer',
    sortBy: 'failCount',
    topN: 10,
    last: null,
    defectMode: 'line',          // 'line' 线到孔 | 'pad' 孔到孔
    defectModeFilters: { line: {}, pad: {} }
  };

  function patDimTitleFor(dim, object) {
    if (dim === 'kind') return object === 'via' ? '按孔型分布' : '按走线分布';
    if (dim === 'width') return object === 'via' ? '按 Padstack 分布' : '按走线线宽分布';
    return '按' + root.DfmCheck.patDimLabel(dim) + '分布';
  }

  function patObjectTitle(object, viaKind) {
    if (object !== 'via') return '问题对象排行（按走线）';
    var kind = viaKind === 'signal' ? '信号孔' : (viaKind === 'gnd' ? 'GND 孔' : '过孔');
    return '问题对象排行（按' + kind + '）';
  }

  function patTableHead(object) {
    var cols = object === 'via'
      ? ['#', '对象', '网络', '孔型', 'Padstack', '缺陷处数', '占比', '最小间距 mil', '最大亏欠 mil', '操作']
      : ['#', '对象', '出线层', '网络', '线宽 mil', '缺陷处数', '占比', '最小间距 mil', '最大亏欠 mil', '操作'];
    return '<tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>';
  }

  function renderPatternAnalysis() {
    if (root.renderDfmDefectPatternAnalysis) root.renderDfmDefectPatternAnalysis();
    var res = State.checkResult;
    var hasResult = res && Array.isArray(res.defectPairs);
    var analysis = root.DfmCheck.buildDfmPatternAnalysis(res, {
      object: PatternState.object,
      viaKind: PatternState.viaKind,
      dimension: PatternState.dimension,
      sortBy: PatternState.sortBy,
      topN: PatternState.topN
    });
    PatternState.last = analysis;

    ['btnPatObjVia', 'btnPatObjTrace'].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.classList.toggle('active', el.dataset.obj === PatternState.object);
    });
    if ($('selPatViaKind')) $('selPatViaKind').disabled = PatternState.object !== 'via';

    var k = analysis.kpis;
    if ($('patKpiObjects')) $('patKpiObjects').textContent = k.objectCount;
    var objLbl = PatternState.object === 'via'
      ? (PatternState.viaKind === 'signal' ? '信号孔' : (PatternState.viaKind === 'gnd' ? 'GND 孔' : '过孔'))
      : '走线';
    if ($('patKpiObjectsLbl')) $('patKpiObjectsLbl').textContent = '问题对象数 · ' + objLbl;
    if ($('patKpiDefects')) $('patKpiDefects').textContent = k.defectCount;
    if ($('patKpiPairs')) $('patKpiPairs').textContent = hasResult ? (res.failCount || k.defectCount) : 0;
    if ($('patKpiMinDist')) $('patKpiMinDist').textContent = k.minDist == null ? '-' : k.minDist.toFixed(3);
    if ($('patKpiMaxDeficit')) $('patKpiMaxDeficit').textContent = k.maxDeficit ? k.maxDeficit.toFixed(3) : '-';
    if ($('patKpiConcentration')) $('patKpiConcentration').textContent = k.defectCount ? (k.concentration * 100).toFixed(1) + '%' : '-';
    if ($('patKpiConcentrationLbl')) $('patKpiConcentrationLbl').textContent = '前 3 名「' + root.DfmCheck.patDimLabel(PatternState.dimension) + '」集中度';

    if ($('cardPatConcl')) $('cardPatConcl').style.display = analysis.hasData ? '' : 'none';
    if ($('patConclusion')) {
      $('patConclusion').innerHTML = analysis.hasData
        ? ('<div>' + analysis.summary.headline + '</div>' + (analysis.summary.bullets.length
          ? '<ul style="margin:8px 0 0;padding-left:20px">' + analysis.summary.bullets.map(function (b) { return '<li>' + b + '</li>'; }).join('') + '</ul>'
          : ''))
        : ('<div style="color:var(--sub)">' + escHtml(analysis.summary.headline || '暂无缺陷数据') + '</div>');
    }

    if ($('patDimTitle')) $('patDimTitle').textContent = patDimTitleFor(PatternState.dimension, PatternState.object);
    var dimBox = $('patDimChart');
    if (dimBox) {
      if (!analysis.hasData || !analysis.dimensionRows.length) {
        dimBox.innerHTML = '<div style="color:var(--sub);font-size:13px;padding:12px 0">暂无数据</div>';
      } else {
        var max = analysis.dimensionRows[0].count || 1;
        dimBox.innerHTML = analysis.dimensionRows.map(function (r, i) {
          return '<div class="pat-bar-row">' +
            '<div class="pat-bar-name" data-tip="' + escHtml(r.key) + '" onclick="patFocusDimensionAt(' + i + ')">' + escHtml(r.key) + '</div>' +
            '<div class="pat-bar-track"><div class="pat-bar-fill ' + (i === 0 ? 'bad' : (i === 1 ? 'warn' : '')) + '" style="width:' + Math.max(2, r.count / max * 100).toFixed(1) + '%"></div></div>' +
            '<div class="pat-bar-val">' + r.count + ' 处 · ' + (r.pct * 100).toFixed(1) + '%</div></div>';
        }).join('');
      }
    }
    if ($('patDimSub')) $('patDimSub').textContent = analysis.hasData ? ('共 ' + analysis.dimensionRows.length + ' 组 · 合计 ' + analysis.kpis.defectCount + ' 处') : '';

    var defBox = $('patDeficitChart');
    if (defBox) {
      if (!analysis.hasData) {
        defBox.innerHTML = '<div style="color:var(--sub);font-size:13px;padding:12px 0">暂无数据</div>';
      } else {
        var maxB = Math.max.apply(null, [1].concat(analysis.deficitBuckets.map(function (b) { return b.count; })));
        defBox.innerHTML = analysis.deficitBuckets.map(function (b, i) {
          return '<div class="pat-bar-row">' +
            '<div class="pat-bar-name" style="cursor:default">' + b.label + '</div>' +
            '<div class="pat-bar-track"><div class="pat-bar-fill ' + (i >= 2 ? 'bad' : (i === 1 ? 'warn' : '')) + '" style="width:' + Math.max(1, b.count / maxB * 100).toFixed(1) + '%"></div></div>' +
            '<div class="pat-bar-val">' + b.count + ' 处 · ' + (b.pct * 100).toFixed(0) + '%</div></div>';
        }).join('');
      }
    }
    if ($('patDeficitSub')) $('patDeficitSub').textContent = analysis.hasData ? '阈值减去实测间距分档' : '';

    if ($('patTableTitle')) $('patTableTitle').textContent = patObjectTitle(PatternState.object, PatternState.viaKind);
    if ($('tblPatObjectsHead')) $('tblPatObjectsHead').innerHTML = patTableHead(PatternState.object);
    var tbody = $('tblPatObjectsBody');
    if (tbody) {
      if (!analysis.hasData) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--sub)">' + escHtml(analysis.summary.headline || '暂无数据') + '</td></tr>';
      } else {
        var total = analysis.kpis.defectCount || 1;
        tbody.innerHTML = analysis.objects.map(function (it, i) {
          var pct = (it.failCount / total * 100).toFixed(1);
          var objCell = PatternState.object === 'via'
            ? ('<b>Via #' + escHtml(it.id) + '</b><div style="font-size:11px;color:var(--sub)">[' + (it.origin ? it.origin[0].toFixed(1) + ', ' + it.origin[1].toFixed(1) : '-') + ']</div>')
            : ('<b>Trace #' + escHtml(it.id) + '</b><div style="font-size:11px;color:var(--sub)">' + escHtml(it.peerList.slice(0, 2).join(', ')) + (it.peerList.length > 2 ? ' 等' + it.peerList.length + ' 孔' : '') + '</div>');
          var col3 = PatternState.object === 'via'
            ? ('<span class="pat-chip ' + (it.isGnd ? 'muted' : '') + '">' + escHtml(it.spanType || '通孔') + '</span>')
            : ('<span class="pat-chip">' + escHtml(it.layer || '-') + '</span>');
          var col4 = PatternState.object === 'via' ? escHtml(it.padstack || '-') : escHtml(it.net || '-');
          var col5 = PatternState.object === 'via' ? ('<span style="font-size:12px">' + escHtml(it.net || '-') + '</span>') : (it.width == null ? '-' : it.width.toFixed(2));
          return '<tr><td style="color:var(--sub)">' + (i + 1) + '</td><td>' + objCell + '</td><td>' + col3 + '</td><td>' + col4 + '</td><td>' + col5 + '</td>' +
            '<td><b style="color:#be123c">' + it.failCount + '</b></td><td>' + pct + '%</td>' +
            '<td>' + (it.minDist == null ? '-' : it.minDist.toFixed(3)) + '</td>' +
            '<td>' + (it.maxDeficit ? ('<b style="color:#be123c">' + it.maxDeficit.toFixed(3) + '</b>') : '-') + '</td>' +
            '<td><button type="button" class="btn sec small pat-obj-btn" onclick="patJumpToDetailAt(' + i + ')">查看明细</button></td></tr>';
        }).join('');
      }
    }
    if ($('patTableSub')) {
      $('patTableSub').textContent = analysis.hasData
        ? ('共 ' + analysis.objectCount + ' 个对象，当前显示 ' + analysis.objects.length + ' 个')
        : '';
    }
    return analysis;
  }

  function patFocusDimension(value) {
    if (!value) return;
    var tabBtn = document.querySelector('nav#tabs button[data-tab="result"]');
    if (tabBtn) tabBtn.click();
    var inp = $('inpSearch');
    if (inp) {
      inp.value = value;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function patFocusDimensionAt(idx) {
    var rows = (PatternState.last && PatternState.last.dimensionRows) || [];
    if (rows[idx]) patFocusDimension(rows[idx].key);
  }

  function patJumpToDetail(id) {
    var tabBtn = document.querySelector('nav#tabs button[data-tab="result"]');
    if (tabBtn) tabBtn.click();
    var inp = $('inpSearch');
    if (inp) {
      inp.value = (PatternState.object === 'via' ? 'Via ' : 'Trace ') + id;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function patJumpToDetailAt(idx) {
    var list = (PatternState.last && PatternState.last.objects) || [];
    if (list[idx]) patJumpToDetail(list[idx].id);
  }

  function exportPatternCsv() {
    var analysis = PatternState.last || renderPatternAnalysis();
    if (!analysis.hasData) { alert('暂无可导出的规律分析数据，请先运行检查。'); return; }
    var csv = root.DfmCheck.buildPatternCsv(analysis);
    var name = 'DFM规律分析_' + (analysis.object === 'via' ? '信号孔' : '走线') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
  }

  function syncPatDimOptions() {
    var sel = $('selPatDim');
    if (!sel) return;
    var viaOnly = ['kind', 'padstack'], traceOnly = ['width'];
    Array.prototype.forEach.call(sel.options, function (o) {
      if (PatternState.object === 'via' && traceOnly.indexOf(o.value) >= 0) o.disabled = true;
      else if (PatternState.object === 'trace' && viaOnly.indexOf(o.value) >= 0) o.disabled = true;
      else o.disabled = false;
    });
    var curOpt = Array.prototype.find.call(sel.options, function (o) { return o.value === sel.value; });
    if (curOpt && curOpt.disabled) {
      var first = Array.prototype.find.call(sel.options, function (o) { return !o.disabled; });
      if (first) { sel.value = first.value; PatternState.dimension = first.value; }
    }
  }

  function bindPatternEvents() {
    ["btnPatObjVia", "btnPatObjTrace"].forEach(function (id) {
      var btn = $(id);
      if (btn) btn.addEventListener("click", function () {
        PatternState.defectMode = id === "btnPatObjTrace" ? 'pad' : 'line';
        PatternState.object = btn.dataset.obj;
        if (root.DfmApp.PatternModes) root.DfmApp.PatternModes.syncSections();
        syncPatDimOptions();
        renderPatternAnalysis();
      });
    });
    if ($("selPatViaKind")) $("selPatViaKind").addEventListener("change", function (e) { PatternState.viaKind = e.target.value; renderPatternAnalysis(); });
    if ($("selPatDim")) $("selPatDim").addEventListener("change", function (e) { PatternState.dimension = e.target.value; renderPatternAnalysis(); });
    if ($("selPatSort")) $("selPatSort").addEventListener("change", function (e) { PatternState.sortBy = e.target.value; renderPatternAnalysis(); });
    if ($("selPatTopN")) $("selPatTopN").addEventListener("change", function (e) { PatternState.topN = parseInt(e.target.value, 10) || 0; renderPatternAnalysis(); });
    if ($("btnPatRefresh")) $("btnPatRefresh").addEventListener("click", renderPatternAnalysis);
    if ($("btnPatExport")) $("btnPatExport").addEventListener("click", exportPatternCsv);
    syncPatDimOptions();
  }

  root.PatternState = PatternState;
  root.renderPatternAnalysis = renderPatternAnalysis;
  root.patFocusDimension = patFocusDimension;
  root.patFocusDimensionAt = patFocusDimensionAt;
  root.patJumpToDetail = patJumpToDetail;
  root.patJumpToDetailAt = patJumpToDetailAt;
  root.exportPatternCsv = exportPatternCsv;
  root.syncPatDimOptions = syncPatDimOptions;
  root.buildDfmPatternAnalysis = root.DfmCheck.buildDfmPatternAnalysis;
  root.buildPatternCsv = root.DfmCheck.buildPatternCsv;

  bindPatternEvents();
})(typeof window !== "undefined" ? window : globalThis);
