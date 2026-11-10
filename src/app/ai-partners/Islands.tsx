import Link from 'next/link';
import ReadingDemo from '@/components/about/ReadingDemo';
import WrittenPastChart from '@/components/about/WrittenPastChart';
import Pic from '@/components/about/Pic';
import { PAGES as FIRST_TRANSLATIONS } from '@/components/about/freethinkers-data';
import { ABOUT_STRINGS } from '@/lib/about-i18n';

// Three sections borrowed from /about and rendered between the parts of the HTML
// string (content.ts, <!--island:NAME--> markers). They show real pages where the
// rest of this page gives figures. data-island keeps them out of ?edit diffs.
const t = ABOUT_STRINGS.en;

/** Six books with no earlier English translation, all translated by Source Library. */
function Shelf() {
  return (
    <section className="proof" data-island="shelf">
      <div className="wrap">
        <p className="eyebrow">First English translations</p>
        <h2>Six books no one had translated into English before</h2>
        <ul className="mt-10 grid grid-flow-col grid-rows-[auto_auto] auto-cols-[10rem] md:auto-cols-[12rem] lg:auto-cols-fr gap-x-5 md:gap-x-6 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-4 list-none p-0">
          {FIRST_TRANSLATIONS.map((p, i) => (
            <li key={p.src} className="row-span-2 grid grid-rows-subgrid">
              <Link href={p.href} className="self-end block">
                <Pic src={p.src} alt={t.ai.books[i].alt} width={p.w} height={p.h} className="block w-full h-auto shadow-[0_1px_0_rgba(0,0,0,.08),0_8px_24px_-12px_rgba(0,0,0,.35)]" />
              </Link>
              <Link href={p.href} className="block pt-4 no-underline" style={{ color: 'inherit' }}>
                <span className="block text-sm tabular-nums" style={{ color: 'var(--muted)', fontFamily: 'var(--sans)' }}>{p.year}{p.lang ? ` · ${t.ai.books[i].lang}` : ''}</span>
                <span className="block mt-1 text-lg leading-snug" style={{ fontFamily: 'var(--serif)', fontWeight: 600 }}>{p.title ?? p.who}</span>
                {p.title && <span className="block text-sm">{p.who}</span>}
                <span className="block mt-2 text-sm leading-snug" style={{ color: 'var(--ink-soft)' }}>{t.ai.books[i].what}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const STEPS: { title: string; body: string }[] = [
  ...t.how.steps,
  { title: 'Record', body: 'Each reading keeps its scan, the model and prompt that made it, and a hash of the text.' },
];

/** A real page transcribed, translated and tagged in front of the reader. */
function Demo() {
  return (
    <section className="proof" data-island="demo">
      <div className="wrap">
        <ReadingDemo t={t.demo}>
          <p className="eyebrow">One page</p>
          <h2>How a page becomes a record</h2>
          <ol className="mt-8 space-y-5 rd-mark list-none p-0">
            {STEPS.map((st, i) => (
              <li key={st.title} data-i={i} className="rd-step">
                <h3 className="text-lg" style={{ fontFamily: 'var(--sans)' }}>{st.title}</h3>
                <p className="mt-1" style={{ color: 'var(--ink-soft)', fontSize: 17 }}>{st.body}</p>
              </li>
            ))}
          </ol>
        </ReadingDemo>
      </div>
    </section>
  );
}

/** How much of the world's written past can be read in English, language by language. */
function Chart() {
  return (
    <section className="proof alt" data-island="chart">
      <div className="wrap">
        <WrittenPastChart palette="hues" titleClass="text-[30px] md:text-[44px] leading-[1.08] max-w-5xl" t={t.chart} lang="en" />
        <p className="note mt-6" style={{ fontSize: 14, color: 'var(--muted)' }}>
          {t.sources.body} <Link href="/research/translation-gap">{t.sources.link}</Link>
        </p>
      </div>
    </section>
  );
}

export const ISLANDS: Record<string, () => React.JSX.Element> = { shelf: Shelf, demo: Demo, chart: Chart };
