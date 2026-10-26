#!/usr/bin/env node
/**
 * build-ocr-eval-deposit.mjs — the Zenodo deposit folder for "Reading or Reciting?" OCR-Eval (#7462).
 *
 * PRIOR ART: export-eval-dataset.mjs writes dataset/v0.x from Mongo and the observations; re-running it now would
 * give a different dataset (the database has moved since 2026-07-23), so this script reads only committed files.
 * build-quality-dataset.mjs is the same idea for quality-v1 (rebuild from the repo, --check, checksums, canary).
 * hf/publish.sh uploads one version dir to Hugging Face; it does not assemble a two-part deposit.
 *
 *   node scripts/eval/build-ocr-eval-deposit.mjs [--out DIR]   # default scripts/output/ocr-eval-v0.3-deposit
 *   node scripts/eval/build-ocr-eval-deposit.mjs --check       # exit 1 if dataset/v0.3 differs from a rebuild
 *
 * It does two things:
 *  1. Re-applies the reference licence table (lib/ocr-eval-licences.mjs) to dataset/v0.3/references.jsonl and
 *     rewrites it and v0.3/checksums.txt in place. A newly included text comes from ground-truth/<slug>.json and
 *     must hash to the row's reference_sha256 (the text that was scored), or the build fails.
 *  2. Assembles the deposit: README.md (the dataset card, hf/README.md without its YAML front matter), CANARY.txt,
 *     checksums.txt over every file, v0.3/{pages,references,runs}.jsonl + README.md, v0.4-difficulty/{pages.jsonl,
 *     README.md}. Not v0.1, v0.2 or hf/publish.sh.
 *
 * Deposit with:
 *   node --env-file=.env.production.local scripts/eval/deposit-ft-dataset.mjs --dir scripts/output/ocr-eval-v0.3-deposit \
 *     --metadata scripts/eval/dataset/ocr-eval-v0.3.zenodo.json
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { licenseFor, RETRIEVAL_NOTE } from './lib/ocr-eval-licences.mjs';
import { assertCanary, CANARY_TEXT } from '../lib/dataset-canary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DS = path.join(__dirname, 'dataset');
const V03 = path.join(DS, 'v0.3');
const V04 = path.join(DS, 'v0.4-difficulty');
const REPO = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const OUT = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(REPO, 'scripts/output/ocr-eval-v0.3-deposit'));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const toJsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const fails = [];

// ── 1. references: re-apply the licence table ──
const refs = readJsonl(path.join(V03, 'references.jsonl')).map((r) => {
  const lic = licenseFor(r.source);
  let text = null;
  if (lic.include) {
    text = r.reference_text;
    if (text == null) {
      const gt = path.join(__dirname, 'ground-truth', `${r.slug}.json`);
      text = fs.existsSync(gt) ? JSON.parse(fs.readFileSync(gt, 'utf8')).ocr_ground_truth ?? null : null;
    }
    if (text == null || sha256(text) !== r.reference_sha256) {
      fails.push(`${r.slug}: no text hashing to reference_sha256 (the scored text), cannot include it`);
      text = null;
    }
  }
  return {
    ...r, license: lic.license, text_included: text != null, reference_text: text,
    retrieval_note: text != null ? null : RETRIEVAL_NOTE,
  };
});
for (const r of refs) {
  if (r.text_included && !licenseFor(r.source).spdx) fails.push(`${r.slug}: text included under an unconfirmed licence`);
  if (!r.text_included && r.reference_text != null) fails.push(`${r.slug}: withheld row still carries text`);
}
const pages = fs.readFileSync(path.join(V03, 'pages.jsonl'), 'utf8');
const runs = fs.readFileSync(path.join(V03, 'runs.jsonl'), 'utf8');
const refsText = toJsonl(refs);
const v03Checksums = `${[['pages.jsonl', pages], ['references.jsonl', refsText], ['runs.jsonl', runs]]
  .map(([n, c]) => `${sha256(c)}  ${n}`).join('\n')}\n`;
if (fails.length) { console.error(`✗ ${fails.length} rights check(s) failed:\n  ${fails.join('\n  ')}`); process.exit(1); }

if (CHECK) {
  const diff = [['references.jsonl', refsText], ['checksums.txt', v03Checksums]]
    .filter(([n, c]) => fs.readFileSync(path.join(V03, n), 'utf8') !== c).map(([n]) => n);
  if (diff.length) { console.error(`✗ dataset/v0.3 differs from a rebuild: ${diff.join(', ')}`); process.exit(1); }
  console.log('✓ dataset/v0.3 matches a rebuild');
  process.exit(0);
}
fs.writeFileSync(path.join(V03, 'references.jsonl'), refsText);
fs.writeFileSync(path.join(V03, 'checksums.txt'), v03Checksums);

// ── 2. the deposit folder ──
const card = fs.readFileSync(path.join(DS, 'hf', 'README.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n+/, '');
const files = new Map([
  ['README.md', card],
  ['CANARY.txt', `${CANARY_TEXT}\n`],
  ['v0.3/pages.jsonl', pages],
  ['v0.3/references.jsonl', refsText],
  ['v0.3/runs.jsonl', runs],
  ['v0.3/README.md', fs.readFileSync(path.join(V03, 'README.md'), 'utf8')],
  ['v0.4-difficulty/pages.jsonl', fs.readFileSync(path.join(V04, 'pages.jsonl'), 'utf8')],
  ['v0.4-difficulty/README.md', fs.readFileSync(path.join(V04, 'README.md'), 'utf8')],
]);
for (const [n, c] of files) if (n.endsWith('README.md') && !c.includes(CANARY_TEXT)) fails.push(`${n} does not carry the canary`);
if (fails.length) { console.error(`✗ ${fails.join('\n  ')}`); process.exit(1); }
const names = [...files.keys()].sort();
files.set('checksums.txt', names.map((n) => `${sha256(files.get(n))}  ${n}`).join('\n') + '\n');

fs.rmSync(OUT, { recursive: true, force: true });
for (const [n, c] of files) { fs.mkdirSync(path.dirname(path.join(OUT, n)), { recursive: true }); fs.writeFileSync(path.join(OUT, n), c); }
assertCanary(OUT);
for (const d of ['v0.3', 'v0.4-difficulty']) if (!fs.readFileSync(path.join(OUT, d, 'README.md'), 'utf8').includes(CANARY_TEXT)) throw new Error(`${d}/README.md lacks the canary`);
const included = refs.filter((r) => r.text_included).length;
console.log(`wrote ${path.relative(REPO, OUT)}/ (${files.size} files); references: ${included} with text, ${refs.length - included} pointers`);
for (const n of [...files.keys()].sort()) console.log(`  ${n.padEnd(34)} ${(Buffer.byteLength(files.get(n)) / 1024).toFixed(0).padStart(6)} KB`);
