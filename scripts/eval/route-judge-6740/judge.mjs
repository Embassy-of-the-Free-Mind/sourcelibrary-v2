#!/usr/bin/env node
// PRIOR ART: scripts/eval/translate-cli-lane-7075/sample.mjs — its draw (one page per book, seeded by page id), blind
// packet with a key, wrong-page control and two-family judge loop are reused here (claudeCall's env scrub, parseJson,
// agy-cli's gated call). It does not fit as is: it judges translations only, PAIRWISE, from the OCR text alone, with a
// 1-5 score and no defect tags. This instrument reads ONE output at a time against the PAGE IMAGE (OCR and translation
// alike), tags defects with the page-error-taxonomy classes, and runs across four cells whose routes come from three
// different places (the live page, a page_revisions draft, an eval's kept reads).
/**
 * Same-judge, image-grounded, qualitative read of what routes produced (#6740). Every route in every cell is judged by
 * ONE judge, Opus through `claude -p`, with the same prompt, blind to the route, one output per call, the page image
 * attached. Opus is the REFERENCE (ASSUMED, Derek 2026-10-25: "Assume Opus is ok; we are mostly looking for enhanced
 * cost"): the question per page is whether the cheaper route's output matches what Opus reads there, and per route what
 * a usable page costs against Opus direct.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/route-judge-6740/judge.mjs draw   --out=DIR [--n=30]
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/route-judge-6740/judge.mjs packet --out=DIR
 *   node scripts/eval/route-judge-6740/judge.mjs judge --out=DIR [--concurrency=2] [--cell=latin] [--limit=N]
 *   node scripts/eval/route-judge-6740/judge.mjs score --out=DIR
 *
 * CELLS (each an open routing decision) and where the Opus reference comes from:
 *   latin    Latin print OCR. Tested: lite as served. Reference: the #5924 Opus correction of the same page (oc-reads;
 *            never written to pages). A page Opus left 'unchanged' matches by construction and is not called.
 *   chinese  Chinese OCR. Tested: the Paddle draft (page_revisions, reason opus_correct_6561). Reference: the SERVED
 *            Opus correction of the same page (#6561).
 *   tibetan  Tibetan OCR. Tested: Yigdzin as served, and the Flash 3.8 low correction of the #6560 gate volume (never
 *            written). Reference: Opus reads the leaf itself inside the judging call.
 *   german   German translation. Tested: 3 Flash and Flash-Lite as served (#7263). Reference: Opus reads the leaf and
 *            the OCR itself inside the judging call (no served Opus German English in the frame).
 *
 * VERDICT per page: accept (would a reader accept this page in place of the Opus read), matches_reference, a 1-5
 * fidelity score (for the estimator rows), defects tagged with the 44 page-error-taxonomy classes, each with a quoted
 * span and a severity, and a one-line note of what a reader would notice.
 *
 * CONTROL per cell x route: two wrong-page items (this page's image, another drawn page's output from the same route).
 * The judge passes a cell when it accepts neither and scores both <= 2; a cell whose control fails does not count.
 *
 * PACE: the judge does not call while this box's Claude account is at or above ROUTE_JUDGE_WEEKLY_MAX (85) of its
 * week (model-limits.mjs). Read-only: no writes to pages or books. Large files (packet, verdicts) live in DIR, under
 * $JOB_SCRATCH; the committed summary is score.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../lib/paired-stats.mjs';
import { parseJson } from '../translate-cli-lane-7075/sample.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const STAGE = process.argv[2];
const OUT = arg('out') && path.resolve(arg('out'));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1));
const N = Number(arg('n') || 30);
const LATIN_READS = path.join(ROOT, 'scripts/eval/flash-reread-5924/results/oc-reads.jsonl.gz');
const TIB_VOL = process.env.TIB_VOL || '/mnt/HC_Volume_105839809/jobs/tib-flash-pass-6560/vol/69e7aaba80b52390feb199b8';
const LITE = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview'];
const FLASH3 = ['gemini-3-flash-preview'];
const OPUS = ['claude-opus-5-5'];

/** One page per book in a seeded order; a second round per book only when there are fewer books than n. */
function onePerBook(rows, n, salt) {
  const byBook = new Map();
  for (const r of [...rows].sort((a, b) => h(salt + a.page_id).localeCompare(h(salt + b.page_id)))) byBook.set(r.book_id, [...(byBook.get(r.book_id) ?? []), r]);
  const books = [...byBook].sort((a, b) => h(salt + a[0]).localeCompare(h(salt + b[0])));
  const out = [];
  for (let round = 0; out.length < n && round < 20; round++) for (const [, l] of books) if (l[round] && out.length < n) out.push(l[round]);
  return out;
}

async function draw() {
  const { MongoClient } = await import('mongodb');
  const { SKIP_TRANSLATION_PAGE_TYPES } = await import('../../lib/translate-core.mjs');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const cells = {};

  // latin: the #5924 Opus-correct pages, minus the wrong-leaf book whose 25 pages the corrector CONTAINed.
  const oc = zlib.gunzipSync(fs.readFileSync(LATIN_READS)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.outcome !== 'contain');
  const lat = onePerBook(oc.map((r) => ({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number })), N, 'latin');
  cells.latin = { task: 'ocr', lang: 'Latin', paired: true, routes: ['lite'], reference: 'opus-correct (#5924 oc-reads)', pages: lat,
    frame: { pages: oc.length, books: new Set(oc.map((r) => r.book_id)).size, note: '#5924 oc-reads: 250 lite Latin pages in 10 books; the wrong-leaf book (25 CONTAIN pages) left out' } };

  // chinese: pages whose served OCR is the #6561 Opus correction; the Paddle draft is the revision it superseded.
  // Tables are the cell's question (#6561 / #7275): pages whose Paddle draft holds a markdown table come first.
  const isTable = (t) => /\|[^\n]*\|[^\n]*\|/.test(t || '') || /<table|<td/.test(t || '');
  const revs = (await db.collection('page_revisions').find({ field: 'ocr', reason: 'opus_correct_6561' }, { projection: { page_id: 1, book_id: 1, model: 1, created_at: 1, data: 1 } }).toArray())
    .map(({ data, ...r }) => ({ ...r, table: isTable(data) }));
  const zhIds = revs.map((r) => r.page_id);
  const zhLive = new Map((await db.collection('pages').find({ id: { $in: zhIds } }, { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.model': 1, 'ocr.updated_at': 1 } }).toArray()).map((p) => [p.id, p]));
  const zhOk = revs.filter((r) => { const p = zhLive.get(r.page_id); return p && OPUS.includes(p.ocr?.model) && new Date(p.ocr.updated_at) >= new Date(r.created_at); })
    .map((r) => ({ page_id: r.page_id, book_id: zhLive.get(r.page_id).book_id, page_number: zhLive.get(r.page_id).page_number, page_type: zhLive.get(r.page_id).page_type ?? null, table: r.table }));
  const zhTab = onePerBook(zhOk.filter((r) => r.table), N, 'chinese');
  const zhPick = [...zhTab, ...onePerBook(zhOk.filter((r) => !r.table && !zhTab.some((t) => t.book_id === r.book_id)), N - zhTab.length, 'chinese')];
  cells.chinese = { task: 'ocr', lang: 'Chinese', paired: true, routes: ['paddle'], reference: 'opus-correct as served (#6561)', pages: zhPick,
    frame: { revisions: revs.length, served_opus_still: zhOk.length, books: new Set(zhOk.map((r) => r.book_id)).size, table_drafts: zhOk.filter((r) => r.table).length, table_books: new Set(zhOk.filter((r) => r.table).map((r) => r.book_id)).size, drawn_tables: zhTab.length } };

  // tibetan: the #6560 gate volume; the stored Yigdzin read must still be the draft the corrector saw.
  const metas = fs.readdirSync(TIB_VOL).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(TIB_VOL, f), 'utf8'))).filter((m) => m.exit === 0 && m.draft?.model === 'bdrc-yigdzin-v1');
  const tibLive = new Map((await db.collection('pages').find({ id: { $in: metas.map((m) => m.page_id) } }, { projection: { id: 1, 'ocr.model': 1, 'ocr.content_hash': 1 } }).toArray()).map((p) => [p.id, p]));
  const tibOk = metas.filter((m) => { const p = tibLive.get(m.page_id); return p && p.ocr?.model === 'bdrc-yigdzin-v1' && (!p.ocr.content_hash || p.ocr.content_hash === m.draft.content_hash); });
  // One volume: one page per book is impossible, so the draw is seeded over pages and the interval is by page.
  const tibPick = [...tibOk].sort((a, b) => h('tibetan' + a.page_id).localeCompare(h('tibetan' + b.page_id))).slice(0, N).map((m) => ({ page_id: m.page_id, book_id: m.book_id, page_number: m.page_number }));
  cells.tibetan = { task: 'ocr', lang: 'Tibetan', paired: true, routes: ['yigdzin', 'yigdzin>flash-low-correct'], reference: 'opus reads the leaf in the call', pages: tibPick,
    frame: { pages: metas.length, still_draft: tibOk.length, books: 1, note: 'one volume (rGyud bum Kha, the #6560 gate): intervals are by page, not by book' } };

  // german: one frame, three served translation routes, one page per book per route.
  const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, language: { $regex: '^German', $options: 'i' }, year: { $gte: 1500, $lte: 1800 } }, { projection: { id: 1, title: 1, year: 1 } }).toArray();
  const toDate = (f) => ({ $convert: { input: f, to: 'date', onError: null, onNull: null } });
  const de = await db.collection('pages').aggregate([
    { $match: { book_id: { $in: books.map((b) => b.id) }, page_number: { $gt: 0 }, page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES }, 'translation.model': { $in: [...FLASH3, ...LITE, ...OPUS] }, 'ocr.data': { $type: 'string' }, 'translation.data': { $type: 'string' } } },
    { $match: { $expr: { $and: [{ $gte: [{ $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $strLenCP: '$ocr.data' }, 0] }, 300] }, { $gte: [toDate('$translation.updated_at'), toDate('$ocr.updated_at')] }] } } },
    { $project: { _id: 0, id: 1, book_id: 1, page_number: 1, 'translation.model': 1, 'translation.source': 1 } },
  ], { allowDiskUse: true }).toArray();
  const deRoute = (m) => (FLASH3.includes(m) ? 'flash3' : LITE.includes(m) ? 'flash-lite' : 'opus-cli');
  const dePages = [];
  const deFrame = {};
  for (const route of ['flash3', 'flash-lite', 'opus-cli']) {
    const rows = de.filter((p) => deRoute(p.translation.model) === route).map((p) => ({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, route, tr_source: p.translation.source ?? null }));
    deFrame[route] = { pages: rows.length, books: new Set(rows.map((r) => r.book_id)).size, sources: rows.reduce((a, r) => ({ ...a, [r.tr_source]: (a[r.tr_source] ?? 0) + 1 }), {}) };
    dePages.push(...onePerBook(rows, N, `german-${route}`));
  }
  cells.german = { task: 'translation', lang: 'German', paired: false, reference: 'opus reads the leaf and OCR in the call', routes: ['flash3', 'flash-lite', 'opus-cli'].filter((r) => dePages.some((p) => p.route === r)), pages: dePages,
    frame: { books: books.length, routes: deFrame, note: 'visible German books dated 1500-1800; English newer than the OCR' } };

  await c.close();
  fs.mkdirSync(OUT, { recursive: true });
  W('sample.json', { drawn_at: new Date().toISOString(), n: N, cells });
  for (const [k, v] of Object.entries(cells)) console.log(`${k}: ${v.pages.length} pages from ${new Set(v.pages.map((p) => p.book_id)).size} books; frame ${JSON.stringify(v.frame)}`);
}


async function packet() {
  const { MongoClient } = await import('mongodb');
  const { getPageSource } = await import('../../lib/page-image-url.mjs');
  const s = J('sample.json');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const all = Object.values(s.cells).flatMap((x) => x.pages.map((p) => p.page_id));
  const pages = new Map((await db.collection('pages').find({ id: { $in: all } }, { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, 'ocr.data': 1, 'ocr.model': 1, 'translation.data': 1, 'translation.model': 1 } }).toArray()).map((p) => [p.id, p]));
  // The newest opus_correct_6561 revision of a page is the draft the served correction replaced.
  const zhDraft = new Map((await db.collection('page_revisions').find({ field: 'ocr', reason: 'opus_correct_6561', page_id: { $in: s.cells.chinese.pages.map((p) => p.page_id) } }, { projection: { page_id: 1, data: 1, created_at: 1 } }).sort({ created_at: 1 }).toArray()).map((r) => [r.page_id, r.data]));
  await c.close();
  const oc = new Map(zlib.gunzipSync(fs.readFileSync(LATIN_READS)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.page_id, r]));
  const tibText = (id) => { try { return fs.readFileSync(path.join(TIB_VOL, `${id}.txt`), 'utf8').trim(); } catch { return null; } };
  const lite = (p) => (LITE.includes(p?.ocr?.model) ? p.ocr.data : null);

  // The output each tested route produced for a page, and the Opus reference text where one is held (else null:
  // the judge reads the leaf itself).
  const output = (cell, route, id) => {
    const p = pages.get(id);
    if (cell === 'latin') return lite(p);
    if (cell === 'chinese') return zhDraft.get(id) ?? null;
    if (cell === 'tibetan') return route === 'yigdzin' ? (p?.ocr?.model === 'bdrc-yigdzin-v1' ? p.ocr.data : null) : tibText(id);
    return p?.translation?.data ?? null;
  };
  const reference = (cell, id) => {
    const p = pages.get(id);
    if (cell === 'latin') { const r = oc.get(id); return r?.outcome === 'unchanged' ? lite(p) : r?.text || null; }
    if (cell === 'chinese') return OPUS.includes(p?.ocr?.model) ? p.ocr.data : null;
    return null;
  };
  const items = [], key = [], skipped = [];
  const add = (cell, route, sp, kind, text, extra = {}) => {
    const p = pages.get(sp.page_id), cs = s.cells[cell];
    const id = `j${h(`${kind}:${cell}:${route}:${sp.page_id}:${extra.other ?? ''}`).slice(0, 10)}`;
    const ref = reference(cell, sp.page_id);
    // Latin pages Opus left 'unchanged' match by construction: kept in the key, not sent to the judge.
    const identity = kind === 'item' && cell === 'latin' && oc.get(sp.page_id)?.outcome === 'unchanged';
    if (!identity) items.push({ id, task: cs.task, lang: cs.lang, image_url: getPageSource(p), text, reference: ref ?? undefined, source: cs.task === 'translation' ? p.ocr?.data ?? '' : undefined });
    key.push({ id, cell, route, kind, page_id: sp.page_id, book_id: sp.book_id, page_number: sp.page_number, identity, has_reference_text: ref != null, ...extra });
  };
  for (const [cell, cs] of Object.entries(s.cells)) {
    for (const route of cs.routes) {
      const mine = cs.paired ? cs.pages : cs.pages.filter((p) => p.route === route);
      const ok = mine.filter((sp) => {
        const p = pages.get(sp.page_id), t = output(cell, route, sp.page_id);
        const needRef = cell === 'latin' || cell === 'chinese';
        const good = p && getPageSource(p) && t?.trim() && (!needRef || reference(cell, sp.page_id)?.trim());
        if (!good) skipped.push({ cell, route, page_id: sp.page_id, why: !p ? 'page gone' : !getPageSource(p) ? 'no image' : !t?.trim() ? 'no output' : 'no reference' });
        return good;
      });
      for (const sp of ok) add(cell, route, sp, 'item', output(cell, route, sp.page_id));
      // Wrong-page controls: this page's image (and reference), the output this route made for a page of ANOTHER
      // book (in the one-volume cell, a page half the draw away).
      for (let i = 0; i < 2 && ok.length > 2; i++) {
        const sp = ok[i];
        const other = ok.find((o, j) => j >= Math.floor(ok.length / 2) + i && o.book_id !== sp.book_id) ?? ok[(i + Math.floor(ok.length / 2)) % ok.length];
        add(cell, route, sp, 'wrong_page', output(cell, route, other.page_id), { other: other.page_id });
      }
    }
  }
  const order = items.map((it, i) => [h(`order:${it.id}`), i]).sort((a, b) => a[0].localeCompare(b[0])).map(([, i]) => i);
  W('packet.json', { items: order.map((i) => items[i]) });
  W('key.json', key);
  W('packet-skipped.json', skipped);
  const tally = {}; for (const k of key) { const t = `${k.cell}/${k.route}/${k.kind}${k.identity ? '/identity' : ''}`; tally[t] = (tally[t] ?? 0) + 1; }
  console.log(`packet: ${items.length} judge calls; ${key.length} keyed rows; skipped ${skipped.length}`); console.log(tally);
}

// The 44 classes of .claude/docs/page-error-taxonomy.md, by code and name: the judge tags with these, nothing else.
export const TAXONOMY = `I1 image one leaf away from its text; I2 duplicate scan; I3 spread not split; I4 neighbour strip read as content; I5 several leaves in one photo; I6 pages reversed; I7 catalogue identity wrong;
O1 confabulation on an illegible or unfamiliar leaf (text not on the page); O2 wrong-script fabrication; O3 canonical-text substitution (a known text put in place of what the leaf says); O4 block-level repetition (lines or blocks duplicated); O5 silent omission inside the page; O6 meaning-changing misread; O7 numerals, dates, doses and units wrong; O8 silent normalisation toward the expected; O9 convention flips between pages; O10 secondary script dropped or garbled; O11 page furniture mis-tagged; O12 marginalia and apparatus dropped, merged or mis-tagged; O13 later hands read as text; O14 non-linear content described, not transcribed; O15 reasoning or notes inside the transcription; O16 self-reported tags wrong; O17 table structure invented or lost (columns dropped, cells merged, re-laid); O18 page left empty;
T1 translation truncated; T2 echoed source; T3 translation hidden inside a meta/note wrapper; T4 in-block drift / tail block shift; T5 continuity leak or lookahead duplication; T6 catchword and split-word seams; T7 fluent English over a garbled source, no uncertainty; T8 sense inverted or a qualifier dropped; T9 quiet omission; T10 invented scholarship in notes and glosses; T11 parallel edition mishandled; T12 same-language source rewritten; T13 apparatus stripped; T14 the two panes from different reads; T15 continuity meta wrong; T16 form imposed or lost; T17 reasoning or a chat reply stored as the translation;
D1 markup broken or unknown to the renderer; E2 other (say what)`;

export function judgePrompt(it, imageRef) {
  const ocr = it.task === 'ocr';
  const thing = ocr ? 'transcription' : 'translation';
  const refBlock = it.reference
    ? `REFERENCE ${ocr ? 'TRANSCRIPTION' : 'TRANSLATION'} (a careful reading of this leaf; check it against the image too, and where the image and the reference disagree, the image wins):
"""
${it.reference}
"""

`
    : `There is no reference text: read the leaf yourself, closely, as the reference${ocr ? '' : ' (the transcription and the image together)'}, and compare the candidate with what you read.

`;
  const head = ocr
    ? `You are checking a candidate transcription of one page of a historical ${it.lang} book against the page image, for a library that publishes the transcription beside the image.

The page image is attached: ${imageRef}

`
    : `You are checking a candidate English translation of one page of a historical ${it.lang} book, for a library that publishes it beside the original. The transcription may contain recognition errors; the image is the authority.

The page image is attached: ${imageRef}

TRANSCRIPTION (${it.lang}):
"""
${it.source}
"""

`;
  return `${head}${refBlock}CANDIDATE ${thing.toUpperCase()}:
"""
${it.text}
"""

Questions:
- matches_reference: does the candidate give a reader the same text as the reference reading (${ocr ? 'every line, in order, the same words and numerals; spelling conventions and markup aside' : 'the same statements, negations, names and numbers; style aside'})? true or false.
- accept: would a reader of this library be served as well by the candidate as by the reference, so that publishing the candidate instead loses nothing that matters? true or false.
- fidelity: 1-5 to the page (5 = faithful and complete, 4 = small slips that mislead no one, 3 = usable with real errors, 2 = substantially wrong or incomplete, 1 = not this page's ${ocr ? 'text' : 'translation'} at all).
- defects: every defect in the CANDIDATE, each tagged with ONE class code from this list (E2 only if nothing fits):
${TAXONOMY}
  with a short verbatim quote of the offending span from the candidate and a severity: "cosmetic" (no reader is misled), "misleads" (a reader would understand something not quite on the page) or "wrong_text" (the candidate says something the page does not: invented, duplicated, dropped, another page, a wrong word that changes the sense).
- reader_note: one line, what a reader of this page would notice.

Tags such as <page-type>, <scan-quality>, <header>, <note>, <meta>, <margin> and markdown tables are the library's markup; judge them only where they misplace or drop the page's content.

Answer with one JSON object only: {"matches_reference": bool, "accept": bool, "fidelity": n, "defects": [{"class": "O6", "quote": "...", "severity": "misleads", "what": "a few words"}], "reader_note": "..."}`;
}

const parseVerdict = (t) => parseJson(t, (v) => typeof v.accept === 'boolean' && Number(v.fidelity) >= 1 && Number(v.fidelity) <= 5 && Array.isArray(v.defects ?? []));

const QUOTA = /usage limit|limit reached|hit your (?:usage )?limit|rate.?limit|out of extra usage/i;
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
/** Opus with the image in its workspace and Read as its only tool (replicate-6547/run-claude-arm.py's call). */
function opusCall(prompt, cwd) {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/claude', ['-p', '--model', 'opus', '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 600e3);
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {}; try { j = JSON.parse(out); } catch { /* not JSON */ }
      const text = String(j.result ?? '');
      resolve({ text, cls: (j.is_error || code !== 0) && QUOTA.test(text + out + err) ? 'quota' : code !== 0 ? `exit_${code}` : null, model: Object.keys(j.modelUsage || {})[0] ?? null });
    });
  });
}

async function judge() {
  const only = arg('cell'), limit = Number(arg('limit') || Infinity);
  const key = new Map(J('key.json').map((k) => [k.id, k]));
  const pk = J('packet.json').items.filter((it) => !only || key.get(it.id).cell === only);
  const file = path.join(OUT, 'verdicts-opus.jsonl');
  const done = new Set(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.verdict).map((r) => r.id) : []);
  const limits = await import('../../lib/model-limits.mjs');
  // The brief's ceiling: this box's Claude account stays under 85% of its week.
  const WEEKLY = Number(process.env.ROUTE_JUDGE_WEEKLY_MAX || 85);
  let stop = false, calls = 0;
  const one = async (it) => {
    if (stop || calls >= limit) return;
    const b = limits.claudeBlocked({ weeklyMax: WEEKLY, sessionMax: 95 });
    if (b) { console.log(`claude blocked: ${b.reason} (until ${b.until}); stopping`); stop = true; return; }
    calls++;
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'rj-opus-'));
    try {
      const res = await fetch(it.image_url);
      if (!res.ok) { fs.appendFileSync(file, JSON.stringify({ id: it.id, verdict: null, raw: `image HTTP ${res.status}` }) + '\n'); return; }
      fs.writeFileSync(path.join(ws, 'page.jpg'), Buffer.from(await res.arrayBuffer()));
      const r = await opusCall(judgePrompt(it, 'the file ./page.jpg in your working directory (open it with Read before you answer)'), ws);
      if (r.cls === 'quota') { console.log('claude quota: stopping'); stop = true; limits.noteLimitHit('claude', { reason: r.text.slice(0, 200) }); return; }
      const v = parseVerdict(r.text);
      fs.appendFileSync(file, JSON.stringify({ id: it.id, judge: 'opus', model: r.model, cls: r.cls, verdict: v, raw: v ? undefined : String(r.text).slice(0, 500), at: new Date().toISOString() }) + '\n');
      console.log(`  ${it.id}: ${v ? `accept=${v.accept} match=${v.matches_reference} ${v.fidelity} (${(v.defects || []).length} defects)` : `unparsed ${r.cls ?? ''}`}`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  const todo = pk.filter((it) => !done.has(it.id));
  console.log(`opus: ${todo.length} of ${pk.length} items to judge`);
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 2)));
  let i = 0;
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < todo.length && calls < limit) await one(todo[i++]); }));
}

// ------------------------------------------------------------------------------------------------ score
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
/** Cluster (by-book) bootstrap 95% interval of the mean of rows[].v; by page when the cell is one or two books. */
function clusterCI(rows, seed) {
  const books = [...new Set(rows.map((r) => r.book))];
  const byPage = books.length < 3;
  const units = byPage ? rows.map((r) => [r.v]) : books.map((b) => rows.filter((r) => r.book === b).map((r) => r.v));
  if (!units.length) return { ci95: null, unit: byPage ? 'page' : 'book', units: 0 };
  const rnd = makeRng(seed);
  const boots = Array.from({ length: 4000 }, () => { const s = []; for (let i = 0; i < units.length; i++) s.push(...units[Math.floor(rnd() * units.length)]); return mean(s); }).sort((a, b) => a - b);
  return { ci95: [+boots[100].toFixed(2), +boots[3899].toFixed(2)], unit: byPage ? 'page' : 'book', units: units.length };
}

/** Cost of one page on each tested route, in the route's own unit, from scripts/eval/estimator/ocr/route-costs.json. */
function routeCosts() {
  const rc = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/eval/estimator/ocr/route-costs.json'), 'utf8'));
  const by = (e) => rc.routes.find((r) => r.engine === e);
  const q = rc.quota_shares;
  return {
    'latin/lite': { unit: 'USD', per_page: by('gemini-3.1-flash-lite').usd_per_page, basis: 'Flash-Lite Batch list price' },
    'chinese/paddle': { unit: 'USD (busy GPU)', per_page: by('paddleocr-vl-1.6').busy_usd_per_1k / 1000, basis: 'Paddle VL 1.6 busy-card compute' },
    'tibetan/yigdzin': { unit: 'USD', per_page: 0, basis: "BDRC's own OCR, held" },
    'tibetan/yigdzin>flash-low-correct': { unit: 'agy month share', per_page: q.agy_share_per_call, basis: 'one agy 3.8 Flash low call on top of the held Yigdzin read' },
    opus_direct: { unit: 'Claude weekly points', per_page: q.claude_points_per_call, basis: 'one claude -p Opus call' },
  };
}

function score() {
  const keyRows = J('key.json');
  const s = J('sample.json');
  const f = path.join(OUT, 'verdicts-opus.jsonl');
  const V = new Map(fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.verdict).map((r) => [r.id, r.verdict]) : []);
  // An identity row (Opus left the page unchanged) is a match with no defects.
  const verdict = (k) => (k.identity ? { accept: true, matches_reference: true, fidelity: 5, defects: [], reader_note: 'Opus correction left the page unchanged', identity: true } : V.get(k.id));
  const wrongText = (v) => (v.defects || []).some((d) => d.severity === 'wrong_text');
  const cls = (d) => String(d.class || '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? 'E2';
  const costs = routeCosts();
  const report = { generated_at: new Date().toISOString(), judge: 'claude-opus-5-5 (claude -p), the ASSUMED reference (Derek 2026-10-25)', opus_direct_cost: costs.opus_direct, cells: {} };
  const ocrRows = [], trRows = [];
  const FILE = 'scripts/eval/route-judge-6740/results/pilot-2026-10-25/score.json';
  for (const [cell, cs] of Object.entries(s.cells)) {
    const C = report.cells[cell] = { task: cs.task, lang: cs.lang, reference: cs.reference, frame: cs.frame, controls: {}, routes: {} };
    const ks = keyRows.filter((k) => k.cell === cell);
    for (const route of cs.routes) {
      const wp = ks.filter((k) => k.kind === 'wrong_page' && k.route === route && V.has(k.id)).map((k) => V.get(k.id));
      const passed = wp.length > 0 && wp.every((v) => !v.accept && Number(v.fidelity) <= 2);
      C.controls[route] = { n: wp.length, passed, verdicts: wp.map((v) => ({ accept: v.accept, fidelity: v.fidelity })) };
      const got = ks.filter((k) => k.kind === 'item' && k.route === route && verdict(k));
      const accept = got.filter((k) => verdict(k).accept), match = got.filter((k) => verdict(k).matches_reference), wt = got.filter((k) => wrongText(verdict(k)));
      const classes = {}, spans = {};
      for (const k of got) {
        for (const c2 of new Set((verdict(k).defects || []).map(cls))) classes[c2] = (classes[c2] ?? 0) + 1;
        for (const d of verdict(k).defects || []) (spans[cls(d)] ??= []).push({ page: `${k.book_id}:${k.page_number}`, quote: String(d.quote || '').slice(0, 160), severity: d.severity, what: d.what });
      }
      const top = Object.entries(classes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const rate = got.length ? accept.length / got.length : null;
      const cost = costs[`${cell}/${route}`] ?? null;
      C.routes[route] = {
        n: got.length, books: new Set(got.map((k) => k.book_id)).size, identity_rows: got.filter((k) => k.identity).length,
        accept: `${accept.length}/${got.length}`, accept_rate: rate == null ? null : +rate.toFixed(2), accept_ci: clusterCI(got.map((k) => ({ book: k.book_id, v: verdict(k).accept ? 1 : 0 })), 6740),
        matches_reference: `${match.length}/${got.length}`, fidelity_mean: got.length ? +mean(got.map((k) => Number(verdict(k).fidelity))).toFixed(2) : null,
        fidelity_ci: clusterCI(got.map((k) => ({ book: k.book_id, v: Number(verdict(k).fidelity) })), 6741),
        wrong_text_pages: `${wt.length}/${got.length}`,
        classes_k_of_n: Object.fromEntries(Object.entries(classes).sort((a, b) => b[1] - a[1]).map(([c2, k]) => [c2, `${k}/${got.length}`])),
        commonest: top, examples: top ? spans[top].slice(0, 3) : [],
        cost: cost && rate ? { ...cost, per_usable_page: cost.per_page / rate } : cost,
        counts: passed,
      };
      const base = { route: `${cell}: ${route}`, script: cs.lang, judge: 'opus', note: passed ? 'Opus as the assumed reference' : 'wrong-page control failed: does not count', source: '6740 route-judge pilot', unit: 'pages', books: new Set(got.map((k) => k.book_id)).size, one_page_per_book: new Set(got.map((k) => k.book_id)).size === got.length, file: FILE };
      if (cs.task === 'ocr') {
        ocrRows.push({ rate: 'not_accepted_vs_opus', ...base, k: got.length - accept.length, n: got.length });
        ocrRows.push({ rate: 'wrong_text', ...base, k: wt.length, n: got.length });
        for (const [c2, k] of Object.entries(classes)) ocrRows.push({ rate: `defect_${c2}`, ...base, k, n: got.length });
      } else {
        for (const k of got) trRows.push({ experiment: '6740-route-judge', round: 'r6740rj', page: k.page_id, work: k.book_id, language: 'de', lang_name: 'German', arm: route, route, repeat: false,
          judge: 'opus-image-ref', judge_model: 'claude-opus-5-5', judge_family: 'claude', score: Number(verdict(k).fidelity), scored: true, accept: verdict(k).accept,
          wrong_text: wrongText(verdict(k)), defects: (verdict(k).defects || []).map(cls), counts: passed, failed_read: false, variant: '', instrument: 'image+ocr, opus reference' });
      }
    }
  }
  // A corrector judged beside its own draft on the same pages (tibetan): where did the correction make it worse?
  for (const [cell, cs] of Object.entries(s.cells)) {
    if (!cs.paired || cs.routes.length < 2) continue;
    const [draft, corr] = cs.routes, ks = keyRows.filter((k) => k.cell === cell && k.kind === 'item');
    const pairs = cs.pages.map((p) => [ks.find((k) => k.route === draft && k.page_id === p.page_id), ks.find((k) => k.route === corr && k.page_id === p.page_id)]).filter(([a, b]) => a && b && verdict(a) && verdict(b));
    const d = pairs.map(([a, b]) => Number(verdict(b).fidelity) - Number(verdict(a).fidelity));
    const worse = pairs.filter((_, i) => d[i] < 0), lost = pairs.filter(([a, b]) => verdict(a).accept && !verdict(b).accept);
    report.cells[cell].correction_vs_draft = { pairs: pairs.length, fidelity_diff: d.length ? +mean(d).toFixed(2) : null, ...clusterCI(pairs.map(([a], i) => ({ book: a.book_id, v: d[i] })), 6742),
      worse: `${worse.length}/${pairs.length}`, better: `${d.filter((x) => x > 0).length}/${pairs.length}`, accept_lost: `${lost.length}/${pairs.length}`, accept_gained: `${pairs.filter(([a, b]) => !verdict(a).accept && verdict(b).accept).length}/${pairs.length}`,
      worse_pages: worse.map(([a, b]) => ({ page: `${a.book_id}:${a.page_number}`, draft: verdict(a).fidelity, correction: verdict(b).fidelity, note: verdict(b).reader_note })) };
  }
  W('score.json', report);
  fs.writeFileSync(path.join(OUT, 'ocr-defect-observations.jsonl'), ocrRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'translation-rows.jsonl'), trRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`judged ${V.size} items`);
  for (const [cell, C] of Object.entries(report.cells)) for (const [route, x] of Object.entries(C.routes))
    console.log(`${cell}/${route}: control ${C.controls[route].passed ? 'PASS' : 'FAIL'} accept ${x.accept} [${x.accept_ci.ci95?.join(', ')}] by ${x.accept_ci.unit} match ${x.matches_reference} fid ${x.fidelity_mean} wrong_text ${x.wrong_text_pages} top ${x.commonest} ${JSON.stringify(x.classes_k_of_n)}${x.cost?.per_usable_page != null ? ` cost/usable ${x.cost.per_usable_page.toPrecision(3)} ${x.cost.unit}` : ''}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!OUT) { console.error('--out=DIR required'); process.exit(2); }
  await ({ draw, packet, judge, score }[STAGE] ?? (() => { console.error('stages: draw | packet | judge | score'); process.exit(2); }))();
}
