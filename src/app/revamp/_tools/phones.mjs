// Local phone preview. Serves /phones and passes everything else to the prototype on :3151
// without the headers that stop it loading in a frame. Run: node phones.mjs
import http from 'node:http';
const PAGES = [['Home A', '/revamp/home?l=a&bare'], ['Home B', '/revamp/home?l=b&bare'], ['Home C', '/revamp/home?l=c&bare'], ['Collections', '/revamp/c'], ['Slime Moulds', '/revamp/c/slime-moulds'], ['Subject', '/revamp/s/alchemy']];
const html = `<!doctype html><meta charset=utf-8><title>Phone preview</title><style>
body{margin:0;background:#f5f0e8;font:15px Inter,-apple-system,sans-serif;color:#1a1612}
.row{display:flex;gap:28px;padding:24px;overflow-x:auto}
figure{margin:0;flex:none}figcaption{margin:0 0 8px;font-weight:600}
.ph{width:390px;height:844px;border:10px solid #1a1612;border-radius:44px;overflow:hidden;background:#000}
iframe{width:390px;height:844px;border:0;display:block}</style>
<div class=row>${PAGES.map(([t, u]) => `<figure><figcaption>${t}</figcaption><div class=ph><iframe src="${u}" loading=lazy></iframe></div></figure>`).join('')}</div>`;
http.createServer((q, s) => {
  if (q.url === '/phones') { s.writeHead(200, { 'content-type': 'text/html' }); return s.end(html); }
  const p = http.request({ host: '127.0.0.1', port: 3151, path: q.url, method: q.method, headers: { ...q.headers, host: 'localhost:3151' } }, (r) => {
    const h = { ...r.headers }; delete h['x-frame-options']; delete h['content-security-policy'];
    s.writeHead(r.statusCode, h); r.pipe(s);
  });
  p.on('error', () => { s.writeHead(502); s.end(); });
  q.pipe(p);
}).listen(3152, '127.0.0.1', () => console.log('http://localhost:3152/phones'));
