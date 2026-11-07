#!/usr/bin/env node
/**
 * verify-snapshot-proof.mjs — prove or disprove, WITHOUT our database, that an exact page text existed in a
 * past hash snapshot (#8150 slice 10). Needs only: the text, the proof JSON (`hash-snapshot.mjs prove`), and
 * the snapshot's root.ots. The Bitcoin check reads a public block explorer; anyone can repeat it on their
 * own node with the reference client (`ots verify root.ots`, python-opentimestamps).
 *
 * PRIOR ART: none — the decoder (/decode, src/lib/mark-decoder.ts) checks a MARK in served text, which says
 * where a copy came from; this checks a COMMITMENT, which says the text existed by a date. Different evidence.
 *
 *   node scripts/maintenance/verify-snapshot-proof.mjs --proof proof.json --text page.txt [--ots root.ots] [--offline]
 *
 * Exit 0: proved (or proved to the root, stamp still pending). Exit 1: the text, path or timestamp does not
 * match. Exit 2: usage. Exit 3: the Bitcoin check could not reach the explorer (not a mismatch).
 * The text must be the exact stored string (UTF-8, no trailing newline added); `--text -` reads stdin.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { textLeaf, bookLeaf, applyProof } from '../lib/merkle.mjs';
import { parseOts, verifyOtsBitcoin, attestations } from '../lib/opentimestamps.mjs';

/** Pure check of text + proof (no network). Returns { ok, steps, why? }. */
export function checkProof(text, proof) {
  const steps = [];
  const sha = createHash('sha256').update(text, 'utf8').digest('hex');
  steps.push(`text sha256 ${sha}`);
  if (sha !== proof.page.text_sha256) return { ok: false, steps, why: `text does not match the snapshot (snapshot holds ${proof.page.text_sha256})` };
  const leaf = textLeaf({ bookId: proof.page.book_id, pageId: proof.page.page_id, pageNumber: proof.page.page_number, field: proof.page.field, textSha256: sha });
  const bookRoot = applyProof(leaf, proof.book.path);
  steps.push(`book root ${bookRoot}`);
  if (bookRoot !== proof.book.root) return { ok: false, steps, why: 'page path does not lead to the book root' };
  const root = applyProof(bookLeaf({ bookId: proof.page.book_id, n: proof.book.n, root: bookRoot }), proof.corpus.path);
  steps.push(`corpus root ${root}`);
  if (root !== proof.snapshot.root) return { ok: false, steps, why: 'book path does not lead to the snapshot root' };
  return { ok: true, steps, root };
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname === fs.realpathSync(process.argv[1]);
if (isMain) {
  const arg = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
  if (!arg('--proof') || !arg('--text')) { console.error('usage: --proof proof.json --text page.txt [--ots root.ots] [--offline]'); process.exit(2); }
  const proof = JSON.parse(fs.readFileSync(arg('--proof'), 'utf8'));
  const text = fs.readFileSync(arg('--text') === '-' ? 0 : arg('--text'), 'utf8');
  const r = checkProof(text, proof);
  for (const s of r.steps) console.log(`  ${s}`);
  if (!r.ok) { console.log(`NOT PROVED: ${r.why}`); process.exit(1); }
  console.log(`text is in snapshot ${proof.snapshot.id} (root ${r.root})`);
  if (arg('--ots')) {
    const ots = fs.readFileSync(arg('--ots'));
    const { digest, timestamp } = parseOts(ots);
    if (digest.toString('hex') !== r.root) { console.log('NOT PROVED: root.ots timestamps a different root'); process.exit(1); }
    if (process.argv.includes('--offline')) {
      const kinds = attestations(timestamp).map((a) => a.kind);
      console.log(`root.ots commits to this root; attestations: ${kinds.join(', ')} (not checked against Bitcoin: --offline)`);
    } else {
      const v = await verifyOtsBitcoin(ots);
      if (v.confirmed) console.log(`PROVED: the snapshot root was in Bitcoin block ${v.confirmed.height} (${v.confirmed.time}); this text existed by then`);
      else if (v.mismatched) { console.log('NOT PROVED: a Bitcoin attestation does not match its block'); process.exit(1); }
      else if (v.unreachable) { console.log(`UNCHECKED: the block explorer could not be reached (${v.checked.map((c) => c.error).join('; ')}); try again, or run \`ots verify\` on your own node`); process.exit(3); }
      else console.log(`root.ots is still pending at ${v.pending.join(', ')}: run hash-snapshot.mjs upgrade after a block confirms`);
    }
  }
}
