/* ============================================================================
 * pour-results-ui.js —— 铜皮检查模块：指标统计、聚合结果明细、复核联动与规律分析
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var esc = root.escHtml || function (str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  var cleanMsg = root.PourCleanMsg || function (s) {
    return String(s == null ? '' : s).replace(/^[\s✅❌⚠️]+/u, '').trim();
  };

  function updateTopKPIs() {
    var State = root.State;
    var s = State.summary;
    var elShapes = document.getElementById('statTotalShapes');
    var elViasTraces = document.getElementById('statViasTraces');
    var elDefects = document.getElementById('statTotalDefects');
    var elPass = document.getElementById('statTotalPass');
    var elBadgeDefects = document.getElementById('badgeDefectCount');

    if (!s) {
      if (elShapes) elShapes.textContent = '0';
      if (elViasTraces) elViasTraces.textContent = '0 / 0';
      if (elDefects) elDefects.textContent = '0';
      if (elPass) elPass.textContent = '0';
      if (elBadgeDefects) elBadgeDefects.textContent = '0';
      return;
    }

    var defVal = String(s.totalGroupedDefects != null ? s.totalGroupedDefects : s.totalDefects);
    if (elShapes) elShapes.textContent = String(s.totalShapes);
    if (elViasTraces) elViasTraces.textContent = s.totalVias + ' / ' + s.totalTraces;
    if (elDefects) elDefects.textContent = defVal;
    if (elPass) elPass.textContent = String(s.passCount);
    if (elBadgeDefects) elBadgeDefects.textContent = defVal;

    var elFilterAll = document.getElementById('cntFilterAll');
    var elFilterDefects = document.getElementById('cntFilterDefects');
    var totalObj = State.groupedResults ? State.groupedResults.length : s.totalChecks;
    var defectObj = State.groupedResults ? State.groupedResults.filter(function (g) { return !g.pass; }).length : s.totalDefects;
    if (elFilterAll) elFilterAll.textContent = String(totalObj);
    if (elFilterDefects) elFilterDefects.textContent = String(defectObj);
  }

  function setViewMode(mode) {
    var State = root.State;
    State.viewMode = mode;
    var btnG = document.getElementById('btnViewModeGrouped');
    var btnF = document.getElementById('btnViewModeFlat');
    if (btnG) btnG.className = 'btn small ' + (mode === 'grouped' ? 'pri' : 'sec');
    if (btnF) btnF.className = 'btn small ' + (mode === 'flat' ? 'pri' : 'sec');
    applyFilters();
  }

  function setCategoryFilter(catKey) {
    var State = root.State;
    State.categoryFilter = catKey;
    var filterBtns = {
      all: 'btnFilterAll',
      defects: 'btnFilterDefects',
      via_coverage: 'btnFilterCov',
      special_shape: 'btnFilterSpecial',
      trace_ref_margin: 'btnFilterMargin',
      isolated_copper: 'btnFilterSmall',
      arc_radius: 'btnFilterArc'
    };

    Object.keys(filterBtns).forEach(function (k) {
      var btn = document.getElementById(filterBtns[k]);
      if (btn) btn.className = 'btn small ' + (k === catKey ? 'pri' : 'sec');
    });

    applyFilters();
  }

  function applyFilters() {
    var State = root.State;
    var inp = document.getElementById('inpSearch');
    var query = (inp && inp.value ? inp.value : '').trim().toLowerCase();
    var source = State.viewMode === 'grouped' ? (State.groupedResults || []) : (State.rawResults || []);

    var list = source.filter(function (r) {
      if (State.categoryFilter === 'defects' && r.pass) return false;
      if (State.categoryFilter !== 'all' && State.categoryFilter !== 'defects') {
        if (r.checkCategory !== State.categoryFilter) return false;
      }
      if (query) {
        var str = [
          r.checkCategoryName || '',
          r.viaId || '',
          r.viaPadstack || '',
          r.viaNet || '',
          r.traceNet || '',
          r.layer || '',
          r.layerListStr || '',
          r.shapeId || '',
          r.message || ''
        ].join(' ').toLowerCase();
        if (str.indexOf(query) < 0) return false;
      }
      return true;
    });

    State.filteredResults = list;
    State.page = 1;
    renderResultsTable();
  }

  function toggleRowExpand(groupKey) {
    var State = root.State;
    if (State.expandedRows.has(groupKey)) {
      State.expandedRows.delete(groupKey);
    } else {
      State.expandedRows.add(groupKey);
    }
    renderResultsTable();
  }

  function buildItemKey(r, idx) {
    return r.groupKey || (r.checkCategory + '_' + (r.viaId || r.traceId || r.shapeId) + '_' + r.layer + '_' + idx);
  }

  function formatRowMetrics(r) {
    var PC = root.PourChecker;
    var rn = PC && PC.roundN ? PC.roundN : function (v, n) { return Number(v || 0).toFixed(n || 1); };
    if (r.metricsStr) return esc(r.metricsStr);
    if (r.checkCategory === 'via_coverage') {
      return '实测距铜皮: <strong>' + esc(r.actualDistStr) + '</strong> / 要求 ≤ ' + esc(r.requiredDist) + ' mil';
    }
    if (r.checkCategory === 'special_shape') {
      return '实测面积: <strong>' + esc(rn(r.actualArea, 1)) + ' sq mil</strong> / 期望 ' + esc(r.expectedArea);
    }
    if (r.checkCategory === 'trace_ref_margin') {
      return '单侧外延: <strong>' + esc(rn(r.actualMargin, 1)) + ' mil</strong> / 要求 ≥ ' + esc(r.minMargin) + ' mil';
    }
    if (r.checkCategory === 'isolated_copper') {
      return '铜皮面积: <strong>' + esc(rn(r.area, 1)) + ' sq mil</strong> / 阈值 &lt; ' + esc(r.areaThreshold);
    }
    if (r.checkCategory === 'arc_radius') {
      return '实测半径: <strong>' + esc(rn(r.actualRadius, 2)) + ' mil</strong> / 要求 ≥ ' + esc(r.requiredRadius) + ' mil';
    }
    return '-';
  }

  function renderResultsTable() {
    var State = root.State;
    var tbody = document.getElementById('tblResultsBody');
    if (!tbody) return;

    var list = State.filteredResults || [];
    var total = list.length;
    var lblTotal = document.getElementById('lblTotalCount');
    if (lblTotal) lblTotal.textContent = String(total);

    if (total === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:28px;color:var(--sub)">' +
        (State.rawResults.length === 0 ? '请先在工序 ② 导入数据并执行检查' : '无符合当前筛选条件的检查记录') +
        '</td></tr>';
      document.getElementById('lblPageStart').textContent = '0';
      document.getElementById('lblPageEnd').textContent = '0';
      document.getElementById('lblCurrentPage').textContent = '1 / 1';
      return;
    }

    var pageSize = State.pageSize;
    var totalPages = Math.ceil(total / pageSize);
    if (State.page > totalPages) State.page = totalPages;
    if (State.page < 1) State.page = 1;

    var startIdx = (State.page - 1) * pageSize;
    var endIdx = Math.min(startIdx + pageSize, total);
    var slice = list.slice(startIdx, endIdx);

    document.getElementById('lblPageStart').textContent = String(startIdx + 1);
    document.getElementById('lblPageEnd').textContent = String(endIdx);
    document.getElementById('lblCurrentPage').textContent = State.page + ' / ' + totalPages;

    var htmlRows = '';
    slice.forEach(function (r, idx) {
      var itemKey = buildItemKey(r, startIdx + idx);
      var safeKey = esc(itemKey);
      var isReviewed = State.reviewedItems.has(itemKey);
      var rowClass = isReviewed ? 'reviewed' : (r.pass ? 'row-pass' : 'row-fail');
      var isExpanded = State.expandedRows.has(itemKey);

      var targetStr = r.targetLabel;
      if (!targetStr) {
        if (r.viaId) targetStr = '孔 #' + r.viaId + ' · ' + (r.viaNet || 'GND');
        else if (r.traceId) targetStr = '走线 #' + r.traceId + ' · ' + (r.traceNet || '-');
        else if (r.shapeId) targetStr = '铜皮 Shape #' + r.shapeId;
        else targetStr = '-';
      }

      var hasSub = r.subRecords && r.subRecords.length > 1;
      var targetId = r.viaId || r.traceId || r.shapeId || '';
      var statusText = r.pass ? '符合' : ('不符合' + (r.failCount ? ' · ' + r.failCount + ' 层超标' : ''));

      htmlRows += '<tr class="' + rowClass + '">' +
        '<td><input type="checkbox" data-no-persist ' + (isReviewed ? 'checked' : '') + ' onchange="toggleReviewItem(\'' + safeKey + '\', this.checked)"></td>' +
        '<td><span class="badge-tag copper">' + esc(r.checkCategoryName) + '</span></td>' +
        '<td><strong>' + esc(targetStr) + '</strong></td>' +
        '<td><span class="badge-tag gray">' + esc(r.layerListStr || r.layer || '-') + '</span></td>' +
        '<td style="font-size:12px">' + formatRowMetrics(r) + '</td>' +
        '<td><span class="badge-tag ' + (r.pass ? 'ok' : 'bad') + '">' + esc(statusText) + '</span></td>' +
        '<td style="font-size:12px;line-height:1.45">' + esc(cleanMsg(r.message)) + '</td>' +
        '<td><label style="font-size:12px;display:inline-flex;align-items:center;gap:4px;cursor:pointer">' +
          '<input type="checkbox" data-no-persist ' + (isReviewed ? 'checked' : '') + ' onchange="toggleReviewItem(\'' + safeKey + '\', this.checked)">' +
          '<span>' + (isReviewed ? '已复核' : '待复核') + '</span>' +
        '</label></td>' +
        '<td><div class="row" style="gap:4px;flex-wrap:nowrap">' +
          '<button type="button" class="btn small sec" data-tip="在 2D 视口中居中定位并同步复核" onclick="locateElementInCanvas(\'' + esc(r.checkCategory) + '\', \'' + esc(targetId) + '\', \'' + safeKey + '\')">定位</button>' +
          (hasSub
            ? '<button type="button" class="btn small ' + (isExpanded ? 'pri' : 'sec') + '" onclick="toggleRowExpand(\'' + safeKey + '\')">' +
                (isExpanded ? '▼ 收起' : ('▶ 明细 ' + r.subRecords.length)) +
              '</button>'
            : '') +
        '</div></td>' +
      '</tr>';

      if (hasSub && isExpanded) {
        htmlRows += '<tr class="subrow"><td></td><td colspan="8" style="padding:10px 14px">' +
          '<div style="font-weight:700;font-size:12px;margin-bottom:6px;color:var(--pri-d)">' +
            esc(targetStr) + ' · 逐层检查拆解 · 共 ' + r.subRecords.length + ' 项' +
          '</div>' +
          '<div class="tbl-wrap">' +
            '<table style="font-size:12px"><thead><tr>' +
              '<th>层别 / 参考层</th><th>实测参数</th><th>规则阈值</th><th>结论</th><th>说明</th>' +
            '</tr></thead><tbody>' +
            r.subRecords.map(function (sub) {
              var actual = sub.actualDistStr || (sub.actualMargin != null ? sub.actualMargin + ' mil' : (sub.actualRadius != null ? sub.actualRadius + ' mil' : '-'));
              var req = sub.requiredDist ? ('≤ ' + sub.requiredDist + ' mil') : (sub.minMargin ? ('≥ ' + sub.minMargin + ' mil') : ('≥ ' + (sub.requiredRadius || 10) + ' mil'));
              return '<tr>' +
                '<td><span class="badge-tag gray">' + esc(sub.layer || sub.refLayer || '-') + '</span></td>' +
                '<td><strong>' + esc(actual) + '</strong></td>' +
                '<td>' + esc(req) + '</td>' +
                '<td><span class="badge-tag ' + (sub.pass ? 'ok' : 'bad') + '">' + (sub.pass ? '符合' : '不符合') + '</span></td>' +
                '<td class="hint">' + esc(cleanMsg(sub.message)) + '</td>' +
              '</tr>';
            }).join('') +
            '</tbody></table>' +
          '</div>' +
        '</td></tr>';
      }
    });

    tbody.innerHTML = htmlRows;
  }

  function changePage(delta) {
    root.State.page += delta;
    renderResultsTable();
  }

  function toggleReviewItem(key, reviewed) {
    var State = root.State;
    var nextVal = reviewed !== undefined ? Boolean(reviewed) : !State.reviewedItems.has(key);
    if (nextVal) State.reviewedItems.add(key);
    else State.reviewedItems.delete(key);
    renderResultsTable();
    if (State.activeReviewKey === key && typeof root.renderPourCanvasReviewBox === 'function') {
      root.renderPourCanvasReviewBox(key);
    }
    if (typeof root.renderCanvas === 'function') {
      root.renderCanvas();
    }
  }

  function toggleSelectAll(masterChk) {
    var State = root.State;
    (State.filteredResults || []).forEach(function (r, idx) {
      var key = buildItemKey(r, idx);
      if (masterChk && masterChk.checked) State.reviewedItems.add(key);
      else State.reviewedItems.delete(key);
    });
    renderResultsTable();
  }

  function exportResultsCSV() {
    var State = root.State;
    var source = State.viewMode === 'grouped' ? (State.groupedResults || []) : (State.rawResults || []);
    if (!source.length) {
      root.alert('暂无检查结果可导出');
      return;
    }

    var csv = '\uFEFF检查分类,目标对象,涉及层别,实测与规则说明,判定结果,详细文字表述,复核状态\n';
    source.forEach(function (r, idx) {
      var key = buildItemKey(r, idx);
      var isRev = State.reviewedItems.has(key) ? '已复核' : '待复核';
      var target = r.targetLabel || (r.viaId ? ('孔 #' + r.viaId) : (r.traceId ? ('走线 #' + r.traceId) : ('铜皮 #' + r.shapeId)));
      var metricRaw = String(r.metricsStr || r.actualDistStr || r.actualMargin || r.area || '-');
      csv += [
        '"' + String(r.checkCategoryName || '').replace(/"/g, '""') + '"',
        '"' + String(target).replace(/"/g, '""') + '"',
        '"' + String(r.layerListStr || r.layer || r.traceLayer || '-').replace(/"/g, '""') + '"',
        '"' + metricRaw.replace(/"/g, '""') + '"',
        '"' + (r.pass ? '符合' : '不符合') + '"',
        '"' + cleanMsg(r.message).replace(/"/g, '""') + '"',
        '"' + isRev + '"'
      ].join(',') + '\n';
    });

    var filename = 'copper_pour_inspection_' + State.viewMode + '_' + Date.now() + '.csv';
    var modeTxt = State.viewMode === 'grouped' ? '按目标对象汇总' : '逐层明细平铺';
    root.showExportBox(filename, csv, '共导出 ' + source.length + ' 项铜皮检查记录 · ' + modeTxt + '。', 'text/csv');
  }

  /* ---------- 工序 ⑤：缺陷规律与工程分析 ---------- */
  function renderReasonNetBadges(byNet) {
    var keys = Object.keys(byNet || {});
    if (!keys.length) return '<span class="hint">无网络</span>';
    keys.sort(function (a, b) {
      var lenA = (byNet[a] || []).length;
      var lenB = (byNet[b] || []).length;
      return lenB - lenA || a.localeCompare(b);
    });
    return '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">' +
      keys.map(function (netName) {
        var list = byNet[netName] || [];
        var itemStr = list.slice(0, 5).map(function (id) { return '#' + id; }).join('、') +
          (list.length > 5 ? (' 等' + list.length + '个') : '');
        return '<span style="display:inline-flex;align-items:center;background:#ffffff;border:1px solid var(--line-strong);border-radius:4px;padding:2px 6px;font-size:11px;font-family:var(--mono)">' +
          '<code>' + esc(netName) + '</code>' +
          '<span style="color:var(--sub);margin-left:4px;font-size:11px">' + list.length + '项: ' + esc(itemStr) + '</span>' +
        '</span>';
      }).join('') +
    '</div>';
  }

  function renderAnalysisTab() {
    var State = root.State;
    var container = document.getElementById('pnlAnalysisContainer');
    if (!container) return;
    if (!State.summary || !State.rawResults || !State.rawResults.length) {
      container.innerHTML = '<div style="text-align:center;padding:36px;color:var(--sub)">尚无检查数据，请先在工序 ② 导入数据并执行检查。</div>';
      return;
    }

    var PC = root.PourChecker;
    var rn = PC && PC.roundN ? PC.roundN : function (v, n) { return Number(v || 0).toFixed(n || 1); };
    var b = State.summary.breakdown;
    var defects = State.rawResults.filter(function (r) { return !r.pass; });
    var badTotal = defects.length;

    var layerBadMap = {};
    defects.forEach(function (r) {
      var lk = r.layer || r.traceLayer || '未知层';
      layerBadMap[lk] = (layerBadMap[lk] || 0) + 1;
    });

    var badMap = {};
    defects.forEach(function (r) {
      var ruleTitle = '铜皮规则约束';
      var padName = '-';
      if (r.checkCategory === 'via_coverage') {
        ruleTitle = r.viaPadstack || '孔铺铜覆盖规则';
        padName = r.viaPadstack || 'HDI过孔';
      } else if (r.checkCategory === 'special_shape') {
        ruleTitle = r.templateName || ((r.viaPadstack || '过孔') + '·异型模板');
        padName = r.viaPadstack || 'BGA过孔';
      } else if (r.checkCategory === 'trace_ref_margin') {
        ruleTitle = (r.traceLayer || '信号层') + '·走线参考层超宽';
        padName = '走线层: ' + (r.traceLayer || '-');
      } else if (r.checkCategory === 'isolated_copper') {
        ruleTitle = '全板孤立小铜皮 < ' + (r.areaThreshold || 500) + ' sq mil';
        padName = 'Shape #' + r.shapeId;
      } else if (r.checkCategory === 'arc_radius') {
        ruleTitle = '全板铜皮圆弧半径 < ' + (r.requiredRadius || 10) + ' mil';
        padName = 'Shape #' + r.shapeId;
      }

      var bKey = ruleTitle + ' · ' + r.checkCategoryName;
      if (!badMap[bKey]) {
        badMap[bKey] = { title: ruleTitle, checkType: r.checkCategoryName, n: 0, padstacks: {}, reasons: {} };
      }
      badMap[bKey].n++;
      badMap[bKey].padstacks[padName] = 1;

      var lk = r.layer || r.traceLayer || r.refLayer || '通用层';
      var netName = r.viaNet || r.traceNet || (r.shapeId ? ('Shape #' + r.shapeId) : 'GND');
      var targetId = r.viaId || r.traceId || r.shapeId || 0;
      var reasonHtml = '';

      if (r.checkCategory === 'via_coverage') {
        reasonHtml = '<b style="color:var(--bad)">无铜皮覆盖</b> · 距孔心 &gt; ' + esc(r.requiredDist || 50) + ' mil';
      } else if (r.checkCategory === 'special_shape') {
        reasonHtml = '<b style="color:var(--bad)">异型面积超差</b> · 实测 ' + esc(rn(r.actualArea, 1)) + ' sq mil vs 期望 ' + esc(r.expectedArea) + ' ± ' + esc(r.areaTolerance);
      } else if (r.checkCategory === 'trace_ref_margin') {
        reasonHtml = '<b style="color:var(--bad)">参考层外延不足</b> · ' + esc(r.refType) + ' ' + esc(r.refLayer) + ' 实测 ' + esc(rn(r.actualMargin, 1)) + ' mil &lt; ' + esc(r.minMargin) + ' mil';
      } else if (r.checkCategory === 'isolated_copper') {
        reasonHtml = '<b style="color:var(--bad)">无连接孤立碎铜</b> · 面积 ' + esc(rn(r.area, 1)) + ' sq mil &lt; ' + esc(r.areaThreshold) + ' sq mil';
      } else if (r.checkCategory === 'arc_radius') {
        reasonHtml = '<b style="color:var(--bad)">圆弧半径过小</b> · 第 ' + esc(r.arcIndex || 1) + ' 段半径 ' + esc(rn(r.actualRadius, 2)) + ' mil &lt; ' + esc(r.requiredRadius) + ' mil';
      }

      var subKey = lk + '|' + reasonHtml;
      if (!badMap[bKey].reasons[subKey]) {
        badMap[bKey].reasons[subKey] = { layer: lk, reason: reasonHtml, n: 0, targets: {}, byNet: {} };
      }
      badMap[bKey].reasons[subKey].n++;
      badMap[bKey].reasons[subKey].targets[targetId] = 1;
      if (!badMap[bKey].reasons[subKey].byNet[netName]) badMap[bKey].reasons[subKey].byNet[netName] = [];
      if (badMap[bKey].reasons[subKey].byNet[netName].indexOf(targetId) < 0) {
        badMap[bKey].reasons[subKey].byNet[netName].push(targetId);
      }
    });

    var h = '<div class="card">';
    h += '<h3 style="margin-top:0;color:var(--heading)">各规则不符合原因与目标网络映射明细' +
      (badTotal ? (' · 共 <span style="color:var(--bad)">' + badTotal + '</span> 条') : '') + '</h3>';

    if (!badTotal) {
      h += '<div class="hint" style="color:var(--ok);font-weight:600">当前检查全部符合规则约束，无超标记录。</div>';
    } else {
      var layerKeys = Object.keys(layerBadMap).sort(function (a, b) { return layerBadMap[b] - layerBadMap[a]; });
      h += '<div style="margin:8px 0 14px 0"><span class="hint" style="font-weight:600">按层分布：</span>' +
        '<div class="row" style="gap:6px;margin-top:4px">' +
        layerKeys.map(function (lk) {
          return '<span style="padding:2px 8px;border-radius:4px;background:var(--surface-subtle);border:1px solid var(--line);font-size:12px">' +
            esc(lk) + '：<b style="color:var(--bad)">' + layerBadMap[lk] + '</b> 条</span>';
        }).join('') +
        '</div></div>';

      var badKeys = Object.keys(badMap).sort(function (a, b) { return badMap[b].n - badMap[a].n; });
      h += '<div class="tbl-wrap"><table><thead><tr>' +
        '<th style="width:200px">规则 · 检查项</th>' +
        '<th style="width:72px">条数</th>' +
        '<th>具体原因与对应过孔/走线网络</th>' +
        '<th style="width:170px">Padstack / 目标层</th>' +
      '</tr></thead><tbody>';

      badKeys.forEach(function (k) {
        var v = badMap[k];
        var subReasons = Object.keys(v.reasons).map(function (srk) { return v.reasons[srk]; }).sort(function (a, b) { return b.n - a.n; });
        var detailHtml = '<div style="display:flex;flex-direction:column;gap:8px">';
        subReasons.forEach(function (sr) {
          var netCount = Object.keys(sr.byNet).length;
          var targetCount = Object.keys(sr.targets).length;
          detailHtml += '<div style="padding:8px 10px;border-radius:6px;background:var(--surface-subtle);border:1px solid var(--line)">' +
            '<div style="font-size:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px">' +
              '<div><b>' + esc(sr.layer) + '</b>：' + sr.reason + '</div>' +
              '<div style="color:var(--bad);font-weight:700;white-space:nowrap">' + sr.n + ' 条 · ' + targetCount + ' 对象</div>' +
            '</div>' +
            '<div style="margin-top:4px;font-size:11px;color:var(--sub)">' +
              '<span style="font-weight:600">关联网络 ' + netCount + ' 个：</span>' +
              renderReasonNetBadges(sr.byNet) +
            '</div>' +
          '</div>';
        });
        detailHtml += '</div>';

        h += '<tr>' +
          '<td style="vertical-align:top"><b>' + esc(k) + '</b></td>' +
          '<td style="color:var(--bad);font-size:15px;font-weight:700;vertical-align:top;font-family:var(--mono)">' + v.n + '</td>' +
          '<td>' + detailHtml + '</td>' +
          '<td class="hint" style="font-size:11px;vertical-align:top">' + esc(Object.keys(v.padstacks).join('、')) + '</td>' +
        '</tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';

    var topLayersText = Object.keys(layerBadMap).map(function (l) {
      return esc(l) + ' ' + layerBadMap[l] + ' 条';
    }).join('、') || '各内层';

    h += '<div class="pattern-card">' +
      '<h3><span>① 孔经过层铺铜覆盖检查 — 缺陷规律与工程分析</span>' +
      '<span class="badge-tag ' + (b.viaCoverageDefects > 0 ? 'bad' : 'ok') + '">' + b.viaCoverageDefects + ' 处层位不符合</span></h3>' +
      '<div class="pattern-box">' +
        '<strong>高发分布与 SI 影响：</strong>异常集中在 <strong>' + topLayersText + '</strong>。过孔穿越层缺失参考铜箔或反焊盘避让过大，导致寄生电感上升、特征阻抗突跳与回流路径拉长。' +
      '</div>' +
      '<div class="hint"><strong>整改措施：</strong>在对应内层补充接地铜皮，高速差分过孔周边 30–50 mil 增设 GND 回流伴随孔。</div>' +
    '</div>';

    h += '<div class="pattern-card">' +
      '<h3><span>② 特定异型铜皮比对检查 — 缺陷规律与工程分析</span>' +
      '<span class="badge-tag ' + (b.specialShapeDefects > 0 ? 'bad' : 'ok') + '">' + b.specialShapeDefects + ' 处异型铜皮不匹配</span></h3>' +
      '<div class="pattern-box">' +
        '<strong>偏差成因：</strong>指定层过孔周围未生成异型泪滴铜皮，或铜皮被邻近网络反焊盘切割导致面积超出容差。' +
      '</div>' +
      '<div class="hint"><strong>整改措施：</strong>核查 EDA 泪滴与异型铜皮脚本层映射规则，修复相邻反焊盘侵占区域后重新铺铜。</div>' +
    '</div>';

    h += '<div class="pattern-card">' +
      '<h3><span>③ 走线参考层铺铜覆盖与单侧超宽 — 缺陷规律与工程分析</span>' +
      '<span class="badge-tag ' + (b.traceMarginDefects > 0 ? 'bad' : 'ok') + '">' + b.traceMarginDefects + ' 处参考层异常</span></h3>' +
      '<div class="pattern-box">' +
        '<strong>外延不足与跨分割机理：</strong>走线靠近参考地平面边缘或跨越平面挖空区，边缘电力线无法闭合于参考平面，造成特征阻抗偏高与边缘辐射。' +
      '</div>' +
      '<div class="hint"><strong>整改措施：</strong>外扩上下参考平面边界确保单侧外延 ≥ 设定阈值，禁止高速差分对紧贴分割槽布线。</div>' +
    '</div>';

    h += '<div class="pattern-card">' +
      '<h3><span>④ 孤立小铜皮检查 — 缺陷规律与工程分析</span>' +
      '<span class="badge-tag ' + (b.smallCopperDefects > 0 ? 'bad' : 'ok') + '">' + b.smallCopperDefects + ' 处孤立小铜皮 &lt; ' + esc(State.smallCopperAreaThreshold) + ' sq mil</span></h3>' +
      '<div class="pattern-box">' +
        '<strong>浮空碎铜风险：</strong>密集过孔阵列间隙残留无网络过孔连接的浮空铜岛，高频下形成耦合辐射单元并在回流焊受热时增加起泡风险。' +
      '</div>' +
      '<div class="hint"><strong>整改措施：</strong>在 EDA 铺铜管理器启用孤立铜岛自动清理，删除面积低于阈值的无连接碎铜。</div>' +
    '</div>';

    h += '<div class="pattern-card">' +
      '<h3><span>⑤ 铜皮最小圆弧半径检查 — 缺陷规律与工程分析</span>' +
      '<span class="badge-tag ' + (b.arcRadiusDefects > 0 ? 'bad' : 'ok') + '">' + b.arcRadiusDefects + ' 处圆弧 &lt; ' + esc(State.minArcRadius) + ' mil</span></h3>' +
      '<div class="pattern-box">' +
        '<strong>制程蚀刻隐患：</strong>铜皮避让密集孔群拐角处圆弧半径过小，湿法蚀刻易滞留药液产生侧蚀酸角。' +
      '</div>' +
      '<div class="hint"><strong>整改措施：</strong>将动态铜皮平滑圆角半径统一设为 ≥ ' + esc(State.minArcRadius) + ' mil。</div>' +
    '</div>';

    container.innerHTML = h;
  }

  function exportAnalysisReport() {
    var State = root.State;
    if (!State.summary) {
      root.alert('暂无分析数据可导出');
      return;
    }

    var b = State.summary.breakdown;
    var totalObj = State.groupedResults ? State.groupedResults.length : State.summary.totalChecks;
    var defObj = State.groupedResults ? State.groupedResults.filter(function (g) { return !g.pass; }).length : State.summary.totalDefects;

    var report = [
      '# PCB 铜皮五项检查缺陷规律与工程分析报告',
      '生成时间: ' + new Date().toLocaleString(),
      '',
      '## 1. 全板检查统计',
      '- 导入铜皮总数: ' + State.summary.totalShapes + ' 块',
      '- 导入过孔总数: ' + State.summary.totalVias + ' 个',
      '- 导入走线总数: ' + State.summary.totalTraces + ' 条',
      '- 目标对象总数: ' + totalObj + ' 个',
      '- 检出缺陷对象: ' + defObj + ' 个 / 逐层超标项 ' + State.summary.totalDefects + ' 处',
      '',
      '## 2. 分类规律与整改措施',
      '### ① 孔经过层铺铜覆盖检查: ' + b.viaCoverageDefects + ' 处超标',
      '- 整改措施: 在相关内层补充参考铜皮，或周边 30–50 mil 增设 GND 回流孔。',
      '',
      '### ② 特定异型铜皮比对检查: ' + b.specialShapeDefects + ' 处超标',
      '- 整改措施: 核查指定层异型铜皮自动生成规则并修复反焊盘切割区域。',
      '',
      '### ③ 走线参考层超宽检查: ' + b.traceMarginDefects + ' 处超标',
      '- 整改措施: 外扩地平面边界确保单侧外延达标，消除跨分割走线。',
      '',
      '### ④ 孤立小铜皮检查: ' + b.smallCopperDefects + ' 处超标',
      '- 整改措施: 开启铺铜孤立死铜自动移除策略。',
      '',
      '### ⑤ 铜皮最小圆弧半径检查: ' + b.arcRadiusDefects + ' 处超标',
      '- 整改措施: 调整铜皮轮廓避让圆弧平滑半径至阈值以上。'
    ].join('\n');

    root.showExportBox('铜皮检查缺陷规律分析报告.md', report, '已生成 Markdown 分析报告。', 'text/markdown');
  }

  root.updateTopKPIs = updateTopKPIs;
  root.setViewMode = setViewMode;
  root.setCategoryFilter = setCategoryFilter;
  root.applyFilters = applyFilters;
  root.toggleRowExpand = toggleRowExpand;
  root.renderResultsTable = renderResultsTable;
  root.changePage = changePage;
  root.toggleReviewItem = toggleReviewItem;
  root.toggleSelectAll = toggleSelectAll;
  root.exportResultsCSV = exportResultsCSV;
  root.renderAnalysisTab = renderAnalysisTab;
  root.exportAnalysisReport = exportAnalysisReport;
})(typeof window !== 'undefined' ? window : globalThis);
