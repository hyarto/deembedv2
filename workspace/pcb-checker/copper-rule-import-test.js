/* 约束 TXT 导入回归：表格型写法（类 → 种 → 层/反焊盘/焊盘）
   5 类 22 条：SMA 6 条 + BGA 4 类 × 4 种 = 16 条，命名 SMA-Top-L2 / BGA-L2-L4-0.5mm 这样 */
const fs = require('fs');
const path = require('path');
function loadJsdom(){
  try { return require('jsdom'); }
  catch (e) { throw new Error('找不到 jsdom，请先执行 npm install'); }
}
const { JSDOM, VirtualConsole } = loadJsdom();
const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'copper.html'), 'utf8');
const SAMPLE = path.join(dir, 'sample', '约束示例_表格型.txt');
const sampleText = fs.readFileSync(SAMPLE, 'utf8');
const legacyText = fs.readFileSync(path.join(dir, 'sample', 'L17层扇出SMA.txt'), 'utf8');

const vc = new VirtualConsole();
vc.on('error', (...a) => console.log('  console.error: ' + a.join(' ')));
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  virtualConsole: vc,
  pretendToBeVisual: true,
  url: 'file://' + path.join(dir, 'copper.html')
});
const w = dom.window, d = w.document;

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '  -> ' + e.message); }
}
function eq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg ? msg + '：' : '') + sa + ' ≠ ' + sb);
}

/* 解析 + 按页面同一套流程算出每层数值 */
function parseAndFill(text) {
  const json = w.eval('(function(t){var s=parseConstraintText(t,"约束.txt");s.forEach(function(x){x.constraints=buildConstraints(x.rules||[]);});s.forEach(function(x){var fan=fanLayerOf(x);x.constraints.forEach(function(c){var nx=applyScopes(c.scopes||[],18,fan);c.values=nx.values;});});return JSON.stringify(s);})')(text);
  return JSON.parse(json);
}
function cellOf(set, name, layer) {
  const c = (set.constraints || []).find(x => x.name === name);
  if (!c) throw new Error(set.title + ' 没有「' + name + '」这一列');
  return c.values['L' + layer];
}

setTimeout(() => {
  const sets = parseAndFill(sampleText);

  console.log('== 表格型约束：类别与条数 ==');
  t('一共产出 22 条约束', () => eq(sets.length, 22));
  t('分 5 类：SMA 6 条 + BGA 16 条', () => {
    const groups = [];
    sets.forEach(s => { if (groups.indexOf(s.group) < 0) groups.push(s.group); });
    eq(groups.length, 5, '类数');
    eq(sets.filter(s => s.kind === 'SMA').length, 6, 'SMA');
    eq(sets.filter(s => s.kind === 'BGA').length, 16, 'BGA');
  });
  t('5 类的标题就是原文（序号标错也照原文保留）', () => {
    const groups = [];
    sets.forEach(s => { if (groups.indexOf(s.group) < 0) groups.push(s.group); });
    eq(groups, ['一、SMA封装方案',
      '五、BGA封装方案，信号孔连接层L2至L4',
      '六、BGA封装方案，信号孔连接层L2至L12',
      '七、BGA封装方案，信号孔连接层Top至L4',
      '八、BGA封装方案，信号孔连接层Top至L12']);
  });
  t('命名按 SMA-Top-L2 / BGA-L2-L4-0.5mm 规则，顺序与原文一致', () => {
    eq(sets.map(s => s.title), [
      'SMA-Top-L2', 'SMA-Top-L3', 'SMA-Top-L4', 'SMA-Bot-L13', 'SMA-Bot-L12', 'SMA-Bot-L11',
      'BGA-L2-L4-0.5mm', 'BGA-L2-L4-0.6mm', 'BGA-L2-L4-0.7mm', 'BGA-L2-L4-0.8mm',
      'BGA-L2-L12-0.5mm', 'BGA-L2-L12-0.6mm', 'BGA-L2-L12-0.7mm', 'BGA-L2-L12-0.8mm',
      'BGA-Top-L4-0.5mm', 'BGA-Top-L4-0.6mm', 'BGA-Top-L4-0.7mm', 'BGA-Top-L4-0.8mm',
      'BGA-Top-L12-0.5mm', 'BGA-Top-L12-0.6mm', 'BGA-Top-L12-0.7mm', 'BGA-Top-L12-0.8mm'
    ]);
  });
  t('22 条名字不重复', () => {
    const seen = {};
    sets.forEach(s => { if (seen[s.title]) throw new Error('重名 ' + s.title); seen[s.title] = 1; });
  });
  t('每条约束都有反焊盘 + 焊盘两列', () => {
    sets.forEach(s => {
      const names = s.constraints.map(c => c.name);
      if (names.indexOf('反焊盘半径') < 0) throw new Error(s.title + ' 缺反焊盘列');
      if (!names.some(n => n === '焊盘半径' || n === '焊盘直径')) throw new Error(s.title + ' 缺焊盘列');
    });
  });

  console.log('== 表格型约束：每层数值 ==');
  const byName = n => sets.find(s => s.title === n);
  t('SMA-Top-L2：L1 13/6.5，L2 25/5.25', () => {
    const s = byName('SMA-Top-L2');
    eq([cellOf(s, '反焊盘半径', 1), cellOf(s, '焊盘半径', 1)], ['13', '6.5'], 'L1');
    eq([cellOf(s, '反焊盘半径', 2), cellOf(s, '焊盘半径', 2)], ['25', '5.25'], 'L2');
  });
  t('SMA-Bot-L11：L14 13/6.5、L13 12、L12 13、L11 25/5.25', () => {
    const s = byName('SMA-Bot-L11');
    eq(cellOf(s, '反焊盘半径', 11), '25', 'L11 反焊盘');
    eq(cellOf(s, '焊盘半径', 11), '5.25', 'L11 焊盘');
    eq(cellOf(s, '反焊盘半径', 14), '13', 'L14 反焊盘');
    eq(cellOf(s, '焊盘半径', 14), '6.5', 'L14 焊盘');
  });
  t('标题写错的那张表（原文两次 Top至L3、数据写到 L4）→ 以表格为准生成 SMA-Top-L4', () => {
    const s = byName('SMA-Top-L4');
    eq(cellOf(s, '反焊盘半径', 4), '25', 'L4 反焊盘');
    eq(cellOf(s, '焊盘半径', 3), '5.25', 'L3 焊盘');
    if (byName('SMA-Top-L3').constraints[0].values['L4']) throw new Error('SMA-Top-L3 不该有 L4');
  });
  t('BGA-L2-L12-0.5mm：L2/L12 反焊盘 50，L5 焊盘保留「激光孔 10.5；机械孔12」', () => {
    const s = byName('BGA-L2-L12-0.5mm');
    eq([cellOf(s, '反焊盘半径', 2), cellOf(s, '反焊盘半径', 12)], ['50', '50']);
    eq(cellOf(s, '焊盘直径', 5), '激光孔 10.5；机械孔12');
  });
  t('BGA-L2-L12-0.8mm：L5/L10 焊盘是「激光孔 10.5；机械孔为异型焊盘」', () => {
    const s = byName('BGA-L2-L12-0.8mm');
    eq(cellOf(s, '焊盘直径', 5), '激光孔 10.5；机械孔为异型焊盘');
    eq(cellOf(s, '焊盘直径', 10), '激光孔 10.5；机械孔为异型焊盘');
  });
  t('「无」原样保留（L6/L9 焊盘、L1 焊盘）', () => {
    const s = byName('BGA-L2-L12-0.6mm');
    eq([cellOf(s, '焊盘直径', 1), cellOf(s, '焊盘直径', 6), cellOf(s, '焊盘直径', 9)], ['无', '无', '无']);
  });
  t('BGA-Top-L4-0.5mm：L4 反焊盘 50，L1-L3 为 9', () => {
    const s = byName('BGA-Top-L4-0.5mm');
    eq([cellOf(s, '反焊盘半径', 1), cellOf(s, '反焊盘半径', 2), cellOf(s, '反焊盘半径', 3), cellOf(s, '反焊盘半径', 4)],
      ['9', '9', '9', '50']);
  });
  t('出线层按名字里的层号识别（SMA-Top-L2 → L2，SMA-Bot-L11 → L11）', () => {
    eq([w.eval('fanLayerOf')(byName('SMA-Top-L2')), w.eval('fanLayerOf')(byName('SMA-Bot-L11'))], [2, 11]);
  });

  console.log('== GBK 编码 ==');
  t('GBK 字节（B7B4 BAB8 C5CC）能解成「反焊盘」', () => {
    const out = w.eval('decodeTxt')(new Uint8Array([0xB7, 0xB4, 0xBA, 0xB8, 0xC5, 0xCC]));
    if (out.text !== '反焊盘') throw new Error(JSON.stringify(out));
    eq(out.enc, 'GB18030');
  });
  t('GBK 整份文件用 decodeTxt 解码后仍解析出 22 条', () => {
    const gbk = gbkBytes(sampleText);
    const dec = w.eval('decodeTxt')(gbk);
    eq(dec.enc, 'GB18030');
    eq(parseAndFill(dec.text).length, 22);
  });

  console.log('== 老格式不回归 ==');
  t('参数行写法（L17层扇出SMA）仍然 1 组、两列', () => {
    const old = parseAndFill(legacyText);
    eq(old.length, 1);
    const names = old[0].constraints.map(c => c.name);
    if (names.indexOf('反焊盘半径') < 0) throw new Error(names.join(','));
    if (names.indexOf('焊盘半径') < 0) throw new Error(names.join(','));
  });

  console.log('== 页面渲染 ==');
  t('导入后 ② 页出 22 个约束卡、5 个类标题', () => {
    w.eval('(function(txt){S.queue=[{id:1,name:"约束示例_表格型.txt",text:txt,status:""}];rebuild();})')(sampleText);
    eq(d.querySelectorAll('#sets .set').length, 22, '约束卡');
    eq(d.querySelectorAll('#sets .setgroup').length, 5, '类标题');
    const groups = [].map.call(d.querySelectorAll('#sets .setgroup'), el => el.textContent);
    eq(groups[0], '一、SMA封装方案');
    eq(groups[4], '八、BGA封装方案，信号孔连接层Top至L12');
  });
  t('生成的提示讲清「条约束 / 列参数」', () => {
    const hint = d.getElementById('genHint').textContent;
    if (hint.indexOf('22 条约束') < 0) throw new Error(hint);
    if (hint.indexOf('44 列参数') < 0) throw new Error(hint);
  });
  t('表头能编辑，来源注明是 TXT 的哪一层', () => {
    const cell = d.querySelector('#sets .set .cCell');
    if (!cell) throw new Error('没有可编辑的数值格');
    const note = d.querySelector('#sets .set .srcnote');
    if (!note || note.textContent.indexOf('L1') < 0) throw new Error(note ? note.textContent : '缺来源');
  });
  t('约束指引按面分组：BGA 16、SMA · Top 面 3、SMA · bottom 面 3', () => {
    const cols = [].map.call(d.querySelectorAll('#jumpNav .jumpcol'), c => ({
      h: c.querySelector('.jumpcol-h').textContent.replace(/\s+/g, ' ').trim(),
      n: c.querySelectorAll('a').length
    }));
    eq(cols, [
      { h: 'BGA 16', n: 16 },
      { h: 'SMA · Top 面 3', n: 3 },
      { h: 'SMA · bottom 面 3', n: 3 }
    ]);
  });
  t('约束指引是横排：每组一行、chips 横向自动换行（不再是竖列）', () => {
    const block = (html.match(/\.jumpcol\{[^}]*\}/) || [''])[0];
    if (!/flex-wrap:wrap/.test(block)) throw new Error('没有横向换行：' + block);
    if (!/width:100%/.test(block)) throw new Error('没有占满整行：' + block);
    if (/max-width:250px/.test(block)) throw new Error('还在用竖列宽度：' + block);
    if (/\.jumpcol a\{[^}]*width:100%/.test((html.match(/\.jumpcol a\{[^}]*\}/) || [''])[0])) throw new Error('chip 仍然整行铺满');
    const nav = w.eval('(function(){var c=document.querySelector("#jumpNav .jumpcol");var a=c.querySelector("a");return getComputedStyle(c).display+"|"+getComputedStyle(c).flexWrap+"|"+getComputedStyle(a).display;})()');
    eq(nav, 'flex|wrap|inline-flex');
  });
  t('约束指引的 chip 都指向对应约束卡', () => {
    const links = [].map.call(d.querySelectorAll('#jumpNav a'), a => a.getAttribute('href'));
    eq(links.length, 22);
    links.forEach(h => { if (!/^#set-\d+$/.test(h)) throw new Error('坏链接 ' + h); });
    eq([...new Set(links)].length, 22);
  });
  t('综合一体化页的约束指引用同一套横排规则', () => {
    const uni = fs.readFileSync(path.join(dir, 'unified.html'), 'utf8');
    const block = (uni.match(/\.jumpcol \{[^}]*\}/) || [''])[0];
    if (!/flex-wrap: wrap/.test(block)) throw new Error('没有横向换行：' + block);
    if (!/width: 100%/.test(block)) throw new Error('没有占满整行：' + block);
    if (/max-width: 250px/.test(block)) throw new Error('还是竖列宽度：' + block);
    if (uni.indexOf('按封装/面分组') < 0) throw new Error('指引文案没改');
  });
  t('命名说明不在页头，落在本页页尾', () => {
    const sec = d.getElementById('tab-sets');
    const top = sec.querySelector('.card');
    if (top.textContent.indexOf('表格写法') >= 0) throw new Error('页头还挂着长说明');
    if (top.textContent.indexOf('点击下面的约束名') < 0) throw new Error('页头没有一句短引导：' + top.textContent.trim());
    const kids = [].slice.call(sec.children);
    const last = kids[kids.length - 1];
    if (!last || last.id !== 'namingNote') throw new Error('页尾不是说明卡：' + (last && last.tagName + '#' + last.id));
    const txt = last.textContent.replace(/\s+/g, ' ');
    ['参数行写法', '表格写法', 'SMA-Top-L2', 'BGA-L2-L4-0.5mm', 'L18及以上', '填无'].forEach(k => {
      if (txt.indexOf(k) < 0) throw new Error('说明缺「' + k + '」');
    });
    if (last.querySelector('h2').textContent.indexOf('说明') < 0) throw new Error('说明卡没有标题');
  });
  t('说明卡在最后一张约束卡之后（滚动到底才看到）', () => {
    const note = d.getElementById('namingNote');
    const sets = d.getElementById('rulesBody');
    if (sets.compareDocumentPosition(note) !== 4) throw new Error('说明卡位置不对');
    if (note.querySelectorAll('.set').length) throw new Error('说明卡里混进了约束卡');
  });
  t('② 页没冒出来的 emoji 图标', () => {
    const bad = /[\u{1F300}-\u{1FAFF}\u{2190}\u{21A9}\u{2705}\u{274C}\u{26A1}\u{1F50D}]/u;
    const h = d.getElementById('sets').innerHTML;
    const m = h.match(bad);
    if (m) throw new Error('出现图标 ' + m[0]);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
}, 400);

/* 用 Node 的 gb18030 反查表把 UTF-8 文本转成 GBK 字节，用来测解码回退 */
function gbkBytes(text) {
  const dec = new TextDecoder('gb18030');
  const table = new Map();
  for (let hi = 0x81; hi <= 0xFE; hi++) {
    for (let lo = 0x40; lo <= 0xFE; lo++) {
      if (lo === 0x7F) continue;
      const ch = dec.decode(new Uint8Array([hi, lo]));
      if (ch.length === 1 && ch !== '\uFFFD' && !table.has(ch)) table.set(ch, [hi, lo]);
    }
  }
  const out = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 0x80) { out.push(code); continue; }
    const pair = table.get(ch);
    if (!pair) throw new Error('GBK 里没有 ' + ch);
    out.push(pair[0], pair[1]);
  }
  return new Uint8Array(out);
}
