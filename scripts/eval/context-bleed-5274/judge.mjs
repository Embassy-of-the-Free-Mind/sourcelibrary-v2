#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/wrong-leaf-fix-5021.mjs judge() (blind Opus, scans of n-1, n, n+1, TWO Englishes for
// page n: a gate comparing a new read with the stored one); scripts/audit/leaf-shift-confirm-5021.mjs (claudeCall,
// fetchLeaf, reused here). Neither judges ONE stored English against the three leaves with a "composed / padding"
// answer, nor takes a sample file with planted controls, so this is the screen-check judge for #5274.
/**
 * Context-bleed judge (#5274): which leaf does page n's stored English render? One sealed `claude -p` call per page
 * with the scans and transcriptions of n-1, n and n+1 and page n's English only. Blind: the judge is not told the
 * screen's class, and the sample carries planted controls (a known-good page; a swap whose English is n-1's own).
 *
 *   node --env-file=.env.production.local scripts/eval/context-bleed-5274/judge.mjs --sample FILE --out DIR --model sonnet|opus [--concurrency 3]
 *
 * FILE: JSON array of { page_id, book_id, page, band?, cls?, control?: 'good'|'swap', english_file? } (a swap's English
 * is read from page n-1; english_file, a new read to judge in place of the stored English). Out: DIR/verdicts.jsonl (resumable: a page with a verdict is not asked again), DIR/<page_id>/ (images, prompt).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { fetchLeaf, claudeCall } from '../../audit/leaf-shift-confirm-5021.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const OUT = path.resolve(arg('out'));
const MODEL = arg('model', 'sonnet');
fs.mkdirSync(OUT, { recursive: true });
const sample = JSON.parse(fs.readFileSync(arg('sample'), 'utf8'));
const RES = path.join(OUT, 'verdicts.jsonl');
const done = new Set(fs.existsSync(RES) ? fs.readFileSync(RES, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.verdict).map((r) => r.page_id) : []);

const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await c.connect();
const db = c.db('bookstore');
const PROJ = { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'translation_withheld.text': 1, cropped_photo: 1, split_from_spread: 1, photo: 1, archived_photo: 1, display_photo: 1, photo_original: 1 };
const strip = (s) => String(s || '').replace(/<detected-images>[\s\S]*?<\/detected-images>/gi, '[picture regions listed]');

export function judgePrompt({ title, language, n, win, english }) {
  const L = [`You are checking the English shown to readers for ONE page of "${title}" (language: ${language}). Below are up to three consecutive pages: each page's scan (open EVERY image with the Read tool) and a machine transcription that can be wrong or incomplete; trust the images.`, ''];
  for (const w of win) L.push(`=== Page ${w.n} ===`, w.img ? `Image file: ${w.img}` : 'Image: (not available)', `Transcription of page ${w.n}:`, '<<<', w.ocr || '(empty)', '>>>', '');
  L.push(`The English stored for page ${n}:`, '<<<', english.slice(0, 6000), '>>>', '');
  L.push(`Questions, about the English for page ${n} only:`,
    `1. leaf: whose printed content does the BODY of this English mainly render? "own" (page ${n}), "prev" (page ${n - 1}), "next" (page ${n + 1}), "mixed" (substantial parts of page ${n} and of a neighbour), or "none" (text printed on none of these three pages: an entry, description or commentary composed for the page).`,
    `2. added: apart from a faithful rendering of page ${n}'s printed words and a short description of its picture, how much does the English add that is not on page ${n}? "none", "minor" (a gloss or a sentence of background), or "substantial" (paragraphs a reader would take as the page's content).`,
    `3. own_text: is page ${n}'s own printed text (title, caption, labels, body) rendered at all? "yes", "partly", "no", or "nothing printed".`,
    'Judge content, not style. Answer with JSON only, no code fence: {"leaf":"own|prev|next|mixed|none","added":"none|minor|substantial","own_text":"yes|partly|no|nothing printed","printed":"one line: what is printed on page N","evidence":"a phrase of the English and where it is printed (page number), or why it is on no page"}');
  return L.join('\n');
}

const CONC = Number(arg('concurrency', 3));
const items = sample.filter((s) => !done.has(s.page_id));
console.log(`${items.length} to judge (${done.size} done), model ${MODEL}`);
const worker = async () => {
  for (let s = items.shift(); s; s = items.shift()) {
    const pages = await db.collection('pages').find({ book_id: s.book_id, page_number: { $gte: s.page - 1, $lte: s.page + 1 } }, { projection: PROJ }).sort({ page_number: 1 }).toArray();
    const me = pages.find((p) => p.page_number === s.page);
    const book = await db.collection('books').findOne({ id: s.book_id }, { projection: { title: 1, language: 1 } });
    const src = s.control === 'swap' ? pages.find((p) => p.page_number === s.page - 1) : me;
    // english_file: a new read (the fix gate), judged exactly as a stored English is
    const english = s.english_file ? (fs.existsSync(s.english_file) ? fs.readFileSync(s.english_file, 'utf8').trim() : '') : String(src?.translation?.data || src?.translation_withheld?.text || '');
    const dir = path.join(OUT, s.page_id);
    fs.mkdirSync(dir, { recursive: true });
    const win = [];
    for (const p of pages) { const img = `p${p.page_number}.jpg`; const got = await fetchLeaf({ display_photo: getPageSource(p), photo: p.photo, archived_photo: p.archived_photo, photo_original: p.photo_original }, path.join(dir, img)); win.push({ n: p.page_number, img: got ? img : null, ocr: strip(p.ocr?.data).slice(0, 3500) }); }
    if (!english || !win.find((w) => w.n === s.page)?.img) { fs.appendFileSync(RES, JSON.stringify({ ...s, cls: english ? 'no_image' : 'no_english' }) + '\n'); continue; }
    const prompt = judgePrompt({ title: book?.title, language: book?.language, n: s.page, win, english });
    fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);
    const res = await claudeCall(prompt, dir);
    let v = null;
    try { const a = res.text.indexOf('{'), b = res.text.lastIndexOf('}'); v = JSON.parse(res.text.slice(a, b + 1)); } catch { /* unparsed */ }
    fs.appendFileSync(RES, JSON.stringify({ ...s, judge: MODEL, verdict: v, cls: res.cls || (v ? null : 'unparsed'), model: res.model, usage: res.usage, secs: res.secs, ...(v ? {} : { raw: String(res.text).slice(0, 600), err: res.err }) }) + '\n');
    console.log(`  ${s.page_id} p${s.page} ${s.control || s.band || ''}: ${v ? `${v.leaf}/${v.added}/${v.own_text}` : res.cls}`);
    if (res.cls === 'usage_limit') { items.length = 0; console.log('usage limit: stopping'); }
  }
};
await Promise.all(Array.from({ length: CONC }, worker));
await c.close();
