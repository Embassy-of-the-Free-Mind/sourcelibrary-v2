#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs — judgePrompt (task ocr), parseVerdict, opusCall, QUOTA, imported
// unchanged; its packet()'s wrong-page control rule (2 a cell × route, another book's output on this image) restated
// here because packet() is keyed to that study's cells. scripts/eval/flash-reread-5924/T-TASK.md: the Step T prompt,
// read from the file at run time. scripts/eval/judge-cal-7866bar-7263/meaning.mjs crop(): the band around a flagged
// span, here placed by the span's character offset, and vertical for Chinese columns. sa-gr-served-7991/second.mjs
// builds second-reader claims from the same defect schema, but its packet shows the first severity; this one does not.
/**
 * #7263 severity calibration, stage 3: every Opus call. Blind: a call sees the language, the image and text(s), never
 * the arm (stored / fresh), the engine, or another call's severity. Nothing here writes to Mongo.
 *
 *   node scripts/eval/severity-cal-7263/judge.mjs packet
 *   node scripts/eval/severity-cal-7263/judge.mjs route --sitting=1|2     route judge (sitting 2 after 1 is complete)
 *   node scripts/eval/severity-cal-7263/judge.mjs stept                    Step T, one page a call (S, F, wrong page)
 *   node scripts/eval/severity-cal-7263/judge.mjs second                   second reader on every serious span
 *   node scripts/eval/severity-cal-7263/judge.mjs miss                     second reader on 10 accepted items a language
 *   node scripts/eval/severity-cal-7263/judge.mjs refarm --ref-dir=DIR     #7243 reference arm (Sanskrit)
 * Every call is one row of OUT/opus-calls.jsonl; a stage stops at OPUS_CAP or when claudeBlocked (weekly 85%, session
 * 95%). [--concurrency=3] [--limit=N]. A reply that does not parse is retried, at most 3 tries an item.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { judgePrompt, parseVerdict, opusCall } from '../route-judge-6740/judge.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { OUT, ROOT, SEED, OPUS_CAP, LANGS, arg, sha, jsonl, J, W, imageFor, shuffle, opusUsed, noteOpus } from './lib.mjs';

const STAGE = process.argv[2];
const WEEKLY = Number(process.env.ROUTE_JUDGE_WEEKLY_MAX || 85), SESSION = Number(process.env.ROUTE_JUDGE_SESSION_MAX || 95);
const SERIOUS = new Set(['misleads', 'wrong_text']);
const IMG_REF = 'the file ./page.jpg in your working directory (open it with Read before you answer)';
const first = (f, key = 'id') => { const m = new Map(); for (const r of jsonl(path.join(OUT, f))) if (r.verdict && !m.has(r[key])) m.set(r[key], r); return m; };
const bodyOf = (t) => String(t || '').replace(/<(vocab|meta|note|summary|keywords|image-desc|warning)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
const parseArray = (t) => { const m = String(t || '').match(/\[[\s\S]*\]/); try { return JSON.parse(m[0]); } catch { return null; } };

/** Run `todo` items through `call(it) → {text,cls,...}` with the pace guard and the study cap; `parse` makes the verdict. */
async function runCalls(stage, file, todo, prompt, parse, setup) {
  const limits = await import('../../lib/model-limits.mjs');
  const tries = new Map(); for (const r of jsonl(file)) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const done = new Set(jsonl(file).filter((r) => r.verdict).map((r) => r.id));
  const left = todo.filter((it) => !done.has(it.id) && (tries.get(it.id) ?? 0) < 3);
  const limit = Number(arg('limit') || Infinity);
  console.log(`${stage}: ${left.length} of ${todo.length} to call (study total so far ${opusUsed()} of ${OPUS_CAP})`);
  let stop = null, calls = 0, i = 0;
  const one = async (it) => {
    if (opusUsed() >= OPUS_CAP) { stop = { reason: `OPUS_CAP ${OPUS_CAP}` }; return; }
    const b = limits.claudeBlocked({ weeklyMax: WEEKLY, sessionMax: SESSION });
    if (b) { stop = b; return; }
    calls++;
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'sev-'));
    try {
      await setup(it, ws);
      const t0 = Date.now();
      const r = await opusCall(prompt(it), ws);
      noteOpus(stage, it.id, r);
      if (r.cls === 'quota') { limits.noteLimitHit('claude', { reason: r.text.slice(0, 200) }); stop = { reason: 'quota reply' }; return; }
      const v = parse(r.text);
      fs.appendFileSync(file, JSON.stringify({ id: it.id, stage, model: r.model, cls: r.cls, verdict: v, raw: v ? undefined : String(r.text).slice(0, 600), secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }) + '\n');
      console.log(`  ${stage} ${it.id}: ${v ? 'ok' : `unparsed ${r.cls ?? ''}`}`);
    } catch (e) {
      fs.appendFileSync(file, JSON.stringify({ id: it.id, stage, verdict: null, raw: `error: ${e.message}`.slice(0, 300) }) + '\n');
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < left.length && calls < limit) await one(left[i++]); }));
  if (stop) { console.log(`STOPPED: ${JSON.stringify(stop)}`); process.exit(3); }
}
const linkImage = async (it, ws, name = 'page.jpg') => fs.copyFileSync(await imageFor(it.page_id, it.image_url), path.join(ws, name));

// ── packet: the route judge's items (blind ids) and the key ──
function packet() {
  const s = J('sample.json'), reads = J('reads.json');
  const items = [], key = [];
  const add = (x, arm, kind, text, extra = {}) => {
    const id = `i${sha(`${kind}:${arm}:${x.page_id}:${extra.other ?? ''}:${sha(text)}`).slice(0, 10)}`;
    items.push({ id, task: 'ocr', lang: LANGS[x.lang], image_url: x.image, page_id: x.page_id, text });
    key.push({ id, lang: x.lang, arm, kind, page_id: x.page_id, book_id: x.book_id, page_number: x.page_number, text_sha: sha(text), ...extra });
  };
  const textOf = (x, arm) => (arm === 'S' ? x.stored : reads[x.page_id].F.text);
  // Judged: the stored text as served (a loop included: it is what a reader sees); the fresh read when it is a read.
  const usable = (x, arm) => (arm === 'S' ? reads[x.page_id].S.class !== 'failed: empty' : reads[x.page_id].F.class === 'ok');
  for (const lang of Object.keys(LANGS)) for (const arm of ['S', 'F']) {
    const ok = s.filter((x) => x.lang === lang && usable(x, arm));
    for (const x of ok) add(x, arm, 'item', textOf(x, arm));
    for (let i = 0; i < 2 && ok.length > 2; i++) {   // judge.mjs packet(): this image, another book's output
      const x = ok[i], other = ok.find((o, j) => j >= Math.floor(ok.length / 2) + i && o.book_id !== x.book_id) ?? ok[(i + Math.floor(ok.length / 2)) % ok.length];
      add(x, arm, 'wrong_page', textOf(other, arm), { other: other.page_id });
    }
  }
  W('packet.json', items); W('key.json', key);
  console.log(`packet: ${items.length} items (${key.filter((k) => k.kind === 'wrong_page').length} controls)`);
}

async function route() {
  const n = Number(arg('sitting'));
  if (![1, 2].includes(n)) throw new Error('--sitting=1|2');
  const items = J('packet.json');
  if (n === 2) { const s1 = first('route-s1.jsonl'); const miss = items.filter((it) => !s1.has(it.id)).length; if (miss) throw new Error(`sitting 1 is not complete (${miss} items)`); }
  const order = shuffle(items, makeRng(SEED + 100 * n));
  await runCalls(`route-s${n}`, path.join(OUT, `route-s${n}.jsonl`), order, (it) => judgePrompt(it, IMG_REF), parseVerdict, (it, ws) => linkImage(it, ws));
}

// ── Step T: T-TASK.md on one page, three texts (S, F, a wrong page) in a seeded order ──
const LANG_NOTE = (lang) => fs.readFileSync(path.join(ROOT, 'scripts/eval/flash-reread-5924/T-TASK.md'), 'utf8').split('\n').find((l) => l.startsWith(`- **${lang}**`)).replace(/^- \*\*\w+\*\* — /, '');
export function stepTPrompt(it) {
  const task = fs.readFileSync(path.join(ROOT, 'scripts/eval/flash-reread-5924/T-TASK.md'), 'utf8').split('\n').slice(4).join('\n')
    .replace(/<LANGUAGE>/g, LANGS[it.lang]).replace(/`<IN>`/g, '`./in.json`').replace(/`<OUT>`/g, 'your reply')
    .replace(/To zoom: `node [^`]+` \(fractions 0–1 of\nwidth and height\), writing the crop under `\$JOB_SCRATCH\/crops\/`\./, 'To zoom: open `./tile-1.jpg` and `./tile-2.jpg`, two overlapping halves of the page at full resolution.')
    .replace('Write `your reply`: a JSON array', 'Reply with a JSON array').replace('Write the file even if a page is hard', 'Answer even if a page is hard');
  return `${task}\n\nIn this sitting the only tool is Read. Everything you need is in your working directory: in.json, page.jpg, the two tiles and X.txt, Y.txt, Z.txt. Reply with the JSON array only.`;
}
async function tiles(file, ws, lang) {
  const { default: sharp } = await import('sharp');
  const m = await sharp(file).metadata();
  const parts = lang === 'zh' ? [[Math.floor(m.width * 0.45), 0, m.width - Math.floor(m.width * 0.45), m.height], [0, 0, Math.ceil(m.width * 0.55), m.height]]
    : [[0, 0, m.width, Math.ceil(m.height * 0.55)], [0, Math.floor(m.height * 0.45), m.width, m.height - Math.floor(m.height * 0.45)]];
  for (const [k, [left, top, width, height]] of parts.entries()) await sharp(file).extract({ left, top, width, height }).jpeg({ quality: 90 }).toFile(path.join(ws, `tile-${k + 1}.jpg`));
}
async function stept() {
  const s = J('sample.json'), reads = J('reads.json'), rng = makeRng(SEED + 7);
  const items = [];
  for (const lang of Object.keys(LANGS)) {
    const pages = s.filter((x) => x.lang === lang);
    pages.forEach((x, i) => {
      const other = pages[(i + Math.floor(pages.length / 2)) % pages.length];
      const F = reads[x.page_id].F.class === 'ok' ? reads[x.page_id].F.text : null;
      const arms = [['S', x.stored], ['W', other.stored], ...(F ? [['F', F]] : [['W2', reads[other.page_id].F.class === 'ok' ? reads[other.page_id].F.text : pages[(i + 1) % pages.length].stored]])];
      const order = shuffle(arms, rng);
      items.push({ id: `t${sha(`stept:${x.page_id}`).slice(0, 10)}`, lang, page_id: x.page_id, image_url: x.image, slug: `${x.book_id}-p${x.page_number}`, page_number: x.page_number, labels: Object.fromEntries(order.map(([a], k) => ['XYZ'[k], a])), texts: order.map(([, t]) => t), other: other.page_id });
    });
  }
  W('stept-key.json', items.map(({ texts, ...k }) => k));
  await runCalls('stept', path.join(OUT, 'stept.jsonl'), items, (it) => stepTPrompt(it), (t) => { const a = parseArray(t); return Array.isArray(a) && a[0]?.X && a[0]?.Y && a[0]?.Z ? a[0] : null; }, async (it, ws) => {
    const f = await imageFor(it.page_id, it.image_url);
    fs.copyFileSync(f, path.join(ws, 'page.jpg')); await tiles(f, ws, it.lang);
    it.texts.forEach((t, k) => fs.writeFileSync(path.join(ws, `${'XYZ'[k]}.txt`), t));
    fs.writeFileSync(path.join(ws, 'in.json'), JSON.stringify({ book: it.slug, lang_note: LANG_NOTE(it.lang), pages: [{ slug: it.slug, page_number: it.page_number, img: './page.jpg', full_img: './page.jpg', tiles: ['./tile-1.jpg', './tile-2.jpg'], X: './X.txt', Y: './Y.txt', Z: './Z.txt' }] }, null, 1));
  });
}

// ── second reader: each serious span, with a crop, no severity shown ──
/** The span's place on the page: its character offset in the text's body, as a band (horizontal; vertical for zh). */
async function cropFor(file, text, quote, lang, out) {
  const { default: sharp } = await import('sharp');
  const b = bodyOf(text).replace(/\s+/g, ''), q = String(quote || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '');
  const at = q.length >= 2 ? b.indexOf(q.slice(0, Math.min(12, q.length))) : -1;
  if (at < 0) return 'whole';
  const f = (at + Math.min(q.length, 12) / 2) / Math.max(1, b.length), m = await sharp(file).metadata();
  if (lang === 'zh') {   // vertical columns, right to left: offset f sits at x = (1 − f) of the width
    const w = Math.ceil(0.35 * m.width), left = Math.max(0, Math.min(m.width - w, Math.floor((1 - f) * m.width - w / 2)));
    await sharp(file).extract({ left, top: 0, width: w, height: m.height }).jpeg({ quality: 90 }).toFile(out);
    return [+(left / m.width).toFixed(3), +((left + w) / m.width).toFixed(3)];
  }
  const hgt = Math.ceil(0.3 * m.height), top = Math.max(0, Math.min(m.height - hgt, Math.floor(f * m.height - hgt / 2)));
  await sharp(file).extract({ left: 0, top, width: m.width, height: hgt }).jpeg({ quality: 90 }).toFile(out);
  return [+(top / m.height).toFixed(3), +((top + hgt) / m.height).toFixed(3)];
}
export const SECOND_PROMPT = (it) => `You are checking points that another reader raised about a transcription of one page of a printed ${LANGS[it.lang]} book. The page image is ./page.jpg in your working directory. For each point, ./crop-<n>.jpg shows the part of the page where the point should be; it is placed by estimate and may miss, so use the full page when it does. Open the images with Read; zoom with the crops.

TRANSCRIPTION (the whole page, for context):
"""
${it.text}
"""

POINTS (the words as transcribed, and what the other reader said about them):
${it.points.map((p, k) => `${k + 1}. "${p.quote}" — ${p.what || 'no reason given'}`).join('\n')}

For each point, look at the page yourself and answer:
- different: "yes" when the transcription's words there are not what the page prints (a different, added or missing character, word, number, name or line), "no" when the page prints what the transcription has, "cannot_tell" when the image does not let you decide.
- page_prints: what the page prints there, briefly.
- changes_sense: only when different is "yes": "yes" when a reader of the transcription would take the sentence to say something other than what the page says (another word, name or number, a negation, a phrase or line lost, added or repeated); "no" when the difference is spelling, a variant or simplified form of the same character, punctuation, layout or markup, and the sentence still says the same thing. null when different is not "yes".

Answer with JSON only: {"points":[{"n":1,"different":"yes|no|cannot_tell","page_prints":"...","changes_sense":"yes|no|null","why":"a few words"}]}`;
export function seriousSpans(itemId) {
  const out = [], seen = new Set();
  for (const f of ['route-s1.jsonl', 'route-s2.jsonl']) {
    const v = first(f).get(itemId)?.verdict;
    for (const [i, d] of (v?.defects || []).entries()) {
      if (!SERIOUS.has(d.severity)) continue;
      const k = String(d.quote ?? '').replace(/\s+/g, '').slice(0, 60) || `${f}:${i}`;
      if (seen.has(k)) { out.find((p) => p.key === k).from.push(`${f.slice(6, 8)}:${i}`); continue; }
      seen.add(k); out.push({ key: k, quote: String(d.quote ?? '').slice(0, 300), what: String(d.what ?? '').slice(0, 200), from: [`${f.slice(6, 8)}:${i}`] });
    }
  }
  return out;
}
async function second() {
  const items = J('packet.json'), key = new Map(J('key.json').map((k) => [k.id, k]));
  const todo = items.filter((it) => key.get(it.id).kind === 'item').map((it) => ({ ...it, lang: key.get(it.id).lang, points: seriousSpans(it.id) })).filter((it) => it.points.length);
  W('second-items.json', todo.map(({ text, ...k }) => ({ ...k, text_sha: sha(text) })));
  await runCalls('second', path.join(OUT, 'second.jsonl'), todo, SECOND_PROMPT, (t) => { try { const v = JSON.parse(String(t).match(/\{[\s\S]*\}/)[0]); return Array.isArray(v.points) ? v : null; } catch { return null; } }, async (it, ws) => {
    const f = await imageFor(it.page_id, it.image_url); fs.copyFileSync(f, path.join(ws, 'page.jpg'));
    it.crops = [];
    for (const [k, p] of it.points.entries()) { const band = await cropFor(f, it.text, p.quote, it.lang, path.join(ws, `crop-${k + 1}.jpg`)); if (band === 'whole') fs.copyFileSync(f, path.join(ws, `crop-${k + 1}.jpg`)); it.crops.push(band); }
  });
}

// ── misses: a fresh reader on accepted items with no serious call ──
export const MISS_PROMPT = (it) => `You are checking a transcription of one page of a printed ${LANGS[it.lang]} book against the page image (./page.jpg in your working directory; ./tile-1.jpg and ./tile-2.jpg are two overlapping halves at full resolution). Open the images with Read and read the page yourself, closely.

TRANSCRIPTION:
"""
${it.text}
"""

List every place where the transcription says something the page does not, in a way that changes what a sentence says: another word, name or number, a negation, a phrase or line dropped, added or repeated. Leave out spelling, variant or simplified forms of the same character, punctuation, layout and markup tags. An empty list is a fine answer.

Answer with JSON only: {"errors":[{"quote":"<the transcription's words>","page_prints":"<what the page prints>","what":"a few words"}]}`;
async function miss() {
  const items = J('packet.json'), key = new Map(J('key.json').map((k) => [k.id, k])), s1 = first('route-s1.jsonl');
  const todo = [];
  for (const lang of Object.keys(LANGS)) {
    const ok = items.filter((it) => key.get(it.id).kind === 'item' && key.get(it.id).lang === lang && s1.get(it.id)?.verdict?.accept && !(s1.get(it.id).verdict.defects || []).some((d) => SERIOUS.has(d.severity)));
    todo.push(...shuffle(ok, makeRng(SEED + 31 + lang.charCodeAt(0))).slice(0, Number(arg('per-lang') || 10)).map((it) => ({ ...it, lang })));
  }
  W('miss-items.json', todo.map(({ text, ...k }) => k));
  await runCalls('miss', path.join(OUT, 'miss.jsonl'), todo, MISS_PROMPT, (t) => { try { const v = JSON.parse(String(t).match(/\{[\s\S]*\}/)[0]); return Array.isArray(v.errors) ? v : null; } catch { return null; } }, async (it, ws) => {
    const f = await imageFor(it.page_id, it.image_url); fs.copyFileSync(f, path.join(ws, 'page.jpg')); await tiles(f, ws, it.lang);
  });
}

// ── #7243 reference arm: the route judge on its agy Flash-low read (F) and on the reference itself ──
async function refarm() {
  const dir = path.resolve(arg('ref-dir') || '');
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/eval/sanskrit-gex45-7243/refs-manifest.json'), 'utf8')).refs;
  const pages = new Map(JSON.parse(fs.readFileSync(path.join(dir, 'pages.json'), 'utf8')).pages.map((p) => [p.slug, p]));
  const F = new Map(fs.readFileSync(path.join(dir, 'arms/F.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.uid, r]));
  const print = man.filter((r) => r.kind === 'print' && F.get(r.slug)?.text && pages.has(r.slug)).sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const pick = shuffle(print, makeRng(SEED + 43)).slice(0, Number(arg('n') || 20));
  const items = [];
  for (const r of pick) {
    const ref = fs.readFileSync(path.join(dir, 'refwork/final', `${r.slug}.txt`), 'utf8');
    if (sha(ref) !== r.sha256) throw new Error(`reference ${r.slug} does not match its frozen hash`);
    const p = pages.get(r.slug);
    for (const [arm, text] of [['F', F.get(r.slug).text], ['REF', ref]]) items.push({ id: `r${sha(`${arm}:${r.slug}`).slice(0, 10)}`, task: 'ocr', lang: 'Sanskrit', image_url: p.image_url, page_id: `ref-${r.slug}`, text, arm, slug: r.slug });
  }
  W('refarm-key.json', items.map(({ text, ...k }) => ({ ...k, text_sha: sha(text) })));
  await runCalls('refarm', path.join(OUT, 'refarm.jsonl'), shuffle(items, makeRng(SEED + 44)), (it) => judgePrompt(it, IMG_REF), parseVerdict, (it, ws) => linkImage(it, ws));
}

const stages = { packet, route, stept, second, miss, refarm };
if (process.argv[1]?.endsWith('severity-cal-7263/judge.mjs')) {
  if (!stages[STAGE]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await stages[STAGE]();
}
