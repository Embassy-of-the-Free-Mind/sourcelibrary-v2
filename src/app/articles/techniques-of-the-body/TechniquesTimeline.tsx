'use client';

import { useState } from 'react';

// When the instructions quoted in the document were written, one dot per text,
// by tradition (the document's sections). Dates are the ones the document itself
// gives for the writing of each text (meta lines, sub-section sources, colophon),
// not the date of the printing or copy the library holds; a century is placed at
// its middle. Texts the document gives no date of writing for are left out.
// Each dot links to its sub-section anchor in the document (no book links here:
// the "Books in this article" order is read from the document).

type Lang = 'en' | 'es';
type T = string | { en: string; es: string };
type Row = { id: string; label: { en: string; es: string } };
type Item = { y: number; d: T; r: string; s: string; l: T };

const ROWS: Row[] = [
  { id: 'china', label: { en: 'China', es: 'China' } },
  { id: 'india', label: { en: 'India', es: 'India' } },
  { id: 'tibet', label: { en: 'Tibet', es: 'Tíbet' } },
  { id: 'greek', label: { en: 'Greek and Roman antiquity', es: 'Antigüedad griega y romana' } },
  { id: 'christian', label: { en: 'Christian Europe and Byzantium', es: 'Europa cristiana y Bizancio' } },
  { id: 'hebrew-arabic', label: { en: 'Hebrew and Arabic', es: 'Hebreo y árabe' } },
  { id: 'early-modern', label: { en: 'Early modern Europe', es: 'Europa en la Edad Moderna' } },
  { id: 'america', label: { en: 'America', es: 'América' } },
];

const C2 = { en: '2nd c.', es: 's. II' };

const ITEMS: Item[] = [
  // China
  { y: 200, d: 'c. 200', r: 'china', s: 'animals', l: { en: 'Hua Tuo, the Five Animal Frolics', es: 'Hua Tuo, los juegos de los cinco animales' } },
  { y: 320, d: 'c. 320', r: 'china', s: 'china-breath', l: 'Ge Hong, Baopuzi' },
  { y: 610, d: '610', r: 'china', s: 'animals', l: 'Chao Yuanfang, Zhubing yuanhou lun' },
  { y: 1609, d: '1609', r: 'china', s: 'year', l: { en: 'Sancai tuhui: the year and the Eight Brocades', es: 'Sancai tuhui: el año y los Ocho Brocados' } },
  { y: 1666, d: '1666', r: 'china', s: 'china-breath', l: 'Chen Zhizun' },
  // India
  { y: 400, d: { en: '4th–5th c.', es: 's. IV–V' }, r: 'india', s: 'india-breath', l: 'Vasubandhu, Abhidharmakośabhāṣya' },
  { y: 1130, d: 'c. 1130', r: 'india', s: 'india-exercise', l: 'Someśvara III, Mānasollāsa' },
  { y: 1450, d: 'c. 1450', r: 'india', s: 'asana', l: 'Svātmārāma, Haṭhayogapradīpikā' },
  { y: 1700, d: 'c. 1700', r: 'india', s: 'kumbhaka', l: { en: 'A Sanskrit leaf at Gangtey', es: 'Una hoja sánscrita en Gangtey' } },
  { y: 1800, d: 'c. 1800', r: 'india', s: 'asana', l: { en: 'Svarodaya, in Hindi', es: 'Svarodaya, en hindi' } },
  { y: 1800, d: 'c. 1800', r: 'india', s: 'plates', l: 'Śrītattvanidhi, Mysore' },
  { y: 1863, d: '1863', r: 'india', s: 'india-breath', l: { en: 'Pañca Pakṣi Śāstra, in Tamil', es: 'Pañca Pakṣi Śāstra, en tamil' } },
  { y: 1922, d: '1922', r: 'india', s: 'plates', l: { en: 'Mallakhamb, in Marathi', es: 'Mallakhamb, en maratí' } },
  // Tibet
  { y: 1700, d: 'c. 1700', r: 'tibet', s: 'tibet-breath', l: 'rDzogs rim man ngag' },
  // Greek and Roman antiquity
  { y: -350, d: { en: '4th c. BC', es: 's. IV a. C.' }, r: 'greek', s: 'gymnasium', l: { en: 'Xenophon, On Horsemanship', es: 'Jenofonte, Sobre la equitación' } },
  { y: 150, d: C2, r: 'greek', s: 'gymnasium', l: { en: 'Galen', es: 'Galeno' } },
  { y: 150, d: C2, r: 'greek', s: 'gymnasium', l: { en: 'Antyllus, in Oribasius', es: 'Antilo, en Oribasio' } },
  { y: 150, d: C2, r: 'greek', s: 'theurgy', l: { en: 'The Chaldean Oracles', es: 'Los Oráculos caldeos' } },
  { y: 150, d: C2, r: 'greek', s: 'drill', l: { en: 'Aelian', es: 'Eliano' } },
  { y: 225, d: { en: '2nd–3rd c.', es: 's. II–III' }, r: 'greek', s: 'philosophers', l: 'Corpus Hermeticum XIII' },
  { y: 300, d: 'c. 300', r: 'greek', s: 'philosophers', l: { en: 'Iamblichus, On the Pythagorean Life', es: 'Jámblico, Sobre la vida pitagórica' } },
  { y: 300, d: 'c. 300', r: 'greek', s: 'theurgy', l: { en: 'Iamblichus, On the Mysteries', es: 'Jámblico, Sobre los misterios' } },
  { y: 350, d: { en: '4th c.', es: 's. IV' }, r: 'greek', s: 'theurgy', l: { en: 'The Mithras Liturgy', es: 'La Liturgia de Mitra' } },
  { y: 400, d: 'c. 400', r: 'greek', s: 'drill', l: { en: 'Vegetius', es: 'Vegecio' } },
  { y: 450, d: { en: '5th c.', es: 's. V' }, r: 'greek', s: 'theurgy', l: { en: 'Proclus, Platonic Theology', es: 'Proclo, Teología platónica' } },
  { y: 486, d: '486', r: 'greek', s: 'philosophers', l: { en: 'Marinus, Life of Proclus', es: 'Marino, Vida de Proclo' } },
  { y: 1450, d: 'c. 1450', r: 'greek', s: 'philosophers', l: { en: 'Plethon, Laws', es: 'Pletón, Leyes' } },
  // Christian Europe and Byzantium
  { y: 420, d: 'c. 420', r: 'christian', s: 'liturgy', l: { en: 'John Cassian', es: 'Juan Casiano' } },
  { y: 725, d: '725', r: 'christian', s: 'fingers', l: { en: 'Bede', es: 'Beda' } },
  { y: 800, d: { en: '8th–9th c.', es: 's. VIII–IX' }, r: 'christian', s: 'liturgy', l: { en: 'Hesychios the Priest', es: 'Hesiquio el Presbítero' } },
  { y: 1350, d: { en: '14th c.', es: 's. XIV' }, r: 'christian', s: 'penance', l: { en: 'Life of Henry Suso', es: 'Vida de Henry Suso' } },
  { y: 1449, d: '1449', r: 'christian', s: 'penance', l: { en: 'An indulgence rubric', es: 'Una rúbrica de indulgencia' } },
  { y: 1539, d: '1539', r: 'christian', s: 'penance', l: 'Sebastian Franck' },
  { y: 1570, d: '1570', r: 'christian', s: 'liturgy', l: 'Missale Romanum' },
  { y: 1615, d: '1615', r: 'christian', s: 'liturgy', l: 'Rituale Romanum' },
  // Hebrew and Arabic
  { y: 1100, d: 'c. 1100', r: 'hebrew-arabic', s: 'prayer', l: 'al-Ghazālī, Iḥyāʾ ʿulūm al-dīn' },
  { y: 1280, d: 'c. 1280', r: 'hebrew-arabic', s: 'name', l: 'Abraham Abulafia' },
  { y: 1700, d: { en: '17th–18th c.', es: 's. XVII–XVIII' }, r: 'hebrew-arabic', s: 'prayer', l: { en: 'Eighteen Chapters', es: 'Dieciocho capítulos' } },
  { y: 1885, d: '1885', r: 'hebrew-arabic', s: 'name', l: { en: 'A Sufi dhikr, in Hughes', es: 'Un dhikr sufí, en Hughes' } },
  // Early modern Europe
  { y: 1489, d: '1489', r: 'early-modern', s: 'regimen', l: 'Ficino, De vita' },
  { y: 1573, d: '1573', r: 'early-modern', s: 'regimen', l: 'Mercuriale, De arte gymnastica' },
  { y: 1589, d: '1589', r: 'early-modern', s: 'arms', l: 'Arbeau, Orchésographie' },
  { y: 1608, d: '1608', r: 'early-modern', s: 'arms', l: 'Jacob de Gheyn' },
  { y: 1610, d: '1610', r: 'early-modern', s: 'regimen', l: 'Guarinoni' },
  { y: 1614, d: '1614', r: 'early-modern', s: 'regimen', l: 'Santorio, De statica medicina' },
  { y: 1628, d: '1628', r: 'early-modern', s: 'arms', l: 'Thibault, Académie de l’espée' },
  { y: 1657, d: '1657', r: 'early-modern', s: 'grimoires', l: 'Ars Notoria' },
  { y: 1658, d: '1658', r: 'early-modern', s: 'wrestling', l: 'Comenius, Orbis pictus' },
  { y: 1674, d: '1674', r: 'early-modern', s: 'wrestling', l: 'Nicolaes Petter' },
  { y: 1750, d: 'c. 1750', r: 'early-modern', s: 'grimoires', l: 'Clavicula Salomonis' },
  { y: 1889, d: '1889', r: 'early-modern', s: 'grimoires', l: 'Mathers, The Greater Key of Solomon' },
  // America
  { y: 1566, d: 'c. 1566', r: 'america', s: 'yucatan', l: 'Diego de Landa' },
  { y: 1577, d: 'c. 1577', r: 'america', s: 'mexico', l: { en: 'Sahagún, the Florentine Codex', es: 'Sahagún, el Códice Florentino' } },
  { y: 1609, d: '1609', r: 'america', s: 'peru', l: 'Garcilaso de la Vega' },
  { y: 1823, d: '1823', r: 'america', s: 'shakers', l: { en: 'Green and Wells', es: 'Green y Wells' } },
  { y: 1848, d: '1848', r: 'america', s: 'shakers', l: 'David R. Lamson' },
  { y: 1896, d: '1896', r: 'america', s: 'ghost-dance', l: 'James Mooney' },
  { y: 1902, d: '1902', r: 'america', s: 'night-chant', l: 'Washington Matthews' },
];

const COPY = {
  en: {
    title: 'When the instructions were written',
    note: 'Each dot is a text quoted below, placed at the date this page gives for its writing, not the date of the printing or copy the library holds; a century is placed at its middle. Select a dot to see which text it is, and follow the link to its entry.',
    pick: 'Select a dot.',
    go: 'Go to the entry',
    list: 'The same as a list',
    bc: 'BC',
    ad: 'AD',
  },
  es: {
    title: 'Cuándo se escribieron las instrucciones',
    note: 'Cada punto es un texto citado más abajo, situado en la fecha que esta página da para su redacción, no en la de la edición o copia que conserva la biblioteca; un siglo se sitúa en su mitad. Seleccione un punto para ver de qué texto se trata y siga el enlace hasta su entrada.',
    pick: 'Seleccione un punto.',
    go: 'Ir a la entrada',
    list: 'Lo mismo, como lista',
    bc: 'a. C.',
    ad: 'd. C.',
  },
};

const t = (v: T, lang: Lang) => (typeof v === 'string' ? v : v[lang]);

// Geometry, in viewBox units. Two drawings of the same data: a wide one for the
// column, a narrower one (bigger type and dots relative to the width) for phones;
// CSS shows one. Rows grow to fit the dots stacked where dates are close.
const Y0 = -400;
const Y1 = 1950;
type Geo = { W: number; R: number; label: number; gap: number; pad: number; ticks: number[] };
const GEO: Record<'wide' | 'narrow', Geo> = {
  wide: { W: 1000, R: 6.5, label: 20, gap: 3, pad: 14, ticks: [-400, 1, 500, 1000, 1500, 1900] },
  narrow: { W: 520, R: 7, label: 24, gap: 2, pad: 12, ticks: [-400, 500, 1000, 1500, 1900] },
};
const PAD_L = 8;
const PAD_R = 22;

function layout(g: Geo) {
  const x = (year: number) => PAD_L + ((year - Y0) / (Y1 - Y0)) * (g.W - PAD_L - PAD_R);
  const step = 2 * g.R + 2;
  const dots: { i: number; cx: number; cy: number }[] = [];
  const rows: { id: string; top: number; base: number }[] = [];
  let top = 0;
  for (const row of ROWS) {
    const inRow = ITEMS.map((it, i) => ({ it, i })).filter((e) => e.it.r === row.id).sort((a, b) => a.it.y - b.it.y);
    const done: { cx: number; lift: number; i: number }[] = [];
    for (const { it, i } of inRow) {
      const cx = x(it.y);
      let lift = 0;
      while (done.some((d) => d.lift === lift && Math.abs(d.cx - cx) < 2 * g.R + g.gap)) lift += 1;
      done.push({ cx, lift, i });
    }
    const maxLift = Math.max(0, ...done.map((d) => d.lift));
    const base = top + g.label + 6 + maxLift * step + g.R + 2;
    for (const d of done) dots.push({ i: d.i, cx: d.cx, cy: base - d.lift * step });
    rows.push({ id: row.id, top, base });
    top = base + g.R + g.pad;
  }
  return { x, dots, rows, H: top + 26 };
}

const LAYOUT = { wide: layout(GEO.wide), narrow: layout(GEO.narrow) };

export default function TechniquesTimeline({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const [active, setActive] = useState<number | null>(null);
  const cur = active === null ? null : ITEMS[active];
  const yearLabel = (y: number) => (y < 0 ? `${-y} ${c.bc}` : y === 1 ? `1 ${c.ad}` : String(y));

  const chart = (kind: 'wide' | 'narrow') => {
    const g = GEO[kind];
    const { x, dots, rows, H } = LAYOUT[kind];
    return (
      <svg
        viewBox={`0 0 ${g.W} ${H}`}
        role="group"
        aria-label={c.title}
        className={`tl-svg tl-${kind}`}
        onMouseLeave={() => setActive(null)}
      >
        {g.ticks.map((y) => (
          <g key={y}>
            <line x1={x(y)} x2={x(y)} y1={0} y2={H - 24} className="tl-grid" />
            <text x={x(y)} y={H - 6} textAnchor={y === Y0 ? 'start' : 'middle'} className="tl-tick">{yearLabel(y)}</text>
          </g>
        ))}
        {rows.map((row, ri) => (
          <g key={row.id}>
            <text x={PAD_L} y={row.top + g.label - 4} className="tl-row">{ROWS[ri].label[lang]}</text>
            <line x1={PAD_L} x2={g.W - PAD_R} y1={row.base} y2={row.base} className="tl-base" />
          </g>
        ))}
        {dots.map(({ i, cx, cy }) => {
          const it = ITEMS[i];
          return (
            <a
              key={i}
              href={`#${it.s}`}
              aria-label={`${t(it.l, lang)}, ${t(it.d, lang)}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={(e) => {
                // on a touch screen the first tap selects; the link under the chart goes there
                if (active !== i) {
                  e.preventDefault();
                  setActive(i);
                }
              }}
            >
              <circle cx={cx} cy={cy} r={g.R + 6} className="tl-hit" />
              <circle cx={cx} cy={cy} r={g.R} className={active === i ? 'tl-dot on' : 'tl-dot'} />
            </a>
          );
        })}
      </svg>
    );
  };

  return (
    <figure className="tl" aria-labelledby="tl-title">
      <p id="tl-title" className="tl-title">{c.title}</p>
      {chart('wide')}
      {chart('narrow')}
      <p className="tl-info" aria-live="polite">
        {cur ? (
          <>
            <b>{t(cur.l, lang)}</b>, {t(cur.d, lang)} · <a href={`#${cur.s}`}>{c.go}</a>
          </>
        ) : (
          c.pick
        )}
      </p>
      <figcaption className="tl-note">{c.note}</figcaption>
      <details className="tl-list">
        <summary>{c.list}</summary>
        {ROWS.map((row) => (
          <div key={row.id}>
            <p className="tl-list-h">{row.label[lang]}</p>
            <ul>
              {ITEMS.filter((it) => it.r === row.id)
                .sort((a, b) => a.y - b.y)
                .map((it) => (
                  <li key={`${it.s}-${t(it.l, 'en')}`}>
                    <a href={`#${it.s}`}>{t(it.l, lang)}</a>, {t(it.d, lang)}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </details>
    </figure>
  );
}
