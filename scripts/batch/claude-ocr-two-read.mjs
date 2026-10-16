#!/usr/bin/env node
// PRIOR ART: scripts/batch/claude-ocr.mjs — the one-read Opus reader (sealed `claude -p --restricted --tools Read`,
// live OCR prompt, subscription only); its `claudeCall` is imported here. It reads pages with NO text, once, and
// writes nothing. scripts/batch/cli-ocr.mjs `apply` — THE writer for those reads; its guards are reproduced below
// (one-page-at-a-time checks, page_revisions, sweep_log, book_events, the shared provenance builder). Neither does
// two independent reads, a diff and a zoomed adjudication, and cli-ocr's 40%-overlap guard would refuse every
// replacement of the flash-lite text this lane exists to replace (#6780 "Kurrent reader reference test").
/**
 * Two-read Opus OCR for hands Gemini flash-lite cannot read (German Kurrent manuscripts first: the Heidelberg
 * cookbooks, #6780). Readers may COOK from these, so a wrong quantity is the failure that matters: one Opus pass got
 * about one quantity or ingredient per page wrong on the reference test, and a diff of two passes pointed at it.
 *
 * WHO RUNS IT: an operator at a Hetzner box with `claude` signed in to the subscription (never the API key: the
 * env is stripped). Nothing here calls a paid API.
 *
 *   read   node --env-file=.env.production.local scripts/batch/claude-ocr-two-read.mjs read --out=DIR
 *              (--page-ids-file=F | --books-file=F [--pages=FROM-TO]) [--model=opus] [--concurrency=2] [--max-pages=N]
 *          Per page: cut the archived image into 4 overlapping horizontal strips at native resolution; two
 *          INDEPENDENT sealed reads (A, B: separate sessions, same prompt, same files); a token diff with spelling
 *          folded (ai/ei, v/u, ß/ss, umlauts, ſ); where they disagree, ONE adjudication call that gets the disputed
 *          spans, the strips and 2x zoom crops, and rules on each span. The final text is A with every disputed span
 *          replaced by its ruling. Writes DIR/<page_id>.txt + .meta.json (both reads in full, every dispute and
 *          ruling). Writes NOTHING to the database. Re-running skips pages already read.
 *
 *   apply  node --env-file=.env.production.local scripts/batch/claude-ocr-two-read.mjs apply --out=DIR --reason="..."
 *              [--replace-lite-books=F] [--apply]
 *          Dry run unless --apply. The cli-ocr.mjs guards, page by page: human-edited page, OCR rewritten after the
 *          read, empty / over-long / headerless / doubled read, refusal, chatter, repetition loop, prompt hash; then
 *          snapshot to page_revisions, write `ocr` with an `anthropic` engine block whose `input.two_read` records
 *          both reads (hashes) and every dispute with its ruling, a sweep_log row per page and a book_events row
 *          per book. A page with a translation gets `translation_stale` (lane below).
 *
 * THE OVERLAP GUARD. cli-ocr refuses a read that shares under 40% of its long words with the stored text. Here that
 * guard stays, EXCEPT where the stored text is a flash-lite read (source ai / batch_api) on a book listed in
 * --replace-lite-books: on those the stored text is the known-bad read this lane replaces (#6780: lite turned
 * Zucker into "Zuber" and stopped after 14 lines), so low overlap is the expected finding, not a warning.
 *
 * BLANK PAGES. The live prompt's blank / show-through rules are sent unchanged; a blank verso must come out as
 * <page-type>blank</page-type>. When one read says blank and the other transcribes, the whole body is ONE dispute
 * and the adjudicator rules on it with the zoom crops.
 *
 * HOW IT FAILS. A usage-limit reply stops the run (exit 3), pages done so far kept. A read that is not a clean
 * <<<BEGIN>>>…<<<END>>> transcription is retried once; a page whose reads or adjudication still fail, or that has
 * over MAX_DISPUTES disputes, gets an empty .txt and a non-zero `exit`, which `apply` skips and counts.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readPageIdsFile, parseBookIds } from '../lib/ocr-targeting.mjs';
import { geminiEngine, engineNameForCli, imageInput, ocrProvenance, notRecorded, contentHash, codeVersion, host } from '../lib/write-provenance.mjs';
import { ocrReadProblem, unwrapSentinels, OCR_SENTINEL_INSTRUCTION } from '../lib/cli-chatter.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { liveOcrPrompt } from '../lib/live-ocr-prompt.mjs';
import { claudeCall } from './claude-ocr.mjs';

const CALL_SITE = 'scripts/batch/claude-ocr-two-read.mjs';
const CLI = 'claude';
/** `ocr.pipeline` on every page this lane writes, and the `translation_stale` lane. */
export const LANE = 'claude-two-read-6780';
const STRIPS = 4;
const OVERLAP = 0.06;
const MAX_DISPUTES = 80;

/** The `{language_instruction}` slot: an early-modern German manuscript hand, spelling kept, quantities exact. */
export const KURRENT_INSTRUCTION = '**Source language:** This book is a German manuscript of the 15th–17th century, written in a Kurrent / Gothic cursive hand; it may also carry Latin. Report the primary language of THIS page in the <language> tag (e.g. <language>German</language>).\n'
  + '**Early New High German spelling (CRITICAL):** keep the scribe\'s spelling exactly as written, never modernised: ai/ay, ey, vnd, v for u and u for v, j for i, ÿ, doubled consonants, the scribe\'s capitals. A small e or o written above a vowel is kept as written (ů, ü, ö, ä). Numbers, fractions and units (achtel, maß, lot, quintlin, ℔, ß) are CRITICAL: a reader may cook from this page, so read every number word and numeral letter by letter and mark any you cannot settle with <unclear>.';

const readInstruction = () => '\n\n**This call: one manuscript page, as five image files in this folder.** `page.jpg` is the whole page (use it for the layout only). `s1.jpg` … `s4.jpg` are overlapping horizontal strips of the same page, top to bottom, at full resolution: READ THE TEXT FROM THE STRIPS. A line that falls in the overlap of two strips appears in both: transcribe it once. Open every file with the Read tool before you answer. Transcribe the page in the format above. '
  + OCR_SENTINEL_INSTRUCTION + '\n';

// ── the diff ──

/** Split text into tokens that each carry their trailing whitespace; `lead` is the whitespace before the first. */
export function tokenize(text) {
  const t = String(text ?? '');
  const lead = t.match(/^\s*/)[0];
  return { lead, toks: t.slice(lead.length).match(/\S+\s*/g) || [] };
}

/** A token folded for comparison: spelling variants that do not change meaning compare equal. Digits never fold. */
export function foldToken(tok) {
  return String(tok).trim().toLowerCase()
    .replace(/<\/?unclear>/g, '')
    .replace(/ſ/g, 's').replace(/ß/g, 'ss').replace(/ꝛ/g, 'r')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[.,;:!?()[\]"'„“”‚‘’·/=¬-]+/g, '')
    .replace(/v/g, 'u').replace(/j/g, 'i').replace(/y/g, 'i')
    .replace(/ai|ei|ey|ay/g, 'ei')
    .replace(/(\p{L})\1+/gu, '$1');
}

const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);
/** The reader's notes about the page, not words on it. <page-type> is NOT one: blank against text is a dispute. */
const NOTE = /<(warning|meta|vocab|image-desc|scan-quality|language|script)\b[^>]*>[\s\S]*?<\/\1>/g;
/** For each token of a tokenized read: does it start inside a note element? */
function inNotes({ lead, toks }) {
  const text = lead + toks.join('');
  const spans = [...text.matchAll(NOTE)].map((x) => [x.index, x.index + x[0].length]);
  let at = lead.length;
  return toks.map((t) => { const s = at; at += t.length; return spans.some(([a, b]) => s >= a && s < b); });
}

/**
 * Align read A against read B. Returns the folded word agreement (2·matched / (|A|+|B|)), the exact agreement, and
 * the disputed spans as `hunks` [{a0,a1,b0,b1}] (token index ranges, end exclusive). Spans separated by two equal
 * tokens or fewer are merged, so the adjudicator rules on a phrase, not on fragments of it.
 */
export function diffReads(textA, textB) {
  const A = tokenize(textA), B = tokenize(textB);
  const fa = A.toks.map(foldToken), fb = B.toks.map(foldToken);
  const n = fa.length, m = fb.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = fa[i] === fb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (fa[i] === fb[j]) { pairs.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  const na = inNotes(A), nb = inNotes(B);
  let hunks = [];
  let pi = 0, pj = 0;
  for (const [i, j] of [...pairs, [n, m]]) {
    if (i > pi || j > pj) {
      // The readers' own notes (<warning>, <meta>, <vocab>…) are never disputed: read A's stand. A hunk is narrowed to
      // the page text on each side, so a ruling is never asked to choose a body reading and a note together (pilot
      // p200: one span joined A's <meta> to "geust ein wenig wein" against B's "zeuch ain wenig weinbern").
      const ab = range(pi, i).filter((k) => !na[k]), bb = range(pj, j).filter((k) => !nb[k]);
      const contiguous = (xs) => xs.length < 2 || xs[xs.length - 1] - xs[0] === xs.length - 1;
      if (ab.length || bb.length) {
        if (!contiguous(ab) || !contiguous(bb)) hunks.push({ a0: pi, a1: i, b0: pj, b1: j });
        else hunks.push({ a0: ab.length ? ab[0] : i, a1: ab.length ? ab[ab.length - 1] + 1 : i, b0: bb.length ? bb[0] : j, b1: bb.length ? bb[bb.length - 1] + 1 : j });
      }
    }
    pi = i + 1; pj = j + 1;
  }
  const merged = [];
  for (const h of hunks) {
    const last = merged[merged.length - 1];
    if (last && h.a0 - last.a1 <= 2 && h.b0 - last.b1 <= 2 && !range(last.a1, h.a0).some((k) => na[k])) { last.a1 = h.a1; last.b1 = h.b1; } else merged.push({ ...h });
  }
  hunks = merged;
  const exact = pairs.filter(([i, j]) => A.toks[i].trim() === B.toks[j].trim()).length;
  return { A, B, hunks, agreement_folded: n + m ? (2 * pairs.length) / (n + m) : 1, agreement_exact: n + m ? (2 * exact) / (n + m) : 1 };
}

const span = (toks, i0, i1) => toks.slice(i0, i1).join('').trim();

/** The adjudication instruction: every disputed span with its context, the line it is on, and the two readings. */
export function adjudicationPrompt(d) {
  const { A, B, hunks } = d;
  const lines = (A.lead + A.toks.join('')).split('\n').length;
  const items = hunks.map((h, k) => {
    const line = (A.lead + A.toks.slice(0, h.a0).join('')).split('\n').length;
    const before = span(A.toks, Math.max(0, h.a0 - 6), h.a0).replace(/\s+/g, ' ');
    const after = span(A.toks, h.a1, h.a1 + 6).replace(/\s+/g, ' ');
    return `D${k + 1} — around line ${line} of ${lines}, after «${before}» and before «${after}»:\n  reading A: «${span(A.toks, h.a0, h.a1) || '(nothing)'}»\n  reading B: «${span(B.toks, h.b0, h.b1) || '(nothing)'}»`;
  });
  return 'Two independent transcriptions of one German manuscript page disagree at the places listed below. You are the adjudicator. '
    + 'The folder holds the page (`page.jpg`), four overlapping horizontal strips top to bottom at full resolution (`s1.jpg` … `s4.jpg`), and each strip\'s left and right half at 2x zoom (`s1L.jpg`, `s1R.jpg`, … `s4R.jpg`). '
    + 'For EACH disputed place: find the line in the strips, open the zoom crop that holds it with the Read tool, and write what the manuscript actually says there. '
    + 'That may be reading A, reading B, or a better reading than either. Keep the scribe\'s spelling (vnd, ain, seyen). Numbers, fractions and units are CRITICAL: a reader may cook from this page. '
    + 'Put a word you still cannot settle inside <unclear>…</unclear>. If neither reading\'s words are on the page (show-through, an invented line), answer (nothing). Keep any tags (<page-type>, <unclear>, <header>…) in the same format as the readings. '
    + 'Keep the line breaks the page has: when the span runs over a line end, write the line break.\n\n'
    + items.join('\n\n')
    + `\n\nAnswer with, for each place in order, a line \`===== Dn =====\` followed by your reading of that span only (not its context). Output nothing before the first marker and no commentary anywhere. There are ${hunks.length} places: D1 … D${hunks.length}.\n`;
}

/** Split an adjudication reply into n rulings, or null when the markers are not exactly D1..Dn in order. */
export function parseRulings(reply, n) {
  const re = /^[ \t]*=====\s*D(\d+)\s*=====[ \t]*$/gm;
  const t = String(reply || '');
  const marks = [...t.matchAll(re)];
  if (marks.length !== n || marks.some((mk, i) => Number(mk[1]) !== i + 1) || t.slice(0, marks[0]?.index ?? 0).trim()) return null;
  return marks.map((mk, i) => {
    const r = t.slice(mk.index + mk[0].length, i + 1 < n ? marks[i + 1].index : undefined).replace(/^\n+|\s+$/g, '');
    return /^\(nothing\)$/i.test(r.trim()) ? '' : r;
  });
}

/**
 * Read A with every disputed span replaced by its ruling. A ruling that folds equal to one read's span keeps that
 * read's exact tokens (so its line breaks survive); any other ruling is written as given, followed by the whitespace
 * that ended the span. Returns { text, disputes } — `disputes` is the record that goes into provenance.
 */
export function assemble(d, rulings) {
  const { A, B, hunks } = d;
  const foldSpan = (s) => tokenize(s).toks.map(foldToken).join(' ');
  let out = A.lead, i = 0;
  const disputes = [];
  hunks.forEach((h, k) => {
    out += A.toks.slice(i, h.a0).join('');
    const a = A.toks.slice(h.a0, h.a1).join(''), b = B.toks.slice(h.b0, h.b1).join('');
    const r = rulings[k];
    const chose = foldSpan(r) === foldSpan(a) ? 'A' : foldSpan(r) === foldSpan(b) ? 'B' : 'other';
    const tail = ((h.a1 > h.a0 ? A.toks[h.a1 - 1] : h.b1 > h.b0 ? B.toks[h.b1 - 1] : ' ').match(/\s*$/)[0]) || ' ';
    out += chose === 'A' ? a : chose === 'B' ? b : (r ? r.replace(/\s+$/, '') + tail : '');
    disputes.push({ id: `D${k + 1}`, a: a.trim(), b: b.trim(), ruling: r.trim(), chose });
    i = h.a1;
  });
  out += A.toks.slice(i).join('');
  return { text: out.trim(), disputes };
}

/**
 * The overlap-guard exception: the stored text is a flash-lite read on a book in the run list, so this lane is
 * here to replace it and low overlap with it is expected. Anything else keeps cli-ocr's 40% guard.
 */
export function replacesLite(page, liteBooks) {
  return !!(liteBooks?.has(page.book_id) && ['ai', 'batch_api'].includes(page.ocr?.source) && /flash-lite/.test(page.ocr?.model || ''));
}

// ── read ──

async function cutImages(buf, dir, { zoom }) {
  const sharp = (await import('sharp')).default;
  const { width: W, height: H } = await sharp(buf).metadata();
  fs.writeFileSync(path.join(dir, 'page.jpg'), buf);
  const step = Math.ceil(H / STRIPS), ov = Math.round(H * OVERLAP);
  for (let k = 0; k < STRIPS; k++) {
    const top = Math.max(0, k * step - ov), bottom = Math.min(H, (k + 1) * step + ov);
    const strip = await sharp(buf).extract({ left: 0, top, width: W, height: bottom - top }).jpeg({ quality: 92 }).toBuffer();
    fs.writeFileSync(path.join(dir, `s${k + 1}.jpg`), strip);
    if (!zoom) continue;
    const half = Math.ceil(W / 2), hov = Math.round(W * 0.04);
    for (const [side, left, w] of [['L', 0, Math.min(W, half + hov)], ['R', Math.max(0, half - hov), W - Math.max(0, half - hov)]]) {
      const z = await sharp(strip).extract({ left, top: 0, width: w, height: bottom - top }).resize({ width: w * 2, kernel: 'lanczos3' }).jpeg({ quality: 92 }).toBuffer();
      fs.writeFileSync(path.join(dir, `s${k + 1}${side}.jpg`), z);
    }
  }
  return { width: W, height: H, strips: STRIPS, overlap_px: ov };
}

async function read() {
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  const OUT = path.resolve(arg('out'));
  const MODEL = arg('model') || 'opus';
  const CONCURRENCY = Math.max(1, Math.min(4, Number(arg('concurrency') || 2)));
  const MAX_PAGES = Number(arg('max-pages') || Infinity);
  const JOB = arg('job') || 'two-read';
  if (!(arg('page-ids-file') || arg('books-file'))) { console.error('read needs --page-ids-file=F or --books-file=F'); process.exit(2); }
  const version = spawnSync(CLI, ['--version'], { encoding: 'utf8' }).stdout?.trim();
  if (!version) { console.error(`${CLI} is not installed or not on PATH`); process.exit(1); }
  if (!/--restricted/.test(spawnSync(CLI, ['--help'], { encoding: 'utf8' }).stdout || '')) { console.error('this claude CLI has no --restricted: refusing to run an unsealed reader'); process.exit(2); }

  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const [from, to] = (arg('pages') || '').split('-').map(Number);
  const filter = arg('page-ids-file') ? { id: { $in: readPageIdsFile(arg('page-ids-file')) } }
    : { book_id: { $in: parseBookIds(fs.readFileSync(arg('books-file'), 'utf8')) }, ...(from && { page_number: { $gte: from, $lte: to || from } }) };
  const pages = await db.collection('pages').find(filter, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, 'ocr.edited_by': 1, 'ocr.source': 1 } }).sort({ book_id: 1, page_number: 1 }).toArray();
  const { base, ref } = await liveOcrPrompt(db, KURRENT_INSTRUCTION);
  await client.close();

  fs.mkdirSync(path.join(OUT, 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'prompt-ref.json'), JSON.stringify(ref));
  const savePrompt = (text) => { const h = contentHash(text); const f = path.join('prompts', `${h}.txt`); if (!fs.existsSync(path.join(OUT, f))) fs.writeFileSync(path.join(OUT, f), text); return { hash: h, file: f }; };
  const sent = base + readInstruction();
  const sentRef = savePrompt(sent);
  const done = (p) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, `${p.id}.meta.json`), 'utf8')).exit === 0; } catch { return false; } };
  const human = pages.filter((p) => p.ocr?.edited_by || p.ocr?.source === 'manual');
  const todo = pages.filter((p) => !done(p) && !human.includes(p)).slice(0, MAX_PAGES);
  console.log(`${pages.length} pages; ${human.length} human-edited (never read); ${todo.length} to read; model ${MODEL}; ${CLI} ${version}; ${CONCURRENCY} pages at a time; prompt ${ref.name} v${ref.version}`);

  const sealRoot = path.join(process.env.TMPDIR || os.tmpdir(), 'claude-ocr-two-read', path.basename(OUT));
  const callLog = path.join(OUT, 'calls.jsonl');
  let stop = null;
  const t00 = Date.now();

  /** One sealed call over a fresh copy of the page's images. */
  const call = async (p, label, prompt, buf, zoom) => {
    const dir = path.join(sealRoot, `${JOB}-${p.id}-${label}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const geom = await cutImages(buf, dir, { zoom });
    const r = await claudeCall(prompt, MODEL, dir);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.appendFileSync(callLog, JSON.stringify({ ts: new Date().toISOString(), page_id: p.id, book_id: p.book_id, page: p.page_number, call: label, model: r.model, secs: Math.round(r.secs), cls: r.cls, usage: r.usage }) + '\n');
    if (r.cls === 'usage_limit') stop = `usage limit: ${r.err || r.text.slice(0, 200)}`;
    return { ...r, geom };
  };
  /** A transcription read, retried once when the reply is not a clean sentinel-wrapped transcription. */
  const transcribe = async (p, label, buf) => {
    let last;
    for (let attempt = 0; attempt < 2 && !stop; attempt++) {
      const r = await call(p, `${label}${attempt}`, sent, buf, false);
      const u = unwrapSentinels(r.text);
      const text = u.inside ?? '';
      const problem = r.cls || (u.inside == null ? 'no BEGIN marker' : !u.closed ? 'cut before END' : u.outside ? 'text outside the markers' : ocrReadProblem(text));
      last = { label, text, problem, model: r.model, secs: Math.round(r.secs), usage: r.usage, geom: r.geom, attempts: attempt + 1, raw_tail: problem ? r.text.slice(-300) : undefined };
      if (!problem) break;
    }
    return last;
  };

  const readPage = async (p) => {
    const t0 = new Date();
    const src = getPageSource(p);
    const fail = (error_class, extra = {}) => {
      fs.writeFileSync(path.join(OUT, `${p.id}.txt`), '');
      fs.writeFileSync(path.join(OUT, `${p.id}.meta.json`), JSON.stringify({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, cli: CLI, cli_version: version, read_site: CALL_SITE, model: MODEL, started_at: t0.toISOString(), finished_at: new Date().toISOString(), exit: 1, error_class, image_url: src, ...extra }, null, 1));
      console.log(`  ${p.book_id} p.${p.page_number}: ${error_class}`);
    };
    if (!src) return fail('no usable image');
    const res = await fetch(src);
    if (!res.ok) return fail(`image HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const image = { image_url: src, image_bytes: buf.length, image_sha256: createHash('sha256').update(buf).digest('hex') };
    // The two reads run side by side: separate sessions, neither sees the other.
    const [ra, rb] = await Promise.all([transcribe(p, 'A', buf), transcribe(p, 'B', buf)]);
    const reads = [ra, rb].map((r) => r && { call: r.label, model: r.model, text: r.text, text_hash: contentHash(r.text), chars: r.text.length, secs: r.secs, attempts: r.attempts, usage: r.usage, problem: r.problem || null, raw_tail: r.raw_tail });
    if (stop) return;
    if (ra.problem || rb.problem) return fail(`read ${ra.problem ? 'A' : 'B'}: ${ra.problem || rb.problem}`, { ...image, two_read: { reads } });
    const d = diffReads(ra.text, rb.text);
    const two = { method: 'two independent reads, folded token diff, zoomed adjudication of the disputed spans', strips: ra.geom, model_requested: MODEL, reads, agreement_folded: +d.agreement_folded.toFixed(4), agreement_exact: +d.agreement_exact.toFixed(4), adjudication: null, disputes: [] };
    let text = ra.text;
    if (d.hunks.length > MAX_DISPUTES) return fail(`disputes_over_cap: ${d.hunks.length} > ${MAX_DISPUTES}`, { ...image, two_read: two });
    if (d.hunks.length) {
      const prompt = adjudicationPrompt(d);
      const pr = savePrompt(prompt);
      let rulings = null, r;
      for (let attempt = 0; attempt < 2 && !rulings && !stop; attempt++) {
        r = await call(p, `J${attempt}`, prompt, buf, true);
        rulings = r.cls ? null : parseRulings(r.text, d.hunks.length);
      }
      if (stop) return;
      two.adjudication = { model: r.model, secs: Math.round(r.secs), usage: r.usage, prompt_sent_hash: pr.hash, prompt_sent_file: pr.file, ok: !!rulings };
      if (!rulings) return fail(`adjudication: ${r.cls || 'dispute markers do not match'}`, { ...image, two_read: two, adjudication_tail: r.text.slice(-500) });
      const a = assemble(d, rulings);
      text = a.text;
      two.disputes = a.disputes;
    }
    fs.writeFileSync(path.join(OUT, `${p.id}.txt`), text);
    fs.writeFileSync(path.join(OUT, `${p.id}.meta.json`), JSON.stringify({
      page_id: p.id, book_id: p.book_id, page_number: p.page_number, cli: CLI, cli_version: version, read_site: CALL_SITE,
      model: ra.model || MODEL, model_requested: MODEL, started_at: t0.toISOString(), finished_at: new Date().toISOString(),
      exit: 0, error_class: null, chars: text.length, chatter: text ? ocrReadProblem(text) : null,
      prompt_sent_hash: sentRef.hash, prompt_sent_file: sentRef.file, ...image, two_read: two,
    }, null, 1));
    const by = two.disputes.reduce((o, x) => ({ ...o, [x.chose]: (o[x.chose] || 0) + 1 }), {});
    console.log(`  ${p.book_id} p.${p.page_number}: ok ${text.length} chars; agreement ${(d.agreement_folded * 100).toFixed(0)}% folded; ${d.hunks.length} disputes ${JSON.stringify(by)} (${Math.round((Date.now() - t0) / 1000)}s)`);
  };

  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length && !stop) await readPage(queue.shift()); }));
  const metas = todo.map((p) => path.join(OUT, `${p.id}.meta.json`)).filter((f) => fs.existsSync(f)).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const ok = metas.filter((m) => m.exit === 0).length, hrs = (Date.now() - t00) / 3600000;
  console.log(`\nread ${ok} ok, ${metas.length - ok} failed, ${todo.length - metas.length} not reached; ${hrs > 0 ? (ok / hrs).toFixed(1) : '-'} pages/hour at concurrency ${CONCURRENCY}`);
  if (stop) { console.error(`STOPPED: ${stop}`); process.exit(3); }
}

// ── apply ──

async function apply() {
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  const OUT = path.resolve(arg('out'));
  const APPLY = process.argv.includes('--apply');
  const REASON = arg('reason');
  if (!REASON) { console.error('--reason is required: say why these pages are being read'); process.exit(2); }
  const LITE_BOOKS = arg('replace-lite-books') ? new Set(parseBookIds(fs.readFileSync(arg('replace-lite-books'), 'utf8'))) : new Set();
  const { MongoClient } = await import('mongodb');
  const { saveRevisionBeforeOverwrite } = await import('../lib/page-revisions.mjs');
  const { liftOcrTags, parseDetectedImages } = await import('../lib/ocr-result-parse.mjs');
  const { loopVerdict } = await import('../lib/ocr-loop-guard.mjs');
  const { recountBook } = await import('../lib/page-counts.mjs');
  const { recordSweepAction } = await import('../lib/sweep-log.mjs');
  const { markTranslationsStale } = await import('../lib/syriac-kraken-lane.mjs');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const ref = JSON.parse(fs.readFileSync(path.join(OUT, 'prompt-ref.json'), 'utf8'));
  const metas = fs.readdirSync(OUT).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')));
  const CODE_VERSION = await codeVersion();
  const runId = `claude-two-read-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const REFUSAL = /\bI (cannot|can't|am unable to) (provide|transcribe|reproduce)|content restrictions|safety filters|^#{2,3} Summary\b|overview and summary of the text/im;
  const longWords = (t) => new Set((String(t).replace(/<[^>]+>/g, ' ').replace(/-\n/g, '').toLowerCase().replace(/æ/g, 'ae').replace(/ſ/g, 's').replace(/v/g, 'u').match(/\p{L}{5,}/gu) || []));
  const tally = { written: 0, replaced_lite: 0, skipped: {} };
  const skip = (m, why) => { tally.skipped[why.split(':')[0]] = (tally.skipped[why.split(':')[0]] || 0) + 1; console.log(`  skip ${m.book_id} p.${m.page_number}: ${why}`); };
  const books = {};

  for (const m of metas.sort((a, b) => a.book_id.localeCompare(b.book_id) || a.page_number - b.page_number)) {
    const text = fs.readFileSync(path.join(OUT, `${m.page_id}.txt`), 'utf8').trim();
    if (m.exit !== 0) { skip(m, `read failed: ${m.error_class}`); continue; }
    if (text.length < 5) { skip(m, 'empty read'); continue; }
    if (text.length > 25000) { skip(m, 'over 25k chars'); continue; }
    if (!/<page-type>/.test(text)) { skip(m, 'no <page-type> tag: not a transcription in the prompt format'); continue; }
    if ((text.match(/<page-type>/g) || []).length !== 1 || (text.match(/<scan-quality>/g) || []).length > 1) { skip(m, 'more than one transcription header: restarted or refused read'); continue; }
    if (REFUSAL.test(text)) { skip(m, 'refusal or summary in place of a transcription'); continue; }
    const chatter = ocrReadProblem(text);
    if (chatter) { skip(m, `chatter guard: ${chatter}`); continue; }
    if (loopVerdict(text).refuse) { skip(m, 'repetition loop'); continue; }
    const page = await db.collection('pages').findOne({ id: m.page_id }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, 'ocr.edited_by': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'ocr.model': 1, 'ocr.data': 1, 'translation.data': 1 } });
    if (!page) { skip(m, 'page not found'); continue; }
    if (page.ocr?.edited_by || page.ocr?.source === 'manual') { skip(m, 'human-edited page'); continue; }
    const lite = !!page.ocr?.data && replacesLite(page, LITE_BOOKS);
    if (page.ocr?.data && !lite) {
      const was = longWords(page.ocr.data), now = longWords(text);
      const shared = [...now].filter((w) => was.has(w)).length / Math.max(1, now.size);
      if (was.size >= 40 && shared < 0.4) { skip(m, `only ${Math.round(shared * 100)}% of its words are in the stored read: check by eye`); continue; }
    }
    if (page.ocr?.updated_at && new Date(page.ocr.updated_at) > new Date(m.started_at)) { skip(m, `OCR was rewritten after this read (${page.ocr.model})`); continue; }
    const sent = fs.readFileSync(path.join(OUT, m.prompt_sent_file), 'utf8');
    if (contentHash(sent) !== m.prompt_sent_hash) { skip(m, 'prompt sent cannot be reconstructed (hash mismatch)'); continue; }
    const t = m.two_read;
    const engine = geminiEngine({
      name: engineNameForCli(m.cli), call_site: CALL_SITE, api: 'cli', cli: { name: m.cli, version: m.cli_version }, model: m.model,
      prompt: { ...ref, text: sent },
      generationConfig: notRecorded(`${m.cli} -p exposes no temperature, output cap or thinking setting; the model id names the tier`),
      run: { job_id: runId, code_version: CODE_VERSION, host: host(), at: new Date(m.finished_at), read_started_at: m.started_at, read_site: m.read_site, reason: REASON },
      input: { ...imageInput({ url: m.image_url, mime: 'image/jpeg', bytes: m.image_bytes }), image_sha256: m.image_sha256,
        two_read: {
          method: t.method, strips: t.strips, agreement_folded: t.agreement_folded, agreement_exact: t.agreement_exact,
          reads: t.reads.map((r) => ({ call: r.call, model: r.model, text_hash: r.text_hash, chars: r.chars })),
          adjudication: t.adjudication && { model: t.adjudication.model, prompt_sent_hash: t.adjudication.prompt_sent_hash },
          disputes: t.disputes,
          replaced: lite ? { model: page.ocr.model, source: page.ocr.source, why: 'flash-lite read on a book in the run list (overlap guard not applied)' } : null,
        } },
    });
    const tags = liftOcrTags(text);
    const detectedImages = parseDetectedImages(text);
    console.log(`  ${APPLY ? 'WRITE' : 'would write'} ${page.book_id} p.${page.page_number} (${page.ocr?.model ?? 'no OCR'} -> ${m.model}${lite ? ', replaces lite' : ''}, ${text.length} chars, ${t.disputes.length} disputes)`);
    if (lite) tally.replaced_lite++;
    if (!APPLY) { tally.written++; continue; }
    if (page.ocr?.data) await saveRevisionBeforeOverwrite(db, page.id, 'ocr', { reason: 'reocr_claude_two_read' });
    const r = await db.collection('pages').updateOne(
      { id: page.id, 'ocr.updated_at': page.ocr?.updated_at ?? { $exists: false } },
      { $set: {
        ocr: { data: text, language: 'auto-detect', model: m.model, updated_at: new Date(), source: 'ai', pipeline: LANE, prompt_version: ref.version, prompt_id: ref.id, prompt_name: ref.name, ...ocrProvenance(text, engine) },
        ...tags,
        ...(detectedImages.length > 0 && { detected_images: detectedImages }),
        updated_at: new Date(),
      } },
    );
    if (r.modifiedCount !== 1) { skip(m, 'page changed between read and write'); continue; }
    await recordSweepAction(db, { sweep: 'claude-ocr-two-read', book_id: page.book_id, action: 'ocr-two-read-opus', detail: { page_id: page.id, page_number: page.page_number, from_model: page.ocr?.model ?? null, to_model: m.model, disputes: t.disputes.length, agreement_folded: t.agreement_folded, run: runId, reason: REASON } });
    if (page.translation?.data) await markTranslationsStale(db, [{ id: page.id, text }], new Date(), LANE);
    (books[page.book_id] ??= []).push(page.page_number);
    tally.written++;
  }
  if (APPLY) {
    for (const [bookId, nums] of Object.entries(books)) {
      await recountBook(db, bookId, { reason: 'claude-ocr-two-read' });
      await db.collection('book_events').insertOne({ book_id: bookId, type: 'ocr_reread', at: new Date(), source: CALL_SITE, details: { run: runId, api: 'cli', lane: LANE, pages: nums.length, page_numbers: nums.sort((a, b) => a - b), reason: REASON } });
    }
  }
  console.log(`\n${APPLY ? 'written' : 'would write'}: ${tally.written} (${tally.replaced_lite} replace a flash-lite read)   skipped: ${JSON.stringify(tally.skipped)}${APPLY ? `   run ${runId}` : '   (dry run; add --apply)'}`);
  fs.writeFileSync(path.join(OUT, `apply-summary-${APPLY ? runId : 'dry'}.json`), JSON.stringify({ at: new Date().toISOString(), apply: APPLY, run: APPLY ? runId : null, reason: REASON, ...tally }, null, 1));
  await client.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stage = process.argv[2];
  if (!['read', 'apply'].includes(stage) || !process.argv.some((a) => a.startsWith('--out='))) { console.error('usage: claude-ocr-two-read.mjs read|apply --out=DIR ... (see the header)'); process.exit(2); }
  await (stage === 'read' ? read() : apply());
}
