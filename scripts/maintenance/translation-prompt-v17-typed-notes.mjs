#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/translation-prompt-v16-scope-omit.mjs — same once() anchored
// edit and the same non-default row shape, reused here. It cannot be reused as-is: it inserts
// ONE sentence into v15 and one row; v17 is eleven anchored edits to the v16 row and two rows
// (one per stance). scripts/eval/translation-prompt-v14-ab.mjs holds a "translate the
// description only" image edit as an in-memory arm, never seeded.
/**
 * Translation prompt v17 = v16 + notes as a typed apparatus + a stance (#5698 step 2).
 *
 * v16's verbatim rule for <note>original: "…"</note> is kept byte for byte. What changes:
 *
 *   1. OUR notes open with their type, inside the SAME <note> tag:
 *        <note>original: "…"</note>        verbatim from the OCR, or omitted (v15/v16, unchanged)
 *        <note>clarification: …</note>     words the translator supplies
 *        <note>context: …</note>           a checkable fact: a person, place, work, date
 *        <note>alternative: …</note>       the source admits another reading; one line
 *        <note>image: …</note>             what a picture shows, and nothing it does not show
 *      A prefix, not an attribute: `<note type="…">` is invisible to the ten consumers that
 *      match the literal `<note>` (the #5647 fact-check lane, notes-off's glossary rule, the
 *      Typst/PDF exports — inventory in PREREGISTRATION-translation-prompt-v17.md). An untyped
 *      <note> stays valid everywhere.
 *   2. Notes PRINTED ON THE PAGE (footnotes, interlinear and double-column commentary) are the
 *      source's: <margin>/<gloss>, never <note> (#2709, #5698 by-eye comment).
 *   3. Scan-condition <warning>s and decorative-initial descriptions do not become notes.
 *   4. The translator never emends silently: the source's reading stays in the text and the
 *      correction or the second reading goes in an `alternative` note.
 *   5. Image descriptions are descriptive only; the example no longer models added symbolism.
 *   6. "Warm museum label" becomes a STANCE: `study` or `reading`, one prompt row each.
 *   7. Three convention lines per tradition (Buddhist, Kabbalistic, Arabic/Persian). No term
 *      table: a glossary block raised reversals on Tibetan (#5497 arm D).
 *
 * Both rows land is_default:false and stay there. Nothing reads a non-default prompt row:
 * every loader filters `is_default: true` (translate-core loadTranslationPrompts,
 * translate-worker, src/lib/prompts.ts). Flipping is Derek's call, and not before the reader
 * and parser changes listed in the experiment file. This script never edits another row.
 *
 *   node --env-file=.env.production.local scripts/maintenance/translation-prompt-v17-typed-notes.mjs            # dry run: prints both texts' diff summary
 *   node --env-file=.env.production.local scripts/maintenance/translation-prompt-v17-typed-notes.mjs --print study|reading
 *   node --env-file=.env.production.local scripts/maintenance/translation-prompt-v17-typed-notes.mjs --apply    # insert both rows, is_default:false
 */
import { MongoClient } from 'mongodb';
import { createHash } from 'crypto';

const APPLY = process.argv.includes('--apply');
const PRINT = process.argv.includes('--print') ? process.argv[process.argv.indexOf('--print') + 1] : null;
const FROM = 16;
const VERSION = 17;
const hash = (s) => createHash('md5').update(s).digest('hex');

if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

/** Replace exactly once, or throw. A prompt edit that misses is worse than one that fails. */
function once(text, find, replace, label) {
  const n = text.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] anchor matched ${n}x, expected 1:\n  ${find.slice(0, 110)}`);
  return text.replace(find, replace);
}

const TYPED_SECTION = `**Notes are a typed apparatus (CRITICAL):**
A <note> is OUR voice, never the source's. Every <note> opens with one of five types, a word and a colon. Choose the type first; if none fits, the note is not needed.
- <note>original: "…"</note> — the source's own wording, verbatim, under the rule above.
- <note>clarification: …</note> — words you supply so that the English sentence works: an implied subject, object or verb, the referent of a pronoun. A few words, placed where they belong in the sentence.
- <note>context: …</note> — one checkable fact a reader needs: who a person is, where a place is, which work or verse is cited, a date. One sentence. State only what you are sure of; if you are not sure, omit the note. No interpretation, symbolism or praise. These notes are fact-checked.
- <note>alternative: …</note> — the source admits another reading: a negation that could attach elsewhere, an ambiguous subject, object or speaker, a word with two live senses, a number or word the OCR may have misread. Keep the more literal reading in the text and give the other in one line: <note>alternative: or "do not abide in an object"</note>. Never settle an ambiguity silently.
- <note>image: …</note> — what a picture, diagram or figure on the page shows (see "Image descriptions").
Rules for all five:
- Never correct the source in the text. If you believe a number, name or word is wrong, or you prefer an editor's conjecture, translate what the page says and put the correction in an alternative note: the page reads "seven", so the text says seven <note>alternative: perhaps "seventeen", if the source is in error</note>.
- A note PRINTED ON THE PAGE is not ours. Footnotes, marginal notes, editors' notes and interlinear or double-column commentary are part of the source: translate them in <margin>…</margin> (or <gloss>…</gloss> when the OCR marks them so), never in <note>.
- A remark about the scan (staining, show-through, a cropped edge, an illegible patch) is not a note. If the OCR carries one in <warning>, leave it out; say it in <meta> only when it changes what you could translate.
- Do not stack notes: at most one note of each type on a phrase.

`;

const TRADITIONS = `**Term conventions by tradition (apply only when the page belongs to one):**
- Buddhist texts (Sanskrit, Pali, Tibetan, Chinese): keep established Sanskrit or Pali terms transliterated in <term>…</term> with a <gloss> on first use (dharma, bodhisattva, nirvāṇa, samādhi, dhāraṇī); do not flatten them into everyday English, and do not supply a Sanskrit equivalent that the page does not give.
- Kabbalistic and rabbinic texts: keep the names of the sefirot and the divine names as transliterated names in <term>…</term> (Keter, Hokhmah, Binah, Hesed, Gevurah, Tiferet, Netzah, Hod, Yesod, Malkhut; Ein Sof; Shekhinah), with the English sense in <gloss> on first use. Give a biblical or Talmudic citation in a context note only when the page itself names or quotes the verse.
- Arabic and Persian texts: keep technical terms of law, philosophy, medicine, astronomy and Sufism transliterated in <term>…</term> with a <gloss>; translate honorific and blessing formulae plainly and do not expand them.

`;

const STANCE = {
  study: {
    block: `**Stance: STUDY.**
This translation is a crib for a reader working beside the original.
- Follow the source's order, syntax and wording as closely as English allows. Where a literal rendering and a smoother one differ, put the literal one in the text.
- Mark every word you supply with a clarification note. Do not expand, paraphrase or smooth over a difficulty.
- Give an alternative note wherever the source admits a second reading, above all at negations, numbers, and who does what to whom.
- Give an original note for the key terms, names and phrases a scholar would want to check, each verbatim from this page's OCR.
- Context notes are sparing: only the identification a reader needs to follow the argument.

`,
    notes7: '7. Notes follow the STUDY stance above: alternatives and originals wherever a scholar would check the source, clarifications for every supplied word, context sparingly.',
    style8: '8. Style: plain and close. Do not explain inside the text; a study reader has the original beside the English.',
  },
  reading: {
    block: `**Stance: READING.**
This translation is for a reader who does not have the original.
- Write natural, fluent English. Recast a sentence when the source's order would not read well, and keep its meaning whole.
- Keep notes few. Give an alternative note only where the second reading would change the sense: a negation, a number, who does what to whom. Those are never left out.
- Give an original note only for the page's key terms and titles, each verbatim from this page's OCR.
- Give a context note only for what a general reader cannot follow the passage without.
- Do not annotate what the text already makes clear, and do not explain inside the text.

`,
    notes7: '7. Notes follow the READING stance above: few, and only where a general reader needs one. An alternative that changes the sense is always given.',
    style8: '8. Style: clear, direct and warm, for a general reader. Explain through a short context note, never by expanding the text.',
  },
};

/** v16 → v17 for one stance. Every edit is anchored on v16's exact text. */
export function buildV17(base, stance) {
  const S = STANCE[stance];
  if (!S) throw new Error(`unknown stance ${stance}`);
  let t = base;
  t = once(t, '- <note>X</note> — interpretive notes, interpolated clarifications\n',
    '- <note>type: X</note> — OUR notes, each opening with its type: original, clarification, context, alternative or image (see "Notes are a typed apparatus")\n', 'tag list: note');
  t = once(t, '- <margin>X</margin> — translate and keep marginal notes\n',
    '- <margin>X</margin> — translate and keep marginal notes, and every other note printed on the page (footnotes, editors\' notes, interlinear or double-column commentary): they are the source\'s, not ours\n', 'tag list: margin');
  t = once(t, '- <image-desc> is input too: translate what it describes and wrap the result in <note>…</note>, as described below. Never emit an <image-desc> tag yourself.\n',
    '- <image-desc> is input too: translate what it describes and wrap the result in <note>image: …</note>, as described below. Never emit an <image-desc> tag yourself.\n', 'housekeeping: image-desc');
  t = once(t, '  - Interpolated clarifications → <note>...</note>\n', '  - Interpolated clarifications → <note>clarification: ...</note>\n', 'do-not-use: clarifications');
  // The typed section goes directly after the verbatim rule it builds on.
  t = once(t, '- Keep the note short: the phrase itself, a few words. Whole sentences are for <term>/<gloss> and the translation, not for original-notes.\n\n',
    '- Keep the note short: the phrase itself, a few words. Whole sentences are for <term>/<gloss> and the translation, not for original-notes.\n\n' + TYPED_SECTION, 'typed section');
  t = once(t, `If the OCR contains <image-desc>...</image-desc>, translate the description and wrap the ENTIRE paragraph in <note>...</note>. Image descriptions are editorial content, not original text — they must be toggleable. Do NOT leave image description prose untagged. Example:
  OCR: <image-desc>A woodcut of a pelican feeding her young</image-desc>
  Translation: <note>A woodcut depicts a pelican feeding her young from her own breast, a symbol of self-sacrifice in alchemical tradition.</note>
`, `If the OCR contains <image-desc>...</image-desc>, translate the description and wrap the ENTIRE paragraph in <note>image: ...</note>. Image descriptions are editorial content, not original text: they must be toggleable. Do NOT leave image description prose untagged.
- Describe only. Translate what the description says and add nothing: no symbolism, no interpretation, no identification of a figure, no tradition, unless the page's own text states it.
- A decorative initial, ornament, rule, border or printer's device is not content. Leave its description out.
Example:
  OCR: <image-desc>A woodcut of a pelican feeding her young</image-desc>
  Translation: <note>image: A woodcut of a pelican feeding her young.</note>
`, 'image section');
  t = once(t, '6. For interpolated clarifications: <note>from the aspect of the secret</note>\n', '6. For interpolated clarifications: <note>clarification: from the aspect of the secret</note>\n', 'instruction 6');
  t = once(t, '7. Add <note>...</note> inline to explain historical references or difficult phrases.\n', S.notes7 + '\n', 'instruction 7');
  t = once(t, '8. Style: warm museum label - explain rather than assume knowledge.\n', S.style8 + '\n', 'instruction 8');
  t = once(t, '10. Wrap ALL image/illustration descriptions in <note>...</note> — readers can toggle these off.\n', '10. Wrap ALL image/illustration descriptions in <note>image: ...</note>: readers can toggle these off.\n', 'instruction 10');
  // #3825 v16 result: em-dashes rose +0.21/page, and the sentence that licenses source punctuation is the suspect.
  t = once(t, '- Never use em-dashes (—) in prose you compose. Use commas, colons, semicolons, or separate sentences. Punctuation you are reproducing from the source is not yours to change.\n',
    '- Never use em-dashes (—) in English you write, the translation included, even where the source prints a dash. Use commas, colons, semicolons, or separate sentences. Source punctuation is kept only inside a verbatim quotation (<note>original: "…"</note>, <term>).\n', 'em-dash');
  t = once(t, '**Writing style — applies to EVERY word you author:**\n', S.block + TRADITIONS + '**Writing style — applies to EVERY word you author:**\n', 'stance + traditions');
  return t;
}

const NOTES = (stance) => `v16 + typed notes + stance=${stance} (#5698 step 2). Notes open with a type inside the plain <note> tag (original / clarification / context / alternative / image); notes printed on the page go in <margin>/<gloss>; no silent emendation; image descriptions descriptive only; "warm museum label" replaced by the ${stance} stance; three per-tradition convention lines. v16's verbatim original rule is byte-identical. Seeded non-default for PREREGISTRATION-translation-prompt-v17.md; do not flip before the reader/parser changes in scripts/eval/experiments/2026-10-04-translation-prompt-v17-typed-notes-5698.md. Rollback: nothing to roll back while non-default.`;

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const col = c.db('bookstore').collection('prompts');
try {
  const base = await col.findOne({ type: 'translation', name: 'Standard Translation', version: FROM });
  if (!base) throw new Error(`translation v${FROM} not found`);
  for (const stance of ['study', 'reading']) {
    const content = buildV17(base.content, stance);
    const name = `Standard Translation (${stance})`;
    if (PRINT === stance) { process.stdout.write(content); continue; }
    if (PRINT) continue;
    console.log(`=== ${name}: v${FROM} (${base.content.length} chars, ${hash(base.content).slice(0, 8)}) -> v${VERSION} (${content.length} chars, ${hash(content).slice(0, 8)}) ===`);
    const existing = await col.findOne({ type: 'translation', name, version: VERSION });
    if (existing) { console.log(`  already exists (${existing._id}, default=${!!existing.is_default}, ${hash(existing.content).slice(0, 8)}${hash(existing.content) === hash(content) ? '' : ' — DIFFERS from this script'}) — not touching it`); continue; }
    if (!APPLY) { console.log('  (dry run — pass --apply to insert the row, is_default:false)'); continue; }
    const { insertedId } = await col.insertOne({
      name, type: 'translation', version: VERSION, is_default: false, stance,
      content, content_hash: hash(content),
      created_at: new Date().toISOString(),
      notes: NOTES(stance),
      parent_version: FROM,
    });
    console.log(`  inserted ${insertedId} (is_default:false)`);
  }
  if (!PRINT) {
    const def = await col.findOne({ type: 'translation', is_default: true }, { projection: { version: 1, name: 1 } });
    console.log(`default translation prompt is still ${def.name} v${def.version}`);
  }
} finally {
  await c.close();
}
