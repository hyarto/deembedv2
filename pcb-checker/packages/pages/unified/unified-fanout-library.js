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

function parseMultiSchemeTxt(text, existingCount = 0) {
    if (!text || typeof text !== 'string') return [];

    const clean = String(text).replace(/^\uFEFF/, '').trim();
    if (!clean) return [];

    // 分界符规则：必须包含 end（如 ~~~end~~~, ~End~, ~~~ End ~~~, ===end===, ---end--- 等，不匹配纯 ~~~）
    const DELIM_REGEX = /(?:^|\r?\n)\s*[~=-]*\s*end\s*[~=-]*\s*(?:\r?\n|$)/i;

    let rawBlocks = clean.split(DELIM_REGEX).map(b => b.trim()).filter(Boolean);

    // 如果未找到 ~~~end~~~ 分界符，检查是否包含多个方案标题或 Item 1 块
    if (rawBlocks.length <= 1) {
      const schemeHeaderSplit = clean.split(/(?:^|\r?\n)(?=(?:[#=~-]*\s*(?:方案|Scheme|扇出方案)\s*[\d\w_]+|Item\s+1\b\s*<(?:\s*Via\s*)>))/i).map(b => b.trim()).filter(Boolean);
      if (schemeHeaderSplit.length > 1) {
        rawBlocks = schemeHeaderSplit;
      }
    }

    const results = [];

    rawBlocks.forEach((block, blockIdx) => {
      const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) return;

      let schemeName = '';
      let category = '通用扇出';

      // 提取标题：检查前 1~5 行非 Item/Origin/Delimiter 的描述文本
      for (let i = 0; i < Math.min(5, lines.length); i++) {
        const line = lines[i];
        if (/^(?:Item\s+\d+|Origin|Padstack|Net|Circle|Seg|Arc)/i.test(line)) break;
        if (/^(?:[~=-]{2,}|\s*end\s*|[~=-]*\s*(?:end|End|END)\s*[~=-]*)$/i.test(line)) continue;

        const cleanLine = line.replace(/^[#=~*\-—_0-9.、\s]+/, '').replace(/[#=~*\-—_]+$/, '').trim();
        if (cleanLine.length >= 2 && cleanLine.length <= 50 && !/^(?:end|End|END)$/i.test(cleanLine)) {
          schemeName = cleanLine;
          break;
        }
      }

      if (!schemeName) {
        schemeName = `扇出方案_${existingCount + results.length + 1}`;
      }

      // 解析过孔
      const vias = [];
      const itemBlocks = block.split(/(?=Item\s+\d+)/i).filter(s => s.trim());

      if (itemBlocks.length > 0 && /Item\s+\d+/i.test(block)) {
        itemBlocks.forEach((ib, vIdx) => {
          const mOrigin = ib.match(/(?:Origin-xy|Location|xy):\s*\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]/i);
          const mPad = ib.match(/Padstack\s+Name:\s*([^\r\n]+)/i);
          const mNet = ib.match(/Net:\s*([^\r\n]+)/i);
          const mDrill = ib.match(/Circle\s+Drill:\s*([\d\.\-]+)/i);

          if (mOrigin) {
            const rawX = parseFloat(mOrigin[1]) || 0;
            const rawY = parseFloat(mOrigin[2]) || 0;
            const padstack = mPad ? mPad[1].trim() : 'UNKNOWN_PADSTACK';
            const net = mNet ? mNet[1].trim() : '';
            const drill = mDrill ? parseFloat(mDrill[1]) : 0;

            const isGnd = net.toUpperCase().includes('GND') || padstack.toUpperCase().includes('GND');
            const role = isGnd ? '伴随地孔' : '信号孔';
            const type = isGnd ? 'gnd' : 'signal';

            vias.push({
              id: vIdx + 1,
              rawX,
              rawY,
              x: rawX,
              y: rawY,
              padstack,
              net: net || (isGnd ? 'GND' : 'SIGNAL'),
              role,
              type,
              drill
            });
          }
        });
      } else {
        // 兼容坐标表格行：X, Y, Padstack, Net
        lines.forEach((line, vIdx) => {
          if (/^(?:[~=-]{2,}|\s*end\s*|[~=-]*\s*(?:end|End|END)\s*[~=-]*)$/i.test(line)) return;
          const parts = line.split(/[,\t;\s]+/).map(s => s.trim()).filter(Boolean);
          if (parts.length >= 2) {
            const x = parseFloat(parts[0]);
            const y = parseFloat(parts[1]);
            if (!isNaN(x) && !isNaN(y)) {
              const padstack = parts[2] || 'VIA_PADSTACK';
              const net = parts[3] || 'GND';
              const isGnd = net.toUpperCase().includes('GND') || padstack.toUpperCase().includes('GND');
              vias.push({
                id: vIdx + 1,
                rawX: x,
                rawY: y,
                x,
                y,
                padstack,
                net,
                role: isGnd ? '伴随地孔' : '信号孔',
                type: isGnd ? 'gnd' : 'signal',
                drill: 0
              });
            }
          }
        });
      }

      if (vias.length >= 1) {
        // 归一化相对坐标（以第一个信号孔或基准孔为原点 [0, 0]）
        const maxCoord = Math.max(...vias.map(v => Math.max(Math.abs(v.rawX), Math.abs(v.rawY))));
        if (maxCoord > 200) {
          const base = vias.find(v => v.type === 'signal') || vias[0];
          const bx = base.rawX;
          const by = base.rawY;
          vias.forEach(v => {
            v.x = Math.round((v.rawX - bx) * 1000) / 1000;
            v.y = Math.round((v.rawY - by) * 1000) / 1000;
          });
        }

        results.push({
          id: `scheme_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${results.length + 1}`,
          name: schemeName,
          category: category,
          tag: category,
          description: `从批量文本导入，包含 ${vias.length} 个过孔`,
          unit: 'mil',
          vias: vias
        });
      }
    });

    return results;
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
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#94a3b8">暂无解析方案，请在上方粘贴数据或上传 TXT 文件（方案间必须用 ~~~end~~~ 等包含 end 的分界符）</div>';
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
    $('modalFanoutTitle').textContent = '新建扇出方案 (Fanout Scheme Editor)';
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

