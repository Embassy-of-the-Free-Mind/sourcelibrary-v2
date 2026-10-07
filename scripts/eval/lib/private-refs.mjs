/**
 * private-refs.mjs — reference texts that may be SCORED but never PUBLISHED (#5488).
 *
 * PRIOR ART: benchmark-score.mjs read `benchmark/refs/<slug>.txt` directly, and the dataset exporters
 * already have a pointer-only path (`reference_sha256`, dataset v0.1). Neither covers a reference whose
 * text cannot live in this public repo at all. This adds that one case and nothing else.
 *
 * A modern, in-copyright edition or translation can be a reference for quality control, but its text
 * must never be committed here. The split:
 *   benchmark/refs/<slug>.json   PUBLIC record: source, edition, licence, text_location: "private",
 *                                text_sha256. Scores stay auditable and recomputable.
 *   <private dir>/<slug>.txt     PRIVATE text. Default ~/sourcelibrary-ops/evals/refs-private,
 *                                override with SL_PRIVATE_REFS_DIR.
 *
 * loadRefText() reads either kind and checks a private text against the public hash, so a
 * mis-pasted or edited private file cannot silently score against the wrong text.
 * findPrivateTextLeaks() is the guard tests/unit/private-refs-guard.test.ts runs in CI.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

export const PRIVATE_LICENCES = new Set(['in-copyright']);

export function privateRefsDir() {
  return process.env.SL_PRIVATE_REFS_DIR || path.join(os.homedir(), 'sourcelibrary-ops', 'evals', 'refs-private');
}

export const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

export function isPrivateRecord(rec) {
  return !!rec && (rec.text_location === 'private' || PRIVATE_LICENCES.has(rec.licence));
}

function readRecord(refsDir, slug) {
  const f = path.join(refsDir, `${slug}.json`);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

/**
 * Returns { text, private } or { text: null, skipped: <reason> }. Never throws on a missing file:
 * a reference that is unavailable on this machine is a recorded skip, not a crash and not a score.
 */
export function loadRefText(refsDir, slug) {
  const rec = readRecord(refsDir, slug);
  if (isPrivateRecord(rec)) {
    const f = path.join(privateRefsDir(), `${slug}.txt`);
    if (!fs.existsSync(f)) return { text: null, skipped: 'private-text-unavailable' };
    const text = fs.readFileSync(f, 'utf8');
    if (!rec.text_sha256) return { text: null, skipped: 'private-record-has-no-hash' };
    if (sha256(text) !== rec.text_sha256) return { text: null, skipped: 'private-text-hash-mismatch' };
    return { text, private: true };
  }
  const f = path.join(refsDir, `${slug}.txt`);
  if (!fs.existsSync(f)) return { text: null, skipped: 'no-reference' };
  return { text: fs.readFileSync(f, 'utf8'), private: false };
}

/** Writes a private reference: text to the private dir, public record (with hash) to refsDir. */
export function writePrivateRef(refsDir, slug, text, record) {
  if (!record?.licence) throw new Error(`writePrivateRef(${slug}): record.licence is required`);
  const dir = privateRefsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.txt`), text);
  const pub = { ...record, text_location: 'private', text_sha256: sha256(text), unit: { ...(record.unit || {}), chars: [...text].length } };
  fs.writeFileSync(path.join(refsDir, `${slug}.json`), JSON.stringify(pub, null, 2) + '\n');
  const leak = path.join(refsDir, `${slug}.txt`);
  if (fs.existsSync(leak)) fs.unlinkSync(leak);   // a stale public copy of the same slug would publish it
  return pub;
}

/** Every public .txt that sits beside a record marked private. Must be empty. */
export function findPrivateTextLeaks(refsDir) {
  if (!fs.existsSync(refsDir)) return [];
  const leaks = [];
  for (const f of fs.readdirSync(refsDir).filter(f => f.endsWith('.json'))) {
    const slug = f.replace(/\.json$/, '');
    if (isPrivateRecord(readRecord(refsDir, slug)) && fs.existsSync(path.join(refsDir, `${slug}.txt`))) leaks.push(slug);
  }
  return leaks;
}
