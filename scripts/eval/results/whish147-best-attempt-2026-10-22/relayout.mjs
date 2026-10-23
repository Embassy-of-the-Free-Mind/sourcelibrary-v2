// RE-LAYOUT (#7119, Derek's inbox note of 2026-10-22 23:13): each leaf page's text as the leaf's PHYSICAL rows,
// reading straight across both string holes (‖), instead of the left-half / right-half rows the reads were made in.
// One sealed Opus call per leaf page: the whole leaf plus both halves, and the page's existing IAST text (and, for an
// edition-anchored leaf, the edition excerpt it was collated against). Opus only re-arranges: no word is re-read.
// An edition-anchored leaf may have a "…" gap filled with the edition words that lie between the words either side
// of it, where the image shows writing; a free read is re-arranged only.
// Every reply is checked before use (checkRelayout): the old letters must survive in order (≥ 95%), and every
// inserted run of 5+ letters must occur in the edition excerpt (none at all for a free read). A leaf that fails
// keeps its old rows, and the failure is recorded.
// Then the page OCR is rebuilt: warning (two holes, rows read across), Malayalam rows (mlym.py, Kerala spellings),
// rule, IAST rows; written through writePageText. Pages whose filled gaps change the text are listed for a fresh
// Opus translation (relayout-result.json).
//   node --env-file=/root/sourcelibrary/.env.production.local relayout.mjs [--pages=8-12] [--concurrency=3] [--apply]
// PRIOR ART: collate.mjs (the sealed call, the edition excerpt) and leaf-split.mjs (the page text shape); neither
// re-arranges rows. Needs reads/ unpacked from reads.tar.gz (the excerpt sidecars).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';
import { HERE, BOOK, SCRATCH, boxes, sealedCall, pool } from './lib.mjs';
import { corpus } from './locate.mjs';
import { warningFor, LAYOUT, LAYOUT_HALVES } from './assemble.mjs';
import { fold } from './textmatch.mjs';
import { writePageText } from '../../../lib/page-text-writer.mjs';
import { contentHash } from '../../../lib/write-provenance.mjs';
import { recordSweepAction } from '../../../lib/sweep-log.mjs';

const args = process.argv.slice(2);
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const APPLY = args.includes('--apply');
const CONC = Number(arg('concurrency') || 3);
const [P0, P1] = (arg('pages') || '1-316').split('-').map(Number);
const RUN = `whish147-relayout/${new Date().toISOString().slice(0, 19)}`;
export const MLYM_SENTENCE = 'The Malayalam script here is generated from the romanised reading; it applies this scribe’s regular spellings (dot-reph with the consonant after it doubled, doubled sibilants, nasals matched to the following stop, no spaces between words) but otherwise shows standard spelling.';
const IMG = path.join(SCRATCH, 'relayout-img');
fs.mkdirSync(IMG, { recursive: true });

const letters = (t) => fold(String(t).replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/<[^>]+>/g, ' ').replace(/^\s*\d+\.\s/gm, ' '))[0];

/**
 * Order-free check (rows move, so an in-order LCS cannot be used): every old segment (a row piece between ‖ marks,
 * 4+ letters) must occur in the new text, and every run of 5+ new letters no old segment accounts for must occur in
 * the edition excerpt (a free read may gain none).
 */
export function checkRelayout(oldT, newT, excerpt) {
  const nb = letters(newT);
  if (!nb) return { ok: false, why: 'empty reply' };
  const segs = oldT.split('\n').filter((l) => /^\s*\d+\.\s/.test(l)).flatMap((l) => l.replace(/^\s*\d+\.\s/, '').split(/‖|\s\|\s/)).map(letters).filter((x) => x.length >= 4);
  const covered = new Uint8Array(nb.length);
  let found = 0, total = 0;
  for (const sg of segs) {
    total += sg.length;
    let i = nb.indexOf(sg);
    while (i >= 0 && covered[i]) i = nb.indexOf(sg, i + 1);
    if (i < 0) i = nb.indexOf(sg);
    if (i >= 0) { found += sg.length; covered.fill(1, i, i + sg.length); }
  }
  const kept = found / Math.max(1, total);
  const runs = [];
  let run = '';
  for (let i = 0; i < nb.length; i++) { if (!covered[i]) run += nb[i]; else if (run) { runs.push(run); run = ''; } }
  if (run) runs.push(run);
  const big = runs.filter((r) => r.length >= 5);
  const ex = excerpt ? letters(excerpt) : '';
  const foreign = big.filter((r) => !ex.includes(r));
  const inserted = big.reduce((t, r) => t + r.length, 0);
  const ok = kept >= 0.95 && foreign.length === 0 && (!!excerpt || inserted === 0);
  return { ok, kept: +kept.toFixed(3), inserted, foreign: foreign.slice(0, 3), why: ok ? null : kept < 0.95 ? `kept ${kept.toFixed(2)} of the old segments` : foreign.length ? `inserted text not in the edition: ${foreign[0].slice(0, 30)}` : 'a free read gained text' };
}

function prompt(iast, excerpt) {
  return `The file p01.jpg is one whole palm leaf of a Kerala manuscript (Sanskrit in Malayalam script, Calicut 1822); p02.jpg and p03.jpg are its left and right halves at higher resolution. Open all three with the Read tool.

The leaf has TWO string holes. The top one or two rows and the bottom one or two rows run the full width; the rows between are interrupted by both holes (left | middle | right), and each physical row reads straight across both holes.

Below is an existing transcription of this leaf in IAST, made from the two halves separately: the rows of the left half, then the rows of the right half; a row of the left half usually continues in the same-numbered row of the right half.${excerpt ? ' It is anchored to the published text given after it; a … or a gap at a hole may hide words that are on the leaf.' : ''}

TRANSCRIPTION:
<<<
${iast}
>>>
${excerpt ? `\nEDITION (the passage the transcription was collated against):\n<<<\n${excerpt}\n>>>\n` : ''}
TASK: re-arrange this transcription into the leaf's PHYSICAL rows, top to bottom. Each output row is one row across the whole leaf, with ‖ between the segments on either side of a string hole. Do not re-read or change words: keep every word, every [leaf: …?] mark and every [illegible] exactly as written, and join a word split across the half boundary (na- + -rtakī → nartakī).${excerpt ? ' Where the transcription has … or a gap at a place where the image shows writing, fill it with the edition words that come between the words before and after the gap, and only those; fill nothing else.' : ' Add no words.'}

Answer only:
ROW 1 | <segment> ‖ <segment> ‖ <segment>
ROW 2 | ...
NOTE | <one line>`;
}

const WARN = /^<warning>([\s\S]*?)<\/warning>\s*/;
function iastBlock(ocr) {
  const rest = ocr.replace(WARN, '');
  const idx = rest.indexOf('**IAST transliteration**');
  const body = idx >= 0 ? rest.slice(idx + '**IAST transliteration**'.length) : rest;
  const lines = body.split('\n');
  const head = [];
  while (lines.length && (lines[0].trim() === '' || /^<(language|script|page-type|scan-quality)>/.test(lines[0].trim()))) { const l = lines.shift(); if (l.trim()) head.push(l.trim()); }
  const header = (rest.match(/^(?:\s*<(?:language|script|page-type|scan-quality)>[^\n]*\n)+/) || [''])[0].trim() || head.join('\n');
  return { header, block: lines.join('\n').trim() };
}
const hasRows = (block) => /^\s*\d+\.\s+(?!\[illegible)/m.test(block);
function toMalayalam(map) {
  const r = spawnSync(path.join(SCRATCH, 'venv/bin/python'), [path.join(HERE, 'mlym.py')], { input: JSON.stringify(map), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`mlym.py failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

async function main() {
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db('bookstore');
  const B = boxes();
  const { text: CORPUS, parts } = corpus();
  const pages = await db.collection('pages').find({ book_id: BOOK, page_number: { $gte: P0, $lte: P1 } }, { projection: { id: 1, page_number: 1, ocr: 1, archived_photo: 1, split_side: 1, split_position: 1, 'translation.data': 1 } }).sort({ page_number: 1 }).toArray();
  const results = [];
  await pool(pages, CONC, async (p) => {
    const ls = p.ocr?.leaf_split;
    const lmap = p.ocr?.engine?.input?.whish147?.leaves || {};
    const [leaf, L] = Object.entries(lmap)[0] || [];
    const method = L?.method;
    const { header, block } = iastBlock(p.ocr.data);
    const rec = { page_number: p.page_number, id: p.id, method, from: ls?.from_page_number ?? null, leaf: ls?.leaf ?? leaf };
    if (!ls || !['edition-anchored', 'free-read'].includes(method) || !hasRows(block)) { rec.action = 'kept (no reading to re-lay out)'; results.push({ ...rec, header, block, newBlock: null }); return; }
    // Images: the leaf box inside this child image.
    const n = ls.from_page_number, side = ls.leaf;
    const bx = B[n].leaves[side];
    const top = side === 'b' ? p.split_position : 0;
    const x0 = bx.L[0], x1 = bx.R[2], y0 = Math.max(0, bx.L[1] - top), y1 = bx.L[3] - top, mid = bx.L[2];
    const buf = Buffer.from(await (await fetch(p.archived_photo)).arrayBuffer());
    const files = [path.join(IMG, `${p.page_number}-w.jpg`), path.join(IMG, `${p.page_number}-L.jpg`), path.join(IMG, `${p.page_number}-R.jpg`)];
    if (!fs.existsSync(files[2])) {
      const meta = await sharp(buf).metadata();
      const H = Math.min(meta.height, y1) - y0;
      await sharp(buf).extract({ left: x0, top: y0, width: x1 - x0, height: H }).resize({ width: 2600 }).jpeg({ quality: 90 }).toFile(files[0]);
      await sharp(buf).extract({ left: x0, top: y0, width: mid - x0, height: H }).resize({ width: Math.min(2600, mid - x0) }).jpeg({ quality: 92 }).toFile(files[1]);
      await sharp(buf).extract({ left: mid, top: y0, width: x1 - mid, height: H }).resize({ width: Math.min(2600, x1 - mid) }).jpeg({ quality: 92 }).toFile(files[2]);
    }
    let excerpt = null;
    if (method === 'edition-anchored') {
      const ex = JSON.parse(fs.readFileSync(path.join(HERE, 'reads', 'collate', `${n}-${side}.excerpt.json`), 'utf8'));
      excerpt = CORPUS.slice(ex.corpus_start, ex.corpus_end).trim();
      if (ex.works.includes('ts')) excerpt = excerpt.split('\n').filter((l) => !/\p{L}-\p{L}/u.test(l)).join('\n');
    }
    const r = await sealedCall({ stage: 'relayout', id: `${n}-${side}`, model: 'opus', prompt: prompt(block, excerpt), images: files });
    const rows = r.text.split('\n').map((l) => l.match(/^ROW\s+(\d+)\s*\|\s*(.*)$/)).filter(Boolean).map((m) => `${m[1]}. ${m[2].trim()}`);
    const newBlock = rows.join('\n');
    const chk = r.meta.ok ? checkRelayout(block, newBlock, excerpt) : { ok: false, why: r.meta.error_class };
    rec.check = chk;
    rec.ellipsis_before = (block.match(/…/g) || []).length;
    rec.ellipsis_after = (newBlock.match(/…/g) || []).length;
    rec.action = chk.ok ? 'relaid' : `kept old rows: ${chk.why}`;
    results.push({ ...rec, header, block, newBlock: chk.ok ? newBlock : null, label: side === 't' ? 'Upper leaf' : 'Lower leaf' });
    console.log(`p${p.page_number} (${n}${side}, ${method}): ${rec.action} kept=${chk.kept} ins=${chk.inserted} …${rec.ellipsis_before}->${rec.ellipsis_after}`);
  });
  results.sort((a, b) => a.page_number - b.page_number);
  // Malayalam for every block that will be written.
  const mIn = {};
  for (const r of results) if (r.method && ['edition-anchored', 'free-read'].includes(r.method)) mIn[r.page_number] = r.newBlock ? `**${r.label}**\n\n${r.newBlock}` : r.block;
  const mOut = toMalayalam(mIn);
  const writes = [];
  for (const r of results) {
    if (!(r.page_number in mIn)) continue;
    const p = pages.find((x) => x.id === r.id);
    const lmap = p.ocr.engine.input.whish147.leaves;
    const iast = mIn[r.page_number];
    const ml = mOut[r.page_number];
    const hasReading = ml !== iast;
    const base = warningFor(lmap);
    const warning = `${r.newBlock ? base : base.replace(LAYOUT, LAYOUT_HALVES)}${hasReading ? ` ${MLYM_SENTENCE}` : ''}`;
    const data = `<warning>${warning}</warning>\n${r.header}\n\n${hasReading ? `${ml}\n\n---\n\n**IAST transliteration**\n\n${iast}` : iast}\n`;
    if (data === p.ocr.data) continue;
    // Retranslate only where the re-layout filled a gap with edition words (the English lacks them).
    writes.push({ r, p, data, retranslate: !!(r.newBlock && r.check?.inserted > 0 && p.translation?.data) });
  }
  console.log(`\n${results.filter((r) => r.action === 'relaid').length} relaid, ${results.filter((r) => /^kept old/.test(r.action || '')).length} kept old rows, ${writes.length} pages to write, ${writes.filter((w) => w.retranslate).length} to retranslate`);
  fs.writeFileSync(path.join(SCRATCH, 'relayout-preview.json'), JSON.stringify(writes.map((w) => ({ page_number: w.r.page_number, data: w.data })), null, 1));
  if (APPLY) {
    for (const w of writes) {
      const engine = { ...w.p.ocr.engine, input: { ...w.p.ocr.engine.input, whish147: { ...w.p.ocr.engine.input.whish147, relayout: w.r.newBlock ? { run: RUN, read: `reads/relayout/${w.r.from}-${w.r.leaf}.txt`, check: w.r.check } : null, script_from: 'iast-transliteration (mlym.py: dot-reph + doubled consonant, doubled sibilants, homorganic nasals, scriptio continua)' } } };
      const res = await writePageText(db, w.p.id, 'ocr', { ...w.p.ocr, data: w.data, content_hash: contentHash(w.data), engine, updated_at: new Date() }, { by: 'scripts/eval/results/whish147-best-attempt-2026-10-22/relayout.mjs', reason: 'physical-row layout + Kerala spellings (#7119)', run_id: RUN });
      if (res.status !== 'written') console.log(`  p${w.r.page_number}: ${res.status}`);
    }
    await recordSweepAction(db, { sweep: 'whish147-best-attempt', book_id: BOOK, action: 'relayout-physical-rows', detail: { run: RUN, issue: 7119, written: writes.length, retranslate: writes.filter((w) => w.retranslate).map((w) => w.r.page_number) } });
  }
  fs.writeFileSync(path.join(HERE, 'relayout-result.json'), JSON.stringify({ run: RUN, apply: APPLY, range: [P0, P1], pages: results.map(({ header, block, newBlock, ...r }) => r), retranslate: writes.filter((w) => w.retranslate).map((w) => ({ page_number: w.r.page_number, id: w.p.id })) }, null, 1));
  await c.close();
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main();
