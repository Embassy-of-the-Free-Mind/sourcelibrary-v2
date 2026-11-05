/**
 * PRIOR ART: scripts/audit/image-provenance-coverage.mjs (its robustness row is the image half of this
 * matrix and is reused as is); tests/unit/steganographia.test.ts (pins the mark on synthetic text, never
 * a real served page put through a copier); scripts/eval/lib/sampling.mjs (book-weighted draws; this
 * needs one page per book with a translation of a set length, drawn here in four lines).
 *
 * Slice 9 of #8150, the text half: take real served translations, do to them what a copier does, and
 * ask each layer whether it can still say (a) the text came from us, (b) which edition, (c) through
 * which channel. False positives are measured on text that is not ours.
 *
 *   channel A  the live quote API (what a reader or an agent copies): fetched from production
 *   channel B  bulk egress with a campaign ref: the same pages marked here by the production code and
 *              key with a test ref (live bulk traffic carries a ref only for a flagged pool)
 *
 * Layers: zero-width mark (verifyExport), its readable colophon (where riddles ride), passage matching
 * on our translations (scripts/audit/match-passage.mjs), and the live semantic search.
 *
 * Paraphrase and translation go through `agy -p` (gemini-3.8-flash-low, subscription, no paid API),
 * cached under --out so a rerun spends nothing.
 *
 * Usage (from the repo root):
 *   node --env-file=.env.production.local node_modules/.bin/tsx scripts/eval/recovery-matrix-8150/text.mts \
 *     --out=$JOB_SCRATCH/s9 --n=20
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { MongoClient } from 'mongodb';
import { markForExport, verifyExport } from '../../../src/lib/provenance';
// @ts-expect-error untyped .mjs
import { matchPassage, words, shingles } from '../../audit/match-passage.mjs';
import { ObjectId } from 'mongodb';
// @ts-expect-error untyped .mjs
import { gatedTextCall } from '../../lib/agy-cli.mjs';
// @ts-expect-error untyped .mjs
import { getTranslationText } from '../../lib/translation-text.mjs';

const arg = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = arg('out', process.env.JOB_SCRATCH ? `${process.env.JOB_SCRATCH}/s9` : '/tmp/s9');
const N = Number(arg('n', '20'));
const MODEL = arg('model', 'gemini-3.8-flash-low');
// The box's internal API key (no daily page budget). Never printed or written out.
const KEY = (process.env.SL_INTERNAL_KEY || fs.readFileSync(process.env.SL_INTERNAL_KEY_FILE || '/root/.sl-internal-key', 'utf8')).trim();
const API = 'https://sourcelibrary.org';
const TEST_REF = 'S9TESTREF1';
const ZW = /[​-‏⁠-⁤﻿]/g;

fs.mkdirSync(path.join(OUT, 'agy-cache'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'tmp'), { recursive: true });

function rng(seed: string) {
  let x = crypto.createHash('sha256').update(seed).digest().readUInt32LE(0) || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

async function agy(kind: 'paraphrase' | 'translate-fr', text: string): Promise<string | null> {
  const h = crypto.createHash('sha256').update(kind + '\0' + text).digest('hex').slice(0, 20);
  const f = path.join(OUT, 'agy-cache', `${kind}-${h}.txt`);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  const ask = kind === 'paraphrase'
    ? 'Rewrite the following passage in your own words. Keep every idea and the order of ideas, change the wording and sentence structure throughout, as someone would before republishing it.'
    : 'Translate the following passage into French.';
  const prompt = `${ask}\n\n${text}\n\nDo not open, read or write any file and do not use any tool: the text is above. Write the result between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers.`;
  const r = await gatedTextCall(prompt, { model: MODEL, task: 'translate', attempts: 2, tmp: path.join(OUT, 'tmp') });
  if (r.cls === 'quota') throw new Error('agy quota reached: stop and resume later');
  const a = typeof r.answer === 'string' ? r.answer.trim() : '';
  if (!a || a.length < text.replace(ZW, '').length * 0.3) return null;
  fs.writeFileSync(f, a);
  return a;
}

type Treat = { name: string; f: (t: string, seed: string) => string | Promise<string | null> };

function paragraphs(t: string) { return t.split(/\n\s*\n/).filter((p) => p.replace(ZW, '').trim().length > 0); }
const TREATMENTS: Treat[] = [
  { name: 'as served', f: (t) => t },
  { name: 'NFC', f: (t) => t.normalize('NFC') },
  { name: 'NFKC', f: (t) => t.normalize('NFKC') },
  { name: 'reflow whitespace', f: (t) => t.replace(/\s+/g, ' ').trim() },
  { name: 'strip zero-width (one regex)', f: (t) => t.replace(ZW, '') },
  { name: 'strip all format chars \\p{Cf}', f: (t) => t.replace(/\p{Cf}/gu, '') },
  { name: 'ASCII fold', f: (t) => t.normalize('NFKD').replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '') },
  { name: 'excerpt: longest paragraph', f: (t) => paragraphs(t).sort((a, b) => b.length - a.length)[0] || t },
  { name: 'excerpt: 300 chars', f: (t, s) => { const r = rng(s + 'x300'); const i = Math.floor(r() * Math.max(1, t.length - 300)); return t.slice(i, i + 300); } },
  { name: 'excerpt: one sentence', f: (t, s) => { const ss = t.split(/(?<=[.;?!])\s+/).filter((x) => x.replace(ZW, '').length > 60); return ss.length ? ss[Math.floor(rng(s + 'sent')() * ss.length)] : t; } },
  { name: 'strip zero-width + excerpt 300', f: (t, s) => { const c = t.replace(ZW, ''); const i = Math.floor(rng(s + 'x300')() * Math.max(1, c.length - 300)); return c.slice(i, i + 300); } },
  { name: 'paraphrase (LLM)', f: (t) => agy('paraphrase', t) },
  { name: 'translate to French (LLM)', f: (t) => agy('translate-fr', t) },
];

async function semantic(text: string) {
  const q = text.replace(ZW, '').replace(/<[^>]{1,40}>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800);
  if (q.length < 20) return { results: [] as any[] };
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${API}/api/search/semantic?level=page&limit=10&q=${encodeURIComponent(q)}`, { headers: { authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(60_000) });
    if (r.ok) return (await r.json()) as { results: any[] };
    await new Promise((res) => setTimeout(res, 3000));
  }
  return { results: [] as any[], error: true };
}

/**
 * Semantic candidates, then short-run overlap: does the copy share 3-word runs with a candidate page's
 * translation beyond what an independent translation of the same passage shares? (A paraphrase keeps
 * names, terms and short phrases; another translator keeps fewer. Measured, not assumed: see the FP set.)
 */
async function semLex(db: any, text: string, results: any[]) {
  const qs = shingles(words(text), 3);
  if (!qs.size) return { best: 0, page_id: null, book_id: null };
  let best = { best: 0, page_id: null as string | null, book_id: null as string | null };
  for (const r of results.slice(0, 10)) {
    // Same exclusions as match-passage.mjs: an English edition's text, or words printed on the page,
    // are not our translation.
    if (/^(en|eng|english)\b/i.test(String(r.book_language || ''))) continue;
    let pg: any = null;
    try { pg = await db.collection('pages').findOne({ _id: new ObjectId(r.page_id) }, { projection: { translation: 1, 'ocr.data': 1 } }); } catch { /* non-ObjectId id */ }
    const cs = shingles(words(getTranslationText(pg)), 3);
    const os = shingles(words(pg?.ocr?.data), 3);
    let hit = 0, inOcr = 0;
    for (const s3 of qs) { if (cs.has(s3)) hit++; if (os.has(s3)) inOcr++; }
    const c = hit / qs.size;
    if (inOcr >= hit / 2 && hit > 0) continue;
    if (c > best.best) best = { best: Math.round(c * 1000) / 1000, page_id: r.page_id, book_id: r.book_id };
  }
  return best;
}

function zwcLayer(text: string, bookId: string) {
  const v = verifyExport(text);
  const zw = (text.match(ZW) || []).length;
  return {
    zw,
    authentic: !!v?.authentic,
    edition_ok: !!v?.authentic && v.editionId === bookId.slice(0, 8),
    message: !!(v?.authentic && v.message),
    ref_ok: !!(v?.authentic && v.message && v.message.includes(TEST_REF)),
  };
}

// The draw selects by the stored translation's length: the one direct read of the raw field here.
async function drawPages(db: any) {
  const out: any[] = [];
  const cur = db.collection('books').aggregate([
    { $match: { visible: true, pages_count: { $gt: 10 }, language: { $nin: ['English', 'en', 'eng'] } } },
    { $sample: { size: N * 6 } },
    { $project: { id: 1, title: 1, language: 1 } },
  ]);
  for await (const b of cur) {
    if (out.length >= N) break;
    if (!b.id || !/^[0-9a-f]{24}$/.test(b.id)) continue;
    const p = await db.collection('pages').aggregate([
      { $match: { book_id: b.id, 'translation.data': { $type: 'string' } } },
      { $project: { page_number: 1, len: { $strLenCP: { $ifNull: ['$translation.data', ''] } }, page_type: 1 } },
      { $match: { len: { $gte: 900, $lte: 3500 } } },
      { $sample: { size: 1 } },
    ], { maxTimeMS: 60_000 }).toArray();
    if (!p.length) continue;
    out.push({ book_id: b.id, title: b.title, language: b.language, page_number: p[0].page_number, page_id: String(p[0]._id) });
  }
  return out;
}

async function liveQuote(bookId: string, page: number): Promise<string | null> {
  const r = await fetch(`${API}/api/books/${bookId}/quote?page=${page}&include_original=false`, { headers: { authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) return null;
  const t = (await r.json())?.quote?.translation;
  return typeof t === 'string' ? t : null;
}

// Not ours: independent public-domain English translations of works we hold, and unrelated English.
const GUTENBERG = [
  { id: 14328, what: 'Boethius, Consolation (tr. H. R. James)' },
  { id: 1653, what: 'Imitation of Christ (tr. W. Benham)' },
  { id: 1232, what: 'Machiavelli, The Prince (tr. W. K. Marriott)' },
  { id: 2680, what: 'Marcus Aurelius, Meditations (tr. M. Casaubon)' },
  { id: 3296, what: 'Augustine, Confessions (tr. E. B. Pusey)' },
  { id: 1342, what: 'Austen, Pride and Prejudice (unrelated)' },
  { id: 1228, what: 'Darwin, Origin of Species (unrelated)' },
];
async function notOurs(): Promise<{ src: string; text: string }[]> {
  const dir = path.join(OUT, 'gutenberg');
  fs.mkdirSync(dir, { recursive: true });
  const out: { src: string; text: string }[] = [];
  for (const g of GUTENBERG) {
    const f = path.join(dir, `pg${g.id}.txt`);
    if (!fs.existsSync(f)) {
      const r = await fetch(`https://www.gutenberg.org/cache/epub/${g.id}/pg${g.id}.txt`, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) { console.error(`gutenberg ${g.id}: ${r.status}`); continue; }
      fs.writeFileSync(f, await r.text());
    }
    const raw = fs.readFileSync(f, 'utf8');
    const body = raw.split(/\*\*\* ?START OF[^\n]*\n/)[1]?.split(/\*\*\* ?END OF/)[0] || raw;
    const paras = body.split(/\r?\n\s*\r?\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 500 && p.length < 2500);
    const r = rng(`gut${g.id}`);
    for (let k = 0; k < 3 && paras.length; k++) out.push({ src: g.what, text: paras[Math.floor(r() * paras.length)] });
  }
  return out;
}

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI!);
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const rowsFile = path.join(OUT, 'text-rows.jsonl');
  const sampleFile = path.join(OUT, 'text-sample.json');
  try {
    let sample: any[] = fs.existsSync(sampleFile) ? JSON.parse(fs.readFileSync(sampleFile, 'utf8')) : [];
    if (!sample.length) {
      for (const p of await drawPages(db)) {
        const served = await liveQuote(p.book_id, p.page_number);
        if (served && (served.match(ZW) || []).length > 0) sample.push({ ...p, served });
      }
      fs.writeFileSync(sampleFile, JSON.stringify(sample));
    }
    console.error(`sample: ${sample.length} pages, one per book`);
    const rows: any[] = [];
    for (const s of sample) {
      const clean = s.served.replace(ZW, '');
      const bulk = markForExport(clean, s.book_id, { ref: TEST_REF });
      for (const t of TREATMENTS) {
        const a = await t.f(s.served, s.book_id);
        if (a == null) { rows.push({ book_id: s.book_id, treatment: t.name, skipped: 'no model output' }); continue; }
        // The LLM rows reuse channel A's output: a model drops zero-width characters either way.
        const b = t.name.includes('LLM') ? a : await t.f(bulk, s.book_id);
        const lex = await matchPassage(db, a);
        const sem = await semantic(a);
        const rank = sem.results.findIndex((r: any) => r.page_id === s.page_id);
        const sl = await semLex(db, a, sem.results);
        rows.push({
          book_id: s.book_id, treatment: t.name, chars: a.length,
          A: zwcLayer(a, s.book_id), B: zwcLayer(b as string, s.book_id),
          lex: { ours: lex.ours, edition_ok: lex.ours && lex.book_id === s.book_id, page_ok: lex.ours && lex.book_id === s.book_id && lex.page_number === s.page_number, containment: lex.containment, reason: lex.reason },
          sem: { rank, top_score: sem.results[0]?.score ?? null, top_book_ok: sem.results[0]?.book_id === s.book_id, src_score: rank >= 0 ? sem.results[rank].score : null },
          semlex: { c3: sl.best, page_ok: sl.page_id === s.page_id },
        });
        fs.appendFileSync(rowsFile, JSON.stringify(rows[rows.length - 1]) + '\n');
      }
      console.error(`done ${s.book_id}`);
    }
    // False positives.
    const fp: any[] = [];
    for (const g of await notOurs()) {
      const v = verifyExport(g.text);
      const lex = await matchPassage(db, g.text);
      const sem = await semantic(g.text);
      const sl = await semLex(db, g.text, sem.results);
      fp.push({ semlex_c3: sl.best, src: g.src, zwc_authentic: !!v?.authentic, lex_ours: lex.ours, lex_containment: lex.containment, lex_reason: lex.reason, sem_top: sem.results[0]?.score ?? null, sem_top_title: sem.results[0]?.book_title ?? null });
    }
    fs.writeFileSync(path.join(OUT, 'text-fp.json'), JSON.stringify(fp, null, 1));
    summarise(rows, fp);
  } finally { await client.close(); }
}

function summarise(rows: any[], fp: any[]) {
  const semFpMax = Math.max(...fp.map((f) => f.sem_top ?? 0));
  const c3FpMax = Math.max(...fp.map((f) => f.semlex_c3 ?? 0));
  const by = new Map<string, any[]>();
  for (const r of rows) { if (!by.has(r.treatment)) by.set(r.treatment, []); by.get(r.treatment)!.push(r); }
  const pct = (xs: any[], f: (r: any) => boolean) => `${xs.filter(f).length}/${xs.length}`;
  console.log(`\nsemantic threshold = highest score any not-ours passage reached: ${semFpMax.toFixed(3)}`);
  console.log(`semantic+3-gram threshold = highest 3-gram containment any not-ours passage reached: ${c3FpMax.toFixed(3)}`);
  console.log('treatment | ZWC from-us | ZWC edition | colophon | ZWC channel (bulk ref) | passage from-us | passage edition+page | semantic finds page (top10) | semantic above FP max | sem+3gram above FP max (right page)');
  for (const [name, xs0] of by) {
    const xs = xs0.filter((r) => !r.skipped);
    console.log([name,
      pct(xs, (r) => r.A.authentic), pct(xs, (r) => r.A.edition_ok), pct(xs, (r) => r.A.message), pct(xs, (r) => r.B.ref_ok),
      pct(xs, (r) => r.lex.ours), pct(xs, (r) => r.lex.page_ok),
      pct(xs, (r) => r.sem.rank >= 0), pct(xs, (r) => r.sem.rank >= 0 && r.sem.src_score > semFpMax),
      pct(xs, (r) => r.semlex.c3 > c3FpMax && r.semlex.page_ok),
    ].join(' | ') + (xs0.length > xs.length ? ` (${xs0.length - xs.length} no model output)` : ''));
  }
  console.log('\nfalse positives (not ours):');
  console.log(`  ZWC authentic: ${fp.filter((f) => f.zwc_authentic).length}/${fp.length}; passage says ours: ${fp.filter((f) => f.lex_ours).length}/${fp.length}; max containment ${Math.max(...fp.map((f) => f.lex_containment)).toFixed(3)}`);
  for (const f of fp) console.log(`  ${f.src}: containment ${f.lex_containment} (${f.lex_reason}); semantic top ${f.sem_top?.toFixed?.(3)}; sem+3gram ${f.semlex_c3}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
