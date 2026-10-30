import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs script helper
import { entryFromCredit, sameEntry, ledgerOp, ledgerLeads, heldEvent, insertHeld, parseAnswer } from '../../scripts/ft-search/ledger-lib.mjs';

const credit = { work_title: 'The Divine Pymander', translators: ['John Everard'], scope: 'complete', url: 'https://example.org/everard', year: 1650, publisher: 'Brewster' };
const entry = entryFromCredit(credit, 'b1:claude_subagent_verify:2026-10-29');

describe('works ledger entry from a fresh-search credit', () => {
  it('has the shape of the existing entries, graded moderate and unverified', () => {
    expect(entry).toMatchObject({
      kind: 'english_translation', year: '1650', translator: 'John Everard', title: 'The Divine Pymander', publisher: 'Brewster',
      completeness: 'complete', citation_url: 'https://example.org/everard', evidence_grade: 'moderate', verified: false, source: 'ft_fresh_search',
      source_attempt_ids: ['b1:claude_subagent_verify:2026-10-29'],
    });
  });

  it('dedupes on citation_url, or on title and year', () => {
    expect(sameEntry(entry, { citation_url: 'https://example.org/everard', title: 'x' })).toBe(true);
    expect(sameEntry(entry, { citation_url: null, title: 'the DIVINE Pymander!', year: '1650' })).toBe(true);
    expect(sameEntry(entry, { citation_url: null, title: 'The Divine Pymander', year: '1884' })).toBe(false);
  });

  it('appends to an existing card without touching its status or entries', () => {
    const doc = { _id: 'W1', status: 'no_prior_known', entries: [{ title: 'Other', year: '1700', citation_url: 'https://example.org/o' }] };
    const { action, op } = ledgerOp('W1', doc, entry);
    expect(action).toBe('append');
    expect(op.updateOne.update).toEqual({ $push: { entries: expect.objectContaining({ source: 'ft_fresh_search' }) } });
    expect(JSON.stringify(op)).not.toContain('$set');
    expect(JSON.stringify(op)).not.toContain('$pull');
  });

  it('skips a duplicate and creates a missing card as under_review (renders nothing)', () => {
    expect(ledgerOp('W1', { _id: 'W1', entries: [{ ...entry }] }, entry)).toEqual({ action: 'duplicate', op: null });
    const { action, op } = ledgerOp('W2', null, entry);
    expect(action).toBe('create');
    expect(op.updateOne.upsert).toBe(true);
    expect(op.updateOne.update.$setOnInsert.status).toBe('under_review');
  });
});

describe('ledger leads for the search prompt', () => {
  it('labels each lead by grade and verified flag, verified first, and calls them leads', () => {
    const text = ledgerLeads({ entries: [
      { title: 'Weak one', year: '1900', evidence_grade: 'weak', verified: false },
      { title: 'Verified one', year: '1800', evidence_grade: 'strong', verified: true, citation_url: 'https://example.org/v' },
    ] });
    expect(text).toContain('LEADS to check, not answers');
    expect(text.indexOf('Verified one')).toBeLessThan(text.indexOf('Weak one'));
    expect(text).toContain('works ledger: verified, evidence strong');
    expect(text).toContain('works ledger: unverified, evidence weak');
  });
  it('returns null when the card holds nothing usable', () => {
    expect(ledgerLeads(null)).toBeNull();
    expect(ledgerLeads({ entries: [{ kind: 'related', title: 'x' }, { kind: 'english_translation' }] })).toBeNull();
  });
});

describe('held changes and answer parsing', () => {
  it('builds a book_events row of type ft_change_held_for_review', () => {
    const e = heldEvent({ book_id: 'b', change: 'retract_credit', reason: 'r', by: 'x' });
    expect(e).toMatchObject({ book_id: 'b', type: 'ft_change_held_for_review', detail: { change: 'retract_credit', reason: 'r' } });
  });
  it('does not hold the same change twice for a book while one is open', async () => {
    const stored: any[] = [{ book_id: 'b1', type: 'ft_change_held_for_review', detail: { change: 'retract_credit' } }];
    const events = {
      find: () => ({ toArray: async () => stored.filter((e) => !e.resolved_at) }),
      insertMany: async (rows: any[]) => { stored.push(...rows); },
    };
    const n = await insertHeld(events, [
      heldEvent({ book_id: 'b1', change: 'retract_credit', reason: 'dup', by: 'x' }),
      heldEvent({ book_id: 'b1', change: 'remove_first_badge', reason: 'other change', by: 'x' }),
      heldEvent({ book_id: 'b2', change: 'retract_credit', reason: 'new book', by: 'x' }),
    ]);
    expect(n).toBe(2);
    expect(stored).toHaveLength(3);
  });
  it('takes the last claude -p output line holding a JSON verdict', () => {
    const out = [JSON.stringify({ result: '{"verdict":"unclear"}' }), JSON.stringify({ result: 'text {"verdict":"covers_part","note":"n"}' })].join('\n');
    expect(parseAnswer(out).verdict).toBe('covers_part');
    expect(parseAnswer('not json')).toBeNull();
  });
});
