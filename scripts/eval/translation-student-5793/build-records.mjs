#!/usr/bin/env node
// PRIOR ART: translation-vs-reference/from-ab-sample.mjs (#5702) converts a #5606 sample into harness records; the
// #5793 test pages are already harness records (T1), so this only swaps in the three #5793 arms, cleaned alike.
/**
 *   node build-records.mjs --base <zs-qwen.jsonl> --student <student-test.jsonl> --out <records.jsonl>
 * lite = T1's prod-A (gemini-3.1-flash-lite, production call shape). Every arm passes through cleanTranslation().
 */
import fs from 'node:fs';
import path from 'node:path';
import { cleanTranslation } from './prompt.mjs';

const arg = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const t1 = readJsonl(path.join(REPO, 'scripts/eval/results/xlref-t1-2026-10/records.jsonl'));
const byId = (f) => new Map(readJsonl(f).map((r) => [r.id, r]));
const base = byId(arg('--base')), student = arg('--student') ? byId(arg('--student')) : null;
const out = [];
for (const r of t1) {
  const id = `test:${r.book_id}_${r.page_number}`;
  const lite = r.candidates.find((c) => c.arm === 'prod-A');
  if (!lite) throw new Error(`no prod-A for ${id}`);
  const cands = [{ arm: 'lite', text: cleanTranslation(lite.text), model: lite.model },
    { arm: 'base', text: cleanTranslation(base.get(id)?.text), model: 'Qwen/Qwen3-8B', finish: base.get(id)?.finish }];
  if (student) cands.push({ arm: 'student', text: cleanTranslation(student.get(id)?.text), model: 'Qwen/Qwen3-8B+lora-5793', finish: student.get(id)?.finish });
  const { candidates, ...rest } = r;
  out.push({ ...rest, track: 'student-5793', candidates: cands });
}
fs.writeFileSync(arg('--out'), out.map((r) => JSON.stringify(r)).join('\n') + '\n');
const empty = out.flatMap((r) => r.candidates.filter((c) => !c.text.trim()).map((c) => `${r.book_id}:${r.page_number}:${c.arm}`));
console.log(`${out.length} records → ${arg('--out')}; empty candidates: ${empty.length ? empty.join(', ') : 'none'}`);
