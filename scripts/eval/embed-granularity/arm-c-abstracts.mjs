#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/librarian-search/_spike-rich-embedding.mjs — embeds a
 * richer BOOK-level text (summary + entities) and scores book retrieval; it
 * generates nothing per page. scripts/analysis/experience-map/classify — a
 * flash-lite pass per retrieved page, but it classifies and extracts quotes
 * after retrieval; it does not write the text that gets embedded.
 *
 * Arm (c) of #6173: a model-written concept abstract per page, embedded in
 * place of the page text. gemini-3.1-flash-lite, thinking off, PER_CALL pages
 * per request (one usage row per request: 12K single-page rows in a day would
 * push the spend guard toward its 40K-row fail-closed limit).
 *
 * The abstract is an index key, never a quotation: it is embedded and thrown
 * away at read time, and the page text is what a reader is shown.
 *
 *   node --env-file=.env.production.local scripts/eval/embed-granularity/arm-c-abstracts.mjs --dir DIR [--limit N] [--embed]
 */
import fs from 'node:fs';
import path from 'node:path';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { arg, flag, loadPool, embedAll, saveVecs, ENDPOINT } from './lib.mjs';
import { CONCEPT_ABSTRACT_HEAD, CONCEPT_ABSTRACT_MODEL, CONCEPT_ABSTRACT_PROMPT_VERSION, CONCEPT_ABSTRACT_PAGES_PER_CALL } from '../../lib/concept-abstract.mjs';

const DIR = arg('--dir');
const LIMIT = Number(arg('--limit', 0));
const PER_CALL = CONCEPT_ABSTRACT_PAGES_PER_CALL;
const GEN_MODEL = CONCEPT_ABSTRACT_MODEL;
export const PROMPT_VERSION = CONCEPT_ABSTRACT_PROMPT_VERSION;
const pool = loadPool(DIR);
const outFile = path.join(DIR, 'abstracts.jsonl');

// The prompt now lives in scripts/lib/concept-abstract.mjs, unchanged, so the
// stage-1 lane (scripts/batch/concept-abstracts.mjs) sends the same text.
const HEAD = CONCEPT_ABSTRACT_HEAD;

const done = new Map();
if (fs.existsSync(outFile)) for (const l of fs.readFileSync(outFile, 'utf8').trim().split('\n')) { if (l) { const r = JSON.parse(l); done.set(r.i, r); } }

if (!flag('--embed')) {
  const todo = pool.filter((p) => !done.has(p.i)).slice(0, LIMIT || undefined);
  const groups = [];
  for (let k = 0; k < todo.length; k += PER_CALL) groups.push(todo.slice(k, k + PER_CALL));
  let inTok = 0; let outTok = 0; let fail = 0; let n = 0;
  const out = fs.createWriteStream(outFile, { flags: 'a' });
  await Promise.all(Array.from({ length: 5 }, async () => {
    for (;;) {
      const g = groups.shift();
      if (!g) return;
      const prompt = HEAD + '\n' + g.map((p, j) => `=== PAGE ${j + 1} ===\n${p.text.slice(0, 6000)}`).join('\n\n');
      let got = null;
      for (let attempt = 0; attempt < 4 && !got; attempt++) {
        try {
          const r = await callGemini({ model: GEN_MODEL, prompt, endpoint: ENDPOINT, maxOutputTokens: 1200, temperature: 0, type: 'other', promptVersion: PROMPT_VERSION, triggeredBy: 'eval' });
          inTok += r.inputTokens; outTok += r.outputTokens;
          const lines = new Map();
          for (const m of r.text.matchAll(/^\[(\d+)\]\s*(.+)$/gm)) lines.set(Number(m[1]), m[2].trim());
          // All pages answered or the call is retried: a short answer would
          // otherwise shift abstracts onto the wrong page.
          if (g.every((_, j) => lines.has(j + 1))) got = lines;
        } catch (err) {
          await new Promise((res) => setTimeout(res, 3000 * 2 ** attempt));
        }
      }
      if (!got) { fail += g.length; continue; }
      g.forEach((p, j) => out.write(JSON.stringify({ i: p.i, abstract: got.get(j + 1) }) + '\n'));
      n += g.length;
      if (n % 600 < PER_CALL) console.log(`  ${n}/${todo.length} pages, in ${inTok} out ${outTok}, failed ${fail}`);
      if (fail > 300 && fail > n) { console.error('failure rate above half — stopping'); process.exit(1); }
    }
  }));
  out.end();
  const usd = inTok / 1e6 * 0.25 + outTok / 1e6 * 1.5;
  fs.appendFileSync(path.join(DIR, 'abstracts-usage.jsonl'), JSON.stringify({ pages: n, failed: fail, input_tokens: inTok, output_tokens: outTok, usd }) + '\n');
  console.log(`abstracts: ${n} pages, failed ${fail}, in ${inTok} out ${outTok} ≈ $${usd.toFixed(3)}`);
} else {
  // NONE pages and failures keep a zero vector: they cannot be retrieved by
  // this arm, which is what the arm would do in production.
  const rows = pool.filter((p) => done.has(p.i) && !/^NONE\b/i.test(done.get(p.i).abstract));
  const { vecs, tokens } = await embedAll(rows.map((p) => done.get(p.i).abstract), { label: 'c', ckpt: path.join(DIR, 'ckpt-c') });
  const full = new Float32Array(pool.length * 768);
  rows.forEach((p, j) => full.set(vecs.subarray(j * 768, (j + 1) * 768), p.i * 768));
  saveVecs(path.join(DIR, 'vec-c.f32'), full);
  fs.writeFileSync(path.join(DIR, 'arm-c.json'), JSON.stringify({ abstracts: rows.length, none: [...done.values()].filter((r) => /^NONE\b/i.test(r.abstract)).length, missing: pool.length - done.size, tokens }));
  console.log(`arm c written; ${rows.length} abstracts embedded, ${tokens} tokens`);
}
