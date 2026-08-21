/**
 * First-translation graded-verdict subsystem (issue #2564).
 *
 * Public surface: the verdict TYPES, the derived single-writer rule, the
 * append-only attempt log, and the effort-tier router. `is_first_translation`
 * is a derived read of this — do not add a competing writer.
 */
export * from './types';
export * from './derive';
export * from './attempt-log';
export * from './resolve';
export * from './candidate';
