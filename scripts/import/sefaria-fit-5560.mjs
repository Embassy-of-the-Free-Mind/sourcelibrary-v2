#!/usr/bin/env node
// PRIOR ART: scripts/import/derge-tengyur-import.mjs (#5497) — an open e-text written as `ocr.data`
// only where an independent read of the image verifies it against a wrong-page control, with the
// edition, licence and content_hash on the page; this follows its provenance block, its
// fill-only-empty-pages write and its human-edit guard. It does not fit as-is: the Esukhia text
// carries folio markers, a Sefaria version carries none, so here the span must be FOUND (neighbour
// anchors) before it is verified. scripts/lib/syriac-kraken-lane.mjs (#4883) is the Kraken invocation
// (-d horizontal-rl, --base-dir R) and the per-page engine record. scripts/batch/eternity-ab-5513.mjs
// is where the target pages come from (its state file: page_ids the A+B OCR pass left without text).
//
// Fit Sefaria's openly licensed Hebrew text to pages whose OCR failed (#5560).
//
//   1. TARGETS: pages of the book that the #5513 pass targeted and that still have no `ocr.data`.
//   2. ANCHORS: the last 60 letters of the nearest previous page WITH text, and the first 60 of the
//      nearest next one, located in the Sefaria version by 6-gram offset voting. A refused page (or a
//      run of them) sits between the two anchors; an anchor that is ambiguous, out of order, or gives
//      a span of implausible length refuses the run (`refused_reason`), it is never guessed.
//   3. READ: every target page is read by Kraken (BiblIA Hebrew model, CPU, non-generative — it
//      cannot recite, which is the point: Gemini's own reading of these books recited text that is
//      not on the page, measured on Zohar Chadash p13). A run is split between its pages by the
//      letter count of each page's read (character density).
//   4. VERIFY: the read is scored against the fitted span by letter-4-gram containment both ways
//      (precision: read ⊂ span; recall: span ⊂ read), order-free because Kraken's column order is
//      not the edition's. Controls: the same-length span shifted by ±2, ±3 page-lengths, and a far
//      span. Written only if the fitted span is the best AND beats every control by FIT_RULES margins.
//   5. WRITE: only pages with no `ocr.data` (guarded in the update filter), never a human-edited page,
//      with the Sefaria version title, licence, source URL, refs and a content_hash on the page.
//      `visible` is not touched; nothing is translated (that is #5513's lane).
//
// Usage (Hetzner):
//   node --env-file=.env.production.local scripts/import/sefaria-fit-5560.mjs plan  --book <id>
//   node --env-file=.env.production.local scripts/import/sefaria-fit-5560.mjs read  --book <id> [--par 3]
//   node --env-file=.env.production.local scripts/import/sefaria-fit-5560.mjs score --book <id>
//   node --env-file=.env.production.local scripts/import/sefaria-fit-5560.mjs write --book <id> [--dry-run]
//   … status
// Work dir: --work (default /root/claude-jobs/sefaria-5560-work): Sefaria files, images, reads, plans.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { isHumanEdited } from '../lib/syriac-kraken-lane.mjs';
import {
  flattenVersion, buildStream, buildIndex, anchorAt, fitEnd, locate, spanText, normHe, sha16,
  licenceAllowed, krakenLetters, gramBag, containment, FIT_RULES, fitClass, POINTING_RE,
} from '../lib/sefaria-fit.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const val = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);

const ISSUE = 5560;
const SWEEP = 'sefaria-fit-5560';
const PIPELINE = 'sefaria-fit-5560';
const TEXT_SOURCE = 'sefaria';
const WORK = val('work', '/root/claude-jobs/sefaria-5560-work');
const ETERNITY_STATE = val('eternity-state', '/root/claude-jobs/eternity-ab-work/state.json');
const KRAKEN_BIN = '/root/bench2-kraken/venv/bin/kraken';
const KRAKEN_MODEL = {
  key: 'biblia-01', file: '/root/.local/share/htrmopo/926633a8-35f5-5c4f-b2c2-dbb2e566e636/BiblIA_01.mlmodel',
  label: 'BiblIA — Medieval Hebrew manuscripts v1.0 (Stoekl Ben Ezra)', model_doi: '10.5281/zenodo.5468286', licence: 'CC-BY-SA-4.0',
  kraken: '7.1', flags: 'segment -bl -d horizontal-rl ocr --base-dir R',
};
const EXPORT = 'https://storage.googleapis.com/sefaria-export/';
const LICENCE_URL = { 'public domain': 'https://creativecommons.org/publicdomain/mark/1.0/', 'cc0': 'https://creativecommons.org/publicdomain/zero/1.0/', 'cc-by': 'https://creativecommons.org/licenses/by/4.0/' };

/**
 * The books #5560 names, and the Sefaria version each would fit — or why none can. A version is used
 * only if its OWN licence field (read from the downloaded file, re-checked at run time) is PD/CC0/CC-BY.
 */
export const BOOKS = {
  '69c7a0a892b884e4f8173817': { name: 'Zohar Chadash (Amsterdam 1701/2)', version: 'json/Kabbalah/Zohar/Zohar Chadash/Hebrew/Zohar Chadash.json' },
  '69c7b45e25ec2ba5ccd7f5be': { name: "Tikkunei ha-Zohar (1706)", version: 'json/Kabbalah/Zohar/Tikkunei Zohar/Hebrew/Tikkunei Zohar - Vocalized.json' },
  '69c7b18425ec2ba5ccd7f44e': { name: 'Pardes Rimmonim (Cordovero, 1786)', version: 'json/Kabbalah/Ramak/Pardes Rimmonim/Hebrew/Pardes Rimonim.json' },
  '69b3e677304c1c6b3950b41f': { name: 'Zohar on Genesis–Exodus (MS Bodley Or. 574)', version: null, refused: 'every Hebrew version of Zohar on Sefaria has licence "unknown" (Vocalized Zohar, Israel 2013; Sulam Edition, Jerusalem 1945; Hebrew Translation) — not PD/CC0/CC-BY' },
  // Sha'ar Ma'amarei Rashbi is Vital's arrangement of Luria's Zohar commentary (PD); whether this
  // manuscript follows it is MEASURED by the plan (monotone location), not assumed.
  '69b3e5b5304c1c6b395099fd': { name: "Luria's Commentary on the Zohar of Genesis (MS Oppenheim 509)", version: "json/Kabbalah/Arizal and Chaim Vital/Sha'ar Ma'amarei Rashbi/Hebrew/Shaar Maamarei Rashbi.json" },
  // Seder Nezikin, in the volume's order; Guggenheimer's text is CC-BY (Mechon-Mamre and Venice: "unknown").
  '6a357f1ac6e2d5bb56a64539': { name: 'Talmud Yerushalmi, Seder Nezikin (1922)', version: [
    'json/Talmud/Yerushalmi/Seder Nezikin/Jerusalem Talmud Bava Kamma/Hebrew/The Jerusalem Talmud, edition by Heinrich W. Guggenheimer. Berlin, De Gruyter, 1999-2015.json',
    'json/Talmud/Yerushalmi/Seder Nezikin/Jerusalem Talmud Bava Metzia/Hebrew/The Jerusalem Talmud, edition by Heinrich W. Guggenheimer. Berlin, De Gruyter, 1999-2015.json',
    'json/Talmud/Yerushalmi/Seder Nezikin/Jerusalem Talmud Bava Batra/Hebrew/The Jerusalem Talmud, edition by Heinrich W. Guggenheimer. Berlin, De Gruyter, 1999-2015.json',
    'json/Talmud/Yerushalmi/Seder Nezikin/Jerusalem Talmud Sanhedrin/Hebrew/The Jerusalem Talmud, edition by Heinrich W. Guggenheimer. Berlin, De Gruyter, 1999-2015.json',
    'json/Talmud/Yerushalmi/Seder Nezikin/Jerusalem Talmud Makkot/Hebrew/The Jerusalem Talmud, edition by Heinrich W. Guggenheimer. Berlin, De Gruyter, 1999-2015.json',
    'json/Talmud/Yerushalmi/Seder Nezikin/Jerusalem Talmud Shevuot/Hebrew/The Jerusalem Talmud, edition by Heinrich W. Guggenheimer. Berlin, De Gruyter, 1999-2015.json',
    'json/Talmud/Yerushalmi/Seder Nezikin/Jerusalem Talmud Avodah Zarah/Hebrew/The Jerusalem Talmud, edition by Heinrich W. Guggenheimer. Berlin, De Gruyter, 1999-2015.json',
    'json/Talmud/Yerushalmi/Seder Nezikin/Jerusalem Talmud Horayot/Hebrew/The Jerusalem Talmud, edition by Heinrich W. Guggenheimer. Berlin, De Gruyter, 1999-2015.json',
  ] },
};

const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
const bookDir = (id) => path.join(WORK, 'books', id);
const planFile = (id) => path.join(bookDir(id), 'plan.json');

async function loadVersion(rel) {
  const f = path.join(WORK, 'sefaria', rel.split('/').slice(-3).join('__'));
  if (!fs.existsSync(f)) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const res = await fetch(EXPORT + rel.split('/').map(encodeURIComponent).join('/'));
    if (!res.ok) throw new Error(`sefaria export ${res.status} for ${rel}`);
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  }
  const raw = fs.readFileSync(f);
  const json = JSON.parse(raw.toString('utf8'));
  if (!licenceAllowed(json.license)) throw new Error(`${rel}: licence "${json.license}" is not PD/CC0/CC-BY — refusing`);
  return { json, file_sha256: sha16(raw.toString('utf8')), rel };
}

/**
 * One stream from one or more version files (a multi-tractate volume lists them in print order).
 * Each segment carries `src` (index into `sources`) and a ref prefixed with its file's title.
 */
async function loadSefaria(cfg) {
  const rels = Array.isArray(cfg.version) ? cfg.version : [cfg.version];
  const sources = [], segments = [];
  for (const rel of rels) {
    const v = await loadVersion(rel);
    const src = sources.length;
    sources.push({ title: v.json.title, versionTitle: v.json.versionTitle, license: v.json.license, versionSource: v.json.versionSource, export_path: v.rel, file_sha16: v.file_sha256 });
    for (const seg of flattenVersion(v.json)) segments.push({ ...seg, src, ref: rels.length > 1 ? `${v.json.title} ${seg.ref}` : seg.ref });
  }
  return { sources, stream: buildStream(segments) };
}

/** Body text of a stored reading: the model's editorial/apparatus blocks dropped, tags stripped. */
export function bodyText(ocr) {
  return String(ocr || '')
    .replace(/<(header|margin|page-num|sig|image-desc|vocab|meta|warning|scan-quality|language|script|page-type|columns|catchword|footnote|note|summary)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#+\s*/gm, '');
}

/**
 * The boundary of a neighbour page, from whichever of its readings (stored OCR, Kraken read of its
 * image) aligns best above CHANCE — the same boundary letters aligned in a far window of the text.
 */
function bestAnchor(t, side, win, index, stream) {
  let best = null;
  for (const v of (t.variants || []).filter((x) => !x.sides || x.sides.includes(side))) {
    const a = anchorAt(v.q, index, stream, { side, ...win });
    if (a.pos == null) { if (!best) best = { ...a, via: v.via, chance: 0 }; continue; }
    const piece = side === 'end' ? v.q.slice(-150) : v.q.slice(0, 150);
    const farAt = (a.pos + Math.floor(stream.letters.length / 2)) % Math.max(1, stream.letters.length - 800);
    const chance = fitEnd(side === 'end' ? piece : [...piece].reverse().join(''), side === 'end' ? stream.letters.slice(farAt, farAt + 800) : [...stream.letters.slice(farAt, farAt + 800)].reverse().join('')).identity;
    const cand = { ...a, via: v.via, chance };
    if (!best || best.pos == null || cand.identity - cand.chance > best.identity - best.chance) best = cand;
  }
  return best || { pos: null, reason: 'no usable reading', identity: 0, chance: 0 };
}

// ── plan ──────────────────────────────────────────────────────────────────
async function plan(db) {
  const id = val('book');
  const cfg = BOOKS[id];
  if (!cfg) throw new Error(`unknown book ${id}`);
  fs.mkdirSync(bookDir(id), { recursive: true });
  const st = JSON.parse(fs.readFileSync(ETERNITY_STATE, 'utf8'));
  const eb = st.books.find((b) => b.id === id);
  const targetIds = new Set(eb?.page_ids || []);
  const pages = await db.collection('pages').find({ book_id: id }, { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.edited_by': 1, 'ocr.edited_at': 1, 'ocr.source': 1, photo: 1, archived_photo: 1, page_type: 1 } }).sort({ page_number: 1 }).toArray();
  const targets = pages.filter((p) => targetIds.has(p.id) && !p.ocr?.data);
  const out = { book: id, name: cfg.name, at: new Date().toISOString(), version: cfg.version, targets: targets.length, pages: [], runs: [], read_also: [] };
  if (!cfg.version) {
    out.refused = cfg.refused || 'no openly licensed Sefaria version identified';
    out.pages = targets.map((p) => ({ id: p.id, page_number: p.page_number, verdict: 'refused', reason: out.refused }));
    fs.writeFileSync(planFile(id), JSON.stringify(out, null, 1));
    log(`${cfg.name}: ${targets.length} targets — REFUSED: ${out.refused}`);
    return out;
  }
  const { sources, stream } = await loadSefaria(cfg);
  const index = buildIndex(stream.letters, 5);
  out.sefaria = { ...sources[0], sources, letters: stream.letters.length };

  // Every page with body text is located coarsely (whole-page 5-gram voting). A page whose position
  // is not monotone with its text neighbours (a repetition loop, a recited passage from elsewhere,
  // a non-Sefaria page) cannot anchor anything.
  // A neighbour whose stored OCR does not locate is given a second chance with a Kraken read of its
  // own image (a DIFFERENT image from the target's, so the target's read stays independent of the
  // anchors). Reads live in <work>/books/<id>/reads/<page_number>.txt.
  const letters = (p) => (p.ocr?.data ? normHe(bodyText(p.ocr.data)).replace(/ /g, '') : '');
  const readOf = (n, part = '') => { const f = path.join(bookDir(id), 'reads', `${n}${part}.txt`); return fs.existsSync(f) ? krakenLetters(fs.readFileSync(f, 'utf8')) : null; };
  const text = pages.map((p) => ({ p, q: letters(p), via: 'stored-ocr' })).filter((x) => x.q.length >= FIT_RULES.minTextLetters);
  const monotoneAt = (arr) => arr.forEach((t, k) => {
    const before = arr.slice(Math.max(0, k - 3), k).filter((u) => u.s != null && u.via === 'stored-ocr');
    const after = arr.slice(k + 1, k + 4).filter((u) => u.s != null && u.via === 'stored-ocr');
    const lt = before.filter((u) => u.s < t.s).length, gt = after.filter((u) => u.s > t.s).length;
    t.monotone = t.s != null && lt >= Math.min(2, before.length) && gt >= Math.min(2, after.length);
  });
  for (const t of text) { const r = locate(t.q, index, { slack: 64 }); t.s = r.pos; t.share = r.share; }
  monotoneAt(text);
  // Every text page that has a Kraken read gets it as a second variant; a page is usable if EITHER
  // variant locates monotone against the stored-OCR pages around it.
  text.forEach((t, k) => {
    t.variants = t.monotone ? [{ q: t.q, s: t.s, share: t.share, via: 'stored-ocr' }] : [];
    // The whole page's read anchors both sides; a strip read (bottom / top 30% of the image, the
    // cheap anchor read) anchors only its own side. Each must itself locate monotone.
    for (const [part, via, sides] of [['', 'kraken-read', null], ['.end', 'kraken-strip-end', ['end']], ['.start', 'kraken-strip-start', ['start']]]) {
      const kq = readOf(t.p.page_number, part);
      if (!kq || kq.length < FIT_RULES.minStripLetters) continue;
      const r = locate(kq, index, { slack: 64 });
      const probe = [...text.slice(0, k), { ...t, q: kq, s: r.pos, via }, ...text.slice(k + 1)];
      monotoneAt(probe);
      if (probe[k].monotone) t.variants.push({ q: kq, s: r.pos, share: r.share, via, ...(sides ? { sides } : {}) });
    }
  });
  for (const t of text) if (!t.monotone && t.variants.length) Object.assign(t, t.variants[0], { monotone: true, stored_s: t.s });
  const textById = new Map(text.map((t) => [t.p.id, t]));
  const lens = text.map((t) => t.q.length).sort((a, b) => a - b);
  const median = lens.length ? lens[Math.floor(lens.length / 2)] : null;
  out.median_page_letters = median;
  out.text_pages = text.length;
  out.monotone_pages = text.filter((t) => t.monotone).length;
  // How much page text per unit of Sefaria text: for consecutive (by page number) stored-OCR pages that
  // both locate, page letters ÷ the Sefaria letters between their starts. ≈1 when the print holds just
  // this text; ≈3–5 when it also prints a commentary around it (then the page's text is NOT the span).
  const adv = [];
  for (let k = 0; k + 1 < text.length; k++) {
    const a = text[k], b = text[k + 1];
    if (!a.monotone || !b.monotone || a.via !== 'stored-ocr' || b.via !== 'stored-ocr') continue;
    if (b.p.page_number !== a.p.page_number + 1 || b.s <= a.s) continue;
    adv.push(a.q.length / (b.s - a.s));
  }
  adv.sort((x, y) => x - y);
  out.page_to_text_ratio = adv.length ? { median: +adv[Math.floor(adv.length / 2)].toFixed(2), pairs: adv.length } : null;

  // Book gate: an edition that does not follow the version (few pages locate in order), or a print that
  // carries a commentary around the text (pages hold > readSpanRatio × the version's text), is refused
  // whole — no page of it could pass, and reading it would only spend CPU to say so.
  const monoShare = text.length ? out.monotone_pages / text.length : 0;
  const ptr = out.page_to_text_ratio?.median;
  if (monoShare < FIT_RULES.minMonotoneShare) out.book_refused = `the edition does not follow the Sefaria version: ${out.monotone_pages}/${text.length} text pages locate in order (< ${FIT_RULES.minMonotoneShare * 100}%)${ptr != null ? `; page/text ratio ${ptr}` : ''}`;
  else if (ptr != null && (ptr < FIT_RULES.readSpanRatio[0] || ptr > FIT_RULES.readSpanRatio[1])) out.book_refused = `each page carries ${ptr}× the Sefaria version's text (median of ${out.page_to_text_ratio.pairs} consecutive located pages) — the print has a commentary/apparatus the version lacks, so a fitted span would be a partial page`;

  // Runs: maximal sequences of pages WITHOUT body text, bounded by text pages. Every page of a run is
  // read (the split needs them all); only targets are written.
  const isTarget = new Set(targets.map((p) => p.id));
  let i = 0;
  while (i < pages.length) {
    if (!isTarget.has(pages[i].id)) { i++; continue; }
    let i0 = i; while (i0 > 0 && !textById.has(pages[i0 - 1].id)) i0--;
    let j = i; while (j + 1 < pages.length && !textById.has(pages[j + 1].id)) j++;
    const run = pages.slice(i0, j + 1);
    const prev = i0 > 0 ? textById.get(pages[i0 - 1].id) : null;
    const next = j + 1 < pages.length ? textById.get(pages[j + 1].id) : null;
    const r = { pages: run.map((p) => p.page_number), prev: prev?.p.page_number ?? null, next: next?.p.page_number ?? null,
      prev_coarse: prev ? { s: prev.s, share: +prev.share.toFixed(3), monotone: prev.monotone, via: prev.via } : null,
      next_coarse: next ? { s: next.s, share: +next.share.toFixed(3), monotone: next.monotone, via: next.via } : null };
    if (out.book_refused) r.refused_reason = out.book_refused;
    else if (!prev || !next) r.refused_reason = `no text page ${!prev ? 'before' : 'after'} the run`;
    else if (!prev.monotone) r.refused_reason = `previous page p${prev.p.page_number}: its OCR does not locate consistently in the Sefaria text`;
    else if (!next.monotone) r.refused_reason = `next page p${next.p.page_number}: its OCR does not locate consistently in the Sefaria text`;
    else if (next.s <= prev.s) r.refused_reason = 'neighbour pages out of order against Sefaria';
    else {
      const win = { lo: Math.max(0, prev.s - 500), hi: next.s + next.q.length + 500 };
      const A = bestAnchor(prev, 'end', win, index, stream);
      const B = bestAnchor(next, 'start', win, index, stream);
      const ev = (x) => ({ pos: x.pos, via: x.via || null, identity: +(x.identity || 0).toFixed(3), chance: +(x.chance || 0).toFixed(3), reason: x.reason || null });
      r.anchor_prev = ev(A); r.anchor_next = ev(B);
      const ok = (x) => x.pos != null && x.identity >= FIT_RULES.anchorIdentity && x.identity - x.chance >= FIT_RULES.anchorMargin;
      const why = (x) => (x.pos == null ? x.reason : `boundary alignment identity ${x.identity.toFixed(2)} (chance ${x.chance.toFixed(2)}) below ${FIT_RULES.anchorIdentity} / +${FIT_RULES.anchorMargin}`);
      if (!ok(A)) r.refused_reason = `previous-page anchor: ${why(A)}`;
      else if (!ok(B)) r.refused_reason = `next-page anchor: ${why(B)}`;
      else if (B.pos <= A.pos) r.refused_reason = `anchors out of order (${A.pos} → ${B.pos})`;
      else {
        const L = B.pos - A.pos;
        const exp = median ? median * run.filter((p) => isTarget.has(p.id) || !p.ocr?.data).length : null;
        r.span = { a: A.pos, b: B.pos, letters: L, expected: exp, ratio: exp ? +(L / exp).toFixed(2) : null };
        if (exp && (L / exp < FIT_RULES.spanRatio[0] || L / exp > FIT_RULES.spanRatio[1])) r.refused_reason = `span ${L} letters for ${run.length} page(s), ${r.span.ratio}× the book's median page — edition text differs or an anchor is wrong`;
      }
    }
    out.runs.push(r);
    // Neighbours to read: the previous page always (the stored OCR degenerates toward the END of a
    // page — measured on Zohar Chadash: end-boundary identity at chance, start-boundary 0.6–0.8), the
    // next page only when its stored OCR does not locate.
    if (!out.book_refused && pages[i0 - 1]) out.read_also.push({ page_number: pages[i0 - 1].page_number, side: 'end', image: pages[i0 - 1].photo || pages[i0 - 1].archived_photo });
    if (!out.book_refused && pages[j + 1] && !(next?.variants || []).some((v) => v.via === 'stored-ocr')) out.read_also.push({ page_number: pages[j + 1].page_number, side: 'start', image: pages[j + 1].photo || pages[j + 1].archived_photo });
    for (const p of run) {
      out.pages.push({ id: p.id, page_number: p.page_number, run: out.runs.length - 1, target: isTarget.has(p.id), image: p.photo || p.archived_photo, human: isHumanEdited(p.ocr),
        verdict: r.refused_reason ? 'refused' : 'pending', reason: r.refused_reason || null });
    }
    i = j + 1;
  }
  fs.writeFileSync(planFile(id), JSON.stringify(out, null, 1));
  const c = (k) => out.pages.filter((p) => p.target !== false && p.verdict === k).length;
  const reasons = {};
  for (const r of out.runs) if (r.refused_reason) { const k = r.refused_reason.replace(/[\d.]+/g, '#').slice(0, 60); reasons[k] = (reasons[k] || 0) + r.pages.length; }
  log(`${cfg.name}: ${targets.length} targets in ${out.runs.length} runs; median page ${median} letters; spanned ${c('pending')}, refused ${c('refused')}`);
  console.log(JSON.stringify(reasons, null, 1));
  return out;
}

// ── read (Kraken, CPU) ─────────────────────────────────────────────────────
async function fetchImage(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return dest;
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`image ${res.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

function krakenBatch(pairs) {
  return new Promise((resolve) => {
    const a = [];
    for (const [img, out] of pairs) a.push('-i', img, out);
    a.push('segment', '-bl', '-d', 'horizontal-rl', 'ocr', '-m', KRAKEN_MODEL.file, '--base-dir', 'R');
    // Torch takes every core per process by default; on a shared box that thrashes (load 27 on 8 cores).
    const p = spawn('nice', ['-n', '10', KRAKEN_BIN, ...a], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, OMP_NUM_THREADS: val('threads', '2'), MKL_NUM_THREADS: val('threads', '2') } });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    p.on('close', (code) => resolve({ code, err }));
  });
}

async function read() {
  const id = val('book');
  const pl = JSON.parse(fs.readFileSync(planFile(id), 'utf8'));
  if (pl.book_refused || pl.refused) { log(`read: book refused — ${pl.book_refused || pl.refused}`); return; }
  const dir = path.join(bookDir(id), 'reads');
  fs.mkdirSync(dir, { recursive: true });
  // Every page of a spanned run is read (a run is split by its pages' read lengths), refused runs are not.
  // Every page of every run (an anchor refusal may clear once the neighbours are read) and the runs'
  // neighbour pages. Books refused outright (licence) have no runs.
  // --phase anchors: only the neighbour pages (they decide whether a run can be spanned at all);
  // --phase targets: only pages of runs the last plan SPANNED. Default: both.
  const phase = val('phase', 'all');
  const want = phase === 'anchors' ? (pl.read_also || [])
    : phase === 'targets' ? pl.pages.filter((p) => !pl.runs[p.run]?.refused_reason)
    : [...pl.pages, ...(pl.read_also || [])];
  // An anchor-phase read is a STRIP: the bottom 30% of the previous page (its last lines — in a
  // right-to-left two-column page, the foot of the left column, which -d horizontal-rl reads last) or
  // the top 30% of the next page. About a quarter of a full read's CPU.
  const part = (p) => (phase === 'anchors' && p.side ? `.${p.side}` : '');
  const seen = new Set();
  const todo = want.filter((p) => p.image && !seen.has(p.page_number + part(p)) && seen.add(p.page_number + part(p))
    && !fs.existsSync(path.join(dir, `${p.page_number}.txt`)) && !fs.existsSync(path.join(dir, `${p.page_number}${part(p)}.txt`)));
  log(`read: ${todo.length} ${phase === 'anchors' ? 'strips' : 'pages'} to read`);
  const pairs = [];
  const sharp = (await import('sharp')).default;
  for (const p of todo) {
    try {
      const full = await fetchImage(p.image, path.join(dir, `${p.page_number}.jpg`));
      let img = full;
      if (part(p)) {
        img = path.join(dir, `${p.page_number}${part(p)}.jpg`);
        const m = await sharp(full).metadata();
        const h = Math.round(m.height * 0.3);
        await sharp(full).extract({ left: 0, top: p.side === 'end' ? m.height - h : 0, width: m.width, height: h }).jpeg({ quality: 92 }).toFile(img);
      }
      pairs.push([img, path.join(dir, `${p.page_number}${part(p)}.txt`)]);
    } catch (e) { log(`  p${p.page_number}: ${e.message}`); }
  }
  const par = Number(val('par', '3'));
  const chunk = Math.max(1, Math.ceil(pairs.length / par));
  const t0 = Date.now();
  const res = await Promise.all(Array.from({ length: par }, (_, k) => pairs.slice(k * chunk, (k + 1) * chunk)).filter((x) => x.length).map(krakenBatch));
  for (const r of res) if (r.code !== 0) log(`  kraken exit ${r.code}: ${r.err.split('\n').slice(-3).join(' | ')}`);
  const done = pairs.filter(([, o]) => fs.existsSync(o)).length;
  log(`read: ${done}/${pairs.length} read in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

// ── score ──────────────────────────────────────────────────────────────────
async function score() {
  const id = val('book');
  const pl = JSON.parse(fs.readFileSync(planFile(id), 'utf8'));
  const cfg = BOOKS[id];
  const { stream } = await loadSefaria(cfg);
  const dir = path.join(bookDir(id), 'reads');
  const readOf = (n) => { const f = path.join(dir, `${n}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
  const far = Math.floor(stream.letters.length / 2);
  for (const [ri, r] of pl.runs.entries()) {
    if (r.refused_reason) continue;
    const mine = pl.pages.filter((p) => p.run === ri);
    const reads = r.pages.map((n) => readOf(n));
    if (reads.some((t) => t == null)) { for (const p of mine) { p.verdict = 'pending'; p.reason = 'not read yet'; } continue; }
    // Split [a, b) by each page's read letter count.
    const lens = reads.map((t) => krakenLetters(t).length);
    const tot = lens.reduce((x, y) => x + y, 0);
    let a = r.span.a;
    const cuts = [];
    for (let k = 0; k < r.pages.length; k++) {
      const b = k === r.pages.length - 1 ? r.span.b : a + Math.round((r.span.b - r.span.a) * (tot ? lens[k] / tot : 1 / r.pages.length));
      cuts.push([a, b]); a = b;
    }
    r.cuts = cuts;
    for (const p of mine) {
      const k = r.pages.indexOf(p.page_number);
      const [x, y] = cuts[k];
      const sc = scoreFit(reads[k], stream, x, y, far);
      p.score = sc;
      p.span = { a: x, b: y };
      const cls = fitClass(sc);
      p.verdict = cls === 'verified' ? (p.human ? 'refused' : 'verified') : 'refused';
      p.reason = cls === 'verified' ? (p.human ? 'human-edited page' : null)
        : cls === 'uninformative' ? `read uninformative (${sc.read_letters} letters; precision ${sc.precision})`
        : cls === 'misaligned' ? `read fits shift ${sc.best_shift} better than the fitted span`
        : cls === 'coverage' ? `read ${sc.read_letters} letters vs span ${sc.span_letters}: the page carries text the Sefaria version does not (or the span is wrong) — a partial page is not written`
        : `F1 ${sc.f1} vs wrong-page control ${sc.control}: below margin ${FIT_RULES.minMargin} / ratio ${FIT_RULES.minRatio}`;
    }
  }
  fs.writeFileSync(planFile(id), JSON.stringify(pl, null, 1));
  const c = (k) => pl.pages.filter((p) => p.verdict === k).length;
  log(`${pl.name}: verified ${c('verified')}, refused ${c('refused')}, pending ${c('pending')} of ${pl.pages.length}`);
}

/** Score a read against [a, b) and against shifted / far spans of the same length. */
export function scoreFit(readText, stream, a, b, far) {
  const L = b - a;
  const R = gramBag(krakenLetters(readText));
  const at = (x) => (x < 0 || x + L > stream.letters.length ? null : gramBag(stream.letters.slice(x, x + L)));
  const f = (S) => { if (!S) return null; const p = containment(R, S), r = containment(S, R); return { p, r, f1: p + r ? (2 * p * r) / (p + r) : 0 }; };
  const by = {};
  for (const d of [-3, -2, -1, 0, 1, 2, 3]) { const m = f(at(a + d * L)); if (m) by[d] = m; }
  const farM = f(at(far));
  const ctrl = [...Object.entries(by).filter(([d]) => Math.abs(d) >= 2).map(([, m]) => m.f1), ...(farM ? [farM.f1] : [])];
  const best = Object.keys(by).map(Number).reduce((x, y) => (by[y].f1 > by[x].f1 ? y : x), 0);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return {
    read_letters: krakenLetters(readText).length, span_letters: L,
    precision: r3(by[0]?.p ?? 0), recall: r3(by[0]?.r ?? 0), f1: r3(by[0]?.f1 ?? 0),
    best_shift: best, control: r3(ctrl.length ? Math.max(...ctrl) : 0), far_control: farM ? r3(farM.f1) : null,
    by_shift: Object.fromEntries(Object.entries(by).map(([d, m]) => [d, r3(m.f1)])),
  };
}

// ── write ──────────────────────────────────────────────────────────────────
const CONVENTIONS = 'Sefaria segment text with its HTML markup removed; one Sefaria segment per line. A page boundary falls at a word boundary (a word broken across pages belongs to the page it starts on). Niqqud and cantillation are removed when the print is unpointed (the Sefaria version\'s pointing is that edition\'s, not this print\'s). Spelling, abbreviations and wording are Sefaria\'s base edition, not this print: where the two editions differ, this text follows Sefaria.';

async function write(db) {
  const id = val('book');
  const dry = has('dry-run');
  const pl = JSON.parse(fs.readFileSync(planFile(id), 'utf8'));
  const cfg = BOOKS[id];
  const { stream } = await loadSefaria(cfg);
  const pointedPrint = !!pl.print_pointed;
  const now = new Date();
  let written = 0, raced = 0;
  for (const p of pl.pages.filter((x) => x.target && x.verdict === 'verified' && !x.written_at)) {
    let text = spanText(stream, p.span.a, p.span.b);
    if (!pointedPrint) text = text.replace(POINTING_RE, '').normalize('NFC');
    const refs = [stream.segments[stream.seg[p.span.a]].ref, stream.segments[stream.seg[p.span.b - 1]].ref];
    const src = pl.sefaria.sources[stream.segments[stream.seg[p.span.a]].src];
    const ocr = {
      data: text, content_hash: sha16(text), language: 'Hebrew', source: TEXT_SOURCE, pipeline: PIPELINE,
      model: `sefaria/${src.versionTitle}`,
      // #5571 contract: the reader shows "Text: <source>, <licence>" from this; a page without a
      // non-empty licence is never written (asserted below).
      text_source: { name: `Sefaria — ${src.title}`, url: `https://www.sefaria.org/${encodeURIComponent(src.title.replace(/ /g, '_'))}`, license: src.license,
        license_url: LICENCE_URL[String(src.license).toLowerCase()] || null, version: src.versionTitle, content_hash: sha16(text) },
      text_edition: {
        name: `Sefaria — ${src.title}, “${src.versionTitle}”`, title: src.title, versionTitle: src.versionTitle,
        licence: src.license, licence_source: 'the version\'s own `license` field in the Sefaria export file', version_source: src.versionSource,
        export: `${EXPORT}${src.export_path}`, export_sha16: src.file_sha16, refs: { from: refs[0], to: refs[1] },
        letters: { from: p.span.a, to: p.span.b }, conventions: CONVENTIONS, issue: ISSUE,
      },
      alignment: {
        method: 'neighbour anchors (last/first 60 letters of the adjacent pages\' OCR, 6-gram offset voting); a run split by read letter counts',
        verified_by: { engine: `kraken ${KRAKEN_MODEL.kraken}`, model: KRAKEN_MODEL.label, model_doi: KRAKEN_MODEL.model_doi, flags: KRAKEN_MODEL.flags },
        score: p.score, rules: FIT_RULES, run: pl.runs[p.run] ? { pages: pl.runs[p.run].pages, prev: pl.runs[p.run].prev, next: pl.runs[p.run].next } : null,
        image_url: p.image, measured_at: pl.scored_at || now,
      },
      generated_at: now, updated_at: now,
    };
    if (!licenceAllowed(ocr.text_source.license)) throw new Error(`p${p.page_number}: text licence "${ocr.text_source.license}" — refusing to write`);
    if (dry) { written++; continue; }
    const r = await db.collection('pages').updateOne(
      { id: p.id, book_id: id, $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }], 'ocr.edited_by': { $exists: false }, 'ocr.edited_at': { $exists: false } },
      { $set: { ocr, updated_at: now } },
    );
    if (r.modifiedCount) { written++; p.written_at = now.toISOString(); } else { raced++; p.verdict = 'refused'; p.reason = 'page gained text or an edit before the write — left alone'; }
  }
  if (!dry) {
    fs.writeFileSync(planFile(id), JSON.stringify(pl, null, 1));
    await recordSweepAction(db, { sweep: SWEEP, book_id: id, action: 'sefaria-fit-written', detail: { written, raced, verified: pl.pages.filter((x) => x.verdict === 'verified').length, refused: pl.pages.filter((x) => x.verdict === 'refused').length, version: pl.sefaria.versionTitle, licence: pl.sefaria.license } });
  }
  log(`${pl.name}: ${dry ? 'would write' : 'wrote'} ${written} pages${raced ? `, ${raced} skipped (gained text meanwhile)` : ''}`);
}

async function status() {
  for (const id of Object.keys(BOOKS)) {
    if (!fs.existsSync(planFile(id))) { console.log(id, BOOKS[id].name, 'no plan'); continue; }
    const pl = JSON.parse(fs.readFileSync(planFile(id), 'utf8'));
    const c = {}; for (const p of pl.pages) c[p.verdict + (p.written_at ? '+written' : '')] = (c[p.verdict + (p.written_at ? '+written' : '')] || 0) + 1;
    console.log(id, pl.name, JSON.stringify(c));
  }
}

const COMMANDS = { plan, read, score, write, status };
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  if (!COMMANDS[cmd]) { console.error(`usage: ${Object.keys(COMMANDS).join('|')} --book <id>`); process.exit(2); }
  if (['read', 'score', 'status'].includes(cmd)) await COMMANDS[cmd]();
  else await withMongo(async (db) => { await COMMANDS[cmd](db); }, { noTimeout: true });
}
