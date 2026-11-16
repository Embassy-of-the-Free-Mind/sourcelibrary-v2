#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/agreement-stats.mjs (agreement over judged rows; this is one confusion table and a fixed
// pass rule, so it stays inline). compare — the #254 tables: Opus tag table (script × kind, unsure, not fetched), the
// positive control against the 17 books identified by eye on #95, and Sonnet vs Opus with the pass rule fixed in the
// brief: Sonnet agrees with Opus on script on ≥ 97 of the first 100 books in frame order, and calls no keyed Śāradā
// book Devanagari.
//   node scripts/eval/sa-script-tags-254/compare.mjs --dir $JOB_SCRATCH/w > $JOB_SCRATCH/w/compare.json
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg('--dir');
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const norm = (s) => String(s || '').trim().toLowerCase().replace(/^other:\s*/, 'other:');
const frame = JSON.parse(fs.readFileSync(path.join(DIR, 'frame.json'))).books;
const opus = new Map(read(path.join(DIR, 'tags-opus.jsonl')).map((t) => [t.book, t]));
const sonnet = new Map(read(path.join(DIR, 'tags-sonnet.jsonl')).map((t) => [t.book, t]));

// #254 comment of 2026-11-13 12:55Z (from the #95 spot check): script and kind by eye.
export const KEY = {
  '6a94a79ebf723b215d8bf3a5': ['sharada', 'manuscript'], '6a942fcbfc29dbd7ff1fb079': ['sharada', 'manuscript'],
  '6a94d47b8e2a2ffc91d29bb6': ['devanagari', 'manuscript'], '6a94dc1cb24b5a49c27d8ba8': ['sharada', 'manuscript'],
  '6a94d38b8e2a2ffc91d28b09': ['sharada', 'manuscript'], '6a94ba7b56cac2f882c80dff': ['sharada', 'manuscript'],
  '6a94b97456cac2f882c808b7': ['devanagari', 'manuscript'], '6a94c3d256cac2f882c84da3': ['devanagari', 'print'],
  '6a948e2431b41d9c574464df': ['devanagari', 'print'], '6a949a7931b41d9c5744d8a1': ['sharada', 'manuscript'],
  '6a94c9728e2a2ffc91d2594c': ['sharada', 'manuscript'], '6a94906431b41d9c57447026': ['sharada', 'manuscript'],
  '6a94a139bf723b215d8bd2b5': ['sharada', 'manuscript'], '6a94d02f8e2a2ffc91d282b5': ['sharada', 'manuscript'],
  '6a94da34b24b5a49c27d7e3e': ['sharada', 'lithograph'], '6a948f7e31b41d9c57446bcb': ['sharada', 'manuscript'],
  '6a942ed752baa7aee625ade4': ['sharada', 'manuscript'],
};

const tally = (xs) => xs.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
const tagged = frame.filter((b) => opus.has(b.id));
const table = tally(tagged.map((b) => `${norm(opus.get(b.id).script)} | ${norm(opus.get(b.id).kind)}`));
const unsure = tally(tagged.filter((b) => opus.get(b.id).confidence !== 'sure').map((b) => norm(opus.get(b.id).script)));
const disagree = tagged.filter((b) => opus.get(b.id).agree === false).map((b) => ({ id: b.id, script: opus.get(b.id).script, leaves: opus.get(b.id).leaves }));
const notFetched = frame.filter((b) => !b.leaves?.length).map((b) => ({ id: b.id, reason: b.reason }));
const untagged = frame.filter((b) => b.leaves?.length && !opus.has(b.id)).map((b) => b.id);

const control = Object.entries(KEY).map(([id, [s, k]]) => {
  const o = opus.get(id); const so = sonnet.get(id);
  return { id, key_script: s, key_kind: k, opus_script: o ? norm(o.script) : null, opus_kind: o ? norm(o.kind) : null, opus_conf: o?.confidence ?? null, script_match: o ? norm(o.script) === s : null, kind_match: o ? norm(o.kind) === k : null, sonnet_script: so ? norm(so.script) : null, sonnet_kind: so ? norm(so.kind) : null };
});

const first100 = frame.filter((b) => b.order < 100 && b.leaves?.length);
const pairs = first100.filter((b) => opus.has(b.id) && sonnet.has(b.id));
const agreeScript = pairs.filter((b) => norm(opus.get(b.id).script) === norm(sonnet.get(b.id).script)).length;
const agreeKind = pairs.filter((b) => norm(opus.get(b.id).kind) === norm(sonnet.get(b.id).kind)).length;
const confusion = tally(pairs.map((b) => `${norm(opus.get(b.id).script)} → ${norm(sonnet.get(b.id).script)}`));
const kindConfusion = tally(pairs.map((b) => `${norm(opus.get(b.id).kind)} → ${norm(sonnet.get(b.id).kind)}`));
const keyedSharadaCalledDeva = control.filter((r) => r.key_script === 'sharada' && r.sonnet_script === 'devanagari').map((r) => r.id);
const sonnetKeyMatch = control.filter((r) => r.sonnet_script).map((r) => r.sonnet_script === r.key_script);
const scriptDiffs = pairs.filter((b) => norm(opus.get(b.id).script) !== norm(sonnet.get(b.id).script)).map((b) => ({ id: b.id, order: b.order, opus: `${opus.get(b.id).script}/${opus.get(b.id).confidence}`, sonnet: `${sonnet.get(b.id).script}/${sonnet.get(b.id).confidence}`, opus_note: opus.get(b.id).note, sonnet_note: sonnet.get(b.id).note }));

console.log(JSON.stringify({
  frame: frame.length, tagged: tagged.length, not_fetched: notFetched, untagged_pending: untagged.length,
  table, unsure, leaves_disagree: disagree.length, disagree,
  control: { rows: control, script_matched: control.filter((r) => r.script_match).length, script_compared: control.filter((r) => r.script_match !== null).length, kind_matched: control.filter((r) => r.kind_match).length, mismatches: control.filter((r) => r.script_match === false) },
  sonnet: {
    first100_pairs: pairs.length, agree_script: agreeScript, agree_kind: agreeKind, confusion, kindConfusion, scriptDiffs,
    keyed_sharada_called_devanagari: keyedSharadaCalledDeva, key_script_match: `${sonnetKeyMatch.filter(Boolean).length}/${sonnetKeyMatch.length}`,
    pass: pairs.length === first100.length && first100.length === 100 ? (agreeScript >= 97 && keyedSharadaCalledDeva.length === 0) : `incomplete (${pairs.length}/${first100.length})`,
  },
}, null, 1));
