/* ============================================================================
 * fanout-layout.js —— 扇出方案放大视图标注自动防重叠几何布局引擎
 * ========================================================================== */
(function (root, factory) {
  var parser = (typeof module === "object" && module.exports) ? require("./fanout-parser.js") : root.FanoutChecker;
  var schemeMod = (typeof module === "object" && module.exports) ? require("./fanout-scheme.js") : root.FanoutChecker;
  var paletteMod = (typeof module === "object" && module.exports) ? require("./fanout-palette.js") : root.FanoutChecker;
  var api = factory(parser, schemeMod, paletteMod);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FanoutChecker = Object.assign(root.FanoutChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (parser, schemeMod, paletteMod) {
  "use strict";
  var MM_PER_MIL = parser.MM_PER_MIL;
  var dist2D = parser.dist2D;
  var isSignalVia = schemeMod.isSignalVia;
  var buildPadstackColorMap = paletteMod.buildPadstackColorMap;
  function estimateTextPx(str, fontPx, isMono) {
    const s = String(str || '');
    let w = 0;
    const asciiFactor = isMono ? 0.61 : 0.56;
    for (let i = 0; i < s.length; i++) {
      w += s.charCodeAt(i) > 127 ? fontPx * 1.02 : fontPx * asciiFactor;
    }
    return w;
  }

  /**
   * 计算扇出方案放大效果图与 Padstack 标注几何布局 (无重叠自动避让)
   */
  function computeSchemeViewLayout(scheme, width, height, options = {}) {
    const W = Math.max(320, Number(width) || 760);
    const H = Math.max(260, Number(height) || 520);
    const zoom = Math.max(0.35, Math.min(6.0, Number(options.zoom) || 1.0));
    const panX = Number(options.panX) || 0;
    const panY = Number(options.panY) || 0;
    const showPadstack = options.showPadstack !== false;
    const showCoords = !!options.showCoords;
    const showDistances = !!options.showDistances;
    const hoveredIndex = options.hoveredIndex != null ? Number(options.hoveredIndex) : -1;
    const measureText = typeof options.measureText === 'function' ? options.measureText : null;

    const rawVias = (scheme && Array.isArray(scheme.vias)) ? scheme.vias : [];
    const N = rawVias.length;

    if (N === 0) {
      return {
        width: W,
        height: H,
        cx: W / 2,
        cy: H / 2,
        scale: 1,
        padR: 14,
        drillR: 5.5,
        vias: [],
        connectors: [],
        callouts: [],
        padstackColors: [],
        padstackColorMap: {},
        summary: { viaCount: 0, sigCount: 0, gndCount: 0, minDist: 0, maxDist: 0, padstackCounts: {}, padstackColors: [] }
      };
    }

    const padColorInfo = buildPadstackColorMap(rawVias, options.librarySchemes);

    const xs = rawVias.map(v => parseFloat(v.x) || 0);
    const ys = rawVias.map(v => parseFloat(v.y) || 0);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const halfSpanX = Math.max((maxX - minX) / 2, 10);
    const halfSpanY = Math.max((maxY - minY) / 2, 10);

    const compactMode = N > 10;
    const padFontPx = compactMode ? 11 : 12;
    const metaFontPx = compactMode ? 10 : 10.5;

    let maxBoxW = 170;
    rawVias.forEach((v, i) => {
      const padStr = String(v.padstack || 'VIA_PAD');
      const roleTxt = (v.role && v.role !== 'Signal' && v.role !== 'GND') ? v.role : (isSignalVia(v) ? '信号孔' : 'GND地孔');
      const coordTxt = showCoords ? ` [${(parseFloat(v.x) || 0).toFixed(1)}, ${(parseFloat(v.y) || 0).toFixed(1)}]` : '';
      if (compactMode) {
        const line = `#${i + 1} ${padStr}${coordTxt}`;
        const tw = measureText ? measureText(line, padFontPx, true) : estimateTextPx(line, padFontPx, true);
        maxBoxW = Math.max(maxBoxW, tw + 24);
      } else {
        const l1 = `#${i + 1} · ${roleTxt}${coordTxt}`;
        const l2 = padStr;
        const w1 = measureText ? measureText(l1, metaFontPx, false) : estimateTextPx(l1, metaFontPx, false);
        const w2 = measureText ? measureText(l2, padFontPx, true) : estimateTextPx(l2, padFontPx, true);
        maxBoxW = Math.max(maxBoxW, Math.max(w1, w2) + 26);
      }
    });
    maxBoxW = Math.min(maxBoxW, Math.floor(W * 0.42));

    const sideReserve = showPadstack ? Math.min(Math.floor(W * 0.37), maxBoxW + 34) : 64;
    const topBotReserve = showPadstack ? (compactMode ? 58 : 118) : 56;
    const availHalfW = Math.max(62, (W / 2) - sideReserve);
    const availHalfH = Math.max(58, (H / 2) - topBotReserve);

    const baseScale = N === 1 ? 4.5 : Math.min(availHalfW / halfSpanX, availHalfH / halfSpanY);
    const scale = baseScale * zoom;
    const cx = W / 2 + panX;
    const cy = H / 2 + panY;

    const basePadR = N <= 6 ? 15 : (N <= 12 ? 12 : (N <= 22 ? 9.5 : 8));
    const padR = Math.max(6.5, Math.min(22, basePadR * Math.pow(zoom, 0.32)));
    const drillR = Math.max(2.6, padR * 0.39);

    const padstackCounts = {};
    let sigCount = 0, gndCount = 0;

    const vias = rawVias.map((v, idx) => {
      const x = parseFloat(v.x) || 0;
      const y = parseFloat(v.y) || 0;
      const isSig = isSignalVia(v);
      if (isSig) sigCount++; else gndCount++;
      const padstack = String(v.padstack || 'VIA_PAD');
      padstackCounts[padstack] = (padstackCounts[padstack] || 0) + 1;
      const roleText = (v.role && v.role !== 'Signal' && v.role !== 'GND')
        ? String(v.role)
        : (isSig ? '信号孔' : '伴随地孔');
      const pCol = padColorInfo.map[padstack] || PADSTACK_PALETTE[0];

      return {
        index: idx,
        labelNum: idx + 1,
        id: v.id != null ? v.id : idx + 1,
        x,
        y,
        nx: x - midX,
        ny: y - midY,
        sx: cx + (x - midX) * scale,
        sy: cy - (y - midY) * scale,
        padstack,
        net: v.net || (isSig ? 'SIG' : 'GND'),
        role: roleText,
        isSig,
        padColor: pCol.fill,
        padLightColor: pCol.light,
        padBorderColor: pCol.border,
        padBadgeBg: pCol.badgeBg,
        padBadgeText: pCol.badgeText,
        padColorIndex: pCol.colorIndex,
        isHovered: idx === hoveredIndex
      };
    });

    // 计算两两距离与拓扑连线
    const allPairs = [];
    const minDistPerVia = new Array(N).fill(Infinity);
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const d = dist2D(vias[i].x, vias[i].y, vias[j].x, vias[j].y);
        if (d > 1e-6) {
          allPairs.push({ i, j, dist: d });
          if (d < minDistPerVia[i]) minDistPerVia[i] = d;
          if (d < minDistPerVia[j]) minDistPerVia[j] = d;
        }
      }
    }
    allPairs.sort((a, b) => a.dist - b.dist);
    const minDist = allPairs.length > 0 ? allPairs[0].dist : 0;
    const maxDist = allPairs.length > 0 ? allPairs[allPairs.length - 1].dist : 0;

    let connectors = [];
    if (N <= 10) {
      connectors = allPairs.map(p => ({
        ...p,
        x1: vias[p.i].sx,
        y1: vias[p.i].sy,
        x2: vias[p.j].sx,
        y2: vias[p.j].sy,
        isPrimaryPitch: p.dist <= Math.max(minDist * 1.48, Math.min(minDistPerVia[p.i], minDistPerVia[p.j]) * 1.15)
      }));
    } else {
      const picked = new Set();
      for (let i = 0; i < N; i++) {
        const neighbors = [];
        for (let j = 0; j < N; j++) {
          if (i === j) continue;
          const d = dist2D(vias[i].x, vias[i].y, vias[j].x, vias[j].y);
          neighbors.push({ j, dist: d });
        }
        neighbors.sort((a, b) => a.dist - b.dist);
        const cutoff = neighbors.length > 0 ? neighbors[0].dist * 2.15 : Infinity;
        neighbors.slice(0, 4).forEach(nb => {
          if (nb.dist <= cutoff) {
            const a = Math.min(i, nb.j), b = Math.max(i, nb.j);
            const key = `${a}_${b}`;
            if (!picked.has(key)) {
              picked.add(key);
              connectors.push({
                i: a,
                j: b,
                dist: nb.dist,
                x1: vias[a].sx,
                y1: vias[a].sy,
                x2: vias[b].sx,
                y2: vias[b].sy,
                isPrimaryPitch: nb.dist <= minDist * 1.25
              });
            }
          }
        });
      }
    }

    // 计算每个孔的 Padstack 标注框位置
    const callouts = [];
    if (showPadstack) {
      const scx = vias.reduce((s, v) => s + v.sx, 0) / N;
      const scy = vias.reduce((s, v) => s + v.sy, 0) / N;
      const minSx = Math.min(...vias.map(v => v.sx));
      const maxSx = Math.max(...vias.map(v => v.sx));
      const maxScreenR = Math.max(20, ...vias.map(v => Math.hypot(v.sx - scx, v.sy - scy)));

      // 先构建每个孔的标注文本与宽高
      const specs = vias.map(v => {
        const coordPart = showCoords ? ` (${v.x.toFixed(1)}, ${v.y.toFixed(1)})` : '';
        if (compactMode) {
          const line1 = `#${v.labelNum} ${v.padstack}${coordPart}`;
          const tw = measureText ? measureText(line1, padFontPx, true) : estimateTextPx(line1, padFontPx, true);
          return {
            via: v,
            compact: true,
            headerText: `#${v.labelNum}`,
            padstackText: v.padstack,
            coordText: coordPart.trim(),
            fullLine: line1,
            w: Math.ceil(tw + 22),
            h: 22
          };
        } else {
          const headerText = `#${v.labelNum} · ${v.role}${coordPart}`;
          const padstackText = v.padstack;
          const w1 = measureText ? measureText(headerText, metaFontPx, false) : estimateTextPx(headerText, metaFontPx, false);
          const w2 = measureText ? measureText(padstackText, padFontPx, true) : estimateTextPx(padstackText, padFontPx, true);
          return {
            via: v,
            compact: false,
            headerText,
            padstackText,
            coordText: coordPart.trim(),
            w: Math.ceil(Math.max(w1, w2) + 24),
            h: 40
          };
        }
      });

      const margin = 10;

      if (!compactMode) {
        // 标准/中小型方案 (<=10孔): 径向扇出引线 + 空隙角度寻优 + 碰撞松弛避让
        specs.forEach((sp, i) => {
          const v = sp.via;
          let dx = v.sx - scx;
          let dy = v.sy - scy;
          const r = Math.hypot(dx, dy);

          // 检查外向射线是否被更外围的孔阻挡，或该孔位于中心
          let blocked = false;
          if (r > 8) {
            const ux0 = dx / r, uy0 = dy / r;
            for (let j = 0; j < N; j++) {
              if (i === j) continue;
              const vxj = vias[j].sx - scx, vyj = vias[j].sy - scy;
              const rj = Math.hypot(vxj, vyj);
              if (rj > r + padR * 1.4) {
                const cosA = (ux0 * vxj + uy0 * vyj) / (rj || 1);
                if (cosA > 0.94) {
                  blocked = true;
                  break;
                }
              }
            }
          }

          let angle = 0;
          let isInterior = false;
          if (N === 1) {
            angle = -Math.PI / 4;
          } else if (r <= 8 || blocked) {
            isInterior = true;
            // 在周围所有孔相对当前孔的方位角中寻找最大空隙扇区
            const neighborAngles = [];
            for (let j = 0; j < N; j++) {
              if (i === j) continue;
              neighborAngles.push(Math.atan2(vias[j].sy - v.sy, vias[j].sx - v.sx));
            }
            neighborAngles.sort((a, b) => a - b);
            let bestGap = -1;
            const candidates = [];
            for (let k = 0; k < neighborAngles.length; k++) {
              const a1 = neighborAngles[k];
              const a2 = k + 1 < neighborAngles.length ? neighborAngles[k + 1] : neighborAngles[0] + Math.PI * 2;
              const gap = a2 - a1;
              let mid = a1 + gap / 2;
              while (mid > Math.PI) mid -= Math.PI * 2;
              while (mid <= -Math.PI) mid += Math.PI * 2;
              candidates.push({ gap, mid });
              if (gap > bestGap) bestGap = gap;
            }
            // 在接近最大空隙的候选中优先选择右上方 (-45°) 方向，符合工程制图习惯
            const pref = -Math.PI / 4;
            let chosen = candidates[0] ? candidates[0].mid : pref;
            let bestPrefDist = Infinity;
            candidates.forEach(c => {
              if (c.gap >= bestGap * 0.92) {
                let dAng = Math.abs(c.mid - pref);
                if (dAng > Math.PI) dAng = Math.PI * 2 - dAng;
                if (dAng < bestPrefDist) {
                  bestPrefDist = dAng;
                  chosen = c.mid;
                }
              }
            });
            angle = chosen;
          } else {
            angle = Math.atan2(dy, dx);
          }

          const ux = Math.cos(angle);
          const uy = Math.sin(angle);

          // 计算引线终点锚点 (确保越过孔群外包络)
          let leadLen = padR + 28;
          if (isInterior) {
            leadLen = Math.max(leadLen, maxScreenR * 0.92 + 30);
          } else if (Math.abs(uy) < 0.35 && Math.abs(ux) > 0.85) {
            // 左右水平引出时越过最外侧孔列，保持整齐对齐
            const targetEdgeX = ux < 0 ? (minSx - 32) : (maxSx + 32);
            leadLen = Math.max(leadLen, Math.abs(targetEdgeX - v.sx));
          }

          const ax = v.sx + ux * leadLen;
          const ay = v.sy + uy * leadLen;

          let bx, by, alignSide;
          if (Math.abs(uy) > 0.82 && Math.abs(ux) < 0.38) {
            // 正上 / 正下居中放置
            bx = ax - sp.w / 2;
            by = uy < 0 ? (ay - sp.h - 4) : (ay + 4);
            alignSide = uy < 0 ? 'top' : 'bottom';
          } else if (ux < 0) {
            bx = ax - sp.w - 8;
            by = ay - sp.h / 2;
            alignSide = 'left';
          } else {
            bx = ax + 8;
            by = ay - sp.h / 2;
            alignSide = 'right';
          }

          bx = Math.max(margin, Math.min(W - margin - sp.w, bx));
          by = Math.max(margin, Math.min(H - margin - sp.h, by));

          callouts.push({
            ...sp,
            index: i,
            x: bx,
            y: by,
            targetX: bx,
            targetY: by,
            alignSide,
            ux,
            uy
          });
        });

        // 迭代式碰撞松弛求解：消除标注框之间重叠 + 消除标注框遮挡任何过孔圆盘
        const viaKeepoutPad = padR + 8;
        for (let iter = 0; iter < 120; iter++) {
          let moved = false;

          // 1) 避让所有过孔圆盘
          for (let i = 0; i < callouts.length; i++) {
            const b = callouts[i];
            const bcx = b.x + b.w / 2;
            const bcy = b.y + b.h / 2;
            for (let j = 0; j < vias.length; j++) {
              const v = vias[j];
              const nearX = Math.max(b.x, Math.min(v.sx, b.x + b.w));
              const nearY = Math.max(b.y, Math.min(v.sy, b.y + b.h));
              const dx = nearX - v.sx;
              const dy = nearY - v.sy;
              const dist = Math.hypot(dx, dy);
              if (dist < viaKeepoutPad) {
                let px = bcx - v.sx;
                let py = bcy - v.sy;
                const plen = Math.hypot(px, py) || 1;
                px /= plen;
                py /= plen;
                const push = (viaKeepoutPad - dist) + 2;
                b.x += px * push;
                b.y += py * push;
                moved = true;
              }
            }
          }

          // 2) 消除任意两个标注框之间的矩形重叠
          const gap = 6;
          for (let i = 0; i < callouts.length; i++) {
            for (let j = i + 1; j < callouts.length; j++) {
              const a = callouts[i];
              const b = callouts[j];
              const overlapX = Math.min(a.x + a.w + gap, b.x + b.w + gap) - Math.max(a.x, b.x);
              const overlapY = Math.min(a.y + a.h + gap, b.y + b.h + gap) - Math.max(a.y, b.y);
              if (overlapX > 0 && overlapY > 0) {
                if (overlapY <= overlapX * 1.35) {
                  const dir = (a.y + a.h / 2) <= (b.y + b.h / 2) ? -1 : 1;
                  const shift = overlapY / 2 + 0.5;
                  a.y += dir * shift;
                  b.y -= dir * shift;
                } else {
                  const dir = (a.x + a.w / 2) <= (b.x + b.w / 2) ? -1 : 1;
                  const shift = overlapX / 2 + 0.5;
                  a.x += dir * shift;
                  b.x -= dir * shift;
                }
                moved = true;
              }
            }
          }

          // 3) 边界约束
          for (let i = 0; i < callouts.length; i++) {
            const b = callouts[i];
            b.x = Math.max(margin, Math.min(W - margin - b.w, b.x));
            b.y = Math.max(margin, Math.min(H - margin - b.h, b.y));
          }

          if (!moved) break;
        }
      } else {
        // 多孔阵列方案 (>10孔): 左右双栏纵向等距排布 + 折线引线，确保高密孔群也清晰无重叠
        const sortedByX = specs.slice().sort((a, b) => (a.via.sx - b.via.sx) || (a.via.sy - b.via.sy));
        const halfIdx = Math.ceil(sortedByX.length / 2);
        const leftGroup = sortedByX.slice(0, halfIdx).sort((a, b) => (a.via.sy - b.via.sy) || (a.via.sx - b.via.sx));
        const rightGroup = sortedByX.slice(halfIdx).sort((a, b) => (a.via.sy - b.via.sy) || (b.via.sx - a.via.sx));

        function layoutColumn(group, side) {
          const count = group.length;
          if (!count) return;
          const availH = H - margin * 2;
          const step = Math.max(16, Math.min(28, availH / count));
          const boxH = Math.max(15, Math.min(22, Math.floor(step - 3)));
          const totalH = step * (count - 1) + boxH;
          const startY = Math.max(margin, (H - totalH) / 2);

          group.forEach((sp, k) => {
            const w = Math.min(sp.w, Math.floor(W * 0.34));
            const bx = side === 'left'
              ? Math.max(margin, Math.min(minSx - padR - 26 - w, margin + 4))
              : Math.min(W - margin - w, Math.max(maxSx + padR + 26, W - margin - w - 4));
            const by = startY + k * step;
            callouts.push({
              ...sp,
              w,
              h: boxH,
              index: sp.via.index,
              x: bx,
              y: by,
              alignSide: side
            });
          });
        }

        layoutColumn(leftGroup, 'left');
        layoutColumn(rightGroup, 'right');
        callouts.sort((a, b) => a.index - b.index);
      }

      // 计算每条标注的引线几何折点 (孔外缘起点 -> 折点 -> 标注框连接点)
      callouts.forEach(c => {
        const v = c.via;
        const bcx = c.x + c.w / 2;
        const bcy = c.y + c.h / 2;
        let attachX, attachY, elbowX, elbowY;

        if (bcy + c.h / 2 < v.sy - padR - 8 && Math.abs(bcx - v.sx) < c.w * 0.65) {
          attachX = Math.max(c.x + 12, Math.min(c.x + c.w - 12, v.sx));
          attachY = c.y + c.h;
          elbowX = attachX;
          elbowY = attachY + 6;
        } else if (bcy - c.h / 2 > v.sy + padR + 8 && Math.abs(bcx - v.sx) < c.w * 0.65) {
          attachX = Math.max(c.x + 12, Math.min(c.x + c.w - 12, v.sx));
          attachY = c.y;
          elbowX = attachX;
          elbowY = attachY - 6;
        } else if (bcx < v.sx) {
          attachX = c.x + c.w;
          attachY = bcy;
          elbowX = attachX + 10;
          elbowY = attachY;
        } else {
          attachX = c.x;
          attachY = bcy;
          elbowX = attachX - 10;
          elbowY = attachY;
        }

        const dirX = elbowX - v.sx;
        const dirY = elbowY - v.sy;
        const dLen = Math.hypot(dirX, dirY) || 1;
        c.startX = v.sx + (dirX / dLen) * (padR + 2);
        c.startY = v.sy + (dirY / dLen) * (padR + 2);
        c.elbowX = elbowX;
        c.elbowY = elbowY;
        c.attachX = attachX;
        c.attachY = attachY;
      });
    }

    return {
      width: W,
      height: H,
      cx,
      cy,
      scale,
      padR,
      drillR,
      vias,
      connectors,
      callouts,
      padstackColors: padColorInfo.list,
      padstackColorMap: padColorInfo.map,
      summary: {
        viaCount: N,
        sigCount,
        gndCount,
        minDist,
        maxDist,
        padstackCounts,
        padstackColors: padColorInfo.list
      }
    };
  }

  return {
    estimateTextPx: estimateTextPx,
    computeSchemeViewLayout: computeSchemeViewLayout
  };
});
