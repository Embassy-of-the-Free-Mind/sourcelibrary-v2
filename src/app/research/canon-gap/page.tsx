import { Metadata } from 'next';
import type { ReactNode } from 'react';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import gapMap from '../../../../scripts/catalog-coverage/results/canon-gap-map-2026-10.json';
import gapStatus from '../../../../scripts/catalog-coverage/results/canon-gap-status-2026-10.json';
import { CanonBars, RoutesDiagram, StatusBoard, STATUS_STYLE, TengyurProgress, TraditionProgress, short, type CanonBar } from './diagrams';

// Built for the Eternity Foundation working session (#5513): read once, seated, as a
// table with a short argument. Sizes, licences, English shares and draft costs come from
// canon-gap-map.mjs; where each canon stands comes from canon-gap-status.mjs. Re-run
// those scripts (not this page) when a canon moves.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'The Open Canons — Source Library Research',
  description:
    'Which Buddhist, Hindu, Jewish, Islamic and Chinese canons are already typed in openly, how much of each has any English, and what a draft English translation would cost.',
  alternates: { canonical: '/research/canon-gap' },
  robots: { index: false, follow: true },
};

type Row = (typeof gapMap.rows)[number];
type StatusRow = (typeof gapStatus.corpora)[number] & { done?: string };

const ISSUE_URL = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary/issues/';
const RESULTS_URL =
  'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary/blob/main/scripts/catalog-coverage/results/canon-gap-map-2026-10.json';

// Measured figures that live in issue reports rather than in the two result files.
// Eternity shelf: readable_in_english recomputed from pages for all 278 listed books
// (#5513, 2026-10-02 23:50Z). Tengyur pilot: 5 volumes, envelope tengyur-pilot-5497 (#5497,
// final report 2026-10-03 06:15Z).
const SHELF = { readable: 221, listed: 278, url: `${ISSUE_URL}5513` };
const TENGYUR_PILOT = { volumes: 5, pages: 1269, usd: 1.9, fullUsd: 192, pagesImaged: 128639, url: `${ISSUE_URL}5497` };

// Rows inside another row (Chan ⊂ CBETA), duplicating one (K-Tripitaka ≈ CBETA Taishō), or
// with no typed text (Mongolian Kanjur) stay out of totals and Figure 2 — the same scope
// the script uses for total_draft_usd.
const OUT_OF_TOTAL = new Set(['cbeta-chan', 'tripitaka-koreana', 'mongolian-kanjur']);

const SHORT_NAME: Record<string, string> = {
  'derge-tengyur': 'Derge Tengyur',
  'derge-kangyur': 'Derge Kangyur',
  cbeta: 'CBETA (Chinese Buddhist canon)',
  'cbeta-chan': 'CBETA Chan records',
  'pali-mula': 'Pali canon: root texts',
  'pali-atthakatha': 'Pali: commentaries',
  'pali-tika': 'Pali: sub-commentaries',
  'gretil-buddhist': 'GRETIL Sanskrit: Buddhist',
  'gretil-vedanta': 'GRETIL Sanskrit: Vedānta',
  'gretil-gaudiya': 'GRETIL Sanskrit: Gauḍīya',
  'sefaria-zohar': 'Zohar (Sefaria)',
  'sefaria-lurianic': 'Lurianic Kabbalah (Sefaria)',
  'sefaria-cordovero': 'Cordovero (Sefaria)',
  'openiti-sufi': 'OpenITI: Sufi texts',
  ganjoor: 'Ganjoor (Persian poetry)',
  'mongolian-kanjur': 'Mongolian Kanjur',
  'tripitaka-koreana': 'Tripitaka Koreana',
  kanripo: 'Kanripo (Chinese classics)',
};
const nameOf = (id: string, fallback: string) => SHORT_NAME[id] ?? fallback;

const LICENCE_LABEL: Record<string, string> = {
  open: 'Open',
  'open-nc': 'Open, non-commercial',
  'reference-only': 'Reference only',
  unverified: 'Unverified',
  restricted: 'Restricted',
};

const STATUS = new Map((gapStatus.corpora as StatusRow[]).map((s) => [s.id, s]));
const fmt = (n: number) => n.toLocaleString('en-US');

const rows = [...gapMap.rows].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
const inTotal = gapMap.rows.filter((r) => !OUT_OF_TOTAL.has(r.id));
const typedChars = inTotal.reduce((s, r) => s + (r.size.base_chars ?? 0), 0);
const tengyur = gapMap.rows.find((r) => r.id === 'derge-tengyur')!;
const tengyurStatus = STATUS.get('derge-tengyur');
const asOf = new Date(gapStatus.generated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const bars: CanonBar[] = inTotal
  .filter((r) => r.size.base_chars && r.cost.usd != null)
  .map((r) => ({
    id: r.id,
    name: nameOf(r.id, r.corpus),
    chars: r.size.base_chars as number,
    english: r.english.fraction,
    usd: r.cost.usd as number,
    upper: r.english.fraction == null,
  }))
  .sort((a, b) => b.chars - a.chars);

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="px-5 py-6 border-stone-200 [&:not(:last-child)]:border-r max-sm:[&:nth-child(odd)]:border-r max-sm:[&:nth-child(-n+2)]:border-b">
      <div className="font-serif text-3xl md:text-4xl text-stone-900 tracking-tight">{n}</div>
      <div className="font-body text-sm text-stone-500 mt-1.5 leading-snug">{label}</div>
    </div>
  );
}

function Section({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <section className="py-12 border-b border-stone-200">
      <div className="font-body text-xs tracking-[0.16em] uppercase text-amber-700 font-semibold mb-3">{kicker}</div>
      <h2 className="font-serif text-2xl md:text-3xl text-stone-900 mb-4 tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function CorpusRow({ r }: { r: Row }) {
  const st = STATUS.get(r.id);
  const style = st ? STATUS_STYLE[st.status as keyof typeof STATUS_STYLE] : null;
  const upper = r.english.fraction == null;
  return (
    <div id={r.id} className="scroll-mt-24 py-5 border-b border-stone-200 md:grid md:grid-cols-[minmax(0,2.4fr)_repeat(4,minmax(0,1fr))] md:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-serif text-lg text-stone-900">{r.corpus}</span>
          {style && (
            <span className={`font-body text-[11px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm ${style.cls}`}>{style.label}</span>
          )}
        </div>
        <div className="font-body text-sm text-stone-500 mt-0.5">{r.tradition}</div>
        <div className="font-body text-sm mt-2">
          <a href={r.source.url} className="text-amber-800 underline underline-offset-2 break-words">
            {r.source.name}
          </a>
          <span className="text-stone-500"> · {LICENCE_LABEL[r.licence.open] ?? r.licence.open}</span>
        </div>
        {r.licence.quote && (
          <details className="font-body text-sm text-stone-600 mt-1">
            <summary className="cursor-pointer text-stone-500">Licence, as the source states it</summary>
            <blockquote className="mt-1 pl-3 border-l-2 border-stone-300 italic break-words">
              &ldquo;{r.licence.quote}&rdquo;{' '}
              {r.licence.url && (
                <a href={r.licence.url} className="not-italic text-amber-800 underline underline-offset-2">
                  source
                </a>
              )}
            </blockquote>
          </details>
        )}
        {st?.done && (
          <p className="font-body text-sm text-stone-700 mt-2">
            <span className="font-semibold">Done:</span> {st.done}
          </p>
        )}
        {st?.next_action && (
          <p className="font-body text-sm text-stone-700 mt-1">
            <span className="font-semibold">Next:</span> {st.next_action}
          </p>
        )}
        {st?.owner_issue && (
          <a href={`${ISSUE_URL}${st.owner_issue}`} className="font-body text-xs text-stone-500 underline underline-offset-2">
            Work log #{st.owner_issue}
          </a>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 md:mt-0 md:contents font-body text-sm">
        <div>
          <dt className="md:hidden text-[11px] uppercase tracking-wider text-stone-400">Typed text</dt>
          <dd className="text-stone-800">
            {r.size.base_chars ? `${short(r.size.base_chars)} chars` : '—'}
            {r.size.texts != null && <span className="block text-[11px] text-stone-400">{fmt(r.size.texts)} texts</span>}
          </dd>
        </div>
        <div>
          <dt className="md:hidden text-[11px] uppercase tracking-wider text-stone-400">Has English</dt>
          <dd className="text-stone-800">
            {upper ? <span className="text-stone-400">unknown</span> : `${((r.english.fraction as number) * 100).toFixed((r.english.fraction as number) < 0.1 ? 1 : 0)}%`}
          </dd>
        </div>
        <div>
          <dt className="md:hidden text-[11px] uppercase tracking-wider text-stone-400">We hold</dt>
          <dd className="text-stone-800">
            {fmt(st?.held_books ?? r.holdings.live_books + r.holdings.hidden_books)} books
            {st && (
              <span className="block text-[11px] text-stone-400">
                {fmt(st.live_books)} public · {fmt(st.readable_books)} in English
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="md:hidden text-[11px] uppercase tracking-wider text-stone-400">Draft English</dt>
          <dd className="text-stone-900 font-semibold">
            {r.cost.usd == null ? (
              <span className="text-stone-400 font-normal">n/a</span>
            ) : (
              <>
                ${fmt(r.cost.usd)}
                {upper && <span className="block text-[11px] text-stone-400 font-normal">upper bound</span>}
              </>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export default function CanonGapPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Open Canons"
          subtitle="Several of the great scriptural canons have already been typed in, and their texts released openly. For those, the slow and costly step of reading the page image is done. What remains is the English. This page lists each canon, how much of it has any English, and what a first draft would cost."
        />
      }
    >
      <div className="max-w-5xl mx-auto font-body text-stone-700 text-lg leading-relaxed">
        <p className="text-sm text-stone-500 mt-6">
          Prepared for the Eternity Foundation working session, October 2026. Figures measured {asOf}.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 border border-stone-200 rounded-sm bg-stone-50 my-8">
          <Stat n={short(typedChars)} label="characters of canon typed in and openly available, across the canons below" />
          <Stat n={`$${fmt(gapMap.total_draft_usd)}`} label="to draft all of it in English with AI at our measured rates; mostly an upper bound" />
          <Stat
            n={`${(100 - (tengyur.english.fraction ?? 0) * 100).toFixed(1)}%`}
            label="of the Derge Tengyur has no published English translation (84000 catalogue)"
          />
          <Stat n={`${SHELF.readable} / ${SHELF.listed}`} label="books on the Eternity reading list now readable in English here" />
        </div>

        <Section kicker="The argument" title="The draft is cheap; the reading is not">
          <p className="mb-4">
            Where a canon exists only as page images, every page has to be read by a model first, and that reading has
            to be checked. Where the canon has already been typed in by a project such as Esukhia, CBETA or Sefaria,
            that step is gone. Where an open scan of the same edition exists, we pair the typed text with it, so each
            page can still be checked against its source.
          </p>
          <p>
            The draft English is then a small cost: every canon below together comes to about $
            {fmt(gapMap.total_draft_usd)}. The real cost is scholarly review. A draft makes a text searchable and
            readable in outline; it does not replace a translator. Money for review goes furthest on the canons that
            are open, typed, paired with scans, and have little English.
          </p>
          <RoutesDiagram n={1} />
        </Section>

        <Section kicker="Our library" title="Scanned, transcribed, translated">
          <p>
            Before the typed canons, here is what we already hold in each tradition: scanned books in every edition we
            could find, how much of each we have transcribed, and how much has a draft English translation. The
            Tibetan figure includes the Derge Tengyur we imported this month; the Mongolian Kanjur is scans only so far.
          </p>
          <TraditionProgress n={2} rows={[...gapStatus.traditions].sort((a, b) => b.pages_scanned - a.pages_scanned)} />
        </Section>

        <Section kicker="The gap" title="Most of the typed canon has no English, or nobody knows">
          <p>
            Only three catalogues publish how much of their canon is in English: 84000 for the Tibetan canon,
            SuttaCentral for the Pali, and Sefaria for the Hebrew. For the Chinese and Arabic canons, which are by far
            the largest, the share is unknown, so their draft cost below assumes none of it is in English.
          </p>
          <CanonBars n={3} rows={bars} />
        </Section>

        <Section kicker="The first case" title="The Derge Tengyur">
          <p>
            The Tengyur, the canon of Indian commentaries and treatises in Tibetan, is the clearest case. Its text is
            in the public domain, BDRC holds open scans of the same woodblock edition, and less than 1% of it is
            available in English. We have imported all of it, paired each typed folio with its page image, and drafted
            a sample to measure the cost.{' '}
            <a href={TENGYUR_PILOT.url} className="text-amber-800 underline underline-offset-2">
              Work log
            </a>
            .
          </p>
          <TengyurProgress
            n={4}
            volumes={tengyurStatus?.held_books ?? 213}
            pilotVolumes={TENGYUR_PILOT.volumes}
            pagesImaged={TENGYUR_PILOT.pagesImaged}
            pagesWithText={tengyurStatus?.pages_with_text ?? 128369}
            pilotPages={TENGYUR_PILOT.pages}
            pilotUsd={TENGYUR_PILOT.usd}
            fullUsd={TENGYUR_PILOT.fullUsd}
          />
        </Section>

        <Section kicker="Where it stands" title="Each canon, and what happens next">
          <StatusBoard n={5} items={rows.map((r) => ({ id: r.id, name: nameOf(r.id, r.corpus), status: STATUS.get(r.id)?.status ?? 'next' }))} />
          <p className="mb-6 text-base text-stone-600">
            Ordered by how much untranslated text each canon holds, weighted by how open its licence is and whether open
            scans of the same edition exist. &ldquo;We hold&rdquo; counts the books in our library for that canon:
            how many are public, and how many can be read in English.
          </p>
          <div className="hidden md:grid md:grid-cols-[minmax(0,2.4fr)_repeat(4,minmax(0,1fr))] md:gap-4 border-b-2 border-stone-300 pb-2 font-body text-[11px] uppercase tracking-wider text-stone-500">
            <div>Canon · open source · licence</div>
            <div>Typed text</div>
            <div>Has English</div>
            <div>We hold</div>
            <div>Draft English</div>
          </div>
          {rows.map((r) => (
            <CorpusRow key={r.id} r={r} />
          ))}
        </Section>

        <Section kicker="Already under way" title="The Eternity reading list">
          <p>
            Alongside the typed canons, we have been reading and translating the scanned books on the list drawn up with
            Eternity. As of the last count, <strong>{SHELF.readable} of {SHELF.listed}</strong> of those books can be
            read in English on Source Library. The rest wait on a second reading of difficult pages or are still being
            translated. Each step is logged in{' '}
            <a href={SHELF.url} className="text-amber-800 underline underline-offset-2">
              the public work log
            </a>
            .
          </p>
        </Section>

        <Section kicker="Read these carefully" title="Limits of the numbers">
          <ul className="list-disc pl-5 space-y-3 text-base">
            <li>
              <strong>English coverage is unknown for most canons.</strong> Only 84000, SuttaCentral and Sefaria publish
              a measurable share. SuttaCentral&rsquo;s figure also leaves out the Pali Text Society&rsquo;s printed
              translations, so it undercounts.
            </li>
            <li>
              <strong>The cost is for our cheapest translation setting.</strong> A stronger model costs about four
              times as much per page for Chinese. Either way the draft is a small share of the cost of review.
            </li>
            <li>
              <strong>Some sizes are sampled.</strong> Kanripo&rsquo;s size is estimated from 40 works per section; two
              estimates differ by about 25%.
            </li>
            <li>
              <strong>Licences are quoted, not assumed.</strong> GRETIL&rsquo;s files say they are for reference only,
              so we do not publish their text; we read our own scans of the printed editions instead. Ganjoor and the
              K-Tripitaka state no licence we could find. Sefaria&rsquo;s main Zohar Hebrew text is marked
              &ldquo;unknown&rdquo;.
            </li>
            <li>
              <strong>&ldquo;We hold&rdquo; is a floor.</strong> It counts books matched by title and collection; we
              may hold more.
            </li>
          </ul>
          <p className="text-sm text-stone-500 mt-6">
            Every figure, quote, sample size and query behind this page is in the{' '}
            <a href={RESULTS_URL} className="text-amber-800 underline underline-offset-2">
              results file
            </a>{' '}
            produced by <code className="text-xs">scripts/catalog-coverage/canon-gap-map.mjs</code>. Measuring it made no
            model calls.
          </p>
        </Section>
      </div>
    </ContentPageLayout>
  );
}
