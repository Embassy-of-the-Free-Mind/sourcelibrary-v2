#!/usr/bin/env node
/**
 * ia-ocr-error-taxonomy — WHAT does the Internet Archive's OCR get wrong, class by class, measured
 * on pages where our own model has since re-read the same leaf (#5186).
 *
 * PRIOR ART: scripts/eval/disagreement-typology.mjs (classifies SUBSTITUTIONS between two Gemini
 * passes on Latin pages — long-s, ligatures, tildes, u/v; its "align on folded forms, classify on
 * raw forms" rule and its alignment gate are reused here, but it has no digit, furniture, hyphen,
 * dropped-block or reading-order classes and reads a different corpus); scripts/eval/
 * disagreement-classes.mjs (bag-vs-sequence discriminator for reading order — reused as the
 * `reading-order` page class); scripts/eval/ia-ocr-delivered-quality.mjs (CER/WER/seq/bow/gap of
 * the Archive text against a PAID fresh read — this one is free, it reads the pairs a re-read
 * already left in `page_revisions`); scripts/maintenance/reocr-ia-frontmatter.mjs --report (diffs
 * title/author/imprint on title pages only); scripts/lib/ia-ocr-agreement.mjs (the gate's
 * tokenizer + ratio, imported); scripts/lib/dehyphenate.mjs (imported); scripts/lib/
 * page-image-url.mjs (imported, for the facsimile check).
 */
/*
 * WHY. The free OCR lane (#4727/#4790) accepts a book when the Archive text agrees with a Gemini
 * sample at ≥ 0.80 sequence ratio. Four family-history books passed at 0.94–0.98 and still had
 * 1 in 15 to 1 in 120 years wrong (3→8, 9→0). "How much" the two readings differ is known; the
 * decision that is still open — which genres the Archive text is acceptable for — needs "what
 * kind". This script names every token-level difference and reports each class PER OPPORTUNITY
 * (errors ÷ tokens of that kind), never per page.
 *
 * THE PAIRS. `scripts/batch/realtime-ocr.mjs` snapshots the Archive reading to `page_revisions`
 * (source `ia_djvu`, reason `reocr_realtime`) before overwriting `pages.ocr` with the model's.
 * Pair = that row × the page's current `ocr.data` (source `ai`). Two samples, kept apart:
 *   interior     — the #5186 re-read of every `ia_djvu` page in four 1890–1919 English books
 *                  (Deyo, Gate City, NH Notables, Clevelanders): whole-book, unbiased.
 *   frontmatter  — the #4815 re-read of the first 25 leaves of ~190 lane books: display type,
 *                  title pages, contents — a biased, harder sample, used as the contrast and for
 *                  the per-engine and per-century splits.
 *
 * THE REFERENCE IS NOT GROUND TRUTH. flash-lite is the other reader, so every "error" here is a
 * disagreement attributed to the Archive; `--stage=verify` draws disagreements for a facsimile
 * check and `--verdicts` folds the by-eye result back into the report. Page pairs where the model
 * side is degenerate (refusal marker, length collapse, blank/illustration page type) are dropped
 * before any token class is counted; pairs sharing < 55% vocabulary or differing > 30% in length
 * are counted as a PAGE class (`page-misaligned`) and never fed to the token aligner (the
 * typology's lesson: LCS on misaligned pages measures the aligner).
 *
 * ALIGNMENT HYGIENE (each of these produced a fake class on the first run, 2026-09-30):
 *   - running heads and page numbers are stripped from BOTH sides before aligning (a book's
 *     recurring edge lines, fuzzy-matched so a misread head still goes); left in, "26" aligned
 *     against "BECKER" and counted as a misread;
 *   - a dash between digits is a range separator, split before tokenising ("1888-1891" vs
 *     "1888 1891" is a dash convention, not a digit↔letter swap);
 *   - pages flagged `reading-order` (bag ≫ sequence: index columns) get NO token classes — on
 *     them the LCS pairs "137" with "138" from another column;
 *   - a replace block of 2+ slots that is mostly unrelated words is `unaligned-run`, not misreads;
 *   - superscripts (footnote markers, genealogy generation numbers) are their own classes.
 *
 * POOLING. A book is one observation (auto-memory lesson_sample_one_page_per_book). Interior rates
 * are given per book and pooled as the median across books; front-matter rates are pooled over
 * ONE random page per book (seeded) with the all-pages figure beside it for reference.
 *
 * Stages (dry throughout — nothing here writes to `pages` or calls a model):
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ia-ocr-error-taxonomy.mjs --stage=pull      # page_revisions × pages → pairs.jsonl (resumable)
 *   node scripts/eval/ia-ocr-error-taxonomy.mjs --stage=report    # classify, print tables, write report.json
 *   node scripts/eval/ia-ocr-error-taxonomy.mjs --stage=verify --n=12   # draw disagreements for the facsimile check
 *   node scripts/eval/ia-ocr-error-taxonomy.mjs --stage=report --verdicts=<file>   # fold verdicts into the report
 * Options (all `--name=value`): --pairs=<jsonl> (default scripts/output/ia-ocr-error-taxonomy/pairs.jsonl)
 *          --out=<dir>     (default scripts/eval/results/ia-ocr-error-taxonomy-<date>)
 *          --books=a,b,c   (pull: restrict to these book ids)  --seed=5186  --n=12 (verify: draws)
 * Mongo from the laptop drops connections; the pull uses small batches and appends per batch so a
 * restart continues. Heavy pulls run fine on Hetzner (repo at /root/sourcelibrary).
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { MongoClient } from 'mongodb';
import { tokens as gateTokens, ratio as seqRatio, EDITORIAL_BLOCKS } from '../lib/ia-ocr-agreement.mjs';
import { dehyphenateLineBreaks, countLineBreakHyphens } from '../lib/dehyphenate.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { stripMarkupTags } from '../lib/strip-markup-tags.mjs';

const ARG = (n, d) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=').slice(1).join('=') ?? d;
const STAGE = ARG('--stage', 'report');
const DATE = new Date().toISOString().slice(0, 10);
const PAIRS = ARG('--pairs', 'scripts/output/ia-ocr-error-taxonomy/pairs.jsonl');
const OUT = ARG('--out', `scripts/eval/results/ia-ocr-error-taxonomy-${DATE}`);
const PER_PAGE = path.join(path.dirname(PAIRS), 'per-page.jsonl');
const SEED = parseInt(ARG('--seed', '5186'), 10);
const SHOW = parseInt(ARG('--show', '6'), 10);
const VERDICTS = ARG('--verdicts', null);
const ISSUE = 5186;

/** The four #5186 books — the interior (whole-book) sample. Everything else in the pairs is #4815 front matter. */
const INTERIOR_BOOKS = {
  '6aa4c8a388a2920a45a88592': 'Deyo, Barnstable County 1890',
  '6aa4c8b488a2920a45a88e2e': 'Wakeley, Omaha: Gate City 1917',
  '6aa4c8bb88a2920a45a8921b': 'NH Notables 1919',
  '6aa4c89788a2920a45a883eb': 'Book of Clevelanders 1914',
};
const FRONT_LEAVES = 25;

// ── stage: pull ───────────────────────────────────────────────────────────────────────────────

async function pull() {
  const uri = process.env.MONGODB_URI; if (!uri) throw new Error('MONGODB_URI missing');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000, socketTimeoutMS: 60000, maxPoolSize: 2 });
  await client.connect(); const db = client.db('bookstore');
  fs.mkdirSync(path.dirname(PAIRS), { recursive: true });
  const have = new Set();
  if (fs.existsSync(PAIRS)) for await (const l of readline.createInterface({ input: fs.createReadStream(PAIRS) })) { if (l.trim()) have.add(JSON.parse(l).page_id); }
  const q = { field: 'ocr', source: 'ia_djvu', reason: 'reocr_realtime' };
  const only = ARG('--books', null); if (only) q.book_id = { $in: only.split(',') };
  const ids = await db.collection('page_revisions').find(q, { projection: { _id: 0, page_id: 1 } }).toArray();
  const todo = [...new Set(ids.map((r) => r.page_id))].filter((id) => !have.has(id));
  console.log(`revisions ${ids.length}; pairs already pulled ${have.size}; to pull ${todo.length}`);
  const bookCache = new Map();
  let written = 0;
  for (let i = 0; i < todo.length; i += 100) {
    const batch = todo.slice(i, i + 100);
    const revs = await db.collection('page_revisions').find({ ...q, page_id: { $in: batch } }, { projection: { _id: 0, page_id: 1, book_id: 1, data: 1, model: 1, created_at: 1 } }).toArray();
    const pages = await db.collection('pages').find({ id: { $in: batch } }, { projection: { _id: 0, id: 1, page_number: 1, page_type: 1, photo: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, photo_original: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.model': 1, 'ocr.updated_at': 1 } }).toArray();
    const pageById = new Map(pages.map((p) => [p.id, p]));
    const rev = new Map(); for (const r of revs) if (!rev.has(r.page_id) || rev.get(r.page_id).created_at < r.created_at) rev.set(r.page_id, r);
    const bookIds = [...new Set(revs.map((r) => r.book_id))].filter((b) => !bookCache.has(b));
    if (bookIds.length) for (const b of await db.collection('books').find({ id: { $in: bookIds } }, { projection: { _id: 0, id: 1, title: 1, author: 1, published: 1, language: 1, ia_identifier: 1, 'ocr.ia': 1 } }).toArray()) bookCache.set(b.id, b);
    const lines = [];
    for (const [pid, r] of rev) {
      const p = pageById.get(pid); if (!p?.ocr?.data || p.ocr.source !== 'ai') continue; // not (yet) a model reading — no pair
      const b = bookCache.get(r.book_id) || {};
      lines.push(JSON.stringify({ page_id: pid, book_id: r.book_id, page_number: p.page_number, page_type: p.page_type ?? null, ia_engine: r.model ?? null, model: p.ocr.model ?? null, model_at: p.ocr.updated_at ?? null, book: { title: b.title ?? null, author: b.author ?? null, published: b.published ?? null, language: b.language ?? null, ia_identifier: b.ia_identifier ?? null, ia_ocr_engine: b.ocr?.ia?.engine ?? null }, image: getPageSource(p), ia: r.data, ai: p.ocr.data }));
    }
    if (lines.length) { fs.appendFileSync(PAIRS, lines.join('\n') + '\n'); written += lines.length; }
    process.stdout.write(`\r  ${Math.min(i + 100, todo.length)}/${todo.length} pulled, ${written} pairs written   `);
  }
  console.log(`\nwrote ${written} new pairs → ${PAIRS}`);
  await client.close();
}

// ── text preparation ──────────────────────────────────────────────────────────────────────────

const EDITORIAL_RE = new RegExp(`<(${[...EDITORIAL_BLOCKS, 'lang', 'lacuna', 'detected-images'].join('|')})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi');
const FURNITURE_TAGS = ['header', 'running-head', 'page-num', 'folio', 'sig', 'signature', 'catchword'];
const FURNITURE_RE = new RegExp(`<(${FURNITURE_TAGS.join('|')})\\b[^>]*>([\\s\\S]*?)</\\1>`, 'gi');

/**
 * The model's transcription of what is printed: editorial blocks gone, tags and centring marks
 * dropped. Furniture (running head, page number, signature) is listed AND removed from the body —
 * the two engines place it differently (the Archive inlines it as the first/last line, the model
 * tags it or leaves it out), so left in, it aligns against body words and reads as misreads.
 */
function modelBody(raw) {
  const text = String(raw || '');
  const columns = (text.match(/<columns>\s*(\d+)/i) || [])[1] ?? null;
  const pageType = (text.match(/<page-type>\s*([^<\s]+)/i) || [])[1]?.toLowerCase() ?? null;
  const furniture = []; for (const m of text.matchAll(FURNITURE_RE)) furniture.push({ tag: m[1].toLowerCase(), text: stripMarkupTags(m[2]).replace(/\s+/g, ' ').trim() });
  const body = text.replace(EDITORIAL_RE, ' ').replace(FURNITURE_RE, '\n').replace(/->|<-/g, ' ').replace(/<\/?[A-Za-z][^>]*>/g, ' ').replace(/[*_`#|]/g, ' ');
  return { body, furniture, columns, pageType };
}

// Word core: letters/digits with inner apostrophes and hyphens; leading/trailing punctuation shed.
// Punctuation is measured separately. A dash BETWEEN DIGITS is a range ("1888-1891", "1888–1891",
// "1888 — 1891") and is split first, so the dash convention cannot masquerade as a digit misread.
const CORE_RE = /[\p{L}\p{N}]+(?:['’\-–‐][\p{L}\p{N}]+)*/gu;
function coreTokens(s) { return String(s || '').normalize('NFC').replace(/(\d)\s*[-–‐—]\s*(?=\d)/g, '$1 ').match(CORE_RE) || []; }

/**
 * Running-head key of a line: folded, digits and roman-numeral-like page numbers removed. A line is
 * furniture when it sits in the first/last two lines of a page and its key recurs on several pages
 * of the same book (the book's running head), or when it is only a page number.
 */
const headKey = (line) => coreTokens(line).map(fold).filter((w) => !/^\d+$/.test(w) && !/^[ivxlc]+$/.test(w)).join(' ');
const isPageNumberLine = (line) => /^[\s\[\(]*(\d{1,4}|[ivxlcIVXLC]{1,6})[\s\]\)\.]*$/.test(line);
function edgeLines(text) { const ls = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean); return [...ls.slice(0, 2), ...ls.slice(-2)]; }
/** Book id → Set of running-head keys that recur on ≥ max(3, 5%) of that book's pages (Archive side). */
function runningHeads(pairs) {
  const byBook = new Map();
  for (const p of pairs) { const m = byBook.get(p.book_id) || byBook.set(p.book_id, { n: 0, keys: new Map() }).get(p.book_id); m.n++; for (const k of new Set(edgeLines(p.ia).map(headKey).filter((k) => k && k.split(' ').length <= 8))) m.keys.set(k, (m.keys.get(k) || 0) + 1); }
  const out = new Map();
  for (const [b, m] of byBook) out.set(b, new Set([...m.keys].filter(([, c]) => c >= Math.max(3, 0.05 * m.n)).map(([k]) => k)));
  return out;
}
/** Exact key, or within 35% character edits of one (a misread running head: "The Hook of llevcUindevs"). */
function isHead(k, heads) { if (heads.has(k)) return true; for (const h of heads) if (Math.abs(h.length - k.length) <= h.length * 0.35 && charSpans(k, h).distance <= Math.ceil(h.length * 0.35)) return true; return false; }
/** Remove furniture lines from the top/bottom two lines of a page. Returns { text, removed }. */
function stripEdgeFurniture(text, heads) {
  const ls = String(text || '').split('\n'); const idx = ls.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  const edge = new Set([...idx.slice(0, 2), ...idx.slice(-2)]); let removed = 0;
  const kept = ls.filter((l, i) => { if (!edge.has(i)) return true; const k = headKey(l); if (isPageNumberLine(l.trim()) || (k && heads && isHead(k, heads))) { removed++; return false; } return true; });
  return { text: kept.join('\n'), removed };
}
/** Alignment fold (typology rule: align on folded forms, classify on raw). */
const fold = (w) => w.toLowerCase().replace(/ſ/g, 's').replace(/[’‘ʼ]/g, "'").normalize('NFD').replace(/\p{M}/gu, '');

// ── token alignment (LCS with backtrace, difflib-style replace blocks) ─────────────────────────

/** ops over folded sequences: {op:'eq'|'sub'|'ins'|'del', a: IA token(s), b: model token(s)} — `ins` = only in IA, `del` = only in model. */
function alignTokens(A, B) {
  const fa = A.map(fold), fb = B.map(fold);
  const m = fa.length, n = fb.length;
  const L = new Uint16Array((m + 1) * (n + 1)); const W = n + 1;
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i * W + j] = fa[i] === fb[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  const ops = []; let i = 0, j = 0, da = [], db = [], blockId = 0;
  const flush = () => {
    if (!da.length && !db.length) return;
    if (da.length && db.length) {
      const ca = da.map((k) => fa[k]).join('').replace(/[-–‐]/g, ''), cb = db.map((k) => fb[k]).join('').replace(/[-–‐]/g, '');
      if (ca === cb) ops.push({ op: 'spacing', ai: da, bi: db });
      else {
        const k = Math.min(da.length, db.length);
        blockId++;
        for (let t = 0; t < k; t++) ops.push({ op: 'sub', ai: [da[t]], bi: [db[t]], block: da.length !== db.length, blockId, blockLen: k });
        for (let t = k; t < da.length; t++) ops.push({ op: 'ins', ai: [da[t]], bi: [] });
        for (let t = k; t < db.length; t++) ops.push({ op: 'del', ai: [], bi: [db[t]] });
      }
    } else { for (const k of da) ops.push({ op: 'ins', ai: [k], bi: [] }); for (const k of db) ops.push({ op: 'del', ai: [], bi: [k] }); }
    da = []; db = [];
  };
  while (i < m && j < n) {
    if (fa[i] === fb[j]) { flush(); ops.push({ op: 'eq', ai: [i], bi: [j] }); i++; j++; }
    else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) da.push(i++);
    else db.push(j++);
  }
  while (i < m) da.push(i++); while (j < n) db.push(j++); flush();
  return ops;
}

// ── substitution classes ──────────────────────────────────────────────────────────────────────

/** Character-level edit spans between two words: [[aSpan, bSpan], …] (a = IA, b = model). */
function charSpans(a, b) {
  const m = a.length, n = b.length; const W = n + 1;
  const D = new Uint16Array((m + 1) * W);
  for (let i = 0; i <= m; i++) D[i * W] = i; for (let j = 0; j <= n; j++) D[j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) D[i * W + j] = Math.min(D[(i - 1) * W + j] + 1, D[i * W + j - 1] + 1, D[(i - 1) * W + j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const spans = []; let i = m, j = n, sa = '', sb = '';
  const flush = () => { if (sa || sb) spans.unshift([sa, sb]); sa = ''; sb = ''; };
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1] && D[i * W + j] === D[(i - 1) * W + j - 1]) { flush(); i--; j--; }
    else if (i > 0 && j > 0 && D[i * W + j] === D[(i - 1) * W + j - 1] + 1) { sa = a[i - 1] + sa; sb = b[j - 1] + sb; i--; j--; }
    else if (i > 0 && D[i * W + j] === D[(i - 1) * W + j] + 1) { sa = a[i - 1] + sa; i--; }
    else { sb = b[j - 1] + sb; j--; }
  }
  flush();
  return { spans, distance: D[m * W + n] };
}

/** Glyph confusions a classical engine is known for, keyed model→IA (what was printed → what the Archive read). */
const KNOWN_LETTER = new Set(['h→li', 'li→h', 'h→h', 'm→rn', 'rn→m', 'm→in', 'in→m', 'n→u', 'u→n', 'e→c', 'c→e', 'o→c', 'c→o', 'd→cl', 'd→tl', 'cl→d', 'n→ri', 'ri→n', 'w→vv', 'vv→w', 'l→I', 'I→l', 'i→l', 'l→i', 'th→tb', 'th→tli', 'ti→ii', 'k→lc', 'k→K', 'f→t', 't→f', 'ff→fl', 'fi→fl', 'y→v', 'v→y', 'a→e', 'e→a', 'a→o', 'o→a', 'g→q', 'q→g', 'b→h', 'h→b', 'r→t', 't→r', 'ck→cl', 'ct→et']);
const SUP_DIGITS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
const SUP_RE = /[⁰¹²³⁴⁵⁶⁷⁸⁹]/g;
const SUP_ANY = /[⁰¹²³⁴⁵⁶⁷⁸⁹]/;
const isDigits = (w) => /^\d+$/.test(w);
const hasDigit = (w) => /\d/.test(w);
const isYear = (w) => /^1[0-9]{3}$/.test(w);
const isNumeric = (w) => /^\d{2,}$/.test(w);
const stripMarks = (w) => w.normalize('NFD').replace(/\p{M}/gu, '');

/** Classify one aligned (IA, model) word pair. Returns { cls, pair } where pair is the confused span model→IA when there is one. */
function classifySub(a, b) {
  if (a.toLowerCase() === b.toLowerCase()) return { cls: 'case-only' };
  if (stripMarks(a).toLowerCase() === stripMarks(b).toLowerCase()) return { cls: 'diacritic-only' };
  const bare = (w) => w.replace(/['’\-–‐]/g, '').toLowerCase();
  if (bare(a) === bare(b)) return { cls: 'inner-punctuation' };
  // Superscripts: a footnote marker one side kept and the other dropped ("word¹" / "word"), or a
  // superscript read as a full-size digit ("¹" / "1"). Conventions of the reader, not misreads.
  const noSup = (w) => w.replace(SUP_RE, '');
  if ((SUP_ANY.test(a) || SUP_ANY.test(b)) && noSup(a).toLowerCase() === noSup(b).toLowerCase() && noSup(a)) return { cls: 'superscript-marker' };
  const supToDigit = (w) => w.replace(SUP_RE, (c) => SUP_DIGITS[c] ?? '');
  if ((SUP_ANY.test(a) || SUP_ANY.test(b)) && supToDigit(a).toLowerCase() === supToDigit(b).toLowerCase()) return { cls: 'superscript-as-digit' };
  // Script confusion: the Archive returned Cyrillic or Greek letters for a Latin word or a digit
  // (ia-ocr's script detector on lists and tables: "1" → "А", "д", "я").
  if (/[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(a) && !/[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(b)) return { cls: 'script-confusion', pair: `${b}→${a}` };
  if (hasDigit(a) || hasDigit(b)) {
    const year = isYear(b);
    if (isDigits(a) && isDigits(b)) {
      if (a.length === b.length) {
        const pairs = []; for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) pairs.push(`${b[k]}→${a[k]}`);
        return { cls: 'digit-substitution', pair: pairs.join(','), year };
      }
      return { cls: 'digit-dropped-or-added', pair: `${b}→${a}`, year };
    }
    // Mixed: a digit read as a letter or a letter as a digit (0↔o, 1↔l/I, 5↔s, 8↔B) is one short
    // span with a digit on one side and a letter on the other. Anything wider is a misread of
    // the token, not a glyph swap.
    const { spans, distance } = charSpans(a.toLowerCase(), b.toLowerCase());
    const swap = spans.length && spans.every(([x, y]) => x.length <= 2 && y.length <= 2) && spans.some(([x, y]) => /\d/.test(x) !== /\d/.test(y));
    // Direction matters for the denominator: a printed number read as letters ("1855" → "r855",
    // "1st" → "Ist") is a number error; a printed letter read as a digit ("O" for Ohio → "0") is a word error.
    if (swap) return { cls: hasDigit(b) ? 'digit-read-as-letter' : 'letter-read-as-digit', pair: spans.map(([x, y]) => `${y}→${x}`).join(','), year };
    if (distance <= Math.ceil(Math.max(a.length, b.length) * 0.34)) return { cls: 'multi-glyph-misread', pair: spans.map(([x, y]) => `${y}→${x}`).join(','), year };
    return { cls: 'unrelated-word', year };
  }
  const longS = (w) => w.toLowerCase().replace(/[ſf]/g, 's');
  if (/[ſf]/i.test(a + b) && longS(a) === longS(b)) return { cls: 'long-s↔f' };
  const { spans, distance } = charSpans(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (spans.length === 1) {
    const [x, y] = spans[0]; const key = `${y.toLowerCase()}→${x.toLowerCase()}`;
    if (KNOWN_LETTER.has(key)) return { cls: 'letter-confusion-known', pair: key };
    if (x.length <= 2 && y.length <= 2) return { cls: 'glyph-confusion-other', pair: key };
  }
  if (distance <= Math.ceil(maxLen * 0.34)) return { cls: 'multi-glyph-misread', pair: spans.map(([x, y]) => `${y}→${x}`).join(',') };
  return { cls: 'unrelated-word' };
}

// ── page classification ───────────────────────────────────────────────────────────────────────

/** Real one- and two-letter words and abbreviations (English-first corpus): not fragments. */
const SHORT_WORDS = new Set(['a', 'i', 'o', 'an', 'as', 'at', 'be', 'by', 'do', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we', 'co', 'st', 'mr', 'dr', 'jr', 'sr', 'pa', 'ny', 'nh', 'vt', 'md', 'ma', 'am', 'pm', 'de', 'la', 'le', 'et', 'ad']);
const DEGENERATE_TYPES = new Set(['blank', 'illustration', 'plate', 'cover', 'endpaper', 'image', 'blank-page', 'digitizer-insert']);

/** Per-pair result: page flags, per-opportunity counters, examples. */
function classifyPair(pr, heads) {
  const { body: aiBody, furniture, columns, pageType } = modelBody(pr.ai);
  const iaRaw = String(pr.ia || '');
  const result = { page_id: pr.page_id, book_id: pr.book_id, page_number: pr.page_number, engine: pr.ia_engine, columns, page_type: pageType || pr.page_type, flags: [], counts: {}, opp: {}, pairs: {}, examples: [] };
  const inc = (k, n = 1) => { result.counts[k] = (result.counts[k] || 0) + n; };
  const opp = (k, n = 1) => { result.opp[k] = (result.opp[k] || 0) + n; };
  const pairInc = (bucket, key) => { if (!key) return; const m = (result.pairs[bucket] ||= {}); m[key] = (m[key] || 0) + 1; };

  // Model side degenerate → no reference; do not count anything.
  if (/\[RECITATION_BLOCKED\]|\[FAIL_BLOCKED\]/.test(pr.ai) || (pageType && DEGENERATE_TYPES.has(pageType))) { result.flags.push('reference-degenerate'); return result; }
  const iaLines = iaRaw.split('\n').filter((l) => l.trim());
  opp('ia-lines', iaLines.length);
  inc('line-end-hyphen', countLineBreakHyphens(iaRaw));
  const ia = dehyphenateLineBreaks(iaRaw);
  // Running heads / page numbers out of BOTH sides before any alignment (they are measured apart, below).
  const iaS = stripEdgeFurniture(ia, heads), aiS = stripEdgeFurniture(aiBody, heads);
  inc('ia-furniture-lines', iaS.removed); inc('model-furniture-lines', aiS.removed);
  const iaText = iaS.text, aiText = aiS.text;

  const A = coreTokens(iaText), B = coreTokens(aiText);
  opp('model-words', B.length); opp('ia-words', A.length);
  if (B.length < 20 && A.length < 20) { result.flags.push('too-short'); return result; }
  if (A.length < 20 && B.length >= 60) { result.flags.push('ia-empty-or-near-empty'); return result; }
  if (B.length < A.length * 0.3 && A.length >= 60) { result.flags.push('reference-collapsed'); return result; }

  // Page-level agreement, the gate's own way, plus bag overlap for the reading-order discriminator.
  const gt = gateTokens(iaText), gb = gateTokens(aiText);
  result.seq = +seqRatio(gt, gb).toFixed(3);
  const bag = (T) => { const m = new Map(); for (const t of T) m.set(t, (m.get(t) || 0) + 1); return m; };
  const ba = bag(gt.slice(0, 600)), bb = bag(gb.slice(0, 600)); let inter = 0;
  for (const [k, v] of ba) inter += Math.min(v, bb.get(k) || 0);
  result.bow = +((2 * inter) / (Math.min(gt.length, 600) + Math.min(gb.length, 600))).toFixed(3);
  result.gap = +(result.bow - result.seq).toFixed(3);
  result.len_ratio = +(Math.min(A.length, B.length) / Math.max(A.length, B.length)).toFixed(3);
  const setB = new Set(B.map(fold)); const overlap = A.filter((w) => setB.has(fold(w))).length / Math.max(A.length, B.length);
  result.overlap = +overlap.toFixed(3);
  opp('pages', 1);
  if (overlap < 0.55 || result.len_ratio < 0.7) { inc('page-misaligned'); result.flags.push('misaligned'); }
  if (result.gap > 0.15 && result.bow >= 0.7) { inc('page-reading-order'); result.flags.push('reading-order'); }
  if (columns && +columns >= 2) { opp('pages-multicolumn', 1); if (result.flags.includes('reading-order')) inc('page-reading-order-multicolumn'); }

  // Furniture: what the model tagged as header / page number / signature — did the Archive keep it in the body?
  const iaFold = fold(ia).replace(/\s+/g, ' ');
  for (const f of furniture) {
    if (!f.text || f.text.length < 1) continue;
    opp('furniture-items'); opp(`furniture-${f.tag}`);
    if (iaFold.includes(fold(f.text).replace(/\s+/g, ' '))) { inc('furniture-kept-in-ia-body'); inc(`furniture-kept-${f.tag}`); }
  }

  // Punctuation conventions (counts, not errors).
  const punct = (s) => ({ curly: (s.match(/[“”‘’]/g) || []).length, straight: (s.match(/["']/g) || []).length, emdash: (s.match(/—/g) || []).length, endash: (s.match(/–/g) || []).length, spaced_hyphen: (s.match(/ - /g) || []).length });
  result.punct = { ia: punct(ia), ai: punct(aiBody) };

  // Token classes only on aligned pages in the same reading order: on a page read in another
  // column order the LCS pairs unrelated slots, and "137 → 138" is the aligner, not the Archive.
  if (result.flags.includes('misaligned') || result.flags.includes('reading-order')) return result;

  // Token-level opportunities on the model side. "Capitalised" = Xxxx (proper nouns and sentence
  // openers; all-caps display words are excluded — they are the case-only convention class).
  const capitalised = (w) => /^\p{Lu}\p{Ll}+/u.test(w);
  for (const w of B) {
    if (isNumeric(w)) opp('numeric-tokens');
    if (isYear(w)) opp('year-tokens');
    if (capitalised(w)) opp('capitalised-words');
  }

  const ops = alignTokens(A, B);
  // A token only on one side may be DISPLACED rather than dropped: the same word sits unaligned on
  // the other side (a column read in another order, a caption moved). Count those apart, so
  // "dropped" means absent from the Archive text altogether.
  const insBag = new Map(); for (const o of ops) if (o.op === 'ins') { const k = fold(A[o.ai[0]]); insBag.set(k, (insBag.get(k) || 0) + 1); }
  const displaced = (w) => { const k = fold(w); const c = insBag.get(k) || 0; if (!c) return false; insBag.set(k, c - 1); return true; };
  const furnFold = new Set(furniture.flatMap((f) => coreTokens(f.text).map(fold)));
  let delRun = [], insRun = [];
  const flushRuns = () => {
    if (delRun.length) {
      const words = delRun.map((k) => B[k]);
      if (words.length >= 8) { inc('missing-block-pages'); inc('missing-block-words', words.length); result.examples.push({ cls: 'missing-block', ia: '', ai: words.slice(0, 12).join(' ') + (words.length > 12 ? ' …' : ''), n: words.length }); }
      else for (const k of delRun) {
        const w = B[k];
        if (displaced(w)) { inc(isNumeric(w) ? 'number-displaced' : 'word-displaced'); continue; }
        // A running head or page number the model tagged and the Archive did not print at all:
        // furniture, not a lost body word (the body classes below must not absorb it).
        if (furnFold.has(fold(w))) { inc('furniture-dropped'); continue; }
        if (isNumeric(w)) { inc('numeral-dropped'); if (isYear(w)) inc('year-errors'); result.examples.push({ cls: 'numeral-dropped', ia: '', ai: w, ai_ctx: B.slice(Math.max(0, k - 4), k + 5).join(' ') }); }
        else if (isDigits(w)) inc('single-digit-dropped');
        else { inc('word-dropped'); if (capitalised(w)) inc('capitalised-dropped'); }
      }
      delRun = [];
    }
    if (insRun.length) {
      const words = insRun.map((k) => A[k]);
      if (words.length >= 8) {
        // Prose or noise? A readable run (≤ 20% fragments) the model lacks is usually the MODEL
        // skipping lines — verified: eye-skips between repeated phrases ("Benjamin F. Black …
        // Benjamin F. Black", parallel "president of the … Nebraska;" clauses). A fragment-heavy
        // run is the Archive reading a table, rule, ornament or drop cap as letters. (A page that
        // ALSO has a model-only block is relabelled `displaced` at the end: the same text, placed
        // differently.)
        const frag = words.filter((w) => /\p{L}/u.test(w) && (!/[aeiouyàáéèêíóúü]/i.test(w) || (w.length <= 2 && !SHORT_WORDS.has(w.toLowerCase())))).length / words.length;
        const kind = frag <= 0.2 ? 'prose' : 'noise';
        inc('ia-only-block-pages'); inc(`ia-only-block-${kind}-pages`); inc('ia-only-block-words', words.length);
        result.examples.push({ cls: `ia-only-block`, kind, ia: words.slice(0, 12).join(' ') + (words.length > 12 ? ' …' : ''), ai: '', n: words.length });
      }
      else for (const w of words) {
        if (furnFold.has(fold(w))) inc('ia-only-furniture');
        else if (/\p{L}/u.test(w) && (w.length <= 2 || !/[aeiouyàáéèêíóúü]/i.test(w))) { inc('ia-noise-token'); if (result.examples.length < 60) result.examples.push({ cls: 'ia-noise-token', ia: w, ai: '' }); }
        else if (isDigits(w)) inc('ia-only-number');
        else inc('ia-only-word');
      }
      insRun = [];
    }
  };
  // Classify every substitution first, then demote replace blocks that are mostly unrelated words:
  // a run of 2+ slots where most pairs share nothing is a local misalignment (a table row, a name
  // list read in another order), and its "digit substitutions" are alignment noise.
  const blockCls = new Map();
  for (const o of ops) if (o.op === 'sub') { o.c = classifySub(A[o.ai[0]], B[o.bi[0]]); const b = blockCls.get(o.blockId) || blockCls.set(o.blockId, []).get(o.blockId); b.push(o.c.cls); }
  for (const o of ops) if (o.op === 'sub' && o.blockLen >= 2) { const cs = blockCls.get(o.blockId); if (cs.filter((c) => c === 'unrelated-word').length * 2 > cs.length) o.c = { cls: 'unaligned-run' }; }
  const CONVENTIONS = ['case-only', 'diacritic-only', 'inner-punctuation', 'superscript-marker', 'superscript-as-digit'];
  const NOT_A_MISREAD = [...CONVENTIONS, 'unrelated-word', 'unaligned-run'];
  for (const o of ops) {
    if (o.op === 'del') { delRun.push(o.bi[0]); continue; }
    if (o.op === 'ins') { insRun.push(o.ai[0]); continue; }
    flushRuns();
    if (o.op === 'eq') {
      // Aligned on folded forms — a raw difference here is a CONVENTION, not a misread.
      const a = A[o.ai[0]], b = B[o.bi[0]];
      if (a === b) continue;
      if (/ſ/.test(a + b)) inc('sub:long-s↔s');
      else if (a.toLowerCase() === b.toLowerCase()) inc('sub:case-only');
      else if (stripMarks(a).toLowerCase() === stripMarks(b).toLowerCase()) inc('sub:diacritic-only');
      else inc('sub:inner-punctuation');
      continue;
    }
    if (o.op === 'spacing') {
      inc('spacing-split-or-merge'); result.examples.push({ cls: 'spacing', ia: o.ai.map((k) => A[k]).join(' '), ai: o.bi.map((k) => B[k]).join(' ') });
      // A year the Archive split ("191 7") or fused ("18541855") is unfindable by date search: a year error.
      const yrs = o.bi.map((k) => B[k]).filter(isYear).length; if (yrs) { inc('year-errors', yrs); inc('year-split-or-fused', yrs); if (o.bi.every((k) => isNumeric(B[k]))) inc('numeric-errors', o.bi.length); }
      continue;
    }
    const a = A[o.ai[0]], b = B[o.bi[0]];
    const { cls, pair, year } = o.c;
    inc(`sub:${cls}`); if (cls === 'unaligned-run') continue;
    inc('substitutions');
    if (isNumeric(b) && !NOT_A_MISREAD.includes(cls)) inc('numeric-errors');
    if (year && isYear(b) && !NOT_A_MISREAD.includes(cls)) inc('year-errors');
    if (capitalised(b) && !CONVENTIONS.includes(cls)) inc('capitalised-errors');
    if (cls === 'digit-substitution') pairInc('digits', pair);
    if (cls === 'digit-read-as-letter' || cls === 'letter-read-as-digit') pairInc('digit-letter', pair);
    if (cls === 'script-confusion') pairInc('script', pair);
    if (cls === 'letter-confusion-known' || cls === 'glyph-confusion-other') pairInc('letters', pair);
    if (cls === 'multi-glyph-misread') pairInc('multi', pair);
    const ctx = (T, k) => T.slice(Math.max(0, k - 4), k + 5).join(' ');
    result.examples.push({ cls, pair, ia: a, ai: b, ia_ctx: ctx(A, o.ai[0]), ai_ctx: ctx(B, o.bi[0]), capitalised: capitalised(b), block: !!o.block });
  }
  flushRuns();
  if (result.counts['missing-block-pages'] && result.counts['ia-only-block-prose-pages']) {
    inc('ia-only-block-displaced-pages', result.counts['ia-only-block-prose-pages']); delete result.counts['ia-only-block-prose-pages'];
    for (const e of result.examples) if (e.cls === 'ia-only-block' && e.kind === 'prose') e.kind = 'displaced';
  }
  return result;
}

// ── aggregation ───────────────────────────────────────────────────────────────────────────────

function seededRandom(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const median = (xs) => { const s = [...xs].filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const round3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const pct = (n, d, dp = 1) => (d ? `${((100 * n) / d).toFixed(dp)}%` : '—');
const per1k = (n, d) => (d ? ((1000 * n) / d).toFixed(1) : '—');

/** Opportunity-based rate definitions: [class, numerator key(s), denominator key, unit, meaning]. */
const RATES = [
  ['year misread or dropped', ['year-errors'], 'year-tokens', 'per year token', 'a 4-digit year in the model reading that the Archive read differently or not at all'],
  ['number misread or dropped', ['numeric-errors', 'numeral-dropped'], 'numeric-tokens', 'per number (≥2 digits)', 'digit substitution, digit↔letter, wrong digit count, or the number absent'],
  ['year split or fused', ['year-split-or-fused'], 'year-tokens', 'per year token', 'same digits, different word boundary ("191 7", "18541855") — invisible to date search'],
  ['digit substitution', ['sub:digit-substitution'], 'numeric-tokens', 'per number', 'same digit count, one or more digits differ (3↔8, 9↔0 …)'],
  ['digit read as letter', ['sub:digit-read-as-letter'], 'numeric-tokens', 'per number', 'a printed number with a digit read as a letter (1855 → r855, 1st → Ist, 551 → SSI)'],
  ['letter read as digit', ['sub:letter-read-as-digit'], 'model-words', 'per word', 'a printed letter read as a digit (O for Ohio → 0, Ill → 111)'],
  ['script confusion', ['sub:script-confusion'], 'model-words', 'per word', 'Cyrillic or Greek letters returned for a Latin word or a digit (1 → А, д, я)'],
  ['numeral dropped', ['numeral-dropped'], 'numeric-tokens', 'per number', 'the number is absent from the Archive text'],
  ['letter confusion (known pair)', ['sub:letter-confusion-known'], 'model-words', 'per word', 'one edit span, a classical-engine pair: li↔h, rn↔m, c↔e, u↔n, l↔I …'],
  ['glyph confusion (other 1–2 char)', ['sub:glyph-confusion-other'], 'model-words', 'per word', 'one edit span of ≤ 2 characters not in the known table'],
  ['multi-glyph misread', ['sub:multi-glyph-misread'], 'model-words', 'per word', 'several spans, still ≤ 34% of the word'],
  ['unrelated word', ['sub:unrelated-word'], 'model-words', 'per word', 'aligned slot holds a different word: a real misread of most of the word, or alignment noise'],
  ['long-s ↔ f', ['sub:long-s↔f'], 'model-words', 'per word', 'ſ/s read as f or f as s (pre-1800 typography)'],
  ['capitalised word wrong', ['capitalised-errors', 'capitalised-dropped'], 'capitalised-words', 'per Capitalised word', 'proper nouns and sentence-initial words misread or dropped'],
  ['word dropped', ['word-dropped'], 'model-words', 'per word', 'a word (in a run < 8) present in the model reading, absent from the Archive text altogether'],
  ['word displaced', ['word-displaced'], 'model-words', 'per word', 'a word the Archive has, but unaligned — read in another order (columns, captions, tables)'],
  ['number displaced', ['number-displaced'], 'numeric-tokens', 'per number', 'a number the Archive has, but in another position'],
  ['word only in Archive', ['ia-only-word'], 'model-words', 'per model word', 'a readable word only the Archive has — the MODEL may have dropped it'],
  ['noise token in Archive', ['ia-noise-token'], 'model-words', 'per model word', 'a 1–2 letter or vowel-less fragment only in the Archive text (speckle, rules, marks read as text)'],
  ['spacing split / merge', ['spacing-split-or-merge'], 'model-words', 'per word', 'same letters, different word boundaries ("Bos ton", "ofthe")'],
  ['superscript marker', ['sub:superscript-marker'], 'model-words', 'per word', 'a footnote superscript one side kept and the other dropped (convention)'],
  ['superscript as digit', ['sub:superscript-as-digit'], 'model-words', 'per word', 'a superscript read as a full-size digit (convention)'],
  ['unaligned run', ['sub:unaligned-run'], 'model-words', 'per word', 'a replace block of 2+ slots, mostly unrelated words: local misalignment, not counted as misreads'],
  ['case only', ['sub:case-only'], 'model-words', 'per word', 'same letters, different case: small caps and display type (convention, not error)'],
  ['long-s ↔ s', ['sub:long-s↔s'], 'model-words', 'per word', 'one side keeps ſ, the other normalises to s (convention)'],
  ['inner punctuation', ['sub:inner-punctuation'], 'model-words', 'per word', 'apostrophe or hyphen form differs inside the word (convention)'],
  ['diacritic only', ['sub:diacritic-only'], 'model-words', 'per word', 'accent present on one side only'],
  ['missing block (≥ 8 words)', ['missing-block-pages'], 'pages', 'per page', 'a run of ≥ 8 model words absent from the Archive: caption, footnote, a column, a paragraph'],
  ['block only in Archive (≥ 8 words)', ['ia-only-block-pages'], 'pages', 'per page', 'a run of ≥ 8 Archive words absent from the model: the MODEL omitted it, or the Archive read the facing page'],
  ['  … readable prose (model skipped lines)', ['ia-only-block-prose-pages'], 'pages', 'per page', '≤ 20% fragments: in the verified cases the MODEL skipped lines between repeated phrases'],
  ['  … noise (table / ornament read as text)', ['ia-only-block-noise-pages'], 'pages', 'per page', '> 20% fragments: dot-leader tables, rules, ornaments, drop caps read as letters'],
  ['  … displaced (page also has a model-only block)', ['ia-only-block-displaced-pages'], 'pages', 'per page', 'the same passage placed differently by the two readers (drop cap, sidebar, column): not an omission'],
  ['reading order / columns', ['page-reading-order'], 'pages', 'per page', 'bag agreement ≥ 0.70 but sequence agreement ≥ 0.15 lower: same words, different order'],
  ['page misaligned', ['page-misaligned'], 'pages', 'per page', 'the two readings share < 55% vocabulary or differ > 30% in length — structural, not glyph-level'],
  ['running-head / page-number lines (Archive)', ['ia-furniture-lines'], 'pages', 'lines per page', 'edge lines stripped from the Archive text as running heads or page numbers before alignment'],
  ['furniture kept in body', ['furniture-kept-in-ia-body'], 'furniture-items', 'per header/page-num/signature', 'a running head, page number or signature the model tagged is untagged body text in the Archive (it always is — this measures how often the Archive kept it at all)'],
  ['line-end hyphen', ['line-end-hyphen'], 'ia-lines', 'per Archive line', 'a typesetter\'s line-break hyphen the Archive kept ("Bos-\\nton"); dehyphenate.mjs joins the lowercase case'],
];

function aggregate(rows) {
  const sum = {}; const opp = {}; const pairs = {}; const examples = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.counts)) sum[k] = (sum[k] || 0) + v;
    for (const [k, v] of Object.entries(r.opp)) opp[k] = (opp[k] || 0) + v;
    for (const [bucket, m] of Object.entries(r.pairs)) for (const [k, v] of Object.entries(m)) ((pairs[bucket] ||= {})[k] = (pairs[bucket][k] || 0) + v);
    for (const e of r.examples) { const list = (examples[e.cls] ||= []); if (list.length < 200) list.push({ ...e, page_id: r.page_id, page_number: r.page_number, book_id: r.book_id }); }
  }
  const rates = RATES.map(([cls, nums, den, unit, meaning]) => { const n = nums.reduce((a, k) => a + (sum[k] || 0), 0); const d = opp[den] || 0; return { cls, n, d, rate: d ? n / d : null, unit, meaning }; });
  return { sum, opp, pairs, rates, examples, pages: rows.length, seq_median: round3(median(rows.map((r) => r.seq))), bow_median: round3(median(rows.map((r) => r.bow))) };
}

const topPairs = (m, k = 8) => Object.entries(m || {}).sort((a, b) => b[1] - a[1]).slice(0, k).map(([p, n]) => `${p} ×${n}`).join(', ');
const century = (published) => { const y = parseInt(String(published || '').match(/\d{4}/)?.[0] || '', 10); return Number.isNaN(y) ? 'unknown' : y < 1700 ? 'pre-1700' : y < 1800 ? '1700s' : y < 1850 ? '1800–49' : y < 1900 ? '1850–99' : '1900+'; };
const engineFamily = (e) => !e ? 'unknown' : /ABBYY FineReader 8/i.test(e) ? 'ABBYY 8' : /ABBYY FineReader 11/i.test(e) ? 'ABBYY 11' : /ABBYY/i.test(e) ? 'ABBYY (other)' : /ia-ocr\/0\.0\.(1[0-9]|2[0-9])/.test(e) ? `ia-ocr ${e.split('/')[1]}` : e.replace(/^ia-ocr\//, '');

async function loadPairs() {
  if (!fs.existsSync(PAIRS)) throw new Error(`no pairs at ${PAIRS} — run --stage=pull first`);
  const out = [];
  for await (const l of readline.createInterface({ input: fs.createReadStream(PAIRS) })) if (l.trim()) out.push(JSON.parse(l));
  return out;
}

// ── stage: report ─────────────────────────────────────────────────────────────────────────────

async function report() {
  const pairs = await loadPairs();
  fs.mkdirSync(OUT, { recursive: true });
  const heads = runningHeads(pairs);
  const rows = pairs.map((p) => ({ ...classifyPair(p, heads.get(p.book_id)), sample: INTERIOR_BOOKS[p.book_id] && p.page_number > FRONT_LEAVES ? 'interior' : 'frontmatter', book: p.book, image: p.image }));
  const usable = rows.filter((r) => !r.flags.some((f) => ['reference-degenerate', 'too-short', 'ia-empty-or-near-empty', 'reference-collapsed'].includes(f)));
  const dropped = {}; for (const r of rows) for (const f of r.flags) if (!usable.includes(r)) dropped[f] = (dropped[f] || 0) + 1;
  const interior = usable.filter((r) => r.sample === 'interior'); const front = usable.filter((r) => r.sample === 'frontmatter');
  const md = [];
  const line = (s = '') => { md.push(s); console.log(s); };
  line(`# IA OCR error taxonomy — ${DATE} (#${ISSUE})`);
  line(`pairs ${pairs.length}; usable ${usable.length} (dropped: ${JSON.stringify(dropped)}); interior ${interior.length} pages in ${new Set(interior.map((r) => r.book_id)).size} books; front matter ${front.length} pages in ${new Set(front.map((r) => r.book_id)).size} books`);
  line(`measure: agreement (flash-lite is the reference, not ground truth); rates are per opportunity; a book is one observation.`);

  // A. per book, interior
  const byBook = new Map(); for (const r of interior) (byBook.get(r.book_id) || byBook.set(r.book_id, []).get(r.book_id)).push(r);
  const bookAgg = [...byBook].map(([id, rs]) => ({ id, name: INTERIOR_BOOKS[id], engine: engineFamily(rs.map((r) => r.engine).sort((a, b) => rs.filter((x) => x.engine === b).length - rs.filter((x) => x.engine === a).length)[0]), agg: aggregate(rs) }));
  line(`\n## A. Interior pages, per book (one book = one observation)\n`);
  line(`| book (Archive engine) | pages | seq median | words | years wrong | numbers wrong | known letter confusions /1k words | other glyph /1k | unrelated /1k | Capitalised wrong | words dropped /1k | noise tokens /1k | missing block pages | reading-order pages | furniture kept | hyphens /100 lines |`);
  line(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  const R = (agg, cls) => agg.rates.find((r) => r.cls === cls);
  for (const b of bookAgg) {
    const a = b.agg, s = a.sum, o = a.opp;
    line(`| ${b.name} (${b.engine}) | ${a.pages} | ${a.seq_median} | ${o['model-words']} | ${pct(s['year-errors'] || 0, o['year-tokens'])} (${s['year-errors'] || 0}/${o['year-tokens'] || 0}) | ${pct((s['numeric-errors'] || 0) + (s['numeral-dropped'] || 0), o['numeric-tokens'])} | ${per1k(s['sub:letter-confusion-known'] || 0, o['model-words'])} | ${per1k(s['sub:glyph-confusion-other'] || 0, o['model-words'])} | ${per1k(s['sub:unrelated-word'] || 0, o['model-words'])} | ${pct((s['capitalised-errors'] || 0) + (s['capitalised-dropped'] || 0), o['capitalised-words'])} | ${per1k(s['word-dropped'] || 0, o['model-words'])} | ${per1k(s['ia-noise-token'] || 0, o['model-words'])} | ${pct(s['missing-block-pages'] || 0, o.pages)} | ${pct(s['page-reading-order'] || 0, o.pages)} | ${pct(s['furniture-kept-in-ia-body'] || 0, o['furniture-items'])} | ${o['ia-lines'] ? ((100 * (s['line-end-hyphen'] || 0)) / o['ia-lines']).toFixed(1) : '—'} |`);
  }
  // B. per class pooled
  const interiorPooled = RATES.map(([cls]) => { const per = bookAgg.map((b) => R(b.agg, cls)).filter((r) => r && r.d > 0); return { cls, median: median(per.map((r) => r.rate)), min: Math.min(...per.map((r) => r.rate)), max: Math.max(...per.map((r) => r.rate)), books: per.length, n: per.reduce((a, r) => a + r.n, 0), d: per.reduce((a, r) => a + r.d, 0) }; });
  const rnd = seededRandom(SEED); const frontByBook = new Map(); for (const r of front) (frontByBook.get(r.book_id) || frontByBook.set(r.book_id, []).get(r.book_id)).push(r);
  const frontOne = [...frontByBook.values()].map((rs) => rs[Math.floor(rnd() * rs.length)]);
  const frontOneAgg = aggregate(frontOne), frontAllAgg = aggregate(front), interiorAllAgg = aggregate(interior);
  line(`\n## B. Error classes — interior (median of per-book rates, ${bookAgg.length} books) vs front matter (one page per book, ${frontOne.length} books)\n`);
  line(`| class | unit | interior median (range) | interior pooled n/d | front matter 1 page/book | front matter all pages | example (IA → model) |`);
  line(`|---|---|---|---|---|---|---|`);
  const fmt = (r) => (r == null || Number.isNaN(r) || !Number.isFinite(r) ? '—' : r < 0.01 ? `${(1000 * r).toFixed(1)}‰` : `${(100 * r).toFixed(1)}%`);
  const exFor = (agg, cls) => { const key = { 'year misread or dropped': ['digit-substitution', 'numeral-dropped', 'digit-dropped-or-added'], 'number misread or dropped': ['digit-substitution', 'digit-read-as-letter'], 'digit substitution': ['digit-substitution'], 'digit read as letter': ['digit-read-as-letter'], 'letter read as digit': ['letter-read-as-digit'], 'script confusion': ['script-confusion'], 'superscript marker': ['superscript-marker'], 'superscript as digit': ['superscript-as-digit'], 'unaligned run': ['unaligned-run'], 'numeral dropped': ['numeral-dropped'], 'letter confusion (known pair)': ['letter-confusion-known'], 'glyph confusion (other 1–2 char)': ['glyph-confusion-other'], 'multi-glyph misread': ['multi-glyph-misread'], 'unrelated word': ['unrelated-word'], 'long-s ↔ f': ['long-s↔f'], 'capitalised word wrong': null, 'spacing split / merge': ['spacing'], 'case only': ['case-only'], 'diacritic only': ['diacritic-only'], 'missing block (≥ 8 words)': ['missing-block'], 'block only in Archive (≥ 8 words)': ['ia-only-block'], 'noise token in Archive': ['ia-noise-token'] }[cls]; if (!key) { if (cls === 'capitalised word wrong') { const e = Object.values(agg.examples).flat().find((x) => x.capitalised && x.ia); return e ? `${e.ia} → ${e.ai}` : ''; } return ''; } for (const k of key) { const e = (agg.examples[k] || []).find((x) => x.ia || x.ai); if (e) return `${e.ia || '∅'} → ${e.ai || '∅'}`; } return ''; };
  for (const [i, [cls, , , unit]] of RATES.entries()) {
    const ip = interiorPooled[i]; const f1 = frontOneAgg.rates[i], fa = frontAllAgg.rates[i];
    line(`| ${cls} | ${unit} | ${fmt(ip.median)} (${fmt(ip.min)}–${fmt(ip.max)}) | ${ip.n}/${ip.d} | ${fmt(f1.rate)} (${f1.n}/${f1.d}) | ${fmt(fa.rate)} (${fa.n}/${fa.d}) | ${exFor(interiorAllAgg, cls) || exFor(frontAllAgg, cls)} |`);
  }
  // C. confusion pairs
  line(`\n## C. Confusion pairs (printed → Archive read), interior all pages\n`);
  line(`- digits: ${topPairs(interiorAllAgg.pairs.digits, 12) || 'none'}`);
  line(`- digit↔letter: ${topPairs(interiorAllAgg.pairs['digit-letter'], 10) || 'none'}`);
  line(`- script confusion: ${topPairs(interiorAllAgg.pairs.script, 10) || 'none'}`);
  line(`- letters: ${topPairs(interiorAllAgg.pairs.letters, 20) || 'none'}`);
  line(`- multi-glyph: ${topPairs(interiorAllAgg.pairs.multi, 10) || 'none'}`);
  line(`\nFront matter (all pages): digits ${topPairs(frontAllAgg.pairs.digits, 8) || 'none'}; digit↔letter ${topPairs(frontAllAgg.pairs['digit-letter'], 8) || 'none'}; script ${topPairs(frontAllAgg.pairs.script, 8) || 'none'}; letters ${topPairs(frontAllAgg.pairs.letters, 16) || 'none'}`);
  // D. front matter by engine and century (one page per book)
  const groupTable = (keyFn, label) => {
    const groups = new Map(); for (const r of frontOne) { const k = keyFn(r); (groups.get(k) || groups.set(k, []).get(k)).push(r); }
    line(`\n## ${label} (front matter, one page per book)\n`);
    line(`| ${label} | books | seq median | years wrong | numbers wrong | known letter /1k | other glyph /1k | unrelated /1k | Capitalised wrong | noise /1k | missing block pages | misaligned pages | long-s /1k |`);
    line(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const [k, rs] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
      const a = aggregate(rs), s = a.sum, o = a.opp;
      line(`| ${k} | ${rs.length} | ${a.seq_median} | ${pct(s['year-errors'] || 0, o['year-tokens'])} (${s['year-errors'] || 0}/${o['year-tokens'] || 0}) | ${pct((s['numeric-errors'] || 0) + (s['numeral-dropped'] || 0), o['numeric-tokens'])} | ${per1k(s['sub:letter-confusion-known'] || 0, o['model-words'])} | ${per1k(s['sub:glyph-confusion-other'] || 0, o['model-words'])} | ${per1k(s['sub:unrelated-word'] || 0, o['model-words'])} | ${pct((s['capitalised-errors'] || 0) + (s['capitalised-dropped'] || 0), o['capitalised-words'])} | ${per1k(s['ia-noise-token'] || 0, o['model-words'])} | ${pct(s['missing-block-pages'] || 0, o.pages)} | ${pct(s['page-misaligned'] || 0, o.pages)} | ${per1k(s['sub:long-s↔f'] || 0, o['model-words'])} |`);
    }
    return [...groups].map(([k, rs]) => ({ key: k, books: rs.length, agg: aggregate(rs) }));
  };
  const byEngine = groupTable((r) => engineFamily(r.engine), 'D. Archive engine');
  const byCentury = groupTable((r) => century(r.book?.published), 'E. Print century');
  const byLanguage = groupTable((r) => r.book?.language || 'unknown', 'F. Catalogue language');
  // G. punctuation conventions
  const punctSum = (rs, side) => rs.reduce((a, r) => { for (const [k, v] of Object.entries(r.punct?.[side] || {})) a[k] = (a[k] || 0) + v; return a; }, {});
  line(`\n## G. Punctuation conventions, interior all pages (counts)\n`);
  line(`- Archive: ${JSON.stringify(punctSum(interior, 'ia'))}`); line(`- model:   ${JSON.stringify(punctSum(interior, 'ai'))}`);
  // H. verdicts
  let verdicts = null;
  if (VERDICTS && fs.existsSync(VERDICTS)) {
    const raw = JSON.parse(fs.readFileSync(VERDICTS, 'utf8'));
    verdicts = Array.isArray(raw) ? raw : raw.verdicts;
    const tally = {}; for (const v of verdicts) tally[v.verdict] = (tally[v.verdict] || 0) + 1;
    line(`\n## H. Facsimile check of ${verdicts.length} disagreements\n`);
    line(`| verdict | n |`); line(`|---|---|`); for (const [k, n] of Object.entries(tally)) line(`| ${k} | ${n} |`);
    line(''); for (const v of verdicts) line(`- p${v.page_number} ${v.book_id} [${v.cls}] "${v.ia}" → "${v.ai}": **${v.verdict}** — ${v.note || ''}`);
  }
  fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n') + '\n');
  const slim = (agg) => ({ pages: agg.pages, seq_median: agg.seq_median, bow_median: agg.bow_median, sum: agg.sum, opp: agg.opp, pairs: agg.pairs, rates: agg.rates, examples: Object.fromEntries(Object.entries(agg.examples).map(([k, v]) => [k, v.slice(0, 40)])) });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ issue: ISSUE, date: DATE, measure: 'agreement', reference: 'gemini-3.1-flash-lite (realtime re-read)', pairs: pairs.length, usable: usable.length, dropped, interior: { books: bookAgg.map((b) => ({ id: b.id, name: b.name, engine: b.engine, ...slim(b.agg) })), pooled_median_across_books: interiorPooled, all_pages: slim(interiorAllAgg) }, frontmatter: { one_page_per_book: slim(frontOneAgg), all_pages: slim(frontAllAgg), by_engine: byEngine.map((g) => ({ ...g, agg: slim(g.agg) })), by_century: byCentury.map((g) => ({ ...g, agg: slim(g.agg) })), by_language: byLanguage.map((g) => ({ ...g, agg: slim(g.agg) })) }, punctuation: { interior_ia: punctSum(interior, 'ia'), interior_model: punctSum(interior, 'ai') }, verdicts, per_page: PER_PAGE }));
  // Per-page rows (5 MB) sit beside the pairs, out of git; report.json names the file.
  fs.writeFileSync(PER_PAGE, usable.map(({ examples, pairs: _p, ...r }) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`\nwrote ${path.join(OUT, 'report.md')} and report.json`);
}

// ── stage: verify — draw disagreements for the facsimile check ────────────────────────────────

async function verify() {
  const n = parseInt(ARG('--n', '12'), 10);
  const pairs = await loadPairs();
  fs.mkdirSync(OUT, { recursive: true });
  const rnd = seededRandom(SEED + 1);
  const byPage = new Map(pairs.map((p) => [p.page_id, p]));
  const heads = runningHeads(pairs);
  const rows = pairs.filter((p) => INTERIOR_BOOKS[p.book_id] && p.page_number > FRONT_LEAVES).map((p) => classifyPair(p, heads.get(p.book_id))).filter((r) => !r.flags.length);
  const wanted = ['digit-substitution', 'digit-read-as-letter', 'letter-read-as-digit', 'numeral-dropped', 'letter-confusion-known', 'glyph-confusion-other', 'multi-glyph-misread', 'unrelated-word', 'missing-block', 'ia-only-block', 'ia-noise-token', 'spacing'];
  const pool = rows.flatMap((r) => r.examples.filter((e) => wanted.includes(e.cls)).map((e) => ({ ...e, page_id: r.page_id, book_id: r.book_id, page_number: r.page_number })));
  const picks = []; const perCls = Math.max(1, Math.ceil(n / wanted.length));
  for (const cls of wanted) { const c = pool.filter((e) => e.cls === cls); for (let k = 0; k < perCls && c.length; k++) picks.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); }
  while (picks.length < n && pool.length) picks.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  const out = picks.slice(0, Math.max(n, picks.length)).map((e) => { const p = byPage.get(e.page_id); return { ...e, book: INTERIOR_BOOKS[e.book_id], image: p.image, url: `https://sourcelibrary.org/book/${e.book_id}/${e.page_number}`, verdict: null, note: null }; });
  fs.writeFileSync(path.join(OUT, 'verify-sample.json'), JSON.stringify(out, null, 1));
  for (const e of out) console.log(`p${e.page_number} ${e.book} [${e.cls}${e.pair ? ' ' + e.pair : ''}]\n   IA:    ${e.ia_ctx ?? e.ia}\n   model: ${e.ai_ctx ?? e.ai}\n   ${e.image}`);
  console.log(`\n${out.length} disagreements → ${path.join(OUT, 'verify-sample.json')} — open each image, fill verdict: archive-wrong | model-wrong | both-wrong | undecidable`);
}

const run = { pull, report, verify }[STAGE];
if (!run) { console.error('--stage=pull | report | verify'); process.exit(1); }
run().catch((e) => { console.error(e); process.exit(1); });
