/**
 * Typographic cover for books with no scanned image.
 *
 * Some texts in the library have no digitized facsimile — e.g. ETCSL Sumerian
 * compositions reconstructed from witness tablets that were never photographed.
 * Rather than a blank card with a generic icon (which reads as "broken"), we
 * render an intentional, title-page-style cover. It never implies an image we
 * don't have; it's clearly a typographic stand-in.
 *
 * Deterministic per title (no Math.random) so the same book always looks the
 * same and a grid gets gentle, stable variety instead of one flat wall.
 */

const PALETTES = [
  { bg: 'from-[#f3ece0] to-[#e7dcc8]', ink: 'text-[#5b4a36]', rule: 'border-[#bda981]' },
  { bg: 'from-[#efe9e2] to-[#ddd0c2]', ink: 'text-[#574838]', rule: 'border-[#b8a487]' },
  { bg: 'from-[#f0ebe1] to-[#e2d6c4]', ink: 'text-[#574a3a]', rule: 'border-[#b9a888]' },
  { bg: 'from-[#efe7da] to-[#e0d3bf]', ink: 'text-[#5a4a37]', rule: 'border-[#bca680]' },
];

function pick(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % PALETTES.length;
}

interface BookCoverPlaceholderProps {
  title: string;
  author?: string | null;
  /** Optional small line under the title (e.g. year, tradition). */
  meta?: string | null;
  className?: string;
}

export default function BookCoverPlaceholder({ title, author, meta, className = '' }: BookCoverPlaceholderProps) {
  const p = PALETTES[pick(title || 'untitled')];

  return (
    <div
      className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br ${p.bg} ${className}`}
      aria-hidden="true"
    >
      {/* inset frame, like a printed title page */}
      <div className={`absolute inset-[7%] border ${p.rule} opacity-50 rounded-[2px]`} />

      <div className={`relative flex flex-col items-center justify-center text-center px-[12%] ${p.ink}`}>
        <span className={`block w-7 border-t ${p.rule} mb-3 opacity-70`} />
        <h4
          className="font-serif font-semibold leading-snug line-clamp-5 text-[clamp(0.8rem,2.6vw,1.15rem)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {title}
        </h4>
        {author && author.toLowerCase() !== 'unknown' && (
          <p className="mt-2 text-[clamp(0.6rem,1.7vw,0.78rem)] italic opacity-80 line-clamp-1">{author}</p>
        )}
        {meta && <p className="mt-1 text-[clamp(0.55rem,1.5vw,0.7rem)] uppercase tracking-wide opacity-60 line-clamp-1">{meta}</p>}
        <span className={`block w-7 border-t ${p.rule} mt-3 opacity-70`} />
      </div>
    </div>
  );
}
