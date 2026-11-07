import NavSwitch from '../_components/NavSwitch';

export default function Page() {
  return (
    <main className="max-w-5xl mx-auto px-6 py-14">
      <h1 className="text-4xl text-primary font-display mb-3">Navigation</h1>
      <p className="text-secondary max-w-2xl">Pick one, then hover Collections in the bar above, or use its arrow. Clicking the word Collections still goes to the page, so nobody is trapped in a menu. Escape closes it. Your choice carries across every page in this prototype.</p>
      <NavSwitch />
      <h2 className="text-2xl text-primary font-display mt-10 mb-2">On a phone</h2>
      <p className="text-secondary max-w-2xl">All three use the same phone menu: Collections slides to a second panel, because your menu rule is no scrolling. Narrow the window or open this on a phone to try it.</p>
    </main>
  );
}
