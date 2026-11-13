/* ============================================================================
 * dfm-pattern-filter-popover.js —— 规律分析表的列值筛选弹层
 * 列出该列全部不重复值，支持搜索、全选可见、取消可见项；确定时全选等同不筛选，
 * 全不选则隐藏所有行；清除筛选恢复。点击弹层外或按 Esc 关闭。
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var App = root.DfmApp;
  var POP_ID = 'dfmPatternFilterPopover';
  var POP_W = 308, POP_H = 448;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function textBtn(label, cls, handler) {
    var b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', handler);
    return b;
  }

  function close() {
    var pop = document.getElementById(POP_ID);
    if (pop) pop.remove();
  }

  function isOpenFor(button) {
    var pop = document.getElementById(POP_ID);
    return !!(pop && pop.dataset.table === button.dataset.patTable && pop.dataset.col === button.dataset.patCol);
  }

  function matches(value, q) { return !q || value.toLowerCase().indexOf(q.toLowerCase()) >= 0; }

  /** 选项列表：随搜索词重绘，勾选同步到 selected。 */
  function makeOptionList(values, selected, search) {
    var list = el('div', 'pat-filter-list');
    var render = function () {
      list.replaceChildren();
      var shown = values.filter(function (v) { return matches(v, search.value.trim()); });
      shown.forEach(function (value) {
        var label = el('label', 'pat-filter-option');
        var cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = selected.has(value); cb.setAttribute('data-no-persist', '');
        cb.addEventListener('change', function () { if (cb.checked) selected.add(value); else selected.delete(value); });
        label.append(cb, el('span', '', value));
        list.appendChild(label);
      });
      if (!shown.length) list.appendChild(el('div', 'hint', '没有匹配项'));
    };
    search.addEventListener('input', render);
    render();
    return { node: list, render: render };
  }

  function placeNear(pop, button) {
    var rect = button.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(root.innerWidth - POP_W, rect.left - 260)) + 'px';
    pop.style.top = Math.max(8, Math.min(root.innerHeight - POP_H, rect.bottom + 4)) + 'px';
  }

  /** Esc 立即生效；点击外部关闭延后一拍挂接，避免打开弹层的那次点击把它立刻关掉。 */
  function armDismiss(pop, button) {
    var detach = function () {
      document.removeEventListener('click', onDoc, true);
      document.removeEventListener('keydown', onKey);
    };
    var onDoc = function (e) {
      if (!pop.isConnected) { detach(); return; }
      if (pop.contains(e.target) || e.target === button) return;
      close();
    };
    var onKey = function (e) {
      if (!pop.isConnected) { detach(); return; }
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    setTimeout(function () { document.addEventListener('click', onDoc, true); }, 0);
  }

  /**
   * cfg: { values:[字符串], current:Set|null, onApply(Set|null), onClear() }
   * current 为 null 表示该列尚未筛选，初始全选。
   */
  function open(button, cfg) {
    close();
    var values = cfg.values;
    var selected = cfg.current instanceof Set ? new Set(cfg.current) : new Set(values);
    var pop = el('div', 'pat-filter-pop');
    pop.id = POP_ID; pop.dataset.table = button.dataset.patTable; pop.dataset.col = button.dataset.patCol;
    var search = document.createElement('input');
    search.type = 'search'; search.placeholder = '搜索选项'; search.setAttribute('data-no-persist', '');
    var options = makeOptionList(values, selected, search);
    var visible = function () { return values.filter(function (v) { return matches(v, search.value.trim()); }); };
    var quick = el('div', 'pat-filter-quick');
    quick.append(
      textBtn('全选可见', '', function () { visible().forEach(function (v) { selected.add(v); }); options.render(); }),
      textBtn('取消可见项', '', function () { visible().forEach(function (v) { selected.delete(v); }); options.render(); })
    );
    var actions = el('div', 'pat-filter-actions');
    actions.append(
      textBtn('清除筛选', 'btn sec small', function () { close(); cfg.onClear(); }),
      textBtn('确定', 'btn pri small', function () {
        close();
        cfg.onApply(selected.size === values.length ? null : new Set(selected));
      })
    );
    pop.append(el('h4', '', '筛选此列'), search, quick, options.node, actions);
    document.body.appendChild(pop);
    placeNear(pop, button);
    armDismiss(pop, button);
    return pop;
  }

  App.PatternFilterPopover = { open: open, close: close, isOpenFor: isOpenFor };
  root.DfmPatternFilterPopover = App.PatternFilterPopover;
})(typeof window !== 'undefined' ? window : globalThis);
