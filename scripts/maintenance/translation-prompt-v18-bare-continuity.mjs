#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/translation-prompt-v16-scope-omit.mjs — same once() anchored edit
// and non-default row shape, reused here. It cannot be reused as-is: it builds from v15, and every
// row from v14 to v17 still carries the line this script changes; v18 builds from the LIVE default
// (v13) so the one line is the only difference. The wording is item 1b of
// scripts/eval/translation-prompt-v14-ab.mjs (V14_EDITS[1]), byte for byte — the edit measured there.
/**
 * Translation prompt v18 = v13 + ONE line: the continuity marker carries no payload (#7085, #5376 item 1b).
 *
 * v13's own instruction 1 says to start a continuing page with the bare marker
 * `<meta>continues from previous page</meta>` and then translate. Its "Do NOT use" list contradicts
 * that: it shows the marker as `<meta>continues from previous page: ...</meta>`, a slot after a
 * colon. The model fills the slot, sometimes with the page's own opening lines, and every reader
 * surface strips <meta> with its content. Measured 2026-10-21 over the live corpus (#7085): 375,143
 * translated pages carry the marker, 106,064 with a payload of 8+ words; 8,354 of those (7,703 in
 * visible books, 1.27M words) are classed own-text by scripts/audit/hidden-meta-scan.mjs, and 10 of
 * 10 sampled by eye were this page's text. That class is a floor: Capellanus De amore p.158 is in
 * the undecided class and re-translated with v13 on 2026-10-21, it filed its opening sentence in the
 * meta again.
 *
 * Evidence for the line: in the seam confirmatory run (scripts/eval/experiments/
 * 2026-10-03-translation-seam-confirm-5305.md) the arm carrying it wrote a meta payload on 0 pages
 * against 6 and 5 for the two v13 arms (p 0.031), with control invention and omission inside noise.
 * That arm also carried item 1 ("This page only"), so the line alone is not separately measured.
 *
 * The row lands is_default:false. Flipping it is Derek's call. This script never edits another row.
 *
 *   node --env-file=.env.production.local scripts/maintenance/translation-prompt-v18-bare-continuity.mjs           # dry run: prints the diff
 *   node --env-file=.env.production.local scripts/maintenance/translation-prompt-v18-bare-continuity.mjs --apply   # insert v18, is_default:false
 */
import { MongoClient } from 'mongodb';
import { createHash } from 'crypto';

const APPLY = process.argv.includes('--apply');
const FROM = 13;
const VERSION = 18;
const hash = (s) => createHash('md5').update(s).digest('hex');

// V14_EDITS[1] in scripts/eval/translation-prompt-v14-ab.mjs, verbatim.
export const PAYLOAD_LINE = '  - Context from previous page → <meta>continues from previous page: ...</meta>';
export const BARE_LINE = '  - Context from previous page → <meta>continues from previous page</meta>, the marker alone. Write nothing after it inside the tag: every word of this page belongs in the translation itself.';

/** Replace exactly once, or throw. A prompt edit that misses is worse than one that fails. */
export function once(text, find, replace, label) {
  const n = text.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] anchor matched ${n}x, expected 1:\n  ${find.slice(0, 110)}`);
  return text.replace(find, () => replace);
}

export const buildV18 = (v13) => once(v13, PAYLOAD_LINE, BARE_LINE, 'bare continuity marker');

const NOTES = `v13 + one line (#7085, #5376 item 1b): the "Do NOT use" list showed the continuity marker with a payload slot ("continues from previous page: ..."), contradicting instruction 1; it now says the marker alone. Why: 8,354+ live pages hide their own opening text in that meta (scan 2026-10-21, #7085). Wording byte-identical to V14_EDITS[1] (scripts/eval/translation-prompt-v14-ab.mjs). Seeded non-default. Rollback: nothing to roll back while non-default.`;

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const col = c.db('bookstore').collection('prompts');
  try {
    const base = await col.findOne({ type: 'translation', name: 'Standard Translation', version: FROM });
    if (!base) throw new Error(`translation v${FROM} not found`);
    const content = buildV18(base.content);

    console.log(`=== translation: v${FROM} (${base.content.length} chars, ${hash(base.content).slice(0, 8)}) -> v${VERSION} (${content.length} chars, ${hash(content).slice(0, 8)}) ===`);
    console.log(`--- the only change ---\n- ${PAYLOAD_LINE.trim()}\n+ ${BARE_LINE.trim()}\n--- end ---`);

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
}
