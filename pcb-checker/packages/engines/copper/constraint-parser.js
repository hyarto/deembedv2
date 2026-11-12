/* ============================================================================
 * constraint-parser.js —— 叠层约束 TXT（参数行 / 三列表格 / 矩阵）解析与作用域展开引擎
 * 统一供 copper.html 与 unified.html 复用，消除跨页复制粘贴
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ConstraintParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function detectKind(filename, text) {
    var f = filename || '', t = text || '';
    var fB = /BGA/i.test(f), fS = /SMA/i.test(f);
    var tB = /BGA/i.test(t), tS = /SMA/i.test(t);
    if ((fB || tB) && !(fS || tS)) return 'BGA';
    if ((fS || tS) && !(fB || tB)) return 'SMA';
    if ((fB || tB) && (fS || tS)) return '混合';
    return '其他';
  }

  function scopeOf(name) {
    if (/表层/.test(name)) return '表层';
    if (/扇出/.test(name)) return '扇出走线层';
    if (/^bottom\b/i.test(name)) return 'bottom';
    if (/^top\b/i.test(name)) return 'top';
    var below = name.match(/L\s*\d+\s*及以下[^，,反焊盘半径]*/);
    if (below) return below[0].replace(/\s+/g, '');
    var ls = name.match(/L\s*\d+(?:\s*[\/,，、|]\s*L?\s*\d+)*/i);
    if (ls) return ls[0].replace(/\s+/g, '').replace(/[\/,，、|]/g, ', ');
    return name;
  }

  function typeOf(name, cat) {
    var s = (name || '') + (cat || '');
    if (/反焊盘/.test(s)) return '反焊盘半径';
    if (/焊盘/.test(s)) return '焊盘半径';
    if (/间距|间隙|clearance/i.test(s)) return '间距';
    if (/铜皮|铜宽/.test(s)) return '铜皮尺寸';
    return cat || '尺寸';
  }

  function decodeBuffer(buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) {
      return { text: new TextDecoder('utf-16le').decode(u8).replace(/^\uFEFF/, ''), enc: 'UTF-16' };
    }
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) {
      return { text: new TextDecoder('utf-16be').decode(u8).replace(/^\uFEFF/, ''), enc: 'UTF-16' };
    }
    var utf8 = new TextDecoder('utf-8').decode(u8).replace(/^\uFEFF/, '');
    var bad = (utf8.match(/\uFFFD/g) || []).length;
    if (!bad) return { text: utf8, enc: 'UTF-8' };
    var gbk = '';
    try { gbk = new TextDecoder('gb18030').decode(u8).replace(/^\uFEFF/, ''); }
    catch (e) { return { text: utf8, enc: 'UTF-8' }; }
    var gbkBad = (gbk.match(/\uFFFD/g) || []).length;
    if (gbkBad < bad) return { text: gbk, enc: 'GB18030' };
    return { text: utf8, enc: 'UTF-8' };
  }

  function isCategoryLine(line) {
    return /^(反焊盘尺寸|焊盘尺寸|铜皮尺寸|间距|参数|尺寸)$/.test(String(line || '').trim());
  }

  function lineValue(line) {
    var m = String(line || '').match(/^(.*?)([0-9]+(?:\.[0-9]+)?)\s*(mil|mm|um|μm)\s*$/i)
      || String(line || '').match(/^(.+?)[\s:：|｜\t]+([0-9]+(?:\.[0-9]+)?)\s*(mil|mm|um|μm)?\s*$/i)
      || String(line || '').match(/(.{2,80}半径)\s*([0-9]+(?:\.[0-9]+)?)\s*(mil|mm|um|μm)?/i);
    if (!m) return null;
    var name = m[1].replace(/[|｜]/g, '').trim();
    if (name.length < 2 || /^(参数|尺寸|类别)$/.test(name)) return null;
    if (/反焊盘尺寸|焊盘尺寸/.test(name) && name.length < 8) return { catOnly: name };
    return { name: name, value: m[2], unit: (m[3] || 'mil').toLowerCase() };
  }

  function splitNameScope(raw) {
    var s = String(raw || '').replace(/\t/g, ' ').trim();
    var m = s.match(/^(L\s*\d+\s*层?\s*及以[上下])(?:背钻经过层|层)?\s*(.+)$/i);
    if (m) return { scope: m[1].replace(/\s+/g, '').replace(/层及/, '及'), name: m[2].replace(/^背钻经过层/, '').trim() };
    m = s.match(/^(扇出走线层|出线层|扇出层|表层|顶层|底层|bottom|top)\s*层?\s*(.+)$/i);
    if (m) return { scope: m[1], name: m[2].trim() };
    m = s.match(/^(L\s*\d+(?:\s*[\/,，、|]\s*L?\s*\d+)*)\s*层?\s*(.+)$/i);
    if (m) return { scope: m[1].replace(/\s+/g, '').replace(/[\/,，、|]/g, ','), name: m[2].trim() };
    if (/^(扇出走线层|出线层|扇出层)$/.test(s)) return { scope: s, name: '' };
    return { scope: '', name: s };
  }

  function pushRule(rules, item, cat, raw) {
    if (item.catOnly) return item.catOnly;
    var name = item.name;
    var sp = splitNameScope(name);
    rules.push({
      cat: cat || typeOf(name, ''),
      name: name,
      scope: sp.scope || scopeOf(name),
      type: typeOf(name, cat),
      value: item.value,
      unit: item.unit,
      raw: raw || name
    });
    return cat;
  }

  function headingInfo(line) {
    var s = String(line || '').trim();
    if (!s || isCategoryLine(s) || lineValue(s)) return null;
    if (/^尺寸类型|^具体参数|尺寸类型\s*具体参数/.test(s)) return null;
    if (/^[一二三四五六七八九十]+、/.test(s) || /^第[一二三四五六七八九十0-9]+[章节类、.]/.test(s) || /^[（(][一二三四五六七八九十]+[）)]/.test(s)) {
      return { level: 1, title: s };
    }
    if (/^\d+\s*[.、．]\s*/.test(s) && /扇出|SMA|BGA/i.test(s) && !/半径/.test(s)) {
      return { level: 2, title: s };
    }
    if (/层扇出/.test(s) && !/半径/.test(s) && s.length <= 40 && !/\d+(?:\.\d+)?\s*mil/i.test(s)) {
      return { level: 2, title: s };
    }
    return null;
  }

  function makeConstraintName(scheme, item) {
    var blob = (scheme || '') + ' ' + (item || '');
    var hasBot = /(?:^|[^A-Za-z])(?:BOT|BOTTOM)(?![A-Za-z])/i.test(blob) || /底面|底层|底侧|底部/.test(blob);
    var hasTop = /(?:^|[^A-Za-z])TOP(?![A-Za-z])/i.test(blob) || /顶面|顶层|顶侧|顶部/.test(blob) || /表层/.test(scheme || '');
    var side = '';
    if (hasBot && !hasTop) side = 'Bot';
    else if (hasTop && !hasBot) side = 'Top';

    var type = '';
    if (/BGA/i.test(blob)) type = 'BGA';
    else if (/SMA/i.test(blob)) type = 'SMA';

    var layer = '';
    var fan = (item || '').match(/L\s*(\d+)\s*层?\s*扇出/i) ||
              (item || '').match(/扇出\s*L\s*(\d+)/i) ||
              (scheme || '').match(/L\s*(\d+)\s*层?\s*扇出/i);
    if (fan) layer = 'L' + fan[1];

    var dims = [];
    var re = /([A-Za-z][A-Za-z0-9]*)\s*(?:为|=|＝|:|：)\s*([0-9]+(?:\.[0-9]+)?)\s*mil/gi;
    var m, dimSrc = scheme || '';
    while ((m = re.exec(dimSrc))) dims.push(m[1] + m[2] + 'mil');

    var parts = [side, type, layer].concat(dims).filter(Boolean);
    if (parts.length >= 2) return parts.join('-');
    return (item || scheme || '').replace(/^\d+\s*[.、．]\s*/, '').replace(/^[一二三四五六七八九十]+、/, '').trim();
  }

  function setsFromSections(sections, filename) {
    var sets = [];
    sections.forEach(function (sec) {
      var cat = '';
      var rules = [];
      sec.lines.forEach(function (line) {
        if (isCategoryLine(line)) { cat = line; return; }
        if (/^尺寸类型|^具体参数/.test(line)) return;
        var item = lineValue(line);
        if (!item) return;
        cat = pushRule(rules, item, cat, line) || cat;
      });
      if (!rules.length) return;
      var blob = (sec.scheme || '') + '\n' + (sec.item || '') + '\n' + sec.lines.join('\n');
      var named = sec.named || makeConstraintName(sec.scheme || '', sec.item || sec.title || '');
      var kind0 = detectKind(named || sec.title || filename, blob);
      var kind = /BGA/i.test(named) ? 'BGA' : (/SMA/i.test(named) ? 'SMA' : kind0);
      var title = (named || sec.title || filename || '导入文件').replace(/\.(png|jpe?g|txt|pdf|pptx?)$/i, '');
      var txtHead = [sec.scheme, sec.item].filter(Boolean).join(' / ');
      sets.push({
        kind: kind,
        title: title,
        txtHead: txtHead,
        source: filename || '导入文本',
        sourceType: 'text',
        image: '',
        rules: rules
      });
    });
    return sets;
  }

  function tableKindOf(text) {
    var s = String(text || '');
    if (/BGA/i.test(s)) return 'BGA';
    if (/SMA/i.test(s)) return 'SMA';
    return '';
  }

  function sideWordOf(s) {
    var t = String(s || '').trim();
    if (/^(top|表层|顶层|正面)$/i.test(t)) return 'Top';
    if (/^(bot|bottom|底层|背面)$/i.test(t)) return 'Bot';
    var m = t.match(/^L\s*(\d+)$/i);
    if (m) return 'L' + m[1];
    if (/^\d+$/.test(t)) return 'L' + t;
    return '';
  }

  function connRangeOf(text) {
    var m = String(text || '').match(/连接层\s*(L\s*\d+|Top|Bot|表层|顶层|底层)?\s*至\s*L?\s*(\d+)/i);
    if (m) return { start: sideWordOf(m[1] || ''), end: 'L' + m[2] };
    var only = String(text || '').match(/连接层\s*(L\s*\d+|Top|Bot)\b/i);
    if (only) return { start: sideWordOf(only[1]), end: '' };
    return { start: '', end: '' };
  }

  function antiNum(v) {
    var m = String(v == null ? '' : v).match(/-?[0-9]+(?:\.[0-9]+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  function tryLayerTable(raw, filename) {
    var src = String(raw || '').replace(/^\uFEFF/, '');
    if (!/反焊盘/.test(src)) return null;
    var lines = src.split(/\r?\n/);
    var group = '', item = '', padName = '焊盘半径', rows = [], used = {}, out = [], headerSeen = false;

    function flush() {
      if (!item || !rows.length) return;
      var it = item, grp = group;
      var kind = tableKindOf(grp + ' ' + it) || detectKind(grp || it, grp);
      var ci = connRangeOf(it), cg = connRangeOf(grp);
      var start = ci.start || cg.start;
      var titleEnd = (ci.end || cg.end || '').replace(/^L/i, '');
      var nums = rows.map(function (r) { return antiNum(r.anti); });
      var maxAnti = -Infinity, endLayer = 0;
      nums.forEach(function (v, i) {
        if (v == null) return;
        if (v > maxAnti) { maxAnti = v; endLayer = rows[i].layer; }
        else if (v === maxAnti && rows[i].layer > endLayer) endLayer = rows[i].layer;
      });
      if (titleEnd && nums.every(function (v) { return v === maxAnti; })) endLayer = +titleEnd;
      if (!endLayer) endLayer = +titleEnd || 0;
      var pitch = (it.match(/间距\s*(?:为|=|：|:)?\s*([0-9]+(?:\.[0-9]+)?)\s*mm/i) || [])[1] || '';
      var parts = [kind || '约束'];
      if (start) parts.push(start);
      if (endLayer) parts.push('L' + endLayer);
      if (pitch) parts.push(pitch + 'mm');
      var title = parts.join('-');
      if (used[title]) { used[title]++; title += '(' + used[title] + ')'; }
      else used[title] = 1;

      var rules = [];
      rows.forEach(function (r) {
        var anti = String(r.anti || '').trim();
        var pad = String(r.pad || '').trim();
        if (anti) rules.push({ cat: '反焊盘尺寸', name: '反焊盘半径', scope: 'L' + r.layer, value: anti, unit: 'mil', raw: 'L' + r.layer + ' 反焊盘 ' + anti + 'mil' });
        if (pad) rules.push({ cat: '焊盘尺寸', name: padName, scope: 'L' + r.layer, value: pad, unit: 'mil', raw: 'L' + r.layer + ' 焊盘 ' + pad });
      });
      if (!rules.length) return;
      out.push({ kind: kind, title: title, group: grp, item: it, txtHead: it, source: filename || '导入文本', sourceType: 'text', image: '', rules: rules });
    }

    lines.forEach(function (line0) {
      var line = String(line0 || '').trim();
      if (!line) return;
      var cols = line.indexOf('\t') >= 0 ? line.split('\t').map(function (s) { return s.trim(); }) : [];
      if (cols.length >= 2 && /^层$/.test(cols[0]) && /反焊盘/.test(line)) {
        padName = /直径/.test(cols[2] || '') ? '焊盘直径' : '焊盘半径';
        headerSeen = true;
        return;
      }
      if (headerSeen && cols.length >= 2 && /^L?\s*\d+$/i.test(cols[0]) && /[0-9]|无/.test(cols[1] || '')) {
        rows.push({ layer: +String(cols[0]).replace(/^L/i, ''), anti: cols[1], pad: cols[2] || '' });
        return;
      }
      if (/^[一二三四五六七八九十]+\s*[、.．]/.test(line) && line.length <= 80) { flush(); group = line; item = ''; rows = []; return; }
      if (/^\d+\s*[.、．]\s*\S/.test(line) && line.length <= 80) { flush(); item = line; rows = []; return; }
    });
    flush();
    return out.length ? out : null;
  }

  function tryMatrix(raw, filename) {
    var rows = String(raw || '').split(/\r?\n/).map(function (s) { return s.replace(/\u0000/g, '').trim(); }).filter(Boolean);
    if (rows.length < 2) return null;
    var cols = rows.map(function (r) {
      if (r.indexOf('\t') >= 0) return r.split('\t').map(function (s) { return s.trim(); });
      if (/\s{2,}/.test(r)) return r.split(/\s{2,}/).map(function (s) { return s.trim(); });
      return [r];
    });
    var width = Math.max.apply(null, cols.map(function (c) { return c.length; }));
    if (width < 3) return null;
    if (cols.filter(function (c) { return c.length >= 3; }).length < 3) return null;
    var numCount = function (c) { return c.filter(function (x) { return /\d/.test(x); }).length; };
    var header = null, data = cols;
    if (numCount(cols[0]) <= 1 && numCount(cols[1]) >= 2) { header = cols[0]; data = cols.slice(1); }
    else return null;

    var sets = [];
    for (var c = 1; c < width; c++) {
      var title = (header[c] || ('第' + c + '类')).replace(/\.(txt)$/i, '');
      sets.push({ kind: detectKind(title, title), title: title, source: filename || '导入文本', sourceType: 'text', image: '', rules: [] });
    }
    data.forEach(function (row) {
      var label = (row[0] || '').trim();
      if (!label) return;
      for (var ci = 1; ci < width; ci++) {
        var cell = row[ci] || '';
        var m = String(cell).match(/([0-9]+(?:\.[0-9]+)?)\s*(mil|mm|um|μm)?/i);
        if (!m) continue;
        sets[ci - 1].rules.push({
          cat: typeOf(label, ''),
          name: label,
          scope: scopeOf(label),
          type: typeOf(label, ''),
          value: m[1],
          unit: (m[2] || 'mil').toLowerCase()
        });
      }
    });
    if (!sets.some(function (s) { return s.rules.length; })) return null;
    return sets.filter(function (s) { return s.rules.length; });
  }

  function parseConstraintText(text, filename) {
    var raw = String(text || '').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n');
    var table = tryLayerTable(raw, filename);
    if (table) return table;
    var matrix = tryMatrix(raw, filename);
    if (matrix) return matrix;

    var lines = [];
    raw.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (line) {
      var mixed = line.match(/^(反焊盘尺寸|焊盘尺寸|铜皮尺寸|间距)\s+(.+)$/);
      if (mixed && /\d/.test(mixed[2])) { lines.push(mixed[1]); lines.push(mixed[2]); }
      else lines.push(line);
    });

    var sections = [];
    var scheme = '', cur = null;
    function start(item) {
      cur = { scheme: scheme, item: item || '', title: item || scheme || '', lines: [] };
      sections.push(cur);
    }
    lines.forEach(function (line) {
      var h = headingInfo(line);
      if (h && h.level === 1) { scheme = h.title; cur = null; return; }
      if (h && h.level === 2) { start(h.title); return; }
      if (!cur) start('');
      cur.lines.push(line);
    });
    return setsFromSections(sections, filename);
  }

  function fanLayerOf(set) {
    var title = String(set && set.title || '');
    var head = String(set && (set.txtHead || set.item) || '');
    var m = title.match(/-L(\d+)(?:-|$)/i);
    if (m) return +m[1];
    m = (head + ' ' + title).match(/L\s*(\d+)\s*层?\s*扇出/i);
    if (m) return +m[1];
    m = title.match(/\bL(\d+)\b/i);
    return m ? +m[1] : 0;
  }

  function isFanScope(scope) {
    var s = String(scope || '').replace(/\s+/g, '');
    return /^(扇出走线层|扇出层|出线层)$/.test(s);
  }

  function layersForScope(scope, n, fan) {
    var s = String(scope || '').replace(/\s+/g, '');
    if (!s) return [];
    if (/^(表层|顶层|top)$/i.test(s)) return [1];
    if (/^(底层|bottom)$/i.test(s)) return n > 0 ? [n] : [];
    if (isFanScope(s)) return fan > 0 ? [fan] : [];
    var up = s.match(/^L(\d+)及以上/i);
    if (up) {
      var a = +up[1], outUp = [];
      for (var i = 1; i <= a; i++) outUp.push(i);
      return outUp;
    }
    var below = s.match(/^L(\d+)及以下/i);
    if (below) {
      var b = +below[1], end = Math.max(n, b), outBelow = [];
      for (var j = b; j <= end; j++) outBelow.push(j);
      return outBelow;
    }
    var nums = Array.from(s.matchAll(/L(\d+)/gi)).map(function (x) { return +x[1]; });
    if (nums.length) return nums.filter(function (k) { return k >= 1; });
    var bare = s.split(/[\/,，、|]/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (bare.length > 1 && bare.every(function (x) { return /^\d+$/.test(x); })) {
      return bare.map(Number).filter(function (k) { return k >= 1; });
    }
    return [];
  }

  function scopeRank(scope) {
    var s = String(scope || '').replace(/\s+/g, '');
    if (/及以[上下]/.test(s)) return 1;
    if (/^(表层|顶层|底层|bottom|top|扇出走线层|扇出层|出线层)$/i.test(s)) return 3;
    return 2;
  }

  function applyScopes(scopes, n, fan) {
    var values = {}, sources = {}, extras = [], seen = {};
    var ordered = (scopes || []).map(function (sc, i) { return { sc: sc, i: i }; })
      .sort(function (a, b) { return scopeRank(a.sc.scope) - scopeRank(b.sc.scope) || a.i - b.i; });

    ordered.forEach(function (row) {
      var sc = row.sc;
      var layers = layersForScope(sc.scope, n, fan);
      var src = sc.raw || ((sc.scope ? sc.scope + ' ' : '') + (sc.value || '') + (sc.unit || 'mil'));
      if (!layers.length) {
        if (!sc.scope) return;
        var key = 'X:' + sc.scope;
        values[key] = sc.value;
        sources[key] = src;
        if (!seen[key]) { seen[key] = 1; extras.push({ key: key, label: sc.scope }); }
        return;
      }
      layers.forEach(function (idx) { values['L' + idx] = sc.value; sources['L' + idx] = src; });
    });
    return { values: values, sources: sources, extras: extras };
  }

  function maxLayer(scopes, n, fan) {
    var m = Math.max(n, fan || 0);
    (scopes || []).forEach(function (sc) {
      Array.from(String(sc.scope || '').matchAll(/L\s*(\d+)/gi)).forEach(function (x) {
        m = Math.max(m, +x[1]);
      });
    });
    return m;
  }

  function buildConstraints(rules) {
    var list = [], index = {};
    (rules || []).forEach(function (r) {
      var sp = splitNameScope(r.name);
      var name = (sp.name || '').replace(/^层/, '').trim();
      if (!name && isFanScope(sp.scope)) {
        var typed = typeOf('', r.cat || '');
        name = typed === '尺寸' ? (r.cat || '出线层') : typed;
      }
      if (!name) name = (r.name || '').replace(/^层/, '').trim() || '未命名约束';
      var scope = sp.scope || ((r.scope && r.scope !== r.name) ? r.scope : '');
      var key = (r.cat || '') + '\n' + name;
      if (!index[key]) {
        index[key] = { name: name, cat: r.cat || '', unit: r.unit || 'mil', scopes: [], values: {}, auto: {}, extras: [], unscoped: '' };
        list.push(index[key]);
      }
      var c = index[key];
      if (r.unit) c.unit = r.unit;
      if (scope) {
        c.scopes.push({
          scope: scope,
          value: r.value,
          unit: r.unit || c.unit,
          raw: r.raw || ((scope + ' ' + name + ' ' + r.value + (r.unit || 'mil')).trim())
        });
      } else {
        c.unscoped = r.value;
      }
    });
    return list;
  }

  function expandConstraintSets(sets, n) {
    (sets || []).forEach(function (set) {
      if (!set.constraints) set.constraints = buildConstraints(set.rules || []);
      var fan = fanLayerOf(set);
      set.fanLayer = fan;
      set.constraints.forEach(function (c) {
        var next = applyScopes(c.scopes || [], n, fan);
        var oldAuto = c.auto || null;
        var values = Object.assign({}, c.values || {});
        var maxL = maxLayer(c.scopes || [], n, fan);
        Object.keys(values).forEach(function (k) {
          var m = k.match(/^L(\d+)$/);
          if (m && +m[1] > maxL) delete values[k];
        });
        if (!oldAuto) {
          Object.keys(next.values).forEach(function (k) {
            if (values[k] == null || values[k] === '') values[k] = next.values[k];
          });
        } else {
          Object.keys(next.values).forEach(function (k) {
            if (values[k] == null || values[k] === '' || values[k] === oldAuto[k]) values[k] = next.values[k];
          });
          Object.keys(oldAuto).forEach(function (k) {
            if (next.values[k] == null && values[k] === oldAuto[k]) delete values[k];
          });
        }
        var sources = {};
        Object.keys(values).forEach(function (k) {
          if (values[k] == null || values[k] === '' || values[k] === '无') { delete values[k]; return; }
          sources[k] = (next.values[k] != null && values[k] === next.values[k]) ? (next.sources[k] || '') : '手工填写';
        });
        c.values = values;
        c.auto = next.values;
        c.sources = sources;
        c.extras = next.extras;
      });
    });
    return sets;
  }

  function chipShort(name) {
    var s = String(name || '');
    if (!s) return '未推算到';
    s = s.replace(/^Top-SMA-/i, '').replace(/^Bot-SMA-/i, '').replace(/^SMA-/i, '').replace(/^BGA[-_]/i, '');
    s = s.replace(/-?D2M\s*[0-9.]+\s*mil$/i, '').replace(/-?D2M\s*[0-9.]+$/i, '');
    s = s.trim();
    return s || String(name);
  }

  function chipD2M(name) {
    var m = String(name || '').match(/D2M\s*([0-9.]+)/i);
    return m ? parseFloat(m[1]) : 0;
  }

  function chipMeta(name) {
    var s = String(name || '');
    var kind = /BGA/i.test(s) ? 'BGA' : (/SMA/i.test(s) ? 'SMA' : '其他');
    var side = /^Bot/i.test(s) ? 'Bot' : (/^Top/i.test(s) ? 'Top' : '');
    var lm = s.match(/L(\d+)/i);
    var layer = lm ? +lm[1] : 0;
    var dm = s.match(/D2M\s*([0-9.]+)/i);
    var d2m = dm ? parseFloat(dm[1]) : 0;
    var g, rank;
    if (!s) { g = '未推算到约束'; rank = 9; }
    else if (kind === 'BGA') { g = 'BGA'; rank = 0; }
    else if (kind === 'SMA' && side === 'Top') { g = 'SMA · Top 面'; rank = 1; }
    else if (kind === 'SMA' && side === 'Bot') { g = 'SMA · bottom 面'; rank = 2; }
    else if (kind === 'SMA') { g = 'SMA · 未标面'; rank = 3; }
    else { g = '其他'; rank = 4; }
    return { name: s, kind: kind, side: side, layer: layer, d2m: d2m, group: g, rank: rank };
  }

  function orderChips(keys, map) {
    var metas = keys.map(function (k) {
      var m = chipMeta(k === '未推算到约束' ? '' : k);
      m.key = k;
      m.n = map[k].n;
      return m;
    });
    var dk = function (m) { return m.d2m > 0 ? (1e6 - m.d2m) : 1e9; };
    metas.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.group !== b.group) return a.group < b.group ? -1 : 1;
      var az = a.n > 0 ? 0 : 1, bz = b.n > 0 ? 0 : 1;
      if (az !== bz) return az - bz;
      var da = dk(a), db = dk(b);
      if (da !== db) return da - db;
      if (a.layer !== b.layer) return b.layer - a.layer;
      return String(a.name).localeCompare(String(b.name));
    });
    return metas;
  }

  return {
    detectKind: detectKind,
    scopeOf: scopeOf,
    typeOf: typeOf,
    decodeBuffer: decodeBuffer,
    splitNameScope: splitNameScope,
    makeConstraintName: makeConstraintName,
    parseConstraintText: parseConstraintText,
    fanLayerOf: fanLayerOf,
    isFanScope: isFanScope,
    layersForScope: layersForScope,
    applyScopes: applyScopes,
    maxLayer: maxLayer,
    buildConstraints: buildConstraints,
    expandConstraintSets: expandConstraintSets,
    chipShort: chipShort,
    chipD2M: chipD2M,
    chipMeta: chipMeta,
    orderChips: orderChips
  };
});
