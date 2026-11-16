#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-translate.mjs apply (the lane's own writer: chatter guard, OCR-changed and English-changed
// refusals, the door, revision rows, sweep_log, book_events). It writes reads that its own `read` stage made; the #106
// reads were made by scripts/eval/ocr-doubt-image-8358/translate.mjs (the same prompt and call, plus an image arm) and
// judged first. This only turns the judged reads into the apply directory cli-translate.mjs expects (<page_id>.txt +
// .meta.json + the exact prompt sent), picking each page's best judged English, and afterwards records the judge's
// verdict on every page that was written (recordPageVerdicts, method image-translate-106). It writes no page itself.
/**
 *   node --env-file=… write-best.mjs build  --run=RUN --out=DIR        pick per page, write DIR/{<id>.txt,.meta.json,<id>.prompt.txt}, DIR/selection.json
 *   CLI_RUN_ID=image-translate-106-<ts> node --env-file=… scripts/batch/cli-translate.mjs apply --out=DIR --reason=… [--apply]
 *   node --env-file=… write-best.mjs record --run=RUN --out=DIR --run-id=… [--apply]   book_checks rows for the pages written
 *
 * The pick, per page (pre-registered in results/preregistration.md, step 9 of the #106 brief): a fresh read (T, T2 or I)
 * is written only if the judge accepted it and it beats the stored English: no stored English, stored not accepted, or
 * stored with more serious defects (misleads + wrong_text). Among fresh reads: accepted first, then fewest serious, fewest
 * wrong_text, highest fidelity; a tie goes T, T2, I. Planted-misread reads are never candidates. A page whose book is
 * held, or whose OCR or English changed since the draw, is left out (apply refuses those too).
 */
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, loadTranslationPrompts, contentHash, pageBreakVariant } from '../../lib/translate-core.mjs';
import { TRANSLATE_SUFFIX, CLI } from '../../lib/agy-cli.mjs';
import { TRANSLATION_SENTINEL_INSTRUCTION } from '../../lib/cli-chatter.mjs';
import { recordPageVerdicts } from '../../lib/book-checks.mjs';
import { ROUTES } from './judge.mjs';

const STAGE = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const RUN = path.resolve(arg('run') || '.'); const OUT = arg('out') && path.resolve(arg('out'));
if (!['build', 'record'].includes(STAGE) || !OUT) { console.error('usage: write-best.mjs build|record --run=RUN --out=DIR (see the header)'); process.exit(2); }
const JD = path.join(RUN, 'judge');
const key = JSON.parse(fs.readFileSync(path.join(JD, 'key.json'), 'utf8'));
const V = new Map();
for (const l of fs.readFileSync(path.join(JD, 'verdicts-opus.jsonl'), 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.verdict && !V.has(r.id)) V.set(r.id, r); }
const pages = JSON.parse(fs.readFileSync(path.join(RUN, 'pages.json'), 'utf8'));
const SER = new Set(['misleads', 'wrong_text']);
const ARM_OF = Object.fromEntries(Object.entries(ROUTES).map(([a, r]) => [r, a]));
const FRESH = ['T', 'T2', 'I'];
// The image arm's added sentence, cut from the runner that made the reads (importing it would run it).
const src = fs.readFileSync(new URL('../ocr-doubt-image-8358/translate.mjs', import.meta.url), 'utf8');
const IMAGE_SUFFIX = src.match(/export const IMAGE_SUFFIX = `([\s\S]*?)`;/)[1].replace('${TRANSLATION_SENTINEL_INSTRUCTION}', TRANSLATION_SENTINEL_INSTRUCTION).replace(/\\n/g, '\n');

const judged = (k) => { const r = V.get(k.judged_as); if (!r) return null; const v = r.verdict; const ds = v.defects || [];
  return { k, v, opened: r.opened === true, model: r.model, accept: v.accept === true, fidelity: Number(v.fidelity) || 0,
    serious: ds.filter((d) => SER.has(d.severity)).length, wrong_text: ds.filter((d) => d.severity === 'wrong_text').length }; };
const better = (a, b) => (a.accept !== b.accept ? a.accept : a.serious !== b.serious ? a.serious < b.serious : a.wrong_text !== b.wrong_text ? a.wrong_text < b.wrong_text : a.fidelity > b.fidelity);
const byPage = new Map();
for (const k of key.filter((x) => x.kind === 'item')) { const j = judged(k); if (j) (byPage.get(k.page_id) ?? byPage.set(k.page_id, {}).get(k.page_id))[ARM_OF[k.route]] = j; }

const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');

if (STAGE === 'build') {
  fs.mkdirSync(OUT, { recursive: true });
  const prompts = await loadTranslationPrompts(db);
  const bookIds = [...new Set(Object.values(pages).map((p) => p.book_id))];
  const books = new Map((await db.collection('books').find({ id: { $in: bookIds } }).toArray()).map((b) => [b.id, b]));
  const live = new Map((await db.collection('pages').find({ id: { $in: Object.keys(pages) } }, { projection: { id: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray()).map((p) => [p.id, p]));
  const version = spawnSync(CLI, ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'unknown';
  const sel = []; const tally = {};
  const note = (page_id, lang, decision, extra = {}) => { sel.push({ page_id, lang, decision, ...extra }); tally[decision] = (tally[decision] ?? 0) + 1; };
  for (const [pid, arms] of byPage) {
    const p = pages[pid]; const lang = (arms.T ?? arms.I ?? arms.S)?.k.cell;
    const S = arms.S && (p.stored_english || '').trim() ? arms.S : null;
    const fresh = FRESH.map((a) => arms[a] && { arm: a, ...arms[a] }).filter((x) => x && x.accept);
    if (FRESH.some((a) => !arms[a])) { note(pid, lang, 'not all arms judged'); continue; }
    if (!fresh.length) { note(pid, lang, 'no fresh read accepted'); continue; }
    const best = fresh.reduce((a, b) => (better(b, a) ? b : a));
    const beats = !S || !S.accept || best.serious < S.serious;
    const summary = Object.fromEntries(['S', ...FRESH].filter((a) => arms[a]).map((a) => [a, { accept: arms[a].accept, serious: arms[a].serious, wrong_text: arms[a].wrong_text, fidelity: arms[a].fidelity }]));
    if (!beats) { note(pid, lang, 'stored kept', { best: best.arm, arms: summary }); continue; }
    const pg = live.get(pid); const book = books.get(p.book_id);
    if (book?.pipeline_auto?.hold) { note(pid, lang, 'book held', { best: best.arm }); continue; }
    if (contentHash(pg?.ocr?.data || '') !== contentHash(p.stored_ocr)) { note(pid, lang, 'OCR changed since the draw', { best: best.arm }); continue; }
    if (contentHash(pg?.translation?.data || '') !== contentHash(p.stored_english || '')) { note(pid, lang, 'English changed since the draw', { best: best.arm }); continue; }
    const o = JSON.parse(fs.readFileSync(path.join(RUN, `out-${best.arm}`, `${pid}.json`), 'utf8'));
    const built = buildTranslationPrompt({ prompts, book, ocrText: o.ocr_text, previousTranslation: p.prev_english, prevOcrText: p.prev_ocr || undefined, nextOcrText: p.next_ocr || undefined, pageBreak: PAGE_BREAK_SCOPED });
    const sent = built.prompt + (best.arm === 'I' ? IMAGE_SUFFIX : TRANSLATE_SUFFIX);
    if (built.promptRef.content_hash !== o.prompt_ref.content_hash || sent.length !== o.prompt_chars) { note(pid, lang, 'prompt cannot be rebuilt as sent', { best: best.arm, chars: [sent.length, o.prompt_chars] }); continue; }
    if (o.cls || o.problem || !(o.english || '').trim()) { note(pid, lang, 'read has a problem', { best: best.arm }); continue; }
    const mtime = fs.statSync(path.join(RUN, `out-${best.arm}`, `${pid}.json`)).mtime;
    fs.writeFileSync(path.join(OUT, `${pid}.txt`), o.english);
    fs.writeFileSync(path.join(OUT, `${pid}.prompt.txt`), sent);
    const variant = best.arm === 'I' ? 'sentinels-6523+page-image-106' : 'sentinels-6523';
    fs.writeFileSync(path.join(OUT, `${pid}.meta.json`), JSON.stringify({
      page_id: pid, book_id: p.book_id, page_number: p.page_number, cli: CLI, cli_version: version, model: o.model,
      started_at: new Date(mtime - 1000 * (o.secs || 0)).toISOString(), finished_at: mtime.toISOString(), exit: 0, error_class: null, attempts: o.calls, chars: o.english.length,
      prompt_variant: variant, wrapper: null, tool_calls: o.tool_calls, ocr_hash: contentHash(p.stored_ocr), ocr_updated_at: null,
      translation_hash_at_read: contentHash(p.stored_english || ''), prompt_ref: o.prompt_ref, is_english_book: built.isEnglish,
      prompt_sent_chars: sent.length, prompt_sent_hash: contentHash(sent), prompt_sent_file: `${pid}.prompt.txt`,
      context: { previous_translation: !!p.prev_english, previous_from: p.prev_english ? 'stored' : null, prev_ocr: !!p.prev_ocr, next_ocr: !!p.next_ocr, page_break: pageBreakVariant(PAGE_BREAK_SCOPED), page_image: best.arm === 'I', judged_best_of: 'image-translate-106 (#106)', arm: best.arm },
      read_site: 'scripts/eval/ocr-doubt-image-8358/translate.mjs', call_id: `image-translate-106/out-${best.arm}/${pid}`,
    }, null, 1));
    note(pid, lang, 'write', { best: best.arm, arms: summary, judged_as: best.k.judged_as });
  }
  fs.writeFileSync(path.join(OUT, 'selection.json'), JSON.stringify({ tally, pages: sel }, null, 1));
  const w = sel.filter((s) => s.decision === 'write');
  console.log(JSON.stringify(tally), 'write by arm', JSON.stringify(w.reduce((a, s) => ((a[s.best] = (a[s.best] ?? 0) + 1), a), {})), 'by lang', JSON.stringify(w.reduce((a, s) => ((a[s.lang] = (a[s.lang] ?? 0) + 1), a), {})));
}

if (STAGE === 'record') {
  const runId = arg('run-id'); if (!runId) { console.error('--run-id= (the CLI_RUN_ID the apply used)'); process.exit(2); }
  const sel = JSON.parse(fs.readFileSync(path.join(OUT, 'selection.json'), 'utf8')).pages.filter((s) => s.decision === 'write');
  // Written = the page's English now carries this run's id (the door may have repaired a tag, so not byte-equal);
  // the apply's refusals (door, chatter) leave a page out. `judged` keeps the read as the judge saw it.
  const live = new Map((await db.collection('pages').find({ id: { $in: sel.map((s) => s.page_id) } }, { projection: { id: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.engine.run.job_id': 1 } }).toArray()).map((p) => [p.id, p]));
  const verdicts = [];
  for (const s of sel) {
    const pg = live.get(s.page_id); const text = fs.readFileSync(path.join(OUT, `${s.page_id}.txt`), 'utf8');
    if (!pg || pg.translation?.engine?.run?.job_id !== runId) continue;
    const j = V.get(s.judged_as).verdict; const ds = j.defects || [];
    const serious = ds.filter((d) => SER.has(d.severity));
    const outcome = !j.accept || serious.length ? 'serious' : ds.length ? 'minor' : 'clean';
    verdicts.push({ page_id: s.page_id, outcome, page_verdict: outcome === 'serious' ? 'fix' : outcome === 'minor' ? 'caveat' : 'show',
      verdict: `accept ${j.accept}; fidelity ${j.fidelity}; arm ${s.best}`, note: String(j.reader_note || '').slice(0, 1500),
      errors: outcome === 'serious' ? (serious.length ? serious : [{ what: 'not accepted' }]).map((d) => ({ stage: 'translation', ...(d.class ? { class: d.class } : {}), problem: String(d.what ?? d.quote ?? 'not accepted').slice(0, 300) })) : [],
      defects: ds.map((d) => Object.fromEntries(Object.entries(d).filter(([k, x]) => !(['class', 'quote'].includes(k) && (typeof x !== 'string' || !x.trim()))))),
      judged: { ocr: pg.ocr?.data ?? '', translation: text } });
  }
  const res = await recordPageVerdicts(db, { method_id: 'image-translate-106', method_version: '1', run_id: runId, checked_at: new Date(), selection: 'random', stages: ['translation'],
    reader: { kind: 'model', model: 'claude-opus-5-5', image_opened: true }, evidence_path: 'scripts/eval/route-judge-6740/results/image-translate-106/', reader_warning: false,
    frame: { issue: 106, draw: 'scripts/eval/image-translate-106/results/draw.json' }, note: 'Best judged English of three fresh agy reads (text, text again, text + page image), written by cli-translate.mjs apply.', verdicts },
  { apply: process.argv.includes('--apply') });
  console.log(`pages written ${verdicts.length} of ${sel.length} picked; rows ${res.rows.length} inserted ${res.inserted} already ${res.already} failed ${JSON.stringify(res.failed)}`);
}
await c.close();
