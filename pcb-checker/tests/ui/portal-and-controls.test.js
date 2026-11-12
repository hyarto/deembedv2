/* ============================================================================
 * portal-and-controls.test.js —— 统一入口、启动模式与合并后交互控件完整性回归测试
 *
 * 覆盖：
 *   1. 仓库根目录不再残留重复上传的 workspace/ 副本目录
 *   2. 六个检查页及统一入口页不存在文字被清空的 <button> 或 0 宽关闭 <span>
 *   3. 六个检查页所有内联 onclick / onchange / oninput 引用的函数在页面作用域均已定义
 *   4. 外部检查引擎脚本（*-check.js / pad-geom.js / ui-prefs.js）缓存版本号 ?v=N 全站一致
 *   5. portal.html 统一入口主页包含 PCB 五项独立检查入口与 SI 一体化工作台入口，且遵循统一风格
 *   6. serve.js 支持默认统一入口（portal）以及 --entry=pcb / --entry=si 两种独立启动方式
 * ========================================================================== */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { createAppServer, parseCliArgs } = require('../../../serve');
const { openPage, CHECKER_DIR } = require('../helpers/open-page');

const DIR = CHECKER_DIR;
const REPO_ROOT = path.resolve(DIR, '..');
const CHECKER_PAGES = ['index.html', 'copper.html', 'dfm.html', 'fanout.html', 'pour.html', 'unified.html'];
const ALL_PAGES = ['portal.html', ...CHECKER_PAGES];

let pass = 0;
let fail = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (err) {
    console.error(`  FAIL  ${name} -> ${err && err.message ? err.message : err}`);
    fail++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const openFullPage = page => openPage(page);

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

(async () => {
  console.log('\n== 统一入口、启动模式与交互控件完整性测试 ==');

  await test('仓库根目录不存在重复上传的 workspace/ 文件夹', () => {
    assert(!fs.existsSync(path.join(REPO_ROOT, 'workspace')), 'workspace/ 重复目录仍未删除');
  });

  await test('全站页面（含动态模板）不存在文字被清空的按钮或关闭控件', () => {
    const emptyItems = [];
    for (const page of ALL_PAGES) {
      const raw = fs.readFileSync(path.join(DIR, page), 'utf8');
      const btnRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
      let m;
      while ((m = btnRe.exec(raw)) !== null) {
        const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, '');
        if (!text && !/<(svg|img)\b/i.test(m[2])) {
          const line = raw.slice(0, m.index).split('\n').length;
          emptyItems.push(`${page}:${line} 空 <button>`);
        }
      }
      const spanRe = /<span\b([^>]*\bonclick=["'][^"']*(?:close|remove|display\s*=\s*\\?'none)[^"']*["'][^>]*)>([\s\S]*?)<\/span>/gi;
      while ((m = spanRe.exec(raw)) !== null) {
        const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, '');
        if (!text && !/<(svg|img)\b/i.test(m[2])) {
          const line = raw.slice(0, m.index).split('\n').length;
          emptyItems.push(`${page}:${line} 空关闭/移除 <span>`);
        }
      }
    }
    assert(emptyItems.length === 0, '发现空白交互控件：' + emptyItems.join(' | '));
  });

  await test('六个检查页内联事件（onclick/onchange/oninput）引用的函数全部已定义', async () => {
    const BUILTINS = new Set([
      'if', 'for', 'while', 'switch', 'return', 'catch', 'typeof',
      'Number', 'String', 'Boolean', 'parseFloat', 'parseInt', 'Math', 'Date',
      'Array', 'Object', 'Set', 'Map', 'encodeURIComponent', 'decodeURIComponent',
      'setTimeout', 'clearTimeout', 'alert', 'confirm', 'console', 'document', 'window', 'event', 'this'
    ]);
    const broken = [];
    for (const page of CHECKER_PAGES) {
      const ctx = openFullPage(page);
      await new Promise(r => setTimeout(r, 40));
      for (const attr of ['onclick', 'onchange', 'oninput']) {
        ctx.d.querySelectorAll(`[${attr}]`).forEach(el => {
          const code = el.getAttribute(attr) || '';
          const calls = [...code.matchAll(/(?<![.\w$])([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g)].map(x => x[1]);
          for (const fn of calls) {
            if (BUILTINS.has(fn)) continue;
            let kind = 'undefined';
            try { kind = ctx.w.eval(`typeof ${fn}`); } catch (e) { kind = 'error'; }
            if (kind !== 'function') {
              broken.push(`${page} #${el.id || el.tagName}: ${fn} -> ${kind}`);
            }
          }
        });
      }
      assert(ctx.errors.length === 0, `${page} 运行报错：${ctx.errors.join('; ')}`);
      ctx.close();
    }
    assert(broken.length === 0, '未定义的内联事件函数：' + broken.join(' | '));
  });

  await test('样式与脚本包的缓存版本号（?v=N）全站统一，且引用文件均存在', () => {
    const seen = new Set();
    for (const page of ALL_PAGES) {
      const raw = fs.readFileSync(path.join(DIR, page), 'utf8');
      const refs = [...raw.matchAll(/<script[^>]+src=["']([^"']+)["']/g), ...raw.matchAll(/<link[^>]+href=["']([^"']+\.css[^"']*)["']/g)];
      assert(refs.length > 0, `${page} 未引用任何外部资源`);
      for (const m of refs) {
        const [file, q] = m[1].split('?');
        assert(q && /^v=\d+$/.test(q), `${page} 引用 ${m[1]} 缺少 ?v=N 版本号`);
        assert(fs.existsSync(path.join(DIR, file)), `${page} 引用的 ${file} 不存在`);
        seen.add(q);
      }
    }
    assert(seen.size === 1, '全站 ?v= 版本号不一致：' + [...seen].join(', '));
  });

  await test('仓库根目录与 pcb-checker 根目录不残留旧单体脚本', () => {
    const legacy = ['pad-geom.js', 'copper-check.js', 'dfm-check.js', 'fanout-check.js', 'pour-check.js', 'ui-prefs.js', 'bench-perf.js'];
    const left = legacy.filter(f => fs.existsSync(path.join(DIR, f)));
    assert(left.length === 0, '残留旧单体文件：' + left.join(', '));
    const rootJs = fs.readdirSync(DIR).filter(f => f.endsWith('.js'));
    assert(rootJs.length === 0, 'pcb-checker 根目录不应放 js：' + rootJs.join(', '));
  });

  await test('portal.html 统一入口主页包含两大入口与全套导航且符合视觉规范', async () => {
    const ctx = openFullPage('portal.html');
    await new Promise(r => setTimeout(r, 30));
    const hrefs = [...ctx.d.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
    for (const target of CHECKER_PAGES) {
      assert(hrefs.includes(target), `portal.html 缺少指向 ${target} 的链接`);
    }
    const bodySize = ctx.w.getComputedStyle(ctx.d.body).fontSize;
    assert(bodySize === '14px', `portal.html 正文字号应为 14px，实际 ${bodySize}`);
    assert(ctx.errors.length === 0, 'portal.html 脚本报错：' + ctx.errors.join('; '));
    ctx.close();
  });

  await test('serve.js 支持默认统一入口及 --entry=pcb / --entry=si 双模式启动', async () => {
    assert(parseCliArgs(['--entry=pcb', '8090']).entry === 'pcb', 'CLI 解析 --entry=pcb 失败');
    assert(parseCliArgs(['--entry=si']).entry === 'si', 'CLI 解析 --entry=si 失败');

    const modes = [
      ['portal', 'PCB 检查与 SI 工作台 | 统一入口主页'],
      ['pcb', 'PCB 走线检查工具'],
      ['si', 'PCB 综合一体化检查']
    ];
    for (const [entry, expectedTitle] of modes) {
      const srv = createAppServer({ entry });
      await new Promise(r => srv.listen(0, '127.0.0.1', r));
      const port = srv.address().port;
      try {
        const res = await httpGet(port, '/');
        assert(res.status === 200, `entry=${entry} 返回状态码 ${res.status}`);
        assert(res.body.includes(expectedTitle), `entry=${entry} 首页标题不匹配，期望包含「${expectedTitle}」`);
      } finally {
        await new Promise(r => srv.close(r));
      }
    }
  });

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) process.exit(1);
})();
