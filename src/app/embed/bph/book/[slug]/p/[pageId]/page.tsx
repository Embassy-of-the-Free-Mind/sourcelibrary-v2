export const revalidate = 86400;
export const preferredRegion = 'fra1';
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

/**
 * BPH embed page reader — temporarily renders a debug placeholder
 * while investigating the 500 error.
 */
export default async function EmbedPageRoute({ params }: { params: Promise<{ slug: string; pageId: string }> }) {
  const { slug, pageId } = await params;
  return (
    <div style={{ padding: 40, fontFamily: 'system-ui' }}>
      <h1>Page Reader (Debug)</h1>
      <p>Book: {slug}</p>
      <p>Page: {pageId}</p>
      <p>If you see this, the route works. The page reader UI is being fixed.</p>
    </div>
  );
}
