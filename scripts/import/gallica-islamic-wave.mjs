#!/usr/bin/env node
/**
 * Import the curated Gallica Graeco-Arabic / Islamic scientific wave.
 *
 * Candidate list comes from gallica-islamic-science-enumerate.mjs. Books land
 * HIDDEN per the import-workflow invariant; QA before any go-live.
 *
 * PRIORITY ORDER IS DELIBERATE. Greek-transmission witnesses go first —
 * Ptolemy's Almagest, al-Tusi's recension of Euclid, Dioscorides in Hunayn ibn
 * Ishaq's revision, Galen on Hippocrates — because they are the material that
 * links our Greek corpus to our Latin one, and because if the run is stopped
 * early the most valuable books are already in.
 *
 * THROTTLING IS LOAD-BEARING. Gallica 429s after a handful of rapid calls; a
 * previous enumeration lost 15 of 24 queries to it. The route fetches the
 * manifest server-side, so our pause here is what protects the source. Do not
 * lower DELAY_MS to make a run finish sooner — you will simply convert books
 * into 429s.
 *
 * Language is re-asserted after import for the same reason as the eGangotri
 * wave: `resolveLanguage` trusts source signals over the caller's hint, and a
 * French-catalogued Arabic manuscript is exactly the shape that misfires.
 * NOTE the edition-vs-source distinction (language-fields.md): `language` is
 * the language of THIS manuscript (Arabic); `original_language` is the language
 * of the WORK, which for a translation of Ptolemy is Greek.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/import/gallica-islamic-wave.mjs --limit 5
 *   node --env-file=.env.production.local scripts/import/gallica-islamic-wave.mjs --limit 60 --commit
 */

import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';

const COMMIT = process.argv.includes('--commit');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const LIMIT = parseInt(arg('--limit', '5'), 10);
const LIST = arg('--list', './_tmp-gallica-curated.json');
const DELAY_MS = parseInt(arg('--delay', '6000'), 10);
const BASE = 'https://sourcelibrary.org/api/import/gallica';
const CRON_SECRET = process.env.CRON_SECRET;
if (COMMIT && !CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1); }

// A Greek author named in the catalogue title tells us the WORK is Greek even
// though the manuscript is Arabic — that is what makes these transmission
// witnesses rather than merely Arabic science.
const GREEK_WORK = /Ptolém|Almageste|Euclide|Hippocrate|Galien|Dioscoride|Platon|Aristote|Porphyre|Proclus|Plotin|Archimède|Ménélaüs|Apollonius|Théologia|Theologia|Isagoge|Organon/i;

function priority(r) {
  const greekWhy = (r.why || []).some(w => w.startsWith('greek:'));
  const greekTitle = GREEK_WORK.test(r.title || '');
  if (greekTitle) return 0;          // named Greek work — highest value
  if (greekWhy) return 1;            // surfaced by a Greek-author query
  return 2;                          // Islamic science generally
}

function cleanTitle(t) {
  return String(t || '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'Untitled Arabic manuscript';
}

async function main() {
  const data = JSON.parse(readFileSync(LIST, 'utf8'));
  const all = (data.keep || data.candidates || data)
    .slice()
    .sort((a, b) => priority(a) - priority(b) || String(a.title).localeCompare(String(b.title)));
  const batch = all.slice(0, LIMIT);

  console.log(`list ${all.length}; importing ${batch.length}${COMMIT ? '' : ' (DRY RUN)'}`);
  const tiers = { 0: 'named Greek work', 1: 'Greek-query hit', 2: 'Islamic science' };
  for (const t of [0, 1, 2]) console.log(`  tier ${t} (${tiers[t]}): ${all.filter(r => priority(r) === t).length}`);

  if (!COMMIT) {
    console.log('\nfirst 15 in priority order:');
    for (const r of batch.slice(0, 15)) console.log(`  [${priority(r)}] ${String(r.date || '----').padEnd(10)} ${cleanTitle(r.title).slice(0, 88)}`);
    console.log('\nDRY RUN — add --commit.');
    return;
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const books = client.db('bookstore').collection('books');

  let ok = 0, held = 0, failed = 0;
  for (const [i, r] of batch.entries()) {
    const isGreek = GREEK_WORK.test(r.title || '');
    let res, body;
    try {
      res = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
        body: JSON.stringify({
          ark: r.ark,
          title: cleanTitle(r.title),
          author: 'Unknown',
          language: 'Arabic',
          published: r.date || undefined,
          categories: ['islamic-science', ...(isGreek ? ['graeco-arabic-transmission'] : [])],
          visible: false,
          hidden: true,
        }),
        signal: AbortSignal.timeout(300000),
      });
      body = await res.json().catch(() => ({}));
    } catch (e) {
      failed++; console.error(`  FAIL ${r.ark}: ${e.message}`);
      await new Promise(s => setTimeout(s, DELAY_MS)); continue;
    }

    if (!res.ok) {
      const dup = res.status === 409 || /duplicate/i.test(body.error || '');
      if (dup) { held++; console.log(`  HELD ${r.ark}: ${String(body.error).slice(0, 70)}`); }
      else { failed++; console.error(`  FAIL ${r.ark} [${res.status}]: ${String(body.error).slice(0, 90)}`); }
      await new Promise(s => setTimeout(s, DELAY_MS)); continue;
    }

    const bookId = body.bookId || body.book_id || body.id;
    ok++;
    if (bookId) {
      await books.updateOne({ id: bookId }, {
        $set: {
          language: 'Arabic',
          // The WORK is Greek where a Greek author is named; the MANUSCRIPT is
          // Arabic. Conflating those is the language-fields.md invariant.
          ...(isGreek ? { original_language: 'Greek' } : {}),
          'field_provenance.language': {
            source: 'manual_curator_override', value: 'Arabic',
            reason: 'Gallica Islamic wave; BnF catalogues these in French (#4311)',
          },
          updated_at: new Date(),
        },
      });
    }
    console.log(`  OK ${String(i + 1).padStart(3)}/${batch.length} ${r.ark} ${String(body.pagesCreated).padStart(4)}pp ${isGreek ? '[GREEK]' : ''} ${cleanTitle(r.title).slice(0, 56)}`);
    await new Promise(s => setTimeout(s, DELAY_MS));
  }

  console.log(`\nimported ${ok}, already held ${held}, failed ${failed}`);
  await client.close();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('FATAL', e); process.exit(1); });
}
