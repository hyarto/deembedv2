/* ============================================================================
 * unified-state.js —— 全局状态、DOM 小工具、页签切换与 Toast
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
// Universal File Decoder (Auto-detect UTF-8, UTF-16, GBK, GB18030)
function decodeTxt(buf){
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) return { text: new TextDecoder('utf-16le').decode(u8).replace(/^\uFEFF/,''), enc: 'UTF-16' };
  if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) return { text: new TextDecoder('utf-16be').decode(u8).replace(/^\uFEFF/,''), enc: 'UTF-16' };
  const utf8 = new TextDecoder('utf-8').decode(u8).replace(/^\uFEFF/,'');
  const bad = (utf8.match(/\uFFFD/g) || []).length;
  if (!bad) return { text: utf8, enc: 'UTF-8' };
  let gbk = '';
  try { gbk = new TextDecoder('gb18030').decode(u8).replace(/^\uFEFF/,''); }
  catch(e) { return { text: utf8, enc: 'UTF-8' }; }
  const gbkBad = (gbk.match(/\uFFFD/g) || []).length;
  if (gbkBad < bad) return { text: gbk, enc: 'GB18030' };
  return { text: utf8, enc: 'UTF-8' };
}

// Toast helper
function showToast(msg, isSuccess = true) {
  let toast = $('appToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appToast';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.15);transition:all 0.3s;opacity:0;transform:translateY(20px);pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.style.background = isSuccess ? '#ecfdf5' : '#fef2f2';
  toast.style.color = isSuccess ? '#065f46' : '#991b1b';
  toast.style.border = isSuccess ? '1px solid #a7f3d0' : '1px solid #fecaca';
  toast.innerHTML = msg;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
  }, 2500);
}


const State = {
  rawText: '',
  dataInputs: {
    trace:      { text: '', fileNames: [], totalBytes: 0, statsText: '' },
    constraint: { text: '', fileNames: [], totalBytes: 0, statsText: '' },
    dfmFanout:  { text: '', fileNames: [], totalBytes: 0, statsText: '' },
    pour:       { text: '', fileNames: [], totalBytes: 0, statsText: '' }
  },
  elements: { vias: [], traces: [], shapes: [], layers: [] },
  rules: {
    // 1. 走线检查规则 (按层表格 + 差分按层/总长允许值)
    traceLayers: [
      { layer: '08IS03', combos: '6.9-6-3.94, 6.9-5.7-6.9', lenRange: '1000-3000', diffLayerTol: 0.5, specificRule: '6.9=10', minArc: 52.38 },
      { layer: '02G01P', combos: '5.6, 5.6-6', lenRange: '1000-3000', diffLayerTol: 0.5, specificRule: '6.0=700', minArc: 52.38 },
      { layer: '19IS08', combos: '6.0-3.94, 3.94', lenRange: '500-2500', diffLayerTol: 0.5, specificRule: '3.94=10', minArc: 18.0 }
    ],
    // 2. 约束检查规则 (完整复原独立页 15 套名片与逐层表)
    constraintSets: getDefaultConstraintSets(),
    // 3. DFM Dual-clearance rules
    dfm: {
      gndAirgap: 6.0,
      signalAirgap: 6.0,
      gndPadDiameter: 7.906,
      signalPadDiameter: 9.94,
      firstDrill: 5.54
    },
    // 4. Fanout Schemes Library
    fanout: {
      clusterRadiusMm: 2.0,
      geomTolMil: 0.5,
      centerDistTolMil: 1.0
    },
    fanoutSchemes: getDefaultFanoutPresets(),
    // 5. Pour Multi-rules
    pourRule1: [
      { id: 'pour_r1_1', padstack: 'VIA_0902', layers: 'L1-L21', radius: 50.0 },
      { id: 'pour_r1_2', padstack: 'BGA_3510', layers: 'L2-L19', radius: 45.0 }
    ],
    // 规则 2：特定类型孔在指定层的异型铜皮比对规则 (image-1.png)
    specialShapeTemplates: [
      {
        id: 'tmpl_1',
        name: 'L2特定异型铜皮_1',
        padstack: 'BGA_3510',
        layer: '02G01P',
        expectedArea: 452.4,
        areaTolerance: 30.0
      }
    ],
    pourRule3: [
      { id: 'pour_r3_1', traceLayer: '08IS03', upperRef: '07G02P', lowerRef: '09G03P', margin: 50.0 },
      { id: 'pour_r3_2', traceLayer: '19IS08', upperRef: '18G07P', lowerRef: '20G08P', margin: 50.0 }
    ]
  },
  allChecks: [],
  results: {
    trace: { pass: true, checks: [], score: 100 },
    copper: { pass: true, checks: [], score: 100 },
    dfm: { pass: true, checks: [], score: 100 },
    fanout: { pass: true, checks: [], score: 100 },
    pour: { pass: true, checks: [], score: 100 }
  },
  reviewedSet: new Set(),
  currentFilter: 'all',
  canvas: {
    scale: 1,
    panX: 0,
    panY: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    showVias: true,
    showTraces: true,
    showShapes: true,
    showDefects: true,
    showPorts: false,
    measuring: false,
    measurePoints: []
  }
};

function $(id) { return document.getElementById(id); }

/* HTML 转义：网表/层名/原因文本来自外部导入的 TXT，属不可信输入，插入 innerHTML 前必须转义 */
function escHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function switchTab(tabId, autoFit = true) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));

  const targetPane = $(tabId);
  if (targetPane) targetPane.classList.add('active');

  if (tabId === 'tabCanvas') {
    resizeCanvas();
    if (autoFit) safeRAF(() => fitCanvasToLayout());
  } else if (tabId === 'tabAnalysis') {
    renderAnalysisGuidance();
  }
}

function safeRAF(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
  else setTimeout(fn, 16);
}

function fillInput(id, val) {
  const el = $(id);
  if (el) { el.value = val; el.dispatchEvent(new Event('change')); }
}

function toggleAcc(headerEl) {
  const acc = headerEl.closest('.rule-acc');
  if (acc) acc.classList.toggle('collapsed');
}

