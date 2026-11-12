/* ============================================================================
 * trace-report.js —— 走线与差分问题工程建议生成、汇总报告数据组装
 * ========================================================================== */
(function (root, factory) {
  var rules = (typeof module === "object" && module.exports) ? require("./trace-rules.js") : (root.TraceEngine || {});
  var xlsx = (typeof module === "object" && module.exports) ? require("../../shared/xlsx-export.js") : (root.XlsxExport || {});
  var api = factory(rules, xlsx);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TraceEngine = Object.assign(root.TraceEngine || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (rules, xlsx) {
  "use strict";
  var fmt = rules.fmt;
  var findRule = rules.findRule;
  var computePairDiff = rules.computePairDiff;
  var detectPairs = rules.detectPairs;
  var extractWidthSeq = rules.extractWidthSeq;
  var parseWidthCombos = rules.parseWidthCombos;
  var parseWidthLengthRules = rules.parseWidthLengthRules;
  var parseNumList = rules.parseNumList;
  var checkWidthCombos = rules.checkWidthCombos;
  var wantWidth = rules.wantWidth;
  var wantLen = rules.wantLen;
  var wantWidthLen = rules.wantWidthLen;
  var wantRad = rules.wantRad;
  var runChecks = rules.runChecks;
  var generateXLSX = xlsx.generateXLSX;
/* ---------- 建议生成算法 ---------- */
function buildFixSuggestion(type, info){
  if(type === 'widthCombo'){
    const allowedStr = (info.allowedCombos || []).map(c => c.raw || c.str).join('、');
    return '在 EDA 软件中调整 ' + info.layer + ' 层 ' + info.net + ' 网络的走线过渡线宽，修改为允许的线宽组合之一（如 ' + allowedStr + '，支持正序或倒序），调整或消除非预期的突变线宽段。';
  }
  if(type === 'lenMin'){
    const diff = info.lenMin - info.actualLen;
    return '在 EDA 软件中对 ' + info.layer + ' 层 ' + info.net + ' 网络进行蛇形绕线（Accordion）补偿，增加至少 ' + fmt(diff) + ' 走线长度，使总线长达到目标范围 [' + fmt(info.lenMin) + ' ~ ' + fmt(info.lenMax) + ']；若有允许短线场景，可调整规则下限。';
  }
  if(type === 'lenMax'){
    const diff = info.actualLen - info.lenMax;
    return '优化 ' + info.layer + ' 层 ' + info.net + ' 网络走线拓扑，拉直走线或就近打孔出线，缩减至少 ' + fmt(diff) + ' 走线长度，使总线长控制在 ≤ ' + fmt(info.lenMax) + '。';
  }
  if(type === 'lenList'){
    return '在 EDA 软件中调整 ' + info.layer + ' 层 ' + info.net + ' 网络走线总长（实测 ' + fmt(info.actualLen) + '），使其精确匹配允许的目标长度之一（' + (info.lengths || []).map(fmt).join(' / ') + '）。';
  }
  if(type === 'widthLen'){
    return '在 EDA 软件中调整 ' + info.layer + ' 层 ' + info.net + ' 网络中 ' + fmt(info.width) + 'mil 线宽段的布线长度（实测 ' + fmt(info.actualLen) + '），使其满足要求（' + info.reqText + '）。';
  }
  if(type === 'radMin'){
    return '在 EDA 软件中增大 ' + info.layer + ' 层走线拐角处的倒角圆弧半径至 ≥ ' + fmt(info.radMin) + '（实测 ' + fmt(info.actualRad) + '），避免急折角引起的高频信号反射。';
  }
  if(type === 'radList'){
    return '在 EDA 软件中修改 ' + info.layer + ' 层走线拐角处的倒角圆弧半径，使其符合允许列表规格（' + (info.radii || []).map(fmt).join(' / ') + '）。';
  }
  if(type === 'radRange'){
    return '在 EDA 软件中修改 ' + info.layer + ' 层走线拐弯处的圆弧半径，使其落在目标范围 [' + fmt(info.radMin) + ' ~ ' + fmt(info.radMax) + '] 内。';
  }
  return '检查 EDA 软件中 ' + (info.layer || '') + ' 层的走线设计，依据问题原因进行针对性调整以符合设计规范。';
}

function buildDiffFixSuggestion(type, info){
  if(type === 'layerDiff'){
    const shorterNet = info.lenP < info.lenN ? info.posNet : info.negNet;
    return '在 ' + info.layer + ' 层对较短的单端网络「' + shorterNet + '」进行局部等长蛇形微调（Accordion/Phase Tuning），补偿约 ' + fmt(info.diff) + ' 走线长度，使该层差值控制在 ≤ ±' + fmt(info.tol) + ' 范围内。';
  }
  if(type === 'totalDiff'){
    const shorterNet = info.lenP < info.lenN ? info.posNet : info.negNet;
    return '在 EDA 软件中对全板总长较短的单端网络「' + shorterNet + '」在末端扇出或过孔附近进行总长微调绕线，补偿约 ' + fmt(info.diff) + ' 长度，使整网总差值达到 ≤ ±' + fmt(info.tol) + ' 的全板时序公差要求。';
  }
  if(type === 'setMismatch'){
    return '检查 EDA 原理图与 PCB 叠层过孔分配，确保差分对 ' + info.posNet + ' 与 ' + info.negNet + ' 在相同出线层进行对称布线与换层，消除单侧换层引起的阻抗突变与共模噪声。';
  }
  return '检查差分对走线与过孔，调整布线以满足等长与对称性要求。';
}

/* ---------- 检查汇总报告数据组装 (第④页与第⑤页汇总) ---------- */
function generateUnifiedReportData(records, checkRes, rules, defaultRule, opts, traceReviewed, diffItemsOrPairs, netLens, diffOpts, diffReviewed){
  opts = opts || {};
  traceReviewed = traceReviewed || (typeof S !== 'undefined' && S.traceReviewed ? S.traceReviewed : new Set());
  diffReviewed = diffReviewed || (typeof S !== 'undefined' && S.diffReviewed ? S.diffReviewed : new Set());
  const tol = opts.tol != null ? opts.tol : 0.001;

  const headers = ['序号', '问题网络 (网络名+所在层)', '问题原因', '如何修改', '复验状态'];
  const cols = [
    { width: 8 },  // 序号
    { width: 28 }, // 问题网络 (网络名+所在层)
    { width: 44 }, // 问题原因
    { width: 48 }, // 如何修改
    { width: 12 }  // 复验状态
  ];
  const rows = [];
  let problemCount = 0;

  // 1. 第④页：走线检查问题项
  if(checkRes && records && records.length){
    records.forEach(r => {
      const v = checkRes.recViol ? checkRes.recViol.get(r.idx) : null;
      if(!v) return;
      const rule = findRule(r.layer, rules, defaultRule);
      const isRev = traceReviewed.has(r.idx);
      const revText = isRev ? '已复验' : '未复验';
      const netWithLayer = r.net + ' (' + r.layer + ')';
      const actualSeq = extractWidthSeq(r);
      const seqStr = actualSeq.map(fmt).join(' → ');

      if(v.width && rule && wantWidth(rule, opts)){
        let combos = rule.widthCombos;
        if(!combos || !combos.length){
          combos = parseWidthCombos(rule.widthsText || (rule.widths || []).join(','));
        }
        const chk = checkWidthCombos(actualSeq, combos, tol);
        const allowedStr = combos ? combos.map(c => c.raw || c.str).join(' / ') : '';
        problemCount++;
        rows.push([
          problemCount,
          netWithLayer,
          '线宽不对：实测顺序「' + seqStr + '」，要求「' + (allowedStr || '无') + '」',
          '将走线线宽修改为设计值（' + (allowedStr || '标准线宽') + '）',
          revText
        ]);
      }

      if(v.length && rule && wantLen(rule, opts)){
        if(rule.lenMode === 'list'){
          problemCount++;
          rows.push([
            problemCount,
            netWithLayer,
            '线长超标：实测 ' + fmt(r.length) + '，不在设计列表 {' + (rule.lengths || []).map(fmt).join(', ') + '}',
            '调整走线总长为设计值 ' + (rule.lengths || []).map(fmt).join(' / '),
            revText
          ]);
        } else if(rule.lenMode === 'range'){
          if(!isNaN(rule.lenMin) && r.length < rule.lenMin - tol){
            problemCount++;
            const diff = rule.lenMin - r.length;
            rows.push([
              problemCount,
              netWithLayer,
              '线长超标：实测 ' + fmt(r.length) + '，低于下限 ' + fmt(rule.lenMin),
              '蛇形绕线增加 ' + fmt(diff) + '，使总长达到设计值 ' + fmt(rule.lenMin),
              revText
            ]);
          } else if(!isNaN(rule.lenMax) && r.length > rule.lenMax + tol){
            problemCount++;
            const diff = r.length - rule.lenMax;
            rows.push([
              problemCount,
              netWithLayer,
              '线长超标：实测 ' + fmt(r.length) + '，超出上限 ' + fmt(rule.lenMax),
              '优化拉直走线缩短 ' + fmt(diff) + '，使总长控制在设计值 ' + fmt(rule.lenMax) + ' 内',
              revText
            ]);
          }
        }
      }

      if(v.widthLen && rule && wantWidthLen(rule, opts)){
        (rule.widthLenRules || []).forEach(wlr => {
          let actualLen = 0, found = false;
          if(r.widthLens){
            for(const [w, l] of r.widthLens.entries()){
              if(Math.abs(w - wlr.width) <= tol){ actualLen += l; found = true; }
            }
          }
          if(found){
            let failMsg = '', reqStr = '';
            if(wlr.mode === 'list'){
              reqStr = wlr.list.map(fmt).join('/');
              if(!inList(actualLen, wlr.list, tol)){
                failMsg = '指定线宽线长超标：' + fmt(wlr.width) + 'mil线长实测' + fmt(actualLen) + '，要求' + reqStr;
              }
            } else if(wlr.mode === 'range'){
              reqStr = fmt(wlr.min) + '~' + fmt(wlr.max);
              if(!isNaN(wlr.min) && actualLen < wlr.min - tol){
                failMsg = '指定线宽线长超标：' + fmt(wlr.width) + 'mil线长实测' + fmt(actualLen) + '，低于下限' + fmt(wlr.min);
              } else if(!isNaN(wlr.max) && actualLen > wlr.max + tol){
                failMsg = '指定线宽线长超标：' + fmt(wlr.width) + 'mil线长实测' + fmt(actualLen) + '，超出上限' + fmt(wlr.max);
              }
            } else if(wlr.mode === 'max' && actualLen > wlr.max + tol){
              reqStr = '≤' + fmt(wlr.max);
              failMsg = '指定线宽线长超标：' + fmt(wlr.width) + 'mil线长实测' + fmt(actualLen) + '，要求≤' + fmt(wlr.max);
            } else if(wlr.mode === 'min' && actualLen < wlr.min - tol){
              reqStr = '≥' + fmt(wlr.min);
              failMsg = '指定线宽线长超标：' + fmt(wlr.width) + 'mil线长实测' + fmt(actualLen) + '，要求≥' + fmt(wlr.min);
            }
            if(failMsg){
              problemCount++;
              rows.push([
                problemCount,
                netWithLayer,
                failMsg,
                '将 ' + fmt(wlr.width) + 'mil 走线段长度调整为设计值 ' + reqStr,
                revText
              ]);
            }
          }
        });
      }

      if(v.radius && rule && wantRad(rule, opts)){
        const rads = recordRadii ? recordRadii(r) : (r.radiiArr || []);
        rads.forEach(rad => {
          let bad = false, failMsg = '', targetVal = '';
          if(rule.radMode === 'list' && !inList(rad, rule.radii, tol)){
            bad = true; targetVal = (rule.radii || []).map(fmt).join('/');
            failMsg = '弧半径异常：实测 ' + fmt(rad) + '，不在设计列表 {' + targetVal + '}';
          } else if(rule.radMode === 'min' && rad < rule.radMin - tol){
            bad = true; targetVal = '≥ ' + fmt(rule.radMin);
            failMsg = '弧半径异常：实测 ' + fmt(rad) + '，小于最小半径 ' + fmt(rule.radMin);
          } else if(rule.radMode === 'range' && ((!isNaN(rule.radMin) && rad < rule.radMin - tol) || (!isNaN(rule.radMax) && rad > rule.radMax + tol))){
            bad = true; targetVal = fmt(rule.radMin) + '~' + fmt(rule.radMax);
            failMsg = '弧半径异常：实测 ' + fmt(rad) + '，不在允许范围 [' + targetVal + ']';
          }
          if(bad){
            problemCount++;
            rows.push([
              problemCount,
              netWithLayer,
              failMsg,
              '将拐角倒角圆弧半径调整为设计值 ' + targetVal,
              revText
            ]);
          }
        });
      }

      if(!v.width && !v.length && !v.widthLen && !v.radius && v.reasons && v.reasons.length){
        v.reasons.forEach(msg => {
          problemCount++;
          rows.push([
            problemCount,
            netWithLayer,
            '走线异常：' + msg,
            '检查并修改走线以符合设计规范',
            revText
          ]);
        });
      }
    });
  }

  // 2. 第⑤页：差分分析检查问题项
  let diffItems = [];
  if(Array.isArray(diffItemsOrPairs) && diffItemsOrPairs.length > 0 && diffItemsOrPairs[0].d){
    diffItems = diffItemsOrPairs;
  } else if(Array.isArray(diffItemsOrPairs) && (netLens instanceof Map || typeof netLens === 'object')){
    diffItems = diffItemsOrPairs.map(p => ({
      pair: p,
      d: computePairDiff(p, netLens, diffOpts || {})
    }));
  }

  diffItems.forEach(x => {
    (x.d.rows || []).forEach(r => {
      const isRev = diffReviewed.has(x.pair.base + '|' + r.layer);
      const revText = isRev ? '已复验' : '未复验';
      const pairNetWithLayer = x.pair.pos + ' / ' + x.pair.neg + ' (' + r.layer + ')';
      if(r.exceed){
        problemCount++;
        const shorterNet = r.lenP < r.lenN ? x.pair.pos : x.pair.neg;
        rows.push([
          problemCount,
          pairNetWithLayer,
          '差分线对内长度差超标：差值 ' + fmt(r.diff) + '，允许值 ≤ ' + fmt(r.tol),
          '在 ' + r.layer + ' 层对 ' + shorterNet + ' 绕线补偿 ' + fmt(r.diff) + '，使对内差 ≤ ' + fmt(r.tol),
          revText
        ]);
      } else if(r.note){
        problemCount++;
        rows.push([
          problemCount,
          pairNetWithLayer,
          '差分层不一致：' + r.note,
          '将 ' + x.pair.pos + ' 与 ' + x.pair.neg + ' 调整至同一层对称布线',
          revText
        ]);
      }
    });

    if(x.d.total && x.d.total.exceed){
      problemCount++;
      const isRev = diffReviewed.has(x.pair.base + '|TOTAL');
      const revText = isRev ? '已复验' : '未复验';
      const shorterNet = x.d.total.lenP < x.d.total.lenN ? x.pair.pos : x.pair.neg;
      rows.push([
        problemCount,
        x.pair.pos + ' / ' + x.pair.neg + ' (跨层总长)',
        '差分总线长差超标：总差值 ' + fmt(x.d.total.diff) + '，允许值 ≤ ' + fmt(x.d.total.tol),
        '对 ' + shorterNet + ' 进行总长微调绕线补偿 ' + fmt(x.d.total.diff) + '，使总长差 ≤ ' + fmt(x.d.total.tol),
        revText
      ]);
    }
  });

  if(rows.length === 0){
    rows.push([
      1,
      '全板走线及差分网络',
      '全部通过：未发现线宽不对、线长超标、弧半径异常或差分超差等问题',
      '设计完全符合当前配置的约束规范，无需修改',
      '全部合格'
    ]);
  }

  const tsvLines = [headers.join('\t')].concat(rows.map(r => r.map(x => String(x == null ? '' : x).replace(/\t/g, ' ')).join('\t')));
  const tsvText = tsvLines.join('\r\n');

  return { headers, cols, rows, problemCount, tsvText };
}

  return {
    generateXLSX: generateXLSX,
    buildFixSuggestion: buildFixSuggestion,
    buildDiffFixSuggestion: buildDiffFixSuggestion,
    generateUnifiedReportData: generateUnifiedReportData,
    generateTraceReportData: generateUnifiedReportData,
    generateDiffReportData: generateUnifiedReportData
  };
});
