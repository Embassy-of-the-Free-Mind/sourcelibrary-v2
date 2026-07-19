#!/usr/bin/env node
/**
 * Corpus-scale OCR revision-agreement analysis (#3235 double-OCR workstream).
 *
 * Generalizes `revision-agreement-pilot.mjs` (Phase B) from a $sample of a few
 * thousand pairs to the WHOLE `page_revisions` OCR corpus (~126K revisions).
 *
 * What a "pair" is here: `page_revisions` stores the PRIOR value that a re-OCR
 * replaced. A page with N stored revisions therefore has a chain
 *   rev_1 (oldest prior) → rev_2 → … → rev_N (most recent prior) → pages.ocr (live)
 * and every consecutive step is one real rewrite transition. The pilot only ever
 * compared a sampled revision against the live text; here we emit every step,
 * flagged by `is_live` (does the "current" side of this pair come from pages.ocr).
 *
 * Metric parity: `agreement()` is character-for-character the pilot's metric —
 * wrappers stripped, letters only, word-level normalized Levenshtein capped at
 * 800 words. It must stay computable on any page pair with no reference.
 *
 * Covariates: the pilot's (language, year, prior/current model, prompt versions,
 * length delta) plus the OCR envelope tags <columns> / <page-type> / <lang>
 * parsed from BOTH sides (the tag families listed in CLAUDE.md's quote-integrity
 * section — they describe the scan, so a change in them is itself a signal).
 *
 * Two corrections the pilot's metric needs at corpus scale, both measured, both
 * reported alongside the parity number rather than replacing it:
 *   1. `agreement_char` — the word tokenizer collapses space-less scripts (Han,
 *      Tibetan, kana, Thai…) into a handful of huge tokens, so one wrong glyph
 *      sinks a whole page. `agreement_primary` uses characters there, words
 *      elsewhere. See `revision-agreement-annotation-probe.mjs`.
 *   2. `image_only` — on covers, endpapers and plates neither side transcribes
 *      anything; both emit an AI-written <image-desc>, and two descriptions of
 *      one picture disagree by construction. Flagged, excluded from the
 *      regression queue, reported as its own stratum.
 *
 * Cost: free. Mongo reads + local compute only, no model API calls.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/revision-agreement-corpus.mjs [--limit=N] [--batch=500] [--out-dir=...]
 *
 * Long run — launch detached:
 *   nohup node scripts/eval/revision-agreement-corpus.mjs > /tmp/revagr.log 2>&1 &
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { stripWrappers, levenshtein } from './lib/metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const LIMIT = args.limit ? parseInt(args.limit) : 0;       // 0 = whole corpus
const BATCH = parseInt(args.batch || '500');               // page_ids per pages lookup
const DATE = new Date().toISOString().slice(0, 10);
const OUT_DIR = args['out-dir'] || path.join(__dirname, 'results');
const OUT_JSONL = path.join(OUT_DIR, `revision-agreement-corpus-${DATE}.jsonl`);
const OUT_SUMMARY = path.join(OUT_DIR, `revision-agreement-corpus-${DATE}.json`);
const OUT_REPORT = path.join(OUT_DIR, `revision-agreement-corpus-${DATE}.md`);
const OUT_REGRESSIONS = path.join(OUT_DIR, `revision-agreement-regressions-${DATE}.md`);
const TOP_REGRESSIONS = parseInt(args['top'] || '200');
// ── Pair eligibility (stated up front, counted, never post-hoc) ───
// A page's OCR text is only comparable if BOTH passes actually transcribed
// something. Two thresholds on body-word count (annotation excluded) split the
// population into three, each reported with its own n:
//   image_only  — max body < IMAGE_ONLY_MAX on both sides. Covers, endpapers,
//                 plates: both texts are AI descriptions of the same picture,
//                 so they disagree by construction with nothing transcribed.
//   micro_text  — max body < ELIGIBLE_MIN. Title pages, colophons, near-blanks.
//                 Real text, but the metric is unstable on a handful of words.
//   eligible    — the headline population.
const IMAGE_ONLY_MAX = parseInt(args['image-only-max'] || '15');
const ELIGIBLE_MIN = parseInt(args['eligible-min'] || '40');
const SITE = 'https://sourcelibrary.org';

// ── metric (parity with revision-agreement-pilot.mjs) ─────────────
const toWords = s => stripWrappers(s || '')
  .toLowerCase()
  .replace(/[^\p{L}\s]/gu, ' ')
  .split(/\s+/).filter(w => w.length > 1).slice(0, 800);
export function agreement(a, b) {
  const A = toWords(a), B = toWords(b);
  if (!A.length && !B.length) return null;
  if (!A.length || !B.length) return 0;
  const d = levenshtein(A, B);
  return 1 - d / Math.max(A.length, B.length);
}

// Character-level twin of the same metric. REQUIRED for space-less scripts:
// `toWords` splits on whitespace, so a page of Chinese or Tibetan collapses into
// a handful of enormous tokens (median 22/page for Chinese vs ~310 for Latin),
// and a single wrong character flips a whole token — measured on a 900-pair
// sample, word-agreement reads 27.5% on space-less scripts where character
// agreement reads 48.9% (Chinese 36.7% → 72.7%). On spaced scripts the two
// differ by ~4.5pt. `agreement` stays the pilot-parity primary; this is the
// honest number for CJK/Tibetan and is reported alongside everywhere.
const toChars = s => [...stripWrappers(s || '').toLowerCase().replace(/[^\p{L}]/gu, '')].slice(0, 3000);
export function agreementChar(a, b) {
  const A = toChars(a), B = toChars(b);
  if (!A.length && !B.length) return null;
  if (!A.length || !B.length) return 0;
  return 1 - levenshtein(A, B) / Math.max(A.length, B.length);
}

// Script class, detected from the text itself rather than books.language (which
// is the EDITION language and is wrong often enough to matter).
const SPACELESS_RE = /[\p{Script=Han}\p{Script=Tibetan}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}]/u;
const scriptClass = s => {
  const letters = (s || '').replace(/[^\p{L}]/gu, '');
  if (!letters) return 'unknown';
  let n = 0;
  for (const ch of letters.slice(0, 2000)) if (SPACELESS_RE.test(ch)) n++;
  return n / Math.min(letters.length, 2000) > 0.3 ? 'spaceless' : 'spaced';
};

// Body text = what survives after ALSO dropping <image-desc> prose and the
// CONTENT of inline marks. A page whose body is near-empty is a cover, endpaper
// or plate: its "text" is entirely an AI-written description, so two passes
// disagree completely while transcribing nothing. Those must not enter the
// regression audit queue as if OCR had lost text.
const INLINE_MARKS = 'note|term|margin|gloss|unclear|insert|header|catchword|sig|page-num';
const bodyWords = s => {
  let t = s || '';
  for (const w of `image-desc|${INLINE_MARKS}`.split('|')) {
    t = t.replace(new RegExp(`<${w}[^>]*>[\\s\\S]*?</${w}>`, 'gi'), '');
  }
  return stripWrappers(t).replace(/^#{1,6}\s.*$/gm, '')
    .replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1).length;
};

// Untagged AI refusals / conversational preambles (CLAUDE.md's third wrapper
// class). Not an exclusion — a refusal replacing a transcription is a genuine
// regression — but it is a distinct failure mode worth counting on its own.
const REFUSAL_RE = /\b(i (?:cannot|can't|am unable to|'m unable to)\b|i (?:apologize|'m sorry|am sorry)\b|as an ai\b|unable to (?:fulfill|process|transcribe)\b)/i;

// Marginalia is the hardest thing on the page for OCR to catch: small, rotated,
// in the gutter, often a different hand. Whether a re-run finds the SAME marginal
// notes is a sharper quality signal than bulk text agreement, which is dominated
// by the easy body block. Captured as counts per side plus agreement computed on
// the marginal text alone.
const MARGIN_RE = /<(margin|note)[^>]*>([\s\S]*?)<\/\1>/gi;
const marginalia = s => {
  const out = [];
  for (const m of (s || '').matchAll(MARGIN_RE)) {
    const t = m[2].replace(/<[^>]+>/g, ' ').trim();
    if (t) out.push(t);
  }
  return out;
};

// Where in the book the page sits. Front matter, plates and back matter (indexes,
// errata, ads) are typographically unlike the body block, so position is a real
// covariate and not just a proxy for page count.
// A NEGATIVE page_number is a deliberate soft-hide marker, not a bad value —
// |page_number| is the true page (verified: abs(pn) <= pages_count on every such
// row). Using the sign as-is would dump every soft-hidden page into 'unknown'.
const positionBucket = (pageNumber, pagesCount) => {
  if (!pagesCount || pagesCount < 10 || typeof pageNumber !== 'number' || pageNumber === 0) return 'unknown';
  const f = Math.abs(pageNumber) / pagesCount;
  if (f > 1) return 'unknown';
  if (f <= 0.05) return '1 front (0-5%)';
  if (f <= 0.25) return '2 early (5-25%)';
  if (f <= 0.75) return '3 middle (25-75%)';
  if (f <= 0.95) return '4 late (75-95%)';
  return '5 back (95-100%)';
};

// ── envelope tags ────────────────────────────────────────────────
const tag = (s, name) => {
  const m = (s || '').match(new RegExp(`<${name}>\\s*([^<]{0,40}?)\\s*</${name}>`, 'i'));
  return m ? m[1].trim().toLowerCase() || null : null;
};
const envelope = s => ({
  columns: tag(s, 'columns'),
  page_type: tag(s, 'page-type'),
  lang_tag: tag(s, 'lang') || tag(s, 'language'),
});

const yearBucket = y => {
  if (typeof y !== 'number' || !Number.isFinite(y)) return 'unknown';
  if (y < 1500) return 'pre-1500';
  if (y < 1600) return '1500-1599';
  if (y < 1700) return '1600-1699';
  if (y < 1800) return '1700-1799';
  if (y < 1900) return '1800-1899';
  return '1900+';
};

// ── streaming accumulators (never hold the rows in memory) ───────
class Stat {
  constructor() { this.n = 0; this.sum = 0; this.low = 0; this.high = 0; this.hist = new Array(BUCKETS.length - 1).fill(0); }
  add(x) {
    this.n++; this.sum += x;
    if (x < 0.5) this.low++;
    if (x >= 0.95) this.high++;
    for (let i = 0; i < BUCKETS.length - 1; i++) if (x >= BUCKETS[i] && x < BUCKETS[i + 1]) { this.hist[i]++; break; }
  }
  get mean() { return this.n ? this.sum / this.n : NaN; }
}
const BUCKETS = [0, 0.5, 0.7, 0.85, 0.95, 1.01];
const strata = {}; // name -> Map(key -> Stat)
const bump = (dim, key, x) => {
  if (!strata[dim]) strata[dim] = new Map();
  if (!strata[dim].has(key)) strata[dim].set(key, new Stat());
  strata[dim].get(key).add(x);
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const REVS = db.collection('page_revisions');
  const PAGES = db.collection('pages');
  const BOOKS = db.collection('books');

  const total = await REVS.countDocuments({ field: 'ocr' });
  console.log(`page_revisions field:'ocr' → ${total.toLocaleString()} revisions`);

  const out = fs.createWriteStream(OUT_JSONL, { flags: 'w' });
  const bookCache = new Map();
  const overall = new Stat();      // agreement_primary
  const overallWord = new Stat();  // pilot-parity word metric, for comparability
  const regressions = [];
  let revsRead = 0, pairs = 0, pagesSeen = 0, missingPage = 0, skipped = 0, refusals = 0;
  const flow = {}, margFate = {};
  const margStat = new Stat();   // agreement on marginal text alone
  const t0 = Date.now();

  // Sorted by page_id so a page's revisions arrive contiguously — served by the
  // {page_id:1, field:1, created_at:-1} index, no in-memory sort of 126K docs.
  const cursor = REVS.find(
    { field: 'ocr', data: { $type: 'string', $ne: '' } },
    { projection: { page_id: 1, book_id: 1, data: 1, model: 1, prompt_version: 1, source: 1, created_at: 1 } },
  ).sort({ page_id: 1, created_at: -1 }).batchSize(500);

  let batch = [];            // [{page_id, revs:[...]}] awaiting a pages lookup
  let cur = null;

  const flush = async () => {
    if (!batch.length) return;
    const ids = batch.map(b => b.page_id);
    const pageDocs = await PAGES.find(
      { id: { $in: ids } },
      { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.prompt_version': 1, 'ocr.language': 1 } },
    ).toArray();
    const pageById = new Map(pageDocs.map(p => [p.id, p]));

    // books: one $in per batch for the ids we have not cached
    const needBooks = [...new Set(batch.map(b => b.revs[0].book_id).filter(id => id && !bookCache.has(id)))];
    if (needBooks.length) {
      const bookDocs = await BOOKS.find(
        { $or: [{ _id: { $in: needBooks } }, { id: { $in: needBooks } }] },
        { projection: { id: 1, slug: 1, language: 1, year: 1, script: 1, text_role: 1, pages_count: 1 } },
      ).toArray();
      const found = new Set();
      for (const b of bookDocs) {
        for (const k of [String(b._id), b.id]) if (k && needBooks.includes(k)) { bookCache.set(k, b); found.add(k); }
      }
      for (const k of needBooks) if (!found.has(k)) bookCache.set(k, null);
    }

    for (const entry of batch) {
      pagesSeen++;
      // ~14% of revisions are orphans: the page doc is gone (book purged). Their
      // rev→rev chain is still a valid transition pair, so keep it — only the
      // final "→ live" step is unavailable.
      const pg = pageById.get(entry.page_id) || null;
      if (!pg) missingPage++;
      const bk = bookCache.get(entry.revs[0].book_id) || null;

      // chain: oldest prior → … → newest prior → live pages.ocr
      const chain = [...entry.revs].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
        .map(r => ({ data: r.data, model: r.model || null, prompt: r.prompt_version == null ? null : String(r.prompt_version), source: r.source || null, at: r.created_at || null, live: false }));
      if (pg?.ocr?.data) {
        chain.push({
          data: pg.ocr.data, model: pg.ocr.model || null,
          prompt: pg.ocr.prompt_version == null ? null : String(pg.ocr.prompt_version),
          source: 'live', at: null, live: true,
        });
      }
      if (chain.length < 2) { skipped++; continue; }

      for (let i = 0; i < chain.length - 1; i++) {
        const prior = chain[i], current = chain[i + 1];
        const agr = agreement(prior.data, current.data);
        if (agr == null) { skipped++; continue; }
        const agrChar = agreementChar(prior.data, current.data);
        const cls = scriptClass(current.data) === 'unknown' ? scriptClass(prior.data) : scriptClass(current.data);
        const bodyPrior = bodyWords(prior.data), bodyCurrent = bodyWords(current.data);
        const mp = marginalia(prior.data), mc = marginalia(current.data);
        const margAgr = (mp.length || mc.length)
          ? (cls === 'spaceless' ? agreementChar : agreement)(mp.join(' '), mc.join(' '))
          : null;
        const ep = envelope(prior.data), ec = envelope(current.data);
        const row = {
          page_id: entry.page_id,
          book_id: entry.revs[0].book_id,
          book_slug: bk?.slug || null,
          page_number: pg?.page_number ?? null,
          step: i,                       // 0 = oldest transition on this page
          is_live: current.live,         // current side is the text readers see
          language: bk?.language || null,
          year: typeof bk?.year === 'number' ? bk.year : null,
          year_bucket: yearBucket(bk?.year),
          text_role: bk?.text_role || null,
          prior_model: prior.model,
          current_model: current.model,
          model_pair: `${prior.model || '?'}→${current.model || '?'}`,
          prior_prompt: prior.prompt,
          current_prompt: current.prompt,
          prompt_transition: `${prior.prompt || '?'}→${current.prompt || '?'}`,
          prior_source: prior.source,
          agreement: +agr.toFixed(4),
          agreement_char: agrChar == null ? null : +agrChar.toFixed(4),
          // The number to trust per row: character-level on space-less scripts,
          // word-level (pilot parity) everywhere else.
          agreement_primary: +((cls === 'spaceless' && agrChar != null) ? agrChar : agr).toFixed(4),
          script_class: cls,
          body_words_prior: bodyPrior,
          body_words_current: bodyCurrent,
          // Cover / endpaper / plate: nothing was transcribed on either side, so
          // the "disagreement" is two AI descriptions of the same image.
          image_only: Math.max(bodyPrior, bodyCurrent) < IMAGE_ONLY_MAX,
          eligibility: Math.max(bodyPrior, bodyCurrent) < IMAGE_ONLY_MAX ? 'image_only'
            : Math.max(bodyPrior, bodyCurrent) < ELIGIBLE_MIN ? 'micro_text' : 'eligible',
          position_bucket: positionBucket(pg?.page_number, bk?.pages_count),
          pages_count: bk?.pages_count ?? null,
          soft_hidden: typeof pg?.page_number === 'number' && pg.page_number < 0,
          marginalia_prior: mp.length,
          marginalia_current: mc.length,
          marginalia_delta: mc.length - mp.length,
          // null when neither side marked any marginalia
          marginalia_agreement: margAgr == null ? null : +margAgr.toFixed(4),
          marginalia_fate: !mp.length && !mc.length ? 'none'
            : mp.length && !mc.length ? 'lost'
            : !mp.length && mc.length ? 'gained'
            : 'kept',
          prior_refusal: REFUSAL_RE.test(prior.data.slice(0, 400)),
          current_refusal: REFUSAL_RE.test(current.data.slice(0, 400)),
          len_prior: prior.data.length,
          len_current: current.data.length,
          len_ratio: +(current.data.length / Math.max(1, prior.data.length)).toFixed(3),
          prior_columns: ep.columns, current_columns: ec.columns,
          prior_page_type: ep.page_type, current_page_type: ec.page_type,
          prior_lang_tag: ep.lang_tag, current_lang_tag: ec.lang_tag,
          columns_changed: ep.columns !== ec.columns,
          page_type_changed: ep.page_type !== ec.page_type,
          lang_tag_changed: ep.lang_tag !== ec.lang_tag,
          prior_at: prior.at,
        };
        out.write(JSON.stringify(row) + '\n');
        pairs++;

        // Strata are keyed on agreement_primary (word-level except on space-less
        // scripts). overallWord keeps the pilot-parity headline comparable.
        const a = row.agreement_primary;
        flow[row.eligibility] = (flow[row.eligibility] || 0) + 1;
        bump('eligibility', row.eligibility, a);
        if (row.prior_refusal || row.current_refusal) refusals++;
        if (row.eligibility !== 'eligible') continue;  // pairs already counted
        overall.add(a);
        overallWord.add(row.agreement);
        bump('language', row.language || '(unknown)', a);
        bump('year_bucket', row.year_bucket, a);
        bump('model_pair', row.model_pair, a);
        bump('prompt_transition', row.prompt_transition, a);
        bump('script_class', row.script_class, a);
        bump('position_bucket', row.position_bucket, a);
        bump('soft_hidden', String(row.soft_hidden), a);
        bump('marginalia_fate', row.marginalia_fate, a);
        if (row.marginalia_agreement != null) margStat.add(row.marginalia_agreement);
        margFate[row.marginalia_fate] = (margFate[row.marginalia_fate] || 0) + 1;
        bump('image_only', String(row.image_only), a);
        bump('current_page_type', row.current_page_type || '(none)', a);
        bump('current_columns', row.current_columns || '(none)', a);
        bump('columns_changed', String(row.columns_changed), a);
        bump('page_type_changed', String(row.page_type_changed), a);
        bump('lang_tag_changed', String(row.lang_tag_changed), a);
        bump('is_live', String(row.is_live), a);
        bump('lang_x_year', `${row.language || '?'} | ${row.year_bucket}`, a);
        bump('lang_x_modelpair', `${row.language || '?'} | ${row.model_pair}`, a);

        // Regression candidate: low agreement AND current much shorter than
        // prior — the shape of "re-OCR made it worse". Severity ranks the audit
        // queue: how much text was lost, scaled by how little the texts agree.
        // image_only pages are excluded: on a cover or endpaper both sides are
        // AI descriptions of the same picture, so they disagree by construction
        // and nothing was transcribed to lose.
        if (a < 0.5 && row.len_ratio < 0.6) {
          regressions.push({
            ...row,
            severity: +((1 - a) * (1 - row.len_ratio) * Math.log10(10 + row.body_words_prior)).toFixed(4),
            url: row.book_slug ? `${SITE}/book/${row.book_slug}/page/${row.page_id}` : null,
          });
        }
      }
    }
    batch = [];
  };

  for await (const rv of cursor) {
    revsRead++;
    if (!cur || cur.page_id !== rv.page_id) {
      if (cur) batch.push(cur);
      cur = { page_id: rv.page_id, revs: [] };
      if (batch.length >= BATCH) await flush();
    }
    cur.revs.push(rv);
    if (revsRead % 10000 === 0) {
      const rate = revsRead / ((Date.now() - t0) / 1000);
      console.log(`  ${revsRead.toLocaleString()}/${total.toLocaleString()} revisions · ${pairs.toLocaleString()} pairs · ${rate.toFixed(0)}/s · mean agr ${(overall.mean * 100).toFixed(1)}%`);
    }
    if (LIMIT && revsRead >= LIMIT) break;
  }
  if (cur) batch.push(cur);
  await flush();
  await new Promise(r => out.end(r));
  await client.close();

  // ── summary ────────────────────────────────────────────────────
  regressions.sort((a, b) => b.severity - a.severity);
  const top = regressions.slice(0, TOP_REGRESSIONS);

  const strataOut = {};
  for (const [dim, m] of Object.entries(strata)) {
    strataOut[dim] = [...m.entries()]
      .map(([key, s]) => ({ key, n: s.n, mean_agreement: +s.mean.toFixed(4), pct_low: +(s.low / s.n).toFixed(4), pct_high: +(s.high / s.n).toFixed(4) }))
      .sort((a, b) => b.n - a.n);
  }

  const summary = {
    date: new Date().toISOString(),
    scope: LIMIT ? `first ${LIMIT} revisions (sorted by page_id)` : 'full page_revisions OCR corpus',
    revisions_read: revsRead,
    pages_seen: pagesSeen,
    pages_missing: missingPage,
    pairs_skipped: skipped,
    corpus_summary: {
      usable: pairs,
      missing: missingPage,
      eligibility_flow: flow,
      refusal_pairs: refusals,
      marginalia_fate: margFate,
      marginalia_mean_agreement: margStat.n ? +margStat.mean.toFixed(4) : null,
      marginalia_pairs_scored: margStat.n,
      eligible_pairs: overall.n,
      mean_agreement: +overall.mean.toFixed(4),
      mean_agreement_word_only: +overallWord.mean.toFixed(4),
      histogram: Object.fromEntries(overall.hist.map((h, i) => [`${BUCKETS[i]}-${Math.min(BUCKETS[i + 1], 1)}`, h])),
      regressions: regressions.length,
      regression_rate: +(regressions.length / Math.max(1, pairs)).toFixed(4),
    },
    strata: strataOut,
    rows_jsonl: path.relative(process.cwd(), OUT_JSONL),
    regressions_report: path.relative(process.cwd(), OUT_REGRESSIONS),
    elapsed_s: Math.round((Date.now() - t0) / 1000),
  };
  fs.writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 1));

  // ── stratified report ──────────────────────────────────────────
  const table = (dim, title, minN = 30) => {
    const rows = (strataOut[dim] || []).filter(r => r.n >= minN);
    if (!rows.length) return '';
    rows.sort((a, b) => a.mean_agreement - b.mean_agreement);
    return [`### ${title}`, '', '| stratum | n | mean agreement | % <0.5 | % ≥0.95 |', '|---|---:|---:|---:|---:|',
      ...rows.map(r => `| ${r.key} | ${r.n.toLocaleString()} | ${(r.mean_agreement * 100).toFixed(1)}% | ${(r.pct_low * 100).toFixed(1)}% | ${(r.pct_high * 100).toFixed(1)}% |`), ''].join('\n');
  };
  const md = [
    `# OCR revision agreement — full corpus (${DATE})`, '',
    `Corpus-scale extension of the agreement→accuracy calibration pilot (#3235).`,
    `Every consecutive rewrite transition in \`page_revisions\` (field \`ocr\`), plus the`,
    `final stored revision against the live \`pages.ocr\`. Metric: wrapper-stripped,`,
    `letters-only, word-level normalized Levenshtein similarity (cap 800 words) —`,
    `identical to \`revision-agreement-pilot.mjs\`. No model calls; Mongo reads only.`, '',
    '## Corpus summary', '',
    `- revisions read: **${revsRead.toLocaleString()}**`,
    `- pages with revisions: **${pagesSeen.toLocaleString()}** (${missingPage.toLocaleString()} live page docs not found — book purged; their rev→rev pairs are still included)`,
    `- computable pairs: **${pairs.toLocaleString()}** (${skipped.toLocaleString()} skipped: single-element chain or empty after stripping)`,
    '',
    '### Pair eligibility', '',
    'Stated before the analysis, not filtered after it. Body-word count excludes',
    'annotation (`<image-desc>`, inline marks, headings) — it is what was actually',
    '*transcribed*. Every computable pair lands in exactly one class:', '',
    '| class | criterion | n | share | mean agreement |',
    '|---|---|---:|---:|---:|',
    ...['eligible', 'micro_text', 'image_only'].filter(k => flow[k]).map(k => {
      const st = strata.eligibility?.get(k);
      const crit = k === 'eligible' ? `max body ≥ ${ELIGIBLE_MIN} words`
        : k === 'micro_text' ? `${IMAGE_ONLY_MAX}–${ELIGIBLE_MIN} words (title pages, colophons)`
        : `< ${IMAGE_ONLY_MAX} words on both sides (covers, plates)`;
      return `| ${k} | ${crit} | ${flow[k].toLocaleString()} | ${(flow[k] / pairs * 100).toFixed(1)}% | ${(st.mean * 100).toFixed(1)}% |`;
    }),
    '',
    `Only **eligible** pairs enter the headline, the strata and the regression queue.`,
    `\`image_only\` pairs disagree by construction: both sides are AI descriptions of the`,
    `same picture, so a low score there means two different sentences about one engraving,`,
    `not lost text. \`micro_text\` is real but the metric is unstable on a few dozen words.`,
    `Pairs where either side is an untagged AI refusal or preamble: **${refusals.toLocaleString()}** —`,
    `kept (a refusal replacing a transcription is a genuine regression), counted here.`, '',
    `**Eligible pairs: ${overall.n.toLocaleString()}.**`,
    `- mean agreement (primary — char-level on space-less scripts, word-level elsewhere): **${(overall.mean * 100).toFixed(1)}%**`,
    `- mean agreement, pilot-parity word metric on every script: ${(overallWord.mean * 100).toFixed(1)}% — the gap is the CJK/Tibetan tokenization artifact`,
    `- agreement distribution: ` + overall.hist.map((h, i) => `[${BUCKETS[i]}–${Math.min(BUCKETS[i + 1], 1)}) ${(h / pairs * 100).toFixed(1)}%`).join(' · '),
    `- regression candidates (agreement<0.5 AND current <60% of prior length): **${regressions.length.toLocaleString()}** (${(regressions.length / Math.max(1, overall.n) * 100).toFixed(2)}% of eligible)`, '',
    '## Stratified agreement', '',
    table('position_bucket', 'By position in the book', 1),
    table('soft_hidden', 'Soft-hidden pages (negative page_number)', 1),
    table('script_class', 'By script class (space-less scripts need the char metric)', 1),
    table('image_only', 'Image-only pages (no transcribed body text on either side)', 1),
    table('language', 'By language'),
    table('year_bucket', 'By year bucket'),
    table('model_pair', 'By model pair (prior → current)'),
    table('prompt_transition', 'By prompt-version transition'),
    table('lang_x_year', 'By language × year bucket', 100),
    table('lang_x_modelpair', 'By language × model pair', 100),
    '## Marginalia', '',
    'Marginal notes are the hardest marks on the page: small, rotated, in the gutter,',
    'often a different hand. Whether a re-run recovers the SAME notes is a sharper',
    'quality signal than bulk agreement, which the easy body block dominates.', '',
    `- pairs where at least one side marked marginalia: **${margStat.n.toLocaleString()}**`,
    `- mean agreement on the marginal text alone: **${margStat.n ? (margStat.mean * 100).toFixed(1) + '%' : 'n/a'}**` +
      `${margStat.n ? ` (vs ${(overall.mean * 100).toFixed(1)}% on the full page)` : ''}`,
    `- fate across the revision: ` + ['kept', 'lost', 'gained', 'none'].filter(k => margFate[k])
      .map(k => `${k} ${margFate[k].toLocaleString()}`).join(' · '),
    '',
    '`lost` = the prior pass marked marginalia and the re-run marked none. Those are',
    'the pages where a re-OCR quietly dropped the annotation layer.', '',
    table('marginalia_fate', 'Full-page agreement by marginalia fate', 1),
    '## Envelope-tag covariates', '',
    'The OCR envelope (`<columns>`, `<page-type>`, `<lang>`) is metadata the model writes',
    'about the scan. A transition that *changes* one of these is a disagreement about what',
    'the page even is — which should predict low text agreement.', '',
    table('current_page_type', 'By current `<page-type>`'),
    table('current_columns', 'By current `<columns>`'),
    table('columns_changed', '`<columns>` changed across the revision', 1),
    table('page_type_changed', '`<page-type>` changed across the revision', 1),
    table('lang_tag_changed', '`<lang>` changed across the revision', 1),
    table('is_live', 'Current side is the live `pages.ocr` (vs an intermediate revision)', 1),
    `## Regression candidates`, '',
    `Top ${top.length} by severity → \`${path.basename(OUT_REGRESSIONS)}\` (reviewable list with page URLs).`, '',
    `Rows: \`${path.basename(OUT_JSONL)}\` · summary: \`${path.basename(OUT_SUMMARY)}\``, '',
  ].filter(Boolean).join('\n');
  fs.writeFileSync(OUT_REPORT, md);

  const regMd = [
    `# OCR re-run regression candidates — top ${top.length} (${DATE})`, '',
    `Pairs where the re-OCR **disagrees** with what it replaced (agreement < 0.5) **and**`,
    `lost most of the text (current < 60% of prior length). This is the shape of "re-OCR`,
    `made it worse". Image-only pages (covers, plates — no transcribed body text on either`,
    `side) are excluded: there both texts are AI descriptions of the same picture, so they`,
    `disagree by construction with nothing lost. ${regressions.length.toLocaleString()} candidates total; ranked by`,
    `severity = (1 − agreement) × (1 − length ratio) × log10(10 + prior body words).`, '',
    `Visual audit: open each URL, compare the rendered page image against the text.`,
    `A confirmed regression means the *prior* revision should be restored.`, '',
    '| # | severity | agr | body words prior→current | len prior→current | lang | year | model pair | prompt | page |',
    '|---:|---:|---:|---|---|---|---:|---|---|---|',
    ...top.map((r, i) => `| ${i + 1} | ${r.severity.toFixed(2)} | ${(r.agreement_primary * 100).toFixed(0)}% | ${r.body_words_prior}→${r.body_words_current} | ${r.len_prior}→${r.len_current} (${(r.len_ratio * 100).toFixed(0)}%) | ${r.language || '?'} | ${r.year ?? '?'} | ${r.model_pair} | ${r.prompt_transition} | ${r.url ? `[p${r.page_number ?? '?'}](${r.url})` : `\`${r.page_id}\``} |`),
    '',
  ].join('\n');
  fs.writeFileSync(OUT_REGRESSIONS, regMd);

  console.log(`\n${md.split('## Stratified')[0]}`);
  console.log(`Saved → ${OUT_JSONL}\n        ${OUT_SUMMARY}\n        ${OUT_REPORT}\n        ${OUT_REGRESSIONS}`);
}

main().catch(e => { console.error(e); process.exit(1); });
