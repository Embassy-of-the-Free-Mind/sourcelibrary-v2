import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs helper
import { cliChatterReason } from '../../scripts/lib/cli-chatter.mjs';

describe('cliChatterReason', () => {
  it('passes a plain translation', () => {
    expect(cliChatterReason('The farmer is expert in the field, but cannot be master of the field.')).toBeNull();
    expect(cliChatterReason('<translation>Here the Way is one.</translation>')).toBeNull();
  });
  it('flags chatter, tool output, refusals and empties', () => {
    expect(cliChatterReason("I'll translate this page now.")).toBe('conversational opener');
    expect(cliChatterReason('Here is the translation:\n\nThe farmer')).toBe('conversational opener');
    expect(cliChatterReason('Reading file /tmp/x/page.jpg\nThe farmer')).toBe('tool output');
    expect(cliChatterReason('The text. I cannot provide a translation of this.')).toBe('refusal');
    expect(cliChatterReason('   ')).toBe('empty');
  });
});
