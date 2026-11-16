import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs maintenance script, no type declarations
import { isArticleOnly } from '../../scripts/maintenance/preview-auto.mjs';

describe('preview-auto: which PRs get a preview without asking', () => {
  it('an article-only PR does', () => {
    expect(
      isArticleOnly([
        'src/app/articles/sacred-baths/page.tsx',
        'src/app/articles/posts.ts',
        'src/components/articles/PageFigure.tsx',
        'public/articles/sacred-baths/tudela.jpg',
        'src/generated/article-cited-pages.json',
      ]),
    ).toBe(true);
  });

  it('one file outside article content means no', () => {
    expect(isArticleOnly(['src/app/articles/sacred-baths/page.tsx', 'src/lib/shelf.ts'])).toBe(false);
    expect(isArticleOnly(['src/app/articles/x/page.tsx', '.github/workflows/preview-label.yml'])).toBe(false);
  });

  it('look-alike paths do not count', () => {
    expect(isArticleOnly(['src/app/articlesx/page.tsx'])).toBe(false);
    expect(isArticleOnly(['public/articles-old/a.jpg'])).toBe(false);
    expect(isArticleOnly(['src/generated/article-x/nested.json'])).toBe(false);
    expect(isArticleOnly(['src/generated/books.json'])).toBe(false);
    expect(isArticleOnly(['app/src/app/articles/x/page.tsx'])).toBe(false);
  });

  it('an empty file list is not article-only', () => {
    expect(isArticleOnly([])).toBe(false);
    expect(isArticleOnly(['', '  '])).toBe(false);
  });
});
