#!/usr/bin/env node
// PRIOR ART: scripts/lib/ocr-garble-score.mjs (#5313): garbleBody, tokensOf, unitsOf, garbleFeatures (dictionary miss
// rate, no-vowel, mixed-script, fragment, filler, repeat, loop) and scriptOfCodePoint: imported. Its lexicon comes from
// scripts/audit/ocr-garble-lexicon.mjs over the jsonl mirror, which this box does not hold (the mirror here is parquet),
// so makeLexicon() is fed from the label books' own sample pages (floor 3 books). scripts/eval/confidence-7866/lib.mjs
// routeOf / routerLookup (the served route and its router posterior): imported. Nothing computes these per book.
/**
 * Families T, M and R (page_revisions) of #7263 book-grade-model, for every judged page and 20 other pages of each label
 * book (seed 72634; each as it stood at the book's first judged_at). Read-only on Mongo; paced one book at a time.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/book-grade-7263/features.mjs fetch
 *   node scripts/eval/book-grade-7263/features.mjs build      → OUT/feat-pages.json.gz, OUT/feat-books.json.gz
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { MongoClient, ObjectId } from 'mongodb';
import { garbleBody, tokensOf, unitsOf, garbleFeatures, scriptOfCodePoint, familyOf, makeLexicon } from '../../lib/ocr-garble-score.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { routeOf, routerLookup, scriptOf } from '../confidence-7866/lib.mjs';
import { OUT, SEED, J, W, words, unitOf } from './lib.mjs';

const SAMPLE = 20;
const REREAD_SOURCES = ['batch_api', 'ai', 'pipeline_preview'];

/* ── fetch: the book sample pages, revisions and metadata (Mongo) ── */

async function fetchAll() {
  const { rows } = J('labels.json.gz');
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db('bookstore');
  const books = [...new Set(rows.map((r) => r.book_id))].sort();
  const out = { fetched_at: new Date().toISOString(), books: {} };
  const rng = makeRng(SEED.bookSample);
  for (const [i, b] of books.entries()) {
    const mine = rows.filter((r) => r.book_id === b);
    const judgedAt = new Date(mine.map((r) => r.judged_at).sort()[0]);
    const judgedIds = new Set(mine.map((r) => r.page_id));
    const book = await db.collection('books').findOne({ _id: new ObjectId(b) }, { projection: { language: 1, published: 1, year: 1, image_source: 1, ia_identifier: 1, pages_count: 1, created_at: 1 } });
    const all = await db.collection('pages').find({ book_id: b, 'ocr.data': { $type: 'string' }, hidden: { $ne: true }, split_into: { $exists: false } }, { projection: { _id: 1, page_number: 1 } }).sort({ page_number: 1 }).toArray();
    const pool = all.filter((p) => !judgedIds.has(String(p._id)));
    for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
    const pick = pool.slice(0, SAMPLE).map((p) => p._id);
    const sp = await db.collection('pages').find({ _id: { $in: pick } }, { projection: { page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.pipeline': 1, 'ocr.source': 1, page_type: 1 } }).toArray();
    const judgedPages = await db.collection('pages').find({ _id: { $in: [...judgedIds].map((x) => new ObjectId(x)) } }, { projection: { page_number: 1, 'ocr.model': 1, 'ocr.pipeline': 1, 'ocr.source': 1, page_type: 1 } }).toArray();
    const ids = [...pick.map(String), ...judgedIds];
    const revs = await db.collection('page_revisions').find({ page_id: { $in: [...ids, ...ids.map((x) => new ObjectId(x))] }, field: 'ocr' }, { projection: { page_id: 1, data: 1, source: 1, model: 1, created_at: 1, original_date: 1 } }).toArray();
    const revsBy = {};
    for (const r of revs) (revsBy[String(r.page_id)] ??= []).push({ data: r.data, source: r.source, model: r.model, created_at: r.created_at, original_date: r.original_date });
    // A sample page's text as it stood at judged_at: the first revision superseded after judged_at holds it.
    const sample = sp.map((p) => {
      const later = (revsBy[String(p._id)] ?? []).filter((r) => r.created_at && new Date(r.created_at) > judgedAt).sort((a, b2) => new Date(a.created_at) - new Date(b2.created_at));
      return { page_id: String(p._id), page_number: p.page_number, text: later.length ? later[0].data : p.ocr.data, rewritten_after_judging: later.length > 0, model: later.length ? later[0].model : p.ocr.model, pipeline: p.ocr.pipeline ?? null, source: p.ocr.source ?? null, page_type: p.page_type ?? null };
    });
    // Only re-read rows written before judging enter family R.
    const before = Object.fromEntries(Object.entries(revsBy).map(([k, v]) => [k, v.filter((r) => r.created_at && new Date(r.created_at) < judgedAt && REREAD_SOURCES.includes(r.source))]));
    out.books[b] = { judged_at: judgedAt.toISOString(), book: { language: book?.language, published: book?.published, year: book?.year, provider: book?.image_source?.provider ?? (book?.ia_identifier ? 'internet_archive' : null), pages_count: book?.pages_count, ocr_pages: all.length },
      judged_stamps: Object.fromEntries(judgedPages.map((p) => [String(p._id), { model: p.ocr?.model ?? null, pipeline: p.ocr?.pipeline ?? null, source: p.ocr?.source ?? null, page_type: p.page_type ?? null }])),
      sample, rereads: before };
    if (i % 20 === 0) console.log(`${i + 1}/${books.length} ${b}: ${sample.length} sample pages, ${revs.length} revisions`);
    await new Promise((r) => setTimeout(r, 150));
  }
  await c.close();
  W('fetch.json.gz', out);
}

/* ── text features ── */

const TAG = /<\/?([a-zA-Z][\w-]*)[^>]*>/g;
const CHATTER = /\b(I cannot|I can't|I'm sorry|I am unable|Here is the transcription|Here's the transcription)\b|<<<BEGIN|<<<END/i;
const SQ = { good: 0, fair: 1, poor: 2 };

function families(text) {
  const n = {};
  for (const ch of garbleBody(text)) { const s = scriptOfCodePoint(ch.codePointAt(0)); if (s) { const f = familyOf(s); n[f] = (n[f] ?? 0) + 1; } }
  return n;
}
const dice = (a, b) => {
  const A = new Map(), B = new Map();
  for (const t of a) A.set(t, (A.get(t) ?? 0) + 1);
  for (const t of b) B.set(t, (B.get(t) ?? 0) + 1);
  let inter = 0; for (const [t, k] of A) inter += Math.min(k, B.get(t) ?? 0);
  return a.length + b.length ? (2 * inter) / (a.length + b.length) : 1;
};
const toks = (t) => tokensOf(garbleBody(t)).flatMap(({ t: x, s }) => (s === 'CJK' ? Array.from(x) : [x]));

/** Character trigram counts of a text (content only). */
function trigrams(text) {
  const s = ` ${garbleBody(text).replace(/\s+/g, ' ').trim()} `;
  const cps = Array.from(s), m = new Map();
  for (let i = 0; i + 2 < cps.length; i++) { const g = cps[i] + cps[i + 1] + cps[i + 2]; m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
}

export function textFeatures(text, lang, bookFamilies, lexicon) {
  const raw = String(text ?? '');
  const body = garbleBody(raw);
  const plain = body.replace(/\s+/g, ' ').trim();
  const units = words(raw, lang);
  const per100 = (x) => (units > 0 ? (100 * x) / units : 0);
  const tags = [...raw.matchAll(TAG)];
  const tagChars = [...raw.matchAll(/<([a-zA-Z][\w-]*)[^>]*>[\s\S]*?<\/\1>/g)].reduce((a, m) => a + m[0].length, 0);
  const lines = raw.replace(/<[^>]+>/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const lineCounts = new Map(); for (const l of lines) lineCounts.set(l, (lineCounts.get(l) ?? 0) + 1);
  let run = 1, maxRun = lines.length ? 1 : 0; for (let i = 1; i < lines.length; i++) { run = lines[i] === lines[i - 1] ? run + 1 : 1; maxRun = Math.max(maxRun, run); }
  const tk = tokensOf(body);
  const lens = tk.map(({ t }) => Array.from(t).length);
  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const sd = lens.length ? Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length) : 0;
  const tc = new Map(); for (const { t } of tk) tc.set(t, (tc.get(t) ?? 0) + 1);
  const fam = families(raw); const famTot = Object.values(fam).reduce((a, b) => a + b, 0);
  const outside = famTot ? Object.entries(fam).filter(([f]) => !bookFamilies.has(f)).reduce((a, [, k]) => a + k, 0) / famTot : 0;
  const g = garbleFeatures(raw, { lexicon, language: lang });
  const sq = raw.match(/<scan-quality>\s*(\w+)/i)?.[1]?.toLowerCase();
  const ptype = raw.match(/<page-type>\s*([a-z-]+)/i)?.[1]?.toLowerCase() ?? 'none';
  const bytes = Buffer.byteLength(plain);
  return {
    units, log_units: Math.log1p(units), chars: plain.length,
    unclear_per100: per100((raw.match(/<unclear/gi) || []).length),
    tags_per100: per100(tags.length), tag_char_share: raw.length ? tagChars / raw.length : 0, tag_names: new Set(tags.map((m) => m[1].toLowerCase())).size,
    dup_line_share: lines.length ? 1 - lineCounts.size / lines.length : 0, max_line_run: maxRun,
    zlib_ratio: bytes > 50 ? zlib.deflateSync(plain).length / bytes : 1,
    top_token_share: tk.length ? Math.max(...tc.values()) / tk.length : 0,
    outside_script: outside,
    oov: g.oov, no_vowel: g.no_vowel, mixed_tok: g.mixed, fragment: g.fragment, filler: g.filler, repeat5: g.repeat, loop: g.loop,
    tok_len_mean: mean, tok_len_sd: sd, tok_len1: lens.length ? lens.filter((x) => x === 1).length / lens.length : 0, tok_len16: lens.length ? lens.filter((x) => x >= 16).length / lens.length : 0,
    hyphen_eol: lines.length ? lines.filter((l) => /[-‐¬⸗=]$/.test(l)).length / lines.length : 0,
    line_len_mean: lines.length ? lines.reduce((a, l) => a + l.length, 0) / lines.length : 0, line_count: lines.length,
    sq_tag: sq in SQ ? SQ[sq] : -1, sq_poor: sq === 'poor' ? 1 : 0, chatter: CHATTER.test(raw.slice(0, 400)) ? 1 : 0,
    near_empty: plain.length < 120 ? 1 : 0, ptype_text: ptype === 'text' || ptype === 'none' ? 1 : 0,
  };
}

/* ── build ── */

function build() {
  const { rows } = J('labels.json.gz');
  const F = J('fetch.json.gz');
  const router = routerLookup();
  // Pages of each book: judged (as judged) + sample (as at judged_at).
  const pagesOf = {};
  for (const r of rows) (pagesOf[r.book_id] ??= []).push({ page_id: r.page_id, kind: 'judged', text: r.text, lang: r.lang });
  for (const [b, x] of Object.entries(F.books)) for (const s of x.sample) pagesOf[b].push({ page_id: s.page_id, kind: 'sample', text: s.text, lang: pagesOf[b][0].lang, rewritten: s.rewritten_after_judging });
  // Lexicon (floor 3 books) and per-language trigram counts from every label book's pages.
  const lexRows = {}, tri = {}, triBook = {};
  for (const [b, ps] of Object.entries(pagesOf)) {
    const seen = new Map(), tc = new Map();
    for (const p of ps) {
      for (const [k, u] of unitsOf(tokensOf(garbleBody(p.text)))) { const id = `${k}\t${u}`; seen.set(id, (seen.get(id) ?? 0) + 1); }
      for (const [gq, n] of trigrams(p.text)) tc.set(gq, (tc.get(gq) ?? 0) + n);
    }
    for (const [id, n] of seen) { const [k, u] = id.split('\t'); const e = ((lexRows[k] ??= new Map()).get(u)) ?? [u, 0, 0]; e[1]++; e[2] += n; lexRows[k].set(u, e); }
    const L = ps[0].lang; tri[L] ??= new Map(); triBook[b] = tc;
    for (const [gq, n] of tc) tri[L].set(gq, (tri[L].get(gq) ?? 0) + n);
  }
  const lexicon = makeLexicon(Object.fromEntries(Object.entries(lexRows).map(([k, m]) => [k, [...m.values()]])), { minBooks: 3 });
  // Bigram contexts per language, for the trigram model's denominators.
  const ctx = {}; for (const [L, m] of Object.entries(tri)) { const c = new Map(); for (const [g, n] of m) c.set(g.slice(0, -1), (c.get(g.slice(0, -1)) ?? 0) + n); ctx[L] = c; }
  const ctxBook = {}; for (const [b, m] of Object.entries(triBook)) { const c = new Map(); for (const [g, n] of m) c.set(g.slice(0, -1), (c.get(g.slice(0, -1)) ?? 0) + n); ctxBook[b] = c; }
  const xent = (text, L, b) => {
    const own = triBook[b], ownC = ctxBook[b]; const T = tri[L], C = ctx[L]; const V = 4000;
    const s = ` ${garbleBody(text).replace(/\s+/g, ' ').trim()} `; const cps = Array.from(s);
    let H = 0, n = 0;
    for (let i = 0; i + 2 < cps.length; i++) {
      const g = cps[i] + cps[i + 1] + cps[i + 2], h = g.slice(0, -1);
      const ng = (T.get(g) ?? 0) - (own.get(g) ?? 0);
      const nh = (C.get(h) ?? 0) - (ownC.get(h) ?? 0);
      H += -Math.log2((ng + 0.1) / (nh + 0.1 * V)); n++;
    }
    return n ? H / n : null;
  };
  const pageFeats = [];
  for (const [b, ps] of Object.entries(pagesOf)) {
    const fam = {}; for (const p of ps) for (const [f, k] of Object.entries(families(p.text))) fam[f] = (fam[f] ?? 0) + k;
    const tot = Object.values(fam).reduce((a, k) => a + k, 0);
    const bookFam = new Set(Object.entries(fam).filter(([, k]) => k / tot >= 0.1).map(([f]) => f));
    const rr = F.books[b].rereads;
    for (const p of ps) {
      const f = textFeatures(p.text, p.lang, bookFam, lexicon);
      f.trigram_xent = xent(p.text, p.lang, b);
      // R from page_revisions: the latest re-read row before judging; a word-Dice under 0.2 is a leaf shift, dropped.
      const mine = toks(p.text);
      const rs = (rr[p.page_id] ?? []).map((r) => ({ ...r, d: dice(toks(r.data), mine) }));
      const kept = rs.filter((r) => r.d >= 0.2).sort((a, c) => new Date(c.created_at) - new Date(a.created_at));
      const stamp = p.kind === 'judged' ? F.books[b].judged_stamps[p.page_id] : F.books[b].sample.find((s) => s.page_id === p.page_id);
      f.rev_n = kept.length; f.rev_leafshift = rs.length - kept.length;
      f.rev_dis = kept.length ? 1 - kept[0].d : null;
      f.rev_dis_same_model = kept.find((r) => r.model && r.model === stamp?.model) ? 1 - kept.find((r) => r.model === stamp?.model).d : null;
      pageFeats.push({ book_id: b, page_id: p.page_id, kind: p.kind, ...f });
    }
  }
  // Metadata per book.
  const bookMeta = {};
  for (const [b, x] of Object.entries(F.books)) {
    const mine = rows.filter((r) => r.book_id === b);
    const lang = mine[0].lang;
    const routes = mine.map((r) => {
      if (r.study === '7866') { const [base, script] = String(r.cell ?? 'null/unknown').split('/'); return { base: base === 'null' ? null : base, script: script ?? 'unknown', route: r.route }; }
      const st = x.judged_stamps[r.page_id] ?? {}; const ro = routeOf({ model: st.model, pipeline: st.pipeline, source: st.source }, lang);
      return { ...ro, script: r.script === 'printed' ? 'print' : r.script === 'handwritten' ? 'manuscript' : (r.script ?? 'unknown') };
    });
    const top = Object.entries(routes.reduce((a, r) => ((a[`${r.base}|${r.script}|${r.route}`] = (a[`${r.base}|${r.script}|${r.route}`] ?? 0) + 1), a), {})).sort((a, c) => c[1] - a[1])[0][0].split('|');
    const look = router.get(top[0] === 'null' ? null : top[0], top[1], top[2]);
    const y = Number(String(x.book.year ?? x.book.published ?? '').match(/\d{4}/)?.[0]) || null;
    const model = Object.values(x.judged_stamps)[0]?.model ?? null;
    bookMeta[b] = { book_id: b, lang, unit: unitOf(lang), script: ['print', 'manuscript'].includes(mine[0].script) ? mine[0].script : scriptOf(mine[0].script),
      route: top[2], engine: String(model ?? 'none').replace(/-preview$/, ''), year: y, provider: x.book.provider ?? 'unknown', pages_count: x.book.pages_count ?? null,
      p_route: look.measured ? look.mean : null, route_measured: look.measured ? 1 : 0, route_wt_per1k: look.wrong_text_per_1k ?? null, router_table: router.name,
      sample_rewritten_after_judging: x.sample.filter((s) => s.rewritten_after_judging).length };
  }
  W('feat-pages.json.gz', pageFeats);
  W('feat-books.json.gz', bookMeta);
  console.log(`${pageFeats.length} page feature rows (${pageFeats.filter((p) => p.kind === 'judged').length} judged), ${Object.keys(bookMeta).length} books; router table ${router.name}`);
}

if (process.argv[2] === 'fetch') await fetchAll();
if (process.argv[2] === 'build') build();
