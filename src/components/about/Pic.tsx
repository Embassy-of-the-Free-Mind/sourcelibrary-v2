/**
 * A picture with an AVIF beside its JPEG (same name, .avif): about a third
 * smaller, and browsers that can't read AVIF fall back to the JPEG.
 */
export default function Pic({ src, alt, width, height, className }: { src: string; alt: string; width: number; height: number; className?: string }) {
  return (
    <picture className="contents">
      <source srcSet={src.replace(/\.jpe?g$/, '.avif')} type="image/avif" />
      <img src={src} alt={alt} width={width} height={height} className={className} loading="lazy" />
    </picture>
  );
}
