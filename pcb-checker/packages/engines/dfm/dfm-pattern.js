/* ============================================================================
 * dfm-pattern.js —— DFM 全板间距问题按信号孔/走线维度归纳纯函数与 CSV 构建
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DfmCheck = Object.assign(root.DfmCheck || {}, api);
  if (typeof window !== "undefined") {
    window.buildDfmPatternAnalysis = api.buildDfmPatternAnalysis;
    window.buildPatternCsv = api.buildPatternCsv;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
function patDeficitOf(p) {
  const d = Number(p.threshold) - Number(p.evalDist);
  return isFinite(d) && d > 0 ? d : 0;
}

function buildDfmPatternAnalysis(result, opts) {
  const o = Object.assign({ object: 'via', viaKind: 'all', dimension: 'layer', sortBy: 'failCount', topN: 10 }, opts || {});
  const empty = {
    object: o.object, dimension: o.dimension, hasData: false,
    objects: [], dimensionRows: [], deficitBuckets: [],
    kpis: { objectCount: 0, defectCount: 0, pairCount: 0, minDist: null, maxDeficit: 0, concentration: 0 },
    summary: { headline: '尚无缺陷数据：请先在①规则与数据导入页载入数据并运行检查。', bullets: [] }
  };
  if (!result || !Array.isArray(result.defectPairs) || result.defectPairs.length === 0) return empty;

  // 1. 选对象范围
  let pairs = result.defectPairs.filter(p => p && p.via && p.trace);
  if (o.object === 'via') {
    if (o.viaKind === 'signal') pairs = pairs.filter(p => !p.via.isGnd);
    else if (o.viaKind === 'gnd') pairs = pairs.filter(p => p.via.isGnd);
  }
  if (pairs.length === 0) {
    const e2 = Object.assign({}, empty, { kpis: Object.assign({}, empty.kpis) });
    e2.summary = {
      headline: o.object === 'via' && o.viaKind === 'signal'
        ? '当前筛选下没有信号孔相关的间距缺陷。'
        : (o.object === 'via' && o.viaKind === 'gnd' ? '当前筛选下没有 GND 孔相关的间距缺陷。' : '没有可用于归纳的缺陷对偶。'),
      bullets: []
    };
    return e2;
  }

  // 2. 按对象聚合
  const objMap = new Map();
  pairs.forEach(p => {
    const isVia = o.object === 'via';
    const key = isVia ? ('V' + (p.via.id != null ? p.via.id : p.via.padstack)) : ('T' + (p.trace.id != null ? p.trace.id : p.trace.subset + '_' + p.trace.net));
    let it = objMap.get(key);
    if (!it) {
      it = {
        key,
        id: isVia ? p.via.id : p.trace.id,
        net: isVia ? (p.via.net || '') : (p.trace.net || ''),
        isGnd: isVia ? !!p.via.isGnd : false,
        padstack: isVia ? (p.via.padstack || '') : '',
        spanType: isVia ? (p.via.viaTypeLabel || '通孔') : '',
        layer: isVia ? '' : (p.trace.subset || ''),
        width: isVia ? null : (Number.isFinite(Number(p.trace.width)) ? Number(p.trace.width) : null),
        origin: isVia && p.via.origin ? p.via.origin : null,
        failCount: 0,
        minDist: Infinity,
        maxDeficit: 0,
        layers: new Map(),
        nets: new Map(),
        peers: new Map(),
        pairs: []
      };
      objMap.set(key, it);
    }
    it.failCount++;
    const dist = Number(p.evalDist); if (isFinite(dist) && dist < it.minDist) it.minDist = dist;
    const def = patDeficitOf(p); if (def > it.maxDeficit) it.maxDeficit = def;
    const layerKey = (isVia ? (p.trace.subset || '未知层') : (p.via.viaTypeLabel || '通孔'));
    it.layers.set(layerKey, (it.layers.get(layerKey) || 0) + 1);
    it.nets.set(p.trace.net || '未知网络', (it.nets.get(p.trace.net || '未知网络') || 0) + 1);
    // peers = 与本对象发生间距问题的「对端」：按信号孔时是走线，按走线时是过孔
    const peer = isVia ? ('Trace #' + p.trace.id) : ('Via #' + p.via.id);
    it.peers.set(peer, (it.peers.get(peer) || 0) + 1);
    it.pairs.push(p);
  });

  let objects = [...objMap.values()].map(it => Object.assign(it, {
    minDist: isFinite(it.minDist) ? it.minDist : null,
    topLayer: [...it.layers.entries()].sort((a, b) => b[1] - a[1])[0] || null,
    peersCount: it.peers.size,
    peerList: [...it.peers.keys()]
  }));

  // 3. 排序 + Top N
  const sorters = {
    failCount: (a, b) => b.failCount - a.failCount || (b.maxDeficit - a.maxDeficit),
    maxDeficit: (a, b) => b.maxDeficit - a.maxDeficit || (b.failCount - a.failCount),
    minDist: (a, b) => (a.minDist == null ? Infinity : a.minDist) - (b.minDist == null ? Infinity : b.minDist)
  };
  objects.sort(sorters[o.sortBy] || sorters.failCount);
  const objectCount = objects.length;
  const shown = o.topN > 0 ? objects.slice(0, o.topN) : objects.slice();

  // 4. 维度分布（用于条形图与集中度）
  const dimKeyOf = (it) => {
    if (o.dimension === 'net') return it.net || '未知网络';
    if (o.dimension === 'kind') return o.object === 'via' ? (it.spanType || '通孔') : '走线';
    if (o.dimension === 'padstack') return o.object === 'via' ? (it.padstack || '未知 Padstack') : (it.net || '未知网络');
    if (o.dimension === 'width') return o.object === 'via'
      ? (it.padstack || '未知 Padstack')
      : (it.width == null ? '未知线宽' : it.width.toFixed(2) + ' mil');
    return o.object === 'via' ? ((it.topLayer && it.topLayer[0]) || '未知层') : (it.layer || '未知层');
  };
  const dimMap = new Map();
  objects.forEach(it => {
    const k = dimKeyOf(it);
    dimMap.set(k, (dimMap.get(k) || 0) + it.failCount);
  });
  const dimTotal = [...dimMap.values()].reduce((a, b) => a + b, 0) || 1;
  const dimensionRows = [...dimMap.entries()]
    .map(([key, count]) => ({ key, count, pct: count / dimTotal }))
    .sort((a, b) => b.count - a.count);
  const concentration = dimensionRows.slice(0, 3).reduce((a, r) => a + r.count, 0) / dimTotal;

  // 5. 亏欠量分档（问题严重程度分布）
  const bucketing = [
    { label: '轻微 0–0.5 mil', min: 0, max: 0.5, count: 0 },
    { label: '明显 0.5–1 mil', min: 0.5, max: 1, count: 0 },
    { label: '严重 1–2 mil', min: 1, max: 2, count: 0 },
    { label: '致命 > 2 mil', min: 2, max: Infinity, count: 0 }
  ];
  pairs.forEach(p => {
    const d = patDeficitOf(p);
    const b = bucketing.find(x => d >= x.min && d < x.max) || bucketing[bucketing.length - 1];
    b.count++;
  });
  const deficitBuckets = bucketing.map(b => Object.assign(b, { pct: b.count / pairs.length }));

  // 6. KPI
  let minDist = Infinity, maxDeficit = 0;
  pairs.forEach(p => {
    const d = Number(p.evalDist); if (isFinite(d) && d < minDist) minDist = d;
    const def = patDeficitOf(p); if (def > maxDeficit) maxDeficit = def;
  });
  const kpis = {
    objectCount,
    defectCount: pairs.length,
    pairCount: pairs.length,
    minDist: isFinite(minDist) ? minDist : null,
    maxDeficit,
    concentration
  };

  // 7. 结论文字
  const objName = o.object === 'via' ? (o.viaKind === 'signal' ? '信号孔' : (o.viaKind === 'gnd' ? 'GND 孔' : '过孔（信号孔 + GND 孔）')) : '走线';
  const topObj = objects[0];
  const topDim = dimensionRows[0];
  const fatal = deficitBuckets[deficitBuckets.length - 1];
  const bullets = [];
  if (topObj) {
    const where = o.object === 'via'
      ? (topObj.isGnd ? 'GND 孔' : '信号孔') + (topObj.padstack ? `（${topObj.padstack}）` : '')
      : `走线（${topObj.layer || '未知层'} / ${topObj.net || '未知网络'}${topObj.width != null ? ' / ' + topObj.width.toFixed(2) + ' mil' : ''}）`;
    bullets.push(`问题最集中的对象是 <b>${escHtml(o.object === 'via' ? 'Via #' + topObj.id : 'Trace #' + topObj.id)}</b> ${escHtml(where)}，一条对象上就有 <b>${topObj.failCount}</b> 处间距不足${topObj.minDist != null ? `，最小实测 ${topObj.minDist.toFixed(3)} mil` : ''}${topObj.maxDeficit > 0 ? `，最大亏欠 <span class="risk">${topObj.maxDeficit.toFixed(3)} mil</span>` : ''}。`);
  }
  if (topDim) {
    bullets.push(`按「${escHtml(patDimLabel(o.dimension))}」归纳，问题最集中在 <b>${escHtml(topDim.key)}</b>（${topDim.count} 处，占 ${(topDim.pct * 100).toFixed(1)}%），前 3 名合计占 <b>${(concentration * 100).toFixed(1)}%</b>。`);
  }
  if (fatal.count > 0) {
    bullets.push(`有 <b>${fatal.count}</b> 处亏欠量超过 2 mil（占 ${(fatal.pct * 100).toFixed(1)}%），属于优先返工对象。`);
  } else if (deficitBuckets[2].count + deficitBuckets[3].count > 0) {
    bullets.push(`亏欠量集中在 1 mil 以上，共 ${deficitBuckets[2].count + deficitBuckets[3].count} 处，建议按对象集中返工。`);
  }
  if (o.object === 'via' && o.viaKind === 'all' && result.defectPairs.length === pairs.length) {
    const gndCnt = pairs.filter(p => p.via.isGnd).length;
    bullets.push(`缺陷构成：GND 孔相关的 ${gndCnt} 处（占 ${(gndCnt / pairs.length * 100).toFixed(1)}%），信号孔相关的 ${pairs.length - gndCnt} 处。`);
  }
  const headline = `本次共 <b>${pairs.length}</b> 处间距不足，分布在 <b>${objectCount}</b> 个${objName}对象上${objectCount > 0 ? `，平均每个对象 ${(pairs.length / objectCount).toFixed(2)} 处` : ''}。`;

  return {
    object: o.object, dimension: o.dimension, hasData: true,
    objects: shown, allObjects: objects, objectCount,
    dimensionRows, deficitBuckets,
    kpis,
    summary: { headline, bullets },
    viaKind: o.viaKind
  };
}

function patDimLabel(dim) {
  return ({ layer: '出线层', net: '网络', kind: '孔型', padstack: 'Padstack', width: '走线线宽' })[dim] || dim;
}

function buildPatternCsv(analysis) {
  if (!analysis || !analysis.hasData) return '';
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [];
  const objLabel = analysis.object === 'via' ? '信号孔' : '走线';
  lines.push([esc('规律分析 / 对象维度'), esc(objLabel), esc('缺陷处数'), esc('占比'), esc('最小间距(mil)'), esc('最大亏欠(mil)'), esc('对象信息')].join(','));
  const total = analysis.kpis.defectCount || 1;
  analysis.allObjects.forEach(it => {
    const info = analysis.object === 'via'
	  ? `Via #${it.id} ${it.net} ${it.padstack} ${it.spanType}`
	  : `Trace #${it.id} ${it.layer} ${it.net} ${it.width == null ? '' : it.width + ' mil'}`;
    lines.push([esc(analysis.object === 'via' ? 'Via#' + it.id : 'Trace#' + it.id), esc(objLabel), it.failCount, (it.failCount / total * 100).toFixed(1) + '%',
	  it.minDist == null ? '' : it.minDist.toFixed(3), it.maxDeficit ? it.maxDeficit.toFixed(3) : '0', esc(info)].join(','));
  });
  lines.push('');
  lines.push([esc('维度分布'), esc(patDimLabel(analysis.dimension)), esc('缺陷处数'), esc('占比')].join(','));
  analysis.dimensionRows.forEach(r => lines.push([esc('分布'), esc(r.key), r.count, (r.pct * 100).toFixed(1) + '%'].join(',')));
  lines.push('');
  lines.push([esc('亏欠量分档'), esc('区间'), esc('处数'), esc('占比')].join(','));
  analysis.deficitBuckets.forEach(b => lines.push([esc('分档'), esc(b.label), b.count, (b.pct * 100).toFixed(1) + '%'].join(',')));
  return lines.join('\r\n');
}
  return {
    patDeficitOf: patDeficitOf,
    buildDfmPatternAnalysis: buildDfmPatternAnalysis,
    patDimLabel: patDimLabel,
    buildPatternCsv: buildPatternCsv
  };
});
