#!/usr/bin/env node
// PRIOR ART: run-arms.mjs (this directory) builds the production request for the Gemini arms; this
// writes the SAME prompt string per page for the round-2 Opus arm (O), which runs as subagents on the
// subscription rather than through an API, and ingests their outputs into the same arm-file shape.
/**
 * opus-arm.mjs — #6121 round 2, arm O. $0, no DB writes.
 *
 *   node scripts/eval/tengyur-levers/opus-arm.mjs --prompts   # /root/tlev2/o/prompts/*.txt + batches/*.txt
 *   node scripts/eval/tengyur-levers/opus-arm.mjs --ingest    # /root/tlev2/o/out/*.txt → /root/tlev/arms/O{,-ref}.jsonl
 *
 * A batch file lists one "<prompt file> <output file>" pair per line, 10 pages a batch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, sanitizeTranslationTags } from '../../lib/translate-core.mjs';

const W = '/root/tlev', O = '/root/tlev2/o';
const read = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const state = JSON.parse(fs.readFileSync('/root/tref/arms/state.json', 'utf8'));
if (Number(state.prompt_ref.version) !== 13) throw new Error('base prompt is not v13');
const books = JSON.parse(fs.readFileSync(path.join(W, 'books.json'), 'utf8'));
const sets = { sample: read(path.join(W, 'sample-pages.jsonl')), ref: read(path.join(W, 'ref-pages.jsonl')) };

if (process.argv.includes('--prompts')) {
  for (const d of ['prompts', 'out', 'batches']) fs.mkdirSync(path.join(O, d), { recursive: true });
  const all = [];
  for (const [set, rows] of Object.entries(sets)) {
    for (const r of rows) {
      const prompt = buildTranslationPrompt({ prompts: state.prompts, book: books[r.book_id], ocrText: r.bo, pageBreak: PAGE_BREAK_SCOPED }).prompt;
      const pf = path.join(O, 'prompts', `${set}-${r.page_id}.txt`);
      fs.writeFileSync(pf, prompt);
      all.push(`${pf} ${path.join(O, 'out', `${set}-${r.page_id}.txt`)}`);
    }
  }
  for (let i = 0; i < all.length; i += 10) fs.writeFileSync(path.join(O, 'batches', `O-${String(i / 10 + 1).padStart(2, '0')}.txt`), all.slice(i, i + 10).join('\n') + '\n');
  console.log(`${all.length} prompts, ${Math.ceil(all.length / 10)} batches`);
}

if (process.argv.includes('--ingest')) {
  for (const [set, rows] of Object.entries(sets)) {
    const file = path.join(W, 'arms', `O${set === 'ref' ? '-ref' : ''}.jsonl`);
    const out = [], missing = [];
    for (const r of rows) {
      const f = path.join(O, 'out', `${set}-${r.page_id}.txt`);
      if (!fs.existsSync(f) || !fs.readFileSync(f, 'utf8').trim()) { missing.push(r.page_id); continue; }
      const raw = fs.readFileSync(f, 'utf8');
      const prompt = fs.readFileSync(path.join(O, 'prompts', `${set}-${r.page_id}.txt`), 'utf8');
      out.push({ page_id: r.page_id, arm: 'O', text: sanitizeTranslationTags(raw.trim()),
        gen: { model: 'claude-opus-5-5 (subagent, subscription)', usd: 0, batch_usd: 0, thinking: null, prompt_chars: prompt.length, out_chars: raw.length } });
    }
    fs.writeFileSync(file, out.map((x) => JSON.stringify(x)).join('\n') + '\n');
    console.log(`${set}: ${out.length} pages → ${file}; missing ${missing.length}${missing.length ? ` (${missing.join(', ')})` : ''}`);
  }
}
