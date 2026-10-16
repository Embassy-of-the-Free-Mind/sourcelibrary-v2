#!/usr/bin/env node
/**
 * Maya manuscripts from Penn's Berendt-Brinton collection (Ms. Coll. 700), from a
 * LOCAL OPenn download (#6559).
 *
 * PRIOR ART: scripts/import/maya-mss-6559.mjs — the Princeton half of the same
 * campaign; it builds pages that point at a IIIF service, and Penn has none to point
 * at from here (OPenn refuses our Hetzner boxes, so maya-mss-6559 could not fetch
 * these seven). This script keeps its guards and its metadata shape, and reads a
 * folder instead: the OPenn "web" derivatives (about 1326x1800) and the item's own
 * TEI, downloaded on a laptop and copied to this box. The R2 write is the shape of
 * scripts/import/chilam-balam-calkini-byu.mjs (validateR2Key + assertBookScopedKey).
 *
 * WHAT IT IMPORTS: only items whose TEI <licence> is the Creative Commons Public
 * Domain Mark. The licence is re-read from every TEI and anything else is refused,
 * so an item cannot slip in by being added to the list.
 *
 * PAGES: one page per OPenn surface, in OPenn file order (the NNNN in
 * `<id>_NNNN_web.jpg`), checked against the TEI <facsimile> order; `page_label` is
 * the surface name ("Front cover", "iii", "12v"). Each image is written to R2 as
 * `pages/<book_id>/NNNN.jpg`, with a 200px thumbnail at `pages/<book_id>/NNNN-thumb.jpg`.
 * These are OPenn's web derivatives, NOT the masters: the TIFF masters (about 54 MB
 * each) stay at Penn, and every page records its master's URL in
 * `archive_metadata.master_url`, so a full-resolution upgrade is possible later.
 * `archived_photo` is set to the R2 copy so the campaign archiver does not try
 * (and fail) to fetch from OPenn.
 *
 * LANDS: hidden (publication `hidden`/`unprocessed`), tagged
 * `acquisition_campaign: maya-mss-6559`, and HELD with reason `maya-mss-6559`
 * BEFORE any page row exists.
 *
 *   node --env-file=.env.production.local scripts/import/maya-mss-penn-6559.mjs \
 *     --dir=/mnt/HC_Volume_105839809/imports/penn-maya-6559 [--dry-run] [--only=<item>]
 *
 * Idempotent: insertBookIfNew() declines an item already held (identifier = the
 * Penn call number).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { makePageDoc } from '../lib/book-docs.mjs';
import { insertBookIfNew } from '../lib/acquire-book.mjs';
import { holdBook, isHeld } from '../lib/pipeline-hold.mjs';
import { initialPublication } from '../lib/publication.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { validateR2Key, assertBookScopedKey } from '../lib/r2-key.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
const DIR = arg('dir');
const ONLY = arg('only');
// A book whose insert and hold landed but whose pages did not (a run that died
// mid-upload). Reused, after checking it is this item's and has no pages.
const RESUME_BOOK = arg('resume-book');
// Re-upload pages that were imported from a truncated download, once a complete
// file is back in --dir. Writes NNNN.jpg and repoints the page.
const REPAIR = process.argv.includes('--repair');
if (!DIR) { console.error('--dir=<local OPenn download> is required'); process.exit(1); }
if (RESUME_BOOK && !ONLY) { console.error('--resume-book needs --only=<item>'); process.exit(1); }

const CAMPAIGN = 'maya-mss-6559';
const ISSUE = 6559;
const PDM = 'http://creativecommons.org/publicdomain/mark/1.0/';
const OPENN = 'https://openn.library.upenn.edu/Data/0002';
const HOLD = {
  reason: CAMPAIGN,
  issue: ISSUE,
  release: 'Opus OCR of the book is done (claude-ocr.mjs, maya-ref-opus-6559 recipe, #6559) and Derek has chosen its translation lane; release with --to ocr_complete only then',
};
const COLLECTIONS = ['maya', 'mesoamerican', 'americas'];
const BERENDT_PROVENANCE = 'Part of the Berendt-Brinton Linguistic Collection: the papers of C. Hermann Berendt (1817–1878), later acquired by Daniel Garrison Brinton (1837–1899), and from him the University of Pennsylvania.';
const THUMB_WIDTH = 200;

/** Titles, authors and languages follow the item's TEI; see each note. */
const BOOKS = [
  {
    item: 42,
    title: 'Lengua maya, vol. 1',
    display_title: "Lengua maya, vol. 1: C. Hermann Berendt's notebook of Mayan vocabularies and texts, 1864–1868",
    author: 'C. Hermann Berendt',
    language: 'Spanish',
    languages: ['Spanish', 'Yucatec Maya', "Ch'ol", 'Itzá', 'Kaqchikel', 'Nahuatl', 'Otomi', 'French', 'German', 'Latin'],
    published: '1864-1868',
    notes: [
      'The first of three notebooks in which C. Hermann Berendt copied documents on the Mayan languages (vols. 2 and 3 are Ms. Coll. 700 Items 43 and 44). Eighteen numbered entries with Berendt\'s table of contents: vocabularies (Waldeck\'s Maya vocabulary corrected from Beltrán, Petén Itzá, Chol "Putum", Kaqchikel, Nahuatl and Otomi) and texts, especially on the Catholic sacraments, each with his notes on sources.',
      'Entry 17 is a pasted clipping of a printed broadside: an imperial proclamation of November 1864 to the chiefs and people of Chan Santa Cruz ("Jefes y habitantes de Chan Santa Cruz…"), in Spanish and Maya on facing pages. Entry 18 is a clipping headed "Indios mayas" from the Diario del Imperio.',
      'Written in Providence, R.I., in 1864 and continued at Sacluc, Guatemala (1867) and Mérida (1868). Penn records the main language as Spanish.',
    ],
  },
  {
    item: 43,
    title: 'Lengua maya, vol. 2',
    display_title: "Lengua maya, vol. 2: Berendt's copies from the Pío Pérez papers and the Books of Chilam Balam, with the Chicxulub chronicle, 1868",
    author: 'C. Hermann Berendt; Juan Pío Pérez',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1868',
    notes: [
      'The second of Berendt\'s three "Lengua maya" notebooks (Ms. Coll. 700 Items 42–44), written in Mérida in 1868. Ten entries copied from documents in the collection of Juan Pío Pérez and from the Books of Chilam Balam: histories, prophecies and the reckoning of time. Entry 1 begins with the Maya and a Spanish translation on facing pages.',
      'Entry 4 is the land title and chronicle of Chicxulub, entirely in Maya; Berendt notes that the original was in the village archive of Chicxulub, and that a copy with a Spanish translation by Manuel Encarnación Avila belonged to Pedro Regil y Peón. It ends with lists of the conquistadors\' names. Entry 9 is a Maya version of the Historia de la doncella Teodor.',
      'Berendt marks corrections and comparisons in red ink and other notes in blue. On p. 221 he corrects a shift of 300 years that he says Pío Pérez introduced, so that Pérez\'s "2003" should read 1703.',
    ],
  },
  {
    item: 44,
    title: 'Lengua maya, vol. 3',
    display_title: "Lengua maya, vol. 3: Berendt's copies of Maya history, calendar and texts, with the Maní chronicle and the 1850 Caste War peace proposals, 1870",
    author: 'C. Hermann Berendt; Juan Pío Pérez',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish', 'French'],
    published: '1870',
    notes: [
      'The third of Berendt\'s three "Lengua maya" notebooks (Ms. Coll. 700 Items 42–44), written in Mérida in 1870: copies of Maya texts on history, astrology and the calendar.',
      'Entries include a zodiacal almanac; fragments of biblical stories; a history of Yucatán from the Códice Pérez, copied from the Chilam Balam of Maní, with the corresponding Tizimín text on facing pages (dates 1522–1611); a table of Maya years against the Christian era; the poem "Yacunah Cay" (Canto de amor); the land title of Acineh Cheltun (1677–1769); a governor\'s order of 1803 on the mail; an invocation to the sun; two prayers; and, as entry 11, the peace proposals made by the rebel Maya leaders (Florentino Chan, Venancio Pec, Bonifacio Novelo) in an 1850 letter to the priest José Antonio García of Chemax, copied from Crescencio Carrillo\'s collection of Caste War papers.',
    ],
  },
  {
    item: 49,
    title: 'Chilam Balam (Berendt facsimiles of Chumayel and Tizimín)',
    display_title: "Chilam Balam: Berendt's manuscript facsimiles of the Books of Chumayel and Tizimín, with Kaua and Ixil excerpts, 1868–1870",
    author: 'C. Hermann Berendt (copyist)',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1868-1870',
    notes: [
      'Berendt\'s manuscript facsimiles of sections of the Books of Chilam Balam of Chumayel and of Tizimín, with excerpts from those of Kaua and Ixil, focusing on calendrical and historical matter; dates in the texts run from 1513 to 1824. Brief introductions are in Spanish.',
      'Copied in Mérida in 1868 and 1870. Five items are laid in: a diagram between pp. 38 and 39, and notes inside the back cover.',
    ],
  },
  {
    item: 50,
    title: 'Chilam Balam (Códice Pérez)',
    display_title: "Chilam Balam (Códice Pérez): Berendt's facsimile of Juan Pío Pérez's collection of Chilam Balam extracts, 1870",
    author: 'Juan Pío Pérez (collector); C. Hermann Berendt (copyist)',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1870',
    notes: [
      'Berendt\'s manuscript facsimile of the collection Juan Pío Pérez made at Ticul from the Books of Chilam Balam, mainly calendrical and historical; dates in the texts run from 1511 to "2003" (Pérez\'s 300-year shift; see Lengua maya vol. 2). An appendix holds Maya legal documents, some with Spanish translations.',
      'Copied in Mérida in 1870. The half-title and spine call it "Códice Perez". Eight leaves once laid in (one a printed calendar table) are in a separate folder at Penn.',
    ],
  },
  {
    item: 221,
    title: 'Manuscrito cakchiquel ó sea memorial de Tecpan-Atitlan (Solola)',
    display_title: 'Memorial de Tecpán-Atitlán (Memorial de Sololá, the "Annals of the Cakchiquels"), Kaqchikel manuscript, ca. 1619–1650',
    author: 'Francisco Hernández Arana Xajilá; Francisco Díaz Gebuta Quej; and the Xajil family',
    language: 'Kaqchikel',
    languages: ['Kaqchikel', 'Spanish'],
    published: '1619-1650',
    notes: [
      'An early 17th-century transcription in Kaqchikel of the documents of the Xajil family of the Kaqchikel people, whose capital had been Iximché (Tecpán) and who later lived at Sololá. Pp. 1–17 record village and family events, 1586–1619: births, baptisms, marriages, disputes and contributions. Pp. 18–96 are the chronicle of the Kaqchikel from their legendary beginnings at Tulan into the early 17th century, with their relations to the Tz\'utujil and K\'iche\'; the internal revolt at Iximché in the late 15th century (p. 48) becomes the epoch from which later events are dated, and the arrival of the Spanish in 1524 is reported on p. 56. The last pages (92–96) are by Don Pedro Elías Martín, governor from 1584, and run to 1596. The manuscript is a fragment and ends abruptly.',
      'The Spanish title page is Brasseur de Bourbourg\'s, added after he took the manuscript into his possession around 1855 (his bookplate is on it). Later owned by Daniel Garrison Brinton (ex libris stamps). Penn dates the transcription between 1619 (p. 15) and 1650 (Brinton), probably at Sololá.',
    ],
  },
  {
    item: 241,
    title: 'Literatura de la lengua maya (Berendt papers, with the Título de tierras de Chacxulubchen)',
    display_title: "Literatura de la lengua maya: Berendt's papers on Maya, with his copy of the Título de tierras del pueblo de Chacxulubchen (Chicxulub), ca. 1868–1871",
    author: 'C. Hermann Berendt',
    language: 'Spanish',
    languages: ['Spanish', 'Yucatec Maya', 'German', 'English'],
    published: '1868-1871',
    notes: [
      'A folder of Berendt\'s drafts and loose notes on the Maya language, kept in a cardboard folder he labelled "Literatura de la lengua maya" (the cover is scanned). Penn records it as predominantly Spanish, with Maya vocabulary, some German and a little English.',
      'It holds a 12-leaf booklet, "Titulo de tierras del pueblo de Chacxulubchen (hoy Chicxulub), traduccion verbal por D. Man. Encarnación Avila", copied by Berendt in Mérida in 1868 (another copy is in Lengua maya vol. 2, Ms. Coll. 700 Item 43); about six leaves of drafts of his preface to his copy of the Diccionario maya-español del Convento de San Francisco de Mérida, with the first two pages of entries and notes on the copy of the cura Meneses; German notes on the Indians of eastern Mexico to the Isthmus of Tehuantepec; nine leaves on Juan Pío Pérez\'s Diccionario español-maya de Ticul; and an outline of a bibliography of the Mayan languages.',
      'No Brinton ex libris; transferred with the Brinton Library from the Penn Museum Library.',
    ],
  },
];

// ── TEI ────────────────────────────────────────────────────────────────
const unent = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const text = (s) => unent(String(s).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const one = (xml, re) => { const m = xml.match(re); return m ? text(m[1]) : null; };
const many = (xml, re) => [...xml.matchAll(re)].map((m) => text(m[1]));

function readTei(item) {
  const file = path.join(DIR, `item${item}`, `mscoll700_item${item}_TEI.xml`);
  const xml = readFileSync(file, 'utf8');
  const licences = [...xml.matchAll(/<licence target="([^"]+)">([\s\S]*?)<\/licence>/g)].map((m) => ({ target: m[1], text: text(m[2]) }));
  const imageLicence = licences.find((l) => /These images/.test(l.text)) || licences[0];
  if (!imageLicence || imageLicence.target !== PDM) {
    throw new Error(`item ${item}: image licence is ${imageLicence?.target || 'missing'}, not the Public Domain Mark — refusing`);
  }
  const msItem = (xml.match(/<msItem>([\s\S]*?)<\/msItem>/) || [])[1] || '';
  const textLang = xml.match(/<textLang mainLang="([^"]*)"(?: otherLangs="([^"]*)")?>([\s\S]*?)<\/textLang>/);
  const surfaces = [...xml.matchAll(/<surface n="([^"]*)"[^>]*>([\s\S]*?)<\/surface>/g)].map((m) => ({
    label: unent(m[1]),
    web: (m[2].match(/url="(web\/[^"]+)"/) || [])[1],
    master: (m[2].match(/url="(master\/[^"]+)"/) || [])[1],
    masterSize: (() => { const g = m[2].match(/<graphic height="(\d+)px" url="master\/[^"]+" width="(\d+)px"/); return g ? { width: +g[2], height: +g[1] } : null; })(),
  }));
  return {
    file,
    teiTitle: one(xml, /<titleStmt>\s*<title>([\s\S]*?)<\/title>/),
    titles: many(msItem, /<title>([\s\S]*?)<\/title>/g),
    authors: many(msItem, /<author>\s*<persName[^>]*>([\s\S]*?)<\/persName>/g),
    call: one(xml, /<idno type="call-number">([\s\S]*?)<\/idno>/),
    bibid: one(xml, /<altIdentifier type="bibid">\s*<idno>([\s\S]*?)<\/idno>/),
    oclc: one(xml, /<altIdentifier type="oclc">\s*<idno>([\s\S]*?)<\/idno>/),
    handle: one(xml, /<altIdentifier type="resource">\s*<idno>([\s\S]*?)<\/idno>/),
    summary: one(xml, /<summary>([\s\S]*?)<\/summary>/),
    mainLang: textLang?.[1] || null,
    otherLangs: textLang?.[2] || null,
    langNote: textLang ? text(textLang[3]) : null,
    origDate: one(xml, /<origDate>([\s\S]*?)<\/origDate>/),
    origPlace: many(xml, /<origPlace>([\s\S]*?)<\/origPlace>/g),
    origin: one(xml, /<origin>\s*<p>([\s\S]*?)<\/p>/),
    provenance: many(xml, /<provenance>([\s\S]*?)<\/provenance>/g),
    extent: one(xml, /<extent>([\s\S]*?)<\/extent>/),
    foliation: one(xml, /<foliation>([\s\S]*?)<\/foliation>/),
    subjects: many(xml, /<term>([\s\S]*?)<\/term>/g),
    imageLicence,
    metadataLicence: licences.find((l) => l !== imageLicence) || null,
    surfaces,
  };
}

/** Local files in OPenn order, checked one-to-one against the TEI surfaces. */
function pagePlan(item, tei) {
  const dir = path.join(DIR, `item${item}`, 'web');
  const files = readdirSync(dir).filter((f) => /_\d{4}_web\.jpg$/.test(f))
    .sort((a, b) => Number(a.match(/_(\d{4})_web/)[1]) - Number(b.match(/_(\d{4})_web/)[1]));
  if (files.length !== tei.surfaces.length) throw new Error(`item ${item}: ${files.length} files but ${tei.surfaces.length} TEI surfaces`);
  return files.map((f, i) => {
    const s = tei.surfaces[i];
    if (s.web !== `web/${f}`) throw new Error(`item ${item}: file ${i + 1} is ${f} but TEI surface ${i + 1} is ${s.web}`);
    const file = path.join(dir, f);
    return { file, name: f, label: s.label, master: s.master, masterSize: s.masterSize, truncated: isTruncated(file) };
  });
}

/**
 * A JPEG with no end-of-image marker is a cut-off download. Its header is valid,
 * so a "verified JPEG" check by magic bytes passes it; it decodes as the top of
 * the page and grey below. 14 of the 1,358 files copied here were like that.
 */
function isTruncated(file) {
  const b = readFileSync(file);
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  return !(end >= 2 && b[end - 2] === 0xff && b[end - 1] === 0xd9);
}

// ── R2 ─────────────────────────────────────────────────────────────────
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

async function put(key, body, bookId) {
  // Both guards: an undefined segment, and a well-formed key that is not this
  // book's — the shape that fed 300 books each other's pages (#3362).
  validateR2Key(key, 'maya-mss-penn-6559');
  assertBookScopedKey(key, bookId, 'maya-mss-penn-6559');
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET, Key: key, Body: body, ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      return `${PUBLIC}/${key}`;
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 2000 * i)); }
  }
  throw last;
}

const thumb = (body) => sharp(body, { failOn: 'none' }).resize({ width: THUMB_WIDTH }).jpeg({ quality: 80 }).toBuffer();

/** The campaign hold, plus a repair step for a book imported with truncated images. */
function holdFor(plan) {
  const bad = plan.flatMap((p, i) => (p.truncated ? [i + 1] : []));
  if (!bad.length) return HOLD;
  return {
    ...HOLD,
    release: `First replace the ${bad.length} page image(s) imported from a truncated download (pages ${bad.join(', ')}; archive_metadata.truncated_download): re-download them from OPenn and run scripts/import/maya-mss-penn-6559.mjs --repair. Then: ${HOLD.release}`,
    detail: { truncated_pages: bad },
  };
}

/** Upload the complete file for every page still marked truncated_download. */
async function repair(tei, plan, itemUrl) {
  const book = await db.collection('books').findOne({ 'image_source.identifier': tei.call, acquisition_campaign: CAMPAIGN }, { projection: { id: 1, pipeline_auto: 1 } });
  if (!book) return { outcome: 'repair_no_book' };
  const pages = await db.collection('pages').find({ book_id: book.id, 'archive_metadata.truncated_download': { $exists: true } }, { projection: { id: 1, page_number: 1 } }).toArray();
  let fixed = 0;
  for (const pg of pages) {
    const p = plan[pg.page_number - 1];
    if (!p || p.truncated) { console.log(`  p.${pg.page_number}: local file still truncated`); continue; }
    const body = readFileSync(p.file);
    const meta = await sharp(body).metadata();
    const num = String(pg.page_number).padStart(4, '0');
    const [url, thumbUrl] = await Promise.all([
      put(`pages/${book.id}/${num}.jpg`, body, book.id),
      put(`pages/${book.id}/${num}-thumb.jpg`, await thumb(body), book.id),
    ]);
    await db.collection('pages').updateOne({ id: pg.id }, {
      $set: { photo: url, archived_photo: url, display_photo: url, thumbnail: thumbUrl, image_thumb: thumbUrl, image_width: meta.width, image_height: meta.height, 'archive_metadata.repaired_at': new Date(), updated_at: new Date() },
      $unset: { 'archive_metadata.truncated_download': '' },
    });
    fixed++;
  }
  const left = await db.collection('pages').countDocuments({ book_id: book.id, 'archive_metadata.truncated_download': { $exists: true } });
  if (!left && book.pipeline_auto?.hold?.detail?.truncated_pages) {
    await db.collection('books').updateOne({ id: book.id }, { $set: { 'pipeline_auto.hold.release': HOLD.release, 'pipeline_auto.hold.detail': null, updated_at: new Date() } });
  }
  console.log(`  repaired ${fixed}, ${left} still truncated`);
  return { outcome: 'repaired', id: book.id, fixed, left };
}

// ── Run ────────────────────────────────────────────────────────────────
const client = DRY_RUN && !REPAIR ? null : new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
if (client) await client.connect();
const db = client?.db('bookstore');
const report = [];

for (const spec of BOOKS.filter((b) => !ONLY || String(b.item) === ONLY)) {
  console.log(`\n=== item ${spec.item}`);
  let tei, plan;
  try {
    tei = readTei(spec.item);
    plan = pagePlan(spec.item, tei);
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    report.push({ item: spec.item, outcome: 'failed', why: e.message });
    continue;
  }
  const itemUrl = `${OPENN}/mscoll700_item${spec.item}/`;
  console.log(`  ${tei.call}: "${tei.titles.join(' / ')}", ${tei.origDate}, mainLang ${tei.mainLang}; ${plan.length} pages; licence PDM`);
  const truncated = plan.filter((p) => p.truncated);
  if (truncated.length) console.log(`  ${truncated.length} truncated download(s): ${truncated.map((p) => p.name).join(', ')}`);
  if (REPAIR) {
    report.push({ item: spec.item, ...(await repair(tei, plan, itemUrl)) });
    continue;
  }
  if (DRY_RUN) {
    console.log(`    pages: ${plan[0].label} … ${plan[plan.length - 1].label}`);
    report.push({ item: spec.item, outcome: 'dry_run', pages: plan.length });
    continue;
  }

  const now = new Date();
  const hold = holdFor(plan);
  let bookIdStr;
  let slug = RESUME_BOOK || null;
  if (RESUME_BOOK) {
    const b = await db.collection('books').findOne({ id: RESUME_BOOK }, { projection: { id: 1, acquisition_campaign: 1, image_source: 1, pipeline_auto: 1 } });
    if (!b || b.image_source?.identifier !== tei.call || b.acquisition_campaign !== CAMPAIGN || !isHeld(b)) {
      throw new Error(`--resume-book ${RESUME_BOOK} is not a held ${CAMPAIGN} book for ${tei.call}`);
    }
    const existing = await db.collection('pages').countDocuments({ book_id: RESUME_BOOK });
    if (existing) throw new Error(`--resume-book ${RESUME_BOOK} already has ${existing} pages`);
    bookIdStr = RESUME_BOOK;
    await db.collection('books').updateOne({ id: bookIdStr }, { $set: { 'pipeline_auto.hold.release': hold.release, 'pipeline_auto.hold.detail': hold.detail ?? null, updated_at: now } });
    console.log(`  resuming ${bookIdStr} (held, no pages)`);
  } else {
    const bookId = new ObjectId();
    bookIdStr = bookId.toHexString();
    const base = `penn-mscoll700-item${spec.item}`;
    slug = base;
    for (let i = 2; await db.collection('books').findOne({ slug }, { projection: { _id: 1 } }); i++) slug = `${base}-${i}`;
    const shelfmark = `University of Pennsylvania, Kislak Center (Rare Book & Manuscript Library), ${tei.call}`;
    const notes = [
      ...spec.notes,
      `Penn's catalogue title: "${tei.titles.map((t) => t.replace(/\s*:$/, '')).join(' : ')}".`,
      BERENDT_PROVENANCE,
      'Images: OPenn web derivatives (about 1326 × 1800 px). The full-resolution TIFF masters are on OPenn (each page records its master\'s URL); a full-resolution upgrade is available.',
      'Rights: Penn states that these images and their content are free of known copyright restrictions and in the public domain (Creative Commons Public Domain Mark 1.0). Penn\'s catalogue description is CC BY 4.0, © University of Pennsylvania Libraries.',
    ].join(' ');

    const { hidden_reason: hiddenReason, ...publication } = initialPublication({ state: 'hidden', reason: 'unprocessed', note: `maya-mss-6559: held for the Opus lane (#${ISSUE})`, by: 'script:maya-mss-penn-6559', issue: ISSUE, now });
    const acquired = await insertBookIfNew(db, {
      _id: bookId,
      id: bookIdStr,
      slug,
      title: spec.title,
      display_title: spec.display_title,
      author: spec.author,
      language: spec.language,
      original_language: spec.language,
      languages: spec.languages,
      language_multi: true,
      field_provenance: { language: 'caller' },
      text_role: 'original',
      published: spec.published,
      categories: [],
      collections: COLLECTIONS,
      pages_count: plan.length,
      pages_ocr: 0,
      pages_translated: 0,
      pages_archived: 0,
      needs_splitting: false,
      page_count_source: 'openn_tei',
      dublin_core: {
        dc_identifier: [tei.call, tei.handle, tei.oclc, itemUrl].filter(Boolean),
        dc_source: itemUrl,
        dc_date: [tei.origDate].filter(Boolean),
        ...(tei.summary ? { dc_description: tei.summary } : {}),
        dc_subject: [...new Set(tei.subjects)],
      },
      catalog_metadata: {
        source: 'openn.library.upenn.edu (TEI)',
        tei: {
          title: tei.teiTitle, titles: tei.titles, authors: tei.authors, call_number: tei.call,
          bibid: tei.bibid, oclc: tei.oclc, handle: tei.handle, summary: tei.summary,
          main_lang: tei.mainLang, other_langs: tei.otherLangs, language_note: tei.langNote,
          orig_date: tei.origDate, orig_place: tei.origPlace, origin: tei.origin,
          provenance: tei.provenance, extent: tei.extent, foliation: tei.foliation,
          image_licence: tei.imageLicence, metadata_licence: tei.metadataLicence, surfaces: tei.surfaces.length,
        },
        tei_url: `${itemUrl}data/mscoll700_item${spec.item}_TEI.xml`,
        scraped_at: now.toISOString(),
      },
      image_source: {
        provider: 'penn',
        provider_name: 'University of Pennsylvania Libraries (OPenn)',
        source_url: itemUrl,
        identifier: tei.call,
        license: PDM,
        license_url: PDM,
        rights: 'Public Domain Mark 1.0 (free of known copyright restrictions)',
        digitized_by: 'University of Pennsylvania Libraries',
        attribution: 'Kislak Center for Special Collections, Rare Books and Manuscripts, University of Pennsylvania',
        shelfmark,
        contributing_library: 'University of Pennsylvania Libraries — Berendt-Brinton Linguistic Collection (Ms. Coll. 700)',
        image_variant: 'openn_web',
        full_resolution_available: `${itemUrl}data/master/`,
        access_date: now,
      },
      shelfmark,
      notes,
      acquisition_campaign: CAMPAIGN,
      status: 'draft',
      ...publication,
      created_at: now,
      updated_at: now,
    }, { importer: 'maya-mss-penn-6559', sourceIdentifier: tei.call, sourceUrl: itemUrl });

    if (!acquired.inserted) {
      console.log(`  SKIP — ${acquired.reason}: ${acquired.message || ''}`);
      report.push({ item: spec.item, outcome: 'skipped', why: acquired.message });
      continue;
    }
    await db.collection('books').updateOne({ id: bookIdStr }, { $set: { hidden_reason: hiddenReason } });

    // Hold before any page exists, so no lane can see a book with pages and no hold.
    const held = await holdBook(db, bookIdStr, { ...hold, source: 'maya-mss-penn-6559' });
    console.log(`  hold: ${held.outcome}`);
    if (held.outcome !== 'held') throw new Error(`${bookIdStr}: hold ${held.outcome}; refusing to write pages`);
  }

  const docs = [];
  for (const [i, p] of plan.entries()) {
    const num = String(i + 1).padStart(4, '0');
    const body = readFileSync(p.file);
    const meta = await sharp(body).metadata();
    if (meta.format !== 'jpeg') throw new Error(`${p.file}: not a JPEG (${meta.format})`);
    // A truncated download is stored under its own `-partial` keys, so the
    // complete file can later go to NNNN.jpg without fighting the immutable
    // cache on a key that once held the partial image.
    const suffix = p.truncated ? '-partial' : '';
    const [url, thumbUrl] = await Promise.all([
      put(`pages/${bookIdStr}/${num}${suffix}.jpg`, body, bookIdStr),
      put(`pages/${bookIdStr}/${num}${suffix}-thumb.jpg`, await thumb(body), bookIdStr),
    ]);
    const pid = new ObjectId();
    docs.push(makePageDoc({
      _id: pid,
      id: pid.toHexString(),
      book_id: bookIdStr,
      page_number: i + 1,
      page_label: p.label,
      photo: url,
      archived_photo: url,
      display_photo: url,
      photo_original: `${itemUrl}data/web/${p.name}`,
      thumbnail: thumbUrl,
      image_thumb: thumbUrl,
      image_width: meta.width,
      image_height: meta.height,
      archive_metadata: {
        source: 'openn_web_local',
        variant: 'web derivative, not the master',
        master_url: p.master ? `${itemUrl}data/${p.master}` : null,
        master_width: p.masterSize?.width ?? null,
        master_height: p.masterSize?.height ?? null,
        archived_at: now,
        ...(p.truncated ? { truncated_download: { bytes: body.length, note: 'local copy was cut off; the image shows only the top of the page. Re-download photo_original and run maya-mss-penn-6559.mjs --repair' } } : {}),
      },
      created_at: now,
      updated_at: now,
    }));
    process.stdout.write(`\r  uploaded ${i + 1}/${plan.length}   `);
  }
  process.stdout.write('\n');
  await db.collection('pages').insertMany(docs, { ordered: false });
  await db.collection('books').updateOne({ id: bookIdStr }, { $set: { thumbnail: docs[0].thumbnail } });
  await recountBook(db, bookIdStr, { reason: 'maya-mss-penn-6559 import' });
  const rows = await db.collection('pages').countDocuments({ book_id: bookIdStr });
  console.log(`  inserted ${bookIdStr} (${slug}) + ${rows} pages${rows === plan.length ? '' : ` — MISMATCH, expected ${plan.length}`}`);
  report.push({ item: spec.item, outcome: 'inserted', id: bookIdStr, slug, pages: plan.length, rows });
}

if (client) await client.close();
console.log('\n' + JSON.stringify(report, null, 1));
