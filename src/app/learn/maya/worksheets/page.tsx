import type { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import { LEVELS, SHEETS } from './data';

export const metadata: Metadata = {
  title: 'Maya glyph worksheets to print - Source Library',
  description:
    'Printable worksheets for learning Maya hieroglyphs: David Stuart’s syllable chart, sign drills, spelling, word signs and bar-and-dot numbers, each with an answer key.',
  alternates: { canonical: '/learn/maya/worksheets' },
};

const LEVEL_NOTE: Record<string, string> = {
  'Level 1': 'Vowels, first signs, copying, numbers',
  'Level 2': 'More signs, and telling them apart',
  'Level 3': 'Spelling words, word signs',
  Reference: 'Keep beside you',
};

export default function WorksheetsIndex() {
  return (
    <>
      <SiteHeader variant="dark" />
      <main className="bg-cream min-h-screen">
        <div className="max-w-3xl mx-auto px-4 py-10">
          <p className="text-sm text-stone-600 mb-2"><Link href="/learn/maya" className="hover:underline">← Learn to read Maya</Link></p>
          <h1 className="font-serif text-3xl text-primary mb-4">Worksheets to print</h1>
          <p className="leading-relaxed mb-3">
            Pen-and-paper practice for reading Maya hieroglyphs. The syllable signs are David Stuart’s drawings from his
            syllabary chart, the forms carved on monuments around AD 700.
          </p>
          <p className="leading-relaxed mb-8 text-stone-700">
            Each sheet prints on one page, with its answer key on the page after it. Print the syllable chart first and
            keep it beside you.
          </p>
          {LEVELS.map((level) => {
            const sheets = SHEETS.filter((s) => s.level === level);
            if (!sheets.length) return null;
            return (
              <section key={level} className="mb-8">
                <h2 className="font-serif text-xl text-primary">{level}</h2>
                <p className="text-sm text-stone-600 mb-3">{LEVEL_NOTE[level]}</p>
                <ul className="grid sm:grid-cols-2 gap-3">
                  {sheets.map((s) => (
                    <li key={s.slug}>
                      <Link href={`/learn/maya/worksheets/${s.slug}`} className="block h-full rounded-xl border border-border-light bg-white/70 p-4 hover:bg-white transition-colors">
                        <span className="font-serif text-lg text-primary">{s.title}</span>
                        <span className="block text-sm text-stone-600 mt-1 line-clamp-2">{s.intro}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <p className="text-xs text-stone-500 leading-relaxed mt-10">
            Syllable drawings © David Stuart, used with permission. Word signs and look-alike pairs from Kettunen and Helmke’s
            Wayeb workshop handbook (2025).
          </p>
        </div>
      </main>
    </>
  );
}
