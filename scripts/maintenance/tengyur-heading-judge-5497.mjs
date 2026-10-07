#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/tengyur-invented-headings-5497.mjs (#6126) — the $0 deterministic
// pass over the same headings; it deleted/demoted the safe shapes and LEFT the short labels, because
// telling an invented label from a translated one needs the Tibetan read line by line. Its classifier
// (classifyHeading/sourceMarkers/headingText) is imported here unchanged, so this script judges exactly
// the lines that one left. scripts/eval/tibetan-mt-ab/batch-arms.mjs — the Batch submit / register in
// batch_jobs / meter-at-submit-and-complete pattern, copied (it writes eval files, not pages).
// scripts/lib/gemini-script-client.mjs is realtime-only (one generateContent per call); the Batch lane
// here sets the same defaults by hand (thinkingBudget 0, logUsage at submit, completeBatchUsage after).
// scripts/maintenance/note-claims-verify.mjs — a grounded fact-check judge; different question.
// scripts/lib/translation-text-repair.mjs — the write door (revision row first, human-edit skip), used as-is.
/**
 * Model judge for the heading labels left on the Derge Tengyur English (#5497).
 *
 * The leftover lines are `label_no_marker` / `label_on_marked_page` in the #6126 script: short heading
 * lines that are either the translation of a real Tibetan unit (a title, a fascicle or chapter marker,
 * a colophon, a root-text lemma, a verse line, a grammar rule) or a label the model wrote itself.
 * gemini-3-flash-preview reads each page's Tibetan (ocr.data, the Esukhia e-text) and English with the
 * headings numbered, and answers per heading TRANSLATED + the Tibetan span, or ADDED. A line is deleted
 * only when the verdict is ADDED and no span is given, and it is not a chapter/fascicle/numbered
 * heading (STRUCTURAL below); every other line stays.
 *
 * Modes (run in this order; each is resumable from --dir):
 *   --control   the gated control: scripts/maintenance/tengyur-heading-judge-5497.control.json, 31
 *               lines labelled by eye + 10 planted invented headings (planted in the request only).
 *               Prints precision on ADDED; --judge refuses to run until it is >= 0.95.
 *   --judge     one Batch job over every leftover label line, grouped one request per page.
 *               Estimates first and refuses above --cap-usd (default 5).
 *   --apply     deletes the ADDED-without-span lines (plus one blank line) through
 *               repairTranslationText: one page_revisions row per page, source
 *               'tengyur-heading-judge-5497', issue 5497; skips pages whose text changed since the
 *               judge read it, human-edited pages, and books with an open translate run. Then
 *               resyncMirrors() (Supabase `pages` + `page_translations`), as #6126 did.
 *               Without --write it is a dry run.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/tengyur-heading-judge-5497.mjs \
 *     --control|--judge|--apply [--write] [--dir=/root/claude-jobs/thj-5497] [--cap-usd=5] [--poll-minutes=180]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { costOf, BATCH_MULTIPLIER } from '../lib/model-pricing.mjs';
import { logUsage, completeBatchUsage, sumBatchResponseUsage } from '../workers/lib/supabase-usage-logger.mjs';
import { repairTranslationText, resyncMirrors } from '../lib/translation-text-repair.mjs';
import { classifyHeading, sourceMarkers, headingText } from './tengyur-invented-headings-5497.mjs';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const has = (k) => process.argv.includes(`--${k}`);
const DIR = arg('dir', '/tmp/tengyur-heading-judge-5497');
const CAP_USD = Number(arg('cap-usd', 5));
const POLL_MIN = Number(arg('poll-minutes', 180));
const MODEL = 'gemini-3-flash-preview';
const SOURCE = 'tengyur-heading-judge-5497';
const ENDPOINT = 'scripts/maintenance/tengyur-heading-judge-5497.mjs';
const ISSUE = 5497;
const HOLD = 'tengyur-import-5497';
const PROMPT_VERSION = 'v1';
const LABELS = new Set(['label_no_marker', 'label_on_marked_page']);
const CONTROL_FILE = new URL('./tengyur-heading-judge-5497.control.json', import.meta.url);
const HEAD = /^(->\s*)?#{1,6} +/;
const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_CIVIC_INTEGRITY']
  .map((category) => ({ category, threshold: 'BLOCK_NONE' }));
const KEYS = [...new Set([process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3].filter(Boolean))];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
fs.mkdirSync(DIR, { recursive: true });

const INSTRUCTIONS = `You are checking a machine English translation of one page of the Derge Tengyur. The source is a typed e-text of a Tibetan woodblock print: running prose and verse with NO headings. A "#" inside the Tibetan is an editorial note point, never a heading.

The translator sometimes wrote heading lines. In the English below each heading line to judge is prefixed with a tag like [[H1]]. For each tagged heading decide:

TRANSLATED - the heading renders specific Tibetan words on this page that stand as a unit at that point, and that the English next to it does not render again. Typical cases: a work title (after རྒྱ་གར་སྐད་དུ / བོད་སྐད་དུ or a catalogue number); a chapter, fascicle or section marker or a colophon (ལེའུ, བམ་པོ, རབ་ཏུ་བྱེད་པ, ...རྫོགས་སོ, ...པའོ); a root-text lemma quoted before its commentary; a verse line; a grammatical rule (sūtra); a list label written in the Tibetan (e.g. ...གྱི་མིང་ལ, ...ཡིག་མཐའ་ཅན); a sentence. A chapter, fascicle, title or colophon heading is TRANSLATED whenever the Tibetan on this page carries those words, even if the English also renders them.
ADDED - the heading is the translator's own label: a topic summary or a section title with no Tibetan words at that point that it renders as a unit, or a restatement of a phrase or verse line that the adjacent English already translates in full. Sharing a keyword with the Tibetan is not enough for TRANSLATED.

For TRANSLATED copy the Tibetan span exactly as it appears in the Tibetan (ignore "#"). For ADDED give an empty span.

Answer with JSON only: an array with one object per tagged heading, in order:
[{"n": 1, "verdict": "TRANSLATED" | "ADDED", "tibetan_span": "...", "why": "at most 15 words"}]`;

function flatTibetan(tib) { return String(tib || '').replace(/\\?#/g, '').replace(/\s+/g, ''); }

/** Tag the target heading lines in the English. `targets` are exact lines; each claims its first unclaimed occurrence. */
function tagEnglish(en, targets) {
  const lines = String(en).split('\n');
  const used = new Set();
  const placed = [];
  targets.forEach((t, i) => {
    const at = lines.findIndex((l, j) => !used.has(j) && l === t);
    if (at < 0) return;
    used.add(at);
    lines[at] = `[[H${i + 1}]] ${lines[at]}`;
    placed.push({ n: i + 1, line: t });
  });
  return { text: lines.join('\n'), placed };
}

function requestFor(tib, taggedEn) {
  const prompt = `${INSTRUCTIONS}\n\n=== TIBETAN ===\n${tib}\n\n=== ENGLISH ===\n${taggedEn}`;
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
    safetySettings: SAFETY,
  };
}

/** Parse one response into per-heading verdicts; a span that is not in the Tibetan is flagged. */
function parseVerdicts(resp, unit, tib) {
  const text = resp?.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text || '').join('') || '';
  let arr;
  try { arr = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { arr = null; }
  const flat = flatTibetan(tib);
  return unit.headings.map((h) => {
    const v = Array.isArray(arr) ? arr.find((x) => Number(x?.n) === h.n) : null;
    if (!v || !/^(TRANSLATED|ADDED)$/.test(v.verdict)) return { ...h, verdict: 'NO_ANSWER' };
    const span = String(v.tibetan_span || '').trim();
    const spanFlat = flatTibetan(span);
    return { ...h, verdict: v.verdict, tibetan_span: span, span_found: spanFlat ? flat.includes(spanFlat) || flat.replace(/།/g, '').includes(spanFlat.replace(/།/g, '')) : null, why: String(v.why || '').slice(0, 200) };
  });
}

const deletable = (v) => v.verdict === 'ADDED' && !v.tibetan_span;
// Kept even when judged ADDED: chapter / fascicle / canto / numbered-story headings. On the full run 51 of
// the 775 ADDED lines were these, mostly a correct "Chapter 24: Examination of the Holy Truths" placed
// where the chapter starts while the Tibetan names it only in the closing colophon. Invented as wording,
// but they are the reader's only navigation and chapter extraction will read them; not deleted here.
const STRUCTURAL = /^\d+[.:]\s|\b(?:chapter|fascicle|canto|sprout|volume|bam ?po)\b/i;
const toDelete = (v) => deletable(v) && !STRUCTURAL.test(headingText(v.line));

// ── Batch lane ──────────────────────────────────────────────────────────────────────────────────
function loadJobs() { const f = path.join(DIR, 'jobs.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; }
function saveJobs(j) { fs.writeFileSync(path.join(DIR, 'jobs.json'), JSON.stringify(j, null, 1)); }

function estimateUsd(units) {
  // Measured on 2026-10-07 with countTokens: Tibetan ~0.67 tokens/char, English ~0.21; ~80 output tokens per heading.
  let inTok = 0, outTok = 0;
  for (const u of units) { inTok += u.tib.length * 0.67 + u.en.length * 0.21 + INSTRUCTIONS.length * 0.3; outTok += 30 + 80 * u.headings.length; }
  return { inTok: Math.round(inTok), outTok: Math.round(outTok), usd: costOf(MODEL, inTok, outTok) * BATCH_MULTIPLIER };
}

/** Submit (or resume) one Batch job over `units`, wait for it, meter it, and return responses keyed by unit key. */
async function runBatch(db, label, units) {
  const outFile = path.join(DIR, `${label}.responses.jsonl`);
  if (fs.existsSync(outFile)) {
    const m = new Map();
    for (const l of fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); m.set(r.key, r.response); }
    console.log(`${label}: ${m.size} responses already collected`);
    return m;
  }
  const jobs = loadJobs();
  let job = jobs[label];
  let ai;
  if (!job) {
    const tmp = path.join(os.tmpdir(), `thj5497-${label}-${Date.now().toString(36)}.jsonl`);
    fs.writeFileSync(tmp, units.map((u) => JSON.stringify({ key: u.key, request: requestFor(u.tib, u.taggedEn) })).join('\n') + '\n');
    for (let k = 0; k < KEYS.length && !job; k++) {
      ai = new GoogleGenAI({ apiKey: KEYS[k] });
      try {
        const file = await ai.files.upload({ file: tmp, config: { mimeType: 'text/plain', displayName: `thj5497-${label}` } });
        for (let i = 0; i < 30; i++) { const st = (await ai.files.get({ name: file.name }))?.state; if (st === 'ACTIVE') break; if (st === 'FAILED') throw new Error('file FAILED'); await sleep(2000); }
        // usage-ok: hand-run Batch judge — metered with a gemini_usage placeholder at submit and completeBatchUsage from the responses; thinkingBudget 0 is set in requestFor()
        const created = await ai.batches.create({ model: MODEL, src: { fileName: file.name }, config: { displayName: `${SOURCE} ${label}` } });
        try { await ai.files.delete({ name: file.name }); } catch { /* batch-collector's sweeper reaps it */ }
        job = { name: created.name, keyIndex: k, submitted_at: new Date().toISOString(), requests: units.length };
        jobs[label] = job; saveJobs(jobs);
        await logUsage({ type: 'heading_judge', mode: 'batch', model: MODEL, page_count: units.length, input_tokens: 0, output_tokens: 0, status: 'submitted', batch_job_id: created.name, endpoint: ENDPOINT, prompt_version: `${SOURCE}-${PROMPT_VERSION}`, triggered_by: 'manual' });
        // Registered so batch-collector's orphan sweep (batch-reconcile.mjs rule 3) knows the job and spares it (#5845).
        await db.collection('batch_jobs').updateOne({ gemini_job_name: created.name }, { $setOnInsert: {
          id: `${SOURCE}-${label}`, job_name: created.name, gemini_job_name: created.name, status: 'external_eval', type: 'heading_judge', model: MODEL,
          page_count: units.length, created_at: new Date(job.submitted_at), updated_at: new Date(), issue: ISSUE,
          note: `hand-submitted Batch (${ENDPOINT}); verdicts go to files, the script applies deletions itself` } }, { upsert: true });
        console.log(`${label}: submitted ${created.name} (${units.length} requests) with key ${k}; registered in batch_jobs`);
      } catch (err) {
        console.log(`${label}: key ${k} refused (${String(err.message).slice(0, 160)})`);
        if (k === KEYS.length - 1) throw err;
      }
    }
    fs.unlinkSync(tmp);
  } else { ai = new GoogleGenAI({ apiKey: KEYS[job.keyIndex] }); console.log(`${label}: resuming ${job.name}`); }

  const t0 = Date.now();
  let got;
  for (;;) {
    got = await ai.batches.get({ name: job.name });
    if (/SUCCEEDED|FAILED|CANCELLED|EXPIRED/.test(got.state)) break;
    if (Date.now() - t0 > POLL_MIN * 60000) { console.log(`${label}: still ${got.state} after ${POLL_MIN} min; re-run to resume`); process.exit(3); }
    await sleep(30000);
  }
  console.log(`${label}: ${got.state}`, got.batchStats ? JSON.stringify(got.batchStats) : '');
  if (got.state !== 'JOB_STATE_SUCCEEDED') throw new Error(`${label}: batch ended ${got.state}`);
  let responses = got.dest?.inlinedResponses || [];
  if (got.dest?.fileName) {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/${got.dest.fileName}:download?alt=media&key=${KEYS[job.keyIndex]}`);
    if (!resp.ok) throw new Error(`result download failed (${resp.status})`);
    responses = (await resp.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }
  const { inputTokens, outputTokens } = sumBatchResponseUsage(responses);
  const usd = costOf(MODEL, inputTokens, outputTokens) * BATCH_MULTIPLIER;
  if (!job.metered) {
    job.metered = await completeBatchUsage({ type: 'heading_judge', mode: 'batch', model: MODEL, page_count: units.length, input_tokens: inputTokens, output_tokens: outputTokens, status: 'success', batch_job_id: job.name, endpoint: ENDPOINT, triggered_by: 'manual' });
    job.usage = { inputTokens, outputTokens, usd: Number(usd.toFixed(4)) };
    jobs[label] = job; saveJobs(jobs);
    await db.collection('batch_jobs').updateOne({ gemini_job_name: job.name }, { $set: { updated_at: new Date(), completed_at: new Date(), cost_usd: Number(usd.toFixed(4)), input_tokens: inputTokens, output_tokens: outputTokens } });
  }
  console.log(`${label}: ${responses.length} responses, ${inputTokens} in / ${outputTokens} out = $${usd.toFixed(4)} at the Batch rate`);
  const m = new Map();
  fs.writeFileSync(outFile, responses.map((r) => { const key = r.key || r.metadata?.key; m.set(key, r.response); return JSON.stringify({ key, response: r.response, error: r.error }); }).join('\n') + '\n');
  return m;
}

// ── Units ───────────────────────────────────────────────────────────────────────────────────────
async function controlUnits(db) {
  const ctl = JSON.parse(fs.readFileSync(CONTROL_FILE, 'utf8'));
  const byPage = new Map();
  for (const x of ctl.by_eye) { const k = `${x.book_id}:${x.page}`; if (!byPage.has(k)) byPage.set(k, []); byPage.get(k).push(x); }
  const units = [];
  for (const [k, items] of byPage) {
    const [book_id, page] = k.split(':');
    const p = await db.collection('pages').findOne({ book_id, page_number: Number(page) }, { projection: { 'ocr.data': 1, 'translation.data': 1 } });
    const { text, placed } = tagEnglish(p.translation.data, items.map((x) => x.line));
    units.push({ key: `ctl:${k}`, tib: p.ocr.data, en: p.translation.data, taggedEn: text, headings: placed.map((h) => ({ ...h, truth: items.find((x) => x.line === h.line).truth })) });
  }
  for (const x of ctl.planted) {
    const p = await db.collection('pages').findOne({ book_id: x.book_id, page_number: x.page }, { projection: { 'ocr.data': 1, 'translation.data': 1 } });
    const en = p.translation.data;
    const paras = en.split(/\n\s*\n/).filter((b) => b.trim() && !/^</.test(b.trim()));
    const at = en.indexOf(paras[x.insert_before_paragraph - 1]);
    const planted = `${en.slice(0, at)}${x.line}\n\n${en.slice(at)}`;
    const { text, placed } = tagEnglish(planted, [x.line]);
    units.push({ key: `plant:${x.book_id}:${x.page}`, tib: p.ocr.data, en: planted, taggedEn: text, headings: placed.map((h) => ({ ...h, truth: 'invented', planted: true })) });
  }
  return units;
}

async function judgeUnits(db) {
  const books = await db.collection('books').find({ 'pipeline_auto.hold.reason': HOLD }, { projection: { id: 1 } }).sort({ id: 1 }).toArray();
  const units = [];
  for (const b of books) {
    const pages = await db.collection('pages').find({ book_id: b.id, 'translation.data': { $regex: '^(->\\s*)?#{1,6} ', $options: 'm' } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
    for (const p of pages) {
      const markers = sourceMarkers(p.ocr?.data);
      const targets = [];
      const classes = [];
      for (const line of p.translation.data.split('\n')) {
        if (!HEAD.test(line)) continue;
        const d = classifyHeading(line, markers);
        if (d.action === 'leave' && LABELS.has(d.why)) { targets.push(line); classes.push(d.why); }
      }
      if (!targets.length) continue;
      const { text, placed } = tagEnglish(p.translation.data, targets);
      units.push({ key: p.id, book_id: b.id, page: p.page_number, page_id: p.id, en_hash: sha(p.translation.data), tib: p.ocr.data, en: p.translation.data, taggedEn: text, headings: placed.map((h) => ({ ...h, class: classes[h.n - 1] })) });
    }
  }
  return units;
}

// ── Modes ───────────────────────────────────────────────────────────────────────────────────────
async function control(db) {
  const units = await controlUnits(db);
  const est = estimateUsd(units);
  console.log(`control: ${units.length} requests, ${units.reduce((n, u) => n + u.headings.length, 0)} headings, estimate $${est.usd.toFixed(4)}`);
  const resp = await runBatch(db, 'control', units);
  const rows = units.flatMap((u) => parseVerdicts(resp.get(u.key), u, u.tib).map((v) => ({ key: u.key, ...v })));
  const added = rows.filter(toDelete);
  const strictTP = added.filter((r) => r.truth === 'invented').length;
  const safeTP = added.filter((r) => r.truth !== 'translated').length;
  const inv = rows.filter((r) => r.truth === 'invented');
  const result = {
    headings: rows.length, no_answer: rows.filter((r) => r.verdict === 'NO_ANSWER').length,
    predicted_delete: added.length,
    precision_safe: added.length ? safeTP / added.length : null, // deleting loses no translation (truth invented or duplicate)
    precision_strict: added.length ? strictTP / added.length : null, // truth invented only
    recall_invented: inv.length ? inv.filter(toDelete).length / inv.length : null,
    planted_caught: rows.filter((r) => r.planted && toDelete(r)).length,
    false_deletes: added.filter((r) => r.truth === 'translated').map((r) => `${r.key} ${r.line} — ${r.why}`),
    by_truth: Object.fromEntries(['invented', 'duplicate', 'translated'].map((t) => [t, Object.fromEntries(['TRANSLATED', 'ADDED', 'NO_ANSWER'].map((v) => [v, rows.filter((r) => r.truth === t && r.verdict === v).length]))])),
  };
  result.gate = result.precision_safe != null && result.precision_safe >= 0.95 && added.length >= 10 ? 'PASS' : 'FAIL';
  fs.writeFileSync(path.join(DIR, 'control-result.json'), JSON.stringify({ result, rows }, null, 1));
  console.log(JSON.stringify(result, null, 1));
  for (const r of rows) console.log(`${r.truth.padEnd(10)} ${r.verdict.padEnd(10)} ${r.tibetan_span ? 'span' : '    '} ${headingText(r.line).slice(0, 70)} — ${r.why || ''}`);
}

async function judge(db) {
  const ctl = path.join(DIR, 'control-result.json');
  if (!fs.existsSync(ctl) || JSON.parse(fs.readFileSync(ctl, 'utf8')).result.gate !== 'PASS') { console.error('REFUSED: run --control first; the gate must PASS'); process.exit(2); }
  const units = await judgeUnits(db);
  const est = estimateUsd(units);
  const lines = units.reduce((n, u) => n + u.headings.length, 0);
  console.log(`judge: ${units.length} pages, ${lines} heading lines; estimate ${est.inTok} in + ${est.outTok} out tokens on ${MODEL} at the Batch rate = $${est.usd.toFixed(2)} (cap $${CAP_USD})`);
  if (est.usd > CAP_USD) { console.error(`REFUSED: estimate exceeds --cap-usd ${CAP_USD}`); process.exit(2); }
  fs.writeFileSync(path.join(DIR, 'judge-index.json'), JSON.stringify(units.map(({ tib, en, taggedEn, ...u }) => u)));
  const resp = await runBatch(db, 'judge', units);
  const out = units.map((u) => ({ key: u.key, book_id: u.book_id, page: u.page, page_id: u.page_id, en_hash: u.en_hash, verdicts: parseVerdicts(resp.get(u.key), u, u.tib) }));
  fs.writeFileSync(path.join(DIR, 'verdicts.json'), JSON.stringify(out, null, 1));
  const all = out.flatMap((u) => u.verdicts);
  const count = (f) => all.filter(f).length;
  console.log(JSON.stringify({ pages: out.length, lines: all.length, added_no_span: count(deletable), delete: count(toDelete), kept_structural: count((v) => deletable(v) && !toDelete(v)), translated: count((v) => v.verdict === 'TRANSLATED'), translated_span_not_found: count((v) => v.verdict === 'TRANSLATED' && v.span_found === false), added_with_span: count((v) => v.verdict === 'ADDED' && v.tibetan_span), no_answer: count((v) => v.verdict === 'NO_ANSWER'),
    delete_by_class: Object.fromEntries([...LABELS].map((c) => [c, `${count((v) => v.class === c && toDelete(v))}/${count((v) => v.class === c)}`])) }, null, 1));
}

/** Remove the given heading lines (exact text, one occurrence each) plus one adjacent blank line. */
export function deleteLines(text, drop) {
  const want = [...drop];
  const lines = String(text).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const k = want.indexOf(lines[i]);
    if (k < 0) { out.push(lines[i]); continue; }
    want.splice(k, 1);
    const prevBlank = out.length === 0 || out[out.length - 1].trim() === '';
    if (prevBlank && i + 1 < lines.length && lines[i + 1].trim() === '') i++;
  }
  return { text: out.join('\n'), missing: want };
}

async function apply(db) {
  const WRITE = has('write');
  const verdicts = JSON.parse(fs.readFileSync(path.join(DIR, 'verdicts.json'), 'utf8'));
  const cpFile = path.join(DIR, 'apply-checkpoint.json');
  const cp = WRITE && fs.existsSync(cpFile) ? JSON.parse(fs.readFileSync(cpFile, 'utf8')) : { done: [], touched: [] };
  const done = new Set(cp.done);
  const report = { write: WRITE, pages: 0, lines_deleted: 0, written: 0, skipped: {}, changes: [] };
  const TERMINAL = ['complete', 'parked', 'failed'];
  for (const u of verdicts) {
    const drop = u.verdicts.filter(toDelete).map((v) => v.line);
    if (!drop.length || done.has(u.key)) continue;
    const skip = (why) => { report.skipped[why] = (report.skipped[why] || 0) + 1; };
    if (await db.collection('translate_batch_runs').countDocuments({ book_id: u.book_id, phase: { $nin: TERMINAL } })) { skip('open_translate_run'); continue; }
    const p = await db.collection('pages').findOne({ id: u.page_id }, { projection: { id: 1, book_id: 1, page_number: 1, translation: 1 } });
    if (!p || sha(p.translation?.data) !== u.en_hash) { skip('text_changed_since_judge'); continue; }
    const { text, missing } = deleteLines(p.translation.data, drop);
    if (missing.length) { skip('line_not_found'); continue; }
    report.pages++;
    report.lines_deleted += drop.length;
    const r = await repairTranslationText(db, p, text, {
      expectBefore: p.translation.data, source: SOURCE, issue: ISSUE, jobId: SOURCE, apply: WRITE,
      reason: `heading invented by the translation, judged ADDED with no Tibetan span by ${MODEL} (#5497, ${SOURCE} ${PROMPT_VERSION}): ${drop.map((l) => `"${headingText(l).slice(0, 60)}"`).join('; ')}`,
    });
    report.changes.push({ book_id: u.book_id, page: u.page, id: u.page_id, status: r.status, deleted: drop, why: u.verdicts.filter(toDelete).map((v) => v.why) });
    if (r.status === 'written') { report.written++; cp.touched.push(p.id); } else if (r.status !== 'dry_run') skip(r.why);
    if (WRITE) { done.add(u.key); cp.done = [...done]; fs.writeFileSync(cpFile, JSON.stringify(cp)); }
  }
  if (WRITE && cp.touched.length) report.resync = await resyncMirrors(db, cp.touched);
  fs.writeFileSync(path.join(DIR, `apply-${WRITE ? 'write' : 'dry'}.json`), JSON.stringify(report, null, 1));
  const { changes, ...summary } = report;
  console.log(JSON.stringify(summary, null, 1));
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  try {
    if (has('control')) await control(db);
    else if (has('judge')) await judge(db);
    else if (has('apply')) await apply(db);
    else console.error('pass --control, --judge or --apply');
  } finally { await client.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
