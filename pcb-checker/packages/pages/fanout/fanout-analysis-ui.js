/* ============================================================================
 * fanout-analysis-ui.js —— 扇出方案检查模块：⑤ 规律分析与差分扇出归纳导出
 * ========================================================================== */
(function (root) {
  "use strict";

  var State = root.State;
  var escapeHtml = root.escHtml || function (s) { return String(s == null ? "" : s); };

  /* ---------- Tab 5: 方案覆盖率与差分规律分析 ---------- */
  function getDiffAnalysisData() {
    if (!State.clusters || !State.clusters.length) return [];
    return State.clusters.map(function (c, idx) {
      var res = c.matchResult || {};
      var sigVias = c.signalVias || [];
      var sigIds = sigVias.map(function (v) { return '#' + v.id; }).join(', ');
      var isReviewed = State.reviewedClusters.has(c.id);
      var isPass = isReviewed ? true : !!res.pass;

      var padSignalCount = 0, padGndCount = 0;
      if (!isReviewed && res.padMismatchList && res.padMismatchList.length > 0) {
        res.padMismatchList.forEach(function (pm) {
          if (pm.net && pm.net.toUpperCase().indexOf('GND') < 0) padSignalCount++;
          else padGndCount++;
        });
      }

      var posSignalCount = 0, posGndCount = 0;
      if (!isReviewed && res.missingVias && res.missingVias.length > 0) {
        res.missingVias.forEach(function (mv) {
          if (mv.net && mv.net.toUpperCase().indexOf('GND') < 0) posSignalCount++;
          else posGndCount++;
        });
      }

      var padErrorText = '无';
      if (!isReviewed && (padSignalCount > 0 || padGndCount > 0)) padErrorText = '信号孔 ' + padSignalCount + ' / GND孔 ' + padGndCount;
      else if (isReviewed && res.padMismatchList && res.padMismatchList.length > 0) padErrorText = '无 · 已复核';

      var posErrorText = '无';
      if (!isReviewed && (posSignalCount > 0 || posGndCount > 0)) posErrorText = '信号孔 ' + posSignalCount + ' / GND孔 ' + posGndCount;
      else if (isReviewed && res.missingVias && res.missingVias.length > 0) posErrorText = '无 · 已复核';

      return {
        index: idx + 1,
        clusterId: c.id,
        net: c.signalNet || ((sigVias[0] && sigVias[0].net) || 'UNKNOWN'),
        sigIds: sigIds || '-',
        schemeName: res.schemeName || '未匹配方案',
        isPass: isPass,
        isReviewed: isReviewed,
        status: isReviewed ? 'REVIEWED_PASS' : res.status,
        statusText: isReviewed ? '已复核通过' : (res.statusText || (isPass ? '匹配通过' : '未匹配')),
        hasAnyError: !isPass,
        hasPadError: !isReviewed && (padSignalCount > 0 || padGndCount > 0),
        hasPosError: !isReviewed && (posSignalCount > 0 || posGndCount > 0),
        padErrorText: padErrorText,
        posErrorText: posErrorText,
        advice: isReviewed ? '已复核确认' : (res.advice || res.message || '无需调整')
      };
    });
  }

  function renderDiffAnalysisTable() {
    var tbody = document.getElementById('tblDiffAnalysisBody');
    if (!tbody) return;
    var allData = getDiffAnalysisData();

    var setTxt = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = String(v); };
    setTxt('cntAnaFilterAll', allData.length);
    setTxt('cntAnaFilterPass', allData.filter(function (d) { return d.isPass; }).length);
    setTxt('cntAnaFilterPadstack', allData.filter(function (d) { return d.hasPadError; }).length);
    setTxt('cntAnaFilterPos', allData.filter(function (d) { return d.hasPosError; }).length);
    setTxt('cntAnaFilterFail', allData.filter(function (d) { return d.hasAnyError; }).length);

    if (!allData.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--sub)">暂无差分扇出分析数据</td></tr>';
      return;
    }

    var filtered = allData.filter(function (d) {
      if (State.analysisFilter === 'pass') return d.isPass;
      if (State.analysisFilter === 'padstack') return d.hasPadError;
      if (State.analysisFilter === 'pos') return d.hasPosError;
      if (State.analysisFilter === 'fail') return d.hasAnyError;
      return true;
    });
    if (State.analysisSearch) {
      var q = State.analysisSearch;
      filtered = filtered.filter(function (d) {
        return d.net.toLowerCase().indexOf(q) >= 0 || d.sigIds.toLowerCase().indexOf(q) >= 0 ||
          d.schemeName.toLowerCase().indexOf(q) >= 0 || d.advice.toLowerCase().indexOf(q) >= 0;
      });
    }

    var pageSize = State.analysisPageSize || 15;
    var totalItems = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    State.analysisPage = Math.max(1, Math.min(totalPages, State.analysisPage));
    var startIdx = (State.analysisPage - 1) * pageSize;
    var pageItems = filtered.slice(startIdx, startIdx + pageSize);

    setTxt('lblAnaPageStart', totalItems === 0 ? 0 : startIdx + 1);
    setTxt('lblAnaPageEnd', Math.min(totalItems, startIdx + pageItems.length));
    setTxt('lblAnaTotalCount', totalItems);
    setTxt('lblAnaCurrentPage', State.analysisPage + ' / ' + totalPages);

    if (!pageItems.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--sub)">未找到匹配的记录</td></tr>';
      return;
    }

    tbody.innerHTML = pageItems.map(function (d, pIdx) {
      var statusBadge = d.isReviewed
        ? '<span class="badge-tag ok">已复核</span>'
        : (d.isPass ? '<span class="badge-tag ok">匹配通过</span>' : '<span class="badge-tag bad">' + escapeHtml(d.statusText) + '</span>');
      return '<tr class="' + (d.isReviewed ? 'reviewed' : '') + '">' +
        '<td><strong>' + (startIdx + pIdx + 1) + '</strong></td>' +
        '<td style="text-align:center"><input type="checkbox" data-no-persist ' + (d.isReviewed ? 'checked' : '') + ' onchange="toggleReviewCluster(\'' + d.clusterId + '\', this.checked)"></td>' +
        '<td><b style="color:var(--pri);cursor:pointer" onclick="locateClusterInCanvas(\'' + d.clusterId + '\')">' + escapeHtml(d.net) + '</b></td>' +
        '<td style="font-family:var(--mono);font-size:12px">' + escapeHtml(d.sigIds) + '</td>' +
        '<td><b>' + escapeHtml(d.schemeName) + '</b></td>' +
        '<td>' + statusBadge + '</td>' +
        '<td style="color:' + (d.hasPadError ? 'var(--bad)' : 'var(--ok)') + ';font-weight:600">' + escapeHtml(d.padErrorText) + '</td>' +
        '<td style="color:' + (d.hasPosError ? 'var(--warn)' : 'var(--ok)') + ';font-weight:600">' + escapeHtml(d.posErrorText) + '</td>' +
        '<td style="font-size:12px;color:var(--sub)">' + escapeHtml(d.advice) + '</td>' +
        '<td><button type="button" class="btn small sec" onclick="locateClusterInCanvas(\'' + d.clusterId + '\')">定位</button></td></tr>';
    }).join('');
  }

  function renderAnalysisTab() {
    var pnlScheme = document.getElementById('pnlSchemeRanking');
    var pnlDefect = document.getElementById('pnlDefectRanking');
    if (!State.summary || !State.clusters.length) {
      if (pnlScheme) pnlScheme.innerHTML = '<div style="color:var(--sub)">尚无数据</div>';
      if (pnlDefect) pnlDefect.innerHTML = '<div style="color:var(--sub)">尚无数据</div>';
      return;
    }
    var cov = State.summary.schemeCoverage || {};
    var covEntries = Object.entries(cov).sort(function (a, b) { return b[1] - a[1]; });
    if (pnlScheme) {
      pnlScheme.innerHTML = covEntries.length
        ? covEntries.map(function (e) {
            return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9"><strong>' + escapeHtml(e[0]) + '</strong><span class="badge-tag ok">' + e[1] + ' 处匹配</span></div>';
          }).join('')
        : '<div style="color:var(--sub)">未匹配到任何方案库模板</div>';
    }
    var s = State.summary;
    if (pnlDefect) {
      pnlDefect.innerHTML =
        '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9"><span>Padstack 不符</span><span class="badge-tag bad">' + (s.padstackFailCount || 0) + ' 处</span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9"><span>中心距超差 / 伴随地孔缺失</span><span class="badge-tag warn">' + (s.distFailCount || 0) + ' 处</span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:6px 0"><span>未匹配方案库</span><span class="badge-tag bad">' + (s.noMatchCount || 0) + ' 处</span></div>';
    }
    renderDiffAnalysisTable();
  }

  function setAnalysisFilter(filterType) {
    State.analysisFilter = filterType;
    State.analysisPage = 1;
    var btnMap = { all: 'btnAnaFilterAll', pass: 'btnAnaFilterPass', padstack: 'btnAnaFilterPadstack', pos: 'btnAnaFilterPos', fail: 'btnAnaFilterFail' };
    Object.keys(btnMap).forEach(function (k) {
      var el = document.getElementById(btnMap[k]);
      if (el) el.className = (k === filterType) ? 'btn small pri' : 'btn small sec';
    });
    renderDiffAnalysisTable();
  }

  function applyAnalysisFilters() {
    var inp = document.getElementById('inpAnaSearch');
    State.analysisSearch = inp ? inp.value.trim().toLowerCase() : '';
    State.analysisPage = 1;
    renderDiffAnalysisTable();
  }

  function changeAnaPage(delta) { State.analysisPage += delta; renderDiffAnalysisTable(); }

  function exportDiffAnalysisCSV() {
    var data = getDiffAnalysisData();
    if (!data.length) { alert('暂无差分分析数据'); return; }
    var csv = '\uFEFF序号,差分网络,信号孔编号,目标扇出方案,判定状态,Padstack错误,位置错误,调整建议\n';
    data.forEach(function (d, idx) {
      csv += [idx + 1, '"' + d.net + '"', '"' + d.sigIds + '"', '"' + d.schemeName + '"', '"' + d.statusText + '"', '"' + d.padErrorText + '"', '"' + d.posErrorText + '"', '"' + String(d.advice).replace(/"/g, '""') + '"'].join(',') + '\n';
    });
    root.showExportBox('diff_fanout_analysis_' + Date.now() + '.csv', csv, '共 ' + data.length + ' 组记录。', 'text/csv');
  }

  root.setClusterThresh = setClusterThresh;

  root.renderAnalysisTab = renderAnalysisTab;
  root.setAnalysisFilter = setAnalysisFilter;
  root.applyAnalysisFilters = applyAnalysisFilters;
  root.changeAnaPage = changeAnaPage;
  root.exportDiffAnalysisCSV = exportDiffAnalysisCSV;
})(typeof window !== "undefined" ? window : globalThis);
