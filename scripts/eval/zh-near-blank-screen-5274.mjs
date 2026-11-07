#!/usr/bin/env node
// PRIOR ART: scripts/audit/detect-fabricated-translation.mjs is the #4584 detector — it keys on an OCR DECLINATION
// ("I cannot read…") and this failure has none: the OCR is correct and short (a caption, a title column) and the
// English carries an entry that is not on the leaf. scripts/audit/leaf-shift-confirm-5021.mjs is the image-grounded
// `claude -p --model opus` confirmer this copies its call, env strip and usage-limit classing from; it asks a different
// question (own vs neighbour leaf), so its prompt does not fit.
/**
 * zh-near-blank-screen-5274 — is the English on a near-blank Chinese leaf the leaf's text, or invented? (#5274)
 * Reads Mongo and page images; writes files under --out only. No writes to pages or books.
 *
 * Input: near-blank-candidates.jsonl.gz from PR #8006 (≤ 15 Han characters of OCR body, ≥ 150 English words), one row
 * per page {b, p, cjk, words, om, tm}. Each call carries up to --per-call pages (≤ 4), each with its own image
 * (getPageSource, resized to ≤ 1,100 px), its stored OCR and its stored English (translation.data, or
 * translation_withheld.text where the English has been withheld). The judge sees no prior verdict.
 * Verdict per page: invented | fine | commentary | ocr_dropped, with a one-line reason.
 *
 *   node --env-file=.env.production.local scripts/eval/zh-near-blank-screen-5274.mjs \
 *     --candidates <jsonl.gz> --out <dir> [--controls <jsonl>] [--only-controls] [--per-call 4] [--concurrency 4]
 *   … --out <dir> --report --controls <jsonl> --results-dir scripts/eval/results/zh-near-blank-screen-5274
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { claudeBlocked, noteLimitHit } from '../lib/model-limits.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const OUT = path.resolve(arg('out', `${process.env.JOB_SCRATCH || '/tmp'}/zh-near-blank-screen`));
const PER_CALL = Math.min(4, Number(arg('per-call', '4')));
const CONC = Math.min(4, Number(arg('concurrency', '4')));
const MODEL = arg('model', 'opus');
const TEXT_MAX = 4000;
const VERDICTS = ['invented', 'fine', 'commentary', 'ocr_dropped'];

const USAGE_LIMIT = /usage limit|limit reached|hit your (?:usage )?limit|out of extra usage|rate.?limit|\b429\b|resets? (?:at )?\d/i;
// `claude -p` prefers an API key over the subscription login, and node --env-file loads one: strip it (#6553).
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }

function claudeCall(prompt, cwd) {
  const blocked = claudeBlocked();
  if (blocked) return Promise.resolve({ text: '', cls: 'usage_limit', err: blocked.reason, secs: 0, not_called: true });
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('claude', ['-p', '--model', MODEL, '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {};
      try { j = JSON.parse(out); } catch { /* not JSON */ }
      const text = String(j.result ?? '').trim();
      const failed = j.is_error || code !== 0;
      const cls = failed && USAGE_LIMIT.test(text + out + err) ? 'usage_limit' : code === null ? 'timeout' : failed ? `exit_${code}` : !text ? 'empty' : null;
      if (cls === 'usage_limit') noteLimitHit('claude', { reason: (err || text).slice(-200) });
      resolve({ text, cls, model: Object.keys(j.modelUsage || {})[0] || null, turns: j.num_turns ?? null, err: (err || (failed ? text : '')).slice(-300), secs: (Date.now() - t0) / 1000 });
    });
  });
}

const isImage = (b) => b && b.length > 4 && ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0x52 && b[1] === 0x49) || (b[0] === 0x47 && b[1] === 0x49) || (b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d));
async function fetchLeaf(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 3000) return true;
  if (!url) return false;
  const sharp = (await import('sharp')).default;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'sourcelibrary-eval/5274' }, signal: AbortSignal.timeout(90e3) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 3000 || !isImage(buf)) continue;
      await sharp(buf, { limitInputPixels: false }).rotate().resize({ width: 1100, height: 1100, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(file);
      return true;
    } catch { /* retry */ }
  }
  return false;
}

const clip = (s) => { s = String(s || '').trim(); return s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX)} […]` : s; };

export function buildPrompt(items) {
  const L = [];
  L.push(`You are checking English translations of pages from Chinese books (woodblock prints, encyclopedias, herbals). Each page below is a leaf that our transcription (OCR) found to carry very little text: often only a picture caption, a plant or object name, or a title column. Yet the English stored for it is long. Sometimes that is right: the leaf really is mostly a picture and the English translates the caption and describes the picture, or the OCR missed text that is really printed there. Sometimes it is wrong: the English presents a full text entry (another plant's description, a body section, a table, a quotation) that is NOT printed on this leaf.`);
  L.push('');
  L.push(`For each page you get its scan image file — open EVERY image with the Read tool and look at it carefully; trust the image over the OCR — the OCR, and the English readers are shown.`);
  L.push('');
  for (const it of items) {
    L.push(`=== Page ${it.key} — book "${it.title}" ===`);
    L.push(it.image ? `Image file: ${it.image}` : 'Image: (not available)');
    L.push('OCR of this leaf:');
    L.push('<<<');
    L.push(clip(it.ocr) || '(empty)');
    L.push('>>>');
    L.push('English shown for this leaf:');
    L.push('<<<');
    L.push(clip(it.tr));
    L.push('>>>');
    L.push('');
  }
  L.push(`For EACH page, give exactly one verdict:`);
  L.push(`- invented: the English presents source text that is NOT on this leaf — an entry, a body section, a table, a list, a quotation, offered as the translation of this page, when the leaf shows only a caption/title/picture. A note such as "continues from the previous page" is not enough by itself; invented body text is.`);
  L.push(`- fine: the English renders what is on the leaf. That includes a translated caption plus a description of the picture, a translated image description, a translation of text that is visibly printed on the leaf, or English that is itself printed on the leaf (bilingual editions).`);
  L.push(`- commentary: the English is a glossary, notes or explanation only; it does not claim any source text beyond what is on the leaf.`);
  L.push(`- ocr_dropped: the leaf visibly carries substantial text that the OCR left out, and the English translates that text from the leaf. This takes precedence over "fine": when the English is right but the OCR above is missing columns of text that are printed on the leaf (not just a stray header or seal), answer ocr_dropped.`);
  L.push(`Decide by comparing the English against what you can SEE on the leaf: count roughly how many characters/columns of text the leaf carries, and ask whether the English could be a rendering of them. A picture leaf with a two-character caption cannot yield three paragraphs of translated prose.`);
  L.push(`Reason: ONE line naming what the English claims (e.g. "a full entry on the plant's flavour and uses") and what the leaf shows (e.g. "a woodcut with a 3-character caption").`);
  L.push('');
  L.push(`Answer with JSON only, no code fence: {"pages":[{"page":"<page id as given>","verdict":"invented|fine|commentary|ocr_dropped","reason":"..."}]}`);
  return L.join('\n');
}

function parseVerdicts(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { const j = JSON.parse(text.slice(a, b + 1)); return Array.isArray(j.pages) ? j.pages : null; } catch { return null; }
}

const keyOf = (b, p) => `${b}:${p}`;

export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

/** The book family a reader would name; the families the brief asks for, then "other". */
export function familyOf(title) {
  const t = String(title || '');
  if (/三才圖會|Sancai/i.test(t)) return '三才圖會';
  if (/本草綱目|Ben ?cao gang ?mu/i.test(t)) return '本草綱目';
  if (/植物名實圖考/.test(t)) return '植物名實圖考';
  if (/武備志/.test(t)) return '武備志';
  if (/道德經/.test(t)) return '道德經';
  if (/論語|孟子|Chinese Classics|The Chinese /i.test(t)) return 'Legge Chinese Classics';
  if (/名山圖/.test(t)) return '名山圖';
  return 'other';
}

// --report: results.jsonl → verdicts.jsonl, withhold-candidates.tsv, reocr-candidates.tsv, summary.json (into --results-dir).
async function report(resultsFile, controls) {
  const dir = path.resolve(arg('results-dir', OUT));
  fs.mkdirSync(dir, { recursive: true });
  const rows = fs.readFileSync(resultsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => VERDICTS.includes(r.verdict));
  const { MongoClient, ObjectId } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
  await client.connect();
  const ids = [...new Set(rows.map((r) => r.book_id))];
  const books = await client.db(process.env.MONGODB_DB || 'bookstore').collection('books').find({ $or: [{ id: { $in: ids } }, { _id: { $in: ids.filter((i) => /^[0-9a-f]{24}$/i.test(i)).map((i) => new ObjectId(i)) } }] }, { projection: { id: 1, title: 1 } }).toArray();
  await client.close();
  const title = new Map(books.map((b) => [b.id || String(b._id), b.title]));
  rows.sort((a, b) => (a.book_id < b.book_id ? -1 : a.book_id > b.book_id ? 1 : a.page_number - b.page_number));
  fs.writeFileSync(path.join(dir, 'verdicts.jsonl'), rows.map((r) => JSON.stringify({ book_id: r.book_id, page_number: r.page_number, verdict: r.verdict, reason: r.reason, translation_model: r.translation_model, ocr_model: r.ocr_model, withheld_before: r.withheld, family: familyOf(title.get(r.book_id)) })).join('\n') + '\n');
  const tsv = (xs) => 'book_id\tpage_number\n' + xs.map((r) => `${r.book_id}\t${r.page_number}`).join('\n') + '\n';
  const withhold = rows.filter((r) => r.verdict === 'invented' && !r.withheld);
  fs.writeFileSync(path.join(dir, 'withhold-candidates.tsv'), tsv(withhold));
  fs.writeFileSync(path.join(dir, 'reocr-candidates.tsv'), tsv(rows.filter((r) => r.verdict === 'ocr_dropped')));
  const tab = (keyFn) => {
    const m = {};
    for (const r of rows) { const k = keyFn(r); m[k] ||= { n: 0, books: new Set(), ...Object.fromEntries(VERDICTS.map((v) => [v, 0])) }; m[k].n++; m[k][r.verdict]++; m[k].books.add(r.book_id); }
    return Object.fromEntries(Object.entries(m).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [k, { ...v, books: v.books.size, invented_rate: +(v.invented / v.n).toFixed(3), invented_ci95: wilson(v.invented, v.n).map((x) => +x.toFixed(3)) }]));
  };
  const ctlKey = new Map(controls.map((c) => [keyOf(c.book_id, c.page_number), c.verdict]));
  const ctl = rows.filter((r) => ctlKey.has(keyOf(r.book_id, r.page_number))).map((r) => ({ book_id: r.book_id, page_number: r.page_number, by_eye: ctlKey.get(keyOf(r.book_id, r.page_number)), opus: r.verdict }));
  const summary = {
    n: rows.length, books: ids.length,
    by_verdict: Object.fromEntries(VERDICTS.map((v) => { const k = rows.filter((r) => r.verdict === v).length; return [v, { k, rate: +(k / rows.length).toFixed(3), ci95: wilson(k, rows.length).map((x) => +x.toFixed(3)) }]; })),
    withhold_candidates: withhold.length, withhold_books: new Set(withhold.map((r) => r.book_id)).size,
    reocr_candidates: rows.filter((r) => r.verdict === 'ocr_dropped').length,
    predicate_undercount: rows.filter((r) => r.ocr_han > 30).length,
    by_translation_model: tab((r) => r.translation_model || '?'),
    by_family: tab((r) => familyOf(title.get(r.book_id))),
    controls_in_place: { agree: ctl.filter((c) => c.by_eye === c.opus).length, n: ctl.length, rows: ctl },
  };
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  console.log(JSON.stringify({ ...summary, by_translation_model: undefined, by_family: undefined, controls_in_place: undefined }, null, 1));
  for (const [name, t] of [['translation model', summary.by_translation_model], ['family', summary.by_family]]) {
    console.log(`\n| ${name} | pages | books | invented | fine | commentary | ocr_dropped | invented rate (95% CI) |\n|---|---|---|---|---|---|---|---|`);
    for (const [k, v] of Object.entries(t)) console.log(`| ${k} | ${v.n} | ${v.books} | ${v.invented} | ${v.fine} | ${v.commentary} | ${v.ocr_dropped} | ${(v.invented_rate * 100).toFixed(0)}% (${(v.invented_ci95[0] * 100).toFixed(0)}–${(v.invented_ci95[1] * 100).toFixed(0)}) |`);
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const resultsFile = path.join(OUT, 'results.jsonl');
  if (argv.includes('--report')) return report(resultsFile, arg('controls') ? fs.readFileSync(arg('controls'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  let cands = zlib.gunzipSync(fs.readFileSync(arg('candidates'))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const controls = arg('controls') ? fs.readFileSync(arg('controls'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  if (argv.includes('--only-controls')) {
    const want = new Set(controls.map((c) => keyOf(c.book_id, c.page_number)));
    cands = cands.filter((c) => want.has(keyOf(c.b, c.p)));
    for (const c of controls) if (!cands.some((x) => x.b === c.book_id && x.p === c.page_number)) cands.push({ b: c.book_id, p: c.page_number });
  }
  const done = new Set();
  if (fs.existsSync(resultsFile)) for (const l of fs.readFileSync(resultsFile, 'utf8').split('\n')) {
    if (!l) continue; const j = JSON.parse(l); if (VERDICTS.includes(j.verdict) || j.cls === 'no_english' || j.cls === 'no_page') done.add(keyOf(j.book_id, j.page_number));
  }
  // Group by book (adjacent pages of one book share a call), then chunk.
  const queue0 = cands.filter((c) => !done.has(keyOf(c.b, c.p))).sort((x, y) => (x.b < y.b ? -1 : x.b > y.b ? 1 : x.p - y.p));
  const batches = [];
  for (let i = 0; i < queue0.length; i += PER_CALL) batches.push(queue0.slice(i, i + PER_CALL));
  console.error(`${cands.length} candidates, ${done.size} done, ${queue0.length} left in ${batches.length} calls`);
  if (argv.includes('--plan')) return;
  if (!spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout) throw new Error('claude CLI not on PATH');

  const { MongoClient, ObjectId } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred', maxPoolSize: 6 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const titles = new Map();
  const titleOf = async (id) => {
    if (titles.has(id)) return titles.get(id);
    const or = [{ id }]; if (/^[0-9a-f]{24}$/i.test(id)) or.push({ _id: new ObjectId(id) });
    const b = await db.collection('books').findOne({ $or: or }, { projection: { title: 1 } });
    titles.set(id, String(b?.title || '').slice(0, 120)); return titles.get(id);
  };
  let stop = false, n = 0;
  const worker = async () => {
    for (let batch = batches.shift(); batch && !stop; batch = batches.shift()) {
      const dir = path.join(OUT, 'calls', `${batch[0].b}-${batch[0].p}`);
      fs.mkdirSync(dir, { recursive: true });
      const items = [];
      for (const c of batch) {
        const page = await db.collection('pages').findOne({ book_id: c.b, page_number: c.p },
          { projection: { page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'translation.data': 1, 'translation.model': 1, translation_withheld: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1 } });
        const base = { book_id: c.b, page_number: c.p };
        if (!page) { fs.appendFileSync(resultsFile, JSON.stringify({ ...base, cls: 'no_page' }) + '\n'); continue; }
        const live = String(page.translation?.data || '').trim();
        const withheld = String(page.translation_withheld?.text || '').trim();
        const tr = live || withheld;
        const meta = { ...base, withheld: !live && !!withheld, translation_model: page.translation?.model || page.translation_withheld?.model || c.tm || null, ocr_model: page.ocr?.model || c.om || null, cjk: c.cjk ?? null, words: c.words ?? null,
          // The predicate's count, re-measured on the whole stored OCR: a gap means the predicate read less than the OCR holds.
          ocr_han: (String(page.ocr?.data || '').match(/\p{Script=Han}/gu) || []).length };
        if (!tr) { fs.appendFileSync(resultsFile, JSON.stringify({ ...meta, cls: 'no_english' }) + '\n'); continue; }
        const img = `${c.b}_${c.p}.jpg`;
        const got = await fetchLeaf(getPageSource(page), path.join(dir, img));
        items.push({ key: `${c.b}/${c.p}`, title: await titleOf(c.b), image: got ? img : null, ocr: page.ocr?.data || '', tr, meta });
      }
      if (!items.length) continue;
      const prompt = buildPrompt(items);
      fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);
      const r = await claudeCall(prompt, dir);
      const vs = r.cls ? null : parseVerdicts(r.text);
      for (const it of items) {
        const v = vs?.find((x) => String(x.page) === it.key);
        const verdict = VERDICTS.includes(v?.verdict) ? v.verdict : null;
        fs.appendFileSync(resultsFile, JSON.stringify({ ...it.meta, image: !!it.image, verdict, reason: v?.reason || null, cls: r.cls || (verdict ? null : 'unparsed'), judge: r.model, turns: r.turns, secs: r.secs, ...(verdict ? {} : { raw: String(r.text).slice(0, 800), err: r.err }) }) + '\n');
      }
      if (r.cls === 'usage_limit') { stop = true; console.error('usage limit: stopping; re-run to resume'); }
      if (++n % 10 === 0) console.error(`  ${n} calls, ${batches.length} left`);
    }
  };
  try { await Promise.all(Array.from({ length: CONC }, worker)); } finally { await client.close(); }
  console.error(`DONE ${n} calls${stop ? ' (stopped on usage limit)' : ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
