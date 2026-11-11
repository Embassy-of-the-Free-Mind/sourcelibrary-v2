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
  'served-audit': { label: 'Library-wide audit: one random page read against its page image' },
  'monthly-corpus-audit': { label: 'Monthly audit of a random sample of the whole library' },
  'retranslation-gate': { label: 'Re-translation check: three consecutive pages read against the page images, new English beside the old' },
  'hide-broken-text': { label: 'Review that led to the book being hidden for broken text' },
  'lane-spot-check': { label: 'Lane spot check: a random page from a translation batch, read by an AI reviewer against the page image' },
  'lane-paired-retranslation-check': { label: 'Re-translation lane check: a random page from a re-translation batch, the new and the old English each read by an AI reviewer against the page image' },
  'stub-books-8181-by-eye': { label: 'Wave check: one random page from a batch of newly read pages, read by an AI reviewer against the page image' },
  'kangyur-finish-8482-by-eye': { label: 'Spot check: one page of new English, read by an AI reviewer against the page image and the Tibetan' },
  'judged-pages': { label: 'Judged pages: an AI reviewer read pages of the transcription against their images, for a quality study or a routing test' },
  'ocr-convergence': { label: 'OCR check: a second machine reading compared with the stored one; where they differ, an AI reader checked the page image' },
  'plate-reread-check': { label: 'Plate re-read check: an AI reviewer read a new transcription of a map or plate page against the page image' },
  'euro-gpu-agy-cell-6871': { label: 'Routing test: one newly transcribed page, read by an AI reviewer against the page image' },
  'gpu-print-6871': { label: 'Lane check: one page the GPU print lane transcribed, read by an AI reviewer against the page image' },
  'leak-off-leaf-5309': { label: 'Wrong-page check: a page whose text belonged to a neighbouring page, read by an AI reviewer against the page image before and after it was transcribed again' },
  'leak-repair-5026': { label: 'Repeated-English check: two neighbouring pages whose English repeats the same passage, read by an AI reviewer against both page images, before and after re-translation' },
  'leak-strip-5026': { label: 'Repeated-English strip check: a proposed cut of the passage a page’s English shares with its neighbour, read by an AI reviewer against both page images before any write' },
  'paired-fifths-check': { label: 'Book check: two facing pages from each fifth of the book and the break between them, read by an AI reviewer against the page images' },
  'volunteer-paired-check': { label: 'Volunteer check: two facing pages from each fifth of the book, read by a volunteer’s AI assistant against the page images' },
  'reasoning-leak': { label: 'Automated check for the model’s own reasoning stored as the translation', issue: 6117 },
  'refusal-empty': { label: 'Automated check for a transcription that is a refusal or is empty', issue: 4686 },
};

const REPO = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2';
export const methodDocUrl = (methodId: string) => `${REPO}/blob/main/scripts/eval/methods/${methodId}.md`;
export const issueUrl = (n: number) => `${REPO}/issues/${n}`;
/** Evidence in the private ops repo (`ops:`), a lane's folder on a box (`box:`) or a database table (`supabase:`) has no public URL. */
export const evidenceUrl = (path: string) =>
  path.startsWith('ops:') || path.startsWith('box:') || path.startsWith('supabase:') ? null : `${REPO}/blob/main/${path.split('/').map(encodeURIComponent).join('/')}`;
