/* ============================================================================
 * dfm-rules-io.js —— DFM 加工能力检查模块：分层规则表与规则配置 JSON 快照读写
 * ========================================================================== */
(function (root) {
  "use strict";

  var App = root.DfmApp;
  var $ = App.$;
  var escHtml = App.escHtml;
  var State = App.State;
  var HistoryManager = App.HistoryManager;
  var runCheck = function (s) { if (root.runCheck) root.runCheck(s); };

  var LayerRules = {
    key: 'pcb.dfm.layerRules.v1',
    rows: [],
    defaults: function () {
      return [
        { layers: 'Top、Bot', gnd: this.defOf('inpThresholdGnd'), sig: this.defOf('inpThresholdSignal'), pad: this.defOf('inpThresholdPadPair') },
        { layers: '内层', gnd: this.defOf('inpThresholdGnd'), sig: this.defOf('inpThresholdSignal'), pad: this.defOf('inpThresholdPadPair') }
      ];
    },
    defOf: function (id) {
      var v = parseFloat($(id) ? $(id).value : '');
      return isFinite(v) ? v : 0;
    },
    load: function () {
      try {
        var raw = root.localStorage.getItem(this.key);
        if (!raw) return null;
        var arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return null;
        return arr.filter(function (r) { return r && typeof r.layers === 'string'; }).map(function (r) {
          return {
            layers: r.layers,
            gnd: parseFloat(r.gnd) || 0,
            sig: parseFloat(r.sig) || 0,
            pad: parseFloat(r.pad) || 0
          };
        });
      } catch (e) { return null; }
    },
    save: function () {
      try { root.localStorage.setItem(this.key, JSON.stringify(this.read())); } catch (e) {}
    },
    read: function () {
      var body = $('layerRuleBody');
      if (!body) return [];
      return Array.prototype.slice.call(body.querySelectorAll('tr[data-row]')).map(function (tr) {
        return {
          layers: (tr.querySelector('.lrLayers').value || '').trim(),
          gnd: parseFloat(tr.querySelector('.lrGnd').value),
          sig: parseFloat(tr.querySelector('.lrSig').value),
          pad: parseFloat(tr.querySelector('.lrPad').value)
        };
      }).filter(function (r) { return r.layers; });
    },
    previewOf: function (layers) {
      var parse = (root.DfmCheck && root.DfmCheck.parseLayerSpec) ? root.DfmCheck.parseLayerSpec(layers) : [];
      if (!parse.length) return layers && layers.trim() ? '未识别，按默认阈值' : '';
      var label = (root.DfmCheck.layerSpecLabel ? root.DfmCheck.layerSpecLabel(parse) : '') || '';
      return label ? '= ' + label : '';
    },
    rowHtml: function (r) {
      var v = function (x) { return (isFinite(x) && x !== null && x !== undefined) ? String(x) : ''; };
      return '<tr data-row>' +
        '<td><input class="lrLayers" data-no-persist value="' + escHtml(String(r.layers || '')) + '" placeholder="Top、Bot 或 内层 或 L2-L5" style="width:100%">' +
        '<div class="hint lrPreview" style="font-size:12px;margin-top:2px">' + escHtml(this.previewOf(r.layers)) + '</div></td>' +
        '<td><input type="number" class="lrGnd" data-no-persist value="' + v(r.gnd) + '" step="0.00001" min="0" style="width:100%"></td>' +
        '<td><input type="number" class="lrSig" data-no-persist value="' + v(r.sig) + '" step="0.00001" min="0" style="width:100%"></td>' +
        '<td><input type="number" class="lrPad" data-no-persist value="' + v(r.pad) + '" step="0.00001" min="0" style="width:100%"></td>' +
        '<td class="lrHit" style="font-size:12px;color:var(--sub)">—</td>' +
        '<td><button type="button" class="btn bad small lrDel">删除</button></td></tr>';
    },
    render: function (list) {
      this.rows = list || [];
      var self = this;
      var body = $('layerRuleBody');
      if (!body) return;
      if (!this.rows.length) {
        body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--sub);padding:12px">未设置分层规则，全部层采用下方默认阈值。</td></tr>';
      } else {
        body.innerHTML = this.rows.map(function (r) { return self.rowHtml(r); }).join('');
      }
      this.syncHint();
      this.renderStats(State.checkResult);
    },
    add: function (rule) {
      var list = this.read();
      list.push(rule || { layers: '', gnd: this.defOf('inpThresholdGnd'), sig: this.defOf('inpThresholdSignal'), pad: this.defOf('inpThresholdPadPair') });
      this.render(list);
      this.save();
      var inputs = $('layerRuleBody').querySelectorAll('tr[data-row] .lrLayers');
      if (inputs.length) inputs[inputs.length - 1].focus();
    },
    syncHint: function () {
      var n = this.read().length;
      if (!$('layerRuleHint')) return;
      if (!n) {
        $('layerRuleHint').textContent = '未设分层规则：所有层统一用上面的默认阈值。';
        return;
      }
      $('layerRuleHint').textContent = '已设 ' + n + ' 条分层规则 · 同一层命中多条时靠上优先，未命中层继续使用默认阈值。';
    },
    renderStats: function (result) {
      var body = $('layerRuleBody');
      if (!body) return;
      var stats = (result && result.layerRuleStats) || [];
      Array.prototype.slice.call(body.querySelectorAll('tr[data-row]')).forEach(function (tr, i) {
        var s = stats[i];
        var cell = tr.querySelector('.lrHit');
        if (!cell) return;
        if (!result || !s) { cell.textContent = '—'; return; }
        cell.innerHTML = '<b>' + (s.checked + s.padPairChecked) + '</b> 处' +
          (s.fail + s.padPairFail > 0 ? '<br><span class="bad">超标 ' + (s.fail + s.padPairFail) + '</span>' : '');
      });
    }
  };

  var DfmRuleConfig = {
    kind: 'pcb-dfm-rule-config',
    version: 1,
    fieldIds: ['selMode', 'inpGndPadDiam', 'inpSignalPadDiam', 'inpGndFirstDrill', 'inpSignalFirstDrill', 'selNetFilter', 'selPadShape', 'inpGndPadW', 'inpGndPadH', 'inpSigPadW', 'inpSigPadH', 'inpPadCorner', 'inpPadRot', 'inpThresholdGnd', 'inpThresholdSignal', 'inpThresholdPadPair'],
    snapshot: function () {
      var fields = {};
      this.fieldIds.forEach(function (id) { var el = $(id); if (el) fields[id] = el.value; });
      return { kind: this.kind, version: this.version, savedAt: new Date().toISOString(), fields: fields, layerRules: LayerRules.read(), padstackRules: App.PadstackRules ? App.PadstackRules.read() : {} };
    },
    saveToFile: function () {
      var blob = new Blob([JSON.stringify(this.snapshot(), null, 2)], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'PCB_加工能力规则_' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    },
    loadFromObject: function (data) {
      if (!data || data.kind !== this.kind || data.version !== this.version || !data.fields || typeof data.fields !== 'object') {
        throw new Error('文件格式不正确，或不是受支持的加工能力规则文件。');
      }
      this.fieldIds.forEach(function (id) {
        if (!Object.prototype.hasOwnProperty.call(data.fields, id)) return;
        var el = $(id); if (!el) return;
        var value = String(data.fields[id]);
        if (el.tagName === 'SELECT' && !Array.prototype.some.call(el.options, function (o) { return o.value === value; })) return;
        if (el.type === 'number' && (value.trim() === '' || !Number.isFinite(Number(value)))) return;
        el.value = value;
      });
      var rows = Array.isArray(data.layerRules) ? data.layerRules.filter(function (r) { return r && typeof r.layers === 'string'; }).map(function (r) {
        return {
          layers: r.layers,
          gnd: Number.isFinite(Number(r.gnd)) ? Number(r.gnd) : 0,
          sig: Number.isFinite(Number(r.sig)) ? Number(r.sig) : 0,
          pad: Number.isFinite(Number(r.pad)) ? Number(r.pad) : 0
        };
      }) : [];
      LayerRules.render(rows);
      LayerRules.save();
      if (App.PadstackRules) App.PadstackRules.load(data.padstackRules);
      HistoryManager.renderAll();
      if (State.checkResult && State.vias.length && State.traces.length) runCheck(true);
    }
  };

  root.LayerRules = LayerRules;
  root.DfmRuleConfig = DfmRuleConfig;
  App.LayerRules = LayerRules;
  App.DfmRuleConfig = DfmRuleConfig;

  if (typeof root.bindDfmConfigEvents === "function") root.bindDfmConfigEvents();
})(typeof window !== "undefined" ? window : globalThis);
