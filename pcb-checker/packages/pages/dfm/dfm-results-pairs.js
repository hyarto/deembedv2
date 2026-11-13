/* ============================================================================
 * dfm-results-pairs.js —— DFM 检查结果「视图二」统一明细表
 * 同一张 9 列表同时列出：线到孔对偶（过孔 × 走线）与孔到孔超标对（GND 孔盘 × 信号孔盘）。
 * 孔到孔对只列超标项；两类记录各自按同一页码与每页条数切片。
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var App = root.DfmApp;
  var $ = App.$;
  var escHtml = App.escHtml;
  var State = App.State;

  var BIG_PADPAIR_LIMIT = 1000;      // 孔盘对超过此数时禁止「全部显示」
  var BIG_PADPAIR_PAGE = '200';
  var COLS = 9;

  function modeLabel(mode) {
    if (mode === 'pad_to_trace') return '焊盘 Airgap';
    if (mode === 'drill_to_trace') return '一钻孔壁';
    return escHtml(mode || '');
  }

  function padPairKey(d) { return 'padpair_' + d.gndVia.id + '_' + d.sigVia.id; }
  function pairKey(p) { return p.via.id + '_' + p.trace.id; }

  function emptyRow(text) {
    return '<tr><td colspan="' + COLS + '" class="empty-cell">' + text + '</td></tr>';
  }

  /** 线到孔对偶过滤：filter 取 all / bad / bad_unreviewed / ok / gnd / signal，query 为小写搜索词。 */
  function filterPairs(pairs, filter, query, reviewed) {
    var qNorm = query.replace(/^via\s*/i, '').trim();
    return pairs.filter(function (p) {
      if ((filter === 'bad' || filter === 'bad_unreviewed') && p.status !== '不满足') return false;
      if (filter === 'bad_unreviewed' && reviewed[pairKey(p)]) return false;
      if (filter === 'ok' && p.status !== '满足') return false;
      if (filter === 'gnd' && !p.isGndVia) return false;
      if (filter === 'signal' && p.isGndVia) return false;
      if (!query) return true;
      var v = p.via, t = p.trace;
      var text = ('via ' + v.id + ' ' + v.id + ' ' + (v.net || '') + ' ' + (v.padstack || '') + ' ' + (v.padstackName || '') + ' ' +
        (v.spanLabel || '') + ' ' + (v.definedRaw || '') + ' ' + p.targetType + ' trace ' + t.id + ' ' + t.id + ' ' +
        (t.subset || '') + ' ' + (t.net || '') + ' ' + (t.width == null ? '' : t.width)).toLowerCase();
      return text.indexOf(query) >= 0 || text.indexOf(qNorm) >= 0;
    });
  }

  /** 孔到孔超标对过滤：只含不满足项，故「只看满足」为空；GND / 信号筛选下都保留（每对同时含两种孔）。 */
  function filterPadPairs(defects, filter, query, reviewed) {
    var qNorm = query.replace(/^via\s*/i, '').trim();
    return defects.filter(function (d) {
      if (filter === 'ok') return false;
      if (filter === 'bad_unreviewed' && reviewed[padPairKey(d)]) return false;
      if (!query) return true;
      var g = d.gndVia, s = d.sigVia;
      var text = ('via ' + g.id + ' ' + s.id + ' ' + (g.net || '') + ' ' + (s.net || '') + ' ' +
        (g.padstack || g.padstackName || '') + ' ' + (s.padstack || s.padstackName || '') + ' ' +
        (d.spanSig || '') + ' ' + (d.ruleLayers || '') + ' ' + (d.padAirgap == null ? '' : d.padAirgap) + ' ' +
        (d.centerDist == null ? '' : d.centerDist) + ' ' + (d.threshold == null ? '' : d.threshold) + ' ' +
        (d.diff == null ? '' : d.diff) + ' 孔盘到孔盘').toLowerCase();
      return text.indexOf(query) >= 0 || text.indexOf(qNorm) >= 0;
    });
  }

  /** 页码窗口：两类记录共用页码与每页条数，页数取两者较大者。会钳制 State.currentPage。 */
  function pageWindow(totalPairs, totalPadPairs) {
    if (State.pageSize === 'all' && totalPadPairs > BIG_PADPAIR_LIMIT) {
      State.pageSize = BIG_PADPAIR_PAGE;
      if ($('selPageSize')) $('selPageSize').value = BIG_PADPAIR_PAGE;
    }
    var size = State.pageSize === 'all'
      ? Math.max(totalPairs, totalPadPairs, 1)
      : (parseInt(State.pageSize, 10) || 50);
    var pages = Math.max(1, Math.ceil(totalPairs / size), Math.ceil(totalPadPairs / size));
    if (State.currentPage > pages) State.currentPage = pages;
    if (State.currentPage < 1) State.currentPage = 1;
    return { size: size, pages: pages, start: (State.currentPage - 1) * size };
  }

  function reviewCell(key, ariaLabel, isRev) {
    return '<td><input type="checkbox" class="ck-rev" data-no-persist data-key="' + escHtml(key) + '" aria-label="' + ariaLabel + '" ' +
      (isRev ? 'checked' : '') + '>' + (isRev ? '<div class="hint">已复核</div>' : '') + '</td>';
  }

  function pairRowHtml(p, idx) {
    var isBad = p.status === '不满足';
    var key = pairKey(p);
    var isRev = !!State.reviewedKeys[key];
    var diffStr = (p.diff >= 0 ? '+' : '') + p.diff.toFixed(2) + ' mil';
    var typeBadge = p.isGndVia ? '<span class="tag-badge">线到 GND 孔</span>' : '<span class="tag-badge info">线到信号孔</span>';
    var spanBadge = '<span class="tag-badge" data-tip="Padstack Defined: ' + escHtml(p.via.definedRaw || 'Top to Bottom') + '">' + escHtml(p.via.spanLabel || '通孔') + '</span>';
    return '<tr class="' + (isBad ? 'fail-row' : '') + ' ' + (isRev ? 'reviewed' : '') + '" id="row-' + idx + '" data-via="' + p.via.id + '" data-trace="' + p.trace.id + '">' +
      '<td>' + (idx + 1) + '</td>' +
      reviewCell(key, '复核 Via ' + p.via.id + ' × Trace ' + p.trace.id, isRev) +
      '<td>' + typeBadge + '</td>' +
      '<td><b>' + escHtml(p.via.padstack || p.via.padstackName || '未标注 Padstack') + '</b> / ' + escHtml(p.via.net || '未命名网络') + ' / <b>Via ' + p.via.id + '</b><br>' + spanBadge + '</td>' +
      '<td><b>Trace ' + p.trace.id + '</b><br>' + escHtml(p.trace.subset) + ' / ' + escHtml(p.trace.net || '未命名网络') + '<div class="hint">线宽 ' + p.trace.width + ' mil</div></td>' +
      '<td><b class="tag-badge ' + (isBad ? 'bad' : 'ok') + '">' + p.evalDist.toFixed(2) + ' mil</b><div class="hint">' + modeLabel(p.mode) + '</div></td>' +
      '<td>≥ ' + p.threshold.toFixed(2) + ' mil</td>' +
      '<td class="num-cell ' + (isBad ? 'bad' : 'ok') + '">' + diffStr + '</td>' +
      '<td><button type="button" class="btn sec small btn-locate" data-via="' + p.via.id + '" data-trace="' + p.trace.id + '">定位图</button></td></tr>';
  }

  function padPairRowHtml(d, seq) {
    var key = padPairKey(d);
    var isRev = !!State.reviewedKeys[key];
    var gap = Number(d.padAirgap) || 0;
    var threshold = Number(d.threshold) || 0;
    var deficit = Number(d.diff) || gap - threshold;
    var g = d.gndVia, s = d.sigVia;
    var gid = escHtml(String(g.id)), sid = escHtml(String(s.id));
    return '<tr class="fail-row pad-pair-row ' + (isRev ? 'reviewed' : '') + '" data-pad-pair="' + escHtml(key) + '">' +
      '<td>' + seq + '</td>' +
      reviewCell(key, '复核 GND Via ' + gid + ' × 信号 Via ' + sid, isRev) +
      '<td><span class="tag-badge bad">孔到孔</span></td>' +
      '<td><b>' + escHtml(g.padstack || g.padstackName || '未标注 Padstack') + '</b> / ' + escHtml(g.net || 'GND') + ' / <b>Via ' + gid + '</b><div class="hint">GND 孔盘</div></td>' +
      '<td><b>' + escHtml(s.padstack || s.padstackName || '未标注 Padstack') + '</b> / ' + escHtml(s.net || '未命名网络') + ' / <b>Via ' + sid + '</b><div class="hint">' + escHtml(d.spanSig || s.viaTypeLabel || '孔盘对') + '</div></td>' +
      '<td><b class="tag-badge bad">' + gap.toFixed(2) + ' mil</b><div class="hint">孔盘 Airgap，中心距 ' + Number(d.centerDist).toFixed(2) + ' mil</div></td>' +
      '<td>≥ ' + threshold.toFixed(2) + ' mil<div class="hint">' + escHtml(d.ruleLayers || '全部层') + '</div></td>' +
      '<td class="num-cell bad">' + deficit.toFixed(2) + ' mil</td>' +
      '<td><button type="button" class="btn sec small btn-locate-padpair" data-gnd-via="' + gid + '" data-sig-via="' + sid + '">定位孔对</button></td></tr>';
  }

  function updatePager(win, nPairs, nPadPairs, totalPairs, totalPadPairs) {
    if ($('pageInfo')) {
      $('pageInfo').textContent = '走线对偶 本页 ' + nPairs + ' 条，共 ' + totalPairs.toLocaleString() +
        ' 条；孔盘对 本页 ' + nPadPairs + ' 条，共 ' + totalPadPairs.toLocaleString() + ' 条';
    }
    if ($('pageCurrent')) $('pageCurrent').textContent = '第 ' + State.currentPage + ' / ' + win.pages + ' 页';
    var atFirst = State.currentPage <= 1, atLast = State.currentPage >= win.pages;
    if ($('btnFirstPage')) $('btnFirstPage').disabled = atFirst;
    if ($('btnPrevPage')) $('btnPrevPage').disabled = atFirst;
    if ($('btnNextPage')) $('btnNextPage').disabled = atLast;
    if ($('btnLastPage')) $('btnLastPage').disabled = atLast;
  }

  /** 「总复核」只作用于当前过滤条件与当前页实际渲染的行。 */
  function syncReviewAll(tbody) {
    var reviewAll = $('ckReviewVisible');
    if (!reviewAll) return;
    var boxes = Array.prototype.slice.call(tbody.querySelectorAll('.ck-rev'));
    var done = boxes.filter(function (ck) { return ck.checked; }).length;
    reviewAll.checked = boxes.length > 0 && done === boxes.length;
    reviewAll.indeterminate = done > 0 && done < boxes.length;
    reviewAll.disabled = boxes.length === 0;
    reviewAll.onchange = function () {
      boxes.forEach(function (ck) { State.reviewedKeys[ck.dataset.key] = reviewAll.checked; });
      root.renderResults();
    };
  }

  function bindRowEvents(tbody) {
    tbody.querySelectorAll('.ck-rev').forEach(function (ck) {
      var onToggle = function (e) { State.reviewedKeys[e.target.dataset.key] = e.target.checked; root.renderResults(); };
      ck.addEventListener('change', onToggle);
      ck.addEventListener('click', onToggle);
    });
    tbody.querySelectorAll('.btn-locate').forEach(function (b) {
      b.addEventListener('click', function () {
        root.rememberDfmResultPosition(b);
        root.locateInCanvas(parseInt(b.dataset.via, 10), parseInt(b.dataset.trace, 10));
      });
    });
    tbody.querySelectorAll('.btn-locate-padpair').forEach(function (b) {
      b.addEventListener('click', function () {
        root.rememberDfmResultPosition(b);
        root.locateViaPairInCanvas(parseInt(b.dataset.gndVia, 10), parseInt(b.dataset.sigVia, 10));
      });
    });
  }

  function render() {
    var r = State.checkResult;
    if (!r) return;
    var query = (State.searchQuery || '').toLowerCase().trim();
    var pairs = filterPairs(r.pairs, State.activeFilter, query, State.reviewedKeys);
    var padPairs = filterPadPairs(r.padPairDefects || [], State.activeFilter, query, State.reviewedKeys);
    var tbody = $('resTableBody');
    if (!pairs.length && !padPairs.length) {
      tbody.innerHTML = emptyRow('未找到符合当前筛选条件的记录');
      if ($('pageInfo')) $('pageInfo').textContent = '显示 0 / 0 条记录';
      if ($('pageCurrent')) $('pageCurrent').textContent = '第 1 / 1 页';
      syncReviewAll(tbody);
      return;
    }
    var win = pageWindow(pairs.length, padPairs.length);
    var pagePairs = pairs.slice(win.start, win.start + win.size);
    var pagePadPairs = padPairs.slice(win.start, win.start + win.size);
    updatePager(win, pagePairs.length, pagePadPairs.length, pairs.length, padPairs.length);
    // 孔到孔行序号接在全部线到孔记录之后，跨页连续
    var padBase = pairs.length + win.start;
    tbody.innerHTML = pagePairs.map(function (p, i) { return pairRowHtml(p, win.start + i); }).join('') +
      pagePadPairs.map(function (d, i) { return padPairRowHtml(d, padBase + i + 1); }).join('');
    bindRowEvents(tbody);
    syncReviewAll(tbody);
  }

  App.PairList = {
    render: render, filterPairs: filterPairs, filterPadPairs: filterPadPairs, pageWindow: pageWindow,
    padPairKey: padPairKey, BIG_PADPAIR_LIMIT: BIG_PADPAIR_LIMIT
  };
  root.DfmPairList = App.PairList;
})(typeof window !== 'undefined' ? window : globalThis);
