#!/usr/bin/env node
// PRIOR ART: scripts/works-catalog/ingest-bdrc.mjs (#2648) catalogues BDRC works but creates no
// books and writes no text; the existing `bdrc` provider books (e.g. 6a379f696b84dd3f2ea58223) give
// the image_source / page `photo` shape copied here; scripts/import/claremont-nag-hammadi.mjs is the
// direct-importer shape (insertBookIfNew, makePageDoc, hidden, resumable adopt-the-shell);
// scripts/works-catalog/import-cbeta-text.mjs writes an e-text as `ocr.data` but has no scans to
// align it with; /root/tibetan-eval/kanjur_align.py (#4523) is the identity instrument, ported in
// scripts/lib/derge-tengyur.mjs. None of them aligns a digital edition to a scan folio by folio.
//
// --canon=kangyur (#5665) runs the same import for the Derge Kangyur: BDRC W4CZ5369 (the Library of
// Congress copy, the one the e-text transcribes) + the Esukhia digital Derge Kangyur. What differs
// per canon is constant data in CANONS (scripts/lib/derge-tengyur.mjs); the Kangyur also records,
// per side and per volume, which Tohoku texts 84000 has published or has in progress, so a later
// draft-English run can leave them to 84000.
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
//   node --env-file=.env.production.local scripts/import/derge-tengyur-import.mjs --canon=kangyur --volumes=1,40 --apply
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
  locateRead, agreedOffset, ALIGN_RULES, sha16, CANONS, volumeFileParts, sideTexts, parse84000Lobby, status84000,
  sideLeftTo84000, SEGMENT_RULES, isConfidentLocation, offsetRuns, gapProbes, segmentsFromRuns, claimFromSegments,
} from '../lib/derge-tengyur.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const C = CANONS[args.canon || 'tengyur'];
if (!C) throw new Error(`--canon must be one of ${Object.keys(CANONS).join(', ')}`);
const ETEXT = args.etext || C.etext;
const WORK = args.work || C.work;
const APPLY = !!args.apply;
const MEASURE_ONLY = !!args.measure;
const SAMPLES = Number(args.samples || 5);
const IMPORTER = C.importer;
const ISSUE = C.issue;
const CAMPAIGN = C.campaign;
const HOLD = C.hold;
const N_VOLUMES = C.nVolumes;
const TEXT_SOURCE = C.textSource;
const PIPELINE = C.pipeline;
const LICENCE = C.licence;
const CONVENTIONS = C.conventions;
// The page-level text licence the reader shows (#5571): one block per page, version = file@commit.
const textSourceFor = (file, text) => ({
  name: C.editionName, url: C.repo, license: 'Public Domain', license_url: `${C.repo}/blob/master/README.md`,
  license_quote: C.licenceQuote, version: `text/${file}@${ETEXT_SHA.slice(0, 10)}`, content_hash: sha16(text),
});

if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing — run with node --env-file=.env.production.local');
fs.mkdirSync(path.join(WORK, 'manifests'), { recursive: true });
fs.mkdirSync(path.join(WORK, 'samples'), { recursive: true });
// --ckpt: a partition's own checkpoint (copy of the main one), so two runs in parallel never clobber it.
const CKPT = args.ckpt || path.join(WORK, 'checkpoint.json');
const ckpt = fs.existsSync(CKPT) ? JSON.parse(fs.readFileSync(CKPT, 'utf8')) : { volumes: {} };
const saveCkpt = () => { fs.writeFileSync(`${CKPT}.tmp`, JSON.stringify(ckpt, null, 1)); fs.renameSync(`${CKPT}.tmp`, CKPT); };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const ETEXT_SHA = execFileSync('git', ['-C', ETEXT, 'rev-parse', 'HEAD']).toString().trim();
const ETEXT_FILES = fs.readdirSync(path.join(ETEXT, 'text')).filter((f) => f.endsWith('.txt')).sort();
if (ETEXT_FILES.length !== N_VOLUMES) throw new Error(`expected ${N_VOLUMES} e-text volumes, found ${ETEXT_FILES.length}`);

let volumes;
if (args['map-volumes']) volumes = [];
else if (args.all) volumes = Array.from({ length: N_VOLUMES }, (_, i) => i + 1);
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
  const f = path.join(WORK, 'manifests', `${ig}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const m = await (await fetchRetry(`https://iiifpres.bdrc.io/v:bdr:${ig}/manifest`)).json();
  fs.writeFileSync(f, JSON.stringify(m));
  return m;
}

const manifestVolume = (m) => (m.label || []).find?.((l) => l['@language'] === 'en')?.['@value'] || '';

/**
 * Image group for a volume. The Tengyur's are sequential (C.imageGroupFor); the Kangyur's (W4CZ5369)
 * are not, so they are read from BDRC's instanceHasVolume list and keyed by each manifest's own
 * "volume N" label (cached in WORK/image-groups.json).
 */
let igMap = null;
async function igFor(scanVol) {
  if (C.imageGroupFor) return C.imageGroupFor(scanVol);
  const f = path.join(WORK, 'image-groups.json');
  if (!igMap && fs.existsSync(f)) igMap = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!igMap) {
    const res = await (await fetchRetry(`https://ldspdi.bdrc.io/resource/${C.bdrcScans}.json`)).json();
    const igs = (res[`http://purl.bdrc.io/resource/${C.bdrcScans}`]?.['http://purl.bdrc.io/ontology/core/instanceHasVolume'] || []).map((x) => x.value.split('/').pop());
    igMap = {};
    for (const ig of igs) {
      const n = manifestVolume(await manifestFor(ig)).match(/^volume (\d+)$/)?.[1];
      if (!n) throw new Error(`${ig}: manifest has no "volume N" label`);
      if (igMap[n]) throw new Error(`${C.bdrcScans}: two image groups claim volume ${n} (${igMap[n]}, ${ig})`);
      igMap[n] = ig;
    }
    fs.writeFileSync(f, JSON.stringify(igMap, null, 1));
    log(`${C.bdrcScans}: ${igs.length} image groups resolved to volumes`);
  }
  if (!igMap[scanVol]) throw new Error(`${C.bdrcScans}: no image group for volume ${scanVol}`);
  return igMap[scanVol];
}

/** 84000's catalogue, read once per run (C.eighty4000 only). */
let recs84000 = null;
async function catalogue84000() {
  if (recs84000) return recs84000;
  recs84000 = parse84000Lobby(await (await fetchRetry('https://read.84000.co/section/lobby.json')).text());
  if (recs84000.size < 4000) throw new Error(`84000 catalogue parsed only ${recs84000.size} records — refusing to mark coverage from a partial read`);
  log(`84000: ${recs84000.size} catalogue records`);
  return recs84000;
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
// The red-ink preprocessing is part of the engine: a read made from another preprocessing is not reused.
const READ_ENGINE = `bdrc-yigdzin-woodblock@${YIG_MODEL ? path.basename(YIG_MODEL).slice(0, 10) : 'missing'}${C.redInk ? '+redink-rg2' : ''}`;

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
  if (C.redInk) {
    // Red-ink print (C.redInk): isolate the ink as RED minus GREEN — red ink is high, the beige paper
    // and its dark fibres are low — invert, and stretch so the paper goes white. The stored page image
    // is untouched — this is the READER's input only. Measured 2026-10-03 on vol. 27 (#5665): the
    // earlier green-channel + CLAHE input kept the paper fibres, and Yigdzin returned nothing for 4 of
    // 5 leaves ("string index out of range"); R−G read all 5, 4 of them at 0.69–0.99 identity. Scaled to
    // 2400 px wide (rg2) it reads as well (0.85–0.98 on the same 4) for half the CPU.
    const py = 'import cv2,sys,numpy as np\nfor a in sys.argv[2:]:\n  im=cv2.imread(a).astype(np.int16)\n  d=np.clip(im[:,:,2]-im[:,:,1],0,255).astype(np.uint8)\n  d=cv2.normalize(cv2.GaussianBlur(d,(3,3),0),None,0,255,cv2.NORM_MINMAX)\n  g=255-d\n  lo,hi=np.percentile(g,1),np.percentile(g,60)\n  g=np.clip((g.astype(np.float32)-lo)*255/max(hi-lo,1),0,255).astype(np.uint8)\n  h,w=g.shape\n  g=cv2.resize(g,(2400,int(h*2400/w)),interpolation=cv2.INTER_AREA) if w>2400 else g\n  cv2.imwrite(sys.argv[1]+"/"+a.split("/")[-1],g)\n';
    execFileSync(path.join(YIG_APP, 'venv/bin/python'), ['-c', py, batch, ...todo.map((f) => path.join(dir, f))], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 10 * 60 * 1000 });
  } else {
    for (const f of todo) fs.symlinkSync(path.join(dir, f), path.join(batch, f));
  }
  execFileSync(path.join(YIG_APP, 'venv/bin/python'), ['cli.py', '--model', `${YIG_MODEL}/`, '--folder', batch, '--output', out, '--encoding', 'unicode', '--line-mode', 'line'],
    { cwd: YIG_APP, env: { ...process.env, QT_QPA_PLATFORM: 'offscreen' }, stdio: ['ignore', 'ignore', 'pipe'], timeout: Math.max(30 * 60 * 1000, todo.length * 90 * 1000) }); // ~40 s/read on a loaded box
  fs.rmSync(batch, { recursive: true, force: true });
  return out;
}

/**
 * Measure one volume: SAMPLES reads spread through it, each scored against its claimed side, plus a
 * second, interleaved round of SAMPLES when any first-round read is uninformative (the reader failed
 * on that image). Cached on the checkpoint per engine + rules version; reads are cached on disk.
 */
// Reads and their scores are cached per volume AND image group: when the volume map re-pairs an
// e-text volume with another scan volume (#5665), a measurement of the old scan must not be reused.
// Checkpoints written before the image group was recorded (the Tengyur's) carry none and stay valid.
const sampleDir = (vol, ig, suffix = '') => path.join(WORK, 'samples', `v${String(vol).padStart(3, '0')}${C.measureVolumeMap ? `-${ig}` : ''}${suffix}`);

async function measure(vol, canvases, pages, claim, ig) {
  const v = ckpt.volumes[vol] ||= {};
  // The cache is keyed on what was claimed, too: a re-claim (index mode, a new offset) re-verifies.
  const claimKey = `${v.claim_mode || 'label'}:${v.offset_measurement?.offset ?? ''}`;
  if (v.measurement?.engine === READ_ENGINE && v.measurement.rules?.version === ALIGN_RULES.version && (v.measurement.claim_key ?? 'label:') === claimKey && (v.measurement.ig ?? ig) === ig) return v.measurement;
  const cand = canvases.map((c, i) => i).filter((i) => claim[i] != null && syllables(pages[claim[i]].lines.join(' ')).length >= 150);
  const round = (phase) => Array.from({ length: SAMPLES }, (_, k) => cand[Math.floor(((k + phase) / SAMPLES) * cand.length)]).filter((x) => x != null);
  const dir = sampleDir(vol, ig);
  fs.mkdirSync(dir, { recursive: true });
  const samples = [];
  const seen = new Set();
  for (const phase of [0.5, 0.25]) {
    const picks = round(phase).filter((ci) => !seen.has(ci));
    picks.forEach((ci) => seen.add(ci));
    const meta = [];
    for (const ci of picks) {
      const label = canvasFolioLabel(canvases[ci]);
      const url = `${imageServiceOf(canvases[ci])}/full/${C.readSize}/0/default.jpg`;
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
    if (!samples.some((x) => x.class === 'uninformative' || x.class === 'weak')) break;
  }
  v.measurement = { engine: READ_ENGINE, at: new Date().toISOString(), rules: ALIGN_RULES, claim_key: claimKey, ig, samples, cost_usd: 0 };
  v.measurement.verdict = volumeVerdict(samples);
  saveCkpt();
  return v.measurement;
}

/** Index mode: read SAMPLES canvases spread through the volume and locate each among ALL sides. */
async function measureOffset(vol, canvases, pages, ig) {
  const v = ckpt.volumes[vol] ||= {};
  if (v.offset_measurement?.engine === READ_ENGINE && v.offset_measurement.rules?.version === ALIGN_RULES.version && (v.offset_measurement.ig ?? ig) === ig) return v.offset_measurement;
  const dir = sampleDir(vol, ig, '-offset');
  fs.mkdirSync(dir, { recursive: true });
  const n = canvases.length;
  // Phase 0.75 — away from the 0.5 / 0.25 phases the verification rounds use, so the canvases that
  // MEASURE the offset are not the ones that VERIFY it.
  const picks = [...new Set(Array.from({ length: SAMPLES }, (_, k) => Math.floor(((k + 0.75) / SAMPLES) * n)))].filter((i) => i < n);
  for (const ci of picks) {
    const f = path.join(dir, `c${ci}.jpg`);
    if (!fs.existsSync(f)) fs.writeFileSync(f, Buffer.from(await (await fetchRetry(`${imageServiceOf(canvases[ci])}/full/${C.readSize}/0/default.jpg`)).arrayBuffer()));
  }
  const out = yigdzinRead(dir);
  const located = picks.map((ci) => {
    const tf = path.join(out, `c${ci}.txt`);
    const loc = locateRead(fs.existsSync(tf) ? fs.readFileSync(tf, 'utf8') : '', pages);
    log(`  v${vol} canvas ${ci}: best side ${loc.side} (index ${loc.index}, offset ${loc.index - ci}) identity ${loc.identity} control ${loc.control}`);
    return { canvas: ci, loc };
  });
  v.offset_measurement = { engine: READ_ENGINE, rules: ALIGN_RULES, ig, at: new Date().toISOString(), located, ...agreedOffset(located) };
  saveCkpt();
  return v.offset_measurement;
}

/**
 * Segment mode (C.segmentOffsets, #5665): the offset is measured per stretch of the volume, so a
 * skipped or repeated leaf costs the canvases around the break, not the whole volume. See
 * SEGMENT_RULES (scripts/lib/derge-tengyur.mjs). Reads that LOCATE (coarse + gap probes) are never the
 * reads that VERIFY a segment; a verify read that turns out misaligned and locates with confidence is
 * moved to the locating set (it is evidence of a break nobody saw) and the segments are re-cut.
 */
async function measureSegments(vol, canvases, pages, ig) {
  const v = ckpt.volumes[vol] ||= {};
  const sm0 = v.segment_measurement;
  if (sm0?.engine === READ_ENGINE && sm0.rules?.version === ALIGN_RULES.version && sm0.segment_rules?.version === SEGMENT_RULES.version && sm0.ig === ig) return sm0;
  const SR = SEGMENT_RULES;
  const dir = sampleDir(vol, ig, '-seg-rg2');
  fs.mkdirSync(dir, { recursive: true });
  const n = canvases.length;
  const texts = new Map();
  const readAll = async (cis) => {
    const todo = [...new Set(cis)].filter((ci) => ci >= 0 && ci < n && !texts.has(ci));
    for (const ci of todo) {
      const f = path.join(dir, `c${ci}.jpg`);
      if (!fs.existsSync(f)) fs.writeFileSync(f, Buffer.from(await (await fetchRetry(`${imageServiceOf(canvases[ci])}/full/${C.readSize}/0/default.jpg`)).arrayBuffer()));
    }
    if (!todo.length) return;
    const out = yigdzinRead(dir);
    for (const ci of todo) { const tf = path.join(out, `c${ci}.txt`); texts.set(ci, fs.existsSync(tf) ? fs.readFileSync(tf, 'utf8') : ''); }
  };
  const located = new Map();
  const locate = (cis) => {
    for (const ci of cis) {
      const loc = locateRead(texts.get(ci) ?? '', pages);
      located.set(ci, loc);
      log(`  v${vol} locate canvas ${ci}: side ${loc.side} offset ${loc.index - ci} identity ${loc.identity} control ${loc.control} (${loc.read_syllables} syl)${isConfidentLocation(loc) ? ' ✓' : ''}`);
    }
  };
  const locatedList = () => [...located].map(([canvas, loc]) => ({ canvas, loc }));
  const edge = Math.floor(n * SR.edge);
  const coarse = [...new Set([edge, ...Array.from({ length: SR.coarse }, (_, k) => Math.floor(((k + 0.5) / SR.coarse) * n)), n - 1 - edge])];
  await readAll(coarse); locate(coarse);

  let segments = [];
  let rounds = 0;
  for (let iter = 0; iter < SR.maxIterations; iter++) {
    for (let r = 0; r < SR.maxRefineRounds; r++) {
      const probes = gapProbes(offsetRuns(locatedList()).gaps, new Set(located.keys()));
      if (!probes.length) break;
      rounds++;
      await readAll(probes); locate(probes);
    }
    const { runs, gaps } = offsetRuns(locatedList());
    segments = segmentsFromRuns(runs, n);
    log(`v${vol}: ${segments.length} segment(s) ${segments.map((s) => `[${s.from}–${s.to}] ${s.offset >= 0 ? '+' : ''}${s.offset}`).join(', ')}${gaps.filter((g) => g.hi - g.lo > 1).length ? `; unresolved gaps ${JSON.stringify(gaps.filter((g) => g.hi - g.lo > 1))}` : ''}`);
    let newEvidence = false;
    for (const seg of segments) {
      seg.samples = [];
      const cand = [];
      for (let i = seg.from; i <= seg.to; i++) {
        const k = i + seg.offset;
        if (located.has(i) || k < 0 || k >= pages.length) continue;
        if (syllables(pages[k].lines.join(' ')).length >= 150) cand.push(i);
      }
      const used = new Set();
      for (const phase of [0.5, 0.25, 0.75]) {
        const picks = [...new Set(Array.from({ length: SR.verifyPerRound }, (_, k) => cand[Math.floor(((k + phase) / SR.verifyPerRound) * cand.length)]))].filter((x) => x != null && !used.has(x));
        picks.forEach((x) => used.add(x));
        if (!picks.length) break;
        await readAll(picks);
        for (const ci of picks) {
          const side = ci + seg.offset;
          const far = (side + Math.floor(pages.length / 2)) % pages.length;
          const score = scoreRead(texts.get(ci) ?? '', pages, side, { far, floor: ALIGN_RULES.informativeFloor });
          const cls = sampleClass(score);
          seg.samples.push({ canvas: ci, side: pages[side].label, read_sha: sha16(texts.get(ci) ?? ''), class: cls, score });
          log(`  v${vol} verify [${seg.from}–${seg.to}] canvas ${ci} → side ${pages[side].label}: identity ${score.identity} shift ${score.measured_shift} control ${score.control} → ${cls}`);
        }
        const vd = volumeVerdict(seg.samples, { ...ALIGN_RULES, minScored: SR.minSegmentAligned });
        if (vd.pass || seg.samples.some((x) => x.class === 'misaligned')) break;
      }
      seg.verdict = volumeVerdict(seg.samples, { ...ALIGN_RULES, minScored: SR.minSegmentAligned });
      seg.pass = seg.verdict.pass;
      for (const x of seg.samples.filter((y) => y.class === 'misaligned')) {
        const loc = locateRead(texts.get(x.canvas) ?? '', pages);
        if (isConfidentLocation(loc)) { located.set(x.canvas, loc); newEvidence = true; log(`  v${vol} canvas ${x.canvas}: misaligned verify read locates at offset ${loc.index - x.canvas} — re-cutting segments`); }
      }
    }
    if (!newEvidence) break;
  }
  v.segment_measurement = {
    engine: READ_ENGINE, rules: ALIGN_RULES, segment_rules: SR, ig, at: new Date().toISOString(), cost_usd: 0,
    reads: texts.size, refine_rounds: rounds,
    located: locatedList().map(({ canvas, loc }) => ({ canvas, ...loc, confident: isConfidentLocation(loc) })),
    segments: segments.map((s) => ({ ...s, samples: s.samples, verdict: s.verdict, pass: !!s.pass })),
  };
  saveCkpt();
  return v.segment_measurement;
}

function volumeTitle(vol, file) {
  // "001_བསྟོད་ཚོགས།_ཀ.txt" → section བསྟོད་ཚོགས།, volume letter ཀ
  const [section, letter] = volumeFileParts(file);
  return `${C.titleBo} ${section}${letter ? ` ${letter}` : ''} (${C.titleEn}, vol. ${vol})`;
}

/**
 * Measure which scan volume holds which e-text volume (C.measureVolumeMap). One read from the middle
 * of every scan volume is located against the e-text volumes within ±4 of its prior; the e-text
 * volume it matches (identity ≥ informativeFloor and ≥ minMargin over the best other volume) is the
 * pairing. Volumes with no confident read are left out of the map, and importVolume refuses them.
 */
async function mapVolumes() {
  const f = path.join(WORK, 'volume-map.json');
  if (fs.existsSync(f) && !args['remap']) return JSON.parse(fs.readFileSync(f, 'utf8'));
  await igFor(1); // resolves igMap
  const dir = path.join(WORK, 'samples', 'volume-map');
  fs.mkdirSync(dir, { recursive: true });
  const scanVols = Object.keys(igMap).map(Number).sort((a, b) => a - b);
  for (const sv of scanVols) {
    const cs = (await manifestFor(igMap[sv])).sequences[0].canvases.filter((c) => c.images?.[0]?.resource);
    const ci = Math.floor(cs.length * 0.43);
    const jf = path.join(dir, `s${String(sv).padStart(3, '0')}_c${ci}.jpg`);
    if (!fs.existsSync(jf)) fs.writeFileSync(jf, Buffer.from(await (await fetchRetry(`${imageServiceOf(cs[ci])}/full/${C.readSize}/0/default.jpg`)).arrayBuffer()));
  }
  const out = yigdzinRead(dir);
  const parsed = new Map();
  const pagesOf = (ev) => { if (!parsed.has(ev)) parsed.set(ev, parseVolume(fs.readFileSync(path.join(ETEXT, 'text', ETEXT_FILES[ev - 1]), 'utf8'))); return parsed.get(ev); };
  const map = { measured_at: new Date().toISOString(), engine: READ_ENGINE, rule: 'one read per scan volume located against e-text volumes within ±4 of the prior; pair when identity ≥ 0.4 and ≥ 0.25 over the best other volume', pairs: {}, evidence: {} };
  for (const tf of fs.readdirSync(out).filter((x) => x.endsWith('.txt'))) {
    const sv = Number(tf.match(/^s(\d+)/)[1]);
    const text = fs.readFileSync(path.join(out, tf), 'utf8');
    const prior = Array.from({ length: N_VOLUMES }, (_, i) => i + 1).find((ev) => C.scanVolumeFor(ev) === sv) ?? sv;
    const cands = Array.from({ length: 9 }, (_, k) => prior - 4 + k).filter((ev) => ev >= 1 && ev <= N_VOLUMES);
    const scored = cands.map((ev) => ({ ev, ...locateRead(text, pagesOf(ev)) })).sort((a, b) => b.identity - a.identity);
    const [best, second] = scored;
    const ok = best && best.read_syllables >= ALIGN_RULES.minReadSyllables && best.identity >= ALIGN_RULES.informativeFloor && best.identity - (second?.identity ?? 0) >= ALIGN_RULES.minMargin;
    map.evidence[sv] = { read: tf, best: best && { etext: best.ev, side: best.side, identity: best.identity }, runner_up: second && { etext: second.ev, identity: second.identity }, paired: !!ok };
    if (ok) {
      if (map.pairs[best.ev]) { log(`map: e-text ${best.ev} claimed by scan ${map.pairs[best.ev]} and ${sv} — dropping both`); map.evidence[sv].paired = false; map.evidence[map.pairs[best.ev]].paired = false; map.pairs[best.ev] = null; continue; }
      map.pairs[best.ev] = sv;
    }
    log(`map: scan vol ${sv} → e-text ${ok ? best.ev : 'NONE'} (best ${best?.ev} ${best?.identity}, next ${second?.ev} ${second?.identity})`);
  }
  for (const k of Object.keys(map.pairs)) if (map.pairs[k] == null) delete map.pairs[k];
  fs.writeFileSync(f, JSON.stringify(map, null, 1));
  return map;
}

let volumeMap = null;
async function scanVolumeOf(vol) {
  if (!C.measureVolumeMap) return C.scanVolumeFor(vol);
  volumeMap ||= await mapVolumes();
  if (volumeMap.pairs[vol]) return volumeMap.pairs[vol];
  // No confident single read for this volume (a lone read is often weak on this red-ink print). Fall
  // back to a prior that no measured pair has taken: the README prior, then the same number, then the
  // one free scan volume within ±2. This is a CANDIDATE only — index mode then locates the volume's own
  // reads in this e-text (measureOffset) and verifies them (measure), so a wrong pairing is refused.
  // Measured 2026-10-02: every confident pair is N→N except e-text 100/101/102 ↔ scan 101/102/100.
  const taken = new Set(Object.values(volumeMap.pairs).map(Number));
  const free = (sv) => sv >= 1 && sv <= N_VOLUMES && !taken.has(sv);
  // A free neighbour that is another unpaired volume's own prior is that volume's, not ours.
  const priorOfOther = (sv) => Array.from({ length: N_VOLUMES }, (_, i) => i + 1).some((u) => u !== vol && !volumeMap.pairs[u] && (u === sv || C.scanVolumeFor(u) === sv));
  const near = [vol - 2, vol - 1, vol + 1, vol + 2].filter((sv) => free(sv) && !priorOfOther(sv));
  const sv = [C.scanVolumeFor(vol), vol].find(free) ?? (near.length === 1 ? near[0] : null);
  if (!sv) throw new Error(`e-text volume ${vol}: no scan volume measured or free to try (volume-map.json) — refusing to guess`);
  return sv;
}

async function importVolume(db, vol) {
  const scanVol = await scanVolumeOf(vol);
  const ig = await igFor(scanVol);
  const file = ETEXT_FILES[vol - 1];
  if (Number(file.slice(0, 3)) !== vol) throw new Error(`e-text file ${file} is not volume ${vol}`);
  const v = ckpt.volumes[vol] ||= {};
  // A volume refused under an older rules version is re-measured and, if it now passes, filled in.
  if (v.done && !args.redo && (v.verdict === 'pass' || (v.measurement?.rules?.version === ALIGN_RULES.version && (v.measurement?.ig ?? ig) === ig))) { log(`v${vol}: done earlier (${v.book_id}) — skip`); return v; }

  const manifest = await manifestFor(ig);
  const mlabel = manifestVolume(manifest);
  if (mlabel !== `volume ${scanVol}`) throw new Error(`${ig}: manifest label "${mlabel}" is not "volume ${scanVol}"`);
  // BDRC keeps a placeholder canvas for a leaf it never photographed ("134a (missing)", no image
  // resource — I1489). It cannot become a page; its text side is reported as text without an image.
  const allCanvases = manifest.sequences[0].canvases;
  const canvases = allCanvases.filter((c) => c.images?.[0]?.resource);
  v.missing_images = allCanvases.filter((c) => !c.images?.[0]?.resource).map((c) => (Array.isArray(c.label) ? c.label[0]?.['@value'] : c.label) || c['@id']);
  const pages = parseVolume(fs.readFileSync(path.join(ETEXT, 'text', file), 'utf8'));
  const labels = canvases.map(canvasFolioLabel);
  let claim;
  let segs = null;
  if (C.segmentOffsets) {
    // Segment mode (#5665): the offset is measured per stretch, and only verified stretches are claimed.
    v.claim_mode = 'segment';
    const sm = await measureSegments(vol, canvases, pages, ig);
    segs = sm.segments;
    claim = claimFromSegments(segs, canvases.length, pages.length);
  } else if (C.claimMode === 'label' && labels.filter(Boolean).length >= canvases.length * 0.5) {
    v.claim_mode = 'label';
    claim = claimByLabel(labels, pages);
  } else {
    // No folio labels in the manifest: measure the offset on one round of reads, then let the
    // ordinary verification (measure) test the offset on independent canvases.
    v.claim_mode = 'index';
    const om = await measureOffset(vol, canvases, pages, ig);
    log(`v${vol}: no folio labels — measured offset ${om.offset ?? 'NONE'}${om.reason ? ` (${om.reason})` : ''}`);
    claim = canvases.map((_, i) => (om.offset != null && i + om.offset >= 0 && i + om.offset < pages.length ? i + om.offset : null));
  }
  v.canvases = canvases.length; v.text_sides = pages.length; v.claimed = claim.filter((x) => x != null).length;
  log(`v${vol} ${ig} ${file}: ${canvases.length} canvases, ${pages.length} text sides, ${v.claimed} claimed (${v.claim_mode})`);

  // Segment mode verifies inside measureSegments; its result is folded into the volume measurement.
  const m = segs ? (v.measurement = {
    engine: v.segment_measurement.engine, at: v.segment_measurement.at, rules: ALIGN_RULES, claim_key: 'segment', ig, cost_usd: 0,
    samples: segs.flatMap((s) => s.samples),
    verdict: {
      pass: segs.some((s) => s.pass),
      scored: segs.filter((s) => s.pass).reduce((a, s) => a + s.verdict.scored, 0),
      uninformative: segs.flatMap((s) => s.verdict.uninformative), weak: segs.flatMap((s) => s.verdict.weak),
      reasons: segs.length ? segs.filter((s) => !s.pass).map((s) => `segment [${s.from}–${s.to}] offset ${s.offset}: ${s.verdict.reasons.join('; ')}`) : ['no read located with confidence'],
      segments: segs.map((s) => ({ from: s.from, to: s.to, offset: s.offset, pass: s.pass })),
    },
  }) : await measure(vol, canvases, pages, claim, ig);
  log(`v${vol}: verdict ${m.verdict.pass ? 'PASS' : 'REFUSE'} (${m.verdict.scored} scored)${m.verdict.reasons.length ? ' — ' + m.verdict.reasons.join('; ') : ''} [$${m.cost_usd}]`);
  if (MEASURE_ONLY || !APPLY) { saveCkpt(); return v; }

  const books = db.collection('books');
  const pagesC = db.collection('pages');
  const now = new Date();
  const title = volumeTitle(vol, file);
  const tohoku = [...new Set(pages.flatMap((p) => p.tohoku))];
  const manifestUrl = `https://iiifpres.bdrc.io/v:bdr:${ig}/manifest`;
  // 84000 coverage (Kangyur): per side, the texts it carries and whether every one of them is
  // Published or In Progress at 84000 — a later draft-English run leaves those sides alone.
  const texts = sideTexts(pages);
  let cov = null;
  if (C.eighty4000) {
    const recs = await catalogue84000();
    const status = {};
    for (const t of new Set(texts.flat())) status[t] = status84000(t, recs);
    const left = texts.map((t) => sideLeftTo84000(t, recs));
    cov = { recs, left, summary: {
      source: 'https://read.84000.co/section/lobby.json', fetched_at: now.toISOString(),
      texts: status, sides: pages.length, sides_left_to_84000: left.filter(Boolean).length,
      rule: 'a side is left to 84000 when every Tohoku text on it is Published or In Progress there (parent ids listed only through sub-texts do not count)',
    } };
    v.eighty_four_thousand = { sides: pages.length, left: cov.summary.sides_left_to_84000 };
  }

  // Adopt a book an earlier run created (by its image group), else create it through the gate.
  let book = await books.findOne({ 'image_source.provider': 'bdrc', 'image_source.identifier': ig }, { projection: { id: 1, pages_count: 1, pipeline_auto: 1 } });
  if (!book) {
    const _id = new ObjectId();
    // hidden_reason is not on makeBookDoc's whitelist (#3969); it is written right after the insert,
    // as claremont-nag-hammadi.mjs does, from the same initialPublication() result.
    const { hidden_reason: hiddenReason, ...publication } = initialPublication({ state: 'hidden', reason: 'curation', note: `${HOLD.reason}: imported hidden; publication and translation are separate decisions`, by: IMPORTER, issue: ISSUE, now });
    const r = await insertBookIfNew(db, {
      _id: String(_id), id: String(_id),
      slug: `${C.slug}-${vol}`,
      title, display_title: title, author: '',
      language: 'Tibetan', languages: ['Tibetan'],
      year: C.year,
      published: C.published,
      publisher: C.publisher,
      place_published: C.place,
      content_type: 'book',
      collections: ['tibetan-canon'],
      description: C.describe(vol, ig),
      pages_count: canvases.length, pages_ocr: 0, pages_translated: 0, pages_archived: 0,
      status: 'draft',
      ...publication,
      image_source: {
        provider: 'bdrc',
        provider_name: 'Buddhist Digital Resource Center (BDRC)',
        identifier: ig,
        iiif_manifest: manifestUrl,
        source_url: `https://library.bdrc.io/show/bdr:${C.bdrcInstance}`,
        license: 'publicdomain',
        access_date: now.toISOString(),
        contributing_library: 'Buddhist Digital Resource Center',
      },
      held_by: ['bdrc'],
      contributing_library: 'Buddhist Digital Resource Center',
      dublin_core: { dc_identifier: [`IIIF:${ig}`], dc_source: `https://library.bdrc.io/show/bdr:${C.bdrcInstance}`, dc_publisher: 'BDRC' },
      catalog_ids: { bdrc_instance: C.bdrcInstance, bdrc_scans: C.bdrcScans, bdrc_image_group: ig, [C.volumeField]: vol, ...(scanVol !== vol ? { bdrc_scan_volume: scanVol } : {}), tohoku },
      catalog_metadata: { source: 'bdrc_iiif', manifest_label: manifest.label, etext_file: `text/${file}`, etext_commit: ETEXT_SHA, ...(cov ? { eighty_four_thousand: cov.summary } : {}) },
      acquisition_campaign: CAMPAIGN,
      notes: `Imported by scripts/import/derge-tengyur-import.mjs --canon=${C.key} (#${ISSUE}). Page text from the ${C.editionName} @ ${ETEXT_SHA.slice(0, 10)}, written only where the volume's folio alignment was measured and passed. Held: translation not approved.`,
      created_at: now, updated_at: now,
    }, { importer: IMPORTER, sourceIdentifier: `bdrc:${ig}`, sourceUrl: manifestUrl });
    if (!r.inserted) { v.refused_book = r.message; saveCkpt(); log(`v${vol}: acquisition gate declined — ${r.message}`); return v; }
    book = { id: r.bookId };
    await books.updateOne({ id: book.id }, { $set: { hidden_reason: hiddenReason } });
    log(`v${vol}: created ${book.id}`);
  } else {
    log(`v${vol}: adopting ${book.id} from an earlier run`);
    if (cov) await books.updateOne({ id: book.id }, { $set: { 'catalog_metadata.eighty_four_thousand': cov.summary } });
  }
  v.book_id = book.id;
  // Hold BEFORE any page exists, so no lane can see an enrollable book with pages.
  const h = await holdBook(db, book.id, { ...HOLD, source: IMPORTER, detail: { volume: vol, image_group: ig } });
  if (!['held', 'already_held'].includes(h.outcome)) throw new Error(`v${vol}: hold failed (${h.outcome}) — refusing to insert pages`);

  const pass = m.verdict.pass;
  // Segment mode: each page carries its own segment's measurement.
  const segAlignment = (seg) => {
    const al = seg.samples.filter((x) => x.class === 'aligned');
    return {
      method: 'canvas index + per-segment measured offset → esukhia side (a skipped or repeated leaf moves the offset), each segment verified by its own independent sampled reads',
      measured_shift: 0, measured_offset: seg.offset, segment: { from_page: seg.from + 1, to_page: seg.to + 1, of: v.segment_measurement.segments.length },
      samples: seg.verdict.scored, read_engine: m.engine,
      min_identity: Math.min(...al.map((x) => x.score.identity)), max_control: Math.max(...al.map((x) => x.score.control)),
      uninformative_reads: seg.verdict.uninformative.length, weak_reads: seg.verdict.weak.length,
      rules: ALIGN_RULES, segment_rules: SEGMENT_RULES, measured_at: m.at,
    };
  };
  const segAlignments = segs ? segs.map((sg) => (sg.pass ? segAlignment(sg) : null)) : null;
  const alignmentFor = (i) => (segs ? segAlignments[segs.findIndex((sg) => sg.pass && i >= sg.from && i <= sg.to)] : alignment);
  const alignment = segs ? null : pass ? {
    method: v.claim_mode === 'index'
      ? 'canvas index + measured offset → esukhia side (manifest has no folio labels), verified by independent sampled reads'
      : 'bdrc-canvas-label → esukhia folio marker, verified by sampled reads',
    measured_shift: 0, ...(v.claim_mode === 'index' ? { measured_offset: v.offset_measurement?.offset } : {}), samples: m.verdict.scored, read_engine: m.engine,
    min_identity: Math.min(...m.samples.filter((s) => s.class === 'aligned').map((s) => s.score.identity)),
    max_control: Math.max(...m.samples.filter((s) => s.class === 'aligned').map((s) => s.score.control)),
    uninformative_reads: m.verdict.uninformative.length, weak_reads: (m.verdict.weak || []).length,
    rules: ALIGN_RULES, measured_at: m.at,
  } : null;
  const ocrFor = (i) => {
    if (!pass || claim[i] == null) return null;
    const side = pages[claim[i]];
    const text = pageText(side);
    if (!text) return null;
    const k = claim[i];
    return {
      data: text, content_hash: sha16(text), language: 'Tibetan',
      source: TEXT_SOURCE, pipeline: PIPELINE,
      text_source: textSourceFor(file, text),
      text_edition: {
        name: C.editionName, repo: C.repo, commit: ETEXT_SHA,
        path: `text/${file}`, folio: side.label, tohoku: side.tohoku, licence: LICENCE, conventions: CONVENTIONS, issue: ISSUE,
        ...(cov ? { texts: texts[k], texts_84000: Object.fromEntries(texts[k].map((t) => [t, status84000(t, cov.recs)])), left_to_84000: cov.left[k] } : {}),
      },
      alignment: alignmentFor(i), generated_at: now, updated_at: now,
    };
  };

  const existing = new Map((await pagesC.find({ book_id: book.id }, { projection: { page_number: 1, ocr: 1 } }).toArray()).map((p) => [p.page_number, p]));
  const toInsert = [];
  let textWritten = 0, textKeptHuman = 0;
  const refused = { volume_refused: 0, no_label_match: 0, blank_side: 0, ...(segs ? { segment_refused: 0 } : {}) };
  for (let i = 0; i < canvases.length; i++) {
    const c = canvases[i];
    const service = imageServiceOf(c);
    const photo = `${service}/full/max/0/default.jpg`;
    const ocr = ocrFor(i);
    if (!ocr) {
      if (!pass) refused.volume_refused++;
      else if (claim[i] == null) refused[segs ? 'segment_refused' : 'no_label_match']++;
      else refused.blank_side++;
    }
    const ex = existing.get(i + 1);
    if (ex) {
      if (ocr && !ex.ocr?.data) {
        // Human-edit guard: only fill an empty page that nobody edited.
        if (isHumanEdited(ex.ocr)) { textKeptHuman++; continue; }
        const label = canvasFolioLabel(c) && v.claim_mode === 'label' ? {} : { page_label: `f. ${ocr.text_edition.folio}` };
        const r = await pagesC.updateOne({ _id: ex._id, 'ocr.data': { $exists: false } }, { $set: { ocr, ...label, updated_at: now } });
        textWritten += r.modifiedCount;
      } else if (ex.ocr?.data) textWritten += ex.ocr.source === TEXT_SOURCE ? 1 : 0;
      continue;
    }
    const _id = new ObjectId();
    toInsert.push(makePageDoc({
      _id: String(_id), id: String(_id), book_id: book.id, page_number: i + 1,
      // Index mode: BDRC's label is not the leaf shown (W4CZ5369), so the label is the aligned side's.
      page_label: canvasFolioLabel(c) && v.claim_mode === 'label' ? `f. ${canvasFolioLabel(c)}` : (ocr ? `f. ${ocr.text_edition.folio}` : null),
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

if (args['map-volumes']) {
  const m = await mapVolumes();
  log(`volume map: ${Object.keys(m.pairs).length} of ${N_VOLUMES} e-text volumes paired; mismatched: ${JSON.stringify(Object.entries(m.pairs).filter(([e, sv]) => Number(e) !== sv))}`);
  process.exit(0);
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
