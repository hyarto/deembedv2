/* ============================================================================
 * ui-prefs.js —— 全站「界面参数记忆」模块
 * 按「页面文件名 + 控件 id」命名空间持久化至 localStorage，刷新后自动回填并派发事件
 * ========================================================================== */
(function () {
  'use strict';

  var STORE_KEY = 'pcbchecker.uiprefs.v1';
  var SAVE_DEBOUNCE_MS = 60;
  var restoring = false;
  var pendingSelects = [];

  function pageName() {
    var p = (typeof location !== 'undefined' && location.pathname) ? location.pathname : '';
    var seg = p.split('/').filter(Boolean).pop() || 'index.html';
    return /\.html?$/i.test(seg) ? seg.toLowerCase() : (seg.toLowerCase() + '.html');
  }

  function readAll() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return {};
      var obj = JSON.parse(raw);
      return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
    } catch (e) {
      return {};
    }
  }

  function writeAll(obj) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  }

  function readPage(name) {
    var all = readAll();
    var pg = all[name || pageName()];
    return (pg && typeof pg === 'object' && !Array.isArray(pg)) ? pg : {};
  }

  function scan() {
    var nodes = document.querySelectorAll('input, select, textarea');
    var idCount = {};
    var i, id;
    for (i = 0; i < nodes.length; i++) {
      id = nodes[i].id;
      if (id) idCount[id] = (idCount[id] || 0) + 1;
    }
    var out = [];
    for (i = 0; i < nodes.length; i++) {
      id = nodes[i].id || '';
      out.push({ el: nodes[i], id: id, dup: id ? idCount[id] : 0 });
    }
    return out;
  }

  function typeOf(el) {
    var tag = (el.tagName || '').toLowerCase();
    if (tag !== 'input') return tag;
    return String(el.getAttribute('type') || 'text').toLowerCase();
  }

  function hasNoPersist(el) {
    var cur = el;
    while (cur && cur.nodeType === 1) {
      if (cur.hasAttribute('data-no-persist')) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function accept(el, dupCount) {
    if (!el || !el.id) return false;
    if (dupCount > 1) return false;
    if (hasNoPersist(el)) return false;
    if (el.readOnly || el.disabled) return false;
    var t = typeOf(el);
    if (t === 'textarea') return false;
    if (t === 'file' || t === 'button' || t === 'submit' || t === 'reset' || t === 'hidden' || t === 'image') {
      return false;
    }
    return true;
  }

  function isCheckable(el) {
    var t = typeOf(el);
    return t === 'checkbox' || t === 'radio';
  }

  function readValue(el) {
    if (isCheckable(el)) return !!el.checked;
    return String(el.value == null ? '' : el.value);
  }

  function isDuplicateId(id) {
    var all = document.querySelectorAll('[id]');
    var n = 0;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id && ++n > 1) return true;
    }
    return false;
  }

  function saveEl(el) {
    if (restoring) return false;
    if (!el || !el.id) return false;
    if (isDuplicateId(el.id)) return false;
    if (!accept(el, 1)) return false;
    var all = readAll();
    var p = pageName();
    if (!all[p] || typeof all[p] !== 'object') all[p] = {};
    all[p][el.id] = readValue(el);
    var ok = writeAll(all);
    syncResetButton();
    return ok;
  }

  function saveNow() {
    if (restoring) return 0;
    var rows = scan();
    var all = readAll();
    var p = pageName();
    var bucket = (all[p] && typeof all[p] === 'object') ? all[p] : {};
    var n = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!accept(r.el, r.dup)) continue;
      bucket[r.id] = readValue(r.el);
      n++;
    }
    if (n > 0) {
      all[p] = bucket;
      writeAll(all);
    }
    syncResetButton();
    return n;
  }

  function applyToSelect(el, v) {
    var s = String(v);
    var opts = el.options;
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].value === s) {
        if (el.value === s) return 'same';
        el.value = s;
        return 'applied';
      }
    }
    return 'missing';
  }

  function watchPendingSelect(el, id, v) {
    if (typeof MutationObserver === 'undefined') return;
    var item = { id: id, el: el, value: String(v), obs: null };
    var obs = new MutationObserver(function () {
      var res = applyToSelect(el, item.value);
      if (res === 'applied' || res === 'same') {
        obs.disconnect();
        var k = pendingSelects.indexOf(item);
        if (k >= 0) pendingSelects.splice(k, 1);
        if (res === 'applied') fireChange(el);
      }
    });
    item.obs = obs;
    pendingSelects.push(item);
    obs.observe(el, { childList: true, subtree: true });
  }

  function fireChange(el) {
    var prev = restoring;
    restoring = true;
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {
    } finally {
      restoring = prev;
    }
  }

  function restore() {
    var saved = readPage();
    var ids = Object.keys(saved);
    if (!ids.length) { syncResetButton(); return 0; }

    var rows = scan();
    var map = {};
    var i;
    for (i = 0; i < rows.length; i++) {
      if (accept(rows[i].el, rows[i].dup)) map[rows[i].id] = rows[i].el;
    }

    var changed = [];
    restoring = true;
    try {
      for (i = 0; i < ids.length; i++) {
        var id = ids[i];
        var el = map[id];
        if (!el) continue;
        var v = saved[id];
        var t = typeOf(el);

        if (t === 'checkbox' || t === 'radio') {
          if (typeof v !== 'boolean') continue;
          if (el.checked !== v) {
            el.checked = v;
            changed.push(el);
          }
        } else if (t === 'select') {
          if (v == null || typeof v === 'boolean') continue;
          var r = applyToSelect(el, v);
          if (r === 'applied') changed.push(el);
          else if (r === 'missing' && String(v) !== '') watchPendingSelect(el, id, v);
        } else if (t === 'number') {
          if (v === '' || v == null || typeof v === 'boolean') continue;
          if (!isFinite(Number(v))) continue;
          var ns = String(v);
          if (el.value !== ns) {
            el.value = ns;
            changed.push(el);
          }
        } else {
          if (v == null || typeof v === 'boolean') continue;
          var s = String(v);
          if (el.value !== s) {
            el.value = s;
            changed.push(el);
          }
        }
      }
    } finally {
      restoring = false;
    }

    for (i = 0; i < changed.length; i++) fireChange(changed[i]);
    syncResetButton();
    return changed.length;
  }

  function clear(name) {
    var all = readAll();
    var p = name || pageName();
    if (p in all) {
      delete all[p];
      writeAll(all);
    }
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

  function syncResetButton() {
    var btn = document.getElementById('btnUiPrefsReset');
    if (!btn) return;
    var n = storedCount();
    btn.style.display = n > 0 ? '' : 'none';
    btn.setAttribute('data-tip', '已记忆本页 ' + n + ' 项参数，点击清除并恢复默认配置');
    var cnt = btn.querySelector('[data-prefs-count]');
    if (cnt) cnt.textContent = n > 0 ? ' · ' + n : '';
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
    btn.innerHTML = '<span>恢复默认值<span data-prefs-count></span></span>';
    btn.addEventListener('click', function () {
      var n = storedCount();
      var ok = true;
      try { ok = window.confirm('清除本页记忆的 ' + n + ' 项参数并恢复默认？'); }
      catch (e) { ok = true; }
      if (ok === false) return;
      clear();
      try { location.reload(); } catch (e) {}
    });
    host.appendChild(btn);
    syncResetButton();
  }

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
    init();
  }
})();
