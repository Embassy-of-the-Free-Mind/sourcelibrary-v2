import { describe, it, expect } from 'vitest';
import {
  ASSISTANT_SOURCES,
  createSourceTally,
  isAssistantSource,
  pageviewSource,
  sourceExpr,
  sourceFilter,
  sourceLabel,
} from '../../scripts/lib/pageview-source.mjs';

// A link opened from ChatGPT arrives tagged utm_source=chatgpt.com with no
// referrer. Reports that read only `referrer` filed those readers under
// "direct" and showed ChatGPT near zero (v2#8161). These pin the one rule every
// report now shares: the tag first, then the referrer, each row counted once.
describe('pageviewSource', () => {
  it('lets the utm tag win over a "direct" referrer', () => {
    expect(pageviewSource({ referrer: 'direct', utm: { source: 'chatgpt.com' } })).toEqual({
      source: 'ChatGPT', via: 'utm', assistant: true,
    });
  });

  it('falls back to the referrer, then to direct', () => {
    expect(pageviewSource({ referrer: 'claude.ai' })).toEqual({ source: 'Claude', via: 'referrer', assistant: true });
    expect(pageviewSource({ referrer: 'https://www.bing.com/search?q=x' }).source).toBe('www.bing.com');
    expect(pageviewSource({ referrer: 'google.com' })).toEqual({ source: 'google.com', via: 'referrer', assistant: false });
    for (const row of [{}, { referrer: null }, { referrer: '' }, { referrer: 'direct' }, { referrer: 'direct', utm: { medium: 'email' } }]) {
      expect(pageviewSource(row)).toEqual({ source: 'direct', via: 'direct', assistant: false });
    }
  });

  it('passes an unknown utm source through unchanged', () => {
    expect(pageviewSource({ referrer: 'direct', utm: { source: 'ig_text_post_permalink' } }).source).toBe('ig_text_post_permalink');
    expect(pageviewSource({ referrer: 'direct', utm: { source: 'Pinterest' } })).toEqual({ source: 'Pinterest', via: 'utm', assistant: false });
    expect(pageviewSource({ utm: { source: 'newsletter' } }).source).toBe('newsletter');
  });

  it('folds the spellings of one assistant together, whatever the case', () => {
    expect(sourceLabel('ChatGPT.com')).toBe('ChatGPT');
    expect(sourceLabel('chat.openai.com')).toBe('ChatGPT');
    expect(sourceLabel('perplexity')).toBe('Perplexity');
    expect(sourceLabel('perplexity.ai')).toBe('Perplexity');
    // Kagi the search engine is a referrer like any other; only its assistant host is one.
    expect(isAssistantSource(sourceLabel('kagi.com'))).toBe(false);
    expect(isAssistantSource(sourceLabel('assistant.kagi.com'))).toBe(true);
  });
});

describe('createSourceTally', () => {
  it('counts a row with both a tag and a referrer once, under the tag', () => {
    const tally = createSourceTally();
    tally.add({ referrer: 'google.com', utm: { source: 'chatgpt.com' } }, 'a');
    const rows = tally.rows();
    expect(rows).toEqual([{ source: 'ChatGPT', pageviews: 1, visitors: 1, assistant: true }]);
    expect(rows.reduce((s, r) => s + r.pageviews, 0)).toBe(1);
  });

  it('counts visitors apart from pageviews, and orders by visitors', () => {
    const tally = createSourceTally();
    // One reader turning 5 tagged pages is one visitor, not five arrivals.
    for (let i = 0; i < 5; i++) tally.add({ referrer: 'direct', utm: { source: 'chatgpt.com' } }, 'reader-1');
    tally.add({ referrer: 'google.com' }, 'reader-2');
    tally.add({ referrer: 'google.com' }, 'reader-3');
    tally.add({ referrer: 'perplexity.ai' }, 'reader-4');
    tally.add({ referrer: 'direct' }, 'reader-5');
    expect(tally.rows().map((r) => [r.source, r.visitors, r.pageviews])).toEqual([
      ['google.com', 2, 2],
      ['ChatGPT', 1, 5],
      ['Perplexity', 1, 1],
      ['direct', 1, 1],
    ]);
    const assistants = tally.assistants();
    expect(assistants.visitors).toBe(2);
    expect(assistants.pageviews).toBe(6);
    expect(assistants.bySource.map((r) => r.source)).toEqual(['ChatGPT', 'Perplexity']);
  });

  it('does not count one visitor twice across two assistants in the group total', () => {
    const tally = createSourceTally();
    tally.add({ utm: { source: 'chatgpt.com' } }, 'same');
    tally.add({ referrer: 'claude.ai' }, 'same');
    expect(tally.assistants().visitors).toBe(1);
  });

  it('counts assistant visitors per day, once for each day they came', () => {
    const tally = createSourceTally();
    // Day one: a reader turns three tagged pages. Day two: the same reader returns, and another arrives.
    for (let i = 0; i < 3; i++) tally.add({ utm: { source: 'chatgpt.com' } }, 'reader-1', '2026-11-11');
    tally.add({ utm: { source: 'chatgpt.com' } }, 'reader-1', '2026-11-12');
    tally.add({ referrer: 'claude.ai' }, 'reader-2', '2026-11-12');
    tally.add({ referrer: 'google.com' }, 'reader-3', '2026-11-12');
    const a = tally.assistants();
    expect(a.byDay).toEqual([{ date: '2026-11-11', visitors: 1 }, { date: '2026-11-12', visitors: 2 }]);
    expect(a.visitors).toBe(2);
    expect(a.pageviews).toBe(5);
  });
});

// The dashboard groups in MongoDB, so the same rule exists as an expression.
// It cannot run here; what can be pinned is that it is built from the same table.
describe('the MongoDB forms', () => {
  it('builds one $switch branch per assistant, from the shared table', () => {
    const branches = (sourceExpr() as { $let: { in: { $switch: { branches: { then: string; case: { $in: [unknown, string[]] } }[] } } } }).$let.in.$switch.branches;
    expect(branches.map((b) => b.then)).toEqual(ASSISTANT_SOURCES.map((a) => a.label));
    expect(branches[0].case.$in[1]).toEqual(ASSISTANT_SOURCES[0].keys);
  });

  it('filters an assistant by every spelling, tag or referrer', () => {
    const f = sourceFilter('ChatGPT') as { $or: [{ 'utm.source': { $in: RegExp[] } }, { referrer: { $in: RegExp[] } }] };
    const tags = f.$or[0]['utm.source'].$in;
    expect(tags.some((re) => re.test('chatgpt.com'))).toBe(true);
    expect(tags.some((re) => re.test('ChatGPT.com'))).toBe(true);
    expect(tags.some((re) => re.test('notchatgpt.com'))).toBe(false);
    expect(tags.some((re) => re.test('chatgptXcom'))).toBe(false);
    // The referrer arm applies only to rows with no tag, as pageviewSource does.
    expect(f.$or[1]).toMatchObject({ 'utm.source': { $in: [null, ''] } });
  });

  it('filters any other source by its exact name, and direct by having neither', () => {
    expect(sourceFilter('google.com')).toEqual({
      $or: [{ 'utm.source': { $in: ['google.com'] } }, { 'utm.source': { $in: [null, ''] }, referrer: { $in: ['google.com'] } }],
    });
    expect(sourceFilter('direct')).toEqual({
      $and: [{ 'utm.source': { $in: [null, ''] } }, { referrer: { $in: [null, '', 'direct'] } }],
    });
  });
});
