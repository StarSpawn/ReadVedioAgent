import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
http.createServer(async (req,res) => {
  try {
    const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const target = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!target.startsWith(root + path.sep)) {res.writeHead(403); return res.end();}
    const data = await readFile(target);
    res.writeHead(200, {'Content-Type':mime[path.extname(target)] || 'application/octet-stream','Cache-Control':'no-cache'});
    res.end(data);
  } catch {res.writeHead(404);res.end('Not found');}
}).listen(4173, '127.0.0.1', () => console.log('帧迹已启动：http://127.0.0.1:4173'));
