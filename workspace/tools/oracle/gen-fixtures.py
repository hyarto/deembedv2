#!/usr/bin/env python3
"""
几何「预言机」夹具生成器（开发期工具，运行时不需要 Python）

用 shapely（GEOS）作为独立参考实现，随机生成焊盘 / 走线的几何组合，
算出精确间距作为基准值，写入 pcb-checker/sample/geometry-oracle-fixtures.json。
前端引擎 pcb-checker/pad-geom.js 由 pcb-checker/geometry-oracle-test.js 逐条对拍。

用法：
    python3 -m venv .venv && .venv/bin/pip install shapely
    .venv/bin/python tools/oracle/gen-fixtures.py

注意：夹具已经提交到仓库，CI / npm test 不需要安装 Python 或 shapely。
"""
import json
import math
import os
import random

from shapely.affinity import rotate, translate
from shapely.geometry import LineString, Point, box

SEED = 20261103
ROUND_QUADS = 512          # 圆弧离散精度（弦高误差 < 1e-5 mil）
ARC_STEPS = 4000           # 圆弧走线中心线离散点数
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   '..', '..', 'pcb-checker', 'sample', 'geometry-oracle-fixtures.json')


def pad_polygon(shape):
    """按「凸多边形 ⊕ 圆」模型构造 shapely 多边形（与 pad-geom.js 的模型一致）"""
    kind = shape['kind']
    w, h = float(shape['w']), float(shape['h'])
    corner = float(shape.get('corner') or 0)

    if kind == 'circle':
        geom = Point(0, 0).buffer(w / 2, quad_segs=ROUND_QUADS)
    elif kind == 'oblong':
        half = abs(w - h) / 2
        a = (-half, 0) if w >= h else (0, -half)
        b = (half, 0) if w >= h else (0, half)
        geom = LineString([a, b]).buffer(min(w, h) / 2, cap_style='round',
                                         quad_segs=ROUND_QUADS)
    elif kind == 'roundrect':
        inner = box(-(w / 2 - corner), -(h / 2 - corner), w / 2 - corner, h / 2 - corner)
        geom = inner.buffer(corner, join_style='round', quad_segs=ROUND_QUADS)
    elif kind == 'rect':
        geom = box(-w / 2, -h / 2, w / 2, h / 2)
    else:
        raise ValueError(kind)

    if shape.get('rot'):
        geom = rotate(geom, shape['rot'], origin=(0, 0))
    return geom


def trace_capsule(trace, half_width):
    if trace['kind'] == 'line':
        line = LineString([trace['p1'], trace['p2']])
    else:
        cx, cy = trace['center']
        r = trace['radius']
        a1 = math.atan2(trace['p1'][1] - cy, trace['p1'][0] - cx)
        a2 = math.atan2(trace['p2'][1] - cy, trace['p2'][0] - cx)
        if trace['dir'] == 'CW':
            span = (a1 - a2) % (2 * math.pi)
            sign = -1
        else:
            span = (a2 - a1) % (2 * math.pi)
            sign = 1
        if span == 0:
            span = 2 * math.pi
        pts = [(cx + r * math.cos(a1 + sign * span * i / ARC_STEPS),
                cy + r * math.sin(a1 + sign * span * i / ARC_STEPS))
               for i in range(ARC_STEPS + 1)]
        line = LineString(pts)
    return line.buffer(half_width, cap_style='round', join_style='round',
                       quad_segs=ROUND_QUADS)


def make_case(rng, kind, trace_kind):
    if kind == 'circle':
        w = rng.uniform(4, 14)
        h = w
        corner = 0
        rot = 0
    else:
        w = rng.uniform(6, 26)
        h = rng.uniform(4, 18)
        corner = rng.uniform(0, min(w, h) / 2) if kind == 'roundrect' else 0
        rot = rng.uniform(0, 360) if rng.random() < 0.7 else 0
    shape = {'kind': kind, 'w': round(w, 4), 'h': round(h, 4),
             'corner': round(corner, 4), 'rot': round(rot, 3)}

    if trace_kind == 'line':
        x1, x2 = rng.uniform(-120, -40), rng.uniform(40, 120)
        y = rng.uniform(18, 70)
        trace = {'kind': 'line', 'p1': [round(x1, 4), round(y, 4)],
                 'p2': [round(x2, 4), round(y + rng.uniform(-20, 20), 4)]}
    else:
        radius = rng.uniform(40, 160)
        start = rng.uniform(0, 2 * math.pi)
        span = rng.uniform(math.pi / 6, math.pi * 1.2)
        direction = rng.choice(['CCW', 'CW'])
        cx, cy = round(rng.uniform(-30, 30), 4), round(rng.uniform(-30, 30), 4)
        end = start + span if direction == 'CCW' else start - span
        trace = {
            'kind': 'arc',
            'center': [cx, cy],
            'radius': round(radius, 4),
            'p1': [round(cx + radius * math.cos(start), 4), round(cy + radius * math.sin(start), 4)],
            'p2': [round(cx + radius * math.cos(end), 4), round(cy + radius * math.sin(end), 4)],
            'dir': direction,
        }

    half_width = rng.uniform(0.5, 6)

    # 焊盘落点：沿走线法向外扩 (airgap + 焊盘外接半径)，得到期望的正间距
    pad_poly = pad_polygon(shape)
    trace_poly = trace_capsule(trace, half_width)
    airgap = rng.uniform(0.5, 25)
    probe = pad_poly.buffer(airgap + half_width + 0.0, quad_segs=8).boundary
    # 用走线包围盒上方的一点作为焊盘中心，再按 shapely 实际距离修正
    px = rng.uniform(-20, 20)
    py = trace['p1'][1] + airgap + half_width + max(shape['w'], shape['h']) / 2 + 2
    placed = translate(pad_poly, px, py)
    real = placed.distance(trace_poly)
    placed = translate(pad_poly, px, py)
    return shape, trace, half_width, placed, trace_poly, real


def main():
    rng = random.Random(SEED)
    cases = []

    def add(shape, trace, half_width, pad_geom, trace_poly, expect_overlap=False):
        dist = pad_geom.distance(trace_poly)
        overlap = bool(pad_geom.intersects(trace_poly))
        cases.append({
            'pad': shape,
            'padCenter': [round(pad_geom.centroid.x, 9), round(pad_geom.centroid.y, 9)],
            'trace': trace,
            'traceHalfWidth': round(half_width, 4),
            'expectedAirgap': round(dist, 6),
            'overlap': overlap,
            'kindPair': shape['kind'] + '/' + trace['kind'],
        })

    # 1) 分离区间：每种组合各 20 组
    for kind in ('circle', 'oblong', 'roundrect', 'rect'):
        for trace_kind in ('line', 'arc'):
            for _ in range(20):
                shape, trace, hw, pad_geom, trace_poly, dist = make_case(rng, kind, trace_kind)
                if pad_geom.intersects(trace_poly):
                    continue                     # 只保留分离样本（正间距）
                add(shape, trace, hw, pad_geom, trace_poly)

    # 2) 圆弧扫掠角专项：点位于弧的「缺口」方向，最近点必在弧端点
    for direction in ('CCW', 'CW'):
        for radius in (60.0, 100.0, 140.0):
            cx = cy = 0.0
            start, span = 0.0, math.pi / 2
            end = start + span if direction == 'CCW' else start - span
            trace = {
                'kind': 'arc', 'center': [cx, cy], 'radius': radius,
                'p1': [round(radius * math.cos(start), 4), round(radius * math.sin(start), 4)],
                'p2': [round(radius * math.cos(end), 4), round(radius * math.sin(end), 4)],
                'dir': direction,
            }
            for gap in (2.0, 6.0, 15.0):
                # 缺口方向（180°~270°）放一个焊盘
                ang = math.radians(215)
                px = (radius + gap + 6) * math.cos(ang)
                py = (radius + gap + 6) * math.sin(ang)
                shape = {'kind': 'circle', 'w': 12.0, 'h': 12.0, 'corner': 0, 'rot': 0}
                pad_geom = translate(pad_polygon(shape), px, py)
                trace_poly = trace_capsule(trace, 2.0)
                if pad_geom.intersects(trace_poly):
                    continue
                add(shape, trace, 2.0, pad_geom, trace_poly)

    # 3) 重叠样本：只需要判定符号（引擎必须给出 <= 0，且不能报成安全间距）
    for _ in range(12):
        shape = {'kind': rng.choice(['rect', 'roundrect', 'oblong']),
                 'w': round(rng.uniform(8, 20), 4), 'h': round(rng.uniform(6, 14), 4),
                 'corner': 2.0, 'rot': round(rng.uniform(0, 90), 3)}
        trace = {'kind': 'line', 'p1': [-50, round(rng.uniform(-3, 3), 4)],
                 'p2': [50, round(rng.uniform(-3, 3), 4)]}
        half_width = rng.uniform(1, 4)
        shape['w'] = max(shape['w'], shape['h'])
        pad_geom = pad_polygon(shape)          # 焊盘中心在原点 → 与走线重叠
        trace_poly = trace_capsule(trace, half_width)
        cases.append({
            'pad': shape,
            'padCenter': [0, 0],
            'trace': trace,
            'traceHalfWidth': round(half_width, 4),
            'expectedAirgap': 0.0,
            'overlap': True,
            'kindPair': shape['kind'] + '/line',
        })

    payload = {
        'generator': 'shapely',
        'shapelyVersion': __import__('shapely').__version__,
        'seed': SEED,
        'roundQuads': ROUND_QUADS,
        'arcSteps': ARC_STEPS,
        'toleranceMil': 0.01,
        'cases': cases,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(f'生成 {len(cases)} 条夹具 → {os.path.relpath(OUT)}')


if __name__ == '__main__':
    main()
