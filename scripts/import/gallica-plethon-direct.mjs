#!/usr/bin/env node
/**
 * Plethon manuscripts from Gallica — DIRECT INSERT, hidden, no Vercel function.
 *
 * PRIOR ART: scripts/import/gallica-islamic-direct.mjs — same fetch + insertBookIfNew
 * shape; it reads a candidate list and guesses metadata from catalogue titles, while
 * these are three hand-curated codices whose Plethon folio ranges were located on the
 * page images, so the metadata below is written out rather than derived.
 *
 * Why these books: they surround Plethon's *Laws* (held in Alexandre's 1858 edition,
 * 69942e1dd607f8e57e4b76fc). Ops handoff 2026-09-24-plethon-gallica-imports.md.
 *
 * Grec 2045 (btv1b107232593) is deliberately NOT here: it is already held as
 * 69bfbe39a77463cce4de0a33, mistitled "Supplément grec 866". The acquisition gate
 * would refuse it anyway.
 *
 * Canvases are two-page openings (Gallica digitised the BnF microfilm), so a canvas
 * shows verso n-1 + recto n. `plethonCanvases` are 1-based canvas indexes = our
 * page_number, checked by reading the folio numbers on the images.
 *
 * Gallica rate-limits datacenter IPs: run from a residential connection.
 *   node --env-file=.env.production.local scripts/import/gallica-plethon-direct.mjs            # dry run
 *   node --env-file=.env.production.local scripts/import/gallica-plethon-direct.mjs --commit
 */

import { MongoClient, ObjectId } from 'mongodb';
import { makePageDoc } from '../lib/book-docs.mjs';
import { insertBookIfNew } from '../lib/acquire-book.mjs';
import { holdBook } from '../lib/pipeline-hold.mjs';

// Held at insert: the orchestrator auto-enrols any new book within ~10 minutes and would
// then buy a preview/full OCR of the WHOLE codex. Only the Plethon folios are wanted, and
// they are processed by hand (realtime-ocr --page-ids-file), which does not read the hold.
const HOLD = {
  reason: 'plethon-folios-only',
  release: 'a human decides whether the rest of the codex (non-Plethon texts) should be processed; until then only the Plethon canvases named in books.notes are OCR\'d, by hand',
  source: 'script:gallica-plethon-direct',
};

const COMMIT = process.argv.includes('--commit');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const BOOKS = [
  {
    ark: 'btv1b10721936w',
    shelfmark: 'Paris, BnF, Grec 1603',
    title: 'Paris, BnF, Grec 1603 — Greek miscellany with Plethon\'s Compendium of the Doctrines of Zoroaster and Plato, Strabo excerpts and On the Virtues',
    published: '1501-1600',
    collections: ['byzantine-philosophy', 'neoplatonism'],
    plethonCanvases: [...range(224, 239), ...range(405, 411)],
    plethon: 'Plethon: ff. 209v–224r (canvases 224–239) — Zoroastrou kai Platōnos dogmatōn epitomē (Compendium of the doctrines of Zoroaster and Plato), then his excerpts from Strabo; ff. 387r–392v (canvases 405–411) — Peri aretōn (On the Virtues), with its tree diagram of the virtues on f. 392v.',
    contents: 'A 16th-century paper miscellany of 400 folios: Basil, Symeon Seth, Dioscorides, the Pythagorean Golden Verses, Orphic hymns, Nemesius, Aristotle De mundo, Aesop, Geoponica excerpts, Arrian and others.',
    foliationNote: 'BnF catalogue foliation for the Strabo excerpts (211–223v) runs one leaf short on the images: the excerpts end on f. 224r, where Nemesius begins.',
  },
  {
    ark: 'btv1b10722903n',
    shelfmark: 'Paris, BnF, Grec 2832',
    title: 'Paris, BnF, Grec 2832 — Greek miscellany with Plethon\'s commentary on the Chaldean Oracles, Psellus and Horapollo',
    published: '1301-1400; 1401-1500; 1501-1600',
    collections: ['byzantine-philosophy', 'neoplatonism', 'hermetica'],
    plethonCanvases: range(243, 251),
    plethon: 'Plethon: ff. 232v–240v (canvases 243–251) — Magika logia tōn apo tou Zōroastrou magōn, exēgēthenta … Plēthōnos (the Chaldean Oracles with Plethon\'s exposition). Michael Psellus\' exposition of the Oracles resumes on f. 241r.',
    contents: 'A composite paper-and-parchment codex of 261 folios: Theocritus with scholia, Julian\'s letters and orations, epistolographers, Xenophon On Hunting, Psellus on the Chaldean Oracles, Sappho fragments, Horapollo\'s Hieroglyphica.',
    foliationNote: 'DATE CONFLICT, not resolved here: Gallica dates the codex 1301–1400 (with 1401–1500 and 1501–1600 for other parts). Plethon (c. 1355–1454) wrote the Oracles commentary in the first half of the 15th century, so the Plethon section cannot be 14th-century; it belongs to one of the later units. Dates are recorded as Gallica gives them.',
  },
  {
    ark: 'btv1b107229975',
    shelfmark: 'Paris, BnF, Grec 1297',
    title: 'Paris, BnF, Grec 1297 — Gennadios Scholarios against Plethon, the Poimandres, and Plethon\'s funeral oration for Cleope Palaiologina',
    published: '1501-1600',
    collections: ['byzantine-philosophy', 'neoplatonism'],
    plethonCanvases: range(81, 92),
    plethon: 'Plethon: ff. 77r–87v (canvases 81–92) — funeral oration for Cleope Malatesta Palaiologina. Not processed yet: Gennadios Scholarios\' treatise against Plethon in defence of Aristotle (ff. 17–40) and his letter to the Grand Duke (ff. 1–16).',
    contents: 'A 16th-century paper codex of 87 folios: Gennadios Scholarios\' letter to the Grand Duke and his treatise against Gemistos Plethon for Aristotle, the Hermetic Poimandres (f. 41), Hippocrates\' Aphorisms (f. 63), Plethon\'s funeral oration (f. 77).',
    foliationNote: '',
  },
];

async function fetchManifest(ark) {
  const url = `https://gallica.bnf.fr/iiif/ark:/12148/${ark}/manifest.json`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) return { error: `HTTP ${r.status}` };
  const m = await r.json();
  const pages = (m.sequences?.[0]?.canvases || []).map((c) => {
    const res = c.images?.[0]?.resource;
    const svc = res?.service?.['@id'];
    const photo = res?.['@id'] || (svc ? `${svc}/full/full/0/default.jpg` : null);
    return photo ? { photo, thumbnail: svc ? `${svc}/full/200,/0/default.jpg` : photo } : null;
  }).filter(Boolean);
  return { pages, url };
}

const slugify = (t, max = 70) => String(t).toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '')
  .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, max).replace(/-$/, '');

async function uniqueSlug(db, base) {
  let slug = base, i = 2;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) slug = `${base}-${i++}`;
  return slug;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  await client.connect();
  const db = client.db('bookstore');
  const out = [];

  for (const b of BOOKS) {
    const res = await fetchManifest(b.ark);
    if (res.error || !res.pages.length) { console.error(`FAIL ${b.ark}: ${res.error || 'no pages'}`); continue; }
    const maxCanvas = Math.max(...b.plethonCanvases);
    if (maxCanvas > res.pages.length) throw new Error(`${b.ark}: Plethon canvas ${maxCanvas} > ${res.pages.length} canvases`);
    if (!COMMIT) { console.log(`[dry] ${b.shelfmark} ${res.pages.length}pp, Plethon canvases ${b.plethonCanvases.length}`); continue; }

    const now = new Date();
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();
    const slug = await uniqueSlug(db, slugify(b.title.split(' — ')[0]) + '-plethon');
    const description = `${b.shelfmark}. ${b.contents} ${b.plethon}`;
    const notes = [b.plethon, b.foliationNote,
      'Canvases are two-page openings from the BnF microfilm; page_number = Gallica canvas index. Only the Plethon canvases were OCR\'d and translated (ops handoff 2026-09-24-plethon-gallica-imports).']
      .filter(Boolean).join('\n');

    const acquired = await insertBookIfNew(db, {
      _id: bookId, id: bookIdStr, slug,
      title: b.title, author: 'Various',
      language: 'Greek',
      published: b.published,
      shelfmark: b.shelfmark,
      description, notes,
      categories: [],
      collections: b.collections,
      thumbnail: res.pages[0].thumbnail,
      pages_count: res.pages.length, pages_ocr: 0, pages_translated: 0, pages_archived: 0,
      content_type: 'book',
      dublin_core: { dc_identifier: [`IIIF:${res.url}`, `ark:/12148/${b.ark}`], dc_source: res.url },
      image_source: {
        provider: 'gallica', provider_name: 'Bibliothèque nationale de France (Gallica)',
        source_url: `https://gallica.bnf.fr/ark:/12148/${b.ark}`,
        iiif_manifest: res.url,
        license: 'Public domain / BnF conditions of use',
        contributing_library: 'Bibliothèque nationale de France, Département des Manuscrits',
        access_date: now,
      },
      status: 'draft', hidden: true, visible: false,
      source_fingerprint: `gallica:${b.ark}`,
      normalized_title: slugify(b.title).replace(/-/g, ' '),
      normalized_author: 'various',
      created_at: now, updated_at: now,
    }, { importer: 'script:gallica-plethon-direct', sourceIdentifier: b.ark, sourceUrl: res.url });

    if (!acquired.inserted) { console.log(`SKIP ${b.shelfmark}: ${acquired.message}`); continue; }

    const docs = res.pages.map((p, k) => {
      const pid = new ObjectId();
      return makePageDoc({
        _id: pid, id: pid.toHexString(), book_id: bookIdStr,
        page_number: k + 1, photo: p.photo, thumbnail: p.thumbnail, photo_original: p.photo,
        created_at: now, updated_at: now,
      });
    });
    await db.collection('pages').insertMany(docs, { ordered: false });
    const held = await holdBook(db, bookIdStr, HOLD);
    if (held.outcome !== 'held') throw new Error(`${b.shelfmark}: hold failed (${held.outcome}) — the orchestrator may enrol the whole codex`);
    const plethonPageIds = docs.filter((d) => b.plethonCanvases.includes(d.page_number)).map((d) => d.id);
    out.push({ shelfmark: b.shelfmark, bookId: bookIdStr, pages: docs.length, plethonPageIds });
    console.log(`OK ${b.shelfmark} → ${bookIdStr} ${docs.length}pp, ${plethonPageIds.length} Plethon pages`);
    await new Promise((s) => setTimeout(s, 5000));
  }

  if (COMMIT) console.log('RESULT ' + JSON.stringify(out));
  await client.close();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
