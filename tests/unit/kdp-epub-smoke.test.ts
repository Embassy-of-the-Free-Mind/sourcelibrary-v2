import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import sharp from 'sharp';

// Count upstream scan fetches so the dedup below is measured, not assumed.
const fetchState = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock('@/lib/api-client', () => ({
  images: {
    fetchBuffer: async (url: string) => {
      fetchState.urls.push(url);
      return await sharp({
        create: { width: 12, height: 16, channels: 3, background: { r: 200, g: 200, b: 200 } },
      }).jpeg().toBuffer();
    },
  },
}));
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


// Two detections on ONE page resolve to the same page scan. Before the url-keyed
// dedup this fetched twice, embedded two identical JPEGs, and rendered the plate
// twice in a row in the chapter.
describe('generateKdpEpub illustrations', () => {
  it('embeds one image per unique scan url and captions it with every detection', async () => {
    fetchState.urls.length = 0;

    const galleryDb = {
      collection: () => ({
        find: () => ({
          sort: () => ({
            limit: () => ({
              toArray: async () => [
                { book_id: 'test-book', page_number: 1, detection_index: 0, type: 'engraving', gallery_quality: 0.9, museum_description: 'An alchemical furnace.' },
                { book_id: 'test-book', page_number: 1, detection_index: 1, type: 'emblem', gallery_quality: 0.85, museum_description: 'A crowned serpent.' },
              ],
            }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof generateKdpEpub>[2];

    const illustratedPages = [
      { ...pages[0], cropped_photo: 'https://example.invalid/scan/page-1.jpg' },
      pages[1],
    ] as unknown as Page[];

    const buf = await generateKdpEpub(book, illustratedPages, galleryDb);
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);

    // One fetch, one embedded asset — not one per detection.
    expect(fetchState.urls).toEqual(['https://example.invalid/scan/page-1.jpg']);
    expect(names.filter(n => n.startsWith('OEBPS/images/'))).toHaveLength(1);

    // One <figure>, carrying both detections' descriptions.
    const chapter = await zip.file('OEBPS/chapter-0.xhtml')!.async('string');
    expect(chapter.match(/<figure class="illustration">/g) || []).toHaveLength(1);
    expect(chapter).toContain('An alchemical furnace.');
    expect(chapter).toContain('A crowned serpent.');
  });
});
