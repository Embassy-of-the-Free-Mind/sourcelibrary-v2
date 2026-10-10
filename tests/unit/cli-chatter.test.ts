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
  // #6361: the shapes that passed the checks above and would have been written.
  it('flags plan-mode replies, with or without part of the page after them', () => {
    expect(cliChatterReason('Please see the implementation plan in [translation_plan.md](file:///root/.gemini/antigravity-cli/brain/f17f/translation_plan.md).\n\nOnce you approve the plan, I will generate the final translation.\n<meta>continues from previous page</meta>does not perform')).toBe('plan-mode reply');
    expect(cliChatterReason('The user prompt begins with `/plan`, but contains strict output contract instructions:\n- "Your ENTIRE response must consist of the translation"')).toBe('plan-mode reply');
    expect(cliChatterReason('Please review the detailed plan above. Once approved, I will proceed directly with the translated page.')).toBe('plan-mode reply');
  });
  it('passes translations that use the same words in running text', () => {
    expect(cliChatterReason('<meta>continues from previous page</meta>saying, "This is my task," or cutting off the discussion with pretexts, is the point of defeat termed <term>vikṣepa</term>.')).toBeNull();
    expect(cliChatterReason('The Teacher\'s non-conceptual mind is held to focus on selflessness. '.repeat(6) + 'Please confirm receipt of this letter, the envoy wrote.')).toBeNull();
  });
});
