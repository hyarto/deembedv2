/* ============================================================================
 * unified-fanout-io.js —— 扇出方案库 JSON 导入、修复与导出
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
function loadFanoutPresets() {
  State.rules.fanoutSchemes = getDefaultFanoutPresets();
  renderFanoutSchemesGrid();
  showToast('已载入 4 套标准预设扇出方案库');
}

function clearFanoutLibrary() {
  if (confirm('确定要清空扇出方案库吗？')) {
    State.rules.fanoutSchemes = [];
    if (typeof FanoutChecker !== 'undefined' && FanoutChecker.resetPadstackColorRegistry) {
      FanoutChecker.resetPadstackColorRegistry();
    }
    const container = $('pnlFanoutSchemeGrid');
    if (container) {
      container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:24px;background:#fff;border:1px dashed #cbd5e1;border-radius:8px;color:#94a3b8">方案库已清空。点击上方「载入标准预设库」或「新建扇出方案」添加模板。</div>`;
    }
    const legendBar = $('pnlUnifiedPadstackLegendBar');
    if (legendBar) legendBar.innerHTML = '';
    showToast('方案库已清空');
  }
}

function exportFanoutLibraryJSON() {
  const jsonStr = JSON.stringify(State.rules.fanoutSchemes, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'fanout_schemes_library.json';
  a.click();
  showToast('已导出扇出方案库 JSON 文件');
}

function parseAndRepairFanoutJson(input) {
  if (!input) return { success: false, error: '输入内容为空' };
  
  const text = (typeof input === 'string' ? input : (input.text || String(input))).replace(/^\uFEFF/, '').trim();
  if (!text) return { success: false, error: '输入内容为空' };

  // 1. First attempt: standard JSON.parse
  try {
    const parsed = JSON.parse(text);
    let schemes = [];
    let meta = {};
    if (Array.isArray(parsed)) {
      schemes = parsed;
    } else if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.schemes)) schemes = parsed.schemes;
      else if (Array.isArray(parsed.fanoutSchemes)) schemes = parsed.fanoutSchemes;
      else if (Array.isArray(parsed.data)) schemes = parsed.data;
      else if (parsed.vias && Array.isArray(parsed.vias)) schemes = [parsed];
      meta = parsed;
    }
    if (schemes.length > 0) {
      return { success: true, schemes, meta, recovered: false, message: `已解析 ${schemes.length} 套扇出方案` };
    }
  } catch (err) {}

  // 2. Auto-repair for truncated / interrupted JSON
  let trimmed = text;

  // Repair strategy 1: Incomplete via properties at tail -> strip incomplete via and close
  const candidate1 = trimmed.replace(/,\s*\{[^{}]*"id":\s*\d+[^{}]*$/, '') + '\n    ]\n  }\n]';
  try {
    const p1 = JSON.parse(candidate1);
    const s1 = Array.isArray(p1) ? p1 : (p1.schemes || p1.fanoutSchemes);
    if (Array.isArray(s1) && s1.length > 0) {
      return {
        success: true,
        schemes: s1,
        recovered: true,
        message: `检测到 JSON 文件末尾截断，已自动容错修复并提取 ${s1.length} 套扇出方案`
      };
    }
  } catch (e1) {}

  // Repair strategy 2: Try completing the last via if it only needs closing fields
  const candidate2 = trimmed.replace(/"role"\s*:\s*"[^"]*$/, '"role": "伴随地孔",\n        "drill": 0\n      }\n    ]\n  }\n]');
  try {
    const p2 = JSON.parse(candidate2);
    const s2 = Array.isArray(p2) ? p2 : (p2.schemes || p2.fanoutSchemes);
    if (Array.isArray(s2) && s2.length > 0) {
      return {
        success: true,
        schemes: s2,
        recovered: true,
        message: `检测到 JSON 文件末尾截断，已自动补全闭合并提取全部 ${s2.length} 套扇出方案`
      };
    }
  } catch (e2) {}

  // Repair strategy 3: Rollback to the last completely closed scheme object '}'
  let endIdx = trimmed.length;
  while (endIdx > 0) {
    const lastObjClose = trimmed.lastIndexOf('}', endIdx - 1);
    if (lastObjClose === -1) break;

    const candidate3 = trimmed.slice(0, lastObjClose + 1).replace(/,\s*$/, '') + '\n]';
    try {
      const p3 = JSON.parse(candidate3);
      if (Array.isArray(p3) && p3.length > 0) {
        return {
          success: true,
          schemes: p3,
          recovered: true,
          message: `检测到 JSON 文件末尾截断，已自动截取前 ${p3.length} 套完整扇出方案`
        };
      }
    } catch (e3) {
      endIdx = lastObjClose;
    }
  }

  // Repair strategy 4: Regex-based object extraction
  const schemeMatches = [];
  const schemeRegex = /\{\s*"id"\s*:\s*"scheme_[^"]+"[\s\S]*?"vias"\s*:\s*\[[\s\S]*?\]\s*\}/g;
  let m;
  while ((m = schemeRegex.exec(text)) !== null) {
    try {
      const singleScheme = JSON.parse(m[0]);
      if (singleScheme && singleScheme.id && Array.isArray(singleScheme.vias)) {
        schemeMatches.push(singleScheme);
      }
    } catch (e) {}
  }
  if (schemeMatches.length > 0) {
    return {
      success: true,
      schemes: schemeMatches,
      recovered: true,
      message: `检测到复杂格式异常，已通过模式扫描成功提取 ${schemeMatches.length} 套扇出方案`
    };
  }

  return { success: false, error: '未能从文件中识别出有效的扇出方案 JSON 数据' };
}

function importFanoutLibraryJSON(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const res = parseAndRepairFanoutJson(e.target.result);
    if (res.success && res.schemes && res.schemes.length > 0) {
      State.rules.fanoutSchemes = res.schemes;
      renderFanoutSchemesGrid();
      if (res.recovered) {
        showToast(res.message);
      } else {
        showToast(`已导入 ${res.schemes.length} 套扇出方案`);
      }
    } else {
      alert('解析扇出方案 JSON 失败: ' + (res.error || '无效的方案格式'));
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

