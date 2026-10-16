#!/usr/bin/env node
// PRIOR ART: scripts/eval/g4-reread-pilot-6769/score.mjs (reports the same A/B counts, writes no verdict a writer
// reads). This turns one book's judged sample into the gate file `cli-ocr.mjs apply --lane-gate=` requires (#6769).
/**
 * Build a re-read lane's per-book gate from draw.mjs's key and judge.py's verdicts. Reads only files; writes one JSON.
 *
 *   node scripts/batch/reread-gate.mjs --lane=g4-reread-6769 --model=gemini-4-argon-low --reads=DIR \
 *        --key=JUDGE/key.json --verdicts=JUDGE/verdicts.jsonl --out=DIR/gate.json [--hash-from-reads]
 *
 * Exit 0 when the book passes, 1 when it fails (the file is written either way, with the reason), 2 on bad usage.
 * --hash-from-reads: a key drawn before draw.mjs recorded read hashes (the 2026-10-16 pilot) takes them from the read
 * directory now; use it only on a read directory that has not been re-read since it was judged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GATE_SCHEMA, gateVerdict, sha256 } from '../lib/reread-lane-gate.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const [LANE, MODEL, READS, KEY, VERDICTS, OUT] = ['lane', 'model', 'reads', 'key', 'verdicts', 'out'].map(arg);
if (!LANE || !MODEL || !READS || !KEY || !VERDICTS || !OUT) { console.error('usage: reread-gate.mjs --lane= --model= --reads= --key= --verdicts= --out= (see header)'); process.exit(2); }
const keyText = fs.readFileSync(KEY, 'utf8'), verdictText = fs.readFileSync(VERDICTS, 'utf8');
const keyFile = JSON.parse(keyText);
const rows = verdictText.split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (process.argv.includes('--hash-from-reads')) {
  for (const k of Object.values(keyFile.key)) k.read_hash ??= sha256(fs.readFileSync(path.join(READS, `${k.page_id}.txt`), 'utf8'));
}
const v = gateVerdict(keyFile, rows);
const models = [...new Set(rows.flatMap((r) => r.resolved_model || []))];
const dates = rows.map((r) => r.date).filter(Boolean).sort();
const gate = {
  schema: GATE_SCHEMA, lane: LANE, book_id: keyFile.book, model: MODEL, reads_dir: path.resolve(READS), at: new Date().toISOString(),
  ...v,
  judge: { model: rows[0]?.model ?? null, resolved: models, route: 'claude-cli', protocol: 'scripts/eval/g4-reread-pilot-6769 draw.mjs + judge.py (blind A/B vs page image, order randomised, markup stripped)', seed: keyFile.seed, frame: keyFile.frame, first: dates[0] ?? null, last: dates.at(-1) ?? null, calls: rows.length },
  key_sha256: sha256(keyText), verdicts_sha256: sha256(verdictText),
};
fs.writeFileSync(OUT, JSON.stringify(gate, null, 1));
console.log(`${gate.book_id}: ${gate.pass ? 'PASS' : `FAIL (${gate.reason})`} — sample ${v.sample.better} better / ${v.sample.same} same / ${v.sample.worse} worse of ${v.sample.n}; controls ${v.controls.pass}/${v.controls.n}`);
process.exit(gate.pass ? 0 : 1);
