/* ============================================================================
 * dfm-padstack-rules.js —— DFM 加工能力检查模块：Padstack 尺寸覆盖表
 * 按导入数据中的 Padstack Name 单独设置焊盘直径与一钻直径，支持勾选批量应用。
 * 规则对象 { [padstack]: { padDiameter, firstDrill } } 传给引擎 parseDfmItems 的 padstackRules。
 * ========================================================================== */
(function (root) {
  "use strict";

  var App = root.DfmApp;
  var $ = App.$;
  var escHtml = App.escHtml;
  var State = App.State;
  var runCheck = function (s) { if (root.runCheck) root.runCheck(s); };

  var EMPTY_ROW = '<tr><td colspan="6" class="hint dfm-ps-empty">导入数据后列出 Padstack</td></tr>';

  State.padstackRules = State.padstackRules || {};

  function isPositive(n) { return Number.isFinite(n) && n > 0; }

  /** 只保留合法条目：名称非空，焊盘直径与一钻直径均为正数。 */
  function sanitize(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(raw).forEach(function (name) {
      var r = raw[name] || {};
      var padDiameter = Number(r.padDiameter), firstDrill = Number(r.firstDrill);
      if (name && isPositive(padDiameter) && isPositive(firstDrill)) out[name] = { padDiameter: padDiameter, firstDrill: firstDrill };
    });
    return out;
  }

  /** 读取表格中已启用单独尺寸的行。 */
  function readFromTable() {
    var rules = {};
    var rows = document.querySelectorAll('#padstackRuleBody tr[data-padstack]');
    // 表中尚无 Padstack 行（未导入数据）时保留已载入的规则，避免被读成空
    if (!rows.length) return sanitize(State.padstackRules);
    rows.forEach(function (row) {
      var name = row.dataset.padstack || '';
      var enable = row.querySelector('.ps-enable');
      if (!enable || !enable.checked) return;
      var padDiameter = Number(row.querySelector('.ps-pad-diameter').value);
      var firstDrill = Number(row.querySelector('.ps-first-drill').value);
      if (name && isPositive(padDiameter) && isPositive(firstDrill)) rules[name] = { padDiameter: padDiameter, firstDrill: firstDrill };
    });
    return rules;
  }

  function resetSelectAll() {
    var all = $('padstackSelectAll');
    if (all) { all.checked = false; all.indeterminate = false; }
  }

  function rowHtml(name, via, saved) {
    var pad = Number(saved && saved.padDiameter) > 0 ? Number(saved.padDiameter) : Number(via.padDiameter);
    var drill = Number(saved && saved.firstDrill) > 0 ? Number(saved.firstDrill) : Number(via.firstDrill);
    var safe = escHtml(name);
    return '<tr data-padstack="' + safe + '">' +
      '<td><input class="ps-select" type="checkbox" data-no-persist aria-label="选择 ' + safe + '"></td>' +
      '<td class="ps-name">' + safe + '</td>' +
      '<td>' + (via.isGnd ? 'GND' : '信号') + '</td>' +
      '<td><input class="ps-enable" type="checkbox" data-no-persist ' + (saved ? 'checked' : '') + ' aria-label="启用 ' + safe + ' 单独尺寸"></td>' +
      '<td><input class="ps-pad-diameter" type="number" data-no-persist min="0.1" step="0.001" value="' + (Number.isFinite(pad) ? pad : 0) + '" aria-label="' + safe + ' 焊盘直径"></td>' +
      '<td><input class="ps-first-drill" type="number" data-no-persist min="0.1" step="0.001" value="' + (Number.isFinite(drill) ? drill : 0) + '" aria-label="' + safe + ' 一钻直径"></td>' +
      '</tr>';
  }

  /** 按当前过孔列表重绘表格；已保存的覆盖值回填，其余行显示当前生效尺寸。 */
  function render() {
    var body = $('padstackRuleBody');
    if (!body) return;
    resetSelectAll();
    var byName = new Map();
    State.vias.forEach(function (v) {
      var name = (v.padstack || '').trim();
      if (name && !byName.has(name)) byName.set(name, v);
    });
    var entries = Array.from(byName.entries()).sort(function (a, b) { return a[0].localeCompare(b[0]); });
    body.innerHTML = entries.length
      ? entries.map(function (e) { return rowHtml(e[0], e[1], State.padstackRules[e[0]]); }).join('')
      : EMPTY_ROW;
  }

  /** 取表格当前值写入 State 并重新检查；尚无检查结果时只保存不触发。 */
  function commit() {
    State.padstackRules = readFromTable();
    if (State.checkResult) runCheck(true);
  }

  /** 规则文件载入：校验后替换 State 并重绘，不触发检查（由调用方统一触发）。 */
  function loadRules(raw) {
    State.padstackRules = sanitize(raw);
    render();
  }

  function onSelectAll(e) {
    $('padstackRuleBody').querySelectorAll('.ps-select').forEach(function (ck) { ck.checked = e.target.checked; });
    e.target.indeterminate = false;
  }

  function syncSelectAll() {
    var boxes = Array.prototype.slice.call($('padstackRuleBody').querySelectorAll('.ps-select'));
    var selected = boxes.filter(function (ck) { return ck.checked; }).length;
    $('padstackSelectAll').checked = boxes.length > 0 && selected === boxes.length;
    $('padstackSelectAll').indeterminate = selected > 0 && selected < boxes.length;
  }

  function onBodyChange(e) {
    if (e.target.matches('.ps-select')) { syncSelectAll(); return; }
    if (e.target.matches('.ps-pad-diameter,.ps-first-drill')) {
      var enable = e.target.closest('tr').querySelector('.ps-enable');
      if (enable) enable.checked = true;
      commit();
    } else if (e.target.matches('.ps-enable')) {
      commit();
    }
  }

  function setBulkHint(text) {
    var el = $('padstackBulkHint');
    if (el) el.textContent = text;
  }

  function applyBulk() {
    var pad = Number($('inpBulkPadDiameter').value);
    var drill = Number($('inpBulkFirstDrill').value);
    if (!(pad > 0) || !(drill > 0)) { setBulkHint('批量焊盘直径与一钻直径须大于 0'); return false; }
    var rows = Array.prototype.slice.call($('padstackRuleBody').querySelectorAll('tr[data-padstack]'))
      .filter(function (row) { return row.querySelector('.ps-select').checked; });
    if (!rows.length) { setBulkHint('先勾选要批量应用的 Padstack 行'); return false; }
    rows.forEach(function (row) {
      row.querySelector('.ps-enable').checked = true;
      row.querySelector('.ps-pad-diameter').value = pad;
      row.querySelector('.ps-first-drill').value = drill;
    });
    setBulkHint('已应用到 ' + rows.length + ' 个 Padstack');
    commit();
    return true;
  }

  function bind() {
    if (!$('padstackRuleBody')) return;
    $('padstackSelectAll').addEventListener('change', onSelectAll);
    $('padstackRuleBody').addEventListener('change', onBodyChange);
    $('btnApplyPadstackBulk').addEventListener('click', applyBulk);
  }

  var PadstackRules = {
    read: readFromTable, render: render, commit: commit, load: loadRules,
    sanitize: sanitize, applyBulk: applyBulk
  };

  App.PadstackRules = PadstackRules;
  root.PadstackRules = PadstackRules;
  root.readPadstackRulesFromTable = readFromTable;
  root.renderPadstackRuleTable = render;
  bind();
})(typeof window !== "undefined" ? window : globalThis);
