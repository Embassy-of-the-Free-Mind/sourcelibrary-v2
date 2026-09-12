#!/usr/bin/env node
/**
 * OCR prompt v17 + translation prompt v14 — #4195 (all six items) and #4584.
 *
 * Builds v17 from **v15**, not from v16. v16 was an interim written before
 * #4195 was found; it added an untranscribable-region rule that overloaded
 * `<unclear>`, which #4195 item 5 explicitly rules out (`<unclear>` implies a
 * guessable reading, and it unwraps to body text in every export, so a gap
 * DESCRIPTION carried in one gets quoted as if it were the page's words).
 * v17 supersedes it with the named `<lacuna>` marker instead.
 *
 * Each edit below names the issue it closes. Every anchor is asserted to occur
 * exactly once before substitution — a prompt this load-bearing must never be
 * patched by a regex that silently matched nothing or matched twice.
 *
 * ORDERING (matters): the new rows land with is_default:false.
 *
 * DO NOT PROMOTE v17 YET — and --promote now refuses without an explicit
 * override, because a docstring saying "not yet" is not a control.
 * Two conditions, only the first of which is met by merging this:
 *   1. the `<lacuna>` renderer + stripper have shipped (this PR), and
 *   2. v17 has been shown NOT to over-decline.
 * Condition 2 FAILED on 2026-09-02: at k=5, v17 turned p.197's perfectly
 * legible Latin note ("Nihil hic deesse videtur") into a <lacuna>, and the
 * headline fabrication win did not replicate — a second run put the runaway
 * loop on the opposite arm (scripts/eval/EXPERIMENTS.md, PR #4610, issue #4195).
 * Re-run scripts/eval/prompt-ab.mjs with a loop classifier before promoting.
 *
 *   node scripts/maintenance/ocr-prompt-v17-lacuna.mjs --promote --ab-rerun-clean
 * Rollback: --demote, which restores v16/v13 as default.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/ocr-prompt-v17-lacuna.mjs [--apply|--promote|--demote]
 */
import { MongoClient } from 'mongodb';
import { createHash } from 'crypto';

const APPLY = process.argv.includes('--apply');
const PROMOTE = process.argv.includes('--promote');
const DEMOTE = process.argv.includes('--demote');
const hash = (s) => createHash('md5').update(s).digest('hex');

/** Replace exactly once, or throw. A prompt edit that misses is worse than one that fails. */
function once(text, find, replace, label) {
  const n = text.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] anchor matched ${n}x, expected 1:\n  ${find.slice(0, 110)}`);
  return text.replace(find, replace);
}

// ─── #4195 item 1: the page-type enum belongs to <page-type>, not <columns> ───
const OLD_PAGETYPE_COLUMNS = `- <page-type>X</page-type>
- <columns>N</columns> — number of text columns on this page (omit for single-column pages, include for 2+ columns) — classify this page (REQUIRED). One of: title-page, frontispiece, dedication, preface, toc, index, errata, colophon, appendix, blank, illustration, diagram, map, text`;

// #4195 items 1+2: enum restored to its own tag, and `blank` narrowed. Under-use
// fabricates (#4149: invented pages for empty leaves); over-use suppresses
// (#3591: legible basmala pages classified blank and replaced with a stub).
const NEW_PAGETYPE_COLUMNS = `- <page-type>X</page-type> — classify this page (REQUIRED). One of: title-page, frontispiece, dedication, preface, toc, index, errata, colophon, appendix, blank, illustration, diagram, map, text
  - \`blank\` means NO INK AT ALL — an empty leaf, a verso that was never printed. A page that is faint, stained, damaged, bleed-through, or only partly legible is NOT blank: give it its real type and use <lacuna> / <unclear> / <warning> for the parts you cannot read. Both mistakes are costly, in opposite directions.
- <columns>N</columns> — number of text columns on this page (omit for single-column pages, include for 2+ columns)`;

// ─── #4195 item 3: what a blank page may emit ───
const BLANK_CONTRACT = `
**Blank pages (CRITICAL):**
- A blank page emits the metadata tags and NOTHING ELSE: no body text, and no <header>, <sig> or <page-num>. Those tags are exactly what past fabrications invented to make an empty leaf look like a printed one.
- "The page cannot be transcribed" (illegible) and "there is nothing on the page" (blank) are different findings. Do not reach for a blank classification because a page is hard to read.
- SELF-CHECK: if anywhere in your output you describe a mark, letter, stamp, stain of ink, printer's ornament, annotation or "faint/erased/offset trace", then the page is NOT blank. Give it its real <page-type> and transcribe or mark what you saw. A page you describe as having something on it cannot also be classified as having nothing on it.
- Any remark ABOUT a blank page ("the page is empty apart from a printer's mark") goes inside <meta> or <warning>. Never write it as untagged prose — untagged text is treated as the words printed on the page.
`;

// ─── #4195 item 5 + #4584: a named marker for an unreadable REGION ───
const LACUNA_RULE = `**Untranscribable regions — <lacuna> (CRITICAL):**
Some pages carry a region with no legible source for you: a script or notation you cannot reliably read (hieroglyphs, cuneiform, an unfamiliar shorthand), or a block torn, burned or faded past reading — on a page that is otherwise perfectly readable. For any such region:
1. Do NOT transcribe it, do NOT approximate it, and do NOT reconstruct what it probably said. A fluent guess is indistinguishable from a reading and cannot be caught downstream.
2. Do NOT describe it in square brackets or in bare prose. An untagged description like "[Hieroglyphic text lines x+1 through 20]" is read downstream as page text and gets rendered into invented content — this is a real incident, not a hypothetical.
3. Emit ONE <lacuna> tag saying what is there and roughly how much: <lacuna>20 lines of hieroglyphic text, not transcribed</lacuna>
4. <lacuna> is NOT <unclear>. <unclear>X</unclear> carries your best-guess READING of X and is kept as page text. <lacuna> says there is no reading at all, and its contents are a description that is stripped from every quotation and export. Never put a guess in a <lacuna>, and never put a gap description in an <unclear>.
5. NEVER fill an unread region by repeating a character, glyph or word. A long run of one repeated sign is always an artifact, never a reading.
6. A page that is mostly untranscribable is mostly <lacuna> tags. That is CORRECT output, not a failure. Transcribe the surrounding apparatus normally — headings, editorial notes, bibliographic citations and page numbers are usually in a script you CAN read, and on such a page they are the most valuable thing present.
7. In a table or a closed set (a grid of named mansions, a list of months), a cell you cannot read is its own <lacuna>. Do NOT complete the set from knowledge of what such a set usually contains.

`;

// ─── #4195 item 6: unusable image ───
const UNUSABLE_IMAGE = `
**Unusable images:**
- If the image is a solid black/white field, a scanner error, or a repository placeholder ("image not available"), emit the metadata tags plus a <warning> naming what you received. NEVER infer content for a page you cannot see. An unreadable image is not a page to be reconstructed.
`;

const plan = [
  {
    type: 'ocr',
    from: 15,
    notes: 'v15 + #4195 (all six items) + #4584 lacuna marker. Supersedes the interim v16, which overloaded <unclear>. Requires the <lacuna> stripper+renderer (PR). Rollback: set is_default:true on v16, false here.',
    build(v15) {
      let s = v15;
      s = once(s, OLD_PAGETYPE_COLUMNS, NEW_PAGETYPE_COLUMNS, '#4195-1+2 page-type/columns');
      // #4195 item 4: "DISCURSUS IV." is the running header of every confirmed
      // fabrication across eleven unrelated books — the model fills the template
      // with the template's own example. Same for the signature and drop-cap.
      s = once(s,
        'Example: "DISCURSUS IV." at top of page → <header>DISCURSUS IV.</header> and nothing else',
        'Example: a running header at the top of a page → <header>[the exact words printed there]</header> and nothing else. Transcribe what is on THIS page; never carry over an example, a header from a previous page, or a plausible Latin heading.',
        '#4195-4 DISCURSUS specimen');
      s = once(s,
        `- <sig>X</sig> — printer's marks like A2, B1 (NOT in body text)`,
        `- <sig>X</sig> — printer's signature marks, transcribed exactly as printed on THIS page (NOT in body text)`,
        '#4195-4 sig specimen');
      s = once(s,
        `3. Decorative initials (drop caps): merge large ornamental first letters with the word they begin. A large "L" followed by "EX" → "Lex", not "L Ex"`,
        `3. Decorative initials (drop caps): merge large ornamental first letters with the word they begin — a large initial followed by the rest of the word is one word, not two. Read the actual letter on the page; do not assume a particular initial or opening word.`,
        '#4195-4 dropcap specimen');
      // Items 3, 5, 6 go in before the lacuna/repetition section so all the
      // "what to do when you cannot read it" rules sit together.
      s = once(s, '**Lacunae & runaway repetition (CRITICAL):**',
        LACUNA_RULE + '**Lacunae & runaway repetition (CRITICAL):**', '#4584 lacuna rule');
      s = once(s, '**Critical rules:**', BLANK_CONTRACT + UNUSABLE_IMAGE + '\n**Critical rules:**', '#4195-3+6 blank/unusable');
      return s;
    },
  },
  {
    type: 'translation',
    from: 12,
    notes: 'v12 + <lacuna> is absence: reproduce it, never translate or expand it (#4584). Supersedes interim v13. Rollback: set is_default:true on v13, false here.',
    build(v12) {
      const RULE = `**<lacuna> marks text that was NOT read (CRITICAL):**
- <lacuna>…</lacuna> in the OCR means there was no legible source for that region — its contents describe the gap, they are not words from the page.
- Reproduce the tag and its contents unchanged. NEVER translate, expand, paraphrase or reconstruct it, and never supply plausible content for it: no invented lines, verses, formulae, titles or epithets.
- If the OCR reads <lacuna>20 lines of hieroglyphic text, not transcribed</lacuna>, your output carries that same tag for that region and nothing else. Do NOT emit twenty translated lines.
- Every line you write must correspond to text actually present in the OCR input. Where the input has no readable text, your output has none either.
- If the OCR describes unread material in square brackets instead of a tag, convert it to <lacuna>…</lacuna>. Do NOT render it as content — a note about what could not be read is not a passage to be translated.
- A page whose OCR is mostly <lacuna> yields a translation that is mostly <lacuna>. That is correct, and far better than fluent invention.
- <unclear> is different: it holds a best-guess READING and must be preserved and translated as page text.

`;
      return once(v12, '**Metadata tags (hidden from readers):**', RULE + '**Metadata tags (hidden from readers):**', '#4584 translation lacuna rule');
    },
  },
];

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const col = c.db('bookstore').collection('prompts');

if (PROMOTE && !process.argv.includes('--ab-rerun-clean')) {
  console.error([
    'REFUSING to promote v17.',
    '',
    'v17 was measured OVER-DECLINING on 2026-09-02: it converts readable text',
    'into gap markers (Kitab al-Bulhan p.197, legible Latin -> <lacuna>), and the',
    'fabrication win it was promoted for did not replicate across two k=5 runs.',
    'See scripts/eval/EXPERIMENTS.md and PR #4610.',
    '',
    'Re-run scripts/eval/prompt-ab.mjs with a loop classifier first. If it comes',
    'back clean, pass --ab-rerun-clean to say so.',
  ].join('\n'));
  process.exit(1);
}

if (PROMOTE || DEMOTE) {
  // The unique index uniq_default_per_type permits one default per type, so the
  // old default is demoted before the new one is promoted. Between those writes
  // getPrompt() falls back to the hardcoded constant — the OLD behaviour, never
  // a broken one.
  for (const p of plan) {
    const target = PROMOTE ? p.from + 2 : p.from + 1;  // v17/v14 on promote, v16/v13 on rollback
    const row = await col.findOne({ type: p.type, version: target });
    if (!row) throw new Error(`${p.type} v${target} not found`);
    await col.updateMany({ type: p.type, is_default: true, _id: { $ne: row._id } }, { $set: { is_default: false } });
    await col.updateOne({ _id: row._id }, { $set: { is_default: true } });
    const now = await col.findOne({ type: p.type, is_default: true });
    console.log(`${p.type}: default is now v${now.version}`);
  }
  await c.close();
  process.exit(0);
}

for (const p of plan) {
  const base = await col.findOne({ type: p.type, version: p.from });
  if (!base) throw new Error(`${p.type} v${p.from} not found`);
  const version = p.from + 2;                       // v15 -> v17, v12 -> v14
  const existing = await col.findOne({ type: p.type, version });
  if (existing && !process.argv.includes('--replace')) {
    console.log(`${p.type} v${version} already exists (${existing._id}) — skipping (pass --replace to rewrite it)`);
    continue;
  }
  if (existing && existing.is_default) throw new Error(`refusing to --replace a LIVE default (${p.type} v${version}); demote it first`);
  const content = p.build(base.content);
  console.log(`\n=== ${p.type}: v${p.from} -> v${version}  (${base.content.length} -> ${content.length} chars) ===`);
  if (!APPLY) { console.log('(dry run — pass --apply)'); continue; }
  const doc = {
    name: base.name, type: p.type, version, is_default: false,
    content, content_hash: hash(content),
    created_at: new Date().toISOString(), notes: p.notes,
  };
  if (existing) {
    await col.replaceOne({ _id: existing._id }, doc);
    console.log(`replaced ${existing._id} (is_default:false — promote after the renderer ships)`);
  } else {
    const { insertedId } = await col.insertOne(doc);
    console.log(`inserted ${insertedId} (is_default:false — promote after the renderer ships)`);
  }
}
await c.close();
