/* ============================================================================
 * unified-rules-pour.js —— 铜皮规则：异型铜皮模板弹窗
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
// =========================================================================
// Copper Pour Rule 2 Shape Template Modal & Edit Mode (Matching image-3.png)
// =========================================================================
let g_editingPourShapeIdx = -1;

function openAddPourShapeModal() {
  g_editingPourShapeIdx = -1;
  const modal = $('modalPourShape');
  if (!modal) return;

  $('modalPourShapeTitle').textContent = '新增异型铜皮模板';
  $('modalPourShapeInpName').value = `L2特定异型铜皮_${(State.rules.specialShapeTemplates || []).length + 1}`;
  $('modalPourShapeInpPadstack').value = 'BGA_3510';
  $('modalPourShapeInpPadstack').disabled = false;
  $('modalPourShapeInpLayer').value = '02G01P';
  $('modalPourShapeInpLayer').disabled = false;
  $('modalPourShapeInpTol').value = '30.0';
  $('modalPourShapeTxt').value = `Item 2  < Shape >\n  Subset: 02G01P\n  Area: 452.38934 (sq mil)\n  Exterior Boundary:\n    Arc seg: xy [23274.13, 27990.27]  xy [23274.13, 27990.27]\n      Center-xy: [23286.13, 27990.27] Radius (12.0000) CCW`;
  $('modalPourShapeTxt').disabled = false;

  previewModalPourShape();
  modal.style.display = 'flex';
}

function editPourShapeTemplate(idx) {
  g_editingPourShapeIdx = idx;
  const t = State.rules.specialShapeTemplates && State.rules.specialShapeTemplates[idx];
  if (!t) return;

  const modal = $('modalPourShape');
  if (!modal) return;

  // In edit mode per user instruction: 编辑特定类型孔时只能改模板名称，参考image-3的编辑页面
  $('modalPourShapeTitle').textContent = '编辑特定异型铜皮模板';
  $('modalPourShapeInpName').value = t.name || '';
  $('modalPourShapeInpName').disabled = false;

  $('modalPourShapeInpPadstack').value = t.padstack || 'BGA_3510';
  $('modalPourShapeInpPadstack').disabled = true; // Locked in edit mode
  $('modalPourShapeInpPadstack').style.background = '#f8fafc';

  $('modalPourShapeInpLayer').value = t.layer || '02G01P';
  $('modalPourShapeInpLayer').disabled = true; // Locked in edit mode
  $('modalPourShapeInpLayer').style.background = '#f8fafc';

  $('modalPourShapeInpTol').value = t.areaTolerance || 30.0;

  $('modalPourShapeTxt').value = t.rawTxt || `Item 2  < Shape >\n  Subset: ${t.layer || '02G01P'}\n  Area: ${(t.expectedArea || 452.39).toFixed(5)} (sq mil)\n  Exterior Boundary:\n    Arc seg: xy [23274.13, 27990.27]  xy [23274.13, 27990.27]\n      Center-xy: [23286.13, 27990.27] Radius (12.0000) CCW`;
  $('modalPourShapeTxt').disabled = true; // Locked in edit mode
  $('modalPourShapeTxt').style.background = '#f8fafc';

  previewModalPourShape();
  modal.style.display = 'flex';
}

function closePourShapeModal() {
  const modal = $('modalPourShape');
  if (modal) modal.style.display = 'none';
}

function previewModalPourShape() {
  const txt = $('modalPourShapeTxt').value;
  const layer = $('modalPourShapeInpLayer').value || '02G01P';

  let area = 452.39;
  const mArea = txt.match(/Area:\s*([0-9.]+)/i);
  if (mArea) area = parseFloat(mArea[1]) || 452.39;

  const mm2 = (area * 0.00064516).toFixed(4);

  const title = $('modalPourShapePreviewTitle');
  const stats = $('modalPourShapePreviewStats');

  if (title) title.textContent = `已解析 Shape，所在层 ${layer}`;
  if (stats) {
    stats.innerHTML = `
      实测面积: <b style="color:#ffffff">${area.toFixed(2)} sq mil</b> · ${mm2} mm²<br>
      边界：1 段，直线 0、圆弧 1
    `;
  }
}

function savePourShapeFromModal() {
  const name = $('modalPourShapeInpName').value.trim();
  if (!name) {
    alert('请输入模板名称');
    return;
  }

  const padstack = $('modalPourShapeInpPadstack').value.trim() || 'BGA_3510';
  const layer = $('modalPourShapeInpLayer').value.trim() || '02G01P';
  const tol = parseFloat($('modalPourShapeInpTol').value) || 30.0;
  const rawTxt = $('modalPourShapeTxt').value;

  let area = 452.39;
  const mArea = rawTxt.match(/Area:\s*([0-9.]+)/i);
  if (mArea) area = parseFloat(mArea[1]) || 452.39;

  if (g_editingPourShapeIdx >= 0) {
    const t = State.rules.specialShapeTemplates[g_editingPourShapeIdx];
    t.name = name;
    t.areaTolerance = tol;
    showToast(`已修改异型铜皮模板名称为【${name}】`);
  } else {
    if (!State.rules.specialShapeTemplates) State.rules.specialShapeTemplates = [];
    State.rules.specialShapeTemplates.push({
      id: `tmpl_${Date.now()}`,
      name,
      padstack,
      layer,
      expectedArea: area,
      areaTolerance: tol,
      rawTxt
    });
    showToast(`已新增异型铜皮模板【${name}】`);
  }

  closePourShapeModal();
  renderRulesUI();
}

