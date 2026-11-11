// Site-relative images (/articles/<slug>/x.jpg) are read from public/ (PUBLIC_DIR, set by build.sh).
export default function PageFigure({ src, alt, source, children }) {
  const img = src.startsWith('/') ? `file://${process.env.PUBLIC_DIR}${src}` : src;
  return <figure><img src={img} alt={alt} /><figcaption>{children}{source && <> — {source}</>}</figcaption></figure>;
}
