import CatalogFeedbackButton from '@/components/catalog/CatalogFeedbackButton';

/**
 * Layout for the BPH catalogue pages (/embed/[tenant]/catalog/*). Mounts the
 * floating Feedback button across every catalogue page — entry, edit, new,
 * history, help, review, team — so cataloguers can give feedback from
 * wherever they are. The button self-hides for signed-out visitors.
 */
export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CatalogFeedbackButton />
    </>
  );
}
