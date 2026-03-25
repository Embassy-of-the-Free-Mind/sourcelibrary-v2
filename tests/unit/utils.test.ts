import { describe, it, expect } from 'vitest';
import { normalizeText, isUsableImageUrl, isArchiveFailed, getPageImageUrl } from '@/lib/utils';

describe('normalizeText', () => {
  it('lowercases text', () => {
    expect(normalizeText('HELLO')).toBe('hello');
  });

  it('strips diacritics', () => {
    expect(normalizeText('Dürer')).toBe('durer');
    expect(normalizeText('café')).toBe('cafe');
    expect(normalizeText('señor')).toBe('senor');
  });

  it('trims whitespace', () => {
    expect(normalizeText('  hello  ')).toBe('hello');
  });

  it('handles combined transformations', () => {
    expect(normalizeText('  René Descartes  ')).toBe('rene descartes');
  });
});

describe('isUsableImageUrl', () => {
  it('accepts https URLs', () => {
    expect(isUsableImageUrl('https://example.com/image.jpg')).toBe(true);
  });

  it('accepts http URLs', () => {
    expect(isUsableImageUrl('http://example.com/image.jpg')).toBe(true);
  });

  it('rejects null', () => {
    expect(isUsableImageUrl(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isUsableImageUrl(undefined)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isUsableImageUrl('')).toBe(false);
  });

  it('rejects failed markers', () => {
    expect(isUsableImageUrl('failed:HTTP 404')).toBe(false);
  });

  it('rejects data URIs', () => {
    expect(isUsableImageUrl('data:image/png;base64,abc')).toBe(false);
  });
});

describe('isArchiveFailed', () => {
  it('detects failed: prefix', () => {
    expect(isArchiveFailed('failed:HTTP 404')).toBe(true);
    expect(isArchiveFailed('failed:timeout')).toBe(true);
  });

  it('rejects normal URLs', () => {
    expect(isArchiveFailed('https://example.com/img.jpg')).toBe(false);
  });

  it('handles null/undefined', () => {
    expect(isArchiveFailed(null)).toBe(false);
    expect(isArchiveFailed(undefined)).toBe(false);
  });
});

describe('getPageImageUrl', () => {
  it('prefers cropped_photo', () => {
    expect(getPageImageUrl({
      cropped_photo: 'https://r2.example.com/cropped.jpg',
      archived_photo: 'https://r2.example.com/archived.jpg',
      photo_original: 'https://ia.example.com/original.jpg',
      photo: 'https://ia.example.com/photo.jpg',
    })).toBe('https://r2.example.com/cropped.jpg');
  });

  it('falls back to archived_photo', () => {
    expect(getPageImageUrl({
      archived_photo: 'https://r2.example.com/archived.jpg',
      photo_original: 'https://ia.example.com/original.jpg',
    })).toBe('https://r2.example.com/archived.jpg');
  });

  it('returns null when archive failed (source URLs assumed dead)', () => {
    expect(getPageImageUrl({
      archived_photo: 'failed:HTTP 404',
      photo_original: 'https://ia.example.com/original.jpg',
      photo: 'https://ia.example.com/photo.jpg',
    })).toBeNull();
  });

  it('falls back to photo_original when no archived version', () => {
    expect(getPageImageUrl({
      photo_original: 'https://ia.example.com/original.jpg',
      photo: 'https://ia.example.com/photo.jpg',
    })).toBe('https://ia.example.com/original.jpg');
  });

  it('falls back to photo as last resort', () => {
    expect(getPageImageUrl({
      photo: 'https://ia.example.com/photo.jpg',
    })).toBe('https://ia.example.com/photo.jpg');
  });

  it('returns null when no images available', () => {
    expect(getPageImageUrl({})).toBeNull();
  });
});
