'use client';

import { useState } from 'react';
import Link from 'next/link';

// Every date, name and phrase below is taken from the article itself (and so from the pages it
// links to). Where the article gives only a century, the mark is a band across that century.
type Item = { from: number; to?: number; label: string; text: string; href?: string };
type Lane = {
  key: string;
  name: string;
  language: string;
  denial: string;
  qualification: string;
  items: Item[];
};

const LANES: Lane[] = [
  {
    key: 'madhyamaka',
    name: 'Nāgārjuna and Candrakīrti',
    language: 'Sanskrit',
    denial: 'Things that arise from conditions have no nature of their own.',
    qualification: 'Emptiness too is “a dependent designation”.',
    items: [
      { from: 100, to: 300, label: '2nd or 3rd century', text: 'Nāgārjuna, Mūlamadhyamakakārikā.' },
      { from: 600, to: 700, label: '7th century', text: 'Candrakīrti, Prasannapadā, the commentary.' },
      { from: 1903, label: '1903', text: 'La Vallée Poussin’s edition, St Petersburg: the copy in this library.', href: '/book/6a3067d0c4fd77fb5b9f8378?page=7' },
    ],
  },
  {
    key: 'chan',
    name: 'Diamond Sutra and Chan',
    language: 'Classical Chinese',
    denial: '“The past mind cannot be grasped”; “originally there is not a single thing”.',
    qualification: 'Wukong: “Do not misunderstand”, and the one phrase “is two phrases”.',
    items: [
      { from: 900, to: 1000, label: '10th century', text: 'Xiufu Wukong leads the Qingliang monastery.' },
      { from: 1252, label: '1252', text: 'The Compendium of the Five Lamps is compiled.', href: '/book/6a3cc1c2ec254ff6cae0ee53?page=152' },
      { from: 1496, label: '1496', text: 'A Korean woodblock of the Diamond Sutra.', href: '/book/69e014d347b76785d4ec8145?page=40' },
      { from: 1787, label: '1787', text: 'The Diamond Sutra commentary printed at the Haizhuang monastery, Guangzhou.', href: '/book/69f1345d365e3fcae574e290?page=51' },
    ],
  },
  {
    key: 'kabbalah',
    name: 'Knorr von Rosenroth on Ayin',
    language: 'Latin on Hebrew',
    denial: 'Ayin, “nothing”, is a title of the Crown.',
    qualification: 'What is understood of the Crown is Nothing.',
    items: [
      { from: 1677, label: '1677', text: 'Kabbala denudata, Sulzbach, with its Latin dictionary of kabbalistic terms.', href: '/book/69804b901fb2ba7cf1d43a18?page=164' },
    ],
  },
  {
    key: 'dionysius',
    name: 'Dionysius and Eck',
    language: 'Latin on Greek',
    denial: 'The cause of all things is not soul, mind, number, unity, goodness or spirit.',
    qualification: 'God is above negation as well as assertion.',
    items: [
      { from: 500, label: 'about 500', text: 'Dionysius the Areopagite, Mystical Theology.' },
      { from: 1100, to: 1200, label: '12th century', text: 'Johannes Sarracenus’s Latin translation.' },
      { from: 1400, to: 1500, label: '15th century', text: 'The Latin translations of Ambrogio Traversari and Marsilio Ficino.' },
      { from: 1519, label: '1519', text: 'Johann Eck’s edition: the Greek, three Latin versions and his commentary.', href: '/book/69c87ff96c6f3cc53c858fd5?page=65' },
    ],
  },
];

const START = 100;
const END = 2000;
const TICKS = [200, 600, 1000, 1400, 1800];
const pct = (year: number) => ((year - START) / (END - START)) * 100;

export default function CommentaryTimeline() {
  const [sel, setSel] = useState<{ lane: number; item: number }>({ lane: 0, item: 1 });
  const lane = LANES[sel.lane];
  const item = lane.items[sel.item];

  return (
    <figure className="not-prose my-12">
      <div className="border border-border-light bg-white p-4 md:p-6 font-sans">
        <p className="text-sm text-primary mb-1">Four commentaries, root text to the copy in this library</p>
        <p className="text-xs text-muted mb-5">Tap or hover a mark. A band is a date the article gives only as a century.</p>

        <div role="listbox" aria-label="Dates of the four root texts, their commentaries and the editions in this library">
          {LANES.map((l, li) => (
            <div key={l.key} className="mb-4">
              <p className={`text-sm mb-1 ${li === sel.lane ? 'text-primary' : 'text-secondary'}`}>
                {l.name} <span className="text-muted">&middot; {l.language}</span>
              </p>
              <div className="relative h-6">
                <div className="absolute inset-x-0 top-1/2 h-px bg-border-light" />
                {l.items.map((it, ii) => {
                  const on = li === sel.lane && ii === sel.item;
                  const left = pct(it.from);
                  const width = it.to ? pct(it.to) - left : 0;
                  const pick = () => setSel({ lane: li, item: ii });
                  return (
                    <button
                      key={it.label}
                      type="button"
                      role="option"
                      aria-selected={on}
                      aria-label={`${l.name}, ${it.label}: ${it.text}`}
                      onMouseEnter={pick}
                      onFocus={pick}
                      onClick={pick}
                      className="absolute top-0 h-6 -translate-x-1/2 flex items-center justify-center"
                      style={{ left: `${left + width / 2}%`, width: `max(${width}%, 22px)` }}
                    >
                      {it.to ? (
                        <span
                          className={`block h-2 w-full rounded ${on ? 'bg-primary' : 'bg-accent-gold-dark'}`}
                        />
                      ) : (
                        <span
                          className={`block rounded-full border-2 border-white ${on ? 'h-3.5 w-3.5 bg-primary' : 'h-3 w-3 bg-accent-gold-dark'}`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="relative h-5 border-t border-border-light">
            {TICKS.map((t) => (
              <span key={t} className="absolute top-1 -translate-x-1/2 text-xs text-muted tabular-nums" style={{ left: `${pct(t)}%` }}>
                {t}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-5 min-h-[3.5rem] text-sm leading-relaxed" aria-live="polite">
          <p className="text-primary">
            <span className="tabular-nums">{item.label}</span> &middot; {lane.name}
          </p>
          <p className="text-muted">
            {item.text}
            {item.href && (
              <>
                {' '}
                <Link href={item.href}>Open the page</Link>
              </>
            )}
          </p>
        </div>

        <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-border-light pt-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">The negation</dt>
            <dd className="text-secondary">{lane.denial}</dd>
          </div>
          <div>
            <dt className="text-muted">Then the commentary qualifies it</dt>
            <dd className="text-secondary">{lane.qualification}</dd>
          </div>
        </dl>
      </div>
      <figcaption className="mt-2 text-sm text-muted leading-relaxed">
        Dates as this article gives them, from the books it links to. The Diamond Sutra, Huineng’s
        verse and Knorr’s Hebrew sources are left off because the article gives them no date.
      </figcaption>
    </figure>
  );
}
