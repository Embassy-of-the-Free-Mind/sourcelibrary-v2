import BlogTableOfContents from '@/components/blog/BlogTableOfContents';
import BlogShareButton from '@/components/blog/BlogShareButton';
import NoteFooter from '@/components/blog/NoteFooter';
import ArticleExtras, { ArticleBooksHere } from './ArticleExtras';

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="article-page">{children}</div>
      <ArticleBooksHere />
      <NoteFooter />
      <ArticleExtras />
      <BlogTableOfContents />
      <BlogShareButton />
    </>
  );
}
