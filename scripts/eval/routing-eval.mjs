#!/usr/bin/env node
// PRIOR ART: scripts/eval/hidden-flash-5795/{seal,arms,score,adjudication-packet}.mjs — the four one-off
// scripts this generalises (five families, two arm names, one rule, all hard-coded); scripts/eval/
// per-language-suitability.mjs — lite scored against flash as the reference, no label check, no
// blind adjudication, no rule file; scripts/eval/benchmark-cost-lane.mjs — a margin rule, but on
// reference CER. None takes "a script, two engines, a rule" and returns a verdict.
/**
 * routing-eval.mjs — which engine should read this script? One sealed, preregistered eval per run:
 * population → sealed one-page-per-book draw → label check by eye → engine arms on identical bytes →
 * character agreement → blind A/B adjudication of the most-disagreeing pages → a rule file applied mechanically.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/routing-eval.mjs run --run hebrew-5900 \
 *        --family heb --issue 5900 [--spend-cap 3]
 *
 * `run` does every step whose inputs exist and stops at the first one that needs a person, saying
 * what to do; run it again afterwards. Steps, each also a subcommand:
 *   init        write routing-eval/runs/<run>.json from --family/--filter flags (run does this if it is missing)
 *   seal        one interior page from up to N books per group, image bytes pinned by sha256. READ-ONLY on Mongo.
 *   labels      a label-check packet (image paths + the definitions); the reader writes <results>/labels-pass1.jsonl
 *   arms        every arm on the sealed bytes, production OCR prompt (hash asserted on every start). THE ONLY
 *               STEP THAT CALLS A MODEL. Refuses without --spend-cap <usd>, without a spend envelope named
 *               after the run (set-scope.mjs), and while the seal, labels, run file or rule files are uncommitted.
 *   score       catastrophic per arm (Wilson), agreementChars, adjudication picks → <results>/results.json
 *   adjudicate  writes the A/B key to <results>/adjudication-key.json; once that is COMMITTED, writes the
 *               blinded packets. The reader writes <results>/adjudication.json.
 *   decide      applies each rule file to results.json → <results>/routing-eval.json + .md. No Mongo, no
 *               model, $0: `decide --results <results.json> --rule <file> [--rule <file>]` replays a stored run.
 *
 * Writes nothing to books or pages. Mongo is read in `seal` (books, pages) and `arms` (the prompt,
 * the spend envelope; usage rows are metered under the pseudo book id = the run id).
 * An arm that is not a Gemini model is supplied as files: <work>/out/<arm>/<slug>.json with
 * { slug, arm, model, text, finishReason, attempts: [], image_sha256 }; `arms` skips files that exist.
 * How to run a new script's eval, and what each file means: scripts/eval/routing-eval/README.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { makeRng } from './lib/paired-stats.mjs';
import { wilson95, groupInputs, applyRule, negativeControl } from './lib/routing-rules.mjs';

const argv = process.argv.slice(2);
const CMD = argv[0];
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const opts = (n) => argv.flatMap((a, i) => (a === `--${n}` ? [argv[i + 1]] : []));
const has = (n) => argv.includes(`--${n}`);
const RUNS = 'scripts/eval/routing-eval/runs';
const DEFAULT_RULE = 'scripts/eval/routing-eval/rules/margin-v1.json';
const DEFAULT_ARMS = { lite: 'gemini-3.1-flash-lite', flash: 'gemini-3-flash-preview' };
const GEN = { temperature: 0, maxOutputTokens: 16384, thinkingBudget: 0 };
const USD_PER_CALL = 0.0056; // #5795: $1.35 over 242 realtime calls, both engines
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1) + '\n'); };
const shuffle = (a, rng) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const quantile = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i); return +(s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo)).toFixed(3); };
const stop = (msg) => { console.log(`\nSTOP — ${msg}`); return false; };
/** Tracked and identical to HEAD: the preregistration test for a file. */
function committed(file) {
  try { execFileSync('git', ['ls-files', '--error-unmatch', file], { stdio: 'pipe' }); } catch { return false; }
  return execFileSync('git', ['status', '--porcelain', '--', file]).toString().trim() === '';
}

// ── run file ─────────────────────────────────────────────────────────────────────────────────────
function loadRun() {
  const id = opt('run');
  if (!id) { console.error('--run <id> is required'); process.exit(2); }
  const file = path.join(RUNS, `${id}.json`);
  if (!fs.existsSync(file)) {
    if (CMD !== 'init' && CMD !== 'run') { console.error(`${file} does not exist — routing-eval.mjs init --run ${id} --family <code>`); process.exit(2); }
    const families = opt('family') ? opt('family').split(',') : null;
    const filter = opt('filter') ? JSON.parse(opt('filter')) : null;
    if (!families && !filter) { console.error('a new run needs --family <code[,code]> (codeFamily of the first language) or --filter \'<mongo filter>\''); process.exit(2); }
    const issue = opt('issue') ? Number(opt('issue')) : null;
    const arms = opt('arms') ? Object.fromEntries(opt('arms').split(',').map((a) => { const [k, v] = a.split('='); return [k, v || DEFAULT_ARMS[k]]; })) : DEFAULT_ARMS;
    const names = Object.keys(arms);
    writeJson(file, {
      run_id: id, issue,
      population: { ...(families ? { families } : { filter, group: opt('group', 'all') }), visibility: opt('visibility', 'hidden'), ocr_owed: !has('include-read'), exclude_held: true, created_before: opt('created-before', null) },
      n_per_group: Number(opt('n', 30)), seed: Number(opt('seed', issue ?? 5828)),
      arms, baseline: opt('baseline', names[0]), candidate: opt('candidate', names[names.length - 1]),
      adjudication_k: Number(opt('k', 10)), rules: opts('rule').length ? opts('rule') : [DEFAULT_RULE],
      results_dir: `scripts/eval/results/${id}`, work_dir: opt('work', `/data/scratch/sl/${id}-work`),
    });
    console.log(`wrote ${file}`);
  }
  const run = readJson(file);
  return { ...run, file, RES: run.results_dir, WORK: opt('work', run.work_dir) };
}
const groupsOf = (run) => run.population.families ?? [run.population.group ?? 'all'];

// ── seal ─────────────────────────────────────────────────────────────────────────────────────────
// Population per group, as #5795 fixed it: family = codeFamily of the FIRST language of books.language
// (the test isFlashOcrBook applies). Books sorted by id and shuffled with makeRng(seed + group index);
// walked until N have a sealed page. Page: interior (first and last 10 % of leaves dropped), pages with
// no stored OCR first; the first of three candidates whose image fetches is sealed, as production
// fetches it (getPageSource, 1500 px, JPEG q80). No content screen: a blank or mislabelled leaf is
// part of the answer.
async function seal(run) {
  const { MongoClient } = await import('mongodb');
  const { toLanguageCodes, codeFamily } = await import('../lib/language-normalize.mjs');
  const { getPageSource } = await import('../lib/page-image-url.mjs');
  const { fetchImageBase64 } = await import('./ocr-v18-ab.mjs');
  const P = run.population; const groups = groupsOf(run); const N = run.n_per_group;
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect(); const db = client.db('bookstore');
  const q = { pages_count: { $gt: 0 }, ...(P.filter || {}) };
  if (P.visibility === 'hidden') q.visible = { $ne: true }; else if (P.visibility === 'visible') q.visible = true;
  if (P.created_before) q.created_at = { $lt: new Date(P.created_before) };
  const pop = Object.fromEntries(groups.map((g) => [g, []])); const heldOut = Object.fromEntries(groups.map((g) => [g, 0]));
  for await (const b of db.collection('books').find(q, { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, pages_count: 1, pages_ocr: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, 'image_source.provider': 1, created_at: 1 } })) {
    const first = toLanguageCodes(b.language).codes[0];
    const g = P.families ? (first ? codeFamily(first) : null) : groups[0];
    if (!pop[g]) continue;
    if (P.ocr_owed && !((b.pages_count || 0) > (b.pages_ocr || 0))) continue;
    if (P.exclude_held && (b.pipeline_auto?.hold || b.pipeline_auto?.status === 'held')) { heldOut[g]++; continue; }
    pop[g].push(b);
  }
  fs.mkdirSync(path.join(run.WORK, 'images'), { recursive: true });
  const sealed = []; const skipped = []; const population = {};
  for (const [gi, g] of groups.entries()) {
    const rng = makeRng(run.seed + gi); const books = shuffle(pop[g].sort((a, b) => String(a.id).localeCompare(String(b.id))), rng);
    population[g] = { books: books.length, pages_owed: books.reduce((s, b) => s + Math.max(0, b.pages_count - (b.pages_ocr || 0)), 0), held_excluded: heldOut[g] };
    let k = 0;
    for (const b of books) {
      if (k >= N) break;
      const pages = await db.collection('pages').find({ book_id: b.id }, { projection: { id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1, 'ocr.model': 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
      const trim = pages.length >= 6 ? Math.max(2, Math.ceil(pages.length * 0.1)) : pages.length >= 3 ? 1 : 0;
      const interior = pages.slice(trim, pages.length - trim).filter((p) => getPageSource(p));
      const hasOcr = (p) => !!(p.ocr?.data && String(p.ocr.data).trim());
      const cands = [...shuffle(interior.filter((p) => !hasOcr(p)), rng), ...shuffle(interior.filter(hasOcr), rng)].slice(0, 3);
      let got = null; const errs = [];
      for (const p of cands) {
        try { const img = await fetchImageBase64(getPageSource(p)); got = { p, img }; break; } catch (e) { errs.push(`${p.page_number}: ${String(e.message).slice(0, 80)}`); }
      }
      if (!got) { skipped.push({ family: g, book_id: b.id, reason: pages.length === 0 ? 'no page rows' : interior.length === 0 ? 'no interior page with an image' : `image fetch failed (${errs.join('; ')})` }); continue; }
      k++; const slug = `${g}-${String(k).padStart(2, '0')}`; const buf = Buffer.from(got.img.data, 'base64');
      fs.writeFileSync(path.join(run.WORK, 'images', `${slug}.jpg`), buf);
      sealed.push({ slug, family: g, book_id: b.id, title: b.display_title || b.title || null, author: b.author || null, year: b.year ?? b.published ?? null, language: b.language,
        provider: b.image_source?.provider || null, pipeline_status: b.pipeline_auto?.status || null, pages_count: b.pages_count, pages_ocr: b.pages_ocr || 0, page_rows: pages.length,
        page_number: got.p.page_number, page_id: got.p.id, page_has_ocr: hasOcr(got.p), page_ocr_model: got.p.ocr?.model || null,
        image: getPageSource(got.p), image_mime: got.img.mimeType, image_bytes: buf.length, image_sha256: sha256(buf) });
      console.log(slug, b.id, `p${got.p.page_number}/${pages.length}`, hasOcr(got.p) ? 'has-ocr' : 'no-ocr', String(b.language));
    }
  }
  await client.close();
  writeJson(`${run.RES}/sealed.json`, { issue: run.issue, run_id: run.run_id, sealed_at: new Date().toISOString(), seed: run.seed, n_per_group: N, population_spec: P, population, sealed, skipped });
  console.log(JSON.stringify(population), 'sealed', sealed.length, 'skipped', skipped.length);
}

// ── label packet ─────────────────────────────────────────────────────────────────────────────────
function labelPacket(run) {
  const sealed = readJson(`${run.RES}/sealed.json`).sealed; const dir = path.join(run.WORK, 'label');
  fs.mkdirSync(dir, { recursive: true });
  const byGroup = Object.groupBy(sealed, (p) => p.family);
  for (const [g, ps] of Object.entries(byGroup)) {
    fs.writeFileSync(path.join(dir, `${g}.md`), `# Label check — ${g} (${run.run_id})

Open every image. Do NOT open any OCR output first: the arms have not run. One JSON line per page, appended to
\`${run.RES}/labels-pass1.jsonl\`:

    {"slug":"…","page_class":"text|blank|picture|binding","observed_script":"…","observed_language":"…","evidence":"words read off the leaf, quoted","label_ok":"yes|no|unsure|n/a","confidence":"high|medium|low","note":"…","pass":1}

- \`yes\`: the leaf's main text is in the tagged language (any script it is written in; a commentary in the same language counts).
- \`no\`: the main text is another language. A leaf in two languages is \`yes\` when the tagged one carries at least half.
- \`n/a\`: no running text (blank, picture, binding). \`page_class\` is then not \`text\`.
- \`unsure\`: the language cannot be told from the image with confidence. Give the reason. It counts as NOT correct:
  a label nobody can confirm is not evidence for spending on it.

| slug | tagged | book | page | image |
|---|---|---|---:|---|
${ps.map((p) => `| ${p.slug} | ${p.language} | ${String(p.title || '').replace(/\|/g, '/').slice(0, 70)} | ${p.page_number} | ${run.WORK}/images/${p.slug}.jpg |`).join('\n')}
`);
  }
  console.log(`label packets: ${dir}/{${Object.keys(byGroup).join(',')}}.md (${sealed.length} pages)`);
}

// ── arms: THE ONLY STEP THAT CALLS A MODEL ───────────────────────────────────────────────────────
// Request, as #5795 fixed it: live default OCR prompt + the production document-context line, temperature 0,
// thinkingBudget 0, 16,384 output tokens, production safety settings, the sealed JPEG (sha256 checked). One
// retry on a refusal; every attempt kept. Resumable: an existing <work>/out/<arm>/<slug>.json is skipped.
async function arms(run) {
  const cap = Number(opt('spend-cap', NaN));
  if (!Number.isFinite(cap) || cap <= 0) { console.error('arms calls a model and refuses without --spend-cap <usd>'); process.exit(2); }
  const prereg = [run.file, `${run.RES}/sealed.json`, `${run.RES}/labels-pass1.jsonl`, ...run.rules].filter((f) => !committed(f));
  if (prereg.length) { console.error(`not committed, so not preregistered — commit before any engine call:\n  ${prereg.join('\n  ')}`); process.exit(2); }
  const { MongoClient } = await import('mongodb');
  const { callGemini } = await import('../lib/gemini-script-client.mjs');
  const { costOf } = await import('../lib/model-pricing.mjs');
  const { getScopeSpendUsd } = await import('../lib/spend-guard.mjs');
  const { getProductionOcrPrompt } = await import('./lib/production-prompt.mjs');
  const { REFUSAL_REASONS } = await import('./lib/refusals.mjs');
  const { docContext, SAFETY } = await import('./ocr-v18-ab.mjs');
  const SCOPE = run.run_id; const ENDPOINT = 'scripts/eval/routing-eval.mjs'; const CONC = Number(opt('concurrency', 4));
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect(); const db = client.db('bookstore');
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  const env = control?.allow_scopes?.[SCOPE];
  if (!env?.budget_usd) { console.error(`no "${SCOPE}" spend envelope — create it with set-scope.mjs first`); process.exit(2); }
  const meter = await getScopeSpendUsd(db, { ids: [SCOPE], since: new Date(env.created_at) });
  if (meter.meterError) { console.error(`envelope meter unreadable (${meter.meterError}) — refusing`); process.exit(2); }
  const budget = Math.min(cap, env.budget_usd);

  const prompt = await getProductionOcrPrompt(db);
  const pin = { name: prompt.name, version: prompt.version, content_hash: prompt.content_hash ?? null, text_sha256: sha256(prompt.text), rules: Object.fromEntries(run.rules.map((f) => [f, sha256(fs.readFileSync(f))])) };
  const pinFile = `${run.RES}/prompt.json`;
  if (fs.existsSync(pinFile)) {
    const was = readJson(pinFile);
    if (was.text_sha256 !== pin.text_sha256 || was.content_hash !== pin.content_hash) { console.error(`production OCR prompt changed since the first call (${was.version}/${was.text_sha256.slice(0, 12)} → ${pin.version}/${pin.text_sha256.slice(0, 12)}) — refusing`); process.exit(2); }
  } else writeJson(pinFile, pin);
  console.log(`prompt "${pin.name}" v${pin.version} content_hash ${pin.content_hash} text_sha256 ${pin.text_sha256.slice(0, 16)}; envelope $${meter.usd.toFixed(4)} / $${budget}`);

  const sealed = readJson(`${run.RES}/sealed.json`).sealed;
  const jobs = sealed.flatMap((p) => Object.keys(run.arms).map((arm) => [arm, p]));
  const isRefusal = (r) => REFUSAL_REASONS.test(r.finishReason || '') || (!String(r.text || '').trim() && r.finishReason !== 'STOP');
  async function once(model, text, data, slug) {
    for (let a = 1; ; a++) {
      try {
        return await callGemini({ model, prompt: text, imageParts: [{ mimeType: 'image/jpeg', data }], endpoint: ENDPOINT, type: 'eval', bookId: SCOPE, pageIds: [slug],
          thinkingBudget: GEN.thinkingBudget, temperature: GEN.temperature, maxOutputTokens: GEN.maxOutputTokens, safetySettings: SAFETY, promptVersion: `ocr-v${prompt.version}`, triggeredBy: SCOPE });
      } catch (e) { if (a >= 4 || !/Gemini (503|429|500)|timeout|aborted|fetch failed/i.test(String(e.message))) throw e; await new Promise((ok) => setTimeout(ok, 6000 * a)); }
    }
  }
  let spent = 0, done = 0, halted = false; const q = [...jobs];
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (q.length) {
      const [arm, p] = q.shift(); const f = path.join(run.WORK, 'out', arm, `${p.slug}.json`);
      if (fs.existsSync(f) || halted) continue;
      if (meter.usd + spent >= budget) { halted = true; console.log(`STOP: envelope $${(meter.usd + spent).toFixed(4)} ≥ $${budget}`); continue; }
      fs.mkdirSync(path.dirname(f), { recursive: true });
      try {
        if (!/^gemini/i.test(run.arms[arm])) throw new Error(`arm "${arm}" (${run.arms[arm]}) is not a Gemini model: supply its outputs as files (see the header)`);
        const buf = fs.readFileSync(path.join(run.WORK, 'images', `${p.slug}.jpg`));
        if (sha256(buf) !== p.image_sha256) throw new Error('image bytes differ from the seal');
        const text = `${prompt.text}${docContext({ title: p.title, author: p.author, year: typeof p.year === 'number' ? p.year : null })}`;
        const attempts = [];
        for (let i = 0; i < 2; i++) {
          const r = await once(run.arms[arm], text, buf.toString('base64'), p.slug);
          const cost = costOf(run.arms[arm], r.inputTokens, r.outputTokens); spent += cost;
          attempts.push({ text: r.text, finishReason: r.finishReason, inputTokens: r.inputTokens, outputTokens: r.outputTokens, thinkingTokens: r.thinkingTokens ?? 0, cost_usd_realtime: cost, at: new Date().toISOString() });
          if (!isRefusal(r)) break;
        }
        const last = attempts[attempts.length - 1];
        writeJson(f, { slug: p.slug, arm, model: run.arms[arm], text: last.text, finishReason: last.finishReason, retried: attempts.length > 1, attempts, prompt: pin, generation: GEN, image_sha256: p.image_sha256 });
        done++; if (done % 20 === 0) console.log(`${done} done, $${spent.toFixed(4)} this run`);
      } catch (e) { writeJson(f.replace(/\.json$/, '.failed.json'), { slug: p.slug, arm, error: String(e.message).slice(0, 400) }); console.log(`${arm} ${p.slug} FAILED ${String(e.message).slice(0, 160)}`); }
    }
  }));
  console.log(`arms: ${done} new reads, $${spent.toFixed(4)} realtime this run, envelope before $${meter.usd.toFixed(4)}`);
  await client.close();
}

// ── score ────────────────────────────────────────────────────────────────────────────────────────
// Catastrophic, per engine per page: `refusal` (a refusal finishReason with no transcription body),
// `loop` (the production loop guard refuses the output, or MAX_TOKENS), `empty` (no letters on a page
// that by eye carries text). Agreement is agreementChars between candidate and baseline; it selects
// the adjudication pages and is not in any rule.
async function score(run) {
  const { agreementChars, toAgreementChars } = await import('./lib/metrics.mjs');
  const { REFUSAL_REASONS } = await import('./lib/refusals.mjs');
  const { loopVerdict } = await import('../lib/ocr-loop-guard.mjs');
  const ARMS = Object.keys(run.arms); const { candidate: C, baseline: B } = run; const K = run.adjudication_k;
  const sealed = readJson(`${run.RES}/sealed.json`).sealed;
  const labels = new Map(readJsonl(`${run.RES}/labels-pass1.jsonl`).map((x) => [x.slug, x]));
  const adjFile = `${run.RES}/adjudication.json`; const adj = fs.existsSync(adjFile) ? new Map(readJson(adjFile).pages.map((x) => [x.slug, x])) : null;
  const stored = Object.fromEntries(ARMS.map((a) => [a, fs.existsSync(`${run.RES}/outputs-${a}.jsonl`) ? new Map(readJsonl(`${run.RES}/outputs-${a}.jsonl`).map((x) => [x.slug, x])) : null]));
  const load = (arm, slug) => { const f = path.join(run.WORK, 'out', arm, `${slug}.json`); if (fs.existsSync(f)) return readJson(f); const o = stored[arm]?.get(slug); if (!o) throw new Error(`no output for ${arm} ${slug} (looked in ${f} and ${run.RES}/outputs-${arm}.jsonl)`); return o; };
  const outs = Object.fromEntries(ARMS.map((a) => [a, []])); const pages = []; let usd = 0; let calls = 0;
  for (const p of sealed) {
    const lab = labels.get(p.slug); if (!lab) throw new Error(`no label for ${p.slug}`);
    const hasText = lab.page_class === 'text';
    const row = { slug: p.slug, family: p.family, book_id: p.book_id, page_number: p.page_number, page_class: lab.page_class, label_ok: lab.label_ok, arms: {} };
    const text = {};
    for (const arm of ARMS) {
      const o = load(arm, p.slug); text[arm] = o.text || '';
      outs[arm].push({ slug: o.slug, arm, model: o.model, finishReason: o.finishReason, retried: o.retried, attempts: o.attempts, prompt: o.prompt, generation: o.generation, image_sha256: o.image_sha256, text: o.text });
      for (const a of o.attempts || []) { usd += a.cost_usd_realtime || 0; calls++; }
      const letters = toAgreementChars(o.text).length; const lv = loopVerdict(o.text || '');
      const kind = REFUSAL_REASONS.test(o.finishReason || '') && !letters ? 'refusal' : (lv.refuse || o.finishReason === 'MAX_TOKENS') ? 'loop' : (!letters && hasText) ? 'empty' : null;
      row.arms[arm] = { finishReason: o.finishReason, retried: !!o.retried, chars: text[arm].length, letters, outputTokens: o.attempts?.at(-1)?.outputTokens ?? null, loop_share: lv.share ?? 0, catastrophic: kind };
    }
    const a = agreementChars(text[B], text[C]);
    row.agreement_chars = a == null ? null : +a.toFixed(4);
    row.adjudication_key = hasText ? ((row.arms[B].catastrophic || row.arms[C].catastrophic) ? 0 : (a ?? 0)) : null;
    if (adj?.has(p.slug)) row.adjudication = adj.get(p.slug);
    pages.push(row);
  }
  for (const arm of ARMS) fs.writeFileSync(`${run.RES}/outputs-${arm}.jsonl`, outs[arm].map((x) => JSON.stringify(x)).join('\n') + '\n');
  const hashes = new Set(ARMS.flatMap((a) => outs[a].map((x) => x.prompt?.text_sha256)).filter(Boolean));
  if (hashes.size > 1) throw new Error('prompt hash differs across calls');

  const families = {}; const picks = {};
  for (const g of groupsOf(run)) {
    const P = pages.filter((x) => x.family === g); const T = P.filter((x) => x.page_class === 'text'); const yes = T.filter((x) => x.label_ok === 'yes').length;
    const cat = Object.fromEntries(ARMS.map((arm) => { const k = P.filter((x) => x.arms[arm].catastrophic); const by = {}; for (const x of k) by[x.arms[arm].catastrophic] = (by[x.arms[arm].catastrophic] || 0) + 1; return [arm, { count: k.length, n: P.length, wilson95: wilson95(k.length, P.length), by_kind: by, slugs: k.map((x) => x.slug) }]; }));
    const ag = T.map((x) => x.agreement_chars).filter((x) => x != null);
    const pick = [...T].sort((a, b) => a.adjudication_key - b.adjudication_key || a.slug.localeCompare(b.slug)).slice(0, K).map((x) => x.slug); picks[g] = pick;
    const A = adj ? pick.map((s) => adj.get(s)).filter(Boolean) : [];
    const tally = Object.fromEntries([...ARMS, 'both', 'neither', 'cannot_tell'].map((k) => [k, 0])); for (const x of A) tally[x.verdict]++;
    const invented = Object.fromEntries(ARMS.map((arm) => [`${arm}_invented`, adj ? [...adj.values()].filter((x) => x.family === g && x[`${arm}_invented`]).map((x) => x.slug) : []]));
    families[g] = { sealed: P.length, with_text: T.length,
      label: { yes, no: T.filter((x) => x.label_ok === 'no').length, unsure: T.filter((x) => x.label_ok === 'unsure').length, na: P.length - T.length, share_yes: T.length ? +(yes / T.length).toFixed(3) : null, wilson95: wilson95(yes, T.length), not_yes: T.filter((x) => x.label_ok !== 'yes').map((x) => ({ slug: x.slug, book_id: x.book_id, label_ok: x.label_ok })) },
      catastrophic: cat, agreement_chars: { n: ag.length, median: quantile(ag, 0.5), q1: quantile(ag, 0.25), q3: quantile(ag, 0.75), min: quantile(ag, 0) },
      adjudication: adj ? { pages: pick.length, judged: A.length, ...tally, ...invented } : null };
  }
  writeJson(path.join(run.WORK, 'adjudication-picks.json'), picks);
  writeJson(`${run.RES}/results.json`, { issue: run.issue, run_id: run.run_id, scored_at: new Date().toISOString(), prompt: outs[B][0]?.prompt ?? null, generation: outs[B][0]?.generation ?? GEN, models: run.arms, baseline: B, candidate: C, spend: { calls, usd_realtime_from_tokens: +usd.toFixed(4) }, families, pages });
  for (const [g, v] of Object.entries(families)) console.log(g, `n ${v.sealed} text ${v.with_text} label ${v.label.yes}/${v.with_text}`, ARMS.map((a) => `cat ${a} ${v.catastrophic[a].count}`).join(' '), `agr med ${v.agreement_chars.median}`, v.adjudication ? JSON.stringify(v.adjudication) : '');
  console.log('calls', calls, 'usd', usd.toFixed(4));
  return picks;
}

// ── blind adjudication: key first, committed, then the packets ───────────────────────────────────
function adjudicate(run) {
  const { candidate: C, baseline: B } = run; const LIMIT = 7000;
  const picks = readJson(path.join(run.WORK, 'adjudication-picks.json'));
  const keyFile = `${run.RES}/adjudication-key.json`;
  if (!fs.existsSync(keyFile)) {
    const rng = makeRng(run.seed * 10); const key = {};
    for (const slugs of Object.values(picks)) for (const slug of slugs) key[slug] = rng() < 0.5 ? { A: C, B } : { A: B, B: C };
    writeJson(keyFile, key);
  }
  if (!committed(keyFile)) return stop(`the A/B key is written but not committed. Commit ${keyFile} (and results.json), then run again: the packets are only written against a committed key.`);
  const key = readJson(keyFile);
  const out = (arm) => new Map(readJsonl(`${run.RES}/outputs-${arm}.jsonl`).map((x) => [x.slug, x]));
  const O = { [C]: out(C), [B]: out(B) };
  const show = (o) => { const t = o.text || ''; const head = `[engine status: ${/^(RECITATION|SAFETY|PROHIBITED_CONTENT)$/.test(o.finishReason) ? 'the engine declined this page, no text' : o.finishReason === 'MAX_TOKENS' ? 'output hit the length limit' : 'finished'}; ${t.length} characters in total]`; return `${head}\n${t.length > LIMIT ? `${t.slice(0, LIMIT)}\n[… ${t.length - LIMIT} more characters not shown …]\n${t.slice(-600)}` : t}`; };
  const dir = path.join(run.WORK, 'adj'); fs.mkdirSync(dir, { recursive: true });
  for (const slugs of Object.values(picks)) for (const slug of slugs) {
    if (!key[slug]) throw new Error(`${slug} is picked but not in the committed key — the picks changed after the key was written`);
    fs.writeFileSync(path.join(dir, `${slug}.md`), `# ${slug}\n\nImage: ${run.WORK}/images/${slug}.jpg\n\n## OUTPUT A\n\n${show(O[key[slug].A].get(slug))}\n\n## OUTPUT B\n\n${show(O[key[slug].B].get(slug))}\n`);
  }
  console.log(Object.entries(picks).map(([g, s]) => `${g}: ${s.join(' ')}`).join('\n'));
  return stop(`blinded packets are in ${dir}/. The reader opens each image beside OUTPUT A and B (never the key) and checks at least three places.
Write ${run.RES}/adjudication.json: { "reader": "…", "pages": [{ "slug", "family", "verdict": "A|B|both|neither|cannot_tell", "A_invented": false, "B_invented": false, "A_invented_quote": null, "B_invented_quote": null, "places_checked": […] }] }
then unblind it with: routing-eval.mjs unblind --run ${run.run_id}   (maps A/B to "${C}"/"${B}" from the committed key), and run again.`);
}

/** Map a reader's A/B verdicts to arm names with the committed key. */
function unblind(run) {
  const f = `${run.RES}/adjudication.json`; const j = readJson(f); const key = readJson(`${run.RES}/adjudication-key.json`);
  for (const p of j.pages) {
    const k = key[p.slug]; if (!k) throw new Error(`${p.slug} not in the key`);
    if (p.blind_key) continue; // already unblinded
    p.blind_key = k; if (p.verdict === 'A' || p.verdict === 'B') p.verdict = k[p.verdict];
    for (const side of ['A', 'B']) for (const suffix of ['invented', 'invented_quote', 'note']) if (`${side}_${suffix}` in p) { p[`${k[side]}_${suffix}`] = p[`${side}_${suffix}`]; delete p[`${side}_${suffix}`]; }
  }
  writeJson(f, j); console.log(`unblinded ${j.pages.length} pages in ${f}`);
}

// ── decide: rule files applied mechanically. No Mongo, no model. ─────────────────────────────────
export function decide(results, rules) {
  const out = { run_id: results.run_id, issue: results.issue ?? null, measure: results.measure ?? 'by eye (label check, blinded A/B adjudication) plus engine-to-engine agreement and a catastrophic count; not accuracy', models: results.models, rules: {}, groups: {} };
  for (const rule of rules) {
    out.rules[rule.id] = { registered: rule.registered ?? null, candidate: rule.candidate, baseline: rule.baseline, min_text_pages: rule.min_text_pages, checks: rule.checks, verdicts: rule.verdicts };
    for (const g of Object.keys(results.families)) {
      const x = groupInputs(results, g, rule);
      (out.groups[g] ||= {})[rule.id] = { ...applyRule(rule, x), negative_control: negativeControl(rule, x) };
    }
  }
  return out;
}
export function decideMarkdown(d) {
  const ids = Object.keys(d.rules); const L = [`# Routing eval — ${d.run_id}${d.issue ? ` (#${d.issue})` : ''}`, '', `measure: ${d.measure}.`, ''];
  L.push(`| group | pages (with text) | label yes / text [Wilson 95 %] | catastrophic ${ids.length ? `${d.rules[ids[0]].baseline} / ${d.rules[ids[0]].candidate}` : ''} | rate difference [95 %] | by eye: wins / losses | invented by candidate | ${ids.map((i) => `**${i}**`).join(' | ')} |`);
  L.push(`|---|---:|---|---|---|---|---|${ids.map(() => '---').join('|')}|`);
  const mark = (v) => (v == null ? '…' : v ? '✓' : '✗');
  for (const [g, byRule] of Object.entries(d.groups)) {
    const any = byRule[ids[0]]; const lab = Object.values(any.checks).find((c) => c.rule === 'labelPrecision');
    const cnt = Object.values(any.checks).find((c) => c.rule === 'countNoWorse' || c.rule === 'rateNonInferior');
    const ni = ids.map((i) => Object.values(byRule[i].checks).find((c) => c.rule === 'rateNonInferior')).find(Boolean);
    const adj = Object.values(any.checks).find((c) => c.rule === 'adjudication');
    L.push(`| ${g} | ${any.n_pages} (${any.n_text}) | ${lab ? `${lab.yes} / ${lab.n}${lab.wilson95 ? ` [${lab.wilson95.join(', ')}]` : ''}` : '—'} | ${cnt ? `${cnt.baseline} / ${cnt.candidate}` : '—'} | ${ni ? `${ni.rate_diff} [${ni.rate_diff_ci95.join(', ')}]` : '—'} | ${adj?.wins ? `${adj.wins.wins} / ${adj.wins.losses}` : 'pending'} | ${adj?.invention ? adj.invention.candidate_invented.length : '—'} | ${ids.map((i) => `${Object.entries(byRule[i].passed).map(([k, v]) => `${k} ${mark(v)}`).join(' ')} → **${byRule[i].verdict}**`).join(' | ')} |`);
  }
  L.push('', '## Negative control', '', 'A candidate inferior by construction: it fails every page the baseline fails, plus a further 20 % of the pages (at least 2). A rule must refuse it; one that does not has no power at this n.', '', `| group | ${ids.join(' | ')} |`, `|---|${ids.map(() => '---').join('|')}|`);
  for (const [g, byRule] of Object.entries(d.groups)) L.push(`| ${g} | ${ids.map((i) => { const c = byRule[i].negative_control; return c ? `${c.candidate_failures != null ? `${c.candidate_failures} failures against ${c.baseline_failures}` : ''}${c.fidelity ? `${c.candidate_failures != null ? '; ' : ''}fidelity: ${c.fidelity.planted_pages} pages set to 1, Δ ${c.fidelity.mean_diff} [${c.fidelity.mean_diff_ci95.join(', ')}]` : ''} → ${c.held ? 'refused ✓' : '**PASSED — the rule has no power here**'}` : 'not applied (n too small)'; }).join(' | ')} |`);
  const tl = ids.flatMap((i) => Object.entries(d.groups).map(([g, r]) => [i, g, Object.values(r[i].checks).find((c) => c.rule === 'translationLift')])).filter(([, , c]) => c?.n);
  if (tl.length) { L.push('', '## Translation lift against a human reference', '', `Mean judge fidelity (1–5) of the Lite English made from each engine's read; Δ = candidate − baseline, paired by page, seeded bootstrap. Passes when the lower bound is at or above −margin.`, '', '| rule | group | n | candidate | baseline | Δ [95 %] | better / same / worse | margin | passes for any margin ≥ |', '|---|---|---:|---:|---:|---|---|---:|---:|'); for (const [i, g, c] of tl) L.push(`| ${i} | ${g} | ${c.n} | ${c.mean_candidate} | ${c.mean_baseline} | ${c.mean_diff} [${c.mean_diff_ci95.join(', ')}] | ${c.better} / ${c.same} / ${c.worse} | ${c.margin} | ${c.max_margin_passed} |`); }
  const mm = ids.flatMap((i) => Object.entries(d.groups).map(([g, r]) => [i, g, Object.values(r[i].checks).find((c) => c.rule === 'rateNonInferior')])).filter(([, , c]) => c);
  if (mm.length) { L.push('', '## How much margin each group needs', '', 'The upper 95 % bound of (candidate rate − baseline rate), paired by page, seeded bootstrap. The margin check passes for any margin at or above it.', '', '| rule | group | n | upper bound | margin in the rule | discordant pages (candidate only / baseline only) |', '|---|---|---:|---:|---:|---|'); for (const [i, g, c] of mm) L.push(`| ${i} | ${g} | ${c.n} | ${c.rate_diff_ci95[1]} | ${c.margin} | ${c.discordant.candidate_only} / ${c.discordant.baseline_only} |`); }
  return L.join('\n') + '\n';
}
function runDecide({ resultsFile, ruleFiles, outBase }) {
  const d = decide(readJson(resultsFile), ruleFiles.map(readJson));
  // A rule file is preregistered when `arms` pinned its hash before the first engine call (prompt.json).
  // null = the run has no pin (it predates this tool, or the rule was written afterwards): post hoc.
  const pinFile = path.join(path.dirname(resultsFile), 'prompt.json'); const pin = fs.existsSync(pinFile) ? readJson(pinFile).rules : null;
  d.inputs = { results: resultsFile, rules: ruleFiles, rule_unchanged_since_arms: Object.fromEntries(ruleFiles.map((f) => [f, pin?.[f] ? pin[f] === sha256(fs.readFileSync(f)) : null])) };
  for (const [f, okay] of Object.entries(d.inputs.rule_unchanged_since_arms)) if (okay !== true) console.log(`NOTE ${f}: ${okay === false ? 'CHANGED since the arms ran' : 'not pinned before the arms ran'} — its verdicts are post hoc unless a preregistration says otherwise`);
  writeJson(`${outBase}.json`, d); fs.writeFileSync(`${outBase}.md`, decideMarkdown(d));
  for (const [g, r] of Object.entries(d.groups)) console.log(g.padEnd(6), Object.entries(r).map(([i, v]) => `${i}: ${v.verdict}`).join('  |  '));
  console.log(`wrote ${outBase}.json and .md`);
}

// ── run: every step whose inputs exist; stop at the first that needs a person ────────────────────
async function runAll(run) {
  const R = run.RES; const armNames = Object.keys(run.arms);
  if (!fs.existsSync(`${R}/sealed.json`)) await seal(run);
  const sealed = readJson(`${R}/sealed.json`).sealed;
  if (!fs.existsSync(`${R}/labels-pass1.jsonl`)) { labelPacket(run); return stop(`label check, by eye. Commit ${run.file} and ${R}/sealed.json, read the packets, write ${R}/labels-pass1.jsonl, commit it, run again.`); }
  const haveOut = (a, s) => fs.existsSync(path.join(run.WORK, 'out', a, `${s}.json`)) || fs.existsSync(`${R}/outputs-${a}.jsonl`);
  const missing = sealed.flatMap((p) => armNames.filter((a) => !haveOut(a, p.slug))).length;
  if (missing) {
    if (!opt('spend-cap')) return stop(`${missing} engine reads are owed (≈ $${(missing * USD_PER_CALL).toFixed(2)} realtime at the #5795 rate, more with retries). This is the only step that spends. Create the "${run.run_id}" envelope with set-scope.mjs and run again with --spend-cap <usd>.`);
    await arms(run);
  }
  const adjFile = `${R}/adjudication.json`;
  if (fs.existsSync(adjFile) && readJson(adjFile).pages.some((p) => !p.blind_key)) unblind(run);
  await score(run);
  if (!fs.existsSync(adjFile)) return adjudicate(run);
  runDecide({ resultsFile: `${R}/results.json`, ruleFiles: run.rules, outBase: `${R}/routing-eval` });
  return true;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  if (CMD === 'decide' && opt('results')) {
    const resultsFile = opt('results');
    runDecide({ resultsFile, ruleFiles: opts('rule').length ? opts('rule') : [DEFAULT_RULE], outBase: opt('out', path.join(path.dirname(resultsFile), 'routing-eval')) });
  } else if (['init', 'seal', 'labels', 'arms', 'score', 'adjudicate', 'unblind', 'decide', 'run'].includes(CMD)) {
    const run = loadRun();
    if (CMD === 'seal') await seal(run);
    else if (CMD === 'labels') labelPacket(run);
    else if (CMD === 'arms') await arms(run);
    else if (CMD === 'score') await score(run);
    else if (CMD === 'adjudicate') adjudicate(run);
    else if (CMD === 'unblind') unblind(run);
    else if (CMD === 'decide') runDecide({ resultsFile: `${run.RES}/results.json`, ruleFiles: opts('rule').length ? opts('rule') : run.rules, outBase: `${run.RES}/routing-eval` });
    else if (CMD === 'run') await runAll(run);
  } else {
    console.error('usage: routing-eval.mjs <run|init|seal|labels|arms|score|adjudicate|unblind|decide> --run <id> [--family <code>] [--spend-cap <usd>]\n       routing-eval.mjs decide --results <results.json> --rule <rule.json> [--rule …] [--out <base>]');
    process.exit(2);
  }
}
