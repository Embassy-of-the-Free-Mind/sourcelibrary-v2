#!/usr/bin/env node
/**
 * `iiif` is a protocol, not a library — resolve those books to the institution
 * that actually holds them.
 *
 * `scripts/audit/record-completeness.mjs` reported 997 LIVE books whose
 * `image_source.provider` is `iiif` and which therefore appear on no
 * `/libraries/<slug>` page. The obvious reading is "add a library entry for
 * iiif". That would be wrong, and looking at where the books come from says why
 * — counting every record rather than only the live ones, it is 16,994:
 *
 *   12,385  api.digitale-sammlungen.de        Bayerische Staatsbibliothek
 *    1,390  e-rara.ch                         e-rara
 *    1,144  content.staatsbibliothek-berlin.de Staatsbibliothek zu Berlin
 *      764  manifests.sub.uni-goettingen.de   SUB Göttingen
 *      569  digital.slub-dresden.de           SLUB Dresden
 *      347  luna. + digitalcollections.manchester.ac.uk   John Rylands
 *      328  iiif.archive.org                  Internet Archive
 *       19  dl.ndl.go.jp                      National Diet Library
 *       18  uvaerfgoed.nl                     Allard Pierson (UvA)
 *       15  viewer.cbl.ie                     Chester Beatty Library
 *        6  cdm21059.contentdm.oclc.org       Biblioteca Medicea Laurenziana
 *        3  digitalcollections.universiteitleiden.nl  Leiden
 *        3  florentinecodex.getty.edu         Getty Research Institute
 *        2  digi.ub.uni-heidelberg.de         Heidelberg
 *        1  purl.stanford.edu                 Stanford — no key, left alone
 *
 * Fifteen institutions, not one. `iiif` is what the importer wrote when it
 * reached a manifest without recognising whose it was — an artefact of the
 * ingest, not a fact about the book. A `/libraries/iiif` page would credit a
 * standards body for the Bayerische Staatsbibliothek's scans, which is worse
 * than crediting nobody, because it looks like an answer.
 *
 * Eleven of the twelve already have a provider key AND a library page; they
 * were simply never pointed at. `slub_dresden` and `goettingen` were added for
 * the other two.
 *
 * The mapping is by the HOST of `source_url` / `iiif_manifest` — the one piece
 * of evidence that says who served the images, rather than by title or by guess.
 * A book whose host is not in the table is left alone: `iiif` is the honest
 * label for a manifest we genuinely cannot attribute.
 *
 *   node --env-file=.env.production.local scripts/maintenance/resolve-iiif-provider.mjs [--commit]
 */
import { MongoClient } from 'mongodb';

const COMMIT = process.argv.includes('--commit');

/** host → [provider key, provider_name]. Nothing is guessed; each was read off the data. */
const HOSTS = {
  'api.digitale-sammlungen.de': ['mdz', 'Münchener DigitalisierungsZentrum, Bayerische Staatsbibliothek'],
  'digitale-sammlungen.de': ['mdz', 'Münchener DigitalisierungsZentrum, Bayerische Staatsbibliothek'],
  'digital.slub-dresden.de': ['slub_dresden', 'Sächsische Landesbibliothek – Staats- und Universitätsbibliothek Dresden'],
  'e-rara.ch': ['e-rara', 'e-rara (Swiss rare books)'],
  'uvaerfgoed.nl': ['allard_pierson', 'Allard Pierson, University of Amsterdam'],
  'cdm21059.contentdm.oclc.org': ['laurenziana', 'Biblioteca Medicea Laurenziana, Florence'],
  'dl.ndl.go.jp': ['ndl_japan', 'National Diet Library of Japan'],
  'content.staatsbibliothek-berlin.de': ['sbb', 'Staatsbibliothek zu Berlin'],
  'florentinecodex.getty.edu': ['getty', 'Getty Research Institute'],
  'manifests.sub.uni-goettingen.de': ['goettingen', 'Niedersächsische Staats- und Universitätsbibliothek Göttingen'],
  'digitalcollections.universiteitleiden.nl': ['leiden', 'Leiden University Library'],
  'digi.ub.uni-heidelberg.de': ['heidelberg', 'Heidelberg University Library'],
  'luna.manchester.ac.uk': ['manchester', 'John Rylands Library, University of Manchester'],
  // Manchester serves from two hosts; both are the John Rylands.
  'digitalcollections.manchester.ac.uk': ['manchester', 'John Rylands Library, University of Manchester'],
  'iiif.archive.org': ['internet_archive', 'Internet Archive'],
  'viewer.cbl.ie': ['chester_beatty', 'Chester Beatty Library, Dublin'],
};

const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return null; } };

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5 });
await client.connect();
const db = client.db('bookstore');

const books = await db.collection('books')
  .find({ 'image_source.provider': 'iiif' })
  .project({ id: 1, title: 1, visible: 1, image_source: 1 })
  .toArray();
console.log(`${COMMIT ? 'WRITING' : 'DRY RUN'} — ${books.length} books under provider 'iiif'\n`);

const plan = new Map();
let unresolved = 0;
for (const b of books) {
  const src = b.image_source || {};
  const h = hostOf(src.source_url) || hostOf(src.iiif_manifest);
  const hit = h && HOSTS[h];
  if (!hit) { unresolved++; continue; }
  if (!plan.has(hit[0])) plan.set(hit[0], { name: hit[1], ids: [] });
  plan.get(hit[0]).ids.push(b.id);
}
for (const [key, v] of [...plan.entries()].sort((a, b) => b[1].ids.length - a[1].ids.length)) {
  console.log(`  ${String(v.ids.length).padStart(4)} → ${key.padEnd(16)} ${v.name}`);
}
console.log(`  ${String(unresolved).padStart(4)}    (left as 'iiif' — the manifest host is not one we can attribute)`);

if (!COMMIT) { console.log('\nDRY RUN — pass --commit to write.'); await client.close(); process.exit(0); }

let total = 0;
for (const [key, v] of plan) {
  const r = await db.collection('books').updateMany(
    { id: { $in: v.ids } },
    {
      $set: {
        'image_source.provider': key,
        'image_source.provider_name': v.name,
        updated_at: new Date(),
      },
    },
  );
  console.log(`  ${key}: modified ${r.modifiedCount}`);
  total += r.modifiedCount;
}
console.log(`\n${total} books now credit the institution that actually holds them.`);
console.log('Their /libraries/<slug> pages will list them; the pages are ISR, so allow for revalidation.');
await client.close();
