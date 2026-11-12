/* ============================================================================
 * dfm-results-ui.js —— DFM 加工能力检查：结果聚合/对偶表、孔盘间距表、规律分析与 CSV 导出
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var App = root.DfmApp;
  var $ = App.$;
  var escHtml = App.escHtml;
  var State = App.State;
  var NET_COLORS = App.NET_COLORS;

  var PAD_SHAPE_LABEL = { circle: '圆形', oblong: '长圆', roundrect: '圆角矩形', rect: '矩形' };
  function padShapeNote(p) {
    var sh = p && p.via && p.via.padShape;
    if (!sh || !sh.kind || sh.kind === 'circle') return '';
    var w = Number(sh.w || 0).toFixed(2), h = Number(sh.h || 0).toFixed(2);
    var corner = sh.corner ? (' R' + Number(sh.corner).toFixed(2)) : '';
    var rot = sh.rot ? (' ' + Number(sh.rot).toFixed(1) + '°') : '';
    return '<br><span style="color:#2563eb">' + (PAD_SHAPE_LABEL[sh.kind] || sh.kind) + ' ' + w + '×' + h + corner + rot + '</span>';
  }

  function renderPadPairResults() {
    var card = $('padPairCard');
    if (!card) return;
    var r = State.checkResult;
    var pp = (r && r.padPairStats) || { enabled: false, total: 0, fail: 0, pass: 0, minDist: 0, threshold: 0 };
    if ($('statPadPairBadCount')) {
      $('statPadPairBadCount').textContent = pp.enabled
        ? (pp.fail.toLocaleString() + ' / ' + pp.total.toLocaleString())
        : '未启用';
    }
    if (!pp.enabled) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    var defects = (r && r.padPairDefects) || [];
    var shown = defects.slice(0, 200);
    if ($('padPairHint')) {
      $('padPairHint').textContent = '阈值 ' + pp.threshold + ' mil ｜ 共核对 ' + pp.total.toLocaleString() +
        ' 对 GND 孔盘 × 信号孔盘，不满足 ' + pp.fail + ' 对、满足 ' + pp.pass.toLocaleString() +
        ' 对，最小实测 ' + pp.minDist.toFixed(3) + ' mil' +
        (defects.length > shown.length ? (' ｜ 仅列间距最小的 ' + shown.length + ' 对') : '');
    }
    var body = $('padPairBody');
    if (!body) return;
    if (!shown.length) {
      body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--ok);padding:20px">全部满足，无孔盘到孔盘间距超标对偶</td></tr>';
      return;
    }
    body.innerHTML = shown.map(function (d, i) {
      var g = d.gndVia, sg = d.sigVia;
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>#' + escHtml(String(g.id)) + ' · ' + escHtml(g.net || '未命名网络') + ' · ' + escHtml(d.spanGnd || g.viaTypeLabel || '通孔') + '</td>' +
        '<td>#' + escHtml(String(sg.id)) + ' · ' + escHtml(sg.net || '未命名网络') + ' · ' + escHtml(d.spanSig || sg.viaTypeLabel || '通孔') + '</td>' +
        '<td>' + d.centerDist.toFixed(3) + '</td>' +
        '<td class="bad">' + d.padAirgap.toFixed(3) + '</td>' +
        '<td>' + d.threshold + '</td>' +
        '<td class="bad">' + d.diff.toFixed(3) + '</td>' +
        '<td>' + d.gndPadDiameter.toFixed(3) + ' / ' + d.sigPadDiameter.toFixed(3) + '</td></tr>';
    }).join('');
  }

  function renderNetGroupView() {
    var r = State.checkResult;
    var tbody = $('netGroupTableBody');
    if (!tbody) return;
    if (!r || !r.netLayerAnalysis || !r.netLayerAnalysis.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--sub);padding:24px">暂无走线网络聚合结果</td></tr>';
      return;
    }

    var query = (State.searchQuery || '').toLowerCase().trim();
    var filter = State.activeFilter;
    var filteredNets = r.netLayerAnalysis.filter(function (item) {
      if (filter === 'bad' && item.failCount === 0) return false;
      if (filter === 'ok' && item.failCount > 0) return false;
      if (filter === 'gnd' && item.gndFailCount === 0) return false;
      if (filter === 'signal' && item.signalFailCount === 0) return false;
      if (query) {
        var qText = (item.layer + ' ' + item.net).toLowerCase();
        var matchVia = item.uniqueViaIds && item.uniqueViaIds.some(function (id) { return ('via ' + id + ' ' + id).toLowerCase().indexOf(query) >= 0; });
        if (qText.indexOf(query) < 0 && !matchVia) return false;
      }
      return true;
    });

    if (!filteredNets.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--sub);padding:24px">未找到符合当前筛选条件的走线网络</td></tr>';
      return;
    }

    var html = '';
    filteredNets.forEach(function (item, idx) {
      var isBad = item.failCount > 0;
      var rowKey = item.layer + '___' + item.net;
      var isExpanded = !!State.expandedNetKeys[rowKey];
      var netColor = NET_COLORS[item.net] || '#38bdf8';

      var failSummaryBadge = isBad
        ? ('<span class="tag-badge bad">存在 <b>' + item.failCount + '</b> 处不满足</span>' +
           '<div style="font-size:11px;color:var(--sub);margin-top:4px">到GND孔: <b>' + item.gndFailCount + '</b> 处 | 到信号孔: <b>' + item.signalFailCount + '</b> 处 · 涉及 <b>' + item.uniqueViaCount + '</b> 孔</div>')
        : '<span class="tag-badge ok">全部满足</span>';

      var viasSnippet = '<span style="color:var(--sub)">无冲突过孔</span>';
      if (item.uniqueViaIds && item.uniqueViaIds.length > 0) {
        var visibleIds = item.uniqueViaIds.slice(0, 6).map(function (id) {
          return '<span class="tag-badge" style="background:#f1f5f9;color:#374151;margin:1px 2px">Via ' + id + '</span>';
        }).join('');
        var moreCount = item.uniqueViaIds.length - 6;
        viasSnippet = visibleIds + (moreCount > 0 ? ('<span style="font-size:11px;color:var(--sub)"> 等共' + item.uniqueViaIds.length + '个</span>') : '');
      }

      var minClearanceHtml = item.minDist === Infinity ? '-' :
        ('<b style="color:' + (isBad ? 'var(--bad)' : 'var(--ok)') + ';font-size:13px;font-family:var(--mono)">' + item.minDist.toFixed(2) + ' mil</b>');
      var maxDevHtml = item.maxDeviation > 0
        ? ('<b style="color:var(--bad);font-family:var(--mono)">-' + item.maxDeviation.toFixed(2) + ' mil</b>')
        : '<span style="color:var(--ok);font-family:var(--mono)">0.00 mil</span>';

      html += '<tr class="' + (isBad ? 'fail-row' : '') + '">' +
        '<td style="font-weight:700">' + (idx + 1) + '</td>' +
        '<td><span class="tag-badge">' + escHtml(item.layer) + '</span></td>' +
        '<td><div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + netColor + '"></span><b>' + escHtml(item.net) + '</b></div></td>' +
        '<td style="font-family:var(--mono);font-size:11px"><b>' + item.traceSegments + '</b> 段 · ' + item.totalLength.toFixed(1) + ' mil</td>' +
        '<td>' + failSummaryBadge + '</td>' +
        '<td>' + minClearanceHtml + '</td>' +
        '<td>' + maxDevHtml + '</td>' +
        '<td>' + viasSnippet + '</td>' +
        '<td><div style="display:flex;gap:4px;flex-direction:column">' +
          (isBad ? ('<button type="button" class="btn sec small btn-toggle-net-defects" data-key="' + escHtml(rowKey) + '">' + (isExpanded ? '▲ 收起明细' : ('展开明细 · ' + item.failCount)) + '</button>') : '') +
          '<button type="button" class="btn pri small btn-locate-net-route" data-layer="' + escHtml(item.layer) + '" data-net="' + escHtml(item.net) + '">画布高亮</button>' +
        '</div></td></tr>';

      if (isBad && isExpanded) {
        var defectRows = item.defects.map(function (p, dIdx) {
          var pKey = p.via.id + '_' + p.trace.id;
          var isRev = !!State.reviewedKeys[pKey];
          return '<tr class="' + (isRev ? 'reviewed' : '') + '" style="background:#fff">' +
            '<td>' + (dIdx + 1) + '</td>' +
            '<td><b>Via ' + p.via.id + '</b> · ' + escHtml(p.via.net) + ' · ' + escHtml(p.via.spanLabel || '通孔') + '</td>' +
            '<td>' + escHtml(p.targetType) + '</td>' +
            '<td>Trace ' + p.trace.id + ' · ' + p.trace.width + ' mil</td>' +
            '<td style="font-family:var(--mono)">[' + p.proj[0].toFixed(1) + ', ' + p.proj[1].toFixed(1) + ']</td>' +
            '<td><b class="tag-badge bad">' + p.evalDist.toFixed(2) + ' mil</b></td>' +
            '<td>≥ ' + p.threshold.toFixed(2) + ' mil</td>' +
            '<td style="color:var(--bad);font-weight:700">' + p.diff.toFixed(2) + ' mil</td>' +
            '<td><button type="button" class="btn sec small btn-locate" data-via="' + p.via.id + '" data-trace="' + p.trace.id + '">定位图</button></td></tr>';
        }).join('');

        html += '<tr style="background:#f8fafc"><td colspan="9" style="padding:10px 16px">' +
          '<div style="background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:8px 12px">' +
            '<table class="net-defects-table"><thead><tr><th>序号</th><th>冲突过孔</th><th>判定类型</th><th>走线段</th><th>最近点坐标</th><th>实测间距</th><th>规则阈值</th><th>偏差值</th><th>操作</th></tr></thead>' +
            '<tbody>' + defectRows + '</tbody></table></div></td></tr>';
      }
    });

    tbody.innerHTML = html;

    tbody.querySelectorAll('.btn-toggle-net-defects').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var k = btn.dataset.key;
        State.expandedNetKeys[k] = !State.expandedNetKeys[k];
        renderNetGroupView();
      });
    });
    tbody.querySelectorAll('.btn-locate-net-route').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (root.locateNetRoute) root.locateNetRoute(btn.dataset.layer, btn.dataset.net);
      });
    });
    tbody.querySelectorAll('.btn-locate').forEach(function (b) {
      b.addEventListener('click', function () {
        if (root.locateInCanvas) root.locateInCanvas(parseInt(b.dataset.via, 10), parseInt(b.dataset.trace, 10));
      });
    });
  }

  function renderPairListView() {
    var r = State.checkResult;
    if (!r) return;
    var query = (State.searchQuery || '').toLowerCase().trim();
    var filter = State.activeFilter;

    var filteredPairs = r.pairs.filter(function (p) {
      if (filter === 'bad' && p.status !== '不满足') return false;
      if (filter === 'ok' && p.status !== '满足') return false;
      if (filter === 'gnd' && !p.isGndVia) return false;
      if (filter === 'signal' && p.isGndVia) return false;
      if (query) {
        var qNorm = query.replace(/^via\s*/i, '').trim();
        var qText = ('via ' + p.via.id + ' ' + p.via.id + ' ' + p.via.net + ' ' + (p.via.spanLabel || '') + ' ' + (p.via.definedRaw || '') + ' ' + p.targetType + ' trace ' + p.trace.id + ' ' + p.trace.id + ' ' + p.trace.subset + ' ' + p.trace.net).toLowerCase();
        if (qText.indexOf(query) < 0 && qText.indexOf(qNorm) < 0) return false;
      }
      return true;
    });

    var totalRecords = filteredPairs.length;
    if (!totalRecords) {
      $('resTableBody').innerHTML = '<tr><td colspan="13" style="text-align:center;color:var(--sub);padding:24px">未找到符合当前筛选条件的记录</td></tr>';
      if ($('pageInfo')) $('pageInfo').textContent = '显示 0 / 0 条记录';
      if ($('pageCurrent')) $('pageCurrent').textContent = '第 1 / 1 页';
      return;
    }

    var pageSize = State.pageSize === 'all' ? totalRecords : (parseInt(State.pageSize, 10) || 50);
    var totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
    if (State.currentPage > totalPages) State.currentPage = totalPages;
    if (State.currentPage < 1) State.currentPage = 1;

    var startIndex = (State.currentPage - 1) * pageSize;
    var endIndex = Math.min(totalRecords, startIndex + pageSize);
    var pageItems = filteredPairs.slice(startIndex, endIndex);

    if ($('pageInfo')) $('pageInfo').textContent = '显示第 ' + (startIndex + 1) + ' - ' + endIndex + ' 条，共 ' + totalRecords.toLocaleString() + ' 条记录';
    if ($('pageCurrent')) $('pageCurrent').textContent = '第 ' + State.currentPage + ' / ' + totalPages + ' 页';
    if ($('btnFirstPage')) $('btnFirstPage').disabled = State.currentPage <= 1;
    if ($('btnPrevPage')) $('btnPrevPage').disabled = State.currentPage <= 1;
    if ($('btnNextPage')) $('btnNextPage').disabled = State.currentPage >= totalPages;
    if ($('btnLastPage')) $('btnLastPage').disabled = State.currentPage >= totalPages;

    var tbody = $('resTableBody');
    tbody.innerHTML = pageItems.map(function (p, pIdx) {
      var idx = startIndex + pIdx;
      var isBad = (p.status === '不满足');
      var pKey = p.via.id + '_' + p.trace.id;
      var isRev = !!State.reviewedKeys[pKey];
      var diffStr = (p.diff >= 0 ? '+' : '') + p.diff.toFixed(2) + ' mil';
      var isGnd = p.isGndVia;
      var advice = isBad
        ? ('间距偏小 ' + Math.abs(p.diff).toFixed(2) + ' mil，建议走线外扩 ≥ ' + Math.ceil(Math.abs(p.diff) + 0.2) + ' mil')
        : '满足工艺能力';
      var typeBadge = isGnd
        ? '<span class="tag-badge">线到GND孔</span>'
        : '<span class="tag-badge info">线到信号孔</span>';
      var spanBadge = '<span class="tag-badge" style="font-size:11px;margin-top:2px" data-tip="Padstack Defined: ' + escHtml(p.via.definedRaw || 'Top to Bottom') + '">' + escHtml(p.via.spanLabel || '通孔') + '</span>';

      return '<tr class="' + (isBad ? 'fail-row' : '') + ' ' + (isRev ? 'reviewed' : '') + '" id="row-' + idx + '" data-via="' + p.via.id + '" data-trace="' + p.trace.id + '">' +
        '<td>' + (idx + 1) + '</td>' +
        '<td><input type="checkbox" class="ck-rev" data-no-persist data-key="' + pKey + '" ' + (isRev ? 'checked' : '') + '></td>' +
        '<td><span class="tag-badge ' + (isBad ? 'bad' : 'ok') + '">' + p.status + '</span></td>' +
        '<td>' + typeBadge + '</td>' +
        '<td><b>Via ' + p.via.id + '</b> · ' + escHtml(p.via.net) + '<br>' + spanBadge + '<br><span style="font-family:var(--mono);font-size:11px;color:var(--sub)">[' + p.via.origin[0].toFixed(2) + ', ' + p.via.origin[1].toFixed(2) + ']</span></td>' +
        '<td><b>Trace ' + p.trace.id + '</b> · ' + escHtml(p.trace.subset) + ' / ' + escHtml(p.trace.net) + '<br><span style="font-size:11px;color:var(--sub)">线宽: ' + p.trace.width + ' mil · ' + p.trace.kind + '</span></td>' +
        '<td style="font-family:var(--mono);font-size:11px">[' + p.proj[0].toFixed(2) + ', ' + p.proj[1].toFixed(2) + ']</td>' +
        '<td><b class="tag-badge ' + (isBad ? 'bad' : 'ok') + '">' + p.evalDist.toFixed(2) + ' mil</b><div style="font-size:11px;color:var(--sub);margin-top:3px;font-family:var(--mono)">焊盘: <b>' + p.padEdgeDist.toFixed(2) + '</b> | 一钻: <b>' + p.drillEdgeDist.toFixed(2) + '</b></div></td>' +
        '<td><b>≥ ' + p.threshold.toFixed(2) + ' mil</b></td>' +
        '<td style="font-family:var(--mono);font-weight:700;color:' + (isBad ? 'var(--bad)' : 'var(--ok)') + '">' + diffStr + '</td>' +
        '<td style="font-family:var(--mono);font-size:11px;color:var(--sub)">一钻: ' + p.via.firstDrill.toFixed(2) + ' mil<br>焊盘: ' + (p.via.padDiameter || p.via.padRadius * 2).toFixed(2) + ' mil' + padShapeNote(p) + '</td>' +
        '<td style="font-size:11px;color:#374151">' + advice + '</td>' +
        '<td><button type="button" class="btn sec small btn-locate" data-via="' + p.via.id + '" data-trace="' + p.trace.id + '">定位图</button></td></tr>';
    }).join('');

    tbody.querySelectorAll('.ck-rev').forEach(function (ck) {
      var onToggle = function (e) {
        State.reviewedKeys[e.target.dataset.key] = e.target.checked;
        renderResults();
      };
      ck.addEventListener('change', onToggle);
      ck.addEventListener('click', onToggle);
    });
    tbody.querySelectorAll('.btn-locate').forEach(function (b) {
      b.addEventListener('click', function () {
        if (root.locateInCanvas) root.locateInCanvas(parseInt(b.dataset.via, 10), parseInt(b.dataset.trace, 10));
      });
    });
  }

  function renderResults() {
    var r = State.checkResult;
    if (!r) {
      if ($('statBadCount')) $('statBadCount').textContent = '0';
      if ($('statGndBadCount')) $('statGndBadCount').textContent = '0 / 0';
      if ($('statSigBadCount')) $('statSigBadCount').textContent = '0 / 0';
      if ($('statPassCount')) $('statPassCount').textContent = '0';
      if ($('statTotalCount')) $('statTotalCount').textContent = '0';
      if ($('statMinDist')) $('statMinDist').textContent = '0.00';
      if ($('netGroupTableBody')) $('netGroupTableBody').innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--sub);padding:24px">暂无走线网络聚合结果</td></tr>';
      if ($('resTableBody')) $('resTableBody').innerHTML = '<tr><td colspan="13" style="text-align:center;color:var(--sub);padding:24px">暂无检查结果</td></tr>';
      if ($('pageInfo')) $('pageInfo').textContent = '显示 0 / 0 条记录';
      if ($('pageCurrent')) $('pageCurrent').textContent = '第 1 / 1 页';
      if ($('statPadPairBadCount')) $('statPadPairBadCount').textContent = '未启用';
      if ($('padPairCard')) $('padPairCard').style.display = 'none';
      return;
    }

    $('statBadCount').textContent = r.failCount.toLocaleString();
    if ($('statGndBadCount')) $('statGndBadCount').textContent = r.gndStats.fail.toLocaleString() + ' / ' + r.gndStats.total.toLocaleString();
    if ($('statSigBadCount')) $('statSigBadCount').textContent = r.signalStats.fail.toLocaleString() + ' / ' + r.signalStats.total.toLocaleString();
    $('statPassCount').textContent = r.passCount.toLocaleString();
    $('statTotalCount').textContent = r.totalChecked.toLocaleString();
    $('statMinDist').textContent = r.minObservedDist.toFixed(2);

    renderNetGroupView();
    renderPairListView();
    renderPadPairResults();
  }

  /* ---------- 规律分析 UI ---------- */
  var PatternState = {
    object: 'via',
    viaKind: 'all',
    dimension: 'layer',
    sortBy: 'failCount',
    topN: 10,
    last: null
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

  function exportDfmCsv() {
    if (!State.checkResult || !State.checkResult.pairs.length) { alert('暂无检查数据'); return; }
    var headers = ['序号,状态,判定类型,过孔编号,过孔网络,过孔跨层类型,过孔连接起止层,过孔X,过孔Y,走线编号,走线层,走线网络,走线线宽,走线最近点X,走线最近点Y,实测间距(mil),规则要求(mil),偏差(mil),一钻孔径(mil),焊盘直径(mil)'];
    var rows = State.checkResult.pairs.map(function (p, idx) {
      return [
        idx + 1, p.status, '"' + p.targetType + '"', p.via.id, '"' + p.via.net + '"',
        '"' + (p.via.viaTypeLabel || '通孔') + '"', '"' + (p.via.definedRaw || 'Top to Bottom') + '"',
        p.via.origin[0], p.via.origin[1], p.trace.id, '"' + p.trace.subset + '"', '"' + p.trace.net + '"',
        p.trace.width, p.proj[0].toFixed(4), p.proj[1].toFixed(4), p.evalDist.toFixed(4),
        p.threshold.toFixed(2), p.diff.toFixed(4), p.via.firstDrill.toFixed(2),
        (p.via.padDiameter || p.via.padRadius * 2).toFixed(2)
      ].join(',');
    });
    var ppDefects = State.checkResult.padPairDefects || [];
    var ppStats = State.checkResult.padPairStats || { enabled: false };
    if (ppStats.enabled && ppDefects.length) {
      rows.push('');
      rows.push('"GND 孔盘到信号孔盘间距（阈值 ' + ppStats.threshold + ' mil，共 ' + ppDefects.length + ' 对不满足）"');
      rows.push('序号,GND孔号,GND网络,GND跨层,信号孔号,信号网络,信号跨层,中心距(mil),孔盘间距实测(mil),规则阈值(mil),亏欠(mil),GND焊盘直径(mil),信号焊盘直径(mil)');
      ppDefects.forEach(function (d, i) {
        rows.push([
          i + 1, d.gndVia.id, '"' + d.gndVia.net + '"', '"' + (d.spanGnd || d.gndVia.viaTypeLabel || '通孔') + '"',
          d.sigVia.id, '"' + d.sigVia.net + '"', '"' + (d.spanSig || d.sigVia.viaTypeLabel || '通孔') + '"',
          d.centerDist.toFixed(4), d.padAirgap.toFixed(4), d.threshold.toFixed(2), d.diff.toFixed(4),
          d.gndPadDiameter.toFixed(2), d.sigPadDiameter.toFixed(2)
        ].join(','));
      });
    }
    var blob = new Blob(['\uFEFF' + headers.concat(rows).join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'PCB_加工能力间距检查报告_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  }

  function bindResultsEvents() {
    if ($('btnViewNetGroup')) {
      $('btnViewNetGroup').addEventListener('click', function () {
        State.resViewMode = 'net_group';
        $('btnViewNetGroup').className = 'btn pri';
        $('btnViewPairList').className = 'btn sec';
        $('netGroupViewContainer').style.display = 'block';
        $('pairListViewContainer').style.display = 'none';
        if ($('viewModeHint')) $('viewModeHint').textContent = '以出线层走线网络为目标汇总超标处数';
        renderNetGroupView();
      });
    }
    if ($('btnViewPairList')) {
      $('btnViewPairList').addEventListener('click', function () {
        State.resViewMode = 'pair_list';
        $('btnViewNetGroup').className = 'btn sec';
        $('btnViewPairList').className = 'btn pri';
        $('netGroupViewContainer').style.display = 'none';
        $('pairListViewContainer').style.display = 'block';
        if ($('viewModeHint')) $('viewModeHint').textContent = '逐条查看过孔与走线对偶坐标、实测间距与偏差';
        renderPairListView();
      });
    }

    if ($('selPageSize')) $('selPageSize').addEventListener('change', function (e) { State.pageSize = e.target.value; State.currentPage = 1; renderResults(); });
    if ($('btnFirstPage')) $('btnFirstPage').addEventListener('click', function () { State.currentPage = 1; renderResults(); });
    if ($('btnPrevPage')) $('btnPrevPage').addEventListener('click', function () { if (State.currentPage > 1) { State.currentPage--; renderResults(); } });
    if ($('btnNextPage')) $('btnNextPage').addEventListener('click', function () { State.currentPage++; renderResults(); });
    if ($('btnLastPage')) $('btnLastPage').addEventListener('click', function () { State.currentPage = 999999; renderResults(); });

    if ($('btnFilterAll')) $('btnFilterAll').addEventListener('click', function () { State.activeFilter = 'all'; renderResults(); });
    if ($('btnFilterBad')) $('btnFilterBad').addEventListener('click', function () { State.activeFilter = 'bad'; renderResults(); });
    if ($('btnFilterGnd')) $('btnFilterGnd').addEventListener('click', function () { State.activeFilter = 'gnd'; renderResults(); });
    if ($('btnFilterSig')) $('btnFilterSig').addEventListener('click', function () { State.activeFilter = 'signal'; renderResults(); });
    if ($('btnFilterOk')) $('btnFilterOk').addEventListener('click', function () { State.activeFilter = 'ok'; renderResults(); });
    document.querySelectorAll('#resStatsGrid .stat-box').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.filter) { State.activeFilter = b.dataset.filter; renderResults(); }
      });
    });
    if ($('inpSearch')) {
      $('inpSearch').addEventListener('input', function (e) {
        State.searchQuery = e.target.value;
        renderResults();
      });
    }
    if ($('btnExportCsv')) $('btnExportCsv').addEventListener('click', exportDfmCsv);
    if ($('dockDfmExport')) $('dockDfmExport').addEventListener('click', exportDfmCsv);

    ['btnPatObjVia', 'btnPatObjTrace'].forEach(function (id) {
      var btn = $(id);
      if (btn) btn.addEventListener('click', function () {
        PatternState.object = btn.dataset.obj;
        syncPatDimOptions();
        renderPatternAnalysis();
      });
    });
    if ($('selPatViaKind')) $('selPatViaKind').addEventListener('change', function (e) { PatternState.viaKind = e.target.value; renderPatternAnalysis(); });
    if ($('selPatDim')) $('selPatDim').addEventListener('change', function (e) { PatternState.dimension = e.target.value; renderPatternAnalysis(); });
    if ($('selPatSort')) $('selPatSort').addEventListener('change', function (e) { PatternState.sortBy = e.target.value; renderPatternAnalysis(); });
    if ($('selPatTopN')) $('selPatTopN').addEventListener('change', function (e) { PatternState.topN = parseInt(e.target.value, 10) || 0; renderPatternAnalysis(); });
    if ($('btnPatRefresh')) $('btnPatRefresh').addEventListener('click', renderPatternAnalysis);
    if ($('btnPatExport')) $('btnPatExport').addEventListener('click', exportPatternCsv);
    syncPatDimOptions();
  }

  root.renderResults = renderResults;
  root.renderNetGroupView = renderNetGroupView;
  root.renderPairListView = renderPairListView;
  root.renderPadPairResults = renderPadPairResults;
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

  bindResultsEvents();
})(typeof window !== 'undefined' ? window : globalThis);
