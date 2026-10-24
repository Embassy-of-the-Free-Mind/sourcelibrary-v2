import type { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import { LEVELS, SHEETS } from './data';

export const metadata: Metadata = {
  title: 'Maya glyph worksheets to print - Source Library',
  description:
    'Printable worksheets for learning Maya hieroglyphs: David Stuart’s syllable chart, sign drills, day signs, spelling, word signs and bar-and-dot numbers, each with an answer key.',
  alternates: { canonical: '/learn/maya/worksheets' },
};

const LEVEL_NOTE: Record<string, string> = {
  Reference: 'Print this first and keep it beside you.',
  'Level 1': 'Vowels, first signs, numbers and the day signs.',
  'Level 2': 'More signs, and telling look-alikes apart.',
  'Level 3': 'Spelling words, and signs that stand for whole words.',
};

export default function WorksheetsIndex() {
  return (
    <>
      <SiteHeader variant="dark" />
      <main>
        <div className="max-w-3xl mx-auto px-4 py-10">
          <p className="ts-label ts-kicker uppercase"><Link href="/learn/maya" className="hover:underline">Learn to read Maya</Link> · worksheets</p>
          <h1 className="ts-display text-[44px] leading-[48px] mt-1 mb-5">Glyph sheets</h1>
          <p className="text-[19px] leading-[30px] mb-3 max-w-[60ch]">
            Pen-and-paper practice for reading Maya hieroglyphs. The syllable signs are David Stuart’s drawings of the forms carved on
            monuments around AD 700. The day signs are painted forms from the codices.
          </p>
          <p className="ts-body ts-suave mb-10 max-w-[60ch]">
            Each sheet prints on one page, with its answer key on the next. Start anywhere; the numbers give a suggested order.
          </p>
          {LEVELS.map((level) => {
            const sheets = SHEETS.filter((s) => s.level === level);
            if (!sheets.length) return null;
            return (
              <section key={level} className="mb-9">
                <h2 className="text-[22px] leading-7 font-bold">{level}</h2>
                <p className="ts-body ts-suave mb-3">{LEVEL_NOTE[level]}</p>
                <ul className="space-y-3">
                  {sheets.map((s) => (
                    <li key={s.slug}>
                      <Link href={`/learn/maya/worksheets/${s.slug}`} className="ts-tile ts-link-tile flex items-center gap-4 p-4">
                        <span className="ts-num ts-display w-11 h-11 shrink-0 flex items-center justify-center text-lg">{s.number}</span>
                        <span>
                          <span className="block text-[19px] font-bold leading-6">{s.title}</span>
                          <span className="block text-[15px] ts-suave line-clamp-2">{s.intro}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <div className="border-t ts-hair pt-3 mt-10 text-[13px] leading-5 ts-suave space-y-1">
            <p>Syllable drawings © David Stuart, <i>Maya Hieroglyph Syllabary</i> (2013), used with permission; vector tracing by Source Library.</p>
            <p>Word signs drawn by Christian Prager, Text Database and Dictionary of Classic Mayan (Bonn), CC BY 4.0.</p>
            <p>
              Day signs from Sylvanus G. Morley,{' '}
              <a href="https://sourcelibrary.org/q/BoWmdDTIGXopuwJXH2T" className="underline">An Introduction to the Study of the Maya Hieroglyphs</a>{' '}
              (1915), fig. 17. Public domain.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
