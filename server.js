/* 小聊 · 本地代理服务器
   作用：托管静态页面 + 转发 AI 接口请求，解决浏览器跨域(CORS)问题。
   运行：node server.js   然后浏览器打开 http://localhost:3000
   零依赖，只用 Node 自带模块。 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(function (req, res) {
  // ---------- AI 接口代理 ----------
  if (req.method === 'POST' && (req.url === '/api/chat' || req.url.startsWith('/api/chat?'))) {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', function () {
      let p;
      try { p = JSON.parse(body); } catch (e) { return sendJson(res, 400, { error: { message: '请求格式错误' } }); }
      const baseUrl = (p.baseUrl || '').replace(/\/+$/, '');
      if (!baseUrl || !p.apiKey || !p.model) {
        return sendJson(res, 400, { error: { message: '缺少 baseUrl / apiKey / model' } });
      }
      let target;
      try { target = new URL(baseUrl + '/chat/completions'); }
      catch (e) { return sendJson(res, 400, { error: { message: '接口地址无效：' + e.message } }); }

      const payload = JSON.stringify({
        model: p.model,
        messages: p.messages || [],
        temperature: p.temperature,
        max_tokens: p.max_tokens,
        stream: !!p.stream
      });

      const mod = target.protocol === 'https:' ? https : http;
      const options = {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + p.apiKey,
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      const proxyReq = mod.request(options, function (proxyRes) {
        res.writeHead(proxyRes.statusCode || 502, {
          'Content-Type': proxyRes.headers['content-type'] || 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no'
        });
        proxyRes.pipe(res);
      });
      proxyReq.on('error', function (err) {
        if (!res.headersSent) sendJson(res, 502, { error: { message: '无法连接模型接口：' + err.message } });
        else res.end();
      });
      proxyReq.write(payload);
      proxyReq.end();
    });
    return;
  }

  // ---------- 静态文件 ----------
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) { urlPath = '/'; }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);
  if (filePath.indexOf(ROOT) !== 0) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 Not Found'); }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, function () {
  console.log('小聊已启动 → http://localhost:' + PORT);
});
