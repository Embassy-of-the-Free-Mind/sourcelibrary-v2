#!/usr/bin/env node
/**
 * Second pass of the animism layer (#6652): the Gemini CLI (subscription, $0) re-reads every passage the flash-lite screen
 * (classify-animism.mjs) marked, and confirms or rejects it under a strict rubric, and checks the voice. Rates are only
 * quoted after this pass, as for the other three layers.
 *
 * WHO RUNS IT: a session or runner on the Hetzner box (agy installed and signed in). Resume by page_id; quota STOPS the run.
 * PRIOR ART: classify/judge-aliveness.mjs — same runner around scripts/lib/agy-cli.mjs gatedTextCall, kept verbatim; its
 * rubric is the three aliveness layers and has no claim of the form "a person dwells in this place".
 *   node judge-animism.mjs <classified.jsonl> <judged.jsonl> --texts <input.jsonl> [--model gemini-3.8-flash-low] [--conc 15]
 */
import fs from 'node:fs'; import path from 'node:path';
const SL = process.env.SL_REPO || path.join(process.env.HOME, 'sourcelibrary');
const { gatedTextCall } = await import(path.join(SL, 'scripts', 'lib', 'agy-cli.mjs'));

const [IN, OUT] = process.argv.slice(2, 4);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODEL = arg('--model', 'gemini-3.8-flash-low'); const CONC = +arg('--conc', 15); const MAX = +arg('--max', 0);
const TEXTS = arg('--texts', null);
if (!IN || !OUT || !TEXTS) { console.error('usage: judge-animism.mjs <classified.jsonl> <judged.jsonl> --texts <input.jsonl>'); process.exit(2); }

const text = new Map(); for (const l of fs.readFileSync(TEXTS, 'utf8').split('\n')) { if (!l) continue; const r = JSON.parse(l); text.set(r.page_id, r.text); }
const rows = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.inhabited);
const done = new Set(); if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) { if (l) try { done.add(JSON.parse(l).page_id); } catch {} }
let todo = rows.filter((r) => !done.has(r.page_id) && text.has(r.page_id)); if (MAX) todo = todo.slice(0, MAX);
console.log(`${rows.length} screened-positive rows, ${done.size} judged, ${todo.length} to judge with ${MODEL}`);

const RUBRIC = `You are checking a claim made about a passage from a historical text, for a scholarly atlas of ANIMISM: places, waters, mountains, trees, animals, the land or the sky treated as persons, or as the homes of persons. Be strict: CONFIRM only if a careful reader would agree the passage states it outright.

CONFIRM "person" only if the passage presents a particular place or natural thing (a river, spring, lake, sea, mountain, rock, tree, grove, forest, field, the earth or land, the sky or weather, an animal) as a person, or as the dwelling of a person or spirit tied to that place (a nāga of the lake, a lord of the soil, a mountain god, a kami, a river god, a nymph of the spring, ancestors in the land), with whom people can stand in a relation. A legend, a rite, a report of other people's belief, or a poem all count, if the being is tied to the place.
CONFIRM "denied" only if the passage argues there are no such beings, or attacks or explains away the belief.
Reject: gods of heaven or abstract deities with no place; angels; demons or spirits of the soul; serpents or dragons as mere animals; metaphor or personification for style ("the smiling meadow"); a place merely called holy; the world-soul or vital spirit of natural philosophy; a name in a list with nothing said of it.

Also say the VOICE: "insider" (the text's own tradition affirms or practises it), "outsider" (it reports someone else's belief: ethnography, travel, missionary, polemic), or "literary" (poetic or mythological convention).`;

const prompt = (r) => `${RUBRIC}

BOOK: ${r.book_title} — ${r.book_author || 'unknown'} (${r.book_year || 'n.d.'})
PASSAGE (English translation):
"""
${text.get(r.page_id).slice(0, 2600)}
"""

CLAIM TO CHECK: inhabited = "${r.inhabited}", evidence: "${r.inhabited_quote}"

Reply with ONLY this JSON, between two marker lines <<<BEGIN>>> and <<<END>>>, nothing outside them:
{"confirm":false,"pole":null,"voice":null,"reason":""}
Do not open, read or write any file and do not use any tool: the passage is above.`;

let i = 0, ok = 0, bad = 0, stop = false;
async function worker() {
  while (!stop && i < todo.length) {
    const r = todo[i++];
    const res = await gatedTextCall(prompt(r), { model: MODEL, task: 'translate', attempts: 2 });
    if (res.cls === 'quota') { stop = true; console.error('QUOTA — stopping; resume later'); break; }
    let j = null; try { j = JSON.parse((res.answer || '').match(/\{[\s\S]*\}/)[0]); } catch {}
    if (!j) { bad++; continue; }
    const pole = j.confirm === true ? (j.pole === 'person' || j.pole === 'denied' ? j.pole : r.inhabited) : null;
    const voice = ['insider', 'outsider', 'literary'].includes(j.voice) ? j.voice : null;
    fs.appendFileSync(OUT, JSON.stringify({ page_id: r.page_id, judge_model: MODEL, judged_at: new Date().toISOString(),
      inhabited: pole, voice, reason: String(j.reason || '').slice(0, 300) }) + '\n'); ok++;
    if (ok % 50 === 0) console.log(`  ${ok}/${todo.length} judged, ${bad} unparsed`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`done judged=${ok} unparsed=${bad}${stop ? ' (stopped on quota)' : ''}`);
