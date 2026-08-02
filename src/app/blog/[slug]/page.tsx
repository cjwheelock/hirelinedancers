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
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}/` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: `${site.url}/blog/${post.slug}/`,
      publishedTime: post.publishDate,
      modifiedTime: post.updatedDate ?? post.publishDate,
      authors: [post.author ?? site.name],
      images: ["/images/line-dance-event-hero.png"]
    }
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = publishedPosts().find((p) => p.slug === slug);
  if (!post) notFound();

  const city = post.citySlug ? cities.find((c) => c.slug === post.citySlug) : undefined;
  const authorName = post.author ?? site.name;
  const authorIsPerson = Boolean(post.author && post.author !== site.name);
  const authorUrl = authorIsPerson ? `${site.url}/about/` : site.url;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${site.url}/blog/${post.slug}/#article`,
        headline: post.title,
        description: post.description,
        datePublished: post.publishDate,
        dateModified: post.updatedDate ?? post.publishDate,
        url: `${site.url}/blog/${post.slug}/`,
        mainEntityOfPage: `${site.url}/blog/${post.slug}/`,
        image: `${site.url}/images/line-dance-event-hero.png`,
        author: {
          "@type": authorIsPerson ? "Person" : "Organization",
          name: authorName,
          url: authorUrl
        },
        publisher: { "@type": "Organization", name: site.name, url: site.url }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: site.url },
          { "@type": "ListItem", position: 2, name: "Blog", item: `${site.url}/blog/` },
          { "@type": "ListItem", position: 3, name: post.title, item: `${site.url}/blog/${post.slug}/` }
        ]
      }
    ]
  };

  return (
    <article className="page-shell article-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href="/blog/">Blog</Link>
      </nav>
      <p className="eyebrow">{post.category} &middot; {formatPostDate(post.publishDate)}</p>
      <h1>{post.title}</h1>
      <p className="lede">{post.description}</p>
      <p className="article-byline">
        By <Link href={authorIsPerson ? "/about/" : "/"}>{authorName}</Link>
        {post.reviewer ? `, reviewed with ${post.reviewer}` : ""}
        {post.updatedDate && post.updatedDate !== post.publishDate ? ` · Updated ${formatPostDate(post.updatedDate)}` : ""}
      </p>
      <div className="post-body" dangerouslySetInnerHTML={{ __html: post.body }} />
      <div className="policy-box" style={{ marginTop: 48 }}>
        <h2>Planning an event{city ? ` in ${city.city}` : ""}?</h2>
        <p>Find a line dance instructor and give guests a welcoming way to get moving together. No prior dance experience is required.</p>
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
