#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/ocr-prompt-v17-lacuna.mjs — the seeding pattern (anchored
// once() edits, non-default row, content_hash) is reused verbatim; it cannot be reused as a
// script because its plan is hard-wired to v15→v17 / v12→v14 and carries a --promote path.
// This one seeds ONE translation row from the LIVE default and has no promote path at all.
/**
 * Translation prompt v15 — the whole of #3825, seeded as ONE non-default row.
 *
 * Five edits, each anchored, each labelled with the #3825 item it implements:
 *
 *   1  closed tag vocabulary      "use ONLY the tags defined above; never invent a tag"
 *   2  verbatim original-notes    the phrase in <note>original: "…"</note> is copied or omitted
 *   3  no standalone glossary     terms annotated inline; <keywords> is the only end-of-page list
 *   4  housekeeping tags are IN   <vocab>/<lang>/<page-type>/<page-num>/<sig>/<scan-quality> never come out
 *   5  mechanical cleanup         duplicate 8/9 numbering; style rules scoped to ALL authored prose
 *
 * What item 2 fixes: 12.2% of `original:` notes quote a phrase that is not on the page (#3308,
 * 2026-08-09 census); the page_terms harvest verifies each note against ocr.data and finds
 * 91% verified corpus-wide (#4695 — 2,994,644 verified / 950,246 not, on the first 31K
 * books). The notes are read as CITATIONS by scholars and indexed by search, so a fabricated
 * one is a quotation that never existed. The rule makes the quoted phrase a
 * character-for-character copy of the OCR input, or nothing.
 *
 * What items 1/3/4 fix: the same census found 60–83 INVENTED tag tokens per side (literal
 * <p>/<br>/<i>, ad-hoc <greek>/<quote>/<center>) — models invent tags when the vocabulary is
 * open — plus translated <vocab> lists leaking into body text, the v2-era bug class.
 *
 * CONSUMER-SURFACE CHECK (a tag-vocabulary change is a contract change; #3825 names four):
 *   - NotesRenderer (src/components/reader/NotesRenderer.tsx) — strips lang/page-type/page-num/
 *     scan-quality/vocab, renders note/term/gloss/margin/insert/unclear. Every tag the closed
 *     vocabulary keeps is one it already renders; every tag item 4 removes is one it already
 *     strips. It even carries a regex for free-text "Vocabulary:" blocks (line ~180), i.e. the
 *     shape item 3 forbids — that fallback becomes dead code for new pages, not broken code.
 *   - build-book-index (src/lib/build-book-index.ts) — reads <vocab> from ocr.data ONLY, and
 *     <term>/<keywords> from translation.data. All three survive v15. The index does not read
 *     any tag item 4 suppresses from the translation side.
 *   - learn route (src/app/api/learn/route.ts) — flashcards require <term>X</term> immediately
 *     followed by <note>/<gloss>. v15 keeps that shape and moves it inline. NOTE: a trailing
 *     glossary block also satisfies the adjacency, so item 3 may reduce flashcard YIELD per
 *     page; the pairs it removes were the ambiguous shape #3811 had to teach the renderer to
 *     tolerate. Worth watching in the scorecard's term-emission counts, not a blocker.
 *   - download/export routes (src/app/api/books/[id]/download/route.ts →
 *     src/lib/export-markdown-html.ts) — placeholders for note/margin/gloss/term/unclear, then
 *     a strip list for lang/page-num/page-type/folio/sig/header/meta/warning/abbrev/vocab/
 *     summary/keywords/columns. An INVENTED tag is in neither list, so today it survives into
 *     the exported HTML as literal markup; item 1 is a strict improvement here.
 *   - <header>/<page-num> on the translation side (11.1% of translation docs) feed nothing:
 *     locus anchors (scripts/locus/extract-locus-anchors.mjs), front-matter
 *     (src/lib/front-matter.ts) and drift detection (scripts/check-ocr-drift.mjs) all read
 *     ocr.data. Verified by `git grep '<page-num>'` — 20 hits, none on translation.data.
 *
 * Built from the CURRENT default translation prompt (v13 as of 2026-09-12 — v13 is the
 * `<unclear>`-is-absence rule, NOT the "v13" #3825 planned; that issue's number was taken
 * by #4584's interim row). v14 (#4584 `<lacuna>`) is a separate, still non-default
 * candidate; if it is promoted first, re-run this with --from 14 and --version 16.
 *
 * ORDERING: the new row lands with is_default:false and STAYS there. Flipping the default is
 * Derek's call, after the #3825 process — the paired A/B in scripts/eval/translation-prompt-ab.mjs
 * under scripts/eval/PREREGISTRATION-translation-prompt-v15.md, whose primary outcome is the
 * verified-note rate measured by the same verifier build-page-terms.mjs uses.
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

// ── #3825 item 2 — verbatim original-notes (MERGED AND REVIEWED; do not reword) ────────────
const RULE_VERBATIM = `**<note>original: "…"</note> must be VERBATIM (CRITICAL):**
- The quoted phrase inside <note>original: "…"</note> is a citation of the source. Copy it character-for-character from the OCR input on THIS page: same spelling, same script, same diacritics, same abbreviations, same word order. Do not normalise, modernise, expand, translate or "correct" it.
- If you cannot copy the phrase exactly as it stands in the OCR — because you are reconstructing it from memory, from your translation, from the standard form of the phrase, or from a parallel text — OMIT the note. A missing note is harmless; an invented one is a fabricated quotation that scholars will cite.
- Never quote text that is not on this page: not a heading from another page, not the title the work is known by, not the phrase as it appears in a printed edition you remember.
- A transliteration in parentheses after the quote is fine — <note>original: "ἡσυχίαν" (hesychian)</note> — the quoted part is still verbatim.
- Keep the note short: the phrase itself, a few words. Whole sentences are for <term>/<gloss> and the translation, not for original-notes.

`;

// ── #3825 item 1 — the tag vocabulary is CLOSED ────────────────────────────────────────────
const RULE_CLOSED_VOCAB = `**The tag vocabulary is CLOSED (CRITICAL):**
- Use ONLY the tags defined in this prompt, and never invent one: <meta>, <note>, <term>, <gloss>, <margin>, <insert>, <unclear>, <column-break/>, <warning>, <summary>, <keywords>. Nothing else is a tag.
- Never emit HTML: no <p>, <br>, <i>, <b>, <em>, <span>, <div>, <center>, <table>, <ul>, <li>. Structure is markdown, exactly as the OCR carries it: # ## ### headings, **bold**, *italic*, markdown tables, ->centered text<-.
- Never invent a tag for a language, a genre or a quotation: no <greek>, <hebrew>, <latin>, <arabic>, <foreign>, <quote>, <verse>, <poem>, <title>, <chapter>. A phrase kept in the original goes in <term>…</term> <gloss>…</gloss>; a quoted original goes in <note>original: "…"</note>; a chapter title is a markdown heading.
- If no defined tag fits what you want to mark, write plain translated prose and say it in words. That is always the right fallback.
- The reader and the downloads know only the tags listed above. An invented tag is not a hidden annotation: it reaches readers as literal angle brackets in the text, or takes its contents with it when a strip pass removes it.

`;

// ── #3825 item 4 — OCR housekeeping tags are input, never output ────────────────────────────
const RULE_HOUSEKEEPING = `**OCR housekeeping tags are INPUT, never output (CRITICAL):**
- The OCR input may carry <vocab>, <language> (or <lang>), <page-type>, <page-num>, <sig>, <scan-quality>, <script> and <columns>. These describe the scan for the pipeline. They are not part of the text and they are not yours to translate. Never copy one into your output, translated or untranslated.
- A <vocab> list in the OCR is a reading aid for you, not content for the reader. Use it to translate the page accurately, then drop it: the reader meets those terms through inline <term>/<gloss> and the closing <keywords>.
- Running headers, printed page numbers and signature marks belong to the transcription, which the reader already has beside your translation. Do not re-emit them as <header>, <page-num> or <sig>, and do not repeat them as body text or headings.
- <image-desc> is input too: translate what it describes and wrap the result in <note>…</note>, as described below. Never emit an <image-desc> tag yourself.

`;

// ── #3825 item 3 — no standalone glossary lines ─────────────────────────────────────────────
const RULE_NO_GLOSSARY = `
- A standalone glossary, vocabulary list or term list anywhere in the output — "Vocabulary:", "Vocabulary used in this passage:", "Key terms:", or a trailing run of <term>/<gloss> pairs detached from the text. Annotate each term INLINE, at the point in the translation where it actually occurs, so the reader meets the definition where the word is. <keywords> at the very end is the only list this prompt permits.`;

// ── #3825 item 5 — mechanical cleanup ──────────────────────────────────────────────────────
const NUMBERING_OLD = `8. Style: warm museum label - explain rather than assume knowledge.
9. Preserve the voice and spirit of the original.
8. Wrap ALL image/illustration descriptions in <note>...</note> — readers can toggle these off.
9. END with <summary>...</summary> and <keywords>...</keywords> for indexing.`;
const NUMBERING_NEW = `8. Style: warm museum label - explain rather than assume knowledge.
9. Preserve the voice and spirit of the original.
10. Wrap ALL image/illustration descriptions in <note>...</note> — readers can toggle these off.
11. END with <summary>...</summary> and <keywords>...</keywords> for indexing.`;

const STYLE_HEADING_OLD = '**Writing style for summaries and notes:**';
const STYLE_HEADING_NEW = '**Writing style — applies to EVERY word you author:**\n- Not only <summary> and <note>: the translation itself, and <gloss>, <margin>, <meta> and <warning> too. Wherever you are choosing the English, these rules hold.';

const EMDASH_OLD = '- Never use em-dashes (—). Use commas, colons, semicolons, or separate sentences.';
const EMDASH_NEW = '- Never use em-dashes (—) in prose you compose. Use commas, colons, semicolons, or separate sentences. Punctuation you are reproducing from the source is not yours to change.';

const NOTES = `v{from} + the whole of #3825, seeded non-default. (1) closed tag vocabulary — the 2026-08-09 census found 60-83 invented tag tokens per side; (2) verbatim original-notes — the phrase inside <note>original: "…"</note> is a character-for-character copy of the OCR input or the note is omitted (12.2% fabricated, #3308; 91% verified, #4695); (3) no standalone glossary lines, <keywords> is the only end-of-page list; (4) OCR housekeeping tags (vocab/lang/page-type/page-num/sig/scan-quality) are input, never output; (5) duplicate 8/9 numbering fixed, style rules scoped to all translator-authored prose. Consumer surfaces checked in the seeding script's header (NotesRenderer, build-book-index, learn route, download routes). Flip only after scripts/eval/translation-prompt-ab.mjs under PREREGISTRATION-translation-prompt-v15.md. Rollback: nothing to roll back while non-default.`;

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

  const META_ANCHOR = '\n**Metadata tags (hidden from readers):**';
  const DONT_ANCHOR = '\n**Do NOT use:**';
  const IMG_ANCHOR = '\n**Image descriptions from OCR:**';
  const BACKTICKS = '- Code blocks or backticks — this is prose';

  let content = base.content;
  // item 1 — before the metadata-tag list, where the vocabulary is being enumerated
  content = once(content, META_ANCHOR, '\n' + RULE_CLOSED_VOCAB + META_ANCHOR.slice(1), '#3825/1 closed vocabulary');
  // item 4 — before the "Do NOT use" list, which is where output prohibitions live
  content = once(content, DONT_ANCHOR, '\n' + RULE_HOUSEKEEPING + DONT_ANCHOR.slice(1), '#3825/4 housekeeping tags');
  // item 3 — one more bullet on that same "Do NOT use" list
  content = once(content, BACKTICKS, BACKTICKS + RULE_NO_GLOSSARY, '#3825/3 no glossary lines');
  // item 2 — before the image-description section (MERGED; anchor unchanged)
  content = once(content, IMG_ANCHOR, '\n' + RULE_VERBATIM + IMG_ANCHOR.slice(1), '#3825/2 verbatim rule');
  // item 5 — mechanical
  content = once(content, NUMBERING_OLD, NUMBERING_NEW, '#3825/5 duplicate 8/9 numbering');
  content = once(content, STYLE_HEADING_OLD, STYLE_HEADING_NEW, '#3825/5 style scope heading');
  content = once(content, EMDASH_OLD, EMDASH_NEW, '#3825/5 em-dash scope');

  if (!/original: "\.\.\."|original: "…"/.test(base.content)) console.warn('note: the base prompt does not mention original-notes where expected; read the diff carefully');

  console.log(`\n=== translation: v${from} (${base.content.length} chars, ${hash(base.content).slice(0, 8)}) -> v${VERSION} (${content.length} chars, ${hash(content).slice(0, 8)}) ===`);
  for (const [label, block] of [['#3825/1 closed vocabulary', RULE_CLOSED_VOCAB], ['#3825/4 housekeeping', RULE_HOUSEKEEPING], ['#3825/3 no glossary', RULE_NO_GLOSSARY], ['#3825/2 verbatim', RULE_VERBATIM]]) {
    console.log(`--- inserted: ${label} ---\n${block.trim()}\n`);
  }
  console.log(`--- rewritten: #3825/5 ---\n${NUMBERING_NEW}\n${STYLE_HEADING_NEW}\n${EMDASH_NEW}\n--- end ---`);

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
