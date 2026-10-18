'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

/**
 * An article picture that holds its place while it loads: the box is drawn at
 * the picture's own proportions with a blurred copy in it, and the picture fades
 * in over the blur when it arrives. Without the size (a picture not yet in
 * src/generated/article-image-sizes.json) it just fades in.
 *
 * The blur is a CSS background, not an <img>, so the lightbox (which collects
 * the <img>s in an article) only ever sees the picture itself.
 */
export default function FadeInImage({
  src,
  alt,
  sizes,
  priority,
  width,
  height,
  blur,
  optimise,
}: {
  src: string;
  alt: string;
  sizes: string;
  priority: boolean;
  width?: number;
  height?: number;
  blur?: string;
  optimise: boolean;
}) {
  const img = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  // A picture already in the browser cache can finish before React attaches onLoad.
  useEffect(() => {
    if (img.current?.complete && img.current.naturalWidth > 0) setLoaded(true);
  }, []);

  const fade = `w-full h-auto transition-opacity duration-500 ease-out ${loaded ? 'opacity-100' : 'opacity-0'}`;
  const box = width && height ? { aspectRatio: `${width} / ${height}` } : undefined;
  const backdrop = blur
    ? { backgroundImage: `url(${blur})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : undefined;

  return (
    <div className={`relative overflow-hidden ${loaded ? '' : 'bg-warm'}`} style={{ ...box, ...(loaded ? {} : backdrop) }}>
      {optimise ? (
        <Image
          ref={img}
          src={src}
          alt={alt}
          width={width ?? 0}
          height={height ?? 0}
          sizes={sizes}
          quality={75}
          priority={priority}
          onLoad={() => setLoaded(true)}
          className={fade}
          style={{ width: '100%', height: 'auto' }}
        />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          ref={img}
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? 'eager' : 'lazy'}
          onLoad={() => setLoaded(true)}
          className={fade}
        />
      )}
    </div>
  );
}
