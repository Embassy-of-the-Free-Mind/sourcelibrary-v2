'use client';

import { useRef, useState } from 'react';

// Every date below is the one this article gives for a picture or book it shows or links,
// or, for the museum prints, the date on the holding museum's record. Undated items
// (the Codex Laud, the Qazwini and Arabic logic manuscripts, the Greek Porphyry, the
// refuge-tree thangka) are left out.
type Item = { year: number; when: string; what: string };
type Row = { id: string; label: string; items: Item[] };

export const TREE_ROWS: Row[] = [
  {
    id: 'kabbalah',
    label: 'Kabbalah',
    items: [
      { year: 1450, when: '15th century', what: 'Isaac of Acre, Me’irat Einayim, manuscript copy' },
      { year: 1573, when: '1573', what: 'Evoli, De divinis attributis' },
      { year: 1652, when: '1652–54', what: 'Kircher, Systema Sephiroticum' },
      { year: 1660, when: '1660', what: 'Hackspan, Arbor Cabbalistica' },
      { year: 1677, when: '1677', what: 'Knorr von Rosenroth, Kabbala denudata' },
    ],
  },
  { id: 'inverted-tree', label: 'Inverted tree', items: [{ year: 1621, when: '1621', what: 'Fludd, Utriusque Cosmi Historia' }] },
  {
    id: 'norse',
    label: 'Norse',
    items: [
      { year: 1908, when: '1908', what: 'Bray, The Elder or Poetic Edda' },
      { year: 1928, when: '1928', what: 'Hall, The Yggdrasil Tree' },
    ],
  },
  { id: 'siberia', label: 'Siberia', items: [{ year: 1927, when: '1927', what: 'Holmberg, Yakut and Dolgan trees' }] },
  {
    id: 'prussia',
    label: 'Prussia',
    items: [
      { year: 1684, when: '1684', what: 'Hartknoch, the oak of Romowe' },
      { year: 1777, when: '1777', what: 'Die isländische Edda reprints it' },
    ],
  },
  {
    id: 'assyria',
    label: 'Assyria',
    items: [
      { year: 1849, when: '1849', what: 'Layard, Nineveh and Its Remains' },
      { year: 1883, when: '1883', what: 'Forlong, Rivers of Life' },
    ],
  },
  {
    id: 'egypt',
    label: 'Egypt',
    items: [
      { year: -1250, when: 'c. 1250 BCE', what: 'Papyrus of Ani, the goddess in the sycamore' },
      { year: 1841, when: '1841', what: 'Wilkinson draws the persea relief' },
    ],
  },
  {
    id: 'china',
    label: 'China',
    items: [
      { year: -1200, when: 'c. 1200 BCE', what: 'Bronze tree, Sanxingdui' },
      { year: -168, when: 'before 168 BCE', what: 'Mawangdui banner' },
      { year: 120, when: '25–220 CE', what: 'Eastern Han money tree' },
      { year: 150, when: 'mid-2nd century CE', what: 'Wu Liang shrines, the Fusang tree' },
    ],
  },
  {
    id: 'eden',
    label: 'Eden and Jesse',
    items: [
      { year: 1473, when: '1473', what: 'Speculum humanae salvationis, the rod of Jesse' },
      { year: 1476, when: '1476', what: 'Spiegel menschlicher Behaltnuss, the Fall' },
      { year: 1490, when: 'late 15th century', what: 'Van Meckenem, Tree of Jesse' },
      { year: 1604, when: '1604', what: 'Saenredam, Adam and Eve' },
      { year: 1621, when: '1621', what: 'Callot, The Tree of Saint Francis' },
      { year: 1702, when: '1702', what: 'History of the Old and New Testaments' },
    ],
  },
  {
    id: 'islam',
    label: 'Islam',
    items: [
      { year: 1326, when: 'c. 1317–35', what: 'Miʿrājnāma, Bilal before the lote tree' },
      { year: 1400, when: 'c. 1400', what: 'Kitāb al-Bulhān, the Waqwaq tree' },
      { year: 1436, when: '1436', what: 'Miʿrājnāma, Herat, the gardens of paradise' },
    ],
  },
  { id: 'java', label: 'Java', items: [{ year: 1984, when: '1984', what: 'Kilatbuwana, the kayon' }] },
  {
    id: 'alchemy',
    label: 'Alchemy',
    items: [
      { year: 1415, when: 'early 15th century', what: 'Buch der heiligen Dreifaltigkeit' },
      { year: 1588, when: '1588', what: 'Pandora' },
      { year: 1598, when: '1598', what: 'Trismosin, Aureum vellus' },
      { year: 1659, when: '1659', what: 'Basil Valentine, Azoth' },
      { year: 1667, when: '1667', what: 'Dreyfaches hermetisches Kleeblat' },
    ],
  },
  {
    id: 'bohme',
    label: 'Böhme',
    items: [
      { year: 1700, when: '1700', what: 'Der richtigste Weg durch Christum zu Gott' },
      { year: 1720, when: 'c. 1720', what: 'Freher, emblem manuscript' },
      { year: 1764, when: '1764–81', what: 'The Works of Jacob Behmen' },
      { year: 1785, when: '1785–88', what: 'Geheime Figuren der Rosenkreuzer' },
    ],
  },
  {
    id: 'knowledge',
    label: 'Knowledge and kinship',
    items: [
      { year: 1483, when: '1483', what: 'Isidore, Etymologiae, tree of consanguinity' },
      { year: 1515, when: '1515', what: 'Llull, Arbor scientiae' },
      { year: 1859, when: '1859', what: 'Darwin, On the Origin of Species' },
    ],
  },
  {
    id: 'living',
    label: 'Living trees',
    items: [
      { year: 850, when: '9th century', what: 'Prambanan, kalpataru relief' },
      { year: 1723, when: '1723', what: 'Picart, the great banyan' },
      { year: 1901, when: '1901', what: 'Grünwedel, Buddhist Art in India' },
      { year: 1910, when: '1910', what: 'Dennett, Nigerian Studies' },
    ],
  },
];

// Two linked scales: 1300 BCE to 1400 CE squeezed into the first 30 per cent, 1400 to 2000 in the rest.
const BREAK = 1400;
const SPLIT = 30;
function pos(year: number): number {
  if (year <= BREAK) return 2 + ((year + 1300) / (BREAK + 1300)) * (SPLIT - 2);
  return SPLIT + ((year - BREAK) / (2000 - BREAK)) * (98 - SPLIT);
}
const TICKS: { year: number; label: string; wideOnly?: boolean }[] = [
  { year: -1000, label: '1000 BCE' },
  { year: 1, label: '1 CE', wideOnly: true },
  { year: 1400, label: '1400' },
  { year: 1600, label: '1600' },
  { year: 1800, label: '1800' },
  { year: 2000, label: '2000' },
];

// Dots closer than this (in per cent of the strip) alternate above and below the line.
const NEAR = 4;
const LANE_OFFSET = [0, -8, 8];
const LANES: Map<Item, number> = new Map();
for (const r of TREE_ROWS) {
  let prev: number | null = null;
  let lane = 0;
  for (const it of r.items) {
    const x = pos(it.year);
    lane = prev !== null && x - prev < NEAR ? (lane % 2) + 1 : 0;
    LANES.set(it, lane);
    prev = x;
  }
}

const FLAT = TREE_ROWS.flatMap((r) => r.items.map((it) => ({ ...it, row: r })));

export default function TreeTimeline() {
  const [active, setActive] = useState(() => FLAT.findIndex((f) => f.year === 1859));
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const a = FLAT[active];

  const step = (d: number) => {
    // Step in date order across all rows.
    const order = FLAT.map((f, i) => ({ y: f.year, i })).sort((p, q) => p.y - q.y || p.i - q.i);
    const k = order.findIndex((o) => o.i === active);
    const next = order[Math.min(order.length - 1, Math.max(0, k + d))].i;
    setActive(next);
    buttons.current[next]?.focus();
  };

  let flatIndex = 0;
  return (
    <figure className="not-prose my-12">
      <div className="border border-border-light bg-white p-4 md:p-6 font-sans">
        <p className="text-sm text-primary mb-1">When the pictures in this article were made</p>
        <p className="text-xs text-muted mb-4">
          One dot per picture or book, by section. Hover or tap a dot; arrow keys step through them in date order.
        </p>
        <div
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
          }}
        >
          {TREE_ROWS.map((r) => (
            <div key={r.id} className="flex items-center gap-2 border-b border-border-light/60 last:border-b-0">
              <a href={`#${r.id}`} className="w-24 md:w-40 shrink-0 text-xs md:text-sm text-secondary leading-tight py-1.5 no-underline">
                {r.label}
              </a>
              <div className="relative flex-1 h-9">
                <div className="absolute top-1/2 h-px w-full bg-border-light" aria-hidden />
                <div className="absolute top-0 bottom-0 border-l border-dashed border-border-light" style={{ left: `${SPLIT}%` }} aria-hidden />
                {r.items.map((it) => {
                  const i = flatIndex++;
                  const on = i === active;
                  return (
                    <button
                      key={it.what}
                      ref={(el) => { buttons.current[i] = el; }}
                      type="button"
                      aria-label={`${it.when}: ${it.what}`}
                      aria-pressed={on}
                      tabIndex={on ? 0 : -1}
                      onMouseEnter={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onClick={() => setActive(i)}
                      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-4 w-6 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
                      style={{ left: `${pos(it.year)}%`, marginTop: LANE_OFFSET[LANES.get(it) ?? 0] }}
                    >
                      <span
                        className="block border-2 border-white transition-all"
                        style={{
                          width: on ? 14 : 10,
                          height: on ? 14 : 10,
                          background: on ? 'var(--color-primary)' : 'var(--color-accent-gold-dark)',
                        }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <div className="w-24 md:w-40 shrink-0" />
            <div className="relative flex-1 h-6 text-[11px] text-muted tabular-nums">
              {TICKS.map((t) => (
                <span
                  key={t.year}
                  className={`absolute top-1 -translate-x-1/2 whitespace-nowrap ${t.wideOnly ? 'hidden sm:inline' : ''}`}
                  style={{ left: `${pos(t.year)}%` }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 min-h-[3.5rem] text-sm leading-relaxed" aria-live="polite">
          <p className="text-primary">
            <span className="tabular-nums">{a.when}</span> &middot; {a.row.label}
          </p>
          <p className="text-muted">
            {a.what}. <a href={`#${a.row.id}`}>Go to the section</a>
          </p>
        </div>
      </div>
      <figcaption className="mt-2 text-sm text-muted leading-relaxed">
        Dates as this article gives them for its pictures and linked books; the museum prints are dated from the
        museums&apos; records. The time scale changes at 1400 (dashed line): everything before it is squeezed into the
        first third. Undated manuscripts and the thangka are left out.
      </figcaption>
    </figure>
  );
}
