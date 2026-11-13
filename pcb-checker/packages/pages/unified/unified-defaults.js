/* ============================================================================
 * unified-defaults.js —— 默认约束集、走线规则归一化与扇出预设方案
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
function getDefaultConstraintSets() {
  const sets = [
    // 1. BGA Sets
    {
      kind: 'BGA', title: 'BGA-L19', fanLayer: 19, source: '03Antipad_via_routekeepout_rule.txt', txtHead: 'BGA 封装方案 / L19层扇出',
      constraints: [
        { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1:'17', L2:'17', L3:'17', L4:'17', L5:'17', L6:'17', L7:'17', L8:'17', L9:'17', L10:'17', L11:'17', L12:'17', L13:'17', L14:'17', L15:'17', L16:'17', L17:'17', L18:'17', L19:'5' }, sources: { L1:'L18及以上17mil', L19:'出线层5mil' } },
        { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L19:'3.46' }, sources: { L19:'扇出走线层焊盘半径 3.46 mil' } }
      ]
    },
    {
      kind: 'BGA', title: 'BGA-L17', fanLayer: 17, source: '03Antipad_via_routekeepout_rule.txt', txtHead: 'BGA 封装方案 / L17层扇出',
      constraints: [
        { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1:'17', L2:'17', L3:'17', L4:'17', L5:'17', L6:'17', L7:'17', L8:'17', L9:'17', L10:'17', L11:'17', L12:'17', L13:'17', L14:'17', L15:'17', L16:'17', L17:'5' }, sources: { L1:'L16及以上17mil', L17:'出线层5mil' } },
        { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L17:'3.46' }, sources: { L17:'扇出走线层焊盘半径 3.46 mil' } }
      ]
    },
    {
      kind: 'BGA', title: 'BGA-L15', fanLayer: 15, source: '03Antipad_via_routekeepout_rule.txt', txtHead: 'BGA 封装方案 / L15层扇出',
      constraints: [
        { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1:'17', L2:'17', L3:'17', L4:'17', L5:'17', L6:'17', L7:'17', L8:'17', L9:'17', L10:'17', L11:'17', L12:'17', L13:'17', L14:'17', L15:'5' }, sources: { L1:'L14及以上17mil', L15:'出线层5mil' } },
        { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L15:'3.46' }, sources: { L15:'扇出走线层焊盘半径 3.46 mil' } }
      ]
    },
    {
      kind: 'BGA', title: 'BGA-L8', fanLayer: 8, source: '03Antipad_via_routekeepout_rule.txt', txtHead: 'BGA 封装方案 / L8层扇出',
      constraints: [
        { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1:'17', L2:'17', L3:'17', L4:'17', L5:'17', L6:'17', L7:'17', L8:'5' }, sources: { L1:'L7及以上17mil', L8:'出线层5mil' } },
        { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L8:'3.46' }, sources: { L8:'扇出走线层焊盘半径 3.46 mil' } }
      ]
    },
    // 2. SMA Top Sets
    {
      kind: 'SMA', title: 'Top-SMA-L10-D2M6mil', fanLayer: 10, source: '03Antipad_via_routekeepout_rule.txt', txtHead: '二、SMA在top面，D2M为6mil的封装方案 / 1. L10层扇出 SMA',
      constraints: [
        { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1:'11.39', L2:'11.39', L3:'11.39', L4:'11.39', L5:'11.39', L6:'11.39', L7:'11.39', L8:'11.39', L9:'11.39', L10:'11.39' }, sources: { L1:'L9及以上背钻经过层反焊盘半径 11.39 mil' } },
        { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L10:'3.46' }, sources: { L10:'扇出走线层焊盘半径 3.46 mil' } }
      ]
    },
    {
      kind: 'SMA', title: 'Top-SMA-L8-D2M6mil', fanLayer: 8, source: '03Antipad_via_routekeepout_rule.txt', txtHead: '二、SMA在top面，D2M为6mil的封装方案 / 2. L8层扇出 SMA',
      constraints: [
        { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1:'11.39', L2:'11.39', L3:'11.39', L4:'11.39', L5:'11.39', L6:'11.39', L7:'11.39', L8:'11.39' }, sources: { L1:'L7及以上背钻经过层反焊盘半径 11.39 mil' } },
        { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L8:'3.46' }, sources: { L8:'扇出走线层焊盘半径 3.46 mil' } }
      ]
    },
    {
      kind: 'SMA', title: 'Top-SMA-L6-D2M6mil', fanLayer: 6, source: '03Antipad_via_routekeepout_rule.txt', txtHead: '二、SMA在top面，D2M为6mil的封装方案 / 3. L6层扇出 SMA',
      constraints: [
        { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1:'11.39', L2:'11.39', L3:'11.39', L4:'11.39', L5:'11.39', L6:'11.39' }, sources: { L1:'L5及以上背钻经过层反焊盘半径 11.39 mil' } },
        { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L6:'3.46' }, sources: { L6:'扇出走线层焊盘半径 3.46 mil' } }
      ]
    },
    {
      kind: 'SMA', title: 'Top-SMA-L4-D2M6mil', fanLayer: 4, source: '03Antipad_via_routekeepout_rule.txt', txtHead: '二、SMA在top面，D2M为6mil的封装方案 / 4. L4层扇出 SMA',
      constraints: [
        { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1:'11.39', L2:'11.39', L3:'11.39', L4:'11.39' }, sources: { L1:'L3及以上背钻经过层反焊盘半径 11.39 mil' } },
        { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L4:'3.46' }, sources: { L4:'扇出走线层焊盘半径 3.46 mil' } }
      ]
    },
    {
      kind: 'SMA', title: 'Top-SMA-L2-D2M6mil', fanLayer: 2, source: '03Antipad_via_routekeepout_rule.txt', txtHead: '二、SMA在top面，D2M为6mil的封装方案 / 5. L2层扇出 SMA',
      constraints: [
        { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1:'11.39', L2:'11.39' }, sources: { L1:'L1及以上背钻经过层反焊盘半径 11.39 mil' } },
        { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L2:'3.46' }, sources: { L2:'扇出走线层焊盘半径 3.46 mil' } }
      ]
    },
    {
      kind: 'SMA', title: 'Top-SMA-L4-D2M5mil', fanLayer: 4, source: '03Antipad_via_routekeepout_rule.txt', txtHead: '三、SMA在top面，D2M为5mil的封装方案 / 1. L4层扇出 SMA',
      constraints: [
        { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1:'8.46', L2:'8.46', L3:'8.46', L4:'8.46' }, sources: { L1:'L3及以上背钻经过层反焊盘半径 8.46 mil' } },
        { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L4:'3.46' }, sources: { L4:'扇出走线层焊盘半径 3.46 mil' } }
      ]
    },
    // 3. SMA Bottom Sets
    {
      kind: 'SMA', title: 'Bot-SMA-L19-D2M6mil', fanLayer: 19, source: '03Antipad_via_routekeepout_rule.txt', txtHead: '一、SMA在bottom面，D2M为6mil的封装方案 / 1. L19层扇出 SMA',
      constraints: [
        { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1:'11.39', L2:'11.39', L3:'11.39', L4:'11.39', L5:'11.39', L6:'11.39', L7:'11.39', L8:'11.39', L9:'11.39', L10:'11.39', L11:'11.39', L12:'11.39', L13:'11.39', L14:'11.39', L15:'11.39', L16:'11.39', L17:'11.39', L18:'11.39', L19:'11.39' }, sources: { L1:'L18及以上背钻经过层反焊盘半径 11.39 mil', L19:'出线层反焊盘半径 11.39 mil' } },
        { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L19:'3.46' }, sources: { L19:'扇出走线层焊盘半径 3.46 mil' } }
      ]
    },
    {
      kind: 'SMA', title: 'Bot-SMA-L17-D2M6mil', fanLayer: 17, source: '03Antipad_via_routekeepout_rule.txt', txtHead: '一、SMA在bottom面，D2M为6mil的封装方案 / 2. L17层扇出 SMA',
      constraints: [
        { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1:'11.39', L2:'11.39', L3:'11.39', L4:'11.39', L5:'11.39', L6:'11.39', L7:'11.39', L8:'11.39', L9:'11.39', L10:'11.39', L11:'11.39', L12:'11.39', L13:'11.39', L14:'11.39', L15:'11.39', L16:'11.39', L17:'11.39' }, sources: { L1:'L16及以上背钻经过层反焊盘半径 11.39 mil' } },
        { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L17:'3.46' }, sources: { L17:'扇出走线层焊盘半径 3.46 mil' } }
      ]
    },
    {
      kind: 'SMA', title: 'Bot-SMA-L15-D2M6mil', fanLayer: 15, source: '03Antipad_via_routekeepout_rule.txt', txtHead: '一、SMA在bottom面，D2M为6mil的封装方案 / 3. L15层扇出 SMA',
      constraints: [
        { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1:'11.39', L2:'11.39', L3:'11.39', L4:'11.39', L5:'11.39', L6:'11.39', L7:'11.39', L8:'11.39', L9:'11.39', L10:'11.39', L11:'11.39', L12:'11.39', L13:'11.39', L14:'11.39', L15:'11.39' }, sources: { L1:'L14及以上背钻经过层反焊盘半径 11.39 mil' } },
        { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L15:'3.46' }, sources: { L15:'扇出走线层焊盘半径 3.46 mil' } }
      ]
    },
    {
      kind: 'SMA', title: 'Bot-SMA-L13-D2M6mil', fanLayer: 13, source: '03Antipad_via_routekeepout_rule.txt', txtHead: '一、SMA在bottom面，D2M为6mil的封装方案 / 4. L13层扇出 SMA',
      constraints: [
        { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1:'11.39', L2:'11.39', L3:'11.39', L4:'11.39', L5:'11.39', L6:'11.39', L7:'11.39', L8:'11.39', L9:'11.39', L10:'11.39', L11:'11.39', L12:'11.39', L13:'11.39' }, sources: { L1:'L12及以上背钻经过层反焊盘半径 11.39 mil' } },
        { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L13:'3.46' }, sources: { L13:'扇出走线层焊盘半径 3.46 mil' } }
      ]
    },
    {
      kind: 'SMA', title: 'Bot-SMA-L19-D2M5mil', fanLayer: 19, source: '03Antipad_via_routekeepout_rule.txt', txtHead: '四、SMA在bot面，D2M为5mil的封装方案 / 1. L19层扇出 SMA',
      constraints: [
        { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1:'8.46', L2:'8.46', L3:'8.46', L4:'8.46', L5:'8.46', L6:'8.46', L7:'8.46', L8:'8.46', L9:'8.46', L10:'8.46', L11:'8.46', L12:'8.46', L13:'8.46', L14:'8.46', L15:'8.46', L16:'8.46', L17:'8.46', L18:'8.46', L19:'8.46' }, sources: { L1:'L18及以上背钻经过层反焊盘半径 8.46 mil' } },
        { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L19:'3.46' }, sources: { L19:'扇出走线层焊盘半径 3.46 mil' } }
      ]
    }
  ];
  return sets;
}

// 走线规则标准化转换函数 (兼容 index.html 格式、数组格式、字典格式等)
function normalizeTraceRule(item, layerName) {
  if (!item || typeof item !== 'object') {
    return {
      layer: layerName || 'L_UNKNOWN',
      combos: typeof item === 'string' ? item : '',
      lenRange: '1000-3000',
      diffLayerTol: 0.5,
      specificRule: '',
      minArc: 52.38
    };
  }

  const layer = item.layer || layerName || 'L_UNKNOWN';
  
  // combos / widths / widthsText / widthCombos
  let combos = item.combos || item.widthsText || '';
  if (!combos && Array.isArray(item.widths)) combos = item.widths.join(', ');
  else if (!combos && typeof item.widths === 'string') combos = item.widths;
  else if (!combos && Array.isArray(item.widthCombos)) combos = item.widthCombos.map(c => c.raw || c.str || c).join(', ');

  // lenRange / lenText / lengths / lenMin, lenMax
  let lenRange = item.lenRange || item.lenText || '';
  if (!lenRange && item.lenMin != null && item.lenMax != null) lenRange = `${item.lenMin}-${item.lenMax}`;
  else if (!lenRange && Array.isArray(item.lengths)) lenRange = item.lengths.join('-');
  if (!lenRange) lenRange = '1000-3000';
  if (lenRange.includes(',')) lenRange = lenRange.replace(',', '-');

  // diffLayerTol
  const diffLayerTol = (item.diffLayerTol != null) ? parseFloat(item.diffLayerTol) :
                       ((item.layerTol != null) ? parseFloat(item.layerTol) : 0.5);

  // specificRule / widthLensText / specRule
  const specificRule = item.specificRule || item.widthLensText || item.specRule || '';

  // minArc / radText / minRadius
  const minArc = (item.minArc != null) ? parseFloat(item.minArc) :
                 ((item.radText != null && item.radText !== '') ? parseFloat(item.radText) :
                 ((item.minRadius != null) ? parseFloat(item.minRadius) : 52.38));

  return {
    layer: layer,
    combos: combos,
    lenRange: lenRange,
    diffLayerTol: isNaN(diffLayerTol) ? 0.5 : diffLayerTol,
    specificRule: specificRule,
    minArc: isNaN(minArc) ? 52.38 : minArc
  };
}

function parseTraceRulesJson(jsonObj) {
  let newRules = [];
  const r = jsonObj;

  if (Array.isArray(r)) {
    newRules = r.map((x, i) => normalizeTraceRule(x, `L${i+1}`));
  } else if (r.rules && Array.isArray(r.rules)) {
    newRules = r.rules.map((x, i) => normalizeTraceRule(x, x.layer || `L${i+1}`));
  } else if (r.traceLayers && Array.isArray(r.traceLayers)) {
    newRules = r.traceLayers.map((x, i) => normalizeTraceRule(x, x.layer || `L${i+1}`));
  } else if (r.layers) {
    if (Array.isArray(r.layers)) {
      newRules = r.layers.map((x, i) => normalizeTraceRule(x, x.layer || `L${i+1}`));
    } else if (typeof r.layers === 'object') {
      newRules = Object.entries(r.layers).map(([k, v]) => normalizeTraceRule(v, k));
    }
  } else if (r.layerRules) {
    if (Array.isArray(r.layerRules)) {
      newRules = r.layerRules.map((x, i) => normalizeTraceRule(x, x.layer || `L${i+1}`));
    } else if (typeof r.layerRules === 'object') {
      newRules = Object.entries(r.layerRules).map(([k, v]) => normalizeTraceRule(v, k));
    }
  } else if (typeof r === 'object' && r !== null) {
    const entries = Object.entries(r).filter(([k, v]) => !['kind', 'version', 'def', 'tol', 'checkWidth', 'checkLen', 'unit', 'checkWidthLen', 'checkRad', 'exportTime'].includes(k));
    if (entries.length > 0) {
      newRules = entries.map(([k, v]) => normalizeTraceRule(v, k));
    }
  }

  return newRules;
}

function getDefaultFanoutPresets() {
  return [
    {
      id: 'sc_sma_bot_l19',
      name: 'SMA-Bot-L19-5孔标准十字扇出',
      tag: 'SMA接插件扇出',
      desc: '底面L19层出线 SMA 1信号孔 + 4个伴随GND屏蔽地孔，孔心距 20mil/28.28mil',
      viaCount: 5,
      vias: [
        { id: 'v1', role: 'Signal', type: 'signal', x: 0, y: 0, padstack: 'SMA_Bot-L19_d2m6mil_via-0902' },
        { id: 'v2', role: 'GND', type: 'gnd', x: 0, y: 20, padstack: 'BGA_GND_pad1mil_0902' },
        { id: 'v3', role: 'GND', type: 'gnd', x: 0, y: -20, padstack: 'BGA_GND_pad1mil_0902' },
        { id: 'v4', role: 'GND', type: 'gnd', x: -20, y: 0, padstack: 'BGA_GND_pad1mil_0902' },
        { id: 'v5', role: 'GND', type: 'gnd', x: 20, y: 0, padstack: 'BGA_GND_pad1mil_0902' }
      ]
    },
    {
      id: 'sc_sma_l2',
      name: 'SMA-L2-5孔表层十字扇出',
      tag: 'SMA接插件扇出',
      desc: 'L2层出线 SMA 1信号孔 + 4个伴随GND屏蔽地孔',
      viaCount: 5,
      vias: [
        { id: 'v1', role: 'Signal', type: 'signal', x: 0, y: 0, padstack: 'SMA_L2_d2m6mil_via_0902' },
        { id: 'v2', role: 'GND', type: 'gnd', x: 0, y: 20, padstack: 'BGA_GND_pad1mil_0902' },
        { id: 'v3', role: 'GND', type: 'gnd', x: 0, y: -20, padstack: 'BGA_GND_pad1mil_0902' },
        { id: 'v4', role: 'GND', type: 'gnd', x: -20, y: 0, padstack: 'BGA_GND_pad1mil_0902' },
        { id: 'v5', role: 'GND', type: 'gnd', x: 20, y: 0, padstack: 'BGA_GND_pad1mil_0902' }
      ]
    },
    {
      id: 'sc_bga_diff_6via',
      name: 'BGA-差分对+4伴随地孔(6孔方案)',
      tag: 'BGA差分扇出',
      desc: 'BGA区 域差分对信号孔(P/N) + 四角包围伴随地孔',
      viaCount: 6,
      vias: [
        { id: 'v1', role: 'Signal', type: 'signal', x: -10, y: 0, padstack: 'test_BGA_3510_L19_L2_ring3mil' },
        { id: 'v2', role: 'Signal', type: 'signal', x: 10, y: 0, padstack: 'test_BGA_3510_L19_L2_ring3mil' },
        { id: 'v3', role: 'GND', type: 'gnd', x: -30, y: 20, padstack: 'BGA_GND_pad1mil_0902' },
        { id: 'v4', role: 'GND', type: 'gnd', x: 30, y: 20, padstack: 'BGA_GND_pad1mil_0902' },
        { id: 'v5', role: 'GND', type: 'gnd', x: -30, y: -20, padstack: 'BGA_GND_pad1mil_0902' },
        { id: 'v6', role: 'GND', type: 'gnd', x: 30, y: -20, padstack: 'BGA_GND_pad1mil_0902' }
      ]
    },
    {
      id: 'sc_bga_gnd_4grid',
      name: 'BGA-2×2地孔阵列(4孔方案)',
      tag: 'BGA地孔阵列',
      desc: 'BGA 2×2 矩形地孔阵列，间距 20mil × 20mil',
      viaCount: 4,
      vias: [
        { id: 'v1', role: 'GND', type: 'gnd', x: -10, y: 10, padstack: 'BGA_GND_pad1mil_0902' },
        { id: 'v2', role: 'GND', type: 'gnd', x: 10, y: 10, padstack: 'BGA_GND_pad1mil_0902' },
        { id: 'v3', role: 'GND', type: 'gnd', x: -10, y: -10, padstack: 'BGA_GND_pad1mil_0902' },
        { id: 'v4', role: 'GND', type: 'gnd', x: 10, y: -10, padstack: 'BGA_GND_pad1mil_0902' }
      ]
    }
  ];
}


