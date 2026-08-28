#!/usr/bin/env node
/**
 * Wellcome Collection — Sanskrit wave 1 import (issue #4311, Workstream 3).
 * Step 4 of the import loop: import the curated subset HIDDEN.
 * Runs under the #4225 standing policy: acquire + archive, no OCR/translation.
 *
 * Curation applied (step 3 of the loop):
 *   - status NEW only (HELD / TITLE_CLASH excluded by the enumerator)
 *   - license pdm or cc-by only — the 18 `inc` (in-copyright) works are excluded
 *   - minus EXCLUDE_IDS: modern government pharmacopoeias and Wellcome's own
 *     library catalogues — reference works, not historical primary sources
 *
 * Resumable: every attempt is appended to the progress ledger, and a re-run
 * skips work_ids already recorded there. (The machine sleeps; jobs get killed.)
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/import/wellcome-sanskrit-import.mjs --dry-run
 *   node --env-file=.env.production.local scripts/import/wellcome-sanskrit-import.mjs --apply [--limit N]
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const CANDIDATES = new URL('./wellcome-sanskrit-candidates.json', import.meta.url).pathname;
const LEDGER = new URL('./wellcome-sanskrit-import-ledger.jsonl', import.meta.url).pathname;
const BASE = process.env.IMPORT_BASE_URL || 'https://sourcelibrary.org';

// Reference works, not primary sources — excluded by hand after review.
const EXCLUDE_IDS = new Set([
  'f4rz2akk', // The Ayurvedic formulary of India (2003-) — modern govt pharmacopoeia
  'wuefsh5j', // The Ayurvedic Pharmacopoeia of India (1989-) — modern govt pharmacopoeia
  'n5usb8kq', // Wellcome's own Sanskrit/Prakrit MS handlist (1985) — finding aid
  'vqjddjxu', // Catalogue of books in Sanskrit, Hindi and European languages (1984)
]);

const all = JSON.parse(readFileSync(CANDIDATES, 'utf8'));
const wave = all.filter(c =>
  c.status === 'NEW'
  && (c.license === 'pdm' || c.license === 'cc-by')
  && !EXCLUDE_IDS.has(c.work_id));

// Resume: skip anything already attempted successfully.
const done = new Set();
if (existsSync(LEDGER)) {
  for (const line of readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean)) {
    try { const r = JSON.parse(line); if (r.ok || r.status === 409) done.add(r.work_id); } catch {}
  }
}
const todo = wave.filter(c => !done.has(c.work_id)).slice(0, LIMIT);

const AYURVEDIC = /ayurved|medicine|anatomy|materia medica|pharmac|vaidya|nighan|sarira|śārīra|samhita|saṃhitā/i;
const collectionsFor = (c) => {
  const hay = `${c.title} ${(c.subjects || []).join(' ')}`;
  const out = ['indic-traditions'];
  if (AYURVEDIC.test(hay)) out.push('ayurveda');
  return out;
};

console.log(`candidates: ${all.length} | wave (NEW + open license): ${wave.length} | already done: ${done.size} | to import now: ${todo.length}`);
if (!APPLY) {
  for (const c of todo.slice(0, 10)) console.log(`  would import: ${c.work_id}  [${collectionsFor(c).join(',')}]  ${c.title.slice(0, 70)}`);
  console.log('DRY RUN — pass --apply to import (books land hidden).');
  process.exit(0);
}

const secret = (process.env.CRON_SECRET || '').replace(/\\n/g, '').trim();
if (!secret) { console.error('CRON_SECRET missing'); process.exit(1); }

let ok = 0, dup = 0, fail = 0;
for (const [i, c] of todo.entries()) {
  let res, body;
  try {
    res = await fetch(`${BASE}/api/import/wellcome`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      // Do NOT force language: Wellcome tags these `languages=san` because
      // Sanskrit is *a* language of the item, but many are English or Hindi
      // TRANSLATIONS. `books.language` is the EDITION's language
      // (.claude/docs/invariants/language-fields.md), and text_role is derived
      // from it at import — forcing 'Sanskrit' mislabels translations as
      // originals. The route's own default (work.languages[0]) is correct.
      body: JSON.stringify({ work_id: c.work_id, collections: collectionsFor(c) }),
    });
    body = await res.text();
  } catch (e) {
    fail++;
    appendFileSync(LEDGER, JSON.stringify({ work_id: c.work_id, ok: false, error: String(e) }) + '\n');
    console.log(`  [${i + 1}/${todo.length}] ERROR ${c.work_id}: ${e}`);
    continue;
  }
  const rec = { work_id: c.work_id, title: c.title, status: res.status, ok: res.ok, body: body.slice(0, 300), at: new Date().toISOString() };
  appendFileSync(LEDGER, JSON.stringify(rec) + '\n');
  if (res.ok) { ok++; }
  else if (res.status === 409) { dup++; }
  else { fail++; }
  console.log(`  [${i + 1}/${todo.length}] ${res.status} ${c.work_id} ${c.title.slice(0, 55)}`);
  await new Promise(r => setTimeout(r, 2000)); // polite to Wellcome + our own route
}
console.log(`\nimported: ${ok}  duplicate/skipped: ${dup}  failed: ${fail}`);
console.log('Books landed HIDDEN. Next: archive page images to R2, then QA before any visibility flip.');
