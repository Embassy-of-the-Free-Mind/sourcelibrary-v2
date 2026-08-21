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
  summarizePriorEvidence,
  type PriorEvidenceSummary,
} from '@/lib/first-translation/prior-evidence';
import {
  FIRST_FAMILY,
  DISPOSITION_TO_VERDICT,
  VERDICT_TO_DISPOSITION,
  type FirstTranslationVerdict,
  type LegacyDisposition,
} from '@/lib/first-translation/types';
import { translationCoverage, isTranslationReadable } from '@/lib/first-translation/derive';
import {
  firstTranslationBadge,
  firstTranslationDescription,
  translationProgressNote,
} from '@/lib/first-translation-labels';
import {
  classifyFirstTranslationClaim,
  type ScreenedBook,
} from '@/lib/first-translation/candidate';
import type { PriorTranslationCredit } from '@/lib/types/book';
import {
  hasPublishablePriorTranslation,
  priorLinkLabel,
  priorTranslationSentence,
  formatTranslators,
} from '@/lib/prior-translation';

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
  /** Required by the claim classifier's render gate — see classifyClaim below. */
  visible?: boolean;
  title?: string;
  author?: string;
  original_language?: string;
  source_language_screen?: { verdict?: 'english_source' | 'foreign_source' | 'undetermined' | 'no_ocr' } | null;
  translator_author_screen?: { verdict?: 'hold' } | null;
  pages_translated?: number | null;
  // Coverage inputs (#3435) — see translationCoverage() for the denominator.
  pages_ocr?: number | null;
  pages_blank?: number | null;
  pages_count?: number | null;
  prior_translation?: PriorTranslationCredit;
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

/**
 * The verified prior-translation credit (issue #3026) — the un-extractive move.
 *
 * Shown, quietly and always-visible, ONLY when the prior human edition resolved
 * to a real bibliographic record with a live link. Courtesy framing, not a
 * storefront: name the translator, and point the reader to where the scholar's
 * edition can be read or found. The link is a hard requirement — a credit with
 * no reachable destination doesn't ship, so `hasPublishablePriorTranslation`
 * has already guaranteed `url` before we render.
 */
function PriorTranslationCreditLine({
  prior,
  showExternalLinks,
}: {
  prior: PriorTranslationCredit;
  showExternalLinks: boolean;
}) {
  return (
    <div className="mt-3 text-xs text-stone-400 leading-relaxed">
      <span className="italic text-stone-300">{priorTranslationSentence(prior)}</span>
      {showExternalLinks && (
        <>
          {' '}
          <a
            href={prior.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-gold hover:text-accent-gold/80 whitespace-nowrap"
          >
            {priorLinkLabel(prior)} &rarr;
          </a>
        </>
      )}
    </div>
  );
}

/** Render a source/tool token readably: a URL → its host; a `search_x` tool → "x". */
function cleanSource(s: string): string {
  if (/^https?:\/\//.test(s)) {
    try { return new URL(s).hostname.replace(/^www\./, ''); } catch { return s; }
  }
  return s.replace(/^search_/, '').replace(/_/g, ' ');
}

/**
 * The evidence footer, honest about how much verification actually backs the
 * claim (principle #1). Three tiers, by what's on record:
 *  1. a documented search trail (real queries) → show exactly what was searched;
 *  2. an automated catalogue check (tools/sources but no retained query log) →
 *     say so, and that the query log wasn't kept;
 *  3. nothing but a conclusion → "preliminary, verification pending".
 */
function EvidenceFooter({
  attempt,
  summary,
  legacy,
  showExternalLinks,
}: {
  attempt: FirstTranslationAttempt | null;
  summary: PriorEvidenceSummary | null;
  legacy?: EvidenceBook['translation_verification'];
  showExternalLinks: boolean;
}) {
  const methodology = showExternalLinks ? (
    <>{' '}&middot;{' '}<a href="/blog/first-translation-methodology" className="underline hover:text-stone-500">methodology</a></>
  ) : null;

  const date = attempt?.date ?? legacy?.verified_at;
  const queries = (attempt?.queries ?? []).filter(Boolean);

  // TIER 1 — a real documented search (we kept the queries). Show it verbatim.
  if (queries.length > 0) {
    const sources = (summary?.searchedSources ?? attempt?.sources_checked ?? []).filter(Boolean).map(cleanSource);
    const indep = summary?.independentAbsenceMethods ?? 0;
    return (
      <div className="text-stone-600 text-[10px] space-y-1">
        <p>
          {sources.length ? `Searched ${[...new Set(sources)].slice(0, 6).join(', ')}` : 'Searched library catalogs'}
          {indep >= 2 ? ` · ${indep} independent checks` : ''}
          {date ? ` · ${fmtDate(date)}` : ''}
          {methodology}
        </p>
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
      </div>
    );
  }

  // TIER 2 — an automated catalogue check ran (tools/sources recorded) but no
  // query log was retained. Name the tools; don't imply a documented search.
  const tools = [...new Set([
    ...(summary?.searchedSources ?? []),
    ...(attempt?.sources_checked ?? []),
    ...((legacy?.tools_called ?? []).filter((t) => t !== 'make_determination')),
  ].filter(Boolean).map(cleanSource))];
  if (tools.length > 0) {
    return (
      <p className="text-stone-600 text-[10px]">
        Automated catalogue check{date ? ` · ${fmtDate(date)}` : ''} via {tools.slice(0, 6).join(', ')} — detailed
        query log not retained.
        {methodology}
      </p>
    );
  }

  // TIER 3 — a weak legacy determination: the catalogue cron checked Open
  // Library / Google Books / Internet Archive and, finding nothing, asked the
  // model's training knowledge. That IS evidence — just weak and not
  // independently auditable. Represent it as such (don't imply "no search", and
  // don't imply a documented one). The per-book trail wasn't retained, but the
  // weak verdict is preserved in the attempt log so its accuracy can be measured.
  return (
    <p className="text-stone-600 text-[10px]">
      Preliminary{date ? ` · ${fmtDate(date)}` : ''} — automated catalogue + model-knowledge check; not
      independently verified.
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
        title="Weak evidence — automated catalogue + model-knowledge check, not independently verified"
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

  // Which REGISTER the claim is stated in (#3459). `confirmed` earns the
  // assertive label; `candidate` reports the search instead of asserting the
  // negative it cannot establish. This does not change WHETHER the panel
  // renders — `isFirst` still governs that — only what it says.
  //
  // If the Atlas fetch failed and the page fell back to the Supabase catalog
  // row, the verdict and screen fields are absent and this resolves to
  // `candidate`. That is the safe direction: a thin payload understates the
  // claim rather than overstating it.
  const { claim } = classifyFirstTranslationClaim(book as unknown as ScreenedBook);
  const isCandidateClaim = claim !== 'confirmed';

  // #3435: the claim can be true while the English edition is nowhere near
  // readable. Keep the badge, qualify it — and say how far along it actually is.
  const coverage = translationCoverage(book);
  const inProgress = isFirst && !isTranslationReadable(book);

  // A verified, publishable prior-translation credit (#3026). Populated only on
  // non-first books whose prior edition resolved to a real record with a link.
  // It's the honest headline for a not_first book, so it shows even when the
  // verdict resolution is thin — but never on a book we badge as a first.
  const publishablePrior = !isFirst && hasPublishablePriorTranslation(book)
    ? book.prior_translation
    : null;

  // A first_from_source book IS a first (of this text/witness), but the work
  // also exists in English from a different source — or the text is itself a
  // translation from an English original (the Dutch voyage narratives). Surface
  // that existing English *alongside* the badge so a reader can compare and see
  // where this edition drifted — often the whole scholarly point (#3026).
  const sourceComparePrior = isFirst && verdict === 'first_from_source' && hasPublishablePriorTranslation(book)
    ? book.prior_translation
    : null;

  if (!isFirst && !isExisting && !publishablePrior) return null;

  // A verified credit is self-contained (no attempt-log read needed) and
  // supersedes the unverified "Existing translations" panel — render the quiet,
  // always-visible courtesy line with its link and stop.
  if (publishablePrior) {
    return <PriorTranslationCreditLine prior={publishablePrior} showExternalLinks={showExternalLinks} />;
  }

  // Always read the accumulated evidence pile. Since the #2802 backfill lifted
  // legacy disposition evidence into the attempt log (13k+ books), most claims —
  // not just graded ones — now have a real, if weak, trail to show.
  let attempt: FirstTranslationAttempt | null = null;
  let summary: PriorEvidenceSummary | null = null;
  try {
    const db = await getReadDb();
    const attempts = await getAttempts(db, book.id);
    attempt = strongestAttempt(attempts);
    summary = summarizePriorEvidence(attempts);
  } catch {
    attempt = null;
    summary = null;
  }

  const priors = normalizePriors(attempt, legacy?.translations_found);

  // Confidence signal. Only a real adjudicator strength (strong/moderate) earns
  // the evidence chip; everything else — weak legacy/automated, or nothing on
  // record — reads as "preliminary" so it doesn't borrow a verified claim's
  // authority.
  const effectiveStrength = ft?.evidence_strength ?? attempt?.evidence_strength;
  const isPreliminary = effectiveStrength !== 'strong' && effectiveStrength !== 'moderate';

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
            <EvidenceFooter attempt={attempt} summary={summary} legacy={legacy} showExternalLinks={showExternalLinks} />
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <details className="group">
        {/* Plain catalog voice (2026-08-11): one gold badge, no register split,
            no strength/preliminary chips — the evidence footer below keeps the
            provenance one click away. */}
        <summary
          className="inline-flex items-center gap-2 px-2.5 py-1 bg-accent-gold/20 text-accent-gold hover:bg-accent-gold/30 text-xs font-medium rounded-full border border-accent-gold/30 transition-colors cursor-pointer list-none [&::-webkit-details-marker]:hidden"
        >
          {firstTranslationBadge(dispForLabel, book.language, inProgress, claim)}
        </summary>
        <div className="mt-2 p-3 bg-stone-800/50 rounded-lg border border-stone-700/50 text-xs space-y-2">
          <p className="text-stone-300">{firstTranslationDescription(dispForLabel, claim)}</p>
          {inProgress && coverage !== null && (
            <p className="text-stone-400">{translationProgressNote(coverage)}</p>
          )}
          {legacy?.reasoning && <p className="text-stone-400">{legacy.reasoning}</p>}
          {sourceComparePrior && (
            <div className="space-y-1 pt-1 border-t border-stone-700/40">
              <p className="text-stone-400">
                The work also exists in English from a different source. Comparing the two shows where this edition departs from the original:
              </p>
              <p className="text-stone-300">
                <span className="italic">{sourceComparePrior.work_title}</span>
                {sourceComparePrior.translators?.length ? <span className="text-stone-400">, {formatTranslators(sourceComparePrior.translators)}</span> : null}
                {sourceComparePrior.year ? <span className="text-stone-400"> ({sourceComparePrior.year})</span> : null}
                {showExternalLinks && (
                  <>
                    {' '}
                    <a href={sourceComparePrior.url} target="_blank" rel="noopener noreferrer" className="text-accent-gold hover:text-accent-gold/80 whitespace-nowrap">
                      compare &rarr;
                    </a>
                  </>
                )}
              </p>
            </div>
          )}
          {priors.length > 0 && (
            <div className="space-y-1">
              <span className="text-stone-500">Related translations found:</span>
              <PriorList priors={priors} />
            </div>
          )}
          <EvidenceFooter attempt={attempt} summary={summary} legacy={legacy} showExternalLinks={showExternalLinks} />
        </div>
      </details>
    </div>
  );
}
