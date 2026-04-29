import { requireSuperAdmin } from '@/lib/auth-helpers';
import { PlatformNav } from '../PlatformNav';

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  await requireSuperAdmin();
  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#e6edf3' }}>
      <PlatformNav />
      <main style={{ padding: '24px 32px' }}>
        {children}
      </main>
    </div>
  );
}
