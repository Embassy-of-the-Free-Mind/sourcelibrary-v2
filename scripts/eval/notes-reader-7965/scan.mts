// PRIOR ART: gate.mts (this directory) renders 400 pages both ways; this only composes, over a much larger
// $sample, to count the composer's two failure signals cheaply: null (an orphan: the reader falls back) and
// crossed tags in the composed markup. Read-only, $0.
//   node --env-file=<main>/.env.production.local node_modules/.bin/tsx scripts/eval/notes-reader-7965/scan.mts --n 5000
import { MongoClient } from 'mongodb';
import { layerMarkup, getTranslationText, translationTextIsCurrent } from '../../lib/translation-text.mjs';
const N = Number(process.argv[process.argv.indexOf('--n') + 1] || 5000);
const c = new MongoClient(process.env.MONGODB_URI!, { appName: 'notes-reader-scan-7965' }); await c.connect();
const db = c.db('bookstore');
const S = { docs: 0, not_current_page: 0, stale_doc: 0, composed: 0, null: 0, crossed: 0, ms_max: 0, ms_total: 0, examples: [] as string[] };
const docs = await db.collection('page_annotations').aggregate([{ $sample: { size: N } }]).toArray();
for (let i = 0; i < docs.length; i += 200) {
  const chunk = docs.slice(i, i + 200);
  const pages = new Map((await db.collection('pages').find({ id: { $in: chunk.map((d) => d.page_id) } }, { projection: { _id: 0, id: 1, translation: 1 } }).toArray()).map((p) => [p.id, p]));
  for (const d of chunk) {
    S.docs++;
    const p: any = pages.get(d.page_id);
    if (!p || !translationTextIsCurrent(p.translation)) { S.not_current_page++; continue; }
    if (d.data_hash !== p.translation.text_from.data_hash) { S.stale_doc++; continue; }
    const t0 = performance.now();
    const m = layerMarkup(getTranslationText(p), d.annotations);
    const ms = performance.now() - t0; S.ms_total += ms; S.ms_max = Math.max(S.ms_max, ms);
    if (m === null) { S.null++; if (S.examples.length < 10) S.examples.push(`null ${d.page_id}`); continue; }
    S.composed++;
    const stack: string[] = []; let bad = 0;
    for (const x of m.matchAll(/<(\/?)(note|image-desc|margin|gloss|insert|unclear|term)(?:\s[^<>]*)?>/gi)) {
      const name = x[2].toLowerCase();
      if (!x[1]) stack.push(name); else if (stack[stack.length - 1] === name) stack.pop(); else { bad++; const k = stack.lastIndexOf(name); if (k >= 0) stack.splice(k, 1); }
    }
    if (bad || stack.length) { S.crossed++; if (S.examples.length < 10) S.examples.push(`crossed ${d.page_id}`); }
  }
}
console.log(JSON.stringify({ ...S, ms_mean: +(S.ms_total / Math.max(1, S.composed)).toFixed(2) }, null, 1));
await c.close();
