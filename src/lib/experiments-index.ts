/**
 * The experiment index (#5939): scripts/eval/experiments/index.json, generated on main
 * by scripts/eval/build-experiments.mjs from each write-up's header. Public pages read
 * experiments through this module instead of wiring file names and outcomes by hand,
 * so a new write-up reaches them and a superseded one leaves them with no page edit.
 *
 * PRIOR ART: src/lib/quality-center.ts parsed the write-ups' markdown for /quality
 * (question, an Answer/Verdict sentence when one could be found). The header now
 * states the verdict and status outright; that parser is replaced by this reader.
 */
import data from '../../scripts/eval/experiments/index.json';

export type ExperimentStatus = 'adopted' | 'rejected' | 'undecided' | 'superseded' | 'informational';

export type ExperimentRecord = {
  file: string;
  date: string;
  question: string;
  href: string;
  stage: 'ocr' | 'translation' | 'metadata' | 'image' | 'pipeline' | null;
  measure: string[];
  languages: string[];
  scripts: string[];
  canons: string[];
  n_books: number | null;
  n_pages: number | null;
  verdict: string | null;
  /** null when the write-up has no header yet (the weekly garden lists those). */
  status: ExperimentStatus | null;
  decision: string | null;
  superseded_by: string | null;
  issues: number[];
};

/** Every dated write-up, newest first, superseded ones included (the log keeps them). */
export const EXPERIMENTS: ExperimentRecord[] = (data as unknown as { entries: ExperimentRecord[] }).entries;

/** What a public list shows: superseded write-ups drop off; they stay in the log. */
export function publicExperiments(entries: ExperimentRecord[] = EXPERIMENTS): ExperimentRecord[] {
  return entries.filter((e) => e.status !== 'superseded');
}

/**
 * One write-up by file name. Throws when the file is not in the index, so a page that
 * cites a renamed or missing write-up fails its build instead of rendering a dead link.
 */
export function experiment(file: string, entries: ExperimentRecord[] = EXPERIMENTS): ExperimentRecord {
  const e = entries.find((x) => x.file === file);
  if (!e) throw new Error(`experiment ${file} is not in scripts/eval/experiments/index.json`);
  return e;
}
