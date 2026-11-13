/* ============================================================================
 * eda-shell.js —— 现代 EDA 三栏渐进式工作台壳层控制器
 * 负责：
 *   1. 左侧模块/工序栏折叠记忆、右侧功能/检视工具栏折叠记忆
 *   2. 铺满宽屏 / 标准宽度跨页面同步（toggleGlobalWideMode / setGlobalWideMode）
 *   3. 顶部渐进式工序状态条（当前工序面包屑 + 下一步快捷推进）与 nav#tabs 联动
 *   4. 右侧实时工程检视面板（Telemetry）与页面统计卡片自动同步
 *   5. 键盘快捷键：Alt+1..9 快速切换工序页签
 * ========================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var WIDE_KEY = 'pcb_workbench_wide_v1';
  var RAIL_KEY = 'pcb_workbench_rail_collapsed_v1';
  var DOCK_KEY = 'pcb_workbench_dock_collapsed_v1';

  function triggerViewportResize() {
    setTimeout(function () {
      try {
        window.dispatchEvent(new window.Event('resize'));
      } catch (e) {}
    }, 30);
  }

  /* ---------- 宽屏模式（兼容既有全局入口） ---------- */
  function setGlobalWideMode(on) {
    var flag = !!on;
    document.documentElement.classList.toggle('pcb-global-wide', flag);
    var btn = document.getElementById('btnGlobalWide');
    var lbl = document.getElementById('lblGlobalWide');
    if (btn) btn.classList.toggle('active', flag);
    if (lbl) lbl.textContent = flag ? '已铺满宽屏' : '铺满宽屏';
    try { localStorage.setItem(WIDE_KEY, flag ? '1' : '0'); } catch (e) {}
    triggerViewportResize();
  }

  function toggleGlobalWideMode() {
    var next = !document.documentElement.classList.contains('pcb-global-wide');
    setGlobalWideMode(next);
  }

  /* ---------- 左右侧栏收起/展开 ---------- */
  function setRailCollapsed(on) {
    var flag = !!on;
    document.documentElement.classList.toggle('eda-rail-collapsed', flag);
    var btn = document.getElementById('btnToggleLeftRail');
    if (btn) btn.textContent = flag ? '▶' : '◀ 收起导航';
    try { localStorage.setItem(RAIL_KEY, flag ? '1' : '0'); } catch (e) {}
    triggerViewportResize();
  }

  function toggleLeftRail() {
    setRailCollapsed(!document.documentElement.classList.contains('eda-rail-collapsed'));
  }

  function setDockCollapsed(on) {
    var flag = !!on;
    document.documentElement.classList.toggle('eda-dock-collapsed', flag);
    var btn = document.getElementById('btnToggleRightDock');
    if (btn) btn.textContent = flag ? '◀' : '▶';
    try { localStorage.setItem(DOCK_KEY, flag ? '1' : '0'); } catch (e) {}
    triggerViewportResize();
  }

  function toggleRightDock() {
    setDockCollapsed(!document.documentElement.classList.contains('eda-dock-collapsed'));
  }

  /* ---------- 渐进式工序流同步 ---------- */
  function getTabButtons() {
    var nav = document.getElementById('tabs');
    return nav ? Array.prototype.slice.call(nav.querySelectorAll('button')) : [];
  }

  function syncStageBar() {
    var btns = getTabButtons();
    if (!btns.length) return;
    var activeIdx = -1;
    btns.forEach(function (b, i) {
      if (b.classList.contains('active')) activeIdx = i;
    });
    if (activeIdx < 0) activeIdx = 0;

    btns.forEach(function (b, i) {
      b.classList.toggle('step-done', i < activeIdx);
    });

    var stageEl = document.getElementById('edaActiveStageLabel');
    if (stageEl && btns[activeIdx]) {
      var raw = btns[activeIdx].childNodes[0]
        ? btns[activeIdx].childNodes[0].textContent
        : btns[activeIdx].textContent;
      stageEl.textContent = String(raw || '').trim();
    }

    var nextBtn = document.getElementById('btnEdaNextStage');
    if (nextBtn) {
      if (activeIdx < btns.length - 1) {
        var nextRaw = btns[activeIdx + 1].childNodes[0]
          ? btns[activeIdx + 1].childNodes[0].textContent
          : btns[activeIdx + 1].textContent;
        nextBtn.style.display = '';
        nextBtn.textContent = '下一工序：' + String(nextRaw || '').trim() + ' →';
      } else {
        nextBtn.style.display = 'none';
      }
    }
  }

  function stepNextStage() {
    var btns = getTabButtons();
    if (!btns.length) return;
    var idx = btns.findIndex(function (b) { return b.classList.contains('active'); });
    if (idx >= 0 && idx < btns.length - 1) {
      btns[idx + 1].click();
      syncStageBar();
    }
  }

  /* ---------- 右侧实时遥测检视器自动同步 ---------- */
  function syncTelemetry() {
    var host = document.getElementById('edaDockTelemetry');
    if (!host) return;

    var cells = [];
    var statEls = document.querySelectorAll('.stat-box, .stat, .kpi-banner .kpi-item');
    for (var i = 0; i < statEls.length && cells.length < 6; i++) {
      var el = statEls[i];
      if (el.classList.contains('kpi-item')) {
        var b = el.querySelector('b');
        if (!b) continue;
        var labelTxt = el.textContent.replace(b.textContent, '').replace(/[:：]/g, '').trim();
        var cls = /缺陷|超标|不符/.test(labelTxt) && parseInt(b.textContent, 10) > 0 ? 'bad' : '';
        cells.push({ k: labelTxt, v: b.textContent.trim(), cls: cls });
        continue;
      }
      var lblEl = el.querySelector('.lbl, .t');
      var valEl = el.querySelector('.num, .val, .v, b');
      if (!lblEl || !valEl) continue;
      var k = lblEl.textContent.trim();
      var firstChildVal = valEl.querySelector('span');
      var v = (firstChildVal ? firstChildVal.textContent : valEl.textContent).trim();
      if (!k || !v) continue;
      var tone = el.classList.contains('bad') ? 'bad' : (el.classList.contains('ok') ? 'ok' : (el.classList.contains('warn') ? 'warn' : ''));
      cells.push({ k: k, v: v, cls: tone });
    }

    if (!cells.length) return;
    host.innerHTML = cells.map(function (c) {
      var esc = window.escHtml || function (s) { return String(s); };
      return '<div class="eda-tele-cell ' + c.cls + '">' +
        '<div class="k">' + esc(c.k) + '</div>' +
        '<div class="v">' + esc(c.v) + '</div>' +
        '</div>';
    }).join('');
  }

  function observeWorkspace() {
    var nav = document.getElementById('tabs');
    if (nav && typeof MutationObserver !== 'undefined') {
      var navObs = new MutationObserver(function () {
        syncStageBar();
        syncTelemetry();
      });
      navObs.observe(nav, { attributes: true, subtree: true, childList: true, attributeFilter: ['class'] });
      nav.addEventListener('click', function () {
        setTimeout(function () {
          syncStageBar();
          syncTelemetry();
        }, 10);
      });
    }

    var center = document.querySelector('.eda-center-col');
    if (center && typeof MutationObserver !== 'undefined') {
      var timer = null;
      var bodyObs = new MutationObserver(function () {
        if (timer) return;
        timer = setTimeout(function () {
          timer = null;
          syncTelemetry();
        }, 80);
      });
      bodyObs.observe(center, { childList: true, subtree: true, characterData: true });
    }
  }

  function init() {
    try {
      if (localStorage.getItem(WIDE_KEY) === '1') setGlobalWideMode(true);
      if (localStorage.getItem(RAIL_KEY) === '1') setRailCollapsed(true);
      if (localStorage.getItem(DOCK_KEY) === '1') setDockCollapsed(true);
    } catch (e) {}

    var btnRail = document.getElementById('btnToggleLeftRail');
    if (btnRail) btnRail.addEventListener('click', toggleLeftRail);

    var btnDock = document.getElementById('btnToggleRightDock');
    if (btnDock) btnDock.addEventListener('click', toggleRightDock);

    var btnNext = document.getElementById('btnEdaNextStage');
    if (btnNext) btnNext.addEventListener('click', stepNextStage);

    document.addEventListener('keydown', function (e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        var btns = getTabButtons();
        var target = btns[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          target.click();
        }
      }
    });

    syncStageBar();
    syncTelemetry();
    observeWorkspace();
  }

  window.toggleGlobalWideMode = toggleGlobalWideMode;
  window.setGlobalWideMode = setGlobalWideMode;
  window.EdaShell = {
    toggleWide: toggleGlobalWideMode,
    setWide: setGlobalWideMode,
    toggleLeftRail: toggleLeftRail,
    toggleRightDock: toggleRightDock,
    stepNextStage: stepNextStage,
    syncStageBar: syncStageBar,
    syncTelemetry: syncTelemetry
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
