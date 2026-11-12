/* ============================================================================
 * unified-dashboard.js —— 仪表盘、统一缺陷清单、复核与规律分析
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
function updateMasterKPIs() {
  updateFilterCounters();
  const total = State.allChecks.length;
  const fails = State.allChecks.filter(c => !c.pass);
  const reviewed = fails.filter(c => State.reviewedSet.has(c.id)).length;

  $('kpiTotalChecks').textContent = total;
  $('kpiDefectCount').textContent = fails.length;
  $('kpiReviewProgress').textContent = `${reviewed} / ${fails.length}`;

  const activeEngineList = [
    State.results.trace,
    State.results.copper,
    State.results.dfm,
    State.results.fanout,
    State.results.pour
  ].filter(r => r && r.hasData !== false);

  if (activeEngineList.length === 0 && total === 0) {
    $('kpiHealthScore').textContent = '未评估';
    const circle = $('kpiScoreCircle');
    if (circle) {
      circle.textContent = '--';
      circle.className = 'score-circle a';
    }
    return;
  }

  const scores = activeEngineList.length > 0 ? activeEngineList.map(r => r.score) : [100];
  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  
  $('kpiHealthScore').textContent = `${avgScore} 分 · ${getGrade(avgScore)}`;
  const circle = $('kpiScoreCircle');
  if (circle) {
    circle.textContent = getGradeLetter(avgScore);
    circle.className = `score-circle ${getGradeLetter(avgScore).toLowerCase()}`;
  }
}

function updateFilterCounters() {
  const allCount = State.allChecks.length;
  const failCount = State.allChecks.filter(c => !c.pass).length;
  const passCount = State.allChecks.filter(c => c.pass).length;

  const failTrace = State.allChecks.filter(c => !c.pass && c.category === 'trace').length;
  const failCopper = State.allChecks.filter(c => !c.pass && c.category === 'copper').length;
  const failDfm = State.allChecks.filter(c => !c.pass && c.category === 'dfm').length;
  const failFanout = State.allChecks.filter(c => !c.pass && c.category === 'fanout').length;
  const failPour = State.allChecks.filter(c => !c.pass && c.category === 'pour').length;

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setVal('cntFilterAll', allCount);
  setVal('cntFilterFail', failCount);
  setVal('cntFilterTraceFail', failTrace);
  setVal('cntFilterFailTrace', failTrace);
  setVal('cntFilterCopperFail', failCopper);
  setVal('cntFilterFailCopper', failCopper);
  setVal('cntFilterDfmFail', failDfm);
  setVal('cntFilterFailDfm', failDfm);
  setVal('cntFilterFanoutFail', failFanout);
  setVal('cntFilterFailFanout', failFanout);
  setVal('cntFilterPourFail', failPour);
  setVal('cntFilterFailPour', failPour);
  setVal('cntFilterPass', passCount);

  // Also update badges
  setVal('badgeDefectCount', failCount);
  setVal('kpiDefectCount', failCount);
  setVal('kpiTotalChecks', allCount);
}

function getGrade(score) {
  if (score >= 90) return '优秀 A';
  if (score >= 70) return '合格 B';
  if (score >= 60) return '警告 C';
  return '高危 F';
}

function getGradeLetter(score) {
  if (score >= 90) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'F';
}

function renderDashboard() {
  const res = State.results;
  const fillCard = (scoreId, barId, badgeId, detailId, r, okDetailFn, badLabel) => {
    if (r && r.hasData === false) {
      $(scoreId).textContent = '--';
      $(barId).style.width = '0%';
      $(badgeId).className = 'tag-badge';
      $(badgeId).textContent = '未导入数据';
      $(detailId).textContent = '未导入对应 .txt 检查数据';
      return;
    }
    const bad = r.checks.filter(c => !c.pass).length;
    $(scoreId).textContent = `${r.score}%`;
    $(barId).style.width = `${r.score}%`;
    $(badgeId).className = `tag-badge ${bad ? 'bad' : 'ok'}`;
    $(badgeId).textContent = bad ? `${bad} ${badLabel}` : '合格';
    $(detailId).textContent = okDetailFn(r, bad);
  };

  // 1. Trace Card
  fillCard('dashTraceScore', 'barTrace', 'dashTraceBadge', 'dashTraceDetail', res.trace,
    (r, bad) => `总 ${r.checks.length} 项检查 | 不符合 ${bad}`, '处不符合');

  // 2. Copper Card
  fillCard('dashCopperScore', 'barCopper', 'dashCopperBadge', 'dashCopperDetail', res.copper,
    (r, bad) => `总 ${r.checks.length} 项检查 | 不符合 ${bad}`, '处不符合');

  // 3. DFM Card
  fillCard('dashDfmScore', 'barDfm', 'dashDfmBadge', 'dashDfmDetail', res.dfm,
    (r, bad) => `焊盘 Airgap 间隙检查 | 超标 ${bad}`, '处超标');

  // 4. Fanout Card
  fillCard('dashFanoutScore', 'barFanout', 'dashFanoutBadge', 'dashFanoutDetail', res.fanout,
    (r, bad) => `聚类 ${r.checks.length} 组 | 匹配通过 ${r.checks.length - bad} 组`, '处不符合');

  // 5. Pour Card
  fillCard('dashPourScore', 'barPour', 'dashPourBadge', 'dashPourDetail', res.pour,
    (r, bad) => `铺铜覆盖五项检查 | 检出缺陷 ${bad}`, '处缺陷');

  // Risk Radar
  const fails = State.allChecks.filter(c => !c.pass);
  $('lblCriticalRiskCount').textContent = `致命红线: ${fails.length} 项`;

  const pnlRisk = $('pnlRiskMatrix');
  if (fails.length === 0) {
    pnlRisk.innerHTML = '<div style="color:#059669;padding:12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px">未发现红线与制造缺陷</div>';
  } else {
    pnlRisk.innerHTML = fails.slice(0, 5).map(f => `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #ef4444;padding:8px 12px;border-radius:4px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b><span class="cat-pill ${f.category}">${f.categoryName}</span> ${escHtml(f.target)}</b>
          <span class="tag-badge bad">${f.item}</span>
        </div>
        <div style="color:#6b7280;font-size:12px;margin-top:4px">${escHtml(f.reason)}</div>
      </div>
    `).join('');
  }

  // Layer & Net Rankings
  const layerCounts = {};
  fails.forEach(f => { layerCounts[f.layer] = (layerCounts[f.layer] || 0) + 1; });
  const sortedLayers = Object.entries(layerCounts).sort((a,b) => b[1] - a[1]);

  $('pnlLayerNetRanking').innerHTML = `
    <div style="margin-bottom:8px"><b>缺陷高发物理层排行:</b></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${sortedLayers.length ? sortedLayers.map(([layer, count]) => `
        <span class="tag-badge bad" style="font-size:12px;padding:4px 8px">${layer}: <b>${count}</b> 处缺陷</span>
      `).join('') : '<span style="color:#059669">全层无缺陷</span>'}
    </div>
  `;
}

function renderMasterDefectsTable() {
  const tbody = $('tblMasterDefectsBody');
  let list = State.allChecks;

  if (State.currentFilter === 'fail') {
    list = list.filter(c => !c.pass);
  } else if (State.currentFilter === 'pass') {
    list = list.filter(c => c.pass);
  } else if (State.currentFilter.startsWith('fail_')) {
    const cat = State.currentFilter.replace('fail_', '');
    list = list.filter(c => !c.pass && c.category === cat);
  } else if (State.currentFilter !== 'all') {
    list = list.filter(c => c.category === State.currentFilter);
  }

  // Update active chip styling
  document.querySelectorAll('#pnlDefectFilters .filter-chip').forEach(ch => {
    const onClickStr = ch.getAttribute('onclick') || '';
    if (onClickStr.includes(`'${State.currentFilter}'`)) ch.classList.add('active');
    else ch.classList.remove('active');
  });

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:#94a3b8">当前筛选条件下无数据</td></tr>';
    return;
  }

  tbody.innerHTML = list.map((c) => {
    const isReviewed = State.reviewedSet.has(c.id);
    const rowClass = !c.pass ? 'fail-row' : '';
    const reviewedClass = isReviewed ? 'reviewed' : '';

    return `
      <tr class="${rowClass} ${reviewedClass}">
        <td style="text-align:center">
          ${!c.pass ? `<input type="checkbox" ${isReviewed ? 'checked' : ''} onchange="toggleReview('${c.id}')">` : '-'}
        </td>
        <td><span class="cat-pill ${c.category}">${c.categoryName}</span></td>
        <td><b>${escHtml(c.target)}</b></td>
        <td><span class="tag-badge info">${escHtml(c.layer)}</span></td>
        <td>${c.item}</td>
        <td style="font-family:var(--mono)">${c.actual} <span style="color:var(--sub)">/ ${c.rule}</span></td>
        <td>
          <span class="tag-badge ${c.pass ? 'ok' : 'bad'}">${c.pass ? '符合' : '不符合'}</span>
        </td>
        <td style="color:#6b7280">${escHtml(c.reason)}</td>
        <td style="text-align:center">
          <button class="btn sec small" style="background:#2563eb;color:#ffffff;font-weight:600;padding:3px 10px;border:none" onclick="locateDefectInCanvas('${c.category}', '${c.id}')">定位</button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterDefects(categoryKey) {
  State.currentFilter = categoryKey;
  renderMasterDefectsTable();
}

function toggleReview(checkId, explicitVal) {
  const shouldReview = explicitVal !== undefined ? Boolean(explicitVal) : !State.reviewedSet.has(checkId);
  if (shouldReview) State.reviewedSet.add(checkId);
  else State.reviewedSet.delete(checkId);
  updateMasterKPIs();
  renderMasterDefectsTable();
  if (typeof renderAnalysisGuidance === 'function') renderAnalysisGuidance();
  if (State.canvas.activeReviewCheckId === checkId) {
    renderUnifiedCanvasReviewBox(checkId);
  }
  renderCanvas();
}

function batchReviewAll() {
  State.allChecks.filter(c => !c.pass).forEach(c => State.reviewedSet.add(c.id));
  updateMasterKPIs();
  renderMasterDefectsTable();
  if (typeof renderAnalysisGuidance === 'function') renderAnalysisGuidance();
  if (State.canvas.activeReviewCheckId) renderUnifiedCanvasReviewBox(State.canvas.activeReviewCheckId);
  showToast('已将全部缺陷标记为已复核');
}

function clearAllReviews() {
  State.reviewedSet.clear();
  updateMasterKPIs();
  renderMasterDefectsTable();
  if (typeof renderAnalysisGuidance === 'function') renderAnalysisGuidance();
  if (State.canvas.activeReviewCheckId) renderUnifiedCanvasReviewBox(State.canvas.activeReviewCheckId);
}

function renderModularViews() {
  if ($('pnlModTrace')) $('pnlModTrace').innerHTML = `走线检查：线宽组合、总线长、差分逐层与总长线长差。健康分 <b>${State.results.trace.score}%</b>。`;
  if ($('pnlModCopper')) $('pnlModCopper').innerHTML = `约束检查：反焊盘尺寸与 Padstack 连接层。健康分 <b>${State.results.copper.score}%</b>。`;
  if ($('pnlModDfm')) $('pnlModDfm').innerHTML = `DFM 检查：孔-孔、线-孔间距，盲埋孔按 Padstack Defined 穿层过滤${State.dfmSkippedPairs ? `，排除 ${State.dfmSkippedPairs} 处非穿层对偶` : ''}），共检出 <b>${State.results.dfm.checks.length}</b> 处间隙隐患。当前 DFM 健康分 <b>${State.results.dfm.score}%</b>。`;
  if ($('pnlModFanout')) $('pnlModFanout').innerHTML = `扇出检查：聚类 <b>${State.results.fanout.checks.length}</b> 个孔群。健康分 <b>${State.results.fanout.score}%</b>。`;
  if ($('pnlModPour')) $('pnlModPour').innerHTML = `铜皮检查：孔铺铜、异型铜皮、参考层超宽、碎铜、圆弧。健康分 <b>${State.results.pour.score}%</b>。`;
}

function renderAnalysisGuidance() {
  const fails = State.allChecks.filter(c => !c.pass);

  // Top summary chips
  const catCounts = { trace: 0, copper: 0, dfm: 0, fanout: 0, pour: 0 };
  const layerCounts = {};
  fails.forEach(f => {
    layerCounts[f.layer] = (layerCounts[f.layer] || 0) + 1;
    catCounts[f.category] = (catCounts[f.category] || 0) + 1;
  });

  const layerChipsStr = Object.entries(layerCounts).map(([layer, count]) => `
    <span class="tag-badge bad" style="font-size:12px;padding:3px 8px">${layer}: <b>${count}</b>条</span>
  `).join(' ');

  $('pnlAnalysisTopChips').innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#f8fafc;border:1px solid #e3e8ef;padding:8px 12px;border-radius:6px;width:100%">
      <span style="font-size:12px;color:#111827"><b>缺陷统计总览:</b> 检出总缺陷 <b>${fails.length}</b> 条</span>
      <span class="cat-pill trace">走线: ${catCounts.trace}条</span>
      <span class="cat-pill copper">约束: ${catCounts.copper}条</span>
      <span class="cat-pill dfm">DFM: ${catCounts.dfm}条</span>
      <span class="cat-pill fanout">扇出: ${catCounts.fanout}条</span>
      <span class="cat-pill pour">铜皮: ${catCounts.pour}条</span>
      <div style="width:100%;height:1px;background:#e3e8ef;margin:4px 0"></div>
      <span style="font-size:12px;color:#6b7280">按物理层分布概览:</span>
      ${layerChipsStr || '<span style="color:#059669">全层无缺陷</span>'}
    </div>
  `;

  // 2. 表格一：按目标对象归纳汇总表 (同一个目标对象的所有缺陷放在一起)
  const targetMap = new Map();
  fails.forEach(f => {
    let key = f.target;
    let entry = targetMap.get(key);
    if (!entry) {
      entry = {
        target: f.target,
        targetType: f.targetType || '目标对象',
        categories: new Set(),
        layers: new Set(),
        defectCount: 0,
        defects: []
      };
      targetMap.set(key, entry);
    }
    entry.categories.add(f.categoryName);
    entry.layers.add(f.layer);
    entry.defectCount++;
    entry.defects.push(f);
  });

  const targetList = Array.from(targetMap.values()).sort((a,b) => b.defectCount - a.defectCount);
  $('lblTargetObjectSummary').textContent = `共 ${targetList.length} 个问题对象`;

  const tbodyTarget = $('tblByTargetObjectBody');
  if (targetList.length === 0) {
    tbodyTarget.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#059669">未检出任何目标对象缺陷</td></tr>';
  } else {
    tbodyTarget.innerHTML = targetList.map((t) => {
      const catPills = Array.from(t.categories).map(c => `<span class="tag-badge info" style="margin:1px 2px">${c}</span>`).join('');
      const layerStr = Array.from(t.layers).join(', ');
      const isAllReviewed = t.defects.every(d => State.reviewedSet.has(d.id));

      const defectItemsHtml = t.defects.map(d => `
        <div style="padding:4px 0;border-bottom:1px dashed #e3e8ef;font-size:12px">
          <span class="cat-pill ${d.category}">${d.categoryName}</span>
          <b>${escHtml(d.item)}</b> [${escHtml(d.layer)}]: 实测 <code style="color:#111827;background:#f1f5f9;padding:1px 4px;border-radius:3px">${d.actual}</code> vs 规则 <code style="background:#f1f5f9;padding:1px 4px;border-radius:3px">${d.rule}</code>
          <div style="color:#6b7280;margin-top:2px"> ${escHtml(d.reason)}</div>
        </div>
      `).join('');

      return `
        <tr>
          <td><b style="color:#2563eb">${escHtml(t.target)}</b></td>
          <td><span class="tag-badge info">${t.targetType}</span></td>
          <td><span class="tag-badge bad" style="font-weight:700">${t.defectCount} 处</span></td>
          <td>${catPills}</td>
          <td><span style="font-family:var(--mono);color:#6b7280">${layerStr}</span></td>
          <td>${defectItemsHtml}</td>
          <td style="text-align:center">
            ${isAllReviewed ? '<span class="tag-badge ok">已复核</span>' : '<span class="tag-badge warn">待复核</span>'}
          </td>
        </tr>
      `;
    }).join('');
  }

  // 3. 表格二：按缺陷原因与检查项归纳汇总表 (同一缺陷原因的放在一起 · 一一对应全列出)
  const reasonMap = new Map();
  fails.forEach(f => {
    let key = `${f.categoryName}___${f.item}___${f.reason}`;
    let entry = reasonMap.get(key);
    if (!entry) {
      entry = {
        categoryName: f.categoryName,
        category: f.category,
        item: f.item,
        reason: f.reason,
        rule: f.rule,
        layers: new Set(),
        targets: []
      };
      reasonMap.set(key, entry);
    }
    entry.layers.add(f.layer);
    entry.targets.push({ target: f.target, actual: f.actual, id: f.objId });
  });

  const reasonList = Array.from(reasonMap.values()).sort((a,b) => b.targets.length - a.targets.length);
  $('lblDefectReasonSummary').textContent = `共 ${reasonList.length} 种缺陷类型`;

  const tbodyReason = $('tblByDefectReasonBody');
  if (reasonList.length === 0) {
    tbodyReason.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#059669">未检出任何缺陷原因</td></tr>';
  } else {
    tbodyReason.innerHTML = reasonList.map(r => {
      const targetPills = r.targets.map(t => `<span class="net-pill bad">${escHtml(t.target)} (${escHtml(t.actual)})</span>`).join('');
      const layerStr = Array.from(r.layers).join(', ');

      let guidance = '核对设计规则与 EDA 几何间隙';
      if (r.category === 'dfm') guidance = '焊盘与走线间隙低于安全极限，建议微调走线线位或增加 1~2mil 间隙以提升制造良率。';
      else if (r.category === 'pour') guidance = '铺铜覆盖不足易导致参考地阻抗突变；碎铜死铜易引发高频天线效应与蚀刻脱落，建议补齐铺铜或清理死铜。';
      else if (r.category === 'trace') guidance = '走线线宽组合不符合出线层阻抗规范，易引起高频反射，需按阻抗匹配表修正线宽。';
      else if (r.category === 'copper') guidance = '叠层反焊盘尺寸或过孔 Padstack 命名层与实际连接层不符，需更新过孔封装反焊盘或封装层名定义。';

      return `
        <tr>
          <td>
            <span class="cat-pill ${r.category}">${r.categoryName}</span>
            <div style="font-weight:700;margin-top:4px;color:#111827">${r.item}</div>
          </td>
          <td><span class="tag-badge bad" style="font-size:12px;font-weight:700">${r.targets.length} 条</span></td>
          <td>
            <div style="color:#6b7280;font-size:12px;margin-bottom:6px"><b>不符合原因:</b> ${escHtml(r.reason)}</div>
            <div style="font-size:12px;color:#6b7280;margin-bottom:4px"><b>对应目标对象明细:</b></div>
            <div>${targetPills}</div>
          </td>
          <td><span class="tag-badge info">${layerStr}</span></td>
          <td style="font-size:12px;color:#6b7280">${guidance}</td>
        </tr>
      `;
    }).join('');
  }
}

/**
 * 2D Canvas CAD Overlay
 */
