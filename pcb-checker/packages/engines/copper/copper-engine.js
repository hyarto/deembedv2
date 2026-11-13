/* ============================================================================
 * copper-engine.js —— 铜皮 × 过孔空间配对、Padstack 关键字推算与逐层半径核对引擎
 * ========================================================================== */
(function (root) {
  'use strict';
  var FIELD_RE = {};
  function fieldRe(name) {
    if (!FIELD_RE[name]) FIELD_RE[name] = new RegExp('(?:^|\\n)\\s*' + name + '\\s*:\\s*([^\\n]+)', 'i');
    return FIELD_RE[name];
  }
  var HEAD_RE = /Item\s+(\d+)\s*<\s*(Shape|Via|Trace)\s*>/i;
  var XY_RE = /xy\s*\[\s*([+-]?[0-9.]+)\s*,\s*([+-]?[0-9.]+)\s*\]/gi;

  function parseBoardItems(text) {
    var raw = String(text || '').replace(/\u0000/g, '');
    var chunks = raw.split(/~{8,}/);
    var items = [];
    chunks.forEach(function (chunk) {
      var head = chunk.match(HEAD_RE);
      if (!head) return;
      var body = chunk;
      function field(name) {
        var m = body.match(fieldRe(name));
        return m ? m[1].trim() : '';
      }
      var item = {
        id: +head[1],
        type: head[2].toLowerCase(),
        set: field('Set'),
        subset: field('Subset'),
        net: /Not on a Net/i.test(body) ? '' : field('Net'),
        padstack: field('Padstack Name'),
        usage: field('Usage'),
        radius: null,
        center: null,
        origin: null,
        connections: '',
        traceLayers: [],
        circle: false,
        pts: null,
        head: body.slice(0, 200)
      };
      var center = body.match(/Center-xy:\s*\[\s*([+-]?[0-9.]+)\s*,\s*([+-]?[0-9.]+)\s*\]/i);
      if (center) item.center = [+center[1], +center[2]];
      var origin = body.match(/Origin-xy:\s*\[\s*([+-]?[0-9.]+)\s*,\s*([+-]?[0-9.]+)\s*\]/i);
      if (origin) item.origin = [+origin[1], +origin[2]];
      var segs = (body.match(/\n\s*Seg:/gi) || []).length;
      var arcs = (body.match(/Arc seg:/gi) || []).length;
      var rad = body.match(/Radius\s*\(\s*([0-9.]+)\s*\)/i);
      if (rad) item.radius = +rad[1];
      item.circle = item.type === 'shape' && arcs === 1 && segs === 0 && item.center && item.radius != null;
      if (item.type === 'trace') {
        var pts = [];
        XY_RE.lastIndex = 0;
        var pm;
        while ((pm = XY_RE.exec(body))) pts.push(+pm[1], +pm[2]);
        item.pts = pts;
      }
      var traceLayers = [];
      var traceRe = /Trace:\s*\d+\s*\(([^)]+)\)/gi;
      var tm;
      while ((tm = traceRe.exec(body))) {
        var parts = tm[1].trim().split(/\s+/).filter(Boolean);
        parts.forEach(function (p) { if (traceLayers.indexOf(p) < 0) traceLayers.push(p); });
      }
      item.traceLayers = traceLayers;
      var conn = body.match(/Connections:\s*([\s\S]*?)(?:\n\s*Backdrill:|\n\s*BackDrill|$)/i);
      if (conn) item.connections = conn[1].replace(/\s+/g, ' ').trim();
      items.push(item);
    });
    return items;
  }

  function subsetToLayer(subset, n) {
    var s = String(subset || '').trim();
    if (!s) return 0;
    if (/^top$/i.test(s) || s === '表层') return 1;
    if (/^bottom$/i.test(s) || s === '底层') return n || 0;
    var m = s.match(/^(\d{1,2})/);
    if (m) return +m[1];
    var l = s.match(/L\s*(\d+)/i);
    return l ? +l[1] : 0;
  }

  function isPadWord(str, from) {
    return /^pad/i.test(String(str).slice(from, from + 3));
  }

  function fanCandsOfName(raw) {
    var s = String(raw || '');
    var out = [], seen = {};
    var push = function (n) { if (!seen[n]) { seen[n] = 1; out.push(n); } };
    var re = /(^|[^A-Za-z0-9])[Ll](\d{1,2})(?![0-9])/g;
    var m;
    while ((m = re.exec(s))) {
      if (isPadWord(s, re.lastIndex)) continue;
      push(+m[2]);
    }
    if (!out.length) {
      var loose = s.match(/L(\d{1,2})(?![0-9])/gi) || [];
      loose.forEach(function (x) {
        var at = s.toUpperCase().indexOf(x.toUpperCase());
        if (isPadWord(s, at + x.length)) return;
        push(+x.replace(/\D/g, ''));
      });
    }
    return out;
  }

  function sideOfName(raw) {
    var s = String(raw || '');
    if (/(?:^|[^A-Za-z])(?:BOT|BOTTOM)(?![A-Za-z])/i.test(s) || /(?:BOT|BOTTOM)(?=L\d|SMA|BGA)/i.test(s) || /底层/.test(s)) return 'Bot';
    if (/(?:^|[^A-Za-z])TOP(?![A-Za-z])/i.test(s) || /TOP(?=L\d|SMA|BGA)/i.test(s) || /表层/.test(s)) return 'Top';
    return '';
  }

  function layersOfPadstack(raw, n) {
    var s = String(raw || '');
    var out = [], seen = {};
    var push = function (num) {
      if (num > 0 && num <= 64 && !seen[num]) { seen[num] = 1; out.push(num); }
    };
    var re = /(?:^|[^A-Za-z0-9])[Ll](\d{1,2})(?![0-9])/g;
    var m;
    while ((m = re.exec(s))) push(+m[1]);
    var subRe = /(?:^|[^A-Za-z0-9])(\d{2})[A-Za-z][A-Za-z0-9]*(?![0-9])/g;
    while ((m = subRe.exec(s))) push(+m[1]);
    if (/(?:^|[^A-Za-z])TOP(?![A-Za-z])/i.test(s) || /TOP(?=L\d|SMA|BGA)/i.test(s) || /表层/.test(s)) push(1);
    if (/(?:^|[^A-Za-z])(?:BOT|BOTTOM)(?![A-Za-z])/i.test(s) || /(?:BOT|BOTTOM)(?=L\d|SMA|BGA)/i.test(s) || /底层/.test(s)) {
      if (n) push(n);
    }
    return out.sort(function (a, b) { return a - b; });
  }

  function padKeys(name) {
    var raw = String(name || '');
    var kind = /BGA/i.test(raw) ? 'BGA' : (/SMA/i.test(raw) ? 'SMA' : '');
    var fans = fanCandsOfName(raw);
    var fan = fans.length ? fans[fans.length - 1] : 0;
    var d2m = raw.match(/D2M\s*([0-9.]+)/i);
    var ring = raw.match(/ring\s*([0-9.]+)\s*mil/i);
    var side = sideOfName(raw);
    return { kind: kind, fan: fan, fans: fans, d2m: d2m ? d2m[1] : '', ring: ring ? ring[1] : '', side: side, raw: raw };
  }

  function ruleFan(set) {
    if (set && set.fanLayer) return set.fanLayer;
    var title = String(set && set.title || '');
    var head = String(set && (set.txtHead || set.item) || '');
    var m = title.match(/-L(\d+)(?:-|$)/i);
    if (m) return +m[1];
    m = (head + ' ' + title).match(/L\s*(\d+)\s*层?\s*扇出/i);
    if (m) return +m[1];
    m = title.match(/\bL(\d+)\b/i);
    return m ? +m[1] : 0;
  }

  function scoreRule(set, keys, strict) {
    var title = set.title || '';
    var kind = set.kind || '';
    if (keys.kind && kind !== keys.kind && title.toUpperCase().indexOf(keys.kind) < 0) return -1;
    var fan = ruleFan(set);
    if (strict) {
      if (keys.fan) { if (fan !== keys.fan) return -1; }
      else if (fan) return -1;
      if (keys.side && /^(Bot|Top)-/.test(title) && title.indexOf(keys.side + '-') !== 0) return -1;
    }
    var score = 0;
    if (keys.kind) score += 10;
    if (keys.fan && fan === keys.fan) score += 20;
    if (keys.side && title.indexOf(keys.side + '-') === 0) score += 5;
    if (keys.d2m && new RegExp('D2M' + keys.d2m, 'i').test(title)) score += 8;
    if (keys.ring && new RegExp('ring' + keys.ring, 'i').test(title)) score += 4;
    return score;
  }

  function selectRule(sets, keys) {
    var fans = (keys.fans && keys.fans.length) ? keys.fans : (keys.fan ? [keys.fan] : []);
    var best = null;
    fans.forEach(function (f) {
      var kk = Object.assign({}, keys, { fan: f });
      var cands = [];
      (sets || []).forEach(function (set) {
        var score = scoreRule(set, kk, true);
        if (score >= 0) cands.push({ set: set, score: score });
      });
      cands.sort(function (a, b) { return b.score - a.score; });
      if (cands.length && (!best || cands[0].score >= best.score)) {
        best = { fan: f, set: cands[0].set, score: cands[0].score, cands: cands };
      }
    });
    if (best) {
      return {
        rule: best.set,
        fan: best.fan,
        candidates: best.cands.slice(0, 5).map(function (c) { return c.set.title; })
      };
    }
    var relaxed = [];
    (sets || []).forEach(function (set) {
      var score = scoreRule(set, keys, false);
      if (score >= 0) relaxed.push({ set: set, score: score });
    });
    relaxed.sort(function (a, b) { return b.score - a.score; });
    return { rule: null, fan: 0, candidates: relaxed.slice(0, 5).map(function (c) { return c.set.title; }) };
  }

  function checkTypeOf(shape) {
    var blob = ((shape.set || '') + ' ' + (shape.head || '')).toLowerCase();
    if (/非功能|non-?func|unused|nfp/.test(blob)) return '非功能焊盘尺寸';
    if (/keepout|anti-?pad|反焊盘|antipad/.test(blob)) return '反焊盘尺寸';
    if (/焊盘|etch|regular/.test(blob)) return '焊盘尺寸';
    return '反焊盘尺寸';
  }

  function dist(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  function ruleValue(set, checkType, layer) {
    var cons = (set && set.constraints) || [];
    var hit = cons.find(function (c) {
      var blob = (c.cat || '') + ' ' + (c.name || '');
      if (checkType === '非功能焊盘尺寸') return /非功能/.test(blob);
      if (checkType === '反焊盘尺寸') return /反焊盘/.test(blob) && !/非功能/.test(blob);
      if (checkType === '焊盘尺寸') return /焊盘/.test(blob) && !/反焊盘/.test(blob) && !/非功能/.test(blob);
      return false;
    });
    if (!hit) return { missing: '规则里没有这项' };
    var v = hit.values && hit.values['L' + layer];
    if (v == null || v === '' || v === '无') return { missing: '该层无约束', constraint: hit.name };
    var num = parseFloat(v);
    if (isNaN(num)) return { missing: '规则值不是数字', constraint: hit.name };
    return { value: num, text: String(v), unit: hit.unit || 'mil', constraint: hit.name };
  }

  var BUCKET = 5;
  function cellKey(x, y) {
    return Math.floor(x / BUCKET) + ',' + Math.floor(y / BUCKET);
  }
  function neighborBounds(x, y, tol) {
    var r = Math.max(1, Math.ceil(tol / BUCKET));
    var cx = Math.floor(x / BUCKET), cy = Math.floor(y / BUCKET);
    return { x0: cx - r, x1: cx + r, y0: cy - r, y1: cy + r };
  }

  function runCopperCheck(items, sets, opts) {
    opts = opts || {};
    var n = opts.layerCount || 18;
    var posTol = opts.posTol == null ? 0.05 : opts.posTol;
    var valTol = opts.valTol == null ? 0.01 : opts.valTol;
    var enabled = opts.enabled || { '反焊盘尺寸': true, '焊盘尺寸': true, '非功能焊盘尺寸': true, 'Padstack层名': true };
    var vias = items.filter(function (it) { return it.type === 'via' && it.origin; });
    var circles = items.filter(function (it) { return it.circle; });
    var polygons = items.filter(function (it) { return it.type === 'shape' && !it.circle; });

    var circleGrid = {}, traceGrid = {};
    circles.forEach(function (sh) {
      var k = cellKey(sh.center[0], sh.center[1]);
      (circleGrid[k] || (circleGrid[k] = [])).push(sh);
    });

    items.forEach(function (tr) {
      if (tr.type !== 'trace' || !tr.pts || !tr.pts.length) return;
      var layer = subsetToLayer(tr.subset, n);
      if (!layer) return;
      var seen = {};
      for (var i = 0; i < tr.pts.length; i += 2) {
        var k = cellKey(tr.pts[i], tr.pts[i + 1]);
        if (seen[k]) continue;
        seen[k] = 1;
        (traceGrid[k] || (traceGrid[k] = [])).push({ layer: layer, subset: tr.subset });
      }
    });

    var used = {};
    var groups = vias.map(function (via) {
      var near = [];
      var b = neighborBounds(via.origin[0], via.origin[1], posTol);
      for (var cx = b.x0; cx <= b.x1; cx++) {
        for (var cy = b.y0; cy <= b.y1; cy++) {
          var list = circleGrid[cx + ',' + cy];
          if (!list) continue;
          for (var i = 0; i < list.length; i++) {
            var sh = list[i];
            if (dist(via.origin, sh.center) <= posTol) {
              near.push(sh);
              used[sh.id] = 1;
            }
          }
        }
      }

      var traceNums = {};
      (via.traceLayers || []).forEach(function (name) {
        var ln = subsetToLayer(name, n);
        if (ln) traceNums[ln] = name;
      });
      for (var cx2 = b.x0; cx2 <= b.x1; cx2++) {
        for (var cy2 = b.y0; cy2 <= b.y1; cy2++) {
          var tlist = traceGrid[cx2 + ',' + cy2];
          if (!tlist) continue;
          for (var ti = 0; ti < tlist.length; ti++) {
            var tk = tlist[ti];
            if (!traceNums[tk.layer]) traceNums[tk.layer] = tk.subset;
          }
        }
      }

      var keys = padKeys(via.padstack);
      var sel = selectRule(sets, keys);
      if (sel.fan) keys.fan = sel.fan;
      var traceList = Object.keys(traceNums).map(function (k) { return +k; });
      var note = '';
      if (keys.fan && traceList.length) {
        note = traceList.indexOf(keys.fan) >= 0
          ? ('出线层 L' + keys.fan + ' 与走线一致')
          : ('Padstack 为 L' + keys.fan + '，走线在 ' + traceList.map(function (x) { return 'L' + x; }).join('、'));
      } else if (keys.fan) {
        note = 'Padstack 出线层 L' + keys.fan + '，此过孔没有走线记录';
      } else if (traceList.length) {
        note = 'Padstack 名字里没有出线层号，走线在 ' + traceList.map(function (x) { return 'L' + x; }).join('、');
      }

      var rows = near.map(function (sh) {
        var ctype = checkTypeOf(sh);
        var layer = subsetToLayer(sh.subset, n);
        var on = enabled[ctype] !== false;
        var status = '未检查', expect = '', constraint = '';
        if (!on) status = '未检查';
        else if (!sel.rule) status = '未选规则';
        else if (!layer) status = '层未识别';
        else {
          var rv = ruleValue(sel.rule, ctype, layer);
          constraint = rv.constraint || '';
          if (rv.missing) { status = '无约束'; expect = rv.missing; }
          else {
            expect = rv.text;
            status = Math.abs(sh.radius - rv.value) <= valTol ? '符合' : '不符合';
          }
        }
        return {
          shapeId: sh.id, subset: sh.subset, layer: layer, checkType: ctype,
          actual: sh.radius, expect: expect, status: status, constraint: constraint, enabled: on
        };
      });

      if (sel.rule && sel.rule.constraints) {
        var present = {};
        rows.forEach(function (r) {
          if (r.layer && r.checkType) present[r.layer + ':' + r.checkType] = 1;
        });
        sel.rule.constraints.forEach(function (c) {
          var blob = ((c.cat || '') + ' ' + (c.name || '')).toLowerCase();
          var ctype = '反焊盘尺寸';
          if (/非功能/.test(blob)) ctype = '非功能焊盘尺寸';
          else if (/反焊盘/.test(blob)) ctype = '反焊盘尺寸';
          else if (/焊盘/.test(blob)) ctype = '焊盘尺寸';
          if (enabled[ctype] === false) return;
          var vals = c.values || {};
          Object.keys(vals).forEach(function (k) {
            var lm = k.match(/^L(\d+)$/i);
            if (!lm) return;
            var ln = +lm[1];
            var v = vals[k];
            if (v == null || v === '' || v === '无') return;
            var num = parseFloat(v);
            if (isNaN(num)) return;
            if (!present[ln + ':' + ctype]) {
              present[ln + ':' + ctype] = 1;
              rows.push({
                shapeId: 'none', subset: '—', layer: ln, checkType: ctype,
                actual: '无铜皮', expect: String(v), status: '不符合',
                constraint: c.name || '', missing: true, enabled: true
              });
            }
          });
        });
      }

      var padOn = enabled['Padstack层名'] !== false;
      var connLayerNums = [];
      var connLayerSeen = {};
      (via.traceLayers || []).forEach(function (name) {
        var ln = subsetToLayer(name, n);
        if (ln > 0 && !connLayerSeen[ln]) { connLayerSeen[ln] = 1; connLayerNums.push(ln); }
      });
      connLayerNums.sort(function (a, b) { return a - b; });

      var padLayers = layersOfPadstack(via.padstack, n);
      var missingLayers = connLayerNums.filter(function (l) {
        if (padLayers.indexOf(l) >= 0) return false;
        if (new RegExp('\\bL0*' + l + '\\b', 'i').test(via.padstack || '')) return false;
        var subsets = (via.traceLayers || []).filter(function (sub) { return subsetToLayer(sub, n) === l; });
        if (subsets.some(function (sub) { return (via.padstack || '').indexOf(sub) >= 0; })) return false;
        return true;
      });

      var padStatus = '未检查', padActual = '', padExpect = '', padReason = '';
      if (!padOn) {
        padStatus = '未检查';
        padActual = padLayers.length ? padLayers.map(function (l) { return 'L' + l; }).join('、') : (via.padstack || '无层号');
        padExpect = connLayerNums.length ? connLayerNums.map(function (l) { return 'L' + l; }).join('、') : '无连接层';
        padReason = '未启用检查';
      } else if (!connLayerNums.length) {
        padStatus = '符合';
        padActual = padLayers.length ? padLayers.map(function (l) { return 'L' + l; }).join('、') : (via.padstack || '—');
        padExpect = '无连接层';
        padReason = '无连接记录';
      } else if (missingLayers.length === 0) {
        padStatus = '符合';
        padActual = padLayers.map(function (l) { return 'L' + l; }).join('、');
        padExpect = connLayerNums.map(function (l) { return 'L' + l; }).join('、');
        padReason = '吻合';
      } else {
        padStatus = '不符合';
        padActual = padLayers.length ? padLayers.map(function (l) { return 'L' + l; }).join('、') : '无层号';
        padExpect = connLayerNums.map(function (l) { return 'L' + l; }).join('、');
        padReason = '缺少连接层 ' + missingLayers.map(function (l) { return 'L' + l; }).join('、');
      }

      rows.unshift({
        shapeId: 'via',
        subset: (via.traceLayers && via.traceLayers.length) ? via.traceLayers.join(' ') : (via.connections || '—'),
        layer: connLayerNums.length ? (connLayerNums.length === 1 ? connLayerNums[0] : connLayerNums.map(function (l) { return 'L' + l; }).join('、')) : '—',
        checkType: 'Padstack层名',
        actual: padActual,
        expect: padExpect,
        status: padStatus,
        constraint: 'Connections连接层',
        reason: padReason,
        missingLayers: missingLayers,
        padLayers: padLayers,
        connLayers: connLayerNums,
        enabled: padOn,
        isPadstackCheck: true
      });

      rows.sort(function (a, b) {
        if (a.isPadstackCheck) return -1;
        if (b.isPadstackCheck) return 1;
        var la = typeof a.layer === 'number' ? a.layer : 999;
        var lb = typeof b.layer === 'number' ? b.layer : 999;
        return la - lb || (a.checkType || '').localeCompare(b.checkType || '') || (String(a.shapeId)).localeCompare(String(b.shapeId));
      });

      var failRows = [];
      for (var fi = 0; fi < rows.length; fi++) if (rows[fi].status === '不符合') failRows.push(rows[fi]);
      return {
        via: via, keys: keys, rule: sel.rule, candidates: sel.candidates, note: note,
        traceLayers: traceList, rows: rows, failRows: failRows, failCount: failRows.length
      };
    });

    var viaGrid = {};
    vias.forEach(function (v) {
      var k = cellKey(v.origin[0], v.origin[1]);
      (viaGrid[k] || (viaGrid[k] = [])).push(v);
    });

    var NEAR_CAP = 40;
    function nearestVia(sh) {
      var cx = Math.floor(sh.center[0] / BUCKET), cy = Math.floor(sh.center[1] / BUCKET);
      var best = null;
      for (var r = 1; r <= NEAR_CAP; r++) {
        for (var i = cx - r; i <= cx + r; i++) {
          for (var j = cy - r; j <= cy + r; j++) {
            if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) < r - 1) continue;
            var list = viaGrid[i + ',' + j];
            if (!list) continue;
            for (var q = 0; q < list.length; q++) {
              var d = dist(sh.center, list[q].origin);
              if (!best || d < best.dist) best = { viaId: list[q].id, dist: d, padstack: list[q].padstack || '' };
            }
          }
        }
        if (best && best.dist <= r * BUCKET) break;
      }
      return best;
    }

    var unmatchedCircles = circles.filter(function (sh) { return !used[sh.id]; });
    unmatchedCircles.slice(0, 60).forEach(function (sh) { sh.nearest = nearestVia(sh); });
    var nearestViaOf = function (sh) {
      if (sh.nearest === undefined || sh.nearest === null) sh.nearest = nearestVia(sh);
      return sh.nearest;
    };

    var hi = 0;
    items.forEach(function (it) {
      hi = Math.max(hi, subsetToLayer(it.subset, n));
      (it.traceLayers || []).forEach(function (name) { hi = Math.max(hi, subsetToLayer(name, n)); });
    });

    return {
      groups: groups,
      unmatchedCircles: unmatchedCircles,
      nearestViaOf: nearestViaOf,
      polygons: polygons,
      viaCount: vias.length,
      circleCount: circles.length,
      maxLayer: hi
    };
  }

  var api = {
    parseBoardItems: parseBoardItems,
    fanCandsOfName: fanCandsOfName,
    layersOfPadstack: layersOfPadstack,
    nearestViaOf: function (res, sh) { return res && res.nearestViaOf ? res.nearestViaOf(sh) : null; },
    subsetToLayer: subsetToLayer,
    padKeys: padKeys,
    selectRule: selectRule,
    checkTypeOf: checkTypeOf,
    runCopperCheck: runCopperCheck
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CopperCheck = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
