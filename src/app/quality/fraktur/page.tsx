import { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import BarChart, { type BarRow } from '@/app/articles/training-our-own-models/BarChart';
import { CER_5660, CER_7818, DRAW_7701, DTA_6012, LEAF, PASS_7818, RECORDS } from './data';

// Where reading German blackletter (Fraktur) stands (#7818; Derek 2026-10-31: "can you explain the state of the Fraktur
// quality? maybe I need some visuals or context or a chart"). The reader: Derek, or a scholar deciding whether to quote a
// German page of ours. So the page opens with the type itself, on one of our leaves, then three charts (which engines
// read it, how many characters they get wrong, what the correction pass changes), then what nobody has measured yet.
// Every figure is in ./data.ts beside the record it comes from; the prose follows .claude/docs/quality-statements.md.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Reading Fraktur: Where It Stands | Source Library',
  description:
    'How well Source Library reads German blackletter (Fraktur): which engines can read it, how many characters they get wrong against human transcriptions, what our correction pass changes, and what has not been measured yet.',
  alternates: { canonical: '/quality/fraktur' },
};

const GH = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/';
const BLOB = `${GH}blob/main/`;
const LINK = 'text-amber-800 underline decoration-amber-800/30 underline-offset-2 hover:decoration-amber-800';
const leafHref = `/book/${LEAF.bookId}?page=${LEAF.page}`;

function A({ href, children }: { href: string; children: ReactNode }) {
  return href.startsWith('/') ? <Link href={href} className={LINK}>{children}</Link> : <a href={href} className={LINK}>{children}</a>;
}

function Issue({ n }: { n: number }) {
  return <a href={`${GH}issues/${n}`} className={`${LINK} font-mono whitespace-nowrap`}>#{n}</a>;
}

function Rec({ path, children }: { path: string; children: ReactNode }) {
  return <A href={`${BLOB}${path}`}>{children}</A>;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-14 scroll-mt-24 max-w-3xl">
      <h2 className="font-serif text-2xl md:text-3xl text-stone-900 mb-4 border-t border-stone-300 pt-5 text-balance">{title}</h2>
      <div className="space-y-4 text-stone-700 leading-relaxed">{children}</div>
    </section>
  );
}

type Box = { x: number; y: number; w: number; h: number };

/** A region of the leaf, cut from the same image by CSS (the Crop of /quality, on this page's leaf). */
function Crop({ box, alt, className = '' }: { box: Box; alt: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-[#e9dcc4] border border-stone-200 ${className}`} style={{ aspectRatio: `${box.w} / ${box.h}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={LEAF.image}
        alt={alt}
        loading="lazy"
        className="absolute max-w-none"
        style={{ width: `${(LEAF.width / box.w) * 100}%`, left: `${(-box.x / box.w) * 100}%`, top: `${(-box.y / box.h) * 100}%` }}
      />
    </div>
  );
}

/** Wilson 95% interval for k of n, in percent. */
function wilson(k: number, n: number): [number, number] {
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [100 * Math.max(0, c - h), 100 * Math.min(1, c + h)];
}

function share(k: number, n: number, label: string, strong = false): BarRow {
  const [lo, hi] = wilson(k, n);
  return { label, v: (100 * k) / n, lo, hi, note: `${k} of ${n} pages`, strong };
}

const num = (n: number) => n.toLocaleString('en-US');

const FACE_ROWS: BarRow[] = DRAW_7701.engines.flatMap((e) => {
  const rows = [share(e.fraktur[0], e.fraktur[1], `${e.engine} · Fraktur`, true)];
  if (e.antiqua) rows.push(share(e.antiqua[0], e.antiqua[1], `${e.engine} · Antiqua`));
  return rows;
});

const CER_ROWS: BarRow[] = CER_5660.rows.map((r) => ({ label: r.engine, v: r.cer, strong: 'strong' in r && r.strong }));

const CER_PASS_ROWS: BarRow[] = CER_7818.rows.map((r) => ({
  label: r.engine,
  v: r.cer,
  note: `accepted by the AI reviewer on ${r.accepted} of ${CER_7818.pages}`,
  strong: 'strong' in r && r.strong,
}));

const P = PASS_7818;
const PASS_ROWS: BarRow[] = [
  { label: 'Flash-Lite draft', v: (100 * P.accepted.draft) / P.pages, lo: P.accepted.draftCi[0], hi: P.accepted.draftCi[1], note: `${P.accepted.draft} of ${P.pages} pages` },
  { label: 'After the correction pass (served)', v: (100 * P.accepted.served) / P.pages, lo: P.accepted.servedCi[0], hi: P.accepted.servedCi[1], note: `${P.accepted.served} of ${P.pages} pages`, strong: true },
];
const WRONG_ROWS: BarRow[] = [
  { label: 'Flash-Lite draft', v: (100 * P.wrongText.draft) / P.pages, note: `${P.wrongText.draft} of ${P.pages} pages` },
  { label: 'After the correction pass (served)', v: (100 * P.wrongText.served) / P.pages, note: `${P.wrongText.served} of ${P.pages} pages`, strong: true },
];

const CROPS: { box: Box; alt: string; caption: ReactNode; className?: string }[] = [
  {
    box: LEAF.crops.head,
    alt: 'The running head: Chymische in roman type, Hochzeit in blackletter.',
    caption: <>Two faces in one running head: <em>Chymiſche</em> in roman type, <em>Hochzeit</em> in Fraktur.</>,
  },
  {
    box: LEAF.crops.umlaut,
    alt: 'A line of blackletter: sten wir die Jungen Königlichen Personen den, with a small e printed above the o of Königlichen.',
    caption: <>The umlaut is a small <em>e</em> printed above the vowel: the <em>ö</em> of <em>Königlichen</em> is an <em>o</em> with an <em>e</em> over it. The long s stands in <em>Perſonen</em>, and <em>ch</em> is one piece of type.</>,
  },
  {
    box: LEAF.crops.longS,
    alt: 'A line of blackletter: sie bald auß dem Gesicht verlohren, doch war man.',
    caption: <>The long s (<em>ſie</em>, <em>Geſicht</em>) is an <em>f</em> without the full crossbar; beside it the <em>ß</em> of <em>auß</em>. Word spacing is uneven and words run together.</>,
  },
  {
    box: LEAF.crops.margin,
    className: 'max-w-[12rem]',
    alt: 'A marginal note in italic: Custos senex.',
    caption: <>Latin is set in italic Antiqua, here a marginal note, <em>Cuſtos ſenex</em> (&ldquo;the old guardian&rdquo;).</>,
  },
];

export default function FrakturPage() {
  const F = DRAW_7701.frame;
  return (
    <ContentPageLayout header={<SiteHeader variant="light" />} bg="bg-cream" maxWidth="wide">
      {/* Exempt from the site's scroll reveal, as on /quality/pareto (#6217). */}
      <div data-reveal-skip="">
        <header className="max-w-3xl">
          <p className="text-sm uppercase tracking-wider text-stone-600">
            <Link href="/quality" className="hover:text-amber-800">Quality Center</Link>
          </p>
          <h1 className="font-serif text-4xl md:text-5xl text-stone-900 mt-2">Reading Fraktur: where it stands</h1>
          <p className="text-lg text-stone-700 leading-relaxed mt-4">
            Into the nineteenth century most German books were printed in Fraktur, a blackletter type. Gemini reads it:
            against human transcriptions it got 0.5% to 1.5% of characters wrong (two sets, 29 and 40 pages), and the
            engine that now reads new German pages was accepted by an AI reviewer on 13 of 15 Fraktur pages. The three
            open engines we tested the same way on our own machines were accepted on at most 3 of 18 Fraktur pages, though one of them read
            roman type well. What we cannot yet say is how often the long s, the umlaut and the old spellings come through
            exactly as printed.
          </p>
          <p className="text-base text-stone-600 mt-3">
            <a href="#what" className={LINK}>The type</a> {'·'} <a href="#engines" className={LINK}>Which engines read it</a>{' '}
            {'·'} <a href="#errors" className={LINK}>Characters wrong</a> {'·'} <a href="#correction" className={LINK}>The correction pass</a>{' '}
            {'·'} <a href="#unknown" className={LINK}>Not yet measured</a>
          </p>
          <p className="text-xs text-stone-500 mt-4">
            Text as of 31 October 2026. Every figure links to the record of the test it comes from.
          </p>
        </header>

        <section id="what" className="mt-10 scroll-mt-24">
          <h2 className="font-serif text-2xl md:text-3xl text-stone-900 mb-4 border-t border-stone-300 pt-5 max-w-3xl">What Fraktur is, and why a machine misreads it</h2>
          <div className="grid gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12 items-start">
            <figure>
              <a href={leafHref} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={LEAF.image} alt={LEAF.alt} width={LEAF.width} height={LEAF.height} className="w-full h-auto border border-stone-200" />
              </a>
              <figcaption className="text-sm text-stone-500 mt-3 leading-snug">
                {LEAF.author}, <A href={leafHref}><em>{LEAF.title}</em></A>, {LEAF.date}, page {LEAF.printed}. Copy:{' '}
                {LEAF.copy}.
              </figcaption>
            </figure>
            <div className="space-y-5 text-stone-700 leading-relaxed">
              <p>
                Fraktur is the broken blackletter in which most German was printed from the sixteenth century into the
                nineteenth. Its letters differ from roman type in ways that matter to a machine: the long s (ſ) next to
                the round s, a round r (ꝛ) after bowed letters, joined letters such as <em>ch</em>, <em>ck</em> and{' '}
                <em>tz</em>, umlauts printed as a small <em>e</em> above the vowel, and capitals that look little like their
                roman forms. Latin and foreign words inside a German text are set in roman (Antiqua), so one line can hold
                two alphabets. These details are all on one page of our 1616 <em>Chymische Hochzeit</em>:
              </p>
              <ul className="space-y-4">
                {CROPS.map((c) => (
                  <li key={c.alt}>
                    <Crop box={c.box} alt={c.alt} className={c.className} />
                    <p className="text-sm text-stone-600 mt-1.5 leading-snug">{c.caption}</p>
                  </li>
                ))}
              </ul>
              <p>
                Our transcription of this page writes the long s as <em>s</em> and the e-umlaut as <em>ö</em>: &ldquo;musten
                wir die Jungen Königlichen Personen den&rdquo;. That is a modernised reading of the letters, not a
                diplomatic one, and the tests below score it the same way.
              </p>
              <p>
                How much of our German is Fraktur has not been counted across the library. In one random draw on{' '}
                30 October 2026, one page from each of {F.books} German books not yet transcribed, {F.fraktur} pages
                were Fraktur, {F.antiqua} were Antiqua and {F.other} were blank, plates or other (
                <Rec path={RECORDS.draw7701}>record</Rec>).
              </p>
            </div>
          </div>
        </section>

        <Section id="engines" title="Which engines can read it">
          <p>
            On 30 October 2026 we gave the same 18 Fraktur pages and 12 Antiqua pages, from 30 different German books, to
            four engines (<Issue n={DRAW_7701.issue} />). Claude Opus, an AI reviewer, saw each page image beside each text,
            without being told which engine wrote it, and accepted a text when a reader would be served by publishing it as
            that page: every line, in order, the right words and numerals, with spelling conventions set aside.
          </p>
          <BarChart
            rows={FACE_ROWS}
            max={100}
            ticks={[0, 25, 50, 75, 100]}
            unit="%"
            decimals={0}
            title="Pages accepted, Fraktur against Antiqua, same pages for every engine"
            hint="Each engine alone, with no correction pass. Gold bars are Fraktur pages, grey bars Antiqua. Whiskers are 95% intervals; with 9 to 18 pages a bar, they are wide. Hover, tap or tab to a row for the figure."
            measure="of pages accepted by the AI reviewer"
            source={
              <>
                Opus judge, blind, 30 October 2026; 16 wrong-page controls all refused and 4 of 4 planted errors caught.
                Gemini wrote 15 of the 18 Fraktur and 9 of the 12 Antiqua pages (the rest were in blocks cut short), so its
                bars count the pages it wrote. Kraken was run on Fraktur only. Record:{' '}
                <Rec path={RECORDS.draw7701}>2026-10-30-german-cheaper-first-reads-7701.md</Rec>.
              </>
            }
          />
          <p>
            Fraktur is what separates the engines. Gemini 3.8 Flash, which reads the German pages we have not yet
            transcribed, was accepted on 13 of the 15 Fraktur pages it wrote, with no page carrying words the page does not
            print. On Antiqua, LightOnOCR, a small open model, was accepted on 11 of 12; on Fraktur, on 2 of 18, and 10 of
            its Fraktur pages had wrong words. PERO-OCR was accepted on 3 of 18 Fraktur pages, and a Kraken model trained
            on Fraktur newspapers on none of 18, with wrong text on 17.
          </p>
          <p>
            The errors of the open engines are mostly real German words in place of the printed ones, which a reader cannot
            catch without the scan: <em>Sarge</em> read as <em>Garge</em>, <em>Kotzen</em> (vomiting) as <em>Kosen</em>, the
            Kraken model&rsquo;s <em>zehen gepot halte</em> as <em>zelen gexotbalee</em>. PERO read the recipe sign ℞ as
            &ldquo;3&rdquo; or &ldquo;12&rdquo;, which looks like a quantity. Gemini&rsquo;s Fraktur pages carried no wrong
            text in this test. In an earlier one, on 20 Fraktur pages from 5 books read four ways, it was judged usable on
            20 of 20 in two runs and 19 of 20 in the other two; the one miss was <em>Leyter</em> read as <em>Leyer</em>{' '}
            (<Rec path={RECORDS.perCall7522}>record, 27 October</Rec>).
          </p>
          <p>
            With 15 to 18 pages a bar, these figures separate an engine that reads Fraktur from one that does not. They
            cannot tell apart two engines that both read it well.
          </p>
        </Section>

        <Section id="errors" title="How many characters are wrong">
          <p>
            Acceptance is a judgement. Character error is a count: the share of characters that differ from a person&rsquo;s
            typed transcription of the same page. We have two such sets for German, both from Wikisource, a volunteer
            library that transcribes and proofreads old prints. Neither is our own books, and both were mostly Fraktur.
          </p>
          <BarChart
            rows={CER_ROWS}
            max={6}
            ticks={[0, 2, 4, 6]}
            unit="%"
            decimals={1}
            title={`Median character error on ${CER_5660.pages} German pages (${CER_5660.fraktur} Fraktur), same pages for every engine`}
            hint="Shorter is better. Hover, tap or tab to a row for the figure."
            measure="of characters differ from the typed transcription (median page)"
            source={
              <>
                {CER_5660.dates}, one page per book (<Issue n={CER_5660.issue} />). Kraken&rsquo;s generic print model scored{' '}
                {CER_5660.krakenGeneric.toFixed(1)}% on the same pages and is off this scale. Records:{' '}
                <Rec path={RECORDS.paddle5660}>2026-10-03-open-engine-print-5660.md</Rec>,{' '}
                <Rec path={RECORDS.bakeoff5660}>2026-10-04-ocr-bakeoff-round-3-5660.md</Rec>.
              </>
            }
          />
          <div className="h-2" />
          <BarChart
            rows={CER_PASS_ROWS}
            max={10}
            ticks={[0, 2.5, 5, 7.5, 10]}
            unit="%"
            decimals={1}
            title={`Average character error on ${CER_7818.pages} proofread German Wikisource pages, 1500–1850, before and after the correction pass`}
            hint="Shorter is better. Mostly Fraktur; the typeface was not recorded page by page. Hover, tap or tab to a row for the figure."
            measure="of characters differ from the proofread transcription (average page)"
            source={
              <>
                31 October 2026 (<Issue n={CER_7818.issue} />). PERO&rsquo;s median page was {CER_7818.peroMedian}%; a few pages it
                failed raise its average. Record: <Rec path={RECORDS.correction7818}>2026-10-31-correction-pass-paired-7818.md</Rec>.
              </>
            }
          />
          <p>
            Gemini Flash-Lite, the engine that read much of the German already in the library, had a median of 0.5% of
            characters wrong on the first set, the lowest of the eight engines. On the second set its average was 1.5%, and
            the correction pass described below brought it to 1.1% (a difference of 0.4 points, 95% interval 0.2 to 0.6).
            The same pass, run over PERO&rsquo;s reading, brought PERO from 8.8% to 1.4%.
          </p>
          <p>
            <strong className="text-stone-900">What these numbers leave out.</strong> The Wikisource transcriptions modernise
            the letters: none of the 40 German pages had a single long s. So the scoring folds the long s into s, and also
            case, accents, u and v, i and j, and punctuation. A figure of 1% therefore counts wrong and missing words and
            letters; it does not count a long s printed as s, or an e-umlaut printed as ö. Character error and the
            reviewer can also disagree: PERO&rsquo;s median page was 1.9% wrong, yet the reviewer accepted only 6 of its 40
            pages, because a few wrong words in the wrong place make a page unfit to quote.
          </p>
        </Section>

        <Section id="correction" title="What the correction pass does on the pages we serve">
          <p>
            Much of the German in the library was first read by Gemini Flash-Lite. A second pass gives Gemini 3.8 Flash the page
            image and that draft and asks it to correct the draft. By 30 October the pass had processed{' '}
            {num(P.frame.pages)} German pages in {P.frame.books} books. To see what it changed, we drew one of those pages
            from each of {P.pages} books at random and had the same AI reviewer judge the draft and the served text, blind
            and shuffled (<Issue n={P.issue} />, 31 October 2026).
          </p>
          <div className="space-y-4">
            <BarChart
              rows={PASS_ROWS}
              max={100}
              ticks={[0, 50, 100]}
              unit="%"
              decimals={0}
              title={`Pages accepted, ${P.pages} German pages`}
              hint="Whiskers are 95% intervals."
              measure="of pages accepted by the AI reviewer"
              source={<>Same pages, judged blind. Record: <Rec path={RECORDS.correction7818}>correction-pass-paired-7818</Rec>.</>}
            />
            <BarChart
              rows={WRONG_ROWS}
              max={100}
              ticks={[0, 50, 100]}
              unit="%"
              decimals={0}
              title={`Pages with wrong text, ${P.pages} German pages`}
              hint="Wrong text: words or numbers the page does not print. Shorter is better."
              measure="of pages where the reviewer found wrong text"
              source={<>Same pages, judged blind. Record: <Rec path={RECORDS.correction7818}>correction-pass-paired-7818</Rec>.</>}
            />
          </div>
          <p>
            Acceptance rose from {P.accepted.draft} to {P.accepted.served} of {P.pages} pages, {P.effect.points} points
            (95% interval {P.effect.lo} to {P.effect.hi}). The pass made {P.effect.gained} pages acceptable and made none
            worse. Pages with wrong text halved, from {P.wrongText.draft} to {P.wrongText.served}.
          </p>
          <p>
            So on these books one page in four still was not accepted after the pass, and about one in eight had at least
            one wrong word or number. These are German books of every period; whether each page was Fraktur or Antiqua is
            not recorded on our books, so this figure is not split by typeface.
          </p>
        </Section>

        <Section id="unknown" title="What we do not know yet">
          <ul className="list-disc pl-5 space-y-3">
            <li>
              <strong className="text-stone-900">A letter-exact score.</strong> No test has yet counted whether the long
              s, the e-umlaut, the round r and the period spellings come through as printed, because every German reference
              we scored against modernises them. The Deutsches Textarchiv has typed {DTA_6012.books} of the German books
              we hold, in the same edition, with the long s and the printed spellings kept: {num(DTA_6012.pages)} pages, aligned page by page in
              October (<Rec path={RECORDS.dta6012}>record</Rec>, <Issue n={DTA_6012.issue} />). They have not yet been used
              to score our Fraktur.
            </li>
            <li>
              <strong className="text-stone-900">How much of the library is Fraktur.</strong> Only the one draw above (
              {F.fraktur} of {F.books} pages). The typeface is not recorded on our books, so no figure on this page can yet
              be split by it across the library.
            </li>
            <li>
              <strong className="text-stone-900">Small samples.</strong> The character-error figures rest on 29 and 40
              pages, and the engine comparison on 18 Fraktur pages. Apart from the Wikisource transcriptions, which
              volunteers proofread, no person has checked these readings: every acceptance figure here is an AI
              reviewer&rsquo;s.
            </li>
            <li>
              <strong className="text-stone-900">What comes next.</strong> The engine comparison names its next test:
              LightOnOCR alone on at least 30 Antiqua pages, since 12 is too few to rely on (<Issue n={DRAW_7701.issue} />).
              Measuring the error in the human references themselves is <Issue n={6552} />.
            </li>
          </ul>
          <p>
            If you see a misread on a German page, use the Feedback button at the foot of that page and say which word.
            Someone checks it against the scan. More on how we measure:{' '}
            <A href="/quality/methods">How we measure quality</A>; all engines and costs:{' '}
            <A href="/quality/pareto">Which engine to run</A>.
          </p>
        </Section>
      </div>
    </ContentPageLayout>
  );
}
