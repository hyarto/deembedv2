/* ============================================================================
 * unified-fanout-batch.js —— 综合一体化工作台：批量 EDA TXT 扇出方案识别与导入弹窗
 * ========================================================================== */
function parseMultiSchemeTxt(text, existingCount = 0) {
  return FanoutChecker.parseMultiSchemeTxt(text, existingCount);
}

function openBatchFanoutModal() {
  const modal = $('modalBatchFanout');
  if (modal) {
    modal.style.display = 'flex';
    parseBatchFanoutInput();
  }
}

function closeBatchFanoutModal() {
  const modal = $('modalBatchFanout');
  if (modal) modal.style.display = 'none';
}

function loadBatchFanoutSample() {
  const sampleTxt = `方案一：SMA-L2高速差分扇出
Item 1 < Via >
Origin-xy: [ 17890.3000, 36461.6800 ]
Padstack Name: SMA-HDI-GND-045drill-ring3_L1_L5
Net: GND
Circle Drill: 3.94

Item 2 < Via >
Origin-xy: [ 17867.6300, 36486.9300 ]
Padstack Name: SMA-HDI-SIG-045drill-ring3_L1_L4
Net: 25_P
Circle Drill: 3.94

Item 3 < Via >
Origin-xy: [ 17863.0100, 36494.0600 ]
Padstack Name: SMA-HDI-SIG-045drill-ring3_L1_L4
Net: 25_N
Circle Drill: 3.94

Item 4 < Via >
Origin-xy: [ 17862.1800, 36502.5200 ]
Padstack Name: SMA-HDI-GND-045drill-ring3_L1_L5
Net: GND
Circle Drill: 3.94

~~~end~~~

方案二：BGA-SMA-05PITCH-L4差分扇出
Item 1 < Via >
Origin-xy: [ 21025.1600, 33312.8417 ]
Padstack Name: BGA-HDI-GND-045drill-ring3_L2_L5
Net: GND
Circle Drill: 3.94

Item 2 < Via >
Origin-xy: [ 21020.9001, 33299.7355 ]
Padstack Name: BGA-HDI-SIG-045drill-ring3_L1_L4
Net: 25_N
Circle Drill: 3.94

Item 3 < Via >
Origin-xy: [ 21040.5852, 33299.7355 ]
Padstack Name: BGA-HDI-SIG-045drill-ring3_L1_L4
Net: 25_P
Circle Drill: 3.94

Item 4 < Via >
Origin-xy: [ 21016.6403, 33312.8417 ]
Padstack Name: BGA-HDI-GND-045drill-ring3_L2_L5
Net: GND
Circle Drill: 3.94

~~~end~~~

方案三：BGA-TZ-08PITCH-L4扇出
Item 1 < Via >
Origin-xy: [ 22000.0000, 35000.0000 ]
Padstack Name: PTH-GND-150drill-ring0_L5_L10
Net: GND
Circle Drill: 5.9

Item 2 < Via >
Origin-xy: [ 22031.5000, 35000.0000 ]
Padstack Name: BGA-HDI-SIG-045drill-ring3_L1_L4
Net: 30_P
Circle Drill: 3.94

Item 3 < Via >
Origin-xy: [ 22031.5000, 35031.5000 ]
Padstack Name: BGA-HDI-SIG-045drill-ring3_L1_L4
Net: 30_N
Circle Drill: 3.94

Item 4 < Via >
Origin-xy: [ 22000.0000, 35031.5000 ]
Padstack Name: PTH-GND-150drill-ring0_L5_L10
Net: GND
Circle Drill: 5.9

~~~end~~~`;

  if ($('txtBatchFanoutInput')) $('txtBatchFanoutInput').value = sampleTxt;
  parseBatchFanoutInput();
}

function handleBatchFanoutTxtFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const decoded = decodeTxt(ev.target.result);
    if ($('txtBatchFanoutInput')) $('txtBatchFanoutInput').value = decoded.text;
    parseBatchFanoutInput();
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
}

function parseBatchFanoutInput() {
  const txt = $('txtBatchFanoutInput') ? $('txtBatchFanoutInput').value : '';
  const existingCount = State.rules.fanoutSchemes ? State.rules.fanoutSchemes.length : 0;
  
  if (typeof FanoutChecker !== 'undefined' && FanoutChecker.parseMultiSchemeTxt) {
    g_parsedBatchSchemes = FanoutChecker.parseMultiSchemeTxt(txt, existingCount);
  } else {
    g_parsedBatchSchemes = parseMultiSchemeTxt(txt, existingCount);
  }

  renderBatchFanoutPreview();
}

function renderBatchFanoutPreview() {
  const container = $('pnlBatchFanoutPreview');
  const countEl = $('lblBatchFanoutCount');
  const btnConfirm = $('btnConfirmBatchFanout');
  if (!container) return;

  const totalVias = g_parsedBatchSchemes.reduce((sum, s) => sum + (s.vias ? s.vias.length : 0), 0);

  if (countEl) {
    countEl.textContent = `解析结果预览：${g_parsedBatchSchemes.length} 套方案，${totalVias} 个过孔`;
  }

  if (btnConfirm) {
    btnConfirm.disabled = g_parsedBatchSchemes.length === 0;
    btnConfirm.textContent = `确认导入 ${g_parsedBatchSchemes.length} 套方案`;
  }

  if (g_parsedBatchSchemes.length === 0) {
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#94a3b8">暂无解析方案，请在上方粘贴数据或上传 TXT 文件，方案间用 ~~~end~~~ 分隔</div>';
    return;
  }

  container.innerHTML = g_parsedBatchSchemes.map((s, idx) => {
    const sigCount = (s.vias || []).filter(v => v.role === '信号孔' || v.type === 'signal').length;
    const gndCount = (s.vias || []).filter(v => v.role === '伴随地孔' || v.type === 'gnd').length;
    const padstacks = Array.from(new Set((s.vias || []).map(v => v.padstack))).filter(Boolean);

    return `
      <div style="background:#ffffff;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;box-shadow:0 1px 2px rgba(0,0,0,0.05)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px">
          <input type="text" value="${s.name}" oninput="g_parsedBatchSchemes[${idx}].name=this.value" style="font-size:12px;font-weight:700;color:#111827;width:100%;border:1px solid #e3e8ef;padding:2px 4px;border-radius:4px" placeholder="方案名称">
          <span style="font-size:11px;color:#7c3aed;background:#f3e8ff;padding:1px 5px;border-radius:3px;white-space:nowrap">${s.vias.length} 孔</span>
        </div>
        <div style="font-size:11px;color:#6b7280;margin-bottom:3px">
          <span style="color:#2563eb;font-weight:600">${sigCount} 信号孔</span> + <span style="color:#6b7280">${gndCount} 伴随地孔</span>
        </div>
        <div style="font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${padstacks.join(', ')}">
          Padstack: ${padstacks.slice(0, 2).join(', ')}${padstacks.length > 2 ? ' 等' : ''}
        </div>
      </div>
    `;
  }).join('');
}

function confirmBatchFanoutImport() {
  if (g_parsedBatchSchemes.length === 0) return;

  const isOverwrite = $('radBatchOverwrite') && $('radBatchOverwrite').checked;
  if (isOverwrite) {
    State.rules.fanoutSchemes = [...g_parsedBatchSchemes];
  } else {
    State.rules.fanoutSchemes = (State.rules.fanoutSchemes || []).concat(g_parsedBatchSchemes);
  }

  renderFanoutSchemesGrid();
  closeBatchFanoutModal();
  showToast(`已导入 ${g_parsedBatchSchemes.length} 套方案，方案库共 ${State.rules.fanoutSchemes.length} 套`);
}

