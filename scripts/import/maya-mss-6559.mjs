#!/usr/bin/env node
/**
 * Maya manuscripts from Princeton's Garrett-Gates / Mesoamerican Manuscripts (#6559).
 *
 * PRIOR ART: scripts/import/iiif-direct-import.mjs — one manifest, one book, generic
 * metadata; it cannot join the 26 Caste War letters (26 manifests) into the one
 * multi-title collection Princeton catalogues them as, and it records neither the
 * DPUL record nor the per-letter provenance. scripts/import/chilam-balam-gates-byu.mjs
 * is the shape copied here (declarative list, hidden, provenance in image_source).
 * The survey this list comes from: scripts/import/maya-sources-survey-6559.md.
 *
 * WHAT IT IMPORTS: only items whose own manifest `license` is rightsstatements
 * NKC ("No Known Copyright"). The script re-reads the licence from every manifest
 * and refuses anything else, so a CNE item cannot slip in by being added here.
 *
 * GROUPING: Princeton catalogues the Caste War letters and the Ebtún papers as
 * one "multi-title collection" each (the DPUL `relation` field), with a record
 * and a manifest per document. A one-leaf letter is not a book anybody can read,
 * so a group becomes ONE book, documents in date order; each page carries its
 * document's title (`part_title`) and ark (`source_ref`), and the book's notes
 * list the page range of every document.
 *
 * LANDS: hidden (publication `hidden`/`unprocessed`, so finalize cannot unhide it),
 * tagged `acquisition_campaign: maya-mss-6559`, and HELD out of every pipeline
 * lane with reason `maya-mss-6559` (scripts/lib/pipeline-hold.mjs) for the Opus
 * lane. Page images reference Princeton's IIIF service at native size; masters go
 * to R2 under `pages/<book_id>/NNNN.jpg` via
 *   npx tsx scripts/catalog-coverage/archive-acquired.ts --campaign maya-mss-6559
 *
 *   node --env-file=.env.production.local scripts/import/maya-mss-6559.mjs [--dry-run] [--only=<key>]
 *
 * Idempotent: insertBookIfNew() declines a manifest already held.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makePageDoc } from '../lib/book-docs.mjs';
import { insertBookIfNew } from '../lib/acquire-book.mjs';
import { holdBook } from '../lib/pipeline-hold.mjs';
import { initialPublication } from '../lib/publication.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const CAMPAIGN = 'maya-mss-6559';
const ISSUE = 6559;
const NKC = 'http://rightsstatements.org/vocab/NKC/1.0/';
const DPUL = 'https://dpul.princeton.edu/mesoamerican/catalog';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library)';
const HOLD = {
  reason: CAMPAIGN,
  issue: ISSUE,
  release: 'Opus OCR of the book is done (claude-ocr.mjs, maya-ref-opus-6559 recipe, #6559) and Derek has chosen its translation lane; release with --to ocr_complete only then',
};
const COLLECTIONS = ['maya', 'mesoamerican', 'americas'];
const GATES_PROVENANCE = 'Previously owned by William Gates; sold to Robert Garrett in 1930; donated to Princeton University Library in 1949.';

/**
 * `arks` are DPUL record ids. A `volume` picks one member of a multi-volume
 * IIIF collection. `group` books sort their documents by date before paging.
 */
const BOOKS = [
  {
    key: 'bacabs',
    arks: ['bn999802r'],
    title: 'Ritual of the Bacabs',
    display_title: 'Ritual of the Bacabs (Yucatec Maya healing incantations, 1775–1800)',
    author: 'Anonymous Yucatec Maya healers',
    language: 'Yucatec Maya',
    published: '1775-1800',
    notes: [
      'The Ritual of the Bacabs ("Cana che la ba Can yaban" in Gates\'s alternative title) is a book of Yucatec Maya incantations and remedies: spells against seizures, snake bite, asthma, toothache, fevers, burns and sores, for cooling, making fire, shaping flint and calling deer.',
      'Princeton\'s catalogue notes that the last two pages are written on the back of a printed Latin indulgence dated February 1779, and that the language suggests a copy of a 16th- or 17th-century original. It was found in Maya hands in Yucatán by Frederic J. Smith in the winter of 1914–15, working for William Gates.',
      'The scan includes covers, blank leaves and colour bars: 164 leaves, 348 images.',
    ],
  },
  {
    key: 'caste-war-letters',
    group: true,
    arks: [
      '4x51hn85c', '1544bs922', 'rn301521t', 'wd376112j', '8p58ph782', 'zp38wh448', 'df65vc685',
      'j67317593', '2514nq33r', '3f462926d', 'nv935668r', 'sn00b259h', 'xd07gx51z', 'n009w611g',
      'r494vp997', '05741w52s', '3x816r44m', '76537516h', '7p88cm38s', 'bv73c4255', 'cf95jg30g',
      'fn1072776', 'h702qb20r', 'kd17cx672', 'qr46r464k', 'vd66w373g',
    ],
    title: 'Caste War letters, 1848–1850',
    display_title: 'Caste War letters of the Maya leaders, 1848–1850 (Jacinto Pat, Florentino Chan, Bonifacio Novelo, Venancio Pec and others)',
    author: 'Jacinto Pat; Florentino Chan; Bonifacio Novelo; Venancio Pec; and other Maya leaders',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1848-1850',
    notes: [
      'Twenty-six letters written during the Caste War of Yucatán by the Maya rebel leadership and their captains — Jacinto Pat, Florentino Chan, Bonifacio Novelo, Venancio Pec, José Albino May and others — to priests, commanders and officials, several sent from Cruz Chen. Most are in Yucatec Maya; two mix in Spanish and one is in Spanish.',
      'Princeton catalogues them as one multi-title collection with a record per letter. Here they are one book, in date order; the undated letters Princeton places "ca. 1848" or "ca. 1850" sit at the start of their year. Each page carries its letter\'s title and DPUL ark.',
    ],
  },
  {
    key: 'chilam-balam-texts-v1',
    arks: ['dc5712mj05h'],
    volume: 0,
    title: 'Chilam Balam Texts, vol. 1: Chumayel, Calkiní, Libro de los Médicos',
    display_title: 'Chilam Balam Texts, vol. 1 (19th-century copies: Chumayel, Calkiní, Libro de los Médicos)',
    author: 'Anonymous Yucatec Maya scribes',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1850-1860',
    notes: [
      'Volume 1 of a two-volume 19th-century manuscript copy of several Books of Chilam Balam, possibly by a copyist working for Bishop Crescencio Carrillo y Ancona in Mérida. This volume: the Chilam Balam of Chumayel (the conquest of Yucatán), the Chilam Balam of Calkiní (the Ah Canul province in the later 16th century) and El Libro de los Médicos Yervateros de Yucatán (medicinal plants).',
      'A copy, not the original manuscripts. Volume 2 holds Tizimín, Ixil and Kaua.',
    ],
  },
  {
    key: 'chilam-balam-texts-v2',
    arks: ['dc5712mj05h'],
    volume: 1,
    title: 'Chilam Balam Texts, vol. 2: Tizimín, Ixil, Kaua',
    display_title: 'Chilam Balam Texts, vol. 2 (19th-century copies: Tizimín, Ixil, Kaua)',
    author: 'Anonymous Yucatec Maya scribes',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1850-1860',
    notes: [
      'Volume 2 of a two-volume 19th-century manuscript copy of several Books of Chilam Balam, possibly by a copyist working for Bishop Crescencio Carrillo y Ancona in Mérida. This volume: the Chilam Balam of Tizimín (chronicle, katun prophecies, calendar correlations and almanac, and what may be a Maya paraphrase of the Old Testament), of Ixil (medicine) and of Kaua (calendar correlations and medicine).',
      'A copy, not the original manuscripts. Volume 1 holds Chumayel, Calkiní and the Libro de los Médicos.',
    ],
  },
  {
    key: 'chumayel',
    arks: ['0z708w51x'],
    title: 'Book of the Chilam Balam of Chumayel',
    display_title: 'Book of the Chilam Balam of Chumayel (manuscript, 1775–1800)',
    author: 'Anonymous Yucatec Maya scribes',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1775-1800',
    notes: [
      'The Chilam Balam of Chumayel, written and illustrated in Chumayel, Yucatán; Princeton\'s catalogue calls it a late 18th-century copy. It holds the ritual of the four world-quarters, the rise of Hunac Ceel, katun prophecies, the creation of the world and of the uinal, a song of the Itzá, the interrogation of the chiefs, and a history of the Spanish conquest, with 27 leaves of drawings.',
      'Princeton records its history: found in Chumayel in the 19th century, given to Bishop Carrillo y Ancona, expropriated in 1915 into the Cepeda Library in Mérida, then lost from it. Gordon\'s 1913 photographic facsimile of the Chumayel book is held separately; whether that facsimile was made from this manuscript has not been checked against the leaves.',
    ],
  },
  {
    key: 'brujo-calendar',
    arks: ['qf85nf62m'],
    title: 'Brujo calendar',
    display_title: "Brujo calendar (Q'eqchi' divinatory calendar, 1867)",
    author: "Anonymous Q'eqchi' daykeeper",
    language: "Q'eqchi'",
    languages: ["Q'eqchi'", 'Spanish', 'Latin'],
    published: '1867',
    notes: [
      "A calendar of lucky and unlucky days in Q'eqchi', with the months and some feast days in Spanish. The date 1867 is written on fol. 6v at 16 October. Fol. 8v has four lines of church music with Q'eqchi' words, and fol. 9v a Latin prayer (perhaps the Salve Regina).",
      'Probably written at Lanquín, Alta Verapaz (Guatemala), where William Gates acquired it; the title is his. Two typed transcriptions are laid in with the manuscript.',
    ],
  },
  {
    key: 'ebtun-land-papers',
    group: true,
    arks: ['z603r225f', '2z10wv045', '6q182p96s'],
    title: 'Ebtún land papers, 1561–1869',
    display_title: 'Ebtún land papers, 1561–1869 (title of Juan Canul, 1721 land document, 1869 deed of sale)',
    author: 'Maya community of Ebtún',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1561-1869',
    notes: [
      'Three land documents from the Maya town of Ebtún, near Valladolid, Yucatán: the 1561 title proving Juan Canul\'s ownership and boundaries, an 18th-century land document (dated 1721) with a fragment of another, and an 1869 deed of sale by Juana Dzul and others to Gregorio Pat.',
      'Princeton catalogues them as one multi-title collection; here they are one book in date order, each page carrying its document\'s title and ark. Princeton\'s record for the 1561 title gives its catalogue date as 1835, which is the auction note on its cover, not the document\'s date.',
    ],
  },
  {
    key: 'maya-legal-documents',
    arks: ['tx31qn51k'],
    title: 'Maya legal documents, 1686–1849',
    display_title: 'Maya legal documents, 1686–1849 (bound volume of land and legal papers)',
    author: 'Various Maya and Spanish notaries',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1686-1849',
    notes: [
      'A bound volume of miscellaneous legal documents from Mexico, 1686–1849, sixteen folders in all. Princeton notes that seven of the folders come from Yucatán and are presumably in Yucatec Maya (1804/5–1849); the others are in Spanish.',
    ],
  },
  {
    key: 'titulos-quiche',
    arks: ['r781wh31g'],
    title: 'Títulos de los señores del Reino del Quiché',
    display_title: "Títulos de los señores del Reino del Quiché (K'iche' títulos, 1501–1781?)",
    author: "K'iche' lords of Xelajuh",
    language: "K'iche' Maya",
    languages: ["K'iche' Maya", 'Spanish'],
    published: '1501-1781',
    notes: [
      "K'iche' títulos in their archive wrapper (\"Titulo de reyes de Guatemala en Quiche\"). It holds the Título Real de don Francisco Izquin, last Ahpop Alel of the K'iche', dated 22 November 1588 and signed by him and eight other lords (11 leaves); a narrative (fols. 15–22) of the first conquest of the highlands by the K'iche' ancestors, dated 7 May 1524 and signed with the names of K'iche' lords, of Pedro de Alvarado and two other conquerors, and of the four friars with them; and official documents from Xelajuh, 1587 to about 1781.",
      'Presented by the keeper of the archive to Brasseur de Bourbourg in 1856; later owned by Alphonse Pinart and William Gates. Princeton notes a published transcription: Mallory Matsumoto, Land, Politics, and Memory in Five Nija\'ib\' K\'iche\' Títulos (University Press of Colorado, 2017).',
    ],
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${url}`);
    } catch (e) {
      if (i === 2) throw e;
    }
    await sleep(3000 * (i + 1));
  }
  throw new Error(`fetch failed: ${url}`);
}

const first = (doc, k) => (doc[`readonly_${k}_tesim`] || [])[0] || null;
const all = (doc, k) => doc[`readonly_${k}_tesim`] || [];
const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '');

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
/** Sort key from a DPUL title's bracketed date: "[1850, Feb. 24]" -> 18500224; "[ca. 1850]" -> 18500000. */
function dateKey(title) {
  const m = String(title).match(/\[(?:ca\.\s*)?(\d{4})(?:,)?\s*([A-Za-z]+)?\.?\s*(\d{1,2})?\]/);
  if (!m) return 99999999;
  return Number(m[1]) * 10000 + (MONTHS[(m[2] || '').toLowerCase()] || 0) * 100 + Number(m[3] || 0);
}

/** One DPUL record -> its catalogue facts and its manifest's canvases. */
async function loadRecord(ark, volume) {
  const doc = (await getJson(`${DPUL}/${ark}.json`)).response.document;
  let manifestUrl = doc.content_metadata_iiif_manifest_field_ssi;
  let manifest = await getJson(manifestUrl);
  if (manifest['@type'] === 'sc:Collection') {
    if (volume == null) throw new Error(`${ark}: manifest is a collection; set volume`);
    manifestUrl = manifest.manifests[volume]['@id'];
    manifest = await getJson(manifestUrl);
  }
  if (manifest.license !== NKC) throw new Error(`${ark}: licence is ${manifest.license}, not NKC — refusing`);
  const canvases = (manifest.sequences?.[0]?.canvases || []).map((c) => {
    const svc = c.images?.[0]?.resource?.service?.['@id'];
    if (!svc) throw new Error(`${ark}: canvas ${c['@id']} has no image service`);
    return { canvas: c['@id'], label: typeof c.label === 'string' ? c.label : null, svc };
  });
  if (!canvases.length) throw new Error(`${ark}: manifest has no canvases`);
  return {
    ark,
    arkFull: first(doc, 'identifier') || `ark:/88435/${ark}`,
    dpul: `${DPUL}/${ark}`,
    catalog: stripHtml(first(doc, 'view-in-catalog')),
    title: first(doc, 'title'),
    date: first(doc, 'date'),
    call: first(doc, 'call-number'),
    extent: first(doc, 'extent'),
    textLanguage: first(doc, 'text-language'),
    abstract: first(doc, 'abstract'),
    creators: all(doc, 'creator'),
    subjects: all(doc, 'subject'),
    rights: first(doc, 'edm-rights'),
    manifestUrl,
    canvases,
  };
}

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');
const report = [];

for (const spec of BOOKS.filter((b) => !ONLY || b.key === ONLY)) {
  console.log(`\n=== ${spec.key}`);
  let records;
  try {
    records = [];
    for (const ark of spec.arks) { records.push(await loadRecord(ark, spec.volume)); await sleep(400); }
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    report.push({ key: spec.key, outcome: 'failed', why: e.message });
    continue;
  }
  if (spec.group) records.sort((a, b) => dateKey(a.title) - dateKey(b.title));

  const pages = [];
  const parts = [];
  for (const r of records) {
    const from = pages.length + 1;
    for (const c of r.canvases) pages.push({ ...c, record: r });
    parts.push(`pp. ${from}–${pages.length}: ${r.title} (${r.arkFull})`);
  }
  const lead = records[0];
  console.log(`  ${records.length} record(s), ${pages.length} pages; licence NKC on all`);
  if (DRY_RUN) {
    for (const p of parts.slice(0, 30)) console.log(`    ${p}`);
    report.push({ key: spec.key, outcome: 'dry_run', pages: pages.length });
    continue;
  }

  const now = new Date();
  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();
  let slug = spec.key;
  for (let i = 2; await db.collection('books').findOne({ slug }, { projection: { _id: 1 } }); i++) slug = `${spec.key}-${i}`;
  const shelfmark = spec.group
    ? 'Princeton University Library, Robert Garrett Collection (Garrett-Gates Mesoamerican Manuscripts), multi-title collection'
    : `Princeton University Library, ${lead.call}`;
  const notes = [
    ...spec.notes,
    ...(spec.group ? [`Documents in this book: ${parts.join('; ')}.`] : []),
    GATES_PROVENANCE,
    'Princeton University Library rights statement: No Known Copyright (rightsstatements.org NKC 1.0); Princeton states that no permission or fee is needed to publish from its Special Collections.',
  ].join(' ');

  // hidden_reason is not on makeBookDoc's whitelist (#3969); it is written right after the
  // insert from the same initialPublication() result, as bdrc-scans-import.mjs does.
  const { hidden_reason: hiddenReason, ...publication } = initialPublication({ state: 'hidden', reason: 'unprocessed', note: `maya-mss-6559: held for the Opus lane (#${ISSUE})`, by: 'script:maya-mss-6559', issue: ISSUE, now });
  const acquired = await insertBookIfNew(db, {
    _id: bookId,
    id: bookIdStr,
    slug,
    title: spec.title,
    display_title: spec.display_title,
    author: spec.author,
    language: spec.language,
    original_language: spec.language,
    ...(spec.languages ? { languages: spec.languages, language_multi: true } : {}),
    field_provenance: { language: 'caller' },
    text_role: 'original',
    published: spec.published,
    categories: [],
    collections: COLLECTIONS,
    thumbnail: `${pages[0].svc}/full/400,/0/default.jpg`,
    pages_count: pages.length,
    pages_ocr: 0,
    pages_translated: 0,
    pages_archived: 0,
    needs_splitting: false,
    page_count_source: 'iiif_manifest',
    dublin_core: {
      dc_identifier: records.flatMap((r) => [r.arkFull, r.manifestUrl]),
      dc_source: lead.dpul,
      dc_date: records.map((r) => r.date).filter(Boolean),
      ...(!spec.group && lead.abstract ? { dc_description: lead.abstract } : {}),
      dc_subject: [...new Set(records.flatMap((r) => r.subjects))],
    },
    catalog_metadata: {
      source: 'dpul.princeton.edu/mesoamerican',
      records: records.map((r) => ({
        ark: r.arkFull, title: r.title, date: r.date, call_number: r.call, extent: r.extent,
        text_language: r.textLanguage, creators: r.creators, abstract: r.abstract,
        rights: r.rights, catalog: r.catalog, dpul: r.dpul, manifest: r.manifestUrl, canvases: r.canvases.length,
      })),
      scraped_at: now.toISOString(),
    },
    image_source: {
      provider: 'princeton',
      provider_name: 'Princeton University Library',
      source_url: lead.dpul,
      // Two books cut from one record (a volume of a multi-volume manifest) need a
      // discriminator, or the fingerprint gate reads vol. 2 as a duplicate of vol. 1.
      identifier: spec.volume == null ? lead.arkFull : `${lead.arkFull}#vol-${spec.volume + 1}`,
      iiif_manifest: lead.manifestUrl,
      license: NKC,
      license_url: NKC,
      rights: 'No Known Copyright',
      digitized_by: 'Princeton University Library',
      attribution: 'Princeton University Library, Special Collections',
      shelfmark,
      contributing_library: 'Princeton University Library, Special Collections — Garrett-Gates and Princeton Mesoamerican Manuscripts',
      access_date: now,
    },
    shelfmark,
    notes,
    acquisition_campaign: CAMPAIGN,
    status: 'draft',
    ...publication,
    created_at: now,
    updated_at: now,
  }, { importer: 'maya-mss-6559', sourceIdentifier: lead.arkFull, sourceUrl: lead.manifestUrl });

  if (!acquired.inserted) {
    console.log(`  SKIP — ${acquired.reason}: ${acquired.message || ''}`);
    report.push({ key: spec.key, outcome: 'skipped', why: acquired.message });
    continue;
  }

  await db.collection('books').updateOne({ id: bookIdStr }, { $set: { hidden_reason: hiddenReason } });

  // Hold before any page exists, so no lane can see a book with pages and no hold.
  const held = await holdBook(db, bookIdStr, { ...HOLD, source: 'maya-mss-6559' });
  console.log(`  hold: ${held.outcome}`);

  const docs = pages.map((p, i) => {
    const pid = new ObjectId();
    const photo = `${p.svc}/full/full/0/default.jpg`;
    return makePageDoc({
      _id: pid,
      id: pid.toHexString(),
      book_id: bookIdStr,
      page_number: i + 1,
      ...(spec.group ? { part_title: p.record.title, source_ref: p.record.arkFull } : {}),
      ...(p.label ? { page_label: p.label } : {}),
      photo,
      photo_original: photo,
      thumbnail: `${p.svc}/full/200,/0/default.jpg`,
      catalog_metadata: { canvas: p.canvas, label: p.label, manifest: p.record.manifestUrl, ark: p.record.arkFull },
      created_at: now,
      updated_at: now,
    });
  });
  for (let s = 0; s < docs.length; s += 500) await db.collection('pages').insertMany(docs.slice(s, s + 500), { ordered: false });
  const rows = await db.collection('pages').countDocuments({ book_id: bookIdStr });
  console.log(`  inserted ${bookIdStr} (${slug}) + ${rows} pages${rows === pages.length ? '' : ` — MISMATCH, expected ${pages.length}`}`);
  report.push({ key: spec.key, outcome: 'inserted', id: bookIdStr, slug, pages: pages.length, rows, records: records.length });
}

await client.close();
console.log('\n' + JSON.stringify(report, null, 1));
