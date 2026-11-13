/* ============================================================================
 * unified-rules-render.js —— 规则区渲染与各引擎规则行增删
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
/**
 * 渲染全套规则配置 UI
 */

function renderRulesUI() {
  renderFanoutSchemesGrid();
  // 1. Trace Layer Rules Table
  const tbodyTrace = $('tblTraceLayerRulesBody');
  if (tbodyTrace) {
    tbodyTrace.innerHTML = State.rules.traceLayers.map((r, i) => `
      <tr>
        <td><b>${escHtml(r.layer)}</b></td>
        <td><input type="text" value="${r.combos || ''}" onchange="State.rules.traceLayers[${i}].combos=this.value" style="width:100%"></td>
        <td><input type="text" value="${r.lenRange || ''}" onchange="State.rules.traceLayers[${i}].lenRange=this.value" style="width:95px"></td>
        <td><input type="number" value="${r.diffLayerTol != null ? r.diffLayerTol : 0.5}" step="0.1" onchange="State.rules.traceLayers[${i}].diffLayerTol=parseFloat(this.value)" style="width:75px"> mil</td>
        <td><input type="text" value="${r.specificRule || ''}" onchange="State.rules.traceLayers[${i}].specificRule=this.value" style="width:100px"></td>
        <td><input type="number" value="${r.minArc || 18}" step="0.1" onchange="State.rules.traceLayers[${i}].minArc=parseFloat(this.value)" style="width:65px"></td>
        <td style="text-align:center"><button class="btn danger small" style="padding:2px 8px;font-size:12px" onclick="deleteTraceLayerRule(${i})">删除</button></td>
      </tr>
    `).join('');
  }

  // 2. Constraint Sets & Guide Navigation (image-2.png)
  renderJump();
  renderConstraintSets();

  // 4. Fanout Schemes Library
  const pnlFanout = $('pnlFanoutSchemeList');
  if (pnlFanout) {
    const list = State.rules.fanoutSchemes || [];
    if (list.length === 0) {
      pnlFanout.innerHTML = '<span style="color:#6b7280">方案库为空，请点击「导入方案库 JSON」或恢复预设</span>';
    } else {
      pnlFanout.innerHTML = list.map((sc, i) => {
        const viaCnt = (sc.vias && Array.isArray(sc.vias)) ? sc.vias.length : (sc.viaCount || '?');
        return `
          <div style="background:#ffffff;border:1px solid #cbd5e1;padding:4px 10px;border-radius:6px;display:flex;align-items:center;gap:8px">
            <span style="font-weight:700;color:#2563eb">#${i+1} ${sc.name || `扇出方案_${i+1}`}</span>
            <span class="tag-badge info">${sc.category || '通用扇出'}</span>
            <span class="tag-badge ok" style="font-size:11px">${viaCnt} 孔</span>
            <button class="btn danger small" style="padding:2px 8px;font-size:12px" onclick="deleteFanoutScheme(${i})">删除</button>
            <button class="btn primary small" style="padding:2px 8px;font-size:12px" onclick="viewFanoutScheme(${i})">查看</button>
          </div>
        `;
      }).join('');
    }
  }

  // 5. Pour Rules Tables
  // Rule 1: Via Coverage
  const tbodyPour1 = $('tblPourRule1Body');
  if (tbodyPour1) {
    tbodyPour1.innerHTML = State.rules.pourRule1.map((r, i) => `
      <tr>
        <td><input type="text" value="${r.padstack}" onchange="State.rules.pourRule1[${i}].padstack=this.value" style="width:110px"></td>
        <td><input type="text" value="${r.layers}" onchange="State.rules.pourRule1[${i}].layers=this.value" style="width:100%"></td>
        <td><input type="number" value="${r.radius}" step="1" onchange="State.rules.pourRule1[${i}].radius=parseFloat(this.value)" style="width:70px"> mil</td>
        <td style="text-align:center"><button class="btn danger small" style="padding:2px 8px;font-size:12px" onclick="deletePourRule1(${i})">删除</button></td>
      </tr>
    `).join('');
  }

  // Rule 2: Special Shaped Copper Template Matching (Matching image-1.png)
  const tbodyPour2 = $('tblPourRule2Body');
  const badgePour2 = $('badgePourRule2Count');
  const r2List = State.rules.specialShapeTemplates || [
    {
      id: 'tmpl_1',
      name: 'L2特定异型铜皮_1',
      padstack: 'BGA_3510',
      layer: '02G01P',
      expectedArea: 452.4,
      areaTolerance: 30.0
    }
  ];
  if (badgePour2) badgePour2.textContent = `${r2List.length} 条规则`;
  if (tbodyPour2) {
    if (r2List.length === 0) {
      tbodyPour2.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:#6b7280">暂未配置异型铜皮模板。可点击上方「导入异型铜皮模板」或下方「新增模板规则」。</td></tr>`;
    } else {
      tbodyPour2.innerHTML = r2List.map((r, i) => `
        <tr>
          <td style="font-weight:700;color:#6b7280">#${i + 1}</td>
          <td>
            <div style="width:48px;height:48px;background:#0b1120;border-radius:6px;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 4px rgba(0,0,0,0.5)">
              <svg width="34" height="34" viewBox="0 0 34 34">
                <circle cx="17" cy="17" r="13" fill="none" stroke="#d97706" stroke-width="2"/>
                <circle cx="17" cy="17" r="3.5" fill="#10b981"/>
              </svg>
            </div>
          </td>
          <td>
            <input type="text" value="${r.name || `异型铜皮_${i+1}`}" onchange="State.rules.specialShapeTemplates[${i}].name=this.value" style="width:100%;font-weight:600;font-size:12px">
          </td>
          <td>
            <span style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;padding:2px 8px;border-radius:4px;font-weight:600;font-family:var(--mono);display:inline-block">
              <input type="text" value="${r.padstack || 'BGA_3510'}" onchange="State.rules.specialShapeTemplates[${i}].padstack=this.value" style="background:transparent;border:none;color:#92400e;font-weight:700;width:90px;font-family:var(--mono)">
            </span>
          </td>
          <td>
            <span style="background:#f1f5f9;color:#374151;border:1px solid #cbd5e1;padding:2px 8px;border-radius:4px;font-weight:600;font-family:var(--mono);display:inline-block">
              <input type="text" value="${escHtml(r.layer || '02G01P')}" onchange="State.rules.specialShapeTemplates[${i}].layer=this.value" style="background:transparent;border:none;color:#374151;font-weight:700;width:65px;font-family:var(--mono)">
            </span>
          </td>
          <td style="font-family:var(--mono);font-size:12px;font-weight:600;color:#111827">
            <input type="number" step="0.1" value="${r.expectedArea || 452.4}" onchange="State.rules.specialShapeTemplates[${i}].expectedArea=parseFloat(this.value)" style="width:65px"> sq mil (±<input type="number" step="1" value="${r.areaTolerance || 30}" onchange="State.rules.specialShapeTemplates[${i}].areaTolerance=parseFloat(this.value)" style="width:40px">)
          </td>
          <td style="text-align:right">
            <button class="btn sec small" style="padding:2px 6px;font-size:11px" onclick="editPourShapeTemplate(${i})">编辑</button>
            <button class="btn danger small" style="padding:2px 6px;margin-left:4px" onclick="deletePourShapeTemplate(${i})">删除</button>
          </td>
        </tr>
      `).join('');
    }
  }

  // Rule 3: Trace Margin
  const tbodyPour3 = $('tblPourRule3Body');
  if (tbodyPour3) {
    tbodyPour3.innerHTML = State.rules.pourRule3.map((r, i) => `
      <tr>
        <td><input type="text" value="${r.traceLayer}" onchange="State.rules.pourRule3[${i}].traceLayer=this.value" style="width:90px"></td>
        <td><input type="text" value="${r.upperRef}" onchange="State.rules.pourRule3[${i}].upperRef=this.value" style="width:90px"></td>
        <td><input type="text" value="${r.lowerRef}" onchange="State.rules.pourRule3[${i}].lowerRef=this.value" style="width:90px"></td>
        <td><input type="number" value="${r.margin}" step="1" onchange="State.rules.pourRule3[${i}].margin=parseFloat(this.value)" style="width:70px"> mil</td>
        <td style="text-align:center"><button class="btn danger small" style="padding:2px 8px;font-size:12px" onclick="deletePourRule3(${i})">删除</button></td>
      </tr>
    `).join('');
  }
}

function addTraceLayerRuleRow() {
  State.rules.traceLayers.push({
    layer: `L_NEW_${State.rules.traceLayers.length + 1}`,
    combos: '5.6, 6.0',
    lenRange: '500-2500',
    diffLayerTol: 0.5,
    specificRule: '',
    minArc: 18.0
  });
  renderRulesUI();
}

function deleteTraceLayerRule(i) {
  State.rules.traceLayers.splice(i, 1);
  renderRulesUI();
}

function addPourRule1Row() {
  State.rules.pourRule1.push({ id: `pour_r1_${Date.now()}`, padstack: 'VIA_*', layers: 'L1-L21', radius: 50.0 });
  renderRulesUI();
}
function deletePourRule1(i) {
  State.rules.pourRule1.splice(i, 1);
  renderRulesUI();
}

function addPourRule2Row() {
  if (!State.rules.specialShapeTemplates) State.rules.specialShapeTemplates = [];
  State.rules.specialShapeTemplates.push({
    id: `tmpl_${Date.now()}`,
    name: `新增异型铜皮_${State.rules.specialShapeTemplates.length + 1}`,
    padstack: 'BGA_3510',
    layer: '02G01P',
    expectedArea: 452.4,
    areaTolerance: 30.0
  });
  renderRulesUI();
}

function deletePourShapeTemplate(i) {
  if (State.rules.specialShapeTemplates) {
    State.rules.specialShapeTemplates.splice(i, 1);
    renderRulesUI();
  }
}



function addPourRule3Row() {
  State.rules.pourRule3.push({ id: `pour_r3_${Date.now()}`, traceLayer: '02G01P', upperRef: '01TOP', lowerRef: '03G02P', margin: 50.0 });
  renderRulesUI();
}
function deletePourRule3(i) {
  State.rules.pourRule3.splice(i, 1);
  renderRulesUI();
}

function extractLayerCombosFromData() {
  const traceTxt = (State.dataInputs && State.dataInputs.trace && State.dataInputs.trace.text) ? State.dataInputs.trace.text.trim() : '';
  const parsedTraceOnly = (traceTxt && typeof PourChecker !== 'undefined' && PourChecker.parsePcbElements)
    ? PourChecker.parsePcbElements(traceTxt)
    : null;
  const traces = (parsedTraceOnly && parsedTraceOnly.traces.length) ? parsedTraceOnly.traces : State.elements.traces;
  if (!traces || !traces.length) {
    alert('请先在走线检查数据框导入含 Trace 的 .txt 文件');
    return;
  }
  const map = {};
  traces.forEach(t => {
    if (!map[t.layer]) map[t.layer] = new Set();
    const widths = t.segments.map(s => s.width).filter(Boolean);
    if (widths.length) map[t.layer].add(widths.join('-'));
  });
  State.rules.traceLayers = Object.keys(map).map(l => ({
    layer: l,
    combos: Array.from(map[l]).join(', '),
    lenRange: '500-3000',
    diffLayerTol: 0.5,
    specificRule: '',
    minArc: 18.0
  }));
  renderRulesUI();
  showToast('已从走线检查数据中提取各层实际线宽组合并填充规则');
}

/**
 * =========================================================================
 * 启动全套 5 大引擎综合体检 (Run All)
 * =========================================================================
 */

