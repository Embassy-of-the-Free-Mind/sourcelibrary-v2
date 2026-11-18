import { ReactNode } from 'react';

/**
 * Pieces for the article "What the Bath Does" (src/app/articles/what-the-bath-does):
 * headings, quotation parts and its two drawn figures.
 *
 * Quotations use SourceQuote (the page beside the words).
 */

export function Section({ children }: { children: ReactNode }) {
  return <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">{children}</h2>;
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="text-xl text-primary mt-12 mb-4">{children}</h3>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-secondary leading-relaxed mb-6">{children}</p>;
}

/** The source line under a story. */
export function SourceNote({ children }: { children: ReactNode }) {
  return <p className="font-sans text-sm text-muted leading-relaxed mt-2 mb-10">{children}</p>;
}

/** The place or person a voice speaks for. */
export function VoiceHead({ children, level = 'h3' }: { children: ReactNode; level?: 'h3' | 'h4' }) {
  return level === 'h3' ? (
    <h3 className="text-xl text-primary mt-12 -mb-6">{children}</h3>
  ) : (
    <h4 className="text-lg text-primary mt-10 -mb-6">{children}</h4>
  );
}

/** Original-language text inside a quotation. */
export function Orig({ lang, dir, children }: { lang: string; dir?: 'rtl'; children: ReactNode }) {
  return (
    <p lang={lang} dir={dir} className="text-secondary italic">
      {children}
    </p>
  );
}

/** Our rendering of a passage the library has no English for yet. */
export function Gloss({ children }: { children: ReactNode }) {
  return (
    <p>
      {children} <span className="font-sans text-sm text-muted not-italic">(our translation)</span>
    </p>
  );
}

/** Soaks in a day and a night by constitution, from the Atami guide (scan 10). */
export function SoaksChart() {
  const rows = [
    { label: 'weak, or sick', lo: 2, hi: 3, text: 'two or three' },
    { label: 'ordinary strength', lo: 4, hi: 5, text: 'four or five' },
    { label: 'born strong', lo: 5, hi: 6, text: 'five or six' },
  ];
  const x0 = 200;
  const unit = 60;
  return (
    <figure className="not-prose my-10">
      <svg
        viewBox="0 0 860 250"
        role="img"
        className="w-full h-auto font-sans text-secondary"
        aria-label="Bar chart of soaks in a day and a night by constitution, from the Atami guide: weak or sick two to three, ordinary strength four to five, born strong five to six."
      >
        <g fontSize="13" fill="currentColor">
          {[0, 2, 4, 6].map(v => (
            <text key={v} x={x0 + v * unit} y="232" textAnchor="middle">
              {v}
            </text>
          ))}
        </g>
        <g stroke="currentColor" strokeOpacity="0.35" strokeWidth="1">
          {[0, 2, 4, 6].map(v => (
            <line key={v} x1={x0 + v * unit} y1="30" x2={x0 + v * unit} y2="215" strokeDasharray={v ? '2 4' : undefined} />
          ))}
        </g>
        {rows.map((r, i) => {
          const y = 44 + i * 60;
          return (
            <g key={r.label}>
              <text x="185" y={y + 18} textAnchor="end" fontSize="15" fontStyle="italic" fill="currentColor">
                {r.label}
              </text>
              <rect x={x0} y={y} width={r.lo * unit} height="26" className="fill-accent-gold" />
              <rect x={x0 + r.lo * unit} y={y} width={(r.hi - r.lo) * unit} height="26" className="fill-accent-gold" fillOpacity="0.4" />
              <text x={x0 + r.hi * unit + 12} y={y + 18} fontSize="13" fill="currentColor">
                {r.text}
              </text>
            </g>
          );
        })}
        <text x="860" y="248" textAnchor="end" fontSize="13" fill="currentColor">
          soaks in a day and a night
        </text>
      </svg>
      <figcaption className="mt-2 text-sm text-muted leading-relaxed">
        Soaks in a day and a night, by constitution, as the Atami guide gives them. The pale end of each bar is the upper
        figure. &ldquo;In general, more than this does harm.&rdquo;
      </figcaption>
    </figure>
  );
}

/** Four ways of dividing a shared bath, drawn from the sources' descriptions. */
export function SharingPlans() {
  const plan = 'fill-none stroke-current';
  return (
    <figure className="not-prose my-10">
      <svg
        viewBox="0 0 860 270"
        role="img"
        className="w-full h-auto font-sans text-secondary"
        aria-label="Four small plans: one bath used by men in the morning and women after; two baths side by side, one for men and one for women; one room divided by boards with a single door; a bath hut with separate tubs for men, for women, and for the sick."
      >
        <g fill="currentColor" fontSize="13">
          {/* 1 by hours */}
          <g transform="translate(10,20)">
            <rect x="0" y="20" width="190" height="120" className={plan} strokeWidth="1.2" />
            <line x1="0" y1="80" x2="190" y2="80" stroke="currentColor" strokeDasharray="3 4" strokeWidth="1" />
            <text x="95" y="56" textAnchor="middle" fontStyle="italic" fontSize="15">men, morning</text>
            <text x="95" y="116" textAnchor="middle" fontStyle="italic" fontSize="15">women, after</text>
            <text x="95" y="168" textAnchor="middle" fontSize="15" fontWeight="600">by hours</text>
            <text x="95" y="188" textAnchor="middle">al-Maqrizi, Cairo</text>
          </g>
          {/* 2 twin baths */}
          <g transform="translate(225,20)">
            <rect x="0" y="20" width="88" height="120" className={plan} strokeWidth="1.2" />
            <rect x="102" y="20" width="88" height="120" className="fill-accent-gold stroke-current" fillOpacity="0.25" strokeWidth="1.2" />
            <text x="44" y="86" textAnchor="middle" fontStyle="italic" fontSize="15">men</text>
            <text x="146" y="86" textAnchor="middle" fontStyle="italic" fontSize="15">women</text>
            <text x="95" y="168" textAnchor="middle" fontSize="15" fontWeight="600">twin baths</text>
            <text x="95" y="188" textAnchor="middle">Ibn ʿAbd al-Ẓāhir in al-Maqrizi</text>
          </g>
          {/* 3 boards, one door */}
          <g transform="translate(440,20)">
            <rect x="0" y="20" width="190" height="120" className={plan} strokeWidth="1.2" />
            <line x1="95" y1="20" x2="95" y2="112" stroke="currentColor" strokeWidth="2.4" />
            <rect x="80" y="136" width="30" height="8" className="fill-accent-gold" />
            <text x="48" y="72" textAnchor="middle" fontStyle="italic" fontSize="15">men</text>
            <text x="142" y="72" textAnchor="middle" fontStyle="italic" fontSize="15">women</text>
            <text x="95" y="128" textAnchor="middle">one door</text>
            <text x="95" y="168" textAnchor="middle" fontSize="15" fontWeight="600">boards, one door</text>
            <text x="95" y="188" textAnchor="middle">Olearius, Astrakhan</text>
          </g>
          {/* 4 own tubs */}
          <g transform="translate(655,20)">
            <rect x="0" y="20" width="190" height="120" className={plan} strokeWidth="1.2" />
            <g className="fill-accent-gold stroke-current" fillOpacity="0.25" strokeWidth="1">
              {[36, 95, 154].flatMap(cx => [58, 104].map(cy => <ellipse key={`${cx}-${cy}`} cx={cx} cy={cy} rx="22" ry="14" />))}
            </g>
            <line x1="65" y1="20" x2="65" y2="140" stroke="currentColor" strokeWidth="1" />
            <line x1="125" y1="20" x2="125" y2="140" stroke="currentColor" strokeWidth="1" />
            <text x="36" y="134" textAnchor="middle">men</text>
            <text x="95" y="134" textAnchor="middle">women</text>
            <text x="154" y="134" textAnchor="middle">the sick</text>
            <text x="95" y="168" textAnchor="middle" fontSize="15" fontWeight="600">own tubs</text>
            <text x="95" y="188" textAnchor="middle">Laimnau bath, 1656</text>
          </g>
          <text x="430" y="250" textAnchor="middle">
            “no bath guest shall drive another out of their assigned room, tub, and place” · Laimnau bath ordinance, article VII
          </text>
        </g>
      </svg>
      <figcaption className="mt-2 text-sm text-muted leading-relaxed">
        Four arrangements recorded in the sources, drawn from their descriptions, not from plans. The Laimnau hut (pp.
        11–12 [scans 23–24]) was divided so that men and women, and above all those with unclean or hereditary diseases,
        had their own tubs and places.
      </figcaption>
    </figure>
  );
}

