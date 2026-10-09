/**
 * PRIOR ART: scripts/eval/methods/*.md is the methods registry (#6174) — the source of truth for what each instrument
 * is. The app cannot read those files at request time, so this is the small part a reader-facing surface needs: a
 * plain name per method and, for a detector, the issue that defines it. tests/unit/check-methods.test.ts fails when a
 * registered method has no entry here or a detector's issue is not in its registry header.
 */
export interface CheckMethodInfo {
  /** What the method is, in a reader's words. */
  label: string;
  /** Detectors only: the GitHub issue that defines what the detector looks for. */
  issue?: number;
}

export const CHECK_METHODS: Record<string, CheckMethodInfo> = {
  'shelf-overview': { label: 'Shelf overview: four pages spread through the book, read against the page images' },
  'curation-check': { label: 'Curation check: pages read before the book was put on a shelf' },
  'fortnightly-spot-check': { label: 'Random spot check: three consecutive pages read against the page images' },
  'monthly-corpus-audit': { label: 'Monthly audit of a random sample of the whole library' },
  'hide-broken-text': { label: 'Review that led to the book being hidden for broken text' },
  'reasoning-leak': { label: 'Automated check for the model’s own reasoning stored as the translation', issue: 6117 },
  'refusal-empty': { label: 'Automated check for a transcription that is a refusal or is empty', issue: 4686 },
};

const REPO = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2';
export const methodDocUrl = (methodId: string) => `${REPO}/blob/main/scripts/eval/methods/${methodId}.md`;
export const issueUrl = (n: number) => `${REPO}/issues/${n}`;
/** Evidence in the private ops repo (`ops:` prefix) has no public URL. */
export const evidenceUrl = (path: string) =>
  path.startsWith('ops:') ? null : `${REPO}/blob/main/${path.split('/').map(encodeURIComponent).join('/')}`;
