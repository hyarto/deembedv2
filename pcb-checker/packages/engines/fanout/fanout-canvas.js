/* ============================================================================
 * fanout-canvas.js —— 扇出方案星座图放大预览与孔心距同色虚线 Canvas 渲染器
 * ========================================================================== */
(function (root, factory) {
  var layoutMod = (typeof module === "object" && module.exports) ? require("./fanout-layout.js") : root.FanoutChecker;
  var paletteMod = (typeof module === "object" && module.exports) ? require("./fanout-palette.js") : root.FanoutChecker;
  var api = factory(layoutMod, paletteMod);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FanoutChecker = Object.assign(root.FanoutChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (layoutMod, paletteMod) {
  "use strict";
  var computeSchemeViewLayout = layoutMod.computeSchemeViewLayout;
  var calcSchemeViaPairDistance = paletteMod.calcSchemeViaPairDistance;
  function drawRoundedRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /**
   * 在高清 Canvas 上渲染放大版扇出方案效果图与逐孔 Padstack 标注 (风格对齐缩略星座图)
   */
  function buildConnectorDistanceColorMap(connectors = []) {
    const distances = [...new Set((connectors || []).map(c => Math.round(Number(c.dist) * 10) / 10).filter(Number.isFinite))].sort((a, b) => a - b);
    return new Map(distances.map((d, i) => [d, `hsl(${Math.round((i * 137.508) % 360)}, 88%, 64%)`]));
  }

  function renderSchemeEnlargedCanvas(canvas, scheme, options = {}) {
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const cssW = Math.max(320, Number(options.width) || canvas.clientWidth || Number(canvas.getAttribute('width')) || 760);
    const cssH = Math.max(260, Number(options.height) || canvas.clientHeight || Number(canvas.getAttribute('height')) || 520);
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? Math.min(3, Math.max(1, window.devicePixelRatio)) : 2;

    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    const monoStack = '"JetBrains Mono", Consolas, Monaco, "Courier New", monospace';
    const sansStack = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

    const layout = computeSchemeViewLayout(scheme, cssW, cssH, {
      ...options,
      measureText: (str, px, isMono) => {
        ctx.font = `600 ${px}px ${isMono ? monoStack : sansStack}`;
        return ctx.measureText(str).width;
      }
    });

    // 1. 深色圆角卡片背景 (#0f172a，复刻并放大附件效果图质感)
    ctx.clearRect(0, 0, cssW, cssH);
    drawRoundedRectPath(ctx, 0, 0, cssW, cssH, 14);
    ctx.fillStyle = '#0f172a';
    ctx.fill();

    // 微弱十字基准中心线
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(layout.cx, 16);
    ctx.lineTo(layout.cx, cssH - 16);
    ctx.moveTo(16, layout.cy);
    ctx.lineTo(cssW - 16, layout.cy);
    ctx.stroke();
    ctx.restore();

    if (layout.vias.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = `600 14px ${sansStack}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('当前扇出方案暂无过孔数据', cssW / 2, cssH / 2);
      ctx.restore();
      return layout;
    }

    // 2. 拓扑虚线按孔心距分色：距离按 0.1 mil 归类，同距同色、不同距尽量使用不同色相。
    const distanceColors = buildConnectorDistanceColorMap(layout.connectors);
    ctx.save();
    ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 4]);
    layout.connectors.forEach(c => {
      const key = Math.round(c.dist * 10) / 10;
      ctx.strokeStyle = distanceColors.get(key) || '#38bdf8';
      ctx.globalAlpha = 0.68;
      ctx.beginPath();
      ctx.moveTo(c.x1, c.y1);
      ctx.lineTo(c.x2, c.y2);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    ctx.restore();

    // 可选：孔心距标注 (mil)
    if (options.showDistances) {
      ctx.save();
      ctx.font = `600 10.5px ${monoStack}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      layout.connectors.filter(c => c.isPrimaryPitch).forEach(c => {
        const mx = (c.x1 + c.x2) / 2;
        const my = (c.y1 + c.y2) / 2;
        const txt = `${c.dist.toFixed(1)} mil`;
        const tw = ctx.measureText(txt).width + 10;
        drawRoundedRectPath(ctx, mx - tw / 2, my - 9, tw, 18, 4);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(txt, mx, my);
      });
      ctx.restore();
    }

    // 3. Padstack 引出指示线 (置于孔与标注框下层，整洁不遮挡，按不同 Padstack 配色)
    if (options.showPadstack !== false && layout.callouts.length > 0) {
      layout.callouts.forEach(c => {
        const v = c.via;
        const hovered = v.isHovered;
        const baseColor = hovered
          ? '#facc15'
          : (v.padBorderColor || (v.isSig ? 'rgba(56, 189, 248, 0.82)' : 'rgba(16, 185, 129, 0.78)'));

        ctx.save();
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = hovered ? 2.2 : 1.45;
        ctx.beginPath();
        ctx.moveTo(c.startX, c.startY);
        ctx.lineTo(c.elbowX, c.elbowY);
        ctx.lineTo(c.attachX, c.attachY);
        ctx.stroke();

        // 孔外缘引线锚点小圆点
        ctx.beginPath();
        ctx.arc(c.startX, c.startY, hovered ? 3.2 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = hovered ? '#facc15' : (v.padColor || baseColor);
        ctx.fill();
        ctx.restore();
      });
    }

    // 4. 放大版同心焊盘环与钻孔 (不同 Padstack 自动以不同高对比色显示 + 白边 + 深色中心钻孔)
    const { padR, drillR } = layout;
    const measureStartIdx = (options.measureStartIndex != null && options.measureStartIndex >= 0)
      ? Number(options.measureStartIndex)
      : -1;
    const measuredPairs = Array.isArray(options.measuredPairs) ? options.measuredPairs : [];

    layout.vias.forEach(v => {
      ctx.save();
      const isMeasureStart = (v.index === measureStartIdx);
      const isInMeasuredPair = measuredPairs.some(mp => mp.i1 === v.index || mp.i2 === v.index);

      if (v.isHovered || isMeasureStart || isInMeasuredPair) {
        ctx.beginPath();
        ctx.arc(v.sx, v.sy, padR + (isMeasureStart ? 7 : 5.5), 0, Math.PI * 2);
        ctx.fillStyle = isMeasureStart
          ? 'rgba(34, 211, 238, 0.25)'
          : (v.isHovered ? 'rgba(250, 204, 21, 0.25)' : 'rgba(251, 191, 36, 0.16)');
        ctx.fill();
        ctx.strokeStyle = isMeasureStart ? '#22d3ee' : '#facc15';
        ctx.lineWidth = isMeasureStart ? 2.4 : 2;
        if (isMeasureStart) ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 外层焊盘环 (按不同 Padstack 专属颜色着色)
      ctx.beginPath();
      ctx.arc(v.sx, v.sy, padR, 0, Math.PI * 2);
      ctx.fillStyle = v.padColor || (v.isSig ? '#38bdf8' : '#10b981');
      ctx.fill();
      ctx.strokeStyle = v.isHovered ? '#fef08a' : '#ffffff';
      ctx.lineWidth = Math.max(1.8, padR * 0.17);
      ctx.stroke();

      // 中心钻孔
      ctx.beginPath();
      ctx.arc(v.sx, v.sy, drillR, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();

      // 若孔较大，在钻孔旁或圆心显示微缩孔号便于测距识别
      if (options.measureMode) {
        ctx.font = `700 ${Math.max(9, Math.round(padR * 0.62))}px ${monoStack}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(String(v.labelNum), v.sx, v.sy);
      }
      ctx.restore();
    });

    // 5. 逐孔 Padstack 清晰标注卡片 (边框与左侧色条同步对应 Padstack 专属颜色)
    if (options.showPadstack !== false && layout.callouts.length > 0) {
      // 将悬停项放到最后绘制以置顶显示
      const ordered = layout.callouts.slice().sort((a, b) => (a.via.isHovered ? 1 : 0) - (b.via.isHovered ? 1 : 0));
      ordered.forEach(c => {
        const v = c.via;
        const hovered = v.isHovered;
        const accent = hovered ? '#facc15' : (v.padColor || (v.isSig ? '#38bdf8' : '#10b981'));
        const borderCol = hovered ? '#facc15' : (v.padBorderColor || accent);
        const headerCol = hovered ? '#fde047' : (v.padLightColor || accent);

        ctx.save();
        ctx.shadowColor = 'rgba(2, 6, 23, 0.55)';
        ctx.shadowBlur = hovered ? 14 : 8;
        ctx.shadowOffsetY = 2;

        drawRoundedRectPath(ctx, c.x, c.y, c.w, c.h, 6);
        ctx.fillStyle = hovered ? 'rgba(30, 41, 59, 0.98)' : 'rgba(15, 23, 42, 0.93)';
        ctx.fill();

        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = borderCol;
        ctx.lineWidth = hovered ? 2.0 : 1.35;
        ctx.stroke();

        // 左侧 Padstack 专属色条
        drawRoundedRectPath(ctx, c.x + 1, c.y + 3, 4, c.h - 6, 2);
        ctx.fillStyle = accent;
        ctx.fill();

        if (c.compact) {
          ctx.font = `700 11px ${monoStack}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = headerCol;
          const numTxt = `#${v.labelNum} `;
          ctx.fillText(numTxt, c.x + 9, c.y + c.h / 2);
          const numW = ctx.measureText(numTxt).width;
          ctx.fillStyle = '#f8fafc';
          ctx.fillText(c.padstackText + (c.coordText ? ` ${c.coordText}` : ''), c.x + 9 + numW, c.y + c.h / 2);
        } else {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.font = `600 10.5px ${sansStack}`;
          ctx.fillStyle = headerCol;
          ctx.fillText(c.headerText, c.x + 10, c.y + 12.5);

          ctx.font = `700 12px ${monoStack}`;
          ctx.fillStyle = '#ffffff';
          ctx.fillText(c.padstackText, c.x + 10, c.y + 28.5);
        }
        ctx.restore();
      });
    }

    // 6. 孔到孔中心距交互测量图层 (置于最上层确保清晰可读)
    const drawDimensionLine = (v1, v2, isPreview, slotOffsetIdx) => {
      const m = calcSchemeViaPairDistance(v1, v2);
      if (!m) return;
      ctx.save();
      const lineColor = isPreview ? '#22d3ee' : '#facc15';

      // 连接孔心的测量线
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = isPreview ? 2.0 : 2.4;
      ctx.setLineDash(isPreview ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(v1.sx, v1.sy);
      ctx.lineTo(v2.sx, v2.sy);
      ctx.stroke();
      ctx.setLineDash([]);

      // 两端孔心十字靶心点
      [v1, v2].forEach(vp => {
        ctx.beginPath();
        ctx.arc(vp.sx, vp.sy, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = lineColor;
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // 中点距离胶囊标签
      const mx = (v1.sx + v2.sx) / 2;
      const my = (v1.sy + v2.sy) / 2 + (slotOffsetIdx ? slotOffsetIdx * 24 : 0);
      const labelTxt = `${isPreview ? '预览 ' : ''}#${m.v1Label} - #${m.v2Label}: ${m.distMil.toFixed(2)} mil (${m.distMm.toFixed(3)} mm)`;
      ctx.font = `700 11.5px ${monoStack}`;
      const tw = ctx.measureText(labelTxt).width + 16;
      const th = 22;
      const bx = Math.max(8, Math.min(cssW - tw - 8, mx - tw / 2));
      const by = Math.max(8, Math.min(cssH - th - 8, my - th / 2));

      ctx.shadowColor = 'rgba(2, 6, 23, 0.75)';
      ctx.shadowBlur = 10;
      drawRoundedRectPath(ctx, bx, by, tw, th, 6);
      ctx.fillStyle = isPreview ? 'rgba(8, 51, 68, 0.95)' : 'rgba(30, 27, 75, 0.96)';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.fillStyle = isPreview ? '#67e8f9' : '#fef08a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelTxt, bx + tw / 2, by + th / 2);
      ctx.restore();
    };

    // 绘制已锁定的孔心距测量对
    measuredPairs.forEach((mp, idx) => {
      const v1 = layout.vias[mp.i1];
      const v2 = layout.vias[mp.i2];
      if (v1 && v2 && mp.i1 !== mp.i2) {
        drawDimensionLine(v1, v2, false, 0);
      }
    });

    // 绘制正在选择第二个孔时的实时橡皮筋预览
    if (measureStartIdx >= 0 && layout.vias[measureStartIdx]) {
      const vStart = layout.vias[measureStartIdx];
      const hovIdx = options.hoveredIndex != null ? Number(options.hoveredIndex) : -1;
      if (hovIdx >= 0 && hovIdx !== measureStartIdx && layout.vias[hovIdx]) {
        drawDimensionLine(vStart, layout.vias[hovIdx], true, 0);
      } else if (options.cursorPos && typeof options.cursorPos.x === 'number') {
        ctx.save();
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.75)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(vStart.sx, vStart.sy);
        ctx.lineTo(options.cursorPos.x, options.cursorPos.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 7. 左上角紧凑型不同 Padstack 颜色图例条 (当有多种 Padstack 时一目了然，导出效果图时自带图例)
    if (layout.padstackColors && layout.padstackColors.length > 0) {
      ctx.save();
      let curX = 12, curY = 12;
      ctx.font = `600 10.5px ${monoStack}`;
      layout.padstackColors.forEach(pc => {
        const shortName = pc.padstack.length > 28 ? (pc.padstack.slice(0, 26) + '…') : pc.padstack;
        const txt = `${shortName} (×${pc.count})`;
        const chipW = ctx.measureText(txt).width + 24;
        if (curX + chipW > cssW - 12 && curX > 12) {
          curX = 12;
          curY += 22;
        }
        drawRoundedRectPath(ctx, curX, curY, chipW, 19, 5);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
        ctx.fill();
        ctx.strokeStyle = pc.border;
        ctx.lineWidth = 1.1;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(curX + 9, curY + 9.5, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = pc.fill;
        ctx.fill();

        ctx.fillStyle = '#e2e8f0';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, curX + 17, curY + 9.5);
        curX += chipW + 6;
      });
      ctx.restore();
    }

    ctx.restore();
    return layout;
  }

  return {
    drawRoundedRectPath: drawRoundedRectPath,
    buildConnectorDistanceColorMap: buildConnectorDistanceColorMap,
    renderSchemeEnlargedCanvas: renderSchemeEnlargedCanvas
  };
});
