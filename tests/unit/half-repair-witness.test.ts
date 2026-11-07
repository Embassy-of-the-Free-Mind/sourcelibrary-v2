import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script module, no types
import { halfRepairWitness } from '../../scripts/lib/page-alignment.mjs';

// Pins when an image repair may overwrite a book whose text was already moved (#8266).
describe('halfRepairWitness', () => {
  const flagged = { archive_metadata: { jp2_text_shift_awaiting_image_rearchive: true } };
  const slots = Array.from({ length: 300 }, (_, i) => i + 1);

  it('accepts a flagged book opened near both ends', () => {
    expect(halfRepairWitness(flagged, [20, 280], slots)).toEqual({ ok: true });
  });

  it('refuses a book not awaiting images, whatever was opened', () => {
    expect(halfRepairWitness({ archive_metadata: {} }, [20, 280], slots).ok).toBe(false);
    expect(halfRepairWitness(null, [20, 280], slots).ok).toBe(false);
  });

  it('refuses when no slots were opened', () => {
    expect(halfRepairWitness(flagged, null, slots).ok).toBe(false);
  });

  it('refuses slots from one end only', () => {
    expect(halfRepairWitness(flagged, [10, 20, 30], slots).ok).toBe(false);
    expect(halfRepairWitness(flagged, [150], slots).ok).toBe(false);
  });

  it('ignores slots outside the repaired range and unparsed input', () => {
    expect(halfRepairWitness(flagged, [20, 999], slots).ok).toBe(false);
    expect(halfRepairWitness(flagged, [20, NaN], slots).ok).toBe(false);
  });
});
