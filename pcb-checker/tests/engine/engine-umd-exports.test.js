/* ============================================================================
 * engine-umd-exports.test.js —— UMD 包双端导出审计（AGENTS.md 第 9 节）
 * 浏览器端：脱离 module，在 vm 沙箱按页面脚本顺序加载，断言全局名与关键 API；
 * Node 端：require 聚合入口，断言与浏览器端键集合一致；
 * 目的：新增/重命名导出时两端必须同时可用，避免页面或引擎测试静默挂掉。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PKG = path.join(__dirname, '..', '..', 'packages');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (err) { console.error(`  FAIL  ${name} -> ${err.message}`); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// 按页面 HTML 里的加载顺序在沙箱中模拟浏览器（无 module.exports）
function browserLoad(files) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const rel of files) {
    const abs = path.join(PKG, rel);
    assert(fs.existsSync(abs), rel + ' 不存在');
    vm.runInContext(fs.readFileSync(abs, 'utf8'), sandbox, { filename: rel });
  }
  return sandbox;
}

// family → { files, globals: {全局名: 必须存在的关键 API}, nodeEntry }
const FAMILIES = {
  geometry: {
    files: ['geometry/pad-primitives.js', 'geometry/pad-region.js'],
    globals: { PadGeom: ['dist2D', 'segmentsIntersect', 'regionDist', 'signedSegmentRegionDist', 'signedArcRegionDist'] },
    nodeEntry: 'geometry',
    unionGlobal: 'PadGeom'
  },
  trace: {
    files: ['shared/xlsx-export.js', 'engines/trace/trace-parser.js', 'engines/trace/trace-rules.js', 'engines/trace/trace-report.js'],
    globals: {
      XlsxExport: ['generateXLSX', 'toCSV'],
      TraceEngine: ['aggregateRecords', 'layerStats', 'runChecks', 'generateTraceReportData', 'generateDiffReportData']
    },
    nodeEntry: 'engines/trace',
    unionGlobal: 'TraceEngine'
  },
  copper: {
    files: ['engines/copper/copper-engine.js', 'engines/copper/constraint-parser.js'],
    globals: {
      CopperCheck: ['parseBoardItems', 'runCopperCheck', 'selectRule'],
      ConstraintParser: ['buildConstraints', 'expandConstraintSets', 'orderChips']
    },
    nodeEntry: 'engines/copper',
    unionGlobals: ['CopperCheck', 'ConstraintParser']
  },
  dfm: {
    // dfm-engine 浏览器模式从全局 PadGeom 取几何内核，几何包必须先加载（与 dfm.html 顺序一致）
    files: ['geometry/pad-primitives.js', 'geometry/pad-region.js',
      'engines/dfm/dfm-layers.js', 'engines/dfm/dfm-parser.js', 'engines/dfm/dfm-engine.js', 'engines/dfm/dfm-pattern.js'],
    globals: { DfmCheck: ['parseDfmItems', 'runDfmCheck', 'buildDfmPatternAnalysis', 'parseLayerSpec'] },
    nodeEntry: 'engines/dfm',
    unionGlobal: 'DfmCheck'
  },
  fanout: {
    files: ['engines/fanout/fanout-parser.js', 'engines/fanout/fanout-palette.js', 'engines/fanout/fanout-scheme.js',
      'engines/fanout/fanout-clustering.js', 'engines/fanout/fanout-inspector.js', 'engines/fanout/fanout-layout.js',
      'engines/fanout/fanout-canvas.js'],
    globals: { FanoutChecker: ['parseFanoutInputData', 'runFanoutInspection', 'computeSchemeViewLayout', 'renderSchemeEnlargedCanvas'] },
    nodeEntry: 'engines/fanout',
    unionGlobal: 'FanoutChecker'
  },
  pour: {
    files: ['engines/pour/pour-geom.js', 'engines/pour/pour-parser.js', 'engines/pour/pour-engine.js'],
    globals: { PourChecker: ['parsePcbElements', 'runAllCopperChecks', 'checkIsolatedSmallCopper'] },
    nodeEntry: 'engines/pour',
    unionGlobal: 'PourChecker'
  }
};

console.log('== UMD 包双端（Node require / 浏览器全局）导出审计 ==');

test('五引擎 + 几何包在浏览器模式下按页面顺序挂载预期全局名与关键 API', () => {
  for (const [name, fam] of Object.entries(FAMILIES)) {
    const sandbox = browserLoad(fam.files);
    for (const [g, apis] of Object.entries(fam.globals)) {
      assert(sandbox[g] && typeof sandbox[g] === 'object', `${name}：浏览器端缺少全局 ${g}`);
      for (const api of apis) {
        assert(typeof sandbox[g][api] === 'function', `${name}：${g}.${api} 应导出为函数（页面依赖，实际 ${typeof sandbox[g][api]}）`);
      }
    }
  }
});

test('Node require 聚合入口与浏览器端键集合一致', () => {
  for (const [name, fam] of Object.entries(FAMILIES)) {
    const nodeKeys = Object.keys(require(path.join(PKG, fam.nodeEntry))).sort();
    assert(nodeKeys.length > 5, `${name}：Node 端导出数异常少（${nodeKeys.length}），聚合入口可能丢文件`);
    const sandbox = browserLoad(fam.files);
    const names = fam.unionGlobals || [fam.unionGlobal];
    const browserKeys = names.map(g => Object.keys(sandbox[g] || {})).flat().sort();
    assert(JSON.stringify(nodeKeys) === JSON.stringify(browserKeys),
      `${name}：双端键集合不一致。仅 Node 有：${nodeKeys.filter(k => !browserKeys.includes(k)).join(',') || '无'}；` +
      `仅浏览器有：${browserKeys.filter(k => !nodeKeys.includes(k)).join(',') || '无'}`);
  }
});

test('dfm-pattern 的 typeof window 守卫分支在浏览器模式下正常挂载（不抛错）', () => {
  const sandbox = browserLoad(FAMILIES.dfm.files);
  assert(typeof sandbox.window.buildDfmPatternAnalysis === 'function', 'window.buildDfmPatternAnalysis 未挂载');
  assert(typeof sandbox.window.buildPatternCsv === 'function', 'window.buildPatternCsv 未挂载');
});

test('shared/dom-utils 浏览器端挂载 DomUtils / escHtml / decodeTxt', () => {
  const sandbox = browserLoad(['shared/dom-utils.js']);
  assert(sandbox.DomUtils && typeof sandbox.DomUtils === 'object', '缺少全局 DomUtils');
  assert(typeof sandbox.escHtml === 'function', '缺少全局 escHtml');
  assert(typeof sandbox.decodeTxt === 'function', '缺少全局 decodeTxt');
  assert(sandbox.escHtml('<b>&"\'') === '&lt;b&gt;&amp;&quot;&#39;', 'escHtml 浏览器端行为异常');
});

test('约束解析器双端均被 copper / unified 页面路径共享（无第三份实现）', () => {
  // AGENTS.md 第 3 节：重复代码合并。constraint-parser 是 copper 与 unified 的唯一实现
  const htmlU = fs.readFileSync(path.join(PKG, '..', 'unified.html'), 'utf8');
  const htmlC = fs.readFileSync(path.join(PKG, '..', 'copper.html'), 'utf8');
  assert(htmlU.includes('engines/copper/constraint-parser.js'), 'unified.html 未复用 constraint-parser.js');
  assert(htmlC.includes('engines/copper/constraint-parser.js'), 'copper.html 未复用 constraint-parser.js');
  const dupes = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/constraint.*pars|parse.*constraint/i.test(f) && !p.includes('engines/copper/constraint-parser.js') && !p.includes('unified-constraint-parse')) dupes.push(p);
    }
  })(PKG);
  assert(dupes.length === 0, '出现第三份约束解析实现：' + dupes.join(', '));
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
