#!/usr/bin/env node
// PRIOR ART: scripts/audit/leaf-shift-confirm-5021.mjs (the sealed `claude -p` call and the leaf fetch, narrowed to
// "whose text is this English?" on pages a screen already flagged; it cannot give a rate). scripts/eval/spot-check/
// served-draw.mjs (one served page per book, but only pages WITH English, stratified by lane, and its reviewer grades
// text quality; it has no order, number or split label). scripts/audit/page-integrity.mjs (the $0 corpus walk for
// duplicates and shifts: a screen, no image). scripts/eval/spot-check/lib.mjs bookOrder + lib/paired-stats.mjs makeRng
// are reused unchanged. Nothing answers, per random page and per defect: do image, text, English and number line up?
/**
 * page-integrity-draw — one random served page from each of 200 random visible books, judged sealed by Opus (#8040).
 *
 *   node --env-file=.env.production.local scripts/audit/page-integrity-draw.mjs --seed 20261201 --out <dir> [--land]
 *
 * Re-run the same command to resume: the draw is never redone, and judged items are never re-asked.
 *
 * Phases, each resumable from files in --out:
 *   draw     sample.json + key.json (frame, seed, the 200 pages with their provenance, the controls).
 *            Frame: visible:true, pages_count>0. One served page per book (no repeat capture, no blank page type),
 *            uniform over the book's served pages, so a long book is one observation like a short one.
 *   judge    One `claude -p --model opus --restricted --tools Read` per item, in a seeded order that mixes the
 *            planted controls in. Prompt and folder carry nothing that says control. The stream transcript is kept, and
 *            an item only counts if it shows a Read of every image; otherwise it is asked once more, then `not_opened`.
 *   rejudge  Every flagged page and enough unflagged ones to reach --rejudge, asked again in a fresh call with the same
 *            prompt, in a seeded order. Gives the judge's over-flag rate; the controls give its miss rate.
 *   report   result.json + report.md: a rate per defect with Wilson intervals, by language group and by repair coverage.
 *   --land   Branch from origin/main in a temporary worktree, append one row to the series file, add the compact
 *            results, open a PR, comment on #8040. The checkout it runs from is never touched. --land-dry: commit
 *            on a throwaway branch from --land-base (default HEAD), print it, delete it.
 *
 * READ-ONLY on the corpus: this writes files under --out only, plus a branch with --land. It contains nothing: a
 * monthly row's positives are the judge's until someone opens the images (.claude/docs/invariants/containment-on-finding.md).
 * Stops on a usage limit (exit 3) and pages ntfy once per run directory. Exit 0 finished, 2 could not run.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../eval/lib/paired-stats.mjs';
import { bookOrder } from '../eval/spot-check/lib.mjs';
import { wilson } from '../eval/lib/agreement-stats.mjs';
import { scriptsOfLanguage } from '../lib/stray-script.mjs';
import { getPageSource, isUsableImageUrl } from '../lib/page-image-url.mjs';
import { claudeBlocked, noteLimitHit } from '../lib/model-limits.mjs';
import { ntfyPost } from '../lib/ntfy-send.mjs';

export const ISSUE = 8040;
const NTFY = process.env.PAGE_INTEGRITY_TOPIC || 'https://ntfy.sh/sourcelibrary-uptime';
const SERIES = 'scripts/eval/experiments/_series-monthly-page-integrity.md';
const TEXT_HEAD = 4500, TEXT_TAIL = 1500;
const WEEKLY_HEADROOM = 90; // a run this size stops short of the wall so the box's other jobs keep their week

// Labels are the pre-registration (scripts/eval/experiments/2026-11-04-page-integrity-draw-8040.md).
export const LABELS = {
  text_leaf: ['this_leaf', 'prev_leaf', 'next_leaf', 'other', 'empty', 'cannot_tell'],
  english: ['this_text', 'prev_text', 'next_text', 'mixed', 'invents', 'none', 'cannot_tell'],
  number: ['agrees', 'disagrees', 'none_printed', 'cannot_tell'],
  order: ['forward', 'backward', 'jumbled', 'cannot_tell'],
  split: ['single_leaf', 'two_leaves', 'plate_cut', 'cannot_tell'],
};

// Planted per run. Every class has a label it must move; see plantControl().
export const CONTROLS = { wrong_image_other_book: 5, neighbour_text: 5, shift_run: 5, english_neighbour: 5, english_other_book: 5, order_backward: 5, two_leaves: 4, number_stamp: 4 };
export const CAUGHT = {
  wrong_image_other_book: (v) => v.text_leaf?.label === 'other',
  neighbour_text: (v) => v.text_leaf?.label === 'next_leaf',
  shift_run: (v) => v.text_leaf?.label === 'next_leaf',
  english_neighbour: (v) => v.english?.label === 'next_text',
  english_other_book: (v) => v.english?.label === 'invents',
  order_backward: (v) => ['backward', 'jumbled'].includes(v.order?.label),
  two_leaves: (v) => v.split?.label === 'two_leaves',
  number_stamp: (v, k) => String(v.number?.printed_on_image ?? '').includes(String(k.stamp)),
};

export function languageGroup(language) {
  const l = String(language ?? '').trim();
  if (/^latin$/i.test(l)) return 'Latin';
  if (/^(german|de|deu|middle high german|early new high german)$/i.test(l)) return 'German'; // `de` is a real stored value
  if (/^english$/i.test(l)) return 'English';
  if (/^(french|italian|spanish|dutch|portuguese)$/i.test(l)) return 'Romance + Dutch';
  const s = scriptsOfLanguage(l);
  if (['Han', 'Hiragana', 'Katakana', 'Hangul'].some((k) => s.has(k))) return 'CJK';
  if (s.size && !s.has('Latin')) return 'other script';
  return 'other Latin script';
}

/** The flags a page raises, from one verdict. The number of a frame differing from the print is a fact, not a flag. */
export function flagsOf(v) {
  const f = [];
  if (['prev_leaf', 'next_leaf', 'other'].includes(v.text_leaf?.label)) f.push(`text:${v.text_leaf.label}`);
  if (['prev_text', 'next_text', 'mixed', 'invents'].includes(v.english?.label)) f.push(`english:${v.english.label}`);
  if (v.number?.label_agrees === 'disagrees') f.push('number:label_disagrees');
  if (['backward', 'jumbled'].includes(v.order?.label)) f.push(`order:${v.order.label}`);
  if (['two_leaves', 'plate_cut'].includes(v.split?.label)) f.push(`split:${v.split.label}`);
  if (v.repeat && v.repeat !== 'none') f.push(`repeat:${v.repeat}`);
  return f;
}

const clip = (s) => { s = String(s ?? '').trim(); return s.length > TEXT_HEAD + TEXT_TAIL ? `${s.slice(0, TEXT_HEAD)}\n[… ${s.length - TEXT_HEAD - TEXT_TAIL} characters left out here …]\n${s.slice(-TEXT_TAIL)}` : s; };

export function buildPrompt(item) {
  const frames = item.frames, cur = frames.find((f) => f.role === 'cur');
  const L = [];
  L.push(`You are checking one page of a digitised book against its scan: a reader sees the image, a transcription, an English translation and a page number side by side, and you say whether they belong together. Report what you see. Many pages are fine and some are not; nothing here tells you which.`);
  L.push('', `Book: "${item.title}" (catalogue language: ${item.language || 'unknown'}).`);
  L.push(`Below are the frame under review, frame ${cur.frame}, and the frames either side of it in storage order, each with its scan image and its stored transcription. Open EVERY image with the Read tool before you answer. Transcriptions are machine-made: misreadings are common and are NOT what is being asked. A badly misread transcription of this leaf is still this leaf.`, '');
  for (const f of frames) {
    L.push(`=== Frame ${f.frame}${f.role === 'cur' ? ' (under review)' : ''} ===`, f.image ? `Image file: ${f.image}` : 'Image: (none available)', `Stored transcription of frame ${f.frame}:`, '<<<', clip(f.ocr) || '(empty)', '>>>', '');
  }
  L.push(`English shown to readers on frame ${cur.frame}:`, '<<<', clip(cur.tr) || '(none)', '>>>', '');
  L.push(`The reader's toolbar calls this page "p. ${cur.frame}".${item.label ? ` The site also stores "${item.label}" as the number printed on this leaf.` : ' The site stores no printed number for this leaf.'}`, '');
  L.push(`Answer these, about frame ${cur.frame}:`);
  L.push(`1. text_leaf, whose text is the stored transcription?`);
  L.push(`   this_leaf: this image's text, however badly read; also when the image has no text and the transcription is empty or only describes it.`);
  L.push(`   prev_leaf / next_leaf: mainly the text on the frame before / after.`);
  L.push(`   other: mainly text on none of the three images: another book, elsewhere in this book, or text that is on no leaf you can see. Text set against a blank leaf is this.`);
  L.push(`   empty: no transcription stored though the image has text. cannot_tell: you cannot decide.`);
  L.push(`2. english, what does the English render? (Against the transcription of this frame, not against the image.)`);
  L.push(`   this_text: this frame's transcription; a sentence carried over a page edge, or omissions and mistranslations, are still this_text.`);
  L.push(`   prev_text / next_text: mainly the transcription of the frame before / after.`);
  L.push(`   mixed: substantial parts of two frames' transcriptions.`);
  L.push(`   invents: a substantial part has no source in any of the three transcriptions (a wrong word is not invention).`);
  L.push(`   none: no English shown. cannot_tell: you cannot decide.`);
  L.push(`3. number. printed_on_image: the page or folio number printed or written on this image, exactly as it stands, or null if none. Also printed_prev and printed_next for the neighbours.`);
  L.push(`   label: agrees if the printed number equals the toolbar's ${cur.frame}; disagrees if a number is printed and it differs; none_printed if the leaf carries no number; cannot_tell if a mark is there and unreadable.`);
  L.push(`   label_agrees: the same test against the stored printed number: agrees / disagrees / none_printed / cannot_tell / no_stored_number.`);
  L.push(`4. order, reading the three frames in the order given, does the book run:`);
  L.push(`   forward / backward / jumbled / cannot_tell. Use printed numbers, catchwords, and sentences running from one leaf to the next. A right-to-left book whose leaves are stored in its own reading order is forward.`);
  L.push(`5. split, what does the image of frame ${cur.frame} hold? single_leaf / two_leaves (two pages of an opening in one frame) / plate_cut (one picture or plate cut in two across frames) / cannot_tell.`);
  L.push(`6. repeat: is a neighbour a second capture of this same leaf? none / prev / next.`);
  L.push('', `For every answer other than this_leaf, this_text, forward, single_leaf, none, quote the words from the transcription or English and say what the image shows instead. Quote at most ten words each.`);
  L.push('', `Answer with JSON only, no code fence:`);
  L.push(`{"images_opened":["file",...],"text_leaf":{"label":"","evidence":""},"english":{"label":"","evidence":""},"number":{"printed_on_image":null,"printed_prev":null,"printed_next":null,"label":"","label_agrees":""},"order":{"label":"","evidence":""},"split":{"label":""},"repeat":"none","script":"","note":""}`);
  return L.join('\n');
}

// ── controls ──
/** Plant a defect in a clean copy of a window. Pure: returns the frames and the key. */
export function plantControl(kind, base, donor) {
  const { prev, cur, next, next2 } = base;
  const f = (p, role, over = {}) => ({ role, frame: p.page_number, source: p, ocr: p.ocr?.data ?? '', tr: role === 'cur' ? (p.translation?.data ?? '') : '', ...over });
  const frames = (a, b, c) => [a, b, c];
  const key = { kind };
  switch (kind) {
    case 'wrong_image_other_book': return { key, frames: frames(f(prev, 'prev'), f(cur, 'cur', { source: donor.cur }), f(next, 'next')) };
    case 'neighbour_text': return { key, frames: frames(f(prev, 'prev'), f(cur, 'cur', { ocr: next.ocr.data, tr: next.translation.data }), f(next, 'next')) };
    case 'shift_run': return { key, frames: frames(f(prev, 'prev', { ocr: cur.ocr.data }), f(cur, 'cur', { ocr: next.ocr.data, tr: next.translation.data }), f(next, 'next', { ocr: next2.ocr.data })) };
    case 'english_neighbour': return { key, frames: frames(f(prev, 'prev'), f(cur, 'cur', { tr: next.translation.data }), f(next, 'next')) };
    case 'english_other_book': return { key, frames: frames(f(prev, 'prev'), f(cur, 'cur', { tr: donor.cur.translation.data }), f(next, 'next')) };
    case 'order_backward': return { key, frames: frames({ ...f(next, 'prev'), frame: prev.page_number }, f(cur, 'cur'), { ...f(prev, 'next'), frame: next.page_number }) };
    case 'two_leaves': return { key, frames: frames(f(prev, 'prev'), f(cur, 'cur', { compose: next }), f(next, 'next')) };
    case 'number_stamp': {
      const stamp = cur.page_number + 137;
      return { key: { ...key, stamp }, frames: frames(f(prev, 'prev', { stamp: stamp - 1 }), f(cur, 'cur', { stamp }), f(next, 'next', { stamp: stamp + 1 })) };
    }
    default: throw new Error(`unknown control ${kind}`);
  }
}

// ── images: what the reader's main panel shows (src/lib/page-image-url.ts getPageSource + cropRegion) ──
async function fetchBytes(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'sourcelibrary-audit/8040' }, signal: AbortSignal.timeout(90e3) });
  if (!r.ok) return null;
  const b = Buffer.from(await r.arrayBuffer());
  return b.length > 1000 ? b : null;
}
async function servedImage(page) {
  const sharp = (await import('sharp')).default;
  const cropped = !page.split_from_spread && !isUsableImageUrl(page.cropped_photo) && page.crop?.xStart !== undefined && page.crop?.xEnd !== undefined;
  for (const url of [getPageSource(page), page.display_photo, page.photo, page.archived_photo, page.photo_original]) {
    if (!isUsableImageUrl(url)) continue;
    try {
      const buf = await fetchBytes(url);
      if (!buf) continue;
      let im = sharp(buf, { limitInputPixels: false }).rotate();
      if (cropped && url === getPageSource(page)) {
        const m = await sharp(await im.toBuffer()).metadata();
        const left = Math.round(m.width * page.crop.xStart / 1000), right = Math.round(m.width * page.crop.xEnd / 1000);
        im = sharp(await im.toBuffer()).extract({ left, top: 0, width: Math.max(1, right - left), height: m.height });
      }
      return { buf: await im.jpeg({ quality: 85 }).toBuffer(), url };
    } catch { /* next field */ }
  }
  return null;
}
async function writeFrameImage(frame, dir) {
  const sharp = (await import('sharp')).default;
  const name = `frame-${frame.frame}.jpg`, file = path.join(dir, name);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return name;
  const got = await servedImage(frame.source);
  if (!got) return null;
  let buf = got.buf;
  if (frame.compose) {
    const other = await servedImage(frame.compose);
    if (other) {
      const H = 1400;
      const a = await sharp(buf).resize({ height: H }).toBuffer(), b = await sharp(other.buf).resize({ height: H }).toBuffer();
      const wa = (await sharp(a).metadata()).width, wb = (await sharp(b).metadata()).width;
      buf = await sharp({ create: { width: wa + wb, height: H, channels: 3, background: '#fff' } }).composite([{ input: a, left: 0, top: 0 }, { input: b, left: wa, top: 0 }]).jpeg({ quality: 85 }).toBuffer();
    }
  }
  if (frame.stamp != null) {
    const m = await sharp(buf).metadata(), band = Math.round(m.height * 0.07);
    const svg = Buffer.from(`<svg width="${m.width}" height="${band}"><rect width="100%" height="100%" fill="#f4efe2"/><text x="50%" y="70%" font-family="DejaVu Serif, serif" font-size="${Math.round(band * 0.6)}" text-anchor="middle" fill="#222">${frame.stamp}</text></svg>`);
    buf = await sharp({ create: { width: m.width, height: m.height + band, channels: 3, background: '#fff' } }).composite([{ input: svg, left: 0, top: 0 }, { input: buf, left: 0, top: band }]).jpeg({ quality: 85 }).toBuffer();
  }
  await sharp(buf).resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(file);
  return name;
}

// ── the sealed call ──
const USAGE_LIMIT = /usage limit|limit reached|hit your (?:usage )?limit|out of extra usage|rate.?limit|\b429\b|resets? (?:at )?\d/i;
// `claude -p` prefers an API key over the subscription login, and node --env-file loads one: strip it (#6553).
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }

export function parseStream(out) {
  const reads = []; let result = null;
  for (const l of String(out).split('\n')) {
    if (!l.trim()) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.type === 'assistant') for (const c of j.message?.content || []) if (c.type === 'tool_use' && c.name === 'Read' && c.input?.file_path) reads.push(path.basename(c.input.file_path));
    if (j.type === 'result') result = j;
  }
  return { reads, result };
}

function claudeCall(prompt, cwd, transcript) {
  const blocked = claudeBlocked({ weeklyMax: WEEKLY_HEADROOM });
  if (blocked) return Promise.resolve({ text: '', cls: 'usage_limit', err: blocked.reason, not_called: true, reads: [] });
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('claude', ['-p', '--model', 'opus', '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'stream-json', '--verbose'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.writeFileSync(transcript, zlib.gzipSync(out));
      const { reads, result } = parseStream(out);
      const text = String(result?.result ?? '').trim();
      const failed = result?.is_error || code !== 0;
      const cls = failed && USAGE_LIMIT.test(text + out.slice(-2000) + err) ? 'usage_limit' : code === null ? 'timeout' : failed ? `exit_${code}` : !text ? 'empty' : null;
      if (cls === 'usage_limit') noteLimitHit('claude', { reason: (err || text).slice(-200) });
      resolve({ text, cls, reads, model: Object.keys(result?.modelUsage || {})[0] || null, usage: result?.usage ? { input: result.usage.input_tokens, output: result.usage.output_tokens, cache_read: result.usage.cache_read_input_tokens, turns: result.num_turns } : null, cost_equiv_usd: result?.total_cost_usd ?? null, err: (err || (failed ? text : '')).slice(-300), secs: (Date.now() - t0) / 1000 });
    });
  });
}

export function parseVerdict(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  let j; try { j = JSON.parse(text.slice(a, b + 1)); } catch { return null; }
  for (const k of ['text_leaf', 'english', 'number', 'order', 'split']) {
    if (!j[k] || !LABELS[k].includes(j[k].label)) return null;
  }
  return j;
}

// A call that failed and was asked again on a resume has two rows; the last one stands.
const readJsonl = (f) => (fs.existsSync(f) ? [...new Map(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.call, r])).values()] : []);
const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
function shuffled(xs, rnd) { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ── draw ──
const PAGE_FIELDS = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, repeat_of: 1, translation_withheld: 1, printed_page: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'translation.data': 1, 'translation.model': 1, 'translation.source': 1, 'translation.edited_by': 1, photo: 1, display_photo: 1, archived_photo: 1, photo_original: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1, crop: 1 };

async function coverageOf(db, book, ids) {
  const hold = book.pipeline_auto?.hold?.reason ?? null;
  const [sweeps, events, repeats, revs] = await Promise.all([
    db.collection('sweep_log').find({ book_id: book.id, $or: [{ 'detail.issue': { $in: [5021, 5803, 5699, 5056, '5021', '5803', '5699', '5056'] } }, { sweep: { $regex: '5021|5803|5699|5056|leaf-order|renumber' } }] }, { projection: { _id: 0, sweep: 1, 'detail.issue': 1 } }).limit(50).toArray(),
    db.collection('book_events').find({ book_id: book.id, type: { $in: ['text_permutation_repair', 'page_order_renumber'] } }, { projection: { _id: 0, type: 1 } }).limit(5).toArray(),
    db.collection('pages').countDocuments({ book_id: book.id, repeat_of: { $ne: null } }, { limit: 1 }),
    db.collection('page_revisions').find({ page_id: { $in: ids } }, { projection: { _id: 0, source: 1 } }).limit(200).toArray(),
  ]);
  const names = [...sweeps.map((s) => `${s.sweep} ${s.detail?.issue ?? ''}`), ...events.map((e) => e.type), ...revs.map((r) => r.source), hold].filter(Boolean).join(' | ');
  return {
    '#5021': /5021|leaf-shift/.test(names), '#5803': /5803|text-permutation|text_permutation|reseat|clef/.test(names),
    '#5699': /5699|renumber|page_order|leaf-order/.test(names), '#5056': repeats > 0 || /5056|hide-repeat/.test(names),
    hold, trail: [...new Set(names.split(' | '))].filter(Boolean).slice(0, 12),
  };
}

async function draw(db, { seed, n, out }) {
  const books = db.collection('books'), pages = db.collection('pages');
  const frameIds = (await books.find({ visible: true, pages_count: { $gt: 0 } }, { projection: { _id: 0, id: 1 } }).toArray()).map((b) => b.id).filter(Boolean);
  console.error(`frame ${frameIds.length} books · seed ${seed}`);
  const bookRng = makeRng(seed), pageRng = makeRng(seed ^ 0x9e3779b9), ctrlRng = makeRng(seed ^ 0x51ed270b);
  const nControls = Object.values(CONTROLS).reduce((a, b) => a + b, 0);
  const META = { _id: 0, id: 1, title: 1, display_title: 1, language: 1, original_language: 1, published: 1, tenantId: 1, 'image_source.provider': 1, 'pipeline_auto.hold': 1, page_progression: 1 };
  const sample = [], bases = [], rejected = [];
  for (const id of bookOrder(frameIds, bookRng)) {
    const u = pageRng();
    if (sample.length >= n && bases.length >= nControls + 6) break;
    const b = await books.findOne({ id }, { projection: META });
    const served = (await pages.find({ book_id: id, page_number: { $gt: 0 }, repeat_of: null, page_type: { $ne: 'blank' } }, { projection: { _id: 0, page_number: 1 } }).sort({ page_number: 1 }).toArray()).map((p) => p.page_number);
    if (!served.length) { rejected.push({ id, why: 'no served non-blank page' }); continue; }
    let idx = Math.floor(u * served.length), full = null;
    for (let tries = 0; tries < 5; tries++, idx = (idx + 1) % served.length) { // a page whose own OCR tag says blank is a blank page type too
      full = await pages.findOne({ book_id: id, page_number: served[idx], repeat_of: null }, { projection: PAGE_FIELDS });
      if (!/<page-type>\s*blank\s*<\/page-type>/i.test(full?.ocr?.data ?? '')) break;
      full = null;
    }
    if (!full) { rejected.push({ id, why: 'only blank-tagged pages near the pick' }); continue; }
    const N = full.page_number;
    const [prev] = await pages.find({ book_id: id, page_number: { $lt: N, $gt: 0 }, repeat_of: null }, { projection: PAGE_FIELDS }).sort({ page_number: -1 }).limit(1).toArray();
    const after = await pages.find({ book_id: id, page_number: { $gt: N }, repeat_of: null }, { projection: PAGE_FIELDS }).sort({ page_number: 1 }).limit(2).toArray();
    const next = after[0] ?? null, next2 = after[1] ?? null;
    if (sample.length < n) {
      sample.push({ slot: sample.length, book: b, page: full, prev: prev ?? null, next, coverage: await coverageOf(db, b, [prev?.id, full.id, next?.id].filter(Boolean)) });
      if (sample.length % 25 === 0) console.error(`  drawn ${sample.length}`);
    } else {
      const ok = (p, min = 200) => String(p?.ocr?.data ?? '').length >= min && String(p?.translation?.data ?? '').length >= min && !p.translation_withheld;
      if (prev && next && next2 && ok(full, 300) && ok(next, 300) && ok(prev, 100) && String(next2?.ocr?.data ?? '').length >= 100) bases.push({ book: b, prev, cur: full, next, next2 });
    }
  }
  if (sample.length < n) throw new Error(`only ${sample.length} of ${n} books drawn`);
  const kinds = Object.entries(CONTROLS).flatMap(([k, c]) => Array(c).fill(k));
  if (bases.length < kinds.length + 1) throw new Error(`only ${bases.length} control bases for ${kinds.length} controls`);
  const pool = shuffled(bases, ctrlRng);
  const controls = kinds.map((kind, i) => ({ slot: `c${i}`, kind, base: pool[i], donor: pool[(i + 1) % pool.length] }));

  const items = [];
  for (const s of sample) {
    const frames = [s.prev && { role: 'prev', frame: s.prev.page_number, source: s.prev, ocr: s.prev.ocr?.data ?? '', tr: '' },
      { role: 'cur', frame: s.page.page_number, source: s.page, ocr: s.page.ocr?.data ?? '', tr: s.page.translation?.data ?? '' },
      s.next && { role: 'next', frame: s.next.page_number, source: s.next, ocr: s.next.ocr?.data ?? '', tr: '' }].filter(Boolean);
    items.push({ item: sha(`${seed}:${s.slot}`), kind: 'main', slot: s.slot, title: s.book.display_title || s.book.title, language: s.book.language, label: s.page.printed_page?.label ?? null, frames });
  }
  for (const c of controls) {
    const { key, frames } = plantControl(c.kind, c.base, c.donor);
    items.push({ item: sha(`${seed}:${c.slot}`), kind: 'control', slot: c.slot, control: key, base_book: c.base.book.id, base_page: c.base.cur.page_number, title: c.base.book.display_title || c.base.book.title, language: c.base.book.language, label: c.base.cur.printed_page?.label ?? null, frames });
  }
  const order = shuffled(items.map((i) => i.item), makeRng(seed ^ 0x2545f491));
  fs.writeFileSync(path.join(out, 'items.json'), JSON.stringify({ seed, order, items }));
  const row = (s) => ({ slot: s.slot, book_id: s.book.id, title: String(s.book.display_title || s.book.title || '').slice(0, 100), frame: s.page.page_number, shown_number: s.page.page_number, stored_printed_label: s.page.printed_page?.label ?? null, page_id: s.page.id, page_type: s.page.page_type ?? null,
    ocr_engine: s.page.ocr?.model ?? s.page.ocr?.source ?? null, translation_engine: s.page.translation?.model ?? s.page.translation?.source ?? null, human_translation: !!(s.page.translation?.edited_by || ['human', 'manual'].includes(s.page.translation?.source)), withheld: !!s.page.translation_withheld,
    has_text: !!String(s.page.ocr?.data ?? '').trim(), has_english: !!String(s.page.translation?.data ?? '').trim(), neighbours: [s.prev?.page_number ?? null, s.next?.page_number ?? null],
    language: s.book.language ?? null, group: languageGroup(s.book.language), scripts: [...scriptsOfLanguage(s.book.language)], provider: s.book.image_source?.provider ?? null, tenant: s.book.tenantId ?? null, coverage: s.coverage });
  fs.writeFileSync(path.join(out, 'sample.json'), JSON.stringify({ date: new Date().toISOString().slice(0, 10), seed, frame: frameIds.length, n, rejected, pages: sample.map(row) }, null, 1));
  fs.writeFileSync(path.join(out, 'key.json'), JSON.stringify(items.filter((i) => i.kind === 'control').map(({ item, slot, control, base_book, base_page }) => ({ item, slot, control, base_book, base_page })), null, 1));
  console.error(`drew ${sample.length} pages, ${controls.length} controls; ${rejected.length} books rejected`);
}

// ── judge ──
async function judgeItems(items, { out, file, conc, tag, onStop }) {
  const done = new Set(readJsonl(file).filter((r) => r.verdict || r.cls === 'not_opened' || r.cls === 'no_image').map((r) => r.call));
  const queue = items.filter((i) => !done.has(i.call));
  console.error(`${tag}: ${queue.length} to call (${done.size} done)`);
  let stop = false, n = 0;
  const one = async (it) => {
    const dir = path.join(out, 'calls', it.call);
    fs.mkdirSync(dir, { recursive: true });
    const frames = [];
    for (const f of it.frames) frames.push({ role: f.role, frame: f.frame, ocr: f.ocr, tr: f.tr, image: await writeFrameImage(f, dir) });
    const cur = frames.find((f) => f.role === 'cur');
    const base = { call: it.call, item: it.item, tag, kind: it.kind, slot: it.slot, images: frames.filter((f) => f.image).map((f) => f.image) };
    if (!cur.image) { fs.appendFileSync(file, JSON.stringify({ ...base, cls: 'no_image' }) + '\n'); return; }
    const prompt = buildPrompt({ ...it, frames });
    fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);
    let r, verdict = null, cls = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      r = await claudeCall(prompt, dir, path.join(dir, `transcript-${attempt}.jsonl.gz`));
      if (r.cls === 'usage_limit') { stop = true; onStop(r.err || r.text); return; }
      verdict = r.cls ? null : parseVerdict(r.text);
      const opened = base.images.every((f) => r.reads.includes(f));
      cls = r.cls || (!verdict ? 'unparsed' : !opened ? 'not_opened' : null);
      if (!cls) break;
    }
    fs.appendFileSync(file, JSON.stringify({ ...base, cls, verdict: cls ? null : verdict, reads: r.reads, model: r.model, usage: r.usage, cost_equiv_usd: r.cost_equiv_usd, secs: r.secs, ...(cls ? { raw: r.text.slice(0, 600), err: r.err } : {}) }) + '\n');
    if (++n % 10 === 0) console.error(`  ${tag}: ${n} calls, ${queue.length} left`);
  };
  await Promise.all(Array.from({ length: conc }, async () => { for (let it = queue.shift(); it && !stop; it = queue.shift()) await one(it); }));
  return !stop;
}

// ── report ──
function rate(k, n) { const [lo, hi] = wilson(k, n); return { k, n, pct: n ? +(100 * k / n).toFixed(1) : null, lo: +(100 * lo).toFixed(1), hi: +(100 * hi).toFixed(1) }; }
const num = (x) => { const m = String(x ?? '').match(/^\s*(\d+)\s*$/); return m ? +m[1] : null; };

/** Every rate of the report, from the sample rows and the verdicts. Pure, so a test can pin the denominators. */
export function computeReport(pages, verdicts, controls, rejudged) {
  const v = new Map(verdicts.map((r) => [r.slot, r.verdict]));
  const judged = pages.filter((p) => v.get(p.slot));
  const count = (rows, field, labels) => Object.fromEntries(labels.map((l) => [l, rows.filter((p) => v.get(p.slot)[field]?.label === l).length]));
  const textRows = judged.filter((p) => p.has_text), enRows = judged.filter((p) => p.has_english);
  const defects = {
    'text: a neighbour\'s leaf': rate(textRows.filter((p) => ['prev_leaf', 'next_leaf'].includes(v.get(p.slot).text_leaf.label)).length, textRows.length),
    'text: other book or elsewhere': rate(textRows.filter((p) => v.get(p.slot).text_leaf.label === 'other').length, textRows.length),
    'text: empty where the leaf has text': rate(judged.filter((p) => v.get(p.slot).text_leaf.label === 'empty').length, judged.length),
    'english: renders a neighbour': rate(enRows.filter((p) => ['prev_text', 'next_text', 'mixed'].includes(v.get(p.slot).english.label)).length, enRows.length),
    'english: invents': rate(enRows.filter((p) => v.get(p.slot).english.label === 'invents').length, enRows.length),
    'number: stored printed number differs from the print': rate(judged.filter((p) => v.get(p.slot).number.label_agrees === 'disagrees').length, judged.filter((p) => ['agrees', 'disagrees'].includes(v.get(p.slot).number.label_agrees)).length),
    'number: the leaf has a number and none is stored': rate(judged.filter((p) => ['agrees', 'disagrees'].includes(v.get(p.slot).number.label) && !p.stored_printed_label).length, judged.filter((p) => ['agrees', 'disagrees'].includes(v.get(p.slot).number.label)).length),
    'number: frame differs from the print': rate(judged.filter((p) => v.get(p.slot).number.label === 'disagrees').length, judged.filter((p) => ['agrees', 'disagrees'].includes(v.get(p.slot).number.label)).length),
    'order: backward': rate(judged.filter((p) => v.get(p.slot).order.label === 'backward').length, judged.filter((p) => v.get(p.slot).order.label !== 'cannot_tell').length),
    'order: jumbled': rate(judged.filter((p) => v.get(p.slot).order.label === 'jumbled').length, judged.filter((p) => v.get(p.slot).order.label !== 'cannot_tell').length),
    'split: two leaves in a frame': rate(judged.filter((p) => v.get(p.slot).split.label === 'two_leaves').length, judged.length),
    'split: one plate cut in two': rate(judged.filter((p) => v.get(p.slot).split.label === 'plate_cut').length, judged.length),
    'repeat: a neighbour is the same leaf': rate(judged.filter((p) => v.get(p.slot).repeat && v.get(p.slot).repeat !== 'none').length, judged.length),
  };
  const ANY = (p) => flagsOf(v.get(p.slot)).length > 0;
  const groups = [...new Set(judged.map((p) => p.group))].sort();
  const cut = (rows) => {
    const c = {
      text: rate(rows.filter((p) => p.has_text && ['prev_leaf', 'next_leaf', 'other'].includes(v.get(p.slot).text_leaf.label)).length, rows.filter((p) => p.has_text).length),
      english: rate(rows.filter((p) => p.has_english && ['prev_text', 'next_text', 'mixed', 'invents'].includes(v.get(p.slot).english.label)).length, rows.filter((p) => p.has_english).length),
      number: rate(rows.filter((p) => v.get(p.slot).number.label_agrees === 'disagrees').length, rows.filter((p) => ['agrees', 'disagrees'].includes(v.get(p.slot).number.label_agrees)).length),
      order: rate(rows.filter((p) => ['backward', 'jumbled'].includes(v.get(p.slot).order.label)).length, rows.filter((p) => v.get(p.slot).order.label !== 'cannot_tell').length),
      split: rate(rows.filter((p) => ['two_leaves', 'plate_cut'].includes(v.get(p.slot).split.label)).length, rows.length),
      n: rows.length,
    };
    return c;
  };
  const ctl = {};
  for (const r of controls) {
    const k = r.control.kind;
    ctl[k] ??= { planted: 0, caught: 0, missed_items: [] };
    if (!r.verdict) continue;
    ctl[k].planted++;
    if (CAUGHT[k](r.verdict, r.control)) ctl[k].caught++; else ctl[k].missed_items.push(r.item);
  }
  // The registered bar: a class under 4 of 5 (3 of 4) prints its defect as not settled.
  const notSettled = Object.entries(ctl).filter(([, c]) => c.planted && c.caught < c.planted - 1).map(([k]) => k);
  const miss = { planted: Object.values(ctl).reduce((a, c) => a + c.planted, 0), caught: Object.values(ctl).reduce((a, c) => a + c.caught, 0) };
  const reMap = new Map(rejudged.filter((r) => r.verdict).map((r) => [r.slot, r.verdict]));
  let flagsAsked = 0, flagsHeld = 0, cleanAsked = 0, cleanStill = 0;
  for (const p of judged) {
    const again = reMap.get(p.slot);
    if (!again) continue;
    const a = flagsOf(v.get(p.slot)), b = flagsOf(again);
    if (a.length) { flagsAsked += a.length; flagsHeld += a.filter((f) => b.includes(f)).length; } else { cleanAsked++; if (!b.length) cleanStill++; }
  }
  return {
    n_drawn: pages.length, n_judged: judged.length, n_withheld: pages.filter((p) => p.withheld).length, n_stored_label: pages.filter((p) => p.stored_printed_label).length, n_claude_made: pages.filter((p) => /claude|opus|sonnet/i.test(`${p.ocr_engine} ${p.translation_engine}`)).length, n_with_text: textRows.length, n_with_english: enRows.length,
    counts: Object.fromEntries(['text_leaf', 'english', 'number', 'order', 'split'].map((k) => [k, count(judged, k, LABELS[k])])),
    defects,
    by_language: Object.fromEntries(groups.map((g) => [g, cut(judged.filter((p) => p.group === g))])),
    by_repair: Object.fromEntries(['#5021', '#5803', '#5699', '#5056'].flatMap((i) => [[`${i} touched this book`, cut(judged.filter((p) => p.coverage?.[i]))], [`${i} not touched`, cut(judged.filter((p) => !p.coverage?.[i]))]])),
    judge: {
      controls: ctl, not_settled: notSettled, miss_rate: rate(miss.planted - miss.caught, miss.planted),
      over_flag: { flags_reasked: flagsAsked, flags_repeated: flagsHeld, not_repeated: rate(flagsAsked - flagsHeld, flagsAsked), clean_reasked: cleanAsked, clean_stayed_clean: cleanStill, new_flags: rate(cleanAsked - cleanStill, cleanAsked) },
    },
    positives: judged.filter(ANY).map((p) => ({ slot: p.slot, book_id: p.book_id, frame: p.frame, group: p.group, provider: p.provider, ocr_engine: p.ocr_engine, translation_engine: p.translation_engine, flags: flagsOf(v.get(p.slot)), repeated_on_rejudge: reMap.has(p.slot) ? flagsOf(reMap.get(p.slot)) : null, evidence: { text: v.get(p.slot).text_leaf.evidence, english: v.get(p.slot).english.evidence, order: v.get(p.slot).order.evidence }, url: `https://sourcelibrary.org/book/${p.book_id}/page-number/${p.frame}`, coverage: p.coverage, verdict_number: v.get(p.slot).number })),
  };
}

const pct = (r) => (r.n ? `${r.k}/${r.n} (${r.pct}%, ${r.lo}–${r.hi})` : '—');
function renderReport(rep, meta) {
  const L = [`# Page integrity draw ${meta.date} (#${ISSUE})`, '', `n = ${rep.n_judged} pages judged of ${rep.n_drawn} drawn, one per book, seed ${meta.seed}, frame ${meta.frame} visible books. Opus via claude -p, sealed, images opened (AI reviewers). ${rep.n_with_text} pages carry a transcription, ${rep.n_with_english} carry English (${rep.n_withheld} more have it withheld), ${rep.n_stored_label} a stored printed number; ${rep.n_claude_made} hold Claude-made text.`, '', '| defect | k/n (%, 95% Wilson) |', '|---|---|'];
  for (const [k, r] of Object.entries(rep.defects)) L.push(`| ${k} | ${pct(r)} |`);
  L.push('', `Judge: planted controls missed ${pct(rep.judge.miss_rate)}. Flags asked again blind: ${rep.judge.over_flag.flags_repeated} of ${rep.judge.over_flag.flags_reasked} repeated; clean pages asked again: ${rep.judge.over_flag.clean_stayed_clean} of ${rep.judge.over_flag.clean_reasked} stayed clean. Control classes under the registered bar: ${rep.judge.not_settled.join(', ') || 'none'}.`, '', '| control | caught |', '|---|---|');
  for (const [k, c] of Object.entries(rep.judge.controls)) L.push(`| ${k} | ${c.caught}/${c.planted} |`);
  const cutTable = (title, obj) => {
    L.push('', `### ${title}`, '| | n | text not this leaf | English not this text | stored number wrong | order wrong | split |', '|---|---:|---|---|---|---|---|');
    for (const [k, c] of Object.entries(obj)) L.push(`| ${k} | ${c.n} | ${pct(c.text)} | ${pct(c.english)} | ${pct(c.number)} | ${pct(c.order)} | ${pct(c.split)} |`);
  };
  cutTable('By language group', rep.by_language);
  cutTable('By whether a repair touched the book', rep.by_repair);
  L.push('', '### Positives', '| page | flags | repeated on re-judge | language | repairs touching the book |', '|---|---|---|---|---|');
  for (const p of rep.positives) L.push(`| [${p.book_id.slice(-6)} f.${p.frame}](${p.url}) | ${p.flags.join(', ')} | ${p.repeated_on_rejudge ? p.repeated_on_rejudge.join(', ') || 'none repeated' : 'not asked'} | ${p.group} | ${Object.entries(p.coverage).filter(([k, x]) => k.startsWith('#') && x).map(([k]) => k).join(' ') || 'none'} |`);
  return L.join('\n') + '\n';
}

export function seriesRow(rep, meta) {
  const d = rep.defects, m = rep.judge.miss_rate, o = rep.judge.over_flag;
  const c = (r) => (r.n ? `${r.k}/${r.n} (${r.lo}–${r.hi})` : '—');
  return `| ${meta.date} | ${rep.n_judged} | ${c(d["text: a neighbour's leaf"])} | ${c(d['text: other book or elsewhere'])} | ${c(d['english: renders a neighbour'])} | ${c(d['english: invents'])} | ${c(d['number: stored printed number differs from the print'])} | ${c(d['order: backward'])} / ${c(d['order: jumbled'])} | ${c(d['split: two leaves in a frame'])} | ${m.k}/${m.n} | ${o.flags_repeated}/${o.flags_reasked} | ${meta.read_by ?? 'positives not yet read by eye'} |`;
}

function pageOnce(out, title, msg) {
  const f = path.join(out, 'paged.json');
  const seen = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  if (seen[title]) return Promise.resolve();
  seen[title] = new Date().toISOString();
  fs.writeFileSync(f, JSON.stringify(seen));
  return ntfyPost(NTFY, { method: 'POST', headers: { Title: title, Tags: 'books' }, body: msg }).catch((e) => console.error(`ntfy failed: ${e.message}`));
}

function land(out, meta, rep, root, { base = 'origin/main', dry = false } = {}) {
  const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
  const branch = `eval/page-integrity-${meta.date}`, wt = path.join(out, 'land');
  git(root, 'fetch', '--quiet', 'origin', 'main');
  git(root, 'worktree', 'add', '-q', '-b', branch, wt, base);
  try {
    const dest = path.join(wt, 'scripts/eval/results/page-integrity', meta.date);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of ['sample.json', 'key.json', 'judgments.jsonl', 'rejudge.jsonl', 'result.json', 'report.md']) fs.copyFileSync(path.join(out, f), path.join(dest, f));
    const sf = path.join(wt, SERIES);
    const lines = fs.readFileSync(sf, 'utf8').split('\n');
    const at = lines.findIndex((l) => /^\|---/.test(l));
    lines.splice(at + 1, 0, seriesRow(rep, meta));
    fs.writeFileSync(sf, lines.join('\n'));
    git(wt, 'add', dest, SERIES);
    // --no-verify: a results row and JSON; the checkout's pre-commit hooks need a vendored file a bare worktree lacks.
    git(wt, 'commit', '-q', '-s', '--no-verify', '-m', `eval(page-integrity): monthly draw ${meta.date}, ${rep.n_judged} pages, seed ${meta.seed} (#${ISSUE})`);
    if (dry) { console.error(git(wt, 'show', '--stat', '--format=%s', 'HEAD')); console.error(git(wt, 'diff', 'HEAD~1', '--', SERIES).split('\n').filter((l) => l.startsWith('+|')).join('\n')); return; }
    git(wt, 'push', '-q', 'origin', branch);
    const pr = spawnSync('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', `eval(page-integrity): monthly draw ${meta.date} (#${ISSUE})`, '--body', `Part of #${ISSUE}. One row on the series and the run's files. No corpus write.\n\n${fs.readFileSync(path.join(out, 'report.md'), 'utf8').slice(0, 6000)}`], { cwd: wt, encoding: 'utf8' });
    const comment = `**Page integrity draw ${meta.date}:** ${pr.stdout.trim() || 'PR not opened: ' + pr.stderr.trim()}\n\n${fs.readFileSync(path.join(out, 'report.md'), 'utf8').slice(0, 12000)}\n\nThese positives are the judge's; a session owes the by-eye read before a rate is quoted or a page is contained.`;
    spawnSync('gh', ['issue', 'comment', String(ISSUE), '--body', comment], { cwd: wt });
    // The verdicts and transcripts stay; the page images are the bulk and can be fetched again from items.json.
    for (const d of fs.readdirSync(path.join(out, 'calls'))) for (const f of fs.readdirSync(path.join(out, 'calls', d))) if (f.endsWith('.jpg')) fs.rmSync(path.join(out, 'calls', d, f));
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: root });
    if (dry) spawnSync('git', ['branch', '-D', branch], { cwd: root });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
  const has = (n) => argv.includes(`--${n}`);
  const today = new Date().toISOString().slice(0, 10);
  const seed = Number(arg('seed', today.replace(/-/g, '')));
  const N = Number(arg('books', '200')), REJUDGE = Number(arg('rejudge', '20')), CONC = Math.min(6, Number(arg('concurrency', '4')));
  const out = path.resolve(arg('out', `${process.env.JOB_SCRATCH || '/tmp'}/page-integrity-${seed}`));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  fs.mkdirSync(out, { recursive: true });
  if (!spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout) { console.error('claude CLI not on PATH'); process.exit(2); }
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI unset: run with node --env-file=.env.production.local'); process.exit(2); }

  if (!fs.existsSync(path.join(out, 'items.json'))) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred', maxPoolSize: 6 });
    await client.connect();
    try { await draw(client.db(process.env.MONGODB_DB || 'bookstore'), { seed, n: N, out }); } finally { await client.close(); }
  }
  if (has('draw-only')) return;
  const { order, items } = JSON.parse(fs.readFileSync(path.join(out, 'items.json'), 'utf8'));
  const byId = new Map(items.map((i) => [i.item, i]));
  let stopReason = null;
  const onStop = (why) => { stopReason = why; };
  const file = path.join(out, 'judgments.jsonl');
  const main = order.map((id) => ({ ...byId.get(id), call: id }));
  const limit = Number(arg('limit', '0'));
  await judgeItems(limit ? main.slice(0, limit) : main, { out, file, conc: CONC, tag: 'judge', onStop });
  if (!stopReason && !limit) {
    const judged = readJsonl(file).filter((r) => r.verdict);
    const mains = judged.filter((r) => r.kind === 'main');
    const flagged = mains.filter((r) => flagsOf(r.verdict).length);
    const clean = mains.filter((r) => !flagsOf(r.verdict).length);
    const rnd = makeRng(seed ^ 0x7f4a7c15);
    const fill = shuffled(clean, rnd).slice(0, Math.max(REJUDGE - flagged.length, 5));
    const rejudge = shuffled([...flagged, ...fill], rnd).map((r) => ({ ...byId.get(r.item), call: `re-${r.item}` }));
    await judgeItems(rejudge, { out, file: path.join(out, 'rejudge.jsonl'), conc: CONC, tag: 'rejudge', onStop });
  }
  if (stopReason) {
    const left = order.length - readJsonl(file).filter((r) => r.verdict || r.cls).length;
    await pageOnce(out, 'page integrity draw stopped', `Usage limit: ${stopReason}. ${left} of ${order.length} items left; re-run with --out ${out} --seed ${seed} to resume. #${ISSUE}`);
    console.error(`STOPPED on a usage limit: ${stopReason}`);
    process.exit(3);
  }
  if (limit) return;

  const sample = JSON.parse(fs.readFileSync(path.join(out, 'sample.json'), 'utf8'));
  const key = new Map(JSON.parse(fs.readFileSync(path.join(out, 'key.json'), 'utf8')).map((k) => [k.item, k]));
  const all = readJsonl(file);
  const rep = computeReport(sample.pages, all.filter((r) => r.kind === 'main' && r.verdict), all.filter((r) => r.kind === 'control').map((r) => ({ ...r, control: key.get(r.item).control })), readJsonl(path.join(out, 'rejudge.jsonl')));
  rep.not_judged = all.filter((r) => r.kind === 'main' && !r.verdict).map((r) => ({ slot: r.slot, cls: r.cls }));
  const meta = { date: sample.date, seed, frame: sample.frame };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ ...meta, ...rep }, null, 1));
  fs.writeFileSync(path.join(out, 'report.md'), renderReport(rep, meta));
  console.error(fs.readFileSync(path.join(out, 'report.md'), 'utf8'));
  if (has('land-dry')) land(out, meta, rep, root, { base: arg('land-base', 'HEAD'), dry: true });
  if (has('land')) {
    try { land(out, meta, rep, root); } catch (e) {
      await pageOnce(out, 'page integrity draw not landed', `${meta.date}: the run finished but did not land: ${e.message}`.slice(0, 500));
      throw e;
    }
    const t = rep.defects;
    await pageOnce(out, 'page integrity draw done', `${meta.date}, n=${rep.n_judged}: text off-leaf ${t["text: a neighbour's leaf"].k + t['text: other book or elsewhere'].k}, English off-text ${t['english: renders a neighbour'].k + t['english: invents'].k}. Judge missed ${rep.judge.miss_rate.k}/${rep.judge.miss_rate.n} controls. #${ISSUE}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
