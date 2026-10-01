#!/usr/bin/env node
// PRIOR ART: scripts/works-catalog/ingest-bdrc.mjs (#2648) catalogues BDRC works but creates no
// books and writes no text; the existing `bdrc` provider books (e.g. 6a379f696b84dd3f2ea58223) give
// the image_source / page `photo` shape copied here; scripts/import/claremont-nag-hammadi.mjs is the
// direct-importer shape (insertBookIfNew, makePageDoc, hidden, resumable adopt-the-shell);
// scripts/works-catalog/import-cbeta-text.mjs writes an e-text as `ocr.data` but has no scans to
// align it with; /root/tibetan-eval/kanjur_align.py (#4523) is the identity instrument, ported in
// scripts/lib/derge-tengyur.mjs. None of them aligns a digital edition to a scan folio by folio.
//
// Import the Derge Tengyur (#5497): BDRC W23703 scans (213 volumes, image groups I1317–I1531,
// AccessOpen IIIF) as one HIDDEN, HELD book per volume, with the Esukhia digital Derge Tengyur
// (public domain, github.com/Esukhia/derge-tengyur) written as each page's text — but only for a
// volume whose folio alignment was MEASURED, never assumed:
//
//   1. Each BDRC canvas carries a folio label ("2a"); each e-text side carries a marker ([2a.1]).
//      The label claims a side (claimByLabel).
//   2. The claim is tested on SAMPLES spread through the volume: a Yigdzin (BDRC OCR, CPU) read of
//      the image is scored (syllable Needleman-Wunsch, as kanjur_align.py) against the claimed side and
//      every side within ±6, plus a far side. The best-scoring shift is the measured offset. The
//      wrong-folio control is the best score among sides ≥2 away and the far side.
//   3. The volume passes only if every usable sample measures shift 0, identity ≥ 0.6 and a margin
//      ≥ 0.25 over its control (ALIGN_RULES). A volume that fails gets its book and scans but NO
//      text; the reasons are recorded on the checkpoint and reported.
//
// Translation is NOT approved (#5497). No translation endpoint is called; every book is held
// (scripts/lib/pipeline-hold.mjs, reason tengyur-import-5497) before its pages are inserted, so
// gap-fill cannot queue it, and hidden through initialPublication().
//
// Images are archived to R2 separately, by the guarded archiver (book-scoped keys via storagePut):
//   npx tsx scripts/catalog-coverage/archive-acquired.ts --campaign tengyur-5497 --hosts iiif.bdrc.io
//
// Usage (Hetzner; never through a Vercel function):
//   node --env-file=.env.production.local scripts/import/derge-tengyur-import.mjs --volumes=1,40 --measure
//   node --env-file=.env.production.local scripts/import/derge-tengyur-import.mjs --volumes=1,40 --apply
//   node --env-file=.env.production.local scripts/import/derge-tengyur-import.mjs --all --apply
// Flags: --etext=/root/derge-tengyur (a checkout; its HEAD sha is recorded on every page)
//        --work=/root/tengyur-5497  (manifest cache, samples, checkpoint.json)
// Resumable: the checkpoint records each volume's measurement (never paid twice) and outcome; a
// book row left without pages by a killed run is adopted and finished.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MongoClient, ObjectId } from 'mongodb';
import { insertBookIfNew } from '../lib/acquire-book.mjs';
import { makePageDoc } from '../lib/book-docs.mjs';
import { holdBook } from '../lib/pipeline-hold.mjs';
import { initialPublication } from '../lib/publication.mjs';
import { isHumanEdited } from '../lib/syriac-kraken-lane.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import {
  parseVolume, pageText, syllables, canvasFolioLabel, claimByLabel, scoreRead, sampleClass, volumeVerdict,
  ALIGN_RULES, sha16,
} from '../lib/derge-tengyur.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const ETEXT = args.etext || '/root/derge-tengyur';
const WORK = args.work || '/root/tengyur-5497';
const APPLY = !!args.apply;
const MEASURE_ONLY = !!args.measure;
const SAMPLES = Number(args.samples || 5);
const IMPORTER = 'script:derge-tengyur-import';
const ISSUE = 5497;
const CAMPAIGN = 'tengyur-5497';
const HOLD = {
  reason: 'tengyur-import-5497',
  issue: ISSUE,
  release: 'a draft English translation of the Derge Tengyur is approved as a separate, priced decision (#5497: translation NOT approved at import)',
};
const FIRST_IG = 1317; // tbrc volume numbers 1317-1531 (BDRC note on MW23703)
const N_VOLUMES = 213;
const TEXT_SOURCE = 'esukhia-derge-tengyur';
const PIPELINE = 'derge-tengyur-import-5497';
const LICENCE = 'public domain — "mechanical reproduction of a public-domain work" (Esukhia README)';
const CONVENTIONS = 'Esukhia markup kept verbatim: {D####} opens the text with that Tohoku number; (x,y) = (reading of the blocks, suggested correction); [x] = doubtful or untranscribable; # = a peydurma note point. Folio line markers [2a.1] became line breaks; a line-initial # is escaped as \\# for the Markdown reader.';

if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing — run with node --env-file=.env.production.local');
fs.mkdirSync(path.join(WORK, 'manifests'), { recursive: true });
fs.mkdirSync(path.join(WORK, 'samples'), { recursive: true });
const CKPT = path.join(WORK, 'checkpoint.json');
const ckpt = fs.existsSync(CKPT) ? JSON.parse(fs.readFileSync(CKPT, 'utf8')) : { volumes: {} };
const saveCkpt = () => { fs.writeFileSync(`${CKPT}.tmp`, JSON.stringify(ckpt, null, 1)); fs.renameSync(`${CKPT}.tmp`, CKPT); };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const ETEXT_SHA = execFileSync('git', ['-C', ETEXT, 'rev-parse', 'HEAD']).toString().trim();
const ETEXT_FILES = fs.readdirSync(path.join(ETEXT, 'text')).filter((f) => f.endsWith('.txt')).sort();
if (ETEXT_FILES.length !== N_VOLUMES) throw new Error(`expected ${N_VOLUMES} e-text volumes, found ${ETEXT_FILES.length}`);

let volumes;
if (args.all) volumes = Array.from({ length: N_VOLUMES }, (_, i) => i + 1);
else if (args.volumes) volumes = String(args.volumes).split(',').map(Number);
else throw new Error('pass --volumes=1,40 or --all');

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

async function manifestFor(ig) {
  const f = path.join(WORK, 'manifests', `I${ig}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const m = await (await fetchRetry(`https://iiifpres.bdrc.io/v:bdr:I${ig}/manifest`)).json();
  fs.writeFileSync(f, JSON.stringify(m));
  return m;
}

const imageServiceOf = (canvas) => {
  const id = canvas.images?.[0]?.resource?.service?.['@id'] || canvas.images?.[0]?.resource?.['@id']?.replace(/\/full\/.*$/, '');
  if (!id) throw new Error(`canvas ${canvas['@id']} has no image service`);
  return id;
};

/**
 * The reader is BDRC's own Tibetan OCR (Yigdzin, the `BDRC/Woodblock` model run through
 * tibetan-ocr-app on this box): measured 0.95 median identity against the Derge e-text on Kangyur
 * pages (#4523), CPU only, no spend. A Gemini lite read was tried first on the pilot and is too weak
 * on Derge woodblock to measure anything (identity 0.02–0.46, two runaway loops of ~1,500
 * syllables; $0.03) — see the pilot comment on #5497.
 */
const YIG_APP = args['yig-app'] || '/root/tibetan-ocr-app';
const YIG_MODEL = args['yig-model'] || (() => {
  const base = '/root/.cache/huggingface/hub/models--BDRC--Woodblock/snapshots';
  return fs.existsSync(base) ? path.join(base, fs.readdirSync(base)[0]) : null;
})();
const READ_ENGINE = `bdrc-yigdzin-woodblock@${YIG_MODEL ? path.basename(YIG_MODEL).slice(0, 10) : 'missing'}`;

/** Read every image in `dir` that has no transcription yet in `${dir}-yig`; returns that out dir. */
function yigdzinRead(dir) {
  if (!YIG_MODEL) throw new Error('Yigdzin Woodblock model not found — pass --yig-model=<dir>');
  const out = `${dir}-yig`;
  fs.mkdirSync(out, { recursive: true });
  const todo = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg') && !fs.existsSync(path.join(out, f.replace(/\.jpg$/, '.txt'))));
  if (!todo.length) return out;
  const batch = `${dir}-batch`;
  fs.rmSync(batch, { recursive: true, force: true });
  fs.mkdirSync(batch);
  for (const f of todo) fs.symlinkSync(path.join(dir, f), path.join(batch, f));
  execFileSync(path.join(YIG_APP, 'venv/bin/python'), ['cli.py', '--model', `${YIG_MODEL}/`, '--folder', batch, '--output', out, '--encoding', 'unicode', '--line-mode', 'line'],
    { cwd: YIG_APP, env: { ...process.env, QT_QPA_PLATFORM: 'offscreen' }, stdio: ['ignore', 'ignore', 'pipe'], timeout: 30 * 60 * 1000 });
  fs.rmSync(batch, { recursive: true, force: true });
  return out;
}

/**
 * Measure one volume: SAMPLES reads spread through it, each scored against its claimed side, plus a
 * second, interleaved round of SAMPLES when any first-round read is uninformative (the reader failed
 * on that image). Cached on the checkpoint per engine + rules version; reads are cached on disk.
 */
async function measure(vol, canvases, pages, claim) {
  const v = ckpt.volumes[vol] ||= {};
  if (v.measurement?.engine === READ_ENGINE && v.measurement.rules?.version === ALIGN_RULES.version) return v.measurement;
  const cand = canvases.map((c, i) => i).filter((i) => claim[i] != null && syllables(pages[claim[i]].lines.join(' ')).length >= 150);
  const round = (phase) => Array.from({ length: SAMPLES }, (_, k) => cand[Math.floor(((k + phase) / SAMPLES) * cand.length)]).filter((x) => x != null);
  const dir = path.join(WORK, 'samples', `v${String(vol).padStart(3, '0')}`);
  fs.mkdirSync(dir, { recursive: true });
  const samples = [];
  const seen = new Set();
  for (const phase of [0.5, 0.25]) {
    const picks = round(phase).filter((ci) => !seen.has(ci));
    picks.forEach((ci) => seen.add(ci));
    const meta = [];
    for (const ci of picks) {
      const label = canvasFolioLabel(canvases[ci]);
      const url = `${imageServiceOf(canvases[ci])}/full/1600,/0/default.jpg`;
      const f = path.join(dir, `c${ci}_${label}.jpg`);
      if (!fs.existsSync(f)) fs.writeFileSync(f, Buffer.from(await (await fetchRetry(url)).arrayBuffer()));
      meta.push({ ci, label, url, stem: `c${ci}_${label}` });
    }
    const out = yigdzinRead(dir);
    for (const { ci, label, url, stem } of meta) {
      const tf = path.join(out, `${stem}.txt`);
      const text = fs.existsSync(tf) ? fs.readFileSync(tf, 'utf8') : '';
      const far = (claim[ci] + Math.floor(pages.length / 2)) % pages.length;
      const score = scoreRead(text, pages, claim[ci], { far, floor: ALIGN_RULES.informativeFloor });
      const cls = sampleClass(score);
      samples.push({ canvas: ci, label, side: pages[claim[ci]].label, image_url: url, read_sha: sha16(text), class: cls, score });
      log(`  v${vol} canvas ${ci} (${label}) read ${score.read_syllables} syl: identity ${score.identity} shift ${score.measured_shift} control ${score.control} far ${score.far_control}${score.global_best ? ` global ${JSON.stringify(score.global_best)}` : ''} → ${cls}`);
    }
    if (!samples.some((x) => x.class === 'uninformative')) break;
  }
  v.measurement = { engine: READ_ENGINE, at: new Date().toISOString(), rules: ALIGN_RULES, samples, cost_usd: 0 };
  v.measurement.verdict = volumeVerdict(samples);
  saveCkpt();
  return v.measurement;
}

function volumeTitle(vol, file) {
  // "001_བསྟོད་ཚོགས།_ཀ.txt" → section བསྟོད་ཚོགས།, volume letter ཀ
  const [, section, letter] = file.replace(/\.txt$/, '').split('_');
  return `བསྟན་འགྱུར། སྡེ་དགེ། ${section}${letter ? ` ${letter}` : ''} (Derge Tengyur, vol. ${vol})`;
}

async function importVolume(db, vol) {
  const ig = FIRST_IG + vol - 1;
  const file = ETEXT_FILES[vol - 1];
  if (Number(file.slice(0, 3)) !== vol) throw new Error(`e-text file ${file} is not volume ${vol}`);
  const v = ckpt.volumes[vol] ||= {};
  // A volume refused under an older rules version is re-measured and, if it now passes, filled in.
  if (v.done && !args.redo && (v.verdict === 'pass' || v.measurement?.rules?.version === ALIGN_RULES.version)) { log(`v${vol}: done earlier (${v.book_id}) — skip`); return v; }

  const manifest = await manifestFor(ig);
  const mlabel = (manifest.label || []).find?.((l) => l['@language'] === 'en')?.['@value'] || '';
  if (mlabel !== `volume ${vol}`) throw new Error(`I${ig}: manifest label "${mlabel}" is not "volume ${vol}"`);
  const canvases = manifest.sequences[0].canvases;
  const pages = parseVolume(fs.readFileSync(path.join(ETEXT, 'text', file), 'utf8'));
  const claim = claimByLabel(canvases.map(canvasFolioLabel), pages);
  v.canvases = canvases.length; v.text_sides = pages.length; v.claimed = claim.filter((x) => x != null).length;
  log(`v${vol} I${ig} ${file}: ${canvases.length} canvases, ${pages.length} text sides, ${v.claimed} claimed by label`);

  const m = await measure(vol, canvases, pages, claim);
  log(`v${vol}: verdict ${m.verdict.pass ? 'PASS' : 'REFUSE'} (${m.verdict.scored} scored)${m.verdict.reasons.length ? ' — ' + m.verdict.reasons.join('; ') : ''} [$${m.cost_usd}]`);
  if (MEASURE_ONLY || !APPLY) { saveCkpt(); return v; }

  const books = db.collection('books');
  const pagesC = db.collection('pages');
  const now = new Date();
  const title = volumeTitle(vol, file);
  const tohoku = [...new Set(pages.flatMap((p) => p.tohoku))];
  const manifestUrl = `https://iiifpres.bdrc.io/v:bdr:I${ig}/manifest`;

  // Adopt a book an earlier run created (by its image group), else create it through the gate.
  let book = await books.findOne({ 'image_source.provider': 'bdrc', 'image_source.identifier': `I${ig}` }, { projection: { id: 1, pages_count: 1, pipeline_auto: 1 } });
  if (!book) {
    const _id = new ObjectId();
    // hidden_reason is not on makeBookDoc's whitelist (#3969); it is written right after the insert,
    // as claremont-nag-hammadi.mjs does, from the same initialPublication() result.
    const { hidden_reason: hiddenReason, ...publication } = initialPublication({ state: 'hidden', reason: 'curation', note: 'tengyur-import-5497: imported hidden; publication and translation are separate decisions', by: IMPORTER, issue: ISSUE, now });
    const r = await insertBookIfNew(db, {
      _id: String(_id), id: String(_id),
      slug: `derge-tengyur-vol-${vol}`,
      title, display_title: title, author: '',
      language: 'Tibetan', languages: ['Tibetan'],
      year: 1982,
      published: 'Delhi: Delhi Karmapae Choedhey, Gyalwae Sungrab Partun Khang, 1982–1985 (reproduced from clear prints of the 18th-century Derge blocks, carved 1737–1744)',
      publisher: 'Delhi Karmapae Choedhey, Gyalwae Sungrab Partun Khang',
      place_published: 'Delhi',
      content_type: 'book',
      collections: ['tibetan-canon'],
      description: `Volume ${vol} of 213 of the Derge Tengyur (sde dge bstan 'gyur), the canonical Tibetan collection of translated Indian treatises and commentaries. Scans: BDRC W23703, image group I${ig}. Page text: the Esukhia digital Derge Tengyur (public domain), aligned folio by folio to the scan.`,
      pages_count: canvases.length, pages_ocr: 0, pages_translated: 0, pages_archived: 0,
      status: 'draft',
      ...publication,
      image_source: {
        provider: 'bdrc',
        provider_name: 'Buddhist Digital Resource Center (BDRC)',
        identifier: `I${ig}`,
        iiif_manifest: manifestUrl,
        source_url: `https://library.bdrc.io/show/bdr:MW23703`,
        license: 'publicdomain',
        access_date: now.toISOString(),
        contributing_library: 'Buddhist Digital Resource Center',
      },
      held_by: ['bdrc'],
      contributing_library: 'Buddhist Digital Resource Center',
      dublin_core: { dc_identifier: [`IIIF:I${ig}`], dc_source: 'https://library.bdrc.io/show/bdr:MW23703', dc_publisher: 'BDRC' },
      catalog_ids: { bdrc_instance: 'MW23703', bdrc_scans: 'W23703', bdrc_image_group: `I${ig}`, derge_tengyur_volume: vol, tohoku },
      catalog_metadata: { source: 'bdrc_iiif', manifest_label: manifest.label, etext_file: `text/${file}`, etext_commit: ETEXT_SHA },
      acquisition_campaign: CAMPAIGN,
      notes: `Imported by scripts/import/derge-tengyur-import.mjs (#5497). Page text from the Esukhia digital Derge Tengyur @ ${ETEXT_SHA.slice(0, 10)}, written only where the volume's folio alignment was measured and passed. Held: translation not approved.`,
      created_at: now, updated_at: now,
    }, { importer: IMPORTER, sourceIdentifier: `bdrc:I${ig}`, sourceUrl: manifestUrl });
    if (!r.inserted) { v.refused_book = r.message; saveCkpt(); log(`v${vol}: acquisition gate declined — ${r.message}`); return v; }
    book = { id: r.bookId };
    await books.updateOne({ id: book.id }, { $set: { hidden_reason: hiddenReason } });
    log(`v${vol}: created ${book.id}`);
  } else {
    log(`v${vol}: adopting ${book.id} from an earlier run`);
  }
  v.book_id = book.id;
  // Hold BEFORE any page exists, so no lane can see an enrollable book with pages.
  const h = await holdBook(db, book.id, { ...HOLD, source: IMPORTER, detail: { volume: vol, image_group: `I${ig}` } });
  if (!['held', 'already_held'].includes(h.outcome)) throw new Error(`v${vol}: hold failed (${h.outcome}) — refusing to insert pages`);

  const pass = m.verdict.pass;
  const alignment = pass ? {
    method: 'bdrc-canvas-label → esukhia folio marker, verified by sampled reads',
    measured_shift: 0, samples: m.verdict.scored, read_engine: m.engine,
    min_identity: Math.min(...m.samples.filter((s) => s.class === 'aligned').map((s) => s.score.identity)),
    max_control: Math.max(...m.samples.filter((s) => s.class === 'aligned').map((s) => s.score.control)),
    uninformative_reads: m.verdict.uninformative.length,
    rules: ALIGN_RULES, measured_at: m.at,
  } : null;
  const ocrFor = (i) => {
    if (!pass || claim[i] == null) return null;
    const side = pages[claim[i]];
    const text = pageText(side);
    if (!text) return null;
    return {
      data: text, content_hash: sha16(text), language: 'Tibetan',
      source: TEXT_SOURCE, pipeline: PIPELINE,
      text_edition: {
        name: 'Esukhia digital Derge Tengyur', repo: 'https://github.com/Esukhia/derge-tengyur', commit: ETEXT_SHA,
        path: `text/${file}`, folio: side.label, tohoku: side.tohoku, licence: LICENCE, conventions: CONVENTIONS, issue: ISSUE,
      },
      alignment, generated_at: now, updated_at: now,
    };
  };

  const existing = new Map((await pagesC.find({ book_id: book.id }, { projection: { page_number: 1, ocr: 1 } }).toArray()).map((p) => [p.page_number, p]));
  const toInsert = [];
  let textWritten = 0, textKeptHuman = 0;
  const refused = { volume_refused: 0, no_label_match: 0, blank_side: 0 };
  for (let i = 0; i < canvases.length; i++) {
    const c = canvases[i];
    const service = imageServiceOf(c);
    const photo = `${service}/full/max/0/default.jpg`;
    const ocr = ocrFor(i);
    if (!ocr) {
      if (!pass) refused.volume_refused++;
      else if (claim[i] == null) refused.no_label_match++;
      else refused.blank_side++;
    }
    const ex = existing.get(i + 1);
    if (ex) {
      if (ocr && !ex.ocr?.data) {
        // Human-edit guard: only fill an empty page that nobody edited.
        if (isHumanEdited(ex.ocr)) { textKeptHuman++; continue; }
        const r = await pagesC.updateOne({ _id: ex._id, 'ocr.data': { $exists: false } }, { $set: { ocr, updated_at: now } });
        textWritten += r.modifiedCount;
      } else if (ex.ocr?.data) textWritten += ex.ocr.source === TEXT_SOURCE ? 1 : 0;
      continue;
    }
    const _id = new ObjectId();
    toInsert.push(makePageDoc({
      _id: String(_id), id: String(_id), book_id: book.id, page_number: i + 1,
      page_label: canvasFolioLabel(c) ? `f. ${canvasFolioLabel(c)}` : null,
      source_ref: service.replace(/^https:\/\/iiif\.bdrc\.io\//, ''),
      photo, photo_original: photo,
      image_width: c.width, image_height: c.height,
      catalog_metadata: { source: 'bdrc_iiif', canvas: c['@id'], label: c.label },
      ...(ocr ? { ocr } : {}),
      created_at: now, updated_at: now,
    }));
    if (ocr) textWritten++;
  }
  for (let k = 0; k < toInsert.length; k += 500) await pagesC.insertMany(toInsert.slice(k, k + 500), { ordered: false });
  const nPages = await pagesC.countDocuments({ book_id: book.id });
  const nText = await pagesC.countDocuments({ book_id: book.id, 'ocr.source': TEXT_SOURCE });
  await recountBook(db, book.id, { reason: IMPORTER });
  Object.assign(v, { done: true, pages: nPages, pages_text: nText, refused, text_kept_human: textKeptHuman, verdict: m.verdict.pass ? 'pass' : 'refused', finished_at: new Date().toISOString() });
  saveCkpt();
  log(`v${vol}: ${nPages} pages, ${nText} with aligned text; refused ${JSON.stringify(refused)}`);
  return v;
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
try {
  for (const vol of volumes) {
    try { await importVolume(db, vol); }
    catch (e) {
      log(`v${vol}: ERROR ${e.message}`);
      (ckpt.volumes[vol] ||= {}).error = String(e.message).slice(0, 500);
      saveCkpt();
      if (args['stop-on-error']) throw e;
    }
  }
} finally {
  await client.close();
}
const vs = Object.values(ckpt.volumes);
log(`checkpoint: ${vs.filter((x) => x.done).length} done, ${vs.filter((x) => x.verdict === 'refused').length} refused volumes, spend $${vs.reduce((a, x) => a + (x.measurement?.cost_usd || 0), 0).toFixed(4)}`);
