import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publishedPosts, formatPostDate } from "@/data/blog";
import { cities, site } from "@/data/site";

export function generateStaticParams() {
  return publishedPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = publishedPosts().find((p) => p.slug === slug);
  if (!post) return {};
  return { title: post.title, description: post.description };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = publishedPosts().find((p) => p.slug === slug);
  if (!post) notFound();

  const city = post.citySlug ? cities.find((c) => c.slug === post.citySlug) : undefined;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.publishDate,
    url: `${site.url}/blog/${post.slug}/`,
    publisher: { "@type": "Organization", name: site.name, url: site.url }
  };

  return (
    <article className="page-shell article-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <p className="eyebrow">{post.category} &middot; {formatPostDate(post.publishDate)}</p>
      <h1>{post.title}</h1>
      <p className="lede">{post.description}</p>
      <div className="post-body" dangerouslySetInnerHTML={{ __html: post.body }} />
      <div className="policy-box" style={{ marginTop: 48 }}>
        <h2>Planning an event{city ? ` in ${city.city}` : ""}?</h2>
        <p>Find a vetted line dance instructor and get every guest on their feet &mdash; no experience or rhythm required.</p>
        <p>
          <Link className="button primary" href={city ? `/cities/${city.slug}/` : "/#find"}>
            {city ? `Find instructors in ${city.city}` : "Find an instructor near you"}
          </Link>
        </p>
      </div>
      <p style={{ marginTop: 32 }}><Link href="/blog/">&larr; All posts</Link></p>
    </article>
  );
}
