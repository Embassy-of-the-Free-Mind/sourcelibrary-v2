#!/usr/bin/env node
/**
 * Paired, repeated-measures A/B for OCR prompt versions.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * On 2026-09-02 a prompt revision (#4195/#4584) could not be scored: v15 gave
 * body=79 on one run of a blank page and body=0 on the next. With one run per
 * arm there is no way to tell a prompt effect from the sampler. Every prompt
 * change since #3108 has had this problem; this is the instrument that fixes it.
 *
 * ── The estimand ───────────────────────────────────────────────────────────
 * Not "does the output look better" but: DOES THE MODEL PRODUCE CONTENT THE
 * PAGE DOES NOT SUPPORT? We have no ground-truth transcriptions, so that is not
 * directly observable.
 *
 * ── Getting around the missing labels ──────────────────────────────────────
 * Use REPRODUCIBILITY as the proxy, which needs no labels and is already
 * validated in this repo: #4523 measured 87-93% cross-run agreement on printed
 * Latin against 31-35% on Tibetan cursive, where the model was demonstrably
 * fabricating. The logic is one-directional and that is what makes it usable:
 * a genuine reading is reproducible, so LOW agreement is strong evidence of
 * invention. (High agreement is weaker evidence of correctness — a model can
 * be reproducibly wrong, e.g. the DISCURSUS IV. template artifact of #4149.
 * Do not read this metric backwards.)
 *
 * ── Design ─────────────────────────────────────────────────────────────────
 * - PAIRED: both arms see the same pages. Page-to-page variance dwarfs the arm
 *   effect, and pairing removes it.
 * - REPEATED MEASURES: k runs per (page, arm). This is the whole point.
 * - UNIT OF ANALYSIS is the PAGE. The k runs are repeated measures within a
 *   page, not independent observations; reporting them as n=k would fake
 *   precision. Cross-page aggregates average page means, never raw runs.
 * - CONTROLS BOTH WAYS. Positive controls are pages where the defect is known
 *   present — the metric MUST fire on them, or it is measuring nothing.
 *   Negative controls are clean prose — it must NOT fire. A metric that cannot
 *   fire is not a measurement (see .claude/docs/invariants/measurement-instruments.md).
 * - PRE-REGISTERED. The outcomes and the decision rule are fixed in this file
 *   BEFORE the run. Redefining the metric after seeing output is fitting the
 *   metric to the answer — which is exactly how the first pass at this went.
 *
 * ── Pre-registered outcomes, per (page, arm) ───────────────────────────────
 *   agreement   mean pairwise token Jaccard across the k runs' body text.
 *               Reproducibility of the reading. Primary outcome.
 *   body_len    mean and SD of body characters. The SD is the quantity whose
 *               absence caused the original failure.
 *   lacuna/unclear rate, and modal <page-type> plus how often it flips.
 *
 * ── Pre-registered decision rule ───────────────────────────────────────────
 * An arm is better on a positive-control page iff BOTH hold:
 *   (a) mean body_len falls by more than the pooled SD of the two arms, and
 *   (b) agreement does not fall.
 * On a negative control, an arm is acceptable iff mean body_len does not fall
 * by more than the pooled SD. Anything else is "not established" and is
 * reported as such rather than argued around.
 *
 * ── KNOWN FLAW in clause (b), found on the first run — do not silently fix ──
 * Clause (b) ("agreement does not fall") misfires when the BASELINE failure is
 * a deterministic loop. On the #4584 glyph rows v15 scored agreement=1.000 with
 * body=16,264±0: it emits the identical "Ra, Ra, Ra…" loop every time, so it is
 * perfectly reproducible and perfectly wrong. v17 cut that to 348±4 — a change
 * 5,000x the pooled SD — and was scored "shorter, but agreement fell" purely
 * because 0.911 < 1.000.
 *
 * This is the one-directional caveat above, biting in practice: low agreement
 * implies invention, but high agreement does NOT imply a reading. A future rule
 * should use gap-marker rate as the substantive criterion and keep agreement as
 * a diagnostic floor, not a gate. That change is NOT applied here: the verdicts
 * below were produced under the rule as pre-registered, and rewriting the rule
 * after seeing the numbers is the exact failure pre-registration prevents. Fix
 * it in the next revision, prospectively.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   node --env-file=.env.production.local scripts/eval/prompt-ab.mjs \
 *     --a 15 --b 17 --k 5 [--cases lacuna|blank|all] [--out results.json]
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const A_VER = Number(arg('a', 15));
const B_VER = Number(arg('b', 17));
const K = Number(arg('k', 5));
const CASE_SET = arg('cases', 'all');
const OUT = arg('out', null);
const CONCURRENCY = Number(arg('concurrency', 4));

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2;
if (!KEY) throw new Error('no GEMINI_API_KEY');
const MODEL = arg('model', 'gemini-3.1-flash-lite');
const LANG_INSTR = `**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).`;

const BULHAN = '6953b56577f38f6761bd979d';
const ZUNI = '69a565b95a8a09c1b325e47f';
const URK4 = '69e013c593b116d24238b3d7';

/**
 * `control: 'positive'` = the defect is KNOWN present; the metric must fire.
 * `control: 'negative'` = clean page; nothing should change.
 */
const ALL_CASES = [
  { id: 'torn-grid',    set: 'lacuna', control: 'positive', book: BULHAN, page: 60,  note: '#3591 torn mansion grid — completes a closed set' },
  { id: 'hiero-rows',   set: 'lacuna', control: 'positive', book: URK4,   page: 118, note: '#4584 glyph rows — Ra-loop' },
  { id: 'hiero-block',  set: 'lacuna', control: 'positive', book: URK4,   page: 24,  note: '#4584 unread block — invented x+N lines' },
  { id: 'ordinary-en',  set: 'lacuna', control: 'negative', book: ZUNI,   page: 30,  note: 'clean printed English prose' },
  { id: 'cipher',       set: 'lacuna', control: 'negative', book: BULHAN, page: 198, note: '#3591 cipher — must keep declining' },
  { id: 'blank-45',     set: 'blank',  control: 'positive', book: ZUNI,   page: 45,  note: '#4149 blank leaf w/ printer mark' },
  { id: 'blank-72',     set: 'blank',  control: 'positive', book: ZUNI,   page: 72,  note: '#4149 blank leaf' },
  { id: 'faint-mark',   set: 'blank',  control: 'positive', book: BULHAN, page: 4,   note: '#3591 faint mark — must NOT be blank' },
  { id: 'basmala',      set: 'blank',  control: 'positive', book: BULHAN, page: 266, note: '#3591 legible basmala — must NOT be blank' },
  { id: 'cataloguer',   set: 'blank',  control: 'negative', book: BULHAN, page: 197, note: '#3591 Latin note — already correct' },
];
const CASES = CASE_SET === 'all' ? ALL_CASES : ALL_CASES.filter((c) => c.set === CASE_SET);

// ── metrics ────────────────────────────────────────────────────────────────
const APPARATUS = 'meta|summary|keywords|vocab|language|lang|scan-quality|script|page-type|columns|warning|image-desc|lacuna|header|sig|page-num';
const bodyText = (t) => t
  .replace(new RegExp(`<(${APPARATUS})>[\\s\\S]*?<\\/\\1>`, 'gi'), ' ')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (t) => new Set(bodyText(t).toLowerCase().match(/\p{L}[\p{L}\p{M}']*/gu) || []);
const jaccard = (a, b) => {
  if (!a.size && !b.size) return 1;                       // two empty readings agree
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs) => xs.length < 2 ? 0 : Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)) * xs.length / (xs.length - 1));
const tagCount = (t, n) => (t.match(new RegExp(`<${n}>`, 'gi')) || []).length;
const pageType = (t) => (t.match(/<page-type>([^<]*)<\/page-type>/i) || [, '—'])[1].trim();

async function gemini(promptText, b64) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`${BASE}/models/${MODEL}:generateContent?key=${KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }, { inlineData: { mimeType: 'image/jpeg', data: b64 } }] }],
          // temperature left at the pipeline's own setting; we are measuring the
          // sampler's spread, so forcing it to 0 would hide the thing we came for.
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: AbortSignal.timeout(180000),
      });
      const j = await r.json();
      if (r.ok) return j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 3000 * (attempt + 1))); continue; }
      return `__ERROR__ ${r.status}`;
    } catch (e) { await new Promise((s) => setTimeout(s, 3000 * (attempt + 1))); }
  }
  return '__ERROR__ retries exhausted';
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

// ── run ────────────────────────────────────────────────────────────────────
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const col = db.collection('prompts');
const prep = (s) => s.replace('{language_instruction}', LANG_INSTR).replace('{language}', '');
const armPrompt = {};
for (const v of [A_VER, B_VER]) {
  const row = await col.findOne({ type: 'ocr', version: v });
  if (!row) throw new Error(`ocr prompt v${v} not found`);
  armPrompt[v] = prep(row.content);
}

console.log(`model=${MODEL}  arms=v${A_VER} vs v${B_VER}  k=${K}  cases=${CASES.length}  calls=${CASES.length * 2 * K}\n`);

const results = [];
for (const t of CASES) {
  const p = await db.collection('pages').findOne({ book_id: t.book, page_number: t.page });
  if (!p) { console.log(`!! ${t.id}: page not found`); continue; }
  const res = await fetch(p.display_photo || p.photo);
  if (!res.ok) { console.log(`!! ${t.id}: image HTTP ${res.status}`); continue; }
  const b64 = Buffer.from(await res.arrayBuffer()).toString('base64');

  const row = { ...t, arms: {} };
  for (const v of [A_VER, B_VER]) {
    const runs = await pool(Array.from({ length: K }, (_, i) => i), CONCURRENCY, () => gemini(armPrompt[v], b64));
    const ok = runs.filter((r) => !r.startsWith('__ERROR__'));
    if (ok.length < 2) { row.arms[v] = { error: `only ${ok.length} usable runs` }; continue; }
    const lens = ok.map((r) => bodyText(r).length);
    const toks = ok.map(tokens);
    const pairs = [];
    for (let i = 0; i < toks.length; i++) for (let j = i + 1; j < toks.length; j++) pairs.push(jaccard(toks[i], toks[j]));
    const types = ok.map(pageType);
    row.arms[v] = {
      n: ok.length,
      body_mean: Math.round(mean(lens)), body_sd: Math.round(sd(lens)),
      agreement: Number(mean(pairs).toFixed(3)),
      lacuna: Number(mean(ok.map((r) => tagCount(r, 'lacuna'))).toFixed(1)),
      unclear: Number(mean(ok.map((r) => tagCount(r, 'unclear'))).toFixed(1)),
      page_type_modal: types.sort((a, b) => types.filter((x) => x === b).length - types.filter((x) => x === a).length)[0],
      page_type_stable: new Set(types).size === 1,
    };
  }
  const a = row.arms[A_VER], b = row.arms[B_VER];
  if (a?.n && b?.n) {
    const pooled = Math.sqrt((a.body_sd ** 2 + b.body_sd ** 2) / 2);
    row.pooled_sd = Math.round(pooled);
    row.body_delta = b.body_mean - a.body_mean;
    // Pre-registered rule, applied mechanically — not after looking.
    row.verdict = t.control === 'positive'
      ? (row.body_delta < -pooled && b.agreement >= a.agreement ? 'IMPROVED'
        : row.body_delta < -pooled ? 'shorter, but agreement fell' : 'not established')
      : (row.body_delta >= -pooled ? 'unchanged (ok)' : 'REGRESSION');
    console.log(`── ${t.id.padEnd(13)} [${t.control}] ${t.note}`);
    console.log(`   v${A_VER}: body ${String(a.body_mean).padStart(6)} ±${String(a.body_sd).padEnd(5)} agree=${a.agreement}  lacuna=${a.lacuna} unclear=${a.unclear} type=${a.page_type_modal}${a.page_type_stable ? '' : '*'}`);
    console.log(`   v${B_VER}: body ${String(b.body_mean).padStart(6)} ±${String(b.body_sd).padEnd(5)} agree=${b.agreement}  lacuna=${b.lacuna} unclear=${b.unclear} type=${b.page_type_modal}${b.page_type_stable ? '' : '*'}`);
    console.log(`   Δbody=${row.body_delta}  pooled_sd=${row.pooled_sd}  →  ${row.verdict}\n`);
  }
  results.push(row);
}

// Cross-page summary. Averages PAGE means — never raw runs, which would treat
// repeated measures as independent and overstate precision.
const scored = results.filter((r) => r.verdict);
const pos = scored.filter((r) => r.control === 'positive');
const neg = scored.filter((r) => r.control === 'negative');
console.log('═══ summary (unit of analysis = page) ═══');
console.log(`positive controls: ${pos.filter((r) => r.verdict === 'IMPROVED').length}/${pos.length} improved`);
console.log(`negative controls: ${neg.filter((r) => r.verdict === 'unchanged (ok)').length}/${neg.length} unchanged, ${neg.filter((r) => r.verdict === 'REGRESSION').length} regressed`);
const instability = scored.flatMap((r) => [r.arms[A_VER], r.arms[B_VER]]).filter((a) => a?.body_sd);
console.log(`sampler spread: median body_sd = ${Math.round(instability.map((a) => a.body_sd).sort((x, y) => x - y)[Math.floor(instability.length / 2)] || 0)} chars — the quantity a k=1 run cannot see`);
if (OUT) { writeFileSync(OUT, JSON.stringify({ model: MODEL, arms: [A_VER, B_VER], k: K, at: new Date().toISOString(), results }, null, 2)); console.log(`\nwrote ${OUT}`); }
await c.close();
