/* ============================================================================
 * unified-fanout-io.js —— 扇出方案库预设加载、清空、JSON 导入导出与容错修复
 * ========================================================================== */
function loadFanoutPresets() {
  State.rules.fanoutSchemes = getDefaultFanoutPresets();
  renderFanoutSchemesGrid();
  showToast("已恢复 6 套标准扇出方案预设");
}

function clearFanoutLibrary() {
  if (!State.rules.fanoutSchemes || State.rules.fanoutSchemes.length === 0) {
    showToast("当前方案库已为空");
    return;
  }
  const ok = (typeof confirm === "function")
    ? confirm("确定要清空当前所有 " + State.rules.fanoutSchemes.length + " 套扇出方案吗？")
    : true;
  if (ok) {
    State.rules.fanoutSchemes = [];
    renderFanoutSchemesGrid();
    showToast("已清空扇出方案库");
  }
}

function exportFanoutLibraryJSON() {
  const data = {
    version: "2.0",
    exportedAt: new Date().toISOString(),
    schemes: State.rules.fanoutSchemes || []
  };
  openModal("导出扇出方案库 JSON", JSON.stringify(data, null, 2), "Fanout_Schemes_Library.json");
}

function parseAndRepairFanoutJson(input) {
  return FanoutChecker.parseAndRepairFanoutJson(input);
}

function importFanoutLibraryJSON(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    const list = parseAndRepairFanoutJson(e.target.result);
    if (list && list.length > 0) {
      State.rules.fanoutSchemes = list.map((s, idx) => ({
        id: s.id || ("sc_" + idx),
        name: s.name || ("方案_" + (idx + 1)),
        tag: s.tag || s.category || "导入方案",
        desc: s.desc || s.description || "",
        viaCount: (s.vias || []).length,
        vias: s.vias || []
      }));
      renderFanoutSchemesGrid();
      showToast("已导入 " + State.rules.fanoutSchemes.length + " 套扇出方案");
    } else {
      alert("未能从该 JSON 文件中识别出扇出方案数据");
    }
    event.target.value = "";
  };
  reader.readAsText(file);
}
