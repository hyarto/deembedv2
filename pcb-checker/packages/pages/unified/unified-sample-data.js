/* ============================================================================
 * unified-sample-data.js —— 综合示例数据载入
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
function loadUnifiedSampleData() {
  const sampleTxt = `EDA REPORT DATA - 5-IN-1 UNIFIED SUITE
Total 18 Items

Item 1                < Via >
  Set:                Route Keepout
  Subset:             02G01P
  Net:                105_P
  Padstack Name:      BGA_3510_L19_ring3mil_L2pad_0907
  Usage:              Thru Via
  Origin-xy:          [21220.9400, 35522.4600]
  Connections:        02G01P 19IS08
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 2                < Via >
  Set:                Route Keepout
  Subset:             02G01P
  Net:                105_N
  Padstack Name:      BGA_3510_L19_ring3mil_L2pad_0907
  Usage:              Thru Via
  Origin-xy:          [21220.9400, 35532.4600]
  Connections:        02G01P 19IS08
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 3                < Via >
  Set:                Route Keepout
  Subset:             19IS08
  Net:                GND
  Padstack Name:      VIA_0902_GND_D2M6mil
  Usage:              GND Via
  Origin-xy:          [21220.9400, 35522.4600]
  Connections:        08IS03 19IS08
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 4                < Via >
  Set:                Route Keepout
  Subset:             19IS08
  Net:                GND
  Padstack Name:      VIA_0902_GND_D2M6mil
  Usage:              GND Via
  Origin-xy:          [21194.1600, 35527.2300]
  Connections:        08IS03 19IS08
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 5                < Via >
  Set:                Route Keepout
  Subset:             08IS03
  Net:                GND
  Padstack Name:      VIA_0902_GND_D2M6mil
  Usage:              GND Via
  Origin-xy:          [22351.2900, 35547.3000]
  Connections:        08IS03 19IS08
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 6                < Via >
  Set:                Route Keepout
  Subset:             08IS03
  Net:                GND
  Padstack Name:      VIA_0902_GND_D2M6mil
  Usage:              GND Via
  Origin-xy:          [22351.2900, 35532.5400]
  Connections:        08IS03 19IS08
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 7                < Via >
  Set:                Route Keepout
  Subset:             08IS03
  Net:                GND
  Padstack Name:      VIA_0902_GND_D2M6mil
  Usage:              GND Via
  Origin-xy:          [22351.2900, 35517.7700]
  Connections:        08IS03 19IS08
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 8                < Trace Seg >
  Set:                Trace
  Subset:             19IS08
  Net:                25_P
  Trace: 56 (19IS08) 57 (19IS08) 58 (19IS08)
  Length:             1250.000000
  Seg: xy [21211.0100, 35523.2300]  xy [21230.0000, 35523.2300] Width (6.0000)
  Seg: xy [21230.0000, 35523.2300]  xy [21260.0000, 35523.2300] Width (3.9400)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 9                < Trace Seg >
  Set:                Trace
  Subset:             19IS08
  Net:                25_N
  Trace: 35 (19IS08) 36 (19IS08) 37 (19IS08)
  Length:             1248.800000
  Seg: xy [21204.1300, 35527.2300]  xy [21230.0000, 35527.2300] Width (6.0000)
  Seg: xy [21230.0000, 35527.2300]  xy [21260.0000, 35527.2300] Width (3.9400)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 10               < Trace Seg >
  Set:                Trace
  Subset:             08IS03
  Net:                26_N
  Trace: 70 (08IS03) 71 (08IS03)
  Length:             1800.500000
  Seg: xy [22362.2900, 35547.1800]  xy [22390.0000, 35547.1800] Width (6.9000)
  Seg: xy [22390.0000, 35547.1800]  xy [22430.0000, 35547.1800] Width (6.0000)
  Seg: xy [22430.0000, 35547.1800]  xy [22480.0000, 35547.1800] Width (3.9400)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 11               < Trace Seg >
  Set:                Trace
  Subset:             08IS03
  Net:                26_P
  Trace: 73 (08IS03) 74 (08IS03) 75 (08IS03)
  Length:             1798.800000
  Seg: xy [22361.9900, 35520.3400]  xy [22390.0000, 35520.3400] Width (6.9000)
  Seg: xy [22390.0000, 35520.3400]  xy [22430.0000, 35520.3400] Width (6.0000)
  Seg: xy [22430.0000, 35520.3400]  xy [22480.0000, 35520.3400] Width (3.9400)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 12               < Trace Seg >
  Set:                Trace
  Subset:             02G01P
  Net:                105_P
  Trace: 1 (02G01P) 2 (02G01P)
  Length:             2000.068301
  Seg: xy [21220.9400, 35522.4600]  xy [21300.0000, 35522.4600] Width (5.6000)
  Arc seg: xy [21300.0000, 35522.4600]  xy [21350.0000, 35572.4600] Width (5.6000)
    Center-xy: [21300.0000, 35572.4600] Radius (52.3800) CW
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 13               < Trace Seg >
  Set:                Trace
  Subset:             02G01P
  Net:                105_N
  Trace: 3 (02G01P) 4 (02G01P)
  Length:             2000.401200
  Seg: xy [21220.9400, 35532.4600]  xy [21300.0000, 35532.4600] Width (5.6000)
  Arc seg: xy [21300.0000, 35532.4600]  xy [21350.0000, 35582.4600] Width (5.6000)
    Center-xy: [21300.0000, 35582.4600] Radius (52.3800) CW
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 14               < Trace Seg >
  Set:                Trace
  Subset:             02G01P
  Net:                106_P
  Trace: 5 (02G01P) 6 (02G01P)
  Length:             1500.000000
  Seg: xy [21400.0000, 35500.0000]  xy [21450.0000, 35500.0000] Width (5.6000)
  Seg: xy [21450.0000, 35500.0000]  xy [21500.0000, 35500.0000] Width (6.0000)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 15               < Trace Seg >
  Set:                Trace
  Subset:             02G01P
  Net:                106_N
  Trace: 7 (02G01P) 8 (02G01P)
  Length:             1499.500000
  Seg: xy [21400.0000, 35510.0000]  xy [21500.0000, 35510.0000] Width (5.6000)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 16               < Shape >
  Set:                Route Keepout
  Subset:             02G01P
  Type:               Shape(Static)
  Shape is Solid Filled
  Area:               125000.00 (sq mil)
Exterior Boundary:
  Line seg: xy [21150.0000, 35450.0000]  xy [21600.0000, 35450.0000] Width (0.0000)
  Line seg: xy [21600.0000, 35450.0000]  xy [21600.0000, 35650.0000] Width (0.0000)
  Line seg: xy [21600.0000, 35650.0000]  xy [21150.0000, 35650.0000] Width (0.0000)
  Line seg: xy [21150.0000, 35650.0000]  xy [21150.0000, 35450.0000] Width (0.0000)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 17               < Shape >
  Set:                Route Keepout
  Subset:             08IS03
  Type:               Shape(Static)
  Shape is Solid Filled
  Area:               85000.00 (sq mil)
Exterior Boundary:
  Line seg: xy [22300.0000, 35480.0000]  xy [22550.0000, 35480.0000] Width (0.0000)
  Line seg: xy [22550.0000, 35480.0000]  xy [22550.0000, 35600.0000] Width (0.0000)
  Line seg: xy [22550.0000, 35600.0000]  xy [22300.0000, 35600.0000] Width (0.0000)
  Line seg: xy [22300.0000, 35600.0000]  xy [22300.0000, 35480.0000] Width (0.0000)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 18               < Shape >
  Set:                Route Keepout
  Subset:             19IS08
  Type:               Shape(Static)
  Shape is Solid Filled
  Area:               200.00 (sq mil)
Exterior Boundary:
  Line seg: xy [21200.0000, 35500.0000]  xy [21220.0000, 35500.0000] Width (0.0000)
  Line seg: xy [21220.0000, 35500.0000]  xy [21220.0000, 35510.0000] Width (0.0000)
  Line seg: xy [21220.0000, 35510.0000]  xy [21200.0000, 35510.0000] Width (0.0000)
  Line seg: xy [21200.0000, 35510.0000]  xy [21200.0000, 35500.0000] Width (0.0000)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
~ ~ ~ ~ ~ ~ ~ ~ ~ ~End~ ~ ~ ~ ~ ~ ~ ~ ~ ~`;

  const samplePresets = [
    { key: 'trace',      name: '01_走线检查示例数据.txt',      text: sampleTxt },
    { key: 'constraint', name: '02_约束检查示例数据.txt',      text: sampleTxt },
    { key: 'dfmFanout',  name: '03_DFM与扇出方案示例数据.txt', text: sampleTxt },
    { key: 'pour',       name: '04_铜皮检查示例数据.txt',      text: sampleTxt }
  ];
  samplePresets.forEach(item => {
    State.dataInputs[item.key] = {
      text: item.text,
      fileNames: [item.name],
      totalBytes: item.text.length,
      statsText: summarizeCategoryElements(item.key, item.text)
    };
  });
  renderDataIngestionBoxes();
  runMasterInspection();
}

