#!/usr/bin/env node
// PRIOR ART: scripts/eval/tibetan-correct-6560/pass/leafcheck.mjs (the #6560 leaf read-off: sealed Opus with the image
// and full-resolution tiles, known-answer controls; it asks A/B questions about OCR spans, not a translation audit);
// scripts/eval/tib-stored-6948/build-packet.py (blind judge packets with planted reversals for the stored-English test;
// text only, no image, scores 1-5). Neither audits a NEW translation against the leaf AND counts the OCR's visible
// errors on the same page. The calls run through scripts/eval/replicate-6547/run-claude-arm.py (sealed, Read only).
/**
 * audit.mjs — the blind, image-grounded audit for job opus-tib-sa-6948 (#6948). No model call here except `plant`.
 *
 *   plant   --items=I.json --out=PLANTS.json
 *       I.json: [{uid, page_id, lang, kind: reversal|invention, read_dir}]. One sealed text-only `claude -p --model opus`
 *       call per item writes the plant (a reversed sentence, or an invented sentence and where it goes); the planted
 *       English is checked to differ from the read in exactly that sentence.
 *   packet  --items=A.json [--plants=PLANTS.json] --req=REQ.jsonl --key=KEY.json [--seed=6948]
 *       A.json: [{uid, page_id, lang, read_dir}]. Fetches each page's image (photo_original, else photo, else
 *       archived_photo), writes page.jpg (≤1568 px) and full-resolution tiles, and one request per page in random order:
 *       the transcription (stored OCR) and the English (the read, or the planted English for a control). uids are opaque.
 *   score   --key=KEY.json --replies=OUT.jsonl [--out=S.json]
 *       Verdicts per page, bad rates by language and arm with Wilson intervals, OCR spans per page, controls caught.
 *
 *   node --env-file=.env.production.local scripts/eval/opus-tib-sa-6948/audit.mjs packet --items=... --req=... --key=...
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { rng, shuffle } from './sample.mjs';

const CMD = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const S = process.env.JOB_SCRATCH;
const readOf = (dir, id) => fs.readFileSync(path.join(dir, `${id}.txt`), 'utf8').trim();

export const LANG = { bo: { name: 'Tibetan', script: 'Tibetan (Uchen)' }, sa: { name: 'Sanskrit', script: 'the script of the leaf (Devanagari or other Indic script)' } };

export function auditPrompt(lang, tiles, ocr, english) {
  const L = LANG[lang];
  return `You are auditing one page of a digital library edition of a ${L.name} text. You have:
1. The page image: ./page.jpg (the whole page, reduced) and ${tiles.length} full-resolution tile${tiles.length === 1 ? '' : 's'} of it: ${tiles.map((t) => `./${t}`).join(', ')} (tile names give row and column, read left to right, top to bottom; neighbouring tiles overlap a little).
2. The TRANSCRIPTION stored for this page (machine OCR).
3. The ENGLISH stored for this page (a machine translation of the transcription).
Open the page image and every tile with the Read tool before you answer.

Check two things.

A. THE ENGLISH, against the transcription (and against the leaf where the two differ). Report every instance of:
- reversal: the English says the opposite of the source (a negation added or dropped, who does what to whom swapped, a prohibition made a command, praise made blame).
- invention: English with no basis in the transcription or the leaf (an added sentence, name, list item, number or claim).
- omission: a passage of the source (a clause or more) with no English.
- wrong_leaf: English for text that is not on this page (another page's text, or text carried across the page edge beyond finishing a sentence the edge cut).
- untranslated: source-language words or passages left untranslated (mantras, dhāraṇī syllables and proper names given in transliteration are fine).
- chatter: notes to the reader, apologies, or talk about the task in place of translation (a short bracketed clarification is fine).
Then one verdict: "usable" (a reader can rely on it), "usable-with-caveat" (small errors that do not change the sense), or "bad" (any reversal, invention or wrong-leaf text, or an omission or error that would mislead a reader).

B. THE TRANSCRIPTION, against the leaf. List every span where the leaf visibly reads differently from the transcription: a wrong letter or vowel sign, a syllable dropped or added, a line skipped or repeated. For each give the line on the leaf (counted from the top), the transcription's reading and the leaf's reading in ${L.script} Unicode. Judge only by what is written on this leaf, not by what the text ought to say. List at most 40; if there are more, set "more": true. If the image is too small, faint or damaged to tell, set "legible": false and say so, rather than guessing.

Reply with ONE JSON object between a line <<<BEGIN>>> and a line <<<END>>>, and nothing outside them:
{"translation": {"reversal": [{"english": "<exact words of the English>", "source": "<what the source says>"}], "invention": [{"english": "<exact words>"}], "omission": [{"source": "<the passage>"}], "wrong_leaf": [{"english": "<exact words>", "note": "<why>"}], "untranslated": [{"english": "<exact words>"}], "chatter": [{"english": "<exact words>"}], "verdict": "usable|usable-with-caveat|bad", "note": "<one sentence>"},
 "ocr": {"legible": true, "spans": [{"line": 1, "transcription": "<as transcribed>", "leaf": "<as on the leaf>", "kind": "letter|vowel|syllable_dropped|syllable_added|line_skipped|line_repeated|other"}], "more": false, "note": "<one sentence>"}}

TRANSCRIPTION:
${ocr}

ENGLISH:
${english}`;
}

// ── pilot-items ──────────────────────────────────────────────────────────────────────────────────────────────
// --pilot=pilot.json --reads=DIR (holds <arm>/) --out-audit=A.json --out-controls=I.json [--bo-controls=10 --sa-controls=5]
// One audit item per book: its drawn audit page if it was read, else the first read page of its block (a page the
// reader refused — an OCR loop, a soft-hidden page — has nothing to audit). Controls: read pages that are NOT audit
// pages, one per book where possible, seeded; the first two-thirds of each language's controls are reversals.
const isRead = (dir, id) => { try { return JSON.parse(fs.readFileSync(path.join(dir, `${id}.meta.json`), 'utf8')).exit === 0 && readOf(dir, id).length > 5; } catch { return false; } };
if (CMD === 'pilot-items') {
  const { pilot } = JSON.parse(fs.readFileSync(arg('pilot'), 'utf8'));
  const R = arg('reads'), r = rng(69480);
  const audit = [], spare = { bo: [], sa: [] };
  let u = 0;
  for (const b of pilot) {
    const dir = path.join(R, b.arm);
    const read = b.pages.filter((p) => isRead(dir, p.id));
    if (!read.length) { console.log(`  ${b.lang} ${b.book_id}: no page read (${b.pages.length} in block); not audited`); continue; }
    const pick = read.find((p) => p.id === b.audit_page_id) || read[0];
    audit.push({ uid: `a${String(++u).padStart(3, '0')}`, page_id: pick.id, lang: b.lang, arm: b.arm, stratum: b.stratum, book_id: b.book_id, read_dir: dir, drawn: pick.id === b.audit_page_id });
    for (const p of read) if (p.id !== pick.id) spare[b.lang].push({ page_id: p.id, lang: b.lang, arm: b.arm, book_id: b.book_id, read_dir: dir });
  }
  const controls = [];
  for (const [lang, n] of [['bo', Number(arg('bo-controls') || 10)], ['sa', Number(arg('sa-controls') || 5)]]) {
    const pool = shuffle(spare[lang].filter((x) => readOf(x.read_dir, x.page_id).length > 400), r);
    const seen = new Set(), picked = [];
    for (const x of pool) if (!seen.has(x.book_id) && picked.length < n) { seen.add(x.book_id); picked.push(x); }
    for (const x of pool) if (picked.length < n && !picked.includes(x)) picked.push(x);
    picked.forEach((x, i) => controls.push({ ...x, uid: `c${lang}${i + 1}`, kind: i < Math.round(n * 2 / 3) ? 'reversal' : 'invention' }));
  }
  fs.writeFileSync(arg('out-audit'), JSON.stringify(audit, null, 1));
  fs.writeFileSync(arg('out-controls'), JSON.stringify(controls, null, 1));
  console.log(`audit ${audit.length} (bo ${audit.filter((a) => a.lang === 'bo').length}, sa ${audit.filter((a) => a.lang === 'sa').length}; ${audit.filter((a) => !a.drawn).length} not the drawn page); controls ${controls.length}: ${controls.map((c) => `${c.uid}:${c.kind}`).join(' ')}`);
}

// ── plant ────────────────────────────────────────────────────────────────────────────────────────────────────
const PLANT = {
  reversal: 'Below is an English translation of one page. Choose ONE sentence (or clause of at least eight words) whose meaning is clear, and rewrite it so that it says the opposite: flip a negation, swap who does what to whom, or turn a prohibition into a command. Keep its length and style so that it reads naturally in place. Reply with one JSON object and nothing else: {"original": "<the sentence, copied exactly, character for character>", "planted": "<the rewritten sentence>"}',
  invention: 'Below is an English translation of one page. Write ONE new sentence, of twelve to twenty-five words, in the same style and on the same subject, that states something this text does not say (a new claim, name, number or instruction), so that it would pass unnoticed by a reader. Choose the sentence of the text after which it goes. Reply with one JSON object and nothing else: {"after": "<a sentence of the text, copied exactly, character for character>", "planted": "<the new sentence>"}',
};
function claudeText(prompt) {
  const env = { ...process.env }; for (const k of Object.keys(env)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_/.test(k)) delete env[k];
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'plant-'));
  const r = spawnSync('claude', ['-p', '--model', 'opus', '--restricted', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { input: prompt, cwd, env, encoding: 'utf8', timeout: 600e3 });
  fs.rmSync(cwd, { recursive: true, force: true });
  try { return JSON.parse(r.stdout).result || ''; } catch { return ''; }
}
if (CMD === 'plant') {
  const items = JSON.parse(fs.readFileSync(arg('items'), 'utf8'));
  const outF = arg('out');
  const plants = fs.existsSync(outF) ? JSON.parse(fs.readFileSync(outF, 'utf8')) : {};
  for (const it of items) {
    if (plants[it.uid]?.english) continue;
    const text = readOf(it.read_dir, it.page_id);
    for (let t = 0; t < 3 && !plants[it.uid]?.english; t++) {
      const reply = claudeText(`${PLANT[it.kind]}\n\nTEXT:\n${text}`);
      let j; try { j = JSON.parse(reply.replace(/^```\w*\s*|\s*```$/g, '')); } catch { console.log(`  ${it.uid} unparsed reply`); continue; }
      const anchor = it.kind === 'reversal' ? j.original : j.after;
      if (!anchor || !j.planted || !text.includes(anchor) || text.indexOf(anchor) !== text.lastIndexOf(anchor)) { console.log(`  ${it.uid} anchor not found once`); continue; }
      const english = it.kind === 'reversal' ? text.replace(anchor, j.planted) : text.replace(anchor, `${anchor} ${j.planted}`);
      plants[it.uid] = { ...it, anchor, planted: j.planted, english };
      fs.writeFileSync(outF, JSON.stringify(plants, null, 1));
      console.log(`  ${it.uid} ${it.kind}: ${j.planted.slice(0, 90)}`);
    }
  }
  console.log(`${Object.values(plants).filter((p) => p.english).length} of ${items.length} planted`);
}

// ── attribute ────────────────────────────────────────────────────────────────────────────────────────────────
// --key=KEY.json --replies=OUT.jsonl --req=REQ.jsonl --out=ATTR.json
// For every audited page the auditor called bad: a sealed text-only Opus call is given the transcription, the English
// and the auditor's flagged items (reversal / invention / wrong_leaf / omission), and says for each whether the English
// renders what the TRANSCRIPTION says (the defect is the OCR's: the leaf differs from the transcription) or departs from
// the transcription (the defect is the translator's). No image: this question is about two texts only.
const ATTR = `Below are a machine transcription of one manuscript or printed page, an English translation made from that transcription, and a list of problems an auditor found by comparing the English with the page IMAGE. For each problem, decide only this: does the English at that point faithfully render what the TRANSCRIPTION says (so the problem comes from the transcription differing from the page), or does the English depart from the transcription (the translator added, dropped, reversed or garbled something the transcription does not support)?

Reply with one JSON object and nothing else: {"items": [{"n": <problem number>, "cause": "transcription" | "translation" | "both" | "unclear", "why": "<one sentence>"}]}`;
if (CMD === 'attribute') {
  const key = JSON.parse(fs.readFileSync(arg('key'), 'utf8'));
  const reqs = new Map(readJsonl(arg('req')).map((r) => [r.uid, r]));
  const outF = arg('out');
  const res = fs.existsSync(outF) ? JSON.parse(fs.readFileSync(outF, 'utf8')) : {};
  for (const r of readJsonl(arg('replies'))) {
    const k = key[r.uid];
    if (!k || k.control || res[r.uid]) continue;
    const v = parseReply(r.text);
    if (v?.translation?.verdict !== 'bad') continue;
    const flagged = ['reversal', 'invention', 'wrong_leaf', 'omission'].flatMap((c) => (v.translation[c] || []).map((x) => ({ kind: c, ...x })));
    if (!flagged.length) { res[r.uid] = { items: [], flagged: [] }; continue; }
    const q = reqs.get(r.uid).prompt;
    const ocr = q.split('TRANSCRIPTION:\n')[1].split('\n\nENGLISH:\n')[0], en = q.split('\n\nENGLISH:\n')[1];
    const list = flagged.map((x, i) => `${i + 1}. ${x.kind}: ${JSON.stringify(x)}`).join('\n');
    const reply = claudeText(`${ATTR}\n\nTRANSCRIPTION:\n${ocr}\n\nENGLISH:\n${en}\n\nPROBLEMS:\n${list}`);
    let j = null; try { j = JSON.parse(reply.replace(/^```\w*\s*|\s*```$/g, '')); } catch { /* recorded as unparsed */ }
    res[r.uid] = { items: j?.items || null, flagged, raw: j ? undefined : reply.slice(0, 500) };
    fs.writeFileSync(outF, JSON.stringify(res, null, 1));
    console.log(`  ${r.uid}: ${(j?.items || []).map((x) => x.cause).join(',') || 'unparsed'}`);
  }
}

// ── packet ───────────────────────────────────────────────────────────────────────────────────────────────────
/** JPEG, PNG, WebP, TIFF or GIF by magic bytes (a provider "image" URL can serve a PDF). */
const isImage = (b) => (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50) || (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') || (b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d) || b.slice(0, 3).toString() === 'GIF';
async function fetchImage(page, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 5000 && isImage(fs.readFileSync(file).subarray(0, 16))) return 'cached';
  for (const f of ['photo_original', 'photo', 'archived_photo']) {
    const url = page[f];
    if (!url || !/^https?:/.test(url)) continue;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'sourcelibrary-audit/6948' }, signal: AbortSignal.timeout(120e3) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 5000 || !isImage(buf)) continue;
      fs.writeFileSync(file, buf);
      return f;
    } catch { /* next field */ }
  }
  return null;
}
/** page.jpg ≤ 1568 px and tiles of ≤ ~1300 px with 8% overlap, at most 4 columns × 3 rows. */
async function tile(src, dir, { pageOnly = false } = {}) {
  const sharp = (await import('sharp')).default;
  const img = sharp(src, { limitInputPixels: false }).rotate();
  const { width: W, height: H } = await img.metadata();
  await sharp(src, { limitInputPixels: false }).rotate().resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(path.join(dir, 'page.jpg'));
  if (pageOnly) return { W, H, tiles: [] };
  const cols = Math.min(4, Math.max(1, Math.ceil(W / 1300))), rows = Math.min(3, Math.max(1, Math.ceil(H / 1300)));
  const tiles = [];
  if (cols * rows === 1) return { W, H, tiles };
  const tw = Math.ceil(W / cols), th = Math.ceil(H / rows), ox = Math.round(tw * 0.08), oy = Math.round(th * 0.08);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const left = Math.max(0, c * tw - ox), top = Math.max(0, r * th - oy);
    const width = Math.min(W - left, tw + 2 * ox), height = Math.min(H - top, th + 2 * oy);
    const name = `tile-r${r + 1}c${c + 1}.jpg`;
    await sharp(src, { limitInputPixels: false }).rotate().extract({ left, top, width, height }).resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(path.join(dir, name));
    tiles.push(name);
  }
  return { W, H, tiles };
}
/**
 * A IIIF image whose server caps the whole-image size (the British Library serves 1,200 px of a 4,752 px leaf) still
 * serves a REGION at native resolution, so the tiles are fetched as regions of ≤ 1,600 px. Returns null if not IIIF.
 */
async function iiifTiles(url, dir) {
  const m = /^(https?:\/\/.+?)\/full\/[^/]+\/0\/default\.jpg$/.exec(url || '');
  if (!m) return null;
  let info;
  for (let t = 0; t < 4 && !info; t++) {
    try { const r = await fetch(`${m[1]}/info.json`, { headers: { 'User-Agent': 'sourcelibrary-audit/6948' }, signal: AbortSignal.timeout(60e3) }); if (r.ok) info = await r.json(); } catch { /* retry */ }
    if (!info) await new Promise((res) => setTimeout(res, 3000 * (t + 1)));
  }
  if (!info) { console.log(`  IIIF info.json unreachable for ${m[1]}: tiles cut from the fetched image`); return null; }
  const W = info.width, H = info.height;
  if (!W || !H || Math.max(W, H) <= 1600) return null;
  const cols = Math.min(4, Math.ceil(W / 1600)), rows = Math.min(3, Math.ceil(H / 1600));
  const tw = Math.ceil(W / cols), th = Math.ceil(H / rows), ox = Math.round(tw * 0.06), oy = Math.round(th * 0.06);
  const tiles = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = Math.max(0, c * tw - ox), y = Math.max(0, r * th - oy), w = Math.min(W - x, tw + 2 * ox), h = Math.min(H - y, th + 2 * oy);
    const name = `tile-r${r + 1}c${c + 1}.jpg`, f = path.join(dir, name);
    if (!(fs.existsSync(f) && fs.statSync(f).size > 5000)) {
        let buf = null;
      for (let t = 0; t < 3 && !buf; t++) {
        try { const res = await fetch(`${m[1]}/${x},${y},${w},${h}/${Math.min(w, 1568)},/0/default.jpg`, { headers: { 'User-Agent': 'sourcelibrary-audit/6948' }, signal: AbortSignal.timeout(120e3) }); if (res.ok) buf = Buffer.from(await res.arrayBuffer()); } catch { /* retry */ }
      }
      if (!buf || !isImage(buf)) { console.log(`  IIIF region failed for ${m[1]}: tiles cut from the fetched image`); return null; }
      fs.writeFileSync(f, buf);
    }
    tiles.push(name);
  }
  return { W, H, tiles, iiif: true };
}
if (CMD === 'packet') {
  const items = JSON.parse(fs.readFileSync(arg('items'), 'utf8'));
  const plants = arg('plants') ? JSON.parse(fs.readFileSync(arg('plants'), 'utf8')) : {};
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const all = [...items, ...Object.values(plants).filter((p) => p.english).map((p) => ({ ...p, control: p.kind }))];
  const pages = new Map((await db.collection('pages').find({ id: { $in: all.map((x) => x.page_id) } }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, photo: 1, photo_original: 1, archived_photo: 1 } }).toArray()).map((p) => [p.id, p]));
  const imgRoot = path.join(S, 'images');
  const reqs = [], key = {};
  for (const it of all) {
    const p = pages.get(it.page_id);
    if (!p) { console.log(`  ${it.uid}: page not found`); continue; }
    const dir = path.join(imgRoot, it.page_id);
    fs.mkdirSync(dir, { recursive: true });
    const raw = path.join(dir, 'raw.img');
    const got = await fetchImage(p, raw);
    if (!got) { console.log(`  ${it.uid}: no image`); key[it.uid] = { ...it, english: undefined, no_image: true }; continue; }
    let t;
    try {
      const it3 = await iiifTiles(p.photo_original || p.photo, path.join(dir));
      t = await tile(raw, dir, { pageOnly: !!it3 });
      if (it3) t = it3;
    } catch (e) { console.log(`  ${it.uid}: tile failed ${e.message}`); key[it.uid] = { ...it, english: undefined, no_image: true }; continue; }
    const english = it.control ? it.english : readOf(it.read_dir, it.page_id);
    reqs.push({ uid: it.uid, prompt: auditPrompt(it.lang, t.tiles, p.ocr.data, english), image: path.join(dir, 'page.jpg'), extra_images: t.tiles.map((x) => path.join(dir, x)) });
    key[it.uid] = { uid: it.uid, page_id: it.page_id, book_id: p.book_id, page_number: p.page_number, lang: it.lang, arm: it.arm || null, stratum: it.stratum || null, control: it.control || null, anchor: it.anchor || null, planted: it.planted || null, image_from: got, W: t.W, H: t.H, tiles: t.tiles.length, ocr_chars: p.ocr.data.length, english_chars: english.length };
  }
  shuffle(reqs, rng(Number(arg('seed') || 6948)));
  fs.writeFileSync(arg('req'), reqs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(arg('key'), JSON.stringify(key, null, 1));
  console.log(`${reqs.length} requests (${reqs.filter((r) => key[r.uid].control).length} controls); ${Object.values(key).filter((k) => k.no_image).length} pages with no image`);
  await c.close();
}

// ── score ────────────────────────────────────────────────────────────────────────────────────────────────────
export function parseReply(text) {
  const m = /<<<BEGIN>>>\s*([\s\S]*?)\s*<<<END>>>/.exec(text || '');
  const body = (m ? m[1] : text || '').replace(/^```\w*\s*|\s*```$/g, '');
  try { return JSON.parse(body); } catch { const b = body.indexOf('{'), e = body.lastIndexOf('}'); try { return JSON.parse(body.slice(b, e + 1)); } catch { return null; } }
}
export function wilson(k, n, z = 1.96) {
  if (!n) return [null, null];
  const p = k / n, d = 1 + z * z / n, ctr = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, ctr - h), Math.min(1, ctr + h)];
}
const words = (s) => String(s || '').toLowerCase().match(/[a-zÀ-ɏḀ-ỿ']+/g) || [];
/** Did the auditor point at the planted sentence? Some flagged English shares ≥ half its words with it (and ≥ 3). */
export function caught(v, planted) {
  const pw = new Set(words(planted));
  const flagged = ['reversal', 'invention', 'wrong_leaf'].flatMap((k) => (v?.translation?.[k] || []).map((x) => x.english || ''));
  return flagged.some((f) => { const fw = words(f); const hit = fw.filter((w) => pw.has(w)).length; return hit >= 3 && hit >= 0.5 * Math.min(fw.length, pw.size); });
}
if (CMD === 'score') {
  const key = JSON.parse(fs.readFileSync(arg('key'), 'utf8'));
  const replies = new Map(readJsonl(arg('replies')).filter((r) => r.text).map((r) => [r.uid, r]));
  const rows = [];
  for (const k of Object.values(key)) {
    if (k.no_image) continue;
    const r = replies.get(k.uid);
    const v = r ? parseReply(r.text) : null;
    const t = v?.translation || {};
    const n = (x) => (Array.isArray(t[x]) ? t[x].length : 0);
    rows.push({ ...k, answered: !!r, parsed: !!v, verdict: t.verdict || null, reversal: n('reversal'), invention: n('invention'), omission: n('omission'), wrong_leaf: n('wrong_leaf'), untranslated: n('untranslated'), chatter: n('chatter'), note: t.note || null,
      ocr_legible: v?.ocr?.legible ?? null, ocr_spans: Array.isArray(v?.ocr?.spans) ? v.ocr.spans.length : null, ocr_more: !!v?.ocr?.more, ocr_note: v?.ocr?.note || null,
      caught: k.control ? caught(v, k.planted) : null, flagged: k.control ? null : undefined, secs: r?.secs ?? null });
  }
  const real = rows.filter((r) => !r.control && r.parsed), ctl = rows.filter((r) => r.control);
  const rate = (xs, f) => { const k = xs.filter(f).length; const [lo, hi] = wilson(k, xs.length); return { k, n: xs.length, rate: xs.length ? +(k / xs.length).toFixed(3) : null, ci95: [lo && +lo.toFixed(3), hi && +hi.toFixed(3)] }; };
  const group = (xs, by) => Object.fromEntries([...new Set(xs.map(by))].sort().map((g) => [g, xs.filter((x) => by(x) === g)]));
  const summarise = (xs) => ({
    bad: rate(xs, (r) => r.verdict === 'bad'), caveat: rate(xs, (r) => r.verdict === 'usable-with-caveat'), usable: rate(xs, (r) => r.verdict === 'usable'),
    with_reversal: rate(xs, (r) => r.reversal > 0), with_invention: rate(xs, (r) => r.invention > 0), with_wrong_leaf: rate(xs, (r) => r.wrong_leaf > 0), with_omission: rate(xs, (r) => r.omission > 0), with_untranslated: rate(xs, (r) => r.untranslated > 0), with_chatter: rate(xs, (r) => r.chatter > 0),
    ocr: (() => { const l = xs.filter((r) => r.ocr_legible !== false && r.ocr_spans != null); const s = l.map((r) => r.ocr_spans).sort((a, b) => a - b); return { pages_legible: l.length, illegible: xs.length - l.length, spans_per_page_mean: s.length ? +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2) : null, median: s.length ? s[Math.floor(s.length / 2)] : null, pages_with_0: s.filter((x) => x === 0).length, pages_capped_40: l.filter((r) => r.ocr_more).length }; })(),
  });
  const out = {
    pages: rows.filter((r) => !r.control).length, answered_parsed: real.length, unparsed: rows.filter((r) => !r.control && !r.parsed).map((r) => r.uid),
    by_lang: Object.fromEntries(Object.entries(group(real, (r) => r.lang)).map(([g, xs]) => [g, summarise(xs)])),
    by_arm: Object.fromEntries(Object.entries(group(real, (r) => r.arm || '-')).map(([g, xs]) => [g, summarise(xs)])),
    by_stratum: Object.fromEntries(Object.entries(group(real.filter((r) => r.lang === 'bo'), (r) => r.stratum || '-')).map(([g, xs]) => [g, summarise(xs)])),
    controls: { n: ctl.length, caught: ctl.filter((r) => r.caught).length, by_kind: Object.fromEntries(Object.entries(group(ctl, (r) => r.control)).map(([g, xs]) => [g, `${xs.filter((r) => r.caught).length}/${xs.length}`])), missed: ctl.filter((r) => !r.caught).map((r) => ({ uid: r.uid, kind: r.control, verdict: r.verdict, planted: r.planted })) },
  };
  if (arg('out')) { fs.writeFileSync(arg('out'), JSON.stringify(out, null, 1)); fs.writeFileSync(arg('out').replace(/\.json$/, '-rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); }
  console.log(JSON.stringify(out, null, 1));
}
