/* ============================================================================
 * unified-runner.js —— 综合检查调度：数据汇总与五大引擎逐个执行
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
function parsePcbElementsSafe(txt) {
  if (!txt || !txt.trim()) return { vias: [], traces: [], shapes: [], layers: [] };
  if (typeof PourChecker !== 'undefined' && PourChecker.parsePcbElements) {
    return PourChecker.parsePcbElements(txt);
  }
  return { vias: [], traces: [], shapes: [], layers: [] };
}

function mergeUniquePcbElements(parsedList) {
  const vias = [], traces = [], shapes = [];
  const layerSet = new Set();
  const seenVias = new Set(), seenTraces = new Set(), seenShapes = new Set();

  (parsedList || []).forEach(p => {
    if (!p) return;
    (p.layers || []).forEach(l => layerSet.add(l));
    (p.vias || []).forEach(v => {
      const ox = v.origin ? v.origin[0] : (v.x || 0);
      const oy = v.origin ? v.origin[1] : (v.y || 0);
      const key = `${v.id}_${Number(ox).toFixed(2)}_${Number(oy).toFixed(2)}_${v.padstack || ''}`;
      if (!seenVias.has(key)) { seenVias.add(key); vias.push(v); }
    });
    (p.traces || []).forEach(t => {
      const s0 = (t.segments && t.segments[0]) ? `${t.segments[0].x1}_${t.segments[0].y1}` : '';
      const key = `${t.id}_${t.layer || ''}_${t.net || ''}_${s0}`;
      if (!seenTraces.has(key)) { seenTraces.add(key); traces.push(t); }
    });
    (p.shapes || []).forEach(sh => {
      const b0 = (sh.boundary && sh.boundary[0]) ? `${sh.boundary[0].x1}_${sh.boundary[0].y1}` : '';
      const key = `${sh.id}_${sh.layer || ''}_${sh.area || 0}_${b0}`;
      if (!seenShapes.has(key)) { seenShapes.add(key); shapes.push(sh); }
    });
  });

  return { vias, traces, shapes, layers: Array.from(layerSet) };
}

/**
 * 读取四类数据框文本并解析、去重汇总。无任何数据时返回 null。
 */
function buildInspectionContext() {
  const tTrace = (State.dataInputs.trace.text || '').trim();
  const tConstraint = (State.dataInputs.constraint.text || '').trim();
  const tDfmFanout = (State.dataInputs.dfmFanout.text || '').trim();
  const tPour = (State.dataInputs.pour.text || '').trim();

  const nonEmptyTexts = [tTrace, tConstraint, tDfmFanout, tPour].filter(Boolean);
  if (nonEmptyTexts.length === 0) return null;

  State.rawText = nonEmptyTexts.join('\n');

  const parsedTrace = parsePcbElementsSafe(tTrace);
  const parsedConstraint = parsePcbElementsSafe(tConstraint);
  const parsedDfmFanout = parsePcbElementsSafe(tDfmFanout);
  const parsedPour = parsePcbElementsSafe(tPour);

  State.elements = mergeUniquePcbElements([parsedTrace, parsedConstraint, parsedDfmFanout, parsedPour]);

  return { tTrace, tConstraint, tDfmFanout, tPour, parsedTrace, parsedConstraint, parsedDfmFanout, parsedPour };
}

/** 走线检查：出线层线宽组合与差分线长差。结果写入 State.results 并返回缺陷条目。 */
function runTraceEngine(ctx) {
  const { tTrace, parsedTrace } = ctx;
  // ==========================================
  // ENGINE 1: 走线检查 (仅使用 ① 走线检查数据框 tTrace)
  // ==========================================
  const traceChecks = [];
  const checkLayerDiff = $('cfgCheckLayerDiff') ? $('cfgCheckLayerDiff').checked : true;
  const checkTotalDiff = $('cfgCheckTotalDiff') ? $('cfgCheckTotalDiff').checked : true;
  const globalDiffTol = parseFloat($('cfgDiffTol')?.value) || 1.0;
  const globalDiffLayerTol = parseFloat($('cfgDiffLayerTol')?.value) || 0.5;

  // 1.1 Line width combinations & length ranges (Grouped by Net & Layer for complete trace line evaluation)
  const netLayerTraces = new Map();
  if (tTrace) parsedTrace.traces.forEach(t => {
    const k = `${t.net || 'UNKNOWN'}__${t.layer || 'UNKNOWN'}`;
    if (!netLayerTraces.has(k)) {
      netLayerTraces.set(k, {
        net: t.net || 'UNKNOWN',
        layer: t.layer || '未知层',
        traces: [],
        allWidths: [],
        firstId: t.id
      });
    }
    const entry = netLayerTraces.get(k);
    entry.traces.push(t);
    if (t.segments && t.segments.length > 0) {
      t.segments.forEach(s => {
        if (s.width) entry.allWidths.push(s.width);
      });
    } else if (t.width) {
      entry.allWidths.push(t.width);
    }
  });

  netLayerTraces.forEach(group => {
    const layerRule = State.rules.traceLayers.find(r => r.layer.toUpperCase() === group.layer.toUpperCase()) ||
                      State.rules.traceLayers[0] || { combos: '6.9-6-3.94, 6.9-5.7-6.9, 5.6-6', diffLayerTol: 0.5 };
    const compWidths = compressWidthSequence(group.allWidths);
    const seqStr = compWidths.length > 0 ? compWidths.map(fmt).join('-') : '无走线';
    
    const evalResult = analyzeTraceWidthDiscrepancy(compWidths, layerRule.combos);

    traceChecks.push({
      id: `trace_${group.net}_${group.layer}_width`,
      category: 'trace',
      categoryName: '走线检查',
      target: `${group.net}`,
      targetType: '走线网络',
      layer: group.layer,
      item: '出线层线宽组合顺序',
      actual: seqStr,
      rule: layerRule.combos || '符合阻抗规范',
      pass: evalResult.pass,
      deviation: evalResult.pass ? '0 mil' : '组合不符',
      reason: evalResult.reason,
      objId: group.firstId
    });
  });

  // 1.2 Differential Length Checks (逐层线长差 + 总线长差)
  const diffPairsMap = new Map();
  if (tTrace) parsedTrace.traces.forEach(t => {
    const net = t.net || '';
    let base = '', isP = false, isN = false;
    if (net.endsWith('_P') || net.endsWith('.P') || net.endsWith('P')) {
      base = net.replace(/[._]?P$/i, '');
      isP = true;
    } else if (net.endsWith('_N') || net.endsWith('.N') || net.endsWith('N')) {
      base = net.replace(/[._]?N$/i, '');
      isN = true;
    }
    if (base && (isP || isN)) {
      if (!diffPairsMap.has(base)) diffPairsMap.set(base, { base, pTraces: [], nTraces: [] });
      const pair = diffPairsMap.get(base);
      if (isP) pair.pTraces.push(t);
      else pair.nTraces.push(t);
    }
  });

  diffPairsMap.forEach(pair => {
    if (pair.pTraces.length > 0 && pair.nTraces.length > 0) {
      // Group by layer
      const layers = new Set([...pair.pTraces.map(t => t.layer), ...pair.nTraces.map(t => t.layer)]);
      let totalP = 0, totalN = 0;

      layers.forEach(l => {
        const pLen = pair.pTraces.filter(t => t.layer === l).reduce((sum, t) => sum + (t.length || 0), 0);
        const nLen = pair.nTraces.filter(t => t.layer === l).reduce((sum, t) => sum + (t.length || 0), 0);
        totalP += pLen;
        totalN += nLen;

        const lRule = State.rules.traceLayers.find(r => r.layer.toUpperCase() === l.toUpperCase());
        const layerTol = (lRule && lRule.diffLayerTol != null) ? lRule.diffLayerTol : globalDiffLayerTol;
        const diff = Math.abs(pLen - nLen);
        const isLayerPass = !checkLayerDiff || (diff <= layerTol);

        traceChecks.push({
          id: `diff_${pair.base}_${l}`,
          category: 'trace',
          categoryName: '走线检查',
          target: `差分对 ${pair.base}_P / ${pair.base}_N`,
          targetType: '差分对',
          layer: l,
          item: '差分逐层线长差',
          actual: `P=${pLen.toFixed(1)} / N=${nLen.toFixed(1)} ，差 ${diff.toFixed(2)} mil`,
          rule: `≤ ${layerTol.toFixed(1)} mil`,
          pass: isLayerPass,
          deviation: isLayerPass ? '0 mil' : `超差 +${(diff - layerTol).toFixed(2)} mil`,
          reason: isLayerPass ? '该层差分线长平衡' : `该层 P/N 线长差 ${diff.toFixed(2)} mil 超过逐层允许值 ${layerTol.toFixed(1)} mil`,
          objId: pair.base
        });
      });

      // Total differential length check
      const totalDiff = Math.abs(totalP - totalN);
      const isTotalPass = !checkTotalDiff || (totalDiff <= globalDiffTol);
      traceChecks.push({
        id: `diff_${pair.base}_total`,
        category: 'trace',
        categoryName: '走线检查',
        target: `差分对 ${pair.base}_P / ${pair.base}_N`,
        targetType: '差分对',
        layer: '所有层合计',
        item: '差分总线长差',
        actual: `总P=${totalP.toFixed(1)} / 总N=${totalN.toFixed(1)} ，差 ${totalDiff.toFixed(2)} mil`,
        rule: `≤ ${globalDiffTol.toFixed(1)} mil`,
        pass: isTotalPass,
        deviation: isTotalPass ? '0 mil' : `总超差 +${(totalDiff - globalDiffTol).toFixed(2)} mil`,
        reason: isTotalPass ? '差分网络总长匹配合格' : `所有层总 P/N 线长差 ${totalDiff.toFixed(2)} mil 超过总长允许值 ${globalDiffTol.toFixed(1)} mil`,
        objId: pair.base
      });
    }
  });

  State.results.trace = {
    hasData: Boolean(tTrace),
    pass: traceChecks.every(c => c.pass),
    checks: traceChecks,
    score: traceChecks.length ? Math.round((traceChecks.filter(c => c.pass).length / traceChecks.length) * 100) : 100
  };
  return traceChecks;
}

/** 约束检查：过孔反焊盘与 Padstack 层名。结果写入 State.results 并返回缺陷条目。 */
function runCopperEngine(ctx) {
  const { tConstraint } = ctx;
  // ==========================================
  // ENGINE 2: 约束检查 (仅使用 ② 约束检查数据框 tConstraint)
  // ==========================================
  const copperChecks = [];
  const chkAnti = $('cfgCheckAntiPad') ? $('cfgCheckAntiPad').checked : true;
  const chkPadstack = $('cfgCheckPadstackLayers') ? $('cfgCheckPadstackLayers').checked : true;
  const antiTol = parseFloat($('cfgAntiPadTol')?.value) || 0.5;
  const layerN = unifiedLayerCount();

  if (tConstraint && typeof CopperCheck !== 'undefined' && CopperCheck.runCopperCheck) {
    const boardItems = CopperCheck.parseBoardItems(tConstraint);
    const sets = State.rules.constraintSets || [];
    const checkRes = CopperCheck.runCopperCheck(boardItems, sets, {
      layerCount: layerN,
      valTol: antiTol,
      enabled: {
        '反焊盘尺寸': chkAnti,
        '焊盘尺寸': false,
        '非功能焊盘尺寸': false,
        'Padstack层名': chkPadstack
      }
    });

    (checkRes.groups || []).forEach(g => {
      const via = g.via;
      const ruleTitle = g.rule ? g.rule.title : '未推算到约束';
      (g.rows || []).forEach((r, rIdx) => {
        if (r.status === '未检查') return;
        const isPass = r.status === '符合';
        const layerStr = (typeof r.layer === 'number' && r.layer > 0) ? `L${r.layer}` : (String(r.layer).startsWith('L') ? r.layer : `L${r.layer}`);
        
        let reasonStr = isPass ? '符合设计约束要求' : `实测值 ${r.actual} 与规则设定值 ${r.expect} 偏差超出容差 ${antiTol} mil`;
        if (r.checkType === 'Padstack层名' && !isPass) {
          reasonStr = `Padstack 命名【${via.padstack}】缺少连接层【${r.expect}】`;
        }

        copperChecks.push({
          id: `copper_${via.id}_${r.checkType}_${r.layer}_${rIdx}`,
          category: 'copper',
          categoryName: '约束检查',
          target: `Via #${via.id} (${via.net || 'GND'})`,
          targetType: '过孔',
          layer: layerStr,
          item: r.checkType,
          actual: r.actual || '无',
          rule: r.expect || '无',
          pass: isPass,
          deviation: isPass ? '0' : (r.actual && r.expect ? `偏差: ${r.actual} vs ${r.expect}` : '不符'),
          reason: reasonStr,
          objId: via.id,
          viaCoord: via.origin
        });
      });
    });
  }

  // Fallback Padstack check if tConstraint was provided but no groups generated
  if (tConstraint && copperChecks.length === 0) {
    parsedConstraint.vias.forEach(v => {
      const padName = v.padstack || '';
      const connLayers = v.connectedLayers || [];
      const missingLayers = connLayers.filter(l => !padName.toUpperCase().includes(l.toUpperCase().replace(/^0+/, '')));
      const isPadOk = missingLayers.length === 0;

      copperChecks.push({
        id: `copper_via_${v.id}_pad`,
        category: 'copper',
        categoryName: '约束检查',
        target: `Via #${v.id} (${v.net || 'GND'})`,
        targetType: '过孔',
        layer: connLayers.join(', ') || '全层',
        item: 'Padstack 层名连接层匹配',
        actual: padName,
        rule: `需包含连接层: ${connLayers.join(', ') || 'N/A'}`,
        pass: isPadOk,
        deviation: isPadOk ? '0' : `缺少 ${missingLayers.join(',')}`,
        reason: isPadOk ? 'Padstack命名与连接层完全匹配' : `过孔存在连接层但在Padstack命名中缺失 [${missingLayers.join(', ')}]`,
        objId: v.id
      });
    });
  }

  State.results.copper = {
    hasData: Boolean(tConstraint),
    pass: copperChecks.every(c => c.pass),
    checks: copperChecks,
    score: copperChecks.length ? Math.round((copperChecks.filter(c => c.pass).length / copperChecks.length) * 100) : 100
  };
  return copperChecks;
}

/** 加工能力检查：孔-孔、线-孔间距。结果写入 State.results 并返回缺陷条目。 */
function runDfmEngine(ctx) {
  const { tDfmFanout } = ctx;
  // ==========================================
  // ENGINE 3: DFM 制造能力检查 (使用 ③ DFM 与扇出方案数据框 tDfmFanout)
  // ==========================================
  const dfmChecks = [];
  if (tDfmFanout && typeof DfmCheck !== 'undefined' && DfmCheck.parseDfmItems) {
    const dfmData = DfmCheck.parseDfmItems(tDfmFanout, {
      gndPadDiameter: parseFloat($('inpGndPadDiam')?.value) || 7.906,
      signalPadDiameter: parseFloat($('inpSignalPadDiam')?.value) || 12.0,
      gndFirstDrill: parseFloat($('inpGndDrillDiam')?.value) || 6.0,
      signalFirstDrill: parseFloat($('inpSignalDrillDiam')?.value) || 6.0,
      ...readUnifiedPadShapes()
    });
    const padPairThreshold = Number($('inpThresholdPadPair')?.value ?? 6);
    const dfmRun = DfmCheck.runDfmCheck(dfmData.vias, dfmData.traces, {
      minClearanceGnd: parseFloat($('inpThresholdGnd')?.value) || 4.01575,
      minClearanceSignal: parseFloat($('inpThresholdSignal')?.value) || 5.04725,
      minClearancePadPair: Number.isFinite(padPairThreshold) ? padPairThreshold : 6,
      mode: $('selDfmMode')?.value || 'pad_to_trace',
      diffNetOnly: $('selDfmNetScope')?.value !== 'all_net',
      layerRules: UnifiedDfmLayerRules.read()
    });

    const defectList = dfmRun.defectPairs || [];
    defectList.forEach(d => {
      const spanTag = d.via.spanLabel || '通孔 (Top~Bottom)';
      dfmChecks.push({
        id: `dfm_pair_${d.via.id}_${d.trace.id}`,
        category: 'dfm',
        categoryName: '加工能力检查',
        target: `Trace #${d.trace.id} (${d.trace.net}) × Via #${d.via.id} [${d.via.spanShort || '通孔'}]`,
        targetType: '过孔/走线对',
        layer: d.trace.subset || '未知层',
        item: d.isGndVia ? '线到 GND 孔盘间距 (Airgap)' : '线到信号孔盘间距 (Airgap)',
        actual: `${d.evalDist.toFixed(2)} mil`,
        rule: `≥ ${d.threshold.toFixed(1)} mil`,
        pass: false,
        deviation: `${(d.evalDist - d.threshold).toFixed(2)} mil`,
        reason: `过孔 [${spanTag}] 穿过走线层 ${d.trace.subset}，实测焊盘间隙 ${d.evalDist.toFixed(2)} mil 低于安全阈值 ${d.threshold.toFixed(1)} mil，存在蚀刻短路隐患`,
        objId: d.trace.id,
        viaId: d.via.id,
        viaCoord: d.via.origin
      });
    });
    (dfmRun.padPairDefects || []).forEach(d => {
      dfmChecks.push({
        id: `dfm_pad_pair_${d.gndVia.id}_${d.sigVia.id}`,
        category: 'dfm', categoryName: '加工能力检查',
        target: `GND Via #${d.gndVia.id} × 信号 Via #${d.sigVia.id}`,
        targetType: '孔盘/孔盘对', layer: d.ruleLayers || '重叠层', item: 'GND 孔盘到信号孔盘间距',
        actual: `${d.padAirgap.toFixed(2)} mil`, rule: `≥ ${d.threshold.toFixed(1)} mil`, pass: false,
        deviation: `${(d.padAirgap - d.threshold).toFixed(2)} mil`,
        reason: `GND 孔盘到信号孔盘实测间隙 ${d.padAirgap.toFixed(2)} mil，低于 ${d.ruleName || '默认'}规则阈值 ${d.threshold.toFixed(1)} mil`,
        objId: d.gndVia.id, viaId: d.gndVia.id, viaCoord: d.gndVia.origin
      });
    });
    State.dfmSkippedPairs = dfmRun.skippedNonSpanningPairs || 0;
  }
  State.results.dfm = {
    hasData: Boolean(tDfmFanout),
    pass: dfmChecks.length === 0,
    checks: dfmChecks,
    score: dfmChecks.length === 0 ? 100 : Math.max(40, 100 - dfmChecks.length * 2)
  };
  return dfmChecks;
}

/** 扇出方案检查：孔群聚类与方案匹配。结果写入 State.results 并返回缺陷条目。 */
function runFanoutEngine(ctx) {
  const { tDfmFanout, parsedDfmFanout } = ctx;
  // ==========================================
  // ENGINE 4: 扇出方案检查 (共用 ③ DFM 与扇出方案数据框 tDfmFanout)
  // ==========================================
  const fanoutChecks = [];
  const fanoutEngine = (typeof FanoutChecker !== 'undefined') ? FanoutChecker : null;
  if (tDfmFanout && fanoutEngine && parsedDfmFanout.vias.length > 0) {
    const clusterDistMil = (parseFloat($('cfgClusterDist')?.value) || 2.0) * 39.37007874;
    const geomTolMil = parseFloat($('cfgGeomTol')?.value) || 0.5;
    const centerDistTolMil = parseFloat($('cfgCenterDistTol')?.value) || 1.0;

    const fanoutLib = new fanoutEngine.FanoutLibrary();
    if (State.rules.fanoutSchemes && State.rules.fanoutSchemes.length > 0) {
      fanoutLib.loadFromJSON(State.rules.fanoutSchemes);
    } else {
      fanoutLib.loadStandardPresets();
    }

    const allowSubset = $('cfgAllowSubsetMatch') ? $('cfgAllowSubsetMatch').checked : true;
    const redundantPolicy = $('cfgRedundantPolicy') ? $('cfgRedundantPolicy').value : 'ANY_GND_REDUNDANT';

    const fRes = fanoutEngine.runFanoutInspection(parsedDfmFanout.vias, fanoutLib, {
      clusterThreshold: clusterDistMil,
      distanceTolerance: centerDistTolMil,
      allowRotation: true,
      allowMirror: true,
      allowSubsetMatch: allowSubset,
      redundantViaPolicy: redundantPolicy
    });

    const clusters = fRes.clusters || [];
    clusters.forEach((cl, idx) => {
      const match = cl.result || cl.matchResult || {};
      const isPass = !!match.pass;

      const sigVias = cl.signalVias || cl.vias.filter(v => v.net && !v.net.toUpperCase().includes('GND'));
      const sigStr = sigVias.map(v => '#' + v.id).join(', ');

      let actualText = match.statusText || '未匹配预设拓扑';
      if (isPass) {
        actualText = `匹配【${match.schemeName || '方案'}】`;
      } else if (match.schemeName && match.schemeName !== '无') {
        actualText = `${match.statusText || '未匹配'} [最接近: ${match.schemeName}]`;
      }

      let reasonText = match.message || (isPass ? '信号孔与周围伴随地孔完全匹配扇出方案' : '孔拓扑或 Padstack 与方案库不匹配');
      if (match.advice && !isPass) {
        reasonText += ` | ${match.advice}`;
      }

      fanoutChecks.push({
        id: `fanout_unit_${idx + 1}`,
        category: 'fanout',
        categoryName: '扇出方案检查',
        target: `信号孔群 (${cl.signalNet || '信号'}) [孔 ${sigStr}]`,
        targetType: '扇出信号单元',
        layer: 'TOP/BOT',
        item: '信号孔及伴随地孔方案适配',
        actual: actualText,
        rule: match.schemeName && match.schemeName !== '无' ? `符合【${match.schemeName}】扇出拓扑与 Padstack` : '符合预设扇出方案拓扑',
        pass: isPass,
        deviation: isPass ? '0 mil' : `${(match.maxDeviation || 0).toFixed(2)} mil`,
        reason: reasonText,
        objId: idx + 1,
        viaCoord: cl.centroid ? [cl.centroid.x, cl.centroid.y] : null
      });
    });
  }
  State.results.fanout = {
    hasData: Boolean(tDfmFanout),
    pass: fanoutChecks.every(c => c.pass),
    checks: fanoutChecks,
    score: fanoutChecks.length === 0 ? 100 : Math.round((fanoutChecks.filter(c => c.pass).length / fanoutChecks.length) * 100)
  };
  return fanoutChecks;
}

/** 铜皮检查：五项几何规则。结果写入 State.results 并返回缺陷条目。 */
function runPourEngine(ctx) {
  const { tPour } = ctx;
  // ==========================================
  // ENGINE 5: 铜皮五项检查 (仅使用 ④ 铜皮检查数据框 tPour)
  // ==========================================
  const pourChecks = [];
  if (tPour && typeof PourChecker !== 'undefined' && PourChecker.runAllCopperChecks) {
    const pourRun = PourChecker.runAllCopperChecks(tPour, {
      viaCoverageRules: State.rules.pourRule1.map(r => ({ id: r.id, padstack: r.padstack, layers: r.layers.split(/[,;\s]+/).filter(Boolean), coverageRadius: r.radius })),
      specialShapeTemplates: State.rules.specialShapeTemplates || [],
      traceMarginRules: State.rules.pourRule3.map(r => ({ id: r.id, traceLayer: r.traceLayer, upperRefLayer: r.upperRef, lowerRefLayer: r.lowerRef, minMargin: r.margin })),
      smallCopperAreaThreshold: parseFloat($('cfgPourSmallArea')?.value) || 500.0,
      minArcRadius: parseFloat($('cfgPourMinArc')?.value) || 10.0
    });

    if (pourRun.results.viaCoverage) {
      pourRun.results.viaCoverage.forEach(r => {
        if (!r.pass) {
          const thresh = r.requiredDist || 50.0;
          pourChecks.push({
            id: `pour_via_${r.viaId}_${r.layer}`,
            category: 'pour',
            categoryName: '铜皮检查',
            target: `Via #${r.viaId} (${r.viaNet || 'GND'})`,
            targetType: '过孔',
            layer: r.layer,
            item: '孔经过层铺铜覆盖检查',
            actual: r.actualDistStr || (r.actualDist < 900000 ? `${r.actualDist.toFixed(1)} mil` : '无铺铜'),
            rule: `≤ ${thresh.toFixed(1)} mil`,
            pass: false,
            deviation: r.actualDist < 900000 ? `超标 +${(r.actualDist - thresh).toFixed(1)} mil` : '完全无铺铜',
            reason: r.actualDist < 900000 ? `孔中心到铜皮最近距离 ${r.actualDist.toFixed(1)} mil 超过 ${thresh.toFixed(1)} mil` : `该物理层 (${r.layer}) 完全未检测到铺铜覆盖`,
            objId: r.viaId,
            viaCoord: r.viaCoord
          });
        }
      });
    }

    if (pourRun.results.traceMargin) {
      pourRun.results.traceMargin.forEach(r => {
        if (!r.pass) {
          const actM = (r.actualMargin != null) ? r.actualMargin : (r.minActualMargin || 0);
          const reqM = (r.minMargin != null) ? r.minMargin : (r.requiredMargin || 50.0);
          pourChecks.push({
            id: `pour_trace_${r.traceId}_${r.refLayer}`,
            category: 'pour',
            categoryName: '铜皮检查',
            target: `Trace #${r.traceId} (${r.traceNet || r.net || '走线'})`,
            targetType: '走线段',
            layer: r.traceLayer,
            item: `参考层 (${r.refLayer}) 铺铜单侧超宽`,
            actual: `实测超宽 ${actM.toFixed(1)} mil`,
            rule: `≥ ${reqM.toFixed(1)} mil`,
            pass: false,
            deviation: `不足 -${(reqM - actM).toFixed(1)} mil`,
            reason: `参考地层 ${r.refLayer} 铺铜边缘距离走线单侧仅 ${actM.toFixed(1)} mil，低于 ${reqM.toFixed(1)} mil 阻抗屏蔽要求`,
            objId: r.traceId
          });
        }
      });
    }
  }
  State.results.pour = {
    hasData: Boolean(tPour),
    pass: pourChecks.length === 0,
    checks: pourChecks,
    score: pourChecks.length === 0 ? 100 : Math.max(50, 100 - pourChecks.length * 10)
  };
  return pourChecks;
}

function runMasterInspection() {
  const ctx = buildInspectionContext();
  if (!ctx) {
    alert('请先在数据导入区选择或拖入至少一个 .txt 数据文件');
    return;
  }

  $('kpiViaCount').textContent = State.elements.vias.length;
  $('kpiTraceCount').textContent = State.elements.traces.length;
  $('kpiShapeCount').textContent = State.elements.shapes.length;
  renderDataIngestionBoxes();

  State.allChecks = [
    ...runTraceEngine(ctx),
    ...runCopperEngine(ctx),
    ...runDfmEngine(ctx),
    ...runFanoutEngine(ctx),
    ...runPourEngine(ctx)
  ];

  // Update UI Panels
  updateMasterKPIs();
  renderDashboard();
  renderMasterDefectsTable();
  renderModularViews();
  updateFilterCounters();

  safeRAF(() => {
    fitCanvasToLayout();
    renderCanvas();
  });
}

