const fs = require('fs');
const path = require('path');

function loadJsdom() {
  try { return require('jsdom'); }
  catch (e) { throw new Error('找不到 jsdom，请先执行 npm install'); }
}
const { JSDOM } = loadJsdom();

const html = fs.readFileSync(path.join(__dirname, 'dfm.html'), 'utf8');
const jsCode = fs.readFileSync(path.join(__dirname, 'dfm-check.js'), 'utf8');
const padGeomCode = fs.readFileSync(path.join(__dirname, 'pad-geom.js'), 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'file://' + path.join(__dirname, 'dfm.html')
});

const w = dom.window;
const d = w.document;
const $ = id => d.getElementById(id);

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (err) {
    console.error(`  FAIL  ${name} -> ${err.message}`);
    fail++;
  }
}

// Inject 几何内核 + DfmCheck 引擎脚本 (顺序与页面一致：pad-geom.js → dfm-check.js)
w.eval(padGeomCode);
w.eval(jsCode);
w.__SYNC_CHECK__ = true;

console.log('== DFM 加工能力与空间间距 UI 测试 ==');

test('页面基本元素与双规则阈值/焊盘直径/一钻直径输入框存在', () => {
  const tabs = d.querySelectorAll('nav#tabs button');
  if (tabs.length !== 4) throw new Error('页签数量应为 4，实际 ' + tabs.length);
  if (!$('inpThresholdGnd')) throw new Error('缺少 GND 孔阈值输入框');
  if (!$('inpThresholdSignal')) throw new Error('缺少信号孔阈值输入框');
  if (!$('inpGndPadDiam')) throw new Error('缺少 GND 焊盘直径输入框');
  if (!$('inpSignalPadDiam')) throw new Error('缺少信号孔焊盘直径输入框');
  if (!$('inpGndFirstDrill')) throw new Error('缺少 GND 一钻直径输入框');
  if (!$('inpSignalFirstDrill')) throw new Error('缺少信号孔一钻直径输入框');
  if (!$('btnMeasureMode')) throw new Error('缺少测量标尺模式按钮');
});

test('加载示例数据并验证双规则阈值计算与统计卡片', () => {
  const sampleTxt = fs.readFileSync(path.join(__dirname, 'sample/via_trace_airgap_sample.txt'), 'utf8');
  $('inpGndPadDiam').value = '5.94';
  $('inpSignalPadDiam').value = '9.94';
  $('inpThresholdGnd').value = '6.0';
  $('inpThresholdSignal').value = '6.0';
  w.eval(`loadTextData(${JSON.stringify(sampleTxt)}, "via_trace_airgap_sample.txt"); runCheck();`);
  
  const badNum = parseInt($('statBadCount').textContent, 10);
  if (badNum !== 23) throw new Error('在 5.94 mil 焊盘下超标数应为 23，实际 ' + badNum);
  
  const gndBadText = $('statGndBadCount').textContent;
  if (gndBadText.indexOf('23') < 0) throw new Error('GND 孔统计应含 23 超标，实际 ' + gndBadText);

  const sigBadText = $('statSigBadCount').textContent;
  if (sigBadText.indexOf('0') < 0) throw new Error('信号孔统计应含 0 超标，实际 ' + sigBadText);

  const minVal = parseFloat($('statMinDist').textContent);
  if (Math.abs(minVal - 5.02) > 0.05) throw new Error('最小实测间距应约为 5.02 mil，实际 ' + minVal);
});

test('独立修改信号孔与GND孔阈值并验证双规则判定生效', () => {
  $('inpGndPadDiam').value = '5.94';
  $('inpSignalPadDiam').value = '9.94';
  // 设置 GND 孔阈值 5.0 mil (放宽), 信号孔阈值 8.0 mil (收紧)
  $('inpThresholdGnd').value = '5.0';
  $('inpThresholdSignal').value = '8.0';
  $('btnRunCheck').click();

  const badNum = parseInt($('statBadCount').textContent, 10);
  if (badNum !== 9) throw new Error('修改后超标数应为 9，实际 ' + badNum);
  
  const gndBadText = $('statGndBadCount').textContent;
  if (gndBadText.indexOf('0 /') < 0) throw new Error('GND 孔超标数应为 0，实际 ' + gndBadText);

  const sigBadText = $('statSigBadCount').textContent;
  if (sigBadText.indexOf('9 /') < 0) throw new Error('信号孔超标数应为 9，实际 ' + sigBadText);

  // 恢复默认 6.0 / 6.0
  $('inpThresholdGnd').value = '6.0';
  $('inpThresholdSignal').value = '6.0';
  $('btnRunCheck').click();
});

test('线到GND孔与线到信号孔筛选按钮联动', () => {
  $('btnFilterGnd').click();
  if (w.State.activeFilter !== 'gnd') throw new Error('activeFilter 应为 gnd');
  
  $('btnFilterSig').click();
  if (w.State.activeFilter !== 'signal') throw new Error('activeFilter 应为 signal');

  $('btnFilterBad').click();
  if (w.State.activeFilter !== 'bad') throw new Error('activeFilter 应为 bad');
});

test('修改一钻直径后过孔属性实时更新', () => {
  $('inpGndFirstDrill').value = '5.94';
  $('btnRunCheck').click();
  const v1 = w.State.vias[0];
  if (Math.abs(v1.firstDrill - 5.94) > 1e-4) throw new Error('修改 GND 一钻直径后未更新：' + v1.firstDrill);
  $('inpGndFirstDrill').value = '5.54';
  $('btnRunCheck').click();
});

test('测量标尺模式切换与面板联动', () => {
  $('btnMeasureMode').click();
  if (!w.State.measureMode) throw new Error('测量模式未激活');
  if (!$('pcbCanvas').classList.contains('measuring')) throw new Error('Canvas 缺少 measuring 样式');
  
  // 模拟选中两个过孔进行测量
  w.State.measureSelection = [
    { type: 'via', item: w.State.vias[0] },
    { type: 'via', item: w.State.vias[1] }
  ];
  w.updateMeasurements();
  if ($('measureCard').style.display !== 'block') throw new Error('测量卡片未弹出');
  if ($('measureCardBody').textContent.indexOf('孔中心到中心距') < 0) throw new Error('缺少中心距测量字段');
  
  // 退出测量模式
  $('btnMeasureMode').click();
  if (w.State.measureMode) throw new Error('退出测量模式失败');
});

test('搜索功能与定位', () => {
  $('inpThresholdGnd').value = '6.0';
  $('inpThresholdSignal').value = '6.0';
  $('btnRunCheck').click();

  const searchInp = $('inpSearch');
  searchInp.value = 'Via 17';
  searchInp.dispatchEvent(new w.Event('input', { bubbles: true }));

  const rows = d.querySelectorAll('#resTableBody tr');
  if (rows.length === 0) throw new Error('搜索 Via 17 应有结果');
  rows.forEach(r => {
    if (r.textContent.indexOf('Via 17') < 0 && r.textContent.indexOf('暂无') < 0) {
      throw new Error('过滤结果包含非 Via 17 记录');
    }
  });
});

test('复核勾选功能保留状态', () => {
  const searchInp = $('inpSearch');
  searchInp.value = '';
  searchInp.dispatchEvent(new w.Event('input', { bubbles: true }));

  const firstCk = d.querySelector('#resTableBody .ck-rev');
  if (firstCk) {
    firstCk.click();
    const newFirstRow = d.querySelector('#resTableBody tr');
    if (!newFirstRow.classList.contains('reviewed')) throw new Error('勾选后未添加 reviewed 类');
  }
});

test('历史配置标签渲染与点击快速填充功能', () => {
  const gndHistBar = $('hist_thresh_gnd');
  if (!gndHistBar) throw new Error('缺少 GND 阈值历史标签容器');
  const chips = gndHistBar.querySelectorAll('.hist-chip');
  if (chips.length === 0) throw new Error('历史标签未渲染');

  // 点击历史标签 5.0
  const chip5 = Array.from(chips).find(c => c.textContent.trim() === '5');
  if (chip5) {
    chip5.click();
    if (Math.abs(parseFloat($('inpThresholdGnd').value) - 5.0) > 1e-4) {
      throw new Error('点击历史标签后输入框未更新');
    }
  }
});

test('按出线层x走线网络聚合分析视图切换与明细展开', () => {
  $('btnViewNetGroup').click();
  if (w.State.resViewMode !== 'net_group') throw new Error('视图切换失败');
  if ($('netGroupViewContainer').style.display === 'none') throw new Error('聚合容器未显示');

  const rows = d.querySelectorAll('#netGroupTableBody tr');
  if (rows.length === 0) throw new Error('聚合表格无行数据');

  // 展开第一条有缺陷的网络明细
  const toggleBtn = d.querySelector('.btn-toggle-net-defects');
  if (toggleBtn) {
    toggleBtn.click();
    const subTable = d.querySelector('.net-defects-table');
    if (!subTable) throw new Error('走线超标明细表格未展开');
  }

  // 切换回对偶视图
  $('btnViewPairList').click();
  if (w.State.resViewMode !== 'pair_list') throw new Error('切回对偶明细视图失败');
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
if (fail > 0) process.exit(1);
