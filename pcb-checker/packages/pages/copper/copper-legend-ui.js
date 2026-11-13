/* ============================================================================
 * copper-legend-ui.js —— 约束检查模块：⑤ 规律分析、数据读取、过孔搜索定位、CSV 导出与事件绑定
 * ========================================================================== */
(function (root) {
  "use strict";

  var App = root.CopperApp;
  var $ = App.$;
  var esc = App.esc;
  var S = App.S;
  var UI = App.UI;
  var CC = root.CopperCheck;
  var CP = root.ConstraintParser;

  var keyTxt = function (g) { return App.keyTxt(g); };
  var updatePerf = function () { return App.updatePerf(); };
  var tabVisible = function (id) { return App.tabVisible(id); };
  var renderVisible = function () { return App.renderVisible(); };
  var resultGroupMatch = function (g, f) { return App.resultGroupMatch(g, f); };
  var runCheck = function () { return App.runCheck(); };
  var renderMatch = function () { return App.renderMatch(); };
  var reviewKey = function (g, r) { return App.reviewKey(g, r); };
  var viaGroupMatchSearch = function (g, q) { return App.viaGroupMatchSearch(g, q); };
  var renderChips = function () { return App.renderChips(); };
  var effectiveResFilter = function () { return App.effectiveResFilter(); };
  var resultGroupTotal = function (f) { return App.resultGroupTotal(f); };
  var refreshReview = function () { return App.refreshReview(); };
  var renderResults = function () { return App.renderResults(); };

  function renderLegend(force) {
    var box = $('legendOut');
    if (!box) return;
    if (!force && UI.legendRendered && UI.legendRenderedVer === UI.dataVer && box.dataset.ver === (UI.runSeq + '|' + UI.viewVer)) return;
    UI.legendRendered = true;
    UI.legendRenderedVer = UI.dataVer;

    var r = UI.result;
    if (!r) {
      box.innerHTML = '<div class="card"><div class="hint">还没有检查结果，请在 ③ 导入数据 页载入并运行检查。</div></div>';
      box.dataset.ver = UI.runSeq + '|' + UI.viewVer;
      return;
    }
    box.dataset.ver = UI.runSeq + '|' + UI.viewVer;
    var pos = ($('posTol') && !isNaN(parseFloat($('posTol').value))) ? parseFloat($('posTol').value) : 0.05;
    var val = ($('valTol') && !isNaN(parseFloat($('valTol').value))) ? parseFloat($('valTol').value) : 0.01;

    function renderReasonNetBadges(byNet) {
      var keys = Object.keys(byNet || {});
      if (!keys.length) return '<span class="muted">无网络</span>';
      keys.sort(function (a, b) {
        return ((byNet[b] || []).length - (byNet[a] || []).length) || a.localeCompare(b);
      });
      return '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px">' +
        keys.map(function (netName) {
          var viaList = byNet[netName] || [];
          var viaStr = viaList.map(function (vid) { return '#' + vid; }).join('、');
          return '<span style="display:inline-flex;align-items:center;background:#fff;border:1px solid #cbd5e1;border-radius:4px;padding:1px 6px;font-size:11px;font-family:var(--mono)">' +
            '<code>' + esc(netName) + '</code>' +
            '<span style="color:#6b7280;margin-left:4px;font-size:11px">· ' + viaList.length + '孔: ' + esc(viaStr) + '</span></span>';
        }).join('') + '</div>';
    }

    var badTotal = 0, badMap = {}, layerBadMap = {};
    r.groups.forEach(function (g) {
      if (!g.rule) return;
      var ruleTitle = g.rule.title || '未命名约束';
      var padName = g.via.padstack || '无 Padstack';
      var netName = g.via.net || '未命名网络';

      g.rows.forEach(function (row) {
        if (row.status !== '不符合') return;
        badTotal++;
        var ctype = row.checkType || '检查项';
        var isMiss = (row.actual === '无铜皮' || row.statusNote === '缺失层');
        var layerNum = row.layer;
        var lKey = String(layerNum).startsWith('L') ? String(layerNum) : ('L' + layerNum);
        layerBadMap[lKey] = (layerBadMap[lKey] || 0) + 1;

        var reasonTxt = '';
        var actualVal = row.actual, expectVal = row.expect;
        if (isMiss) {
          reasonTxt = '<b class="bad">无铜皮</b>（缺失该层铜皮，规则要求 ' + esc(row.expect) + ' mil）';
        } else if (row.actual != null && row.expect != null && !isNaN(row.actual) && !isNaN(row.expect)) {
          var diff = row.actual - row.expect;
          var diffStr = (diff > 0 ? '+' : '') + diff.toFixed(2);
          reasonTxt = '实测 ' + esc(row.actual) + ' mil ≠ 规则 ' + esc(row.expect) + ' mil（偏差 ' + diffStr + ' mil）';
        } else {
          reasonTxt = '实测 ' + esc(row.actual) + ' ≠ 规则 ' + esc(row.expect);
        }

        var bKey = ruleTitle + ' · ' + ctype;
        if (!badMap[bKey]) {
          badMap[bKey] = { title: ruleTitle, checkType: ctype, n: 0, layers: {}, padstacks: {}, reasons: {} };
        }
        badMap[bKey].n++;
        badMap[bKey].layers[layerNum] = 1;
        badMap[bKey].padstacks[padName] = 1;

        var subKey = 'L' + layerNum + '|' + actualVal + '|' + expectVal + '|' + (isMiss ? 1 : 0);
        if (!badMap[bKey].reasons[subKey]) {
          badMap[bKey].reasons[subKey] = {
            layer: layerNum, actual: actualVal, expect: expectVal, missing: isMiss,
            reason: reasonTxt, n: 0, vias: {}, byNet: {}
          };
        }
        badMap[bKey].reasons[subKey].n++;
        badMap[bKey].reasons[subKey].vias[g.via.id] = 1;
        if (!badMap[bKey].reasons[subKey].byNet[netName]) badMap[bKey].reasons[subKey].byNet[netName] = [];
        if (badMap[bKey].reasons[subKey].byNet[netName].indexOf(g.via.id) < 0) badMap[bKey].reasons[subKey].byNet[netName].push(g.via.id);
      });
    });

    var noRuleMap = {};
    r.groups.forEach(function (g) {
      if (!g.rows.length || g.rule) return;
      var key = g.via.padstack || '无 Padstack';
      if (!noRuleMap[key]) noRuleMap[key] = { vias: 0, rows: 0, cands: g.candidates || [], note: g.note || '' };
      noRuleMap[key].vias++;
      noRuleMap[key].rows += g.rows.length;
    });

    var dupGroups = 0;
    r.groups.forEach(function (g) {
      var seen = {};
      g.rows.forEach(function (row) {
        var key = row.layer + '|' + row.checkType + '|' + row.actual;
        seen[key] = (seen[key] || 0) + 1;
      });
      Object.keys(seen).forEach(function (k) { if (seen[k] > 1) dupGroups++; });
    });

    var h = '<div class="card">';
    h += '<h3 style="margin-top:0">各约束下不符合的具体原因展开明细' + (badTotal ? (' · 共 ' + badTotal + ' 条') : '') + '</h3>';
    if (!badTotal) {
      h += '<div class="hint" style="margin-bottom:14px">本次检查所有配对过孔与铜皮均符合约束规则。</div>';
    } else {
      var layerKeys = Object.keys(layerBadMap).sort(function (a, b) {
        var na = +a.replace(/^L/, ''), nb = +b.replace(/^L/, '');
        return layerBadMap[b] - layerBadMap[a] || na - nb;
      });
      h += '<div style="margin:8px 0 14px 0"><span style="font-size:12px;color:var(--sub);font-weight:600">按层分布概览：</span>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">' +
        layerKeys.map(function (lk) {
          return '<span style="padding:2px 8px;border-radius:4px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px">' +
            lk + '：<b class="bad">' + layerBadMap[lk] + '</b> 条</span>';
        }).join('') + '</div></div>';

      var badKeys = Object.keys(badMap).sort(function (a, b) { return badMap[b].n - badMap[a].n; });
      h += '<table><thead><tr><th>约束 · 检查项</th><th>总条数</th><th>具体原因与对应过孔网络明细</th><th>Padstack</th></tr></thead><tbody>';
      badKeys.forEach(function (k) {
        var v = badMap[k];
        var subReasons = Object.keys(v.reasons).map(function (srk) { return v.reasons[srk]; }).sort(function (a, b) {
          return a.layer - b.layer || b.n - a.n;
        });
        var detailHtml = '<div style="display:flex;flex-direction:column;gap:8px">';
        subReasons.forEach(function (sr) {
          var netCount = Object.keys(sr.byNet).length;
          detailHtml += '<div style="padding:6px 9px;border-radius:6px;background:#f8fafc;border:1px solid #e2e8f0">' +
            '<div style="font-size:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px">' +
              '<div><b>L' + sr.layer + '</b>：<span class="' + (sr.missing ? 'bad' : '') + '">' + sr.reason + '</span></div>' +
              '<div class="bad" style="font-weight:700;white-space:nowrap">' + sr.n + ' 条 · ' + Object.keys(sr.vias).length + ' 孔</div>' +
            '</div>' +
            '<div style="margin-top:4px;font-size:11px;color:#6b7280">' +
              '<span style="font-weight:600">对应孔的网络 · 共 ' + netCount + ' 个网络：</span>' +
              renderReasonNetBadges(sr.byNet) +
            '</div></div>';
        });
        detailHtml += '</div>';
        h += '<tr><td style="vertical-align:top"><b>' + esc(k) + '</b></td>' +
          '<td class="bad" style="font-size:14px;font-weight:700;vertical-align:top">' + v.n + '</td>' +
          '<td>' + detailHtml + '</td>' +
          '<td class="hint" style="font-size:11px;vertical-align:top">' + esc(Object.keys(v.padstacks).join('、')) + '</td></tr>';
      });
      h += '</tbody></table>';
    }

    h += '<div class="hint" style="margin-top:20px;padding-top:12px;border-top:1px solid var(--line)">当前比对参数：位置容差 ' + pos + ' mil，数值容差 ' + val + ' mil。</div>' +
      '<h3>1. 铜皮 × 过孔 怎么配对</h3><ol class="rules">' +
      '<li>仅配对 Exterior Boundary 单段 Arc seg 的圆形铜皮，多边形铜皮不参与配对。</li>' +
      '<li>铜皮圆心到过孔 Origin-xy 欧氏距离 ≤ ' + pos + ' mil 即归属该过孔。</li>' +
      '</ol>' +
      '<h3>2. 怎么推算该用哪条约束</h3><ol class="rules">' +
      '<li>解析 Padstack Name 中的 SMA/BGA、Top/Bot、出线层号及 <code>D2M6</code> / <code>ring3mil</code>，<code>_L2pad_</code> 为焊盘标记不计入出线层。</li>' +
      '<li>多段层号如 <code>l2-L8</code> 按范围末端优先匹配 <code>BGA-L8</code>；无层号时不硬套约束，仅列候选。</li>' +
      '</ol>' +
      '<h3>3. 每一层怎么判</h3><ol class="rules">' +
      '<li>Subset 前导数字映射层号，实测半径与规则值差值 ≤ ' + val + ' mil 判为符合，缺失应有层铜皮判为无铜皮不符合。</li>' +
      '<li>Padstack层名核对过孔名称是否覆盖 Connections 全部连接层。</li>' +
      '</ol>';

    var noRuleKeys = Object.keys(noRuleMap).sort(function (a, b) { return noRuleMap[b].vias - noRuleMap[a].vias; });
    h += '<h3>没推算到约束的分布 · 共 ' + noRuleKeys.reduce(function (n, k) { return n + noRuleMap[k].vias; }, 0) + ' 个过孔</h3>';
    if (!noRuleKeys.length) {
      h += '<div class="hint">所有配对过孔均已匹配到约束。</div>';
    } else {
      h += '<table><thead><tr><th>Padstack Name</th><th>过孔数</th><th>记录数</th><th>原因 / 候选约束</th></tr></thead><tbody>';
      noRuleKeys.forEach(function (k) {
        var v = noRuleMap[k];
        h += '<tr><td>' + esc(k) + '</td><td>' + v.vias + '</td><td>' + v.rows + '</td><td class="hint">' + esc(v.note || '') +
          (v.cands.length ? ('<br>候选：' + esc(v.cands.join('、'))) : '<br>没有同封装的约束可选') + '</td></tr>';
      });
      h += '</tbody></table>';
    }

    h += '<h3>未配对铜皮 · 共 ' + r.unmatchedCircles.length + ' 个</h3>';
    if (!r.unmatchedCircles.length) {
      h += '<div class="hint">本次所有圆形铜皮都配到了过孔。</div>';
    } else {
      h += '<table><thead><tr><th>铜皮#</th><th>层</th><th>Subset</th><th>半径 mil</th><th>最近过孔#</th><th>距离 mil</th><th>差多少才配上</th></tr></thead><tbody>';
      r.unmatchedCircles.slice(0, 40).forEach(function (sh) {
        var nr = (sh.nearest !== undefined && sh.nearest !== null) ? sh.nearest : (r.nearestViaOf ? r.nearestViaOf(sh) : null);
        var d = nr ? nr.dist : null;
        var gap = (d == null) ? '' : (d - pos);
        h += '<tr><td>' + sh.id + '</td><td>L' + CC.subsetToLayer(sh.subset, App.layerCount()) + '</td><td>' + esc(sh.subset) + '</td>' +
          '<td>' + esc(sh.radius) + '</td><td>' + (nr ? ('Via ' + nr.viaId) : (r.viaCount ? '200 mil 内无过孔' : '无过孔')) + '</td>' +
          '<td>' + (d == null ? '—' : d.toFixed(3)) + '</td>' +
          '<td class="hint">' + (gap == null ? '—' : (gap > 0 ? ('还差 ' + gap.toFixed(3) + ' mil，超过位置容差 ' + pos) : '容差内')) + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    h += '<div class="hint" style="margin-top:10px">多边形铜皮 ' + r.polygons.length + ' 个不参与过孔配对；同孔同层重复铜皮记录 ' + dupGroups + ' 处。</div></div>';
    box.innerHTML = h;
  }

  function loadDataFile(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () {
      var t0 = App.nowMs();
      var dec = CP.decodeBuffer(fr.result);
      var t1 = App.nowMs();
      UI.items = CC.parseBoardItems(dec.text);
      UI.dataVer++;
      UI.viewVer++;
      var t2 = App.nowMs();
      var via = UI.items.filter(function (it) { return it.type === 'via'; }).length;
      var sh = UI.items.filter(function (it) { return it.type === 'shape'; }).length;
      var tr = UI.items.filter(function (it) { return it.type === 'trace'; }).length;
      UI.decMs = Math.round(t1 - t0);
      UI.parseMsN = Math.round(t2 - t1);
      UI.fileKB = Math.round(dec.text.length / 1024);
      UI.counts = { shape: sh, via: via, trace: tr };
      if ($('checkHint')) {
        $('checkHint').textContent = '已读入 ' + file.name + ' · ' + dec.enc + '：Item ' + UI.items.length + '，Shape ' + sh + '，Via ' + via + '，Trace ' + tr;
      }
      runCheck();
      renderVisible();
    };
    fr.readAsArrayBuffer(file);
  }

  function applyReviewKeys(keys, on) {
    (keys || []).forEach(function (rk) {
      if (on) UI.reviewed[rk] = 1;
      else delete UI.reviewed[rk];
      var b = document.querySelector('.rvwBox[data-rk="' + rk.replace(/"/g, '\\"') + '"]');
      if (!b) return;
      b.checked = !!on;
      var tr = b.closest('tr');
      if (tr) {
        tr.classList.toggle('reviewed', !!on);
        var tag = tr.querySelector('.rvTag');
        if (tag) tag.style.display = on ? '' : 'none';
      }
    });
  }

  function toggleGroup(si, force) {
    var keys = UI.groupKeys && UI.groupKeys[si];
    if (!keys || !keys.length) return;
    var allOn = true;
    keys.forEach(function (k) { if (!UI.reviewed[k]) allOn = false; });
    var on = (typeof force === 'boolean') ? force : !allOn;
    applyReviewKeys(keys, on);
    refreshReview();
  }

  function setResFilter(f) {
    UI.resFilter = (UI.resFilter === f) ? '' : f;
    UI.onlyBad = (UI.resFilter === 'bad');
    UI.viewVer++;
    renderResults();
  }

  var searchDebounceTimer = null;
  function onSearchInput() {
    var q = ($('inpResSearch') ? $('inpResSearch').value : '').trim();
    if ($('btnClearSearch')) $('btnClearSearch').style.display = q ? 'block' : 'none';
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(function () {
      if (UI.resSearch === q) return;
      UI.resSearch = q;
      UI.viewVer++;
      renderResults();
      if ($('searchStat')) $('searchStat').textContent = q ? ('找到 ' + resultGroupTotal(effectiveResFilter()) + ' 个匹配过孔') : '';
    }, 100);
  }

  function locateVia() {
    var query = ($('inpResSearch') ? $('inpResSearch').value : '').trim();
    if (UI.resSearch !== query) {
      UI.resSearch = query;
      if ($('btnClearSearch')) $('btnClearSearch').style.display = query ? 'block' : 'none';
      UI.viewVer++;
      renderResults();
    }
    if (!query) {
      if ($('searchStat')) $('searchStat').textContent = '';
      return;
    }
    var target = document.querySelector('#checkOut .set');
    if (target) {
      if (typeof target.scrollIntoView === 'function') {
        try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        catch (err) { target.scrollIntoView(); }
      }
      target.classList.remove('pulse-target');
      void target.offsetWidth;
      target.classList.add('pulse-target');
      setTimeout(function () { target.classList.remove('pulse-target'); }, 1600);
      var badge = target.querySelector('.badge');
      var bTxt = badge ? badge.textContent : '过孔';
      var total = resultGroupTotal(effectiveResFilter());
      if ($('searchStat')) $('searchStat').textContent = '已定位到 ' + bTxt + (total > 1 ? (' · 共 ' + total + ' 个匹配孔') : ' · 唯一定位');
    } else {
      var allMatching = (UI.result && UI.result.groups) ? UI.result.groups.filter(function (g) { return viaGroupMatchSearch(g, query); }).length : 0;
      if ($('searchStat')) {
        $('searchStat').textContent = allMatching > 0
          ? ('存在 ' + allMatching + ' 个匹配孔，但被当前筛选隐藏，点击「全部」可查看。')
          : '未找到匹配的过孔。';
      }
    }
  }

  function clearSearch() {
    if ($('inpResSearch')) $('inpResSearch').value = '';
    if ($('btnClearSearch')) $('btnClearSearch').style.display = 'none';
    if ($('searchStat')) $('searchStat').textContent = '';
    if (UI.resSearch) {
      UI.resSearch = '';
      UI.viewVer++;
      renderResults();
    }
    if ($('inpResSearch')) $('inpResSearch').focus();
  }

  function exportCsv() {
    var r = UI.result;
    if (!r) { if ($('resHint')) $('resHint').textContent = '尚未产生检查结果。'; return; }
    var lines = ['铜皮,过孔,网络,Padstack,约束,层,Subset,检查项,实测,规则值,结果,复核'];
    var rf = effectiveResFilter();
    r.groups.forEach(function (g) {
      if (!resultGroupMatch(g, rf)) return;
      var rows = (rf === 'bad') ? g.failRows : g.rows;
      rows.forEach(function (row) {
        var layerDisplay = (typeof row.layer === 'number' && row.layer > 0) ? ('L' + row.layer) : (String(row.layer).startsWith('L') ? row.layer : (row.layer === '—' ? '—' : ('L' + row.layer)));
        lines.push([
          row.shapeId, g.via.id, g.via.net || '', g.via.padstack || '', g.rule ? g.rule.title : '',
          layerDisplay, row.subset, row.checkType, row.actual, row.expect, row.status,
          (UI.reviewed[reviewKey(g, row)] ? '已复核' : '')
        ].map(function (x) {
          return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
        }).join(','));
      });
    });
    App.showBox('铜皮检查.csv', lines.join('\n'), '共 ' + (lines.length - 1) + ' 行记录。');
  }

  function bindResultsEvents() {
    var dataDrop = $('dataDrop');
    if (dataDrop) {
      dataDrop.onclick = function () { $('dataFile').click(); };
      ['dragover', 'dragenter'].forEach(function (ev) {
        dataDrop.addEventListener(ev, function (e) { e.preventDefault(); dataDrop.classList.add('over'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        dataDrop.addEventListener(ev, function (e) { e.preventDefault(); dataDrop.classList.remove('over'); });
      });
      dataDrop.addEventListener('drop', function (e) {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files[0]) loadDataFile(e.dataTransfer.files[0]);
      });
    }
    if ($('dataFile')) {
      $('dataFile').onchange = function (e) { loadDataFile(e.target.files && e.target.files[0]); e.target.value = ''; };
    }
    if ($('btnCheck')) {
      $('btnCheck').onclick = function () { if (runCheck()) App.showTab('result'); };
    }

    var onStackChange = function () {
      App.reexpandAll();
      App.render();
      UI.viewVer++;
      if (UI.items.length) runCheck();
      if (tabVisible('tab-legend')) renderLegend(true);
    };
    var stackInput = $('inpN');
    if (stackInput) {
      stackInput.oninput = function () { App.updateStackHints(); };
      stackInput.onchange = onStackChange;
    }
    if ($('btnAutoN')) {
      $('btnAutoN').onclick = function () { if (stackInput) stackInput.value = ''; onStackChange(); };
    }

    var recheckTimer = null;
    var recheckSoon = function () {
      if (!UI.items.length) return;
      if (recheckTimer) clearTimeout(recheckTimer);
      recheckTimer = setTimeout(function () { recheckTimer = null; runCheck(); }, 100);
    };
    ['ckAnti', 'ckPad', 'ckNfp', 'ckPadstack', 'posTol', 'valTol'].forEach(function (id) {
      var el = $(id);
      if (el) el.onchange = recheckSoon;
    });
    ['posTol', 'valTol'].forEach(function (id) {
      var el = $(id);
      if (el) el.oninput = recheckSoon;
    });

    if ($('btnOnlyBad')) $('btnOnlyBad').onclick = function () { setResFilter('bad'); };
    if ($('btnOnlyMatched')) $('btnOnlyMatched').onclick = function () { setResFilter('matched'); };
    if ($('btnOnlyNoRule')) $('btnOnlyNoRule').onclick = function () { setResFilter('norule'); };
    if ($('btnAllRows')) {
      $('btnAllRows').onclick = function () {
        UI.onlyBad = false;
        UI.resFilter = '';
        UI.resRule = '';
        UI.resSearch = '';
        if ($('inpResSearch')) $('inpResSearch').value = '';
        if ($('btnClearSearch')) $('btnClearSearch').style.display = 'none';
        if ($('searchStat')) $('searchStat').textContent = '';
        UI.viewVer++;
        renderResults();
      };
    }
    if ($('btnClearReview')) {
      $('btnClearReview').onclick = function () { UI.reviewed = {}; UI.viewVer++; renderResults(); };
    }
    if ($('btnReviewAll')) {
      $('btnReviewAll').onclick = function () {
        if (!UI.result) return;
        UI.result.groups.forEach(function (g) {
          (g.failRows || []).forEach(function (row) { UI.reviewed[reviewKey(g, row)] = 1; });
        });
        UI.viewVer++;
        renderResults();
      };
    }
    if ($('btnCsv')) $('btnCsv').onclick = exportCsv;

    if ($('inpResSearch')) {
      $('inpResSearch').addEventListener('input', onSearchInput);
      $('inpResSearch').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); locateVia(); }
        else if (e.key === 'Escape') { e.preventDefault(); clearSearch(); }
      });
    }
    if ($('btnClearSearch')) $('btnClearSearch').onclick = clearSearch;
    if ($('btnSearchGo')) $('btnSearchGo').onclick = locateVia;

    document.addEventListener('click', function (e) {
      var mTile = e.target.closest ? e.target.closest('#matchOut .stat.click') : null;
      if (mTile) {
        var mf = mTile.dataset.f;
        UI.matchFilter = (UI.matchFilter === mf) ? '' : mf;
        UI.viewVer++;
        renderMatch();
        return;
      }
      var revBadge = e.target.closest ? e.target.closest('.badge.rev') : null;
      if (revBadge && revBadge.id && /^grv-\d+$/.test(revBadge.id)) {
        toggleGroup(+revBadge.id.slice(4));
        return;
      }
      var chip = e.target.closest ? e.target.closest('#resChips .chip') : null;
      if (chip) {
        var k = chip.dataset.rule;
        UI.resRule = (UI.resRule === k) ? '' : k;
        UI.viewVer++;
        renderResults();
        return;
      }
      if (e.target.closest && e.target.closest('#btnMoreMatch')) { UI.matchLimit += 300; UI.limitTouched = 1; UI.viewVer++; renderMatch(); return; }
      if (e.target.closest && e.target.closest('#btnMoreMatchAll')) { UI.matchLimit = 1e6; UI.limitTouched = 1; UI.viewVer++; renderMatch(); return; }
      if (e.target.closest && e.target.closest('#btnMoreRes')) { UI.resLimit += 120; UI.limitTouched = 1; UI.viewVer++; renderResults(); return; }
      if (e.target.closest && e.target.closest('#btnMoreResAll')) { UI.resLimit = 1e6; UI.limitTouched = 1; UI.viewVer++; renderResults(); return; }
      var rTile = e.target.closest ? e.target.closest('#resStats .stat.click') : null;
      if (rTile && rTile.dataset.res) setResFilter(rTile.dataset.res);
    });

    document.addEventListener('change', function (e) {
      var master = e.target.closest ? e.target.closest('.grpBox') : null;
      if (master) {
        toggleGroup(+master.dataset.si, master.checked);
        return;
      }
      var box = e.target.closest ? e.target.closest('.rvwBox') : null;
      if (!box) return;
      var rk = box.dataset.rk;
      if (box.checked) UI.reviewed[rk] = 1;
      else delete UI.reviewed[rk];
      var tr = box.closest('tr');
      if (tr) {
        tr.classList.toggle('reviewed', box.checked);
        var tag = tr.querySelector('.rvTag');
        if (tag) tag.style.display = box.checked ? '' : 'none';
      }
      refreshReview();
    });

    /* 右栏快捷按钮绑定 */
    if ($('dockCopperRun')) {
      $('dockCopperRun').onclick = function () {
        if (runCheck()) App.showTab('result');
        else App.showTab('data');
      };
    }
    if ($('dockCopperSave')) {
      $('dockCopperSave').onclick = function () { if ($('btnSave')) $('btnSave').click(); };
    }
    if ($('dockCopperCsv')) {
      $('dockCopperCsv').onclick = exportCsv;
    }
  }

  Object.assign(App, {
    renderLegend: renderLegend,
    loadDataFile: loadDataFile,
    applyReviewKeys: applyReviewKeys,
    toggleGroup: toggleGroup,
    setResFilter: setResFilter,
    onSearchInput: onSearchInput,
    locateVia: locateVia,
    clearSearch: clearSearch,
    exportCsv: exportCsv
  });

  root.renderLegend = renderLegend;
  root.onSearchInput = onSearchInput;
  root.locateVia = locateVia;
  root.clearSearch = clearSearch;

  bindResultsEvents();
  App.syncPin();
})(typeof window !== "undefined" ? window : globalThis);
