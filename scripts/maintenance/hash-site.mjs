#!/usr/bin/env node
/**
 * hash-site.mjs — hash a public website's pages and images into a Merkle snapshot with a public timestamp
 * (#8150 slice 10: "on the Embassy of the Free Mind site too"). Needs no access to the site: it reads the
 * sitemap like any visitor, politely (one request at a time, a pause between, an identifying User-Agent).
 *
 * PRIOR ART: scripts/maintenance/hash-snapshot.mjs (the same tree and stamp for OUR page texts, built from
 * the restic dump; a website has no dump, so it is fetched); scripts/lib/hash-snapshot.mjs `imageHashes`
 * (sha256 + dHash, reused here so a re-encoded copy of a site image still matches); scripts/lib/merkle.mjs;
 * scripts/lib/opentimestamps.mjs. No crawler exists in scripts/ for a site we do not run.
 *
 * Per page, two leaves: the exact HTML bytes (proves the file) and its visible text (tags, scripts and
 * styles dropped, whitespace collapsed), which stays the same when the site's build hashes or nonces
 * change, so a copied article can be matched to the week it was on the site. Per image: sha256 + dHash.
 *
 *   node scripts/maintenance/hash-site.mjs --sitemap https://www.embassyofthefreemind.com/sitemap.xml --dir D [--limit 20] [--no-images]
 *   node scripts/maintenance/hash-snapshot.mjs stamp|upgrade --dir D      (same root.ots handling)
 *   node --env-file=.env.production.local scripts/maintenance/hash-site.mjs upload --dir D
 *
 * Output: D/leaves.jsonl.gz ({ url, kind, sha256, dhash?, bytes, status }), D/manifest.json (root), D/root.ots.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { leafHash, merkleRoot } from '../lib/merkle.mjs';
import { imageHashes, SNAPSHOT_BUCKET } from '../lib/hash-snapshot.mjs';
import { validateR2Key } from '../lib/r2-key.mjs';

export const SITE_LEAF_VERSION = 'sl-site-v1';
const UA = 'SourceLibraryHashSnapshot/1 (+https://sourcelibrary.org/decode; integrity snapshot of public pages)';
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif|svg|tiff?)(\?|$)/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const log = (m) => console.error(`[hash-site ${new Date().toISOString()}] ${m}`);

export const siteLeaf = ({ url, kind, sha256 }) => leafHash([SITE_LEAF_VERSION, url, kind, sha256].join('\n'));

/** Visible text of an HTML page: what a reader sees, not the build's scaffolding. */
export function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFC');
}

/** Image URLs a page shows: <img src>, srcset candidates, og:image. Absolute, de-duplicated. */
export function imageUrls(html, base) {
  const out = new Set();
  const add = (u) => { try { const a = new URL(u.trim().replace(/&amp;/g, '&'), base); if (/^https?:$/.test(a.protocol) && IMAGE_EXT.test(a.pathname)) out.add(a.href); } catch { /* not a URL */ } };
  for (const m of html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/gi)) add(m[1]);
  for (const m of html.matchAll(/\ssrcset="([^"]+)"/gi)) for (const c of m[1].split(',')) add(c.trim().split(/\s+/)[0]);
  for (const m of html.matchAll(/<meta\b[^>]*property="og:image"[^>]*content="([^"]+)"/gi)) add(m[1]);
  return [...out];
}

async function get(url, { fetchImpl = fetch, tries = 3 } = {}) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      const body = Buffer.from(await res.arrayBuffer());
      return { status: res.status, body, type: res.headers.get('content-type') || '' };
    } catch (e) {
      if (i + 1 >= tries) return { status: 0, body: Buffer.alloc(0), type: '', error: e.message };
      await sleep(2000 * (i + 1));
    }
  }
}

export async function hashSite({ sitemap, limit = 0, images = true, pauseMs = 500, fetchImpl = fetch }) {
  const sm = await get(sitemap, { fetchImpl });
  if (sm.status !== 200) throw new Error(`sitemap ${sitemap}: HTTP ${sm.status}`);
  let urls = [...sm.body.toString('utf8').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  urls = [...new Set(urls)].sort();
  if (limit) urls = urls.slice(0, limit);
  const rows = [];
  const seenImg = new Set();
  let failed = 0;
  for (const url of urls) {
    const r = await get(url, { fetchImpl });
    if (r.status !== 200) { failed++; rows.push({ url, kind: 'missing', sha256: sha(`HTTP ${r.status}`), status: r.status, bytes: 0 }); await sleep(pauseMs); continue; }
    const html = r.body.toString('utf8');
    rows.push({ url, kind: 'html', sha256: sha(r.body), status: 200, bytes: r.body.length });
    rows.push({ url, kind: 'text', sha256: sha(visibleText(html)), status: 200, bytes: Buffer.byteLength(visibleText(html)) });
    if (images) for (const iu of imageUrls(html, url)) seenImg.add(iu);
    await sleep(pauseMs);
  }
  for (const iu of [...seenImg].sort()) {
    const r = await get(iu, { fetchImpl });
    if (r.status !== 200) { failed++; await sleep(pauseMs); continue; }
    let h;
    try { h = await imageHashes(r.body); } catch { h = { sha256: sha(r.body), dhash: null, bytes: r.body.length }; }
    rows.push({ url: iu, kind: 'image', sha256: h.sha256, dhash: h.dhash, status: 200, bytes: r.body.length });
    await sleep(pauseMs);
  }
  rows.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  const root = merkleRoot(rows.map(siteLeaf));
  return { rows, root, pages: urls.length, images: seenImg.size, failed };
}

const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : def; };
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const dir = path.resolve(arg('--dir', ''));
  if (!arg('--dir')) { console.error('--dir is required'); process.exit(2); }
  if (process.argv[2] === 'upload') {
    for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) if (!process.env[k]) { log(`${k} not set`); process.exit(1); }
    const sdk = await import('@aws-sdk/client-s3');
    const s3 = new sdk.S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const files = ['manifest.json', 'leaves.jsonl.gz'];
    const ots = path.join(dir, 'root.ots');
    for (const rel of [...files, ...(fs.existsSync(ots) ? ['root.ots'] : [])]) {
      const body = fs.readFileSync(path.join(dir, rel));
      const name = rel === 'root.ots' ? `root.${sha(body).slice(0, 12)}.ots` : rel;
      const key = `hash-snapshots/site/${m.host}/${m.id}/${name}`;
      validateR2Key(key, 'hash-site upload');
      try { await s3.send(new sdk.PutObjectCommand({ Bucket: SNAPSHOT_BUCKET, Key: key, Body: body, IfNoneMatch: '*' })); log(`wrote ${key}`); }
      catch (e) { if (e?.$metadata?.httpStatusCode !== 412) throw e; log(`exists ${key}`); }
    }
  } else {
    if (fs.existsSync(path.join(dir, 'manifest.json'))) { log(`${dir} already holds a snapshot`); process.exit(1); }
    fs.mkdirSync(dir, { recursive: true });
    const sitemap = arg('--sitemap', 'https://www.embassyofthefreemind.com/sitemap.xml');
    const started = new Date().toISOString();
    const r = await hashSite({ sitemap, limit: Number(arg('--limit', 0)), images: !process.argv.includes('--no-images') });
    const gz = zlib.gzipSync(r.rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'leaves.jsonl.gz'), gz);
    const manifest = {
      kind: 'sourcelibrary-site-hash-snapshot', format: 1, id: path.basename(dir), host: new URL(sitemap).host, sitemap,
      started_at: started, finished_at: new Date().toISOString(),
      algorithm: { leaf: `sha256(0x00 || "${SITE_LEAF_VERSION}\\n" url "\\n" kind "\\n" sha256_hex)`, kinds: 'html = exact bytes; text = visibleText(html); image = exact bytes (dhash recorded alongside); missing = sha256("HTTP <status>")', order: 'by url, then kind', node: 'sha256(0x01 || left || right), odd node carried up' },
      counts: { pages: r.pages, images: r.images, leaves: r.rows.length, failed: r.failed },
      root: r.root,
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
    log(`${manifest.host}: ${r.pages} pages, ${r.images} images, ${r.failed} failed; root ${r.root}`);
  }
}
