import { collectionModel } from '../_lib/data';
import { readMakers } from '../_lib/makers';
import AvatarPicker from './AvatarPicker';

/** Pick Symcyto's avatar from the Slime Moulds collection's pictures. Prototype only: saves to a local file. */
export default function Page() {
  const m = collectionModel('slime-moulds');
  const pics = [...new Set([...(m?.plates ?? []).map((p) => p.src), ...(m?.heroTiles ?? [])])].filter(Boolean) as string[];
  const current = readMakers().people.symcyto?.avatar ?? null;
  return (
    <main className="max-w-[1200px] mx-auto px-6 py-14">
      <h1 className="font-display text-4xl text-primary mb-2">Symcyto&apos;s avatar</h1>
      <p className="text-secondary mb-8">Pick a picture from the Slime Moulds collection. It shows round, next to &ldquo;Curated by Symcyto&rdquo; on Slime Moulds and Fungi &amp; Mycology.</p>
      <AvatarPicker person="symcyto" pics={pics} current={current} />
    </main>
  );
}
