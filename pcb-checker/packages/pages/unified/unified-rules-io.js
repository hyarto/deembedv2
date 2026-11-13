/* ============================================================================
 * unified-rules-io.js —— 导出弹窗与五大引擎规则文件导入导出
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
let _currentModalDownloadName = 'export.txt';
function downloadModalContent() {
  const content = $('txtModalExportContent') ? $('txtModalExportContent').value : '';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = _currentModalDownloadName || 'export.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function openModal(title, content, downloadName) {
  _currentModalDownloadName = downloadName || 'export.txt';
  $('lblModalExportTitle').textContent = title;
  $('txtModalExportContent').value = content;
  $('modalExport').style.display = 'flex';
}

function closeModal() {
  $('modalExport').style.display = 'none';
}

function copyModalContent() {
  const content = $('txtModalExportContent').value;
  copyTextToClipboard(content, '已复制到剪贴板');
}

function copyTextToClipboard(text, successMsg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMsg || '已复制到剪贴板');
    }).catch(() => {
      fallbackCopy(text, successMsg);
    });
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, successMsg) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast(successMsg || '已复制到剪贴板');
  } catch (err) {
    alert('复制失败，请手动在文本框中全选复制。');
  }
  document.body.removeChild(ta);
}

// 导出与导入全套五大规则 JSON
function exportMasterRules() {
  const rules = {
    version: '2.0-unified',
    exportTime: new Date().toISOString(),
    traceLayers: State.rules.traceLayers,
    diffLayerTol: parseFloat($('cfgDiffLayerTol')?.value) || 0.5,
    diffTotalTol: parseFloat($('cfgDiffTol')?.value) || 1.0,
    checkLayerDiff: $('cfgCheckLayerDiff')?.checked !== false,
    checkTotalDiff: $('cfgCheckTotalDiff')?.checked !== false,
    constraintSets: State.rules.constraintSets,
    layerCount: unifiedLayerCount(),
    antiPadTol: parseFloat($('cfgAntiPadTol')?.value) || 0.5,
    dfm: {
      gndAirgap: parseFloat($('inpThresholdGnd')?.value) || 4.01575,
      signalAirgap: parseFloat($('inpThresholdSignal')?.value) || 5.04725,
      padPairAirgap: Number($('inpThresholdPadPair')?.value ?? 6),
      gndPadDiam: parseFloat($('inpGndPadDiam')?.value) || 7.906,
      signalPadDiam: parseFloat($('inpSignalPadDiam')?.value) || 12.0,
      gndFirstDrill: parseFloat($('inpGndDrillDiam')?.value) || 6.0,
      signalFirstDrill: parseFloat($('inpSignalDrillDiam')?.value) || 6.0,
      mode: $('selDfmMode')?.value || 'pad_to_trace',
      netScope: $('selDfmNetScope')?.value || 'diff_net',
      layerRules: UnifiedDfmLayerRules.rows
    },
    fanout: {
      clusterRadius: parseFloat($('cfgClusterDist')?.value) || 2.0,
      geomTol: parseFloat($('cfgGeomTol')?.value) || 0.5,
      centerDistTol: parseFloat($('cfgCenterDistTol')?.value) || 1.0
    },
    fanoutSchemes: State.rules.fanoutSchemes,
    pourRule1: State.rules.pourRule1,
    specialShapeTemplates: State.rules.specialShapeTemplates,
    pourRule3: State.rules.pourRule3,
    pourSmallArea: parseFloat($('cfgPourSmallArea')?.value) || 500.0,
    pourMinArc: parseFloat($('cfgPourMinArc')?.value) || 10.0
  };
  openModal('导出全套规则 JSON', JSON.stringify(rules, null, 2), 'PCB_全套综合检查规则约束.json');
}

function importMasterRulesPrompt() {
  const input = $('fileRulesInput');
  if (input) input.click();
}

function handleRulesFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const decoded = decodeTxt(ev.target.result);
      const r = JSON.parse(decoded.text);
      if (r.traceLayers || r.rules || r.layers) {
        const traces = parseTraceRulesJson(r);
        if (traces.length) State.rules.traceLayers = traces;
      }
      if (r.constraintSets || r.sets) {
        State.rules.constraintSets = r.constraintSets || r.sets;
        reexpandAll();
      }
      if (r.fanoutSchemes) State.rules.fanoutSchemes = r.fanoutSchemes;
      if (r.diffLayerTol && $('cfgDiffLayerTol')) $('cfgDiffLayerTol').value = r.diffLayerTol;
      if (r.diffTotalTol && $('cfgDiffTol')) $('cfgDiffTol').value = r.diffTotalTol;
      if (r.layerCount && $('cfgLayerCount')) $('cfgLayerCount').value = r.layerCount;
      if (r.antiPadTol && $('cfgAntiPadTol')) $('cfgAntiPadTol').value = r.antiPadTol;
      if (r.dfm) {
        if (r.dfm.gndAirgap != null) $('inpThresholdGnd').value = r.dfm.gndAirgap;
        if (r.dfm.signalAirgap != null) $('inpThresholdSignal').value = r.dfm.signalAirgap;
        if (r.dfm.padPairAirgap != null) $('inpThresholdPadPair').value = r.dfm.padPairAirgap;
        if (r.dfm.gndPadDiam != null) $('inpGndPadDiam').value = r.dfm.gndPadDiam;
        if (r.dfm.signalPadDiam != null) $('inpSignalPadDiam').value = r.dfm.signalPadDiam;
        if (r.dfm.gndFirstDrill != null) $('inpGndDrillDiam').value = r.dfm.gndFirstDrill;
        if (r.dfm.signalFirstDrill != null) $('inpSignalDrillDiam').value = r.dfm.signalFirstDrill;
        if (r.dfm.mode) $('selDfmMode').value = r.dfm.mode;
        if (r.dfm.netScope) $('selDfmNetScope').value = r.dfm.netScope;
        if (Array.isArray(r.dfm.layerRules)) { UnifiedDfmLayerRules.rows = r.dfm.layerRules.map(x => ({ layers: x.layers || x.raw || '', gnd: x.gnd ?? x.minClearanceGnd ?? null, sig: x.sig ?? x.minClearanceSignal ?? null, pad: x.pad ?? x.minClearancePadPair ?? null })); UnifiedDfmLayerRules.save(); UnifiedDfmLayerRules.render(); }
        UnifiedDfmLayerRules.saveDefaults();
      }
      if (r.pourRule1) State.rules.pourRule1 = r.pourRule1;
      if (r.specialShapeTemplates) State.rules.specialShapeTemplates = r.specialShapeTemplates;
      if (r.pourRule3) State.rules.pourRule3 = r.pourRule3;
      renderRulesUI();
      if (State.rawText) runMasterInspection();
      showToast('已从本地文件载入全套综合约束规则');
    } catch (err) {
      alert('规则 JSON 解析失败: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
}

// Sub Rules Import Helpers
function importTraceRulesPrompt() { const input = $('fileTraceRules'); if (input) input.click(); }
function exportTraceRulesPrompt() {
  const data = {
    kind: 'pcb-trace-rules',
    version: 3,
    diffLayerTol: parseFloat($('cfgDiffLayerTol')?.value) || 0.5,
    diffTotalTol: parseFloat($('cfgDiffTol')?.value) || 1.0,
    checkLayerDiff: $('cfgCheckLayerDiff')?.checked !== false,
    checkTotalDiff: $('cfgCheckTotalDiff')?.checked !== false,
    rules: State.rules.traceLayers.map(r => ({
      layer: r.layer,
      widthsText: r.combos,
      combos: r.combos,
      lenRange: r.lenRange,
      lenText: r.lenRange,
      diffLayerTol: r.diffLayerTol,
      widthLensText: r.specificRule,
      specificRule: r.specificRule,
      radText: String(r.minArc || 52.38),
      minArc: r.minArc || 52.38
    })),
    traceLayers: State.rules.traceLayers
  };
  openModal('导出走线规则 JSON', JSON.stringify(data, null, 2), 'PCB_走线检查规则.json');
}

function handleTraceRulesFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const decoded = decodeTxt(ev.target.result);
      const r = JSON.parse(decoded.text);
      const newRules = parseTraceRulesJson(r);
      if (newRules.length > 0) {
        State.rules.traceLayers = newRules;
      }

      // Check global parameters
      if (r.diffLayerTol != null && $('cfgDiffLayerTol')) $('cfgDiffLayerTol').value = r.diffLayerTol;
      if (r.diffTotalTol != null && $('cfgDiffTol')) $('cfgDiffTol').value = r.diffTotalTol;
      if (r.diffTol != null && $('cfgDiffTol')) $('cfgDiffTol').value = r.diffTol;
      if (r.tol != null && $('cfgDiffTol')) $('cfgDiffTol').value = r.tol;
      if (r.checkLayerDiff != null && $('cfgCheckLayerDiff')) $('cfgCheckLayerDiff').checked = !!r.checkLayerDiff;
      if (r.checkTotalDiff != null && $('cfgCheckTotalDiff')) $('cfgCheckTotalDiff').checked = !!r.checkTotalDiff;

      renderRulesUI();
      if (State.rawText) runMasterInspection();
      showToast(`已导入走线规则 JSON：已更新 ${newRules.length || State.rules.traceLayers.length} 条层规则`);
    } catch (err) {
      alert('走线规则解析失败: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
}

function importConstraintTxtPrompt() { const input = $('fileConstraintTxt'); if (input) input.click(); }
function handleConstraintTxtFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const decoded = decodeTxt(ev.target.result);
      const text = decoded.text;
      const parsedSets = parseConstraintText(text, file.name);
      if (parsedSets && parsedSets.length) {
        State.rules.constraintSets = parsedSets;
        updateUnifiedLayerCountHint();
        reexpandAll();
        renderRulesUI();
        if (State.rawText) runMasterInspection();
        showToast(`已从约束 TXT 文件 ${file.name} 解析出 ${parsedSets.length} 套约束，编码 ${decoded.enc}`);
        return;
      }
      showToast(`约束文件 ${file.name} 已读取`);
    } catch (err) { alert('约束 TXT 解析失败: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
}

function importConstraintJsonPrompt() { const input = $('fileConstraintJson'); if (input) input.click(); }
function handleConstraintJsonFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const decoded = decodeTxt(ev.target.result);
      const r = JSON.parse(decoded.text);
      let sets = [];
      if (Array.isArray(r)) sets = r;
      else if (r.sets && Array.isArray(r.sets)) sets = r.sets;
      else if (r.constraintSets && Array.isArray(r.constraintSets)) sets = r.constraintSets;
      else if (r.rules && Array.isArray(r.rules)) sets = r.rules;

      if (sets.length > 0) {
        sets.forEach(s => {
          if (!s.constraints || !s.constraints.length) {
            s.constraints = buildConstraints(s.rules || []);
          }
          if (!s.fanLayer) s.fanLayer = fanLayerOf(s);
        });
        State.rules.constraintSets = sets;
      }

      if (r.layerCount && $('cfgLayerCount')) $('cfgLayerCount').value = r.layerCount;
      if (r.stack && $('cfgLayerCount')) $('cfgLayerCount').value = r.stack;
      if (r.antiPadTol && $('cfgAntiPadTol')) $('cfgAntiPadTol').value = r.antiPadTol;
      if (r.valTol && $('cfgAntiPadTol')) $('cfgAntiPadTol').value = r.valTol;

      reexpandAll();
      renderRulesUI();
      if (State.rawText) runMasterInspection();
      showToast(`已导入约束规则 JSON：已更新 ${State.rules.constraintSets.length} 套约束`);
    } catch (err) { alert('约束 JSON 解析失败: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
}

function exportConstraintJsonPrompt() {
  const data = {
    kind: 'pcb-copper-rules',
    version: 3,
    layerCount: unifiedLayerCount(),
    antiPadTol: parseFloat($('cfgAntiPadTol')?.value) || 0.5,
    sets: State.rules.constraintSets
  };
  openModal('导出约束规则 JSON', JSON.stringify(data, null, 2), 'PCB_叠层约束规则.json');
}

function importDfmRulesPrompt() { const input = $('fileDfmRules'); if (input) input.click(); }
function exportDfmRulesPrompt() {
  const data = {
    kind: 'pcb-dfm-rules',
    version: 2,
    gndAirgap: parseFloat($('inpThresholdGnd')?.value) || 4.01575,
    signalAirgap: parseFloat($('inpThresholdSignal')?.value) || 5.04725,
    padPairAirgap: Number($('inpThresholdPadPair')?.value ?? 6),
    gndPadDiameter: parseFloat($('inpGndPadDiam')?.value) || 7.906,
    signalPadDiameter: parseFloat($('inpSignalPadDiam')?.value) || 12.0,
    gndFirstDrill: parseFloat($('inpGndDrillDiam')?.value) || 6.0,
    signalFirstDrill: parseFloat($('inpSignalDrillDiam')?.value) || 6.0,
    mode: $('selDfmMode')?.value || 'pad_to_trace',
    netScope: $('selDfmNetScope')?.value || 'diff_net',
    layerRules: UnifiedDfmLayerRules.rows
  };
  openModal('导出 DFM 规则 JSON', JSON.stringify(data, null, 2), 'PCB_DFM制造能力规则.json');
}

function handleDfmRulesFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const decoded = decodeTxt(ev.target.result);
      const r = JSON.parse(decoded.text);
      const gAir = r.gndAirgap || r.minClearanceGnd || r.dfm?.gndAirgap;
      const sAir = r.signalAirgap || r.minClearanceSignal || r.dfm?.signalAirgap;
      const gPad = r.gndPadDiameter || r.gndPadDiam || r.dfm?.gndPadDiam;
      const sPad = r.signalPadDiameter || r.signalPadDiam || r.dfm?.signalPadDiam;
      const pAir = r.padPairAirgap ?? r.minClearancePadPair ?? r.dfm?.padPairAirgap;
      const gDrill = r.gndFirstDrill ?? r.dfm?.gndFirstDrill ?? r.firstDrill;
      const sDrill = r.signalFirstDrill ?? r.dfm?.signalFirstDrill ?? r.firstDrill;

      if (gAir != null) $('inpThresholdGnd').value = gAir;
      if (sAir != null) $('inpThresholdSignal').value = sAir;
      if (pAir != null) $('inpThresholdPadPair').value = pAir;
      if (gPad != null) $('inpGndPadDiam').value = gPad;
      if (sPad != null) $('inpSignalPadDiam').value = sPad;
      if (gDrill != null) $('inpGndDrillDiam').value = gDrill;
      if (sDrill != null) $('inpSignalDrillDiam').value = sDrill;
      if (r.mode) $('selDfmMode').value = r.mode;
      if (r.netScope) $('selDfmNetScope').value = r.netScope;
      if (Array.isArray(r.layerRules)) { UnifiedDfmLayerRules.rows = r.layerRules.map(x => ({ layers: x.layers || x.raw || '', gnd: x.gnd ?? x.minClearanceGnd ?? null, sig: x.sig ?? x.minClearanceSignal ?? null, pad: x.pad ?? x.minClearancePadPair ?? null })); UnifiedDfmLayerRules.save(); UnifiedDfmLayerRules.render(); }
      UnifiedDfmLayerRules.saveDefaults();

      if (State.rawText) runMasterInspection();
      showToast('已导入 DFM 制造能力规则 JSON 并更新参数');
    } catch (err) { alert('DFM 规则解析失败: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
}

function importFanoutRulesPrompt() { const input = $('fileFanoutRules'); if (input) input.click(); }
function exportFanoutRulesPrompt() {
  const data = State.rules.fanoutSchemes || [];
  openModal('导出扇出方案库 JSON', JSON.stringify(data, null, 2), 'PCB_扇出方案库规则.json');
}

function handleFanoutRulesFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const decoded = decodeTxt(ev.target.result);
      const res = parseAndRepairFanoutJson(decoded.text);
      if (res.success && res.schemes && res.schemes.length > 0) {
        State.rules.fanoutSchemes = res.schemes;
        const meta = res.meta || {};
        if (meta.clusterRadiusMm && $('cfgClusterDist')) $('cfgClusterDist').value = meta.clusterRadiusMm;
        if (meta.geomTolMil && $('cfgGeomTol')) $('cfgGeomTol').value = meta.geomTolMil;
        if (meta.centerDistTolMil && $('cfgCenterDistTol')) $('cfgCenterDistTol').value = meta.centerDistTolMil;
        renderFanoutSchemesGrid();
        if (State.rawText) runMasterInspection();
        if (res.recovered) {
          showToast(res.message);
        } else {
          showToast(`已导入 ${res.schemes.length} 套扇出方案`);
        }
      } else {
        alert('未在文件中找到有效的扇出方案数据');
      }
    } catch (err) { alert('扇出方案解析失败: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
}

function importPourRulesPrompt() { const input = $('filePourRules'); if (input) input.click(); }
function exportPourRulesPrompt() {
  const data = {
    kind: 'pcb-pour-rules',
    version: 1,
    viaCoverageRules: State.rules.pourRule1.map(r => ({
      id: r.id,
      padstack: r.padstack,
      layers: r.layers.split(/[,;\s]+/).filter(Boolean),
      coverageRadius: r.radius
    })),
    specialShapeTemplates: State.rules.specialShapeTemplates || [],
    traceMarginRules: State.rules.pourRule3.map(r => ({
      id: r.id,
      traceLayer: r.traceLayer,
      upperRefLayer: r.upperRef,
      lowerRefLayer: r.lowerRef,
      minMargin: r.margin
    })),
    smallCopperAreaThreshold: parseFloat($('cfgPourSmallArea')?.value) || 500.0,
    minArcRadius: parseFloat($('cfgPourMinArc')?.value) || 10.0
  };
  openModal('导出铜皮规则 JSON', JSON.stringify(data, null, 2), 'PCB_铜皮检查规则.json');
}

function handlePourRulesFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const decoded = decodeTxt(ev.target.result);
      const r = JSON.parse(decoded.text);
      if (r.viaCoverageRules && Array.isArray(r.viaCoverageRules)) {
        State.rules.pourRule1 = r.viaCoverageRules.map((v, i) => ({
          id: v.id || `pour_r1_${i+1}`,
          padstack: v.padstack || 'VIA_*',
          layers: Array.isArray(v.layers) ? v.layers.join(',') : (v.layers || 'L1-L21'),
          radius: v.coverageRadius != null ? v.coverageRadius : (v.radius != null ? v.radius : 50.0)
        }));
      } else if (r.pourRule1 && Array.isArray(r.pourRule1)) {
        State.rules.pourRule1 = r.pourRule1;
      }

      if (r.specialShapeTemplates && Array.isArray(r.specialShapeTemplates)) {
        State.rules.specialShapeTemplates = r.specialShapeTemplates;
      }

      if (r.traceMarginRules && Array.isArray(r.traceMarginRules)) {
        State.rules.pourRule3 = r.traceMarginRules.map((m, i) => ({
          id: m.id || `pour_r3_${i+1}`,
          traceLayer: m.traceLayer || '08IS03',
          upperRef: m.upperRefLayer || m.upperRef || '07G02P',
          lowerRef: m.lowerRefLayer || m.lowerRef || '09G03P',
          margin: m.minMargin != null ? m.minMargin : (m.margin != null ? m.margin : 50.0)
        }));
      } else if (r.pourRule3 && Array.isArray(r.pourRule3)) {
        State.rules.pourRule3 = r.pourRule3;
      }

      if (r.smallCopperAreaThreshold && $('cfgPourSmallArea')) $('cfgPourSmallArea').value = r.smallCopperAreaThreshold;
      if (r.pourSmallArea && $('cfgPourSmallArea')) $('cfgPourSmallArea').value = r.pourSmallArea;
      if (r.minArcRadius && $('cfgPourMinArc')) $('cfgPourMinArc').value = r.minArcRadius;
      if (r.pourMinArc && $('cfgPourMinArc')) $('cfgPourMinArc').value = r.pourMinArc;

      renderRulesUI();
      if (State.rawText) runMasterInspection();
      showToast('已导入铜皮检查规则 JSON 并即时刷新配置表');
    } catch (err) { alert('铜皮规则解析失败: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
}

function handlePourShapeTxtFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const decoded = decodeTxt(ev.target.result);
      const text = decoded.text;
      const parsed = (typeof PourChecker !== 'undefined' && PourChecker.parsePcbElements) ?
        PourChecker.parsePcbElements(text) : { shapes: [] };
      
      if (!State.rules.specialShapeTemplates) State.rules.specialShapeTemplates = [];

      if (parsed.shapes && parsed.shapes.length > 0) {
        parsed.shapes.forEach((sh, idx) => {
          State.rules.specialShapeTemplates.push({
            id: `tmpl_txt_${Date.now()}_${idx}`,
            name: `${sh.layer || 'L2'}导入异型铜皮_${State.rules.specialShapeTemplates.length + 1}`,
            padstack: 'BGA_3510',
            layer: sh.layer || '02G01P',
            expectedArea: parseFloat((sh.area || 452.4).toFixed(1)),
            areaTolerance: 30.0
          });
        });
        renderRulesUI();
        if (State.rawText) runMasterInspection();
        showToast(`已从 TXT 解析出 ${parsed.shapes.length} 个异型铜皮模板并已填入规则二表格`);
      } else {
        // Fallback default template if no raw shape section
        State.rules.specialShapeTemplates.push({
          id: `tmpl_txt_${Date.now()}`,
          name: `${file.name.replace(/\.[^.]+$/, '')}`,
          padstack: 'BGA_3510',
          layer: '02G01P',
          expectedArea: 452.4,
          areaTolerance: 30.0
        });
        renderRulesUI();
        showToast(`已导入异型铜皮模板文件: ${file.name}`);
      }
    } catch (err) {
      alert('异型铜皮 TXT 解析失败: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
}

