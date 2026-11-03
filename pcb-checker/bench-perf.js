/* 性能对照：新（网格索引）vs 旧（逐项全量比较）。用合成大盘数据。 */
const CC = require('./copper-check.js');

function buildBig(nShape, nVia, nTrace, ptsPerTrace){
  const L = ['Total N Items'];
  let id = 1;
  const layerName = i => 'L' + (1 + (i % 21));
  for (let i = 0; i < nShape; i++) {
    const x = 1000 + (i % 200) * 50, y = 1000 + Math.floor(i / 200) * 50;
    L.push('', 'Item ' + (id++) + '                < Shape >', '',
      '  Set:                Route Keepout', '  Subset:             ' + ('0' + (1 + (i % 9))).slice(-2) + 'G01P', '',
      '  Type:               Shape(Static)', '', '  Shape is Solid Filled', '',
      'Exterior Boundary:',
      '  Arc seg: xy [' + (x - 5) + ', ' + y + ']  xy [' + (x - 5) + ', ' + y + '] Width (0.0000)',
      '    Center-xy:  [' + x + '.0000, ' + y + '.0000] Radius (11.3900) CCW',
      '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
  }
  for (let i = 0; i < nVia; i++) {
    const j = i % nShape;
    const x = 1000 + (j % 200) * 50, y = 1000 + Math.floor(j / 200) * 50;
    L.push('', 'Item ' + (id++) + '                < Via >', '',
      '  Origin-xy:          [' + x + '.0000, ' + y + '.0001]',
      '  Net:                ' + (i % 97) + '_N', '',
      '  Padstack Name:      BGA_3510_l2-L8_Ring3mil_0902',
      '  Usage:              BBVia', '', '  Connections:        ', '    Trace:            2 (02G01P 19IS08)',
      '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
  }
  for (let i = 0; i < nTrace; i++) {
    const parts = ['', 'Item ' + (id++) + '                < Trace >', '',
      '  Subset:             ' + layerName(i), '  Net:                ' + (i % 97) + '_N', '', '  Length:             1234.5678 mil'];
    for (let k = 0; k < ptsPerTrace; k++) {
      parts.push('  Seg: xy [' + (1000 + (i % 200) * 50 + k) + '.0000, ' + (1000 + k) + '.0000] Width (4.0000)');
    }
    parts.push('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
    L.push(parts.join('\n'));
  }
  L.push('', '~ ~ ~ ~ ~ ~ ~ ~ ~ ~End~ ~ ~ ~ ~ ~ ~ ~ ~ ~');
  return L.join('\n');
}

function naiveCheck(items, sets, n, posTol, valTol){
  // 旧做法：每个过孔扫全部铜皮、每条走线扫全部点
  const vias = items.filter(it => it.type === 'via' && it.origin);
  const circles = items.filter(it => it.circle);
  const traces = items.filter(it => it.type === 'trace' && it.pts);
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let hits = 0;
  vias.forEach(v => {
    circles.forEach(s => { if (d(v.origin, s.center) <= posTol) hits++; });
    traces.forEach(tr => {
      for (let i = 0; i < tr.pts.length; i += 2) {
        if (d(v.origin, [tr.pts[i], tr.pts[i + 1]]) <= posTol) { hits++; break; }
      }
    });
  });
  return hits;
}

const nShape = Number(process.argv[2] || 6000);
const nVia = Number(process.argv[3] || 5000);
const nTrace = Number(process.argv[4] || 4000);
const pts = Number(process.argv[5] || 40);
const txt = buildBig(nShape, nVia, nTrace, pts);
console.log('合成数据：', (txt.length / 1048576).toFixed(1), 'MB  Shape', nShape, ' Via', nVia, ' Trace', nTrace, '×', pts, '点');

let t0 = Date.now();
const items = CC.parseBoardItems(txt);
let t1 = Date.now();
console.log('解析：', (t1 - t0) + ' ms  →  Item', items.length, ' 圆形铜皮', items.filter(i => i.circle).length, ' 过孔', items.filter(i => i.type === 'via').length);

const sets = [
  { kind: 'BGA', title: 'BGA-L8', fanLayer: 8, constraints: [{ cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1: '11.39', L8: '11.39' } }] },
  { kind: 'BGA', title: 'BGA-L19', fanLayer: 19, constraints: [{ cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1: '11.39' } }] }
];
const opts = { layerCount: 21, posTol: 0.05, valTol: 0.01 };

t0 = Date.now();
const r = CC.runCopperCheck(items, sets, opts);
t1 = Date.now();
console.log('新引擎检查：', (t1 - t0) + ' ms  已配对', r.groups.filter(g => g.rows.length).length, ' 未配对铜皮', r.unmatchedCircles.length);

t0 = Date.now();
const hits = naiveCheck(items, sets, 21, 0.05, 0.01);
t1 = Date.now();
console.log('旧做法对照：', (t1 - t0) + ' ms  命中', hits);

t0 = Date.now();
CC.runCopperCheck(items, sets, opts);
t1 = Date.now();
console.log('新引擎第二次：', (t1 - t0) + ' ms');
