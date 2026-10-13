import { describe, it, expect } from 'vitest';
import { IDEAS, TRADITION_LABELS, passageHref, sourceNote, traditionsOf } from '@/app/ideas/ideas';

// /ideas renders a BUILT file (scripts/eval/embed-granularity/build-idea-pages.mjs).
// The quote-on-page check needs the stores and lives in that script's --check;
// this pins the shape the route relies on, so a hand edit cannot ship a page
// with an unlabelled tradition, an off-host link or a passage with no note.
describe('idea pages data', () => {
  it('has ideas, each spanning at least three labelled traditions', () => {
    expect(IDEAS.length).toBeGreaterThanOrEqual(20);
    for (const idea of IDEAS) {
      const traditions = traditionsOf(idea);
      expect(traditions.length, idea.slug).toBeGreaterThanOrEqual(3);
      for (const t of traditions) expect(TRADITION_LABELS[t], `${idea.slug}: ${t}`).toBeTruthy();
    }
  });

  it('slugs are unique and URL-safe', () => {
    const slugs = IDEAS.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('every passage has a quote, a relative link to its page, and a note on whose words it is', () => {
    for (const idea of IDEAS) {
      for (const p of idea.passages) {
        expect(p.quote.length, idea.slug).toBeGreaterThan(20);
        expect(p.quote).not.toMatch(/<[a-z-]+[ >/]/i);
        expect(passageHref(p)).toMatch(/^\/book\/[^/?]+\?page=\d+$/);
        expect(['machine', 'original', 'published', 'edited']).toContain(p.source);
        expect(sourceNote(p)).toBeTruthy();
      }
    }
  });
});
