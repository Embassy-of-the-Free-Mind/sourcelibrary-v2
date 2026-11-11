export default function PageFigure({ src, alt, source, children }) {
  return <figure><img src={src} alt={alt} /><figcaption>{children}{source && <> — {source}</>}</figcaption></figure>;
}
