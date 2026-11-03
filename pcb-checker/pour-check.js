/**
 * pour-check.js
 * PCB 铜皮综合检查引擎 (Copper Pour Inspection Engine)
 * 
 * 检查五大项目：
 * 1. 【孔经过层铺铜覆盖检查】：支持配置多条规则（多过孔类型、多层范围如 L1~L5、自定义中心距如 50mil）
 * 2. 【特定异型铜皮比对检查】：支持配置多条规则，异型铜皮通过导入 TXT 数据获取几何与面积并在目标层严格比对
 * 3. 【走线上/下参考层铺铜覆盖与单侧超宽检查】：支持配置多条规则（多信号层、上下参考层指定、单侧超宽如 50mil）
 * 4. 【孤立小铜皮检查】：面积小于设定阈值的孤立小铜皮 / 碎铜 / 死铜检测
 * 5. 【铜皮最小圆弧半径检查】：铜皮轮廓中圆弧半径小于设定阈值的锐角/过小圆弧检测
 */

(function (global) {
  'use strict';

  const MM_PER_MIL = 0.0254;
  const MIL_PER_MM = 1 / 0.0254;

  function dist2D(x1, y1, x2, y2) {
    return Math.hypot(x1 - x2, y1 - y2);
  }

  function roundN(val, n = 3) {
    if (typeof val !== 'number' || isNaN(val)) return 0;
    const factor = Math.pow(10, n);
    return Math.round(val * factor) / factor;
  }

  /**
   * 圆弧高精度参数化插值采样 (与 EDA/CAD 引擎完全一致，消除 Canvas 角度反转与 270 度环绕 Bug)
   */
  function sampleArcPoints(center, radius, p1, p2, direction, steps) {
    steps = steps || 24;
    const cx = center[0], cy = center[1];
    const ang1 = Math.atan2(p1[1] - cy, p1[0] - cx);
    const ang2 = Math.atan2(p2[1] - cy, p2[0] - cx);
    const TWO_PI = 2 * Math.PI;

    let span;
    if (direction === 'CCW') {
      span = (ang2 - ang1) % TWO_PI;
      if (span < 0) span += TWO_PI;
    } else {
      span = (ang1 - ang2) % TWO_PI;
      if (span < 0) span += TWO_PI;
    }
    if (span === 0) span = TWO_PI;

    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const frac = i / steps;
      const curAng = (direction === 'CCW') ? (ang1 + frac * span) : (ang1 - frac * span);
      pts.push([cx + radius * Math.cos(curAng), cy + radius * Math.sin(curAng)]);
    }
    return pts;
  }

  /**
   * 辅助函数：层范围解析与展开 (如 "L1-L5" -> ["L1", "L2", "L3", "L4", "L5"])
   * @param {string|Array<string>} layerInput 
   * @param {Array<string>} availableLayers 
   * @returns {Array<string>} 展开后的层列表
   */
  function expandLayerRange(layerInput, availableLayers = []) {
    if (Array.isArray(layerInput)) {
      return layerInput.map(s => String(s).trim()).filter(Boolean);
    }
    if (!layerInput || typeof layerInput !== 'string') return [];

    const str = layerInput.trim();
    if (str === '*' || str.toUpperCase() === 'ALL' || str === '全部' || str === '全部层') {
      return availableLayers.length > 0 ? [...availableLayers] : ['Top', '02G01P', '08IS03', '19IS08', 'Bottom'];
    }

    // 检查范围表达式如 "L1-L5", "L1~L10", "1-10", "01-08"
    const rangeMatch = str.match(/^([a-zA-Z]*)(\d+)\s*(?:-|~|\.\.)\s*([a-zA-Z]*)(\d+)$/);
    if (rangeMatch) {
      const prefix = rangeMatch[1] || rangeMatch[3] || 'L';
      const startNum = parseInt(rangeMatch[2], 10);
      const endNum = parseInt(rangeMatch[4], 10);
      const minN = Math.min(startNum, endNum);
      const maxN = Math.max(startNum, endNum);
      const res = [];
      for (let i = minN; i <= maxN; i++) {
        res.push(`${prefix}${i}`);
      }
      return res;
    }

    // 普通逗号、分号、斜杠、空格分隔
    return str.split(/[,;\/\s]+/).map(s => s.trim()).filter(Boolean);
  }

  /**
   * 1. 解析 EDA TXT 中的 Shape (铜皮)、Via (过孔)、Trace (走线)
   * @param {string} text 
   * @returns {Object} { shapes, vias, traces, layers }
   */
  function parsePcbElements(text) {
    if (!text || typeof text !== 'string') {
      return { shapes: [], vias: [], traces: [], layers: [] };
    }

    const RE_ITEM_BLOCK = /Item\s+(\d+)[\s\S]*?(?=Item\s+\d+|\s*~+\s*End\s*~+|\s*$)/g;
    const shapes = [];
    const vias = [];
    const traces = [];
    const layerSet = new Set();

    let match;
    while ((match = RE_ITEM_BLOCK.exec(text)) !== null) {
      const itemNum = parseInt(match[1], 10);
      const block = match[0];

      // === SHAPE (铜皮) ===
      if (/<(?:\s*Shape\s*)>/i.test(block)) {
        const shapeObj = parseShapeBlock(itemNum, block);
        if (shapeObj) {
          shapes.push(shapeObj);
          if (shapeObj.layer) layerSet.add(shapeObj.layer);
        }
      }
      // === VIA (过孔) ===
      else if (/<(?:\s*Via\s*)>/i.test(block)) {
        const viaObj = parseViaBlock(itemNum, block);
        if (viaObj) {
          vias.push(viaObj);
        }
      }
      // === TRACE / LINE / SEG (走线) ===
      else if (/<(?:\s*Trace(?:\s*Seg)?|\s*Line(?:\s*Seg)?|\s*Seg|\s*Segment|\s*Arc)\s*>/i.test(block)) {
        const traceObj = parseTraceBlock(itemNum, block);
        if (traceObj) {
          traces.push(traceObj);
          if (traceObj.layer) layerSet.add(traceObj.layer);
        }
      }
    }

    const layers = Array.from(layerSet).sort();
    return { shapes, vias, traces, layers };
  }

  /**
   * 解析单个 Shape 块
   */
  function parseShapeBlock(itemNum, block) {
    const subsetM = block.match(/Subset:\s*([^\r\n]+)/i);
    const layer = subsetM ? subsetM[1].trim() : 'UNKNOWN_LAYER';
    const setM = block.match(/Set:\s*([^\r\n]+)/i);
    const set = setM ? setM[1].trim() : 'Etch';
    const typeM = block.match(/Type:\s*([^\r\n]+)/i);
    const type = typeM ? typeM[1].trim() : 'Shape(Static)';
    const areaM = block.match(/Area:\s*([\d\.\-]+)/i);
    const area = areaM ? parseFloat(areaM[1]) : 0;

    const boundary = [];
    const arcs = [];
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    function updateBBox(x, y) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    // Line segs
    const RE_LINE_SEG = /Line\s+seg:\s*xy\s*\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]\s*xy\s*\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\](?:\s*Width\s*\(\s*([\d\.\-]+)\s*\))?/gi;
    let lm;
    while ((lm = RE_LINE_SEG.exec(block)) !== null) {
      const x1 = parseFloat(lm[1]), y1 = parseFloat(lm[2]);
      const x2 = parseFloat(lm[3]), y2 = parseFloat(lm[4]);
      const width = lm[5] ? parseFloat(lm[5]) : 0;
      boundary.push({ type: 'line', x1, y1, x2, y2, width });
      updateBBox(x1, y1); updateBBox(x2, y2);
    }

    // Arc segs
    const RE_ARC_SEG = /Arc\s+seg:\s*xy\s*\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]\s*xy\s*\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\](?:\s*Width\s*\(\s*([\d\.\-]+)\s*\))?[\s\S]*?Center-xy:\s*\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]\s*Radius\s*\(\s*([\d\.\-]+)\s*\)(?:\s*(CCW|CW))?/gi;
    let am;
    while ((am = RE_ARC_SEG.exec(block)) !== null) {
      const x1 = parseFloat(am[1]), y1 = parseFloat(am[2]);
      const x2 = parseFloat(am[3]), y2 = parseFloat(am[4]);
      const width = am[5] ? parseFloat(am[5]) : 0;
      const cx = parseFloat(am[6]), cy = parseFloat(am[7]);
      const radius = parseFloat(am[8]);
      const ccw = !am[9] || am[9].toUpperCase() === 'CCW';

      const arcItem = { type: 'arc', x1, y1, x2, y2, cx, cy, radius, ccw, width };
      boundary.push(arcItem);
      arcs.push(arcItem);

      updateBBox(cx - radius, cy - radius);
      updateBBox(cx + radius, cy + radius);
      updateBBox(x1, y1); updateBBox(x2, y2);
    }

    if (minX === Infinity) { minX = 0; maxX = 0; minY = 0; maxY = 0; }

    const centroid = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2
    };

    return {
      id: itemNum,
      rawId: itemNum,
      layer,
      set,
      type,
      area,
      areaMm2: area * MM_PER_MIL * MM_PER_MIL,
      boundary,
      arcs,
      centroid,
      bbox: { minX, minY, maxX, maxY, spanX: maxX - minX, spanY: maxY - minY }
    };
  }

  /**
   * 解析 Via 块
   */
  function parseViaBlock(itemNum, block) {
    const origM = block.match(/(?:Origin-xy|Location|xy):\s*\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]/i);
    if (!origM) return null;

    const padM = block.match(/Padstack\s+Name:\s*([^\r\n]+)/i);
    const netM = block.match(/Net:\s*([^\r\n]+)/i);
    const drillM = block.match(/Circle\s+Drill:\s*([\d\.\-]+)/i);
    const connM = block.match(/Connections:[\s\S]*?(?:Trace|Shape):\s*\d+\s*\(([^)]+)\)/i);

    return {
      id: itemNum,
      x: parseFloat(origM[1]),
      y: parseFloat(origM[2]),
      padstack: padM ? padM[1].trim() : 'UNKNOWN_PADSTACK',
      net: netM ? netM[1].trim() : 'GND',
      drill: drillM ? parseFloat(drillM[1]) : 3.94,
      connectedLayers: connM ? connM[1].split(/\s+/).filter(Boolean) : []
    };
  }

  /**
   * 解析 Trace 块
   */
  function parseTraceBlock(itemNum, block) {
    const subsetM = block.match(/(?:Subset|Layer):\s*([^\r\n]+)/i);
    const netM = block.match(/Net:\s*([^\r\n]+)/i);
    const lenM = block.match(/(?:Seg\s+Length|Length):\s*([\d\.\-]+)/i);
    const layer = subsetM ? subsetM[1].trim() : 'UNKNOWN_LAYER';
    const net = netM ? netM[1].trim() : 'UNNAMED_NET';

    const segments = [];
    let totalLen = 0;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    function updateBBox(x, y) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const lines = block.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // 1. 圆弧段 (Arc seg:)
      if (/^Arc\s+seg:/i.test(line)) {
        const nextLine = (i + 1 < lines.length) ? lines[i + 1] : '';
        const nextLine2 = (i + 2 < lines.length) ? lines[i + 2] : '';
        const fullArcText = line + ' ' + nextLine + ' ' + nextLine2;
        const am = fullArcText.match(/Arc\s+seg:\s*(?:xy\s*)?\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]\s*(?:to\s*|\s*xy\s*)\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\](?:\s*Width\s*\(\s*([\d\.\-]+)\s*\))?[\s\S]*?Center-xy:\s*\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]\s*Radius\s*\(\s*([\d\.\-]+)\s*\)(?:\s*(CCW|CW))?/i);
        if (am) {
          const x1 = parseFloat(am[1]), y1 = parseFloat(am[2]);
          const x2 = parseFloat(am[3]), y2 = parseFloat(am[4]);
          const width = am[5] ? parseFloat(am[5]) : 6.0;
          const cx = parseFloat(am[6]), cy = parseFloat(am[7]);
          const radius = parseFloat(am[8]);
          const dir = am[9] ? am[9].toUpperCase() : (fullArcText.includes('CW') && !fullArcText.includes('CCW') ? 'CW' : 'CCW');
          const len = Math.PI * radius * 0.5;
          totalLen += len;
          segments.push({ type: 'arc', x1, y1, x2, y2, cx, cy, radius, dir, width, len });
          updateBBox(x1, y1); updateBBox(x2, y2);
          updateBBox(cx - radius, cy - radius); updateBBox(cx + radius, cy + radius);
        }
      }
      // 2. 直线段 (Line seg:, Seg:, Segment:)
      else if (/^(?:Line\s+seg|Seg|Segment):/i.test(line)) {
        const lm = line.match(/(?:Line\s+seg|Seg|Segment):\s*(?:xy\s*)?\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]\s*(?:to\s*|\s*xy\s*)\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\](?:\s*Width\s*\(\s*([\d\.\-]+)\s*\))?/i);
        if (lm) {
          const x1 = parseFloat(lm[1]), y1 = parseFloat(lm[2]);
          const x2 = parseFloat(lm[3]), y2 = parseFloat(lm[4]);
          const width = lm[5] ? parseFloat(lm[5]) : 6.0;
          const len = dist2D(x1, y1, x2, y2);
          totalLen += len;
          segments.push({ type: 'line', x1, y1, x2, y2, width, len });
          updateBBox(x1, y1); updateBBox(x2, y2);
        }
      }
    }

    if (segments.length === 0) return null;

    return {
      id: itemNum,
      layer,
      net,
      segments,
      length: lenM ? parseFloat(lenM[1]) : totalLen,
      width: segments[0].width || 6.0,
      bbox: { minX, minY, maxX, maxY, spanX: maxX - minX, spanY: maxY - minY }
    };
  }

  /**
   * 空间几何辅助：点到铜皮 Shape 的最短距离
   */
  function pointToShapeDistance(px, py, shape) {
    const b = shape.bbox;
    const dxBox = Math.max(0, b.minX - px, px - b.maxX);
    const dyBox = Math.max(0, b.minY - py, py - b.maxY);
    const boxDist = Math.hypot(dxBox, dyBox);

    // 圆形铜皮快捷计算
    if (shape.arcs && shape.arcs.length === 1 && shape.boundary.length <= 2) {
      const arc = shape.arcs[0];
      const dCenter = dist2D(px, py, arc.cx, arc.cy);
      if (dCenter <= arc.radius) {
        return 0;
      }
      return dCenter - arc.radius;
    }

    // 细算点到所有边界段的最短距离
    let minD = Infinity;
    for (const seg of shape.boundary) {
      if (seg.type === 'line') {
        const d = pointToSegmentDist(px, py, seg.x1, seg.y1, seg.x2, seg.y2);
        if (d < minD) minD = d;
      } else if (seg.type === 'arc') {
        const dCenter = dist2D(px, py, seg.cx, seg.cy);
        const dArc = Math.abs(dCenter - seg.radius);
        if (dArc < minD) minD = dArc;
      }
    }

    if (boxDist === 0) {
      if (isPointInsideBBox(px, py, b)) {
        return 0;
      }
    }

    return minD === Infinity ? boxDist : minD;
  }

  function isPointInsideBBox(px, py, bbox) {
    return px >= bbox.minX && px <= bbox.maxX && py >= bbox.minY && py <= bbox.maxY;
  }

  function pointToSegmentDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return dist2D(px, py, x1, y1);

    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return dist2D(px, py, projX, projY);
  }

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
        let containsVia = false;
        for (const via of vias) {
          if (dist2D(via.x, via.y, shape.centroid.x, shape.centroid.y) <= 30.0) {
            containsVia = true;
            break;
          }
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

  const PourChecker = {
    MM_PER_MIL,
    MIL_PER_MM,
    dist2D,
    roundN,
    sampleArcPoints,
    expandLayerRange,
    parsePcbElements,
    parseShapeBlock,
    pointToShapeDistance,
    checkViaLayerCoverage,
    checkSpecialShapedCopper,
    checkTraceReferenceMargin,
    checkIsolatedSmallCopper,
    checkCopperArcRadius,
    groupResultsByTargetObject,
    runAllCopperChecks
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PourChecker;
  }
  if (typeof window !== 'undefined') {
    window.PourChecker = PourChecker;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.PourChecker = PourChecker;
  }

})(typeof window !== 'undefined' ? window : this);
