import digest from '@/data/pareto-sample-audit.json';
import canonGapStatus from '../../scripts/catalog-coverage/results/canon-gap-status-2026-10.json';

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

// A static import, not a readdir under process.cwd(): the file tracer cannot narrow a
// cwd-relative path, so it shipped the whole repository with /quality — 500 MB on next 16.4,
// past Vercel's 250 MB function limit (#7318). When a new month's file lands, move this
// import to it; tests/unit/quality-center.test.ts fails until it does.
export const CANON_STATUS_FILE = 'scripts/catalog-coverage/results/canon-gap-status-2026-10.json';

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

export function latestCanonStatus(): CanonStatus {
  const j = canonGapStatus as unknown as { generated_at: string; traditions: Tradition[] };
  return { file: CANON_STATUS_FILE, generated_at: j.generated_at, traditions: j.traditions };
}

/**
 * Text that people typed, not a model's reading of the scan: the e-text editions aligned to our
 * scans (Esukhia's Derge, CBETA, Sefaria) and hand corrections. Everything else is an OCR engine.
 */
export const TYPED_SOURCE = /^(esukhia|cbeta|sefaria|manual)/i;

export function typedPages(t: Tradition): number {
  return t.ocr_engines.filter(([e]) => TYPED_SOURCE.test(e)).reduce((s, [, n]) => s + n, 0);
}

/* ── The sample check behind the cost/quality charts (#6304) ── */

// src/data/pareto-sample-audit.json is written by scripts/eval/build-pareto-sample-digest.mjs from
// scripts/eval/results/pareto-sample-audit-6304/ and the write-up's verdict table. It is a src/data
// import, not a read of the results dir, because .vercelignore leaves scripts/eval/results out of a
// Vercel build.

/** n of a whole, as the page states it. */
export type Of = { n: number; of: number };
export type DropReason = 'judges' | 'by-eye' | 'language' | 'cer';
export type SampleAudit = Omit<typeof digest, 'dropped'> & {
  dropped: Omit<typeof digest.dropped, 'reasons'> & { reasons: { family: 'translation' | 'ocr'; reason: DropReason; n: number }[] };
};

export function sampleAudit(): SampleAudit {
  return digest as SampleAudit;
}
