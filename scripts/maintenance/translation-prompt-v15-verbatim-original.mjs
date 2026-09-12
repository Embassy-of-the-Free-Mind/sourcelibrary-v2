#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/ocr-prompt-v17-lacuna.mjs — the seeding pattern (anchored
// once() edits, non-default row, content_hash) is reused verbatim; it cannot be reused as a
// script because its plan is hard-wired to v15→v17 / v12→v14 and carries a --promote path.
// This one seeds ONE translation row from the LIVE default and has no promote path at all.
/**
 * Translation prompt v15 — verbatim <note>original: "…"</note> (#3825 item 2, #3308).
 *
 * What it fixes: 12.2% of `original:` notes quote a phrase that is not on the page (#3308,
 * 2026-08-09 census); the page_terms harvest verifies each note against ocr.data and finds
 * 91% verified corpus-wide (#4695 — 2,994,644 verified / 950,246 not, on the first 31K
 * books). The notes are read as CITATIONS by scholars and indexed by search, so a fabricated
 * one is a quotation that never existed. The rule below makes the quoted phrase a
 * character-for-character copy of the OCR input, or nothing.
 *
 * Built from the CURRENT default translation prompt (v13 as of 2026-09-11 — v13 is the
 * `<unclear>`-is-absence rule, NOT the "v13" #3825 planned; that issue's number was taken
 * by #4584's interim row). v14 (#4584 `<lacuna>`) is a separate, still non-default
 * candidate; if it is promoted first, re-run this with --from 14 and --version 16.
 *
 * ORDERING: the new row lands with is_default:false and STAYS there. Flipping the default is
 * Derek's call, after the #3825 process — qa-eval scorecard old vs new, including a
 * canonical-text sample and a look at the `original:` verification rate on the new pages
 * (build-page-terms.mjs --book <id> reports verified/unverified per book).
 *
 *   node --env-file=.env.production.local scripts/maintenance/translation-prompt-v15-verbatim-original.mjs           # dry run: prints the diff
 *   node --env-file=.env.production.local scripts/maintenance/translation-prompt-v15-verbatim-original.mjs --apply   # insert v15, is_default:false
 *   --from <n> (default: the live default's version) · --version <n> (default 15) · --replace (rewrite an existing NON-default row)
 */
import { MongoClient } from 'mongodb';
import { createHash } from 'crypto';

const args = process.argv.slice(2);
const getArg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const APPLY = args.includes('--apply');
const REPLACE = args.includes('--replace');
const VERSION = Number(getArg('--version') || 15);
const FROM = getArg('--from') ? Number(getArg('--from')) : null;
const hash = (s) => createHash('md5').update(s).digest('hex');

if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

/** Replace exactly once, or throw. A prompt edit that misses is worse than one that fails. */
function once(text, find, replace, label) {
  const n = text.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] anchor matched ${n}x, expected 1:\n  ${find.slice(0, 110)}`);
  return text.replace(find, replace);
}

const RULE = `**<note>original: "…"</note> must be VERBATIM (CRITICAL):**
- The quoted phrase inside <note>original: "…"</note> is a citation of the source. Copy it character-for-character from the OCR input on THIS page: same spelling, same script, same diacritics, same abbreviations, same word order. Do not normalise, modernise, expand, translate or "correct" it.
- If you cannot copy the phrase exactly as it stands in the OCR — because you are reconstructing it from memory, from your translation, from the standard form of the phrase, or from a parallel text — OMIT the note. A missing note is harmless; an invented one is a fabricated quotation that scholars will cite.
- Never quote text that is not on this page: not a heading from another page, not the title the work is known by, not the phrase as it appears in a printed edition you remember.
- A transliteration in parentheses after the quote is fine — <note>original: "ἡσυχίαν" (hesychian)</note> — the quoted part is still verbatim.
- Keep the note short: the phrase itself, a few words. Whole sentences are for <term>/<gloss> and the translation, not for original-notes.

`;

const NOTES = `v{from} + verbatim original-notes rule (#3825 item 2): the phrase inside <note>original: "…"</note> is a character-for-character copy of the OCR input or the note is omitted. Motivation: 12.2% of original-notes were fabricated (#3308); the page_terms harvest verifies 91% (#4695). Seeded is_default:false; flip only after a qa-eval scorecard v{from} vs v{version}. Rollback: nothing to roll back while non-default.`;

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const col = c.db('bookstore').collection('prompts');
try {
  const live = await col.findOne({ type: 'translation', is_default: true });
  if (!live) throw new Error('no default translation prompt');
  const from = FROM ?? live.version;
  const base = from === live.version ? live : await col.findOne({ type: 'translation', name: live.name, version: from });
  if (!base) throw new Error(`translation v${from} not found`);
  if (from !== live.version) console.warn(`building from v${from}, but the live default is v${live.version}`);

  const ANCHOR = '\n**Image descriptions from OCR:**';
  const content = once(base.content, ANCHOR, '\n' + RULE + ANCHOR.slice(1), 'verbatim rule before image-desc section');
  if (!/original: "\.\.\."|original: "…"/.test(base.content)) console.warn('note: the base prompt does not mention original-notes where expected; read the diff carefully');

  console.log(`\n=== translation: v${from} (${base.content.length} chars, ${hash(base.content).slice(0, 8)}) -> v${VERSION} (${content.length} chars, ${hash(content).slice(0, 8)}) ===`);
  console.log('--- inserted block ---\n' + RULE + '--- end ---');

  const existing = await col.findOne({ type: 'translation', name: base.name, version: VERSION });
  if (existing?.is_default) throw new Error(`refusing to touch a LIVE default (translation v${VERSION}); demote it first`);
  if (existing && !REPLACE) { console.log(`translation v${VERSION} already exists (${existing._id}) — pass --replace to rewrite it`); process.exit(0); }
  if (!APPLY) { console.log('(dry run — pass --apply to insert the row, is_default:false)'); process.exit(0); }

  const doc = {
    name: base.name, type: 'translation', version: VERSION, is_default: false,
    content, content_hash: hash(content),
    created_at: new Date().toISOString(),
    notes: NOTES.replace(/\{from\}/g, String(from)).replace(/\{version\}/g, String(VERSION)),
    parent_version: from,
  };
  if (existing) { await col.replaceOne({ _id: existing._id }, doc); console.log(`replaced ${existing._id} (is_default:false)`); }
  else { const { insertedId } = await col.insertOne(doc); console.log(`inserted ${insertedId} (is_default:false)`); }
  const def = await col.findOne({ type: 'translation', is_default: true }, { projection: { version: 1 } });
  console.log(`default translation prompt is still v${def.version}`);
} finally {
  await c.close();
}
