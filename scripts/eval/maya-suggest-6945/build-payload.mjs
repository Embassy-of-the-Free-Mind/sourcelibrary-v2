// node build-payload.mjs <payloadName> <ARM:runPrefix>... : one private Mongo scratch doc (ops_reports, read by nothing,
// deleted after use) carrying prompts + crops to the Gemini helper job on main. e.g. `build-payload.mjs arms OK:GK BARE:GBARE`.
// For judge packets: `build-payload.mjs judges JUDGE-k1:GJ` reads $MS/runs/judge_prompts_k1.json.
// PRIOR ART: round 2's build-payload.mjs / put-payload.mjs (l7a scratch); same transport, several runs in one doc.
import fs from 'node:fs'; import { buildPrompt, groups, imagesOf, MS } from './prompts.mjs';
const PFX = 'eval-scratch:maya-suggest-6945:';
const [name, ...specs] = process.argv.slice(2);
const files = { 'run-agy.mjs': fs.readFileSync(new URL('./run-agy.mjs', import.meta.url), 'utf8') }; const imgs = new Set();
for (const s of specs) {
  const [arm, run] = s.split(':');
  const P = arm.startsWith('JUDGE') ? JSON.parse(fs.readFileSync(MS + `runs/judge_prompts_${arm.split('-')[1]}.json`, 'utf8'))
    : groups(arm).map((it) => { const prompt = buildPrompt(arm, it); return { id: it.id, prompt, images: imagesOf(prompt) }; });
  P.forEach((p) => p.images.forEach((f) => imgs.add(f)));
  files[`prompts-${run}.json`] = JSON.stringify(P);
  console.log(run, P.length, 'prompts');
}
const b64 = Object.fromEntries([...imgs].map((f) => [f, fs.readFileSync(MS + 'set/img/' + f).toString('base64')]));
const doc = { _id: PFX + name, note: 'PRIVATE eval scratch for #6903/#6945; read by nothing; delete after use', created_at: new Date().toISOString(), files, b64 };
fs.mkdirSync(MS + 'payload', { recursive: true }); fs.writeFileSync(MS + `payload/${name}.json`, JSON.stringify(doc));
console.log(name, 'images', imgs.size, Math.round(JSON.stringify(doc).length / 1024) + 'KB');
