#!/usr/bin/env node
/* ============================================================================
 * run-tests.js —— 按分组顺序运行 pcb-checker/tests 下的测试脚本
 * 用法：node tools/run-tests.js [engine|ui|bench|all|full] [文件名关键字]
 * all = engine + ui；full = engine + ui + bench（含性能基准，约 30 s）
 * 任一脚本非 0 退出即整体失败；汇总各脚本耗时与结果。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TESTS_DIR = path.join(__dirname, '..', 'pcb-checker', 'tests');
const GROUPS = {
  engine: { dir: 'engine', suffix: '.test.js' },
  ui: { dir: 'ui', suffix: '.test.js' },
  bench: { dir: 'bench', suffix: '.bench.js' }
};

const group = process.argv[2] || 'all';
const keyword = process.argv[3] || '';
const selected = group === 'all' ? ['engine', 'ui'] : group === 'full' ? ['engine', 'ui', 'bench'] : [group];

if (!selected.every(g => GROUPS[g])) {
  console.error('未知分组：' + group + '，可选 engine / ui / bench / all / full');
  process.exit(2);
}

const results = [];
for (const g of selected) {
  const { dir, suffix } = GROUPS[g];
  const files = fs.readdirSync(path.join(TESTS_DIR, dir))
    .filter(f => f.endsWith(suffix) && f.includes(keyword))
    .sort();
  for (const f of files) {
    const rel = path.join('pcb-checker', 'tests', dir, f);
    console.log(`\n▶ ${rel}`);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(TESTS_DIR, dir, f)], { stdio: 'inherit' });
    results.push({ rel, ok: r.status === 0, ms: Date.now() - t0 });
  }
}

console.log('\n==================== 汇总 ====================');
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${String(r.ms).padStart(6)} ms  ${r.rel}`));
const failed = results.filter(r => !r.ok);
console.log(`\n共 ${results.length} 个脚本，失败 ${failed.length} 个`);
process.exit(failed.length ? 1 : 0);
