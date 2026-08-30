#!/usr/bin/env node
/**
 * Sanskrit wave 2 — eGangotri tantra/āgama manuscripts from the Internet Archive.
 * Issue #4311 workstream 3 (follow-on to the Wellcome wave).
 *
 * eGangotri Digital Preservation Trust digitises Indian manuscript collections
 * at source (Kashmir, Jammu, Varanasi maths): Sharada and Devanāgarī tantra,
 * āgama, stotra and jyotiṣa MSS that exist nowhere else digitally. Per
 * .claude/docs/sanskrit-sources.md this is one of the two channels that combine
 * yield with scriptability.
 *
 * Candidate list is produced by:
 *   node --env-file=.env.production.local --import tsx \
 *     scripts/import/enumerate-dedupe-source.ts \
 *     --ia-query 'mediatype:(texts) AND creator:("eGangotri") AND (tantra OR agama OR tantric)' \
 *     --rows 2000 --out <file>
 *
 * TWO SOURCE HAZARDS THIS SCRIPT HANDLES, both measured on the real list:
 *
 * 1. THE FILENAME IS THE CATALOGUE RECORD. eGangotri items carry no structured
 *    metadata; the title is a filename shaped
 *      {Title} {MS number} {Alm N Shlf N} {Script} {Subject}
 *    e.g. "Yantra Chintamani Alm 26 Shlf 6 5995 1568 Ka Devanagari Tantra".
 *    Imported raw, the shelf locator becomes part of the book's title forever.
 *    parseFilename() lifts script + subject into real metadata and strips the
 *    locator noise out of the title.
 *
 * 2. IA MIS-TAGS THE LANGUAGE OF INDIC SCANS, SYSTEMATICALLY. /api/import/ia's
 *    resolveLanguage deliberately trusts IA's empirical signals over the
 *    caller's hint, and those signals are wrong for Devanāgarī/Sharada: the
 *    same class of scans has imported as Marathi, Hindi, Nepali, Latin and
 *    English before. So this script RE-ASSERTS language + original_language in
 *    Mongo after each import, with field_provenance marking it a curator
 *    override. Do not remove that step because a spot check looked fine.
 *
 * Books land HIDDEN per the import-workflow invariant; QA before any go-live.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/import/egangotri-tantra-wave.mjs --limit 5
 *   node --env-file=.env.production.local scripts/import/egangotri-tantra-wave.mjs --limit 5 --commit
 */

import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';

const COMMIT = process.argv.includes('--commit');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const LIMIT = parseInt(arg('--limit', '5'), 10);
const LIST = arg('--list', './_tmp-egangotri-tantra.json');
const BASE = arg('--base', 'https://sourcelibrary.org/api/import/ia');
const CRON_SECRET = process.env.CRON_SECRET;
if (COMMIT && !CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1); }

const SCRIPTS = ['Devanagari', 'Sharada', 'Grantha', 'Bengali', 'Telugu', 'Malayalam', 'Nandinagari', 'Newari', 'Tamil', 'Oriya', 'Kannada', 'Gujarati'];
const SUBJECTS = ['Tantra', 'Jyotish', 'Ayurveda', 'Vaidyaka', 'Dharmashastra', 'Alankar', 'Vyakaran', 'Vedanta', 'Nyaya', 'Purana', 'Kavya', 'Sahitya', 'Stotra', 'Yoga', 'Agama', 'Shaiva', 'Mimansa', 'Sankhya', 'Veda', 'Smriti'];

/**
 * The convention puts script and subject at the END of the filename, so only a
 * TRAILING token may be stripped. Stripping them globally mangles real titles:
 * Mālinīvijayottara **Tantra** IS the work's name, and "Antyeshti Vidhi (from
 * Tantra Shastra)" loses its sense. A subject word in the middle of a title is
 * part of the title.
 *
 * What remains may still be untidy (collection numbers, dates). That is
 * deliberate — these import HIDDEN, and sanskrit-sources.md prescribes
 * title-page OCR at QA as the step that produces the real title. Guessing
 * harder here would only produce confident wrong titles.
 */
export function parseFilename(raw) {
  const t = String(raw || '')
    // the trust signs its own uploads; that is provenance, not a title
    .replace(/\bE\s*Gangotri\b/gi, ' ')
    .replace(/\bDigital\s*Preservation\s*(Trust|Foundation)\b/gi, ' ')
    // leading SCAN date, not a date of the work: "04 04 2023 …", "1 July …",
    // "18 May …". Anchored to the start so a date inside a title survives.
    .replace(/^\s*\d{1,2}[\s.\-/]+\d{1,2}[\s.\-/]+\d{2,4}\s+/, '')
    .replace(/^\s*\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+/i, '')
    .replace(/\s{2,}/g, ' ').trim();
  const script = (t.match(new RegExp(`\\b(${SCRIPTS.join('|')})\\b`, 'i')) || [])[1] || null;
  const subject = (t.match(new RegExp(`\\b(${SUBJECTS.join('|')})\\w*\\b`, 'i')) || [])[1] || null;

  const TRAILING = new RegExp(
    `[\\s\\-–—.]*\\b(?:(?:${SCRIPTS.join('|')})|(?:${SUBJECTS.join('|')})\\w*|` +
    `(?:Alm|Almira|Shlf|Shelf)\\s*\\.?\\s*\\d+[A-Za-z]?|Manuscript|MSS?|` +
    `Ka|Kha|Ga|Gha|Nga|\\d{3,6})\\b[\\s\\-–—.]*$`, 'i');

  let title = t;
  for (let i = 0; i < 8; i++) {
    const next = title.replace(TRAILING, '').trim();
    if (next === title || next.length < 4) break;
    title = next;
  }
  return { title: title || t, script, subject };
}

async function main() {
  const data = JSON.parse(readFileSync(LIST, 'utf8'));
  const all = data.candidates.filter(c => c.status !== 'REUPLOAD');
  const batch = all.slice(0, LIMIT);
  console.log(`list: ${all.length} candidates; importing ${batch.length}${COMMIT ? '' : ' (DRY RUN)'}`);

  const parsed = batch.map(c => ({ ...c, ...parseFilename(c.title) }));
  for (const p of parsed) {
    console.log(`  ${p.ia_identifier}`);
    console.log(`     raw:   ${p.title !== p.clean ? String(p.title).slice(0, 78) : ''}`);
    console.log(`     title: ${parseFilename(p.title).title}   [${p.script || '?'} / ${p.subject || '?'}]`);
  }
  if (!COMMIT) { console.log('\nDRY RUN — nothing imported. Add --commit.'); return; }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const books = client.db('bookstore').collection('books');

  let ok = 0, failed = 0;
  for (const p of parsed) {
    const meta = parseFilename(p.title);
    let res, body;
    try {
      res = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
        body: JSON.stringify({
          ia_identifier: p.ia_identifier,
          title: meta.title || p.title,
          // These are anonymous manuscripts and the route requires an author.
          // 'Unknown' is the corpus's honest-absence value (the Wellcome wave
          // settled 17 books this way). Do NOT substitute the holding
          // collection: an institution in `author` is emitted as a schema.org
          // Person by four separate emitters (see corporate-bylines.ts).
          author: 'Unknown',
          language: 'Sanskrit',
          original_language: 'Sanskrit',
          categories: meta.subject ? [meta.subject] : undefined,
          visible: false,
          hidden: true,
        }),
        signal: AbortSignal.timeout(120000),
      });
      body = await res.json().catch(() => ({}));
    } catch (e) {
      console.error(`  FAIL ${p.ia_identifier}: ${e.message}`);
      failed++;
      continue;
    }
    if (!res.ok) {
      // 409 = already held; that is a correct refusal, not an error.
      console.error(`  ${res.status === 409 ? 'HELD' : 'FAIL'} ${p.ia_identifier}: ${body.error || res.status}`);
      failed++;
      continue;
    }
    // The route returns `bookId` (not book_id/id). Getting this wrong made the
    // language re-assertion below a silent no-op on the first pilot run.
    const bookId = body.bookId || body.book_id || body.id;
    if (!bookId) { console.error(`  WARN ${p.ia_identifier}: import succeeded but no bookId in response: ${JSON.stringify(body).slice(0,200)}`); }
    ok++;

    // Re-assert language. The import route resolves language from IA's own
    // signals, which are wrong for Indic scans as a rule, not occasionally.
    const upd = await books.updateOne({ id: bookId }, {
      $set: {
        language: 'Sanskrit',
        original_language: 'Sanskrit',
        'field_provenance.language': { source: 'manual_curator_override', value: 'Sanskrit', reason: 'eGangotri Indic MS; IA language signals unreliable (#4311)' },
        updated_at: new Date(),
      },
      // Script and subject go into `categories`, which is a WHITELISTED field.
      // An earlier cut wrote `books.script`, which is not in
      // scripts/lib/books-known-fields.json — i.e. it silently minted a new
      // column on `books`, which is the #3969 defect. A sweep records a value
      // in an existing field or a ROW, never a new column.
      ...(meta.script || meta.subject
        ? { $addToSet: { categories: { $each: [meta.subject, meta.script].filter(Boolean) } } }
        : {}),
    });
    const after = await books.findOne({ id: bookId }, { projection: { language: 1, pages_count: 1, visible: 1, hidden: 1, title: 1 } });
    console.log(`  OK ${p.ia_identifier} → ${bookId} | ${after?.title?.slice(0, 46)} | lang=${after?.language} pages=${after?.pages_count} visible=${after?.visible} hidden=${after?.hidden} (lang-fix modified=${upd.modifiedCount})`);
  }
  console.log(`\nimported ${ok}, failed/held ${failed}`);
  await client.close();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('FATAL', e); process.exit(1); });
}
