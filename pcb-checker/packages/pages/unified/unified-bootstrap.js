/* ============================================================================
 * unified-bootstrap.js —— 页面初始化与 window 接口导出
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
// 页面初始化
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  initDragAndDrop();
  renderRulesUI();
  initCanvas();
  UnifiedDfmLayerRules.init();
  updateUnifiedLayerCountHint();
  window.addEventListener('resize', () => {
    resizeCanvas();
    renderCanvas();
  });
});

// Expose APIs to window
window.State = State;
window.renderRulesUI = renderRulesUI;
window.runMasterInspection = runMasterInspection;
window.loadUnifiedSampleData = loadUnifiedSampleData;
window.clearUnifiedData = clearUnifiedData;
window.switchTab = switchTab;
window.filterDefects = filterDefects;
window.toggleReview = toggleReview;
window.locateDefectInCanvas = locateDefectInCanvas;
window.closeUnifiedCanvasReviewBox = closeUnifiedCanvasReviewBox;
window.renderUnifiedCanvasReviewBox = renderUnifiedCanvasReviewBox;
window.batchReviewAll = batchReviewAll;
window.clearAllReviews = clearAllReviews;
window.toggleLayer = toggleLayer;
window.exportMasterRules = exportMasterRules;
window.exportUnifiedCSV = exportUnifiedCSV;
window.exportUnifiedExcel = exportUnifiedExcel;
window.copyModalContent = copyModalContent;
window.closeModal = closeModal;
window.handleRulesFile = handleRulesFile;
window.handleTraceRulesFile = handleTraceRulesFile;
window.handleConstraintTxtFile = handleConstraintTxtFile;
window.handleConstraintJsonFile = handleConstraintJsonFile;
window.handleDfmRulesFile = handleDfmRulesFile;
window.handleFanoutRulesFile = handleFanoutRulesFile;
window.handlePourRulesFile = handlePourRulesFile;
window.handlePourShapeTxtFile = handlePourShapeTxtFile;
window.handleDataFileUpload = handleDataFileUpload;
window.handleCategoryTxtUpload = handleCategoryTxtUpload;
window.clearCategoryData = clearCategoryData;
window.renderDataIngestionBoxes = renderDataIngestionBoxes;
window.importMasterRulesPrompt = importMasterRulesPrompt;
window.importTraceRulesPrompt = importTraceRulesPrompt;
window.exportTraceRulesPrompt = exportTraceRulesPrompt;
window.importConstraintTxtPrompt = importConstraintTxtPrompt;
window.importConstraintJsonPrompt = importConstraintJsonPrompt;
window.exportConstraintJsonPrompt = exportConstraintJsonPrompt;
window.importDfmRulesPrompt = importDfmRulesPrompt;
window.exportDfmRulesPrompt = exportDfmRulesPrompt;
window.importFanoutRulesPrompt = importFanoutRulesPrompt;
window.exportFanoutRulesPrompt = exportFanoutRulesPrompt;
window.importPourRulesPrompt = importPourRulesPrompt;
window.exportPourRulesPrompt = exportPourRulesPrompt;
window.addTraceLayerRuleRow = addTraceLayerRuleRow;
window.deleteTraceLayerRule = deleteTraceLayerRule;
window.addPourRule1Row = addPourRule1Row;
window.deletePourRule1 = deletePourRule1;
window.addPourRule2Row = addPourRule2Row;
window.deletePourShapeTemplate = deletePourShapeTemplate;
window.editPourShapeTemplate = editPourShapeTemplate;
window.addPourRule3Row = addPourRule3Row;
window.deletePourRule3 = deletePourRule3;
window.deleteFanoutScheme = deleteFanoutScheme;
window.editFanoutScheme = editFanoutScheme;
window.viewFanoutScheme = viewFanoutScheme;
window.closeViewFanoutSchemeModal = closeViewFanoutSchemeModal;
window.stepUnifiedViewFanoutScheme = stepUnifiedViewFanoutScheme;
window.editCurrentUnifiedViewedFanout = editCurrentUnifiedViewedFanout;
window.zoomUnifiedViewFanout = zoomUnifiedViewFanout;
window.resetUnifiedViewFanoutTransform = resetUnifiedViewFanoutTransform;
window.renderUnifiedViewedFanoutCanvas = renderUnifiedViewedFanoutCanvas;
window.exportUnifiedViewedFanoutPng = exportUnifiedViewedFanoutPng;
window.setUnifiedViewFanoutHoveredVia = setUnifiedViewFanoutHoveredVia;
window.extractLayerCombosFromData = extractLayerCombosFromData;
window.addCustomConstraintSet = addCustomConstraintSet;
window.resetDefaultConstraintSets = resetDefaultConstraintSets;
window.onLayerCountChange = onLayerCountChange;
window.scrollToSet = scrollToSet;
window.updateSetTitle = updateSetTitle;
window.updateSetKind = updateSetKind;
window.updateColName = updateColName;
window.updateCellVal = updateCellVal;
window.deleteConstraintSet = deleteConstraintSet;
window.deleteConstraintCol = deleteConstraintCol;
window.addConstraintCol = addConstraintCol;
window.refillConstraintSet = refillConstraintSet;
window.parseConstraintText = parseConstraintText;
window.normalizeTraceRule = normalizeTraceRule;
window.parseTraceRulesJson = parseTraceRulesJson;
window.decodeTxt = decodeTxt;
