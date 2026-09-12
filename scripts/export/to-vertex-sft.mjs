#!/usr/bin/env node
// Convert training pairs (training-pairs.mjs output) to Vertex AI supervised
// fine-tuning JSONL (issue #4320). Selects the highest-quality slice under a
// hard token budget and writes train + validation files ready for GCS upload.
//
// Selection: split=train, no flags, ratio in [0.8, 3], source 200–6000 chars.
// Books are drained ROUND-ROBIN so the cap yields a diverse corpus rather
// than whatever books sort first. Validation: split=val, same quality gates,
// capped at --val-max (Vertex validation sets are small by design).
//
// Token budget: estimated at chars/3 (polytonic Greek is token-dense; this
// overestimates tokens for English, underestimates for Greek — the job's own
// reported billable count is the truth, this is a sizing guard only).
//
// Run:
//   node scripts/export/to-vertex-sft.mjs \
//     --pairs scripts/output/training-pairs-v1/pairs-greek.jsonl.gz \
//     --dir scripts/output/vertex-sft-v1 --max-tokens 25000000
//
// Zero cost, local only. Upload + job creation are separate, deliberate steps.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';

const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : def; };

const PAIRS = arg('--pairs', null);
const DIR = path.resolve(arg('--dir', 'scripts/output/vertex-sft-v1'));
const MAX_TOKENS = Number(arg('--max-tokens', 25_000_000)); // hard budget cap
const VAL_MAX = Number(arg('--val-max', 200));
const RATIO_LO = 0.8, RATIO_HI = 3, SRC_MIN = 200, SRC_MAX = 6000;
if (!PAIRS) { console.error('--pairs <pairs-*.jsonl.gz> required'); process.exit(1); }

const SYSTEM = 'You are a translator for Source Library, a digital library of historical primary sources. Translate the given text into clear, accurate English, preserving the structure, register, and meaning of the original.';

const estTokens = (s) => Math.ceil(s.length / 3);

const toExample = (rec) => JSON.stringify({
  systemInstruction: { role: 'system', parts: [{ text: SYSTEM }] },
  contents: [
    { role: 'user', parts: [{ text: `Translate this ${rec.language_tag} text into English:\n\n${rec.source_text}` }] },
    { role: 'model', parts: [{ text: rec.translation_en }] },
  ],
});

const qualityOk = (r) => !r.flags && r.ratio >= RATIO_LO && r.ratio <= RATIO_HI
  && r.source_text.length >= SRC_MIN && r.source_text.length <= SRC_MAX;

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const byBook = new Map(); // train candidates, per book
  const val = [];
  let seen = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(PAIRS).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    const r = JSON.parse(line);
    seen++;
    if (!qualityOk(r)) continue;
    if (r.split === 'val') { val.push(r); continue; }
    if (!byBook.has(r.book_id)) byBook.set(r.book_id, []);
    byBook.get(r.book_id).push(r);
  }

  // Round-robin across books (deterministic: books by id, pages in file
  // order) until the token budget is spent.
  const queues = [...byBook.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v);
  const picked = [];
  let tokens = 0, exhausted = false;
  for (let round = 0; !exhausted; round++) {
    exhausted = true;
    for (const q of queues) {
      if (round >= q.length) continue;
      exhausted = false;
      const r = q[round];
      const t = estTokens(r.source_text) + estTokens(r.translation_en);
      if (tokens + t > MAX_TOKENS) { exhausted = true; break; }
      picked.push(r);
      tokens += t;
    }
  }

  const trainPath = path.join(DIR, 'train.jsonl');
  fs.writeFileSync(trainPath, picked.map(toExample).join('\n') + '\n');
  const valPicked = val.slice(0, VAL_MAX);
  const valPath = path.join(DIR, 'validation.jsonl');
  fs.writeFileSync(valPath, valPicked.map(toExample).join('\n') + '\n');

  const books = new Set(picked.map((r) => r.book_id));
  const manifest = {
    source: PAIRS,
    created: new Date().toISOString(),
    quality_gates: { ratio: [RATIO_LO, RATIO_HI], source_chars: [SRC_MIN, SRC_MAX], flags: 'none' },
    est_tokens: tokens, max_tokens: MAX_TOKENS,
    counts: { pairs_read: seen, train_examples: picked.length, train_books: books.size, val_examples: valPicked.length },
    token_note: 'est_tokens is chars/3 — a sizing guard, not billing truth; the tuning job reports billable tokens',
  };
  fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[sft] train ${picked.length.toLocaleString()} examples from ${books.size} books (~${(tokens / 1e6).toFixed(1)}M est tokens), val ${valPicked.length} → ${DIR}`);
  const trainCandidates = queues.reduce((a, q) => a + q.length, 0);
  console.log(`[sft] read ${seen.toLocaleString()} pairs; gates passed ${(trainCandidates + val.length).toLocaleString()} candidates; token cap selected ${picked.length.toLocaleString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
