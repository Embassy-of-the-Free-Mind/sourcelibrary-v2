import { Metadata } from 'next';
import Link from 'next/link';
import { tokenizeAtfLine, type AtfToken } from '@/lib/cuneiform-signs';
import SiteHeader from '@/components/layout/SiteHeader';
import gilgameshData from '../../../../scripts/output/gilgamesh-tablets.json';

export const metadata: Metadata = {
  title: 'The Epic of Gilgamesh — Tablet Reader — Source Library',
  description:
    'Read the Epic of Gilgamesh from the original cuneiform tablets. Photos, transliteration, and translation of the 12 tablets from the Library of Ashurbanipal.',
  alternates: { canonical: '/read/gilgamesh' },
};

// Thompson 1930 translation excerpts (public domain) for key passages
const TRANSLATIONS: Record<number, string[]> = {
  1: [
    'He who saw the Deep, the foundation of the land,',
    'who knew the ways, was wise in all things:',
    'Gilgamesh, who saw the Deep, the foundation of the land,',
    'who knew the ways, was wise in all things.',
    'He searched the world over, found the secret of all things,',
    'he saw what was secret and uncovered what was hidden,',
    'he brought back a tale of the time before the Flood.',
    'He came a far road, was weary, found peace,',
    'and set all his labours on a tablet of stone.',
  ],
  11: [
    'Gilgamesh spoke to him, to Utnapishtim the Faraway:',
    '"I look at you, Utnapishtim,',
    'your form is no different — you are just like me!',
    'You are not different at all — you are just like me!',
    'My heart had imagined you doing battle,',
    'but you lie here idle on your back!',
    'Tell me, how did you join the Assembly of the Gods',
    'and find eternal life?"',
    '',
    'Utnapishtim spoke to him, to Gilgamesh:',
    '"I will reveal to you, Gilgamesh, a secret thing,',
    'a mystery of the gods I will tell you.',
    'The city of Shuruppak, a city that you know,',
    'which stands on the banks of the Euphrates —',
    'that city was ancient, the gods were within it,',
    'and the great gods decided to bring on a flood.',
  ],
  12: [
    'The great lord, the king of the gods, Ninurta, has sent me.',
    'Enkidu, whom you seek, the fate of mankind has overtaken him.',
  ],
};

interface Witness {
  museumNo: string;
  pNumber: string;
  note: string;
  cdliUrl: string;
  photoUrl: string | null;
  lineartUrl: string;
  detailPhotoUrl: string;
  eblUrl: string;
  atf: string;
  description: string;
  hasAtf: boolean;
}

interface TabletEntry {
  tablet: number;
  title: string;
  summary: string;
  witnesses: Witness[];
}

const tablets = gilgameshData as TabletEntry[];

function renderAtfTokens(tokens: AtfToken[]) {
  return tokens.map((t, i) => {
    if (t.isDeterminative) {
      return (
        <sup key={i} className="text-stone-400 text-[0.6em]" title={t.reading}>
          {t.sign || t.reading}
        </sup>
      );
    }
    if (t.isNumber) {
      return (
        <span key={i} className="text-blue-800 font-mono text-sm" title={t.reading}>
          {t.sign || t.numValue || t.reading}
        </span>
      );
    }
    if (t.sign) {
      return (
        <span key={i} className="text-amber-900 text-lg" title={t.reading}>
          {t.sign}
        </span>
      );
    }
    // No mapping — show as transliteration
    return (
      <span key={i} className="text-stone-500 text-sm italic">
        {t.reading}
      </span>
    );
  });
}

function TabletSection({ tablet }: { tablet: TabletEntry }) {
  const mainWitness = tablet.witnesses[0];
  const translation = TRANSLATIONS[tablet.tablet];

  // Parse ATF lines
  const atfLines: { lineNum: string; text: string; tokens: AtfToken[] }[] = [];
  if (mainWitness.hasAtf) {
    for (const line of mainWitness.atf.split('\n')) {
      const trimmed = line.trim();
      if (/^\d+[\.'']/.test(trimmed)) {
        const match = trimmed.match(/^(\d+[\.'']?\d*)\s*(.*)/);
        if (match) {
          atfLines.push({
            lineNum: match[1],
            text: match[2],
            tokens: tokenizeAtfLine(match[2]),
          });
        }
      }
    }
  }

  return (
    <section id={`tablet-${tablet.tablet}`} className="scroll-mt-20">
      <div className="border-b border-stone-200 pb-8 mb-8">
        <h2 className="font-serif text-xl text-stone-900 mb-1">{tablet.title}</h2>
        <p className="text-sm text-stone-500 mb-4">{tablet.summary}</p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Tablet photo */}
          <div className="space-y-2">
            {mainWitness.photoUrl ? (
              <a href={mainWitness.cdliUrl} target="_blank" rel="noopener" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mainWitness.photoUrl}
                  alt={`Cuneiform tablet ${mainWitness.museumNo} — ${tablet.title}`}
                  className="w-full rounded-lg shadow-md border border-stone-200"
                  loading="lazy"
                />
              </a>
            ) : (
              <div className="bg-stone-100 rounded-lg p-8 text-center text-stone-400 border border-stone-200">
                <p className="text-sm">Photo not yet available on CDLI</p>
              </div>
            )}
            <div className="text-xs text-stone-400 space-y-0.5">
              <p><strong>{mainWitness.museumNo}</strong> &mdash; {mainWitness.description}</p>
              <p>
                <a href={mainWitness.cdliUrl} className="text-secondary hover:underline" target="_blank" rel="noopener">CDLI</a>
                {' | '}
                <a href={mainWitness.eblUrl} className="text-secondary hover:underline" target="_blank" rel="noopener">eBL</a>
              </p>
            </div>
            {tablet.witnesses.length > 1 && (
              <details className="text-xs text-stone-400">
                <summary className="cursor-pointer hover:text-stone-600">
                  {tablet.witnesses.length - 1} additional witness{tablet.witnesses.length > 2 ? 'es' : ''}
                </summary>
                <ul className="mt-1 space-y-0.5 pl-3">
                  {tablet.witnesses.slice(1).map((w) => (
                    <li key={w.pNumber}>
                      <a href={w.cdliUrl} className="text-secondary hover:underline" target="_blank" rel="noopener">
                        {w.museumNo}
                      </a>
                      {' '}&mdash; {w.note}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {/* Right: ATF + Cuneiform + Translation */}
          <div className="space-y-4">
            {atfLines.length > 0 ? (
              <div className="bg-stone-50 rounded-lg p-4 border border-stone-200 overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] text-stone-400 uppercase tracking-wider border-b border-stone-100">
                      <th className="pb-1 pr-2 w-8">Line</th>
                      <th className="pb-1 pr-3">Cuneiform</th>
                      <th className="pb-1">Transliteration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {atfLines.slice(0, 20).map((line, i) => (
                      <tr key={i}>
                        <td className="py-1.5 pr-2 text-xs text-stone-400 font-mono align-top">
                          {line.lineNum}
                        </td>
                        <td className="py-1.5 pr-3 align-top whitespace-nowrap">
                          {renderAtfTokens(line.tokens)}
                        </td>
                        <td className="py-1.5 text-xs font-mono text-stone-600 align-top">
                          {line.text}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {atfLines.length > 20 && (
                  <p className="text-xs text-stone-400 mt-2 pt-2 border-t border-stone-100">
                    + {atfLines.length - 20} more lines
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-amber-50/50 rounded-lg p-4 border border-amber-200/50">
                <p className="text-xs text-amber-700">
                  ATF transliteration pending. The Electronic Babylonian Library is actively transcribing this tablet.
                  Translation below from Thompson (1930).
                </p>
              </div>
            )}

            {/* Translation */}
            {translation && (
              <div className="bg-white rounded-lg p-4 border border-stone-200">
                <h4 className="text-[10px] text-stone-400 uppercase tracking-wider mb-2">
                  Translation (Thompson, 1930)
                </h4>
                <div className="space-y-1">
                  {translation.map((line, i) => (
                    <p key={i} className={`text-sm text-stone-700 ${line === '' ? 'h-3' : ''}`}>
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function GilgameshReaderPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-cream)' }}>
      <SiteHeader variant="light" />
      {/* Header */}
      <header className="border-b py-10 px-6" style={{ borderColor: 'var(--border-light)' }}>
        <div className="max-w-6xl mx-auto">
          <div className="mb-4">
            <Link
              href="/tablets"
              className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-stone-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Tablet Corpus
            </Link>
          </div>
          <h1 className="font-serif text-3xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            The Epic of Gilgamesh
          </h1>
          <p className="text-base mb-3" style={{ color: 'var(--text-muted)' }}>
            The Standard Babylonian version in 12 tablets, from the Library of Ashurbanipal at Nineveh (7th century BCE).
            Read from the original cuneiform tablets with photos, transliteration, and translation.
          </p>
          <p className="text-xs text-stone-400">
            Tablets: British Museum, Kuyunjik collection &bull;
            Photos: CDLI &bull;
            ATF: Electronic Babylonian Library (CC BY-NC-SA 4.0) &bull;
            Translation: R. Campbell Thompson (1930, public domain)
          </p>
        </div>
      </header>

      {/* Tablet navigation */}
      <nav className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-stone-200 px-6 py-2">
        <div className="max-w-6xl mx-auto flex gap-1 overflow-x-auto">
          {tablets.map((t) => (
            <a
              key={t.tablet}
              href={`#tablet-${t.tablet}`}
              className="px-3 py-1.5 text-xs font-mono text-stone-600 hover:bg-stone-100 rounded transition-colors whitespace-nowrap"
            >
              {t.tablet === 11 ? 'XI (Flood)' : ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][t.tablet - 1]}
            </a>
          ))}
        </div>
      </nav>

      {/* Tablets */}
      <main className="max-w-6xl mx-auto px-6 py-10">
        {tablets.map((tablet) => (
          <TabletSection key={tablet.tablet} tablet={tablet} />
        ))}

        {/* Footer note */}
        <div className="mt-12 pt-8 border-t border-stone-200">
          <h3 className="font-serif text-lg text-stone-800 mb-3">About this edition</h3>
          <div className="prose-content text-sm text-stone-600 space-y-2">
            <p>
              The Standard Babylonian Epic of Gilgamesh was compiled by the scholar-priest S&icirc;n-l&emacr;qi-unninni
              (13th–10th century BCE). The best-preserved copies come from the library of the Assyrian king Ashurbanipal
              (r. 668–627 BCE) at Nineveh, discovered by Hormuzd Rassam in 1853. The tablets are now in the British Museum.
            </p>
            <p>
              This reader combines CDLI photographs, eBL transliterations (where available), and
              R. Campbell Thompson&apos;s 1930 public-domain translation. As the Electronic Babylonian Library
              completes its transliteration of all Nineveh literary fragments, the ATF coverage here will expand.
            </p>
            <p>
              See also:{' '}
              <Link href="/book/the-epic-of-gilgamish-thompson" className="text-secondary hover:underline">
                Thompson&apos;s full edition
              </Link>
              {' | '}
              <Link href="/book/an-old-babylonian-version-of-the-gilgamesh-epic-mesopotamian" className="text-secondary hover:underline">
                Old Babylonian version (Jastrow)
              </Link>
              {' | '}
              <Link href="/book/gilgamesh-and-huwawa-version-a" className="text-secondary hover:underline">
                Gilgamesh and Huwawa (Sumerian)
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
