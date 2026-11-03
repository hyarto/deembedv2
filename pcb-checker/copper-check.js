(function(root){
  const FIELD_RE={};
  function fieldRe(name){
    if(!FIELD_RE[name])FIELD_RE[name]=new RegExp('(?:^|\\n)\\s*'+name+'\\s*:\\s*([^\\n]+)','i');
    return FIELD_RE[name];
  }
  const HEAD_RE=/Item\s+(\d+)\s*<\s*(Shape|Via|Trace)\s*>/i;
  const XY_RE=/xy\s*\[\s*([+-]?[0-9.]+)\s*,\s*([+-]?[0-9.]+)\s*\]/gi;
  function parseBoardItems(text){
    const raw=String(text||'').replace(/\u0000/g,'');
    const chunks=raw.split(/~{8,}/);
    const items=[];
    chunks.forEach(function(chunk){
      const head=chunk.match(HEAD_RE);
      if(!head)return;
      const body=chunk;
      function field(name){
        const m=body.match(fieldRe(name));
        return m?m[1].trim():'';
      }
      const item={
        id:+head[1],
        type:head[2].toLowerCase(),
        set:field('Set'),
        subset:field('Subset'),
        net:/Not on a Net/i.test(body)?'':field('Net'),
        padstack:field('Padstack Name'),
        usage:field('Usage'),
        radius:null,
        center:null,
        origin:null,
        connections:'',
        traceLayers:[],
        circle:false,
        pts:null,
        head:body.slice(0,200)
      };
      const center=body.match(/Center-xy:\s*\[\s*([+-]?[0-9.]+)\s*,\s*([+-]?[0-9.]+)\s*\]/i);
      if(center)item.center=[+center[1], +center[2]];
      const origin=body.match(/Origin-xy:\s*\[\s*([+-]?[0-9.]+)\s*,\s*([+-]?[0-9.]+)\s*\]/i);
      if(origin)item.origin=[+origin[1], +origin[2]];
      const segs=(body.match(/\n\s*Seg:/gi)||[]).length;
      const arcs=(body.match(/Arc seg:/gi)||[]).length;
      const rad=body.match(/Radius\s*\(\s*([0-9.]+)\s*\)/i);
      if(rad)item.radius=+rad[1];
      item.circle=item.type==='shape' && arcs===1 && segs===0 && item.center && item.radius!=null;
      if(item.type==='trace'){
        // 走线只需要点坐标，解析时一次抽完，后面不再扫原文
        const pts=[];
        XY_RE.lastIndex=0;
        let pm;
        while((pm=XY_RE.exec(body)))pts.push(+pm[1], +pm[2]);
        item.pts=pts;
      }
      const traceLayers=[];
      const traceRe=/Trace:\s*\d+\s*\(([^)]+)\)/gi;
      let tm;
      while((tm=traceRe.exec(body))){
        const parts=tm[1].trim().split(/\s+/).filter(Boolean);
        parts.forEach(function(p){if(traceLayers.indexOf(p)<0)traceLayers.push(p);});
      }
      item.traceLayers=traceLayers;
      const conn=body.match(/Connections:\s*([\s\S]*?)(?:\n\s*Backdrill:|\n\s*BackDrill|$)/i);
      if(conn)item.connections=conn[1].replace(/\s+/g,' ').trim();
      items.push(item);
    });
    return items;
  }

  function subsetToLayer(subset, n){
    const s=String(subset||'').trim();
    if(!s)return 0;
    if(/^top$/i.test(s)||s==='表层')return 1;
    if(/^bottom$/i.test(s)||s==='底层')return n||0;
    const m=s.match(/^(\d{1,2})/);
    if(m)return +m[1];
    const l=s.match(/L\s*(\d+)/i);
    return l?+l[1]:0;
  }

  function isPadWord(str, from){
    return /^pad/i.test(String(str).slice(from, from+3));
  }
  function fanCandsOfName(raw){
    // 名字里可能有好几个层号：BGA_3510_l2-L8_Ring3mil 里的 l2 是起止层，L8 才是出线层
    const s=String(raw||'');
    const out=[], seen={};
    const push=function(n){if(!seen[n]){seen[n]=1; out.push(n);}};
    const re=/(^|[^A-Za-z0-9])[Ll](\d{1,2})(?![0-9])/g;
    let m;
    while((m=re.exec(s))){
      if(isPadWord(s, re.lastIndex))continue;        // _L2pad_ 是焊盘标记，不是层号
      push(+m[2]);                                   // 其余层号都留着，交给约束去对
    }
    if(!out.length){
      const loose=s.match(/L(\d{1,2})(?![0-9])/gi)||[];
      loose.forEach(function(x){
        const at=s.toUpperCase().indexOf(x.toUpperCase());
        if(isPadWord(s, at+x.length))return;
        push(+x.replace(/\D/g,''));
      });
    }
    return out;
  }
  function fanLayerOfName(raw){
    const list=fanCandsOfName(raw);
    return list.length?list[list.length-1]:0;
  }
  function sideOfName(raw){
    const s=String(raw||'');
    // Bot / BOTTOM / BotL21 都算出线在 bottom 面
    if(/(?:^|[^A-Za-z])(?:BOT|BOTTOM)(?![A-Za-z])/i.test(s) || /(?:BOT|BOTTOM)(?=L\d|SMA|BGA)/i.test(s) || /底层/.test(s))return 'Bot';
    if(/(?:^|[^A-Za-z])TOP(?![A-Za-z])/i.test(s) || /TOP(?=L\d|SMA|BGA)/i.test(s) || /表层/.test(s))return 'Top';
    return '';
  }
  function layersOfPadstack(raw, n){
    const s=String(raw||'');
    const out=[], seen={};
    const push=function(num){
      if(num>0 && num<=64 && !seen[num]){
        seen[num]=1;
        out.push(num);
      }
    };
    // 1. L<num> or l<num> (e.g. L2, L8, L19, L2pad, l2-L8, L02, L08)
    const re=/(?:^|[^A-Za-z0-9])[Ll](\d{1,2})(?![0-9])/g;
    let m;
    while((m=re.exec(s))){
      push(+m[1]);
    }
    // 2. Subset tokens like 02G01P, 08IS03, 19IS08
    const subRe=/(?:^|[^A-Za-z0-9])(\d{2})[A-Za-z][A-Za-z0-9]*(?![0-9])/g;
    while((m=subRe.exec(s))){
      push(+m[1]);
    }
    // 3. Top / 表层
    if(/(?:^|[^A-Za-z])TOP(?![A-Za-z])/i.test(s) || /TOP(?=L\d|SMA|BGA)/i.test(s) || /表层/.test(s)){
      push(1);
    }
    // 4. Bot / BOTTOM / 底层
    if(/(?:^|[^A-Za-z])(?:BOT|BOTTOM)(?![A-Za-z])/i.test(s) || /(?:BOT|BOTTOM)(?=L\d|SMA|BGA)/i.test(s) || /底层/.test(s)){
      if(n) push(n);
    }
    return out.sort(function(a,b){return a-b;});
  }
  function padKeys(name){
    const raw=String(name||'');
    const kind=/BGA/i.test(raw)?'BGA':(/SMA/i.test(raw)?'SMA':'');
    const fans=fanCandsOfName(raw);
    const fan=fans.length?fans[fans.length-1]:0;
    const d2m=raw.match(/D2M\s*([0-9.]+)/i);
    const ring=raw.match(/ring\s*([0-9.]+)\s*mil/i);
    const side=sideOfName(raw);
    return {kind:kind, fan:fan, fans:fans, d2m:d2m?d2m[1]:'', ring:ring?ring[1]:'', side:side, raw:raw};
  }

  function ruleFan(set){
    if(set&&set.fanLayer)return set.fanLayer;
    const title=String(set&&set.title||'');
    const head=String(set&&(set.txtHead||set.item)||'');
    let m=title.match(/-L(\d+)(?:-|$)/i);
    if(m)return +m[1];
    m=(head+' '+title).match(/L\s*(\d+)\s*层?\s*扇出/i);
    if(m)return +m[1];
    m=title.match(/\bL(\d+)\b/i);
    return m?+m[1]:0;
  }

  function scoreRule(set, keys, strict){
    const title=set.title||'';
    const kind=set.kind||'';
    if(keys.kind && kind!==keys.kind && title.toUpperCase().indexOf(keys.kind)<0)return -1;
    const fan=ruleFan(set);
    if(strict){
      if(keys.fan){
        if(fan!==keys.fan)return -1;
      }else if(fan){
        return -1;
      }
      if(keys.side && /^(Bot|Top)-/.test(title) && title.indexOf(keys.side+'-')!==0)return -1;
    }
    let score=0;
    if(keys.kind)score+=10;
    if(keys.fan && fan===keys.fan)score+=20;
    if(keys.side && title.indexOf(keys.side+'-')===0)score+=5;
    if(keys.d2m && new RegExp('D2M'+keys.d2m,'i').test(title))score+=8;
    if(keys.ring && new RegExp('ring'+keys.ring,'i').test(title))score+=4;
    return score;
  }
  function selectRule(sets, keys){
    const fans=(keys.fans&&keys.fans.length)?keys.fans:(keys.fan?[keys.fan]:[]);
    let best=null;
    // 名字里有多个层号时逐个试，谁能对上已生成的约束就用谁
    fans.forEach(function(f){
      const kk=Object.assign({}, keys, {fan:f});
      const cands=[];
      (sets||[]).forEach(function(set){
        const score=scoreRule(set, kk, true);
        if(score>=0)cands.push({set:set, score:score});
      });
      cands.sort(function(a,b){return b.score-a.score;});
      // 同分时靠后的层号优先：l2-L8 / L8-L12 这类范围写法，出线层在末尾
      if(cands.length && (!best || cands[0].score>=best.score)){
        best={fan:f, set:cands[0].set, score:cands[0].score, cands:cands};
      }
    });
    if(best){
      return {
        rule:best.set,
        fan:best.fan,
        candidates:best.cands.slice(0,5).map(function(c){return c.set.title;})
      };
    }
    // 一个层号都对不上：放宽到同封装（不再要求出线层/面），把候选列出来给人看
    const relaxed=[];
    (sets||[]).forEach(function(set){
      const score=scoreRule(set, keys, false);
      if(score>=0)relaxed.push({set:set, score:score});
    });
    relaxed.sort(function(a,b){return b.score-a.score;});
    return {rule:null, fan:0, candidates:relaxed.slice(0,5).map(function(c){return c.set.title;})};
  }

  function checkTypeOf(shape){
    const blob=((shape.set||'')+' '+(shape.head||'')).toLowerCase();
    if(/非功能|non-?func|unused|nfp/.test(blob))return '非功能焊盘尺寸';
    if(/keepout|anti-?pad|反焊盘|antipad/.test(blob))return '反焊盘尺寸';
    if(/焊盘|etch|regular/.test(blob))return '焊盘尺寸';
    return '反焊盘尺寸';
  }

  function dist(a,b){
    const dx=a[0]-b[0], dy=a[1]-b[1];
    return Math.sqrt(dx*dx+dy*dy);
  }

  function ruleValue(set, checkType, layer){
    const cons=(set&&set.constraints)||[];
    const hit=cons.find(function(c){
      const blob=(c.cat||'')+' '+(c.name||'');
      if(checkType==='非功能焊盘尺寸')return /非功能/.test(blob);
      if(checkType==='反焊盘尺寸')return /反焊盘/.test(blob)&&!/非功能/.test(blob);
      if(checkType==='焊盘尺寸')return /焊盘/.test(blob)&&!/反焊盘/.test(blob)&&!/非功能/.test(blob);
      return false;
    });
    if(!hit)return {missing:'规则里没有这项'};
    const v=hit.values&&hit.values['L'+layer];
    if(v==null||v===''||v==='无')return {missing:'该层无约束', constraint:hit.name};
    const num=parseFloat(v);
    if(isNaN(num))return {missing:'规则值不是数字', constraint:hit.name};
    return {value:num, text:String(v), unit:hit.unit||'mil', constraint:hit.name};
  }

  const BUCKET=5; // mil，网格边长；查找时按容差扩圈，容差远小于它时只看邻近格
  function cellKey(x, y){
    return Math.floor(x/BUCKET)+','+Math.floor(y/BUCKET);
  }
  function neighborBounds(x, y, tol){
    const r=Math.max(1, Math.ceil(tol/BUCKET));
    const cx=Math.floor(x/BUCKET), cy=Math.floor(y/BUCKET);
    return {x0:cx-r, x1:cx+r, y0:cy-r, y1:cy+r};
  }
  function runCopperCheck(items, sets, opts){
    opts=opts||{};
    const n=opts.layerCount||18;
    const posTol=opts.posTol==null?0.05:opts.posTol;
    const valTol=opts.valTol==null?0.01:opts.valTol;
    const enabled=opts.enabled||{'反焊盘尺寸':true,'焊盘尺寸':true,'非功能焊盘尺寸':true,'Padstack层名':true};
    const vias=items.filter(function(it){return it.type==='via'&&it.origin;});
    const circles=items.filter(function(it){return it.circle;});
    const polygons=items.filter(function(it){return it.type==='shape'&&!it.circle;});
    // 圆形铜皮入网格：圆心所在格 -> 铜皮
    const circleGrid={}, traceGrid={};
    circles.forEach(function(sh){
      const k=cellKey(sh.center[0], sh.center[1]);
      (circleGrid[k]||(circleGrid[k]=[])).push(sh);
    });
    // 走线的点入网格：格 -> {layer, subset}，同一条走线在同一格只记一次
    items.forEach(function(tr){
      if(tr.type!=='trace'||!tr.pts||!tr.pts.length)return;
      const layer=subsetToLayer(tr.subset, n);
      if(!layer)return;
      const seen={};
      for(let i=0;i<tr.pts.length;i+=2){
        const k=cellKey(tr.pts[i], tr.pts[i+1]);
        if(seen[k])continue;
        seen[k]=1;
        (traceGrid[k]||(traceGrid[k]=[])).push({layer:layer, subset:tr.subset});
      }
    });
    const used={};
    const groups=vias.map(function(via){
      const near=[];
      const b=neighborBounds(via.origin[0], via.origin[1], posTol);
      for(let cx=b.x0;cx<=b.x1;cx++){
        for(let cy=b.y0;cy<=b.y1;cy++){
          const list=circleGrid[cx+','+cy];
          if(!list)continue;
          for(let i=0;i<list.length;i++){
            const sh=list[i];
            if(dist(via.origin, sh.center)<=posTol){
              near.push(sh);
              used[sh.id]=1;
            }
          }
        }
      }
      const traceNums={};
      (via.traceLayers||[]).forEach(function(name){
        const ln=subsetToLayer(name, n);
        if(ln)traceNums[ln]=name;
      });
      for(let cx=b.x0;cx<=b.x1;cx++)for(let cy=b.y0;cy<=b.y1;cy++){
        const list=traceGrid[cx+','+cy];
        if(!list)continue;
        for(let i=0;i<list.length;i++){
          const tk=list[i];
          if(!traceNums[tk.layer])traceNums[tk.layer]=tk.subset;
        }
      }
      const keys=padKeys(via.padstack);
      const sel=selectRule(sets, keys);
      if(sel.fan)keys.fan=sel.fan;
      const traceList=Object.keys(traceNums).map(function(k){return +k;});
      let note='';
      if(keys.fan && traceList.length){
        note=traceList.indexOf(keys.fan)>=0
          ? ('出线层 L'+keys.fan+' 与走线一致')
          : ('Padstack 为 L'+keys.fan+'，走线在 '+traceList.map(function(x){return 'L'+x;}).join('、'));
      }else if(keys.fan){
        note='Padstack 出线层 L'+keys.fan+'，此过孔没有走线记录';
      }else if(traceList.length){
        note='Padstack 名字里没有出线层号，走线在 '+traceList.map(function(x){return 'L'+x;}).join('、');
      }
      const rows=near.map(function(sh){
        const ctype=checkTypeOf(sh);
        const layer=subsetToLayer(sh.subset, n);
        const on=enabled[ctype]!==false;
        let status='未检查', expect='', constraint='';
        if(!on)status='未检查';
        else if(!sel.rule)status='未选规则';
        else if(!layer)status='层未识别';
        else{
          const rv=ruleValue(sel.rule, ctype, layer);
          constraint=rv.constraint||'';
          if(rv.missing){status='无约束'; expect=rv.missing;}
          else{
            expect=rv.text;
            status=Math.abs(sh.radius-rv.value)<=valTol?'符合':'不符合';
          }
        }
        return {
          shapeId:sh.id, subset:sh.subset, layer:layer, checkType:ctype,
          actual:sh.radius, expect:expect, status:status, constraint:constraint, enabled:on
        };
      });

      // 缺失层检查：规则里有要求、但数据中未检出对应铜皮的层，标记出来并认定为「不符合」
      if(sel.rule && sel.rule.constraints){
        const present={};
        rows.forEach(function(r){
          if(r.layer && r.checkType)present[r.layer+':'+r.checkType]=1;
        });
        sel.rule.constraints.forEach(function(c){
          const blob=((c.cat||'')+' '+(c.name||'')).toLowerCase();
          let ctype='反焊盘尺寸';
          if(/非功能/.test(blob))ctype='非功能焊盘尺寸';
          else if(/反焊盘/.test(blob))ctype='反焊盘尺寸';
          else if(/焊盘/.test(blob))ctype='焊盘尺寸';
          if(enabled[ctype]===false)return;
          const vals=c.values||{};
          Object.keys(vals).forEach(function(k){
            const lm=k.match(/^L(\d+)$/i);
            if(!lm)return;
            const ln=+lm[1];
            const v=vals[k];
            if(v==null||v===''||v==='无')return;
            const num=parseFloat(v);
            if(isNaN(num))return;
            if(!present[ln+':'+ctype]){
              present[ln+':'+ctype]=1;
              rows.push({
                shapeId:'none',
                subset:'—',
                layer:ln,
                checkType:ctype,
                actual:'无铜皮',
                expect:String(v),
                status:'不符合',
                constraint:c.name||'',
                missing:true,
                enabled:true
              });
            }
          });
        });
      }

      // Padstack 层名与 Connections 连接层检查
      const padOn = enabled['Padstack层名'] !== false;
      const connLayerNums = [];
      const connLayerSeen = {};
      (via.traceLayers || []).forEach(function(name){
        const ln = subsetToLayer(name, n);
        if(ln > 0 && !connLayerSeen[ln]){
          connLayerSeen[ln] = 1;
          connLayerNums.push(ln);
        }
      });
      connLayerNums.sort(function(a,b){return a-b;});

      const padLayers = layersOfPadstack(via.padstack, n);
      const missingLayers = connLayerNums.filter(function(l){
        if(padLayers.indexOf(l) >= 0) return false;
        if(new RegExp('\\bL0*' + l + '\\b', 'i').test(via.padstack || '')) return false;
        const subsets = (via.traceLayers || []).filter(function(sub){ return subsetToLayer(sub, n) === l; });
        if(subsets.some(function(sub){ return (via.padstack || '').indexOf(sub) >= 0; })) return false;
        return true;
      });

      let padStatus = '未检查', padActual = '', padExpect = '', padReason = '';
      if(!padOn){
        padStatus = '未检查';
        padActual = padLayers.length ? padLayers.map(function(l){return 'L'+l;}).join('、') : (via.padstack || '无层号');
        padExpect = connLayerNums.length ? connLayerNums.map(function(l){return 'L'+l;}).join('、') : '无连接层';
        padReason = '未启用检查';
      } else if(!connLayerNums.length){
        padStatus = '符合';
        padActual = padLayers.length ? padLayers.map(function(l){return 'L'+l;}).join('、') : (via.padstack || '—');
        padExpect = '无连接层';
        padReason = '无连接记录';
      } else if(missingLayers.length === 0){
        padStatus = '符合';
        padActual = padLayers.map(function(l){return 'L'+l;}).join('、');
        padExpect = connLayerNums.map(function(l){return 'L'+l;}).join('、');
        padReason = '吻合';
      } else {
        padStatus = '不符合';
        padActual = padLayers.length ? padLayers.map(function(l){return 'L'+l;}).join('、') : '无层号';
        padExpect = connLayerNums.map(function(l){return 'L'+l;}).join('、');
        padReason = '缺少连接层 ' + missingLayers.map(function(l){return 'L'+l;}).join('、');
      }

      const padstackRow = {
        shapeId: 'via',
        subset: (via.traceLayers && via.traceLayers.length) ? via.traceLayers.join(' ') : (via.connections || '—'),
        layer: connLayerNums.length ? (connLayerNums.length === 1 ? connLayerNums[0] : connLayerNums.map(function(l){return 'L'+l;}).join('、')) : '—',
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
      };
      rows.unshift(padstackRow);

      rows.sort(function(a,b){
        if(a.isPadstackCheck) return -1;
        if(b.isPadstackCheck) return 1;
        const la = typeof a.layer === 'number' ? a.layer : 999;
        const lb = typeof b.layer === 'number' ? b.layer : 999;
        return la - lb || (a.checkType||'').localeCompare(b.checkType||'') || (String(a.shapeId)).localeCompare(String(b.shapeId));
      });
      // 不符合的行预先挑出来，界面上反复筛/统计时不用再扫一遍
      const failRows=[];
      for(let i=0;i<rows.length;i++)if(rows[i].status==='不符合')failRows.push(rows[i]);
      return {via:via, keys:keys, rule:sel.rule, candidates:sel.candidates, note:note,
        traceLayers:traceList, rows:rows, failRows:failRows, failCount:failRows.length};
    });
    // 最近过孔：同样走网格，不做逐铜皮全量比较
    const viaGrid={};
    vias.forEach(function(v){
      const k=cellKey(v.origin[0], v.origin[1]);
      (viaGrid[k]||(viaGrid[k]=[])).push(v);
    });
    // 只给要展示的前若干个铜皮算最近过孔，且限制搜索半径，避免大板子上慢
    const NEAR_CAP=40;             // 搜索半径上限，单位格（40×5=200 mil）
    function nearestVia(sh){
      const cx=Math.floor(sh.center[0]/BUCKET), cy=Math.floor(sh.center[1]/BUCKET);
      let best=null;
      for(let r=1;r<=NEAR_CAP;r++){
        for(let i=cx-r;i<=cx+r;i++){
          for(let j=cy-r;j<=cy+r;j++){
            if(Math.max(Math.abs(i-cx), Math.abs(j-cy))<r-1)continue; // 只扫这一圈
            const list=viaGrid[i+','+j];
            if(!list)continue;
            for(let q=0;q<list.length;q++){
              const d=dist(sh.center, list[q].origin);
              if(!best||d<best.dist)best={viaId:list[q].id, dist:d, padstack:list[q].padstack||''};
            }
          }
        }
        if(best&&best.dist<=r*BUCKET)break;
      }
      return best;
    }
    const unmatchedCircles=circles.filter(function(sh){return !used[sh.id];});
    const NEAR_PRECHECK=60;        // 预先把前 60 个的最近过孔算出来（底部表要显示 40 行）
    unmatchedCircles.slice(0, NEAR_PRECHECK).forEach(function(sh){
      sh.nearest=nearestVia(sh);
    });
    const nearestViaOf=function(sh){
      if(sh.nearest===undefined || sh.nearest===null)sh.nearest=nearestVia(sh);
      return sh.nearest;
    };
    let hi=0;
    items.forEach(function(it){
      hi=Math.max(hi, subsetToLayer(it.subset, n));
      (it.traceLayers||[]).forEach(function(name){hi=Math.max(hi, subsetToLayer(name, n));});
    });
    return {
      groups:groups,
      unmatchedCircles:unmatchedCircles,
      nearestViaOf:nearestViaOf,
      polygons:polygons,
      viaCount:vias.length,
      circleCount:circles.length,
      maxLayer:hi
    };
  }

  const api={
    parseBoardItems:parseBoardItems,
    fanCandsOfName:fanCandsOfName,
    layersOfPadstack:layersOfPadstack,
    nearestViaOf:function(res, sh){return res && res.nearestViaOf ? res.nearestViaOf(sh) : null;},
    subsetToLayer:subsetToLayer,
    padKeys:padKeys,
    selectRule:selectRule,
    checkTypeOf:checkTypeOf,
    runCopperCheck:runCopperCheck
  };
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  else root.CopperCheck=api;
})(typeof window!=='undefined'?window:globalThis);
