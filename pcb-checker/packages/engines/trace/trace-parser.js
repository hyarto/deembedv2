/* ============================================================================
 * trace-parser.js —— 网络走线报告（Item 块与分隔表格）解析与层汇总统计
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TraceEngine = Object.assign(root.TraceEngine || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function fmt(x){
    if(x==null||isNaN(x))return "-";
    return String(Math.round(x*1e4)/1e4);
  }
function countChar(s,ch){let n=0;for(let i=0;i<s.length;i++)if(s[i]===ch)n++;return n;}

function detectDelimiter(text){
  const lines=text.split(/\r?\n/).map(l=>l.replace(/\s+$/,'')).filter(l=>l.length).slice(0,20);
  if(!lines.length)return '\t';
  for(const d of ['\t',';',',','|']){
    const cs=lines.map(l=>countChar(l,d));
    const mn=Math.min.apply(null,cs);
    if(mn>0){ if(cs.every(c=>c===cs[0]))return d; if(mn>=1)return d; }
  }
  const ws=lines.map(l=>l.trim().split(/\s+/).length);
  if(ws.length&&Math.min.apply(null,ws)>=2&&ws.every(c=>c===ws[0]))return ' ';
  return '\t';
}
function splitLine(line,delim){
  if(delim===' ')return line.trim().split(/\s+/);
  return line.split(delim).map(s=>s.trim());
}
function parseDelimited(text,delim,hasHeader){
  const lines=text.split(/\r?\n/).filter(l=>l.trim().length);
  let headers=null,start=0;
  if(hasHeader&&lines.length){headers=splitLine(lines[0],delim);start=1;}
  const rows=[];
  for(let i=start;i<lines.length;i++){
    const f=splitLine(lines[i],delim);
    if(f.some(x=>x!==''))rows.push({line:i+1,fields:f});
  }
  if(!headers)headers=rows.length?rows[0].fields.map((_,j)=>'列'+(j+1)):[];
  rows.forEach(r=>{while(r.fields.length<headers.length)r.fields.push('');});
  return {headers:headers,rows:rows};
}
function parseFloatNum(s){
  if(s==null)return NaN;
  const m=String(s).replace(/,/g,'').match(/-?\d+(\.\d+)?([eE][-+]?\d+)?/);
  return m?parseFloat(m[0]):NaN;
}
function parseNumList(s){
  if(!s)return [];
  return String(s).split(/[,，;；/|、\s~～]+|或者为|或者|或|or/i).filter(x=>x!=='').map(parseFloatNum).filter(x=>!isNaN(x));
}
const KW={
  net:/net(name)?|网络|网名|signal|信号/i,
  layer:/layer|层|subset/i,
  width:/width|线宽|宽/i,
  length:/len(gth)?|线长|长度|长/i
};
function autoMapColumns(headers){
  const map={net:-1,layer:-1,width:-1,length:-1};
  const used=new Set();
  const tryAssign=(key,re)=>{
    for(let j=0;j<headers.length;j++){
      if(used.has(j))continue;
      if(re.test(headers[j])){map[key]=j;used.add(j);return;}
    }
  };
  tryAssign('net',KW.net);tryAssign('layer',KW.layer);
  tryAssign('width',KW.width);tryAssign('length',KW.length);
  if(map.net<0&&headers.length>=4&&/^列\d+$/.test(headers[0])){map.net=0;map.layer=1;map.width=2;map.length=3;}
  return map;
}

/* ---------- 网络走线报告（Item 块）解析 ---------- */
function isBlockFormat(text){
  return /Subset\s*:/i.test(text)&&/Width\s*\(/i.test(text)&&/(^|\n)\s*Net\s*:/i.test(text);
}
function calcSegLen(seg){
  if(!seg||isNaN(seg.x1)||isNaN(seg.y1)||isNaN(seg.x2)||isNaN(seg.y2))return 0;
  const chord=Math.hypot(seg.x2-seg.x1,seg.y2-seg.y1);
  if(seg.type==='arc'){
    const r=seg.radius;
    if(!isNaN(r)&&r>0){
      if(!isNaN(seg.cx)&&!isNaN(seg.cy)){
        const a1=Math.atan2(seg.y1-seg.cy,seg.x1-seg.cx);
        const a2=Math.atan2(seg.y2-seg.cy,seg.x2-seg.cx);
        let da;
        if(seg.dir==='CCW'){
          da=a2-a1;
          while(da<0)da+=2*Math.PI;
          while(da>=2*Math.PI)da-=2*Math.PI;
        }else if(seg.dir==='CW'){
          da=a1-a2;
          while(da<0)da+=2*Math.PI;
          while(da>=2*Math.PI)da-=2*Math.PI;
        }else{
          da=Math.abs(a2-a1);
          if(da>Math.PI)da=2*Math.PI-da;
        }
        return r*da;
      }
      const ratio=Math.min(1,Math.max(0,chord/(2*r)));
      return r*2*Math.asin(ratio);
    }
  }
  return chord;
}

const NON_TRACE_KINDS=/^(via|vias|pad|pads|pin|pins|shape|shapes|text|texts|region|regions|keepout|keep\s*out|anti-?pad|antipad|hole|holes|drill|drills|outline|keepout\s*region)$/i;

function parseBlockText(text){
  const lines=text.split(/\r?\n/);
  const recs=[];let cur=null;
  const flush=()=>{
    if(cur&&cur.net){
      // 非走线 Item（< Via > / < Shape > / < Text > …）不计入走线记录，否则记录数、总线长、网络数都会被带偏
      const kind=(cur.kind||'').trim();
      if(kind && NON_TRACE_KINDS.test(kind)){cur=null;return;}
      // 线长兜底：< Trace Seg > / < Arc Seg > 这类单段项只有 Seg Length 字段；再没有就按线段几何求和，
      // 避免总线长规则因为字段缺失而整条失效（旧版本会给出 NaN，被判定为「总线长缺失」并误报不符合）
      if(cur.segs&&cur.segs.length){cur.segs.forEach(s=>{s.len=calcSegLen(s);});}
      if(isNaN(cur.length)){
        if(!isNaN(cur.segLenSum)&&cur.segLenSum>0)cur.length=cur.segLenSum;
        else if(cur.segs&&cur.segs.length)cur.length=cur.segs.reduce((a,s)=>a+(isFinite(s.len)?s.len:0),0);
      }
      cur.widthsArr=[...cur.widths.keys()].sort((a,b)=>a-b);
      cur.radiiArr=[...(cur.radii||new Map()).keys()].sort((a,b)=>a-b);
      cur.widthLens=new Map();
      const wSeq=[];
      if(cur.segs&&cur.segs.length){
        cur.segs.forEach(s=>{
          const sl=calcSegLen(s);
          s.len=sl;
          if(!isNaN(s.width)&&s.width>0){
            cur.widthLens.set(s.width,(cur.widthLens.get(s.width)||0)+sl);
            if(!wSeq.length||Math.abs(wSeq[wSeq.length-1]-s.width)>1e-6){
              wSeq.push(s.width);
            }
          }
        });
      }else if(cur.widthsArr.length===1&&!isNaN(cur.length)){
        cur.widthLens.set(cur.widthsArr[0],cur.length);
        wSeq.push(cur.widthsArr[0]);
      }
      if(!wSeq.length&&cur.widthsArr.length){
        wSeq.push(...cur.widthsArr);
      }
      cur.widthSeq=wSeq;
      recs.push(cur);
    }
    cur=null;
  };
  let m;
  for(const raw of lines){
    const line=raw.trim();
    if(!line)continue;
    if(/^Item\s+\d+/i.test(line)){
      flush();
      m=line.match(/Item\s+(\d+)/i);
      const km=line.match(/<\s*([^<>]+?)\s*>/);
      cur={item:m?m[1]:'',kind:km?km[1]:'',net:'',layer:'',length:NaN,segLenSum:NaN,widths:new Map(),widthsArr:[],widthSeq:[],widthLens:new Map(),radii:new Map(),radiiArr:[],segCount:0,arcCount:0,minRadius:NaN,segs:[]};
      continue;
    }
    if(!cur){
      m=line.match(/^Net\s*:\s*(.+)$/i);
      if(m)cur={item:'',kind:'',net:m[1].trim(),layer:'',length:NaN,segLenSum:NaN,widths:new Map(),widthsArr:[],widthLens:new Map(),radii:new Map(),radiiArr:[],segCount:0,arcCount:0,minRadius:NaN,segs:[]};
      continue;
    }
    if((m=line.match(/^Subset\s*:\s*(\S+)/i))){cur.layer=m[1];continue;}
    if((m=line.match(/^Net\s*:\s*(.+)$/i))){cur.net=m[1].trim();continue;}
    if((m=line.match(/^Length\s*:\s*([-+]?[0-9.]+([eE][-+]?[0-9]+)?)/i))){cur.length=parseFloat(m[1]);continue;}
    if((m=line.match(/^Seg\s+Length\s*:\s*([-+]?[0-9.]+([eE][-+]?[0-9]+)?)/i))){
      const v=parseFloat(m[1]);
      if(!isNaN(v))cur.segLenSum=(isNaN(cur.segLenSum)?0:cur.segLenSum)+v;
      continue;
    }
    if((m=line.match(/^(Arc\s+seg|Seg)\s*:\s*xy\s*\[([^\]]*)\]\s*xy\s*\[([^\]]*)\]\s*Width\s*\(\s*([-+]?[0-9.]+([eE][-+]?[0-9]+)?)\s*\)/i))){
      const type=/^arc/i.test(m[1])?'arc':'seg';
      const w=parseFloat(m[4]);
      const p1=m[2].split(',').map(parseFloat),p2=m[3].split(',').map(parseFloat);
      const seg={type:type,x1:p1[0],y1:p1[1],x2:p2[0],y2:p2[1],width:w,radius:NaN};
      cur.segs.push(seg);
      if(type==='seg')cur.segCount++;else cur.arcCount++;
      if(!isNaN(w))cur.widths.set(w,(cur.widths.get(w)||0)+1);
      const am=line.match(/Angle\s*\(\s*([-+]?[0-9.]+)\s*\)/i);
      if(am)seg.angle=parseFloat(am[1]);
      continue;
    }
    if((m=line.match(/Center-xy\s*:\s*\[([^\]]*)\]/i))){
      const cp=m[1].split(',').map(parseFloat);
      if(cur&&cur.segs.length){
        cur.segs[cur.segs.length-1].cx=cp[0];
        cur.segs[cur.segs.length-1].cy=cp[1];
      }
      if(/CCW/i.test(line)&&cur&&cur.segs.length)cur.segs[cur.segs.length-1].dir='CCW';
      else if(/CW/i.test(line)&&cur&&cur.segs.length)cur.segs[cur.segs.length-1].dir='CW';
    }
    if((m=line.match(/Radius\s*\(\s*([-+]?[0-9.]+([eE][-+]?[0-9]+)?)\s*\)/i))){
      const r=parseFloat(m[1]);
      if(cur.segs.length)cur.segs[cur.segs.length-1].radius=r;
      if(!cur.radii)cur.radii=new Map();
      if(!isNaN(r))cur.radii.set(r,(cur.radii.get(r)||0)+1);
      if(isNaN(cur.minRadius)||r<cur.minRadius)cur.minRadius=r;
      continue;
    }
  }
  flush();
  recs.forEach((r,i)=>{r.idx=i;});
  return recs;
}
/* 文件头部 "Total N Item" 声明数 与 Item 块数 */
function parseBlockMeta(text){
  const m=text.match(/Total\s+(\d+)\s*Item/i);
  const items=(text.match(/^Item\s+\d+/gim)||[]).length;
  return {declared:m?parseInt(m[1],10):null,items:items};
}

/* ---------- 表格文本 → 记录（每行 = 一个网络在一个层的记录） ---------- */
function recordsFromGrid(grid,map){
  const recs=[];
  grid.rows.forEach((r,i)=>{
    const net=map.net>=0?(r.fields[map.net]||'').trim():'';
    if(!net)return;
    const w=map.width>=0?parseFloatNum(r.fields[map.width]):NaN;
    const len=map.length>=0?parseFloatNum(r.fields[map.length]):NaN;
    const widths=new Map();const wSeq=[];
    if(!isNaN(w)){widths.set(w,1);wSeq.push(w);}
    const widthLens=new Map();if(!isNaN(w)&&!isNaN(len))widthLens.set(w,len);
    recs.push({idx:recs.length,line:r.line,item:'',net:net,
      layer:map.layer>=0?(r.fields[map.layer]||'').trim():'',
      length:len,
      widths:widths,widthsArr:[...widths.keys()],widthSeq:wSeq,widthLens:widthLens,radii:new Map(),radiiArr:[],segCount:1,arcCount:0,minRadius:NaN,segs:[]});
  });
  return recs;
}

/* ---------- 汇总 ---------- */
function aggregateRecords(records){
  const netLens=new Map();
  for(const r of records){
    let nl=netLens.get(r.net);
    if(!nl){nl=new Map();netLens.set(r.net,nl);}
    if(!isNaN(r.length))nl.set(r.layer,(nl.get(r.layer)||0)+r.length);
  }
  return {netLens:netLens};
}
function extractWidthSeq(r){
  if(r.widthSeq&&r.widthSeq.length)return r.widthSeq;
  const seq=[];
  if(r.segs&&r.segs.length){
    for(const s of r.segs){
      if(!isNaN(s.width)&&s.width>0){
        if(!seq.length||Math.abs(seq[seq.length-1]-s.width)>1e-6){
          seq.push(s.width);
        }
      }
    }
  }
  if(!seq.length&&r.widthsArr&&r.widthsArr.length){
    seq.push(...r.widthsArr);
  }
  return seq;
}

function layerStats(records){
  const m=new Map();
  for(const r of records){
    let e=m.get(r.layer);
    if(!e){e={layer:r.layer,recs:0,nets:new Set(),totalLen:0,widths:new Map(),widthSeqs:new Set(),lens:new Map(),radii:new Map(),minRadius:NaN,arcSegs:0};m.set(r.layer,e);}
    e.recs++;e.nets.add(r.net);
    if(!isNaN(r.length)){e.totalLen+=r.length;e.lens.set(r.length,(e.lens.get(r.length)||0)+1);}
    r.widths.forEach((c,w)=>e.widths.set(w,(e.widths.get(w)||0)+c));
    const seq=extractWidthSeq(r);
    if(seq&&seq.length){
      const s1=seq.map(fmt).join('-');
      const s2=[...seq].reverse().map(fmt).join('-');
      if(!e.widthSeqs.has(s1)&&!e.widthSeqs.has(s2)){
        e.widthSeqs.add(s1);
      }
    }
    if(r.radii)r.radii.forEach((c,rad)=>e.radii.set(rad,(e.radii.get(rad)||0)+c));
    e.arcSegs+=r.arcCount;
    if(!isNaN(r.minRadius)&&(isNaN(e.minRadius)||r.minRadius<e.minRadius))e.minRadius=r.minRadius;
  }
  return [...m.values()].sort((a,b)=>a.layer<b.layer?-1:1);
}


/* ---------- 示例数据（网络走线报告格式，与 sample/走线示例.txt 一致） ---------- */
const SAMPLE_TEXT=[
'Total 10 Item','',
'Item 1                    < Trace >','',
'Set:                      Trace',
'Subset:                   02G01P','',
'Net:                      105_P',
'Length:                   2000.068301','',
'Seg: xy [25018.9300, 23592.4500]  xy [24669.2400, 23592.4500] Width (5.6000) Angle (0.000)',
'Arc seg: xy [24669.2400, 23592.4500]  xy [24616.8500, 23940.0700] Width (5.6000)',
'  Center-xy:  [24669.2300, 23640.0700]  Radius (52.3800) CCW',
'Seg: xy [24616.8500, 23540.0700]  xy [24916.8500, 23456.2000] Width (5.6000) Angle (90.000)','',
'Item 2                    < Trace >','',
'Set:                      Trace',
'Subset:                   02G01P','',
'Net:                      105_N',
'Length:                   2000.401200','',
'Seg: xy [25018.9300, 23602.4500]  xy [24669.2400, 23602.4500] Width (5.6000) Angle (0.000)',
'Arc seg: xy [24669.2400, 23602.4500]  xy [24616.8500, 23950.0700] Width (5.6000)',
'  Center-xy:  [24669.2300, 23650.0700]  Radius (52.3800) CCW',
'Seg: xy [24616.8500, 23550.0700]  xy [24916.8500, 23466.2000] Width (5.6000) Angle (90.000)','',
'Item 3                    < Trace >','',
'Set:                      Trace',
'Subset:                   02G01P','',
'Net:                      106_P',
'Length:                   1500.000000','',
'Seg: xy [10000.0000, 10000.0000]  xy [10800.0000, 10000.0000] Width (5.6000) Angle (0.000)',
'Seg: xy [10800.0000, 10000.0000]  xy [10800.0000, 10700.0000] Width (6.0000) Angle (90.000)','',
'Item 4                    < Trace >','',
'Set:                      Trace',
'Subset:                   02G01P','',
'Net:                      106_N',
'Length:                   1500.200000','',
'Seg: xy [10000.0000, 10100.0000]  xy [10800.0000, 10100.0000] Width (5.6000) Angle (0.000)',
'Seg: xy [10800.0000, 10100.0000]  xy [10800.0000, 10800.2000] Width (5.6000) Angle (90.000)','',
'Item 5                    < Trace >','',
'Set:                      Trace',
'Subset:                   02G01P','',
'Net:                      301_P',
'Length:                   800.000000','',
'Seg: xy [12000.0000, 10000.0000]  xy [12800.0000, 10000.0000] Width (5.6000) Angle (0.000)','',
'Item 6                    < Trace >','',
'Set:                      Trace',
'Subset:                   02G03P','',
'Net:                      301_P',
'Length:                   400.000000','',
'Seg: xy [12800.0000, 10000.0000]  xy [13200.0000, 10000.0000] Width (4.0000) Angle (0.000)','',
'Item 7                    < Trace >','',
'Set:                      Trace',
'Subset:                   02G01P','',
'Net:                      301_N',
'Length:                   802.000000','',
'Seg: xy [12000.0000, 10100.0000]  xy [12802.0000, 10100.0000] Width (5.6000) Angle (0.000)','',
'Item 8                    < Trace >','',
'Set:                      Trace',
'Subset:                   02G03P','',
'Net:                      301_N',
'Length:                   396.000000','',
'Seg: xy [12802.0000, 10100.0000]  xy [13198.0000, 10100.0000] Width (4.0000) Angle (0.000)','',
'Item 9                    < Trace >','',
'Set:                      Trace',
'Subset:                   02G01P','',
'Net:                      402',
'Length:                   900.000000','',
'Seg: xy [14000.0000, 10000.0000]  xy [14900.0000, 10000.0000] Width (5.6000) Angle (0.000)','',
'Item 10                   < Trace >','',
'Set:                      Trace',
'Subset:                   02G02P','',
'Net:                      403',
'Length:                   700.000000','',
'Seg: xy [15000.0000, 10000.0000]  xy [15700.0000, 10000.0000] Width (5.0000) Angle (0.000)'
].join('\n');
  return {
    countChar: countChar,
    detectDelimiter: detectDelimiter,
    splitLine: splitLine,
    parseDelimited: parseDelimited,
    autoMapColumns: autoMapColumns,
    isBlockFormat: isBlockFormat,
    parseBlockMeta: parseBlockMeta,
    parseBlockText: parseBlockText,
    recordsFromGrid: recordsFromGrid,
    aggregateRecords: aggregateRecords,
    layerStats: layerStats,
    SAMPLE_TEXT: SAMPLE_TEXT,
    parseFloatNum: parseFloatNum,
    parseNumList: parseNumList,
    calcSegLen: calcSegLen,
    extractWidthSeq: extractWidthSeq,
    fmt: fmt
  };
});
