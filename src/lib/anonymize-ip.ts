/**
 * Anonymize an IP address by zeroing the last octet (IPv4) or last 80 bits (IPv6).
 * Truncated IPs are not personal data under GDPR.
 */
export function anonymizeIp(ip: string): string {
  if (!ip || ip === 'unknown') return 'unknown';

  // IPv4: 192.168.1.42 → 192.168.1.0
  if (ip.includes('.') && !ip.includes(':')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      parts[3] = '0';
      return parts.join('.');
    }
  }

  // IPv6: zero last 5 groups
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length >= 4) {
      return parts.slice(0, 3).join(':') + '::0';
    }
  }

  return 'unknown';
}
