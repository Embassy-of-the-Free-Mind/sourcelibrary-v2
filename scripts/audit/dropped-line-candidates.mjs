#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/ocr-negation-flip-candidates.mjs — same shape (two stored reads of one page, a
 * worklist, controls that exit 1), but it pairs single TOKENS that differ by ≤ 2 characters; a dropped line
 * is a RUN of whole words, which it cannot see. scripts/eval/disagreement-typology.mjs classifies
 * substitutions, not runs. The `<vocab>`-vs-body screen (PR #5317) found 0 of 8 omissions.
 *
 * dropped-line-candidates — list runs of N+ words that one OCR read of a page has and a read of the same
 * page by a DIFFERENT engine does not (page-error-taxonomy class O5, #6326, #5136).
 *
 * WHY. A dropped line is the error a reader cannot see: the text either side joins into a fluent sentence.
 * On the Aldine 1516 Iamblichus, flash-lite dropped the same line in 7 of 7 reads of p.268; flash read it.
 * So the second read must come from another engine: lite against lite sees nothing.
 *
 * HOW. Model-free. Both reads are folded (tags and their metadata blocks out, line-end hyphens rejoined,
 * æ/ae, &/et, long s, u/v, i/j, diacritics), aligned word by word (Myers), and each gap is kept when it is
 * a pure insertion/deletion of ≥ N words, or a replacement with one side ≥ 8 words and ≥ 5 longer than the
 * other. A gap is then DISCARDED when the other read holds those words somewhere else (a moved column, or a
 * line one read put inside <margin>/<note>/<header>) or when it is letter-spaced type read as single
 * letters (`A D M O N I T I O`), and set aside as `edge` when it touches the first or last words of the
 * page (a running head, a catchword, or a truncated read — a different defect).
 *
 * WHAT IT CANNOT DO. It cannot say which read is right: a run present in only one read is a dropped line
 * in the other OR an invented line in this one. The image decides. It is a WORKLIST. It sees nothing on a
 * page with one stored read, and nothing when both engines drop the same line.
 *
 * NOT JUDGED, and counted as such rather than as clean (non-latin-text-operations.md): scripts written
 * without word spaces (Han, kana, Tibetan, Thai, …), pages under 40 words, pairs whose printed
 * <page-num>s disagree or that share under half their words (another leaf — page-revisions-corpus.md),
 * and any read whose `source` is not a pipeline read (relocation sweeps, human edits — data-provenance.md §2).
 *
 * Read-only. $0.
 *   node --env-file=.env.production.local scripts/audit/dropped-line-candidates.mjs            # controls, exit 1 if missed
 *   node --env-file=.env.production.local scripts/audit/dropped-line-candidates.mjs --books <id,id> [--out f.jsonl]
 *   node --env-file=.env.production.local scripts/audit/dropped-line-candidates.mjs --corpus --out f.jsonl [--summary f.json]
 * --corpus walks page_revisions once without text (it has no index on `source`), then fetches text only for
 * the pages that hold two engines. Options: --min-run 5.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { stripMarkupTags } from '../lib/strip-markup-tags.mjs';

const BOOK = '69b51eb747b06ecd58195d39'; // Aldine 1516 Iamblichus: lite text in page_revisions, flash current
export const CONTROLS = { book: BOOK, positive: [212, 268, 343], negative: [179, 191, 215, 227] };

// A read whose source is not on this list was not produced by reading this page's image: it was moved
// from another page (`shift-repair-*`, `spread-split`, `ia-ocr-repair`, `ai-repair-sync`), typed by a
// person, or imported. Allow-list, so a new sweep label is excluded until someone adds it here.
// (`loop-guard-refused-*` / `blank-guard-refused-*` rows are reads a write guard already rejected: out too.)
export const READ_SOURCES = new Set(['batch_api', 'ai', 'pipeline_preview', 'realtime_api_sequential', 'batch_api_recovery', 'mineru', 'paddle', 'kraken', 'ia_djvu', 'bdrc', 'ndl-koten']);

const META_BLOCK = /<(header|meta|margin|image-desc|vocab|page-num|scan-quality|language|script|page-type|warning|note)\b[^>]*>[\s\S]*?<\/\1>/gi;
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Tibetan}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/gu;
// Marks are vowel signs in the Indic scripts and must stay; in these they are accents or pointing, which
// two reads of one page routinely disagree on.
const STRIP_MARKS = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}]\p{M}+/gu;

/** Same engine family? `gemini-3-flash-preview` and `gemini-3-flash` are one engine; flash and flash-lite are two. */
export const engineOf = (model) => String(model ?? 'unknown').toLowerCase().replace(/^models\//, '').replace(/^ia-ocr\/.*/, 'ia-ocr').replace(/-(preview|latest|exp)(-[\d-]+)?$/, '').replace(/-\d{3}$/, '');

export function pageNum(t) {
  const m = (t || '').match(/<page-num>\s*([0-9]{1,4})\s*<\/page-num>/i);
  return m ? parseInt(m[1], 10) : null;
}

function fold(t) {
  t = t.replace(/&amp;/gi, '&').replace(/&(#\d+|#x[0-9a-f]+|[a-z]{2,8});/gi, ' '); // `&nbsp;` must not become the words "et nbsp"
  t = t.replace(/[-¬⸗=]\s*\n\s*/g, ''); // rejoin words broken at a line end
  t = t.normalize('NFD').replace(STRIP_MARKS, (m) => m[0]).normalize('NFC').toLowerCase();
  t = t.replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ę/g, 'ae').replace(/&/g, ' et ').replace(/[ſß]/g, (c) => (c === 'ß' ? 'ss' : 's')).replace(/ς/g, 'σ');
  return (t.match(/[\p{L}\p{M}]+/gu) ?? []).map((w) => w.replace(/v/g, 'u').replace(/j/g, 'i'));
}

/** Body words of a read, folded. Metadata blocks are dropped whole; other tags lose only the tag. */
export const words = (text) => fold(stripMarkupTags(String(text ?? '').replace(META_BLOCK, ' ')));
/** Every word of a read, metadata blocks included — where a "missing" run may have been put instead. */
export const allWords = (text) => fold(stripMarkupTags(String(text ?? '')));

/** Why this text cannot be judged by word runs, or null. */
export function unjudgeable(text, w) {
  const body = stripMarkupTags(String(text ?? '').replace(META_BLOCK, ' '));
  const letters = (body.match(/\p{L}/gu) ?? []).length;
  if (letters && (body.match(UNSPACED) ?? []).length / letters > 0.3) return 'unspaced_script';
  if (w.length < 40) return 'too_short';
  return null;
}

/**
 * Myers O(ND) diff over two word arrays → gaps `{ a, an, b, bn }` (start and length on each side), or null
 * past `maxEdits` (time and memory grow with the edit count; two long unrelated texts once ran 7 minutes).
 */
export function gaps(A, B, maxEdits = 6000) {
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length, eb = B.length;
  while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const N = ea - s, M = eb - s;
  if (!N && !M) return [];
  if (!N || !M) return [{ a: s, an: N, b: s, bn: M }];
  const max = N + M, off = max + 1, trace = [];
  let v = new Int32Array(2 * max + 4), D = 0;
  outer: for (; D <= max; D++) {
    if (D > maxEdits) return null;
    trace.push(v.slice(off - D - 1, off + D + 2)); // only diagonals -D-1..D+1 are read back
    for (let k = -D; k <= D; k += 2) {
      let x = k === -D || (k !== D && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[s + x] === B[s + y]) { x++; y++; }
      v[off + k] = x;
      if (x >= N && y >= M) break outer;
    }
  }
  const edits = []; // single-word edits, walked back from the end
  let x = N, y = M;
  for (let d = D; d > 0; d--) {
    const pv = trace[d], o = d + 1, k = x - y;
    const pk = k === -d || (k !== d && pv[o + k - 1] < pv[o + k + 1]) ? k + 1 : k - 1;
    const px = pv[o + pk], py = px - pk;
    edits.push(pk === k + 1 ? { a: s + px, an: 0, b: s + py, bn: 1 } : { a: s + px, an: 1, b: s + py, bn: 0 });
    x = px; y = py;
  }
  edits.reverse();
  const out = [];
  for (const e of edits) {
    const g = out[out.length - 1];
    if (g && g.a + g.an === e.a && g.b + g.bn === e.b) { g.an += e.an; g.bn += e.bn; } else out.push({ ...e });
  }
  return out;
}

// Share of a run's word trigrams the other read holds anywhere. 0.4, not higher: a line both reads have, but
// in a different place and read differently (λεγον / λεγονται), kept only half its trigrams.
const ELSEWHERE = 0.4;
const trigrams = (w) => { const s = new Set(); for (let i = 0; i + 2 < w.length; i++) s.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`); return s; };

/**
 * Compare two reads. Returns `{ verdict, runs, ... }`; verdict is one of
 * flagged | clean | edge_only | unspaced_script | too_short | leaf_mismatch | not_same_text.
 * `runs[].missing_from` names the read that LACKS the words: 'current' or 'previous'.
 * `pos` is how far down the page the run starts (0–1), to find it on the image.
 */
export function compareReads(current, previous, { minRun = 5 } = {}) {
  const A = words(previous), B = words(current);
  const why = unjudgeable(current, B) ?? unjudgeable(previous, A);
  if (why) return { verdict: why, runs: [] };
  const pa = pageNum(previous), pb = pageNum(current);
  if (pa != null && pb != null && pa !== pb) return { verdict: 'leaf_mismatch', runs: [] };
  // Cheap first: two reads that share under half their vocabulary are not the same leaf; do not align them.
  const bag = new Set(A);
  if (B.filter((w) => bag.has(w)).length / B.length < 0.5 || A.length / B.length > 3 || B.length / A.length > 3) return { verdict: 'not_same_text', runs: [] };
  const G = gaps(A, B);
  if (!G) return { verdict: 'not_same_text', runs: [] };
  const shared = A.length - G.reduce((n, g) => n + g.an, 0);
  const similarity = +(shared / Math.max(A.length, B.length)).toFixed(3);
  if (similarity < 0.5) return { verdict: 'not_same_text', similarity, runs: [] };
  const elsewhere = { current: null, previous: null };
  const runs = [];
  for (const g of G) {
    const hi = Math.max(g.an, g.bn), lo = Math.min(g.an, g.bn);
    if (!((lo === 0 && hi >= minRun) || (hi >= 8 && hi - lo >= 5))) continue;
    const fromPrev = g.an > g.bn; // the long side is in the previous read, so the current read lacks it
    const missing_from = fromPrev ? 'current' : 'previous';
    const run = fromPrev ? A.slice(g.a, g.a + g.an) : B.slice(g.b, g.b + g.bn);
    elsewhere[missing_from] ??= trigrams(allWords(fromPrev ? current : previous));
    const tri = [...trigrams(run)];
    const found = tri.length ? tri.filter((t) => elsewhere[missing_from].has(t)).length / tri.length : 0;
    const side = fromPrev ? A : B, at = fromPrev ? g.a : g.b;
    const edge = at < 3 || at + hi > side.length - 3;
    const spaced = run.filter((w) => [...w].length === 1).length / run.length >= 0.5;
    runs.push({
      missing_from, words: hi, other_side_words: lo, pos: +(at / side.length).toFixed(2), elsewhere: +found.toFixed(2), kind: found >= ELSEWHERE ? 'elsewhere' : spaced ? 'spaced_letters' : edge ? 'edge' : 'run',
      text: run.join(' '), before: side.slice(Math.max(0, at - 6), at).join(' '), after: side.slice(at + hi, at + hi + 6).join(' '),
    });
  }
  const real = runs.filter((r) => r.kind === 'run');
  return { verdict: real.length ? 'flagged' : runs.some((r) => r.kind === 'edge') ? 'edge_only' : 'clean', similarity, words_current: B.length, words_previous: A.length, runs };
}

/** The newest revision row that is a pipeline read by another engine than the current text, or a reason. */
export function pickPrevious(page, revisions) {
  if (!READ_SOURCES.has(page.ocr?.source)) return { skip: 'current_not_a_read' };
  const cur = engineOf(page.ocr?.model);
  const reads = revisions.filter((r) => READ_SOURCES.has(r.source));
  if (!reads.length) return { skip: revisions.length ? 'revision_not_a_read' : 'single_read' };
  const other = reads.filter((r) => r.model && engineOf(r.model) !== cur).sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at))[0];
  return other ? { previous: other } : { skip: 'same_engine' };
}

const UNSPACED_ENGINE = /^(bdrc|ndl-koten)/i;
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(`--${k}`);
const century = (y) => (Number.isFinite(+y) && +y > 0 ? `${Math.floor((+y - 1) / 100) + 1}c` : 'undated');
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function main() {
  const MIN = parseInt(arg('min-run', '5'), 10);
  const OUT = arg('out', null), SUMMARY = arg('summary', null);
  const CORPUS = has('corpus');
  const books = arg('books', null)?.split(',') ?? [BOOK];
  const controlsRun = !CORPUS && !arg('books', null);
  const c = await MongoClient.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
  const db = c.db('bookstore');
  const pagesC = db.collection('pages'), revC = db.collection('page_revisions');
  const out = OUT ? fs.createWriteStream(OUT) : null;
  const tally = {}, pairs = {}, rows = [];
  const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };

  /** page_id → [revision rows without text] for the pages to judge. */
  const byPage = new Map();
  if (CORPUS) {
    let seen = 0;
    for await (const r of revC.find({ field: 'ocr' }, { projection: { _id: 1, page_id: 1, source: 1, model: 1, created_at: 1 } }).batchSize(1000)) {
      if (!byPage.has(r.page_id)) byPage.set(r.page_id, []);
      byPage.get(r.page_id).push(r);
      if (++seen % 200000 === 0) console.error(`  revision rows read ${seen}`);
    }
    console.error(`revision rows (ocr) ${seen} on ${byPage.size} pages`);
  } else {
    const want = controlsRun ? { book_id: BOOK, page_number: { $in: [...CONTROLS.positive, ...CONTROLS.negative] } } : { book_id: { $in: books } };
    const ids = (await pagesC.find(want, { projection: { id: 1 } }).toArray()).map((p) => p.id);
    for (const p of ids) byPage.set(p, []);
    for (const part of chunk(ids, 500)) {
      for (const r of await revC.find({ page_id: { $in: part }, field: 'ocr' }, { projection: { _id: 1, page_id: 1, source: 1, model: 1, created_at: 1 } }).toArray()) byPage.get(r.page_id).push(r);
    }
  }

  const bookMeta = new Map();
  let done = 0;
  for (const part of chunk([...byPage.keys()], 400)) {
    const pages = await pagesC.find({ id: { $in: part }, 'ocr.data': { $type: 'string' } }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.model': 1, 'ocr.source': 1 } }).toArray();
    const chosen = [];
    for (const p of pages) {
      const pick = pickPrevious(p, byPage.get(p.id));
      if (pick.skip) bump(tally, pick.skip);
      else if (UNSPACED_ENGINE.test(p.ocr.model) || UNSPACED_ENGINE.test(pick.previous.model)) bump(tally, 'unspaced_script'); // Tibetan / Japanese lanes: no need to fetch the text
      else chosen.push([p, pick.previous]);
    }
    bump(tally, 'no_current_text', part.length - pages.length);
    if (chosen.length) {
      const cur = new Map((await pagesC.find({ id: { $in: chosen.map(([p]) => p.id) } }, { projection: { id: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p.ocr?.data]));
      const prev = new Map((await revC.find({ _id: { $in: chosen.map(([, r]) => r._id) } }, { projection: { data: 1 } }).toArray()).map((r) => [String(r._id), r.data]));
      const need = [...new Set(chosen.map(([p]) => p.book_id))].filter((b) => !bookMeta.has(b));
      for (const b of await db.collection('books').find({ id: { $in: need } }, { projection: { id: 1, title: 1, year: 1, language: 1, visible: 1 } }).toArray()) bookMeta.set(b.id, b);
      for (const [p, r] of chosen) {
        const res = compareReads(cur.get(p.id), prev.get(String(r._id)) ?? '', { minRun: MIN });
        const pair = `${engineOf(r.model)} → ${engineOf(p.ocr.model)}`;
        const b = bookMeta.get(p.book_id) ?? {};
        bump(tally, res.verdict);
        pairs[pair] ??= {};
        bump(pairs[pair], res.verdict);
        const row = { book: p.book_id, page: p.page_number, page_id: p.id, pair, previous_source: r.source, current_source: p.ocr.source, century: century(b.year), language: b.language ?? null, visible: b.visible ?? null, title: b.title ?? null, ...res };
        if (!CORPUS || res.verdict === 'flagged') rows.push(CORPUS ? { ...row, runs: undefined } : row);
        if (out && (res.verdict === 'flagged' || res.verdict === 'edge_only')) out.write(JSON.stringify({ ...row, url: `https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}` }) + '\n');
        if (CORPUS) rows.judged ??= [], ['flagged', 'clean', 'edge_only'].includes(res.verdict) && rows.judged.push([p.book_id, p.id, pair, row.century, res.verdict === 'flagged']);
      }
    }
    done += part.length;
    if (CORPUS && done % 20000 === 0) console.error(`  pages ${done}/${byPage.size}  ${JSON.stringify(tally)}`);
  }
  out?.end();
  await c.close();

  const judged = (tally.flagged ?? 0) + (tally.clean ?? 0) + (tally.edge_only ?? 0);
  console.log(`pages with a revision row ${byPage.size}; two-engine pairs judged ${judged}; flagged ${tally.flagged ?? 0}`);
  console.log(`not judged: ${Object.entries(tally).filter(([k]) => !['flagged', 'clean', 'edge_only'].includes(k)).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);

  if (CORPUS) {
    // A rate needs independent units: one page per book, chosen by a hash of the page id (not by verdict).
    const h = (s) => crypto.createHash('sha1').update(`6326:${s}`).digest('hex');
    const one = new Map();
    for (const j of rows.judged ?? []) { const k = h(j[1]); if (!one.has(j[0]) || k < one.get(j[0]).k) one.set(j[0], { k, j }); }
    const rate = (key) => {
      const t = {};
      for (const { j } of one.values()) { const g = t[j[key]] ??= { books: 0, flagged: 0 }; g.books++; if (j[4]) g.flagged++; }
      return Object.fromEntries(Object.entries(t).sort((x, y) => y[1].books - x[1].books).map(([k, g]) => [k, { ...g, pct: +(100 * g.flagged / g.books).toFixed(1) }]));
    };
    const all = [...one.values()];
    const summary = {
      date: new Date().toISOString().slice(0, 10), min_run: MIN, pages_with_revision: byPage.size, pairs_judged: judged, tally, pages_by_pair: pairs,
      one_page_per_book: { books: all.length, flagged: all.filter(({ j }) => j[4]).length, by_pair: rate(2), by_century: rate(3) },
    };
    if (SUMMARY) fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 1) + '\n');
    console.log(JSON.stringify(summary.one_page_per_book, null, 1));
    return 0;
  }

  for (const r of rows.filter((x) => x.verdict === 'flagged')) {
    for (const run of r.runs.filter((x) => x.kind === 'run')) console.log(`p${r.page} [${r.pair}] missing from ${run.missing_from} (${run.words}w): …${run.before} [[ ${run.text} ]] ${run.after}…`);
  }
  if (!controlsRun) return 0;
  let missed = 0;
  const verdictOf = (pg) => rows.find((r) => r.page === pg)?.verdict ?? 'not_compared';
  for (const pg of CONTROLS.positive) { const v = verdictOf(pg); console.log(`positive control p${pg}: ${v === 'flagged' ? 'FOUND' : `MISSED (${v})`}`); if (v !== 'flagged') missed++; }
  for (const pg of CONTROLS.negative) { const v = verdictOf(pg); const ok = v === 'clean' || v === 'edge_only'; console.log(`negative control p${pg}: ${ok ? 'CLEAN' : `FAILED (${v})`}`); if (!ok) missed++; }
  return missed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await main());
