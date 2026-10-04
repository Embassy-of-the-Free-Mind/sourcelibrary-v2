#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/t2/gemini-arms.mjs — same metered call shape (gemini-script-client,
// thinking off, temperature 0, hard USD cap, resumable per-page files), but it TRANSLATES with the production prompt.
// T5's `lite-check` arm had Flash rewrite Lite's page; nothing asks a model only to LIST contradictions, or back-translates.
/** Reference-free detectors D2 (back-translation + contradiction check) and D3 (direct contradiction list) over the labelled set, with a planted-change control (#5695 extra test). */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/translation-vs-reference/backtrans/run-detectors.mjs \
 *     --set <dir>/set.jsonl --out <dir>/raw [--max-order 60] [--plants 30] [--max-usd 5] [--model gemini-3.1-flash-lite]
 * Output <out>/<d3|d2-back|d2-check>[-plant]/<id>.json while running (resumable), packed at the end into one
 * <out>/<dir>.jsonl per detector so the results stay under the PR classifier's 300-file diff limit; --pack-only repacks,
 * and a run that finds only the .jsonl unpacks it first. Spend is metered on gemini_usage (triggeredBy xlref-backtrans).
 * The model never sees a reference translation or a judge's label. No writes to Mongo except the usage meter.
 */
import fs from 'node:fs';
import path from 'node:path';
import { callGemini } from '../../../lib/gemini-script-client.mjs';
import { SAFETY_SETTINGS } from '../../../lib/translate-core.mjs';
import { costOf } from '../../../lib/model-pricing.mjs';
import { makeRng } from '../../lib/paired-stats.mjs';
import { readJsonl, plant } from '../common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const SET = opt('set'); const OUT = opt('out'); const MAX_ORDER = Number(opt('max-order', 1e9)); const PLANTS = Number(opt('plants', 30));
const MAX_USD = Number(opt('max-usd', 5)); const MODEL = opt('model', 'gemini-3.1-flash-lite'); const CONC = Number(opt('concurrency', 4));
const ENDPOINT = 'scripts/eval/translation-vs-reference/backtrans/run-detectors.mjs';

// What a reader would call the translation: by-design additions (summary, notes, glosses) are not checked.
export const cleanEnglish = (t) => String(t || '').replace(/<(meta|summary|keywords|note|gloss|warning)\b[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
export const cleanSource = (t) => String(t || '').replace(/<(language|lang|page-type|page-num|scan-quality|script|columns|meta|warning|sig|summary|keywords)\b[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

const SCRIPTS = [['Tibetan', 'Tibetan script'], ['Han', 'traditional Chinese characters'], ['Devanagari', 'Devanagari'], ['Hebrew', 'Hebrew script'], ['Arabic', 'Arabic script'], ['Greek', 'polytonic Greek'], ['Bengali', 'Bengali script'], ['Latin', 'Latin script (keep diacritics for transliterated languages)']];
function scriptOf(src) { let best = SCRIPTS[SCRIPTS.length - 1], n = 0; for (const s of SCRIPTS) { const k = (src.match(new RegExp(`\\p{Script=${s[0]}}`, 'gu')) || []).length; if (k > n) { n = k; best = s; } } return best[1]; }
const langName = (r) => ({ Chinese: 'classical (literary) Chinese', Tibetan: 'classical Tibetan' }[r.lang] || r.lang);

const KINDS = 'negation (a "not" added or dropped) | role (who does what to whom is swapped) | number | sense (a word taken in a wrong sense that changes the claim) | other';
const d3Prompt = (r, en) => `You are checking a translation for errors of MEANING. You do not rewrite it.

SOURCE is one page of a ${langName(r)} text. ENGLISH is a translation of that page.

List only:
- "contradictions": places where the English asserts the opposite of the source, or a materially different claim. Kinds: ${KINDS}.
- "omissions": a sentence or more of the source that has no counterpart anywhere in the English.
- "additions": a sentence or more of the English that has no basis anywhere in the source.

Do NOT list: style, word choice or paraphrase that keeps the meaning, spelling of names, punctuation, and differences in the first or last two lines of the page (pages can be cut at slightly different points). If the source itself is garbled at a spot, do not list that spot. If there is nothing to list, return empty arrays. Most pages have no contradiction.

Quote the source and the English exactly (at most 20 words each). Answer with JSON only:
{"contradictions":[{"source":"…","english":"…","kind":"negation|role|number|sense|other","why":"one short sentence","certainty":"high|medium|low"}],"omissions":[{"source":"…"}],"additions":[{"english":"…"}]}

SOURCE:
${cleanSource(r.source_text)}

ENGLISH:
${en}`;

const backPrompt = (r, en) => `Translate the following English into ${langName(r)}, written in ${scriptOf(cleanSource(r.source_text))}, in the idiom of an original ${langName(r)} work of this kind. Translate every sentence in order. Do not summarise, do not explain, do not add notes. Output only the ${langName(r)} text.

ENGLISH:
${en}`;

const checkPrompt = (r, back) => `Two ${langName(r)} versions of the same page follow. A is the original. B was written independently and its wording will differ freely; that is expected and is not an error.

List only:
- "contradictions": places where B asserts the opposite of A, or a materially different claim. Kinds: ${KINDS}.
- "omissions": a sentence or more of A that has no counterpart anywhere in B.
- "additions": a sentence or more of B that has no basis anywhere in A.

Do NOT list: synonyms, different wording or word order that keeps the meaning, spelling, punctuation, and differences in the first or last two lines (the versions can be cut at slightly different points). If A itself is garbled at a spot, do not list that spot. If there is nothing to list, return empty arrays. Most pages have no contradiction.

Quote A and B exactly (at most 20 words each). Answer with JSON only:
{"contradictions":[{"a":"…","b":"…","kind":"negation|role|number|sense|other","why":"one short sentence in English","certainty":"high|medium|low"}],"omissions":[{"a":"…"}],"additions":[{"b":"…"}]}

A:
${cleanSource(r.source_text)}

B:
${back}`;

export function parseJson(text) {
  const t = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

let spent = 0; let calls = 0;
async function call(dir, id, prompt, { json, maxOutputTokens }) {
  const outf = path.join(OUT, dir, `${id}.json`);
  if (fs.existsSync(outf)) { const o = JSON.parse(fs.readFileSync(outf, 'utf8')); spent += o.cost_usd || 0; return o; }
  if (spent > MAX_USD) throw new Error(`spend cap: $${spent.toFixed(2)} > $${MAX_USD}`);
  fs.mkdirSync(path.join(OUT, dir), { recursive: true });
  let res = null; let lastErr = null;
  for (let attempt = 1; attempt <= 4 && !res; attempt++) {
    try {
      res = await callGemini({ model: MODEL, prompt, endpoint: ENDPOINT, thinkingBudget: 0, temperature: 0, maxOutputTokens, safetySettings: SAFETY_SETTINGS,
        type: 'eval', pageIds: [id], promptVersion: 'backtrans-v1', triggeredBy: 'xlref-backtrans' });
      if (json && !parseJson(res.text) && attempt < 4) { lastErr = new Error('unparseable JSON'); spent += costOf(MODEL, res.inputTokens, res.outputTokens); res = null; }
    } catch (err) {
      lastErr = err;
      if (!/Gemini (503|429|500)|timeout|aborted|fetch failed/i.test(String(err.message))) break;
      await new Promise((ok) => setTimeout(ok, 5000 * attempt));
    }
  }
  if (!res) { const o = { id, dir, failed: true, error: String(lastErr?.message).slice(0, 300) }; fs.writeFileSync(outf.replace(/\.json$/, '.failed.json'), JSON.stringify(o)); console.log(`${dir} ${id} FAILED ${o.error}`); return o; }
  const cost_usd = costOf(MODEL, res.inputTokens, res.outputTokens); spent += cost_usd; calls++;
  const o = { id, dir, model: MODEL, text: res.text, parsed: json ? parseJson(res.text) : undefined, finishReason: res.finishReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens, thinkingTokens: res.thinkingTokens, cost_usd, at: new Date().toISOString() };
  fs.writeFileSync(outf, JSON.stringify(o));
  return o;
}

async function detect(r, english, suffix) {
  const en = cleanEnglish(english);
  const outTok = Math.min(24000, Math.max(4096, Math.ceil(en.length * 1.5)));
  await call(`d3${suffix}`, r.id, d3Prompt(r, en), { json: true, maxOutputTokens: 4096 });
  const back = await call(`d2-back${suffix}`, r.id, backPrompt(r, en), { json: false, maxOutputTokens: outTok });
  if (!back.failed && back.text) await call(`d2-check${suffix}`, r.id, checkPrompt(r, back.text.trim()), { json: true, maxOutputTokens: 4096 });
}

const DIRS = ['d3', 'd2-back', 'd2-check', 'd3-plant', 'd2-back-plant', 'd2-check-plant'];
/** <out>/<dir>/*.json → <out>/<dir>.jsonl (sorted by id), then the directory is removed. */
function pack() { for (const d of DIRS) { const dir = path.join(OUT, d); if (!fs.existsSync(dir)) continue; const rows = fs.readdirSync(dir).sort().map((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim()); fs.writeFileSync(`${dir}.jsonl`, rows.join('\n') + '\n'); fs.rmSync(dir, { recursive: true }); } }
function unpack() { for (const d of DIRS) { const f = path.join(OUT, `${d}.jsonl`); if (!fs.existsSync(f) || fs.existsSync(path.join(OUT, d))) continue; fs.mkdirSync(path.join(OUT, d), { recursive: true }); for (const r of readJsonl(f)) fs.writeFileSync(path.join(OUT, d, `${r.id}${r.failed ? '.failed' : ''}.json`), JSON.stringify(r)); } }

async function pool(items, fn) { let i = 0; await Promise.all(Array.from({ length: CONC }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } })); }

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!SET || !OUT) { console.error('--set and --out are required'); process.exit(1); }
  if (args.includes('--pack-only')) { pack(); process.exit(0); }
  unpack();
  const set = readJsonl(SET).filter((r) => r.order <= MAX_ORDER);
  await pool(set, (r) => detect(r, r.english, ''));
  console.log(`main: ${set.length} pages, cumulative $${spent.toFixed(4)}`);
  // Positive control: one planted meaning change (the judge gate's own plant()) in the English of pages both judges
  // passed (no reversal, fidelity ≥ 4). The unplanted run of the same page is its paired baseline.
  if (PLANTS > 0) {
    const rnd = makeRng(5695); const pick = (a) => a[Math.floor(rnd() * a.length)];
    const key = [];
    for (const r of set.filter((x) => x.labels.reversal_judges === 0 && x.labels.fidelity >= 4)) {
      if (key.length >= PLANTS) break;
      const en = cleanEnglish(r.english); const p = plant(en, pick);
      if (!p) continue;
      key.push({ id: r.id, track: r.track, lang: r.lang, op: p.op, from: p.from, to: p.to, before_context: p.before_context, after_context: p.after_context, text: p.text });
    }
    fs.writeFileSync(path.join(OUT, 'plants.json'), JSON.stringify(key.map(({ text, ...k }) => k), null, 1));
    const byId = new Map(set.map((r) => [r.id, r]));
    await pool(key, (k) => detect(byId.get(k.id), k.text, '-plant'));
    console.log(`plants: ${key.length} pages, cumulative $${spent.toFixed(4)}`);
  }
  console.log(`spent $${spent.toFixed(4)} (incl. resumed) over ${calls} new calls`);
  pack();
  fs.writeFileSync(path.join(OUT, 'cost.json'), JSON.stringify({ model: MODEL, spent_usd: Number(spent.toFixed(4)), max_usd: MAX_USD, at: new Date().toISOString() }));
}
