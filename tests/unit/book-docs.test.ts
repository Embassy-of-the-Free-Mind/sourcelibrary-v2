/**
 * makeBookDoc / makePageDoc: the code-level schema guard for import inserts (#3969).
 *
 * What these pin: an unknown key THROWS at construction time (naming the
 * offending keys), so the 478th `books` field cannot ship silently; retired
 * fields (tenant_id and friends) are refused with the incident that retired
 * them; and timestamps are filled only when absent. Pure construction logic —
 * no DB involved.
 */
import { describe, it, expect } from 'vitest';

import {
  makeBookDoc,
  makePageDoc,
  BOOK_FIELDS,
  PAGE_FIELDS,
  RETIRED_FIELDS,
} from '../../scripts/lib/book-docs.mjs';

describe('makeBookDoc', () => {
  it('passes through a valid import-shaped doc and fills timestamps', () => {
    const doc = makeBookDoc({
      id: '66f000000000000000000001',
      slug: 'de-occulta-philosophia-agrippa',
      title: 'De occulta philosophia',
      author: 'Heinrich Cornelius Agrippa',
      language: 'Latin',
      published: '1533',
      categories: ['occult'],
      pages_count: 362,
      pages_ocr: 0,
      pages_translated: 0,
      status: 'draft',
      hidden: true,
      visible: false,
      image_source: { provider: 'internet_archive' },
      source_fingerprint: 'ia:deoccultaphiloso00agri',
    });
    expect(doc.title).toBe('De occulta philosophia');
    expect(doc.created_at).toBeInstanceOf(Date);
    expect(doc.updated_at).toBeInstanceOf(Date);
  });

  it('preserves caller-supplied timestamps instead of overwriting them', () => {
    const then = new Date('2020-01-01T00:00:00Z');
    const doc = makeBookDoc({ title: 'X', created_at: then, updated_at: then });
    expect(doc.created_at).toBe(then);
    expect(doc.updated_at).toBe(then);
  });

  it('returns a copy — the input object is not mutated', () => {
    const input = { title: 'X' };
    const doc = makeBookDoc(input);
    expect(doc).not.toBe(input);
    expect('created_at' in input).toBe(false);
  });

  it('throws listing every unknown key', () => {
    expect(() =>
      makeBookDoc({ title: 'X', my_new_sweep_field: true, another_stray: 1 })
    ).toThrow(/unknown field\(s\): my_new_sweep_field, another_stray/);
  });

  it('refuses retired fields by name, citing the retirement', () => {
    expect(() => makeBookDoc({ title: 'X', tenant_id: 'default' })).toThrow(/retired.*tenant_id.*#3983/s);
    expect(() => makeBookDoc({ title: 'X', tenantId: 'default' })).toThrow(/retired.*tenantId/s);
    expect(() => makeBookDoc({ title: 'X', hide_reason: 'dup' })).toThrow(/retired.*hide_reason/s);
  });

  it('throws on a non-object input', () => {
    expect(() => makeBookDoc(null as never)).toThrow(/plain object/);
    expect(() => makeBookDoc(['title'] as never)).toThrow(/plain object/);
  });
});

describe('makePageDoc', () => {
  it('passes through a valid import-shaped page doc and fills timestamps', () => {
    const doc = makePageDoc({
      id: '66f000000000000000000002',
      book_id: '66f000000000000000000001',
      page_number: 1,
      photo: 'https://r2.example/pages/66f000000000000000000001/0001.jpg',
      photo_original: 'https://r2.example/pages/66f000000000000000000001/0001-full.jpg',
      thumbnail: 'https://r2.example/pages/66f000000000000000000001/0001-thumb.jpg',
    });
    expect(doc.page_number).toBe(1);
    expect(doc.created_at).toBeInstanceOf(Date);
    expect(doc.updated_at).toBeInstanceOf(Date);
  });

  it('throws on unknown keys — book fields are not page fields', () => {
    expect(() => makePageDoc({ book_id: 'b1', page_number: 1, pages_count: 5 })).toThrow(
      /unknown field\(s\): pages_count/
    );
  });

  it('refuses retired tenant_id on pages too', () => {
    expect(() => makePageDoc({ book_id: 'b1', page_number: 1, tenant_id: 'default' })).toThrow(/retired/);
  });
});

describe('whitelists', () => {
  it('never contain a retired field', () => {
    for (const retired of Object.keys(RETIRED_FIELDS)) {
      expect(BOOK_FIELDS).not.toContain(retired);
      expect(PAGE_FIELDS).not.toContain(retired);
    }
  });

  it('are frozen and duplicate-free', () => {
    expect(Object.isFrozen(BOOK_FIELDS)).toBe(true);
    expect(Object.isFrozen(PAGE_FIELDS)).toBe(true);
    expect(new Set(BOOK_FIELDS).size).toBe(BOOK_FIELDS.length);
    expect(new Set(PAGE_FIELDS).size).toBe(PAGE_FIELDS.length);
  });
});
