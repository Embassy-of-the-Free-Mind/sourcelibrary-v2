import Image from 'next/image';
import Link from 'next/link';
import { readerHref, type PlateImage } from './histories';

// A picture from one of a history's books (content/picks.json `plates`), linked to its page in the reader. A plate can
// show part of its image: the image is drawn inside a box the shape of the crop and shifted so only the crop shows, so a
// woodcut can come from the full page scan, at the scan's resolution, with no new image to store.
export default function Plate({ p, width = 460 }: { p: PlateImage; width?: number }) {
  const [x, y, w, h] = p.crop ?? [0, 0, 1, 1];
  const [W, H] = p.size;
  const pct = (n: number) => `${(n * 100).toFixed(3)}%`;
  return (
    <figure className="m-0">
      <Link
        href={readerHref(p.book, p.page)}
        className="block relative overflow-hidden"
        style={{ aspectRatio: `${Math.round(w * W)} / ${Math.round(h * H)}` }}
      >
        <span className="absolute block" style={{ width: pct(1 / w), height: pct(1 / h), left: pct(-x / w), top: pct(-y / h) }}>
          <Image src={p.src} alt={p.alt} fill sizes={`(max-width: 768px) ${Math.round(100 / w)}vw, ${Math.round(width / w)}px`} className="object-fill" />
        </span>
      </Link>
      <figcaption className="mt-2 text-sm leading-snug font-body" style={{ color: 'var(--text-muted)' }}>{p.caption}</figcaption>
    </figure>
  );
}
