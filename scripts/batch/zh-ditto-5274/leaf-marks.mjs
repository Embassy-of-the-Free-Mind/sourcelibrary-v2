// PRIOR ART: frame.mjs here (writes the census this reads). The census of the zero-丨 frame, taken once by frame.mjs:
// $ZD_CENSUS or $JOB_SCRATCH/census.jsonl.gz, one row per body page { pid, bid, pn, marks, leaf_marks, held, … }.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
let rows = null;
export function census() {
  if (rows) return rows;
  const f = process.env.ZD_CENSUS || path.join(process.env.JOB_SCRATCH || '/data/scratch/sl/jobs/zh-ditto-correct-5274', 'census.jsonl.gz');
  rows = zlib.gunzipSync(fs.readFileSync(f)).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return rows;
}
