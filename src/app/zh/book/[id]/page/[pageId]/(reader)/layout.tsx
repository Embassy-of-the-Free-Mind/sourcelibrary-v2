import BaseReaderLayout from '@/app/book/[id]/page/[pageId]/(reader)/layout';

// Chinese twin of the public reader group — the hidden-book gate is the same gate.
// `lang` keeps the split-parent redirect (#5842) inside /zh.
export default async function ZhPublicReaderLayout(props: { children: React.ReactNode; params: Promise<{ id: string; pageId: string }> }) {
  return BaseReaderLayout({ ...props, lang: 'zh' });
}
