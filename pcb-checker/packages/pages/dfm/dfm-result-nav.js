/* ============================================================================
 * dfm-result-nav.js —— DFM 结果明细与 2D 视口之间的往返定位
 * 点击明细行的定位按钮前记录所在行与滚动位置；从视口返回时切回结果页并恢复到原行，
 * 避免翻到第 N 页后每次返回都回到表头。
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var App = root.DfmApp;
  var $ = App.$;
  var State = App.State;
  var RESTORE_FRAMES = 3;   // 返回后行高可能还在重排，连续对齐几帧

  function scrollXY() {
    var de = document.documentElement;
    return {
      x: root.scrollX || de.scrollLeft || 0,
      y: root.scrollY || de.scrollTop || (document.body && document.body.scrollTop) || 0
    };
  }

  /** 记录 button 所在结果行的 id、视口内位置与页面滚动，并显示视口工具栏的返回按钮。 */
  function rememberDfmResultPosition(button) {
    var row = button && button.closest('tr');
    if (!row) return;
    if (!row.id) row.id = 'dfmReturnRow_' + Date.now();
    var sc = scrollXY();
    State.resultReturnPosition = {
      rowId: row.id,
      rowTop: row.getBoundingClientRect().top,
      scrollX: sc.x,
      scrollY: sc.y
    };
    var returnButton = $('btnReturnDfmResults');
    if (returnButton) returnButton.style.display = '';
  }

  function restoreOnce(saved) {
    var row = saved.rowId && document.getElementById(saved.rowId);
    if (!row) { root.scrollTo(saved.scrollX, saved.scrollY); return; }
    var delta = row.getBoundingClientRect().top - saved.rowTop;
    root.scrollTo(saved.scrollX, scrollXY().y + delta);
  }

  /** 切回「检查结果明细」页签并把滚动恢复到记录的行。没有记录时只切页签。 */
  function returnToDfmResults() {
    var saved = State.resultReturnPosition;
    var tabBtn = document.querySelector('nav#tabs button[data-tab="result"]');
    if (tabBtn) tabBtn.click();
    if (!saved) return;
    var attempts = 0;
    var step = function () {
      attempts++;
      restoreOnce(saved);
      if (attempts < RESTORE_FRAMES && root.requestAnimationFrame) root.requestAnimationFrame(step);
    };
    if (root.requestAnimationFrame) root.requestAnimationFrame(step); else step();
  }

  root.rememberDfmResultPosition = rememberDfmResultPosition;
  root.returnToDfmResults = returnToDfmResults;
  App.ResultNav = { remember: rememberDfmResultPosition, back: returnToDfmResults };
})(typeof window !== 'undefined' ? window : globalThis);
