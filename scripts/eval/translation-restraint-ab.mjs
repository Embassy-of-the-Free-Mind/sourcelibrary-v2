#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-prompt-ab.mjs — the v13-vs-v15 harness (#3825). Same house design
// (paired arms, one page per book, pre-registered rule), but its estimand is the verified-note rate, which a
// string search decides; invention needs a JUDGE, and it draws fresh pages where this re-uses the #5274
// audit's labelled pages. Its realtime --run is replaced by the Batch API (feedback: batch by default) using
// the submit/collect shape of scripts/eval/image-extraction-lite-eval.mjs. The judge rubric and packet
// format are the audit's own (scripts/eval/translation-corpus-audit/JUDGE-PROMPT.md, build-packets.mjs),
// so arm verdicts are on the audit's scale. The mechanical secondary is scripts/audit/translation-bridging.mjs.
// scripts/eval/translation-page-break-fix-ab.mjs has the same three-arm shape (B, B2 noise floor, F) but its
// unit is a two-page SEAM judged pairwise on 63 de/la seams, realtime; here the unit is one page of the audit's
// multilingual draw, judged on its own, via Batch. Its page-break option is ON in every arm here (production).
/**
 * translation-restraint-ab — does one restraint instruction stop the translator bridging gaps? (#5305)
 *
 * The #5274 audit found invention on 11.2% of served pages, most major cases one shape: the source
 * stops mid-sentence and the translation finishes the thought. The candidate instruction tells the
 * translator to stop where the page stops and mark what it cannot read. It lands in the v16 arm
 * (v16 = v15 + the note-scope sentence, #4767) so there is one candidate prompt, not two.
 *
 * Arms (same pages, same model, same production prompt door incl. continuity context and the
 * #5103 page-break devices):
 *   A1  v16                 the candidate without the restraint block
 *   A2  v16 again           an independent draw of A1 — the A-vs-A NOISE FLOOR (sampler + judge)
 *   B   v16 + restraint     the candidate with it
 *
 * Pre-registration: scripts/eval/PREREGISTRATION-translation-restraint.md (written before any read).
 *
 * Phases (only --submit costs money; run --submit/--collect on Hetzner, the laptop is geo-blocked):
 *   --draw      pin the sample and the three arm prompts, print the cost estimate          FREE
 *   --submit    one Batch API job with every (page, arm) request     PAID, needs --approved-usd
 *   --collect   poll, download, write arms.jsonl, log usage to the meter                  FREE
 *   --packets   blinded judge packets (+ repeat controls); the key stays out of the packets FREE
 *   --score     verdicts → rates, paired tests, the pre-registered verdict                  FREE
 *
 * NOTHING here writes to `pages` or `prompts`. Outputs land in --dir.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { buildTranslationPrompt, SAFETY_SETTINGS, sanitizeTranslationTags, getTranslateModelForBook, PAGE_BREAK_SCOPED } from '../lib/translate-core.mjs';
import { priceFor } from '../lib/model-pricing.mjs';
import { sourceEndsOpen, openEnd } from '../audit/translation-bridging.mjs';
import { resetSeed, seededRand } from './lib/paired-stats.mjs';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const HERE = path.dirname(new URL(import.meta.url).pathname);
const AUDIT = path.join(HERE, 'results/translation-corpus-audit-2026-09-30');
const DIR = opt('dir', path.join(HERE, 'results/translation-restraint-ab-2026-09-30'));
const MIRROR = opt('mirror', path.join(os.homedir(), 'sl-corpus/books'));
const V15_HASH = 'f60c6810';     // the v15 row the #3825 A/B measured; refuse a drifted row
const RISK_N = Number(opt('risk', 72));
const CONTROL_N = Number(opt('control', 24));
const SEED = Number(opt('seed', 5305));
const ARMS = ['A1', 'A2', 'B'];

// ── the two additions, verbatim; the pre-registration quotes them ─────────────
export const V16_SCOPE = `- This omit rule covers ONLY the quoted phrase in <note>original: "…"</note>. Interpretive notes that explain a reference, a term or a difficult passage are still wanted: keep writing them wherever a reader needs one.`;
export const RESTRAINT = `**Stop where the page stops (CRITICAL):**
- Translate only the words on this page. If the source breaks off mid-sentence or mid-word at its foot, end your translation at the same point, mid-sentence, with no closing full stop, and add <meta>continues on next page</meta> after it. Do not finish the sentence, and never supply the words that probably follow, whether from the previous page's translation, from the next page, or from what you know of the work.
- Where the source is illegible, fragmentary or garbled, render what is readable and mark the rest with <unclear>…</unclear>. Never smooth fragments into fluent prose, and never add a sentence, name, number or claim the source does not carry.`;

const OMIT_ANCHOR = 'A missing note is harmless; an invented one is a fabricated quotation that scholars will cite.';
const UNCLEAR_END = 'That is correct, and far better than fluent invention.';

export function buildArms(v15) {
  const i = v15.indexOf(OMIT_ANCHOR), j = v15.indexOf(UNCLEAR_END);
  if (i < 0 || j < 0) throw new Error('v15 anchors not found — the row changed; re-read it before building arms');
  const eol = (k) => v15.indexOf('\n', k);
  const v16 = v15.slice(0, eol(i)) + '\n' + V16_SCOPE + v15.slice(eol(i));
  const k = v16.indexOf(UNCLEAR_END);
  const v16r = v16.slice(0, eol(k)) + '\n\n' + RESTRAINT + v16.slice(eol(k));
  return { A1: v16, A2: v16, B: v16r };
}

// ── the v16 CANDIDATE as it now stands: the arms above, plus the bare continuity marker ──────
// Added after this A/B ran (#5363, #5376; Derek 2026-09-30), so `buildArms` — the text the
// recorded verdicts were made under — is left exactly as it was, and the candidate is built here.
//
// Since v11 the list of bracket replacements has offered the model
// `<meta>continues from previous page: ...</meta>`. That `...` is a door: on a page that opens
// mid-sentence the model writes the page's own lines after the colon, inside a tag every reader
// surface strips. Full mirror, 2026-09-30 (scripts/audit/hidden-meta-scan.mjs): 187,343 of
// 247,804 continuity metas carry text after the marker, and on 3,218 pages that text is ≥ 80% of
// the page. The continuity rule lower down in the same prompt already asks for the bare marker;
// this edit makes the two lines agree.
export const V16_MARKER_OLD = '  - Context from previous page → <meta>continues from previous page: ...</meta>';
export const V16_MARKER_NEW = '  - Context from previous page → <meta>continues from previous page</meta>, the marker alone. Write nothing after it inside the tag: every word of this page, including the end of a sentence that began on the previous page, belongs in the translation itself.';

/**
 * The v16 candidate text: v15 + the note-scope sentence (#4767) + the bare continuity marker
 * (#5376). NOT seeded and NOT default — it becomes a `prompts` row only through the #4767 re-run
 * (a paired A/B under scripts/eval/translation-prompt-ab.mjs), and flipping it is Derek's call.
 */
export function buildV16(v15) {
  const v16 = buildArms(v15).A1;
  if (v16.split(V16_MARKER_OLD).length !== 2) throw new Error('v16 marker anchor not found exactly once — the row changed; re-read it before building v16');
  return v16.replace(V16_MARKER_OLD, () => V16_MARKER_NEW);
}

const sha = (t) => createHash('sha256').update(t).digest('hex').slice(0, 12);
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

function mirrorBook(id) {
  const f = path.join(MIRROR, `${id}.jsonl`);
  if (!fs.existsSync(f)) return new Map();
  return new Map(readJsonl(f).map((r) => [r.p, r]));
}

// ── draw ──────────────────────────────────────────────────────────────────────
async function phaseDraw() {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const row = await c.db('bookstore').collection('prompts').findOne({ type: 'translation', version: 15 });
  await c.close();
  if (!row) throw new Error('translation prompt v15 not found');
  const h = (row.content_hash || createHash('md5').update(row.content).digest('hex')).slice(0, 8);
  if (h !== V15_HASH) throw new Error(`v15 hash ${h} != ${V15_HASH}`);
  const arms = buildArms(row.content);

  const man = readJsonl(path.join(AUDIT, 'manifest.jsonl')).filter((m) => m.kind === 'main');
  const items = new Map(readJsonl(path.join(AUDIT, 'items.jsonl')).map((x) => [x.id, x]));
  const verdict = new Map();
  for (const f of fs.readdirSync(path.join(AUDIT, 'verdicts/opus'))) for (const v of readJsonl(path.join(AUDIT, 'verdicts/opus', f))) verdict.set(v.id, v);

  const risk = [], control = [];
  let english = 0;
  for (const m of man) {
    // English books are MODERNISED under a different prompt (english_modernization); the
    // restraint line is in the translation prompt, so they are out of scope here.
    if (m.modernization || /^english$/i.test(m.language)) { english++; continue; }
    const it = items.get(m.id), v = verdict.get(m.id);
    const open = !!sourceEndsOpen(it.source);
    const flagged = !!(v?.flags?.invention || v?.flags?.garble_passthrough);
    (open || flagged ? risk : control).push({ m, it, open, flagged });
  }
  // The judge is the expensive half (every (page, arm) is read by Claude), so the risk stratum is
  // capped: every audit-flagged page, then seeded open-ended pages to RISK_N.
  resetSeed(SEED);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  shuffle(control);
  const riskPick = [...risk.filter((x) => x.flagged), ...shuffle(risk.filter((x) => !x.flagged))].slice(0, Math.max(RISK_N, risk.filter((x) => x.flagged).length));
  const chosen = [...riskPick.map((x) => ({ ...x, stratum: 'risk' })), ...control.slice(0, CONTROL_N).map((x) => ({ ...x, stratum: 'control' }))];

  const sample = [];
  for (const { m, it, stratum, open, flagged } of chosen) {
    const book = mirrorBook(m.book_id);
    const prev = book.get(m.page_number - 1), next = book.get(m.page_number + 1);
    sample.push({
      id: m.id, stratum, sourceOpen: open, auditFlagged: flagged,
      book_id: m.book_id, page_number: m.page_number, language: m.language,
      book: { id: m.book_id, title: m.title, author: m.author, language: m.language, published: m.published },
      ocr: it.source, prevOcr: prev?.ocr || null, nextOcr: next?.ocr || null, prevTr: prev?.tr || null,
      auditTranslation: it.translation,
    });
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'sample.jsonl'), sample.map((s) => JSON.stringify(s)).join('\n') + '\n');
  const armMeta = Object.fromEntries(ARMS.map((a) => [a, { sha: sha(arms[a]), chars: arms[a].length }]));
  fs.writeFileSync(path.join(DIR, 'arms.json'), JSON.stringify({ base: { version: 15, hash: h }, v16_scope: V16_SCOPE, restraint: RESTRAINT, arms: armMeta, text: arms }, null, 2));

  const est = estimate(sample, arms);
  console.log(`sample: ${riskPick.length} risk of ${risk.length} (${riskPick.filter((x) => x.flagged).length} audit-flagged invention/garble, the rest source ends open) + ${Math.min(CONTROL_N, control.length)} control of ${control.length};${english} English (modernisation) pages out of scope`);
  console.log(`arms: ${ARMS.map((a) => `${a}=${armMeta[a].sha}`).join(' ')}   (A1 and A2 are the same text by design)`);
  console.log(`requests: ${est.calls}; in ~${est.inTok.toLocaleString()} tok, out ~${est.outTok.toLocaleString()} tok; models ${JSON.stringify(est.models)}`);
  console.log(`ESTIMATE (Batch API, 50%): $${est.usd.toFixed(2)}   (realtime would be $${(est.usd * 2).toFixed(2)})`);
}

function modelFor(s) { return getTranslateModelForBook(s.book); }
function promptFor(s, text) {
  return buildTranslationPrompt({
    prompts: { translation: { text, ref: {} }, english: { text, ref: {} } },
    book: s.book, ocrText: s.ocr, previousTranslation: s.prevTr,
    prevOcrText: s.prevOcr, nextOcrText: s.nextOcr, pageBreak: PAGE_BREAK_SCOPED,
  }).prompt;
}
function estimate(sample, arms) {
  let inTok = 0, outTok = 0, usd = 0; const models = {};
  for (const s of sample) for (const a of ARMS) {
    const m = modelFor(s), p = priceFor(m);
    const i = Math.ceil(promptFor(s, arms[a]).length / 3.5), o = Math.ceil(s.ocr.length * 0.45) + 400;
    inTok += i; outTok += o; models[m] = (models[m] || 0) + 1;
    usd += 0.5 * ((i / 1e6) * p.input + (o / 1e6) * p.output);
  }
  return { calls: sample.length * ARMS.length, inTok, outTok, usd, models };
}

// ── submit / collect (Batch API) ────────────────────────────────────────────────
const API = 'https://generativelanguage.googleapis.com';
const batchKeyEnv = () => (process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY');

async function phaseSubmit() {
  const sample = readJsonl(path.join(DIR, 'sample.jsonl'));
  const { text: arms } = JSON.parse(fs.readFileSync(path.join(DIR, 'arms.json'), 'utf8'));
  const est = estimate(sample, arms);
  const approved = Number(opt('approved-usd', 0));
  if (!(approved >= est.usd)) { console.error(`REFUSING TO SPEND: estimate $${est.usd.toFixed(3)}, --approved-usd ${approved || 'absent'}`); process.exit(2); }
  const byModel = {};
  for (const s of sample) for (const a of ARMS) {
    const maxOutputTokens = Math.min(32768, Math.max(4096, Math.ceil(s.ocr.length) + 1200));
    (byModel[modelFor(s)] ||= []).push(JSON.stringify({
      key: `${s.id}:${a}`,
      request: { contents: [{ parts: [{ text: promptFor(s, arms[a]) }] }], safetySettings: SAFETY_SETTINGS, generationConfig: { maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } } },
    }));
  }
  const envName = batchKeyEnv(), key = process.env[envName];
  if (!key) throw new Error(`no ${envName}`);
  const jobs = [];
  for (const [model, lines] of Object.entries(byModel)) {
    const jsonl = lines.join('\n') + '\n', bytes = Buffer.byteLength(jsonl);
    const start = await fetch(`${API}/upload/v1beta/files?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes), 'X-Goog-Upload-Header-Content-Type': 'text/plain' },
      body: JSON.stringify({ file: { displayName: `restraint-ab-5305-${model}` } }),
    });
    if (!start.ok) throw new Error(`upload start ${start.status} ${(await start.text()).slice(0, 300)}`);
    const up = await fetch(start.headers.get('X-Goog-Upload-URL'), { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body: jsonl });
    if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 300)}`);
    const fileName = (await up.json()).file?.name;
    if (!fileName) throw new Error('upload response missing file.name');
    const create = await fetch(`${API}/v1beta/models/${model}:batchGenerateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch: { display_name: `restraint-ab-5305-${model}`, input_config: { file_name: fileName } } }),
    });
    if (!create.ok) throw new Error(`batch create ${create.status} ${(await create.text()).slice(0, 500)}`);
    const job = await create.json();
    jobs.push({ model, job_name: job.name, file_name: fileName, requests: lines.length, submitted_at: new Date().toISOString() });
    console.log(`submitted ${job.name} (${model}, ${lines.length} requests)`);
  }
  fs.writeFileSync(path.join(DIR, 'batch.json'), JSON.stringify({ key_env: envName, estimate_usd: est.usd, jobs }, null, 2));
}

async function phaseCollect() {
  const rec = JSON.parse(fs.readFileSync(path.join(DIR, 'batch.json'), 'utf8'));
  const key = process.env[rec.key_env];
  const waitMax = Number(opt('wait-min', 0)) * 60e3, t0 = Date.now();
  const out = path.join(DIR, 'arms.jsonl');
  for (;;) {
    let pending = 0;
    for (const j of rec.jobs) {
      if (j.collected_at) continue;
      const data = await (await fetch(`${API}/v1beta/${j.job_name}?key=${key}`)).json();
      const state = data.metadata?.state || data.state;
      console.log(`${j.job_name} ${state} ${JSON.stringify(data.metadata?.batchStats || {})}`);
      if (/FAILED|CANCELLED|EXPIRED/.test(state || '')) throw new Error(`batch ${state}`);
      const rf = data.metadata?.output?.responsesFile || data.response?.responsesFile;
      if (!rf) { pending++; continue; }
      const text = await (await fetch(`${API}/download/v1beta/${rf}:download?alt=media&key=${key}`)).text();
      let inTok = 0, outTok = 0, n = 0, errors = 0;
      const p = priceFor(j.model);
      for (const line of text.split('\n').filter(Boolean)) {
        const r = JSON.parse(line); const [id, arm] = (r.key || r.metadata?.key).split(':');
        const resp = r.response, u = resp?.usageMetadata || {};
        const it = { id, arm, model: j.model };
        if (r.error || !resp) { it.error = JSON.stringify(r.error || 'no response').slice(0, 300); errors++; }
        else {
          it.text = sanitizeTranslationTags((resp.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join(''));
          it.finish = resp.candidates?.[0]?.finishReason || null;
          it.inTok = u.promptTokenCount || 0; it.outTok = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
          inTok += it.inTok; outTok += it.outTok;
        }
        fs.appendFileSync(out, JSON.stringify(it) + '\n'); n++;
      }
      j.collected_at = new Date().toISOString(); j.responses = n; j.errors = errors; j.in_tokens = inTok; j.out_tokens = outTok;
      j.cost_usd = 0.5 * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output);
      console.log(`collected ${n} (${errors} errors) $${j.cost_usd.toFixed(4)}`);
      try {
        const { logUsage } = await import('../workers/lib/supabase-usage-logger.mjs');
        await logUsage({ type: 'eval', mode: 'batch', model: j.model, page_count: n - errors, input_tokens: inTok, output_tokens: outTok, batch_job_id: j.job_name, endpoint: 'eval/translation-restraint-ab', triggered_by: 'manual', prompt_version: 'eval-5305' });
      } catch (e) { console.warn(`logUsage failed: ${e.message}`); }
    }
    fs.writeFileSync(path.join(DIR, 'batch.json'), JSON.stringify(rec, null, 2));
    if (!pending) { console.log(`all collected; actual $${rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0).toFixed(4)} → ${out}`); return; }
    if (Date.now() - t0 > waitMax) { console.log(`${pending} job(s) pending; re-run --collect later`); return; }
    await new Promise((r) => setTimeout(r, 60e3));
  }
}

// ── judge packets (blinded) ─────────────────────────────────────────────────────
function phasePackets() {
  const sample = new Map(readJsonl(path.join(DIR, 'sample.jsonl')).map((s) => [s.id, s]));
  const rows = readJsonl(path.join(DIR, 'arms.jsonl')).filter((r) => r.text);
  resetSeed(SEED + 1);
  const opaque = () => Math.floor(seededRand() * 0xffffffffff).toString(16).padStart(10, '0');
  const items = [], key = {};
  for (const r of rows) {
    const s = sample.get(r.id); const pid = opaque();
    key[pid] = { id: r.id, arm: r.arm };
    items.push({ id: pid, language: s.language, source: s.ocr, translation: r.text });
  }
  // Repeat controls: the same (page, arm) twice under different ids measures the judge's own noise.
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  const N = Number(opt('n-packets', 8));  // not --packets: that is the phase flag
  const packets = Array.from({ length: N }, (_, p) => items.filter((_, i) => i % N === p));
  // Repeat controls go into a packet other than their original's (the judge would see both),
  // and at a random position.
  const REPEATS = Number(opt('repeats', 12));
  for (let i = 0; i < REPEATS; i++) {
    const at = Math.floor(seededRand() * items.length), src = items[at], pid = opaque();
    key[pid] = { ...key[src.id], repeat_of: src.id };
    const p = packets[(at % N + 1 + (i % (N - 1))) % N];
    p.splice(Math.floor(seededRand() * (p.length + 1)), 0, { ...src, id: pid });
  }
  const pdir = path.join(DIR, 'packets'); fs.mkdirSync(pdir, { recursive: true });
  // JSONL for the record, and the same items as plain text: a judge reads a 10K-char JSON line badly.
  packets.forEach((chunk, p) => {
    const base = path.join(pdir, `packet-${String(p + 1).padStart(2, '0')}`);
    fs.writeFileSync(`${base}.jsonl`, chunk.map((x) => JSON.stringify(x)).join('\n') + '\n');
    fs.writeFileSync(`${base}.md`, chunk.map((x, i) => `\n\n######## ITEM ${i + 1}/${chunk.length}  id=${x.id}  language=${x.language}\n\n==== SOURCE ====\n${x.source}\n\n==== TRANSLATION ====\n${x.translation}\n`).join(''));
  });
  fs.writeFileSync(path.join(DIR, 'packet-key.json'), JSON.stringify(key));
  console.log(`${items.length + REPEATS} items (${REPEATS} repeats) in ${N} packets of ≤${Math.max(...packets.map((p) => p.length))} → ${pdir}`);
}

// ── score ───────────────────────────────────────────────────────────────────
function mcnemar(b, c) {  // exact two-sided on discordant pairs
  const n = b + c; if (!n) return 1;
  const k = Math.min(b, c); let p = 0;
  const lf = (x) => { let s = 0; for (let i = 2; i <= x; i++) s += Math.log(i); return s; };
  for (let i = 0; i <= k; i++) p += Math.exp(lf(n) - lf(i) - lf(n - i) - n * Math.log(2));
  return Math.min(1, 2 * p);
}

function phaseScore() {
  const sample = new Map(readJsonl(path.join(DIR, 'sample.jsonl')).map((s) => [s.id, s]));
  const key = JSON.parse(fs.readFileSync(path.join(DIR, 'packet-key.json'), 'utf8'));
  const texts = new Map(readJsonl(path.join(DIR, 'arms.jsonl')).map((r) => [`${r.id}:${r.arm}`, r]));
  const verdicts = new Map();
  const vdir = path.join(DIR, 'verdicts');
  for (const f of fs.readdirSync(vdir).filter((f) => f.endsWith('.jsonl'))) for (const v of readJsonl(path.join(vdir, f))) verdicts.set(v.id, v);

  // judge noise from the repeats
  const reps = Object.entries(key).filter(([, k]) => k.repeat_of).map(([pid, k]) => [verdicts.get(pid), verdicts.get(k.repeat_of)]).filter(([a, b]) => a && b);
  const judgeNoise = { pairs: reps.length, sameFidelity: reps.filter(([a, b]) => a.fidelity === b.fidelity).length, sameInvention: reps.filter(([a, b]) => a.flags.invention === b.flags.invention).length };

  const cell = new Map(); // id -> {A1,A2,B}
  for (const [pid, k] of Object.entries(key)) {
    if (k.repeat_of) continue;
    const v = verdicts.get(pid); if (!v) continue;
    const t = texts.get(`${k.id}:${k.arm}`);
    const s = sample.get(k.id);
    (cell.get(k.id) || cell.set(k.id, {}).get(k.id))[k.arm] = {
      inv: !!v.flags.invention, invMajor: v.defects.some((d) => d.type === 'invention' && d.severity === 'major'),
      om: !!v.flags.omission, fid: v.fidelity, trunc: !!v.flags.truncated,
      openEnd: !!openEnd(s.ocr, t.text), marked: /<meta>\s*continues on (?:the )?next page/i.test(t.text), unclear: (t.text.match(/<unclear>/g) || []).length,
    };
  }
  const complete = [...cell.entries()].filter(([, c]) => ARMS.every((a) => c[a]));
  const report = { at: new Date().toISOString(), pages: complete.length, judgeNoise, strata: {} };
  for (const stratum of ['risk', 'control', 'all']) {
    const rows = complete.filter(([id]) => stratum === 'all' || sample.get(id).stratum === stratum).map(([, c]) => c);
    const rate = (a, k) => +(rows.filter((c) => c[a][k]).length / Math.max(1, rows.length)).toFixed(3);
    const mean = (a, k) => +(rows.reduce((s, c) => s + c[a][k], 0) / Math.max(1, rows.length)).toFixed(3);
    const paired = (x, y, k) => { const b = rows.filter((c) => c[x][k] && !c[y][k]).length, cc = rows.filter((c) => !c[x][k] && c[y][k]).length; return { [`${x}only`]: b, [`${y}only`]: cc, p: +mcnemar(b, cc).toFixed(4) }; };
    const out = { n: rows.length };
    for (const a of ARMS) out[a] = { invention: rate(a, 'inv'), inventionMajor: rate(a, 'invMajor'), omission: rate(a, 'om'), fid4: +(rows.filter((c) => c[a].fid >= 4).length / Math.max(1, rows.length)).toFixed(3), meanFid: mean(a, 'fid'), truncated: rate(a, 'trunc'), openEndUnmarked: rate(a, 'openEnd'), markedContinues: rate(a, 'marked'), unclearPerPage: mean(a, 'unclear') };
    out.noise_A2vA1 = { invention: paired('A2', 'A1', 'inv'), omission: paired('A2', 'A1', 'om') };
    out.effect_BvA1 = { invention: paired('B', 'A1', 'inv'), omission: paired('B', 'A1', 'om'), openEndUnmarked: paired('B', 'A1', 'openEnd') };
    report.strata[stratum] = out;
  }
  fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

// Run only as a script: a test imports buildArms/buildV16 without starting a phase.
if (import.meta.url === `file://${process.argv[1]}`) {
  const phase = ['draw', 'submit', 'collect', 'packets', 'score'].find(has);
  if (!phase) { console.error('pass one of --draw --submit --collect --packets --score'); process.exit(1); }
  await ({ draw: phaseDraw, submit: phaseSubmit, collect: phaseCollect, packets: phasePackets, score: phaseScore })[phase]();
}
