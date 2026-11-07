#!/usr/bin/env node
// PRIOR ART: profiles-diffqa/judge.mjs (PR #7505: span-req / confirm-req / page-req / score over a FIXED diagnostic
// set and arm outputs) and pass/leafcheck.mjs (audit-req --severity over a cli-ocr read dir against the LIVE draft).
// Neither samples pages the lane has already WRITTEN, and both ask the span judge the old severe/minor question
// (mantra vowel length = severe). The prompt pieces (READOFF, controls, tile cut, reply parser) are judge.mjs's,
// copied word for word; the SEVERITY question is replaced by the three reader-impact classes of classify.py.
/**
 * Real-world severity of the Tibetan Flash correction lane (#6560): pages ALREADY WRITTEN by
 * tib-flash-correct-vol1-6740, wave 2 (every book but Neyphug rGyud Tsha), one page per book, seeded.
 * Read-only: nothing is written to the database.
 *
 *   draw        --n=20 --exclude=hunks-7505.jsonl.gz   sample + Yigdzin draft (the page_revisions row the write replaced)
 *   span-req    the tiled span judge, three classes, over every hunk (draft vs written text)
 *   confirm-req a fresh judge on every draft-win span classed severe (by rule/hand table or, where the rules cannot
 *               settle it, by the judge) and every line-level hunk
 *   page-req    the route-judge whole-page judge on the draft and on the written text
 *   score       [--out=S.json]
 * Files live under --root ($JOB_SCRATCH/realworld). Requests run through replicate-6547/run-claude-arm.py.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { diffSyllables } from '../../../lib/tibetan-yatags-guard.mjs';

const CMD = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const ROOT = arg('root') || path.join(process.env.JOB_SCRATCH || '.', 'realworld');
const J = (...p) => path.join(ROOT, ...p);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const writeJsonl = (f, rows) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); };
const readJson = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const hash = (t) => createHash('sha256').update(t).digest('hex').slice(0, 12);
const NFC = (t) => String(t ?? '').normalize('NFC');
const WAVE1 = '69e7abec5f1a22ab19aa0707';   // Neyphug rGyud Tsha, wave 1

// ── judge.mjs (#7505), word for word ────────────────────────────────────────────────────────────────────────────
function rngFor(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (xs, rng) => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; };
const READOFF = 'You are checking a transcription of a Tibetan Kangyur manuscript against its image. Below are numbered '
  + 'items. Each gives the approximate line (counting from the top of the image; a frame may show two leaves '
  + 'of about 7 lines each, upper leaf first), the syllables just before the spot, and two or more candidate '
  + 'readings for the spot. Look at the image and say which candidate the manuscript actually shows. Judge '
  + 'only by what is written on this leaf, not by what the text ought to say. If none of the candidates '
  + 'matches, answer "other" and write what you see. If you cannot find or read the spot, answer "unclear".\n\n'
  + 'Reply with one JSON object per line, one per item, between two marker lines <<<BEGIN>>> and <<<END>>>, '
  + 'nothing outside the markers: {"item": <n>, "answer": "A"|"B"|"other"|"unclear", "seen": "<what the '
  + 'leaf shows, in Tibetan Unicode>"}\n\nItems:\n';
const TILE_NOTE = '\n\nThe same frame is also cut into four overlapping tiles at full resolution: tile-ul.jpg (upper left), '
  + 'tile-ur.jpg (upper right), tile-ll.jpg (lower left) and tile-lr.jpg (lower right), in this folder. Open the tile '
  + 'that holds a spot to read small marks such as a subscribed letter or a vowel sign.';
const NOTHING = '(nothing: the syllables before go straight on to the syllables after)';
const SWAPS = [['པ', 'བ'], ['བ', 'པ'], ['ད', 'ང'], ['ང', 'ད'], ['ས', 'མ'], ['མ', 'ས'], ['ི', 'ེ'], ['ེ', 'ི'], ['ུ', 'ོ'], ['ོ', 'ུ'], ['ག', 'ཀ'], ['ན', 'ཏ']];
const lineOf = (text, off) => NFC(text).slice(0, off).split('\n').filter((l) => !/^\s*<[^>]+>\s*$/.test(l)).length;
function controls(d, rng, n = 2) {
  const eq = d.pairs.filter(([i, j]) => i !== null && j !== null && d.A[i].syl === d.B[j].syl);
  const out = [];
  for (let t = 0; t < 20 && out.length < n && eq.length > 12; t++) {
    const [, j] = eq[5 + Math.floor(rng() * (eq.length - 10))];
    const s = d.B[j].syl;
    const sw = SWAPS.find(([a]) => s.includes(a));
    if (!sw || out.some((c) => c.j === j)) continue;
    out.push({ kind: 'control', j, base: s, arm: s.replace(sw[0], sw[1]), line: lineOf(d.nextText, d.B[j].start),
      before: d.B.slice(Math.max(0, j - 4), j).map((x) => x.syl).join('་'), after: d.B.slice(j + 1, j + 5).map((x) => x.syl).join('་') });
  }
  return out;
}
function parseReply(text) {
  const m = String(text || '').match(/<<<\s*BEGIN\s*>>>([\s\S]*?)(?:<<<\s*END\s*>>>|$)/);
  const out = {};
  for (let l of (m ? m[1] : String(text || '')).split('\n')) {
    l = l.trim().replace(/,$/, '');
    if (!l.startsWith('{')) continue;
    try { const j = JSON.parse(l); out[Number(j.item)] = j; } catch { /* a malformed line is an unanswered item */ }
  }
  return out;
}
function sideOf(it, ans) {
  const a = String(ans?.answer || '').trim().toUpperCase();
  if (a === 'A' || a === 'B') return (a === 'A') === (it.A_is === 'arm') ? 'arm' : 'base';
  if (a === 'OTHER') return 'other';
  if (a === 'UNCLEAR') return 'unclear';
  return null;
}
async function tiles(pid, image) {
  const sharp = (await import('sharp')).default;
  const dir = J('tiles', pid);
  fs.mkdirSync(dir, { recursive: true });
  const { width: W, height: H } = await sharp(image).metadata();
  const files = [];
  for (const [nm, x0, y0] of [['ul', 0, 0], ['ur', 0.45, 0], ['ll', 0, 0.45], ['lr', 0.45, 0.45]]) {
    const f = path.join(dir, `tile-${nm}.jpg`);
    if (!fs.existsSync(f)) await sharp(image).extract({ left: Math.round(x0 * W), top: Math.round(y0 * H), width: Math.round(0.55 * W), height: Math.round(0.55 * H) }).jpeg({ quality: 92 }).toFile(f);
    files.push(f);
  }
  return files;
}
const isLineHunk = (h) => Math.max(h.a.length, h.b.length) >= 6 && Math.abs(h.a.length - h.b.length) >= 4;

// ── new: the three reader-impact classes (classify.py), asked of the span judge ─────────────────────────────────
const CLASSES = '\n\nFor each item, also say how the candidates differ from EACH OTHER, whichever one is right, as a reader of '
  + 'the text would feel it: "normalisation" if they differ only in the spelling of a mantra, dhāraṇī or Sanskrit word '
  + '(vowel length, anusvara or candrabindu, visarga, a tsheg inside a Sanskrit cluster); "minor" if they are the same '
  + 'word written another way (a particle variant such as ཀྱི/གྱི/གི, a particle added or dropped, a spelling or '
  + 'abbreviation variant, the tense or honorific form of the same verb, tsheg or shad punctuation, a syllable split or '
  + 'joined); "severe" if a reader would get a different text: another word with another meaning, a negation added or '
  + 'lost, a different number or name, or words or a line present in one and missing in the other. Add "diff": '
  + '"normalisation"|"minor"|"severe" to each JSON object.';
function buildPrompt(items, rng, { classes = false } = {}) {
  shuffle(items, rng);
  const lines = items.map((it, n) => {
    const flip = rng() < 0.5;
    const opts = flip ? [it.arm || NOTHING, it.base || NOTHING] : [it.base || NOTHING, it.arm || NOTHING];
    Object.assign(it, { item: n + 1, A_is: flip ? 'arm' : 'base' });
    return `${n + 1}. line ≈ ${it.line || '?'}; just before: ${it.before || '(start)'}; A: ${opts[0]}   B: ${opts[1]}; just after: ${it.after || '(end)'}`;
  });
  return READOFF.replace('\n\nItems:\n', (classes ? CLASSES : '') + '\n\nItems:\n') + lines.join('\n');
}
const classOfJudge = (ans) => { const d = String(ans?.diff || '').trim().toLowerCase(); return ['normalisation', 'minor', 'severe'].includes(d) ? d : null; };
function ruleClass(pairs) {   // classify.py over a batch: [{base, arm}] -> [{class, sub, why}]
  const out = execFileSync('python3', [path.join(HERE, 'classify.py')], { input: pairs.map((p) => `${p.base}→${p.arm}`).join('\n') + '\n', cwd: HERE });
  return String(out).split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const PAGES = () => readJsonl(J('pages.jsonl'));
function hunksOf(p) {
  const d = { ...diffSyllables(NFC(p.draft), NFC(p.text)), nextText: NFC(p.text) };
  return { d, hunks: d.hunks.map((h) => {
    const base = h.a.map((i) => d.A[i].syl).join('་'), arm = h.b.map((j) => d.B[j].syl).join('་');
    const prevJ = h.b.length ? h.b[0] - 1 : (() => { const ib = h.a[0] - 1; const k = d.pairs.findIndex(([i]) => i === ib); for (let x = k; x >= 0; x--) if (d.pairs[x]?.[1] != null) return d.pairs[x][1]; return -1; })();
    const nextJ = h.b.length ? h.b[h.b.length - 1] + 1 : prevJ + 1;
    return { id: `${h.a.length ? `${h.a[0]}-${h.a[h.a.length - 1]}` : `ins@${prevJ}`}|${arm}`, base, arm, line_hunk: isLineHunk(h),
      line: lineOf(d.nextText, d.B[h.b[0]]?.start ?? d.B[Math.max(0, prevJ)]?.end ?? 0),
      before: d.B.slice(Math.max(0, prevJ - 3), prevJ + 1).map((x) => x.syl).join('་'), after: d.B.slice(nextJ, nextJ + 4).map((x) => x.syl).join('་') };
  }) };
}

if (CMD === 'draw') {
  const { MongoClient } = await import('mongodb');
  const { getPageSource } = await import('../../../lib/page-image-url.mjs');
  const n = Number(arg('n') || 20);
  const exclude = new Set();
  if (arg('exclude')) for (const l of zlib.gunzipSync(fs.readFileSync(arg('exclude'))).toString().split('\n').filter(Boolean)) exclude.add(JSON.parse(l).uid);
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  // the frame: pages whose stored OCR is the lane's write (ocr.pipeline tib-correct-6560, Flash-low), wave 2
  const frame = await db.collection('pages').find({ 'ocr.pipeline': 'tib-correct-6560', 'ocr.model': 'gemini-3.8-flash-low', book_id: { $ne: WAVE1 } },
    { projection: { id: 1, book_id: 1, page_number: 1 }, hint: { 'ocr.pipeline': 1, 'ocr.updated_at': 1 } }).toArray();
  const byBook = new Map();
  for (const p of frame) if (!exclude.has(p.id)) (byBook.get(p.book_id) ?? byBook.set(p.book_id, []).get(p.book_id)).push(p);
  const rng = rngFor('6560|severity-check|realworld');
  const books = shuffle([...byBook.keys()].sort(), rng).slice(0, n);
  const pick = books.map((b) => shuffle(byBook.get(b).sort((x, y) => x.page_number - y.page_number), rng)[0]);
  const ids = pick.map((p) => p.id);
  const pages = await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.updated_at': 1 } }).toArray();
  // the draft: the Yigdzin text the write replaced = the newest Yigdzin ocr row in page_revisions
  const revs = await db.collection('page_revisions').find({ page_id: { $in: ids }, field: 'ocr', model: 'bdrc-yigdzin-v1' }, { projection: { page_id: 1, data: 1, created_at: 1, run_id: 1 } }).sort({ created_at: -1 }).toArray();
  const titles = Object.fromEntries((await db.collection('books').find({ id: { $in: books } }, { projection: { id: 1, title: 1 } }).toArray()).map((b) => [b.id, b.title]));
  await c.close();
  fs.mkdirSync(J('img'), { recursive: true });
  const rows = [];
  for (const id of ids) {
    const p = pages.find((x) => x.id === id); const r = revs.find((x) => x.page_id === id && x.data?.trim());
    if (!p || !r) { console.log(`no draft for ${id}: left out`); continue; }
    const img = J('img', `${id}.jpg`);
    if (!fs.existsSync(img)) { const res = await fetch(getPageSource(p)); if (!res.ok) { console.log(`image HTTP ${res.status} for ${id}`); continue; } fs.writeFileSync(img, Buffer.from(await res.arrayBuffer())); }
    rows.push({ uid: id, book_id: p.book_id, title: titles[p.book_id], page_number: p.page_number, image: img, draft: r.data, text: p.ocr.data, written_at: p.ocr.updated_at, run_id: r.run_id ?? null });
  }
  writeJsonl(J('pages.jsonl'), rows);
  fs.writeFileSync(J('sample.json'), JSON.stringify({ drawn_at: new Date().toISOString(), seed: '6560|severity-check|realworld',
    frame: { pages: frame.length, books: byBook.size, rule: "pages.ocr.pipeline = tib-correct-6560 AND ocr.model = gemini-3.8-flash-low, book != Neyphug rGyud Tsha (wave 1), not in #7505's 72-page set" },
    pages: rows.map(({ uid, book_id, title, page_number, written_at, run_id }) => ({ uid, book_id, title, page_number, written_at, run_id })) }, null, 1));
  console.log(`frame ${frame.length} written wave-2 pages in ${byBook.size} books; drew ${rows.length}`);
} else if (CMD === 'span-req' || CMD === 'confirm-req') {
  const reqs = [], key = {};
  const span = CMD === 'confirm-req' ? readJson(J('span-key.json')) : null;
  const spanRep = CMD === 'confirm-req' ? Object.fromEntries(readJsonl(J('span-out.jsonl')).filter((r) => r.text).map((r) => [r.uid, parseReply(r.text)])) : null;
  for (const p of PAGES()) {
    const { d, hunks } = hunksOf(p);
    if (!hunks.length) continue;
    let items;
    if (CMD === 'span-req') items = hunks.map((h) => ({ kind: 'span', hunk: h.id, base: h.base, arm: h.arm, line: h.line, before: h.before, after: h.after, line_hunk: h.line_hunk }));
    else {
      const k = span[p.uid]; const ans = spanRep[p.uid];
      if (!k || !ans) continue;
      const sp = k.items.filter((it) => it.kind === 'span');
      const rc = ruleClass(sp);
      items = sp.filter((it, x) => it.line_hunk || (sideOf(it, ans[it.item]) === 'base'
        && (rc[x].class === 'severe' || (rc[x].class === '?' && classOfJudge(ans[it.item]) === 'severe'))))
        .map(({ item, A_is, ...it }) => ({ ...it, orig_item: item }));
      if (!items.length) continue;
    }
    const rng = rngFor(`6560|severity-check|${CMD}|${p.uid}`);
    items.push(...controls(d, rng));
    reqs.push({ uid: p.uid, image: p.image, prompt: buildPrompt(items, rng, { classes: CMD === 'span-req' }) + TILE_NOTE, extra_images: await tiles(p.uid, p.image) });
    key[p.uid] = { items };
  }
  const kind = CMD === 'span-req' ? 'span' : 'confirm';
  writeJsonl(J(`${kind}-req.jsonl`), reqs);
  fs.writeFileSync(J(`${kind}-key.json`), JSON.stringify(key));
  console.log(`${kind}-req: ${reqs.length} requests, ${Object.values(key).reduce((s, k) => s + k.items.filter((i) => i.kind === 'span').length, 0)} spans`);
} else if (CMD === 'page-req') {
  const { judgePrompt } = await import('../../route-judge-6740/judge.mjs');
  const reqs = [];
  for (const p of PAGES()) for (const [v, t] of [['draft', p.draft], ['written', p.text]]) {
    reqs.push({ uid: `${p.uid}|${v}|${hash(NFC(t))}`, image: p.image, prompt: judgePrompt({ task: 'ocr', lang: 'Tibetan', text: NFC(t) }, 'the file ./page.jpg in your working directory (open it with Read before you answer)') });
  }
  writeJsonl(J('page-req.jsonl'), reqs);
  console.log(`page-req: ${reqs.length}`);
} else if (CMD === 'score') {
  const parseJ = (t) => { const m = String(t || '').match(/\{[\s\S]*\}/); if (!m) return null; try { const v = JSON.parse(m[0]); return typeof v.accept === 'boolean' ? v : null; } catch { return null; } };
  const PJ = Object.fromEntries(readJsonl(J('page-out.jsonl')).filter((r) => r.text).map((r) => [r.uid, parseJ(r.text)]));
  const code = (x) => String(x.class || '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? 'E2';
  const wt = (v) => (v?.defects || []).filter((x) => x.severity === 'wrong_text' && code(x) !== 'O8');
  const span = readJson(J('span-key.json'), {}), conf = readJson(J('confirm-key.json'), {});
  const SR = Object.fromEntries(readJsonl(J('span-out.jsonl')).filter((r) => r.text).map((r) => [r.uid, parseReply(r.text)]));
  const CR = Object.fromEntries(readJsonl(J('confirm-out.jsonl')).filter((r) => r.text).map((r) => [r.uid, parseReply(r.text)]));
  const ctl = { span: [0, 0], confirm: [0, 0] };
  const rows = [];
  for (const p of PAGES()) {
    const k = span[p.uid]; const ans = SR[p.uid] || {};
    const sp = (k?.items || []).filter((it) => it.kind === 'span');
    for (const it of (k?.items || []).filter((x) => x.kind === 'control')) { ctl.span[1]++; if (sideOf(it, ans[it.item]) === 'base') ctl.span[0]++; }
    const ck = conf[p.uid]; const cans = CR[p.uid] || {};
    for (const it of (ck?.items || []).filter((x) => x.kind === 'control')) { ctl.confirm[1]++; if (sideOf(it, cans[it.item]) === 'base') ctl.confirm[0]++; }
    const cside = Object.fromEntries((ck?.items || []).filter((x) => x.kind === 'span').map((it) => [it.hunk, sideOf(it, cans[it.item])]));
    const rc = sp.length ? ruleClass(sp) : [];
    const spans = sp.map((it, x) => {
      const judge = classOfJudge(ans[it.item]);
      const cls = rc[x].class === '?' ? (judge ?? 'severe') : rc[x].class;
      return { base: it.base, arm: it.arm, line: it.line, line_hunk: it.line_hunk, side: sideOf(it, ans[it.item]) ?? 'unanswered', seen: ans[it.item]?.seen ?? null,
        judge_class: judge, rule_class: rc[x].class, class: cls, sub: rc[x].sub, confirm: cside[it.hunk] ?? null };
    });
    const intro = spans.filter((s) => s.side === 'base'), fixed = spans.filter((s) => s.side === 'arm');
    const sevC = intro.filter((s) => (s.class === 'severe' || s.line_hunk) && s.confirm === 'base');
    const a = PJ[`${p.uid}|draft|${hash(NFC(p.draft))}`], b = PJ[`${p.uid}|written|${hash(NFC(p.text))}`];
    const ca = new Set(wt(a).map(code)), cb = new Set(wt(b).map(code));
    const pageAdded = !!(a && b && (wt(b).length > wt(a).length || [...cb].some((x) => !ca.has(x))));
    const span_v = intro.length > fixed.length ? 'worse' : fixed.length > intro.length ? 'better' : 'same';
    const page_v = a && b ? (Number(b.fidelity) < Number(a.fidelity) || (a.accept && !b.accept) || (!wt(a).length && wt(b).length) ? 'worse' : Number(b.fidelity) > Number(a.fidelity) ? 'better' : 'same') : null;
    rows.push({ uid: p.uid, book_id: p.book_id, title: p.title, page_number: p.page_number, hunks: spans.length,
      fixed: fixed.length, introduced: intro.length,
      introduced_by_class: Object.fromEntries(['normalisation', 'mantra', 'minor', 'severe'].map((c) => [c, intro.filter((s) => s.class === c).length])),
      severe_span_confirmed: sevC.map((s) => `${s.base || '∅'}→${s.arm || '∅'} (l.${s.line}; seen ${s.seen ?? '-'})`),
      page_added: pageAdded, page_added_defects: pageAdded ? wt(b).map((x) => `${code(x)} ${String(x.what ?? '').slice(0, 160)} «${String(x.quote ?? '').slice(0, 60)}»`) : [],
      severe: sevC.length > 0 || pageAdded, span_verdict: span_v, page_verdict: page_v,
      accept: a && b ? `${a.accept}->${b.accept}` : null, fidelity: a && b ? `${a.fidelity}->${b.fidelity}` : null, spans });
  }
  const n = rows.length, k = rows.filter((r) => r.severe).length;
  const wilson = (k, n, z = 1.96) => { const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - h) / d, (c + h) / d].map((x) => Math.round(1000 * x) / 1000); };
  const rng = rngFor('6560|severity-check|boot'); const boot = [];
  for (let i = 0; i < 4000; i++) { let s = 0; for (let j = 0; j < n; j++) s += rows[Math.floor(rng() * n)].severe ? 1 : 0; boot.push(s / n); }
  boot.sort((x, y) => x - y);
  const out = { scored_at: new Date().toISOString(), pages: n, books: new Set(rows.map((r) => r.book_id)).size,
    severe_pages: k, severe_per10: Math.round(100 * k / n) / 10, wilson95: wilson(k, n), by_book_bootstrap95: [boot[100], boot[3899]],
    severe_from: { span_only: rows.filter((r) => r.severe_span_confirmed.length && !r.page_added).length, page_only: rows.filter((r) => !r.severe_span_confirmed.length && r.page_added).length, both: rows.filter((r) => r.severe_span_confirmed.length && r.page_added).length },
    span_verdicts: Object.fromEntries(['better', 'same', 'worse'].map((v) => [v, rows.filter((r) => r.span_verdict === v).length])),
    page_verdicts: Object.fromEntries(['better', 'same', 'worse'].map((v) => [v, rows.filter((r) => r.page_verdict === v).length])),
    spans: { fixed: rows.reduce((s, r) => s + r.fixed, 0), introduced: rows.reduce((s, r) => s + r.introduced, 0),
      introduced_by_class: Object.fromEntries(['normalisation', 'mantra', 'minor', 'severe'].map((c) => [c, rows.reduce((s, r) => s + r.introduced_by_class[c], 0)])) },
    controls: { span: ctl.span, confirm: ctl.confirm }, rows };
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(out, null, 1));
  const { rows: _r, ...head } = out; console.log(JSON.stringify(head, null, 1));
  for (const r of rows) console.log(`${r.severe ? 'SEVERE' : '      '} p.${r.page_number} ${r.book_id.slice(-6)} fixed ${r.fixed} intro ${r.introduced} ${JSON.stringify(r.introduced_by_class)} span ${r.span_verdict} page ${r.page_verdict} | ${r.severe_span_confirmed.join('; ')} | ${r.page_added_defects.join(' ;; ')}`);
} else {
  console.error('usage: realworld.mjs draw|span-req|confirm-req|page-req|score (see the header)');
  process.exitCode = 2;
}
