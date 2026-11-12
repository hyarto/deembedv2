/**
 * geometry-oracle-test.js
 * 用 shapely(GEOS) 生成的基准夹具对拍前端几何内核（pad-geom.js）。
 *
 * 夹具由 tools/oracle/gen-fixtures.py 生成并提交在 sample/ 下，
 * 因此本测试只依赖 Node，不需要安装 Python。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const G = require('./pad-geom.js');

const FIXTURE = path.join(__dirname, 'sample/geometry-oracle-fixtures.json');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  PASS  ' + name);
    pass++;
  } catch (err) {
    console.error('  FAIL  ' + name + ' -> ' + err.message);
    fail++;
  }
}

function airgapOf(c) {
  const region = G.translateRegion(G.regionOf(c.pad), c.padCenter[0], c.padCenter[1]);
  const t = c.trace;
  if (t.kind === 'line') {
    return G.signedSegmentRegionDist(t.p1, t.p2, region) - c.traceHalfWidth;
  }
  return G.signedArcRegionDist(t.center, t.radius, t.p1, t.p2, t.dir, region, c.traceHalfWidth);
}

console.log('== 几何内核 vs shapely 基准对拍 ==');

const payload = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const cases = payload.cases;
const tol = payload.toleranceMil || 0.01;

test(`夹具可用（${cases.length} 条，shapely ${payload.shapelyVersion}）`, () => {
  if (!cases.length) throw new Error('夹具为空');
  if (cases.length < 100) throw new Error('夹具数量异常: ' + cases.length);
});

test(`分离样本间距与 shapely 基准一致（容差 ${tol} mil）`, () => {
  let worst = 0;
  let worstCase = null;
  let checked = 0;
  for (const c of cases) {
    if (c.overlap) continue;
    checked++;
    const got = airgapOf(c);
    const diff = Math.abs(got - c.expectedAirgap);
    if (diff > worst) { worst = diff; worstCase = c; }
    if (diff > tol) {
      throw new Error(`偏差 ${diff.toFixed(6)} mil > ${tol}（${c.kindPair}，期望 ${c.expectedAirgap}，实得 ${got}）`);
    }
  }
  if (checked < 100) throw new Error('有效样本过少: ' + checked);
  console.log(`        最大偏差 ${worst.toExponential(2)} mil（${checked} 条分离样本）`);
});

test('无系统性乐观偏差（DRC 最怕把危险值算大）', () => {
  // 夹具本身把坐标保留到 1e-4 mil，基准值噪声量级 ±6e-5 mil；
  // 这里用 1e-3 mil（物理上 25 nm）作为「乐观」上限，并检查平均偏差无系统性。
  const LIMIT = 1e-3;
  let over = 0;
  let maxOver = 0;
  let sum = 0;
  let n = 0;
  for (const c of cases) {
    if (c.overlap) continue;
    const diff = airgapOf(c) - c.expectedAirgap;
    sum += diff; n++;
    if (diff > maxOver) maxOver = diff;
    if (diff > LIMIT) over++;
  }
  const bias = sum / n;
  if (over > 0) throw new Error(`${over} 条样本超出 1e-3 mil 的乐观偏差（最大 ${maxOver}）`);
  if (Math.abs(bias) > 1e-5) throw new Error('存在系统性偏差: ' + bias);
  console.log(`        最大乐观偏差 ${maxOver.toExponential(2)} mil，平均偏差 ${bias.toExponential(2)} mil`);
});

test('重叠样本必须判为 <= 0', () => {
  let bad = 0;
  for (const c of cases) {
    if (!c.overlap) continue;
    const got = airgapOf(c);
    if (!(got <= 1e-6)) bad++;
  }
  if (bad > 0) throw new Error(bad + ' 条重叠样本被判成了安全间距');
});

test('圆弧缺口方向不会被误算成弧面上的距离（扫掠角判定）', () => {
  // 半径 100、0°~90° 的弧；在 215° 方向放一个 r=6 的圆焊盘
  const region = G.translateRegion(G.regionOf({ kind: 'circle', w: 12 }), -110, -110);
  const got = G.signedArcRegionDist([0, 0], 100, [100, 0], [0, 100], 'CCW', region, 0);
  const toCircleSurface = Math.abs(Math.hypot(-110, -110) - 100) - 6;   // 旧算法的错误值
  const toEndpoints = Math.hypot(-110 - 100, -110) - 6;                 // 真实最近点(端点)
  if (Math.abs(got - toEndpoints) > 1e-6) {
    throw new Error(`应取弧端点距离 ${toEndpoints.toFixed(4)}，实得 ${got.toFixed(4)}`);
  }
  if (got <= toCircleSurface) throw new Error('仍在使用 |d-r| 的错误近似');
});

test('形状退化等价性：长圆 w=h 与圆一致，圆角矩形 corner=短边/2 等价于长圆', () => {
  const seg = [[-100, 30], [100, 30]];
  const circle = G.translateRegion(G.regionOf({ kind: 'circle', w: 10 }), 0, 0);
  const oblong = G.translateRegion(G.regionOf({ kind: 'oblong', w: 10, h: 10 }), 0, 0);
  const d1 = G.signedSegmentRegionDist(seg[0], seg[1], circle);
  const d2 = G.signedSegmentRegionDist(seg[0], seg[1], oblong);
  if (Math.abs(d1 - d2) > 1e-9) throw new Error(`圆 ${d1} vs 长圆 ${d2}`);

  const a = G.translateRegion(G.regionOf({ kind: 'oblong', w: 20, h: 10 }), 0, 0);
  const b = G.translateRegion(G.regionOf({ kind: 'roundrect', w: 20, h: 10, corner: 5 }), 0, 0);
  const d3 = G.signedSegmentRegionDist([-100, 40], [100, 40], a);
  const d4 = G.signedSegmentRegionDist([-100, 40], [100, 40], b);
  if (Math.abs(d3 - d4) > 1e-9) throw new Error(`长圆 ${d3} vs 圆角矩形 ${d4}`);
});

test('旋转不变性：同形状旋转 90° 后与旋转后的走线距离一致', () => {
  const pad = { kind: 'rect', w: 30, h: 8 };
  const a = G.translateRegion(G.regionOf(pad), 0, 0);
  const b = G.translateRegion(G.regionOf(Object.assign({}, pad, { rot: 90 })), 0, 0);
  const d1 = G.signedSegmentRegionDist([-100, 20], [100, 20], a);
  const d2 = G.signedSegmentRegionDist([-20, -100], [-20, 100], b);
  if (Math.abs(d1 - d2) > 1e-9) throw new Error(`${d1} vs ${d2}`);
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
