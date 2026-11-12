/* ============================================================================
 * pour-engine.js —— 铜皮五大项检查引擎与按目标对象聚合器
 * ========================================================================== */
(function (root, factory) {
  var geom = (typeof module === "object" && module.exports) ? require("./pour-geom.js") : root.PourChecker;
  var parser = (typeof module === "object" && module.exports) ? require("./pour-parser.js") : root.PourChecker;
  var api = factory(geom, parser);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PourChecker = Object.assign(root.PourChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (geom, parser) {
  "use strict";
  var MM_PER_MIL = geom.MM_PER_MIL;
  var MIL_PER_MM = geom.MIL_PER_MM;
  var dist2D = geom.dist2D;
  var roundN = geom.roundN;
  var pointToShapeDistance = geom.pointToShapeDistance;
  var isPointInsideBBox = geom.isPointInsideBBox;
  var shapeRing = geom.shapeRing;
  var pointInPolygon = geom.pointInPolygon;
  var expandLayerRange = parser.expandLayerRange;
  var parsePcbElements = parser.parsePcbElements;
  var parseShapeBlock = parser.parseShapeBlock;
  /**
   * =========================================================================
   * 检查项 1：孔经过层铺铜覆盖检查 (Via Layer Copper Coverage) - 支持多规则
   * =========================================================================
   */
  function checkViaLayerCoverage(vias, shapes, rules = [], availableLayers = []) {
    const results = [];
    const shapesByLayer = new Map();

    shapes.forEach(s => {
      const l = s.layer.toUpperCase();
      if (!shapesByLayer.has(l)) shapesByLayer.set(l, []);
      shapesByLayer.get(l).push(s);
    });

    for (let rIdx = 0; rIdx < rules.length; rIdx++) {
      const rule = rules[rIdx];
      const padPattern = (rule.padstack || '').trim().toLowerCase();
      const radiusThresh = rule.coverageRadius != null ? parseFloat(rule.coverageRadius) : 50.0;
      const targetLayers = expandLayerRange(rule.layers, availableLayers);

      const matchedVias = vias.filter(v => {
        if (!padPattern || padPattern === '*') return true;
        return v.padstack.toLowerCase().includes(padPattern);
      });

      for (const via of matchedVias) {
        for (const layer of targetLayers) {
          const lKey = layer.trim().toUpperCase();
          const layerShapes = shapesByLayer.get(lKey) || [];

          let minCopperDist = Infinity;
          let nearestShape = null;

          for (const shape of layerShapes) {
            const d = pointToShapeDistance(via.x, via.y, shape);
            if (d < minCopperDist) {
              minCopperDist = d;
              nearestShape = shape;
            }
          }

          const hasCopper = minCopperDist <= radiusThresh;
          const distStr = minCopperDist === Infinity ? '无铜皮' : `${roundN(minCopperDist, 2)} mil`;

          results.push({
            checkCategory: 'via_coverage',
            checkCategoryName: '① 孔经过层铺铜覆盖检查',
            ruleIndex: rIdx + 1,
            ruleId: rule.id || `rule_via_cov_${rIdx + 1}`,
            ruleDesc: `孔【${rule.padstack || '所有孔'}】在【${layer}】距离孔心 ≤ ${radiusThresh} mil 存在铜皮`,
            viaId: via.id,
            viaPadstack: via.padstack,
            viaNet: via.net,
            viaCoord: [via.x, via.y],
            layer,
            requiredDist: radiusThresh,
            actualDist: minCopperDist === Infinity ? 999999 : minCopperDist,
            actualDistStr: distStr,
            nearestShapeId: nearestShape ? nearestShape.id : null,
            pass: hasCopper,
            message: hasCopper
              ? `✅ 符合：孔 #${via.id} 在 ${layer} 层实测距铜皮 ${distStr} (≤ 阈值 ${radiusThresh} mil)`
              : `❌ 不符合：孔 #${via.id} 在 ${layer} 层未检测到满足要求的铜皮 (实测距铜皮 ${distStr} > 阈值 ${radiusThresh} mil)`
          });
        }
      }
    }

    return results;
  }

  /**
   * =========================================================================
   * 检查项 2：特定异型铜皮比对检查 (Special Shaped Copper) - 支持多规则与导入TXT模板
   * =========================================================================
   */
  function checkSpecialShapedCopper(vias, shapes, templates = []) {
    const results = [];
    const shapesByLayer = new Map();

    shapes.forEach(s => {
      const l = s.layer.toUpperCase();
      if (!shapesByLayer.has(l)) shapesByLayer.set(l, []);
      shapesByLayer.get(l).push(s);
    });

    for (let tIdx = 0; tIdx < templates.length; tIdx++) {
      const tmpl = templates[tIdx];
      const padPattern = (tmpl.padstack || '').trim().toLowerCase();
      const targetLayer = (tmpl.layer || '').trim().toUpperCase();
      const tmplName = tmpl.name || `异型铜皮模板_${tIdx + 1}`;
      
      // 期望面积支持显式设置或从导入的 shape 提取
      let expectedArea = tmpl.expectedArea || (tmpl.shape ? tmpl.shape.area : 0);
      const tolArea = tmpl.areaTolerance != null ? parseFloat(tmpl.areaTolerance) : 30.0;

      const matchedVias = vias.filter(v => {
        if (!padPattern || padPattern === '*') return true;
        return v.padstack.toLowerCase().includes(padPattern);
      });
      const layerShapes = shapesByLayer.get(targetLayer) || [];

      for (const via of matchedVias) {
        let bestShape = null;
        let minCenterDist = Infinity;

        for (const shape of layerShapes) {
          const d = dist2D(via.x, via.y, shape.centroid.x, shape.centroid.y);
          if (d < minCenterDist && d <= 120.0) {
            minCenterDist = d;
            bestShape = shape;
          }
        }

        let isMatch = false;
        let failReason = '';

        if (!bestShape) {
          failReason = `在 ${targetLayer} 层未找到与孔 #${via.id} 关联的铜皮`;
        } else {
          if (expectedArea > 0) {
            const areaDiff = Math.abs(bestShape.area - expectedArea);
            if (areaDiff <= tolArea) {
              isMatch = true;
            } else {
              failReason = `铜皮 Shape #${bestShape.id} 面积为 ${roundN(bestShape.area, 1)} sq mil，与模板期望面积 ${roundN(expectedArea, 1)} sq mil 偏差 ${roundN(areaDiff, 1)} sq mil (超出容差 ±${tolArea})`;
            }
          } else {
            isMatch = true;
          }
        }

        results.push({
          checkCategory: 'special_shape',
          checkCategoryName: '② 特定异型铜皮比对检查',
          templateIndex: tIdx + 1,
          templateName: tmplName,
          viaId: via.id,
          viaPadstack: via.padstack,
          viaCoord: [via.x, via.y],
          layer: tmpl.layer,
          targetShapeId: bestShape ? bestShape.id : null,
          actualArea: bestShape ? bestShape.area : 0,
          expectedArea,
          pass: isMatch,
          message: isMatch
            ? `✅ 符合：孔 #${via.id} 在 ${tmpl.layer} 层的铜皮与异型模板【${tmplName}】匹配 (实测面积 ${bestShape ? roundN(bestShape.area, 1) : '-'} sq mil)`
            : `❌ 不符合：孔 #${via.id} 在 ${tmpl.layer} 层异型铜皮不匹配 (${failReason})`
        });
      }
    }

    return results;
  }

  /**
   * =========================================================================
   * 检查项 3：走线上/下参考层铺铜覆盖与单侧超宽检查 (Trace Reference Margin) - 支持多规则
   * =========================================================================
   */
  function checkTraceReferenceMargin(traces, shapes, rules = []) {
    const results = [];
    const shapesByLayer = new Map();

    shapes.forEach(s => {
      const l = s.layer.toUpperCase();
      if (!shapesByLayer.has(l)) shapesByLayer.set(l, []);
      shapesByLayer.get(l).push(s);
    });

    for (let rIdx = 0; rIdx < rules.length; rIdx++) {
      const rule = rules[rIdx];
      const traceLayer = (rule.traceLayer || '').trim().toUpperCase();
      const upperRef = (rule.upperRefLayer || '').trim().toUpperCase();
      const lowerRef = (rule.lowerRefLayer || '').trim().toUpperCase();
      const marginThresh = rule.minMargin != null ? parseFloat(rule.minMargin) : 50.0;

      const layerTraces = traces.filter(t => t.layer.toUpperCase() === traceLayer);

      for (const trace of layerTraces) {
        const refsToCheck = [];
        if (upperRef) refsToCheck.push({ name: upperRef, type: '上参考层' });
        if (lowerRef) refsToCheck.push({ name: lowerRef, type: '下参考层' });

        for (const ref of refsToCheck) {
          const refShapes = shapesByLayer.get(ref.name) || [];

          if (refShapes.length === 0) {
            results.push({
              checkCategory: 'trace_ref_margin',
              checkCategoryName: '③ 走线参考层超宽检查',
              ruleIndex: rIdx + 1,
              traceId: trace.id,
              traceNet: trace.net,
              traceLayer: trace.layer,
              refLayer: ref.name,
              refType: ref.type,
              minMargin: marginThresh,
              actualMargin: 0,
              pass: false,
              message: `❌ 不符合：走线【${trace.net}】在 ${ref.type}【${ref.name}】完全无铺铜铜皮 (缺失参考地/电源平面)`
            });
            continue;
          }

          let minObservedMargin = Infinity;
          let coveredCount = 0;
          let totalSamples = 0;

          if (refShapes.length === 0) {
            results.push({
              checkCategory: 'trace_ref_margin',
              checkCategoryName: '③ 走线参考层超宽检查',
              ruleIndex: rIdx + 1,
              traceId: trace.id,
              traceNet: trace.net,
              traceLayer: trace.layer,
              refLayer: ref.name,
              refType: ref.type,
              minMargin: marginThresh,
              actualMargin: 0,
              pass: false,
              message: `❌ 不符合：走线【${trace.net}】在 ${ref.type}【${ref.name}】无任何铺铜覆盖（实测外延 0 mil < 规则阈值 ${marginThresh} mil）`
            });
            continue;
          }

          for (const seg of trace.segments) {
            const samplePts = [];
            if (seg.type === 'line') {
              const numSamples = Math.max(3, Math.ceil((seg.len || 10) / 20.0));
              for (let i = 0; i <= numSamples; i++) {
                const t = i / numSamples;
                samplePts.push({
                  x: seg.x1 + (seg.x2 - seg.x1) * t,
                  y: seg.y1 + (seg.y2 - seg.y1) * t
                });
              }
            } else if (seg.type === 'arc') {
              const a1 = Math.atan2(seg.y1 - seg.cy, seg.x1 - seg.cx);
              const a2 = Math.atan2(seg.y2 - seg.cy, seg.x2 - seg.cx);
              let diff = a2 - a1;
              if (diff <= 0) diff += Math.PI * 2;
              const numSamples = Math.max(4, Math.ceil((seg.radius * diff) / 20.0));
              for (let i = 0; i <= numSamples; i++) {
                const ang = a1 + diff * (i / numSamples);
                samplePts.push({
                  x: seg.cx + Math.cos(ang) * seg.radius,
                  y: seg.cy + Math.sin(ang) * seg.radius
                });
              }
            }

            for (const pt of samplePts) {
              totalSamples++;
              let ptMargin = -1;
              for (const shape of refShapes) {
                if (isPointInsideBBox(pt.x, pt.y, shape.bbox)) {
                  const dEdge = Math.min(
                    pt.x - shape.bbox.minX,
                    shape.bbox.maxX - pt.x,
                    pt.y - shape.bbox.minY,
                    shape.bbox.maxY - pt.y
                  );
                  const singleSideMargin = dEdge - ((seg.width || 6.0) / 2);
                  if (singleSideMargin > ptMargin) {
                    ptMargin = singleSideMargin;
                  }
                }
              }

              if (ptMargin >= 0) {
                coveredCount++;
                if (ptMargin < minObservedMargin) minObservedMargin = ptMargin;
              } else {
                minObservedMargin = 0;
              }
            }
          }

          const isPass = totalSamples > 0 && coveredCount === totalSamples && minObservedMargin >= marginThresh;
          const actualMarginVal = (minObservedMargin === Infinity || totalSamples === 0) ? 0 : minObservedMargin;

          results.push({
            checkCategory: 'trace_ref_margin',
            checkCategoryName: '③ 走线参考层超宽检查',
            ruleIndex: rIdx + 1,
            traceId: trace.id,
            traceNet: trace.net,
            traceLayer: trace.layer,
            refLayer: ref.name,
            refType: ref.type,
            minMargin: marginThresh,
            actualMargin: actualMarginVal,
            pass: isPass,
            message: isPass
              ? `✅ 符合：走线【${trace.net}】在 ${ref.type}【${ref.name}】单侧铜皮外延 ${roundN(actualMarginVal, 1)} mil (≥ 阈值 ${marginThresh} mil)`
              : `❌ 不符合：走线【${trace.net}】在 ${ref.type}【${ref.name}】单侧铜皮外延仅 ${roundN(actualMarginVal, 1)} mil (< 阈值 ${marginThresh} mil，存在跨分割或外延不足)`
          });
        }
      }
    }

    return results;
  }

  /**
   * =========================================================================
   * 检查项 4：孤立小铜皮检查 (Isolated Small Copper)
   * =========================================================================
   */
  function checkIsolatedSmallCopper(shapes, vias, maxAreaThreshold = 500.0) {
    const results = [];

    for (const shape of shapes) {
      if (shape.area > 0 && shape.area < maxAreaThreshold) {
        // 过孔是否真的落在这块铜皮里：优先用轮廓做点内判定（同层），
        // 没有几何数据时才退回「质心 30 mil 内」的近似
        const ring = shapeRing(shape);
        const hasRing = ring.length >= 3;
        const layerVias = vias.filter(v => !v.layer || !shape.layer || v.layer === shape.layer);

        let containsVia = false;
        let viaInsideId = null;
        for (const via of layerVias) {
          let hit;
          if (hasRing) {
            hit = pointInPolygon(via.x, via.y, ring);
          } else {
            hit = dist2D(via.x, via.y, shape.centroid.x, shape.centroid.y) <= 30.0;
          }
          if (hit) { containsVia = true; viaInsideId = via.id; break; }
        }

        results.push({
          checkCategory: 'isolated_copper',
          checkCategoryName: '④ 孤立小铜皮检查',
          shapeId: shape.id,
          layer: shape.layer,
          set: shape.set,
          area: shape.area,
          areaMm2: shape.areaMm2,
          areaThreshold: maxAreaThreshold,
          centroid: shape.centroid,
          containsVia,
          viaInsideId,
          containsViaBy: hasRing ? 'outline' : 'centroid-proximity',
          pass: false,
          message: `❌ 发现孤立小铜皮：Shape #${shape.id} (${shape.layer}层) 面积仅 ${roundN(shape.area, 1)} sq mil (${roundN(shape.areaMm2, 4)} mm² < 阈值 ${maxAreaThreshold} sq mil)，中心坐标 [${roundN(shape.centroid.x, 1)}, ${roundN(shape.centroid.y, 1)}]`
        });
      }
    }

    return results;
  }

  /**
   * =========================================================================
   * 检查项 5：铜皮最小圆弧半径检查 (Copper Arc Minimum Radius)
   * =========================================================================
   */
  function checkCopperArcRadius(shapes, minArcRadius = 10.0) {
    const results = [];

    for (const shape of shapes) {
      if (shape.arcs && shape.arcs.length > 0) {
        for (let i = 0; i < shape.arcs.length; i++) {
          const arc = shape.arcs[i];
          const isPass = arc.radius >= minArcRadius;

          if (!isPass) {
            results.push({
              checkCategory: 'arc_radius',
              checkCategoryName: '⑤ 铜皮圆弧半径检查',
              shapeId: shape.id,
              layer: shape.layer,
              arcIndex: i + 1,
              actualRadius: arc.radius,
              requiredRadius: minArcRadius,
              centerCoord: [arc.cx, arc.cy],
              pass: false,
              message: `❌ 铜皮圆弧半径过小：Shape #${shape.id} (${shape.layer}层) 第 ${i + 1} 段圆弧实测半径 ${roundN(arc.radius, 2)} mil (< 最小允许值 ${minArcRadius} mil)，圆心坐标 [${roundN(arc.cx, 1)}, ${roundN(arc.cy, 1)}]`
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * =========================================================================
   * 结果聚合器：将同一目标对象的多层/多段检查结果进行汇总
   * =========================================================================
   */
  function groupResultsByTargetObject(records) {
    const groups = [];
    const map = new Map();

    for (const r of records) {
      let key = '';
      let targetType = '';
      let targetLabel = '';

      if (r.checkCategory === 'via_coverage') {
        key = `via_coverage_${r.viaId}_${r.ruleIndex || 1}`;
        targetType = 'via';
        targetLabel = `孔 #${r.viaId} (${r.viaNet || 'GND'})`;
      } else if (r.checkCategory === 'special_shape') {
        key = `special_shape_${r.viaId}_${r.templateId || r.layer}`;
        targetType = 'via';
        targetLabel = `孔 #${r.viaId} (${r.viaNet || 'GND'})`;
      } else if (r.checkCategory === 'trace_ref_margin') {
        key = `trace_ref_margin_${r.traceId}_${r.ruleIndex || 1}`;
        targetType = 'trace';
        targetLabel = `走线 #${r.traceId} (${r.traceNet})`;
      } else if (r.checkCategory === 'isolated_copper') {
        key = `isolated_copper_${r.shapeId}`;
        targetType = 'shape';
        targetLabel = `铜皮 Shape #${r.shapeId}`;
      } else if (r.checkCategory === 'arc_radius') {
        key = `arc_radius_${r.shapeId}`;
        targetType = 'shape';
        targetLabel = `铜皮 Shape #${r.shapeId}`;
      } else {
        key = `misc_${Math.random()}`;
        targetLabel = '未知目标';
      }

      if (!map.has(key)) {
        const item = {
          groupKey: key,
          checkCategory: r.checkCategory,
          checkCategoryName: r.checkCategoryName,
          targetType,
          targetLabel,
          viaId: r.viaId,
          viaNet: r.viaNet,
          viaPadstack: r.viaPadstack,
          viaCoord: r.viaCoord,
          traceId: r.traceId,
          traceNet: r.traceNet,
          traceLayer: r.traceLayer,
          shapeId: r.shapeId,
          layer: r.layer,
          centroid: r.centroid,
          subRecords: []
        };
        map.set(key, item);
        groups.push(item);
      }

      map.get(key).subRecords.push(r);
    }

    // Synthesize group summaries
    for (const g of groups) {
      const subs = g.subRecords;
      const allPass = subs.every(s => s.pass);
      g.pass = allPass;

      if (g.checkCategory === 'via_coverage') {
        const failedSubs = subs.filter(s => !s.pass);
        const passedSubs = subs.filter(s => s.pass);
        const layersChecked = subs.map(s => s.layer);
        g.layerListStr = layersChecked.join(', ');
        g.layer = g.layerListStr;
        g.layerCount = layersChecked.length;
        g.failCount = failedSubs.length;
        g.passCount = passedSubs.length;
        g.requiredDist = subs[0].requiredDist || 50.0;

        if (allPass) {
          g.actualDistStr = '全部经过层均覆盖';
          g.metricsStr = `经过层全覆盖 (≤ ${g.requiredDist} mil)`;
          g.message = `✅ 符合：孔 #${g.viaId} (${g.viaNet || 'GND'}) 在全部 ${g.layerCount} 个经过层【${g.layerListStr}】周围均检测到有效铺铜 (≤ ${g.requiredDist} mil)`;
        } else {
          const failLayers = failedSubs.map(s => s.layer).join(', ');
          g.actualDistStr = `${failLayers} 等 ${g.failCount} 层无铜皮`;
          g.metricsStr = `${failLayers} 等 ${g.failCount} 层无铜皮/超标 (要求 ≤ ${g.requiredDist} mil)`;
          g.message = `❌ 不符合：孔 #${g.viaId} (${g.viaNet || 'GND'}) 在 ${g.failCount} 个经过层【${failLayers}】未检测到铺铜（距孔心 > ${g.requiredDist} mil）`;
        }
      } else if (g.checkCategory === 'special_shape') {
        const s0 = subs[0];
        g.layer = s0.layer;
        g.layerListStr = s0.layer;
        g.expectedArea = s0.expectedArea;
        g.actualArea = s0.actualArea;
        g.metricsStr = `实测面积: ${roundN(s0.actualArea, 1)} sq mil (期望 ${s0.expectedArea})`;
        g.message = s0.message;
      } else if (g.checkCategory === 'trace_ref_margin') {
        const failedSubs = subs.filter(s => !s.pass);
        const s0 = subs[0];
        g.traceLayer = s0.traceLayer;
        g.layer = s0.traceLayer;
        g.layerListStr = `信号层: ${s0.traceLayer} (${subs.map(s => `${s.refType}:${s.refLayer}`).join(', ')})`;
        g.minMargin = s0.minMargin;

        if (allPass) {
          g.actualMargin = s0.actualMargin;
          g.metricsStr = `各参考层单侧外延均 ≥ ${s0.minMargin} mil`;
          g.message = `✅ 符合：走线【${s0.traceNet}】在上/下参考层单侧外延均满足 ≥ ${s0.minMargin} mil 规则`;
        } else {
          const failDesc = failedSubs.map(s => `${s.refType}【${s.refLayer}】仅 ${roundN(s.actualMargin, 1)} mil`).join('; ');
          g.actualMargin = Math.min(...subs.map(s => s.actualMargin));
          g.metricsStr = `外延不足: ${failDesc} (要求 ≥ ${s0.minMargin} mil)`;
          g.message = `❌ 不符合：走线【${s0.traceNet}】在 ${failDesc}，单侧超宽不足 ${s0.minMargin} mil（存在跨分割/边缘不连续风险）`;
        }
      } else if (g.checkCategory === 'isolated_copper') {
        const s0 = subs[0];
        g.layer = s0.layer;
        g.layerListStr = s0.layer;
        g.area = s0.area;
        g.areaThreshold = s0.areaThreshold;
        g.metricsStr = `铜皮面积: ${roundN(s0.area, 1)} sq mil (阈值 < ${s0.areaThreshold})`;
        g.message = s0.message;
      } else if (g.checkCategory === 'arc_radius') {
        const s0 = subs[0];
        const minR = Math.min(...subs.map(s => s.actualRadius));
        g.layer = s0.layer;
        g.layerListStr = s0.layer;
        g.actualRadius = minR;
        g.requiredRadius = s0.requiredRadius;
        g.smallArcCount = subs.length;
        g.metricsStr = `最小半径: ${roundN(minR, 2)} mil (共 ${subs.length} 处圆弧 < ${s0.requiredRadius} mil)`;
        g.message = `❌ 不符合：铜皮 Shape #${g.shapeId} 在【${s0.layer}】层存在 ${subs.length} 处过小圆弧，最小半径仅 ${roundN(minR, 2)} mil (< 阈值 ${s0.requiredRadius} mil)，易引起蚀刻酸角缺陷`;
      }
    }

    return groups;
  }

  /**
   * 综合运行全部 5 项铜皮检查
   */
  function runAllCopperChecks(inputText, config = {}) {
    const startTime = Date.now();
    const parsed = parsePcbElements(inputText);
    const { shapes, vias, traces, layers } = parsed;

    const viaCovRules = config.viaCoverageRules || [
      { id: 'cov_1', padstack: 'HDI_045drill_ring3_1_4', layers: 'L1-L5', coverageRadius: 50.0 },
      { id: 'cov_2', padstack: 'BGA_GND_pad1mil_0902', layers: '02G01P, 19IS08', coverageRadius: 50.0 }
    ];

    const specialShapeTemplates = config.specialShapeTemplates || [
      { id: 'tmpl_1', name: 'L2特定异型泪滴铜皮', padstack: 'BGA_3510', layer: '02G01P', expectedArea: 452.38, areaTolerance: 30.0 },
      { id: 'tmpl_2', name: 'L19特定异型铜皮', padstack: 'BGA_3510', layer: '19IS08', expectedArea: 113.10, areaTolerance: 20.0 }
    ];

    const traceMarginRules = config.traceMarginRules || [
      { id: 'margin_1', traceLayer: '19IS08', upperRefLayer: '08IS03', lowerRefLayer: 'Bottom', minMargin: 50.0 },
      { id: 'margin_2', traceLayer: '08IS03', upperRefLayer: '02G01P', lowerRefLayer: '19IS08', minMargin: 50.0 }
    ];

    const smallCopperAreaThreshold = config.smallCopperAreaThreshold != null ? config.smallCopperAreaThreshold : 500.0;
    const minArcRadius = config.minArcRadius != null ? config.minArcRadius : 10.0;

    // 执行五项检查
    const res1 = checkViaLayerCoverage(vias, shapes, viaCovRules, layers);
    const res2 = checkSpecialShapedCopper(vias, shapes, specialShapeTemplates);
    const res3 = checkTraceReferenceMargin(traces, shapes, traceMarginRules);
    const res4 = checkIsolatedSmallCopper(shapes, vias, smallCopperAreaThreshold);
    const res5 = checkCopperArcRadius(shapes, minArcRadius);

    const allDefects = [
      ...res1.filter(r => !r.pass),
      ...res2.filter(r => !r.pass),
      ...res3.filter(r => !r.pass),
      ...res4.filter(r => !r.pass),
      ...res5.filter(r => !r.pass)
    ];

    const allRecords = [
      ...res1,
      ...res2,
      ...res3,
      ...res4,
      ...res5
    ];

    const groupedRecords = groupResultsByTargetObject(allRecords);
    const groupedDefects = groupedRecords.filter(g => !g.pass);

    const elapsedMs = Date.now() - startTime;

    const summary = {
      totalShapes: shapes.length,
      totalVias: vias.length,
      totalTraces: traces.length,
      totalLayers: layers.length,
      totalChecks: allRecords.length,
      totalDefects: allDefects.length,
      totalGroupedChecks: groupedRecords.length,
      totalGroupedDefects: groupedDefects.length,
      passCount: allRecords.length - allDefects.length,
      failCount: allDefects.length,
      breakdown: {
        viaCoverageDefects: res1.filter(r => !r.pass).length,
        specialShapeDefects: res2.filter(r => !r.pass).length,
        traceMarginDefects: res3.filter(r => !r.pass).length,
        smallCopperDefects: res4.filter(r => !r.pass).length,
        arcRadiusDefects: res5.filter(r => !r.pass).length
      },
      elapsedMs
    };

    return {
      success: true,
      shapes,
      vias,
      traces,
      layers,
      summary,
      results: {
        all: allRecords,
        defects: allDefects,
        grouped: groupedRecords,
        groupedDefects: groupedDefects,
        viaCoverage: res1,
        specialShape: res2,
        traceMargin: res3,
        isolatedCopper: res4,
        arcRadius: res5
      }
    };
  }
  return {
    checkViaLayerCoverage: checkViaLayerCoverage,
    checkSpecialShapedCopper: checkSpecialShapedCopper,
    checkTraceReferenceMargin: checkTraceReferenceMargin,
    checkIsolatedSmallCopper: checkIsolatedSmallCopper,
    checkCopperArcRadius: checkCopperArcRadius,
    groupResultsByTargetObject: groupResultsByTargetObject,
    runAllCopperChecks: runAllCopperChecks
  };
});
