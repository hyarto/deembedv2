/* ============================================================================
 * copper-results-ui.js —— 约束检查模块：配对视图、检查结果筛选/复核与规律分布分析
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var App = root.CopperApp;
  var CP = root.ConstraintParser;
  var CC = root.CopperCheck;
  var S = App.S;
  var UI = App.UI;
  var $ = App.$;
  var esc = App.esc;

  function checkEnabled() {
    return {
      '反焊盘尺寸': $('ckAnti') ? $('ckAnti').checked : true,
      '焊盘尺寸': $('ckPad') ? $('ckPad').checked : true,
      '非功能焊盘尺寸': $('ckNfp') ? $('ckNfp').checked : true,
      'Padstack层名': $('ckPadstack') ? $('ckPadstack').checked : true
    };
  }

  function keyTxt(g) {
    var k = g.keys;
    var t = [k.kind, k.side, k.fan ? ('L' + k.fan) : '', k.d2m ? ('D2M' + k.d2m) : '', k.ring ? ('ring' + k.ring + 'mil') : ''].filter(Boolean).join(' / ');
    return t || '无关键信息';
  }

  function updatePerf() {
    var el = $('perfLine');
    if (!el) return;
    var c = UI.counts || {};
    if (!UI.items.length) { el.textContent = ''; return; }
    el.textContent = '文件 ' + (UI.fileKB || 0) + ' KB ｜ Item ' + UI.items.length +
      ' · Shape ' + (c.shape || 0) + ' / Via ' + (c.via || 0) + ' / Trace ' + (c.trace || 0) +
      ' ｜ 解码 ' + (UI.decMs || 0) + ' ms ｜ 解析 ' + (UI.parseMsN || 0) + ' ms ｜ 检查 ' + (UI.chkMs || 0) +
      ' ms ｜ 匹配表 ' + (UI.matchMs || 0) + ' ms ｜ 结果 ' + (UI.resMs || 0) + ' ms';
  }

  function tabVisible(id) {
    var el = $(id);
    return !!(el && el.classList.contains('active'));
  }

  function renderVisible() {
    if (tabVisible('tab-data')) renderMatch();
    if (tabVisible('tab-result')) renderResults();
  }

  function runCheck() {
    if (!UI.items.length) {
      if ($('checkHint')) $('checkHint').textContent = '请先导入数据 TXT。';
      return false;
    }
    var pos = parseFloat($('posTol').value), val = parseFloat($('valTol').value);
    var t0 = App.nowMs();
    UI.result = CC.runCopperCheck(UI.items, S.sets, {
      layerCount: App.layerCount(),
      posTol: isNaN(pos) ? 0.05 : pos,
      valTol: isNaN(val) ? 0.01 : val,
      enabled: checkEnabled()
    });
    var r = UI.result;
    UI.viewVer++;
    UI.runSeq++;
    var gcount = r.groups.length;
    var autoMatch = gcount > 3000 ? 100 : (gcount > 800 ? 200 : 300);
    var autoRes = gcount > 3000 ? 40 : (gcount > 800 ? 80 : 120);
    if (!UI.limitTouched) {
      UI.matchLimit = Math.min(UI.matchLimit, autoMatch);
      UI.resLimit = Math.min(UI.resLimit, autoRes);
    }
    UI.chkMs = App.viewMs(t0);
    var bad = r.groups.reduce(function (n, g) { return n + (g.failCount || 0); }, 0);
    var bigNote = gcount > 800 ? (' 数据量 ' + gcount + ' 个过孔，默认渲染前 ' + UI.resLimit + ' 组。') : '';
    if ($('checkHint')) {
      $('checkHint').textContent = '过孔 ' + r.viaCount + '，圆形铜皮 ' + r.circleCount + '，不符合 ' + bad + '。' +
        '检查耗时 ' + UI.chkMs + ' ms。' + bigNote +
        (!S.sets.length ? ' 还没有规则，请先在 ① 规则约束 导入约束 TXT。' : '') +
        (r.maxLayer > App.layerCount() ? (' 数据写到 L' + r.maxLayer + '，当前叠层按 L' + App.layerCount() + ' 比对。') : '');
    }
    renderVisible();
    updatePerf();
    App.syncTelemetry();
    return true;
  }

  function matchCounts(r) {
    var rows = 0, groupsWith = 0, groupsWithout = 0;
    r.groups.forEach(function (g) {
      var realCount = (g.rows || []).filter(function (row) { return !row.missing && !row.isPadstackCheck; }).length;
      if (realCount) { rows += realCount; groupsWith++; }
      else groupsWithout++;
    });
    var unm = (r.unmatchedCircles || []).length;
    var c = { rows: rows, groupsWith: groupsWith, groupsWithout: groupsWithout, unm: unm };
    c.via = rows + groupsWithout;
    c.matched = rows;
    c.circle = rows + unm;
    c.unmatched = unm;
    c.all = rows + groupsWithout + unm;
    return c;
  }

  function matchTotal(c, f) { return (f && c[f] != null) ? c[f] : c.all; }

  function matchRowHtml(g, row) {
    var cand = (!g.rule && g.candidates && g.candidates.length) ? ('<div class="hint">候选：' + g.candidates.map(esc).join('、') + '</div>') : '';
    var fail = row.status === '不符合';
    return '<tr class="' + (fail ? 'fail' : '') + '">' +
      '<td>' + row.shapeId + '</td><td>L' + row.layer + '</td><td>' + esc(row.subset) + '</td><td>' + esc(row.actual) + '</td>' +
      '<td>Via ' + g.via.id + '</td><td>' + esc(g.via.net || '无网络') + '</td><td>' + esc(g.via.padstack || '无 Padstack') + '</td>' +
      '<td>' + esc(keyTxt(g)) + (g.note ? '<div class="hint">' + esc(g.note) + '</div>' : '') + '</td>' +
      '<td>' + (g.rule ? ('<b>' + esc(g.rule.title) + '</b>') : '<b class="bad">未选中规则</b>') + cand +
      '<div class="hint">' + esc(row.checkType) + '</div></td></tr>';
  }

  function viaNoShapeHtml(g) {
    return '<tr><td class="muted">—</td><td class="muted">—</td><td class="muted">—</td><td class="muted">—</td>' +
      '<td>Via ' + g.via.id + '</td><td>' + esc(g.via.net || '无网络') + '</td><td>' + esc(g.via.padstack || '无 Padstack') + '</td>' +
      '<td>' + esc(keyTxt(g)) + '</td><td colspan="2" class="muted">' + esc(g.note || '附近没有圆形铜皮') + '</td></tr>';
  }

  function circleRowHtml(sh) {
    return '<tr class="fail"><td>' + sh.id + '</td><td>L' + CC.subsetToLayer(sh.subset, App.layerCount()) + '</td><td>' + esc(sh.subset) + '</td><td>' + esc(sh.radius) + '</td>' +
      '<td colspan="5" class="muted">没有配对到过孔</td></tr>';
  }

  function renderMatch() {
    var r = UI.result, box = $('matchOut');
    if (!box) return;
    if (!r) { box.innerHTML = '<div class="hint">尚未导入 Item 数据。</div>'; box.dataset.ver = ''; return; }
    var f = UI.matchFilter || '';
    var ver = UI.dataVer + '-' + UI.viewVer + '-' + UI.matchLimit + '-' + f;
    if (box.dataset.ver === ver) return;
    var t0 = App.nowMs();
    var counts = matchCounts(r);
    var total = matchTotal(counts, f);
    var matched = counts.groupsWith;
    var tiles = [
      { f: 'via', n: r.viaCount, label: '过孔', tip: '点击筛选全部过孔记录' },
      { f: 'matched', n: matched, label: '已配对过孔', tip: '点击仅看已配对到铜皮的过孔' },
      { f: 'circle', n: r.circleCount, label: '圆形铜皮', tip: '点击查看全部圆形铜皮记录' },
      { f: 'unmatched', n: r.unmatchedCircles.length, label: '未配对铜皮', tip: '点击仅看未配对到过孔的铜皮' }
    ];
    var h = '<div class="row" style="margin-bottom:8px">' + tiles.map(function (t) {
      return '<div class="stat click' + (f === t.f ? ' on' : '') + '" data-f="' + t.f + '" data-tip="' + esc(t.tip) + '"><b>' + t.n + '</b>' +
        '<span class="hint">' + esc(t.label) + '</span>' + (f === t.f ? '<span class="fnote">筛选中</span>' : '') + '</div>';
    }).join('') + '</div>';

    h += '<div class="tbl-wrap"><table><thead><tr><th>铜皮#</th><th>层</th><th>Subset</th><th>半径 mil</th><th>过孔#</th><th>网络</th><th>Padstack Name</th><th>提取的关键信息</th><th>推算的约束</th></tr></thead><tbody>';
    if (!total) h += '<tr><td colspan="9" class="muted">当前分类无记录。</td></tr>';

    var shown = 0;
    var cap = UI.matchLimit;
    var wantVia = !f || f === 'via';
    var wantMatch = !f || f === 'via' || f === 'matched' || f === 'circle';
    for (var gi = 0; gi < r.groups.length && shown < cap; gi++) {
      var g = r.groups[gi];
      var realRows = (g.rows || []).filter(function (row) { return !row.missing && !row.isPadstackCheck; });
      if (!realRows.length) {
        if (wantVia) { h += viaNoShapeHtml(g); shown++; }
        continue;
      }
      if (!wantMatch) continue;
      for (var ri = 0; ri < realRows.length && shown < cap; ri++) {
        h += matchRowHtml(g, realRows[ri]);
        shown++;
      }
    }
    if (!f || f === 'circle' || f === 'unmatched') {
      var un = r.unmatchedCircles || [];
      for (var i = 0; i < un.length && shown < cap; i++) {
        h += circleRowHtml(un[i]);
        shown++;
      }
    }
    h += '</tbody></table></div>';
    h += '<div class="hint" style="margin-top:8px">显示 ' + shown + ' / ' + total + ' 行 · 未配对圆形铜皮 ' + r.unmatchedCircles.length +
      ' 个 · 多边形铜皮 ' + r.polygons.length + ' 个不参与过孔配对。</div>';
    if (total > shown) {
      h += '<div class="row" style="margin-top:8px"><button type="button" class="btn gray" id="btnMoreMatch">显示更多 · 剩余 ' + (total - shown) + ' 行</button>' +
        '<button type="button" class="btn gray" id="btnMoreMatchAll">全部展开</button></div>';
    }
    box.innerHTML = h;
    box.dataset.ver = ver;
    UI.matchMs = App.viewMs(t0);
    updatePerf();
  }

  function reviewKey(g, row) {
    return 'v' + g.via.id + '-s' + row.shapeId + '-L' + row.layer + '-' + row.checkType;
  }

  function ruleCountLabel() {
    var f = UI.resFilter || '';
    if (f === 'bad') return '该约束下有不符合的过孔数';
    if (f === 'norule') return '该约束下没推算到约束的过孔数';
    return '该约束匹配到的过孔数';
  }

  function viaGroupMatchSearch(g, query) {
    if (!query) return true;
    var rawQ = String(query).trim();
    if (!rawQ) return true;
    var q = rawQ.toLowerCase();
    if (q === '未推算到' || q === '未推算到约束' || q === '没推算到' || q === 'norule') {
      if (!g.rule) return true;
    }
    var qNum = q.replace(/^(?:via|v|孔|#)\s*[-_:]?\s*/i, '').trim();
    var viaIdStr = String(g.via && g.via.id != null ? g.via.id : '');
    if (viaIdStr === q || (qNum && viaIdStr === qNum)) return true;
    if (qNum && viaIdStr.indexOf(qNum) >= 0) return true;
    var net = String((g.via && g.via.net) || '').toLowerCase();
    if (net && net.indexOf(q) >= 0) return true;
    var pad = String((g.via && g.via.padstack) || '').toLowerCase();
    if (pad && pad.indexOf(q) >= 0) return true;
    var ruleTitle = String((g.rule && g.rule.title) || '').toLowerCase();
    if (ruleTitle && ruleTitle.indexOf(q) >= 0) return true;
    var rawKeys = String((g.keys && g.keys.raw) || '').toLowerCase();
    if (rawKeys && rawKeys.indexOf(q) >= 0) return true;
    var kTxt = String(keyTxt(g) || '').toLowerCase();
    if (kTxt && kTxt.indexOf(q) >= 0) return true;
    var note = String(g.note || '').toLowerCase();
    if (note && note.indexOf(q) >= 0) return true;
    var rows = g.rows || [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.subset && row.subset.toLowerCase().indexOf(q) >= 0) return true;
      if (('l' + row.layer) === q || ('layer' + row.layer) === q) return true;
      if (String(row.shapeId) === q) return true;
    }
    return false;
  }

  function ruleCounts() {
    var r = UI.result, out = {}, order = [];
    var f = UI.resFilter || '';
    (r.groups || []).forEach(function (g) {
      if (!g.rows.length) return;
      if (UI.resSearch && !viaGroupMatchSearch(g, UI.resSearch)) return;
      var title = g.rule ? g.rule.title : '';
      var key = title || '未推算到约束';
      if (!out[key]) { out[key] = { n: 0, title: title, via: 0, badVia: 0, badRec: 0 }; order.push(key); }
      out[key].via++;
      if (g.failCount) { out[key].badVia++; out[key].badRec += (g.failCount || 0); }
      if (f === 'bad') { if (g.failCount) out[key].n++; }
      else if (f === 'norule') { if (!g.rule) out[key].n++; }
      else out[key].n++;
    });
    (S.sets || []).forEach(function (s) {
      var key = s.title || '';
      if (key && !out[key]) { out[key] = { n: 0, title: key, via: 0, badVia: 0, badRec: 0 }; order.push(key); }
    });
    order.sort(function (a, b) {
      var na = out[a].n, nb = out[b].n;
      if (na !== nb) return nb - na;
      return String(a).localeCompare(String(b));
    });
    return { map: out, order: order };
  }

  function renderChips() {
    var box = $('resChips');
    if (!box) return;
    var scope = $('chipScope');
    if (scope) scope.textContent = ' · 计数口径：' + ruleCountLabel();
    var cand = ruleCounts();
    if (!cand.order.length) {
      box.innerHTML = '<span class="hint">暂无可筛选的约束。</span>';
      return;
    }
    var metas = CP.orderChips(cand.order, cand.map);
    var cols = [], colIndex = {};
    metas.forEach(function (m) {
      if (!colIndex[m.group]) { colIndex[m.group] = { group: m.group, items: [] }; cols.push(colIndex[m.group]); }
      colIndex[m.group].items.push(m);
    });
    var h = '';
    cols.forEach(function (col) {
      h += '<div class="chipcol"><div class="chipcol-h">' + esc(col.group) +
        '<span class="cn" style="color:#9ca3af;font-weight:400"> ' + col.items.reduce(function (n, m) { return n + m.n; }, 0) + '</span></div>';
      var lastD2M = null;
      var multi = col.items.some(function (x) { return x.name && CP.chipD2M(x.name) > 0; });
      col.items.forEach(function (m) {
        var d2m = m.name ? CP.chipD2M(m.name) : 0;
        var dkName = d2m ? ('D2M' + d2m + 'mil') : '未标 D2M';
        if (multi && dkName !== lastD2M) {
          h += '<div class="chipsub">' + esc(dkName) + '</div>';
          lastD2M = dkName;
        }
        var on = UI.resRule === m.key;
        var miss = (m.name === '');
        var label = miss ? '未推算到约束' : CP.chipShort(m.key, col.group);
        var info = cand.map[m.key] || {};
        var tip = (m.key || '未推算到约束') + '：匹配 ' + ((info.via != null) ? info.via : 0) + ' 个过孔' +
          (info.badVia ? ('，其中 ' + info.badVia + ' 个孔存在不符合') : '');
        h += '<span class="chip' + (on ? ' on' : '') + (miss ? ' miss' : '') + (m.n ? '' : ' zero') + '" data-rule="' + esc(m.key) + '" data-tip="' + esc(tip) + '">' +
          '<span class="cl">' + esc(label) + '</span><span class="cn">' + m.n + '</span></span>';
      });
      h += '</div>';
    });
    box.innerHTML = h;
  }

  function resultCounts() {
    var r = UI.result;
    var fails = 0, matched = 0, norule = 0, rowsAll = 0;
    r.groups.forEach(function (g) {
      fails += g.failCount || 0;
      rowsAll += g.rows.length;
      if (g.rows.some(function (row) { return !row.missing && !row.isPadstackCheck; })) matched++;
      if (g.rows.length && !g.rule) norule++;
    });
    return { bad: fails, matched: matched, norule: norule, rows: rowsAll, total: r.groups.length };
  }

  function effectiveResFilter() {
    if (UI.resFilter) return UI.resFilter;
    return UI.onlyBad ? 'bad' : '';
  }

  function resultGroupMatch(g, f) {
    if (UI.resSearch && !viaGroupMatchSearch(g, UI.resSearch)) return false;
    if (UI.resRule) {
      var title = g.rule ? g.rule.title : '未推算到约束';
      if (title !== UI.resRule) return false;
    }
    if (!f) return true;
    if (f === 'bad') return !!(g.failCount);
    if (f === 'matched') return g.rows.some(function (row) { return !row.missing; });
    if (f === 'norule') return !!(g.rows.length && !g.rule);
    return true;
  }

  function resultGroupTotal(f) {
    var r = UI.result;
    var n = 0;
    for (var i = 0; i < r.groups.length; i++) if (resultGroupMatch(r.groups[i], f)) n++;
    return n;
  }

  function resFilterText() {
    var f = effectiveResFilter();
    var byRule = UI.resRule ? ('只看约束 ' + UI.resRule) : '';
    var bySearch = UI.resSearch ? ('搜索 "' + UI.resSearch + '"') : '';
    var base = (function () {
      if (f === 'bad') return '只显示不符合项';
      if (f === 'matched') return '只看已配对过孔的记录';
      if (f === 'norule') return '只看没推算到约束的过孔';
      return '显示全部检查项';
    })();
    var out = byRule ? (byRule + (f ? ' + ' + base : '')) : base;
    if (bySearch) out += (out ? ' · ' : '') + bySearch;
    return out;
  }

  function refreshReview() {
    if (!UI.result) return;
    var total = 0, done = 0;
    UI.result.groups.forEach(function (g, si) {
      var fails = g.failRows || [];
      var chip = $('grv-' + si);
      if (!fails.length) { if (chip) chip.textContent = '复核 0/0'; return; }
      var ok = 0;
      for (var i = 0; i < fails.length; i++) if (UI.reviewed[reviewKey(g, fails[i])]) ok++;
      total += fails.length;
      done += ok;
      if (chip) chip.textContent = '复核 ' + ok + '/' + fails.length;
      var card = $('grp-' + si);
      var box = card && card.querySelector('.grpBox');
      if (box) {
        box.checked = (ok === fails.length);
        box.indeterminate = (ok > 0 && ok < fails.length);
        card.classList.toggle('allrev', ok === fails.length);
      }
    });
    var tile = $('rvStat');
    if (tile) tile.querySelector('b').textContent = done + '/' + total;
    if ($('resHint')) {
      $('resHint').textContent = resFilterText() + '。已复核 ' + done + ' / 不符合 ' + total + '。渲染 ' + UI.resMs + ' ms' +
        '。反焊盘 ' + (checkEnabled()['反焊盘尺寸'] ? '开' : '关') + '，焊盘 ' + (checkEnabled()['焊盘尺寸'] ? '开' : '关') + '，非功能焊盘 ' + (checkEnabled()['非功能焊盘尺寸'] ? '开' : '关') + '。';
    }
  }

  function renderResults() {
    var r = UI.result;
    var out = $('checkOut');
    if (!out) return;
    if (!r) {
      out.innerHTML = '';
      out.dataset.ver = '';
      if ($('resStats')) $('resStats').innerHTML = '';
      if ($('legendOut')) $('legendOut').innerHTML = '';
      if ($('resChips')) $('resChips').innerHTML = '';
      if ($('resHint')) $('resHint').textContent = '尚未产生检查结果。';
      return;
    }
    var rf = effectiveResFilter();
    var ver = UI.dataVer + '-' + UI.viewVer + '-' + UI.resLimit + '-' + rf + '-' + (UI.resRule || '') + '-' + (UI.resSearch || '');
    if (out.dataset.ver === ver) {
      refreshReview();
      return;
    }
    var t0 = App.nowMs();
    var rc = resultCounts();
    var bad = rc.bad, rowsAll = rc.rows, noRule = rc.norule;
    if ($('resStats')) {
      $('resStats').innerHTML =
        '<div class="stat click' + (rf === 'bad' ? ' on' : '') + '" data-res="bad" data-tip="点击切换仅看不符合项"><b class="' + (bad ? 'bad' : 'ok') + '">' + bad + '</b><span class="hint">不符合</span></div>' +
        '<div class="stat"><b>' + rowsAll + '</b><span class="hint">检查记录</span></div>' +
        '<div class="stat click' + (rf === 'matched' ? ' on' : '') + '" data-res="matched" data-tip="点击切换仅看已配对过孔"><b>' + rc.matched + '</b><span class="hint">已配对过孔</span></div>' +
        '<div class="stat"><b>' + r.unmatchedCircles.length + '</b><span class="hint">未配对铜皮</span></div>' +
        '<div class="stat click' + (rf === 'norule' ? ' on' : '') + '" data-res="norule" data-tip="点击切换仅看未推算到约束的过孔"><b>' + noRule + '</b><span class="hint">没推算到约束</span></div>' +
        '<div class="stat" id="rvStat"><b>0/0</b><span class="hint">已复核</span></div>';
    }

    var h = '';
    var totalGroups = resultGroupTotal(rf);
    if (!totalGroups) {
      h += '<div class="card"><div class="hint">按「' + esc(resFilterText()) + '」筛完没有记录。</div></div>';
    }
    var shownGroups = 0;
    UI.groupKeys = {};
    for (var si = 0; si < r.groups.length && shownGroups < UI.resLimit; si++) {
      var g = r.groups[si];
      if (!resultGroupMatch(g, rf)) continue;
      shownGroups++;
      UI.groupKeys[si] = (g.failRows || []).map(function (row) { return reviewKey(g, row); });
      var rows = (rf === 'bad') ? g.failRows : g.rows;
      var failCount = (g.failRows || []).length;
      h += '<div class="set ' + esc(g.keys.kind || '其他') + '" id="grp-' + si + '"><div class="hd">' +
        '<span class="badge">Via ' + g.via.id + '</span><b>' + esc(g.via.net || '无网络') + '</b>' +
        '<span>' + esc(g.via.padstack || '无 Padstack') + '</span>' +
        '<span class="badge rev" style="margin-left:auto" id="grv-' + si + '" data-tip="点击整组切换复核状态">复核 0/' + failCount + '</span>' +
        (failCount ? ('<label class="grpRvw" data-tip="将本孔所有不符合项一次标为已复核"><input type="checkbox" class="grpBox" data-no-persist data-si="' + si + '">总复核</label>') : '') +
        '<span>约束 ' + (g.rule ? esc(g.rule.title) : '未推算到') + '</span></div><div class="body">' +
        '<div class="srcnote">提取：' + esc(keyTxt(g)) + (g.note ? ' · ' + esc(g.note) : '') + (g.via.connections ? ' · ' + esc(g.via.connections) : '') + '</div>';
      if (!rows.length) {
        h += '<div class="hint">该过孔附近无圆形铜皮。</div>';
      } else {
        h += '<table><thead><tr><th class="rvw">复核</th><th>层</th><th>Subset</th><th>检查项</th><th>实测</th><th>规则值</th><th>结果</th></tr></thead><tbody>';
        rows.forEach(function (row) {
          var fail = row.status === '不符合';
          var rk = reviewKey(g, row);
          var rvd = fail && !!UI.reviewed[rk];
          var layerDisplay = (typeof row.layer === 'number' && row.layer > 0) ? ('L' + row.layer) : (String(row.layer).startsWith('L') ? row.layer : (row.layer === '—' ? '—' : ('L' + row.layer)));
          var reasonTooltip = row.reason ? (' title="' + esc(row.reason) + '" data-tip="' + esc(row.reason) + '"') : '';
          h += '<tr class="' + (fail ? 'fail ' : '') + (rvd ? 'reviewed' : '') + '" data-rk="' + esc(rk) + '">' +
            '<td class="rvw">' + (fail ? ('<input type="checkbox" class="rvwBox" data-no-persist data-rk="' + esc(rk) + '"' + (rvd ? ' checked' : '') + ' data-tip="勾选标记已人工复核">') : '') + '</td>' +
            '<td>' + esc(layerDisplay) + '</td><td>' + esc(row.subset) + '</td><td>' + esc(row.checkType) + '</td>' +
            '<td class="' + (fail ? 'bad' : '') + '"' + reasonTooltip + '>' + esc(row.actual) + '</td><td' + reasonTooltip + '>' + esc(row.expect || '无') + '</td>' +
            '<td class="' + (fail ? 'bad' : (row.status === '符合' ? 'ok' : 'muted')) + '"' + reasonTooltip + '><span class="resTxt">' + esc(row.status) + '</span>' +
            (fail ? '<span class="rvTag"' + (rvd ? '' : ' style="display:none"') + '>已复核</span>' : '') + '</td></tr>';
        });
        h += '</tbody></table>';
      }
      h += '</div></div>';
    }
    if (totalGroups > shownGroups) {
      h += '<div class="row" style="margin:12px 0"><button type="button" class="btn gray" id="btnMoreRes">显示更多 · 剩余 ' + (totalGroups - shownGroups) + ' 组</button>' +
        '<button type="button" class="btn gray" id="btnMoreResAll">全部展开</button></div>';
    }
    out.innerHTML = h || '<div class="card"><div class="hint">暂无结果，请先在 ③ 导入数据 载入 Item 数据。</div></div>';
    out.dataset.ver = ver;
    renderChips();
    UI.resMs = App.viewMs(t0);
    updatePerf();
    if (tabVisible('tab-legend')) renderLegend();
    [['btnOnlyBad', 'bad'], ['btnOnlyMatched', 'matched'], ['btnOnlyNoRule', 'norule']].forEach(function (x) {
      var b = $(x[0]);
      if (b) b.classList.toggle('on', rf === x[1]);
    });
    if ($('btnAllRows')) $('btnAllRows').classList.toggle('on', !rf);
    refreshReview();
  }

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

  root.runCheck = runCheck;
  root.renderMatch = renderMatch;
  root.renderResults = renderResults;
  root.renderChips = renderChips;
  root.renderLegend = renderLegend;
  root.onSearchInput = onSearchInput;
  root.locateVia = locateVia;
  root.clearSearch = clearSearch;

  bindResultsEvents();
  App.syncPin();
})(typeof window !== 'undefined' ? window : globalThis);
