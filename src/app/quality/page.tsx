import { Metadata } from 'next';
import type { ReactNode } from 'react';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import servedDraw from '../../../scripts/eval/confidence-7866/results/score.json';
import servedGrades from '../../../scripts/eval/confidence-7866/results/served-grades.json';
import judgeCal from '../../../scripts/eval/judge-cal-7866bar-7263/results/score.json';
import { LEAF, leafHref, PROSE_AS_OF, WAYS } from './content';

// The Quality Center (#5918): one question for a reader — how far can I trust the text on a page here,
// and in my language? — answered from the #7866 check of live books against the page images, re-graded
// on the rubric's grades (#7933), and set beside the same reviewer's reading of human-typed scholarly
// editions of the same pages (#7263 human arm). Voice: .claude/docs/quality-statements.md — describe the
// errors, not the work. Everything that audits these figures (the full grade table, the reviewer's measured
// errors, which engine reads which page, every experiment, what readers reported) is on /quality/record.
// Every number here is read at build time from committed files.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Quality Center | Source Library',
  description:
    'How accurate the transcriptions in Source Library are: errors per 1,000 words beside human-typed scholarly editions of the same pages, page by page and language by language, what goes wrong, and how to check a page yourself.',
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

/** Meaning-changing errors per 1,000 words across the library's printed pages (#7866 draw, re-graded #7933). */
const printPer1k = servedGrades.by_script.print.severe_per_1k;

/** The same reviewer on 60 printed pages that also exist as human-typed scholarly editions (#7263). */
const human = judgeCal.human_arm;
const humanPer1k = human.flagged_per_1k;
const oursSamePages = human.machine_same_pages.judge_proxy;
const humanJudgedOff = human.judge_bad.split('/').map(Number) as [number, number];

/** Five bands, each describing the page; the reader's advice is the second line. */
const serious = ['from_elsewhere', 'mostly_wrong', 'not_this_page'].reduce((a, k) => a + g[k].share, 0);
const BANDS = [
  { key: 'clean', label: 'Clean', what: 'No error, or one or two slips that change nothing. Quote it.', share: g.fit_to_quote.share, color: 'bg-stone-800' },
  { key: 'slips', label: 'Small slips only', what: 'Several slips, such as a running head out of place; none changes the sense.', share: g.fit_to_read.share, color: 'bg-stone-500' },
  { key: 'word', label: 'A word that changes the sense', what: 'Usually one misread word in an otherwise sound page. Check the scan before quoting.', share: g.search_only.share, color: 'bg-amber-300' },
  { key: 'span', label: 'A word, number or line differs from the page', what: 'Something dropped or not on the page. Check the scan before quoting.', share: g.wrong_span.share, color: 'bg-amber-500' },
  { key: 'serious', label: 'Mostly wrong, or another page’s text', what: 'Do not rely on these pages; we withhold them as we find them.', share: serious, color: 'bg-amber-800' },
];

/** Languages with at least three books in the draw, fewest errors first. */
const LANGS = servedGrades.by_language
  .filter(r => r.books >= 3)
  .sort((x, y) => x.severe_per_1k - y.severe_per_1k);
const UNIT: Record<string, string> = { words: 'words', 'Han characters': 'characters', syllables: 'syllables' };

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
function RateRow({ label, sub, rate, ci, max, color }: { label: string; sub: string; rate: number; ci: number[]; max: number; color: string }) {
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
        <span className="font-semibold text-stone-900">{one(rate)}</span>
        <span className="block text-xs text-stone-500">{one(ci[0])}–{one(ci[1])}</span>
      </span>
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
            Typed scholarly editions are not error-free either. On pages where both exist, the same check found{' '}
            {one(oursSamePages.per_1k)} such errors per 1,000 words in our text and {one(humanPer1k.per_1k)} in the edition
            typed by people. Every page is shown beside its scan, so you can always check.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── page ── */

export default function QualityCenterPage() {
  const max = Math.ceil(Math.max(humanPer1k.ci95[1], oursSamePages.ci95[1], printPer1k) + 0.5);
  return (
    <ContentPageLayout header={<><SiteHeader variant="light" /><Header /></>} bg="bg-cream">
      <article className="max-w-3xl font-body text-stone-700 leading-relaxed">
        <Section id="compared" title="Beside a human-typed edition">
          <p className="mb-4">
            The fairest yardstick for a machine transcription is a transcription typed by people. We took{' '}
            {human.pages} printed pages that also exist in typed scholarly editions and had the same AI reviewer check
            both against the page image. Meaning-changing errors per 1,000 words:
          </p>
          <ul className="mb-3">
            <RateRow label="Typed scholarly edition" sub={`${human.pages} pages, typed by people`} rate={humanPer1k.per_1k} ci={humanPer1k.ci95} max={max} color="bg-stone-500" />
            <RateRow label="Our transcription" sub="the same pages" rate={oursSamePages.per_1k} ci={oursSamePages.ci95} max={max} color="bg-stone-800" />
          </ul>
          <p className="text-sm text-stone-600">
            The reviewer found at least one such error on {humanJudgedOff[0]} of the {humanJudgedOff[1]} typed pages. The
            ranges are 95% intervals and overlap: on these pages the two cannot be told apart. They are cleaner than the
            library as a whole: across every script, printed pages average {one(printPer1k)} per 1,000 words.
          </p>
        </Section>

        <Section id="stands" title="Page by page">
          <p className="mb-4">
            A page is counted clean only if nothing on it changes the sense, so a single misread word on a page of 300
            words moves it down a band. Measured that strictly, this is how the library&rsquo;s pages fall:
          </p>
          <div className="flex h-10 w-full overflow-hidden rounded-sm mb-4" role="img" aria-label={BANDS.map(x => `${x.label}: ${pct(x.share)}`).join('; ')}>
            {BANDS.map(x => (
              <div key={x.key} className={`${x.color} flex items-center justify-center text-sm font-semibold ${x.key === 'word' || x.key === 'span' ? 'text-stone-900' : 'text-white'}`} style={{ width: `${x.share * 100}%` }}>
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
            The script matters more than anything else. English and Russian print come out below the rate of the typed
            editions above. Latin, German, French, Chinese and Tibetan sit in between. Greek, Sanskrit and Korean have the
            highest rates: the general-purpose models that read them were not built for those scripts, and they are next
            to be read again.
          </p>
          <ul className="space-y-3 mb-4">
            {LANGS.map(r => (
              <li key={r.language} className="grid grid-cols-[6.5rem_1fr_5.5rem] md:grid-cols-[8rem_1fr_6.5rem] gap-x-3 items-center">
                <span className="text-stone-900 font-semibold text-sm">
                  {r.language}
                  <span className="block text-xs font-normal text-stone-500">{r.books} books</span>
                </span>
                <div className="flex h-5 overflow-hidden rounded-sm bg-stone-200" aria-hidden>
                  <div className="bg-stone-800" style={{ width: `${r.says_what_the_page_says * 100}%` }} />
                  <div className="bg-amber-300" style={{ width: `${r.misleads_somewhere * 100}%` }} />
                  <div className="bg-amber-600" style={{ width: `${r.text_not_on_the_page * 100}%` }} />
                </div>
                <span className="text-right tabular-nums text-sm">
                  <span className="font-semibold text-stone-900">{one(r.severe_per_1k)}</span>
                  <span className="block text-xs text-stone-500">per 1,000 {UNIT[r.unit] ?? r.unit}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-stone-600 flex flex-wrap gap-x-4 gap-y-1">
            <span><span className="inline-block w-3 h-3 rounded-sm bg-stone-800 mr-1.5 align-[-1px]" />Pages with nothing that changes the sense</span>
            <span><span className="inline-block w-3 h-3 rounded-sm bg-amber-300 mr-1.5 align-[-1px]" />A word that changes the sense</span>
            <span><span className="inline-block w-3 h-3 rounded-sm bg-amber-600 mr-1.5 align-[-1px]" />Something not on the page</span>
          </p>
          <p className="text-sm text-stone-600 mt-3">
            The number on the right counts errors, not pages, so a long page with one slip does not look like a wrecked
            one. Characters and syllables are not comparable with words. A language with three to six books is a rough
            reading, not a rate; Arabic and smaller languages had too few books to show.
          </p>
        </Section>

        <Section id="what-goes-wrong" title="What goes wrong">
          <p className="mb-4">
            {pct(misreadShare)} of the errors the reviewer found are one kind: a word or character read as another word
            that exists, such as <i>feminis</i> (of women) for <i>ſeminis</i> (of seed). Typed editions make the same kind
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
