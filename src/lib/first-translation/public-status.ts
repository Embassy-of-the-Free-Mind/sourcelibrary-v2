/**
 * The first-translation status a reader SEES on a book page, as data.
 *
 * PRIOR ART: src/components/book/FirstTranslationEvidence.tsx — it renders the badge as JSX and cannot be called from a tool; this runs the same gates and label functions as data.
 *
 * This module derives nothing new. It applies the same gates and calls the same
 * label functions the book page does, so an MCP agent and a reader get the same
 * answer. If the page's gate changes, change it there and here together.
 *
 * Sources, in the page's own precedence:
 *   1. the Translation Card for the work (`work_translation_history`, via cardLabel)
 *   2. otherwise the badge panel: `books.first_translation` verdict (or the legacy
 *      `translation_verification.disposition`) AND `books.is_first_translation`
 *      AND pages_translated > 0.
 * The claim register (`confirmed` vs `candidate`) is classifyFirstTranslationClaim.
 *
 * Deliberately NOT exposed: the verifier's free-text `reasoning` (AI prose), the
 * search queries, and the fresh-search notice.
 */
import type { Db } from 'mongodb';
import { getAttempts, strongestAttempt, type FirstTranslationAttempt } from './attempt-log';
import { classifyFirstTranslationClaim, type FirstTranslationClaim, type ScreenedBook } from './candidate';
import { cardLabel, loadCard, type TranslationCard } from './card';
import { isTranslationReadable, resolveFirstTranslation, translationCoverage } from './derive';
import { FIRST_FAMILY, VERDICT_TO_DISPOSITION } from './types';
import { displayablePriorPicks } from '../ft-prior-guard';
import { firstTranslationBadge, firstTranslationDescription, translationProgressNote } from '../first-translation-labels';
import { hasPublishablePriorTranslation } from '../prior-translation';
import { storedRung, translationCompleteness } from '../translation-completeness';
import type { PriorTranslationCredit } from '../types/book';

/** Fields the status reads. Pass this as the Mongo projection. */
export const PUBLIC_FT_PROJECTION = {
  _id: 0, id: 1, title: 1, author: 1, language: 1, original_language: 1, visible: 1, work_id: 1,
  is_first_translation: 1, first_translation: 1, translation_verification: 1, prior_translation: 1,
  source_language_screen: 1, translator_author_screen: 1,
  pages_translated: 1, pages_ocr: 1, pages_blank: 1, pages_count: 1, translation_state: 1,
} as const;

interface LegacyPrior {
  english_title?: string;
  translator?: string;
  pub_year?: string;
  completeness?: string;
  url?: string;
}

export interface NormalizedPrior {
  title?: string;
  translator?: string;
  pub_year?: string;
  completeness?: string;
  url?: string;
}

/**
 * The priors the badge panel lists. A study that quotes the work (#4639), or an
 * unanchored audit substitute (#4634), is not an earlier translation of it.
 * (Moved here from FirstTranslationEvidence.tsx so the page and MCP share it.)
 */
export function normalizePriors(
  book: { title?: string | null; author?: string | null },
  attempt: FirstTranslationAttempt | null,
  legacy?: LegacyPrior[],
): NormalizedPrior[] {
  if (attempt?.priors?.length) {
    return displayablePriorPicks(book, attempt.priors)
      .filter((p) => p.english_title)
      .map((p) => ({ title: p.english_title, translator: p.translator, pub_year: p.pub_year, completeness: p.completeness, url: p.source_url }));
  }
  return displayablePriorPicks(book, legacy)
    .filter((p) => p.english_title)
    .map((p) => ({ title: p.english_title, translator: p.translator, pub_year: p.pub_year, completeness: p.completeness, url: p.url }));
}

export interface PublicFirstTranslationStatus {
  /** The public badge: shown on the book page iff true. Same gate as the page. */
  badge_shown: boolean;
  /** The stored flag the site's "first translation" search/list filter matches on. */
  is_first_translation: boolean;
  /** The badge text a reader sees, or null when no first-translation badge shows. */
  badge_label: string | null;
  /** The graded verdict behind the badge (confirmed_first, first_from_source, not_first, ...), if any. */
  verdict: string | null;
  evidence_strength: string | null;
  /** confirmed | candidate | defeated | not_applicable | unknown (classifyFirstTranslationClaim). */
  claim: FirstTranslationClaim;
  claim_reason: string;
  /** The explanation the page shows under the badge. */
  note: string | null;
  /** The Translation Card sentence, when a reviewed card governs the page. */
  card: { status: string; sentence: string; register: string } | null;
  /** Earlier English translations the page lists or credits. May be incomplete. */
  prior_translations: Array<Record<string, unknown>>;
}

type Row = Record<string, any>;

export async function publicFirstTranslationStatus(db: Db, book: Row): Promise<PublicFirstTranslationStatus> {
  const ft = book.first_translation ?? null;
  const legacy = book.translation_verification ?? null;
  const verdict: string | null = ft?.verdict ?? resolveFirstTranslation(book as never)?.verdict ?? null;

  // Same gate as FirstTranslationEvidence: first-family verdict + stored flag + translated pages.
  const published = !!book.is_first_translation && (book.pages_translated ?? 0) > 0;
  const isFirst = !!verdict && FIRST_FAMILY.has(verdict as never) && published;
  const isExisting = verdict === 'not_first';

  const { claim, reason } = classifyFirstTranslationClaim(book as unknown as ScreenedBook);
  const dispForLabel = (verdict && VERDICT_TO_DISPOSITION[verdict as keyof typeof VERDICT_TO_DISPOSITION]) ?? legacy?.disposition;
  const inProgress = isFirst && !isTranslationReadable(book);
  let coverage: number | null;
  if (storedRung(book) !== null) {
    const c = translationCompleteness(book);
    coverage = c.translatable > 0 ? c.translated / c.translatable : null;
  } else {
    coverage = translationCoverage(book);
  }

  const card: TranslationCard | null = await loadCard(db, book.work_id).catch(() => null);
  const label = card ? cardLabel(card, book) : null;

  let attempt: FirstTranslationAttempt | null = null;
  try { attempt = strongestAttempt(await getAttempts(db, book.id)); } catch { attempt = null; }

  const priors: Array<Record<string, unknown>> = [];
  if (!isFirst && hasPublishablePriorTranslation(book as never)) {
    const p = book.prior_translation as PriorTranslationCredit;
    priors.push({ title: p.work_title, translators: p.translators, year: p.year, scope: p.scope, url: p.url, verified: true });
  }
  if (isFirst || isExisting) {
    for (const p of normalizePriors(book, attempt, legacy?.translations_found)) priors.push({ ...p, verified: false });
  }

  const noteParts: string[] = [];
  if (isFirst) {
    noteParts.push(firstTranslationDescription(dispForLabel, claim));
    if (inProgress && coverage !== null) noteParts.push(translationProgressNote(coverage));
  } else if (isExisting && priors.length) {
    noteParts.push('This text has already been translated into English.');
  }

  return {
    badge_shown: isFirst,
    is_first_translation: !!book.is_first_translation,
    badge_label: isFirst ? firstTranslationBadge(dispForLabel, book.language, inProgress, claim) : null,
    verdict,
    evidence_strength: ft?.evidence_strength ?? attempt?.evidence_strength ?? null,
    claim,
    claim_reason: reason,
    note: noteParts.length ? noteParts.join(' ') : null,
    card: label && card ? { status: card.status, sentence: label.sentence, register: label.register } : null,
    prior_translations: priors,
  };
}
