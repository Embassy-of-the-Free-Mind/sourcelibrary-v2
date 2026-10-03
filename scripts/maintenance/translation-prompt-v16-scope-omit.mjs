#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/translation-prompt-v15-verbatim-original.mjs — same once()
// anchored edit, same non-default row shape. It cannot be reused as-is: it builds from the LIVE
// default (v13) and applies all five #3825 edits; v16 is v15 + ONE sentence, so it must build
// from the v15 row and leave everything else in it byte-identical.
/**
 * Translation prompt v16 = v15 + one sentence (#3825, #5698 step 1).
 *
 * The v13-vs-v15 A/B (PR #4767, results/translation-prompt-v15-report-2026-09-12.md) found
 * v15's verbatim rule works (verified original-notes 66.7% → 96.3%) but that its
 * "if you cannot copy the phrase exactly … OMIT the note" is read as licence to omit notes in
 * general: interpretive (non-`original:`) notes fell 1.27 → 0.81 per page in every stratum,
 * and the blind judge found v15 the losing side 8:1. The fix specified that day: scope the
 * omit rule to the quoted phrase in an `original:` note, and say that interpretive and
 * clarifying notes are still wanted. That is the only change; the bullet goes directly
 * after the OMIT bullet it scopes.
 *
 * The row lands is_default:false and stays there. Flipping is Derek's call after
 * scripts/eval/translation-prompt-ab.mjs --tag v16 (PREREGISTRATION-translation-prompt-v15.md,
 * Amendment 2). This script never edits the v13 or v15 rows.
 *
 *   node --env-file=.env.production.local scripts/maintenance/translation-prompt-v16-scope-omit.mjs           # dry run: prints the diff
 *   node --env-file=.env.production.local scripts/maintenance/translation-prompt-v16-scope-omit.mjs --apply   # insert v16, is_default:false
 */
import { MongoClient } from 'mongodb';
import { createHash } from 'crypto';

const APPLY = process.argv.includes('--apply');
const FROM = 15;
const VERSION = 16;
const hash = (s) => createHash('md5').update(s).digest('hex');

if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

/** Replace exactly once, or throw. A prompt edit that misses is worse than one that fails. */
function once(text, find, replace, label) {
  const n = text.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] anchor matched ${n}x, expected 1:\n  ${find.slice(0, 110)}`);
  return text.replace(find, replace);
}

// The v15 OMIT bullet, verbatim (translation-prompt-v15-verbatim-original.mjs RULE_VERBATIM).
const OMIT_BULLET = '- If you cannot copy the phrase exactly as it stands in the OCR — because you are reconstructing it from memory, from your translation, from the standard form of the phrase, or from a parallel text — OMIT the note. A missing note is harmless; an invented one is a fabricated quotation that scholars will cite.\n';
// The one sentence. No em-dash: the prompt forbids them in prose it asks for, so it should not model one.
const SCOPE_SENTENCE = '- This omit rule applies only to the quoted phrase in a <note>original: "…"</note>; interpretive and clarifying notes (identifying a person, a place or a cited text, explaining wordplay, a technical term or an allusion) are still wanted wherever a reader would need them.\n';

const NOTES = `v15 + one sentence (#3825, #5698 step 1): the OMIT instruction in the verbatim rule is scoped to the quoted phrase of an original: note, and interpretive/clarifying notes are stated to be still wanted. Why: under v15 interpretive notes fell 1.27 -> 0.81/page and the blind judge scored 8:1 against it (results/translation-prompt-v15-report-2026-09-12.md). Seeded non-default; flip only after translation-prompt-ab.mjs --tag v16 under PREREGISTRATION-translation-prompt-v15.md Amendment 2. Rollback: nothing to roll back while non-default.`;

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const col = c.db('bookstore').collection('prompts');
try {
  const base = await col.findOne({ type: 'translation', name: 'Standard Translation', version: FROM });
  if (!base) throw new Error(`translation v${FROM} not found`);
  const content = once(base.content, OMIT_BULLET, OMIT_BULLET + SCOPE_SENTENCE, 'scope the omit rule');

  console.log(`=== translation: v${FROM} (${base.content.length} chars, ${hash(base.content).slice(0, 8)}) -> v${VERSION} (${content.length} chars, ${hash(content).slice(0, 8)}) ===`);
  console.log(`--- the only change: one line inserted after ---\n  ${OMIT_BULLET.trim()}\n+ ${SCOPE_SENTENCE.trim()}\n--- end ---`);

  const existing = await col.findOne({ type: 'translation', version: VERSION });
  if (existing) { console.log(`translation v${VERSION} already exists (${existing._id}, default=${!!existing.is_default}, ${hash(existing.content).slice(0, 8)}) — not touching it`); process.exit(0); }
  if (!APPLY) { console.log('(dry run — pass --apply to insert the row, is_default:false)'); process.exit(0); }

  const { insertedId } = await col.insertOne({
    name: base.name, type: 'translation', version: VERSION, is_default: false,
    content, content_hash: hash(content),
    created_at: new Date().toISOString(),
    notes: NOTES,
    parent_version: FROM,
  });
  console.log(`inserted ${insertedId} (is_default:false)`);
  const def = await col.findOne({ type: 'translation', is_default: true }, { projection: { version: 1 } });
  console.log(`default translation prompt is still v${def.version}`);
} finally {
  await c.close();
}
