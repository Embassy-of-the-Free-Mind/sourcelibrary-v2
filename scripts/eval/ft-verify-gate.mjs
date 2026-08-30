#!/usr/bin/env node
/**
 * ft-verify-gate.mjs — Stage-2 verification gate for first-translation verdicts (#2564).
 *
 * Replaces the throwaway demote-gate / promote-gate scratch scripts with one reusable,
 * committed tool. Takes a Stage-1 adjudication JSONL and a --direction, runs an INDEPENDENT
 * skeptical grounded re-check of each consequential verdict, captures the real search
 * queries + source domains, appends a verification attempt to first_translation_attempts,
 * and writes survivors. Only verdicts that SURVIVE verification should be written to a
 * public surface (badge / catalog).
 *
 *   --direction demote : verify a claimed prior is REAL + COMPLETE (filters fabricated/partial)
 *   --direction promote: try to REFUTE "no prior exists" by FINDING a prior
 *
 * Verified on 2026-06-21: ~63% of single-pass demote priors were fabricated/partial;
 * ~25% of single-pass "first" claims had a findable prior. This gate is the binding step.
 *
 * USAGE (run where @google/genai resolves, e.g. the worktree):
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ft-verify-gate.mjs <stage1.jsonl> --direction demote|promote \
 *        [--out scripts/output/ft-verify-<name>.jsonl] [--concurrency 6]
 */
import { GoogleGenAI } from '@google/genai';
import { MongoClient } from 'mongodb';
import fs from 'fs';

const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
const IN = args.find(a => a.endsWith('.jsonl') && !a.startsWith('--'));
const DIR = getArg('--direction', 'demote');           // demote | promote
const OUT = getArg('--out', `scripts/output/ft-verify-${DIR}.jsonl`);
const CONC = parseInt(getArg('--concurrency', '6'), 10);
const RUN_DATE = new Date().toISOString();
if (!IN || !['demote', 'promote'].includes(DIR)) { console.error('usage: ft-verify-gate.mjs <stage1.jsonl> --direction demote|promote'); process.exit(1); }

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2 });
const FIRST = new Set(['first_no_prior', 'first_from_source', 'first_complete', 'first_modern']);

// pick the consequential verdicts for this direction
const rows = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const items = rows.filter(r => DIR === 'demote' ? r.verdict === 'not_first' : FIRST.has(r.verdict))
  .map(r => { const p = (r.prior_translations_found || [])[0] || {};
    return { book_id: r.book_id, work: r.work_identified || r.t, author: r.a || '', lang: r.l || '?', translator: p.translator, year: p.pub_year }; });

const done = new Set();
if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean)) { try { done.add(JSON.parse(l).book_id); } catch {} }
const todo = items.filter(i => !done.has(i.book_id));
console.error(`Verify-gate [${DIR}]: ${items.length} consequential verdicts, ${todo.length} to check → ${OUT}`);

const promptDemote = s => `VERIFY a possibly-fabricated bibliographic citation. Be skeptical — AI invents plausible translators/years.
WORK: "${s.work}" by ${s.author || '?'} (${s.lang}). CLAIMED prior English translation: ${s.translator}, ${s.year}.
Search WorldCat/archive.org/Google Books/publisher/library catalogues. Does THIS specific translation exist, and is it COMPLETE or only partial?
Return ONLY JSON: {"result":"confirmed_complete|confirmed_partial|not_found|uncertain","prior":"","evidence_url":"","note":"<=140"}`;
const promptPromote = s => `We are about to claim "${s.work}" by ${s.author || '?'} (${s.lang}) is a FIRST English translation — NO complete prior exists. BE SKEPTICAL: try to REFUTE it by FINDING a prior complete English translation.
Search WorldCat/archive.org/Google Books/HathiTrust/publisher/scholarship for ${s.lang} hard.
Return ONLY JSON: {"result":"complete_prior_found|only_partial_exists|none_found|uncertain","prior":"","evidence_url":"","note":"<=140"}`;
const prompt = DIR === 'demote' ? promptDemote : promptPromote;

async function one(s) { for (let a = 0; a < 3; a++) { try {
  const r = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt(s), config: { tools: [{ googleSearch: {} }], temperature: 0.1 } });
  const gm = r.candidates?.[0]?.groundingMetadata || {};
  const queries = gm.webSearchQueries || [];
  const sources_checked = [...new Set((gm.groundingChunks || []).map(c => c?.web?.title || c?.web?.uri).filter(Boolean))];
  const m = (r.text || '').match(/\{[\s\S]*\}/); const j = m ? JSON.parse(m[0]) : { result: 'FAIL' };
  return { ...j, queries, sources_checked };
} catch { await new Promise(r => setTimeout(r, 1500)); } } return { result: 'FAIL', queries: [], sources_checked: [] }; }

let i = 0;
async function w() { while (i < todo.length) { const s = todo[i++]; const v = await one(s); fs.appendFileSync(OUT, JSON.stringify({ ...s, ...v, date: RUN_DATE }) + '\n'); } }
await Promise.all(Array.from({ length: Math.min(CONC, todo.length || 1) }, w));

// append verification attempts to the provenance log
const all = fs.readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const SURVIVE = DIR === 'demote' ? r => r.result === 'confirmed_complete' : r => r.result === 'none_found' || r.result === 'only_partial_exists';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const COL = c.db('bookstore').collection('first_translation_attempts');
const attempts = all.map(x => ({ attempt_id: `${x.book_id}:${DIR}_verify:${x.date}`, book_id: x.book_id, date: x.date, method: 'gemini_verifier',
  match_key: 'author_title', sources_checked: x.sources_checked || [], queries: x.queries || [],
  result: (DIR === 'demote' ? x.result === 'confirmed_complete' : x.result === 'complete_prior_found') ? 'found' : 'none',
  // #3785: verdict is the RAW result string (derive-from-evidence matches 'not_found' exactly);
  // direction provenance lives in notes. Strength is required — unstated fails toward 'weak'.
  verdict: x.result, evidence_strength: ['strong', 'moderate', 'weak'].includes(x.evidence_strength) ? x.evidence_strength : 'weak',
  model: 'gemini-3-flash-preview',
  notes: `${DIR.toUpperCase()}-VERIFY ${x.result}: ${x.prior || x.translator || ''} | ${x.note || ''} | url:${x.evidence_url || ''}`.trim(), _src: 'ft-verify-gate' }));
const present = new Set((await COL.find({ attempt_id: { $in: attempts.map(a => a.attempt_id) } }, { projection: { attempt_id: 1 } }).toArray()).map(d => d.attempt_id));
const fresh = attempts.filter(a => !present.has(a.attempt_id));
if (fresh.length) await COL.insertMany(fresh, { ordered: false });
await c.close();

const tally = {}; for (const x of all) tally[x.result] = (tally[x.result] || 0) + 1;
const survivors = all.filter(SURVIVE);
fs.writeFileSync(OUT.replace('.jsonl', '-survivors.json'), JSON.stringify(survivors, null, 0));
console.error(`\n[${DIR}] tally: ${JSON.stringify(tally)}`);
console.error(`SURVIVORS (safe to apply): ${survivors.length} / ${all.length} · logged ${fresh.length} attempts → first_translation_attempts`);
