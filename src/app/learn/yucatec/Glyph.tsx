'use client';

import Link from 'next/link';
import { Numeral } from '@/app/articles/maya-mathematics/MayaInteractives';
import type { Glyph } from '@/lib/learn-yucatec';

/**
 * A lesson's glyph, as held: a bar-and-dot numeral (drawn from its value), a
 * Stuart syllabary drawing (Classic, carved), or a Dresden Codex day-sign crop.
 * Nothing here is redrawn.
 */
export function GlyphMark({ glyph, size, muted = false }: { glyph: Glyph; size: number; muted?: boolean }) {
  const tone = muted ? 'grayscale opacity-40' : '';
  if (glyph.kind === 'numeral') {
    return (
      <span className={`inline-flex items-center justify-center ${tone}`} style={{ width: size, height: size }}>
        <Numeral value={glyph.value} size={size * 0.72} label={`${glyph.value} in bar-and-dot`} />
      </span>
    );
  }
  if (glyph.kind === 'day') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={glyph.crop_url} alt={`${glyph.sign}, a day sign in the Dresden Codex`} width={size} height={size} className={`object-cover yk-pill ${tone}`} style={{ width: size, height: size }} />
    );
  }
  // Stuart: the signs side by side, scaled to one height, inside the same box.
  const h = glyph.signs.length > 2 ? size * 0.5 : glyph.signs.length > 1 ? size * 0.6 : size * 0.8;
  return (
    <span className={`inline-flex items-center justify-center gap-0.5 ${tone}`} style={{ width: size, height: size }} role="img" aria-label={`${glyph.spells}, carved glyphs drawn by David Stuart`}>
      {glyph.signs.map((s) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={s.id} src={s.url} alt="" className="object-contain mix-blend-multiply" style={{ height: h, maxWidth: (size / glyph.signs.length) * 0.98 }} />
      ))}
    </span>
  );
}

/** The glyph, what it says, and where it comes from. */
export function GlyphStory({ glyph }: { glyph: Glyph }) {
  return (
    <div className="text-sm text-secondary space-y-2">
      <p className="text-base text-primary">{glyph.says}</p>
      {glyph.kind === 'stuart' && (
        <p className="text-xs text-muted">
          Carved glyphs, about AD 700. The Dresden Codex is later and painted, so its signs look different. {glyph.credit}.
        </p>
      )}
      {glyph.kind === 'day' && (
        <p className="text-xs text-muted">
          <Link href={glyph.url} target="_blank" className="underline underline-offset-2">Dresden Codex, p. {glyph.codex_page}</Link>
        </p>
      )}
      <p>
        <Link href="/learn/maya" className="font-medium text-accent-rust underline underline-offset-2">Learn to read the glyphs →</Link>
      </p>
    </div>
  );
}
