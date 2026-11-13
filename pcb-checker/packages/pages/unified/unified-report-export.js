/* ============================================================================
 * unified-report-export.js —— 综合缺陷报告 CSV / Excel / 文本导出
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
function exportUnifiedCSV() {
  const headers = ['检查类别,目标对象/网络,物理层,检查项目,实测值,约束规则值,判定结果,复核状态,缺陷原因分析'];
  const rows = State.allChecks.map(c => [
    `"${c.categoryName}"`,
    `"${c.target}"`,
    `"${c.layer}"`,
    `"${c.item}"`,
    `"${c.actual}"`,
    `"${c.rule}"`,
    `"${c.pass ? '符合' : '不符合'}"`,
    `"${State.reviewedSet.has(c.id) ? '已复核' : '未复核'}"`,
    `"${c.reason.replace(/"/g, '""')}"`
  ].join(','));
  openModal('导出全量综合检查报告 (CSV)', headers.concat(rows).join('\n'), 'PCB_综合体检分析全量清单.csv');
}

function copyUnifiedReportText() {
  const fails = State.allChecks.filter(c => !c.pass);
  const text = [
    `【PCB 综合体检工程总结报告】`,
    `总检查项: ${State.allChecks.length} 项 | 检出缺陷: ${fails.length} 项`,
    `综合健康分: ${$('kpiHealthScore')?.textContent || '100分'}`,
    `----------------------------------------`,
    `【不符合缺陷明细】:`,
    ...fails.map((f, i) => `${i + 1}. [${f.categoryName}] ${f.target} (${f.layer}) - ${f.item} 实测 ${f.actual} vs 规则 ${f.rule} (原因: ${f.reason})`)
  ].join('\n');
  copyTextToClipboard(text, '综合工程总结报告已复制到剪贴板');
}

function exportUnifiedExcel() {
  const csvHeaders = ['检查类别', '目标对象', '物理层', '检查项', '实测值', '规则要求', '判定状态', '工程原因分析与修改建议'];
  const csvRows = State.allChecks.map(c => [
    c.categoryName, c.target, c.layer, c.item, c.actual, c.rule, c.pass ? '符合' : '不符合', c.reason
  ]);
  const csvContent = [csvHeaders.join(',')].concat(csvRows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(','))).join('\n');
  openModal('导出工程分析报告', csvContent, 'PCB_综合体检工程分析汇总表.csv');
}

