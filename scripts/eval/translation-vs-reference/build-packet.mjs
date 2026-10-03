#!/usr/bin/env node
// PRIOR ART: scripts/eval/tibetan-mt-ab/build-judge-packet.mjs (#4742, and its --generic mode for #5606) — seeded
// shuffle, key kept apart, text_hash pinned, positive control + same-arm pairs. It reads one sample layout
// (ids-final.txt + refs-final.json + arm dirs) and has one shuffle for both judges. scripts/eval/translation-corpus-
// audit/build-packets.mjs (#5274) has swap/drop/repeat controls but no reference and one candidate. This generalises
// both to ONE input record any language uses (README.md), an independent shuffle per judge, and the three #5695
// controls (wrong page, planted meaning change, duplicate) on GATE pages the judges score before the main packet.
/** Blinded judge packets for translation-vs-reference (#5695): per-judge shuffles, gate packet with wrong-page / planted / duplicate controls, key kept apart. */
/**
 *   node scripts/eval/translation-vs-reference/build-packet.mjs --input <records.jsonl> --out <dir>
 *        [--seed 5695] [--controls-per-type 3] [--chunk 6] [--judges j1,j2]
 *
 * Writes into <dir>:
 *   packets/<judge>/{gate,main}-NN.jsonl   what each judge subagent reads (≤ --chunk items per file)
 *   verdicts/<judge>/                      where each judge subagent appends its lines (same file names)
 *   key.json                               label → arm per judge per item, controls, text hashes. Judges never see it.
 *   manifest.json                          seed, input hash, chunk list, record provenance (no texts)
 *   DISPATCH.md                            the exact subagent prompts, gate first
 * Controls, on 3 × K pages drawn with the seed (their real candidates are scored too):
 *   wrong_page  a candidate that is another record's translation              → must score fidelity ≤ 2
 *   planted     a real candidate with one meaning change (negation / number)  → must be caught (reversal or lower fidelity)
 *   duplicate   a real candidate shown twice under two labels                 → must tie (the judge's noise floor)
 * A packet carries the reference text, so a run with any private reference (#5488) must be written OUTSIDE a git tree.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resetSeed, seededRand } from '../lib/paired-stats.mjs';
import { readJsonl, writeJsonl, sha16, itemId, validateRecord, insideGitTree, plant } from './common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const INPUT = opt('input'); const OUT = opt('out');
const SEED = Number(opt('seed', 5695)); const K = Number(opt('controls-per-type', 3)); const CHUNK = Number(opt('chunk', 6));
const JUDGES = opt('judges', 'j1,j2').split(',');
if (!INPUT || !OUT) { console.error('--input and --out are required'); process.exit(1); }

const records = readJsonl(INPUT);
const warnings = records.flatMap((r, i) => validateRecord(r, i + 1));
const ids = records.map(itemId);
if (new Set(ids).size !== ids.length) { console.error('duplicate book_id/page_number in input'); process.exit(1); }
const anyPrivate = records.some((r) => r.reference_meta.private);
if (anyPrivate && insideGitTree(OUT)) {
  console.error(`refusing: ${records.filter((r) => r.reference_meta.private).length} record(s) carry a private reference and --out is inside a git tree. Write the packet under $SL_PRIVATE_REFS_DIR/.. (or any path outside the repo); score.mjs writes clipped results back into the repo.`);
  process.exit(1);
}
if (records.length < 3 * K + 1) { console.error(`need at least ${3 * K + 1} records for ${K} control page(s) per type (have ${records.length}); lower --controls-per-type`); process.exit(1); }

resetSeed(SEED);
const rnd = () => seededRand();
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

// ── choose control pages ─────────────────────────────────────────────────────────────────────────────────────
const order = shuffle(records.map((_, i) => i));
const controls = { wrong_page: {}, planted: {}, duplicate: {} };
const used = new Set();
const take = (type, fn) => {
  for (const i of order) {
    if (Object.keys(controls[type]).length >= K) return;
    if (used.has(i)) continue;
    const c = fn(records[i], i);
    if (c) { controls[type][ids[i]] = c; used.add(i); }
  }
};
take('planted', (r) => {
  for (const c of shuffle([...r.candidates])) { const p = plant(c.text || '', pick); if (p) return { base_arm: c.arm, ...p }; }
  return null;
});
take('wrong_page', (r, i) => {
  const donors = records.map((d, j) => ({ d, j })).filter(({ d, j }) => j !== i && d.book_id !== r.book_id && d.candidates.some((c) => (c.text || '').trim().length > 200));
  const same = donors.filter(({ d }) => d.lang === r.lang);
  const pool = same.length ? same : donors; // same language first: a wrong page in the right language is the hard case
  if (!pool.length) return null;
  const { d, j } = pick(pool);
  const c = pick(d.candidates.filter((x) => (x.text || '').trim().length > 200));
  return { donor: ids[j], donor_arm: c.arm, text: c.text };
});
take('duplicate', (r) => { const c = pick(r.candidates.filter((x) => (x.text || '').trim())); return c ? { arm: c.arm } : null; });
for (const t of Object.keys(controls)) if (Object.keys(controls[t]).length < K) { console.error(`could not place ${K} ${t} control(s) (placed ${Object.keys(controls[t]).length})`); process.exit(1); }
const controlOf = Object.fromEntries(Object.entries(controls).flatMap(([t, m]) => Object.keys(m).map((id) => [id, t])));

// ── packets: an independent shuffle per judge ────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
const key = { seed: SEED, input: path.resolve(INPUT), input_sha: sha16(fs.readFileSync(INPUT, 'utf8')), judges: JUDGES, controls, items: {}, text_hash: {}, gate_items: [], main_items: [] };
const packetLine = (r, id, labels) => ({
  id, track: r.track, lang: r.lang,
  reference_title: r.reference_meta.title, reference_translator: r.reference_meta.translator, reference_year: r.reference_meta.year ?? null,
  reference_style: r.reference_meta.style,
  ...(r.reference_meta.located ? { reference_located: r.reference_meta.located } : {}),
  ...(r.reference_meta.coverage_note ? { reference_note: r.reference_meta.coverage_note } : {}),
  ...(r.source_prev_tail ? { source_prev_tail: r.source_prev_tail } : {}),
  source: r.source_text,
  ...(r.source_next_head ? { source_next_head: r.source_next_head } : {}),
  reference: r.reference_text,
  n: Object.keys(labels).length, translations: labels,
});
const chunks = [];
for (const j of JUDGES) {
  key.items[j] = {}; key.text_hash[j] = {};
  const gate = [], main = [];
  records.forEach((r, i) => {
    const id = ids[i];
    const cands = r.candidates.map((c) => ({ arm: c.arm, text: (c.text || '').trim() }));
    const ctl = controlOf[id];
    if (ctl === 'wrong_page') cands.push({ arm: 'control:wrong_page', text: controls.wrong_page[id].text.trim() });
    if (ctl === 'planted') cands.push({ arm: 'control:planted', text: controls.planted[id].text.trim() });
    if (ctl === 'duplicate') cands.push({ arm: `${controls.duplicate[id].arm}#dup`, text: cands.find((c) => c.arm === controls.duplicate[id].arm).text });
    shuffle(cands);
    const labels = Object.fromEntries(cands.map((c, k) => [`T${k + 1}`, c.text]));
    key.items[j][id] = Object.fromEntries(cands.map((c, k) => [`T${k + 1}`, c.arm]));
    key.text_hash[j][id] = Object.fromEntries(cands.map((c, k) => [`T${k + 1}`, sha16(c.text)]));
    (ctl ? gate : main).push(packetLine(r, id, labels));
  });
  // item ORDER is shuffled per judge too, so a position effect cannot line up across the two judges
  for (const [phase, list] of [['gate', shuffle(gate)], ['main', shuffle(main)]]) {
    for (let c = 0; c * CHUNK < list.length; c++) {
      const name = `${phase}-${String(c + 1).padStart(2, '0')}.jsonl`;
      const pf = path.join(OUT, 'packets', j, name), vf = path.join(OUT, 'verdicts', j, name);
      writeJsonl(pf, list.slice(c * CHUNK, (c + 1) * CHUNK));
      fs.mkdirSync(path.dirname(vf), { recursive: true });
      chunks.push({ judge: j, phase, packet: path.resolve(pf), verdicts: path.resolve(vf), n: list.slice(c * CHUNK, (c + 1) * CHUNK).length });
    }
  }
}
key.gate_items = Object.keys(controlOf);
key.main_items = ids.filter((id) => !controlOf[id]);
fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 1));
const manifest = {
  built: new Date().toISOString(), seed: SEED, input: path.resolve(INPUT), input_sha: key.input_sha, any_private: anyPrivate,
  n_items: records.length, n_gate: key.gate_items.length, n_main: key.main_items.length, chunk: CHUNK, judges: JUDGES, chunks, warnings,
  records: records.map((r, i) => ({ id: ids[i], track: r.track, lang: r.lang, book_id: r.book_id, page_number: r.page_number,
    reference_meta: r.reference_meta, arms: r.candidates.map((c) => c.arm), canonical: !!r.reference_meta.canonical })),
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

const prompt = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'JUDGE-PROMPT.md');
const dispatch = [`# Dispatch — ${OUT}`, '',
  `One Opus subagent per chunk (model: opus), at most 8 at a time. GATE chunks first; run \`score.mjs --gate-only\` and stop if it fails.`,
  `Each subagent prompt is exactly the line below (the judge must not be told which arms exist, which item is a control, or where key.json is).`, ''];
for (const phase of ['gate', 'main']) {
  dispatch.push(`## ${phase}`, '');
  for (const c of chunks.filter((x) => x.phase === phase)) dispatch.push(`- [${c.judge}] Read ${prompt} and follow it exactly. INPUT_FILE=${c.packet} OUTPUT_FILE=${c.verdicts}`);
  dispatch.push('');
}
fs.writeFileSync(path.join(OUT, 'DISPATCH.md'), dispatch.join('\n'));
console.log(`${records.length} items (${key.gate_items.length} gate, ${key.main_items.length} main) × ${JUDGES.length} judges → ${chunks.length} chunks in ${OUT}; seed ${SEED}; warnings ${warnings.length}${anyPrivate ? '; PRIVATE references present' : ''}`);
