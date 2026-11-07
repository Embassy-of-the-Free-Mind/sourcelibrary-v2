import { SibuIndex, sibuIndexMetadata } from '@/components/sibu/SibuPages';

export const metadata = sibuIndexMetadata('zh');

export default function ZhSibuPage() {
  return <SibuIndex lang="zh" />;
}
