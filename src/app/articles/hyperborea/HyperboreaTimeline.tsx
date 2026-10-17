'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

/**
 * Where writers put Hyperborea, by date. Every entry, date and place is taken
 * from the article text; links go to the page the article cites. The time
 * axis jumps from 200 CE to 1580, because the article has no Hyperborea
 * claims in between.
 */

type Lane = 'reach' | 'celts' | 'britain' | 'sweden' | 'baltic' | 'steppe' | 'pole';

const LANES: { id: Lane; label: string }[] = [
  { id: 'reach', label: 'Out of reach, at the top of the world' },
  { id: 'celts', label: 'The Celts and the Alps' },
  { id: 'britain', label: 'Britain and the Hebrides' },
  { id: 'sweden', label: 'Sweden' },
  { id: 'baltic', label: 'The Baltic amber coast' },
  { id: 'steppe', label: 'The steppe and Russia' },
  { id: 'pole', label: 'The North Pole' },
];

type Entry = {
  who: string;
  year: number;
  when: string;
  lane: Lane;
  claim: string;
  href?: string;
  /** vertical offset in px, to separate dots that fall on the same year */
  nudge?: number;
};

const ENTRIES: Entry[] = [
  { who: 'Pindar', year: -498, when: '498 BCE', lane: 'reach', claim: 'Neither by ships nor by land can the road to the Hyperboreans be found.', href: '/book/the-odes-of-pindar-sandys?page=347' },
  { who: 'Herodotus, after Aristeas', year: -440, when: '5th century BCE', lane: 'steppe', claim: 'Past the Scythians to the Issedones, then the one-eyed Arimaspians, the griffins, and last the Hyperboreans by the sea.', href: '/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=235' },
  { who: 'Hellanicus', year: -430, when: '5th century BCE', lane: 'celts', claim: 'The Hyperboreans live beyond the Alps of Italy.', href: '/book/argonautica-editio-princeps-lascaris-rhodius?page=159' },
  { who: 'Heraclides of Pontus', year: -350, when: '4th century BCE', lane: 'celts', claim: 'The Gauls who sacked Rome in 390 BCE were an army from the country of the Hyperboreans.', href: '/book/histoire-des-celtes-pelloutier?page=68' },
  { who: 'Hecataeus of Abdera', year: -300, when: 'c. 300 BCE', lane: 'celts', claim: 'An island in the ocean opposite the land of the Celts, no smaller than Sicily, with a round temple.' },
  { who: 'Apollonius of Rhodes', year: -250, when: '3rd century BCE', lane: 'celts', claim: 'The Celts say the amber in the Eridanus is the tears Apollo shed among the Hyperboreans.', href: '/book/apollonii-rhodii-argonautica-estienne?page=210' },
  { who: 'Pliny the Elder', year: 75, when: '1st century CE', lane: 'reach', claim: 'Behind the Rhipaean mountains, where the sun rises and sets once a year.' },
  { who: 'Pausanias', year: 160, when: '2nd century CE', lane: 'steppe', claim: 'The offerings pass from the Hyperboreans to the Arimaspians, the Issedonians and the Scythians, then to Sinope.', href: '/book/pausanias-description-of-greece-vol-1-frazer?page=148' },
  { who: 'Philipp Clüver', year: 1616, when: '1616', lane: 'baltic', claim: 'The amber river Eridanus was the Radaune, which reaches the sea at Danzig.', href: '/book/germaniae-antiquae-libri-tres-cluver?page=886' },
  { who: 'Olof Rudbeck', year: 1679, when: '1679–1702', lane: 'sweden', claim: 'Sweden was both Atlantis and Hyperborea; the Hyperboreans were the nobly born Swedes.', href: '/book/hymni-epigrammata-et-fragmenta-callimachus?page=563' },
  { who: 'Christoph Hartknoch', year: 1684, when: '1684', lane: 'baltic', claim: 'Diodorus’s amber island Basilia was Samland. He does not claim the Hyperboreans for Prussia.', href: '/book/old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch?page=36' },
  { who: 'John Toland', year: 1740, nudge: -7, when: '1740', lane: 'britain', claim: 'The Hebrides were the Hyperboreans of Diodorus, and Abaris a Druid.', href: '/book/a-critical-history-of-the-celtic-religion-and-learning-toland?page=203' },
  { who: 'William Stukeley', year: 1740, nudge: 7, when: '1740', lane: 'britain', claim: 'Diodorus’s account seems to hold some reports of Stonehenge itself.', href: '/book/stonehenge-stukeley?page=161' },
  { who: 'John Wood', year: 1747, when: '1747', lane: 'britain', claim: 'Abaris and Bladud, the legendary founder of Bath, were one and the same man.', href: '/book/choir-gaure-vulgarly-called-stonehenge-on-salisbury-plain-wood?page=9' },
  { who: 'William Borlase', year: 1769, when: '1769', lane: 'britain', claim: 'Read Diodorus’s round temple into Cornwall.', href: '/book/antiquities-historical-and-monumental-of-the-county-of-borlase?page=114' },
  { who: 'Jean-Sylvain Bailly', year: 1775, when: '1770s', lane: 'pole', claim: 'The sciences were invented by a lost northern people.' },
  { who: 'Richard Payne Knight', year: 1786, when: '1786', lane: 'britain', claim: 'The island can be no other than Britain.', href: '/book/an-account-of-the-remains-of-the-worship-of-priapus?page=140' },
  { who: 'Godfrey Higgins', year: 1827, when: '1827', lane: 'britain', claim: 'By the Hyperboreans the Greeks generally meant the British isles.', href: '/book/the-celtic-druids-higgins?page=346' },
  { who: 'Teodor Narbutt', year: 1835, when: '1835', lane: 'baltic', claim: 'The Hyperborean Apollo was the sun worshipped by the Baltic Sea.', href: '/book/ancient-history-of-the-lithuanian-nation-vol-1-lithuanian-narbutt?page=37' },
  { who: 'Alexander Herzen', year: 1869, when: '1869', lane: 'steppe', claim: 'A French doctor greets the Russian narrator as “my dear Hyperborean”.', href: '/book/2-herzen?page=239' },
  { who: 'William Warren', year: 1885, nudge: -6, when: '1885', lane: 'pole', claim: 'Eden lay at the North Pole.' },
  { who: 'Helena Blavatsky', year: 1888, nudge: 6, when: '1888', lane: 'pole', claim: 'The Hyperboreans were the second root race; the amber proves the Eridanus was northern.', href: '/book/the-secret-doctrine-synthesis-of-science-religion-and-blavatsky?page=838' },
  { who: 'Bal Gangadhar Tilak', year: 1903, when: '1903', lane: 'pole', claim: 'Put the home of the Aryans at the North Pole.' },
  { who: 'Thule Society', year: 1918, when: '1918', lane: 'pole', claim: 'Gave Pytheas’s Thule the qualities of Hyperborea and made it a lost Aryan homeland.' },
  { who: 'Alexander Barchenko', year: 1922, when: '1922', lane: 'steppe', claim: 'Led an expedition to the Kola Peninsula in search of an ancient northern civilisation.' },
  { who: 'Russian esoteric writers', year: 1995, when: 'since the 1990s', lane: 'steppe', claim: 'Aleksandr Dugin among them, place Hyperborea in the Russian Arctic.' },
];

// Two time segments, joined by a break.
const A = { from: -520, to: 200, x0: 6, x1: 44 };
const B = { from: 1580, to: 2010, x0: 50, x1: 95 };

function xOf(year: number) {
  const s = year <= A.to ? A : B;
  return s.x0 + ((year - s.from) / (s.to - s.from)) * (s.x1 - s.x0);
}

const TICKS: { year: number; label: string; wide?: boolean }[] = [
  { year: -500, label: '500 BCE' },
  { year: -300, label: '300 BCE', wide: true },
  { year: -100, label: '100 BCE' },
  { year: 100, label: '100 CE', wide: true },
  { year: 1600, label: '1600' },
  { year: 1700, label: '1700', wide: true },
  { year: 1800, label: '1800' },
  { year: 1900, label: '1900', wide: true },
  { year: 2000, label: '2000' },
];

export default function HyperboreaTimeline() {
  const ordered = useMemo(() => [...ENTRIES].sort((a, b) => a.year - b.year), []);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setActive((i) => {
        if (i >= ordered.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 1700);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, ordered.length]);

  const current = ordered[active];
  const seen = playing ? active : ordered.length - 1;

  return (
    <figure className="not-prose my-12 font-sans">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
        <figcaption className="text-base text-primary font-medium">Where writers put Hyperborea</figcaption>
        <button
          type="button"
          onClick={() => {
            if (playing) {
              setPlaying(false);
            } else {
              setActive(0);
              setPlaying(true);
            }
          }}
          className="text-sm border border-border-medium rounded-full px-4 py-1.5 text-primary hover:bg-warm transition-colors"
        >
          {playing ? 'Stop' : 'Play in order'}
        </button>
      </div>

      <div className="relative">
        {LANES.map((lane) => (
          <div key={lane.id} className="relative pt-1 pb-1">
            <div className="text-xs text-muted leading-tight">{lane.label}</div>
            <div className="relative h-7">
              <div className="absolute top-1/2 h-px bg-border-medium" style={{ left: `${A.x0}%`, width: `${A.x1 - A.x0}%` }} />
              <div className="absolute top-1/2 h-px bg-border-medium" style={{ left: `${B.x0}%`, width: `${B.x1 - B.x0}%` }} />
              {ordered.map((e, i) => {
                if (e.lane !== lane.id) return null;
                const isActive = i === active;
                const hidden = i > seen;
                return (
                  <button
                    key={e.who}
                    type="button"
                    aria-label={`${e.who}, ${e.when}`}
                    aria-pressed={isActive}
                    onMouseEnter={() => !playing && setActive(i)}
                    onFocus={() => !playing && setActive(i)}
                    onClick={() => {
                      setPlaying(false);
                      setActive(i);
                    }}
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
                    style={{
                      left: `${xOf(e.year)}%`,
                      marginTop: e.nudge ?? 0,
                      opacity: hidden ? 0 : 1,
                      transition: 'opacity 400ms ease',
                      zIndex: isActive ? 2 : 1,
                    }}
                  >
                    <span
                      className="block"
                      style={{
                        borderRadius: '50%',
                        width: isActive ? 14 : 10,
                        height: isActive ? 14 : 10,
                        background: isActive ? 'var(--text-primary)' : 'var(--accent-gold-dark)',
                        boxShadow: '0 0 0 2px var(--bg-cream, #fdfcf9)',
                        transition: 'width 200ms, height 200ms, background 200ms',
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Time axis */}
        <div className="relative h-6 mt-1 border-t border-border-light">
          {TICKS.map((t) => (
            <span
              key={t.year}
              className={`absolute top-1 -translate-x-1/2 text-[11px] text-muted whitespace-nowrap ${t.wide ? 'hidden sm:inline' : ''}`}
              style={{ left: `${xOf(t.year)}%` }}
            >
              {t.label}
            </span>
          ))}
          <span
            className="absolute -top-2 -translate-x-1/2 text-xs text-muted"
            style={{ left: `${(A.x1 + B.x0) / 2}%` }}
            aria-hidden
          >
            {'//'}
          </span>
        </div>
      </div>

      <div className="mt-4 min-h-[5.5rem] border-l-2 border-accent-gold/60 pl-4" aria-live="polite">
        <div className="text-sm text-primary">
          <span className="font-medium">{current.who}</span>
          <span className="text-muted">, {current.when}</span>
        </div>
        <p className="text-sm text-secondary leading-relaxed mt-1">
          {current.claim}
          {current.href && (
            <>
              {' '}
              <Link href={current.href}>Read the page</Link>
            </>
          )}
        </p>
      </div>

      <p className="mt-3 text-xs text-muted leading-relaxed">
        Hover, tap or tab through the dots, or play them in date order. Names, dates and places as this article gives
        them, from the books it cites; ancient dates are approximate. The time axis skips from 200 CE to 1580, where the
        article has no claims.
      </p>
    </figure>
  );
}
