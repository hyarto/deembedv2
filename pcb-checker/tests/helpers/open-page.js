/* ============================================================================
 * open-page.js —— JSDOM 页面加载辅助器（统一内联外部 CSS 与模块化 JS 包）
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const CHECKER_DIR = path.resolve(__dirname, '../..');

function resolveAssetPath(relHref) {
  const clean = String(relHref || '').split('?')[0].split('#')[0].trim();
  return path.join(CHECKER_DIR, clean);
}

function inlinePageAssets(page, options = {}) {
  const raw = fs.readFileSync(path.join(CHECKER_DIR, page), 'utf8');
  const skipScript = typeof options.skipScript === 'function' ? options.skipScript : null;

  const withCss = raw.replace(
    /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
    (_, href) => {
      const cssPath = resolveAssetPath(href);
      const css = fs.readFileSync(cssPath, 'utf8');
      return `<style data-href="${href}">\n${css}\n</style>`;
    }
  );

  if (options.inlineScripts === false) {
    return withCss;
  }

  return withCss.replace(
    /<script([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi,
    (full, _a, src) => {
      if (skipScript && skipScript(src)) return '';
      const jsPath = resolveAssetPath(src);
      const js = fs.readFileSync(jsPath, 'utf8');
      return `<script data-src="${src}">\n${js}\n</script>`;
    }
  );
}

function readPageCss(page) {
  const raw = fs.readFileSync(path.join(CHECKER_DIR, page), 'utf8');
  const chunks = [];
  const ownChunks = [];

  for (const m of raw.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const href = m[1];
    const css = fs.readFileSync(resolveAssetPath(href), 'utf8');
    chunks.push(css);
    if (!/eda-shell\.css/i.test(href)) {
      ownChunks.push(css);
    }
  }
  for (const m of raw.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    chunks.push(m[1]);
    ownChunks.push(m[1]);
  }

  const css = chunks.join('\n');
  const own = ownChunks.join('\n');
  return {
    full: raw,
    css,
    own,
    normalized: css.replace(/\s+/g, '').toLowerCase()
  };
}

function openPage(page, options = {}) {
  const runScripts = options.runScripts !== false;
  const html = inlinePageAssets(page, {
    inlineScripts: runScripts,
    skipScript: options.skipScript
  });

  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => {
    const msg = String((e && e.message) || e);
    if (/Not implemented/i.test(msg)) return;
    errors.push(msg);
  });
  vc.on('error', (...args) => {
    errors.push(args.map(String).join(' '));
  });

  const url = options.url || ('http://localhost:8000/' + page);
  const dom = new JSDOM(html, {
    url,
    runScripts: runScripts ? 'dangerously' : undefined,
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      if (options.syncCheck) {
        w.__SYNC_CHECK__ = true;
      }
      if (options.seedStorage && typeof options.seedStorage === 'object') {
        for (const [k, v] of Object.entries(options.seedStorage)) {
          try {
            w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
          } catch (err) {}
        }
      }
      if (typeof options.beforeParse === 'function') {
        options.beforeParse(w);
      }
    }
  });

  return {
    dom,
    w: dom.window,
    d: dom.window.document,
    errors,
    close: () => dom.window.close()
  };
}

const tick = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
  CHECKER_DIR,
  resolveAssetPath,
  inlinePageAssets,
  readPageCss,
  openPage,
  tick
};
