#!/usr/bin/env node
/**
 * 零依赖静态文件服务器：以 pcb-checker/ 为站点根目录，支持统一入口主页与双模式分入口启动。
 *
 * 用法：
 *   node serve.js [端口]                 -> 默认统一入口主页 (portal.html)
 *   node serve.js --entry=pcb [端口]     -> 默认进入 PCB 专项检查 (index.html)
 *   node serve.js --entry=si [端口]      -> 默认进入 SI 综合一体化工作台 (unified.html)
 *   也可使用环境变量 PORT=8080 ENTRY=portal|pcb|si
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'pcb-checker');

const ENTRY_MAP = {
  portal: 'portal.html',
  pcb: 'index.html',
  si: 'unified.html',
  unified: 'unified.html'
};

function parseCliArgs(argv) {
  let port = null;
  let entry = null;
  for (const arg of argv) {
    if (arg.startsWith('--entry=')) {
      entry = arg.slice('--entry='.length).trim().toLowerCase();
    } else if (/^\d+$/.test(arg)) {
      port = Number(arg);
    }
  }
  return {
    port: port || Number(process.env.PORT || 8000),
    entry: entry || String(process.env.ENTRY || 'portal').toLowerCase()
  };
}

function resolveDefaultPage(entry) {
  return ENTRY_MAP[entry] || 'portal.html';
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.ico': 'image/x-icon'
};

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({ 'Cache-Control': 'no-store' }, headers));
  res.end(body);
}

function createAppServer(options = {}) {
  const defaultPage = resolveDefaultPage(options.entry || 'portal');
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'Method Not Allowed', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (e) {
      return send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    if (urlPath === '/') {
      urlPath = '/' + defaultPage;
    } else if (urlPath.endsWith('/')) {
      urlPath += 'index.html';
    }
    const filePath = path.join(ROOT, path.normalize(urlPath));

    // 防目录穿越：解析后必须仍位于站点根目录内
    if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
      return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        return send(res, 404, '404 Not Found: ' + urlPath, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': stat.size,
        'Cache-Control': 'no-store'
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filePath).pipe(res);
    });
  });
}

if (require.main === module) {
  const { port, entry } = parseCliArgs(process.argv.slice(2));
  const host = process.env.HOST || '0.0.0.0';
  const defaultPage = resolveDefaultPage(entry);
  const server = createAppServer({ entry });
  server.listen(port, host, () => {
    const base = 'http://localhost:' + port;
    console.log('PCB 检查与 SI 工作台服务已启动： ' + base + '/  (默认入口: ' + defaultPage + ')');
    console.log('  统一入口主页：     ' + base + '/portal.html');
    console.log('  PCB 专项检查入口： ' + base + '/index.html');
    console.log('  SI 一体化工作台：  ' + base + '/unified.html');
    console.log('站点根目录：' + ROOT);
  });
}

module.exports = { createAppServer, resolveDefaultPage, parseCliArgs };
