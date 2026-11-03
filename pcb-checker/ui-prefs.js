/* ============================================================================
 * ui-prefs.js —— 全站「界面参数记忆」（所有页面共用，无依赖、无 CDN）
 *
 * 解决的问题
 *   各页面原来只把「数值」存成历史候选（如加工能力页 input 旁边那排 4.01575 / 5 / 6 / 8 小圆钮），
 *   但输入框本身刷新后仍回到 HTML 里写死的出厂值。用户每次重新打开工作台都要把
 *   阈值、焊盘直径、单位、模式、勾选项重新填一遍。
 *
 * 现在的行为
 *   1. 任何「填写数值 / 选择项」（input.number、input.text、input.checkbox、input.radio、select）
 *      一旦改动就按「页面 + 元素 id」记进 localStorage；
 *   2. 页面加载完成后自动回填上次用过的值，并派发 input/change 事件，
 *      让页面内部 State、联动重绘、校验逻辑和用户手动点一遍完全一致；
 *   3. 刷新、关掉再打开、从别的页面跳回来都保持有效（同一浏览器同一站点）。
 *
 * 不记忆的东西
 *   · textarea（数据粘贴区 / 导出框，属于一次性数据，不该被记住）
 *   · 只读框、disabled 框、file / hidden / button 类
 *   · 重复 id 的元素（模板循环渲染出来的行内控件，例如逐对偶的复核勾选框）
 *   · 显式标了 data-no-persist 的元素或其子元素（搜索框、筛选下拉、弹窗里的一次性录入框）
 *
 * 恢复出厂
 *   页面右上角显示区工具条会自动多一个「恢复默认值」按钮（仅当本页确实存了记忆值时出现），
 *   点击后清空本页记忆并刷新；控制台也可用 UiPrefs.clear()（本页） / UiPrefs.clearAll()（全站）。
 * ========================================================================== */
(function () {
  'use strict';

  var STORE_KEY = 'pcbchecker.uiprefs.v1';
  var SKIP_TYPES = { file: 1, hidden: 1, button: 1, submit: 1, reset: 1, image: 1, password: 1 };
  var SAVE_DEBOUNCE_MS = 350;

  // localStorage 可能在 file:// 或被浏览器策略禁用时抛异常，全部包一层，失败即降级为「不记忆」
  var memFallback = null;

  function pageName() {
    var p = (typeof location !== 'undefined' && location.pathname) ? location.pathname : '';
    p = p.split('/').pop() || '';
    if (!p) return 'index.html';
    return p;
  }

  function readAll() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        var raw = localStorage.getItem(STORE_KEY);
        var obj = raw ? JSON.parse(raw) : null;
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
      }
    } catch (e) { /* 忽略：降级到内存 */ }
    if (memFallback && typeof memFallback === 'object') return memFallback;
    return {};
  }

  function writeAll(obj) {
    memFallback = obj;
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.setItem(STORE_KEY, JSON.stringify(obj));
      }
    } catch (e) { /* 忽略：仅在本次会话内有效 */ }
  }

  function readPage(name) {
    var all = readAll();
    var pg = all[name || pageName()];
    return (pg && typeof pg === 'object') ? pg : null;
  }

  /* ---------- 候选元素与可用性判定 ---------- */

  // 一次性扫描：id -> 出现次数（重复 id 的模板行内控件不记忆，避免张冠李戴）
  function scan() {
    var list = [];
    if (typeof document === 'undefined') return list;
    var nodes = document.querySelectorAll('input, select, textarea');
    var counts = {};
    for (var k = 0; k < nodes.length; k++) {
      var id = nodes[k].id;
      if (!id) continue;
      counts[id] = (counts[id] || 0) + 1;
    }
    for (var i = 0; i < nodes.length; i++) {
      list.push({ el: nodes[i], id: nodes[i].id, dup: nodes[i].id ? counts[nodes[i].id] : 0 });
    }
    return list;
  }

  function typeOf(el) {
    return String(el.type || el.tagName || '').toLowerCase();
  }

  function hasNoPersist(el) {
    if (el.hasAttribute && el.hasAttribute('data-no-persist')) return true;
    try {
      if (el.closest && el.closest('[data-no-persist]')) return true;
    } catch (e) { /* 老浏览器 */ }
    return false;
  }

  // accept: 该元素是否应该被记忆/回填
  function accept(el, dupCount) {
    if (!el || !el.id) return false;
    var tag = String(el.tagName || '').toLowerCase();
    if (tag === 'textarea') return false;                       // 数据粘贴 / 导出框
    var t = typeOf(el);
    if (SKIP_TYPES[t]) return false;
    if (el.readOnly || el.disabled) return false;
    if (hasNoPersist(el)) return false;
    if (typeof dupCount === 'number' && dupCount > 1) return false; // 重复 id
    if (el.getAttribute && el.getAttribute('data-persist') === 'false') return false;
    return true;
  }

  function isCheckable(el) {
    var t = typeOf(el);
    return t === 'checkbox' || t === 'radio';
  }

  function readValue(el) {
    return isCheckable(el) ? !!el.checked : String(el.value == null ? '' : el.value);
  }

  /* ---------- 保存 ---------- */

  // 单个元素保存时的重复 id 校验（模板循环渲染的行内控件 id 会重复，不能按 id 记）
  function isDuplicateId(id) {
    if (!id) return true;
    try {
      return document.querySelectorAll('[id="' + String(id).replace(/"/g, '') + '"]').length > 1;
    } catch (e) {
      return false;
    }
  }

  function saveEl(el) {
    if (!accept(el)) return false;
    if (isDuplicateId(el.id)) return false;
    var all = readAll();
    var page = pageName();
    var pg = all[page];
    if (!pg || typeof pg !== 'object') { pg = {}; }
    var v = readValue(el);
    if (pg[el.id] === v) return false;
    pg[el.id] = v;
    all[page] = pg;
    writeAll(all);
    syncResetButton();
    return true;
  }

  function saveNow() {
    var list = scan();
    var all = readAll();
    var page = pageName();
    var pg = all[page] && typeof all[page] === 'object' ? all[page] : {};
    var dirty = false;
    for (var i = 0; i < list.length; i++) {
      var el = list[i].el;
      if (!accept(el, list[i].dup)) continue;
      var v = readValue(el);
      if (pg[el.id] !== v) { pg[el.id] = v; dirty = true; }
    }
    if (dirty) { all[page] = pg; writeAll(all); syncResetButton(); }
    return dirty;
  }

  /* ---------- 回填 ---------- */

  /* 有些下拉（层名、网络名、方案名）的选项是导入数据后才填充的：
     恢复时选项还不存在就记成 pending，等它填充出来再补填，避免「选了层，刷新后又回到默认」。 */
  var pendingSelects = [];

  function applyToSelect(el, v) {
    if (typeof v !== 'string' || v === '') return 'skip';
    var opts = el.options || [];
    for (var o = 0; o < opts.length; o++) {
      if (String(opts[o].value) === v) {
        if (String(el.value) === v) return 'same';
        el.value = v;
        return 'applied';
      }
    }
    return 'pending';
  }

  function watchPendingSelect(el, id, v) {
    if (typeof MutationObserver === 'undefined') return;
    for (var i = 0; i < pendingSelects.length; i++) {
      if (pendingSelects[i].el === el) return;   // 已在监听
    }
    var rec = { el: el, id: id, v: v, obs: null };
    try {
      rec.obs = new MutationObserver(function () {
        if (applyToSelect(el, v) === 'applied') {
          try { rec.obs.disconnect(); } catch (e) {}
          pendingSelects = pendingSelects.filter(function (x) { return x !== rec; });
          fireChange(el);
        }
      });
      rec.obs.observe(el, { childList: true });
      pendingSelects.push(rec);
    } catch (e) { /* 忽略：老浏览器无为 */ }
  }

  function fireChange(el) {
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
  }

  function restore() {
    var data = readPage();
    if (!data) return 0;
    var list = scan();
    var byId = {};
    for (var i = 0; i < list.length; i++) {
      if (list[i].id) byId[list[i].id] = list[i];
    }
    var changed = [];
    for (var id in data) {
      if (!Object.prototype.hasOwnProperty.call(data, id)) continue;
      var rec = byId[id];
      if (!rec) continue;
      var el = rec.el;
      if (!accept(el, rec.dup)) continue;
      var v = data[id];

      if (isCheckable(el)) {
        if (typeof v !== 'boolean') continue;
        if (!!el.checked === v) continue;
        el.checked = v;
        changed.push(el);
        continue;
      }

      if (String(el.tagName || '').toLowerCase() === 'select') {
        var st = applyToSelect(el, v);
        if (st === 'pending') watchPendingSelect(el, id, v);  // 选项还没填充出来，等它就绪再补
        else if (st === 'applied') changed.push(el);
        continue;
      }

      if (v === null || v === undefined || v === '') continue;
      var sv = String(v);
      if (typeOf(el) === 'number' && !isFinite(parseFloat(sv))) continue;
      if (String(el.value) === sv) continue;
      el.value = sv;
      changed.push(el);
    }

    // 派发事件，让页面自己的 State / 联动 / 校验跟上（与用户手填一致）
    for (var c = 0; c < changed.length; c++) fireChange(changed[c]);
    if (changed.length) {
      try {
        document.dispatchEvent(new CustomEvent('pcb:prefs-restored', {
          detail: { page: pageName(), count: changed.length }
        }));
      } catch (e) {}
    }
    syncResetButton();
    return changed.length;
  }

  /* ---------- 清除 ---------- */

  function clear(name) {
    var all = readAll();
    delete all[name || pageName()];
    writeAll(all);
    syncResetButton();
    return true;
  }

  function clearAll() {
    writeAll({});
    syncResetButton();
    return true;
  }

  function storedCount(name) {
    var pg = readPage(name);
    return pg ? Object.keys(pg).length : 0;
  }

  /* ---------- 「恢复默认值」按钮 ---------- */

  function syncResetButton() {
    var btn = document.getElementById('btnUiPrefsReset');
    if (!btn) return;
    var n = storedCount();
    btn.style.display = n > 0 ? '' : 'none';
    btn.title = '本页已记住 ' + n + ' 项上次填写/选择的值，点击全部清除并恢复出厂默认';
    var cnt = btn.querySelector('[data-prefs-count]');
    if (cnt) cnt.textContent = n > 0 ? ' (' + n + ')' : '';
  }

  function injectResetButton() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('btnUiPrefsReset')) return;
    var host = document.querySelector('.global-display-ctrl');
    if (!host) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btnUiPrefsReset';
    btn.className = 'gdisp-btn';
    btn.style.display = 'none';
    btn.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5V6h3.5"/></svg>' +
      '<span>恢复默认值<span data-prefs-count></span></span>';
    btn.addEventListener('click', function () {
      var n = storedCount();
      var ok = true;
      try { ok = window.confirm('将清除本页记住的 ' + n + ' 项填写/选择值，恢复出厂默认并刷新页面，继续？'); }
      catch (e) { ok = true; }
      if (ok === false) return;   // jsdom / 被拦截时返回 undefined，按「确认」处理
      clear();
      try { location.reload(); } catch (e) {}
    });
    host.appendChild(btn);
    syncResetButton();
  }

  /* ---------- 事件绑定 ---------- */

  var saveTimer = null;
  function scheduleSave(el) {
    if (el && el.id) { saveEl(el); return; }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; saveNow(); }, SAVE_DEBOUNCE_MS);
  }

  function onFieldEvent(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    var tag = String(el.tagName).toLowerCase();
    if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return;
    scheduleSave(el);
  }

  function init() {
    injectResetButton();
    restore();
    document.addEventListener('change', onFieldEvent, true);
    document.addEventListener('input', onFieldEvent, true);
    // 关页/切页/刷新前兜底：把通过脚本改过的值（预设方案按钮、历史值圆钮等）也落盘
    window.addEventListener('pagehide', function () { try { saveNow(); } catch (e) {} });
    window.addEventListener('beforeunload', function () { try { saveNow(); } catch (e) {} });
  }

  var api = {
    KEY: STORE_KEY,
    pendingSelects: function () { return pendingSelects.slice(); },
    page: pageName,
    restore: restore,
    save: saveEl,
    saveNow: saveNow,
    clear: clear,
    clearAll: clearAll,
    storedCount: storedCount,
    read: readPage,
    _accept: accept,
    _scan: scan
  };

  if (typeof window !== 'undefined') window.UiPrefs = api;
  if (typeof document === 'undefined') return;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init(); // 脚本被后置注入（自动化测试 / 动态加载）时立即生效
  }
})();
