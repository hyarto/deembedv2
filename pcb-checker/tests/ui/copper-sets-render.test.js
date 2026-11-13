/* ============================================================================
 * copper-sets-render.test.js —— 约束检查页「生成的约束」渲染回归
 * 迁自 main 的 copper-rule-import-test.js「页面渲染」组（重构时被误删）：
 * 22 个约束卡 / 5 类标题、生成提示、表头可编辑、约束指引分组与横排、命名说明位置、无 emoji。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { openPage, readPageCss, CHECKER_DIR } = require('../helpers/open-page');

const ctx = openPage('copper.html');
const { w, d } = ctx;
const sampleText = fs.readFileSync(path.join(CHECKER_DIR, 'sample/约束示例_表格型.txt'), 'utf8');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '  -> ' + e.message); }
}
function eq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg ? msg + '：' : '') + sa + ' ≠ ' + sb);
}

setTimeout(() => {
  console.log('== 约束页渲染：表格型约束 ==');
  w.eval('(function(txt){S.queue=[{id:1,name:"约束示例_表格型.txt",text:txt,status:""}];rebuild();})')(sampleText);

  t('导入后 ② 页出 22 个约束卡、5 个类标题', () => {
    eq(d.querySelectorAll('#sets .set').length, 22, '约束卡');
    eq(d.querySelectorAll('#sets .setgroup').length, 5, '类标题');
    const groups = [].map.call(d.querySelectorAll('#sets .setgroup'), el => el.textContent.trim());
    eq(groups[0], '一、SMA封装方案');
    eq(groups[4], '八、BGA封装方案，信号孔连接层Top至L12');
  });

  t('生成提示给出约束条数与参数列数', () => {
    const hint = d.getElementById('genHint').textContent;
    if (hint.indexOf('22 条约束') < 0) throw new Error(hint);
    if (hint.indexOf('44 列参数') < 0) throw new Error(hint);
  });

  t('数值格可编辑，来源注明 TXT 的哪一层', () => {
    if (!d.querySelector('#sets .set .cCell')) throw new Error('没有可编辑的数值格');
    const note = d.querySelector('#sets .set .srcnote');
    if (!note || note.textContent.indexOf('L1') < 0) throw new Error(note ? note.textContent : '缺来源');
  });

  t('约束指引按面分组：BGA 16、SMA Top 面 3、SMA bottom 面 3', () => {
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

  t('约束指引横排：每组占满一行，chip 横向自动换行', () => {
    const { css } = readPageCss('copper.html');
    const block = (css.match(/\.jumpcol\s*\{[^}]*\}/) || [''])[0];
    if (!/flex-wrap:\s*wrap/.test(block)) throw new Error('没有横向换行：' + block);
    if (!/width:\s*100%/.test(block)) throw new Error('没有占满整行：' + block);
    if (/max-width:\s*250px/.test(block)) throw new Error('还在用竖列宽度：' + block);
    const col = d.querySelector('#jumpNav .jumpcol');
    const cs = w.getComputedStyle(col);
    eq(cs.display + '|' + cs.flexWrap, 'flex|wrap');
  });

  t('约束指引的 chip 都指向对应约束卡且不重复', () => {
    const links = [].map.call(d.querySelectorAll('#jumpNav a'), a => a.getAttribute('href'));
    eq(links.length, 22);
    links.forEach(h => {
      if (!/^#set-\d+$/.test(h)) throw new Error('坏链接 ' + h);
      if (!d.querySelector(h)) throw new Error('链接目标不存在 ' + h);
    });
    eq([...new Set(links)].length, 22);
  });

  t('综合一体化页的约束指引使用同一套横排规则', () => {
    const { css } = readPageCss('unified.html');
    const block = (css.match(/\.jumpcol\s*\{[^}]*\}/) || [''])[0];
    if (!/flex-wrap:\s*wrap/.test(block)) throw new Error('没有横向换行：' + block);
    if (!/width:\s*100%/.test(block)) throw new Error('没有占满整行：' + block);
    if (/max-width:\s*250px/.test(block)) throw new Error('还是竖列宽度：' + block);
  });

  t('命名说明不在页头，落在页尾，内容含命名与填法规则', () => {
    const sec = d.getElementById('tab-sets');
    const top = sec.querySelector('.card');
    if (top.textContent.indexOf('表格型命名') >= 0) throw new Error('页头挂着命名说明');
    const last = [].slice.call(sec.children).pop();
    if (!last || last.id !== 'namingNote') throw new Error('页尾不是说明块：' + (last && last.tagName + '#' + last.id));
    const txt = last.textContent.replace(/\s+/g, ' ');
    ['参数行命名', '表格型命名', 'SMA-Top-L2', 'BGA-L2-L4-0.5mm', 'L18及以上', '无'].forEach(k => {
      if (txt.indexOf(k) < 0) throw new Error('说明缺「' + k + '」');
    });
  });

  t('说明块在最后一张约束卡之后，且不混入约束卡', () => {
    const note = d.getElementById('namingNote');
    const body = d.getElementById('rulesBody');
    if (body.compareDocumentPosition(note) !== 4) throw new Error('说明块位置不对');
    if (note.querySelectorAll('.set').length) throw new Error('说明块里混进了约束卡');
  });

  t('② 页没有 emoji 图标字符', () => {
    const bad = /[\u{1F300}-\u{1FAFF}\u{2190}\u{21A9}\u{2705}\u{274C}\u{26A1}\u{1F50D}]/u;
    const m = d.getElementById('sets').innerHTML.match(bad);
    if (m) throw new Error('出现图标 ' + m[0]);
  });

  t('页面无脚本错误', () => {
    if (ctx.errors.length) throw new Error(ctx.errors.join('；'));
  });

  console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
  process.exit(failed ? 1 : 0);
}, 400);
