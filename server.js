// 服務建議書製作器 — 無外部相依套件，Node.js 16+ 即可執行
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data', 'templates.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

const save = d => { fs.mkdirSync(path.dirname(DATA), { recursive: true }); fs.writeFileSync(DATA, JSON.stringify(d, null, 2)); };
const load = () => { if (!fs.existsSync(DATA)) save(require('./defaults')); return JSON.parse(fs.readFileSync(DATA, 'utf8')); };
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/templates' && req.method === 'GET') return json(res, 200, load());
  if (url === '/api/templates' && req.method === 'PUT') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 10e6) req.destroy(); });
    return req.on('end', () => {
      try {
        const d = JSON.parse(body);
        if (!Array.isArray(d.templates)) throw new Error('格式錯誤');
        save(d); json(res, 200, { ok: true });
      } catch (e) { json(res, 400, { error: e.message }); }
    });
  }
  if (url === '/api/reset' && req.method === 'POST') { const d = require('./defaults'); save(d); return json(res, 200, d); }

  const file = path.join(PUB, url === '/' ? 'index.html' : url);
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`服務建議書製作器已啟動： http://localhost:${PORT}`));
