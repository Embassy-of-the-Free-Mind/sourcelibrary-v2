import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'fs';
import path from 'path';
import { posts, BLOG_KINDS, KIND_INFO, UNLISTED_PAGES } from '@/app/blog/posts';

// #6049: every Research Note has one of a closed set of kinds, and every page
// under src/app/blog is either in the list or deliberately left out with a reason.
const BLOG_DIR = path.join(__dirname, '..', 'src', 'app', 'blog');

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

  it('parses every date, so the index and the feed can sort', () => {
    const bad = posts.filter((p) => Number.isNaN(Date.parse(p.date)));
    expect(bad.map((p) => p.slug)).toEqual([]);
  });
});
