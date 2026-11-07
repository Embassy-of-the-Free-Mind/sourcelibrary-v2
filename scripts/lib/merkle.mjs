/**
 * merkle.mjs — a small, dependency-free SHA-256 Merkle tree for hash snapshots (#8150 slice 10).
 *
 * PRIOR ART: none in the repo — `git grep -i merkle` finds only prose; scripts/lib/write-provenance.mjs
 * `contentHash` is a 64-bit truncated sha256 per field (an identity for change detection, too short to be
 * public evidence: a 2^32 collision lets the holder swap content); scripts/export/build-corpus-snapshot.mjs
 * checksums whole shards, which proves a file, not one page without the rest.
 *
 * Domain separation as in RFC 6962 (Certificate Transparency): leaf = H(0x00 || data), node = H(0x01 || L || R),
 * so a leaf can never be passed off as an internal node. An odd node at the end of a level is carried up
 * unchanged (no duplication, so no CVE-2012-2459-style second root for the same leaves).
 *
 * A proof is a list of { side: 'L'|'R', hash } siblings from the leaf up. Hashes are lowercase hex.
 */
import { createHash } from 'node:crypto';

const sha = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};

export const sha256hex = (s) => createHash('sha256').update(s).digest('hex');

/** Leaf hash of a byte string or UTF-8 string. */
export function leafHash(data) {
  return sha(Buffer.from([0]), Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')).toString('hex');
}

export function nodeHash(leftHex, rightHex) {
  return sha(Buffer.from([1]), Buffer.from(leftHex, 'hex'), Buffer.from(rightHex, 'hex')).toString('hex');
}

/** Root of a list of leaf hashes (hex). Empty list → sha256 of the empty string, as in RFC 6962. */
export function merkleRoot(leaves) {
  if (!leaves.length) return sha256hex('');
  let level = leaves;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? nodeHash(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0];
}

/** Sibling path for leaves[index]. */
export function merkleProof(leaves, index) {
  if (index < 0 || index >= leaves.length) throw new Error(`merkleProof: index ${index} out of range (${leaves.length})`);
  const path = [];
  let level = leaves;
  let i = index;
  while (level.length > 1) {
    const sib = i ^ 1;
    if (sib < level.length) path.push({ side: sib < i ? 'L' : 'R', hash: level[sib] });
    const next = [];
    for (let k = 0; k < level.length; k += 2) next.push(k + 1 < level.length ? nodeHash(level[k], level[k + 1]) : level[k]);
    level = next;
    i = i >> 1;
  }
  return path;
}

/** Fold a proof from a leaf hash; returns the root it implies. */
export function applyProof(leafHex, path) {
  let h = leafHex;
  for (const step of path) {
    if (!/^[0-9a-f]{64}$/.test(step.hash || '')) throw new Error('applyProof: bad sibling hash');
    h = step.side === 'L' ? nodeHash(step.hash, h) : step.side === 'R' ? nodeHash(h, step.hash) : (() => { throw new Error('applyProof: side must be L or R'); })();
  }
  return h;
}

// ── Text leaves ──────────────────────────────────────────────────────────────

export const TEXT_LEAF_VERSION = 'sl-text-v1';

/**
 * The bytes a text leaf commits to. `textSha256` is the full sha256 (hex) of the exact stored UTF-8 string,
 * so the leaf proves the text without containing it. Field order and the version tag are fixed: changing
 * either is a new leaf version, never an edit of this one.
 */
export function textLeafData({ bookId, pageId, pageNumber, field, textSha256 }) {
  if (!/^[0-9a-f]{64}$/.test(textSha256 || '')) throw new Error('textLeafData: textSha256 must be 64 hex');
  return [TEXT_LEAF_VERSION, String(bookId), String(pageId), String(pageNumber ?? ''), String(field), textSha256].join('\n');
}

export const textLeaf = (o) => leafHash(textLeafData(o));

/** Leaves of one book are ordered by (page_number, page_id, field) so the book root is reproducible. */
export function compareLeafRows(a, b) {
  const num = (x) => (x !== null && x !== '' && Number.isFinite(Number(x)) ? Number(x) : Number.MAX_SAFE_INTEGER);
  const pa = num(a.pageNumber), pb = num(b.pageNumber);
  if (pa !== pb) return pa - pb;
  if (a.pageId !== b.pageId) return a.pageId < b.pageId ? -1 : 1;
  return a.field < b.field ? -1 : a.field > b.field ? 1 : 0;
}

/** The corpus tree's leaf for one book: commits to the book id, its leaf count and its root. */
export const BOOK_LEAF_VERSION = 'sl-book-v1';
export const bookLeaf = ({ bookId, n, root }) => leafHash([BOOK_LEAF_VERSION, String(bookId), String(n), root].join('\n'));
