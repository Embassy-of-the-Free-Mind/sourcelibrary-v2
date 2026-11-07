#!/usr/bin/env node
// PRIOR ART: scripts/eval/spot-check/REVIEWER.md (the reviewer checks right_page against the neighbouring leaves by
// hand) and .claude/docs/invariants/containment-on-finding.md (what is contained, and how). Neither is a one-command
// check of a stored text against the leaves N-8..N+8; route-judge-6740 opusCall is reused for the call.
/**
 * #7991 stage 5: before containing a page judged "not this page's text" (invented or wrong leaf), ask whether the
 * stored text is a neighbouring leaf's (an image/text shift) or on no leaf at all. Read-only on Mongo.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/sa-gr-served-7991/leafshift.mjs <page_id>... [--lane=ocr|tr]
 *
 * One Opus call a page: the stored transcription (or English, --lane=tr) and the images of the book's served leaves
 * N-8..N+8 (long edge 1400 px), named leaf_<page_number>.jpg. Appends to OUT/leafshift.jsonl.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MongoClient } from 'mongodb';
import { opusCall } from '../route-judge-6740/judge.mjs';
import { imageUrl } from '../confidence-7866/lib.mjs';
import { isVisiblePage } from '../../lib/page-counts.mjs';
import { OUT, arg } from './lib.mjs';

const lane = arg('lane') || 'ocr';
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const P = c.db('bookstore').collection('pages');
const { default: sharp } = await import('sharp');
for (const id of ids) {
  const p = await P.findOne({ id }, { projection: { book_id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } });
  const N = p.page_number;
  const leaves = (await P.find({ book_id: p.book_id, page_number: { $gte: N - 8, $lte: N + 8 } }, { projection: { id: 1, page_number: 1, repeat_of: 1, display_photo: 1, photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1 } }).sort({ page_number: 1 }).toArray()).filter(isVisiblePage);
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'ls7991-'));
  const names = [];
  for (const l of leaves) {
    const u = imageUrl(l); if (!u) continue;
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(60e3) }); if (!r.ok) continue;
      fs.writeFileSync(path.join(ws, `leaf_${l.page_number}.jpg`), await sharp(Buffer.from(await r.arrayBuffer())).resize(1400, 1400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer());
      names.push(`leaf_${l.page_number}.jpg`);
    } catch { /* a leaf that will not fetch is left out and named below */ }
  }
  const text = lane === 'tr' ? p.translation?.data : p.ocr?.data;
  const prompt = `Your working directory holds photographs of consecutive leaves of one book, named by their page number: ${names.join(', ')}. Open each with Read.
Below is the ${lane === 'tr' ? 'English translation' : 'transcription'} a library stores for page ${N}. Decide which leaf, if any, it is ${lane === 'tr' ? 'a translation of' : 'a transcription of'}: compare names, numbers, headings, distinctive words and the layout.
"""
${String(text).slice(0, 12000)}
"""
Answer with one JSON object only: {"best_leaf": <page number or null>, "match": "same" | "partial" | "none", "evidence": "one or two lines quoting what matches or does not, leaf by leaf where it matters"}
"same" = the text is that leaf's text throughout (misreadings aside); "partial" = some of it is on that leaf, the rest is not on any; "none" = no leaf here carries it.`;
  const r = await opusCall(prompt, ws);
  fs.rmSync(ws, { recursive: true, force: true });
  let v = null; try { v = JSON.parse(String(r.text).match(/\{[\s\S]*\}/)[0]); } catch { v = null; }
  const rec = { page_id: id, book_id: p.book_id, page_number: N, lane, leaves: names.length, verdict: v, raw: v ? undefined : String(r.text).slice(0, 300), at: new Date().toISOString() };
  fs.appendFileSync(path.join(OUT, 'leafshift.jsonl'), JSON.stringify(rec) + '\n');
  console.log(`${p.book_id} p${N} (${lane}): ${v ? `${v.match} best=${v.best_leaf} — ${String(v.evidence).slice(0, 200)}` : 'unparsed'}`);
}
await c.close();
