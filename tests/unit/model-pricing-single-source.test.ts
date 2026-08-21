import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * The same Gemini price constants were copied into ten files and drifted:
 * `gemini-3.1-flash-lite` was 0.075/0.30 in the eval lane and 0.25/1.50 in the
 * batch/usage lane — 3.3x and 5x, for one model. Nothing surfaced it, because a
 * cost number always looks plausible.
 *
 * This is an ABSENCE invariant, which is the one case where matching on source
 * text is legitimate (see CLAUDE.md, "A test that greps source is not a guard"):
 * the failure mode IS re-adding a literal price table, and deleting this test's
 * subject is exactly what it must catch. It does not claim any price is
 * correct — only that new copies are not appearing.
 */
const ROOT = path.resolve(__dirname, '../..');

/**
 * Files that still hold their own table, with the reason.
 *
 * These are the PRODUCTION writers of `gemini_usage.cost_usd`. Migrating them
 * changes what the cost dashboard reports, so it is deliberate work under
 * #3576, not a drive-by refactor. They are listed individually so the set
 * cannot grow silently — a new entry here is a decision, not an accident.
 *
 * They do not agree with each other today, which is the whole point:
 *   0.075 / 0.30  enrich-worker (OCR),  src/lib/ai.ts
 *   0.25  / 1.50  translate-worker,     src/lib/gemini-logger.ts,
 *                 batch-collector, supabase-usage-logger,
 *                 reconcile-batch-usage, backfill-batch-costs
 * So an OCR row and a translation row for the SAME model are costed 3.3x/5x
 * apart, and the dashboard total is a mixture of two rates.
 */
const ALLOWED = new Set([
  // The single source of truth.
  'scripts/lib/model-pricing.mjs',
  'scripts/workers/batch-collector.mjs',
  'scripts/workers/lib/supabase-usage-logger.mjs',
  'scripts/maintenance/reconcile-batch-usage.mjs',
  'scripts/maintenance/backfill-batch-costs.mjs',
  'scripts/workers/enrich-worker.mjs',
  'scripts/workers/translate-worker.mjs',
  'src/lib/ai.ts',
  'src/lib/gemini-logger.ts',
  'scripts/tmp-batch-modernize.mjs', // scratch script, untracked-by-convention
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.claude') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(mjs|ts|js)$/.test(e.name)) out.push(full);
  }
  return out;
}

describe('model pricing has one source of truth', () => {
  it('no new file hard-codes a Gemini price table', () => {
    // A price literal for a named gemini model, e.g. 'gemini-x': { input: 0.5
    const PRICE_LITERAL = /['"]gemini-[\w.\-]+['"]\s*:\s*\{\s*input\s*:/;
    const offenders: string[] = [];
    for (const dir of ['scripts', 'src']) {
      const base = path.join(ROOT, dir);
      if (!fs.existsSync(base)) continue;
      for (const f of walk(base)) {
        const rel = path.relative(ROOT, f);
        if (ALLOWED.has(rel)) continue;
        if (PRICE_LITERAL.test(fs.readFileSync(f, 'utf8'))) offenders.push(rel);
      }
    }
    expect(offenders, `Import from scripts/lib/model-pricing.mjs instead of re-declaring prices:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('records the disputed rate rather than quietly dropping it', async () => {
    const m = await import('../../scripts/lib/model-pricing.mjs');
    expect(m.MODEL_PRICING['gemini-3.1-flash-lite']).toEqual({ input: 0.075, output: 0.30 });
    expect(m.DISPUTED_LEGACY_PRICING['gemini-3.1-flash-lite']).toEqual({ input: 0.25, output: 1.50 });
  });

  it('costOf computes from the shared table', async () => {
    const m = await import('../../scripts/lib/model-pricing.mjs');
    expect(m.costOf('gemini-3.1-flash-lite', 1e6, 0)).toBeCloseTo(0.075, 6);
    expect(m.costOf('gemini-3.1-flash-lite', 0, 1e6)).toBeCloseTo(0.30, 6);
    // Unknown model falls back rather than returning 0 — a silent zero is how
    // a metering gap reads as "free" (#3452).
    expect(m.costOf('not-a-model', 1e6, 0)).toBeGreaterThan(0);
  });
});
