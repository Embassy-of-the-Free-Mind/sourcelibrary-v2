// Flash-lite judge validation against the 49 gold pilot packets. Issue #3884.
// Same judgment task as the Claude subagent gold pass; verdicts to lite-verdicts/.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';

const D = (process.env.SOL_DATA_DIR ?? 'scripts/output/sol-harvest') + '/';
const MODEL = 'gemini-3.1-flash-lite';
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('no GEMINI_API_KEY'); process.exit(1); }
mkdirSync(D + 'lite-verdicts', { recursive: true });

const INSTR = `You are an expert classicist judging AI translation quality for the Byzantine Suda lexicon. The packet below contains:
- bekker_greek_ocr: our OCR of Bekker's 1854 edition, the SOURCE our AI translation worked from
- our_page_translations: our AI English translation of the full scan page(s); this entry's translation is embedded among other entries; locate it (typically under a transliterated headword)
- sol_translation: scholar-vetted Suda On Line translation of the same entry
- adler_greek_via_sol: Adler's critical Greek text of the entry

Judge:
1. alignment_ok: is bekker_greek_ocr the same Suda entry as SOL's (same headword and content)? (The OCR excerpt may drag in the start of the following entry — that is packet windowing, not misalignment.)
2. Locate OUR entry's translation inside our_page_translations; our_translation_excerpt = its first ~10 words; our_translation_found=false if genuinely absent.
3. fidelity of OUR translation judged ONLY against bekker_greek_ocr: "faithful" | "minor_issues" | "major_errors". errors: [{type: mistranslation|omission|addition|silent_emendation|garble_passthrough|nuance_flattening, severity: minor|major, detail}]. A faithful rendering of corrupt OCR counts as faithful; rendering garble as fluent confident English is garble_passthrough.
4. divergences between OUR translation and sol_translation: [{kind: our_error|sol_error|edition_difference|style_only, detail}], using the two Greek texts as arbiters.
5. recitation_signal: true iff our English asserts something matching external knowledge or SOL AGAINST our own OCR Greek; recitation_detail.

Respond with ONLY a JSON object:
{"adler_id": str, "alignment_ok": bool, "our_translation_found": bool, "our_translation_excerpt": str|null, "fidelity": str, "errors": [], "divergences": [], "recitation_signal": bool, "recitation_detail": str|null}`;

async function judge(packet, trim = false) {
  const p = { ...packet };
  if (trim) {
    p.our_page_translations = Object.fromEntries(Object.entries(p.our_page_translations)
      .map(([k, v]) => [k, v ? v.slice(0, 6000) : v]));
  }
  const body = {
    contents: [{ parts: [{ text: INSTR + '\n\nPACKET:\n' + JSON.stringify(p) }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 512 },
      responseMimeType: 'application/json',
    },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const text = j.candidates?.[0]?.content?.parts?.map((x) => x.text).join('') ?? '';
  if (!text) throw new Error('empty candidate (finishReason: ' + j.candidates?.[0]?.finishReason + ')');
  return { verdict: JSON.parse(text), usage: j.usageMetadata };
}

const packets = readdirSync(D + 'pilot').filter((f) => f.endsWith('.json') && !f.includes('verdict')).sort();
let tokens = { in: 0, out: 0 };
for (const f of packets) {
  const out = D + 'lite-verdicts/' + f;
  if (existsSync(out)) continue;
  const packet = JSON.parse(readFileSync(D + 'pilot/' + f, 'utf8'));
  let r;
  try { r = await judge(packet); }
  catch (e) {
    console.log(`retry(trim) ${f}: ${e.message}`);
    try { r = await judge(packet, true); }
    catch (e2) { console.log(`FAIL ${f}: ${e2.message}`); continue; }
  }
  writeFileSync(out, JSON.stringify(r.verdict, null, 1));
  tokens.in += r.usage?.promptTokenCount ?? 0;
  tokens.out += r.usage?.candidatesTokenCount ?? 0;
  console.log(`${f}: ${r.verdict.fidelity} (${r.verdict.errors?.length ?? 0} errors)`);
}
console.log('tokens:', tokens, '≈ $' + ((tokens.in * 0.10 + tokens.out * 0.40) / 1e6).toFixed(4));
