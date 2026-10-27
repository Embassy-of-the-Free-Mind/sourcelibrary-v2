'use client';

import Link from 'next/link';
import { useInView } from './useInView';
import { useReducedMotion } from './useReducedMotion';

/**
 * Six pages from library copies of the books that changed what we know about
 * art, the sky, the body and the mind. They sit stacked until the scene
 * arrives, then deal out into a fanned row; on phones, a two-column grid.
 * Hovering a page lifts it. Leaving the scene stacks them again.
 *
 * Claims: Dürer's perspective machine is in the 1525 Underweysung; Copernicus
 * cites Trismegistus in De revolutionibus I.10; Vesalius's first muscle man;
 * Kepler's nested solids (1596); Galileo's moon (1610); Descartes's eyes and
 * brain from the Dioptrics, here in the Latin Opera philosophica of 1650.
 */

type Page = { year: string; who: string; what: string; src: string; w: number; h: number; href: string; alt: string };

const PAGES: Page[] = [
  { year: '1525', who: 'Dürer', what: 'Art: drawing in true perspective', src: '/about/renaissance/durer.jpg', w: 900, h: 1266, href: '/book/instruction-in-measurement-durer/page/695004b4f426a210d10975f4', alt: 'Two men using a frame and string to draw a lute in perspective' },
  { year: '1543', who: 'Copernicus', what: 'The sky: the sun at the centre', src: '/about/renaissance/copernicus.jpg', w: 900, h: 1252, href: '/book/de-revolutionibus-1543-first-edition-copernicus/page/695004fcf426a210d109b9b2', alt: "Copernicus's diagram of the planets circling the sun" },
  { year: '1543', who: 'Vesalius', what: 'The body: anatomy from dissection', src: '/about/renaissance/vesalius.jpg', w: 900, h: 1274, href: '/book/de-humani-corporis-fabrica-1543-first-edition-vesalius/page/6953e55777f38f6761bf0698', alt: 'The first muscle man, a flayed figure standing in a landscape' },
  { year: '1596', who: 'Kepler', what: "The planets, fitted to Plato's solids", src: '/about/renaissance/kepler.jpg', w: 900, h: 1165, href: '/book/mysterium-cosmographicum-1596-first-edition-kepler/page/695004e8f426a210d109a8c1', alt: "Kepler's model of nested solids inside the planetary spheres" },
  { year: '1610', who: 'Galileo', what: 'The moon through a telescope', src: '/about/renaissance/galileo.jpg', w: 900, h: 1195, href: '/book/sidereus-nuncius-1610-venice-galilei/page/695004dbf426a210d109a2fa', alt: "Galileo's drawing of the moon's surface" },
  { year: '1637', who: 'Descartes', what: 'The mind: how the eyes reach the brain', src: '/about/renaissance/descartes.jpg', w: 900, h: 1299, href: '/book/renati-des-cartes-opera-philosophica-descartes/page/69b69d32080b19f98fd0afd2', alt: "Descartes's drawing of two eyes and the brain, with lines of sight" },
];

const ROT = [-7, -3.5, -1, 1.5, 4, 7.5];
const LIFT = [18, 6, 0, 0, 8, 22];

export default function FreethinkersFan() {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const still = useReducedMotion();
  const open = still || inView;
  const mid = (PAGES.length - 1) / 2;

  return (
    <div ref={ref} className="ff">
      {/* Wide screens: a dealt, fanned row. */}
      <ul className="hidden md:flex justify-center items-end pt-6 px-4">
        {PAGES.map((p, k) => (
          <li
            key={p.src}
            className="ff-card relative -mx-3 lg:-mx-2 basis-[17%] shrink-0"
            style={{
              zIndex: k === Math.round(mid) ? 7 : 6 - Math.abs(k - mid),
              transform: open
                ? `translateY(${LIFT[k]}px) rotate(${ROT[k]}deg)`
                : `translateX(${(mid - k) * 100}%) translateY(40px) rotate(${(k - mid) * 1.5}deg)`,
              opacity: open ? 1 : 0,
              transitionDelay: open ? `${300 + k * 110}ms` : '0ms',
            }}
          >
            <Link href={p.href} className="ff-link group block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.src} alt={p.alt} width={p.w} height={p.h} className="block w-full h-auto shadow-[0_10px_30px_-12px_rgba(40,30,20,.45)]" loading="lazy" />
              <span className="ff-tip pointer-events-none absolute left-1/2 top-full mt-4 -translate-x-1/2 w-[15rem] text-center">
                <span className="block font-serif text-2xl text-primary leading-none tabular-nums">{p.year}</span>
                <span className="block mt-1 font-medium text-primary">{p.who}</span>
                <span className="block text-sm text-muted">{p.what}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Phones: a grid with captions always shown. */}
      <ul className="md:hidden grid grid-cols-2 gap-x-4 gap-y-8">
        {PAGES.map((p, k) => (
          <li
            key={p.src}
            className="ff-card"
            style={{ opacity: open ? 1 : 0, transform: open ? 'none' : 'translateY(24px)', transitionDelay: open ? `${k * 90}ms` : '0ms' }}
          >
            <Link href={p.href} className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.src} alt={p.alt} width={p.w} height={p.h} className="block w-full h-auto" loading="lazy" />
              <span className="block mt-3 font-serif text-xl text-primary leading-none">{p.year}</span>
              <span className="block mt-1 text-sm font-medium text-primary">{p.who}</span>
              <span className="block text-sm text-muted">{p.what}</span>
            </Link>
          </li>
        ))}
      </ul>

      <style>{`
        .ff .ff-card { transition: transform 1s cubic-bezier(.2,.7,.2,1), opacity .7s ease; }
        .ff .ff-link { transition: transform .35s cubic-bezier(.2,.7,.2,1); }
        .ff .ff-link:hover, .ff .ff-link:focus-visible { transform: translateY(-28px) rotate(0deg) scale(1.04); }
        .ff li:hover { z-index: 20 !important; }
        .ff .ff-tip { opacity: 0; transition: opacity .3s ease; }
        .ff .ff-link:hover .ff-tip, .ff .ff-link:focus-visible .ff-tip { opacity: 1; }
        @media (prefers-reduced-motion: reduce) { .ff .ff-card, .ff .ff-link { transition: none; } }
      `}</style>
    </div>
  );
}
