'use client';

import Link from 'next/link';
import MarkedPage, { type Mark } from './MarkedPage';

/**
 * Two pages of Ficino's preface in the library's 1472 Pimander (BSB Munich),
 * with the Latin marked as it comes into view. Line positions measured from
 * the scans' darkness profile: 2.6% line pitch, text column 15–85.5% (preface
 * page) and 25.6–83% (chain page).
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
        <blockquote className="font-serif text-2xl md:text-3xl text-primary leading-snug">
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

const CHAIN: { name: string; mark: Mark }[] = [
  { name: 'Hermes', mark: { x: 25.4, y: 60.4, w: 11.6, h: H } },
  { name: 'Orpheus', mark: { x: 75.6, y: 42.2, w: 7.8, h: H } },
  { name: 'Aglaophemus', mark: { x: 36.1, y: 47.4, w: 19.2, h: H } },
  { name: 'Pythagoras', mark: { x: 41.3, y: 50.0, w: 11.6, h: H } },
  { name: 'Philolaus', mark: { x: 61.2, y: 50.0, w: 10.4, h: H } },
  { name: 'Plato', mark: { x: 34.8, y: 52.7, w: 10.2, h: H } },
];
const CHAIN_MARKS = CHAIN.map((c) => c.mark);

export function ChainFigure() {
  return (
    <MarkedPage
      src="/about/pimander-1472-chain.jpg"
      w={767}
      h={1000}
      alt="The page of the 1472 Pimander that names the ancient theologians"
      href={PIMANDER}
      marks={CHAIN_MARKS}
      aside={(lit) => (
        <ol className="space-y-1">
          {CHAIN.map((c, k) => (
            <li
              key={c.name}
              className="mp-q flex items-baseline gap-4 font-serif text-3xl md:text-4xl text-primary leading-tight"
              style={{ opacity: k < lit ? 1 : 0.15 }}
            >
              <span className="w-6 text-base font-sans text-muted tabular-nums">{k + 1}</span>
              {c.name}
            </li>
          ))}
          <style>{`.mp-q { transition: opacity .6s ease; }`}</style>
        </ol>
      )}
      caption={
        <>
          One page earlier, Ficino names the six teachers of the ancient theology, from Hermes to Plato.{' '}
          <Link href={PIMANDER} className={link}>Read the whole book in English</Link>
        </>
      }
    />
  );
}
