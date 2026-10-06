import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { pageSourceTs, incrementalSourceFilter, nextWatermark, COMMIT_MARGIN_MS } from '../../scripts/lib/embed-watermark.mjs';

// embed-gemini --incremental skipped pages forever (#5869): its mark was
// max(updated_at) over every writer's rows in page_translations, so
// enrich-worker Phase 6, envelope-scoped runs and --book runs pushed it past
// pages the cron had never read. ~910K translated pages on live books had no
// vector on 2026-10-05. These pin the replacement rule.

const start = new Date('2026-10-05T12:00:00Z');
const prior = new Date('2026-10-05T04:00:00Z');
const read = new Date('2026-10-05T08:00:00Z');
const clean = { prior, maxReadTs: read, startedAt: start, scoped: false, limited: false, errors: 0 };

describe('nextWatermark — the mark moves only after a run that saw everything', () => {
  it('advances to the newest timestamp the run read, after an unscoped clean run', () => {
    expect(nextWatermark(clean)).toEqual(read);
  });

  it('holds after a scoped run (envelope, shard, --book): it did not look at the other books', () => {
    expect(nextWatermark({ ...clean, scoped: true })).toBeNull();
  });

  it('holds after a --limit run: the pages past the limit were never read', () => {
    expect(nextWatermark({ ...clean, limited: true })).toBeNull();
  });

  it('holds when any page failed to embed or upsert', () => {
    expect(nextWatermark({ ...clean, errors: 1 })).toBeNull();
  });

  it('holds when the run read nothing', () => {
    expect(nextWatermark({ ...clean, maxReadTs: null })).toBeNull();
  });

  it('never moves backward', () => {
    expect(nextWatermark({ ...clean, maxReadTs: new Date('2026-10-05T03:00:00Z') })).toBeNull();
    expect(nextWatermark({ ...clean, maxReadTs: prior })).toBeNull();
  });

  it('is capped at run start minus the commit margin, so a page written mid-scan is re-read, not skipped', () => {
    const justBefore = new Date(start.getTime() - 60_000);
    expect(nextWatermark({ ...clean, maxReadTs: justBefore })).toEqual(new Date(start.getTime() - COMMIT_MARGIN_MS));
  });
});

describe('pageSourceTs / incrementalSourceFilter agree on what "changed" means', () => {
  it('takes the newer of translation and OCR timestamps', () => {
    const t = new Date('2026-10-01T00:00:00Z');
    const o = new Date('2026-10-02T00:00:00Z');
    expect(pageSourceTs({ translation: { updated_at: t }, ocr: { updated_at: o } })).toEqual(o);
    expect(pageSourceTs({ translation: { updated_at: o }, ocr: { updated_at: t } })).toEqual(o);
    expect(pageSourceTs({ ocr: { updated_at: t } })).toEqual(t);
    expect(pageSourceTs({})).toBeNull();
  });

  it('filters on both timestamps', () => {
    const f = incrementalSourceFilter(prior);
    expect(f.$or).toEqual([
      { 'translation.updated_at': { $gt: prior } },
      { 'ocr.updated_at': { $gt: prior } },
    ]);
  });
});

describe('embed-gemini wiring', () => {
  const src = readFileSync(path.resolve(__dirname, '..', '..', 'scripts/workers/embed-gemini.mjs'), 'utf8');

  it('selects incrementally from the worker-owned mark, not from page_translations', () => {
    expect(src).toContain('readWatermark(db)');
    expect(src).toContain('incrementalSourceFilter(incrementalMark)');
    expect(src).not.toMatch(/getLastSyncTime/);
  });

  it('--books-file does not exclude translated pages', () => {
    expect(src).not.toMatch(/\['translation\.data'\]\s*=\s*\{\s*\$exists:\s*false/);
  });
});

describe('embed-gemini spend attribution for envelope-funded runs', () => {
  const src = readFileSync(path.resolve(__dirname, '..', '..', 'scripts/workers/embed-gemini.mjs'), 'utf8');

  it('--books-file / --book runs log gemini_usage with a book_id, so a scope envelope can meter them', () => {
    // spend-guard getScopeSpendUsd attributes by book_id; a null book_id reads as $0.
    expect(src).toMatch(/ATTRIBUTE_PER_BOOK\s*=\s*Boolean\(BOOKS_FILE \|\| BOOK_ID\)/);
    expect(src).toMatch(/logEmbeddingUsage\(usage, \{ model: MODEL, bookId,/);
  });
});
