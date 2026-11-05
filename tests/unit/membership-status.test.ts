import { describe, expect, it } from 'vitest';
import {
  hasMemberBenefits,
  membershipState,
  PAID_GRACE_MS,
  sessionHasMemberBenefits,
  sessionIsPaidMember,
} from '@/lib/membership-status';

const NOW = Date.parse('2026-11-05T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(ms);

describe('membershipState (#8227)', () => {
  it('no record, or an empty one, is none', () => {
    expect(membershipState(null, NOW).kind).toBe('none');
    expect(membershipState({ stripeCustomerId: 'cus_x' } as never, NOW).kind).toBe('none');
  });

  it('a free join is joined, and carries no benefits', () => {
    const { kind } = membershipState({ joined: true }, NOW);
    expect(kind).toBe('joined');
    expect(hasMemberBenefits(kind)).toBe(false);
  });

  it('paid lasts through the retry grace, then lapses', () => {
    const justLapsed = { active: true, expiresAt: at(NOW - DAY) };
    const state = membershipState(justLapsed, NOW);
    expect(state.kind).toBe('paid');
    expect(state.until).toBe(NOW - DAY + PAID_GRACE_MS);

    const longLapsed = { active: true, expiresAt: at(NOW - PAID_GRACE_MS - 1) };
    expect(membershipState(longLapsed, NOW).kind).toBe('none');
  });

  it('a lapsed payer who also joined falls back to joined', () => {
    const m = { active: true, joined: true, expiresAt: at(NOW - 30 * DAY) };
    expect(membershipState(m, NOW).kind).toBe('joined');
  });

  it('reads expiry stored as a string', () => {
    const m = { active: true, expiresAt: at(NOW - 30 * DAY).toISOString() };
    expect(membershipState(m, NOW).kind).toBe('none');
  });

  it('a student seat ends exactly on its date, with no grace', () => {
    expect(membershipState({ student: { expiresAt: at(NOW + 1) } }, NOW)).toEqual({
      kind: 'student',
      until: NOW + 1,
    });
    expect(membershipState({ student: { expiresAt: at(NOW) } }, NOW).kind).toBe('none');
  });

  it('a seat with no end date is not a seat, because nothing would ever end it', () => {
    expect(membershipState({ student: {} }, NOW).kind).toBe('none');
    expect(membershipState({ student: { expiresAt: 'not a date' } }, NOW).kind).toBe('none');
  });

  it('a lapsed subscription falls through to a live seat', () => {
    const m = { active: true, expiresAt: at(NOW - 30 * DAY), student: { expiresAt: at(NOW + DAY) } };
    expect(membershipState(m, NOW).kind).toBe('student');
  });
});

describe('what the session value unlocks', () => {
  it.each([
    ['paid', true, true],
    ['student', true, false],
    ['joined', false, false],
    [null, false, false],
  ])('%s: benefits %s, dedication %s', (membership, benefits, paid) => {
    expect(sessionHasMemberBenefits({ membership })).toBe(benefits);
    expect(sessionIsPaidMember({ membership })).toBe(paid);
  });

  it('no user at all unlocks nothing', () => {
    expect(sessionHasMemberBenefits(undefined)).toBe(false);
    expect(sessionIsPaidMember(null)).toBe(false);
  });
});
