/* ============================================================================
 * unified-constraint-parse.js —— 约束文本解析与逐层约束构建（移植自约束检查页）
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
// =========================================================================
// 约束解析与构建辅助函数 (Ported from copper.html)
// =========================================================================
function chipMeta(name){
  const s = String(name || '');
  const kind = /BGA/i.test(s) ? 'BGA' : (/SMA/i.test(s) ? 'SMA' : '其他');
  const side = /(?:^|[^A-Za-z])(?:Bot|Bottom)(?![A-Za-z])/i.test(s) ? 'Bot' : (/(?:^|[^A-Za-z])Top(?![A-Za-z])/i.test(s) ? 'Top' : '');
  const lm = s.match(/L(\d+)/i);
  const layer = lm ? +lm[1] : 0;
  const dm = s.match(/D2M\s*([0-9.]+)/i);
  const d2m = dm ? parseFloat(dm[1]) : 0;
  let g, rank;
  if (!s) { g = '未推算到约束'; rank = 9; }
  else if (kind === 'BGA') { g = 'BGA'; rank = 0; }
  else if (kind === 'SMA' && side === 'Top') { g = 'SMA · Top 面'; rank = 1; }
  else if (kind === 'SMA' && side === 'Bot') { g = 'SMA · bottom 面'; rank = 2; }
  else if (kind === 'SMA') { g = 'SMA · 未标面'; rank = 3; }
  else { g = '其他'; rank = 4; }
  return { name: s, kind: kind, side: side, layer: layer, d2m: d2m, group: g, rank: rank };
}

function orderChips(keys, map){
  const metas = keys.map(function(k){
    const m = chipMeta(k === '未推算到约束' ? '' : k);
    m.key = k; m.n = map[k].n;
    return m;
  });
  const dk = function(m){ return m.d2m > 0 ? (1e6 - m.d2m) : 1e9; };
  metas.sort(function(a,b){
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.group !== b.group) return a.group < b.group ? -1 : 1;
    const az = a.n > 0 ? 0 : 1, bz = b.n > 0 ? 0 : 1;
    if (az !== bz) return az - bz;
    const da = dk(a), db = dk(b);
    if (da !== db) return da - db;
    if (a.layer !== b.layer) return b.layer - a.layer;
    return String(a.name).localeCompare(String(b.name));
  });
  return metas;
}

function detectKind(filename, text){
  const f = filename || '', t = text || '';
  const fB = /BGA/i.test(f), fS = /SMA/i.test(f);
  const tB = /BGA/i.test(t), tS = /SMA/i.test(t);
  if ((fB || tB) && !(fS || tS)) return 'BGA';
  if ((fS || tS) && !(fB || tB)) return 'SMA';
  if ((fB || tB) && (fS || tS)) return '混合';
  return '其他';
}

function scopeOf(name){
  if (/表层/.test(name)) return '表层';
  if (/扇出/.test(name)) return '扇出走线层';
  if (/^bottom\b/i.test(name)) return 'bottom';
  if (/^top\b/i.test(name)) return 'top';
  const below = name.match(/L\s*\d+\s*及以下[^，,反焊盘半径]*/);
  if (below) return below[0].replace(/\s+/g,'');
  const ls = name.match(/L\s*\d+(?:\s*[\/,，、|]\s*L?\s*\d+)*/i);
  if (ls) return ls[0].replace(/\s+/g,'').replace(/[\/,，、|]/g,', ');
  return name;
}

function typeOf(name, cat){
  const s = (name || '') + (cat || '');
  if (/反焊盘/.test(s)) return '反焊盘半径';
  if (/焊盘/.test(s)) return '焊盘半径';
  if (/间距|间隙|clearance/i.test(s)) return '间距';
  if (/铜皮|铜宽/.test(s)) return '铜皮尺寸';
  return cat || '尺寸';
}

function isCategoryLine(line){
  return /^(反焊盘尺寸|焊盘尺寸|铜皮尺寸|间距|参数|尺寸)$/.test(String(line||'').trim());
}

function lineValue(line){
  const m = String(line||'').match(/^(.*?)([0-9]+(?:\.[0-9]+)?)\s*(mil|mm|um|μm)\s*$/i)
    || String(line||'').match(/^(.+?)[\s:：|｜\t]+([0-9]+(?:\.[0-9]+)?)\s*(mil|mm|um|μm)?\s*$/i)
    || String(line||'').match(/(.{2,80}半径)\s*([0-9]+(?:\.[0-9]+)?)\s*(mil|mm|um|μm)?/i);
  if (!m) return null;
  let name = m[1].replace(/[|｜]/g,'').trim();
  if (name.length < 2 || /^(参数|尺寸|类别)$/.test(name)) return null;
  if (/反焊盘尺寸|焊盘尺寸/.test(name) && name.length < 8) return { catOnly: name };
  return { name: name, value: m[2], unit: (m[3]||'mil').toLowerCase() };
}

function pushRule(rules, item, cat, raw){
  if (item.catOnly) return item.catOnly;
  const name = item.name;
  const sp = splitNameScope(name);
  rules.push({ cat: cat || typeOf(name,''), name: name, scope: sp.scope || scopeOf(name), type: typeOf(name,cat), value: item.value, unit: item.unit, raw: raw || name });
  return cat;
}

function headingInfo(line){
  const s = String(line || '').trim();
  if (!s || isCategoryLine(s) || lineValue(s)) return null;
  if (/^尺寸类型|^具体参数|尺寸类型\s*具体参数/.test(s)) return null;
  if (/^[一二三四五六七八九十]+、/.test(s) || /^第[一二三四五六七八九十0-9]+[章节类、.]/.test(s) || /^[（(][一二三四五六七八九十]+[）)]/.test(s)) return { level: 1, title: s };
  if (/^\d+\s*[.、．]\s*/.test(s) && /扇出|SMA|BGA/i.test(s) && !/半径/.test(s)) return { level: 2, title: s };
  if (/层扇出/.test(s) && !/半径/.test(s) && s.length <= 40 && !/\d+(?:\.\d+)?\s*mil/i.test(s)) return { level: 2, title: s };
  return null;
}

function makeConstraintName(scheme, item){
  const blob = (scheme || '') + ' ' + (item || '');
  const hasBot = /(?:^|[^A-Za-z])(?:BOT|BOTTOM)(?![A-Za-z])/i.test(blob) || /底面|底层|底侧|底部/.test(blob);
  const hasTop = /(?:^|[^A-Za-z])TOP(?![A-Za-z])/i.test(blob) || /顶面|顶层|顶侧|顶部/.test(blob) || /表层/.test(scheme||'');
  let side = '';
  if (hasBot && !hasTop) side = 'Bot';
  else if (hasTop && !hasBot) side = 'Top';
  else if (hasTop && hasBot) side = '';
  let type = '';
  if (/BGA/i.test(blob)) type = 'BGA';
  else if (/SMA/i.test(blob)) type = 'SMA';
  let layer = '';
  const fan = (item || '').match(/L\s*(\d+)\s*层?\s*扇出/i) || (item || '').match(/扇出\s*L\s*(\d+)/i) || (scheme || '').match(/L\s*(\d+)\s*层?\s*扇出/i);
  if (fan) layer = 'L' + fan[1];
  const dims = [];
  const re = /([A-Za-z][A-Za-z0-9]*)\s*(?:为|=|＝|:|：)\s*([0-9]+(?:\.[0-9]+)?)\s*mil/gi;
  let m; const dimSrc = scheme || '';
  while ((m = re.exec(dimSrc))) dims.push(m[1] + m[2] + 'mil');
  const parts = [side, type, layer].concat(dims).filter(Boolean);
  if (parts.length >= 2) return parts.join('-');
  const fallback = (item || scheme || '').replace(/^\d+\s*[.、．]\s*/,'').replace(/^[一二三四五六七八九十]+、/,'').trim();
  return fallback;
}

function setsFromSections(sections, filename){
  const sets = [];
  sections.forEach(sec => {
    let cat = '';
    const rules = [];
    sec.lines.forEach(line => {
      if (isCategoryLine(line)) { cat = line; return; }
      if (/^尺寸类型|^具体参数/.test(line)) return;
      const item = lineValue(line);
      if (!item) return;
      cat = pushRule(rules, item, cat, line) || cat;
    });
    if (!rules.length) return;
    const blob = (sec.scheme || '') + '\n' + (sec.item || '') + '\n' + sec.lines.join('\n');
    const named = sec.named || makeConstraintName(sec.scheme || '', sec.item || sec.title || '');
    const kind0 = detectKind(named || sec.title || filename, blob);
    let kind = /BGA/i.test(named) ? 'BGA' : (/SMA/i.test(named) ? 'SMA' : kind0);
    const title = (named || sec.title || filename || '导入文件').replace(/\.(png|jpe?g|txt|pdf|pptx?)$/i,'');
    const txtHead = [sec.scheme, sec.item].filter(Boolean).join(' / ');
    sets.push({ kind: kind, title: title, txtHead: txtHead, source: filename || '导入文本', sourceType: 'text', image: '', rules: rules });
  });
  return sets;
}

function tryMatrix(raw, filename){
  const rows = String(raw || '').split(/\r?\n/).map(s => s.replace(/\u0000/g,'').trim()).filter(Boolean);
  if (rows.length < 2) return null;
  const cols = rows.map(r => r.indexOf('\t') >= 0 ? r.split('\t').map(s => s.trim()) : (/\s{2,}/.test(r) ? r.split(/\s{2,}/).map(s => s.trim()) : [r]));
  const width = Math.max.apply(null, cols.map(c => c.length));
  if (width < 3) return null;
  if (cols.filter(c => c.length >= 3).length < 3) return null;
  const numCount = c => c.filter(x => /\d/.test(x)).length;
  let header = null, data = cols;
  if (numCount(cols[0]) <= 1 && numCount(cols[1]) >= 2) { header = cols[0]; data = cols.slice(1); }
  else return null;
  const sets = [];
  for (let c = 1; c < width; c++) {
    const title = (header[c] || ('第' + c + '类')).replace(/\.(txt)$/i,'');
    sets.push({ kind: detectKind(title, title), title: title, source: filename || '导入文本', sourceType: 'text', image: '', rules: [] });
  }
  data.forEach(row => {
    const label = (row[0] || '').trim();
    if (!label) return;
    for (let c = 1; c < width; c++) {
      const cell = row[c] || '';
      const m = String(cell).match(/([0-9]+(?:\.[0-9]+)?)\s*(mil|mm|um|μm)?/i);
      if (!m) continue;
      const name = label;
      sets[c-1].rules.push({ cat: typeOf(name,''), name: name, scope: scopeOf(name), type: typeOf(name,''), value: m[1], unit: (m[2]||'mil').toLowerCase() });
    }
  });
  if (!sets.some(s => s.rules.length)) return null;
  return sets.filter(s => s.rules.length);
}

/* ---------- 表格型约束 ----------
   一、SMA封装方案
   1. 信号孔连接层Top至L2
   层 <TAB> 反焊盘尺寸 / 反焊盘半径 (mil) <TAB> 焊盘尺寸 / 焊盘半径 (mil)
   L1 <TAB> 13 <TAB> 6.5
   一类下面有好几种，每一种（一张表）就是一条约束，名字按「SMA-Top-L2」「BGA-L2-L4-0.5mm」生成。
*/
function tableKindOf(text){
  const s=String(text||'');
  if(/BGA/i.test(s))return 'BGA';
  if(/SMA/i.test(s))return 'SMA';
  return '';
}
function sideWordOf(s){
  const t=String(s||'').trim();
  if(/^(top|表层|顶层|正面)$/i.test(t))return 'Top';
  if(/^(bot|bottom|底层|背面)$/i.test(t))return 'Bot';
  const m=t.match(/^L\s*(\d+)$/i);
  if(m)return 'L'+m[1];
  if(/^\d+$/.test(t))return 'L'+t;
  return '';
}
function connRangeOf(text){
  const m=String(text||'').match(/连接层\s*(L\s*\d+|Top|Bot|表层|顶层|底层)?\s*至\s*L?\s*(\d+)/i);
  if(m)return {start:sideWordOf(m[1]||''), end:'L'+m[2]};
  const only=String(text||'').match(/连接层\s*(L\s*\d+|Top|Bot)\b/i);
  if(only)return {start:sideWordOf(only[1]), end:''};
  return {start:'', end:''};
}
function antiNum(v){
  const m=String(v==null?'':v).match(/-?[0-9]+(?:\.[0-9]+)?/);
  return m?parseFloat(m[0]):null;
}
function tryLayerTable(raw, filename){
  const src=String(raw||'').replace(/^\uFEFF/,'');
  if(!/反焊盘/.test(src))return null;                 // 没有反焊盘列，交给别的解析器
  const lines=src.split(/\r?\n/);
  let group='', item='', padName='焊盘半径', rows=[], used={}, out=[], headerSeen=false;
  function flush(){
    if(!item||!rows.length)return;
    const it=item, grp=group;
    const kind=tableKindOf(grp+' '+it)||detectKind(grp||it, grp);
    const ci=connRangeOf(it), cg=connRangeOf(grp);
    const start=ci.start||cg.start;
    const titleEnd=(ci.end||cg.end||'').replace(/^L/i,'');
    // 连接层＝反焊盘的数值都相同的那一层里层号最大的（标题写错时以表格数据为准）
    const nums=rows.map(r=>antiNum(r.anti));
    let maxAnti=-Infinity, endLayer=0;
    nums.forEach((v,i)=>{if(v==null)return; if(v>maxAnti){maxAnti=v;endLayer=rows[i].layer;} else if(v===maxAnti&&rows[i].layer>endLayer)endLayer=rows[i].layer;});
    if(titleEnd && nums.every(v=>v===maxAnti))endLayer=+titleEnd;
    if(!endLayer)endLayer=+titleEnd||0;
    const pitch=(it.match(/间距\s*(?:为|=|：|:)?\s*([0-9]+(?:\.[0-9]+)?)\s*mm/i)||[])[1]||'';
    const parts=[kind||'约束'];
    if(start)parts.push(start);
    if(endLayer)parts.push('L'+endLayer);
    if(pitch)parts.push(pitch+'mm');
    let title=parts.join('-');
    if(used[title]){ used[title]++; title+='('+used[title]+')'; } else used[title]=1;
    const rules=[];
    rows.forEach(function(r){
      const anti=String(r.anti||'').trim();
      const pad=String(r.pad||'').trim();
      if(anti)rules.push({cat:'反焊盘尺寸', name:'反焊盘半径', scope:'L'+r.layer, value:anti, unit:'mil', raw:'L'+r.layer+' 反焊盘 '+anti+'mil'});
      if(pad)rules.push({cat:'焊盘尺寸', name:padName, scope:'L'+r.layer, value:pad, unit:'mil', raw:'L'+r.layer+' 焊盘 '+pad});
    });
    if(!rules.length)return;
    out.push({kind:kind, title:title, group:grp, item:it, txtHead:it, source:filename||'导入文本', sourceType:'text', image:'', rules:rules});
  }
  lines.forEach(function(line0){
    const line=String(line0||'').trim();
    if(!line)return;
    const cols=line.indexOf('\t')>=0?line.split('\t').map(s=>s.trim()):[];
    if(cols.length>=2 && /^层$/.test(cols[0]) && /反焊盘/.test(line)){
      padName=/直径/.test(cols[2]||'')?'焊盘直径':'焊盘半径';
      headerSeen=true;
      return;
    }
    if(headerSeen && cols.length>=2 && /^L?\s*\d+$/i.test(cols[0]) && /[0-9]|无/.test(cols[1]||'')){
      rows.push({layer:+String(cols[0]).replace(/^L/i,''), anti:cols[1], pad:cols[2]||''});
      return;
    }
    if(/^[一二三四五六七八九十]+\s*[、.．]/.test(line) && line.length<=80){flush(); group=line; item=''; rows=[]; return;}
    if(/^\d+\s*[.、．]\s*\S/.test(line) && line.length<=80){flush(); item=line; rows=[]; return;}
  });
  flush();
  return out.length?out:null;
}

function parseConstraintText(text, filename){
  const raw = String(text || '').replace(/\u0000/g,'').replace(/[ \t]+\n/g,'\n');
  const table = tryLayerTable(raw, filename);
  if (table) {
    table.forEach(set => { set.constraints = buildConstraints(set.rules || []); set.fanLayer = fanLayerOf(set); });
    return table;
  }
  const matrix = tryMatrix(raw, filename);
  if (matrix) return matrix;
  const lines = [];
  raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(line => {
    const mixed = line.match(/^(反焊盘尺寸|焊盘尺寸|铜皮尺寸|间距)\s+(.+)$/);
    if (mixed && /\d/.test(mixed[2])) { lines.push(mixed[1]); lines.push(mixed[2]); }
    else lines.push(line);
  });
  const sections = [];
  let scheme = '', cur = null;
  function start(item){
    cur = { scheme: scheme, item: item || '', title: item || scheme || '', lines: [] };
    sections.push(cur);
  }
  lines.forEach(line => {
    const h = headingInfo(line);
    if (h && h.level === 1) { scheme = h.title; cur = null; return; }
    if (h && h.level === 2) { start(h.title); return; }
    if (!cur) start('');
    cur.lines.push(line);
  });
  const rawSets = setsFromSections(sections, filename);
  rawSets.forEach(s => {
    s.constraints = buildConstraints(s.rules || []);
    s.fanLayer = fanLayerOf(s);
  });
  return rawSets;
}

function splitNameScope(raw){
  const s = String(raw || '').replace(/\t/g,' ').trim();
  let m = s.match(/^(L\s*\d+\s*层?\s*及以[上下])(?:背钻经过层|层)?\s*(.+)$/i);
  if (m) return { scope: m[1].replace(/\s+/g,'').replace(/层及/,'及'), name: m[2].replace(/^背钻经过层/,'').trim() };
  m = s.match(/^(扇出走线层|出线层|扇出层|表层|顶层|底层|bottom|top)\s*层?\s*(.+)$/i);
  if (m) return { scope: m[1], name: m[2].trim() };
  m = s.match(/^(L\s*\d+(?:\s*[\/,，、|]\s*L?\s*\d+)*)\s*层?\s*(.+)$/i);
  if (m) return { scope: m[1].replace(/\s+/g,'').replace(/[\/,，、|]/g,','), name: m[2].trim() };
  if (/^(扇出走线层|出线层|扇出层)$/.test(s)) return { scope: s, name: '' };
  return { scope: '', name: s };
}

function fanLayerOf(set){
  const title = String(set && set.title || '');
  const head = String(set && (set.txtHead || set.item) || '');
  let m = title.match(/-L(\d+)(?:-|$)/i);
  if (m) return +m[1];
  m = (head + ' ' + title).match(/L\s*(\d+)\s*层?\s*扇出/i);
  if (m) return +m[1];
  m = title.match(/\bL(\d+)\b/i);
  return m ? +m[1] : 0;
}

function isFanScope(scope){
  const s = String(scope || '').replace(/\s+/g,'');
  return /^(扇出走线层|扇出层|出线层)$/.test(s);
}

function layersForScope(scope, n, fan){
  const s = String(scope || '').replace(/\s+/g,'');
  if (!s) return [];
  if (/^(表层|顶层|top)$/i.test(s)) return [1];
  if (/^(底层|bottom)$/i.test(s)) return n > 0 ? [n] : [];
  if (isFanScope(s)) return fan > 0 ? [fan] : [];
  const up = s.match(/^L(\d+)及以上/i);
  if (up) {
    const a = +up[1], out = [];
    for (let i = 1; i <= a; i++) out.push(i);
    return out;
  }
  const below = s.match(/^L(\d+)及以下/i);
  if (below) {
    const a = +below[1], end = Math.max(n, a), out = [];
    for (let i = a; i <= end; i++) out.push(i);
    return out;
  }
  const nums = [...s.matchAll(/L(\d+)/gi)].map(x => +x[1]);
  if (nums.length) return nums.filter(i => i >= 1);
  const bare = s.split(/[\/,，、|]/).map(x => x.trim()).filter(Boolean);
  if (bare.length > 1 && bare.every(x => /^\d+$/.test(x))) return bare.map(Number).filter(i => i >= 1);
  return [];
}

function scopeRank(scope){
  const s = String(scope || '').replace(/\s+/g,'');
  if (/及以[上下]/.test(s)) return 1;
  if (/^(表层|顶层|底层|bottom|top|扇出走线层|扇出层|出线层)$/i.test(s)) return 3;
  return 2;
}

function applyScopes(scopes, n, fan){
  const values = {}, sources = {}, extras = [], seen = {};
  const ordered = (scopes || []).map((sc, i) => ({ sc: sc, i: i })).sort((a,b) => scopeRank(a.sc.scope) - scopeRank(b.sc.scope) || a.i - b.i);
  ordered.forEach(function(row){
    const sc = row.sc;
    const layers = layersForScope(sc.scope, n, fan);
    const src = sc.raw || ((sc.scope ? sc.scope + ' ' : '') + (sc.value || '') + (sc.unit || 'mil'));
    if (!layers.length) {
      if (!sc.scope) return;
      const key = 'X:' + sc.scope;
      values[key] = sc.value;
      sources[key] = src;
      if (!seen[key]) { seen[key] = 1; extras.push({ key: key, label: sc.scope }); }
      return;
    }
    layers.forEach(i => { values['L' + i] = sc.value; sources['L' + i] = src; });
  });
  return { values: values, sources: sources, extras: extras };
}

function maxLayer(scopes, n, fan){
  let m = Math.max(n, fan || 0);
  (scopes || []).forEach(sc => {
    [...String(sc.scope || '').matchAll(/L\s*(\d+)/gi)].forEach(x => { m = Math.max(m, +x[1]); });
  });
  return m;
}

function buildConstraints(rules){
  const list = [], index = {};
  (rules || []).forEach(r => {
    const sp = splitNameScope(r.name);
    let name = (sp.name || '').replace(/^层/,'').trim();
    if (!name && isFanScope(sp.scope)) {
      const typed = typeOf('', r.cat || '');
      name = typed === '尺寸' ? (r.cat || '出线层') : typed;
    }
    if (!name) name = (r.name || '').replace(/^层/,'').trim() || '未命名约束';
    const scope = sp.scope || ((r.scope && r.scope !== r.name) ? r.scope : '');
    const key = (r.cat || '') + '\n' + name;
    if (!index[key]) {
      index[key] = { name: name, cat: r.cat || '', unit: r.unit || 'mil', scopes: [], values: {}, auto: {}, extras: [], unscoped: '' };
      list.push(index[key]);
    }
    const c = index[key];
    if (r.unit) c.unit = r.unit;
    if (scope) c.scopes.push({ scope: scope, value: r.value, unit: r.unit || c.unit, raw: r.raw || ((scope + ' ' + name + ' ' + r.value + (r.unit || 'mil')).trim()) });
    else c.unscoped = r.value;
  });
  return list;
}

function reexpandAll(){
  const n = unifiedLayerCount();
  State.rules.constraintSets.forEach(set => {
    if (!set.constraints) set.constraints = buildConstraints(set.rules || []);
    const fan = fanLayerOf(set);
    set.fanLayer = fan;
    set.constraints.forEach(c => {
      const next = applyScopes(c.scopes || [], n, fan);
      const oldAuto = c.auto || null;
      const values = Object.assign({}, c.values || {});
      const maxL = maxLayer(c.scopes || [], n, fan);
      Object.keys(values).forEach(k => {
        const m = k.match(/^L(\d+)$/);
        if (m && +m[1] > maxL) delete values[k];
      });
      if (!oldAuto) {
        Object.keys(next.values).forEach(k => {
          if (values[k] == null || values[k] === '') values[k] = next.values[k];
        });
      } else {
        Object.keys(next.values).forEach(k => {
          if (values[k] == null || values[k] === '' || values[k] === oldAuto[k]) values[k] = next.values[k];
        });
        Object.keys(oldAuto).forEach(k => {
          if (next.values[k] == null && values[k] === oldAuto[k]) delete values[k];
        });
      }
      const sources = {};
      Object.keys(values).forEach(k => {
        if (values[k] == null || values[k] === '' || values[k] === '无') { delete values[k]; return; }
        sources[k] = (next.values[k] != null && values[k] === next.values[k]) ? (next.sources[k] || '') : '手工填写';
      });
      c.values = values;
      c.auto = next.values;
      c.sources = sources;
      c.extras = next.extras;
    });
  });
}

// 默认全套 15 套标准约束方案 (Matching image-2.png)
