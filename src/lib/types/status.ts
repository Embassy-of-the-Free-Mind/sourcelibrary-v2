/**
 * Shared record status type used across tenants and memberships.
 * - 'active':    record is live and accessible
 * - 'pending':   invite sent, user has not yet signed in (memberships only)
 * - 'suspended': temporarily disabled (tenants)
 * - 'deleted':   soft-deleted — excluded from queries but retained in the DB
 */
export type RecordStatus = 'active' | 'pending' | 'suspended' | 'deleted';
