#!/usr/bin/env node
/**
 * Classify passages against the VISUDDHIMAGGA'S OWN taxonomy.
 *
 * The comparative question this exists to answer: does an indigenous stage model
 * carve the corpus at the same joints as the Western instruments, or at different
 * ones? So the classifier records not just which stage a passage matches, but
 * whether the passage comes from inside the tradition that produced the category
 * ("native") or from outside it ("analogical").
 *
 * A Theravāda commentary matching bhaya-ñāṇa proves nothing — the category was
 * built from such texts. A Carmelite nun's dark night matching bhaya-ñāṇa is the
 * finding. Keeping the two apart is the whole point; collapsing them would let
 * the tradition's own literature masquerade as cross-cultural convergence.
 *
 * PAID: gemini-3.1-flash-lite.
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/Users/dereklomas/sourcelibrary/package.json');
const { GoogleGenAI } = require('@google/genai');

const HERE = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/b4cc9f10-7660-4f2b-b3cf-554d4017f8f7/scratchpad';
const IN = process.env.CLASSIFY_IN || `${HERE}/hits-jhana.jsonl`;
const OUT = process.env.CLASSIFY_OUT || `${HERE}/classified-jhana.jsonl`;
const CONC = Number(process.env.CLASSIFY_CONC || 6);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY });
const TAX = JSON.parse(readFileSync(`${HERE}/probes-jhana.json`, 'utf8')).dimensions;
const STAGES = new Set(TAX.map((d) => d.id));
const FITS = new Set(['native', 'analogical', 'poor']);
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const pick = (v, set, d) => (typeof v === 'string' && set.has(v)) ? v : d;

const LIST = TAX.map((d) => `  ${d.id} = ${d.label} (${d.pali}) — ${d.probes[0].slice(0, 110)}`).join('\n');

const PROMPT = (r) => `You are matching a historical passage against the stage model of the Visuddhimagga, the 5th-century Theravāda Buddhist manual. The model has two ladders: nine attainments of concentration, and sixteen knowledges of insight (of which stages 6–11 are the "knowledges of suffering", the tradition's documented dark passage).

STAGES:
${LIST}

BOOK: ${r.book_title} — ${r.book_author || 'unknown'} (${r.book_year || 'n.d.'}, ${r.book_language || '?'})
PASSAGE:
"""
${r.text.slice(0, 2400)}
"""

Answer as JSON.

1. experiential — does the passage describe a state FROM THE INSIDE (not doctrine about one)?
2. stage — the single stage id this passage best reports, or "none" if it reports no state in this model. Match on the DESCRIBED EXPERIENCE, not on shared religious vocabulary. Do not force a match.
3. fit — "native" if this text belongs to the Buddhist tradition that produced the model (Pali canon, commentaries, Theravāda/Mahāyāna/Vajrayāna works); "analogical" if it comes from OUTSIDE that tradition but the stage genuinely describes what the passage reports; "poor" if the match is weak or forced.
4. quote — if experiential, the most vivid sentence describing the state, COPIED CHARACTER-FOR-CHARACTER from the passage. Never paraphrase. Else null.
5. first_person — narrated in the first person?
6. tradition — short tag (theravada, tibetan-buddhist, mahayana, christian-mystical, islamic-sufi, hindu-vedanta, daoist, hermetic-alchemical, medical-scientific, greco-roman, folk-magical, other)
7. confidence — 0.0 to 1.0

Be conservative: "none" and "poor" are correct answers far more often than not.

Output ONLY JSON: {"experiential":false,"stage":"none","fit":"poor","quote":null,"first_person":false,"tradition":"","confidence":0}`;

const extract = (t) => { const m = (t || '').match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };

const rows = readFileSync(IN, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const done = new Set();
if (existsSync(OUT)) for (const l of readFileSync(OUT, 'utf8').split('\n')) { if (l.trim()) try { done.add(JSON.parse(l).page_id); } catch {} }
const todo = rows.filter((r) => !done.has(r.page_id));
console.log(`${rows.length} passages, ${done.size} done, ${todo.length} to classify`);

let i = 0, ok = 0, fail = 0, dropped = 0;
async function worker() {
  while (i < todo.length) {
    const r = todo[i++]; const n = i;
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite', contents: PROMPT(r),
        config: { temperature: 0, maxOutputTokens: 700 },
      });
      const j = extract(res.text);
      if (!j) { fail++; continue; }
      let quote = typeof j.quote === 'string' ? j.quote.trim() : null;
      let verified = false;
      if (quote) { if (norm(r.text).includes(norm(quote))) verified = true; else { dropped++; quote = null; } }
      appendFileSync(OUT, JSON.stringify({
        page_id: r.page_id, book_id: r.book_id, page_number: r.page_number,
        book_title: r.book_title, book_author: r.book_author,
        book_language: r.book_language, book_year: r.book_year,
        probe_dim: r.dim, slice: r.slice, similarity: r.similarity,
        experiential: !!j.experiential,
        stage: pick(j.stage, STAGES, 'none'),
        fit: pick(j.fit, FITS, 'poor'),
        quote, quote_verified: verified, first_person: !!j.first_person,
        tradition: typeof j.tradition === 'string' ? j.tradition.slice(0, 40) : null,
        confidence: typeof j.confidence === 'number' ? j.confidence : null,
      }) + '\n');
      ok++;
      if (n % 500 === 0) console.log(`  ${n}/${todo.length} ok=${ok} fail=${fail} dropped=${dropped}`);
    } catch (e) {
      fail++;
      if (fail === 1) console.error(`  first error: ${e && e.message}`);
      if (fail > 40 && fail > (ok + fail) * 0.5) { console.error('ABORTING — failure rate too high'); i = todo.length; }
      await new Promise((s) => setTimeout(s, 1500));
    }
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()));
console.log(`done ok=${ok} fail=${fail} quotesDropped=${dropped}`);
