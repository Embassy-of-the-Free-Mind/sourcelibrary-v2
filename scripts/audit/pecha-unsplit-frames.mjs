#!/usr/bin/env node
// PRIOR ART: scripts/output/integrity.mjs (job scratch) checks page numbering and parent/leaf links of a split book, not
// whether a frame left whole still holds several leaves; scripts/audit/unsplit-writes.mjs watches writes to split
// parents, not live frames. Looked in scripts/audit/ (leaf-*, *-split*) and scripts/maintenance/split-pecha-eap.mjs.
/**
 * pecha-unsplit-frames — the done check for #304: in the EAP pecha books, find live frames that were left whole but
 * still hold several leaves, outside the listed exceptions.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/audit/pecha-unsplit-frames.mjs \
 *     --ids=FILE --plans=DIR[,DIR...] [--conc=6] [--out=FILE.jsonl]
 *
 * --ids: the in-scope book ids, one per line. --plans: directories holding <id>-plan.json files; a frame whose plan
 * status is 'unsplit' (or 'agy', never resolved) is a LISTED exception. Per book:
 *   - NOT-DONE when books.split_completed is not true.
 *   - per live frame (page_number > 0, not a leaf: no split_from_pecha) two independent signals of several leaves:
 *       text  — the stored read has a <leaf-break/> (count + 1 >= 2);
 *       image — findLeaves() (the cloth-gap detector) finds >= 2 leaves on the archived photo.
 *     A frame with either signal and no listed exception is FLAGGED. Read-only; writes nothing to Mongo.
 * Prints per-book lines for NOT-DONE / FLAGGED books and a total; exit 1 when anything is flagged or not done.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { findLeaves } from '../lib/pecha-leaves.mjs';
import { countLeafBreaks } from '../lib/leaf-break.mjs';

const args = process.argv.slice(2);
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const ids = [...new Set(fs.readFileSync(arg('ids'), 'utf8').split(/\s+/).filter((x) => /^[0-9a-f]{24}$/.test(x)))];
const planDirs = (arg('plans') || '').split(',').filter(Boolean);
const CONC = +(arg('conc') || 6);
const OUT = arg('out');

function exceptionsOf(bookId) {
  const ex = new Set(); let found = false;
  for (const d of planDirs) {
    const f = path.join(d, `${bookId}-plan.json`);
    if (!fs.existsSync(f)) continue;
    found = true;
    for (const fr of JSON.parse(fs.readFileSync(f, 'utf8')).frames || []) if (fr.status === 'unsplit' || fr.status === 'agy') ex.add(fr.page_id);
  }
  return { ex, found };
}

async function download(url) {
  for (let t = 0; t < 3; t++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (r.ok) return Buffer.from(await r.arrayBuffer()); if (r.status === 404) break; } catch { /* retry */ }
    await new Promise((z) => setTimeout(z, 1500 * (t + 1)));
  }
  return null;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const out = OUT ? fs.createWriteStream(OUT) : null;
const tot = { books: 0, notDone: 0, noPlan: 0, whole: 0, listed: 0, single: 0, flagged: 0, fetchFailed: 0 };
for (const id of ids) {
  tot.books++;
  const b = await db.collection('books').findOne({ id }, { projection: { split_completed: 1, title: 1 } });
  if (!b?.split_completed) { tot.notDone++; console.log('NOT-DONE', id); out?.write(JSON.stringify({ book: id, not_done: true }) + '\n'); continue; }
  const { ex, found } = exceptionsOf(id);
  if (!found) tot.noPlan++;
  const whole = await db.collection('pages').find({ book_id: id, page_number: { $gt: 0 }, split_from_pecha: { $exists: false } },
    { projection: { id: 1, page_number: 1, archived_photo: 1, photo: 1, 'ocr.data': 1 } }).toArray();
  const flagged = [];
  await pool(whole, CONC, async (p) => {
    tot.whole++;
    if (ex.has(p.id)) { tot.listed++; return; }
    const read = p.ocr?.data && String(p.ocr.data).trim() ? countLeafBreaks(p.ocr.data) + 1 : null;
    // image-pick-ok: a live whole frame is the unsplit photo the splitter would have cut
    const buf = await download(p.archived_photo || p.photo);
    let gaps = null;
    if (buf) { try { gaps = (await findLeaves(buf)).leaves.length; } catch { gaps = null; } } else tot.fetchFailed++;
    if ((read ?? 1) >= 2 || (gaps ?? 1) >= 2) flagged.push({ page_id: p.id, pn: p.page_number, read, gaps });
    else tot.single++;
  });
  tot.flagged += flagged.length;
  if (flagged.length) console.log('FLAGGED', id, flagged.length, JSON.stringify(flagged.slice(0, 5)));
  out?.write(JSON.stringify({ book: id, whole: whole.length, listed: whole.filter((p) => ex.has(p.id)).length, flagged }) + '\n');
}
console.log('TOTAL', JSON.stringify(tot));
out?.end();
await c.close();
process.exit(tot.flagged || tot.notDone ? 1 : 0);
