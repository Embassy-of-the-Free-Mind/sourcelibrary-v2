// #264 stage 2: the reference record for a frame row, and where it is kept.
// PRIOR ART: scripts/eval/benchmark/refs/*.json (the #4925/#5935 record shape: slug, source, url, licence,
// leaf_check; one record per scored page, text in a .txt beside it) and eval-design.md §4.1 (the required
// fields). Those records are keyed by a benchmark slug and live in a tree the public mirror copies; these
// are keyed by a sealed frame row of scripts/eval/dataset/test-set-264/frame.jsonl and live under
// scripts/eval/dataset/ (excluded from the public mirror, #7822), so no reference text leaves the private repo.
//
// One record per frame row: refs/<row>.json, the source's own text for the unit as fetched (<row>.raw.txt) and
// the text a scorer reads (<row>.txt), normalised only as §4 allows (markup and editorial apparatus out, the
// characters the source typed kept). A record is ACCEPTED only when the edition is the same as our scan, the
// text is not model-made and not ours, the licence and holder are recorded, and a model or human looked at
// the image and the text together and found the same leaf (tests/unit/test-set-264-refs.test.ts).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cleanPageText } from '../lib/wikisource-text.mjs';

export const FRAME = 'scripts/eval/dataset/test-set-264/frame.jsonl';
export const REFS = 'scripts/eval/dataset/test-set-264/refs';
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const readFrame = () => fs.readFileSync(FRAME, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
export const LEAF_STATUSES = ['ok', 'shifted', 'wrong-work', 'unchecked'];
export const EDITION_MATCHES = ['same-edition', 'same-work-other-edition', 'other-witness', 'unknown'];

/** The candidates file a builder writes to scratch before the leaf check (one JSON per line). */
export const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/**
 * Write one record. `rec` carries every §4.1 field except the text hashes, which are computed here from the
 * two texts. `accepted` is derived, never passed in: same edition AND leaf ok AND licence AND not model-made.
 */
export function writeRecord(rec, rawText, normText) {
  fs.mkdirSync(REFS, { recursive: true });
  const full = {
    ...rec,
    text: { raw_file: `${rec.row}.raw.txt`, raw_sha256: sha256(rawText), file: `${rec.row}.txt`, sha256: sha256(normText), chars: [...normText].length },
  };
  full.accepted = acceptedOf(full);
  fs.writeFileSync(path.join(REFS, `${rec.row}.raw.txt`), rawText);
  fs.writeFileSync(path.join(REFS, `${rec.row}.txt`), normText);
  fs.writeFileSync(path.join(REFS, `${rec.row}.json`), JSON.stringify(full, null, 1) + '\n');
  return full;
}

export function acceptedOf(r) {
  return r.edition?.match === 'same-edition'
    && r.leaf_check?.status === 'ok' && !!r.leaf_check?.by && !!r.leaf_check?.at
    && !!r.licence?.licence && !!r.licence?.holder
    && r.made_by?.kind === 'human' && r.own_output === false
    && typeof r.canonical === 'boolean';
}

/** A frame page that was looked for and got no record: the cell's coverage counts it, with the reason. */
export function skipRow(skips, row, cell, reason, detail = null) {
  skips.push({ row, frame_cell: cell, reason, detail });
}

/** The scorer text: the two hyphenation templates resolved to what THIS page prints, then the shared cleaner.
 *  {{tiret|pe|tites}} prints "pe-" at a page foot; {{tiret2|mo|ments}} prints "ments" at a page head. {{Corr|a|b}}
 *  prints a (the page's own reading) unless the transcriber could not read it ("?"), then b. */
export function wsNorm(raw) {
  const t = raw
    .replace(/\{\{\s*tiret\s*\|([^|}]*)\|[^}]*\}\}/gi, '$1-')
    .replace(/\{\{\s*tiret2\s*\|[^|}]*\|([^}]*)\}\}/gi, '$1')
    .replace(/\{\{\s*corr\s*\|([^|}]*)\|([^}]*)\}\}/gi, (m, a, b) => (/\?/.test(a) ? b : a));
  return cleanPageText(t).normalize('NFC');
}
