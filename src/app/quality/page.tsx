import { Metadata } from 'next';
import type { ReactNode } from 'react';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import servedDraw from '../../../scripts/eval/confidence-7866/results/score.json';
import servedGrades from '../../../scripts/eval/confidence-7866/results/served-grades.json';
import judgeCal from '../../../scripts/eval/judge-cal-7866bar-7263/results/score.json';
import threeWay from '../../../scripts/eval/judge-cal-7866bar-7263/results/three-way.json';
import { LEAF, leafHref, PROSE_AS_OF, WAYS } from './content';

// The Quality Center (#5918): one question for a reader — how far can I trust the text on a page here,
// and in my language? — answered from the #7866 check of live books against the page images, re-graded
// on the rubric's grades (#7933), and set beside the same reviewer's reading of the Internet Archive's OCR
// and of human-typed editions of the same pages (#7941 three-way; #7263 human arm). Voice: .claude/docs/quality-statements.md — describe the
// errors, not the work. Everything that audits these figures (the full grade table, the reviewer's measured
// errors, which engine reads which page, every experiment, what readers reported) is on /quality/record.
// Every number here is read at build time from committed files.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Quality Center | Source Library',
  description:
    'How accurate the transcriptions in Source Library are: errors per 1,000 words beside the Internet Archive’s OCR and human-typed editions of the same pages, page by page and language by language, what goes wrong, and how to check a page yourself.',
  alternates: { canonical: '/quality' },
};

const RECORD = '/quality/record';
const pct = (v: number) => `${Math.round(v * 100)}%`;
const n = (v: number) => v.toLocaleString('en-US');
const one = (v: number) => v.toFixed(1);
const longDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/* ── data ── */

type Grade = { pages: number; share: number; ci95: number[] };
const g = servedGrades.grades as Record<string, Grade>;
const frameBooks = Object.values(servedDraw.corpus.frame_books).reduce((a, x) => a + x, 0);
const drawDate = servedDraw.generated_at.slice(0, 10);

/** The same judge-flag rate over the library's printed pages, from the #7866 random draw (#7263 `corpus_7866_judge_proxy_per_1k`). */
const corpusPrint = judgeCal.corpus_7866_judge_proxy_per_1k.print;
const printPer1k = corpusPrint.per_1k;

/** #7263's typed-edition rate, on the same un-normalised basis as the by-language rates: the reference line there. */
const humanPer1k = judgeCal.human_arm.flagged_per_1k;

/**
 * Three readings of the same pages (#7941): the Internet Archive's OCR, ours, and a human-typed edition, each put
 * through one normaliser and judged blind by the same reviewer against the page image. Set C (pages drawn at random
 * from Archive-sourced books) is the headline for the Archive against ours; sets A + B (pages that have a typed
 * edition) are the three-way.
 */
type Arm = { arm: string; n_pages: number; flagged_per_1k: number; flagged_per_1k_ci95: number[]; judge_bad: number };
const armOf = (rows: Arm[], arm: string) => {
  const r = rows.find(x => x.arm === arm);
  if (!r) throw new Error(`three-way.json: no ${arm} arm`);
  return r;
};
const twRandom = threeWay.archive_vs_ours_random.by_lang as unknown as Record<string, Arm[]>;
const rndArchive = armOf(twRandom.English, 'archive');
const rndOurs = armOf(twRandom.English, 'ours');
const RANDOM_OTHER = (['Latin', 'German'] as const).map(l => ({ lang: l, archive: armOf(twRandom[l], 'archive'), ours: armOf(twRandom[l], 'ours') }));
const randomPaired = threeWay.paired_flags.random;
const twAll = threeWay.three_way.by_lang.ALL as unknown as Arm[];
const twArchive = armOf(twAll, 'archive');
const twOurs = armOf(twAll, 'ours');
const twHuman = armOf(twAll, 'human');
const twSets = threeWay.cuts.set as unknown as Record<'A' | 'B', Arm[]>;
const scholarly = { ours: armOf(twSets.A, 'ours'), human: armOf(twSets.A, 'human') };
const wikisource = { ours: armOf(twSets.B, 'ours'), human: armOf(twSets.B, 'human') };
const twDate = threeWay.generated_at.slice(0, 10);

/** Five bands, each describing the page; the reader's advice is the second line. */
const serious = ['from_elsewhere', 'mostly_wrong', 'not_this_page'].reduce((a, k) => a + g[k].share, 0);
const BANDS = [
  { key: 'clean', label: 'Clean', what: 'No error, or one or two slips that change nothing. Quote it.', share: g.fit_to_quote.share, color: 'bg-stone-800' },
  { key: 'slips', label: 'Small slips only', what: 'Several slips, such as a running head out of place; none changes the sense.', share: g.fit_to_read.share, color: 'bg-stone-400' },
  { key: 'word', label: 'A word that changes the sense', what: 'Usually one misread word in an otherwise sound page. Check the scan before quoting.', share: g.search_only.share, color: 'bg-amber-300' },
  { key: 'span', label: 'A word, number or line differs from the page', what: 'Something dropped or not on the page. Check the scan before quoting.', share: g.wrong_span.share, color: 'bg-amber-600' },
  { key: 'serious', label: 'Mostly wrong, or another page’s text', what: 'Do not rely on these pages; we withhold them as we find them.', share: serious, color: 'bg-amber-900' },
];

/** Languages with at least three books in the draw, fewest errors first. */
const LANGS = servedGrades.by_language
  .filter(r => r.books >= 3)
  .sort((x, y) => x.severe_per_1k - y.severe_per_1k);
const UNIT: Record<string, string> = { words: 'words', 'Han characters': 'characters', syllables: 'syllables' };
const WORD_LANGS = LANGS.filter(r => r.unit === 'words');
const OTHER_LANGS = LANGS.filter(r => r.unit !== 'words');
const RATE_MAX = Math.ceil(Math.max(...LANGS.map(r => r.severe_per_1k)) / 5) * 5;

/** Page shares for a cut of the draw: nothing that changes the sense / a word that does / something not on the page. */
type Shares = { says_what_the_page_says: number; misleads_somewhere: number; text_not_on_the_page: number; severe_per_1k?: number };
const periods = (servedGrades as unknown as { by_period: Record<string, Shares & { books: number }> }).by_period;
const PERIOD_ORDER = ['before 1500', '1500–1599', '1600–1699', '1700–1799', '1800–1899', '1900 and later'];
const PERIOD_ROWS = PERIOD_ORDER.filter(k => periods[k]).map(k => ({ key: k, ...periods[k] }));
const PERIOD_UNKNOWN = periods.unknown;
const scripts = servedGrades.by_script as unknown as Record<string, Shares & { books: number }>;
const SCRIPT_ROWS = [['print', 'Print'], ['manuscript', 'Manuscript']]
  .filter(([k]) => scripts[k])
  .map(([k, label]) => ({ key: k, label, ...scripts[k] }));

/** Share of all tagged defects that are one word read as another. */
const misread = servedGrades.defect_classes.find(c => c.class === 'O6');
const misreadShare = misread ? misread.total / servedGrades.defect_totals.all : 0;

/** Three defects, each confirmed by eye against the page image on 2 November 2026 (see /quality/record). */
const EXAMPLE_PICKS: [string, string][] = [
  ['O6', '故吉觀順'],
  ['O7', 'two hundred .'],
  ['O1', 'ACen Wad'],
];
const SEVERITY: Record<string, string> = {
  wrong_text: 'Not what the page says',
  misleads: 'Changes the sense',
  cosmetic: 'Changes nothing',
};
const examples = EXAMPLE_PICKS.map(([k, prefix]) => {
  const c = servedGrades.defect_classes.find(x => x.class === k);
  return c?.examples.find(x => x.quote.startsWith(prefix)) ?? null;
}).filter((e): e is NonNullable<typeof e> => e != null);

/* ── bits ── */

const LINK = 'text-amber-800 hover:underline underline-offset-2';

function A({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} className={LINK}>{children}</a>;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-16 scroll-mt-24">
      <h2 className="font-serif text-2xl md:text-3xl text-stone-900 mb-4">{title}</h2>
      {children}
    </section>
  );
}

/** One row of the human-vs-machine comparison: a rate per 1,000 words with its interval, on a shared scale. */
function RateRow({ label, sub, rate, ci, max, color, suffix = '' }: { label: string; sub: string; rate: number; ci: number[]; max: number; color: string; suffix?: string }) {
  return (
    <li className="grid grid-cols-[minmax(0,11rem)_1fr_4.5rem] gap-x-3 items-center py-2">
      <span className="text-sm">
        <span className="font-semibold text-stone-900">{label}</span>
        <span className="block text-xs text-stone-500">{sub}</span>
      </span>
      <div className="relative h-5 bg-stone-200 rounded-sm" aria-hidden>
        <div className={`${color} h-full rounded-sm`} style={{ width: `${(rate / max) * 100}%` }} />
        <div className="absolute top-1/2 h-px bg-stone-900/60" style={{ left: `${(ci[0] / max) * 100}%`, width: `${((ci[1] - ci[0]) / max) * 100}%` }} />
      </div>
      <span className="text-right tabular-nums">
        <span className="font-semibold text-stone-900">{one(rate)}{suffix}</span>
        <span className="block text-xs text-stone-500">{one(ci[0])}–{one(ci[1])}{suffix}</span>
      </span>
    </li>
  );
}

function ChartTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold text-stone-900 mb-2 mt-2">{children}</h3>;
}

/** Horizontal bars of a rate on one shared scale, with an optional reference line (the typed editions). */
function RateChart({ rows, max, reference }: { rows: { label: string; sub: string; rate: number }[]; max: number; reference?: { value: number; label: string } }) {
  return (
    <div className="relative mb-4">
      <ul className="space-y-1.5">
        {rows.map(r => (
          <li key={r.label} className="grid grid-cols-[7rem_1fr_3rem] md:grid-cols-[9rem_1fr_3rem] gap-x-3 items-center" title={`${r.label}: ${one(r.rate)} per 1,000 (${r.sub})`}>
            <span className="text-sm leading-tight">
              <span className="font-semibold text-stone-900">{r.label}</span>
              <span className="block text-xs text-stone-500">{r.sub}</span>
            </span>
            <div className="relative h-4">
              <div className="absolute inset-y-0 left-0 bg-stone-700 rounded-r-[3px]" style={{ width: `${Math.max(0.6, (r.rate / max) * 100)}%` }} />
              {reference && (
                <div className="absolute inset-y-[-4px] border-l-2 border-dashed border-amber-700" style={{ left: `${(reference.value / max) * 100}%` }} aria-hidden />
              )}
            </div>
            <span className="text-right tabular-nums text-sm font-semibold text-stone-900">{one(r.rate)}</span>
          </li>
        ))}
      </ul>
      {reference && (
        <p className="text-xs text-stone-600 mt-2">
          <span className="inline-block w-3 border-t-2 border-dashed border-amber-700 mr-1.5 align-middle" />
          {reference.label}, {one(reference.value)} per 1,000 words, checked the same way
        </p>
      )}
    </div>
  );
}

type ShareKey = 'says_what_the_page_says' | 'misleads_somewhere' | 'text_not_on_the_page';
const SHARE_PARTS: { key: ShareKey; label: string; color: string }[] = [
  { key: 'says_what_the_page_says', label: 'Nothing that changes the sense', color: 'bg-stone-800' },
  { key: 'misleads_somewhere', label: 'A word that changes the sense', color: 'bg-amber-300' },
  { key: 'text_not_on_the_page', label: 'Something not on the page', color: 'bg-amber-700' },
];

function ShareLegend() {
  return (
    <p className="text-xs text-stone-600 flex flex-wrap gap-x-4 gap-y-1 mb-3">
      {SHARE_PARTS.map(p => (
        <span key={p.key}><span className={`inline-block w-3 h-3 rounded-sm ${p.color} mr-1.5 align-[-1px]`} />{p.label}</span>
      ))}
    </p>
  );
}

/** One stacked row of page shares, the first segment labelled. */
function ShareRow({ label, sub, r }: { label: string; sub: string; r: Shares }) {
  return (
    <li className="grid grid-cols-[7rem_1fr_3rem] md:grid-cols-[9rem_1fr_3rem] gap-x-3 items-center">
      <span className="text-sm leading-tight">
        <span className="font-semibold text-stone-900">{label}</span>
        <span className="block text-xs text-stone-500">{sub}</span>
      </span>
      <div className="flex h-6 gap-[2px]">
        {SHARE_PARTS.map(p => r[p.key] > 0 && (
          <div key={p.key} className={`${p.color} first:rounded-l-[3px] last:rounded-r-[3px]`} style={{ width: `${r[p.key] * 100}%` }} title={`${label}: ${p.label}, ${pct(r[p.key])}`} />
        ))}
      </div>
      <span className="text-right tabular-nums text-sm font-semibold text-stone-900" title="Pages with nothing that changes the sense">{pct(r.says_what_the_page_says)}</span>
    </li>
  );
}

function Header() {
  return (
    <div className="bg-cream">
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 pt-10 md:pt-14 grid gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12 md:items-end">
        <figure className="order-2 md:order-1">
          <a href={leafHref} className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LEAF.image} alt={LEAF.alt} width={LEAF.width} height={LEAF.height} fetchPriority="high" className="w-full h-auto border border-stone-200" />
          </a>
          <figcaption className="text-sm text-stone-500 mt-3 leading-snug">
            <span className="italic">{LEAF.title}</span>, {LEAF.date}, <A href={leafHref}>page {LEAF.page}</A>.
          </figcaption>
        </figure>
        <div className="order-1 md:order-2 md:pb-10">
          <p className="text-xs uppercase tracking-wider text-stone-500 mb-3">Quality Center</p>
          <h1 className="font-serif text-4xl md:text-5xl tracking-tight text-stone-900 mb-5">How accurate is the text?</h1>
          <p className="font-body text-lg text-stone-700 leading-relaxed mb-3">
            Every transcription here was made by a machine reading the page image. On printed pages, about{' '}
            {n(Math.round(1000 - printPer1k))} words in every 1,000 carry no error that changes the meaning.
          </p>
          <p className="font-body text-lg text-stone-700 leading-relaxed">
            For most books here nobody has typed the text, and what a reader would otherwise have is the Internet
            Archive&rsquo;s machine reading. On pages drawn at random, the same reviewer found about{' '}
            {Math.round(rndArchive.flagged_per_1k)} such errors per 1,000 words in the Archive&rsquo;s text and about{' '}
            {Math.round(rndOurs.flagged_per_1k)} in ours. Where people have typed an edition, ours has no more errors than
            theirs. Every page is shown beside its scan, so you can always check.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── page ── */

export default function QualityCenterPage() {
  const rndMax = Math.ceil(rndArchive.flagged_per_1k_ci95[1] / 5) * 5;
  const twMax = Math.ceil(twArchive.flagged_per_1k_ci95[1] / 5) * 5;
  return (
    <ContentPageLayout header={<><SiteHeader variant="light" /><Header /></>} bg="bg-cream">
      <article className="max-w-3xl font-body text-stone-700 leading-relaxed">
        <Section id="archive" title="Beside the Internet Archive’s OCR">
          <p className="mb-4">
            Many of our books come from the Internet Archive, which publishes its own machine reading with every scan.
            That is what a reader would otherwise have. We drew {rndArchive.n_pages} pages at random from those books,
            English printed between 1800 and 1930, put both readings into the same plain form so the reviewer could not
            tell which was which, and had the same AI reviewer check each against the page image. Meaning-changing errors
            per 1,000 words:
          </p>
          <ul className="mb-3">
            <RateRow label="Internet Archive OCR" sub={`${rndArchive.n_pages} pages, one per book`} rate={rndArchive.flagged_per_1k} ci={rndArchive.flagged_per_1k_ci95} max={rndMax} color="bg-stone-500" />
            <RateRow label="Our transcription" sub="the same pages" rate={rndOurs.flagged_per_1k} ci={rndOurs.flagged_per_1k_ci95} max={rndMax} color="bg-stone-800" />
          </ul>
          <p className="text-sm text-stone-600 mb-2">
            The reviewer found at least one such error on {pct(rndArchive.judge_bad)} of the Archive&rsquo;s pages and{' '}
            {pct(rndOurs.judge_bad)} of ours. Page by page, ours had fewer on {randomPaired.ours_fewer_flags} of{' '}
            {randomPaired.pages} pages and the Archive on {randomPaired.archive_fewer_flags}. The gap is wider on older
            books: on ten random pages each,{' '}
            {RANDOM_OTHER.map((r, i) => (
              <span key={r.lang}>
                {i > 0 && ' and '}
                {r.lang} {one(r.archive.flagged_per_1k)} against {one(r.ours.flagged_per_1k)}
              </span>
            ))}
            , too few pages for a firm figure.
          </p>
          <p className="text-sm text-stone-600">
            The Archive&rsquo;s text was made so that its books can be found and searched; it was never meant to be read as
            the text of the book. Measured {longDate(twDate)}.
          </p>
        </Section>

        <Section id="compared" title="Beside a human-typed edition">
          <p className="mb-4">
            The fairest yardstick for a machine reading is a transcription typed by people. On {twAll[0].n_pages} printed
            pages that also exist in a typed edition, the same reviewer checked all three readings the same way.
            Meaning-changing errors per 1,000 words:
          </p>
          <ul className="mb-3">
            <RateRow label="Internet Archive OCR" sub={`${twArchive.n_pages} pages`} rate={twArchive.flagged_per_1k} ci={twArchive.flagged_per_1k_ci95} max={twMax} color="bg-stone-400" />
            <RateRow label="Typed edition" sub="the same pages, typed by people" rate={twHuman.flagged_per_1k} ci={twHuman.flagged_per_1k_ci95} max={twMax} color="bg-stone-500" />
            <RateRow label="Our transcription" sub="the same pages" rate={twOurs.flagged_per_1k} ci={twOurs.flagged_per_1k_ci95} max={twMax} color="bg-stone-800" />
          </ul>
          <p className="text-sm text-stone-600">
            Typed editions are not free of error either. Beside scholarly editions of the very same printing
            ({scholarly.human.n_pages} pages from DTA, EEBO-TCP and CAMENA) the two are level, {one(scholarly.human.flagged_per_1k)}{' '}
            against our {one(scholarly.ours.flagged_per_1k)}. Wikisource and Project Gutenberg texts often follow another
            printing or tidy the spelling, so they differ from the page more often ({one(wikisource.human.flagged_per_1k)}{' '}
            against our {one(wikisource.ours.flagged_per_1k)}). Books that someone has typed up are often cleaner copies; for
            English of 1800 to 1930 the random pages above were no harder, but early printing is.
          </p>
        </Section>

        <Section id="stands" title="Page by page">
          <p className="mb-4">
            A page is counted clean only if nothing on it changes the sense, so a single misread word on a page of 300
            words moves it down a band. Measured that strictly, this is how the library&rsquo;s pages fall:
          </p>
          <div className="flex h-10 w-full overflow-hidden rounded-sm mb-4" role="img" aria-label={BANDS.map(x => `${x.label}: ${pct(x.share)}`).join('; ')}>
            {BANDS.map(x => (
              <div key={x.key} className={`${x.color} flex items-center justify-center text-sm font-semibold ${x.key === 'word' || x.key === 'slips' ? 'text-stone-900' : 'text-white'}`} style={{ width: `${x.share * 100}%` }}>
                {x.share >= 0.07 ? pct(x.share) : ''}
              </div>
            ))}
          </div>
          <ul className="divide-y divide-stone-200 border-y border-stone-200 mb-5">
            {BANDS.map(x => (
              <li key={x.key} className="py-3 grid grid-cols-[1rem_1fr_auto] gap-x-3 items-baseline">
                <span className={`${x.color} inline-block w-3 h-3 rounded-sm translate-y-0.5`} aria-hidden />
                <div>
                  <div className="font-semibold text-stone-900">{x.label}</div>
                  <div className="text-sm text-stone-600">{x.what}</div>
                </div>
                <div className="text-right tabular-nums font-semibold text-stone-900">{pct(x.share)}</div>
              </li>
            ))}
          </ul>
          <p className="text-sm text-stone-600">
            On {longDate(drawDate)} we drew {n(servedGrades.books)} books at random from the {n(frameBooks)} with a
            transcription, took five pages from each, and had an AI reviewer (Claude Opus) compare each of the{' '}
            {n(servedGrades.pages)} pages with its photograph. Shares are weighted back to the whole library; intervals are
            in <A href={RECORD}>the full record</A>. This measures the transcription, not the English translation.
          </p>
        </Section>

        <Section id="by-language" title="By language">
          <p className="mb-5">
            The script matters more than anything else. English and Russian print come out below the typed-edition rate
            ({one(humanPer1k.per_1k)} per 1,000 words, on easier pages). Latin, German, French, Chinese and Tibetan sit in between. Greek, Sanskrit and Korean have the
            highest rates: the general-purpose models that read them were not built for those scripts, and they are next
            to be read again.
          </p>
          <ChartTitle>Meaning-changing errors per 1,000 words</ChartTitle>
          <RateChart
            rows={WORD_LANGS.map(r => ({ label: r.language, sub: `${r.books} books`, rate: r.severe_per_1k }))}
            max={RATE_MAX}
            reference={{ value: humanPer1k.per_1k, label: 'typed editions' }}
          />
          <ChartTitle>Per 1,000 characters (Chinese, Korean) or syllables (Tibetan)</ChartTitle>
          <RateChart
            rows={OTHER_LANGS.map(r => ({ label: r.language, sub: `${r.books} books, per ${UNIT[r.unit] ?? r.unit}`, rate: r.severe_per_1k }))}
            max={RATE_MAX}
          />
          <p className="text-sm text-stone-600 mt-3 mb-8">
            These count errors, not pages, so a long page with one slip does not look like a wrecked one. A character or a
            syllable is not a word, so the second chart is not on the same footing as the first. A language with three to
            six books is a rough reading, not a rate; Arabic and smaller languages had too few books to show.
          </p>

          <ChartTitle>Share of pages, by what the reviewer found (the number is the first, dark share)</ChartTitle>
          <ShareLegend />
          <ul className="space-y-2 mb-2">
            {[...LANGS].sort((x, y) => y.says_what_the_page_says - x.says_what_the_page_says).map(r => <ShareRow key={r.language} label={r.language} sub={`${r.books} books`} r={r} />)}
          </ul>
        </Section>

        <Section id="by-period" title="By period of printing">
          <p className="mb-5">
            Books printed after 1600 come out alike, with about half to two thirds of pages clean. The earliest books are
            the hardest: on the {PERIOD_ROWS[0]?.books ?? 0} books from before 1500 in the draw, in Greek, Latin, Arabic and
            Chinese, most pages carry something the page does not have.
          </p>
          <ShareLegend />
          <ul className="space-y-2 mb-3">
            {PERIOD_ROWS.map(r => <ShareRow key={r.key} label={r.key} sub={`${r.books} books`} r={r} />)}
          </ul>
          <p className="text-sm text-stone-600 mb-8">
            {PERIOD_UNKNOWN ? `${PERIOD_UNKNOWN.books} of the ${n(servedGrades.books)} books, most of them Chinese and Tibetan, carry no date in our catalogue and are left out of this chart. ` : ''}
            Shares here are of the pages drawn, not weighted back to the library.
          </p>

          <ChartTitle>Print and manuscript</ChartTitle>
          <ShareLegend />
          <ul className="space-y-2 mb-3">
            {SCRIPT_ROWS.map(r => <ShareRow key={r.key} label={r.label} sub={`${r.books} books`} r={r} />)}
          </ul>
          <p className="text-sm text-stone-600">
            By pages the two look alike. Counted by errors, manuscripts carry more: {one(scripts.manuscript?.severe_per_1k ?? 0)}{' '}
            against {one(scripts.print?.severe_per_1k ?? 0)} per 1,000 words or characters. Books whose catalogue record does not
            say which they are are left out.
          </p>
        </Section>

        <Section id="over-time" title="Over time">
          <p>
            This is the first check of its kind, made on {longDate(drawDate)}. We will repeat it every month on a fresh
            draw, and a chart of how the figures move will appear here from the second.
          </p>
        </Section>

        <Section id="what-goes-wrong" title="What goes wrong">
          <p className="mb-4">
            {pct(misreadShare)} of the errors the reviewer found are one kind: a word or character read as another word
            that exists, such as <i>seminis</i> (of seed), printed with a long s, read as <i>feminis</i> (of women). Typed editions make the same kind
            of mistake. Much of the rest is the furniture of an old printed page, running heads, catchwords and note
            numbers, put in the wrong place. Text that is not on the page at all is rarer, and concentrated in the scripts
            with the highest rates. Three examples, each checked by eye against the scan:
          </p>
          <div className="space-y-3">
            {examples.map(e => (
              <div key={`${e.book}-${e.page}`} className="rounded-sm border border-stone-200 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-wider text-stone-500 mb-1.5">{e.language} · {SEVERITY[e.severity] ?? e.severity}</div>
                <p className="font-mono text-sm text-stone-900 mb-1 break-words">{e.quote}</p>
                <p className="text-[0.95rem] text-stone-700">{e.what}</p>
                <p className="text-xs text-stone-500 mt-1.5">
                  <A href={`/book/${e.book}?page=${e.page}`}>{e.title ?? 'the page'}, page {e.page}</A>
                </p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="trust" title="How far to trust these figures">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <b className="text-stone-900">One AI reviewer made every verdict.</b> People have checked only a handful
              of them by eye. It caught every error we planted, but on real pages it both over-flags and misses.
            </li>
            <li>
              <b className="text-stone-900">It over-flags.</b> When a second reviewer re-read its flags, enough fell away to
              raise the share of pages with nothing that changes the sense from{' '}
              {pct(servedGrades.buckets.says_what_the_page_says.share)} to{' '}
              {pct(servedGrades.reread.says_what_the_page_says.share)}.
            </li>
            <li>
              <b className="text-stone-900">It also misses.</b> Against typed editions it caught fewer than half the pages
              with a wrong letter. That is why the comparison above uses the same reviewer for both texts.
            </li>
            <li>
              <b className="text-stone-900">Manuscripts are harder</b> for the reviewer as well as the reader: it agrees with
              human transcribers far less often on handwriting than on print.
            </li>
          </ul>
        </Section>

        <Section id="doing" title="What we are doing">
          <ul className="list-disc pl-5 space-y-2">
            <li>A second model now re-reads transcriptions against the page image, starting with German and French.</li>
            <li>Greek, Sanskrit, Korean and Arabic are next, with readers chosen for each script.</li>
            <li>Pages that are mostly wrong or carry another page&rsquo;s text are withheld as we find them.</li>
            <li>We will repeat this check every month and show here whether the figures move.</li>
          </ul>
        </Section>

        <Section id="take-part" title="Help us improve it">
          <p className="mb-4">
            Readers notice what no measurement catches: a page shifted against its scan, a reversed sentence, a wrong date.
            If a page is wrong, the Feedback button at the foot of that page reaches us.
          </p>
          <ul className="divide-y divide-stone-200 border-y border-stone-200">
            {WAYS.filter(w => !w.planned && w.door).map(w => (
              <li key={w.name} className="py-3 md:grid md:grid-cols-[11rem_1fr] md:gap-x-6">
                <div className="font-semibold text-stone-900">
                  <A href={w.door!.href}>{w.name}</A>
                </div>
                <div className="text-sm text-stone-700">{w.what}</div>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="further" title="The full record">
          <ul className="space-y-2">
            <li><A href={RECORD}>Every measurement</A>: the full grade table, which engine reads which kind of page and why, every experiment, and what readers have reported.</li>
            <li><A href="/quality/pareto">Cost and quality</A>: what it costs to read and translate a page with each engine, and how well.</li>
            <li><A href="/quality/fraktur">Reading Fraktur</A>: German blackletter, engine by engine.</li>
            <li><A href="/research/quality">How page quality is measured</A>: methods and intervals.</li>
            <li><A href="/research/page-errors">What goes wrong on a page</A>: the 44 kinds of error we look for.</li>
          </ul>
          <p className="text-xs text-stone-500 mt-6">
            Text as of {longDate(PROSE_AS_OF)}. Figures are read from the library&rsquo;s data files each time the site is built.
          </p>
        </Section>
      </article>
    </ContentPageLayout>
  );
}
