// PRIOR ART: scripts/eval/xlref-t5/image-pass-bundle.mjs (#5695 opened the page image for its cause pass); this only
// downloads the page image each corrector sees, from getPageSource (split-aware: a page cut from a spread gets its half).
// Read-only Mongo; writes $W/img/<uid>.jpg.  node --env-file=... fetch-images.mjs Persian Sanskrit
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
const W = process.env.W6545 || '/mnt/HC_Volume_105839809/jobs/pro-translate-6545/w';
const langs = process.argv.slice(2);
const uids = JSON.parse(execFileSync('python3', ['-c', `import sys,json; sys.path.insert(0,'scripts/eval/pro-translate-6545'); from common import *; r=records(); print(json.dumps({u:[r[u]['book_id'],int(r[u]['page_number'])] for L in ${JSON.stringify(langs)} for u in panel_uids(L)}))`]).toString());
fs.mkdirSync(`${W}/img`, { recursive: true });
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages');
const meta = {};
for (const [uid, [book_id, page_number]] of Object.entries(uids)) {
  const out = `${W}/img/${uid}.jpg`;
  const p = await pages.findOne({ book_id, page_number }, { projection: { id: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1, photo: 1, crop: 1 } });
  const url = p ? getPageSource(p) : null;
  meta[uid] = { page_id: p?.id, url, crop: p?.crop ?? null };
  if (!url) { console.log('NO IMAGE', uid); continue; }
  if (!fs.existsSync(out)) {
    const r = await fetch(url);
    if (!r.ok) { console.log('FAIL', uid, r.status, url); continue; }
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  }
  console.log(uid, fs.statSync(out).size, url);
}
fs.writeFileSync(`${W}/img/meta.json`, JSON.stringify(meta, null, 1));
await c.close();
