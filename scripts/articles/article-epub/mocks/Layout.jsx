export default function ContentPageLayout({ header, children }) { return <>{header}{children}</>; }
// The page's own display title and subtitle, for the EPUB's cover and title page (build.ts reads and removes it).
export function ContentHeader({ title, subtitle }) { return <div data-epub-header="" data-title={title} data-subtitle={subtitle} />; }
