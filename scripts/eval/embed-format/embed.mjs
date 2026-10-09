#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/orig-lang-recall/gemini-arm.mjs --fill-pool — embeds
 * pool pages the production way (preview, plain, 768) into JSONL; no prefix form,
 * no GA model, not resumable. scripts/workers/embed-gemini.mjs writes to Supabase,
 * which this eval must never do.
 *
 * embed — document and query vectors for the #6170 arms, into files only.
 *
 *   --docs  --pool A|B --model ga|preview --format plain|prefix [--sample]
 *       <dir>/<pool>/doc-<model>-<format>.f32 (3072-d Float32, pool order).
 *       Resumable: it continues at the row the file ends on. With --sample it
 *       embeds only the rows in <dir>/<pool>/sample.json (compat.mjs writes it)
 *       into doc-<model>-<format>.sample.f32.
 *   --queries
 *       <dir>/queries.json: both gold sets × models × QUERY_FORMS, 3072-d.
 *
 * Billed tokens (usageMetadata.promptTokenCount) go to <dir>/spend.json and to
 * gemini_usage as eval/embed-format; the run stops at CAP_USD.
 *
 *   node --env-file=.env.production.local scripts/eval/embed-format/embed.mjs --dir D --docs --pool A --model ga --format prefix
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, has, readJsonl, MODELS, FULL_DIMS, QUERY_FORMS, DOC_FORMS, embedBatch, recordSpend, readLedger } from './common.mjs';

const DIR = arg('--dir');
if (!DIR) { console.error('--dir required'); process.exit(1); }
const here = path.dirname(fileURLToPath(import.meta.url));
const BATCH = 50;
const CONC = 4;

if (has('--queries')) {
  const sets = {
    A: JSON.parse(fs.readFileSync(path.join(here, '../orig-lang-recall/gold.json'), 'utf8')).queries.map((q) => ({ id: q.qid, query: q.query })),
    B: JSON.parse(fs.readFileSync(path.join(here, '../librarian-search/golden-set.json'), 'utf8')).queries.map((q) => ({ id: q.id, query: q.query })),
  };
  const out = {};
  for (const [mk, model] of Object.entries(MODELS)) {
    let tokens = 0, texts = 0, chars = 0;
    for (const [set, qs] of Object.entries(sets)) {
      for (const [form, f] of Object.entries(QUERY_FORMS)) {
        const t = qs.map((q) => f(q.query));
        const r = await embedBatch(model, t);
        tokens += r.tokens; texts += t.length; chars += t.reduce((s, x) => s + x.length, 0);
        qs.forEach((q, i) => { ((out[set] ??= {})[`${mk}-${form}`] ??= {})[q.id] = r.vectors[i]; });
      }
    }
    await recordSpend(DIR, { model, what: 'queries', texts, chars, tokens });
  }
  fs.writeFileSync(path.join(DIR, 'queries.json'), JSON.stringify(out));
  console.log('queries embedded', Object.keys(out.A), 'ledger $', readLedger(DIR).usd.toFixed(4));
  process.exit(0);
}

const pool = arg('--pool'), mk = arg('--model', 'ga'), format = arg('--format', 'plain');
const model = MODELS[mk];
const rows = readJsonl(path.join(DIR, pool, 'pool.jsonl'));
const sample = has('--sample') ? JSON.parse(fs.readFileSync(path.join(DIR, pool, 'sample.json'), 'utf8')) : null;
const idx = sample ?? rows.map((_, i) => i);
const file = path.join(DIR, pool, `doc-${mk}-${format}${sample ? '.sample' : ''}.f32`);
const rowBytes = FULL_DIMS * 4;
let done = fs.existsSync(file) ? Math.floor(fs.statSync(file).size / rowBytes) : 0;
if (fs.existsSync(file)) fs.truncateSync(file, done * rowBytes);
console.log(`${pool} ${mk} ${format}: ${done}/${idx.length} rows already on disk`);
const fd = fs.openSync(file, 'a');
let tokens = 0, texts = 0, chars = 0, allBilled = true;
const flush = async () => {
  if (!texts) return;
  const l = await recordSpend(DIR, { model, what: `docs ${pool} ${format}${sample ? ' sample' : ''}`, texts, chars, tokens });
  console.log(`  ${done}/${idx.length} rows; ledger $${l.usd.toFixed(3)}${allBilled ? '' : ' (some tokens estimated)'}`);
  tokens = 0; texts = 0; chars = 0;
};
while (done < idx.length) {
  const groups = [];
  for (let g = 0; g < CONC && done + g * BATCH < idx.length; g++) groups.push(idx.slice(done + g * BATCH, done + (g + 1) * BATCH));
  const res = await Promise.all(groups.map((g) => embedBatch(model, g.map((i) => DOC_FORMS[format](rows[i])))));
  for (const [k, r] of res.entries()) {
    if (r.vectors.length !== groups[k].length) throw new Error('vector count mismatch');
    for (const v of r.vectors) fs.writeSync(fd, Buffer.from(new Float32Array(v).buffer));
    done += groups[k].length; tokens += r.tokens; texts += groups[k].length; allBilled &&= r.billed;
    chars += groups[k].reduce((s, i) => s + DOC_FORMS[format](rows[i]).length, 0);
  }
  if (texts >= 2000) await flush();
}
await flush();
fs.closeSync(fd);
console.log(`done ${file}`);
