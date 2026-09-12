import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs worker, no types
import { assessSpike } from '../../scripts/workers/r2-egress-spike-alert.mjs';

/**
 * The detector's whole value is telling an EXTRACTION apart from our own
 * acquisition pipeline (#4373). Both move terabytes; the difference is that the
 * pipeline WRITES variants as it reads, an extraction only reads. These pin
 * that discriminator so a future tuning can't quietly turn it into a
 * volume-only alarm (which would fire on every acquisition sprint and get muted
 * — the exact failure traffic-anomaly-alert.mjs exists to avoid).
 */
const GB = 1e9;
const day = (date: string, readGB: number, writeGB: number) => ({ date, readBytes: readGB * GB, writeBytes: writeGB * GB });

// A calm baseline: ~120 GB read/day, writes roughly half (normal serving + light pipeline).
function baseline(n: number, startRead = 120, startWrite = 60) {
  return Array.from({ length: n }, (_, i) => day(`2026-08-${String(i + 1).padStart(2, '0')}`, startRead, startWrite));
}

describe('assessSpike — extraction vs pipeline', () => {
  it('flags a read-only spike (the Aug 2–3 shape: ~2.5 TB read, tiny writes)', () => {
    const days = [...baseline(10), day('2026-08-11', 2570, 31)];
    const v = assessSpike(days);
    expect(v.flagged).toBe(true);
    expect(v.readsSpiked).toBe(true);
    expect(v.ratioSpiked).toBe(true);
    expect(v.aboveFloor).toBe(true);
  });

  it('does NOT flag our own acquisition push (reads AND writes both high)', () => {
    // Aug 9–20 shape: ~700 GB read with ~330 GB written — pipeline, not theft.
    const days = [...baseline(10), day('2026-08-11', 700, 330)];
    const v = assessSpike(days);
    expect(v.readsSpiked).toBe(true); // volume alone would fire…
    expect(v.ratioSpiked).toBe(false); // …but the read:write ratio stays normal
    expect(v.flagged).toBe(false);
  });

  it('does NOT flag a quiet day', () => {
    const days = [...baseline(10), day('2026-08-11', 130, 60)];
    expect(assessSpike(days).flagged).toBe(false);
  });

  it('does NOT flag a read-heavy but SMALL day (below the absolute floor)', () => {
    // ratio is extreme but only 50 GB moved — a blip, not an extraction.
    const days = [...baseline(10, 20, 10), day('2026-08-11', 50, 0.5)];
    const v = assessSpike(days);
    expect(v.aboveFloor).toBe(false);
    expect(v.flagged).toBe(false);
  });

  it('does NOT flag an ordinary serving-heavy, low-write day (the real Aug-24 shape)', () => {
    // 248 GB read / 1 GB write: extreme read:write ratio, but this is just
    // cache-miss serving of existing variants — NOT an extraction. The floor
    // is what keeps this from crying wolf; the ratio check can't, because
    // normal serving is read-only too.
    const days = [...baseline(10), day('2026-08-11', 248, 1)];
    const v = assessSpike(days);
    expect(v.ratioSpiked).toBe(true);   // ratio alone WOULD fire…
    expect(v.aboveFloor).toBe(false);   // …the scale floor is the real guard
    expect(v.flagged).toBe(false);
  });

  it('needs history before it will judge', () => {
    expect(assessSpike([day('2026-08-01', 3000, 1)]).flagged).toBe(false);
    expect(assessSpike([]).reason).toBe('insufficient_history');
  });
});
