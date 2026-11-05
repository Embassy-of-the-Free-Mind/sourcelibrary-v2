'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
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

// Variants for the 1463 section (2026-11-04). Translations are the library's
// own, quoted from the pages linked; mark boxes measured off the scans with a
// darkness profile (lines.py in the session scratchpad).

type Lit = (lit: number) => ReactNode;

const PIMANDER_TEXT = `${PIMANDER}/page/69b4cc20bb3208142d7bc488`;
const TITLE_MARKS: Mark[] = [
  { x: 17.2, y: 24.2, w: 55.5, h: 2.3 },
  { x: 17.2, y: 26.8, w: 55.5, h: 2.3 },
  { x: 17.2, y: 29.4, w: 55.5, h: 2.3 },
  { x: 17.2, y: 31.9, w: 55.5, h: 2.3 },
  { x: 17.2, y: 34.4, w: 55.5, h: 2.3 },
  { x: 17.2, y: 36.8, w: 41, h: 2.3 },
  { x: 38.5, y: 71.4, w: 36, h: 2.1 },
  { x: 16.8, y: 74.0, w: 20, h: 2.1 },
];

/** B: the title of the first Hermetic book, naming Cosimo, then its first words. */
export function PimanderTitleFigure() {
  const q: Lit = (lit) => (
    <div>
      <p className="font-serif text-xl md:text-2xl text-primary leading-snug mp-q" style={{ opacity: lit > 0 ? 1 : 0.2 }}>
        &ldquo;The book concerning the power and wisdom of God, translated from Greek into Latin by Marsilio Ficino of Florence for Cosimo de&apos; Medici, father of the fatherland.&rdquo;
      </p>
      <p className="mt-6 font-serif text-2xl md:text-3xl text-primary leading-snug mp-q" style={{ opacity: lit > 6 ? 1 : 0.2 }}>
        &ldquo;I desire to learn the nature of things and to know God.&rdquo;
      </p>
      <style>{`.mp-q { transition: opacity .6s ease; }`}</style>
    </div>
  );
  return (
    <MarkedPage
      src="/about/pimander-1472-p9.jpg"
      w={760}
      h={1000}
      alt="The opening of the Pimander, printed 1472, with its title naming Cosimo de' Medici"
      href={PIMANDER_TEXT}
      marks={TITLE_MARKS}
      aside={q}
      caption={
        <>
          The first page of the <em>Pimander</em>, printed in 1472. Bayerische Staatsbibliothek.{' '}
          <Link href={PIMANDER_TEXT} className={link}>Read the page in English</Link>
        </>
      }
    />
  );
}

const PLOTINUS_PAGE = '/book/plotinus-enneads-xxvii-liv-ficino-translation-translator/page/69b43d3706b196d69f66f8ea';
const PLOTINUS_MARKS: Mark[] = [
  { x: 20.3, y: 25.7, w: 41, h: 2.0 },
  { x: 20.3, y: 27.9, w: 41, h: 2.0 },
  { x: 20.3, y: 30.0, w: 18.5, h: 2.0 },
  { x: 51, y: 34.2, w: 10, h: 2.0 },
  { x: 20.3, y: 36.3, w: 41, h: 2.0 },
  { x: 20.3, y: 38.4, w: 20.5, h: 2.0 },
];

/** D: the Plotinus manuscript made in Ficino's workshop, recalling a walk with Lorenzo. */
export function PlotinusFigure() {
  return (
    <MarkedPage
      src="/about/plotinus-ms-p829.jpg"
      w={697}
      h={1000}
      alt="A handwritten page from Ficino's Latin Plotinus, copied by his scribe Luca at Careggi in 1490"
      href={PLOTINUS_PAGE}
      marks={PLOTINUS_MARKS}
      aside={(lit) => (
        <blockquote className="font-serif text-xl md:text-2xl text-primary leading-snug">
          <span className="mp-q" style={{ opacity: lit > 0 ? 1 : 0.2 }}>
            &ldquo;I was walking with the magnanimous Lorenzo de&apos; Medici and we were interpreting many of the mysteries of Plato back and forth.
          </span>{' '}
          <span className="mp-q" style={{ opacity: lit > 3 ? 1 : 0.2 }}>
            Then he said, &lsquo;Do not, Marsilio, call our Plato unfortunate, unless perhaps you think me to be unfortunate.&rsquo;&rdquo;
          </span>
          <style>{`.mp-q { transition: opacity .6s ease; }`}</style>
        </blockquote>
      )}
      caption={
        <>
          Ficino&apos;s Latin Plotinus, copied by hand at Careggi, the Medici villa, in 1490. Biblioteca Medicea Laurenziana.{' '}
          <Link href={PLOTINUS_PAGE} className={link}>Read the page in English</Link>
        </>
      }
    />
  );
}

const PLATO_PAGE = '/book/omnia-divini-platonis-opera-ficino-translation-ficino/page/69b21cee429e087c6f86601e';
const PLATO_MARKS: Mark[] = [
  { x: 50.5, y: 34.5, w: 32.5, h: 1.6 },
  { x: 1.8, y: 36.1, w: 19.5, h: 1.6 },
];

/** Socrates in Ficino's Latin: the Apology, from a 1561 printing of his Plato. */
export function PlatoFigure() {
  return (
    <MarkedPage
      src="/about/plato-1561-p45.jpg"
      w={684}
      h={1000}
      alt="A page of Plato's Apology in Ficino's Latin translation, printed in Basel in 1561"
      href={PLATO_PAGE}
      marks={PLATO_MARKS}
      aside={(lit) => (
        <div>
          <p className="text-lg text-secondary">Socrates at his trial, in Ficino&apos;s Latin:</p>
          <blockquote className="mt-4 font-serif text-2xl md:text-3xl text-primary leading-snug mp-q" style={{ opacity: lit > 0 ? 1 : 0.2 }}>
            &ldquo;A life without examination is not to be lived by a man.&rdquo;
          </blockquote>
          <style>{`.mp-q { transition: opacity .6s ease; }`}</style>
        </div>
      )}
      caption={
        <>
          Plato&apos;s <em>Apology</em> in Ficino&apos;s translation, Basel 1561. BIU Santé, Paris.{' '}
          <Link href={PLATO_PAGE} className={link}>Read the page in English</Link>
        </>
      }
    />
  );
}

const LETTER_PAGE = '/book/iamblichus-de-mysteriis-1497-aldine-ficino/page/6959afa11dfc1806c080bd22';
const LETTER_MARKS: Mark[] = [
  { x: 11.3, y: 10.9, w: 68, h: 1.8 },
  { x: 13.7, y: 14.7, w: 66, h: 1.8 },
  { x: 17, y: 16.7, w: 62.5, h: 1.8 },
  { x: 11.3, y: 18.6, w: 23, h: 1.8 },
];

/** Ficino to Lorenzo: the Greek philosophers he translated arrive at the Medici house. */
export function LetterFigure() {
  return (
    <MarkedPage
      src="/about/de-mysteriis-1497-p159.jpg"
      w={706}
      h={1000}
      alt="Ficino's letter to Lorenzo de' Medici in the 1497 Aldine De Mysteriis"
      href={LETTER_PAGE}
      marks={LETTER_MARKS}
      aside={(lit) => (
        <div>
          <p className="text-lg text-secondary mp-q" style={{ opacity: lit > 0 ? 1 : 0.2 }}>Ficino to Lorenzo de&apos; Medici, Cosimo&apos;s grandson:</p>
          <blockquote className="mt-4 font-serif text-xl md:text-2xl text-primary leading-snug mp-q" style={{ opacity: lit > 1 ? 1 : 0.2 }}>
            &ldquo;Synesius, along with Psellus, Iamblichus, Proclus, and Porphyry the Platonists long ago entered your most ample house and greeted your noble sons.&rdquo;
          </blockquote>
          <p className="mt-6 text-lg text-secondary leading-relaxed">He means his translations: the Greek philosophers had arrived in Florence, in Latin.</p>
          <style>{`.mp-q { transition: opacity .6s ease; }`}</style>
        </div>
      )}
      caption={
        <>
          <em>De Mysteriis</em>, printed by Aldus Manutius, Venice 1497.{' '}
          <Link href={LETTER_PAGE} className={link}>Read the page in English</Link>
        </>
      }
    />
  );
}

const DE_VOLUPTATE = '/book/de-voluptate-ficino';
const VOLUPTATE_PAGE = '/book/iamblichus-de-mysteriis-1497-aldine-ficino/page/6959afa11dfc1806c080bdc7';
const VOLUPTATE_MARKS: Mark[] = [
  { x: 34.5, y: 18.0, w: 55.5, h: 1.8 },
  { x: 27.3, y: 20.0, w: 62.5, h: 1.8 },
  { x: 27.3, y: 21.9, w: 62.5, h: 1.8 },
  { x: 27.3, y: 23.8, w: 21.5, h: 1.8 },
  { x: 52, y: 25.7, w: 38, h: 1.8 },
  { x: 27.3, y: 27.7, w: 39, h: 1.8 },
];

/** The opening of Ficino's own book on pleasure, in the 1497 Aldine compendium. */
export function VoluptateFigure() {
  return (
    <MarkedPage
      src="/about/de-voluptate-1497-p324.jpg"
      w={709}
      h={1000}
      alt="The first page of Ficino's book on pleasure, printed by Aldus Manutius in Venice, 1497"
      href={VOLUPTATE_PAGE}
      marks={VOLUPTATE_MARKS}
      aside={(lit) => (
        <div>
          <p className="text-lg text-secondary">Ficino, still in his twenties, opens his book on pleasure:</p>
          <blockquote className="mt-4 font-serif text-xl md:text-2xl text-primary leading-snug">
            <span className="mp-q" style={{ opacity: lit > 0 ? 1 : 0.2 }}>
              &ldquo;I remember when I was with you at your estate in Campolitano. While we were being drawn in by the particular loveliness of that region and the sweetness of the various fruits in which that villa especially abounds, we fell into a discussion about pleasure.
            </span>{' '}
            <span className="mp-q" style={{ opacity: lit > 4 ? 1 : 0.2 }}>
              Therefore, as soon as I returned to Figline, I composed this little work on pleasure for you with the greatest pleasure myself.&rdquo;
            </span>
          </blockquote>
          <p className="mt-6 text-lg text-secondary leading-relaxed">
            We could find no earlier English translation.{' '}
            <Link href={DE_VOLUPTATE} className={link}>Read it in English</Link>
          </p>
          <style>{`.mp-q { transition: opacity .6s ease; }`}</style>
        </div>
      )}
      caption={
        <>
          Ficino, <em>De Voluptate</em>, printed by Aldus Manutius, Venice 1497.{' '}
          <Link href={VOLUPTATE_PAGE} className={link}>Read the page in English</Link>
        </>
      }
    />
  );
}

const WONDER_PAGE = '/book/plato-dialogues-ficino-translation-with-de-amore-translator/page/69b43d4006b196d69f66fcf0';
const WONDER_MARKS: Mark[] = [
  { x: 66.5, y: 35.2, w: 7, h: 1.4 },
  { x: 16.7, y: 36.9, w: 56.5, h: 1.4 },
  { x: 16.7, y: 38.4, w: 14, h: 1.4 },
];

/** Plato's Theaetetus in Ficino's Latin, from the manuscript of the dialogues dedicated to Lorenzo. */
export function WonderFigure() {
  return (
    <MarkedPage
      src="/about/plato-laurenziana-p207.jpg"
      w={657}
      h={1000}
      alt="A handwritten page of Plato's Theaetetus in Ficino's Latin, from a manuscript dedicated to Lorenzo de' Medici"
      href={WONDER_PAGE}
      marks={WONDER_MARKS}
      aside={(lit) => (
        <div>
          <p className="text-lg text-secondary">Socrates to the young Theaetetus, in Ficino&apos;s Latin:</p>
          <blockquote className="mt-4 font-serif text-2xl md:text-3xl text-primary leading-snug mp-q" style={{ opacity: lit > 0 ? 1 : 0.2 }}>
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

const FRIENDSHIP_PAGE = '/book/neoplatonic-translations-ficino-for-cavalcanti-c-1475-translator/page/696925854fa3b04c6de87137';
const FRIENDSHIP_MARKS: Mark[] = [
  { x: 29.5, y: 30.7, w: 37, h: 1.7 },
  { x: 29.5, y: 33.0, w: 37, h: 1.7 },
  { x: 29.5, y: 35.5, w: 31.5, h: 1.7 },
  { x: 61, y: 35.5, w: 5.5, h: 1.7 },
  { x: 17.5, y: 37.7, w: 49, h: 1.7 },
  { x: 17.5, y: 40.0, w: 49, h: 1.7 },
  { x: 17.5, y: 42.8, w: 23, h: 1.7 },
];

/** Ficino's own words: the preface on friendship, written for Giovanni Cavalcanti. */
export function FriendshipFigure() {
  return (
    <MarkedPage
      src="/about/ficino-cavalcanti-p9.jpg"
      w={770}
      h={1000}
      alt="An illuminated manuscript page: Ficino's preface to his friend Giovanni Cavalcanti, about 1475"
      href={FRIENDSHIP_PAGE}
      marks={FRIENDSHIP_MARKS}
      aside={(lit) => (
        <div>
          <p className="text-lg text-secondary">Ficino to his closest friend, Giovanni Cavalcanti:</p>
          <blockquote className="mt-4 font-serif text-xl md:text-2xl text-primary leading-snug">
            <span className="mp-q" style={{ opacity: lit > 0 ? 1 : 0.2 }}>
              &ldquo;True friendship, my dearest Giovanni, the Platonic philosophers have best defined as the stable union of the lives of two people.
            </span>{' '}
            <span className="mp-q" style={{ opacity: lit > 3 ? 1 : 0.2 }}>
              Indeed, we believe that there is only one life in those men who, by a single labor, walk toward a single end, as if by the same path toward the same destination of their journey.&rdquo;
            </span>
          </blockquote>
          <style>{`.mp-q { transition: opacity .6s ease; }`}</style>
        </div>
      )}
      caption={
        <>
          Ficino&apos;s preface to Giovanni Cavalcanti, manuscript of about 1475. University of Pennsylvania Libraries.{' '}
          <Link href={FRIENDSHIP_PAGE} className={link}>Read the page in English</Link>
        </>
      }
    />
  );
}

const COSIMO_PAGE = '/book/ficino-letters-third-manuscript-ficino/page/69b52c053dd6d9423027d61f';
const COSIMO_MARKS: Mark[] = [
  { x: 38.5, y: 13.7, w: 30.5, h: 2.4 },
  { x: 29, y: 16.3, w: 40, h: 2.4 },
  { x: 29, y: 18.9, w: 11, h: 2.4 },
  { x: 57, y: 26.0, w: 12, h: 2.4 },
  { x: 16, y: 28.8, w: 53, h: 2.4 },
  { x: 16, y: 31.5, w: 22, h: 2.4 },
  { x: 38.5, y: 31.5, w: 30.5, h: 2.4 },
  { x: 16, y: 34.1, w: 13, h: 2.4 },
];

/** Cosimo asks Ficino to bring his Plato to Careggi: the first letter in Ficino's letters, in an illuminated Florentine copy. */
export function CosimoFigure() {
  return (
    <MarkedPage
      src="/about/cosimo-letter-p9.jpg"
      w={665}
      h={1000}
      alt="An illuminated manuscript of Ficino's letters, opening with Cosimo de' Medici's letter to Ficino"
      href={COSIMO_PAGE}
      marks={COSIMO_MARKS}
      aside={(lit) => (
        <div>
          <p className="text-lg text-secondary">Cosimo de&apos; Medici to Marsilio Ficino:</p>
          <blockquote className="mt-4 font-serif text-xl md:text-2xl text-primary leading-snug">
            <span className="mp-q" style={{ opacity: lit > 0 ? 1 : 0.2 }}>&ldquo;I betook myself yesterday to the country house at Careggi, for the sake of cultivating not the fields, but the soul.</span>{' '}
            <span className="mp-q" style={{ opacity: lit > 0 ? 1 : 0.2 }}>Come to us, Marsilio, and first bring with you the book of our Plato on the highest good, which I believe you have now translated from the Greek tongue into Latin, as you promised.</span>{' '}
            <span className="mp-q" style={{ opacity: lit > 3 ? 1 : 0.2 }}>For I desire nothing more ardently than to know which way leads most conveniently to happiness.</span>{' '}
            <span className="mp-q" style={{ opacity: lit > 6 ? 1 : 0.2 }}>Farewell, and do not come without your Orphic lyre.&rdquo;</span>
          </blockquote>
          <style>{`.mp-q { transition: opacity .6s ease; }`}</style>
        </div>
      )}
      caption={
        <>
          The first of Ficino&apos;s letters, in a Florentine manuscript of the fifteenth century.{' '}
          <Link href={COSIMO_PAGE} className={link}>Read the page in English</Link>
        </>
      }
    />
  );
}

const LIGHT_PAGE = '/book/hermes-trismegistus-ficino-translation-various-ficino-works-ficino/page/69b4c08586a5921d5bc44294';
const LIGHT_MARKS: Mark[] = [
  { x: 21.5, y: 59.0, w: 40.5, h: 2.2 },
  { x: 16.3, y: 61.3, w: 45.7, h: 2.2 },
  { x: 16.3, y: 63.6, w: 17.5, h: 2.2 },
];

/** Hermes' vision of light, opening Ficino's translation for Cosimo, in an illuminated Florentine copy. */
export function LightFigure() {
  return (
    <MarkedPage
      src="/about/hermes-light-p21.jpg"
      w={622}
      h={1000}
      alt="The illuminated first page of Ficino's Latin Hermes, translated for Cosimo de' Medici"
      href={LIGHT_PAGE}
      marks={LIGHT_MARKS}
      aside={(lit) => (
        <div>
          <p className="text-lg text-secondary">The first book Ficino translated for Cosimo was by Hermes Trismegistus, and it opens with Hermes’ vision:</p>
          <blockquote className="mt-4 font-serif text-2xl md:text-3xl text-primary leading-snug mp-q" style={{ opacity: lit > 0 ? 1 : 0.2 }}>
            &ldquo;For I was beholding an immense spectacle: all things, namely, turned into a light that was exceedingly sweet and pleasant, which wondrously delighted me as I looked upon it.&rdquo;
          </blockquote>
          <style>{`.mp-q { transition: opacity .6s ease; }`}</style>
        </div>
      )}
      caption={
        <>
          Hermes’ <em>Pimander</em> in Ficino&apos;s Latin, headed &ldquo;Mercurius&rdquo; (Hermes&apos; Latin name), in a fifteenth-century Florentine manuscript.{' '}
          <Link href={LIGHT_PAGE} className={link}>Read the page in English</Link>
        </>
      }
    />
  );
}

const LIBRARY_PAGE = '/book/plotinus-enneads-i-xxvi-ficino-translation-dedicatory-copy-translator/page/69b43d3206b196d69f66f226';
const LIBRARY_MARKS: Mark[] = [
  { x: 43, y: 40.3, w: 28, h: 2.0 },
  { x: 19.5, y: 42.6, w: 51, h: 2.0 },
  { x: 52, y: 53.0, w: 19, h: 2.0 },
  { x: 19.5, y: 55.5, w: 51, h: 2.0 },
  { x: 19.5, y: 58.0, w: 51, h: 2.0 },
  { x: 19.5, y: 60.5, w: 21, h: 2.0 },
];

/** Filippo Valori to Lorenzo: Ficino's Plotinus, about to enter the Medici library, dressed for it. */
export function LibraryFigure() {
  return (
    <MarkedPage
      src="/about/plotinus-lorenzo-p9.jpg"
      w={643}
      h={1000}
      alt="The illuminated dedication page of Ficino's Latin Plotinus, made for Lorenzo de' Medici"
      href={LIBRARY_PAGE}
      marks={LIBRARY_MARKS}
      aside={(lit) => (
        <div>
          <p className="text-lg text-secondary">Filippo Valori to Lorenzo de&apos; Medici, on meeting Ficino&apos;s Plotinus at the door:</p>
          <blockquote className="mt-4 font-serif text-xl md:text-2xl text-primary leading-snug">
            <span className="mp-q" style={{ opacity: lit > 0 ? 1 : 0.2 }}>&ldquo;The great-souled Lorenzo is currently restoring that royal library of Ptolemy, that Alexandrian one.</span>{' '}
            <span className="mp-q" style={{ opacity: lit > 2 ? 1 : 0.2 }}>What else is that academy but a kind of nuptial banquet, where the reader&apos;s soul, desirous of wisdom, is joined like a bridegroom with wisdom as if with a bride?&rdquo;</span>
          </blockquote>
          <style>{`.mp-q { transition: opacity .6s ease; }`}</style>
        </div>
      )}
      caption={
        <>
          The copy of Ficino&apos;s Plotinus made for Lorenzo de&apos; Medici. Biblioteca Medicea Laurenziana, Florence.{' '}
          <Link href={LIBRARY_PAGE} className={link}>Read the page in English</Link>
        </>
      }
    />
  );
}

const SOUL_PAGE = '/book/ficino-on-the-immortality-of-souls-ficino/page/69b52bf33dd6d9423027cd9b';
const SOUL_MARKS: Mark[] = [
  { x: 49.5, y: 59.3, w: 21.5, h: 1.8 },
  { x: 17.8, y: 61.3, w: 53, h: 1.8 },
  { x: 17.8, y: 63.3, w: 53, h: 1.8 },
  { x: 17.8, y: 65.2, w: 53, h: 1.8 },
];

/** The first page of Ficino's Platonic Theology, in an illuminated copy dedicated to Lorenzo. */
export function SoulFigure() {
  return (
    <MarkedPage
      src="/about/immortality-p11.jpg"
      w={659}
      h={1000}
      alt="The illuminated first page of Ficino's Platonic Theology on the immortality of souls"
      href={SOUL_PAGE}
      marks={SOUL_MARKS}
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

const COMPENDIUM = '/book/iamblichus-de-mysteriis-1497-aldine-ficino';
const COMPENDIUM_CONTENTS = `${COMPENDIUM}/page/6959afa11dfc1806c080bc8a`;

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
