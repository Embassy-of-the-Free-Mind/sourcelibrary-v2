#!/usr/bin/env node
/**
 * Does DISAGREEMENT between two independent reads of one page image find garbled OCR? (#5313, #5376)
 *
 * PRIOR ART: scripts/eval/garble-detector-5313.mjs (PR #5369) — one-read text signals (OOV, filler,
 * loops) against the same judge labels: P 0.60 / R 0.09, gate not met; this file asks the question
 * those signals cannot, with a SECOND read. scripts/eval/revision-agreement-corpus.mjs +
 * revision-agreement-pilot.mjs (#3235) — agreement over `page_revisions` as a STABILITY corpus and
 * an agreement→accuracy fit on 32 anchors; neither scores agreement against a garble label.
 * scripts/eval/reocr-pairing-check.mjs — a paid re-read used for the PAIRING question (is this text
 * this image's?), not legibility. scripts/lib/ia-ocr-agreement.mjs — the tokenizer and ratio reused
 * here unchanged. scripts/lib/ia-ocr-confidence.mjs — the Archive engine's per-word confidence,
 * scored here as a side signal. scripts/eval/lib/revision-source.mjs — which `page_revisions`
 * sources are readings.
 *
 * Reference = the Opus judge's `garble_passthrough` flag on the #5274 audit and its monthly run
 * (#5319), one page per book — the same 327-page reference PR #5369 used. `measure: judged`: the
 * judge read OCR beside translation, never the image. Where the #5372 paired-arm verdicts are
 * present (same pages, three more judgments each) they are reported as the label's own noise.
 *
 * What is scored is `measure: agreement` (another engine / another run on the same leaf) — a
 * screening signal by .claude/docs/eval-design.md §2, never accuracy.
 *
 * Stages (each reads the previous stage's file from --out):
 *   reference   build reference.jsonl from the audit dirs                                  (local)
 *   revisions   Mongo, READ-ONLY: live page + every ocr revision for the reference pages  → reads-revisions.jsonl
 *   ia          archive.org, ≤2 req/s: the Archive's djvu text + confidence for the leaf  → reads-ia.jsonl
 *   pilot-*     a fresh paid second read (see --help text below)                          → reads-pilot.jsonl
 *   score       agreement per (page, second read) → precision/recall/AUC                   → report.json
 *   coverage    Mongo, READ-ONLY: share of served pages that HAVE a second read           → coverage.json
 *
 *   node --env-file=.env.production.local scripts/eval/two-read-garble-5313.mjs <stage> \
 *     --audit=scripts/eval/results/translation-corpus-audit-2026-09-30 \
 *     --audit=scripts/eval/results/translation-corpus-audit-monthly-2026-09 \
 *     [--paired=scripts/eval/results/translation-paired-arm-2026-09-30] --out=scripts/eval/results/two-read-garble-5313-2026-09-30
 *
 * Writes nothing to Mongo. No page field, no queue, no ledger a job reads.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { tokensBody, ratio } from '../lib/ia-ocr-agreement.mjs';
import { isMaintenanceSource, READING_SOURCES } from './lib/revision-source.mjs';

const argv = process.argv.slice(2);
const STAGE = argv[0];
const many = (n) => argv.filter((a) => a.startsWith(`--${n}=`)).map((a) => a.slice(n.length + 3));
const one = (n, d) => many(n)[0] ?? d;
const OUT = one('out', 'scripts/eval/results/two-read-garble-5313-2026-09-30');
const AUDITS = many('audit');
const PAIRED = one('paired', '');

const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
const sha = (s) => crypto.createHash('sha256').update(s || '').digest('hex').slice(0, 16);
const round = (n, d = 3) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
const F = (name) => path.join(OUT, name);

// ───────────────────────────── the score ─────────────────────────────
/** Below this many tokens on either side a page is UNJUDGED, not "disagreeing" (an empty set is not disagreement). */
const MIN_TOKENS = 30;
const WINDOW = 40;

/**
 * Two readings of one leaf → agreement features, or an abstention.
 *   ratio        difflib 2·LCS/(|a|+|b|) over the first 600 body tokens of each side (ia-ocr-agreement)
 *   worst_window lowest matched share of `a`'s tokens in any 40-token window (garble is local: one
 *                column, one marginal note — a whole-page ratio averages it away)
 *   low_windows  share of `a`'s 40-token windows with under half their tokens matched
 *   len_ratio    min/max token count — a truncated or over-long read is a different failure from a
 *                misread and must be separable from it
 * `a` is the text the reader is served; `b` is the second read.
 */
function twoReadAgreement(a, b) {
  const A = tokensBody(a).slice(0, 600), B = tokensBody(b).slice(0, 600);
  if (A.length < MIN_TOKENS || B.length < MIN_TOKENS) return { judged: false, why: A.length < MIN_TOKENS ? 'served-read-short' : 'second-read-short', a_tokens: A.length, b_tokens: B.length };
  // LCS with backtrace, so the matched positions of A are known (ratio() keeps only the length).
  const n = A.length, m = B.length, W = m + 1;
  const dp = new Uint16Array((n + 1) * W);
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) dp[i * W + j] = A[i - 1] === B[j - 1] ? dp[(i - 1) * W + j - 1] + 1 : Math.max(dp[(i - 1) * W + j], dp[i * W + j - 1]);
  const hit = new Uint8Array(n);
  for (let i = n, j = m; i > 0 && j > 0;) {
    if (A[i - 1] === B[j - 1]) { hit[i - 1] = 1; i--; j--; } else if (dp[(i - 1) * W + j] >= dp[i * W + j - 1]) i--; else j--;
  }
  const lcs = dp[n * W + m];
  let worst = 1, low = 0, wins = 0, run = 0;
  for (let i = 0; i < n; i++) { run += hit[i]; if (i >= WINDOW) run -= hit[i - WINDOW]; if (i >= WINDOW - 1) { const s = run / WINDOW; wins++; if (s < worst) worst = s; if (s < 0.5) low++; } }
  return { judged: true, ratio: round((2 * lcs) / (n + m)), recall_a: round(lcs / n), worst_window: round(worst), low_windows: round(wins ? low / wins : 0), len_ratio: round(Math.min(n, m) / Math.max(n, m)), a_tokens: n, b_tokens: m };
}

// ───────────────────────────── reference ─────────────────────────────
function loadAudit(dir) {
  const manifest = new Map(readJsonl(path.join(dir, 'manifest.jsonl')).map((m) => [m.id, m]));
  const sources = new Map();
  const itemFiles = fs.existsSync(path.join(dir, 'items.jsonl')) ? [path.join(dir, 'items.jsonl')]
    : fs.readdirSync(path.join(dir, 'packets')).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, 'packets', f));
  for (const f of itemFiles) for (const it of readJsonl(f)) sources.set(it.id, it.source);
  const vdir = path.join(dir, 'verdicts', 'opus'); const out = [];
  for (const f of fs.readdirSync(vdir).filter((x) => x.endsWith('.jsonl')).sort()) for (const v of readJsonl(path.join(vdir, f))) {
    const m = manifest.get(v.id);
    if (!m || m.kind !== 'main' || !sources.has(v.id)) continue; // controls are translation manipulations over clean sources
    const g = (v.defects || []).filter((d) => d.type === 'garble_passthrough');
    out.push({ id: v.id, run: path.basename(dir), book_id: m.book_id, page_id: m.page_id, page_number: m.page_number, language: m.language, period: m.period, provider: m.provider ?? null,
      url: m.url, image: m.image, ocr_model: m.ocr_model, ocr_source: m.ocr_source, ocr_at: m.ocr_at, ocr_hash: sha(sources.get(v.id)), ocr: sources.get(v.id),
      garbled: !!v.flags?.garble_passthrough, major: g.some((d) => d.severity === 'major'), wrong_page: !!v.flags?.wrong_page, fidelity: v.fidelity, garble_detail: g.map((d) => d.detail).join(' | ') || null });
  }
  return out;
}
function loadPairedVotes(dir) {
  if (!dir || !fs.existsSync(path.join(dir, 'packet-key.json'))) return null;
  const key = JSON.parse(fs.readFileSync(path.join(dir, 'packet-key.json'), 'utf8')); const votes = new Map();
  for (const f of fs.readdirSync(path.join(dir, 'verdicts')).filter((x) => x.endsWith('.jsonl'))) for (const v of readJsonl(path.join(dir, 'verdicts', f))) {
    const k = key[v.id]; if (!k) continue;
    const e = votes.get(k.id) || { n: 0, garbled: 0, arms: {} };
    if (k.arm in e.arms) continue; // a re-judged packet: one verdict per arm
    e.n++; if (v.flags?.garble_passthrough) e.garbled++; e.arms[k.arm] = !!v.flags?.garble_passthrough; votes.set(k.id, e);
  }
  // The paired arm re-used the audit's sample ids, but item ids repeat across audit RUNS: key the votes by the page.
  const byPage = new Map();
  for (const s of readJsonl(path.join(dir, 'sample.jsonl'))) if (votes.has(s.id)) byPage.set(`${s.book_id}:${s.page_number}`, votes.get(s.id));
  return byPage;
}
function stageReference() {
  if (!AUDITS.length) { console.error('reference: pass --audit=<dir> at least once'); process.exit(2); }
  const votes = loadPairedVotes(PAIRED); const seen = new Set(); const rows = [];
  // #5311: is the served text this image's leaf at all? (by-eye verdicts on the audit sample: match | mismatch | uncertain)
  const LEAF = one('leaf', ''); const leaf = LEAF && fs.existsSync(path.join(LEAF, 'verdicts.jsonl')) ? new Map(readJsonl(path.join(LEAF, 'verdicts.jsonl')).map((v) => [`${v.book_id}:${v.page_number}`, v.verdict])) : null;
  for (const pg of AUDITS.flatMap(loadAudit)) {
    if (seen.has(pg.book_id)) continue; // two runs can draw the same book; a book is one observation
    seen.add(pg.book_id);
    rows.push({ ...pg, paired: votes?.get(`${pg.book_id}:${pg.page_number}`) ?? null, leaf: leaf?.get(`${pg.book_id}:${pg.page_number}`) ?? null });
  }
  fs.mkdirSync(OUT, { recursive: true });
  writeJsonl(F('reference.jsonl'), rows);
  const pos = rows.filter((r) => r.garbled);
  console.log(`reference: ${rows.length} pages / ${seen.size} books | garbled ${pos.length} (major ${pos.filter((r) => r.major).length}) | judge flagged wrong_page ${rows.filter((r) => r.wrong_page).length} | by-eye leaf verdict (#5311): ${JSON.stringify(rows.reduce((a, r) => ((a[r.leaf ?? 'not-checked'] = (a[r.leaf ?? 'not-checked'] || 0) + 1), a), {}))}`);
  if (votes) {
    const withVotes = rows.filter((r) => r.paired);
    const tab = {}; for (const r of withVotes) { const k = `${r.garbled ? 'audit:garbled' : 'audit:clean'} → paired ${r.paired.garbled}/${r.paired.n}`; tab[k] = (tab[k] || 0) + 1; }
    console.log(`paired-arm votes on ${withVotes.length} of them (same OCR text, three more judgments):`); for (const k of Object.keys(tab).sort()) console.log(`  ${k}: ${tab[k]}`);
  }
}

// ───────────────────────────── second reads already on file: page_revisions ─────────────────────────────
async function stageRevisions() {
  const { withMongo } = await import('../lib/mongo.mjs');
  const ref = readJsonl(F('reference.jsonl')); const byPage = new Map(ref.map((r) => [r.page_id, r]));
  const reads = []; const live = [];
  await withMongo(async (db) => {
    const ids = [...byPage.keys()];
    const pages = await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, photo: 1, archived_photo: 1, 'archive_metadata.source': 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.model': 1, 'ocr.prompt_version': 1, 'ocr.updated_at': 1, 'ocr.engine.generation.temperature': 1, 'ocr.engine.call_site': 1 } }).toArray();
    const bookIds = [...new Set(ref.map((r) => r.book_id))];
    const books = new Map((await db.collection('books').find({ id: { $in: bookIds } }, { projection: { id: 1, ia_identifier: 1, image_source: 1, language: 1 } }).toArray()).map((b) => [b.id, b]));
    for (const p of pages) {
      const r = byPage.get(p.id); const b = books.get(r.book_id) || {};
      live.push({ id: r.id, page_id: p.id, book_id: r.book_id, page_number: p.page_number, photo: p.photo ?? null, archived_photo: p.archived_photo ?? null, archive_source: p.archive_metadata?.source ?? null,
        ia_id: b.ia_identifier || (b.image_source?.provider === 'internet_archive' ? b.image_source?.identifier : null) || null, image_provider: b.image_source?.provider ?? null,
        live_source: p.ocr?.source ?? null, live_model: p.ocr?.model ?? null, live_prompt_version: p.ocr?.prompt_version ?? null, live_updated_at: p.ocr?.updated_at ?? null,
        live_hash: sha(p.ocr?.data), judged_text_is_live: sha(p.ocr?.data) === r.ocr_hash });
    }
    const revs = await db.collection('page_revisions').find({ page_id: { $in: ids }, field: 'ocr' }, { projection: { page_id: 1, data: 1, source: 1, model: 1, prompt_version: 1, original_date: 1, created_at: 1, job_id: 1 } }).toArray();
    for (const v of revs) {
      const r = byPage.get(v.page_id);
      reads.push({ id: r.id, page_id: v.page_id, kind: 'revision', source: v.source ?? null, model: v.model ?? null, prompt_version: v.prompt_version ?? null, original_date: v.original_date ?? null, created_at: v.created_at ?? null,
        is_reading_source: READING_SOURCES.has(v.source), is_maintenance: isMaintenanceSource(v.source), text_hash: sha(v.data), text: typeof v.data === 'string' ? v.data : '' });
    }
  }, { timeoutMs: 10 * 60 * 1000 });
  writeJsonl(F('pages-live.jsonl'), live); writeJsonl(F('reads-revisions.jsonl'), reads);
  const bySource = {}; for (const r of reads) bySource[r.source ?? '(null)'] = (bySource[r.source ?? '(null)'] || 0) + 1;
  const pagesWith = new Set(reads.map((r) => r.page_id)); const pagesWithReading = new Set(reads.filter((r) => r.is_reading_source && !r.is_maintenance).map((r) => r.page_id));
  console.log(`live pages found ${live.length}/${ref.length} | judged text is still the live text: ${live.filter((l) => l.judged_text_is_live).length}`);
  console.log(`ocr revisions: ${reads.length} rows on ${pagesWith.size} pages | by source ${JSON.stringify(bySource)} | pages with a READING-source revision: ${pagesWithReading.size}`);
  console.log(`garbled pages with a reading-source revision: ${ref.filter((r) => r.garbled && pagesWithReading.has(r.page_id)).length}/${ref.filter((r) => r.garbled).length}`);
  console.log(`Internet Archive pages (book has an IA identifier): ${live.filter((l) => l.ia_id).length} | garbled among them ${live.filter((l) => l.ia_id && byPage.get(l.page_id).garbled).length}`);
}

// ───────────────────────────── second reads already on file: the Archive's own OCR ─────────────────────────────
/** Dominant Unicode script of a text's letters — a second read in another script cannot judge (it is the Archive's engine run with the wrong language pack, not a disagreement about the page). */
const SCRIPTS = ['Latin', 'Greek', 'Cyrillic', 'Hebrew', 'Arabic', 'Syriac', 'Devanagari', 'Bengali', 'Tibetan', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Armenian', 'Georgian', 'Ethiopic', 'Thai'];
const SCRIPT_RES = SCRIPTS.map((s) => [s, new RegExp(`\\p{Script=${s}}`, 'u')]);
function dominantScript(text) {
  const body = tokensBody(text).join(''); const n = {}; let total = 0;
  for (const ch of body.slice(0, 4000)) for (const [s, re] of SCRIPT_RES) if (re.test(ch)) { const k = s === 'Hiragana' || s === 'Katakana' ? 'Han' : s; n[k] = (n[k] || 0) + 1; total++; break; }
  const top = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  return top && total >= 20 ? { script: top[0], share: round(top[1] / total, 2) } : { script: null, share: null };
}

/** One `<OBJECT>` of a `_djvu.xml` → plain text. Same walk as `leafTexts()` in scripts/import/ia-ocr-ingest.mjs (not importable: that file runs on import). */
const decodeXml = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
function objectText(o) {
  const paras = [];
  for (const p of o.split(/<PARAGRAPH\b/).slice(1)) {
    const lines = [];
    for (const l of p.split(/<LINE\b/).slice(1)) { const words = [...l.matchAll(/<WORD[^>]*>([\s\S]*?)<\/WORD>/g)].map((m) => decodeXml(m[1]).trim()).filter(Boolean); if (words.length) lines.push(words.join(' ')); }
    if (lines.length) paras.push(lines.join('\n'));
  }
  return paras.join('\n\n');
}

async function stageIa() {
  const { iaFetch, iaOcrMeta } = await import('../lib/ia-ocr-meta.mjs');
  const { leafConfidence } = await import('../lib/ia-ocr-confidence.mjs');
  const CACHE = one('cache', '/root/sl-ia-cache');
  const live = readJsonl(F('pages-live.jsonl'));
  const outFile = F('reads-ia.jsonl');
  const done = new Set(fs.existsSync(outFile) ? readJsonl(outFile).map((r) => r.page_id) : []); // checkpoint: one row per page, appended
  const out = fs.createWriteStream(outFile, { flags: 'a' });
  const emit = (row) => out.write(JSON.stringify(row) + '\n');
  let n = 0;
  for (const l of live) {
    if (!l.ia_id || done.has(l.page_id)) continue;
    const base = { id: l.id, page_id: l.page_id, kind: 'ia_djvu', ia_id: l.ia_id };
    const m = String(l.photo || '').match(/\/page\/n(\d+)\//);
    if (l.live_source === 'ia_djvu') { emit({ ...base, abstain: 'served-read-is-the-archive-text' }); continue; }
    if (!m) { emit({ ...base, abstain: 'no-leaf-index-in-photo-url' }); continue; }
    const K = +m[1];
    try {
      const meta = await iaOcrMeta(l.ia_id);
      if (!meta.has_djvu_xml) { emit({ ...base, leaf: K, abstain: 'item-has-no-djvu-xml', engine: meta.engine ?? null }); continue; }
      if (meta.djvu_xml_files.length > 1) { emit({ ...base, leaf: K, abstain: 'several-djvu-xml-on-item', engine: meta.engine ?? null }); continue; }
      const cached = path.join(CACHE, `${l.ia_id}_djvu.xml`);
      let xml;
      if (fs.existsSync(cached)) xml = fs.readFileSync(cached, 'utf8');
      else { const res = await iaFetch(`https://archive.org/download/${l.ia_id}/${encodeURIComponent(meta.djvu_xml_files[0])}`); if (!res.ok) { emit({ ...base, leaf: K, abstain: `http-${res.status}` }); continue; } xml = await res.text(); } // not cached: the box has 18 GB free
      const objs = xml.split(/<OBJECT\b/).slice(1); xml = null;
      const leaves = {}; for (let d = -2; d <= 2; d++) if (objs[K + d] != null) leaves[d] = objectText(objs[K + d]);
      const conf = objs[K] != null ? leafConfidence('<OBJECT' + objs[K])[0] : null;
      emit({ ...base, leaf: K, n_leaves: objs.length, engine: meta.engine ?? null, engine_version: meta.version ?? null, detected_lang: meta.detected_lang ?? null, confidence: conf, leaves });
    } catch (e) { emit({ ...base, leaf: K, abstain: `error: ${String(e.message || e).slice(0, 80)}` }); }
    if (++n % 10 === 0) console.log(`  ${n} items fetched`);
  }
  await new Promise((r) => out.end(r));
  const rows = readJsonl(outFile); const ab = {}; for (const r of rows) if (r.abstain) ab[r.abstain.replace(/^error: .*/, 'error')] = (ab[r.abstain.replace(/^error: .*/, 'error')] || 0) + 1;
  console.log(`ia: ${rows.length} pages | with the leaf's text ${rows.filter((r) => r.leaves?.[0] != null).length} | abstained ${JSON.stringify(ab)}`);
}

// ───────────────────────────── score ─────────────────────────────
/** Area under the ROC curve for "higher score = garbled" (Mann–Whitney, ties half). null without both classes. */
function auc(pos, neg) {
  if (!pos.length || !neg.length) return null;
  let s = 0; for (const p of pos) for (const q of neg) s += p > q ? 1 : p === q ? 0.5 : 0;
  return round(s / (pos.length * neg.length));
}
/** Wilson 95% interval for a proportion — small counts, no bootstrap (lib/paired-stats.mjs's generator is under repair, #5373). */
function wilson(k, n) {
  if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [round((c - h) / d, 2), round((c + h) / d, 2)];
}
const LABELS = {
  audit: (r) => r.garbled,                                                         // the judge's flag, as PR #5369 scored it
  major: (r) => r.major,                                                           // major-severity garble only
  consensus: (r) => (r.paired ? (r.paired.garbled + (r.garbled ? 1 : 0)) / (r.paired.n + 1) >= 0.5 : null), // majority of every judgment of this OCR text; null without the #5372 votes
  any_vote: (r) => r.garbled || (r.paired?.garbled ?? 0) > 0,                      // ANY judgment called it garbled — the most generous reading of the judge
};
/** The audit's script split (translation-corpus-audit/score.mjs by_script_class). */
const LATIN_SCRIPT = new Set(['Latin', 'English', 'German', 'French', 'Italian', 'Dutch', 'Spanish']);
const scriptClass = (r) => (LATIN_SCRIPT.has(r.language) ? 'latin-script' : 'non-latin-script');
/** The IA read for a page: the leaf's own text, unless a NEIGHBOURING leaf fits the served read clearly better (that is the wrong-leaf class, #5309 — not garble). */
function iaComparison(served, ia) {
  if (ia.abstain) return { judged: false, why: ia.abstain };
  if (ia.leaves?.[0] == null) return { judged: false, why: 'leaf-out-of-range' };
  const own = twoReadAgreement(served, ia.leaves[0]);
  let best = { d: 0, ratio: own.judged ? own.ratio : 0 };
  for (const d of [-2, -1, 1, 2]) if (ia.leaves[d] != null) { const a = twoReadAgreement(served, ia.leaves[d]); if (a.judged && a.ratio > best.ratio) best = { d, ratio: a.ratio }; }
  if (best.d !== 0 && best.ratio >= 0.5 && best.ratio - (own.judged ? own.ratio : 0) >= 0.2) return { judged: false, why: 'neighbour-leaf-fits-better', neighbour: best.d, neighbour_ratio: best.ratio, own_ratio: own.judged ? own.ratio : null };
  if (!own.judged) return own;
  const sa = dominantScript(served), sb = dominantScript(ia.leaves[0]);
  if (sa.script && sb.script && sa.script !== sb.script) return { judged: false, why: 'second-read-in-another-script', served_script: sa.script, second_script: sb.script };
  return own;
}
function prAt(rows, flag, label) {
  const tp = rows.filter((r) => flag(r) && label(r)).length, fp = rows.filter((r) => flag(r) && !label(r)).length, fn = rows.filter((r) => !flag(r) && label(r)).length;
  return { flagged: tp + fp, tp, fp, fn, precision: tp + fp ? round(tp / (tp + fp), 2) : null, precision_ci: wilson(tp, tp + fp), recall: tp + fn ? round(tp / (tp + fn), 2) : null };
}
function scoreKind(kind, comps, ref, labelName) {
  const label = LABELS[labelName];
  // A page whose served text is ANOTHER LEAF's (#5311, by eye) is not a garble question: any second read of the shown image disagrees with it totally. Its own bucket.
  const wrongLeaf = comps.filter((c) => ref.get(c.id).leaf === 'mismatch');
  const rows = comps.filter((c) => ref.get(c.id).leaf !== 'mismatch').map((c) => ({ ...c, ref: ref.get(c.id) })).filter((c) => label(c.ref) != null).map((c) => ({ ...c, y: !!label(c.ref) }));
  const pages = [...new Set(rows.map((r) => r.id))];
  const judged = rows.filter((r) => r.judged);
  const abstained = {}; for (const r of rows.filter((x) => !x.judged)) abstained[r.why] = (abstained[r.why] || 0) + 1;
  const pos = judged.filter((r) => r.y), neg = judged.filter((r) => !r.y);
  const out = { kind, label: labelName, measure: 'agreement (second read vs served read) scored against a judged label', pages_with_a_second_read: pages.length, judged: judged.length, positives_judged: pos.length,
    positives_in_reference: [...ref.values()].filter((r) => r.leaf !== 'mismatch' && label(r)).length, abstained,
    wrong_leaf_pages: wrongLeaf.map((c) => ({ url: ref.get(c.id).url, judged: c.judged, ratio: c.ratio ?? null, why: c.why ?? null })),
    median_ratio: { garbled: med(pos.map((r) => r.ratio)), clean: med(neg.map((r) => r.ratio)) },
    auc: { disagreement: auc(pos.map((r) => 1 - r.ratio), neg.map((r) => 1 - r.ratio)), worst_window: auc(pos.map((r) => 1 - r.worst_window), neg.map((r) => 1 - r.worst_window)), low_windows: auc(pos.map((r) => r.low_windows), neg.map((r) => r.low_windows)) },
    sweep: [] };
  if (pos.length) for (const t of [0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]) out.sweep.push({ rule: `ratio < ${t}`, ...prAt(judged.map((r) => ({ ...r })), (r) => r.ratio < t, (r) => r.y) });
  if (pos.length) for (const t of [0.05, 0.15, 0.3, 0.5]) out.sweep.push({ rule: `low_windows > ${t}`, ...prAt(judged, (r) => r.low_windows > t, (r) => r.y) });
  // recall against EVERY positive in the reference, not just the ones this read could judge
  for (const s of out.sweep) s.recall_of_all_positives = out.positives_in_reference ? round(s.tp / out.positives_in_reference, 2) : null;
  // Agreement has a different floor per script (a re-read of a Tibetan manuscript diverges whether or not anything is wrong): never pool without showing the split.
  out.by_script = {};
  for (const cls of ['latin-script', 'non-latin-script']) {
    const j = judged.filter((r) => scriptClass(r.ref) === cls), p = j.filter((r) => r.y), n = j.filter((r) => !r.y);
    out.by_script[cls] = { judged: j.length, positives: p.length, median_ratio: { garbled: med(p.map((r) => r.ratio)), clean: med(n.map((r) => r.ratio)) }, auc_disagreement: auc(p.map((r) => 1 - r.ratio), n.map((r) => 1 - r.ratio)),
      at_0_7: prAt(j, (r) => r.ratio < 0.7, (r) => r.y), at_0_5: prAt(j, (r) => r.ratio < 0.5, (r) => r.y) };
  }
  return out;
}
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

/**
 * What a fresh second read costs, from what the pilot was BILLED per request (tokens × list price × batch), by script
 * class — refusals and 16K-token loops included, because a lane pays for those too. Populations come from files:
 * the monthly audit's frame (live translated pages by language) and coverage.json. A rate, with its vintage; not a quote.
 */
async function costToCover(refRows) {
  const FRAME = one('frame', ''); if (!FRAME || !fs.existsSync(FRAME) || !fs.existsSync(F('coverage.json'))) return null;
  const { priceFor, BATCH_MULTIPLIER } = await import('../lib/model-pricing.mjs');
  const ref = new Map(refRows.map((r) => [r.page_id, r])); const per = {};
  for (const p of pilotRows().values()) { const cls = scriptClass(ref.get(p.page_id)); const pr = priceFor(p.model);
    const c = BATCH_MULTIPLIER * ((p.inTok / 1e6) * pr.input + (p.outTok / 1e6) * pr.output);
    for (const k of [`${p.arm}|${cls}`, `${p.arm}|all`]) { const e = per[k] || (per[k] = { requests: 0, usd: 0 }); e.requests++; e.usd += c; } }
  const rate = (arm, cls) => per[`${arm}|${cls}`].usd / per[`${arm}|${cls}`].requests;
  const weights = JSON.parse(fs.readFileSync(FRAME, 'utf8')).weights; const cov = JSON.parse(fs.readFileSync(F('coverage.json'), 'utf8'));
  const pop = { 'latin-script': 0, 'non-latin-script': 0 }; for (const [lang, w] of Object.entries(weights)) pop[LATIN_SCRIPT.has(lang) ? 'latin-script' : 'non-latin-script'] += w.translated_pages;
  const plans = { 'one lite read': (c) => rate('L', c), 'two lite reads': (c) => rate('L', c) + rate('L2', c), 'lite + flash (the class split scored here)': (c) => rate('L', c) + rate('F', c) };
  const out = { measured: new Date().toISOString().slice(0, 10), basis: 'pilot batch billing per request (incl. refusals and truncated loops), Batch API', usd_per_request: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, round(v.usd / v.requests, 5)])),
    frame: { source: FRAME, languages: Object.keys(weights).length, translated_pages: pop, note: 'the monthly audit frame: live translated pages in its 15 languages' }, live_translated_pages_all_languages: cov.live.pages_translated, plans: {} };
  for (const [name, f] of Object.entries(plans)) out.plans[name] = {
    non_latin_script_pages: { pages: pop['non-latin-script'], usd: Math.round(pop['non-latin-script'] * f('non-latin-script')) },
    latin_script_pages: { pages: pop['latin-script'], usd: Math.round(pop['latin-script'] * f('latin-script')) },
    every_live_translated_page: { pages: cov.live.pages_translated, usd: Math.round(cov.live.pages_translated * f('all')), note: 'priced at the pooled pilot rate; the pilot over-samples non-Latin pages, so this leans high' } };
  // Wrong-leaf is a run of pages inside a book: a few pages per book find it; a second read is needed only on the hits.
  out.wrong_leaf_sample = { internet_archive_books: cov.internet_archive.books, pages_per_book: 3, usd_one_lite_read: Math.round(cov.internet_archive.books * 3 * rate('L', 'latin-script')), note: 'Archive books are mostly Latin-script print; priced at that rate' };
  return out;
}

async function stageScore() {
  const refRows = readJsonl(F('reference.jsonl')); const ref = new Map(refRows.map((r) => [r.page_id, r])); // page_id, not the audit's item id: item ids repeat ACROSS runs
  const comps = []; // one row per (page, second read)
  if (fs.existsSync(F('reads-revisions.jsonl'))) for (const v of readJsonl(F('reads-revisions.jsonl'))) {
    const r = ref.get(v.page_id); const base = { id: v.page_id, kind: 'revision', second: `${v.source}/${v.model}`, source: v.source };
    if (v.is_maintenance || !v.is_reading_source || ['skip', 'manual', 'contributor'].includes(v.source)) { comps.push({ ...base, kind: 'revision-excluded', judged: false, why: `source-not-a-model-read:${v.source}` }); continue; }
    if (v.text_hash === r.ocr_hash) { comps.push({ ...base, judged: false, why: 'byte-identical-to-served (a snapshot, not a second read)' }); continue; }
    comps.push({ ...base, ...twoReadAgreement(r.ocr, v.text) });
  }
  if (fs.existsSync(F('reads-ia.jsonl'))) for (const ia of readJsonl(F('reads-ia.jsonl'))) {
    const r = ref.get(ia.page_id); comps.push({ id: ia.page_id, kind: 'ia_djvu', second: ia.engine ?? 'ia', confidence: ia.confidence ?? null, ...iaComparison(r.ocr, ia) });
  }
  const pilot = pilotRows();
  for (const p of pilot.values()) {
    const r = ref.get(p.page_id); const base = { id: p.page_id, kind: `pilot:served-vs-${p.arm}`, second: p.model };
    if (p.outcome !== 'text') { comps.push({ ...base, judged: false, why: `second-read-${p.outcome}` }); continue; }
    comps.push({ ...base, ...twoReadAgreement(r.ocr, p.text) });
  }
  // Two fresh reads against EACH OTHER, the served text not involved: is the page hard to read at all?
  for (const [a, b] of [['L', 'L2'], ['L', 'F']]) for (const r of refRows) {
    const x = pilot.get(`${r.page_id}:${a}`), y = pilot.get(`${r.page_id}:${b}`); if (!x || !y) continue;
    const base = { id: r.page_id, kind: `pilot:${a}-vs-${b}`, second: `${x.model} vs ${y.model}` };
    if (x.outcome !== 'text' || y.outcome !== 'text') { comps.push({ ...base, judged: false, why: `a-read-${x.outcome !== 'text' ? x.outcome : y.outcome}` }); continue; }
    const ag = twoReadAgreement(x.text, y.text);
    comps.push({ ...base, ...ag, ...(ag.judged ? {} : { why: 'a-fresh-read-short' }) }); // neither side is the served text here
  }
  // Both fresh reads must disagree with the served one: the higher of the two agreements (one odd second read cannot flag a page).
  for (const r of refRows) {
    const x = comps.find((c) => c.id === r.page_id && c.kind === 'pilot:served-vs-L'), y = comps.find((c) => c.id === r.page_id && c.kind === 'pilot:served-vs-F'); if (!x || !y) continue;
    const base = { id: r.page_id, kind: 'pilot:served-vs-best-of-L-F', second: 'max agreement over L, F' };
    if (!x.judged || !y.judged) { comps.push({ ...base, judged: false, why: `one-read-unjudged:${(!x.judged ? x : y).why}` }); continue; }
    comps.push({ ...base, judged: true, ratio: Math.max(x.ratio, y.ratio), worst_window: Math.max(x.worst_window, y.worst_window), low_windows: Math.min(x.low_windows, y.low_windows), len_ratio: Math.max(x.len_ratio, y.len_ratio) });
  }
  // A page with several revisions is still one page: keep its most recent model read.
  const kinds = [...new Set(comps.map((c) => c.kind))].filter((k) => k !== 'revision-excluded');
  const report = { measure: 'agreement scored against a judged label (eval-design §2: a screening signal, not accuracy)', reference: { pages: refRows.length, garbled: refRows.filter((r) => r.garbled).length, major: refRows.filter((r) => r.major).length,
    consensus_labelled: refRows.filter((r) => LABELS.consensus(r) != null).length, consensus_garbled: refRows.filter((r) => LABELS.consensus(r)).length }, min_tokens: MIN_TOKENS, kinds: {} };
  for (const k of kinds) {
    const byPage = new Map(); for (const c of comps.filter((x) => x.kind === k)) { const prev = byPage.get(c.id); if (!prev || (!prev.judged && c.judged)) byPage.set(c.id, c); }
    const list = [...byPage.values()];
    report.kinds[k] = Object.fromEntries(Object.keys(LABELS).map((l) => [l, scoreKind(k, list, ref, l)]));
    report.kinds[k].coverage_of_reference = round(list.length / refRows.length);
    report.kinds[k].judged_share_of_reference = round(list.filter((c) => c.judged).length / refRows.length);
  }
  // The Archive engine's own word confidence, where it exists (a one-read signal from a second engine).
  const conf = comps.filter((c) => c.kind === 'ia_djvu' && c.confidence);
  if (conf.length) { const pos = conf.filter((c) => ref.get(c.id).garbled), neg = conf.filter((c) => !ref.get(c.id).garbled);
    report.ia_confidence = { pages: conf.length, positives: pos.length, auc_lowShare: auc(pos.map((c) => c.confidence.lowShare), neg.map((c) => c.confidence.lowShare)), auc_mean: auc(pos.map((c) => -c.confidence.mean), neg.map((c) => -c.confidence.mean)) }; }
  // How well does the JUDGE reproduce its own flag? Each #5372 arm is one more judgment of the same OCR text; scored as if it were a detector
  // against the audit flag. A detector cannot be shown to beat this on this reference, whatever it does.
  report.judge_vs_itself = {};
  for (const arm of ['L1', 'L2', 'F']) { const rows = refRows.filter((r) => r.paired && arm in r.paired.arms); report.judge_vs_itself[arm] = { pages: rows.length, ...prAt(rows, (r) => r.paired.arms[arm], (r) => r.garbled) }; }
  // The three-read classes (thresholds in pageClass): who is the outlier — the served text, or the page?
  { const kind = (k) => new Map(comps.filter((c) => c.kind === k).map((c) => [c.id, c])); const sv = kind('pilot:served-vs-best-of-L-F'), ff = kind('pilot:L-vs-F'); const classes = {};
    for (const r of refRows) { const a = sv.get(r.page_id), b = ff.get(r.page_id); if (!a || !b) continue; const cls = pageClass(a.judged ? a.ratio : null, b.judged ? b.ratio : null);
      const t = classes[cls] || (classes[cls] = { pages: 0, wrong_leaf_by_eye: 0, audit_garbled: 0, major: 0, any_vote: 0, latin_script: 0, non_latin_script: 0 });
      t.pages++; scriptClass(r) === 'latin-script' ? t.latin_script++ : t.non_latin_script++;
      if (r.leaf === 'mismatch') t.wrong_leaf_by_eye++; else { if (r.garbled) t.audit_garbled++; if (r.major) t.major++; if (LABELS.any_vote(r)) t.any_vote++; } }
    if (Object.keys(classes).length) report.three_read_classes = { thresholds: { served_agrees: 'served vs best fresh read >= 0.7', fresh_agree: 'lite vs flash >= 0.8' }, fixed: 'after the judged sweep was read, before any image was opened (in-sample against the judge; the by-eye sample is drawn afterwards)', classes }; }
  report.cost_to_cover = await costToCover(refRows);
  fs.writeFileSync(F('report.json'), JSON.stringify(report, null, 1));
  writeJsonl(F('scores.jsonl'), comps.map((c) => { const r = ref.get(c.id); return { ...c, language: r.language, garbled: r.garbled, major: r.major, consensus: LABELS.consensus(r), url: r.url }; }));
  // Compact table; the full sweep per label is in report.json.
  const cell = (x) => (x ? `P ${x.precision ?? '—'} R ${x.recall ?? '—'} (${x.tp}/${x.flagged})` : '—');
  for (const k of kinds) { const a = report.kinds[k].audit; const at = (rule) => a.sweep.find((x) => x.rule === rule);
    console.log(`\n${k}: judged ${a.judged}/${refRows.length} (positives ${a.positives_judged}/${a.positives_in_reference}) | median ratio garbled ${a.median_ratio.garbled} vs clean ${a.median_ratio.clean} | AUC ${a.auc.disagreement} | abstained ${Object.values(a.abstained).reduce((x, y) => x + y, 0)}`);
    if (!a.positives_judged) { console.log('  no judged positive: UNJUDGED, not "no signal"'); continue; }
    console.log(`  audit label      <0.8 ${cell(at('ratio < 0.8'))} | <0.7 ${cell(at('ratio < 0.7'))} | <0.5 ${cell(at('ratio < 0.5'))}   [recall of all ${a.positives_in_reference}: ${at('ratio < 0.7').recall_of_all_positives} at <0.7]`);
    for (const l of ['major', 'consensus', 'any_vote']) { const b = report.kinds[k][l]; const bt = (rule) => b.sweep.find((x) => x.rule === rule); console.log(`  ${l.padEnd(16)} <0.7 ${cell(bt('ratio < 0.7'))} | <0.5 ${cell(bt('ratio < 0.5'))} | AUC ${b.auc.disagreement} (positives ${b.positives_judged}/${b.positives_in_reference})`); }
    for (const [cls, v] of Object.entries(a.by_script)) console.log(`  ${cls.padEnd(16)} judged ${v.judged} pos ${v.positives} | median garbled ${v.median_ratio.garbled} clean ${v.median_ratio.clean} | AUC ${v.auc_disagreement} | <0.7 ${cell(v.at_0_7)} | <0.5 ${cell(v.at_0_5)}`);
    if (a.wrong_leaf_pages.length) console.log(`  wrong-leaf pages (#5311, excluded above): ${a.wrong_leaf_pages.map((w) => (w.judged ? w.ratio : 'unjudged')).join(', ')}`);
  }
  if (report.three_read_classes) { console.log('\nthree-read classes:'); for (const [c, t] of Object.entries(report.three_read_classes.classes)) console.log(`  ${c.padEnd(22)} ${String(t.pages).padStart(3)} pages | audit-garbled ${t.audit_garbled} (major ${t.major}) | any-vote ${t.any_vote} | wrong-leaf by eye ${t.wrong_leaf_by_eye} | latin ${t.latin_script} / non-latin ${t.non_latin_script}`); }
  if (report.cost_to_cover) { const c = report.cost_to_cover; console.log(`\ncost per request (batch, measured ${c.measured}): ${JSON.stringify(c.usd_per_request)}`);
    for (const [name, v] of Object.entries(c.plans)) console.log(`  ${name.padEnd(44)} non-Latin ${v.non_latin_script_pages.pages.toLocaleString()} pp $${v.non_latin_script_pages.usd.toLocaleString()} | Latin-script ${v.latin_script_pages.pages.toLocaleString()} pp $${v.latin_script_pages.usd.toLocaleString()} | every live translated page ${v.every_live_translated_page.pages.toLocaleString()} pp $${v.every_live_translated_page.usd.toLocaleString()}`);
    console.log(`  wrong-leaf sample: ${c.wrong_leaf_sample.internet_archive_books.toLocaleString()} Archive books × 3 pages × one lite read ≈ $${c.wrong_leaf_sample.usd_one_lite_read}`); }
  console.log(`\njudge vs itself (a #5372 re-judgment scored as a detector of the audit flag): ${Object.entries(report.judge_vs_itself).map(([arm, v]) => `${arm} P ${v.precision} R ${v.recall} (${v.tp}/${v.flagged}, n=${v.pages})`).join(' | ')}`);
  if (report.ia_confidence) console.log(`\nArchive word confidence: ${JSON.stringify(report.ia_confidence)}`);
}

// ───────────────────────────── a fresh second read (paid pilot, Batch API) ─────────────────────────────
// Arms. L and L2 are the same request twice (the second read's own repeat noise — eval-design §7, A-vs-A
// first); F is the other production OCR model. All read the image the READER is shown (`display_photo`,
// the audit's `manifest.image`), resized as the pipeline resizes it, under the live default OCR prompt
// and the pipeline's generation settings (pipeline-orchestrator.mjs OCR_GENERATION_CONFIG).
const PILOT_ARMS = { L: 'gemini-3.1-flash-lite', L2: 'gemini-3.1-flash-lite', F: 'gemini-3-flash-preview' };
const PILOT_GENERATION = { temperature: 0.1, maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } };
const PILOT_IMAGE_MAX_PX = 1500;
const SAFETY = ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT', 'CIVIC_INTEGRITY'].map((c) => ({ category: `HARM_CATEGORY_${c}`, threshold: 'BLOCK_NONE' }));
const API = 'https://generativelanguage.googleapis.com';
const flag = (n) => argv.includes(`--${n}`);

async function stagePilotDraw() {
  const { withMongo } = await import('../lib/mongo.mjs');
  const { getProductionOcrPrompt } = await import('./lib/production-prompt.mjs');
  const { priceFor, BATCH_MULTIPLIER } = await import('../lib/model-pricing.mjs');
  const sharp = (await import('sharp')).default;
  const ref = readJsonl(F('reference.jsonl'));
  let prompt; const books = new Map();
  await withMongo(async (db) => {
    prompt = await getProductionOcrPrompt(db);
    for (const b of await db.collection('books').find({ id: { $in: ref.map((r) => r.book_id) } }, { projection: { id: 1, title: 1, author: 1, year: 1 } }).toArray()) books.set(b.id, b);
  });
  const streams = {}; for (const m of new Set(Object.values(PILOT_ARMS))) streams[m] = fs.createWriteStream(F(`pilot-requests-${m}.jsonl`));
  const drawn = []; const tokens = {}; let failed = 0;
  for (const r of ref) {
    const b = books.get(r.book_id) || {};
    // The pipeline's own document-context suffix (it exists to stop recitation blocks on public-domain works).
    const yearStr = b.year ? `Published ${b.year}.` : ''; const pd = b.year && b.year < 1930 ? 'This work is in the public domain.' : '';
    const text = yearStr || b.title ? `${prompt.text}\n\n**Document context:** "${b.title || 'Unknown'}" by ${b.author || 'Unknown'}. ${yearStr} ${pd}`.trim() : prompt.text;
    let buf, mime = 'image/jpeg';
    try {
      const res = await fetch(r.image, { signal: AbortSignal.timeout(45000) }); if (!res.ok) throw new Error(`http ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer()); mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
      if (buf.length > 100_000) { buf = await sharp(buf).resize({ width: PILOT_IMAGE_MAX_PX, height: PILOT_IMAGE_MAX_PX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(); mime = 'image/jpeg'; }
    } catch (e) { failed++; drawn.push({ page_id: r.page_id, id: r.id, image: r.image, error: String(e.message || e).slice(0, 80) }); continue; }
    const request = { contents: [{ parts: [{ text }, { inlineData: { mimeType: mime, data: buf.toString('base64') } }] }], safetySettings: SAFETY, generationConfig: PILOT_GENERATION };
    for (const [arm, model] of Object.entries(PILOT_ARMS)) {
      streams[model].write(JSON.stringify({ key: `${r.page_id}:${arm}`, request }) + '\n');
      const t = tokens[model] || (tokens[model] = { requests: 0, in: 0, out: 0 }); t.requests++;
      t.in += Math.ceil(text.length / 3.5) + 1100;                 // prompt + one image at the default media resolution
      t.out += Math.ceil((r.ocr || '').length / 2.5) + 200;        // the served read's length, generously (non-Latin scripts tokenise short)
    }
    drawn.push({ page_id: r.page_id, id: r.id, image: r.image, image_bytes: buf.length, image_hash: sha(buf.toString('base64')), prompt_sent_hash: sha(text), prompt_sent_chars: text.length });
  }
  await Promise.all(Object.values(streams).map((s) => new Promise((res) => s.end(res))));
  let usd = 0; const est = {};
  for (const [model, t] of Object.entries(tokens)) { const p = priceFor(model); const c = BATCH_MULTIPLIER * ((t.in / 1e6) * p.input + (t.out / 1e6) * p.output); est[model] = { ...t, price: p, usd: round(c, 4) }; usd += c; }
  fs.writeFileSync(F('pilot-arms.json'), JSON.stringify({ at: new Date().toISOString(), arms: PILOT_ARMS, pages: drawn.filter((d) => !d.error).length, image_fetch_failed: failed,
    prompt: { name: prompt.name, version: prompt.version, content_hash: prompt.content_hash, document_context: 'pipeline suffix (title, author, year)' }, generation: PILOT_GENERATION, image: { field: 'display_photo (manifest.image)', resized_to_px: PILOT_IMAGE_MAX_PX },
    estimate: { ...est, usd: round(usd, 4), basis: 'Batch API, 50% of list price (scripts/lib/model-pricing.mjs)' } }, null, 1));
  writeJsonl(F('pilot-sample.jsonl'), drawn);
  console.log(`pilot-draw: ${drawn.length - failed} pages × ${Object.keys(PILOT_ARMS).length} arms; image fetch failed ${failed}; prompt "${prompt.name}" v${prompt.version}`);
  for (const [m, e] of Object.entries(est)) console.log(`  ${m}: ${e.requests} requests, in ~${e.in.toLocaleString()} tok, out ~${e.out.toLocaleString()} tok → $${e.usd}`);
  console.log(`ESTIMATE (Batch API): $${usd.toFixed(2)}`);
}

async function stagePilotSubmit() {
  const meta = JSON.parse(fs.readFileSync(F('pilot-arms.json'), 'utf8'));
  const approved = Number(one('approved-usd', 0));
  if (!(approved >= meta.estimate.usd)) { console.error(`REFUSING TO SPEND: estimate $${meta.estimate.usd}, --approved-usd=${approved || 'absent'}`); process.exit(2); }
  const bf = F('pilot-batch.json'); const retry = flag('retry');
  if (fs.existsSync(bf) && !retry) { console.error('pilot-batch.json exists — already submitted; pilot-collect it, or pilot-submit --retry the errored requests'); process.exit(2); }
  const prior = retry ? JSON.parse(fs.readFileSync(bf, 'utf8')) : null;
  if (prior?.jobs.some((j) => !j.collected_at)) { console.error('a job is still uncollected — pilot-collect first'); process.exit(2); }
  const failedKeys = retry ? new Set([...pilotRows().values()].filter((r) => r.outcome === 'error').map((r) => `${r.page_id}:${r.arm}`)) : null;
  const envName = process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY'; const key = process.env[envName];
  if (!key) throw new Error(`no ${envName}`);
  const jobs = prior ? prior.jobs : [];
  for (const model of new Set(Object.values(PILOT_ARMS))) {
    const lines = fs.readFileSync(F(`pilot-requests-${model}.jsonl`), 'utf8').split('\n').filter(Boolean).filter((l) => !failedKeys || failedKeys.has(l.slice(8, l.indexOf('"', 8))));
    if (!lines.length) continue;
    const jsonl = lines.join('\n') + '\n'; const bytes = Buffer.byteLength(jsonl);
    const start = await fetch(`${API}/upload/v1beta/files?key=${key}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes), 'X-Goog-Upload-Header-Content-Type': 'text/plain' },
      body: JSON.stringify({ file: { displayName: `two-read-garble-5313-${model}` } }) });
    if (!start.ok) throw new Error(`upload start ${start.status} ${(await start.text()).slice(0, 300)}`);
    const up = await fetch(start.headers.get('X-Goog-Upload-URL'), { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body: jsonl });
    if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 300)}`);
    const fileName = (await up.json()).file?.name; if (!fileName) throw new Error('upload response missing file.name');
    // thinking-ok: a Batch job over pilot-requests-<model>.jsonl, whose every line sets thinkingConfig: { thinkingBudget: 0 } (PILOT_GENERATION); usage is logged in pilot-collect
    const create = await fetch(`${API}/v1beta/models/${model}:batchGenerateContent?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch: { display_name: `two-read-garble-5313-${model}`, input_config: { file_name: fileName } } }) });
    if (!create.ok) throw new Error(`batch create ${create.status} ${(await create.text()).slice(0, 500)}`);
    const job = await create.json();
    jobs.push({ model, job_name: job.name, file_name: fileName, requests: lines.length, submitted_at: new Date().toISOString(), ...(retry ? { retry: true } : {}) });
    fs.writeFileSync(bf, JSON.stringify({ key_env: envName, estimate_usd: meta.estimate.usd, jobs }, null, 1)); // after EACH job: a crash must not orphan a paid one
    console.log(`submitted ${job.name} (${model}, ${lines.length} requests, ${(bytes / 1e6).toFixed(0)} MB)`);
  }
}

/** reads-pilot.jsonl is append-only (a cancelled request and its retry are both rows): readers take the LAST row per (page, arm). */
function pilotRows() {
  const last = new Map(); if (!fs.existsSync(F('reads-pilot.jsonl'))) return last;
  for (const r of readJsonl(F('reads-pilot.jsonl'))) last.set(`${r.page_id}:${r.arm}`, r);
  return last;
}
/** One Batch response line → an outcome (eval-design §5.1: an enum, never inferred from the text alone). */
function outcomeOf(r) {
  const resp = r.response;
  if (r.error || !resp) return { outcome: 'error', error: JSON.stringify(r.error || 'no response').slice(0, 300) };
  const cand = resp.candidates?.[0], finish = cand?.finishReason || null;
  const raw = (cand?.content?.parts || []).map((x) => x.text || '').join('');
  const block = resp.promptFeedback?.blockReason || null;
  if (!raw.trim()) return { outcome: block || (finish && finish !== 'STOP') ? 'refusal' : 'empty', finish, block };
  return { outcome: finish === 'MAX_TOKENS' ? 'truncated' : finish && finish !== 'STOP' ? 'refusal' : 'text', finish, raw };
}
async function stagePilotCollect() {
  const { priceFor, BATCH_MULTIPLIER } = await import('../lib/model-pricing.mjs');
  const rec = JSON.parse(fs.readFileSync(F('pilot-batch.json'), 'utf8')); const key = process.env[rec.key_env];
  const waitMax = Number(one('wait-min', 0)) * 60e3, t0 = Date.now();
  for (;;) {
    let pending = 0;
    for (const j of rec.jobs) {
      if (j.collected_at) continue;
      const data = await (await fetch(`${API}/v1beta/${j.job_name}?key=${key}`)).json();
      const state = data.metadata?.state || data.state;
      console.log(`${j.job_name} ${state} ${JSON.stringify(data.metadata?.batchStats || {})}`);
      if (/FAILED|CANCELLED|EXPIRED/.test(state || '')) throw new Error(`batch ${state}`);
      const rf = data.metadata?.output?.responsesFile || data.response?.responsesFile;
      if (!rf) { pending++; continue; }
      const text = await (await fetch(`${API}/download/v1beta/${rf}:download?alt=media&key=${key}`)).text();
      let inTok = 0, outTok = 0; const outcomes = {}, rows = []; const p = priceFor(j.model);
      for (const line of text.split('\n').filter(Boolean)) {
        const r = JSON.parse(line); const [page_id, arm] = (r.key || r.metadata?.key).split(':');
        const o = outcomeOf(r), u = r.response?.usageMetadata || {};
        const it = { page_id, arm, kind: 'pilot', model: j.model, model_version: r.response?.modelVersion || null, outcome: o.outcome, finish: o.finish ?? null, batch_job: j.job_name };
        if (o.error) it.error = o.error; if (o.block) it.block = o.block;
        if (o.raw) { it.text = o.raw; it.text_hash = sha(o.raw); it.chars = o.raw.length; } // a truncated or refused read keeps its partial text but is never scored (outcome ≠ text)
        it.inTok = u.promptTokenCount || 0; it.outTok = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
        inTok += it.inTok; outTok += it.outTok; outcomes[o.outcome] = (outcomes[o.outcome] || 0) + 1; rows.push(it);
      }
      fs.appendFileSync(F('reads-pilot.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
      Object.assign(j, { collected_at: new Date().toISOString(), responses: rows.length, outcomes, in_tokens: inTok, out_tokens: outTok, cost_usd: BATCH_MULTIPLIER * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output) });
      console.log(`collected ${rows.length} ${JSON.stringify(outcomes)} $${j.cost_usd.toFixed(4)}`);
      fs.writeFileSync(F('pilot-batch.json'), JSON.stringify(rec, null, 1));
      try {
        const { logUsage } = await import('../workers/lib/supabase-usage-logger.mjs');
        await logUsage({ type: 'eval', mode: 'batch', model: j.model, page_count: (outcomes.text || 0) + (outcomes.truncated || 0), input_tokens: inTok, output_tokens: outTok, batch_job_id: j.job_name, endpoint: 'eval/two-read-garble-5313', triggered_by: 'manual', prompt_version: 'eval-5313' });
        j.usage_logged = true;
      } catch (e) { j.usage_logged = false; console.warn(`logUsage failed: ${e.message}`); }
      fs.writeFileSync(F('pilot-batch.json'), JSON.stringify(rec, null, 1));
    }
    if (!pending) { console.log(`all collected; actual $${rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0).toFixed(4)}`); return; }
    if (Date.now() - t0 > waitMax) { console.log(`${pending} job(s) pending; re-run pilot-collect later`); return; }
    await new Promise((r) => setTimeout(r, 60e3));
  }
}

// ───────────────────────────── coverage: what share of served pages HAS a second read? ─────────────────────────────
async function stageCoverage() {
  const { withMongo } = await import('../lib/mongo.mjs');
  const MODEL_READ = ['batch_api', 'ai', 'pipeline_preview', 'realtime_api_sequential', 'mineru', 'ia_djvu']; // a prior text some engine READ (ia_djvu: the Archive's)
  const out = { at: new Date().toISOString(), live_filter: 'books: visible && pages_count > 0', model_read_sources: MODEL_READ };
  await withMongo(async (db) => {
    const live = new Map(); let pages = 0, ocr = 0, tr = 0; const ia = { books: 0, pages: 0, ocr: 0, translated: 0 };
    for await (const b of db.collection('books').find({ visible: true, pages_count: { $gt: 0 } }, { projection: { _id: 0, id: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, ia_identifier: 1, 'image_source.provider': 1 } })) {
      live.set(b.id, b); pages += b.pages_count || 0; ocr += b.pages_ocr || 0; tr += b.pages_translated || 0;
      if (b.ia_identifier || b.image_source?.provider === 'internet_archive') { ia.books++; ia.pages += b.pages_count || 0; ia.ocr += b.pages_ocr || 0; ia.translated += b.pages_translated || 0; }
    }
    out.live = { books: live.size, pages, pages_ocr: ocr, pages_translated: tr, note: 'pages_ocr / pages_translated are the books\' own counters, not a page scan' };
    out.internet_archive = { ...ia, share_of_translated: round(ia.translated / tr) };
    const bySource = await db.collection('page_revisions').aggregate([{ $match: { field: 'ocr' } }, { $group: { _id: '$source', rows: { $sum: 1 } } }, { $sort: { rows: -1 } }], { allowDiskUse: true, maxTimeMS: 20 * 60 * 1000 }).toArray();
    out.page_revisions_ocr_rows_by_source = Object.fromEntries(bySource.map((s) => [s._id ?? '(null)', s.rows]));
    // pages (not rows) holding at least one prior MODEL read, per book — grouped server-side so only per-book counts cross the wire
    const perBook = await db.collection('page_revisions').aggregate([
      { $match: { field: 'ocr', source: { $in: MODEL_READ } } }, { $group: { _id: '$page_id', book_id: { $first: '$book_id' } } }, { $group: { _id: '$book_id', pages: { $sum: 1 } } },
    ], { allowDiskUse: true, maxTimeMS: 20 * 60 * 1000 }).toArray();
    let all = 0, inLive = 0, booksLive = 0; for (const b of perBook) { all += b.pages; if (live.has(b._id)) { inLive += Math.min(b.pages, live.get(b._id).pages_count); booksLive++; } }
    out.page_revisions = { pages_with_a_prior_model_read: all, of_which_in_live_books: inLive, live_books_touched: booksLive, share_of_live_pages_with_ocr: round(inLive / ocr, 4), share_of_live_translated_pages_upper_bound: round(inLive / tr, 4),
      caveat: 'an UPPER bound on usable second reads: includes byte-identical snapshots and pairs from different leaves (page-revisions-corpus.md: ~40% of pairs carry different printed page numbers)' };
  }, { timeoutMs: 45 * 60 * 1000, socketTimeoutMs: 25 * 60 * 1000 }); // the group over page_revisions is a long-but-finite scan; the 30 s default socket timeout kills it
  fs.writeFileSync(F('coverage.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

// ───────────────────────────── by-eye packet: what ARE the flagged pages, against the image? ─────────────────────────────
// The judge read OCR beside translation and never opened an image, so "precision against the judge" cannot tell a
// false alarm from a misread the judge could not see. eval-design §6: a class an instrument flags gets ~20 hand-read
// members before any rate is quoted. The packet is BLIND: three reads per page in a seeded shuffled order (A/B/C),
// no judge label, no class name; the key stays in eye/key.json.
/** Page classes from the three reads (thresholds fixed here, before any image was opened). */
function pageClass(servedVsBest, freshVsFresh) {
  if (servedVsBest == null || freshVsFresh == null) return 'unjudged';
  if (servedVsBest >= 0.7) return 'served-agrees';
  return freshVsFresh >= 0.8 ? 'served-is-the-outlier' : 'hard-page';
}
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function classedPages() {
  const ref = new Map(readJsonl(F('reference.jsonl')).map((r) => [r.page_id, r])); const by = new Map();
  for (const c of readJsonl(F('scores.jsonl'))) { if (!by.has(c.id)) by.set(c.id, {}); by.get(c.id)[c.kind] = c; }
  const out = [];
  for (const [id, k] of by) { const sv = k['pilot:served-vs-best-of-L-F'], ff = k['pilot:L-vs-F'];
    out.push({ page_id: id, ref: ref.get(id), served: sv?.judged ? sv.ratio : null, fresh: ff?.judged ? ff.ratio : null, cls: pageClass(sv?.judged ? sv.ratio : null, ff?.judged ? ff.ratio : null) }); }
  return out.sort((a, b) => (a.page_id < b.page_id ? -1 : 1));
}
async function stageEyePacket() {
  const SEED = Number(one('seed', 5313)), N_HARD = Number(one('hard', 20)), N_CTRL = Number(one('controls', 4)), IMG = one('images', ''), PER = Number(one('per-packet', 10));
  if (!IMG) { console.error('eye-packet: pass --images=<dir outside the repo> for the downloaded page images'); process.exit(2); }
  const sharp = (await import('sharp')).default;
  const rnd = mulberry32(SEED); const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pages = classedPages(); const pilot = pilotRows();
  const hard = shuffle(pages.filter((p) => p.cls === 'hard-page')).slice(0, N_HARD);                                   // label-blind random members of the flagged class
  const outlier = pages.filter((p) => p.cls === 'served-is-the-outlier' && p.ref.leaf !== 'mismatch');               // all of them (the six #5311 pages were already read by eye)
  const ctrl = shuffle(pages.filter((p) => p.cls === 'served-agrees' && p.served >= 0.95 && p.fresh >= 0.95)).slice(0, N_CTRL); // negative control: every read should match the image
  const picked = shuffle([...hard.map((p) => ({ ...p, role: 'hard' })), ...outlier.map((p) => ({ ...p, role: 'outlier' })), ...ctrl.map((p) => ({ ...p, role: 'control' }))]);
  fs.mkdirSync(F('eye'), { recursive: true }); fs.mkdirSync(IMG, { recursive: true });
  const key = []; const CAP = 3000; const strip = (t) => (t || '').replace(/<(meta|summary|keywords|vocab|image-desc)\b[^>]*>[\s\S]*?<\/\1>/gi, '').trim();
  for (const [i, p] of picked.entries()) {
    const n = String(i + 1).padStart(2, '0'); const file = path.join(IMG, `page-${n}.jpg`);
    if (!fs.existsSync(file)) { const res = await fetch(p.ref.image, { signal: AbortSignal.timeout(60000) }); if (!res.ok) throw new Error(`image ${p.ref.image}: http ${res.status}`);
      fs.writeFileSync(file, await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()); }
    const reads = shuffle([['served', p.ref.ocr], ['L', pilot.get(`${p.page_id}:L`)?.text], ['F', pilot.get(`${p.page_id}:F`)?.text]]);
    const letters = ['A', 'B', 'C'];
    const body = reads.map(([, t], j) => { const x = strip(t); return `## Read ${letters[j]}${x.length > CAP ? ` (first ${CAP} of ${x.length} characters)` : ''}\n\n${x.slice(0, CAP)}\n`; }).join('\n');
    fs.writeFileSync(F(`eye/page-${n}.md`), `# Page ${n}\n\nImage: ${file}\nLanguage (catalogue): ${p.ref.language}\n\nThree transcriptions of this one page image follow. Tags in angle brackets are markup, not page text.\n\n${body}`);
    key.push({ n, packet: Math.floor(i / PER) + 1, page_id: p.page_id, role: p.role, cls: p.cls, order: Object.fromEntries(reads.map(([name], j) => [letters[j], name])), served_vs_best: p.served, fresh_vs_fresh: p.fresh, url: p.ref.url, language: p.ref.language, garbled: p.ref.garbled, major: p.ref.major, leaf: p.ref.leaf });
  }
  fs.writeFileSync(F('eye/key.json'), JSON.stringify({ seed: SEED, thresholds: { served_agrees: 0.7, fresh_agree: 0.8 }, class_sizes: pages.reduce((a, p) => ((a[p.cls] = (a[p.cls] || 0) + 1), a), {}), pages: key }, null, 1));
  console.log(`eye-packet: ${picked.length} pages (${hard.length} hard of ${pages.filter((p) => p.cls === 'hard-page').length}, ${outlier.length} outlier, ${ctrl.length} control) in ${Math.ceil(picked.length / PER)} packets → ${F('eye')}; images → ${IMG}`);
  console.log(`class sizes: ${JSON.stringify(pages.reduce((a, p) => ((a[p.cls] = (a[p.cls] || 0) + 1), a), {}))}`);
}

/** Join the blind by-eye verdicts (eye/verdicts-*.jsonl) to the key: what is the SERVED read, against the image, in each class? */
function stageEyeScore() {
  const key = JSON.parse(fs.readFileSync(F('eye/key.json'), 'utf8')); const byN = new Map(key.pages.map((k) => [k.n, k]));
  const VERDICTS = new Set(['faithful', 'minor', 'unreliable', 'partial', 'different-page', 'cannot-tell']); const BAD = new Set(['unreliable', 'partial', 'different-page']);
  const rows = []; const malformed = []; const seen = new Set();
  for (const f of fs.readdirSync(F('eye')).filter((x) => /^verdicts-\d+\.jsonl$/.test(x)).sort()) for (const line of fs.readFileSync(F(`eye/${f}`), 'utf8').split('\n').filter((l) => l.trim())) {
    let v; try { v = JSON.parse(line); } catch { malformed.push(`${f}: unparseable line`); continue; }
    const k = byN.get(String(v.n).padStart(2, '0'));
    if (!k || ![v.A, v.B, v.C].every((x) => VERDICTS.has(x))) { malformed.push(`${f}: page ${v.n} — unknown page or verdict outside the enum`); continue; }
    if (seen.has(k.n)) { malformed.push(`${f}: page ${k.n} judged twice — first verdict kept`); continue; } seen.add(k.n);
    const read = Object.fromEntries(Object.entries(k.order).map(([letter, name]) => [name, v[letter]]));
    rows.push({ n: k.n, role: k.role, cls: k.cls, language: k.language, url: k.url, judge_garbled: k.garbled, judge_major: k.major, leaf: k.leaf, served_vs_best: k.served_vs_best, fresh_vs_fresh: k.fresh_vs_fresh,
      served: read.served, lite: read.L, flash: read.F, best: k.order[v.best] ?? v.best, legibility: v.legibility, difference: v.difference, checked: v.checked, anchor: v.anchor, label: v.label });
  }
  const missing = key.pages.filter((k) => !seen.has(k.n)).map((k) => k.n);
  const tally = (xs, f) => xs.reduce((a, x) => ((a[f(x)] = (a[f(x)] || 0) + 1), a), {});
  const block = (xs) => { const judged = xs.filter((x) => x.served !== 'cannot-tell'); const bad = judged.filter((x) => BAD.has(x.served));
    return { pages: xs.length, served_judged: judged.length, served_cannot_tell: xs.length - judged.length, served: tally(xs, (x) => x.served), lite: tally(xs, (x) => x.lite), flash: tally(xs, (x) => x.flash),
      served_materially_wrong: bad.length, share: judged.length ? round(bad.length / judged.length, 2) : null, ci: wilson(bad.length, judged.length),
      // where the served read is materially wrong, does a fresh read get the page right? (the repair question)
      of_those_a_fresh_read_is_faithful_or_minor: bad.filter((x) => ['faithful', 'minor'].includes(x.flash) || ['faithful', 'minor'].includes(x.lite)).length };
  };
  const hard = rows.filter((r) => r.role === 'hard');
  const report = { measure: 'by eye: each read compared with the page image by a reader blind to which read is served, to the judge label and to the class', readers: 'Opus subagents, one packet each; label on every row', pages_in_packet: key.pages.length, verdicts: rows.length, missing, malformed,
    materially_wrong_means: [...BAD], by_role: { hard: block(hard), outlier: block(rows.filter((r) => r.role === 'outlier')), control: block(rows.filter((r) => r.role === 'control')) },
    hard_by_judge_label: { judge_garbled: block(hard.filter((r) => r.judge_garbled)), judge_clean: block(hard.filter((r) => !r.judge_garbled)) },
    hard_by_script: { 'latin-script': block(hard.filter((r) => LATIN_SCRIPT.has(r.language))), 'non-latin-script': block(hard.filter((r) => !LATIN_SCRIPT.has(r.language))) } };
  fs.writeFileSync(F('eye/report.json'), JSON.stringify(report, null, 1)); writeJsonl(F('eye/joined.jsonl'), rows);
  console.log(`by-eye verdicts ${rows.length}/${key.pages.length} | missing ${missing.length ? missing.join(',') : 'none'} | malformed ${malformed.length}`); for (const m of malformed) console.log(`  ! ${m}`);
  const line = (name, b) => console.log(`  ${name.padEnd(26)} ${b.pages} pages | served materially wrong ${b.served_materially_wrong}/${b.served_judged} ${b.share ?? ''} ${JSON.stringify(b.ci)} (cannot-tell ${b.served_cannot_tell}) | served ${JSON.stringify(b.served)} | flash ${JSON.stringify(b.flash)} | lite ${JSON.stringify(b.lite)} | a fresh read is good on ${b.of_those_a_fresh_read_is_faithful_or_minor} of the wrong ones`);
  line('control (expect none)', report.by_role.control); line('hard page', report.by_role.hard); line('  · judge said garbled', report.hard_by_judge_label.judge_garbled); line('  · judge said clean', report.hard_by_judge_label.judge_clean);
  line('  · latin-script', report.hard_by_script['latin-script']); line('  · non-latin-script', report.hard_by_script['non-latin-script']); line('served is the outlier', report.by_role.outlier);
}

const STAGES = { 'eye-packet': stageEyePacket, 'eye-score': stageEyeScore, reference: stageReference, revisions: stageRevisions, ia: stageIa, score: stageScore, coverage: stageCoverage, 'pilot-draw': stagePilotDraw, 'pilot-submit': stagePilotSubmit, 'pilot-collect': stagePilotCollect };
if (!STAGES[STAGE]) { console.error(`stage must be one of: ${Object.keys(STAGES).join(', ')}`); process.exit(2); }
await STAGES[STAGE]();
