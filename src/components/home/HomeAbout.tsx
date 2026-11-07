import type { HomeLang } from '@/lib/home-i18n';
import HomeWall from './HomeWall';

/**
 * One homepage section replacing the old "About" block and the "In the spirit
 * of" footer (Laura, 2026-11-05): a single full-screen scene low on the page,
 * just above the support section, no pinning, with its title and paragraph.
 */
export default function HomeAbout({ lang = 'en' }: { lang?: HomeLang }) {
  return (
    <div id="about">
      <HomeWall lang={lang} />
    </div>
  );
}
