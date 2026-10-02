#!/usr/bin/env node
// PRIOR ART: scripts/import/derge-tengyur-import.mjs + scripts/lib/derge-tengyur.mjs (#5543) — the
// book / page / image_source shape, insertBookIfNew, hold-before-insert, the checkpoint and
// adopt-the-shell are copied from it. It does not fit as-is because it requires an aligned e-text
// (every volume is measured against the Esukhia Derge text before a page is written); a scans-only
// set has no text to align. scripts/works-catalog/ingest-bdrc.mjs (#2648) catalogues BDRC works but
// creates no books.
//
// bdrc-scans-import — import a BDRC scanned work as one HIDDEN, HELD book per volume, scans only.
//
//   * The volumes are BDRC's own list: `bdo:instanceHasVolume` on the work, each image group's
//     `bdo:volumeNumber` read and checked to run 1..N with no gap, and the manifest's own
//     "volume N" label checked against it.
//   * One page per canvas that carries an image; `photo` is the IIIF image, the folio label ("11a")
//     is kept as `page_label`. No `ocr` is written and NO model is called.
//   * Every book is held (scripts/lib/pipeline-hold.mjs) BEFORE its pages are inserted, so no
//     gap-fill / OCR lane can queue it, and hidden through initialPublication().
//   * Rights are recorded as BDRC states them (admin data `adm:access`, `adm:status`, and whether
//     the record carries a copyright statement); `image_source.license` is `unknown` unless the
//     record states one. No licence is asserted.
//
// Images are archived to R2 separately, by the guarded archiver (book-scoped keys via storagePut):
//   npx tsx scripts/catalog-coverage/archive-acquired.ts --campaign <campaign> --hosts iiif.bdrc.io
//
// Usage (Hetzner; never through a Vercel function):
//   node --env-file=.env.production.local scripts/import/bdrc-scans-import.mjs --work=W4CZ5370 --volumes=1,2          # dry run
//   node --env-file=.env.production.local scripts/import/bdrc-scans-import.mjs --work=W4CZ5370 --volumes=1,2 --apply
//   node --env-file=.env.production.local scripts/import/bdrc-scans-import.mjs --work=W4CZ5370 --all --apply
// Flags: --dir=/root/bdrc-<work>  (turtle + manifest cache, checkpoint.json, book-ids.tsv)
//        --max-disk=85            (refuse to start a volume when / is fuller than this %)
// Resumable: the checkpoint records each finished volume; a book row left without (all) its pages
// by a killed run is adopted by its image group and finished, never duplicated.

import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import { insertBookIfNew } from '../lib/acquire-book.mjs';
import { makePageDoc } from '../lib/book-docs.mjs';
import { holdBook } from '../lib/pipeline-hold.mjs';
import { initialPublication } from '../lib/publication.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { canvasFolioLabel } from '../lib/derge-tengyur.mjs';

/**
 * What a work's books say about themselves. A new BDRC work gets a preset here; everything else
 * (volumes, canvases, rights) is read from BDRC at run time.
 */
const PRESETS = {
  W4CZ5370: {
    instance: 'MW4CZ5370',
    volumes: 108,
    issue: 5664,
    campaign: 'mongol-5664',
    hold: {
      reason: 'mongol-kanjur-import-5664',
      release: 'OCR accuracy on Mongol-script woodblock is measured against a reference (an e-text or a Mongolist) and the OCR/translation run is approved as a separate, priced decision (#5664)',
    },
    language: 'Mongolian',
    year: 1720,
    published: '1718–1720 Beijing xylograph (red ink); reproduction scanned from the collection of Lokesh Chandra',
    place_published: 'Beijing',
    slug: (vol) => `mongolian-kanjur-vol-${vol}`,
    title: (vol, label) => `Mongolian Kanjur, vol. ${vol}${label ? ` (${label})` : ''}`,
    description: (vol, n, ig) => `Volume ${vol} of ${n} of the Mongolian Kanjur (bka' 'gyur, sog yig par ma), the Buddhist canon in Classical Mongolian, printed in red ink from the Beijing blocks of 1718–1720. Scans: BDRC W4CZ5370, image group ${ig}, reproduced from the Mongolian blocks print in the collection of Lokesh Chandra. Not yet transcribed.`,
    note: 'mongol-kanjur-import-5664: imported hidden; licence unsettled (BDRC states AccessOpen, no copyright statement); OCR not approved',
  },
};

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const WORK_ID = String(args.work || '');
const P = PRESETS[WORK_ID];
if (!P) throw new Error(`no preset for --work=${WORK_ID || '(missing)'}; known: ${Object.keys(PRESETS).join(', ')}`);
const DIR = args.dir || `/root/bdrc-${WORK_ID}`;
const APPLY = !!args.apply;
const MAX_DISK = Number(args['max-disk'] || 85);
const IMPORTER = 'script:bdrc-scans-import';

if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing — run with node --env-file=.env.production.local');
fs.mkdirSync(path.join(DIR, 'manifests'), { recursive: true });
const CKPT = path.join(DIR, 'checkpoint.json');
const ckpt = fs.existsSync(CKPT) ? JSON.parse(fs.readFileSync(CKPT, 'utf8')) : { work: WORK_ID, volumes: {} };
const saveCkpt = () => { fs.writeFileSync(`${CKPT}.tmp`, JSON.stringify(ckpt, null, 1)); fs.renameSync(`${CKPT}.tmp`, CKPT); };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function diskPercent() {
  const s = fs.statfsSync('/');
  return Math.round((1 - s.bavail / s.blocks) * 1000) / 10;
}

async function fetchRetry(url, opts = {}, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(60000) });
      if (r.ok) return r;
      if (r.status === 404 || r.status === 403 || i >= tries - 1) throw new Error(`${r.status} ${url}`);
    } catch (e) { if (i >= tries - 1) throw e; }
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
}

async function cached(file, url, accept) {
  const f = path.join(DIR, file);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  const t = await (await fetchRetry(url, accept ? { headers: { Accept: accept } } : {})).text();
  fs.writeFileSync(f, t);
  return t;
}
const turtle = (res) => cached(`${res.replace(/[:/]/g, '_')}.ttl`, `https://purl.bdrc.io/${res}`, 'text/turtle');

/** BDRC's rights statement for the work, as stated — never a licence we infer. */
async function rightsOf() {
  const adm = await turtle(`admindata/${WORK_ID}`);
  const access = adm.match(/adm:access\s+bda:(\w+)/)?.[1] || null;
  const status = adm.match(/adm:status\s+bda:(\w+)/)?.[1] || null;
  const copyright = adm.match(/(?:adm:copyright|bdo:copyright\w*|adm:license)\s+(\S+)/)?.[1] || null;
  return { access, status, copyright };
}

/** The volume list, in BDRC's order, each with its own volumeNumber — checked to run 1..N. */
async function volumeList() {
  const work = await turtle(`resource/${WORK_ID}`);
  const m = work.match(/bdo:instanceHasVolume\s+([^;.]+)[;.]/);
  if (!m) throw new Error(`${WORK_ID}: no bdo:instanceHasVolume`);
  const igs = [...m[1].matchAll(/bdr:(I\w+)/g)].map((x) => x[1]);
  if (igs.length !== P.volumes) throw new Error(`${WORK_ID}: ${igs.length} image groups, preset expects ${P.volumes}`);
  const out = [];
  for (const ig of igs) {
    const t = await turtle(`resource/${ig}`);
    const num = Number(t.match(/bdo:volumeNumber\s+(\d+)/)?.[1]);
    const name = t.match(/bdo:volumeName\s+"([^"]+)"/)?.[1] || null;
    const pagesTotal = Number(t.match(/bdo:volumePagesTotal\s+(\d+)/)?.[1]) || null;
    out.push({ ig, vol: num, name, pagesTotal });
  }
  const nums = out.map((v) => v.vol).sort((a, b) => a - b);
  if (nums.some((n, i) => n !== i + 1)) throw new Error(`${WORK_ID}: volume numbers do not run 1..${P.volumes}: ${nums.join(',')}`);
  return out.sort((a, b) => a.vol - b.vol);
}

async function manifestFor(ig) {
  return JSON.parse(await cached(`manifests/${ig}.json`, `https://iiifpres.bdrc.io/v:bdr:${ig}/manifest`));
}

const imageServiceOf = (canvas) => {
  const id = canvas.images?.[0]?.resource?.service?.['@id'] || canvas.images?.[0]?.resource?.['@id']?.replace(/\/full\/.*$/, '');
  if (!id) throw new Error(`canvas ${canvas['@id']} has no image service`);
  return id;
};

async function importVolume(db, { ig, vol, name }, rights) {
  const v = ckpt.volumes[vol] ||= {};
  if (v.done && !args.redo) { log(`v${vol}: done earlier (${v.book_id}, ${v.pages} pages) — skip`); return v; }
  const disk = diskPercent();
  if (disk >= MAX_DISK) throw new Error(`STOP: / is ${disk}% full (limit ${MAX_DISK}%)`);

  const manifest = await manifestFor(ig);
  const mlabel = (manifest.label || []).find?.((l) => l['@language'] === 'en')?.['@value'] || '';
  if (mlabel !== `volume ${vol}`) throw new Error(`${ig}: manifest label "${mlabel}" is not "volume ${vol}"`);
  // BDRC keeps a placeholder canvas for a leaf it never photographed (no image resource): not a page.
  const allCanvases = manifest.sequences[0].canvases;
  const canvases = allCanvases.filter((c) => c.images?.[0]?.resource);
  v.image_group = ig;
  v.canvases = canvases.length;
  v.missing_images = allCanvases.filter((c) => !c.images?.[0]?.resource).map((c) => (Array.isArray(c.label) ? c.label[0]?.['@value'] : c.label) || c['@id']);
  log(`v${vol} ${ig}: ${canvases.length} canvases${v.missing_images.length ? `, ${v.missing_images.length} without an image` : ''} (disk ${disk}%)`);
  if (!APPLY) { saveCkpt(); return v; }

  const books = db.collection('books');
  const pagesC = db.collection('pages');
  const now = new Date();
  const title = P.title(vol, name);
  const manifestUrl = `https://iiifpres.bdrc.io/v:bdr:${ig}/manifest`;
  const rightsNote = `As stated by BDRC (admin data ${WORK_ID}, read ${now.toISOString().slice(0, 10)}): adm:access ${rights.access || 'not stated'}, adm:status ${rights.status || 'not stated'}; copyright ${rights.copyright || 'NOT STATED on the record'}. No licence asserted by Source Library.`;

  // Adopt a book an earlier run created (by its image group), else create it through the gate.
  let book = await books.findOne({ 'image_source.provider': 'bdrc', 'image_source.identifier': ig }, { projection: { id: 1 } });
  if (!book) {
    const _id = new ObjectId();
    // hidden_reason is not on makeBookDoc's whitelist (#3969); written right after the insert, as
    // derge-tengyur-import.mjs does, from the same initialPublication() result.
    const { hidden_reason: hiddenReason, ...publication } = initialPublication({ state: 'hidden', reason: 'curation', note: P.note, by: IMPORTER, issue: P.issue, now });
    const r = await insertBookIfNew(db, {
      _id: String(_id), id: String(_id),
      slug: P.slug(vol),
      title, display_title: title, author: '',
      language: P.language, languages: [P.language],
      year: P.year,
      published: P.published,
      place_published: P.place_published,
      content_type: 'book',
      description: P.description(vol, P.volumes, ig),
      pages_count: canvases.length, pages_ocr: 0, pages_translated: 0, pages_archived: 0,
      status: 'draft',
      ...publication,
      image_source: {
        provider: 'bdrc',
        provider_name: 'Buddhist Digital Resource Center (BDRC)',
        identifier: ig,
        iiif_manifest: manifestUrl,
        source_url: `https://library.bdrc.io/show/bdr:${P.instance}`,
        license: rights.copyright || 'unknown',
        rights_note: rightsNote,
        access_date: now.toISOString(),
        contributing_library: 'Buddhist Digital Resource Center',
      },
      held_by: ['bdrc'],
      contributing_library: 'Buddhist Digital Resource Center',
      dublin_core: { dc_identifier: [`IIIF:${ig}`], dc_source: `https://library.bdrc.io/show/bdr:${P.instance}`, dc_publisher: 'BDRC' },
      catalog_ids: { bdrc_instance: P.instance, bdrc_scans: WORK_ID, bdrc_image_group: ig, bdrc_volume: vol },
      catalog_metadata: { source: 'bdrc_iiif', manifest_label: manifest.label, bdrc_rights: rights },
      acquisition_campaign: P.campaign,
      notes: `Imported by scripts/import/bdrc-scans-import.mjs (#${P.issue}): scans only, no text. Held: OCR not approved. Hidden: licence unsettled.`,
      created_at: now, updated_at: now,
    }, { importer: IMPORTER, sourceIdentifier: `bdrc:${ig}`, sourceUrl: manifestUrl });
    if (!r.inserted) { v.refused_book = r.message; saveCkpt(); log(`v${vol}: acquisition gate declined — ${r.message}`); return v; }
    book = { id: r.bookId };
    await books.updateOne({ id: book.id }, { $set: { hidden_reason: hiddenReason } });
    log(`v${vol}: created ${book.id}`);
  } else {
    log(`v${vol}: adopting ${book.id} from an earlier run`);
  }
  v.book_id = book.id;
  // Hold BEFORE any page exists, so no lane can see an enrollable book with pages.
  const h = await holdBook(db, book.id, { ...P.hold, issue: P.issue, source: IMPORTER, detail: { volume: vol, image_group: ig } });
  if (!['held', 'already_held'].includes(h.outcome)) throw new Error(`v${vol}: hold failed (${h.outcome}) — refusing to insert pages`);

  const existing = new Set((await pagesC.find({ book_id: book.id }, { projection: { page_number: 1 } }).toArray()).map((p) => p.page_number));
  const toInsert = [];
  for (let i = 0; i < canvases.length; i++) {
    if (existing.has(i + 1)) continue;
    const c = canvases[i];
    const service = imageServiceOf(c);
    const photo = `${service}/full/max/0/default.jpg`;
    const folio = canvasFolioLabel(c);
    const _id = new ObjectId();
    toInsert.push(makePageDoc({
      _id: String(_id), id: String(_id), book_id: book.id, page_number: i + 1,
      page_label: folio ? `f. ${folio}` : null,
      source_ref: service.replace(/^https:\/\/iiif\.bdrc\.io\//, ''),
      photo, photo_original: photo,
      image_width: c.width, image_height: c.height,
      catalog_metadata: { source: 'bdrc_iiif', canvas: c['@id'], label: c.label },
      created_at: now, updated_at: now,
    }));
  }
  for (let k = 0; k < toInsert.length; k += 500) await pagesC.insertMany(toInsert.slice(k, k + 500), { ordered: false });
  const nPages = await pagesC.countDocuments({ book_id: book.id });
  if (nPages !== canvases.length) throw new Error(`v${vol}: ${nPages} pages in Mongo, manifest has ${canvases.length} image canvases`);
  await recountBook(db, book.id, { reason: IMPORTER });
  delete v.error;
  Object.assign(v, { done: true, pages: nPages, inserted_now: toInsert.length, finished_at: new Date().toISOString() });
  saveCkpt();
  fs.appendFileSync(path.join(DIR, 'book-ids.tsv'), `${vol}\t${ig}\t${book.id}\t${nPages}\n`);
  log(`v${vol}: ${nPages} pages (${toInsert.length} inserted now)`);
  return v;
}

const vols = await volumeList();
let want;
if (args.all) want = vols;
else if (args.volumes) { const s = new Set(String(args.volumes).split(',').map(Number)); want = vols.filter((v) => s.has(v.vol)); }
else throw new Error('pass --volumes=1,2 or --all');
const rights = await rightsOf();
log(`${WORK_ID}: ${vols.length} volumes; rights as stated: ${JSON.stringify(rights)}; ${APPLY ? 'APPLY' : 'dry run'}`);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
try {
  for (const v of want) {
    try { await importVolume(db, v, rights); }
    catch (e) {
      log(`v${v.vol}: ERROR ${e.message}`);
      (ckpt.volumes[v.vol] ||= {}).error = String(e.message).slice(0, 500);
      saveCkpt();
      if (String(e.message).startsWith('STOP:') || args['stop-on-error']) throw e;
    }
  }
} finally {
  await client.close();
}
const vs = Object.values(ckpt.volumes);
log(`checkpoint: ${vs.filter((x) => x.done).length}/${vols.length} done, ${vs.reduce((a, x) => a + (x.pages || 0), 0)} pages, ${vs.filter((x) => x.error && !x.done).length} errors, ${vs.filter((x) => x.refused_book).length} declined by the gate`);
