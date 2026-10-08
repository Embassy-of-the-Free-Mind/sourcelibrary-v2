#!/usr/bin/env node
/**
 * Translation recitation pilot (#5523): how often does a served English page reproduce a
 * published English translation verbatim, instead of translating the page?
 *
 * PRIOR ART: `scripts/eval/syriac-vs-published*` / the OCR memorisation paper
 * (`.claude/docs/ocr-memorization-paper.md`) measure recitation in OCR, not translation;
 * `lib/metrics.mjs greedySpanStats` aligns a transcription to its own reference, it does not
 * search a whole book for the best passage or count verbatim word runs; the translation
 * corpus audit (#5274) is a judged fidelity rate with no published reference. None compares
 * served English to a published English translation. Reused: `lib/paired-stats.mjs`
 * (`makeRng`, `bootstrapCI`, `diffCI`), `lib/sampling.mjs` (`connect`).
 *
 * measure: agreement (served English vs a PUBLISHED English translation). Never quality.
 * Cost: $0 — string overlap only, no model call. Mongo is read-only.
 *
 * Label: the "Did the AI Read This?" membership posteriors are not stored per book (not in
 * the repo, not in Mongo), so the known/unknown label is the bibliographic disposition
 * (`translation_verification.disposition`): `translation_found` + a public-domain English
 * e-text on Project Gutenberg (treatment) vs `confirmed_first` (control, matched on language
 * and date). Public-domain texts only; they are cached outside the repo and never committed.
 *
 * Usage:
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/translation-recitation.mjs \
 *     [--seed 5523] [--out scripts/eval/results/translation-recitation-5523-<date>] [--cache /tmp/rec/pg]
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { connect, disconnect } from './lib/sampling.mjs';
import { makeRng, bootstrapCI, diffCI, resetSeed } from './lib/paired-stats.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(arg('--seed', 5523));
const DATE = new Date().toISOString().slice(0, 10);
const OUT = arg('--out', `scripts/eval/results/translation-recitation-5523-${DATE}`);
const CACHE = arg('--cache', '/tmp/rec/pg');
const RUN_ID = `translation-recitation-5523-${DATE}`;
const RUN_THRESHOLD = 12; // a verbatim run of >= 12 words is the issue's recitation line

// A 4th element is a SECOND, independent PD translation of the same work: the human-vs-human
// baseline (how long a verbatim run do two human translators of one passage share?).
// Treatment: works whose library edition is `translation_found` AND whose public-domain
// English translation is on Project Gutenberg. One library book per work, chosen by hand
// before any page was drawn (printed editions preferred; bilingual editions with an English
// facing page — Loeb, "Italian-English" — excluded, since there the English is ON the leaf).
const TREATMENT = [
  ['69af4723b8e08960c7fbbf42', 'Boethius, Consolatio', [14328]],
  ['69937727b0a84a5763962fe7', 'Aristotle, Nicomachean Ethics', [8438]],
  ['6954343f1479a63c11088b5b', 'Spinoza, Ethica', [3800]],
  ['69b21d57b74d4e5ea24c3c60', 'Spinoza, Tractatus theologico-politicus', [989, 990, 991, 992]],
  ['6953e50577f38f6761bef758', 'Bacon, Novum organum', [45988]],
  ['69b2ff19a1a4246ddb45ae6a', 'Erasmus, Moriae encomium', [9371]],
  ['6953ce5f77f38f6761be37be', 'Epictetus, Discourses I–II', [10661]],
  ['6953e46f77f38f6761bee559', 'Galileo, Sidereus nuncius', [46036]],
  ['69b30116e5d6d64d8e19a7ba', 'Hesiod, Works and Days / Theogony', [348]],
  ['699376f4b0a84a576396231b', 'Herodotus, Histories', [2707, 2456]],
  ['69b2230956715b0e32476067', 'Boccaccio, Decameron', [23700], [3726, 13102]],
  ['69b2212608069e96e842ec85', 'Dante, Commedia', [1004], [1995, 1996, 1997]],
  ['69aea59e57ed98c21d25a62a', 'Machiavelli, Il Principe', [1232], [57037]],
  ['69aebfa1c337b1e6a4d58005', 'Machiavelli, Discorsi', [10827]],
  ['6991e7bdc91ce7d733e4fa95', 'Machiavelli, Istorie fiorentine', [2464]],
  ['69af21d07c27d4b637feddd1', 'Apuleius, Metamorphoses', [1666]],
  ['69af217f7c27d4b637fed9e0', 'Apuleius, Apologia', [26294]],
  ['6956952b8c9559f6c2db06a3', 'Marcus Aurelius, Meditations', [15877], [2680]],
  ['69afd11bed3c9bd9e1a87ea1', 'Lucretius, De rerum natura', [785]],
  ['69aea40c9d2eb853bde35834', 'Rousseau, Contrat social', [46333]],
  ['6952e4c677f38f6761bc882d', 'Vulgate (Sixto-Clementine)', [1581]],
  ['69b2f3bfa9a500a45e5e857c', 'Calvin, Institutio', [45001, 64392]],
  ['69b3010ee28f56bd749437d6', 'Caesar, Commentarii', [10657]],
  ['69937767b0a84a57639639fe', 'Plato, Phaedo', [1658], [13726]],
  ['69937706b0a84a57639627bb', 'Plato, Republic', [1497]],
  ['6953ce9877f38f6761be55c7', 'Plato, Laches / Protagoras / Meno / Euthydemus', [1584, 1591, 1643, 1598]],
  ['6993777cb0a84a5763963d92', 'Plutarch, Parallel Lives', [674], [14033, 14114, 14140, 44315]],
  ['69b2214608069e96e842f2a2', 'Ovid, Metamorphoses', [21765, 26073]],
  ['69e792d880b52390feb16c4f', 'Lucian, True History (Latin)', [45858]],
  ['69b302c23613a84e68067a81', 'Thomas à Kempis, Imitatio Christi', [1653], [60377]],
  ['698255f1861f3361ae3249e0', 'Sendivogius, Novum lumen chymicum', [61112]],
  ['69af45f461b03be5fb7af39e', 'Vitruvius, De architectura', [20239]],
  ['6953e55177f38f6761bf0299', 'Harvey, De motu cordis', [58857, 67065]],
  ['69aebfa4c337b1e6a4d582f3', 'Castiglione, Cortegiano', [67799]],
  ['697a8670e680cef7cedae3aa', 'Maimonides, Doctor perplexorum (Latin)', [73584]],
  ['694a8046458d70b8c6439c5f', 'Diogenes Laertius, Vitae (Latin)', [57342]],
];

const STOP = new Set('the and that this with from have which they their them there were what when will would shall should unto upon into than then also been being such more most other some these those very only every each your yours thou thee thine thy hath doth said says made make many much must over under after before about against because though through where while whom whose whereas therefore thus even itself himself herself themselves ourselves'.split(' '));

// ── text ──────────────────────────────────────────────────────────────

/** The served English body: notes, meta, image descriptions and markup removed. */
export function servedBody(t) {
  return String(t || '')
    .replace(/<(note|meta|image-desc|page-type|header|footer|page-num|sig)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/->[^<]*<-/g, ' ')
    .replace(/[#*_>|`]/g, ' ');
}

export function tokens(t) {
  return String(t || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[‘’ʼ]/g, "'")
    .match(/[a-z0-9]+(?:'[a-z]+)?/g) || [];
}

function stripGutenberg(raw) {
  const s = raw.search(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/i);
  const e = raw.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG/i);
  const body = raw.slice(s >= 0 ? raw.indexOf('\n', s) + 1 : 0, e > 0 ? e : raw.length);
  return body.replace(/\[Illustration[^\]]*\]/g, ' ');
}

async function fetchPg(id) {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, `pg${id}.txt`);
  if (!fs.existsSync(f)) {
    const urls = [`https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`, `https://www.gutenberg.org/files/${id}/${id}-0.txt`];
    let ok = false;
    for (const u of urls) {
      const r = await fetch(u);
      if (r.ok) { fs.writeFileSync(f, await r.text()); ok = true; break; }
    }
    if (!ok) return null;
    await new Promise((r) => setTimeout(r, 1500)); // be polite to gutenberg.org
  }
  const raw = fs.readFileSync(f, 'utf8');
  return { id, sha256: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16), text: stripGutenberg(raw) };
}

// ── instruments ───────────────────────────────────────────────────────

const K = 4; // index granularity: a run shorter than 4 words reads as "< 4"

/** Index a reference token array: 4-gram → positions (capped), and the set of 8-grams. */
export function indexRef(ref) {
  const k4 = new Map();
  for (let i = 0; i + K <= ref.length; i++) {
    const key = ref.slice(i, i + K).join(' ');
    const a = k4.get(key);
    if (!a) k4.set(key, [i]); else if (a.length < 400) a.push(i);
  }
  const g8 = new Set();
  for (let i = 0; i + 8 <= ref.length; i++) g8.add(ref.slice(i, i + 8).join(' '));
  return { ref, k4, g8 };
}

/** Longest verbatim word run shared by page and reference, with where it is. */
export function longestRun(page, idx) {
  let best = { len: 0, at: -1, refAt: -1 };
  for (let i = 0; i + K <= page.length; i++) {
    const ps = idx.k4.get(page.slice(i, i + K).join(' '));
    if (!ps) continue;
    for (const p of ps) {
      let L = K;
      while (i + L < page.length && p + L < idx.ref.length && page[i + L] === idx.ref[p + L]) L++;
      if (L > best.len) best = { len: L, at: i, refAt: p };
    }
  }
  return best;
}

/** Share of the page's 8-grams that occur anywhere in the reference. */
export function share8(page, g8) {
  let n = 0, hit = 0;
  for (let i = 0; i + 8 <= page.length; i++) { n++; if (g8.has(page.slice(i, i + 8).join(' '))) hit++; }
  return n ? hit / n : null;
}

/**
 * Locate the passage: the reference window that holds the most of the page's content words,
 * idf-weighted over the reference's own windows. Returns the window and its coverage
 * (weighted share of the page's content-word types found in it).
 */
export function locate(page, ref) {
  const content = [...new Set(page.filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)))];
  if (!content.length || !ref.length) return { start: 0, end: 0, coverage: 0 };
  const W = Math.max(150, Math.round(page.length * 1.5));
  const step = Math.max(10, Math.floor(W / 4));
  const windows = [];
  for (let s = 0; s < Math.max(1, ref.length - W + step); s += step) windows.push([s, Math.min(ref.length, s + W)]);
  const cset = new Set(content);
  const df = new Map();
  const present = windows.map(([s, e]) => {
    const seen = new Set();
    for (let i = s; i < e; i++) if (cset.has(ref[i])) seen.add(ref[i]);
    for (const w of seen) df.set(w, (df.get(w) || 0) + 1);
    return seen;
  });
  const idf = (w) => Math.log((windows.length + 1) / ((df.get(w) || 0) + 1)) + 1e-6;
  const total = content.reduce((s, w) => s + idf(w), 0);
  let best = { i: 0, score: -1 };
  present.forEach((seen, i) => { let sc = 0; for (const w of seen) sc += idf(w); if (sc > best.score) best = { i, score: sc }; });
  const [s, e] = windows[best.i];
  return { start: Math.max(0, s - Math.round(page.length / 2)), end: Math.min(ref.length, e + Math.round(page.length / 2)), coverage: best.score / total };
}

function scorePage(page, idx) {
  const run = longestRun(page, idx);
  const loc = locate(page, idx.ref);
  const win = idx.ref.slice(loc.start, loc.end);
  const winIdx = indexRef(win);
  return {
    words: page.length,
    run_whole: run.len, run_text: run.len ? page.slice(run.at, run.at + run.len).join(' ') : '',
    share8_whole: share8(page, idx.g8),
    coverage: Number(loc.coverage.toFixed(4)), loc_start: loc.start, loc_end: loc.end,
    run_located: longestRun(page, winIdx).len,
    share8_located: share8(page, winIdx.g8),
  };
}

// ── stats ─────────────────────────────────────────────────────────────

function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const r4 = (x) => (x == null ? null : Number(x.toFixed(4)));

function summarise(rows, key = 'run_whole') {
  const n = rows.length;
  const k = rows.filter((r) => r[key] >= RUN_THRESHOLD).length;
  const s8 = rows.map((r) => r.share8_whole);
  resetSeed(SEED);
  return {
    n_books: n,
    run_ge_12: { k, n, rate: r4(k / n), ci95_wilson: wilson(k, n)?.map(r4) },
    run_words: { median: median(rows.map((r) => r[key])), max: Math.max(...rows.map((r) => r[key])) },
    share8_whole: { mean: r4(s8.reduce((a, b) => a + b, 0) / n), ci95_boot: bootstrapCI(s8)?.map(r4), median: r4(median(s8)), max: r4(Math.max(...s8)) },
  };
}

// ── draw ──────────────────────────────────────────────────────────────

const yearOf = (p) => { const m = String(p || '').match(/\d{4}/); if (m) return +m[0]; const c = String(p || '').match(/(\d{1,2})(st|nd|rd|th) century/i); return c ? (+c[1] - 1) * 100 + 50 : null; };

/** One interior page (skip 15% front, 5% back), seeded, with a served English body of >= 120 words. */
async function drawPage(db, book, rng) {
  const pages = await db.collection('pages').find(
    { book_id: book.id, 'translation.data': { $exists: true, $ne: '' } },
    { projection: { page_number: 1, 'translation.data': 1, 'translation.model': 1, 'translation.prompt_version': 1, 'ocr.language': 1 } },
  ).toArray();
  if (!pages.length) return null;
  const maxP = Math.max(book.pages_count || 0, ...pages.map((p) => p.page_number));
  const lo = Math.floor(maxP * 0.15) + 1, hi = Math.ceil(maxP * 0.95);
  const pool = pages.filter((p) => p.page_number >= lo && p.page_number <= hi).sort((a, b) => a.page_number - b.page_number);
  // seeded shuffle, then the first page with a substantial body
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  for (const p of pool) {
    const body = servedBody(p.translation.data);
    if (tokens(body).length >= 120) return { page: p, body };
  }
  return null;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { db } = await connect();
  const rng = makeRng(SEED);
  const books = db.collection('books');
  const live = { visible: true, pages_count: { $gt: 0 } };

  // treatment
  const treatment = [];
  for (const [id, work, pg, alt] of TREATMENT) {
    const b = await books.findOne({ id, ...live }, { projection: { id: 1, title: 1, author: 1, language: 1, published: 1, pages_count: 1, 'translation_verification.disposition': 1 } });
    if (!b) { console.error('missing/not live', id); continue; }
    if (b.translation_verification?.disposition !== 'translation_found') { console.error('label drift', id, b.translation_verification?.disposition); continue; }
    treatment.push({ ...b, work, pg, alt: alt || null });
  }

  // control: confirmed_first, same language, nearest date; seeded tie-break among the 5 nearest
  const used = new Set(treatment.map((t) => t.id));
  const control = [];
  for (const t of treatment) {
    const ty = yearOf(t.published);
    const cands = await books.find({ ...live, language: t.language, 'translation_verification.disposition': 'confirmed_first', translation_pct: { $gte: 50 } },
      { projection: { id: 1, title: 1, author: 1, language: 1, published: 1, pages_count: 1 } }).toArray();
    const ranked = cands.filter((c) => !used.has(c.id) && yearOf(c.published) != null)
      .map((c) => ({ ...c, dy: Math.abs(yearOf(c.published) - (ty ?? 1600)) }))
      .sort((a, b) => a.dy - b.dy || (a.id < b.id ? -1 : 1));
    const pick = ranked.slice(0, 5);
    // try the 5 nearest in seeded order until one has a drawable page
    for (let i = pick.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pick[i], pick[j]] = [pick[j], pick[i]]; }
    let got = null;
    for (const c of pick) { const d = await drawPage(db, c, rng); if (d) { got = { ...c, matched_to: t.id, draw: d }; break; } }
    if (got) { used.add(got.id); control.push(got); } else console.error('no control for', t.id, t.language);
  }

  // pages + references
  const refs = new Map();
  const tRows = [];
  for (const t of treatment) {
    const d = await drawPage(db, t, rng);
    if (!d) { console.error('no page', t.id); continue; }
    const texts = [];
    for (const id of t.pg) { const r = await fetchPg(id); if (r) texts.push(r); else console.error('pg fetch failed', id); }
    if (!texts.length) continue;
    const refTok = tokens(texts.map((x) => x.text).join('\n'));
    const entry = { idx: indexRef(refTok), pg: texts.map((x) => ({ id: x.id, sha256: x.sha256 })), words: refTok.length };
    if (t.alt) {
      const alts = [];
      for (const id of t.alt) { const r = await fetchPg(id); if (r) alts.push(r); }
      if (alts.length) entry.alt = { idx: indexRef(tokens(alts.map((x) => x.text).join('\n'))), pg: alts.map((x) => ({ id: x.id, sha256: x.sha256 })) };
    }
    refs.set(t.id, entry);
    tRows.push({ t, d });
  }
  await disconnect();

  const meta = (b, d) => ({
    slug: `rec-${b.id.slice(-6)}-p${d.page.page_number}`, book_id: b.id, page_number: d.page.page_number,
    title: String(b.title || '').slice(0, 120), author: b.author || null, language: b.language, published: b.published,
    translation_model: d.page.translation?.model || null, prompt_version: d.page.translation?.prompt_version || null,
    served_sha256: crypto.createHash('sha256').update(d.page.translation.data).digest('hex').slice(0, 16),
  });

  // score: treatment vs its own published translation
  const treatRows = tRows.map(({ t, d }) => {
    const r = refs.get(t.id);
    return { ...meta(t, d), group: 'known', work: t.work, reference: { kind: 'human-translation', source: 'gutenberg', items: r.pg, words: r.words, licence: 'public-domain (US)' }, ...scorePage(tokens(d.body), r.idx) };
  });
  // control arm: each control page vs the published translation of its matched treatment work
  const ctrlRows = control.filter((c) => refs.has(c.matched_to)).map((c) => ({
    ...meta(c, c.draw), group: 'unknown', matched_to: c.matched_to, ...scorePage(tokens(c.draw.body), refs.get(c.matched_to).idx),
  }));
  const bodies = new Map(tRows.map(({ t, d }) => [t.id, d.body]));
  // chance control inside the treatment: each page vs ANOTHER work's translation (seeded derangement)
  const ids = treatRows.map((r) => r.book_id);
  const shift = 1 + Math.floor(rng() * (ids.length - 1));
  const mismatch = treatRows.map((r, i) => {
    const other = ids[(i + shift) % ids.length];
    return { slug: r.slug, against: other, ...scorePage(tokens(bodies.get(r.book_id)), refs.get(other).idx) };
  });
  // human-vs-human baseline: 8 page-sized (300-word) spans from the middle of translation A,
  // each scored against the whole of translation B, with the same instrument
  const human = [];
  const servedAlt = [];
  for (const r of treatRows) {
    const e = refs.get(r.book_id);
    if (!e.alt) continue;
    const A = e.idx.ref;
    for (let k = 0; k < 8; k++) {
      const s0 = Math.floor(A.length * 0.15 + rng() * (A.length * 0.75 - 300));
      const sc = scorePage(A.slice(s0, s0 + 300), e.alt.idx);
      human.push({ book_id: r.book_id, work: r.work, a: e.pg.map((x) => x.id), b: e.alt.pg.map((x) => x.id), span_at: s0, run_whole: sc.run_whole, share8_whole: r4(sc.share8_whole), run_text: sc.run_text.slice(0, 200) });
    }
    const sb = scorePage(tokens(bodies.get(r.book_id)), e.alt.idx);
    servedAlt.push({ slug: r.slug, work: r.work, run_vs_a: r.run_whole, run_vs_b: sb.run_whole, share8_vs_a: r4(r.share8_whole), share8_vs_b: r4(sb.share8_whole), b: e.alt.pg.map((x) => x.id) });
  }

  // positive controls on the instrument: a verbatim 250-word span of each reference, and the same
  // span with 10% of words substituted; the locator must land on the true span
  const pos = [];
  for (const [id, r] of refs) {
    const ref = r.idx.ref;
    if (ref.length < 2000) continue;
    const s = Math.floor(rng() * (ref.length - 600)) + 300;
    const span = ref.slice(s, s + 250);
    const noisy = span.map((w) => (rng() < 0.1 ? ref[Math.floor(rng() * ref.length)] : w));
    for (const [kind, toks] of [['verbatim', span], ['noise10', noisy]]) {
      const sc = scorePage(toks, r.idx);
      pos.push({ book_id: id, kind, run_whole: sc.run_whole, share8_whole: r4(sc.share8_whole), located: sc.loc_start <= s && sc.loc_end >= s + 250 });
    }
  }

  // write
  const strip = (r) => { const { run_text, ...rest } = r; return { ...rest, run_text: run_text.slice(0, 200) }; };
  const summary = {
    run_id: RUN_ID, issue: 5523, measure: 'agreement', against: 'published public-domain English translation (Project Gutenberg)',
    seed: SEED, cost_usd: 0, label: 'bibliographic disposition (translation_found + PD e-text vs confirmed_first); membership posteriors are not stored per book',
    recitation_line_words: RUN_THRESHOLD,
    known: summarise(treatRows), unknown_vs_matched_text: summarise(ctrlRows), known_vs_other_work: summarise(mismatch),
    known_located_only: null,
    diff_share8_known_minus_unknown: (() => { resetSeed(SEED); return diffCI(ctrlRows.map((r) => r.share8_whole), treatRows.map((r) => r.share8_whole)); })(),
    human_vs_human: { ...summarise(human), works: [...new Set(human.map((h) => h.work))], note: '8 x 300-word spans of translation A vs the whole of an independent PD translation B of the same work' },
    served_vs_second_translation: servedAlt,
    positive_controls: {
      verbatim: { n: pos.filter((p) => p.kind === 'verbatim').length, run_median: median(pos.filter((p) => p.kind === 'verbatim').map((p) => p.run_whole)), share8_median: median(pos.filter((p) => p.kind === 'verbatim').map((p) => p.share8_whole)), located: pos.filter((p) => p.kind === 'verbatim' && p.located).length },
      noise10: { n: pos.filter((p) => p.kind === 'noise10').length, run_median: median(pos.filter((p) => p.kind === 'noise10').map((p) => p.run_whole)), share8_median: median(pos.filter((p) => p.kind === 'noise10').map((p) => p.share8_whole)), located: pos.filter((p) => p.kind === 'noise10' && p.located).length },
    },
  };
  // "located" = coverage above the 95th percentile of the wrong-work control
  const covs = mismatch.map((m) => m.coverage).sort((a, b) => a - b);
  const covLine = covs[Math.floor(0.95 * (covs.length - 1))];
  summary.located_coverage_line = covLine;
  const located = treatRows.filter((r) => r.coverage > covLine);
  summary.known_located_only = { ...summarise(located), note: `pages whose best-window coverage exceeds the wrong-work p95 (${covLine})` };

  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'scores.jsonl'), [...treatRows, ...ctrlRows].map((r) => JSON.stringify(strip(r))).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'controls.jsonl'), [...mismatch.map((m) => ({ control: 'wrong-work', ...strip(m) })), ...pos.map((p) => ({ control: 'positive', ...p })), ...human.map((h) => ({ control: 'human-vs-human', ...h }))].map((r) => JSON.stringify(r)).join('\n') + '\n');
  // store (§5.2): one score row per page; the engine is the production translation model that wrote the page
  const storeDir = 'scripts/eval/store/scores/translation-recitation@1';
  fs.mkdirSync(storeDir, { recursive: true });
  const at = new Date().toISOString();
  const storeRows = [...treatRows, ...ctrlRows].map((r) => ({
    slug: r.slug, book_id: r.book_id, group: r.group, engine: r.translation_model, prompt_version: r.prompt_version, run_id: RUN_ID, measure: 'agreement',
    against: { reference_id: r.group === 'known' ? `gutenberg:${r.reference.items.map((x) => x.id).join('+')}` : `gutenberg:matched-to:${r.matched_to} (chance floor, not this work)` },
    scorer: 'translation-recitation@1', scorer_version: 1, normaliser_version: 'tokens@1 (NFKD, lowercase, [a-z0-9]+)', abstain: false,
    metric: { words: r.words, run_whole: r.run_whole, share8_whole: r4(r.share8_whole), coverage: r.coverage, run_located: r.run_located, share8_located: r4(r.share8_located) },
    served_sha256: r.served_sha256, at, issue: 5523,
  }));
  fs.writeFileSync(path.join(storeDir, `${DATE.slice(0, 7)}.jsonl`), storeRows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  // by-eye packet (local only, never committed): served body vs located passage for the top 5
  const top = [...treatRows].sort((a, b) => b.share8_whole - a.share8_whole || b.run_whole - a.run_whole).slice(0, 5);
  const eye = top.map((r) => {
    const ref = refs.get(r.book_id).idx.ref;
    return `### ${r.slug} — ${r.work}\nrun ${r.run_whole} · share8 ${r4(r.share8_whole)} · coverage ${r.coverage}\nRUN: ${r.run_text}\n\nSERVED:\n${bodies.get(r.book_id).replace(/\s+/g, ' ').slice(0, 2500)}\n\nPUBLISHED (located, tokenised):\n${ref.slice(r.loc_start, r.loc_end).join(' ').slice(0, 3000)}\n`;
  }).join('\n---\n');
  fs.mkdirSync('/tmp/rec', { recursive: true });
  fs.writeFileSync('/tmp/rec/by-eye.md', eye);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
