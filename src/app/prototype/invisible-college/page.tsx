import type { Metadata } from 'next';
import { BOARD_CSS, BOARD_HTML, FONTS_LINK } from './content';

export const metadata: Metadata = {
  title: 'The Invisible College (design draft) | Source Library',
  description: 'A draft design board for a volunteer order around Source Library, for discussion.',
  robots: { index: false, follow: false },
};

/**
 * PROTOTYPE ONLY — not linked from any public surface, noindex, not in the sitemap.
 *
 * Who it is for: Derek and a few partners (Embassy of the Free Mind, prospective
 * volunteer leads), 5-10 minutes on a laptop or phone. It is a draft for discussion,
 * not a launch. Issue: #2121.
 *
 * Ported without copy changes from the design board first drafted as a private
 * claude.ai artifact. The markup is static, authored text (./content.ts); the CSS is
 * scoped under `.ic` so the broadside's element selectors cannot leak into the site.
 * Plates are cropped from full scans on images.sourcelibrary.org with CSS (no
 * embedded images): Rosarium philosophorum (1550) and Splendor Solis (1598), both
 * public domain.
 */
export default function InvisibleCollegePage() {
  return (
    <div className="ic">
      <style dangerouslySetInnerHTML={{ __html: `.ic{${BOARD_CSS}}` }} />
      <div dangerouslySetInnerHTML={{ __html: FONTS_LINK + BOARD_HTML }} />
    </div>
  );
}
