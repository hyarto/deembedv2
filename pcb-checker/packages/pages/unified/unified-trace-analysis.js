/* ============================================================================
 * unified-trace-analysis.js —— 走线线宽序列压缩与组合偏差分析
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
function fmt(num) {
  if (typeof num !== 'number') num = parseFloat(num);
  if (isNaN(num)) return '';
  return Number.isInteger(num) ? String(num) : String(Math.round(num * 100) / 100);
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

