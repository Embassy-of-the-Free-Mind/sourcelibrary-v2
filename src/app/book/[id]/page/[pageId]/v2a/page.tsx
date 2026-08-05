import { redirect } from 'next/navigation';

// Variant 2a "Quiet Desk" was dropped after design review (2026-08-05) —
// Study Desk (2c) with the left panel is the direction. Old preview links
// land on the kept variant.
interface PageProps {
  params: Promise<{ id: string; pageId: string }>;
}

export default async function ReaderV2ARedirect({ params }: PageProps) {
  const { id, pageId } = await params;
  redirect(`/book/${id}/page/${pageId}/v2c`);
}
