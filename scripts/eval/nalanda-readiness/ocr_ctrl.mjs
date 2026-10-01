// PRIOR ART: scripts/lib/gemini-script-client.mjs is the client this uses (metered); no existing script OCRs a rendered control page.
// Runs on Hetzner (the laptop is geo-blocked for Gemini): node --env-file=/root/sourcelibrary/.env.production.local ocr_ctrl.mjs <model>
// Engine positive control (#nalanda-readiness 2026-09-30): OCR rendered GRETIL pages with the Sanskrit lane model.
import fs from 'fs';
import { callGemini } from '/root/sourcelibrary/scripts/lib/gemini-script-client.mjs';
const MODEL = process.argv[2] || 'gemini-3-flash-preview';
const PROMPT = 'Transcribe all text on this page exactly as printed, in its original script (Devanagari). Output only the transcription, preserving line breaks. Do not translate, normalise or correct.';
const out = [];
for (const f of fs.readdirSync('.').filter(f => f.endsWith('.png'))) {
  const r = await callGemini({ model: MODEL, prompt: PROMPT, endpoint: 'eval/nalanda-readiness-ctrl', imageParts: [{ mimeType: 'image/png', data: fs.readFileSync(f) }], type: 'eval' });
  out.push({ id: 'render:' + f.replace('.png', ''), model: MODEL, text: r.text, in: r.inputTokens, out: r.outputTokens });
  console.log(f, r.outputTokens, r.finishReason);
}
fs.writeFileSync(`ocr-${MODEL}.json`, JSON.stringify(out));
