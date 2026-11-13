/* ============================================================================
 * trace-results-ui.js —— 走线检查结果渲染、差分分析、Excel/CSV 导出与事件绑定
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

  function emptyStatus(st) {
    return { st: st, reasons: [], width: false, length: false, widthLen: false, radius: false, badWidths: [], badRadii: [], badWidthLens: [] };
  }

  function checkOpts() {
    return { checkWidth: S.checkWidth, checkLen: S.checkLen, checkWidthLen: S.checkWidthLen, checkRad: S.checkRad };
  }

  function recStatus(r) {
    if (!S.checkRes) return emptyStatus('none');
    var rule = TE.findRule(r.layer, S.rules, S.defaultRule);
    if (!rule || !TE.ruleHasCriteria(rule, checkOpts())) return emptyStatus('none');
    var v = S.checkRes.recViol.get(r.idx);
    if (!v) return emptyStatus('pass');
    var reasons = Array.isArray(v) ? v : (v.reasons || []);
    return {
      st: 'fail',
      reasons: reasons,
      width: !!v.width,
      length: !!v.length,
      widthLen: !!v.widthLen,
      radius: !!v.radius,
      badWidths: v.badWidths || [],
      badRadii: v.badRadii || [],
      badWidthLens: v.badWidthLens || []
    };
  }

  function currentFiltered() {
    var q = $('fltQ').value.trim().toLowerCase();
    var layer = $('fltLayer').value;
    var st = $('fltStatus').value;
    var arr = S.records.map(function (r) { return { r: r, v: recStatus(r) }; });
    if (q) arr = arr.filter(function (x) { return x.r.net.toLowerCase().includes(q); });
    if (layer) arr = arr.filter(function (x) { return x.r.layer === layer; });
    if (st) arr = arr.filter(function (x) { return x.v.st === st; });
    if (S.sort.col) {
      var k = S.sort.col;
      var d = S.sort.dir;
      arr.sort(function (a, b) {
        var va, vb;
        if (k === 'net') { va = a.r.net; vb = b.r.net; }
        else if (k === 'layer') { va = a.r.layer; vb = b.r.layer; }
        else if (k === 'length') { va = a.r.length; vb = b.r.length; }
        else if (k === 'widths') {
          va = TE.extractWidthSeq(a.r).map(fmt).join('-');
          vb = TE.extractWidthSeq(b.r).map(fmt).join('-');
        }
        else if (k === 'radius') { va = a.r.minRadius; vb = b.r.minRadius; }
        else { va = a.v.st; vb = b.v.st; }
        if (va < vb) return -1 * d;
        if (va > vb) return 1 * d;
        return (a.r.idx || 0) - (b.r.idx || 0);
      });
    }
    return arr;
  }

  function runCheck() {
    if (!S.records.length) {
      alert('请先导入数据');
      App.switchTab('import');
      return;
    }
    App.collectRules();
    S.checkRes = TE.runChecks(S.records, S.rules, S.defaultRule, {
      tol: S.tol,
      checkWidth: S.checkWidth,
      checkLen: S.checkLen,
      checkWidthLen: S.checkWidthLen,
      checkRad: S.checkRad
    });
    renderResults();
    App.switchTab('result');
  }

  function reasonOf(reasons, key) {
    return (reasons || []).filter(function (s) { return String(s).indexOf(key) >= 0; }).join('；');
  }

  function formatWidthSeq(r, v) {
    var seq = TE.extractWidthSeq(r);
    if (!seq || !seq.length) return '-';
    var text = seq.map(fmt).join(' → ');
    if (v && v.width) {
      var widthReason = reasonOf(v.reasons, '线宽') || '线宽组合不符合';
      return '<span class="badval" title="' + esc(widthReason) + '" data-tip="' + esc(widthReason) + '">' + esc(text) + '</span>';
    }
    return esc(text);
  }

  function formatWidthLens(r, v) {
    if (!r.widthLens || r.widthLens.size === 0) {
      if (r.widthsArr && r.widthsArr.length === 1 && !isNaN(r.length)) {
        return fmt(r.widthsArr[0]) + ': ' + fmt(r.length);
      }
      return '-';
    }
    var tol = (S.tol != null ? S.tol : 0.001) + 1e-9;
    var entries = Array.from(r.widthLens.entries()).sort(function (a, b) { return a[0] - b[0]; });
    return entries.map(function (kv) {
      var w = kv[0], l = kv[1];
      var isBad = v && v.badWidthLens && v.badWidthLens.some(function (bw) { return Math.abs(bw - w) <= tol; });
      var text = fmt(w) + ': ' + fmt(l);
      if (isBad) {
        var rsn = reasonOf(v.reasons, '指定线宽 ' + fmt(w)) || reasonOf(v.reasons, '指定线宽');
        return '<span class="badval" title="' + esc(rsn) + '" data-tip="' + esc(rsn) + '">' + text + '</span>';
      }
      return text;
    }).join(', ');
  }

  function markNums(arr, bads) {
    if (!arr || !arr.length) return '-';
    var tol = (S.tol != null ? S.tol : 0.001) + 1e-9;
    return arr.map(function (v) {
      var bad = bads && bads.some(function (b) { return Math.abs(b - v) <= tol; });
      return bad ? '<span class="badval">' + fmt(v) + '</span>' : fmt(v);
    }).join(', ');
  }

  function countLayer(layer) {
    var fail = 0, pass = 0, none = 0, total = 0;
    S.records.forEach(function (r) {
      if ((r.layer || '无层') !== layer) return;
      total++;
      var s = recStatus(r).st;
      if (s === 'fail') fail++;
      else if (s === 'pass') pass++;
      else none++;
    });
    return { fail: fail, pass: pass, none: none, total: total };
  }

  function updateTraceRevHint() {
    var el = $('traceRevHint');
    if (!el) return;
    var count = S.traceReviewed ? S.traceReviewed.size : 0;
    el.textContent = count > 0 ? ('已复验 ' + count + ' 项') : '';
  }

  function updateDiffRevHint() {
    var el = $('diffRevHint');
    if (!el) return;
    var count = S.diffReviewed ? S.diffReviewed.size : 0;
    el.textContent = count > 0 ? ('已复验 ' + count + ' 项') : '';
  }

  function renderResults() {
    if (!S.checkRes) {
      $('resCards').innerHTML = '';
      $('resBanner').innerHTML = '';
      if ($('resLayerNav')) $('resLayerNav').innerHTML = '';
      $('resLayers').innerHTML = '<div class="card"><div class="hint">尚未执行检查，请在「③ 检查规则」中运行检查。</div></div>';
      return;
    }
    var st = S.checkRes.stats;
    var failOn = $('fltStatus').value === 'fail';
    if ($('fltNote')) {
      $('fltNote').textContent = failOn ? '当前仅显示不符合项；再次点击可恢复全部。' : '点击红色指标卡可快速筛选不符合项。';
    }
    $('resCards').innerHTML =
      '<div class="stat"><div class="v">' + st.nets + '</div><div class="t">网络总数</div></div>' +
      '<div class="stat ok"><div class="v">' + st.pass + '</div><div class="t">符合网络</div></div>' +
      '<div class="stat bad clickable' + (failOn && !$('fltLayer').value ? ' on' : '') + '" data-filter="fail" data-tip="点击切换仅显示不符合项"><div class="v">' + st.fail + '</div><div class="t">不符合网络</div></div>' +
      '<div class="stat"><div class="v">' + st.none + '</div><div class="t">未设规则网络</div></div>' +
      '<div class="stat bad clickable' + (failOn && !$('fltLayer').value ? ' on' : '') + '" data-filter="fail" data-tip="按网络 × 出线层统计的不符合条数"><div class="v">' + S.checkRes.recViol.size + '</div><div class="t">不符合记录数</div></div>';

    $('resBanner').innerHTML = st.none > 0
      ? '<div class="hint" style="background:var(--warn-bg);border:1px solid var(--warn-border);border-radius:8px;padding:10px 14px;margin-bottom:12px">' +
        st.none + ' 个网络处于「未检查」状态：所在层未配置有效判据。<button type="button" class="btn ghost small" id="btnQuickGen" style="margin-left:10px">按数据层生成规则行</button></div>'
      : '';
    if (st.none > 0) {
      $('btnQuickGen').onclick = function () {
        App.genLayerRules();
        App.switchTab('rules');
      };
    }

    var allLayers = Array.from(new Set(S.records.map(function (r) { return r.layer; }))).sort();
    var sel = $('fltLayer');
    var cur = sel.value;
    sel.innerHTML = '<option value="">全部</option>' + allLayers.map(function (l) { return '<option>' + esc(l) + '</option>'; }).join('');
    sel.value = allLayers.includes(cur) ? cur : '';

    var arr = currentFiltered();
    var groups = [];
    var gidx = new Map();
    arr.forEach(function (x) {
      var L = x.r.layer || '无层';
      if (!gidx.has(L)) {
        gidx.set(L, groups.length);
        groups.push({ layer: L, rows: [] });
      }
      groups[gidx.get(L)].rows.push(x);
    });
    groups.sort(function (a, b) { return a.layer < b.layer ? -1 : a.layer > b.layer ? 1 : 0; });

    $('resLayerNav').innerHTML = groups.map(function (g, i) {
      var f = g.rows.filter(function (x) { return x.v.st === 'fail'; }).length;
      return '<button type="button" class="btn ghost small" data-jump="' + i + '">' + esc(g.layer) + (f ? ' · ' + f + ' 不符合' : '') + '</button>';
    }).join('');

    if (!groups.length) {
      $('resLayers').innerHTML = '<div class="card"><div class="hint">无满足当前筛选条件的记录</div></div>';
      return;
    }

    var arrow = function (k) { return S.sort.col === k ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : ''; };
    var html = '';
    groups.forEach(function (g, i) {
      var lc = countLayer(g.layer);
      var layerFailOn = $('fltStatus').value === 'fail' && $('fltLayer').value === g.layer;
      html +=
        '<div class="card layer-res" id="resLayer' + i + '"><h2>出线层 ' + esc(g.layer) +
        ' <span class="badge bad clickable' + (layerFailOn ? ' on' : '') + '" data-filter="fail" data-layer="' + esc(g.layer) + '" data-tip="点击仅看本层不符合项">不符合 ' + lc.fail + '</span>' +
        ' <span class="badge ok">通过 ' + lc.pass + '</span> <span class="badge na">未检查 ' + lc.none + '</span>' +
        ' <span class="small kv">' + (layerFailOn ? '当前显示 ' + g.rows.length + ' 条不符合 / 共 ' + lc.total + ' 个网络' : '共 ' + lc.total + ' 个网络') + '</span></h2>' +
        '<div class="tbl-wrap"><table class="layerTbl"><thead><tr>' +
        '<th>Item</th>' +
        '<th data-k="net" style="cursor:pointer">网络' + arrow('net') + '</th>' +
        '<th data-k="length" style="cursor:pointer">总线长 · ' + esc(S.unit) + arrow('length') + '</th>' +
        '<th data-k="widths" style="cursor:pointer">线宽组合变化顺序' + arrow('widths') + '</th>' +
        '<th>指定线宽线长 · ' + esc(S.unit) + '</th>' +
        '<th>直/弧段</th>' +
        '<th data-k="radius" style="cursor:pointer">弧半径' + arrow('radius') + '</th>' +
        '<th data-k="st" style="cursor:pointer">判定' + arrow('st') + '</th>' +
        '</tr></thead><tbody>';

      g.rows.forEach(function (x) {
        var r = x.r, v = x.v;
        var fullReason = v.st === 'fail' ? ('不符合原因：\n' + v.reasons.map(function (s) { return '• ' + s; }).join('\n')) : '';
        var rowAttrs = v.st === 'fail' ? (' title="' + esc(fullReason) + '" data-tip="' + esc(fullReason) + '"') : '';
        var badge = v.st === 'fail'
          ? '<span class="badge bad" title="' + esc(fullReason) + '" data-tip="' + esc(fullReason) + '">不符合</span>'
          : (v.st === 'pass'
            ? '<span class="badge ok">通过</span>'
            : '<span class="badge na" data-tip="该层未配置有效检查规则">未检查</span>');
        var rads = (r.radiiArr && r.radiiArr.length) ? r.radiiArr : (isNaN(r.minRadius) ? [] : [r.minRadius]);
        var lenReason = reasonOf(v.reasons, '总线长') || reasonOf(v.reasons, '线长缺失') || reasonOf(v.reasons, '线长');
        var widthReason = reasonOf(v.reasons, '线宽');
        var widthLenReason = reasonOf(v.reasons, '指定线宽');
        var radReason = reasonOf(v.reasons, '弧半径');

        var traceKey = (r.item || r.line || '') + '__' + r.net + '__' + r.layer;
        var isTraceRev = (v.st === 'fail') && S.traceReviewed && S.traceReviewed.has(traceKey);
        var traceChkBoxHtml = (v.st === 'fail')
          ? '<label class="rev-chk-wrap" data-tip="勾选复验后整行置灰"><input type="checkbox" class="chk-trace-rev" data-k="' + esc(traceKey) + '"' + (isTraceRev ? ' checked' : '') + '> 复验</label>'
          : '';

        html +=
          '<tr class="' + (v.st === 'fail' ? 'fail ' : '') + (isTraceRev ? 'reviewed ' : '') + '"' + rowAttrs + '>' +
          '<td class="kv">' + esc(r.item || r.line || '') + '</td>' +
          '<td><b>' + esc(r.net) + '</b></td>' +
          '<td class="mono' + (v.length ? ' badcell' : '') + '"' + (lenReason ? ' title="' + esc(lenReason) + '" data-tip="' + esc(lenReason) + '"' : '') + '>' + fmt(r.length) + '</td>' +
          '<td class="mono' + (v.width ? ' badcell' : '') + '"' + (widthReason ? ' title="' + esc(widthReason) + '" data-tip="' + esc(widthReason) + '"' : '') + '>' + formatWidthSeq(r, v) + '</td>' +
          '<td class="mono' + (v.widthLen ? ' badcell' : '') + '"' + (widthLenReason ? ' title="' + esc(widthLenReason) + '" data-tip="' + esc(widthLenReason) + '"' : '') + '>' + formatWidthLens(r, v) + '</td>' +
          '<td>' + (r.segCount || 0) + '/' + (r.arcCount || 0) + '</td>' +
          '<td class="mono' + (v.radius ? ' badcell' : '') + '"' + (radReason ? ' title="' + esc(radReason) + '" data-tip="' + esc(radReason) + '"' : '') + '>' + markNums(rads, v.badRadii) + '</td>' +
          '<td>' + traceChkBoxHtml + badge + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div></div>';
    });
    $('resLayers').innerHTML = html;
    updateTraceRevHint();
  }

  function runDiff() {
    if (typeof App.runDiff === "function") return App.runDiff();
  }

  Object.assign(App, {
    emptyStatus: emptyStatus,
    checkOpts: checkOpts,
    recStatus: recStatus,
    currentFiltered: currentFiltered,
    runCheck: runCheck,
    updateTraceRevHint: updateTraceRevHint,
    updateDiffRevHint: updateDiffRevHint,
    renderResults: renderResults
  });

  root.runCheck = runCheck;
})(typeof window !== "undefined" ? window : globalThis);
