/**
 * First-translation badge + click-through evidence panel (#2564 / #2639).
 *
 * Two reader-facing surfaces, one panel:
 *  - a FIRST-family verdict  → "First Translation" badge (varied label)
 *  - a `not_first` verdict    → "Existing translations" badge (points the reader
 *    at the English version that already exists)
 *
 * Prefers the graded #2564 model (`book.first_translation` + the strongest
 * `first_translation_attempts` row: grounded queries, sources consulted,
 * evidence strength, structured priors). Falls back to the legacy
 * `translation_verification` panel so nothing regresses before the enumeration
 * has populated attempts at scale.
 *
 * #2232 discipline: render the STRUCTURED prior (title/translator/year + link)
 * and the real sources — never the AI's free prose as if it were source text.
 */
import { getReadDb } from '@/lib/mongodb';
import {
  getAttempts,
  strongestAttempt,
  type FirstTranslationAttempt,
} from '@/lib/first-translation/attempt-log';
import {
  FIRST_FAMILY,
  DISPOSITION_TO_VERDICT,
  VERDICT_TO_DISPOSITION,
  type FirstTranslationVerdict,
  type LegacyDisposition,
} from '@/lib/first-translation/types';
import { firstTranslationBadge, firstTranslationDescription } from '@/lib/first-translation-labels';

interface LegacyPrior {
  english_title?: string;
  translator?: string;
  pub_year?: string;
  completeness?: string;
  url?: string;
}

interface EvidenceBook {
  id: string;
  language?: string;
  is_first_translation?: boolean;
  pages_translated?: number | null;
  first_translation?: {
    verdict?: FirstTranslationVerdict;
    evidence_strength?: string;
    best_attempt_id?: string;
  } | null;
  translation_verification?: {
    disposition?: string;
    reasoning?: string;
    translations_found?: LegacyPrior[];
    tools_called?: string[];
    verified_at?: string | Date;
  } | null;
}

interface NormalizedPrior {
  title?: string;
  translator?: string;
  pub_year?: string;
  completeness?: string;
  url?: string;
}

function fmtDate(d?: string | Date): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function normalizePriors(attempt: FirstTranslationAttempt | null, legacy?: LegacyPrior[]): NormalizedPrior[] {
  if (attempt?.priors?.length) {
    return attempt.priors
      .filter((p) => p.english_title)
      .map((p) => ({ title: p.english_title, translator: p.translator, pub_year: p.pub_year, completeness: p.completeness, url: p.source_url }));
  }
  return (legacy ?? [])
    .filter((p) => p.english_title)
    .map((p) => ({ title: p.english_title, translator: p.translator, pub_year: p.pub_year, completeness: p.completeness, url: p.url }));
}

function PriorList({ priors }: { priors: NormalizedPrior[] }) {
  return (
    <div className="space-y-1">
      {priors.map((t, i) => (
        <p key={i} className="text-stone-400 pl-2">
          <span className="italic">{t.title}</span>
          {t.translator && t.translator !== 'unknown' && `, trans. ${t.translator}`}
          {t.pub_year && ` (${t.pub_year})`}
          {t.completeness && t.completeness !== 'unknown' && <span className="text-stone-500"> [{t.completeness}]</span>}
          {t.url && (
            <>{' '}<a href={t.url} target="_blank" rel="noopener noreferrer" className="text-accent-gold hover:text-accent-gold/80 underline">source</a></>
          )}
        </p>
      ))}
    </div>
  );
}

/** The grounded search trail (new model) or the legacy "verified via tools" line. */
function EvidenceFooter({
  attempt,
  legacy,
  showExternalLinks,
}: {
  attempt: FirstTranslationAttempt | null;
  legacy?: EvidenceBook['translation_verification'];
  showExternalLinks: boolean;
}) {
  const methodology = showExternalLinks ? (
    <>{' '}&middot;{' '}<a href="/blog/first-translation-methodology" className="underline hover:text-stone-500">methodology</a></>
  ) : null;

  if (attempt) {
    const sources = (attempt.sources_checked ?? []).filter(Boolean);
    const queries = (attempt.queries ?? []).filter(Boolean);
    return (
      <div className="text-stone-600 text-[10px] space-y-1">
        <p>
          {sources.length ? `Searched ${sources.slice(0, 6).join(', ')}` : 'Searched library catalogs'}
          {attempt.date ? ` · ${fmtDate(attempt.date)}` : ''}
          {methodology}
        </p>
        {queries.length > 0 && (
          <details className="group/q">
            <summary className="cursor-pointer hover:text-stone-500 list-none [&::-webkit-details-marker]:hidden">
              show {queries.length} search{queries.length === 1 ? '' : 'es'}
            </summary>
            <ul className="mt-1 pl-3 space-y-0.5">
              {queries.slice(0, 12).map((q, i) => (
                <li key={i} className="text-stone-500">“{q}”</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    );
  }

  if (legacy?.tools_called && legacy.tools_called.length > 0) {
    return (
      <p className="text-stone-600 text-[10px]">
        Verified {fmtDate(legacy.verified_at)} via{' '}
        {legacy.tools_called
          .filter((t) => t !== 'make_determination')
          .map((t) => t.replace('search_', '').replace(/_/g, ' '))
          .join(', ')}
        {methodology}
      </p>
    );
  }

  // No grounded attempt AND no recorded tool trail — a pure automated/legacy
  // determination (~5,500 badged books). Don't imply a thorough search where
  // none is documented: say so plainly. This is principle #1 (a claim's strength
  // must equal its verification) made visible to the reader.
  return (
    <p className="text-stone-600 text-[10px]">
      Preliminary determination{legacy?.verified_at ? ` · ${fmtDate(legacy.verified_at)}` : ''} — automated
      catalogue check only; detailed verification pending.
      {methodology}
    </p>
  );
}

/**
 * At-a-glance confidence signal. `strong`/`moderate` come from a real
 * adjudicator (cross-model / single documented search). `preliminary` marks the
 * weak legacy/automated claims that carry no documented search trail — so a
 * "moderate, single-pass" claim reads differently from a "strong, cross-model"
 * one, and an unverified legacy claim doesn't borrow their authority.
 */
function StrengthChip({ strength, preliminary }: { strength?: string; preliminary?: boolean }) {
  if (strength === 'strong' || strength === 'moderate') {
    const title =
      strength === 'strong'
        ? 'Cross-checked across independent catalogues/models'
        : 'Single documented search — not cross-model verified';
    return (
      <span
        title={title}
        className="inline-block whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded bg-stone-700/60 text-stone-400"
      >
        {strength} evidence
      </span>
    );
  }
  if (preliminary) {
    return (
      <span
        title="Automated catalogue check only — detailed per-book verification pending"
        className="inline-block whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded bg-stone-700/40 text-stone-500"
      >
        preliminary
      </span>
    );
  }
  return null;
}

export default async function FirstTranslationEvidence({
  book,
  showExternalLinks,
}: {
  book: EvidenceBook;
  showExternalLinks: boolean;
}) {
  const ft = book.first_translation ?? null;
  const legacy = book.translation_verification ?? null;
  const legacyDisp = legacy?.disposition as LegacyDisposition | undefined;

  // Resolve the verdict: prefer the graded model, else map the legacy disposition.
  const verdict: FirstTranslationVerdict | undefined =
    ft?.verdict ?? (legacyDisp ? DISPOSITION_TO_VERDICT[legacyDisp] : undefined);

  const published = !!book.is_first_translation && (book.pages_translated ?? 0) > 0;
  const isFirst = !!verdict && FIRST_FAMILY.has(verdict) && published;
  const isExisting = verdict === 'not_first';

  if (!isFirst && !isExisting) return null;

  // Only hit the DB for the grounded attempt when the graded model is present.
  let attempt: FirstTranslationAttempt | null = null;
  if (ft) {
    try {
      const db = await getReadDb();
      attempt = strongestAttempt(await getAttempts(db, book.id));
    } catch {
      attempt = null;
    }
  }

  const priors = normalizePriors(attempt, legacy?.translations_found);

  // Confidence signal. A real adjudicator strength wins; otherwise, a badged
  // claim with no attempt and no tool trail is "preliminary" (legacy/automated).
  const effectiveStrength = ft?.evidence_strength ?? attempt?.evidence_strength;
  const isPreliminary =
    !effectiveStrength && !attempt && !(legacy?.tools_called && legacy.tools_called.length > 0);

  // "Existing translations" only earns a badge if we actually have priors to show.
  if (isExisting && priors.length === 0) return null;

  // Label uses the verdict's legacy-equivalent disposition (keeps badge text in sync).
  const dispForLabel = (verdict && VERDICT_TO_DISPOSITION[verdict]) ?? legacyDisp;

  if (isExisting) {
    return (
      <div className="mt-3">
        <details className="group">
          <summary className="inline-flex px-2.5 py-1 bg-stone-700/40 text-stone-300 hover:bg-stone-700/60 text-xs font-medium rounded-full border border-stone-600/50 transition-colors cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            Existing translation{priors.length === 1 ? '' : 's'}{priors.length > 1 ? ` (${priors.length})` : ''}
          </summary>
          <div className="mt-2 p-3 bg-stone-800/50 rounded-lg border border-stone-700/50 text-xs space-y-2">
            <p className="text-stone-300">This text has already been translated into English:</p>
            <PriorList priors={priors} />
            <EvidenceFooter attempt={attempt} legacy={legacy} showExternalLinks={showExternalLinks} />
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <details className="group">
        <summary className="inline-flex items-center gap-2 px-2.5 py-1 bg-accent-gold/20 text-accent-gold hover:bg-accent-gold/30 text-xs font-medium rounded-full border border-accent-gold/30 transition-colors cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          {firstTranslationBadge(dispForLabel, book.language)}
        </summary>
        <div className="mt-2 p-3 bg-stone-800/50 rounded-lg border border-stone-700/50 text-xs space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-stone-300">{firstTranslationDescription(dispForLabel)}</p>
            <StrengthChip strength={effectiveStrength} preliminary={isPreliminary} />
          </div>
          {legacy?.reasoning && <p className="text-stone-400">{legacy.reasoning}</p>}
          {priors.length > 0 && (
            <div className="space-y-1">
              <span className="text-stone-500">Related translations found:</span>
              <PriorList priors={priors} />
            </div>
          )}
          <EvidenceFooter attempt={attempt} legacy={legacy} showExternalLinks={showExternalLinks} />
        </div>
      </details>
    </div>
  );
}
