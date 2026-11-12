/* ============================================================================
 * eda-tooltip.js —— 全站悬浮气泡提示（Hover / Focus Tooltip）引擎
 * 规范约定：界面文案不加括号解释，补充说明统一挂 data-tip="..." 或 .eda-tip 触发器
 * ========================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var activeTarget = null;
  var tipNode = null;

  function ensureTipNode() {
    if (tipNode && tipNode.isConnected) return tipNode;
    tipNode = document.getElementById('edaFloatingTooltip');
    if (!tipNode) {
      tipNode = document.createElement('div');
      tipNode.id = 'edaFloatingTooltip';
      tipNode.setAttribute('role', 'tooltip');
      tipNode.setAttribute('aria-hidden', 'true');
      document.body.appendChild(tipNode);
    }
    return tipNode;
  }

  function findTipCarrier(node) {
    var cur = node;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur.nodeType === 1 && cur.hasAttribute && cur.hasAttribute('data-tip')) {
        var txt = cur.getAttribute('data-tip');
        if (txt && txt.trim()) return cur;
      }
      cur = cur.parentNode;
    }
    return null;
  }

  function positionTip(target) {
    var box = ensureTipNode();
    if (!target || !target.getBoundingClientRect) return;
    var rect = target.getBoundingClientRect();
    var vw = window.innerWidth || 1280;
    var vh = window.innerHeight || 800;

    var bw = box.offsetWidth || 220;
    var bh = box.offsetHeight || 34;

    var left = rect.left + rect.width / 2 - bw / 2;
    if (left < 8) left = 8;
    if (left + bw > vw - 8) left = Math.max(8, vw - bw - 8);

    var top = rect.bottom + 7;
    if (top + bh > vh - 8 && rect.top - bh - 7 > 6) {
      top = rect.top - bh - 7;
    }

    box.style.left = Math.round(left) + 'px';
    box.style.top = Math.round(top) + 'px';
  }

  function show(target) {
    if (!target) return;
    var text = target.getAttribute('data-tip');
    if (!text || !text.trim()) return;
    activeTarget = target;
    var box = ensureTipNode();
    box.textContent = text.trim();
    box.style.display = 'block';
    box.setAttribute('aria-hidden', 'false');
    positionTip(target);
  }

  function hide() {
    activeTarget = null;
    if (!tipNode) tipNode = document.getElementById('edaFloatingTooltip');
    if (!tipNode) return;
    tipNode.style.display = 'none';
    tipNode.setAttribute('aria-hidden', 'true');
  }

  function bindEvents() {
    ensureTipNode();
    document.addEventListener('mouseover', function (e) {
      var carrier = findTipCarrier(e.target);
      if (carrier) {
        if (carrier !== activeTarget) show(carrier);
      } else if (activeTarget) {
        hide();
      }
    });

    document.addEventListener('mouseout', function (e) {
      if (!activeTarget) return;
      var related = e.relatedTarget;
      if (related && activeTarget.contains && activeTarget.contains(related)) return;
      var nextCarrier = related ? findTipCarrier(related) : null;
      if (!nextCarrier) hide();
    });

    document.addEventListener('focusin', function (e) {
      var carrier = findTipCarrier(e.target);
      if (carrier) show(carrier);
    });

    document.addEventListener('focusout', function () {
      hide();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hide();
    });

    window.addEventListener('scroll', function () {
      if (activeTarget) positionTip(activeTarget);
    }, true);
  }

  var api = {
    show: show,
    hide: hide,
    ensure: ensureTipNode,
    activeTarget: function () { return activeTarget; }
  };

  window.EdaTooltip = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }
})();
