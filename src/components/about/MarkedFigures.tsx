'use client';

import Link from 'next/link';
import MarkedPage from './MarkedPage';
import type { AboutFigureStrings } from '@/lib/about-i18n';
import MARKS from './marks.json';

/**
 * Pages from books in the library with the Latin marked as they come into
 * view. Mark boxes are percentages of the image, measured off the scans.
 */

const link = 'underline decoration-1 underline-offset-[0.2em] decoration-accent-gold/70 hover:decoration-primary transition-colors';

const WONDER_PAGE = '/book/plato-dialogues-ficino-translation-with-de-amore-translator/page/69b43d4006b196d69f66fcf0';

function Caption({ t, href, readEnglish }: { t: AboutFigureStrings; href: string; readEnglish: string }) {
  return (
    <>
      {t.captionPre}<em>{t.captionTitle}</em>{t.captionPost}{' '}
      <Link href={href} className={link}>{readEnglish}</Link>
    </>
  );
}

/** Plato's Theaetetus in Ficino's Latin, from the manuscript of the dialogues dedicated to Lorenzo. */
export function WonderFigure({ t, readEnglish }: { t: AboutFigureStrings; readEnglish: string }) {
  return (
    <MarkedPage
      src="/about/plato-laurenziana-p207.jpg"
      w={657}
      h={1000}
      alt={t.alt}
      href={WONDER_PAGE}
      marks={MARKS.wonder}
      aside={(lit) => (
        <div>
          <p className="text-lg text-secondary">{t.lead}</p>
          <blockquote className="mt-4 font-serif text-xl md:text-3xl text-primary leading-snug mp-q" style={{ opacity: lit > 0 ? 1 : 0.2 }}>
            &ldquo;{t.quote}&rdquo;
          </blockquote>
          <style>{`.mp-q { transition: opacity .6s ease; }`}</style>
        </div>
      )}
      caption={<Caption t={t} href={WONDER_PAGE} readEnglish={readEnglish} />}
    />
  );
}
