#!/usr/bin/env node
/**
 * Classifier v5 = classify-v3 unchanged in prompt, enums and the hard verbatim quote gate, re-plumbed for the v5
 * retrieval (retrieve-v5-local.mjs semantic lane + retrieve-v5-lexical.mjs native-language lane, merged by
 * merge-v5.mjs). Differences from v3, each a fix, not a change of instrument:
 *  - paths from $HOME / env (v3 hardcoded a dead scratchpad dir and a laptop-only package.json), so it runs on
 *    Hetzner, where the Gemini API is reachable (the laptop's egress is geo-blocked: "User location is not supported");
 *  - thinkingConfig.thinkingBudget = 0 (CLAUDE.md: every generateContent call sets it; v3 billed invisible thinking);
 *  - carries lane / probe_lang / probe_source / visible from the hit through to the output row, so a passage found by
 *    a Tibetan term and one found by an English probe sentence stay distinguishable downstream;
 *  - a run cap (CLASSIFY_MAX) so a pilot can be costed before the full pass; resume is by page_id as before.
 * PRIOR ART: classify/classify-v3.mjs — the instrument; kept verbatim where it is the instrument.
 * PAID: gemini-3.1-flash-lite, ~$0.16 per 1000 passages. Do not run without a cost sign-off.
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const SL = process.env.SL_REPO || path.join(process.env.HOME, 'sourcelibrary');
const require = createRequire(path.join(SL, 'package.json'));
const { GoogleGenAI } = require('@google/genai');

const V5 = process.env.V5_OUT || path.join(SL, 'scripts', 'output', 'experience-map', 'v5');
const IN = process.env.CLASSIFY_IN || path.join(V5, 'hits-v5-merged.jsonl');
const OUT = process.env.CLASSIFY_OUT || path.join(V5, 'classified-v5.jsonl');
const MODEL = process.env.CLASSIFY_MODEL || 'gemini-3.1-flash-lite';
const CONCURRENCY = Number(process.env.CLASSIFY_CONC || 12);
const MAX = Number(process.env.CLASSIFY_MAX || 0);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY });

const FEATURES = new Set(['unity','light','ineffability','noetic','time','sacred_awe','dread',
  'vision_encounter','voice','ascent','body_alienation','synesthesia','elementary_imagery',
  'possession','dream_incubation','melancholy','substance','concentration','clarity_cessation',
  'bodily_heat','felt_presence','sleep_paralysis','near_death','vision_of_dead','fever_delirium',
  'erotic_union','pain_ordeal','unsourced_music','animal_transformation','mesmeric_trance',
  'sensory_deprivation','fasting_austerity','prophetic_inspiration','ecstatic_dance','doubling',
  'uncanny_familiarity']);
const REGISTERS = new Set(['testimony','vision-narrative','instruction','doctrine','fiction','other','junk']);
const TRIGGERS = new Set(['fasting','illness-fever','substance','prayer-liturgy','meditation',
  'grief-bereavement','solitude-darkness','music-dance','sleep-dream','childbirth-pain',
  'injury-near-death','magnetism-hypnosis','ritual-ceremony','spontaneous','not-stated','other']);
const AFTERMATHS = new Set(['conversion-life-change','healing','mission-prophecy','doubt-uncertainty',
  'fear-persecution','physical-aftereffect','despair','reassurance','not-stated','other']);
const AGENTS = new Set(['god-divine','angel','demon-devil','spirit-unspecified','the-dead','saint',
  'nature-cosmos','the-self-mind','illness-humours','drug','deity-non-christian','not-stated','other']);

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const pick = (v, set, dflt) => (typeof v === 'string' && set.has(v)) ? v : dflt;

const PROMPT = (r) => `Analyse a passage from a historical text for a scholarly map of how people across cultures have described unusual states of consciousness.

BOOK: ${r.book_title} — ${r.book_author || 'unknown'} (${r.book_year || 'n.d.'}, ${r.book_language || 'unknown language'})
PASSAGE:
"""
${r.text.slice(0, 2600)}
"""

Answer as JSON.

1. register — exactly one:
   "testimony"        someone reports an experience they underwent, presented as having actually happened to them
   "vision-narrative" a vision or encounter related as real within a hagiographic, scriptural, legendary or devotional narrative, where the modern true/invented distinction does not apply
   "instruction"      prescriptive guidance for producing or navigating such a state
   "doctrine"         theory or theology ABOUT such states, no experience narrated
   "fiction"          experience inside an avowedly invented modern narrative (novel, drama, literary poem)
   "other"            bibliography, catalogue, unrelated
   "junk"             OCR too corrupt to interpret

2. experiential — true ONLY if the passage says what the state was like FROM THE INSIDE. A claim that the soul may be united to God is not experiential; light, dissolution, terror, timelessness, paralysis is.

3. features — present phenomenological content, using ONLY these strings (may be empty):
${[...FEATURES].join(', ')}

4. quote — if experiential, the single most vivid sentence describing the state, COPIED CHARACTER-FOR-CHARACTER from the passage. Never paraphrase, modernise or repair. Else null.

5. first_person — narrated in the first person?

6. trigger — what brought the state on, per the text. One of: ${[...TRIGGERS].join(', ')}

7. aftermath — what followed for the person. One of: ${[...AFTERMATHS].join(', ')}

8. attributed_agent — what/who the text credits the experience to. One of: ${[...AGENTS].join(', ')}

9. contested — true if the text registers DISPUTE or doubt about the nature or source of the experience (e.g. divine or demonic, real or delusion, genuine or fraud).

10. tradition — one short tag, e.g. christian-mystical, tibetan-buddhist, daoist, kabbalah, hermetic-alchemical, islamic-sufi, hindu-vedanta, greco-roman, medical-scientific, spiritualist, folk-magical, mesopotamian, other

11. confidence — 0.0 to 1.0

Output ONLY JSON: {"register":"","experiential":false,"features":[],"quote":null,"first_person":false,"trigger":"","aftermath":"","attributed_agent":"","contested":false,"tradition":"","confidence":0}`;

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
const todo0 = rows.filter((r) => !done.has(r.page_id)); const todo = MAX ? todo0.slice(0, MAX) : todo0;
console.log(`${rows.length} passages, ${done.size} done, ${todo.length} to classify (model ${MODEL})`);

let idx = 0, ok = 0, fail = 0, dropped = 0;
async function worker() {
  while (idx < todo.length) {
    const r = todo[idx++]; const n = idx;
    try {
      const res = await ai.models.generateContent({
        model: MODEL, contents: PROMPT(r),
        config: { temperature: 0, maxOutputTokens: 900, thinkingConfig: { thinkingBudget: 0 } },
      });
      const j = extract(res.text);
      if (!j) { fail++; continue; }

      let quote = typeof j.quote === 'string' ? j.quote.trim() : null;
      let verified = false;
      if (quote) {
        if (norm(r.text).includes(norm(quote))) verified = true;
        else { dropped++; quote = null; }
      }

      appendFileSync(OUT, JSON.stringify({
        page_id: r.page_id, book_id: r.book_id, page_number: r.page_number,
        book_title: r.book_title, book_author: r.book_author,
        book_language: r.book_language, book_year: r.book_year,
        probe_dim: r.dim, slice: r.slice, similarity: r.similarity, lane: r.lane, lanes: r.lanes, probe_lang: r.probe_lang || null, probe_source: r.probe_source || null, probe: r.probe, visible: r.visible,
        register: pick(j.register, REGISTERS, 'other'),
        experiential: !!j.experiential,
        features: (Array.isArray(j.features) ? j.features : []).filter((f) => FEATURES.has(f)),
        quote, quote_verified: verified,
        first_person: !!j.first_person,
        trigger: pick(j.trigger, TRIGGERS, 'not-stated'),
        aftermath: pick(j.aftermath, AFTERMATHS, 'not-stated'),
        attributed_agent: pick(j.attributed_agent, AGENTS, 'not-stated'),
        contested: !!j.contested,
        tradition: typeof j.tradition === 'string' ? j.tradition.slice(0, 40) : null,
        confidence: typeof j.confidence === 'number' ? j.confidence : null,
      }) + '\n');
      ok++;
      if (n % 500 === 0) console.log(`  ${n}/${todo.length} ok=${ok} fail=${fail} quotesDropped=${dropped}`);
    } catch (e) {
      fail++;
      if (fail === 1) console.error(`  first classify error: ${e && e.message}`);
      if (fail > 40 && fail > (ok + fail) * 0.5) {
        console.error(`ABORTING: ${fail} failures vs ${ok} ok — check the error above.`);
        idx = todo.length;
      }
      await new Promise((s) => setTimeout(s, 1500 + Math.random() * 1500));
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
console.log(`done ok=${ok} fail=${fail} quotesDropped=${dropped}`);
