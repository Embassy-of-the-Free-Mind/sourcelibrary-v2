#!/usr/bin/env node
// PRIOR ART: ./regrade.mjs (bandOf / gradeOf, the 800 #7866 verdicts by language; reads lane confidence-7866) and
// scripts/eval/severity-cal-7263/analyze.mjs (#8136: sense errors per 1,000 words, the book bootstrap, Wilson, kindOf
// kinds — restated, that file computes on import and is not on main). Neither cuts by language × script with books
// brought to a common n, and neither counts page furniture apart.
/**
 * #7263 judged-expand (scripts/eval/experiments/2026-11-04-judged-expand-7263.md): the table by language × script.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/confidence-7866/expand-analyze.mjs
 *        → results/judged-expand-7263.json, and the table as markdown on stdout
 *
 * Reads: OUT (this study's sample, key, verdicts, second reader), lane_judge_verdicts lane confidence-7866 (live rows,
 * #7866's verdicts) with the pages' current text for units, and severity-cal-7263's run directory (its 30 Sanskrit
 * stored reads, sitting 1). Writes the one results file, aggregates only (no page ids, quotes or draw lists: Derek,
 * 2026-11-04), and the containment list to OUT on the box. No Mongo write.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import { words } from '../route-judge-6740/defect-rate.mjs';
import { verdictQuery } from '../lib/judge-rows.mjs';
import { kindOf } from '../latin-strata-7947/lib.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { bandOf, BANDS, BAND_LABEL, LANE, RUN } from './regrade.mjs';
import { RESULTS } from './lib.mjs';
import { EX_OUT as OUT, EX_SEED, SEV_CAL_DIR, LANG_ALIAS, TEST_ID, RECORD, bookScripts, jsonl } from './expand-lib.mjs';
import { first, SERIOUS } from './expand-judge.mjs';

const J = (f, dir = OUT) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(2));
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(3));
const pctl = (a, p) => { const s = [...a].filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.max(0, Math.min(s.length - 1, Math.floor(p * s.length)))] : null; };
function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [r3((c - h) / d), r3((c + h) / d)];
}

// ── furniture: running heads, page numbers, signatures, catchwords — counted apart from the body ──
const FURN_TAGS = ['header', 'page-num', 'sig', 'catchword'];
const FURN_RE = new RegExp(`<(${FURN_TAGS.join('|')})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi');
const squash = (t) => String(t || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '');
export function splitFurniture(text) {
  const t = String(text || ''), parts = [];
  for (const m of t.matchAll(FURN_RE)) parts.push(m[2]);
  return { body: t.replace(FURN_RE, ' '), furniture: parts };
}
/** A defect is furniture when the judge classed it O11, or its quote sits inside a furniture tag and not in the body. */
export function isFurniture(d, split) {
  if (/^O11\b/i.test(String(d.class || ''))) return true;
  const q = squash(d.quote).slice(0, 40);
  if (q.length < 2) return false;
  return split.furniture.some((f) => squash(f).includes(q)) && !squash(split.body).includes(q);
}
/** Japanese runs Han and kana together without spaces: words() would count a page as a handful of "words". Its unit
 *  is the character (Han + kana), as Han is for Chinese. Every other language keeps words()'s own unit. */
const KANA_HAN = /[\u3040-\u30ff\u31f0-\u31ff㐀-鿿豈-﫿\u{20000}-\u{2ffff}]/gu;
const unitsOf = (t, language) => (language === 'Japanese' ? (String(t || '').replace(/<[^>]*>/g, ' ').match(KANA_HAN) || []).length : words(t));
/** The unit words() counts in, by the same test. */
function unitOf(t, language) {
  if (language === 'Japanese') return 'characters';
  const b = String(t || '').replace(/<[^>]*>/g, ' ');
  const han = (b.match(/[㐀-鿿豈-﫿\u{20000}-\u{2ffff}]/gu) || []).length, tib = (b.match(/[ཀ-ྼ]/g) || []).length;
  const lat = (b.match(/\p{L}/gu) || []).length - han - tib;
  return han > lat && han >= tib ? 'Han characters' : tib > lat ? 'syllables' : 'words';
}

function pageRow({ src, language, script, book, page, page_id, text, verdict, served, weightOf }) {
  const split = splitFurniture(text);
  const ds = verdict?.defects || [];
  const body = ds.filter((d) => !isFurniture(d, split)), furn = ds.filter((d) => isFurniture(d, split));
  return {
    src, language, script, cell: `${language}|${script}`, book, page, page_id, served,
    judged: Boolean(verdict), band: !served ? 'no_text_served' : verdict ? bandOf(verdict) : 'unjudged', accept: verdict ? verdict.accept : null, fidelity: verdict ? Number(verdict.fidelity) : null,
    units: served ? unitsOf(split.body, language) : 0, unit: unitOf(split.body, language), furniture_units: split.furniture.reduce((a, f) => a + unitsOf(f, language), 0),
    serious_body: body.filter((d) => SERIOUS.has(d.severity)).length, cosmetic_body: body.filter((d) => d.severity === 'cosmetic').length,
    furniture_spans: furn.length, furniture_serious: furn.filter((d) => SERIOUS.has(d.severity)).length,
    kinds: body.filter((d) => SERIOUS.has(d.severity)).map((d) => kindOf({ class: d.class, problem: d.what, ocr: d.quote }, 'ocr')),
    defects: ds.map((d) => ({ class: d.class, severity: d.severity, quote: String(d.quote ?? '').slice(0, 160), what: String(d.what ?? '').slice(0, 200), furniture: isFurniture(d, split) })),
    note: String(verdict?.reader_note ?? '').slice(0, 240), weightOf,
  };
}

async function load() {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const rows = [];

  // ① this study's draw
  const sample = new Map(J('sample.json').map((s) => [s.page_id, s]));
  const key = J('key.json'), route = first('route.jsonl');
  for (const k of key.filter((x) => x.kind === 'item')) {
    const s = sample.get(k.page_id);
    rows.push(pageRow({ src: 'new', language: s.language, script: s.script, book: s.book_id, page: s.page_number, page_id: s.page_id, text: s.stored, verdict: route.get(k.id)?.verdict ?? null, served: s.served_state === 'text', weightOf: 1 }));
  }

  // ② #7866's verdicts (live rows), the pages' current text for units; cell by the same language alias and script rule
  const recs = (await db.collection('lane_judge_verdicts').find(verdictQuery({ lane: LANE, run_id: RUN, kind: 'item' })).toArray()).filter((r) => r.verdict);
  const oids = [...new Set(recs.map((r) => r.book_id))];
  const books = await db.collection('books').find({ $or: [{ _id: { $in: oids.filter((x) => /^[0-9a-f]{24}$/.test(x)).map((x) => new ObjectId(x)) } }, { id: { $in: oids } }] }, { projection: { id: 1, _id: 1, language: 1, 'book_class.class': 1 } }).toArray();
  const scripts = await bookScripts(db, books);
  const bookOf = new Map(); for (const b of books) { bookOf.set(String(b._id), b); bookOf.set(b.id, b); }
  const texts = new Map();
  for (let i = 0; i < recs.length; i += 100) {
    const got = await db.collection('pages').find({ $or: recs.slice(i, i + 100).map((r) => ({ book_id: { $in: [r.book_id, bookOf.get(r.book_id)?.id].filter(Boolean) }, page_number: r.page_number })) }, { projection: { book_id: 1, page_number: 1, 'ocr.data': 1 } }).toArray();
    for (const p of got) texts.set(`${p.book_id}:${p.page_number}`, p.ocr?.data ?? '');
  }
  const perBook = {}; for (const r of recs) perBook[r.book_id] = (perBook[r.book_id] ?? 0) + 1;
  for (const r of recs) {
    const b = bookOf.get(r.book_id); if (!b) continue;
    const t = texts.get(`${r.book_id}:${r.page_number}`) ?? texts.get(`${b.id}:${r.page_number}`) ?? '';
    rows.push(pageRow({ src: '7866', language: LANG_ALIAS[b.language] ?? b.language, script: scripts.get(b.id).script, book: b.id, page: r.page_number, page_id: r.page_id ?? null, text: t, verdict: r.verdict, served: true, weightOf: perBook[r.book_id] }));
  }
  await c.close();

  // ③ severity-cal-7263's Sanskrit stored reads, sitting 1
  const sk = J('key.json', SEV_CAL_DIR).filter((k) => k.lang === 'sa' && k.arm === 'S' && k.kind === 'item');
  const ss = new Map(J('sample.json', SEV_CAL_DIR).map((s) => [s.page_id, s]));
  const s1 = new Map(); for (const r of jsonl(path.join(SEV_CAL_DIR, 'route-s1.jsonl'))) if (r.verdict && !s1.has(r.id)) s1.set(r.id, r);
  for (const k of sk) { const s = ss.get(k.page_id); rows.push(pageRow({ src: 'sevcal', language: 'Sanskrit', script: 'print', book: s.book_id, page: s.page_number, page_id: s.page_id, text: s.stored, verdict: s1.get(k.id)?.verdict ?? null, served: true, weightOf: 1 })); }
  return { rows, key, route };
}

// ── per cell: book-weighted band shares and the body sense-error rate, book bootstrap ──
const MID = ['some_errors', 'many_errors'];
/** Text that is not this page's: from elsewhere, mostly wrong (fidelity 2), not this page (fidelity 1). */
const OFF = ['from_elsewhere', 'mostly_wrong', 'not_this_page'];
// A page that serves no text is its own band, whatever the judge said of the empty candidate (its verdict is kept:
// `no_text_judge` counts the empty pages the judge accepted, i.e. leaves with nothing to transcribe).
const BANDS_X = [...BANDS, 'no_text_served', 'unjudged'];
function cellStats(ps, seed) {
  const byBook = new Map(); for (const p of ps) (byBook.get(p.book) ?? byBook.set(p.book, []).get(p.book)).push(p);
  const books = [...byBook.values()];
  const share = (bs, k) => bs.reduce((a, pg) => a + pg.filter((p) => p.band === k).length / pg.length, 0) / bs.length;
  const rate = (bs) => { let e = 0, u = 0; for (const pg of bs) for (const p of pg) if (p.served && p.judged) { e += p.serious_body / pg.length; u += p.units / pg.length; } return u ? (1000 * e) / u : null; };
  const rng = makeRng(seed), B = 4000, draws = { rate: [], ...Object.fromEntries(BANDS_X.map((k) => [k, []])), mid: [], off: [] };
  for (let i = 0; i < B; i++) {
    const s = Array.from({ length: books.length }, () => books[Math.floor(rng() * books.length)]);
    draws.rate.push(rate(s)); for (const k of BANDS_X) draws[k].push(share(s, k)); draws.mid.push(share(s, 'some_errors') + share(s, 'many_errors')); draws.off.push(OFF.reduce((a, k) => a + share(s, k), 0));
  }
  const ci = (k) => [r3(pctl(draws[k], 0.025)), r3(pctl(draws[k], 0.975))];
  const units = ps.filter((p) => p.served && p.judged);
  const unitCounts = {}; for (const p of units) unitCounts[p.unit] = (unitCounts[p.unit] ?? 0) + p.units;
  const kinds = {}; for (const p of ps) for (const k of p.kinds) kinds[k] = (kinds[k] ?? 0) + 1;
  return {
    books: books.length, books_new: new Set(ps.filter((p) => p.src === 'new').map((p) => p.book)).size,
    books_7866: new Set(ps.filter((p) => p.src === '7866').map((p) => p.book)).size, books_sevcal: new Set(ps.filter((p) => p.src === 'sevcal').map((p) => p.book)).size,
    pages: ps.length, judged: ps.filter((p) => p.judged).length, no_text_served: ps.filter((p) => !p.served).length, no_text_judge_accepted: ps.filter((p) => !p.served && p.accept).length,
    bands: Object.fromEntries(BANDS_X.map((k) => [k, { pages: ps.filter((p) => p.band === k).length, share: r3(share(books, k)), ci95: ci(k) }])),
    may_change_meaning: { share: r3(share(books, 'some_errors') + share(books, 'many_errors')), ci95: ci('mid') },
    not_on_the_page: { bands: OFF, share: r3(OFF.reduce((a, k) => a + share(books, k), 0)), ci95: ci('off') },
    accepted: `${ps.filter((p) => p.accept).length}/${ps.filter((p) => p.judged).length}`,
    unit: Object.entries(unitCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'words',
    sense_errors_per_1k: { value: r2(rate(books)), ci95: [r2(pctl(draws.rate, 0.025)), r2(pctl(draws.rate, 0.975))], spans: units.reduce((a, p) => a + p.serious_body, 0), units: units.reduce((a, p) => a + p.units, 0) },
    furniture: { spans: ps.reduce((a, p) => a + p.furniture_spans, 0), serious: ps.reduce((a, p) => a + p.furniture_serious, 0), units: ps.reduce((a, p) => a + p.furniture_units, 0), pages_with_furniture: ps.filter((p) => p.furniture_units > 0).length },
    kinds: Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([kind, n]) => ({ kind, spans: n })),
  };
}

function second(key) {
  const items = J('second-items.json'), res = first('second.jsonl'), lang = new Map(key.map((k) => [k.id, k.language]));
  const by = {};
  for (const c of items.calls) {
    const v = res.get(c.id)?.verdict; const L = lang.get(c.item);
    const e = (by[L] ??= { sampled: 0, read: 0, upheld: 0, different_same_sense: 0, not_different: 0, cannot_tell: 0 });
    e.sampled += c.points.length;
    if (!v) continue;
    for (const [n] of c.points.entries()) {
      const a = v.points.find((x) => Number(x.n) === n + 1); if (!a) continue;
      e.read++;
      if (a.different === 'yes' && String(a.changes_sense) === 'yes') e.upheld++;
      else if (a.different === 'yes') e.different_same_sense++;
      else if (a.different === 'no') e.not_different++;
      else e.cannot_tell++;
    }
  }
  for (const e of Object.values(by)) { e.upheld_share = e.read ? r3(e.upheld / e.read) : null; e.ci95 = wilson(e.upheld, e.read); }
  const tot = Object.values(by).reduce((a, e) => ({ read: a.read + e.read, upheld: a.upheld + e.upheld }), { read: 0, upheld: 0 });
  return { serious_spans: items.serious_spans, sampled: items.sampled, calls: items.calls.length, by_language: by, all: { ...tot, upheld_share: r3(tot.upheld / tot.read), ci95: wilson(tot.upheld, tot.read) } };
}

function controls(key, route) {
  const out = {};
  for (const k of key.filter((x) => x.kind === 'wrong_page')) {
    const v = route.get(k.id)?.verdict, e = (out[k.cell] ??= { n: 0, judged: 0, passed: 0, accepted: 0 });
    e.n++; if (!v) continue; e.judged++; if (!v.accept && Number(v.fidelity) <= 2) e.passed++; if (v.accept) e.accepted++;
  }
  const all = Object.values(out).reduce((a, e) => ({ n: a.n + e.n, judged: a.judged + e.judged, passed: a.passed + e.passed, accepted: a.accepted + e.accepted }), { n: 0, judged: 0, passed: 0, accepted: 0 });
  return { all, by_cell: out };
}

/** Invented or wrong-leaf text on a page that serves text: listed for containment, never written. */
const ELSEWHERE = /^(I1|O1|O2|O3|T17)$/;
const containment = (rows) => rows.filter((p) => p.src === 'new' && p.served && p.judged && (['from_elsewhere', 'not_this_page'].includes(p.band) || p.defects.some((d) => d.severity === 'wrong_text' && ELSEWHERE.test(String(d.class).toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? ''))))
  .map((p) => ({ cell: p.cell, book: p.book, page: p.page, band: p.band, fidelity: p.fidelity, spans: p.defects.filter((d) => d.severity === 'wrong_text' && ELSEWHERE.test(String(d.class).toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? '')).map((d) => `${d.class}: "${d.quote}" — ${d.what}`), note: p.note }));

const { rows, key, route } = await load();
const seedOf = (k) => [...k].reduce((a, ch) => (Math.imul(a, 31) + ch.codePointAt(0)) | 0, EX_SEED + 300);
// Cells of the frame's languages only: a #7866 book in a language under 100 live books is not reported here.
const FRAME_LANGS = new Set(J('frame.json').languages);
const cells = [...new Set(rows.map((r) => r.cell))].filter((k) => !k.endsWith('|unclassified') && FRAME_LANGS.has(k.split('|')[0]));
const table = cells.map((k) => {
  const ps = rows.filter((r) => r.cell === k), [language, script] = k.split('|');
  const newOnly = ps.filter((p) => p.src === 'new');
  return { language, script, ...cellStats(ps, seedOf(k)), new_draw_only: newOnly.length ? (({ books, bands, may_change_meaning, sense_errors_per_1k, no_text_served }) => ({ books, may_change_meaning, sense_errors_per_1k, no_text_served, fit_to_quote: bands.fit_to_quote, from_elsewhere: bands.from_elsewhere }))(cellStats(newOnly, seedOf(k) + 1)) : null };
}).sort((a, b) => b.books - a.books || a.language.localeCompare(b.language));
const usd = jsonl(path.join(OUT, 'opus-calls.jsonl'));
const out = {
  generated_at: new Date().toISOString(), record: RECORD, test_id: TEST_ID, issue: 7263,
  judge: 'claude-opus-5-5 (claude -p), route-judge-6740 judgePrompt against the page image, one sitting, blind. One judge; the second reader checked a 20% sample of its serious spans.',
  not_pooled: 'Oversampled by language: never pooled into the 800-page weighted library figure (served-grades.json) without frame weights.',
  band_label: { ...BAND_LABEL, no_text_served: 'The page serves no transcription (never read, empty, or marked unreadable)', unjudged: 'Not judged: the image would not fetch or the reply never parsed' },
  opus_calls: { all: usd.length, by_stage: usd.reduce((a, r) => ((a[r.stage] = (a[r.stage] ?? 0) + 1), a), {}), list_usd: r2(usd.reduce((a, r) => a + (r.list_usd ?? 0), 0)) },
  controls: controls(key, route),
  second_reader: fs.existsSync(path.join(OUT, 'second-items.json')) ? second(key) : null,
  cells: table,
};
// Page-level evidence stays out of the public repo (Derek, 2026-11-04): the containment list goes to OUT on the box
// (and the verdicts to Mongo, test.id judged-expand-7263); the results file carries counts by cell only.
const cont = containment(rows);
fs.writeFileSync(path.join(OUT, 'containment.json'), `${JSON.stringify(cont, null, 1)}\n`);
out.containment = { pages: cont.length, by_cell: cont.reduce((a, p) => ((a[p.cell] = (a[p.cell] ?? 0) + 1), a), {}), list: 'on the box: $JOB_SCRATCH/judged-expand-7263/containment.json; not in the repo' };
fs.writeFileSync(path.join(RESULTS, 'judged-expand-7263.json'), `${JSON.stringify(out, null, 1)}\n`);

const pc = (x) => (x == null ? '–' : `${Math.round(100 * x)}%`);
const ci = (a, f = pc) => (a ? `${f(a[0])}–${f(a[1])}` : '');
console.log('| Language · script | Books (new) | Fit to quote | Fit to read | Some errors that may change the meaning (1–2) | Many (3+) | Not this page\'s text¹ | No text served | Sense errors per 1,000² |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const c of table) {
  const b = c.bands, u = c.unit === 'words' ? 'words' : c.unit === 'syllables' ? 'syll.' : 'chars';
  console.log(`| ${c.language} · ${c.script} | ${c.books} (${c.books_new}) | ${pc(b.fit_to_quote.share)} (${ci(b.fit_to_quote.ci95)}) | ${pc(b.fit_to_read.share)} | ${pc(b.some_errors.share)} | ${pc(b.many_errors.share)} | ${pc(c.not_on_the_page.share)} (${ci(c.not_on_the_page.ci95)}) | ${pc(b.no_text_served.share)} | ${c.sense_errors_per_1k.value ?? '–'} (${ci(c.sense_errors_per_1k.ci95, (x) => x)}) ${u} |`);
}
console.log(`\ncontrols ${JSON.stringify(out.controls.all)}; second reader ${JSON.stringify(out.second_reader?.all ?? null)}; containment ${out.containment.pages}; opus ${JSON.stringify(out.opus_calls)}`);
