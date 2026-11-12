/* ============================================================================
 * unified-rules-dfm.js —— DFM 规则：预设、分层规则与历史选值
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
// =========================================================================
// DFM Inspection Presets & History Chips (Matching image-1.png)
// =========================================================================
function readUnifiedPadShapes() {
  const kind = $('selUnifiedPadShape')?.value || 'circle';
  const gndD = parseFloat($('inpGndPadDiam')?.value) || 7.906;
  const sigD = parseFloat($('inpSignalPadDiam')?.value) || 12;
  const corner = parseFloat($('inpUnifiedPadCorner')?.value) || 0;
  const rot = parseFloat($('inpUnifiedPadRot')?.value) || 0;
  if (kind === 'circle') return { gndPad: { kind: 'circle', w: gndD }, signalPad: { kind: 'circle', w: sigD } };
  return {
    gndPad: { kind, w: parseFloat($('inpUnifiedGndPadW')?.value) || gndD, h: parseFloat($('inpUnifiedGndPadH')?.value) || gndD, corner, rot },
    signalPad: { kind, w: parseFloat($('inpUnifiedSigPadW')?.value) || sigD, h: parseFloat($('inpUnifiedSigPadH')?.value) || sigD, corner, rot }
  };
}

const UnifiedDfmLayerRules = {
  key: 'pcb.unified.dfm.layerRules.v1',
  rows: [],
  load() {
    try { const value = JSON.parse(localStorage.getItem(this.key) || '[]'); this.rows = Array.isArray(value) ? value : []; }
    catch (_) { this.rows = []; }
    this.render();
  },
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.rows)); } catch (_) {}
  },
  render() {
    const body = $('unifiedLayerRuleBody');
    if (!body) return;
    body.innerHTML = this.rows.map((r, i) => `<tr>
      <td><input type="text" value="${escHtml(r.layers || '')}" placeholder="Top、Bot / 内层 / L2-L5" oninput="UnifiedDfmLayerRules.rows[${i}].layers=this.value;UnifiedDfmLayerRules.save()"></td>
      <td><input type="number" value="${r.gnd != null && r.gnd !== '' && Number.isFinite(Number(r.gnd)) ? r.gnd : ''}" step="0.00001" min="0" oninput="UnifiedDfmLayerRules.rows[${i}].gnd=this.value===''?null:Number(this.value);UnifiedDfmLayerRules.save()"></td>
      <td><input type="number" value="${r.sig != null && r.sig !== '' && Number.isFinite(Number(r.sig)) ? r.sig : ''}" step="0.00001" min="0" oninput="UnifiedDfmLayerRules.rows[${i}].sig=this.value===''?null:Number(this.value);UnifiedDfmLayerRules.save()"></td>
      <td><input type="number" value="${r.pad != null && r.pad !== '' && Number.isFinite(Number(r.pad)) ? r.pad : ''}" step="0.00001" min="0" oninput="UnifiedDfmLayerRules.rows[${i}].pad=this.value===''?null:Number(this.value);UnifiedDfmLayerRules.save()"></td>
      <td><button type="button" class="btn danger small" onclick="UnifiedDfmLayerRules.remove(${i})">删除</button></td></tr>`).join('');
    const hint = $('unifiedLayerRuleHint');
    if (hint) hint.textContent = this.rows.length ? `${this.rows.length} 条分层规则，同层靠上优先，孔盘间距取重叠层最严值` : '未设置分层规则时，所有层使用默认阈值。';
  },
  add(row = {}) { this.rows.push({ layers: row.layers || '', gnd: row.gnd ?? null, sig: row.sig ?? null, pad: row.pad ?? null }); this.save(); this.render(); },
  remove(i) { this.rows.splice(i, 1); this.save(); this.render(); },
  template() {
    const g = parseFloat($('inpThresholdGnd')?.value) || 4.01575;
    const s = parseFloat($('inpThresholdSignal')?.value) || 5.04725;
    const p = parseFloat($('inpThresholdPadPair')?.value) || 6;
    this.rows = [{ layers: 'Top、Bot', gnd: g, sig: s, pad: p }, { layers: '内层', gnd: g, sig: s, pad: p }];
    this.save(); this.render();
  },
  read() { const numberOrUndefined = v => v == null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v); return this.rows.map(r => ({ layers: r.layers, minClearanceGnd: numberOrUndefined(r.gnd), minClearanceSignal: numberOrUndefined(r.sig), minClearancePadPair: numberOrUndefined(r.pad) })); },
  init() {
    this.load();
    try { const d = JSON.parse(localStorage.getItem(this.key + '.defaults') || '{}'); if (d.gnd) $('inpThresholdGnd').value = d.gnd; if (d.sig) $('inpThresholdSignal').value = d.sig; if (d.pad) $('inpThresholdPadPair').value = d.pad; } catch (_) {}
    ['inpThresholdGnd','inpThresholdSignal','inpThresholdPadPair'].forEach(id => $(id)?.addEventListener('change', () => this.saveDefaults()));
  },
  saveDefaults() {
    try { localStorage.setItem(this.key + '.defaults', JSON.stringify({ gnd: $('inpThresholdGnd').value, sig: $('inpThresholdSignal').value, pad: $('inpThresholdPadPair').value })); } catch (_) {}
  }
};

function applyDfmPreset(key) {
  if (key === 'current_eda') {
    fillInput('inpThresholdGnd', '4.01575');
    fillInput('inpThresholdSignal', '5.04725');
    fillInput('inpThresholdPadPair', '6.0');
    if ($('selDfmMode')) $('selDfmMode').value = 'pad_to_trace';
    fillInput('inpGndPadDiam', '7.906');
    fillInput('inpSignalPadDiam', '12.0');
    fillInput('inpGndDrillDiam', '6.0');
    fillInput('inpSignalDrillDiam', '6.0');
    if ($('selDfmNetScope')) $('selDfmNetScope').value = 'diff_net';
    showToast('已载入当前 EDA 工程配置：线到地 4.02、线到信号 5.05、GND 盘 7.91、信号盘 12');
  } else if (key === 'std_6mil') {
    fillInput('inpThresholdGnd', '6.0');
    fillInput('inpThresholdSignal', '6.0');
    fillInput('inpThresholdPadPair', '6.0');
    if ($('selDfmMode')) $('selDfmMode').value = 'pad_to_trace';
    fillInput('inpGndPadDiam', '8.0');
    fillInput('inpSignalPadDiam', '12.0');
    fillInput('inpGndDrillDiam', '6.0');
    fillInput('inpSignalDrillDiam', '6.0');
    showToast('已载入 6.0 mil 标准制造能力规则');
  } else if (key === 'high_density_5mil') {
    fillInput('inpThresholdGnd', '5.0');
    fillInput('inpThresholdSignal', '5.0');
    fillInput('inpThresholdPadPair', '5.0');
    if ($('selDfmMode')) $('selDfmMode').value = 'pad_to_trace';
    fillInput('inpGndPadDiam', '7.0');
    fillInput('inpSignalPadDiam', '10.0');
    fillInput('inpGndDrillDiam', '5.0');
    fillInput('inpSignalDrillDiam', '5.0');
    showToast('已载入 5.0 mil 高密制造能力规则');
  }
}

function recordHistoryChip(key, val) {
  // Optional history chips recorder
}

