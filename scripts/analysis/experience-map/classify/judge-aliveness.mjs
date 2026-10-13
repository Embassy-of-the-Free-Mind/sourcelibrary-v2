#!/usr/bin/env node
/**
 * Second pass of the aliveness instrument (#6652): a stronger model, on the Gemini CLI (subscription, $0), re-reads every
 * passage the flash-lite screen (classify-aliveness.mjs) put on any layer, and confirms or rejects each layer under a
 * strict rubric. Why: on the 745-page RANDOM baseline the screen marked 27% of pages, and by eye perhaps one in five of
 * those was real ("the stars are understood as angels" counted as ensouled heavens). The screen is kept for recall
 * and cost; this pass sets precision. Rates are only quoted after it.
 *
 * WHO RUNS IT: a session on the Hetzner box (agy installed and signed in). Resume by page_id; a quota error STOPS the run.
 * PRIOR ART: scripts/lib/agy-cli.mjs gatedTextCall — the #6523 call (plan mode, tool gate, <<<BEGIN>>>/<<<END>>> markers),
 * used unchanged; scripts/batch/cli-translate.mjs is the pattern for a runner around it. Neither judges a claim.
 *   node judge-aliveness.mjs <classified.jsonl> <judged.jsonl> [--model gemini-3.8-flash-high] [--conc 6] [--max N]
 */
import fs from 'node:fs'; import path from 'node:path';
const SL = process.env.SL_REPO || path.join(process.env.HOME, 'sourcelibrary');
const { gatedTextCall } = await import(path.join(SL, 'scripts', 'lib', 'agy-cli.mjs'));

const [IN, OUT] = process.argv.slice(2, 4);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODEL = arg('--model', 'gemini-3.8-flash-high'); const CONC = +arg('--conc', 6); const MAX = +arg('--max', 0);
const TEXTS = arg('--texts', null); // jsonl with page_id + text (the classifier input); the classified rows carry no text
if (!IN || !OUT || !TEXTS) { console.error('usage: judge-aliveness.mjs <classified.jsonl> <judged.jsonl> --texts <input.jsonl>'); process.exit(2); }

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const text = new Map(); for (const l of fs.readFileSync(TEXTS, 'utf8').split('\n')) { if (!l) continue; const r = JSON.parse(l); text.set(r.page_id, r.text); }
const rows = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.felt || r.world || r.made);
const done = new Set(); if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) { if (l) try { done.add(JSON.parse(l).page_id); } catch {} }
let todo = rows.filter((r) => !done.has(r.page_id) && text.has(r.page_id)); if (MAX) todo = todo.slice(0, MAX);
console.log(`${rows.length} screened-positive rows, ${done.size} judged, ${todo.length} to judge with ${MODEL}`);

const RUBRIC = `You are checking claims made about a passage from a historical text, for a scholarly atlas of how people have described ALIVENESS. Be strict: a claim is CONFIRMED only if a careful reader would agree the passage states it outright, not by implication, metaphor read too literally, or ordinary description.

felt  — CONFIRM "alive" only if a person describes FROM THE INSIDE what it was like to feel alive: vigour or life surging, the world turning vivid, being reborn, gladness felt in the body, strength returning. CONFIRM "dead" only if a person describes feeling dead inside: acedia, numbness, torpor, melancholy heaviness, "I lived but was not alive". Reject: someone lives, dies or is healed; exhortation; sin as spiritual death; an emotion named in passing.
world — CONFIRM "alive" only if the passage claims that something not ordinarily thought alive IS alive or ensouled (the cosmos has a soul; stars or spheres are living or soul-moved; earth breathes or has veins; metals or stones grow, ripen, have seed or soul; plants have a soul or feel; a vital breath or spirit — pneuma, spiritus, prana, qi — animates things). CONFIRM "dead" only if it argues matter, animals or nature are inert or mere mechanism. Reject: plants grow or heal; animals behave; stars have effects; ordinary physiology; allegory (stars as angels).
made  — CONFIRM "alive" only if a place, building, garden, city, image, statue or crafted work is called alive, living, ensouled, inhabited by a god or spirit, or so lifelike it seems to live. CONFIRM "dead" only if one is explicitly called lifeless, cold, dead or without spirit. Reject: things built, ruined, used in ritual, or merely beautiful or holy.`;

const prompt = (r) => `${RUBRIC}

BOOK: ${r.book_title} — ${r.book_author || 'unknown'} (${r.book_year || 'n.d.'})
PASSAGE (English translation):
"""
${text.get(r.page_id).slice(0, 2600)}
"""

CLAIMS TO CHECK:
${['felt', 'world', 'made'].filter((L) => r[L]).map((L) => `- ${L} = "${r[L]}", evidence: "${r[L + '_quote']}"`).join('\n')}

For each claimed layer answer confirm true/false, and if you confirm, say whether the pole is right. Give a one-line reason.
Reply with ONLY this JSON, between two marker lines <<<BEGIN>>> and <<<END>>>, nothing outside them:
{"felt":{"confirm":false,"pole":null,"reason":""},"world":{"confirm":false,"pole":null,"reason":""},"made":{"confirm":false,"pole":null,"reason":""}}
(Leave unclaimed layers as confirm false.) Do not open, read or write any file and do not use any tool: the passage is above.`;

let i = 0, ok = 0, bad = 0, stop = false;
async function worker() {
  while (!stop && i < todo.length) {
    const r = todo[i++];
    const res = await gatedTextCall(prompt(r), { model: MODEL, task: 'translate', attempts: 2 });
    if (res.cls === 'quota') { stop = true; console.error('QUOTA — stopping; resume later'); break; }
    let j = null; try { j = JSON.parse((res.answer || '').match(/\{[\s\S]*\}/)[0]); } catch {}
    if (!j) { bad++; continue; }
    const out = { page_id: r.page_id, judge_model: MODEL, judged_at: new Date().toISOString() };
    for (const L of ['felt', 'world', 'made']) {
      const v = j[L] || {};
      const pole = r[L] && v.confirm === true ? (v.pole === 'alive' || v.pole === 'dead' ? v.pole : r[L]) : null;
      out[L] = pole; out[L + '_reason'] = r[L] ? String(v.reason || '').slice(0, 300) : null;
    }
    fs.appendFileSync(OUT, JSON.stringify(out) + '\n'); ok++;
    if (ok % 50 === 0) console.log(`  ${ok}/${todo.length} judged, ${bad} unparsed`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`done judged=${ok} unparsed=${bad}${stop ? ' (stopped on quota)' : ''}`);
