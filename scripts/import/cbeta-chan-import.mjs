#!/usr/bin/env node
// PRIOR ART: scripts/import/derge-tengyur-import.mjs (#5497) — the importer shape copied here
// (insertBookIfNew, initialPublication hidden, hold BEFORE pages, makePageDoc, resumable adopt-the-
// shell, text written only where the alignment was measured). It aligns by BDRC folio LABELS; a
// woodblock print of another edition has none, so the claim here is the neighbour-anchor fit in
// scripts/lib/cbeta-fit.mjs. scripts/works-catalog/import-cbeta-text.mjs (#2554) writes CBETA text
// as scanless pages — the model #2554 rejected. scripts/batch/eternity-ab-5513.mjs is the
// release → chained-enrol driver the `translate` command follows.
//
// Fit CBETA's typed Chan texts to open scans, verify every page, publish after a by-eye check (#5566).
//
//   measure   --text T2076         FREE  fit + verify every page; writes <work>/<text>/fit.json
//   apply     --text T2076         DB    create the hidden, held books (one per scan volume) through
//                                        the acquisition gate; insert pages; write ocr on the pages
//                                        that passed — never over existing text
//   eyecheck  --text T2076         FREE  pick 2 written pages per book, fetch their images and texts
//                                        into <work>/<text>/eyecheck/ for a by-eye read
//   verdict   --text T2076 --book ID --page N --ok|--bad --note "…"   record one by-eye read
//   release   --text T2076         DB    books whose 2 pages passed by eye: release the hold
//                                        (→ ocr_complete) and publish
//   translate --text T2076         PAID  enrol written, untranslated pages in the chained Batch lane
//                                        under envelope cbeta-chan-2026-10 (cap $15)
//   report    --text T2076         FREE  the per-book row for #5566
//
// Every page written carries: ocr.source 'cbeta-xml-p5', the CBETA work id, the xml-p5 commit, the
// Taishō/Xuzangjing line range, the licence "CC BY-NC-SA 4.0 (CBETA)", content_hash, and the
// alignment evidence (identity, coverage, wrong-page control, rules version). ocr.engine is the
// specialist-engine shape the reader's page panel renders, so the licence shows on the page.
//
// Usage (Hetzner; never through a Vercel function):
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/import/cbeta-chan-import.mjs measure --text T2076

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MongoClient, ObjectId } from 'mongodb';
import { insertBookIfNew } from '../lib/acquire-book.mjs';
import { makePageDoc } from '../lib/book-docs.mjs';
import { holdBook, releaseBook, isHeld } from '../lib/pipeline-hold.mjs';
import { initialPublication, setPublication } from '../lib/publication.mjs';
import { isHumanEdited } from '../lib/syriac-kraken-lane.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { contentHash } from '../lib/write-provenance.mjs';
import { callGemini } from '../lib/gemini-script-client.mjs';
import { costOf } from '../lib/model-pricing.mjs';
import {
  extractTei, foldHan, buildIndex, fitBook, verifyPage, spanText, changeAt, edgeColumn, FIT_RULES,
} from '../lib/cbeta-fit.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const val = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);
const WORK = val('work', '/root/cbeta-5566');
const ISSUE = 5566;
const IMPORTER = 'script:cbeta-chan-import';
const CAMPAIGN = 'cbeta-chan-5566';
const HOLD = {
  reason: 'cbeta-chan-5566',
  issue: ISSUE,
  release: 'two pages of the book are read by eye against the image and match the fitted CBETA text ("read from image", #5566)',
  source: 'cbeta-chan-import',
};
const TEXT_SOURCE = 'cbeta-xml-p5';
const PIPELINE = 'cbeta-chan-fit-5566';
const LICENCE = 'CC BY-NC-SA 4.0 (CBETA)';
const LICENCE_URL = 'https://www.cbeta.org/copyright.php';
const ENVELOPE_TAG = 'cbeta-chan-2026-10';
const ENVELOPE_CAP = 15;
const TR_RATE = 0.0012;   // chained AUTO_APPROVAL_USD_PER_PAGE (2× measured), as eternity-ab-5513.mjs

/**
 * The texts. `source.kind` names the scan adapter; `volumes` are in reading order. Rights are
 * checked per source before a text is added here (and recorded in `rights`).
 */
const TEXTS = {
  T2076: {
    cbeta: 'T2076', xml: 'T/T51/T51n2076.xml', canonRef: 'T51n2076',
    work_id: 'kr:KR6q0003',
    title: '景德傳燈錄', english: 'Jingde Record of the Transmission of the Lamp',
    author: '道原 (Daoyuan)',
    source: {
      kind: 'ndl', volumes: ['2569893', '2569894', '2569895', '2569896', '2569897', '2569898', '2569790', '2569813', '2569899', '2569900'],
      edition: 'Gozan edition (五山版), 貞和4 [1348]; NDL call no. WA6-45',
      year: 1348,
      rights: 'NDL item rights code "pdm" (Public Domain Mark), permission rule "internet" (dl.ndl.go.jp/api/item/search, read 2026-10-01)',
    },
  },
};

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const textKey = val('text');
const T = TEXTS[textKey];
if (cmd && !T) throw new Error(`--text must be one of ${Object.keys(TEXTS).join(', ')}`);
const TDIR = path.join(WORK, textKey || 'none');
fs.mkdirSync(TDIR, { recursive: true });
const STATE = path.join(TDIR, 'state.json');
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { books: {}, eyecheck: {} };
const saveState = () => { fs.writeFileSync(`${STATE}.tmp`, JSON.stringify(state, null, 1)); fs.renameSync(`${STATE}.tmp`, STATE); };

async function fetchRetry(url, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (r.ok) return r;
      if (r.status === 404 || r.status === 403 || i >= tries - 1) throw new Error(`${r.status} ${url}`);
    } catch (e) { if (i >= tries - 1) throw e; }
    await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
  }
}
async function cached(file, url, kind = 'text') {
  if (fs.existsSync(file)) return kind === 'json' ? JSON.parse(fs.readFileSync(file, 'utf8')) : fs.readFileSync(file, 'utf8');
  const r = await fetchRetry(url);
  const body = await r.text();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return kind === 'json' ? JSON.parse(body) : body;
}

// ── the typed text, pinned ─────────────────────────────────────────────────
async function pinnedSha(repo, file) {
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const r = await (await fetchRetry(`https://api.github.com/repos/${repo}/commits/master`)).json();
  fs.writeFileSync(file, r.sha);
  return r.sha;
}
async function loadText() {
  const sha = await pinnedSha('cbeta-org/xml-p5', path.join(WORK, 'xml-p5.sha'));
  const msha = await pinnedSha('DILA-edu/cbeta-metadata', path.join(WORK, 'metadata.sha'));
  const xml = await cached(path.join(WORK, 'xml', path.basename(T.xml)), `https://raw.githubusercontent.com/cbeta-org/xml-p5/${sha}/${T.xml}`);
  const gaiji = await cached(path.join(WORK, 'gaiji.json'), `https://raw.githubusercontent.com/DILA-edu/cbeta-metadata/${msha}/gaiji/gaiji.json`, 'json');
  const ex = extractTei(xml, gaiji);
  const { f: F, map } = foldHan(ex.text);
  const toF = (at) => { let lo = 0, hi = map.length; while (lo < hi) { const m = (lo + hi) >> 1; if (map[m] < at) lo = m + 1; else hi = m; } return lo; };
  const structural = [...new Set([0, F.length, ...ex.juans.map((j) => toF(j.at))])].sort((a, b) => a - b);
  return { sha, msha, ex, F, map, structural };
}

// ── scan sources ───────────────────────────────────────────────────────────
// NDL: the IIIF manifest gives the canvases; NDL's own OCR of each page (lab.ndl.go.jp full text,
// NDL classical-text OCR — an engine that has never seen CBETA) is the independent cheap read. It
// costs nothing, so no Gemini call is made for verification.
async function sourcePages() {
  if (T.source.kind !== 'ndl') throw new Error(`no adapter for source kind ${T.source.kind}`);
  const pages = [];
  for (const [vi, pid] of T.source.volumes.entries()) {
    const manifest = await cached(path.join(WORK, 'ndl', `${pid}.manifest.json`), `https://dl.ndl.go.jp/api/iiif/${pid}/manifest.json`, 'json');
    const full = await cached(path.join(WORK, 'ndl', `${pid}.json`), `https://lab.ndl.go.jp/dl/api/book/fulltext-json/${pid}`, 'json');
    const canvases = manifest.sequences[0].canvases;
    const byPage = new Map(full.list.map((x) => [x.page, x]));
    if (full.list.length !== canvases.length) log(`  ${pid}: ${full.list.length} OCR pages for ${canvases.length} canvases`);
    canvases.forEach((c, ci) => {
      const service = c.images[0].resource.service?.['@id'] || c.images[0].resource['@id'].replace(/\/full\/.*$/, '');
      const x = byPage.get(ci + 1);
      const lines = JSON.parse(x?.coordjson || '[]').map((e) => ({ text: e.contenttext, box: [e.xmin, e.ymin, e.xmax, e.ymax], h: e.ymax - e.ymin }));
      pages.push({ vol: vi, pid, n: ci + 1, canvas: c['@id'], service, width: c.width, height: c.height, read: x?.contents || '', lines });
    });
  }
  return pages;
}
const READ_ENGINE = { name: 'NDL classical-text OCR (lab.ndl.go.jp full text)', url: 'https://lab.ndl.go.jp/dl/api/book/fulltext-json/' };

// ── measure ────────────────────────────────────────────────────────────────
const EDGE_MODEL = 'gemini-3.1-flash-lite';
const EDGE_PROMPT = 'This image is one vertical column (sometimes two adjacent columns) cut from a page of a classical Chinese woodblock print. It may include a stretch of small characters printed as two half-width sub-columns (an interlinear note). Transcribe every character in reading order — top to bottom, right column first; inside a small-character stretch read the right sub-column, then the left. Output only the characters — no punctuation, no spaces, no commentary.';

/**
 * A second engine's read of one edge column (only where the NDL column reads disagree on a
 * boundary): the column's box from NDL's own line layout, cut from the IIIF image server, read by
 * flash-lite through the metered script client. Cached per page and side; never paid twice.
 */
async function edgeRead(p, col, cache) {
  // The crop is the column's x-range over the FULL frame height — not NDL's line box — so the
  // second engine reads the whole column (notes, the characters after them) independently of how
  // NDL segmented it.
  const [x0, y0, x1, y1] = col.box;
  const key = `${p.pid}:${p.n}:col:${Math.round(x0)}-${Math.round(x1)}`;
  if (cache[key]) return cache[key];
  const w = x1 - x0, h = y1 - y0;
  const x = Math.max(0, Math.round(x0 - 0.12 * w)), y = Math.max(0, Math.round(y0 - 60));
  const region = `${x},${y},${Math.round(w * 1.24)},${Math.round(h + 140)}`;
  const url = `${p.service}/${region}/,1400/0/default.jpg`;
  const img = Buffer.from(await (await fetchRetry(url)).arrayBuffer());
  let r;
  try {
    r = await callGemini({ model: EDGE_MODEL, prompt: EDGE_PROMPT, imageParts: [img], endpoint: 'scripts/import/cbeta-chan-import.mjs', type: 'ocr', triggeredBy: `cbeta-chan-5566 edge column`, maxOutputTokens: 400 });
  } catch (e) { r = { text: '', finishReason: `error: ${String(e.message).slice(0, 120)}`, inputTokens: 0, outputTokens: 0 }; }
  const out = { text: r.text || '', finish: r.finishReason, usd: costOf(EDGE_MODEL, r.inputTokens || 0, r.outputTokens || 0), url, at: new Date().toISOString() };
  if (!String(out.finish).startsWith('error')) cache[key] = out;   // a 503 is retried next run, not remembered
  return out;
}

async function measure() {
  const { sha, ex, F, map, structural } = await loadText();
  const src = await sourcePages();
  const pages = src.map((p) => ({ read: foldHan(p.read).f, lines: p.lines.map((l) => ({ f: foldHan(l.text).f, h: l.h, x0: l.box[0], y0: l.box[1], x1: l.box[2], y1: l.box[3] })) }));
  const idx = buildIndex(F);
  // Pass 1: NDL's reads alone. Pass 2: a second read of the edge columns where they disagree.
  let fit = fitBook(pages, F, idx, structural);
  const CACHE = path.join(TDIR, 'edge-reads.json');
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const needs = [...new Set(fit.boundaries.flatMap((b) => b.needs || []))];
  log(`${textKey}: pass 1 — ${fit.pages.filter((x) => x.span).length} pages fitted; ${needs.length} edge columns to read a second time`);
  const evidence = new Map();
  let done = 0;
  for (const nd of needs) {
    const [i, side] = nd.split(':');
    const p = src[Number(i)];
    const col = edgeColumn(pages[Number(i)].lines, side);
    if (!col?.box) continue;
    const r = await edgeRead(p, col, cache);
    if (++done % 25 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); log(`  edge reads ${done}/${needs.length}`); }
    if (r.text) evidence.set(nd, foldHan(r.text).f);
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  if (needs.length) fit = fitBook(pages, F, idx, structural, evidence);
  const edgeUsd = Object.values(cache).reduce((n, r) => n + (r.usd || 0), 0);
  const spans = fit.pages.map((x) => x.span);
  const reads = pages.map((p) => p.read);
  const rows = src.map((p, i) => {
    const r = fit.pages[i];
    const row = { i, vol: p.vol, pid: p.pid, n: p.n, read_chars: reads[i].length };
    if (!r.span) return { ...row, written: false, why: r.why };
    const v = verifyPage(i, reads, spans, F);
    const text = spanText(ex.text, map, r.span[0], r.span[1], F);
    const a = map[r.span[0]], b = map[r.span[1] - 1];
    return {
      ...row, written: v.pass, why: v.pass ? null : v.reasons.join('; '), edges: r.edges,
      verify: v, span: r.span, chars: text.length, content_hash: contentHash(text),
      lines: [changeAt(ex.lbs, a, 'lb'), changeAt(ex.lbs, b, 'lb')], juan: [changeAt(ex.juans, a, 'n'), changeAt(ex.juans, b, 'n')],
    };
  });
  const out = {
    text: textKey, cbeta: T.cbeta, xml_sha: sha, rules: FIT_RULES, read_engine: READ_ENGINE.name, edge_engine: EDGE_MODEL,
    measured_at: new Date().toISOString(), edge_reads: Object.keys(cache).length, edge_usd: +edgeUsd.toFixed(4),
    typed: { chars: ex.text.length, han: F.length, unresolved_gaiji: ex.unresolvedGaiji },
    pages: rows.length, written: rows.filter((r) => r.written).length,
    refused: Object.entries(rows.filter((r) => !r.written).reduce((m, r) => { const k = String(r.why).split(/[ ;]/)[0].replace(/-?\d+$/, ''); m[k] = (m[k] || 0) + 1; return m; }, {})),
    boundaries: Object.entries(fit.boundaries.reduce((m, b) => { const k = b.position != null ? (b.votes?.variant_gap ? 'set-variant-gap' : b.votes?.last2 != null || b.votes?.first2 != null ? 'set-with-second-read' : b.votes?.structural != null ? 'set-structural' : 'set-columns-agree') : String(b.why).replace(/-\d+$/, ''); m[k] = (m[k] || 0) + 1; return m; }, {})),
    controls: summarise(rows.filter((r) => r.verify)),
    rows,
  };
  fs.writeFileSync(path.join(TDIR, 'fit.json'), JSON.stringify(out));
  log(`${textKey}: ${out.written}/${out.pages} pages pass; refused ${JSON.stringify(out.refused)}; boundaries ${JSON.stringify(out.boundaries)}; ${JSON.stringify(out.controls)}; edge reads ${out.edge_reads} ($${out.edge_usd})`);
}
function summarise(rows) {
  const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
  const w = rows.filter((r) => r.written);
  return {
    written_identity_median: q(w.map((r) => r.verify.identity), 0.5), written_identity_p10: q(w.map((r) => r.verify.identity), 0.1),
    written_control_median: q(w.map((r) => r.verify.control), 0.5), written_control_max: q(w.map((r) => r.verify.control), 1 - 1e-9),
    written_margin_min: q(w.map((r) => r.verify.margin), 0),
  };
}

// ── apply ──────────────────────────────────────────────────────────────────
function volumeTitle(v, juanRange) {
  const n = T.source.volumes.length;
  const j = juanRange ? (juanRange[0] === juanRange[1] ? `卷${juanRange[0]}` : `卷${juanRange[0]}–${juanRange[1]}`) : null;
  return {
    title: `${T.title}${j ? ` ${j}` : ''} (vol ${v + 1} of ${n})`,
    display_title: `${T.title} (${T.english})${j ? `, ${j.replace('卷', 'juan ')}` : ''} — vol. ${v + 1} of ${n}`,
  };
}

async function apply(db) {
  const fit = JSON.parse(fs.readFileSync(path.join(TDIR, 'fit.json'), 'utf8'));
  const { sha, ex, F, map } = await loadText();
  if (sha !== fit.xml_sha) throw new Error(`fit.json was measured on xml-p5 ${fit.xml_sha}, the pin is now ${sha} — re-measure`);
  const pages = await sourcePages();
  const books = db.collection('books');
  const pagesC = db.collection('pages');
  const now = new Date();
  for (const [v, pid] of T.source.volumes.entries()) {
    const vp = pages.filter((p) => p.vol === v);
    const vr = fit.rows.filter((r) => r.vol === v);
    const juans = vr.filter((r) => r.written).flatMap((r) => r.juan).filter((x) => x != null);
    const jr = juans.length ? [Math.min(...juans), Math.max(...juans)] : null;
    const manifestUrl = `https://dl.ndl.go.jp/api/iiif/${pid}/manifest.json`;
    let book = await books.findOne({ 'image_source.provider': 'ndl_japan', 'image_source.identifier': pid }, { projection: { id: 1 } });
    if (!book) {
      const _id = new ObjectId();
      const { hidden_reason: hiddenReason, ...publication } = initialPublication({ state: 'hidden', reason: 'curation', note: `${HOLD.reason}: imported hidden; published after a by-eye check of two pages`, by: IMPORTER, issue: ISSUE, now });
      const t = volumeTitle(v, jr);
      const r = await insertBookIfNew(db, {
        _id: String(_id), id: String(_id),
        slug: `${T.cbeta.toLowerCase()}-ndl-${pid}`,
        title: t.title, display_title: t.display_title, original_title: T.title,
        author: T.author,
        language: 'Classical Chinese', languages: ['Classical Chinese'],
        year: T.source.year, published: T.source.edition,
        content_type: 'book',
        collections: ['zen-chan', 'chinese-buddhist-texts'],
        work_id: T.work_id,
        description: `${T.title} (${T.english}), volume ${v + 1} of ${T.source.volumes.length} of the ${T.source.edition} in the National Diet Library. Page text: the CBETA digital edition (${T.canonRef}, ${LICENCE}), fitted page by page to this print and checked against an independent reading of each image; pages where the fit could not be verified carry no text.`,
        pages_count: vp.length, pages_ocr: 0, pages_translated: 0, pages_archived: 0,
        status: 'draft',
        ...publication,
        image_source: {
          provider: 'ndl_japan', provider_name: 'National Diet Library of Japan', identifier: pid,
          iiif_manifest: manifestUrl, source_url: `https://dl.ndl.go.jp/pid/${pid}`,
          license: 'publicdomain', license_url: 'https://creativecommons.org/publicdomain/mark/1.0/',
          attribution: '国立国会図書館 National Diet Library, JAPAN', access_date: now.toISOString(),
          contributing_library: 'National Diet Library of Japan', rights_note: T.source.rights,
        },
        contributing_library: 'National Diet Library of Japan',
        dublin_core: { dc_identifier: [`IIIF:${manifestUrl}`, `doi:10.11501/${pid}`], dc_source: manifestUrl },
        catalog_ids: { ndl_pid: pid, cbeta: T.cbeta, cbeta_canon_ref: T.canonRef },
        catalog_metadata: {
          source: 'ndl_iiif', volume: v + 1, volumes: T.source.volumes.length,
          text_edition: { name: 'CBETA XML P5', work: T.canonRef, repo: 'https://github.com/cbeta-org/xml-p5', commit: sha, path: T.xml, licence: LICENCE, licence_url: LICENCE_URL },
        },
        acquisition_campaign: CAMPAIGN,
        notes: `Imported by scripts/import/cbeta-chan-import.mjs (#${ISSUE}). Text: CBETA ${T.canonRef} @ ${sha.slice(0, 10)} (${LICENCE}); written only on pages whose fit passed rules v${fit.rules.version}.`,
        created_at: now, updated_at: now,
      }, { importer: IMPORTER, sourceIdentifier: `ndl:${pid}`, sourceUrl: manifestUrl });
      if (!r.inserted) { log(`vol ${v + 1} ${pid}: acquisition gate declined — ${r.message}`); state.books[pid] = { declined: r.message }; saveState(); continue; }
      book = { id: r.bookId };
      await books.updateOne({ id: book.id }, { $set: { hidden_reason: hiddenReason } });
      log(`vol ${v + 1} ${pid}: created ${book.id}`);
    } else log(`vol ${v + 1} ${pid}: adopting ${book.id}`);
    const h = await holdBook(db, book.id, { ...HOLD, detail: { text: T.cbeta, ndl_pid: pid } });
    if (!['held', 'already_held'].includes(h.outcome)) throw new Error(`${pid}: hold ${h.outcome} — refusing to write pages`);

    const existing = new Map((await pagesC.find({ book_id: book.id }, { projection: { page_number: 1, ocr: 1 } }).toArray()).map((p) => [p.page_number, p]));
    const toInsert = [];
    let written = 0, keptExisting = 0, refitted = 0, withdrawn = 0;
    for (const p of vp) {
      const row = vr.find((r) => r.n === p.n);
      const ocr = row?.written ? ocrFor(row, sha, ex, map, F, fit, p) : null;
      const ex0 = existing.get(p.n);
      if (ex0) {
        const ours = ex0.ocr?.source === TEXT_SOURCE && ex0.ocr?.pipeline === PIPELINE && !isHumanEdited(ex0.ocr);
        if (ocr && !ex0.ocr?.data && !isHumanEdited(ex0.ocr)) {
          const u = await pagesC.updateOne({ _id: ex0._id, $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }] }, { $set: { ocr, updated_at: now } });
          written += u.modifiedCount;
        } else if (ours && ocr && ex0.ocr.content_hash !== ocr.content_hash) {
          // This job's own text from an earlier rules version, on a hidden, held book: re-fit.
          await pagesC.updateOne({ _id: ex0._id, 'ocr.pipeline': PIPELINE }, { $set: { ocr, updated_at: now } });
          refitted++; written++;
        } else if (ours && !ocr) {
          // This job's own text on a page the current rules refuse: take it back.
          await pagesC.updateOne({ _id: ex0._id, 'ocr.pipeline': PIPELINE }, { $unset: { ocr: '' }, $set: { updated_at: now } });
          withdrawn++;
        } else if (ocr && ex0.ocr?.data && ex0.ocr.source !== TEXT_SOURCE) keptExisting++;
        else if (ex0.ocr?.source === TEXT_SOURCE) written++;
        continue;
      }
      const _id = new ObjectId();
      toInsert.push(makePageDoc({
        _id: String(_id), id: String(_id), book_id: book.id, page_number: p.n,
        photo: `${p.service}/full/2000,/0/default.jpg`, photo_original: `${p.service}/full/2000,/0/default.jpg`,
        thumbnail: `${p.service}/full/200,/0/default.jpg`,
        image_width: p.width, image_height: p.height,
        source_ref: p.service.replace(/^https:\/\/dl\.ndl\.go\.jp\/api\/iiif\//, 'ndl:'),
        catalog_metadata: { source: 'ndl_iiif', canvas: p.canvas },
        ...(ocr ? { ocr } : {}),
        created_at: now, updated_at: now,
      }));
      if (ocr) written++;
    }
    for (let k = 0; k < toInsert.length; k += 500) await pagesC.insertMany(toInsert.slice(k, k + 500), { ordered: false });
    await recountBook(db, book.id, { reason: IMPORTER });
    const nPages = await pagesC.countDocuments({ book_id: book.id });
    const nText = await pagesC.countDocuments({ book_id: book.id, 'ocr.source': TEXT_SOURCE });
    state.books[pid] = { ...(state.books[pid] || {}), book_id: book.id, vol: v + 1, pages: nPages, written: nText, refused: vr.filter((r) => !r.written).length, kept_existing: keptExisting, refitted, withdrawn, rules: fit.rules.version, juan: jr, at: now.toISOString() };
    saveState();
    log(`vol ${v + 1} ${pid} → ${book.id}: ${nPages} pages, ${nText} with fitted text, ${state.books[pid].refused} refused${refitted || withdrawn ? ` (re-fitted ${refitted}, withdrawn ${withdrawn})` : ''}`);
  }
}

function ocrFor(row, sha, ex, map, F, fit, p) {
  const text = spanText(ex.text, map, row.span[0], row.span[1], F);
  if (contentHash(text) !== row.content_hash) throw new Error(`page ${p.pid}/${p.n}: text differs from the measured fit — re-measure`);
  const now = new Date();
  return {
    data: text,
    content_hash: row.content_hash,
    language: 'Classical Chinese',
    source: TEXT_SOURCE,
    model: `cbeta-xml-p5@${sha.slice(0, 10)}`,
    pipeline: PIPELINE,
    licence: LICENCE,
    engine: {
      name: 'CBETA XML P5', version: sha.slice(0, 10),
      model: T.canonRef, model_label: `CBETA digital edition, ${T.canonRef} (${T.title}), fitted to this page`,
      model_url: `https://github.com/cbeta-org/xml-p5/blob/${sha}/${T.xml}`, revision: sha, revision_source: 'logged',
      licence: LICENCE, run: `${PIPELINE} ${now.toISOString().slice(0, 10)}`, issue: ISSUE,
    },
    text_edition: {
      name: 'CBETA XML P5', work: T.canonRef, cbeta_id: T.cbeta, repo: 'https://github.com/cbeta-org/xml-p5', commit: sha, path: T.xml,
      lines: row.lines, juan: row.juan, licence: LICENCE, licence_url: LICENCE_URL,
      conventions: 'CBETA reading text: inline notes (the print\'s small double-line characters) in （）; editorial notes and variant readings dropped (lemma kept); CBETA/Taishō punctuation; gaiji as Unicode, else CBETA\'s normalised form, else 〔composition〕.',
      issue: ISSUE,
    },
    alignment: {
      method: 'neighbour anchors: the page\'s boundaries are where the independent reads of the adjacent pages meet in the typed text (rules in scripts/lib/cbeta-fit.mjs)',
      read_engine: READ_ENGINE.name, read_url: `${READ_ENGINE.url}${p.pid}`,
      identity: row.verify.identity, coverage: row.verify.coverage, control: row.verify.control, margin: row.verify.margin,
      span_chars: row.verify.span_chars, read_chars: row.verify.read_chars, boundary_votes: row.edges,
      second_read_engine: fit.edge_engine,
      rules: fit.rules, measured_at: fit.measured_at,
    },
    generated_at: now, updated_at: now,
  };
}

// ── by-eye check ───────────────────────────────────────────────────────────
async function eyecheck(db) {
  const dir = path.join(TDIR, 'eyecheck');
  fs.mkdirSync(dir, { recursive: true });
  for (const [pid, b] of Object.entries(state.books)) {
    if (!b.book_id) continue;
    const ps = await db.collection('pages').find({ book_id: b.book_id, 'ocr.source': TEXT_SOURCE }, { projection: { page_number: 1, photo: 1, 'ocr.data': 1, 'ocr.content_hash': 1 } }).sort({ page_number: 1 }).toArray();
    if (ps.length < 2) { log(`${pid}: only ${ps.length} written pages`); continue; }
    // A verdict counts while the page still carries the text that was read; drop the rest.
    const hashNow = new Map(ps.map((p) => [String(p.page_number), p.ocr.content_hash]));
    const ent = state.eyecheck[b.book_id] || {};
    for (const n of Object.keys(ent)) if (ent[n].content_hash !== hashNow.get(n)) delete ent[n];
    state.eyecheck[b.book_id] = ent;
    const valid = Object.keys(ent).length;
    if (valid >= 2) { log(`${pid}: ${valid} pages already checked on their current text`); continue; }
    // Deterministic, spread: one from each half of the book.
    const seed = parseInt(b.book_id.slice(-6), 16);
    const picks = [ps[seed % Math.ceil(ps.length / 2)], ps[Math.ceil(ps.length / 2) + (seed % Math.floor(ps.length / 2))]]
      .filter((p) => !ent[String(p.page_number)]).slice(0, 2 - valid);
    for (const p of picks) {
      const stem = path.join(dir, `${pid}-p${p.page_number}`);
      if (!fs.existsSync(`${stem}.jpg`)) fs.writeFileSync(`${stem}.jpg`, Buffer.from(await (await fetchRetry(p.photo.replace('/full/2000,/', '/full/1600,/'))).arrayBuffer()));
      fs.writeFileSync(`${stem}.txt`, p.ocr.data);
      const prior = state.eyecheck[b.book_id]?.[p.page_number];
      // A verdict is about one text: a re-fit page is read again.
      if (!prior || prior.content_hash !== p.ocr.content_hash) (state.eyecheck[b.book_id] ||= {})[p.page_number] = { pid, image: `${stem}.jpg`, content_hash: p.ocr.content_hash, verdict: null };
      log(`${pid} p${p.page_number}: ${stem}.jpg / .txt`);
    }
  }
  saveState();
}
function verdict() {
  const bookId = val('book'), n = val('page');
  const e = state.eyecheck[bookId]?.[n];
  if (!e) throw new Error(`no eyecheck entry for ${bookId} p${n}`);
  e.verdict = has('ok') ? 'pass' : has('bad') ? 'fail' : null;
  e.note = val('note');
  e.by = 'claude (headless job cbeta-5566), read from image';
  e.at = new Date().toISOString();
  saveState();
  log(`${bookId} p${n}: ${e.verdict} — ${e.note}`);
}

// ── release + publish ──────────────────────────────────────────────────────
async function release(db) {
  for (const [pid, b] of Object.entries(state.books)) {
    if (!b.book_id) continue;
    const evAll = Object.entries(state.eyecheck[b.book_id] || {});
    const cur = new Map((await db.collection('pages').find({ book_id: b.book_id, page_number: { $in: evAll.map(([n]) => Number(n)) } }, { projection: { page_number: 1, 'ocr.content_hash': 1 } }).toArray()).map((p) => [String(p.page_number), p.ocr?.content_hash]));
    const ev = evAll.filter(([n, e]) => e.content_hash && cur.get(n) === e.content_hash).map(([, e]) => e);
    if (ev.length < 2 || ev.some((e) => e.verdict !== 'pass')) { log(`${pid}: by-eye check not passed (${ev.map((e) => e.verdict).join(',')}) — stays hidden and held`); continue; }
    const book = await db.collection('books').findOne({ id: b.book_id }, { projection: { pipeline_auto: 1 } });
    if (isHeld(book) && book.pipeline_auto.hold.reason === HOLD.reason) {
      // ocr_complete, not the held-from status: the pages carry their text, and the OCR queue
      // (archive_complete) must not re-read the refused pages on the general dial.
      const r = await releaseBook(db, b.book_id, { note: `by-eye check passed on 2 pages (#${ISSUE})`, to: 'ocr_complete', source: HOLD.source });
      log(`${pid}: release ${r.outcome} → ${r.to}`);
    }
    const p = await setPublication(db, b.book_id, { state: 'public', by: IMPORTER, issue: ISSUE, note: `CBETA fit verified; by-eye check of 2 pages passed (#${ISSUE})` });
    b.published = p.status; b.released_at = new Date().toISOString();
    saveState();
    log(`${pid}: publication ${p.status}`);
  }
}

// ── translation: chained Batch lane, page-level targeting, envelope ───────
async function translate(db) {
  const { readScopeEnvelopes, getScopeSpendUsd } = await import('../lib/spend-guard.mjs');
  const { translatablePageFilter } = await import('../lib/translate-core.mjs');
  const ids = Object.values(state.books).filter((b) => b.book_id && b.published).map((b) => b.book_id);
  if (!ids.length) { log('translate: no published books'); return; }
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  let env = readScopeEnvelopes(control).find((e) => e.tag === ENVELOPE_TAG);
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  if (!env || ids.some((id) => !(env.books || []).includes(id))) {
    const out = execFileSync(process.execPath, ['scripts/maintenance/set-scope.mjs', '--tag', ENVELOPE_TAG, '--books', ids.join(','), '--budget', String(ENVELOPE_CAP),
      '--lanes', 'translate-batch-chained', '--by', `derek 2026-10-01 (#${ISSUE} brief: CBETA Chan drafts, chained Batch lane, cap $${ENVELOPE_CAP})`], { cwd: ROOT, env: process.env, encoding: 'utf8' });
    log(out.trim().split('\n').slice(-2).join(' | '));
    env = readScopeEnvelopes(await db.collection('system_config').findOne({ _id: 'processing_control' })).find((e) => e.tag === ENVELOPE_TAG);
  }
  const allIds = Object.values(state.books).filter((b) => b.book_id).map((b) => b.book_id);
  const sp = await getScopeSpendUsd(db, { ids: allIds, since: env?.created_at ? new Date(env.created_at) : new Date(Date.now() - 864e5) });
  if (sp.meterError) throw new Error(`meter unreadable: ${sp.meterError}`);
  let committed = sp.usd;
  for (const bookId of ids) {
    const ps = await db.collection('pages').find({ book_id: bookId, 'ocr.source': TEXT_SOURCE, ...translatablePageFilter({ extraSkipTypes: ['illustration'] }),
      $or: [{ 'translation.data': { $exists: false } }, { 'translation.data': null }, { 'translation.data': '' }] }, { projection: { _id: 0, id: 1 } }).toArray();
    if (!ps.length) { log(`${bookId}: nothing to translate`); continue; }
    const est = ps.length * TR_RATE;
    if (committed + est > ENVELOPE_CAP) { log(`translate: CAP — committed $${committed.toFixed(2)} + $${est.toFixed(2)} > $${ENVELOPE_CAP}`); break; }
    const pf = path.join(TDIR, `tr-pages-${bookId}.json`);
    fs.writeFileSync(pf, JSON.stringify({ [bookId]: ps.map((p) => p.id) }));
    const approved = Math.max(0.05, +(ps.length * 0.003).toFixed(2));
    let out = '';
    try {
      out = execFileSync(process.execPath, ['scripts/workers/translate-batch-worker.mjs', '--chained', '--enrol', `--pages-file=${pf}`, `--approved-usd=${approved}`], { cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 600000 });
    } catch (e) { out = `${e.stdout || ''}\n${e.stderr || ''}\nEXIT ${e.status}`; }
    fs.appendFileSync(path.join(TDIR, 'enrol.log'), `=== ${new Date().toISOString()} ${bookId}\n${out}\n`);
    const m = out.match(/run (\S+) est \$([\d.]+)/);
    log(`${bookId}: ${ps.length} pages → ${m ? `run ${m[1]} est $${m[2]}` : out.trim().split('\n').slice(-2).join(' | ')}`);
    if (m) { committed += Number(m[2]); (state.runs ||= {})[bookId] = [...((state.runs || {})[bookId] || []), m[1]]; saveState(); }
  }
}

async function report(db) {
  const rows = [];
  for (const [pid, b] of Object.entries(state.books)) {
    if (!b.book_id) { rows.push({ pid, declined: b.declined }); continue; }
    const bk = await db.collection('books').findOne({ id: b.book_id }, { projection: { visible: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1 } });
    const tr = await db.collection('pages').countDocuments({ book_id: b.book_id, 'ocr.source': TEXT_SOURCE, 'translation.data': { $nin: [null, ''], $exists: true } });
    rows.push({ pid, book_id: b.book_id, vol: b.vol, juan: b.juan, pages: bk.pages_count, fitted: b.written, refused: b.refused, translated: tr, visible: bk.visible === true, eye: Object.entries(state.eyecheck[b.book_id] || {}).map(([n, e]) => `p${n}:${e.verdict}`).join(' ') });
  }
  console.log(JSON.stringify(rows, null, 1));
}

const COMMANDS = { measure, apply, eyecheck, verdict, release, translate, report };
if (!COMMANDS[cmd]) { console.error(`usage: ${Object.keys(COMMANDS).join('|')} --text <${Object.keys(TEXTS).join('|')}>`); process.exit(2); }
if (['measure', 'verdict'].includes(cmd)) await COMMANDS[cmd]();
else {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing — run with node --env-file=/root/sourcelibrary/.env.production.local');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try { await COMMANDS[cmd](client.db('bookstore')); } finally { await client.close(); }
}
