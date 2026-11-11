#!/usr/bin/env node
// Stage-0 check for the reader-origin box (#8384), on loopback through Caddy. Run on the box:
//
//   SL_BOX_SECRET=… node stage0-check.mjs <book-slug> <reader-path> <book-objectid> [host:port]
//
// 1. Trap 1: every CSS and JS URL on a box page (book landing + reader) is under /_box and
//    returns 200 from the box; no page references a bare /_next/static URL (that would be
//    Vercel's build).
// 2. Tenant hosts are not served: a partner Host gets no page, and a forged
//    X-Forwarded-Host never reaches Next (the redirect below stays on the apex).
// 3. Redirects use the public origin: /book/<objectid> → https://sourcelibrary.org/book/<slug>.
// 4. Requests without the secret are refused before Next.
// 5. Trap 6: a second request for the landing page reports its ISR state (x-nextjs-cache).
// Each page request costs Atlas reads only on a cache miss; the script makes at most 6.
import https from 'node:https';

const [slug, readerPath, objectId, site = 'box1.sourcelibrary.org:8443'] = process.argv.slice(2);
const [siteHost, sitePort] = site.split(':');
const SECRET = process.env.SL_BOX_SECRET;
if (!slug || !readerPath || !objectId || !SECRET) {
  console.error('usage: SL_BOX_SECRET=… node stage0-check.mjs <slug> <reader-path> <objectid> [host:port]');
  process.exit(2);
}
const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

function get(path, { host = site, sni = siteHost, secret = SECRET, headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = https.request({
      host: '127.0.0.1', port: Number(sitePort || 443), servername: sni, path, agent,
      headers: { Host: host, 'User-Agent': 'sl-web-stage0-8384', 'X-SL-Client-IP': '198.51.100.84', 'X-SL-Client-Country': 'NL', ...(secret ? { 'X-SL-Origin-Secret': secret } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (e) => resolve({ status: 0, error: e.code || e.message, headers: {}, body: '' }));
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const checks = [];
const check = (name, pass, detail = '') => { checks.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

function assetUrls(html) {
  const urls = new Set();
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)) urls.add(m[1]);
  return [...urls];
}

for (const [label, path] of [['landing', `/book/${slug}`], ['reader', readerPath]]) {
  const page = await get(path);
  check(`${label} page renders`, page.status === 200, `${page.status} ${path}`);
  const urls = assetUrls(page.body);
  const bare = urls.filter((u) => u.startsWith('/_next/'));
  const boxed = urls.filter((u) => u.startsWith('/_box/_next/static/'));
  check(`${label}: no bare /_next asset URL`, bare.length === 0, `${bare.length} bare, ${boxed.length} under /_box`);
  check(`${label}: has CSS and JS under /_box`, boxed.some((u) => u.includes('.css')) && boxed.some((u) => u.includes('.js')));
  const bad = [];
  for (const u of boxed) {
    const r = await get(u);
    if (r.status !== 200) bad.push(`${r.status} ${u}`);
  }
  check(`${label}: every /_box asset returns 200`, bad.length === 0, bad.length ? bad.slice(0, 5).join(', ') : `${boxed.length} assets`);
  // The webpack runtime loads later chunks from its public path: it must be /_box too.
  check(`${label}: runtime public path is /_box`, /\/_box\/_next\//.test(page.body), '');
}

const noSecret = await get(`/book/${slug}`, { secret: null });
check('no secret → 403 before Next', noSecret.status === 403, String(noSecret.status));

const tenant = await get(`/book/${slug}`, { host: 'bph.sourcelibrary.org', sni: 'bph.sourcelibrary.org' });
check('tenant Host (bph) is not served', tenant.status !== 200 || !/<html/i.test(tenant.body), `${tenant.status || tenant.error}`);

const redirect = await get(`/book/${objectId}`, { headers: { 'X-Forwarded-Host': 'bph.sourcelibrary.org' } });
const loc = redirect.headers.location || '';
check('/book/<objectid> redirects to the public origin', [301, 307, 308].includes(redirect.status) && loc.startsWith('https://sourcelibrary.org/book/'), `${redirect.status} ${loc}`);
check('forged X-Forwarded-Host does not reach Next', !loc.includes('bph.'), loc);

const again = await get(`/book/${slug}`);
check('trap 6: landing page ISR state on a repeat (informational)', true, `x-nextjs-cache: ${again.headers['x-nextjs-cache'] || '(none)'}; cache-control: ${again.headers['cache-control'] || ''}`);

const failed = checks.filter((c) => !c.pass);
console.log(failed.length ? `stage-0 check: ${failed.length} FAILED` : 'stage-0 check: all pass');
process.exit(failed.length ? 1 : 0);
