/* ============================================================================
 * trace-state.js —— 走线检查模块状态管理、TXT 解析分流与导出弹窗
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var TE = root.TraceEngine;
  var esc = TE.esc;

  var S = {
    rawText: '',
    fileName: '',
    format: '',
    meta: null,
    grid: null,
    map: { net: 0, layer: 1, width: 2, length: 3 },
    records: [],
    netLens: new Map(),
    unit: 'mil',
    rules: [],
    defaultRule: null,
    checkRes: null,
    tol: 0.001,
    checkWidth: true,
    checkLen: true,
    checkWidthLen: true,
    checkRad: true,
    diffTol: 1,
    totalDiffTol: 1,
    checkLayerDiff: true,
    checkTotalDiff: true,
    diffPairs: [],
    diffInfo: null,
    diffDone: false,
    diffReviewed: new Set(),
    traceReviewed: new Set(),
    page: 0,
    pageSize: 200,
    sort: { col: null, dir: 1 },
    ovOpenLayer: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  function switchTab(name) {
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    document.querySelectorAll('section.tab').forEach(function (s) {
      s.classList.toggle('active', s.id === 'tab-' + name);
    });
    if (root.EdaShell && typeof root.EdaShell.syncStageBar === 'function') {
      root.EdaShell.syncStageBar();
      root.EdaShell.syncTelemetry();
    }
  }

  function loadFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var buf = new Uint8Array(fr.result);
      var text = '';
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch (e) {
        text = new TextDecoder('gbk').decode(buf);
      }
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      S.rawText = text;
      S.fileName = file.name;
      $('fileNameLabel').textContent = '已载入：' + file.name + ' · ' + (file.size / 1024).toFixed(1) + ' KB';
      $('pasteBox').value = '';
      handleText();
    };
    fr.readAsArrayBuffer(file);
  }

  function renderGridPreview() {
    var g = S.grid;
    if (!g) return;
    var h = '<thead><tr><th>行号</th>' + g.headers.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>';
    g.rows.slice(0, 50).forEach(function (r) {
      h += '<tr><td class="kv">' + r.line + '</td>' + r.fields.map(function (f) { return '<td>' + esc(f) + '</td>'; }).join('') + '</tr>';
    });
    $('gridPreview').innerHTML = h + '</tbody>';
  }

  function reparseTable(autoApply) {
    var v = $('selDelim') ? $('selDelim').value : 'auto';
    var delim = v === 'auto' ? TE.detectDelimiter(S.rawText) : v;
    var hasHdr = $('chkHeader') ? $('chkHeader').checked : true;
    S.grid = TE.parseDelimited(S.rawText, delim, hasHdr);
    if ($('parseCard')) $('parseCard').style.display = '';
    ['mapNet', 'mapLayer', 'mapWidth', 'mapLength'].forEach(function (id) {
      var sel = $(id);
      if (sel) {
        sel.innerHTML = S.grid.headers.map(function (h, j) {
          return '<option value="' + j + '">' + esc(h || ('列' + (j + 1))) + '</option>';
        }).join('');
      }
    });
    var am = TE.autoMapColumns(S.grid.headers);
    if (am.net >= 0 && $('mapNet')) $('mapNet').value = am.net;
    if (am.layer >= 0 && $('mapLayer')) $('mapLayer').value = am.layer;
    if (am.width >= 0 && $('mapWidth')) $('mapWidth').value = am.width;
    if (am.length >= 0 && $('mapLength')) $('mapLength').value = am.length;
    renderGridPreview();
    if (autoApply === true) {
      applyData();
    }
  }

  function applyData() {
    if (S.format === 'block') {
      S.records = TE.parseBlockText(S.rawText);
    } else {
      S.map = {
        net: Number($('mapNet').value),
        layer: Number($('mapLayer').value),
        width: Number($('mapWidth').value),
        length: Number($('mapLength').value)
      };
      S.records = TE.recordsFromGrid(S.grid, S.map);
    }
    S.unit = $('selUnit').value;
    S.netLens = TE.aggregateRecords(S.records).netLens;
    if (S.format === 'block') {
      S.meta = TE.parseBlockMeta(S.rawText);
      var blockCount = S.meta.items != null ? S.meta.items : null;
      var mismatch = S.meta.declared != null && blockCount != null && S.meta.declared !== blockCount;
      var skippedNonTrace = blockCount != null && blockCount > S.records.length ? blockCount - S.records.length : 0;
      $('hdrMeta').textContent = (S.fileName || '') + ' · 文件声明 ' + (S.meta.declared != null ? S.meta.declared : '?') +
        ' 个 Item / 解析 ' + S.records.length + ' 条记录 / ' + S.netLens.size + ' 个网络' +
        (skippedNonTrace ? ' / 跳过非走线元素 ' + skippedNonTrace + ' 项' : '') +
        (mismatch ? ' · 声明与解析块数不一致' : '');
    } else {
      $('hdrMeta').textContent = (S.fileName || '') + ' · 解析 ' + S.records.length + ' 条记录 / ' + S.netLens.size + ' 个网络';
    }
    S.checkRes = null;
    S.diffDone = false;
    if (root.TraceApp && typeof root.TraceApp.renderOverview === 'function') {
      root.TraceApp.renderOverview();
    }
    switchTab('overview');
  }

  function handleText() {
    if (!S.rawText.trim()) {
      alert('输入内容为空');
      return;
    }
    S.unit = $('selUnit') ? $('selUnit').value : 'mil';
    if (TE.isBlockFormat(S.rawText)) {
      S.format = 'block';
      S.meta = TE.parseBlockMeta(S.rawText);
      $('fmtLabel').textContent = '识别格式：网络走线报告 · 文件声明 ' + (S.meta.declared != null ? S.meta.declared : '?') + ' 个 Item，识别到 ' + S.meta.items + ' 个 Item 块';
      if ($('parseCard')) $('parseCard').style.display = 'none';
      if ($('blockCard')) $('blockCard').style.display = '';
      var idxs = [];
      var re = /^Item\s+\d+/gim;
      var mm;
      while ((mm = re.exec(S.rawText)) && idxs.length < 3) idxs.push(mm.index);
      var end = idxs.length > 2 ? idxs[2] : S.rawText.length;
      if ($('blockPreview')) $('blockPreview').textContent = S.rawText.slice(0, end);
      applyData();
    } else {
      S.format = 'table';
      $('fmtLabel').textContent = '识别格式：分隔表格文本';
      if ($('blockCard')) $('blockCard').style.display = 'none';
      reparseTable(true);
    }
  }

  function fileUrl(data, mime) {
    try {
      if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        if (data instanceof Blob) return URL.createObjectURL(data);
        if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
          return URL.createObjectURL(new Blob([data], { type: mime || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        }
        return URL.createObjectURL(new Blob([data], { type: mime || 'text/csv;charset=utf-8' }));
      }
    } catch (e) {}
    if (typeof data === 'string') {
      return 'data:' + (mime || 'text/csv;charset=utf-8') + ',' + encodeURIComponent(data);
    }
    if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
      try {
        var binary = '';
        var bytes = new Uint8Array(data);
        for (var i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        if (typeof btoa !== 'undefined') {
          return 'data:' + (mime || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') + ';base64,' + btoa(binary);
        }
      } catch (e) {}
    }
    return '';
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return ok;
  }

  function tryTriggerDownload(name, data, mime) {
    try {
      var url = fileUrl(data, mime);
      if (!url) return false;
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        a.remove();
        if (url.indexOf('blob:') === 0) {
          try { URL.revokeObjectURL(url); } catch (e) {}
        }
      }, 2000);
      return true;
    } catch (e) {
      return false;
    }
  }

  function showExportBox(name, data, hint, previewText) {
    var isXlsx = /\.xlsx$/i.test(name);
    var plain = previewText != null
      ? String(previewText).replace(/^\uFEFF/, '')
      : (typeof data === 'string' ? String(data).replace(/^\uFEFF/, '') : '');
    var mask = $('expMask');
    if (!mask) {
      mask = document.createElement('div');
      mask.id = 'expMask';
      document.body.appendChild(mask);
    }
    mask.style.display = 'flex';
    mask.innerHTML =
      '<div class="expbox" role="dialog">' +
        '<h2 id="expTitle"></h2><div class="hint" id="expMsg"></div>' +
        '<div class="row" style="margin:10px 0;gap:8px">' +
          '<a class="btn" id="expLink">下载文件</a>' +
          '<button type="button" class="btn ghost" id="expCopy">复制表格内容</button>' +
          '<button type="button" class="btn gray" id="expClose">关闭</button>' +
        '</div>' +
        '<textarea id="expText" data-no-persist readonly></textarea>' +
      '</div>';
    $('expTitle').textContent = '已生成 ' + name;
    $('expText').value = plain;
    var n = Math.max(0, plain.split(/\r?\n/).filter(Boolean).length - 1);
    var msg = $('expMsg');
    msg.textContent = hint || (isXlsx
      ? ('已生成 ' + n + ' 行汇总报表，可下载 Excel 文件或复制文本。')
      : ('共 ' + n + ' 行记录，可下载文件或复制文本。'));
    var link = $('expLink');
    link.textContent = isXlsx ? '下载 Excel 文件' : '下载文件';
    var mime = isXlsx
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : (name.endsWith('.json') ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8');
    var url = fileUrl(data, mime);
    link.href = url;
    link.download = name;
    $('expClose').onclick = function () {
      mask.style.display = 'none';
      if (url.indexOf('blob:') === 0) {
        try { URL.revokeObjectURL(url); } catch (e) {}
      }
    };
    mask.onclick = function (e) {
      if (e.target === mask) $('expClose').click();
    };
    $('expCopy').onclick = function () {
      var done = function (ok) { $('expCopy').textContent = ok ? '已复制表格文本' : '请全选后复制'; };
      var ta = $('expText');
      ta.focus();
      ta.select();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(plain).then(function () { done(true); }).catch(function () { done(fallbackCopy(plain)); });
      } else {
        done(fallbackCopy(plain));
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText && !isXlsx) {
      navigator.clipboard.writeText(plain).then(function () {
        msg.textContent = hint ? ('已复制到剪贴板。' + hint) : ('已复制到剪贴板，共 ' + n + ' 行。');
      }).catch(function () {});
    }
    tryTriggerDownload(name, data, mime);
  }

  function download(name, text, hint) {
    showExportBox(name, text, hint);
  }

  root.S = S;
  root.switchTab = switchTab;
  root.showExportBox = showExportBox;
  root.TraceApp = Object.assign(root.TraceApp || {}, {
    S: S,
    $: $,
    switchTab: switchTab,
    loadFile: loadFile,
    handleText: handleText,
    reparseTable: reparseTable,
    renderGridPreview: renderGridPreview,
    applyData: applyData,
    showExportBox: showExportBox,
    download: download
  });
})(typeof window !== 'undefined' ? window : globalThis);
