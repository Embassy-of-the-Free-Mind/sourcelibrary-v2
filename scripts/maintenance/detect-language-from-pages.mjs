#!/usr/bin/env node
/**
 * PRIOR ART — read this before extending, there is more of it than you expect:
 *   - scripts/audit/detect-book-languages.mjs (#4117) already aggregates the per-page `<language>`
 *     tag per book, over ALL tagged pages, with its own bilingual threshold (--threshold, default
 *     0.10). It is the better instrument whenever the OCR already exists, and it NEVER writes — it
 *     is explicitly "the instrument for tuning the 'is it really bilingual' threshold before anyone
 *     writes anything".
 *   - scripts/audit/language-review-triage.mjs (#3958) triages the `language_review` queue and also
 *     never writes, because "clearing a flag on a published book is a public metadata decision".
 *     That queue holds ~1,519 live books and nothing drains it; its default query is visible:true,
 *     so a flag set on a hidden book is only reachable with its --all.
 *   - scripts/audit/ft-english-badged-classify.mjs is where the sampling/tag/census primitives come
 *     from (now shared via scripts/lib/page-language.mjs); it answers only English-vs-not.
 *
 * WHAT THIS ADDS, and why it may write where those may not. It covers the case they cannot: a book
 * with NO OCR at all, where there is no tag to aggregate yet — so it commissions a spread sample
 * first (OCR is not reimplemented; the sample goes to scripts/batch/realtime-ocr.mjs
 * --page-ids-file). And it writes only where the decision is not a public one: by default it refuses
 * to change `language` on a `visible` book, because that is the call those two scripts deliberately
 * leave to a human. Pass --allow-visible to override, and expect to justify it.
 *
 * WHY. `books.language` picks the OCR model — getModelForBook() (src/lib/types/ai-models.ts) routes
 * Latin-script to flash-lite and non-Latin/unknown to full flash — so a mis-catalogued language buys
 * the wrong model for the whole book. Catalogued language is wrong often enough to matter: of the 42
 * books in the 2026-09-09 acquisition wave where IA published its own ocr_detected_lang, 5 disagreed
 * with what we had stored and the OCR was right every time.
 *
 * TWO PHASES, so the paid step is a deliberate separate command:
 *
 *   --plan    choose books, pick a spread sample of content pages, write the page-id list and print
 *             the cost. Reads only. Then OCR that list (this is the paid step):
 *               node scripts/batch/realtime-ocr.mjs --page-ids-file=<file> --reason="language detection"
 *             The OCR is KEPT, so nothing is spent twice — those pages were going to be OCR'd anyway.
 *   --apply   read the OCR that now exists, detect, and write `language` + typed provenance.
 *             A 'clear' verdict writes. A 'review' verdict NEVER overwrites a stored value; it records
 *             the claim and sets `language_review` for a human, matching src/lib/resolve-language.ts.
 *
 * Scope (one required): --ia-ids-file=F (JSON array of ia_identifier) | --book-ids=a,b,c | --weak-provenance
 *   --weak-provenance  = language absent, or provenance that never saw page text.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/detect-language-from-pages.mjs --plan --ia-ids-file=/tmp/ids.json
 *   node scripts/maintenance/detect-language-from-pages.mjs --apply --ia-ids-file=/tmp/ids.json [--commit]
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import { detectLanguageFromPages, spreadSample, bodyText, MIN_CONTENT_CHARS } from '../lib/page-language.mjs';
import { normalizeLanguageToken } from '../lib/language-normalize.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const a = argv.find((x) => x.startsWith(`${f}=`)); return a ? a.slice(f.length + 1) : null; };
const PLAN = has('--plan'), APPLY = has('--apply'), COMMIT = has('--commit');
/** Changing `language` on a published book is a public metadata decision — see the header. */
const ALLOW_VISIBLE = has('--allow-visible');
const SAMPLE = parseInt(val('--sample') || '25', 10);
const OUT = val('--out') || '/tmp/language-sample-page-ids.json';
/** Measured batch OCR rate; a rate never travels without its vintage. */
const OCR_RATE = 0.00222, RATE_ON = '2026-09-04';
/** Provenance labels that never looked at a page. */
const WEAK = new Set(['caller', 'ia_metadata', 'iiif_manifest', 'import', 'curator', 'none', '']);

if (PLAN === APPLY) { console.error('Pass exactly one of --plan or --apply.'); process.exit(1); }

async function targets(db) {
  const iaFile = val('--ia-ids-file'), bookIds = val('--book-ids');
  const proj = { id: 1, title: 1, author: 1, language: 1, pages_count: 1, ia_identifier: 1, field_provenance: 1, visible: 1, _id: 0 };
  if (iaFile) {
    const ids = JSON.parse(fs.readFileSync(iaFile, 'utf8'));
    return db.collection('books').find({ ia_identifier: { $in: ids } }, { projection: proj }).toArray();
  }
  if (bookIds) return db.collection('books').find({ id: { $in: bookIds.split(',') } }, { projection: proj }).toArray();
  if (has('--weak-provenance')) {
    return db.collection('books').find(
      { $or: [{ language: { $in: [null, '', 'Unknown'] } }, { 'field_provenance.language': { $exists: false } }] },
      { projection: proj },
    ).limit(parseInt(val('--limit') || '200', 10)).toArray();
  }
  console.error('Scope required: --ia-ids-file=F | --book-ids=a,b | --weak-provenance');
  process.exit(1);
}

/** Provenance can be a bare string (direct importers) or a typed entry (the routes). Read both. */
const provLabel = (fp) => {
  const p = fp?.language;
  if (!p) return 'none';
  return typeof p === 'string' ? p : (p.chosen_from || p.source || 'none');
};

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');
const books = await targets(db);
console.log(`${books.length} book(s) in scope\n`);

if (PLAN) {
  const pageIds = [];
  const rows = [];
  for (const b of books) {
    const label = provLabel(b.field_provenance);
    if (!WEAK.has(label) && b.language) { rows.push({ ...b, skip: `provenance "${label}" already empirical` }); continue; }
    // Sample over page NUMBERS; whether a page is "content" is unknowable before OCR exists, so
    // spread across the whole book and let --apply drop the ones that came back empty.
    const pages = await db.collection('pages')
      .find({ book_id: b.id }, { projection: { id: 1, page_number: 1, ocr: 1, _id: 0 } })
      .sort({ page_number: 1 }).toArray();
    const withOcr = pages.filter((p) => bodyText(p.ocr).trim().length >= MIN_CONTENT_CHARS);
    if (withOcr.length >= SAMPLE) { rows.push({ ...b, skip: `${withOcr.length} pages already have OCR — run --apply, no spend needed` }); continue; }
    const picked = spreadSample(pages.filter((p) => bodyText(p.ocr).trim().length < MIN_CONTENT_CHARS), SAMPLE);
    for (const p of picked) pageIds.push(p.id);
    rows.push({ ...b, need: picked.length, label });
  }
  const needing = rows.filter((r) => r.need);
  for (const r of rows.slice(0, 40)) {
    console.log(r.skip
      ? `  -  ${String(r.ia_identifier || r.id).padEnd(32)} ${r.skip}`
      : `  >  ${String(r.ia_identifier || r.id).padEnd(32)} ${String(r.need).padStart(2)} pages to OCR  (language=${r.language || 'none'}, provenance=${r.label})`);
  }
  if (rows.length > 40) console.log(`  ... ${rows.length - 40} more`);
  fs.writeFileSync(OUT, JSON.stringify(pageIds, null, 1));
  console.log(`\n${needing.length} book(s) need a sample · ${pageIds.length} pages -> ${OUT}`);
  console.log(`estimated OCR cost: $${(pageIds.length * OCR_RATE).toFixed(2)} at $${OCR_RATE}/page (measured ${RATE_ON})`);
  console.log(`\nnext (this is the paid step):\n  node scripts/batch/realtime-ocr.mjs --page-ids-file=${OUT} --reason="language detection sample"`);
}

if (APPLY) {
  let wrote = 0, flagged = 0, unchanged = 0, thin = 0;
  for (const b of books) {
    const pages = await db.collection('pages').find({ book_id: b.id }, { projection: { ocr: 1, page_number: 1, _id: 0 } }).toArray();
    const d = detectLanguageFromPages(pages, { sample: SAMPLE }, b.language);
    const stored = b.language ? normalizeLanguageToken(b.language) : null;
    const tag = `${String(b.ia_identifier || b.id).padEnd(32)}`;
    if (!d.language) { console.log(`  ?   ${tag} ${d.why}`); thin++; continue; }
    // A 'review' verdict must take the flag path even when the detected value happens to equal the
    // stored one: "this is a parallel-text edition" is the finding, and agreement does not answer it.
    const agrees = stored && stored === d.language && d.confidence !== 'review';
    if (agrees) {
      console.log(`  ${d.confidence === 'refinement' ? '≈' : '='}   ${tag} ${d.language} confirmed (${d.why})`);
      unchanged++;
      if (COMMIT) {
        await db.collection('books').updateOne({ id: b.id }, { $set: {
          'field_provenance.language': {
            source: 'page_ocr', value: d.language, chosen_from: 'page_ocr_detected',
            claims: [{ source: provLabel(b.field_provenance), value: stored }, { source: 'page_ocr_detected', value: d.modal || d.language }],
            sampled: d.sampled, why: d.why,
            ...(d.confidence === 'refinement' ? { refinement: d.modal } : {}),
            date: new Date().toISOString(),
          },
          updated_at: new Date(),
        } });
      }
      continue;
    }
    const claims = [
      ...(stored ? [{ source: provLabel(b.field_provenance), value: stored }] : []),
      { source: 'page_ocr_detected', value: d.language },
    ];
    const prov = {
      source: 'page_ocr', value: d.language, chosen_from: 'page_ocr_detected', claims,
      sampled: d.sampled, why: d.why, ...(stored ? { conflict: true } : {}), date: new Date().toISOString(),
    };
    // A 'review' verdict must never silently replace a catalogued value — record and flag.
    // `language_review_detail` is written in the shape scripts/audit/language-review-triage.mjs
    // reads, so these land in the EXISTING queue rather than beside it.
    const detail = { detected: d.language, confidence: d.confidence, bucket: 'page_ocr_sample',
      sampled: d.sampled, modal: d.modal, modal_share: +d.modalShare.toFixed(2), scripts: d.scripts, why: d.why };
    if (d.confidence !== 'clear' && stored) {
      console.log(`  !   ${tag} stored=${stored} detected=${d.language}${d.language === stored ? ' (same value, but the sample is mixed)' : ''} — FLAGGED for review (${d.why})`);
      flagged++;
      if (COMMIT) {
        await db.collection('books').updateOne({ id: b.id }, { $set: {
          language_review: true, language_review_detail: detail,
          'field_provenance.language': prov, updated_at: new Date(),
        } });
      }
      continue;
    }
    // Published books are the case the two audit scripts leave to a human on purpose.
    if (b.visible && !ALLOW_VISIBLE) {
      console.log(`  !   ${tag} ${stored || 'none'} -> ${d.language} WITHHELD — book is visible; changing a published language needs --allow-visible`);
      flagged++;
      if (COMMIT) {
        await db.collection('books').updateOne({ id: b.id }, { $set: {
          language_review: true, language_review_detail: detail,
          'field_provenance.language': prov, updated_at: new Date(),
        } });
      }
      continue;
    }
    console.log(`  ${stored ? '~' : '+'}   ${tag} ${stored ? `${stored} -> ` : ''}${d.language}  (${d.why})`);
    wrote++;
    if (COMMIT) {
      await db.collection('books').updateOne({ id: b.id }, { $set: {
        language: d.language, 'field_provenance.language': prov,
        ...(d.confidence !== 'clear' ? { language_review: true } : {}), updated_at: new Date(),
      } });
    }
  }
  console.log(`\n=== ${COMMIT ? 'COMMITTED' : 'DRY-RUN'} — written:${wrote} confirmed:${unchanged} flagged-for-review:${flagged} too-thin:${thin} ===`);
  if (!COMMIT) console.log('(no writes; re-run with --commit)');
}
await client.close();
