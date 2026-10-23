// SPOT-CHECK FIXES (#7119, by-eye check of 2026-10-23 06:08Z), on every leaf page (split_from_spread set):
//   1. the hole marker: ‖hole‖ in the IAST (and ‖ഹോലേ‖ in the Malayalam made from it) -> a bare ‖;
//   2. headings: a single-leaf page is no longer "Upper leaf" / "Upper leaf, left half"; it is "Rows of this leaf", or,
//      where the physical-row re-layout failed its check, "Rows of this leaf, left half (half-leaf segments)" — and the
//      warning says which (two holes; rows read across them, or rows given as half-leaf segments);
//   3. the generated Malayalam is rebuilt from the page's IAST with mlym.py (word-final t -> ൽ, the consonant after the
//      dot-reph doubled, doubled sibilants, homorganic nasals, chillu finals, no word spaces, vowel + vowel kept apart,
//      quoted pratīkas not read as avagraha), and the warning's sentence about the generated script names them.
// Only the edition-anchored pages carry generated Malayalam; a fresh-read page's Malayalam is the model's own and only
// its heading changes. The <note> with the fresh read and the contents leaf are left as they are. No model call.
// Every write goes through writePageText (the previous text becomes a page revision). checkMalayalam() is the audit
// for rule 3 and runs over the text that would be written, with --apply or without.
//   node --env-file=/root/sourcelibrary/.env.production.local fix-spotcheck.mjs [--apply]
// PRIOR ART: relayout.mjs builds the same page shape (and is where LAYOUT_HALVES came from); apply-fresh.mjs writes
// the same way. Neither can be re-run for this: both make model calls and rebuild far more than the three defects.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { HERE, BOOK, SCRATCH } from './lib.mjs';
import { LAYOUT, LAYOUT_HALVES } from './assemble.mjs';
import { writePageText } from '../../../lib/page-text-writer.mjs';
import { contentHash } from '../../../lib/write-provenance.mjs';
import { recordSweepAction } from '../../../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const RUN = `whish147-spotcheck-fix/${new Date().toISOString().slice(0, 19)}`;
const PY = process.env.WHISH_PY || '/mnt/HC_Volume_105839809/jobs/whish147-best/venv/bin/python';
const OLD_MLYM = 'The Malayalam script here is generated from the romanised reading; it applies this scribe’s regular spellings (dot-reph with the consonant after it doubled, doubled sibilants, nasals matched to the following stop, no spaces between words) but otherwise shows standard spelling.';
export const MLYM_SENTENCE = 'The Malayalam script here is generated from the romanised reading; it applies this scribe’s regular spellings (dot-reph with the consonant after it doubled, doubled sibilants, nasals matched to the following stop, word-final t as ൽ, no spaces between words) but otherwise shows standard spelling.';
export const LAYOUT_SEGMENTS = 'The leaf has two string holes (‖). On this leaf the re-arrangement into whole rows failed its check, so its rows are given as half-leaf segments: the rows of the left half (up to the middle of the leaf), then those of the right half; a row of one half does not always continue in the same-numbered row of the other.';
export const ROWS = '**Rows of this leaf**';
const HALF = (h) => `**Rows of this leaf, ${h} half (half-leaf segments)**`;
const HOLE = /\s*‖\s*hole\s*‖\s*|\s*‖\s*hole\b\s*|\s*\bhole\s*‖\s*/gi;   // same as mlym.py HOLE
// The other ways the half-leaf reads marked a hole or the mid-leaf cut (pages 21, 36, 54, 58): "left of hole: X ‖
// right of hole: Y", "… [hole] …", "⟨hole⟩", "/ hole /", and "‖ cut ‖" / "‖ cut: X ‖" where a half ends at the cut.
const HOLE_FORMS = [
  [/\s*\b(?:left|right) of hole:\s*/gi, ' '],
  [/\s*\[hole\]\s*/gi, ' ‖ '],
  [/\s*⟨hole⟩\s*/gi, ' ‖ '],
  [/\s*\/\s*hole\s*\/\s*/gi, ' ‖ '],
  [/\s*‖\s*cut\s*‖\s*$/i, ''],
  [/\s*‖\s*cut:\s*([^‖]*?)\s*‖\s*$/i, ' $1'],
];

export function relabel(block) {
  return block
    .replace(/\*\*(?:Upper|Lower) leaf, (left|right) half\*\*/g, (_, h) => HALF(h))
    .replace(/\*\*(?:Upper|Lower) leaf\*\*/g, ROWS);
}
export function unhole(s) {
  const cut = /‖\s*cut\b/i.test(s);
  return s.split('\n').map((l) => {
    let x = l;
    for (const [re, to] of HOLE_FORMS) x = x.replace(re, to);
    if (cut) x = x.replace(/^(\s*\d+\.\s+)‖\s*/, '$1');   // a right half's rows began at the cut
    return x.replace(HOLE, ' ‖ ').replace(/(\S) {2,}/g, '$1 ').replace(/^(\s*\d+\.) +/, '$1 ').replace(/ +$/, '');
  }).join('\n');
}

/** Rule audit over a generated Malayalam block; returns a list of problems (empty = all rules hold). */
export function checkMalayalam(ml) {
  const bad = [];
  const rows = ml.split('\n').filter((l) => /^\s*\d+\.\s/.test(l)).map((l) => l.replace(/^\s*\d+\.\s+/, '').replace(/\[[^\]]*\]|‘|’|[…?]|\.\.\./g, '|'));
  for (const r of rows) {
    if (/[ഀ-ൿ] +[ഀ-ൿ]/.test(r.replace(/\s*[।॥‖|;,.:\-–]+\s*/g, '|').replace(/\|\s*[൦-൯]+\s*\|/g, '|'))) bad.push(`word space: ${r.slice(0, 60)}`);
    if (/(?<!ൎത്)ത്(?=$|[\s।॥‖.,;:]|-(?=[ഀ-ൿ]))/.test(r)) bad.push(`final ത്: ${r.slice(0, 60)}`);
    if (/[a-zāīūṛṃḥśṣṇṭḍñṅ]{2,}/i.test(r)) bad.push(`latin left: ${r.match(/[a-zāīūṛṃḥśṣṇṭḍñṅ]{2,}/i)[0]}`);
    if (/ര്(?=[ക-ഹൺ-ൿ])|ർ(?=[ക-ഹ])/.test(r)) bad.push(`r cluster not dot-reph: ${r.slice(0, 60)}`);
    for (const m of r.matchAll(/ൎ([ക-ഹ])(്?)([ക-ഹ]?)/g)) {
      const [, c, vir, next] = m;
      const noDouble = 'ശഷസഹരയ'.includes(c);   // sibilants, h, r; y is doubled (ൎയ്യ) by the rule below
      const asp = { ഖ: 'ക', ഘ: 'ഗ', ഛ: 'ച', ഝ: 'ജ', ഠ: 'ട', ഢ: 'ഡ', ഥ: 'ത', ധ: 'ദ', ഫ: 'പ', ഭ: 'ബ' };
      const doubled = vir && (next === c || asp[next] === c);
      if (!noDouble && !doubled && !asp[c]) bad.push(`not doubled after ൎ: ${m[0]}`);
      if (c === 'യ' && !(vir && next === 'യ')) bad.push(`not doubled after ൎ: ${m[0]}`);
    }
  }
  return bad;
}

function toMalayalam(map) {
  const r = spawnSync(PY, [path.join(HERE, 'mlym.py')], { input: JSON.stringify(map), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`mlym.py failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const SEP = '\n\n---\n\n**IAST transliteration**\n\n';
function parts(data) {
  const m = data.match(/^<warning>([\s\S]*?)<\/warning>\n((?:<(?:language|script|page-type|scan-quality)>[^\n]*\n)*)\n?([\s\S]*)$/);
  if (!m) return null;
  const [, warning, header, rest] = m;
  const ni = rest.indexOf('\n\n<note>');
  const body = ni >= 0 ? rest.slice(0, ni) : rest.trimEnd();
  const note = ni >= 0 ? rest.slice(ni) : '';
  const si = body.indexOf(SEP);
  return { warning, header, ml: si >= 0 ? body.slice(0, si) : null, iast: si >= 0 ? body.slice(si + SEP.length) : body, note };
}

async function main() {
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db('bookstore');
  const pages = await db.collection('pages').find({ book_id: BOOK, page_number: { $gt: 0 }, split_from_spread: { $exists: true } }, { projection: { id: 1, page_number: 1, ocr: 1 } }).sort({ page_number: 1 }).toArray();
  const plan = [], skipped = [], audit = {};
  const mlIn = {};
  for (const p of pages) {
    const w = p.ocr?.engine?.input?.whish147 || {};
    const pr = parts(p.ocr?.data || '');
    if (!pr) { skipped.push({ n: p.page_number, why: 'page text not in the expected shape' }); continue; }
    if (Object.values(w.leaves || {})[0]?.method === 'contents-leaf-read') { skipped.push({ n: p.page_number, why: 'contents leaf' }); continue; }
    p._pr = pr; p._primary = w.primary;
    if (w.primary === 'edition-anchored' && pr.ml != null) mlIn[p.page_number] = relabel(unhole(pr.iast));
  }
  const mlOut = toMalayalam(mlIn);
  const counts = { hole: 0, relabel: 0, halves_warning: 0, malayalam_rebuilt: 0, malayalam_changed: 0 };
  for (const p of pages) {
    const pr = p._pr;
    if (!pr) continue;
    let { warning, ml, iast } = pr;
    const had = { hole: /‖\s*hole|hole\s*‖|ഹോലേ|of hole:|\[hole\]|⟨hole⟩|\/\s*hole\s*\/|‖\s*cut\b/i.test(`${ml}\n${iast}`), heads: /\*\*(?:Upper|Lower) leaf/.test(`${ml}\n${iast}`), halves: warning.includes(LAYOUT_HALVES) };
    iast = relabel(unhole(iast));
    if (p.page_number in mlOut) {
      const newMl = mlOut[p.page_number];
      counts.malayalam_rebuilt++;
      if (newMl !== relabel(ml)) counts.malayalam_changed++;
      ml = newMl;
      const probs = checkMalayalam(ml);
      if (probs.length) audit[p.page_number] = probs.slice(0, 5);
      warning = warning.replace(OLD_MLYM, MLYM_SENTENCE);
    } else if (ml != null) ml = relabel(ml);
    if (had.halves) warning = warning.replace(LAYOUT_HALVES, LAYOUT_SEGMENTS);
    const data = `<warning>${warning}</warning>\n${pr.header}\n${ml != null ? `${ml}${SEP}${iast}` : iast}${pr.note || '\n'}`;
    if (data === p.ocr.data) continue;
    if (had.hole) counts.hole++;
    if (had.heads) counts.relabel++;
    if (had.halves) counts.halves_warning++;
    plan.push({ p, data, had });
  }
  console.log(`${pages.length} leaf pages; ${plan.length} to write`, counts, `; skipped ${skipped.length}; Malayalam rule problems on ${Object.keys(audit).length} pages`);
  for (const [n, a] of Object.entries(audit).slice(0, 15)) console.log(`  p${n}: ${a.join(' | ')}`);
  fs.writeFileSync(path.join(SCRATCH, 'spotcheck-preview.json'), JSON.stringify(plan.map((x) => ({ n: x.p.page_number, before: x.p.ocr.data, after: x.data })), null, 1));
  let ok = 0;
  if (APPLY) {
    for (const x of plan) {
      const w = x.p.ocr.engine?.input?.whish147;
      const eng = w ? { ...x.p.ocr.engine, input: { ...x.p.ocr.engine.input, whish147: { ...w, spotcheck_fix: { run: RUN, issue: 7119, ...x.had }, ...(x.p._primary === 'edition-anchored' ? { script_from: 'iast-transliteration (mlym.py: dot-reph + doubled consonant, doubled sibilants, homorganic nasals, word-final t as ൽ, scriptio continua)' } : {}) } } } : x.p.ocr.engine;
      const next = { ...x.p.ocr, data: x.data, content_hash: contentHash(x.data), ...(eng ? { engine: eng } : {}), updated_at: new Date() };
      const r = await writePageText(db, x.p.id, 'ocr', next, { by: 'scripts/eval/results/whish147-best-attempt-2026-10-22/fix-spotcheck.mjs', reason: 'spot-check fixes: hole marker, leaf headings, Kerala spellings (#7119)', run_id: RUN });
      if (r.status === 'written') ok++; else skipped.push({ n: x.p.page_number, why: `writer: ${r.status}` });
    }
    await recordSweepAction(db, { sweep: 'whish147-best-attempt', book_id: BOOK, action: 'spotcheck-fix', detail: { run: RUN, issue: 7119, written: ok, ...counts } });
    console.log(`written ${ok}`);
  }
  fs.writeFileSync(path.join(HERE, 'fix-spotcheck-result.json'), JSON.stringify({ run: RUN, apply: APPLY, written: ok, counts, pages: plan.map((x) => ({ n: x.p.page_number, ...x.had })), audit, skipped }, null, 1));
  await c.close();
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main();
