import { describe, it, expect } from 'vitest';
// @ts-expect-error -- plain .mjs script, no types
import { previewWanted } from '../../scripts/vercel-ignore-build.mjs';

// Previews are opt-in (#5976). A regression here silently re-floods the one Vercel build slot.
describe('previewWanted', () => {
  it('skips an ordinary job or worktree branch', () => {
    expect(previewWanted({ ref: 'job-latin-r4-5924', message: 'eval: round 4 results' })).toBe(false);
    expect(previewWanted({ ref: 'worktree-reading-plan', message: 'research/reading-plan: page' })).toBe(false);
  });
  it('builds when the commit asks for it', () => {
    expect(previewWanted({ ref: 'worktree-x', message: 'ui: new card layout [preview]' })).toBe(true);
    expect(previewWanted({ ref: 'worktree-x', message: 'ui: tweak [Preview]' })).toBe(true);
  });
  it('builds a preview/ branch', () => {
    expect(previewWanted({ ref: 'preview/vision-copy', message: 'copy' })).toBe(true);
  });
  it('treats missing values as not wanted', () => {
    expect(previewWanted({})).toBe(false);
  });
});
