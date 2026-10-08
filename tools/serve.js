// 零依赖静态服务器（Node 16 可用）。用法：node tools/serve.js [端口=5173] [子路径=/]
// 第二个参数模拟挂在子路径下（例如 GitHub Pages 的 /仓库名/）：node tools/serve.js 5214 /hivefall/ → http://127.0.0.1:5214/hivefall/
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.resolve(__dirname, '..');
const port = Number(process.argv[2]) || 5173;
const base = ('/' + (process.argv[3] || '').replace(/^\/+|\/+$/g, '') + '/').replace('//', '/');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.hdr': 'application/octet-stream', '.wasm': 'application/wasm', '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (base !== '/') { if (rel + '/' === base) { res.writeHead(301, { Location: base }); return res.end(); } if (!rel.startsWith(base)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404 (outside ' + base + ')'); } rel = '/' + rel.slice(base.length); }
  let file = path.join(root, rel);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) { file = path.join(file, 'index.html'); }
    fs.stat(file, (err2, st2) => {
      if (err2 || !st2.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404'); }
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
      const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Number(range[2]) : st2.size - 1;
        headers['Content-Range'] = `bytes ${start}-${end}/${st2.size}`;
        headers['Content-Length'] = end - start + 1;
        res.writeHead(206, headers);
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      headers['Content-Length'] = st2.size;
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(res);
    });
  });
}).listen(port, process.env.HIVEFALL_HOST || '127.0.0.1', () => console.log(`HIVEFALL dev server: http://${process.env.HIVEFALL_HOST || '127.0.0.1'}:${port}/`));
