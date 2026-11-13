/**
 * The one set of styles for search, filter and sort controls. /library, /gallery and every
 * collection, subject and category page take their controls from here, so they cannot drift.
 * Add a control here rather than writing its classes in a page. See .claude/docs/style-system.md.
 */

/** Every control in a toolbar is this tall, border included: SortSelect, Filters, the view switch. */
export const CONTROL_H = 'h-9 sm:h-[38px]';

/** A button that opens filters or advanced search: white, black when open. */
export const toggleBtn = (open: boolean) =>
  `inline-flex items-center gap-2 ${CONTROL_H} px-3 sm:px-3.5 border text-[13px] sm:text-sm ${open ? 'bg-primary border-primary text-cream' : 'bg-white border-border-medium text-primary hover:border-primary'}`;

/** On/off choice pills (Made by, Holds, picture kinds). Black when on. */
export const pill = (on: boolean) =>
  `h-[30px] px-3 border text-[13px] ${on ? 'bg-primary border-primary text-cream' : 'bg-white border-border-medium text-primary hover:border-primary'}`;

/** Grid / list / bands switch: a bordered group of square icon buttons, the same height as SortSelect. */
export const VIEW_GROUP = 'flex border border-border-medium';
export const viewBtn = (on: boolean) =>
  `w-[34px] sm:w-9 h-[34px] sm:h-9 grid place-items-center ${on ? 'bg-warm text-primary' : 'bg-white text-muted hover:text-primary'}`;

/** A toolbar row: count, menus, then order and view pushed right. */
export const TOOLBAR = 'flex flex-wrap items-center gap-2 sm:gap-2.5';

/** "1,244 works", "46 centuries", "64 works of 1,244". */
export const COUNT = 'text-sm text-primary font-medium';

/** "How we …" link and the panel it opens. */
export const HOW_LINK = 'text-[13px] text-muted underline decoration-border-medium underline-offset-[3px] hover:text-primary hover:decoration-primary';
export const HOW_PANEL = 'max-w-2xl bg-warm border border-border-light px-5 py-4 space-y-1.5 text-[14.5px] text-secondary leading-relaxed list-disc pl-9';

/** A light search field (the dark hero strip is CollectionBars). */
export const FIELD = 'flex items-stretch h-10 sm:h-[52px] border border-border-medium bg-white focus-within:border-primary focus-within:ring-1 focus-within:ring-primary';
