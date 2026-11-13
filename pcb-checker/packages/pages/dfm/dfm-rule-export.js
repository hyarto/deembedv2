/* ============================================================================
 * dfm-rule-export.js —— DFM 加工能力规则 JSON 导出窗口
 * 受限预览 iframe 里浏览器可能拦截自动下载，先弹出可复制的 JSON，
 * 再由用户选择复制或下载，避免点击后无反应。
 * ========================================================================== */
(function (root) {
  "use strict";

  var App = root.DfmApp;
  var DIALOG_ID = 'dfmRuleExportDialog';

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  function button(label, primary, handler) {
    var b = el('button', 'btn small ' + (primary ? 'pri' : 'sec'), label);
    b.type = 'button';
    b.addEventListener('click', handler);
    return b;
  }

  function fileName() {
    return 'PCB_加工能力规则_' + new Date().toISOString().slice(0, 10) + '.json';
  }

  function download(json, setStatus) {
    try {
      var blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = fileName();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      setStatus('已发起下载 ' + fileName() + '，被浏览器拦截时复制文本框内容另存为 .json');
    } catch (err) {
      setStatus('下载未能启动，复制文本框内容另存为 .json');
    }
  }

  function copy(json, area, setStatus) {
    area.focus(); area.select();
    var done = function () { setStatus('JSON 已复制'); };
    var fallback = function () {
      try { if (document.execCommand('copy')) { done(); return; } } catch (e) { /* 走选中提示 */ }
      setStatus('已选中 JSON，按 Ctrl+C 复制，Mac 用 Command+C');
    };
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      root.navigator.clipboard.writeText(json).then(done, fallback);
    } else {
      fallback();
    }
  }

  function close() {
    var old = document.getElementById(DIALOG_ID);
    if (old) old.remove();
  }

  /** 弹出导出窗口；已存在时先关闭重建，返回遮罩节点。 */
  function open(json) {
    close();
    var overlay = el('div', 'dfm-export-overlay');
    overlay.id = DIALOG_ID;
    var panel = el('div', 'dfm-export-panel');
    var area = el('textarea', 'dfm-export-json');
    area.id = 'dfmRuleExportJson'; area.readOnly = true; area.value = json;
    area.setAttribute('data-no-persist', '');
    var status = el('div', 'hint');
    status.setAttribute('role', 'status');
    var setStatus = function (t) { status.textContent = t; };
    var actions = el('div', 'dfm-export-actions');
    actions.append(
      button('复制 JSON', false, function () { copy(json, area, setStatus); }),
      button('下载 JSON', true, function () { download(json, setStatus); }),
      button('关闭', false, close)
    );
    panel.append(
      el('h2', '', '保存加工能力规则'),
      el('div', 'hint', '规则已整理为 JSON：判定方式、孔盘与钻孔参数、分层规则、Padstack 尺寸覆盖。'),
      area, status, actions
    );
    overlay.appendChild(panel);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function onEscape(e) {
      if (!document.getElementById(DIALOG_ID)) { document.removeEventListener('keydown', onEscape); return; }
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEscape); }
    });
    document.body.appendChild(overlay);
    area.focus();
    return overlay;
  }

  var RuleExport = { open: open, close: close, fileName: fileName };
  App.RuleExport = RuleExport;
  root.DfmRuleExport = RuleExport;
})(typeof window !== "undefined" ? window : globalThis);
