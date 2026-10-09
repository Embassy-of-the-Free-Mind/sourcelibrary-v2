#!/usr/bin/env node
// PRIOR ART: scripts/eval/jev/additions-screen-fetch.mjs reads the #5982 by-eye pages; scripts/eval/results/xlref-synthesis-2026-10/served-pages.jsonl
// holds the #5695 judges' per-page omission labels (321 served pages) without texts. This re-reads those pages' OCR and served English by id, read-only.
/** #6061 Jev omission screen, step 1:
 *   node --env-file=<prod env> scripts/eval/jev/omission-screen-fetch.mjs  -> results/jev-omissions-2026-10/work/live-items.jsonl (not committed)
 * A page whose served translation was rewritten after the judges read it (2026-10-03) is kept but marked `changed_since_judged`:
 * its label then describes text Jev never sees, and the experiment reports AUC with and without those pages. */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const R = process.env.RESULTS_DIR || new URL('../results/', import.meta.url).pathname;
const OUT = (process.env.OUT_DIR || R + 'jev-omissions-2026-10/') + 'work/';
const labels = fs.readFileSync(R + 'xlref-synthesis-2026-10/served-pages.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const JUDGED = new Date('2026-10-03T00:00:00Z');
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const P = c.db('bookstore').collection('pages');
const out = []; const miss = [];
for (const l of labels) {
  const m = l.id.match(/^([0-9a-f]{24}|[0-9a-f-]{36})_(-?\d+)$/); // books.id is an ObjectId hex or a UUID
  if (!m) { miss.push(l.id); continue; }
  const p = await P.findOne({ book_id: m[1], page_number: Number(m[2]) },
    { projection: { _id: 0, 'ocr.data': 1, 'translation.data': 1, 'translation.updated_at': 1, 'translation.translated_at': 1, 'translation.prompt_version': 1 } });
  if (!p?.ocr?.data || !p?.translation?.data) { miss.push(l.id); continue; }
  const t = p.translation.updated_at || p.translation.translated_at;
  out.push({ id: l.id, track: l.track, lang: l.lang, label: l.omission ? 1 : 0, fidelity: l.fidelity, prompt_version: p.translation.prompt_version ?? null,
    changed_since_judged: t ? new Date(t) > JUDGED : null, source: p.ocr.data, translation: p.translation.data });
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + 'live-items.jsonl', out.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log('fetched', out.length, 'of', labels.length, 'missing', miss.length, miss.slice(0, 5).join(' '),
  '| changed_since_judged', out.filter((x) => x.changed_since_judged).length, 'no_date', out.filter((x) => x.changed_since_judged === null).length);
await c.close();
