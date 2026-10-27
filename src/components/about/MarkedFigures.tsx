'use client';

import Link from 'next/link';
import MarkedPage, { type Mark } from './MarkedPage';

/**
 * Pages from books in the library with the Latin marked as they come into
 * view: Ficino's preface to Cosimo in the 1472 Pimander (BSB Munich), and the
 * contents of the 1497 Aldine De Mysteriis. Line positions measured from the
 * scans (darkness profile and a percentage grid): 2.6% line pitch, text column
 * 15–85.5% on the preface page.
 */

const PIMANDER = '/book/hermes-trismegistus-pimander-1472-editio-princeps-trans';
const PREFACE_PAGE = `${PIMANDER}/page/69b4cc20bb3208142d7bc486`;
const H = 3.1;
const line = (y: number, x = 15, w = 70.5): Mark => ({ x, y, w, h: H });
const link = 'underline decoration-1 underline-offset-[0.2em] decoration-accent-gold/70 hover:decoration-primary transition-colors';

const PREFACE_MARKS = [line(36.3), line(38.9), line(41.6, 15, 9), line(41.6, 24.5, 61), line(44.1), line(46.7), line(49.3, 15, 13)];

export function PrefaceFigure() {
  return (
    <MarkedPage
      src="/about/pimander-1472.jpg"
      w={760}
      h={1000}
      alt="Ficino's Latin preface to the Pimander, printed 1472"
      href={PREFACE_PAGE}
      marks={PREFACE_MARKS}
      aside={(lit) => (
        <blockquote className="font-serif text-xl md:text-2xl text-primary leading-snug">
          <span className="mp-q" style={{ opacity: lit > 0 ? 1 : 0.2 }}>
            &ldquo;Lately, having been brought from Macedonia into Italy through the diligence of Leonardo the Macedonian, a learned and pious monk, it has come to us.
          </span>{' '}
          <span className="mp-q" style={{ opacity: lit > 3 ? 1 : 0.2 }}>
            When I, provoked by your exhortations, had decided to translate it from the Greek language into Latin, I thought it would be fair, happy Cosimo, to dedicate the booklet to your name.&rdquo;
          </span>
          <style>{`.mp-q { transition: opacity .6s ease; }`}</style>
        </blockquote>
      )}
      caption={
        <>
          Ficino&apos;s preface to Cosimo, in the <em>Pimander</em> printed in 1472. Bayerische Staatsbibliothek.{' '}
          <Link href={PREFACE_PAGE} className={link}>Read the page in English</Link>
        </>
      }
    />
  );
}

const COMPENDIUM = '/book/iamblichus-de-mysteriis-1497-aldine-ficino';
const COMPENDIUM_CONTENTS = `${COMPENDIUM}/page/6959afa11dfc1806c080bc8a`;
const DE_VOLUPTATE = '/book/de-voluptate-ficino';

export function CompendiumFigure() {
  return (
    <MarkedPage
      src="/about/de-mysteriis-1497.jpg"
      w={760}
      h={1046}
      alt="The contents page of the 1497 Aldine De Mysteriis, ending with Ficino's book on pleasure"
      href={COMPENDIUM_CONTENTS}
      marks={[{ x: 23, y: 61.8, w: 28.5, h: 2.2 }]}
      aside={(lit) => (
        <div>
          <p className="font-serif text-3xl md:text-4xl text-primary leading-tight">
            <span className="mp-q" style={{ opacity: lit > 0 ? 1 : 0.25 }}>Marsilii Ficini liber de voluptate</span>
          </p>
          <p className="mt-3 text-lg text-secondary">Marsilio Ficino&apos;s book on pleasure</p>
          <p className="mt-8 text-lg text-secondary leading-relaxed">
            The last entry in the contents of the 1497 compendium <em>De Mysteriis</em>, printed by Aldus Manutius in Venice. We could find no earlier English translation.{' '}
            <Link href={DE_VOLUPTATE} className={link}>Read it in English</Link>
          </p>
          <style>{`.mp-q { transition: opacity .6s ease; }`}</style>
        </div>
      )}
      caption={
        <>
          <em>De Mysteriis</em>, Venice 1497.{' '}
          <Link href={COMPENDIUM} className={link}>Read the whole compendium</Link>
        </>
      }
    />
  );
}
