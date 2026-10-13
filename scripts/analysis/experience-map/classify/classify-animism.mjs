#!/usr/bin/env node
/**
 * Animism screen (#6652): the fourth layer of the aliveness atlas, THE INHABITED WORLD. Marks whether a passage treats a
 * place, water, mountain, tree, animal, the land or the sky as a PERSON, or as the home of a person, with whom people
 * stand in a relation (offering, appeasement, offence, address, bargain, kinship, taming) — or argues there are no such
 * persons (the "denied" pole: disenchantment, polemic against superstition). The world layer cannot see this: its
 * rubric counts only matter itself said to be alive, and spirit-inhabited nature was rejected there by design.
 * The positive carries a verbatim evidence sentence, gated exactly as classify-aliveness.mjs gates its layers.
 * VOICE is recorded separately (insider practice / outsider report / literary use) because Tylor-era ethnography and
 * the traditions' own rites say different things about the same belief.
 *
 * PRIOR ART: classify/classify-aliveness.mjs — plumbing, the norm/loose verbatim gate and callGemini kept verbatim. It
 * does not fit as-is because its three layers have no slot for a being that dwells in a thing, or for the relation.
 * PAID: gemini-3.1-flash-lite (the only Gemini model allowed on the paid API), ~$0.5 per 1000 passages.
 *
 *   CLASSIFY_IN=... CLASSIFY_OUT=... node classify/classify-animism.mjs
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const SL = process.env.SL_REPO || path.join(process.env.HOME, 'sourcelibrary');
// every call writes a gemini_usage row (endpoint below) — the spend perimeter refuses unlogged call sites
const { callGemini } = await import(path.join(SL, 'scripts', 'lib', 'gemini-script-client.mjs'));
const ENDPOINT = 'scripts/analysis/experience-map/classify/classify-animism.mjs';

const DIR = process.env.ALIVE_OUT || path.join(SL, 'scripts', 'output', 'experience-map', 'aliveness');
const IN = process.env.CLASSIFY_IN || path.join(DIR, 'hits-lex-animism.jsonl');
const OUT = process.env.CLASSIFY_OUT || path.join(DIR, 'classified-animism.jsonl');
const MODEL = 'gemini-3.1-flash-lite'; // fixed: the paid-API rule allows no other Gemini model here
const CONCURRENCY = Number(process.env.CLASSIFY_CONC || 12);
const MAX = Number(process.env.CLASSIFY_MAX || 0);

const REGISTERS = new Set(['rite','testimony','narrative','doctrine','description','ethnography','polemic','poetry','other','junk']);
const POLES = new Set(['person','denied']);
const VOICES = new Set(['insider','outsider','literary']);
const BEINGS = new Set(['the-thing-itself','deity-of-place','nature-spirit','naga-serpent-dragon','nymph','ancestor','animal-person','demon-harmful','other']);
const DWELLINGS = new Set(['river-lake-sea','spring-well','mountain-rock','tree-grove-forest','earth-land','sky-weather','animal','house-hearth','field-crop','cave','town-region','other']);
const RELATIONS = new Set(['offering','appeasement','taboo-offence','address-greeting','bargain-contract','kinship','harm-fear','protection','taming-binding','worship','none']);

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
// Markup-insensitive form for the verbatim gate (see classify-aliveness.mjs): still a HARD gate, the words must be the
// page's words in order; it only stops inline <note>/<gloss>/<term> apparatus from vetoing a true quote.
const loose = (s) => (s || '').replace(/<(note|gloss)>[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const pick = (v, set, dflt) => (typeof v === 'string' && set.has(v)) ? v : dflt;

const PROMPT = (r) => `Analyse a passage from a historical text for a scholarly atlas of how people across cultures have described the world as ALIVE.

BOOK: ${r.book_title} — ${r.book_author || 'unknown'} (${r.book_year || 'n.d.'}, ${r.book_language || 'unknown language'})
PASSAGE:
"""
${r.text.slice(0, 2600)}
"""

The question is ANIMISM, "the inhabited world": does the passage treat a place, river, spring, sea, mountain, rock, tree, grove, forest, animal, the earth, the land, the sky or the weather as a PERSON (someone who can be addressed, offended, pleased, bargained with, feared, or who is kin), or as the HOME of such a person (a nāga in the lake, a lord of the soil, a kami in the rock, the river god, a nymph of the spring, ancestors in the land)?
  "person" — the passage states or presents such a being or person-like place, ideally with a relation to it (offerings, appeasement, taboo, greeting, kinship, a bargain, harm when offended, protection, taming or binding it by oath).
  "denied" — the passage argues that there are no such beings, mocks the belief as superstition, or explains it away.
  null — everything else. Gods of heaven with no place, abstract deities, angels, demons of the soul, a metaphor ("the angry sea"), a place merely called holy, mythology with no place-being, and the world-soul or vital spirit of natural philosophy are null. When in doubt, null.

If not null, give the evidence: the one sentence that states it, COPIED CHARACTER-FOR-CHARACTER from the passage (never paraphrase, modernise or repair). No such sentence means null.

Answer as JSON:
1. register — exactly one: "rite" (offering or ritual procedure), "testimony" (someone reports their own encounter), "narrative" (legend, hagiography, scripture, history), "doctrine" (theory or teaching), "description" (a place described), "ethnography" (an observer reporting other people's beliefs or customs), "polemic" (attacking the belief), "poetry", "other", "junk" (OCR too corrupt)
2. inhabited — null or {"pole":"person"|"denied","evidence":"<verbatim sentence>"}
3. voice — "insider" (the text's own tradition affirms or practises it), "outsider" (reports someone else's belief), "literary" (poetic or mythological convention)
4. being — one of: ${[...BEINGS].join(', ')}
5. dwelling — where it lives, or what it is: ${[...DWELLINGS].join(', ')}
6. relation — the main relation people have with it: ${[...RELATIONS].join(', ')}
7. tradition — one short tag, e.g. tibetan-buddhist, bon, chinese-folk, daoist, shinto, hindu, indian-buddhist, greco-roman, christian, islamic, mongol-siberian, african, native-american, pacific, european-folk, ethnography, other
8. confidence — 0.0 to 1.0

Output ONLY JSON: {"register":"","inhabited":null,"voice":"","being":"","dwelling":"","relation":"","tradition":"","confidence":0}`;

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
      const res = await callGemini({ model: MODEL, prompt: PROMPT(r), endpoint: ENDPOINT, temperature: 0, maxOutputTokens: 500, type: 'analysis', bookId: r.book_id, promptVersion: 'animism-v1' });
      inTok += res.inputTokens || 0; outTok += res.outputTokens || 0;
      const j = extract(res.text);
      if (!j) { fail++; continue; }

      // Hard gate: the layer counts only if its evidence sentence is a verbatim substring of the page.
      const v = j.inhabited; let pole = null, quote = null, unverified = null, evidence = null;
      if (v && typeof v === 'object' && POLES.has(v.pole)) {
        const q = typeof v.evidence === 'string' ? v.evidence.trim() : '';
        if (q && (norm(r.text).includes(norm(q)) || (loose(q).length >= 20 && loose(r.text).includes(loose(q))))) { pole = v.pole; quote = q; }
        else { dropped++; unverified = v.pole; evidence = q.slice(0, 300); }
      }

      appendFileSync(OUT, JSON.stringify({
        page_id: r.page_id, book_id: r.book_id, page_number: r.page_number,
        book_title: r.book_title, book_author: r.book_author,
        book_language: r.book_language, book_year: r.book_year,
        probe_dim: r.dim, slice: r.slice, probe: r.probe, visible: r.visible, lane: r.lane,
        register: pick(j.register, REGISTERS, 'other'),
        inhabited: pole, inhabited_quote: quote, unverified, evidence,
        voice: pick(j.voice, VOICES, null),
        being: pick(j.being, BEINGS, 'other'),
        dwelling: pick(j.dwelling, DWELLINGS, 'other'),
        relation: pick(j.relation, RELATIONS, 'none'),
        quote, quote_verified: !!quote,
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
