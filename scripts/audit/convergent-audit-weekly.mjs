#!/usr/bin/env node
// PRIOR ART: scripts/eval/second-reader/ (draw.mjs, run-readers.sh, second-reader.mjs cli-requests/cli-assemble: the
// #6338 two-family reader path this reuses unchanged, with the frozen REVIEWER.md + CALIBRATION-ADDENDUM.md brief) and
// scripts/eval/spot-check/fortnightly-draw.sh (a scheduled one-family spot check). Neither samples the pages a write
// lane changed, nor posts a two-reader rate with agreement each week. This is #6420 lane D.
/**
 * The weekly convergent audit (#6420 lane D). Every Monday: one page per book from 60 random visible non-English books,
 * plus 20 pages lane B (scripts/batch/ocr-convergence) wrote. Opus (subscription, sealed `claude -p`) and Gemini 3.7
 * Flash (agy CLI, plan mode) each read every page against its image with the frozen #6338 brief. Posts serious-error
 * rates with Wilson 95% CIs, inter-reader agreement and the top findings as a comment on #6420.
 *
 *   node --env-file=.env.production.local scripts/audit/convergent-audit-weekly.mjs draw  --run R [--books 60] [--written 20] [--seed N]
 *   scripts/eval/second-reader/run-readers.sh R opus claude opus read 4
 *   node scripts/eval/second-reader/second-reader.mjs cli-requests --run R --reader gemini37
 *   python3 scripts/eval/run-cli-arm.py --requests R/readers/gemini37/requests.jsonl --out R/readers/gemini37/cli-out.jsonl \
 *     --arm audit6420-gemini37 --model gemini-3.7-flash-low --job convergent-audit-6420 --kind review --parallel 2 --attempts 4
 *   node scripts/eval/second-reader/second-reader.mjs cli-assemble --run R --reader gemini37
 *   node scripts/audit/convergent-audit-weekly.mjs score --run R [--post]
 *
 * scripts/audit/convergent-audit-weekly.sh runs the whole sequence (the cron entry point). Read-only on Mongo; the
 * only write anywhere is the GitHub comment with --post.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { structureCounts, pageImageUrl } from '../eval/spot-check/lib.mjs';
import { validateOutput, wilson, keyOf, redactRecord } from '../eval/second-reader/lib.mjs';
import { makeRng } from '../eval/lib/paired-stats.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k) => argv.includes(`--${k}`);
const R = opt('run');
if (!R) { console.error('--run DIR required (see the header)'); process.exit(2); }
const J = (...p) => path.join(R, ...p);
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, x) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(x, null, 1) + '\n'); };
const READERS = ['opus', 'gemini37'];
const ENGLISH = /^(english|middle english|old english|early modern english|en)$/i;
const EXCLUDED_TYPES = new Set(['archived-spread', 'blank', 'title-page', 'toc', 'index', 'illustration', 'digitizer-insert', 'colophon', 'errata', 'cover', 'map', 'plate']);
const eligible = (p) => p.page_number > 0 && (p.ocr?.data ?? '').length >= 200 && (p.translation?.data ?? '').trim().length >= 100 && !EXCLUDED_TYPES.has(p.page_type);

async function download(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2000) return null;
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const file = `images/${sha.slice(0, 16)}.jpg`;
    fs.writeFileSync(J(file), buf);
    return { file, sha256: sha };
  } catch { return null; }
}

if (cmd === 'draw') {
  if (fs.existsSync(J('packets'))) throw new Error(`${J('packets')} exists — refusing to draw over a run`);
  const nBooks = Number(opt('books', 60)), nWritten = Number(opt('written', 20));
  // A new seed each week by default (the ISO date), recorded; pass --seed to reproduce a run.
  const seed = Number(opt('seed', new Date().toISOString().slice(0, 10).replace(/-/g, '')));
  const rng = makeRng(seed);
  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  fs.mkdirSync(J('images'), { recursive: true });
  const proj = { page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.model': 1, 'translation.data': 1, 'translation.model': 1, 'translation.source': 1, photo: 1, cropped_photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, crop: 1 };
  const records = [];
  const makeRecord = async (bookId, p, stratum, all) => {
    const url = pageImageUrl(p);
    const img = url ? await download(url) : null;
    if (!img) return null;
    const b = await db.collection('books').findOne({ id: bookId }, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, language: 1, original_language: 1, published: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, page_progression: 1, visible: 1, 'catalog_metadata.collections': 1 } });
    return { slot: 0, stratum, book_id: bookId, book_url: `https://sourcelibrary.org/book/${bookId}`, tradition: null, book: b,
      structure: { ...structureCounts(all), pages_count_field: b.pages_count, pages_translated_field: b.pages_translated }, run: [p.page_number],
      pages: [{ page_number: p.page_number, page_id: String(p._id), image_url: url, image_file: img.file, image_sha256: img.sha256,
        crop: !p.split_from_spread && !p.cropped_photo && p.crop?.xStart !== undefined ? p.crop : undefined,
        ocr: p.ocr.data, ocr_engine: p.ocr?.source ?? null, ocr_model: p.ocr?.model ?? null,
        translation: p.translation.data, translation_model: p.translation?.model ?? null, translation_source: p.translation?.source ?? null }] };
  };
  // Stratum 1: random visible non-English books with translated pages, one eligible page each (uniform).
  const frame = (await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gte: 1 } }, { projection: { _id: 0, id: 1, language: 1 } }).toArray())
    .filter((b) => b.id && b.language && !ENGLISH.test(String(b.language).trim())).map((b) => b.id).sort();
  const reasons = {};
  for (const id of shuffle(frame)) {
    if (records.filter((r) => r.stratum === 'random').length >= nBooks) break;
    const all = await db.collection('pages').find({ book_id: id }, { projection: proj }).sort({ page_number: 1 }).toArray();
    const el = all.filter(eligible);
    if (!el.length) { reasons.no_eligible_page = (reasons.no_eligible_page || 0) + 1; continue; }
    const rec = await makeRecord(id, el[Math.floor(rng() * el.length)], 'random', all);
    if (!rec) { reasons.image_unavailable = (reasons.image_unavailable || 0) + 1; continue; }
    records.push(rec);
  }
  // Stratum 2: pages lane B wrote (sweep_log rows of cli-ocr.mjs apply with a #6420 reason), uniform over pages.
  const writtenRows = await db.collection('sweep_log').find({ sweep: 'cli-ocr', action: 'ocr-reread-through-cli', 'detail.reason': /#6420 lane B/ }, { projection: { book_id: 1, 'detail.page_id': 1 } }).toArray();
  const seen = new Set();
  for (const w of shuffle(writtenRows)) {
    if (records.filter((r) => r.stratum === 'lane-b-written').length >= nWritten) break;
    if (seen.has(w.detail.page_id)) continue; seen.add(w.detail.page_id);
    const p = await db.collection('pages').findOne({ id: w.detail.page_id }, { projection: proj });
    if (!p || !(p.ocr?.data ?? '').length) continue;
    if (!(p.translation?.data ?? '').trim()) p.translation = { ...(p.translation || {}), data: '(no English on this page yet: judge the transcription only; tr_score null)' };
    const all = await db.collection('pages').find({ book_id: w.book_id }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
    const rec = await makeRecord(w.book_id, p, 'lane-b-written', all);
    if (rec) records.push(rec);
  }
  await client.close();
  // One book, one page per packet: the Gemini path reads one page per call (#6338 amendment 2).
  // Redacted as the #6338 packets are (no engine, model or URL), and the stratum is hidden: a reader cannot tell a
  // page lane B wrote from a random one, or which family made the text.
  records.forEach((r, i) => write(J('packets', `p${String(i).padStart(3, '0')}.json`), [redactRecord({ ...r, slot: 1, stratum: 'audit' })]));
  write(J('draw.json'), { seed, drawn_at: new Date().toISOString(), frame_books: frame.length, rejected: reasons, lane_b_written_pages: writtenRows.length,
    pages: records.map((r, i) => ({ packet: `p${String(i).padStart(3, '0')}`, stratum: r.stratum, book_id: r.book_id, page_number: r.pages[0].page_number, language: r.book?.language, ocr_model: r.pages[0].ocr_model })) });
  console.log(`drew ${records.length} pages: ${records.filter((r) => r.stratum === 'random').length} random books (frame ${frame.length}), ${records.filter((r) => r.stratum === 'lane-b-written').length} lane-B-written (of ${writtenRows.length}); seed ${seed}`);
}

else if (cmd === 'score') {
  const draw = read(J('draw.json'));
  const packets = new Map(draw.pages.map((d) => [d.packet, read(J('packets', `${d.packet}.json`))]));
  const isSerious = (p) => !!p && ([...(p.ocr_errors || []), ...(p.tr_errors || []), ...(p.other || [])].some((e) => e.severity === 'serious') || p.right_page === 'no');
  const ocrSerious = (p) => !!p && ((p.ocr_errors || []).some((e) => e.severity === 'serious') || p.right_page === 'no');
  const byReader = {};
  for (const name of READERS) {
    const got = new Map();
    for (const [pk, recs] of packets) {
      let out = null;
      try { out = read(J('readers', name, 'reviews', `${pk}.json`)); } catch { /* missing */ }
      const v = validateOutput(out, recs);
      const p = v.pages.get(keyOf(recs[0].book_id, recs[0].pages[0].page_number));
      if (p) got.set(pk, p);
    }
    byReader[name] = got;
  }
  const strata = ['random', 'lane-b-written'];
  const rate = (name, stratum, pred) => {
    const pks = draw.pages.filter((d) => d.stratum === stratum && byReader[name].has(d.packet)).map((d) => d.packet);
    const k = pks.filter((pk) => pred(byReader[name].get(pk))).length;
    return { k, n: pks.length, rate: pks.length ? k / pks.length : null, ci: wilson(k, pks.length) };
  };
  const table = {};
  for (const s of strata) for (const name of READERS) table[`${s}/${name}`] = { any_serious: rate(name, s, isSerious), ocr_serious: rate(name, s, ocrSerious) };
  // Agreement on "this page has a serious error", pages both readers read: raw agreement and Cohen's kappa.
  const agreement = {};
  for (const s of [...strata, 'all']) {
    const both = draw.pages.filter((d) => (s === 'all' || d.stratum === s) && READERS.every((r) => byReader[r].has(d.packet)));
    const a = both.map((d) => isSerious(byReader.opus.get(d.packet))), b = both.map((d) => isSerious(byReader.gemini37.get(d.packet)));
    const n = both.length; if (!n) { agreement[s] = { n: 0 }; continue; }
    const po = a.filter((x, i) => x === b[i]).length / n;
    const pa = a.filter(Boolean).length / n, pb = b.filter(Boolean).length / n;
    const pe = pa * pb + (1 - pa) * (1 - pb);
    agreement[s] = { n, both_serious: a.filter((x, i) => x && b[i]).length, opus_only: a.filter((x, i) => x && !b[i]).length, gemini_only: a.filter((x, i) => !x && b[i]).length, raw: po, kappa: pe < 1 ? (po - pe) / (1 - pe) : null };
  }
  // Top findings: serious errors on pages BOTH readers flag first (convergent), then single-reader ones.
  const findings = [];
  for (const d of draw.pages) {
    const flags = READERS.filter((r) => isSerious(byReader[r].get(d.packet)));
    if (!flags.length) continue;
    const errs = flags.flatMap((r) => { const p = byReader[r].get(d.packet); return [...(p.ocr_errors || []), ...(p.tr_errors || []), ...(p.other || [])].filter((e) => e.severity === 'serious').map((e) => ({ reader: r, class: e.class, problem: e.problem || e.note, quote: e.ocr || e.english || e.source })); });
    if (flags.some((r) => byReader[r].get(d.packet)?.right_page === 'no')) errs.unshift({ reader: flags.join('+'), class: 'I1', problem: 'image is not the leaf the text is of' });
    findings.push({ ...d, readers: flags, convergent: flags.length === READERS.length, errors: errs.slice(0, 4) });
  }
  findings.sort((x, y) => Number(y.convergent) - Number(x.convergent));
  const report = { run: path.basename(R), seed: draw.seed, drawn_at: draw.drawn_at, scored_at: new Date().toISOString(), pages: draw.pages.length, read: Object.fromEntries(READERS.map((r) => [r, byReader[r].size])), table, agreement, findings };
  write(J('report.json'), report);
  const pct = (x) => (x == null ? '—' : `${(100 * x).toFixed(0)}%`);
  const cell = (x) => (x.n ? `${x.k}/${x.n} = ${pct(x.rate)} [${pct(x.ci[0])}, ${pct(x.ci[1])}]` : '—');
  const md = [
    `**Weekly convergent audit (#6420 lane D)** — run \`${report.run}\`, seed ${draw.seed}, drawn ${draw.drawn_at.slice(0, 10)}`,
    '',
    `${draw.pages.length} pages: one page per book from ${draw.pages.filter((d) => d.stratum === 'random').length} random visible non-English books (frame ${draw.frame_books}), plus ${draw.pages.filter((d) => d.stratum === 'lane-b-written').length} pages lane B wrote. Each read against its image by Opus (subscription, sealed) and Gemini 3.7 Flash (CLI), frozen #6338 brief (REVIEWER.md + CALIBRATION-ADDENDUM.md). Read: Opus ${report.read.opus}, Gemini ${report.read.gemini37}.`,
    '',
    '| stratum | reader | pages with a serious error (any lane) | serious OCR error or wrong leaf |',
    '|---|---|---|---|',
    ...strata.flatMap((s) => READERS.map((r) => `| ${s} | ${r} | ${cell(table[`${s}/${r}`].any_serious)} | ${cell(table[`${s}/${r}`].ocr_serious)} |`)),
    '',
    `Agreement on "serious error on this page" (pages both read): ${[...strata, 'all'].map((s) => agreement[s].n ? `${s} n=${agreement[s].n}, raw ${pct(agreement[s].raw)}, κ ${agreement[s].kappa == null ? '—' : agreement[s].kappa.toFixed(2)} (both ${agreement[s].both_serious}, Opus only ${agreement[s].opus_only}, Gemini only ${agreement[s].gemini_only})` : `${s} n=0`).join('; ')}.`,
    '',
    'Top findings (both readers first):',
    ...findings.slice(0, 10).map((f) => `- ${f.convergent ? '**both**' : f.readers.join('')} · ${f.stratum} · \`${f.book_id}\` p.${f.page_number} (${f.language ?? '?'}, OCR ${f.ocr_model ?? '?'}): ${f.errors.slice(0, 2).map((e) => `${e.class ?? '?'} ${String(e.problem ?? '').slice(0, 140)}`).join('; ')}`),
    '',
    'Rates are by page, Wilson 95% intervals; a model reader\'s finding is a finding, not a verdict (`.claude/docs/quality-statements.md`). Wrong-leaf or invented text found here is contained per `containment-on-finding.md` by the session that reads this.',
  ].join('\n');
  fs.writeFileSync(J('report.md'), md + '\n');
  console.log(md);
  if (flag('post')) {
    const r = spawnSync('gh', ['issue', 'comment', '6420', '--repo', 'Embassy-of-the-Free-Mind/sourcelibrary-v2', '--body-file', J('report.md')], { encoding: 'utf8' });
    console.log(r.status === 0 ? `posted: ${r.stdout.trim()}` : `post FAILED: ${r.stderr}`);
  }
}
else { console.error(`unknown command ${cmd}`); process.exit(2); }
