'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';

// Every date, reading and note below is taken from the article itself, which was checked against
// the scans. The dots are in date order and evenly spaced, not to scale.

type Step = {
  date: string;
  short: string;
  witness: string;
  /** The wording, split so the part that changes can be marked: [before, marked, after]. */
  wording?: [string, string, string];
  lang?: 'la' | 'grc' | 'en';
  note: string;
  href?: string;
};

const STEPS: Step[] = [
  {
    date: 'Probably 3rd century',
    short: 'Greek',
    witness: 'The Greek Logos teleios, the “Perfect Discourse”',
    note: 'For chapter 32 the Greek is lost. Lactantius, the Louvre papyrus and the Coptic of Nag Hammadi preserve other parts of the dialogue, but none reaches this sentence.',
  },
  {
    date: 'By the early 5th century',
    short: 'Latin',
    witness: 'The Latin translation, later credited to Apuleius',
    wording: ['Intelligentia enim sensus humani ', 'qualis aut quanta sit', ', tota est in memoria praeteritorum.'],
    lang: 'la',
    note: 'If the translator took κατά (“in keeping with”) to mean “of”, “the knowledge that fits the human mind” becomes “the intelligence of the human sense, of what kind or how great it is”. The same fault comes round three times.',
  },
  {
    date: '15th century',
    short: 'MS',
    witness: 'Manuscript, Biblioteca Laurenziana, Plut. 89 sup. 71',
    wording: ['Intellectus [abbreviated word] aut ', 'qualitate et', ' sensus mundi'],
    lang: 'la',
    note: 'The broken phrase is copied word for word. The medieval manuscripts already disagree over the third sentence: et qualitate, ex qualitate, qualitate et.',
    href: '/book/69b4c08d86a5921d5bc445cf?page=440',
  },
  {
    date: '1516',
    short: '1516',
    witness: 'Venice, Aldus',
    wording: ['Intellectus autem naturae, ', '& qualitatis, &', ' sensus mundi'],
    lang: 'la',
    note: 'Still has the clause “ubi enim quid temporum dimensione cognoscitur”, which later goes missing.',
    href: '/book/69b51eb747b06ecd58195d39?page=268',
  },
  {
    date: '1532',
    short: '1532',
    witness: 'Basel',
    wording: ['Intellectus autem naturae ', 'qualitate &', ' sensus mundi'],
    lang: 'la',
    note: 'Six words drop out: the eye went from “dignoscitur. ubi” to “cognoscitur. ubi”, so “dignoscitur” is followed directly by “Vbi sunt mendacia”.',
    href: '/book/69c4ec33a3a4a7c546ee6123?page=163',
  },
  {
    date: '1549',
    short: '1549',
    witness: 'Lyon, Jean de Tournes',
    wording: ['umbra dignoscitur. ', 'ubi enim quid temporum dimensione cognoscitur', ', ubi sunt mendacia'],
    lang: 'la',
    note: 'Keeps the six words the Basel edition lost. Its secunda, printed with a long s, is the one our OCR later read correctly.',
    href: '/book/6952ca2a77f38f6761bc33bf?page=530',
  },
  {
    date: '1590',
    short: '1590',
    witness: 'Hannibal Rosseli’s commentary, Kraków',
    wording: ['the intelligence of the human sense', ' (that is, to understand, or the act of understanding of the human intellect) ', 'proceeds from the memory of the past'],
    lang: 'en',
    note: 'Our translation of his Latin. The gloss drops qualis aut quanta sit and keeps the part that makes sense.',
    href: '/book/69b51e19261c58d63664f8d4?page=367',
  },
  {
    date: '1593',
    short: '1593',
    witness: 'Francesco Patrizi, Magia philosophica, Hamburg',
    wording: ['Hoc enim differt intellectus à ', 'sensu mundi', ', intelligendam, & dinoscendam mentis praeuenit intentionem.'],
    lang: 'la',
    note: 'Belongs to the Basel line, with the same gap, and adds a jump of its own: from sensu to the next sensus, losing “quod intellectus noster ad qualitatem”.',
    href: '/book/69b51ebb47b06ecd5819628b?page=164',
  },
  {
    date: '1778',
    short: '1778',
    witness: 'Apuleius, Opera, vol. 2',
    wording: ['Intellectus autem naturae ', 'et qualitatis', ' sensus mundi'],
    lang: 'la',
    note: 'Has the six words the Basel line lost.',
    href: '/book/6a10090bf717292950967757?page=182',
  },
  {
    date: '1924–26',
    short: 'Scott',
    witness: 'Walter Scott, Hermetica',
    wording: ['The knowledge ', 'which corresponds to', ' the nature and character of the cosmic mind'],
    lang: 'en',
    note: 'Scott prints the emendation et qualitatis and works back to a Greek ἡ γνῶσις ἡ κατὰ τὸ ποιόν. He marks every Greek word he supplies with a question mark.',
    href: '/book/6953a93977f38f6761bd58f4?page=361',
  },
  {
    date: '2026',
    short: '2026',
    witness: 'Source Library’s OCR and translation of the 1532 text',
    wording: ['But ', 'the intellect of nature and the sense of the world', ' can be perceived from all sensible things that are in the world.'],
    lang: 'en',
    note: 'A fluent English that gives no sign the Latin is in trouble. Our OCR also read secunda as fecunda in four of the five printed editions.',
    href: '/book/69c4ec33a3a4a7c546ee6123?page=163',
  },
];

export default function SentenceStepper() {
  const [active, setActive] = useState(1);
  const dots = useRef<(HTMLButtonElement | null)[]>([]);
  const s = STEPS[active];

  const go = (i: number, focus = false) => {
    const n = Math.max(0, Math.min(STEPS.length - 1, i));
    setActive(n);
    if (focus) dots.current[n]?.focus();
  };

  return (
    <figure className="not-prose my-12">
      <div className="border border-border-light bg-white p-4 md:p-6">
        <p className="font-sans text-sm text-primary mb-1">One sentence, version by version</p>
        <p className="font-sans text-xs text-muted mb-5">Tap a dot or use the arrows; arrow keys step through the versions.</p>

        <div
          role="tablist"
          aria-label="Versions of the sentence, in date order"
          className="relative flex justify-between"
          onKeyDown={(ev) => {
            if (ev.key === 'ArrowRight') { ev.preventDefault(); go(active + 1, true); }
            if (ev.key === 'ArrowLeft') { ev.preventDefault(); go(active - 1, true); }
            if (ev.key === 'Home') { ev.preventDefault(); go(0, true); }
            if (ev.key === 'End') { ev.preventDefault(); go(STEPS.length - 1, true); }
          }}
        >
          <div aria-hidden className="absolute left-3 right-3 top-[11px] h-0.5 bg-border-light" />
          {STEPS.map((st, i) => {
            const on = i === active;
            return (
              <button
                key={st.short}
                ref={(el) => { dots.current[i] = el; }}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls="sentence-step-panel"
                tabIndex={on ? 0 : -1}
                onClick={() => go(i)}
                className="relative flex w-6 flex-col items-center focus:outline-none group"
                title={`${st.date}: ${st.witness}`}
              >
                <span
                  className={`block h-6 w-6 border-2 transition-colors group-focus-visible:ring-2 group-focus-visible:ring-accent-gold ${
                    on ? 'border-accent-gold-dark bg-accent-gold-dark' : 'border-border-medium bg-white group-hover:border-accent-gold-dark'
                  }`}
                />
                <span className={`mt-1.5 font-sans text-[11px] leading-none whitespace-nowrap ${on ? 'text-primary' : 'text-muted'} hidden sm:block`}>
                  {st.short}
                </span>
              </button>
            );
          })}
        </div>

        <div id="sentence-step-panel" role="tabpanel" aria-live="polite" className="mt-6 min-h-[15rem] sm:min-h-[13rem]">
          <p className="font-sans text-xs text-muted">
            {active + 1} of {STEPS.length} &middot; {s.date}
          </p>
          <p className="font-sans text-base text-primary mt-1">{s.witness}</p>
          {s.wording ? (
            <p
              lang={s.lang === 'en' ? 'en' : s.lang === 'grc' ? 'grc' : 'la'}
              className={`mt-3 font-body text-lg leading-relaxed text-primary ${s.lang === 'en' ? '' : 'italic'}`}
            >
              {s.lang === 'en' ? '“' : ''}
              {s.wording[0]}
              <mark className="bg-accent-gold/25 text-primary px-0.5">{s.wording[1]}</mark>
              {s.wording[2]}
              {s.lang === 'en' ? '”' : ''}
            </p>
          ) : (
            <p className="mt-3 font-body text-lg leading-relaxed text-muted">No text survives for this sentence.</p>
          )}
          <p className="mt-3 font-sans text-sm leading-relaxed text-secondary">{s.note}</p>
          {s.href && (
            <p className="mt-2 font-sans text-sm">
              <Link href={s.href}>Open the page</Link>
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between font-sans text-sm">
          <button
            type="button"
            onClick={() => go(active - 1)}
            disabled={active === 0}
            className="px-3 py-2 border border-border-light text-primary disabled:opacity-40"
          >
            &larr; Earlier
          </button>
          <button
            type="button"
            onClick={() => go(active + 1)}
            disabled={active === STEPS.length - 1}
            className="px-3 py-2 border border-border-light text-primary disabled:opacity-40"
          >
            Later &rarr;
          </button>
        </div>
      </div>
      <figcaption className="mt-2 text-sm text-muted leading-relaxed">
        The sentence and its neighbours in each copy discussed above, in date order (evenly spaced, not to scale). The
        marked words are the part that changes or goes wrong. Readings are as given in this article, from the scans of
        the pages linked; the English of 1590 and 2026 is Source Library&rsquo;s translation, that of the 1920s
        Scott&rsquo;s own.
      </figcaption>
    </figure>
  );
}
