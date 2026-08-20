// Spanish twin of the reader page (#4082). Identical server render; the client
// (PageEditorClient) reads the /es prefix to open the Spanish edition and to
// keep /es on every page flip. See .claude/docs/i18n.md rule 5.
export { default, revalidate } from '@/app/book/[id]/page/[pageId]/(reader)/page';
