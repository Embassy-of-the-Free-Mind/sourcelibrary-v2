/**
 * Re-enrollment eligibility for loop-quarantined books (#3750).
 *
 * The rule that must never regress: a book with hidden_reason set — a takedown
 * or copyright hold — must NEVER be re-enrolled by a bulk sweep (repo lesson
 * #3099). The predicate is pure so this is testable without a database.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateReenrollment,
  QUARANTINE_STATUS,
  REENTRY_STATUS,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/reenroll-eligibility.mjs';

function quarantinedBook(overrides: Record<string, unknown> = {}) {
  return {
    id: 'abc123',
    pipeline_auto: { status: QUARANTINE_STATUS },
    pages_ocr: 100,
    pages_translated: 40,
    visible: true,
    ...overrides,
  };
}

describe('evaluateReenrollment', () => {
  it('re-enrolls a clean quarantined book with untranslated OCR pages', () => {
    expect(evaluateReenrollment(quarantinedBook())).toEqual({ eligible: true, reason: 'ok' });
  });

  it('constants match the orchestrator contract', () => {
    // Phase 4 reads fresh candidates from ocr_complete; the quarantine status
    // is the one the orchestrator never picks up.
    expect(QUARANTINE_STATUS).toBe('loop_quarantine_hold');
    expect(REENTRY_STATUS).toBe('ocr_complete');
  });

  describe('hidden_reason exclusion (#3099 — takedowns never re-enter)', () => {
    it('excludes a takedown string', () => {
      expect(evaluateReenrollment(quarantinedBook({ hidden_reason: 'kloss-takedown-2026-06' })))
        .toEqual({ eligible: false, reason: 'hidden_reason' });
    });

    it('excludes visible:false + hidden_reason', () => {
      expect(evaluateReenrollment(quarantinedBook({ visible: false, hidden_reason: 'copyright hold' })))
        .toEqual({ eligible: false, reason: 'hidden_reason' });
    });

    it('excludes a non-string truthy hidden_reason (unknown shapes fail closed)', () => {
      expect(evaluateReenrollment(quarantinedBook({ hidden_reason: { code: 'takedown' } })).eligible).toBe(false);
      expect(evaluateReenrollment(quarantinedBook({ hidden_reason: true })).eligible).toBe(false);
    });

    it('a whitespace-only hidden_reason blocks (fail closed on weird data)', () => {
      expect(evaluateReenrollment(quarantinedBook({ hidden_reason: '  ' })).eligible).toBe(false);
    });

    it('empty string / null / absent hidden_reason does not block', () => {
      expect(evaluateReenrollment(quarantinedBook({ hidden_reason: '' })).eligible).toBe(true);
      expect(evaluateReenrollment(quarantinedBook({ hidden_reason: null })).eligible).toBe(true);
      expect(evaluateReenrollment(quarantinedBook()).eligible).toBe(true);
    });

    it('hidden_reason wins over every other outcome (checked first)', () => {
      // Even a book that would be excluded for another reason reports the
      // takedown, so a log reader sees the strongest exclusion.
      expect(evaluateReenrollment(quarantinedBook({ hidden_reason: 'takedown', pages_ocr: 0 })))
        .toEqual({ eligible: false, reason: 'hidden_reason' });
    });

    it('visible:false alone (hidden import, no takedown) is still eligible', () => {
      expect(evaluateReenrollment(quarantinedBook({ visible: false })).eligible).toBe(true);
    });
  });

  describe('status guard', () => {
    it('excludes books not at the quarantine status (race protection)', () => {
      for (const status of [REENTRY_STATUS, 'complete', 'translate_submitted', undefined]) {
        expect(evaluateReenrollment(quarantinedBook({ pipeline_auto: { status } })))
          .toEqual({ eligible: false, reason: 'wrong_status' });
      }
      expect(evaluateReenrollment(quarantinedBook({ pipeline_auto: undefined })).reason).toBe('wrong_status');
    });
  });

  describe('counter checks', () => {
    it('excludes books without OCR (ocr_complete would be a lie)', () => {
      expect(evaluateReenrollment(quarantinedBook({ pages_ocr: 0 }))).toEqual({ eligible: false, reason: 'no_ocr' });
      expect(evaluateReenrollment(quarantinedBook({ pages_ocr: undefined })).reason).toBe('no_ocr');
    });

    it('excludes fully-translated books (nothing for Phase 4; clear may not have happened)', () => {
      expect(evaluateReenrollment(quarantinedBook({ pages_translated: 100 })))
        .toEqual({ eligible: false, reason: 'fully_translated' });
      expect(evaluateReenrollment(quarantinedBook({ pages_translated: 150 })).reason).toBe('fully_translated');
    });

    it('treats missing pages_translated as 0 (fully untranslated is the common cleared case)', () => {
      expect(evaluateReenrollment(quarantinedBook({ pages_translated: undefined })).eligible).toBe(true);
    });
  });

  it('handles a missing book', () => {
    expect(evaluateReenrollment(null)).toEqual({ eligible: false, reason: 'missing_book' });
  });
});
