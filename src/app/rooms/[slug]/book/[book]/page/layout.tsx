import RoomReaderModalReporter from '@/components/rooms/RoomReaderModalReporter';

/**
 * The reader segment of a reading room. A layout rather than part of the
 * page, so the modal report survives page turns (a new [pageId] re-renders
 * the page but keeps this layout mounted) and the host frame is not dropped
 * and re-lifted on every turn.
 */
export default function RoomReaderLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <RoomReaderModalReporter />
    </>
  );
}
