/**
 * Translation prompt v18 (#7085): v13 with the continuity marker's payload slot removed. Pinned:
 * the new line is the measured item 1b wording (as committed in the seam candidate), the edit is the
 * only change, and a base that does not carry the old line exactly once is refused.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildV18, PAYLOAD_LINE, BARE_LINE } from '../../scripts/maintenance/translation-prompt-v18-bare-continuity.mjs';

const seam = fs.readFileSync(path.join(__dirname, '../../prompts/translation/standard-translation-seam-candidate.md'), 'utf8');

describe('translation prompt v18: bare continuity marker', () => {
  it('uses the wording the seam run measured, byte for byte', () => {
    expect(seam.split(BARE_LINE).length - 1).toBe(1);
    expect(seam.includes(PAYLOAD_LINE)).toBe(false);
  });

  it('changes that one line and nothing else', () => {
    const v13 = `**Do NOT use:**\n${PAYLOAD_LINE}\n  - Interpolated clarifications → <note>...</note>\n`;
    const v18 = buildV18(v13);
    expect(v18).toBe(`**Do NOT use:**\n${BARE_LINE}\n  - Interpolated clarifications → <note>...</note>\n`);
    expect(v18).not.toContain('continues from previous page: ...');
  });

  it('refuses a base without the line, or with it twice', () => {
    expect(() => buildV18('no such line')).toThrow(/matched 0x/);
    expect(() => buildV18(`${PAYLOAD_LINE}\n${PAYLOAD_LINE}`)).toThrow(/matched 2x/);
  });
});
