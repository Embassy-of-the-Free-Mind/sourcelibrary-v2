#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-restraint-ab.mjs (#5305, PR #5349) — the same pages, judge and Batch
// submit/collect shape, and this file follows it phase for phase. It does not fit because its arms differ by
// PROMPT on production's routing (the model is a function of the book), it drops English books, and it draws
// a risk stratum; here the prompt is fixed, the MODEL is the arm, and every audit page is used.
// scripts/eval/translation-model-ab.mjs (#4759) compares the two models, but pairwise on fluency, realtime,
// with no source-grounded judge and no same-arm control (#5127). The judge rubric is the audit's own
// (scripts/eval/translation-corpus-audit/JUDGE-PROMPT.md); paired statistics are scripts/eval/lib/paired-stats.mjs.
/**
 * translation-paired-arm — lite vs flash on the SAME pages, same prompt, same context (#5274).
 *
 * The corpus audit found lite omits more and flash invents more, on unpaired arms (different books,
 * different prompt eras). This re-translates the audit's pages with both models through the production
 * prompt door, plus lite a second time as the A-vs-A noise floor, and has the audit's judge score every
 * output blind.
 *
 * Arms (one prompt per page, byte-identical across arms):
 *   L1  gemini-3.1-flash-lite     lite
 *   L2  gemini-3.1-flash-lite     lite again — the noise floor (sampler + judge)
 *   F   gemini-3-flash-preview    flash
 *
 * Pre-registration: scripts/eval/PREREGISTRATION-translation-paired-arm.md (written before any read).
 *
 * Phases (only --submit costs money):
 *   --draw      pin the sample, build the prompts and the Batch request files, print the estimate   FREE, laptop (Mongo read)
 *   --submit    one Batch API job per model                      PAID, needs --approved-usd, run on Hetzner
 *   --collect   poll, download, write arms.jsonl, log usage to the meter                    FREE, run on Hetzner
 *   --packets   blinded judge packets (+ repeat controls); the key stays out of the packets       FREE
 *   --score     verdicts → paired rates, bootstrap CIs, the pre-registered rule                   FREE
 *
 * --submit and --collect import nothing from the repo at load time, so the script and its --dir can be
 * copied to a scratch directory on Hetzner (the laptop is geo-blocked for Gemini) and run there with
 * --repo /root/sourcelibrary. NOTHING here writes to `pages` or `prompts`. Outputs land in --dir.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(opt('repo', path.join(HERE, '../..')));
const imp = (rel) => import(path.join(REPO, rel));
const AUDIT = path.join(REPO, 'scripts/eval/results/translation-corpus-audit-2026-09-30');
const DIR = path.resolve(opt('dir', path.join(REPO, 'scripts/eval/results/translation-paired-arm-2026-09-30')));
const SEED = Number(opt('seed', 5274));
const ARMS = ['L1', 'L2', 'F'];
const ARM_MODEL = { L1: 'gemini-3.1-flash-lite', L2: 'gemini-3.1-flash-lite', F: 'gemini-3-flash-preview' };
// #5311: the OCR text of these six Internet Archive pages belongs to a neighbouring leaf.
const WRONG_LEAF = new Set(['02ec073c0c', '05b1da1988', '134c51dfa7', '40d19cba36', '4b4d01bf24', 'd9f45e5b0a']);
// The audit's script split (translation-corpus-audit/score.mjs by_script_class).
const LATIN_SCRIPT = new Set(['Latin', 'English', 'German', 'French', 'Italian', 'Dutch', 'Spanish']);

const sha = (t) => createHash('sha256').update(String(t)).digest('hex').slice(0, 12);
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

// ── draw ──────────────────────────────────────────────────────────────────────
async function phaseDraw() {
  const { MongoClient, ObjectId } = await import('mongodb');
  const core = await imp('scripts/lib/translate-core.mjs');
  const { maxOutputTokensFor } = await imp('scripts/lib/translate-batch-seam.mjs');
  const { priceFor } = await imp('scripts/lib/model-pricing.mjs');
  if (ARM_MODEL.L1 !== core.MODEL_LITE || ARM_MODEL.F !== core.MODEL_FLASH) throw new Error('arm models drifted from translate-core MODEL_LITE / MODEL_FLASH');

  const man = readJsonl(path.join(AUDIT, 'manifest.jsonl')).filter((m) => m.kind === 'main');
  const items = new Map(readJsonl(path.join(AUDIT, 'items.jsonl')).map((x) => [x.id, x]));
  const kept = man.filter((m) => !WRONG_LEAF.has(m.id));
  if (man.length - kept.length !== WRONG_LEAF.size) throw new Error('a wrong-leaf id is not in the manifest');

  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const prompts = await core.loadTranslationPrompts(db);
  const sample = [], requests = { [core.MODEL_LITE]: [], [core.MODEL_FLASH]: [] };
  const notes = { language_differs: [], no_prev_translation: 0, no_prev_ocr: 0, no_next_ocr: 0, ocr_changed_since_audit: 0, page_break_applied: 0, production_model: {} };
  for (const m of kept) {
    // A book is looked up by `id` OR `_id` (book-deletion-and-identity.md).
    const or = [{ id: m.book_id }];
    if (ObjectId.isValid(m.book_id)) or.push({ _id: new ObjectId(m.book_id) });
    const book = await db.collection('books').findOne({ $or: or }, { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, year: 1, published: 1, 'image_source.provider': 1 } });
    if (!book) throw new Error(`book ${m.book_id} not found`);
    const rows = await db.collection('pages')
      .find({ book_id: m.book_id, page_number: { $in: [m.page_number - 1, m.page_number, m.page_number + 1] } }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } })
      .toArray();
    const at = (n) => rows.find((p) => p.page_number === n);
    const prev = at(m.page_number - 1), next = at(m.page_number + 1), cur = at(m.page_number);
    const ocr = items.get(m.id).source;   // the text the audit's judge read, not a later re-OCR
    if ((cur?.ocr?.data || '') !== ocr) notes.ocr_changed_since_audit++;
    if (book.language !== m.language) notes.language_differs.push({ id: m.id, manifest: m.language, book: book.language });
    const prevTr = prev?.translation?.data || null, prevOcr = prev?.ocr?.data || undefined, nextOcr = next?.ocr?.data || undefined;
    if (!prevTr) notes.no_prev_translation++;
    if (!prevOcr) notes.no_prev_ocr++;
    if (!nextOcr) notes.no_next_ocr++;
    const built = core.buildTranslationPrompt({ prompts, book, ocrText: ocr, previousTranslation: prevTr, prevOcrText: prevOcr, nextOcrText: nextOcr, pageBreak: core.PAGE_BREAK_SCOPED });
    if (built.pageBreak?.applied) notes.page_break_applied++;
    const production = core.getTranslateModelForBook(book);
    notes.production_model[production] = (notes.production_model[production] || 0) + 1;
    const maxOutputTokens = maxOutputTokensFor([{ ocr: { data: ocr } }]);
    sample.push({
      id: m.id, book_id: m.book_id, page_number: m.page_number, language: m.language, book_language: book.language,
      script_class: LATIN_SCRIPT.has(m.language) ? 'latin-script' : 'non-latin-script', period: m.period, url: m.url,
      audit_arm: m.arm, production_model: production, english: built.isEnglish,
      prompt_name: built.promptRef.name, prompt_version: built.promptRef.version,
      prompt_sent_hash: sha(built.prompt), prompt_sent_chars: built.prompt.length, context_given: prevTr ? sha(prevTr) : null,
      page_break: built.pageBreak, max_output_tokens: maxOutputTokens, source: ocr,
    });
    for (const a of ARMS) {
      requests[ARM_MODEL[a]].push({
        key: `${m.id}:${a}`,
        request: { contents: [{ parts: [{ text: built.prompt }] }], safetySettings: core.SAFETY_SETTINGS, generationConfig: { maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } } },
      });
    }
  }
  await c.close();

  fs.mkdirSync(DIR, { recursive: true });
  writeJsonl(path.join(DIR, 'sample.jsonl'), sample);
  let usd = 0; const est = {};
  for (const [model, lines] of Object.entries(requests)) {
    writeJsonl(path.join(DIR, `requests-${model}.jsonl`), lines);
    const p = priceFor(model);
    const inTok = lines.reduce((s, r) => s + Math.ceil(r.request.contents[0].parts[0].text.length / 3.5), 0);
    const perArm = sample.reduce((s, x) => s + Math.ceil(x.source.length * 0.45) + 400, 0);
    const outTok = perArm * (lines.length / sample.length);
    const cost = 0.5 * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output);
    est[model] = { requests: lines.length, in_tokens: inTok, out_tokens: outTok, price: p, usd: +cost.toFixed(4) };
    usd += cost;
  }
  fs.writeFileSync(path.join(DIR, 'arms.json'), JSON.stringify({
    at: new Date().toISOString(), arms: ARM_MODEL, pages: sample.length, excluded_wrong_leaf: [...WRONG_LEAF],
    prompts: { translation: prompts.translation.ref, english_modernization: prompts.english.ref },
    generation: { thinkingBudget: 0, maxOutputTokens: 'translate-batch-seam maxOutputTokensFor', temperature: 'model default', page_break: 'PAGE_BREAK_SCOPED' },
    notes, estimate: { ...est, usd: +usd.toFixed(4), basis: 'Batch API, 50% of list price' },
  }, null, 2));
  console.log(`sample: ${sample.length} pages (${man.length} main − ${WRONG_LEAF.size} wrong-leaf, #5311); ${sample.filter((s) => s.english).length} English (modernisation prompt)`);
  console.log(`prompts: translation v${prompts.translation.ref.version} ${String(prompts.translation.ref.content_hash).slice(0, 8)}, english_modernization v${prompts.english.ref.version} ${String(prompts.english.ref.content_hash).slice(0, 8)}`);
  console.log(`context: no previous translation ${notes.no_prev_translation}, no prev OCR ${notes.no_prev_ocr}, no next OCR ${notes.no_next_ocr}; page-break devices applied on ${notes.page_break_applied}; OCR changed since the audit on ${notes.ocr_changed_since_audit}; language label differs on ${notes.language_differs.length}`);
  console.log(`production routing on these pages: ${JSON.stringify(notes.production_model)}`);
  for (const [model, e] of Object.entries(est)) console.log(`${model}: ${e.requests} requests, in ~${e.in_tokens.toLocaleString()} tok, out ~${e.out_tokens.toLocaleString()} tok → $${e.usd}`);
  console.log(`ESTIMATE (Batch API, 50%): $${usd.toFixed(2)}   (realtime would be $${(usd * 2).toFixed(2)})`);
}

// ── submit / collect (Batch API) ────────────────────────────────────────────────
const API = 'https://generativelanguage.googleapis.com';
const batchKeyEnv = () => (process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY');

async function phaseSubmit() {
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'arms.json'), 'utf8'));
  const approved = Number(opt('approved-usd', 0));
  if (!(approved >= meta.estimate.usd)) { console.error(`REFUSING TO SPEND: estimate $${meta.estimate.usd}, --approved-usd ${approved || 'absent'}`); process.exit(2); }
  if (fs.existsSync(path.join(DIR, 'batch.json'))) { console.error('batch.json exists — this run was already submitted; --collect it'); process.exit(2); }
  const envName = batchKeyEnv(), key = process.env[envName];
  if (!key) throw new Error(`no ${envName}`);
  const jobs = [];
  for (const model of [...new Set(Object.values(ARM_MODEL))]) {
    // Every request line carries generationConfig.thinkingConfig.thinkingBudget: 0 (built in --draw).
    const jsonl = fs.readFileSync(path.join(DIR, `requests-${model}.jsonl`), 'utf8'), bytes = Buffer.byteLength(jsonl);
    const n = jsonl.split('\n').filter(Boolean).length;
    const start = await fetch(`${API}/upload/v1beta/files?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes), 'X-Goog-Upload-Header-Content-Type': 'text/plain' },
      body: JSON.stringify({ file: { displayName: `paired-arm-5274-${model}` } }),
    });
    if (!start.ok) throw new Error(`upload start ${start.status} ${(await start.text()).slice(0, 300)}`);
    const up = await fetch(start.headers.get('X-Goog-Upload-URL'), { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body: jsonl });
    if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 300)}`);
    const fileName = (await up.json()).file?.name;
    if (!fileName) throw new Error('upload response missing file.name');
    // thinking-ok: a Batch job over requests-<model>.jsonl, whose every line sets thinkingConfig: { thinkingBudget: 0 }; usage is logged in --collect
    const create = await fetch(`${API}/v1beta/models/${model}:batchGenerateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch: { display_name: `paired-arm-5274-${model}`, input_config: { file_name: fileName } } }),
    });
    if (!create.ok) throw new Error(`batch create ${create.status} ${(await create.text()).slice(0, 500)}`);
    const job = await create.json();
    jobs.push({ model, job_name: job.name, file_name: fileName, requests: n, submitted_at: new Date().toISOString() });
    // Written after EACH job: a crash between the two submits must not orphan a paid job.
    fs.writeFileSync(path.join(DIR, 'batch.json'), JSON.stringify({ key_env: envName, estimate_usd: meta.estimate.usd, jobs }, null, 2));
    console.log(`submitted ${job.name} (${model}, ${n} requests)`);
  }
}

/** One Batch response line → an outcome (eval-design §5.1: an enum, never inferred from the text alone). */
function outcomeOf(r) {
  const resp = r.response;
  if (r.error || !resp) return { outcome: 'error', error: JSON.stringify(r.error || 'no response').slice(0, 300) };
  const cand = resp.candidates?.[0], finish = cand?.finishReason || null;
  const raw = (cand?.content?.parts || []).map((x) => x.text || '').join('');
  if (!raw.trim()) return { outcome: finish && finish !== 'STOP' ? 'refusal' : 'empty', finish, block: resp.promptFeedback?.blockReason || null };
  return { outcome: finish === 'MAX_TOKENS' ? 'truncated' : finish && finish !== 'STOP' ? 'refusal' : 'text', finish, raw };
}

async function phaseCollect() {
  const { sanitizeTranslationTags } = await imp('scripts/lib/translate-core.mjs');
  const { priceFor } = await imp('scripts/lib/model-pricing.mjs');
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
      let inTok = 0, outTok = 0, n = 0; const outcomes = {}, rows = [];
      const p = priceFor(j.model);
      for (const line of text.split('\n').filter(Boolean)) {
        const r = JSON.parse(line); const [id, arm] = (r.key || r.metadata?.key).split(':');
        const o = outcomeOf(r), u = r.response?.usageMetadata || {};
        const it = { id, arm, model: j.model, model_version: r.response?.modelVersion || null, outcome: o.outcome, finish: o.finish ?? null };
        if (o.error) it.error = o.error;
        if (o.block) it.block = o.block;
        // A refusal that carries a partial answer is still a failed read: its text is kept apart and never judged.
        if (o.raw && (o.outcome === 'text' || o.outcome === 'truncated')) { it.text = sanitizeTranslationTags(o.raw); it.text_hash = sha(it.text); it.chars = it.text.length; }
        else if (o.raw) it.partial = o.raw;
        it.inTok = u.promptTokenCount || 0; it.outTok = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
        inTok += it.inTok; outTok += it.outTok; outcomes[o.outcome] = (outcomes[o.outcome] || 0) + 1;
        rows.push(it); n++;
      }
      fs.appendFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
      j.collected_at = new Date().toISOString(); j.responses = n; j.outcomes = outcomes; j.in_tokens = inTok; j.out_tokens = outTok;
      j.cost_usd = 0.5 * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output);
      console.log(`collected ${n} ${JSON.stringify(outcomes)} $${j.cost_usd.toFixed(4)}`);
      fs.writeFileSync(path.join(DIR, 'batch.json'), JSON.stringify(rec, null, 2));
      try {
        const { logUsage } = await imp('scripts/workers/lib/supabase-usage-logger.mjs');
        await logUsage({ type: 'eval', mode: 'batch', model: j.model, page_count: (outcomes.text || 0) + (outcomes.truncated || 0), input_tokens: inTok, output_tokens: outTok, batch_job_id: j.job_name, endpoint: 'eval/translation-paired-arm', triggered_by: 'manual', prompt_version: 'eval-5274' });
        j.usage_logged = true;
      } catch (e) { j.usage_logged = false; console.warn(`logUsage failed: ${e.message}`); }
      fs.writeFileSync(path.join(DIR, 'batch.json'), JSON.stringify(rec, null, 2));
    }
    if (!pending) { console.log(`all collected; actual $${rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0).toFixed(4)} → ${out}`); return; }
    if (Date.now() - t0 > waitMax) { console.log(`${pending} job(s) pending; re-run --collect later`); return; }
    await new Promise((r) => setTimeout(r, 60e3));
  }
}

// ── judge packets (blinded) ─────────────────────────────────────────────────────
async function phasePackets() {
  const { resetSeed, seededRand } = await imp('scripts/eval/lib/paired-stats.mjs');
  const sample = readJsonl(path.join(DIR, 'sample.jsonl'));
  const rows = new Map(readJsonl(path.join(DIR, 'arms.jsonl')).map((r) => [`${r.id}:${r.arm}`, r]));
  const PER = Number(opt('per-packet', 15)), REPEATS = Number(opt('repeats', 30));
  resetSeed(SEED + 1);
  const rint = (n) => Math.floor(seededRand() * n);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rint(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const seen = new Set();
  const opaque = () => { for (;;) { const id = Array.from({ length: 10 }, () => rint(16).toString(16)).join(''); if (!seen.has(id)) { seen.add(id); return id; } } };

  // Only pages where every arm returned text are judged: the analysis is paired.
  const pages = shuffle(sample.filter((s) => ARMS.every((a) => rows.get(`${s.id}:${a}`)?.text)));
  const N = Math.ceil((pages.length * ARMS.length) / PER);
  const packets = Array.from({ length: N }, () => []);
  const key = {};
  // Page i's three arms go to three DIFFERENT packets (i, i + N/3, i + 2N/3), and which arm takes
  // which offset rotates with i, so each packet holds the arms in near-equal numbers and a judge's
  // severity cannot load onto one arm.
  const off = [0, Math.floor(N / 3), Math.floor((2 * N) / 3)];
  pages.forEach((s, i) => {
    ARMS.forEach((a, k) => {
      const r = rows.get(`${s.id}:${a}`), pid = opaque(), p = (i + off[(k + i) % 3]) % N;
      key[pid] = { id: s.id, arm: a, packet: p + 1, text_hash: r.text_hash };
      packets[p].push({ id: pid, language: s.language, source: s.source, translation: r.text });
    });
  });
  // Repeat controls: the same (page, arm) under a second id in a packet that holds no arm of that page.
  const flat = Object.entries(key);
  for (let i = 0; i < REPEATS; i++) {
    const arm = ARMS[i % ARMS.length];
    const pool = flat.filter(([, k]) => k.arm === arm && !Object.values(key).some((q) => q.repeat_of && key[q.repeat_of] === k));
    const [srcPid, k] = pool[rint(pool.length)];
    const pagePackets = new Set(flat.filter(([, q]) => q.id === k.id).map(([, q]) => q.packet));
    const free = packets.map((_, p) => p + 1).filter((p) => !pagePackets.has(p)).sort((a, b) => packets[a - 1].length - packets[b - 1].length);
    const p = free[rint(Math.min(8, free.length))], pid = opaque();
    const item = packets[k.packet - 1].find((x) => x.id === srcPid);
    key[pid] = { id: k.id, arm: k.arm, packet: p, text_hash: k.text_hash, repeat_of: srcPid };
    packets[p - 1].push({ ...item, id: pid });
  }
  const pdir = path.join(DIR, 'packets'); fs.mkdirSync(pdir, { recursive: true });
  const vdir = path.join(DIR, 'verdicts'); fs.mkdirSync(vdir, { recursive: true });
  packets.forEach((chunk, p) => {
    shuffle(chunk);
    const name = `packet-${String(p + 1).padStart(2, '0')}`;
    // JSONL for the record, and the same items as plain text: a judge reads a 10K-char JSON line badly.
    writeJsonl(path.join(pdir, `${name}.jsonl`), chunk);
    fs.writeFileSync(path.join(pdir, `${name}.md`), chunk.map((x, i) => `\n\n######## ITEM ${i + 1}/${chunk.length}  id=${x.id}  language=${x.language}\n\n==== SOURCE ====\n${x.source}\n\n==== TRANSLATION ====\n${x.translation}\n`).join(''));
    // Pre-created empty: the judge overwrites it (a judge cannot create a new file under scripts/eval).
    const vf = path.join(vdir, `${name}.jsonl`);
    if (!fs.existsSync(vf)) fs.writeFileSync(vf, '');
  });
  fs.writeFileSync(path.join(DIR, 'packet-key.json'), JSON.stringify(key));
  const armCounts = packets.map((c) => ARMS.map((a) => c.filter((x) => key[x.id].arm === a && !key[x.id].repeat_of).length).join('/'));
  console.log(`${pages.length} complete pages of ${sample.length} → ${pages.length * ARMS.length} items + ${REPEATS} repeats in ${N} packets of ${Math.min(...packets.map((p) => p.length))}–${Math.max(...packets.map((p) => p.length))} → ${pdir}`);
  console.log(`arms per packet (L1/L2/F), first 8: ${armCounts.slice(0, 8).join('  ')}`);
}

// ── score ───────────────────────────────────────────────────────────────────
async function phaseScore() {
  const { resetSeed, bootstrapCI, binomTwoSided, mean } = await imp('scripts/eval/lib/paired-stats.mjs');
  const sample = new Map(readJsonl(path.join(DIR, 'sample.jsonl')).map((s) => [s.id, s]));
  const key = JSON.parse(fs.readFileSync(path.join(DIR, 'packet-key.json'), 'utf8'));
  const armRows = readJsonl(path.join(DIR, 'arms.jsonl'));
  const batch = JSON.parse(fs.readFileSync(path.join(DIR, 'batch.json'), 'utf8'));
  const verdicts = new Map(); let bad = 0;
  const vdir = path.join(DIR, 'verdicts');
  for (const f of fs.readdirSync(vdir).filter((f) => f.endsWith('.jsonl'))) {
    for (const v of readJsonl(path.join(vdir, f))) {
      if (!key[v.id] || typeof v.fidelity !== 'number' || !v.flags || !Array.isArray(v.defects)) { bad++; continue; }
      verdicts.set(v.id, v);
    }
  }
  const expected = Object.keys(key).length;
  const pct = (x) => +(100 * x).toFixed(1);

  // Judge noise from the repeat controls (same text, two ids, two packets).
  const reps = Object.entries(key).filter(([, k]) => k.repeat_of).map(([pid, k]) => [verdicts.get(pid), verdicts.get(k.repeat_of)]).filter(([a, b]) => a && b);
  const same = (f) => reps.filter(([a, b]) => f(a) === f(b)).length;
  const judgeNoise = {
    pairs: reps.length, same_fidelity: same((v) => v.fidelity), fidelity_within_1: reps.filter(([a, b]) => Math.abs(a.fidelity - b.fidelity) <= 1).length,
    same_fid_ge4: same((v) => v.fidelity >= 4), same_omission: same((v) => !!v.flags.omission), same_invention: same((v) => !!v.flags.invention),
  };

  const OUT = {
    fid_ge4: (v) => v.fidelity >= 4, omission: (v) => !!v.flags.omission, invention: (v) => !!v.flags.invention,
    any_major: (v) => v.defects.some((d) => d.severity === 'major'), fid_le2: (v) => v.fidelity <= 2,
    garble_passthrough: (v) => !!v.flags.garble_passthrough, untranslated: (v) => !!v.flags.untranslated, truncated: (v) => !!v.flags.truncated,
  };
  const PRIMARY = ['fid_ge4', 'omission', 'invention'];
  const cell = new Map();
  for (const [pid, k] of Object.entries(key)) {
    if (k.repeat_of) continue;
    const v = verdicts.get(pid); if (!v) continue;
    (cell.get(k.id) || cell.set(k.id, {}).get(k.id))[k.arm] = v;
  }
  const complete = [...cell.entries()].filter(([, c]) => ARMS.every((a) => c[a])).map(([id, c]) => ({ id, s: sample.get(id), c }));

  /** Paired comparison y − x on one binary outcome or on fidelity, over `rows`. */
  const paired = (rows, x, y, f) => {
    const d = rows.map((r) => Number(f(r.c[y])) - Number(f(r.c[x])));
    const up = d.filter((v) => v > 0).length, down = d.filter((v) => v < 0).length;
    resetSeed(SEED);
    const ci = bootstrapCI(d);
    return { delta: +mean(d).toFixed(4), ci: ci && ci.map((v) => +v.toFixed(4)), [`${y}_higher`]: up, [`${x}_higher`]: down, ties: d.length - up - down, sign_p: +binomTwoSided(up, up + down).toFixed(4) };
  };
  const block = (rows) => {
    const out = { n_books: rows.length, arms: {}, primary: {}, secondary: {} };
    for (const a of ARMS) {
      out.arms[a] = { mean_fidelity: +mean(rows.map((r) => r.c[a].fidelity)).toFixed(3), dist: [1, 2, 3, 4, 5].map((k) => rows.filter((r) => r.c[a].fidelity === k).length) };
      for (const [name, f] of Object.entries(OUT)) out.arms[a][name] = pct(rows.filter((r) => f(r.c[a])).length / rows.length);
    }
    for (const [name, f] of Object.entries(OUT)) {
      const cmp = { F_minus_L1: paired(rows, 'L1', 'F', f), floor_L2_minus_L1: paired(rows, 'L1', 'L2', f), replication_F_minus_L2: paired(rows, 'L2', 'F', f) };
      if (PRIMARY.includes(name)) {
        const a = cmp.F_minus_L1, b = cmp.replication_F_minus_L2, fl = cmp.floor_L2_minus_L1;
        const excl = (c) => !!c.ci && ((c.ci[0] > 0 && c.ci[1] > 0) || (c.ci[0] < 0 && c.ci[1] < 0));
        cmp.rule = {
          ci_excludes_0: excl(a), replication_excludes_0_same_sign: excl(b) && Math.sign(b.delta) === Math.sign(a.delta), above_floor: Math.abs(a.delta) > Math.abs(fl.delta),
        };
        cmp.rule.model_makes_a_difference = cmp.rule.ci_excludes_0 && cmp.rule.replication_excludes_0_same_sign && cmp.rule.above_floor;
        out.primary[name] = cmp;
      } else out.secondary[name] = cmp;
    }
    const fid = (v) => v.fidelity;
    out.fidelity = { F_vs_L1: paired(rows, 'L1', 'F', fid), floor_L2_vs_L1: paired(rows, 'L1', 'L2', fid), replication_F_vs_L2: paired(rows, 'L2', 'F', fid) };
    return out;
  };
  const group = (f) => Object.fromEntries([...new Set(complete.map(f))].sort().map((g) => [g, block(complete.filter((r) => f(r) === g))]));

  // Failed reads, and the sensitivity row: a failed read scored as fidelity < 4, over every sampled page.
  const outcomes = Object.fromEntries(ARMS.map((a) => [a, {}]));
  for (const r of armRows) outcomes[r.arm][r.outcome] = (outcomes[r.arm][r.outcome] || 0) + 1;
  const textOf = new Map(armRows.map((r) => [`${r.id}:${r.arm}`, r]));
  const sens = [...sample.values()].filter((s) => ARMS.every((a) => !textOf.get(`${s.id}:${a}`)?.text || cell.get(s.id)?.[a]));
  const fid4All = (id, a) => (cell.get(id)?.[a] ? cell.get(id)[a].fidelity >= 4 : false);
  const sensitivity = { n_books: sens.length, fid_ge4: Object.fromEntries(ARMS.map((a) => [a, pct(sens.filter((s) => fid4All(s.id, a)).length / Math.max(1, sens.length))])) };
  { const d = sens.map((s) => Number(fid4All(s.id, 'F')) - Number(fid4All(s.id, 'L1'))); resetSeed(SEED); const ci = bootstrapCI(d); sensitivity.F_minus_L1 = { delta: +mean(d).toFixed(4), ci: ci && ci.map((v) => +v.toFixed(4)) }; }

  // Worst pages per arm, and the pages where the arms differ most — to be read, not just counted.
  const worst = (a) => complete.slice().sort((p, q) => p.c[a].fidelity - q.c[a].fidelity).slice(0, 5).map((r) => ({ id: r.id, language: r.s.language, url: r.s.url, fidelity: Object.fromEntries(ARMS.map((x) => [x, r.c[x].fidelity])), reason: r.c[a].reason }));
  const gaps = complete.map((r) => ({ r, g: r.c.F.fidelity - (r.c.L1.fidelity + r.c.L2.fidelity) / 2 })).sort((p, q) => Math.abs(q.g) - Math.abs(p.g)).slice(0, 12)
    .map(({ r, g }) => ({ id: r.id, language: r.s.language, url: r.s.url, fidelity: Object.fromEntries(ARMS.map((x) => [x, r.c[x].fidelity])), F_minus_lite: g, F_reason: r.c.F.reason, L1_reason: r.c.L1.reason }));

  const report = {
    at: new Date().toISOString(), issue: 5274, measure: 'judged', judge: 'claude-opus (subagents), translation-corpus-audit/JUDGE-PROMPT.md',
    sampled_books: sample.size, complete_books: complete.length, verdicts: { expected, read: verdicts.size, malformed: bad },
    outcomes, cost_usd: +batch.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0).toFixed(4), judge_noise: judgeNoise,
    all: block(complete), by_script_class: group((r) => r.s.script_class), by_language: group((r) => r.s.language),
    by_audit_arm: group((r) => `served-by-${r.s.audit_arm}`), sensitivity_failed_read_is_below_4: sensitivity,
    worst_by_arm: Object.fromEntries(ARMS.map((a) => [a, worst(a)])), largest_gaps: gaps,
  };
  fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify(report, null, 2));

  const pp = (c) => `${(100 * c.delta).toFixed(1)} pp [${c.ci ? c.ci.map((v) => (100 * v).toFixed(1)).join(', ') : '—'}]`;
  const line = (label, b) => {
    console.log(`\n${label} (n = ${b.n_books} books)`);
    for (const name of PRIMARY) {
      const c = b.primary[name];
      console.log(`  ${name.padEnd(10)} L1 ${b.arms.L1[name]}%  L2 ${b.arms.L2[name]}%  F ${b.arms.F[name]}%   F−L1 ${pp(c.F_minus_L1)} (${c.F_minus_L1.F_higher} vs ${c.F_minus_L1.L1_higher}, p ${c.F_minus_L1.sign_p})   floor L2−L1 ${pp(c.floor_L2_minus_L1)}   F−L2 ${pp(c.replication_F_minus_L2)}   → ${c.rule.model_makes_a_difference ? 'DIFFERENCE' : 'no measurable difference'}`);
    }
    const f = b.fidelity;
    console.log(`  fidelity   mean L1 ${b.arms.L1.mean_fidelity} L2 ${b.arms.L2.mean_fidelity} F ${b.arms.F.mean_fidelity}   F vs L1: ${f.F_vs_L1.F_higher} wins / ${f.F_vs_L1.L1_higher} losses / ${f.F_vs_L1.ties} ties (p ${f.F_vs_L1.sign_p})   floor L2 vs L1: ${f.floor_L2_vs_L1.L2_higher} / ${f.floor_L2_vs_L1.L1_higher} / ${f.floor_L2_vs_L1.ties}`);
  };
  console.log(`verdicts ${verdicts.size}/${expected} (${bad} malformed); complete pages ${complete.length}/${sample.size}; outcomes ${JSON.stringify(outcomes)}; cost $${report.cost_usd}`);
  console.log(`judge repeats: ${judgeNoise.same_fidelity}/${judgeNoise.pairs} same fidelity, ${judgeNoise.fidelity_within_1}/${judgeNoise.pairs} within 1, ≥4 agrees ${judgeNoise.same_fid_ge4}, omission agrees ${judgeNoise.same_omission}, invention agrees ${judgeNoise.same_invention}`);
  line('ALL', report.all);
  for (const [k, b] of Object.entries(report.by_script_class)) line(k, b);
  for (const [k, b] of Object.entries(report.by_language)) line(k, b);
}

const phase = ['draw', 'submit', 'collect', 'packets', 'score'].find(has);
if (!phase) { console.error('pass one of --draw --submit --collect --packets --score'); process.exit(1); }
await ({ draw: phaseDraw, submit: phaseSubmit, collect: phaseCollect, packets: phasePackets, score: phaseScore })[phase]();
