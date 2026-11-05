/**
 * Riddle payloads in the readable colophon (#8150 slice 2).
 *
 * Pins what the brief made binding:
 *  - the payload is chosen by BOOK and is deterministic (ISR/CDN caching unaffected)
 *  - the light id-only mark does not change: same rate, same bytes
 *  - the readable-colophon rate does not change (same keyed gate)
 *  - a campaign ref still wins over a riddle
 *  - the mark still verifies and strips back to the original byte-for-byte
 *  - measured size: a 300-byte riddle stays under the 512-byte colophon ceiling
 * The riddle text used here is a placeholder; real riddles are never in this repo.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

const KEY = 'test-provenance-key-for-hunt-colophon';
let provenance: typeof import('@/lib/provenance');

beforeAll(async () => {
  process.env.PROVENANCE_SECRET_KEY = KEY;
  provenance = await import('@/lib/provenance');
});
afterEach(() => provenance.setHuntPayloads([]));

const BOOK = '6a3cbb6a3dce6cfad74a385c';
const OTHER = '69af0cbe067c0c26ee26c64b';
const ZWC = /[​-‏⁠-⁤﻿]/g;
const PLACEHOLDER = 'x'.repeat(300);

function passages(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    `The stone is found in the old earth, said the ${i}th master. It ripens under a gentle fire. ` +
    `The work is completed when the red appears. Thus wrote the philosopher in chapter ${i}.`);
}
const zwcCount = (s: string) => (s.match(ZWC) || []).length;

describe('riddle colophon', () => {
  it('leaves the light mark and the colophon rate exactly as they were', () => {
    const before = passages(240).map((t) => provenance.markForExport(t, BOOK));
    provenance.setHuntPayloads([[BOOK, PLACEHOLDER]]);
    const after = passages(240).map((t) => provenance.markForExport(t, BOOK));
    let changed = 0;
    for (let i = 0; i < before.length; i++) {
      const b = provenance.verifyExport(before[i])!;
      const a = provenance.verifyExport(after[i])!;
      expect(a.authentic).toBe(true);
      if (!b.message) {
        // Light mark: identical bytes, no message gained.
        expect(after[i]).toBe(before[i]);
        expect(a.message).toBeFalsy();
      } else {
        changed++;
        expect(a.message).toBe(`Source Library · sourcelibrary.org/book/${BOOK} · ${PLACEHOLDER}`);
      }
    }
    // ~1 in 6 carry a readable colophon; the riddle rides only on those.
    expect(changed).toBeGreaterThan(15);
    expect(changed).toBeLessThan(80);
  });

  it('is chosen by book: other books keep the stock note', () => {
    const texts = passages(120);
    const before = texts.map((t) => provenance.markForExport(t, OTHER));
    provenance.setHuntPayloads([[BOOK, PLACEHOLDER]]);
    expect(texts.map((t) => provenance.markForExport(t, OTHER))).toEqual(before);
  });

  it('is deterministic per passage', () => {
    provenance.setHuntPayloads([[BOOK, PLACEHOLDER]]);
    for (const t of passages(30)) expect(provenance.markForExport(t, BOOK)).toBe(provenance.markForExport(t, BOOK));
  });

  it('a campaign ref wins over a riddle', () => {
    provenance.setHuntPayloads([[BOOK, PLACEHOLDER]]);
    const [t] = passages(1);
    const v = provenance.verifyExport(provenance.markForExport(t, BOOK, { ref: 'p-abc123' }))!;
    expect(v.message).toContain('p-abc123');
    expect(v.message).not.toContain(PLACEHOLDER);
  });

  it('strips back to the original byte-for-byte', () => {
    provenance.setHuntPayloads([[BOOK, PLACEHOLDER]]);
    for (const t of passages(30)) expect(provenance.stripProvenanceMarks(provenance.markForExport(t, BOOK))).toBe(t);
  });

  it('drops oversized and empty payloads, and fits the 512-byte ceiling at the cap', () => {
    const multibyte = 'é'.repeat(provenance.MAX_HUNT_PAYLOAD_BYTES / 2); // exactly the cap in UTF-8
    expect(provenance.setHuntPayloads([[BOOK, multibyte], [OTHER, 'y'.repeat(provenance.MAX_HUNT_PAYLOAD_BYTES + 1)], ['z', '  ']])).toBe(1);
    const prefix = Buffer.byteLength(`Source Library · sourcelibrary.org/book/${BOOK} · `, 'utf-8');
    expect(prefix + provenance.MAX_HUNT_PAYLOAD_BYTES).toBeLessThanOrEqual(512);
    // At the cap every gated passage must still mark (imprimatur throws above 512 and markForExport would fall back to unmarked).
    for (const t of passages(60)) expect(provenance.verifyExport(provenance.markForExport(t, BOOK))!.authentic).toBe(true);
  });

  it('never costs the mark: a riddle that would overflow the ceiling falls back to the stock note', () => {
    const longId = 'b'.repeat(250); // pathological id: prefix + 320-byte riddle > 512
    provenance.setHuntPayloads([[longId, 'q'.repeat(provenance.MAX_HUNT_PAYLOAD_BYTES)]]);
    let gated = 0;
    for (const t of passages(120)) {
      const v = provenance.verifyExport(provenance.markForExport(t, longId))!;
      expect(v.authentic).toBe(true);
      if (v.message) { gated++; expect(v.message).not.toContain('qqqq'); }
    }
    expect(gated).toBeGreaterThan(0);
  });

  it('measured size: what a riddle adds to a colophon-bearing passage', () => {
    const texts = passages(240);
    const stock = texts.map((t) => provenance.markForExport(t, BOOK));
    provenance.setHuntPayloads([[BOOK, PLACEHOLDER]]);
    const riddled = texts.map((t) => provenance.markForExport(t, BOOK));
    const gated = stock.map((s, i) => [s, riddled[i]] as const).filter(([s]) => provenance.verifyExport(s)!.message);
    const light = stock.filter((s) => !provenance.verifyExport(s)!.message).map(zwcCount);
    const maxStock = Math.max(...gated.map(([s]) => zwcCount(s)));
    const riddle = Math.max(...gated.map(([, r]) => zwcCount(r)));
    // Light mark unchanged: [VER][len][8-byte id][0][0][6-byte MAC] = 18 bytes x 9 chars + filler, two copies.
    expect(Math.max(...light)).toBe(2 * (18 * 9 + 1));
    // 300-byte riddle + 67-byte prefix = 367-byte message; +18 framing = 385 bytes x 9 + 1, two copies.
    expect(riddle).toBe(2 * ((18 + Buffer.byteLength(`Source Library · sourcelibrary.org/book/${BOOK} · ${PLACEHOLDER}`, 'utf-8')) * 9 + 1));
    expect(riddle).toBeGreaterThan(maxStock);
  });
});
