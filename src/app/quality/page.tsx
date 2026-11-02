import { Metadata } from 'next';
import type { ReactNode } from 'react';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import servedDraw from '../../../scripts/eval/confidence-7866/results/score.json';
import servedGrades from '../../../scripts/eval/confidence-7866/results/served-grades.json';
import { LEAF, leafHref, PROSE_AS_OF, WAYS } from './content';

// The Quality Center (#5918): one question for a reader — how far can I trust the text on a page here,
// and in my language? — answered from the #7866 check of live books against the page images, re-graded
// on the rubric's four grades (#7933). Everything that audits that answer (the full grade table, the
// reviewer's measured errors, which engine reads which page, every experiment, what readers reported)
// is on /quality/record. Every number here is read at build time from committed files.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Quality Center | Source Library',
  description:
    'How good the transcriptions in Source Library are: what share of pages you can quote, read, or only search by, language by language, what goes wrong, and how to check a page yourself.',
  alternates: { canonical: '/quality' },
};

const RECORD = '/quality/record';
const pct = (v: number) => `${Math.round(v * 100)}%`;
const n = (v: number) => v.toLocaleString('en-US');
const longDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/* ── data ── */

type Grade = { pages: number; share: number; ci95: number[] };
const g = servedGrades.grades as Record<string, Grade>;
const b = servedGrades.buckets as Record<string, Grade>;
const frameBooks = Object.values(servedDraw.corpus.frame_books).reduce((a, x) => a + x, 0);
const drawDate = servedDraw.generated_at.slice(0, 10);

/** Four grades, as a reader would use them. The rubric's "not usable" is one band here; /quality/record splits it. */
const BANDS = [
  { key: 'quote', label: 'Quote it', what: 'No error, or one or two small slips that mislead no one.', share: g.fit_to_quote.share, ci: g.fit_to_quote.ci95, color: 'bg-stone-800' },
  { key: 'read', label: 'Read it, check before quoting', what: 'Several small slips, none of which changes the sense.', share: g.fit_to_read.share, ci: g.fit_to_read.ci95, color: 'bg-stone-500' },
  { key: 'search', label: 'Search by it, check the scan', what: 'At least one misread word that changes the sense.', share: g.search_only.share, ci: g.search_only.ci95, color: 'bg-amber-400' },
  { key: 'no', label: 'Do not rely on it', what: 'Words, numbers or whole lines the page does not carry, or another page’s text.', share: b.text_not_on_the_page.share, ci: b.text_not_on_the_page.ci95, color: 'bg-amber-700' },
];

/** Languages with at least three books in the draw, best first. */
const LANGS = servedGrades.by_language
  .filter(r => r.books >= 3)
  .sort((x, y) => y.says_what_the_page_says - x.says_what_the_page_says);

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
  wrong_text: 'Text the page does not carry',
  misleads: 'Changes the sense',
  cosmetic: 'Misleads no one',
};
const examples = EXAMPLE_PICKS.map(([k, prefix]) => {
  const c = servedGrades.defect_classes.find(x => x.class === k);
  const e = c?.examples.find(x => x.quote.startsWith(prefix));
  return e ?? null;
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
          <h1 className="font-serif text-4xl md:text-5xl tracking-tight text-stone-900 mb-5">How far can you trust the text?</h1>
          <p className="font-body text-lg text-stone-700 leading-relaxed">
            Every transcription here was made by a machine reading the page image. About half the pages say exactly what
            the scan says. Most of the rest have a misread word or two; some have text the page does not carry. Every page
            is shown beside its scan, so you can always check.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── page ── */

export default function QualityCenterPage() {
  return (
    <ContentPageLayout header={<><SiteHeader variant="light" /><Header /></>} bg="bg-cream">
      <article className="max-w-3xl font-body text-stone-700 leading-relaxed">
        <Section id="stands" title="What a page is fit for">
          <div className="flex h-10 w-full overflow-hidden rounded-sm mb-4" role="img" aria-label={BANDS.map(x => `${x.label}: ${pct(x.share)}`).join('; ')}>
            {BANDS.map(x => (
              <div key={x.key} className={`${x.color} flex items-center justify-center text-sm font-semibold ${x.key === 'search' ? 'text-stone-900' : 'text-white'}`} style={{ width: `${x.share * 100}%` }}>
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
                <div className="text-right tabular-nums">
                  <div className="font-semibold text-stone-900">{pct(x.share)}</div>
                  <div className="text-xs text-stone-500">{pct(x.ci[0])}–{pct(x.ci[1])}</div>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-sm text-stone-600">
            On {longDate(drawDate)} we drew {n(servedGrades.books)} books at random from the {n(frameBooks)} with a
            transcription, took five pages from each, and had an AI reviewer (Claude Opus) compare each of the{' '}
            {n(servedGrades.pages)} pages with its photograph. Shares are weighted back to the whole library; the small
            figures are 95% intervals. This measures the transcription, not the English translation.
          </p>
        </Section>

        <Section id="by-language" title="By language">
          <p className="mb-5">
            Quality depends mostly on the script. English and Russian print is largely clean. Latin, German, French,
            Chinese and Tibetan sit in the middle. Greek, Sanskrit and Korean are poor: the general-purpose models that
            read them were never good at those scripts, and they are first in line to be read again.
          </p>
          <ul className="space-y-3 mb-4">
            {LANGS.map(r => (
              <li key={r.language} className="grid grid-cols-[6.5rem_1fr_3rem] md:grid-cols-[8rem_1fr_3.5rem] gap-x-3 items-center">
                <span className="text-stone-900 font-semibold text-sm">
                  {r.language}
                  <span className="block text-xs font-normal text-stone-500">{r.books} books</span>
                </span>
                <div className="flex h-5 overflow-hidden rounded-sm bg-stone-200" aria-hidden>
                  <div className="bg-stone-800" style={{ width: `${r.says_what_the_page_says * 100}%` }} />
                  <div className="bg-amber-400" style={{ width: `${r.misleads_somewhere * 100}%` }} />
                  <div className="bg-amber-700" style={{ width: `${r.text_not_on_the_page * 100}%` }} />
                </div>
                <span className="text-right tabular-nums font-semibold text-stone-900 text-sm">{pct(r.says_what_the_page_says)}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-stone-600 flex flex-wrap gap-x-4 gap-y-1">
            <span><span className="inline-block w-3 h-3 rounded-sm bg-stone-800 mr-1.5 align-[-1px]" />Says what the page says</span>
            <span><span className="inline-block w-3 h-3 rounded-sm bg-amber-400 mr-1.5 align-[-1px]" />A word that changes the sense</span>
            <span><span className="inline-block w-3 h-3 rounded-sm bg-amber-700 mr-1.5 align-[-1px]" />Text the page does not carry</span>
          </p>
          <p className="text-sm text-stone-600 mt-3">
            A language with three to six books in the draw is a rough reading, not a rate. Arabic and smaller languages had
            too few books to show.
          </p>
        </Section>

        <Section id="what-goes-wrong" title="What goes wrong">
          <p className="mb-4">
            {pct(misreadShare)} of the errors the reviewer found are one kind: a word or character read as another word
            that exists, such as <i>feminis</i> (of women) for <i>ſeminis</i> (of seed). Much of the rest is the furniture of
            an old printed page, running heads, catchwords and note numbers, put in the wrong place. Invented text is rarer
            and concentrated in the poorly read scripts. Three real examples, each checked by eye against the scan:
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
              <b className="text-stone-900">One AI reviewer made every verdict.</b> No person has checked them beyond spot
              checks. It catches all the planted errors we test it with, but on real pages it both over-flags and misses.
            </li>
            <li>
              <b className="text-stone-900">It over-flags.</b> When a second reviewer re-read its flags, enough fell away to
              raise the share that says what the page says from {pct(b.says_what_the_page_says.share)} to{' '}
              {pct(servedGrades.reread.says_what_the_page_says.share)}.
            </li>
            <li>
              <b className="text-stone-900">It also misses.</b> Against typed scholarly editions it catches fewer than half
              the pages with any wrong letter. On print, our machine reading carries about 2 to 3 meaning-changing errors
              per 1,000 words; a typed scholarly edition of the same pages carries about 1.5.
            </li>
            <li>
              <b className="text-stone-900">It is weakest on manuscripts</b>, where it agrees with human transcribers far
              less than on print.
            </li>
          </ul>
        </Section>

        <Section id="doing" title="What we are doing about it">
          <ul className="list-disc pl-5 space-y-2">
            <li>A stronger model now re-reads weak transcriptions against the page image, starting with German and French.</li>
            <li>Greek, Sanskrit, Korean and Arabic are next, with readers chosen for each script.</li>
            <li>We will repeat this check every month and show here whether the shares move.</li>
          </ul>
        </Section>

        <Section id="take-part" title="Help us fix it">
          <p className="mb-4">
            Readers find what no measurement catches: a page shifted against its scan, a reversed sentence, a wrong date.
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
