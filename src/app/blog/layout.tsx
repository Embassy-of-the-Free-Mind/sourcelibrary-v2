import BlogTableOfContents from '@/components/blog/BlogTableOfContents';
import BlogShareButton from '@/components/blog/BlogShareButton';

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <BlogTableOfContents />
      <BlogShareButton />
    </>
  );
}
