/* ============================================================================
 * dom-utils.js —— 全站基础安全转义、文本编码识别与数值工具
 * 不可信外部 TXT 字段写入 innerHTML 前必须调用 escHtml()
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var api = factory();
    root.DomUtils = api;
    if (!root.escHtml) root.escHtml = api.escHtml;
    if (!root.decodeTxt) root.decodeTxt = api.decodeTxt;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function escHtml(val) {
    return String(val == null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function decodeTxt(buffer) {
    if (typeof buffer === 'string') return buffer;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (e) {
      try {
        return new TextDecoder('gb18030').decode(buffer);
      } catch (e2) {
        return new TextDecoder().decode(buffer);
      }
    }
  }

  function safeNum(v, fallback) {
    var n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  return {
    escHtml: escHtml,
    decodeTxt: decodeTxt,
    safeNum: safeNum
  };
});
