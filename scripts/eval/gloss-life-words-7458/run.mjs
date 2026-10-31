#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-cognate-ab-4741.mjs — the house shape for a one-block prompt A/B (v13a, v13b
// noise floor, candidate; blinded packets; a mechanical measure plus a judge). Not reusable as-is: it draws Latin pages
// for cognate families and calls flash-lite through the paid API. scripts/eval/book-brief-7499/run.mjs — the $0 agy
// lane reproduced call for call (buildTranslationPrompt + PAGE_BREAK_SCOPED + TRANSLATE_SUFFIX, gatedTextCall,
// cliChatterReason), reused here unchanged. The prompt edit is buildV21 (scripts/maintenance/translation-prompt-v21-
// life-words.mjs); the mechanical measure is lifeWordFindings (scripts/lib/life-word-gloss.mjs).
/**
 * gloss-life-words-7458 — does the v21 life-words block stop "life force" / "vital energy" glosses without costing
 * anything else? Rule fixed in scripts/eval/PREREGISTRATION-gloss-life-words-7458.md before any arm ran. $0: agy + Opus.
 *
 *   N="node --env-file=/root/sourcelibrary/.env.production.local"; S=scripts/eval/gloss-life-words-7458/run.mjs
 *   $N $S draw                 pin 35 target pages (one per book: Chinese 12, Sanskrit 9, Latin 7, German 7) + 5 controls
 *   $N $S translate [--conc=3] arms v13a, v13b, v21 on agy gemini-3.8-flash-low, one page per call (resumable)
 *   $N $S images               page images to $JOB_SCRATCH for the judges
 *   $N $S packets              blinded judge packets (arms shuffled per page, key kept apart)
 *   $N $S score                report.json: the registered rule's output
 *
 * NOTHING here writes to `pages` or `prompts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, loadTranslationPrompts, sanitizeTranslationTags, contentHash } from '../../lib/translate-core.mjs';
import { gatedTextCall, TRANSLATE_SUFFIX } from '../../lib/agy-cli.mjs';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';
import { agyOpen } from '../../maintenance/seam-repair-6742/gemini-repair.mjs';
import { pool } from '../seams-6742/lib.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { buildV21 } from '../../maintenance/translation-prompt-v21-life-words.mjs';
import { lifeWordFindings, lifePhraseCount } from '../../lib/life-word-gloss.mjs';

const STAGE = process.argv[2];
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIR = path.join(HERE, '../results/gloss-life-words-7458');
const SCRATCH = process.env.JOB_SCRATCH || process.env.TMPDIR || '/tmp';
const IMG = path.join(SCRATCH, 'images');
fs.mkdirSync(DIR, { recursive: true });
const UNITS = path.join(DIR, 'units.json');
const READS = path.join(DIR, 'reads.jsonl');
const SEED = 7458;
const AGY_MODEL = 'gemini-3.8-flash-low';
const ARMS = ['v13a', 'v13b', 'v21'];
const V13 = { version: 13, hash: '516510147237b6a79d9d3f6e797bba7f' };
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const append = (f, x) => fs.appendFileSync(f, JSON.stringify(x) + '\n');

// ── draw ─────────────────────────────────────────────────────────────────────
export const STRATA = [
  { key: 'zh', n: 12, langs: ['Chinese', 'Classical Chinese', 'Literary Chinese'], ocr: /[氣气]/ },
  { key: 'sa', n: 9, langs: ['Sanskrit'], ocr: null },
  { key: 'la', n: 7, langs: ['Latin'], ocr: null },
  { key: 'de', n: 7, langs: ['German'], ocr: null },
];
const TARGET_PHRASES = ['vital energy', 'life force', 'life-force', 'vital force'];
const CONTROL_PHRASES = ['Lebenskraft', 'vis vitalis', 'vim vitalem', 'force vitale'];
const MIN_OCR = 300, MAX_OCR = 5000;

async function draw() {
  if (fs.existsSync(UNITS)) throw new Error(`${UNITS} exists — units are pinned once`);
  const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' }); await c.connect();
  const db = c.db('bookstore');
  const rng = makeRng(SEED);
  const search = async (paths, phrases, limit) => db.collection('pages').aggregate([
    { $search: { index: 'pages_search', compound: { should: phrases.map((q) => ({ phrase: { query: q, path: paths } })), minimumShouldMatch: 1, filter: [{ range: { path: 'page_number', gt: 0 } }] } } },
    { $limit: limit }, { $project: { _id: 0, id: 1, book_id: 1, page_number: 1 } },
  ], { maxTimeMS: 600000 }).toArray();
  const liveBooks = async (ids) => new Map((await db.collection('books').find({ id: { $in: ids }, visible: true, pages_count: { $gt: 0 }, 'pipeline_auto.hold': { $exists: false } },
    { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, original_language: 1 } }).toArray()).map((b) => [b.id, b]));
  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const fetchPage = (id) => db.collection('pages').findOne({ id }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, photo: 1, archived_photo: 1, cropped_photo: 1, 'ocr.data': 1, 'translation.data': 1, translation_stale: 1, translation_withheld: 1 } });
  const usable = (p) => p && typeof p.ocr?.data === 'string' && p.ocr.data.length >= MIN_OCR && p.ocr.data.length <= MAX_OCR && typeof p.translation?.data === 'string' && !p.translation_stale && !p.translation_withheld && (p.photo || p.archived_photo || p.cropped_photo);

  const units = [];
  const used = new Set(), usedWork = new Set();
  // one page per WORK, not per record: multi-volume sets (the Peiwen yunfu, the Yuanjian leihan) are dozens of book ids
  const workKey = (b) => String(b.display_title || b.title || '').toLowerCase().replace(/[,;:(].*$/, '').replace(/\b(vol|volume|juan|band|tomus|part)\b.*$/, '').trim();
  const pick = async (hits, books, n, ok, stratum, kind) => {
    const byBook = new Map();
    for (const h of shuffle(hits)) if (books.has(h.book_id) && !used.has(h.book_id) && !usedWork.has(workKey(books.get(h.book_id)))) { if (!byBook.has(h.book_id)) byBook.set(h.book_id, []); byBook.get(h.book_id).push(h); }
    let got = 0;
    for (const [bookId, hs] of byBook) {
      if (got >= n) break;
      if (usedWork.has(workKey(books.get(bookId)))) continue;
      for (const h of hs.slice(0, 4)) {
        const p = await fetchPage(h.id);
        if (!usable(p) || !ok(p)) continue;
        const b = books.get(bookId);
        units.push({ unit: `${stratum}-${++got}`, stratum, kind, book: b, page_id: p.id, page_number: p.page_number, page_type: p.page_type || null, ocr: p.ocr.data, stored: p.translation.data, ocr_hash: contentHash(p.ocr.data) });
        used.add(bookId); usedWork.add(workKey(b));
        break;
      }
    }
    console.log(`${stratum}: ${got} of ${n} (${byBook.size} candidate books)`);
  };

  const targetHits = await search('translation.data', TARGET_PHRASES, 40000);
  console.log(`target hits ${targetHits.length}`);
  const tBooks = await liveBooks([...new Set(targetHits.map((h) => h.book_id))]);
  for (const s of STRATA) {
    const books = new Map([...tBooks].filter(([, b]) => s.langs.includes(b.language)));
    await pick(targetHits, books, s.n, (p) => lifeWordFindings(p.translation.data, p.ocr.data).unlicensed > 0 && (!s.ocr || s.ocr.test(p.ocr.data)), s.key, 'target');
  }
  const ctlHits = await search('ocr.data', CONTROL_PHRASES, 5000);
  console.log(`control hits ${ctlHits.length}`);
  const cBooks = await liveBooks([...new Set(ctlHits.map((h) => h.book_id))]);
  await pick(ctlHits, cBooks, 5, (p) => lifeWordFindings('', p.ocr.data).licensed, 'ctl', 'control');

  // previous/next OCR and the previous page's stored translation: the context production sends
  for (const u of units) {
    const nb = await db.collection('pages').find({ book_id: u.book.id, page_number: { $in: [u.page_number - 1, u.page_number + 1] } }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
    const prev = nb.find((x) => x.page_number === u.page_number - 1), next = nb.find((x) => x.page_number === u.page_number + 1);
    u.prev_ocr = prev?.ocr?.data || null; u.next_ocr = next?.ocr?.data || null; u.prev_translation = prev?.translation?.data || null;
  }
  fs.writeFileSync(UNITS, JSON.stringify({ seed: SEED, drawn_at: new Date().toISOString(), units }, null, 1));
  console.log(`pinned ${units.length} units → ${path.relative(process.cwd(), UNITS)}`);
  await c.close();
}

// ── translate ────────────────────────────────────────────────────────────────
async function translate(conc) {
  const { units } = JSON.parse(fs.readFileSync(UNITS, 'utf8'));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const prompts = await loadTranslationPrompts(c.db('bookstore')); await c.close();
  if (prompts.translation.ref.version !== V13.version || prompts.translation.ref.content_hash !== V13.hash) throw new Error(`default translation prompt is not the registered v13: ${JSON.stringify(prompts.translation.ref)}`);
  const v21 = { ...prompts, translation: { text: buildV21(prompts.translation.text), ref: { ...prompts.translation.ref, version: 'eval-7458-v21' } } };
  fs.mkdirSync(path.join(DIR, 'prompts'), { recursive: true });
  const all = readJsonl(READS);
  const ok = new Set(all.filter((r) => r.ok).map((r) => `${r.unit}|${r.arm}`));
  const tries = (k) => all.filter((r) => `${r.unit}|${r.arm}` === k).length;
  const jobs = units.flatMap((u) => ARMS.map((arm) => ({ u, arm }))).filter(({ u, arm }) => !ok.has(`${u.unit}|${arm}`) && tries(`${u.unit}|${arm}`) < 3);
  console.log(`${jobs.length} calls to make`);
  await pool(jobs, conc, async ({ u, arm }) => {
    if (!agyOpen(AGY_MODEL)) return { cls: 'usage_limit' };
    const built = buildTranslationPrompt({ prompts: arm === 'v21' ? v21 : prompts, book: u.book, ocrText: u.ocr, previousTranslation: u.prev_translation ? sanitizeTranslationTags(u.prev_translation) : null, prevOcrText: u.prev_ocr || undefined, nextOcrText: u.next_ocr || undefined, pageBreak: PAGE_BREAK_SCOPED });
    const sent = built.prompt + TRANSLATE_SUFFIX;
    const h = contentHash(sent); const pf = path.join(DIR, 'prompts', `${h}.txt`); if (!fs.existsSync(pf)) fs.writeFileSync(pf, sent);
    const r = await gatedTextCall(sent, { model: AGY_MODEL, task: 'translate', tmp: process.env.TMPDIR });
    if (r.cls === 'quota') return { cls: 'usage_limit' };
    const text = r.cls ? '' : (r.answer || '');
    const why = r.cls || r.problem || (!text.trim() ? 'empty' : cliChatterReason(text));
    append(READS, { unit: u.unit, arm, ok: !why, why: why || undefined, text: why ? text : sanitizeTranslationTags(text), engine: 'agy', model: AGY_MODEL, sent_hash: h, prompt_version: built.promptRef?.version, secs: Math.round(r.secs || 0), calls: r.calls, at: new Date().toISOString() });
    console.log(`  ${u.unit} ${arm}: ${why || 'ok'}`);
    return { ok: !why, cls: null };
  }, { probe: async () => ({ cls: agyOpen(AGY_MODEL) ? null : 'usage_limit' }), maxWaitH: 6 });
}

// ── images ───────────────────────────────────────────────────────────────────
async function images() {
  const { units } = JSON.parse(fs.readFileSync(UNITS, 'utf8'));
  const sharp = (await import('sharp')).default;
  fs.mkdirSync(IMG, { recursive: true });
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  for (const u of units) {
    const f = path.join(IMG, `${u.unit}.jpg`);
    if (fs.existsSync(f)) continue;
    const p = await c.db('bookstore').collection('pages').findOne({ id: u.page_id }, { projection: { photo: 1, archived_photo: 1, cropped_photo: 1 } });
    let done = false;
    for (const url of [p.cropped_photo, p.archived_photo, p.photo].filter((x) => typeof x === 'string' && /^https?:/.test(x))) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        await sharp(buf).rotate().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(f);
        done = true; break;
      } catch { /* next url */ }
    }
    console.log(`${u.unit}: ${done ? 'ok' : 'NO IMAGE'}`);
  }
  await c.close();
}

// ── packets ──────────────────────────────────────────────────────────────────
const LETTERS = ['X', 'Y', 'Z'];
function packets() {
  const { units } = JSON.parse(fs.readFileSync(UNITS, 'utf8'));
  const reads = new Map(readJsonl(READS).filter((r) => r.ok).map((r) => [`${r.unit}|${r.arm}`, r.text]));
  const rng = makeRng(SEED + 1);
  const key = [];
  const items = [];
  for (const u of units) {
    if (!ARMS.every((a) => reads.has(`${u.unit}|${a}`))) { console.warn(`${u.unit}: missing an arm, left out`); continue; }
    const order = [...ARMS]; for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const id = `G${String(items.length + 1).padStart(2, '0')}`;
    key.push({ id, unit: u.unit, kind: u.kind, arms: Object.fromEntries(order.map((a, i) => [LETTERS[i], a])) });
    items.push({ id, image: path.join(IMG, `${u.unit}.jpg`), book: `${u.book.display_title || u.book.title} (${u.book.language}${u.book.year ? `, ${u.book.year}` : ''})`, page_number: u.page_number, source_text: u.ocr, translations: Object.fromEntries(order.map((a, i) => [LETTERS[i], reads.get(`${u.unit}|${a}`)])) });
  }
  // shuffle page order so a packet cannot be read by stratum
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  fs.writeFileSync(path.join(SCRATCH, 'judge-key.json'), JSON.stringify(key, null, 1));
  const N_FILES = 5;
  for (let f = 0; f < N_FILES; f++) fs.writeFileSync(path.join(SCRATCH, `packet-${f + 1}.json`), JSON.stringify(items.filter((_, i) => i % N_FILES === f), null, 1));
  console.log(`${items.length} pages in ${N_FILES} packets under ${SCRATCH}; key in judge-key.json (never give it to a judge)`);
}

// ── score ────────────────────────────────────────────────────────────────────
const binomTwoSided = (k, n) => { if (!n) return 1; const lo = Math.min(k, n - k); let p = 0; for (let i = 0; i <= lo; i++) { let c = 1; for (let j = 0; j < i; j++) c = (c * (n - j)) / (j + 1); p += c / 2 ** n; } return Math.min(1, 2 * p); };
function bootMeanDiff(d, rng, B = 10000) { const n = d.length; const xs = []; for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += d[Math.floor(rng() * n)]; xs.push(s / n); } xs.sort((a, b) => a - b); return [xs[Math.floor(0.025 * B)], xs[Math.floor(0.975 * B)]]; }

function score() {
  const { units } = JSON.parse(fs.readFileSync(UNITS, 'utf8'));
  const reads = new Map(readJsonl(READS).filter((r) => r.ok).map((r) => [`${r.unit}|${r.arm}`, r.text]));
  const rows = units.map((u) => ({ u, f: Object.fromEntries(ARMS.map((a) => [a, reads.has(`${u.unit}|${a}`) ? lifeWordFindings(reads.get(`${u.unit}|${a}`), u.ocr) : null])), any: Object.fromEntries(ARMS.map((a) => [a, reads.has(`${u.unit}|${a}`) ? lifePhraseCount(reads.get(`${u.unit}|${a}`)) : null])) }));
  const T = rows.filter((r) => r.u.kind === 'target' && ARMS.every((a) => r.f[a]));
  const C = rows.filter((r) => r.u.kind === 'control' && ARMS.every((a) => r.f[a]));
  const flagged = (a) => T.filter((r) => r.f[a].unlicensed > 0).length;
  const disc = (x, y) => { const b = T.filter((r) => r.f[x].unlicensed > 0 && !(r.f[y].unlicensed > 0)).length; const c = T.filter((r) => !(r.f[x].unlicensed > 0) && r.f[y].unlicensed > 0).length; return { x_only: b, y_only: c, p: binomTwoSided(Math.min(b, c), b + c) }; };
  const byStratum = Object.fromEntries(['zh', 'sa', 'la', 'de'].map((s) => [s, Object.fromEntries(ARMS.map((a) => [a, `${T.filter((r) => r.u.stratum === s && r.f[a].unlicensed > 0).length}/${T.filter((r) => r.u.stratum === s).length}`]))]));
  const report = {
    mechanical: {
      target_pages: T.length,
      stored_flagged: T.filter((r) => lifeWordFindings(r.u.stored, r.u.ocr).unlicensed > 0).length,
      flagged: Object.fromEntries(ARMS.map((a) => [a, flagged(a)])),
      by_stratum: byStratum,
      v21_vs_v13a: disc('v13a', 'v21'), v13b_vs_v13a: disc('v13a', 'v13b'),
      controls: C.map((r) => ({ unit: r.u.unit, any_phrase: r.any })),
    },
  };
  const kf = path.join(SCRATCH, 'judge-key.json');
  const vfiles = fs.readdirSync(DIR).filter((f) => /^verdicts-\d+\.json$/.test(f));
  if (vfiles.length && fs.existsSync(kf)) {
    const key = new Map(JSON.parse(fs.readFileSync(kf, 'utf8')).map((k) => [k.id, k]));
    const verdicts = vfiles.flatMap((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
    const per = []; // one row per page: per-arm scores
    for (const v of verdicts) {
      const k = key.get(v.id); if (!k) continue;
      const arm = (L) => k.arms[L];
      const row = { id: v.id, unit: k.unit, kind: k.kind };
      for (const L of LETTERS) {
        const j = v.translations?.[L]; if (!j) continue;
        row[arm(L)] = { fidelity: j.fidelity, life_ok: j.life_words_correct, life_wrong: j.life_words_wrong, serious: (j.serious_errors || []).length };
      }
      per.push(row);
    }
    const ok = per.filter((r) => ARMS.every((a) => r[a]));
    const rng = makeRng(SEED + 2);
    const diff = (x, y, rs = ok) => { const d = rs.map((r) => r[x].fidelity - r[y].fidelity); return { n: d.length, mean: +(d.reduce((s, z) => s + z, 0) / (d.length || 1)).toFixed(3), ci95: bootMeanDiff(d, rng).map((z) => +z.toFixed(3)) }; };
    const lifeAcc = (a, rs = ok) => { const okN = rs.reduce((s, r) => s + (r[a].life_ok || 0), 0); const bad = rs.reduce((s, r) => s + (r[a].life_wrong || 0), 0); return { correct: okN, wrong: bad, accuracy: okN + bad ? +(okN / (okN + bad)).toFixed(3) : null, pages_with_wrong: rs.filter((r) => (r[a].life_wrong || 0) > 0).length }; };
    const tgt = ok.filter((r) => r.kind === 'target');
    report.judge = {
      pages: ok.length, missing: [...key.keys()].filter((id) => !per.some((r) => r.id === id && ARMS.every((a) => r[a]))),
      fidelity_mean: Object.fromEntries(ARMS.map((a) => [a, +(ok.reduce((s, r) => s + r[a].fidelity, 0) / (ok.length || 1)).toFixed(3)])),
      v21_minus_v13a: diff('v21', 'v13a'), v13b_minus_v13a: diff('v13b', 'v13a'),
      life_words_target: Object.fromEntries(ARMS.map((a) => [a, lifeAcc(a, tgt)])),
      life_words_controls: Object.fromEntries(ARMS.map((a) => [a, lifeAcc(a, ok.filter((r) => r.kind === 'control'))])),
      serious_pages: Object.fromEntries(ARMS.map((a) => [a, ok.filter((r) => r[a].serious > 0).length])),
      per_page: per,
    };
  }
  fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ ...report, judge: report.judge ? { ...report.judge, per_page: `${report.judge.per_page.length} rows` } : undefined }, null, 1));
}

if (STAGE === 'draw') await draw();
else if (STAGE === 'translate') await translate(Number(arg('conc', 3)));
else if (STAGE === 'images') await images();
else if (STAGE === 'packets') packets();
else if (STAGE === 'score') score();
else { console.error('stage: draw|translate|images|packets|score'); process.exit(2); }
