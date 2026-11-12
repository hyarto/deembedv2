/* ============================================================================
 * copper-sets-ui.js —— 约束检查模块：规则导入队列、生成的约束矩阵与本地存取
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var App = root.CopperApp;
  var CP = root.ConstraintParser;
  var S = App.S;
  var UI = App.UI;
  var $ = App.$;
  var esc = App.esc;

  function renderFiles() {
    var box = $('fileList');
    if (!box) return;
    box.innerHTML = S.queue.map(function (f) {
      return '<div class="fileblock"><span class="filechip"><b>' + esc(f.name) + '</b> ' + esc(f.status) +
        ' <button type="button" class="btn gray small" data-act="delq" data-id="' + f.id + '">移除</button></span>' +
        (f.text ? '<details style="margin-top:4px"><summary class="hint">原文预览' + (f.enc ? ' · ' + esc(f.enc) : '') + '</summary><pre class="ocr">' + esc(f.text.slice(0, 2500)) + '</pre></details>' : '') +
        '</div>';
    }).join('');
  }

  function jumpItems() {
    var byKind = function (set) {
      var title = String(set.title || '');
      var kind = set.kind || '';
      if (/BGA/i.test(kind) || /BGA/i.test(title)) return 'BGA';
      if (/SMA/i.test(kind) || /SMA/i.test(title)) {
        if (/(?:^|[^A-Za-z])Top(?![A-Za-z])/i.test(title)) return 'SMA · Top 面';
        if (/(?:^|[^A-Za-z])(?:Bot|BotTOM)(?![A-Za-z])/i.test(title)) return 'SMA · bottom 面';
        return 'SMA · 未标面';
      }
      return kind || '其他';
    };

    var items = S.sets.map(function (set, si) {
      var title = String(set.title || '');
      var m = CP.chipMeta(title);
      return { set: set, si: si, group: byKind(set), layer: m.layer, d2m: m.d2m, title: title, kind: set.kind || '其他' };
    });

    var rank = { 'BGA': 0, 'SMA · Top 面': 1, 'SMA · bottom 面': 2, 'SMA · 未标面': 3 };
    items.sort(function (a, b) {
      var ra = rank[a.group] === undefined ? 9 : rank[a.group];
      var rb = rank[b.group] === undefined ? 9 : rank[b.group];
      if (ra !== rb) return ra - rb;
      if (a.group !== b.group) return a.group < b.group ? -1 : 1;
      var da = a.d2m > 0 ? (1e6 - a.d2m) : 1e9, db = b.d2m > 0 ? (1e6 - b.d2m) : 1e9;
      if (da !== db) return da - db;
      if (a.layer !== b.layer) return b.layer - a.layer;
      return a.title.localeCompare(b.title);
    });

    var cols = [], idx = {};
    items.forEach(function (it) {
      if (!idx[it.group]) { idx[it.group] = { group: it.group, items: [] }; cols.push(idx[it.group]); }
      idx[it.group].items.push(it);
    });
    return cols;
  }

  function renderJump() {
    var nav = $('jumpNav');
    if (!nav) return;
    if (!S.sets.length) {
      nav.hidden = true;
      nav.innerHTML = '';
      return;
    }
    nav.hidden = false;
    var cols = jumpItems();
    var h = '<div class="jlabel">约束分组快速跳转</div><div class="cols">';
    cols.forEach(function (col) {
      h += '<div class="jumpcol"><div class="jumpcol-h">' + esc(col.group) + '<span class="cnt"> ' + col.items.length + '</span></div>';
      var multi = col.items.some(function (x) { return x.d2m > 0; });
      var lastD2M = null;
      col.items.forEach(function (it) {
        var dk = it.d2m ? ('D2M' + it.d2m + 'mil') : '未标 D2M';
        if (multi && dk !== lastD2M) {
          h += '<div class="chipsub">' + esc(dk) + '</div>';
          lastD2M = dk;
        }
        var name = it.title || ('约束 ' + (it.si + 1));
        h += '<a class="' + esc(it.kind) + '" href="#set-' + it.si + '" data-si="' + it.si + '" data-tip="' + esc(name) + '">' +
          '<span class="k">' + esc(it.kind) + '</span><span class="jname">' + esc(name) + '</span></a>';
      });
      h += '</div>';
    });
    h += '</div>';
    nav.innerHTML = h;
  }

  function cellHtml(si, ci, key, c) {
    var v = (c.values && c.values[key] != null) ? String(c.values[key]).trim() : '';
    var src = (c.sources && c.sources[key]) || '';
    if (!v || v === '无') {
      return '<td class="nosrc"><input class="cCell none" data-no-persist data-si="' + si + '" data-ci="' + ci + '" data-key="' + esc(key) + '" value="无"></td>';
    }
    return '<td><input class="cCell" data-no-persist data-si="' + si + '" data-ci="' + ci + '" data-key="' + esc(key) + '" value="' + esc(v) + '">' +
      '<div class="srcnote">来源：' + esc(src || '手工填写') + '</div></td>';
  }

  function render() {
    var n = App.layerCount();
    var hi = n;
    S.sets.forEach(function (set) {
      var fan = CP.fanLayerOf(set);
      (set.constraints || []).forEach(function (c) {
        hi = Math.max(hi, CP.maxLayer(c.scopes || [], n, fan));
      });
    });
    App.updateStackHints();
    if (hi > n && $('stackHint')) {
      $('stackHint').textContent += ' · TXT 写到 L' + hi + '，高于当前总层数';
    }
    renderFiles();
    renderJump();
    var setsBox = $('sets');
    if (!setsBox) return;
    if (!S.sets.length) {
      setsBox.innerHTML = '<div class="hint">尚未生成约束，请在 ① 规则约束 导入 TXT 文件。</div>';
      return;
    }

    var h = '';
    var lastGroup = '';
    S.sets.forEach(function (set, si) {
      var grp = set.group || '';
      if (grp && grp !== lastGroup) {
        h += '<div class="setgroup">' + esc(grp) + '</div>';
        lastGroup = grp;
      }
      var kind = set.kind || '其他';
      var cons = set.constraints || [];
      var fan = CP.fanLayerOf(set);
      var maxL = Math.max(n, fan || 0);
      var extras = [], seen = {};
      cons.forEach(function (c) {
        maxL = Math.max(maxL, CP.maxLayer(c.scopes || [], n, fan));
        (c.extras || []).forEach(function (e) {
          if (!seen[e.key]) { seen[e.key] = 1; extras.push(e); }
        });
      });

      h += '<div class="set ' + esc(kind) + '" id="set-' + si + '" data-si="' + si + '"><div class="hd">' +
        '<span class="badge">' + esc(kind) + '</span>' +
        '<input class="setTitle" data-no-persist data-si="' + si + '" value="' + esc(set.title) + '" style="width:320px" data-tip="约束规则名称">' +
        (set.txtHead ? '<span class="txthead">TXT：' + esc(set.txtHead) + '</span>' : '') +
        '<select class="setKind" data-no-persist data-si="' + si + '">' +
        ['SMA', 'BGA', '其他'].map(function (k) { return '<option' + (k === kind ? ' selected' : '') + '>' + k + '</option>'; }).join('') +
        '</select>' +
        '<span style="margin-left:auto;font-size:12px;color:var(--sub)">来源 ' + esc(set.source || '') + '</span>' +
        '<button type="button" class="btn danger small" data-act="delset" data-si="' + si + '">删除此类</button></div><div class="body">';

      if (!cons.length) {
        h += '<div class="hint">该分类未解析出数值列，可手工新增约束列。</div>';
      } else {
        h += '<div class="layerwrap"><table class="layertable"><thead><tr><th class="lname">层</th>';
        cons.forEach(function (c, ci) {
          var src = (c.scopes || []).map(function (s) { return (s.scope || '未写层') + ' ' + s.value + (c.unit || ''); }).join('；');
          h += '<th data-tip="' + esc(src) + '">' +
            (c.cat ? '<span class="subh">' + esc(c.cat) + '</span>' : '') +
            '<input class="cName" data-no-persist data-si="' + si + '" data-ci="' + ci + '" value="' + esc(c.name) + '" data-tip="约束参数列名">' +
            '<div class="subh"><input class="cUnit" data-no-persist data-si="' + si + '" data-ci="' + ci + '" value="' + esc(c.unit || 'mil') + '" style="width:52px"> ' +
            '<button type="button" class="btn danger small" data-act="delcol" data-si="' + si + '" data-ci="' + ci + '">删除</button></div>' +
            (c.unscoped ? '<div class="srcnote">未标层值：' + esc(c.unscoped) + '</div>' : '') +
            '</th>';
        });
        h += '</tr></thead><tbody>';

        for (var i = 1; i <= maxL; i++) {
          var tag = i === fan ? '出线层' : (i === 1 ? '表层' : (i === n ? '底层' : (i > n ? '超出总层数' : '')));
          h += '<tr class="' + (i === fan ? 'fan' : '') + (i > n ? ' over' : '') + '"><td class="lname">L' + i +
            (tag ? '<span class="subh">' + tag + '</span>' : '') + '</td>';
          cons.forEach(function (c, ci) {
            h += cellHtml(si, ci, 'L' + i, c);
          });
          h += '</tr>';
        }
        extras.forEach(function (e) {
          h += '<tr class="extra"><td class="lname">' + esc(e.label) + '<span class="subh">非叠层范围</span></td>';
          cons.forEach(function (c, ci) {
            h += cellHtml(si, ci, e.key, c);
          });
          h += '</tr>';
        });
        h += '</tbody></table></div>';
      }

      h += '<div class="row" style="margin-top:8px">' +
        '<button type="button" class="btn ghost small" data-act="addcol" data-si="' + si + '">+ 加一个约束</button>' +
        '<button type="button" class="btn gray small" data-act="refill" data-si="' + si + '">按 TXT 重填</button>' +
        '</div></div></div>';
    });
    setsBox.innerHTML = h;
    App.syncPin();
    App.syncTelemetry();
  }

  function collect() {
    document.querySelectorAll('.setTitle').forEach(function (el) {
      if (S.sets[+el.dataset.si]) S.sets[+el.dataset.si].title = el.value;
    });
    document.querySelectorAll('.setKind').forEach(function (el) {
      if (S.sets[+el.dataset.si]) S.sets[+el.dataset.si].kind = el.value;
    });
    document.querySelectorAll('.cName').forEach(function (el) {
      var s = S.sets[+el.dataset.si];
      if (s && s.constraints[+el.dataset.ci]) s.constraints[+el.dataset.ci].name = el.value;
    });
    document.querySelectorAll('.cUnit').forEach(function (el) {
      var s = S.sets[+el.dataset.si];
      if (s && s.constraints[+el.dataset.ci]) s.constraints[+el.dataset.ci].unit = el.value;
    });
    document.querySelectorAll('.cCell').forEach(function (el) {
      var s = S.sets[+el.dataset.si];
      if (!(s && s.constraints[+el.dataset.ci])) return;
      var raw = el.value.trim();
      s.constraints[+el.dataset.ci].values[el.dataset.key] = (raw === '' || raw === '无') ? '' : raw;
    });
  }

  function bindSetsEvents() {
    var drop = $('drop');
    if (drop) {
      drop.onclick = function () { $('fileInput').click(); };
      ['dragover', 'dragenter'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
      });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files.length) App.addFiles(e.dataTransfer.files);
      });
    }

    if ($('fileInput')) {
      $('fileInput').onchange = function (e) {
        App.addFiles(e.target.files);
        e.target.value = '';
      };
    }

    if ($('btnClear')) {
      $('btnClear').onclick = function () {
        S.queue = [];
        S.sets = [];
        if ($('genHint')) $('genHint').textContent = '已清空导入队列。';
        render();
      };
    }

    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.onclick = function () { App.showTab(b.dataset.tab); };
    });

    document.addEventListener('change', function (e) {
      if (e.target.classList && (e.target.classList.contains('setKind') || e.target.classList.contains('setTitle'))) {
        collect();
        App.reexpandAll();
        render();
      }
    });

    document.addEventListener('input', function (e) {
      if (!e.target.classList || !e.target.classList.contains('setTitle')) return;
      var a = document.querySelector('#jumpNav a[data-si="' + e.target.dataset.si + '"] .jname');
      if (a) a.textContent = e.target.value || ('约束 ' + (+e.target.dataset.si + 1));
    });

    document.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('#jumpNav a') : null;
      if (a) {
        var targetEl = document.getElementById('set-' + a.dataset.si);
        if (targetEl) {
          e.preventDefault();
          if (typeof targetEl.scrollIntoView === 'function') {
            try { targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
            catch (err) { targetEl.scrollIntoView(); }
          }
        }
        return;
      }

      var btn = e.target.closest ? e.target.closest('button') : null;
      if (!btn || !btn.dataset.act) return;
      if (btn.dataset.act === 'delq') {
        var id = +btn.dataset.id;
        var idx = S.queue.findIndex(function (f) { return f.id === id; });
        if (idx >= 0) S.queue.splice(idx, 1);
        if ($('genHint')) $('genHint').textContent = '已移除文件。';
        App.rebuild();
      } else if (btn.dataset.act === 'delset') {
        collect();
        S.sets.splice(+btn.dataset.si, 1);
        render();
      } else if (btn.dataset.act === 'delcol') {
        collect();
        S.sets[+btn.dataset.si].constraints.splice(+btn.dataset.ci, 1);
        render();
      } else if (btn.dataset.act === 'addcol') {
        collect();
        if (!S.sets[+btn.dataset.si].constraints) S.sets[+btn.dataset.si].constraints = [];
        S.sets[+btn.dataset.si].constraints.push({ name: '新约束', cat: '', unit: 'mil', scopes: [], values: {}, auto: {}, extras: [], unscoped: '' });
        render();
      } else if (btn.dataset.act === 'refill') {
        collect();
        var set = S.sets[+btn.dataset.si];
        (set.constraints || []).forEach(function (c) { c.values = {}; c.auto = null; });
        App.reexpandAll();
        render();
      }
    });

    if ($('btnSave')) {
      $('btnSave').onclick = function () {
        collect();
        var data = {
          kind: 'pcb-copper-rules',
          version: 3,
          layerCount: App.layerCount(),
          sets: S.sets.map(function (s) {
            return { kind: s.kind, title: s.title, source: s.source, rules: s.rules, constraints: s.constraints };
          })
        };
        if ($('saveHint')) $('saveHint').textContent = '已生成约束 JSON。';
        App.showBox('铜皮约束.json', JSON.stringify(data, null, 2), '含 ' + data.sets.length + ' 条约束。');
      };
    }

    if ($('btnLoad')) {
      $('btnLoad').onclick = function () { $('ruleFile').click(); };
    }

    if ($('ruleFile')) {
      $('ruleFile').onchange = function (e) {
        var file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        var fr = new FileReader();
        fr.onload = function () {
          try {
            var d = JSON.parse(String(fr.result).replace(/^\uFEFF/, ''));
            if (!d.sets) throw new Error('非本模块导出的约束 JSON 文件');
            if (d.layerCount) {
              S.stack = d.layerCount;
              if ($('inpN')) $('inpN').value = String(d.layerCount);
              App.updateStackHints();
            }
            S.sets = (d.sets || []).map(function (s) {
              if (!s.constraints) s.constraints = CP.buildConstraints(s.rules || []);
              return s;
            });
            App.reexpandAll();
            if ($('saveHint')) $('saveHint').textContent = '已载入：' + file.name;
            render();
          } catch (err) {
            alert('读取失败：' + err.message);
          }
        };
        fr.readAsText(file, 'utf-8');
      };
    }
  }

  root.renderFiles = renderFiles;
  root.renderJump = renderJump;
  root.render = render;
  root.collect = collect;
  App.render = render;
  App.renderJump = renderJump;
  App.collect = collect;

  bindSetsEvents();
  render();
})(typeof window !== 'undefined' ? window : globalThis);
