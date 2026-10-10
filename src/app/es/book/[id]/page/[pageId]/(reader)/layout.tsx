import BaseReaderLayout from '@/app/book/[id]/page/[pageId]/(reader)/layout';

// Spanish twin of the public reader group — the hidden-book gate is the same gate.
// `lang` keeps the split-parent redirect (#5842) inside /es.
export default async function EsPublicReaderLayout(props: { children: React.ReactNode; params: Promise<{ id: string; pageId: string }> }) {
  return BaseReaderLayout({ ...props, lang: 'es' });
}
