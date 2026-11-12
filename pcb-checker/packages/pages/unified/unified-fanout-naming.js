/* ============================================================================
 * unified-fanout-naming.js —— 扇出方案快捷命名：关键词构建器
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
const U_KW_STORAGE_KEY = 'pcb_fanout_name_keywords_v1';
const UnifiedNameBuilder = {
  presetKeywords: (typeof FanoutChecker !== 'undefined' && FanoutChecker.DEFAULT_SCHEME_NAME_KEYWORDS)
    ? FanoutChecker.DEFAULT_SCHEME_NAME_KEYWORDS.slice()
    : ['BGA', 'SMA', 'TZ', 'top', 'bottom', 'L2', 'L3', 'L4', 'L11', 'L12', 'L13', 'diff', 'single', '05pitch', '06pitch', '07pitch', '08pitch'],
  customKeywords: [],
  seq: { quick: [], modal: [] },
  quickIdx: -1,
  loaded: false
};

function loadUnifiedCustomKws() {
  if (UnifiedNameBuilder.loaded) return;
  UnifiedNameBuilder.loaded = true;
  try {
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(U_KW_STORAGE_KEY) : null;
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        UnifiedNameBuilder.customKeywords = arr.map(s => String(s).trim()).filter(s => s && !UnifiedNameBuilder.presetKeywords.includes(s));
      }
    }
  } catch (e) {}
}

function saveUnifiedCustomKws() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(U_KW_STORAGE_KEY, JSON.stringify(UnifiedNameBuilder.customKeywords));
    }
  } catch (e) {}
}

function getAllUnifiedKws() {
  loadUnifiedCustomKws();
  return UnifiedNameBuilder.presetKeywords.concat(UnifiedNameBuilder.customKeywords);
}

function syncUnifiedNameFromSeq(ctx) {
  const tokens = UnifiedNameBuilder.seq[ctx] || [];
  const inp = $(ctx === 'quick' ? 'inpUQuickRenameName' : 'modalFanoutInpName');
  if (inp) {
    if (tokens.length > 0) inp.value = tokens.join('_');
    else if (ctx === 'quick') inp.value = '';
  }
  renderUnifiedKwUI(ctx);
}

function clickUnifiedKw(ctx, kw) {
  const clean = String(kw || '').trim();
  if (!clean) return;
  if (!UnifiedNameBuilder.seq[ctx]) UnifiedNameBuilder.seq[ctx] = [];
  UnifiedNameBuilder.seq[ctx].push(clean);
  syncUnifiedNameFromSeq(ctx);
}

function removeUnifiedKwAt(ctx, idx) {
  const arr = UnifiedNameBuilder.seq[ctx] || [];
  if (idx >= 0 && idx < arr.length) {
    arr.splice(idx, 1);
    syncUnifiedNameFromSeq(ctx);
  }
}

function undoUnifiedKw(ctx) {
  const arr = UnifiedNameBuilder.seq[ctx] || [];
  if (arr.length > 0) {
    arr.pop();
    syncUnifiedNameFromSeq(ctx);
  }
}

function clearUnifiedKws(ctx) {
  UnifiedNameBuilder.seq[ctx] = [];
  const inp = $(ctx === 'quick' ? 'inpUQuickRenameName' : 'modalFanoutInpName');
  if (inp) inp.value = '';
  renderUnifiedKwUI(ctx);
}

function addUnifiedCustomKw(ctx) {
  loadUnifiedCustomKws();
  const inp = $(ctx === 'quick' ? 'inpUAddKwQuick' : 'inpUAddKwModal');
  if (!inp) return;
  const val = String(inp.value || '').trim().replace(/\s+/g, '');
  if (!val) return;
  if (!getAllUnifiedKws().includes(val)) {
    UnifiedNameBuilder.customKeywords.push(val);
    saveUnifiedCustomKws();
  }
  inp.value = '';
  renderUnifiedKwUI('quick');
  renderUnifiedKwUI('modal');
}

function deleteUnifiedCustomKw(kw, ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  loadUnifiedCustomKws();
  UnifiedNameBuilder.customKeywords = UnifiedNameBuilder.customKeywords.filter(k => k !== kw);
  saveUnifiedCustomKws();
  renderUnifiedKwUI('quick');
  renderUnifiedKwUI('modal');
}

function renderUnifiedKwUI(ctx) {
  loadUnifiedCustomKws();
  const seqBar = $(ctx === 'quick' ? 'uQuickKwSeqBar' : 'uModalKwSeqBar');
  const chipsWrap = $(ctx === 'quick' ? 'uQuickKwChips' : 'uModalKwChips');
  if (!seqBar || !chipsWrap) return;

  const seq = UnifiedNameBuilder.seq[ctx] || [];
  const counts = {};
  seq.forEach(t => { counts[t] = (counts[t] || 0) + 1; });

  if (seq.length === 0) {
    seqBar.innerHTML = `<span style="color:#94a3b8;font-size:12px">尚未点选关键词 — 请按顺序点击下方关键词自动以 <code>_</code> 连接生成名称</span>`;
  } else {
    seqBar.innerHTML = seq.map((tok, idx) => `
      <span onclick="removeUnifiedKwAt('${ctx}', ${idx})" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;background:#f1f5f9;color:#1d4ed8;border:1px solid #cbd5e1;border-radius:5px;padding:2px 7px;font-family:var(--mono);font-size:12px;font-weight:700">
        <span style="font-size:11px;color:#2563eb">${idx + 1}.</span>${tok}<span style="color:#2563eb;font-weight:900">×</span>
      </span>
    `).join('<span style="color:#94a3b8;font-family:var(--mono);font-weight:700">_</span>');
  }

  chipsWrap.innerHTML = getAllUnifiedKws().map(kw => {
    const cnt = counts[kw] || 0;
    const isCustom = UnifiedNameBuilder.customKeywords.includes(kw);
    const activeStyle = cnt > 0
      ? 'background:#2563eb;color:#ffffff;border:1px solid #1d4ed8'
      : 'background:#ffffff;color:#1e293b;border:1px solid #cbd5e1';
    const kwSafe = String(kw).replace(/'/g, "\\'");
    return `
      <button type="button" onclick="clickUnifiedKw('${ctx}', '${kwSafe}')" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:6px;font-family:var(--mono);font-size:12px;font-weight:600;${activeStyle}">
        <span>${kw}</span>
        ${cnt > 0 ? `<span style="background:rgba(255,255,255,0.25);color:#fff;border-radius:9px;padding:0 5px;font-size:11px;font-weight:800">×${cnt}</span>` : ''}
        ${isCustom ? `<span onclick="deleteUnifiedCustomKw('${kwSafe}', event)" style="margin-left:2px;font-size:11px;opacity:0.75"></span>` : ''}
      </button>
    `;
  }).join('');
}

function openUnifiedQuickRenameModal(idx) {
  const list = State.rules.fanoutSchemes || [];
  if (!list[idx]) return;
  UnifiedNameBuilder.quickIdx = idx;
  const sc = list[idx];
  UnifiedNameBuilder.seq.quick = (sc.name && sc.name.includes('_')) ? sc.name.split('_').filter(Boolean) : [];
  if ($('lblUQuickRenameOld')) $('lblUQuickRenameOld').textContent = sc.name || '';
  if ($('lblUQuickRenameIdx')) $('lblUQuickRenameIdx').textContent = `方案 ${idx + 1} / ${list.length}`;
  if ($('inpUQuickRenameName')) $('inpUQuickRenameName').value = sc.name || '';
  renderUnifiedKwUI('quick');
  const modal = $('modalUnifiedQuickRename');
  if (modal) modal.style.display = 'flex';
}

function closeUnifiedQuickRenameModal() {
  const modal = $('modalUnifiedQuickRename');
  if (modal) modal.style.display = 'none';
  UnifiedNameBuilder.quickIdx = -1;
}

function saveUnifiedQuickRename(goNext = false) {
  const idx = UnifiedNameBuilder.quickIdx;
  const list = State.rules.fanoutSchemes || [];
  if (idx < 0 || !list[idx]) return;
  const newName = ($('inpUQuickRenameName') ? $('inpUQuickRenameName').value : '').trim();
  if (!newName) {
    alert('新方案名称不能为空');
    return;
  }
  list[idx].name = newName;
  renderRulesUI();
  if (UnifiedViewFanoutState.idx === idx && $('uViewFanoutTitle')) {
    $('uViewFanoutTitle').textContent = newName;
  }
  if (typeof showToast === 'function') showToast(`已更新方案名称为【${newName}】`);
  if (goNext && list.length > 1) {
    openUnifiedQuickRenameModal((idx + 1) % list.length);
  } else {
    closeUnifiedQuickRenameModal();
  }
}

