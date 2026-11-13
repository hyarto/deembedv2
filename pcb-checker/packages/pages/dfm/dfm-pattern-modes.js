/* ============================================================================
 * dfm-pattern-modes.js —— 规律分析：线到孔 / 孔到孔重复模式表与列筛选
 * 归并计算在引擎 DfmCheck.buildDfmDefectPatternAnalysis，这里只负责渲染与筛选。
 * 筛选状态在 PatternState.defectModeFilters：{ line:{列:Set}, pad:{列:Set} }。
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var App = root.DfmApp;
  var $ = App.$;
  var escHtml = App.escHtml;
  var State = App.State;
  var Popover = App.PatternFilterPopover;

  var TABLES = { line: 'tblPatViaTraceModes', pad: 'tblPatViaViaModes' };
  var EMPTY_LINE = '<tr><td colspan="6" class="hint empty-cell">暂无线到孔不满足项</td></tr>';
  var EMPTY_PAD = '<tr><td colspan="6" class="hint empty-cell">暂无孔到孔不满足项</td></tr>';

  function PS() { return root.PatternState; }
  function fmt(n) { return Number.isFinite(Number(n)) ? Number(n).toFixed(2) : '未知'; }
  function ids(set, n) { return Array.from(set).slice(0, n || 5).map(escHtml).join(', '); }

  function lineRowHtml(g) {
    var desc = g.viaKind + ' · ' + g.padstack + ' · 焊盘 ' + fmt(g.padDiameter) + ' / 一钻 ' + fmt(g.firstDrill) +
      ' mil · ' + g.layer + ' · 线宽 ' + fmt(g.width) + ' mil · ' + g.mode;
    return '<tr><td>' + escHtml(desc) + '</td><td>≥ ' + fmt(g.threshold) + ' mil</td><td>' + fmt(g.measured) + ' mil</td><td>' +
      fmt(g.maxDeficit) + ' mil</td><td><b>' + g.count.toLocaleString() + '</b></td><td>Via ' + ids(g.vias) + ' / Trace ' + ids(g.traces) + '</td></tr>';
  }

  function padRowHtml(g) {
    var desc = g.gndStack + ' ' + fmt(g.gndDia) + ' mil × ' + g.sigStack + ' ' + fmt(g.sigDia) + ' mil';
    return '<tr><td>' + escHtml(desc) + '</td><td>≥ ' + fmt(g.threshold) + ' mil</td><td>' + fmt(g.measured) + ' mil</td><td>' +
      fmt(g.maxDeficit) + ' mil</td><td><b>' + g.count.toLocaleString() + '</b></td><td>' + ids(g.pairs) + '</td></tr>';
  }

  /** 隐藏不在已选值内的行，并按是否有筛选点亮表头按钮。 */
  function applyFilters(key) {
    var table = $(TABLES[key]);
    if (!table) return;
    var filters = PS().defectModeFilters[key] || {};
    Array.prototype.forEach.call(table.querySelectorAll('tbody tr'), function (row) {
      var show = Object.keys(filters).every(function (col) {
        var values = filters[col];
        if (!(values instanceof Set)) return true;
        var cell = row.cells[Number(col)];
        return !!cell && values.has(cell.textContent.trim());
      });
      row.style.display = show ? '' : 'none';
    });
    table.querySelectorAll('.pat-filter-btn').forEach(function (btn) {
      btn.classList.toggle('active', filters[btn.dataset.patCol] instanceof Set);
    });
  }

  function columnValues(key, col) {
    var rows = $(TABLES[key]).querySelectorAll('tbody tr');
    var set = new Set();
    Array.prototype.forEach.call(rows, function (r) {
      var c = r.cells[col];
      var t = c ? c.textContent.trim() : '';
      if (t && !c.classList.contains('empty-cell')) set.add(t);
    });
    return Array.from(set).sort(function (a, b) { return a.localeCompare(b); });
  }

  function openFilter(button) {
    var key = button.dataset.patTable, col = Number(button.dataset.patCol);
    var filters = PS().defectModeFilters[key];
    Popover.open(button, {
      values: columnValues(key, col),
      current: filters[col] instanceof Set ? filters[col] : null,
      onApply: function (set) { if (set) filters[col] = set; else delete filters[col]; applyFilters(key); },
      onClear: function () { delete filters[col]; applyFilters(key); }
    });
  }

  function bindFilterButtons() {
    document.querySelectorAll('.pat-filter-btn').forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (Popover.isOpenFor(btn)) Popover.close(); else openFilter(btn);
      });
    });
  }

  /** 按 PatternState.defectMode 切换两张表的显示。 */
  function syncSections() {
    var mode = PS().defectMode;
    if ($('patLineModeSection')) $('patLineModeSection').hidden = mode !== 'line';
    if ($('patPadModeSection')) $('patPadModeSection').hidden = mode !== 'pad';
  }

  function renderModes() {
    var a = root.DfmCheck.buildDfmDefectPatternAnalysis(State.checkResult);
    if ($('patDefectModesHint')) {
      $('patDefectModesHint').textContent = '线到孔 ' + a.lineDefectCount.toLocaleString() + ' 处，归并为 ' + a.lineGroupCount.toLocaleString() +
        ' 种尺寸、规则、实测组合；孔到孔 ' + a.padDefectCount.toLocaleString() + ' 对，归并为 ' + a.padGroupCount.toLocaleString() +
        ' 种。相同组合反复出现可能是重复使用的设计单元，需结合 Padstack、线宽与层确认，不能只凭间距数值断定同一根因。';
    }
    if ($('patViaTraceModes')) $('patViaTraceModes').innerHTML = a.lineRows.length ? a.lineRows.map(lineRowHtml).join('') : EMPTY_LINE;
    if ($('patViaViaModes')) $('patViaViaModes').innerHTML = a.padRows.length ? a.padRows.map(padRowHtml).join('') : EMPTY_PAD;
    applyFilters('line');
    applyFilters('pad');
    bindFilterButtons();
    return a;
  }

  App.PatternModes = { render: renderModes, applyFilters: applyFilters, syncSections: syncSections, openFilter: openFilter };
  root.renderDfmDefectPatternAnalysis = renderModes;
  root.applyDfmPatternTableFilters = applyFilters;
  root.openDfmPatternFilter = openFilter;
  root.closeDfmPatternFilter = Popover.close;
  root.buildDfmDefectPatternAnalysis = root.DfmCheck.buildDfmDefectPatternAnalysis;
  bindFilterButtons();
})(typeof window !== 'undefined' ? window : globalThis);
