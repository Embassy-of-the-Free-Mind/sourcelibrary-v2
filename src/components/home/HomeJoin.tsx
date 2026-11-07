import Link from 'next/link';
import { HOME_STRINGS, type HomeLang } from '@/lib/home-i18n';
import { localePath } from '@/lib/locale-path';

/**
 * Replaces the homepage's dark "Be part of this" block. Follows straight on
 * from HomeWall: the wall gives the why, this gives the how (fund it, help with
 * it, build on it). Matches the Join section on /about. Facts from /support
 * ("Where your support goes").
 */
export default function HomeJoin({ lang = 'en' }: { lang?: HomeLang }) {
  const t = HOME_STRINGS[lang];
  const ways: [string, string, string][] = [
    [localePath('/auth/signin', lang), t.joinAccount, t.joinAccountBody],
    ['/contribute', t.joinVolunteer, t.joinVolunteerBody],
    ['/developers', t.joinBuild, t.joinBuildBody],
  ];
  return (
    <section className="py-24 md:py-32 bg-[var(--bg-warm)]">
      <div className="mx-auto w-full max-w-[1500px] px-6 md:px-12 grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-14 md:gap-24 items-start">
        <div>
          <h2 className="font-serif text-4xl md:text-6xl text-primary leading-[1.05] tracking-tight text-balance max-w-3xl">{t.joinTitle}</h2>
          <p className="mt-8 max-w-xl text-lg md:text-xl text-secondary leading-relaxed">{t.joinBody}</p>
          <div className="mt-10">
            <Link href={localePath('/support', lang)} className="inline-block px-6 py-3 bg-[#1a1612] text-white hover:bg-black transition-colors font-medium">{t.joinDonate}</Link>
          </div>
        </div>
        <ul className="divide-y divide-border-medium border-y border-border-medium md:mt-3">
          {ways.map(([href, title, text]) => (
            <li key={href}>
              <Link href={href} className="group flex items-start justify-between gap-6 py-6 hover:bg-black/[0.03] transition-colors">
                <span>
                  <span className="block font-serif text-2xl text-primary">{title}</span>
                  <span className="block mt-1 text-base text-secondary">{text}</span>
                </span>
                <span aria-hidden="true" className="mt-1 text-primary transition-transform group-hover:translate-x-1">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
