#!/usr/bin/env node
/**
 * Consolidate the extracted Visuddhimagga material onto the CANONICAL stage
 * sequence, and fill any stage the first pass missed by going back to the pages
 * where that stage is defined.
 *
 * The canonical list is the tradition's own, not mine: nine attainments of
 * concentration (four fine-material jhānas, four immaterial bases, cessation)
 * and the sixteen insight knowledges of the Progress of Insight. Stages 6–11 of
 * the insight sequence are the dukkha ñāṇas — the tradition's own documented
 * "dark night", which is the part with no counterpart in any modern instrument.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/Users/dereklomas/sourcelibrary/package.json');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');
const { stripEditorialWrappers } = await import(
  '/Users/dereklomas/sourcelibrary/scripts/lib/strip-editorial-wrappers.mjs'
);

const HERE = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/b4cc9f10-7660-4f2b-b3cf-554d4017f8f7/scratchpad';
const BOOK = '69b63e9c2a1dde00d5a9f20a';
const req = (n) => { const v = process.env[n]; if (!v) throw new Error(`Missing ${n}`); return v; };
const supabase = createClient(req('SUPABASE_URL'), req('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY });

// id, display name, Pali, group, and the regex that finds where the manual defines it
const CANON = [
  ['access_concentration','Access concentration','upacāra-samādhi','concentration',/access concentration|upac[āa]ra|counterpart sign|pa[ṭt]ibh[āa]ga.nimitta/i],
  ['jhana_1','First jhāna','paṭhama-jhāna','concentration',/first jh[āa]na/i],
  ['jhana_2','Second jhāna','dutiya-jhāna','concentration',/second jh[āa]na/i],
  ['jhana_3','Third jhāna','tatiya-jhāna','concentration',/third jh[āa]na/i],
  ['jhana_4','Fourth jhāna','catuttha-jhāna','concentration',/fourth jh[āa]na/i],
  ['base_space','Base of boundless space','ākāsānañcāyatana','concentration',/boundless space|infinity of space|[āa]k[āa]s[āa]na[ñn]c[āa]yatana/i],
  ['base_consciousness','Base of boundless consciousness','viññāṇañcāyatana','concentration',/boundless consciousness|infinity of consciousness|vi[ññn][āa][ṇn]a[ñn]c[āa]yatana/i],
  ['base_nothingness','Base of nothingness','ākiñcaññāyatana','concentration',/base consisting of nothingness|nothingness|[āa]ki[ñn]ca[ññn][āa]yatana/i],
  ['base_neither','Neither perception nor non-perception','nevasaññānāsaññāyatana','concentration',/neither perception nor non-perception/i],
  ['cessation','Attainment of cessation','nirodha-samāpatti','concentration',/attainment of cessation|nirodha.sam[āa]patti/i],

  ['nana_01','Discernment of mind and matter','nāma-rūpa-pariccheda','insight',/mentality.materiality|n[āa]ma.r[ūu]pa/i],
  ['nana_02','Discerning conditions','paccaya-pariggaha','insight',/discerning of conditions|discernment of conditions|paccaya/i],
  ['nana_03','Comprehension by groups','sammasana','insight',/comprehension by groups|sammasana/i],
  ['nana_04','Knowledge of rise and fall','udayabbaya-ñāṇa','insight',/rise and fall|arising and passing away|udayabbaya/i],
  ['nana_05','Knowledge of dissolution','bhaṅga-ñāṇa','insight',/contemplation of dissolution|knowledge of dissolution|bha[ṅn]ga/i],
  ['nana_06','Appearance as terror','bhaya-ñāṇa','insight',/appearance as terror|terror|bhaya/i],
  ['nana_07','Contemplation of danger','ādīnava-ñāṇa','insight',/contemplation of danger|knowledge of danger|[āa]d[īi]nava/i],
  ['nana_08','Dispassion / disenchantment','nibbidā-ñāṇa','insight',/dispassion|disenchant|nibbid[āa]/i],
  ['nana_09','Desire for deliverance','muñcitukamyatā-ñāṇa','insight',/desire for deliverance|mu[ñn]citukamyat[āa]/i],
  ['nana_10','Re-observation','paṭisaṅkhā-ñāṇa','insight',/re.observation|reflection|pa[ṭt]isa[ṅn]kh[āa]/i],
  ['nana_11','Equanimity about formations','saṅkhārupekkhā-ñāṇa','insight',/equanimity about formations|sa[ṅn]kh[āa]rupekkh[āa]/i],
  ['nana_12','Conformity','anuloma-ñāṇa','insight',/conformity knowledge|conformity|anuloma/i],
  ['nana_13','Change-of-lineage','gotrabhū-ñāṇa','insight',/change.of.lineage|gotrabh[ūu]/i],
  ['nana_14','Path knowledge','magga-ñāṇa','insight',/path knowledge|knowledge of the path/i],
  ['nana_15','Fruition knowledge','phala-ñāṇa','insight',/fruition knowledge|fruition attainment/i],
  ['nana_16','Reviewing knowledge','paccavekkhaṇa-ñāṇa','insight',/reviewing knowledge|paccavekkha[ṇn]a/i],
];

/* ---------- pages ---------- */
const pages = [];
for (let off = 0; ; off += 500) {
  const { data, error } = await supabase.from('page_translations')
    .select('page_id,page_number,translation').eq('book_id', BOOK)
    .order('page_number').range(off, off + 499);
  if (error || !data || !data.length) break;
  pages.push(...data);
  if (data.length < 500) break;
}
pages.forEach((p) => { p.text = stripEditorialWrappers(p.translation || '').trim(); });
console.log(`${pages.length} pages`);

/* ---------- seed from the first extraction pass ---------- */
const prior = JSON.parse(readFileSync(`${HERE}/jhana-taxonomy.json`, 'utf8'));
function seedFor(name, pali) {
  const n = name.toLowerCase(), p = (pali || '').toLowerCase().replace(/[^a-z]/g, '');
  const hits = prior.filter((s) => {
    const sn = (s.name || '').toLowerCase();
    const sp = (s.pali || '').toLowerCase().replace(/[^a-z]/g, '');
    const key = n.replace(/^(knowledge of |contemplation of |base of |appearance as )/, '');
    return sn.includes(key) || (p && sp && (sp.includes(p) || p.includes(sp)));
  });
  return [...new Set(hits.flatMap((h) => h.probes))];
}

/* ---------- fill gaps from the defining pages ---------- */
async function extractFor(stage, texts) {
  const res = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: `These passages are from the Visuddhimagga. Extract how the text characterises the stage "${stage.name}" (Pali: ${stage.pali}) AS EXPERIENCED.

PASSAGES:
"""
${texts.join('\n---\n').slice(0, 9000)}
"""

Return ONLY JSON: {"probes":["",""],"markers":["",""]}
- "probes": 3 sentences a practitioner might write reporting THIS stage from the inside, in plain English but using the manual's own imagery and vocabulary. Experience, not doctrine. No stage names in the sentence.
- "markers": short phrases the text gives for recognising it.
If the passages do not characterise this stage, return {"probes":[],"markers":[]}.`,
    config: { temperature: 0.1, maxOutputTokens: 900 },
  });
  const m = (res.text || '').match(/\{[\s\S]*\}/);
  if (!m) return { probes: [], markers: [] };
  try { return JSON.parse(m[0]); } catch { return { probes: [], markers: [] }; }
}

const out = [];
let i = 0;
async function worker() {
  while (i < CANON.length) {
    const [id, name, pali, group, re] = CANON[i++];
    const stage = { id, name, pali, group };
    let probes = seedFor(name, pali);
    const defPages = pages.filter((p) => re.test(p.text) && p.text.length > 500).slice(0, 3);
    if (probes.length < 3 && defPages.length) {
      const got = await extractFor(stage, defPages.map((p) => p.text.slice(0, 3200)));
      probes = [...new Set([...probes, ...(got.probes || [])])];
      stage.markers = got.markers || [];
    }
    stage.probes = probes.filter((p) => typeof p === 'string' && p.length > 30).slice(0, 4);
    stage.definedOnPages = defPages.map((p) => p.page_number);
    out.push(stage);
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
out.sort((a, b) => CANON.findIndex(c => c[0] === a.id) - CANON.findIndex(c => c[0] === b.id));

writeFileSync(`${HERE}/probes-jhana.json`, JSON.stringify({
  _note: 'Probe set derived FROM the Visuddhimagga itself (Ñāṇamoli trans., held in Source Library). Stage list and vocabulary are the tradition\'s, not the authors\'. Built to test whether an indigenous taxonomy carves the corpus differently from the MEQ30/5D-ASC-derived probe set used in the main atlas.',
  source: { book_id: BOOK, title: 'Visuddhimagga (The Path of Purification)' },
  dimensions: out.filter((s) => s.probes.length).map((s) => ({
    id: s.id, label: s.name, pali: s.pali, group: s.group,
    source: 'Visuddhimagga', probes: s.probes,
  })),
}, null, 2));

const withProbes = out.filter((s) => s.probes.length);
console.log(`\n${withProbes.length}/${CANON.length} canonical stages have probes`);
for (const s of out) {
  console.log(`  ${s.group === 'insight' ? 'INS' : 'CON'} ${s.name.slice(0, 38).padEnd(40)} probes=${s.probes.length} pp=${s.definedOnPages.slice(0, 2).join(',')}`);
}
