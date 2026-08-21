#!/usr/bin/env node
/**
 * Classifier v2 for the experience map. Differences from the feasibility pass:
 *
 *  - HARD VERBATIM GATE. The quote is checked against the source text after
 *    whitespace/case normalisation. A quote that does not appear verbatim is
 *    discarded, not reported. 18/1152 quotes were silently altered in the
 *    feasibility run; per the quote-integrity rules that is a fabricated-
 *    citation vector, so it has to fail closed.
 *  - Feature tags validated against the enum (the model invented `sacady_awe`).
 *  - Glosses kept but recorded separately: `<note>` content is preserved by
 *    stripEditorialWrappers because it is a real reading aid, but it must not
 *    masquerade as the author's own words when displayed.
 *
 * PAID: gemini-3.1-flash-lite. ~$0.13 per 1000 passages.
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/Users/dereklomas/sourcelibrary/package.json');
const { GoogleGenAI } = require('@google/genai');

const HERE = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/b4cc9f10-7660-4f2b-b3cf-554d4017f8f7/scratchpad';
const IN = `${HERE}/hits-merged.jsonl`;
const OUT = `${HERE}/classified-v2.jsonl`;
const MODEL = 'gemini-3.1-flash-lite';
const CONCURRENCY = 10;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY });

const FEATURES = new Set([
  'unity', 'light', 'ineffability', 'noetic', 'time', 'sacred_awe', 'dread',
  'vision_encounter', 'voice', 'ascent', 'body_alienation', 'synesthesia',
  'elementary_imagery', 'possession', 'dream_incubation', 'melancholy',
  'substance', 'concentration', 'clarity_cessation', 'bodily_heat',
]);
const REGISTERS = new Set(['testimony', 'instruction', 'doctrine', 'fiction', 'other', 'junk']);

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

const PROMPT = (r) => `You are analysing a passage from a historical text for a scholarly map of how human beings across cultures have DESCRIBED unusual states of consciousness.

BOOK: ${r.book_title} — ${r.book_author || 'unknown'} (${r.book_year || 'n.d.'})
PASSAGE:
"""
${r.text.slice(0, 2600)}
"""

Classify it.

1. register — exactly one:
   "testimony"   = someone reports an experience they themselves underwent, or a named witness's account related as having happened
   "instruction" = prescriptive guidance for producing or navigating such a state
   "doctrine"    = theoretical/theological discussion ABOUT such states, no experience narrated
   "fiction"     = experience depicted inside an avowedly invented narrative
   "other"       = bibliography, catalogue, unrelated subject matter
   "junk"        = OCR too corrupt to interpret

2. experiential — true only if the passage says what the state was actually LIKE FROM THE INSIDE. A claim that the soul may be united to God is NOT experiential. Light, dissolution, terror, timelessness IS.

3. features — which are present (may be empty). Use ONLY these exact strings: ${[...FEATURES].join(', ')}

4. quote — if experiential, the single most vivid sentence describing the state, COPIED CHARACTER-FOR-CHARACTER from the passage above. Do not paraphrase, modernise, correct, or reorder. It must appear in the passage exactly. If no single sentence qualifies, null.

5. first_person — narrated in the first person?

6. tradition — one short tag for the text's tradition, e.g. christian-mystical, tibetan-buddhist, daoist, kabbalah, hermetic-alchemical, islamic-sufi, hindu-vedanta, greco-roman, medical-scientific, spiritualist, folk-magical, other

7. confidence — 0.0 to 1.0

Output ONLY JSON: {"register":"...","experiential":true,"features":[],"quote":null,"first_person":false,"tradition":"...","confidence":0.0}`;

const extract = (t) => {
  if (!t) return null;
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
};

const rows = readFileSync(IN, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const done = new Set();
if (existsSync(OUT)) {
  for (const l of readFileSync(OUT, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { done.add(JSON.parse(l).page_id); } catch {}
  }
}
const todo = rows.filter((r) => !done.has(r.page_id));
console.log(`${rows.length} passages, ${done.size} done, ${todo.length} to classify`);

let idx = 0, ok = 0, fail = 0, quoteDropped = 0, featDropped = 0;

async function worker() {
  while (idx < todo.length) {
    const r = todo[idx++];
    const n = idx;
    try {
      const res = await ai.models.generateContent({
        model: MODEL, contents: PROMPT(r),
        config: { temperature: 0, maxOutputTokens: 800 },
      });
      const j = extract(res.text);
      if (!j) { fail++; continue; }

      const register = REGISTERS.has(j.register) ? j.register : 'other';
      const features = (Array.isArray(j.features) ? j.features : []).filter((f) => {
        if (FEATURES.has(f)) return true;
        featDropped++; return false;
      });

      // hard verbatim gate
      let quote = typeof j.quote === 'string' ? j.quote.trim() : null;
      let quoteVerified = false;
      if (quote) {
        if (norm(r.text).includes(norm(quote))) quoteVerified = true;
        else { quoteDropped++; quote = null; }
      }
      // a gloss inside the quote means it carries translator apparatus
      const hasGloss = quote ? /\b(the |a )?[a-z]+ (i\.e\.|that is)\b/i.test(quote) : false;

      appendFileSync(OUT, JSON.stringify({
        page_id: r.page_id, book_id: r.book_id, page_number: r.page_number,
        book_title: r.book_title, book_author: r.book_author,
        book_language: r.book_language, book_year: r.book_year,
        probe_dim: r.dim, slice: r.slice, similarity: r.similarity,
        register, experiential: !!j.experiential, features,
        quote, quote_verified: quoteVerified, has_gloss: hasGloss,
        first_person: !!j.first_person,
        tradition: typeof j.tradition === 'string' ? j.tradition.slice(0, 40) : null,
        confidence: typeof j.confidence === 'number' ? j.confidence : null,
      }) + '\n');
      ok++;
      if (n % 250 === 0) console.log(`  ${n}/${todo.length} ok=${ok} fail=${fail} quotesDropped=${quoteDropped}`);
    } catch (e) {
      fail++;
      await new Promise((s) => setTimeout(s, 1200));
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
console.log(`done ok=${ok} fail=${fail} quotesDropped=${quoteDropped} badFeatureTags=${featDropped}`);
