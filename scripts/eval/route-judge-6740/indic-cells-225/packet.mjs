#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs `packet` (blind items, key rows, wrong-page controls, one call per
// distinct text) and its `correction()` (how a cli-ocr read in correct mode becomes an output: UNCHANGED is the draft,
// CONTAIN is counted apart, a read made on another draft is no output). Its packet is wired to its named cells; this
// one reads the #225 run's reads (cli-ocr.mjs read dirs and d-diff.mjs D outputs) and writes judge.mjs's files, so
// `judge.mjs judge`, `paired-arm.mjs check|score` and `defect-rate.py` run on it unchanged.
/**
 *   node packet.mjs --run=<job run dir> --out=<results dir>
 *
 * Cells and arms (blind in the packet; the key names them):
 *   tamil   agy        cli-ocr.mjs read, live OCR prompt, gemini-3.8-flash-low, image only     (arms/ta-agy)
 *           ia>agy     cli-ocr.mjs read --correct-prompt (fc template 0601ef30) over the Internet Archive's own OCR
 *                      of the leaf (ia-drafts-*.json)                                          (arms/ta-ia-agy)
 *           surya>agy  the same correction over Surya 2's read on gex45 (surya-drafts-ta.json) (arms/ta-surya-agy)
 *   series  gpu2>agy   d-diff.mjs arm D: LightOnOCR-3-1B draft + Surya 2 draft + their word diff, agy Flash-low
 *                      reconciles with the image (the english-gpu-7263 bound route)          (gpu2/e2/D-r1)
 *           agy        cli-ocr.mjs read, live OCR prompt, image only                          (arms/sx-agy)
 * Controls: one wrong-page item per arm (this page's image, the arm's output for a page of another book); REPEATS: the
 * same output judged a second time, under another id, on 2 pages per Tamil arm and 3 per series arm (the noise floor).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { contentHash } from '../../../lib/write-provenance.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const RUN = path.resolve(arg('run'));
const OUT = path.resolve(arg('out'));
fs.mkdirSync(OUT, { recursive: true });
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(path.join(RUN, f), 'utf8'));
const has = (f) => fs.existsSync(path.join(RUN, f));

const TAMIL_NOTE = 'READING RULE FOR THIS PAGE: the page is printed in Tamil script (it may also carry Sanskrit in Devanagari or Grantha, and Tamil numerals such as ௧ ௨ ௩). Compare letter by letter: a wrong or missing vowel sign, a missing pulli (the dot), or a confused consonant changes the word, and is a defect. Text in a script the page does not print (for example Malayalam or Devanagari letters where the page prints Tamil) is a defect.';
const SERIES_NOTE = 'READING RULE FOR THIS PAGE: the page is printed in romanized (transliterated) Pali, Sanskrit or Prakrit, in Latin letters with diacritics (ā ī ū ṛ ṝ ḷ ṃ ṁ ṅ ñ ṇ ṭ ḍ ś ṣ ḥ ç, and accents). The diacritics are part of the spelling: ā and a, ṃ and m, ṣ and s, ç and c are different letters. Count EVERY dropped, added or wrong diacritic in the candidate as its own defect (class O8 when the candidate normalised it toward the plain letter, O6 otherwise), with severity "misleads" at least. A candidate that drops or changes diacritics throughout is not acceptable as this page\'s transcription. Expanding or "correcting" the page\'s spelling (e.g. writing ā as am) is a defect too.';

const CELLS = {
  tamil: {
    lang: 'Tamil', note: TAMIL_NOTE,
    draws: ['draw-tamil-kov.json', 'draw-tamil-tor.json'].filter(has),
    arms: {
      agy: { kind: 'fresh', dir: 'arms/ta-agy', served: 'this run\'s fresh read (agy gemini-3.8-flash-low, live OCR prompt v19.1), not served' },
      'ia>agy': { kind: 'correct', dir: 'arms/ta-ia-agy', drafts: ['ia-drafts-kov.json', 'ia-drafts-tor.json'].filter(has), served: 'this run\'s agy correction of the Internet Archive OCR of the leaf, not served' },
      'surya>agy': { kind: 'correct', dir: 'arms/ta-surya-agy', drafts: ['surya-drafts-ta.json'].filter(has), served: 'this run\'s agy correction of a Surya 2 read (gex45), not served' },
    },
    repeats: 2,
  },
  series: {
    lang: 'romanized Pali / Sanskrit / Prakrit', note: SERIES_NOTE,
    draws: ['draw-series.json'],
    arms: {
      'gpu2>agy': { kind: 'd-diff', dir: 'gpu2/e2/D-r1', served: 'this run\'s d-diff.mjs arm D (LightOnOCR + Surya 2 drafts and their diff, agy gemini-3.8-flash-low reconciles), not served' },
      agy: { kind: 'fresh', dir: 'arms/sx-agy', served: 'this run\'s fresh read (agy gemini-3.8-flash-low, live OCR prompt v19.1), not served' },
    },
    repeats: 3,
  },
};

/** An arm's output for a page: { text } | { contain } | { none }. */
function output(arm, page) {
  const d = path.join(RUN, arm.dir);
  if (arm.kind === 'd-diff') {
    let r; try { r = JSON.parse(fs.readFileSync(path.join(d, `${page.page_id}.json`), 'utf8')); } catch { return { none: 'not read' }; }
    if (r.outcome === 'contain') return { contain: r.reason || r.text || 'contain' };
    return r.final?.trim() ? { text: r.final.trim(), unchanged: r.outcome === 'unchanged' } : { none: r.reason || r.outcome || 'empty' };
  }
  let m; try { m = JSON.parse(fs.readFileSync(path.join(d, `${page.page_id}.meta.json`), 'utf8')); } catch { return { none: 'not read' }; }
  if (m.exit !== 0 || m.error_class || m.wrapper) return { none: m.error_class || m.wrapper || `exit ${m.exit}` };
  const t = fs.readFileSync(path.join(d, `${page.page_id}.txt`), 'utf8').trim();
  if (arm.kind === 'fresh') return t ? { text: t } : { none: 'empty' };
  const drafts = Object.assign({}, ...arm.drafts.map(J));
  const draft = drafts[page.page_id];
  if (!draft) return { none: 'no draft' };
  if (m.draft?.text_hash !== contentHash(draft)) return { none: 'the draft the corrector read is not this draft' };
  if (/^UNCHANGED\.?$/i.test(t)) return { text: draft.trim(), unchanged: true };
  if (/^CONTAIN\s*:/i.test(t) && t.length < 600 && !/<page-type>/.test(t)) return { contain: t.replace(/^CONTAIN\s*:\s*/i, '') };
  return t ? { text: t } : { none: 'empty' };
}

const sample = { built_at: new Date().toISOString(), run: RUN, cells: {} };
const items = [], key = [], skipped = [], seen = new Set();
const add = (cell, route, p, kind, text, extra = {}) => {
  const cs = CELLS[cell];
  const tag = kind === 'item' ? `${cell}:${p.page_id}:${h(text.trim())}` : `${kind}:${cell}:${route}:${p.page_id}:${extra.other ?? ''}`;
  const id = `j${h(tag).slice(0, 10)}`;
  if (!seen.has(id)) { seen.add(id); items.push({ id, task: 'ocr', lang: cs.lang, image_url: p.image_url, text, judge_note: cs.note }); }
  key.push({ id: `k${h(`${kind}:${cell}:${route}:${p.page_id}:${extra.other ?? ''}`).slice(0, 10)}`, judged_as: id, cell, route, kind,
    served: cs.arms[route].served, page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, ...extra });
};
for (const [cell, cs] of Object.entries(CELLS)) {
  const pages = cs.draws.flatMap((f) => J(f).picked);
  sample.cells[cell] = { task: 'ocr', lang: cs.lang, paired: true, routes: Object.keys(cs.arms), draws: cs.draws, pages: pages.map(({ book_id, page_id, page_number, ia, title, year, collection, image_url }) => ({ book_id, page_id, page_number, ia, title, year, collection, image_url })) };
  for (const [route, arm] of Object.entries(cs.arms)) {
    const ok = [];
    for (const p of pages) {
      const o = output(arm, p);
      if (!o.text) { skipped.push({ cell, route, page_id: p.page_id, book_id: p.book_id, why: o.contain ? `CONTAIN: ${o.contain}` : o.none, contain: !!o.contain }); continue; }
      ok.push([p, o]);
      add(cell, route, p, 'item', o.text, o.unchanged ? { unchanged: true } : {});
    }
    if (ok.length < 4) continue;
    // one wrong-page control: the first page's image with this arm's output for a page of another book (seeded order)
    const ord = [...ok].sort((a, b) => h(`ctl:${route}:${a[0].page_id}`).localeCompare(h(`ctl:${route}:${b[0].page_id}`)));
    const [p0] = ord[0], [p1, o1] = ord.find(([q]) => q.book_id !== p0.book_id);
    add(cell, route, p0, 'wrong_page', o1.text, { other: p1.page_id });
    // repeats: the same output judged again under another id
    for (const [p, o] of ord.slice(1, 1 + cs.repeats)) add(cell, route, p, 'repeat', o.text, { other: 'repeat' });
  }
}
// shuffle the packet by a hash of the id, so arms do not run in blocks
items.sort((a, b) => h(`order:${a.id}`).localeCompare(h(`order:${b.id}`)));
fs.writeFileSync(path.join(OUT, 'sample.json'), JSON.stringify(sample, null, 1));
fs.writeFileSync(path.join(OUT, 'packet.json'), JSON.stringify({ items }, null, 1));
fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 1));
fs.writeFileSync(path.join(OUT, 'packet-skipped.json'), JSON.stringify(skipped, null, 1));
const tally = {}; for (const k of key) { const t = `${k.cell}/${k.route}/${k.kind}`; tally[t] = (tally[t] ?? 0) + 1; }
console.log(`packet: ${items.length} judge calls; ${key.length} key rows; skipped ${skipped.length}`); console.log(tally);
