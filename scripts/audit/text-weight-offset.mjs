#!/usr/bin/env node
// PRIOR ART: scripts/audit/leaf-alignment-screen.mjs (#7866) correlates text length with image
// weight at shifts -6..6, but from archive_metadata.bytes, which a re-archive never rewrites: on a
// book whose images were swapped after OCR, those bytes describe the OLD images the OCR read, so the
// signal reads aligned exactly where #7949 broke. scripts/audit/canvas-label-alignment.mjs needs
// numeric canvas labels; 441 of the 529 at-risk e-rara books have none.
/**
 * text-weight-offset — does each page's text belong to the image shown NOW? (#7949) $0, read-only.
 *
 * Per slot: text length (characters of ocr.data, tags stripped) and the CURRENT image's byte size
 * (HEAD on the served archive). A text-heavy leaf is a heavy image, a blank leaf a light one, so
 * the two series correlate best at the offset the text actually sits at. Pearson r at k = -6..6
 * (text on slot s vs image on slot s+k); verdict `shifted` when the best k != 0 beats k = 0 by
 * --margin, `aligned` when k = 0 is best, else `weak`.
 *
 * A candidate screen: confirm every `shifted` by eye before any repair (see canvas-label-arbitrate).
 * Measured 2026-11-02: controls exact (Paracelsus pre-repair k=-3, Teyler pre-repair k=-1, Teyler
 * repaired aligned). On the 168 unrepaired PDF-then-upgraded e-rara books it flagged 47; the top 4
 * public ones (17-41 pages) were ALL aligned by eye: on a short book a few pages' text length is
 * noise. Books under --min-pages (default 60) are therefore reported `short`, not scored.
 *
 * Usage: node --env-file=.env.production.local scripts/audit/text-weight-offset.mjs --ids <file> [--out f.jsonl]
 *        --backup <repair backup json>  read the TEXT from a pre-repair backup (positive control)
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const IDS = flag('ids'), BOOK = flag('book'), OUT = flag('out', 'scripts/output/text-weight-offset.jsonl');
const MIN_PAGES = Number(flag('min-pages', '60'));
const BACKUP = flag('backup'), MARGIN = Number(flag('margin', '0.1')), CONC = Number(flag('concurrency', '16'));
const ids = BOOK ? [BOOK] : fs.readFileSync(IDS, 'utf8').trim().split('\n').map((l) => (l.startsWith('{') ? JSON.parse(l).id : l.trim())).filter(Boolean);

const strip = (s) => String(s ?? '').replace(/<image-desc[\s\S]*?<\/image-desc>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length;
function pearson(x, y) {
  const n = x.length; if (n < 10) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
async function headSize(url) {
  for (let a = 0; a < 3; a++) {
    try { const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20000) }); const n = Number(r.headers.get('content-length')); if (r.ok && n) return n; } catch { /* retry */ }
  }
  return null;
}
async function pool(items, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: CONC }, async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j]); } }));
  return out;
}

const backupText = BACKUP ? new Map(JSON.parse(fs.readFileSync(BACKUP, 'utf8')).map((p) => [p.page_number, strip(p.ocr?.data)])) : null;
const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const out = fs.createWriteStream(OUT, { flags: 'a' });
const tally = {};
try {
  for (const id of ids) {
    const row = { book_id: id };
    try {
      const pages = await db.collection('pages').aggregate([
        { $match: { book_id: id, page_number: { $gte: 1 } } },
        { $project: { _id: 0, page_number: 1, archived_photo: 1, photo: 1, split_side: 1, len: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $strLenCP: '$ocr.data' }, 0] }, head: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $substrCP: ['$ocr.data', 0, 3000] }, ''] } } },
        { $sort: { page_number: 1 } },
      ]).toArray();
      if (pages.some((p) => p.split_side)) { row.verdict = 'skip-split'; throw null; }
      if (pages.length < MIN_PAGES) { row.verdict = 'short'; row.pages = pages.length; throw null; }
      const text = pages.map((p) => (backupText ? backupText.get(p.page_number) ?? 0 : strip(p.head) * (p.len > 3000 ? p.len / 3000 : 1)));
      const bytes = await pool(pages, (p) => headSize(p.archived_photo || p.photo)); // image-pick-ok: weight of the stored leaf the reader sees
      const rs = {};
      for (let k = -6; k <= 6; k++) {
        const xs = [], ys = [];
        for (let s = 0; s < pages.length; s++) { const t = s + k; if (t < 0 || t >= pages.length || bytes[t] == null || !text[s]) continue; xs.push(text[s]); ys.push(bytes[t]); }
        rs[k] = pearson(xs, ys);
      }
      const best = Object.entries(rs).filter(([, r]) => r != null).sort((a, b) => b[1] - a[1])[0];
      const r0 = rs[0] ?? null;
      Object.assign(row, { pages: pages.length, r0: r0 && +r0.toFixed(3), best_k: best ? Number(best[0]) : null, best_r: best ? +best[1].toFixed(3) : null });
      row.verdict = !best ? 'weak' : row.best_k === 0 ? 'aligned' : (best[1] - (r0 ?? 0) >= MARGIN ? 'shifted' : 'weak');
    } catch (e) { if (e) { row.verdict = 'error'; row.error = String(e.message ?? e).slice(0, 160); } }
    tally[row.verdict] = (tally[row.verdict] ?? 0) + 1;
    out.write(JSON.stringify(row) + '\n');
    console.log(`${row.verdict.padEnd(8)} ${id} k=${row.best_k} r_best=${row.best_r} r0=${row.r0} pages=${row.pages}`);
  }
  console.log(`done: ${JSON.stringify(tally)} -> ${OUT}`);
} finally { out.end(); await client.close(); }
