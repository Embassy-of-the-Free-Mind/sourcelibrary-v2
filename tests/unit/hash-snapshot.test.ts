/**
 * Hash snapshots (#8150 slice 10): Merkle tree, the snapshot builder over a mongodump archive, the
 * standalone proof verifier, and the OpenTimestamps file format.
 *
 * The pass condition from the issue: given one page and a past snapshot, a script proves or disproves that
 * exact text existed then, without our database; and a page altered after the snapshot fails.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
// @ts-expect-error — .mjs without types
import { merkleRoot, merkleProof, applyProof, leafHash, nodeHash } from '../../scripts/lib/merkle.mjs';
// @ts-expect-error — .mjs without types
import { buildMongoArchive, readMongoArchive } from '../../scripts/lib/mongo-archive.mjs';
// @ts-expect-error — .mjs without types
import { prove } from '../../scripts/maintenance/hash-snapshot.mjs';
// @ts-expect-error — .mjs without types
import { checkProof } from '../../scripts/maintenance/verify-snapshot-proof.mjs';
// @ts-expect-error — .mjs without types
import { parseOts, serializeOts, attestations, verifyOtsBitcoin, upgradeOts } from '../../scripts/lib/opentimestamps.mjs';

const ROOT = path.resolve(__dirname, '../..');
const hex = (n: number) => createHash('sha256').update(String(n)).digest('hex');

describe('merkle', () => {
  it('every leaf proves to the root, for every tree size up to 33', () => {
    for (let n = 1; n <= 33; n++) {
      const leaves = Array.from({ length: n }, (_, i) => leafHash(`leaf ${i}`));
      const root = merkleRoot(leaves);
      for (let i = 0; i < n; i++) expect(applyProof(leaves[i], merkleProof(leaves, i))).toBe(root);
    }
  });

  it('a leaf cannot stand in for an internal node (domain separation)', () => {
    const [a, b] = [hex(1), hex(2)];
    expect(nodeHash(a, b)).not.toBe(leafHash(Buffer.from(a + b, 'hex')));
  });

  it('a changed leaf or a swapped sibling side fails', () => {
    const leaves = Array.from({ length: 9 }, (_, i) => leafHash(`leaf ${i}`));
    const root = merkleRoot(leaves);
    const p = merkleProof(leaves, 4);
    expect(applyProof(leafHash('leaf 4 altered'), p)).not.toBe(root);
    const flipped = p.map((s: { side: string; hash: string }) => ({ ...s, side: s.side === 'L' ? 'R' : 'L' }));
    expect(applyProof(leaves[4], flipped)).not.toBe(root);
  });
});

describe('snapshot from a mongodump archive', () => {
  const pages = [
    { _id: 'p1', book_id: 'bookA', page_number: 1, ocr: { data: 'Steganographia, liber primus' }, translation: { data: 'Steganography, first book' } },
    { _id: 'p2', book_id: 'bookA', page_number: 2, ocr: { data: 'Caput II' } },
    { _id: 'p3', book_id: 'bookB', page_number: 1, translation: 'a legacy bare-string translation' },
    { _id: 'p4', book_id: 'bookB', page_number: 2, ocr: { data: '' } },
    { _id: 'p5', book_id: 'bookC', page_number: 'xii', ocr: { data: 'Ἑρμῆς ὁ τρισμέγιστος', content_hash: 'deadbeefdeadbeef' } },
  ];

  it('streams documents back out of an archive and refuses a truncated one', async () => {
    const buf = buildMongoArchive('bookstore', 'pages', pages);
    const got: unknown[] = [];
    for await (const { doc } of readMongoArchive([buf])) got.push(doc._id);
    expect(got).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    await expect((async () => { for await (const _ of readMongoArchive([buf.subarray(0, buf.length - 30)])) void _; })()).rejects.toThrow(/truncated|never closed/);
  });

  it('builds, proves a page without the database, and fails a page altered afterwards', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-snap-'));
    const snap = path.join(dir, '2026-11-01');
    const archive = path.join(dir, 'pages.archive');
    fs.writeFileSync(archive, buildMongoArchive('bookstore', 'pages', pages));
    execFileSync('node', ['scripts/maintenance/hash-snapshot.mjs', 'build', '--archive', archive, '--dir', snap, '--source', 'test'], { cwd: ROOT, stdio: 'pipe' });
    const manifest = JSON.parse(fs.readFileSync(path.join(snap, 'manifest.json'), 'utf8'));
    expect(manifest.counts).toEqual({ pages_read: 5, text_rows: 5, books: 3 });
    expect(manifest.stored_content_hash_check.ocr_stored_hash_mismatch).toBe(1);

    const proof = await prove(snap, { bookId: 'bookC', pageId: 'p5', field: 'ocr' });
    expect(proof.ok).toBe(true);
    expect(checkProof('Ἑρμῆς ὁ τρισμέγιστος', proof).ok).toBe(true);
    // one character changed after the snapshot
    const altered = checkProof('Ἑρμῆς ὁ τρισμέγιστοσ', proof);
    expect(altered.ok).toBe(false);
    expect(altered.why).toMatch(/does not match/);
    // a proof whose recorded hash was edited to fit the altered text still fails at the root
    const forged = { ...proof, page: { ...proof.page, text_sha256: createHash('sha256').update('Ἑρμῆς ὁ τρισμέγιστοσ').digest('hex') } };
    expect(checkProof('Ἑρμῆς ὁ τρισμέγιστοσ', forged).ok).toBe(false);

    const tr = await prove(snap, { bookId: 'bookB', pageId: 'p3', field: 'translation' });
    expect(checkProof('a legacy bare-string translation', tr).ok).toBe(true);
    expect((await prove(snap, { bookId: 'bookB', pageId: 'p4', field: 'ocr' })).ok).toBe(false); // empty text is not committed

    // the same input gives the same root; snapshots are append-only
    const snap2 = path.join(dir, 'again');
    execFileSync('node', ['scripts/maintenance/hash-snapshot.mjs', 'build', '--archive', archive, '--dir', snap2, '--source', 'test'], { cwd: ROOT, stdio: 'pipe' });
    expect(JSON.parse(fs.readFileSync(path.join(snap2, 'manifest.json'), 'utf8')).root).toBe(manifest.root);
    expect(() => execFileSync('node', ['scripts/maintenance/hash-snapshot.mjs', 'build', '--archive', archive, '--dir', snap], { cwd: ROOT, stdio: 'pipe' })).toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// The reference client's own example (opentimestamps-client/examples/hello-world.txt.ots, LGPL-3.0, 688 bytes):
// sha256("Hello World!\n"), attested in Bitcoin block 358391.
describe('opentimestamps', () => {
  it('round-trips the reference example and finds its Bitcoin attestation', async () => {
    const file = path.join(ROOT, 'tests/fixtures/ots/hello-world.txt.ots');
    const buf = fs.readFileSync(file);
    const p = parseOts(buf);
    expect(p.digest.toString('hex')).toBe(createHash('sha256').update('Hello World!\n').digest('hex'));
    expect(serializeOts(p).equals(buf)).toBe(true);
    const btc = attestations(p.timestamp).filter((a: { kind: string }) => a.kind === 'bitcoin');
    expect(btc.map((a: { height: number }) => a.height)).toEqual([358391]);
    // the explorer check, with the block's real merkle root served by a stub
    const merkle = Buffer.from(btc[0].msg).reverse().toString('hex');
    const fetchImpl = async (url: string) => ({
      text: async () => 'blockhash',
      json: async () => ({ merkle_root: url.endsWith('/block/blockhash') ? merkle : '', timestamp: 1432827678 }),
    });
    const v = await verifyOtsBitcoin(buf, { fetchImpl });
    expect(v.confirmed?.height).toBe(358391);
    const bad = await verifyOtsBitcoin(buf, { fetchImpl: async () => ({ text: async () => 'x', json: async () => ({ merkle_root: '00', timestamp: 0 }) }) });
    expect(bad.confirmed).toBeNull();
  });

  it('upgrade replaces a pending attestation with the calendar path', async () => {
    const buf = fs.readFileSync(path.join(ROOT, 'tests/fixtures/ots/hello-world.txt.ots'));
    const p = parseOts(buf);
    // a pending-only stamp on the same digest
    const uri = Buffer.from('https://alice.btc.calendar.example.org');
    const pendingPayload = Buffer.concat([Buffer.from([uri.length]), uri]);
    const pending = serializeOts({ digest: p.digest, timestamp: { msg: p.digest, ops: [], attestations: [{ tag: '83dfe30d2ef90c8e', payload: pendingPayload }] } });
    expect(attestations(parseOts(pending).timestamp)[0].kind).toBe('pending');
    // the calendar answers with the completed subtree for that message
    const sub = serializeOts(p).subarray(31 + 1 + 1 + 32);
    const r = await upgradeOts(pending, { fetchImpl: async () => ({ status: 200, arrayBuffer: async () => sub }) });
    expect(r.upgraded).toBe(1);
    expect(attestations(parseOts(r.ots).timestamp).some((a: { kind: string }) => a.kind === 'bitcoin')).toBe(true);
  });
});

describe('sweep snapshots and image hashes', () => {
  it('snapshotBooks commits to the books a sweep touches, before and after, append-only', async () => {
    // @ts-expect-error — .mjs without types
    const { snapshotBooks, booksFromRows, pageRows, corpusRoot } = await import('../../scripts/lib/hash-snapshot.mjs');
    let pages = [
      { _id: 'a1', book_id: 'A', page_number: 1, ocr: { data: 'prima' } },
      { _id: 'b1', book_id: 'B', page_number: 1, translation: { data: 'secunda' } },
    ];
    const db = { collection: () => ({ find: (q: { book_id: { $in: string[] } }) => pages.filter((p) => q.book_id.$in.includes(p.book_id)) }) };
    const store = new Map<string, Buffer>();
    const put = async (k: string, b: Buffer) => { if (store.has(k)) throw new Error('exists'); store.set(k, b); };
    const stamp = async () => ({ ots: Buffer.from('ots') });
    const now = new Date('2026-11-04T18:00:00Z');
    const before = await snapshotBooks(db, ['A', 'B'], { label: 'test-sweep', phase: 'before', put, stamp, now });
    pages = [{ ...pages[0], ocr: { data: 'prima, corrected' } }, pages[1]];
    const after = await snapshotBooks(db, ['A', 'B'], { label: 'test-sweep', phase: 'after', runId: before.runId, put, stamp, now });
    expect(before.root).not.toBe(after.root);
    expect([...store.keys()].sort()).toEqual([`hash-snapshots/sweeps/${before.runId}/after.json.gz`, `hash-snapshots/sweeps/${before.runId}/after.ots`, `hash-snapshots/sweeps/${before.runId}/before.json.gz`, `hash-snapshots/sweeps/${before.runId}/before.ots`]);
    const rec = JSON.parse(zlib.gunzipSync(store.get(before.key)!).toString());
    expect(rec.root).toBe(corpusRoot(booksFromRows(rec.books.flatMap((b: { book_id: string; rows: string[][] }) => b.rows.map(([pageId, pageNumber, field, sha]) => ({ bookId: b.book_id, pageId, pageNumber, field, sha }))))));
    expect(pageRows({ _id: 'x', book_id: 'A', ocr: { data: '' } })).toEqual([]);
    await expect(snapshotBooks(db, ['A'], { label: 'test-sweep', phase: 'before', runId: before.runId, put, stamp, now })).rejects.toThrow('exists');
    await expect(snapshotBooks(db, ['A'], { label: 'Bad Label', phase: 'before', put, stamp })).rejects.toThrow(/slug/);
    // a calendar outage does not stop the sweep
    const r = await snapshotBooks(db, ['A'], { label: 'test-sweep', phase: 'before', put, stamp: async () => { throw new Error('down'); }, now: new Date('2026-11-05T00:00:00Z') });
    expect(r.stamped).toBe(false);
  });

  it('dHash matches a re-encoded, resized copy and not a different image', async () => {
    // @ts-expect-error — .mjs without types
    const { imageHashes, hamming64 } = await import('../../scripts/lib/hash-snapshot.mjs');
    const sharp = (await import('sharp')).default;
    const w = 400, h = 300;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; const v = Math.round(127 + 120 * Math.sin(x / 37) * Math.cos(y / 23)); raw[i] = v; raw[i + 1] = v; raw[i + 2] = 255 - v; }
    const orig = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    const copy = await sharp(orig).resize(240).jpeg({ quality: 55 }).toBuffer();
    const other = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).flop().png().toBuffer();
    const [a, b, c] = await Promise.all([imageHashes(orig), imageHashes(copy), imageHashes(other)]);
    expect(a.sha256).not.toBe(b.sha256);
    expect(hamming64(a.dhash, b.dhash)).toBeLessThanOrEqual(10);
    expect(hamming64(a.dhash, c.dhash)).toBeGreaterThan(10);
  });
});

describe('site snapshots (Embassy of the Free Mind public pages)', () => {
  it('hashes pages and images from a sitemap; the text leaf survives a rebuilt page, the html leaf does not', async () => {
    // @ts-expect-error — .mjs without types
    const { hashSite, visibleText, imageUrls } = await import('../../scripts/maintenance/hash-site.mjs');
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 10, b: 10 } } }).png().toBuffer();
    const page = (nonce: string) => `<html><head><script nonce="${nonce}">var x=1</script><style>p{}</style></head><body><!-- build ${nonce} --><h1>The Embassy</h1>\n<p>Bibliotheca&nbsp;Philosophica   Hermetica</p><img src="/img/a.png" srcset="/img/a.png 1x, /img/b.webp 2x"></body></html>`;
    expect(visibleText(page('n1'))).toBe('The Embassy Bibliotheca Philosophica Hermetica');
    expect(imageUrls(page('n1'), 'https://site.example/x')).toEqual(['https://site.example/img/a.png', 'https://site.example/img/b.webp']);
    const run = async (nonce: string) => hashSite({ sitemap: 'https://site.example/sitemap.xml', pauseMs: 0, fetchImpl: async (u: string) => {
      const body = u.endsWith('sitemap.xml') ? '<urlset><url><loc>https://site.example/x</loc></url><url><loc>https://site.example/gone</loc></url></urlset>'
        : u.endsWith('/x') ? page(nonce) : u.endsWith('.png') || u.endsWith('.webp') ? png : null;
      return { status: body === null ? 404 : 200, headers: { get: () => '' }, arrayBuffer: async () => (Buffer.isBuffer(body) ? body : Buffer.from(body ?? '')) };
    } });
    const a = await run('n1'), b = await run('n2');
    expect(a.pages).toBe(2);
    expect(a.failed).toBe(1);
    const leaf = (r: { rows: { url: string; kind: string; sha256: string }[] }, kind: string) => r.rows.find((x) => x.url === 'https://site.example/x' && x.kind === kind)!.sha256;
    expect(leaf(a, 'text')).toBe(leaf(b, 'text'));
    expect(leaf(a, 'html')).not.toBe(leaf(b, 'html'));
    expect(a.rows.filter((x: { kind: string }) => x.kind === 'image')).toHaveLength(2);
    expect(a.root).not.toBe(b.root);
  });
});
