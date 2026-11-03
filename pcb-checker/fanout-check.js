/**
 * fanout-check.js
 * 扇出方案空间几何聚类与模式匹配检查引擎
 * 
 * 功能：
 * 1. EDA 过孔数据解析 (Item N < Via > 格式)
 * 2. 空间距离连通聚类算法 (Spatial Hash Grid 2D 连通分量，支持自定义距离阈值如 2mm)
 * 3. 扇出方案库管理 (定义孔间中心距、每个孔的 Padstack Name、方案命名与预设库)
 * 4. 刚体变换不变性几何比对 (支持平移、旋转 0/90/180/270度与镜像匹配)
 * 5. 精确缺陷归因 (明确指出 Padstack 不符孔位、中心距超差对偶、孔数缺失或未知拓扑)
 */

(function (global) {
  'use strict';

  // 单位转换常量
  const MM_PER_MIL = 0.0254;
  const MIL_PER_MM = 1 / 0.0254; // 39.37007874...

  /**
   * 几何辅助函数
   */
  function dist2D(x1, y1, x2, y2) {
    return Math.hypot(x1 - x2, y1 - y2);
  }

  /**
   * 生成候选旋转角（度）。
   * 默认只试正交 0/90/180/270（保持既有判定口径，避免把错的姿态判成通过）；
   * 打开 allowArbitraryRotation 后，用「两孔间距一致的孔对」反推真实旋转角，
   * 从而支持 30°/45°/37.5° 这类任意角度的扇出姿态。
   */
  function candidateRotations(clusterPts, schemePts, distTol, allowRotation, allowArbitrary) {
    const base = allowRotation ? [0, 90, 180, 270] : [0];
    if (!allowArbitrary || !allowRotation || !clusterPts || !schemePts) return base;

    const out = [];
    const seen = new Set();
    const push = (deg) => {
      let d = ((deg % 360) + 360) % 360;
      if (d > 180) d -= 360;
      const key = Math.round(d * 10) / 10;          // 0.1° 粒度去重
      if (seen.has(key)) return;
      seen.add(key);
      out.push(key);
    };
    base.forEach(push);

    const tol = distTol != null ? distTol : 2.0;
    for (let i = 0; i < clusterPts.length; i++) {
      for (let j = i + 1; j < clusterPts.length; j++) {
        const dc = dist2D(clusterPts[i].x, clusterPts[i].y, clusterPts[j].x, clusterPts[j].y);
        for (let a = 0; a < schemePts.length; a++) {
          for (let b = a + 1; b < schemePts.length; b++) {
            const ds = dist2D(schemePts[a].x, schemePts[a].y, schemePts[b].x, schemePts[b].y);
            if (Math.abs(dc - ds) > tol) continue;   // 间距谱不一致，该孔对不可能对应
            // 把「方案 → 孔群」需要的旋转角正反两个方向都作为候选
            const d1 = angleDiffDeg(clusterPts[i], clusterPts[j], schemePts[a], schemePts[b]);
            push(d1);
            push(-d1);
            if (out.length > 64) return out;
          }
        }
      }
    }
    return out;
  }

  /** 两条有向线段的夹角差（度，−180~180） */
  function angleDiffDeg(c1, c2, s1, s2) {
    const ac = Math.atan2(c2.y - c1.y, c2.x - c1.x);
    const as = Math.atan2(s2.y - s1.y, s2.x - s1.x);
    let d = (as - ac) * 180 / Math.PI;
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    return d;
  }

  function roundN(val, n = 4) {
    if (typeof val !== 'number' || isNaN(val)) return 0;
    const factor = Math.pow(10, n);
    return Math.round(val * factor) / factor;
  }

  /**
   * 1. 解析 EDA TXT 中的过孔数据 (Via)
   * @param {string} text 
   * @returns {Array<Object>} vias
   */
  function parseViaData(text) {
    if (!text || typeof text !== 'string') return [];
    
    const RE_ITEM_BLOCK = /Item\s+(\d+)[\s\S]*?(?=Item\s+\d+|\s*$)/g;
    const RE_ORIGIN = /Origin-xy:\s*\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]/i;
    const RE_PADSTACK = /Padstack\s+Name:\s*([^\r\n]+)/i;
    const RE_NET = /Net:\s*([^\r\n]+)/i;
    const RE_DRILL = /Circle\s+Drill:\s*([\d\.\-]+)/i;
    const RE_ROTATION = /Rotation:\s*([\d\.\-]+)/i;
    const RE_MIRROR = /Mirror\s+Status:\s*([^\r\n]+)/i;

    const vias = [];
    let match;

    while ((match = RE_ITEM_BLOCK.exec(text)) !== null) {
      const itemNum = parseInt(match[1], 10);
      const block = match[0];

      if (!block.includes('< Via >') && !block.includes('<Via>')) {
        continue;
      }

      const origM = block.match(RE_ORIGIN);
      if (!origM) continue;

      const x = parseFloat(origM[1]);
      const y = parseFloat(origM[2]);
      const padM = block.match(RE_PADSTACK);
      const padstack = padM ? padM[1].trim() : 'UNKNOWN_PADSTACK';
      const netM = block.match(RE_NET);
      const net = netM ? netM[1].trim() : 'UNNAMED_NET';
      const drillM = block.match(RE_DRILL);
      const drill = drillM ? parseFloat(drillM[1]) : 0;
      const rotM = block.match(RE_ROTATION);
      const rotation = rotM ? parseFloat(rotM[1]) : 0;
      const mirM = block.match(RE_MIRROR);
      const mirror = mirM ? mirM[1].trim() : 'N';

      const hasConnections = /Connections:\s*\r?\n\s*\w+/i.test(block);
      const isSignal = !net.toUpperCase().includes('GND');

      vias.push({
        id: itemNum,
        rawId: itemNum,
        x,
        y,
        padstack,
        net,
        drill,
        rotation,
        mirror,
        hasConnections,
        isSignal
      });
    }

    // 如果没有匹配到 Item 块，尝试通用 CSV / 制表符坐标解析
    if (vias.length === 0) {
      const lines = text.split(/\r?\n/);
      let autoId = 1;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
        // 尝试匹配 "X, Y, Padstack, Net" 或 "X Y Padstack"
        const parts = trimmed.split(/[\t,;]+/).map(s => s.trim()).filter(Boolean);
        if (parts.length >= 2) {
          const px = parseFloat(parts[0]);
          const py = parseFloat(parts[1]);
          if (!isNaN(px) && !isNaN(py)) {
            const padstack = parts[2] || 'STANDARD_VIA';
            const net = parts[3] || 'GND';
            vias.push({
              id: autoId++,
              rawId: autoId - 1,
              x: px,
              y: py,
              padstack,
              net,
              drill: 0,
              rotation: 0,
              mirror: 'N'
            });
          }
        }
      }
    }

    return vias;
  }

  /**
   * 2. 空间距离图连通分量聚类 (Spatial Hash Grid Clustering)
   * 依据：两孔中心距 <= threshold (默认 2mm = 78.7402 mil) 认为同属于一个扇出方案整体
   * 
   * @param {Array<Object>} vias 
   * @param {number} thresholdDist 中心距阈值 (单位与坐标一致，通常为 mil)
   * @returns {Array<Object>} clusters 分割后的孔整体集合
   */
  function clusterVias(vias, thresholdDist = 78.740157) {
    if (!vias || vias.length === 0) return [];
    const n = vias.length;

    // Disjoint Set Union (并查集)
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;

    function find(i) {
      let root = i;
      while (root !== parent[root]) root = parent[root];
      let curr = i;
      while (curr !== root) {
        let nxt = parent[curr];
        parent[curr] = root;
        curr = nxt;
      }
      return root;
    }

    function union(i, j) {
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI !== rootJ) parent[rootI] = rootJ;
    }

    // 空间网格索引加速，避免 O(N^2)
    const cellSize = Math.max(thresholdDist, 1.0);
    const grid = new Map();

    for (let i = 0; i < n; i++) {
      const v = vias[i];
      const gx = Math.floor(v.x / cellSize);
      const gy = Math.floor(v.y / cellSize);
      const key = `${gx},${gy}`;
      let list = grid.get(key);
      if (!list) {
        list = [];
        grid.set(key, list);
      }
      list.push(i);
    }

    const threshSq = thresholdDist * thresholdDist;

    for (let i = 0; i < n; i++) {
      const v = vias[i];
      const gx = Math.floor(v.x / cellSize);
      const gy = Math.floor(v.y / cellSize);

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${gx + dx},${gy + dy}`;
          const list = grid.get(key);
          if (!list) continue;
          for (let k = 0; k < list.length; k++) {
            const j = list[k];
            if (j <= i) continue;
            const other = vias[j];
            const distSq = (v.x - other.x) * (v.x - other.x) + (v.y - other.y) * (v.y - other.y);
            if (distSq <= threshSq) union(i, j);
          }
        }
      }
    }

    // 按连通分量汇总孔整体
    const groupMap = new Map();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      let group = groupMap.get(root);
      if (!group) {
        group = [];
        groupMap.set(root, group);
      }
      group.push(vias[i]);
    }

    // 格式化每个 Cluster 对象
    const clusters = [];
    let clusterIdx = 1;

    for (const members of groupMap.values()) {
      let sumX = 0, sumY = 0;
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;

      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        sumX += m.x; sumY += m.y;
        if (m.x < minX) minX = m.x;
        if (m.x > maxX) maxX = m.x;
        if (m.y < minY) minY = m.y;
        if (m.y > maxY) maxY = m.y;
      }

      const count = members.length;
      const centroidX = sumX / count;
      const centroidY = sumY / count;
      const spanX = maxX - minX;
      const spanY = maxY - minY;
      const maxSpan = Math.hypot(spanX, spanY);

      // 仅对典型扇出规模 (<= 100 孔) 计算全量两两孔心距；超大孔群按需计算，极大节省内存
      const pairwiseDistances = [];
      if (count <= 100) {
        for (let i = 0; i < count; i++) {
          for (let j = i + 1; j < count; j++) {
            const d = Math.hypot(members[i].x - members[j].x, members[i].y - members[j].y);
            pairwiseDistances.push({
              v1: members[i].id,
              v2: members[j].id,
              dist: d,
              distMm: d * MM_PER_MIL
            });
          }
        }
      }

      // Padstack 统计
      const padstackCounts = {};
      for (let i = 0; i < count; i++) {
        const p = members[i].padstack || 'UNKNOWN';
        padstackCounts[p] = (padstackCounts[p] || 0) + 1;
      }

      clusters.push({
        id: `cluster_${clusterIdx++}`,
        viaCount: count,
        vias: members,
        centroid: { x: centroidX, y: centroidY },
        bbox: { minX, maxX, minY, maxY, spanX, spanY, maxSpan },
        pairwiseDistances,
        padstackCounts
      });
    }

    return clusters;
  }

  /**
   * 3. 扇出方案定义与库管理 (Fanout Scheme Template & Library)
   */
  class FanoutScheme {
    /**
     * @param {Object} options
     * @param {string} options.id 方案唯一标识
     * @param {string} options.name 方案名称 (如 "SMA-Bot-L19-5Via")
     * @param {string} options.category 方案类别 (如 "SMA出线", "BGA差分")
     * @param {string} options.description 描述说明
     * @param {Array<Object>} options.vias 方案内各过孔定义 [{id, x, y, padstack, net, role}]
     * @param {string} options.unit 方案坐标单位 'mil' 或 'mm' (默认 'mil')
     */
    constructor(options = {}) {
      this.id = options.id || `scheme_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      this.name = options.name || '未命名扇出方案';
      this.category = options.category || '通用扇出';
      this.description = options.description || '';
      this.unit = options.unit || 'mil';

      // 规范化孔位信息 (统一存储为 mil)
      const rawVias = options.vias || [];
      const unitScale = this.unit === 'mm' ? MIL_PER_MM : 1.0;

      this.vias = rawVias.map((v, idx) => ({
        id: v.id != null ? v.id : idx + 1,
        x: (v.x || 0) * unitScale,
        y: (v.y || 0) * unitScale,
        padstack: (v.padstack || 'STANDARD_VIA').trim(),
        net: (v.net || '').trim(),
        role: (v.role || '').trim(),
        drill: v.drill || 0
      }));

      this.viaCount = this.vias.length;
      this._computeGeometry();
    }

    /**
     * 计算方案内部几何特征（质心归一化、孔间距矩阵、特征距离谱）
     */
    _computeGeometry() {
      if (this.viaCount === 0) {
        this.centroid = { x: 0, y: 0 };
        this.pairwiseDistances = [];
        this.distMatrix = [];
        this.normalizedVias = [];
        return;
      }

      let sumX = 0, sumY = 0;
      for (const v of this.vias) {
        sumX += v.x;
        sumY += v.y;
      }
      this.centroid = { x: sumX / this.viaCount, y: sumY / this.viaCount };

      // 质心归一化坐标 (Centered Coords)
      this.normalizedVias = this.vias.map(v => ({
        ...v,
        nx: v.x - this.centroid.x,
        ny: v.y - this.centroid.y
      }));

      // 两两孔心距
      this.pairwiseDistances = [];
      this.distMatrix = [];
      for (let i = 0; i < this.viaCount; i++) {
        this.distMatrix[i] = new Float64Array(this.viaCount);
      }

      for (let i = 0; i < this.viaCount; i++) {
        for (let j = i + 1; j < this.viaCount; j++) {
          const d = dist2D(this.vias[i].x, this.vias[i].y, this.vias[j].x, this.vias[j].y);
          this.distMatrix[i][j] = d;
          this.distMatrix[j][i] = d;
          this.pairwiseDistances.push({
            viaAIndex: i,
            viaBIndex: j,
            dist: d,
            distMm: d * MM_PER_MIL
          });
        }
      }

      this.pairwiseDistances.sort((a, b) => a.dist - b.dist);

      // 提取 Padstack 频次分布
      this.padstackCounts = {};
      for (const v of this.vias) {
        const p = v.padstack;
        this.padstackCounts[p] = (this.padstackCounts[p] || 0) + 1;
      }
    }

    /**
     * 导出为纯 JSON 配置对象
     */
    toJSON() {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        description: this.description,
        unit: 'mil',
        vias: this.vias.map(v => ({
          id: v.id,
          x: roundN(v.x, 4),
          y: roundN(v.y, 4),
          padstack: v.padstack,
          net: v.net,
          role: v.role,
          drill: v.drill
        }))
      };
    }

    /**
     * 从文本片段或过孔集合创建扇出方案
     */
    static fromVias(name, vias, options = {}) {
      return new FanoutScheme({
        name,
        category: options.category || '导入方案',
        description: options.description || '',
        unit: options.unit || 'mil',
        vias
      });
    }

    /**
     * 从 EDA 文本片段创建方案
     */
    static fromText(name, text, options = {}) {
      const parsed = parseViaData(text);
      return FanoutScheme.fromVias(name, parsed, options);
    }
  }

  /**
   * 扇出方案库管理器
   */
  class FanoutLibrary {
    constructor() {
      this.schemes = [];
    }

    addScheme(scheme) {
      if (!(scheme instanceof FanoutScheme)) {
        scheme = new FanoutScheme(scheme);
      }
      // 检查重名或重复 ID
      const existingIdx = this.schemes.findIndex(s => s.id === scheme.id || s.name === scheme.name);
      if (existingIdx >= 0) {
        this.schemes[existingIdx] = scheme;
      } else {
        this.schemes.push(scheme);
      }
      return scheme;
    }

    removeScheme(schemeId) {
      const idx = this.schemes.findIndex(s => s.id === schemeId);
      if (idx >= 0) {
        this.schemes.splice(idx, 1);
        return true;
      }
      return false;
    }

    getScheme(schemeId) {
      return this.schemes.find(s => s.id === schemeId || s.name === schemeId) || null;
    }

    clear() {
      this.schemes = [];
    }

    toJSON() {
      return this.schemes.map(s => s.toJSON());
    }

    loadFromJSON(jsonInput) {
      let array = jsonInput;
      if (typeof jsonInput === 'string') {
        const res = parseAndRepairFanoutJson(jsonInput);
        if (res.success && Array.isArray(res.schemes)) array = res.schemes;
      }
      if (!Array.isArray(array)) return;
      this.clear();
      for (const item of array) {
        this.addScheme(new FanoutScheme(item));
      }
    }

    /**
     * 加载内置标准方案预设库
     */
    loadStandardPresets() {
      const presets = getStandardPresetSchemes();
      for (const p of presets) {
        this.addScheme(p);
      }
    }
  }

  /**
   * 内置典型扇出方案预设
   */
  function getStandardPresetSchemes() {
    return [
      // 方案 1: SMA Bot-L19 5孔十字扇出 (1信号孔 + 4地孔)
      new FanoutScheme({
        id: 'preset_sma_bot_l19_5via',
        name: 'SMA-Bot-L19-5孔标准十字扇出',
        category: 'SMA接插件扇出',
        description: '底面L19层出线 SMA 1信号孔 + 4个伴随GND屏蔽地孔，孔心距 20mil/28.28mil',
        vias: [
          { id: 1, x: 0.0, y: 0.0, padstack: 'SMA_Bot-L19_d2m6mil_via-0902', net: 'SIG', role: '中心信号孔' },
          { id: 2, x: 0.0, y: 20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随屏蔽地孔(上)' },
          { id: 3, x: 0.0, y: -20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随屏蔽地孔(下)' },
          { id: 4, x: -20.0, y: 0.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随屏蔽地孔(左)' },
          { id: 5, x: 20.0, y: 0.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随屏蔽地孔(右)' }
        ]
      }),

      // 方案 2: SMA L2 表层 5孔十字扇出
      new FanoutScheme({
        id: 'preset_sma_l2_5via',
        name: 'SMA-L2-5孔表层十字扇出',
        category: 'SMA接插件扇出',
        description: 'L2层出线 SMA 1信号孔 + 4个伴随GND屏蔽地孔',
        vias: [
          { id: 1, x: 0.0, y: 0.0, padstack: 'SMA_L2_d2m6mil_via_0902', net: 'SIG', role: '中心信号孔' },
          { id: 2, x: 0.0, y: 20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随屏蔽地孔(上)' },
          { id: 3, x: 0.0, y: -20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随屏蔽地孔(下)' },
          { id: 4, x: -20.0, y: 0.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随屏蔽地孔(左)' },
          { id: 5, x: 20.0, y: 0.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随屏蔽地孔(右)' }
        ]
      }),

      // 方案 3: BGA 差分孔对 + 4伴随地孔 (6孔对称方案)
      new FanoutScheme({
        id: 'preset_bga_diff_6via',
        name: 'BGA-差分对+4伴随地孔(6孔方案)',
        category: 'BGA差分扇出',
        description: 'BGA区域差分对信号孔(P/N) + 四角包围伴随地孔',
        vias: [
          { id: 1, x: -10.0, y: 0.0, padstack: 'test_BGA_3510_L19_L2_ring3mil', net: 'DIFF_P', role: '差分信号孔P' },
          { id: 2, x: 10.0, y: 0.0, padstack: 'test_BGA_3510_L19_L2_ring3mil', net: 'DIFF_N', role: '差分信号孔N' },
          { id: 3, x: -30.0, y: 20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随地孔1' },
          { id: 4, x: 30.0, y: 20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随地孔2' },
          { id: 5, x: -30.0, y: -20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随地孔3' },
          { id: 6, x: 30.0, y: -20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '伴随地孔4' }
        ]
      }),

      // 方案 4: BGA 2×2 地孔阵列 (4孔方案)
      new FanoutScheme({
        id: 'preset_bga_2x2_gnd_4via',
        name: 'BGA-2×2地孔阵列(4孔方案)',
        category: 'BGA地孔阵列',
        description: 'BGA 2×2 矩形地孔阵列，间距 20mil × 20mil',
        vias: [
          { id: 1, x: -10.0, y: 10.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '地孔(左上)' },
          { id: 2, x: 10.0, y: 10.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '地孔(右上)' },
          { id: 3, x: -10.0, y: -10.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '地孔(左下)' },
          { id: 4, x: 10.0, y: -10.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '地孔(右下)' }
        ]
      }),

      // 方案 5: 1×3 直线地孔排 (3孔方案)
      new FanoutScheme({
        id: 'preset_bga_1x3_gnd_3via',
        name: 'BGA-1×3直线地孔排(3孔方案)',
        category: 'BGA地孔阵列',
        description: 'BGA 直线排列 3个地孔，间距 20mil',
        vias: [
          { id: 1, x: 0.0, y: -20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '地孔1' },
          { id: 2, x: 0.0, y: 0.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '地孔2' },
          { id: 3, x: 0.0, y: 20.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '地孔3' }
        ]
      }),

      // 方案 6: 高速差分双孔扇出 (2孔方案)
      new FanoutScheme({
        id: 'preset_diff_pair_2via',
        name: '高速差分对双孔扇出(2孔方案)',
        category: '高速差分扇出',
        description: '高速差分对双过孔，中心距 20mil',
        vias: [
          { id: 1, x: 0.0, y: -10.0, padstack: 'test_BGA_3510_L19_L2_ring3mil', net: 'DIFF_P', role: '差分P孔' },
          { id: 2, x: 0.0, y: 10.0, padstack: 'test_BGA_3510_L19_L2_ring3mil', net: 'DIFF_N', role: '差分N孔' }
        ]
      })
    ];
  }

  /**
   * 4. 几何与 Padstack 比对核心算法 (Pattern Matcher)
   * 
   * 判据：
   * 1. 孔与孔中心距是否一致 (在允许容差范围内，支持平移、旋转 0/90/180/270度及镜像变换)
   * 2. 每个对应孔的 Padstack Name 是否一致
   * 
   * @param {Object} cluster 分割出的一个孔整体
   * @param {FanoutLibrary} library 扇出方案库
   * @param {Object} options 匹配参数
   * @param {number} options.distanceTolerance 孔间距匹配容差 (mil, 默认 2.0mil ≈ 0.05mm)
   * @param {boolean} options.allowRotation 是否允许旋转 (默认 true)
   * @param {boolean} options.allowMirror 是否允许镜像 (默认 true)
   * @returns {Object} 匹配结果详情
   */

  /**
   * 子集/局部拓扑匹配算法 (Subset Pattern Matcher & Redundancy Inspector)
   * 
   * 针对连通聚类后形成的复杂/组合孔群 (如 30-34 孔大区域)：
   * 分析该孔阵列中是否包含方案库定义的 1 个或多个扇出拓扑子集，
   * 并识别出外围的伴随屏蔽地孔/冗余孔 (Redundant Vias)。
   */
  function matchClusterSubsetsIterative(cluster, library, options = {}) {
    const distTol = options.distanceTolerance != null ? options.distanceTolerance : 2.0;
    const allowRotation = options.allowRotation !== false;
    const allowMirror = options.allowMirror !== false;
    const redundantPolicy = options.redundantViaPolicy || 'ANY_GND_REDUNDANT';
    const K = cluster.vias.length;

    // 候选方案按孔数从大到小排序，优先匹配大拓扑
    const candidateSchemes = library.schemes
      .filter(s => s.vias && s.vias.length > 0 && s.vias.length <= K)
      .sort((a, b) => b.vias.length - a.vias.length);

    if (candidateSchemes.length === 0) return null;

    // 建立空间哈希网格加速邻近孔查找
    const cellSize = Math.max(10, distTol * 3);
    const grid = new Map();
    for (let i = 0; i < K; i++) {
      const v = cluster.vias[i];
      const gx = Math.floor(v.x / cellSize);
      const gy = Math.floor(v.y / cellSize);
      const key = (gx << 16) ^ gy;
      let list = grid.get(key);
      if (!list) {
        list = [];
        grid.set(key, list);
      }
      list.push(i);
    }

    function findClosestViaInGrid(expectedX, expectedY, usedSet) {
      const gx = Math.floor(expectedX / cellSize);
      const gy = Math.floor(expectedY / cellSize);
      let bestIdx = -1;
      let minDist = distTol;

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = ((gx + dx) << 16) ^ (gy + dy);
          const list = grid.get(key);
          if (!list) continue;
          for (let idx of list) {
            if (usedSet.has(idx)) continue;
            const cv = cluster.vias[idx];
            const d = Math.hypot(cv.x - expectedX, cv.y - expectedY);
            if (d <= minDist) {
              minDist = d;
              bestIdx = idx;
            }
          }
        }
      }
      return { idx: bestIdx, dist: minDist };
    }

    const rawCandidates = [];
    const matchedSubSchemes = [];
    const claimedSignalViaIds = new Set();
    const allMatchedViaIds = new Set();

    for (const scheme of candidateSchemes) {
      const M = scheme.vias.length;
      let anchorSchemeIdx = scheme.vias.findIndex(v => v.net && !v.net.toUpperCase().includes('GND'));
      if (anchorSchemeIdx < 0) anchorSchemeIdx = 0;
      const s0 = scheme.vias[anchorSchemeIdx];
      const isSignalAnchor = s0.net && !s0.net.toUpperCase().includes('GND');

      // 仅在未被占用的锚点孔中寻找匹配
      let candidateIndices = [];
      for (let i = 0; i < K; i++) {
        const cv = cluster.vias[i];
        if (isSignalAnchor) {
          if (cv.net && !cv.net.toUpperCase().includes('GND') && !claimedSignalViaIds.has(cv.id)) {
            candidateIndices.push(i);
          }
        } else {
          candidateIndices.push(i);
        }
      }

      if (candidateIndices.length === 0) continue;

      const angles = allowRotation ? [0, 90, 180, 270] : [0];
      const mirrors = allowMirror ? [false, true] : [false];

      for (const mirror of mirrors) {
        for (const deg of angles) {
          const rad = (deg * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);

          const relScheme = scheme.vias.map((sv, idx) => {
            let dx = sv.x - s0.x;
            let dy = sv.y - s0.y;
            if (mirror) dx = -dx;
            const rx = dx * cos - dy * sin;
            const ry = dx * sin + dy * cos;
            return { ...sv, relX: rx, relY: ry, origIdx: idx };
          });

          for (let ciIdx of candidateIndices) {
            const ci = cluster.vias[ciIdx];
            if (isSignalAnchor && claimedSignalViaIds.has(ci.id)) continue;

            const usedIndices = new Set();
            let maxDev = 0;
            let totalDev = 0;
            let padMismatchCount = 0;
            let allFound = true;
            const audit = [];

            for (let j = 0; j < M; j++) {
              const sv = relScheme[j];
              const expX = ci.x + sv.relX;
              const expY = ci.y + sv.relY;

              const match = findClosestViaInGrid(expX, expY, usedIndices);
              if (match.idx !== -1) {
                usedIndices.add(match.idx);
                const cv = cluster.vias[match.idx];
                if (match.dist > maxDev) maxDev = match.dist;
                totalDev += match.dist;

                const isPadMatch = (cv.padstack || '').trim().toLowerCase() === (sv.padstack || '').trim().toLowerCase();
                if (!isPadMatch) padMismatchCount++;

                audit.push({
                  viaIndex: j + 1,
                  viaId: cv.id,
                  net: cv.net,
                  x: cv.x,
                  y: cv.y,
                  actualPadstack: cv.padstack,
                  expectedPadstack: sv.padstack,
                  schemeViaId: sv.id,
                  schemeRole: sv.role || (`孔${sv.id}`),
                  isMatch: isPadMatch,
                  deviation: match.dist
                });
              } else {
                allFound = false;
                break;
              }
            }

            if (allFound) {
              const matchedIds = Array.from(usedIndices).map(idx => cluster.vias[idx].id);
              rawCandidates.push({
                schemeName: scheme.name,
                schemeId: scheme.id,
                schemeCategory: scheme.category,
                viaCount: M,
                angle: deg,
                mirror,
                maxDeviation: maxDev,
                avgDeviation: totalDev / M,
                padMismatchCount,
                matchedViaIds: matchedIds,
                signalViaIds: matchedIds.filter(id => {
                  const v = cluster.vias.find(x => x.id === id);
                  return v && v.net && !v.net.toUpperCase().includes('GND');
                }),
                audit
              });
            }
          }
        }
      }
    }

    // 候选子集匹配排序选择: 优先 Padstack 100% 吻合 (padMismatchCount 最小)，其次孔数最多，再次几何偏差最小
    rawCandidates.sort((a, b) => {
      if (a.padMismatchCount !== b.padMismatchCount) return a.padMismatchCount - b.padMismatchCount;
      if (b.viaCount !== a.viaCount) return b.viaCount - a.viaCount;
      return a.maxDeviation - b.maxDeviation;
    });

    // 贪心配对：非重叠认领信号孔
    for (const cand of rawCandidates) {
      const hasConflict = cand.signalViaIds.some(id => claimedSignalViaIds.has(id));
      if (hasConflict) continue;

      cand.signalViaIds.forEach(id => claimedSignalViaIds.add(id));
      cand.matchedViaIds.forEach(id => allMatchedViaIds.add(id));
      matchedSubSchemes.push(cand);
    }

    if (matchedSubSchemes.length === 0) return null;

    const redundantVias = cluster.vias.filter(v => !allMatchedViaIds.has(v.id));
    const redundantViaIds = redundantVias.map(v => v.id);
    const redundantGndVias = redundantVias.filter(v => !v.net || v.net.toUpperCase().includes('GND'));
    const redundantSignalVias = redundantVias.filter(v => v.net && !v.net.toUpperCase().includes('GND'));

    const totalPadMismatches = matchedSubSchemes.reduce((sum, m) => sum + m.padMismatchCount, 0);
    // 不管存不存在冗余孔，只要孔群内有与扇出方案库一致的孔，就认定为匹配通过
    const pass = totalPadMismatches === 0;

    let status = pass ? 'SUBSET_MATCH_PASS' : 'SUBSET_PADSTACK_MISMATCH';
    let statusText = pass 
      ? (redundantVias.length > 0 ? `匹配通过 (含${redundantVias.length}个冗余孔)` : '完全匹配通过')
      : '子集Padstack不符';

    // 方案名称聚合去重计数
    const schemeCounts = {};
    matchedSubSchemes.forEach(m => {
      schemeCounts[m.schemeName] = (schemeCounts[m.schemeName] || 0) + 1;
    });
    const schemeSummary = Object.entries(schemeCounts)
      .map(([name, count]) => count > 1 ? `【${name}】×${count}` : `【${name}】`)
      .join(' + ');

    const redundancyStr = redundantVias.length > 0 
      ? `，包含 ${redundantVias.length} 个冗余孔 (${redundantGndVias.length} 伴随地孔${redundantSignalVias.length > 0 ? `, ${redundantSignalVias.length} 信号孔` : ''})`
      : ' (无冗余孔)';

    const maxDev = Math.max(...matchedSubSchemes.map(m => m.maxDeviation));

    let message = pass
      ? `✅ 匹配扇出方案 ${schemeSummary}${redundancyStr}，中心距最大偏差 ${roundN(maxDev, 2)} mil，方案过孔 Padstack 完全符合`
      : `子集拓扑匹配 ${schemeSummary}${redundancyStr}，但其中 ${totalPadMismatches} 个过孔的 Padstack 与方案不一致`;

    const primaryMatch = matchedSubSchemes[0];

    // 构造全量过孔审计明细 (包含匹配孔和冗余孔)
    const fullViaAudit = [];
    matchedSubSchemes.forEach(sm => fullViaAudit.push(...sm.audit));
    redundantVias.forEach(rv => {
      fullViaAudit.push({
        viaIndex: fullViaAudit.length + 1,
        viaId: rv.id,
        net: rv.net || 'GND',
        x: rv.x,
        y: rv.y,
        actualPadstack: rv.padstack,
        expectedPadstack: '(外围冗余孔)',
        schemeViaId: null,
        schemeRole: '伴随屏蔽/冗余地孔',
        isMatch: true,
        isRedundant: true,
        deviation: 0
      });
    });

    return {
      status,
      statusText,
      pass,
      isSubsetMatch: true,
      schemeName: schemeSummary,
      schemeId: primaryMatch.schemeId,
      schemeCategory: primaryMatch.schemeCategory,
      subMatches: matchedSubSchemes,
      rotationAngle: primaryMatch.angle,
      isMirrored: primaryMatch.mirror,
      maxDeviation: maxDev,
      maxDeviationMm: maxDev * MM_PER_MIL,
      matchedViaCount: allMatchedViaIds.size,
      redundantViaCount: redundantVias.length,
      redundantViaIds,
      redundantGndCount: redundantGndVias.length,
      redundantSignalCount: redundantSignalVias.length,
      padMismatchCount: totalPadMismatches,
      matchScore: pass ? 0.95 : 0.6,
      geometrySimilarity: 1.0,
      message,
      viaAudit: fullViaAudit
    };
  }

  function matchClusterToLibrary(cluster, library, options = {}) {
    const distTol = options.distanceTolerance != null ? options.distanceTolerance : 2.0; // mil
    const allowRotation = options.allowRotation !== false;
    const allowMirror = options.allowMirror !== false;
    const allowSubsetMatch = options.allowSubsetMatch !== false; // 默认开启子集/冗余孔容差规则
    const allowArbitraryRotation = options.allowArbitraryRotation === true; // 任意角度姿态（默认关闭）
    const redundantPolicy = options.redundantViaPolicy || 'ANY_GND_REDUNDANT';

    const K = cluster.viaCount;
    if (K <= 0) {
      return {
        status: 'EMPTY',
        statusText: '空孔群',
        pass: false,
        matchedScheme: null,
        message: '该孔群无过孔数据'
      };
    }

    if (K === 1) {
      return {
        status: 'ISOLATED_VIA',
        statusText: '孤立单孔',
        pass: false,
        matchedScheme: null,
        message: `孤立单孔 (孔 #${cluster.vias[0].id}，周围 ${roundN(options.clusterThreshold || 78.74, 1)} mil 范围内无相邻过孔)`,
        viaAudit: [
          {
            viaId: cluster.vias[0].id,
            x: cluster.vias[0].x,
            y: cluster.vias[0].y,
            actualPadstack: cluster.vias[0].padstack,
            expectedPadstack: '-',
            status: 'ISOLATED'
          }
        ]
      };
    }

    // 1. 优先进行全量 1:1 精确匹配
    let bestResult = null;
    let closestCandidate = null;

    for (const scheme of library.schemes) {
      if (!scheme.vias || scheme.vias.length === 0) continue;
      const res = compareClusterWithScheme(cluster, scheme, { distTol, allowRotation, allowMirror, allowArbitraryRotation });

      // 如果完全匹配通过，直接返回
      if (res.pass) {
        return res;
      }

      if (!bestResult || res.matchScore > (bestResult.matchScore || 0)) {
        bestResult = res;
      }

      if (!closestCandidate || res.geometrySimilarity > (closestCandidate.geometrySimilarity || 0)) {
        closestCandidate = res;
      }
    }

    // 若 1:1 全量匹配几何完全符合仅 Padstack 不符，直接返回 1:1 明确结论
    if (bestResult && bestResult.status === 'PADSTACK_MISMATCH') {
      return bestResult;
    }

    // 2. 如果全量匹配未通过，且开启了子集/冗余孔容差分析，执行子集拓扑与冗余孔分析
    if (allowSubsetMatch && library.schemes.length > 0) {
      const subsetRes = matchClusterSubsetsIterative(cluster, library, {
        distanceTolerance: distTol,
        allowRotation,
        allowMirror,
        redundantViaPolicy: redundantPolicy
      });

      if (subsetRes) {
        return subsetRes;
      }
    }

    // 3. 如果没有方案库或没有找到任何匹配
    if (!bestResult || bestResult.matchScore < 0.2) {
      const topScheme = library.schemes.find(s => s.viaCount === K) || library.schemes[0];
      return {
        status: 'NO_MATCH_TOPOLOGY',
        statusText: '未匹配任何方案库拓扑',
        pass: false,
        matchedScheme: null,
        closestSchemeName: topScheme ? topScheme.name : '无',
        matchScore: 0,
        message: `包含 ${K} 个过孔，未在扇出方案库中找到中心距与拓扑匹配的方案${topScheme ? ` (最接近方案: 【${topScheme.name}】)` : ''}`,
        clusterVias: cluster.vias,
        pairwiseDistances: cluster.pairwiseDistances
      };
    }

    return bestResult;
  }

  /**
   * 将一个孔整体与指定方案进行深入比对
   */
  function compareClusterWithScheme(cluster, scheme, { distTol = 2.0, allowRotation = true, allowMirror = true, allowArbitraryRotation = false }) {
    const K = cluster.viaCount;
    const M = scheme.viaCount;

    // 孔数不匹配
    if (K !== M) {
      return {
        status: 'VIA_COUNT_MISMATCH',
        statusText: '过孔数量不匹配',
        pass: false,
        schemeName: scheme.name,
        schemeId: scheme.id,
        matchScore: 0.1,
        geometrySimilarity: 0,
        message: `孔群包含 ${K} 个孔，而方案【${scheme.name}】定义为 ${M} 个孔 (相差 ${Math.abs(K - M)} 个孔)`
      };
    }

    // 1. 检验孔间距谱 (Distance Spectrum)
    // 两个同构点集的两两距离排序列表必须在容差范围内一一接近
    const cDists = cluster.pairwiseDistances.map(p => p.dist).sort((a, b) => a - b);
    const sDists = scheme.pairwiseDistances.map(p => p.dist).sort((a, b) => a - b);

    let maxDistDiff = 0;
    let distDiffSum = 0;
    for (let i = 0; i < cDists.length; i++) {
      const diff = Math.abs(cDists[i] - sDists[i]);
      distDiffSum += diff;
      if (diff > maxDistDiff) maxDistDiff = diff;
    }

    const avgDistDiff = distDiffSum / (cDists.length || 1);
    const geometryPass = maxDistDiff <= distTol;

    // 2. 质心归一化点云刚体匹配 (寻找最佳旋转与点对点双射映射 Mapping)
    // 质心平移后测试标准旋转角度：0°, 90°, 180°, 270° 以及是否镜像
    const angles = candidateRotations(cluster.vias, scheme.vias, distTol, allowRotation, allowArbitraryRotation);
    const mirrors = allowMirror ? [false, true] : [false];

    // 聚类归一化坐标
    const clusterNormVias = cluster.vias.map(v => ({
      ...v,
      nx: v.x - cluster.centroid.x,
      ny: v.y - cluster.centroid.y
    }));

    let bestAlignment = null;

    for (const mirror of mirrors) {
      for (const deg of angles) {
        const rad = (deg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        // 对方案模版点进行旋转与镜像变换
        const transformedSchemeVias = scheme.normalizedVias.map(sv => {
          let tx = sv.nx;
          let ty = sv.ny;
          if (mirror) tx = -tx; // 镜像 X
          // 旋转
          const rx = tx * cos - ty * sin;
          const ry = tx * sin + ty * cos;
          return {
            ...sv,
            tx: rx,
            ty: ry
          };
        });

        // 寻找每个 cluster 节点最近的 scheme 节点 (1-to-1 匹配)
        const assignment = new Int32Array(K).fill(-1);
        const usedScheme = new Uint8Array(K).fill(0);
        let maxPointDev = 0;
        let totalDev = 0;
        let validMatch = true;

        for (let i = 0; i < K; i++) {
          const cv = clusterNormVias[i];
          let bestSchemeIdx = -1;
          let minPointDist = Infinity;

          for (let j = 0; j < K; j++) {
            if (usedScheme[j]) continue;
            const sv = transformedSchemeVias[j];
            const pDist = dist2D(cv.nx, cv.ny, sv.tx, sv.ty);
            if (pDist < minPointDist) {
              minPointDist = pDist;
              bestSchemeIdx = j;
            }
          }

          if (bestSchemeIdx === -1 || minPointDist > distTol * 2.5) {
            validMatch = false;
            break;
          }

          assignment[i] = bestSchemeIdx;
          usedScheme[bestSchemeIdx] = 1;
          totalDev += minPointDist;
          if (minPointDist > maxPointDev) maxPointDev = minPointDist;
        }

        if (validMatch) {
          if (!bestAlignment || maxPointDev < bestAlignment.maxPointDev) {
            bestAlignment = {
              angle: deg,
              mirror,
              assignment: Array.from(assignment),
              maxPointDev,
              avgPointDev: totalDev / K,
              transformedSchemeVias
            };
          }
        }
      }
    }

    // 几何不符合的情况
    if (!bestAlignment || !geometryPass) {
      return {
        status: 'DISTANCE_MISMATCH',
        statusText: '孔中心距超差',
        pass: false,
        schemeName: scheme.name,
        schemeId: scheme.id,
        matchScore: Math.max(0, 1 - avgDistDiff / 20),
        geometrySimilarity: Math.max(0, 1 - avgDistDiff / 10),
        maxDeviation: maxDistDiff,
        maxDeviationMm: maxDistDiff * MM_PER_MIL,
        message: `孔与方案【${scheme.name}】中心距不匹配：最大中心距偏差 ${roundN(maxDistDiff, 3)} mil (${roundN(maxDistDiff * MM_PER_MIL, 3)} mm)，超出允许容差 ${distTol} mil`
      };
    }

    // 3. 几何匹配成功，进一步检验每个对应过孔的 Padstack Name (每个孔的 padstack name 是否一致)
    const viaAudit = [];
    const padstackMismatches = [];

    for (let i = 0; i < K; i++) {
      const cv = cluster.vias[i];
      const schemeViaIdx = bestAlignment.assignment[i];
      const sv = scheme.vias[schemeViaIdx];

      const actualPad = (cv.padstack || '').trim();
      const expectedPad = (sv.padstack || '').trim();

      // Padstack 比较 (不区分大小写，规范化后严格比对)
      const isPadMatch = actualPad.toLowerCase() === expectedPad.toLowerCase();

      const auditItem = {
        viaIndex: i + 1,
        viaId: cv.id,
        net: cv.net,
        x: cv.x,
        y: cv.y,
        actualPadstack: actualPad,
        expectedPadstack: expectedPad,
        schemeViaId: sv.id,
        schemeRole: sv.role || `孔${sv.id}`,
        isMatch: isPadMatch
      };

      viaAudit.push(auditItem);

      if (!isPadMatch) {
        padstackMismatches.push(auditItem);
      }
    }

    // 4. 汇总判定结论
    if (padstackMismatches.length === 0) {
      // ✅ 完全匹配通过 (中心距一致 + 所有 Padstack 一致)
      return {
        status: 'MATCH_PASS',
        statusText: '完全匹配通过',
        pass: true,
        schemeName: scheme.name,
        schemeId: scheme.id,
        schemeCategory: scheme.category,
        rotationAngle: bestAlignment.angle,
        isMirrored: bestAlignment.mirror,
        maxDeviation: maxDistDiff,
        maxDeviationMm: maxDistDiff * MM_PER_MIL,
        matchScore: 1.0,
        geometrySimilarity: 1.0,
        message: `✅ 完全匹配扇出方案【${scheme.name}】(中心距最大偏差 ${roundN(maxDistDiff, 3)} mil，所有 ${K} 个孔 Padstack 完全符合)`,
        viaAudit,
        alignment: bestAlignment
      };
    } else {
      // ❌ 几何匹配但 Padstack 不符
      const failDescs = padstackMismatches.map(m => 
        `孔 #${m.viaId} 实测 Padstack 为「${m.actualPadstack}」，方案要求为「${m.expectedPadstack}」(${m.schemeRole})`
      );

      return {
        status: 'PADSTACK_MISMATCH',
        statusText: 'Padstack 不符合方案定义',
        pass: false,
        schemeName: scheme.name,
        schemeId: scheme.id,
        schemeCategory: scheme.category,
        rotationAngle: bestAlignment.angle,
        isMirrored: bestAlignment.mirror,
        maxDeviation: maxDistDiff,
        maxDeviationMm: maxDistDiff * MM_PER_MIL,
        matchScore: 0.8 - (padstackMismatches.length / K) * 0.4,
        geometrySimilarity: 1.0,
        padstackMismatches,
        message: `❌ 几何中心距匹配【${scheme.name}】，但存在 ${padstackMismatches.length} 处 Padstack 不符：${failDescs.join('；')}`,
        viaAudit,
        alignment: bestAlignment
      };
    }
  }

  /**
   * 5. 完整扇出方案检查运行器 (Full Inspection Runner)
   * 
   * @param {string|Array<Object>} inputData TXT 文本或已解析过孔数组
   * @param {FanoutLibrary} library 方案库
   * @param {Object} options 配置选项
   * @param {number} options.clusterThreshold 聚类距离阈值 (mil, 默认 78.7402 mil = 2mm)
   * @param {number} options.distanceTolerance 孔心距几何匹配容差 (mil, 默认 2.0 mil)
   * @param {boolean} options.allowRotation 允许旋转
   * @param {boolean} options.allowMirror 允许镜像
   * @returns {Object} 检查结果汇总
   */
  
  /**
   * 空间网格索引构建 (用于毫秒级高速查找周围伴随地孔)
   */
  function buildGndSpatialIndex(gndVias, cellSize = 35) {
    const grid = new Map();
    for (let i = 0; i < gndVias.length; i++) {
      const v = gndVias[i];
      const gx = Math.floor(v.x / cellSize);
      const gy = Math.floor(v.y / cellSize);
      const key = (gx << 16) ^ gy;
      let list = grid.get(key);
      if (!list) {
        list = [];
        grid.set(key, list);
      }
      list.push(v);
    }

    function findGndNear(x, y, maxDist) {
      const gx = Math.floor(x / cellSize);
      const gy = Math.floor(y / cellSize);
      const radCells = Math.ceil(maxDist / cellSize);
      const results = [];

      for (let dx = -radCells; dx <= radCells; dx++) {
        for (let dy = -radCells; dy <= radCells; dy++) {
          const key = ((gx + dx) << 16) ^ (gy + dy);
          const list = grid.get(key);
          if (!list) continue;
          for (const v of list) {
            const d = Math.hypot(v.x - x, v.y - y);
            if (d <= maxDist) {
              results.push({ via: v, dist: d });
            }
          }
        }
      }
      return results;
    }

    return { findGndNear };
  }

  /**
   * 信号孔单元构建 (支持叠孔/微孔聚合与差分对精准配对)
   * 
   * 核心逻辑：
   * 1. 优先聚合在同一信号网络上垂直层叠 (Stacked Microvias, 距离 <= 3.0 mil) 的过孔为单个信号柱 (Signal Column)
   * 2. 对差分网络 (_P / _N)，精确将同一基础网络名称的 P 柱与 N 柱配对为差分对单元 (DIFF_PAIR)
   * 3. 计算真实的差分中心距 (P-N Pitch)，避免错误拆分叠孔导致误匹配
   */
  function groupSignalUnits(activeSignalVias, maxDiffDistMil = 35.0) {
    // 1. 分离差分信号与单端信号
    const diffGroups = new Map();
    const singleVias = [];

    for (let i = 0; i < activeSignalVias.length; i++) {
      const v = activeSignalVias[i];
      const isDiff = /_[PN]$/i.test(v.net);
      if (isDiff) {
        const baseNet = v.net.replace(/_[PN]$/i, '');
        let list = diffGroups.get(baseNet);
        if (!list) {
          list = [];
          diffGroups.set(baseNet, list);
        }
        list.push(v);
      } else {
        singleVias.push(v);
      }
    }

    const units = [];

    // 2. 差分对按基准网络与空间邻域距离 (<= 35 mil) 连通分量聚类
    // 从而完整囊括该差分对的所有信号孔 (例如微孔 + 通孔共 4 个信号孔的复合扇出方案)
    for (const [baseNet, vlist] of diffGroups.entries()) {
      const n = vlist.length;
      const parent = new Int32Array(n);
      for (let i = 0; i < n; i++) parent[i] = i;

      function find(i) {
        let root = i;
        while (root !== parent[root]) root = parent[root];
        let curr = i;
        while (curr !== root) {
          let nxt = parent[curr];
          parent[curr] = root;
          curr = nxt;
        }
        return root;
      }

      function union(i, j) {
        const rootI = find(i);
        const rootJ = find(j);
        if (rootI !== rootJ) parent[rootI] = rootJ;
      }

      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const d = Math.hypot(vlist[i].x - vlist[j].x, vlist[i].y - vlist[j].y);
          if (d <= maxDiffDistMil) {
            union(i, j);
          }
        }
      }

      const compMap = new Map();
      for (let i = 0; i < n; i++) {
        const root = find(i);
        let list = compMap.get(root);
        if (!list) {
          list = [];
          compMap.set(root, list);
        }
        list.push(vlist[i]);
      }

      for (const compVias of compMap.values()) {
        const pVias = compVias.filter(v => /_P$/i.test(v.net));
        const nVias = compVias.filter(v => /_N$/i.test(v.net));
        const sumX = compVias.reduce((s, v) => s + v.x, 0);
        const sumY = compVias.reduce((s, v) => s + v.y, 0);
        const count = compVias.length;

        units.push({
          id: `sig_unit_${units.length + 1}`,
          type: 'DIFF_PAIR',
          baseNet,
          net: `${baseNet}_P/${baseNet}_N`,
          signalVias: compVias,
          pCount: pVias.length,
          nCount: nVias.length,
          centroid: { x: sumX / count, y: sumY / count }
        });
      }
    }

    // 3. 单端信号过孔划分
    for (let i = 0; i < singleVias.length; i++) {
      const v = singleVias[i];
      units.push({
        id: `sig_unit_${units.length + 1}`,
        type: 'SINGLE_SIGNAL',
        baseNet: v.net,
        net: v.net,
        signalVias: [v],
        pCount: 0,
        nCount: 0,
        centroid: { x: v.x, y: v.y }
      });
    }

    return units;
  }

  /**
   * 扇出方案核心检查运行器 (遵循两阶段严格匹配哲学)：
   * 
   * 第一阶段 (信号孔锚定与方案锁定)：
   * - 首先只匹配孔群中的信号孔 (Padstack 与相对位置关系/中心距)。
   * - 若没有任何方案能在信号孔上匹配，直接判定为【未匹配方案的孔群 / 不匹配孔群】，不作地孔分析，不强行给出修改建议。
   * - 若信号孔成功匹配方案，则锁定该方案作为该孔群的唯一基准方案。
   * 
   * 第二阶段 (伴随地孔对照分析)：
   * - 在锁定的基准方案下，逐个对照方案库中的伴随地孔坐标与 Padstack：
   *   1. Padstack 不一致的地孔：标红并统计 Padstack 错误。
   *   2. 缺失的地孔：标为缺失 (CAD 绘制黄色虚线圆)。
   *   3. 方案外多余的地孔：识别为冗余地孔 (不判错，只要方案要求的地孔均满足即判定通过)。
   */
  /**
   * 扇出方案核心检查运行器 (遵循两阶段严格匹配哲学，支持刚体旋转 0/90/180/270度与上下/左右镜像翻转)：
   * 
   * 第一阶段 (信号孔锚定与方案空间旋转/镜像对齐)：
   * - 针对信号孔 Padstack 与相对位置完全符合的所有方案及旋转/镜像变换姿态，遍历评估对应伴随地孔的匹配度。
   * - 若没有任何方案能在信号孔上匹配，直接判定为【未匹配方案的孔群 / 不匹配孔群】，不作地孔虚假分析，不强行给出修改建议。
   * 
   * 第二阶段 (伴随地孔对照分析与最佳刚体姿态判定)：
   * - 对所有符合信号孔的刚体姿态进行地孔比对：
   *   1. 只要存在一种旋转/镜像姿态使得伴随地孔完全符合（0 缺失、0 Padstack 错误），即判定为【完全匹配通过】！
   *   2. 若某姿态地孔存在缺陷，则锁定最匹配姿态，精准报告地孔 Padstack 错误或缺失孔坐标。
   */
  function runFanoutInspection(inputData, library, options = {}) {
    const startTime = Date.now();
    const allowArbitraryRotation = options.allowArbitraryRotation === true; // 任意角度姿态（默认关闭）

    // 1. 解析过孔数据
    let vias = [];
    if (typeof inputData === 'string') {
      vias = parseViaData(inputData);
    } else if (Array.isArray(inputData)) {
      vias = inputData;
    }

    if (vias.length === 0) {
      return {
        success: false,
        error: '未解析到任何过孔数据，请检查输入格式。',
        vias: [],
        clusters: [],
        summary: null
      };
    }

    const distTol = options.distanceTolerance != null ? options.distanceTolerance : 2.0;
    const allowRotation = options.allowRotation !== false;
    const allowMirror = options.allowMirror !== false;

    // 2. 筛选信号孔 (优先筛选有 Connections 信息的信号孔，兜底全量信号孔)
    const gndVias = vias.filter(v => v.net && v.net.toUpperCase().includes('GND'));
    const allSignalVias = vias.filter(v => !v.net || !v.net.toUpperCase().includes('GND'));
    let activeSignalVias = allSignalVias.filter(v => v.hasConnections);

    if (activeSignalVias.length === 0) {
      activeSignalVias = allSignalVias;
    }

    // 3. 构建伴随地孔空间网格索引
    const gndIndex = buildGndSpatialIndex(gndVias, 35);

    // 4. 构建信号孔扇出单元 (差分对/单端信号孔，已自动聚合垂直层叠叠孔)
    const signalUnits = groupSignalUnits(activeSignalVias, 35.0);

    let passCount = 0;
    let exactPassCount = 0;
    let subsetPassCount = 0;
    let padstackFailCount = 0;
    let topologyFailCount = 0;
    let noMatchCount = 0;
    const schemeCoverage = {};
    const clusterUnits = [];

    // 5. 逐个信号单元执行多姿态两阶段严格检查
    for (let uIdx = 0; uIdx < signalUnits.length; uIdx++) {
      const unit = signalUnits[uIdx];
      const unitSigVias = unit.signalVias;

      // 获取周围 80 mil 范围内的伴随地孔
      const nearbyGndItems = gndIndex.findGndNear(unit.centroid.x, unit.centroid.y, 80.0);
      const nearbyGnd = nearbyGndItems.map(item => item.via);
      const candidateVias = [...unit.signalVias, ...nearbyGnd];

      // 计算孔群包围盒
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      candidateVias.forEach(v => {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      });
      const spanX = maxX - minX;
      const spanY = maxY - minY;
      const maxSpan = Math.hypot(spanX, spanY);

      // 第一阶段与第二阶段综合评估：搜索所有在【信号孔 Padstack 与相对位置】上匹配的方案及旋转/镜像姿态
      const candidateEvaluations = [];

      for (const scheme of library.schemes) {
        if (!scheme.vias || scheme.vias.length === 0) continue;

        const schemeSigVias = scheme.vias.filter(v => v.net && !v.net.toUpperCase().includes('GND'));
        const schemeGndVias = scheme.vias.filter(v => !v.net || v.net.toUpperCase().includes('GND') || (v.padstack && v.padstack.toUpperCase().includes('GND')));

        // 信号孔数量必须一致
        if (schemeSigVias.length !== unitSigVias.length) continue;

        const angles = candidateRotations(unitSigVias, schemeSigVias, distTol, allowRotation, allowArbitraryRotation);
        const mirrors = allowMirror ? [false, true] : [false];
        const s0 = schemeSigVias[0];

        for (const mirror of mirrors) {
          for (const deg of angles) {
            const rad = (deg * Math.PI) / 180;
            const cosA = Math.cos(rad);
            const sinA = Math.sin(rad);

            // 变换方案信号孔相对坐标
            const relSig = schemeSigVias.map(sv => {
              let dx = sv.x - s0.x;
              let dy = sv.y - s0.y;
              if (mirror) dx = -dx;
              const rx = dx * cosA - dy * sinA;
              const ry = dx * sinA + dy * cosA;
              return { sv, relX: rx, relY: ry };
            });

            // 尝试锚定到单元内的每个候选信号孔 u0
            for (const u0 of unitSigVias) {
              if ((u0.padstack || '').trim().toLowerCase() !== (s0.padstack || '').trim().toLowerCase()) {
                continue;
              }

              const usedSigIdx = new Set();
              let allSigMatched = true;

              for (const item of relSig) {
                const expX = u0.x + item.relX;
                const expY = u0.y + item.relY;

                let foundIdx = -1;
                for (let k = 0; k < unitSigVias.length; k++) {
                  if (usedSigIdx.has(k)) continue;
                  const uv = unitSigVias[k];
                  if (Math.hypot(uv.x - expX, uv.y - expY) <= distTol) {
                    if ((uv.padstack || '').trim().toLowerCase() === (item.sv.padstack || '').trim().toLowerCase()) {
                      foundIdx = k;
                      break;
                    }
                  }
                }

                if (foundIdx !== -1) {
                  usedSigIdx.add(foundIdx);
                } else {
                  allSigMatched = false;
                  break;
                }
              }

              if (allSigMatched && usedSigIdx.size === unitSigVias.length) {
                // 信号孔完全匹配！立即对当前刚体姿态进行地孔比对
                const usedGndIndices = new Set();
                const padMismatchList = [];
                const missingVias = [];
                let matchedGndCount = 0;
                const audit = [];

                for (let j = 0; j < schemeGndVias.length; j++) {
                  const sv = schemeGndVias[j];
                  let dx = sv.x - s0.x;
                  let dy = sv.y - s0.y;
                  if (mirror) dx = -dx;
                  const rx = dx * cosA - dy * sinA;
                  const ry = dx * sinA + dy * cosA;
                  const expX = u0.x + rx;
                  const expY = u0.y + ry;

                  let bestGndIdx = -1;
                  let minDist = distTol;

                  for (let k = 0; k < nearbyGnd.length; k++) {
                    if (usedGndIndices.has(k)) continue;
                    const gv = nearbyGnd[k];
                    const d = Math.hypot(gv.x - expX, gv.y - expY);
                    if (d <= minDist) {
                      if ((gv.padstack || '').trim().toLowerCase() === (sv.padstack || '').trim().toLowerCase()) {
                        minDist = d;
                        bestGndIdx = k;
                        break;
                      } else if (bestGndIdx === -1 || d < minDist) {
                        minDist = d;
                        bestGndIdx = k;
                      }
                    }
                  }

                  if (bestGndIdx !== -1) {
                    usedGndIndices.add(bestGndIdx);
                    const gv = nearbyGnd[bestGndIdx];
                    matchedGndCount++;

                    const isPadMatch = (gv.padstack || '').trim().toLowerCase() === (sv.padstack || '').trim().toLowerCase();
                    if (!isPadMatch) {
                      padMismatchList.push({
                        viaId: gv.id,
                        net: gv.net,
                        actualPadstack: gv.padstack,
                        expectedPadstack: sv.padstack,
                        role: sv.role || (`伴随地孔${sv.id}`)
                      });
                    }

                    audit.push({
                      viaIndex: j + 1,
                      viaId: gv.id,
                      net: gv.net,
                      x: gv.x,
                      y: gv.y,
                      actualPadstack: gv.padstack,
                      expectedPadstack: sv.padstack,
                      role: sv.role || (`伴随地孔${sv.id}`),
                      isMatch: isPadMatch,
                      deviation: minDist
                    });
                  } else {
                    missingVias.push({
                      expectedX: expX,
                      expectedY: expY,
                      expectedPadstack: sv.padstack,
                      role: sv.role || (`伴随地孔${sv.id}`),
                      net: sv.net || 'GND'
                    });
                  }
                }

                const isPass = (padMismatchList.length === 0 && missingVias.length === 0);
                const redundantGndCount = nearbyGnd.length - matchedGndCount;

                candidateEvaluations.push({
                  scheme,
                  schemeName: scheme.name,
                  schemeId: scheme.id,
                  angle: deg,
                  mirror,
                  pass: isPass,
                  matchedGndCount,
                  schemeGndCount: schemeGndVias.length,
                  redundantGndCount,
                  padMismatchList,
                  missingVias,
                  audit
                });

                if (isPass) break; // 当前方案该姿态完全匹配通过
              }
            }
          }
        }
      }

      // 情况 A: 没有任何方案在信号孔上通过比对 -> 判定为【不匹配孔群】，不作地孔虚假分析
      if (candidateEvaluations.length === 0) {
        noMatchCount++;
        const matchRes = {
          status: 'NO_MATCH_TOPOLOGY',
          statusText: '不匹配孔群 (未匹配方案)',
          pass: false,
          isSubsetMatch: false,
          schemeName: '未匹配方案',
          schemeId: null,
          maxDeviation: 0,
          maxDeviationMm: 0,
          rotationAngle: 0,
          isMirrored: false,
          message: `该孔群中信号孔 Padstack 或相对中心距未能与方案库中任何方案匹配`,
          advice: '信号孔未匹配方案库模板，无需进行伴随地孔分析。',
          padMismatchList: [],
          missingVias: [],
          viaAudit: []
        };

        clusterUnits.push({
          id: `sig_unit_${uIdx + 1}`,
          vias: candidateVias,
          viaCount: candidateVias.length,
          signalVias: unit.signalVias,
          signalNet: unit.net,
          centroid: unit.centroid,
          bbox: { minX, maxX, minY, maxY, spanX, spanY, maxSpan },
          matchResult: matchRes
        });
        continue;
      }

      // 情况 B: 优先寻找是否存在完全匹配通过 (0 Padstack 错误、0 缺失孔) 的旋转/镜像姿态
      let bestEval = candidateEvaluations.find(e => e.pass);

      if (!bestEval) {
        // 若没有完全通过，按地孔匹配数最高、缺陷数最少排序选择最佳姿态
        candidateEvaluations.sort((a, b) => {
          if (b.matchedGndCount !== a.matchedGndCount) return b.matchedGndCount - a.matchedGndCount;
          const defectsA = a.padMismatchList.length + a.missingVias.length;
          const defectsB = b.padMismatchList.length + b.missingVias.length;
          return defectsA - defectsB;
        });
        bestEval = candidateEvaluations[0];
      }

      const s = bestEval.scheme;
      const isPass = bestEval.pass;

      if (isPass) {
        passCount++;
        if (bestEval.redundantGndCount > 0) subsetPassCount++;
        else exactPassCount++;
        schemeCoverage[s.name] = (schemeCoverage[s.name] || 0) + 1;

        const redundantStr = bestEval.redundantGndCount > 0 ? ` (含 ${bestEval.redundantGndCount} 个冗余地孔)` : '';
        const rotStr = bestEval.angle !== 0 ? ` [旋转 ${bestEval.angle}°]` : '';
        const mirStr = bestEval.mirror ? ` [镜像翻转]` : '';

        const matchRes = {
          status: 'MATCH_PASS',
          statusText: bestEval.redundantGndCount > 0 ? `匹配通过 (含${bestEval.redundantGndCount}冗余孔)` : '完全匹配通过',
          pass: true,
          isSubsetMatch: bestEval.redundantGndCount > 0,
          schemeName: s.name,
          schemeId: s.id,
          matchedViaCount: unitSigVias.length + bestEval.matchedGndCount,
          redundantViaCount: bestEval.redundantGndCount,
          maxDeviation: 0,
          maxDeviationMm: 0,
          rotationAngle: bestEval.angle,
          isMirrored: bestEval.mirror,
          message: `✅ 对照方案【${s.name}】匹配通过${rotStr}${mirStr} (信号网络: ${unit.net}${redundantStr}，Padstack 与地孔完全符合)`,
          advice: '信号孔与伴随地孔完全符合方案规范，无需调整。',
          padMismatchList: [],
          missingVias: [],
          viaAudit: bestEval.audit
        };

        clusterUnits.push({
          id: `sig_unit_${uIdx + 1}`,
          vias: candidateVias,
          viaCount: candidateVias.length,
          signalVias: unit.signalVias,
          signalNet: unit.net,
          centroid: unit.centroid,
          bbox: { minX, maxX, minY, maxY, spanX, spanY, maxSpan },
          matchResult: matchRes
        });
      } else {
        let adviceText = '';
        let reasonText = '';
        let status = 'DISTANCE_MISMATCH';
        let statusText = '伴随地孔存在异常';

        const padMismatchList = bestEval.padMismatchList;
        const missingVias = bestEval.missingVias;

        if (padMismatchList.length > 0 && missingVias.length === 0) {
          padstackFailCount++;
          status = 'PADSTACK_MISMATCH';
          statusText = '地孔Padstack不符';
          const padAdv = padMismatchList.map(p => `将地孔 #${p.viaId} Padstack 由「${p.actualPadstack}」调整为「${p.expectedPadstack}」`).join('；');
          reasonText = `信号孔已锁定方案【${s.name}】，但存在 ${padMismatchList.length} 处伴随地孔 Padstack 不符`;
          adviceText = `【地孔Padstack调整建议】: ${padAdv}。`;
        } else if (missingVias.length > 0) {
          topologyFailCount++;
          status = 'DISTANCE_MISMATCH';
          statusText = '伴随地孔缺失/位置偏差';
          const missAdv = missingVias.slice(0, 3).map(m => `在坐标 [${m.expectedX.toFixed(1)}, ${m.expectedY.toFixed(1)}] 补齐 1 个伴随地孔 (${m.expectedPadstack})`).join('；');
          const padAdv = padMismatchList.length > 0 ? `；同时修正地孔 #${padMismatchList[0].viaId} Padstack 为「${padMismatchList[0].expectedPadstack}」` : '';
          reasonText = `信号孔已锁定方案【${s.name}】，但缺少 ${missingVias.length} 个伴随地孔`;
          adviceText = `【补地孔建议】: ${missAdv}${padAdv}。`;
        }

        const matchRes = {
          status,
          statusText,
          pass: false,
          isSubsetMatch: false,
          schemeName: s.name,
          schemeId: s.id,
          maxDeviation: 0,
          maxDeviationMm: 0,
          rotationAngle: bestEval.angle,
          isMirrored: bestEval.mirror,
          message: reasonText,
          advice: adviceText,
          padMismatchList,
          missingVias,
          viaAudit: bestEval.audit
        };

        clusterUnits.push({
          id: `sig_unit_${uIdx + 1}`,
          vias: candidateVias,
          viaCount: candidateVias.length,
          signalVias: unit.signalVias,
          signalNet: unit.net,
          centroid: unit.centroid,
          bbox: { minX, maxX, minY, maxY, spanX, spanY, maxSpan },
          matchResult: matchRes
        });
      }
    }

    const elapsedMs = Date.now() - startTime;
    const failCount = padstackFailCount + topologyFailCount + noMatchCount;
    const passRate = signalUnits.length > 0 ? (passCount / signalUnits.length) * 100 : 0;

    const summary = {
      totalVias: vias.length,
      totalSignalVias: activeSignalVias.length,
      totalClusters: signalUnits.length,
      passCount,
      exactPassCount,
      subsetPassCount,
      failCount,
      passRate: roundN(passRate, 1),
      padstackFailCount,
      distFailCount: topologyFailCount,
      noMatchCount,
      schemeCoverage,
      elapsedMs,
      clusterThreshold: 80.0,
      clusterThresholdMm: 80.0 * MM_PER_MIL
    };

    return {
      success: true,
      vias,
      clusters: clusterUnits,
      summary
    };
  }

  function parseAndRepairFanoutJson(input) {
    if (!input) return { success: false, error: '输入内容为空' };
    
    const text = (typeof input === 'string' ? input : (input.text || String(input))).replace(/^\uFEFF/, '').trim();
    if (!text) return { success: false, error: '输入内容为空' };

    // 1. First attempt: standard JSON.parse
    try {
      const parsed = JSON.parse(text);
      let schemes = [];
      let meta = {};
      if (Array.isArray(parsed)) {
        schemes = parsed;
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.schemes)) schemes = parsed.schemes;
        else if (Array.isArray(parsed.fanoutSchemes)) schemes = parsed.fanoutSchemes;
        else if (Array.isArray(parsed.data)) schemes = parsed.data;
        else if (parsed.vias && Array.isArray(parsed.vias)) schemes = [parsed];
        meta = parsed;
      }
      if (schemes.length > 0) {
        return { success: true, schemes, meta, recovered: false, message: `成功解析 ${schemes.length} 套扇出方案` };
      }
    } catch (err) {}

    // 2. Auto-repair for truncated / interrupted JSON
    let trimmed = text;

    // Repair strategy 1: Incomplete via properties at tail -> strip incomplete via and close
    const candidate1 = trimmed.replace(/,\s*\{[^{}]*"id":\s*\d+[^{}]*$/, '') + '\n    ]\n  }\n]';
    try {
      const p1 = JSON.parse(candidate1);
      const s1 = Array.isArray(p1) ? p1 : (p1.schemes || p1.fanoutSchemes);
      if (Array.isArray(s1) && s1.length > 0) {
        return {
          success: true,
          schemes: s1,
          recovered: true,
          message: `检测到 JSON 文件末尾截断，已自动容错修复并成功提取 ${s1.length} 套扇出方案！`
        };
      }
    } catch (e1) {}

    // Repair strategy 2: Try completing the last via if it only needs closing fields
    const candidate2 = trimmed.replace(/"role"\s*:\s*"[^"]*$/, '"role": "伴随地孔",\n        "drill": 0\n      }\n    ]\n  }\n]');
    try {
      const p2 = JSON.parse(candidate2);
      const s2 = Array.isArray(p2) ? p2 : (p2.schemes || p2.fanoutSchemes);
      if (Array.isArray(s2) && s2.length > 0) {
        return {
          success: true,
          schemes: s2,
          recovered: true,
          message: `检测到 JSON 文件末尾截断，已自动补全闭合并成功提取全部 ${s2.length} 套扇出方案！`
        };
      }
    } catch (e2) {}

    // Repair strategy 3: Rollback to the last completely closed scheme object '}'
    let endIdx = trimmed.length;
    while (endIdx > 0) {
      const lastObjClose = trimmed.lastIndexOf('}', endIdx - 1);
      if (lastObjClose === -1) break;

      const candidate3 = trimmed.slice(0, lastObjClose + 1).replace(/,\s*$/, '') + '\n]';
      try {
        const p3 = JSON.parse(candidate3);
        if (Array.isArray(p3) && p3.length > 0) {
          return {
            success: true,
            schemes: p3,
            recovered: true,
            message: `检测到 JSON 文件末尾截断，已自动截取前 ${p3.length} 套完整扇出方案！`
          };
        }
      } catch (e3) {
        endIdx = lastObjClose;
      }
    }

    // Repair strategy 4: Regex-based object extraction
    const schemeMatches = [];
    const schemeRegex = /\{\s*"id"\s*:\s*"scheme_[^"]+"[\s\S]*?"vias"\s*:\s*\[[\s\S]*?\]\s*\}/g;
    let m;
    while ((m = schemeRegex.exec(text)) !== null) {
      try {
        const singleScheme = JSON.parse(m[0]);
        if (singleScheme && singleScheme.id && Array.isArray(singleScheme.vias)) {
          schemeMatches.push(singleScheme);
        }
      } catch (e) {}
    }
    if (schemeMatches.length > 0) {
      return {
        success: true,
        schemes: schemeMatches,
        recovered: true,
        message: `检测到复杂格式异常，已通过模式扫描成功提取 ${schemeMatches.length} 套扇出方案！`
      };
    }

    return { success: false, error: '未能从文件中识别出有效的扇出方案 JSON 数据' };
  }

  /**
   * 解析包含多个扇出方案的多块 TXT 文本（每个方案之间使用 ~~~end~~~ 或 ~End~ 分界）
   * @param {string} text 
   * @param {number} existingCount 已有方案计数，用于命名序号
   * @returns {Array<Object>} parsed schemes
   */
  function parseMultiSchemeTxt(text, existingCount = 0) {
    if (!text || typeof text !== 'string') return [];

    const clean = String(text).replace(/^\uFEFF/, '').trim();
    if (!clean) return [];

    // 分界符规则：必须包含 end（如 ~~~end~~~, ~End~, ~~~ End ~~~, ===end===, ---end--- 等，不匹配纯 ~~~）
    const DELIM_REGEX = /(?:^|\r?\n)\s*[~=-]*\s*end\s*[~=-]*\s*(?:\r?\n|$)/i;

    let rawBlocks = clean.split(DELIM_REGEX).map(b => b.trim()).filter(Boolean);

    // 如果未找到 ~~~end~~~ 分界符，检查是否包含多个方案标题或 Item 1 块
    if (rawBlocks.length <= 1) {
      const schemeHeaderSplit = clean.split(/(?:^|\r?\n)(?=(?:[#=~-]*\s*(?:方案|Scheme|扇出方案)\s*[\d\w_]+|Item\s+1\b\s*<(?:\s*Via\s*)>))/i).map(b => b.trim()).filter(Boolean);
      if (schemeHeaderSplit.length > 1) {
        rawBlocks = schemeHeaderSplit;
      }
    }

    const results = [];

    rawBlocks.forEach((block, blockIdx) => {
      const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) return;

      let schemeName = '';
      let category = '通用扇出';

      // 提取标题：检查前 1~5 行非 Item/Origin/Delimiter 的描述文本
      for (let i = 0; i < Math.min(5, lines.length); i++) {
        const line = lines[i];
        if (/^(?:Item\s+\d+|Origin|Padstack|Net|Circle|Seg|Arc)/i.test(line)) break;
        if (/^(?:[~=-]{2,}|\s*end\s*|[~=-]*\s*(?:end|End|END)\s*[~=-]*)$/i.test(line)) continue;

        const cleanLine = line.replace(/^[#=~*\-—_0-9.、\s]+/, '').replace(/[#=~*\-—_]+$/, '').trim();
        if (cleanLine.length >= 2 && cleanLine.length <= 50 && !/^(?:end|End|END)$/i.test(cleanLine)) {
          schemeName = cleanLine;
          break;
        }
      }

      if (!schemeName) {
        schemeName = `扇出方案_${existingCount + results.length + 1}`;
      }

      // 解析过孔
      const vias = [];
      const itemBlocks = block.split(/(?=Item\s+\d+)/i).filter(s => s.trim());

      if (itemBlocks.length > 0 && /Item\s+\d+/i.test(block)) {
        itemBlocks.forEach((ib, vIdx) => {
          const mOrigin = ib.match(/(?:Origin-xy|Location|xy):\s*\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]/i);
          const mPad = ib.match(/Padstack\s+Name:\s*([^\r\n]+)/i);
          const mNet = ib.match(/Net:\s*([^\r\n]+)/i);
          const mDrill = ib.match(/Circle\s+Drill:\s*([\d\.\-]+)/i);

          if (mOrigin) {
            const rawX = parseFloat(mOrigin[1]) || 0;
            const rawY = parseFloat(mOrigin[2]) || 0;
            const padstack = mPad ? mPad[1].trim() : 'UNKNOWN_PADSTACK';
            const net = mNet ? mNet[1].trim() : '';
            const drill = mDrill ? parseFloat(mDrill[1]) : 0;

            const isGnd = net.toUpperCase().includes('GND') || padstack.toUpperCase().includes('GND');
            const role = isGnd ? '伴随地孔' : '信号孔';
            const type = isGnd ? 'gnd' : 'signal';

            vias.push({
              id: vIdx + 1,
              rawX,
              rawY,
              x: rawX,
              y: rawY,
              padstack,
              net: net || (isGnd ? 'GND' : 'SIGNAL'),
              role,
              type,
              drill
            });
          }
        });
      } else {
        // 兼容坐标表格行：X, Y, Padstack, Net
        lines.forEach((line, vIdx) => {
          if (/^(?:[~=-]{2,}|\s*end\s*|[~=-]*\s*(?:end|End|END)\s*[~=-]*)$/i.test(line)) return;
          const parts = line.split(/[,\t;\s]+/).map(s => s.trim()).filter(Boolean);
          if (parts.length >= 2) {
            const x = parseFloat(parts[0]);
            const y = parseFloat(parts[1]);
            if (!isNaN(x) && !isNaN(y)) {
              const padstack = parts[2] || 'VIA_PADSTACK';
              const net = parts[3] || 'GND';
              const isGnd = net.toUpperCase().includes('GND') || padstack.toUpperCase().includes('GND');
              vias.push({
                id: vIdx + 1,
                rawX: x,
                rawY: y,
                x,
                y,
                padstack,
                net,
                role: isGnd ? '伴随地孔' : '信号孔',
                type: isGnd ? 'gnd' : 'signal',
                drill: 0
              });
            }
          }
        });
      }

      if (vias.length >= 1) {
        // 归一化相对坐标（以第一个信号孔或基准孔为原点 [0, 0]）
        const maxCoord = Math.max(...vias.map(v => Math.max(Math.abs(v.rawX), Math.abs(v.rawY))));
        if (maxCoord > 200) {
          const base = vias.find(v => v.type === 'signal') || vias[0];
          const bx = base.rawX;
          const by = base.rawY;
          vias.forEach(v => {
            v.x = Math.round((v.rawX - bx) * 1000) / 1000;
            v.y = Math.round((v.rawY - by) * 1000) / 1000;
          });
        }

        results.push({
          id: `scheme_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${results.length + 1}`,
          name: schemeName,
          category: category,
          tag: category,
          description: `从批量文本导入，包含 ${vias.length} 个过孔`,
          unit: 'mil',
          vias: vias
        });
      }
    });

    return results;
  }

  // 暴露命名空间与模块导出
  const FanoutChecker = {
    parseMultiSchemeTxt,
    parseAndRepairFanoutJson,
    MM_PER_MIL,
    MIL_PER_MM,
    dist2D,
    roundN,
    parseViaData,
    clusterVias,
    FanoutScheme,
    FanoutLibrary,
    getStandardPresetSchemes,
    matchClusterToLibrary,
    matchClusterSubsetsIterative,
    buildGndSpatialIndex,
    groupSignalUnits,
    compareClusterWithScheme,
    candidateRotations,
    runFanoutInspection
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FanoutChecker;
  } else {
    global.FanoutChecker = FanoutChecker;
  }

})(typeof window !== 'undefined' ? window : this);
