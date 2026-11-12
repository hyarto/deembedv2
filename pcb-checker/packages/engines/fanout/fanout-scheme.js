/* ============================================================================
 * fanout-scheme.js —— 扇出方案模型、方案库、预设模板、多方案 TXT 解析与对称自动命名
 * ========================================================================== */
(function (root, factory) {
  var parser = (typeof module === "object" && module.exports) ? require("./fanout-parser.js") : root.FanoutChecker;
  var palette = (typeof module === "object" && module.exports) ? require("./fanout-palette.js") : root.FanoutChecker;
  var api = factory(parser, palette);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FanoutChecker = Object.assign(root.FanoutChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (parser, palette) {
  "use strict";
  var MM_PER_MIL = parser.MM_PER_MIL;
  var MIL_PER_MM = parser.MIL_PER_MM;
  var dist2D = parser.dist2D;
  var roundN = parser.roundN;
  var parseViaData = parser.parseViaData;
  var syncLibraryPadstackColors = palette.syncLibraryPadstackColors;
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
      syncLibraryPadstackColors(this.schemes);
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

    renameScheme(schemeId, newName) {
      const cleanName = String(newName || '').trim();
      if (!cleanName) return null;
      const sc = this.getScheme(schemeId);
      if (!sc) return null;
      sc.name = cleanName;
      return sc;
    }

    getScheme(schemeId) {
      return this.schemes.find(s => s.id === schemeId || s.name === schemeId) || null;
    }

    clear() {
      this.schemes = [];
      resetPadstackColorRegistry();
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

  function classifyGroundSymmetry(vias = [], toleranceMil = 0.25) {
    const isGnd = v => v && (v.type === 'gnd' || v.role === '伴随地孔' || /GND/i.test(String(v.net || '') + ' ' + String(v.padstack || '')));
    const gnd = (vias || []).filter(isGnd).map(v => ({
      x: Number(v.rawX ?? v.x), y: Number(v.rawY ?? v.y),
      pad: String(v.padstack || v.padstackName || 'GND')
    })).filter(v => Number.isFinite(v.x) && Number.isFinite(v.y));
    if (gnd.length < 3) return '未判定';

    const signals = (vias || []).filter(v => v && !isGnd(v)).map(v => ({ x: Number(v.rawX ?? v.x), y: Number(v.rawY ?? v.y) })).filter(v => Number.isFinite(v.x) && Number.isFinite(v.y));
    const center = signals.length
      ? { x: signals.reduce((sum, p) => sum + p.x, 0) / signals.length, y: signals.reduce((sum, p) => sum + p.y, 0) / signals.length }
      : { x: gnd.reduce((sum, p) => sum + p.x, 0) / gnd.length, y: gnd.reduce((sum, p) => sum + p.y, 0) / gnd.length };
    const points = gnd.map(p => ({ ...p, x: p.x - center.x, y: p.y - center.y }));

    const preservesLabels = transform => {
      const unused = new Set(points.map((_, i) => i));
      for (const p of points) {
        const q = transform(p);
        let bestIndex = -1, bestDistance = Infinity;
        for (const j of unused) {
          if (points[j].pad !== p.pad) continue;
          const d = Math.hypot(q.x - points[j].x, q.y - points[j].y);
          if (d < bestDistance) { bestDistance = d; bestIndex = j; }
        }
        if (bestIndex < 0 || bestDistance > toleranceMil) return false;
        unused.delete(bestIndex);
      }
      return unused.size === 0;
    };

    // 中心对称：绕信号孔群中心旋转 180° 后，各种 GND Padstack 均须回到同类孔位。
    const central = preservesLabels(p => ({ x: -p.x, y: -p.y }));
    // 轴对称：从同 Padstack 孔对的中点生成候选轴，并验证整组带 Padstack 标签的孔位。
    const angles = new Set([0, Math.PI / 2]);
    for (let i = 0; i < points.length; i++) for (let j = i; j < points.length; j++) {
      if (points[i].pad !== points[j].pad) continue;
      const sx = points[i].x + points[j].x, sy = points[i].y + points[j].y;
      if (Math.hypot(sx, sy) < 1e-6) continue;
      let angle = Math.atan2(sy, sx) % Math.PI;
      if (angle < 0) angle += Math.PI;
      angles.add(Math.round(angle * 10000) / 10000);
    }
    let axial = false;
    for (const angle of angles) {
      const ux = Math.cos(angle), uy = Math.sin(angle);
      if (preservesLabels(p => {
        const dot = p.x * ux + p.y * uy;
        return { x: 2 * dot * ux - p.x, y: 2 * dot * uy - p.y };
      })) { axial = true; break; }
    }
    if (axial && central) return '轴+中心对称';
    if (axial) return '轴对称';
    if (central) return '中心对称';
    return '非对称';
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
          const mDefined = ib.match(/Padstack\s+Defined\s+from\s+([^\r\n]+)/i);

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
              definedFrom: mDefined ? mDefined[1].trim() : '',
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

        // 标题缺失时按孔群的电气/几何特征命名：类型、P/N 对数、差分孔距、信号连接层。
        // 「Total N Items」是 EDA 的计数，不是方案名。
        if (/^扇出方案_\d+$/.test(schemeName) || /^Total\s+\d+\s+Items?$/i.test(schemeName)) {
          const signals = vias.filter(v => v.type === 'signal');
          const familyCounts = new Map();
          vias.forEach(v => {
            const family = (String(v.padstack || '').match(/^(BGA|SMA|PTH)/i)?.[1] || '通用').toUpperCase();
            familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
          });
          const family = [...familyCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '通用';
          const pairDistances = [];
          const nets = [...new Set(signals.map(v => String(v.net || '').trim()))];
          nets.filter(net => /_P$/i.test(net)).forEach(netP => {
            const netN = netP.replace(/_P$/i, '_N');
            const pVias = signals.filter(v => v.net === netP);
            const nVias = signals.filter(v => v.net === netN);
            if (!nVias.length) return;
            pVias.forEach(pv => {
              const nearest = nVias.reduce((best, nv) => {
                const d = Math.hypot(pv.rawX - nv.rawX, pv.rawY - nv.rawY);
                return d < best ? d : best;
              }, Infinity);
              if (Number.isFinite(nearest) && nearest > 0.01) pairDistances.push(nearest);
            });
          });
          const pitchCounts = new Map();
          pairDistances.forEach(d => {
            // EDA 坐标按 mil 解析；名称统一将 P/N 中心距转换为 mm，保留两位小数。
            const rounded = Math.round((d / 39.37007874) * 100) / 100;
            pitchCounts.set(rounded, (pitchCounts.get(rounded) || 0) + 1);
          });
          const pitchValues = [...pitchCounts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0] - b[0])
            .slice(0, 2).map(x => x[0]).sort((a, b) => a - b);
          const pitchLabel = pitchValues.length
            ? `P${pitchValues.map(d => d.toFixed(2).replace(/0+$/, '').replace(/\\.$/, '')).join('/')}mm`
            : '';
          const hasPN = nets.some(net => /_P$/i.test(net)) && nets.some(net => /_N$/i.test(net));
          const pairCount = hasPN ? Math.floor(signals.length / 2) : 0;
          const pairLabel = pairCount ? `${pairCount}对` : `${signals.length}信号`;
          const layerEnds = [];
          signals.forEach(v => {
            const m = String(v.definedFrom || '').match(/^\s*(.*?)\s+to\s+(.*?)\s*$/i);
            if (m) layerEnds.push(m[1].trim(), m[2].trim());
          });
          const layerTokens = [...new Set(layerEnds.map(name => {
            if (/^(?:top|上层)$/i.test(name)) return { label: 'Top', rank: 0 };
            if (/^(?:bottom|bot|底层)$/i.test(name)) return { label: 'Bot', rank: 9999 };
            const m = name.match(/(\d+)/);
            return m ? { label: `L${Number(m[1])}`, rank: Number(m[1]) } : null;
          }).filter(Boolean).map(x => JSON.stringify(x)))].map(x => JSON.parse(x)).sort((a, b) => a.rank - b.rank);
          const layerLabel = layerTokens.length > 1
            ? `${layerTokens[0].label}-${layerTokens[layerTokens.length - 1].label}`
            : layerTokens[0]?.label || '';
          const groundSymmetry = classifyGroundSymmetry(vias);
          const baseName = [family, pairLabel, pitchLabel, layerLabel, groundSymmetry !== '未判定' ? `GND${groundSymmetry}` : ''].filter(Boolean).join('_');
          const sameBase = results.filter(r => r.name === baseName || r.name.startsWith(baseName + '_')).length;
          schemeName = sameBase ? `${baseName}_${String(sameBase + 1).padStart(2, '0')}` : baseName;
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

  /**
   * 判定过孔是否为信号孔 (兼容 FanoutScheme 与 unified 工作台数据结构)
   */
  function isSignalVia(v) {
    if (!v) return false;
    const type = String(v.type || '').toLowerCase();
    if (type === 'gnd') return false;
    if (type === 'signal' || type === 'sig') return true;

    const net = String(v.net || '').toUpperCase();
    const pad = String(v.padstack || '').toUpperCase();
    const role = String(v.role || '');
    const roleUp = role.toUpperCase();

    if (net.includes('GND') || pad.includes('GND') || roleUp.includes('GND') || role.includes('地孔')) {
      return false;
    }
    if (
      (net && net !== 'GND') ||
      roleUp.includes('SIG') ||
      role.includes('信号') ||
      role.includes('差分') ||
      pad.includes('SMA') ||
      pad.includes('SIG') ||
      pad.includes('DIFF') ||
      pad.includes('3510')
    ) {
      return true;
    }
    return false;
  }

  const DEFAULT_SCHEME_NAME_KEYWORDS = [
    'BGA', 'SMA', 'TZ',
    'top', 'bottom',
    'L2', 'L3', 'L4', 'L11', 'L12', 'L13',
    'diff', 'single',
    '05pitch', '06pitch', '07pitch', '08pitch'
  ];

  function buildSchemeNameFromKeywords(tokens) {
    if (!Array.isArray(tokens)) return '';
    return tokens.map(t => String(t == null ? '' : t).trim()).filter(Boolean).join('_');
  }
  return {
    FanoutScheme: FanoutScheme,
    FanoutLibrary: FanoutLibrary,
    getStandardPresetSchemes: getStandardPresetSchemes,
    parseAndRepairFanoutJson: parseAndRepairFanoutJson,
    classifyGroundSymmetry: classifyGroundSymmetry,
    parseMultiSchemeTxt: parseMultiSchemeTxt,
    isSignalVia: isSignalVia,
    DEFAULT_SCHEME_NAME_KEYWORDS: DEFAULT_SCHEME_NAME_KEYWORDS,
    buildSchemeNameFromKeywords: buildSchemeNameFromKeywords
  };
});
