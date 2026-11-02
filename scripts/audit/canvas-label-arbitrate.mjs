#!/usr/bin/env node
// PRIOR ART: scripts/lib/page-alignment.mjs checkAlignment() compares archive vs SOURCE URL at
// offsets 0/+1; here the question is different: given a text offset k from
// canvas-label-alignment.mjs, which leaf does the SHOWN image carry? Reuses its hashBuffer/hammingHex.
/**
 * canvas-label-arbitrate — for books canvas-label-alignment.mjs read as `shifted`, is the defect
 * READER-VISIBLE? (#7949) $0, read-only: our R2 images and the provider's canvases.
 *
 * Text on slot s is the text of canvas s+k. Per sampled slot, dHash our image against canvas s
 * and canvas s+k:
 *   image == canvas s     → `visible`: readers see the right image under another leaf's text
 *                           (Huser Paracelsus vol. 1 after its resolution upgrade).
 *   image == canvas s+k   → `consistent`: image and text are the same leaf (both from the shifted
 *                           PDF); only the source pointer is off (vol. 2).
 *   neither / both        → `unclear`.
 * Book verdict: the majority of ≥2 agreeing samples, else `unclear`.
 *
 * Usage: node --env-file=.env.production.local scripts/audit/canvas-label-arbitrate.mjs \
 *          --in <books-*.jsonl from canvas-label-alignment> [--out <file>] [--samples 3]
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { hashBuffer, hammingHex, HASH_MATCH } from '../lib/page-alignment.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const IN = flag('in'), OUT = flag('out', IN?.replace(/\.jsonl$/, '.arbitrated.jsonl')), SAMPLES = Number(flag('samples', '3'));
if (!IN) { console.error('usage: --in <books.jsonl>'); process.exit(1); }

const UA = { 'User-Agent': 'SourceLibrary-audit/1.0 (+https://sourcelibrary.org)' };
async function hashUrl(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return hashBuffer(Buffer.from(await r.arrayBuffer()));
}
const canvasImage = (c, w = 600) => {
  const svc = c.images?.[0]?.resource?.service?.['@id'] ?? c.items?.[0]?.items?.[0]?.body?.service?.[0]?.id;
  if (svc) return `${svc.replace(/\/$/, '')}/full/${w},/0/default.jpg`;
  return c.images?.[0]?.resource?.['@id'];
};

const rows = fs.readFileSync(IN, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.verdict === 'shifted');
const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const out = fs.createWriteStream(OUT);
const tally = {};
try {
  for (const r of rows) {
    const res = { book_id: r.book_id, title: r.title, visible: r.visible, offset: r.offset, share: r.share, runs: r.runs };
    try {
      const book = await db.collection('books').findOne({ id: r.book_id }, { projection: { image_source: 1 } });
      const mj = await (await fetch(book.image_source.iiif_manifest, { headers: UA, signal: AbortSignal.timeout(60000) })).json();
      const canvases = mj.sequences?.[0]?.canvases ?? mj.items ?? [];
      // Sample inside the longest run of the book's main offset, away from its ends.
      const run = [...(r.runs || [])].filter((x) => x.offset === r.offset).sort((a, b) => b.scored - a.scored)[0];
      const picks = run ? Array.from({ length: SAMPLES }, (_, i) => Math.round(run.from + ((run.to - run.from) * (i + 1)) / (SAMPLES + 1))) : [];
      const votes = { visible: 0, consistent: 0, unclear: 0 };
      res.samples = [];
      for (const s of picks) {
        const page = await db.collection('pages').findOne({ book_id: r.book_id, page_number: s }, { projection: { photo: 1, archived_photo: 1, split_side: 1 } });
        // A split page's archive is the whole spread, never one canvas: no vote (the repair refuses split books too).
        if (page?.split_side) { votes.unclear++; continue; }
        const shown = page?.archived_photo || page?.photo; // image-pick-ok: unsplit leaf; the question is which leaf the stored archive holds
        const t = s + r.offset;
        if (!shown || !canvases[s - 1] || !canvases[t - 1]) { votes.unclear++; continue; }
        const [h, hs, ht] = await Promise.all([hashUrl(shown), hashUrl(canvasImage(canvases[s - 1])), hashUrl(canvasImage(canvases[t - 1]))]);
        const dS = hammingHex(h, hs), dT = hammingHex(h, ht);
        const v = dS <= HASH_MATCH && dS < dT ? 'visible' : dT <= HASH_MATCH && dT < dS ? 'consistent' : 'unclear';
        votes[v]++;
        res.samples.push({ slot: s, d_same: dS, d_text: dT, v });
      }
      const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
      res.reader = top[1] >= 2 && top[0] !== 'unclear' ? top[0] : 'unclear';
      res.votes = votes;
    } catch (e) { res.reader = 'error'; res.error = String(e.message ?? e).slice(0, 200); }
    tally[res.reader] = (tally[res.reader] ?? 0) + 1;
    out.write(JSON.stringify(res) + '\n');
    console.log(`${res.reader.padEnd(10)} ${r.book_id} k=${r.offset} ${JSON.stringify(res.votes ?? {})} ${(r.title || '').slice(0, 60)}`);
  }
  console.log(`done: ${JSON.stringify(tally)} -> ${OUT}`);
} finally { out.end(); await client.close(); }
