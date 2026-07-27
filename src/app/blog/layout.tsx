import BlogTableOfContents from '@/components/blog/BlogTableOfContents';
import BlogShareButton from '@/components/blog/BlogShareButton';
import NoteFooter from '@/components/blog/NoteFooter';

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <NoteFooter />
      <BlogTableOfContents />
      <BlogShareButton />
    </>
  );
}
