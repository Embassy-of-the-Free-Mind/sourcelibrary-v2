/**
 * The v16 translation-prompt candidate (#4767, #5376): v15 + the note-scope sentence + the bare
 * continuity marker. The input is the real v15 text, recovered from the arms the restraint A/B
 * recorded (scripts/eval/results/translation-restraint-ab-2026-09-30/arms.json).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { buildArms, buildV16, V16_SCOPE, V16_MARKER_OLD, V16_MARKER_NEW } from '../../scripts/eval/translation-restraint-ab.mjs';

const ARMS = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/eval/results/translation-restraint-ab-2026-09-30/arms.json'), 'utf8'));
const V15: string = ARMS.text.A1.replace('\n' + V16_SCOPE, '');
const sha = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 12);

describe('the arms the restraint A/B ran are unchanged', () => {
  it('rebuilds A1 and B to the recorded hashes', () => {
    expect(V15).not.toContain(V16_SCOPE);
    const arms = buildArms(V15);
    expect(sha(arms.A1)).toBe(ARMS.arms.A1.sha);
    expect(sha(arms.B)).toBe(ARMS.arms.B.sha);
  });
});

describe('buildV16', () => {
  const v16 = buildV16(V15);

  it('removes the line that invites text after the marker, and only that line', () => {
    expect(V15).toContain(V16_MARKER_OLD);
    expect(v16).not.toContain('continues from previous page: ...');
    expect(v16).toContain(V16_MARKER_NEW);
    expect(v16.length - buildArms(V15).A1.length).toBe(V16_MARKER_NEW.length - V16_MARKER_OLD.length);
  });
  it('keeps the note-scope sentence and the continuity rule that already asked for the bare marker', () => {
    expect(v16).toContain(V16_SCOPE);
    expect(v16).toContain('start with <meta>continues from previous page</meta> then begin the translation mid-sentence');
  });
  it('every continuity marker the prompt now shows the model is the bare form', () => {
    const shown = [...v16.matchAll(/<meta>continues from previous page[\s\S]*?<\/meta>/g)].map(m => m[0]);
    expect(shown.length).toBeGreaterThanOrEqual(2);
    for (const s of shown) expect(s).toBe('<meta>continues from previous page</meta>');
  });
  it('obeys the prompt\'s own style rule: no em-dash in the new line', () => {
    expect(V16_MARKER_NEW).not.toContain('—');
  });
  it('refuses a v15 row whose anchor line has changed', () => {
    expect(() => buildV16(V15.replace(V16_MARKER_OLD, '  - Context from previous page → something else'))).toThrow(/anchor/);
  });
});
