#!/usr/bin/env node
// PRIOR ART: scripts/eval/paired-fifths-8405/run.mjs is the study that chose the paired-fifths draw (#8405: 24 of 159
// books good on 5 pages were bad on 10 paired pages; preregistered bar 5%); its join rules, image fetch and text
// cleaning are imported. The call shape is the P5-opus arm of the #8478 call-shape test (scripts/eval/callshape-8478/
// run.mjs on PR #8495: batchPrompt / parseBatch for a pair). It is restated here because that PR is not merged and a
// standing check cannot import from an unmerged study; the prompt is byte-identical for a pair (tests pin the cut
// points). scripts/maintenance/judge-verdicts-to-book-checks.mjs maps route-judge verdicts to book_checks; the page
// mapping below follows it (fidelity <= 3 serious, <= 2 fix). scripts/lib/book-checks.mjs recordPageVerdicts() writes.
/**
 * paired-fifths-check v2: the standing Opus check of a book (scripts/eval/methods/paired-fifths-check.md).
 * For each book: the paired-fifths draw (scripts/lib/paired-fifths.mjs, seeded by the book id), then ONE Opus call per
 * pair of facing pages, with both scans, both transcriptions and both English pages, judging each page (transcription
 * and English) and the break between them. Five calls a book (v1 made fifteen). One book_checks row.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/paired-fifths-check.mjs \
 *        --books=<id,id,...> | --books-file=<file, one id a line>  [--apply] [--max-calls=N] [--concurrency=3] [--run-id=…]
 *
 * Dry run by default: judges (Opus on the subscription, behind the lane-judge pace guard: weekly 85%, 5-hour 95%) and
 * prints the rows it would write. --apply writes them. Evidence: scripts/eval/results/paired-fifths-check/<run_id>.json,
 * written either way; commit it with the run. Re-running a run_id resumes from its evidence file and never doubles a row.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../lib/mongo.mjs';
import { recordPageVerdicts } from '../lib/book-checks.mjs';
import { contentHash } from '../lib/write-provenance.mjs';
import { pairedFifths, pairedReadingOrder, PAIRED_FIFTHS_VERSION } from '../lib/paired-fifths.mjs';
import { eligiblePage, imageUrl, paceCheck, sha } from './confidence-7866/lib.mjs';
import { opusCall, judgePrompt } from './route-judge-6740/judge.mjs';
import { joinPrompt, imageFor, clean, PAGE_PROJECTION } from './paired-fifths-8405/run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
export const METHOD = Object.freeze({ id: 'paired-fifths-check', version: '2' });
/** The prompt the #8478 P5-opus arm was validated with (carry-over 10/10, wrong-leaf 10/10, planted English 8/10). */
export const PROMPT_VERSION = 'p5-8478';
const KIND = { carry_over: 'carry_over', duplicated: 'carry_over', wrong_leaf: 'wrong_leaf', dropped: 'omission' };
const STAGE = (layer) => (layer === 'english' ? 'translation' : 'ocr');
const SEVERE = ['misleads', 'wrong_text'];

// ── the P5 prompt (#8478 batchPrompt for one pair), cut from the existing judges, not restated ──
function between(s, from, to) {
  const i = s.indexOf(from), j = s.indexOf(to, i + 1);
  if (i < 0 || j < 0) throw new Error(`prompt block "${from}" … "${to}" not found: the source prompt changed`);
  return s.slice(i, j).trim();
}
/** The route-judge page questions (accept, fidelity, defects with the 44-class taxonomy, reader_note, markup rule). */
export const PAGE_QUESTIONS = between(judgePrompt({ task: 'ocr', lang: 'X', text: 'X' }, 'X'), 'Questions:', 'Answer with one JSON object only').replace(/^Questions:\s*/, '');
/** The join judge v1 rules (kinds, furniture, the per-defect fields), as the P5 arm was validated with. */
export const BREAK_RULES = between(joinPrompt('X', { ocr: 'X', tr: 'X' }, { ocr: 'X', tr: 'X' }), 'Judge the BREAK', 'PAGE A transcription:');
const PAGE_EXTRA = `- en_accept: the same question for the page's ENGLISH translation (the page's statements, negations, names and numbers; style aside): true or false.
- Report defects in the ENGLISH too, with the same classes and severities, and give every defect a layer: "transcription" or "english".`;
const tag = (i) => `p${String(i + 1).padStart(2, '0')}`;
const PAGE_JSON = (t) => `{"page": "${t}", "accept": true, "fidelity": 5, "en_accept": true, "defects": [{"layer": "transcription", "class": "O6", "quote": "...", "severity": "misleads", "what": "a few words"}], "reader_note": "..."}`;
const BREAK_JSON = (a, b) => `{"break": "${a}/${b}", "join": "clean|defect", "defects": [{"kind": "carry_over", "layer": "english", "page": "B", "quote": "...", "material": true}]}`;

/** pages: the pages in reading order, each { page_number, ocr, tr } (cleaned); consecutive pairs are the breaks. */
export function batchPrompt(lang, pages) {
  const n = pages.length, ts = pages.map((_, i) => tag(i));
  const pairs = []; for (let i = 0; i + 1 < n; i += 2) pairs.push([ts[i], ts[i + 1]]);
  const many = n > 2;
  const block = pages.map((p, i) => `=== ${tag(i)} (stored page ${p.page_number}) ===
TRANSCRIPTION:
<<<
${p.ocr}
>>>
ENGLISH:
<<<
${p.tr || '(none)'}
>>>`).join('\n\n');
  return `You are checking ${many ? `${n} pages` : 'two consecutive pages'} of a historical ${lang} book, for a library that publishes each page's transcription and English translation beside its scan. The scans are the only authority: read each leaf yourself, closely, line by line, and compare.

Open ${many ? 'every image' : 'both images'} with Read before you answer: ${ts.map((t) => `./${t}.jpg`).join(', ')}, in reading order.${many ? ` The pages come in ${pairs.length} pairs of consecutive pages (${pairs.map((p) => p.join('/')).join(', ')}); the pairs are from different parts of the book.` : ''}

PART 1, EACH PAGE. Judge each page's transcription (here called "the candidate") against its own scan, and its English against the scan and the transcription:
${PAGE_QUESTIONS}
${PAGE_EXTRA}

PART 2, EACH BREAK between the two pages of a pair (${pairs.map((p) => p.join('/')).join(', ')}). In each break, A is the first page of the pair and B the second.
${BREAK_RULES}

${block}

Answer with one JSON object only, one entry per page and one per break:
{"opened": [${ts.map((t) => `"${t}.jpg"`).join(', ')}], "pages": [${PAGE_JSON(ts[0])}, ...], "breaks": [${BREAK_JSON(...pairs[0])}${many ? ', ...' : ''}], "note": "<one line>"}`;
}

/** The judge's JSON for n pages, or null when it is not one entry a page and one a break with valid fields. */
export function parseBatch(t, n) {
  const m = String(t || '').match(/\{[\s\S]*\}/);
  try {
    const v = JSON.parse(m[0]);
    if (!Array.isArray(v.pages) || !Array.isArray(v.breaks) || v.pages.length !== n || v.breaks.length !== n / 2) return null;
    for (const p of v.pages) if (typeof p.accept !== 'boolean' || !(Number(p.fidelity) >= 1 && Number(p.fidelity) <= 5) || !Array.isArray(p.defects ?? [])) return null;
    for (const b of v.breaks) if (!['clean', 'defect'].includes(b.join) || !Array.isArray(b.defects ?? [])) return null;
    return v;
  } catch { return null; }
}

/**
 * One page verdict for recordPageVerdicts, from the page judge and the failed break findings that name this page.
 * A transcription defect counts when the page's fidelity is <= 3 (as judged-pages); an English defect (v2: the pair
 * judge reads the English) counts on its own, on the translation stage, since fidelity scores the transcription.
 */
export function pageVerdict(page, v, joinDefects) {
  const f = Number(v.fidelity);
  const severe = (v.defects || []).filter((d) => SEVERE.includes(d.severity));
  const err = (d) => ({ stage: STAGE(d.layer), ...(d.class ? { class: d.class } : {}), problem: String(d.what ?? d.quote ?? '').slice(0, 300) || 'no detail given' });
  const pageErrors = [...(f <= 3 ? severe.filter((d) => d.layer !== 'english') : []), ...severe.filter((d) => d.layer === 'english')].map(err);
  const joinErrors = joinDefects.map((d) => ({ stage: STAGE(d.layer), kind: KIND[d.kind], problem: `page break: ${d.kind} — "${String(d.quote ?? '').slice(0, 200)}"` }));
  const errors = [...pageErrors, ...joinErrors];
  const wrongLeaf = joinDefects.some((d) => d.kind === 'wrong_leaf') || (v.defects || []).some((d) => /^I1$/.test(d.class ?? ''));
  const serious = errors.length > 0 || wrongLeaf;
  const page_verdict = f <= 2 || wrongLeaf ? 'fix' : serious ? 'caveat' : 'show';
  const en = typeof v.en_accept === 'boolean' ? `; English ${v.en_accept ? 'accepted' : 'not accepted'}` : '';
  return {
    page_id: page.id, outcome: serious ? 'serious' : f >= 5 && v.en_accept !== false ? 'clean' : 'minor', page_verdict,
    verdict: `fidelity ${f}${en}${joinDefects.length ? `; page break: ${joinDefects.map((d) => d.kind).join(', ')}` : ''}`,
    note: [v.reader_note, ...joinDefects.map((d) => `Break: ${d.kind} (${d.layer}) "${String(d.quote ?? '').slice(0, 160)}"`)].filter(Boolean).join(' ').slice(0, 1500),
    ...(wrongLeaf ? { wrong_page: true } : {}),
    errors: serious && !errors.length ? [{ stage: 'other', kind: 'wrong_leaf', problem: 'another leaf\'s text' }] : errors,
    defects: v.defects ?? [],
    judged: { ocr: page.ocr?.data ?? '', translation: page.translation?.data ?? '' },
  };
}

/** The page verdicts of one judged pair: [first, second], each with the material break defects that name it. */
export function pairVerdicts(pageA, pageB, v) {
  const brk = (v.breaks?.[0]?.defects ?? []).filter((d) => d.material === true && KIND[d.kind]);
  // The judge names each entry (p01, p02); trust the names over the order when both are given.
  const byTag = Object.fromEntries(v.pages.map((p) => [p.page, p]));
  const [first, second] = byTag.p01 && byTag.p02 ? [byTag.p01, byTag.p02] : v.pages;
  return [pageVerdict(pageA, first, brk.filter((d) => d.page === 'A')), pageVerdict(pageB, second, brk.filter((d) => d.page === 'B'))];
}

const textHash = (p) => `${contentHash(p.ocr?.data ?? '')}:${contentHash(p.translation?.data ?? '')}`;

async function judgePair(lang, a, b) {
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'pfc-'));
  try {
    fs.writeFileSync(path.join(ws, 'p01.jpg'), await imageFor(a.id, imageUrl(a)));
    fs.writeFileSync(path.join(ws, 'p02.jpg'), await imageFor(b.id, imageUrl(b)));
    const prompt = batchPrompt(lang, [a, b].map((p) => ({ page_number: p.page_number, ocr: clean(p.ocr?.data), tr: clean(p.translation?.data) })));
    const t0 = Date.now(), r = await opusCall(prompt, ws, 'opus');
    return { verdict: r.cls === 'quota' ? null : parseBatch(r.text, 2), cls: r.cls, model: r.model, usage: r.usage, prompt_sha: sha(prompt).slice(0, 16), secs: Math.round((Date.now() - t0) / 1000) };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}

async function main() {
  const ids = (arg('books') ?? (arg('books-file') ? fs.readFileSync(arg('books-file'), 'utf8') : '')).split(/[\s,]+/).filter(Boolean);
  if (!ids.length) { console.error('usage: --books=<id,...> | --books-file=<file> [--apply]'); process.exit(2); }
  const runId = arg('run-id') ?? `pfc-p5-${new Date().toISOString().slice(0, 10)}-${sha(ids.join(',')).slice(0, 8)}`;
  const evDir = path.resolve(HERE, '..', 'eval', 'results', 'paired-fifths-check');
  const evFile = path.join(evDir, `${runId}.json`);
  const ev = fs.existsSync(evFile) ? JSON.parse(fs.readFileSync(evFile, 'utf8')) : { run_id: runId, method: METHOD, draw: PAIRED_FIFTHS_VERSION, prompt_version: PROMPT_VERSION, books: {} };
  if (String(ev.method?.version) !== METHOD.version) { console.error(`${evFile} is a v${ev.method?.version} run; v${METHOD.version} cannot resume it — pick another --run-id`); process.exit(2); }
  const save = () => { fs.mkdirSync(evDir, { recursive: true }); fs.writeFileSync(evFile, JSON.stringify(ev, null, 1) + '\n'); };
  const limits = await import('../lib/model-limits.mjs');
  const state = {};
  const maxCalls = Number(arg('max-calls') ?? Infinity);
  const conc = Math.max(1, Math.min(5, Number(arg('concurrency') || 3)));
  let calls = 0, stop = null;
  const report = { books: ids.length, judged: 0, written: 0, already: 0, failed: [], verdicts: { show: 0, caveat: 0, fix: 0 } };

  await withMongo(async (db) => {
    for (const bookId of ids) {
      if (stop) break;
      const meta = await db.collection('books').findOne({ $or: [{ id: bookId }, { _id: bookId }] }, { projection: { id: 1, language: 1 } });
      if (!meta) { report.failed.push({ book: bookId, error: 'book not found' }); continue; }
      const all = await db.collection('pages').find({ book_id: bookId }, { projection: PAGE_PROJECTION }).sort({ page_number: 1 }).toArray();
      const byNum = new Map(all.map((p) => [p.page_number, p]));
      const pairs = pairedFifths(all.map((p) => ({ page_number: p.page_number, eligible: eligiblePage(p) })), bookId);
      if (pairs.length < 4) { report.failed.push({ book: bookId, error: `only ${pairs.length} pairs drawable` }); continue; }
      const rec = ev.books[bookId] ?? (ev.books[bookId] = { lang: meta.language ?? 'unknown', pairs, calls: {} });
      // One call per pair still to judge, up to --concurrency at once; stop cleanly on the pace guard or the call cap.
      const todo = pairs.filter((p) => !rec.calls[`${p.first}/${p.second}`]);
      await Promise.all(Array.from({ length: conc }, async () => {
        while (!stop && todo.length) {
          if (calls >= maxCalls) { stop = `call cap ${maxCalls}`; break; }
          const why = await paceCheck(limits, state);
          if (why) { stop = `pace: ${why}`; break; }
          const p = todo.shift(); // another worker may have taken the last pair while this one awaited the meter
          if (!p) break;
          const key = `${p.first}/${p.second}`;
          calls++;
          try {
            const a = byNum.get(p.first), b = byNum.get(p.second);
            const r = await judgePair(rec.lang, a, b);
            if (r.cls === 'quota') { stop = 'quota'; break; }
            if (r.verdict) rec.calls[key] = { verdict: r.verdict, hashes: [textHash(a), textHash(b)], model: r.model, usage: r.usage, prompt_sha: r.prompt_sha, secs: r.secs };
            else report.failed.push({ book: bookId, item: key, error: `no verdict (${r.cls ?? 'unparseable'})` });
          } catch (e) { report.failed.push({ book: bookId, item: key, error: e.message }); }
          save();
        }
      }));
      if (stop || pairs.some((p) => !rec.calls[`${p.first}/${p.second}`])) continue;
      report.judged++;
      // A page whose text changed since it was judged is left out: the row then covers what was judged.
      const verdicts = [];
      for (const p of pairs) {
        const c = rec.calls[`${p.first}/${p.second}`], a = byNum.get(p.first), b = byNum.get(p.second);
        const [va, vb] = pairVerdicts(a, b, c.verdict);
        if (c.hashes[0] === textHash(a)) verdicts.push(va);
        if (c.hashes[1] === textHash(b)) verdicts.push(vb);
      }
      const out = await recordPageVerdicts(db, {
        method_id: METHOD.id, method_version: METHOD.version, run_id: runId, checked_at: new Date(),
        selection: 'random', stages: ['ocr', 'translation'],
        reader: { kind: 'model', model: Object.values(rec.calls)[0]?.model ?? 'claude-opus', image_opened: true },
        evidence_path: path.relative(path.resolve(HERE, '..', '..'), evFile),
        reader_warning: true,
        frame: { draw: PAIRED_FIFTHS_VERSION, pairs: pairs.length, call_shape: 'P5', prompt_version: PROMPT_VERSION },
        note: `${verdicts.length} pages (two facing pages from each fifth of the book) and their ${pairs.length} page breaks, one reading per pair, transcription and English read against the page images.`,
        verdicts,
      }, { apply: APPLY });
      report.written += out.inserted; report.already += out.already; report.failed.push(...out.failed);
      const vd = out.rows[0]?.verdict;
      if (vd) report.verdicts[vd] = (report.verdicts[vd] ?? 0) + 1;
      console.log(JSON.stringify({ book: bookId, verdict: vd, findings: out.rows[0]?.page_findings?.length }));
    }
  }, { noTimeout: true }); // a run judges many books; the 300s default killed v1 after one (#8478)
  save();
  console.log(`${APPLY ? 'APPLY' : 'dry run'} ${runId}: ${report.judged}/${report.books} books fully judged, ${calls} calls; written ${report.written}, already ${report.already}; verdicts ${JSON.stringify(report.verdicts)}; failed ${report.failed.length}${stop ? `; stopped: ${stop}` : ''}`);
  for (const f of report.failed) console.log(`  FAILED ${JSON.stringify(f)}`);
  if (report.failed.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
