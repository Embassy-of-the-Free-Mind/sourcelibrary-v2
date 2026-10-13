import { redirect } from 'next/navigation';

// Moved to /admin/traffic (one traffic view, proxy pools excluded).
export default function TrafficPage() {
  redirect('/admin/traffic');
}
