#!/usr/bin/env node
/**
 * Aliveness classifier (#6652). Reads the aliveness retrieval (retrieve-v5-local.mjs --probes probes/probes-aliveness.json,
 * merged by build/merge-v5.mjs) and marks each passage on the three layers of the aliveness atlas:
 * Every non-null layer must carry its own verbatim evidence sentence; a layer whose sentence is not on the page is
 * dropped to null (recorded in `unverified`). The first prompt let flash-lite mark 52% of a RANDOM sample (plants grow,
 * houses collapse); default-null wording plus per-layer evidence is the fix, measured on the same baseline.
 *   felt  — a person reports feeling alive (quickened, vivid, reborn) or dead inside (acedia, numbness, torpor), from the inside
 *   world — the text says nature, matter, the earth, plants, minerals or the heavens are alive, or that they are inert
 *   made  — the text says a place, building, garden, image or crafted thing is alive, or lifeless (Alexander's sense)
 * Each layer is "alive" | "dead" | null, so a passage can sit on more than one layer; the cross-layer rates are the point.
 *
 * PRIOR ART: classify/classify-v5.mjs — same plumbing kept verbatim (paths from env, thinkingBudget 0, run cap, resume by
 * page_id, backoff + 50%-failure abort) and the same HARD verbatim quote gate (a quote that is not a substring of its page is
 * discarded, never repaired). It does not fit as-is because its instrument is altered states (features/trigger/aftermath),
 * which has no field for "what is said to be alive" or "what the text credits the life to".
 * PAID: gemini-3.1-flash-lite (the only Gemini model allowed on the paid API), ~$0.16 per 1000 passages.
 *
 *   CLASSIFY_IN=... CLASSIFY_OUT=... node classify/classify-aliveness.mjs
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const SL = process.env.SL_REPO || path.join(process.env.HOME, 'sourcelibrary');
// every call writes a gemini_usage row (endpoint below) — the spend perimeter refuses unlogged call sites
const { callGemini } = await import(path.join(SL, 'scripts', 'lib', 'gemini-script-client.mjs'));
const ENDPOINT = 'scripts/analysis/experience-map/classify/classify-aliveness.mjs';

const DIR = process.env.ALIVE_OUT || path.join(SL, 'scripts', 'output', 'experience-map', 'aliveness');
const IN = process.env.CLASSIFY_IN || path.join(DIR, 'hits-v5-merged.jsonl');
const OUT = process.env.CLASSIFY_OUT || path.join(DIR, 'classified-aliveness.jsonl');
const MODEL = 'gemini-3.1-flash-lite'; // fixed: the paid-API rule allows no other Gemini model here
const CONCURRENCY = Number(process.env.CLASSIFY_CONC || 12);
const MAX = Number(process.env.CLASSIFY_MAX || 0);

const REGISTERS = new Set(['testimony','narrative','instruction','doctrine','description','fiction','other','junk']);
const POLES = new Set(['alive','dead']);
const CARRIERS = new Set(['self','body','soul-mind','cosmos-whole','heavens-stars','sun','earth','water-sea','fire-element',
  'mineral-metal','plant','animal','human-community','place','building','garden','image-statue','artwork-craft','text-word','other']);
const SOURCES = new Set(['god-divine','breath-spirit','soul-form','heat-fire','blood-humours','sun-stars','sympathy-love',
  'proportion-number','maker-craft','ritual-consecration','growth-seed','spirit-of-place','prayer-grace','not-stated','other']);
const QUALITIES = new Set(['warmth','light','motion','growth','breath','freshness','wholeness','proportion','intensity','joy',
  'belonging','interiority','voice','fertility','stillness','cold','heaviness','emptiness','decay','mechanism']);

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
// Markup-insensitive form for the verbatim gate: the stored translations carry inline <note>/<gloss> apparatus,
// <term> tags and footnote marks, and the model's quotation of the same sentence often omits or flattens them.
// Still a HARD gate (the words must be the page's words, in order); it only stops markup from vetoing a true quote.
// A second rater found the strict form dropped 6 of 20 screen-negatives that were plain positives (#6652).
const loose = (s) => (s || '').replace(/<(note|gloss)>[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const pick = (v, set, dflt) => (typeof v === 'string' && set.has(v)) ? v : dflt;

const PROMPT = (r) => `Analyse a passage from a historical text for a scholarly atlas of how people across cultures have described ALIVENESS.

BOOK: ${r.book_title} — ${r.book_author || 'unknown'} (${r.book_year || 'n.d.'}, ${r.book_language || 'unknown language'})
PASSAGE:
"""
${r.text.slice(0, 2600)}
"""

The atlas has three layers. EACH LAYER IS null UNLESS THE PASSAGE STATES IT OUTRIGHT. Most passages, including most passages about plants, medicine, buildings, God or the soul, are null on all three. When in doubt, null.

felt — a PERSON describes, from the inside, the experience of feeling alive (life or vigour surging, the world turning vivid, being reborn, exuberant gladness felt in the body, strength returning after illness) → "alive"; or of feeling dead inside (acedia, numbness, "I lived but was not alive", torpor, melancholy heaviness) → "dead".
  NOT felt: someone lives, dies, is healed or praised without saying how it felt; exhortations that the soul ought to live; spiritual death as a doctrine of sin; joy mentioned in one word.
world — the passage CLAIMS that something not usually thought alive IS alive or ensouled: the world or cosmos has a soul; stars or heavens are living or moved by souls; the earth breathes or has veins; metals or stones grow, ripen, have seed or soul; plants have a soul, feel or suffer; a vital breath or spirit (pneuma, spiritus, prana, qi) gives life to things → "alive". Or it argues that matter, animals or nature are inert, dead or mere mechanism → "dead".
  NOT world: plants grow, bear fruit or have medicinal virtues; animals behave; the earth is fertile; stars cause effects; ordinary physics or anatomy.
made — the passage says a PLACE, building, garden, city, image, statue or crafted work is alive, living, ensouled, inhabited by a spirit or god, or so lifelike that it seems to live → "alive"; or explicitly calls one lifeless, dead, cold or without spirit → "dead".
  NOT made: buildings are built, ruined or collapse; machines are described; a place is holy or beautiful without being called living; an object is used in a ritual.

For every non-null layer, give its evidence: the one sentence that states it, COPIED CHARACTER-FOR-CHARACTER from the passage (never paraphrase, modernise or repair). A layer with no such sentence is null.

Answer as JSON:
1. register — exactly one: "testimony" (someone reports what happened to them), "narrative" (hagiography, legend, scripture, history), "instruction" (how to do or make it), "doctrine" (theory, no experience narrated), "description" (a place, object or natural thing described), "fiction" (avowedly invented modern narrative), "other" (catalogue, bibliography, unrelated), "junk" (OCR too corrupt)
2. felt, world, made — each null or {"pole":"alive"|"dead","evidence":"<verbatim sentence>"}
3. carrier — WHAT is said to be alive or dead (for the strongest layer). One of: ${[...CARRIERS].join(', ')}
4. source_of_life — what the text credits the life (or its absence) to. One of: ${[...SOURCES].join(', ')}
5. qualities — qualities given to the aliveness or deadness, ONLY from: ${[...QUALITIES].join(', ')} (may be empty)
6. first_person — narrated in the first person?
7. tradition — one short tag, e.g. christian-mystical, tibetan-buddhist, daoist, kabbalah, hermetic-alchemical, islamic-sufi, hindu, greco-roman, natural-philosophy, medical, architecture-art, folk-magical, mesopotamian, other
8. confidence — 0.0 to 1.0

Output ONLY JSON: {"register":"","felt":null,"world":null,"made":null,"carrier":"","source_of_life":"","qualities":[],"first_person":false,"tradition":"","confidence":0}`;

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

let idx = 0, ok = 0, fail = 0, dropped = 0, inTok = 0, outTok = 0;
async function worker() {
  while (idx < todo.length) {
    const r = todo[idx++]; const n = idx;
    try {
      const res = await callGemini({ model: MODEL, prompt: PROMPT(r), endpoint: ENDPOINT, temperature: 0, maxOutputTokens: 700, type: 'analysis', bookId: r.book_id, promptVersion: 'aliveness-v2' });
      inTok += res.inputTokens || 0; outTok += res.outputTokens || 0;
      const j = extract(res.text);
      if (!j) { fail++; continue; }

      // Hard gate per layer: a layer counts only if its evidence sentence is a verbatim substring of the page.
      const layer = (v) => {
        if (!v || typeof v !== 'object' || !POLES.has(v.pole)) return { pole: null, quote: null };
        const q = typeof v.evidence === 'string' ? v.evidence.trim() : '';
        if (q && (norm(r.text).includes(norm(q)) || (loose(q).length >= 20 && loose(r.text).includes(loose(q))))) return { pole: v.pole, quote: q };
        dropped++; return { pole: null, quote: null, unverified: v.pole, evidence: q.slice(0, 300) };
      };
      const L = { felt: layer(j.felt), world: layer(j.world), made: layer(j.made) };
      const felt = L.felt.pole, world = L.world.pole, made = L.made.pole;
      const quote = L.felt.quote || L.made.quote || L.world.quote || null;
      const verified = !!quote;

      appendFileSync(OUT, JSON.stringify({
        page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, emb_page_id: r.emb_page_id,
        book_title: r.book_title, book_author: r.book_author,
        book_language: r.book_language, book_year: r.book_year,
        probe_dim: r.dim, slice: r.slice, similarity: r.similarity, probe: r.probe, visible: r.visible,
        register: pick(j.register, REGISTERS, 'other'),
        felt, world, made,
        felt_quote: L.felt.quote, world_quote: L.world.quote, made_quote: L.made.quote,
        unverified: [L.felt, L.world, L.made].map((x, i) => x.unverified ? ['felt','world','made'][i] + ':' + x.unverified : null).filter(Boolean),
        carrier: pick(j.carrier, CARRIERS, 'other'),
        source_of_life: pick(j.source_of_life, SOURCES, 'not-stated'),
        qualities: (Array.isArray(j.qualities) ? j.qualities : []).filter((q) => QUALITIES.has(q)),
        quote, quote_verified: verified,
        first_person: !!j.first_person,
        tradition: typeof j.tradition === 'string' ? j.tradition.slice(0, 40) : null,
        confidence: typeof j.confidence === 'number' ? j.confidence : null,
      }) + '\n');
      ok++;
      if (n % 500 === 0) console.log(`  ${n}/${todo.length} ok=${ok} fail=${fail} quotesDropped=${dropped} tokens in=${inTok} out=${outTok}`);
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
console.log(`done ok=${ok} fail=${fail} quotesDropped=${dropped} tokens in=${inTok} out=${outTok}`);
