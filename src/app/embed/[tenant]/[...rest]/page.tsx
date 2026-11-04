import { notFound } from 'next/navigation';

// Without this an unknown address under /embed/<tenant> misses the embed layout and answers the
// ROOT not-found, with the global header and footer (#8047).
export default function EmbedTenantUnknownPath() {
  notFound();
}
