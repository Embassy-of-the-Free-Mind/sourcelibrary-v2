#!/usr/bin/env node
// PRIOR ART: scripts/eval/seams-6742/judge-repairs.mjs (blind Opus pairwise judge, both orders, A/A floor — of page
// JOINS, not whole-page fidelity); scripts/eval/translation-vs-reference/ (judges against a published human translation,
// which most of these languages do not have page-aligned); the planner's two-family judge (#6740, posterior draws only,
// no runner in the repo). None draws served pages of one language translated by the reader a CLI row would replace and
// judges them blind against the new reader's read, with a wrong-page control, as #7075 step 3 asks before a row goes live.
/**
 * The adoption sample for a `channel: "cli"` translation row (#7075): N served pages of one language whose stored
 * English came from the OLD reader, read again by the NEW one, judged blind by two model families.
 *
 *   node --env-file=.env.production.local scripts/eval/translate-cli-lane-7075/sample.mjs draw --lang=pali --old=gemini-3-flash-preview --n=20 --out=DIR
 *   node --env-file=.env.production.local scripts/batch/claude-translate.mjs read --page-ids-file=DIR/page-ids.json --out=DIR/new --job=cli-lane-sample
 *   node --env-file=.env.production.local scripts/eval/translate-cli-lane-7075/sample.mjs packet --out=DIR
 *   node scripts/eval/translate-cli-lane-7075/sample.mjs judge --out=DIR --judge=opus|gemini
 *   node scripts/eval/translate-cli-lane-7075/sample.mjs score --out=DIR
 *
 * TWO NEW READERS (Greek, 2026-10-25): `--arm=gemini|opus` on packet, judge and score reads DIR/new-<arm>/ and keeps
 * packet-<arm>.json, key-<arm>.json, verdicts-<arm>-<judge>.jsonl and score-<arm>.json apart; without --arm the file
 * names are the Pali run's. `--old=current` draws pages whose stored English is CURRENT (translation.updated_at later
 * than ocr.updated_at, any model) instead of pages of one named model; packet then skips a page whose stored English
 * changed after the draw (its updated_at).
 *
 * DRAW. Visible books whose FIRST language label is --lang; pages with OCR of at least 300 characters, a translatable
 * page type, and `translation.model` = --old. One page per book (a book is one observation), seeded by page id; a
 * second round per book only if there are fewer books than --n. Optional: --ocr-source=paddle keeps pages whose OCR
 * came from that source, and --english-after-ocr keeps only pages whose stored English is newer than their OCR (an
 * English made from an earlier transcription would be judged against a source it never saw; #6871). --title=REGEX and
 * --exclude-title=REGEX narrow the books to the kind the row will translate (a frame of tables and music is not a
 * frame of rhyme dictionaries).
 *
 * PACKET. Per page the source text (stored OCR) and two English candidates, X and Y, the side chosen by a seeded coin.
 * Two CONTROLS: the stored English of the page against the stored English of a different page of the same language.
 * The key is DIR/key.json; the judges read only DIR/packet.json.
 *
 * JUDGES. Opus through `claude -p` (sealed, no tools) and Gemini 3.8 Flash high through `agy -p`, one call per item.
 * Two families because each may prefer its own family's prose.
 *
 * RULE (fixed before the first run, 2026-10-23). The row goes live when (1) both judges pass both controls, (2) under
 * each judge the new reader's mean fidelity is not below the old reader's (paired mean difference ≥ 0), and (3) the
 * by-eye check of three new reads against the source finds no invented passage. Prediction from the planner
 * (#6740, EL 0.20 page-fraction for Pali): the new reader wins by at least 0.3 fidelity points (1–5) on the two-judge mean.
 *
 * GREEK (fixed before the first run, 2026-10-25). The same three rules, applied to each arm on its own (`--old=current`,
 * the old reader being whatever stored English is current, mostly 3 Flash and lite). If both arms pass, 3.8 Flash
 * (agy) is adopted unless Opus's two-judge mean is higher by more than 0.25 points: the cheaper engine wins a tie. Each
 * arm has one same-family judge, so a pass also needs the OTHER family's judge alone at ≥ 0. A row is not written on
 * one judge: an arm whose second judge has not run is PENDING, not passed.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../lib/paired-stats.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const STAGE = process.argv[2];
const OUT = arg('out') && path.resolve(arg('out'));
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1));
const ARM = arg('arm');
const A = (f) => (ARM ? f.replace(/\.(json|jsonl)$/, `-${ARM}.$1`) : f);
const NEW_DIR = () => path.join(OUT, ARM ? `new-${ARM}` : 'new');
const CURRENT = 'current';

async function draw() {
  const { MongoClient } = await import('mongodb');
  const { prefixRegex } = await import('../../lib/translation-routing.mjs');
  const { SKIP_TRANSLATION_PAGE_TYPES } = await import('../../lib/translate-core.mjs');
  const lang = arg('lang'), old = arg('old'), n = Number(arg('n') || 20), ocrSource = arg('ocr-source');
  const afterOcr = process.argv.includes('--english-after-ocr');
  const titleRe = arg('title') && new RegExp(arg('title')), exclRe = arg('exclude-title') && new RegExp(arg('exclude-title'));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const re = prefixRegex([lang], ['ancient']);
  // The label regex is the router's (prefixRegex); Mongo only narrows by substring, so "Ancient Greek" is not lost.
  const books = (await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, language: { $regex: lang, $options: 'i' } }, { projection: { id: 1, title: 1, language: 1 } }).toArray()).filter((b) => re.test(b.language))
    .filter((b) => (!titleRe || titleRe.test(b.title || '')) && (!exclRe || !exclRe.test(b.title || '')));
  // Length and freshness are computed in the database so the OCR text never leaves it.
  const toDate = (f) => ({ $convert: { input: f, to: 'date', onError: null, onNull: null } });
  const pages = await db.collection('pages').aggregate([
    { $match: { book_id: { $in: books.map((b) => b.id) }, page_number: { $gt: 0 }, ...(old === CURRENT ? {} : { 'translation.model': old }),
      page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES }, 'ocr.data': { $type: 'string' }, 'translation.data': { $type: 'string' },
      ...(ocrSource ? { 'ocr.source': ocrSource } : {}) } },
    { $match: { $expr: { $and: [{ $gte: [{ $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $strLenCP: '$ocr.data' }, 0] }, 300] },
      ...(old === CURRENT ? [{ $gt: [toDate('$translation.updated_at'), toDate('$ocr.updated_at')] }] : []),
      // --english-after-ocr (#6871): the stored English was made from this OCR, not an earlier one
      ...(afterOcr ? [{ $gte: [toDate('$translation.updated_at'), toDate('$ocr.updated_at')] }] : [])] } } },
    { $project: { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.model': 1, 'translation.model': 1, 'translation.updated_at': 1 } },
  ], { allowDiskUse: true }).toArray();
  await c.close();
  const ok = pages.sort((a, b) => h(a.id).localeCompare(h(b.id)));
  const byBook = new Map();
  for (const p of ok) byBook.set(p.book_id, [...(byBook.get(p.book_id) ?? []), p]);
  const picked = [];
  for (let round = 0; picked.length < n && round < 5; round++) {
    for (const [, list] of [...byBook].sort((a, b) => h(a[0]).localeCompare(h(b[0])))) if (list[round] && picked.length < n) picked.push(list[round]);
  }
  picked.sort((a, b) => a.book_id.localeCompare(b.book_id) || a.page_number - b.page_number);
  const title = new Map(books.map((b) => [b.id, b.title]));
  fs.mkdirSync(OUT, { recursive: true });
  W('sample.json', { lang, old, n, ocr_source: ocrSource ?? null, english_after_ocr: afterOcr, title: arg('title') ?? null, exclude_title: arg('exclude-title') ?? null, drawn_at: new Date().toISOString(), frame: { books: books.length, eligible_pages: ok.length, books_with_eligible: byBook.size },
    pages: picked.map((p) => ({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, title: title.get(p.book_id), ocr_model: p.ocr?.model ?? null,
      old_model: p.translation?.model ?? null, old_updated_at: p.translation?.updated_at ?? null })) });
  W('page-ids.json', picked.map((p) => p.id));
  const mix = {}, oldMix = {}; for (const p of picked) { mix[p.ocr?.model ?? '?'] = (mix[p.ocr?.model ?? '?'] ?? 0) + 1; oldMix[p.translation?.model ?? '?'] = (oldMix[p.translation?.model ?? '?'] ?? 0) + 1; }
  console.log(`frame: ${books.length} visible ${lang} books, ${ok.length} eligible pages in ${byBook.size} books; drew ${picked.length} from ${new Set(picked.map((p) => p.book_id)).size} books; OCR ${JSON.stringify(mix)}; old English ${JSON.stringify(oldMix)}`);
}

async function packet() {
  const { MongoClient } = await import('mongodb');
  const s = J('sample.json');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pages = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: s.pages.map((p) => p.page_id) } }, { projection: { id: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.model': 1, 'translation.updated_at': 1 } }).toArray()).map((p) => [p.id, p]));
  await c.close();
  const items = [], key = [];
  const readNew = (id) => { try { const m = JSON.parse(fs.readFileSync(path.join(NEW_DIR(), `${id}.meta.json`), 'utf8')); return m.exit === 0 ? fs.readFileSync(path.join(NEW_DIR(), `${id}.txt`), 'utf8').trim() : null; } catch { return null; } };
  for (const sp of s.pages) {
    const p = pages.get(sp.page_id), fresh = readNew(sp.page_id);
    const changed = s.old === CURRENT ? +new Date(p?.translation?.updated_at) !== +new Date(sp.old_updated_at) : p?.translation?.model !== s.old;
    if (!p || !fresh || changed) { console.log(`  skip ${sp.page_id}: ${!fresh ? 'no new read' : 'stored English changed'}`); continue; }
    const newIsX = parseInt(h(`side:${sp.page_id}`).slice(0, 8), 16) % 2 === 0;
    const id = `i${h(`item:${sp.page_id}`).slice(0, 8)}`;
    items.push({ id, source: p.ocr.data, X: newIsX ? fresh : p.translation.data, Y: newIsX ? p.translation.data : fresh });
    key.push({ id, page_id: sp.page_id, kind: 'pair', X: newIsX ? 'new' : 'old', Y: newIsX ? 'old' : 'new' });
  }
  // Controls: this page's stored English against another page's, the correct one on a seeded side.
  const ctl = s.pages.slice(0, 2);
  ctl.forEach((sp, i) => {
    const other = s.pages[(i + Math.floor(s.pages.length / 2)) % s.pages.length];
    const right = pages.get(sp.page_id)?.translation?.data, wrong = pages.get(other.page_id)?.translation?.data;
    if (!right || !wrong || other.page_id === sp.page_id) return;
    const rightIsX = i % 2 === 1;
    const id = `i${h(`control:${sp.page_id}`).slice(0, 8)}`;
    items.push({ id, source: pages.get(sp.page_id).ocr.data, X: rightIsX ? right : wrong, Y: rightIsX ? wrong : right });
    key.push({ id, page_id: sp.page_id, kind: 'control', X: rightIsX ? 'right' : 'wrong', Y: rightIsX ? 'wrong' : 'right' });
  });
  items.sort((a, b) => a.id.localeCompare(b.id));
  W(A('packet.json'), { lang: s.lang, items });
  W(A('key.json'), key);
  console.log(`packet: ${items.length} items (${key.filter((k) => k.kind === 'control').length} controls)`);
}

const judgePrompt = (lang, it) => `You are checking two English translations of one page of a historical ${lang} text, for a library that publishes them beside the original. The source is an OCR transcription and may contain recognition errors.

SOURCE (${lang}):
"""
${it.source}
"""

TRANSLATION X:
"""
${it.X}
"""

TRANSLATION Y:
"""
${it.Y}
"""

Judge FIDELITY to the source: is everything on the page translated, is nothing added that is not there, are the statements, negations, names and numbers right? Style matters only where it changes the meaning. Score each translation 1-5 (5 = faithful and complete, 3 = usable with real errors, 1 = not a translation of this page). Then say which is more faithful, or "tie".

Answer with one JSON object only: {"x_fidelity": n, "y_fidelity": n, "better": "X" | "Y" | "tie", "reason": "one sentence naming the most important difference"}`;

const USAGE_LIMIT = /usage limit|limit reached|hit your (?:usage )?limit|rate.?limit|\b429\b/i;
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
export function claudeCall(prompt) {
  return new Promise((resolve) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-lane-judge-'));
    const child = spawn('claude', ['-p', '--model', 'opus', '--restricted', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    child.on('close', (code) => {
      fs.rmSync(cwd, { recursive: true, force: true });
      let j = {}; try { j = JSON.parse(out); } catch { /* not JSON */ }
      const text = String(j.result ?? '');
      resolve({ text, limit: (j.is_error || code !== 0) && USAGE_LIMIT.test(text + out + err), model: Object.keys(j.modelUsage || {})[0] ?? null });
    });
  });
}

export const parseJson = (t, ok) => { const m = String(t || '').match(/\{[\s\S]*\}/); try { const v = JSON.parse(m[0]); return ok(v) ? v : null; } catch { return null; } };
const parseVerdict = (t) => parseJson(t, (v) => ['X', 'Y', 'tie'].includes(v.better));

async function judge() {
  const who = arg('judge');
  if (!['opus', 'gemini'].includes(who)) { console.error('--judge=opus|gemini'); process.exit(2); }
  const pk = J(A('packet.json'));
  const file = path.join(OUT, ARM ? `verdicts-${ARM}-${who}.jsonl` : `verdicts-${who}.jsonl`);
  const done = new Set(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
  const agy = who === 'gemini' ? await import('../../lib/agy-cli.mjs') : null;
  for (const it of pk.items) {
    if (done.has(it.id)) continue;
    const prompt = judgePrompt(pk.lang, it);
    let text, model;
    if (agy) {
      const r = await agy.gatedTextCall(prompt + agy.TRANSLATE_SUFFIX.replace(/translation/gi, 'answer'), { model: 'gemini-3.8-flash-high', task: 'translate' });
      if (r.cls === 'quota') { console.log('agy quota: stopping'); break; }
      text = r.answer || r.text; model = 'gemini-3.8-flash-high';
    } else {
      const r = await claudeCall(prompt);
      if (r.limit) { console.log('usage limit: stopping'); break; }
      text = r.text; model = r.model;
    }
    const v = parseVerdict(text);
    fs.appendFileSync(file, JSON.stringify({ id: it.id, judge: who, model, verdict: v, raw: v ? undefined : String(text).slice(0, 500) }) + '\n');
    console.log(`  ${it.id}: ${v ? `${v.better} (${v.x_fidelity}/${v.y_fidelity})` : 'unparsed'}`);
  }
}

function score() {
  const key = new Map(J(A('key.json')).map((k) => [k.id, k]));
  const report = { judges: {} };
  for (const who of ['opus', 'gemini']) {
    const f = path.join(OUT, ARM ? `verdicts-${ARM}-${who}.jsonl` : `verdicts-${who}.jsonl`);
    if (!fs.existsSync(f)) continue;
    const vs = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.verdict);
    const controls = [], diffs = [], wins = { new: 0, old: 0, tie: 0 }, per = {};
    for (const r of vs) {
      const k = key.get(r.id), v = r.verdict;
      const fid = { [k.X]: Number(v.x_fidelity), [k.Y]: Number(v.y_fidelity) };
      const better = v.better === 'tie' ? 'tie' : k[v.better];
      if (k.kind === 'control') { controls.push(better === 'right' && fid.right > fid.wrong); continue; }
      diffs.push(fid.new - fid.old); wins[better]++; per[k.page_id] = { new: fid.new, old: fid.old, better, reason: v.reason };
    }
    const mean = diffs.reduce((a, b) => a + b, 0) / (diffs.length || 1);
    // Bootstrap 95% interval of the paired mean, seeded.
    const rnd = makeRng(7075);
    const boots = Array.from({ length: 4000 }, () => { let s = 0; for (let i = 0; i < diffs.length; i++) s += diffs[Math.floor(rnd() * diffs.length)]; return s / diffs.length; }).sort((a, b) => a - b);
    report.judges[who] = { n: diffs.length, controls_passed: `${controls.filter(Boolean).length}/${controls.length}`, wins, mean_new_minus_old: +mean.toFixed(2), ci95: [+boots[100].toFixed(2), +boots[3899].toFixed(2)], pages: per };
  }
  const js = Object.values(report.judges);
  report.rule = {
    controls: js.length === 2 && js.every((j) => j.controls_passed.split('/')[0] === j.controls_passed.split('/')[1] && j.controls_passed !== '0/0'),
    non_inferior: js.length === 2 && js.every((j) => j.mean_new_minus_old >= 0),
    by_eye: 'recorded separately (rule 3)',
  };
  W(A('score.json'), report);
  for (const [who, j] of Object.entries(report.judges)) console.log(`${who}: n=${j.n} controls ${j.controls_passed} wins ${JSON.stringify(j.wins)} new−old ${j.mean_new_minus_old} [${j.ci95.join(', ')}]`);
  console.log(`rule: controls ${report.rule.controls}, non-inferior ${report.rule.non_inferior}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!OUT) { console.error('--out=DIR required'); process.exit(2); }
  await ({ draw, packet, judge, score }[STAGE] ?? (() => { console.error('stages: draw | packet | judge | score'); process.exit(2); }))();
}
