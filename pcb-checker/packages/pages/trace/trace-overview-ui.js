/* ============================================================================
 * trace-overview-ui.js —— 走线检查模块概览统计与分层明细渲染
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

  function distStr(map, limit) {
    var arr = Array.from(map.entries()).sort(function (a, b) { return a[0] - b[0]; });
    var L = limit || 12;
    return arr.slice(0, L).map(function (kv) { return fmt(kv[0]) + '×' + kv[1]; }).join('，') +
      (arr.length > L ? ' …等' + arr.length + '种' : '');
  }

  function renderOvDetail(ls) {
    var box = $('ovDetail');
    if (!S.ovOpenLayer) {
      box.innerHTML = '';
      return;
    }
    var e = ls.find(function (x) { return x.layer === S.ovOpenLayer; });
    if (!e) {
      box.innerHTML = '';
      return;
    }
    var lens = Array.from(e.lens.entries()).sort(function (a, b) { return a[0] - b[0]; });
    var ws = Array.from(e.widths.entries()).sort(function (a, b) { return a[0] - b[0]; });
    box.innerHTML =
      '<h3>层「' + esc(e.layer) + '」明细　<span class="small kv" data-tip="按各线段统计的线宽频次">线宽分布：' +
      esc(ws.map(function (kv) { return fmt(kv[0]) + '×' + kv[1]; }).join('，')) + '</span></h3>' +
      '<div class="detail-list mono">网络线长 · ' + esc(S.unit) + ' × 记录数：<br>' +
      (lens.length ? lens.map(function (kv) { return fmt(kv[0]) + ' ×' + kv[1]; }).join('　|　') : '无') +
      '</div>';
  }

  function renderOverview() {
    var ls = TE.layerStats(S.records);
    var nets = new Set(S.records.map(function (r) { return r.net; }));
    var totalLen = S.records.reduce(function (a, r) { return a + (isNaN(r.length) ? 0 : r.length); }, 0);
    var arcTotal = ls.reduce(function (a, e) { return a + e.arcSegs; }, 0);
    var decl = (S.meta && S.meta.declared != null) ? S.meta.declared : '-';
    var warnCls = (S.meta && S.meta.declared != null && S.meta.declared !== S.records.length) ? ' warn' : '';

    $('ovCards').innerHTML =
      '<div class="stat' + warnCls + '"><div class="v">' + decl + '</div><div class="t">TXT 声明 Item 总数</div></div>' +
      '<div class="stat" data-tip="按网络 × 出线层拆分后的有效走线记录条数"><div class="v">' + S.records.length + '</div><div class="t">走线记录数</div></div>' +
      '<div class="stat"><div class="v">' + nets.size + '</div><div class="t">网络数</div></div>' +
      '<div class="stat"><div class="v">' + ls.length + '</div><div class="t">层数</div></div>' +
      '<div class="stat"><div class="v">' + fmt(totalLen) + '</div><div class="t">总线长 · ' + esc(S.unit) + '</div></div>' +
      '<div class="stat"><div class="v">' + arcTotal + '</div><div class="t">弧线段数</div></div>';

    var h =
      '<thead><tr>' +
      '<th data-tip="对应报告中的 Subset 字段">出线层</th>' +
      '<th>网络×层数</th>' +
      '<th>网络数</th>' +
      '<th>总长 · ' + esc(S.unit) + '</th>' +
      '<th data-tip="按各线段统计不同线宽出现次数">线宽分布 · ' + esc(S.unit) + '</th>' +
      '<th>线长种类</th>' +
      '<th>线长范围 · ' + esc(S.unit) + '</th>' +
      '<th>最小弧半径</th>' +
      '</tr></thead><tbody>';

    ls.forEach(function (e) {
      var lens = Array.from(e.lens.keys()).sort(function (a, b) { return a - b; });
      h +=
        '<tr style="cursor:pointer" data-layer="' + esc(e.layer) + '" data-tip="点击展开或收起该层线宽与线长分布明细">' +
        '<td><b>' + esc(e.layer) + '</b></td>' +
        '<td>' + e.recs + '</td>' +
        '<td>' + e.nets.size + '</td>' +
        '<td>' + fmt(e.totalLen) + '</td>' +
        '<td>' + esc(distStr(e.widths, 10)) + '</td>' +
        '<td>' + e.lens.size + '</td>' +
        '<td>' + (lens.length ? fmt(lens[0]) + ' ~ ' + fmt(lens[lens.length - 1]) : '-') + '</td>' +
        '<td class="mono">' + fmt(e.minRadius) + '</td>' +
        '</tr>';
    });

    var tbl = $('ovLayerTbl');
    tbl.innerHTML = h + '</tbody>';
    tbl.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.onclick = function () {
        S.ovOpenLayer = (S.ovOpenLayer === tr.dataset.layer) ? null : tr.dataset.layer;
        renderOvDetail(ls);
      };
    });
    renderOvDetail(ls);
  }

  Object.assign(App, {
    distStr: distStr,
    renderOverview: renderOverview,
    renderOvDetail: renderOvDetail
  });
})(typeof window !== 'undefined' ? window : globalThis);
