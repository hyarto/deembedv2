/* ============================================================================
 * trace-rules.js —— 走线分层线宽组合、指定线宽线长、弧半径及差分线长差判定引擎
 * ========================================================================== */
(function (root, factory) {
  var parser = (typeof module === "object" && module.exports) ? require("./trace-parser.js") : (root.TraceEngine || {});
  var api = factory(parser);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TraceEngine = Object.assign(root.TraceEngine || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (parser) {
  "use strict";
  var aggregateRecords = parser.aggregateRecords;
  var parseFloatNum = parser.parseFloatNum;
  var parseNumList = parser.parseNumList;
  var calcSegLen = parser.calcSegLen;
  var extractWidthSeq = parser.extractWidthSeq;
/* ---------- 规则与检查 ---------- */
function findRule(layer,rules,defaultRule){
  const L=(layer||'').toLowerCase();
  for(const r of rules){
    if(r.enabled&&(r.layer||'').trim().toLowerCase()===L)return r;
  }
  return (defaultRule&&defaultRule.enabled)?defaultRule:null;
}
function inList(v,list,tol){return list.some(a=>Math.abs(a-v)<=tol);}
function recordRadii(r){
  if(r.radiiArr&&r.radiiArr.length)return r.radiiArr;
  if(r.segs&&r.segs.length)return r.segs.filter(s=>s.type==='arc'&&!isNaN(s.radius)).map(s=>s.radius);
  return [];
}
/* 层规则上的 checkWidth/checkLen 缺省=检查；checkRad 缺省=不检查。全局 opts 是总开关。 */
function parseWidthLengthRules(str){
  if(!str||!String(str).trim())return [];
  const res=[];
  const clean=String(str).replace(/mil|mm/gi,'');
  const parts=clean.split(/[;\n]+|,(?=\s*\d+(?:\.\d+)?\s*[:=<>\~])/);
  for(let raw of parts){
    raw=raw.trim();
    if(!raw)continue;
    let m=raw.match(/^([0-9.]+)\s*(<=|>=|<|>|:=|=|:)\s*(.+)$/);
    if(!m){
      m=raw.match(/^([0-9.]+)\s*[@]\s*(.+)$/);
      if(m)m=[m[0],m[1],'=',m[2]];
    }
    if(!m)continue;
    const w=parseFloat(m[1]);
    const op=m[2];
    const valStr=m[3].trim();
    if(isNaN(w))continue;

    const entry={width:w,raw:raw,mode:'list',list:[],min:NaN,max:NaN};
    if(op==='<='||op==='<'){
      const nums=parseNumList(valStr);
      if(nums.length){entry.mode='max';entry.max=nums[0];res.push(entry);}
    }else if(op==='>='||op==='>'){
      const nums=parseNumList(valStr);
      if(nums.length){entry.mode='min';entry.min=nums[0];res.push(entry);}
    }else{
      if(/^<=|<(?!=)/.test(valStr)){
        const nums=parseNumList(valStr.replace(/^<=|</,''));
        if(nums.length){entry.mode='max';entry.max=nums[0];res.push(entry);}
      }else if(/^>=|>(?!=)/.test(valStr)){
        const nums=parseNumList(valStr.replace(/^>=|>/,''));
        if(nums.length){entry.mode='min';entry.min=nums[0];res.push(entry);}
      }else if(/[~～]|\s*-\s*/.test(valStr)){
        const nums=valStr.split(/[~～\s-]+/).map(parseFloatNum).filter(x=>!isNaN(x));
        if(nums.length>=2){
          entry.mode='range';
          entry.min=Math.min(nums[0],nums[1]);
          entry.max=Math.max(nums[0],nums[1]);
          res.push(entry);
        }
      }else{
        const nums=parseNumList(valStr);
        if(nums.length){
          entry.mode='list';
          entry.list=nums;
          res.push(entry);
        }
      }
    }
  }
  const merged=[];
  const byWidth=new Map();
  for(const e of res){
    const w=e.width;
    if(e.mode==='list'&&byWidth.has(w)&&byWidth.get(w).mode==='list'){
      const existing=byWidth.get(w);
      e.list.forEach(v=>{if(existing.list.indexOf(v)<0)existing.list.push(v);});
    }else{
      byWidth.set(w,e);
      merged.push(e);
    }
  }
  return merged;
}

function parseWidthCombos(str){
  if(!str||!String(str).trim())return [];
  const s=String(str).trim();
  const rawParts=s.split(/[;\n|]|(?:\s+或\s+)|[,，]/);
  const out=[];
  for(let raw of rawParts){
    raw=raw.trim();
    if(!raw)continue;
    const nums=[];
    const numMatches=raw.matchAll(/([0-9]+(?:\.[0-9]+)?)/g);
    for(const nm of numMatches){
      const v=parseFloat(nm[1]);
      if(!isNaN(v))nums.push(v);
    }
    if(nums.length>0){
      out.push({
        raw:raw,
        seq:nums,
        str:nums.map(fmt).join('-')
      });
    }
  }
  return out;
}

function matchWidthCombo(actualSeq,combo,tol){
  tol=tol!=null?tol:0.001;
  const req=combo.seq||combo;
  if(!actualSeq||!req||actualSeq.length!==req.length)return false;
  // 正序匹配
  let fwdMatch=true;
  for(let i=0;i<req.length;i++){
    if(Math.abs(actualSeq[i]-req[i])>tol){fwdMatch=false;break;}
  }
  if(fwdMatch)return true;
  // 倒序匹配（允许倒序）
  let revMatch=true;
  for(let i=0;i<req.length;i++){
    if(Math.abs(actualSeq[i]-req[req.length-1-i])>tol){revMatch=false;break;}
  }
  return revMatch;
}

function compressWidthSequence(widths) {
  if (!widths || widths.length === 0) return [];
  const res = [];
  widths.forEach(w => {
    const num = (typeof w === 'number') ? Math.round(w * 100) / 100 : parseFloat(w);
    if (!isNaN(num)) {
      if (res.length === 0 || Math.abs(res[res.length - 1] - num) > 0.01) {
        res.push(num);
      }
    }
  });
  return res;
}

function analyzeTraceWidthDiscrepancy(compressedSeq, allowedCombosStr) {
  if (!compressedSeq || compressedSeq.length === 0) {
    return { pass: true, reason: '无走线线宽数据' };
  }

  const seqStr = compressedSeq.map(fmt).join('-');
  const rawCombos = (allowedCombosStr || '').split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  
  if (rawCombos.length === 0) {
    return { pass: true, reason: '符合阻抗规范' };
  }

  // Parse combos into tokens
  const parsedCombos = rawCombos.map(c => {
    const tokens = c.split(/[-→\s]+/).map(x => parseFloat(x)).filter(x => !isNaN(x));
    return {
      raw: c,
      tokens,
      fwdStr: tokens.map(fmt).join('-'),
      revStr: tokens.slice().reverse().map(fmt).join('-')
    };
  }).filter(c => c.tokens.length > 0);

  // 1. Direct match check (forward, reverse, or valid single-width segment)
  for (const c of parsedCombos) {
    if (seqStr === c.fwdStr) {
      return { pass: true, reason: `线宽变化顺序符合规则 [${c.raw}]` };
    }
    if (seqStr === c.revStr) {
      return { pass: true, reason: `线宽变化顺序符合规则 [${c.raw}]（反向渐变）` };
    }
    if (compressedSeq.length === 1 && c.tokens.some(t => Math.abs(t - compressedSeq[0]) < 0.01)) {
      return { pass: true, reason: `单一恒定线宽 (${fmt(compressedSeq[0])} mil) 符合规则 [${c.raw}]` };
    }
  }

  // Collect all valid widths across all combos
  const allAllowedWidths = [];
  parsedCombos.forEach(c => {
    c.tokens.forEach(t => {
      if (!allAllowedWidths.some(w => Math.abs(w - t) < 0.01)) {
        allAllowedWidths.push(t);
      }
    });
  });

  // Find abnormal widths not belonging to any combo
  const foreignWidths = compressedSeq.filter(w => !allAllowedWidths.some(aw => Math.abs(aw - w) < 0.01));

  let reason = '';
  if (foreignWidths.length > 0) {
    const mutationDetails = [];
    for (let i = 0; i < compressedSeq.length; i++) {
      const cur = compressedSeq[i];
      if (foreignWidths.some(fw => Math.abs(fw - cur) < 0.01)) {
        const prev = i > 0 ? `${fmt(compressedSeq[i-1])} mil` : '起端';
        const next = i < compressedSeq.length - 1 ? `${fmt(compressedSeq[i+1])} mil` : '末端';
        if (prev === '起端' && next === '末端') {
          mutationDetails.push(`实测线宽 ${fmt(cur)} mil 不在允许集合中`);
        } else {
          mutationDetails.push(`在 ${prev} 与 ${next} 之间突变插入异常线宽 ${fmt(cur)} mil`);
        }
      }
    }
    const mutStr = Array.from(new Set(mutationDetails)).join('；');
    reason = `实测线宽变化 [${seqStr}] 与规则 [${rawCombos.join(', ')}] 不符：${mutStr}（不在本层允许线宽集合 {${allAllowedWidths.map(fmt).join(', ')}} 中）`;
  } else {
    const transitionIssues = [];
    for (let i = 0; i < compressedSeq.length - 1; i++) {
      const w1 = compressedSeq[i];
      const w2 = compressedSeq[i+1];
      const validTransition = parsedCombos.some(c => {
        for (let j = 0; j < c.tokens.length - 1; j++) {
          if ((Math.abs(c.tokens[j] - w1) < 0.01 && Math.abs(c.tokens[j+1] - w2) < 0.01) ||
              (Math.abs(c.tokens[j] - w2) < 0.01 && Math.abs(c.tokens[j+1] - w1) < 0.01)) {
            return true;
          }
        }
        return false;
      });

      if (!validTransition) {
        transitionIssues.push(`在 ${fmt(w1)} mil 与 ${fmt(w2)} mil 之间存在非法突变阶跃`);
      }
    }

    if (transitionIssues.length > 0) {
      reason = `实测线宽变化 [${seqStr}] 与规则 [${rawCombos.join(', ')}] 不符：${Array.from(new Set(transitionIssues)).join('；')}`;
    } else {
      reason = `实测线宽变化顺序 [${seqStr}] 不在允许渐变组合 [${rawCombos.join(', ')}] 集合中（顺序或级数不匹配）`;
    }
  }

  return { pass: false, reason };
}

function checkWidthCombos(actualSeq, combos, tol){
  if(!combos || !combos.length) return { pass: true };
  const compSeq = compressWidthSequence(actualSeq);
  for(const c of combos){
    if(matchWidthCombo(compSeq, c, tol)) return { pass: true, matchedCombo: c };
  }
  const combosStr = combos.map(c => c.seq ? c.seq.map(w => fmt(w)).join('-') : (c.str || String(c))).join('、');
  const evalRes = analyzeTraceWidthDiscrepancy(compSeq, combosStr);
  return {
    pass: false,
    actualStr: actualSeq.map(w => fmt(w)).join(' → '),
    compressedStr: compSeq.map(w => fmt(w)).join('-'),
    allowedStr: combosStr,
    mutationReason: evalRes.reason
  };
}
function wantWidth(rule,opts){
  if(!opts||!opts.checkWidth||!rule||rule.checkWidth===false)return false;
  if(rule.widthCombos&&rule.widthCombos.length)return true;
  if(rule.widthsText&&String(rule.widthsText).trim())return true;
  if(rule.widths&&rule.widths.length)return true;
  return false;
}
function wantLen(rule,opts){
  if(!opts||!opts.checkLen||!rule||rule.checkLen===false)return false;
  if(rule.lenMode==='list'&&rule.lengths&&rule.lengths.length)return true;
  if(rule.lenMode==='range'&&(!isNaN(rule.lenMin)||!isNaN(rule.lenMax)))return true;
  return false;
}
function wantWidthLen(rule,opts){
  if(!opts||!opts.checkWidthLen||!rule||rule.checkWidthLen===false)return false;
  return !!(rule.widthLenRules&&rule.widthLenRules.length);
}
function wantRad(rule,opts){
  if(!opts||!opts.checkRad||!rule||!rule.checkRad)return false;
  if(rule.radMode==='list'&&rule.radii&&rule.radii.length)return true;
  if(rule.radMode==='min'&&!isNaN(rule.radMin))return true;
  if(rule.radMode==='range'&&(!isNaN(rule.radMin)||!isNaN(rule.radMax)))return true;
  return false;
}
/* 规则是否带有实际判据：空规则(启用但无标准)不算判据，对应记录记"未检查" */
function ruleHasCriteria(rule,opts){
  if(!rule)return false;
  return wantWidth(rule,opts)||wantLen(rule,opts)||wantWidthLen(rule,opts)||wantRad(rule,opts);
}
/* 以网络为单位：对每个(网络,层)记录分别检查线宽 / 线长 / 弧半径，再汇总到网络 */
function runChecks(records,rules,defaultRule,opts){
  const tol=opts.tol!=null?opts.tol:0.001;
  const recViol=new Map();
  for(const r of records){
    const rule=findRule(r.layer,rules,defaultRule);
    if(!rule||!ruleHasCriteria(rule,opts))continue;
    const reasons=[],badWidths=[],badRadii=[];
    let badLen=false,missW=false;
    if(wantWidth(rule,opts)){
      const actualSeq=extractWidthSeq(r);
      if(!actualSeq||!actualSeq.length){
        reasons.push('无线段线宽数据');
        missW=true;
      }else{
        let combos=rule.widthCombos;
        if(!combos||!combos.length){
          combos=parseWidthCombos(rule.widthsText||(rule.widths||[]).join(','));
        }
        if(combos&&combos.length){
          const chk=checkWidthCombos(actualSeq,combos,tol);
          if(!chk.pass){
            reasons.push('线宽组合不符合：实际顺序「'+chk.actualStr+'」不在允许组合 {'+chk.allowedStr+'} 中（允许倒序）' + (chk.mutationReason ? ('（' + chk.mutationReason + '）') : ''));
            missW=true;
            badWidths.push(...actualSeq);
          }
        }
      }
    }
    if(wantLen(rule,opts)){
      if(isNaN(r.length)){reasons.push('总线长缺失');badLen=true;}
      else if(rule.lenMode==='list'){
        if(!inList(r.length,rule.lengths,tol)){reasons.push('总线长 '+fmt(r.length)+' 不在允许列表 {'+rule.lengths.join(', ')+'}');badLen=true;}
      }else if(rule.lenMode==='range'){
        if(!isNaN(rule.lenMin)&&r.length<rule.lenMin-tol){reasons.push('总线长 '+fmt(r.length)+' < 下限 '+fmt(rule.lenMin));badLen=true;}
        if(!isNaN(rule.lenMax)&&r.length>rule.lenMax+tol){reasons.push('总线长 '+fmt(r.length)+' > 上限 '+fmt(rule.lenMax));badLen=true;}
      }
    }
    let badWidthLen=false;
    const badWidthLens=[];
    if(wantWidthLen(rule,opts)){
      for(const wlr of (rule.widthLenRules||[])){
        let actualLen=0;let found=false;
        if(r.widthLens){
          for(const [w,l] of r.widthLens.entries()){
            if(Math.abs(w-wlr.width)<=tol){actualLen+=l;found=true;}
          }
        }
        if(found){
          let ok=true;let failMsg='';
          if(wlr.mode==='list'){
            if(!inList(actualLen,wlr.list,tol)){
              ok=false;
              failMsg='指定线宽 '+fmt(wlr.width)+'mil 实际长度 '+fmt(actualLen)+' 不在要求列表 {'+wlr.list.map(fmt).join(', ')+'}';
            }
          }else if(wlr.mode==='range'){
            if(!isNaN(wlr.min)&&actualLen<wlr.min-tol){
              ok=false;
              failMsg='指定线宽 '+fmt(wlr.width)+'mil 实际长度 '+fmt(actualLen)+' < 下限 '+fmt(wlr.min);
            }else if(!isNaN(wlr.max)&&actualLen>wlr.max+tol){
              ok=false;
              failMsg='指定线宽 '+fmt(wlr.width)+'mil 实际长度 '+fmt(actualLen)+' > 上限 '+fmt(wlr.max);
            }
          }else if(wlr.mode==='max'){
            if(actualLen>wlr.max+tol){
              ok=false;
              failMsg='指定线宽 '+fmt(wlr.width)+'mil 实际长度 '+fmt(actualLen)+' > 最大允许值 '+fmt(wlr.max);
            }
          }else if(wlr.mode==='min'){
            if(actualLen<wlr.min-tol){
              ok=false;
              failMsg='指定线宽 '+fmt(wlr.width)+'mil 实际长度 '+fmt(actualLen)+' < 最小要求值 '+fmt(wlr.min);
            }
          }
          if(!ok){
            reasons.push(failMsg);
            badWidthLen=true;
            badWidthLens.push(wlr.width);
          }
        }
      }
    }
    if(wantRad(rule,opts)){
      const rads=recordRadii(r);
      rads.forEach(rad=>{
        let bad=false;
        if(rule.radMode==='list'){
          if(!inList(rad,rule.radii,tol)){reasons.push('弧半径 '+fmt(rad)+' 不在允许列表 {'+rule.radii.join(', ')+'}');bad=true;}
        }else if(rule.radMode==='min'){
          if(rad<rule.radMin-tol){reasons.push('弧半径 '+fmt(rad)+' < 最小半径 '+fmt(rule.radMin));bad=true;}
        }else if(rule.radMode==='range'){
          if(!isNaN(rule.radMin)&&rad<rule.radMin-tol){reasons.push('弧半径 '+fmt(rad)+' < 下限 '+fmt(rule.radMin));bad=true;}
          if(!isNaN(rule.radMax)&&rad>rule.radMax+tol){reasons.push('弧半径 '+fmt(rad)+' > 上限 '+fmt(rule.radMax));bad=true;}
        }
        if(bad)badRadii.push(rad);
      });
    }
    if(reasons.length)recViol.set(r.idx,{reasons:reasons,width:badWidths.length>0||missW,length:badLen,widthLen:badWidthLen,radius:badRadii.length>0,badWidths:badWidths,badRadii:badRadii,badWidthLens:badWidthLens});
  }
  const netAgg=new Map();
  for(const r of records){
    let a=netAgg.get(r.net);
    if(!a){a={net:r.net,checked:false,fail:false,issues:[],layers:[]};netAgg.set(r.net,a);}
    if(a.layers.indexOf(r.layer)<0)a.layers.push(r.layer);
    const v=recViol.get(r.idx);
    if(v){a.checked=true;a.fail=true;v.reasons.forEach(msg=>a.issues.push('['+r.layer+'] '+msg));}
    else if(ruleHasCriteria(findRule(r.layer,rules,defaultRule),opts))a.checked=true;
  }
  let pass=0,fail=0,none=0;
  netAgg.forEach(a=>{if(a.fail)fail++;else if(a.checked)pass++;else none++;});
  return {recViol:recViol,netAgg:netAgg,stats:{nets:netAgg.size,pass:pass,fail:fail,none:none}};
}

/* ---------- 差分 ---------- */
function detectPairs(netNames,suffixPairs){
  const sps=suffixPairs.slice().sort((a,b)=>Math.max(b.pos.length,b.neg.length)-Math.max(a.pos.length,a.neg.length));
  const groups=new Map(),unmatched=[];
  for(const net of netNames){
    let hit=null;
    for(const sp of sps){
      if(sp.pos&&net.endsWith(sp.pos)){hit={base:net.slice(0,net.length-sp.pos.length),pol:'P'};break;}
      if(sp.neg&&net.endsWith(sp.neg)){hit={base:net.slice(0,net.length-sp.neg.length),pol:'N'};break;}
    }
    if(hit&&hit.base){
      if(!groups.has(hit.base))groups.set(hit.base,{base:hit.base,pos:[],neg:[]});
      groups.get(hit.base)[hit.pol==='P'?'pos':'neg'].push(net);
    }else unmatched.push(net);
  }
  const pairs=[],ambiguous=[];
  for(const g of groups.values()){
    if(g.pos.length===1&&g.neg.length===1)pairs.push({base:g.base,pos:g.pos[0],neg:g.neg[0],manual:false});
    else if(g.pos.length+g.neg.length>1)ambiguous.push(g);
  }
  pairs.sort((a,b)=>a.base<b.base?-1:a.base>b.base?1:0);
  return {pairs:pairs,ambiguous:ambiguous,unmatched:unmatched};
}
function computePairDiff(pair,netLens,opts){
  opts=opts||{};
  const layerTol=opts.layerTol!=null?opts.layerTol:(opts.diffTol!=null?opts.diffTol:1);
  const totalTol=opts.totalTol!=null?opts.totalTol:layerTol;
  const checkLayer=opts.checkLayer!==false;
  const checkTotal=opts.checkTotal!==false;

  const P=netLens.get(pair.pos)||new Map();
  const N=netLens.get(pair.neg)||new Map();
  const layers=[];
  P.forEach((_,l)=>{if(layers.indexOf(l)<0)layers.push(l);});
  N.forEach((_,l)=>{if(layers.indexOf(l)<0)layers.push(l);});
  layers.sort();
  let maxLayerDiff=0, layerFailCount=0;
  const rows=layers.map(l=>{
    const lp=P.get(l)||0,ln=N.get(l)||0;
    const diff=Math.abs(lp-ln);
    if(diff>maxLayerDiff)maxLayerDiff=diff;
    const exceed=checkLayer&&(diff>layerTol+1e-9);
    if(exceed)layerFailCount++;
    return {layer:l,lenP:lp,lenN:ln,diff:diff,tol:layerTol,exceed:exceed,note:(P.has(l)&&N.has(l))?'':(P.has(l)?'N 缺该层':'P 缺该层')};
  });
  let tp=0,tn=0;
  P.forEach(v=>tp+=v);N.forEach(v=>tn+=v);
  const totalDiff=Math.abs(tp-tn);
  const totalExceed=checkTotal&&(totalDiff>totalTol+1e-9);
  const total={layer:'所有层总计',lenP:tp,lenN:tn,diff:totalDiff,tol:totalTol,exceed:totalExceed,note:''};
  const setMismatch=layers.some(l=>!(P.has(l)&&N.has(l)));
  const exceed=(checkLayer&&layerFailCount>0)||(checkTotal&&totalExceed);
  return {
    rows:rows,total:total,setMismatch:setMismatch,
    maxLayerDiff:maxLayerDiff,totalDiff:totalDiff,
    layerFailCount:layerFailCount,layerExceed:layerFailCount>0,
    totalExceed:totalExceed,exceed:exceed
  };
}

function fmt(x){
  if(x==null||isNaN(x))return '-';
  return String(Math.round(x*1e4)/1e4);
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function toCSV(headers,rows){
  const q=v=>{v=(v==null?'':String(v));return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
  return '\uFEFF'+[headers.map(q).join(',')].concat(rows.map(r=>r.map(q).join(','))).join('\r\n');
}

  return {
    parseFloatNum: parseFloatNum,
    parseNumList: parseNumList,
    calcSegLen: calcSegLen,
    parseWidthCombos: parseWidthCombos,
    extractWidthSeq: extractWidthSeq,
    matchWidthCombo: matchWidthCombo,
    checkWidthCombos: checkWidthCombos,
    parseWidthLengthRules: parseWidthLengthRules,
    findRule: findRule,
    wantWidth: wantWidth,
    wantLen: wantLen,
    wantWidthLen: wantWidthLen,
    wantRad: wantRad,
    ruleHasCriteria: ruleHasCriteria,
    runChecks: runChecks,
    detectPairs: detectPairs,
    computePairDiff: computePairDiff,
    fmt: fmt,
    esc: esc,
    toCSV: toCSV
  };
});
