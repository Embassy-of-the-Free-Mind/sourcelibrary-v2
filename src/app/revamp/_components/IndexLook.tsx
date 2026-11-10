import Link from 'next/link';

export type Look = 'hero' | 'library' | 'gallery';
export const LOOKS: [Look, string][] = [['hero', 'A Picture hero'], ['library', 'B Library'], ['gallery', 'C Gallery']];
export const lookOf = (v?: string): Look => (v === 'library' || v === 'gallery' ? v : 'hero');

const MICRO = 'uppercase tracking-[0.16em] text-[10.5px] md:text-[11px]';

/** Prototype only: the switch between the three looks of an index page. */
export function LookSwitch({ path, look, dark = false }: { path: string; look: Look; dark?: boolean }) {
  return (
    <span className={`flex flex-wrap gap-x-2 text-xs ${dark ? 'text-white/70' : 'text-muted'}`}>
      Look
      {LOOKS.map(([k, l]) => (
        <Link key={k} href={k === 'hero' ? path : `${path}?look=${k}`}
          className={look === k ? `${dark ? 'text-white' : 'text-primary'} underline underline-offset-2` : dark ? 'hover:text-white' : 'hover:text-primary'}>{l}</Link>
      ))}
    </span>
  );
}

/**
 * The top of an index page with no picture hero, as on the Library and the Gallery: the title,
 * and the featured line on the right where the Gallery has its "Image collections" link.
 */
export function PlainHead({ title, path, look, featured }: { title: string; path: string; look: Look; featured?: { name: string; href: string } | null }) {
  return (
    <div className="max-w-[1500px] mx-auto px-6 md:px-12 pt-4 md:pt-6">
      <div className="flex justify-end mb-3 md:mb-5"><LookSwitch path={path} look={look} /></div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 mb-4 md:mb-[26px]">
        <h1 className="text-2xl md:text-4xl font-display text-primary">{title}</h1>
        {featured && (
          <Link href={featured.href} className={`group ${MICRO} text-muted`}>
            Featured<span className="mx-2 text-border-medium">/</span><span className="text-primary whitespace-nowrap group-hover:underline underline-offset-[3px]">{featured.name}</span>
          </Link>
        )}
      </div>
    </div>
  );
}
