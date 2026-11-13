/* ============================================================================
 * copper-state.js —— 约束检查模块状态管理、叠层识别、文件队列与全局钩子
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var CP = root.ConstraintParser;
  var CC = root.CopperCheck;

  var S = { sets: [], queue: [], stack: 0 };
  var UI = {
    items: [],
    result: null,
    onlyBad: false,
    resFilter: '',
    resRule: '',
    resSearch: '',
    matchFilter: '',
    reviewed: {},
    runSeq: 0,
    dataVer: 0,
    viewVer: 0,
    matchLimit: 300,
    resLimit: 120,
    matchMs: 0,
    resMs: 0
  };
  var qseq = 1;
  var stackCache = { key: '', n: 0 };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function nowMs() {
    return (root.performance && root.performance.now) ? root.performance.now() : Date.now();
  }

  function viewMs(t0) {
    return Math.round(nowMs() - t0);
  }

  function autoLayerCount() {
    var key = (S.sets || []).length + '#' +
      (S.sets || []).map(function (s) { return (s.title || '').length + (s.constraints || []).length; }).join(',') + '#' +
      (S.queue || []).map(function (f) { return (f.text || '').length; }).join(',');
    if (stackCache.key === key && stackCache.n) return stackCache.n;
    var n = S.stack || 0;
    var bump = function (txt) {
      var m = String(txt || '').match(/L\s*(\d+)/i);
      if (m) n = Math.max(n, +m[1]);
    };
    (S.sets || []).forEach(function (set) {
      var fan = CP.fanLayerOf(set);
      (set.constraints || []).forEach(function (c) {
        (c.scopes || []).forEach(function (sc) {
          var s = String(sc.scope || '');
          if (/扇出|出线/.test(s)) return;
          bump(s);
        });
        Object.keys(c.values || {}).forEach(function (k) {
          var m = /^L(\d+)$/.exec(k);
          if (m && +m[1] !== fan) n = Math.max(n, +m[1]);
        });
      });
      if (fan && !n) n = fan;
    });
    (S.queue || []).forEach(function (f) {
      String(f.text || '').split(/\r?\n/).forEach(function (line) {
        if (/扇出|出线|总层数/.test(line)) return;
        bump(line);
      });
    });
    n = n > 0 ? n : 18;
    stackCache = { key: key, n: n };
    return n;
  }

  function manualStack() {
    var el = $('inpN');
    if (!el) return 0;
    var v = parseInt(el.value, 10);
    return (v >= 1 && v <= 64) ? v : 0;
  }

  function layerCount() {
    return manualStack() || autoLayerCount();
  }

  function updateStackHints() {
    var auto = autoLayerCount(), manual = manualStack(), eff = manual || auto;
    var hint = $('autoNHint');
    if (hint) {
      hint.textContent = manual
        ? ('当前手动设为 ' + manual + ' 层，自动识别为 ' + auto + ' 层。')
        : ('当前按自动识别：' + auto + ' 层。');
    }
    var sh = $('stackHint');
    if (sh) {
      sh.textContent = '叠层：L1 为表层，L' + eff + ' 为底层 · ' + (manual ? ('手动设置 ' + manual + ' 层') : ('按 TXT 自动识别 ' + auto + ' 层'));
    }
    syncCopperTelemetry();
    return eff;
  }

  function reexpandAll() {
    CP.expandConstraintSets(S.sets, layerCount());
  }

  function syncCopperTelemetry() {
    var host = $('edaDockTelemetry');
    if (!host) return;
    var eff = manualStack() || autoLayerCount();
    var r = UI.result;
    var bad = r ? r.groups.reduce(function (n, g) { return n + (g.failCount || 0); }, 0) : 0;
    var cells = [
      { k: '有效叠层', v: eff + ' 层', cls: '' },
      { k: '约束条数', v: String((S.sets || []).length), cls: (S.sets || []).length ? 'ok' : '' },
      { k: '过孔总数', v: r ? String(r.viaCount) : '—', cls: '' },
      { k: '不符合项', v: r ? String(bad) : '—', cls: r ? (bad > 0 ? 'bad' : 'ok') : '' }
    ];
    host.innerHTML = cells.map(function (c) {
      return '<div class="eda-tele-cell ' + c.cls + '"><div class="k">' + esc(c.k) + '</div><div class="v">' + esc(c.v) + '</div></div>';
    }).join('');
  }

  function showBox(name, text, hint) {
    var mask = $('expMask');
    if (!mask) return;
    mask.style.display = 'flex';
    mask.innerHTML =
      '<div class="expbox"><h2>' + esc(name) + '</h2><div class="hint">' + esc(hint || '') + '</div>' +
      '<div class="row" style="margin-top:10px">' +
      '<a class="btn" id="expLink">下载文件</a>' +
      '<button type="button" class="btn ghost" id="expCopy">复制全部</button>' +
      '<button type="button" class="btn gray" id="expClose">关闭</button>' +
      '</div><textarea id="expText" data-no-persist readonly></textarea></div>';
    $('expText').value = text;
    var mime = /\.csv$/i.test(name) ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
    var url = '';
    try { url = URL.createObjectURL(new Blob([text], { type: mime })); }
    catch (e) { url = 'data:' + mime + ',' + encodeURIComponent(text); }
    $('expLink').href = url;
    $('expLink').download = name;
    $('expClose').onclick = function () { mask.style.display = 'none'; };
    $('expCopy').onclick = function () {
      var ta = $('expText');
      ta.focus();
      ta.select();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { $('expCopy').textContent = '已复制'; });
      }
    };
  }

  function visiblePin() {
    var list = [$('pin'), $('pinB')].filter(Boolean);
    for (var i = 0; i < list.length; i++) {
      if (list[i].offsetParent !== null || list[i].getClientRects().length) return list[i];
    }
    return list[0] || null;
  }

  var pinRaf = false, pinHSeen = -1;
  function syncPinNow() {
    var pin = visiblePin();
    if (!pin) return;
    var ph = pin.offsetHeight;
    if (ph !== pinHSeen) {
      pinHSeen = ph;
      if (ph) document.documentElement.style.setProperty('--pin-h', ph + 'px');
    }
  }

  function syncPin() {
    if (pinRaf) return;
    pinRaf = true;
    var run = function () { pinRaf = false; syncPinNow(); };
    if (root.requestAnimationFrame) root.requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function showTab(name) {
    ['rules', 'sets', 'data', 'result', 'legend'].forEach(function (t) {
      var sec = $('tab-' + t);
      if (sec) sec.className = 'tab' + (t === name ? ' active' : '');
    });
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    if (name === 'data' && root.renderMatch) root.renderMatch();
    if (name === 'result' && UI.result && root.renderResults) root.renderResults();
    if (name === 'sets' && root.render) root.render();
    if (name === 'legend' && root.renderLegend) root.renderLegend(true);
    syncPin();
    if (root.EdaShell && typeof root.EdaShell.syncStageBar === 'function') {
      root.EdaShell.syncStageBar();
    }
    syncCopperTelemetry();
  }

  function addFiles(fileList) {
    var jobs = [];
    Array.prototype.forEach.call(fileList || [], function (file) {
      if (!file) return;
      var ext = (file.name && file.name.indexOf('.') >= 0 ? (file.name.split('.').pop() || '') : '').toLowerCase();
      var id = qseq++;
      var name = file.name || ('导入-' + id + '.txt');
      var ok = ext === 'txt' || file.type === 'text/plain' || file.type === '';
      if (!ok || (ext && ext !== 'txt' && file.type !== 'text/plain')) {
        S.queue.push({ id: id, name: name, text: '', status: '仅支持 TXT' });
        return;
      }
      jobs.push({ id: id, name: name, file: file });
    });
    if (!jobs.length) {
      if (root.render) root.render();
      if ($('genHint')) $('genHint').textContent = '没有可导入的 TXT。';
      return;
    }
    var left = jobs.length;
    jobs.forEach(function (job) {
      var fr = new FileReader();
      fr.onload = function () {
        var dec = CP.decodeBuffer(fr.result);
        var bad = (dec.text.match(/\uFFFD/g) || []).length;
        S.queue.push({
          id: job.id,
          name: job.name,
          text: dec.text,
          enc: dec.enc,
          status: bad ? ('已按 ' + dec.enc + ' 读取，含替换符') : ('已按 ' + dec.enc + ' 读取')
        });
        left--;
        if (left === 0 && root.rebuild) root.rebuild();
      };
      fr.onerror = function () {
        S.queue.push({ id: job.id, name: job.name, text: '', status: '读取失败' });
        left--;
        if (left === 0 && root.rebuild) root.rebuild();
      };
      fr.readAsArrayBuffer(job.file);
    });
  }

  function rebuild() {
    var sets = [];
    S.queue.forEach(function (item) {
      if (!item.text) return;
      var parsed = CP.parseConstraintText(item.text, item.name);
      if (parsed.length) {
        parsed.forEach(function (set) {
          set.source = item.name;
          set.constraints = CP.buildConstraints(set.rules || []);
          sets.push(set);
        });
        var colCnt = parsed.reduce(function (a, s) { return a + (s.constraints || []).length; }, 0);
        item.status = '已生成 ' + parsed.length + ' 条约束 · ' + colCnt + ' 列参数';
      } else {
        item.status = '未识别到参数行或约束表';
      }
    });
    S.sets = sets;
    reexpandAll();
    var n = S.sets.reduce(function (a, s) { return a + (s.constraints || []).length; }, 0);
    var nSets = S.sets.length;
    if ($('genHint')) {
      $('genHint').textContent = n
        ? ('已生成 ' + nSets + ' 条约束 / ' + n + ' 列参数，已展开至各层。')
        : '未识别到有效约束，请核对 TXT 格式。';
    }
    if (root.render) root.render();
    syncCopperTelemetry();
    if (n) {
      showTab('sets');
    }
  }

  /* 暴露页面及测试所需的全局函数与状态 */
  root.S = S;
  root.UI = UI;
  root.esc = esc;
  root.autoLayerCount = autoLayerCount;
  root.manualStack = manualStack;
  root.layerCount = layerCount;
  root.updateStackHints = updateStackHints;
  root.reexpandAll = reexpandAll;
  root.addFiles = addFiles;
  root.rebuild = rebuild;
  root.showTab = showTab;
  root.switchTab = showTab;
  root.showBox = showBox;
  root.syncPin = syncPin;

  /* 同步暴露 ConstraintParser 工具函数，兼容单测调用 */
  root.parseConstraintText = CP.parseConstraintText;
  root.makeConstraintName = CP.makeConstraintName;
  root.fanLayerOf = CP.fanLayerOf;
  root.buildConstraints = CP.buildConstraints;
  root.maxLayer = CP.maxLayer;
  root.chipMeta = CP.chipMeta;
  root.orderChips = CP.orderChips;
  root.chipShort = CP.chipShort;
  root.chipD2M = CP.chipD2M;

  root.CopperApp = {
    S: S,
    UI: UI,
    $: $,
    esc: esc,
    nowMs: nowMs,
    viewMs: viewMs,
    layerCount: layerCount,
    updateStackHints: updateStackHints,
    reexpandAll: reexpandAll,
    syncPin: syncPin,
    syncTelemetry: syncCopperTelemetry,
    showBox: showBox,
    showTab: showTab,
    addFiles: addFiles,
    rebuild: rebuild
  };
})(typeof window !== 'undefined' ? window : globalThis);
