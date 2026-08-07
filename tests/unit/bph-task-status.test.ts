/**
 * Task board vocabulary and ordering.
 *
 * `positionBetween` is the whole reason a card move is one row written rather
 * than a renumber of the column, so its edge cases are worth pinning: an empty
 * column, an insert at either end, and repeated inserts in the same gap.
 */
import { describe, it, expect } from 'vitest';
import {
  BOARD_COLUMNS,
  TASK_STATUSES,
  isTaskStatus,
  isTaskList,
  statusLabel,
  positionBetween,
} from '@/lib/bph-task-status';

describe('statuses', () => {
  it('validates known statuses and rejects anything else', () => {
    expect(isTaskStatus('planned')).toBe(true);
    expect(isTaskStatus('shipped')).toBe(true);
    expect(isTaskStatus('nonsense')).toBe(false);
    expect(isTaskStatus(null)).toBe(false);
    expect(isTaskStatus(undefined)).toBe(false);
  });

  it('validates lists', () => {
    expect(isTaskList('librarian')).toBe(true);
    expect(isTaskList('dev')).toBe(true);
    expect(isTaskList('everyone')).toBe(false);
  });

  it('labels every status it accepts', () => {
    for (const s of TASK_STATUSES) {
      expect(statusLabel(s)).toBeTruthy();
      expect(statusLabel(s)).not.toBe(s === 'in_progress' ? 'in_progress' : '');
    }
  });

  it('falls back to the raw value for an unknown status', () => {
    expect(statusLabel('weird')).toBe('weird');
  });

  it('shows declined off the board, so it is not a parking column', () => {
    expect(BOARD_COLUMNS).not.toContain('declined');
    expect(TASK_STATUSES).toContain('declined');
  });
});

describe('positionBetween', () => {
  it('gives a first card a positive position', () => {
    expect(positionBetween(null, null)).toBe(1000);
  });

  it('inserts before the first card without renumbering', () => {
    expect(positionBetween(null, 1000)).toBe(0);
    expect(positionBetween(null, 0)).toBe(-1000);
  });

  it('appends after the last card', () => {
    expect(positionBetween(1000, null)).toBe(2000);
  });

  it('takes the midpoint between two neighbours', () => {
    expect(positionBetween(1000, 2000)).toBe(1500);
    expect(positionBetween(0, 1)).toBe(0.5);
  });

  it('keeps ordering strict through repeated inserts in the same gap', () => {
    let lo = 1000;
    const hi = 2000;
    for (let i = 0; i < 20; i++) {
      const mid = positionBetween(lo, hi);
      expect(mid).toBeGreaterThan(lo);
      expect(mid).toBeLessThan(hi);
      lo = mid;
    }
  });
});
