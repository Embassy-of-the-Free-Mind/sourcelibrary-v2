'use client';

import Link from 'next/link';
import MarkedPage from './MarkedPage';
import MARKS from './marks.json';

/**
 * Pages from books in the library with the Latin marked as they come into
 * view. Mark boxes are percentages of the image, measured off the scans.
 */

const link = 'underline decoration-1 underline-offset-[0.2em] decoration-accent-gold/70 hover:decoration-primary transition-colors';

const WONDER_PAGE = '/book/plato-dialogues-ficino-translation-with-de-amore-translator/page/69b43d4006b196d69f66fcf0';

/** Plato's Theaetetus in Ficino's Latin, from the manuscript of the dialogues dedicated to Lorenzo. */
export function WonderFigure() {
  return (
    <MarkedPage
      src="/about/plato-laurenziana-p207.jpg"
      w={657}
      h={1000}
      alt="A handwritten page of Plato's Theaetetus in Ficino's Latin, from a manuscript dedicated to Lorenzo de' Medici"
      href={WONDER_PAGE}
      marks={MARKS.wonder}
      aside={(lit) => (
        <div>
          <p className="text-lg text-secondary">Socrates to the young Theaetetus, in Ficino&apos;s Latin:</p>
          <blockquote className="mt-4 font-serif text-xl md:text-3xl text-primary leading-snug mp-q" style={{ opacity: lit > 0 ? 1 : 0.2 }}>
            &ldquo;This affection is most characteristic of a philosopher, which is called wonder; for there is no other principle of philosophy than this.&rdquo;
          </blockquote>
          <style>{`.mp-q { transition: opacity .6s ease; }`}</style>
        </div>
      )}
      caption={
        <>
          Plato&apos;s <em>Theaetetus</em>, from Ficino&apos;s Latin dialogues copied for Lorenzo de&apos; Medici. Biblioteca Medicea Laurenziana, Florence.{' '}
          <Link href={WONDER_PAGE} className={link}>Read the page in English</Link>
        </>
      }
    />
  );
}

const SOUL_PAGE = '/book/ficino-on-the-immortality-of-souls-ficino/page/69b52bf33dd6d9423027cd9b';

/** The first page of Ficino's Platonic Theology, in an illuminated copy dedicated to Lorenzo. */
export function SoulFigure() {
  return (
    <MarkedPage
      src="/about/immortality-p11.jpg"
      w={659}
      h={1000}
      alt="The illuminated first page of Ficino's Platonic Theology on the immortality of souls"
      href={SOUL_PAGE}
      marks={MARKS.soul}
      aside={(lit) => (
        <div>
          <p className="text-lg text-secondary">Ficino opens his great book on the soul:</p>
          <blockquote className="mt-4 font-serif text-xl md:text-2xl text-primary leading-snug">
            <span className="mp-q" style={{ opacity: lit > 0 ? 1 : 0.2 }}>&ldquo;Let us loosen, I beseech you, oh celestial souls, desiring our celestial homeland, let us loosen as soon as possible the chains of earthly shackles, so that, lifted up on wings, we may fly more freely under the guidance of Plato and God into our ethereal home, where we shall happily contemplate the excellence of the status of our kind.&rdquo;</span>
          </blockquote>
          <style>{`.mp-q { transition: opacity .6s ease; }`}</style>
        </div>
      )}
      caption={
        <>
          Ficino, <em>Platonic Theology</em>, dedicated to Lorenzo de&apos; Medici, in a fifteenth-century manuscript.{' '}
          <Link href={SOUL_PAGE} className={link}>Read the page in English</Link>
        </>
      }
    />
  );
}
