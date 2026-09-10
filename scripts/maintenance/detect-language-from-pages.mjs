#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/ft-english-badged-classify.mjs classifies English-vs-not for badge
 * adjudication and writes nothing; scripts/maintenance/ft-english-badged-adjudicate.mjs writes that
 * one decision. Neither answers "which language is this edition?" for an arbitrary book, and nothing
 * in the repo sets `language` from our OWN page text — src/app/api/import/ia/route.ts can only pass
 * IA's `ocr_detected_lang`, which IA publishes for about a third of items. The sampling/census
 * primitives are shared via scripts/lib/page-language.mjs. OCR is NOT reimplemented: the sample is
 * handed to scripts/batch/realtime-ocr.mjs --page-ids-file.
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
const SAMPLE = parseInt(val('--sample') || '25', 10);
const OUT = val('--out') || '/tmp/language-sample-page-ids.json';
/** Measured batch OCR rate; a rate never travels without its vintage. */
const OCR_RATE = 0.00222, RATE_ON = '2026-09-04';
/** Provenance labels that never looked at a page. */
const WEAK = new Set(['caller', 'ia_metadata', 'iiif_manifest', 'import', 'curator', 'none', '']);

if (PLAN === APPLY) { console.error('Pass exactly one of --plan or --apply.'); process.exit(1); }

async function targets(db) {
  const iaFile = val('--ia-ids-file'), bookIds = val('--book-ids');
  const proj = { id: 1, title: 1, author: 1, language: 1, pages_count: 1, ia_identifier: 1, field_provenance: 1, _id: 0 };
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
    const d = detectLanguageFromPages(pages, { sample: SAMPLE });
    const stored = b.language ? normalizeLanguageToken(b.language) : null;
    const tag = `${String(b.ia_identifier || b.id).padEnd(32)}`;
    if (!d.language) { console.log(`  ?   ${tag} ${d.why}`); thin++; continue; }
    const agrees = stored && stored === d.language;
    if (agrees) {
      console.log(`  =   ${tag} ${d.language} confirmed (${d.why})`);
      unchanged++;
      if (COMMIT) {
        await db.collection('books').updateOne({ id: b.id }, { $set: {
          'field_provenance.language': {
            source: 'page_ocr', value: d.language, chosen_from: 'page_ocr_detected',
            claims: [{ source: provLabel(b.field_provenance), value: stored }, { source: 'page_ocr_detected', value: d.language }],
            sampled: d.sampled, date: new Date().toISOString(),
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
    if (d.confidence !== 'clear' && stored) {
      console.log(`  !   ${tag} stored=${stored} detected=${d.language} — FLAGGED for review (${d.why})`);
      flagged++;
      if (COMMIT) {
        await db.collection('books').updateOne({ id: b.id }, { $set: {
          language_review: true, 'field_provenance.language': prov, updated_at: new Date(),
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
