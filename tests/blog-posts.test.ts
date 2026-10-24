import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { posts, LINKED_PAGES, BLOG_KINDS, KIND_INFO, UNLISTED_PAGES } from '@/app/articles/posts';

// #6049: every Research Note has one of a closed set of kinds, and every page
// under src/app/blog is either in the list or deliberately left out with a reason.
const BLOG_DIR = path.join(__dirname, '..', 'src', 'app', 'articles');

describe('blog post list', () => {
  it('gives every post a kind from the closed set', () => {
    const unkinded = posts.filter((p) => !(BLOG_KINDS as readonly string[]).includes(p.kind));
    expect(unkinded.map((p) => p.slug)).toEqual([]);
  });

  it('has no duplicate slugs', () => {
    const slugs = posts.map((p) => p.slug);
    expect(slugs.length).toBe(new Set(slugs).size);
  });

  it('names a lead for each kind that is a post of that kind', () => {
    for (const kind of BLOG_KINDS) {
      const lead = posts.find((p) => p.slug === KIND_INFO[kind].lead);
      expect(lead?.kind, `lead of ${kind}`).toBe(kind);
    }
  });

  it('every kind has at least one post', () => {
    for (const kind of BLOG_KINDS) {
      expect(posts.some((p) => p.kind === kind), kind).toBe(true);
    }
  });

  it('has a page for every listed post', () => {
    const missing = posts.filter((p) => !existsSync(path.join(BLOG_DIR, p.slug, 'page.tsx')));
    expect(missing.map((p) => p.slug)).toEqual([]);
  });

  it('lists every page under src/app/blog or names why it is left out', () => {
    const listed = new Set(posts.map((p) => p.slug));
    const pages = readdirSync(BLOG_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(path.join(BLOG_DIR, d.name, 'page.tsx')))
      .map((d) => d.name);
    const unaccounted = pages.filter((slug) => !listed.has(slug) && !UNLISTED_PAGES[slug]);
    expect(unaccounted).toEqual([]);
    const listedAndUnlisted = Object.keys(UNLISTED_PAGES).filter((slug) => listed.has(slug));
    expect(listedAndUnlisted).toEqual([]);
  });

  // next/image refuses (HTTP 400) any host not in next.config's remotePatterns,
  // and the card then shows a broken image. A file in public/ is a local path.
  it('serves every image from a path or a host next/image allows', () => {
    const config = readFileSync(path.join(__dirname, '..', 'next.config.ts'), 'utf8');
    const patterns = [...config.matchAll(/hostname:\s*'([^']+)'/g)].map((m) => m[1]);
    const allowed = (host: string) =>
      patterns.some((p) =>
        p.startsWith('**.') ? host.endsWith(p.slice(2)) : p.startsWith('*.') ? host.endsWith(p.slice(1)) : host === p,
      );
    const bad = posts.filter((p) => {
      if (p.image.startsWith('/')) return !existsSync(path.join(__dirname, '..', 'public', p.image));
      return !allowed(new URL(p.image).hostname);
    });
    expect(bad.map((p) => `${p.slug}: ${p.image}`)).toEqual([]);
  });

  it('parses every date, so the index and the feed can sort', () => {
    const bad = posts.filter((p) => Number.isNaN(Date.parse(p.date)));
    expect(bad.map((p) => p.slug)).toEqual([]);
  });

  // An article folder named like a category would shadow /articles/<category>.
  it('never names an article like a category', () => {
    const clash = posts.filter((p) => (BLOG_KINDS as readonly string[]).includes(p.slug));
    expect(clash.map((p) => p.slug)).toEqual([]);
  });

  // The summary is the /articles card text and the meta description.
  it('gives every post and linked page a short summary with no dashes', () => {
    const bad = [...posts, ...LINKED_PAGES].filter(
      (p) => !p.summary?.trim() || p.summary.length > 155 || p.summary.includes('—') || p.summary.includes(' – '),
    );
    expect(bad.map((p) => `${p.slug} (${p.summary?.length ?? 0})`)).toEqual([]);
  });

  it('gives every linked page a kind, an address outside /articles and an image', () => {
    const bad = LINKED_PAGES.filter(
      (p) => !(BLOG_KINDS as readonly string[]).includes(p.kind) || !p.href?.startsWith('/') || p.href.startsWith('/articles') || !p.image,
    );
    expect(bad.map((p) => p.slug)).toEqual([]);
  });

  // .claude/docs/article-rules.md, mechanically: every article has the tall
  // dark hero (which is also its share image) and wraps its metadata.
  const articleDirs = readdirSync(BLOG_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('[') && d.name !== 'page' && existsSync(path.join(BLOG_DIR, d.name, 'page.tsx')))
    .map((d) => d.name);
  const folderSource = (dir: string) =>
    readdirSync(path.join(BLOG_DIR, dir))
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => readFileSync(path.join(BLOG_DIR, dir, f), 'utf8'))
      .join('\n');

  it('gives every article the tall dark hero (ContentHeader feature, headerVariant="dark")', () => {
    const bad = articleDirs.filter((d) => {
      const src = folderSource(d);
      const tag = src.match(/<ContentHeader\b[\s\S]*?>/)?.[0] ?? '';
      return !tag || !/\bfeature\b/.test(tag) || !/headerVariant="dark"/.test(tag);
    });
    expect(bad).toEqual([]);
  });

  it('wraps every article page metadata in withArticleMeta', () => {
    const bad = articleDirs.filter((d) => !/withArticleMeta\(/.test(readFileSync(path.join(BLOG_DIR, d, 'page.tsx'), 'utf8')));
    expect(bad).toEqual([]);
  });

  // No red text in articles. The older articles still carry the rust classes
  // (globals.css neutralises them under .article-page); this ratchet only lets
  // the number go DOWN. Lower it when you clean an article.
  it('does not add red text classes to articles (ratchet)', () => {
    const RATCHET = 63;
    const files = articleDirs.flatMap((d) =>
      readdirSync(path.join(BLOG_DIR, d)).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(BLOG_DIR, d, f)),
    );
    const withRust = files.filter((f) => /text-accent-rust/.test(readFileSync(f, 'utf8')));
    expect(withRust.length, `files with text-accent-rust: ${withRust.map((f) => path.relative(BLOG_DIR, f)).join(', ')}`).toBeLessThanOrEqual(RATCHET);
  });

  // The card picture's alt text, read by screen readers and search engines.
  it('describes every card picture (imageAlt)', () => {
    const bad = [...posts, ...LINKED_PAGES].filter((p) => !p.imageAlt?.trim());
    expect(bad.map((p) => p.slug)).toEqual([]);
  });

  // The book grid and the share images read these generated files; a stale one
  // shows the wrong books or the wrong picture in link previews.
  it('has src/generated/article-books.json up to date', async () => {
    const { buildArticleBooks } = await import('../scripts/maintenance/generate-article-books.mjs');
    const stored = JSON.parse(readFileSync(path.join(__dirname, '..', 'src', 'generated', 'article-books.json'), 'utf8'));
    expect(stored, 'run node scripts/maintenance/generate-article-books.mjs').toEqual(buildArticleBooks());
  });

  it('has src/generated/article-heroes.json up to date, with a hero for every listed post', async () => {
    const { buildArticleHeroes } = await import('../scripts/maintenance/generate-article-heroes.mjs');
    const stored = JSON.parse(readFileSync(path.join(__dirname, '..', 'src', 'generated', 'article-heroes.json'), 'utf8'));
    expect(stored, 'run node scripts/maintenance/generate-article-heroes.mjs').toEqual(buildArticleHeroes());
    expect(posts.filter((p) => !stored[p.slug]).map((p) => p.slug)).toEqual([]);
  });
});
