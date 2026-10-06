import fs from 'node:fs';
import path from 'node:path';

import { publicExperiments, EXPERIMENTS, type ExperimentRecord, type ExperimentStatus } from '@/lib/experiments-index';

/**
 * Build-time readers for /quality (#5918). Server-only: they read committed files from
 * the repository at render time, and /quality is prerendered at build, so the page
 * reflects main as of its last deploy with no hand edits.
 *
 * PRIOR ART: the experiment list was parsed here from each write-up's markdown (an
 * Answer/Verdict sentence when one could be found). Since #5939 every write-up carries
 * a header with its verdict and status, and the list comes from the generated index
 * (src/lib/experiments-index.ts) — superseded write-ups drop off, the log keeps them.
 */

export type Experiment = {
  date: string;
  file: string;
  question: string;
  /** The write-up's one-line verdict, from its header. */
  headline: string | null;
  status: ExperimentStatus | null;
  issues: number[];
  href: string;
};

/** Every write-up a public list should show, newest first: superseded ones are left out. */
export function listExperiments(entries: ExperimentRecord[] = EXPERIMENTS): Experiment[] {
  return publicExperiments(entries).map((e) => ({
    date: e.date,
    file: e.file,
    question: e.question,
    headline: e.verdict,
    status: e.status,
    issues: e.issues,
    href: e.href,
  }));
}

/* ── Canon status: the newest scripts/catalog-coverage/results/canon-gap-status-YYYY-MM.json ── */

const CANON_DIR = path.join(process.cwd(), 'scripts', 'catalog-coverage', 'results');
const CANON_FILE = /^canon-gap-status-(\d{4}-\d{2})\.json$/;

export type Tradition = {
  id: string;
  name: string;
  books: number;
  readable_books: number;
  pages_scanned: number;
  pages_transcribed: number;
  pages_translated: number;
  ocr_engines: [string, number][];
  translation_models: [string, number][];
};

export type CanonStatus = { file: string; generated_at: string; traditions: Tradition[] };

export function latestCanonStatus(dir = CANON_DIR): CanonStatus {
  const file = fs.readdirSync(dir).filter(f => CANON_FILE.test(f)).sort().pop();
  if (!file) throw new Error(`no canon-gap-status-*.json in ${dir}`);
  const j = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  return { file: `scripts/catalog-coverage/results/${file}`, generated_at: j.generated_at, traditions: j.traditions };
}

/**
 * Text that people typed, not a model's reading of the scan: the e-text editions aligned to our
 * scans (Esukhia's Derge, CBETA, Sefaria) and hand corrections. Everything else is an OCR engine.
 */
export const TYPED_SOURCE = /^(esukhia|cbeta|sefaria|manual)/i;

export function typedPages(t: Tradition): number {
  return t.ocr_engines.filter(([e]) => TYPED_SOURCE.test(e)).reduce((s, [, n]) => s + n, 0);
}
