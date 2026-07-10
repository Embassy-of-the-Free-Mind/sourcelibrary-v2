import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateKdpEpub } from '@/lib/kdp-epub';
import type { Book, Page } from '@/lib/types';

// Minimal db mock: gallery lookup returns empty (no network image fetches).
const mockDb = {
  collection: () => ({
    find: () => ({
      sort: () => ({
        limit: () => ({ toArray: async () => [] }),
      }),
    }),
  }),
} as unknown as Parameters<typeof generateKdpEpub>[2];

const book = {
  id: 'test-book',
  slug: 'test-book',
  title: 'Liber Testis',
  display_title: 'The Book of Testing',
  author: 'Anonymous',
  language: 'Latin',
  published: '1615',
  reading_summary: { overview: 'A short overview of the test work.', quotes: [] },
} as unknown as Book;

const pages = [
  {
    id: 'p1', book_id: 'test-book', page_number: 1, photo: '',
    translation: { data: '<meta>This page describes mercury from the previous leaf.</meta>\n\nThe first true sentence of the translation.', model: 'gemini-3.1-flash-lite', language: 'en' },
  },
  {
    id: 'p2', book_id: 'test-book', page_number: 2, photo: '',
    translation: { data: '## A Heading\n\nThe second page of real prose <note>a marginal gloss</note> continues here.', model: 'gemini-3.1-flash-lite', language: 'en' },
  },
] as unknown as Page[];

describe('generateKdpEpub', () => {
  it('produces a valid EPUB zip with expected structure and stripped editorial wrappers', async () => {
    const buf = await generateKdpEpub(book, pages, mockDb, { aiDisclosure: 'AI note.' });

    expect(Buffer.isBuffer(buf)).toBe(true);
    // ZIP magic
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');

    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);

    // Core EPUB files
    for (const f of ['mimetype', 'META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/styles.css', 'OEBPS/title.xhtml', 'OEBPS/copyright.xhtml', 'OEBPS/chapter-0.xhtml', 'OEBPS/colophon.xhtml']) {
      expect(names, `missing ${f}`).toContain(f);
    }

    // mimetype must be the correct value
    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip');

    // Chapter body: real prose kept, editorial <meta> prose stripped
    const chapter = await zip.file('OEBPS/chapter-0.xhtml')!.async('string');
    expect(chapter).toContain('The first true sentence of the translation.');
    expect(chapter).not.toContain('describes mercury from the previous leaf');
    expect(chapter).toContain('[p.&#160;1]'); // folio marker

    // Inline gloss: tag removed, content kept (not rendered as literal "<note>")
    expect(chapter).toContain('a marginal gloss');
    expect(chapter).not.toContain('&lt;note&gt;');

    // OPF references the nav + is reflowable (no pre-paginated rendition)
    const opf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(opf).toContain('properties="nav"');
    expect(opf).not.toContain('pre-paginated');
    expect(opf).toContain('<dc:language>en</dc:language>');
  });
});
