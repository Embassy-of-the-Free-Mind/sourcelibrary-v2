/**
 * Gallery grid variants keep a usable height on wide crops (#3229).
 *
 * A width-only resize turned a 6:1 banner into a 300×50 thumb — blurry in any
 * fixed-height slot, and below GalleryClient's 150px "corrupt thumb" cutoff, so
 * the grid threw it away. And generateGalleryImages() never wrote the `-card.jpg`
 * the grid prefers, so a re-crop left the old crop's card on screen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

const puts: string[] = [];
let source: Buffer;

vi.mock('@/lib/storage', () => ({
  storagePut: vi.fn(async (key: string) => {
    puts.push(key);
    return { url: `https://images.example/${key}` };
  }),
}));
vi.mock('@/lib/api-client/images', () => ({
  images: { fetchBuffer: vi.fn(async () => source) },
}));

import { galleryVariant, generateGalleryImages } from '@/lib/gallery-image-gen';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 120, g: 90, b: 60 } } }).jpeg().toBuffer();

async function dims(buf: Buffer) {
  const m = await sharp(buf).metadata();
  return [m.width, m.height];
}

describe('galleryVariant', () => {
  it('floors a wide banner at width/2 tall instead of a sliver', async () => {
    expect(await dims(await galleryVariant(await solid(6000, 1000), 300, 70))).toEqual([900, 150]);
    expect(await dims(await galleryVariant(await solid(6000, 1000), 600, 72))).toEqual([1800, 300]);
  });

  it('leaves ordinary and tall crops width-governed', async () => {
    expect(await dims(await galleryVariant(await solid(2000, 1000), 300, 70))).toEqual([300, 150]);
    expect(await dims(await galleryVariant(await solid(1000, 3000), 300, 70))).toEqual([300, 900]);
  });

  it('never upscales a small crop', async () => {
    expect(await dims(await galleryVariant(await solid(200, 40), 300, 70))).toEqual([200, 40]);
  });
});

describe('generateGalleryImages', () => {
  beforeEach(() => { puts.length = 0; });

  it('writes the -card.jpg alongside the thumb, so a re-crop refreshes what the grid shows', async () => {
    source = await solid(4000, 1000);
    await generateGalleryImages({
      sourceImageUrl: 'https://images.example/page.jpg',
      bbox: { x: 0.05, y: 0.05, width: 0.9, height: 0.1 },
      bookId: 'book1',
      pageId: 'page1',
      detectionIndex: 0,
    });
    expect(puts.sort()).toEqual([
      'gallery/book1/page1-0-card.jpg',
      'gallery/book1/page1-0-thumb.jpg',
      'gallery/book1/page1-0.jpg',
    ]);
  });
});
