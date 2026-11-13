/* ============================================================================
 * synth-data.js —— 把示例 TXT 平移复制 N 份，合成大盘数据，用于性能基准与规模回归
 * 每份复制：坐标整体平移、Item 编号顺延、网络名加后缀（GND 除外），几何关系与原样例逐份一致
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { CHECKER_DIR } = require('./open-page');

function readSample(name) {
  return fs.readFileSync(path.join(CHECKER_DIR, 'sample', name), 'utf8');
}

/** copies 份样例，按 cols 列的网格平移，每份间隔 pitch mil */
function replicate(txt, copies, opts) {
  const o = Object.assign({ cols: 10, pitch: 3000 }, opts || {});
  const blocks = txt.replace(/\r/g, '').split(/^~{10,}\s*$/m);
  const head = blocks[0].match(/^[\s\S]*?(?=\n\s*Item\s)/);
  const itemCount = blocks.filter(b => /^\s*Item\s+\d+/m.test(b)).length;
  const out = ['Total ' + (itemCount * copies) + ' Items', ''];
  let id = 1;
  for (let k = 0; k < copies; k++) {
    const dx = (k % o.cols) * o.pitch;
    const dy = Math.floor(k / o.cols) * o.pitch;
    for (const b of blocks) {
      if (!/^\s*Item\s+\d+/m.test(b)) continue;
      let t = b.replace(/^\s*Total[^\n]*\n/m, '');
      t = t.replace(/^(\s*Item\s+)\d+/m, (_, p) => p + (id++));
      t = t.replace(/\[(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\]/g,
        (_, x, y) => '[' + (parseFloat(x) + dx).toFixed(4) + ', ' + (parseFloat(y) + dy).toFixed(4) + ']');
      t = t.replace(/^(\s*Net:\s+)(\S+)/m, (_, p, n) => p + (n === 'GND' ? n : n + '_c' + k));
      out.push(t.replace(/^\s+/, ''), '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', '');
    }
  }
  void head;
  return out.join('\n');
}

module.exports = { readSample, replicate };
