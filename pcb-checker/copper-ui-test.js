/* 用 jsdom 加载 copper.html，跑一遍 规则 / 导入数据 / 检查结果 三个页签 */
const fs = require('fs');
const path = require('path');
function loadJsdom(){
  try { return require('jsdom'); }
  catch (e) { throw new Error('找不到 jsdom，请先执行 npm install'); }
}
const { JSDOM, VirtualConsole } = loadJsdom();

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'copper.html'), 'utf8');

const vc = new VirtualConsole();
let domErr = 0;
vc.on('jsdomError', e => {
  if (/Not implemented: (navigation|Window's scrollTo)/.test(String(e.message))) return;
  domErr++;
  console.log('  JSDOM ERROR: ' + e.message);
});
vc.on('error', (...a) => console.log('  console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  virtualConsole: vc,
  pretendToBeVisual: true,
  resources: 'usable',
  url: 'file://' + path.join(dir, 'copper.html')
});
const w = dom.window, d = w.document, $ = id => d.getElementById(id);

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '  -> ' + e.message); }
}
function activeTab() { const s = d.querySelector('section.tab.active'); return s ? s.id : '(none)'; }

setTimeout(() => {
  console.log('== 页签 ==');
  t('初始在 ① 规则约束', () => { if (activeTab() !== 'tab-rules') throw new Error(activeTab()); });
  t('五个页签按钮存在且编号顺延', () => {
    const b = [...d.querySelectorAll('#tabs button')].map(x => x.textContent);
    if (b.length !== 5) throw new Error('按钮数 ' + b.length + ' ' + b.join('|'));
    ['① 规则约束', '② 生成的约束', '③ 导入数据', '④ 检查结果', '⑤ 规律分析'].forEach((x, i) => {
      if (b[i].indexOf(x) !== 0) throw new Error('第' + (i + 1) + '个页签是 ' + b[i]);
    });
  });
  t('① 页只有导入文件，没有约束表', () => {
    $('tabs').querySelector('[data-tab="rules"]').click();
    const sec = $('tab-rules');
    if (!sec.querySelector('#drop')) throw new Error('缺导入区');
    if (sec.querySelector('#sets') || sec.querySelector('#rulesBody')) throw new Error('① 页还带着约束表');
  });
  t('② 页是生成的约束，带指引和约束表', () => {
    $('tabs').querySelector('[data-tab="sets"]').click();
    if (activeTab() !== 'tab-sets') throw new Error(activeTab());
    const sec = $('tab-sets');
    if (!sec.querySelector('#jumpNav') || !sec.querySelector('#rulesBody') || !sec.querySelector('#sets')) throw new Error('② 页缺内容');
    if (!sec.querySelector('#pinB')) throw new Error('② 页没有钉住块');
  });
  t('切到 ③ 导入数据', () => { $('tabs').querySelector('[data-tab="data"]').click(); if (activeTab() !== 'tab-data') throw new Error(activeTab()); });
  t('切到 ④ 检查结果', () => { $('tabs').querySelector('[data-tab="result"]').click(); if (activeTab() !== 'tab-result') throw new Error(activeTab()); });
  t('切到 ⑤ 规律分析', () => { $('tabs').querySelector('[data-tab="legend"]').click(); if (activeTab() !== 'tab-legend') throw new Error(activeTab()); });
  t('切回 ① 规则约束', () => { $('tabs').querySelector('[data-tab="rules"]').click(); if (activeTab() !== 'tab-rules') throw new Error(activeTab()); });
  t('钉住块和约束区都还在', () => { if (!$('pin') || !$('pinB') || !$('rulesBody') || !$('sets')) throw new Error('缺元素'); });
  console.log('== 铜皮 × 过孔 配对与推算 ==');
  const sampleTxt = fs.readFileSync(path.join(dir, 'sample/铜皮数据示例.txt'), 'utf8');
  const rules = [{
    kind: 'BGA', title: 'BGA-L19', fanLayer: 19,
    constraints: [
      { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1: '17', L2: '12', L19: '5' } }
    ]
  }, { kind: 'BGA', title: 'BGA-L17', fanLayer: 17, constraints: [] }];

  t('注入规则并跑检查', () => {
    w.__sampleTxt = sampleTxt;
    const r = w.eval(`(function(){
      S.sets = ${JSON.stringify(rules)};
      UI.items = CopperCheck.parseBoardItems(window.__sampleTxt);
      runCheck(true);
      return {ok:true, groups:UI.result.groups.length, rule:UI.result.groups[0].rule && UI.result.groups[0].rule.title,
              rows:UI.result.groups[0].rows.length};
    })()`);
    if (r.rule !== 'BGA-L19' || r.rows !== 4) throw new Error(JSON.stringify(r));
  });
  t('③ 导入数据 页显示 配对 + 推算的约束', () => {
    $('tabs').querySelector('[data-tab="data"]').click();
    const h = $('matchOut').innerHTML;
    if (h.indexOf('BGA_3510_L19_ring3mil_L2pad_0907') < 0) throw new Error('没有 padstack');
    if (h.indexOf('BGA-L19') < 0) throw new Error('没有推算出的约束名');
    if (h.indexOf('BGA / L19 / ring3mil') < 0) throw new Error('没有提取的关键信息');
    if (h.indexOf('L19') < 0) throw new Error('没有层');
  });
  t('④ 检查结果 页显示 层/实测/规则值/结果，不符合为红', () => {
    w.eval('renderResults()');
    const h = $('checkOut').innerHTML;
    if (h.indexOf('实测') < 0 || h.indexOf('规则值') < 0) throw new Error('缺列');
    if (h.indexOf('class="bad"') < 0) throw new Error('没有红色标注');
    if (h.indexOf('不符合') < 0) throw new Error('没有不符合');
    if (h.indexOf('L19') < 0) throw new Error('没有 L19 行');
  });
  t('L19 反焊盘 6 对规则值 5 = 不符合', () => {
    const st = w.eval("(function(){const g=UI.result.groups[0];return g.rows.map(r=>'L'+r.layer+':'+r.checkType+':'+r.actual+'/'+r.expect+':'+r.status).join(' | ');})()");
    if (st.indexOf('L19:反焊盘尺寸:6/5:不符合') < 0) throw new Error(st);
    console.log('        ' + st);
  });
  t('关掉 反焊盘尺寸与Padstack，全部变未检查', () => {
    $('ckAnti').checked = false;
    $('ckPadstack').checked = false;
    w.eval('runCheck(true)');
    const bad = w.eval("UI.result.groups[0].rows.filter(r=>r.status!=='未检查').length");
    if (bad) throw new Error('还有 ' + bad + ' 行被检查');
    $('ckAnti').checked = true;
    $('ckPadstack').checked = true;
    w.eval('runCheck(true)');
  });
  t('只看不符合 过滤掉符合项', () => {
    w.eval('UI.onlyBad=true; renderResults()');
    const h = $('checkOut').innerHTML;
    if (h.indexOf('不符合') < 0) throw new Error('空');
    const okRows = (w.eval("UI.result.groups[0].rows.filter(r=>r.status==='符合').length"));
    if (okRows < 1) throw new Error('样本里没有符合项，测不了过滤');
    w.eval('UI.onlyBad=false; renderResults()');
  });
  t('没有规则时提示导入约束 TXT', () => {
    w.eval('S.sets=[]; runCheck(true)');
    if ($('checkHint').textContent.indexOf('还没有规则') < 0) throw new Error($('checkHint').textContent);
  });

  console.log('== 统计方块筛选 ==');
  const mix = [
    'Total 6 Items','',
    'Item 1                < Shape >','','  Set:                Route Keepout','  Subset:             Top','',
    '  Type:               Shape(Static)','','  Shape is Solid Filled','  Area:               907.92  (sq mil)','',
    'Exterior Boundary:','  Arc seg: xy [83.0000, 100.0000]  xy [83.0000, 100.0000] Width (0.0000)',
    '    Center-xy:  [100.0000, 100.0000] Radius (17.0000) CCW','~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~','',
    'Item 2                < Shape >','','  Set:                Route Keepout','  Subset:             02G01P','',
    '  Type:               Shape(Static)','','  Shape is Solid Filled','  Area:               452.39  (sq mil)','',
    'Exterior Boundary:','  Arc seg: xy [88.0000, 100.0000]  xy [88.0000, 100.0000] Width (0.0000)',
    '    Center-xy:  [100.0000, 100.0000] Radius (12.0000) CCW','~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~','',
    'Item 3                < Shape >','','  Set:                Route Keepout','  Subset:             07IS03','',
    '  Type:               Shape(Static)','','  Shape is Solid Filled','  Area:               254.47  (sq mil)','',
    'Exterior Boundary:','  Arc seg: xy [291.0000, 300.0000]  xy [291.0000, 300.0000] Width (0.0000)',
    '    Center-xy:  [300.0000, 300.0000] Radius (9.0000) CCW','~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~','',
    'Item 4                < Via >','','  Origin-xy:          [100.0000, 100.0000]','  Net:                63_N','',
    '  Padstack Name:      BGA_3510_L19_ring3mil_L2pad_0907','  Usage:              BBVia','',
    '  Connections:        ','    Trace:            2 (Top 02G01P)','~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~','',
    'Item 5                < Via >','','  Origin-xy:          [200.0000, 200.0000]','  Net:                GND','',
    '  Padstack Name:      BGA_3510_L17_ring3mil_0902','  Usage:              BBVia','~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~','',
    '~ ~ ~ ~ ~ ~ ~ ~ ~ ~End~ ~ ~ ~ ~ ~ ~ ~ ~ ~'
  ].join('\n');
  function bodyRows(){
    const m = $('matchOut').innerHTML.match(/<tbody>([\s\S]*)<\/tbody>/);
    return m ? (m[1].match(/<tr/g) || []).length : -1;
  }
  t('载入混合样本并出统计', () => {
    $('tabs').querySelector('[data-tab="data"]').click();
    w.__mixTxt = mix;
    const r = w.eval("(function(){S.sets=" + JSON.stringify([{
      kind:'BGA', title:'BGA-L19', fanLayer:19,
      constraints:[{cat:'反焊盘尺寸', name:'反焊盘半径', unit:'mil', values:{L1:'17', L2:'12', L7:'9'}}]
    }]) + "; UI.items=CopperCheck.parseBoardItems(window.__mixTxt); UI.matchFilter=''; runCheck(true); return 1;})()");
    if (r !== 1) throw new Error('eval');
    const h = $('matchOut').innerHTML;
    ['过孔','已配对过孔','圆形铜皮','未配对铜皮'].forEach(x => { if (h.indexOf(x) < 0) throw new Error('缺方块 ' + x); });
  });
  t('默认显示全部 4 行', () => { if (bodyRows() !== 4) throw new Error('rows=' + bodyRows()); });
  t('点「过孔」= 2 个配对行 + 1 个未配对过孔', () => {
    d.querySelector('#matchOut .stat.click[data-f="via"]').click();
    if (bodyRows() !== 3) throw new Error('rows=' + bodyRows());
    if ($('matchOut').innerHTML.indexOf('BGA_3510_L17_ring3mil_0902') < 0) throw new Error('没有未配对过孔行');
    if ($('matchOut').innerHTML.indexOf('没有配对到过孔') >= 0) throw new Error('不该出现未配对铜皮行');
  });
  t('点「已配对过孔」= 只 2 行', () => {
    d.querySelector('#matchOut .stat.click[data-f="matched"]').click();
    if (bodyRows() !== 2) throw new Error('rows=' + bodyRows());
  });
  t('点「圆形铜皮」= 2 配对 + 1 未配对', () => {
    d.querySelector('#matchOut .stat.click[data-f="circle"]').click();
    if (bodyRows() !== 3) throw new Error('rows=' + bodyRows());
    if ($('matchOut').innerHTML.indexOf('没有配对到过孔') < 0) throw new Error('缺未配对铜皮行');
    if ($('matchOut').innerHTML.indexOf('附近没有圆形铜皮') >= 0) throw new Error('不该出现未配对过孔行');
  });
  t('点「未配对铜皮」= 只 1 行，且只有铜皮信息', () => {
    d.querySelector('#matchOut .stat.click[data-f="unmatched"]').click();
    if (bodyRows() !== 1) throw new Error('rows=' + bodyRows());
    if ($('matchOut').innerHTML.indexOf('07IS03') < 0) throw new Error('不是 #3 铜皮');
  });
  t('再点一次同一个方块 = 恢复全部', () => {
    d.querySelector('#matchOut .stat.click[data-f="unmatched"]').click();
    if (bodyRows() !== 4) throw new Error('rows=' + bodyRows());
    if (d.querySelector('#matchOut .stat.click.on')) throw new Error('还有高亮方块');
  });

  console.log('== 不符合项复核勾选 ==');
  t('回到样本数据（含 1 条不符合）', () => {
    $('tabs').querySelector('[data-tab="result"]').click();
    w.__sampleTxt = sampleTxt;
    const r = w.eval("(function(){S.sets=" + JSON.stringify(rules) + "; UI.items=CopperCheck.parseBoardItems(window.__sampleTxt); UI.onlyBad=false; UI.matchFilter=''; UI.reviewed={}; runCheck(true); renderResults(); return 1;})()");
    if (r !== 1) throw new Error('eval');
    const fails = d.querySelectorAll('#checkOut tr.fail').length;
    if (fails !== 1) throw new Error('不符合行数 = ' + fails);
  });
  t('只有不符合行有勾选框', () => {
    const fails = d.querySelectorAll('#checkOut tr.fail').length;
    const boxes = d.querySelectorAll('#checkOut .rvwBox').length;
    if (fails < 1) throw new Error('样本里没有不符合行');
    if (boxes !== fails) throw new Error('勾选框 ' + boxes + ' 行数 ' + fails);
    const okRows = d.querySelectorAll('#checkOut tr:not(.fail) .rvwBox').length;
    if (okRows) throw new Error('符合的行也有勾选框 ' + okRows + ' 个');
  });
  t('勾选后行变灰、出现已复核标签', () => {
    const box = d.querySelector('#checkOut .rvwBox');
    const tr = box.closest('tr');
    if (tr.classList.contains('reviewed')) throw new Error('初始就已经是已复核');
    box.checked = true;
    box.dispatchEvent(new w.Event('change', { bubbles: true }));
    if (!tr.classList.contains('reviewed')) throw new Error('行没有变灰');
    const tag = tr.querySelector('.rvTag');
    if (!tag || tag.style.display === 'none') throw new Error('没有显示已复核标签');
  });
  t('统计与提示里的已复核数跟着变', () => {
    const b = $('rvStat').querySelector('b').textContent;
    if (b !== '1/' + d.querySelectorAll('#checkOut tr.fail').length) throw new Error('tile=' + b);
    if ($('resHint').textContent.indexOf('已复核 1 /') < 0) throw new Error($('resHint').textContent);
    const chip = d.querySelector('#checkOut .hd .badge.rev');
    if (!chip || chip.textContent.indexOf('复核 1/') < 0) throw new Error('分组标记=' + (chip && chip.textContent));
  });
  t('重新渲染后勾选状态保留', () => {
    w.eval('renderResults()');
    const checked = d.querySelectorAll('#checkOut .rvwBox:checked').length;
    if (checked !== 1) throw new Error('checked=' + checked);
    const tr = d.querySelector('#checkOut tr.reviewed');
    if (!tr) throw new Error('没有变灰的行');
  });
  t('取消勾选后恢复原状', () => {
    const box = d.querySelector('#checkOut .rvwBox:checked');
    box.checked = false;
    box.dispatchEvent(new w.Event('change', { bubbles: true }));
    if (d.querySelector('#checkOut tr.reviewed')) throw new Error('还有灰行');
    const b = $('rvStat').querySelector('b').textContent;
    if (b[0] !== '0') throw new Error('tile=' + b);
  });
  t('清空复核标记按钮可用', () => {
    const box = d.querySelector('#checkOut .rvwBox');
    box.checked = true;
    box.dispatchEvent(new w.Event('change', { bubbles: true }));
    $('btnClearReview').click();
    if (d.querySelector('#checkOut .rvwBox:checked')) throw new Error('没有清空');
  });

  console.log('== ④ 检查结果的筛选按钮 ==');
  $('tabs').querySelector('[data-tab="result"]').click();
  function renderedGroups(){ return d.querySelectorAll('#checkOut .set').length; }
  function renderedRows(){ return d.querySelectorAll('#checkOut tbody tr[data-rk]').length; }
  t('回到样本数据（含不符合）', () => {
    w.__sampleTxt = sampleTxt;
    w.eval("S.sets=" + JSON.stringify(rules) + "; UI.items=CopperCheck.parseBoardItems(window.__sampleTxt); UI.resFilter=''; UI.onlyBad=false; UI.reviewed={}; runCheck(true); renderResults();");
    if (renderedGroups() !== 1) throw new Error('组数 ' + renderedGroups());
  });
  t('三个筛选按钮都在', () => {
    ['btnOnlyBad','btnOnlyMatched','btnOnlyNoRule','btnAllRows'].forEach(id => { if (!$(id)) throw new Error('缺 ' + id); });
  });
  t('只看不符合：只留不符合行，按钮高亮', () => {
    $('btnOnlyBad').click();
    if (renderedRows() !== 1) throw new Error('行数 ' + renderedRows());
    if (!$('btnOnlyBad').classList.contains('on')) throw new Error('按钮没高亮');
    if ($('resHint').textContent.indexOf('只显示不符合项') < 0) throw new Error($('resHint').textContent);
  });
  t('只看已配对过孔：只留已配对的过孔组', () => {
    $('btnOnlyMatched').click();
    if (renderedGroups() !== 1) throw new Error('组数 ' + renderedGroups());
    if (renderedRows() !== 4) throw new Error('行数 ' + renderedRows());
    if ($('resHint').textContent.indexOf('只看已配对过孔') < 0) throw new Error($('resHint').textContent);
  });
  t('只看没推算到约束：有 BGA-L19 规则时为空', () => {
    $('btnOnlyNoRule').click();
    if (renderedGroups() !== 0) throw new Error('组数 ' + renderedGroups());
    if ($('checkOut').innerHTML.indexOf('筛完没有记录') < 0) throw new Error('没有空提示');
  });
  t('换成不匹配的规则后，只看没推算到约束能筛出这组', () => {
    w.eval("S.sets=" + JSON.stringify([{kind:'SMA',title:'Top-SMA-L19-D2M6mil',fanLayer:19,constraints:[]}]) + "; runCheck(true); UI.resFilter='norule'; UI.onlyBad=false; renderResults();");
    if (renderedGroups() !== 1) throw new Error('组数 ' + renderedGroups());
    if (renderedRows() !== 4) throw new Error('行数 ' + renderedRows());
    if ($('checkOut').innerHTML.indexOf('未推算到') < 0) throw new Error('组头没写未推算到');
  });
  t('点「没推算到约束」方块也能筛选', () => {
    w.eval("S.sets=" + JSON.stringify(rules) + "; runCheck(true); UI.resFilter=''; UI.onlyBad=false; renderResults();");
    $('btnOnlyBad').click(); $('btnOnlyBad').click(); // 确保全部
    if (renderedGroups() !== 1) throw new Error('准备状态不对 ' + renderedGroups());
    let tile = d.querySelector('#resStats .stat.click[data-res="norule"]');
    if (!tile) throw new Error('没有可点的方块');
    tile.click();
    if (renderedGroups() !== 0) throw new Error('应该筛空，实际 ' + renderedGroups());
    if (!d.querySelector('#resStats .stat.click[data-res="norule"]').classList.contains('on')) throw new Error('方块没高亮');
    tile = d.querySelector('#resStats .stat.click[data-res="norule"]');
    tile.click();
    if (renderedGroups() !== 1) throw new Error('再点没取消，组数 ' + renderedGroups());
  });
  t('点「不符合」方块也能筛选', () => {
    const tile = d.querySelector('#resStats .stat.click[data-res="bad"]');
    if (!tile) throw new Error('没有可点的方块');
    tile.click();
    if (renderedRows() !== 1) throw new Error('行数 ' + renderedRows());
    $('btnAllRows').click();
    if (renderedRows() !== 4) throw new Error('全部后行数 ' + renderedRows());
    if (d.querySelector('#resStats .stat.click.on')) throw new Error('还有方块高亮');
  });

  console.log('== 底部判定规律与分布 ==');
  t('规律卡片渲染在 ⑤ 规律分析页，且不在结果页里', () => {
    $('tabs').querySelector('[data-tab="result"]').click();
    w.__sampleTxt = sampleTxt;
    w.eval("S.sets=" + JSON.stringify(rules) + "; UI.items=CopperCheck.parseBoardItems(window.__sampleTxt); UI.resFilter=''; UI.onlyBad=false; runCheck(true); renderResults();");
    $('tabs').querySelector('[data-tab="legend"]').click();
    const h = $('legendOut').innerHTML;
    if (!h) throw new Error('没有渲染');
    ['铜皮 × 过孔 怎么配对','怎么推算该用哪条约束','每一层怎么判','各约束下不符合的具体原因展开明细','没推算到约束的分布','未配对铜皮'].forEach(x => {
      if (h.indexOf(x) < 0) throw new Error('缺小节：' + x);
    });
    if ($('tab-result').querySelector('#legendOut')) throw new Error('结果页还挂着规律卡片');
    $('tabs').querySelector('[data-tab="legend"]').click();
    if (activeTab() !== 'tab-legend') throw new Error('没切到 ⑤ 页：' + activeTab());
    if (!$('tab-legend').querySelector('#legendOut')) throw new Error('⑤ 页没有规律内容');
    const h2 = $('tab-legend').innerHTML;
    if (h2.indexOf('判定规律与当前分布') < 0) throw new Error('⑤ 页缺标题');
  });
  t('写明位置/数值容差和配对条件', () => {
    w.eval("renderLegend(true)");
    const h = $('legendOut').innerHTML;
    if (h.indexOf('0.05 mil') < 0) throw new Error('没写位置容差');
    if (h.indexOf('0.01 mil') < 0) throw new Error('没写数值容差');
    if (h.indexOf('_L2pad_') < 0) throw new Error('没写 _L2pad_ 不算出线层');
  });
  t('不符合分布按约束 + 检查项汇总', () => {
    w.eval("renderLegend(true)");
    const h = $('legendOut').innerHTML;
    if (h.indexOf('BGA-L19 · 反焊盘尺寸') < 0) throw new Error('缺汇总行');
    if (h.indexOf('共 1 条') < 0) throw new Error('条数不对');
  });
  t('没推算到约束时列出 Padstack 和候选', () => {
    w.eval("S.sets=" + JSON.stringify([{kind:'SMA',title:'Top-SMA-L19-D2M6mil',fanLayer:19,constraints:[]}]) + "; runCheck(true); renderLegend(true);");
    const h = $('legendOut').innerHTML;
    if (h.indexOf('BGA_3510_L19_ring3mil_L2pad_0907') < 0) throw new Error('没列出 Padstack');
    if (h.indexOf('个过孔') < 0) throw new Error('没写个数');
    if (h.indexOf('没有同封装的约束可选') < 0 && h.indexOf('候选') < 0) throw new Error('没写原因/候选');
  });
  t('未配对铜皮列出最近过孔和距离', () => {
    const mix2 = [
      'Total 2 Items','',
      'Item 1                < Shape >','','  Set:                Route Keepout','  Subset:             07IS03','',
      '  Type:               Shape(Static)','','Exterior Boundary:',
      '  Arc seg: xy [290.0000, 300.0000]  xy [290.0000, 300.0000] Width (0.0000)',
      '    Center-xy:  [300.0000, 300.0000] Radius (9.0000) CCW','~~~~~~~~~~~~~~~~~~~~~~~~~','',
      'Item 2                < Via >','','  Origin-xy:          [100.0000, 100.0000]','  Net:                63_N','',
      '  Padstack Name:      SMA_Bot-L19_d2m6mil_via-0902','~~~~~~~~~~~~~~~~~~~~~~~~~','',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~End~ ~ ~ ~ ~ ~ ~ ~ ~ ~'].join('\n');
    w.__mix2 = mix2;
    w.eval("UI.items=CopperCheck.parseBoardItems(window.__mix2); UI.resFilter=''; runCheck(true); renderLegend(true);");
    const h = $('legendOut').innerHTML;
    if (h.indexOf('Via 2') < 0) throw new Error('没写最近过孔');
    if (h.indexOf('还差') < 0) throw new Error('没写差多少才配上');
    const near = w.eval('(function(){const u=UI.result.unmatchedCircles[0];return {d:u.nearest.dist, id:u.nearest.viaId};})()');
    if (Math.abs(near.d - Math.sqrt(80000)) > 1e-6) throw new Error('距离算错 ' + near.d);
  });
  t('没有未配对铜皮时给一句提示', () => {
    w.__sampleTxt = sampleTxt;
    w.eval("UI.items=CopperCheck.parseBoardItems(window.__sampleTxt); runCheck(true); renderLegend(true);");
    if ($('legendOut').innerHTML.indexOf('本次所有圆形铜皮都配到了过孔') < 0) throw new Error('缺提示');
  });

  console.log('== Padstack 关键字提取（多段层号 / Bot / L19 / D2M） ==');
  function oneViaCase(padstack, setsJson, traceLayer){
    const txt = 'Total 2 Items\n\nItem 1                < Shape >\n\n  Set:                Route Keepout\n  Subset:             Top\n\n  Type:               Shape(Static)\n\nExterior Boundary:\n  Arc seg: xy [88.6100, 100.0000]  xy [88.6100, 100.0000] Width (0.0000)\n    Center-xy:  [100.0000, 100.0000] Radius (11.3900) CCW\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n\nItem 2                < Via >\n\n  Origin-xy:          [100.0000, 100.0000]\n  Net:                1_N\n\n  Padstack Name:      ' + padstack + '\n  Usage:              BBVia\n\n  Connections:        \n    Trace:            2 (' + (traceLayer || 'L19') + ')\n\n~ ~ ~ ~ ~ ~ ~ ~ ~ ~End~ ~ ~ ~ ~ ~ ~ ~ ~ ~\n';
    w.__one = txt;
    w.eval('S.sets=' + setsJson + '; UI.items=CopperCheck.parseBoardItems(window.__one); UI.resFilter=""; UI.onlyBad=false; runCheck(true);');
    return w.eval('(function(){const g=UI.result.groups[0];return {rule:g.rule&&g.rule.title, cands:g.candidates, keys:g.keys, note:g.note, rows:g.rows.map(r=>"L"+r.layer+":"+r.status+":"+r.actual+"/"+(r.expect||"-"))};})()');
  }
  const bgaRules = JSON.stringify([
    {kind:'BGA',title:'BGA-L8',fanLayer:8,constraints:[{cat:'反焊盘尺寸',name:'反焊盘半径',unit:'mil',values:{L1:'11.39',L8:'5.2'}}]},
    {kind:'BGA',title:'BGA-L2',fanLayer:2,constraints:[{cat:'反焊盘尺寸',name:'反焊盘半径',unit:'mil',values:{L1:'7'}}]}
  ]);

  t('BGA_3510_l2-L8_Ring3mil_0902 → 出线层取 L8，映射到 BGA-L8', () => {
    const g = oneViaCase('BGA_3510_l2-L8_Ring3mil_0902', bgaRules, 'L8');
    if (g.rule !== 'BGA-L8') throw new Error('选到 ' + g.rule);
    if (JSON.stringify(g.keys.fans) !== '[2,8]') throw new Error('层号候选 ' + JSON.stringify(g.keys.fans));
    if (g.keys.ring !== '3') throw new Error('ring ' + g.keys.ring);
    if (g.rows.indexOf('L1:符合:11.39/11.39') < 0) throw new Error(JSON.stringify(g.rows));
    if (g.note.indexOf('出线层 L8 与走线一致') < 0) throw new Error('备注 ' + g.note);
  });
  t('l13-L8 这种也取出线层 L8，不是 13', () => {
    const k = w.eval("(function(){const k=CopperCheck.padKeys('BGA_3510_l13-L8_Ring3mil_0902');const s=CopperCheck.selectRule(" + JSON.stringify([{kind:'BGA',title:'BGA-L8',fanLayer:8,constraints:[]}]) + ", k);return {fan:k.fan, fans:k.fans, rule:s.rule&&s.rule.title};})()");
    if (k.fan !== 8 || k.rule !== 'BGA-L8') throw new Error(JSON.stringify(k));
  });
  t('范围写法 L8-L12 → 取出线层 L12（范围末端）', () => {
    const sets = JSON.stringify([{kind:'BGA',title:'BGA-L12',fanLayer:12,constraints:[]}]);
    const k = w.eval("(function(){const ks=CopperCheck.padKeys('BGA_3510_L8-L12_Ring3mil');const s=CopperCheck.selectRule(" + sets + ", ks);return {fans:ks.fans, rule:s.rule&&s.rule.title, fan:s.fan};})()");
    if (JSON.stringify(k.fans) !== '[8,12]' || k.rule !== 'BGA-L12') throw new Error(JSON.stringify(k));
  });
  t('并列写法 L8_L12 → 同分取靠后的层号 L12', () => {
    const sets = JSON.stringify([{kind:'BGA',title:'BGA-L8',fanLayer:8,constraints:[]},{kind:'BGA',title:'BGA-L12',fanLayer:12,constraints:[]}]);
    const k = w.eval("(function(){const ks=CopperCheck.padKeys('BGA_3510_L8_L12_Ring3mil');const s=CopperCheck.selectRule(" + sets + ", ks);return {fans:ks.fans, rule:s.rule&&s.rule.title, fan:s.fan};})()");
    if (JSON.stringify(k.fans) !== '[8,12]') throw new Error('层号候选 ' + JSON.stringify(k.fans));
    if (k.rule !== 'BGA-L12') throw new Error('同分应取靠后的层号，实际选到 ' + JSON.stringify(k));
  });
  t('SMA_Bot-L19_d2m6mil_via-0902 → Bot / L19 / D2M6 选到 Bot-SMA-L19-D2M6mil', () => {
    const g = oneViaCase('SMA_Bot-L19_d2m6mil_via-0902', JSON.stringify([
      {kind:'SMA',title:'Bot-SMA-L19-D2M6mil',fanLayer:19,constraints:[{cat:'反焊盘尺寸',name:'反焊盘半径',unit:'mil',values:{L1:'11.39'}}]}
    ]), 'L19');
    if (g.rule !== 'Bot-SMA-L19-D2M6mil') throw new Error('选到 ' + g.rule);
    if (g.keys.side !== 'Bot' || g.keys.d2m !== '6') throw new Error(JSON.stringify(g.keys));
    if (g.rows.indexOf('L1:符合:11.39/11.39') < 0) throw new Error(JSON.stringify(g.rows));
  });
  t('BGA_3510_L19_ring3mil_L2pad_0907 → _L2pad_ 不算层号', () => {
    const k = w.eval("(function(){const k=CopperCheck.padKeys('BGA_3510_L19_ring3mil_L2pad_0907');return {fan:k.fan, fans:k.fans, ring:k.ring};})()");
    if (k.fan !== 19 || k.fans.length !== 1 || k.ring !== '3') throw new Error(JSON.stringify(k));
  });
  t('BGA_GND_pad1mil_0902 没有层号，不硬套规则只给候选', () => {
    const g = oneViaCase('BGA_GND_pad1mil_0902', bgaRules, 'L8');
    if (g.rule) throw new Error('不该选到 ' + g.rule);
    if (!g.cands.length || g.cands.indexOf('BGA-L8') < 0) throw new Error('候选 ' + JSON.stringify(g.cands));
    if (g.rows.some(r => r.indexOf('未选规则') >= 0) === false) throw new Error(JSON.stringify(g.rows));
  });
  t('匹配表里显示提取到的 Bot / L19 / D2M6', () => {
    oneViaCase('SMA_Bot-L19_d2m6mil_via-0902', JSON.stringify([
      {kind:'SMA',title:'Bot-SMA-L19-D2M6mil',fanLayer:19,constraints:[{cat:'反焊盘尺寸',name:'反焊盘半径',unit:'mil',values:{L1:'11.39'}}]}
    ]), 'L19');
    $('tabs').querySelector('[data-tab="data"]').click();
    w.eval('renderMatch()');
    const h = $('matchOut').innerHTML;
    if (h.indexOf('SMA / Bot / L19 / D2M6') < 0) throw new Error('提取列没写全');
    if (h.indexOf('Bot-SMA-L19-D2M6mil') < 0) throw new Error('推算的约束没显示');
  });
  t('底部规律写明 l2-L8 取 L8、_L2pad_ 不算', () => {
    w.eval('renderLegend(true)');
    const h = $('legendOut').innerHTML;
    if (h.indexOf('l2-L8') < 0 || h.indexOf('_L2pad_') < 0) throw new Error('规律没写这两种例外');
  });

  console.log('== TXT 里 “/” 与 “，” 都算层号列表分隔符 ==');
  function loadSample(file){
    const txt = fs.readFileSync(path.join(dir, 'sample/' + file), 'utf8');
    w.__s2 = txt;
    w.eval("S.queue=[{id:1, name:" + JSON.stringify(file) + ", text:window.__s2, enc:'UTF-8', status:''}]; S.sets=[]; rebuild();");
  }
  function consOf(si, ci){
    return w.eval("(function(){const c=S.sets[" + si + "].constraints[" + ci + "];return {name:c.name, cat:c.cat, values:c.values, sources:c.sources};})()");
  }
  setTimeout(() => {
    loadSample('L15层扇出SMA.txt');
    t('示例解析出约束 Bot-SMA-L15，叠层识别到 L21', () => {
      const info = w.eval("(function(){const s=S.sets[0];return {n:layerCount(), title:s.title, fan:fanLayerOf(s), cons:(s.constraints||[]).map(c=>c.cat+'/'+c.name)};})()");
      if (info.n !== 21) throw new Error('叠层 ' + info.n);
      if (info.title !== 'Bot-SMA-L15') throw new Error('标题 ' + info.title);
      if (info.fan !== 15) throw new Error('出线层 ' + info.fan);
      console.log('        ' + info.cons.join(' | '));
    });
    t('L20/L19/L18/L17 展开成四层，值 8.46', () => {
      const c = consOf(0, 0);
      const want = { L20: '8.46', L19: '8.46', L18: '8.46', L17: '8.46' };
      Object.keys(want).forEach(k => { if (c.values[k] !== want[k]) throw new Error(k + '=' + c.values[k]); });
      if (c.values.L16 !== '9' || c.values.L21 !== '13') throw new Error('L16/L21 ' + JSON.stringify(c.values));
    });
    t('L21，L16 用逗号分隔也识别（L21=13 来自 bottom，L16=9）', () => {
      const c = consOf(0, 0);
      if (c.values.L16 !== '9') throw new Error('L16 ' + c.values.L16);
      if (c.values.L21 !== '13') throw new Error('L21 ' + c.values.L21);
      if (c.sources.L16.indexOf('L21，L16') < 0) throw new Error('来源 ' + c.sources.L16);
    });
    t('L15及以上 → L1..L15 都是 11.39', () => {
      const c = consOf(0, 0);
      for (let i = 1; i <= 15; i++) if (c.values['L' + i] !== '11.39') throw new Error('L' + i + '=' + c.values['L' + i]);
      if (c.values.L16 !== '9') throw new Error('L16 不该被 及以上 覆盖：' + c.values.L16);
    });
    t('bottom 层 = 最底层 L21', () => {
      const pad = consOf(0, 1);
      if (pad.values.L21 !== '6.5') throw new Error('焊盘 bottom ' + JSON.stringify(pad.values));
    });
    t('扇出走线层落在 L15 = 3.46', () => {
      const pad = consOf(0, 1);
      if (pad.values.L15 !== '3.46') throw new Error('L15 ' + pad.values.L15);
    });
    t('L19/L18/L17层非功能焊盘半径 单独成一条 非功能 约束', () => {
      const info = w.eval("(function(){const s=S.sets[0];return s.constraints.map(c=>({cat:c.cat,name:c.name,vals:c.values}));})()");
      const nf = info.find(c => c.name.indexOf('非功能') >= 0);
      if (!nf) throw new Error('没有非功能约束：' + JSON.stringify(info.map(c=>c.name)));
      ['L19', 'L18', 'L17'].forEach(k => { if (nf.vals[k] !== '3.46') throw new Error(k + '=' + nf.vals[k]); });
      if (nf.vals.L20) throw new Error('L20 不该有非功能值');
    });
    t('规则表里每一格都写了来源', () => {
      const c = consOf(0, 2);
      Object.keys(c.values).forEach(k => { if (!c.sources[k]) throw new Error(k + ' 没有来源'); });
    });
  }, 400);

  console.log('== ④ 按约束筛选（约束名称 chip） ==');
  const twoRules = [
    {kind:'SMA',title:'Top-SMA-L8-D2M6mil',fanLayer:8,constraints:[{cat:'反焊盘尺寸',name:'反焊盘半径',unit:'mil',values:{L1:'13'}}]},
    {kind:'BGA',title:'BGA-L19',fanLayer:19,constraints:[{cat:'反焊盘尺寸',name:'反焊盘半径',unit:'mil',values:{L1:'17'}}]}
  ];
  const mixTxt = [
    'Total 8 Items','',
    'Item 1                < Shape >','','  Set:                Route Keepout','  Subset:             Top','',
    '  Type:               Shape(Static)','','Exterior Boundary:',
    '  Arc seg: xy [95.0000, 100.0000]  xy [95.0000, 100.0000] Width (0.0000)',
    '    Center-xy:  [100.0000, 100.0000] Radius (13.0000) CCW','~~~~~~~~~~~~~~~~~~~~~~~~~','',
    'Item 2                < Via >','','  Origin-xy:          [100.0000, 100.0000]','  Net:                11_N','',
    '  Padstack Name:      SMA_Top-L8_d2m6mil_via-0902','~~~~~~~~~~~~~~~~~~~~~~~~~','',
    'Item 3                < Shape >','','  Set:                Route Keepout','  Subset:             Top','',
    '  Type:               Shape(Static)','','Exterior Boundary:',
    '  Arc seg: xy [195.0000, 200.0000]  xy [195.0000, 200.0000] Width (0.0000)',
    '    Center-xy:  [200.0000, 200.0000] Radius (12.0000) CCW','~~~~~~~~~~~~~~~~~~~~~~~~~','',
    'Item 4                < Via >','','  Origin-xy:          [200.0000, 200.0000]','  Net:                12_N','',
    '  Padstack Name:      BGA_3510_L19_ring3mil_L2pad_0907','~~~~~~~~~~~~~~~~~~~~~~~~~','',
    'Item 5                < Shape >','','  Set:                Route Keepout','  Subset:             07IS03','',
    '  Type:               Shape(Static)','','Exterior Boundary:',
    '  Arc seg: xy [295.0000, 300.0000]  xy [295.0000, 300.0000] Width (0.0000)',
    '    Center-xy:  [300.0000, 300.0000] Radius (10.0000) CCW','~~~~~~~~~~~~~~~~~~~~~~~~~','',
    'Item 6                < Via >','','  Origin-xy:          [300.0000, 300.0000]','  Net:                13_N','',
    '  Padstack Name:      BGA_GND_pad1mil_0902','  Usage:              BBVia','~~~~~~~~~~~~~~~~~~~~~~~~~','',
    '~ ~ ~ ~ ~ ~ ~ ~ ~ ~End~ ~ ~ ~ ~ ~ ~ ~ ~ ~'].join('\n');
  function chipTexts(){ return [...d.querySelectorAll('#resChips .chip')].map(c => c.dataset.rule); }
  function chipOf(rule){ return [...d.querySelectorAll('#resChips .chip')].find(c => c.dataset.rule === rule); }
  function groupsShown(){ return d.querySelectorAll('#checkOut .set').length; }

  t('约束 chip 全部列出（含结果为 0 的 BGA-L19 之外的规则）', () => {
    w.__mix3 = mixTxt;
    w.eval("S.sets=" + JSON.stringify(twoRules) + "; UI.items=CopperCheck.parseBoardItems(window.__mix3); UI.resFilter=''; UI.resRule=''; UI.onlyBad=false; UI.resLimit=1000; runCheck(true); renderResults();");
    const t = chipTexts();
    if (!t.length) throw new Error('没有 chip');
    if (t.indexOf('Top-SMA-L8-D2M6mil') < 0) throw new Error('缺 Top-SMA-L8-D2M6mil：' + t.join('|'));
    if (t.indexOf('BGA-L19') < 0) throw new Error('缺 BGA-L19：' + t.join('|'));
    if (t.indexOf('未推算到约束') < 0) throw new Error('缺未推算到约束：' + t.join('|'));
    console.log('        ' + t.join(' / '));
  });
  t('点一个约束 → 只留该约束的过孔卡片', () => {
    const chip = chipOf('Top-SMA-L8-D2M6mil');
    chip.click();
    if (groupsShown() !== 1) throw new Error('卡片数 ' + groupsShown());
    if ($('checkOut').innerHTML.indexOf('SMA_Top-L8_d2m6mil_via-0902') < 0) throw new Error('留错了卡片');
    if ($('checkOut').innerHTML.indexOf('BGA_3510_L19') >= 0) throw new Error('BGA 的卡片没被筛掉');
    if ($('resHint').textContent.indexOf('只看约束 Top-SMA-L8-D2M6mil') < 0) throw new Error('提示没写：' + $('resHint').textContent);
    const on = d.querySelector('#resChips .chip.on');
    if (!on || on.dataset.rule !== 'Top-SMA-L8-D2M6mil') throw new Error('chip 没高亮');
  });
  t('再点同一个 chip → 取消，回到全部', () => {
    const chip = chipOf('Top-SMA-L8-D2M6mil');
    chip.click();
    if (groupsShown() !== 3) throw new Error('卡片数 ' + groupsShown());
    if (d.querySelector('#resChips .chip.on')) throw new Error('还有高亮 chip');
  });
  t('chip 与「只看不符合」可以叠加', () => {
    const chip = chipOf('Top-SMA-L8-D2M6mil');
    chip.click();
    $('btnOnlyBad').click();
    if (groupsShown() !== 0) throw new Error('L1 13 对 13 是符合的，应该没有卡片，实际 ' + groupsShown());
    if ($('resHint').textContent.indexOf('只看约束 Top-SMA-L8-D2M6mil + 只显示不符合项') < 0) throw new Error($('resHint').textContent);
    $('btnAllRows').click();
    if (w.eval('UI.resRule')) throw new Error('「全部」没清掉约束筛选');
    if (groupsShown() !== 3) throw new Error('「全部」后卡片数 ' + groupsShown());
  });
  t('点「未推算到约束」chip → 只留没推算到的那组', () => {
    const chip = chipOf('未推算到约束');
    chip.click();
    if (groupsShown() !== 1) throw new Error('卡片数 ' + groupsShown());
    if ($('checkOut').innerHTML.indexOf('BGA_GND_pad1mil_0902') < 0) throw new Error('留错了卡片');
    chip.click();
  });
  t('CSV 导出跟随约束筛选', () => {
    const chip = chipOf('Top-SMA-L8-D2M6mil');
    chip.click();
    $('btnCsv').click();
    const box = d.querySelector('#expMask textarea');
    const text = box ? box.value : '';
    const lines = text.split('\n');
    if (lines.length !== 3) throw new Error('行数 ' + lines.length);
    if (lines[1].indexOf('Top-SMA-L8-D2M6mil') < 0 && lines[2].indexOf('Top-SMA-L8-D2M6mil') < 0) throw new Error('导出内容不对');
    chip.click();
    const mask = d.getElementById('expMask'); if (mask) mask.style.display = 'none';
  });

  console.log('== 约束筛选条的分组与排序 ==');
  t('chipMeta 正确分组', () => {
    const g = w.eval("['BGA-L19','Top-SMA-L4-D2M6mil','Bot-SMA-L19-D2M6mil','SMA-L19-D2M5mil','','其他约束'].map(function(n){return chipMeta(n).group;})");
    const want = ['BGA', 'SMA · Top 面', 'SMA · bottom 面', 'SMA · 未标面', '未推算到约束', '其他'];
    if (JSON.stringify(g) !== JSON.stringify(want)) throw new Error(JSON.stringify(g));
  });
  t('组内按层号从大到小、0 计数排最后', () => {
    const order = w.eval(`(function(){
      const names=['Top-SMA-L2-D2M6mil','Top-SMA-L4-D2M6mil','Top-SMA-L10-D2M6mil','Top-SMA-L8-D2M6mil','Top-SMA-L6-D2M6mil','Top-SMA-L4-D2M5mil'];
      const map={}; names.forEach((n,i)=>map[n]={n: i===5?0:10, title:n});
      return orderChips(names, map).map(m=>m.name);
    })()`);
    const want = ['Top-SMA-L10-D2M6mil','Top-SMA-L8-D2M6mil','Top-SMA-L6-D2M6mil','Top-SMA-L4-D2M6mil','Top-SMA-L2-D2M6mil','Top-SMA-L4-D2M5mil'];
    if (JSON.stringify(order) !== JSON.stringify(want)) throw new Error(order.join(' | '));
  });
  t('渲染出来的顺序：BGA → Top → bottom → 未标面 → 未推算到约束（最后）', () => {
    const out = w.eval(`(function(){
      const names=['Bot-SMA-L19-D2M6mil','Top-SMA-L2-D2M6mil','BGA-L19','BGA-L8','SMA-L19-D2M5mil','Top-SMA-L4-D2M6mil','Bot-SMA-L13-D2M6mil','BGA-L17','Top-SMA-L10-D2M6mil'];
      S.sets=names.map(n=>({title:n}));
      UI.result={groups:names.map(n=>({rows:[{}], rule:{title:n}, failRows:[], failCount:0})).concat([{rows:[{}], rule:null, failRows:[], failCount:0}]),
        unmatchedCircles:[], polygons:[], viaCount:names.length, circleCount:names.length, maxLayer:21};
      UI.resRule='';
      renderChips();
      return {chips:[...document.querySelectorAll('#resChips .chip')].map(c=>c.dataset.rule),
              cols:[...document.querySelectorAll('#resChips .chipcol-h')].map(c=>c.textContent.trim()),
              subs:[...document.querySelectorAll('#resChips .chipcol')].map(c=>[...c.querySelectorAll('.chipsub')].map(x=>x.textContent)),
              labels:[...document.querySelectorAll('#resChips .chip .cl')].map(c=>c.textContent)};
    })()`);
    const wantOrder = ['BGA-L19','BGA-L17','BGA-L8','Top-SMA-L10-D2M6mil','Top-SMA-L4-D2M6mil','Top-SMA-L2-D2M6mil','Bot-SMA-L19-D2M6mil','Bot-SMA-L13-D2M6mil','SMA-L19-D2M5mil','未推算到约束'];
    if (JSON.stringify(out.chips) !== JSON.stringify(wantOrder)) throw new Error(out.chips.join(' | '));
    const wantCols = ['BGA','SMA · Top 面','SMA · bottom 面','SMA · 未标面','未推算到约束'];
    const gotCols = out.cols.map(x => x.replace(/\s*\d+$/, ''));
    if (JSON.stringify(gotCols) !== JSON.stringify(wantCols)) throw new Error(gotCols.join(' | '));
    console.log('        列: ' + out.cols.join(' | '));
    console.log('        条目: ' + out.labels.join(' / '));
  });
  t('点分组里的任意 chip 仍能筛选（BGA-L8）', () => {
    w.eval("S.sets=" + JSON.stringify(rules) + "; UI.items=CopperCheck.parseBoardItems(window.__sampleTxt); UI.resRule=''; UI.resFilter=''; UI.resLimit=1000; runCheck(true); renderResults();");
    const chip = chipOf('BGA-L19');
    if (!chip) throw new Error('没有 BGA-L19 chip');
    chip.click();
    if (d.querySelectorAll('#checkOut .set').length !== 1) throw new Error('筛选失败');
    const back = chipOf('BGA-L19');
    back.click();
    if (d.querySelectorAll('#checkOut .set').length !== 1) throw new Error('取消后应回到样本那 1 组');
  });

  console.log('== 约束筛选条 列式布局 ==');
  t('一列一个封装/面，列标题带合计', () => {
    const cols = w.eval("(function(){const names=['BGA-L19','BGA-L17','Top-SMA-L4-D2M6mil','Top-SMA-L2-D2M6mil','Bot-SMA-L19-D2M6mil','SMA-L19-D2M5mil'];"
      + "S.sets=names.map(n=>({title:n}));"
      + "UI.result={groups:names.map(n=>({rows:[{}],rule:{title:n},failRows:[],failCount:0})).concat([{rows:[{}],rule:null,failRows:[],failCount:0}]),unmatchedCircles:[],polygons:[],viaCount:0,circleCount:0,maxLayer:21};"
      + "UI.resRule=''; renderChips();"
      + "return {cols:[...document.querySelectorAll('#resChips .chipcol-h')].map(x=>x.textContent.trim()), labels:[...document.querySelectorAll('#resChips .chip .cl')].map(x=>x.textContent)};})()");
    if (cols.cols.length !== 5) throw new Error('列数 ' + cols.cols.length + ' ' + cols.cols.join('|'));
    if (JSON.stringify(cols.labels) !== JSON.stringify(['L19','L17','L4','L2','L19','L19','未推算到约束'])) throw new Error(cols.labels.join(' '));
    const wantCols = ['BGA 2','SMA · Top 面 2','SMA · bottom 面 1','SMA · 未标面 1','未推算到约束 1'];
    if (JSON.stringify(cols.cols) !== JSON.stringify(wantCols)) throw new Error('列标题 ' + cols.cols.join('|'));
  });
  t('同一列里 D2M 分小标题，块内层号从大到小，未标 D2M 排最后', () => {
    const info = w.eval(`(function(){
      const names=['Top-SMA-L4-D2M6mil','Top-SMA-L8-D2M6mil','Top-SMA-L2-D2M5mil','Top-SMA-L6-D2M5mil','Top-SMA-L3'];
      S.sets=names.map(n=>({title:n}));
      UI.result={groups:names.map(n=>({rows:[{}],rule:{title:n},failRows:[],failCount:0})),unmatchedCircles:[],polygons:[],viaCount:0,circleCount:0,maxLayer:21};
      UI.resRule=''; renderChips();
      const col=[...document.querySelectorAll('#resChips .chipcol')].find(c=>c.querySelector('.chipcol-h').textContent.indexOf('SMA · Top 面')===0);
      if(!col)throw new Error('没有 Top 面那一列');
      return {seq:[...col.children].filter(ch=>!ch.classList.contains('chipcol-h'))
        .map(ch=>ch.classList.contains('chipsub')?('#'+ch.textContent):ch.querySelector('.cl').textContent)};
    })()`);
    const want = ['#D2M6mil','L8','L4','#D2M5mil','L6','L2','#未标 D2M','L3'];
    if (JSON.stringify(info.seq) !== JSON.stringify(want)) throw new Error(info.seq.join(' > '));
    console.log('        ' + info.seq.join(' > '));
  });
  t('列里的条目仍可点击筛选，且选中态落在正确的条目上', () => {
    w.eval("S.sets=" + JSON.stringify(rules) + "; UI.items=CopperCheck.parseBoardItems(window.__sampleTxt); UI.resRule=''; UI.resLimit=1000; runCheck(true); renderResults();");
    const chip = [...d.querySelectorAll('#resChips .chip')].find(c => c.dataset.rule === 'BGA-L19');
    if (!chip) throw new Error('没有 BGA-L19');
    chip.click();
    const on = [...d.querySelectorAll('#resChips .chip.on')].map(c => c.dataset.rule);
    if (JSON.stringify(on) !== JSON.stringify(['BGA-L19'])) throw new Error('选中态 ' + JSON.stringify(on));
    if (d.querySelectorAll('#checkOut .set').length !== 1) throw new Error('筛选结果不对');
    const back = [...d.querySelectorAll('#resChips .chip')].find(c => c.dataset.rule === 'BGA-L19');
    back.click();
  });

  console.log('== ② 约束指引 列式布局 ==');
  t('指引条按封装/面分列，列内按 D2M、层号排序', () => {
    const out = w.eval(`(function(){
      const titles=['Top-SMA-L2-D2M6mil','Top-SMA-L4-D2M5mil','Bot-SMA-L19-D2M6mil','Bot-SMA-L17-D2M6mil','Top-SMA-L8-D2M6mil',
        'Bot-SMA-L15-D2M6mil','BGA-L17','BGA-L19','BGA-L8','BGA-L15','Top-SMA-L4-D2M6mil','Bot-SMA-L13-D2M6mil',
        'Top-SMA-L10-D2M6mil','Top-SMA-L6-D2M6mil','SMA-L19-D2M5mil'];
      S.sets=titles.map(t=>({kind:/BGA/.test(t)?'BGA':'SMA', title:t, constraints:[]}));
      reexpandAll(); renderJump();
      return {
        cols:[...document.querySelectorAll('#jumpNav .jumpcol-h')].map(h=>h.textContent.trim()),
        seq:[...document.querySelectorAll('#jumpNav .jumpcol')].map(function(c){
          return [...c.children].filter(ch=>!ch.classList.contains('jumpcol-h')).map(function(ch){
            return ch.classList.contains('chipsub')?('#'+ch.textContent):ch.querySelector('.jname').textContent;
          });
        })
      };
    })()`);
    const wantCols = ['BGA 4','SMA · Top 面 6','SMA · bottom 面 4','SMA · 未标面 1'];
    if (JSON.stringify(out.cols) !== JSON.stringify(wantCols)) throw new Error(out.cols.join(' | '));
    const top = out.seq[1];
    const wantTop = ['#D2M6mil','Top-SMA-L10-D2M6mil','Top-SMA-L8-D2M6mil','Top-SMA-L6-D2M6mil','Top-SMA-L4-D2M6mil','Top-SMA-L2-D2M6mil','#D2M5mil','Top-SMA-L4-D2M5mil'];
    if (JSON.stringify(top) !== JSON.stringify(wantTop)) throw new Error(top.join(' > '));
    const bga = out.seq[0];
    if (JSON.stringify(bga) !== JSON.stringify(['BGA-L19','BGA-L17','BGA-L15','BGA-L8'])) throw new Error(bga.join(' > '));
    console.log('        ' + out.cols.join(' | '));
    console.log('        Top 面: ' + top.join(' > '));
  });
  t('指引条目都能跳到对应的约束卡片', () => {
    const bad = w.eval(`(function(){
      const titles=['Top-SMA-L2-D2M6mil','Bot-SMA-L19-D2M6mil','BGA-L17','BGA-L19','Top-SMA-L4-D2M5mil','SMA-L19-D2M5mil'];
      S.sets=titles.map(t=>({kind:/BGA/.test(t)?'BGA':'SMA', title:t, constraints:[]}));
      reexpandAll(); render(); renderJump();
      let miss=0;
      [...document.querySelectorAll('#jumpNav .jumpcol a')].forEach(function(a){
        if(!document.getElementById('set-'+a.dataset.si))miss++;
      });
      return miss;
    })()`);
    if (bad) throw new Error('有 ' + bad + ' 个指引没有对应卡片');
  });

  console.log('== 约束命名：面的写法（bot / bottom / top / 表层） ==');
  t('四、SMA在bot面，D2M为5mil → Bot-SMA-L19-D2M5mil', () => {
    const n = w.eval("makeConstraintName('四、SMA在bot面，D2M为5mil的封装方案','1. L19层扇出 SMA')");
    if (n !== 'Bot-SMA-L19-D2M5mil') throw new Error(n);
  });
  t('bottom面 / top面 / 表层 都认', () => {
    const got = w.eval(`[
      makeConstraintName('一、SMA在bottom面，D2M为6mil的封装方案','1. L19层扇出 SMA'),
      makeConstraintName('二、SMA在top面，D2M为6mil的封装方案','1. L4层扇出 SMA'),
      makeConstraintName('三、SMA在表层，D2M为6mil的封装方案','1. L6层扇出 SMA'),
      makeConstraintName('sma在BOT面','2. L8层扇出 SMA')
    ]`);
    const want = ['Bot-SMA-L19-D2M6mil','Top-SMA-L4-D2M6mil','Top-SMA-L6-D2M6mil','Bot-SMA-L8'];
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(got.join(' | '));
  });
  t('两个面都提到时不硬猜（保持不标面）', () => {
    const n = w.eval("makeConstraintName('SMA 在 bot面 和 top面 都有','3. L9层扇出 SMA')");
    if (n !== 'SMA-L9') throw new Error(n);
  });

  console.log('== 叠层：手动设置总层数 ==');
  t('导入后默认按自动识别，输入框留空', () => {
    const botSrc = fs.readFileSync(path.join(dir, 'sample/L19层扇出SMA_bot_D2M5.txt'), 'utf8');
    w.__botSrc = botSrc;
    w.__savedQueue = w.eval('S.queue.map(function(f){return {id:f.id,name:f.name,text:f.text,enc:f.enc,status:f.status};})');
    w.eval("S.queue=[{id:1,name:'L19层扇出SMA_bot_D2M5.txt',text:window.__botSrc,enc:'UTF-8',status:''}]; S.sets=[]; document.getElementById('inpN').value=''; rebuild();");
    const info = w.eval("(function(){const s=S.sets[0];return {auto:autoLayerCount(), n:layerCount(), manual:manualStack(), input:document.getElementById('inpN').value, hint:document.getElementById('autoNHint').textContent};})()");
    if (info.manual !== 0) throw new Error('不该有手动值');
    if (info.auto !== info.n) throw new Error('自动与生效层数不一致');
    if (info.input !== '') throw new Error('输入框应为空：' + info.input);
    if (info.hint.indexOf('自动识别') < 0) throw new Error(info.hint);
    console.log('        ' + info.hint);
  });
  t('手动填 24 层：底层层号与约束展开跟着改', () => {
    const before = w.eval("S.sets[0].constraints[0].values.L21");
    const after = w.eval(`(function(){
      const i=document.getElementById('inpN'); i.value='24'; i.onchange();
      const s=S.sets[0];
      return {n:layerCount(), manual:manualStack(), L24:s.constraints[0].values.L24, L21:s.constraints[0].values.L21, L20:s.constraints[0].values.L20, L18:s.constraints[0].values.L18, L1:s.constraints[0].values.L1,
        hint:document.getElementById('autoNHint').textContent, stack:document.getElementById('stackHint').textContent};
    })()`);
    if (before !== '13') throw new Error('准备状态不对：L21=' + before);
    if (after.n !== 24 || after.manual !== 24) throw new Error('层数 ' + JSON.stringify(after));
    if (after.L24 !== '13') throw new Error('bottom 应该落到 L24：' + after.L24);
    if (after.L21 !== '7.5' || after.L20 !== '7.5') throw new Error('L20/L21 应为 7.5：' + after.L20 + '/' + after.L21);
    if (after.L18 !== '11.39' || after.L1 !== '11.39') throw new Error('L18及以上 应为 11.39');
    if (after.hint.indexOf('手动设为 24') < 0) throw new Error(after.hint);
    if (after.stack.indexOf('L24 为底层') < 0) throw new Error(after.stack);
  });
  t('点「按 TXT 自动」恢复自动识别', () => {
    const back = w.eval(`(function(){
      document.getElementById('btnAutoN').click();
      const s=S.sets[0];
      return {n:layerCount(), manual:manualStack(), input:document.getElementById('inpN').value, L21:s.constraints[0].values.L21, L24:s.constraints[0].values.L24};
    })()`);
    if (back.manual !== 0 || back.input !== '') throw new Error('没恢复自动：' + JSON.stringify(back));
    if (back.n !== 21) throw new Error('层数 ' + back.n);
    if (back.L21 !== '13') throw new Error('L21 应回到 bottom 的 13：' + back.L21);
    if (back.L24 !== undefined) throw new Error('L24 应该被清掉：' + back.L24);
  });
  t('改层数会重算检查结果与 ⑤ 页说明', () => {
    w.__sampleTxt = sampleTxt;
    w.eval("S.sets=" + JSON.stringify(rules) + "; UI.items=CopperCheck.parseBoardItems(window.__sampleTxt); UI.runSeq=0; runCheck(true);");
    const eff = w.eval(`(function(){
      const i=document.getElementById('inpN'); i.value='30'; i.onchange();
      return {n:layerCount(), hint:document.getElementById('stackHint').textContent};
    })()`);
    if (eff.n !== 30) throw new Error('层数 ' + eff.n);
    if (eff.hint.indexOf('L30') < 0) throw new Error(eff.hint);
    const legendVer = w.eval("UI.runSeq");
    if (!legendVer) throw new Error('没有触发重算');
    // 复原：把这一节开始时保存的导入队列放回去，后面的用例继续用原样本
    w.eval("document.getElementById('inpN').value=''; document.getElementById('btnAutoN').click(); S.queue=window.__savedQueue; rebuild();");
  });

  console.log('== 每个过孔的「总复核」 ==');
  const allFailRule = [{kind:'BGA',title:'BGA-L19',fanLayer:19,constraints:[{cat:'反焊盘尺寸',name:'反焊盘半径',unit:'mil',values:{L1:'1',L2:'1',L19:'1'}}]}];
  t('有不符合项的过孔卡片上有总复核勾选框（三行都不符合）', () => {
    $('tabs').querySelector('[data-tab="result"]').click();
    w.__sampleTxt = sampleTxt;
    w.eval("S.sets=" + JSON.stringify(allFailRule) + "; UI.items=CopperCheck.parseBoardItems(window.__sampleTxt); UI.reviewed={}; UI.resFilter=''; UI.resLimit=1000; runCheck(true); renderResults();");
    if (d.querySelectorAll('#checkOut .rvwBox').length !== 3) throw new Error('准备状态不对，勾选框数=' + d.querySelectorAll('#checkOut .rvwBox').length);
    const card = d.querySelector('#checkOut .set');
    if (!card) throw new Error('没有卡片');
    if (!card.querySelector('.grpBox')) throw new Error('没有总复核勾选框');
    if (card.querySelector('#grv-0').textContent.indexOf('复核 0/') < 0) throw new Error('徽标 ' + card.querySelector('#grv-0').textContent);
  });
  t('勾总复核 → 本组所有不符合行都变成已复核', () => {
    const card = d.querySelector('#checkOut .set');
    const boxes = card.querySelectorAll('.rvwBox').length;
    const m = card.querySelector('.grpBox');
    m.checked = true; m.dispatchEvent(new w.Event('change', { bubbles: true }));
    if (card.querySelectorAll('.rvwBox:checked').length !== boxes) throw new Error('没有全勾');
    if (card.querySelectorAll('tr.reviewed').length !== boxes) throw new Error('没有变灰');
    if (card.querySelector('#grv-0').textContent.indexOf('复核 ' + boxes + '/' + boxes) < 0) throw new Error('徽标 ' + card.querySelector('#grv-0').textContent);
    if (d.getElementById('rvStat').querySelector('b').textContent.split('/')[0] !== String(boxes)) throw new Error('统计没跟上');
    if (!card.classList.contains('allrev')) throw new Error('卡片没有全复核标记');
  });
  t('取消总复核 → 全部还原', () => {
    const m = d.querySelector('#checkOut .set .grpBox');
    m.checked = false; m.dispatchEvent(new w.Event('change', { bubbles: true }));
    if (d.querySelectorAll('#checkOut .rvwBox:checked').length) throw new Error('没清掉');
    if (d.querySelector('#checkOut tr.reviewed')) throw new Error('还有灰行');
    if (d.getElementById('rvStat').querySelector('b').textContent !== '0/' + d.querySelectorAll('#checkOut .rvwBox').length) throw new Error('统计不对');
  });
  t('手勾一条 → 总复核显示半选', () => {
    const one = d.querySelector('#checkOut .rvwBox');
    one.checked = true; one.dispatchEvent(new w.Event('change', { bubbles: true }));
    const m = d.querySelector('#checkOut .set .grpBox');
    if (!m.indeterminate) throw new Error('不是半选状态');
    if (m.checked) throw new Error('不该是选中');
    if (d.querySelector('#checkOut tr.reviewed') === null) throw new Error('行没变灰');
  });
  t('点过孔头部的「复核 x/y」也能整组切换（半选时点一下=全勾）', () => {
    const total = d.querySelectorAll('#checkOut .rvwBox').length;
    const partial = d.querySelectorAll('#checkOut .rvwBox:checked').length;
    if (partial === 0 || partial === total) throw new Error('准备状态不对：' + partial + '/' + total);
    d.querySelector('#checkOut .badge.rev').click();
    if (d.querySelectorAll('#checkOut .rvwBox:checked').length !== total) throw new Error('没全勾');
    d.querySelector('#checkOut .badge.rev').click();
    if (d.querySelectorAll('#checkOut .rvwBox:checked').length) throw new Error('没取消');
  });
  t('「全部复核」按钮把所有过孔都标完', () => {
    $('btnReviewAll').click();
    const total = d.querySelectorAll('#checkOut .rvwBox').length;
    if (total < 1) throw new Error('没有可复核的行');
    if (d.querySelectorAll('#checkOut .rvwBox:checked').length !== total) throw new Error('没全勾');
    const stat = d.getElementById('rvStat').querySelector('b').textContent;
    if (stat.split('/')[0] !== String(total)) throw new Error('统计 ' + stat);
    if (d.querySelectorAll('#checkOut .grpBox:not(:checked)').length) throw new Error('有卡片的总复核没同步勾上');
    $('btnClearReview').click();
  });

  console.log('== 约束 chip 的计数跟随筛选口径 ==');
  const cntItems = (function(){
    const shapes=[], vias=[]; let id=1;
    function add(padstack, x, y, radius){
      shapes.push({id:id++, type:'shape', subset:'Top', set:'Route Keepout', radius:radius, center:[x,y], circle:true, head:'Set: Route Keepout'});
      vias.push({id:id++, type:'via', origin:[x,y], net:'N', padstack:padstack, traceLayers:[], connections:''});
    }
    add('SMA_Top-L8_d2m6mil_via', 1000, 1000, 9);   // 不符合
    add('SMA_Top-L8_d2m6mil_via', 1100, 1000, 13);  // 符合
    add('SMA_Top-L8_d2m6mil_via', 1200, 1000, 13);  // 符合
    add('SMA_Top-L4_d2m5mil_via', 1300, 1000, 9);   // 不符合
    add('SMA_Top-L4_d2m5mil_via', 1400, 1000, 9);   // 不符合
    add('BGA_GND_pad1mil_0902', 1500, 1000, 9);     // 未推算到约束
    return shapes.concat(vias);
  })();
  const cntSets = [
    {kind:'SMA',title:'Top-SMA-L8-D2M6mil',fanLayer:8,constraints:[{cat:'反焊盘尺寸',name:'反焊盘半径',unit:'mil',values:{L1:'13'}}]},
    {kind:'SMA',title:'Top-SMA-L4-D2M5mil',fanLayer:4,constraints:[{cat:'反焊盘尺寸',name:'反焊盘半径',unit:'mil',values:{L1:'13'}}]},
    {kind:'SMA',title:'Top-SMA-L6-D2M6mil',fanLayer:6,constraints:[{cat:'反焊盘尺寸',name:'反焊盘半径',unit:'mil',values:{L1:'13'}}]}
  ];
  function chipNums(){
    const out={};
    d.querySelectorAll('#resChips .chip').forEach(c => { out[c.dataset.rule] = +(c.querySelector('.cn').textContent); });
    return out;
  }
  t('默认「全部」：计数 = 该约束匹配到的过孔数', () => {
    $('tabs').querySelector('[data-tab="result"]').click();
    w.__cnt = cntItems;
    w.eval("S.sets=" + JSON.stringify(cntSets) + "; UI.items=window.__cnt; UI.resLimit=1000; UI.resFilter=''; UI.resRule=''; UI.onlyBad=false; runCheck(true); renderResults();");
    const n = chipNums();
    if (n['Top-SMA-L8-D2M6mil'] !== 3) throw new Error('L8 = ' + n['Top-SMA-L8-D2M6mil']);
    if (n['Top-SMA-L4-D2M5mil'] !== 2) throw new Error('L4 = ' + n['Top-SMA-L4-D2M5mil']);
    if (n['未推算到约束'] !== 1) throw new Error('未推算到 = ' + n['未推算到约束']);
    if ($('chipScope').textContent.indexOf('匹配到的过孔数') < 0) throw new Error($('chipScope').textContent);
  });
  t('切「只看不符合」：计数变成该约束下有不符合的过孔数', () => {
    $('btnOnlyBad').click();
    const n = chipNums();
    if (n['Top-SMA-L8-D2M6mil'] !== 1) throw new Error('L8 应有 1 个孔不符合，实际 ' + n['Top-SMA-L8-D2M6mil']);
    if (n['Top-SMA-L4-D2M5mil'] !== 2) throw new Error('L4 = ' + n['Top-SMA-L4-D2M5mil']);
    if (n['Top-SMA-L6-D2M6mil'] !== 0) throw new Error('L6 = ' + n['Top-SMA-L6-D2M6mil']);
    if (n['未推算到约束'] !== 0) throw new Error('未推算到应无不符合：' + n['未推算到约束']);
    if ($('chipScope').textContent.indexOf('该约束下有不符合的过孔数') < 0) throw new Error($('chipScope').textContent);
    console.log('        ' + JSON.stringify(n));
  });
  t('切「只看没推算到约束」：只有那一条有数', () => {
    $('btnOnlyNoRule').click();
    const n = chipNums();
    if (n['未推算到约束'] !== 1) throw new Error('未推算到 = ' + n['未推算到约束']);
    if (n['Top-SMA-L8-D2M6mil'] !== 0 || n['Top-SMA-L4-D2M5mil'] !== 0) throw new Error('其他应清零：' + JSON.stringify(n));
    if ($('chipScope').textContent.indexOf('没推算到约束的过孔数') < 0) throw new Error($('chipScope').textContent);
  });
  t('切「只看已配对过孔」：回到有记录的过孔数', () => {
    $('btnOnlyMatched').click();
    const n = chipNums();
    if (n['Top-SMA-L8-D2M6mil'] !== 3 || n['Top-SMA-L4-D2M5mil'] !== 2) throw new Error(JSON.stringify(n));
    if (n['未推算到约束'] !== 1) throw new Error('未推算到 = ' + n['未推算到约束']);
  });
  t('计数口径切换要保留选中的约束筛选', () => {
    $('btnAllRows').click();
    const chip = [...d.querySelectorAll('#resChips .chip')].find(c => c.dataset.rule === 'Top-SMA-L4-D2M5mil');
    chip.click();
    $('btnOnlyBad').click();
    if (w.eval('UI.resRule') !== 'Top-SMA-L4-D2M5mil') throw new Error('约束筛选丢了：' + w.eval('UI.resRule'));
    const n = chipNums();
    if (n['Top-SMA-L4-D2M5mil'] !== 2) throw new Error('L4 = ' + n['Top-SMA-L4-D2M5mil']);
    // 卡片只剩这一步筛选下的结果
    if (d.querySelectorAll('#checkOut .set').length !== 2) throw new Error('卡片数 ' + d.querySelectorAll('#checkOut .set').length);
    $('btnAllRows').click();
  });

  console.log('== ④ 搜索栏与快速定位过孔 ==');
  const searchItems = (function(){
    const shapes=[], vias=[];
    function addVia(id, net, padstack, x, y){
      shapes.push({id:id*10, type:'shape', subset:'Top', set:'Route Keepout', radius:12, center:[x,y], circle:true, head:'Set: Route Keepout'});
      vias.push({id:id, type:'via', origin:[x,y], net:net, padstack:padstack, traceLayers:[], connections:''});
    }
    addVia(19371, 'GND', 'BGA_GND_pad1mil_0902', 1000, 1000);
    addVia(21425, '69_N', 'SMA_L2_d2m6mil_via_0902', 2000, 2000);
    addVia(30018, 'VCC_3V3', 'SMA_Bot-L19_d2m5mil_via_0902', 3000, 3000);
    return shapes.concat(vias);
  })();
  const searchSets = [
    {kind:'SMA',title:'Top-SMA-L2-D2M6mil',fanLayer:2,constraints:[{cat:'反焊盘尺寸',name:'反焊盘半径',unit:'mil',values:{L1:'13'}}]},
    {kind:'SMA',title:'Bot-SMA-L19-D2M5mil',fanLayer:19,constraints:[{cat:'反焊盘尺寸',name:'反焊盘半径',unit:'mil',values:{L1:'13'}}]}
  ];

  t('搜索栏与定位按钮正常渲染', () => {
    w.__searchItems = searchItems;
    w.eval("S.sets=" + JSON.stringify(searchSets) + "; UI.items=window.__searchItems; UI.resLimit=1000; UI.resFilter=''; UI.resRule=''; UI.resSearch=''; UI.onlyBad=false; runCheck(true); renderResults();");
    if (!d.getElementById('inpResSearch')) throw new Error('没有搜索输入框');
    if (!d.getElementById('btnSearchGo')) throw new Error('没有定位按钮');
    if (!d.getElementById('btnClearSearch')) throw new Error('没有清空按钮');
    if (d.querySelectorAll('#checkOut .set').length !== 3) throw new Error('初始卡片数应为 3');
  });

  t('搜孔号 (如 19371 / Via 21425) 快速筛选并唯一定位', () => {
    const inp = d.getElementById('inpResSearch');
    inp.value = '19371';
    inp.dispatchEvent(new w.Event('input', { bubbles: true }));
    w.eval("onSearchInput();"); // 同步触发
    // 直调定位
    d.getElementById('btnSearchGo').click();
    if (d.querySelectorAll('#checkOut .set').length !== 1) throw new Error('筛选卡片数 ' + d.querySelectorAll('#checkOut .set').length);
    if (d.querySelector('#checkOut .set .badge').textContent.indexOf('19371') < 0) throw new Error('筛出的不是 19371');
    if (!d.querySelector('#checkOut .set').classList.contains('pulse-target')) throw new Error('未触发定位动画样式');
    if ($('searchStat').textContent.indexOf('19371') < 0) throw new Error('搜索统计未写孔号：' + $('searchStat').textContent);

    // 搜带 Via 前缀的
    inp.value = 'Via 21425';
    d.getElementById('btnSearchGo').click();
    if (d.querySelectorAll('#checkOut .set').length !== 1) throw new Error('Via 21425 卡片数 ' + d.querySelectorAll('#checkOut .set').length);
    if (d.querySelector('#checkOut .set .badge').textContent.indexOf('21425') < 0) throw new Error('筛出的不是 21425');
  });

  t('搜网络 (如 GND / 69_N) 与 Padstack 关键字', () => {
    const inp = d.getElementById('inpResSearch');
    inp.value = 'GND';
    d.getElementById('btnSearchGo').click();
    if (d.querySelectorAll('#checkOut .set').length !== 1) throw new Error('GND 应该只有 1 个孔');
    if (d.querySelector('#checkOut .set b').textContent !== 'GND') throw new Error('网络不匹配');

    inp.value = 'SMA_Bot';
    d.getElementById('btnSearchGo').click();
    if (d.querySelectorAll('#checkOut .set').length !== 1) throw new Error('SMA_Bot 应该匹配 30018');
    if (d.querySelector('#checkOut .set .badge').textContent.indexOf('30018') < 0) throw new Error('不是 30018');
  });

  t('按 Enter 键触发定位，点清空按钮恢复全部', () => {
    const inp = d.getElementById('inpResSearch');
    inp.value = '30018';
    inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    if (d.querySelectorAll('#checkOut .set').length !== 1) throw new Error('Enter 定位失败');

    // 点清空
    d.getElementById('btnClearSearch').click();
    if (inp.value !== '') throw new Error('清空后输入框非空');
    if (d.querySelectorAll('#checkOut .set').length !== 3) throw new Error('清空后卡片数未恢复 3');
  });

  t('搜索不存在的孔给出友好提示', () => {
    const inp = d.getElementById('inpResSearch');
    inp.value = '999999';
    d.getElementById('btnSearchGo').click();
    if (d.querySelectorAll('#checkOut .set').length !== 0) throw new Error('不该有卡片');
    if ($('searchStat').textContent.indexOf('未找到匹配的过孔') < 0) throw new Error('未给出提示：' + $('searchStat').textContent);
    $('btnAllRows').click();
    if (d.querySelectorAll('#checkOut .set').length !== 3) throw new Error('全部后未恢复');
    // 复原真实样本供后续用例使用
    w.__sampleTxt = sampleTxt;
    w.eval("S.sets=" + JSON.stringify(rules) + "; UI.items=CopperCheck.parseBoardItems(window.__sampleTxt); UI.resLimit=1000; UI.resFilter=''; UI.resRule=''; UI.resSearch=''; UI.onlyBad=false; runCheck(true); renderResults();");
  });

  console.log('== 缺失层检查：规则有要求但数据无铜皮的层标记为不符合 ==');
  const botD2M5Rules = [{
    kind: 'SMA', title: 'Bot-SMA-L19-D2M5mil', fanLayer: 19,
    constraints: [
      {
        cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil',
        values: {
          L1: '11.39', L2: '11.39', L3: '11.39', L4: '11.39', L5: '11.39',
          L6: '11.39', L7: '11.39', L8: '11.39', L9: '11.39', L10: '11.39',
          L11: '11.39', L12: '11.39', L13: '11.39', L14: '11.39', L15: '11.39',
          L16: '11.39', L17: '11.39', L18: '11.39', L20: '7.5', L21: '13'
        }
      }
    ]
  }];
  const via21598Data = [
    'Item 1                < Shape >',
    '  Set:                Route Keepout',
    '  Subset:             Top',
    '  Type:               Shape(Static)',
    'Exterior Boundary:',
    '  Arc seg: xy [100.0, 100.0]  xy [100.0, 100.0] Width (0.0000)',
    '    Center-xy:  [100.0000, 100.0000] Radius (11.3900) CCW',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'Item 2                < Shape >',
    '  Set:                Route Keepout',
    '  Subset:             20G11P',
    '  Type:               Shape(Static)',
    'Exterior Boundary:',
    '  Arc seg: xy [100.0, 100.0]  xy [100.0, 100.0] Width (0.0000)',
    '    Center-xy:  [100.0000, 100.0000] Radius (7.5000) CCW',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'Item 3                < Shape >',
    '  Set:                Route Keepout',
    '  Subset:             21G12P',
    '  Type:               Shape(Static)',
    'Exterior Boundary:',
    '  Arc seg: xy [100.0, 100.0]  xy [100.0, 100.0] Width (0.0000)',
    '    Center-xy:  [100.0000, 100.0000] Radius (13.0000) CCW',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'Item 4                < Via >',
    '  Origin-xy:          [100.0000, 100.0000]',
    '  Net:                8_N',
    '  Padstack Name:      SMA_Bot-L19_d2m5mil_via',
    '  Usage:              BBVia',
    '  Connections:        ',
    '    Pin:              1 (Bottom)',
    '    Trace:            1 (19IS08)',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    '~ ~ ~ ~ ~ ~ ~ ~ ~ ~End~ ~ ~ ~ ~ ~ ~ ~ ~ ~'
  ].join('\n');

  t('数据中仅有 L1/L20/L21 三层铜皮时，L2~L18 自动补齐为「无铜皮」并判定为「不符合」', () => {
    $('tabs').querySelector('[data-tab="result"]').click();
    w.__vData = via21598Data;
    w.eval("S.sets=" + JSON.stringify(botD2M5Rules) + "; UI.items=CopperCheck.parseBoardItems(window.__vData); UI.resLimit=1000; UI.resFilter=''; UI.resRule=''; UI.resSearch=''; UI.onlyBad=false; runCheck(true); renderResults();");
    const g = w.eval("UI.result.groups[0]");
    if (!g.rule || g.rule.title !== 'Bot-SMA-L19-D2M5mil') throw new Error('规则未匹配：' + (g.rule && g.rule.title));
    // 规则定义了 L1~L18, L20, L21 共 20 个层，加上 1 个 Padstack 层名检查共 21 行
    if (g.rows.length !== 21) throw new Error('总检查行数应为 21，实际 ' + g.rows.length);
    // L1, L20, L21 为实测符合项；其余 17 层（L2~L18）为缺失不符合项
    if (g.failCount !== 17) throw new Error('不符合数应为 17，实际 ' + g.failCount);

    // 检查 L2~L18 的每一行
    for (let l = 2; l <= 18; l++) {
      const row = g.rows.find(r => r.layer === l);
      if (!row) throw new Error('缺 L' + l + ' 行');
      if (row.actual !== '无铜皮') throw new Error('L' + l + ' 实测值非无铜皮：' + row.actual);
      if (row.expect !== '11.39') throw new Error('L' + l + ' 规则值非 11.39：' + row.expect);
      if (row.status !== '不符合') throw new Error('L' + l + ' 状态非不符合：' + row.status);
      if (!row.missing) throw new Error('L' + l + ' missing 标记缺失');
    }

    // L1, L20, L21 必须为符合
    [1, 20, 21].forEach(l => {
      const row = g.rows.find(r => r.layer === l);
      if (!row) throw new Error('缺 L' + l + ' 行');
      if (row.status !== '符合') throw new Error('L' + l + ' 状态应为符合：' + row.status);
    });
  });

  t('缺失层在 ④ 结果表格中呈现红字「无铜皮」与「不符合」，并支持复核勾选', () => {
    const card = d.querySelector('#checkOut .set');
    if (!card) throw new Error('未找到结果卡片');
    const failTrs = card.querySelectorAll('tr.fail');
    if (failTrs.length !== 17) throw new Error('表格中不符合行数应为 17，实际 ' + failTrs.length);
    const boxCount = card.querySelectorAll('.rvwBox').length;
    if (boxCount !== 17) throw new Error('可复核框数应为 17，实际 ' + boxCount);

    // 总复核勾选
    const master = card.querySelector('.grpBox');
    master.checked = true; master.dispatchEvent(new w.Event('change', { bubbles: true }));
    if (card.querySelectorAll('tr.reviewed').length !== 17) throw new Error('总复核未将 17 行全部标为已复核');
    master.checked = false; master.dispatchEvent(new w.Event('change', { bubbles: true }));

    // 恢复样本环境供后续用例使用
    w.__sampleTxt = sampleTxt;
    w.eval("S.sets=" + JSON.stringify(rules) + "; UI.items=CopperCheck.parseBoardItems(window.__sampleTxt); UI.resLimit=1000; UI.resFilter=''; UI.resRule=''; UI.resSearch=''; UI.onlyBad=false; runCheck(true); renderResults();");
  });

  console.log('== ⑤ 规律分析页 ==');
  t('没有结果时 ⑤ 页给出提示', () => {
    w.eval("UI.result=null; UI.items=[]; renderLegend(true)");
    const h = $('legendOut').innerHTML;
    if (h.indexOf('还没有检查结果') < 0) throw new Error('没有提示');
  });
  t('跑完检查后切到 ⑤ 页，内容自动出来', () => {
    w.__sampleTxt = sampleTxt;
    w.eval("S.sets=" + JSON.stringify(rules) + "; UI.items=CopperCheck.parseBoardItems(window.__sampleTxt); runCheck(true);");
    $('tabs').querySelector('[data-tab="result"]').click();
    $('tabs').querySelector('[data-tab="legend"]').click();
    const h = $('legendOut').innerHTML;
    if (h.indexOf('各约束下不符合') < 0) throw new Error('没渲染分布');
    if (h.indexOf('铜皮 × 过孔 怎么配对') < 0) throw new Error('没渲染规律');
  });
  t('⑤ 页内容有缓存，重复切页签不会重复渲染', () => {
    const v1 = $('legendOut').dataset.ver;
    $('tabs').querySelector('[data-tab="result"]').click();
    $('tabs').querySelector('[data-tab="legend"]').click();
    if (!$('legendOut').dataset.ver) throw new Error('没有版本标记');
    if (v1 && v1.indexOf(String(w.eval('UI.runSeq'))) < 0 && v1.indexOf('|') < 0) throw new Error('版本标记异常');
  });
  t('改容差后 ⑤ 页的说明跟着变', () => {
    w.eval("document.getElementById('valTol').value='0.5'; renderLegend(true)");
    if ($('legendOut').innerHTML.indexOf('0.5 mil') < 0) throw new Error('容差没同步');
    w.eval("document.getElementById('valTol').value='0.01'");
  });

  t('⑤ 规律分析页展开归纳不符合的具体原因（按层排行与分层偏差明细）', () => {
    // 注入包含多层不同偏差的样本数据
    const shapes = [
      { id: 1, type: 'shape', subset: '19IS08', set: 'Route Keepout', radius: 10.5, center: [100, 100], circle: true, head: 'Set: Route Keepout' },
      { id: 2, type: 'shape', subset: '17IS07', set: 'Route Keepout', radius: 10.5, center: [100, 100], circle: true, head: 'Set: Route Keepout' },
      { id: 3, type: 'shape', subset: '19IS08', set: 'Route Keepout', radius: 10.5, center: [200, 200], circle: true, head: 'Set: Route Keepout' }
    ];
    const vias = [
      { id: 101, type: 'via', origin: [100, 100], net: 'N1', padstack: 'BGA_3510_l2-L8_Ring3mil_0902', traceLayers: ['L8'], connections: '' },
      { id: 102, type: 'via', origin: [200, 200], net: 'N2', padstack: 'BGA_3510_L15_ring3mil_0902', traceLayers: ['L15'], connections: '' }
    ];
    const testSets = [
      { kind: 'BGA', title: 'BGA-L8', fanLayer: 8, constraints: [{ cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L17: '11.39', L19: '11.39' } }] },
      { kind: 'BGA', title: 'BGA-L15', fanLayer: 15, constraints: [{ cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L19: '11.39' } }] }
    ];
    w.__legendMix = shapes.concat(vias);
    w.eval("S.sets=" + JSON.stringify(testSets) + "; UI.items=window.__legendMix; runCheck(true); renderLegend(true);");
    const h = $('legendOut').innerHTML;

    // 1. 包含各约束下展开明细小节且置于顶部
    if (h.indexOf('各约束下不符合的具体原因展开明细') < 0) throw new Error('缺少各约束展开明细小节');
    const posDetail = h.indexOf('各约束下不符合的具体原因展开明细');
    const posRules = h.indexOf('铜皮 × 过孔 怎么配对');
    if (posDetail < 0 || posRules < 0 || posDetail > posRules) throw new Error('各约束下不符合展开明细未置于页面顶部');

    // 2. 确认已删掉「不符合原因汇总排行」
    if (h.indexOf('不符合原因汇总排行') >= 0) throw new Error('不应再包含原因汇总排行');

    // 3. 包含按层分布概览
    if (h.indexOf('L19：') < 0 || h.indexOf('L17：') < 0) throw new Error('缺少按层分布概览');

    // 4. 具体原因写明实测值、规则值与偏差
    if (h.indexOf('实测 10.5 mil ≠ 规则 11.39 mil（偏差 -0.89 mil）') < 0) throw new Error('未写明具体实测/规则/偏差：' + h);

    // 5. L19 出现（BGA-L8 和 BGA-L15 对应约束明细）
    if (h.indexOf('L19') < 0 || h.indexOf('BGA-L8') < 0) throw new Error('原因明细未包含对应约束');

    // 6. 标注了有问题的孔的网络 (N1, N2)
    if (h.indexOf('<code>N1</code>') < 0 || h.indexOf('<code>N2</code>') < 0) throw new Error('未标注有问题的孔的网络：' + h);
    if (h.indexOf('对应孔的网络') < 0) throw new Error('缺少对应孔网络明细');
  });

  console.log('== 导入 TXT 后的跳转（异步） ==');
  // 先让上面那批同步用例跑完（它们会导入 L15 样本），再导入 bot 样本，确保它是最后导入的
  setTimeout(() => {
    const botTxt = fs.readFileSync(path.join(dir, 'sample/L19层扇出SMA_bot_D2M5.txt'), 'utf8');
    w.eval("S.queue=[]; S.sets=[]; render();");   // 清掉前面用例导入的文件，这次只看 bot 样本
    w.addFiles([new w.File([botTxt], 'L19层扇出SMA_bot_D2M5.txt', { type: 'text/plain' })]);
    setTimeout(() => {
      t('导入后自动停在 ② 生成的约束', () => {
        if (activeTab() !== 'tab-sets') throw new Error(activeTab());
        if (w.eval('S.sets.length') < 1) throw new Error('没有生成约束');
        if ($('sets').innerHTML.indexOf('Bot-SMA-L19-D2M5mil') < 0) throw new Error('约束表没渲染：' + $('sets').innerHTML.slice(0, 200));
      });
      t('样本 TXT 生成 Bot-SMA-L19-D2M5mil，并归到 bottom 面那一列', () => {
        const info = w.eval("(function(){const s=S.sets[0];return {title:s.title, group:chipMeta(s.title).group, fan:fanLayerOf(s), vals:s.constraints[0].values};})()");
        if (info.title !== 'Bot-SMA-L19-D2M5mil') throw new Error('标题 ' + info.title);
        if (info.group !== 'SMA · bottom 面') throw new Error('分列 ' + info.group);
        if (info.fan !== 19) throw new Error('出线层 ' + info.fan);
        if (info.vals.L20 !== '7.5' || info.vals.L21 !== '13') throw new Error('L20/L21 ' + JSON.stringify(info.vals));
        if (info.vals.L18 !== '11.39') throw new Error('L18 ' + info.vals.L18);
      });
      t('② 页的约束指引有跳转按钮，且能跳到对应约束', () => {
        const chips = d.querySelectorAll('#jumpNav .jumpcol a');
        if (!chips.length) throw new Error('没有指引按钮');
        let bad = 0;
        chips.forEach(a => { if (!d.getElementById('set-' + a.dataset.si)) bad++; });
        if (bad) throw new Error('有 ' + bad + ' 个指引没有对应约束卡片');
        chips[0].click();
      });
      t('生成的约束仍按叠层逐层填好来源', () => {
        const g = w.eval("(function(){const c=S.sets[0].constraints[0];return {vals:Object.keys(c.values||{}).join(','), src:(c.sources&&c.sources.L2)||''};})()");
        if (g.vals.indexOf('L2') < 0 || g.vals.indexOf('L1') < 0) throw new Error(JSON.stringify(g));
        if (!g.src) throw new Error('L2 没有来源');
      });
      
  console.log('== Padstack 层名与 Connections 连接层检查 ==');
  t('layersOfPadstack 提取各种 Padstack 命名中的层号', () => {
    const fn = w.CopperCheck.layersOfPadstack;
    if (JSON.stringify(fn('test BGA 3510 L8 L2 ring3mil', 24)) !== '[2,8]') throw new Error('test BGA L8 L2: ' + JSON.stringify(fn('test BGA 3510 L8 L2 ring3mil', 24)));
    if (JSON.stringify(fn('BGA_3510_L19_ring3mil_L2pad_0907', 24)) !== '[2,19]') throw new Error('L19 L2pad: ' + JSON.stringify(fn('BGA_3510_L19_ring3mil_L2pad_0907', 24)));
    if (JSON.stringify(fn('BGA_3510_l2-L8_Ring3mil_0902', 24)) !== '[2,8]') throw new Error('l2-L8: ' + JSON.stringify(fn('BGA_3510_l2-L8_Ring3mil_0902', 24)));
    if (JSON.stringify(fn('SMA_Bot-L19_d2m6mil_via-0902', 24)) !== '[19,24]') throw new Error('Bot-L19: ' + JSON.stringify(fn('SMA_Bot-L19_d2m6mil_via-0902', 24)));
    if (JSON.stringify(fn('SMA_Top-L15', 24)) !== '[1,15]') throw new Error('Top-L15: ' + JSON.stringify(fn('SMA_Top-L15', 24)));
    if (JSON.stringify(fn('VIA_L02_L08', 24)) !== '[2,8]') throw new Error('L02_L08: ' + JSON.stringify(fn('VIA_L02_L08', 24)));
    if (JSON.stringify(fn('VIA_02G01P_08IS03', 24)) !== '[2,8]') throw new Error('02G01P_08IS03: ' + JSON.stringify(fn('VIA_02G01P_08IS03', 24)));
  });

  t('Padstack Name 包含 Connections 所有连接层时判定为「符合」', () => {
    const padTxt = [
      'Item 1 < Via >',
      '  Origin-xy: [100.0, 100.0]',
      '  Net: TEST_NET',
      '  Padstack Name: test BGA 3510 L8 L2 ring3mil',
      '  Connections:',
      '    Trace: 2 (02G01P 08IS03)',
      '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
      'Item 2 < Shape >',
      '  Set: Route Keepout',
      '  Subset: 02G01P',
      '  Type: Shape(Static)',
      'Exterior Boundary:',
      '  Arc seg: xy [90.0, 100.0] xy [90.0, 100.0] Width (0.0000)',
      '    Center-xy: [100.0, 100.0] Radius (12.0) CCW',
      '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~'
    ].join('\n');
    w.__padTxt = padTxt;
    w.eval("UI.items=CopperCheck.parseBoardItems(window.__padTxt); UI.resLimit=1000; UI.resFilter=''; UI.resRule=''; UI.resSearch=''; UI.onlyBad=false; runCheck(true); renderResults();");
    const g = w.eval("UI.result.groups[0]");
    const padRow = g.rows.find(r => r.checkType === 'Padstack层名');
    if (!padRow) throw new Error('未生成 Padstack 层名检查行');
    if (padRow.status !== '符合') throw new Error('状态应为符合，实际：' + padRow.status);
    if (padRow.actual !== 'L2、L8') throw new Error('实测应为 L2、L8，实际：' + padRow.actual);
    if (padRow.expect !== 'L2、L8') throw new Error('期望应为 L2、L8，实际：' + padRow.expect);
    if (padRow.reason !== '吻合') throw new Error('原因应为吻合，实际：' + padRow.reason);
  });

  t('Padstack Name 缺少 Connections 连接层（如缺少 L8）时判定为「不符合」并报错', () => {
    const padTxtFail = [
      'Item 1 < Via >',
      '  Origin-xy: [100.0, 100.0]',
      '  Net: TEST_NET_FAIL',
      '  Padstack Name: test BGA 3510 L2 ring3mil',
      '  Connections:',
      '    Trace: 2 (02G01P 08IS03)',
      '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~'
    ].join('\n');
    w.__padTxtFail = padTxtFail;
    w.eval("UI.items=CopperCheck.parseBoardItems(window.__padTxtFail); UI.resLimit=1000; UI.resFilter=''; UI.resRule=''; UI.resSearch=''; UI.onlyBad=false; runCheck(true); renderResults();");
    const g = w.eval("UI.result.groups[0]");
    const padRow = g.rows.find(r => r.checkType === 'Padstack层名');
    if (!padRow) throw new Error('未生成 Padstack 层名检查行');
    if (padRow.status !== '不符合') throw new Error('状态应为不符合，实际：' + padRow.status);
    if (padRow.actual !== 'L2') throw new Error('实测应为 L2，实际：' + padRow.actual);
    if (padRow.expect !== 'L2、L8') throw new Error('期望应为 L2、L8，实际：' + padRow.expect);
    if (padRow.reason.indexOf('缺少连接层 L8') < 0) throw new Error('原因应提示缺少连接层 L8：' + padRow.reason);
    if (g.failCount !== 1) throw new Error('failCount 应为 1，实际：' + g.failCount);

    // 检查 ④ 结果表格中的红字高亮与提示
    $('tabs').querySelector('[data-tab="result"]').click();
    const card = d.querySelector('#checkOut .set');
    if (!card) throw new Error('未找到结果卡片');
    const tr = card.querySelector('tr.fail');
    if (!tr) throw new Error('未找到 fail 行');
    if (tr.textContent.indexOf('Padstack层名') < 0) throw new Error('fail 行非 Padstack层名');
    if (tr.textContent.indexOf('不符合') < 0) throw new Error('未显示不符合');
    const badCell = tr.querySelector('td.bad');
    if (!badCell) throw new Error('未标红');
    if (badCell.title.indexOf('缺少连接层 L8') < 0) throw new Error('未包含 hover 提示：' + badCell.title);

    // 复核勾选框
    const rvw = tr.querySelector('.rvwBox');
    if (!rvw) throw new Error('缺少复核勾选框');
    rvw.checked = true; rvw.dispatchEvent(new w.Event('change', { bubbles: true }));
    if (!tr.classList.contains('reviewed')) throw new Error('勾选后未标灰已复核');
  });

  t('Padstack 完全无层号且有连接层时报错缺少全部连接层', () => {
    const padNoLayer = [
      'Item 1 < Via >',
      '  Origin-xy: [200.0, 200.0]',
      '  Net: NET_NO_LAYER',
      '  Padstack Name: BGA_via_generic',
      '  Connections:',
      '    Trace: 2 (02G01P 08IS03)',
      '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~'
    ].join('\n');
    w.__padNoLayer = padNoLayer;
    w.eval("UI.items=CopperCheck.parseBoardItems(window.__padNoLayer); runCheck(true);");
    const g = w.eval("UI.result.groups[0]");
    const padRow = g.rows.find(r => r.checkType === 'Padstack层名');
    if (padRow.status !== '不符合') throw new Error('应为不符合：' + padRow.status);
    if (padRow.reason.indexOf('缺少连接层 L2、L8') < 0) throw new Error('应提示缺少全部连接层：' + padRow.reason);
  });

  t('关闭「检查Padstack层名」复选框时状态变为未检查且不报错', () => {
    $('ckPadstack').checked = false;
    w.eval("runCheck(true); renderResults();");
    const g = w.eval("UI.result.groups[0]");
    const padRow = g.rows.find(r => r.checkType === 'Padstack层名');
    if (padRow.status !== '未检查') throw new Error('关闭开关后应为未检查：' + padRow.status);
    if (g.failCount !== 0) throw new Error('关闭开关后 failCount 应为 0，实际：' + g.failCount);
    $('ckPadstack').checked = true;
    w.eval("runCheck(true); renderResults();");
  });

  console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败, jsdom 错误 ' + domErr);
      process.exit(failed || domErr ? 1 : 0);
    }, 300);
  }, 500);
}, 600);
