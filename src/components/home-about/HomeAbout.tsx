import HomeWall from './HomeWall';

/**
 * One homepage section replacing the old "About" block and the "In the spirit
 * of" footer (Laura, 2026-11-05): a single full-screen scene, no pinning, one
 * story, on the dark ground of the /about hero.
 */
export default function HomeAbout() {
  return (
    <div id="about">
      <HomeWall tone="dark" />
    </div>
  );
}
