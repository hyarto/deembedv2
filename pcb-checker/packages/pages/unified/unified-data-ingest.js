/* ============================================================================
 * unified-data-ingest.js —— 四类 TXT 数据导入框：选择、拖拽、追加、清空
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
// 4-Category TXT Data Ingestion (仅支持 .txt 文件选择或拖拽，不含粘贴输入)
const DATA_CAT_META = {
  trace:      { label: '① 走线检查数据', color: '#2563eb' },
  constraint: { label: '② 约束检查数据', color: '#7c3aed' },
  dfmFanout:  { label: '③ DFM 与扇出方案数据', color: '#0d9488' },
  pour:       { label: '④ 铜皮检查数据', color: '#d97706' }
};

function formatFileBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return Math.max(0.1, bytes / 1024).toFixed(1) + ' KB';
}

function summarizeCategoryElements(catKey, text) {
  if (!text || !text.trim()) return '';
  if (typeof PourChecker !== 'undefined' && PourChecker.parsePcbElements) {
    const p = PourChecker.parsePcbElements(text);
    if (catKey === 'trace') return `${p.traces.length} 走线段 · ${p.layers.length} 层`;
    if (catKey === 'constraint') return `${p.vias.length} 过孔 · ${p.shapes.length} 块铜皮/反焊盘`;
    if (catKey === 'dfmFanout') return `${p.vias.length} 过孔 · ${p.traces.length} 走线段`;
    if (catKey === 'pour') return `${p.shapes.length} 铜皮 · ${p.vias.length} 孔 · ${p.traces.length} 线段`;
  }
  return `文本长度 ${text.length} 字符`;
}

function renderDataIngestionBoxes() {
  const keys = ['trace', 'constraint', 'dfmFanout', 'pour'];
  let loadedCount = 0;

  keys.forEach(k => {
    const slot = State.dataInputs[k] || { text: '', fileNames: [], totalBytes: 0, statsText: '' };
    const meta = DATA_CAT_META[k];
    const hasData = Boolean(slot.text && slot.text.trim());
    if (hasData) loadedCount++;

    const boxEl = $(`dataBox_${k}`);
    const badgeEl = $(`badgeData_${k}`);
    const statusEl = $(`statusData_${k}`);
    const metaEl = $(`metaData_${k}`);
    const btnAppend = $(`btnAppend_${k}`);
    const btnClear = $(`btnClear_${k}`);

    if (boxEl && boxEl.classList) {
      if (hasData) boxEl.classList.add('loaded');
      else boxEl.classList.remove('loaded');
    }
    if (badgeEl) {
      badgeEl.textContent = hasData ? ' 已导入' : '未导入';
      badgeEl.style.background = hasData ? '#dcfce7' : '#e3e8ef';
      badgeEl.style.color = hasData ? '#15803d' : '#475569';
    }
    if (statusEl) {
      if (hasData) {
        const fLabel = (slot.fileNames && slot.fileNames.length) ? slot.fileNames.join(' + ') : '已导入 TXT 数据';
        statusEl.textContent = fLabel;
        statusEl.style.color = '#0f172a';
      } else {
        statusEl.textContent = '点击选择或拖拽 .txt 文件至此';
        statusEl.style.color = meta.color;
      }
    }
    if (metaEl) {
      if (hasData) {
        const sizePart = slot.totalBytes > 0 ? ` (${formatFileBytes(slot.totalBytes)})` : '';
        metaEl.textContent = `${slot.statsText || summarizeCategoryElements(k, slot.text)}${sizePart}`;
        metaEl.style.color = '#15803d';
      } else {
        metaEl.textContent = '仅 .txt，可多选合并';
        metaEl.style.color = '#94a3b8';
      }
    }
    if (btnAppend && btnAppend.style) btnAppend.style.display = hasData ? 'inline-flex' : 'none';
    if (btnClear && btnClear.style) btnClear.style.display = hasData ? 'inline-flex' : 'none';
  });

  const sumEl = $('lblDataSummary');
  if (sumEl) {
    const el = State.elements || { vias: [], traces: [], shapes: [] };
    sumEl.textContent = `已导入模块: ${loadedCount} / 4 类 | 汇总元素: ${el.vias.length} 孔 | ${el.traces.length} 走线段 | ${el.shapes.length} 铜皮`;
  }
}

function initDragAndDrop() {
  ['trace', 'constraint', 'dfmFanout', 'pour'].forEach(catKey => {
    const zone = $(`dropZone_${catKey}`);
    if (!zone || !zone.addEventListener) return;

    ['dragenter', 'dragover'].forEach(evName => {
      zone.addEventListener(evName, e => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(evName => {
      zone.addEventListener(evName, e => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('dragover');
      });
    });

    zone.addEventListener('drop', e => {
      const files = e.dataTransfer ? e.dataTransfer.files : null;
      if (files && files.length > 0) {
        readCategoryTxtFiles(catKey, files, false);
      }
    });
  });
  renderDataIngestionBoxes();
}

function handleCategoryTxtUpload(catKey, e, appendMode = false) {
  const files = e && e.target ? e.target.files : null;
  if (files && files.length > 0) {
    readCategoryTxtFiles(catKey, files, appendMode);
  }
  if (e && e.target) e.target.value = '';
}

function readCategoryTxtFiles(catKey, fileList, appendMode = false) {
  if (!State.dataInputs[catKey]) return;
  const allFiles = Array.from(fileList || []);
  const txtFiles = allFiles.filter(f => /\.txt$/i.test(String(f.name || '')));
  if (txtFiles.length === 0) {
    alert('仅支持 .txt 文件');
    return;
  }
  if (txtFiles.length < allFiles.length && typeof showToast === 'function') {
    showToast(`已自动过滤非 .txt 文件，仅读取 ${txtFiles.length} 个 .txt 文件`, false);
  }

  // 同时兼容单元测试同步 mock 文件对象 (f.content) 与真实浏览器异步 FileReader
  if (txtFiles.every(f => typeof f.content === 'string')) {
    const combined = txtFiles.map(f => f.content).join('\n');
    const names = txtFiles.map(f => f.name || 'data.txt');
    const bytes = txtFiles.reduce((s, f) => s + (f.size || f.content.length), 0);
    applyCategoryTxtData(catKey, combined, names, bytes, appendMode);
    return;
  }

  Promise.all(txtFiles.map(file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const decoded = decodeTxt(ev.target.result);
      resolve({ name: file.name, size: file.size || 0, text: decoded.text });
    };
    reader.onerror = () => reject(new Error(`读取文件 ${file.name} 失败`));
    reader.readAsArrayBuffer(file);
  }))).then(results => {
    const combined = results.map(r => r.text).join('\n');
    const names = results.map(r => r.name);
    const bytes = results.reduce((s, r) => s + r.size, 0);
    applyCategoryTxtData(catKey, combined, names, bytes, appendMode);
  }).catch(err => {
    alert(err.message || '读取 .txt 文件失败');
  });
}

function applyCategoryTxtData(catKey, text, names, bytes, appendMode = false) {
  const prev = State.dataInputs[catKey];
  const mergedText = (appendMode && prev && prev.text) ? (prev.text + '\n' + text) : text;
  const mergedNames = (appendMode && prev && prev.fileNames && prev.fileNames.length)
    ? prev.fileNames.concat(names)
    : names;
  const mergedBytes = (appendMode && prev ? (prev.totalBytes || 0) : 0) + (bytes || 0);

  State.dataInputs[catKey] = {
    text: mergedText,
    fileNames: mergedNames,
    totalBytes: mergedBytes,
    statsText: summarizeCategoryElements(catKey, mergedText)
  };

  renderDataIngestionBoxes();
  if (typeof showToast === 'function') {
    showToast(`已导入 ${DATA_CAT_META[catKey].label} (${names.join(', ')})，正在执行检查...`);
  }
  runMasterInspection();
}

function clearCategoryData(catKey, ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  if (!State.dataInputs[catKey]) return;
  State.dataInputs[catKey] = { text: '', fileNames: [], totalBytes: 0, statsText: '' };

  const anyLeft = ['trace', 'constraint', 'dfmFanout', 'pour'].some(k => Boolean(State.dataInputs[k].text && State.dataInputs[k].text.trim()));
  if (anyLeft) {
    runMasterInspection();
  } else {
    clearUnifiedData();
  }
}

// 兼容旧接口名称：默认映射到 DFM与扇出数据框（仅接收 .txt）
function handleDataFileUpload(e) {
  handleCategoryTxtUpload('dfmFanout', e, false);
}

// 综合全套样本数据 (分别载入四类 TXT 数据框并执行全量体检)

function clearUnifiedData() {
  ['trace', 'constraint', 'dfmFanout', 'pour'].forEach(k => {
    State.dataInputs[k] = { text: '', fileNames: [], totalBytes: 0, statsText: '' };
  });
  State.rawText = '';
  State.elements = { vias: [], traces: [], shapes: [], layers: [] };
  State.allChecks = [];
  State.results = {
    trace:  { pass: true, checks: [], score: 100, hasData: false },
    copper: { pass: true, checks: [], score: 100, hasData: false },
    dfm:    { pass: true, checks: [], score: 100, hasData: false },
    fanout: { pass: true, checks: [], score: 100, hasData: false },
    pour:   { pass: true, checks: [], score: 100, hasData: false }
  };
  if ($('kpiViaCount')) $('kpiViaCount').textContent = '0';
  if ($('kpiTraceCount')) $('kpiTraceCount').textContent = '0';
  if ($('kpiShapeCount')) $('kpiShapeCount').textContent = '0';
  renderDataIngestionBoxes();
  updateMasterKPIs();
  renderDashboard();
  renderMasterDefectsTable();
  renderModularViews();
  safeRAF(() => renderCanvas());
}

