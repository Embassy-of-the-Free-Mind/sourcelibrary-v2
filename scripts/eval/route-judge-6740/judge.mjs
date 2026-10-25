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
 * attached.
 *
 * THE IMAGE IS THE KEY, NOT AN OPUS READ (Derek, 2026-10-26, after the evidence check). Opus is the one judge: it
 * shows no measurable self-preference (estimator v2 −0.11 to −0.13, every interval spans 0) and catches the most
 * planted errors (43/46 vs Pro 37/46, #6545). But as a READER it is not a safe key: it invented text on 23/100 Chinese
 * table reads (#6388), was worse than the specialist on 27/30 Tibetan pages, and is not the measured leader for Latin,
 * German/French, Greek or Chinese print OCR (estimator v1). So the judge reads each output against the PAGE IMAGE
 * (plus the source OCR for a translation) and never against an Opus text. Where a cell holds an Opus correction or
 * read, it is one more blind candidate, scored like the others, and priced as the Opus route. Where an external
 * reference exists (Derge for Tibetan, Kanripo for Chinese where the leaf aligns), every candidate is scored against it
 * too, and the judge's agreement with it is reported.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/route-judge-6740/judge.mjs draw   --out=DIR [--n=30]
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/route-judge-6740/judge.mjs refs   --out=DIR
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/route-judge-6740/judge.mjs translate --out=DIR
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/route-judge-6740/judge.mjs packet --out=DIR
 *   node scripts/eval/route-judge-6740/judge.mjs judge --out=DIR [--concurrency=3] [--cell=latin] [--limit=N]
 *   node scripts/eval/route-judge-6740/judge.mjs score --out=DIR
 *
 * CELLS (each an open routing decision). "experiment read" = never served; it comes from the eval named.
 *   latin    Latin print OCR (#5924). lite as served; lite > Opus correction (experiment read, #5924 oc-reads).
 *   chinese  Chinese OCR (#6871). Paddle draft (page_revisions, opus_correct_6561); Paddle > Opus correction as served
 *            (#6561). Kanripo leaf (refs stage, paddle-table-6388/align.mjs) where the page aligns.
 *   tibetan  Tibetan OCR (#6560). The 30 Kangyur folios of tibetan-proofread-2026-10 (one per book): Yigdzin as
 *            served then; Yigdzin > Flash 3.8 low correction and Yigdzin > Opus correction (both experiment reads,
 *            #6560 out/). Derge e-text identity per candidate (scores-flash.json.gz). PLANTED: 10 Yigdzin drafts with
 *            one planted syllable each (plants.json); the judge's catch rate decides whether it or Derge decides the
 *            cell (below 80%: Derge).
 *   german   German translation (#7263). 3 Flash and Flash-Lite as served; Opus CLI (this run's reads, not served:
 *            `translate` runs claude-translate.mjs read with CANDIDATE_READS=off on half of each served route's pages).
 *
 * VERDICT per output: accept (would a reader accept this as this leaf's text / translation), a 1-5 fidelity score,
 * defects tagged with the 44 page-error-taxonomy classes, each with a quoted span and a severity, and a one-line note.
 * Two routes that produced the same text on a page are judged once.
 *
 * CONTROL per cell x route: two wrong-page items (this page's image, another page's output from the same route).
 * The judge passes when it accepts neither and scores both <= 2; a route whose control fails does not count.
 *
 * PACE: the judge does not call while this box's Claude account is at or above ROUTE_JUDGE_WEEKLY_MAX (85) of its
 * week or 95 of its 5 hours (model-limits.mjs; CLAUDE_LIMITS_FILE may point at a per-box meter). Read-only: no writes
 * to pages, books or R2. Large files live in DIR, under $JOB_SCRATCH; the committed summary is score.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
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
const gz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8');
const jsonl = (t) => t.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const N = Number(arg('n') || 30);
const LATIN_READS = path.join(ROOT, 'scripts/eval/flash-reread-5924/results/oc-reads.jsonl.gz');
const TIB = path.join(ROOT, 'scripts/eval/results/tibetan-correct-6560');
const TIB_MANIFEST = path.join(ROOT, 'scripts/eval/results/tibetan-proofread-2026-10/manifest.jsonl');
const TIB_ARMS = { yigdzin: 'baseline', 'yigdzin>flash-low-correct': 'flash-low-corr', 'yigdzin>opus-correct': 'opus-corr' };
const LITE = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview'];
const FLASH3 = ['gemini-3-flash-preview'];
const OPUS = ['claude-opus-5-5'];
const DE_OPUS_DIR = 'opus-de';

/** One page per book in a seeded order; a second round per book only when there are fewer books than n. */
function onePerBook(rows, n, salt) {
  const byBook = new Map();
  for (const r of [...rows].sort((a, b) => h(salt + a.page_id).localeCompare(h(salt + b.page_id)))) byBook.set(r.book_id, [...(byBook.get(r.book_id) ?? []), r]);
  const books = [...byBook].sort((a, b) => h(salt + a[0]).localeCompare(h(salt + b[0])));
  const out = [];
  for (let round = 0; out.length < n && round < 20; round++) for (const [, l] of books) if (l[round] && out.length < n) out.push(l[round]);
  return out;
}

const tibManifest = () => fs.readFileSync(TIB_MANIFEST, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.stratum === 'kangyur');

async function draw() {
  const { MongoClient } = await import('mongodb');
  const { SKIP_TRANSLATION_PAGE_TYPES } = await import('../../lib/translate-core.mjs');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const cells = {};

  // latin: the #5924 Opus-correct pages, minus the wrong-leaf book whose 25 pages the corrector CONTAINed.
  const oc = jsonl(gz(LATIN_READS)).filter((r) => r.outcome !== 'contain');
  const lat = onePerBook(oc.map((r) => ({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number })), N, 'latin');
  cells.latin = { task: 'ocr', lang: 'Latin', paired: true, routes: ['lite', 'lite>opus-correct'], served: { lite: 'served', 'lite>opus-correct': 'experiment read, not served (#5924 oc-reads)' }, pages: lat,
    frame: { pages: oc.length, books: new Set(oc.map((r) => r.book_id)).size, note: '#5924 oc-reads: 250 lite Latin pages in 10 books; the wrong-leaf book (25 CONTAIN pages) left out' } };

  // chinese: pages whose served OCR is the #6561 Opus correction; the Paddle draft is the revision it superseded.
  // Tables come first where there are any (#6561 / #7275); the draw found one.
  const isTable = (t) => /\|[^\n]*\|[^\n]*\|/.test(t || '') || /<table|<td/.test(t || '');
  const revs = (await db.collection('page_revisions').find({ field: 'ocr', reason: 'opus_correct_6561' }, { projection: { page_id: 1, book_id: 1, model: 1, created_at: 1, data: 1 } }).toArray())
    .map(({ data, ...r }) => ({ ...r, table: isTable(data) }));
  const zhLive = new Map((await db.collection('pages').find({ id: { $in: revs.map((r) => r.page_id) } }, { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.model': 1, 'ocr.updated_at': 1 } }).toArray()).map((p) => [p.id, p]));
  const zhOk = revs.filter((r) => { const p = zhLive.get(r.page_id); return p && OPUS.includes(p.ocr?.model) && new Date(p.ocr.updated_at) >= new Date(r.created_at); })
    .map((r) => ({ page_id: r.page_id, book_id: zhLive.get(r.page_id).book_id, page_number: zhLive.get(r.page_id).page_number, page_type: zhLive.get(r.page_id).page_type ?? null, table: r.table }));
  const zhTab = onePerBook(zhOk.filter((r) => r.table), N, 'chinese');
  const zhPick = [...zhTab, ...onePerBook(zhOk.filter((r) => !r.table && !zhTab.some((t) => t.book_id === r.book_id)), N - zhTab.length, 'chinese')];
  cells.chinese = { task: 'ocr', lang: 'Chinese', paired: true, routes: ['paddle', 'paddle>opus-correct'], served: { paddle: 'served before the correction (page_revisions draft)', 'paddle>opus-correct': 'served (#6561)' }, pages: zhPick,
    frame: { revisions: revs.length, served_opus_still: zhOk.length, books: new Set(zhOk.map((r) => r.book_id)).size, table_drafts: zhOk.filter((r) => r.table).length, table_books: new Set(zhOk.filter((r) => r.table).map((r) => r.book_id)).size, drawn_tables: zhTab.length } };

  // tibetan: the 30 Kangyur folios of tibetan-proofread-2026-10 (one per book), every one with a Derge window and the
  // #6560 correction reads committed. The served Yigdzin text is the manifest's (what the correctors were given).
  const tib = tibManifest();
  const plants = JSON.parse(fs.readFileSync(path.join(TIB, 'plants.json'), 'utf8'));
  cells.tibetan = { task: 'ocr', lang: 'Tibetan', paired: true, routes: Object.keys(TIB_ARMS),
    served: { yigdzin: 'served (as of the 2026-10 manifest)', 'yigdzin>flash-low-correct': 'experiment read, not served (#6560 out/flash-low-corr)', 'yigdzin>opus-correct': 'experiment read, not served (#6560 out/opus-corr)' },
    pages: tib.map((r) => ({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, uid: r.id })),
    planted: plants.anchor_ids,
    frame: { folios: tib.length, books: new Set(tib.map((r) => r.book_id)).size, note: 'tibetan-proofread-2026-10 Kangyur stratum: one folio per book, Derge identity 0.904-0.969' } };

  // german: one frame, two served translation routes, one page per book per route. Opus CLI reads half of each.
  const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, language: { $regex: '^German', $options: 'i' }, year: { $gte: 1500, $lte: 1800 } }, { projection: { id: 1, title: 1, year: 1 } }).toArray();
  const toDate = (f) => ({ $convert: { input: f, to: 'date', onError: null, onNull: null } });
  const de = await db.collection('pages').aggregate([
    { $match: { book_id: { $in: books.map((b) => b.id) }, page_number: { $gt: 0 }, page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES }, 'translation.model': { $in: [...FLASH3, ...LITE] }, 'ocr.data': { $type: 'string' }, 'translation.data': { $type: 'string' } } },
    { $match: { $expr: { $and: [{ $gte: [{ $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $strLenCP: '$ocr.data' }, 0] }, 300] }, { $gte: [toDate('$translation.updated_at'), toDate('$ocr.updated_at')] }] } } },
    { $project: { _id: 0, id: 1, book_id: 1, page_number: 1, 'translation.model': 1, 'translation.source': 1 } },
  ], { allowDiskUse: true }).toArray();
  const deRoute = (m) => (FLASH3.includes(m) ? 'flash3' : 'flash-lite');
  const dePages = [], deFrame = {};
  for (const route of ['flash3', 'flash-lite']) {
    const rows = de.filter((p) => deRoute(p.translation.model) === route).map((p) => ({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, route, tr_source: p.translation.source ?? null }));
    deFrame[route] = { pages: rows.length, books: new Set(rows.map((r) => r.book_id)).size };
    const pick = onePerBook(rows, N, `german-${route}`);
    dePages.push(...pick, ...pick.slice(0, Math.ceil(N / 2)).map((p) => ({ ...p, route: 'opus-cli', paired_with: route })));
  }
  cells.german = { task: 'translation', lang: 'German', paired: false, routes: ['flash3', 'flash-lite', 'opus-cli'], pages: dePages,
    served: { flash3: 'served', 'flash-lite': 'served', 'opus-cli': "this run's reads, not served (claude-translate.mjs read, one page a call)" },
    frame: { books: books.length, routes: deFrame, note: 'visible German books dated 1500-1800; English newer than the OCR' } };

  await c.close();
  fs.mkdirSync(OUT, { recursive: true });
  W('sample.json', { drawn_at: new Date().toISOString(), n: N, cells });
  for (const [k, v] of Object.entries(cells)) console.log(`${k}: ${v.pages.length} rows from ${new Set(v.pages.map((p) => p.book_id)).size} books; frame ${JSON.stringify(v.frame)}`);
}

/** Kanripo leaf (WYG witness) for each drawn Chinese page, where paddle-table-6388/align.mjs can place it. */
async function refs() {
  const s = J('sample.json');
  const cand = s.cells.chinese.pages.map((p) => JSON.stringify({ key: p.page_id, bid: p.book_id, pn: p.page_number })).join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, 'kanripo-cand.jsonl'), cand);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/eval/paddle-table-6388/align.mjs'), path.join(OUT, 'kanripo-cand.jsonl'), path.join(OUT, 'kanripo-align.jsonl')], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) { console.error(`align.mjs exit ${r.status}`); process.exit(1); }
}

/** German Opus CLI reads: production's claude-translate.mjs, one page a call, nothing kept in R2, nothing written. */
async function translate() {
  const s = J('sample.json');
  const ids = s.cells.german.pages.filter((p) => p.route === 'opus-cli').map((p) => p.page_id);
  fs.writeFileSync(path.join(OUT, 'opus-de-ids.json'), JSON.stringify(ids));
  const limits = await import('../../lib/model-limits.mjs');
  const b = limits.claudeBlocked({ weeklyMax: Number(process.env.ROUTE_JUDGE_WEEKLY_MAX || 85), sessionMax: 95 });
  if (b) { console.log(`BLOCKED until=${b.until} (${b.reason})`); process.exit(3); }
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/batch/claude-translate.mjs'), 'read', `--page-ids-file=${path.join(OUT, 'opus-de-ids.json')}`, `--out=${path.join(OUT, DE_OPUS_DIR)}`,
    '--model=opus', '--per-call=1', '--job=route-judge-6740', '--ocr-checked=eval reads for #6740, never applied; the judge reads every page against its image'],
  { stdio: 'inherit', env: { ...process.env, CANDIDATE_READS: 'off' } });
  process.exit(r.status ?? 1);
}

async function packet() {
  const { MongoClient } = await import('mongodb');
  const { getPageSource } = await import('../../lib/page-image-url.mjs');
  const s = J('sample.json');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const all = ['latin', 'chinese', 'german'].flatMap((x) => s.cells[x].pages.map((p) => p.page_id));
  const pages = new Map((await db.collection('pages').find({ id: { $in: all } }, { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, 'ocr.data': 1, 'ocr.model': 1, 'translation.data': 1, 'translation.model': 1 } }).toArray()).map((p) => [p.id, p]));
  // The newest opus_correct_6561 revision of a page is the draft the served correction replaced.
  const zhDraft = new Map((await db.collection('page_revisions').find({ field: 'ocr', reason: 'opus_correct_6561', page_id: { $in: s.cells.chinese.pages.map((p) => p.page_id) } }, { projection: { page_id: 1, data: 1, created_at: 1 } }).sort({ created_at: 1 }).toArray()).map((r) => [r.page_id, r.data]));
  await c.close();
  const oc = new Map(jsonl(gz(LATIN_READS)).map((r) => [r.page_id, r]));
  const tibM = new Map(tibManifest().map((r) => [r.id, r]));
  const tibOut = Object.fromEntries(Object.entries(TIB_ARMS).filter(([, a]) => a !== 'baseline').map(([route, a]) => [route, new Map(jsonl(gz(path.join(TIB, 'out', `${a}.jsonl.gz`))).filter((r) => r.text && !r.error).map((r) => [r.uid, r.text]))]));
  const deOpus = (id) => { const m = path.join(OUT, DE_OPUS_DIR, `${id}.meta.json`); try { return JSON.parse(fs.readFileSync(m, 'utf8')).exit === 0 ? fs.readFileSync(path.join(OUT, DE_OPUS_DIR, `${id}.txt`), 'utf8') : null; } catch { return null; } };
  const lite = (p) => (LITE.includes(p?.ocr?.model) ? p.ocr.data : null);

  const output = (cell, route, sp) => {
    const p = pages.get(sp.page_id);
    if (cell === 'latin') { const r = oc.get(sp.page_id); return route === 'lite' ? lite(p) : r?.outcome === 'unchanged' ? lite(p) : r?.text || null; }
    if (cell === 'chinese') return route === 'paddle' ? zhDraft.get(sp.page_id) ?? null : OPUS.includes(p?.ocr?.model) ? p.ocr.data : null;
    if (cell === 'tibetan') return route === 'yigdzin' ? tibM.get(sp.uid)?.served_text ?? null : tibOut[route].get(sp.uid) ?? null;
    return route === 'opus-cli' ? deOpus(sp.page_id) : p?.translation?.data ?? null;
  };
  const image = (cell, sp) => (cell === 'tibetan' ? (tibM.get(sp.uid)?.archived_photo || tibM.get(sp.uid)?.display_photo) : getPageSource(pages.get(sp.page_id)));
  const items = [], key = [], skipped = [], byText = new Map();
  // One judge call per distinct (cell, page, text): two routes that produced the same text share a verdict.
  const add = (cell, route, sp, kind, text, extra = {}) => {
    const cs = s.cells[cell];
    const tag = kind === 'item' ? `${cell}:${sp.page_id}:${h(text.trim())}` : `${kind}:${cell}:${route}:${sp.page_id}:${extra.other ?? ''}:${extra.plant?.planted ?? ''}`;
    const id = `j${h(tag).slice(0, 10)}`;
    if (!byText.has(id)) {
      byText.set(id, true);
      items.push({ id, task: cs.task, lang: cs.lang, image_url: image(cell, sp), text, source: cs.task === 'translation' ? pages.get(sp.page_id)?.ocr?.data ?? '' : undefined });
    }
    key.push({ id: `k${h(`${kind}:${cell}:${route}:${sp.page_id}:${extra.other ?? ''}`).slice(0, 10)}`, judged_as: id, cell, route, kind, served: cs.served?.[route] ?? null, page_id: sp.page_id, book_id: sp.book_id, page_number: sp.page_number, uid: sp.uid, ...extra });
  };
  for (const [cell, cs] of Object.entries(s.cells)) {
    for (const route of cs.routes) {
      const mine = cs.paired ? cs.pages : cs.pages.filter((p) => p.route === route);
      const ok = mine.filter((sp) => {
        const t = output(cell, route, sp), img = image(cell, sp);
        const good = img && t?.trim() && (cs.task === 'ocr' || pages.get(sp.page_id)?.ocr?.data);
        if (!good) skipped.push({ cell, route, page_id: sp.page_id, why: !img ? 'no image' : !t?.trim() ? 'no output' : 'no source OCR' });
        return good;
      });
      for (const sp of ok) add(cell, route, sp, 'item', output(cell, route, sp), sp.paired_with ? { paired_with: sp.paired_with } : {});
      // Wrong-page controls: this page's image, the output this route made for a page of ANOTHER book.
      for (let i = 0; i < 2 && ok.length > 2; i++) {
        const sp = ok[i];
        const other = ok.find((o, j) => j >= Math.floor(ok.length / 2) + i && o.book_id !== sp.book_id) ?? ok[(i + Math.floor(ok.length / 2)) % ok.length];
        add(cell, route, sp, 'wrong_page', output(cell, route, other), { other: other.page_id });
      }
    }
  }
  // Planted: one syllable planted in the served Yigdzin read of each of the 10 #6560 anchor folios (plants.json; the
  // kind rotates vowel / swap / letter). The judge catches it if a defect quotes the planted syllable in its context.
  const plants = JSON.parse(fs.readFileSync(path.join(TIB, 'plants.json'), 'utf8'));
  plants.anchor_ids.forEach((uid, i) => {
    const m = tibM.get(uid), pl = plants.plants[uid].plants;
    const p = pl.find((x) => x.kind === ['vowel', 'swap', 'letter'][i % 3]) ?? pl[0];
    const lines = m.served_text.split('\n');
    if (lines[p.line].slice(p.offset, p.offset + p.orig.length) !== p.orig) throw new Error(`plant does not sit on ${uid}`);
    lines[p.line] = lines[p.line].slice(0, p.offset) + p.planted + lines[p.line].slice(p.offset + p.orig.length);
    const sp = s.cells.tibetan.pages.find((x) => x.uid === uid);
    add('tibetan', 'yigdzin', sp, 'planted', lines.join('\n'), { plant: { kind: p.kind, orig: p.orig, planted: p.planted, prev: p.prev, next: p.next, line: p.line } });
  });
  const order = items.map((it, i) => [h(`order:${it.id}`), i]).sort((a, b) => a[0].localeCompare(b[0])).map(([, i]) => i);
  W('packet.json', { items: order.map((i) => items[i]) });
  W('key.json', key);
  W('packet-skipped.json', skipped);
  const tally = {}; for (const k of key) { const t = `${k.cell}/${k.route}/${k.kind}`; tally[t] = (tally[t] ?? 0) + 1; }
  console.log(`packet: ${items.length} judge calls; ${key.length} keyed rows; skipped ${skipped.length}`); console.log(tally);
}

// The 44 classes of .claude/docs/page-error-taxonomy.md, by code and name: the judge tags with these, nothing else.
export const TAXONOMY = `I1 image one leaf away from its text; I2 duplicate scan; I3 spread not split; I4 neighbour strip read as content; I5 several leaves in one photo; I6 pages reversed; I7 catalogue identity wrong;
O1 confabulation on an illegible or unfamiliar leaf (text not on the page); O2 wrong-script fabrication; O3 canonical-text substitution (a known text put in place of what the leaf says); O4 block-level repetition (lines or blocks duplicated); O5 silent omission inside the page; O6 meaning-changing misread; O7 numerals, dates, doses and units wrong; O8 silent normalisation toward the expected; O9 convention flips between pages; O10 secondary script dropped or garbled; O11 page furniture mis-tagged; O12 marginalia and apparatus dropped, merged or mis-tagged; O13 later hands read as text; O14 non-linear content described, not transcribed; O15 reasoning or notes inside the transcription; O16 self-reported tags wrong; O17 table structure invented or lost (columns dropped, cells merged, re-laid); O18 page left empty;
T1 translation truncated; T2 echoed source; T3 translation hidden inside a meta/note wrapper; T4 in-block drift / tail block shift; T5 continuity leak or lookahead duplication; T6 catchword and split-word seams; T7 fluent English over a garbled source, no uncertainty; T8 sense inverted or a qualifier dropped; T9 quiet omission; T10 invented scholarship in notes and glosses; T11 parallel edition mishandled; T12 same-language source rewritten; T13 apparatus stripped; T14 the two panes from different reads; T15 continuity meta wrong; T16 form imposed or lost; T17 reasoning or a chat reply stored as the translation;
D1 markup broken or unknown to the renderer; E2 other (say what)`;

/** The judge reads the candidate against the IMAGE (and, for a translation, the source transcription). No reference. */
export function judgePrompt(it, imageRef) {
  const ocr = it.task === 'ocr';
  const head = ocr
    ? `You are checking a candidate transcription of one page of a historical ${it.lang} book against the page image, for a library that publishes the transcription beside the image. The image is the only authority: read the leaf yourself, closely, line by line, and compare.

The page image is attached: ${imageRef}

`
    : `You are checking a candidate English translation of one page of a historical ${it.lang} book, for a library that publishes it beside the original. The transcription below may contain recognition errors; the image is the authority for what the page says.

The page image is attached: ${imageRef}

TRANSCRIPTION (${it.lang}):
"""
${it.source}
"""

`;
  return `${head}CANDIDATE ${ocr ? 'TRANSCRIPTION' : 'TRANSLATION'}:
"""
${it.text}
"""

Questions:
- accept: would a reader of this library be served by publishing this candidate as ${ocr ? "this page's transcription (every line of the page, in order, the right words and numerals; spelling conventions and markup aside)" : "this page's translation (the page's statements, negations, names and numbers; style aside)"}, with nothing that matters lost, added or changed? true or false.
- fidelity: 1-5 to the page (5 = faithful and complete, 4 = small slips that mislead no one, 3 = usable with real errors, 2 = substantially wrong or incomplete, 1 = not this page's ${ocr ? 'text' : 'translation'} at all).
- defects: every defect in the CANDIDATE, each tagged with ONE class code from this list (E2 only if nothing fits):
${TAXONOMY}
  with a short verbatim quote of the offending span from the candidate and a severity: "cosmetic" (no reader is misled), "misleads" (a reader would understand something not quite on the page) or "wrong_text" (the candidate says something the page does not: invented, duplicated, dropped, another page, a wrong word that changes the sense).
- reader_note: one line, what a reader of this page would notice.

Tags such as <page-type>, <scan-quality>, <header>, <note>, <meta>, <margin>, <leaf-break/> and markdown tables are the library's markup; judge them only where they misplace or drop the page's content.

Answer with one JSON object only: {"accept": bool, "fidelity": n, "defects": [{"class": "O6", "quote": "...", "severity": "misleads", "what": "a few words"}], "reader_note": "..."}`;
}

const parseVerdict = (t) => parseJson(t, (v) => typeof v.accept === 'boolean' && Number(v.fidelity) >= 1 && Number(v.fidelity) <= 5 && Array.isArray(v.defects ?? []));

const QUOTA = /usage limit|limit reached|hit your (?:usage )?limit|rate.?limit|out of extra usage/i;
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
/** Opus with the image in its workspace and Read as its only tool (replicate-6547/run-claude-arm.py's call). */
function opusCall(prompt, cwd) {
  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', '--model', 'opus', '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 900e3);
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {}; try { j = JSON.parse(out); } catch { /* not JSON */ }
      const text = String(j.result ?? '');
      resolve({ text, cls: (j.is_error || code !== 0) && QUOTA.test(text + out + err) ? 'quota' : code !== 0 ? `exit_${code}` : null, model: Object.keys(j.modelUsage || {})[0] ?? null, usage: j.usage ?? null, cost: j.total_cost_usd ?? null });
    });
  });
}

async function judge() {
  const only = arg('cell'), limit = Number(arg('limit') || Infinity);
  const cellOf = new Map(J('key.json').map((k) => [k.judged_as, k.cell]));
  const pk = J('packet.json').items.filter((it) => !only || cellOf.get(it.id) === only);
  const file = path.join(OUT, 'verdicts-opus.jsonl');
  const done = new Set(fs.existsSync(file) ? jsonl(fs.readFileSync(file, 'utf8')).filter((r) => r.verdict).map((r) => r.id) : []);
  const tries = new Map(); if (fs.existsSync(file)) for (const r of jsonl(fs.readFileSync(file, 'utf8'))) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const limits = await import('../../lib/model-limits.mjs');
  // The brief's ceiling: this box's Claude account stays under 85% of its week.
  const WEEKLY = Number(process.env.ROUTE_JUDGE_WEEKLY_MAX || 85);
  let stop = null, calls = 0;
  const one = async (it) => {
    if (stop || calls >= limit) return;
    const b = limits.claudeBlocked({ weeklyMax: WEEKLY, sessionMax: 95 });
    if (b) { stop = b; return; }
    calls++;
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'rj-opus-'));
    try {
      const res = await fetch(it.image_url);
      if (!res.ok) { fs.appendFileSync(file, JSON.stringify({ id: it.id, verdict: null, raw: `image HTTP ${res.status}` }) + '\n'); return; }
      fs.writeFileSync(path.join(ws, 'page.jpg'), Buffer.from(await res.arrayBuffer()));
      const t0 = Date.now();
      const r = await opusCall(judgePrompt(it, 'the file ./page.jpg in your working directory (open it with Read before you answer)'), ws);
      if (r.cls === 'quota') { limits.noteLimitHit('claude', { reason: r.text.slice(0, 200) }); stop = { until: limits.claudeUsage()?.sessionReset ?? null, reason: 'quota reply' }; return; }
      const v = parseVerdict(r.text);
      fs.appendFileSync(file, JSON.stringify({ id: it.id, judge: 'opus', model: r.model, cls: r.cls, verdict: v, raw: v ? undefined : String(r.text).slice(0, 500), usage: r.usage, list_usd: r.cost, secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }) + '\n');
      console.log(`  ${it.id}: ${v ? `accept=${v.accept} ${v.fidelity} (${(v.defects || []).length} defects)` : `unparsed ${r.cls ?? ''}`}`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  // An item that failed to parse three times is left out (and counted by score), not retried forever.
  const todo = pk.filter((it) => !done.has(it.id) && (tries.get(it.id) ?? 0) < 3);
  console.log(`opus: ${todo.length} of ${pk.length} items to judge`);
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
  let i = 0;
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < todo.length && calls < limit) await one(todo[i++]); }));
  if (stop) { console.log(`BLOCKED until=${stop.until} (${stop.reason})`); process.exit(3); }
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
  return { ci95: [+boots[100].toFixed(3), +boots[3899].toFixed(3)], unit: byPage ? 'page' : 'book', units: units.length };
}
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) { cur[0] = i; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); [prev, cur] = [cur, prev]; }
  return prev[n];
}

/**
 * Cost of one page on each route, in the route's own unit, from scripts/eval/estimator/ocr/route-costs.json (quota
 * shares, never plan fees). A correction route costs its draft plus one call of the corrector. `measuredPoints` is the
 * Claude weekly points one judge-sized Opus image call took in THIS run, from the meter, when the run measured it.
 */
function routeCosts(measuredPoints) {
  const rc = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/eval/estimator/ocr/route-costs.json'), 'utf8'));
  const by = (e) => rc.routes.find((r) => r.engine === e);
  const q = rc.quota_shares, pts = measuredPoints ?? q.claude_points_per_call;
  const ptsBasis = measuredPoints ? "Claude weekly points per Opus image call, measured on this run's meter" : 'route-costs claude_points_per_call (a Sonnet text call; images not metered)';
  return {
    'latin/lite': { usd: by('gemini-3.1-flash-lite').usd_per_page, basis: 'Flash-Lite Batch list price' },
    'latin/lite>opus-correct': { usd: by('gemini-3.1-flash-lite').usd_per_page, claude_points: pts, basis: `lite + one Opus call (${ptsBasis})` },
    'chinese/paddle': { usd: by('paddleocr-vl-1.6').busy_usd_per_1k / 1000, basis: 'Paddle VL 1.6 busy-card compute' },
    'chinese/paddle>opus-correct': { usd: by('paddleocr-vl-1.6').busy_usd_per_1k / 1000, claude_points: pts, basis: `Paddle + one Opus call (${ptsBasis})` },
    'tibetan/yigdzin': { usd: 0, basis: "BDRC's own OCR, held" },
    'tibetan/yigdzin>flash-low-correct': { usd: 0, agy_share: q.agy_share_per_call, basis: 'held Yigdzin + one agy 3.8 Flash low call' },
    'tibetan/yigdzin>opus-correct': { usd: 0, claude_points: pts, basis: `held Yigdzin + one Opus call (${ptsBasis})` },
    'german/flash3': { usd: null, basis: 'not in route-costs.json (an OCR table); 3 Flash translation price not measured per page' },
    'german/flash-lite': { usd: null, basis: 'not in route-costs.json (an OCR table)' },
    'german/opus-cli': { claude_points: pts, basis: `one Opus text call per page here (production sends 10 pages a call) (${ptsBasis})` },
  };
}
const perUsable = (cost, rate) => (cost && rate ? Object.fromEntries(Object.entries(cost).filter(([k, v]) => typeof v === 'number').map(([k, v]) => [k, +(v / rate).toPrecision(3)])) : null);

/** Did a verdict on a planted item quote the planted syllable in its context? */
function caught(v, plant) {
  const T = '་', norm = (t) => String(t || '').replace(/\s+/g, '');
  const probes = [`${plant.prev.at(-1)}${T}${plant.planted}`, `${plant.planted}${T}${plant.next[0]}`, `${plant.planted}${T}`].map(norm);
  return (v.defects || []).some((d) => { const q = norm(d.quote); return probes.slice(0, 2).some((p) => q.includes(p)) || q === norm(plant.planted) || q === probes[2]; });
}

function score() {
  const keyRows = J('key.json');
  const s = J('sample.json');
  const f = path.join(OUT, 'verdicts-opus.jsonl');
  const rows = fs.existsSync(f) ? jsonl(fs.readFileSync(f, 'utf8')) : [];
  const V = new Map(rows.filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
  const verdict = (k) => V.get(k.judged_as);
  const wrongText = (v) => (v.defects || []).some((d) => d.severity === 'wrong_text');
  const cls = (d) => String(d.class || '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? 'E2';
  const meter = fs.existsSync(path.join(OUT, 'meter.json')) ? J('meter.json') : null;
  const costs = routeCosts(meter?.points_per_call ?? null);
  const FILE = 'scripts/eval/route-judge-6740/results/pilot-2026-10-26/score.json';
  const report = { generated_at: new Date().toISOString(), judge: 'claude-opus-5-5 (claude -p), reading each output against the page image; no Opus text is the key',
    calls: { judged: V.size, unparsed: [...new Set(rows.filter((r) => !r.verdict).map((r) => r.id))].filter((id) => !V.has(id)).length, list_usd_equiv: +rows.reduce((a, r) => a + (r.list_usd || 0), 0).toFixed(2) }, meter, cells: {} };
  const ocrRows = [], trRows = [], contain = [];
  for (const [cell, cs] of Object.entries(s.cells)) {
    const C = report.cells[cell] = { task: cs.task, lang: cs.lang, frame: cs.frame, controls: {}, routes: {} };
    const ks = keyRows.filter((k) => k.cell === cell);
    for (const route of cs.routes) {
      const wp = ks.filter((k) => k.kind === 'wrong_page' && k.route === route && verdict(k)).map(verdict);
      const passed = wp.length > 0 && wp.every((v) => !v.accept && Number(v.fidelity) <= 2);
      C.controls[route] = { n: wp.length, passed, verdicts: wp.map((v) => ({ accept: v.accept, fidelity: v.fidelity })) };
      const got = ks.filter((k) => k.kind === 'item' && k.route === route && verdict(k));
      const accept = got.filter((k) => verdict(k).accept), wt = got.filter((k) => wrongText(verdict(k)));
      const classes = {}, wtClasses = {}, spans = {};
      for (const k of got) {
        for (const c2 of new Set((verdict(k).defects || []).map(cls))) classes[c2] = (classes[c2] ?? 0) + 1;
        for (const c2 of new Set((verdict(k).defects || []).filter((d) => d.severity === 'wrong_text').map(cls))) wtClasses[c2] = (wtClasses[c2] ?? 0) + 1;
        for (const d of verdict(k).defects || []) (spans[cls(d)] ??= []).push({ page: `${k.book_id}:${k.page_number}`, quote: String(d.quote || '').slice(0, 160), severity: d.severity, what: d.what });
        // A served page the judge says carries text not on the leaf: a by-eye check, and containment if it holds.
        if (cs.served?.[route]?.startsWith('served') && route !== 'paddle' && (verdict(k).defects || []).some((d) => d.severity === 'wrong_text' && /^(O1|O2|O3|I1|T17|T14)$/.test(cls(d))))
          contain.push({ cell, route, page_id: k.page_id, book_id: k.book_id, page_number: k.page_number, defects: verdict(k).defects.filter((d) => d.severity === 'wrong_text'), note: verdict(k).reader_note });
      }
      const k2n = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([c2, k]) => [c2, `${k}/${got.length}`]));
      const top = Object.entries(wtClasses).sort((a, b) => b[1] - a[1])[0]?.[0] ?? Object.entries(classes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const rate = got.length ? accept.length / got.length : null;
      const cost = costs[`${cell}/${route}`] ?? null;
      C.routes[route] = {
        served: cs.served?.[route] ?? null, n: got.length, books: new Set(got.map((k) => k.book_id)).size,
        accept: `${accept.length}/${got.length}`, accept_rate: rate == null ? null : +rate.toFixed(2), accept_ci: clusterCI(got.map((k) => ({ book: k.book_id, v: verdict(k).accept ? 1 : 0 })), 6740),
        wrong_text_pages: `${wt.length}/${got.length}`, wrong_text_ci: clusterCI(got.map((k) => ({ book: k.book_id, v: wrongText(verdict(k)) ? 1 : 0 })), 6743),
        wrong_text_classes: k2n(wtClasses), classes_k_of_n: k2n(classes),
        fidelity_mean: got.length ? +mean(got.map((k) => Number(verdict(k).fidelity))).toFixed(2) : null,
        commonest: top, examples: top ? spans[top].filter((x) => x.severity === 'wrong_text').concat(spans[top]).slice(0, 3) : [],
        cost, cost_per_usable_page: perUsable(cost, rate), counts: passed,
      };
      const base = { route: `${cell}: ${route}`, script: cs.lang, judge: 'opus-image', note: passed ? 'Opus reads against the image; no reference text' : 'wrong-page control failed: does not count', source: '6740 route-judge pilot', unit: 'pages', books: new Set(got.map((k) => k.book_id)).size, one_page_per_book: new Set(got.map((k) => k.book_id)).size === got.length, file: FILE };
      if (cs.task === 'ocr') {
        ocrRows.push({ rate: 'not_accepted', ...base, k: got.length - accept.length, n: got.length });
        ocrRows.push({ rate: 'wrong_text', ...base, k: wt.length, n: got.length });
        for (const [c2, k] of Object.entries(classes)) ocrRows.push({ rate: `defect_${c2}`, ...base, k, n: got.length });
      } else {
        for (const k of got) trRows.push({ experiment: '6740-route-judge', round: 'r6740rj', page: k.page_id, work: k.book_id, language: 'de', lang_name: 'German', arm: route, route, repeat: false,
          judge: 'opus-image', judge_model: 'claude-opus-5-5', judge_family: 'claude', score: Number(verdict(k).fidelity), scored: true, accept: verdict(k).accept,
          wrong_text: wrongText(verdict(k)), defects: (verdict(k).defects || []).map(cls), counts: passed, failed_read: false, variant: '', instrument: 'image+ocr, no reference' });
      }
    }
  }

  // Pages made worse: a correction (or the Opus read) beside the draft (or the served route) on the same page.
  const pairsOf = { latin: [['lite', 'lite>opus-correct']], chinese: [['paddle', 'paddle>opus-correct']], tibetan: [['yigdzin', 'yigdzin>flash-low-correct'], ['yigdzin', 'yigdzin>opus-correct']], german: [['flash3', 'opus-cli'], ['flash-lite', 'opus-cli']] };
  for (const [cell, prs] of Object.entries(pairsOf)) {
    const ks = keyRows.filter((k) => k.cell === cell && k.kind === 'item');
    report.cells[cell].made_worse = {};
    for (const [draft, corr] of prs) {
      const pairs = ks.filter((k) => k.route === draft).map((a) => [a, ks.find((b) => b.route === corr && b.page_id === a.page_id)]).filter(([a, b]) => b && verdict(a) && verdict(b));
      const d = pairs.map(([a, b]) => Number(verdict(b).fidelity) - Number(verdict(a).fidelity));
      const worse = pairs.filter(([a, b], i) => d[i] < 0 || (verdict(a).accept && !verdict(b).accept) || (!wrongText(verdict(a)) && wrongText(verdict(b))));
      report.cells[cell].made_worse[`${draft} -> ${corr}`] = { pairs: pairs.length, identical_text: pairs.filter(([a, b]) => a.judged_as === b.judged_as).length, fidelity_diff: d.length ? +mean(d).toFixed(2) : null, fidelity_diff_ci: clusterCI(pairs.map(([a], i) => ({ book: a.book_id, v: d[i] })), 6742).ci95,
        worse: `${worse.length}/${pairs.length}`, better: `${d.filter((x) => x > 0).length}/${pairs.length}`,
        accept_lost: `${pairs.filter(([a, b]) => verdict(a).accept && !verdict(b).accept).length}/${pairs.length}`, accept_gained: `${pairs.filter(([a, b]) => !verdict(a).accept && verdict(b).accept).length}/${pairs.length}`,
        wrong_text_added: `${pairs.filter(([a, b]) => !wrongText(verdict(a)) && wrongText(verdict(b))).length}/${pairs.length}`,
        worse_pages: worse.map(([a, b]) => ({ page: `${a.book_id}:${a.page_number}`, draft: verdict(a).fidelity, after: verdict(b).fidelity, accept: `${verdict(a).accept}->${verdict(b).accept}`, note: verdict(b).reader_note })) };
    }
  }

  // External references: Derge (Tibetan) and Kanripo (Chinese, where the leaf aligns). Per route the reference score;
  // then, on every page where two routes differ on the reference by more than its noise, does the judge order them
  // the same way? (Judge ties are counted apart.)
  const agreement = (cell, refScore, minGap, higherIsBetter) => {
    const ks = keyRows.filter((k) => k.cell === cell && k.kind === 'item' && verdict(k));
    const byPage = new Map(); for (const k of ks) { const r = refScore(k); if (r != null) byPage.set(k.page_id, [...(byPage.get(k.page_id) ?? []), { k, r }]); }
    const perRoute = {};
    for (const route of s.cells[cell].routes) { const xs = ks.filter((k) => k.route === route).map((k) => ({ book: k.book_id, v: refScore(k) })).filter((x) => x.v != null); perRoute[route] = { n: xs.length, mean: xs.length ? +mean(xs.map((x) => x.v)).toFixed(4) : null, ci95: clusterCI(xs, 6744).ci95 }; }
    let agree = 0, disagree = 0, ties = 0; const dis = [];
    for (const l of byPage.values()) for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
      const [a, b] = [l[i], l[j]]; const g = higherIsBetter ? b.r - a.r : a.r - b.r;
      if (Math.abs(g) < minGap || a.k.judged_as === b.k.judged_as) continue;
      const jd = Number(verdict(b.k).fidelity) - Number(verdict(a.k).fidelity) || (verdict(b.k).accept - verdict(a.k).accept);
      if (!jd) ties++; else if (Math.sign(jd) === Math.sign(g)) agree++; else { disagree++; dis.push({ page: `${a.k.book_id}:${a.k.page_number}`, routes: [a.k.route, b.k.route], ref: [a.r, b.r], fidelity: [verdict(a.k).fidelity, verdict(b.k).fidelity] }); }
    }
    const acc = ks.filter((k) => refScore(k) != null);
    const mAcc = mean(acc.filter((k) => verdict(k).accept).map(refScore)), mRej = mean(acc.filter((k) => !verdict(k).accept).map(refScore));
    return { per_route: perRoute, pages_with_ref: byPage.size, pair_min_gap: minGap, ordered_pairs: agree + disagree + ties, judge_agrees: agree, judge_disagrees: disagree, judge_ties: ties,
      agreement: agree + disagree ? +(agree / (agree + disagree)).toFixed(2) : null, disagreements: dis.slice(0, 8),
      ref_mean_accepted: mAcc == null ? null : +mAcc.toFixed(4), ref_mean_not_accepted: mRej == null ? null : +mRej.toFixed(4) };
  };
  const derge = JSON.parse(gz(path.join(TIB, 'scores-flash.json.gz'))).pages;
  report.cells.tibetan.reference = { name: 'Derge e-text (OpenPecha P000001), syllable identity of the read against the folio window (scores-flash.json.gz)',
    ...agreement('tibetan', (k) => derge[k.uid]?.[TIB_ARMS[k.route]]?.identity ?? null, 0.005, true) };
  const kanFile = path.join(OUT, 'kanripo-align.jsonl');
  if (fs.existsSync(kanFile)) {
    const kan = new Map(jsonl(fs.readFileSync(kanFile, 'utf8')).filter((a) => a.status === 'aligned').map((a) => [a.key, a]));
    const pk = new Map(J('packet.json').items.map((it) => [it.id, it]));
    const fold = (t) => String(t || '').replace(/<[^>]+>/g, '').replace(/[^\p{Script=Han}]/gu, '');
    const cer = (k) => { const a = kan.get(k.page_id); if (!a) return null; const ref = fold(a.kanripo_text); return ref.length ? +(lev(fold(pk.get(k.judged_as)?.text), ref) / ref.length).toFixed(4) : null; };
    const st = {}; for (const a of jsonl(fs.readFileSync(kanFile, 'utf8'))) st[a.status + (a.leaf ? `:${a.leaf}` : '')] = (st[a.status + (a.leaf ? `:${a.leaf}` : '')] ?? 0) + 1;
    report.cells.chinese.reference = { name: 'Kanripo WYG leaf (paddle-table-6388/align.mjs), Han-only CER of the read against the leaf (lower is better)', align_status: st, ...agreement('chinese', cer, 0.01, false) };
  }

  // Planted errors (Tibetan): the judge's catch rate. Below 80%, Derge decides the cell, not the judge.
  const pl = keyRows.filter((k) => k.kind === 'planted' && verdict(k));
  const ct = pl.filter((k) => caught(verdict(k), k.plant));
  const plRate = pl.length ? ct.length / pl.length : null;
  report.cells.tibetan.planted = { n: pl.length, caught: ct.length, catch_rate: plRate == null ? null : +plRate.toFixed(2), rule: 'below 0.80 the Derge score decides the cell, not the judge',
    decides: plRate != null && plRate >= 0.8 ? 'judge' : 'derge', accepted_with_plant: pl.filter((k) => verdict(k).accept).length,
    detail: pl.map((k) => ({ uid: k.uid, kind: k.plant.kind, orig: k.plant.orig, planted: k.plant.planted, caught: caught(verdict(k), k.plant), accept: verdict(k).accept, fidelity: verdict(k).fidelity })) };
  report.contain_candidates = contain;
  W('score.json', report);
  fs.writeFileSync(path.join(OUT, 'ocr-defect-observations.jsonl'), ocrRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'translation-rows.jsonl'), trRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`judged ${V.size} items; contain candidates ${contain.length}`);
  for (const [cell, C] of Object.entries(report.cells)) {
    for (const [route, x] of Object.entries(C.routes))
      console.log(`${cell}/${route}: control ${C.controls[route].passed ? 'PASS' : 'FAIL'} accept ${x.accept} [${x.accept_ci.ci95?.join(', ')}] by ${x.accept_ci.unit} wrong_text ${x.wrong_text_pages} ${JSON.stringify(x.wrong_text_classes)} fid ${x.fidelity_mean} per-usable ${JSON.stringify(x.cost_per_usable_page)}`);
    if (C.made_worse) for (const [p, m] of Object.entries(C.made_worse)) console.log(`  ${p}: worse ${m.worse} better ${m.better} accept lost ${m.accept_lost} gained ${m.accept_gained} wrong_text added ${m.wrong_text_added}`);
    if (C.reference) console.log(`  ref: ${JSON.stringify(C.reference.per_route)} agreement ${C.reference.agreement} (${C.reference.judge_agrees}/${C.reference.judge_agrees + C.reference.judge_disagrees}, ties ${C.reference.judge_ties})`);
    if (C.planted) console.log(`  planted: ${C.planted.caught}/${C.planted.n} -> ${C.planted.decides} decides`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!OUT) { console.error('--out=DIR required'); process.exit(2); }
  await ({ draw, refs, translate, packet, judge, score }[STAGE] ?? (() => { console.error('stages: draw | refs | translate | packet | judge | score'); process.exit(2); }))();
}
