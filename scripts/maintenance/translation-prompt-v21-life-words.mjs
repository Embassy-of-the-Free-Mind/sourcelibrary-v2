#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/translation-prompt-v18-bare-continuity.mjs — the once() anchored edit and the
// non-default row shape, reused here (once() imported from it). Built from the live default (v13) so the new block is
// the only difference. Numbered 21: v19 is the #4741 cognate arm (eval only) and v20 is the #7499 bench candidate
// (prompts/translation/standard-translation-v20-candidate.md on job-prompt-bench-7499), so neither number is free.
// The block is anchored on "**Instructions:**", which v13 and that v20 candidate both carry, so it stacks on either.
/**
 * Translation prompt v21 = v13 + ONE block: gloss life-words by what they say (#7458).
 *
 * The model's own apparatus calls 氣 "vital energy" and prāṇa or āyus a "life force": 17,696 pages carried one of
 * those phrases inside a <gloss>, <note> or <term> in 2026-10, 4,550 with the bare <gloss>vital energy</gloss>. That
 * imports a modern vitalist reading into sources that say breath, vapour, lifespan. The block names the common words
 * and keeps "life force" for a source that names such a force itself.
 *
 * Measured before seeding: scripts/eval/experiments/2026-10-31-gloss-life-words-prompt-7458.md.
 *
 *   node --env-file=.env.production.local scripts/maintenance/translation-prompt-v21-life-words.mjs           # dry run
 *   node --env-file=.env.production.local scripts/maintenance/translation-prompt-v21-life-words.mjs --apply   # insert v21, is_default:false
 *   node --env-file=.env.production.local scripts/maintenance/translation-prompt-v21-life-words.mjs --promote # v21 default, v13 not
 *
 * --apply lands the row is_default:false and touches no other row. --promote (2026-10-31, after the pre-registered rule
 * passed) refuses unless v13 is the one default with its registered hash and v21's text is buildV21(v13); then it sets
 * is_default on v21 and clears it on v13, and stamps both rows. Rollback: set is_default:true on v13, false on v21.
 */
import { MongoClient } from 'mongodb';
import { createHash } from 'crypto';
import { once } from './translation-prompt-v18-bare-continuity.mjs';

const APPLY = process.argv.includes('--apply');
const PROMOTE = process.argv.includes('--promote');
const V13_HASH = '516510147237b6a79d9d3f6e797bba7f';
const FROM = 13;
const VERSION = 21;
const hash = (s) => createHash('md5').update(s).digest('hex');

export const ANCHOR = '**Instructions:**\n1. ';
export const LIFE_WORDS = `**Words for breath, life and lifespan (in the text and in <gloss>, <term> and <note>):**
- Render these words by what they say in this source, never by a modern idea of a "life force" or "energy":
  - 氣 / qi: "breath", "vapour" or "air", as the context requires; where no one English word fits, keep <term>qi</term> <gloss>breath, vapour</gloss>. Never "vital energy", "life force" or "energy".
  - prāṇa: "breath" (its five kinds are breaths or winds); āyus: "lifespan"; 命: "life", "lifespan" or "allotted fate", as the context requires.
  - pneuma, spiritus, ruach, rlung, srog: "breath", "spirit", "wind" or "life", as the source uses the word.
- Write "life force", "vital force" or "vital energy" only where the source itself names such a force: vis vitalis, Lebenskraft, force vitale or an equivalent. A note may say what a word meant to its author; it must not add a later vitalist reading.

`;

export const buildV21 = (base) => once(base, ANCHOR, LIFE_WORDS + ANCHOR, 'life words');

const NOTES = `v13 + one block (#7458): life-words (氣, prāṇa, āyus, 命, pneuma/spiritus/srog) are rendered by what they say; "life force" / "vital energy" only where the source names such a force (vis vitalis, Lebenskraft). Why: 17,696 pages carry those phrases in the model's own gloss/note/term apparatus (count 2026-10-26, #7458). Measured: scripts/eval/experiments/2026-10-31-gloss-life-words-prompt-7458.md. Seeded non-default. Rollback: nothing to roll back while non-default.`;

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const col = c.db('bookstore').collection('prompts');
  try {
    const base = await col.findOne({ type: 'translation', name: 'Standard Translation', version: FROM });
    if (!base) throw new Error(`translation v${FROM} not found`);
    const content = buildV21(base.content);
    console.log(`=== translation: v${FROM} (${base.content.length} chars, ${hash(base.content).slice(0, 8)}) -> v${VERSION} (${content.length} chars, ${hash(content).slice(0, 8)}) ===`);
    console.log(`--- the only change: inserted before "**Instructions:**" ---\n${LIFE_WORDS}--- end ---`);
    const existing = await col.findOne({ type: 'translation', version: VERSION });
    if (PROMOTE) {
      const defs = await col.find({ type: 'translation', is_default: true }).toArray();
      if (defs.length !== 1 || defs[0].version !== FROM || hash(defs[0].content) !== V13_HASH) throw new Error(`refusing: the default is not exactly v${FROM} ${V13_HASH.slice(0, 8)} (${defs.map((d) => `v${d.version} ${hash(d.content).slice(0, 8)}`).join(', ')})`);
      if (!existing || existing.content !== buildV21(defs[0].content)) throw new Error(`refusing: v${VERSION} is missing or is not buildV21(v${FROM}); run --apply first`);
      const at = new Date().toISOString();
      const why = 'scripts/eval/experiments/2026-10-31-gloss-life-words-prompt-7458.md (pre-registered rule passed)';
      // uniq_default_per_type (partial unique on is_default) refuses a second default, so v13 is cleared first; one
      // transaction, so no loader ever sees zero defaults (loadTranslationPrompts throws on none).
      const session = c.startSession();
      try {
        await session.withTransaction(async () => {
          await col.updateOne({ _id: defs[0]._id }, { $set: { is_default: false, demoted_at: at, demoted_note: `superseded by v${VERSION} (#7458). Rollback: is_default:true here, false on v${VERSION}.` } }, { session });
          await col.updateOne({ _id: existing._id }, { $set: { is_default: true, promoted_at: at, promoted_note: `default from v${FROM} (#7458): ${why}. Rollback: is_default:true on v${FROM}, false here.` } }, { session });
        });
      } finally { await session.endSession(); }
      const now = await col.find({ type: 'translation', is_default: true }, { projection: { version: 1 } }).toArray();
      console.log(`default translation prompt is now ${now.map((d) => `v${d.version}`).join(', ')}`);
      process.exit(0);
    }
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
}
