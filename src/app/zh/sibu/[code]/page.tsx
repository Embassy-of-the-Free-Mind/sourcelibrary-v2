import { notFound } from 'next/navigation';
import { SibuClassPage, sibuClassMetadata } from '@/components/sibu/SibuPages';
import { sibuCodes } from '@/lib/sibu-catalogue';

type Props = { params: Promise<{ code: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return sibuCodes().map((code) => ({ code }));
}

export async function generateMetadata({ params }: Props) {
  return sibuClassMetadata('zh', (await params).code);
}

export default async function ZhSibuClassRoute({ params }: Props) {
  const { code } = await params;
  if (!sibuCodes().includes(code)) notFound();
  return <SibuClassPage lang="zh" code={code} />;
}
