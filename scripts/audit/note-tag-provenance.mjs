#!/usr/bin/env node
/**
 * Audit: `<note>` content that describes the PAGE rather than glossing its TEXT.
 *
 * THE INVARIANT
 *   Editorial prose about a page — what the scan shows, how damaged it is, what
 *   is visible through the paper — must never be servable as the page's own
 *   words. That is the #2232 misquote class: quoting it fabricates a citation to
 *   text that is not on the leaf.
 *
 * WHY THIS TAG IS DIFFERENT
 *   `stripEditorialWrappers()` removes the page-description wrapper family
 *   (<meta>, <summary>, <image-desc>, <warning>, …) content and all. `<note>` is
 *   deliberately NOT in that set: CLAUDE.md classes it with the inline glosses
 *   that "sit on / are real body text", so its content is kept, rendered by
 *   NotesRenderer, and flows into every quote/search/snippet surface.
 *
 *   That is right for a real gloss ("abbreviated 'quod' in text", "Space left
 *   for ornamental initial 'H'"). It is wrong when the model has put a page
 *   DESCRIPTION inside a <note> — "This page is blank and contains no text or
 *   illustrations", "The page contains mirrored ghost text from the title page
 *   on the reverse". Same content the wrapper family exists to suppress, in a
 *   tag that preserves it.
 *
 * THE DETECTOR, AND WHY IT IS THIS ONE
 *   Definitional, not statistical: a gloss annotates text, so a <note> on a page
 *   with NO body text cannot be a gloss — whatever it says, it is describing the
 *   scan. No wording heuristic is involved, so it cannot misfire on an unusual
 *   gloss.
 *
 *   Two frequency-based detectors were measured first and both were rejected:
 *     - "note begins This/The page|image|…"  — 54% of notes on blank pages, but
 *       also 7.7% on text pages, where they are genuine glosses.
 *     - "note appears on a blank-typed page" — same problem; real glosses
 *       ("Struck through in original") live there too.
 *   Both would damage legitimate annotation. This one is conservative by
 *   construction: it UNDER-reports (a description on a text-bearing page is
 *   missed) and never flags a note that could be glossing something.
 *
 *   So treat the output as a FLOOR on the class, never as its size.
 *
 * USAGE
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/note-tag-provenance.mjs                # sampled (fast)
 *   node scripts/audit/note-tag-provenance.mjs --limit 20000  # bigger sample
 *   node scripts/audit/note-tag-provenance.mjs --book <id>    # one book
 *   node scripts/audit/note-tag-provenance.mjs --json out.json
 *
 * READ-ONLY — it never writes. Exits 0 always; this reports a measurement, not
 * a pass/fail gate, because the remedy is a write-time prompt contract (#3591)
 * rather than something a sweep can repair.
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

const args = process.argv.slice(2);
const argVal = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const LIMIT = Number(argVal('--limit') || 5000);
const BOOK = argVal('--book');
const JSON_OUT = argVal('--json');

/** Page-description wrappers — content dropped entirely by stripEditorialWrappers. */
const WRAPPERS =
  /<(language|lang|page-type|scan-quality|script|columns|warning|meta|summary|keywords|vocab|image-desc)(\s[^>]*)?>[\s\S]*?<\/\1>/gi;
/** Annotation + page-mark tags — real, but not the page's running text. */
const ANNOTATIONS =
  /<(note|margin|insert|unclear|term|gloss|header|catchword|sig|page-num|abbrev)(\s[^>]*)?>[\s\S]*?<\/\1>/gi;
const NOTE = /<note(?:\s[^>]*)?>([\s\S]*?)<\/note>/gi;
const ZERO_WIDTH = /[​-‏⁠﻿]/g;

/** The page's own words: everything outside wrappers and annotations. */
function bodyText(raw) {
  return raw
    .replace(WRAPPERS, ' ')
    .replace(ANNOTATIONS, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(ZERO_WIDTH, '')
    .replace(/[-#*>|\s]+/g, ' ')
    .trim();
}

/** Body text shorter than this is treated as "no text to gloss". */
const BODY_MIN_CHARS = 15;

function notesOf(raw) {
  return [...raw.matchAll(NOTE)]
    .map((m) => m[1].replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set. Source .env.production.local first.');
    process.exit(2);
  }
  const client = new MongoClient(uri);
  await client.connect();
  const pages = client.db('bookstore').collection('pages');

  const query = { 'ocr.data': /<note/ };
  if (BOOK) query.book_id = BOOK;

  const docs = await pages
    .find(query, {
      projection: { page_number: 1, book_id: 1, page_type: 1, 'ocr.data': 1 },
      limit: BOOK ? 0 : LIMIT,
    })
    .toArray();
  await client.close();

  const byPageType = {};
  const findings = [];
  let pagesWithNotes = 0;
  let notesTotal = 0;
  let notesUngloassable = 0;

  for (const p of docs) {
    const raw = p.ocr?.data || '';
    const notes = notesOf(raw);
    if (!notes.length) continue;
    pagesWithNotes++;
    notesTotal += notes.length;

    if (bodyText(raw).length >= BODY_MIN_CHARS) continue;

    notesUngloassable += notes.length;
    const type = p.page_type || '(untyped)';
    byPageType[type] = (byPageType[type] || 0) + 1;
    findings.push({
      book_id: p.book_id,
      page_number: p.page_number,
      page_type: type,
      notes: notes.map((n) => (n.length > 160 ? `${n.slice(0, 160)}…` : n)),
    });
  }

  const pct = pagesWithNotes ? ((findings.length / pagesWithNotes) * 100).toFixed(1) : '0.0';
  console.log('\nnote-tag provenance audit');
  console.log('─'.repeat(60));
  console.log(`scanned pages carrying <note>   ${pagesWithNotes}${BOOK ? '' : ` (sample cap ${LIMIT})`}`);
  console.log(`<note> tags seen                ${notesTotal}`);
  console.log(`pages whose notes CANNOT gloss  ${findings.length}  (${pct}%)`);
  console.log(`  …notes on those pages         ${notesUngloassable}`);
  console.log('\nby page_type:');
  for (const [t, n] of Object.entries(byPageType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(20)} ${n}`);
  }
  console.log('\nexamples:');
  for (const f of findings.slice(0, 10)) {
    console.log(`  [${f.page_type}] ${f.book_id}/p${f.page_number}`);
    console.log(`      ${f.notes[0]}`);
  }
  console.log(
    '\nThis is a FLOOR, not the size of the class: a page description sitting on a\n'
    + 'page that also has real text is invisible to this detector by design.\n'
    + 'Remedy is the write-time output contract (#3591), not a read-time sweep.\n',
  );

  if (JSON_OUT) {
    fs.writeFileSync(
      JSON_OUT,
      JSON.stringify(
        { generated_at: new Date().toISOString(), scanned: pagesWithNotes, notesTotal, findings },
        null,
        2,
      ),
    );
    console.log(`wrote ${JSON_OUT}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
