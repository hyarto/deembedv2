/* ============================================================================
 * unified-rules-constraint.js —— 约束规则：约束指引、约束卡片与叠层数
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
function jumpItems() {
  const sets = State.rules.constraintSets || [];
  const items = sets.map((set, si) => {
    const title = String(set.title || '');
    const m = chipMeta(title);
    return { set: set, si: si, group: m.group, layer: m.layer, d2m: m.d2m, title: title, kind: set.kind || '其他' };
  });
  const rank = { 'BGA': 0, 'SMA · Top 面': 1, 'SMA · bottom 面': 2, 'SMA · 未标面': 3, '其他': 4 };
  items.sort((a, b) => {
    const ra = rank[a.group] === undefined ? 9 : rank[a.group];
    const rb = rank[b.group] === undefined ? 9 : rank[b.group];
    if (ra !== rb) return ra - rb;
    if (a.group !== b.group) return a.group < b.group ? -1 : 1;
    const da = a.d2m > 0 ? (1e6 - a.d2m) : 1e9, db = b.d2m > 0 ? (1e6 - b.d2m) : 1e9;
    if (da !== db) return da - db;
    if (a.layer !== b.layer) return b.layer - a.layer;
    return a.title.localeCompare(b.title);
  });
  const cols = [], idx = {};
  items.forEach(it => {
    if (!idx[it.group]) { idx[it.group] = { group: it.group, items: [] }; cols.push(idx[it.group]); }
    idx[it.group].items.push(it);
  });
  return cols;
}

function renderJump() {
  const nav = $('jumpNav');
  if (!nav) return;
  const sets = State.rules.constraintSets || [];
  if (!sets.length) { nav.style.display = 'none'; nav.innerHTML = ''; return; }
  nav.style.display = 'flex';
  const cols = jumpItems();
  let h = '<div class="jlabel">约束指引 · 按封装/面分组，点击跳到对应约束</div><div class="cols">';
  cols.forEach(col => {
    h += `<div class="jumpcol"><div class="jumpcol-h">${col.group}<span class="cnt"> ${col.items.length}</span></div>`;
    const multi = col.items.some(x => x.d2m > 0);
    let lastD2M = null;
    col.items.forEach(it => {
      const dk = it.d2m ? (`D2M${it.d2m}mil`) : '未标 D2M';
      if (multi && dk !== lastD2M) { h += `<div class="chipsub">${dk}</div>`; lastD2M = dk; }
      const name = it.title || (`约束 ${it.si + 1}`);
      h += `<a class="${it.kind}" href="#set-${it.si}" title="${name}" onclick="scrollToSet(${it.si});return false;">` +
        `<span class="k">${it.kind}</span><span class="jname">${name}</span></a>`;
    });
    h += '</div>';
  });
  h += '</div>';
  nav.innerHTML = h;
}

function scrollToSet(si) {
  const el = $(`set-${si}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.style.boxShadow = '0 0 0 2px #2563eb';
    setTimeout(() => { el.style.boxShadow = ''; }, 1500);
  }
}

function renderConstraintSets() {
  const container = $('setsContainer');
  if (!container) return;
  const sets = State.rules.constraintSets || [];
  if (!sets.length) {
    container.innerHTML = '<div style="padding:16px;text-align:center;color:#6b7280;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px">暂无约束规则。可点击上方「导入约束 TXT」或「恢复预设约束方案」。</div>';
    return;
  }
  const n = unifiedLayerCount();

  let html = '';
  let lastConstraintGroup = '';
  sets.forEach((set, si) => {
    if (set.group && set.group !== lastConstraintGroup) {
      html += `<div class="unified-constraint-group" style="margin:14px 0 8px;padding-left:9px;border-left:3px solid #2563eb;font-size:13px;font-weight:700;color:#374151">${escHtml(set.group)}</div>`;
      lastConstraintGroup = set.group;
    }
    const kind = set.kind || '其他';
    const cons = set.constraints || [];
    const fan = fanLayerOf(set);
    let maxL = Math.max(n, fan || 0);

    html += `
      <div class="set ${kind}" id="set-${si}" data-si="${si}">
        <div class="hd">
          <span class="badge" style="background:rgba(255,255,255,0.25);font-weight:700;padding:2px 8px;border-radius:10px">${kind}</span>
          <input class="setTitle" data-si="${si}" value="${set.title || ''}" onchange="updateSetTitle(${si}, this.value)" style="width:320px;font-weight:700;background:#ffffff;color:#111827;border:none;padding:4px 8px;border-radius:4px" title="约束名称">
          ${set.txtHead ? `<span class="txthead" style="font-size:12px;color:#e3e8ef">TXT: ${set.txtHead}</span>` : ''}
          <select class="setKind" data-si="${si}" onchange="updateSetKind(${si}, this.value)" style="margin-left:auto;background:#ffffff;color:#111827;padding:3px 6px;border-radius:4px">
            <option value="SMA" ${kind==='SMA'?'selected':''}>SMA</option>
            <option value="BGA" ${kind==='BGA'?'selected':''}>BGA</option>
            <option value="其他" ${kind==='其他'?'selected':''}>其他</option>
          </select>
          <span style="font-size:12px;color:#e3e8ef;margin-left:6px">来源 ${set.source || '03Antipad_via_routekeepout_rule.txt'}</span>
          <button type="button" class="btn danger small" style="background:#fee2e2;color:#dc2626;font-weight:600" onclick="deleteConstraintSet(${si})">删除此类</button>
        </div>
        <div class="body">
    `;

    if (!cons.length) {
      html += '<div style="font-size:12px;color:#6b7280;padding:8px">此卡片尚未配置层约束参数。</div>';
    } else {
      html += `
        <div class="layerwrap">
          <table class="layertable">
            <thead>
              <tr>
                <th class="lname">层</th>
      `;
      cons.forEach((c, ci) => {
        html += `
          <th>
            <span class="subh">${c.cat || '反焊盘尺寸'}</span>
            <input class="cName" data-si="${si}" data-ci="${ci}" value="${c.name || ''}" onchange="updateColName(${si}, ${ci}, this.value)" title="约束名称">
            <div class="subh" style="margin-top:2px">
              <input class="cUnit" data-si="${si}" data-ci="${ci}" value="${c.unit || 'mil'}" style="width:48px;text-align:center">
              <button type="button" class="btn danger small" style="padding:1px 5px;font-size:11px" onclick="deleteConstraintCol(${si}, ${ci})">删除</button>
            </div>
          </th>
        `;
      });
      html += '</tr></thead><tbody>';

      for (let i = 1; i <= maxL; i++) {
        const tag = i === fan ? '出线层' : (i === 1 ? '表层' : (i === n ? '底层' : (i > n ? '超出总层数' : '')));
        const isFan = i === fan ? 'fan' : '';
        const isOver = i > n ? 'over' : '';
        html += `<tr class="${isFan} ${isOver}"><td class="lname">L${i} ${tag ? `<span class="subh">${tag}</span>` : ''}</td>`;
        cons.forEach((c, ci) => {
          const key = `L${i}`;
          const v = (c.values && c.values[key] != null) ? String(c.values[key]).trim() : '';
          const src = (c.sources && c.sources[key]) || '';
          if (!v || v === '无') {
            html += `<td class="nosrc" style="background:#f8fafc"><input class="cCell none" data-si="${si}" data-ci="${ci}" data-key="${key}" value="无" onchange="updateCellVal(${si}, ${ci}, '${key}', this.value)"></td>`;
          } else {
            html += `<td><input class="cCell" data-si="${si}" data-ci="${ci}" data-key="${key}" value="${v}" onchange="updateCellVal(${si}, ${ci}, '${key}', this.value)"><div class="srcnote">来源: ${src || '手工填写'}</div></td>`;
          }
        });
        html += '</tr>';
      }
      html += '</tbody></table></div>';
      html += '<div class="srcnote" style="margin-top:6px">没有来源的格子填「无」。L18及以上填 L1 到该层。出线层填到名称中的那一层。</div>';
    }

    html += `
        <div style="display:flex;gap:6px;margin-top:8px">
          <button type="button" class="btn sec small" onclick="addConstraintCol(${si})">+ 加一个约束列</button>
          <button type="button" class="btn sec small" onclick="refillConstraintSet(${si})">按 TXT 重填</button>
        </div>
      </div>
    </div>`;
  });

  container.innerHTML = html;
}

function updateSetTitle(si, val) {
  if (State.rules.constraintSets[si]) {
    State.rules.constraintSets[si].title = val;
    renderJump();
  }
}
function updateSetKind(si, val) {
  if (State.rules.constraintSets[si]) {
    State.rules.constraintSets[si].kind = val;
    renderJump();
    renderConstraintSets();
  }
}
function updateColName(si, ci, val) {
  const set = State.rules.constraintSets[si];
  if (set && set.constraints && set.constraints[ci]) set.constraints[ci].name = val;
}
function updateCellVal(si, ci, key, val) {
  const set = State.rules.constraintSets[si];
  if (set && set.constraints && set.constraints[ci]) {
    if (!set.constraints[ci].values) set.constraints[ci].values = {};
    set.constraints[ci].values[key] = (val === '' || val === '无') ? '' : val;
  }
}
function deleteConstraintSet(si) {
  State.rules.constraintSets.splice(si, 1);
  renderJump();
  renderConstraintSets();
}
function deleteConstraintCol(si, ci) {
  const set = State.rules.constraintSets[si];
  if (set && set.constraints) {
    set.constraints.splice(ci, 1);
    renderConstraintSets();
  }
}
function addConstraintCol(si) {
  const set = State.rules.constraintSets[si];
  if (set) {
    if (!set.constraints) set.constraints = [];
    set.constraints.push({ cat: '反焊盘尺寸', name: '自定义反焊盘半径', unit: 'mil', values: {}, sources: {} });
    renderConstraintSets();
  }
}
function refillConstraintSet(si) {
  reexpandAll();
  renderConstraintSets();
  showToast('已按规则重新填充各层参数');
}
function addCustomConstraintSet() {
  const n = unifiedLayerCount();
  const newSet = {
    kind: 'SMA',
    title: `Custom-SMA-L${n}-D2M6mil`,
    fanLayer: n,
    source: '手动创建',
    txtHead: `自定义扇出封装方案 / L${n}层扇出`,
    constraints: [
      { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: {}, sources: {} },
      { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: {}, sources: {} }
    ]
  };
  State.rules.constraintSets.push(newSet);
  renderJump();
  renderConstraintSets();
  scrollToSet(State.rules.constraintSets.length - 1);
}
function resetDefaultConstraintSets() {
  State.rules.constraintSets = getDefaultConstraintSets();
  renderJump();
  renderConstraintSets();
  showToast('已恢复预设全套 BGA/SMA 约束方案');
}
function unifiedAutoLayerCount() {
  let max = 0;
  const bump = text => {
    String(text || '').split(/\r?\n/).forEach(line => {
      if (/扇出|出线|总层数/.test(line)) return;
      for (const m of line.matchAll(/\bL\s*(\d+)\b/gi)) max = Math.max(max, Number(m[1]));
    });
  };
  bump(State.dataInputs?.constraint?.text || '');
  (State.rules.constraintSets || []).forEach(set => {
    const fan = fanLayerOf(set);
    bump(set.title || '');
    (set.constraints || []).forEach(c => {
      (c.scopes || []).forEach(sc => { if (!/扇出|出线/.test(String(sc.scope || ''))) bump(sc.scope); });
      Object.keys(c.values || {}).forEach(k => { const m = /^L(\d+)$/i.exec(k); if (m && Number(m[1]) !== fan) max = Math.max(max, Number(m[1])); });
    });
  });
  return max || 21;
}
function unifiedLayerCount() {
  const manual = parseInt($('cfgLayerCount')?.value, 10);
  return manual >= 1 && manual <= 64 ? manual : unifiedAutoLayerCount();
}
function updateUnifiedLayerCountHint() {
  const el = $('unifiedLayerCountHint');
  if (el) el.textContent = $('cfgLayerCount')?.value ? `手动 ${unifiedLayerCount()} 层` : `自动识别 ${unifiedAutoLayerCount()} 层`;
}
function resetAutoLayerCount() {
  const el = $('cfgLayerCount');
  if (el) el.value = '';
  onLayerCountChange();
}
function onLayerCountChange() {
  updateUnifiedLayerCountHint();
  reexpandAll();
  renderConstraintSets();
}
