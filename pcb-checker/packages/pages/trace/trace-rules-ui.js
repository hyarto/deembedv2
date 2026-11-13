/* ============================================================================
 * trace-rules-ui.js —— 走线检查模块分层规则编辑、总开关联动与规则文件读写
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var TE = root.TraceEngine;
  var App = root.TraceApp;
  var S = App.S;
  var $ = App.$;
  var fmt = TE.fmt;
  var esc = TE.esc;

  function boundsFrom(mode, nums) {
    if (mode === 'range') return { list: [], min: nums[0] != null ? nums[0] : NaN, max: nums[1] != null ? nums[1] : NaN };
    if (mode === 'min') return { list: [], min: nums[0] != null ? nums[0] : NaN, max: NaN };
    if (mode === 'list') return { list: nums, min: NaN, max: NaN };
    return { list: [], min: NaN, max: NaN };
  }

  function syncMasterSwitches() {
    function syncOne(masterId, subSelector, defId) {
      var master = $(masterId);
      if (!master) return;
      var subs = Array.from(document.querySelectorAll(subSelector));
      var def = $(defId);
      if (def) subs.push(def);
      if (!subs.length) return;
      var checkedCount = subs.filter(function (s) { return s.checked; }).length;
      if (checkedCount === 0) {
        master.checked = false;
        master.indeterminate = false;
      } else if (checkedCount === subs.length) {
        master.checked = true;
        master.indeterminate = false;
      } else {
        master.checked = true;
        master.indeterminate = true;
      }
    }
    syncOne('chkWidth', '.rCW', 'defCheckWidth');
    syncOne('chkLen', '.rCL', 'defCheckLen');
    syncOne('chkWidthLen', '.rCWL', 'defCheckWidthLen');
    syncOne('chkRad', '.rCR', 'defCheckRad');
  }

  function collectRules() {
    S.rules = [];
    document.querySelectorAll('#ruleRows .rulegrid').forEach(function (el) {
      var lenMode = el.querySelector('.rM').value;
      var radMode = el.querySelector('.rRM').value;
      var ln = boundsFrom(lenMode, TE.parseNumList(el.querySelector('.rL').value));
      var rn = boundsFrom(radMode, TE.parseNumList(el.querySelector('.rR').value));
      var wInp = el.querySelector('.rW');
      var wText = wInp ? wInp.value.trim() : '';
      var wCombos = TE.parseWidthCombos(wText);
      var widthsList = [];
      wCombos.forEach(function (c) {
        c.seq.forEach(function (w) { if (widthsList.indexOf(w) < 0) widthsList.push(w); });
      });
      var wlInp = el.querySelector('.rWL');
      var wlText = wlInp ? wlInp.value.trim() : '';
      var chkWL = el.querySelector('.rCWL') ? el.querySelector('.rCWL').checked : true;
      S.rules.push({
        enabled: el.querySelector('.rE').checked,
        layer: el.querySelector('.rN').value.trim(),
        checkWidth: el.querySelector('.rCW').checked,
        widthsText: wText,
        widthCombos: wCombos,
        widths: widthsList,
        checkLen: el.querySelector('.rCL').checked,
        lenMode: lenMode,
        lengths: ln.list,
        lenMin: ln.min,
        lenMax: ln.max,
        checkWidthLen: chkWL,
        widthLensText: wlText,
        widthLenRules: TE.parseWidthLengthRules(wlText),
        checkRad: el.querySelector('.rCR').checked,
        radMode: radMode,
        radii: rn.list,
        radMin: rn.min,
        radMax: rn.max
      });
    });

    var lnDef = boundsFrom($('defLenMode').value, TE.parseNumList($('defLengths').value));
    var rnDef = boundsFrom($('defRadMode').value, TE.parseNumList($('defRadii').value));
    var defWInp = $('defWidths');
    var defWText = defWInp ? defWInp.value.trim() : '';
    var defWCombos = TE.parseWidthCombos(defWText);
    var defWidthsList = [];
    defWCombos.forEach(function (c) {
      c.seq.forEach(function (w) { if (defWidthsList.indexOf(w) < 0) defWidthsList.push(w); });
    });
    var defWlText = $('defWidthLens') ? $('defWidthLens').value.trim() : '';
    S.defaultRule = {
      enabled: $('defEnabled').checked,
      checkWidth: $('defCheckWidth').checked,
      widthsText: defWText,
      widthCombos: defWCombos,
      widths: defWidthsList,
      checkLen: $('defCheckLen').checked,
      lenMode: $('defLenMode').value,
      lengths: lnDef.list,
      lenMin: lnDef.min,
      lenMax: lnDef.max,
      checkWidthLen: $('defCheckWidthLen') ? $('defCheckWidthLen').checked : true,
      widthLensText: defWlText,
      widthLenRules: TE.parseWidthLengthRules(defWlText),
      checkRad: $('defCheckRad').checked,
      radMode: $('defRadMode').value,
      radii: rnDef.list,
      radMin: rnDef.min,
      radMax: rnDef.max
    };
    S.tol = parseFloat($('inpTol').value);
    if (isNaN(S.tol)) S.tol = 0.001;
    S.checkWidth = $('chkWidth').checked;
    S.checkLen = $('chkLen').checked;
    S.checkWidthLen = $('chkWidthLen') ? $('chkWidthLen').checked : true;
    S.checkRad = $('chkRad').checked;
  }

  function addRuleRow(layer, widths, lenMode, lenText, enabled, extra) {
    extra = extra || {};
    var masterW = $('chkWidth') ? $('chkWidth').checked : true;
    var masterL = $('chkLen') ? $('chkLen').checked : true;
    var masterWL = $('chkWidthLen') ? $('chkWidthLen').checked : true;
    var masterR = $('chkRad') ? $('chkRad').checked : true;

    var chkW = extra.checkWidth != null ? !!extra.checkWidth : masterW;
    var widthsText = extra.widthsText != null ? extra.widthsText : (widths || '');
    var chkL = extra.checkLen != null ? !!extra.checkLen : (lenMode && lenMode !== 'off' ? true : masterL);
    var widthLensText = extra.widthLensText || '';
    var chkWL = extra.checkWidthLen != null ? !!extra.checkWidthLen : masterWL;
    var chkR = extra.checkRad != null ? !!extra.checkRad : masterR;
    var radMode = extra.radMode || 'off';
    var radText = extra.radText || '';
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="rulegrid ruleblock" data-no-persist>' +
        '<div class="top">' +
          '<label class="fld"><input type="checkbox" class="rE"' + (enabled === false ? '' : ' checked') + '> 启用</label>' +
          '<label class="fld">层名 <input type="text" class="rN" style="width:120px" value="' + esc(layer || '') + '" placeholder="如 02G01P"></label>' +
          '<span style="flex:1"></span>' +
          '<button type="button" class="btn ghost small" data-act="fill" data-tip="提取当前导入数据中该层的实际线宽组合、线长与弧半径填入">按层数据填充</button>' +
          '<button type="button" class="btn danger small" data-act="del">删除</button>' +
        '</div>' +
        '<div class="ruleitems">' +
          '<span data-tip="多个允许组合以逗号分隔，正序与倒序均匹配">线宽组合</span>' +
          '<span class="pair"><input type="text" class="rW" value="' + esc(widthsText) + '" placeholder="如 6.9-6-3.94, 6.9-5.7-6.9"></span>' +
          '<label class="chk fld"><input type="checkbox" class="rCW"' + (chkW ? ' checked' : '') + '> 检查</label>' +
          '<span data-tip="列表模式填写允许长度集合；范围模式填写 最小,最大">总线长</span>' +
          '<span class="pair"><select class="rM">' +
            '<option value="off"' + (lenMode === 'off' || !lenMode ? ' selected' : '') + '>不检查</option>' +
            '<option value="list"' + (lenMode === 'list' ? ' selected' : '') + '>列表</option>' +
            '<option value="range"' + (lenMode === 'range' ? ' selected' : '') + '>范围</option></select>' +
            '<input type="text" class="rL" value="' + esc(lenText || '') + '" placeholder="列表 1000,1500 或 范围 800,2500"></span>' +
          '<label class="chk fld"><input type="checkbox" class="rCL"' + (chkL ? ' checked' : '') + '> 检查</label>' +
          '<span data-tip="限定特定线宽段总长度，语法如 6.9=10/20 或 6.9:8~12 或 6.9<=10">指定线宽线长</span>' +
          '<span class="pair"><input type="text" class="rWL" value="' + esc(widthLensText) + '" placeholder="如 6.9=10/20 或 6.9:8~12"></span>' +
          '<label class="chk fld"><input type="checkbox" class="rCWL"' + (chkWL ? ' checked' : '') + '> 检查</label>' +
          '<span data-tip="无圆弧段的网络不触发不符合判定">弧半径</span>' +
          '<span class="pair"><select class="rRM">' +
            '<option value="off"' + (radMode === 'off' ? ' selected' : '') + '>不检查</option>' +
            '<option value="list"' + (radMode === 'list' ? ' selected' : '') + '>列表</option>' +
            '<option value="range"' + (radMode === 'range' ? ' selected' : '') + '>范围</option>' +
            '<option value="min"' + (radMode === 'min' ? ' selected' : '') + '>最小半径</option></select>' +
            '<input type="text" class="rR" value="' + esc(radText) + '" placeholder="列表 52.38 / 范围 40,80 / 最小 50"></span>' +
          '<label class="chk fld"><input type="checkbox" class="rCR"' + (chkR ? ' checked' : '') + '> 检查</label>' +
        '</div>' +
      '</div>';
    $('ruleRows').appendChild(wrap.firstElementChild);
  }

  function genLayerRules() {
    if (!S.records.length) {
      alert('请先导入数据');
      return;
    }
    $('ruleRows').innerHTML = '';
    TE.layerStats(S.records).forEach(function (e) {
      addRuleRow(e.layer, '', 'off', '', true);
    });
  }

  function fillFromData(btn) {
    var el = btn.closest('.rulegrid');
    var layer = el.querySelector('.rN').value.trim();
    var ls = TE.layerStats(S.records).find(function (x) { return x.layer === layer; });
    if (!ls) {
      alert('未找到层「' + layer + '」的数据');
      return;
    }
    var seqs = ls.widthSeqs ? Array.from(ls.widthSeqs) : [];
    if (seqs.length) {
      el.querySelector('.rW').value = seqs.join(', ');
    } else {
      el.querySelector('.rW').value = Array.from(ls.widths.keys()).sort(function (a, b) { return a - b; }).map(fmt).join(',');
    }
    el.querySelector('.rCW').checked = true;
    el.querySelector('.rM').value = 'list';
    el.querySelector('.rL').value = Array.from(ls.lens.keys()).sort(function (a, b) { return a - b; }).map(fmt).join(',');
    el.querySelector('.rCL').checked = true;
    var rads = Array.from((ls.radii || new Map()).keys()).sort(function (a, b) { return a - b; });
    if (rads.length) {
      el.querySelector('.rRM').value = 'list';
      el.querySelector('.rR').value = rads.map(fmt).join(',');
      el.querySelector('.rCR').checked = true;
    }
    syncMasterSwitches();
  }

  function radTextOf(r) {
    if (!r || !r.radMode || r.radMode === 'off') return '';
    if (r.radMode === 'list') return (r.radii || []).join(',');
    if (r.radMode === 'min') return isNaN(r.radMin) ? '' : String(r.radMin);
    return [r.radMin, r.radMax].filter(function (x) { return !isNaN(x); }).join(',');
  }

  function widthCombosTextOf(r) {
    if (r.widthsText != null) return r.widthsText;
    if (r.widthCombos && r.widthCombos.length) return r.widthCombos.map(function (c) { return c.raw || c.str; }).join(', ');
    if (r.widths && r.widths.length) return r.widths.join(',');
    return '';
  }

  function ruleSnapshot() {
    collectRules();
    var pack = function (r) {
      return {
        enabled: !!r.enabled,
        layer: r.layer || '',
        checkWidth: r.checkWidth !== false,
        widthsText: widthCombosTextOf(r),
        checkLen: !!r.checkLen,
        lenMode: r.lenMode || 'off',
        lenText: r.lenMode === 'range'
          ? [r.lenMin, r.lenMax].filter(function (x) { return !isNaN(x); }).join(',')
          : (r.lengths || []).join(','),
        checkWidthLen: r.checkWidthLen !== false,
        widthLensText: r.widthLensText || '',
        checkRad: !!r.checkRad,
        radMode: r.radMode || 'off',
        radText: radTextOf(r)
      };
    };
    return {
      kind: 'pcb-trace-rules',
      version: 3,
      rules: S.rules.map(pack),
      def: pack(S.defaultRule),
      tol: S.tol,
      checkWidth: S.checkWidth,
      checkLen: S.checkLen,
      checkWidthLen: S.checkWidthLen,
      checkRad: S.checkRad,
      unit: S.unit
    };
  }

  function applyRulePack(d) {
    if (!d || typeof d !== 'object' || (!Array.isArray(d.rules) && !d.def)) {
      throw new Error('不是有效的走线检查规则 JSON 文件');
    }
    $('ruleRows').innerHTML = '';
    (d.rules || []).forEach(function (r) {
      var extra = { checkRad: !!r.checkRad, radMode: r.radMode || 'off', radText: r.radText || '' };
      if (r.checkWidth != null) extra.checkWidth = r.checkWidth;
      if (r.checkLen != null) extra.checkLen = r.checkLen;
      if (r.checkWidthLen != null) extra.checkWidthLen = r.checkWidthLen;
      if (r.widthLensText != null) extra.widthLensText = r.widthLensText;
      var wText = r.widthsText != null ? r.widthsText : (Array.isArray(r.widths) ? r.widths.join(',') : '');
      addRuleRow(r.layer, wText, r.lenMode, r.lenText, r.enabled !== false, extra);
    });
    var def = d.def || {};
    $('defEnabled').checked = !!def.enabled;
    $('defCheckWidth').checked = def.checkWidth !== false;
    $('defWidths').value = def.widthsText != null ? def.widthsText : (Array.isArray(def.widths) ? def.widths.join(',') : '');
    $('defCheckLen').checked = def.checkLen != null ? !!def.checkLen : !!(def.lenMode && def.lenMode !== 'off');
    $('defLenMode').value = def.lenMode || 'off';
    $('defLengths').value = def.lenText || '';
    if ($('defCheckWidthLen')) $('defCheckWidthLen').checked = def.checkWidthLen !== false;
    if ($('defWidthLens')) $('defWidthLens').value = def.widthLensText || '';
    $('defCheckRad').checked = !!def.checkRad;
    $('defRadMode').value = def.radMode || 'off';
    $('defRadii').value = def.radText || '';
    if (d.tol != null) $('inpTol').value = d.tol;
    $('chkWidth').checked = d.checkWidth !== false;
    $('chkLen').checked = d.checkLen !== false;
    if ($('chkWidthLen')) $('chkWidthLen').checked = d.checkWidthLen !== false;
    $('chkRad').checked = d.checkRad !== false;
    if (d.unit) $('selUnit').value = d.unit;
    syncMasterSwitches();
  }

  function saveRulesFile() {
    var data = ruleSnapshot();
    var text = JSON.stringify(data, null, 2);
    try { localStorage.setItem('pcbTraceChecker', JSON.stringify(data)); } catch (e) {}
    var n = data.rules.length;
    if ($('ruleFileLabel')) $('ruleFileLabel').textContent = '已生成 ' + n + ' 条层规则，请在弹窗中下载保存';
    App.download(
      '走线检查规则.json',
      text,
      '共 ' + n + ' 条层规则' + (data.def && data.def.enabled ? '，含默认规则' : '') + '。下载保存后可通过「从本地文件读取」恢复。'
    );
  }

  function loadRulesFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var d = JSON.parse(String(fr.result).replace(/^\uFEFF/, ''));
        applyRulePack(d);
        var n = (d.rules || []).length;
        if ($('ruleFileLabel')) $('ruleFileLabel').textContent = '已从本地载入：' + file.name + ' · ' + n + ' 条层规则';
      } catch (e) {
        alert('读取失败：请选择走线检查规则 JSON 文件。' + (e && e.message ? ('\n' + e.message) : ''));
      }
    };
    fr.onerror = function () { alert('无法读取该文件'); };
    fr.readAsText(file, 'utf-8');
  }

  Object.assign(App, {
    boundsFrom: boundsFrom,
    syncMasterSwitches: syncMasterSwitches,
    collectRules: collectRules,
    addRuleRow: addRuleRow,
    genLayerRules: genLayerRules,
    fillFromData: fillFromData,
    ruleSnapshot: ruleSnapshot,
    applyRulePack: applyRulePack,
    saveRulesFile: saveRulesFile,
    loadRulesFile: loadRulesFile
  });
})(typeof window !== 'undefined' ? window : globalThis);
