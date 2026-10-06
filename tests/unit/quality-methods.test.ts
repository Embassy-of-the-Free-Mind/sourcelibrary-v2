import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import methods from '../../src/data/quality-methods.json';

// The register behind /quality/methods. The page trusts its shape; this keeps the shape honest:
// every rule and figure has a source that exists, every instrument names what it cannot see and an issue.
const ROOT = join(__dirname, '../..');
const KINDS = ['accuracy', 'judged', 'screen', 'by-eye'];
const sourceExists = (s: string) => s.startsWith('http') || s.startsWith('/') || existsSync(join(ROOT, s));

describe('quality-methods register', () => {
  it('has an as-of date', () => {
    expect(methods.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('every rule has a source that exists', () => {
    for (const r of methods.rules) {
      expect(r.rule.length, r.id).toBeGreaterThan(20);
      expect(sourceExists(r.source), `${r.id}: ${r.source}`).toBe(true);
    }
  });

  it('every instrument is complete and its latest result is sourced', () => {
    const ids = new Set<string>();
    for (const m of methods.instruments) {
      expect(ids.has(m.id), `duplicate id ${m.id}`).toBe(false);
      ids.add(m.id);
      expect(KINDS, m.id).toContain(m.kind);
      expect(m.question.endsWith('?'), m.id).toBe(true);
      expect(m.blind_to.length, `${m.id}: say what it cannot see`).toBeGreaterThan(5);
      expect(m.on_finding.length, `${m.id}: say what happens to a finding`).toBeGreaterThan(5);
      expect(Number.isInteger(m.issue), m.id).toBe(true);
      if (m.latest) {
        expect(m.latest.date, m.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(sourceExists(m.latest.source), `${m.id}: ${m.latest.source}`).toBe(true);
      }
    }
  });

  it('the improvement board names a sourced window and an owner for every item', () => {
    expect(methods.board.window.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sourceExists(methods.board.window.source)).toBe(true);
    for (const b of methods.board.items) {
      expect(Number.isInteger(b.issue), b.class).toBe(true);
      expect(['open', 'in progress', 'fixed — rate fell', 'fixed — not yet re-measured'], b.class).toContain(b.status);
      expect(b.next.length, b.class).toBeGreaterThan(5);
    }
  });

  it('every gap names its issue', () => {
    for (const g of methods.gaps) expect(Number.isInteger(g.issue)).toBe(true);
  });
});
