import { describe, it, expect } from 'vitest';
import { priorChipLabel, translationSearchNoticeKind } from '@/components/book/TranslationSearchNotice';

const search = (result: string) => ({ date: '2026-10-28T08:51:48Z', result, queries: ['q'] });
const prior = {
  work_title: 'An Essay on Generation',
  translators: ['A. Crichton'],
  scope: 'complete',
  url: 'https://wellcomecollection.org/works/jkfwenug',
  verification_method: 'other',
  verified_at: '2026-10-28',
} as never;

describe('translationSearchNoticeKind', () => {
  it('links a credited prior', () => {
    expect(translationSearchNoticeKind({ prior_translation: prior, pages_translated: 10, language: 'German' }, search('found'))).toBe('prior');
  });
  it('states none found on a translated, non-English book', () => {
    expect(translationSearchNoticeKind({ pages_translated: 10, language: 'Latin' }, search('not_found'))).toBe('none_found');
  });
  it('falls back to the older surfaces without a fresh search', () => {
    expect(translationSearchNoticeKind({ prior_translation: prior, pages_translated: 10, language: 'German' }, null)).toBeNull();
  });
  it('never claims a first for an English book or an untranslated one', () => {
    expect(translationSearchNoticeKind({ pages_translated: 10, language: 'English' }, search('not_found'))).toBeNull();
    expect(translationSearchNoticeKind({ pages_translated: 0, language: 'Latin' }, search('not_found'))).toBeNull();
  });
  it('shows nothing new for a found prior that had no usable link', () => {
    expect(translationSearchNoticeKind({ pages_translated: 10, language: 'Latin' }, search('found'))).toBeNull();
  });
});

describe('priorChipLabel', () => {
  it('says partial on a partial credit, so it does not read as a complete one', () => {
    expect(priorChipLabel({ scope: 'partial' })).toBe('Earlier partial English translation');
    expect(priorChipLabel({ scope: 'complete' })).toBe('Earlier English translation');
    expect(priorChipLabel(undefined)).toBe('Earlier English translation');
  });
});
