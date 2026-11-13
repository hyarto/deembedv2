/* ============================================================================
 * unified-fanout-library.js —— 扇出方案库：方案卡片、星座缩略图、编辑与批量导入
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
// =========================================================================
// Fanout Pattern Schemes Management & SVG Constellations (Matching image-1.png & image-2.png)
// =========================================================================

function generateConstellationSVG(vias) {
  if (!vias || vias.length === 0) {
    return `<svg width="120" height="120" viewBox="0 0 120 120" style="background:#0f172a;border-radius:6px"><rect width="120" height="120" fill="#0f172a"/><text x="60" y="65" fill="#64748b" font-size="11" text-anchor="middle">无过孔数据</text></svg>`;
  }

  const xs = vias.map(v => parseFloat(v.x) || 0);
  const ys = vias.map(v => parseFloat(v.y) || 0);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1.0);
  const spanY = Math.max(maxY - minY, 1.0);
  const span = Math.max(spanX, spanY);

  const midX = (minX + maxX) / 2.0;
  const midY = (minY + maxY) / 2.0;

  const tx = x => 60 + (((parseFloat(x)||0) - midX) / span) * 76;
  const ty = y => 60 - (((parseFloat(y)||0) - midY) / span) * 76;

  let lines = '';
  for (let i = 0; i < vias.length; i++) {
    for (let j = i + 1; j < vias.length; j++) {
      const dx = (parseFloat(vias[i].x)||0) - (parseFloat(vias[j].x)||0);
      const dy = (parseFloat(vias[i].y)||0) - (parseFloat(vias[j].y)||0);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (vias.length <= 10 || dist <= span * 0.65) {
        lines += `<line x1="${tx(vias[i].x).toFixed(1)}" y1="${ty(vias[i].y).toFixed(1)}" x2="${tx(vias[j].x).toFixed(1)}" y2="${ty(vias[j].y).toFixed(1)}" stroke="rgba(56, 189, 248, 0.28)" stroke-dasharray="2,2" stroke-width="1"/>`;
      }
    }
  }

  let circles = '';
  const allSchemes = (State && State.rules && Array.isArray(State.rules.fanoutSchemes)) ? State.rules.fanoutSchemes : [];
  if (typeof FanoutChecker !== 'undefined' && FanoutChecker.syncLibraryPadstackColors) {
    FanoutChecker.syncLibraryPadstackColors(allSchemes);
  }
  const padColorMap = (typeof FanoutChecker !== 'undefined' && FanoutChecker.buildPadstackColorMap)
    ? FanoutChecker.buildPadstackColorMap(vias, allSchemes).map
    : {};
  vias.forEach(v => {
    const cx = tx(v.x).toFixed(1);
    const cy = ty(v.y).toFixed(1);
    const isSig = (typeof FanoutChecker !== 'undefined' && FanoutChecker.isSignalVia)
      ? FanoutChecker.isSignalVia(v)
      : (v.type === 'signal' || (v.role && v.role.toLowerCase().includes('sig')));
    const pCol = padColorMap[String(v.padstack || 'VIA_PAD')]
      || ((typeof FanoutChecker !== 'undefined' && FanoutChecker.getPadstackColorEntry) ? FanoutChecker.getPadstackColorEntry(v.padstack) : null);
    const fillCol = pCol ? pCol.fill : (isSig ? '#38bdf8' : '#10b981');
    circles += `<circle cx="${cx}" cy="${cy}" r="6.5" fill="${fillCol}" stroke="#ffffff" stroke-width="1.3"/>`;
    circles += `<circle cx="${cx}" cy="${cy}" r="2.6" fill="#0f172a"/>`;
  });

  return `<svg width="120" height="120" viewBox="0 0 120 120" style="background:#0f172a;border-radius:6px;flex-shrink:0"><rect width="120" height="120" fill="#0f172a"/>${lines}${circles}</svg>`;
}

function calculatePitchRange(vias) {
  if (!vias || vias.length < 2) return '0.0 ~ 0.0 mil';
  const dists = [];
  for (let i = 0; i < vias.length; i++) {
    for (let j = i + 1; j < vias.length; j++) {
      const dx = (parseFloat(vias[i].x)||0) - (parseFloat(vias[j].x)||0);
      const dy = (parseFloat(vias[i].y)||0) - (parseFloat(vias[j].y)||0);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0.001) dists.push(d);
    }
  }
  if (!dists.length) return '0.0 ~ 0.0 mil';
  const minD = Math.min(...dists).toFixed(1);
  const maxD = Math.max(...dists).toFixed(1);
  return `${minD} ~ ${maxD} mil`;
}

function summarizePadstacks(vias) {
  if (!vias || !vias.length) return '无焊盘定义';
  const counts = {};
  vias.forEach(v => {
    const p = v.padstack || 'VIA_PAD';
    counts[p] = (counts[p] || 0) + 1;
  });
  return Object.entries(counts).map(([name, count]) => `${name} ×${count}`).join(', ');
}

function summarizePadstacksRich(vias) {
  if (!vias || !vias.length) return '无焊盘定义';
  const counts = {};
  vias.forEach(v => {
    const p = v.padstack || 'VIA_PAD';
    counts[p] = (counts[p] || 0) + 1;
  });
  return Object.entries(counts).map(([name, count]) => {
    const pc = (typeof FanoutChecker !== 'undefined' && FanoutChecker.getPadstackColorEntry)
      ? FanoutChecker.getPadstackColorEntry(name)
      : { fill: '#38bdf8' };
    return `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:6px"><span style="width:8px;height:8px;border-radius:50%;background:${pc.fill};border:1px solid #0f172a;display:inline-block;flex-shrink:0"></span><span>${name} (×${count})</span></span>`;
  }).join('');
}

function renderFanoutSchemesGrid() {
  const container = $('pnlFanoutSchemeGrid');
  if (!container) return;

  if (!State.rules.fanoutSchemes || !State.rules.fanoutSchemes.length) {
    State.rules.fanoutSchemes = getDefaultFanoutPresets();
  }

  if (typeof FanoutChecker !== 'undefined' && FanoutChecker.syncLibraryPadstackColors) {
    FanoutChecker.syncLibraryPadstackColors(State.rules.fanoutSchemes);
  }

  const legendBar = $('pnlUnifiedPadstackLegendBar');
  if (legendBar) {
    const legendItems = (typeof FanoutChecker !== 'undefined' && FanoutChecker.getLibraryPadstackColorLegend && State.rules.fanoutSchemes.length > 0)
      ? FanoutChecker.getLibraryPadstackColorLegend(State.rules.fanoutSchemes)
      : [];
    if (!legendItems.length) {
      legendBar.innerHTML = '';
    } else {
      legendBar.innerHTML = `
        <div style="background:#f8fafc;border:1px solid #e3e8ef;border-radius:8px;padding:7px 11px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:12px;font-weight:700;color:#374151;white-space:nowrap">● Padstack 统一色卡 ${legendItems.length} 种：</span>
          ${legendItems.map(item => `
            <span style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;background:#ffffff;border:1px solid #cbd5e1;font-family:var(--mono);font-size:11px;color:#111827" title="Padstack: ${item.padstack} · 共用于 ${item.schemeCount} 套方案 / ${item.totalVias} 个孔">
              <span style="width:9px;height:9px;border-radius:50%;background:${item.fill};border:1px solid #0f172a;display:inline-block;flex-shrink:0"></span>
              <span style="font-weight:600">${item.padstack}</span>
              <span style="font-size:11px;color:#6b7280">${item.schemeCount} 方案 / ${item.totalVias} 孔</span>
            </span>
          `).join('')}
        </div>
      `;
    }
  }

  container.innerHTML = State.rules.fanoutSchemes.map((sc, idx) => {
    const pitchStr = calculatePitchRange(sc.vias);
    const padStrRich = summarizePadstacksRich(sc.vias);
    const svgThumb = generateConstellationSVG(sc.vias);
    const vCount = sc.vias ? sc.vias.length : (sc.viaCount || 0);

    return `
      <div style="background:#ffffff;border:1px solid #e3e8ef;border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 1px 3px rgba(0,0,0,0.02)">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <div onclick="openUnifiedQuickRenameModal(${idx})" style="font-size:14px;font-weight:700;color:#111827;cursor:pointer" title="点击通过关键词快捷修改方案名称">${sc.name}</div>
              <span onclick="openUnifiedQuickRenameModal(${idx})" title="点击点选关键词快捷修改方案名称" style="cursor:pointer;display:inline-flex;align-items:center;gap:2px;font-size:11px;font-weight:600;color:#1d4ed8;background:#f8fafc;border:1px solid #e3e8ef;border-radius:4px;padding:1px 6px;white-space:nowrap"> 改名</span>
            </div>
            <span style="background:#f1f5f9;color:#6b7280;font-size:12px;padding:2px 8px;border-radius:4px;font-weight:600;white-space:nowrap">${sc.tag || '扇出方案'}</span>
          </div>
          <div style="font-size:13px;color:#6b7280;margin-bottom:10px;line-height:1.4">${sc.desc || ''}</div>

          <div style="display:flex;gap:12px;align-items:center;background:#f8fafc;padding:10px 12px;border-radius:6px;border:1px solid #f1f5f9">
            <div onclick="viewFanoutScheme(${idx})" style="cursor:zoom-in;flex-shrink:0;display:flex" title="点击放大查看方案效果图与逐孔 Padstack 标注">${svgThumb}</div>
            <div style="flex:1;font-size:13px;color:#6b7280;line-height:1.6">
              <div>过孔总数: <b style="color:#111827">${vCount} 个孔</b></div>
              <div>孔中心距范围: <b style="color:#111827">${pitchStr}</b></div>
              <div style="font-size:12px;color:#6b7280;margin-top:2px;word-break:break-all">焊盘: ${padStrRich}</div>
            </div>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9">
          <button class="btn sec small" style="padding:4px 12px" onclick="editFanoutScheme(${idx})">编辑</button>
          <button class="btn danger small" style="padding:4px 12px" onclick="deleteFanoutScheme(${idx})">删除</button>
          <button class="btn primary small" style="padding:4px 12px" onclick="viewFanoutScheme(${idx})">查看</button>
        </div>
      </div>
    `;
  }).join('');
}


let g_editingFanoutSchemeIdx = -1;
let g_modalFanoutVias = [];

function setFanoutViaInputMode(mode) {
  const pnlTxt = $('pnlFanoutViaModeTxt');
  const pnlTbl = $('pnlFanoutViaModeTable');
  const btnTxt = $('btnFanoutModeTxt');
  const btnTbl = $('btnFanoutModeTable');
  if (mode === 'txt') {
    if (pnlTxt) pnlTxt.style.display = 'block';
    if (pnlTbl) pnlTbl.style.display = 'none';
    if (btnTxt) {
      btnTxt.style.background = '#2563eb';
      btnTxt.style.color = '#ffffff';
      btnTxt.style.border = 'none';
    }
    if (btnTbl) {
      btnTbl.style.background = '#ffffff';
      btnTbl.style.color = '#334155';
      btnTbl.style.border = '1px solid #cbd5e1';
    }
    if ($('modalFanoutViaTxt') && !$('modalFanoutViaTxt').value.trim()) {
      $('modalFanoutViaTxt').value = formatViasToEdaTxt(g_modalFanoutVias);
    }
  } else {
    if (pnlTxt) pnlTxt.style.display = 'none';
    if (pnlTbl) pnlTbl.style.display = 'block';
    if (btnTbl) {
      btnTbl.style.background = '#2563eb';
      btnTbl.style.color = '#ffffff';
      btnTbl.style.border = 'none';
    }
    if (btnTxt) {
      btnTxt.style.background = '#ffffff';
      btnTxt.style.color = '#334155';
      btnTxt.style.border = '1px solid #cbd5e1';
    }
    renderModalFanoutViasTable();
  }
}

function formatViasToEdaTxt(vias) {
  if (!vias || !vias.length) return '';
  return vias.map((v, i) => {
    const net = (v.role === 'Signal' || v.type === 'signal') ? 'SIG' : 'GND';
    const x = (parseFloat(v.x) || 0).toFixed(1);
    const y = (parseFloat(v.y) || 0).toFixed(1);
    const pad = v.padstack || (net === 'SIG' ? 'SMA_Bot-L19_d2m6mil_via-0902' : 'BGA_GND_pad1mil_0902');
    return `Item ${i + 1}  < Via >\n  Origin-xy: [${x}, ${y}]\n  Padstack Name: ${pad}\n  Net: ${net}`;
  }).join('\n');
}

function parseModalFanoutViaTxt() {
  const txt = $('modalFanoutViaTxt') ? $('modalFanoutViaTxt').value : '';
  if (!txt.trim()) return;

  const items = txt.split(/(?=Item\s+\d+)/i).filter(s => s.trim());
  const parsed = [];

  items.forEach((block, idx) => {
    const mOrigin = block.match(/Origin-xy:\s*\[\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\]/i);
    const mPad = block.match(/Padstack\s+Name:\s*([^\r\n]+)/i);
    const mNet = block.match(/Net:\s*([^\r\n]+)/i);

    if (mOrigin) {
      const rawX = parseFloat(mOrigin[1]) || 0;
      const rawY = parseFloat(mOrigin[2]) || 0;
      const padstack = mPad ? mPad[1].trim() : 'BGA_GND_pad1mil_0902';
      const net = mNet ? mNet[1].trim() : '';
      
      const isGnd = net.toUpperCase().includes('GND') || padstack.toUpperCase().includes('GND');
      const role = isGnd ? 'GND' : 'Signal';
      const type = isGnd ? 'gnd' : 'signal';

      parsed.push({
        id: `v_${idx + 1}`,
        rawX,
        rawY,
        x: rawX,
        y: rawY,
        padstack,
        net,
        role,
        type
      });
    }
  });

  if (parsed.length >= 2) {
    const base = parsed.find(v => v.type === 'signal') || parsed[0];
    const bx = base.rawX;
    const by = base.rawY;

    parsed.forEach(v => {
      v.x = Math.round((v.rawX - bx) * 100) / 100;
      v.y = Math.round((v.rawY - by) * 100) / 100;
    });

    g_modalFanoutVias = parsed;
    renderModalFanoutViasTable();
    updateModalFanoutPreview();
  }
}

function renderModalFanoutViasTable() {
  const tbody = $('tblModalFanoutViasBody');
  if (!tbody) return;

  tbody.innerHTML = g_modalFanoutVias.map((v, i) => `
    <tr>
      <td style="font-weight:600;color:#6b7280">${i + 1}</td>
      <td>
        <select onchange="g_modalFanoutVias[${i}].role=this.value;g_modalFanoutVias[${i}].type=(this.value==='Signal'?'signal':'gnd');updateModalFanoutPreview()" style="width:100%">
          <option value="Signal" ${v.role === 'Signal' || v.type === 'signal' ? 'selected' : ''}>信号孔</option>
          <option value="GND" ${v.role === 'GND' || v.type === 'gnd' ? 'selected' : ''}>地孔 (GND)</option>
        </select>
      </td>
      <td><input type="number" value="${v.x}" step="0.5" onchange="g_modalFanoutVias[${i}].x=parseFloat(this.value)||0;updateModalFanoutPreview()" style="width:100%"></td>
      <td><input type="number" value="${v.y}" step="0.5" onchange="g_modalFanoutVias[${i}].y=parseFloat(this.value)||0;updateModalFanoutPreview()" style="width:100%"></td>
      <td><input type="text" value="${v.padstack || ''}" onchange="g_modalFanoutVias[${i}].padstack=this.value;updateModalFanoutPreview()" style="width:100%" placeholder="Padstack Name"></td>
      <td style="text-align:center"><button class="btn danger small" style="padding:2px 8px;font-size:12px" onclick="deleteModalFanoutViaRow(${i})">删除</button></td>
    </tr>
  `).join('');
}

function addModalFanoutViaRow() {
  g_modalFanoutVias.push({
    id: `v_${Date.now()}`,
    role: 'GND',
    type: 'gnd',
    x: 0,
    y: 0,
    padstack: 'BGA_GND_pad1mil_0902'
  });
  renderModalFanoutViasTable();
  updateModalFanoutPreview();
}

function deleteModalFanoutViaRow(i) {
  g_modalFanoutVias.splice(i, 1);
  renderModalFanoutViasTable();
  updateModalFanoutPreview();
}

function updateModalFanoutPreview() {
  const box = $('modalFanoutConstellationBox');
  const stats = $('modalFanoutPreviewStats');
  if (box) {
    box.innerHTML = generateConstellationSVG(g_modalFanoutVias);
  }
  if (stats) {
    const pitchStr = calculatePitchRange(g_modalFanoutVias);
    const xs = g_modalFanoutVias.map(v => parseFloat(v.x) || 0);
    const ys = g_modalFanoutVias.map(v => parseFloat(v.y) || 0);
    const spanX = xs.length ? (Math.max(...xs) - Math.min(...xs)).toFixed(1) : '0.0';
    const spanY = ys.length ? (Math.max(...ys) - Math.min(...ys)).toFixed(1) : '0.0';
    stats.innerHTML = `
      过孔总数: <b style="color:#ffffff">${g_modalFanoutVias.length} 个孔</b> | 拓扑跨度: ${spanX} × ${spanY} mil<br>
      孔中心距范围: <b style="color:#38bdf8">${pitchStr}</b>
    `;
  }
}


let g_parsedBatchSchemes = [];


function openFanoutSchemeModal(idx = -1) {
  g_editingFanoutSchemeIdx = idx;
  const modal = $('modalFanoutScheme');
  if (!modal) return;

  if (idx >= 0 && State.rules.fanoutSchemes[idx]) {
    const sc = State.rules.fanoutSchemes[idx];
    $('modalFanoutTitle').textContent = `编辑扇出方案 - ${sc.name}`;
    $('modalFanoutInpName').value = sc.name || '';
    $('modalFanoutInpTag').value = sc.tag || '通用扇出';
    g_modalFanoutVias = JSON.parse(JSON.stringify(sc.vias || []));
  } else {
    $('modalFanoutTitle').textContent = '新建扇出方案';
    $('modalFanoutInpName').value = `自定义扇出方案_${State.rules.fanoutSchemes.length + 1}`;
    $('modalFanoutInpTag').value = '自定义扇出';
    g_modalFanoutVias = [
      { id: 'v1', role: 'Signal', type: 'signal', x: 0, y: 0, padstack: 'SMA_Bot-L19_d2m6mil_via-0902' },
      { id: 'v2', role: 'GND', type: 'gnd', x: 0, y: 20, padstack: 'BGA_GND_pad1mil_0902' },
      { id: 'v3', role: 'GND', type: 'gnd', x: 0, y: -20, padstack: 'BGA_GND_pad1mil_0902' },
      { id: 'v4', role: 'GND', type: 'gnd', x: -20, y: 0, padstack: 'BGA_GND_pad1mil_0902' },
      { id: 'v5', role: 'GND', type: 'gnd', x: 20, y: 0, padstack: 'BGA_GND_pad1mil_0902' }
    ];
  }

  if ($('modalFanoutViaTxt')) {
    $('modalFanoutViaTxt').value = formatViasToEdaTxt(g_modalFanoutVias);
  }
  const initName = $('modalFanoutInpName') ? $('modalFanoutInpName').value : '';
  UnifiedNameBuilder.seq.modal = (idx >= 0 && initName.includes('_')) ? initName.split('_').filter(Boolean) : [];
  renderUnifiedKwUI('modal');
  setFanoutViaInputMode('txt');
  renderModalFanoutViasTable();
  updateModalFanoutPreview();
  modal.style.display = 'flex';
}

function closeFanoutSchemeModal() {
  const modal = $('modalFanoutScheme');
  if (modal) modal.style.display = 'none';
}

function saveFanoutSchemeFromModal() {
  const name = $('modalFanoutInpName').value.trim();
  if (!name) {
    alert('请输入方案名称');
    return;
  }
  const tag = $('modalFanoutInpTag').value.trim() || '通用扇出';
  const pitchStr = calculatePitchRange(g_modalFanoutVias);
  const sigCount = g_modalFanoutVias.filter(v => v.role === 'Signal' || v.type === 'signal').length;
  const gndCount = g_modalFanoutVias.filter(v => v.role === 'GND' || v.type === 'gnd').length;
  const desc = `${tag}: 包含 ${g_modalFanoutVias.length} 孔，信号孔 ${sigCount}、屏蔽地孔 ${gndCount}，孔心距 ${pitchStr}`;

  const newScheme = {
    id: g_editingFanoutSchemeIdx >= 0 ? State.rules.fanoutSchemes[g_editingFanoutSchemeIdx].id : `sc_${Date.now()}`,
    name,
    tag,
    desc,
    viaCount: g_modalFanoutVias.length,
    vias: g_modalFanoutVias
  };

  if (g_editingFanoutSchemeIdx >= 0) {
    State.rules.fanoutSchemes[g_editingFanoutSchemeIdx] = newScheme;
    showToast(`已更新扇出方案【${name}】`);
  } else {
    State.rules.fanoutSchemes.push(newScheme);
    showToast(`已新增扇出方案【${name}】`);
  }

  closeFanoutSchemeModal();
  renderFanoutSchemesGrid();
}

function editFanoutScheme(idx) {
  openFanoutSchemeModal(idx);
}

function deleteFanoutScheme(idx) {
  if (!State.rules.fanoutSchemes || !State.rules.fanoutSchemes[idx]) return;
  const ok = (typeof confirm === 'function')
    ? confirm(`确定要删除扇出方案【${State.rules.fanoutSchemes[idx].name}】吗？`)
    : true;
  if (ok) {
    State.rules.fanoutSchemes.splice(idx, 1);
    renderRulesUI();
    showToast('已删除该扇出方案');
  }
}


