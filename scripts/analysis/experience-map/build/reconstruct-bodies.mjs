#!/usr/bin/env node
/**
 * Reconstruct each tradition's subtle-body map FROM ITS OWN SOURCES, then align
 * the reconstructions on a shared anatomical axis so they can be compared.
 *
 * Two design decisions carry the argument:
 *
 *  1. Probes are written in each system's own idiom, never in a neutral
 *     comparative vocabulary, so retrieval does not presuppose the alignment we
 *     are trying to test.
 *  2. Alignment happens AFTER extraction, on BODY LOCATION — the one variable all
 *     these systems share, because they are all describing the same object. Names,
 *     counts, colours and elements are extracted as attributes and compared
 *     afterwards rather than used to match centres to each other.
 *
 * Chinese channel-and-point medicine is retrieved as a control: a therapeutic map
 * of the same body with no experiential-ascent claim.
 *
 * PAID: gemini-3.1-flash-lite extraction, roughly $0.30.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/Users/dereklomas/sourcelibrary/package.json');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');
const { stripEditorialWrappers } = await import(
  '/Users/dereklomas/sourcelibrary/scripts/lib/strip-editorial-wrappers.mjs'
);

const HERE = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/b4cc9f10-7660-4f2b-b3cf-554d4017f8f7/scratchpad';
const req = (n) => { const v = process.env[n]; if (!v) throw new Error(`Missing ${n}`); return v; };
const KEY = process.env.GEMINI_API_KEY_TIER3 || req('GEMINI_API_KEY');
const supabase = createClient(req('SUPABASE_URL'), req('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const ai = new GoogleGenAI({ apiKey: KEY });

const HITS = `${HERE}/hits-body.jsonl`;
const OUT = `${HERE}/centres.jsonl`;

// The shared axis. Ordered head-downwards so it can be drawn as a body.
const LOCATIONS = ['above-crown','crown','brow','back-of-head','eyes','ears','throat','right-chest',
  'heart','left-chest','solar-plexus','stomach','navel','lower-abdomen','genitals','perineum-base',
  'spine','arms-hands','legs-feet','whole-body','outside-body','unspecified'];

/* ------------------------------------------------------------------ retrieval */
async function embed(text) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:batchEmbedContents?key=${KEY}`,
        { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ requests:[{ model:'models/gemini-embedding-2-preview', content:{parts:[{text}]}, outputDimensionality:768 }] }),
          signal: AbortSignal.timeout(20000) });
      if (r.ok) return (await r.json())?.embeddings?.[0]?.values;
    } catch {}
    await new Promise((s) => setTimeout(s, 800 * (a + 1)));
  }
  return null;
}
async function rpc(vec, langs) {
  for (let a = 0; a < 3; a++) {
    const { data, error } = await supabase.rpc('match_semantic', {
      query_embedding: vec, match_threshold: 0.45, match_count: 50,
      filter_tenant_id: null, filter_language: null, filter_year_min: null, filter_year_max: null,
      filter_languages: langs || null, filter_exclude_languages: null,
    });
    if (!error) return data || [];
    await new Promise((s) => setTimeout(s, 700 * (a + 1)));
  }
  return [];
}

const { systems } = JSON.parse(readFileSync(`${HERE}/probes-body.json`, 'utf8'));
// language slices that matter for these traditions, plus an unfiltered pass
const SLICES = [null, ['Sanskrit'], ['Tibetan'], ['Chinese'], ['Classical Chinese'], ['Arabic'],
  ['Persian'], ['Hebrew'], ['Latin'], ['English'], ['German'], ['Greek'], ['Russian'], ['French']];

if (!existsSync(HITS)) {
  const seen = new Set();
  const rows = [];
  for (const sys of systems) {
    let added = 0;
    for (const probe of sys.probes) {
      const v = await embed(probe);
      if (!v) continue;
      const vec = JSON.stringify(v);
      for (const langs of SLICES) {
        const hits = await rpc(vec, langs);
        for (const r of hits) {
          const key = `${sys.id}:${r.page_id}`;
          if (seen.has(key)) continue;
          const text = stripEditorialWrappers(r.translation || '').trim();
          if (text.length < 200) continue;
          seen.add(key);
          rows.push({ system: sys.id, probe, page_id: r.page_id, book_id: r.book_id,
            page_number: r.page_number, book_title: r.book_title, book_author: r.book_author,
            book_language: r.book_language, book_year: r.book_year,
            similarity: r.similarity, text: text.slice(0, 3000) });
          added++;
        }
      }
    }
    console.log(`${sys.id.padEnd(18)} +${added}`);
  }
  writeFileSync(HITS, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`retrieved ${rows.length} passages -> hits-body.jsonl\n`);
}

/* ----------------------------------------------------------------- extraction */
const rows = readFileSync(HITS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const done = new Set();
if (existsSync(OUT)) for (const l of readFileSync(OUT, 'utf8').split('\n')) {
  if (l.trim()) try { const j = JSON.parse(l); done.add(`${j.system}:${j.page_id}`); } catch {}
}
const todo = rows.filter((r) => !done.has(`${r.system}:${r.page_id}`));
console.log(`${rows.length} passages, ${todo.length} to extract`);

const SYS = Object.fromEntries(systems.map((s) => [s.id, s]));

const PROMPT = (r) => `This passage is being read as a source for the subtle-body map of one tradition: ${SYS[r.system].label}.

BOOK: ${r.book_title} — ${r.book_author || 'unknown'} (${r.book_year || 'n.d.'}, ${r.book_language || '?'})
PASSAGE:
"""
${r.text.slice(0, 2400)}
"""

Extract every BODILY CENTRE, LOCUS OR FIELD the passage actually locates on or in the body. Do not infer centres the passage does not mention. If it names none, return {"centres":[]}.

For each, give:
- "name": the name used in the passage (transliterated if needed)
- "location": ONE of exactly these: ${LOCATIONS.join(', ')}
- "ordinal": its position counting upward from the lowest, if the passage states an order, else null
- "total_in_system": how many centres the passage says this system has, if stated, else null
- "colour": colour assigned by THIS passage, else null
- "element": element/phase assigned, else null
- "petals_or_spokes": number, if given, else null
- "deity_or_letter": presiding deity, letter or syllable, else null
- "function": one of "experiential" (the passage says what is felt or perceived there), "ritual" (something is visualised or recited there), "physiological" (breath, heat, fluid, health), "cosmological" (it corresponds to a world, planet or divine attribute), "therapeutic" (treating illness)
- "experience": if function is experiential, the phenomenon reported there, in a short phrase, else null

Also give "is_first_person": true if the passage reports someone's own experience of these centres.

Output ONLY JSON: {"centres":[],"is_first_person":false}`;

const extract = (t) => { const m = (t || '').match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };
const LOCSET = new Set(LOCATIONS);
const FUNCS = new Set(['experiential','ritual','physiological','cosmological','therapeutic']);

let i = 0, ok = 0, fail = 0, centres = 0;
async function worker() {
  while (i < todo.length) {
    const r = todo[i++]; const n = i;
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite', contents: PROMPT(r),
        config: { temperature: 0, maxOutputTokens: 1200 },
      });
      const j = extract(res.text);
      if (!j) { fail++; continue; }
      const list = Array.isArray(j.centres) ? j.centres : [];
      for (const c of list) {
        if (!c || !c.name || !LOCSET.has(c.location)) continue;
        appendFileSync(OUT, JSON.stringify({
          system: r.system, page_id: r.page_id, book_id: r.book_id,
          book_title: r.book_title, book_author: r.book_author,
          book_language: r.book_language, book_year: r.book_year,
          name: String(c.name).slice(0, 60), location: c.location,
          ordinal: Number.isFinite(c.ordinal) ? c.ordinal : null,
          total_in_system: Number.isFinite(c.total_in_system) ? c.total_in_system : null,
          colour: c.colour ? String(c.colour).slice(0, 30) : null,
          element: c.element ? String(c.element).slice(0, 30) : null,
          petals: Number.isFinite(c.petals_or_spokes) ? c.petals_or_spokes : null,
          deity_or_letter: c.deity_or_letter ? String(c.deity_or_letter).slice(0, 40) : null,
          fn: FUNCS.has(c.function) ? c.function : 'unspecified',
          experience: c.experience ? String(c.experience).slice(0, 160) : null,
          first_person: !!j.is_first_person,
        }) + '\n');
        centres++;
      }
      ok++;
      if (n % 300 === 0) console.log(`  ${n}/${todo.length} ok=${ok} centres=${centres}`);
    } catch (e) {
      fail++;
      if (fail === 1) console.error('  first error:', e && e.message);
      await new Promise((s) => setTimeout(s, 1500));
    }
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()));
console.log(`done ok=${ok} fail=${fail} centres extracted=${centres}`);
