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
    if (typeof App.renderLegend === "function") return App.renderLegend(force);
  }

  Object.assign(App, {
    checkEnabled: checkEnabled,
    keyTxt: keyTxt,
    updatePerf: updatePerf,
    tabVisible: tabVisible,
    renderVisible: renderVisible,
    runCheck: runCheck,
    renderMatch: renderMatch,
    reviewKey: reviewKey,
    viaGroupMatchSearch: viaGroupMatchSearch,
    renderChips: renderChips,
    effectiveResFilter: effectiveResFilter,
    resultGroupMatch: resultGroupMatch,
    resultGroupTotal: resultGroupTotal,
    refreshReview: refreshReview,
    renderResults: renderResults
  });

  root.runCheck = runCheck;
  root.renderMatch = renderMatch;
  root.renderResults = renderResults;
  root.renderChips = renderChips;
})(typeof window !== "undefined" ? window : globalThis);
