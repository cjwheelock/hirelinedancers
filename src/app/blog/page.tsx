import Link from "next/link";
import { publishedPosts, formatPostDate } from "@/data/blog";

export const metadata = {
  title: "Line Dancing for Events Blog",
  description:
    "Guides and ideas for planning events with line dancing: city guides, entertainment comparisons, and tips for weddings, corporate events, and parties."
};

export default function BlogIndexPage() {
  const posts = publishedPosts();
  return (
    <section className="page-shell">
      <h1>Ideas for a packed dance floor.</h1>
      <p className="lede">City guides, entertainment comparisons, and practical planning advice for weddings, corporate events, and parties.</p>
      <div className="blog-grid">
        {posts.map((post) => (
          <Link key={post.slug} className="blog-card" href={`/blog/${post.slug}/`}>
            <span className="pill">{post.category}</span>
            <h2>{post.title}</h2>
            <p>{post.description}</p>
            <time dateTime={post.publishDate}>{formatPostDate(post.publishDate)}</time>
          </Link>
        ))}
      </div>
    </section>
  );
}
