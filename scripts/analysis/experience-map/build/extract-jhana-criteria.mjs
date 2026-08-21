#!/usr/bin/env node
/**
 * Extract a phenomenological taxonomy FROM ITS OWN MANUAL.
 *
 * The v2 atlas imposed 36 categories derived from twentieth-century questionnaires
 * (MEQ30, 5D-ASC, Hood). That is circular: the map cannot find a kind of experience
 * the probe set did not name, so its structure is partly a picture of my instrument.
 *
 * The correction is to let a tradition supply its own categories. The Visuddhimagga
 * is the strongest candidate any premodern tradition produced: it defines each
 * absorption (jhāna) and each insight knowledge (ñāṇa) by explicit entry markers,
 * factors present and absent, and characteristic disturbances — an ordered,
 * criterion-based state model written ~1,500 years before the MEQ.
 *
 * This script finds the passages in our own copy where those criteria are stated,
 * and has a model extract the markers IN THE TEXT'S OWN VOCABULARY. The output is a
 * probe set we did not author.
 *
 * PAID: a few dozen gemini-3.1-flash-lite calls (~$0.05).
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/Users/dereklomas/sourcelibrary/package.json');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');
const { stripEditorialWrappers } = await import(
  '/Users/dereklomas/sourcelibrary/scripts/lib/strip-editorial-wrappers.mjs'
);

const HERE = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/b4cc9f10-7660-4f2b-b3cf-554d4017f8f7/scratchpad';
const BOOK = '69b63e9c2a1dde00d5a9f20a';  // Visuddhimagga, Ñāṇamoli English, 848 pp translated
const req = (n) => { const v = process.env[n]; if (!v) throw new Error(`Missing ${n}`); return v; };
const supabase = createClient(req('SUPABASE_URL'), req('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY });

/* ---------- pull the whole book ---------- */
const pages = [];
for (let off = 0; ; off += 500) {
  const { data, error } = await supabase
    .from('page_translations')
    .select('page_id,page_number,translation')
    .eq('book_id', BOOK).order('page_number').range(off, off + 499);
  if (error) { console.error(error.message); break; }
  if (!data || !data.length) break;
  pages.push(...data);
  if (data.length < 500) break;
}
console.log(`fetched ${pages.length} pages of the Visuddhimagga`);

for (const p of pages) p.text = stripEditorialWrappers(p.translation || '').trim();

/* ---------- locate the two doctrinal cores ---------- */
// Jhāna: the absorption factors and the stock formula for each of the four/five.
// Ñāṇa: the insight knowledges of Purification by Knowledge and Vision of the Way,
// which include the dukkha ñāṇas — the documented "dark night" sequence.
const JHANA_RE = /\b(first|second|third|fourth|fifth)\s+jh[āa]na\b|applied thought|sustained thought|\brapture\b|one-pointedness|access concentration|counterpart sign|\bnimitta\b/i;
const NANA_RE = /\b(ñ[āa]ṇa|nana)\b|knowledge of (rise and fall|dissolution|terror|danger|disappointment|desire for deliverance|re-observation|equanimity about formations)|arising and passing away|\bbhaṅga\b|\bbhaya\b|\bnibbid[āa]\b|conformity knowledge|change-of-lineage/i;

const jh = pages.filter((p) => p.text.length > 400 && JHANA_RE.test(p.text));
const na = pages.filter((p) => p.text.length > 400 && NANA_RE.test(p.text));
console.log(`candidate pages — jhāna: ${jh.length}, insight knowledges: ${na.length}`);

/* ---------- extract the criteria, in the text's own words ---------- */
const SCHEMA_NOTE = `Return ONLY JSON of the form
{"stages":[{"name":"","pali":"","order":0,"markers":["",""],"factors_present":[""],"factors_absent":[""],"first_person_probe":""}]}
- "markers" are the experiential signs the TEXT itself gives for recognising this stage. Quote or closely paraphrase the manual's own vocabulary; do not substitute modern psychological terms.
- "first_person_probe" is one sentence a practitioner might write reporting THIS stage from the inside, using the manual's vocabulary, in plain English. It must describe experience, not doctrine.
- If the passage does not define a stage, return {"stages":[]}.`;

async function extract(chunk, kind) {
  const res = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: `From this passage of the Visuddhimagga, extract any ${kind} that the passage DEFINES, with the criteria the text gives for recognising it.

PASSAGE:
"""
${chunk}
"""

${SCHEMA_NOTE}`,
    config: { temperature: 0, maxOutputTokens: 1400 },
  });
  const m = (res.text || '').match(/\{[\s\S]*\}/);
  if (!m) return [];
  try { return JSON.parse(m[0]).stages || []; } catch { return []; }
}

async function harvest(list, kind, cap) {
  const out = [];
  const sel = list.slice(0, cap);
  let i = 0;
  async function w() {
    while (i < sel.length) {
      const p = sel[i++];
      try {
        const st = await extract(p.text.slice(0, 4000), kind);
        st.forEach((s) => out.push({ ...s, kind, page_number: p.page_number, page_id: p.page_id }));
      } catch (e) { /* skip */ }
    }
  }
  await Promise.all([w(), w(), w(), w()]);
  return out;
}

const jhanaStages = await harvest(jh, 'jhāna (meditative absorption)', 45);
console.log(`jhāna stage definitions extracted: ${jhanaStages.length}`);
const nanaStages = await harvest(na, 'insight knowledge (ñāṇa)', 45);
console.log(`insight-knowledge definitions extracted: ${nanaStages.length}`);

/* ---------- consolidate into one probe set ---------- */
const all = [...jhanaStages, ...nanaStages].filter((s) => s.name && s.first_person_probe);
const byName = new Map();
for (const s of all) {
  const key = (s.name || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
  if (!key) continue;
  if (!byName.has(key)) byName.set(key, { ...s, probes: [], pages: [] });
  const e = byName.get(key);
  if (s.first_person_probe && !e.probes.includes(s.first_person_probe)) e.probes.push(s.first_person_probe);
  (s.markers || []).forEach((m) => { if (m && !e.probes.includes(m) && m.length > 25) e.probes.push(m); });
  e.pages.push(s.page_number);
}
const consolidated = [...byName.values()]
  .map((s) => ({ ...s, probes: s.probes.slice(0, 4) }))
  .filter((s) => s.probes.length);

writeFileSync(`${HERE}/jhana-taxonomy-raw.json`, JSON.stringify(all, null, 2));
writeFileSync(`${HERE}/jhana-taxonomy.json`, JSON.stringify(consolidated, null, 2));
console.log(`\n${consolidated.length} distinct stages with probes -> jhana-taxonomy.json`);
for (const s of consolidated) {
  console.log(`  ${(s.kind || '').slice(0, 6)} ${String(s.name).slice(0, 42).padEnd(44)} probes=${s.probes.length} pp=${s.pages.slice(0, 3).join(',')}`);
}
