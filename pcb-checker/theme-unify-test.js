/* ============================================================================
 * theme-unify-test.js —— 六个检查页「界面风格统一」回归测试
 *
 * 基准页：index.html（走线检查）。其余五页必须与它保持同一套视觉语言：
 *   1. 主体颜色：浅灰底 #f4f6f9、白卡片、分隔线 #e3e8ef、文字 #1f2937 / #6b7280、强调色 #2563eb
 *   2. 字号阶梯：正文 14px；卡片标题（h2 / .card-title）15px；小节标题（h3）13px
 *   3. 卡片：白底 + 1px 边框 + 10px 圆角，不加投影
 *   4. 统计卡：白底，状态只用文字/边框着色，不整块填色
 *   5. 标题前不加图标（emoji）
 *
 * 这些是「改一个页面忘了改其他页面」最容易踩的点，所以固化成回归测试。
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

function loadJsdom() {
  try { return require('jsdom'); }
  catch (e) {
    for (const t of ['/tmp/npmtest/node_modules/jsdom', '/home/user/node_modules/jsdom']) {
      try { return require(t); } catch (err) { /* next */ }
    }
    throw new Error('找不到 jsdom，请先执行 npm install');
  }
}
const { JSDOM, VirtualConsole } = loadJsdom();

const DIR = __dirname;
const PAGES = ['index.html', 'copper.html', 'dfm.html', 'fanout.html', 'pour.html', 'unified.html'];
const SHARED_MARK = '/* ===== 全站统一顶栏 + 页签条（六个检查页共用同一份，改动请同步六页） ===== */';

let pass = 0;
let fail = 0;
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

/** 页面自身的样式块（不含共用顶栏块），去掉空白方便做令牌匹配 */
function pageStyle(page) {
  const html = fs.readFileSync(path.join(DIR, page), 'utf8');
  const start = html.indexOf('<style>');
  const end = html.indexOf('</style>');
  const css = html.slice(start, end);
  const mark = css.indexOf(SHARED_MARK);
  const own = mark >= 0 ? css.slice(0, mark) : css;
  return { full: html, css, own, normalized: own.replace(/\s+/g, '').toLowerCase() };
}

function openPage(page) {
  const html = fs.readFileSync(path.join(DIR, page), 'utf8');
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  return new JSDOM(html, { url: 'http://localhost/' + page, virtualConsole: vc, pretendToBeVisual: true });
}

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

console.log('== 六页界面风格统一性测试（基准：index.html 走线检查）==');

/* 1. 主体颜色令牌 */
test('六页使用同一套颜色令牌（底色 / 卡片 / 分隔线 / 文字 / 强调色）', () => {
  PAGES.forEach(page => {
    const { normalized } = pageStyle(page);
    const must = [
      ['--bg:#f4f6f9', '页面底色'],
      ['--card:#fff', '卡片底色'],
      ['--line:#e3e8ef', '分隔线'],
      ['#1f2937', '正文色'],
      ['--sub:#6b7280', '次要文字色']
    ];
    must.forEach(([token, label]) => {
      const ok = normalized.includes(token) || normalized.includes(token.replace('--card:#fff', '--card:#ffffff'));
      if (!ok) throw new Error(`${page} 缺少 ${label} 令牌：${token}`);
    });
    const accent = ['--pri:#2563eb', '--accent:#2563eb'].some(t => normalized.includes(t));
    if (!accent) throw new Error(`${page} 的强调色不是 #2563eb`);
  });
});

const TOKENS = [
  ['index.html', ['--bg:#f4f6f9', '--pri:#2563eb', '--line:#e3e8ef', '--txt:#111827'].slice(0, 3)],
  ['copper.html', ['--bg:#f4f6f9', '--pri:#2563eb', '--line:#e3e8ef']],
  ['dfm.html', ['--bg:#f4f6f9', '--pri:#2563eb', '--line:#e3e8ef']],
  ['fanout.html', ['--bg:#f4f6f9', '--pri:#2563eb', '--line:#e3e8ef']],
  ['pour.html', ['--bg:#f4f6f9', '--pri:#2563eb', '--line:#e3e8ef']],
  ['unified.html', ['--bg:#f4f6f9', '--accent:#2563eb', '--line:#e3e8ef']]
];

test('强调色（按钮 / 链接 / 选中态）统一为 #2563eb，不再出现旧的 #0284c7', () => {
  PAGES.forEach(page => {
    const { normalized } = pageStyle(page);
    if (normalized.includes('#0284c7')) throw new Error(`${page} 仍残留旧的强调色 #0284c7`);
    const expect = page === 'unified.html' ? '--accent:#2563eb' : '--pri:#2563eb';
    if (!normalized.includes(expect)) throw new Error(`${page} 缺少 ${expect}`);
  });
});

/* 2. 字号阶梯 */
test('正文基准字号统一为 14px', () => {
  PAGES.forEach(page => {
    const { window } = openPage(page);
    const size = window.getComputedStyle(window.document.body).fontSize;
    if (size !== '14px') throw new Error(`${page} 正文 ${size}，应为 14px`);
  });
});

test('卡片标题 15px / 小节标题 13px（与走线检查一致）', () => {
  PAGES.forEach(page => {
    const { window } = openPage(page);
    const d = window.document;
    const cs = el => window.getComputedStyle(el);

    const cardTitles = Array.from(d.querySelectorAll('.card h2, .card .card-title'));
    if (!cardTitles.length) throw new Error(`${page} 找不到卡片标题（.card h2 / .card-title）`);
    cardTitles.forEach(el => {
      const size = cs(el).fontSize;
      if (size !== '15px') throw new Error(`${page} 卡片标题「${el.textContent.trim().slice(0, 16)}」${size}，应为 15px`);
    });

    Array.from(d.querySelectorAll('.card h3')).forEach(el => {
      const size = cs(el).fontSize;
      if (size !== '13px') throw new Error(`${page} 小节标题「${el.textContent.trim().slice(0, 16)}」${size}，应为 13px`);
    });
  });
});

test('标题字号不靠行内 style 特例（统一由样式表控制）', () => {
  PAGES.forEach(page => {
    const html = fs.readFileSync(path.join(DIR, page), 'utf8');
    const bad = [];
    const re = /<h([1-4])([^>]*)>/g;
    let m;
    while ((m = re.exec(html))) {
      if (/font-size\s*:/.test(m[2])) bad.push(m[0].slice(0, 60));
    }
    if (bad.length) throw new Error(`${page} 有行内字号：${bad.join(' | ')}`);
  });
});

/* 3. 卡片 / 统计卡不再有装饰性填充与投影 */
test('卡片：白底 + 1px 边框 + 10px 圆角 + 无投影', () => {
  PAGES.forEach(page => {
    const { window } = openPage(page);
    const card = window.document.querySelector('.card');
    if (!card) return;
    const cs = window.getComputedStyle(card);
    if (cs.boxShadow && cs.boxShadow !== 'none') throw new Error(`${page} 卡片仍有投影：${cs.boxShadow}`);
    if (cs.borderRadius !== '10px') throw new Error(`${page} 卡片圆角 ${cs.borderRadius}，应为 10px`);
    const { normalized } = pageStyle(page);
    const hasBorder = cs.borderTopWidth === '1px' ||
      normalized.includes('border:1pxsolidvar(--line)') || normalized.includes('border:1pxsolidvar(--card-border)') ||
      normalized.includes('border:1pxsolid#e3e8ef');
    if (!hasBorder) throw new Error(`${page} 卡片不是 1px 边框`);
  });
});

test('统计卡不再整块填色（状态只用数字/边框着色）', () => {
  PAGES.forEach(page => {
    const { window } = openPage(page);
    const d = window.document;
    Array.from(d.querySelectorAll('.stat-box, .stat')).forEach(el => {
      const cs = window.getComputedStyle(el);
      const bg = cs.backgroundColor;
      if (bg && bg !== 'rgb(255, 255, 255)' && bg !== 'rgba(0, 0, 0, 0)') {
        throw new Error(`${page} 统计卡仍有底色 ${bg}（${el.textContent.trim().slice(0, 12)}）`);
      }
    });
  });
});

test('表格正文字号 13px，且不再使用旧的 slate 文字色', () => {
  PAGES.forEach(page => {
    const { window } = openPage(page);
    const { normalized, css } = pageStyle(page);
    const table = window.document.querySelector('.card table');
    if (table) {
      const size = window.getComputedStyle(table).fontSize;
      if (size !== '13px') throw new Error(`${page} 表格字号 ${size}，应为 13px`);
    }
    ['#0f172a', '#64748b', '#475569'].forEach(bad => {
      const hit = new RegExp('color:\\s*' + bad, 'i').test(css);
      if (hit) throw new Error(`${page} 仍有旧文字色 ${bad}（应统一为 #111827 / #6b7280）`);
    });
  });
});

/* 4. 标题前的图标 */
test('全部标题不含 emoji 图标', () => {
  PAGES.forEach(page => {
    const html = fs.readFileSync(path.join(DIR, page), 'utf8');
    const bad = [];
    const re = /<h([1-4])([^>]*)>([\s\S]{0,120}?)<\/h\1>/g;
    let m;
    while ((m = re.exec(html))) {
      if (EMOJI.test(m[3])) bad.push(m[3].replace(/<[^>]+>/g, '').trim().slice(0, 24));
    }
    if (bad.length) throw new Error(`${page} 标题仍有图标：${bad.join(' | ')}`);
  });
});

test('六页正文使用同一套字体栈（Segoe UI / 微软雅黑）', () => {
  PAGES.forEach(page => {
    const { normalized } = pageStyle(page);
    if (!normalized.includes('"segoeui","microsoftyahei"')) {
      throw new Error(`${page} 字体栈不是 "Segoe UI","Microsoft YaHei"`);
    }
  });
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exitCode = fail === 0 ? 0 : 1;
